/**
 * 模块职责：米游社请求客户端 —— 组装签名与设备请求头、发请求、按 retcode 归类结果
 * 依赖方向：依赖内核的 `HttpClient` / `Logger` 契约与本插件的 device / ds / api / region
 * 生命周期：随插件 setup 创建一个实例；响应缓存由调用方注入（进程内 LRU 即可）
 * 注意事项：每次请求都要用同一台设备 —— 设备与 fp 一律经 `DeviceStore` 取，不在此处即时
 *          生成；即时生成一次等同于给该用户新增一台设备，而设备漂移是米游社的重点风控特征。
 *
 *          retcode 归类比"成功/失败"二分要紧：`-100` 是 Cookie 确已失效（应移出池），
 *          `1034` 是触发验证码（不得移出 CK，应换指纹重试）。两者都按失败处理，
 *          一次风控就会误伤一批有效 CK。**例外是带 `etoken` 的活动页接口**：它们的 `-100` 只是没登活动页，
 *          先登一次再请求，失败也不归 `cookie`（见 {@link MysClient.eventLogin}）。
 *
 *          失败返回带 `kind` 的结果对象而不抛异常：命令层要按类型给不同话术。
 */
import { createHash } from "node:crypto"
import type { DurationLike, HttpClient, Logger } from "@yunzai-ng/types"
import type { ApiData } from "./api.js"
import { buildApi, fpUrl } from "./api.js"
import { pickLtuid } from "./cookie.js"
import type { DeviceStore } from "./device.js"
import { deviceHeaders, deviceUserAgent, fpRequestBody } from "./device-profile.js"
import { saltFor, signDs } from "./ds.js"
import type { GameKey } from "./region.js"
import { getServer, isCnServer } from "./region.js"
import { traceStep } from "./trace.js"

/**
 * 幂等只读接口白名单，命中的接口走响应缓存
 *
 * 写操作（compute / useCdk）与身份类（getFp / UserGame）一律不缓存：前者会把使用者的操作
 * 吞掉，后者会让已失效的 Cookie 表现为仍然有效。
 */
const CACHEABLE_API: ReadonlySet<string> = new Set([
  "index",
  "spiralAbyss",
  "role_combat",
  "hard_challenge",
  "hard_challenge_popularity",
  "character",
  "characterDetail",
  "dailyNote",
  "detail",
  "ys_ledger",
  "act_calendar",
  "blueprint",
  "avatarSkill",
  "basicInfo",
  "deckList",
  "avatar_cardList",
  "action_cardList",
  "avatarInfo",
  "challengeStory",
  "challengeBoss",
  "challengePeak",
  "achievement",
  "chest",
  "rogue",
  "buddy",
  // 绝区零那一族战绩，与上面几条同为只读查询
  "challengeDeadly",
  "challengeHoloBoss",
  "climbingTower",
  "voidFrontAbstract",
  "voidFront",
  "hollowZero",
  "hollowZeroDetail",
  "hollowZeroS2",
  "exploration",
  "gacha_calendar",
  "activity_calendar"
])

/** 国服客户端标识 */
const CN_CLIENT = {
  appVersion: "2.40.1",
  clientType: "5",
  origin: "https://webstatic.mihoyo.com",
  referer: "https://webstatic.mihoyo.com/",
  requestedWith: "com.mihoyo.hyperion"
} as const

/** 国际服客户端标识 */
const OS_CLIENT = {
  appVersion: "2.55.0",
  clientType: "2",
  origin: "https://act.hoyolab.com",
  referer: "https://act.hoyolab.com/",
  requestedWith: "com.mihoyo.hoyolab"
} as const

/** 失败归类 */
export type MysFailKind =
  /** 网络层失败（超时、DNS、非 2xx） */
  | "http"
  /** Cookie 失效，应移出池 */
  | "cookie"
  /** 触发验证码或风控，**不得**变更 Cookie，应更换指纹后重试 */
  | "risk"
  /** 查询次数达上限 */
  | "limit"
  /** 使用者未公开数据 */
  | "private"
  /** uid 不存在或未参与过该游戏 */
  | "notfound"
  /** 该游戏不存在此接口 */
  | "unsupported"
  /** 其他 retcode */
  | "unknown"

/** 请求成功 */
export interface MysOk<T> {
  /** 成功标记 */
  ok: true
  /** 接口名 */
  api: string
  /** 接口数据（`res.data`） */
  data: T
  /** 是否来自响应缓存 */
  cached: boolean
}

