/**
 * 模块职责：元数据包的安装与增量更新
 * 依赖方向：依赖类型包的 HttpClient / Logger 契约与本插件的 zip 解包器；不碰内核内部
 * 生命周期：随插件 setup 造一个实例，安装状态记在磁盘的 `.sha` 里
 * 注意事项：安装靠下载包而非 git，故本仓库不需要 git 依赖。包落在数据目录下而非插件的 `resources/` 下，插件重装
 *          时不必重下三百兆。**只装 JSON、图片与按文件名放行的几个 `.js`**（白名单见 {@link META_EXTENSIONS} 与 `#filenames`），
 *          落盘的 JS 只被解析；执行仅限沙箱、且由 `enableDmgCalc` 开启。增量包须带 sha256、逐个校验后再解（见 {@link verifyHash}），
 *          不带的整批改走完整包；完整包取自固定的官方归档地址（不随 `metaHost`），不带哈希、以「解出的 character 目录非空」作落地校验。安装**幂等且可并发调用**：同一游戏的任务按内部锁排队。
 */
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs"
import { dirname, join } from "node:path"
import type { HttpClient, Logger } from "@yunzai-ng/types"
import { buildAliasIndex, parseAliasFile } from "./alias-parse.js"
import { ABBR_SOURCE } from "./abbr-parse.js"
import { DAILY_SOURCE } from "./material.js"
import { ARTI_META_FILE } from "./arti-parse.js"
import { CALC_FILES } from "./sandbox.js"
import { joinWithin, listEntries, META_EXTENSIONS, singleRoot, unzip } from "./zip.js"
import { setDirOf } from "./set-dir.js"
import type { GameKey } from "../core/region.js"

/**
 * 有元数据包的游戏
 *
 * 绝区零那份不是官方元数据，而是另行整理的同形态包。产出方式不同而下载形式完全一致
 * （同一仓库的 `meta-zzz` 分支），故本模块不为它分路。
 */
export type MetaGame = GameKey

/**
 * 有下载源的游戏
 *
 * 自动安装、定时更新与 `#更新元数据` 都按这张表遍历。
 */
export const META_GAMES: readonly MetaGame[] = ["gs", "sr", "zzz"]

/**
 * 包里带伤害公式文件的游戏
 *
 * 三个游戏都有，故与 {@link META_GAMES} 重合。仍留着是因含义不同（前者「有下载源」、这张「包里有要送进沙箱的文件」）：
 * 日后若添一个纯数据的包，漏改这里的后果是开着伤害计算时**每次启动都重下一遍完整包**（{@link MetaInstaller.hasCalc} 恒假）。
 */
const CALC_GAMES: readonly MetaGame[] = ["gs", "sr", "zzz"]

/**
 * 各包的体积量级，只用于提示文案
 *
 * 取整到十兆而非报实际字节：只用来让使用者知道该等多久、别当成卡住了。
 */
export const PACK_MB: Readonly<Record<MetaGame, number>> = { gs: 150, sr: 150, zzz: 45 }

/**
 * 增量更新的基线
 *
 * 早于基线的提交远端不再提供增量附件、只能重下完整包。没有这一项的游戏由那道附件检查兜成完整包，效果相同。
 */
const BASELINE: Readonly<Partial<Record<MetaGame, string>>> = {
  gs: "e11ebff926d4efdaf978fed9f73d1a8fdf1c80cf",
  sr: "b2e204c0f73dc43dd510f2c8c38fe0f69266d5f3"
}

/** 提交列表接口的默认主机 */
export const DEFAULT_META_HOST = "https://miao.072420.xyz"

/** 完整包的归档地址 */
const ARCHIVE_URL = "https://cnb.cool/qsyhh_res/meta/-/git/archive/refs/heads"

/** 解出体积的上限，原神与星铁两个包各约 165MB，留一倍余量即可挡住异常巨大的响应 */
const MAX_BYTES = 512 * 1024 * 1024

/** 下载进度每涨这么多字节报一行 */
const PROGRESS_STEP = 20 * 1024 * 1024

/** 多久没涨就提一句"疑似卡住" */
const PROGRESS_IDLE = 300_000

/** 看一眼进度的间隔 */
const PROGRESS_POLL = 3_000

