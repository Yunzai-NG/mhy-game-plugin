/**
 * 模块职责：绝区零三类战绩视图的测试
 * 依赖方向：测试文件，只依赖 views/zzz/challenge.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：固定三条最容易静默出错的口径：第五层那个键是官方拼错的 `fitfh`（写成 fifth 会判成
 *          "本期没打过"）、拟境湮灭战的 `challenge_time` 是用时而非时刻（按时刻排版会印出
 *          「0026-00-00 00:03:41」）、增益在两条接口里一个是对象一个是数组。
 */
import { describe, expect, it } from "vitest"
import type { ZzzBattleRaw, ZzzDeadlyRaw, ZzzDefenseWrapRaw, ZzzHoloRaw } from "./challenge.js"
import {
  zzzDeadlyData,
  zzzDeadlyState,
  zzzDeadlyText,
  zzzDefenseData,
  zzzDefenseState,
  zzzDefenseText,
  zzzHoloData,
  zzzHoloState,
  zzzHoloText
} from "./challenge.js"
// 时刻、用时与排名的排版是几张图共用的一份，故在 zzz-common 里
import { zzzCost, zzzDate, zzzRank, zzzRankTier, zzzTime } from "./common.js"

/** 出图与出文字共用的上下文 */
const CTX = { uid: "1300000001", nickname: "绳匠", period: "本期" }

/** 一位上场代理人 */
const ANBY = { id: 1011, level: 60, rank: 2, rarity: "S", role_square_url: "https://a.invalid/1011.png" }

/** 一间：式舆防卫战那一路，增益是**对象** */
const ROOM = {
  rating: "S",
  score: 50_000,
  monster_pic: "https://a.invalid/m.png",
  challenge_time: { year: 2026, month: 8, day: 20, hour: 21, minute: 3, second: 8 },
  buffer: { title: "勠力" },
  avatar_list: [ANBY],
  buddy: { id: 54_010, level: 60, rarity: "S", bangboo_rectangle_url: "https://a.invalid/b.png" }
}
/** 一份能出图的式舆防卫战返回 */
const DEFENSE: ZzzDefenseWrapRaw = {
  hadal_ver: "v2",
  hadal_info_v2: {
    hadal_begin_time: { year: 2026, month: 8, day: 18, hour: 4 },
    hadal_end_time: { year: 2026, month: 9, day: 1 },
    brief: { score: 150_000, rank_percent: 137, rating: "S+", battle_time: 245 },
    fitfh_layer_detail: { rating: "S+", layer_challenge_info_list: [ROOM] },
    second_layer_detail: { rating: "S", layer_challenge_info_list: [{ avatar_list: [ANBY] }] }
  }
}

/** 一场：危局强袭战那一路，增益是**数组**，时间是通关时刻 */
const BATTLE: ZzzBattleRaw = {
  score: 45_323,
  star: 2,
  total_star: 3,
  challenge_time: { year: 2026, month: 7, day: 29, hour: 12, minute: 57, second: 29 },
  boss: [{ icon: "https://a.invalid/boss.png", name: "滞变畸兽", race_icon: "https://a.invalid/r.png" }],
  buffer: [{ icon: "https://a.invalid/buff.png", name: "诡袭", desc: "· 攻击力提升" }],
  avatar_list: [ANBY]
}

/** 一份能出图的危局强袭战返回 */
const DEADLY: ZzzDeadlyRaw = {
  has_data: true,
  start_time: { year: 2026, month: 7, day: 29 },
  end_time: { year: 2026, month: 8, day: 14 },
  rank_percent: 2393,
  nick_name: "米哈游董事长",
  avatar_icon: "https://a.invalid/face.png",
  total_score: 110_998,
  total_star: 9,
  total_max_score: 195_000,
  room_max_score: 65_000,
  list: [BATTLE]
}

