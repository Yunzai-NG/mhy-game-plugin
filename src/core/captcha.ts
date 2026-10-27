/**
 * 模块职责：图形验证（`1034`）的过码 —— 把米游社下发的验证串交给外部服务，等它回传 validate
 * 依赖方向：依赖内核的 HttpClient / Logger 契约；不认识米游社客户端，也不认识命令层
 * 生命周期：随插件 setup 造一个实例，自身无状态
 * 注意事项：凭据不出本机 —— 交给外部服务的只有 uid 与米游社当场下发的 `gt` / `challenge`；
 *          Cookie、DS、设备指纹一律不外发，两条验证接口由本插件自己带 CK 请求。
 *          该约定由测试逐字段固定。
 *
 *          没配地址即整条路不走：{@link CaptchaService.enabled} 为假时表现与未接入一字不差。
 *
 *          过码服务由使用者自行部署，不是本框架的插件；协议见 {@link CaptchaService.solve}。
 */
import type { DurationLike, HttpClient, Logger } from "@yunzai-ng/types"
import { AsyncLocalStorage } from "node:async_hooks"

/** 轮询间隔，沿用既有过码服务的口径 */
const POLL_INTERVAL = 1500

/** 米游社下发的一次验证 */
export interface CaptchaTicket {
  /** 极验的 gt */
  gt: string
  /** 本次验证的 challenge */
  challenge: string
}

/**
 * 过码服务回传的 validate
 *
 * 字段由极验决定，原样转发给米游社而不做取舍：多一道字段裁剪只会在极验换字段时
 * 把可用的服务判成不可用。
 */
export type CaptchaValidate = Record<string, unknown>

/** 一次过码任务 */
export interface CaptchaTask extends CaptchaTicket {
  /** 触发风控的游戏 uid，供外部服务区分同时进行的多次验证 */
  uid: string
  /** 把待点开的链接送到使用者眼前；没有可用会话时不传，此时只有自动过码的服务能用 */
  notify?: (text: string) => Promise<void>
}

/** 过码服务的构造参数 */
export interface CaptchaOptions {
  /** 内核提供的 HTTP 客户端 */
  http: HttpClient
  /** 日志器 */
  logger: Logger
  /** 取当前配置的服务地址，空串即未配置 */
  address: () => string
  /** 单次请求超时 */
  timeout?: DurationLike | (() => DurationLike)
  /** 等人点完链接的上限毫秒 */
  wait?: () => number
  /** 睡一会，供测试替换为立即返回 */
  sleep?: (ms: number) => Promise<void>
  /** 取当前时刻，供测试驱动等待上限 */
  now?: () => number
}

/**
 * 判一份响应体是否已经给出 validate
 *
 * 判据取「是个非空对象，且不含 `link` / `result`」：带这两项的是"该让人去点了"。
 * 不认字段名，理由见 {@link CaptchaValidate}。
 * @param data 响应体的 `data` 段
 * @returns validate；尚未给出时 undefined
 */
export function asValidate(data: unknown): CaptchaValidate | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined
  const obj = data as Record<string, unknown>
  if (typeof obj["result"] === "string" || typeof obj["link"] === "string") return undefined
  return Object.keys(obj).length > 0 ? obj : undefined
}

/** 过码服务的返回信封 */
interface SolverEnvelope {
  /** 业务数据；`{link, result}` 为待人工点击，非空对象为 validate */
  data?: unknown
}

/** 图形验证的过码服务 */
export class CaptchaService {
  /** HTTP 客户端 */
  private readonly http: HttpClient
  /** 日志器 */
  private readonly logger: Logger
  /** 取当前服务地址 */
  private readonly address: () => string
  /** 取当前超时配置 */
  private readonly timeout: () => DurationLike
  /** 取当前等待上限 */
  private readonly wait: () => number
  /** 睡一会 */
  private readonly sleep: (ms: number) => Promise<void>
  /** 取当前时刻 */
  private readonly now: () => number

