/**
 * 模块职责：异相仲裁视图模型的测试
 * 依赖方向：测试文件，只依赖 views/sr/peak-challenge（纯函数）与 core/api（核对接口名）
 * 生命周期：无状态
 * 注意事项：固定几处**不报错却让整张图出不来或印错**处：`mobs` 以 `mob_infos` 为准（还没打的
 *          关卡也要列出来）、角色与星格恒为数组（模板对它们取 `.length` 并逐项取值）、奖牌档位是
 *          字符串枚举（认不出时不能给 undefined，模板拿它拼类名）、三种"没有内容"要分得开（形态
 *          变了 / 这一期没打过 / 某一场没打过）。
 */
import { describe, expect, it } from "vitest"
import { apiNames } from "../../core/api.js"
import type { PeakChallengeRaw, PeakRecordView } from "./peak-challenge.js"
import {
  peakChallengeState,
  peakChallengeTemplateData,
  peakChallengeText,
  peakPeriod
} from "./peak-challenge.js"

/** 一份按接口实际形态整理的返回；第二个骑士关刻意没打过 */
const RAW: PeakChallengeRaw = {
  role: { nickname: "其实雨很好", level: 70 },
  challenge_peak_best_record_brief: {
    challenge_peak_rank_icon_type: "ChallengePeakRankIconTypeGold",
    boss_stars: 3,
    mob_stars: 5,
    total_battle_num: 8
  },
  challenge_peak_records: [
    {
      has_challenge_record: true,
      group: { name_mi18n: "财富造物主31", game_version: "3.7", end_time: { year: 2026, month: 8, day: 17, hour: 4 } },
      boss_info: { name_mi18n: "王棋", icon: "https://boss.png" },
      boss_record: {
        has_challenge_record: true,
        hard_mode: true,
        round_num: 12,
        star_num: 3,
        challenge_time: { year: 2026, month: 8, day: 2, hour: 2, minute: 51 },
        buff: { name_mi18n: "裁决", desc_mi18n: "<color=#f29e38ff>伤害</color>提高\\n30%", icon: "https://buff.png" },
        avatars: [
          { id: 1306, name: "花火", level: 80, icon: "https://a.png", rarity: 5, element: "quantum", rank: 2 },
          { id: 8004, name: "开拓者", level: 80, icon: "https://b.png", rarity: 5, element: "lightning" }
        ]
      },
      mob_infos: [
        { name: "骑士其一", icon: "https://m1.png" },
        { name: "骑士其二", icon: "https://m2.png" }
      ],
      mob_records: [
        {
          has_challenge_record: true,
          is_fast: true,
          round_num: 0,
          star_num: 2,
          avatars: [{ id: 1013, level: 80, icon: "https://c.png", rarity: 4, element: "physical" }]
        }
      ]
    }
  ]
}

/** 名字按 id 查，与命令层同一形态 */
const CTX = { uid: "101234567", nameOf: (id: string): string => (id === "8004" ? "星" : "") }

describe("peakChallengeState", () => {
  it("接口名在星铁接口表里 —— 写错的表现是运行时「接口不存在」", () => {
    expect(apiNames("sr")).toContain("challengePeak")
  })

  it("三种没有内容分得开 —— 形态变了 / 这一期没打过 / 有战绩", () => {
    expect(peakChallengeState(RAW)).toBe("ok")
    // 连 challenge_peak_records 都没有：那是形态又变了，不是"没打过"
    expect(peakChallengeState({})).toBe("otherShape")
    expect(peakChallengeState(undefined)).toBe("otherShape")
    expect(peakChallengeState({ challenge_peak_records: [] })).toBe("noData")
    expect(peakChallengeState({ challenge_peak_records: [{ has_challenge_record: false }] })).toBe("noData")
  })

  it("取的是第 0 项 —— 请求里已带期次，返回的头一项就是那一期", () => {
    expect(peakPeriod(RAW)?.group?.name_mi18n).toBe("财富造物主31")
    expect(peakPeriod({})).toBeUndefined()
  })
})

