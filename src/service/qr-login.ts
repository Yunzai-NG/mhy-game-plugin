/**
 * 模块职责：扫码登录 —— 申请二维码、轮询扫码状态、把结果换成可用的凭据
 * 依赖方向：依赖内核的 HttpClient / Logger 与本插件的 device / pass-api / qr；不认识命令层
 * 生命周期：随插件 setup 创建一个实例，无状态（凭据由命令层交给 Cookie 池落库）
 * 注意事项：取到的是 stoken（权限大于 ltoken）。凭据不写日志（只出遮蔽后的通行证 id 与 retcode）；
 *          二维码只发私聊，ticket 在有效期内等于一次登录机会；轮询有上限，到点停并明说超时。
 *          取码 → 轮询到 `Confirmed` → 由 stoken 换 ltoken 与 cookie_token，任一步失败就整体失败、
 *          不落残缺凭据 —— 只有 stoken 时签到能用而查询不能，使用者却看到"绑定成功"。
 *          状态字段 `status` 与旧名 `stat` 都认。拿到通行证 id 前设备键借用使用者标识（前缀 `qr:`），
 *          申请与轮询须是同一台设备，否则查不到这张码的状态。
 */
import type { HttpClient, Logger } from "@yunzai-ng/types"
import type { DeviceStore } from "../core/device.js"
import type { PassDevice, PassRequest, PassToken } from "../core/pass-api.js"
import {
  cookieTokenRequest,
  createQrRequest,
  ltokenRequest,
  parseTicket,
  pickToken,
  queryQrRequest,
  tokenLabel
} from "../core/pass-api.js"
import { qrPng } from "../core/qr.js"

/** 轮询间隔，照官方 App 的节奏 */
const POLL_MS = 5000

/** 轮询上限 —— 二维码本身的有效期通常在三分钟上下 */
const POLL_TIMES = 36

/** 取不到 device_fp 时的占位值，通行证接口只校验这一项存在 */
const FALLBACK_FP = "38d7ee0e96649"

/** 二维码每个模块画几个像素 —— 太小的图手机难以识别 */
const QR_SCALE = 8

/** 申请二维码的结果 */
export type QrCreateResult =
  | {
      /** 成功 */
      ok: true
      /** 轮询用的 ticket */
      ticket: string
      /** 二维码里那条地址 */
      url: string
      /** 可直接发出去的 PNG */
      png: Uint8Array
    }
  | {
      /** 失败 */
      ok: false
      /** 可直接展示的原因 */
      message: string
    }

/** 一次登录取到的凭据 */
export interface QrCredentials {
  /** 通行证 id */
  ltuid: string
  /** 查询用的 Cookie（ltoken + cookie_token 那一份） */
  cookie: string
  /** stoken 那一份，社区签到与米游币要它 */
  stoken: string
}

/** 轮询的结果 */
export type QrWaitResult =
  | {
      /** 成功 */
      ok: true
      /** 凭据 */
      credentials: QrCredentials
    }
  | {
      /** 失败 */
      ok: false
      /** 分类：超时、二维码失效、换凭据失败 */
      kind: "timeout" | "expired" | "fail"
      /** 可直接展示的原因 */
      message: string
    }

/** 扫码登录服务的构造参数 */
export interface QrLoginServiceOptions {
  /** HTTP 客户端 */
  http: HttpClient
  /** 日志器 */
  logger: Logger
  /** 设备存储 */
  devices: DeviceStore
  /** 轮询间隔，测试里传 `() => 0` */
  gap?: (ms: number) => number
}

/** 通行证接口的返回信封 */
interface Envelope<T> {
  /** 业务返回码 */
  retcode?: number
  /** 提示 */
  message?: string
  /** 数据 */
  data?: T
}

/** 二维码状态查询的返回 */
interface QrStatusRaw {
  /** 新接口的状态：`Created` / `Scanned` / `Confirmed` */
  status?: string
  /** 旧接口的状态：`Init` / `Scanned` / `Confirmed` */
  stat?: string
  /** 确认后直接给出的一批 token，stoken 就在其中 */
  tokens?: PassToken[]
  /** 账号信息 */
  user_info?: { aid?: string; uid?: string | number; mid?: string; account_id?: string }
}

