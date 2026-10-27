/**
 * 模块职责：面板属性累加器的测试
 * 依赖方向：测试文件，依赖 panel/attr-data.ts
 * 生命周期：无状态
 * 注意事项：固定四项口径，每项对应一类**不报错但数值错**的失手：取值公式为
 *          `base * (1 + pct / 100) + plus`、裸键落到 `plus` 而非 `base`（想加白值须显式写 Base）、
 *          `setAttr(withBase)` 把结果值拆成白值加加值（少这一步白值会重复计一次）、星铁把同元素
 *          伤害折算成 `dmg` 而原神不折算。
 */
import { describe, expect, it } from "vitest"
import { AttrData, GS_ATTR_KEYS, SR_ATTR_KEYS } from "./attr-data.js"

describe("AttrData 取值公式", () => {
  it("三个分量按 base * (1 + pct / 100) + plus 合成", () => {
    const d = new AttrData("gs")
    d.addAttr("atkBase", 800)
    d.addAttr("atkPct", 50)
    d.addAttr("atkPlus", 100)
    // 800 * 1.5 + 100
    expect(d.get("atk")).toBe(1300)
  })

  it("只有白值时结果等于白值", () => {
    const d = new AttrData("gs")
    d.addAttr("atkBase", 800)
    expect(d.get("atk")).toBe(800)
  })

  it("百分比乘的是白值而非白值加加值", () => {
    // 这一条区分两种写法：若 pct 乘到 (base + plus) 上，下面会得到 1650 而非 1300
    const d = new AttrData("gs")
    d.addAttr("atkBase", 800)
    d.addAttr("atkPlus", 300)
    d.addAttr("atkPct", 50)
    expect(d.get("atk")).toBe(1500)
  })

  it("裸键落到 plus 而不是 base", () => {
    // addAttr("atk", n) 是加固定值，不是加白值
    const d = new AttrData("gs")
    d.addAttr("atk", 100)
    expect(d.get("atkPlus")).toBe(100)
    expect(d.get("atkBase")).toBe(0)
  })

  it("同一分量可累加", () => {
    const d = new AttrData("gs")
    d.addAttr("cpct", 5)
    d.addAttr("cpct", 20)
    expect(d.get("cpct")).toBe(25)
  })

  it("认得 Base / Plus / Pct / Inc 四个后缀", () => {
    // Inc 不参与取值也无人读，但元数据确有条目写它：
    // 不认这个后缀会使 addAttr 返回 false，调用方据此判定"未识别的属性"
    const d = new AttrData("gs")
    for (const suffix of ["Base", "Plus", "Pct", "Inc"]) {
      expect(d.addAttr(`atk${suffix}`, 1)).toBe(true)
    }
  })

  it("不认得的键返回 false 且不影响其他项", () => {
    const d = new AttrData("gs")
    expect(d.addAttr("完全不存在的键", 100)).toBe(false)
    expect(d.get("完全不存在的键")).toBeUndefined()
  })
})

describe("AttrData 白值表", () => {
  it("显式写 Base 的自动计入白值表", () => {
    const d = new AttrData("gs")
    d.addAttr("atkBase", 800)
    expect(d.getBase()["atk"]).toBe(800)
  })

  it("isBase 为真时裸键也计入白值表", () => {
    const d = new AttrData("gs")
    d.addAttr("cpct", 5, true)
    expect(d.getBase()["cpct"]).toBe(5)
  })

  it("isBase 为假时不计入白值表", () => {
    const d = new AttrData("gs")
    d.addAttr("atkPlus", 100)
    expect(d.getBase()["atk"]).toBe(0)
  })
})

describe("AttrData setAttr", () => {
  it("withBase 把结果值拆成白值与加值", () => {
    // 接口给的面板是结果值，减去白值才是加值；少这一步白值会被重复计一次
    const d = new AttrData("gs", {}, { atk: 1300, atkBase: 800 })
    expect(d.get("atkBase")).toBe(800)
    expect(d.get("atkPlus")).toBe(500)
    expect(d.get("atk")).toBe(1300)
  })

  it("withBase 为假时 atk 按加值处理", () => {
    const d = new AttrData("gs")
    d.setAttr({ atk: 1300 }, false)
    expect(d.get("atkPlus")).toBe(1300)
    expect(d.get("atkBase")).toBe(0)
  })

  it("只给结果值而没有白值时不拆", () => {
    const d = new AttrData("gs", {}, { atk: 1300 })
    expect(d.get("atkPlus")).toBe(1300)
  })
})

describe("AttrData 星铁的元素折算", () => {
  it("与角色同元素的伤害加成记作 dmg", () => {
    const d = new AttrData("sr", { elem: "fire" })
    d.addAttr("fire", 20)
    expect(d.get("dmg")).toBe(20)
  })

  it("不同元素的伤害加成不折算", () => {
    const d = new AttrData("sr", { elem: "fire" })
    // ice 不在星铁的属性键表里，故这一条应当落空而非记进 dmg
    d.addAttr("ice", 20)
    expect(d.get("dmg")).toBe(0)
  })

  it("原神不做这一折算", () => {
    // 原神的元素伤害加成与通用增伤是两个乘区，折算会把它们并成一个
    const d = new AttrData("gs", { elem: "pyro" })
    d.addAttr("pyro", 20)
    expect(d.get("dmg")).toBe(0)
  })

  it("角色没有元素时不折算", () => {
    const d = new AttrData("sr")
    d.addAttr("fire", 20)
    expect(d.get("dmg")).toBe(0)
  })
})

describe("AttrData getAttr", () => {
  it("带上 _calc 标记与 staticAttr 分量", () => {
    const d = new AttrData("gs")
    d.addAttr("atkBase", 800)
    const out = d.getAttr()
    expect(out._calc).toBe(true)
    // 伤害计算要按分量读，故原始三分量原样带出
    expect(out.staticAttr["atk"]).toEqual({ base: 800, plus: 0, pct: 0 })
  })

  it("四项主属性额外给出白值", () => {
    const d = new AttrData("sr")
    d.addAttr("speedBase", 100)
    const out = d.getAttr()
    expect(out["speedBase"]).toBe(100)
  })

  it("两个游戏各给自己那套键", () => {
    const gs = new AttrData("gs").getAttr()
    const sr = new AttrData("sr").getAttr()
    for (const key of GS_ATTR_KEYS) expect(gs[key]).toBeDefined()
    for (const key of SR_ATTR_KEYS) expect(sr[key]).toBeDefined()
    // 原神有异种元素伤害，星铁没有；星铁有速度与击破，原神没有
    expect(gs["diffelem"]).toBeDefined()
    expect(sr["diffelem"]).toBeUndefined()
    expect(sr["speed"]).toBeDefined()
    expect(gs["speed"]).toBeUndefined()
  })
})
