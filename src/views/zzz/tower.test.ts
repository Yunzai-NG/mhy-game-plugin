/**
 * 模块职责：绝区零两类逐关战绩视图的测试
 * 依赖方向：测试文件，只依赖 views/zzz/tower.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：固定三条最容易静默出错的口径：拟真鏖战试炼的前两季与后两季形态不同（层数与徽章一处
 *          在赛季对象上、一处在 `layer_info` 里，按一种读会让另两季整块消失）、临界推演逐关的
 *          `star` 是评级字母而非星数、本期未结束时接口不给 `end_time`。
 */
import { describe, expect, it } from "vitest"
import type { ZzzTowerRaw, ZzzVoidWrapRaw } from "./tower.js"
import {
  zzzTowerData,
  zzzTowerState,
  zzzTowerText,
  zzzVoidData,
  zzzVoidState,
  zzzVoidText
} from "./tower.js"

/** 出图与出文字共用的上下文 */
const CTX = { uid: "1300000001", nickname: "绳匠", period: "本期" }

/** 四个赛季各一种形态 */
const TOWER: ZzzTowerRaw = {
  climbing_tower_s1: { medal_icon: "https://a.invalid/m1.png", climbing_tower_layer: 30 },
  climbing_tower_s2: { medal_icon: "https://a.invalid/m2.png", climbing_tower_layer: 35, floor_mvp_num: 12 },
  climbing_tower_s3: {
    layer_info: { medal_icon: "https://a.invalid/m3.png", climbing_tower_layer: 38, total_score: 96_000 },
    mvp_info: { floor_mvp_num: 15, rank_percent: 1200 }
  },
  climbing_tower_s4: {
    layer_info: { medal_icon: "https://a.invalid/m4.png", climbing_tower_layer: 40, total_score: 128_600 },
    mvp_info: { floor_mvp_num: 18, rank_percent: 89 },
    display_avatar_rank_list: [
      { rarity: "S", icon: "https://a.invalid/r1.png", name: "耀嘉音", score: 44_100, rank_percent: 120 },
      { rarity: "A", icon: "https://a.invalid/r2.png", name: "安比", score: 39_800 },
      { rarity: "S", icon: "https://a.invalid/r3.png", name: "雅", score: 38_000 },
      { rarity: "A", icon: "https://a.invalid/r4.png", name: "可琳", score: 30_000 }
    ]
  }
}
/** 一份能出图的临界推演返回 */
const VOID: ZzzVoidWrapRaw = {
  void_front_battle_detail: {
    void_front_battle_abstract_info_brief: {
      start_time: { year: 2026, month: 8, day: 4 },
      total_score: 92_400,
      max_score: 100_000,
      rank_percent: 512,
      ending_record_name: "最终结局·破晓",
      ending_record_bg_pic: "https://a.invalid/ending.png"
    },
    boss_challenge_record: {
      boss_info: { name: "「白祸」", icon: "https://a.invalid/boss.png" },
      main_challenge_record: {
        name: "LAST STAGE",
        star: "S+",
        score: 30_000,
        max_score: 30_000,
        score_ratio: 1.5,
        challenge_time: { year: 2026, month: 8, day: 9, hour: 21, minute: 2, second: 5 },
        buffer: { name: "勠力", icon: "https://a.invalid/buff.png" },
        avatar_list: [{ id: 1091, level: 60, rank: 1, rarity: "S", role_square_url: "https://a.invalid/1091.png" }],
        sub_challenge_record: [{ name: "4-1", star: "S", buffer: { name: "诡袭" }, avatar_list: [] }]
      }
    },
    main_challenge_record_list: [
      {
        name: "STAGE 04",
        star: "A",
        score: 18_200,
        max_score: 20_000,
        score_ratio: "1.2",
        buffer: { name: "摧心" },
        avatar_list: []
      }
    ]
  }
}

