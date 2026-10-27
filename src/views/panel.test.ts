/**
 * 模块职责：面板视图层的测试
 * 依赖方向：测试文件，只依赖 views/panel.ts 的纯函数
 * 生命周期：无状态
 * 注意事项：固定三件"改了不报错但显示会错"的事：`comma` 的整数也补小数位（一位小数下 33 得
 *          `33.0`）、百分比项的负值一律显示为 0（不该出现"伤害加成 -3.0%"）、列表排序是稳定
 *          升序后反转（与直接降序在并列项上的次序不同）。
 */
import { afterEach, describe, expect, it } from "vitest"
import type { BuiltArti, BuiltPanel } from "../panel/build.js"
import {
  artisKeyTitles,
  artisListData,
  artiImg,
  artiSetImg,
  charImgs,
  comma,
  configureFaceStyle,
  formatAttr,
  formatAttrValue,
  panelListText,
  panelStatData,
  panelStatText,
  panelText,
  pct,
  profileDetailData,
  profileListData,
  rankListData,
  sumAttrs,
  timeText
} from "./panel.js"

/**
 * 造一件圣遗物
 * @param over 要覆盖的字段
 * @returns 圣遗物
 */
function arti(over: Partial<BuiltArti> = {}): BuiltArti {
  return {
    idx: 1,
    name: "追忆的形骸",
    set: "追忆之注连",
    level: 20,
    star: 5,
    main: { id: "10001", key: "hpPlus", value: 4780 },
    attrs: [{ key: "cpct", upNum: 3, eff: 2.4, value: 10.5 }],
    ...over
  }
}

/**
 * 造一份装好的面板
 * @param over 要覆盖的字段
 * @returns 面板
 */
/** 评分页里一件圣遗物的视图，只取测试要的几项 */
interface ArtiViewLike {
  main?: { mark: number }
  attrs: { _mark: number }[]
}

function panel(over: Partial<BuiltPanel> = {}): BuiltPanel {
  return {
    game: "gs",
    uid: "100000001",
    id: "10000046",
    name: "胡桃",
    abbr: "胡桃",
    star: 5,
    elem: "pyro",
    level: 90,
    promote: 6,
    cons: 2,
    fetter: 10,
    costume: 0,
    talent: { a: 9, e: 9, q: 9 },
    talentLevel: over.talent ?? { a: 9, e: 9, q: 9 },
    trees: [],
    source: "Enka.Network",
    artis: [arti()],
    sets: { 追忆之注连: 1 },
    attr: { hp: 15552, atk: 1200, def: 876, mastery: 108, cpct: 68.5, cdmg: 120.4, recharge: 132, dmg: 46.6, phy: 0 } as unknown as BuiltPanel["attr"],
    base: { hp: 15552, atk: 800, def: 876, mastery: 0, cpct: 5, cdmg: 50, recharge: 100, dmg: 0, phy: 0 },
    imgs: {},
    ...over
  }
}

describe("comma", () => {
  it("整数也补足小数位", () => {
    expect(comma(33, 1)).toBe("33.0")
    expect(comma(33, 0)).toBe("33")
  })

  it("整数部分插千分位", () => {
    expect(comma(1234567, 0)).toBe("1,234,567")
    expect(comma(15552.4, 0)).toBe("15,552")
  })

  it("脏值一律当 0，不产出 NaN", () => {
    expect(comma(Number.NaN, 1)).toBe("0")
    expect(comma(Number.POSITIVE_INFINITY, 0)).toBe("0")
  })
})

describe("pct", () => {
  it("带百分号，缺省一位小数", () => {
    expect(pct(46.6)).toBe("46.6%")
    expect(pct(0)).toBe("0.0%")
  })
})

