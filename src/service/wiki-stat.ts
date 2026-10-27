/**
 * 模块职责：图鉴页那四块统计的取数 —— 第三方统计站，**缺省不请求**
 * 依赖方向：依赖 `ctx.http` 与 `ctx.kv`；不依赖元数据、不碰 Cookie
 * 生命周期：随插件 setup 造一个实例
 * 注意事项：这是本插件唯一一处向米哈游之外的服务发请求的地方，故缺省关闭（`enableWikiStat`），
 *          关着时 {@link CharStatService.get} 直接返回 undefined。那四块只有这一个来源，
 *          官方接口不提供全服统计。
 *
 *          请求里只有角色名，不带 uid、Cookie 或使用者标识。本插件不向该站上传任何战绩与 uid。
 *
 *          结果缓存一小时（站方按天更新）；失败也缓存（缓存一个空壳），否则查不到的角色名会让
 *          每次查询都超时等一遍。
 *
 *          两家的响应形态不同：提瓦特小助手把角色包在 `result` 数组里，ArkApi 直接给 `data`，
 *          故 {@link pickStat} 两支都认。
 */
import type { HttpClient, KvNamespace, Logger } from "@yunzai-ng/types"
import type { CharStatRaw } from "../views/char-wiki.js"
import type { MetaGame } from "../meta/download.js"

/** 原神：微信小程序「提瓦特小助手」的接口 */
const GS_HOST = "https://api.lelaer.com/ys/getRoleAvg.php"

/** 星铁：ArkApi */
const SR_HOST = "https://ark.ivny.cn/stats"

/** 出场率排行的站点，与上面原神那条同一家，故沿用 `enableWikiStat` 那一个开关 */
const PCT_HOST = "https://api.lelaer.com/ys/"

/**
 * 两种玩法各自的路径
 *
 * `getAbyssRank.php` 是深渊、`getAbyssRank2.php` 是幽境危战。两条只差一个数字，取错不报错，
 * 只是印出另一个玩法的排行而标题仍写着这一个。
 */
const PCT_PATH = {
  abyss: "getAbyssRank.php",
  hard: "getAbyssRank2.php"
} as const

/** 出场率能查哪两种 */
export type AbyssPctMode = keyof typeof PCT_PATH

/** 缓存时长 —— 站方数据按天更新，一小时足以跟上 */
const CACHE_TTL = "1h"

/** 单次请求的等待上限 —— 第三方站点抖动时不该把整条命令拖住 */
const TIMEOUT = "10s"

/** 缓存里存的一份结果；`miss` 为真表示"查过且没查到" */
interface CachedStat {
  /** 查过且没查到 */
  miss?: boolean
  /** 统计数据 */
  data?: CharStatRaw
}

/** 出场率排行里的一位角色 */
export interface AbyssPctCharRaw {
  /** 角色名 */
  name?: string
  /**
   * 使用率，接口给的是不带百分号的数
   *
   * 口径是出场数 ÷ 持有该角色的记录数（非 ÷ 总记录数），故冷门角色的使用率也可以很高 ——
   * 图上那两句说明不能省，否则会被当成"出场率"读。
   */
  use_rate?: number | string
  /** 档位，形如 `s1` / `s` / `a` / `b` / `f` */
  rank_class?: string
}

/** 出场率接口的返回 */
export interface AbyssPctRaw {
  /** 返回码，200 即成功 */
  code?: number
  /** 标题 */
  title?: string
  /** 版本号 */
  version?: string
  /** 更新时间说明，形如 `更新时间：2026-09-08` */
  update?: string
  /** 上次更新 */
  last_update?: string
  /** 统计了多少份记录 */
  top_own?: number | string
  /** 站方自己的一句补充说明 */
  tips?: string
  /** 逐角色，接口按使用率倒序给 */
  has_list?: AbyssPctCharRaw[]
}

/** 缓存里存的一份出场率结果 */
interface CachedPct {
  /** 查过且没查到 */
  miss?: boolean
  /** 排行数据 */
  data?: AbyssPctRaw
}

/**
 * 从出场率响应里挑出正文
 *
 * `code` 必须是 200 才认：这一家在没有当期数据时也回 200 之外的码带一句说明，那时 `has_list`
 * 是空的 —— 不判就会出一张每档都空的图，看不出是"还没统计"还是"接口挂了"。
 * @param raw 响应体
 * @returns 排行；形态不认或一位角色都没有时 undefined
 */
export function pickPct(raw: unknown): AbyssPctRaw | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const body = raw as AbyssPctRaw
  if (Number(body.code) !== 200) return undefined
  return (body.has_list ?? []).length > 0 ? body : undefined
}

