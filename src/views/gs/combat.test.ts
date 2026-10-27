/**
 * 模块职责：幻想真境剧诗视图模型的测试
 * 依赖方向：测试文件，依赖 views/gs/combat.ts（纯函数）与 views/avatar-list 的卡片类型
 * 生命周期：无状态
 * 注意事项：固定四处**不报错却让整张图出不来或印错**的口径：祝福与诗筹恒为数组（模板对它们取
 *          `.length`，接口那一幕没有时不给这两个键）、元素键转小写（接口给 `Pyro` 而图标是
 *          `pyro.png`）、头像按 id 查元数据（旅行者的接口名与目录名不同）、两处显示值由本层补
 *          （`stat.start_time` 与 `round.finish` 接口本就不给）。另固定"没有内容"的三种成因
 *          （没解锁、没打过、明细未生成）要分得开。
 */
import { describe, expect, it } from "vitest"
import { stamp } from "../../core/text.js"
import type { AvatarCardView } from "../avatar-list.js"
import type { CombatContext, RoleCombatRaw } from "./combat.js"
import {
  combatDifficulty,
  combatRoundTitle,
  combatState,
  combatTemplateData,
  combatText,
  combatTimeText,
  splendourGainOf,
  tarotState,
  tarotTemplateData,
  tarotText
} from "./combat.js"

/** 2026-08-01 的 unix 秒 */
const START = Math.floor(new Date(2026, 7, 1).getTime() / 1000)

