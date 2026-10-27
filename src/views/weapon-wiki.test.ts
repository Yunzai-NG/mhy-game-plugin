/**
 * 模块职责：武器 / 光锥图鉴视图的测试
 * 依赖方向：测试文件，依赖 views/weapon-wiki
 * 生命周期：无状态
 * 注意事项：固定四处：满级主属性的档位取法（带 `+` 的键优先，取反了会把满级算成刚够突破的值）、
 *          副属性按每五级一跳而非线性（两者在满级恰好相等，只有中间等级才看得出）、精炼描述的
 *          五档并列形态（百分号只留末尾一个、值带斜杠时整段再套括号）、一二星武器没有副属性时
 *          那一栏留空而不写 NaN。
 */
import { describe, expect, it } from "vitest"
import type { MaterialItem } from "../meta/material.js"
import type { WikiMaterialDeps } from "./char-wiki.js"
import type { WeaponDetail, WeaponWikiInput } from "./weapon-wiki.js"
import {
  asWeaponDetail,
  buildWeaponWiki,
  calcWeaponAttr,
  formatWeaponBase,
  lvRange,
  weaponAffix,
  weaponMaterials,
  weaponMaxLv,
  weaponWikiText
} from "./weapon-wiki.js"

/**
 * 造一个材料条目
 * @param name 全名
 * @param over 要盖掉的字段
 * @returns 条目
 */
function mat(name: string, over: Partial<MaterialItem> = {}): MaterialItem {
  return {
    name,
    type: "weapon",
    poseType: "weapon",
    star: 5,
    abbr: name,
    label: name,
    icon: `meta-gs/material/weapon/${name}.webp`,
    source: "",
    ...over
  }
}

/** 原神武器材料表 */
const GS_MATS: Record<string, MaterialItem> = {
  漆黑陨铁的一块: mat("漆黑陨铁的一块", { label: "璃月·漆黑陨铁" }),
  地脉的新芽: mat("地脉的新芽", { type: "monster", poseType: "monster" }),
  史莱姆原浆: mat("史莱姆原浆", { type: "normal", poseType: "normal" })
}

/** 星铁光锥材料表，键是材料 id */
const SR_BY_ID: Record<string, MaterialItem> = {
  "29328": mat("信用点", { type: "normal", poseType: "101", star: 3, label: "信用点" }),
  "635675": mat("此间寻梦", { type: "material", poseType: "301", star: 3, label: "此间寻梦" }),
  "920202": mat("一曲合弦的幻景", { type: "char", poseType: "701", star: 4, label: "一曲合弦的幻景" })
}

/** 按名字反查 */
const SR_BY_NAME: Record<string, MaterialItem> = Object.fromEntries(
  Object.values(SR_BY_ID).map(one => [one.name, one])
)

/** 原神那两条查材料的路 */
const gsDeps: WikiMaterialDeps = { byName: name => GS_MATS[name], byId: () => undefined }

/** 星铁那两条 */
const srDeps: WikiMaterialDeps = { byName: name => SR_BY_NAME[name], byId: id => SR_BY_ID[id] }

/** 护摩之杖的真实曲线，取自元数据 */
const GS_DETAIL: WeaponDetail = {
  desc: "在早已失落的古老祭仪中，使用的朱赤「柴火杖」。",
  affixTitle: "无羁的朱赤之蝶",
  affixData: {
    text: "生命值提升$[0]。此外，基于生命值上限的$[1]，获得攻击力加成。",
    datas: {
      "0": ["20%", "25%", "30%", "35%", "40%"],
      "1": ["0.8%", "1%", "1.2%", "1.4%", "1.6%"]
    }
  },
  attr: {
    atk: {
      "1": 45.94,
      "20": 121.73,
      "40": 235.2,
      "50": 308.42,
      "60": 382.43,
      "70": 456.99,
      "80": 532.23,
      "90": 608.07,
      "20+": 152.83,
      "40+": 266.3,
      "50+": 339.62,
      "60+": 413.53,
      "70+": 488.09,
      "80+": 563.33
    },
    bonusKey: "cdmg",
    bonusData: {
      "1": 14.4,
      "20": 25.44,
      "40": 37.08,
      "50": 42.9,
      "60": 48.72,
      "70": 54.52,
      "80": 60.34,
      "90": 66.15,
      "20+": 25.44,
      "40+": 37.08,
      "50+": 42.9,
      "60+": 48.72,
      "70+": 54.52,
      "80+": 60.34
    }
  },
  materials: { weapon: "漆黑陨铁的一块", monster: "地脉的新芽", normal: "史莱姆原浆" }
}

