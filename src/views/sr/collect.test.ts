/**
 * 模块职责：星铁两项收集进度视图的测试
 * 依赖方向：测试文件，只依赖 views/sr/collect.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：钉住两件"错了不报错、只是数字看着对"的事：成就总数由金银铜三档相加（接口没有总数
 *          这一栏）、`cur` / `max` 接口给的是字符串（不转数字比大小会把「9/10」判成已满）。
 */
import { describe, expect, it } from "vitest"
import type { SrAchieveRaw, SrChestRaw } from "./collect.js"
import {
  srAchieveData,
  srAchieveState,
  srAchieveText,
  srChestData,
  srChestState,
  srChestText
} from "./collect.js"
import type { SrRogueRaw } from "./rogue.js"
import { srRogueData, srRogueFuryText, srRogueState, srRogueText } from "./rogue.js"

/** 上下文 */
const CTX = { uid: "101234567", nickname: "开拓者" }

/** 一份成就返回，数字刻意都是字符串 —— 接口给的就是字符串 */
const ACHIEVE: SrAchieveRaw = {
  gold_num: "12",
  silver_num: "88",
  copper_num: "306",
  list: [
    { series_id: 1, name: "开拓的路上", icon: "https://a.png", cur: "9", max: "10" },
    { series_id: 2, name: "苍穹之下", icon: "https://b.png", cur: "24", max: "24" }
  ]
}

/** 一份战利品返回 */
const CHEST: SrChestRaw = {
  world_list: [
    {
      world_id: "1",
      name: "空间站「黑塔」",
      icon: "https://w1.png",
      bg_icon: "https://b1.png",
      world_cur: "40",
      world_max: "50",
      map_entrances: [
        { id: 101, name: "基座舱段", cur_chest: "20", max_chest: "20" },
        { id: 102, name: "收容舱段", cur_chest: "20", max_chest: "30" }
      ]
    },
    { world_id: "999", world_cur: "3", world_max: "6" }
  ]
}

describe("srAchieveState / srChestState", () => {
  it("接口没给列表时不出图 —— 一张空表看不出是没开战绩展示还是真没成就", () => {
    expect(srAchieveState(ACHIEVE)).toBe("ok")
    expect(srAchieveState({ gold_num: 1 })).toBe("noData")
    expect(srAchieveState(undefined)).toBe("noData")
    expect(srChestState(CHEST)).toBe("ok")
    expect(srChestState({ world_list: [] })).toBe("noData")
  })
})

describe("srAchieveData", () => {
  it("总数由金银铜三档相加 —— 接口没有总数这一栏", () => {
    const view = srAchieveData(ACHIEVE, CTX)

    expect(view["total"]).toBe(406)
    expect(view["gold"]).toBe(12)
  })

  it("逐系列的进度按数字比大小 —— 比字符串会把 9/10 判成已满", () => {
    const list = srAchieveData(ACHIEVE, CTX)["list"] as { name: string; full: boolean; pct: number }[]

    expect(list[0]).toMatchObject({ name: "开拓的路上", full: false, pct: 90 })
    expect(list[1]).toMatchObject({ name: "苍穹之下", full: true, pct: 100 })
  })

  it("合计由逐系列加出来，与三档那个枚数是两回事", () => {
    const view = srAchieveData(ACHIEVE, CTX)

    expect(view["cur"]).toBe(33)
    expect(view["max"]).toBe(34)
  })

  it("空返回也出得来视图，不抛错", () => {
    const view = srAchieveData(undefined, CTX)

    expect(view["total"]).toBe(0)
    expect(view["list"]).toEqual([])
  })
})

describe("srChestData", () => {
  it("合计按各星球相加，百分比取整", () => {
    const view = srChestData(CHEST, CTX)

    expect(view["cur"]).toBe(43)
    expect(view["max"]).toBe(56)
    expect(view["pct"]).toBe(77)
  })

  it("接口连名字都不给的那一项退回「其他」，不编一个名字", () => {
    const worlds = srChestData(CHEST, CTX)["worlds"] as { name: string; areas: unknown[] }[]

    expect(worlds[1]?.name).toBe("其他")
    expect(worlds[1]?.areas).toEqual([])
  })

  it("分母为 0 时百分比算 0 而不是 NaN —— NaN 会让进度条宽度成为一段无效样式", () => {
    const view = srChestData({ world_list: [{ world_id: "1", name: "x", world_cur: "0", world_max: "0" }] }, CTX)

    expect(view["pct"]).toBe(0)
  })
})

