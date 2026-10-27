/**
 * 模块职责：天赋 / 命座页视图的测试
 * 依赖方向：测试文件，依赖 views/char-talent
 * 生命周期：无状态
 * 注意事项：固定四处：占位符要换成实际数值且不能漏（在循环里改写被匹配的串会因长度变化跳过后面的
 *          占位符）、数值表要摊成数组（不摊则模板里 `tables.length > 0` 恒为假、整张表不出现）、
 *          代入等级按天赋种类分两档（普攻表长 15 而战技只到 12）、不改原详情对象（装载器把它缓存
 *          复用，改了它第二次查同一角色会看到已代入过的描述）。
 */
import { describe, expect, it } from "vitest"
import type { WikiCharInput, WikiDetail } from "./char-wiki.js"
import type { CharTalentView, LineItem } from "./char-talent.js"
import {
  buildCharTalent,
  charTalentText,
  lvOf,
  percent,
  prepareDetail,
  talentDesc,
  talentFrameOf,
  talentLine,
  talentTitle
} from "./char-talent.js"

/** 一份原神角色详情：描述已是数组、数值表已是成品文本 */
const GS_DETAIL: WikiDetail = {
  title: "雪霁梅香",
  desc: "「往生堂」七十七代堂主。",
  baseAttr: { hp: 15552, atk: 106.4, def: 876 },
  growAttr: { key: "cdmg", value: 38.4 },
  talent: {
    a: { name: "灭却之戒法", desc: ["进行至多五段的连续枪击。"], tables: [{ name: "一段伤害", values: ["78.6%"] }] },
    e: { name: "蝶引来生", desc: ["只有永不间断的烈焰。"], tables: [] }
  },
  cons: { "1": { name: "赤团开时斜飞去", desc: ["重击不消耗体力。"] } },
  passive: [{ name: "多多益善", desc: ["有 18% 概率额外获得料理。"] }]
}

/** 一份星铁角色详情：描述是整句、带占位符，数值表是对象且值为裸数字 */
const SR_DETAIL: WikiDetail = {
  desc: "星穹列车的随车工程师。",
  sp: 120,
  baseAttr: { atk: 756.756, hp: 1047.816, def: 436.59, speed: 96 },
  tree: { a: { key: "fire", value: 3.2 }, b: { key: "atk", value: 4 }, c: { key: "fire", value: 3.2 } },
  talent: {
    a: {
      name: "裂空之光",
      type: "普攻",
      desc: "对指定敌方造成等同于$1[i]%攻击力的火属性伤害。",
      tables: { "1": { name: "伤害", isSame: false, values: [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5] } }
    },
    e: {
      name: "熔核爆裂",
      type: "战技",
      desc: "造成等同于$1[i]%攻击力的伤害，恢复$3[i]点能量。",
      tables: {
        "1": { name: "主目标伤害", isSame: false, values: [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.625, 1.75] },
        "3": { name: "能量恢复", isSame: true, values: [30] }
      }
    },
    z: { name: "不完全燃烧", type: "秘技", desc: "制造一片领域。<br>领域最多一个。", tables: {} }
  },
  cons: { "1": { name: "童年", desc: "速度提高 20%。<br>持续 2 回合。" } },
  treeData: { "1003101": { type: "skill", desc: "施放攻击后灼烧。<br />持续 2 回合。" } }
}

/**
 * 一份绝区零代理人详情
 *
 * 与原神那一份同形：文案在造包时就换成了标签、倍率已逐级算好，
 * 故这一路在视图层几乎不必分支。**基础数据里混着字符串**（百分数与每秒回复）是刻意的。
 */
const ZZZ_DETAIL: WikiDetail = {
  prof: "击破",
  camp: "狡兔屋",
  hit: "斩击",
  fullName: "安比·德玛拉",
  baseAttr: { hp: 7500, atk: 583, def: 612, impact: 118, cpct: "5%", cdmg: "50%", am: 94, ap: 93, er: "1.2/秒" },
  talent: {
    basic: {
      name: "普通攻击",
      desc: ["<h3>普通攻击：伏特速攻</h3>", '<p>点按 <span class="key">普攻</span> 发动：</p>'],
      tables: [
        { name: "一段伤害倍率", values: ["31.2%", "34.1%"] },
        { name: "能量消耗", isSame: true, values: ["20"] }
      ]
    },
    chain: { name: "连携技", desc: ["<h3>连携技：电磁引擎</h3>"], tables: [] }
  },
  cons: {
    "1": { name: "快充模式", desc: ["<p>能量获得效率提升 12%。</p>", '<p class="story">少女并非探索空洞的生手。</p>'] }
  },
  passive: [
    { name: "核心技加成（满档）", desc: ["<p>基础攻击力 +75　冲击力 +18</p>"] },
    { name: "核心被动：波动电压", desc: ["<p>招式造成的失衡值提升 64%。</p>"] }
  ]
}