/**
 * 遮蔽通行证 id
 * @param id 通行证 id
 * @returns 遮蔽后的串
 */
function mask(id: string): string {
  return id.length <= 4 ? "****" : `${id.slice(0, 3)}****${id.slice(-2)}`
}

/** 扫码登录服务 */
export class QrLoginService {
  readonly #http: HttpClient
  readonly #logger: Logger
  readonly #devices: DeviceStore
  readonly #gap: (ms: number) => number

  /**
   * @param opts 构造参数
   */
  constructor(opts: QrLoginServiceOptions) {
    this.#http = opts.http
    this.#logger = opts.logger
    this.#devices = opts.devices
    this.#gap = opts.gap ?? ((ms: number): number => ms)
  }

  /**
   * 取这次登录用的设备
   * @param owner 使用者标识
   * @returns 通行证接口要的设备形态
   */
  async #device(owner: string): Promise<PassDevice> {
    const key = `qr:${owner}`
    const device = await this.#devices.use(key)
    return {
      id: device.id,
      name: device.name,
      model: device.spec.model,
      fp: (await this.#devices.fp(key)) ?? FALLBACK_FP
    }
  }

  /**
   * 发一次通行证请求
   *
   * 不记 URL：换 ltoken 那一条把 stoken 放在 query 里，记下来等于把凭据写进日志。
   * @param req 请求
   * @returns 信封；网络层失败时 undefined
   */
  async #call<T>(req: PassRequest): Promise<Envelope<T> | undefined> {
    try {
      const res = await this.#http.request<Envelope<T>>(req.url, {
        method: req.method,
        headers: req.headers,
        ...(req.body === undefined ? {} : { body: req.body }),
        timeout: "20s",
        responseType: "json",
        throwOnError: false
      })
      if (!res.ok) {
        this.#logger.warn(`[米游社][扫码登录] HTTP ${res.status}`)
        return undefined
      }
      return res.data
    } catch (err) {
      this.#logger.warn(`[米游社][扫码登录] 请求失败：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  /**
   * 申请一个登录二维码
   * @param owner 使用者标识
   * @returns 二维码与轮询用的 ticket
   */
  async create(owner: string): Promise<QrCreateResult> {
    const device = await this.#device(owner)
    const res = await this.#call<{ url?: string; ticket?: string }>(createQrRequest(device))
    if (!res || Number(res.retcode) !== 0 || !res.data?.url) {
      this.#logger.warn(`[米游社][扫码登录] 取二维码失败 retcode=${res?.retcode ?? "无回应"}`)
      return { ok: false, message: res?.message || "米游社没有给出二维码，请稍后再试" }
    }
    const url = res.data.url
    // 优先用返回里那一项：地址里的参数名是 `tk` 而不是 `ticket`，见 parseTicket
    const ticket = res.data.ticket || parseTicket(url)
    if (!ticket) {
      // 没有 ticket 就无从轮询，而此时图已经画出来了 —— 发出去只会让人徒然扫码一次
      return { ok: false, message: "二维码地址里没有 ticket，无法确认扫码结果" }
    }
    try {
      return { ok: true, ticket, url, png: qrPng(url, QR_SCALE) }
    } catch (err) {
      return { ok: false, message: `二维码生成失败：${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /**
   * 等使用者扫码并确认，随后把结果换成凭据
   * @param owner 使用者标识
   * @param ticket 申请时拿到的 ticket
   * @param opts 回调与中止信号
   * @returns 凭据或失败原因
   */
  async wait(
    owner: string,
    ticket: string,
    opts: {
      /** 首次观察到"已扫描但未确认"时回调一次 */
      onScanned?: () => Promise<void>
      /** 中止信号 */
      signal?: AbortSignal
    } = {}
  ): Promise<QrWaitResult> {
    const device = await this.#device(owner)
    let told = false

    for (let round = 0; round < POLL_TIMES; round += 1) {
      const ms = this.#gap(POLL_MS)
      if (ms > 0) await new Promise<void>(resolve => setTimeout(resolve, ms))
      if (opts.signal?.aborted) return { ok: false, kind: "timeout", message: "本次扫码已取消" }

      const res = await this.#call<QrStatusRaw>(queryQrRequest(device, ticket))
      if (!res) continue
      if (Number(res.retcode) !== 0) {
        return { ok: false, kind: "expired", message: res.message || "二维码已过期，请重新发送命令" }
      }

      // 两个字段名都认：新接口 `status`、旧接口 `stat`
      const stat = res.data?.status || res.data?.stat || ""
      if (stat === "Scanned" && !told) {
        told = true
        await opts.onScanned?.()
        continue
      }
      if (stat !== "Confirmed") continue
      return await this.#exchange(device, res.data)
    }
    return { ok: false, kind: "timeout", message: "等了三分钟没有扫码，本次已取消" }
  }

  /**
   * 把确认后的返回换成两份凭据
   *
   * 两步：从 `tokens` 里取出 stoken，再由 stoken 换 ltoken 与 cookie_token（ltoken 若已在
   * `tokens` 里就直接用）。少了 cookie_token 就整体失败 —— 只有 stoken 时查询那一半用不了。
   * @param device 设备
   * @param data 状态查询的返回
   * @returns 凭据或失败原因
   */
  async #exchange(device: PassDevice, data: QrStatusRaw | undefined): Promise<QrWaitResult> {
    const stoken = pickToken(data?.tokens, "stoken")
    const info = data?.user_info ?? {}
    const stuid = String(info.aid ?? info.uid ?? info.account_id ?? "")
    if (!stoken || !stuid) {
      // 把收到的每一项说成名字或编号（不含任何 token 值）：接口换字段名与"真没拿到"两者
      // 处置不同，只说"没有给出 stoken"日志里分不出来
      const names = (data?.tokens ?? []).map(one => tokenLabel(one)).join("、") || "（空数组）"
      this.#logger.warn(
        `[米游社][扫码登录] 确认后没取到 stoken：tokens 里有 ${names}；` +
          `账号信息 ${stuid ? "有" : "无"}`
      )
      return {
        ok: false,
        kind: "fail",
        message: "米游社确认了登录但没有给出 stoken，请重试；若反复如此请把日志里那条 warn 发给维护者"
      }
    }
    const mid = info.mid
    const parts = { stuid, stoken, ...(mid ? { mid } : {}) }

    // ltoken 可能已经在 tokens 里，那就不必再请求一次
    let ltoken = pickToken(data?.tokens, "ltoken")
    if (!ltoken) {
      const lt = await this.#call<{ ltoken?: string; token?: { token?: string } }>(ltokenRequest(device, parts))
      ltoken = lt?.data?.ltoken ?? lt?.data?.token?.token
      if (!ltoken) this.#logger.warn(`[米游社][扫码登录] 换 ltoken 失败 retcode=${lt?.retcode ?? "无回应"}`)
    }

    const ck = await this.#call<{ cookie_token?: string }>(cookieTokenRequest(parts))
    const cookieToken = ck?.data?.cookie_token
    if (!ltoken || !cookieToken) {
      this.#logger.warn(
        `[米游社][扫码登录] 换凭据失败 ltoken=${ltoken ? "有" : "无"} cookie_token retcode=${ck?.retcode}`
      )
      return { ok: false, kind: "fail", message: ck?.message || "换取 Cookie 失败，请重试" }
    }

    this.#logger.info(`[米游社][扫码登录] 通行证 ${mask(stuid)} 登录完成`)
    return {
      ok: true,
      credentials: {
        ltuid: stuid,
        cookie: `ltoken=${ltoken};ltuid=${stuid};cookie_token=${cookieToken};account_id=${stuid};`,
        stoken: `stoken=${stoken};stuid=${stuid};${mid ? `mid=${mid};` : ""}`
      }
    }
  }
}
