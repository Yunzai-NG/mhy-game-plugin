/**
 * 模块职责：凭 stoken 刷新查询 Cookie 的测试
 * 依赖方向：测试文件，依赖 service/refresh-ck、store/ck、core/device 与一份内存 KV
 * 生命周期：无状态
 * 注意事项：钉住四条口径：只动发起者自己名下的凭据（别人那条的 Cookie 一个字都不许变）、同一个
 *          通行证只请求一次、stoken 也失效时给的是"去重新扫码"而不是 retcode，以及**刷新之后
 *          stoken 那一份仍在** —— `save` 会重建记录，不带回去就把 stoken 弄丢了。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import type { HttpClient, Logger } from "@yunzai-ng/types"
import { beforeEach, describe, expect, it } from "vitest"
import { DeviceStore } from "../core/device.js"
import { CookiePool } from "../store/ck.js"
import { RefreshCkService } from "./refresh-ck.js"

/** 一次跑测试期间发出去的请求 */
let sent: string[] = []

/** 各接口分别回什么 */
interface Answers {
  /** 换 ltoken 那一条 */
  ltoken?: Record<string, unknown>
  /** 换 cookie_token 那一条 */
  cookieToken?: Record<string, unknown>
}


/** 什么都不记的日志器 */
const LOGGER = { info: (): void => {}, warn: (): void => {}, error: (): void => {}, debug: (): void => {}, mark: (): void => {} } as unknown as Logger

/**
 * 造一个假的 HTTP 客户端
 * @param answers 两条接口分别回什么
 * @returns 客户端
 */
function makeHttp(answers: Answers): HttpClient {
  return {
    request: async (url: string): Promise<{ status: number; data: unknown }> => {
      // 只记接口名，绝不记整条 URL —— stoken 就在 query 里
      const name = url.includes("getLTokenBySToken") ? "ltoken" : "cookieToken"
      sent.push(name)
      const body =
        name === "ltoken"
          ? (answers.ltoken ?? { retcode: 0, data: { ltoken: "LT-new" } })
          : (answers.cookieToken ?? { retcode: 0, data: { cookie_token: "CT-new" } })
      return { status: 200, data: body }
    }
  } as unknown as HttpClient
}

/**
 * 造一套服务与凭据池
 * @param answers 两条接口分别回什么
 * @returns 服务、凭据池
 */
function make(answers: Answers = {}): { service: RefreshCkService; cookies: CookiePool } {
  const kv = new Kv(new MemoryKvDriver())
  const devices = new DeviceStore({ kv: kv.sub("device"), logger: LOGGER, fpMaxAge: () => 1000 })
  const cookies = new CookiePool({ kv: kv.sub("cookie"), logger: LOGGER, devices })
  const service = new RefreshCkService({
    http: makeHttp(answers),
    logger: LOGGER,
    devices,
    cookies,
    // 间隔归零，测试不必真等
    gap: () => 0
  })
  return { service, cookies }
}

/**
 * 造一段旧的查询 Cookie
 * @param ltuid 通行证 id
 * @returns Cookie
 */
function oldCookie(ltuid: string): string {
  return `ltoken=LT-old;ltuid=${ltuid};cookie_token=CT-old;account_id=${ltuid};`
}

beforeEach(() => {
  sent = []
})