/** 一次进度检查的结论 */
export type ProgressTick =
  /** 什么都不必说 */
  | "quiet"
  /** 该报一行进度了 */
  | "log"
  /** 太久没有新数据 */
  | "stall"

/**
 * 下载进度的判定
 *
 * 内核的 `http.download` 不提供进度回调，故隔几秒看一眼已写入字节数。判定抽在这里而非写在定时器里，是为了能被
 * 测试直接驱动。**只有观察到过增长才会报「卡住」**：内核先写 `.part` 再改名，若改了写法本类看到的字节恒为零，
 * 此时应当安静而非误报卡死。
 */
export class DownloadProgress {
  readonly #step: number
  readonly #idle: number
  #reported = -1
  #size = 0
  #grew = false
  #grewAt: number

  /**
   * @param opts 起始时刻与两个阈值
   */
  constructor(opts: { at: number; step?: number; idle?: number }) {
    this.#step = opts.step ?? PROGRESS_STEP
    this.#idle = opts.idle ?? PROGRESS_IDLE
    this.#grewAt = opts.at
  }

  /**
   * 报一次当前已写入的字节数
   * @param size 已写入字节数
   * @param at 当前时刻
   * @returns 该做什么
   */
  tick(size: number, at: number): ProgressTick {
    if (size > this.#size) {
      this.#size = size
      this.#grew = true
      this.#grewAt = at
      const step = Math.floor(size / this.#step)
      if (step !== this.#reported) {
        this.#reported = step
        return "log"
      }
      return "quiet"
    }
    if (this.#grew && at - this.#grewAt >= this.#idle) {
      // 报过一次就重新计时，否则此后每次检查都会重复同一句
      this.#grewAt = at
      return "stall"
    }
    return "quiet"
  }
}

/**
 * 元数据里那份别名源文件的文件名
 *
 * 与 `material/daily.js`、`material/abbr.js` 同为恒放行落盘的 `.js`，见 {@link MetaInstaller.install}。
 */
export const ALIAS_SOURCE = "alias.js"

/** 由 {@link ALIAS_SOURCE} 解析出的别名索引的文件名，运行期只读这一份 */
export const ALIAS_INDEX = "alias.json"

/**
 * 元数据里那份卡池表的文件名（原神与绝区零）
 *
 * `info/pool.js`。**星铁那份叫 `info/index.js`**，故按游戏取名的地方一律走 {@link POOL_FILE}、别用这个常量。
 * 同样恒放行、只解析不求值。
 */
export const POOL_SOURCE = "pool.js"

/**
 * 各游戏卡池表的文件名
 *
 * 三个游戏都在 `info/` 下，但**下载源里星铁那份叫 `index.js`、原神与绝区零叫 `pool.js`**。名字判错的后果有两处且
 * 都不报错：`#filenames` 白名单漏掉它 → 完整包里那文件被当非数据滤掉、根本不落盘；{@link MetaInstaller.hasPool}
 * 照 `pool.js` 找 → 星铁恒判「缺卡池表」→ 每次 `#更新元数据` 都重下整包又补不上，无限循环。
 */
export const POOL_FILE: Readonly<Record<MetaGame, string>> = { gs: "pool.js", sr: "index.js", zzz: "pool.js" }

/**
 * 元数据里那份默认评分权重表的文件名
 *
 * 原神星铁在 `artifact/artis-mark.js`、绝区零在 `equip/artis-mark.js`，同名同形（导出 `usefulAttr`）。**恒放行、
 * 只解析不求值**：权重逐版本随新角色增补，不随元数据走就只能随插件发版。与要送进沙箱的 {@link CALC_FILES} 分开。
 */
export const ARTIS_MARK_SOURCE = "artis-mark.js"

/**
 * 元数据里那份补充名录的文件名
 *
 * `character/extra.js`，原神与星铁的包里都有（原神导出 `extraChars` 与 `wifeCfg`，星铁只有 `wifeCfg`）。**恒放行、只解析不求值**：
 * 两张表逐版本随新角色增补。绝区零没有这个文件，放行一个不存在的文件名不会有任何后果。
 */
export const EXTRA_SOURCE = "extra.js"

/** 提交列表里本模块用到的字段 */
export interface MetaCommit {
  /** 提交号 */
  sha: string
  /** 提交信息 */
  commit?: {
    /** 说明文本 */
    message?: string
  }
  /** 增量附件 */
  assets?: {
    /** 附件下载地址 */
    path?: string
    /** 附件的哈希算法 */
    hash_algo?: string
    /** 附件哈希 */
    hash_value?: string
    /** 附件尚未就绪时为真 */
    hasFile?: boolean
  }
  /** 本次改动的文件 */
  files?: {
    /** 路径 */
    path?: string
    /** 状态，`add` / `modify` / `delete` / `rename` */
    status?: string
    /** 改名前的路径 */
    previous_filename?: string
  }[]
}

/** 一次安装或更新的结果 */
export interface MetaResult {
  /** 游戏 */
  game: MetaGame
  /** 结果分类 */
  status: "exists" | "latest" | "install" | "update" | "full" | "pending" | "error"
  /** 可直接展示的说明 */
  message: string
  /** 应用的提交数 */
  count: number
  /** 当前的本地版本 */
  sha: string
  /**
   * 本次应用的各提交说明，由旧到新
   *
   * 使用者要知道这次更新带来了什么，只报「应用了 N 个提交」等于什么都没说。
   */
  messages?: readonly string[]
}

/** 造安装器需要的东西 */
export interface MetaInstallerOptions {
  /** 元数据的落盘根目录，通常取 `join(ctx.dataDir, "meta")` */
  dir: string
  /** HTTP 客户端，取 `ctx.http` */
  http: HttpClient
  /** 日志器 */
  logger: Logger
  /** 提交列表接口主机，缺省 {@link DEFAULT_META_HOST} */
  host?: string
}

/**
 * 校验字节的哈希
 * @param data 字节
 * @param algo 算法名，只认 sha256
 * @param want 期望的十六进制哈希
 * @returns 一致时为真；未给哈希或算法不是 sha256 时为假 —— 增量包里有 calc.js，放行无从校验的包等于放行任意代码
 */
export function verifyHash(data: Uint8Array, algo: string | undefined, want: string | undefined): boolean {
  if (!want || algo?.toLowerCase() !== "sha256") return false
  return createHash("sha256").update(data).digest("hex") === want.toLowerCase()
}

/**
 * 一个提交的增量附件能不能拿来用：要有地址，也要有能校验的 sha256
 * @param commit 提交
 * @returns 可用时为真
 */
function hasUsableAsset(commit: MetaCommit): boolean {
  const a = commit.assets
  return !!(a?.path ?? "").trim() && !!a?.hash_value && a.hash_algo?.toLowerCase() === "sha256"
}

/**
 * 元数据安装器
 *
 * 一个实例管三个游戏，各自按游戏排队。
 */
export class MetaInstaller {
  readonly #dir: string
  readonly #http: HttpClient
  readonly #logger: Logger
  readonly #host: string
  readonly #locks = new Map<MetaGame, Promise<MetaResult>>()

