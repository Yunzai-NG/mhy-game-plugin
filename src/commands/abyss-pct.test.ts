/**
 * 模块职责：出场率命令的测试
 * 依赖方向：测试文件，依赖 commands/abyss-pct 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：钉住四条：开关关着时不出图并说清去哪里打开、只有原神受理、没有本期数据时说「稍后
 *          再试」而不是出一张空图，以及**这条命令一个凭据都不用**（`mys.query` 与 `users.uid`
 *          一次都不该被碰）。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../core/session.js"
import type { MhyDeps } from "./deps.js"
import { abyssPct, hardChallengePct } from "./abyss-pct.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 取过几次出场率，以及取的是哪一种 */
  pcts: string[]
  /** 碰过几次米游社查询与 uid —— 必须恒为 0，见文件头 */
  mys: number
}

/** 一份能出图的排行 */
const RAW = {
  code: 200,
  version: "6.2",
  update: "更新时间：2026-09-08",
  top_own: 12_345,
  tips: "本期数据仍在汇总",
  has_list: [
    { name: "胡桃", use_rate: 62.3, rank_class: "s1" },
    { name: "钟离", use_rate: 48, rank_class: "s" },
    { name: "香菱", use_rate: 21.5, rank_class: "a" }
  ]
}

/**
 * 造一个会话与一份依赖
 * @param answers 取数回什么、哪个游戏、开关开没开、出不出得了图
 * @returns 会话、依赖与记录
 */
function make(answers: {
  /** 出场率取数回什么；`null` 表示取不到 */
  raw?: unknown
  /** 游戏 */
  game?: "gs" | "sr" | "zzz"
  /** 开关 */
  enabled?: boolean
  /** 有没有取数器 */
  hasService?: boolean
  /** 出图是否成功 */
  imageOk?: boolean
}): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], pcts: [], mys: 0 }

  const s = {
    user: "onebot11:1",
    game: answers.game ?? "gs",
    rest: "",
    text: async (t: string): Promise<void> => void sent.texts.push(t),
    image: async (name: string, data: Record<string, unknown>): Promise<boolean> => {
      sent.images.push({ name, data })
      return answers.imageOk !== false
    }
  } as unknown as Session

  const deps = {
    config: (): Record<string, unknown> => ({ enableWikiStat: answers.enabled !== false }),
    // 这两个口一次都不该被碰到，被碰到就让计数涨起来
    users: {
      uid: async (): Promise<string> => {
        sent.mys++
        return "100000001"
      }
    },
    mys: {
      query: async (): Promise<Record<string, unknown>> => {
        sent.mys++
        return { ok: false }
      }
    },
    meta: { loader: { exists: (): boolean => false } },
    ...(answers.hasService === false
      ? {}
      : {
          charStat: {
            pct: async (mode: string): Promise<unknown> => {
              sent.pcts.push(mode)
              return answers.raw === null ? undefined : (answers.raw ?? RAW)
            }
          }
        })
  } as unknown as MhyDeps

  return { s, deps, sent }
}

describe("出场率", () => {
  it("取到数据即出图，按档分组", async () => {
    const { s, deps, sent } = make({})
    await abyssPct(s, deps)

    expect(sent.images[0]?.name).toBe("gs/abyss-pct")
    expect(sent.pcts).toEqual(["abyss"])
    const tiers = sent.images[0]?.data["tiers"] as { label: string }[]
    expect(tiers.map(one => one.label)).toEqual(["S+", "S", "A"])
  })

  it("**一个凭据都不用** —— 不查 uid、不打米游社接口", async () => {
    const { s, deps, sent } = make({})
    await abyssPct(s, deps)

    expect(sent.mys).toBe(0)
  })

  it("幽境危战那条取的是另一种", async () => {
    const { s, deps, sent } = make({})
    await hardChallengePct(s, deps)

    expect(sent.pcts).toEqual(["hard"])
    expect(sent.images[0]?.data["modeName"]).toBe("幽境危战")
  })

  it("开关关着时不出图，且说清去哪里打开", async () => {
    const { s, deps, sent } = make({ enabled: false, raw: null })
    await abyssPct(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("图鉴显示全服统计")
  })

  it("没有取数器时同样只回那一句", async () => {
    const { s, deps, sent } = make({ hasService: false })
    await abyssPct(s, deps)

    expect(sent.images).toEqual([])
    // 与开关关着那一支说同一句：都要指到「图鉴显示全服统计」这一项上
    expect(sent.texts.join("")).toContain("图鉴显示全服统计")
  })

  it("**另两个游戏在发请求之前就拦下** —— 那两家没有这一族接口", async () => {
    for (const game of ["sr", "zzz"] as const) {
      const { s, deps, sent } = make({ game })
      await abyssPct(s, deps)

      expect(sent.pcts).toEqual([])
      expect(sent.images).toEqual([])
      // 只说"当前仅支持原神"，不解释另两家为什么没有 —— 那不是使用者要考虑的事
      expect(sent.texts.join("")).toContain("仅支持原神")
    }
  })

  it("开着但没取到本期数据时说「稍后再试」，而不是出一张空图", async () => {
    const { s, deps, sent } = make({ raw: null })
    await abyssPct(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("稍后再试")
  })

  it("出不了图时退回文字，且那句口径说明仍在", async () => {
    const { s, deps, sent } = make({ imageOk: false })
    await abyssPct(s, deps)

    const text = sent.texts.join("")
    expect(text).toContain("胡桃")
    // 「使用率不等于出场率」这一句在文字形态里也不能少
    expect(text).toContain("持有该角色")
  })
})
