/**
 * 模块职责：角色攻略图的索引与取图
 * 依赖方向：依赖 `ctx.http` / `ctx.kv` 与磁盘（数据目录下的攻略图缓存）；不碰元数据、不碰 Cookie
 * 生命周期：随插件 setup 造一个实例
 * 注意事项：索引按需取、不装资源包 —— 按角色现取那份 1KB 的索引 JSON 并缓存六小时。
 *          图的地址就写在索引里（绝对地址，多为米游社图床），本模块只负责下载与落盘缓存。
 *
 *          索引里的字段会成为文件名，故逐段过滤（见 {@link safeSegment}）：作者名与文章号
 *          来自远端 JSON，原样拼进路径等于把路径穿越的能力交给那份 JSON。
 *
 *          排序按字符串降序而非数字：排序键是 `[分档, 值]` 转成的 `"3,58871146"` 这样的串
 *          （见 {@link strategySortKey}），改成按数字不报错，只是先后顺序会变。
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { HttpClient, KvNamespace, Logger } from "@yunzai-ng/types"
import { safeSegment } from "../core/text.js"
import type { GameKey } from "../core/region.js"

/**
 * 有攻略索引的两个游戏
 *
 * 攻略图与索引来自第三方仓库，那里只有原神与星铁两份。从 {@link GameKey} 减而非 `MetaGame`：
 * 边界由那个第三方仓库有几份索引决定，与本仓库有没有该游戏的元数据包无关。
 */
export type StrategyGame = Exclude<GameKey, "zzz">
import { elemName } from "../meta/elem.js"

/** 攻略索引的缺省来源 —— 使用者自己维护的仓库，仓库名与分支名都是游戏名 */
export const DEFAULT_STRATEGY_HOST = "https://gitee.com/qsyhh_res"

/** 索引缓存时长 —— 攻略逐周增补，六小时足以跟上，也不至于每次查询都打一次远端 */
const INDEX_TTL = "6h"

/** 单次请求的等待上限 */
const TIMEOUT = "20s"

/** 单张攻略图的大小上限：攻略图是整页长图，两三兆常见，二十兆足以挡住异常响应 */
const MAX_BYTES = 20 * 1024 * 1024

/** 米游社文章地址前缀，索引里没有 `articleUrl` 时按文章号拼 */
const MYS_ARTICLE: Readonly<Record<StrategyGame, string>> = {
  gs: "https://www.miyoushe.com/ys/article/",
  sr: "https://www.miyoushe.com/sr/article/"
}

/** 文章号小于此值的视为发布较早，出图时带一句提醒 */
const EARLY_ARTICLE = 60000000

/** 认得的图片后缀，缓存文件名沿用地址里的那个，认不出按 png */
const IMG_EXT = /\.(png|jpe?g|webp|gif)(?:$|\?)/i

/** 索引里的一条攻略 */
export interface StrategyEntry {
  /** 攻略组（版主）名，缺它的条目一律跳过 —— 出图时要署名 */
  author?: string
  /** 米游社文章号，也可能是别处的短号（如微博的 `Nob8j5Vm5`） */
  article?: string
  /** 文章地址；缺省按 {@link MYS_ARTICLE} 与文章号拼 */
  articleUrl?: string
  /** 图片地址 */
  url?: string
  /** 更新标记，进缓存文件名 —— 攻略组改图后这一栏会变，于是自然重下 */
  update?: string
}

/** 一个角色的索引文件 */
export interface StrategyIndex {
  /** 攻略列表 */
  strategy?: StrategyEntry[]
}

/** `author.json` —— 全部攻略组，序号即 `#设置攻略` 里用的那个 */
export interface StrategyAuthors {
  /** 攻略组名，顺序即序号顺序 */
  strategy?: string[]
}

/** 缓存里的一份索引；`miss` 为真表示"取过且没有" */
interface CachedIndex {
  /** 取过且没有 */
  miss?: boolean
  /** 攻略列表 */
  list?: StrategyEntry[]
}

