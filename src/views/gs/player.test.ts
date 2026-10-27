/**
 * 模块职责：角色卡片与探索度两套模板数据的测试
 * 依赖方向：测试文件，只依赖 views/gs/player.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：本文件固定的是**版式**：几行、每行几格、格子的顺序。这些正是既有模板赖以
 *          排版的东西，改一格就会错位，而错位只在实际出图时才看得见。
 */
import { describe, expect, it } from "vitest"
import type { PlayerIndexRaw } from "./player.js"
import { playerText, roleCardTemplateData, roleExploreTemplateData } from "./player.js"

/** 固定的"现在"：2026-08-30 */
const NOW = new Date(2026, 7, 30, 12, 0, 0).getTime()

/** 一份够用的 index 数据 */
const RAW: PlayerIndexRaw = {
  role: { nickname: "旅行者", level: 60, game_head_icon: "https://head.png", region: "天空岛" },
  stats: {
    active_day_number: 800,
    achievement_number: 1200,
    avatar_number: 60,
    full_fetter_avatar_num: 12,
    way_point_number: 500,
    domain_number: 60,
    spiral_abyss: "12-3",
    luxurious_chest_number: 300,
    precious_chest_number: 800,
    exquisite_chest_number: 2500,
    common_chest_number: 3000,
    magic_chest_number: 300,
    anemoculus_number: 66,
    geoculus_number: 131,
    electroculus_number: 181,
    dendroculus_number: 271,
    hydroculus_number: 271,
    pyroculus_number: 271,
    moonoculus_number: 100,
    role_combat: { max_round_id: 10 },
    hard_challenge: { difficulty: 4 }
  },
  world_explorations: [
    { id: 1, name: "蒙德", type: "Reputation", world_type: 2, exploration_percentage: 1000, level: 10, seven_statue_level: 10, area_exploration_list: [{ name: "星落湖", exploration_percentage: 1000 }] },
    { id: 2, name: "璃月", type: "Reputation", world_type: 2, exploration_percentage: 980, level: 8, seven_statue_level: 10 },
    { id: 3, name: "龙脊雪山", type: "Offering", world_type: 1, exploration_percentage: 1000, offerings: [{ name: "忍冬之树", level: 12, icon: "https://x.invalid/UI_ChapterOffering_Eldertree.png" }], boss_list: [{ name: "无相之冰", kill_num: 3 }] },
    { id: 6, name: "层岩巨渊", type: "Offering", world_type: 1, exploration_percentage: 900, offerings: [{ name: "流明石触媒", level: 8 }] },
    { id: 7, name: "层岩巨渊·地下矿区", type: "Offering", world_type: 1, exploration_percentage: 800, parent_id: 6 },
    { id: 10, name: "沉玉谷", type: "Offering", world_type: 1, exploration_percentage: 0 },
    { id: 11, name: "来歆山", type: "TypeUnknow", world_type: 1, exploration_percentage: 600, parent_id: 10 },
    { id: 15, name: "纳塔", type: "Reputation", world_type: 2, exploration_percentage: 500, seven_statue_level: 6, natan_reputation: { tribal_list: [{ id: 2, name: "「流泉之众」", level: 4 }] } },
    { id: 16, name: "远古圣山", type: "TypeUnknow", world_type: 1, exploration_percentage: 300, area_exploration_list: [{ name: "圣山脚", exploration_percentage: 300 }] },
    { id: 17, name: "挪德卡莱", type: "Reputation", world_type: 2, exploration_percentage: 400, seven_statue_level: 7, offerings: [{ name: "聚所·终夜长茔", level: 5, open_state: "OfferingOpenStateUnlocked" }, { name: "聚所·霜月之坊", level: 0, open_state: "OfferingOpenStateLocked" }] },
    { id: 21, name: "新地区", type: "Reputation", world_type: 2, exploration_percentage: 10 }
  ],
  homes: [{ name: "罗浮洞", level: 10, comfort_num: 20000, item_num: 300, visit_num: 5, comfort_level_name: "仙人之邸" }],
  avatars: [
    { id: 10000005, name: "旅行者", level: 90, actived_constellation_num: 0, image: "https://kong.png", element: "Anemo", rarity: 5 },
    { id: 10000032, name: "北斗", level: 80, actived_constellation_num: 6, image: "https://beidou.png", element: "Electro", rarity: 4 }
  ]
}

