/**
 * 模块职责：圣遗物词条求值的测试
 * 依赖方向：测试文件，依赖 panel/arti-attr.ts 与两张元数据表
 * 生命周期：无状态
 * 注意事项：只钉**行为**、不钉具体数值，用例形如"百分比词条要乘 100""花的主词条系数是叶的同一档""同一个键出现两次
 *          则 upNum 为 2"，都是不看实现也能独立判真伪的命题。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ArtiMetaTable } from "../meta/arti.js"
import { ArtiSetTable } from "../meta/arti-set.js"
import { artiAttrs, gsMainAttr, gsSubAttrs, srArtiAttrs } from "./arti-attr.js"

let dir = ""
let table: ArtiMetaTable
let sets: ArtiSetTable

/** 下面那份词条表里各词条的单档值 */
const GS_VALUE = { hp: 0.0583, hpPlus: 253.94, dmg: 0.0699 }

/** 一份够用的原神词条表（`artifact/extra.js` 的写法）：一个百分比词条、一个点数词条、一个元素伤害 */
const GS_EXTRA = `
export const mainAttr = {}
export const subAttr = []
export const attrMap = {
  hp: { title: "大生命", format: "pct", value: 0.0583, type: "normal", text: "5.83%" },
  hpPlus: { title: "小生命", format: "comma", value: 253.94, base: "hp", type: "plus", text: "253.94" },
  atk: { title: "大攻击", format: "pct", value: 0.0583, type: "normal", text: "5.83%" },
  dmg: { title: "伤害加成", format: "pct", value: 0.0699, type: "normal", text: "6.99%" }
}
export const mainIdMap = { 14001: "hpPlus", 10002: "hp", 15008: "pyro" }
export const attrIdMap = {
  501021: { key: "hp", value: 0.0233 },
  501024: { key: "hp", value: 0.0326 },
  501031: { key: "atk", value: 0.0233 }
}
`