describe("formatAttr", () => {
  it("每项产出当前值、白值与加成值三个键", () => {
    const got = formatAttr(panel().attr as Record<string, unknown>, panel().base, "gs")

    expect(got["atk"]).toBe("1,200.0")
    expect(got["atkBase"]).toBe("800.0")
    expect(got["atkPlus"]).toBe("400.0")
  })

  it("生命值不留小数，其余主属性留一位", () => {
    const got = formatAttr(panel().attr as Record<string, unknown>, panel().base, "gs")

    expect(got["hp"]).toBe("15,552")
    expect(got["def"]).toBe("876.0")
  })

  it("百分比项的负值显示为 0 —— 面板上不该出现负的加成", () => {
    const got = formatAttr({ cpct: -3 }, { cpct: 5 }, "gs")

    expect(got["cpct"]).toBe("0.0%")
    expect(got["cpctPlus"]).toBe("0.0%")
  })

  it("原神在物伤高于元素伤时，伤害加成那一栏改取物伤", () => {
    const attr = { ...(panel().attr as Record<string, unknown>), dmg: 10, phy: 80 }
    const got = formatAttr(attr, panel().base, "gs")

    expect(got["dmg"]).toBe("80.0%")
  })

  it("星铁没有物伤这一支，dmg 恒取 dmg", () => {
    const got = formatAttr({ dmg: 10, phy: 80 }, {}, "sr")

    expect(got["dmg"]).toBe("10.0%")
  })

  it("星铁的属性项与原神不同 —— 有速度与效果命中，没有精通", () => {
    const got = formatAttr({ speed: 102.3, effPct: 40 }, { speed: 94 }, "sr")

    expect(got["speed"]).toBe("102.3")
    expect(got["effPct"]).toBe("40.0%")
    expect(got["mastery"]).toBeUndefined()
  })

  it("逐项是三分量盒子时按白值 + 加成值 + 白值×百分比折算", () => {
    /*
     * 伤害模式下属性栏展示的那份属性来自伤害层，逐项是 `{base, plus, pct}` 而非数值 ——
     * 只认数值的表现是**整栏属性全为 0**，且加成列显示成"加负的白值"（`+-2,561`）。
     * 折算规则与伤害层一致。
     */
    const got = formatAttr(
      { atk: { base: 1053.1, plus: 733.1, pct: 15 }, speed: { base: 137, plus: 0, pct: 12 }, dmg: { base: 0, plus: 10, pct: 0 } },
      { atk: 1053.1, speed: 101 },
      "sr"
    )

    expect(got["atk"]).toBe("1,944.2")
    expect(got["atkPlus"]).toBe("891.1")
    expect(got["speed"]).toBe("153.4")
    expect(got["dmg"]).toBe("10.0%")
  })

  it("盒子里缺分量时按零算，不出 NaN", () => {
    const got = formatAttr({ hp: { base: 2561 }, cdmg: {} }, { hp: 2561 }, "sr")

    expect(got["hp"]).toBe("2,561")
    expect(got["cdmg"]).toBe("0.0%")
  })
})

describe("charImgs", () => {
  it("原神的图指向 meta-gs 下的角色目录", () => {
    const got = charImgs({ game: "gs", name: "胡桃" })

    expect(got["face"]).toBe("meta-gs/character/胡桃/imgs/face.webp")
    expect(got["splash"]).toBe("meta-gs/character/胡桃/imgs/splash.webp")
  })

  it("时装为 2 时取 splash2 那一套", () => {
    const got = charImgs({ game: "gs", name: "琴", costume: 2 })

    expect(got["splash"]).toBe("meta-gs/character/琴/imgs/splash2.webp")
    expect(got["face"]).toBe("meta-gs/character/琴/imgs/face2.webp")
  })

  it("原神的天赋图标按命座折算 —— 有命座提升该天赋时用那个命座的图", () => {
    const got = charImgs({ game: "gs", name: "钟离", talentCons: { e: 3 } })

    expect(got["e"]).toBe(got["cons3"])
    expect(got["q"]).toBe("meta-gs/character/钟离/icons/talent-q.webp")
  })

  it("旅行者的命座与天赋图按元素分目录", () => {
    const got = charImgs({ game: "gs", name: "空", travelerElem: "anemo" })

    expect(got["cons1"]).toBe("meta-gs/character/旅行者/anemo/icons/cons-1.webp")
    // 立绘仍在角色自己的目录下
    expect(got["splash"]).toBe("meta-gs/character/空/imgs/splash.webp")
  })

  it("普攻图标按武器类型取，且它在插件自带资源里", () => {
    expect(charImgs({ game: "gs", name: "胡桃", weaponType: "polearm" })["a"]).toBe("gs/atk/atk-polearm.webp")
  })

  it("星铁缺独立变体图时回落同一个基础技能，已存在的变体保留", () => {
    const base = "meta-sr/character/三月七/imgs/"
    const imgs = charImgs({ game: "sr", name: "三月七", exists: rel => rel === `${base}talent-q2.webp` })
    expect(imgs["e2"]).toBe(`${base}talent-e.webp`)
    expect(imgs["q2"]).toBe(`${base}talent-q2.webp`)
    expect(imgs["as1"]).toBe(`${base}talent-as.webp`)
  })

  it("命座技能图缺失时退到同技能的独立图，不能回落成另一个技能", () => {
    const base = "meta-gs/character/角色/icons/"
    const imgs = charImgs({ game: "gs", name: "角色", talentCons: { e: 3 }, exists: rel => rel === `${base}talent-e.webp` })
    expect(imgs["e"]).toBe(`${base}talent-e.webp`)
  })

  it("星铁有行迹图与更多天赋键", () => {
    const got = charImgs({ game: "sr", name: "丹恒" })

    expect(got["tree1"]).toBe("meta-sr/character/丹恒/imgs/tree-1.webp")
    expect(got["t"]).toBe("meta-sr/character/丹恒/imgs/talent-t.webp")
  })

  it("星铁三命五命的图取它提升的那个天赋的图", () => {
    // 星铁的 talentCons 混着两种键形，真实数据形如 {"3":"e","5":"q",a:3,e:3,q:5,t:5}
    const got = charImgs({ game: "sr", name: "丹恒", talentCons: { "3": "e", "5": "q", a: 3, e: 3, q: 5, t: 5 } })

    expect(got["cons3"]).toBe(got["e"])
    expect(got["cons5"]).toBe(got["q"])
  })
})