/** 一份能出图的拟境湮灭战返回，时间是**用时** */
const HOLO: ZzzHoloRaw = {
  unlock: true,
  start_time: { year: 2026, month: 8, day: 4 },
  list: [
    {
      star: 3,
      total_star: 3,
      rank: 341,
      challenge_time: { minute: 3, second: 41 },
      boss: { icon: "https://a.invalid/h.png", name: "「白祸」", medal: { medal_id: 2, is_no_injured: true } },
      avatar_list: [ANBY]
    }
  ]
}
describe("时间与排名的排版", () => {
  it("时刻排到秒，各位补零", () => {
    expect(zzzTime({ year: 2026, month: 7, day: 9, hour: 8, minute: 5, second: 3 })).toBe("2026-07-09 08:05:03")
  })

  it("没给年份就当没有这一项 —— 否则会印出「0000-00-00 00:00:00」", () => {
    expect(zzzTime(undefined)).toBe("")
    expect(zzzTime({ minute: 3, second: 41 })).toBe("")
    expect(zzzDate({ minute: 3 })).toBe("")
  })

  it("日期只到日", () => {
    expect(zzzDate({ year: 2026, month: 8, day: 4 })).toBe("2026.08.04")
  })

  it("用时按分秒排，零与负数一律空串", () => {
    expect(zzzCost(245)).toBe("04:05")
    expect(zzzCost(0)).toBe("")
    expect(zzzCost(undefined)).toBe("")
  })

  it("排名是放大一百倍的整数", () => {
    expect(zzzRank(2393)).toBe("23.93%")
    expect(zzzRank(50)).toBe("0.50%")
    expect(zzzRank(0)).toBe("")
  })

  it("排名五档按 1 / 5 / 10 / 50 分界", () => {
    expect(zzzRankTier(50)).toBe(1)
    expect(zzzRankTier(137)).toBe(2)
    expect(zzzRankTier(700)).toBe(3)
    expect(zzzRankTier(2393)).toBe(4)
    expect(zzzRankTier(8000)).toBe(5)
    // 没有这一项时给最后一档：0 落在"小于 1%"里，照算会把"没有排名"画成最靠前的那一档
    expect(zzzRankTier(undefined)).toBe(5)
    expect(zzzRankTier(0)).toBe(5)
  })
})
describe("zzzDefenseState", () => {
  it("有一层打过就能出图", () => {
    expect(zzzDefenseState(DEFENSE)).toBe("ok")
  })

  it("不是 v2 时判为旧版 —— 按新版读会得到一张全零的图", () => {
    expect(zzzDefenseState({ hadal_ver: "v1", hadal_info_v2: DEFENSE.hadal_info_v2 })).toBe("old")
    expect(zzzDefenseState(undefined)).toBe("old")
  })

  it("一层都没打过时判为空", () => {
    expect(zzzDefenseState({ hadal_ver: "v2", hadal_info_v2: {} })).toBe("empty")
    // 层在但一间都没有，同样是没打过
    expect(zzzDefenseState({ hadal_ver: "v2", hadal_info_v2: { fitfh_layer_detail: {} } })).toBe("empty")
  })

  it("第五层那个键是官方拼错的 fitfh —— 按 fifth 读会把打过的判成没打过", () => {
    const wrong = { hadal_ver: "v2", hadal_info_v2: { fifth_layer_detail: { layer_challenge_info_list: [ROOM] } } }

    expect(zzzDefenseState(wrong as ZzzDefenseWrapRaw)).toBe("empty")
    expect(zzzDefenseState(DEFENSE)).toBe("ok")
  })
})

