/**
 * 模块职责：深渊视图模型的测试
 * 依赖方向：测试文件，只依赖 views/abyss.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：本文件固定三项口径：**总星数仅计入 9 层及以上**、**星铁两个半场的角色去重**、
 *          以及**未参与记录须可被识别**（该情形下接口同样返回成功）。
 */
import { describe, expect, it } from "vitest"
import type { AvatarCardView } from "./avatar-list.js"
import {
  abyssEmpty,
  abyssFloorTemplateData,
  abyssText,
  abyssTemplateData,
  buildAbyss,
  resolveFloor
} from "./abyss.js"

/** 2026-08-01 的 unix 秒 */
const START = Math.floor(new Date(2026, 7, 1).getTime() / 1000)

describe("buildAbyss", () => {
  it("原神：只算 9 层及以上的星，五项排行按固定顺序出来", () => {
    const view = buildAbyss(
      {
        start_time: String(START),
        max_floor: "12-3",
        total_star: 45,
        total_battle_times: 24,
        floors: [
          { index: 8, star: 9, max_star: 9 },
          { index: 9, star: 9, max_star: 9 },
          { index: 10, star: 9, max_star: 9 },
          { index: 11, star: 9, max_star: 9 },
          { index: 12, star: 8, max_star: 9 }
        ],
        reveal_rank: [{ avatar_id: 10000089, value: 12, avatar_icon: "https://a.png" }],
        damage_rank: [{ avatar_id: 10000089, value: 168_888, avatar_icon: "https://a.png" }],
        take_damage_rank: [{ avatar_id: 10000075, value: 40_000 }],
        defeat_rank: [{ avatar_id: 10000089, value: 30 }],
        normal_skill_rank: [{ avatar_id: 10000089, value: 100 }],
        energy_skill_rank: [{ avatar_id: 10000089, value: 20 }]
      },
      { game: "gs", uid: "100000001", name: "旅行者", schedule: 1 }
    )

    expect(view.season).toBe("8 月")
    expect(view.deepest).toBe("12-3")
    // 第 8 层的 9 星不算进来：群里说的"我 36 星"指的是 9~12 层
    expect(view.totalStar).toBe(35)
    expect(view.floors.map(it => it.name)).toEqual(["第 9 层", "第 10 层", "第 11 层", "第 12 层"])
    expect(view.ranks.map(it => it.label)).toEqual(["最强一击", "承受伤害", "击败最多", "元素战技", "元素爆发"])
    expect(view.ranks[0]).toMatchObject({ value: 168_888, id: "10000089", icon: "https://a.png" })
    expect(view.actors[0]).toMatchObject({ id: "10000089", times: 12 })
    expect(abyssEmpty(view)).toBe(false)
  })

  it("上期在期数后面标出来，免得用户以为查错了", () => {
    const view = buildAbyss({ start_time: START, max_floor: "12-3", floors: [{ index: 12, star: 9 }] }, {
      game: "gs",
      uid: "100000001",
      name: "旅行者",
      schedule: 2
    })

    expect(view.season).toBe("8 月（上期）")
  })

  it("期数名取不到时上期就写「上期」，不写成「本期（上期）」", () => {
    // 星铁上期的返回常常没有 begin_time.month，此时兜底值本身要跟着期数变
    const view = buildAbyss({ schedule: {}, max_floor: "学院怪谈其十二", battle_num: 4 }, {
      game: "sr",
      uid: "101234567",
      name: "开拓者",
      schedule: 2
    })

    expect(view.season).toBe("上期")
  })

  it("星铁：逐关成绩加上各节点去重后的上场角色，没有战斗排行", () => {
    const view = buildAbyss(
      {
        schedule: { begin_time: { year: 2026, month: 8, day: 1 } },
        max_floor: "混沌回忆第 12 层",
        star_num: 30,
        battle_num: 12,
        all_floor_detail: [
          {
            name: "第 11 层",
            star_num: 3,
            node_1: { avatars: [{ id: 1201, icon: "https://c.png" }, { id: 1205 }] },
            node_2: { avatars: [{ id: 1201, icon: "https://c.png" }, { id: 1212 }] }
          },
          { name: "第 12 层", star_num: 2, node_1: { avatars: [{ id: 1205 }] } },
          // 新档位每关三个节点：只读前两个会把 1307 静默丢掉，而那不报错
          {
            name: "第 12 层星启模式",
            star_num: 3,
            node_1: { avatars: [{ id: 1205 }] },
            node_2: { avatars: [{ id: 1212 }] },
            node_3: { avatars: [{ id: 1307, icon: "https://d.png" }] }
          }
        ]
      },
      { game: "sr", uid: "100000001", name: "开拓者", schedule: 1 }
    )

    expect(view.deepest).toBe("混沌回忆第 12 层")
    expect(view.totalStar).toBe(30)
    expect(view.floors.map(it => `${it.name} ${it.star}/${it.maxStar}`)).toEqual([
      "第 11 层 3/3",
      "第 12 层 2/3",
      "第 12 层星启模式 3/3"
    ])
    expect(view.ranks).toEqual([])
    // 1201 在两个节点都上了，只算一次；1307 只在第三个节点上过，同样要算进来
    expect(view.actors.map(it => it.id)).toEqual(["1201", "1205", "1212", "1307"])
  })

  it("本期未参与时可被识别 —— 该情形下接口同样返回成功", () => {
    const view = buildAbyss({ total_battle_times: 0, floors: [{ index: 9, star: 0, max_star: 9 }] }, {
      game: "gs",
      uid: "100000001",
      name: "旅行者",
      schedule: 1
    })

    expect(abyssEmpty(view)).toBe(true)
    expect(view.season).toBe("本期")
    expect(view.deepest).toBe("-")
  })

  it("空 data 也能出视图", () => {
    const view = buildAbyss({}, { game: "sr", uid: "100000001", name: "开拓者", schedule: 1 })

    expect(view.floors).toEqual([])
    expect(view.actors).toEqual([])
    expect(() => abyssText(view)).not.toThrow()
  })
})