/** 一份形态照实测的返回 */
const RAW: RoleCombatRaw = {
  is_unlock: true,
  data: [
    {
      has_data: true,
      has_detail_data: true,
      schedule: { start_time: String(START), end_time: String(START + 86_400), schedule_id: 6 },
      stat: {
        difficulty_id: 4,
        max_round_id: 10,
        heraldry: 3,
        // 逐幕标记（官方 H5 按 `1 === i` 判亮），不是幕号
        get_medal_round_list: [1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
        coin_num: 12,
        avatar_bonus_num: 5,
        rent_cnt: 2
      },
      detail: {
        rounds_data: [
          {
            round_id: 1,
            finish_time: START + 600,
            is_get_medal: true,
            avatars: [
              { avatar_id: 10000046, name: "胡桃", element: "Pyro", level: 90, rarity: 5, avatar_type: 1 },
              { avatar_id: 10000005, name: "旅行者", element: "Anemo", level: 90, rarity: 5, avatar_type: 2 }
            ],
            buffs: [{ icon: "https://a.png", name: "祝福" }],
            choice_cards: [{ icon: "https://b.png", name: "诗筹" }]
          },
          // 第二幕刻意不给 buffs / choice_cards / avatars：接口在没有时确实不给这些键
          { round_id: 2, finish_time: START + 1200 }
        ]
      }
    }
  ]
}

/** 头像按 id 查，与命令层同一形态 */
const CTX: CombatContext = {
  uid: "100000001",
  role: { nickname: "旅行者", level: 60, game_head_icon: "https://head.png" },
  faceOf: (id: string): string => (id === "10000046" ? "meta-gs/character/胡桃/imgs/face.webp" : "")
}

describe("combatState", () => {
  it("三种没有内容分得开 —— 三者的处置完全不同", () => {
    expect(combatState(RAW)).toBe("ok")
    expect(combatState({ is_unlock: false })).toBe("locked")
    expect(combatState({ is_unlock: true, data: [{ has_data: false }] })).toBe("noData")
    expect(combatState({ is_unlock: true, data: [{ has_data: true, has_detail_data: false }] })).toBe("noDetail")
    // 有明细标记但一幕都没有，同样算没打过
    expect(combatState({ is_unlock: true, data: [{ has_data: true, detail: { rounds_data: [] } }] })).toBe("noData")
    expect(combatState(undefined)).toBe("noData")
  })
})

describe("combatDifficulty", () => {
  it("五档难度各有名字，不认得的给空串", () => {
    expect(combatDifficulty(1)).toBe("轻简")
    expect(combatDifficulty(4)).toBe("卓越")
    // 官方那张表是「轻简模式」…「月谕模式」五档，少收第五档的表现是那一行只剩「模式」
    expect(combatDifficulty(5)).toBe("月谕")
    expect(combatDifficulty(9)).toBe("")
    expect(combatDifficulty(undefined)).toBe("")
  })
})

describe("combatRoundTitle", () => {
  it("圣牌挑战不按幕数编号，官方印罗马数字 —— 按幕数印会出现两个「第 3 幕」", () => {
    expect(combatRoundTitle({ round_id: 3 })).toBe("第3幕")
    expect(combatRoundTitle({ round_id: 3, is_tarot: true, tarot_serial_no: 1 })).toBe("圣牌挑战 I")
    expect(combatRoundTitle({ round_id: 4, is_tarot: true, tarot_serial_no: 2 })).toBe("圣牌挑战 II")
    // 序号认不出时退回幕数，不编一个罗马数字
    expect(combatRoundTitle({ round_id: 5, is_tarot: true, tarot_serial_no: 9 })).toBe("第5幕")
  })
})

describe("combatTimeText", () => {
  it("秒级时间戳按秒算 —— 当成毫秒会得到 1970 年", () => {
    expect(combatTimeText(START)).toBe(stamp(START * 1000))
    // 接口有时把时间戳写成字符串
    expect(combatTimeText(String(START))).toBe(stamp(START * 1000))
    expect(combatTimeText(0)).toBe("")
    expect(combatTimeText(undefined)).toBe("")
  })
})

describe("combatTemplateData", () => {
  it("祝福与诗筹恒为数组 —— 模板对它们取 length，缺键会让整张图出不来", () => {
    const view = combatTemplateData(RAW, CTX)
    const rounds = (view["detail"] as { rounds_data: Record<string, unknown>[] }).rounds_data
    const second = rounds[1] as { buffs: unknown[]; choice_cards: unknown[]; avatars: unknown[] }

    expect(Array.isArray(second.buffs)).toBe(true)
    expect(Array.isArray(second.choice_cards)).toBe(true)
    expect(Array.isArray(second.avatars)).toBe(true)
    expect(second.buffs).toEqual([])
  })

  it("元素键转小写 —— 接口给 Pyro 而图标是 pyro.png", () => {
    const view = combatTemplateData(RAW, CTX)
    const rounds = (view["detail"] as { rounds_data: { avatars: { element: string }[] }[] }).rounds_data

    expect(rounds[0]?.avatars[0]?.element).toBe("pyro")
    expect(rounds[0]?.avatars[1]?.element).toBe("anemo")
  })

  it("头像按 id 查元数据，查不到时留空串而不是拼一个不存在的路径", () => {
    const view = combatTemplateData(RAW, CTX)
    const rounds = (view["detail"] as { rounds_data: { avatars: { face: string }[] }[] }).rounds_data

    expect(rounds[0]?.avatars[0]?.face).toBe("meta-gs/character/胡桃/imgs/face.webp")
    // 旅行者：接口名与元数据目录名不同，故按 id 查不到就空着
    expect(rounds[0]?.avatars[1]?.face).toBe("")
  })

  it("两处显示值由本层补：开启时刻在 schedule 里、完成时刻叫 finish_time", () => {
    const view = combatTemplateData(RAW, CTX)
    const stat = view["stat"] as { start_time: string }
    const rounds = (view["detail"] as { rounds_data: { finish: string }[] }).rounds_data

    expect(stat.start_time).toBe(stamp(START * 1000))
    expect(rounds[0]?.finish).toBe(stamp((START + 600) * 1000))
  })

  it("统计各项恒为数字、星章恒为数组 —— 模板直接印它们", () => {
    const view = combatTemplateData({ is_unlock: true, data: [{}] }, { uid: "1" })
    const stat = view["stat"] as Record<string, unknown>

    expect(stat["difficulty_id"]).toBe(0)
    expect(stat["max_round_id"]).toBe(0)
    expect(stat["coin_num"]).toBe(0)
    expect(stat["get_medal_round_list"]).toEqual([])
    // 玩家信息补成全壳：那一次 index 允许失败，给空对象会让图上印出字面的 undefined
    expect(view["role"]).toEqual({ nickname: "", level: 0, game_head_icon: "", AvatarUrl: "" })
    expect((view["detail"] as { rounds_data: unknown[] }).rounds_data).toEqual([])
  })

  it("难度名由本层给，模板不再自带一张同样的表", () => {
    const view = combatTemplateData(RAW, CTX)
    expect((view["stat"] as Record<string, unknown>)["difficultyName"]).toBe("卓越")
  })

  it("圣牌数只在月谕模式带出来 —— 其余难度官方那一栏根本不出现", () => {
    const moon = combatTemplateData(
      { is_unlock: true, data: [{ stat: { difficulty_id: 5, tarot_finished_cnt: 2 } }] },
      { uid: "1" }
    )
    expect((moon["stat"] as Record<string, unknown>)["tarot_finished_cnt"]).toBe(2)

    // 卓越模式即便接口给了这个字段也不印：官方判的是 difficulty_id === 5
    const other = combatTemplateData(
      { is_unlock: true, data: [{ stat: { difficulty_id: 4, tarot_finished_cnt: 2 } }] },
      { uid: "1" }
    )
    expect((other["stat"] as Record<string, unknown>)["tarot_finished_cnt"]).toBe(0)
  })

  it("每一幕带上标题与是不是圣牌挑战", () => {
    const view = combatTemplateData(
      {
        is_unlock: true,
        data: [{ detail: { rounds_data: [{ round_id: 5, is_tarot: true, tarot_serial_no: 2 }] } }]
      },
      { uid: "1" }
    )
    const rounds = (view["detail"] as { rounds_data: Record<string, unknown>[] }).rounds_data

    expect(rounds[0]?.["title"]).toBe("圣牌挑战 II")
    expect(rounds[0]?.["is_tarot"]).toBe(true)
  })

  it("星章按逐幕标记画：数 1 的个数，月谕模式第 10 枚之后画一道隔线", () => {
    const view = combatTemplateData(RAW, CTX)
    const stat = view["stat"] as { medals: { on: boolean; gap: boolean }[]; medal_num: number }
    expect(stat.medal_num).toBe(8)
    expect(stat.medals.map(it => it.on)).toEqual([true, true, false, true, true, true, false, true, true, true])
    expect(stat.medals.some(it => it.gap)).toBe(false)

    const moon = combatTemplateData(
      { data: [{ stat: { difficulty_id: 5, get_medal_round_list: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0] } }] },
      { uid: "1" }
    )
    const gaps = (moon["stat"] as { medals: { gap: boolean }[] }).medals.map(it => it.gap)
    expect(gaps.indexOf(true)).toBe(9)
    expect(gaps.filter(Boolean)).toHaveLength(1)
  })

  it("战斗数据：开关为假时整块为空；头像只走元数据，接口地址不用", () => {
    const fight = {
      is_show_battle_stats: true,
      max_damage_avatar: { avatar_id: 10000046, avatar_icon: "https://x.png", value: "1234567", rarity: 5 },
      total_coin_consumed: { value: "37" },
      shortest_avatar_list: [{ avatar_id: 10000046, rarity: 5 }, { avatar_id: 1, rarity: 4 }],
      total_use_time: 725
    }
    const raw: RoleCombatRaw = { data: [{ detail: { rounds_data: [], fight_statisic: fight } }] }
    const view = combatTemplateData(raw, CTX)
    const out = view["fight"] as { cells: Record<string, unknown>[]; shortest: { face: string; star: number }[] }

    expect(out.cells).toEqual([
      { title: "最高伤害输出", value: "1234567", face: "meta-gs/character/胡桃/imgs/face.webp", star: 5 },
      { title: "消耗幻剧之花", value: "37", face: "", star: 5 }
    ])
    expect(out.shortest).toEqual([
      { face: "meta-gs/character/胡桃/imgs/face.webp", star: 5 },
      { face: "", star: 4 }
    ])
    expect((view["stat"] as { use_time: string }).use_time).toBe("12分钟5秒")

    const hidden = combatTemplateData({ data: [{ detail: { fight_statisic: { ...fight, is_show_battle_stats: false } } }] }, CTX)
    expect(hidden["fight"]).toEqual({ cells: [], shortest: [] })
  })

  it("逐幕带上讨伐列表与辉彩祝福；接口不给时恒为空数组与 0", () => {
    const raw: RoleCombatRaw = {
      data: [
        {
          detail: {
            rounds_data: [
              {
                round_id: 1,
                enemies: [{ name: "丘丘人", icon: "https://e.png", level: 95 }],
                splendour_buff: { summary: { total_level: 6 }, buffs: [{ name: "辉彩", icon: "https://s.png", level: 2 }] }
              },
              { round_id: 2 }
            ]
          }
        }
      ]
    }
    const rounds = (combatTemplateData(raw, CTX)["detail"] as { rounds_data: Record<string, unknown>[] }).rounds_data
    expect(rounds[0]).toMatchObject({
      enemies: [{ name: "丘丘人", icon: "https://e.png", level: 95 }],
      splendour: 6,
      splendourBuffs: [{ name: "辉彩", icon: "https://s.png", level: 2 }]
    })
    expect(rounds[1]).toMatchObject({ enemies: [], splendour: 0, splendourBuffs: [] })
  })

  it("不给 faceOf 时头像一律空串，不抛错", () => {
    const view = combatTemplateData(RAW, { uid: "1" })
    const rounds = (view["detail"] as { rounds_data: { avatars: { face: string }[] }[] }).rounds_data

    expect(rounds[0]?.avatars[0]?.face).toBe("")
  })

  it("自有角色取面板库那张整卡；试用角色**即使库里有**也不取，只印「试用」", () => {
    /**
     * 造一张面板库里的卡
     * @param id 角色 id
     * @returns 卡
     */
    const own = (id: string): AvatarCardView => ({
      id,
      name: "x",
      abbr: "x",
      elem: "pyro",
      star: 5,
      level: 90,
      cons: 1,
      game: "gs",
      face: "",
      gacha: "",
      preview: "",
      talent: {},
      tals: [{ key: "a", name: "", level: 9, crown: false }],
      xtals: [],
      weapon: { star: 5, img: "w.webp", affix: 1 },
      artisSet: { names: [], imgs: [] }
    })
    const view = combatTemplateData(RAW, { ...CTX, cards: { "10000046": own("10000046"), "10000005": own("10000005") } })
    const cards = view["avatars"] as Record<string, AvatarCardView & { mark?: string }>

    expect(cards["10000046"]?.tals).toHaveLength(1)
    expect(cards["10000046"]?.mark).toBeUndefined()
    // 借来的配装画成自己那份等于张冠李戴
    expect(cards["10000005"]).toMatchObject({ mark: "试用", tals: [], weapon: { star: 0 } })
  })

  it("index 失败（没给 cards）时自有角色退回只带头像的卡，模板据空的 tals 印提示", () => {
    const cards = combatTemplateData(RAW, CTX)["avatars"] as Record<string, AvatarCardView>

    expect(cards["10000046"]).toMatchObject({ face: "meta-gs/character/胡桃/imgs/face.webp", tals: [] })
  })

  it("辉彩祝福换算成四项加成（每级生命 800、攻防 50、精通 20）", () => {
    expect(splendourGainOf(6)).toEqual({ hp: 4800, atk: 300, def: 300, em: 120 })
    expect(splendourGainOf(0)).toEqual({ hp: 0, atk: 0, def: 0, em: 0 })
  })
})

