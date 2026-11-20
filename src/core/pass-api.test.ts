/**
 * 模块职责：验证通行证换查询 Cookie 的请求形态
 * 依赖方向：依赖 core/pass-api 与 core/ds，HTTP 不出网
 * 生命周期：无状态
 * 注意事项：凭据只进 Cookie 请求头；接口地址、设备与签名必须一致，否则确认扫码后仍换不到查询凭据。
 */
import { describe, expect, it } from "vitest"
import { SALT_PASS, signDs } from "./ds.js"
import { cookieTokenRequest } from "./pass-api.js"

/** 换凭据使用的设备 */
const DEVICE = { id: "TESTDEVICE", name: "HUAWEI P40", model: "ANA-AN00", fp: "TESTFP" }

/** 已确认登录的凭据 */
const STOKEN = { stuid: "100000088", stoken: "v2_SECRET", mid: "m1_secret" }

describe("cookieTokenRequest", () => {
  it("走通行证接口，凭据只进 Cookie 请求头", () => {
    const req = cookieTokenRequest(DEVICE, STOKEN)

    expect(req.url).toBe("https://passport-api.mihoyo.com/account/auth/api/getCookieAccountInfoBySToken")
    expect(req.method).toBe("GET")
    expect(req.body).toBeUndefined()
    expect(req.headers.Cookie).toBe("stuid=100000088;stoken=v2_SECRET;mid=m1_secret;")
    expect(req.url).not.toContain(STOKEN.stoken)
    expect(req.url).not.toContain(STOKEN.mid)
  })

  it("带同一台设备的通行证请求头，DS 覆盖空 query 与空 body", () => {
    const req = cookieTokenRequest(DEVICE, STOKEN)

    expect(req.headers).toMatchObject({
      "x-rpc-app_version": "2.112.0",
      "x-rpc-app_id": "bll8iq97cem8",
      "x-rpc-device_id": DEVICE.id,
      "x-rpc-device_name": DEVICE.name,
      "x-rpc-device_model": DEVICE.model,
      "x-rpc-device_fp": DEVICE.fp,
      "x-rpc-aigis": "",
      Accept: "application/json"
    })
    const [time, random] = req.headers.DS!.split(",")
    expect(req.headers.DS).toBe(signDs({ salt: SALT_PASS, time: Number(time), random: Number(random), query: "", body: "" }))
  })

  it("没有 mid 时不拼入 undefined，也不丢 stuid 与 stoken", () => {
    const req = cookieTokenRequest(DEVICE, { stuid: "100000088", stoken: "OLD_SECRET" })

    expect(req.headers.Cookie).toBe("stuid=100000088;stoken=OLD_SECRET;")
  })
})
