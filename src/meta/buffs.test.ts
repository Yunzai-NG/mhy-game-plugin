/**
 * 模块职责：静态 buff 表的测试
 * 依赖方向：测试文件，依赖 meta/buffs.ts 与 meta/buff-parse.ts；夹具就在本文件，真实元数据那组由 `MHY_REAL_META` 给出
 * 生命周期：每个用例一份新的临时元数据目录
 * 注意事项：固定四项口径：**四件套要连带两件套那一份**（漏掉即所有四件套角色少一截属性）、只挑静态条目
 *          （夹具每处都掺了动态的，收进来就不等）、sr 武器只给 idx 与 key 而不给数值（数值随精炼变）、
 *          元数据缺失或写法认不出时各项为空而不抛错。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parseCharBuffs, parseSetBuffs, parseWeaponBuffs } from "./buff-parse.js"
import { BuffTable, eachSetBuff } from "./buffs.js"

/*
 * 以下替身照元数据的写法手写，数值与角色随手取、不随游戏版本维护；真实元数据的整份解析由 `MHY_REAL_META` 那组覆盖
 */
/** 一条套装 / 角色静态 buff */
interface SetBuff {
  /** 词条键 → 加值 */
  data: Record<string, number>
  /** 限定元素 */
  elem?: string
}

/** 一条武器静态 buff */
interface WeaponBuff {
  /** 原神：六档精炼 */
  refine?: Record<string, number[]>
  /** 星铁：tables 行号 */
  idx?: number
  /** 星铁：词条键 */
  key?: string
}

/** 要写的静态 buff */
interface BuffFixture {
  /** 套装名 → 件数 → buff */
  artiSets?: Record<string, Record<string, SetBuff[]>>
  /** 武器名 → buff，一律写进 `weapon/<类别>/calc.js` */
  weapons?: Record<string, WeaponBuff[]>
  /** 角色名 → buff */
  chars?: Record<string, SetBuff[]>
}

/**
 * 写一个文件，目录不在就建
 * @param path 路径
 * @param body 内容
 */
function putFile(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body, "utf8")
}

/**
 * 一条套装 buff 写成 `attr()` 调用；多个键时退成带 `isStatic` 的字面量
 * @param one buff
 * @returns 源码片段
 */
function setEntry(one: SetBuff): string {
  const keys = Object.keys(one.data)
  if (keys.length === 1) {
    const key = keys[0] ?? ""
    return `attr(${JSON.stringify(key)}, ${one.data[key]}${one.elem ? `, ${JSON.stringify(one.elem)}` : ""})`
  }
  return `{ title: "多项", isStatic: true, data: ${JSON.stringify(one.data)}${one.elem ? `, elem: ${JSON.stringify(one.elem)}` : ""} }`
}

/**
 * 把静态 buff 写成一份元数据
 * @param root 元数据根目录
 * @param game 游戏
 * @param body 静态 buff
 */
function writeBuffMeta(root: string, game: "gs" | "sr", body: BuffFixture): void {
  const base = join(root, `meta-${game}`)
  const sets = Object.entries(body.artiSets ?? {}).map(([name, byNum]) => {
    const nums = Object.entries(byNum).map(([num, list]) => `    ${num}: [${list.map(setEntry).join(", ")}]`)
    return `  ${JSON.stringify(name)}: {\n${nums.join(",\n")},\n    9: { title: "动态", check: ({ element }) => element === "火", data: { dmg: 99 } }\n  }`
  })
  putFile(join(base, "artifact", "calc.js"),
    `const attr = function (key, val, elem = "") {\n  return { isStatic: true, data: { [key]: val }, elem }\n}\n\nconst buffs = {\n${sets.join(",\n")}\n}\n\nexport default buffs\n`
  )

  const weapons = Object.entries(body.weapons ?? {}).map(([name, list]) => {
    const parts = list.map(one => {
      if (game === "sr") return `staticIdx(${one.idx ?? 0}, ${JSON.stringify(one.key ?? "")})`
      const [key, steps = []] = Object.entries(one.refine ?? {})[0] ?? []
      return `staticStep(${JSON.stringify(key)}, ${steps[0] ?? 0}, ${(steps[1] ?? 0) - (steps[0] ?? 0)})`
    })
    const dynamic = game === "sr" ? `keyIdx("动态", "dmg", 2)` : `{ title: "动态", refine: { dmg: step(99) } }`
    return `    ${JSON.stringify(name)}: [${[...parts, dynamic].join(", ")}]`
  })
  const helpers = game === "sr" ? "staticIdx, keyIdx" : "step, staticStep"
  putFile(join(base, "weapon", "示例", "calc.js"), `export default function (${helpers}) {\n  return {\n${weapons.join(",\n")}\n  }\n}\n`)

  for (const [name, list] of Object.entries(body.chars ?? {})) {
    const parts = list.map(one => `{ title: "静态", isStatic: true, data: ${JSON.stringify(one.data)} }`)
    putFile(join(base, "character", name, "calc.js"),
      `export const details = []\n\nexport const buffs = [${[...parts, `{ title: "动态", check: ({ cons }) => cons > 1, data: { dmg: 99 } }`, `"vaporize"`].join(", ")}]\n`
    )
  }
}