/** 请求失败 */
export interface MysFail {
  /** 失败标记 */
  ok: false
  /** 接口名 */
  api: string
  /** 米游社 retcode；网络层失败时为 0 */
  retcode: number
  /** 原始提示，可直接向使用者展示 */
  message: string
  /** 失败归类，命令层依据它决定话术与是否移出 CK */
  kind: MysFailKind
}

/** 请求结果 */
export type MysResult<T> = MysOk<T> | MysFail

/**
 * retcode → 失败归类
 *
 * 只有 `-100` 归 `cookie`：`10001` / `10103`「请先登录」也是签名或请求头算错的表现（见 ds.ts），
 * 归进 `cookie` 则一次签错就把发起者名下覆盖该 uid 的好 CK 全部停用。它们落 `unknown`，原话带给使用者。
 */
const RETCODE_KIND: Readonly<Record<number, MysFailKind>> = {
  [-100]: "cookie",
  1034: "risk",
  5003: "risk",
  10035: "risk",
  10041: "risk",
  10101: "limit",
  10102: "private",
  10104: "private",
  1008: "notfound"
}

/** 活动页游戏级登录（官方 event-login SDK 的 `getInfoByAccount`） */
const EVENT_LOGIN_URL = "https://api-takumi.mihoyo.com/common/badge/v1/login/account"

/** 活动页登录态在进程内复用多久；服务端给的有效期更长，取短一些免得边界上撞过期 */
const ETOKEN_TTL = 30 * 60 * 1000

/**
 * 拆 Set-Cookie
 *
 * 多条 Set-Cookie 合进一个头时以逗号相连，而 `Expires=Wed, 21 Oct` 里也有逗号：只在逗号后紧跟 `名=` 时才算分条。
 * @param raw 响应头原文
 * @returns 名 → 值；值为空或 `deleted` 的不收
 */
export function parseSetCookie(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const one of raw.split(/,(?=\s*[\w-]+=)/)) {
    const pair = one.split(";")[0] ?? ""
    const at = pair.indexOf("=")
    if (at <= 0) continue
    const name = pair.slice(0, at).trim()
    const value = pair.slice(at + 1).trim()
    if (value && value !== "deleted") out[name] = value
  }
  return out
}

/**
 * 把新下发的 cookie 并进原 CK：同名的以新值为准，其余原样保留
 * @param cookie 原 CK
 * @param set 新下发的名 → 值
 * @returns 合并后的 Cookie 头
 */
export function mergeCookie(cookie: string, set: Readonly<Record<string, string>>): string {
  const kept = cookie
    .split(";")
    .map(one => one.trim())
    .filter(one => one !== "" && !Object.hasOwn(set, one.split("=")[0]?.trim() ?? ""))
  return [...kept, ...Object.entries(set).map(([k, v]) => `${k}=${v}`)].join("; ")
}

/**
 * 响应缓存的最小契约
 *
 * 只要三个方法，`ctx.cache<unknown>({ max, ttl })` 即可满足。不用 KV：响应缓存是秒级易失
 * 数据，写磁盘只是把 IO 开销挪到别处。
 */
export interface MysResponseCache {
  /**
   * 取缓存
   * @param key 键
   * @returns 值，未命中时 undefined
   */
  get(key: string): unknown
  /**
   * 写缓存
   * @param key 键
   * @param value 值
   */
  set(key: string, value: unknown): void
  /**
   * 删除缓存
   * @param key 键
   */
  delete(key: string): void
}

/** 客户端构造参数 */
export interface MysClientOptions {
  /** 内核提供的 HTTP 客户端 */
  http: HttpClient
  /** 日志器 */
  logger: Logger
  /** 设备存储，请求用的设备与指纹只能从这里取 */
  devices: DeviceStore
  /** 响应缓存，不传则不缓存 */
  cache?: MysResponseCache
  /** 单次请求超时，传函数可跟随配置变更 */
  timeout?: DurationLike | (() => DurationLike)
}

/** 单次请求的参数 */
export interface MysRequest {
  /** 游戏 uid */
  uid: string | number
  /** 米游社 Cookie */
  cookie: string
  /** 游戏，缺省原神 */
  game?: GameKey
  /** 账号标识；不传则从 Cookie 里取 */
  ltuid?: string
  /** 接口参数 */
  data?: ApiData
  /** 额外请求头，会覆盖同名默认值 */
  headers?: Record<string, string>
  /** 是否走响应缓存；不传则按接口白名单决定 */
  cache?: boolean
  /** 是否打请求日志，缺省打 */
  log?: boolean
}