describe("peakChallengeTemplateData", () => {
  it("汇总各项恒有值，奖牌认不出时也给得出类名", () => {
    const view = peakChallengeTemplateData(RAW, CTX)
    expect(view["nickname"]).toBe("其实雨很好")
    expect(view["season"]).toBe("财富造物主31")
    expect(view["version"]).toBe("3.7")
    expect(view["end"]).toBe("08-17 04:00")
    expect(view["medalKey"]).toBe("gold")
    expect(view["medalName"]).toBe("金牌")
    expect(view["bossStars"]).toBe(3)
    expect(view["mobStars"]).toBe(5)
    expect(view["battleNum"]).toBe(8)

    // 认不出的档位退回 none 而不是 undefined —— 纯文字形态拿它判有没有奖牌
    const odd = peakChallengeTemplateData(
      { challenge_peak_best_record_brief: { challenge_peak_rank_icon_type: "什么" } },
      CTX
    )
    expect(odd["medalKey"]).toBe("none")
    expect(odd["medalName"]).toBe("")
  })

  it("首领关打过之后印「将杀王棋·难度」，没打过则印关卡名", () => {
    const boss = peakChallengeTemplateData(RAW, CTX)["boss"] as PeakRecordView & { modeName: string }
    expect(boss.name).toBe("将杀王棋·绝境")
    expect(boss.modeName).toBe("绝境")
    expect(boss.has).toBe(true)
    expect(boss.stars).toEqual([true, true, true])

    const none = peakChallengeTemplateData(
      { challenge_peak_records: [{ boss_info: { name_mi18n: "王棋" } }] },
      CTX
    )["boss"] as PeakRecordView
    expect(none.name).toBe("王棋")
    expect(none.has).toBe(false)
    expect(none.avatars).toEqual([])
    expect(none.stars).toEqual([false, false, false])
  })

  it("骑士关以 mob_infos 为准 —— 还没打的那一关也要列出来", () => {
    const mobs = peakChallengeTemplateData(RAW, CTX)["mobs"] as PeakRecordView[]
    expect(mobs).toHaveLength(2)
    expect(mobs.map(it => it.name)).toEqual(["骑士其一", "骑士其二"])
    expect(mobs[0]?.has).toBe(true)
    expect(mobs[0]?.fast).toBe(true)
    expect(mobs[0]?.stars).toEqual([true, true, false])
    // 第二关没有对应的战绩，各项仍恒有值
    expect(mobs[1]?.has).toBe(false)
    expect(mobs[1]?.avatars).toEqual([])
    expect(mobs[1]?.round).toBe(0)
    expect(mobs[1]?.time).toBe("")
  })

  it("命途键归一 —— 这一族接口给的是 lightning / physical 那一套", () => {
    const boss = peakChallengeTemplateData(RAW, CTX)["boss"] as PeakRecordView
    const mobs = peakChallengeTemplateData(RAW, CTX)["mobs"] as PeakRecordView[]
    expect(boss.avatars[0]?.element).toBe("quantum")
    expect(boss.avatars[1]?.element).toBe("elec")
    expect(mobs[0]?.avatars[0]?.element).toBe("phy")
  })

  it("名字优先取元数据、取不到退回接口给的那个", () => {
    const boss = peakChallengeTemplateData(RAW, CTX)["boss"] as PeakRecordView
    // 8004 是开拓者，元数据里分「穹」「星」，比接口那个「开拓者」准
    expect(boss.avatars[1]?.name).toBe("星")
    // 1306 元数据里查不到，退回接口给的名字
    expect(boss.avatars[0]?.name).toBe("花火")
    // 两处都没有时是空串而不是 undefined
    const bare = peakChallengeTemplateData({ challenge_peak_records: [{ boss_record: { avatars: [{ id: 1 }] } }] }, {
      uid: "1"
    })["boss"] as PeakRecordView
    expect(bare.avatars[0]?.name).toBe("")
  })

  it("祝福说明剥掉富文本标签，一期都没有时也不抛错", () => {
    const boss = peakChallengeTemplateData(RAW, CTX)["boss"] as PeakRecordView
    expect(boss.buffName).toBe("裁决")
    expect(boss.buffDesc).toBe("伤害提高 30%")

    const empty = peakChallengeTemplateData({}, { uid: "1" })
    expect(empty["mobs"]).toEqual([])
    expect((empty["boss"] as PeakRecordView).avatars).toEqual([])
    expect(empty["medalKey"]).toBe("none")
  })
})

describe("peakChallengeText", () => {
  it("奖牌与两块星数排在最前，逐关列出角色", () => {
    const text = peakChallengeText(RAW, CTX)

    expect(text).toContain("UID101234567 异相仲裁 · 财富造物主31")
    expect(text).toContain("金牌")
    expect(text).toContain("王棋 3 星")
    expect(text).toContain("骑士 5 星")
    expect(text).toContain("将杀王棋·绝境")
    expect(text).toContain("花火")
    expect(text).toContain("速通")
    // 没打过的那一关只报一句未通关
    expect(text).toContain("骑士其二")
    expect(text).toContain("未通关")
  })

  it("一期都没有时同样是一段可读文本", () => {
    expect(peakChallengeText({}, { uid: "1" })).toContain("UID1 异相仲裁")
  })
})