/** 一份星铁光锥详情 */
const SR_DETAIL: WeaponDetail = {
  desc: "一场术后对话。",
  skill: {
    name: "互相治愈",
    desc: "使能量恢复效率提高<nobr>$1[i]%</nobr>，终结技治疗量提高<nobr>$2[i]%</nobr>。",
    tables: { "1": [8, 10, 12, 14.000000000000002, 16], "2": [12, 15, 18, 21, 24] }
  },
  growAttr: { atk: 2.88, hp: 7.2, def: 2.25 },
  attr: { "6": { attrs: { atk: 195.84, hp: 489.6, def: 153 }, cost: { "29328": 1, "635675": 2, "920202": 3 } } }
}

/**
 * 造一份武器输入
 * @param over 要盖掉的字段
 * @returns 输入
 */
function weaponOf(over: Partial<WeaponWikiInput> = {}): WeaponWikiInput {
  return {
    game: "gs",
    name: "护摩之杖",
    star: 5,
    type: "polearm",
    gacha: "meta-gs/weapon/polearm/护摩之杖/gacha.webp",
    detail: GS_DETAIL,
    ...over
  }
}

describe("weaponMaxLv", () => {
  it("原神一二星只到 70 级四阶", () => {
    expect(weaponMaxLv("gs", 1)).toEqual({ level: 70, promote: 4 })
    expect(weaponMaxLv("gs", 2)).toEqual({ level: 70, promote: 4 })
  })

  it("原神三星起 90 级六阶", () => {
    expect(weaponMaxLv("gs", 3)).toEqual({ level: 90, promote: 6 })
    expect(weaponMaxLv("gs", 5)).toEqual({ level: 90, promote: 6 })
  })

  it("星铁一律 80 级六阶", () => {
    expect(weaponMaxLv("sr", 3)).toEqual({ level: 80, promote: 6 })
  })
})

describe("lvRange", () => {
  it("六阶 90 级落在 80~90 这一段", () => {
    expect(lvRange(90, 6)).toEqual({ left: 80, right: 90 })
  })

  it("四阶 70 级落在 60~70 —— 一二星武器就是这一档", () => {
    expect(lvRange(70, 4)).toEqual({ left: 60, right: 70 })
  })

  it("突破阶数决定用第几段：90 级既可以是六阶满级也可以是五阶顶着突破线", () => {
    expect(lvRange(90, 6)).toEqual({ left: 80, right: 90 })
    expect(lvRange(80, 5)).toEqual({ left: 70, right: 80 })
  })

  it("不指定突破阶数时取第一个包含该等级的段", () => {
    expect(lvRange(45, -1)).toEqual({ left: 40, right: 50 })
  })

  it("落不进任何段时回落到第一段而非抛错", () => {
    expect(lvRange(200, 6)).toEqual({ left: 1, right: 20 })
  })
})

describe("calcWeaponAttr 原神", () => {
  it("满级基础攻击恰好等于曲线上 90 级那一格", () => {
    expect(calcWeaponAttr(weaponOf())?.atkBase).toBeCloseTo(608.07, 2)
  })

  it("满级副属性恰好等于曲线上 90 级那一格", () => {
    expect(calcWeaponAttr(weaponOf())?.attr?.value).toBeCloseTo(66.15, 2)
  })

  it("副属性键原样带出来，格式化时才换成中文", () => {
    expect(calcWeaponAttr(weaponOf())?.attr?.key).toBe("cdmg")
  })

  it("没有属性曲线时给 undefined 而非抛错", () => {
    expect(calcWeaponAttr(weaponOf({ detail: {} }))).toBeUndefined()
  })

  it("没有副属性曲线时那一项算出 NaN，交由格式化去留空", () => {
    const detail: WeaponDetail = { attr: { atk: { "60": 100, "70": 120, "60+": 110 } } }
    const got = calcWeaponAttr(weaponOf({ star: 1, detail }))

    expect(Number.isNaN(got?.attr?.value)).toBe(true)
  })
})

