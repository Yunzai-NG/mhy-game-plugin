/**
 * 模块职责：伤害视图的测试
 * 依赖方向：测试文件，依赖 views/dmg.ts
 * 生命周期：无状态纯函数，无须夹具
 * 注意事项：钉的是**与模板之间那三处字面约定**，都不抛错、只让图印错：没有暴击伤害时那一格必须
 *          是字面的 `"NaN"`（给 0 会多印一格、不给会印 `/undefined`）、buff 文案按全角冒号切两列、
 *          对比表的差值要带正号。伤害数值本身由 panel/dmg/dmg.test.ts 钉住，此处只管摆样子。
 */
import { describe, expect, it } from "vitest"
import { dmgCalcView, dmgText } from "./dmg.js"
import type { DmgCalcResult } from "../panel/dmg/index.js"

/**
 * 造一份最小的伤害结果
 * @param over 要覆盖的字段
 * @returns 伤害结果
 */
function make(over: Partial<DmgCalcResult> = {}): DmgCalcResult {
  return {
    ret: [{ title: "重击伤害", dmg: 12345.6, avg: 9876.4 }],
    msg: ["雾切之回光：元素伤害加成 +12%"],
    msgList: [["雾切之回光：元素伤害加成 +12%"]],
    enemyName: "小宝",
    enemyLv: 103,
    createdBy: "",
    ...over
  }
}

