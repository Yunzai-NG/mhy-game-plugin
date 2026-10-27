/**
 * 模块职责：货币战争视图的测试
 * 依赖方向：测试文件，只依赖 views/sr/currency-war（纯函数）
 * 生命周期：无状态
 * 注意事项：钉住四处**不报错、只是内容不对**的判据：数字全是字符串（不转会把 `"9"` 判成大于
 *          `"18"`）、枚举要剥前缀（原样印会出现一长串英文，且它要进 CSS 类名）、角色按 `pos` 排
 *          而非按下标、三种「没有内容」分开（没解锁 / 解锁没打过 / 有内容）。
 */
import { describe, expect, it } from "vitest"
import type { GridFightRaw, GridRoleView } from "./currency-war.js"
import { damageText, enumTail, gridFightData, gridFightState, gridFightText } from "./currency-war.js"

/** 上下文 */
const CTX = { uid: "101234567", nickname: "开拓者" }

/** 一份能出图的返回，字段形态照真机那一份（数字全是字符串） */
const RAW: GridFightRaw = {
  grid_fight_brief: {
    unlocked: true,
    has_played: true,
    division: { name: "财富造物主", name_with_num: "财富造物主44", level: "9", icon: "https://a.invalid/d.png" },
    season_level: "167",
    weekly_score_cur: "18000",
    weekly_score_max: "18000",
    handbook_progress: "66",
    trait_progress: "58",
    quest_cur: "29",
    quest_max: "91"
  },
  grid_fight_archive_list: [
    {
      archive_type: "ArchiveTypeNormal",
      brief: {
        archive_time: "2026-09-11 01:05:14",
        archive_rank: "GridFightArchiveRankS",
        remain_hp: "86",
        total_coin: "360",
        lineup_coin: "82",
        division: { name: "财富造物主", name_with_num: "财富造物主41", level: "9" }
      },
      lineup: {
        // 刻意乱序给：pos 3 在前、pos 1 在后，出图必须按 pos 排
        front_roles: [
          { role_id: "1306", name: "银狼", star: "5", pos: "3", is_trial: true },
          {
            role_id: "1510",
            name: "姬子•启行",
            star: "3",
            pos: "1",
            is_upgrade: true,
            equip_list: [{ equip_id: "35030204", name: "高周波电锯", category: "GridFightEquipCategoryCraftable" }]
          }
        ],
        back_roles: [{ role_id: "1507", name: "千冶•刃", star: "1", pos: "5" }],
        portal_list: [{ portal_id: "113", name: "蓝海" }],
        augment_list: [{ augment_id: "200801", name: "市场活力", quality: "2" }],
        trait_list: [{ trait_id: "3007", trait_name: "领航员", trait_count: "1", quality: "4" }],
        damage_list: [
          { damage_type: "DamageTypeRole", id: "1510", damage: "65722760586.46828" },
          { damage_type: "DamageTypeRole", id: "1306", damage: "21907586862.15" },
          // 非角色那一族不进图，否则占比会被摊薄
          { damage_type: "DamageTypeMonster", id: "9001", damage: "500000000" }
        ]
      }
    }
  ]
}

describe("enumTail", () => {
  it("按已知前缀剥：评级只留 S", () => {
    expect(enumTail("GridFightArchiveRankS", "GridFightArchiveRank")).toBe("S")
  })

  it("不给前缀时取末尾那段大写词", () => {
    expect(enumTail("ArchiveTypeNormal")).toBe("Normal")
    expect(enumTail("GridFightEquipCategoryCraftable")).toBe("Craftable")
  })

  it("认不出时给空串而不是原串 —— 图上多一段英文比少一段显眼", () => {
    expect(enumTail("")).toBe("")
    expect(enumTail(undefined)).toBe("")
    expect(enumTail("全是中文")).toBe("")
  })
})

describe("damageText", () => {
  it("按万 / 亿折算 —— 六百多亿原样印会占满一行", () => {
    expect(damageText("65722760586.46828")).toBe("657.2亿")
    expect(damageText("123456")).toBe("12.3万")
    expect(damageText("880")).toBe("880")
  })

  it("没有伤害时给 0，不给 NaN", () => {
    expect(damageText(undefined)).toBe("0")
    expect(damageText("那不是数字")).toBe("0")
  })
})