describe("calcWeaponAttr 星铁", () => {
  it("该阶基础值加成长值乘（等级 - 1）", () => {
    const got = calcWeaponAttr(weaponOf({ game: "sr", star: 4, type: "丰饶", detail: SR_DETAIL }))

    expect(got?.atk).toBeCloseTo(195.84 + 2.88 * 79, 2)
    expect(got?.hp).toBeCloseTo(489.6 + 7.2 * 79, 2)
  })

  it("那一阶不存在时给 undefined", () => {
    const got = calcWeaponAttr(weaponOf({ game: "sr", detail: { attr: {} } }))

    expect(got).toBeUndefined()
  })
})

describe("formatWeaponBase", () => {
  it("原神：基础攻击走千分位、副属性键换中文且带百分号", () => {
    const got = formatWeaponBase(calcWeaponAttr(weaponOf()))

    expect(got.atkBase).toBe("608.1")
    expect(got.attr).toEqual({ key: "暴击伤害", value: "66.2%" })
  })

  it("元素精通不带百分号 —— 它是点数", () => {
    const got = formatWeaponBase({ atkBase: 500, attr: { key: "mastery", value: 165 } })

    expect(got.attr).toEqual({ key: "元素精通", value: "165.0" })
  })

  it("副属性算不出时整栏留空，不写 NaN", () => {
    const got = formatWeaponBase({ atkBase: 100, attr: { key: "cdmg", value: Number.NaN } })

    expect(got.attr).toEqual({ key: "", value: "" })
  })

  it("星铁三项都走千分位", () => {
    const got = formatWeaponBase(calcWeaponAttr(weaponOf({ game: "sr", star: 4, detail: SR_DETAIL })))

    expect(got.hp).toBe("1,058.4")
    expect(got.attr).toBeUndefined()
  })

  it("算不出时给一个空对象", () => {
    expect(formatWeaponBase(undefined)).toEqual({})
  })
})

describe("weaponAffix 原神", () => {
  it("五档并列，百分号只在末尾留一个", () => {
    const got = weaponAffix(weaponOf())

    expect(got.name).toBe("无羁的朱赤之蝶")
    expect(got.desc).toContain("<nobr>20/25/30/35/40%</nobr>")
    expect(got.desc).toContain("<nobr>0.8/1/1.2/1.4/1.6%</nobr>")
  })

  it("值本身带斜杠时整段再套一层圆括号 —— 否则分不清哪个斜杠是哪层", () => {
    const detail: WeaponDetail = {
      affixTitle: "甲",
      affixData: { text: "提升$[0]。", datas: { "0": ["1/2", "2/3"] } }
    }

    expect(weaponAffix(weaponOf({ detail })).desc).toContain("<nobr>(1/2)(2/3)</nobr>")
  })

  it("没有精炼数据时给空的名字与描述", () => {
    expect(weaponAffix(weaponOf({ detail: {} }))).toEqual({ name: "", desc: "" })
  })

  it("占位符查不到数据时替换成空 —— 那一栏本就没有内容可写", () => {
    const detail: WeaponDetail = { affixData: { text: "提升$[9]。", datas: {} } }

    expect(weaponAffix(weaponOf({ detail })).desc).toBe("提升<nobr></nobr>。")
  })
})

describe("weaponAffix 星铁", () => {
  it("五档并列且去掉小数尾巴 —— 14.000000000000002 显示成 14", () => {
    const got = weaponAffix(weaponOf({ game: "sr", star: 4, detail: SR_DETAIL }))

    expect(got.name).toBe("互相治愈")
    expect(got.desc).toContain("8/10/12/14/16%")
    expect(got.desc).toContain("12/15/18/21/24%")
  })

  it("描述里本就带 nobr 标签，故不再包一层", () => {
    const got = weaponAffix(weaponOf({ game: "sr", detail: SR_DETAIL }))

    expect(got.desc).not.toContain("<nobr><nobr>")
  })

  it("没有技能时给空的名字与描述", () => {
    expect(weaponAffix(weaponOf({ game: "sr", detail: {} }))).toEqual({ name: "", desc: "" })
  })
})