describe("roleCardTemplateData", () => {
  it("四行表格：两行统计、两行探索与神瞳", () => {
    const data = roleCardTemplateData(RAW, { uid: "100000001", name: "旅行者", now: NOW })
    const line = data["line"] as { lable: string }[][]
    expect(line).toHaveLength(4)
    expect(line[0]?.map(it => it.lable)).toEqual(["活跃天数", "成就", "等级", "角色数", "满好感角色数", "总宝箱"])
    expect(line[1]?.[0]?.lable).toBe("华丽宝箱")
    // 第四行是神瞳，且只留五格 —— 模板一行放得下五格
    expect(line[3]).toHaveLength(5)
  })

  it("总宝箱是五类之和", () => {
    const data = roleCardTemplateData(RAW, { uid: "100000001", name: "旅行者", now: NOW })
    const line = data["line"] as { lable: string; num: number }[][]
    expect(line[0]?.find(it => it.lable === "总宝箱")?.num).toBe(300 + 800 + 2500 + 3000 + 300)
  })

  it("地区按 id 倒序 —— 新地区排前面", () => {
    const data = roleCardTemplateData(RAW, { uid: "100000001", name: "旅行者", now: NOW })
    const line = data["line"] as { lable: string }[][]
    expect(line[2]?.map(it => it.lable)).toEqual(["新地区", "挪德卡莱", "远古圣山", "纳塔", "来歆山"])
  })

  it("立绘取接口自带的绝对地址，旅行者按性别改名", () => {
    const data = roleCardTemplateData(RAW, { uid: "100000001", name: "旅行者", now: NOW })
    const avatars = data["avatars"] as { name: string; img: string; element: string; star: number }[]
    expect(avatars[0]?.name).toBe("空")
    expect(avatars[0]?.img).toBe("https://kong.png")
  })

  it("元素折成 css 认的键、稀有度给 star —— 接口原样的 `Electro` 配不上 `.e-electro`，不给 star 则整排金底", () => {
    const data = roleCardTemplateData(RAW, { uid: "100000001", name: "旅行者", now: NOW })
    const avatars = data["avatars"] as { element: string; star: number }[]
    expect(avatars.map(it => it.element)).toEqual(["anemo", "electro"])
    expect(avatars.map(it => it.star)).toEqual([5, 4])
  })

  it("接口没给 role 时回落成聊天昵称，不显示空白", () => {
    const data = roleCardTemplateData({ stats: {} }, { uid: "100000001", name: "某人", now: NOW })
    expect((data["role"] as { nickname: string }).nickname).toBe("某人")
  })
})

