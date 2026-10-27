/**
 * 模块职责：绝区零伤害视图的用例 —— 格式化与那个 `"NaN"` 约定
 * 依赖方向：只依赖被测模块
 * 生命周期：随测试运行
 * 注意事项：**`"NaN"` 那几条不是防御性用例。** 模板拿这个串做判据
 *          （`{{if !dmg.dmg || dmg.dmg === "NaN"}}`），改成 `0` 会让不暴击的那些行
 *          印出「0 / 期望值」两格 —— 那种错出图不报错，只能靠用例挡。
 */
import { describe, expect, it } from "vitest"
import type { ZzzBuffResult, ZzzDmgData, ZzzDmgResult } from "../../panel/dmg/zzz/index.js"
import { zzzDmgText, zzzDmgView } from "./dmg.js"

/**
 * 造一条伤害结果
 * @param over 要盖掉的字段
 * @returns 一条结果
 */
function row(over: Partial<ZzzDmgResult> = {}): ZzzDmgResult {
  return {
    name: "普攻·三段",
    type: "AP3",
    crit: 12345,
    avg: 9876,
    cpct: 0.5,
    cdmg: 1.5,
    areas: {
      basic: 1000,
      critical: 1.75,
      boost: 1.2,
      vulnerability: 1,
      resistance: 1.2,
      defence: 0.5,
      stun: 1
    },
    buffs: [],
    ...over
  }
}

/**
 * 造一份伤害数据
 *
 * `enemyName` 与 `createdBy` 现在由伤害层从元数据的 `calc.js` 里取（`enemyName` /
 * `createdBy` 两个具名导出），故它们是**数据的一部分**而不是视图的参数。
 * @param list 逐条结果
 * @param over 要盖掉的字段
 * @returns 伤害数据
 */
function data(list: ZzzDmgResult[], over: Partial<ZzzDmgData> = {}): ZzzDmgData {
  return {
    list,
    enemy: { level: 60, basicDEF: 50, resistance: -0.2 },
    attr: { final: {}, base: {} },
    enemyName: "标准假想敌",
    createdBy: "",
    ...over
  }
}

describe("zzzDmgView", () => {
  it("逐条给出标题与两个数字，且带千分位", () => {
    const got = zzzDmgView(data([row()]))

    expect(got.dmgData).toHaveLength(1)
    expect(got.dmgData[0]?.title).toBe("普攻·三段")
    expect(got.dmgData[0]?.avg).toBe("9,876")
    expect(got.dmgData[0]?.dmg).toBe("12,345")
  })

  it("**不会暴击时给字面的 `NaN`** —— 那是模板的判据，给 0 会多印一格", () => {
    const got = zzzDmgView(data([row({ crit: 0 })]))

    expect(got.dmgData[0]?.dmg).toBe("NaN")
  })

  it("敌人等级与名字都取自伤害层 —— 名字来自 `calc.js` 的 `enemyName`", () => {
    const got = zzzDmgView(data([row()], { enemyName: "枯萎往世乐土" }))

    expect(got.enemyLv).toBe(60)
    expect(got.enemyName).toBe("枯萎往世乐土")
  })

  it("公式没给敌人名时是标准假想敌", () => {
    expect(zzzDmgView(data([row()])).enemyName).toBe("标准假想敌")
  })

  it("**公式作者原样带出** —— 那是 `calc.js` 的 `createdBy`，模板据空串不画那一行", () => {
    expect(zzzDmgView(data([row()], { createdBy: "某某" })).createdBy).toBe("某某")
    expect(zzzDmgView(data([row()])).createdBy).toBe("")
  })

  it("最多印十二条", () => {
    const list = Array.from({ length: 20 }, (_, at) => row({ type: `AP${at}` }))

    expect(zzzDmgView(data(list)).dmgData).toHaveLength(12)
  })

  it("一条都没有时给空表，模板据 `dmgData.length` 判空", () => {
    const got = zzzDmgView(data([]))

    expect(got.dmgData).toEqual([])
    expect(got.dmgMsg).toEqual([])
  })
})

describe("zzzDmgView 的 buff 列表", () => {
  /**
   * 造一条 buff 结果
   * @param over 要盖掉的字段
   * @returns 一条 buff
   */
  function buff(over: Partial<ZzzBuffResult> = {}): ZzzBuffResult {
    return { name: "啄木鸟电音2件", type: "暴击率", value: 0.08, source: "套装", ...over }
  }

  it("**比例型印成百分数**：0.08 → +8.0%", () => {
    const got = zzzDmgView(data([row({ buffs: [buff()] })]))

    expect(got.dmgMsg[0]).toEqual(["啄木鸟电音2件", "暴击率 +8.0%"])
  })

  it("**点数型原样印**：异常精通 30 不该变成 3000%", () => {
    const got = zzzDmgView(data([row({ buffs: [buff({ name: "自由蓝调2件", type: "异常精通", value: 30 })] })]))

    expect(got.dmgMsg[0]).toEqual(["自由蓝调2件", "异常精通 +30"])
  })

  it("攻击力那一类同样是点数", () => {
    const got = zzzDmgView(data([row({ buffs: [buff({ name: "某音擎", type: "攻击力", value: 250 })] })]))

    expect(got.dmgMsg[0]?.[1]).toBe("攻击力 +250")
  })

  it("**buff 取自伤害最高那一条**，不是各条各印一份", () => {
    const high = row({ avg: 9999, buffs: [buff({ name: "高的那条" })] })
    const low = row({ avg: 1, type: "AP1", buffs: [buff({ name: "低的那条" })] })
    const got = zzzDmgView(data([high, low]))

    expect(got.dmgMsg).toHaveLength(1)
    expect(got.dmgMsg[0]?.[0]).toBe("高的那条")
  })

  it("最多印十条", () => {
    const buffs = Array.from({ length: 15 }, (_, at) => buff({ name: `第${at}条` }))

    expect(zzzDmgView(data([row({ buffs })])).dmgMsg).toHaveLength(10)
  })
})

describe("zzzDmgText", () => {
  it("出图失败时给纯文字，含目标等级", () => {
    const text = zzzDmgText("安比", zzzDmgView(data([row()])))

    expect(text).toContain("安比 伤害计算")
    expect(text).toContain("60 级标准假想敌")
    expect(text).toContain("普攻·三段 9,876 / 暴击 12,345")
  })

  it("不暴击那几条不印暴击栏", () => {
    const text = zzzDmgText("薇薇安", zzzDmgView(data([row({ crit: 0 })])))

    expect(text).not.toContain("暴击")
    expect(text).not.toContain("NaN")
  })

  it("超过八条时末尾说明还有几条", () => {
    const list = Array.from({ length: 12 }, (_, at) => row({ type: `AP${at}` }))
    const text = zzzDmgText("雅", zzzDmgView(data(list)))

    expect(text).toContain("另有 4 条")
  })

  it("正好八条时不加那一行", () => {
    const list = Array.from({ length: 8 }, (_, at) => row({ type: `AP${at}` }))

    expect(zzzDmgText("雅", zzzDmgView(data(list)))).not.toContain("另有")
  })
})