describe("combatText", () => {
  it("无渲染器时逐幕列出上场角色", () => {
    const text = combatText(RAW, CTX)

    expect(text).toContain("UID100000001")
    expect(text).toContain("卓越模式")
    expect(text).toContain("第 10 幕")
    expect(text).toContain("明星挑战星章 8 枚")
    expect(text).toContain("胡桃、旅行者")
    // 没有角色记录的那一幕要明说，不能留一个空冒号
    expect(text).toContain("无记录")
  })

  it("一幕都没有时同样是一段可读文本", () => {
    expect(combatText({ is_unlock: true, data: [{}] }, { uid: "1" })).toContain("UID1")
  })

  it("月谕模式才提圣牌那一句", () => {
    const moon = combatText({ is_unlock: true, data: [{ stat: { difficulty_id: 5, tarot_finished_cnt: 2 } }] }, { uid: "1" })
    expect(moon).toContain("圣牌 2")
    expect(combatText(RAW, CTX)).not.toContain("圣牌")
  })
})

/** 一份月谕圣牌的收藏，与剧诗同一条接口 */
const TAROT: RoleCombatRaw = {
  is_unlock: true,
  tarot_card_state: {
    curr_num: 2,
    total_num: 22,
    list: [
      { name: "愚者", icon: "https://a.png", is_unlock: true, unlock_num: 3 },
      { name: "女祭司", icon: "https://b.png", is_unlock: true, unlock_num: 1 },
      { name: "魔术师", icon: "https://c.png", is_unlock: false, unlock_num: 0 }
    ]
  }
}