describe("weaponMaterials", () => {
  it("原神三格，份数按星级挑", () => {
    const got = weaponMaterials(weaponOf(), gsDeps)

    expect(got.map(one => one.label)).toEqual(["璃月·漆黑陨铁", "地脉的新芽", "史莱姆原浆"])
    expect(got.map(one => one.num)).toEqual(["5/14/14/6", "23/27/41", "15/23/27"])
  })

  it("四星武器另一套份数", () => {
    expect(weaponMaterials(weaponOf({ star: 4 }), gsDeps).map(one => one.num)).toEqual([
      "3/9/9/4",
      "15/18/27",
      "10/15/18"
    ])
  })

  it("一星武器的三格只有两档 —— 它们只突破到四阶", () => {
    expect(weaponMaterials(weaponOf({ star: 1 }), gsDeps).map(one => one.num)).toEqual(["1/3/1", "5/6", "3/5"])
  })

  it("星级不在表里时份数留空而非写 undefined", () => {
    expect(weaponMaterials(weaponOf({ star: 9 }), gsDeps).map(one => one.num)).toEqual(["", "", ""])
  })

  it("查不到的材料整格不出", () => {
    const got = weaponMaterials(weaponOf(), { byName: () => undefined, byId: () => undefined })

    expect(got).toEqual([])
  })

  it("星铁的材料 id 只在 attr 每一阶的 cost 里", () => {
    const got = weaponMaterials(weaponOf({ game: "sr", star: 5, type: "丰饶", detail: SR_DETAIL }), srDeps)

    // 次序沿用 mKeys.sr：101 / 301 / 701
    expect(got.map(one => one.label)).toEqual(["信用点", "此间寻梦", "一曲合弦的幻景"])
    expect(got.map(one => one.num)).toEqual(["88.3w", "4/12/15", "20/20/14"])
  })
})

describe("buildWeaponWiki", () => {
  it("类别中文名、立绘与介绍都在", () => {
    const view = buildWeaponWiki(weaponOf(), gsDeps)

    expect(view.typeName).toBe("长柄武器")
    expect(view.gacha).toBe("meta-gs/weapon/polearm/护摩之杖/gacha.webp")
    expect(view.desc).toBe("在早已失落的古老祭仪中，使用的朱赤「柴火杖」。")
  })

  it("介绍里的换行标签剥掉 —— 那一栏是定高的多行截断，标签留着会撑开它", () => {
    const detail: WeaponDetail = { ...GS_DETAIL, desc: "甲</br>乙<br />丙" }

    expect(buildWeaponWiki(weaponOf({ detail }), gsDeps).desc).toBe("甲乙丙")
  })

  it("布局配色是写死值", () => {
    expect(buildWeaponWiki(weaponOf(), gsDeps).elem).toBe("hydro")
    expect(buildWeaponWiki(weaponOf({ game: "sr" }), srDeps).elem).toBe("sr")
  })

  it("星铁的类别本就是中文，原样用", () => {
    const view = buildWeaponWiki(weaponOf({ game: "sr", star: 4, type: "丰饶", detail: SR_DETAIL }), srDeps)

    expect(view.typeName).toBe("丰饶")
  })
})

describe("asWeaponDetail", () => {
  it("null 与非对象都收成空表", () => {
    expect(asWeaponDetail(null)).toEqual({})
    expect(asWeaponDetail(42)).toEqual({})
  })

  it("对象原样收下", () => {
    expect(asWeaponDetail({ desc: "甲" }).desc).toBe("甲")
  })
})

describe("weaponWikiText", () => {
  it("带上星级、满级属性、精炼描述与材料", () => {
    const text = weaponWikiText(buildWeaponWiki(weaponOf(), gsDeps))

    expect(text).toContain("护摩之杖")
    expect(text).toContain("5 星")
    expect(text).toContain("基础攻击 608.1")
    expect(text).toContain("暴击伤害 66.2%")
    expect(text).toContain("无羁的朱赤之蝶")
    expect(text).toContain("璃月·漆黑陨铁")
  })

  it("精炼描述里的标签剥掉 —— 纯文字里那些标签没有意义", () => {
    expect(weaponWikiText(buildWeaponWiki(weaponOf(), gsDeps))).not.toContain("<nobr>")
  })

  it("星铁写的是三项主属性", () => {
    const text = weaponWikiText(buildWeaponWiki(weaponOf({ game: "sr", star: 4, type: "丰饶", detail: SR_DETAIL }), srDeps))

    expect(text).toContain("生命值")
    expect(text).toContain("攻击力")
    expect(text).toContain("防御力")
  })

  it("什么都算不出时也不抛错", () => {
    expect(() => weaponWikiText(buildWeaponWiki(weaponOf({ detail: {} }), gsDeps))).not.toThrow()
  })
})