describe("charImgs 的头像风格", () => {
  // 每个用例自己装一次取值函数，用完还原成缺省 —— 那是模块级状态，
  // 不还原会让后面的用例读到上一个用例设的值
  afterEach(() => configureFaceStyle(() => "b"))

  /**
   * 造一个"只有这些文件存在"的判据
   * @param have 存在的路径
   * @returns 存在性判据
   */
  const only = (...have: string[]): ((rel: string) => boolean) => {
    const set = new Set(have)
    return (rel: string): boolean => set.has(rel)
  }

  it("缺省这一档先要表情包，其次 Q 版", () => {
    const base = "meta-gs/character/胡桃/imgs/"
    expect(charImgs({ game: "gs", name: "胡桃", exists: only(`${base}face-b.png`, `${base}face-q.webp`) })["qFace"]).toBe(
      `${base}face-b.png`
    )
    // 没有表情包时退到 Q 版
    expect(charImgs({ game: "gs", name: "胡桃", exists: only(`${base}face-q.webp`) })["qFace"]).toBe(`${base}face-q.webp`)
    // 两者都没有时退到原始头像 —— 那一张每个角色都有，故不判存在性
    expect(charImgs({ game: "gs", name: "胡桃", exists: only() })["qFace"]).toBe(`${base}face.webp`)
  })

  it("自定义这一档在 face-z 之后仍会退到表情包与 Q 版", () => {
    configureFaceStyle(() => "z")
    const base = "meta-sr/character/丹恒/imgs/"

    expect(charImgs({ game: "sr", name: "丹恒", exists: only(`${base}face-z.png`) })["qFace"]).toBe(`${base}face-z.png`)
    expect(charImgs({ game: "sr", name: "丹恒", exists: only(`${base}face-b.png`) })["qFace"]).toBe(`${base}face-b.png`)
    expect(charImgs({ game: "sr", name: "丹恒", exists: only(`${base}face-q.webp`) })["qFace"]).toBe(`${base}face-q.webp`)
  })

  it("Q 版这一档不看表情包", () => {
    configureFaceStyle(() => "q")
    const base = "meta-gs/character/胡桃/imgs/"

    // face-b 在也不用它：选了这一档就是不要表情包
    expect(charImgs({ game: "gs", name: "胡桃", exists: only(`${base}face-b.png`) })["qFace"]).toBe(`${base}face.webp`)
    expect(charImgs({ game: "gs", name: "胡桃", exists: only(`${base}face-q.webp`) })["qFace"]).toBe(`${base}face-q.webp`)
  })

  it("原始这一档一律用 face，一个变体都不看", () => {
    configureFaceStyle(() => "base")
    const base = "meta-gs/character/胡桃/imgs/"

    expect(
      charImgs({
        game: "gs",
        name: "胡桃",
        exists: only(`${base}face-z.png`, `${base}face-b.png`, `${base}face-q.webp`)
      })["qFace"]
    ).toBe(`${base}face.webp`)
  })

  it("认不出的取值按缺省那一档处理，而不是一档都不取", () => {
    // 配置项是枚举，理应取不到别的值；但取值函数是外部装进来的，
    // 认不出时退回缺省好过让每个角色的小头像都变成原始头像
    configureFaceStyle(() => "不存在的档")
    const base = "meta-gs/character/胡桃/imgs/"

    expect(charImgs({ game: "gs", name: "胡桃", exists: only(`${base}face-b.png`) })["qFace"]).toBe(`${base}face-b.png`)
  })
})

