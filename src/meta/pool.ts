/**
 * 模块职责：卡池版本表 —— 判定一条抽卡记录属于哪个版本、其五星是否为当期 UP
 * 依赖方向：只读已装元数据里的卡池表（原神绝区零 `info/pool.js`、星铁 `info/index.js`，见 download 的 POOL_FILE）；不发请求、不碰内核
 * 生命周期：首次查询时按游戏读一次并常驻内存
 * 注意事项：**只有元数据这一处来源**（三个游戏的包都带卡池表、导出同形，只是星铁文件名叫 index.js），故硬依赖元数据装好——
 *          没装时卡池表为空，命令层据 {@link PoolTable.ready} 回「请先更新元数据」而非给出错的判定。那份 `.js`
 *          **只被解析、从不求值**。**末尾补一条「新版本」兜底**：新卡池已开而表未更新时，那几天记录否则落进
 *          「未知版本」、UP 判定全错；兜底那条 UP 名单为空，故判定答「无从判定」而非「歪」，见 {@link PoolTable.isUp}。
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseDataExport } from "./js-lit.js"
import { POOL_FILE } from "./download.js"
import type { GameKey } from "../core/region.js"

/** 有卡池版本表的游戏，即全部游戏 */
export type PoolGame = GameKey

/** 一个卡池版本 */
export interface PoolVersion {
  /** 版本号，如 `5.3` */
  version: string
  /** 上半 / 下半 */
  half: string
  /** 集录池的标题，仅集录池有 */
  title?: string
  /** 开始时间，形如 `2026-08-12 06:00:00` */
  from: string
  /** 结束时间 */
  to: string
  /** 当期 UP 五星角色 */
  char5?: string[]
  /** 当期 UP 四星角色 */
  char4?: string[]
  /** 当期 UP 五星武器 / 光锥 */
  weapon5?: string[]
  /** 当期 UP 四星武器 / 光锥 */
  weapon4?: string[]
}

/** 一个游戏的卡池表 */
interface PoolFile {
  /** 常规池（角色 / 武器活动祈愿） */
  pool?: PoolVersion[]
  /** 集录池 */
  mix?: PoolVersion[]
  /** 角色名 → 卡池名，如 `胡桃` → `赤团开时` */
  name?: Record<string, string>
}

/** 一个版本外加解析好的起止时刻，避免每次比较都重新 `new Date()` */
interface Span extends PoolVersion {
  /** 开始时刻的毫秒值 */
  start: number
  /** 结束时刻的毫秒值 */
  end: number
}

/** 兜底版本的结束时刻 —— 取足够远的将来，使新卡池开启后仍能落进某个版本 */
const FUTURE = "2099-12-31 23:59:59"

/**
 * 各游戏卡池表的导出名
 *
 * 三份的**字段形态一致**（version/half/from/to/char5…），只是导出名不同：**星铁那份带 `Sr` 后缀**
 * （`poolDetailSr`/`mixPoolDetailSr`/`poolNameSr`），原神与绝区零不带。名字判错的表现是解出空表、
 * {@link PoolTable.ready} 恒假、UP 判定一律「无从判定」，且不报错。
 */
const POOL_EXPORTS: Readonly<Record<PoolGame, { detail: string; mix: string; name: string }>> = {
  gs: { detail: "poolDetail", mix: "mixPoolDetail", name: "poolName" },
  sr: { detail: "poolDetailSr", mix: "mixPoolDetailSr", name: "poolNameSr" },
  zzz: { detail: "poolDetail", mix: "mixPoolDetail", name: "poolName" }
}

/**
 * 把 `2026-08-12 06:00:00` 解析成毫秒
 *
 * 该写法不带时区、`new Date()` 按本地时区解析；抽卡记录时间同为服务器本地字符串，口径相同可直接比较。
 * @param text 时间字符串
 * @returns 毫秒值；解析不出时为 0
 */
