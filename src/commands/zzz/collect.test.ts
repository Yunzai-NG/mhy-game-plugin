/**
 * 模块职责：绝区零三类进度命令的测试
 * 依赖方向：测试文件，依赖 commands/zzz/collect、commands/player 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：本文件最要紧的一条是**枯萎苗圃只在打过「刀耕火焚」时才发第二次请求** ——
 *          概要里没有 `max_damage` 时第二条接口给的是空数据，白占一次查询额度、白担一次风控。
 *          另钉住 `%探索` 与 `#札记` 在绝区零那一路的分派落点。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../../core/session.js"
import type { MhyDeps } from "../deps.js"
import { roleExplore } from "../player.js"
import { zzzExplore, zzzGarden, zzzHollowHelp, zzzLedger, zzzLost } from "./collect.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口与参数 */
  calls: { api: string; data: Record<string, unknown> | undefined }[]
}

/** 一份能出图的枯萎苗圃概要，打过刀耕火焚 */
const GARDEN = {
  abyss_level: { cur_level: 60, max_level: 60 },
  abyss_collect: [{ cur_collect: 1, max_collect: 2 }],
  abyss_throne: { max_damage: 900 }
}

/** 一份还没打过刀耕火焚的概要 */
const GARDEN_FRESH = { abyss_level: { cur_level: 3, max_level: 60 }, abyss_collect: [{ cur_collect: 0, max_collect: 2 }] }

/** 一份能出图的迷失之地返回 */
const LOST = { abyss_level: { cur_level: 55, max_level: 60 }, abyss_collect: [{ cur_collect: 1, max_collect: 3 }] }

/** 一份能出图的区域收集返回 */
const EXPLORE = { area_collections: [{ name: "六分街", collection_progress: 82, map_collections: [] }] }

/** 一份能出图的菲林月报 */
const LEDGER = {
  data_month: "202601",
  current_month: "202601",
  month_data: { list: [{ data_type: "PolychromesData", count: 100, data_name: "菲林" }], income_components: [] }
}
/**
 * 造一个会话与一份依赖
 * @param answers 各接口给什么、出不出得了图、哪个游戏、命令后面跟什么
 * @returns 会话、依赖与记录
 */