describe("artiImg", () => {
  it("两个游戏各自的目录形态 —— 原神多一层 imgs/，星铁的文件名带 arti- 前缀", () => {
    // 两处易拼错：原神中间那层 `imgs/`、星铁的 `arti-` 前缀。
    // 两者都不报错，只是面板上每一格圣遗物图都空白
    expect(artiImg("gs", arti())).toBe("meta-gs/artifact/imgs/追忆之注连/1.webp")
    expect(artiImg("sr", arti({ set: "过客", idx: 3 }))).toBe("meta-sr/artifact/过客/arti-3.webp")
  })

  it("没有套装名时给空串，让浏览器显示空白而非拼出一个错地址", () => {
    expect(artiImg("gs", arti({ set: "" }))).toBe("")
  })
})

describe("artiSetImg", () => {
  it("按套装名取图，与 artiImg 同一套拼法 —— 图鉴里只知道套装名", () => {
    expect(artiSetImg("gs", "深林的记忆", 1)).toBe("meta-gs/artifact/imgs/深林的记忆/1.webp")
    expect(artiSetImg("sr", "不老者的仙舟", 5)).toBe("meta-sr/artifact/不老者的仙舟/arti-5.webp")
  })

  it("套装名为空时给空串", () => {
    expect(artiSetImg("gs", "", 1)).toBe("")
  })
})

describe("formatAttrValue", () => {
  it("小词条与速度是点数，其余按百分比", () => {
    expect(formatAttrValue("hpPlus", 4780)).toBe("4,780")
    expect(formatAttrValue("speed", 12.3)).toBe("12.3")
    expect(formatAttrValue("cpct", 10.5)).toBe("10.5%")
  })
})

describe("profileListData", () => {
  it("排序是变 → 取到未变 → 未取到三块，块内按 id 数值升序", () => {
    const list = ["10000046", "1005", "10000030", "10000025", "10000002"].map(id => panel({ id, name: id }))
    const got = profileListData(list, {
      uid: "100000001",
      game: "gs",
      fresh: ["10000046", "10000030", "10000025"],
      changed: ["10000046"]
    })
    const chars = got["chars"] as { id: string; state: string }[]

    // 按字符串比则「1005」会排到「10000002」之后
    expect(chars.map(it => it.id)).toEqual(["10000046", "10000025", "10000030", "1005", "10000002"])
    expect(chars.map(it => it.state)).toEqual(["chg", "new", "new", "", ""])
  })

  it("没有新角色时 hasNew 为假 —— 模板据此决定画不画那条图例", () => {
    const got = profileListData([panel()], { uid: "100000001", game: "gs" })

    expect(got["hasNew"]).toBe(false)
  })

  it("带上服务名与更新时间，模板底部那一行要用", () => {
    const got = profileListData([panel()], {
      uid: "100000001",
      game: "gs",
      servName: "Enka.Network",
      at: new Date("2026-08-30T14:05:00").getTime()
    })

    expect(got["servName"]).toBe("Enka.Network")
    expect((got["updateTime"] as { profile?: string }).profile).toBe("08-30 14:05")
  })

  it("**不给 rank 就不画排名那一段** —— 私聊里没有排行", () => {
    const got = profileListData([panel()], { uid: "100000001", game: "gs" })

    expect(got["groupRank"]).toBe(false)
    expect(got["allowRank"]).toBe(false)
  })

  it("给了 rank 则逐角色带回名次，模板按它在角色格上画角标", () => {
    const got = profileListData([panel()], {
      uid: "100000001",
      game: "gs",
      rank: {
        allow: true,
        cfg: { limitTxt: "无限制", time: "10-10 22:00", number: 15 },
        ranks: { "10000046": { rank: 2, rankType: "mark" } }
      }
    })

    expect(got["groupRank"]).toBe(true)
    expect(got["allowRank"]).toBe(true)
    const chars = got["chars"] as { id: string; groupRank?: { rank: number; rankType: string } }[]
    expect(chars[0]?.groupRank).toEqual({ rank: 2, rankType: "mark" })
  })

  it("没上榜的角色不带 groupRank —— 模板那一支按它判，给个 0 会画出一枚「第 0 名」", () => {
    const got = profileListData([panel()], {
      uid: "100000001",
      game: "gs",
      rank: { allow: false, cfg: { limitTxt: "绑定有CK的用户", time: "", number: 15 }, ranks: {} }
    })

    const chars = got["chars"] as { groupRank?: unknown }[]
    expect(chars[0]?.groupRank).toBeUndefined()
    // 无资格时模板改印参与要求，故这一项要传得到
    expect((got["rankCfg"] as { limitTxt: string }).limitTxt).toBe("绑定有CK的用户")
  })
})

