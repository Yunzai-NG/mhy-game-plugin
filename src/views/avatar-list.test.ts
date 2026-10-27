/**
 * 模块职责：`#角色列表` 视图模型的测试
 * 依赖方向：测试文件，只依赖 views/avatar-list（纯函数）
 * 生命周期：无状态
 * 注意事项：钉住**模板每个取值点都有值** —— `common/avatar-card.html` 直接读 `weapon.star` 与
 *          `artisSet.imgs`，缺了它们印出字面的 `undefined`（不报错、只是图上多一行乱码）。另钉
 *          三处"取不到就不给那个键"：星铁没有探索度与宝箱明细，模板据此整块隐藏。
 */
import { describe, expect, it } from "vitest"
import type { BuiltPanel } from "../panel/build.js"
import type { MetaItem, MetaLoader } from "../meta/loader.js"
import { activeDayText, avatarListData, splitCardTalents, type CardTalent } from "./avatar-list.js"

/** 固定的"现在"：2026-09-04 10:30 */
const NOW = new Date(2026, 8, 4, 10, 30, 0).getTime()

/** 一份能出图的原神 index */
const GS_RAW = {
  role: { nickname: "旅行者", level: 60, game_head_icon: "https://a.invalid/head.png" },
  stats: {
    active_day_number: 800,
    achievement_number: 1100,
    way_point_number: 700,
    common_chest_number: 3000,
    exquisite_chest_number: 2500,
    precious_chest_number: 800,
    luxurious_chest_number: 300,
    magic_chest_number: 200
  },
  world_explorations: [
    { id: 1, name: "蒙德", exploration_percentage: 1000 },
    { id: 3, name: "龙脊雪山", exploration_percentage: 889 },
    { id: 9, name: "枫丹", exploration_percentage: 500 }
  ],
  avatars: [
    { id: 10000046, name: "胡桃", level: 90, rarity: 5, actived_constellation_num: 2, element: "Pyro" },
    { id: 10000034, name: "班尼特", level: 80, rarity: 4, actived_constellation_num: 6, element: "Pyro" },
    { id: 10000005, name: "旅行者", level: 60, rarity: 5, actived_constellation_num: 0, element: "Anemo" }
  ]
}

/** 一份能出图的星铁 index */
const SR_RAW = {
  cur_head_icon_url: "https://a.invalid/sr-head.png",
  stats: { active_days: 400, achievement_num: 600, chest_num: 2000 },
  avatar_list: [
    { id: 1306, name: "花火", level: 80, rarity: 5, rank: 2, element: "quantum", icon: "https://a.invalid/1306.png" },
    { id: 1013, name: "黑塔", level: 70, rarity: 4, rank: 0, element: "lightning", icon: "https://a.invalid/1013.png" }
  ]
}

/**
 * 造一份装好的面板
 * @param over 要覆盖的字段
 * @returns 面板
 */
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
    talent: { a: 10, e: 9, q: 9 },
    talentLevel: over.talent ?? { a: 10, e: 9, q: 9 },
    trees: [],
    source: "Enka.Network",
    artis: [],
    sets: { 追忆之注连: 4, 逐影猎人: 1 },
    weapon: {
      name: "护摩之杖",
      abbr: "护摩之杖",
      level: 90,
      promote: 6,
      affix: 3,
      star: 5,
      img: "meta-gs/weapon/polearm/护摩之杖/icon.webp"
    },
    attr: {} as unknown as BuiltPanel["attr"],
    base: {},
    imgs: {},
    ...over
  }
}

/** 一份只认得出胡桃的元数据装载器 */
const META = {
  find: (_game: string, id: string | number | undefined, _name: string): MetaItem | undefined =>
    String(id) === "10000046" ? ({ id: "10000046", name: "胡桃", abbr: "胡桃", star: 5, elem: "pyro" } as MetaItem) : undefined
} as unknown as MetaLoader

describe("activeDayText", () => {
  it("按年月天折算，为 0 的段落整个不出现", () => {
    expect(activeDayText(800)).toBe("2年2个月9天")
    expect(activeDayText(365)).toBe("1年")
    expect(activeDayText(1)).toBe("1天")
    expect(activeDayText(0)).toBe("")
  })
})

