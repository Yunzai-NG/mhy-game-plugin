/**
 * 模块职责：换 authkey 服务的测试
 * 依赖方向：测试文件，依赖 service/authkey，HTTP 与设备都是假的
 * 生命周期：无状态
 * 注意事项：固定几处**改了不报错、只会回一句 10001「请先登录」**的口径：签名是 DS1
 *          （`t,r,md5` 三段）、`x-rpc-client_type` 为 5、Cookie 是传入的 stoken 原样、
 *          region 与 game_biz 随 uid 与国服/国际服变。另固定 10001 要翻成"stoken 已失效"。
 */
import { describe, expect, it } from "vitest"
import type { HttpClient } from "@yunzai-ng/types"
import type { DeviceStore } from "../core/device.js"
import { AuthKeyService } from "./authkey.js"

/** 不出声的日志器 */
const LOGGER = {
  debug: (): void => undefined,
  info: (): void => undefined,
  mark: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  trace: (): void => undefined,
  fatal: (): void => undefined
}

/** 假设备存储：恒给同一台设备 */
const DEVICES = {
  use: async (): Promise<{ id: string; name: string; spec: { model: string } }> => ({
    id: "TESTDEVICE",
    name: "HUAWEI P40",
    spec: { model: "ANA-AN00" }
  })
} as unknown as DeviceStore

/** 记下来的一次请求 */
interface Call {
  /** 完整 URL */
  url: string
  /** 请求方法 */
  method?: string
  /** 请求头 */
  headers: Record<string, string>
  /** 请求体 */
  body?: string
}

/**
 * 造一个假 HTTP 与一个换 authkey 服务
 * @param reply 让 genAuthKey 返回什么信封；`http` 传 false 则让请求整体失败
 * @returns 服务与调用记录
 */
function make(reply: unknown = { retcode: 0, message: "OK", data: { authkey: "authkey-xyz==" } }, http = true): {
  service: AuthKeyService
  calls: Call[]
} {
  const calls: Call[] = []
  const client = {
    request: async <T,>(url: string, opts: { method?: string; headers: Record<string, string>; body?: string }): Promise<T> => {
      calls.push({ url, ...(opts.method ? { method: opts.method } : {}), headers: opts.headers, ...(opts.body ? { body: opts.body } : {}) })
      return { ok: http, status: http ? 200 : 503, data: reply } as T
    }
  } as unknown as HttpClient
  return { service: new AuthKeyService({ http: client, devices: DEVICES, logger: LOGGER as never }), calls }
}

describe("AuthKeyService", () => {
  it("原神国服：打 api-takumi 的 genAuthKey，body 带 hk4e_cn 与数字 game_uid，返回 authkey 与 region", async () => {
    const { service, calls } = make()
    const got = await service.generate("gs", "100000001", "ltuid-1", "stoken=v2_x;stuid=1;mid=m1;")

    expect(got.ok).toBe(true)
    expect(got.authkey).toBe("authkey-xyz==")
    expect(got.region).toBe("cn_gf01")

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.url).toBe("https://api-takumi.mihoyo.com/binding/api/genAuthKey")
    expect(call.method).toBe("POST")
    const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>
    expect(body["auth_appid"]).toBe("webview_gacha")
    expect(body["game_biz"]).toBe("hk4e_cn")
    expect(body["game_uid"]).toBe(100000001)
    expect(body["region"]).toBe("cn_gf01")
  })

  it("请求头固定：client_type 5、DS1 三段签名、Cookie 是传入的 stoken 原样", async () => {
    const { service, calls } = make()
    await service.generate("gs", "100000001", "ltuid-1", "stoken=v2_x;stuid=1;mid=m1;")

    const h = calls[0]!.headers
    expect(h["x-rpc-client_type"]).toBe("5")
    // DS1：时间戳,六位随机串,32 位 md5
    expect(h["DS"]).toMatch(/^\d+,[a-z0-9]{6},[a-f0-9]{32}$/)
    expect(h["Cookie"]).toBe("stoken=v2_x;stuid=1;mid=m1;")
  })

  it("星铁与绝区零：game_biz 换成各自的业务前缀", async () => {
    const sr = make()
    await sr.service.generate("sr", "100000001", "ltuid-1", "stoken=v2_x;")
    expect((JSON.parse(sr.calls[0]!.body ?? "{}") as Record<string, unknown>)["game_biz"]).toBe("hkrpg_cn")

    const zzz = make()
    const got = await zzz.service.generate("zzz", "10000001", "ltuid-1", "stoken=v2_x;")
    expect((JSON.parse(zzz.calls[0]!.body ?? "{}") as Record<string, unknown>)["game_biz"]).toBe("nap_cn")
    expect(got.region).toBe("prod_gf_cn")
  })

  it("国际服：换 sg-public-api 域名、game_biz 带 global", async () => {
    const { service, calls } = make()
    // 绝区零 10 位、前缀 10 即美服
    const got = await service.generate("zzz", "1000000001", "ltuid-1", "stoken=v2_x;")

    expect(calls[0]!.url).toBe("https://sg-public-api.hoyolab.com/binding/api/genAuthKey")
    expect((JSON.parse(calls[0]!.body ?? "{}") as Record<string, unknown>)["game_biz"]).toBe("nap_global")
    expect(got.region).toBe("prod_gf_us")
  })

  it("10001 翻成「stoken 已失效」这句可操作的提示，而非原样抛码", async () => {
    const { service } = make({ retcode: 10001, message: "Please login", data: null })
    const got = await service.generate("gs", "100000001", "ltuid-1", "stoken=bad;")

    expect(got.ok).toBe(false)
    expect(got.authkey).toBeUndefined()
    expect(got.message).toContain("stoken 已失效")
  })

  it("网络层失败时不抛错，给一句可读提示", async () => {
    const { service } = make({}, false)
    const got = await service.generate("gs", "100000001", "ltuid-1", "stoken=x;")

    expect(got.ok).toBe(false)
    expect(got.message).toContain("米游社没有回应")
  })
})
