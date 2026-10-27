/**
 * 模块职责：星穹铁道三类挑战视图模型的测试
 * 依赖方向：测试文件，只依赖 views/sr/challenge（纯函数）与 core/api（核对接口名）
 * 生命周期：无状态
 * 注意事项：固定几处**不报错却让整张图出不来或印错**处：节点个数按实取、角色恒为数组（新档位每关
 *          三个节点，接口只打了第一个时不给 `node_2`，模板逐层取值并对角色取 `.length`）、星格由
 *          本层摊成数组、0 分与"这一类不计分"要分得开、祝福说明要剥掉富文本标签。另固定：三个接口
 *          名必须在 `core/api.ts` 的星铁表里真实存在，以及"没有内容"两种成因（没打过 / 给了数据
 *          却没有关卡明细）要分得开。
 */
import { describe, expect, it } from "vitest"
import { apiNames } from "../../core/api.js"
import type { SrChallengeRaw } from "./challenge.js"
import {
  floorNodes,
  srChallengeApi,
  srChallengePlain,
  srChallengeState,
  srChallengeTemplateData,
  srChallengeText,
  srChallengeTime,
  srChallengeTitle
} from "./challenge.js"

/** 一份形态照实测的返回；第二关刻意只有第一个节点，第三关有三个节点 */
const RAW: SrChallengeRaw = {
  has_data: true,
  star_num: 9,
  max_floor: "第 4 层",
  battle_num: 12,
  groups: [
    {
      name_mi18n: "第 20 期",
      begin_time: { year: 2026, month: 8, day: 1, hour: 4, minute: 0 },
      end_time: { year: 2026, month: 9, day: 14, hour: 3, minute: 59 }
    }
  ],
  all_floor_detail: [
    {
      name: "第 1 层",
      star_num: 3,
      round_num: 4,
      is_fast: true,
      node_1: {
        score: "40000",
        challenge_time: { year: 2026, month: 8, day: 2, hour: 2, minute: 51 },
        buff: { name_mi18n: "劫火", desc_mi18n: "<color=#f29e38ff>火</color>属性伤害提高\\n30%", icon: "https://a.png" },
        avatars: [
          { id: 1306, level: 80, icon: "https://b.png", rarity: 5, element: "Fire", rank: 2 },
          { id: 1013, level: 80, icon: "https://c.png", rarity: 4, element: "quantum" }
        ]
      },
      node_2: { score: 0, avatars: [{ id: 1306, level: 80, icon: "https://b.png", rarity: 5 }] }
    },
    // 第二关刻意不给 node_2 与 round_num：接口在没有时确实不给这些键
    { name: "第 2 层", star_num: 1, node_1: { avatars: [{ id: 1013, icon: "https://c.png" }] } },
    // 第三关是新档位那一类：三个节点，末一个还没打
    {
      name: "第 3 层星启模式",
      star_num: 3,
      node_1: { score: 3575, avatars: [{ id: 1306, level: 80 }] },
      node_2: { score: 311, avatars: [{ id: 1013, level: 80 }] },
      node_3: {}
    }
  ]
}

/** 名字按 id 查，与命令层同一形态 */
const CTX = { kind: "story" as const, uid: "101234567", nameOf: (id: string): string => (id === "1306" ? "花火" : "") }

describe("srChallengeApi", () => {
  it("四个接口名都在星铁接口表里 —— 写错的表现是运行时「接口不存在」", () => {
    const names = apiNames("sr")
    for (const kind of ["memory", "story", "boss", "peak"] as const) {
      expect(names, srChallengeTitle(kind)).toContain(srChallengeApi(kind))
    }
  })

  it("四类各有中文名，且互不相同", () => {
    const titles = (["memory", "story", "boss", "peak"] as const).map(srChallengeTitle)
    expect(titles).toEqual(["混沌回忆", "虚构叙事", "末日幻影", "异相仲裁"])
  })
})

