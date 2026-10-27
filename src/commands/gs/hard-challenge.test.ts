/**
 * 模块职责：`#幽境危战` 的测试
 * 依赖方向：测试文件，用假的查询服务驱动 commands/gs/hard-challenge
 * 生命周期：无状态
 * 注意事项：要点是**两种「没有内容」各回一句不同的话** —— 没解锁与本期没打过同样返回 retcode 0，
 *          共用一句话会让「过一阵就有」与「去打一局」分不出来。另固定：取玩家信息失败不影响出图、
 *          游戏不对时明确说明而不是发一次注定失败的请求、不打全服使用率那条接口（与本人战绩无关，
 *          却要占一次每日查询额度）。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../../core/session.js"
import type { MhyDeps } from "../deps.js"
import { hardChallenge } from "./hard-challenge.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图：模板名与数据 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口名 */
  apis: string[]
}

/** 一份能出图的幽境危战返回 */
const HARD_OK = {
  is_unlock: true,
  data: [
    {
      schedule: { start_time: 1_785_000_000, end_time: 1_786_000_000, name: "第 3 期" },
      single: {
        has_data: true,
        best: { difficulty: 6, second: 83 },
        challenge: [
          {
            name: "深廊猎手",
            second: 83,
            monster: { name: "圣骸毒蝎", icon: "https://m.png", level: 100 },
            teams: [{ avatar_id: 10000046, name: "胡桃", element: "Pyro", image: "https://a.png", level: 90, rarity: 5 }]
          }
        ]
      }
    }
  ]
}

/**
 * 造一个会话与一份依赖
 * @param answers 每个接口给什么；`imageOk` 为假时模拟没有渲染器
 * @returns 会话、依赖与记录
 */
function make(answers: {
  /** 战绩接口给的数据 */
  raw?: unknown
  /** 战绩接口是否成功 */
  rawOk?: boolean
  /** 玩家信息接口是否成功 */
  indexOk?: boolean
  /** 出图是否成功 */
  imageOk?: boolean
  /** 游戏 */
  game?: "gs" | "sr" | "zzz"
}): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], apis: [] }
  const s = {
    user: "onebot11:1",
    name: "旅行者",
    rest: "",
    game: answers.game ?? "gs",
    isPrivate: true,
    isMaster: false,
    isGroupAdmin: false,
    botId: "1",
    lastSent: (): string => "",
    text: async (t: string): Promise<void> => void sent.texts.push(t),
    image: async (name: string, data: Record<string, unknown>): Promise<boolean> => {
      sent.images.push({ name, data })
      return answers.imageOk !== false
    }
  } as unknown as Session

  const deps = {
    mys: {
      query: async (name: string): Promise<unknown> => {
        sent.apis.push(name)
        if (name === "index") {
          return answers.indexOk === false
            ? { ok: false, kind: "retcode", message: "取不到" }
            : {
                ok: true,
                uid: "100000001",
                // 带上角色列表：命令层据此 + 面板库 + 元数据造上场角色卡
                data: {
                  role: { nickname: "旅行者", level: 60 },
                  avatars: [{ id: 10000046, name: "胡桃", level: 90, rarity: 5, actived_constellation_num: 2 }]
                }
              }
        }
        return answers.rawOk === false
          ? { ok: false, kind: "retcode", message: "请先绑定角色" }
          : { ok: true, uid: "100000001", data: answers.raw }
      }
    },
    meta: {
      loader: {
        find: (_game: string, id: string, nm: string): { name: string; abbr: string } | undefined =>
          id === "10000046" || nm === "胡桃" ? { name: "胡桃", abbr: "胡桃" } : undefined,
        exists: (): boolean => false
      }
    },
    config: (): Record<string, unknown> => ({})
  } as unknown as MhyDeps

  return { s, deps, sent }
}

describe("hardChallenge", () => {
  it("出图，且头像走元数据", async () => {
    const { s, deps, sent } = make({ raw: HARD_OK })
    await hardChallenge(s, deps)

    expect(sent.images).toHaveLength(1)
    expect(sent.images[0]?.name).toBe("gs/hard-challenge")
    const list = sent.images[0]?.data["challenge"] as { teams: { face: string }[] }[]
    expect(list[0]?.teams[0]?.face).toBe("meta-gs/character/胡桃/imgs/face.webp")
    expect(sent.texts).toEqual([])
  })

  it("没有渲染器时退回文字", async () => {
    const { s, deps, sent } = make({ raw: HARD_OK, imageOk: false })
    await hardChallenge(s, deps)

    expect(sent.texts.join("")).toContain("幽境危战")
    expect(sent.texts.join("")).toContain("圣骸毒蝎")
  })

  it("两种没有内容各回一句不同的话，且都不出图", async () => {
    const cases: [unknown, string][] = [
      [{ is_unlock: false }, "还没有解锁"],
      [{ is_unlock: true, data: [{ single: { has_data: false } }] }, "尚无战绩"]
    ]
    for (const [raw, want] of cases) {
      const { s, deps, sent } = make({ raw })
      await hardChallenge(s, deps)

      expect(sent.images, want).toEqual([])
      expect(sent.texts.join(""), want).toContain(want)
    }
  })

  it("取数失败时把原因说出来", async () => {
    const { s, deps, sent } = make({ rawOk: false })
    await hardChallenge(s, deps)

    expect(sent.texts.join("")).toContain("请先绑定角色")
    expect(sent.images).toEqual([])
  })

  it("取玩家信息失败照样出图 —— 顶栏少一个头像好过整条命令失败", async () => {
    const { s, deps, sent } = make({ raw: HARD_OK, indexOk: false })
    await hardChallenge(s, deps)

    expect(sent.images).toHaveLength(1)
    expect(sent.images[0]?.data["role"]).toEqual({})
  })

  it("不打全服使用率那条接口 —— 它与本人战绩无关且要占查询额度", async () => {
    const { s, deps, sent } = make({ raw: HARD_OK })
    await hardChallenge(s, deps)

    expect(sent.apis).toEqual(["hard_challenge", "index"])
  })

  it("非原神明确说明，一个请求都不发", async () => {
    const { s, deps, sent } = make({ game: "sr" })
    await hardChallenge(s, deps)

    expect(sent.apis).toEqual([])
    expect(sent.texts.join("")).toContain("只有原神有")
  })
})
