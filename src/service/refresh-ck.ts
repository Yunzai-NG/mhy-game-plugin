/**
 * 模块职责：凭 stoken 换一份新的查询 Cookie —— `#刷新ck` 那一条命令的服务层
 * 依赖方向：依赖 core/pass-api（换 token 的两条接口）、core/cookie（解析）、store/ck（落库）
 * 生命周期：无状态服务，构造一次长期持有
 * 注意事项：这一条会代替使用者取得新凭据，属高风险动作，三条硬约束：
 *
 *          只动使用者自己名下的凭据（`cookies.owned`）：别人名下的一概不碰。
 *
 *          没有 stoken 的那些直接跳过、不报错：`#绑定CK` 绑进来的只有 ltoken 与 cookie_token，
 *          换不出新 token，算作失败会让"一半能刷、一半不能"看着像坏了。
 *
 *          同一个通行证只刷一次：`cookies.owned` 按 ltuid 存本就不重复，但 stoken 里的 `stuid`
 *          与 ltuid 在极少数旧数据上不一致，故仍按 stuid 再去重一次 —— 重复请求同一账号正是
 *          触发风控的形态。
 *
 *          失败与成功都不写日志原文：这一族的返回里带 token，只记 retcode 与遮蔽后的 id。
 */
import type { HttpClient, Logger } from "@yunzai-ng/types"
import { parseCookie } from "../core/cookie.js"
import type { DeviceStore } from "../core/device.js"
import type { PassDevice, PassRequest } from "../core/pass-api.js"
import { cookieTokenRequest, ltokenRequest } from "../core/pass-api.js"
import type { CookiePool } from "../store/ck.js"

/** 取不到 device_fp 时的占位值，通行证接口只校验这一项存在 */
const FALLBACK_FP = "38d7ee0e96649"

/** 两个账号之间的间隔，避免同一份凭据连着发多个已鉴权请求 */
const GAP_MS = 1500

/** 接口返回的统一外壳 */
interface Envelope<T> {
  /** 返回码 */
  retcode?: number
  /** 提示 */
  message?: string
  /** 数据 */
  data?: T | null
}

/** 一个账号的刷新结果 */
export interface RefreshOne {
  /** 通行证 id */
  ltuid: string
  /** 这个账号名下的 uid，用于在回复里指认是哪一个 */
  uids: string[]
  /** 结果 */
  state: "ok" | "noStoken" | "fail"
  /** 失败原因，仅 `fail` 时有 */
  message?: string
}

/** 整次刷新的结果 */
export interface RefreshResult {
  /** 逐账号的结果，顺序与库里一致 */
  items: RefreshOne[]
  /** 成功几个 */
  ok: number
  /** 因没有 stoken 而跳过几个 */
  skipped: number
  /** 失败几个 */
  failed: number
}

/** 构造参数 */
export interface RefreshCkOptions {
  /** HTTP 客户端 */
  http: HttpClient
  /** 日志器 */
  logger: Logger
  /** 设备库 */
  devices: DeviceStore
  /** 凭据池 */
  cookies: CookiePool
  /** 间隔注入，测试用 */
  gap?: (ms: number) => number
}

/**
 * 遮蔽通行证 id
 * @param id 通行证 id
 * @returns 遮蔽后的串
 */
function mask(id: string): string {
  return id.length <= 4 ? "****" : `${id.slice(0, 3)}****${id.slice(-2)}`
}

/**
 * 等待指定时长
 * @param ms 毫秒，取值为 0 或负数时直接返回
 * @returns 等待完成
 */
async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise<void>(resolve => setTimeout(resolve, ms))
}

/** 凭 stoken 刷新查询 Cookie */
export class RefreshCkService {
  readonly #http: HttpClient
  readonly #logger: Logger
  readonly #devices: DeviceStore
  readonly #cookies: CookiePool
  readonly #gap: (ms: number) => number

  /**
   * @param opts 构造参数
   */
  constructor(opts: RefreshCkOptions) {
    this.#http = opts.http
    this.#logger = opts.logger
    this.#devices = opts.devices
    this.#cookies = opts.cookies
    this.#gap = opts.gap ?? ((ms: number): number => ms)
  }

  /**
   * 取这次请求用的设备
   *
   * 与查询用同一台：换 token 与随后拿它查询若来自两台设备，正是米游社的重点风控特征。
   * @param ltuid 通行证 id
   * @returns 通行证接口要的设备形态
   */
  async #device(ltuid: string): Promise<PassDevice> {
    const one = await this.#devices.use(ltuid)
    return {
      id: one.id,
      name: one.name,
      model: one.spec.model,
      fp: (await this.#devices.fp(ltuid)) ?? FALLBACK_FP
    }
  }