  /**
   * @param opts 安装器选项
   */
  constructor(opts: MetaInstallerOptions) {
    this.#dir = opts.dir
    this.#http = opts.http
    this.#logger = opts.logger
    this.#host = opts.host ?? DEFAULT_META_HOST
  }

  /**
   * 本次解包该额外放行哪些文件名
   *
   * `alias.js`/`daily.js`/`abbr.js`/`pool.js`/`artis-mark.js`/`extra.js` **恒放行**：六者都是纯数据且逐版本增补，
   * 不随元数据更新就只能随插件发版（新角色查不到、新国家天赋书漏掉、新卡池 UP 判定全错、评分按旧权重…）。放行它们
   * 安全，因为它们**只被解析、从不求值**（各解析器只认一种很窄的语法、遇别的整体失败）。{@link CALC_FILES} 同样恒放行：
   * 静态 buff 从里面解析（见 meta/buffs.ts）；送进沙箱执行则另由 `enableDmgCalc` 把关，落盘不等于执行。
   *
   * **卡池表的文件名按游戏取**（见 {@link POOL_FILE}）：星铁那份叫 `info/index.js`，写死 `pool.js` 会把它当非数据滤掉。
   * @param game 游戏
   * @returns 放行的文件名
   */
  #filenames(game: MetaGame): readonly string[] {
    const data = [ALIAS_SOURCE, DAILY_SOURCE, ABBR_SOURCE, POOL_FILE[game], ARTIS_MARK_SOURCE, EXTRA_SOURCE]
    if (game !== "zzz") data.push(ARTI_META_FILE[game])
    return [...CALC_FILES, ...data]
  }

