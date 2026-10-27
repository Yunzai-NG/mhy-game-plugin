/**
 * 模块职责：角色图鉴与养成材料两页视图的测试
 * 依赖方向：测试文件，依赖 views/char-wiki
 * 生命周期：无状态
 * 注意事项：固定五处只在出图时才看得出的口径：介绍折行的两行上限、成长属性
 *          只在数值过长时才走千分位、旅行者不出 boss 材料格、**四星与开拓者走另一套份数且不能改到
 *          共享配置上**（就地改写模块级数组会让查过一个四星后所有五星都拿到四星的份数，且不报错）、
 *          第三方统计缺失时那四块整块不出现。
 */
import { describe, expect, it } from "vitest"
import type { MaterialItem } from "../meta/material.js"
import type { CharStatRaw, WikiCharInput, WikiDetail, WikiMaterialDeps } from "./char-wiki.js"
import {
  asWikiDetail,
  birthdayOf,
  buildCharMaterialPage,
  buildCharStat,
  buildCharWiki,
  charAttrList,
  charDesc,
  charMaterialText,
  charMaterials,
  charWikiText,
  descLines,
  srMaterials,
  treeSum,
  weaponTypeName
} from "./char-wiki.js"

/**
 * 造一个材料条目
 * @param name 全名
 * @param over 要盖掉的字段
 * @returns 条目
 */
function mat(name: string, over: Partial<MaterialItem> = {}): MaterialItem {
  return {
    name,
    type: "talent",
    poseType: "talent",
    star: 4,
    abbr: name,
    label: name,
    icon: `meta-gs/material/talent/${name}.webp`,
    source: "",
    ...over
  }
}

/** 一份够用的原神材料表 */
const GS_MATS: Record<string, MaterialItem> = {
  燃愿玛瑙: mat("燃愿玛瑙", { type: "gem", poseType: "gem" }),
  未熟之玉: mat("未熟之玉", { type: "boss", poseType: "boss" }),
  霓裳花: mat("霓裳花", { type: "specialty", poseType: "specialty" }),
  原素花蜜: mat("原素花蜜", { type: "normal", poseType: "normal" }),
  "「勤劳」的哲学": mat("「勤劳」的哲学", { abbr: "勤劳", label: "璃月·勤劳", source: "周二/周五" }),
  "魔王之刃·残片": mat("魔王之刃·残片", { type: "weekly", poseType: "weekly", label: "公子·残片" })
}

/** 一份够用的星铁材料表，键是材料 id */
const SR_BY_ID: Record<string, MaterialItem> = {
  "29328": mat("信用点", { type: "normal", poseType: "101", star: 3, label: "信用点" }),
  "67219": mat("风雪之角", { type: "char", poseType: "201", star: 4, label: "风雪之角" }),
  "110400": mat("深邃的星外质", { type: "char", poseType: "201", star: 5, label: "深邃的星外质" }),
  "635675": mat("此间寻梦", { type: "material", poseType: "301", star: 3, label: "此间寻梦" }),
  "985668": mat("毁灭者的末路", { type: "normal", poseType: "401", star: 4, label: "毁灭者的末路" }),
  "125435": mat("命运的足迹", { type: "material", poseType: "501", star: 5, label: "命运的足迹" }),
  "920202": mat("一曲合弦的幻景", { type: "char", poseType: "701", star: 4, label: "一曲合弦的幻景" })
}

/** 按名字反查星铁材料 */
const SR_BY_NAME: Record<string, MaterialItem> = Object.fromEntries(
  Object.values(SR_BY_ID).map(one => [one.name, one])
)

/** 原神那两条查材料的路 */
const gsDeps: WikiMaterialDeps = { byName: name => GS_MATS[name], byId: () => undefined }

/** 星铁那两条 */
const srDeps: WikiMaterialDeps = { byName: name => SR_BY_NAME[name], byId: id => SR_BY_ID[id] }

/** 一份原神角色详情 */
const GS_DETAIL: WikiDetail = {
  title: "雪霁梅香",
  allegiance: "往生堂",
  birth: "7-15",
  astro: "引蝶座",
  desc: "「往生堂」七十七代堂主，年纪轻轻就已主掌璃月的葬仪事务。",
  cncv: "陶典",
  jpcv: "高桥李依",
  baseAttr: { hp: 15552, atk: 106.4, def: 876 },
  growAttr: { key: "cdmg", value: 38.4 },
  materials: {
    gem: "燃愿玛瑙",
    boss: "未熟之玉",
    specialty: "霓裳花",
    normal: "原素花蜜",
    talent: "「勤劳」的哲学",
    weekly: "魔王之刃·残片"
  }
}

