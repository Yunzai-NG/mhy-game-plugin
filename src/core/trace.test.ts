/**
 * 模块职责：可观察日志的测试
 * 依赖方向：测试文件，依赖 core/trace；HTTP 与日志器用替身
 * 生命周期：无状态
 * 注意事项：钉三处：**日志里的地址不带 query**（authkey 一类凭据在 query 里）、米游社的请求不在汇总的
 *          「外部」里重复列（它另有接口名那一行）、**两条并发命令的记录互不串**（异步上下文隔离）。
 */
import { describe, expect, it } from "vitest"
import type { HttpClient, Logger } from "@yunzai-ng/types"
import { redactUrl, summarize, traceNote, traceStep, traced, withTrace } from "./trace.js"

/**
 * 记下每条日志的日志器
 * @returns 日志器与它记下的行
 */
function recorder(): { logger: Logger; lines: { level: string; text: string }[] } {
  const lines: { level: string; text: string }[] = []
  const put = (level: string) => (msg: unknown) => void lines.push({ level, text: String(msg) })
  const logger = {
    level: "debug",
    trace: put("trace"),
    debug: put("debug"),
    info: put("info"),
    warn: put("warn"),
    error: put("error"),
    fatal: put("fatal"),
    mark: put("info"),
    child: () => logger
  } as unknown as Logger
  return { logger, lines }
}

/**
 * 按地址决定成败的 HTTP 替身
 * @returns 客户端
 */
function fakeHttp(): HttpClient {
  const respond = async (url: string): Promise<{ status: number; ok: boolean; data: unknown }> => {
    if (url.includes("boom")) throw new Error("连接超时")
    const status = url.includes("missing") ? 404 : 200
    return { status, ok: status < 400, data: {} }
  }
  const http = {
    request: async (url: string) => ({ ...(await respond(url)), statusText: "", headers: {}, url, cost: 0 }),
    get: async (url: string) => (await respond(url)).data,
    post: async (url: string) => (await respond(url)).data,
    buffer: async (url: string) => (await respond(url), new Uint8Array(3)),
    download: async (url: string, dest: string) => (await respond(url), dest),
    extend: () => http
  }
  return http as unknown as HttpClient
}

describe("redactUrl", () => {
  it("只留主机与路径，query 里的凭据不进日志", () => {
    expect(redactUrl("https://hk4e-api.mihoyo.com/event/gacha_info/api/getGachaLog?authkey=SECRET&page=1")).toBe(
      "hk4e-api.mihoyo.com/event/gacha_info/api/getGachaLog"
    )
    expect(redactUrl("不是地址")).toBe("?")
  })
})

describe("traced", () => {
  it("成功记 info、4xx 与抛错记 warn，日志里不出现 query", async () => {
    const { logger, lines } = recorder()
    const http = traced(fakeHttp(), logger)
    await http.buffer("https://enka.network/ui/a.png?token=SECRET")
    await http.request("https://enka.network/missing", { method: "post" })
    await expect(http.get("https://cdn.jsdelivr.net/boom")).rejects.toThrow("连接超时")

    expect(lines.map(l => l.level)).toEqual(["info", "warn", "warn"])
    expect(lines[0]?.text).toContain("GET enka.network/ui/a.png 200")
    expect(lines[1]?.text).toContain("POST enka.network/missing 404")
    expect(lines[2]?.text).toContain("失败")
    expect(lines.some(l => l.text.includes("SECRET"))).toBe(false)
  })

  it("命令里的外部请求按主机计入汇总，米游社的不重复列", async () => {
    const { logger } = recorder()
    const http = traced(fakeHttp(), logger)
    const { trace } = await withTrace("#更新面板", async () => {
      await http.buffer("https://enka.network/api/uid/1")
      await http.request("https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/index")
      traceStep({ kind: "mys", name: "index", result: "ok", ms: 12 })
      traceNote("面板源 Enka")
    })
    expect(trace.steps.filter(s => s.kind === "http").map(s => s.name)).toEqual(["enka.network"])
    const line = summarize(trace, "qq:1@2")
    expect(line).toContain("#更新面板 qq:1@2")
    expect(line).toContain("接口 index(ok 12ms)")
    expect(line).toContain("外部 enka.network(200")
    expect(line).toContain("分支 面板源 Enka")
  })
})

describe("withTrace", () => {
  it("并发的两条命令各记各的", async () => {
    const tick = (): Promise<void> => new Promise(done => setTimeout(done, 5))
    const [a, b] = await Promise.all([
      withTrace("A", async () => {
        traceStep({ kind: "mys", name: "a1", result: "ok", ms: 1 })
        await tick()
        traceStep({ kind: "mys", name: "a2", result: "ok", ms: 1 })
      }),
      withTrace("B", async () => {
        await tick()
        traceStep({ kind: "mys", name: "b1", result: "ok", ms: 1 })
      })
    ])
    expect(a.trace.steps.map(s => s.name)).toEqual(["a1", "a2"])
    expect(b.trace.steps.map(s => s.name)).toEqual(["b1"])
  })

  it("命令之外记的步骤直接丢弃", () => {
    expect(() => traceStep({ kind: "mys", name: "x", result: "ok", ms: 0 })).not.toThrow()
  })
})