  /**
   * @param opts 构造参数
   */
  constructor(opts: CaptchaOptions) {
    this.http = opts.http
    this.logger = opts.logger
    this.address = opts.address
    const timeout = opts.timeout ?? "15s"
    this.timeout = typeof timeout === "function" ? timeout : (): DurationLike => timeout
    this.wait = opts.wait ?? ((): number => 120_000)
    this.sleep =
      opts.sleep ??
      ((ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms)))
    this.now = opts.now ?? ((): number => Date.now())
  }

  /** 是否配了过码服务 */
  get enabled(): boolean {
    return this.address().trim().length > 0
  }

  /**
   * 过一次图形验证
   *
   * 协议（与既有的手动过码服务一致，故已在用的服务不必改动）：
   *
   * 1. POST 配置的地址，JSON 请求体 `{uid, gt, challenge}`；
   * 2. 服务回 `{data: {link, result}}` —— `link` 交给使用者点开，`result` 是结果查询地址；
   * 3. 每 {@link POLL_INTERVAL} 毫秒 GET 一次 `result`，其 `data` 给出非空对象即为 validate；
   * 4. 服务自己就能过码时，第 2 步可直接给出 validate，此时无须有人点。
   *
   * 任一步不成即返回 undefined，由调用方按"未过码"处置。
   * @param task 过码任务
   * @returns validate；未过码时 undefined
   */
  async solve(task: CaptchaTask): Promise<CaptchaValidate | undefined> {
    const url = this.address().trim()
    if (!url) return undefined

    const first = await this.post(url, task)
    if (!first) return undefined

    const direct = asValidate(first.data)
    if (direct) {
      this.logger.info("[米游社][过码] 过码服务直接给出了校验结果")
      return direct
    }

    const { link, result } = this.pickLinks(first.data)
    if (!result) {
      this.logger.warn("[米游社][过码] 过码服务既没给校验结果，也没给结果查询地址")
      return undefined
    }
    if (link && task.notify) await task.notify(`请点开下面的链接完成验证，完成后本次查询会自动继续\n${link}`)
    else if (link) this.logger.warn(`[米游社][过码] 无可用会话，链接无从送出：${link}`)

    return await this.poll(result)
  }

  /**
   * 把验证串交给过码服务
   * @param url 服务地址
   * @param task 过码任务
   * @returns 服务的返回信封；请求失败时 undefined
   */
  private async post(url: string, task: CaptchaTask): Promise<SolverEnvelope | undefined> {
    // 逐字段列出而非展开 task：展开会把此后新增的字段（含 notify）一并发出去
    const body = JSON.stringify({ uid: task.uid, gt: task.gt, challenge: task.challenge })
    try {
      const res = await this.http.request<SolverEnvelope>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        timeout: this.timeout(),
        responseType: "json",
        throwOnError: false
      })
      if (!res.ok) {
        this.logger.warn(`[米游社][过码] 过码服务返回 HTTP ${res.status}`)
        return undefined
      }
      return res.data ?? {}
    } catch (err) {
      this.logger.warn(`[米游社][过码] 请求过码服务出错：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  /**
   * 取待点击链接与结果查询地址
   * @param data 响应体的 `data` 段
   * @returns 两个地址，缺失时为 undefined
   */
  private pickLinks(data: unknown): { link?: string; result?: string } {
    if (!data || typeof data !== "object") return {}
    const obj = data as { link?: unknown; result?: unknown }
    return {
      ...(typeof obj.link === "string" && obj.link ? { link: obj.link } : {}),
      ...(typeof obj.result === "string" && obj.result ? { result: obj.result } : {})
    }
  }

  /**
   * 轮询结果查询地址，直到拿到 validate 或超出等待上限
   *
   * 单次失败不中断：那多半是使用者点开页面之前服务尚未就绪。
   * @param url 结果查询地址
   * @returns validate；等到超时仍未过码时 undefined
   */
  private async poll(url: string): Promise<CaptchaValidate | undefined> {
    const deadline = this.now() + Math.max(this.wait(), POLL_INTERVAL)
    while (this.now() < deadline) {
      await this.sleep(POLL_INTERVAL)
      try {
        const res = await this.http.request<SolverEnvelope>(url, {
          method: "GET",
          timeout: this.timeout(),
          responseType: "json",
          throwOnError: false
        })
        const validate = res.ok ? asValidate(res.data?.data) : undefined
        if (validate) return validate
      } catch (err) {
        this.logger.debug(`[米游社][过码] 查询过码结果出错：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    this.logger.warn("[米游社][过码] 等到超时仍未完成验证")
    return undefined
  }
}

/** 过码链接的送达通道 */
export type CaptchaNotice = (text: string) => Promise<void>

/**
 * 当前命令的送达通道
 *
 * 用异步上下文而非逐层传参：查询散在七十余处调用点。模块级变量不可用 —— 两位使用者
 * 同时查询时会把链接送错人。
 */
const NOTICE = new AsyncLocalStorage<CaptchaNotice>()

/**
 * 在一段执行期间登记"过码链接往哪送"
 * @param notice 送达通道
 * @param fn 这段执行
 * @returns `fn` 的返回值
 */
export function withCaptchaNotice<T>(notice: CaptchaNotice, fn: () => Promise<T>): Promise<T> {
  return NOTICE.run(notice, fn)
}

/**
 * 取当前的送达通道
 *
 * 定时任务（自动签到、体力提醒）里没有登记过 —— 那时无人可点，故过码自然跳过。
 * @returns 送达通道；不在命令执行期间时 undefined
 */
export function currentCaptchaNotice(): CaptchaNotice | undefined {
  return NOTICE.getStore()
}