/** 一份星铁角色详情 */
const SR_DETAIL: WikiDetail = {
  allegiance: "星穹列车",
  desc: "星穹列车的随车工程师。",
  cncv: "陶典",
  jpcv: "伊瀬茉莉也",
  sp: 120,
  baseAttr: { atk: 756.756, hp: 1047.816, def: 436.59, speed: 96, cpct: 5 },
  tree: {
    "1003201": { key: "fire", value: 3.2 },
    "1003202": { key: "atk", value: 4 },
    "1003203": { key: "fire", value: 3.2 }
  },
  treeData: { "1003101": { type: "skill", cost: { "29328": 5000, "635675": 3, "985668": 1 } } },
  attr: { "6": { cost: { "67219": 5, "110400": 3, "125435": 1, "920202": 4 } } }
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
    imgs: { splash: "meta-gs/character/胡桃/imgs/splash.webp" },
    ...over
  }
}

describe("descLines", () => {
  it("短句原样拼回去", () => {
    expect(descLines(["甲乙丙", "丁戊"])).toBe("甲乙丙，丁戊")
  })

  it("长句折成两行", () => {
    const got = descLines(["一二三四五六七八九十一二三四五", "六七八九十一二三四五六七八九十"])

    expect(got.split("</br>")).toHaveLength(2)
  })

  it("只有两行，第三块起并进第二行 —— 第三行会压到立绘上", () => {
    const got = descLines(["一二三四五六七八九十一二三四五", "六七八九十", "一二三四五"])

    expect(got.split("</br>")).toHaveLength(2)
  })

  it("一块都塞不下时给空的两行而非抛错", () => {
    expect(() => descLines(["一".repeat(80)])).not.toThrow()
  })
})

describe("charDesc", () => {
  it("去掉句末的句号，句号与半角逗号统一成全角", () => {
    expect(charDesc("甲乙。丙,丁。")).toBe("甲乙，丙，丁")
  })

  it("破折号前补一个逗号", () => {
    expect(charDesc("甲乙——丙丁")).toBe("甲乙，——丙丁")
  })

  it("不到 25 字的原样返回，一个标签都不加", () => {
    expect(charDesc("「往生堂」七十七代堂主")).toBe("「往生堂」七十七代堂主")
  })

  it("长句折行", () => {
    expect(charDesc(GS_DETAIL.desc ?? "")).toContain("</br>")
  })

  it("空串不抛错", () => {
    expect(charDesc("")).toBe("")
  })

  it("只有半角连字符而没有破折号时走折行 —— 照断句处理会把整句切成一个字", () => {
    // 那条判据用 `/-/` 判、用 indexOf("—") 取位置，两者永不同时命中，命中时 indexOf 给 -1
    const got = charDesc(`甲-乙${"丙".repeat(30)}`)

    expect(got.length).toBeGreaterThan(5)
  })
})

describe("weaponTypeName", () => {
  it("原神按键取中文名，大小写不敏感", () => {
    expect(weaponTypeName("gs", "polearm")).toBe("长柄武器")
    expect(weaponTypeName("gs", "POLEARM")).toBe("长柄武器")
  })

  it("认不出的键给空串，模板据此回落到键本身", () => {
    expect(weaponTypeName("gs", "不存在")).toBe("")
    expect(weaponTypeName("gs", "")).toBe("")
  })

  it("星铁的命途本就是中文，原样返回", () => {
    expect(weaponTypeName("sr", "智识")).toBe("智识")
  })
})

describe("birthdayOf", () => {
  it("折成中文写法", () => {
    expect(birthdayOf("7-15")).toBe("7月15日")
  })

  it("没有或形态不对时给空串", () => {
    expect(birthdayOf()).toBe("")
    expect(birthdayOf("7")).toBe("")
  })
})

