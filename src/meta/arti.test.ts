/**
 * 模块职责：圣遗物词条元数据表的测试
 * 依赖方向：测试文件，依赖 meta/arti.ts 与 meta/arti-parse.ts；替身就在本文件，真实元数据那组由 `MHY_REAL_META` 给出
 * 生命周期：每个用例一份新的临时元数据目录
 * 注意事项：固定四项：词条表与权重表都读已装的元数据、只解析不求值；词条 id 查得回键与数值（米游社面板只给 id）；
 *          原文里的 `split` / 算式 / `export { attrMap }` 都认、派生字段照原样算出；**文件缺失或写坏时各项为空而不抛错**。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ArtiMetaTable, ELEM_KEYS, isElemKey } from "./arti.js"
import { evalArith, parseArtiMeta } from "./arti-parse.js"

/*
 * 以下替身照元数据的写法手写，数值与角色随手取、不随游戏版本维护；真实元数据的整份解析由 `MHY_REAL_META` 那组覆盖
 */

/** 原神词条表替身（`artifact/extra.js` 的写法：字面量 + 派生循环） */
const GS_EXTRA = `import lodash from "lodash"
import { Format } from "#miao"

export const mainAttr = {
  3: "atk,def,hp,mastery,recharge".split(","),
  4: "atk,def,hp,mastery,dmg,phy".split(","),
  5: "atk,def,hp,mastery,heal,cpct,cdmg".split(",")
}

export const subAttr = "atk,atkPlus,def,defPlus,hp,hpPlus,mastery,recharge,cpct,cdmg".split(",")

export const attrMap = {
  atk: { title: "大攻击", format: "pct", calc: "pct" },
  atkPlus: { title: "小攻击", format: "comma" },
  def: { title: "大防御", format: "pct", calc: "pct" },
  defPlus: { title: "小防御", format: "comma" },
  hp: { title: "大生命", format: "pct", calc: "pct" },
  hpPlus: { title: "小生命", format: "comma" },
  cpct: { title: "暴击率", format: "pct", calc: "plus" },
  cdmg: { title: "暴击伤害", format: "pct", calc: "plus" },
  mastery: { title: "元素精通", format: "comma", calc: "plus" },
  recharge: { title: "充能效率", format: "pct", calc: "plus" },
  dmg: { title: "元素伤害", format: "pct", calc: "plus" },
  phy: { title: "物伤加成", format: "pct", calc: "plus" },
  heal: { title: "治疗加成", format: "pct", calc: "plus" }
}

export const basicNum = 3.885
export const attrPct = {
  atk: 1.5,
  atkPlus: 5,
  def: 1.875,
  defPlus: 6,
  hp: 1.5,
  hpPlus: 1.875 * 41,
  cpct: 1,
  cdmg: 2,
  mastery: 6,
  recharge: 1 / 0.6,
  dmg: 1.5,
  phy: 1.875,
  heal: 1.5 / 1.3
}

lodash.forEach(attrMap, (attr, key) => {
  attr.text = Format[attr.format](attr.value, 2)
})

export const mainIdMap = {
  10001: "hpPlus",
  10002: "hp",
  15008: "pyro"
}

export const attrIdMap = {
  501021: { key: "hpPlus", value: 23.9 },
  501224: { key: "cdmg", value: 0.0777 }
}
`

/** 星铁词条表替身（`artifact/meta.js` 的写法：`const attrMap` 加 `export { attrMap }`） */
const SR_META = `import lodash from "lodash"
import { Format } from "#miao"

export const mainAttr = {
  3: "atk,def,hp,cpct,cdmg,heal,effPct".split(","),
  4: "atk,def,hp,speed".split(","),
  5: "atk,def,hp,dmg".split(","),
  6: "atk,def,hp,recharge,stance".split(",")
}

export const subAttr = "atk,atkPlus,def,defPlus,hp,hpPlus,speed,cpct,cdmg,effPct,effDef,stance".split(",")

const attrMap = {
  atk: { title: "大攻击", format: "pct", calc: "pct", value: 4.32 },
  atkPlus: { title: "小攻击", format: "comma", value: 127 / 6 },
  def: { title: "大防御", format: "pct", calc: "pct", value: 5.4 },
  defPlus: { title: "小防御", format: "comma", value: 127 / 6 },
  hp: { title: "大生命", format: "pct", calc: "pct", value: 4.32 },
  hpPlus: { title: "小生命", format: "comma", value: 254 / 6 },
  speed: { title: "速度", format: "comma", calc: "plus", value: 2.6 },
  cpct: { title: "暴击率", format: "pct", calc: "plus", value: 3.24 },
  cdmg: { title: "暴击伤害", format: "pct", calc: "plus", value: 6.48 },
  recharge: { title: "充能效率", format: "pct", calc: "plus", value: 3.11 },
  dmg: { title: "伤害加成", format: "pct", value: 6.22 },
  heal: { title: "治疗加成", format: "pct", calc: "pct", value: 5.53 },
  stance: { title: "击破特攻", format: "pct", value: 6.48, calc: "pct" },
  effPct: { title: "效果命中", format: "pct", value: 4.32, calc: "pct" },
  effDef: { title: "效果抵抗", format: "pct", value: 4.32, calc: "pct" }
}

export { attrMap }
`

