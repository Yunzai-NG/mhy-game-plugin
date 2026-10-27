/**
 * 模块职责：过码服务的测试
 * 依赖方向：测试文件，依赖 captcha.ts 与内核 testing 包
 * 生命周期：每个用例一份请求记录
 * 注意事项：固定两件出错即安全事故的事：**发给外部服务的请求体只有 uid / gt / challenge**（多出 Cookie 或设备信息即违背「不外发凭据」）；没配地址时 `enabled` 为假且一个请求都不发。轮询用替身 sleep。
 */
import { fakeLogger } from "@yunzai-ng/core/testing"
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@yunzai-ng/types"
import { describe, expect, it } from "vitest"
import { CaptchaService, asValidate, currentCaptchaNotice, withCaptchaNotice } from "./captcha.js"

/** 一次被记录的请求 */
interface Call {
  /** 请求地址 */
  url: string
  /** 请求选项 */
  opts: HttpRequestOptions
}

/** 替身返回的内容 */
interface Reply {
  /** 状态码，缺省 200 */
  status?: number
  /** 响应体 */
  data?: unknown
}

/** 构造一个记录请求的 HTTP 替身 */
const makeHttp = (
  handler: (url: string, opts: HttpRequestOptions) => Reply | Error
): { http: HttpClient; calls: Call[] } => {
  const calls: Call[] = []
  const fail = (): never => {
    throw new Error("测试仅使用 request")
  }
  const http: HttpClient = {
    request: async <T>(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse<T>> => {
      calls.push({ url, opts })
      const out = handler(url, opts)
      if (out instanceof Error) throw out
      const status = out.status ?? 200
      return {
        status,
        statusText: status === 200 ? "OK" : "ERR",
        headers: {},
        data: out.data as T,
        ok: status >= 200 && status < 300,
        url,
        cost: 1
      }
    },
    get: fail,
    post: fail,
    buffer: fail,
    download: fail,
    extend: () => http
  }
  return { http, calls }
}

/** 过码服务地址 */
const ADDR = "https://gt.example.invalid/register"

/** 结果查询地址 */
const RESULT = "https://gt.example.invalid/result?id=1"

/** 一份 validate */
const VALIDATE = { geetest_challenge: "c1", geetest_validate: "v1", geetest_seccode: "v1|jordan" }

/** 构造一个过码服务；时钟由替身 sleep 推进 */
const make = (
  handler: (url: string, opts: HttpRequestOptions) => Reply | Error,
  address = ADDR,
  wait = 30_000
): { captcha: CaptchaService; calls: Call[]; clock: () => number } => {
  const { http, calls } = makeHttp(handler)
  let now = 0
  const captcha = new CaptchaService({
    http,
    logger: fakeLogger(),
    address: () => address,
    wait: () => wait,
    now: () => now,
    sleep: async (ms: number) => {
      now += ms
    }
  })
  return { captcha, calls, clock: (): number => now }
}

describe("asValidate", () => {
  it("带 link 或 result 的一律不算校验结果", () => {
    expect(asValidate({ link: "https://x", result: RESULT })).toBeUndefined()
    expect(asValidate({ result: RESULT })).toBeUndefined()
  })

  it("空、null 与数组都不算", () => {
    expect(asValidate({})).toBeUndefined()
    expect(asValidate(null)).toBeUndefined()
    expect(asValidate([1])).toBeUndefined()
  })

  it("非空对象即校验结果，不认字段名", () => {
    expect(asValidate(VALIDATE)).toEqual(VALIDATE)
    expect(asValidate({ 换了个字段名: "x" })).toEqual({ 换了个字段名: "x" })
  })
})

describe("CaptchaService", () => {
  it("没配地址时不发请求", async () => {
    const { captcha, calls } = make(() => ({ data: {} }), "")
    expect(captcha.enabled).toBe(false)
    expect(await captcha.solve({ uid: "100000001", gt: "g", challenge: "c" })).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  it("只把 uid 与两个验证串交给外部服务", async () => {
    const { captcha, calls } = make(() => ({ data: { data: VALIDATE } }))
    await captcha.solve({ uid: "100000001", gt: "g1", challenge: "c1" })
    const body = JSON.parse(String(calls[0]?.opts.body ?? "{}")) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(["challenge", "gt", "uid"])
    expect(body).toEqual({ uid: "100000001", gt: "g1", challenge: "c1" })
  })

  it("服务自己过完码时一次请求就够，不必有人点", async () => {
    const { captcha, calls } = make(() => ({ data: { data: VALIDATE } }))
    expect(await captcha.solve({ uid: "100000001", gt: "g", challenge: "c" })).toEqual(VALIDATE)
    expect(calls).toHaveLength(1)
  })

  it("给了链接就送到使用者眼前，再轮询到校验结果", async () => {
    let polls = 0
    const { captcha, calls } = make(url => {
      if (url === ADDR) return { data: { data: { link: "https://gt.example.invalid/p/1", result: RESULT } } }
      polls += 1
      return { data: { data: polls >= 3 ? VALIDATE : null } }
    })
    const sent: string[] = []
    const got = await captcha.solve({
      uid: "100000001",
      gt: "g",
      challenge: "c",
      notify: async text => void sent.push(text)
    })
    expect(got).toEqual(VALIDATE)
    expect(polls).toBe(3)
    expect(calls[1]?.url).toBe(RESULT)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain("https://gt.example.invalid/p/1")
  })

  it("等到超时仍未点完即放弃", async () => {
    let polls = 0
    const { captcha, clock } = make(url => {
      if (url === ADDR) return { data: { data: { link: "https://x.invalid/p", result: RESULT } } }
      polls += 1
      return { data: { data: null } }
    })
    expect(await captcha.solve({ uid: "1", gt: "g", challenge: "c", notify: async () => {} })).toBeUndefined()
    // 上限 30 秒、每轮 1.5 秒
    expect(polls).toBe(20)
    expect(clock()).toBe(30_000)
  })

  it("没有会话时不至于报错，只是没人能点", async () => {
    const { captcha } = make(
      url =>
        url === ADDR ? { data: { data: { link: "https://x.invalid/p", result: RESULT } } } : { data: { data: null } },
      ADDR,
      1500
    )
    expect(await captcha.solve({ uid: "1", gt: "g", challenge: "c" })).toBeUndefined()
  })

  it("服务返回 HTTP 500 时按未过码处理", async () => {
    const { captcha, calls } = make(() => ({ status: 500 }))
    expect(await captcha.solve({ uid: "1", gt: "g", challenge: "c" })).toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  it("服务既不给结果也不给查询地址时按未过码处理", async () => {
    const { captcha } = make(() => ({ data: { data: {} } }))
    expect(await captcha.solve({ uid: "1", gt: "g", challenge: "c" })).toBeUndefined()
  })
})

describe("withCaptchaNotice", () => {
  it("登记之后同一段执行里取得同一个通道，跨 await 亦然", async () => {
    const sent: string[] = []
    await withCaptchaNotice(
      async text => void sent.push(text),
      async () => {
        await Promise.resolve()
        await currentCaptchaNotice()?.("链接")
      }
    )
    expect(sent).toEqual(["链接"])
  })

  it("两段并发的执行各自拿到自己的通道", async () => {
    const a: string[] = []
    const b: string[] = []
    const run = async (bucket: string[], text: string): Promise<void> =>
      await withCaptchaNotice(
        async got => void bucket.push(got),
        async () => {
          await new Promise(resolve => setTimeout(resolve, 1))
          await currentCaptchaNotice()?.(text)
        }
      )
    await Promise.all([run(a, "甲"), run(b, "乙")])
    expect(a).toEqual(["甲"])
    expect(b).toEqual(["乙"])
  })

  it("没登记过时为空 —— 定时任务里正是这种情形", () => {
    expect(currentCaptchaNotice()).toBeUndefined()
  })
})