function parseTime(text: string): number {
  const ms = new Date(text.replace(/-/g, "/")).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * 版本表 → 带时刻的版本表，并在末尾补一条兜底
 * @param list 版本表
 * @returns 带时刻的版本表，顺序不变
 */
function toSpans(list: readonly PoolVersion[]): Span[] {
  const out = list.map(it => ({ ...it, start: parseTime(it.from), end: parseTime(it.to) }))
  const last = out[out.length - 1]
  if (last) {
    // 兜底版本从上一个版本结束处接上，UP 名单留空——名单不明时不判定为「歪」（见 isUp）
    out.push({
      version: "新版本",
      half: "?",
      from: last.to,
      to: FUTURE,
      start: last.end,
      end: parseTime(FUTURE)
    })
  }
  return out
}

/** 造卡池表需要的东西 */
export interface PoolTableOptions {
  /**
   * 元数据根目录，与安装器的 `dir` 一致
   *
   * **唯一来源**：三个游戏都从 `meta-<游戏>/info/pool.js` 读。装载失败时 {@link PoolTable.ready} 为假，
   * 命令层据此让使用者去更新元数据。
   */
  metaDir: string
}

/** 一次 UP 判定的结果 */
export type UpVerdict = "up" | "wai" | "unknown"

/**
 * 卡池版本表
 *
 * 一个实例管三个游戏，按游戏懒加载。
 */
export class PoolTable {
  readonly #metaDir: string
  readonly #cache = new Map<PoolGame, { pool: Span[]; mix: Span[]; name: Record<string, string> }>()

  /**
   * @param opts 选项
   */
  constructor(opts: PoolTableOptions) {
    this.#metaDir = opts.metaDir
  }

  /**
   * 丢掉已装载的缓存
   *
   * 元数据更新后调用：新一期卡池要即时认得出，否则那几天的记录一直落在兜底的「新版本」上。
   */
  reload(): void {
    this.#cache.clear()
  }

  /**
   * 装载一个游戏的卡池表
   * @param game 游戏
   * @returns 常规池、集录池与卡池名
   */
  #load(game: PoolGame): { pool: Span[]; mix: Span[]; name: Record<string, string> } {
    const cached = this.#cache.get(game)
    if (cached) return cached

    // 只从元数据读，读不到时空表、`ready` 随之为假（命令层据此让使用者更新元数据）
    const file = this.#readMeta(game) ?? {}
    const out = {
      pool: toSpans(file.pool ?? []),
      mix: toSpans(file.mix ?? []),
      name: file.name ?? {}
    }
    this.#cache.set(game, out)
    return out
  }

  /**
   * 读元数据里的卡池表
   *
   * 三个游戏同形（导出 `poolDetail`/`mixPoolDetail`/`poolName`），但**文件名按游戏取**（见 {@link POOL_FILE}）：
   * 星铁那份是 `info/index.js`、原神与绝区零是 `info/pool.js`。**三段导出都空时返回 undefined**：那时
   * {@link PoolTable.ready} 为假，命令层据此让使用者去更新元数据，而不是拿空表判 UP。
   * @param game 游戏
   * @returns 卡池表；文件不在或解不出内容时 undefined
   */
  #readMeta(game: PoolGame): PoolFile | undefined {
    if (!this.#metaDir) return undefined
    const file = join(this.#metaDir, `meta-${game}`, "info", POOL_FILE[game])
    if (!existsSync(file)) return undefined
    let src = ""
    try {
      src = readFileSync(file, "utf8")
    } catch {
      return undefined
    }
    const ex = POOL_EXPORTS[game]
    const pool = parseDataExport<PoolVersion[]>(src, ex.detail)
    const mix = parseDataExport<PoolVersion[]>(src, ex.mix)
    const name = parseDataExport<Record<string, string>>(src, ex.name)
    if (!pool?.length && !mix?.length) return undefined
    return { ...(pool ? { pool } : {}), ...(mix ? { mix } : {}), ...(name ? { name } : {}) }
  }

  /**
   * 查一条记录属于哪个版本
   * @param game 游戏
   * @param at 抽取时刻的毫秒值
   * @param mix 是否集录池
   * @returns 版本；查不到时 undefined
   */
  versionAt(game: PoolGame, at: number, mix = false): PoolVersion | undefined {
    const table = this.#load(game)
    // 两端都闭：表里上一版止于 17:59:59、下一版起于 18:00:00，开任一端都会让那一秒的抽卡落不进任何版本
    return (mix ? table.mix : table.pool).find(it => at >= it.start && at <= it.end)
  }

  /**
   * 判定一个五星是不是当期 UP
   *
   * 三态而非布尔：卡池表未覆盖该时段时答 `unknown`，命令层据此**不计入"歪"**——把「不知道」算成「歪了」
   * 会让新版本刚开的几天里每一发都显示为歪。
   * @param game 游戏
   * @param at 抽取时刻的毫秒值
   * @param name 物品名
   * @param isChar 是否角色（武器与角色的 UP 名单分开）
   * @param mix 是否集录池
   * @returns 判定结果
   */
  isUp(game: PoolGame, at: number, name: string, isChar: boolean, mix = false): UpVerdict {
    const version = this.versionAt(game, at, mix)
    if (!version) return "unknown"
    const list = isChar ? version.char5 : version.weapon5
    if (!list?.length) return "unknown"
    return list.includes(name) ? "up" : "wai"
  }

  /**
   * 取一个角色的卡池名，如 `胡桃` → `赤团开时`
   * @param game 游戏
   * @param name 角色名
   * @returns 卡池名；没有时 undefined
   */
  poolName(game: PoolGame, name: string): string | undefined {
    return this.#load(game).name[name]
  }

  /**
   * 取常规池的全部版本
   *
   * **不含末尾的兜底条目**（兜底的 UP 名单为空，混进复刻统计只会多出一个没有条目的版本）。
   * @param game 游戏
   * @returns 版本表，顺序同数据文件（旧的在前）
   */
  versions(game: PoolGame): PoolVersion[] {
    return this.#load(game).pool.slice(0, -1)
  }

  /**
   * 取集录池的全部版本，同样不含兜底条目
   * @param game 游戏
   * @returns 版本表
   */
  mixVersions(game: PoolGame): PoolVersion[] {
    return this.#load(game).mix.slice(0, -1)
  }

  /**
   * 卡池表是否可用
   * @param game 游戏
   * @returns 有版本条目时为真
   */
  ready(game: PoolGame): boolean {
    // 兜底那条不算，故要求长度大于 1
    return this.#load(game).pool.length > 1
  }
}