describe("刷新自己名下的凭据", () => {
  it("换到新 token 后落库，旧的那份被顶掉", async () => {
    const { service, cookies } = make()
    await cookies.save(oldCookie("1001"), { owner: "onebot11:1" })
    await cookies.setStoken("1001", "stuid=1001;stoken=v2_abc;mid=m1_xyz;")

    const res = await service.refresh("onebot11:1")

    expect(res.ok).toBe(1)
    expect(res.items[0]?.state).toBe("ok")
    const got = await cookies.get("1001")
    expect(got?.cookie).toContain("cookie_token=CT-new")
    expect(got?.cookie).toContain("ltoken=LT-new")
    expect(got?.cookie).not.toContain("CT-old")
  })

  it("**刷新之后 stoken 那一份仍在** —— 丢了它就再也刷不了第二次", async () => {
    const { service, cookies } = make()
    await cookies.save(oldCookie("1001"), { owner: "onebot11:1" })
    await cookies.setStoken("1001", "stuid=1001;stoken=v2_abc;mid=m1_xyz;")

    await service.refresh("onebot11:1")

    const got = await cookies.get("1001")
    expect(got?.stoken).toContain("stoken=v2_abc")
    // 再刷一次仍然走真实请求，而不是被判成"没有 stoken"
    sent = []
    const again = await service.refresh("onebot11:1")
    expect(again.ok).toBe(1)
    expect(sent).toEqual(["ltoken", "cookieToken"])
  })

  it("归属不因刷新而改变 —— save 会重建记录，owner 须带回去", async () => {
    const { service, cookies } = make()
    await cookies.save(oldCookie("1001"), { owner: "onebot11:1" })
    await cookies.setStoken("1001", "stuid=1001;stoken=v2_abc;")

    await service.refresh("onebot11:1")

    expect((await cookies.get("1001"))?.owner).toBe("onebot11:1")
  })

  it("**别人绑的那些一概不动**", async () => {
    const { service, cookies } = make()
    await cookies.save(oldCookie("2002"), { owner: "onebot11:9" })
    await cookies.setStoken("2002", "stuid=2002;stoken=v2_other;")
    await cookies.save(oldCookie("1001"), { owner: "onebot11:1" })
    await cookies.setStoken("1001", "stuid=1001;stoken=v2_abc;")

    const res = await service.refresh("onebot11:1")

    expect(res.items).toHaveLength(1)
    expect(res.items[0]?.ltuid).toBe("1001")
    // 别人那条的 Cookie 一个字都没变
    expect((await cookies.get("2002"))?.cookie).toContain("CT-old")
  })

  it("没有 stoken 的那条跳过，不发请求", async () => {
    const { service, cookies } = make()
    await cookies.save(oldCookie("1001"), { owner: "onebot11:1" })

    const res = await service.refresh("onebot11:1")

    expect(res.skipped).toBe(1)
    expect(res.ok).toBe(0)
    expect(sent).toEqual([])
  })
})

describe("失败与去重", () => {
  it("stoken 也失效时指路去重新扫码，而不是报一个 retcode", async () => {
    const { service, cookies } = make({ cookieToken: { retcode: -100, message: "登录失效" } })
    await cookies.save(oldCookie("1001"), { owner: "onebot11:1" })
    await cookies.setStoken("1001", "stuid=1001;stoken=v2_expired;")

    const res = await service.refresh("onebot11:1")

    expect(res.failed).toBe(1)
    expect(res.items[0]?.message).toContain("扫码登录")
  })

  it("换不到 token 时**不动旧 Cookie** —— 半份凭据比过期的凭据更糟", async () => {
    const { service, cookies } = make({ cookieToken: { retcode: 0, data: {} } })
    await cookies.save(oldCookie("1001"), { owner: "onebot11:1" })
    await cookies.setStoken("1001", "stuid=1001;stoken=v2_abc;")

    await service.refresh("onebot11:1")

    expect((await cookies.get("1001"))?.cookie).toContain("CT-old")
  })

  it("库里那段 stoken 认不出来时也只回一句，不发请求", async () => {
    const { service, cookies } = make()
    await cookies.save(oldCookie("1001"), { owner: "onebot11:1" })
    // 缺 stoken= 那一项
    await cookies.setStoken("1001", "stuid=1001;mid=m1_xyz;")

    const res = await service.refresh("onebot11:1")

    expect(res.failed).toBe(1)
    expect(sent).toEqual([])
  })

  it("一个都没绑时返回空结果", async () => {
    const { service } = make()
    const res = await service.refresh("onebot11:1")

    expect(res.items).toEqual([])
    expect(sent).toEqual([])
  })
})
