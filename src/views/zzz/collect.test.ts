/**
 * 模块职责：绝区零三类进度视图的测试
 * 依赖方向：测试文件，只依赖 views/zzz/collect.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：固定三条最容易静默出错的口径：收集项的名称按位置对应（接口只给数字，位置一错标签
 *          整排移位；接口多给一项时按「其他 N」列出而不丢掉）、枯萎苗圃的通关阵容来自另一条接口
 *          （没打过时那一段整块不出现）、菲林月报的月份写法是 `YYYYMM` 且只留最近三个月。
 */
import { describe, expect, it } from "vitest"
import type { ZzzGardenRaw, ZzzLostRaw } from "./collect.js"
import {
  zzzExploreData,
  zzzExploreState,
  zzzExploreText,
  zzzGardenData,
  zzzGardenState,
  zzzHollowText,
  zzzLedgerData,
  zzzLedgerMonth,
  zzzLedgerState,
  zzzLedgerText,
  zzzLostData,
  zzzLostState,
  zzzMonth
} from "./collect.js"

/** 出图与出文字共用的上下文 */
const CTX = { uid: "1300000001", nickname: "绳匠" }

/** 一份能出图的枯萎苗圃概要 */
const GARDEN: ZzzGardenRaw = {
  abyss_level: { cur_level: 60, max_level: 60, icon: "https://a.invalid/lv.png" },
  abyss_talent: { cur_talent: 28, max_talent: 30 },
  abyss_collect: [
    { cur_collect: 40, max_collect: 40 },
    { cur_collect: 12, max_collect: 20 },
    { cur_collect: 5, max_collect: 8 },
    { cur_collect: 3, max_collect: 9 },
    { cur_collect: 1, max_collect: 4 }
  ],
  abyss_throne: { max_damage: 1_284_000 }
}
/** 一份能出图的迷失之地返回 */
const LOST: ZzzLostRaw = {
  abyss_level: { cur_level: 55, max_level: 60 },
  abyss_duty: { cur_duty: 8, max_duty: 10 },
  abyss_task: { cur_task: 3, max_task: 6 },
  abyss_collect: [1, 2, 3, 4, 5, 6, 7].map(n => ({ cur_collect: n, max_collect: n + 2 })),
  abyss_max: { max_name: "以太失序·III", heat_count: 320, max_count: 4, best_time: 1265 },
  abyss_task_force_investigation_max: { max_name: "特遣·II", heat_count: 180, max_count: 2, best_time: 940 }
}

describe("零号空洞", () => {
  it("有执照等级或收集进度即可出图", () => {
    expect(zzzGardenState(GARDEN)).toBe("ok")
    expect(zzzLostState(LOST)).toBe("ok")
    expect(zzzGardenState(undefined)).toBe("empty")
    expect(zzzLostState({})).toBe("empty")
  })

  it("收集项的名称按位置对应，枯萎苗圃五项", () => {
    const rows = zzzGardenData(GARDEN, undefined, CTX)["collects"] as { name: string; cur: number; full: boolean }[]

    expect(rows.map(it => it.name)).toEqual(["鸣徽图鉴", "特殊区域记录", "哨站课题", "异域模块", "战术棱镜方案"])
    expect(rows[0]?.full).toBe(true)
    expect(rows[1]?.full).toBe(false)
  })

  it("迷失之地七项，名称是另一套", () => {
    const rows = zzzLostData(LOST, CTX)["collects"] as { name: string }[]

    expect(rows.map(it => it.name)).toEqual([
      "探究勋证",
      "武备图鉴",
      "战术档案",
      "异域模块",
      "战术棱镜方案",
      "零号碎片",
      "空洞异闻"
    ])
  })

  it("接口多给一项时按「其他 N」列出，不丢掉 —— 玩法更新时那一项才是新增的", () => {
    const more = { ...GARDEN, abyss_collect: [...(GARDEN.abyss_collect ?? []), { cur_collect: 2, max_collect: 6 }] }
    const rows = zzzGardenData(more, undefined, CTX)["collects"] as { name: string }[]

    expect(rows).toHaveLength(6)
    expect(rows[5]?.name).toBe("其他 6")
  })
})
describe("刀耕火焚那一段", () => {
  it("明细取不到时整块不出现 —— 它来自另一条接口", () => {
    expect(zzzGardenData(GARDEN, undefined, CTX)["throne"]).toBeUndefined()
  })

  it("取到时带耗时、伤害与阵容，角色多一栏伤害占比", () => {
    const view = zzzGardenData(
      GARDEN,
      {
        abyss_throne_max: {
          time: 3725,
          max_damage: 1_284_000,
          avatar_list: [{ id: 1091, level: 60, rarity: "S", role_square_url: "https://a.png", damage_rate: 62 }],
          buddy_list: [{ id: 54_010, level: 60, rarity: "S", bangboo_rectangle_url: "https://b.png" }]
        }
      },
      { ...CTX, nameOf: (id): string => (id === "1091" ? "雅" : "") }
    )
    const throne = view["throne"] as {
      cost: string
      damage: number
      avatars: { name: string; rate: number }[]
      buddy?: { id: string }
    }

    // 超过一小时，故给出 h:mm:ss
    expect(throne.cost).toBe("1:02:05")
    expect(throne.damage).toBe(1_284_000)
    expect(throne.avatars[0]?.name).toBe("雅")
    expect(throne.avatars[0]?.rate).toBe(62)
    // 邦布在 buddy_list 里，是数组
    expect(throne.buddy?.id).toBe("54010")
  })

  it("三档挑战里接口没给的那一档不出现 —— 印一排「0 次」看着像刚清过档", () => {
    const modes = zzzLostData(LOST, CTX)["modes"] as { name: string; cost: string }[]

    expect(modes.map(it => it.name)).toEqual(["矩阵行动", "特遣调查"])
    expect(modes[0]?.cost).toBe("21:05")
  })
})

