/**
 * 模块职责：等级属性插值的测试
 * 依赖方向：测试文件，依赖 panel/level.ts
 * 生命周期：无状态
 * 注意事项：固定三套算法各自的口径，它们**看着相似而结果不同**，混用只差几个点：角色前三项走线性
 *          插值、第四项走每五级一档自左往右的阶梯、武器副属性走自右往左的阶梯。另有一项：同一等级
 *          在"已突破"与"未突破"下白值不同，故左端点要先试 `<等级>+` 再试裸等级。逐值另由差分核对
 *          保障，本文件只固定判别性场景。
 */
import { describe, expect, it } from "vitest"
import {
  calcPromote,
  fourthIsBase,
  gsCharLevelAttr,
  gsWeaponAttr,
  srLevelAttr,
  type GsCharAttr
} from "./level.js"

/** 一份构造的原神角色属性段：四项分别是生命、攻击、防御、暴击伤害 */
const CHAR: GsCharAttr = {
  keys: ["hpBase", "atkBase", "defBase", "cdmg"],
  details: {
    "1": [1000, 10, 100, 0],
    "20": [2000, 20, 200, 0],
    "20+": [2500, 25, 250, 0],
    "40": [4000, 40, 400, 10],
    "40+": [4400, 44, 440, 20],
    "50": [5000, 50, 500, 30]
  }
}

describe("calcPromote", () => {
  it("按等级反推突破阶数", () => {
    // 接口有时只给等级不给突破阶数
    expect(calcPromote(1)).toBe(0)
    expect(calcPromote(20)).toBe(0)
    expect(calcPromote(21)).toBe(1)
    expect(calcPromote(90)).toBe(6)
  })

  it("星铁的档位与原神不同", () => {
    // 星铁 20 之后是 30，原神是 40
    expect(calcPromote(30, "sr")).toBe(1)
    expect(calcPromote(30, "gs")).toBe(1)
    expect(calcPromote(31, "sr")).toBe(2)
    expect(calcPromote(31, "gs")).toBe(1)
  })
})

describe("gsCharLevelAttr 前三项线性插值", () => {
  it("落在档位上时取该档的值", () => {
    const got = gsCharLevelAttr(CHAR, 1, 0)
    expect(got["hpBase"]).toBe(1000)
    expect(got["atkBase"]).toBe(10)
  })

  it("档位之间按等级线性插值", () => {
    // 期望值写成常数而非同一个公式：拿实现里的算式当期望值，等于让它自己证明自己
    const got = gsCharLevelAttr(CHAR, 10, 0)
    expect(got["hpBase"]).toBeCloseTo(1473.684_211, 6)
    expect(got["defBase"]).toBeCloseTo(147.368_421, 6)
  })

  it("已突破时左端点取 `<等级>+` 那一份", () => {
    // 同为 20 级：未突破取 2000，已突破取 2500 —— 这是"满级未突破"与"刚突破"的差别
    expect(gsCharLevelAttr(CHAR, 20, 0)["hpBase"]).toBe(2000)
    expect(gsCharLevelAttr(CHAR, 20, 1)["hpBase"]).toBe(2500)
  })
})

describe("gsCharLevelAttr 第四项阶梯插值", () => {
  it("每五级跳一档而非线性", () => {
    // 40 → 50 之间，第四项自 20 到 30，两档；44 级与 40 级同档
    expect(gsCharLevelAttr(CHAR, 40, 2)["cdmg"]).toBe(20)
    expect(gsCharLevelAttr(CHAR, 44, 2)["cdmg"]).toBe(20)
    // 45 级进下一档
    expect(gsCharLevelAttr(CHAR, 45, 2)["cdmg"]).toBe(25)
    expect(gsCharLevelAttr(CHAR, 49, 2)["cdmg"]).toBe(25)
  })

  it("阶梯与线性在同一等级上给出不同的值", () => {
    // 这一条是判别性的：若第四项误用线性，44 级会得到 28 而非 20
    const got = gsCharLevelAttr(CHAR, 44, 2)["cdmg"] ?? 0
    const linear = 20 + (30 - 20) * (44 - 40) / (50 - 40)
    expect(got).toBe(20)
    expect(got).not.toBeCloseTo(linear, 6)
  })
})