describe("zzzDefenseData", () => {
  it("层由高到低，没打过的层整个不出现", () => {
    const view = zzzDefenseData(DEFENSE, CTX)
    const layers = view["layers"] as { name: string; top: boolean }[]

    expect(layers.map(it => it.name)).toEqual(["剧变节点第五防线", "剧变节点第二防线"])
    // 只有第五层带总览，模板据此多画一块
    expect(layers.map(it => it.top)).toEqual([true, false])
  })

  it("评级里的加号在样式名里写作 P —— CSS 类名不能带加号", () => {
    const view = zzzDefenseData(DEFENSE, CTX)

    expect(view["rating"]).toBe("S+")
    expect(view["ratingClass"]).toBe("SP")
  })

  it("接口不给评级时样式名为 none，模板据此不画那枚角标", () => {
    const view = zzzDefenseData({ hadal_ver: "v2", hadal_info_v2: { brief: {} } }, CTX)

    expect(view["ratingClass"]).toBe("none")
  })
})
describe("阵容", () => {
  it("恒三格，缺位占空 —— 丢掉会让同一行其余卡片向左错位", () => {
    const view = zzzDefenseData(DEFENSE, CTX)
    const layers = view["layers"] as { rooms: { avatars: { empty: boolean; id: string }[] }[] }[]
    const avatars = layers[0]?.rooms[0]?.avatars ?? []

    expect(avatars).toHaveLength(3)
    expect(avatars.map(it => it.empty)).toEqual([false, true, true])
    expect(avatars[0]?.id).toBe("1011")
  })

  it("名字由元数据补，补不到时为空串", () => {
    const named = zzzDefenseData(DEFENSE, { ...CTX, nameOf: (id): string => (id === "1011" ? "安比" : "") })
    const layers = named["layers"] as { rooms: { avatars: { name: string }[] }[] }[]

    expect(layers[0]?.rooms[0]?.avatars[0]?.name).toBe("安比")
    const bare = zzzDefenseData(DEFENSE, CTX)
    const bareLayers = bare["layers"] as { rooms: { avatars: { name: string }[] }[] }[]
    expect(bareLayers[0]?.rooms[0]?.avatars[0]?.name).toBe("")
  })

  it("没有邦布时不给这一项 —— 模板据此整格不画", () => {
    const view = zzzDefenseData(DEFENSE, CTX)
    const layers = view["layers"] as { rooms: Record<string, unknown>[] }[]

    expect(layers[0]?.rooms[0]?.["buddy"]).toBeDefined()
    // 第二层那一间没给邦布
    expect(layers[1]?.rooms[0]?.["buddy"]).toBeUndefined()
  })

  it("接口不给稀有度时按 A 处理 —— 边框缺一张比错一张显眼", () => {
    const view = zzzDefenseData(
      { hadal_ver: "v2", hadal_info_v2: { fitfh_layer_detail: { layer_challenge_info_list: [{ avatar_list: [{ id: 1 }] }] } } },
      CTX
    )
    const layers = view["layers"] as { rooms: { avatars: { rarity: string }[] }[] }[]

    expect(layers[0]?.rooms[0]?.avatars[0]?.rarity).toBe("A")
  })
})
describe("zzzDeadlyData", () => {
  it("没有记录时判为空", () => {
    expect(zzzDeadlyState({ has_data: false, list: [BATTLE] })).toBe("empty")
    expect(zzzDeadlyState({ has_data: true, list: [] })).toBe("empty")
    expect(zzzDeadlyState(DEADLY)).toBe("ok")
  })

  it("昵称与头像取接口自带的那份 —— 它就是游戏里那个", () => {
    const view = zzzDeadlyData(DEADLY, CTX)

    expect(view["nickname"]).toBe("米哈游董事长")
    expect(view["avatar"]).toBe("https://a.invalid/face.png")
  })

  it("满分由接口给出，不写死", () => {
    const view = zzzDeadlyData(DEADLY, CTX)
    const rooms = view["rooms"] as { full: boolean; score: number }[]

    expect(view["maxScore"]).toBe(195_000)
    expect(view["full"]).toBe(false)
    // 45323 未到 65000，故不算满分
    expect(rooms[0]?.full).toBe(false)
    const maxed = zzzDeadlyData({ ...DEADLY, list: [{ ...BATTLE, score: 65_000 }] }, CTX)
    expect((maxed["rooms"] as { full: boolean }[])[0]?.full).toBe(true)
  })

  it("增益在这一条接口里是数组，名字在 name 里", () => {
    const view = zzzDeadlyData(DEADLY, CTX)
    const rooms = view["rooms"] as { buff: { name: string; icon: string } }[]

    expect(rooms[0]?.buff.name).toBe("诡袭")
    expect(rooms[0]?.buff.icon).toBe("https://a.invalid/buff.png")
  })

  it("首领在这一条接口里是数组，取头一个", () => {
    const view = zzzDeadlyData(DEADLY, CTX)
    const rooms = view["rooms"] as { boss: { name: string; race: string } }[]

    expect(rooms[0]?.boss.name).toBe("滞变畸兽")
    expect(rooms[0]?.boss.race).toBe("https://a.invalid/r.png")
  })

  it("星格按满星数摊开，已得的在前", () => {
    const view = zzzDeadlyData(DEADLY, CTX)
    const rooms = view["rooms"] as { stars: boolean[] }[]

    expect(rooms[0]?.stars).toEqual([true, true, false])
  })
})
describe("绝境一档", () => {
  it("接口说没有时不出这一块", () => {
    const view = zzzDeadlyData(DEADLY, CTX)

    expect(view["hasHard"]).toBe(false)
    expect(view["hard"]).toEqual([])
  })

  it("有绝境时另带一个排名 —— 它与总排名不是一回事", () => {
    const view = zzzDeadlyData({ ...DEADLY, has_hard: true, hard_rank_percent: 2189, hard_list: [BATTLE] }, CTX)

    expect(view["hasHard"]).toBe(true)
    expect(view["hardRank"]).toBe("21.89%")
    expect(view["rank"]).toBe("23.93%")
    expect((view["hard"] as unknown[]).length).toBe(1)
  })
})