describe("文字兜底", () => {
  it("成就列出逐系列与三档枚数", () => {
    const text = srAchieveText(ACHIEVE, CTX)

    expect(text).toContain("UID101234567 达成成就 406 个")
    expect(text).toContain("金 12 银 88 铜 306")
    expect(text).toContain("开拓的路上 9/10")
  })

  it("成就没有系列时给出可操作的提示", () => {
    expect(srAchieveText({}, CTX)).toContain("战绩展示")
  })

  it("战利品只列到星球一层 —— 逐区域几十行在聊天里读不动", () => {
    const text = srChestText(CHEST, CTX)

    expect(text).toContain("战利品开启 43/56（77%）")
    expect(text).toContain("空间站「黑塔」 40/50（2 个区域）")
    expect(text).not.toContain("基座舱段")
  })

  it("战利品没有星球时给出可操作的提示", () => {
    expect(srChestText(undefined, CTX)).toContain("战绩展示")
  })
})

describe("srRogue", () => {
  /** 一份模拟宇宙返回 */
  const ROGUE: SrRogueRaw = {
    role: { nickname: "其实雨很好" },
    basic_info: { unlocked_buff_num: "128", unlocked_miracle_num: "96", unlocked_skill_points: "40" },
    latest_record: {
      has_data: true,
      basic: { finish_cnt: "3" },
      records: [
        {
          name: "第八世界",
          difficulty: 5,
          progress: 8,
          finish_time: { year: 2026, month: 9, day: 1, hour: 22, minute: 5 },
          fury: { type: 1, point: 3 },
          base_type_list: [{ id: 120, cnt: "6" }, { id: 124, cnt: "2" }],
          buffs: [
            {
              base_type: { id: 120, name: "欢愉" },
              items: [
                { id: 1, name: "「不义之财」", rank: 3, is_evoluted: true },
                { id: 2, name: "「一饮而尽」", rank: 2 }
              ]
            }
          ],
          miracles: [{ id: 1, icon: "https://m1.png", rank: 3 }],
          final_lineup: [{ id: 1306, level: 80, icon: "https://a.png", rarity: 5, rank: 2 }],
          blocks: [{ name: "遭遇", num: 3 }],
          boss_effect: ["首领获得护盾", ""]
        }
      ]
    }
  }

  it("没有明细时不出图 —— 少带 need_detail 的表现就是 records 为空", () => {
    expect(srRogueState(ROGUE)).toBe("ok")
    expect(srRogueState({ latest_record: { has_data: true, records: [] } })).toBe("noData")
    expect(srRogueState({ latest_record: { has_data: false } })).toBe("noData")
    expect(srRogueState(undefined)).toBe("noData")
  })

  it("命途名从祝福那一段按 id 反查 —— base_type_list 只给 id 与数量", () => {
    const records = srRogueData(ROGUE, { uid: "1" })["records"] as { paths: { id: string; name: string }[] }[]

    expect(records[0]?.paths[0]).toEqual({ id: "120", name: "欢愉", cnt: 6 })
    // 祝福里没出现过的那一个命途只有 id，名字留空由模板退回印 id
    expect(records[0]?.paths[1]?.name).toBe("")
  })

  it("扰动等级与位面紊乱倒计共用一个字段，按 type 分", () => {
    expect(srRogueFuryText({ type: 1, point: 3 })).toBe("扰动等级 3")
    expect(srRogueFuryText({ type: 0, point: 12 })).toBe("位面紊乱倒计 12")
    expect(srRogueFuryText(undefined)).toBe("")
  })

  it("已强化的祝福另标一处，空的首领效果不列", () => {
    const records = srRogueData(ROGUE, { uid: "1" })["records"] as {
      buffs: { items: { upgraded: boolean }[] }[]
      bossEffect: string[]
    }[]

    expect(records[0]?.buffs[0]?.items[0]?.upgraded).toBe(true)
    expect(records[0]?.buffs[0]?.items[1]?.upgraded).toBe(false)
    expect(records[0]?.bossEffect).toEqual(["首领获得护盾"])
  })

  it("昵称取接口自带的那一个，角色名由元数据补", () => {
    const view = srRogueData(ROGUE, { uid: "1", nickname: "别的", nameOf: () => "花火" })
    const records = view["records"] as { lineup: { name: string }[] }[]

    expect(view["nickname"]).toBe("其实雨很好")
    expect(records[0]?.lineup[0]?.name).toBe("花火")
  })

  it("文字形态列出难度、进度与阵容", () => {
    const text = srRogueText(ROGUE, { uid: "101234567", nameOf: () => "花火" })

    expect(text).toContain("本期通关 3 次")
    expect(text).toContain("已解锁祝福 128 奇物 96")
    expect(text).toContain("难度 5")
    expect(text).toContain("阵容：花火")
  })

  it("一次记录都没有时也是一段可读文本", () => {
    expect(srRogueText(undefined, { uid: "1" })).toContain("尚无通关记录")
  })
})
