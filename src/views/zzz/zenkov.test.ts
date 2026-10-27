/**
 * 模块职责：绝区零迷宫诡域视图的测试
 * 依赖方向：测试文件，只依赖 views/zzz/zenkov.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：固定四条静默出错的口径：`max_rank` 有两种口径（`is_show_percent` 决定它是百分数还是
 *          名次，取错不报错、只是那一格数字毫无意义）、`leave_percent` 是放大一百倍的整数、这一族
 *          的用时可能带小时（漏折小时会把一小时零三分印成三分）、认不出的难度原样印。
 */
import { describe, expect, it } from "vitest"
import type { ZzzZenkovRaw } from "./zenkov.js"
import { zenkovDays, zenkovDaysHours, zenkovPercent, zenkovRank, zzzZenkovData, zzzZenkovDetailData, zzzZenkovState, zzzZenkovText } from "./zenkov.js"

/** 出图与出文字共用的上下文 */
const CTX = { uid: "1300000001", nickname: "绳匠" }

/** 一份能出图的概要返回 */
const BRIEF: ZzzZenkovRaw = {
  refresh_time: 226_800,
  season_data: { name: "诡域行动·首季", level: 12, refresh_time: 1_209_600 },
  max_rank: 512,
  is_show_percent: true,
  total_enter_num: 26,
  total_leave_num: 19,
  total_material_value: 1_284_000,
  map_list: [
    { name: "废弃工厂", icon: "https://a.invalid/m1.png", enter_num: 14, leave_num: 11, leave_percent: 7857 },
    { name: "旧都会", icon: "https://a.invalid/m2.png", enter_num: 12, leave_num: 8, leave_percent: 6667 }
  ]
}

/** 概要之上再带逐场战绩 */
const DETAIL: ZzzZenkovRaw = {
  ...BRIEF,
  record_list: [
    {
      map_name: "废弃工厂",
      difficult: "Hell",
      start_time: { year: 2026, month: 9, day: 2, hour: 21, minute: 4, second: 8 },
      // 刻意带小时：漏折会把一小时零三分印成三分
      challenge_time: { hour: 1, minute: 3, second: 12 },
      is_leave: true,
      material_total_value: 486_200,
      item_list: [
        { name: "以太结晶", icon: "https://a.invalid/i1.png", rarity: 5, num: 3 },
        { name: "废弃零件", icon: "https://a.invalid/i2.png", rarity: 2, num: 12 }
      ]
    },
    {
      map_name: "旧都会",
      // 认不出的难度：原样印，不编中文名
      difficult: "Nightmare",
      challenge_time: { minute: 8, second: 5 },
      is_leave: false,
      material_total_value: 0,
      item_list: []
    }
  ]
}

describe("zzzZenkovState", () => {
  it("有地图记录即可出图", () => {
    expect(zzzZenkovState(BRIEF)).toBe("ok")
  })

  it("一次都没进过时不出图 —— 一张全是零的图看着像坏了", () => {
    expect(zzzZenkovState({ map_list: [{ name: "废弃工厂", enter_num: 0 }] })).toBe("empty")
    expect(zzzZenkovState(undefined)).toBe("empty")
  })

  it("只有逐场战绩、地图列表为空时仍出图", () => {
    expect(zzzZenkovState({ record_list: [{ map_name: "废弃工厂" }] })).toBe("ok")
  })
})

describe("zenkovRank 的两种口径", () => {
  it("is_show_percent 为真时按百分数排版并分档", () => {
    const got = zenkovRank({ max_rank: 512, is_show_percent: true })
    expect(got.text).toBe("5.12%")
    // 5.12% 落在"小于 10%"那一档
    expect(got.tier).toBe(3)
  })

  it("为假时那就是名次本身，不当百分数算", () => {
    // 按百分数算会印成 0.26%，与"第 26 名"含义完全不同
    expect(zenkovRank({ max_rank: 26, is_show_percent: false }).text).toBe("TOP 26")
  })

  it("没有排名时给一个横杠，且落到最后一档", () => {
    const got = zenkovRank({})
    expect(got.text).toBe("-")
    expect(got.tier).toBe(5)
  })
})

describe("排版函数", () => {
  it("撤离率是放大一百倍的整数", () => {
    expect(zenkovPercent(7857)).toBe("78.57%")
    // 整数百分比不留小数位
    expect(zenkovPercent(5000)).toBe("50%")
    expect(zenkovPercent(undefined)).toBe("0%")
  })

  it("周刷新排成天与时，赛季刷新只排到天", () => {
    // 226800 秒 = 2 天 15 小时
    expect(zenkovDaysHours(226_800)).toBe("02天15时")
    expect(zenkovDays(1_209_600)).toBe("14天")
  })
})

describe("zzzZenkovData 概要", () => {
  it("统计量与逐地图撤离率都在", () => {
    const view = zzzZenkovData(BRIEF, CTX)
    expect(view["enter"]).toBe(26)
    expect(view["leave"]).toBe(19)
    // 带出价值加千分位，否则一长串数字读不出量级
    expect(view["value"]).toBe("1,284,000")
    expect(view["rank"]).toBe("5.12%")
    const maps = view["maps"] as { name: string; percent: string }[]
    expect(maps).toHaveLength(2)
    expect(maps[0]?.percent).toBe("78.57%")
  })

  it("没有逐场战绩这一段时概要照常出", () => {
    const view = zzzZenkovData(BRIEF, CTX)
    expect(view["records"]).toBeUndefined()
  })
})

describe("zzzZenkovDetailData 逐场战绩", () => {
  it("用时把小时一并折进去", () => {
    const view = zzzZenkovDetailData(DETAIL, CTX)
    const records = view["records"] as { cost: string }[]
    // 漏折小时会得到 03:12
    expect(records[0]?.cost).toBe("1:03:12")
    expect(records[1]?.cost).toBe("08:05")
  })

  it("难度认得的换中文，认不出的原样印", () => {
    const records = zzzZenkovDetailData(DETAIL, CTX)["records"] as { difficulty: string }[]
    expect(records[0]?.difficulty).toBe("高危")
    expect(records[1]?.difficulty).toBe("Nightmare")
  })

  it("撤离与未撤离分得开", () => {
    const records = zzzZenkovDetailData(DETAIL, CTX)["records"] as { leave: boolean }[]
    expect(records[0]?.leave).toBe(true)
    expect(records[1]?.leave).toBe(false)
  })

  it("物资的稀有度只有三档有底色，其余不画底", () => {
    const records = zzzZenkovDetailData(DETAIL, CTX)["records"] as { items: { rarity: string }[] }[]
    expect(records[0]?.items[0]?.rarity).toBe("5")
    // 2 级不在 3/4/5 里，给空串让模板不画底
    expect(records[0]?.items[1]?.rarity).toBe("")
  })
})

describe("文字回退", () => {
  it("概要形态：统计量与逐地图都在，不含逐场", () => {
    const text = zzzZenkovText(BRIEF, CTX)
    expect(text).toContain("进入 26 次")
    expect(text).toContain("废弃工厂 进入 14 次")
    expect(text).not.toContain("撤离成功")
  })

  it("战绩形态：逐场列出难度、用时与撤离与否", () => {
    const text = zzzZenkovText(DETAIL, CTX, true)
    expect(text).toContain("高危")
    expect(text).toContain("1:03:12")
    expect(text).toContain("撤离成功")
    expect(text).toContain("未撤离")
  })

  it("空数据不炸", () => {
    expect(() => zzzZenkovText(undefined, CTX)).not.toThrow()
    expect(() => zzzZenkovText(undefined, CTX, true)).not.toThrow()
  })
})