/** 造攻略服务需要的东西 */
export interface StrategyServiceOptions {
  /** 攻略图缓存目录，取 `join(ctx.dataDir, "strategy")` */
  dir: string
  /** HTTP 客户端 */
  http: HttpClient
  /** KV 命名空间，建议传 `ctx.kv.sub("strategy")` */
  kv: KvNamespace
  /** 日志器 */
  logger: Logger
  /** 取"是否允许取攻略"，每次现读，故开关改动无须重启 */
  enabled: () => boolean
  /** 取索引来源，每次现读；须与缺省源同一套路径形态 */
  host?: () => string
}

/**
 * 取一条攻略的排序键
 *
 * 键的形态是「分档在前、值在后，以逗号相连」，比较时按字符串而非数字（见文件头）。分档：
 * 纯数字文章号且大于 {@link EARLY_ARTICLE} 取 3（新攻略），非数字取 2（站外），其余取 1；
 * 调用方按此键降序排。
 * @param one 一条攻略
 * @returns 排序键
 */
export function strategySortKey(one: StrategyEntry): string {
  const article = String(one.article ?? "")
  if (!/^\d+$/.test(article)) return `2,${article}`
  const value = Number.parseInt(article, 10)
  return value > EARLY_ARTICLE ? `3,${value}` : `1,${value}`
}

/**
 * 按 {@link strategySortKey} 排序
 *
 * 降序，比较用裸的 `<` / `>`（UTF-16 码元序）而非 `localeCompare`（后者会把中文作者名排成另一个顺序）。
 * @param list 攻略列表
 * @returns 排好序的新数组
 */
export function sortStrategy(list: readonly StrategyEntry[]): StrategyEntry[] {
  return [...list].sort((a, b) => {
    const ka = strategySortKey(a)
    const kb = strategySortKey(b)
    return ka < kb ? 1 : ka > kb ? -1 : 0
  })
}

/**
 * 判一条攻略是否发布较早
 *
 * 只有"没有站外地址、且文章号是纯数字且小于 {@link EARLY_ARTICLE}"才算 —— 站外短号无从判断时间。
 * @param one 一条攻略
 * @returns 较早时为真
 */
export function isEarlyArticle(one: StrategyEntry): boolean {
  if (one.articleUrl) return false
  const value = Number.parseInt(String(one.article ?? ""), 10)
  return Number.isFinite(value) && value > 0 && value < EARLY_ARTICLE
}

/**
 * 取一条攻略的出处地址
 * @param one 一条攻略
 * @param game 游戏
 * @returns 地址；文章号也没有时为空串
 */
export function articleLink(one: StrategyEntry, game: StrategyGame): string {
  if (one.articleUrl) return one.articleUrl
  const article = String(one.article ?? "")
  return article ? `${MYS_ARTICLE[game]}${article}` : ""
}

/**
 * 取一条攻略的缓存文件名（不含后缀）
 *
 * 形如 `<作者>_<文章号>[_<更新标记>]`：更新标记在攻略组改图后会变，新图自然落到新文件名上。
 * @param one 一条攻略
 * @returns 文件名主体
 */
export function strategyFileName(one: StrategyEntry): string {
  const base = `${one.author ?? ""}_${one.article ?? ""}${one.update ? `_${one.update}` : ""}`
  return safeSegment(base)
}

/**
 * 取一条攻略图的后缀
 * @param url 图片地址
 * @returns 后缀，不带点；认不出时 png
 */
export function strategyImgExt(url: string): string {
  const got = IMG_EXT.exec(url)?.[1]?.toLowerCase()
  return got === "jpeg" ? "jpg" : (got ?? "png")
}

/**
 * 取索引所在的那一层目录名
 *
 * 原神按元素分目录（`火/胡桃.json`），星铁按命途分目录。原神的 `elem` 是键（`pyro`）要折算成
 * 中文，星铁的 `weapon` 本就是中文命途名。
 * @param game 游戏
 * @param elem 元素（原神为键，星铁为中文）
 * @param weapon 武器类型 / 命途
 * @returns 目录名；算不出时为空串
 */