/**
 * 造一份角色输入
 * @param over 要盖掉的字段
 * @returns 输入
 */
function charOf(over: Partial<WikiCharInput> = {}): WikiCharInput {
  return {
    game: "gs",
    name: "胡桃",
    abbr: "胡桃",
    star: 5,
    elem: "pyro",
    weapon: "polearm",
    isMain: false,
    detail: GS_DETAIL,
    imgs: {},
    ...over
  }
}

/**
 * 造一位代理人的输入
 * @returns 输入
 */
function agentOf(): WikiCharInput {
  return charOf({ game: "zzz", name: "安比", abbr: "安比", star: 3, elem: "电", weapon: "", detail: ZZZ_DETAIL })
}

describe("percent", () => {
  it("先乘一百再带百分号 —— 星铁的表里存的是倍率", () => {
    expect(percent(1.1)).toBe("110.0%")
    expect(percent(0.5, 2)).toBe("50.00%")
  })

  it("非数按 0 算", () => {
    expect(percent("甲")).toBe("0.0%")
  })
})

describe("lvOf", () => {
  it("普攻与两种记忆技代入 5 级 —— 它们的表长 15 而战技只到 12", () => {
    for (const key of ["a", "a2", "me", "me2", "mt", "mt1", "mt2"]) expect(lvOf(key)).toBe(5)
  })

  it("其余代入 8 级", () => {
    for (const key of ["e", "q", "t", "z"]) expect(lvOf(key)).toBe(8)
  })
})

describe("talentDesc", () => {
  const tables = {
    "1": { name: "伤害", isSame: false, values: [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.625, 1.75] },
    "3": { name: "能量恢复", isSame: true, values: [30] }
  }

  it("百分号占位符换成百分比并缀上级数", () => {
    const got = talentDesc("造成$1[i]%攻击力的伤害。", tables, 8)

    expect(got.desc[0]).toBe("造成175.0% (lv8)攻击力的伤害。")
  })

  it("不带百分号的占位符走千分位", () => {
    const got = talentDesc("恢复$3[i]点能量。", tables, 1)

    expect(got.desc[0]).toBe("恢复30 (lv1)点能量。")
  })

  it("同一句里的多个占位符都要换 —— 在循环里改写原串会因长度变化跳过后面的", () => {
    const got = talentDesc("造成$1[i]%伤害，恢复$3[i]点能量。", tables, 1)

    expect(got.desc[0]).toBe("造成100.0% (lv1)伤害，恢复30 (lv1)点能量。")
  })

  it("f2 保留两位小数", () => {
    expect(talentDesc("$1[f2]%", tables, 1).desc[0]).toBe("100.00% (lv1)")
  })

  it("取不到数值时占位符原样留着 —— 那至少提示了这一格没数据", () => {
    expect(talentDesc("$9[i]%", tables, 1).desc[0]).toBe("$9[i]%")
  })

  it("级数越界时同样原样留着", () => {
    expect(talentDesc("$1[i]%", tables, 99).desc[0]).toContain("$1[i]%")
  })

  it("数值表摊成数组，键序即对象键序", () => {
    const got = talentDesc("造成$1[i]%伤害。", tables, 1)

    expect(Array.isArray(got.tables)).toBe(true)
    expect(got.tables.map(one => one.name)).toEqual(["伤害", "能量恢复"])
  })

  it("被百分号占位符引用过的表按百分比格式化，其余按千分位", () => {
    const got = talentDesc("造成$1[i]%伤害。", tables, 1)

    expect(got.tables[0]?.values[0]).toBe("100.0%")
  })

  it("逐级同值的那一行原样输出且标出来 —— 模板把它挪到表外单列", () => {
    const got = talentDesc("恢复$3[i]点能量。", tables, 1)

    expect(got.tables[1]?.isSame).toBe(true)
    expect(got.tables[1]?.values).toEqual(["30"])
  })

  it("按 <br> 折行", () => {
    expect(talentDesc("甲<br>乙", tables, 1).desc).toEqual(["甲", "乙"])
  })

  it("没有数值表时给空数组而非抛错", () => {
    expect(talentDesc("甲", undefined).tables).toEqual([])
  })
})