/** 米游社返回的信封 */
interface MysEnvelope {
  /** 业务返回码，0 为成功 */
  retcode?: number
  /** 提示文本 */
  message?: string
  /** 业务数据 */
  data?: unknown
}

/**
 * 组装缓存键
 *
 * 必须带 game（三个游戏可能出现相同 uid）与 ltuid（一份返回是「用这条 CK 看这个 uid」的结果，
 * 不带则所有持有者共用一份缓存；选 CK 那层的隔离见 store/ck 的 `pick`，键本身也隔离）。
 * @param game 游戏
 * @param ltuid 本次所用的米游社账号
 * @param uid 游戏 uid
 * @param type 接口名
 * @param data 接口参数
 * @returns 缓存键
 */
function cacheKey(game: GameKey, ltuid: string, uid: string | number, type: string, data: ApiData): string {
  return createHash("md5").update(`${game}:${ltuid}:${uid}:${type}:${JSON.stringify(data)}`).digest("hex")
}

/** 米游社请求客户端 */
export class MysClient {
  /** HTTP 客户端 */
  private readonly http: HttpClient
  /** 日志器 */
  private readonly logger: Logger
  /** 设备存储 */
  private readonly devices: DeviceStore
  /** 响应缓存 */
  private readonly cache?: MysResponseCache
  /** 取当前超时配置 */
  private readonly timeout: () => DurationLike
  /** 活动页登录态，键为「biz:账号:uid」；进程内即可，重启后重登一次 */
  private readonly etokens = new Map<string, { set: Record<string, string>; until: number }>()

  /**
   * @param opts 构造参数
   */
  constructor(opts: MysClientOptions) {
    this.http = opts.http
    this.logger = opts.logger
    this.devices = opts.devices
    if (opts.cache) this.cache = opts.cache
    const timeout = opts.timeout ?? "15s"
    this.timeout = typeof timeout === "function" ? timeout : (): DurationLike => timeout
  }

  /**
   * 取账号标识 —— 设备、指纹、限额均挂载于其下
   *
   * Cookie 里没有 ltuid 时以游戏 uid 兜底而非随机生成：兜底值同样稳定，故"同一使用者
   * 始终对应同一台设备"在残缺 Cookie 下仍成立。
   * @param req 请求参数
   * @returns 账号标识
   */
  identity(req: MysRequest): string {
    return req.ltuid ?? pickLtuid(req.cookie) ?? `uid:${req.game ?? "gs"}:${req.uid}`
  }

  /**
   * 请求一个米游社接口
   *
   * 命中风控（`1034` 等）时会丢掉指纹、重取一次再重试一遍，但**绝不换设备**。
   * @param type 接口名，如 `dailyNote`
   * @param req 请求参数
   * @returns 结果对象，不抛错
   */
  async request<T = unknown>(type: string, req: MysRequest): Promise<MysResult<T>> {
    const game = req.game ?? "gs"
    const uid = String(req.uid)
    const server = getServer(uid, game)
    const data = req.data ?? {}
    const spec = buildApi(type, { uid, game, server }, data)
    if (!spec) {
      return { ok: false, api: type, retcode: 0, message: `${game} 没有 ${type} 接口`, kind: "unsupported" }
    }

    // ltuid 要在取缓存之前算：它是缓存键的一部分（见 cacheKey）
    const ltuid = this.identity(req)
    const useCache = (req.cache ?? CACHEABLE_API.has(type)) && !!this.cache
    const key = useCache ? cacheKey(game, ltuid, uid, type, data) : ""
    if (useCache) {
      const hit = this.cache?.get(key)
      if (hit !== undefined) {
        this.logger.debug(`[米游社][${type}][${uid}] 命中响应缓存`)
        traceStep({ kind: "mys", name: type, result: "缓存", ms: 0 })
        return { ok: true, api: type, data: hit as T, cached: true }
      }
    }

    const cn = isCnServer(server)
    // {@link ApiSpec.tail} 那一段只拼进 URL、不进 DS，故发出去的 query 与签名覆盖的不同
    const sent = [spec.query, spec.tail].filter(one => !!one).join("&")
    const url = sent ? `${spec.url}?${sent}` : spec.url
    const body = spec.body ? JSON.stringify(spec.body) : ""

    const go = async (): Promise<MysResult<T>> => {
      if (!spec.etoken) return await this.send<T>(type, { url, body, query: spec.query ?? "", cn, ltuid, req })
      const login = await this.eventLogin(spec.etoken, uid, server, req.cookie, ltuid)
      if (!login.ok) return { ...login, api: type }
      const res = await this.send<T>(type, { url, body, query: spec.query ?? "", cn, ltuid, req: { ...req, cookie: login.cookie } })
      // 带了 etoken 仍回 -100：登录态过期或被顶掉，丢缓存重登一次；再不行只报错、**不判 CK 失效**
      if (res.ok || res.retcode !== -100) return res
      this.etokens.delete(`${spec.etoken}:${ltuid}:${uid}`)
      const again = await this.eventLogin(spec.etoken, uid, server, req.cookie, ltuid)
      if (!again.ok) return { ...again, api: type }
      const retry = await this.send<T>(type, { url, body, query: spec.query ?? "", cn, ltuid, req: { ...req, cookie: again.cookie } })
      return retry.ok || retry.retcode !== -100 ? retry : { ...retry, kind: "unknown", message: "活动页登录态取不到，请稍后再试或发送「#刷新ck」" }
    }

    let first = await go()
    // 风控仅更换指纹后重试一次：设备为已养成的资产，丢弃后须重新计时一日
    if (!first.ok && first.kind === "risk") {
      this.logger.warn(`[米游社][${type}] retcode ${first.retcode}，换 device_fp 重试一次`)
      await this.devices.dropFp(ltuid)
      await this.fetchFp(ltuid, cn)
      first = await go()
    }

    if (first.ok && useCache) this.cache?.set(key, first.data)
    return first
  }