/** 一份真实的元数据根目录，未给时那组整组跳过 */
const REAL = process.env["MHY_REAL_META"] ?? ""

let dir = ""

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "buffs-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 把静态 buff 写成元数据里的 calc.js
 * @param body 内容
 * @param game 游戏
 */
function put(body: BuffFixture, game: "gs" | "sr" = "gs"): void {
  writeBuffMeta(dir, game, body)
}

describe("eachSetBuff", () => {
  it("四件套先按两件调一次，再按四件调一次", () => {
    // 四件套同时享有两件套效果
    expect(eachSetBuff({ 绝缘之旗印: 4 })).toEqual([
      { set: "绝缘之旗印", num: 2 },
      { set: "绝缘之旗印", num: 4 }
    ])
  })

  it("两件套只调一次", () => {
    expect(eachSetBuff({ 角斗士的终幕礼: 2 })).toEqual([{ set: "角斗士的终幕礼", num: 2 }])
  })

  it("件数不足两件的不产出", () => {
    expect(eachSetBuff({ 角斗士的终幕礼: 1 })).toEqual([])
  })

  it("五件同一套按四件算，仍是两次 —— 件数归到 2 / 4 两档，不原样传 5", () => {
    // setBuff 只认 "2" / "4" 两个键，传 5 会引到空表、四件套效果整条丢失
    expect(eachSetBuff({ 绝缘之旗印: 5 })).toEqual([
      { set: "绝缘之旗印", num: 2 },
      { set: "绝缘之旗印", num: 4 }
    ])
  })

  it("三件同一套按两件算 —— 散件里凑的两件套效果不能丢", () => {
    // 三件散件凑成的两件套：传 3 会引到空表、+80 熟知 / +20 充能一类整条丢失
    expect(eachSetBuff({ 流浪大地的乐团: 3 })).toEqual([{ set: "流浪大地的乐团", num: 2 }])
  })

  it("两套各两件时各调一次", () => {
    expect(eachSetBuff({ 甲: 2, 乙: 2 })).toHaveLength(2)
  })

  it("空表产出空", () => {
    expect(eachSetBuff({})).toEqual([])
  })
})

describe("BuffTable 读表", () => {
  it("按套装名与件数取 buff", () => {
    put({ artiSets: { 绝缘之旗印: { "2": [{ data: { recharge: 20 } }] } }, weapons: {}, chars: {} })
    const table = new BuffTable({ metaDir: dir })
    expect(table.setBuff("gs", "绝缘之旗印", 2)).toEqual([{ data: { recharge: 20 } }])
  })

  it("该件数没有 buff 时给空数组", () => {
    put({ artiSets: { 绝缘之旗印: { "2": [{ data: { recharge: 20 } }] } }, weapons: {}, chars: {} })
    const table = new BuffTable({ metaDir: dir })
    expect(table.setBuff("gs", "绝缘之旗印", 4)).toEqual([])
  })

  it("套装不存在时给空数组而不抛错", () => {
    put({ artiSets: {}, weapons: {}, chars: {} })
    const table = new BuffTable({ metaDir: dir })
    expect(table.setBuff("gs", "不存在的套装", 2)).toEqual([])
  })

  it("按武器名取 buff", () => {
    put({ artiSets: {}, weapons: { 护摩之杖: [{ refine: { hpPct: [20, 25, 30, 35, 40, 45] } }] }, chars: {} })
    const table = new BuffTable({ metaDir: dir })
    expect(table.weaponBuff("gs", "护摩之杖")[0]?.refine?.["hpPct"]).toEqual([20, 25, 30, 35, 40, 45])
  })

  it("按角色名取自带 buff", () => {
    put({ artiSets: {}, weapons: {}, chars: { 行秋: [{ data: { dmg: 20 } }] } })
    const table = new BuffTable({ metaDir: dir })
    expect(table.charBuff("gs", "行秋")).toEqual([{ data: { dmg: 20 } }])
  })

  it("文件缺失时各项为空且不抛错", () => {
    const table = new BuffTable({ metaDir: dir })
    expect(table.setBuff("gs", "绝缘之旗印", 2)).toEqual([])
    expect(table.weaponBuff("gs", "护摩之杖")).toEqual([])
    expect(table.charBuff("gs", "行秋")).toEqual([])
    expect(table.ready("gs")).toBe(false)
  })

  it("认不出的写法跳过并记日志，不抛错", () => {
    mkdirSync(join(dir, "meta-gs", "artifact"), { recursive: true })
    writeFileSync(join(dir, "meta-gs", "artifact", "calc.js"), "export default { 甲: { 2: 某个函数(18) } }", "utf8")
    const warned: string[] = []
    const logger = { warn: (msg: string) => warned.push(msg) } as unknown as NonNullable<ConstructorParameters<typeof BuffTable>[0]["logger"]>
    const table = new BuffTable({ metaDir: dir, logger })
    expect(table.ready("gs")).toBe(false)
    expect(warned.join("")).toContain("甲.2")
  })

  it("reload 之后重新读 —— 元数据更新的落点", () => {
    put({ artiSets: { 甲: { "2": [{ data: { atkPct: 1 } }] } } })
    const table = new BuffTable({ metaDir: dir })
    expect(table.setBuff("gs", "甲", 2)[0]?.data).toEqual({ atkPct: 1 })
    put({ artiSets: { 甲: { "2": [{ data: { atkPct: 2 } }] } } })
    expect(table.setBuff("gs", "甲", 2)[0]?.data).toEqual({ atkPct: 1 })
    table.reload()
    expect(table.setBuff("gs", "甲", 2)[0]?.data).toEqual({ atkPct: 2 })
  })

  it("两个游戏各读各的文件", () => {
    put({ artiSets: { 甲: { "2": [{ data: { atkPct: 1 } }] } }, weapons: {}, chars: {} }, "gs")
    put({ artiSets: { 乙: { "2": [{ data: { atkPct: 2 } }] } }, weapons: {}, chars: {} }, "sr")
    const table = new BuffTable({ metaDir: dir })
    expect(table.setBuff("gs", "甲", 2)).toHaveLength(1)
    expect(table.setBuff("gs", "乙", 2)).toHaveLength(0)
    expect(table.setBuff("sr", "乙", 2)).toHaveLength(1)
  })
})

