/**
 * 模块职责：查询服务的测试
 * 依赖方向：测试文件，依赖 mys.ts / ck.ts / user.ts / client.ts 与内核 testing 包
 * 生命周期：每个用例一份内存 KV 与一份请求记录
 * 注意事项：固定两条相反的行为：**CK 失效后自动换一条**，而**命中风控时不换** —— 换 CK 只会把
 *          同一台设备的风控扩散到第二个账号。另固定归属硬闸：查 uid 只用发起者本人绑定该 uid 的 CK，
 *          绑了别人的 uid 也读不到其私有数据（连缓存都够不着），见文件末两条。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@yunzai-ng/types"
import { beforeEach, describe, expect, it } from "vitest"
import { CookiePool } from "../store/ck.js"
import { CaptchaService, withCaptchaNotice } from "../core/captcha.js"
import { MysClient } from "../core/client.js"
import { DeviceStore } from "../core/device.js"
import { MysService } from "./mys.js"
import { UserStore } from "../store/user.js"

/** 替身返回的内容 */
interface Reply {
  /** 状态码，缺省 200 */
  status?: number
  /** 响应体 */
  data?: unknown
}

/** 一次被记录的请求 */
interface Call {
  /** 请求地址 */
  url: string
  /** 请求选项 */
  opts: HttpRequestOptions
}