/** 造统计取数器需要的东西 */
export interface CharStatServiceOptions {
  /** HTTP 客户端 */
  http: HttpClient
  /** KV 命名空间，建议传入 `ctx.kv.sub("wikiStat")` */
  kv: KvNamespace
  /** 日志器 */
  logger: Logger
  /** 取"是否允许请求第三方统计"，每次现读，故开关改动无须重启 */
  enabled: () => boolean
}

/**
 * 从两家的响应里挑出角色统计
 *
 * 提瓦特小助手给 `{code, result:[...]}`，ArkApi 给 `{code, data:{...}}`。两边都可能返回一个
 * 没有 `role` 字段的空壳，故缺这一字段即视为没查到。
 * @param raw 响应体
 * @returns 统计数据；形态不认或没查到时 undefined
 */
export function pickStat(raw: unknown): CharStatRaw | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const body = raw as { result?: unknown; data?: unknown }

  const got = Array.isArray(body.result) ? body.result[0] : (body.data ?? body.result)
  if (typeof got !== "object" || got === null) return undefined
  const one = got as CharStatRaw
  return one.role ? one : undefined
}

/**
 * 图鉴统计取数器
 */
export class CharStatService {
  readonly #http: HttpClient
  readonly #kv: KvNamespace
  readonly #logger: Logger
  readonly #enabled: () => boolean

  /**
   * @param opts 选项
   */
  constructor(opts: CharStatServiceOptions) {
    this.#http = opts.http
    this.#kv = opts.kv
    this.#logger = opts.logger
    this.#enabled = opts.enabled
  }

  /**
   * 取一个角色的统计
   *
   * 开关关着时直接返回 undefined，不发请求。
   * @param game 游戏
   * @param name 角色全名
   * @returns 统计数据；关着、查不到或请求失败时 undefined
   */
  async get(game: MetaGame, name: string): Promise<CharStatRaw | undefined> {
    if (!this.#enabled() || !name) return undefined

    const key = `${game}:${name}`
    const cached = await this.#kv.get<CachedStat>(key)
    if (cached) return cached.miss ? undefined : cached.data

    try {
      const raw =
        game === "gs"
          ? await this.#http.get<unknown>(`${GS_HOST}?role=${encodeURIComponent(name)}&star=all`, {
              timeout: TIMEOUT
            })
          : await this.#http.get<unknown>(`${SR_HOST}/sr/${encodeURIComponent(name)}?style=miao`, {
              timeout: TIMEOUT
            })
      const got = pickStat(raw)
      // 查不到也记一笔：否则统计站没收录的角色会让每次查图鉴都徒然等一次超时
      await this.#kv.set<CachedStat>(key, got ? { data: got } : { miss: true }, { ttl: CACHE_TTL })
      return got
    } catch (err) {
      this.#logger.warn(
        `[米游社][图鉴] 第三方统计取数失败，图鉴少那四块但仍出图：${err instanceof Error ? err.message : String(err)}`
      )
      await this.#kv.set<CachedStat>(key, { miss: true }, { ttl: CACHE_TTL })
      return undefined
    }
  }

  /**
   * 取一份出场率排行
   *
   * 只有原神有：星铁那家（ArkApi）没有这一族接口，绝区零没有任何第三方统计站，故另两个
   * 游戏由命令层提前拦下。与 {@link get} 共用开关与缓存，缓存键另加 `pct:` 前缀。
   * @param mode 深渊或幽境危战
   * @returns 排行；关着、形态不认或请求失败时 undefined
   */
  async pct(mode: AbyssPctMode): Promise<AbyssPctRaw | undefined> {
    if (!this.#enabled()) return undefined

    const key = `pct:${mode}`
    const cached = await this.#kv.get<CachedPct>(key)
    if (cached) return cached.miss ? undefined : cached.data

    try {
      // `star=all` 与 `lang=zh-Hans` 是这条接口要的；请求里没有 uid、Cookie 或使用者标识
      const url = `${PCT_HOST}${PCT_PATH[mode]}?star=all&lang=zh-Hans`
      const raw = await this.#http.get<unknown>(url, { timeout: TIMEOUT })
      const got = pickPct(raw)
      await this.#kv.set<CachedPct>(key, got ? { data: got } : { miss: true }, { ttl: CACHE_TTL })
      return got
    } catch (err) {
      this.#logger.warn(
        `[米游社][出场率] 第三方统计取数失败：${err instanceof Error ? err.message : String(err)}`
      )
      await this.#kv.set<CachedPct>(key, { miss: true }, { ttl: CACHE_TTL })
      return undefined
    }
  }
}
