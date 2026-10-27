/**
 * 模块职责：米游社请求客户端的测试
 * 依赖方向：测试文件，依赖 client.ts / device.ts 与内核 testing 包
 * 生命周期：每个用例一份内存 KV 与一份请求记录
 * 注意事项：固定三项出错即成片风控的行为：同一账号恒用同一设备与 device_fp；`1034` 只换指纹重试、**不换设备、不判 Cookie 失效**；只有 `-100` 判 Cookie 失效且不连带清指纹或设备。
 *          另固定活动页一族：先登活动页再请求，它们的 `-100` **不判 Cookie 失效**（判了会把好 CK 停掉）。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@yunzai-ng/types"
import { beforeEach, describe, expect, it } from "vitest"
import { mergeCookie, MysClient, parseSetCookie } from "./client.js"
import { DeviceStore } from "./device.js"
import { deriveDevice } from "./device-profile.js"
import { SALT_CN, signDs } from "./ds.js"

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
  /** 响应头，键小写 */
  headers?: Record<string, string>
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
        headers: out.headers ?? {},
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

/** 一份有效的 Cookie */
const COOKIE = "ltuid_v2=114514; ltoken_v2=v2_abc="

/** 国服原神 uid */
const UID = "100000001"

/** 判断是否为 getFp 请求 */
const isFp = (url: string): boolean => url.includes("device-fp/api/getFp")