/** 构造一个记录请求的 HTTP 替身 */
const makeHttp = (handler: (url: string, opts: HttpRequestOptions) => Reply): { http: HttpClient; calls: Call[] } => {
  const calls: Call[] = []
  const fail = (): never => {
    throw new Error("测试仅使用 request")
  }
  const http: HttpClient = {
    request: async <T>(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse<T>> => {
      calls.push({ url, opts })
      const out = handler(url, opts)
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

/** 判断是否为 getFp 请求 */
const isFp = (url: string): boolean => url.includes("device-fp/api/getFp")

/** 判断是否为角色列表请求 */
const isRoles = (url: string): boolean => url.includes("getUserGameRolesByCookie")

/** 指纹请求的固定回包 */
const FP_REPLY: Reply = { data: { retcode: 0, data: { device_fp: "fp-1" } } }

/** 原神国服角色列表回包 */
const GS_ROLES: Reply = {
  data: {
    retcode: 0,
    data: { list: [{ game_biz: "hk4e_cn", region: "cn_gf01", game_uid: "100000001", nickname: "旅行者", level: 60 }] }
  }
}

/** 空角色列表回包 */
const NO_ROLES: Reply = { data: { retcode: 0, data: { list: [] } } }

/** 一份有效的 Cookie */
const CK_A = "ltuid_v2=100; ltoken_v2=v2_a="

/** 另一份有效的 Cookie */
const CK_B = "ltuid_v2=200; ltoken_v2=v2_b="

describe("MysService", () => {
  let kv: Kv
  let devices: DeviceStore
  let cookies: CookiePool
  let users: UserStore
  /** 过码轮询用的假表 */
  let clock: number

  beforeEach(() => {
    kv = new Kv(new MemoryKvDriver())
    devices = new DeviceStore({ kv: kv.sub("device"), logger: fakeLogger() })
    cookies = new CookiePool({ kv: kv.sub("cookie"), logger: fakeLogger(), devices })
    users = new UserStore({ kv: kv.sub("user") })
    clock = 0
  })

  /** 构造一个服务 */
  const make = (
    handler: (url: string, opts: HttpRequestOptions) => Reply,
    cache?: Map<string, unknown>,
    captchaAddr = ""
  ): { mys: MysService; calls: Call[] } => {
    const { http, calls } = makeHttp(handler)
    const client = new MysClient({
      http,
      logger: fakeLogger(),
      devices,
      ...(cache
        ? {
            cache: {
              get: (k: string): unknown => cache.get(k),
              set: (k: string, v: unknown): void => void cache.set(k, v),
              delete: (k: string): void => void cache.delete(k)
            }
          }
        : {})
    })
    const captcha = new CaptchaService({
      http,
      logger: fakeLogger(),
      address: () => captchaAddr,
      wait: () => 3000,
      // 表随替身 sleep 走，轮询才有尽头
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms
      }
    })
    return { mys: new MysService({ client, cookies, users, logger: fakeLogger(), captcha }), calls }
  }

  it("绑定 Cookie：验证有效性、取回 uid，并一并为本人绑定 uid", async () => {
    const { mys, calls } = make(url => {
      if (isFp(url)) return FP_REPLY
      return url.includes("game_biz=hk4e_cn") ? GS_ROLES : NO_ROLES
    })

    const out = await mys.bind(CK_A, { user: "qq:1" })

    expect(out).toEqual({
      ok: true,
      ltuid: "100",
      uids: { gs: ["100000001"] },
      // 昵称与等级一并带出：绝区零两个面板源都不给这两项，此处是它唯一的来源
      roles: { gs: [{ uid: "100000001", name: "旅行者", level: 60 }] }
    })
    expect((await cookies.get("100"))?.owner).toBe("qq:1")
    expect(await users.uid("qq:1", "gs")).toBe("100000001")
    // 「名下有哪些米游社账号」只由 CK 记录的 owner 记载，不在用户档案里另存一份
    expect((await cookies.owned("qq:1")).map(one => one.ltuid)).toEqual(["100"])
    // 国服探测到角色后不再探测国际服：三个游戏各一次即可
    expect(calls.filter(c => isRoles(c.url))).toHaveLength(3)
  })

  it("同账号名下几个 uid 全部绑上，首个为当前，手工绑过的排在后面", async () => {
    const two: Reply = {
      data: {
        retcode: 0,
        data: {
          list: [
            { game_biz: "hk4e_cn", region: "cn_gf01", game_uid: "100000001", nickname: "甲", level: 60 },
            { game_biz: "hk4e_cn", region: "cn_gf01", game_uid: "500000001", nickname: "乙", level: 30 }
          ]
        }
      }
    }
    const { mys } = make(url => (isFp(url) ? FP_REPLY : url.includes("game_biz=hk4e_cn") ? two : NO_ROLES))
    await users.addUid("qq:1", "gs", "200000001")

    expect((await mys.bind(CK_A, { user: "qq:1" })).ok).toBe(true)
    expect(await users.uids("qq:1", "gs")).toEqual(["100000001", "500000001", "200000001"])
  })

  it("国际服账号：国服探测不到时改用国际服域名再请求一次", async () => {
    const { mys, calls } = make(url => {
      if (isFp(url)) return FP_REPLY
      if (url.includes("game_biz=hk4e_global")) {
        return {
          data: {
            retcode: 0,
            data: { list: [{ game_biz: "hk4e_global", region: "os_usa", game_uid: "600000001" }] }
          }
        }
      }
      return NO_ROLES
    })

    const out = await mys.bind(CK_A, { user: "qq:1" })

    expect(out.uids).toEqual({ gs: ["600000001"] })
    expect(calls.filter(c => isRoles(c.url) && c.url.includes("hoyolab.com"))).toHaveLength(3)
    // 绝区零的国际服 uid 为 10 位，占位 uid 须随之更换，否则该次探测将落至国服域名
    expect(calls.some(c => c.url.includes("game_biz=nap_global"))).toBe(true)
  })

  it("不完整的 Cookie 当即拒绝，不发出任何请求", async () => {
    const { mys, calls } = make(() => FP_REPLY)

    expect((await mys.bind("mi18nLang=zh-cn", { user: "qq:1" })).ok).toBe(false)
    expect((await mys.bind("ltuid_v2=100; mi18nLang=zh-cn", { user: "qq:1" })).message).toContain("ltoken")
    expect(calls).toHaveLength(0)
  })

  it("米游社返回 -100 时直接告知使用者，不写入池中", async () => {
    const { mys, calls } = make(url => (isFp(url) ? FP_REPLY : { data: { retcode: -100, message: "请先登录" } }))

    const out = await mys.bind(CK_A, { user: "qq:1" })

    expect(out).toEqual({ ok: false, message: "请先登录" })
    expect(await cookies.list()).toHaveLength(0)
    // 首次即否定，不应将三个游戏、两个区服逐一尝试
    expect(calls.filter(c => isRoles(c.url))).toHaveLength(1)
  })

  it("未绑定 uid 时返回 nouid，无可用 CK 时返回 nock —— 均不发出请求", async () => {
    const { mys, calls } = make(() => FP_REPLY)

    const noUid = await mys.query("dailyNote", { user: "qq:1" })
    expect(noUid.ok).toBe(false)
    if (!noUid.ok) expect(noUid.kind).toBe("nouid")

    const noCk = await mys.query("dailyNote", { user: "qq:1", uid: "100000001" })
    expect(noCk.ok).toBe(false)
    if (!noCk.ok) expect(noCk.kind).toBe("nock")
    expect(calls).toHaveLength(0)
  })

  it("查询成功时记账一次，并回报所使用的 CK 归属", async () => {
    const { mys } = make(url => (isFp(url) ? FP_REPLY : { data: { retcode: 0, data: { current_resin: 20 } } }))
    await cookies.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })

    const res = await mys.query<{ current_resin: number }>("dailyNote", { user: "qq:1", uid: "100000001" })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.current_resin).toBe(20)
    expect(res.uid).toBe("100000001")
    expect(res.ltuid).toBe("100")
    expect(await cookies.count("100")).toBe(1)
  })

  it("当前 uid 取自用户档案，命令中无需携带 uid", async () => {
    const { mys } = make(url => (isFp(url) ? FP_REPLY : { data: { retcode: 0, data: { ok: 1 } } }))
    await cookies.save(CK_A, { owner: "qq:1", uids: { sr: ["100000002"] } })
    await users.addUid("qq:1", "sr", "100000002")

    const res = await mys.query("dailyNote", { user: "qq:1", game: "sr" })

    expect(res.ok && res.uid).toBe("100000002")
  })

  it("CK 失效时将其停用并自动更换下一条重试，该过程对使用者不可见", async () => {
    let hits = 0
    const { mys } = make(url => {
      if (isFp(url)) return FP_REPLY
      hits += 1
      return hits === 1 ? { data: { retcode: -100, message: "请先登录" } } : { data: { retcode: 0, data: { ok: 1 } } }
    })
    // A 绑定在先且使用次数更少，将被优先选中
    await cookies.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await cookies.save(CK_B, { owner: "qq:1", uids: { gs: ["100000001"] } })

    const res = await mys.query("index", { user: "qq:1", uid: "100000001" })

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.ltuid).toBe("200")
    expect((await cookies.get("100"))?.disabled).toBe(true)
    expect((await cookies.get("100"))?.reason).toBe("请先登录")
    expect((await cookies.get("200"))?.disabled).toBe(false)
  })

  it("命中风控：既不停用亦不更换 CK，如实告知使用者", async () => {
    const { mys } = make(url => (isFp(url) ? FP_REPLY : { data: { retcode: 1034, message: "验证码" } }))
    await cookies.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await cookies.save(CK_B, { owner: "qq:1", uids: { gs: ["100000001"] } })

    const res = await mys.query("index", { user: "qq:1", uid: "100000001" })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.kind).toBe("risk")
      expect(res.ltuid).toBe("100")
    }
    expect((await cookies.get("100"))?.disabled).toBe(false)
    // 第二条 CK 完全未被使用：更换 CK 只会将风控扩散至第二个账号
    expect(await cookies.count("200")).toBe(0)
  })

  it("配了过码服务：过一遍图形验证再重发，使用者只看到最终结果", async () => {
    const GT = "https://gt.example.invalid/register"
    let record = 0
    const { mys, calls } = make(
      url => {
        if (isFp(url)) return FP_REPLY
        if (url === GT) return { data: { data: { geetest_validate: "v1" } } }
        if (url.includes("createVerification")) return { data: { retcode: 0, data: { gt: "g1", challenge: "c1" } } }
        if (url.includes("verifyVerification")) return { data: { retcode: 0, data: {} } }
        record += 1
        // client 自己会换指纹重试一次，故前两次都风控，过码之后的第三次才给数据
        return record <= 2
          ? { data: { retcode: 1034, message: "验证码" } }
          : { data: { retcode: 0, data: { role: { level: 60 } } } }
      },
      undefined,
      GT
    )
    await cookies.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })

    const res = await mys.query("index", { user: "qq:1", uid: "100000001" })

    expect(res.ok).toBe(true)
    expect(record).toBe(3)
    // 交给过码服务的那一次不带 Cookie，凭据不出本机
    const solve = calls.find(c => c.url === GT)
    expect(JSON.parse(String(solve?.opts.body ?? "{}"))).toEqual({ uid: "100000001", gt: "g1", challenge: "c1" })
    expect(JSON.stringify(solve?.opts.headers ?? {})).not.toContain("ltoken")
    // 两条验证接口反过来是要带 CK 的，且都由本插件自己请求
    const created = calls.find(c => c.url.includes("createVerification"))
    expect(String((created?.opts.headers as Record<string, string> | undefined)?.["Cookie"] ?? "")).toContain("ltuid_v2")
    expect((await cookies.get("100"))?.disabled).toBe(false)
  })

  it("过码服务没过成：照旧如实告知，不再重发", async () => {
    const GT = "https://gt.example.invalid/register"
    let record = 0
    const { mys } = make(
      url => {
        if (isFp(url)) return FP_REPLY
        if (url === GT) return { status: 500 }
        if (url.includes("createVerification")) return { data: { retcode: 0, data: { gt: "g1", challenge: "c1" } } }
        record += 1
        return { data: { retcode: 1034, message: "验证码" } }
      },
      undefined,
      GT
    )
    await cookies.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })

    const res = await mys.query("index", { user: "qq:1", uid: "100000001" })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.kind).toBe("risk")
    // 只有 client 自己那两次；过码没成就不该再消耗一次额度
    expect(record).toBe(2)
  })

  it("过码要人点链接时，链接送回发起命令的那个人", async () => {
    const GT = "https://gt.example.invalid/register"
    const POLL = "https://gt.example.invalid/result"
    let record = 0
    const { mys } = make(
      url => {
        if (isFp(url)) return FP_REPLY
        if (url === GT) return { data: { data: { link: "https://gt.example.invalid/p/1", result: POLL } } }
        if (url === POLL) return { data: { data: { geetest_validate: "v1" } } }
        if (url.includes("createVerification")) return { data: { retcode: 0, data: { gt: "g1", challenge: "c1" } } }
        if (url.includes("verifyVerification")) return { data: { retcode: 0, data: {} } }
        record += 1
        return record <= 2 ? { data: { retcode: 1034, message: "验证码" } } : { data: { retcode: 0, data: {} } }
      },
      undefined,
      GT
    )
    await cookies.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })

    const sent: string[] = []
    const res = await withCaptchaNotice(
      async text => void sent.push(text),
      async () => await mys.query("index", { user: "qq:1", uid: "100000001" })
    )

    expect(res.ok).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain("https://gt.example.invalid/p/1")
  })

  it("当前 CK 本日查询已满时更换下一条", async () => {
    let hits = 0
    const { mys } = make(url => {
      if (isFp(url)) return FP_REPLY
      hits += 1
      return hits === 1 ? { data: { retcode: 10101, message: "查询已达上限" } } : { data: { retcode: 0, data: {} } }
    })
    await cookies.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await cookies.save(CK_B, { owner: "qq:1", uids: { gs: ["100000001"] } })

    const res = await mys.query("index", { user: "qq:1", uid: "100000001" })

    expect(res.ok && res.ltuid).toBe("200")
    // 记的是「今日到顶」这个标记，不是把计数灌满 —— 私人上限缺省不限，灌满没有意义
    expect((await cookies.usage("100")).blocked).toBe(true)
    expect((await cookies.get("100"))?.disabled).toBe(false)
  })

  it("命中缓存的那一次不记账 —— 未请求米游社，不应占用使用者额度", async () => {
    const { mys, calls } = make(url => (isFp(url) ? FP_REPLY : { data: { retcode: 0, data: { ok: 1 } } }), new Map())
    await cookies.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })

    await mys.query("index", { user: "qq:1", uid: "100000001" })
    const second = await mys.query("index", { user: "qq:1", uid: "100000001" })

    expect(second.ok && second.cached).toBe(true)
    expect(await cookies.count("100")).toBe(1)
    expect(calls.filter(c => !isFp(c.url))).toHaveLength(1)
  })

  it("解绑：Cookie 与设备一并清理，uid 予以保留", async () => {
    const { mys } = make(url => {
      if (isFp(url)) return FP_REPLY
      return url.includes("game_biz=hk4e_cn") ? GS_ROLES : NO_ROLES
    })
    await mys.bind(CK_A, { user: "qq:1" })

    expect(await mys.unbind("100")).toBe(true)
    expect(await cookies.get("100")).toBeUndefined()
    // 归属随记录一并消失，不必另解一次关系
    expect(await cookies.owned("qq:1")).toEqual([])
    expect(await devices.fp("100")).toBeUndefined()
    // uid 不随 CK 一并删除：面板、抽卡等公开查询仍可进行
    expect(await users.uid("qq:1", "gs")).toBe("100000001")
  })

  it("按用户完全隔离：绑了别人的 uid 也读不到他的私有数据，且一个请求都不发", async () => {
    const { mys, calls } = make(url => (isFp(url) ? FP_REPLY : { data: { retcode: 0, data: { ok: 1 } } }))
    // A(qq:1) 自己的账号覆盖 100000001；B(qq:2) 扫码登录，账号覆盖 100000002
    await cookies.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await cookies.save(CK_B, { owner: "qq:2", uids: { gs: ["100000002"] } })
    // A 把自己的当前 uid 绑成了 B 的 100000002（#绑定uid 允许绑别人的 uid，只是查不了私有数据）
    await users.addUid("qq:1", "gs", "100000002")

    const res = await mys.query("index", { user: "qq:1", game: "gs" })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.kind).toBe("nock")
    // 关键：一个米游社请求都没发出 —— 连 B 的 CK 都没被拿去打
    expect(calls.filter(c => !isFp(c.url))).toHaveLength(0)
  })

  it("响应缓存不泄露：B 查过后 A 仍读不到（A 连缓存都够不着）", async () => {
    const cache = new Map<string, unknown>()
    const { mys, calls } = make(url => (isFp(url) ? FP_REPLY : { data: { retcode: 0, data: { secret: 1 } } }), cache)
    await cookies.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await cookies.save(CK_B, { owner: "qq:2", uids: { gs: ["100000002"] } })

    // B 正常查自己的 uid，结果进了响应缓存
    const bRes = await mys.query("index", { user: "qq:2", uid: "100000002" })
    expect(bRes.ok).toBe(true)
    const before = calls.length

    // A 绑了 B 的 uid 来查同一个 uid：挑不出自己的 CK，直接 nock —— 不命中缓存、不发请求
    const aRes = await mys.query("index", { user: "qq:1", uid: "100000002" })
    expect(aRes.ok).toBe(false)
    if (!aRes.ok) expect(aRes.kind).toBe("nock")
    expect(calls.length).toBe(before)
  })
})