describe("prepareDetail", () => {
  it("原神的纯文字行转义后包成段落，元素词挂元素色类", () => {
    const detail: WikiDetail = {
      cons: { "1": { name: "一命", desc: ["造成30%攻击力的雷元素伤害，获得火元素伤害加成。", "<i>「故事」</i>", ""] } },
      passive: [{ name: "固有", desc: ["A<B & 冰元素抗性"] }]
    }
    const got = prepareDetail(detail, "gs")
    const cons = got.cons as Record<string, { desc?: string[] }>
    const passive = got.passive as { desc?: string[] }[]

    expect(cons["1"]?.desc).toEqual([
      '<p>造成30%攻击力的<span class="wk-el e-electro">雷元素伤害</span>，获得<span class="wk-el e-pyro">火元素伤害加成</span>。</p>',
      // 以 `<` 开头的是 `<h3>` 小标题与 `<i>` 技能故事，原样留着；空行仍是空串，模板据此跳过
      "<i>「故事」</i>",
      ""
    ])
    expect(passive[0]?.desc?.[0]).toBe('<p>A&lt;B &amp; <span class="wk-el e-cryo">冰元素抗性</span></p>')
  })

  it("原神只认「X元素」打头的词 —— 元素战技、元素精通、物理伤害游戏内本是白字", () => {
    const got = prepareDetail({ cons: { "1": { desc: ["元素战技造成的物理伤害提升，元素精通提高。"] } } }, "gs")

    expect((got.cons as Record<string, { desc?: string[] }>)["1"]?.desc?.[0]).not.toContain("wk-el")
  })

  it("绝区零给裹着属性名的 nobr 挂元素色类，数值、状态与流明不挂", () => {
    const detail: WikiDetail = {
      talent: {
        basic: {
          desc: [
            "造成<nobr>物理伤害</nobr>与<nobr>烈霜伤害</nobr>，提升<nobr>12%</nobr>，触发<nobr>[强击]</nobr>，造成<nobr>流明属性伤害</nobr>。"
          ]
        }
      }
    }
    const got = prepareDetail(detail, "zzz")
    const line = (got.talent as Record<string, { desc?: string[] }>)["basic"]?.desc?.[0]

    expect(line).toBe(
      '造成<nobr class="wk-el e-physical">物理伤害</nobr>与<nobr class="wk-el e-ice">烈霜伤害</nobr>，提升<nobr>12%</nobr>，触发<nobr>[强击]</nobr>，造成<nobr>流明属性伤害</nobr>。'
    )
  })

  it("绝区零的属性名要紧跟属性 / 伤害 / 异常 —— 「电量」一类不着色", () => {
    const got = prepareDetail({ cons: { "1": { desc: ["<nobr>电量</nobr>"] } } }, "zzz")

    expect((got.cons as Record<string, { desc?: string[] }>)["1"]?.desc?.[0]).toBe("<nobr>电量</nobr>")
  })

  it("原神与绝区零同样**不改原对象**，故事文案不着色", () => {
    const zzz: WikiDetail = { cons: { "1": { desc: ["<nobr>火属性伤害</nobr>"], story: ["<nobr>火属性伤害</nobr>"] } } }
    const before = [JSON.stringify(GS_DETAIL), JSON.stringify(zzz)]
    const got = prepareDetail(zzz, "zzz")
    prepareDetail(GS_DETAIL, "gs")

    expect([JSON.stringify(GS_DETAIL), JSON.stringify(zzz)]).toEqual(before)
    expect((got.cons as Record<string, { story?: string[] }>)["1"]?.story).toEqual(["<nobr>火属性伤害</nobr>"])
  })

  it("星铁的天赋描述代入数值并摊平数值表", () => {
    const got = prepareDetail(SR_DETAIL, "sr")
    const e = (got.talent as Record<string, { desc?: string[]; tables?: { name: string }[] }>)["e"]

    expect(e?.desc?.[0]).toContain("175.0% (lv8)")
    expect(Array.isArray(e?.tables)).toBe(true)
  })

  it("普攻代入 5 级、战技代入 8 级", () => {
    const got = prepareDetail(SR_DETAIL, "sr")
    const talent = got.talent as Record<string, { desc?: string[] }>

    expect(talent["a"]?.desc?.[0]).toContain("(lv5)")
    expect(talent["e"]?.desc?.[0]).toContain("(lv8)")
  })

  it("命座与行迹只按 <br> 折行，不代入数值", () => {
    const got = prepareDetail(SR_DETAIL, "sr")
    const cons = got.cons as Record<string, { desc?: string[] }>

    expect(cons["1"]?.desc).toEqual(["速度提高 20%。", "持续 2 回合。"])
  })

  it("`<br />` 不被 split 认得，故整句留着 —— 星铁那一支模板本就原样输出 HTML", () => {
    const got = prepareDetail(SR_DETAIL, "sr")
    const tree = got.treeData as Record<string, { desc?: string[] }>

    expect(tree["1003101"]?.desc).toHaveLength(1)
  })

  it("**不改原对象** —— 装载器把详情缓存着复用，改了它第二次查就看到代入过一遍的描述", () => {
    const before = JSON.stringify(SR_DETAIL)
    prepareDetail(SR_DETAIL, "sr")

    expect(JSON.stringify(SR_DETAIL)).toBe(before)
  })

  it("没有那三段时不抛错", () => {
    expect(() => prepareDetail({}, "sr")).not.toThrow()
  })
})