describe("tarotState", () => {
  it("没解锁与这一期没有月谕模式分得开 —— 两者的说法不同", () => {
    expect(tarotState(TAROT)).toBe("ok")
    expect(tarotState({ is_unlock: false })).toBe("locked")
    expect(tarotState({ is_unlock: true, tarot_card_state: { list: [] } })).toBe("noData")
    expect(tarotState({ is_unlock: true })).toBe("noData")
    expect(tarotState(undefined)).toBe("noData")
  })
})

describe("tarotTemplateData", () => {
  it("逐张牌带上解锁与否；只有一张时不印那个数字", () => {
    const view = tarotTemplateData(TAROT, { uid: "100000001" })
    const cards = view["cards"] as { name: string; unlock: boolean; count: string }[]

    expect(view["current"]).toBe(2)
    expect(view["total"]).toBe(22)
    expect(cards).toHaveLength(3)
    expect(cards[0]).toMatchObject({ name: "愚者", unlock: true, count: "3" })
    // 官方只在多于一张时印这个数字
    expect(cards[1]?.count).toBe("")
    expect(cards[2]).toMatchObject({ unlock: false, count: "" })
  })

  it("超过 999 张印作「999+」，与游戏内一致", () => {
    const view = tarotTemplateData(
      { tarot_card_state: { list: [{ name: "愚者", is_unlock: true, unlock_num: 1200 }] } },
      { uid: "1" }
    )
    expect((view["cards"] as { count: string }[])[0]?.count).toBe("999+")
  })

  it("接口没给总数时按牌数算 —— 模板印的是「x / y」，y 缺了那一行不成话", () => {
    const view = tarotTemplateData({ tarot_card_state: { list: [{ name: "愚者" }] } }, { uid: "1" })
    expect(view["total"]).toBe(1)
    expect(view["current"]).toBe(0)
  })
})

describe("tarotText", () => {
  it("只列已收集的那些 —— 二十余张全列要翻屏", () => {
    const text = tarotText(TAROT, { uid: "100000001" })

    expect(text).toContain("UID100000001 月谕圣牌")
    expect(text).toContain("已收集 2/22")
    expect(text).toContain("愚者×3")
    expect(text).toContain("女祭司")
    expect(text).not.toContain("魔术师")
  })

  it("一张都没有时也是一段可读文本", () => {
    expect(tarotText({}, { uid: "1" })).toContain("已收集 0/0")
  })
})
