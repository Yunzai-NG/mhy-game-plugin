/**
 * 模块职责：幽境危战视图模型的测试
 * 依赖方向：测试文件，只依赖 views/gs/hard-challenge（纯函数）与 core/api（核对接口名）
 * 生命周期：无状态
 * 注意事项：固定四处：用时要精确到秒（这个玩法比的正是秒数，套用 `duration` 会把 47 秒与 3 秒
 *          说成同一句话）、队伍与亮眼记录恒为数组（模板对二者取 `.length`，接口某场没记录时不给
 *          这两个键）、上场队伍按 id 取卡 / 查不到退回占位卡（占位卡元素小写、命座 0、天赋空）、
 *          亮眼记录一张图都取不到时整块不出现而非画一排空格子。
 */
import { describe, expect, it } from "vitest"
import { apiNames } from "../../core/api.js"
import { stamp } from "../../core/text.js"
import type { HardChallengeRaw } from "./hard-challenge.js"
import {
  hardChallengeState,
  hardChallengeTemplateData,
  hardChallengeText,
  hardDescParts,
  hardDifficultyName,
  hardSecondText,
  hardTimeText
} from "./hard-challenge.js"

/** 2026-08-01 的 unix 秒 */
const START = Math.floor(new Date(2026, 7, 1).getTime() / 1000)

/** 一份形态照实测的返回；第二场刻意不给 teams 与 best_avatar */
const RAW: HardChallengeRaw = {
  is_unlock: true,
  data: [
    {
      schedule: { start_time: String(START), end_time: String(START + 86_400 * 14), name: "第 3 期" },
      single: {
        has_data: true,
        best: { difficulty: 6, second: 83 },
        challenge: [
          {
            name: "深廊猎手",
            second: 83,
            monster: { name: "圣骸毒蝎", icon: "https://m.png", level: 100 },
            best_avatar: [{ avatar_id: 10000046, side_icon: "https://s.png", dps: 128_000, type: 1 }],
            teams: [
              { avatar_id: 10000046, name: "胡桃", element: "Pyro", image: "https://a.png", level: 90, rarity: 5, rank: 2 },
              { avatar_id: 10000032, name: "班尼特", element: "Pyro", image: "https://b.png", level: 90, rarity: 4 }
            ]
          },
          { name: "秘源机兵", second: 47, monster: { name: "机关" } }
        ]
      }
    }
  ]
}

/** 上场卡按 id 查，与命令层同一形态 */
const CTX = {
  uid: "100000001",
  role: { nickname: "旅行者", level: 60, game_head_icon: "https://head.png" },
  cards: {
    "10000046": {
      id: "10000046",
      name: "胡桃",
      abbr: "胡桃",
      elem: "pyro",
      star: 5,
      level: 90,
      cons: 2,
      game: "gs" as const,
      face: "meta-gs/character/胡桃/imgs/face.webp",
      gacha: "meta-gs/character/胡桃/imgs/gacha.webp",
      preview: "",
      talent: { a: { level: 8, original: 8 } },
      tals: [{ key: "a", name: "", level: 8, crown: false }],
      xtals: [],
      weapon: { star: 5, img: "w.webp", affix: 1 },
      artisSet: { names: [] as string[], imgs: [] as string[] }
    }
  }
}

describe("接口名", () => {
  it("hard_challenge 在原神接口表里 —— 写错的表现是运行时「接口不存在」", () => {
    expect(apiNames("gs")).toContain("hard_challenge")
  })
})

describe("hardChallengeState", () => {
  it("没解锁与没打过分得开 —— 前者是这个账号没有这个玩法，后者过一局就有", () => {
    expect(hardChallengeState(RAW)).toBe("ok")
    expect(hardChallengeState({ is_unlock: false })).toBe("locked")
    expect(hardChallengeState({ is_unlock: true, data: [{ single: { has_data: false } }] })).toBe("noData")
    // 明说有战绩但一场都没有，同样算没打过
    expect(hardChallengeState({ is_unlock: true, data: [{ single: { has_data: true, challenge: [] } }] })).toBe("noData")
    expect(hardChallengeState(undefined)).toBe("noData")
  })
})

describe("hardSecondText", () => {
  it("精确到秒 —— 这个玩法比的正是秒数", () => {
    expect(hardSecondText(47)).toBe("47 秒")
    expect(hardSecondText(83)).toBe("1 分 23 秒")
    // 整分钟不写「0 秒」
    expect(hardSecondText(120)).toBe("2 分")
    expect(hardSecondText(0)).toBe("")
    expect(hardSecondText(undefined)).toBe("")
  })
})

describe("hardTimeText", () => {
  it("秒级时间戳按秒算 —— 当成毫秒会得到 1970 年", () => {
    expect(hardTimeText(START)).toBe(stamp(START * 1000))
    expect(hardTimeText(String(START))).toBe(stamp(START * 1000))
    expect(hardTimeText(0)).toBe("")
  })
})