describe("abyssText", () => {
  it("先最深抵达与总星数，再逐层，最后排行", () => {
    const view = buildAbyss(
      {
        start_time: START,
        max_floor: "12-3",
        total_battle_times: 24,
        floors: [{ index: 12, star: 8, max_star: 9 }],
        damage_rank: [{ avatar_id: 10000089, value: 168_888 }],
        reveal_rank: [{ avatar_id: 10000089, value: 12 }]
      },
      { game: "gs", uid: "100000001", name: "旅行者", schedule: 1 }
    )
    const lines = abyssText(view).split("\n")

    expect(lines[0]).toBe("原神 100000001（官服）8 月")
    expect(lines[1]).toBe("最深抵达 12-3，共 8 星，战斗 24 次")
    expect(lines[2]).toContain("第 12 层 8/9")
    expect(abyssText(view)).toContain("最强一击 168888")
    expect(abyssText(view)).toContain("出场 1 个角色")
  })
})

describe("abyssTemplateData", () => {
  /** 一张命令层造好的角色卡（本地元数据），模拟传入 */
  const CARD = {
    id: "10000089",
    name: "芙宁娜",
    abbr: "芙宁娜",
    elem: "hydro",
    star: 5,
    level: 90,
    cons: 2,
    game: "gs" as const,
    face: "meta-gs/character/芙宁娜/imgs/face.webp",
    gacha: "meta-gs/character/芙宁娜/imgs/gacha.webp",
    preview: "",
    talent: { a: { level: 1, original: 1 } },
    tals: [{ key: "a", name: "", level: 1, crown: false }],
    xtals: [],
    weapon: { star: 5, img: "w.webp", affix: 1 },
    artisSet: { names: [] as string[], imgs: [] as string[] }
  }

  it("顶部排行用立绘卡、逐层取打到的最后一间队伍；伤害折万、其余记次数", () => {
    const data = abyssTemplateData(
      {
        start_time: START,
        max_floor: "12-3",
        total_battle_times: 24,
        floors: [
          { index: 8, star: 9 },
          {
            index: 12,
            star: 8,
            levels: [
              {
                index: 3,
                star: 2,
                battles: [
                  { index: 1, timestamp: START, avatars: [{ id: 10000089 }] },
                  { index: 2, timestamp: START, avatars: [{ id: 10000075 }] }
                ]
              }
            ]
          }
        ],
        reveal_rank: [{ avatar_id: 10000089, value: 12 }],
        damage_rank: [{ avatar_id: 10000089, value: 168_888 }],
        defeat_rank: [{ avatar_id: 10000089, value: 9 }]
      },
      { game: "gs", uid: "100000001", name: "旅行者", schedule: 2 },
      { "10000089": CARD }
    )

    const abyss = data["abyss"] as { schedule: string; total: number; maxFloor: string; floors: unknown[] }
    expect(abyss.maxFloor).toBe("12-3")
    expect(abyss.total).toBe(24)
    expect(abyss.schedule).toBe("8月")
    // 前八层不计入
    expect(abyss.floors).toHaveLength(1)
    expect(data["msg"]).toBe("上期")

    const stat = data["stat"] as { title?: string; value?: string; banner?: string }[]
    expect(stat[0]).toMatchObject({ title: "最强一击", value: "16.9 W" })
    expect(stat[2]).toMatchObject({ title: "最多击破", value: "9次" })
    // 立绘取自传入的卡
    expect(stat[0]?.banner).toBe("meta-gs/character/芙宁娜/imgs/gacha.webp")

    const avatars = data["avatars"] as Record<string, unknown>
    // 传入的卡原样引用，第二个半场里不在卡 map 的角色退回占位卡
    expect(avatars["10000089"]).toBe(CARD)
    expect(avatars["10000075"]).toBeDefined()
  })

  it("卡 map 里没有的 id 退回接口头像，不丢格", () => {
    const data = abyssTemplateData(
      { reveal_rank: [{ avatar_id: 10000075, value: 3, avatar_icon: "https://a.png", rarity: 5 }] },
      { game: "gs", uid: "100000001", name: "旅行者", schedule: 1 }
    )
    const avatars = data["avatars"] as Record<string, { face: string; star: number }>
    expect(avatars["10000075"]?.face).toBe("https://a.png")
    expect(avatars["10000075"]?.star).toBe(5)
  })

  it("五项排行一个不缺 —— 接口缺哪项，那一格给空对象占位而不是报错", () => {
    const data = abyssTemplateData({}, { game: "gs", uid: "100000001", name: "旅行者", schedule: 1 })
    const stat = data["stat"] as Record<string, unknown>[]
    expect(stat).toHaveLength(5)
    for (const one of stat) expect(one).toEqual({})
    expect(data["avatars"]).toEqual({})
    // 没有上场角色时不算「没面板」，页脚不提示
    expect(data["noPanel"]).toBe(false)
  })

  it("上场角色一个面板都没有时 noPanel 为真，页脚据此提示去更新面板；有一个就不提示", () => {
    const raw = {
      reveal_rank: [
        { avatar_id: 10000089, value: 3 },
        { avatar_id: 10000075, value: 2 }
      ]
    }
    const ctx = { game: "gs" as const, uid: "100000001", name: "旅行者", schedule: 1 }
    expect(abyssTemplateData(raw, ctx)["noPanel"]).toBe(true)
    expect(abyssTemplateData(raw, ctx, { "10000089": CARD })["noPanel"]).toBe(false)
  })
})