describe("talentLine", () => {
  it("原神给一维数组：三项基础属性加一项成长", () => {
    const got = talentLine(charOf()) as LineItem[]

    expect(got.map(one => one.label)).toEqual(["基础生命", "基础攻击", "基础防御", "成长·爆伤"])
  })

  it("星铁给两组，上行的速度那一项**不带「基础」二字**", () => {
    const got = talentLine(charOf({ game: "sr", detail: SR_DETAIL, elem: "火" })) as {
      ret: LineItem[]
      growret: LineItem[]
    }

    expect(got.ret.map(one => one.label)).toEqual(["基础生命", "基础攻击", "基础防御", "速度"])
  })

  it("星铁下行用另一张标题表：暴击在这里叫「暴击率」而图鉴页叫「暴击」", () => {
    const detail: WikiDetail = { ...SR_DETAIL, tree: { a: { key: "cpct", value: 5.3 } } }
    const got = talentLine(charOf({ game: "sr", detail, elem: "火" })) as { growret: LineItem[] }

    expect(got.growret[0]).toEqual({ num: "5.3", label: "暴击率" })
  })

  it("行迹键认不出时按元素伤害算", () => {
    const detail: WikiDetail = { ...SR_DETAIL, tree: { a: { key: "fire", value: 6.4 } } }
    const got = talentLine(charOf({ game: "sr", detail, elem: "火" })) as { growret: LineItem[] }

    expect(got.growret[0]?.label).toBe("火伤")
  })

  it("没有基础属性时星铁那一组为空，模板据此写「暂无详细数据」", () => {
    const got = talentLine(charOf({ game: "sr", detail: {} })) as { ret: LineItem[] }

    expect(got.ret).toEqual([])
  })

  it("绝区零给一维数组，标题由 panel/prop 那张表给", () => {
    const got = talentLine(agentOf()) as LineItem[]

    expect(got.map(one => one.label)).toEqual([
      "生命值",
      "攻击力",
      "防御力",
      "冲击力",
      "暴击率",
      "暴击伤害",
      "异常掌控",
      "异常精通",
      "能量自动回复"
    ])
  })

  it("绝区零的字符串项原样印、数字项按千分位 —— 少了这一分派，百分号会被当成非数按 0 算", () => {
    const got = talentLine(agentOf()) as LineItem[]

    expect(got[0]).toEqual({ num: "7,500", label: "生命值" })
    expect(got[4]).toEqual({ num: "5%", label: "暴击率" })
  })

  it("认不出的词条键整项跳过 —— 图上多一行 `atkPlus` 比少一行更难查", () => {
    const detail: WikiDetail = { ...ZZZ_DETAIL, baseAttr: { hp: 100, zzzUnknown: 1 } }
    const got = talentLine(charOf({ game: "zzz", detail })) as LineItem[]

    expect(got.map(one => one.label)).toEqual(["生命值"])
  })
})

