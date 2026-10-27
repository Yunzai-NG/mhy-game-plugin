/**
 * 模块职责：圣遗物评分的测试
 * 依赖方向：测试文件，依赖 panel/score/artis.ts 与 meta/arti.ts（读本文件里照元数据写法造的替身）
 * 生命周期：无状态
 * 注意事项：固定四项口径：**并列词条按候选列表逆序取**（稳定升序再整体反转，写成直接降序会让满分
 *          参照算错）、主词条按四分之一计、小词条按角色白值折算（攻击力另加 520）、权重表缺失时
 *          回落到通用权重。另固定**自定义规则拿到的 `artis` 的完整契约**（`names`、套装判定的两档
 *          件数与简称、带位置的主词条判定）—— 规则文件不经本仓库编译，少 `names` 是求值时抛
 *          TypeError、少主词条表是判定恒为假而评分静默退回通用那套。逐值正确性由落地差分比对保障。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { ArtiMetaTable } from "../../meta/arti.js"
import type { ArtiInput, CfgInput, MarkArtis } from "./artis.js"
import { markAll, markCfg, markClassOf, markOne, maxMarks } from "./artis.js"

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

/** 落着词条表与权重表替身的元数据目录 */
const META = mkdtempSync(join(tmpdir(), "artis-score-"))
writeArtiMeta(META)
afterAll(() => rmSync(META, { recursive: true, force: true }))

/** 造一张表 */
const table = (): ArtiMetaTable => new ArtiMetaTable({ metaDir: META })

/** 胡桃，用于取真实权重 */
const HUTAO = { id: "10000046", name: "胡桃", abbr: "胡桃", elem: "pyro", baseAttr: { hp: 15552, atk: 106, def: 876 } }

/**
 * 造一份评分配置输入
 * @param over 覆盖项
 * @returns 输入
 */
function cfgInput(over: Partial<CfgInput> = {}): CfgInput {
  // 缺省用一把不改变取向的武器：护摩之杖会把生命权重往上抬（见下面那条用例），
  // 拿它当缺省会让每条断言都掺进武器的影响
  return { game: "gs", char: HUTAO, weapon: { name: "无锋剑", affix: 1 }, ...over }
}

/**
 * 造一件圣遗物
 * @param main 主词条
 * @param attrs 副词条
 * @returns 圣遗物
 */
function arti(main: { key: string; value: number }, attrs: { key: string; value: number }[] = []): ArtiInput {
  return { name: "test", set: "test", level: 20, main, attrs }
}

describe("markClassOf", () => {
  it("按分段给档位，边界取下一档", () => {
    expect(markClassOf(6)).toBe("D")
    expect(markClassOf(7)).toBe("C")
    expect(markClassOf(41)).toBe("SS")
    expect(markClassOf(55)).toBe("ACE")
    expect(markClassOf(69)).toBe("MAX")
  })

  it("超过最高档时仍给 MAX，而不是 undefined", () => {
    expect(markClassOf(999)).toBe("MAX")
  })
})