describe("charAttrList", () => {
  it("原神：三项基础属性按元数据自身的键序，末尾一项成长", () => {
    const got = charAttrList(charOf())

    expect(got.attr.map(one => one.title)).toEqual(["基础生命", "基础攻击", "基础防御", "成长·爆伤"])
    expect(got.attr[0]?.value).toBe("15,552.0")
    expect(got.growret).toEqual([])
  })

  it("成长值不长时原样显示，不走千分位 —— 38.4 写成 38.4 而不是 38.4 之外的样子", () => {
    expect(charAttrList(charOf()).attr[3]?.value).toBe("38.4")
  })

  it("成长值过长时才走千分位 —— 那一条挑的是精通（算出来是 115.19999999999999）", () => {
    const detail: WikiDetail = { ...GS_DETAIL, growAttr: { key: "mastery", value: 115.19999999999999 } }
    const got = charAttrList(charOf({ detail }))

    expect(got.attr[3]).toEqual({ title: "成长·精通", value: "115.2" })
  })

  it("成长键是 dmg 时标题用元素名 —— 元素键要折成中文", () => {
    const detail: WikiDetail = { ...GS_DETAIL, growAttr: { key: "dmg", value: 28.8 } }

    expect(charAttrList(charOf({ detail })).attr[3]?.title).toBe("成长·火伤")
  })

  it("星铁：基础属性只收表里那四项，cpct 一类不显示", () => {
    const got = charAttrList(charOf({ game: "sr", detail: SR_DETAIL, elem: "火" }))

    expect(got.attr.map(one => one.title)).toEqual(["基础攻击", "基础生命", "基础防御", "基础速度"])
  })

  it("星铁的成长来自行迹表，同一个键要先累加", () => {
    const got = charAttrList(charOf({ game: "sr", detail: SR_DETAIL, elem: "火" }))

    expect(got.growret).toEqual([
      { title: "火伤", value: "6.4" },
      { title: "大攻击", value: "4.0" }
    ])
  })

  it("没有基础属性时给两个空数组而非抛错", () => {
    expect(charAttrList(charOf({ detail: {} })).attr).toEqual([])
  })
})

describe("treeSum", () => {
  it("同键累加，键序即行迹表的键序", () => {
    expect(treeSum(SR_DETAIL.tree)).toEqual({ fire: 6.4, atk: 4 })
  })

  it("没有行迹表时给空对象", () => {
    expect(treeSum(undefined)).toEqual({})
  })

  it("缺 key 的节点跳过", () => {
    expect(treeSum({ a: { value: 5 }, b: { key: "atk", value: 1 } })).toEqual({ atk: 1 })
  })
})

describe("charMaterials 原神", () => {
  it("六格按固定次序，份数是写死的展示文本", () => {
    const got = charMaterials(charOf(), gsDeps)

    // 六格的固定次序：gem / boss / normal / specialty / talent / weekly
    expect(got.map(one => one.label)).toEqual(["燃愿玛瑙", "未熟之玉", "原素花蜜", "霓裳花", "璃月·勤劳", "公子·残片"])
    expect(got.map(one => one.num)).toEqual(["1/9/9/6", "46", "18/30/36", "168", "周二/周五", ""])
  })

  it("天赋书那一格显示可刷日而非份数 —— 那一格问的是「什么时候能刷」", () => {
    expect(charMaterials(charOf(), gsDeps)[4]?.num).toBe("周二/周五")
  })

  it("旅行者不出 boss 那一格", () => {
    const got = charMaterials(charOf({ isMain: true }), gsDeps)

    expect(got.map(one => one.label)).not.toContain("未熟之玉")
    expect(got).toHaveLength(5)
  })

  it("材料表里查不到的整格不出，而不是画一个空框", () => {
    const got = charMaterials(charOf(), { byName: name => (name === "霓裳花" ? undefined : GS_MATS[name]), byId: () => undefined })

    expect(got.map(one => one.label)).not.toContain("霓裳花")
  })

  it("角色没有 materials 一栏时给空数组", () => {
    expect(charMaterials(charOf({ detail: {} }), gsDeps)).toEqual([])
  })
})

