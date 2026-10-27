/**
 * 模块职责：元素 / 命途互查的测试
 * 依赖方向：测试文件，依赖 meta/elem.ts
 * 生命周期：无状态
 * 注意事项：**两张表必须互不干扰** —— 原神与星铁共用"风火冰雷"四个中文名而键完全不同，合表则
 *          后者覆盖前者。故涉及这四个字的用例一律两个游戏各断言一次，且断言的是键而非"查得到"。
 */
import { describe, expect, it } from "vitest"
import { eachElem, elemName, elemOf, isElem, sameElem } from "./elem.js"

describe("elemOf", () => {
  it("键本身原样返回", () => {
    expect(elemOf("pyro")).toBe("pyro")
    expect(elemOf("fire", "", "sr")).toBe("fire")
  })

  it("星铁要收米游社的两套拼法 —— 战绩接口给 lightning / physical", () => {
    // 少收这一套的表现不是报错，而是那几张战绩图上雷系与物理角色的命途圆点整个不出现
    expect(elemOf("lightning", "", "sr")).toBe("elec")
    expect(elemOf("physical", "", "sr")).toBe("phy")
    expect(elemOf("Lightning", "", "sr")).toBe("elec")
    // 展示名仍取中文那一个，不因多收了别名而变
    expect(elemName("lightning", "", "sr")).toBe("雷")
    expect(elemName("physical", "", "sr")).toBe("物理")
  })

  it("中文别名转成键", () => {
    expect(elemOf("火")).toBe("pyro")
    expect(elemOf("雷电")).toBe("electro")
    expect(elemOf("须弥")).toBe("dendro")
  })

  it("同一个中文名在两个游戏里给出不同的键", () => {
    // 合表的话这两条必有一条会失败 —— 这正是不合表的理由
    expect(elemOf("火", "", "gs")).toBe("pyro")
    expect(elemOf("火", "", "sr")).toBe("fire")
    expect(elemOf("风", "", "gs")).toBe("anemo")
    expect(elemOf("风", "", "sr")).toBe("wind")
    expect(elemOf("雷", "", "gs")).toBe("electro")
    expect(elemOf("雷", "", "sr")).toBe("elec")
    expect(elemOf("冰", "", "gs")).toBe("cryo")
    expect(elemOf("冰", "", "sr")).toBe("ice")
  })

  it("原神的键在星铁表里查不到，反之亦然", () => {
    expect(elemOf("anemo", "", "sr")).toBe("")
    expect(elemOf("quantum", "", "gs")).toBe("")
  })

  it("大小写与首尾空格都不影响", () => {
    expect(elemOf("Pyro")).toBe("pyro")
    expect(elemOf("  ELECTRO  ")).toBe("electro")
    expect(elemOf("FIRE", "", "sr")).toBe("fire")
  })

  it("查不到时给出回落值", () => {
    expect(elemOf("不存在", "anemo")).toBe("anemo")
    expect(elemOf("")).toBe("")
  })
})

describe("elemName", () => {
  it("键转成展示名", () => {
    expect(elemName("pyro")).toBe("火")
    expect(elemName("quantum", "", "sr")).toBe("量子")
  })

  it("别名也能转成展示名", () => {
    // 「稻妻」是雷的别名，展示名取该元素的第一个别名而非传入的那个
    expect(elemName("稻妻")).toBe("雷")
  })

  it("查不到时给出回落值", () => {
    expect(elemName("不存在", "未知")).toBe("未知")
  })
})

describe("isElem", () => {
  it("认得键与别名", () => {
    expect(isElem("pyro")).toBe(true)
    expect(isElem("火")).toBe(true)
    expect(isElem("fire", "sr")).toBe(true)
  })

  it("不认得非元素的词条键", () => {
    expect(isElem("cpct")).toBe(false)
    expect(isElem("atk")).toBe(false)
  })

  it("按游戏区分", () => {
    expect(isElem("quantum", "gs")).toBe(false)
    expect(isElem("quantum", "sr")).toBe(true)
  })
})

describe("sameElem", () => {
  it("键与别名互认", () => {
    expect(sameElem("pyro", "火")).toBe(true)
    expect(sameElem("火", "纳塔")).toBe(true)
  })

  it("不同元素为假", () => {
    expect(sameElem("pyro", "cryo")).toBe(false)
  })

  it("两者都查不到时为假", () => {
    // 写成 `map[a] === map[b]` 时两个 undefined 相等，会把任意两个非元素键判成同元素，
    // 那会把不相干的词条折算进元素伤害
    expect(sameElem("atk", "cpct")).toBe(false)
    expect(sameElem("", "")).toBe(false)
  })

  it("一方查不到时为假", () => {
    expect(sameElem("pyro", "atk")).toBe(false)
  })
})

describe("eachElem", () => {
  it("原神七个元素，顺序与声明一致", () => {
    const got = eachElem("gs")
    expect(got).toHaveLength(7)
    expect(got[0]).toEqual({ key: "anemo", title: "风" })
    expect(got.map(it => it.key)).toContain("dendro")
  })

  it("星铁七个命途", () => {
    const got = eachElem("sr")
    expect(got).toHaveLength(7)
    expect(got.map(it => it.key)).toContain("imaginary")
  })
})