describe("profileDetailData", () => {
  it("产出模板要的顶层键", () => {
    const got = profileDetailData(panel())

    expect(got["game"]).toBe("gs")
    expect(got["uid"]).toBe("100000001")
    expect(got["bodyClass"]).toBe("char-胡桃")
    expect((got["data"] as { name?: string }).name).toBe("胡桃")
  })

  it("伤害模式下属性栏用折算过 buff 的那份 —— 由调用方显式传入，不藏在模板里", () => {
    const plain = profileDetailData(panel())
    const withDmg = profileDetailData(panel(), {
      mode: "dmg",
      dmgAttr: { ...(panel().attr as Record<string, unknown>), atk: 2400 }
    })

    expect((plain["attr"] as Record<string, string>)["atk"]).toBe("1,200.0")
    expect((withDmg["attr"] as Record<string, string>)["atk"]).toBe("2,400.0")
  })

  it("词条汇总固定补到九格 —— 不足时模板边框会错位", () => {
    const detail = profileDetailData(panel())
    const allAttr = (detail["artisDetail"] as { allAttr: unknown[] }).allAttr

    expect(allAttr).toHaveLength(9)
  })

  it("天赋图标按面板带的 talentCons 折算 —— 原神多数角色没有 talent-e 那张图", () => {
    /*
     * 123 个原神角色里只有 6 个在元数据里有 `icons/talent-e.webp`，战技与爆发的图标取的是
     * 提升该天赋的那个命座的图。不把 `talentCons` 传进 `charImgs` 就意味着两格恒指向 404，
     * 而那不报错、只是那两格空白。
     */
    const plain = profileDetailData(panel())
    const withCons = profileDetailData(panel({ talentCons: { a: 0, e: 5, q: 3 } }))
    const imgsOf = (one: Record<string, unknown>): Record<string, string> =>
      (one["data"] as { imgs: Record<string, string> }).imgs

    expect(imgsOf(plain)["e"]).toBe("meta-gs/character/胡桃/icons/talent-e.webp")
    expect(imgsOf(withCons)["e"]).toBe("meta-gs/character/胡桃/icons/cons-5.webp")
    expect(imgsOf(withCons)["q"]).toBe("meta-gs/character/胡桃/icons/cons-3.webp")
  })

  it("主角面板与圣遗物评分页都按当前元素找技能，名字旁带元素文字", () => {
    const one = panel({ id: "10000007", name: "荧", elem: "cryo", talentCons: { e: 5, q: 3 } })
    const detail = profileDetailData(one)["data"] as { imgs: Record<string, string>; travelerElem: string }
    const mark = profileDetailData(one, { mode: "artis" })["data"] as Record<string, unknown>

    expect(detail.imgs["e"]).toBe("meta-gs/character/旅行者/cryo/icons/cons-5.webp")
    expect(detail.imgs["q"]).toBe("meta-gs/character/旅行者/cryo/icons/cons-3.webp")
    expect(detail.imgs["splash"]).toBe("meta-gs/character/荧/imgs/splash.webp")
    expect(detail.travelerElem).toBe("冰元素")
    expect((mark["imgs"] as Record<string, string>)["cons1"]).toBe("meta-gs/character/旅行者/cryo/icons/cons-1.webp")
    expect(mark["travelerElem"]).toBe("冰元素")
    expect((profileDetailData(panel())["data"] as Record<string, unknown>)["travelerElem"]).toBeUndefined()
  })

  it("圣遗物评分页逐条词条带得分 —— 模板按 `_mark` 印右侧那一列，不给即整列 NaN", () => {
    const one = panel({
      artis: [arti({ idx: 3, main: { id: "15008", key: "pyro", value: 46.6 }, attrs: [{ key: "cpct", upNum: 3, eff: 2.4, value: 10.5 }, { key: "def", upNum: 1, eff: 0.8, value: 5.1 }] })],
      markCfg: { attrs: { cpct: { weight: 100, mark: 2, fixWeight: 100 }, dmg: { weight: 100, mark: 1, fixWeight: 100 } }, classTitle: "胡桃-通用", posMaxMark: {} } as unknown as BuiltPanel["markCfg"]
    })
    const ds = ((profileDetailData(one, { mode: "artis" })["artisDetail"] as { artis: Record<string, ArtiViewLike> }).artis)["3"]

    expect(ds?.attrs.map(it => it._mark)).toEqual([21, 0])
    // 元素伤害杯按 dmg 那一条的系数，主词条除四
    expect(ds?.main?.mark).toBeCloseTo(46.6 / 4)
  })

  it("星铁把命途带给模板 —— 忆灵与欢愉那两条分支按它选天赋表", () => {
    const sr = profileDetailData(panel({ game: "sr", charWeapon: "记忆" }))

    expect((sr["data"] as Record<string, unknown>)["charWeapon"]).toBe("记忆")
  })

  it("行迹小点的图标按元数据的 tree 表逐个替换", () => {
    // 不替换则十个点全画成同一张暴击率图 —— 图出得来而内容是错的
    const sr = profileDetailData(
      panel({
        game: "sr",
        trees: [],
        tree: { "1201201": { key: "hp" }, "1201202": { key: "cdmg" } }
      })
    )
    const flat = ((sr["data"] as { treeData: unknown[] }).treeData ?? [])
      .flat()
      .filter((it): it is { img: string } => typeof (it as { img?: unknown })?.img === "string")
      .map(it => it.img)

    expect(flat).toContain("meta-sr/public/icons/tree-hp.webp")
    expect(flat).toContain("meta-sr/public/icons/tree-cdmg.webp")
  })

  it("星铁额外产出行迹盘，原神没有", () => {
    const gs = profileDetailData(panel())
    const sr = profileDetailData(panel({ game: "sr", trees: ["1102101"] }))

    expect((gs["data"] as Record<string, unknown>)["treeData"]).toBeUndefined()
    expect((sr["data"] as Record<string, unknown>)["treeData"]).toBeDefined()
  })
})