describe("charMaterials 绝区零", () => {
  /** 一份绝区零代理人详情：四类材料只给名字 */
  const zzzDetail: WikiDetail = {
    materials: { promote: "统御者认证章", skill: "特化电击芯片", special: "「仓鼠笼」访问器", boss: "终幕舞鞋" }
  }
  /** 材料表：内部星级 3（A）与 4（S），出图应各 +1 档 */
  const zzzMats: Record<string, MaterialItem> = {
    统御者认证章: mat("统御者认证章", { type: "promote", poseType: "promote", star: 3, label: "统御者认证章" }),
    特化电击芯片: mat("特化电击芯片", { type: "skill", poseType: "skill", star: 3, label: "特化电击芯片" }),
    "「仓鼠笼」访问器": mat("「仓鼠笼」访问器", { type: "special", poseType: "special", star: 4, label: "「仓鼠笼」访问器" }),
    终幕舞鞋: mat("终幕舞鞋", { type: "boss", poseType: "boss", star: 4, label: "终幕舞鞋" })
  }
  const zzzDeps: WikiMaterialDeps = { byName: name => zzzMats[name], byId: () => undefined }
  const zzzInput = charOf({ game: "zzz", elem: "电", star: 4, detail: zzzDetail })

  it("四格按固定次序，表头是两字类别名", () => {
    const got = charMaterials(zzzInput, zzzDeps)

    expect(got.map(one => one.label)).toEqual(["统御者认证章", "特化电击芯片", "「仓鼠笼」访问器", "终幕舞鞋"])
    // 两字而非四字：四字会把那一格撑宽、四张卡与表头错位
    expect(got.map(one => one.num)).toEqual(["晋升", "技能", "专业", "专精"])
  })

  it("出图档位取材料表星级 +1 —— 内部 4（S）→ 5 档金框、3（A）→ 4 档紫框，直接用会把 S 材料画成紫框", () => {
    expect(charMaterials(zzzInput, zzzDeps).map(one => one.star)).toEqual([4, 4, 5, 5])
  })

  it("材料表未装或该材料比包新（查不到）时仍画出：按名拼路径 + S 档金框", () => {
    const got = charMaterials(zzzInput, { byName: () => undefined, byId: () => undefined })

    expect(got).toHaveLength(4)
    expect(got.every(one => one.star === 5)).toBe(true)
    expect(got[0]?.icon).toBe("meta-zzz/material/promote/统御者认证章.webp")
  })

  it("代理人没有 materials 一栏时给空数组", () => {
    expect(charMaterials(charOf({ game: "zzz", detail: {} }), zzzDeps)).toEqual([])
  })
})

describe("srMaterials", () => {
  it("从 treeData 与 attr 两处收 id，同一位次留星级最高的那个", () => {
    // 201 位次上有四星「风雪之角」与五星「深邃的星外质」，该留后者
    expect(srMaterials(SR_DETAIL, srDeps.byId)).toEqual({
      "101": "信用点",
      "201": "深邃的星外质",
      "301": "此间寻梦",
      "401": "毁灭者的末路",
      "501": "命运的足迹",
      "701": "一曲合弦的幻景"
    })
  })

  it("只看 attr 也能收 —— 光锥就只有这一处", () => {
    expect(srMaterials({ attr: { "6": { cost: { "67219": 1 } } } }, srDeps.byId)).toEqual({ "201": "风雪之角" })
  })

  it("查不到的 id 跳过", () => {
    expect(srMaterials({ attr: { "6": { cost: { "999": 1 } } } }, srDeps.byId)).toEqual({})
  })

  it("两处都没有时给空对象", () => {
    expect(srMaterials({}, srDeps.byId)).toEqual({})
  })
})

describe("charMaterials 星铁", () => {
  const five = charOf({ game: "sr", star: 5, weapon: "智识", elem: "火", detail: SR_DETAIL })

  it("五星走正常份数", () => {
    const got = charMaterials(five, srDeps)

    // 六格的固定次序：101 / 201 / 701 / 501 / 401 / 301
    expect(got.map(one => one.label)).toEqual([
      "信用点",
      "深邃的星外质",
      "一曲合弦的幻景",
      "命运的足迹",
      "毁灭者的末路",
      "此间寻梦"
    ])
    expect(got.map(one => one.num)).toEqual(["388.8w", "65", "56/71/73", "8", "12", "18/69/139"])
  })

  it("四星走另一套份数", () => {
    const got = charMaterials({ ...five, star: 4 }, srDeps)

    expect(got.map(one => one.num)).toEqual(["322.64w", "28", "40/55/54", "5", "12", "12/54/105"])
  })

  it("开拓者与四星同档", () => {
    expect(charMaterials({ ...five, isMain: true }, srDeps)[0]?.num).toBe("322.64w")
  })

  it("记忆命途的那两项另一组数", () => {
    const got = charMaterials({ ...five, star: 4, weapon: "记忆" }, srDeps).map(one => one.num)

    expect(got[2]).toBe("40/52/55")
    expect(got[5]).toBe("9/53/105")
  })

  it("查过四星之后五星仍拿到五星的份数 —— 份数表是模块级共享的，写坏它会静默串档", () => {
    charMaterials({ ...five, star: 4 }, srDeps)

    expect(charMaterials(five, srDeps)[0]?.num).toBe("388.8w")
  })
})