describe("伤害视图", () => {
  it("逐条伤害按千分位取整", () => {
    const got = dmgCalcView(make())
    expect(got.dmgData).toEqual([{ title: "重击伤害", avg: "9,876", dmg: "12,346" }])
  })

  it("没有暴击伤害时那一格是字面的 NaN 而不是 0", () => {
    // 模板的判据是 `!dmg.dmg || dmg.dmg === "NaN"`，给 0 会走到"有暴击"那一支、
    // 印出「0 / 期望值」两格；对比表那一处只比 `!= "NaN"`，不给则印出 `/undefined`
    const got = dmgCalcView(make({ ret: [{ title: "超载伤害", avg: 4000 }] }))
    expect(got.dmgData[0]?.dmg).toBe("NaN")
  })

  it("buff 文案按全角冒号切成两列，只切第一处", () => {
    const got = dmgCalcView(make({ msg: ["雾切：加成：12%", "没有冒号"] }))
    expect(got.dmgMsg).toEqual([
      ["雾切", "加成：12%"],
      ["没有冒号", ""]
    ])
  })

  it("给了替换前那份时逐行带上增减：按标题配对、带正负号、不变与配不上的不给", () => {
    const now = make({
      ret: [
        { title: "重击伤害", dmg: 12345.6, avg: 9876.4 },
        { title: "新多出的一行", dmg: 100, avg: 80 },
        { title: "不变的一行", avg: 500 }
      ]
    })
    const base = make({
      ret: [
        { title: "不变的一行", avg: 500 },
        { title: "重击伤害", dmg: 13000, avg: 9000 }
      ]
    })
    const rows = dmgCalcView(now, base).dmgData

    expect(rows[0]).toMatchObject({ avgDiff: "+876", dmgDiff: "-654" })
    expect(rows[1]).not.toHaveProperty("avgDiff")
    expect(rows[2]).not.toHaveProperty("avgDiff")
    expect(rows[2]).not.toHaveProperty("dmgDiff")
  })

  it("敌人与作者原样带出", () => {
    const got = dmgCalcView(make({ enemyName: "弱点敌人", enemyLv: 80, createdBy: "甲" }))
    expect(got.enemyName).toBe("弱点敌人")
    expect(got.enemyLv).toBe(80)
    expect(got.createdBy).toBe("甲")
  })

  it("文本型的那些行原样带出，不再格式化", () => {
    // 公式直接给 `Format.percent(...)` 的结果，拿它过一遍千分位取整只会得到 NaN
    const got = dmgCalcView(
      make({ ret: [{ title: "战技提高暴击伤害", avg: "95.6%", type: "text" }] })
    )
    expect(got.dmgData[0]).toEqual({ title: "战技提高暴击伤害", avg: "95.6%", dmg: "NaN", type: "text" })
  })

  it("基准行是文本型时整块词条对比不画", () => {
    // 部分角色的 defDmgIdx 指向的正是一条文本行，那时逐格都会减出 NaN
    const got = dmgCalcView(
      make({
        compare: {
          title: "战技提高暴击伤害",
          userIdx: 1,
          basic: { title: "战技提高暴击伤害", avg: "95.6%", type: "text" },
          attrs: [{ title: "攻击力", text: "4.3%" }],
          rows: [[{ type: "na" }]]
        }
      })
    )
    expect(got.dmgCfg).toBeUndefined()
    expect(got.dmgRet).toBeUndefined()
    // 伤害表本身照常
    expect(got.dmgData).toHaveLength(1)
  })

  it("没有对比结果时不产出 dmgCfg 与 dmgRet", () => {
    const got = dmgCalcView(make())
    expect(got.dmgCfg).toBeUndefined()
    expect(got.dmgRet).toBeUndefined()
  })

  it("对比表的差值带正号，低于基准时带负号", () => {
    const got = dmgCalcView(
      make({
        compare: {
          title: "重击伤害",
          userIdx: 2,
          basic: { title: "重击伤害", dmg: 12345, avg: 10000 },
          attrs: [
            { title: "攻击力", text: "5.8%" },
            { title: "暴击率", text: "3.9%" }
          ],
          rows: [
            [{ type: "na" }, { type: "gt", dmg: 13000, avg: 10500 }],
            [{ type: "lt", dmg: 11000, avg: 9200 }, { type: "na" }]
          ]
        }
      })
    )
    expect(got.dmgCfg).toEqual({
      title: "重击伤害",
      userIdx: 2,
      basicRet: { avg: "10,000", dmg: "12,345" },
      attr: [
        { title: "攻击力", text: "5.8%" },
        { title: "暴击率", text: "3.9%" }
      ]
    })
    expect(got.dmgRet?.[0]?.[1]).toEqual({ type: "gt", val: "+500", avg: "10,500", dmg: "13,000" })
    expect(got.dmgRet?.[1]?.[0]).toEqual({ type: "lt", val: "-800", avg: "9,200", dmg: "11,000" })
  })

  it("对角线那一格只给类型，模板走另一支印基准值", () => {
    const got = dmgCalcView(
      make({
        compare: {
          title: "甲",
          userIdx: 0,
          basic: { title: "甲", avg: 100 },
          attrs: [{ title: "攻击力", text: "5.8%" }],
          rows: [[{ type: "na" }]]
        }
      })
    )
    expect(got.dmgRet?.[0]?.[0]).toEqual({ type: "na" })
    // 基准本身没有暴击时同样是字面的 NaN
    expect(got.dmgCfg?.basicRet.dmg).toBe("NaN")
  })

  it("纯文字回落只列前八条，并写出还有多少条", () => {
    const ret = Array.from({ length: 10 }, (_, idx) => ({ title: `第${idx}条`, avg: 100 + idx, dmg: 200 + idx }))
    const text = dmgText("神里绫华", dmgCalcView(make({ ret, createdBy: "甲" })))
    expect(text).toContain("神里绫华 伤害计算（目标 103 级小宝）")
    expect(text).toContain("第0条 100 / 暴击 200")
    expect(text).toContain("另有 2 条")
    expect(text).toContain("公式来源 甲")
    expect(text).not.toContain("第8条")
  })

  it("纯文字回落里没有暴击的那条不写暴击", () => {
    const text = dmgText("甲", dmgCalcView(make({ ret: [{ title: "超载伤害", avg: 4000 }] })))
    expect(text).toContain("超载伤害 4,000")
    expect(text).not.toContain("NaN")
  })
})
