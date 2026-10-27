/**
 * 模块职责：角色卡片视图的测试
 * 依赖方向：测试文件，依赖 views/char-card.ts
 * 生命周期：无状态
 * 注意事项：本文件固定三处易错口径：**皇冠按不含命座加成的等级数**（否则 6 命角色凭空多两个）、
 *          **缺件的圣遗物不让后面的件挪位**（否则模板上第 5 件画到第 4 格）、
 *          以及**没有面板数据时仍出一张卡片**（而不是回一句纯文字错误）。
 */
import { describe, expect, it } from "vitest"
import type { BuiltPanel } from "../panel/build.js"
import { buildCharCard, charCardText, countCrowns, formatUpdateTime, mainSet } from "./char-card.js"

/**
 * 造一份装好的面板，只填卡片用得到的那些字段
 * @param over 要盖掉的字段
 * @returns 面板
 */
function panelOf(over: Partial<BuiltPanel> = {}): BuiltPanel {
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
    talent: { a: 10, e: 9, q: 10 },
    // 没命座加成时加成后的天赋就是原始那份：只盖 talent 的用例要看到它
    talentLevel: over.talent ?? { a: 10, e: 9, q: 10 },
    trees: [],
    source: "Enka.Network",
    artis: [
      { idx: 1, name: "生命之花", set: "焦土之誓的余威", level: 20, star: 5, attrs: [] },
      { idx: 2, name: "死神之羽", set: "焦土之誓的余威", level: 20, star: 5, attrs: [] },
      { idx: 5, name: "余火之璃", set: "焦土之誓的余威", level: 16, star: 5, attrs: [] }
    ],
    sets: { 焦土之誓的余威: 3 },
    attr: { _calc: true, staticAttr: {} } as BuiltPanel["attr"],
    base: {},
    imgs: {},
    ...over
  }
}

describe("formatUpdateTime", () => {
  it("格式化成 MM-DD HH:mm，不带年份", () => {
    // 用本地时间造，免得测试随时区飘
    const at = new Date(2026, 7, 31, 9, 5).getTime()

    expect(formatUpdateTime(at)).toBe("08-31 09:05")
  })

  it("月日时分都补零", () => {
    const at = new Date(2026, 0, 2, 3, 4).getTime()

    expect(formatUpdateTime(at)).toBe("01-02 03:04")
  })

  it("时间戳缺失时给空串而非 NaN", () => {
    expect(formatUpdateTime(undefined)).toBe("")
    expect(formatUpdateTime(0)).toBe("")
  })
})

describe("countCrowns", () => {
  it("数点到 10 级的天赋", () => {
    expect(countCrowns({ a: 10, e: 9, q: 10 })).toBe(2)
  })

  it("一个都没到 10 时为 0", () => {
    expect(countCrowns({ a: 9, e: 6, q: 8 })).toBe(0)
  })

  it("超过 10 级的同样算 —— 存的等级不含命座加成，故 11 只可能来自天赋书之外", () => {
    expect(countCrowns({ a: 11, e: 10, q: 10 })).toBe(3)
  })

  it("空表为 0", () => {
    expect(countCrowns({})).toBe(0)
  })
})

describe("mainSet", () => {
  it("取件数最多的那套", () => {
    expect(mainSet({ 甲: 2, 乙: 3 })).toBe("乙")
  })

  it("两套各两件时取先枚举到的", () => {
    expect(mainSet({ 甲: 2, 乙: 2 })).toBe("甲")
  })

  it("只有一件时给空串 —— 模板写「圣遗物」比写一个不成套的名字更有信息", () => {
    expect(mainSet({ 甲: 1 })).toBe("")
  })

  it("一件都没有时给空串", () => {
    expect(mainSet({})).toBe("")
  })
})