  /**
   * 活动页的游戏级登录：凭通行证 CK 换一枚该游戏的登录 cookie，并到原 CK 上
   *
   * 照官方页 account SDK 的 `uidLogin`：POST `common/badge/v1/login/account`（`game_biz` / `lang` / `region` / `uid`），
   * 服务端以 Set-Cookie 下发登录态。按「游戏 + 账号 + uid」进程内缓存一段时间，过期或被拒时由调用方丢掉重取。
   * **这一步失败一律归 `unknown`**：活动页登录与 CK 是否有效不是一回事，判成 `cookie` 会把好端端的 CK 停掉。
   * @param biz 游戏 biz，如 `nap_cn`
   * @param uid 游戏 uid
   * @param region 区服
   * @param cookie 通行证 CK
   * @param ltuid 账号标识，作缓存键
   * @returns 合并后的 cookie，或失败原因
   */
  private async eventLogin(
    biz: string,
    uid: string,
    region: string,
    cookie: string,
    ltuid: string
  ): Promise<{ ok: true; cookie: string } | MysFail> {
    const key = `${biz}:${ltuid}:${uid}`
    const hit = this.etokens.get(key)
    if (hit && hit.until > Date.now()) return { ok: true, cookie: mergeCookie(cookie, hit.set) }
    const started = Date.now()
    try {
      const res = await this.http.request<MysEnvelope>(EVENT_LOGIN_URL, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://act.mihoyo.com", Referer: "https://act.mihoyo.com/" },
        body: JSON.stringify({ game_biz: biz, lang: "zh-cn", region, uid }),
        timeout: this.timeout(),
        responseType: "json",
        throwOnError: false
      })
      const set = parseSetCookie(res.headers["set-cookie"] ?? "")
      const retcode = res.data?.retcode ?? 0
      traceStep({ kind: "mys", name: "eventLogin", result: res.ok ? `retcode ${retcode}` : `HTTP ${res.status}`, ms: Date.now() - started })
      if (!res.ok || retcode !== 0 || !Object.keys(set).length) {
        const message = res.data?.message || `HTTP ${res.status}`
        this.logger.warn(`[米游社][eventLogin][${uid}] ${biz} 活动页登录失败：retcode ${retcode} ${message}`)
        return { ok: false, api: "eventLogin", retcode, message: `活动页登录失败：${message}`, kind: "unknown" }
      }
      this.etokens.set(key, { set, until: Date.now() + ETOKEN_TTL })
      this.logger.debug(`[米游社][eventLogin][${uid}] ${biz} 取得登录态 ${Object.keys(set).join(",")}`)
      return { ok: true, cookie: mergeCookie(cookie, set) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, api: "eventLogin", retcode: 0, message, kind: "http" }
    }
  }

  /**
   * 取 device_fp，没有就向米游社申请一个并存下
   *
   * 只管"取"，不管"是否应更换" —— 后者由 `DeviceStore` 按 device_id 与有效期判定。
   * @param ltuid 账号标识
   * @param cn 是否国服
   * @returns fp；申请失败时 undefined
   */
  async fetchFp(ltuid: string, cn: boolean): Promise<string | undefined> {
    const device = await this.devices.use(ltuid)
    const previous = await this.devices.fp(ltuid)
    const body = fpRequestBody(device, cn ? "cn" : "os", previous)
    try {
      const res = await this.http.request<MysEnvelope>(fpUrl(cn), {
        method: "POST",
        headers: {
          "User-Agent": deviceUserAgent(device, cn ? CN_CLIENT.appVersion : OS_CLIENT.appVersion, cn ? "cn" : "os"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        timeout: this.timeout(),
        responseType: "json",
        throwOnError: false
      })
      const fp = (res.data?.data as { device_fp?: string } | undefined)?.device_fp
      if (!res.ok || !fp) {
        this.logger.warn(`[米游社][getFp] 申请指纹失败：${res.status} ${res.data?.message ?? ""}`)
        return undefined
      }
      await this.devices.saveFp(ltuid, fp, device.id)
      this.logger.debug(`[米游社][getFp] 取得新指纹，设备 ${device.spec.model}`)
      return fp
    } catch (err) {
      this.logger.warn(`[米游社][getFp] 申请指纹出错：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  /**
   * 真正发一次请求
   * @param type 接口名
   * @param o 发送参数
   * @returns 结果对象
   */
  private async send<T>(
    type: string,
    o: { url: string; body: string; query: string; cn: boolean; ltuid: string; req: MysRequest }
  ): Promise<MysResult<T>> {
    const device = await this.devices.use(o.ltuid)
    const fp = (await this.devices.fp(o.ltuid)) ?? (await this.fetchFp(o.ltuid, o.cn))
    const client = o.cn ? CN_CLIENT : OS_CLIENT
    const headers: Record<string, string> = {
      ...deviceHeaders(device, fp),
      "x-rpc-app_version": client.appVersion,
      "x-rpc-client_type": client.clientType,
      "x-requested-with": client.requestedWith,
      "User-Agent": deviceUserAgent(device, client.appVersion, o.cn ? "cn" : "os"),
      Origin: client.origin,
      Referer: client.referer,
      DS: signDs({ query: o.query, body: o.body, salt: saltFor(o.cn) }),
      Cookie: o.req.cookie
    }
    if (o.body) headers["Content-Type"] = "application/json"
    if (o.req.headers) Object.assign(headers, o.req.headers)

    const started = Date.now()
    try {
      const res = await this.http.request<MysEnvelope>(o.url, {
        method: o.body ? "POST" : "GET",
        headers,
        ...(o.body ? { body: o.body } : {}),
        timeout: this.timeout(),
        responseType: "json",
        throwOnError: false
      })
      const ms = Date.now() - started
      const out: MysResult<T> = res.ok
        ? this.classify<T>(type, res.data)
        : { ok: false, api: type, retcode: 0, message: `HTTP ${res.status} ${res.statusText}`, kind: "http" }
      const result = out.ok ? "ok" : out.retcode ? `retcode ${out.retcode}` : `HTTP ${res.status}`
      traceStep({ kind: "mys", name: type, result, ms })
      if (o.req.log !== false) {
        const tail = out.ok ? "" : ` ${out.kind}：${out.message}`
        this.logger.debug(`[米游社][${type}][${o.req.uid}] ${result} ${ms}ms${tail}`)
      }
      return out
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      traceStep({ kind: "mys", name: type, result: "失败", ms: Date.now() - started })
      this.logger.error(`[米游社][${type}][${o.req.uid}] 请求失败：${message}`)
      return { ok: false, api: type, retcode: 0, message, kind: "http" }
    }
  }

  /**
   * 按 retcode 归类返回值
   *
   * 没有 retcode 字段的响应视为成功并原样返回：少数接口（如兑换码站点）不守米游社的信封格式。
   * @param type 接口名
   * @param envelope 米游社返回体
   * @returns 结果对象
   */
  private classify<T>(type: string, envelope: MysEnvelope | undefined): MysResult<T> {
    if (!envelope || typeof envelope !== "object") {
      return { ok: false, api: type, retcode: 0, message: "接口没有返回内容", kind: "http" }
    }
    const retcode = envelope.retcode
    if (retcode === undefined) return { ok: true, api: type, data: envelope as T, cached: false }
    if (retcode === 0) return { ok: true, api: type, data: envelope.data as T, cached: false }
    return {
      ok: false,
      api: type,
      retcode,
      message: envelope.message ?? `retcode ${retcode}`,
      kind: RETCODE_KIND[retcode] ?? "unknown"
    }
  }
}
