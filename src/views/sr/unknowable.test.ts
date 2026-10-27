/**
 * 模块职责：不可知域视图的测试
 * 依赖方向：测试文件，只依赖 views/sr/unknowable（纯函数）
 * 生命周期：无状态
 * 注意事项：钉住三处**不报错、只是图不对**的事：不能按数组长度判有没有内容（`custom_record_list`
 *          恒有六条预设难度，从没打过的账号各项全是 0，按长度判会出一张全零的图）、三项进度接口给
 *          的已带百分号（再补一个会印出 `0%%`）、演算倾向可能是 null（不是缺字段，直接取 `.name`
 *          会抛）。
 */
import { describe, expect, it } from "vitest"
import type { RogueMagicRaw } from "./unknowable.js"
import { magicTime, rogueMagicData, rogueMagicState, rogueMagicText } from "./unknowable.js"

/** 上下文 */
const CTX = { uid: "101234567" }

/** 真机上取到的那一份：六条自定义记录全没打过 */
const EMPTY: RogueMagicRaw = {
  role: { nickname: "其实雨很好", level: 70 },
  basic_info: {
    linear_tree_num: "0%",
    magic_compendium: "0%",
    discover_secrets: "0%",
    challenge_task_total_num: 25,
    challenge_task_current_num: 0,
    magic_record: {
      name: "",
      id: 0,
      schedule_current_floor_num: 0,
      schedule_total_floor_num: 0,
      completed_time: null,
      calculation_tendency: null,
      avatar_list: [],
      magic_list: [],
      miracle_list: []
    }
  },
  normal_record_list: [],
  custom_record_list: [
    { name: "记住他们", id: 806, completed_time: { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 } },
    { name: "熄灭火焰", id: 805, completed_time: { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 } }
  ]
}

/** 一份打过的 */
const PLAYED: RogueMagicRaw = {
  role: { nickname: "其实雨很好", level: 70 },
  basic_info: {
    linear_tree_num: "42%",
    magic_compendium: "18%",
    discover_secrets: "7%",
    challenge_task_total_num: 25,
    challenge_task_current_num: 25
  },
  normal_record_list: [
    {
      name: "记住他们",
      id: 806,
      level: 4,
      schedule_current_floor_num: 8,
      schedule_total_floor_num: 8,
      additional_problems_num: 2,
      additional_rounds: 3,
      exist_additional_rounds: true,
      completed_time: { year: 2026, month: 9, day: 11, hour: 22, minute: 5, second: 30 },
      calculation_tendency: { display_id: 1, name: "均衡", icon: "https://a.invalid/t.png" },
      avatar_list: [{ id: 1306, level: 80, rarity: 5, icon: "https://a.invalid/a.png" }],
      magic_list: [{ id: 11, name: "「造物」", rank: 3, icon: "https://a.invalid/m.png" }],
      miracle_list: [{ id: 21, name: "「奇物」", rank: 2, icon: "https://a.invalid/k.png" }]
    }
  ],
  // 这一条没打过，不该出现在图上
  custom_record_list: [{ name: "熄灭火焰", id: 805, completed_time: { year: 0, month: 0, day: 0 } }]
}

describe("magicTime", () => {
  it("六个字段全零即视为没有时刻 —— 那是「没打过」，不是 0 年 0 月", () => {
    expect(magicTime({ year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 })).toBe("")
    expect(magicTime(null)).toBe("")
    expect(magicTime(undefined)).toBe("")
  })

  it("有年份时排到分钟", () => {
    expect(magicTime({ year: 2026, month: 9, day: 11, hour: 22, minute: 5 })).toBe("2026-09-11 22:05")
  })
})

describe("rogueMagicState", () => {
  it("**六条全没打过时是 noData** —— 按数组长度判会出一张全零的图", () => {
    // 这一份是真机返回：custom_record_list 有两条，但都没有完成时刻
    expect(EMPTY.custom_record_list).toHaveLength(2)
    expect(rogueMagicState(EMPTY)).toBe("noData")
  })

  it("有一条带完成时刻即有内容", () => {
    expect(rogueMagicState(PLAYED)).toBe("ok")
  })

  it("当期正在打（有层数）也算有内容 —— 那时还没有完成时刻", () => {
    const during: RogueMagicRaw = {
      ...EMPTY,
      basic_info: { ...EMPTY.basic_info, magic_record: { schedule_current_floor_num: 3, schedule_total_floor_num: 8 } }
    }
    expect(rogueMagicState(during)).toBe("ok")
  })

  it("整份都没有时按 noData，不抛", () => {
    expect(rogueMagicState(undefined)).toBe("noData")
  })
})

describe("rogueMagicData", () => {
  it("**三项进度原样透传** —— 接口给的已经带百分号，再补一个会印出 0%%", () => {
    const progress = rogueMagicData(PLAYED, CTX)["progress"] as Record<string, string>

    expect(progress["tree"]).toBe("42%")
    expect(progress["compendium"]).toBe("18%")
    expect(progress["secrets"]).toBe("7%")
  })

  it("挑战任务满了要标出来", () => {
    expect(rogueMagicData(PLAYED, CTX)["task"]).toEqual({ cur: 25, max: 25, full: true })
  })

  it("**只留打过的**：没有完成时刻的那几条不进图", () => {
    const groups = rogueMagicData(PLAYED, CTX)["groups"] as { name: string; list: unknown[] }[]

    // 庸众集那族只有一条且没打过，故整组不出现
    expect(groups).toHaveLength(1)
    expect(groups[0]?.name).toBe("分形档案")
    expect(groups[0]?.list).toHaveLength(1)
  })

  it("全没打过时一组都不给 —— 模板据此整块隐藏", () => {
    expect(rogueMagicData(EMPTY, CTX)["groups"]).toEqual([])
  })

  it("**演算倾向是 null 时不抛**，退回空串", () => {
    const data = rogueMagicData(EMPTY, CTX)
    const current = data["current"] as Record<string, unknown>
    const tendency = current["tendency"] as Record<string, string>

    expect(tendency["name"]).toBe("")
    expect(tendency["icon"]).toBe("")
  })

  it("角色名由元数据补，补不到时留空由模板退回印等级", () => {
    const ctx = { ...CTX, nameOf: (id: string): string => (id === "1306" ? "银狼" : "") }
    const groups = rogueMagicData(PLAYED, ctx)["groups"] as { list: Record<string, unknown>[] }[]
    const avatars = groups[0]?.list[0]?.["avatars"] as { name: string; level: number }[]

    expect(avatars[0]?.name).toBe("银狼")
    expect(avatars[0]?.level).toBe(80)
  })

  it("昵称缺省取接口给的那一份 —— 这一族接口自带 role.nickname", () => {
    expect(rogueMagicData(PLAYED, CTX)["nickname"]).toBe("其实雨很好")
    expect(rogueMagicData(PLAYED, { ...CTX, nickname: "开拓者" })["nickname"]).toBe("开拓者")
  })
})

describe("rogueMagicText", () => {
  it("没打过时给可操作的一句", () => {
    expect(rogueMagicText(EMPTY, CTX)).toContain("尚无通关记录")
  })

  it("打过时列出进度与阵容", () => {
    const text = rogueMagicText(PLAYED, { ...CTX, nameOf: (): string => "银狼" })

    expect(text).toContain("42%")
    expect(text).toContain("记住他们")
    expect(text).toContain("银狼")
  })
})