export function strategyDirOf(game: StrategyGame, elem: string, weapon: string): string {
  return game === "gs" ? elemName(elem, "", "gs") : weapon
}

/**
 * 取索引文件的名字
 *
 * 旅行者与开拓者在索引里按元素 / 命途各有一份，但文件名一律是「旅行者」「开拓者」。
 * @param name 角色名
 * @param isMain 是否旅行者 / 开拓者
 * @param game 游戏
 * @returns 索引文件名，不含后缀
 */
export function strategyIndexName(name: string, isMain: boolean, game: StrategyGame): string {
  if (!isMain) return name
  return game === "gs" ? "旅行者" : "开拓者"
}

/**
 * 取图片缓存所在的那一层目录名
 *
 * 旅行者 / 开拓者带上元素或命途（`旅行者_火`），否则各元素的旅行者攻略会全落进同一目录、互相覆盖。
 * @param name 索引文件名（{@link strategyIndexName} 的返回）
 * @param dir 元素 / 命途目录名
 * @returns 缓存目录名
 */
export function strategyCacheDir(name: string, dir: string): string {
  return /旅行者|开拓者/.test(name) ? `${name}_${dir}` : name
}

/**
 * 攻略服务
 *
 * 三件事：取索引、记攻略组白名单、下载并缓存图。
 */
export class StrategyService {
  readonly #dir: string
  readonly #http: HttpClient
  readonly #kv: KvNamespace
  readonly #logger: Logger
  readonly #enabled: () => boolean
  readonly #host: () => string

  /**
   * @param opts 选项
   */
  constructor(opts: StrategyServiceOptions) {
    this.#dir = opts.dir
    this.#http = opts.http
    this.#kv = opts.kv
    this.#logger = opts.logger
    this.#enabled = opts.enabled
    this.#host = opts.host ?? ((): string => DEFAULT_STRATEGY_HOST)
  }

  /**
   * 是否允许取攻略
   * @returns 开着时为真
   */
  get on(): boolean {
    return this.#enabled()
  }