describe("sumAttrs", () => {
  it("按词条键累加并按效率降序", () => {
    const got = sumAttrs(
      panel({
        artis: [
          arti({ attrs: [{ key: "cpct", upNum: 1, eff: 1, value: 3.5 }] }),
          arti({ idx: 2, attrs: [{ key: "cpct", upNum: 2, eff: 2, value: 7 }, { key: "atk", upNum: 1, eff: 0.5, value: 4.7 }] })
        ]
      })
    )

    expect(got).toHaveLength(2)
    expect(got[0]?.["key"]).toBe("cpct")
    expect(got[0]?.["upNum"]).toBe(3)
    expect(got[0]?.["value"]).toBe("10.5%")
  })
})

describe("artisListData", () => {
  it("跨角色拉平成一张列表，按评分降序", () => {
    const a = panel({
      name: "甲",
      artis: [arti()],
      mark: { classTitle: "甲-通用", artis: { "1": { mark: "40.0", _mark: 40, markClass: "S", level: 20, name: "追忆的形骸", set: "追忆之注连" } }, mark: "40.0", _mark: 40, markClass: "S", charWeight: {} }
    })
    const b = panel({
      name: "乙",
      artis: [arti({ idx: 2 })],
      mark: { classTitle: "乙-通用", artis: { "2": { mark: "50.0", _mark: 50, markClass: "SS", level: 20, name: "逐光的鹿角", set: "追忆之注连" } }, mark: "50.0", _mark: 50, markClass: "SS", charWeight: {} }
    })
    const got = artisListData([a, b], { uid: "100000001", game: "gs" })
    const rows = got["artis"] as { avatar: string }[]

    expect(rows).toHaveLength(2)
    expect(rows[0]?.avatar).toBe("乙")
  })

  it("没有评分的件不进列表 —— 那种画出来是一行空格", () => {
    const got = artisListData([panel()], { uid: "100000001", game: "gs" })

    expect(got["artis"]).toEqual([])
  })

  it("按上限截断", () => {
    const one = panel({
      artis: [arti(), arti({ idx: 2 }), arti({ idx: 3 })],
      mark: {
        classTitle: "",
        artis: {
          "1": { mark: "1", _mark: 1, markClass: "D", level: 0, name: "", set: "" },
          "2": { mark: "2", _mark: 2, markClass: "D", level: 0, name: "", set: "" },
          "3": { mark: "3", _mark: 3, markClass: "D", level: 0, name: "", set: "" }
        },
        mark: "",
        _mark: 0,
        markClass: "",
        charWeight: {}
      }
    })
    const got = artisListData([one], { uid: "100000001", game: "gs", limit: 2 })

    expect(got["artis"]).toHaveLength(2)
  })
})

describe("artisKeyTitles", () => {
  it("元素键补成「<元素>伤加成」", () => {
    const got = artisKeyTitles("gs")

    expect(got["pyro"]).toBe("火伤加成")
  })

  it("元数据缺失时仍给出元素那几项，不抛错", () => {
    expect(Object.keys(artisKeyTitles("sr")).length).toBeGreaterThan(0)
  })
})