/** 一份够用的星铁档位表：三星与五星各一档 */
const SR_META = {
  mainIdx: {
    "1": { "1": "hpPlus" },
    "3": { "1": "atk" }
  },
  starData: {
    "5": {
      main: {
        hpPlus: { id: "1", base: 112.896, step: 39.5136 },
        atk: { id: "3", base: 6.912, step: 2.4192 }
      },
      sub: {
        "1": { key: "hpPlus", base: 33.87004, step: 4.233755 },
        "2": { key: "atkPlus", base: 16.935019, step: 2.116877 }
      }
    }
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arti-attr-test-"))
  mkdirSync(join(dir, "meta-gs", "artifact"), { recursive: true })
  mkdirSync(join(dir, "meta-sr", "artifact"), { recursive: true })
  writeFileSync(join(dir, "meta-gs", "artifact", "extra.js"), GS_EXTRA, "utf8")
  writeFileSync(join(dir, "meta-sr", "artifact", "meta.json"), JSON.stringify(SR_META), "utf8")
  table = new ArtiMetaTable({ metaDir: dir })
  sets = new ArtiSetTable({ dir })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("原神主词条", () => {
  it("查不到的 id 返回 undefined", () => {
    expect(gsMainAttr("999999", 20, 5, table)).toBeUndefined()
  })

  it("等级越高值越大", () => {
    const low = gsMainAttr("10002", 0, 5, table)
    const high = gsMainAttr("10002", 20, 5, table)
    expect(low?.value).toBeGreaterThan(0)
    expect(high?.value).toBeGreaterThan(low?.value ?? 0)
  })

  it("小生命的部位系数是大生命的两倍", () => {
    // 两者在元数据里的单档值不同，故比"同档值下的系数"而非直接比数值：
    // hpPlus 走 posEff=2，hp 走 posEff=1
    const plus = gsMainAttr("14001", 0, 5, table)
    const pct = gsMainAttr("10002", 0, 5, table)
    const plusPer = (plus?.value ?? 0) / GS_VALUE.hpPlus
    const pctPer = (pct?.value ?? 0) / GS_VALUE.hp
    expect(plusPer / pctPer).toBeCloseTo(2, 10)
  })

  it("星级系数按四星 0.9、五星 1", () => {
    const five = gsMainAttr("10002", 10, 5, table)
    const four = gsMainAttr("10002", 10, 4, table)
    expect((four?.value ?? 0) / (five?.value ?? 1)).toBeCloseTo(0.9, 10)
  })

  it("元素伤害共用 dmg 那一档的单档值", () => {
    const got = gsMainAttr("15008", 0, 5, table)
    expect(got?.key).toBe("pyro")
    // 单档值取 dmg 的 0.0699，而非 pyro（元数据里没有 pyro 这一项）
    expect((got?.value ?? 0) / GS_VALUE.dmg).toBeCloseTo(1.2, 10)
  })

  it("星级缺失时按五星", () => {
    const got = gsMainAttr("10002", 10, 0, table)
    const five = gsMainAttr("10002", 10, 5, table)
    expect(got?.value).toBe(five?.value)
  })
})

describe("原神副词条", () => {
  it("百分比词条乘 100，点数不乘", () => {
    const got = gsSubAttrs(["501021"], table)
    // 元数据里 hp 存 0.0233，乘 100 后是 2.33 —— 面板上写的就是 2.33%
    expect(got[0]?.value).toBeCloseTo(2.33, 10)
  })

  it("同一个键出现两次即累加且 upNum 为 2", () => {
    const got = gsSubAttrs(["501021", "501024"], table)
    expect(got).toHaveLength(1)
    expect(got[0]?.upNum).toBe(2)
    expect(got[0]?.value).toBeCloseTo(2.33 + 3.26, 10)
  })

  it("不同的键各占一项，顺序为首次出现的顺序", () => {
    const got = gsSubAttrs(["501031", "501021"], table)
    expect(got.map(it => it.key)).toEqual(["atk", "hp"])
  })

  it("查不到的 id 跳过而不抛错", () => {
    const got = gsSubAttrs(["999999", "501021"], table)
    expect(got).toHaveLength(1)
    expect(got[0]?.key).toBe("hp")
  })

  it("eff 按相当于几个满档算，与 value 不是同一个量", () => {
    const got = gsSubAttrs(["501021"], table)
    // 0.0233 / 0.0583 ≈ 0.4，即这一条约等于 0.4 个满档
    expect(got[0]?.eff).toBeCloseTo((0.0233 / 0.0583) * 100, 8)
    expect(got[0]?.eff).not.toBe(got[0]?.value)
  })

  it("空数组给空结果", () => {
    expect(gsSubAttrs([], table)).toEqual([])
  })
})

describe("星铁词条", () => {
  it("主词条值等于基数加步进乘等级", () => {
    const got = srArtiAttrs({ mainId: "1", level: 3, star: 5 }, 1, sets)
    expect(got?.main?.key).toBe("hpPlus")
    expect(got?.main?.value).toBeCloseTo(112.896 + 39.5136 * 3, 10)
  })

  it("副词条按 id、档数、步进数三段算", () => {
    const got = srArtiAttrs({ mainId: "1", level: 0, star: 5, attrIds: ["1,2,3"] }, 1, sets)
    expect(got?.attrs[0]?.key).toBe("hpPlus")
    expect(got?.attrs[0]?.upNum).toBe(2)
    expect(got?.attrs[0]?.value).toBeCloseTo(33.87004 * 2 + 4.233755 * 3, 10)
  })

  it("副词条也认对象形态", () => {
    const asText = srArtiAttrs({ mainId: "1", star: 5, attrIds: ["1,2,3"] }, 1, sets)
    const asObj = srArtiAttrs({ mainId: "1", star: 5, attrIds: [{ id: "1", count: 2, step: 3 }] }, 1, sets)
    expect(asObj?.attrs[0]?.value).toBe(asText?.attrs[0]?.value)
  })

  it("部位不同则同一个 mainId 译成不同的键", () => {
    expect(srArtiAttrs({ mainId: "1", star: 5 }, 1, sets)?.main?.key).toBe("hpPlus")
    expect(srArtiAttrs({ mainId: "1", star: 5 }, 3, sets)?.main?.key).toBe("atk")
  })

  it("主词条查不到时整件返回 undefined", () => {
    expect(srArtiAttrs({ mainId: "999", star: 5 }, 1, sets)).toBeUndefined()
  })

  it("档位表缺失时返回 undefined 而不抛错", () => {
    const empty = new ArtiSetTable({ dir: join(dir, "nope") })
    expect(srArtiAttrs({ mainId: "1", star: 5 }, 1, empty)).toBeUndefined()
  })

  it("查不到的副词条跳过，其余仍算", () => {
    const got = srArtiAttrs({ mainId: "1", star: 5, attrIds: ["999,1,0", "1,1,0"] }, 1, sets)
    expect(got?.attrs).toHaveLength(1)
    expect(got?.attrs[0]?.key).toBe("hpPlus")
  })
})

describe("统一入口", () => {
  it("按游戏分派", () => {
    const gs = artiAttrs({ mainId: "10002", level: 20, star: 5 }, 3, "gs", table, sets)
    const sr = artiAttrs({ mainId: "1", level: 3, star: 5 }, 1, "sr", table, sets)
    expect(gs?.main?.key).toBe("hp")
    expect(sr?.main?.key).toBe("hpPlus")
  })

  it("原神不看部位号", () => {
    const a = artiAttrs({ mainId: "10002", level: 20, star: 5 }, 1, "gs", table, sets)
    const b = artiAttrs({ mainId: "10002", level: 20, star: 5 }, 5, "gs", table, sets)
    expect(a?.main?.value).toBe(b?.main?.value)
  })

  it("缺主词条 id 时返回 undefined", () => {
    expect(artiAttrs({ level: 20, star: 5 }, 1, "gs", table, sets)).toBeUndefined()
  })
})