describe("roleExploreTemplateData", () => {
  it("五行统计，宝箱获取率带等第与字色", () => {
    const data = roleExploreTemplateData(RAW, { uid: "100000001", name: "旅行者", now: NOW })
    const line = data["line"] as { lable: string; num: string; color?: string }[][]
    expect(line).toHaveLength(5)
    const rate = line[1]?.find(it => it.lable === "宝箱获取率")
    expect(rate?.num).toMatch(/^[SABCD]\[\d/)
    expect(rate?.color).toBeTruthy()
  })

  it("照官方分组：一张卡一个主地区，特殊区域挂在下面；接口没给分组时表外新地区排最前", () => {
    const data = roleExploreTemplateData(RAW, { uid: "100000001", name: "旅行者", now: NOW })
    const explor = data["explor"] as { key: string; kids: { name: string; pct: string }[] }[]
    expect(explor.map(it => it.key)).toEqual(["新地区", "挪德卡莱", "纳塔", "璃月", "蒙德"])
    expect(explor.find(it => it.key === "蒙德")?.kids.map(k => k.name)).toEqual(["龙脊雪山探索度："])
    // 远古圣山只并进纳塔的详细列表，不单列一行
    expect(explor.find(it => it.key === "纳塔")?.kids).toEqual([])
  })

  it("接口给了 world_exploration_display 时只照它排，特殊区域取它给的探索度", () => {
    const raw: PlayerIndexRaw = {
      ...RAW,
      world_exploration_display: [
        { exploration_id: 1, group: { items: [{ area_ids: [3], exploration_percentage: 950 }] } },
        { exploration_id: 2, group: { items: [{ area_ids: [10, 11], exploration_percentage: 1000 }] } }
      ]
    }
    const explor = roleExploreTemplateData(raw, { uid: "1", name: "n", now: NOW })["explor"] as {
      key: string
      kids: { pct: string }[]
      areas: { name: string }[]
    }[]
    expect(explor.map(it => it.key)).toEqual(["蒙德", "璃月"])
    expect(explor[0]?.kids[0]?.pct).toBe("95%")
    // 沉玉谷本身恒 0、不进详细列表；它下面的子区域照列
    expect(explor[1]?.kids[0]?.pct).toBe("100%")
    expect(explor[1]?.areas.map(a => a.name)).toEqual(["来歆山"])
  })

  it("特殊区域的详细区域与首领并进主地区；子区域自己的等级挂在它那一行", () => {
    const explor = roleExploreTemplateData(RAW, { uid: "1", name: "n", now: NOW })["explor"] as {
      key: string
      areas: { name: string }[]
      bosses: { name: string }[]
      kids: { levels: { name: string; icon: string }[] }[]
    }[]
    const md = explor.find(it => it.key === "蒙德")
    expect(md?.areas.map(a => a.name)).toEqual(["星落湖", "龙脊雪山"])
    expect(md?.bosses.map(b => b.name)).toEqual(["无相之冰"])
    expect(md?.kids[0]?.levels).toEqual([{ icon: "gs/area-offering/Eldertree.png", name: "忍冬之树等级：", value: 12 }])
    const ly = explor.find(it => it.key === "璃月")
    expect(ly?.areas.map(a => a.name)).toEqual(["层岩巨渊", "层岩巨渊·地下矿区", "来歆山"])
  })

  it("头部等级照官方判据：声望只给 Reputation 类，纳塔与挪德卡莱不印声望", () => {
    const explor = roleExploreTemplateData(RAW, { uid: "1", name: "n", now: NOW })["explor"] as {
      key: string
      levels: { name: string }[]
      line: { name: string; text: string }[]
    }[]
    expect(explor.find(it => it.key === "蒙德")?.levels.map(l => l.name)).toEqual(["七天神像等级：", "声望等级："])
    expect(explor.find(it => it.key === "纳塔")?.levels.map(l => l.name)).toEqual(["七天神像等级："])
    expect(explor.find(it => it.key === "挪德卡莱")?.levels.map(l => l.name)).toEqual(["新月神像等级："])
    expect(explor.find(it => it.key === "蒙德")?.line).toEqual([
      { name: "探索度", text: "100%" },
      { name: "龙脊雪山", text: "100%" },
      { name: "声望", text: "10级" }
    ])
  })

  it("纳塔的部族去掉书名号；挪德卡莱的聚所只有 Locked 才算未开启", () => {
    const explor = roleExploreTemplateData(RAW, { uid: "1", name: "n", now: NOW })["explor"] as {
      key: string
      tribes: { name: string }[]
      gathers: { text: string; locked: boolean }[]
    }[]
    expect(explor.find(it => it.key === "纳塔")?.tribes.map(t => t.name)).toEqual(["流泉之众"])
    expect(explor.find(it => it.key === "挪德卡莱")?.gathers.map(g => [g.text, g.locked])).toEqual([
      ["5级", false],
      ["未开启", true]
    ])
  })

  it("尘歌壶四格；接口没给时整块省略", () => {
    const withHome = roleExploreTemplateData(RAW, { uid: "1", name: "n", now: NOW })
    expect(((withHome["data"] as Record<string, unknown>)["homes"] as { line: unknown[] }).line).toHaveLength(4)
    const noHome = roleExploreTemplateData({ stats: {} }, { uid: "1", name: "n", now: NOW })
    expect((noHome["data"] as Record<string, unknown>)["homes"]).toBeUndefined()
  })

  it("七圣召唤取不到时不塞空对象 —— 模板据其存在与否决定是否画这块", () => {
    const none = roleExploreTemplateData(RAW, { uid: "1", name: "n", now: NOW })
    expect(none["basicInfo"]).toBeUndefined()
    const some = roleExploreTemplateData(RAW, { uid: "1", name: "n", now: NOW }, { level: 10 })
    expect(some["basicInfo"]).toEqual({ level: 10 })
  })


  it("空数据不炸", () => {
    expect(() => roleExploreTemplateData({}, { uid: "1", name: "n", now: NOW })).not.toThrow()
  })
})

describe("playerText", () => {
  it("给出最主要的几项，含宝箱获取率", () => {
    const text = playerText(RAW, { uid: "100000001", name: "旅行者", now: NOW })
    expect(text).toContain("100000001")
    expect(text).toContain("成就 1200/")
    expect(text).toContain("深境螺旋 12-3")
  })

  it("空数据也给出一段完整答复", () => {
    expect(playerText({}, { uid: "100000001", name: "某人", now: NOW })).toContain("100000001")
  })
})