/** 原神默认评分表替身 */
const GS_MARK = `export const usefulAttr = {
  胡桃: { hp: 80, atk: 50, def: 0, cpct: 100, cdmg: 100, mastery: 75, dmg: 100, phy: 0, recharge: 0, heal: 0 }
}
`

/** 星铁默认评分表替身 */
const SR_MARK = `export const usefulAttr = {
  符玄: { hp: 100, atk: 0, def: 50, speed: 100, cpct: 100, cdmg: 100, stance: 0, heal: 0, recharge: 50, effPct: 0, effDef: 50, dmg: 100 },
  三月七: { hp: 50, atk: 0, def: 100, speed: 100, cpct: 0, cdmg: 0, stance: 0, heal: 0, recharge: 100, effPct: 50, effDef: 50, dmg: 0 }
}
`

/** 相对元数据根的路径 → 内容 */
const FILES: Readonly<Record<string, string>> = {
  "meta-gs/artifact/extra.js": GS_EXTRA,
  "meta-gs/artifact/artis-mark.js": GS_MARK,
  "meta-sr/artifact/meta.js": SR_META,
  "meta-sr/artifact/artis-mark.js": SR_MARK
}

/**
 * 把几份替身写进一个元数据根目录
 * @param root 元数据根目录
 */
function writeArtiMeta(root: string): void {
  for (const [rel, body] of Object.entries(FILES)) {
    const path = join(root, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, "utf8")
  }
}