/** 一份第三方统计的响应 */
const STAT: CharStatRaw = {
  role: "胡桃",
  avg_class: "2.34",
  c0: 45.6,
  c1: 20.1,
  c2: 12,
  c3: 8,
  c4: 6,
  c5: 4,
  c6: 4.3,
  weapon: [{ name: "护摩之杖", rate: 62.1 }, { name: "不在表里的武器", rate: 5 }],
  artifacts_set: [
    { name: "焦土之誓的余威4", rate: 71.2 },
    { name: "乐团2+翠绿2", rate: 12.4 },
    { name: "暂无套装", rate: 3.1 }
  ]
}

/** 造统计要用的两张假表 */
const statDeps = {
  weapon: (name: string) =>
    name === "护摩之杖"
      ? { name: "护摩之杖", abbr: "护摩", star: 5, icon: "meta-gs/weapon/polearm/护摩之杖/icon.webp" }
      : undefined,
  artiSet: (name: string) =>
    ({
      焦土之誓的余威: { abbr: "焦土", img: "meta-gs/artifact/imgs/焦土之誓的余威/1.webp" },
      乐团: { abbr: "乐团", img: "meta-gs/artifact/imgs/流浪大地的乐团/1.webp" },
      翠绿: { abbr: "风套", img: "meta-gs/artifact/imgs/翠绿之影/1.webp" }
    })[name]
}

describe("buildCharStat", () => {
  it("没有 role 字段即视为没查到 —— 统计站对未实装角色会给一份空壳", () => {
    expect(buildCharStat({ avg_class: "1" }, statDeps)).toBeUndefined()
    expect(buildCharStat(undefined, statDeps)).toBeUndefined()
  })

  it("七个命座的持有率都带百分号，缺的那档补 0", () => {
    const got = buildCharStat({ role: "甲", c0: 50 }, statDeps)

    expect(got?.holding["0"]).toBe("50%")
    expect(got?.holding["6"]).toBe("0%")
    expect(Object.keys(got?.holding ?? {})).toHaveLength(7)
  })

  it("武器查得到就用本地的简称与图，查不到则用接口给的名字", () => {
    const got = buildCharStat(STAT, statDeps)

    expect(got?.usage.weapons[0]).toEqual({
      name: "护摩之杖",
      abbr: "护摩",
      img: "meta-gs/weapon/polearm/护摩之杖/icon.webp",
      star: 5,
      value: "62.1%"
    })
    expect(got?.usage.weapons[1]).toMatchObject({ name: "不在表里的武器", abbr: "不在表里的武器", img: "", star: 0 })
  })

  it("单套时件数写进标题，两套各两件时不写 —— 那时件数是废话", () => {
    const got = buildCharStat(STAT, statDeps)

    expect(got?.usage.artis[0]?.title).toBe("焦土4")
    expect(got?.usage.artis[1]?.title).toBe("乐团+风套")
  })

  it("两套的那一组带两张图", () => {
    expect(buildCharStat(STAT, statDeps)?.usage.artis[1]?.imgs).toHaveLength(2)
  })

  it("「暂无套装」用本插件自带的通用图 —— 它不以 meta- 开头，模板据此换根目录", () => {
    const got = buildCharStat(STAT, statDeps)?.usage.artis[2]

    expect(got?.title).toBe("其他")
    expect(got?.imgs[0]).toBe("common/item/artifact-icon.webp")
  })

  it("认不出的套装名整段丢掉", () => {
    const got = buildCharStat({ role: "甲", artifacts_set: [{ name: "没有的套装4", rate: 1 }] }, statDeps)

    expect(got?.usage.artis[0]).toEqual({ imgs: [], title: "", value: "1%" })
  })
})