  /**
   * 把落盘的 `alias.js` 解析成 `alias.json`
   *
   * 解析而非求值。产出与源文件并存于 `character/` 下，运行期只读 `.json`。**解析失败只记日志、不中断安装**：别名表缺失
   * 只是「社区叫法查不到、全名仍可查」，而让整个安装因此失败会连角色图标一起没有。
   * @param base 元数据目录，即 {@link MetaInstaller.dirOf} 的返回
   * @param game 游戏，仅用于日志
   */
  #buildAlias(base: string, game: MetaGame): void {
    const src = join(base, "character", ALIAS_SOURCE)
    if (!existsSync(src)) return
    try {
      const parsed = parseAliasFile(readFileSync(src, "utf8"))
      if (!parsed) {
        this.#logger.warn(`[米游社][元数据] meta-${game} 的 ${ALIAS_SOURCE} 里没有 alias 导出，别名暂不可用`)
        return
      }
      const index = buildAliasIndex(parsed)
      writeFileSync(join(base, "character", ALIAS_INDEX), `${JSON.stringify(index)}\n`, "utf8")
      this.#logger.debug(`[米游社][元数据] meta-${game} 别名表已生成，共 ${Object.keys(index.alias).length} 条`)
    } catch (err) {
      this.#logger.warn(
        `[米游社][元数据] meta-${game} 别名解析失败，社区叫法暂不可用（全名仍可查）：${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /**
   * 取一个游戏的元数据目录
   * @param game 游戏
   * @returns 绝对路径
   */
  dirOf(game: MetaGame): string {
    return join(this.#dir, `meta-${game}`)
  }

  /**
   * 取本地已装的版本
   * @param game 游戏
   * @returns 提交号；未装或文件损坏时为空串
   */
  localSha(game: MetaGame): string {
    try {
      const sha = readFileSync(join(this.dirOf(game), ".sha"), "utf8").trim()
      return /^[0-9a-f]{40}$/i.test(sha) ? sha : ""
    } catch {
      return ""
    }
  }

  /**
   * 判断一个游戏的元数据是否已装好
   *
   * 判据是 `character` 目录非空且 `.sha` 有效。只看目录存在不够——下载中途失败会留下空目录。
   * @param game 游戏
   * @returns 已装好时为真
   */
  installed(game: MetaGame): boolean {
    const chars = join(this.dirOf(game), "character")
    if (!existsSync(chars) || readdirSync(chars).length === 0) return false
    return this.localSha(game) !== ""
  }

  /**
   * 目录里有没有一份读得了的包
   *
   * 与 {@link MetaInstaller.installed} 的分别在于**不看 `.sha`**：手工放进去的包没有提交号，但 {@link MetaLoader}
   * 照样读得了。故「能不能用」看这个、「是不是从下载源装的、装的哪一版」看那个。
   * @param game 游戏
   * @returns 目录里有内容时为真
   */
  present(game: MetaGame): boolean {
    const chars = join(this.dirOf(game), "character")
    return existsSync(chars) && readdirSync(chars).length > 0
  }

  /**
   * 取一份包自报的版本
   *
   * 手工放进来的包带一份 `version.json`，从下载源装的那些没有。
   * @param game 游戏
   * @returns 版本号；没有这一项时为空串
   */
  packVersion(game: MetaGame): string {
    try {
      const raw = JSON.parse(readFileSync(join(this.dirOf(game), "version.json"), "utf8")) as {
        version?: unknown
      }
      return typeof raw.version === "string" ? raw.version : ""
    } catch {
      return ""
    }
  }

  /**
   * 本地这份元数据里有没有伤害公式文件
   *
   * 判据取套装那份 `calc.js`（三个游戏各一份、路径固定）。**目录按游戏分**（原神星铁 `artifact/`、绝区零 `equip/`，
   * 见 {@link setDirOf}），绝区零照原路问会恒为假。**这一项决定要不要重下完整包**：白名单是解包时现读的，「关着伤害
   * 计算装的」那份树里一个公式文件都没有，而增量包只带改动过的文件、此前被挡下的不会再出现、只靠更新永远补不上。
   * @param game 游戏
   * @returns 有公式文件时为真
   */
  hasCalc(game: MetaGame): boolean {
    return existsSync(join(this.dirOf(game), setDirOf(game), CALC_FILES[0] ?? "calc.js"))
  }

  /**
   * 本地这份元数据里有没有卡池表
   *
   * 与 {@link MetaInstaller.hasCalc} 同理：本地树缺 `info/pool.js` 时增量只带改动过的文件、永远补不上，
   * 而少了它**卡池表整个空掉**（版本判不出、UP 一律「无从判定」）且不报错。故缺了就改走完整包。
   * @param game 游戏
   * @returns 有卡池表时为真
   */
  hasPool(game: MetaGame): boolean {
    return existsSync(join(this.dirOf(game), "info", POOL_FILE[game]))
  }

  /**
   * 本地这份元数据里有没有词条表（原神 `artifact/extra.js`、星铁 `artifact/meta.js`）
   *
   * 与 {@link MetaInstaller.hasPool} 同理，缺了只靠增量永远补不上，而少了它**评分恒 0、面板词条认不出**。绝区零没有这张表、恒为真。
   * @param game 游戏
   * @returns 有词条表时为真
   */
  hasArtiMeta(game: MetaGame): boolean {
    if (game === "zzz") return true
    return existsSync(join(this.dirOf(game), setDirOf(game), ARTI_META_FILE[game]))
  }

  /**
   * 某个游戏的元数据是否正在下载
   *
   * 供命令层判断「要不要再起一轮」：重复触发不会并发写盘，但会让使用者等两遍、第二条消息恒为「已是最新」。
   * @param game 游戏
   * @returns 正在下载时为真
   */
  busy(game: MetaGame): boolean {
    return this.#locks.has(game)
  }

  /**
   * 安装或更新，按游戏串行
   * @param game 游戏
   * @param opts 选项
   * @returns 结果
   */
  async install(game: MetaGame, opts: { force?: boolean; installOnly?: boolean } = {}): Promise<MetaResult> {
    const prev = this.#locks.get(game)
    if (prev) {
      // 前序任务失败不影响本次，故只等待不关心结果
      await prev.catch(() => undefined)
    }
    const task = this.#install(game, opts).finally(() => {
      if (this.#locks.get(game) === task) this.#locks.delete(game)
    })
    this.#locks.set(game, task)
    return task
  }

  /**
   * 安装或更新的实际流程，由 {@link install} 串行调用
   * @param game 游戏
   * @param opts 选项
   * @returns 结果
   */
  async #install(game: MetaGame, { force = false, installOnly = false }: { force?: boolean; installOnly?: boolean }): Promise<MetaResult> {
    const local = this.localSha(game)
    const ready = this.installed(game)
    if (ready && installOnly && !force) {
      return { game, status: "exists", message: "元数据已存在", count: 0, sha: local }
    }

    // 手工放进来的包不被自动补装覆盖：它没有 `.sha`、installed 为假，而 #full 是整个目录换上，
    // 会把使用者自己拉的那份悄悄换掉。只挡自动补装那一路——`#更新元数据` 不带 installOnly、要换发一次即可
    if (!ready && installOnly && !force && this.present(game)) {
      return { game, status: "exists", message: "已有一份手工放入的元数据，未自动覆盖", count: 0, sha: local }
    }

    // 本地这份不含公式文件时改走完整包（增量永远补不上，见 hasCalc）
    const needCalc = !force && ready && CALC_GAMES.includes(game) && !this.hasCalc(game)

    // 本地缺卡池表时同样改走完整包（见 hasPool）
    const needPool = !force && ready && !this.hasPool(game)
    const needArti = !force && ready && !this.hasArtiMeta(game)

    let commits: MetaCommit[]
    try {
      commits = await this.#http.get<MetaCommit[]>(`${this.#host}/api/meta-${game}/commits`, {
        timeout: "30s",
        retry: 2
      })
    } catch (err) {
      return { game, status: "error", message: `取提交列表失败：${message(err)}`, count: 0, sha: local }
    }
    const latest = commits[0]?.sha
    if (!Array.isArray(commits) || !latest) {
      return { game, status: "error", message: "远端提交列表为空", count: 0, sha: local }
    }

    if (force || needCalc || needPool || needArti || !ready) {
      await this.#full(game, latest)
      let text = "元数据安装完成"
      if (needCalc) text = "本地缺少公式文件，已重新下载完整元数据"
      else if (needPool) text = "本地缺少卡池版本表，已重新下载完整元数据"
      else if (needArti) text = "本地缺少圣遗物词条表，已重新下载完整元数据"
      else if (force) text = "已重新下载完整元数据"
      return {
        game,
        status: force || needCalc || needPool || needArti ? "full" : "install",
        message: text,
        count: 0,
        sha: latest
      }
    }

    if (local === latest) return { game, status: "latest", message: "元数据已是最新", count: 0, sha: local }

    const at = commits.findIndex(it => it.sha === local)
    const baseAt = commits.findIndex(it => it.sha === BASELINE[game])
    // 本地版本不在列表里，或早于基线 —— 两种情形都拿不到完整的增量链
    if (at < 0 || (baseAt >= 0 && at > baseAt)) {
      await this.#full(game, latest)
      return { game, status: "full", message: "本地版本过旧，已重新下载完整元数据", count: 0, sha: latest }
    }

    // 列表是新的在前，取本地版本之前的那些并反转成由旧到新
    const pending = commits.slice(0, at).reverse()
    const broken = pending.find(it => {
      const changed = (it.files ?? []).some(f => f.status !== "delete" && f.status !== "rename")
      return changed && !hasUsableAsset(it)
    })
    if (broken) {
      if (broken.assets?.hasFile && !(broken.assets.path ?? "").trim()) {
        return { game, status: "pending", message: "增量附件尚未就绪，暂不更新", count: 0, sha: local }
      }
      await this.#full(game, latest)
      return { game, status: "full", message: "增量资源不完整，已重新下载完整元数据", count: 0, sha: latest }
    }

    let count = 0
    const messages: string[] = []
    for (const commit of pending) {
      await this.#incremental(game, commit)
      count++
      const text = (commit.commit?.message ?? "").trim()
      if (text) messages.push(text)
      this.#writeSha(game, commit.sha)
    }
    return {
      game,
      status: "update",
      message: `更新完成，应用了 ${count} 个提交`,
      count,
      sha: latest,
      ...(messages.length ? { messages } : {})
    }
  }

  /**
   * 下载并铺开完整包
   *
   * 先解到临时目录再整体换上：中途失败时旧目录仍然可用，不会留下一个半装的元数据。
   * @param game 游戏
   * @param sha 目标版本
   * @throws 下载、解包或校验失败时
   */
  async #full(game: MetaGame, sha: string): Promise<void> {
    const target = this.dirOf(game)
    const work = `${target}.tmp-${Date.now()}`
    const zipPath = join(work, "meta.zip")

    this.#logger.mark(`[米游社][元数据] 正在下载 meta-${game} 完整包（约 ${PACK_MB[game]}MB，首次安装较慢）`)
    try {
      mkdirSync(work, { recursive: true })
      await this.#downloadWithProgress(`${ARCHIVE_URL}/meta-${game}.zip`, zipPath, game)

      const buf = readFileSync(zipPath)
      // 先只读中央目录判断有无包装目录，再解一次——完整包 165MB，解两遍代价太大
      const root = singleRoot(listEntries(buf).map(it => it.path))
      const files = unzip(buf, { strip: root ? 1 : 0, maxBytes: MAX_BYTES, filenames: this.#filenames(game) })
      const out = join(work, "meta")
      for (const it of files.files) this.#write(out, it.path, it.content)

      const chars = join(out, "character")
      if (!existsSync(chars) || readdirSync(chars).length === 0) {
        throw new Error(`meta-${game} 完整包校验失败：缺少 character 数据`)
      }

      // 在临时目录里先把别名表生成好，随后与其余文件一同换上——换上去的目录恒是完整的
      this.#buildAlias(out, game)

      rmSync(zipPath, { force: true })
      const backup = `${target}.old-${Date.now()}`
      const hasOld = existsSync(target)
      if (hasOld) renameSync(target, backup)
      try {
        mkdirSync(dirname(target), { recursive: true })
        renameSync(out, target)
      } catch (err) {
        if (hasOld && !existsSync(target)) renameSync(backup, target)
        throw err
      }
      rmSync(backup, { recursive: true, force: true })
      this.#writeSha(game, sha)
      this.#logger.info(`[米游社][元数据] meta-${game} 安装完成，共 ${files.files.length} 个文件，已跳过 ${files.skipped} 个非数据文件`)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }

  /**
   * 下载完整包并沿途报进度
   *
   * 内核的 `download` 没有进度回调，故隔几秒看一眼已写入字节数（先写 `.part` 再改名，两处取大的）。**超时到点才算失败、
   * 「疑似卡住」只提一句**：这一层看不到连接状态，据它掐断一个只是慢的下载会让慢线路上的使用者永远装不上，硬上限由超时把着。
   * @param url 归档地址
   * @param dest 落盘路径
   * @param game 游戏，仅用于日志
   */
  async #downloadWithProgress(url: string, dest: string, game: MetaGame): Promise<void> {
    const progress = new DownloadProgress({ at: Date.now() })
    const sizeOf = (path: string): number => {
      try {
        return statSync(path).size
      } catch {
        return 0
      }
    }
    const timer = setInterval(() => {
      const size = Math.max(sizeOf(`${dest}.part`), sizeOf(dest))
      const got = progress.tick(size, Date.now())
      if (got === "log") {
        this.#logger.mark(`[米游社][元数据] meta-${game} 已下载 ${(size / 1048576).toFixed(1)}MB...`)
      }
      if (got === "stall") {
        this.#logger.warn(`[米游社][元数据] meta-${game} 已有五分钟没有新数据，若一直如此请检查网络`)
      }
    }, PROGRESS_POLL)
    // 定时器不该拖住进程退出：插件卸载时在途下载会被内核的信号中止，而 finally 未必已执行
    timer.unref?.()
    try {
      await this.#http.download(url, dest, { timeout: "20m", retry: 1 })
    } finally {
      clearInterval(timer)
    }
  }

  /**
   * 应用一个增量包
   * @param game 游戏
   * @param commit 提交
   * @throws 下载、校验或解包失败时
   */
  async #incremental(game: MetaGame, commit: MetaCommit): Promise<void> {
    const target = this.dirOf(game)
    const url = (commit.assets?.path ?? "").trim()
    const short = commit.sha.slice(0, 8)

    if (url) {
      const buf = Buffer.from(await this.#http.buffer(url, { timeout: "5m", retry: 2 }))
      if (!verifyHash(buf, commit.assets?.hash_algo, commit.assets?.hash_value)) {
        throw new Error(`meta-${game} 增量包 ${short} 哈希校验失败`)
      }
      const paths = listEntries(buf).map(it => it.path)
      const match = incrementalMatch(paths, commit)
      // 一个改动文件都对不上：这个包与提交信息不是一回事，铺开只会把文件写到错误的位置
      if (!match) {
        throw new Error(`meta-${game} 增量包 ${short} 内容与提交信息不匹配，无法定位资源根目录`)
      }
      if (match.expected > 0 && match.hits < match.expected) {
        this.#logger.warn(
          `[米游社][元数据] meta-${game} 增量包 ${short} 只含 ${match.hits}/${match.expected} 个改动文件，可能不完整`
        )
      }
      const plan = unzip(buf, {
        strip: match.strip,
        maxBytes: MAX_BYTES,
        filenames: this.#filenames(game)
      })
      for (const it of plan.files) this.#write(target, it.path, it.content)
    }

    // 改名与删除只依提交信息处理，与包内容无关
    for (const file of commit.files ?? []) {
      if (file.status === "rename" && file.previous_filename && file.path) {
        const from = joinWithin(target, file.previous_filename)
        const to = joinWithin(target, file.path)
        if (existsSync(from) && !existsSync(to)) {
          mkdirSync(dirname(to), { recursive: true })
          renameSync(from, to)
        } else if (existsSync(from)) {
          rmSync(from, { recursive: true, force: true })
        }
        cleanupEmptyDirs(target, dirname(from))
      }
      if (file.status === "delete" && file.path) {
        const gone = joinWithin(target, file.path)
        rmSync(gone, { recursive: true, force: true })
        cleanupEmptyDirs(target, dirname(gone))
      }
    }
    // 每个增量都重建一次别名表，不判 `alias.js` 这次改没改：解析 10KB 是微秒级，而靠提交文件列表判改在改名情形下不可靠，
    // 判漏一次的后果是新角色别名一直查不到且没有任何迹象
    this.#buildAlias(target, game)
    this.#logger.debug(`[米游社][元数据] meta-${game} 已应用增量 ${short}`)
  }

  /**
   * 写一个文件，路径越界即抛错
   * @param base 基准目录
   * @param path 相对路径
   * @param content 内容
   */
  #write(base: string, path: string, content: Buffer): void {
    const full = joinWithin(base, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  /**
   * 记下本地版本
   * @param game 游戏
   * @param sha 提交号
   */
  #writeSha(game: MetaGame, sha: string): void {
    const dir = this.dirOf(game)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, ".sha"), sha, "utf8")
  }
}