describe("markCfg", () => {
  it("胡桃取到权重表里的那套，方案名带简称", () => {
    const cfg = markCfg(cfgInput(), table())
    // 权重表里胡桃的 hp 是 80
    expect(cfg.attrs["hp"]?.weight).toBe(80)
    expect(cfg.classTitle).toContain("胡桃")
  })

  it("护摩之杖把生命权重往上抬，方案名记下来 —— 换武器会改变取向", () => {
    const one = markCfg(cfgInput({ weapon: { name: "护摩之杖", affix: 5 } }), table())
    const bare = markCfg(cfgInput({ weapon: { name: "无锋剑", affix: 1 } }), table())
    expect(Number(one.attrs["hp"]?.weight)).toBeGreaterThan(Number(bare.attrs["hp"]?.weight))
    expect(one.classTitle).toContain("护摩")
  })

  it("绝缘四件套把充能权重拉到与沙漏最高权重齐平", () => {
    const cfg = markCfg(cfgInput({ sets: { 绝缘之旗印: 4 } }), table())
    expect(Number(cfg.attrs["recharge"]?.weight)).toBeGreaterThan(0)
    expect(cfg.classTitle).toContain("绝缘4")
  })

  it("权重为零的词条不进系数表 —— 它对该角色没有意义", () => {
    const cfg = markCfg(cfgInput(), table())
    // 胡桃的 def 权重是 0
    expect(cfg.attrs["def"]).toBeUndefined()
  })

  it("小词条按角色白值折算，故其 mark 远小于同名大词条", () => {
    const cfg = markCfg(cfgInput(), table())
    expect(Number(cfg.attrs["hpPlus"]?.mark)).toBeLessThan(Number(cfg.attrs["hp"]?.mark))
  })

  it("权重表里没有的角色回落到通用权重，而不是全零", () => {
    const cfg = markCfg(cfgInput({ char: { id: "1", name: "未收录角色", abbr: "未收录" } }), table())
    expect(Number(cfg.attrs["cpct"]?.weight)).toBeGreaterThan(0)
  })

  it("自定义规则优先于权重表 —— 那 69 个 artis.js 靠它", () => {
    const cfg = markCfg(
      cfgInput({ rule: ({ rule }) => rule("胡桃-自定义", { cpct: 100, cdmg: 100 }) }),
      table()
    )
    expect(cfg.classTitle).toBe("胡桃-自定义")
    expect(cfg.attrs["hp"]).toBeUndefined()
  })

  it("def 收第二参把规则自己攒的标题段续上 —— 不收则那些标题整条丢失、方案名恒为「通用」", () => {
    // 新 meta 有七十个 artis.js 写 `def(particularAttr, title)`
    const cfg = markCfg(
      cfgInput({ rule: ({ def }) => def({ cpct: 100 }, ["纯辅"]) }),
      table()
    )
    expect(cfg.classTitle).toBe("胡桃-纯辅")
  })

  it("多段标题用 `|` 分隔 —— 直接相接会黏成「纯辅高命」", () => {
    const cfg = markCfg(
      cfgInput({ rule: ({ def }) => def({ cpct: 100 }, ["纯辅", "高命"]) }),
      table()
    )
    expect(cfg.classTitle).toBe("胡桃-纯辅|高命")
  })

  it("规则读得到武器副属性键 —— 爱可菲按它分档，取不到则那条判定恒为假", () => {
    let seen: string | undefined = "未读到"
    markCfg(
      cfgInput({
        weapon: { name: "护摩之杖", affix: 1, bonusKey: "recharge" },
        rule: arg => {
          seen = arg.weapon.bonusKey
          return arg.def()
        }
      }),
      table()
    )
    expect(seen).toBe("recharge")
  })
})