describe("区域收集", () => {
  it("没有区域列表时判为空", () => {
    expect(zzzExploreState(undefined)).toBe("empty")
    expect(zzzExploreState({ area_collections: [] })).toBe("empty")
  })

  it("区域套子区域套逐项，满了的那一项另标", () => {
    const raw = {
      area_collections: [
        {
          name: "六分街",
          collection_progress: 82,
          map_collections: [
            {
              name: "第六街",
              icon: "https://a.png",
              collection_progress: 90,
              collections: [
                { name: "录像带", num: 9, total: 9 },
                { name: "拾物", num: 4, total: 7 }
              ]
            }
          ]
        }
      ]
    }
    const areas = zzzExploreData(raw, CTX)["areas"] as
      { name: string; progress: number; maps: { items: { full: boolean }[] }[] }[]

    expect(zzzExploreState(raw)).toBe("ok")
    expect(areas[0]?.progress).toBe(82)
    expect(areas[0]?.maps[0]?.items.map(it => it.full)).toEqual([true, false])
    expect(zzzExploreText(raw, CTX)).toContain("六分街 82%")
  })

  it("大区给 0 而子区有进度时不印大区百分比 —— 否则读成「大区 0%、子区 30%」", () => {
    const raw = {
      area_collections: [
        { name: "莱姆尼安空洞", collection_progress: 0, map_collections: [{ name: "青溟秘境", collection_progress: 30 }] },
        { name: "卫非地", collection_progress: 0, map_collections: [{ name: "澄辉坪", collection_progress: 0 }] }
      ]
    }
    const areas = zzzExploreData(raw, CTX)["areas"] as { hasProgress: boolean }[]

    expect(areas.map(it => it.hasProgress)).toEqual([false, true])
    const text = zzzExploreText(raw, CTX)
    expect(text).not.toContain("莱姆尼安空洞 0%")
    expect(text).toContain("卫非地 0%")
  })
})
describe("zzzLedgerMonth", () => {
  /** 2026 年 1 月 20 日，好让"上个月跨年"落在这一侧 */
  const JAN = new Date(2026, 0, 20)

  it("什么都不写即当月，且不带 month 参数", () => {
    expect(zzzLedgerMonth("", JAN)).toEqual({ ok: true, param: "", label: "2026 年 1 月" })
  })

  it("「上月」跨年时年份跟着减一", () => {
    expect(zzzLedgerMonth("上月", JAN)).toEqual({ ok: true, param: "202512", label: "2025 年 12 月" })
    expect(zzzLedgerMonth("上个月", new Date(2026, 4, 3))).toEqual({ ok: true, param: "202604", label: "2026 年 4 月" })
  })

  it("只写月份时按「不晚于当月」推 —— 一月里问「12月」问的是去年那个", () => {
    expect(zzzLedgerMonth("12月", JAN)).toEqual({ ok: true, param: "202512", label: "2025 年 12 月" })
    expect(zzzLedgerMonth("1月", JAN)).toEqual({ ok: true, param: "202601", label: "2026 年 1 月" })
  })

  it("写全年月也认", () => {
    expect(zzzLedgerMonth("2025年11月", JAN)).toEqual({ ok: true, param: "202511", label: "2025 年 11 月" })
  })

  it("超出三个月直接回一句 —— 接口只留三个月，硬发一次换回空数据无从区分", () => {
    const got = zzzLedgerMonth("2025年10月", JAN)

    expect(got.ok).toBe(false)
    expect(got.message).toContain("最近 3 个月")
  })

  it("还没到的月份与不合法的月份都拦下来", () => {
    expect(zzzLedgerMonth("2026年5月", JAN).ok).toBe(false)
    expect(zzzLedgerMonth("13月", JAN).ok).toBe(false)
  })
})
describe("菲林月报", () => {
  /** 一份照真实返回造的月报 */
  const LEDGER = {
    current_month: "202601",
    data_month: "202512",
    optional_month: ["202601", "202512", "202511"],
    month_data: {
      list: [
        { data_type: "PolychromesData", count: 5199, data_name: "菲林" },
        { data_type: "BooponsData", count: 22, data_name: "邦布券" }
      ],
      income_components: [
        { action: "daily_activity_rewards", num: 1780, percent: 34 },
        { action: "unknown_rewards", num: 60, percent: 1 }
      ]
    },
    role_info: { nickname: "其实雨很好", avatar: "https://a.png" }
  }

  it("没有当月数据时判为空", () => {
    expect(zzzLedgerState(undefined)).toBe("empty")
    expect(zzzLedgerState({ month_data: { list: [] } })).toBe("empty")
    expect(zzzLedgerState(LEDGER)).toBe("ok")
  })

  it("月份排成可读形态", () => {
    expect(zzzMonth("202601")).toBe("2026 年 1 月")
    // 形态不对时原样返回，不编一个
    expect(zzzMonth("abc")).toBe("abc")
    expect(zzzMonth(undefined)).toBe("")
  })

  it("货币名取接口自带的中文，来源代码换成中文", () => {
    const view = zzzLedgerData(LEDGER, CTX)
    const list = view["list"] as { name: string; count: number }[]
    const sources = view["sources"] as { name: string; num: number }[]

    expect(list.map(it => it.name)).toEqual(["菲林", "邦布券"])
    expect(sources[0]?.name).toBe("日常活跃奖励")
    // 表里没有的代码按「其他奖励」印，不留一个空名字
    expect(sources[1]?.name).toBe("其他奖励")
  })

  it("昵称与头像取接口自带的那份，并认出查的不是当月", () => {
    const view = zzzLedgerData(LEDGER, CTX)

    expect(view["nickname"]).toBe("其实雨很好")
    expect(view["avatar"]).toBe("https://a.png")
    expect(view["month"]).toBe("2025 年 12 月")
    expect(view["isCurrent"]).toBe(false)
    expect(view["months"]).toEqual(["2026 年 1 月", "2025 年 12 月", "2025 年 11 月"])
  })

  it("文字形态带三种货币与来源占比", () => {
    const text = zzzLedgerText(LEDGER, CTX)

    expect(text).toContain("2025 年 12 月菲林月报")
    expect(text).toContain("菲林 5199")
    expect(text).toContain("日常活跃奖励 1780（34%）")
  })
})

describe("零号空洞的文字形态", () => {
  it("枯萎苗圃：执照、收集与刀耕火焚都在", () => {
    const view = zzzGardenData(GARDEN, { abyss_throne_max: { time: 600, max_damage: 900 } }, CTX)
    const text = zzzHollowText(view)

    expect(text).toContain("执照 60/60 级")
    expect(text).toContain("鸣徽图鉴 40/40")
    expect(text).toContain("刀耕火焚 伤害 900 耗时 10:00")
  })

  it("迷失之地：三档挑战各一行", () => {
    const text = zzzHollowText(zzzLostData(LOST, CTX))

    expect(text).toContain("矩阵行动 以太失序·III × 4 最短 21:05")
    expect(text).toContain("空洞异闻 7/9")
  })
})