describe("buildCharTalent", () => {
  it("等级表头是 Lv1 到 Lv15", () => {
    const view = buildCharTalent(charOf(), "talent")

    expect(view.lvs).toHaveLength(15)
    expect(view.lvs[0]).toBe("Lv1")
    expect(view.lvs[14]).toBe("Lv15")
  })

  it("绝区零只到 Lv12 —— 多出的三列恒为空，且把这张最大的图又撑宽两成", () => {
    const view = buildCharTalent(agentOf(), "talent")

    expect(view.lvs).toHaveLength(12)
    expect(view.lvs.at(-1)).toBe("Lv12")
  })

  it("模式原样带进视图 —— 模板按它决定画天赋还是命座", () => {
    expect(buildCharTalent(charOf(), "cons").mode).toBe("cons")
  })

  it("原神的介绍走折行，星铁的由模板直接取 detail.desc", () => {
    expect(buildCharTalent(charOf(), "talent").desc).toBe("「往生堂」七十七代堂主")
  })

  it("星铁的详情已处理过", () => {
    const view = buildCharTalent(charOf({ game: "sr", detail: SR_DETAIL, elem: "火" }), "talent")
    const talent = view.detail.talent as Record<string, { desc?: string[] }>

    expect(talent["e"]?.desc?.[0]).toContain("(lv8)")
  })

  it("绝区零的介绍由身份那几项凑成 —— 包里刻意不落人物志长文", () => {
    const view = buildCharTalent(agentOf(), "talent")

    expect(view.desc).toBe("安比·德玛拉<br>电属性　击破　斩击　狡兔屋")
  })

  it("绝区零的详情是副本 —— 着色改的是副本，装载器缓存的那一份不动", () => {
    const view = buildCharTalent(agentOf(), "talent")

    expect(view.detail).not.toBe(ZZZ_DETAIL)
    expect(view.detail).toEqual(ZZZ_DETAIL)
  })
})

describe("talentTitle", () => {
  it("三个游戏各一套叫法", () => {
    expect(talentTitle("gs", "talent")).toBe("天赋")
    expect(talentTitle("zzz", "talent")).toBe("技能")
    expect(talentTitle("gs", "cons")).toBe("命之座")
    expect(talentTitle("sr", "cons")).toBe("星魂")
    expect(talentTitle("zzz", "cons")).toBe("意象影画")
  })
})

describe("talentFrameOf", () => {
  it("原神按元素各取一张框", () => {
    expect(talentFrameOf("gs", "雷")).toBe("electro")
    expect(talentFrameOf("gs", "pyro")).toBe("pyro")
  })

  it("星铁借原神的框，虚数用岩、物理用专属那张", () => {
    expect(talentFrameOf("sr", "火")).toBe("pyro")
    expect(talentFrameOf("sr", "量子")).toBe("quantum")
    expect(talentFrameOf("sr", "虚数")).toBe("geo")
    expect(talentFrameOf("sr", "物理")).toBe("sr")
  })

  it("绝区零与认不出的元素不垫框", () => {
    expect(talentFrameOf("zzz", "电")).toBe("")
    expect(talentFrameOf("gs", "")).toBe("")
  })
})

describe("charTalentText", () => {
  /**
   * 造一份视图
   * @param mode 天赋还是命座
   * @param over 要盖掉的角色字段
   * @returns 视图
   */
  function viewOf(mode: "talent" | "cons", over: Partial<WikiCharInput> = {}): CharTalentView {
    return buildCharTalent(charOf(over), mode)
  }

  it("天赋模式列出天赋名", () => {
    const text = charTalentText(viewOf("talent"))

    expect(text).toContain("胡桃 天赋")
    expect(text).toContain("灭却之戒法")
    expect(text).toContain("蝶引来生")
  })

  it("命座模式按命座号列出", () => {
    const text = charTalentText(viewOf("cons"))

    expect(text).toContain("命之座")
    expect(text).toContain("1 命")
    expect(text).toContain("赤团开时斜飞去")
  })

  it("星铁的命座叫星魂", () => {
    expect(charTalentText(viewOf("cons", { game: "sr", detail: SR_DETAIL }))).toContain("星魂")
  })

  it("**不铺描述与数值表** —— 一个角色展开有两千字，群里发出来是一堵墙", () => {
    const text = charTalentText(viewOf("talent"))

    expect(text).not.toContain("进行至多五段的连续枪击")
    expect(text).toContain("出图才看得到")
  })

  it("元数据里没有这一段时给一句说明", () => {
    expect(charTalentText(viewOf("talent", { detail: {} }))).toContain("没有这个角色的详细数据")
  })

  it("绝区零的技能只列名字 —— 它的键是 `basic` 一类英文，印出来只是噪声", () => {
    const text = charTalentText(buildCharTalent(agentOf(), "talent"))

    expect(text).toContain("安比 技能")
    expect(text).toContain("普通攻击")
    expect(text).not.toContain("basic")
  })

  it("绝区零的影画按层数列出，量词是「影」", () => {
    const text = charTalentText(buildCharTalent(agentOf(), "cons"))

    expect(text).toContain("意象影画")
    expect(text).toContain("1 影")
    expect(text).toContain("快充模式")
  })
})