describe("panelStatData", () => {
  it("接口的角色列表转成模板要的形态，按等级降序", () => {
    const raw = {
      avatars: [
        { id: 10000002, name: "神里绫华", level: 80, rarity: 5, actived_constellation_num: 0 },
        { id: 10000046, name: "胡桃", level: 90, rarity: 5, actived_constellation_num: 2 }
      ]
    }
    const got = panelStatData(raw, { uid: "100000001", game: "gs", name: "旅行者" })
    const avatars = got["avatars"] as { name: string; level: number }[]

    expect(avatars[0]?.name).toBe("胡桃")
    expect(avatars[0]?.level).toBe(90)
  })

  it("已有面板数据的角色带上评分", () => {
    const raw = { avatars: [{ id: 10000046, name: "胡桃", level: 90 }] }
    const got = panelStatData(raw, {
      uid: "100000001",
      game: "gs",
      name: "旅行者",
      marks: { "10000046": { mark: "45.5", markClass: "SS" } }
    })
    const avatars = got["avatars"] as { artisMark?: { mark: string } }[]

    expect(avatars[0]?.artisMark?.mark).toBe("45.5")
  })

  it("天赋印含命座加成的等级，original 留不含的供模板换色", () => {
    const raw = { avatars: [{ id: 10000046, name: "胡桃", level: 90 }] }
    const got = panelStatData(raw, {
      uid: "100000001",
      game: "gs",
      name: "旅行者",
      talents: { "10000046": { a: 10, e: 9, q: 10 } },
      talentLevels: { "10000046": { a: 10, e: 12, q: 13 } }
    })
    const avatars = got["avatars"] as { talent: Record<string, { level: number; original: number }> }[]

    expect(avatars[0]?.talent).toEqual({ a: { level: 10, original: 10 }, e: { level: 12, original: 9 }, q: { level: 13, original: 10 } })
  })

  it("圣遗物按套装计件数，模板据此画套装图标", () => {
    const raw = {
      avatars: [
        {
          id: 10000046,
          name: "胡桃",
          level: 90,
          reliquaries: [{ pos: 1, set: { name: "追忆之注连" } }, { pos: 2, set: { name: "追忆之注连" } }]
        }
      ]
    }
    const got = panelStatData(raw, { uid: "100000001", game: "gs", name: "旅行者" })
    const avatars = got["avatars"] as { artisSet: { sets: Record<string, number> } }[]

    expect(avatars[0]?.artisSet.sets["追忆之注连"]).toBe(2)
  })

  it("接口没给角色时产出空列表而非抛错", () => {
    const got = panelStatData({}, { uid: "100000001", game: "gs", name: "旅行者" })

    expect(got["avatars"]).toEqual([])
  })

  it("星铁的三个键都与原神不同名 —— 只认原神那套时整张图是空的", () => {
    // 列表在 avatar_list 下、星魂叫 rank、光锥在 equip 下且叠影也叫 rank
    const raw = {
      avatar_list: [
        { id: 1306, name: "花火", level: 80, rarity: 5, rank: 2, equip: { name: "以世界之名", level: 80, rarity: 5, rank: 3 } }
      ]
    }
    const got = panelStatData(raw, { uid: "101234567", game: "sr", name: "开拓者" })
    const avatars = got["avatars"] as { name: string; cons: number; weapon: { name?: string; affix?: number } }[]

    expect(avatars).toHaveLength(1)
    expect(avatars[0]?.name).toBe("花火")
    expect(avatars[0]?.cons).toBe(2)
    expect(avatars[0]?.weapon.name).toBe("以世界之名")
    expect(avatars[0]?.weapon.affix).toBe(3)
  })
  it("天赋等级取自面板库 —— 接口本身不给，缺这一项时全表恒印 1 级", () => {
    const raw = { avatars: [{ id: 10000046, name: "胡桃", level: 90 }, { id: 10000002, name: "神里绫华", level: 90 }] }
    const got = panelStatData(raw, {
      uid: "100000001",
      game: "gs",
      name: "旅行者",
      talents: { "10000046": { a: 10, e: 9, q: 10 } }
    })
    const avatars = got["avatars"] as { name: string; aeq: number; talent: Record<string, { level: number }> }[]
    const hu = avatars.find(one => one.name === "胡桃")
    const aya = avatars.find(one => one.name === "神里绫华")

    expect(hu?.talent["a"]?.level).toBe(10)
    expect(hu?.aeq).toBe(29)
    // 库里没有那一份的仍按 1 级，且排在后面
    expect(aya?.talent["q"]?.level).toBe(1)
    expect(aya?.aeq).toBe(3)
    expect(avatars[0]?.name).toBe("胡桃")
  })
})