describe("自定义规则拿到的 artis", () => {
  /**
   * 取自定义规则实际收到的那个 artis
   * @param over 覆盖项
   * @returns 规则收到的判定
   */
  function seen(over: Partial<CfgInput> = {}): MarkArtis {
    let got: MarkArtis | undefined
    markCfg(
      cfgInput({
        ...over,
        rule: arg => {
          got = arg.artis
          return arg.def()
        }
      }),
      table()
    )
    if (!got) throw new Error("规则没被调用")
    return got
  }

  it("给出已成套的套装全名 —— 有三个角色的规则读的是 names", () => {
    // 单件不算成套，故不列入。
    // 少了 names 那三份规则一律抛错，而抛错点在装配面板的中途，整条命令连图都出不来
    const got = seen({ sets: { 沉沦之心: 4, 深林的记忆: 1 } })

    expect(got.names).toEqual(["沉沦之心"])
    expect(() => got.names.includes("沉沦之心")).not.toThrow()
  })

  it("套装判定认全名也认简称", () => {
    const got = seen({ sets: { 冰风迷途的勇士: 4 }, setAbbr: { 冰风迷途的勇士: "冰套" } })

    expect(got.is("冰套4")).toBe(true)
    expect(got.is("冰风迷途的勇士4")).toBe(true)
    expect(got.is("绝缘4")).toBe(false)
  })

  it("件数只分两件与四件两档", () => {
    // 三件按两件算、五件按四件算；四件在身上时「某套2」为假 —— 判据是组合串而非件数比较
    expect(seen({ sets: { 绝缘之旗印: 3 } }).is("绝缘之旗印2")).toBe(true)
    expect(seen({ sets: { 绝缘之旗印: 4 } }).is("绝缘之旗印2")).toBe(false)
    expect(seen({ sets: { 绝缘之旗印: 4 } }).is("绝缘之旗印4")).toBe(true)
    expect(seen({ sets: { 绝缘之旗印: 1 } }).is("绝缘之旗印2")).toBe(false)
  })

  it("逗号分隔的几套里命中一套即为真", () => {
    const got = seen({ sets: { 绝缘之旗印: 4 } })

    expect(got.is("宗室之翎4,绝缘之旗印4")).toBe(true)
  })

  it("带位置时判的是该位置的主词条 —— 六个角色的权重方案据此切换", () => {
    // `is("cpct,cdmg,def", 5)` 若被当成套装名去查就恒为假，
    // 表现是那几个角色的评分方案静默退回通用那套
    const got = seen({ mains: { 3: "mastery", 4: "pyro", 5: "cpct" } })

    expect(got.is("cpct,cdmg,def", 5)).toBe(true)
    expect(got.is("heal", 5)).toBe(false)
    expect(got.is("mastery", 3)).toBe(true)
  })

  it("多个位置要全部命中", () => {
    const got = seen({ mains: { 3: "hp", 4: "hp", 5: "cpct" } })

    expect(got.is("hp", "3,4")).toBe(true)
    expect(got.is("hp", "3,4,5")).toBe(false)
  })

  it("伤害位上的元素主词条算作 dmg", () => {
    const got = seen({ mains: { 4: "pyro" } })

    expect(got.is("dmg", 4)).toBe(true)
    // 物伤不是元素，故不认
    expect(seen({ mains: { 4: "phy" } }).is("dmg", 4)).toBe(false)
  })

  it("不给主词条表时按位置的判定为假而不是抛错", () => {
    expect(seen().is("cpct", 5)).toBe(false)
  })
})

describe("maxMarks 并列取舍", () => {
  it("并列时按候选列表逆序取 —— 判据是稳定升序再整体反转", () => {
    // 位置 5 主词条候选序为 atk,def,hp,mastery,heal,cpct,cdmg，heal 排在 hp 之后，而副词条里没有
    // heal 只有 hp：并列挑中靠后的 heal 则 hp 仍可作副词条计入满分，改成直接降序挑中 hp 则满分缩水。
    // 只给这两项非零权重，使断言只反映取舍顺序本身
    const tied = markCfg(cfgInput({ rule: ({ rule }) => rule("并列", { hp: 100, heal: 100 }) }), table())
    const hpWins = markCfg(cfgInput({ rule: ({ rule }) => rule("hp 更高", { hp: 100, heal: 99 }) }), table())
    expect(tied.posMaxMark["5"]).toBeGreaterThan(hpWins.posMaxMark["5"] ?? 0)
  })

  it("花与叶的主词条固定，其主词条满分为零", () => {
    const cfg = markCfg(cfgInput(), table())
    expect(cfg.posMaxMark["m1"]).toBe(0)
    expect(cfg.posMaxMark["m2"]).toBe(0)
  })

  it("原神算到位置 5，星铁算到位置 6", () => {
    const t = table()
    const gs = maxMarks(markCfg(cfgInput(), t).attrs, t.meta("gs"), "gs")
    expect(gs["6"]).toBeUndefined()
    const srCfg = markCfg(
      { game: "sr", char: { id: "1208", name: "符玄", abbr: "符玄", baseAttr: { hp: 1000, atk: 500, def: 400 } } },
      t
    )
    expect(srCfg.posMaxMark["6"]).toBeGreaterThan(0)
  })
})

