/**
 * 模块职责：扫码登录的测试
 * 依赖方向：测试文件，依赖 service/qr-login 与 core/pass-api，HTTP 与设备都是假的
 * 生命周期：无状态
 * 注意事项：固定七处**不报错但会造成实际损害**的口径：凭据不进日志、ticket 认 `tk` 也认
 *          `ticket`、状态字段认 `status` 也认 `stat`、`tokens` 里的项按 `token_type` 认也按
 *          `name` 认（接口实际只给编号，`1` 即 stoken）、取不到 stoken 时把每一项的名字或编号
 *          记进日志、换来的两份凭据各自完整，以及轮询有上限。`gap` 一律传 `() => 0`：真实间隔
 *          是每次五秒、最多三十六次，测试不能真的等。
 */
import { describe, expect, it } from "vitest"
import type { HttpClient } from "@yunzai-ng/types"
import type { DeviceStore } from "../core/device.js"
import { parseTicket, pickToken, tokenLabel } from "../core/pass-api.js"
import { QrLoginService } from "./qr-login.js"

/** 记下来的日志行 */
const logged: string[] = []

/** 记录每一行的日志器 */
const LOGGER = {
  debug: (msg: string): void => void logged.push(msg),
  info: (msg: string): void => void logged.push(msg),
  mark: (msg: string): void => void logged.push(msg),
  warn: (msg: string): void => void logged.push(msg),
  error: (msg: string): void => void logged.push(msg),
  trace: (msg: string): void => void logged.push(msg),
  fatal: (msg: string): void => void logged.push(msg)
}

/** 假设备存储 */
const DEVICES = {
  use: async (): Promise<{ id: string; name: string; spec: { model: string } }> => ({
    id: "TESTDEVICE",
    name: "HUAWEI P40",
    spec: { model: "ANA-AN00" }
  }),
  fp: async (): Promise<string | undefined> => undefined
} as unknown as DeviceStore

/** 一条形态真实的二维码地址 —— 参数名是 `tk` 而不是 `ticket` */
const QR_URL =
  "https://user.mihoyo.com/login-platform/mobile.html?expire=1788415189&tk=1798f2b2-af25-49ef-a401-ae0115dae0de&token_types=1#/login/qr"

/** 那条地址里的 ticket */
const TICKET = "1798f2b2-af25-49ef-a401-ae0115dae0de"

/** 记下来的一次请求 */
interface Call {
  /** 完整 URL */
  url: string
  /** 请求头 */
  headers: Record<string, string>
  /** 请求体 */
  body?: string
}

/** 每类接口给什么 */
interface Answers {
  /** 申请二维码 */
  create?: unknown
  /** 逐次轮询的返回，按调用顺序取；用完之后重复最后一个 */
  query?: readonly unknown[]
  /** 换 ltoken */
  ltoken?: unknown
  /** 换 cookie_token */
  cookieToken?: unknown
}

/** 还没人扫那一份 */
const CREATED = { retcode: 0, data: { status: "Created", tokens: [], user_info: null } }

/** 确认之后那一份返回：stoken 直接在 tokens 里；项里只有 `token_type` 而没有 `name`，`1` 即 stoken */
const CONFIRMED = {
  retcode: 0,
  data: {
    status: "Confirmed",
    tokens: [{ token_type: 1, token: "v2_SECRET" }],
    user_info: { aid: "100000088", mid: "m1_zzz" }
  }
}

/**
 * 造一个假 HTTP 与一个扫码登录服务
 * @param answers 每类接口给什么
 * @returns 服务与调用记录
 */