describe("文字兜底", () => {
  it("面板列表列出角色与评分", () => {
    const got = panelListText([panel()], "100000001")

    expect(got).toContain("100000001")
    expect(got).toContain("胡桃")
  })

  it("没有面板时说清楚", () => {
    expect(panelListText([], "100000001")).toContain("暂无面板数据")
  })

  it("单角色面板列出主要属性与数据源", () => {
    const got = panelText(panel())

    expect(got).toContain("胡桃 90 级 2 命")
    expect(got).toContain("攻击 1,200.0")
    expect(got).toContain("数据来自 Enka.Network")
  })

  it("练度统计的文字形态在超过二十个角色时收尾", () => {
    const avatars = Array.from({ length: 25 }, (_, idx) => ({ abbr: `角色${idx}`, level: 90, cons: 0 }))
    const got = panelStatText({ avatars })

    expect(got).toContain("共 25 个角色")
    expect(got).toContain("另有 5 个")
  })
})

describe("timeText", () => {
  it("格式为 MM-DD HH:mm", () => {
    expect(timeText(new Date("2026-08-30T14:05:00").getTime())).toBe("08-30 14:05")
  })
})

describe("rankListData", () => {
  const CFG = { time: "09-01 00:00", limitTxt: "无限制", number: 15 }
  /**
   * 造一份两人的榜
   * @param over 视图选项
   * @returns 模板数据
   */
  function view(over: Partial<Parameters<typeof rankListData>[1]> = {}): Record<string, unknown> {
    const a = panel({ uid: "100000001", sets: { 追忆之注连: 4 }, artis: [arti(), arti({ idx: 2 })] })
    const b = panel({ uid: "100000002", sets: { 追忆之注连: 2, 角斗士的终幕礼: 2 }, artis: [arti(), arti({ idx: 2, set: "角斗士的终幕礼" })] })
    return rankListData(
      [
        { panel: a, rank: 1, score: 2345.6 },
        { panel: b, rank: 2, score: 1200 }
      ],
      { game: "gs", type: "dmg", charName: "胡桃", elem: "pyro", cfg: CFG, ...over }
    ) as unknown as Record<string, unknown>
  }
  /** 取第 n 行 */
  const row = (got: Record<string, unknown>, n: number): Record<string, unknown> => (got["list"] as Record<string, unknown>[])[n] ?? {}

  it("一套写名字加件数，几套并列换简称；每套只取一张图", () => {
    const got = view({ setAbbr: name => ({ 追忆之注连: "追忆", 角斗士的终幕礼: "角斗" })[name] })
    expect(row(got, 0)["artisSet"]).toMatchObject({ name: "追忆之注连4" })
    expect((row(got, 0)["artisSet"] as { imgs: string[] }).imgs).toHaveLength(1)
    expect(row(got, 1)["artisSet"]).toMatchObject({ name: "追忆2+角斗2" })
  })

  it("头像库里有的那位用玩家头像与昵称，没有的垫角色头像、昵称留空由模板印角色简称", () => {
    const got = view({ who: { "100000001": { face: "mys/gs/abc.png", fromFace: true, name: "某人" } } })
    expect(row(got, 0)["who"]).toEqual({ face: "mys/gs/abc.png", root: "face", name: "某人" })
    expect(row(got, 1)["who"]).toMatchObject({ root: "meta", name: "" })
  })

  it("天赋圈按面板里有的键排：原始等级满 10 戴冠，含加成高于原始等级为 plus", () => {
    const one = panel({ talent: { a: 10, e: 9, q: 9 }, talentLevel: { a: 10, e: 9, q: 12 } })
    const got = rankListData([{ panel: one, rank: 1, score: 1 }], { game: "gs", type: "mark", charName: "胡桃", elem: "pyro", cfg: CFG })
    const tals = (got.list as { tals: { key: string; level: number; plus: boolean; crown: boolean }[] }[])[0]?.tals
    expect(tals?.map(t => [t.key, t.level, t.plus, t.crown])).toEqual([
      ["a", 10, false, true],
      ["e", 9, false, false],
      ["q", 12, true, false]
    ])
  })

  it("伤害维把那条伤害的标题放进副标题与分值小字；其余维度用维度名", () => {
    const dmg = view({ dmgTitle: "E后重击伤害", frame: "pyro" })
    expect(dmg["data"]).toEqual({ title: "E后重击伤害" })
    expect(dmg["valLabel"]).toBe("E后重击伤害")
    expect(dmg["frame"]).toBe("pyro")
    expect(view({ type: "crit", dmgTitle: "不该出现" })["valLabel"]).toBe("双爆副词条")
  })
})