describe("srChallengeState", () => {
  it("两种没有内容分得开 —— 一种是去打一局，另一种是接口形态可能已变", () => {
    expect(srChallengeState(RAW)).toBe("ok")
    expect(srChallengeState({ has_data: false })).toBe("noData")
    expect(srChallengeState(undefined)).toBe("noData")
    // 明说有数据却一关都没有：那不是"没打过"
    expect(srChallengeState({ has_data: true })).toBe("noDetail")
    expect(srChallengeState({ has_data: true, all_floor_detail: [] })).toBe("noDetail")
    // 没有 has_data 这一栏且没有关卡时按"没打过"处理，不报可疑
    expect(srChallengeState({})).toBe("noData")
  })

  it("异相仲裁那一套要单独认出来 —— 回「没打过」会让人打完一局再来看同一句话", () => {
    expect(srChallengeState({ challenge_peak_records: [] })).toBe("otherShape")
    expect(srChallengeState({ challenge_peak_records: [{}] })).toBe("otherShape")
  })
})

describe("srChallengeTime", () => {
  it("缺月或日即视为没有这个时刻 —— 补一个当前年份会得到一个编造的日期", () => {
    expect(srChallengeTime({ year: 2026, month: 8, day: 1, hour: 4, minute: 0 })).toBe("08-01 04:00")
    // 时分接口有时不给，按零点算；月日缺任一即空串
    expect(srChallengeTime({ year: 2026, month: 8, day: 1 })).toBe("08-01 00:00")
    expect(srChallengeTime({ year: 2026, month: 8 })).toBe("")
    expect(srChallengeTime(undefined)).toBe("")
  })
})

describe("srChallengePlain", () => {
  it("剥掉富文本标签与字面换行 —— 原样印出会得到一段夹着标签的文字", () => {
    expect(srChallengePlain("<color=#f29e38ff>火</color>属性伤害提高\\n30%")).toBe("火属性伤害提高 30%")
    expect(srChallengePlain(undefined)).toBe("")
  })
})

/** 取视图里的关卡数组 */
function floorsOf(raw: SrChallengeRaw | undefined = RAW): Record<string, unknown>[] {
  return srChallengeTemplateData(raw, CTX)["floors"] as Record<string, unknown>[]
}

describe("floorNodes", () => {
  it("按 node_<数字> 就地认键 —— 新档位每关三个节点，写死两个会静默丢掉第三个", () => {
    const third = RAW.all_floor_detail?.[2]
    expect(floorNodes(third)).toHaveLength(3)
    // 只有第一个节点时仍给两格：第二格由视图兜成空节点，模板据角色个数自行隐藏
    expect(floorNodes({ node_1: {} })).toHaveLength(2)
    expect(floorNodes(undefined)).toHaveLength(2)
    // 缺号的那一位是 undefined 而不是塌缩掉，序号与节点名才对得上
    expect(floorNodes({ node_2: { score: 1 } })).toEqual([undefined, { score: 1 }])
    // 不是节点的键一概不认，脏值也不认
    expect(floorNodes({ name: "第 1 层", node_1: undefined })).toEqual([undefined, undefined])
  })
})