function make(answers: Answers = {}): { service: QrLoginService; calls: Call[] } {
  const calls: Call[] = []
  let queryAt = 0
  const http = {
    request: async <T,>(url: string, opts: { headers: Record<string, string>; body?: string }): Promise<T> => {
      calls.push({ url, headers: opts.headers, ...(opts.body === undefined ? {} : { body: opts.body }) })
      if (url.includes("createQRLogin")) {
        return { ok: true, status: 200, data: answers.create ?? { retcode: 0, data: { url: QR_URL, ticket: TICKET } } } as T
      }
      if (url.includes("queryQRLoginStatus")) {
        const list = answers.query ?? [CONFIRMED]
        const pick = list[Math.min(queryAt, list.length - 1)]
        queryAt += 1
        return { ok: true, status: 200, data: pick } as T
      }
      if (url.includes("getLTokenBySToken")) {
        return { ok: true, status: 200, data: answers.ltoken ?? { retcode: 0, data: { ltoken: "LT" } } } as T
      }
      return {
        ok: true,
        status: 200,
        data: answers.cookieToken ?? { retcode: 0, data: { cookie_token: "CT" } }
      } as T
    }
  } as unknown as HttpClient
  return {
    service: new QrLoginService({ http, logger: LOGGER as never, devices: DEVICES, gap: (): number => 0 }),
    calls
  }
}

describe("parseTicket", () => {
  it("`tk` 与 `ticket` 两种参数名都认", () => {
    // 通行证那条地址里叫 `tk`，游戏登录那条叫 `ticket`。只认后者时通行证这条路一律取不到
    expect(parseTicket(QR_URL)).toBe(TICKET)
    expect(parseTicket("https://x.invalid/a?ticket=abc123&b=1")).toBe("abc123")
    expect(parseTicket("https://example.invalid/x")).toBeUndefined()
  })

  it("井号后面的片段不算进 ticket", () => {
    // 通行证那条地址以 `#/login/qr` 收尾，把它带进 ticket 就轮询不到
    expect(parseTicket("https://x.invalid/a?tk=abc#/login/qr")).toBe("abc")
  })
})

describe("pickToken", () => {
  it("按名字取，整串优先于前缀", () => {
    const list = [
      { name: "ltoken", token: "L" },
      { name: "stoken_v2", token: "S2" },
      { name: "stoken", token: "S1" }
    ]

    expect(pickToken(list, "stoken")).toBe("S2")
    expect(pickToken(list, "ltoken")).toBe("L")
  })

  it("整串没有时按前缀找 —— 字段名会加版本后缀", () => {
    expect(pickToken([{ name: "stoken_v9", token: "S9" }], "stoken")).toBe("S9")
  })

  it("没有名字时按编号取 —— 通行证接口只给 token_type", () => {
    // 实测的形态：确认后只有这一项，`1` 即 stoken
    const list = [{ token_type: 1, token: "S" }]

    expect(pickToken(list, "stoken")).toBe("S")
    expect(pickToken(list, "ltoken")).toBeUndefined()
    expect(pickToken([{ token_type: 2, token: "L" }], "ltoken")).toBe("L")
    expect(pickToken([{ token_type: 4, token: "C" }], "cookieToken")).toBe("C")
  })

  it("刻意不退回「第一个有值的」—— 那会把 stoken 当成 ltoken 塞进 Cookie", () => {
    expect(pickToken([{ name: "stoken_v2", token: "S2" }], "ltoken")).toBeUndefined()
    expect(pickToken([{ token_type: 1, token: "S" }], "cookieToken")).toBeUndefined()
    expect(pickToken(undefined, "stoken")).toBeUndefined()
    expect(pickToken([{ name: "stoken", token: "" }], "stoken")).toBeUndefined()
  })
})

describe("tokenLabel", () => {
  it("只说名字或编号，绝不带 token 本体", () => {
    expect(tokenLabel({ name: "stoken_v2", token: "SECRET" })).toBe("stoken_v2")
    expect(tokenLabel({ token_type: 1, token: "SECRET" })).toBe("编号 1")
    expect(tokenLabel({ token: "SECRET" })).toBe("无名无编号")
    expect(tokenLabel(undefined)).toBe("无名无编号")
  })
})