describe("buff-parse 写法", () => {
  it("staticStep 带不带步长都认，算出六档", () => {
    const got = parseWeaponBuffs('export default function (step, staticStep) { return { 甲: staticStep("hpPct", 20), 乙: [staticStep("cdmg", 10, 2), { title: "x", refine: { dmg: step(9) } }], 丙: false } }', "gs")
    expect(got.table).toEqual({ 甲: [{ refine: { hpPct: [20, 25, 30, 35, 40, 45] } }], 乙: [{ refine: { cdmg: [10, 12, 14, 16, 18, 20] } }] })
    expect(got.unknown).toEqual([])
  })

  it("套装：attr 带元素、负值、导出标识符与直接导出字面量两种", () => {
    const named = parseSetBuffs('const attr = (k, v) => ({}); const buffs = { 甲: { 2: attr("dmg", 15, "冰"), 4: { title: "t", data: { aDmg: 1 } } } }\nexport default buffs')
    expect(named.table).toEqual({ 甲: { 2: [{ data: { dmg: 15 }, elem: "冰" }] } })
    const inline = parseSetBuffs('export default { "乙": { 2: attr("speedPct", -6) } }')
    expect(inline.table).toEqual({ 乙: { 2: [{ data: { speedPct: -6 } }] } })
  })

  it("角色：只收带 isStatic 的字面量，模板字符串里的括号不打乱配对", () => {
    const got = parseCharBuffs('export const buffs = [{ title: `被动${"}"}`, isStatic: true, data: { dmg: 20 } }, { check: ({ cons }) => cons > 2, data: { cpct: 9 } }, "vaporize"]')
    expect(got.table).toEqual([{ data: { dmg: 20 } }])
    expect(got.unknown).toEqual([])
  })

  it("isStatic 的 data 不是纯字面量时记为认不出", () => {
    const got = parseCharBuffs("export const buffs = [{ isStatic: true, data: { dmg: ({ attr }) => attr.atk } }]")
    expect(got.table).toEqual([])
    expect(got.unknown).toEqual(["buffs"])
  })
})

describe.skipIf(!existsSync(join(REAL, "meta-gs", "artifact", "calc.js")))("真实元数据", () => {
  const table = new BuffTable({ metaDir: REAL })

  it("两个游戏的表都可用，且没有认不出的写法", () => {
    const warned: string[] = []
    const logger = { warn: (msg: string) => warned.push(msg) } as unknown as NonNullable<ConstructorParameters<typeof BuffTable>[0]["logger"]>
    const fresh = new BuffTable({ metaDir: REAL, logger })
    expect(fresh.ready("gs")).toBe(true)
    expect(fresh.ready("sr")).toBe(true)
    expect(warned).toEqual([])
  })

  it("抽样：绝缘两件充能 +20%、护摩六档、行秋心海的被动", () => {
    expect(table.setBuff("gs", "绝缘之旗印", 2)[0]?.data).toEqual({ recharge: 20 })
    expect(table.weaponBuff("gs", "护摩之杖")[0]?.refine?.["hpPct"]).toEqual([20, 25, 30, 35, 40, 45])
    expect(table.charBuff("gs", "行秋")).toEqual([{ data: { dmg: 20 } }])
    expect(table.charBuff("gs", "珊瑚宫心海")).toEqual([{ data: { cpct: -100, heal: 25 } }])
    expect(table.weaponBuff("sr", "余生的第一天")[0]).toEqual({ idx: 1, key: "defPct" })
  })
})