describe("zzzTowerState", () => {
  it("有任一赛季打过就能出图", () => {
    expect(zzzTowerState(TOWER)).toBe("ok")
    // 只有后两季那种形态时同样认得出
    expect(zzzTowerState({ climbing_tower_s3: { layer_info: { climbing_tower_layer: 1 } } })).toBe("ok")
  })

  it("一层都没上过时判为空", () => {
    expect(zzzTowerState(undefined)).toBe("empty")
    expect(zzzTowerState({})).toBe("empty")
    expect(zzzTowerState({ climbing_tower_s1: { climbing_tower_layer: 0 } })).toBe("empty")
  })
})
describe("zzzTowerData", () => {
  it("前两季在顶层、后两季在子对象里，两种都读得出", () => {
    const seasons = zzzTowerData(TOWER, CTX)["seasons"] as
      { name: string; layer: number; score: number; mvp: number; medal: string }[]

    expect(seasons.map(it => it.layer)).toEqual([40, 38, 35, 30])
    // 顶层那两季没有总分这一栏，给 0，模板据此不画
    expect(seasons.map(it => it.score)).toEqual([128_600, 96_000, 0, 0])
    expect(seasons.map(it => it.mvp)).toEqual([18, 15, 12, 0])
    expect(seasons[0]?.medal).toBe("https://a.invalid/m4.png")
    expect(seasons[3]?.medal).toBe("https://a.invalid/m1.png")
  })

  it("赛季由新到旧，名字照官方", () => {
    const seasons = zzzTowerData(TOWER, CTX)["seasons"] as { name: string }[]

    expect(seasons.map(it => it.name)).toEqual([
      "鏖战试炼：狂澜",
      "鏖战试炼：荣耀",
      "鏖战试炼：末路",
      "拟真鏖战试炼"
    ])
  })

  it("没上过的赛季整块不出现", () => {
    const seasons = zzzTowerData({ climbing_tower_s4: TOWER.climbing_tower_s4 }, CTX)["seasons"] as unknown[]

    expect(seasons).toHaveLength(1)
  })

  it("排名只有后两季给", () => {
    const seasons = zzzTowerData(TOWER, CTX)["seasons"] as { rank: string; rankTier: number }[]

    expect(seasons[0]?.rank).toBe("0.89%")
    expect(seasons[0]?.rankTier).toBe(1)
    expect(seasons[1]?.rank).toBe("12.00%")
    expect(seasons[2]?.rank).toBe("")
  })

  it("角色排行只印前三，名字取接口自带的那份", () => {
    const seasons = zzzTowerData(TOWER, CTX)["seasons"] as { avatars: { name: string; rank: string }[] }[]

    expect(seasons[0]?.avatars.map(it => it.name)).toEqual(["耀嘉音", "安比", "雅"])
    expect(seasons[0]?.avatars[0]?.rank).toBe("1.20%")
    // 没有排名的那一位不印，不至于印成"前 0%"
    expect(seasons[0]?.avatars[1]?.rank).toBe("")
    expect(seasons[1]?.avatars).toEqual([])
  })
})
describe("zzzVoidData", () => {
  it("正文包在 void_front_battle_detail 里，缺它即判为空", () => {
    expect(zzzVoidState(VOID)).toBe("ok")
    expect(zzzVoidState({})).toBe("empty")
    expect(zzzVoidState({ void_front_battle_detail: {} })).toBe("empty")
  })

  it("逐关的 star 是评级字母而不是星数，加号在样式名里写作 P", () => {
    const view = zzzVoidData(VOID, CTX)
    const boss = view["boss"] as { stage: { rating: string; ratingClass: string } }
    const stages = view["stages"] as { rating: string; ratingClass: string }[]

    expect(boss.stage.rating).toBe("S+")
    expect(boss.stage.ratingClass).toBe("SP")
    expect(stages[0]?.ratingClass).toBe("A")
  })

  it("本期未结束时接口不给止期，此时印「超过 42 天」", () => {
    expect(zzzVoidData(VOID, CTX)["end"]).toBe("超过 42 天")

    const ended = {
      void_front_battle_detail: {
        ...VOID.void_front_battle_detail,
        void_front_battle_abstract_info_brief: {
          ...VOID.void_front_battle_detail?.void_front_battle_abstract_info_brief,
          end_time: { year: 2026, month: 9, day: 15 }
        }
      }
    }
    expect(zzzVoidData(ended, CTX)["end"]).toBe("2026.09.15")
  })

  it("满分由接口给出，到了才算满", () => {
    const view = zzzVoidData(VOID, CTX)
    const boss = view["boss"] as { stage: { full: boolean } }

    expect(view["full"]).toBe(false)
    expect(view["maxScore"]).toBe(100_000)
    // 首领关 30000/30000，算满
    expect(boss.stage.full).toBe(true)
  })

  it("增益在这一条接口里是一个对象", () => {
    const view = zzzVoidData(VOID, CTX)
    const boss = view["boss"] as { stage: { buff: { name: string; icon: string } } }

    expect(boss.stage.buff.name).toBe("勠力")
    expect(boss.stage.buff.icon).toBe("https://a.invalid/buff.png")
  })

  it("倍率数字与字符串都按字符串印，没有这一项时空串", () => {
    const view = zzzVoidData(VOID, CTX)
    const boss = view["boss"] as { stage: { ratio: string } }
    const stages = view["stages"] as { ratio: string }[]

    expect(boss.stage.ratio).toBe("1.5")
    expect(stages[0]?.ratio).toBe("1.2")
    expect((zzzVoidData({ void_front_battle_detail: { main_challenge_record_list: [{}] } }, CTX)["stages"] as { ratio: string }[])[0]?.ratio).toBe("")
  })

  it("子关卡摊开，缺子关时给空数组", () => {
    const view = zzzVoidData(VOID, CTX)
    const boss = view["boss"] as { stage: { subs: { name: string; rating: string }[] } }
    const stages = view["stages"] as { subs: unknown[] }[]

    expect(boss.stage.subs.map(it => it.name)).toEqual(["4-1"])
    expect(boss.stage.subs[0]?.rating).toBe("S")
    expect(stages[0]?.subs).toEqual([])
  })

  it("没有首领关时不给这一项 —— 模板据此整块不画", () => {
    const view = zzzVoidData({ void_front_battle_detail: { main_challenge_record_list: [{ name: "STAGE 01" }] } }, CTX)

    expect(view["boss"]).toBeUndefined()
  })
})
describe("文字形态", () => {
  it("拟真鏖战试炼：逐赛季一行，缺的那几栏不占位", () => {
    const text = zzzTowerText(TOWER, CTX)

    expect(text).toContain("鏖战试炼：狂澜 第 40 层 · 128600 分 · 无伤 18 层 · 排名 0.89%")
    // 第一赛季只有层数
    expect(text).toContain("拟真鏖战试炼 第 30 层")
  })

  it("一个赛季都没有时只回一句", () => {
    expect(zzzTowerText({}, CTX)).toContain("还没有任何赛季的记录")
  })

  it("临界推演：总分、结局、首领关与逐关都在", () => {
    const text = zzzVoidText(VOID, { ...CTX, nameOf: (id): string => (id === "1091" ? "雅" : "") })

    expect(text).toContain("临界推演 92400 分")
    expect(text).toContain("排名 5.12%")
    expect(text).toContain("结局 最终结局·破晓")
    expect(text).toContain("「白祸」 30000 分 S+")
    expect(text).toContain("雅（1影）")
    expect(text).toContain("STAGE 04 18200 分 A")
  })

  it("一关都没打过时只回一句", () => {
    expect(zzzVoidText({ void_front_battle_detail: {} }, CTX)).toContain("本期还没有战斗记录")
  })

  it("阵容一个都没有时说明白", () => {
    const text = zzzVoidText(VOID, CTX)

    expect(text).toContain("无阵容记录")
  })
})