describe("srChallengeTemplateData", () => {
  it("节点个数按实取、角色恒为数组 —— 接口只打第一个节点时不给 node_2", () => {
    const second = floorsOf()[1]
    const nodes = second?.["nodes"] as { avatars: unknown[]; label: string }[]

    expect(nodes).toHaveLength(2)
    expect(Array.isArray(nodes[1]?.avatars)).toBe(true)
    expect(nodes[1]?.avatars).toEqual([])
    expect(nodes.map(it => it.label)).toEqual(["节点1", "节点2"])

    // 三个节点的那一关三格都在，第三格没打过故角色为空数组
    const third = floorsOf()[2]?.["nodes"] as { avatars: unknown[]; label: string }[]
    expect(third.map(it => it.label)).toEqual(["节点1", "节点2", "节点3"])
    expect(third[2]?.avatars).toEqual([])
  })

  it("每关总分是各节点得分之和 —— 不赌一个未经核实的字段名", () => {
    const floors = floorsOf()
    expect(floors[2]?.["total"]).toBe("3886")
    // 这一类挑战本就不计分时给空串，印一个 0 会让人以为打了没拿分
    expect(floors[1]?.["total"]).toBe("")
  })

  it("虚构叙事速通的那一关不计分也不记轮次 —— 速通是没打的意思", () => {
    // 第一关带 is_fast 与 round_num 4，虚构叙事按官方口径两项都归零
    const story = floorsOf()[0]
    expect(story?.["total"]).toBe("")
    expect(story?.["round"]).toBe(0)
    expect(story?.["fast"]).toBe(true)

    // 末日幻影不受这条约束，速通那一关照样计分记轮次
    const boss = (srChallengeTemplateData(RAW, { ...CTX, kind: "boss" })["floors"] as Record<string, unknown>[])[0]
    expect(boss?.["total"]).toBe("40000")
    expect(boss?.["round"]).toBe(4)
  })

  it("额外星先减掉再画格子 —— 不减则「实得 4 星」占出四个格子", () => {
    const floors = floorsOf({
      has_data: true,
      all_floor_detail: [{ name: "第 1 层", star_num: 4, extra_star_num: 1 }]
    })
    expect(floors[0]?.["star"]).toBe(3)
    expect(floors[0]?.["extraStar"]).toBe(1)
    expect(floors[0]?.["stars"]).toEqual([true, true, true])
  })

  it("混沌回忆排掉速通的关卡 —— 那几关没有战斗记录，列出来只是一排空卡片", () => {
    const raw: SrChallengeRaw = {
      has_data: true,
      all_floor_detail: [
        { name: "第 1 层", star_num: 3, is_fast: true },
        { name: "第 2 层", star_num: 3, node_1: { avatars: [{ id: 1306 }] } }
      ]
    }
    const memory = srChallengeTemplateData(raw, { ...CTX, kind: "memory" })["floors"] as Record<string, unknown>[]
    expect(memory.map(it => it["name"])).toEqual(["第 2 层"])
    // 另两类不排 —— 它们的速通关是"这一关不必打"，仍要列出来
    const story = srChallengeTemplateData(raw, CTX)["floors"] as Record<string, unknown>[]
    expect(story).toHaveLength(2)
  })

  it("整期总分与额外星只在接口给了时才有 —— 模板对它们做 if 判断", () => {
    const view = srChallengeTemplateData({ has_data: true, score: 240000, extra_star_num: 2 }, CTX)
    expect(view["totalScore"]).toBe("240000")
    expect(view["extraStar"]).toBe(2)

    const bare = srChallengeTemplateData({ has_data: true }, CTX)
    expect(bare["totalScore"]).toBe("")
    expect(bare["extraStar"]).toBe(0)
  })

  it("节点的挑战时刻取到就印，取不到是空串而非 undefined", () => {
    const nodes = floorsOf()[0]?.["nodes"] as { time: string }[]
    expect(nodes[0]?.time).toBe("08-02 02:51")
    expect(nodes[1]?.time).toBe("")
  })

  it("星格摊成数组，长度不小于三、置真的个数即实得星数", () => {
    const [first, second] = floorsOf()
    const firstStars = first?.["stars"] as boolean[]
    const secondStars = second?.["stars"] as boolean[]

    expect(firstStars).toEqual([true, true, true])
    expect(secondStars).toEqual([true, false, false])
    // 实得多于三星时格子跟着变多，而不是画三个而丢掉后面的
    const many = floorsOf({ has_data: true, all_floor_detail: [{ star_num: 5 }] })[0]?.["stars"] as boolean[]
    expect(many).toHaveLength(5)
    expect(many.filter(Boolean)).toHaveLength(5)
  })

  it("0 分与「这一类不计分」分得开 —— 前者要印出来，后者那一格不出现", () => {
    const nodes = floorsOf()[0]?.["nodes"] as { score: string }[]
    expect(nodes[0]?.score).toBe("40000")
    expect(nodes[1]?.score).toBe("0")

    const plain = floorsOf()[1]?.["nodes"] as { score: string }[]
    expect(plain[0]?.score).toBe("")
  })

  it("命途键转小写，名字按 id 查元数据、查不到留空串", () => {
    const nodes = floorsOf()[0]?.["nodes"] as { avatars: { element: string; name: string; rarity: number }[] }[]
    const avatars = nodes[0]?.avatars ?? []

    expect(avatars[0]?.element).toBe("fire")
    expect(avatars[1]?.element).toBe("quantum")
    expect(avatars[0]?.name).toBe("花火")
    expect(avatars[1]?.name).toBe("")
    // 星级接口不给时按四星画框，画不出框比画错框好
    expect(avatars[1]?.rarity).toBe(4)
  })

  it("祝福三项恒为字符串 —— 模板对它们做 if 判断", () => {
    const nodes = floorsOf()[0]?.["nodes"] as { buffName: string; buffIcon: string; buffDesc: string }[]
    expect(nodes[0]?.buffName).toBe("劫火")
    expect(nodes[0]?.buffDesc).toBe("火属性伤害提高 30%")
    expect(nodes[1]?.buffName).toBe("")
    expect(nodes[1]?.buffDesc).toBe("")
  })

  it("统计各项恒为数字或字符串，一关都没有时也不抛错", () => {
    const view = srChallengeTemplateData({ has_data: true }, { kind: "peak", uid: "1" })
    expect(view["starNum"]).toBe(0)
    expect(view["battleNum"]).toBe(0)
    expect(view["maxFloor"]).toBe("")
    expect(view["season"]).toBe("")
    expect(view["title"]).toBe("异相仲裁")
    expect(view["floors"]).toEqual([])
  })

  it("期次标签由命令层给 —— 同一张模板同时服务本期与上期", () => {
    const view = srChallengeTemplateData(RAW, { ...CTX, period: "上期" })
    expect(view["period"]).toBe("上期")
    expect(view["season"]).toBe("第 20 期")
    expect(view["begin"]).toBe("08-01 04:00")
    // 不给期次标签时是空串而不是 undefined，模板对它做 if 判断
    expect(srChallengeTemplateData(RAW, CTX)["period"]).toBe("")
  })

  it("上期取 groups 的第 1 项 —— 恒取第 0 项会让上期那张图印着本期的期次", () => {
    const raw: SrChallengeRaw = {
      ...RAW,
      groups: [
        { name_mi18n: "第 20 期", begin_time: { year: 2026, month: 8, day: 1 } },
        { name_mi18n: "第 19 期", begin_time: { year: 2026, month: 6, day: 20 } }
      ]
    }
    const now = srChallengeTemplateData(raw, CTX)
    const last = srChallengeTemplateData(raw, { ...CTX, period: "上期", prev: true })

    expect(now["season"]).toBe("第 20 期")
    expect(last["season"]).toBe("第 19 期")
    expect(last["begin"]).toBe("06-20 00:00")
    // 纯文字形态也要跟着走，否则两条回复的期次名对不上
    expect(srChallengeText(raw, { ...CTX, prev: true })).toContain("第 19 期")
  })
})

describe("srChallengeText", () => {
  it("逐关列出各节点，名字取不到时退回 id", () => {
    const text = srChallengeText(RAW, CTX)

    expect(text).toContain("UID101234567 虚构叙事 · 第 20 期")
    expect(text).toContain("最深抵达 第 4 层")
    expect(text).toContain("花火")
    // 1013 没有名字，退回 id 仍比整行消失有用
    expect(text).toContain("1013")
    expect(text).toContain("祝福 劫火")
    expect(text).toContain("速通")
    expect(text).toContain("节点1")
    expect(text).toContain("总分 3886")
    // 一个角色都没有的那一格整行不出现 —— 印一行"无记录"只是多占一行
    expect(text).not.toContain("无记录")
  })

  it("一关都没有时同样是一段可读文本", () => {
    expect(srChallengeText({ has_data: true }, { kind: "boss", uid: "1" })).toContain("UID1 末日幻影")
  })
})