describe("buildCharCard 有面板数据", () => {
  const view = buildCharCard(
    { game: "gs", uid: "100000001", name: "胡桃", abbr: "胡桃", weaponType: "polearm" },
    panelOf()
  )

  it("hasData 为真，等级命座照实带出", () => {
    expect(view.hasData).toBe(true)
    expect(view.level).toBe(90)
    expect(view.cons).toBe(2)
  })

  it("天赋按 a/e/q 次序排，逐个标皇冠", () => {
    expect(view.talents.map(one => [one.key, one.level, one.crown])).toEqual([
      ["a", 10, true],
      ["e", 9, false],
      ["q", 10, true]
    ])
    expect(view.crowns).toBe(2)
  })

  it("等级印含命座加成的那份并标 plus，皇冠仍按不含加成的判", () => {
    const got = buildCharCard(
      { game: "gs", uid: "100000001", name: "胡桃", weaponType: "polearm" },
      panelOf({ cons: 6, talent: { a: 10, e: 9, q: 10 }, talentLevel: { a: 10, e: 12, q: 13 } })
    )
    expect(got.talents.map(one => [one.key, one.level, one.crown, one.plus])).toEqual([
      ["a", 10, true, false],
      ["e", 12, false, true],
      ["q", 13, true, true]
    ])
    expect(got.crowns).toBe(2)
  })

  it("天赋各自带图标，模板不必自己拼路径", () => {
    for (const one of view.talents) expect(one.img).toBeTruthy()
    // 原神的普攻图标按武器类型取，且不在角色目录下 —— 它是 common/item 里的一张公共图
    expect(view.talents[0]?.img).toBe("gs/atk/atk-polearm.webp")
    expect(view.talents[1]?.img).toMatch(/^meta-gs\/character\//)
  })

  it("缺件的部位留 undefined，后面的件不挪位", () => {
    // 3、4 号位没有；第 5 件必须仍落在第 5 格
    expect(view.artis.map(one => one.level)).toEqual([20, 20, undefined, undefined, 16])
    expect(view.artis.map(one => one.idx)).toEqual([1, 2, 3, 4, 5])
  })

  it("有件的格子带图标，缺件的那格图标为空串", () => {
    expect(view.artis[0]?.img).toBe("meta-gs/artifact/imgs/焦土之誓的余威/1.webp")
    expect(view.artis[2]?.img).toBe("")
  })

  it("套装取件数最多的那套", () => {
    expect(view.artisSet).toBe("焦土之誓的余威")
  })

  it("元素以面板里的为准，上下文只作回落", () => {
    const got = buildCharCard({ game: "gs", uid: "1", name: "胡桃", elem: "geo" }, panelOf())

    expect(got.elem).toBe("pyro")
  })

  it("没有面板时元素回落到上下文", () => {
    const got = buildCharCard({ game: "gs", uid: "1", name: "胡桃", elem: "pyro" })

    expect(got.elem).toBe("pyro")
  })
})

describe("buildCharCard 武器名的简称规则", () => {
  it("名字超过四个字用简称，沿用源模板", () => {
    const got = buildCharCard(
      { game: "gs", uid: "1", name: "胡桃" },
      panelOf({ weapon: { name: "护摩之杖长长长", abbr: "护摩", level: 90, promote: 6, affix: 1, star: 5 } })
    )

    expect(got.weapon?.name).toBe("护摩")
  })

  it("四个字及以内用全名", () => {
    const got = buildCharCard(
      { game: "gs", uid: "1", name: "胡桃" },
      panelOf({ weapon: { name: "护摩之杖", abbr: "护摩", level: 90, promote: 6, affix: 1, star: 5 } })
    )

    expect(got.weapon?.name).toBe("护摩之杖")
  })

  it("名字长但没有简称时仍用全名，不至于空着", () => {
    const got = buildCharCard(
      { game: "gs", uid: "1", name: "胡桃" },
      panelOf({ weapon: { name: "很长很长的一把武器", abbr: "", level: 90, promote: 6, affix: 1, star: 5 } })
    )

    expect(got.weapon?.name).toBe("很长很长的一把武器")
  })
})

describe("buildCharCard 没有面板数据", () => {
  const view = buildCharCard({ game: "gs", uid: "100000001", name: "胡桃" })

  it("hasData 为假，但视图仍然成立 —— 卡片照出", () => {
    expect(view.hasData).toBe(false)
    expect(view.name).toBe("胡桃")
    // 立绘不依赖面板数据：没有面板也照样出图，这是本分支存在的理由
    expect(view.gacha).toBe("meta-gs/character/胡桃/imgs/splash.webp")
  })

  it("提示里点明可操作的下一步，并带上本游戏的命令前缀", () => {
    expect(view.tip).toContain("角色展柜")
    expect(view.tip).toContain("#更新面板")
  })

  it("星铁的提示用 * 前缀", () => {
    const got = buildCharCard({ game: "sr", uid: "1", name: "三月七" })

    expect(got.tip).toContain("*更新面板")
  })

  it("数值项归零而非 undefined，模板无须逐项判空", () => {
    expect(view.level).toBe(0)
    expect(view.cons).toBe(0)
    expect(view.crowns).toBe(0)
    expect(view.talents).toEqual([])
    expect(view.artis).toEqual([])
  })
})

describe("buildCharCard 星铁", () => {
  it("天赋多一个 t，圣遗物六格", () => {
    const view = buildCharCard(
      { game: "sr", uid: "100000001", name: "三月七" },
      panelOf({
        game: "sr",
        talent: { a: 6, e: 10, q: 10, t: 10 },
        artis: [{ idx: 6, name: "链走", set: "甲", level: 15, star: 5, attrs: [] }],
        sets: { 甲: 1 }
      })
    )

    expect(view.talents.map(one => one.key)).toEqual(["a", "e", "q", "t"])
    expect(view.artis).toHaveLength(6)
    expect(view.artis[5]?.level).toBe(15)
    // 星铁的图标目录形态与原神不同（文件名带 arti- 前缀、不多一层 imgs/），由 artiImg 一处决定
    expect(view.artis[5]?.img).toBe("meta-sr/artifact/甲/arti-6.webp")
  })

  it("元数据里没有的天赋键不画格子", () => {
    const view = buildCharCard({ game: "sr", uid: "1", name: "三月七" }, panelOf({ game: "sr", talent: { a: 6, e: 10 } }))

    expect(view.talents.map(one => one.key)).toEqual(["a", "e"])
  })
})

describe("charCardText", () => {
  it("没有面板数据时就是那句提示", () => {
    const view = buildCharCard({ game: "gs", uid: "1", name: "胡桃" })

    expect(charCardText(view)).toBe(view.tip)
  })

  it("天赋写成群里常见的 10/9/10 形态，并注明皇冠数", () => {
    const text = charCardText(buildCharCard({ game: "gs", uid: "100000001", name: "胡桃" }, panelOf()))

    expect(text).toContain("10/9/10")
    expect(text).toContain("2 皇冠")
    expect(text).toContain("uid 100000001")
  })

  it("一个皇冠都没有时不写那一段", () => {
    const text = charCardText(
      buildCharCard({ game: "gs", uid: "1", name: "胡桃" }, panelOf({ talent: { a: 9, e: 9, q: 9 } }))
    )

    expect(text).toContain("9/9/9")
    expect(text).not.toContain("皇冠")
  })
})
