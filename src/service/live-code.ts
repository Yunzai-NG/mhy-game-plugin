/**
 * 模块职责：前瞻直播兑换码 —— 取官方直播间当期发的那几个兑换码
 * 依赖方向：依赖 @yunzai-ng/types 的 HttpClient 与 Logger；不碰凭据、不碰设备
 * 生命周期：长驻，自带一份短缓存
 * 注意事项：这一族接口一个凭据都不要，三条全是公开静态地址，不占任何 CK 的用量。
 *
 *          `act_id` 每个版本都变，且只能从社区首页反查：官方没有"当期前瞻活动 id"这条接口，
 *          故拉一次社区首页导航栏、按「前瞻直播」这类字样找到那一项、从跳转地址里抠 `act_id=`。
 *          写死一个 id 的后果不是报错而是永远返回上一个版本的码（早已失效）。
 *
 *          三个游戏只差一个 `gids`，后两条接口三个游戏共用、由 `act_id` 区分是哪个游戏。
 *          三个码全给出来（官方每场发三个）。
 *
 *          缓存十分钟：这几个码会随开播进度陆续放出（`code` 先是空串），缓存太久会让人在码
 *          已放出之后仍看到"还没有"。
 */
import type { HttpClient, Logger } from "@yunzai-ng/types"
import type { GameKey } from "../core/region.js"

/** 社区首页，用来反查当期前瞻活动的 id */
const HUB_HOST = "https://bbs-api.miyoushe.com/apihub/api/home/new"

/** 直播场次信息 */
const INDEX_URL = "https://api-takumi.mihoyo.com/event/miyolive/index"

/** 兑换码本体 */
const CODE_URL = "https://api-takumi-static.mihoyo.com/event/miyolive/refreshCode"

/** 各游戏在社区里的版块号 */
const GIDS: Readonly<Record<GameKey, number>> = { gs: 2, sr: 6, zzz: 8 }

/** 认作"这是前瞻直播那一项"的字样，先专后泛 */
const LIVE_WORDS = ["前瞻直播", "兑换码", "前瞻", "直播"] as const

/** 缓存有效期 */
const TTL_MS = 10 * 60 * 1000

/** 接口返回的统一外壳 */
interface Envelope<T> {
  /** 返回码 */
  retcode?: number
  /** 提示 */
  message?: string
  /** 数据 */
  data?: T | null
}

/** 社区首页里的一项导航 */
interface HubNav {
  /** 名称 */
  name?: string
  /** 跳转地址，`act_id` 就在它的 query 里 */
  app_path?: string
}

/** 直播场次 */
interface LiveRaw {
  /** 取兑换码要用的版本号 */
  code_ver?: string
  /** 标题，形如「3.4版本前瞻特别直播」 */
  title?: string
  /** 是否已结束 */
  is_end?: boolean
  /** 开播时刻，形如 `2026-09-12 19:00:00`（东八区） */
  start?: string
}

/** 一个兑换码 */
export interface LiveCode {
  /** 这个码给什么，官方原文里带 HTML 标记，此处已剥掉 */
  items: string
  /** 码本体；直播还没放出这一个时为空串 */
  code: string
}

/** 一次查询的结果 */
export type LiveCodeResult =
  | {
      /** 成功 */
      ok: true
      /** 直播标题 */
      title: string
      /** 兑换码，可能有尚未放出的（`code` 为空串） */
      codes: LiveCode[]
      /** 直播还没开始时给出开播时刻，已开播或已结束时为空串 */
      startAt: string
    }
  | {
      /** 失败 */
      ok: false
      /** 可直接展示的原因 */
      message: string
    }

/** 构造参数 */
export interface LiveCodeOptions {
  /** HTTP 客户端 */
  http: HttpClient
  /** 日志器 */
  logger: Logger
  /** 当前时间，测试注入 */
  now?: () => number
}

/** 缓存的一项 */
interface Cached {
  /** 结果 */
  value: LiveCodeResult
  /** 存入时刻 */
  at: number
}

/** 前瞻直播兑换码服务 */
export class LiveCodeService {
  readonly #http: HttpClient
  readonly #logger: Logger
  readonly #now: () => number
  readonly #cache = new Map<GameKey, Cached>()

  /**
   * @param opts 构造参数
   */
  constructor(opts: LiveCodeOptions) {
    this.#http = opts.http
    this.#logger = opts.logger
    this.#now = opts.now ?? ((): number => Date.now())
  }