describe("avatarListData", () => {
  it("原神：横幅、探索度与宝箱三块都齐，角色按稀有度与等级排", () => {
    const data = avatarListData(GS_RAW, { game: "gs", uid: "100000001", name: "某人", meta: META, now: NOW })
    const info = data["info"] as Record<string, unknown>
    const face = data["face"] as Record<string, unknown>

    expect(face["name"]).toBe("旅行者")
    expect(face["level"]).toBe(60)
    // 米游社给了头像就用它，模板据 `meta-` 前缀决定不加根
    expect(face["qFace"]).toBe("https://a.invalid/head.png")
    expect(info["activeDay"]).toBe("2年2个月9天")

    const stats = info["stats"] as Record<string, number>
    expect(stats["achievement"]).toBe(1100)
    // 角色数由本层数出来，与画了几个格子一致
    expect(stats["avatar"]).toBe(3)
    expect(stats["avatar5"]).toBe(2)
    expect(stats["commonChest"]).toBe(3000)

    // 五格宝箱的次序即雪碧图的格子次序，不可调换
    const chestMap = info["chestMap"] as { key: string; title: string }[]
    expect(chestMap.map(it => it.title)).toEqual(["普通宝箱", "精致宝箱", "珍贵宝箱", "华丽宝箱", "奇馈宝箱"])

    // 地区卡与 `#信息` 同一份：龙脊雪山挂在蒙德下面一行，接口没有的地区不出卡
    const areas = info["areas"] as { key: string; line: { name: string; text: string }[] }[]
    expect(areas.map(a => a.key)).toEqual(["枫丹", "蒙德"])
    expect(areas[1]?.line).toEqual([
      { name: "探索度", text: "100%" },
      { name: "龙脊雪山", text: "88.9%" }
    ])

    const avatars = data["avatars"] as { abbr: string; level: number }[]
    expect(avatars.map(it => it.abbr)).toEqual(["胡桃", "空", "班尼特"])
  })

  it("星铁：不给地区卡与宝箱明细两个键 —— 模板据此整块隐藏", () => {
    const data = avatarListData(SR_RAW, { game: "sr", uid: "100000001", name: "开拓者", now: NOW })
    const info = data["info"] as Record<string, unknown>

    expect(info["areas"]).toBeUndefined()
    expect(info["chestMap"]).toBeUndefined()
    // 宝箱总数仍在横幅那一排里
    expect((info["stats"] as Record<string, number>)["chest"]).toBe(2000)
    expect((info["statMap"] as Record<string, string>)["chest"]).toBe("宝箱")
    // 接口不给游戏昵称，回落到查询者的昵称，且不印那个 Lv.
    const face = data["face"] as Record<string, unknown>
    expect(face["name"]).toBe("开拓者")
    expect(face["level"]).toBe(0)
    expect(data["elem"]).toBe("sr")
  })

  it("星铁的命途键两套拼法都认得出 —— 少认一套那个圆点整个不出现", () => {
    const data = avatarListData(SR_RAW, { game: "sr", uid: "100000001", name: "开拓者", now: NOW })
    const avatars = data["avatars"] as { abbr: string; elem: string }[]

    expect(avatars.map(it => it.elem)).toEqual(["quantum", "elec"])
  })

  it("有面板数据的角色带上天赋、武器与套装图", () => {
    const data = avatarListData(GS_RAW, {
      game: "gs",
      uid: "100000001",
      name: "某人",
      meta: META,
      panels: [panel()],
      profileAt: NOW - 3_600_000,
      now: NOW
    })
    const first = (data["avatars"] as Record<string, unknown>[])[0] as Record<string, unknown>

    expect(first["talent"]).toEqual({ a: { level: 10, original: 10 }, e: { level: 9, original: 9 }, q: { level: 9, original: 9 } })
    expect(first["weapon"]).toEqual({ star: 5, img: "meta-gs/weapon/polearm/护摩之杖/icon.webp", affix: 3 })
    // 逐影猎人只有一件，凑不够两件不算一套
    expect(first["artisSet"]).toEqual({
      names: ["追忆之注连"],
      imgs: ["meta-gs/artifact/imgs/追忆之注连/1.webp"]
    })
    expect(data["updateTime"]).toEqual({ mys: "09-04 10:30", profile: "09-04 09:30" })
  })

  it("天赋格印含命座加成的等级并标 plus，皇冠按不含加成的判", () => {
    const data = avatarListData(GS_RAW, {
      game: "gs",
      uid: "100000001",
      name: "某人",
      meta: META,
      panels: [panel({ cons: 6, talent: { a: 10, e: 9, q: 10 }, talentLevel: { a: 10, e: 12, q: 13 } })],
      now: NOW
    })
    const first = (data["avatars"] as Record<string, unknown>[])[0] as { talent: unknown; tals: CardTalent[] }

    expect(first.talent).toEqual({ a: { level: 10, original: 10 }, e: { level: 12, original: 9 }, q: { level: 13, original: 10 } })
    expect(first.tals.map(t => [t.level, t.crown, t.plus])).toEqual([
      [10, true, false],
      [12, false, true],
      [13, true, true]
    ])
  })

  it("没有面板数据的角色也给全武器壳与空套装 —— 缺了它模板印出字面的 undefined", () => {
    const data = avatarListData(GS_RAW, { game: "gs", uid: "100000001", name: "某人", meta: META, now: NOW })
    for (const one of data["avatars"] as Record<string, unknown>[]) {
      expect(one["weapon"]).toEqual({ star: 0, img: "", affix: 0 })
      expect(one["artisSet"]).toEqual({ names: [], imgs: [] })
      // 天赋给空对象，模板据此改印「暂无天赋数据」
      expect(one["talent"]).toEqual({})
      expect(one["face"]).not.toBe(undefined)
      expect(one["gacha"]).not.toBe(undefined)
      expect(one["preview"]).not.toBe(undefined)
    }
    // 一次面板都没更新过时不给 profile 那一项，模板只印米游社的时刻
    expect(data["updateTime"]).toEqual({ mys: "09-04 10:30" })
  })

  it("元数据与面板库都不认识的角色，头像回落到米游社的绝对地址", () => {
    const data = avatarListData(
      { avatars: [{ id: 99999, name: "未上线", level: 1, rarity: 5, icon: "https://a.invalid/new.png" }] },
      { game: "gs", uid: "100000001", name: "某人", meta: META, now: NOW }
    )
    const first = (data["avatars"] as Record<string, unknown>[])[0] as Record<string, unknown>

    expect(first["face"]).toBe("https://a.invalid/new.png")
    expect(first["name"]).toBe("未上线")
  })

  it("认得出的角色一律走元数据的路径，不用米游社那张", () => {
    const data = avatarListData(
      {
        avatars: [{ id: 10000046, name: "胡桃", level: 90, rarity: 5, icon: "https://a.invalid/hutao.png" }]
      },
      { game: "gs", uid: "100000001", name: "某人", meta: META, now: NOW }
    )
    const first = (data["avatars"] as Record<string, unknown>[])[0] as Record<string, unknown>

    expect(String(first["face"]).startsWith("meta-gs/character/胡桃/")).toBe(true)
  })

  it("空 data 也能出视图 —— 米游社少给字段不该让一条命令失败", () => {
    const data = avatarListData({}, { game: "gs", uid: "100000001", name: "某人", now: NOW })

    expect(data["avatars"]).toEqual([])
    expect((data["info"] as Record<string, unknown>)["areas"]).toBeUndefined()
    expect((data["face"] as Record<string, unknown>)["banner"]).toBe("")
    expect(data["isSelfCookie"]).toBe(true)
  })
})