describe("MysClient", () => {
  let devices: DeviceStore
  let cache: Map<string, unknown>

  beforeEach(() => {
    devices = new DeviceStore({ kv: new Kv(new MemoryKvDriver()), logger: fakeLogger() })
    cache = new Map()
  })

  /** 构造一个客户端 */
  const make = (
    handler: (url: string, opts: HttpRequestOptions) => Reply | Error,
    withCache = false
  ): { client: MysClient; calls: Call[] } => {
    const { http, calls } = makeHttp(handler)
    const client = new MysClient({
      http,
      logger: fakeLogger(),
      devices,
      ...(withCache
        ? {
            cache: {
              get: (k: string): unknown => cache.get(k),
              set: (k: string, v: unknown): void => void cache.set(k, v),
              delete: (k: string): void => void cache.delete(k)
            }
          }
        : {})
    })
    return { client, calls }
  }

  /** 正常返回体 */
  const okReply = (url: string): Reply =>
    isFp(url) ? { data: { retcode: 0, data: { device_fp: "fp-新取" } } } : { data: { retcode: 0, data: { ok: 1 } } }

  it("先获取指纹再请求接口，两次请求使用同一台设备", async () => {
    const { client, calls } = make(okReply)

    const res = await client.request("dailyNote", { uid: UID, cookie: COOKIE })

    expect(res.ok).toBe(true)
    expect(calls).toHaveLength(2)
    const device = deriveDevice("114514")
    // getFp 与业务请求须上报同一个 device_id
    expect((calls[0]?.opts.body as string).includes(device.id)).toBe(true)
    expect(calls[1]?.opts.headers?.["x-rpc-device_id"]).toBe(device.id)
    expect(calls[1]?.opts.headers?.["x-rpc-device_fp"]).toBe("fp-新取")
    expect(calls[1]?.opts.headers?.["x-rpc-device_model"]).toBe(device.spec.model)
  })

  it("指纹仅获取一次，后续请求复用", async () => {
    const { client, calls } = make(okReply)

    await client.request("dailyNote", { uid: UID, cookie: COOKIE })
    await client.request("index", { uid: UID, cookie: COOKIE })

    expect(calls.filter(c => isFp(c.url))).toHaveLength(1)
    expect(calls[2]?.opts.headers?.["x-rpc-device_fp"]).toBe("fp-新取")
  })

  it("URL 与 DS 逐字节对应：query 顺序不变，DS 形如 t,r,md5", async () => {
    const { client, calls } = make(okReply)

    await client.request("dailyNote", { uid: UID, cookie: COOKIE })

    const call = calls[1]
    expect(call?.url).toBe(
      `https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/dailyNote?role_id=${UID}&server=cn_gf01`
    )
    expect(call?.opts.method).toBe("GET")
    expect(call?.opts.headers?.["DS"]).toMatch(/^\d{10},\d{6},[0-9a-f]{32}$/)
    expect(call?.opts.headers?.["Cookie"]).toBe(COOKIE)
    expect(call?.opts.headers?.["x-rpc-app_version"]).toBe("2.40.1")
    expect(call?.opts.headers?.["x-rpc-client_type"]).toBe("5")
  })

  it("tail 那一段拼进 URL 但不进签名 —— 绝区零的 id_list 走的是它", async () => {
    const { client, calls } = make(okReply)
    // 绝区零国服 uid 是 8~9 位
    const zzzUid = "10000001"

    await client.request("avatarInfo", { uid: zzzUid, cookie: COOKIE, game: "zzz", data: { id_list: [1431, 1091] } })

    const call = calls[1]
    expect(call?.url).toBe(
      "https://api-takumi-record.mihoyo.com/event/game_record_zzz/api/zzz/avatar/info" +
        `?lang=zh-cn&role_id=${zzzUid}&server=prod_gf_cn&need_wiki=false&id_list[]=1431&id_list[]=1091`
    )
    // 签名只覆盖 tail 之前那一段
    const signed = signDs({
      query: `lang=zh-cn&role_id=${zzzUid}&server=prod_gf_cn&need_wiki=false`,
      salt: SALT_CN,
      time: Number(call?.opts.headers?.["DS"]?.split(",")[0]),
      random: Number(call?.opts.headers?.["DS"]?.split(",")[1])
    })
    expect(call?.opts.headers?.["DS"]).toBe(signed)
  })

  it("带 body 的接口使用 POST，并携带 Content-Type", async () => {
    const { client, calls } = make(okReply)

    await client.request("character", { uid: UID, cookie: COOKIE })

    expect(calls[1]?.opts.method).toBe("POST")
    expect(calls[1]?.opts.body).toBe(JSON.stringify({ role_id: UID, server: "cn_gf01" }))
    expect(calls[1]?.opts.headers?.["Content-Type"]).toBe("application/json")
  })

  it("国际服使用不同的域名、客户端标识与 UA", async () => {
    const { client, calls } = make(okReply)

    await client.request("dailyNote", { uid: "600000001", cookie: COOKIE })

    expect(calls[1]?.url.startsWith("https://bbs-api-os.hoyolab.com/")).toBe(true)
    expect(calls[1]?.opts.headers?.["x-rpc-client_type"]).toBe("2")
    expect(calls[1]?.opts.headers?.["User-Agent"]).toContain("miHoYoBBSOversea/2.55.0")
  })

  it("1034 仅更换指纹重试一次，设备保持不变", async () => {
    let hits = 0
    let fpSeq = 0
    const { client, calls } = make(url => {
      if (isFp(url)) return { data: { retcode: 0, data: { device_fp: `fp-${++fpSeq}` } } }
      hits += 1
      return hits === 1 ? { data: { retcode: 1034, message: "验证码" } } : { data: { retcode: 0, data: { ok: 1 } } }
    })
    const before = await devices.use("114514")

    const res = await client.request("dailyNote", { uid: UID, cookie: COOKIE })

    expect(res.ok).toBe(true)
    expect(calls.filter(c => isFp(c.url))).toHaveLength(2)
    expect(calls.at(-1)?.opts.headers?.["x-rpc-device_fp"]).toBe("fp-2")
    // 设备与首次分配时间均不得变更
    const after = await devices.use("114514")
    expect(after.id).toBe(before.id)
    expect(after.createdAt).toBe(before.createdAt)
  })

  it("-100 判定为 Cookie 失效，且不影响指纹", async () => {
    const { client } = make(url => (isFp(url) ? okReply(url) : { data: { retcode: -100, message: "请先登录" } }))

    const res = await client.request("dailyNote", { uid: UID, cookie: COOKIE })

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.kind).toBe("cookie")
    expect(res.retcode).toBe(-100)
    expect(res.message).toBe("请先登录")
    expect(await devices.fp("114514")).toBe("fp-新取")
  })

  it("retcode 分类：限额 / 未公开 / uid 不存在 / 请先登录 / 未知", async () => {
    const codes: [number, string][] = [
      [10101, "limit"],
      [10102, "private"],
      [1008, "notfound"],
      // 「请先登录」也是签名算错的表现，判成 cookie 会把好 CK 停掉
      [10001, "unknown"],
      [10103, "unknown"],
      [999999, "unknown"]
    ]
    for (const [retcode, kind] of codes) {
      const { client } = make(url => (isFp(url) ? okReply(url) : { data: { retcode } }))
      const res = await client.request("index", { uid: UID, cookie: COOKIE })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.kind).toBe(kind)
    }
  })

  it("非 2xx 与网络异常均归入 http，不误判为 Cookie 失效", async () => {
    const { client } = make(url => (isFp(url) ? okReply(url) : { status: 502, data: {} }))
    const bad = await client.request("index", { uid: UID, cookie: COOKIE })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.kind).toBe("http")

    const { client: boom } = make(url => (isFp(url) ? okReply(url) : new Error("socket hang up")))
    const err = await boom.request("index", { uid: UID, cookie: COOKIE })
    expect(err.ok).toBe(false)
    if (!err.ok) {
      expect(err.kind).toBe("http")
      expect(err.message).toBe("socket hang up")
    }
  })

  it("该游戏不存在的接口直接返回 unsupported，不发起请求", async () => {
    const { client, calls } = make(okReply)

    const res = await client.request("role_combat", { uid: "1000000001", cookie: COOKIE, game: "zzz" })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.kind).toBe("unsupported")
    expect(calls).toHaveLength(0)
  })

  it("只读接口使用缓存，写接口不缓存，不同游戏的缓存互不混淆", async () => {
    const { client, calls } = make(okReply, true)

    await client.request("dailyNote", { uid: UID, cookie: COOKIE })
    const second = await client.request("dailyNote", { uid: UID, cookie: COOKIE })

    expect(second.ok && second.cached).toBe(true)
    expect(calls.filter(c => !isFp(c.url))).toHaveLength(1)

    // 三个游戏的 uid 号段有重叠，切换游戏须打真实接口
    await client.request("dailyNote", { uid: UID, cookie: COOKIE, game: "sr" })
    expect(calls.filter(c => !isFp(c.url))).toHaveLength(2)

    await client.request("useCdk", { uid: "600000001", cookie: COOKIE, data: { cdk: "abc" } })
    await client.request("useCdk", { uid: "600000001", cookie: COOKIE, data: { cdk: "abc" } })
    expect(calls.filter(c => c.url.includes("webExchangeCdkeyHyl"))).toHaveLength(2)
  })

  it("缓存按持有者分开 —— 另一个 ltuid 查同一 uid 要打真实接口，不吃别人那份缓存", async () => {
    const { client, calls } = make(okReply, true)
    await client.request("dailyNote", { uid: UID, cookie: COOKIE })
    const other = COOKIE.replace(/ltuid=\d+/, "ltuid=99999999").replace(/ltuid_v2=\d+/, "ltuid_v2=99999999")
    expect(other).not.toBe(COOKIE)
    const got = await client.request("dailyNote", { uid: UID, cookie: other })
    expect(got.ok && got.cached).toBe(false)
    expect(calls.filter(c => !isFp(c.url))).toHaveLength(2)
  })

  it("不含 ltuid 的残缺 Cookie 同样具有稳定设备", async () => {
    const { client, calls } = make(okReply)
    const dirty = "mi18nLang=zh-cn"

    await client.request("dailyNote", { uid: UID, cookie: dirty })
    await client.request("index", { uid: UID, cookie: dirty })

    const ids = new Set(calls.filter(c => !isFp(c.url)).map(c => c.opts.headers?.["x-rpc-device_id"]))
    expect(ids.size).toBe(1)
    expect([...ids][0]).toBe(deriveDevice("uid:gs:100000001").id)
  })

  it("绑定真机后立即改用真机的 device_id", async () => {
    const { client, calls } = make(okReply)
    await devices.bind("114514", { id: "A1B2C3D4E5F60718", fp: "fp-真机" })

    await client.request("dailyNote", { uid: UID, cookie: COOKIE })

    expect(calls[0]?.opts.headers?.["x-rpc-device_id"]).toBe("A1B2C3D4E5F60718")
    expect(calls[0]?.opts.headers?.["x-rpc-device_fp"]).toBe("fp-真机")
    expect(calls.filter(c => isFp(c.url))).toHaveLength(0)
  })

  describe("活动页接口（带 etoken）", () => {
    const ZZZ_UID = "10000088"
    const isLogin = (url: string): boolean => url.includes("common/badge/v1/login/account")

    it("先登活动页、把下发的登录 cookie 并进 CK 再请求；同一账号第二次不再登", async () => {
      const { client, calls } = make(url => {
        if (isFp(url)) return okReply(url)
        if (isLogin(url)) return { data: { retcode: 0, data: {} }, headers: { "set-cookie": "e_nap_token=tok1; Path=/; Domain=.mihoyo.com; Expires=Wed, 21 Oct 2026 07:28:00 GMT" } }
        return { data: { retcode: 0, data: { list: [] } } }
      })
      const res = await client.request("cultivateDetail", { uid: ZZZ_UID, cookie: COOKIE, game: "zzz", data: { avatar_id: 1191 } })
      expect(res.ok).toBe(true)
      const login = calls.find(c => isLogin(c.url))
      expect(JSON.parse(String(login?.opts.body))).toMatchObject({ game_biz: "nap_cn", uid: ZZZ_UID })
      const api = calls.find(c => c.url.includes("batch_avatar_detail_v2"))
      expect(api?.opts.headers?.["Cookie"]).toContain("e_nap_token=tok1")
      expect(api?.opts.headers?.["Cookie"]).toContain("ltuid_v2=114514")

      await client.request("cultivateDetail", { uid: ZZZ_UID, cookie: COOKIE, game: "zzz", data: { avatar_id: 1191 } })
      expect(calls.filter(c => isLogin(c.url))).toHaveLength(1)
    })

    it("登了仍回 -100：重登一次，再不行归 unknown —— 不判 Cookie 失效", async () => {
      const { client, calls } = make(url => {
        if (isFp(url)) return okReply(url)
        if (isLogin(url)) return { data: { retcode: 0, data: {} }, headers: { "set-cookie": "e_nap_token=tok" } }
        return { data: { retcode: -100, message: "未登录" } }
      })
      const res = await client.request("cultivateDetail", { uid: ZZZ_UID, cookie: COOKIE, game: "zzz", data: { avatar_id: 1191 } })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.kind).toBe("unknown")
      expect(calls.filter(c => isLogin(c.url))).toHaveLength(2)
    })

    it("活动页登录本身失败也不判 Cookie 失效", async () => {
      const { client } = make(url => {
        if (isFp(url)) return okReply(url)
        if (isLogin(url)) return { data: { retcode: -100, message: "登录失效" } }
        return { data: { retcode: 0, data: {} } }
      })
      const res = await client.request("cultivateDetail", { uid: ZZZ_UID, cookie: COOKIE, game: "zzz", data: { avatar_id: 1191 } })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.kind).toBe("unknown")
    })
  })
})

describe("parseSetCookie / mergeCookie", () => {
  it("多条 Set-Cookie 并成一行时按「逗号 + 名=」分条，Expires 里的逗号不拆", () => {
    expect(parseSetCookie("a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/, b=2; Path=/, c=deleted")).toEqual({ a: "1", b: "2" })
  })

  it("同名以新值为准，其余原样保留", () => {
    expect(mergeCookie("ltuid=1; e_nap_token=old; x=y", { e_nap_token: "new" })).toBe("ltuid=1; x=y; e_nap_token=new")
  })
})
