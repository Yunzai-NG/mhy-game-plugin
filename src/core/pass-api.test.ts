/**
 * 模块职责：验证通行证换查询 Cookie 的请求形态
 * 依赖方向：依赖 core/pass-api 与 core/ds，HTTP 不出网
 * 生命周期：无状态
 * 注意事项：stoken 只进签名请求体；接口地址、设备与请求体签名必须一致，否则换不到查询凭据。
 */
import { describe, expect, it } from "vitest"
import { SALT_PASS, signDs } from "./ds.js"
import { cookieTokenRequest } from "./pass-api.js"

/** 换凭据使用的设备 */
const DEVICE = { id: "TESTDEVICE", name: "HUAWEI P40", model: "ANA-AN00", fp: "TESTFP" }

/** 已确认登录的凭据 */
const STOKEN = { stuid: "100000088", stoken: "v2_SECRET", mid: "m1_secret" }

describe("cookieTokenRequest", () => {
  it("走通行证 exchange，用请求体携带目标 token 类型与来源 stoken", () => {
    const req = cookieTokenRequest(DEVICE, STOKEN)

    expect(req.url).toBe("https://passport-api.mihoyo.com/account/ma-cn-session/app/exchange")
    expect(req.method).toBe("POST")
    expect(JSON.parse(req.body ?? "null")).toEqual({
      src_token: { token: "v2_SECRET", token_type: 1 },
      mid: "m1_secret",
      dst_token_type: 4
    })
    expect(req.url).not.toContain(STOKEN.stoken)
    expect(req.url).not.toContain(STOKEN.mid)
  })

  it("DS 覆盖实际 POST body", () => {
    const req = cookieTokenRequest(DEVICE, STOKEN)

    expect(req.headers).toMatchObject({
      "x-rpc-app_version": "2.112.0",
      "x-rpc-app_id": "bll8iq97cem8",
      "x-rpc-device_id": DEVICE.id,
      "x-rpc-device_name": DEVICE.name,
      "x-rpc-device_model": DEVICE.model,
      "x-rpc-device_fp": DEVICE.fp,
      "x-rpc-aigis": ""
    })
    const [time, random] = req.headers.DS!.split(",")
    expect(req.headers.DS).toBe(signDs({ salt: SALT_PASS, time: Number(time), random: Number(random), query: "", body: req.body! }))
  })

  it("没有 mid 时请求体里不出现 undefined", () => {
    const req = cookieTokenRequest(DEVICE, { stuid: "100000088", stoken: "OLD_SECRET" })

    expect(JSON.parse(req.body ?? "null")).toEqual({
      src_token: { token: "OLD_SECRET", token_type: 1 },
      dst_token_type: 4
    })
  })
})