describe("zzzHoloData", () => {
  it("玩法没开或一场没打时判为空", () => {
    expect(zzzHoloState({ unlock: false, list: HOLO.list })).toBe("empty")
    expect(zzzHoloState({ unlock: true, list: [] })).toBe("empty")
    expect(zzzHoloState(HOLO)).toBe("ok")
  })

  it("`challenge_time` 是用时而非时刻 —— 按时刻排版会印出「0026-00-00 00:03:41」", () => {
    const view = zzzHoloData(HOLO, CTX)
    const battles = view["battles"] as { cost: string; time: string }[]

    expect(battles[0]?.cost).toBe("03:41")
    expect(battles[0]?.time).toBe("")
    // 危局那一路反过来：有时刻、没有用时
    const deadly = zzzDeadlyData(DEADLY, CTX)
    const rooms = deadly["rooms"] as { cost: string; time: string }[]
    expect(rooms[0]?.time).toBe("2026-07-29 12:57:29")
    expect(rooms[0]?.cost).toBe("")
  })

  it("总星数、总用时与无伤场数都由逐场加出来 —— 接口没有这三栏", () => {
    const view = zzzHoloData({ ...HOLO, list: [...(HOLO.list ?? []), { star: 2, total_star: 3, challenge_time: { minute: 5, second: 2 } }] }, CTX)

    expect(view["star"]).toBe(5)
    expect(view["cost"]).toBe("08:43")
    expect(view["noInjured"]).toBe(1)
  })
})
describe("逐场排名", () => {
  it("大于一百按放大值处理，否则按百分数 —— 官方在这一项上两种都给过", () => {
    const big = zzzHoloData(HOLO, CTX)
    expect((big["battles"] as { rank: string }[])[0]?.rank).toBe("3.41%")

    const small = zzzHoloData({ ...HOLO, list: [{ ...(HOLO.list?.[0] ?? {}), rank: 3 }] }, CTX)
    expect((small["battles"] as { rank: string }[])[0]?.rank).toBe("3.00%")
  })

  it("没有这一项时不印 —— 危局那一路逐间就不给", () => {
    const view = zzzDeadlyData(DEADLY, CTX)

    expect((view["rooms"] as { rank: string }[])[0]?.rank).toBe("")
  })
})

describe("文字形态", () => {
  it("式舆防卫战：总分、排名与逐层逐间都在", () => {
    const text = zzzDefenseText(DEFENSE, { ...CTX, nameOf: (id): string => (id === "1011" ? "安比" : "") })

    expect(text).toContain("式舆防卫战 150000 分（S+）")
    expect(text).toContain("排名 1.37%")
    expect(text).toContain("总用时 04:05")
    expect(text).toContain("剧变节点第五防线 S+")
    expect(text).toContain("安比（2影）")
  })

  it("一层都没打过时只回一句，不列空表", () => {
    const text = zzzDefenseText({ hadal_ver: "v2", hadal_info_v2: {} }, CTX)

    expect(text).toContain("本期还没有战斗记录")
  })

  it("危局强袭战：逐间带首领与星数，绝境另起一段", () => {
    const text = zzzDeadlyText({ ...DEADLY, has_hard: true, hard_rank_percent: 2189, hard_list: [BATTLE] }, CTX)

    expect(text).toContain("危局强袭战 110998 分 9 星")
    expect(text).toContain("滞变畸兽 45323 分 2/3 星")
    expect(text).toContain("绝境 排名 21.89%")
  })

  it("拟境湮灭战：带用时与无伤", () => {
    const text = zzzHoloText(HOLO, CTX)

    expect(text).toContain("拟境湮灭战 3 星")
    expect(text).toContain("无伤通关 1 场")
    expect(text).toContain("用时 03:41（无伤）")
  })

  it("阵容一个都没有时说明白，不留一行空的", () => {
    const text = zzzHoloText({ unlock: true, list: [{ star: 1, total_star: 3 }] }, CTX)

    expect(text).toContain("无阵容记录")
  })
})