  /**
   * 发一个请求并取回信封
   * @param url 地址
   * @param actId 活动 id，随请求头带上；不需要时给空串
   * @returns 信封；网络层失败时 undefined
   */
  async #call<T>(url: string, actId = ""): Promise<Envelope<T> | undefined> {
    try {
      const res = await this.#http.request<Envelope<T>>(url, {
        method: "GET",
        headers: { "x-rpc-act_id": actId, "User-Agent": "okhttp/4.8.0" }
      })
      if (res.status !== 200) {
        this.#logger.warn(`[米游社][前瞻兑换码] HTTP ${res.status}`)
        return undefined
      }
      return res.data
    } catch (err) {
      this.#logger.warn(`[米游社][前瞻兑换码] 请求失败：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  /**
   * 反查当期前瞻活动的 id
   *
   * 见文件头：官方没有直接给这一项的接口，只能从社区首页的导航栏里认。
   * @param game 游戏
   * @returns 活动 id；找不到时空串
   */
  async #actId(game: GameKey): Promise<string> {
    const url = `${HUB_HOST}?gids=${GIDS[game]}&parts=1%2C3%2C4&device=OnePlus%20IN2025&cpu=placeholder&version=3`
    const res = await this.#call<{ navigator?: HubNav[] }>(url)
    if (res?.retcode !== 0) return ""

    for (const nav of res.data?.navigator ?? []) {
      const name = nav?.name ?? ""
      if (!name || !LIVE_WORDS.some(word => name.includes(word))) continue
      // 地址形如 `…?act_id=xxx&…`，末尾那个 `&` 即取值的右边界
      const got = /act_id=(.*?)&/.exec(nav.app_path ?? "")
      if (got?.[1]) return got[1]
    }
    return ""
  }

  /**
   * 取直播场次
   * @param actId 活动 id
   * @returns 场次；取不到时 undefined
   */
  async #live(actId: string): Promise<LiveRaw | undefined> {
    const res = await this.#call<{ live?: LiveRaw }>(INDEX_URL, actId)
    if (res?.retcode !== 0) return undefined
    return res.data?.live
  }

  /**
   * 取兑换码
   * @param version 场次给的 `code_ver`
   * @param actId 活动 id
   * @returns 兑换码；取不到时 undefined
   */
  async #codes(version: string, actId: string): Promise<LiveCode[] | undefined> {
    const url = `${CODE_URL}?version=${encodeURIComponent(version)}&time=${Math.floor(this.#now() / 1000)}`
    const res = await this.#call<{ code_list?: { title?: string; code?: string }[] }>(url, actId)
    if (res?.retcode !== 0) return undefined
    return (res.data?.code_list ?? []).map(one => ({
      // 官方标题里带 `<span>` 一类标记，原样印会把标签当文字显示出来
      items: (one.title ?? "").replace(/<.*?>/g, "").trim(),
      code: (one.code ?? "").trim()
    }))
  }

  /**
   * 查一个游戏当期前瞻直播的兑换码
   * @param game 游戏
   * @returns 结果
   */
  async codes(game: GameKey): Promise<LiveCodeResult> {
    const hit = this.#cache.get(game)
    if (hit && this.#now() - hit.at < TTL_MS) return hit.value

    const value = await this.#fetch(game)
    // 失败也缓存：这几条接口在没有前瞻直播的日子里恒返回"找不到活动"，那是常态而非故障
    this.#cache.set(game, { value, at: this.#now() })
    return value
  }

  /**
   * 真正去取一次
   * @param game 游戏
   * @returns 结果
   */
  async #fetch(game: GameKey): Promise<LiveCodeResult> {
    const actId = await this.#actId(game)
    if (!actId) return { ok: false, message: "眼下没有正在进行的前瞻直播活动" }

    const live = await this.#live(actId)
    if (!live?.code_ver) return { ok: false, message: "取不到前瞻直播的场次信息，请稍后重试" }

    const codes = await this.#codes(live.code_ver, actId)
    if (!codes || codes.length === 0) return { ok: false, message: "这场直播还没有放出兑换码" }

    return {
      ok: true,
      // 标题里那四个字对每一场都一样，去掉之后剩下的才是"哪个版本"
      title: (live.title ?? "").replace("特别直播", "").trim() || "前瞻直播",
      codes,
      startAt: this.#startAt(live)
    }
  }

  /**
   * 算"还没开播"时要印的开播时刻
   *
   * `start` 是东八区的挂钟时间且不带时区，直接 `new Date()` 会按运行机器的时区解析，
   * 部署在别的时区上会把"已开播"判成"还没开播"，故显式补上 `GMT+0800`。
   * @param live 场次
   * @returns 开播时刻；已开播或已结束时空串
   */
  #startAt(live: LiveRaw): string {
    if (live.is_end || !live.start) return ""
    const start = new Date(`${live.start} GMT+0800`).getTime()
    if (!Number.isFinite(start)) return ""
    return this.#now() < start ? live.start : ""
  }
}