describe("gridFightState", () => {
  it("三种分开 —— 合成一句会让「过一阵就有」与「没这个玩法」分不出来", () => {
    expect(gridFightState(RAW)).toBe("ok")
    expect(gridFightState({ grid_fight_brief: { unlocked: false } })).toBe("locked")
    expect(gridFightState({ grid_fight_brief: { unlocked: true }, grid_fight_archive_list: [] })).toBe("noData")
    // 整份都没有时按没解锁处理，而不是抛错
    expect(gridFightState(undefined)).toBe("locked")
  })
})

describe("gridFightData", () => {
  it("**数字全转过** —— 接口给的是字符串，不转会把 9 判成大于 18", () => {
    const data = gridFightData(RAW, CTX)

    expect(data["seasonLevel"]).toBe(167)
    expect(data["handbook"]).toBe(66)
    expect(data["quest"]).toEqual({ cur: 29, max: 91 })
    // 本周积分满了要标出来
    expect(data["weekly"]).toEqual({ cur: 18_000, max: 18_000, full: true })
  })

  it("段位取带序号那一份 —— 它更具体", () => {
    const division = gridFightData(RAW, CTX)["division"] as { label: string; level: number }

    expect(division.label).toBe("财富造物主44")
    expect(division.level).toBe(9)
  })

  it("**角色按 pos 排而不是按下标** —— 接口给的次序与位次未必一致", () => {
    const one = (gridFightData(RAW, CTX)["archives"] as Record<string, unknown>[])[0]
    const front = one?.["front"] as GridRoleView[]

    // 夹具里 pos 3 在前、pos 1 在后
    expect(front.map(it => it.pos)).toEqual([1, 3])
    expect(front[0]?.name).toBe("姬子•启行")
    // 试用与已升级两枚角标各自认得出
    expect(front[1]?.trial).toBe(true)
    expect(front[0]?.upgrade).toBe(true)
  })

  it("评级与存档类型都剥成末段 —— 它们要进 CSS 类名", () => {
    const one = (gridFightData(RAW, CTX)["archives"] as Record<string, unknown>[])[0]

    expect(one?.["rank"]).toBe("S")
    expect(one?.["type"]).toBe("Normal")
  })

  it("**只算角色那一族的伤害**，按降序并给出占比", () => {
    const one = (gridFightData(RAW, CTX)["archives"] as Record<string, unknown>[])[0]
    const damages = one?.["damages"] as { id: string; pct: number; text: string }[]

    // 怪物那一条不进来 —— 进来会把角色占比摊薄
    expect(damages).toHaveLength(2)
    expect(damages[0]?.id).toBe("1510")
    expect(damages[0]?.text).toBe("657.2亿")
    // 两条占比相加为 100
    expect(damages[0]!.pct + damages[1]!.pct).toBe(100)
    expect(one?.["damageTotal"]).toBe("876.3亿")
  })

  it("装备的类别也剥前缀", () => {
    const one = (gridFightData(RAW, CTX)["archives"] as Record<string, unknown>[])[0]
    const front = one?.["front"] as GridRoleView[]

    expect(front[0]?.equips[0]?.category).toBe("Craftable")
    expect(front[0]?.equips[0]?.name).toBe("高周波电锯")
  })

  it("空返回不炸 —— 出图前会先判 state，但这一层也不该抛", () => {
    const data = gridFightData(undefined, CTX)

    expect(data["archives"]).toEqual([])
    expect(data["total"]).toBe(0)
  })
})

describe("gridFightText", () => {
  it("两种「没有内容」各说自己那一句", () => {
    expect(gridFightText({ grid_fight_brief: { unlocked: false } }, CTX)).toContain("尚未解锁")
    expect(gridFightText({ grid_fight_brief: { unlocked: true }, grid_fight_archive_list: [] }, CTX)).toContain("尚无存档")
  })

  it("有内容时列出段位、积分与阵容", () => {
    const text = gridFightText(RAW, CTX)

    expect(text).toContain("财富造物主44")
    expect(text).toContain("18000")
    expect(text).toContain("姬子•启行")
  })
})