describe("splitCardTalents", () => {
  /**
   * 造一格天赋
   * @param key 天赋键
   * @param level 等级
   * @returns 一格
   */
  const tal = (key: string, level: number): CardTalent => ({ key, name: "", level, crown: false })

  it("记忆角色的忆灵两项进角标，不挤进天赋行 —— 塞一行时每格压到 8px", () => {
    const got = splitCardTalents([tal("a", 6), tal("e", 10), tal("q", 10), tal("t", 9), tal("me", 6), tal("mt", 6)])

    expect(got.tals.map(t => t.key)).toEqual(["a", "e", "q", "t"])
    expect(got.xtals.map(t => [t.key, t.name])).toEqual([["me", "忆技"], ["mt", "忆赋"]])
  })

  it("欢愉角色的欢愉技进角标", () => {
    const got = splitCardTalents([tal("a", 6), tal("e", 10), tal("q", 10), tal("t", 9), tal("j", 10)])

    expect(got.tals).toHaveLength(4)
    expect(got.xtals.map(t => t.name)).toEqual(["欢愉"])
  })

  it("原神只有天赋行，角标为空", () => {
    const got = splitCardTalents([tal("a", 8), tal("e", 9), tal("q", 10)])

    expect(got.tals).toHaveLength(3)
    expect(got.xtals).toEqual([])
  })

  it("不认得的键（秘技 z 没有等级）两份都不进 —— 进了就是一格空角标", () => {
    const got = splitCardTalents([tal("a", 6), tal("z", 1)])

    expect(got.tals.map(t => t.key)).toEqual(["a"])
    expect(got.xtals).toEqual([])
  })
})
