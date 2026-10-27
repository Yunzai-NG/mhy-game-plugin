/**
 * 模块职责：小组件接口的地址、Cookie 与签名的测试
 * 依赖方向：测试文件，只依赖 core/widget-api 与 node:crypto
 * 生命周期：无状态
 * 注意事项：固定两处**错了不报错、只回一句"请先登录"**的地方：星铁与另两个游戏是两套签名（DS2 + x6 盐 / DS1 + k2 盐），用错即 `retcode: 10001`，与 stoken 失效同形；Cookie 只能是 `stuid` / `stoken` / `mid` 三项，多带别的键会被判成另一种登录态。
 */
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  SALT_WIDGET_K2,
  SALT_WIDGET_X6,
  widgetCookie,
  widgetDs,
  widgetHeaders,
  widgetUrl
} from "./widget-api.js"

describe("widgetUrl", () => {
  it("三个游戏各一条，都是国服域名", () => {
    expect(widgetUrl("gs")).toBe("https://api-takumi-record.mihoyo.com/game_record/genshin/aapi/widget/v2")
    expect(widgetUrl("sr")).toBe("https://api-takumi-record.mihoyo.com/game_record/app/hkrpg/aapi/widget")
    expect(widgetUrl("zzz")).toBe("https://api-takumi-record.mihoyo.com/event/game_record_zzz/api/zzz/widget")
  })
})

describe("widgetCookie", () => {
  it("没有 stoken 就用不了小组件 —— 明确返回 undefined 让调用方退回实时便笺", () => {
    expect(widgetCookie("ltuid_v2=1001; ltoken_v2=abc")).toBeUndefined()
    expect(widgetCookie("")).toBeUndefined()
  })

  it("只拼那三项，别的键一个都不带", () => {
    const got = widgetCookie("ltuid_v2=1001; ltoken_v2=zzz; stoken=v2_abc; mid=m1_xyz; cookie_token=nope")

    expect(got).toBe("stuid=1001;stoken=v2_abc;mid=m1_xyz;")
    expect(got).not.toContain("ltoken")
    expect(got).not.toContain("cookie_token")
  })

  it("stoken_v2 优先，stuid 缺失时退到 ltuid", () => {
    expect(widgetCookie("stuid=7; stoken=old; stoken_v2=v2_new")).toBe("stuid=7;stoken=v2_new;")
    expect(widgetCookie("ltuid=1001; stoken=abc")).toBe("stuid=1001;stoken=abc;")
    expect(widgetCookie("account_id=1001; stoken=abc")).toBe("stuid=1001;stoken=abc;")
  })

  it("mid 取不到时不拼它 —— 老式 stoken 本就不需要", () => {
    expect(widgetCookie("stuid=1001; stoken=abc")).toBe("stuid=1001;stoken=abc;")
    expect(widgetCookie("stuid=1001; stoken=abc; ltmid_v2=m1_q")).toBe("stuid=1001;stoken=abc;mid=m1_q;")
  })

  it("认不出账号 id 时也返回 undefined —— 光有 stoken 发不出请求", () => {
    expect(widgetCookie("stoken=v2_abc; mid=m1_xyz")).toBeUndefined()
  })
})

describe("widgetDs", () => {
  it("原神与绝区零走 DS1 + k2 盐 —— 随机串是六位小写字母数字", () => {
    for (const game of ["gs", "zzz"] as const) {
      const [t, r, hash] = widgetDs(game).split(",")
      expect(r).toMatch(/^[a-z0-9]{6}$/)
      expect(hash).toBe(createHash("md5").update(`salt=${SALT_WIDGET_K2}&t=${t}&r=${r}`).digest("hex"))
    }
  })

  it("星铁走 DS2 + x6 盐 —— 随机串是六位数字，且要带上空的 b 与 q", () => {
    const [t, r, hash] = widgetDs("sr").split(",")

    expect(r).toMatch(/^[0-9]{6}$/)
    expect(hash).toBe(createHash("md5").update(`salt=${SALT_WIDGET_X6}&t=${t}&r=${r}&b=&q=`).digest("hex"))
  })

  it("两套盐不同 —— 混用的表现是 10001「请先登录」，与 stoken 失效完全相同", () => {
    expect(SALT_WIDGET_K2).not.toBe(SALT_WIDGET_X6)
  })
})

describe("widgetHeaders", () => {
  const device = { id: "abcdef12-3456-7890-abcd-ef1234567890", name: "yz", model: "Mi 10" }

  it("走 App 侧那套请求头，且设备号大写", () => {
    const got = widgetHeaders("gs", "stuid=1;stoken=v2_a;", device)

    expect(got["x-rpc-client_type"]).toBe("2")
    expect(got["x-rpc-channel"]).toBe("miyousheluodi")
    expect(got["Referer"]).toBe("https://app.mihoyo.com")
    expect(got["User-Agent"]).toBe("okhttp/4.8.0")
    expect(got["x-rpc-device_id"]).toBe(device.id.toUpperCase())
    expect(got["x-rpc-device_model"]).toBe("Mi 10")
    expect(got["Cookie"]).toBe("stuid=1;stoken=v2_a;")
    expect(got["DS"]).toMatch(/^\d+,[a-z0-9]{6},[0-9a-f]{32}$/)
  })

  it("星铁那一支换的是 DS 而不是别的头", () => {
    const gs = widgetHeaders("gs", "stuid=1;stoken=v2_a;", device)
    const sr = widgetHeaders("sr", "stuid=1;stoken=v2_a;", device)

    expect(sr["DS"]).toMatch(/^\d+,\d{6},[0-9a-f]{32}$/)
    expect(sr["x-rpc-channel"]).toBe(gs["x-rpc-channel"])
    expect(sr["User-Agent"]).toBe(gs["User-Agent"])
  })
})