describe("fourthIsBase", () => {
  it("生命 / 攻击 / 防御的百分比加成不算白值", () => {
    expect(fourthIsBase("hpPct")).toBe(false)
    expect(fourthIsBase("atkPct")).toBe(false)
    expect(fourthIsBase("defPct")).toBe(false)
  })

  it("其余属性算白值", () => {
    expect(fourthIsBase("cdmg")).toBe(true)
    expect(fourthIsBase("mastery")).toBe(true)
    expect(fourthIsBase("recharge")).toBe(true)
  })
})

describe("srLevelAttr", () => {
  it("按该阶基础值加每级成长值累加", () => {
    const attr = { "0": { attrs: { atk: 100, hp: 200 }, grow: { atk: 10, hp: 20 } } }
    // 11 级：100 + 10 * (11 - 1)
    const got = srLevelAttr(attr, 11, 0)
    expect(got["atk"]).toBe(200)
    expect(got["hp"]).toBe(400)
  })

  it("一级时不累加成长值", () => {
    const attr = { "0": { attrs: { atk: 100 }, grow: { atk: 10 } } }
    expect(srLevelAttr(attr, 1, 0)["atk"]).toBe(100)
  })

  it("突破阶数决定取哪一段", () => {
    const attr = {
      "0": { attrs: { atk: 100 } },
      "1": { attrs: { atk: 300 } }
    }
    expect(srLevelAttr(attr, 20, 0)["atk"]).toBe(100)
    expect(srLevelAttr(attr, 20, 1)["atk"]).toBe(300)
  })

  it("光锥的成长值另传一份而不取段内的", () => {
    // 光锥的 growAttr 在顶层，角色的 grow 在 attr[promote] 里
    const attr = { "0": { attrs: { atk: 100 }, grow: { atk: 1 } } }
    expect(srLevelAttr(attr, 11, 0, { atk: 10 })["atk"]).toBe(200)
  })

  it("该阶不存在时给空表而不抛错", () => {
    expect(srLevelAttr({}, 20, 3)).toEqual({})
  })
})

describe("gsWeaponAttr", () => {
  /** 一份构造的武器属性段 */
  const W = {
    atk: { "1": 40, "20": 100, "20+": 130, "40": 200 },
    bonusKey: "recharge",
    bonusData: { "1": 10, "20": 20, "20+": 20, "40": 30 }
  }

  it("基础攻击按等级线性插值", () => {
    expect(gsWeaponAttr(W, 1, 0).atkBase).toBe(40)
    expect(gsWeaponAttr(W, 20, 0).atkBase).toBe(100)
  })

  it("已突破时取 `<等级>+` 那一份", () => {
    expect(gsWeaponAttr(W, 20, 1).atkBase).toBe(130)
  })

  it("副属性自右端点往回数档", () => {
    // 20 → 40 共四档（ceil(20 / 5)），每档 (30 - 20) / 4 = 2.5
    // 40 级即最后一档：20 + (4 - ceil(0 / 5)) * 2.5 = 30
    expect(gsWeaponAttr(W, 40, 1).attr?.value).toBeCloseTo(30, 6)
    // 21 级：20 + (4 - ceil(19 / 5)) * 2.5 = 20 + (4 - 4) * 2.5 = 20
    expect(gsWeaponAttr(W, 21, 1).attr?.value).toBeCloseTo(20, 6)
  })

  it("副属性给出声明的键", () => {
    expect(gsWeaponAttr(W, 40, 1).attr?.key).toBe("recharge")
  })

  it("promote 传 -1 时取第一个包含该等级的区间", () => {
    // 接口不给武器突破时用它：20 级落在 1–20，故取未突破那一份
    expect(gsWeaponAttr(W, 20, -1).atkBase).toBe(100)
  })

  it("没有副属性段时只给基础攻击", () => {
    expect(gsWeaponAttr({ atk: { "1": 40, "20": 100 } }, 20, 0).attr).toBeUndefined()
  })

  it("属性段为空时不抛错", () => {
    expect(gsWeaponAttr({}, 90, -1).atkBase).toBe(0)
  })
})