describe("markOne", () => {
  it("花的主词条不计分，只算副词条", () => {
    const cfg = markCfg(cfgInput(), table())
    const withSub = markOne({ char: HUTAO, cfg, idx: 1, arti: arti({ key: "hpPlus", value: 4780 }, [{ key: "cpct", value: 7.8 }]), game: "gs" })
    const bare = markOne({ char: HUTAO, cfg, idx: 1, arti: arti({ key: "hpPlus", value: 4780 }), game: "gs" })
    expect(withSub).toBeGreaterThan(bare)
  })

  it("位置 3 起主词条计分，且只按四分之一计", () => {
    const cfg = markCfg(cfgInput(), table())
    const one = markOne({ char: HUTAO, cfg, idx: 3, arti: arti({ key: "hp", value: 46.6 }), game: "gs" })
    expect(one).toBeGreaterThan(0)
  })

  it("没有主词条时得零分，不抛错 —— 面板可能给来一件空的", () => {
    const cfg = markCfg(cfgInput(), table())
    expect(markOne({ char: HUTAO, cfg, idx: 3, arti: {}, game: "gs" })).toBe(0)
  })

  it("契合的元素杯不打折，不契合的要打折", () => {
    const cfg = markCfg(cfgInput(), table())
    const fit = markOne({ char: HUTAO, cfg, idx: 5, arti: arti({ key: "pyro", value: 46.6 }), elem: "pyro", game: "gs" })
    const off = markOne({ char: HUTAO, cfg, idx: 5, arti: arti({ key: "cryo", value: 46.6 }), elem: "pyro", game: "gs" })
    expect(fit).toBeGreaterThanOrEqual(off)
  })
})

describe("markAll", () => {
  it("五件的分数与总分、档位都给出来", () => {
    const list: Record<string, ArtiInput> = {
      "1": arti({ key: "hpPlus", value: 4780 }, [{ key: "cpct", value: 7.8 }]),
      "2": arti({ key: "atkPlus", value: 311 }, [{ key: "cdmg", value: 15.5 }]),
      "3": arti({ key: "hp", value: 46.6 }, [{ key: "cpct", value: 3.9 }]),
      "4": arti({ key: "pyro", value: 46.6 }, [{ key: "cdmg", value: 7.8 }]),
      "5": arti({ key: "cdmg", value: 62.2 }, [{ key: "cpct", value: 3.9 }])
    }
    const ret = markAll(list, cfgInput(), table())
    expect(Object.keys(ret.artis)).toHaveLength(5)
    expect(ret._mark).toBeGreaterThan(0)
    expect(ret.markClass.length).toBeGreaterThan(0)
    expect(ret.classTitle).toContain("胡桃")
  })

  it("空的一件不计入套装数，也不该让整套失败", () => {
    // 位置 1 的主词条不计分，故这件花本身得 0 分；此处要验的是"有一件空的也不崩"，
    // 于是给它带一条副词条，使总分确实来自那件有内容的
    const ret = markAll(
      { "1": arti({ key: "hpPlus", value: 4780 }, [{ key: "cpct", value: 7.8 }]), "2": {} },
      cfgInput(),
      table()
    )
    expect(ret._mark).toBeGreaterThan(0)
    expect(Object.keys(ret.artis)).toHaveLength(1)
  })

  it("一件都没有时总分为零", () => {
    const ret = markAll({}, cfgInput(), table())
    expect(ret._mark).toBe(0)
  })

  it("总分档位按件数均分后再判 —— 否则五件的总分必然落在最高档", () => {
    const list: Record<string, ArtiInput> = {
      "1": arti({ key: "hpPlus", value: 4780 }, [{ key: "cpct", value: 3.9 }])
    }
    const ret = markAll(list, cfgInput(), table())
    // 只有一件且词条平平，不该是最高档
    expect(ret.markClass).not.toBe("MAX")
  })
})