let dir = ""

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arti-test-"))
  mkdirSync(join(dir, "meta-gs", "artifact"), { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 写一份原神的 `artifact/extra.js`
 * @param body 文件内容
 */
function putExtra(body: string): void {
  writeFileSync(join(dir, "meta-gs", "artifact", "extra.js"), body, "utf8")
}

/**
 * 写一份原神的 `artifact/artis-mark.js`
 * @param body 文件内容
 */
function putMark(body: string): void {
  writeFileSync(join(dir, "meta-gs", "artifact", "artis-mark.js"), body, "utf8")
}

describe("ArtiMetaTable 词条元数据", () => {
  it("读得出主副词条与词条表", () => {
    putExtra(
      [
        'export const mainAttr = { 3: "atk,hp".split(","), 4: ["dmg"], 5: ["cpct"] }',
        'export const subAttr = "atk,cpct".split(",")',
        'export const attrMap = { cpct: { title: "暴击率", format: "pct", calc: "plus" } }',
        "export const basicNum = 3.885",
        "export const attrPct = { cpct: 1 }"
      ].join("\n")
    )
    const table = new ArtiMetaTable({ metaDir: dir })
    expect(table.meta("gs").mainAttr["3"]).toEqual(["atk", "hp"])
    // 文字照 `toFixed(2)` 出：3.885 的浮点表示略小于 3.885，故是 3.88 而非 3.89
    expect(table.meta("gs").attrMap["cpct"]).toMatchObject({ title: "暴击率", value: 3.885, type: "normal", text: "3.88%" })
  })

  it("文件缺失时各项为空而不抛错 —— 元数据是可选的", () => {
    const table = new ArtiMetaTable({ metaDir: dir })
    expect(table.meta("sr").attrMap).toEqual({})
    expect(table.ready("sr")).toBe(false)
  })

  it("写坏了同样按缺失处理", () => {
    putExtra("export const mainAttr = { 3: 取值() }")
    expect(new ArtiMetaTable({ metaDir: dir }).ready("gs")).toBe(false)
  })

  it("按 id 查副词条 —— 米游社面板只给 id", () => {
    putExtra(
      [
        "export const mainAttr = {}",
        "export const subAttr = []",
        "export const attrMap = {}",
        'export const mainIdMap = { 15001: "cpct" }',
        'export const attrIdMap = { 501224: { key: "cdmg", value: 0.0777 } }'
      ].join("\n")
    )
    const table = new ArtiMetaTable({ metaDir: dir })
    expect(table.subById("gs", "501224")).toEqual({ key: "cdmg", value: 0.0777 })
    expect(table.subById("gs", 501_224)?.key).toBe("cdmg")
    expect(table.mainById("gs", "15001")).toBe("cpct")
    expect(table.subById("gs", "999")).toBeUndefined()
  })
})

describe("ArtiMetaTable 权重表", () => {
  it("读 artis-mark.js 的 usefulAttr", () => {
    putMark("export const usefulAttr = {\n  胡桃: { hp: 100, cpct: 100 },\n  新角色: { atk: 75 }\n}\n")
    const table = new ArtiMetaTable({ metaDir: dir })
    expect(table.weightOf("gs", "胡桃")?.hp).toBe(100)
    expect(table.weightOf("gs", "新角色")?.atk).toBe(75)
    expect(table.weightOf("gs", "某新角色")).toBeUndefined()
  })

  it("文件不在或解不出时为空表，由评分层回落到通用权重", () => {
    expect(new ArtiMetaTable({ metaDir: dir }).usefulAttr("gs")).toEqual({})
    putMark("export const usefulAttr = { 胡桃: 计算() }\n")
    expect(new ArtiMetaTable({ metaDir: dir }).weightOf("gs", "胡桃")).toBeUndefined()
  })

  it("reload 之后重新读 —— 元数据更新的落点", () => {
    putMark("export const usefulAttr = { 胡桃: { hp: 100 } }\n")
    const table = new ArtiMetaTable({ metaDir: dir })
    expect(table.weightOf("gs", "胡桃")?.hp).toBe(100)

    putMark("export const usefulAttr = { 胡桃: { hp: 120 } }\n")
    expect(table.weightOf("gs", "胡桃")?.hp).toBe(100)
    table.reload()
    expect(table.weightOf("gs", "胡桃")?.hp).toBe(120)
  })
})

describe("parseArtiMeta", () => {
  it("算式只认数字与四则，别的一律报错而不求值", () => {
    expect(evalArith("127 / 6")).toBeCloseTo(21.1667, 3)
    expect(evalArith("1.875 * 41")).toBeCloseTo(76.875, 3)
    expect(evalArith("1 / 0.6")).toBeCloseTo(1.6667, 3)
    expect(() => evalArith("process.exit(1)")).toThrow()
  })

  it("星铁的 `const attrMap` 加 `export { attrMap }` 也认得", () => {
    const meta = parseArtiMeta(SR_META, "sr")
    expect(meta.attrMap["atkPlus"]).toMatchObject({ value: 127 / 6, base: "atk", type: "plus", text: "21.17" })
    expect(meta.mainAttr["6"]).toContain("recharge")
  })

  it("缺三张必需表之一时报错", () => {
    expect(() => parseArtiMeta('export const subAttr = []', "gs")).toThrow()
  })
})

describe("照元数据写法的替身", () => {
  beforeEach(() => writeArtiMeta(dir))

  it("两个游戏的词条表都装得进来", () => {
    const table = new ArtiMetaTable({ metaDir: dir })
    expect(table.ready("gs")).toBe(true)
    expect(table.ready("sr")).toBe(true)
  })

  it("原神的派生字段照原样算出", () => {
    const map = new ArtiMetaTable({ metaDir: dir }).meta("gs").attrMap
    // basicNum 3.885 × attrPct.cpct 1 = 3.885
    expect(map["cpct"]?.value).toBeCloseTo(3.885, 3)
    // 1.875 * 41 这种算式要先算出来
    expect(map["hpPlus"]?.value).toBeCloseTo(3.885 * 76.875, 3)
    // 小词条要带 base，评分时据它折算成大词条的量纲
    expect(map["atkPlus"]).toMatchObject({ base: "atk", type: "plus" })
    expect(parseArtiMeta(GS_EXTRA, "gs").attrNameMap?.["暴击率"]).toBe("cpct")
  })

  it("权重表读得出", () => {
    const table = new ArtiMetaTable({ metaDir: dir })
    expect(table.weightOf("gs", "胡桃")?.cdmg).toBe(100)
    expect(table.weightOf("sr", "三月七")).toBeDefined()
  })
})

/** 一份真实的元数据根目录，未给时下面那组整组跳过 */
const REAL = process.env["MHY_REAL_META"] ?? ""

describe.skipIf(!existsSync(join(REAL, "meta-gs", "artifact", "extra.js")))("真实元数据", () => {
  it("两个游戏的词条表整份解析得出，副词条 id 表齐全 —— 面板接口靠它认词条", () => {
    const table = new ArtiMetaTable({ metaDir: REAL })
    expect(table.ready("gs")).toBe(true)
    expect(table.ready("sr")).toBe(true)
    expect(Object.keys(table.meta("gs").attrIdMap ?? {}).length).toBeGreaterThan(150)
    expect(Object.keys(table.usefulAttr("gs")).length).toBeGreaterThan(50)
  })
})

describe("isElemKey", () => {
  it("元素伤害加成的键都认得", () => {
    for (const key of ELEM_KEYS) expect(isElemKey(key)).toBe(true)
  })

  it("普通词条不算元素键", () => {
    expect(isElemKey("cpct")).toBe(false)
    expect(isElemKey("atk")).toBe(false)
  })
})