describe("QrLoginService.create", () => {
  it("打通行证那条接口，请求体是空对象", async () => {
    const { service, calls } = make()
    const got = await service.create("qq:1")

    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.ticket).toBe(TICKET)
    expect([...got.png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(calls[0]?.url).toContain("createQRLogin")
    // 不写 token_types：那一项由服务端定，写了不改变结果却会改变签名覆盖的 body
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({})
    expect(calls[0]?.headers["DS"]).toMatch(/^\d+,\d+,[0-9a-f]{32}$/)
  })

  it("`data.ticket` 优先于从地址里解析", async () => {
    const { service } = make({ create: { retcode: 0, data: { url: "https://x.invalid/a", ticket: "FROM_FIELD" } } })
    const got = await service.create("qq:1")

    expect(got).toMatchObject({ ok: true, ticket: "FROM_FIELD" })
  })

  it("接口不给地址时明确失败，不出图", async () => {
    const { service } = make({ create: { retcode: -3101, message: "请求异常" } })
    const got = await service.create("qq:1")

    expect(got).toMatchObject({ ok: false })
    if (got.ok) return
    expect(got.message).toContain("请求异常")
  })

  it("既没有 ticket 字段、地址里也解析不出时拒绝出图 —— 否则使用者徒然扫码一次", async () => {
    const { service } = make({ create: { retcode: 0, data: { url: "https://user.mihoyo.com/login-platform/mobile.html" } } })
    const got = await service.create("qq:1")

    expect(got).toMatchObject({ ok: false })
    if (got.ok) return
    expect(got.message).toContain("ticket")
  })
})

describe("QrLoginService.wait", () => {
  it("确认之后换出两份凭据，各自完整", async () => {
    const { service } = make()
    const got = await service.wait("qq:1", "t")

    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.credentials.ltuid).toBe("100000088")
    expect(got.credentials.cookie).toContain("cookie_token=CT")
    expect(got.credentials.cookie).toContain("ltoken=LT")
    expect(got.credentials.cookie).toContain("ltuid=100000088")
    // stoken 那一份要带 mid，缺了它小组件与社区签到都会回「请先登录」
    expect(got.credentials.stoken).toContain("stoken=v2_SECRET")
    expect(got.credentials.stoken).toContain("mid=m1_zzz")
  })

  it("`tokens` 里已有 ltoken 时不再多打一次接口", async () => {
    const withLt = {
      retcode: 0,
      data: {
        status: "Confirmed",
        tokens: [
          { token_type: 1, token: "v2_SECRET" },
          { token_type: 2, token: "LT_INLINE" }
        ],
        user_info: { aid: "100000088", mid: "m1_zzz" }
      }
    }
    const { service, calls } = make({ query: [withLt] })
    const got = await service.wait("qq:1", "t")

    expect(got).toMatchObject({ ok: true })
    if (!got.ok) return
    expect(got.credentials.cookie).toContain("ltoken=LT_INLINE")
    expect(calls.filter(one => one.url.includes("getLTokenBySToken"))).toHaveLength(0)
  })

  it("带名字的那种形态也认 —— 换 ltoken 那条旧接口给的是名字", async () => {
    const named = {
      retcode: 0,
      data: {
        status: "Confirmed",
        tokens: [{ name: "stoken_v2", token: "v2_SECRET" }],
        user_info: { aid: "100000088", mid: "m1_zzz" }
      }
    }
    const { service } = make({ query: [named] })
    const got = await service.wait("qq:1", "t")

    expect(got).toMatchObject({ ok: true })
    if (!got.ok) return
    expect(got.credentials.stoken).toContain("stoken=v2_SECRET")
  })

  it("旧接口的 `stat` 也认", async () => {
    const oldShape = {
      retcode: 0,
      data: {
        stat: "Confirmed",
        tokens: [{ name: "stoken", token: "v2_SECRET" }],
        user_info: { uid: 100000088, mid: "m1_zzz" }
      }
    }
    const { service } = make({ query: [oldShape] })

    expect(await service.wait("qq:1", "t")).toMatchObject({ ok: true })
  })

  it("凭据不进日志", async () => {
    logged.length = 0
    const { service } = make()
    await service.wait("qq:1", "t")

    const all = logged.join("\n")
    expect(all).not.toContain("v2_SECRET")
    expect(all).not.toContain("LT_INLINE")
    // 通行证 id 也是遮蔽后才记的
    expect(all).not.toContain("100000088")
    expect(all).toContain("100****88")
  })

  it("扫了但还没确认时回调一次，且只回调一次", async () => {
    const scanned = { retcode: 0, data: { status: "Scanned", tokens: [] } }
    const { service } = make({ query: [scanned, scanned, CONFIRMED] })
    let times = 0
    const got = await service.wait("qq:1", "t", {
      onScanned: async (): Promise<void> => void (times += 1)
    })

    expect(times).toBe(1)
    expect(got.ok).toBe(true)
  })

  it("接口报错即判二维码失效，不继续轮询", async () => {
    const { service, calls } = make({ query: [{ retcode: -3502, message: "二维码已过期" }] })
    const got = await service.wait("qq:1", "t")

    expect(got).toMatchObject({ ok: false, kind: "expired" })
    expect(calls.filter(one => one.url.includes("queryQRLoginStatus"))).toHaveLength(1)
  })

  it("一直没人扫就超时收手，轮询次数有上限", async () => {
    const { service, calls } = make({ query: [CREATED] })
    const got = await service.wait("qq:1", "t")

    expect(got).toMatchObject({ ok: false, kind: "timeout" })
    expect(calls.length).toBeLessThanOrEqual(36)
  })

  it("确认了但 tokens 里没有 stoken 时，把收到的名字或编号记进日志", async () => {
    // 这一条是刻意加的：只说"没有给出 stoken"时，"接口换了字段名"与"这个账号真的没拿到"
    // 在日志里分不出来，而两者的处置完全不同
    logged.length = 0
    const { service } = make({
      query: [
        {
          retcode: 0,
          data: {
            status: "Confirmed",
            tokens: [{ name: "cookie_token", token: "X" }, { token_type: 9, token: "Y" }],
            user_info: { aid: "100000088" }
          }
        }
      ]
    })
    const got = await service.wait("qq:1", "t")

    expect(got).toMatchObject({ ok: false, kind: "fail" })
    const all = logged.join("\n")
    expect(all).toContain("cookie_token")
    // 没有名字的那一项记成编号，否则日志里是一串问号，看不出接口给了什么
    expect(all).toContain("编号 9")
    // 名字与编号记了，值一律不记
    expect(all).not.toContain("\"X\"")
    expect(all).not.toContain("\"Y\"")
  })

  it("确认了但没有账号信息时不硬拼一份凭据", async () => {
    const { service } = make({
      query: [{ retcode: 0, data: { status: "Confirmed", tokens: [{ name: "stoken_v2", token: "S" }] } }]
    })

    expect(await service.wait("qq:1", "t")).toMatchObject({ ok: false, kind: "fail" })
  })

  it("换 cookie_token 失败时整体失败 —— 只有 stoken 的话查询那一半用不了", async () => {
    const { service } = make({ cookieToken: { retcode: -100, message: "登录失效" } })

    expect(await service.wait("qq:1", "t")).toMatchObject({ ok: false, kind: "fail" })
  })

  it("换 ltoken 失败时整体失败，不落一份残缺凭据", async () => {
    const { service } = make({ ltoken: { retcode: -100, message: "登录失效" } })

    expect(await service.wait("qq:1", "t")).toMatchObject({ ok: false, kind: "fail" })
  })

  it("三步的顺序固定：轮询 → 换 ltoken → 换 cookie_token", async () => {
    const { service, calls } = make()
    await service.wait("qq:1", "t")

    const seq = calls.map(one =>
      one.url.includes("queryQRLoginStatus") ? "query" : one.url.includes("getLTokenBySToken") ? "ltoken" : "cookie"
    )
    expect(seq).toEqual(["query", "ltoken", "cookie"])
  })
})