function make(answers: {
  /** 接口名 → 返回的数据；给 `null` 表示这一条失败 */
  data?: Record<string, unknown>
  /** 出图是否成功 */
  imageOk?: boolean
  /** 游戏 */
  game?: "gs" | "sr" | "zzz"
  /** 命令后面跟的那一串 */
  rest?: string
}): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], calls: [] }
  const s = {
    user: "onebot11:1",
    name: "绳匠",
    rest: answers.rest ?? "",
    game: answers.game ?? "zzz",
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
      query: async (api: string, opts: { data?: Record<string, unknown> }): Promise<Record<string, unknown>> => {
        sent.calls.push({ api, data: opts.data })
        const got = answers.data?.[api]
        if (got === null) return { ok: false, kind: "http", message: "连不上" }
        return { ok: true, uid: "1300000001", data: got ?? {} }
      }
    },
    meta: { loader: { byId: (): undefined => undefined } }
  } as unknown as MhyDeps

  return { s, deps, sent }
}
describe("枯萎苗圃", () => {
  it("打过刀耕火焚才取第二条接口", async () => {
    const { s, deps, sent } = make({
      data: { hollowZero: GARDEN, hollowZeroDetail: { abyss_throne_max: { time: 600, max_damage: 900 } } }
    })
    await zzzGarden(s, deps)

    expect(sent.calls.map(it => it.api)).toEqual(["hollowZero", "hollowZeroDetail"])
    expect(sent.images[0]?.name).toBe("zzz/garden")
    expect(sent.images[0]?.data["throne"]).toBeDefined()
  })

  it("没打过时**只发一次请求** —— 那时第二条接口给的是空数据，白占一次额度", async () => {
    const { s, deps, sent } = make({ data: { hollowZero: GARDEN_FRESH } })
    await zzzGarden(s, deps)

    expect(sent.calls.map(it => it.api)).toEqual(["hollowZero"])
    expect(sent.images[0]?.data["throne"]).toBeUndefined()
  })

  it("明细取不到时照旧出图 —— 那一段整块不画，概要与收集数据不受影响", async () => {
    const { s, deps, sent } = make({ data: { hollowZero: GARDEN, hollowZeroDetail: null } })
    await zzzGarden(s, deps)

    expect(sent.calls).toHaveLength(2)
    expect(sent.images[0]?.name).toBe("zzz/garden")
    expect(sent.images[0]?.data["throne"]).toBeUndefined()
  })

  it("玩法没开时只回一句", async () => {
    const { s, deps, sent } = make({ data: { hollowZero: {} } })
    await zzzGarden(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("尚无数据")
  })

  it("没有渲染器时退回文字", async () => {
    const { s, deps, sent } = make({ data: { hollowZero: GARDEN }, imageOk: false })
    await zzzGarden(s, deps)

    expect(sent.texts.join("")).toContain("执照 60/60 级")
  })
})
describe("另三条", () => {
  it("`%零号空洞` 只指路，一个请求都不发", async () => {
    const { s, sent } = make({})
    await zzzHollowHelp(s)

    expect(sent.calls).toEqual([])
    expect(sent.texts.join("")).toContain("枯萎苗圃")
    expect(sent.texts.join("")).toContain("迷失之地")
  })

  it("迷失之地：接口与模板成对", async () => {
    const { s, deps, sent } = make({ data: { hollowZeroS2: LOST } })
    await zzzLost(s, deps)

    expect(sent.calls[0]?.api).toBe("hollowZeroS2")
    expect(sent.images[0]?.name).toBe("zzz/lost")
  })

  it("区域收集：接口与模板成对", async () => {
    const { s, deps, sent } = make({ data: { exploration: EXPLORE } })
    await zzzExplore(s, deps)

    expect(sent.calls[0]?.api).toBe("exploration")
    expect(sent.images[0]?.name).toBe("zzz/explore")
  })

  it("`#探索` 在绝区零那一路转到区域收集", async () => {
    const { s, deps, sent } = make({ data: { exploration: EXPLORE } })
    await roleExplore(s, deps)

    expect(sent.calls.map(it => it.api)).toEqual(["exploration"])
    expect(sent.images[0]?.name).toBe("zzz/explore")
  })

  it("不是绝区零时这三条一个请求都不发", async () => {
    for (const game of ["gs", "sr"] as const) {
      const { s, deps, sent } = make({ game, data: { hollowZeroS2: LOST } })
      await zzzLost(s, deps)
      await zzzExplore(s, deps)

      expect(sent.calls).toEqual([])
      expect(sent.texts.join("")).toContain("只有绝区零有")
    }
  })
})
describe("菲林月报", () => {
  it("查当月时不带 month 参数 —— 接口据此给当月", async () => {
    const { s, deps, sent } = make({ data: { ys_ledger: LEDGER } })
    await zzzLedger(s, deps)

    expect(sent.calls).toEqual([{ api: "ys_ledger", data: undefined }])
    expect(sent.images[0]?.name).toBe("zzz/ledger")
  })

  it("「上月」带上 YYYYMM 形态的 month", async () => {
    const { s, deps, sent } = make({ data: { ys_ledger: LEDGER }, rest: "上月" })
    await zzzLedger(s, deps)

    const month = sent.calls[0]?.data?.["month"]
    expect(typeof month).toBe("string")
    expect(String(month)).toMatch(/^\d{6}$/)
  })

  it("超出可查范围时不发请求，直接说明白", async () => {
    const { s, deps, sent } = make({ data: { ys_ledger: LEDGER }, rest: "2020年1月" })
    await zzzLedger(s, deps)

    expect(sent.calls).toEqual([])
    expect(sent.texts.join("")).toContain("最近 3 个月")
  })

  it("接口给了一份空月报时说明白，不出一张空图", async () => {
    const { s, deps, sent } = make({ data: { ys_ledger: { month_data: { list: [] } } } })
    await zzzLedger(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("菲林月报")
  })
})
