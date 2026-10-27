/**
 * 模块职责：面板属性计算的测试
 * 依赖方向：测试文件，依赖 panel/attr.ts 与 meta/buffs.ts
 * 生命周期：无状态
 * 注意事项：固定**四步顺序与三处折算**，即最容易静默算错处：白值必须先落 `base` 再乘百分比
 *          （顺序错则面板攻击少一大截而不报错）、圣遗物的 `atk`/`hp`/`def` 是百分比要补 `Pct`
 *          后缀（漏掉则"攻击 +46.6%"被当成"+46.6"）、与角色同元素的伤害加成折算成 `dmg`
 *          （漏掉则那一栏恒为 0）。逐值正确性另由全量差分核对保障。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { BuffTable } from "../meta/buffs.js"
import { calcAttr, type AttrInput } from "./attr.js"

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

let dir = ""
let buffs: BuffTable

/** 一份构造的原神角色：四项为生命、攻击、防御、暴击伤害 */
const GS_CHAR: AttrInput["char"] = {
  id: "10000002",
  name: "甘雨",
  elem: "cryo",
  attr: {
    keys: ["hpBase", "atkBase", "defBase", "cdmg"],
    details: {
      "1": [1000, 100, 50, 0],
      "20": [2000, 200, 100, 0]
    }
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attr-test-"))
  buffs = new BuffTable({ metaDir: dir })
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
  buffs = new BuffTable({ metaDir: dir })
}

/**
 * 造一份最小输入
 * @param over 覆盖项
 * @returns 输入
 */
function input(over: Partial<AttrInput> = {}): AttrInput {
  return { game: "gs", char: GS_CHAR, level: 1, promote: 0, ...over }
}

describe("原神起手自带的三项", () => {
  it("充能 100、暴击 5、暴伤 50", () => {
    const { attr } = calcAttr(input(), buffs)
    expect(attr["recharge"]).toBe(100)
    expect(attr["cpct"]).toBe(5)
    expect(attr["cdmg"]).toBe(50)
  })

  it("星铁不补这三项", () => {
    // 星铁的这三项写在角色 data.json 里，再补一遍会让暴击率凭空多 5%
    const { attr } = calcAttr(
      input({
        game: "sr",
        char: { id: "1001", name: "三月七", elem: "ice", srAttr: { "0": { attrs: { atk: 100, cpct: 5 } } } }
      }),
      buffs
    )
    expect(attr["cpct"]).toBe(5)
  })

  it("自带元素精通的角色按 id 认出来", () => {
    // 按 id 而非按名字：名字会随译名改，id 不会
    const { attr } = calcAttr(input({ char: { ...GS_CHAR, id: "10000119" } }), buffs)
    expect(attr["mastery"]).toBe(200)
  })

  it("其余角色没有那份精通", () => {
    expect(calcAttr(input(), buffs).attr["mastery"]).toBe(0)
  })

  it("旅行者（空 / 荧）自带一整族加成，两个 id 同一份", () => {
    const kong = calcAttr(input({ char: { ...GS_CHAR, id: "10000005" } }), buffs).attr
    const ying = calcAttr(input({ char: { ...GS_CHAR, id: "10000007" } }), buffs).attr
    expect(kong["mastery"]).toBe(15)
    // 起手自带的 5% / 50% 之上再加这一份
    expect(kong["cpct"]).toBe(15)
    expect(kong["cdmg"]).toBe(70)
    expect(kong["recharge"]).toBe(120)
    expect(ying["mastery"]).toBe(kong["mastery"])
  })

  it("旅行者的 `xxxPct` 走百分比通道 —— 当成固定值加会把 20% 记成 20 点", () => {
    // 判别性：hpPct 落对了则生命按白值的 1.2 倍算，落成固定值只多出 20 点
    const bare = calcAttr(input(), buffs).attr
    const trav = calcAttr(input({ char: { ...GS_CHAR, id: "10000005" } }), buffs).attr
    const hpBase = Number(trav["hpBase"]) || 0
    // hpBase 比基准多 50（那一项是固定值），而 hp 另外吃了 20%
    expect(hpBase).toBe((Number(bare["hpBase"]) || 0) + 50)
    expect(Number(trav["hp"])).toBeCloseTo(hpBase * 1.2, 6)
  })
})

describe("白值与百分比的先后", () => {
  it("武器白值计入 base 后再被百分比乘到", () => {
    // 这一条是判别性的：若武器攻击误落 plus，则"攻击 +100%"只乘角色白值
    const got = calcAttr(
      input({
        weapon: { name: "无锋剑", attr: { atk: { "1": 200, "20": 200 } } },
        weaponState: { level: 1, promote: 0 },
        artis: [{ main: { key: "atk", value: 100 } }]
      }),
      buffs
    )
    // 角色白值 100 + 武器 200 = 300，再 +100% = 600
    expect(got.attr["atk"]).toBeCloseTo(600, 6)
  })

  it("没有武器时只有角色白值", () => {
    expect(calcAttr(input(), buffs).attr["atk"]).toBeCloseTo(100, 6)
  })

  it("白值表带出 atkBase", () => {
    const got = calcAttr(
      input({
        weapon: { name: "无锋剑", attr: { atk: { "1": 200, "20": 200 } } },
        weaponState: { level: 1, promote: 0 }
      }),
      buffs
    )
    expect(got.attr["atkBase"]).toBeCloseTo(300, 6)
  })
})

describe("圣遗物词条的折算", () => {
  it("atk / hp / def 按百分比计", () => {
    // 漏掉 Pct 后缀则"攻击力 +46.6%"被当成"+46.6"，面板几乎不变而不报错
    const got = calcAttr(input({ artis: [{ main: { key: "atk", value: 50 } }] }), buffs)
    expect(got.attr["atk"]).toBeCloseTo(150, 6)
  })

  it("小词条 atkPlus 按固定值计", () => {
    const got = calcAttr(input({ artis: [{ main: { key: "atkPlus", value: 50 } }] }), buffs)
    expect(got.attr["atk"]).toBeCloseTo(150, 6)
  })

  it("与角色同元素的伤害加成折算成 dmg", () => {
    // 漏掉这一步则冰伤那一栏恒为 0
    const got = calcAttr(input({ artis: [{ main: { key: "cryo", value: 46.6 } }] }), buffs)
    expect(got.attr["dmg"]).toBeCloseTo(46.6, 6)
  })

  it("可产生反应的异种元素折算成 diffelem", () => {
    const got = calcAttr(input({ artis: [{ main: { key: "pyro", value: 46.6 } }] }), buffs)
    expect(got.attr["diffelem"]).toBeCloseTo(46.6, 6)
    expect(got.attr["dmg"]).toBe(0)
  })

  it("副词条与主词条一并计入", () => {
    const got = calcAttr(
      input({ artis: [{ main: { key: "cpct", value: 10 }, attrs: [{ key: "cpct", value: 5 }] }] }),
      buffs
    )
    // 起手 5 + 主 10 + 副 5
    expect(got.attr["cpct"]).toBeCloseTo(20, 6)
  })

  it("没有主词条的一件也吃它的副词条", () => {
    const got = calcAttr(input({ artis: [{ attrs: [{ key: "cpct", value: 7 }] }] }), buffs)
    expect(got.attr["cpct"]).toBeCloseTo(12, 6)
  })
})

describe("套装静态加成", () => {
  it("两件套加成生效", () => {
    put({ artiSets: { 角斗士的终幕礼: { "2": [{ data: { atkPct: 18 } }] } }, weapons: {}, chars: {} })
    const got = calcAttr(input({ sets: { 角斗士的终幕礼: 2 } }), buffs)
    expect(got.attr["atk"]).toBeCloseTo(118, 6)
  })

  it("四件套连带吃两件套那一份", () => {
    // 四件套同时享有两件套效果；漏掉即所有四件套角色少一截属性
    put({
      artiSets: { 甲: { "2": [{ data: { atkPct: 18 } }], "4": [{ data: { cpct: 20 } }] } },
      weapons: {},
      chars: {}
    })
    const got = calcAttr(input({ sets: { 甲: 4 } }), buffs)
    expect(got.attr["atk"]).toBeCloseTo(118, 6)
    expect(got.attr["cpct"]).toBeCloseTo(25, 6)
  })

  it("件数不足两件时不生效", () => {
    put({ artiSets: { 甲: { "2": [{ data: { atkPct: 18 } }] } }, weapons: {}, chars: {} })
    expect(calcAttr(input({ sets: { 甲: 1 } }), buffs).attr["atk"]).toBeCloseTo(100, 6)
  })

  it("限定元素的条目只对该元素的角色生效", () => {
    put({ artiSets: { 甲: { "2": [{ data: { dmg: 15 }, elem: "pyro" }] } }, weapons: {}, chars: {} })
    // 角色是冰，火限定的那条不该生效
    expect(calcAttr(input({ sets: { 甲: 2 } }), buffs).attr["dmg"]).toBe(0)
    const pyro = calcAttr(input({ char: { ...GS_CHAR, elem: "pyro" }, sets: { 甲: 2 } }), buffs)
    expect(pyro.attr["dmg"]).toBeCloseTo(15, 6)
  })
})

describe("武器静态 buff", () => {
  it("原神按精炼取那一档", () => {
    put({ artiSets: {}, weapons: { 护摩之杖: [{ refine: { hpPct: [20, 25, 30, 35, 40, 45] } }] }, chars: {} })
    const base = { name: "护摩之杖", attr: { atk: { "1": 0, "20": 0 } } }
    // 精一取下标 0
    expect(calcAttr(input({ weapon: base, weaponState: { level: 1, affix: 1 } }), buffs).attr["hp"]).toBeCloseTo(1200, 6)
    // 精五取下标 4
    expect(calcAttr(input({ weapon: base, weaponState: { level: 1, affix: 5 } }), buffs).attr["hp"]).toBeCloseTo(1400, 6)
  })

  it("星铁的数值取自武器自己的 tables", () => {
    // 表里只有 idx 与 key，数值随精炼变
    put({ artiSets: {}, weapons: { 余生的第一天: [{ idx: 1, key: "defPct" }] }, chars: {} }, "sr")
    const got = calcAttr(
      input({
        game: "sr",
        char: { id: "1001", name: "三月七", elem: "ice", weapon: "存护", srAttr: { "0": { attrs: { def: 100 } } } },
        weapon: { name: "余生的第一天", type: "存护", srAttr: { "0": { attrs: {} } }, tables: { "1": [12, 14, 16, 18, 20] } },
        weaponState: { level: 1, affix: 1 }
      }),
      buffs
    )
    expect(got.attr["def"]).toBeCloseTo(112, 6)
  })

  it("光锥命途与角色不符时只给白值不给 buff", () => {
    put({ artiSets: {}, weapons: { 余生的第一天: [{ idx: 1, key: "defPct" }] }, chars: {} }, "sr")
    const got = calcAttr(
      input({
        game: "sr",
        char: { id: "1001", name: "三月七", elem: "ice", weapon: "存护", srAttr: { "0": { attrs: { def: 100 } } } },
        weapon: {
          name: "余生的第一天",
          type: "毁灭",
          srAttr: { "0": { attrs: { def: 50 } } },
          tables: { "1": [12, 14, 16, 18, 20] }
        },
        weaponState: { level: 1, affix: 1 }
      }),
      buffs
    )
    // 白值 100 + 50 给了，12% 的 buff 没给
    expect(got.attr["def"]).toBeCloseTo(150, 6)
  })

  it("没有武器时不抛错", () => {
    expect(() => calcAttr(input({ weapon: undefined }), buffs)).not.toThrow()
  })
})

describe("角色自带静态 buff", () => {
  it("行秋的水伤加成计入", () => {
    put({ artiSets: {}, weapons: {}, chars: { 行秋: [{ data: { dmg: 20 } }] } })
    const got = calcAttr(input({ char: { ...GS_CHAR, name: "行秋", elem: "hydro" } }), buffs)
    expect(got.attr["dmg"]).toBeCloseTo(20, 6)
  })

  it("心海的负暴击也照算", () => {
    // 起手 5 减 100 得 -95：负值不该被截成 0，模板要显示它
    put({ artiSets: {}, weapons: {}, chars: { 珊瑚宫心海: [{ data: { cpct: -100, heal: 25 } }] } })
    const got = calcAttr(input({ char: { ...GS_CHAR, name: "珊瑚宫心海", elem: "hydro" } }), buffs)
    expect(got.attr["cpct"]).toBeCloseTo(-95, 6)
    expect(got.attr["heal"]).toBeCloseTo(25, 6)
  })

  it("没有自带 buff 的角色不受影响", () => {
    put({ artiSets: {}, weapons: {}, chars: { 行秋: [{ data: { dmg: 20 } }] } })
    expect(calcAttr(input(), buffs).attr["dmg"]).toBe(0)
  })
})

describe("星铁行迹", () => {
  it("atk / hp / def 按百分比，其余按固定值", () => {
    const char: AttrInput["char"] = {
      id: "1001",
      name: "三月七",
      elem: "ice",
      srAttr: { "0": { attrs: { atk: 100 } } },
      tree: {
        t1: { key: "atk", value: 10 },
        t2: { key: "cpct", value: 4 }
      }
    }
    const got = calcAttr(input({ game: "sr", char, trees: ["t1", "t2"] }), buffs)
    expect(got.attr["atk"]).toBeCloseTo(110, 6)
    expect(got.attr["cpct"]).toBeCloseTo(4, 6)
  })

  it("未激活的行迹不计入", () => {
    const char: AttrInput["char"] = {
      id: "1001",
      name: "三月七",
      elem: "ice",
      srAttr: { "0": { attrs: { atk: 100 } } },
      tree: { t1: { key: "atk", value: 10 } }
    }
    expect(calcAttr(input({ game: "sr", char, trees: [] }), buffs).attr["atk"]).toBeCloseTo(100, 6)
  })

  it("星铁与角色同元素的伤害加成折算成 dmg", () => {
    const char: AttrInput["char"] = {
      id: "1001",
      name: "三月七",
      elem: "ice",
      srAttr: { "0": { attrs: { atk: 100 } } },
      tree: { t1: { key: "ice", value: 3.2 } }
    }
    const got = calcAttr(input({ game: "sr", char, trees: ["t1"] }), buffs)
    expect(got.attr["dmg"]).toBeCloseTo(3.2, 6)
  })

  it("面板源给的 id 多一位前导 1 时脱掉再查 —— 少了这一步全部行迹加成静默丢失", () => {
    /*
     * 元数据记的是 `1306201`，而 Enka / Mihomo 与米游社给的是 `11306201`。整串查不到就
     * 当作没有这个节点的表现是：每个星铁角色的面板少掉两三项加成而属性栏看着正常
     * （花火少 28% 生命、24% 爆伤、10% 效果抵抗）。
     */
    const char: AttrInput["char"] = {
      id: "1306",
      name: "花火",
      elem: "quantum",
      srAttr: { "0": { attrs: { hp: 100 } } },
      tree: { "1306201": { key: "hp", value: 4 }, "1306202": { key: "cdmg", value: 5.3 } }
    }
    const got = calcAttr(input({ game: "sr", char, trees: ["11306201", "11306202"] }), buffs)

    expect(got.attr["hp"]).toBeCloseTo(104, 6)
    expect(got.attr["cdmg"]).toBeCloseTo(5.3, 6)
  })

  it("脱掉前导 1 之后仍查不到的不算 —— 不能把不相干的 id 猜成某个节点", () => {
    const char: AttrInput["char"] = {
      id: "1306",
      name: "花火",
      elem: "quantum",
      srAttr: { "0": { attrs: { hp: 100 } } },
      tree: { "1306201": { key: "hp", value: 4 } }
    }
    expect(calcAttr(input({ game: "sr", char, trees: ["19999999"] }), buffs).attr["hp"]).toBeCloseTo(100, 6)
  })
})

describe("输出形态", () => {
  it("带 _calc 标记与 staticAttr 分量", () => {
    const { attr } = calcAttr(input(), buffs)
    expect(attr._calc).toBe(true)
    expect(attr.staticAttr["atk"]).toBeDefined()
  })

  it("白值表可作评分的分母", () => {
    const { base } = calcAttr(input(), buffs)
    expect(base["atk"]).toBeCloseTo(100, 6)
  })

  it("buff 表缺失时仍能算出面板", () => {
    // 元数据是可选的，缺它只是少几项加成而非整条命令失败
    const got = calcAttr(input({ sets: { 甲: 4 } }), buffs)
    expect(got.attr["atk"]).toBeCloseTo(100, 6)
  })
})
