/**
 * 模块职责：深渊 / 混沌回忆 / 式舆防卫战命令的测试
 * 依赖方向：测试文件，依赖 commands/abyss 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：只钉**按游戏分三路**：原神走 `views/abyss` 两套模板、星铁走 `abyss/sr-challenge`、
 *          绝区零走 `zzz/defense`。三者接口名同为 `spiralAbyss` 而形态毫无重合，混淆的表现不是
 *          报错而是出一张各项均为空的图。另钉住星铁那一路不另取 index（原神那一路要取命座）。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../core/session.js"
import type { MhyDeps } from "./deps.js"
import { abyss } from "./abyss.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口 */
  apis: string[]
}

/** 一份能出图的星铁混沌回忆返回 */
const SR_OK = {
  has_data: true,
  star_num: 30,
  max_floor: "混沌回忆第 12 层",
  battle_num: 12,
  groups: [{ name_mi18n: "第 20 期" }, { name_mi18n: "第 19 期" }],
  all_floor_detail: [
    { name: "第 11 层", star_num: 3, is_fast: true },
    {
      name: "第 12 层",
      star_num: 3,
      round_num: 5,
      node_1: { avatars: [{ id: 1306, level: 80, icon: "https://a.png", rarity: 5 }] },
      node_3: { avatars: [{ id: 1013, level: 80, icon: "https://b.png", rarity: 4 }] }
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
  /** 出图是否成功 */
  imageOk?: boolean
  /** 游戏 */
  game?: "gs" | "sr" | "zzz"
  /** 命令后面跟的那一串 */
  rest?: string
}): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], apis: [] }
  const s = {
    user: "onebot11:1",
    name: "开拓者",
    rest: answers.rest ?? "",
    game: answers.game ?? "sr",
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
    config: (): Record<string, unknown> => ({}),
    mys: {
      query: async (api: string): Promise<Record<string, unknown>> => {
        sent.apis.push(api)
        return { ok: true, uid: "101234567", data: api === "index" ? {} : (answers.raw ?? {}) }
      }
    },
    meta: {
      loader: {
        byId: (_game: string, id: string): { abbr: string } | undefined =>
          id === "1306" ? { abbr: "花火" } : undefined
      }
    }
  } as unknown as MhyDeps

  return { s, deps, sent }
}

describe("abyss", () => {
  it("星铁走 sr/challenge-memory，且不另取 index —— 那一路不显示命座", async () => {
    const { s, deps, sent } = make({ raw: SR_OK })
    await abyss(s, deps)

    expect(sent.apis).toEqual(["spiralAbyss"])
    expect(sent.images[0]?.name).toBe("sr/challenge-memory")
    expect(sent.images[0]?.data["title"]).toBe("混沌回忆")
    expect(sent.images[0]?.data["type"]).toBe(1)
  })

  it("星铁排掉速通的关卡，并认到第三个节点", async () => {
    const { s, deps, sent } = make({ raw: SR_OK })
    await abyss(s, deps)

    const story = sent.images[0]?.data["story"] as {
      floors: { name: string; nodes: { avatars: unknown[] }[] }[]
    }
    // 第 11 层是速通，混沌回忆不列它
    expect(story.floors.map(it => it.name)).toEqual(["第 12 层"])
    // node_3 要认得出：写死两个会把 1013 静默丢掉
    expect(story.floors[0]?.nodes).toHaveLength(3)
    expect(story.floors[0]?.nodes[2]?.avatars).toHaveLength(1)
  })

  it("星铁上期取 groups 的第 1 项", async () => {
    const { s, deps, sent } = make({ raw: SR_OK, rest: "上期" })
    await abyss(s, deps)

    const story = sent.images[0]?.data["story"] as { season: string }
    expect(story.season).toBe("第 19 期")
    expect(sent.images[0]?.data["type"]).toBe(2)
  })

  it("星铁没有渲染器时退回文字", async () => {
    const { s, deps, sent } = make({ raw: SR_OK, imageOk: false })
    await abyss(s, deps)

    expect(sent.texts.join("")).toContain("混沌回忆")
    expect(sent.texts.join("")).toContain("花火")
  })

  it("星铁本期没打过时只回一句话，不出一张全空的图", async () => {
    const { s, deps, sent } = make({ raw: { has_data: false } })
    await abyss(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("尚无战绩")
  })

  it("绝区零转给式舆防卫战 —— 同一个接口名，形态与另两个游戏毫无重合", async () => {
    const { s, deps, sent } = make({
      game: "zzz",
      raw: {
        hadal_ver: "v2",
        hadal_info_v2: {
          brief: { score: 150_000, rating: "S+", rank_percent: 137 },
          fitfh_layer_detail: {
            rating: "S+",
            layer_challenge_info_list: [
              { score: 50_000, avatar_list: [{ id: 1011, level: 60, rarity: "S", role_square_url: "https://a.png" }] }
            ]
          }
        }
      }
    })
    await abyss(s, deps)

    expect(sent.apis).toEqual(["spiralAbyss"])
    expect(sent.images[0]?.name).toBe("zzz/defense")
    expect(sent.images[0]?.data["title"]).toBe("式舆防卫战")
  })

  it("绝区零那一路是旧版深渊数据时说明白，不出一张全零的图", async () => {
    const { s, deps, sent } = make({ game: "zzz", raw: { hadal_ver: "v1" } })
    await abyss(s, deps)

    expect(sent.images).toEqual([])
    // 钉"说了是旧版、且说了不出图"，不钉具体措辞
    expect(sent.texts.join("")).toContain("旧版")
    expect(sent.texts.join("")).toContain("全是零")
  })
})
