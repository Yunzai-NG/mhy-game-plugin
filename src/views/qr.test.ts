/**
 * 模块职责：扫码登录卡片视图的测试
 * 依赖方向：测试文件，只依赖 views/qr
 * 生命周期：无状态
 * 注意事项：固定两处口径：**标识码只露平台与尾四位**（整串印在群里等于公开它），
 *          以及**文字回退自成完整答案**（出不了图时使用者只有这段话）。
 */
import { describe, expect, it } from "vitest"
import { buildQrCard, maskAccount, qrCardText } from "./qr.js"

/** 一条真实形态的登录地址 */
const URL = "https://user.mihoyo.com/qr_code_in_game.html?app_id=8&biz_key=bbs_cn&ticket=0123456789abcdef"

describe("maskAccount", () => {
  it("只留平台名与尾四位 —— 整串印在群里等于公开它", () => {
    expect(maskAccount("qq:123456789")).toBe("qq:****6789")
  })

  it("短账号原样留用 —— 遮成一片星号就核对不了", () => {
    expect(maskAccount("qq:88")).toBe("qq:88")
  })

  it("没有平台前缀时只处理账号那一半", () => {
    expect(maskAccount("123456789")).toBe("****6789")
  })
})

describe("buildQrCard", () => {
  it("给出 SVG、标识码与有效期，说明逐条画在图里", () => {
    const view = buildQrCard(URL, "qq:123456789")

    expect(view.svg).toContain("<svg")
    expect(view.code).toBe("qq:****6789")
    expect(view.expire).toContain("3 分钟")
    // 头两条是警示：扫错的后果与 stoken 的权限，模板据 warn 改色
    expect(view.tips.filter(one => one.warn).length).toBeGreaterThanOrEqual(2)
    expect(view.tips.some(one => one.text.includes("标识码"))).toBe(true)
  })

  it("有效期分钟数可改 —— 轮询上限变了这句话要跟着变", () => {
    expect(buildQrCard(URL, "qq:1", { minutes: 5 }).expire).toContain("5 分钟")
  })
})

describe("qrCardText", () => {
  it("回退文字自带标识码与每条说明 —— 出不了图时只有它", () => {
    const text = qrCardText(buildQrCard(URL, "qq:123456789"))

    expect(text).toContain("qq:****6789")
    expect(text).toContain("扫错")
    expect(text).toContain("stoken")
    expect(text).toContain("#删除CK")
  })
})