/**
 * 判断增量包该剥掉几层路径，并顺带给出命中情况
 *
 * 不能只看「包内是否只有一个顶层目录」：一次只改 `character/` 下文件的提交，包内路径顶层都是 `character`，据此剥一层
 * 会把有意义的前缀削没。故拿提交文件清单比对、哪种剥法命中多用哪种。**一个都对不上时返回 undefined**：那说明包与提交
 * 信息不是一回事，硬铺开会把文件写到错误位置且此后每次启动都读到错的数据。
 * @param paths 包内路径列表
 * @param commit 提交信息
 * @returns 剥层数与命中数；一个都对不上时 undefined
 */
export function incrementalMatch(
  paths: readonly string[],
  commit: MetaCommit
): { strip: number; hits: number; expected: number } | undefined {
  const expected = (commit.files ?? [])
    .filter(it => it.path && it.status !== "delete")
    .map(it => it.path as string)
  if (!expected.length) return { strip: 0, hits: 0, expected: 0 }

  // 包内路径按 NFC/NFD 两种形态都比一次：带中文的路径在不同系统上归一化形态不同
  const has = (list: readonly string[], want: string): boolean =>
    list.some(it => it === want || it.normalize("NFC") === want.normalize("NFC"))
  const hits = (list: readonly string[]): number => expected.filter(it => has(list, it)).length

  const flat = hits(paths)
  if (flat === expected.length) return { strip: 0, hits: flat, expected: expected.length }
  const stripped = hits(paths.map(it => it.split("/").slice(1).join("/")))
  const best = Math.max(flat, stripped)
  if (best === 0) return undefined
  return { strip: stripped > flat ? 1 : 0, hits: best, expected: expected.length }
}