describe("resolveFloor", () => {
  it("认阿拉伯数字与中文，十一与十二不被十吃掉", () => {
    expect(resolveFloor("12层")).toBe(12)
    expect(resolveFloor("十二层")).toBe(12)
    expect(resolveFloor("十一层")).toBe(11)
    expect(resolveFloor("十层")).toBe(10)
    expect(resolveFloor("九层")).toBe(9)
  })

  it("八层及以下、以及认不出的写法都给 undefined", () => {
    expect(resolveFloor("8层")).toBeUndefined()
    expect(resolveFloor("")).toBeUndefined()
    expect(resolveFloor("上期")).toBeUndefined()
  })
})

describe("abyssFloorTemplateData", () => {
  /** 一个打满两个半场的间 */
  const level = {
    index: 1,
    star: 3,
    battles: [
      { index: 1, timestamp: START, avatars: [{ id: 10000089, icon: "https://a.png", level: 90, rarity: 5 }] },
      { index: 2, timestamp: START + 60, avatars: [{ id: 10000075, icon: "https://b.png", level: 80, rarity: 4 }] }
    ]
  }

  it("只留打满两个半场的间，上下半各带时刻与上场 id", () => {
    const data = abyssFloorTemplateData(
      {
        floors: [
          {
            index: 12,
            star: 6,
            max_star: 9,
            levels: [level, { index: 2, star: 0, battles: [{ index: 1, timestamp: START, avatars: [] }] }]
          }
        ]
      },
      { game: "gs", uid: "100000001", name: "旅行者", schedule: 1 },
      12
    )

    const rooms = data?.["rooms"] as { index: number; up: { avatars: string[]; time: string }; down: { avatars: string[] } }[]
    // 第二间只打了上半场，模板画不出"下半"那一栏，故整条跳过
    expect(rooms).toHaveLength(1)
    expect(rooms[0]?.index).toBe(1)
    expect(rooms[0]?.up.avatars).toEqual(["10000089"])
    expect(rooms[0]?.down.avatars).toEqual(["10000075"])
    expect(rooms[0]?.up.time).not.toBe("")
  })

  it("头像卡优先用调用方给的整卡；查不到的（试用角色）退回接口给的头像", () => {
    const card = { id: "10000089", face: "meta-gs/character/芙宁娜/imgs/face.webp" } as unknown as AvatarCardView
    const data = abyssFloorTemplateData(
      { floors: [{ index: 12, star: 6, levels: [level] }] },
      { game: "gs", uid: "100000001", name: "旅行者", schedule: 1 },
      12,
      { "10000089": card }
    )

    const avatars = data?.["avatars"] as Record<string, { face: string }>
    expect(avatars["10000089"]?.face).toBe("meta-gs/character/芙宁娜/imgs/face.webp")
    expect(avatars["10000075"]?.face).toBe("https://b.png")
  })

  it("满星数缺失时按 9 兜底 —— 模板要拿它作分母", () => {
    const data = abyssFloorTemplateData(
      { floors: [{ index: 12, star: 6, levels: [level] }] },
      { game: "gs", uid: "100000001", name: "旅行者", schedule: 1 },
      12
    )

    expect((data?.["floor"] as { maxStar: number })["maxStar"]).toBe(9)
  })

  it("该层无记录、或整层未打时给 undefined，命令层据此回一句话而不是出空图", () => {
    const ctx = { game: "gs", uid: "100000001", name: "旅行者", schedule: 1 } as const
    expect(abyssFloorTemplateData({ floors: [{ index: 11, levels: [level] }] }, ctx, 12)).toBeUndefined()
    expect(abyssFloorTemplateData({ floors: [{ index: 12, levels: [] }] }, ctx, 12)).toBeUndefined()
  })
})
