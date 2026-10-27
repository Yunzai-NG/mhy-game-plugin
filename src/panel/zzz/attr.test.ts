/**
 * 模块职责：绝区零属性本地计算的测试 —— 套装二件加成两条取法
 * 依赖方向：测试文件，只依赖同目录 attr；装载器用一个只答 `detail` 的桩
 * 生命周期：无状态
 * 注意事项：文案样本取自现装 `equip/data.json` 的 `skills["2"]` 原文，三种写法（带 `<nobr>`、带「点」、无句号）都要覆盖；
 *          两路产出同为**百分点**（`10%` 记 10），与驱动盘词条同刻度。
 */
import { describe, expect, it } from "vitest"
import type { MetaLoader } from "../../meta/loader.js"
import { aggregate, set2Adds, set2AddsOfText } from "./attr.js"

/**
 * 造一个只答 `detail` 的装载器桩
 * @param table 套装 id → 详情
 * @returns 装载器
 */
function metaOf(table: Record<string, unknown>): MetaLoader {
  return { detail: (_game: string, id: string | number) => table[String(id)] } as unknown as MetaLoader
}

describe("set2AddsOfText", () => {
  it("解出「属性名+数值」三种写法", () => {
    expect(set2AddsOfText("暴击率+8%。")).toEqual([[201, 8, true]])
    expect(set2AddsOfText("<nobr>火属性伤害</nobr>+10%。")).toEqual([[316, 10, true]])
    expect(set2AddsOfText("异常精通+30点。")).toEqual([[312, 30, false]])
    expect(set2AddsOfText("生命值+10%")).toEqual([[111, 10, true]])
    expect(set2AddsOfText("能量自动回复+20%。")).toEqual([[305, 20, true]])
  })

  it("条件加成与非面板加成跳过", () => {
    expect(set2AddsOfText("[普通攻击]造成的伤害提升15%。")).toEqual([])
    expect(set2AddsOfText("施加的护盾值提升15%。")).toEqual([])
    expect(set2AddsOfText("攻击造成的失衡值提升6%")).toEqual([])
    expect(set2AddsOfText("")).toEqual([])
  })
})

describe("set2Adds", () => {
  it("包里没有 set2 时退回现解二件套文案", () => {
    const meta = metaOf({ "31000": { id: "31000", name: "啄木鸟电音", skills: { "2": "暴击率+8%。" } } })
    expect(set2Adds(meta, 31000)).toEqual([[201, 8, true]])
  })

  it("有 set2 时照它取，百分比记百分点", () => {
    const meta = metaOf({ "32800": { set2: [{ id: 12101, value: "10%" }], skills: { "2": "暴击率+8%。" } } })
    expect(set2Adds(meta, 32800)).toEqual([[121, 10, true]])
  })

  it("汇总后：攻击力 10% 乘基础、暴击率 8% 直接加、能量回复 20% 乘基础", () => {
    const adds = [
      ...set2AddsOfText("攻击力+10%。"),
      ...set2AddsOfText("暴击率+8%。"),
      ...set2AddsOfText("能量自动回复+20%。")
    ]
    const rows = aggregate({ 121: 1000, 201: 5, 305: 1.2 }, adds, 200)
    expect(rows.find(it => it.key === "atk")?.final).toBe("1100")
    expect(rows.find(it => it.key === "cpct")?.final).toBe("13.0%")
    expect(rows.find(it => it.key === "er")?.final).toBe("1.44")
  })

  it("百分比属性也拆基础/加成：暴击率 5% 白值 + 8% 加成", () => {
    const rows = aggregate({ 201: 5 }, [...set2AddsOfText("暴击率+8%。")], 200)
    const cpct = rows.find(it => it.key === "cpct")
    expect(cpct?.base).toBe("5.0%")
    expect(cpct?.add).toBe("8.0%")
    expect(cpct?.final).toBe("13.0%")
  })

  it("百分比属性无任何加成时：加成为 0.0%、白值即固有值", () => {
    const rows = aggregate({ 211: 50 }, [], 200)
    const cdmg = rows.find(it => it.key === "cdmg")
    expect(cdmg?.base).toBe("50.0%")
    expect(cdmg?.add).toBe("0.0%")
    expect(cdmg?.final).toBe("50.0%")
  })
})