/** 取视图里的挑战数组 */
function challengeOf(raw: HardChallengeRaw | undefined = RAW): Record<string, unknown>[] {
  return hardChallengeTemplateData(raw, CTX)["challenge"] as Record<string, unknown>[]
}

describe("hardChallengeTemplateData", () => {
  it("队伍与亮眼记录恒为数组 —— 模板对二者取 length，缺键会让整张图出不来", () => {
    const second = challengeOf()[1]
    expect(second?.["teams"]).toEqual([])
    expect(second?.["best"]).toEqual([])
  })

  it("上场队伍按 id 取整张卡，查不到退回只带接口头像的占位卡", () => {
    const teams = challengeOf()[0]?.["teams"] as {
      face: string
      elem: string
      cons: number
      talent: Record<string, unknown>
    }[]

    // 胡桃命中卡 map：带元数据头像与天赋
    expect(teams[0]?.face).toBe("meta-gs/character/胡桃/imgs/face.webp")
    expect(teams[0]?.talent).toHaveProperty("a")
    // 班尼特不在卡 map：占位卡只带接口头像、元素小写、天赋空、命座 0
    expect(teams[1]?.face).toBe("https://b.png")
    expect(teams[1]?.elem).toBe("pyro")
    expect(teams[1]?.cons).toBe(0)
    expect(teams[1]?.talent).toEqual({})
  })

  it("亮眼记录按 type 定名目、头像取自角色卡（元数据），接口那几个图键不用", () => {
    const ok = challengeOf()[0]?.["best"] as { title: string; icon: string; dps: string }[]
    expect(ok).toHaveLength(1)
    expect(ok[0]?.title).toBe("最强一击")
    expect(ok[0]?.icon).toBe("meta-gs/character/胡桃/imgs/face.webp")
    expect(ok[0]?.dps).toBe("128000")

    // 不给数值的那一项不画
    const raw: HardChallengeRaw = {
      is_unlock: true,
      data: [{ single: { has_data: true, challenge: [{ name: "x", best_avatar: [{ avatar_id: 1 }] }] } }]
    }
    expect(challengeOf(raw)[0]?.["best"]).toEqual([])
  })

  it("机制说明拆成着色段：颜色只收十六进制，夹带的其他标签剥掉，空行不留", () => {
    expect(hardDescParts("受到<color=#FF9999FF>火</color>伤害")).toEqual([
      { text: "受到", color: "" },
      { text: "火", color: "#FF9999FF" },
      { text: "伤害", color: "" }
    ])
    expect(hardDescParts('<color=red;x:url(a)>坏</color><b onclick="x">字</b>')).toEqual([
      { text: "坏", color: "" },
      { text: "字", color: "" }
    ])
    expect(hardDescParts("")).toEqual([])
  })

  it("期次与最佳记录都取到，玩家信息缺失时是空对象", () => {
    const view = hardChallengeTemplateData(RAW, { uid: "1" })
    expect(view["role"]).toEqual({})
    expect(view["difficulty"]).toBe(6)
    // 米游社自己的页面把档位印成官方名，故模板取的是这一栏
    expect(view["difficultyName"]).toBe("绝境")
    expect(view["bestTime"]).toBe("1 分 23 秒")
    expect(view["season"]).toBe("第 3 期")
    expect(view["begin"]).toBe(stamp(START * 1000))
  })

  it("一场都没有时各项恒有值 —— 模板直接印它们", () => {
    const view = hardChallengeTemplateData({ is_unlock: true, data: [{}] }, { uid: "1" })
    expect(view["difficulty"]).toBe(0)
    expect(view["difficultyName"]).toBe("")
    expect(view["bestTime"]).toBe("")
    expect(view["season"]).toBe("")
    expect(view["begin"]).toBe("")
    expect(view["challenge"]).toEqual([])
  })

  it("表里没有的档位退回原数字 —— 出一个陌生数字仍比出空白有用", () => {
    expect(hardDifficultyName(7)).toBe("7")
    expect(hardDifficultyName(0)).toBe("")
    expect(hardDifficultyName(undefined)).toBe("")
  })
})

describe("hardChallengeText", () => {
  it("逐场列出对手与上场角色 —— 换了对手用时便不可比", () => {
    const text = hardChallengeText(RAW, CTX)

    expect(text).toContain("UID100000001 幽境危战 · 第 3 期")
    expect(text).toContain("难度 绝境")
    expect(text).toContain("对手 圣骸毒蝎")
    expect(text).toContain("胡桃、班尼特")
    // 没有队伍记录的那一场要明说，不能留一个空冒号
    expect(text).toContain("无记录")
  })

  it("一场都没有时同样是一段可读文本", () => {
    expect(hardChallengeText({ is_unlock: true, data: [{}] }, { uid: "1" })).toContain("UID1 幽境危战")
  })
})
