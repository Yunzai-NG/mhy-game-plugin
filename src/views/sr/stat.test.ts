/**
 * 模块职责：星铁战绩既有版式那几份数据的测试
 * 依赖方向：测试文件，只依赖 views/sr/stat.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：钉住四件"错了不报错、只是图上少一块"的事：命途图标的两处拼错（`elm-ice` /
 *          `elem-auantum` 是元数据里的真实文件名，改"对"了图标就没了）、空节点要占位而不是被丢掉
 *          （丢掉会把只打了第一与第三个节点时的第三个印成「节点2」）、星格是有几颗画几颗（给长度
 *          等于星数的数组）、奖牌编号不按高低排（1 铜、2 金、3 银、4 Ultra）。
 */
import { describe, expect, it } from "vitest"
import type { BuiltPanel } from "../../panel/build.js"
import { peakChallengeStatData, srChallengeStatData, srElemIcon, srStatAvatars } from "./stat.js"

/** 一份最简面板，两处 describe 共用 */
const panel = {
  id: "1306",
  name: "花火",
  abbr: "花火",
  star: 5,
  level: 80,
  cons: 2,
  talent: { a: 6, e: 10, q: 10, t: 10, z: 1 },
  sets: { 云无留迹的过客: 4, 停转的萨尔索图: 1 },
  weapon: { img: "meta-sr/weapon/以世界之名/icon.webp", star: 5, affix: 3 }
} as unknown as BuiltPanel

describe("srElemIcon", () => {
  it("两处拼错是元数据里的真实文件名，不可修正", () => {
    expect(srElemIcon("ice")).toBe("meta-sr/public/icons/elm-ice.webp")
    expect(srElemIcon("quantum")).toBe("meta-sr/public/icons/elem-auantum.webp")
  })

  it("两套写法都收 —— 战绩接口给 lightning / physical，面板一路给 elec / phy", () => {
    expect(srElemIcon("lightning")).toBe(srElemIcon("elec"))
    expect(srElemIcon("physical")).toBe(srElemIcon("phy"))
  })

  it("不认得的命途给空串，模板据此不画那一枚角标", () => {
    expect(srElemIcon("")).toBe("")
    expect(srElemIcon("wood")).toBe("")
  })
})

describe("srStatAvatars", () => {
  it("天赋带上各自的满级 —— 模板据此把满级那一格标出来", () => {
    const got = srStatAvatars([panel], "sr")["1306"]

    expect(got?.talent["a"]).toEqual({ level: 6, max: 7 })
    expect(got?.talent["e"]).toEqual({ level: 10, max: 12 })
    expect(got?.talentCount).toBe(5)
  })

  it("只有凑够两件的套装才算一套", () => {
    expect(srStatAvatars([panel], "sr")["1306"]?.artisSet?.imgs).toEqual([
      "meta-sr/artifact/云无留迹的过客/arti-1.webp"
    ])
  })

  it("位面饰品没有第 1 部位，按 exists 回落到第 5", () => {
    const only = { ...panel, sets: { 繁星竞技场: 2 } } as unknown as BuiltPanel
    const imgs = srStatAvatars([only], "sr", rel => rel.endsWith("arti-5.webp"))["1306"]?.artisSet?.imgs

    expect(imgs).toEqual(["meta-sr/artifact/繁星竞技场/arti-5.webp"])
  })
})

