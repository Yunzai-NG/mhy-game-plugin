/**
 * 模块职责：账号总览视图模型的测试
 * 依赖方向：测试文件，只依赖 views/profile.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：本文件固定三项内容：**千分数换算为百分比**（漏除以 10 会显示成 889%）、
 *          **旅行者按 id 区分为空与荧**、以及**排序与截断由 limit 决定**而非由命令文本决定。
 */
import { describe, expect, it } from "vitest"
import { buildProfile, profileText } from "./profile.js"

describe("buildProfile", () => {
  it("原神：宝箱汇总、探索度换成百分比、供奉写进附注", () => {
    const view = buildProfile(
      {
        role: { nickname: "旅行者", level: 60, game_head_icon: "https://head.png" },
        stats: {
          active_day_number: 800,
          achievement_number: 900,
          avatar_number: 60,
          full_fetter_avatar_num: 12,
          way_point_number: 200,
          domain_number: 40,
          spiral_abyss: "12-3",
          luxurious_chest_number: 10,
          precious_chest_number: 20,
          exquisite_chest_number: 30,
          common_chest_number: 40,
          magic_chest_number: 5
        },
        world_explorations: [
          { id: 1, name: "蒙德", exploration_percentage: 1000, level: 10 },
          { id: 4, name: "稻妻", exploration_percentage: 889, offerings: [{ name: "神樱", level: 50 }] }
        ],
        homes: [{ level: 10 }],
        avatars: [{ id: 10000007, name: "旅行者", level: 90, rarity: 5, actived_constellation_num: 0 }]
      },
      { game: "gs", uid: "100000001", name: "群友" }
    )

    expect(view.nickname).toBe("旅行者")
    expect(view.level).toBe(60)
    expect(view.activeDays).toBe(800)
    expect(view.stats[0]).toMatchObject({ label: "活跃天数", value: "800" })
    expect(view.stats.find(it => it.label === "深境螺旋")?.value).toBe("12-3")
    // 没打过的玩法与官方主页一样印「-」而非 0
    expect(view.stats.find(it => it.label === "幻想真境剧诗")?.value).toBe("-")
    expect(view.home.find(it => it.label === "信任等阶")?.value).toBe("10")
    // 接口给的 889 是千分数
    expect(view.explore[0]).toMatchObject({ label: "蒙德", percent: 100, extra: "声望 10 级" })
    expect(view.explore[1]).toMatchObject({ label: "稻妻", percent: 88.9, extra: "神樱 50 级" })
    // 接口对两个性别都叫"旅行者"，按 id 分开
    expect(view.avatars[0]?.name).toBe("荧")
  })

  it("角色按稀有度 → 等级 → 命座降序，limit 决定留几个", () => {
    const raw = {
      avatars: [
        { id: 1, name: "四星低", level: 80, rarity: 4, actived_constellation_num: 6 },
        { id: 2, name: "五星低", level: 70, rarity: 5, actived_constellation_num: 0 },
        { id: 3, name: "五星高", level: 90, rarity: 5, actived_constellation_num: 1 },
        { id: 4, name: "五星同级", level: 90, rarity: 5, actived_constellation_num: 3 }
      ]
    }

    expect(buildProfile(raw, { game: "gs", uid: "100000001", name: "群友" }).avatars.map(it => it.name)).toEqual([
      "五星同级",
      "五星高",
      "五星低",
      "四星低"
    ])
    expect(
      buildProfile(raw, { game: "gs", uid: "100000001", name: "群友", limit: 2 }).avatars.map(it => it.name)
    ).toEqual(["五星同级", "五星高"])
  })

  it("星铁：字段名换了一套，出来的形状一样，没有探索度就给空数组", () => {
    const view = buildProfile(
      {
        stats: { active_days: 300, avatar_num: 40, achievement_num: 500, chest_num: 1000, abyss_process: "混沌回忆第 9 层" },
        cur_head_icon_url: "https://sr-head.png",
        avatar_list: [{ id: 1201, name: "彦卿", level: 80, rarity: 5, rank: 2, icon: "https://yq.png", element: "ice" }]
      },
      { game: "sr", uid: "100000001", name: "开拓者" }
    )

    expect(view.gameName).toBe("星穹铁道")
    expect(view.activeDays).toBe(300)
    expect(view.stats.find(it => it.label === "逐光捡金")?.value).toBe("混沌回忆第 9 层")
    expect(view.explore).toEqual([])
    expect(view.avatars[0]).toMatchObject({ name: "彦卿", rarity: 5, cons: 2, element: "ice" })
    // 星铁 index 不提供游戏昵称，此时回落为聊天平台昵称，而非留空
    expect(view.nickname).toBe("开拓者")
    expect(view.icon).toBe("https://sr-head.png")
  })

  it("绝区零：稀有度是字母 S / A，折算成 5 / 4", () => {
    const view = buildProfile(
      {
        stats: { active_days: 100, avatar_num: 20, buddy_num: 8, achievement_count: 200, cur_period_zone_layer_count: 5 },
        avatar_list: [
          { id: 1011, name_mi18n: "安比", level: 60, rarity: "A", rank: 6, element_type: 200 },
          { id: 1041, name_mi18n: "艾莲", level: 60, rarity: "S", rank: 1 }
        ]
      },
      { game: "zzz", uid: "10000001", name: "绳匠" }
    )

    expect(view.stats.find(it => it.label === "获得邦布数")?.value).toBe("8")
    expect(view.stats.find(it => it.label === "式舆防卫战")?.value).toBe("5")
    expect(view.avatars.map(it => `${it.name}${it.rarity}`)).toEqual(["艾莲5", "安比4"])
    // 折成 css 的元素类名：原样的 `200` 拼出 `e-200`，头像格没有元素色
    expect(view.avatars[1]?.element).toBe("physical")
  })

  it("三个游戏的元素都折成皮肤 css 认的类名", () => {
    const gs = buildProfile({ avatars: [{ id: 1, name: "胡桃", rarity: 5, element: "Pyro" }] }, { game: "gs", uid: "100000001", name: "x" })
    const sr = buildProfile({ avatar_list: [{ id: 1, name: "希儿", rarity: 5, element: "Quantum" }] }, { game: "sr", uid: "100000001", name: "x" })
    expect(gs.avatars[0]?.element).toBe("pyro")
    expect(sr.avatars[0]?.element).toBe("quantum")
  })

  it("绝区零头像按 id 查元数据，**不用 group_icon_path** —— 那是阵营徽记，画出来是一排云岿山的牌子", () => {
    const view = buildProfile(
      {
        avatar_list: [
          { id: 1431, name_mi18n: "叶瞬光", level: 60, rarity: "S", rank: 2, group_icon_path: "https://a.invalid/camp.png" },
          { id: 9999, name_mi18n: "新人", level: 1, rarity: "A", rank: 0, group_icon_path: "https://a.invalid/camp.png" }
        ]
      },
      {
        game: "zzz",
        uid: "10000001",
        name: "绳匠",
        faceOf: (id: string): string => (id === "1431" ? "meta-zzz/character/叶瞬光/imgs/face.webp" : "")
      }
    )

    expect(view.avatars[0]?.icon).toBe("meta-zzz/character/叶瞬光/imgs/face.webp")
    // 元数据里没有的宁可空着（模板画首字），也不画阵营徽记
    expect(view.avatars[1]?.icon).toBeUndefined()
  })

  it("空 data 也能出视图 —— 缺字段最多让某一条统计显示 0", () => {
    const view = buildProfile({}, { game: "gs", uid: "100000001", name: "群友" })

    expect(view.level).toBe(0)
    expect(view.avatars).toEqual([])
    expect(view.home).toEqual([])
    expect(view.bg).toBeUndefined()
    expect(() => profileText(view)).not.toThrow()
  })
})

describe("profileText", () => {
  it("先昵称与等级，再统计前六条，最后探索度与角色", () => {
    const view = buildProfile(
      {
        role: { nickname: "旅行者", level: 60 },
        stats: { active_day_number: 800, achievement_number: 900, avatar_number: 60 },
        world_explorations: [{ id: 1, name: "蒙德", exploration_percentage: 1000 }],
        avatars: [{ id: 10000002, name: "神里绫华", level: 90, rarity: 5, actived_constellation_num: 0 }]
      },
      { game: "gs", uid: "100000001", name: "群友" }
    )
    const text = profileText(view)

    expect(text.split("\n")[0]).toBe("旅行者 100000001（官服）")
    expect(text.split("\n")[1]).toBe("原神 60 级，活跃 800 天")
    expect(text).toContain("成就达成数 900")
    expect(text).toContain("探索度 蒙德 100%")
    expect(text).toContain("角色 1 个：神里绫华90")
  })
})