  /**
   * 发一个通行证请求
   * @param req 请求
   * @returns 返回体；网络层失败时 undefined
   */
  async #call<T>(req: PassRequest): Promise<Envelope<T> | undefined> {
    try {
      const res = await this.#http.request<Envelope<T>>(req.url, {
        method: req.method,
        headers: req.headers,
        responseType: "json"
      })
      if (res.status !== 200) {
        this.#logger.warn(`[米游社][刷新ck] HTTP ${res.status}`)
        return undefined
      }
      return res.data
    } catch (err) {
      this.#logger.warn(`[米游社][刷新ck] 请求失败：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  /**
   * 刷新一个账号
   * @param ltuid 通行证 id
   * @param stokenPart 库里存的那段 stoken 片段
   * @returns 新的查询 Cookie；换不到时 undefined 与原因
   */
  async #one(ltuid: string, stokenPart: string): Promise<{ cookie?: string; message?: string }> {
    const parsed = parseCookie(stokenPart)
    const stoken = parsed.get("stoken")
    // stuid 优先取片段里那个：极少数旧数据上它与 ltuid 不一致，而接口认的是它
    const stuid = parsed.get("stuid") ?? ltuid
    const mid = parsed.get("mid")
    if (!stoken) return { message: "库里那段 stoken 认不出来，请重新「#扫码登录」" }

    const parts = { stuid, stoken, ...(mid ? { mid } : {}) }
    const device = await this.#device(ltuid)

    const lt = await this.#call<{ ltoken?: string; token?: { token?: string } }>(ltokenRequest(device, parts))
    const ltoken = lt?.data?.ltoken ?? lt?.data?.token?.token

    const ck = await this.#call<{ cookie_token?: string }>(cookieTokenRequest(parts))
    const cookieToken = ck?.data?.cookie_token

    if (!ltoken || !cookieToken) {
      this.#logger.warn(
        `[米游社][刷新ck] ${mask(ltuid)} 换凭据失败 ltoken=${ltoken ? "有" : "无"} ` +
          `cookie_token retcode=${ck?.retcode ?? "无回应"}`
      )
      // `-100` 与 `10001` 都是 stoken 自己也过期了，唯一出路是重新扫码，故直接说出来
      const code = ck?.retcode ?? lt?.retcode
      if (code === -100 || code === 10_001) {
        return { message: "stoken 也已失效，请重新「#扫码登录」" }
      }
      return { message: ck?.message || lt?.message || "米游社没有给出新的 Cookie，请稍后重试" }
    }

    return { cookie: `ltoken=${ltoken};ltuid=${stuid};cookie_token=${cookieToken};account_id=${stuid};` }
  }

  /**
   * 刷新这个使用者名下全部有 stoken 的凭据
   * @param owner 使用者标识
   * @returns 逐账号的结果
   */
  async refresh(owner: string): Promise<RefreshResult> {
    const list = await this.#cookies.owned(owner)
    const items: RefreshOne[] = []
    /** 已经刷过的 stuid，同一个通行证不重复请求 */
    const seen = new Set<string>()
    let first = true

    for (const rec of list) {
      const uids = Object.values(rec.uids).flatMap(one => one ?? [])
      if (!rec.stoken) {
        items.push({ ltuid: rec.ltuid, uids, state: "noStoken" })
        continue
      }
      const stuid = parseCookie(rec.stoken).get("stuid") ?? rec.ltuid
      if (seen.has(stuid)) continue
      seen.add(stuid)

      // 只在两次真实请求之间等，第一个不必等
      if (!first) await sleep(this.#gap(GAP_MS))
      first = false

      const got = await this.#one(rec.ltuid, rec.stoken)
      if (!got.cookie) {
        items.push({ ltuid: rec.ltuid, uids, state: "fail", ...(got.message ? { message: got.message } : {}) })
        continue
      }

      // 落库走 `save` 而不是直接改字段：它会重新规整、校验必需 token、保留 uid 清单与归属。
      // 绕过它就多一条落库路径，两条迟早不一致
      const saved = await this.#cookies.save(got.cookie, { owner })
      if (!saved) {
        items.push({ ltuid: rec.ltuid, uids, state: "fail", message: "新 Cookie 落库失败，形态可能不完整" })
        continue
      }
      // stoken 那一份不受影响，但 save 之后要把它带回新记录上
      await this.#cookies.setStoken(saved.ltuid, rec.stoken)
      // 刷新之后原先因失效而停用的那条应恢复可用，否则刷了也挑不出来
      await this.#cookies.enable(saved.ltuid)

      items.push({ ltuid: rec.ltuid, uids, state: "ok" })
      this.#logger.info(`[米游社][刷新ck] ${mask(rec.ltuid)} 已换到新的 cookie_token`)
    }

    return {
      items,
      ok: items.filter(one => one.state === "ok").length,
      skipped: items.filter(one => one.state === "noStoken").length,
      failed: items.filter(one => one.state === "fail").length
    }
  }
}
