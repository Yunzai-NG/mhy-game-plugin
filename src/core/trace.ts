/**
 * 模块职责：可观察日志 —— 外部请求逐条记 info，每条命令收尾时记一行 debug 汇总（打了哪些接口、各自结果与耗时）
 * 依赖方向：依赖 node:async_hooks 与内核的 HttpClient / Logger 契约；被 index.ts（包 ctx.http）与命令注册处使用
 * 生命周期：`traced` 包出的客户端随插件一个；每条命令一份 {@link CommandTrace}，经异步上下文传递
 * 注意事项：**地址只记主机与路径、不记 query**：authkey、ticket 一类凭据都在 query 里，请求头与请求体
 *          一概不记。命令之外（定时任务、启动安装）发的请求没有汇总可挂，只留逐条那一行。
 */
import { AsyncLocalStorage } from "node:async_hooks"
import type { HttpClient, HttpRequestOptions, HttpResponse, Logger } from "@yunzai-ng/types"

/** 汇总里的一步 */
export interface TraceStep {
  /** 种类：`mys` 米游社接口、`http` 其他外部请求、`render` 出图 */
  kind: "mys" | "http" | "render"
  /** 接口名、主机或模板名 */
  name: string
  /** 结果：`ok`、`缓存`、retcode 或 HTTP 状态、`失败` */
  result: string
  /** 耗时（毫秒） */
  ms: number
}

/** 一条命令的执行记录 */
export interface CommandTrace {
  /** 命令名 */
  command: string
  /** 开始时刻 */
  started: number
  /** 依次发生的几步 */
  steps: TraceStep[]
  /** 关键分支的说明，如「选中 CK」「面板走 Enka」 */
  notes: string[]
}

const store = new AsyncLocalStorage<CommandTrace>()

/**
 * 在一条命令的上下文里执行
 * @param command 命令名
 * @param run 命令本体
 * @returns 命令本体的返回值与这条命令的记录
 */
export async function withTrace<T>(command: string, run: () => Promise<T>): Promise<{ value: T; trace: CommandTrace }> {
  const trace: CommandTrace = { command, started: Date.now(), steps: [], notes: [] }
  const value = await store.run(trace, run)
  return { value, trace }
}

/**
 * 记一步；不在命令上下文里时丢弃
 * @param step 这一步
 */
export function traceStep(step: TraceStep): void {
  store.getStore()?.steps.push(step)
}

/**
 * 记一句关键分支的说明；不在命令上下文里时丢弃
 * @param text 说明，不得含凭据
 */
export function traceNote(text: string): void {
  store.getStore()?.notes.push(text)
}

/**
 * 当前是否在命令上下文里
 * @returns 是则为真
 */
export function inTrace(): boolean {
  return store.getStore() !== undefined
}

/**
 * 把一条命令的记录压成一行
 * @param trace 记录
 * @param who 发起者
 * @param error 出错时的消息
 * @returns 一行文本
 */
export function summarize(trace: CommandTrace, who: string, error?: string): string {
  const mys = trace.steps.filter(s => s.kind === "mys").map(s => `${s.name}(${s.result} ${s.ms}ms)`)
  const http = trace.steps.filter(s => s.kind === "http").map(s => `${s.name}(${s.result} ${s.ms}ms)`)
  const render = trace.steps.filter(s => s.kind === "render").map(s => `${s.name}(${s.result} ${s.ms}ms)`)
  const parts = [
    `[米游社][命令] ${trace.command} ${who} 用时 ${Date.now() - trace.started}ms${error ? ` 出错：${error}` : ""}`,
    mys.length ? `接口 ${mys.join(" ")}` : "接口 无",
    http.length ? `外部 ${http.join(" ")}` : "",
    render.length ? `出图 ${render.join(" ")}` : "",
    trace.notes.length ? `分支 ${trace.notes.join("；")}` : ""
  ]
  return parts.filter(Boolean).join(" | ")
}

/**
 * 地址 → 可入日志的形态：只留主机与路径
 * @param url 地址
 * @returns `主机/路径`；解析不了时 `?`
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}`
  } catch {
    return "?"
  }
}

/**
 * 主机名，汇总里按它分组
 * @param url 地址
 * @returns 主机；解析不了时 `?`
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "?"
  }
}

/**
 * 包一层逐条记日志的 HTTP 客户端
 *
 * 米游社接口另由 core/client.ts 记接口名与 retcode 并进汇总，此处的 `http` 一步只在命令汇总里
 * 按主机计、不重复列那几条米游社请求。
 * @param http 内核的客户端
 * @param logger 日志器
 * @returns 行为不变、多记日志的客户端
 */
export function traced(http: HttpClient, logger: Logger): HttpClient {
  /**
   * 记一次请求
   * @param method 方法
   * @param url 地址
   * @param started 开始时刻
   * @param status 状态码；抛错时 undefined
   * @param error 抛错时的消息
   */
  const note = (method: string, url: string, started: number, status?: number, error?: string): void => {
    const ms = Date.now() - started
    const where = redactUrl(url)
    if (error !== undefined) logger.warn(`[米游社][外部请求] ${method} ${where} 失败 ${ms}ms：${error}`)
    else if (status !== undefined && status >= 400) logger.warn(`[米游社][外部请求] ${method} ${where} ${status} ${ms}ms`)
    else logger.info(`[米游社][外部请求] ${method} ${where} ${status ?? "ok"} ${ms}ms`)
    const host = hostOf(url)
    if (!/(^|\.)(mihoyo|miyoushe|hoyolab|hoyoverse)\.com$/.test(host)) {
      traceStep({ kind: "http", name: host, result: error !== undefined ? "失败" : String(status ?? "ok"), ms })
    }
  }

  /**
   * 包一个方法
   * @param method 日志里印的方法名
   * @param fn 原方法
   * @param statusOf 从结果里取状态码
   * @returns 包过的方法
   */
  const wrap =
    <A extends unknown[], R>(
      method: string | ((rest: A) => string),
      fn: (url: string, ...rest: A) => Promise<R>,
      statusOf?: (r: R) => number
    ) =>
    async (url: string, ...rest: A): Promise<R> => {
      const started = Date.now()
      const m = typeof method === "string" ? method : method(rest)
      try {
        const got = await fn(url, ...rest)
        note(m, url, started, statusOf ? statusOf(got) : 200)
        return got
      } catch (err) {
        note(m, url, started, undefined, err instanceof Error ? err.message : String(err))
        throw err
      }
    }

  return {
    request: wrap(
      ([opts]: [HttpRequestOptions?]) => (opts?.method ?? "GET").toUpperCase(),
      <T>(url: string, opts?: HttpRequestOptions) => http.request<T>(url, opts),
      (r: HttpResponse<unknown>) => r.status
    ) as HttpClient["request"],
    get: wrap("GET", (url: string, opts?: Omit<HttpRequestOptions, "method">) => http.get(url, opts)) as HttpClient["get"],
    post: wrap("POST", (url: string, json?: unknown, opts?: Omit<HttpRequestOptions, "method" | "json">) =>
      http.post(url, json, opts)
    ) as HttpClient["post"],
    buffer: wrap("GET", (url: string, opts?: HttpRequestOptions) => http.buffer(url, opts)),
    download: wrap("GET", (url: string, dest: string, opts?: HttpRequestOptions) => http.download(url, dest, opts)),
    extend: defaults => traced(http.extend(defaults), logger)
  }
}