describe("srChallengeStatData", () => {
  /** 一份三关的返回：第一关速通、第二关只有第一与第三个节点 */
  const RAW = {
    has_data: true,
    star_num: 9,
    extra_star_num: 1,
    battle_num: 12,
    max_floor: "第 4 层",
    groups: [{ name_mi18n: "第 20 期" }, { name_mi18n: "第 19 期" }],
    all_floor_detail: [
      { name: "第 1 层", star_num: 3, round_num: 4, is_fast: true, node_1: { score: 100, avatars: [{ id: 1306 }] } },
      {
        name: "第 2 层",
        star_num: 4,
        extra_star_num: 1,
        node_1: { score: 3575, avatars: [{ id: 1306, element: "quantum" }] },
        node_3: { score: 311, avatars: [{ id: 1013 }] }
      }
    ]
  }

  it("空节点占位而不是被丢掉 —— 丢掉会把第三个节点印成「节点2」", () => {
    const story = srChallengeStatData(RAW, { kind: "story", uid: "1" })["story"] as {
      floors: { nodes: { avatars: unknown[] }[] }[]
    }

    expect(story.floors[1]?.nodes).toHaveLength(3)
    expect(story.floors[1]?.nodes[1]?.avatars).toEqual([])
    expect(story.floors[1]?.nodes[2]?.avatars).toHaveLength(1)
  })

  it("星格摊成数组，额外星另摊一份 —— 不减额外星则实得 4 星画出四颗", () => {
    const story = srChallengeStatData(RAW, { kind: "story", uid: "1" })["story"] as {
      floors: { starList: number[]; extraStarList: number[] }[]
    }

    expect(story.floors[1]?.starList).toHaveLength(3)
    expect(story.floors[1]?.extraStarList).toHaveLength(1)
  })

  it("关名末尾的「常规模式 / 星启模式」拆成单独一标，星启那档标为高难；没有后缀的原样", () => {
    const named = (name: string): unknown =>
      (srChallengeStatData({ ...RAW, all_floor_detail: [{ ...RAW.all_floor_detail[1], name }] }, { kind: "boss", uid: "1" })[
        "story"
      ] as { floors: unknown[] }).floors[0]

    expect(named("支配遗忘·难度04星启模式")).toMatchObject({ name: "支配遗忘·难度04", mode: "星启模式", hard: true })
    expect(named("支配遗忘·难度04常规模式")).toMatchObject({ name: "支配遗忘·难度04", mode: "常规模式", hard: false })
    expect(named("取象为文其三")).toMatchObject({ name: "取象为文其三", mode: "", hard: false })
  })

  it("虚构叙事速通的那一关既不计分也不记轮次", () => {
    const story = srChallengeStatData(RAW, { kind: "story", uid: "1" })["story"] as {
      floors: { score: number; roundNum: number }[]
    }

    expect(story.floors[0]?.score).toBe(0)
    expect(story.floors[0]?.roundNum).toBe(0)
  })

  it("混沌回忆排掉速通关，末日幻影不排", () => {
    const memory = srChallengeStatData(RAW, { kind: "memory", uid: "1" })["story"] as { floors: { name: string }[] }
    const boss = srChallengeStatData(RAW, { kind: "boss", uid: "1" })["story"] as { floors: { name: string }[] }

    expect(memory.floors.map(one => one.name)).toEqual(["第 2 层"])
    expect(boss.floors.map(one => one.name)).toEqual(["第 1 层", "第 2 层"])
  })

  it("上期取 groups 的第 1 项，且 type 随之变 2", () => {
    const got = srChallengeStatData(RAW, { kind: "story", uid: "1", prev: true })

    expect((got["story"] as { season: string }).season).toBe("第 19 期")
    expect(got["type"]).toBe(2)
  })

  it("面板库为空时置 mysFailed —— 模板据此整块不画天赋与装备", () => {
    expect(srChallengeStatData(RAW, { kind: "story", uid: "1" })["mysFailed"]).toBe(true)
    const withPanel = srChallengeStatData(RAW, {
      kind: "story",
      uid: "1",
      avatars: srStatAvatars([panel], "sr")
    })
    expect(withPanel["mysFailed"]).toBe(false)
  })
})

describe("peakChallengeStatData", () => {
  /** 一份带一场王棋与两个骑士关的返回，第二关没有对应战绩 */
  const RAW = {
    role: { nickname: "其实雨很好" },
    challenge_peak_best_record_brief: {
      challenge_peak_rank_icon_type: "ChallengePeakRankIconTypeGold",
      boss_stars: 3,
      mob_stars: 5,
      total_battle_num: 8
    },
    challenge_peak_records: [
      {
        has_challenge_record: true,
        group: { name_mi18n: "财富造物主31", game_version: "3.7" },
        boss_info: { name_mi18n: "王棋", icon: "https://a.png" },
        boss_record: { has_challenge_record: true, hard_mode: true, round_num: 12, star_num: 2, avatars: [{ id: 1306 }] },
        mob_infos: [{ name: "骑士其一" }, { name: "骑士其二" }],
        mob_records: [{ has_challenge_record: true, star_num: 3, avatars: [{ id: 1013 }] }]
      }
    ]
  }

  it("奖牌编号不按高低排 —— 金牌是第 2 档", () => {
    expect(peakChallengeStatData(RAW, { uid: "1" })["iconType"]).toBe(2)
  })

  it("不认得的奖牌名退回第 0 档，而不是 -1（那会拼出一个不存在的文件名）", () => {
    const raw = { ...RAW, challenge_peak_best_record_brief: { challenge_peak_rank_icon_type: "新档位" } }

    expect(peakChallengeStatData(raw, { uid: "1" })["iconType"]).toBe(0)
  })

  it("星格与未得的格子各摊一份，上限三格", () => {
    const boss = peakChallengeStatData(RAW, { uid: "1" })["boss"] as { starList: number[]; failList: number[] }

    expect(boss.starList).toHaveLength(2)
    expect(boss.failList).toHaveLength(1)
  })

  it("骑士关卡以 mob_infos 为准 —— 以战绩为准会让没打的那一关整个不出现", () => {
    const mobs = peakChallengeStatData(RAW, { uid: "1" })["mobs"] as { name: string; record: { done: boolean } }[]

    expect(mobs.map(one => one.name)).toEqual(["骑士其一", "骑士其二"])
    expect(mobs[1]?.record.done).toBe(false)
  })

  it("昵称取接口自带的那一个 —— 这一族接口给昵称，忘却之庭那三条不给", () => {
    expect(peakChallengeStatData(RAW, { uid: "1", nickname: "别的名字" })["nickname"]).toBe("其实雨很好")
  })
})
