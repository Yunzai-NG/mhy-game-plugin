/**
 * 模块职责：七圣召唤三张图视图层的测试
 * 依赖方向：测试文件，只依赖 views/gs/gcg（纯函数）
 * 生命周期：无状态
 * 注意事项：固定三项口径：指定的牌组序号不存在时给 undefined（命令层据它出「无牌组N」而非画空
 *          图）、卡牌收集度只收已拥有的（`num > 0`，判断放视图层而非模板）、牌组视图不带胜场与
 *          使用次数（`deckList` 接口根本不给这两栏，带上就会出现两个 0）。
 */
import { describe, expect, it } from "vitest"
import {
  actionCardOf,
  avatarCardOf,
  buildDeck,
  buildDeckCards,
  deckCardText,
  deckOf,
  deckText
} from "./gcg.js"

/** 一副牌组的原始形态 */
const DECK_RAW = {
  id: 2,
  name: "冰车队",
  avatar_cards: [
    { name: "甘雨", image: "https://x/gy.png", hp: 10 },
    { name: "重云", image: "https://x/cy.png", hp: 10 }
  ],
  action_cards: [
    {
      name: "凯亚",
      image: "https://x/ky.png",
      num: 2,
      use_count: 7,
      action_cost: [
        { cost_type: "CostTypeCryo", cost_value: 3 },
        { cost_type: "CostTypeVoid", cost_value: 1 }
      ]
    }
  ]
}

describe("avatarCardOf", () => {
  it("生命值原样带出来 —— 它同时是那张数字图的文件名", () => {
    expect(avatarCardOf({ name: "甘雨", image: "https://x/gy.png", hp: 10 })).toEqual({
      name: "甘雨",
      image: "https://x/gy.png",
      hp: "10"
    })
  })

  it("要统计时才带胜场与使用次数 —— 牌组接口不给这两栏", () => {
    const one = avatarCardOf({ name: "甘雨", hp: 10, proficiency: 3, use_count: 9 }, true)
    expect(one.proficiency).toBe(3)
    expect(one.useCount).toBe(9)
    expect(avatarCardOf({ name: "甘雨", hp: 10, proficiency: 3 })).not.toHaveProperty("proficiency")
  })
})

describe("actionCardOf", () => {
  it("两份费用都归一成类型与点数", () => {
    const one = actionCardOf(DECK_RAW.action_cards[0] ?? {})
    expect(one.num).toBe(2)
    expect(one.cost).toEqual([
      { type: "CostTypeCryo", value: "3" },
      { type: "CostTypeVoid", value: "1" }
    ])
    expect(one).not.toHaveProperty("useCount")
  })

  it("没有费用那一栏时给空表，而不是抛错", () => {
    expect(actionCardOf({ name: "参量质变仪" }).cost).toEqual([])
  })
})

describe("deckOf", () => {
  it("序号与两类牌都带出来", () => {
    const deck = deckOf(DECK_RAW)
    expect(deck.id).toBe(2)
    expect(deck.name).toBe("冰车队")
    expect(deck.avatars).toHaveLength(2)
    expect(deck.actions).toHaveLength(1)
  })
})

/** 两副牌组的接口返回 */
const LIST_RAW = {
  nickname: "旅行者",
  level: 60,
  deck_list: [{ ...DECK_RAW, id: 1, name: "雷神队" }, DECK_RAW]
}

describe("buildDeck", () => {
  it("不给序号时给出全部", () => {
    const view = buildDeck(LIST_RAW, "100000001")
    expect(view?.decks).toHaveLength(2)
    expect(view?.nickname).toBe("旅行者")
    expect(view?.level).toBe(60)
    expect(view?.uid).toBe("100000001")
  })

  it("给了序号就只留那一副", () => {
    const view = buildDeck(LIST_RAW, "100000001", 2)
    expect(view?.decks).toHaveLength(1)
    expect(view?.decks[0]?.name).toBe("冰车队")
  })

  it("序号不存在时 undefined —— 命令层据它出那句「无牌组N」", () => {
    expect(buildDeck(LIST_RAW, "100000001", 9)).toBeUndefined()
  })

  it("一副都没编时仍给出视图，只是列表是空的", () => {
    const view = buildDeck({ nickname: "旅行者", level: 60, deck_list: [] }, "100000001")
    expect(view?.decks).toEqual([])
    expect(deckText(view!)).toContain("还没有编好的牌组")
  })
})

describe("deckText", () => {
  it("逐副列出角色与行动牌", () => {
    const text = deckText(buildDeck(LIST_RAW, "100000001")!)
    expect(text).toContain("旅行者 Lv.60")
    expect(text).toContain("【1】雷神队")
    expect(text).toContain("甘雨、重云")
    expect(text).toContain("凯亚×2")
  })
})

/** 一份收集度概况 */
const BASIC = {
  level: 10,
  nickname: "旅行者",
  avatar_card_num_gained: 41,
  avatar_card_num_total: 43,
  action_card_num_gained: 180,
  action_card_num_total: 200
}

describe("buildDeckCards", () => {
  it("收集度写成 已有/总数，且只留已拥有的卡", () => {
    const view = buildDeckCards(
      BASIC,
      {
        card_list: [
          { name: "甘雨", image: "https://x/gy.png", hp: 10, num: 1, proficiency: 3, use_count: 9 },
          { name: "钟离", image: "https://x/zl.png", hp: 10, num: 0, proficiency: 0, use_count: 0 }
        ]
      },
      { card_list: [{ name: "参量质变仪", image: "https://x/c.png", num: 2, use_count: 5 }] },
      "100000001"
    )
    expect(view.avatarGained).toBe("41/43")
    expect(view.actionGained).toBe("180/200")
    expect(view.avatars.map(one => one.name)).toEqual(["甘雨"])
    expect(view.avatars[0]?.useCount).toBe(9)
    expect(view.actions[0]?.num).toBe(2)
  })

  it("只查了一类时另一类是空表 —— 命令层跳过了那个接口", () => {
    const view = buildDeckCards(BASIC, { card_list: [{ name: "甘雨", hp: 10, num: 1 }] }, undefined, "100000001")
    expect(view.actions).toEqual([])
    expect(view.avatars).toHaveLength(1)
  })

  it("概况取不到时各栏给 0，而不是 undefined/undefined", () => {
    const view = buildDeckCards(null, undefined, undefined, "100000001")
    expect(view.avatarGained).toBe("0/0")
    expect(view.level).toBe(0)
  })
})

describe("deckCardText", () => {
  it("列出收集度与两类牌", () => {
    const view = buildDeckCards(
      BASIC,
      { card_list: [{ name: "甘雨", hp: 10, num: 1, proficiency: 3, use_count: 9 }] },
      { card_list: [{ name: "参量质变仪", num: 2, use_count: 5 }] },
      "100000001"
    )
    const text = deckCardText(view)
    expect(text).toContain("邀请等级 10")
    expect(text).toContain("41/43")
    expect(text).toContain("【角色牌】")
    expect(text).toContain("甘雨")
    expect(text).toContain("参量质变仪×2")
  })
})