  /**
   * 取一份远端 JSON
   *
   * 按文本取再自行解析：gitee 的 raw 接口给的是 `text/plain`，按 json 取会因响应头而解析不出。
   * @param path 相对分支根的路径，各节须已编码
   * @param game 游戏
   * @returns 解析结果；请求或解析失败时 undefined
   */
  async #json<T>(game: StrategyGame, path: string): Promise<T | undefined> {
    const url = `${this.#host()}/${game}/raw/${game}/${path}`
    try {
      const text = await this.#http.get<string>(url, { timeout: TIMEOUT, responseType: "text" })
      return JSON.parse(text) as T
    } catch (err) {
      this.#logger.debug(`[米游社][攻略] 取 ${url} 失败：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  /**
   * 取一个角色的攻略列表
   *
   * 已按 {@link sortStrategy} 排好。取不到也缓存（缓存一个空壳），否则没有攻略的角色每次查询
   * 都要徒然等一次超时。
   *
   * `force` 跳过缓存现取；现取失败时仍用缓存里那份，不拿空壳把能用的索引冲掉。
   * @param game 游戏
   * @param dir 元素 / 命途目录名
   * @param name 索引文件名
   * @param force 为真时忽略缓存重取（`#胡桃更新攻略`）
   * @returns 攻略列表；开关关着或取不到时为空数组
   */
  async entries(game: StrategyGame, dir: string, name: string, force = false): Promise<StrategyEntry[]> {
    if (!this.#enabled() || !dir || !name) return []

    const key = `idx:${game}:${dir}:${name}`
    const cached = await this.#kv.get<CachedIndex>(key)
    if (cached && !force) return cached.miss ? [] : (cached.list ?? [])

    const got = await this.#json<StrategyIndex>(
      game,
      `${encodeURIComponent(dir)}/${encodeURIComponent(name)}.json`
    )
    const list = Array.isArray(got?.strategy) ? sortStrategy(got.strategy) : undefined
    if (!list?.length && cached?.list?.length) return cached.list
    await this.#kv.set<CachedIndex>(key, list?.length ? { list } : { miss: true }, { ttl: INDEX_TTL })
    return list ?? []
  }

  /**
   * 取全部攻略组
   *
   * 序号即 `#设置攻略` 里用的那个，故次序必须与远端一致。
   * @param game 游戏
   * @returns 攻略组名；开关关着或取不到时为空数组
   */
  async authors(game: StrategyGame): Promise<string[]> {
    if (!this.#enabled()) return []

    const key = `authors:${game}`
    const cached = await this.#kv.get<{ list?: string[]; miss?: boolean }>(key)
    if (cached) return cached.miss ? [] : (cached.list ?? [])

    const got = await this.#json<StrategyAuthors>(game, "author.json")
    const list = Array.isArray(got?.strategy) ? got.strategy.map(one => String(one)) : undefined
    await this.#kv.set(key, list?.length ? { list } : { miss: true }, { ttl: INDEX_TTL })
    return list ?? []
  }

  /**
   * 取当前选中的攻略组
   *
   * 空数组表示"全部"，即未设置过。键里不带 bot 账号：按游戏各存一份、由主人统一设置。
   * @param game 游戏
   * @returns 攻略组名；未设置时为空数组
   */
  async picked(game: StrategyGame): Promise<string[]> {
    const got = await this.#kv.get<string[]>(`pick:${game}`)
    return Array.isArray(got) ? got : []
  }

  /**
   * 设置选中的攻略组
   * @param game 游戏
   * @param names 攻略组名；空数组即恢复为"全部"
   */
  async pick(game: StrategyGame, names: readonly string[]): Promise<void> {
    if (!names.length) {
      await this.#kv.del(`pick:${game}`)
      return
    }
    await this.#kv.set<string[]>(`pick:${game}`, [...names])
  }

  /**
   * 下载并缓存一张攻略图
   *
   * 先写临时文件再改名：直接写目标名时中途失败会留下一个截断的文件，而此后 `existsSync`
   * 一律命中 —— 那张图从此永远是坏的且没有迹象。`force` 时重下覆盖，下载失败仍给旧图。
   * @param game 游戏
   * @param cacheDir 缓存目录名（{@link strategyCacheDir} 的返回）
   * @param one 一条攻略
   * @param force 为真时忽略磁盘缓存重下
   * @returns 图片的绝对路径；没有地址或下载失败（且没有旧图）时 undefined
   */
  async image(game: StrategyGame, cacheDir: string, one: StrategyEntry, force = false): Promise<string | undefined> {
    const url = String(one.url ?? "")
    const stem = strategyFileName(one)
    const sub = safeSegment(cacheDir)
    if (!url || !stem || !sub) return undefined

    const dir = join(this.#dir, game, sub)
    const file = join(dir, `${stem}.${strategyImgExt(url)}`)
    const old = existsSync(file) ? file : undefined
    if (old && !force) return old

    try {
      const bytes = await this.#http.buffer(url, { timeout: TIMEOUT })
      if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) {
        this.#logger.debug(`[米游社][攻略] ${stem} 的图大小异常（${bytes.byteLength} 字节），跳过`)
        return old
      }
      mkdirSync(dir, { recursive: true })
      const tmp = `${file}.tmp-${Date.now()}`
      writeFileSync(tmp, bytes)
      renameSync(tmp, file)
      this.#logger.debug(`[米游社][攻略] 已缓存 ${sub}/${stem}`)
      return file
    } catch (err) {
      this.#logger.debug(`[米游社][攻略] 下载 ${stem} 失败：${err instanceof Error ? err.message : String(err)}`)
      return old
    }
  }
}
