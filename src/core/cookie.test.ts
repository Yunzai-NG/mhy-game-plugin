/**
 * 模块职责：Cookie 解析与账号标识提取的测试
 * 依赖方向：测试文件，只依赖 cookie.ts
 * 生命周期：纯函数，无夹具
 * 注意事项：账号标识是按人存储的主键，重点覆盖「同一份 Cookie 的各种不规范写法得出同一标识」——取错一次即被分到第二台设备，触发风控。
 */
import { describe, expect, it } from "vitest"
import { formatCookie, hasIllegalChar, hasLoginToken, normalizeCookie, parseCookie, pickAccountId, pickLtuid, pickStoken } from "./cookie.js"

describe("parseCookie", () => {
  it("按第一个等号拆分，键统一小写", () => {
    const pairs = parseCookie("ltuid_v2=114514; LTOKEN_V2=v2_aBc=; mi18nLang=zh-cn")

    expect(pairs.get("ltuid_v2")).toBe("114514")
    // 值自带 base64 填充的等号，按 split("=") 拆会截断 token
    expect(pairs.get("ltoken_v2")).toBe("v2_aBc=")
    expect(pairs.get("mi18nlang")).toBe("zh-cn")
  })

  it("跳过缺少值或缺少键的片段", () => {
    const pairs = parseCookie("; =x; ltuid=; ltuid_v2=1; ")

    expect(pairs.size).toBe(1)
    expect(pairs.get("ltuid_v2")).toBe("1")
  })
})

describe("normalizeCookie", () => {
  it("换行、重复键与末尾分号均规整为同一形态", () => {
    const messy = "ltuid_v2=114514;\r\nltoken_v2=abc;\nltuid_v2=114514;"

    expect(normalizeCookie(messy)).toBe("ltuid_v2=114514; ltoken_v2=abc")
  })

  it("不存在任何有效键时返回空串", () => {
    expect(normalizeCookie("  \n ; ; ")).toBe("")
  })
})

describe("formatCookie", () => {
  it("拼接后的文本可再次被解析", () => {
    const text = formatCookie(parseCookie("a=1; b=2"))

    expect(text).toBe("a=1; b=2")
  })
})

describe("pickLtuid", () => {
  it("v2 优先于 v1，两者均存在时取 v2", () => {
    expect(pickLtuid("ltuid=1; ltuid_v2=2")).toBe("2")
  })

  it("不存在数字 uid 时回落至 mid —— 纯 v2 的 Cookie 中仅其稳定", () => {
    expect(pickLtuid("ltoken_v2=abc; ltmid_v2=m1_zzz")).toBe("m1_zzz")
  })

  it("键顺序不影响结果", () => {
    const a = pickLtuid("account_id=9; ltuid_v2=114514; ltoken=x")
    const b = pickLtuid("ltoken=x; ltuid_v2=114514; account_id=9")

    expect(a).toBe("114514")
    expect(b).toBe(a)
  })

  it("一个均不存在时返回 undefined", () => {
    expect(pickLtuid("mi18nLang=zh-cn")).toBeUndefined()
  })
})

describe("pickAccountId", () => {
  it("仅识别数字 uid，不回落至 mid", () => {
    expect(pickAccountId("ltuid_v2=114514")).toBe("114514")
    expect(pickAccountId("ltmid_v2=m1_zzz")).toBeUndefined()
    expect(pickAccountId("ltuid=m1_zzz; account_id=9527")).toBe("9527")
  })
})

describe("hasLoginToken / pickStoken", () => {
  it("缺少登录态键时即时拦截，而非等待接口返回 -100", () => {
    expect(hasLoginToken("ltuid_v2=1; ltoken_v2=abc")).toBe(true)
    expect(hasLoginToken("ltuid_v2=1; cookie_token=abc")).toBe(true)
    expect(hasLoginToken("ltuid_v2=1")).toBe(false)
  })

  it("stoken 取 v2 优先", () => {
    expect(pickStoken("stoken=v1; stoken_v2=v2")).toBe("v2")
    expect(pickStoken("stoken=v1")).toBe("v1")
    expect(pickStoken("ltuid=1")).toBeUndefined()
  })
})

describe("粘贴失误的两种形态", () => {
  it("字面量 undefined 视同这一项没有 —— 否则会带着无效 token 一路发到米游社", () => {
    const cookie = "ltoken=undefined; ltuid=100000088; cookie_token=abc"
    expect(parseCookie(cookie).has("ltoken")).toBe(false)
    expect(hasLoginToken(cookie)).toBe(true)
    expect(hasLoginToken("ltuid=1; ltoken=undefined")).toBe(false)
  })

  it("不可见字符在规范化时就剔掉 —— 它们在 HTTP 头里是非法字符，而肉眼看不出来", () => {
    const zeroWidth = String.fromCodePoint(0x200b)
    const rtl = String.fromCodePoint(0x202d)
    const got = normalizeCookie(`ltuid=${zeroWidth}100000088${rtl}; ltoken=abc`)

    expect(got).toBe("ltuid=100000088; ltoken=abc")
    expect(hasIllegalChar(got)).toBe(false)
  })

  it("混进中文时明确报出来，不留给请求层", () => {
    expect(hasIllegalChar("ltuid=1; ltoken=你好")).toBe(true)
    expect(hasIllegalChar("ltuid=1; ltoken=abc==")).toBe(false)
  })
})