/**
 * 判断增量包该剥掉几层路径
 * @param paths 包内路径列表
 * @param commit 提交信息
 * @returns 该剥掉的层数，0 或 1；包与提交信息对不上时 undefined
 */
export function incrementalStrip(paths: readonly string[], commit: MetaCommit): number | undefined {
  return incrementalMatch(paths, commit)?.strip
}

/**
 * 删掉一路向上的空目录，直到基准目录为止
 *
 * 不做这一步的后果不是报错，而是元数据目录里逐渐堆积一批空的角色目录——空目录会被装载器跳过，
 * 但同时让「这个角色已被删掉」从磁盘上看不出来。
 * @param base 基准目录，绝不删它自己
 * @param from 从哪个目录开始向上删
 */
export function cleanupEmptyDirs(base: string, from: string): void {
  let dir = from
  while (dir !== base && dir.startsWith(base) && dir !== dirname(dir)) {
    try {
      if (readdirSync(dir).length > 0) break
      // 只能用 rmdirSync：rmSync 不带 recursive 时对目录直接抛错，会让整条清理链断在第一层
      rmdirSync(dir)
    } catch {
      break
    }
    dir = dirname(dir)
  }
}

/**
 * 取错误的可读说明
 * @param err 错误
 * @returns 说明文本
 */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 白名单在本模块中的再导出，便于调用方说明"装了什么、没装什么" */
export { META_EXTENSIONS }