describe("buildCharWiki", () => {
  it("基本信息一栏齐全", () => {
    const view = buildCharWiki(charOf(), gsDeps)

    expect(view.data).toMatchObject({
      name: "胡桃",
      title: "雪霁梅香",
      star: 5,
      weaponTypeName: "长柄武器",
      astro: "引蝶座",
      birthday: "7月15日",
      allegiance: "往生堂",
      cncv: "陶典"
    })
  })

  it("不传统计时那四块整块不出现 —— 模板的 {{if num}} 据此整段跳过", () => {
    const view = buildCharWiki(charOf(), gsDeps)

    expect(view.num).toBeUndefined()
    expect(view.holding).toBeUndefined()
    expect(view.usage).toBeUndefined()
  })

  it("传了统计时三项都在", () => {
    const stat = buildCharStat(STAT, statDeps)
    const view = buildCharWiki(charOf(), gsDeps, stat)

    expect(view.num).toBe("2.34")
    expect(view.holding?.["0"]).toBe("45.6%")
    expect(view.usage?.weapons).toHaveLength(2)
  })

  it("星铁的满行迹加成单列一组", () => {
    const view = buildCharWiki(charOf({ game: "sr", detail: SR_DETAIL, elem: "火", weapon: "智识" }), srDeps)

    expect(view.attr.growret.length).toBeGreaterThan(0)
    expect(view.data.weaponTypeName).toBe("智识")
  })

  it("绝区零按稀有度显示星级 —— S 级代理人是 5 星、A 级是 4 星，直接用元数据的内部 star（S=4）会写成 4 星", () => {
    const zzz = (rank: string): WikiCharInput =>
      charOf({ game: "zzz", elem: "冰", star: 4, detail: { rank } as never })

    expect(buildCharWiki(zzz("S"), gsDeps).data.star).toBe(5)
    expect(buildCharWiki(zzz("A"), gsDeps).data.star).toBe(4)
  })
})

describe("buildCharMaterialPage", () => {
  it("属性一栏摊平成一维 —— 该模板的 each 直接遍历它，传对象会让那一栏是空的", () => {
    const view = buildCharMaterialPage(charOf(), gsDeps)

    expect(Array.isArray(view.attr)).toBe(true)
    expect(view.attr.map(one => one.title)).toContain("基础生命")
  })

  it("星铁的行迹加成也在同一维里", () => {
    const view = buildCharMaterialPage(charOf({ game: "sr", detail: SR_DETAIL, elem: "火" }), srDeps)

    expect(view.attr.map(one => one.title)).toContain("大攻击")
  })
})

describe("asWikiDetail", () => {
  it("原样收下对象", () => {
    expect(asWikiDetail({ title: "甲" }).title).toBe("甲")
  })

  it("null 与非对象都收成空表 —— 元数据缺失时不该让每个取值处各判一次", () => {
    expect(asWikiDetail(null)).toEqual({})
    expect(asWikiDetail(undefined)).toEqual({})
    expect(asWikiDetail("字符串")).toEqual({})
  })
})

describe("charWikiText", () => {
  it("带上名字、CV、属性与材料", () => {
    const text = charWikiText(buildCharWiki(charOf(), gsDeps))

    expect(text).toContain("雪霁梅香·胡桃")
    expect(text).toContain("中文CV")
    expect(text).toContain("基础生命")
    expect(text).toContain("璃月·勤劳")
    expect(text).toContain("#胡桃天赋")
  })

  it("介绍里的折行标签换成换行 —— 直接输出会露出标签", () => {
    expect(charWikiText(buildCharWiki(charOf(), gsDeps))).not.toContain("</br>")
  })

  it("有统计时把那四块也写出来", () => {
    const text = charWikiText(buildCharWiki(charOf(), gsDeps, buildCharStat(STAT, statDeps)))

    expect(text).toContain("平均命座")
    expect(text).toContain("常用武器")
    expect(text).toContain("常用圣遗物")
  })

  it("星铁的两个词换成光锥与遗器", () => {
    const view = buildCharWiki(charOf({ game: "sr", detail: SR_DETAIL, elem: "火" }), srDeps, buildCharStat(STAT, statDeps))

    expect(charWikiText(view)).toContain("常用光锥")
    expect(charWikiText(view)).toContain("常用遗器")
  })
})

describe("charMaterialText", () => {
  it("一件材料一行", () => {
    const text = charMaterialText(buildCharMaterialPage(charOf(), gsDeps))

    expect(text).toContain("胡桃 养成材料")
    expect(text).toContain("燃愿玛瑙")
  })

  it("一件都没有时给一句说明而非空白", () => {
    const view = buildCharMaterialPage(charOf({ detail: { ...GS_DETAIL, materials: {} } }), gsDeps)

    expect(charMaterialText(view)).toContain("暂无材料数据")
  })
})
