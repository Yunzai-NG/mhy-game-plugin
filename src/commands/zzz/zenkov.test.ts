/**
 * 模块职责：绝区零迷宫诡域命令的测试
 * 依赖方向：测试文件，依赖 commands/zzz/zenkov 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：最要紧的一条是**按后缀分派到两条不同的接口** —— 命令表里只登记一条（`迷宫诡域` 是
 *          `迷宫诡域战绩` 的前缀，注册两条必定互相遮挡），故"打到概要接口"这种错只有这里拦得住。
 *          另钉住两条命令各只发一次请求：概要与逐场是两条独立接口，合并取数等于白担一次额度。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../../core/session.js"
import type { MhyDeps } from "../deps.js"
import { zzzZenkovEntry } from "./zenkov.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口 */
  calls: string[]
}

/** 一份能出图的概要 */
const ABSTRACT = {
  refresh_time: 180_000,
  season_data: { name: "诡域·初章", level: 12, refresh: 0, refresh_time: 600_000 },
  max_rank: 512,
  is_show_percent: true,
  total_enter_num: 26,
  total_leave_num: 21,
  total_material_value: 1_284_000,
  map_list: [{ name: "废弃工厂", icon: "https://a.invalid/m.png", enter_num: 14, leave_num: 11, leave_percent: 7857 }]
}

/** 一份带逐场战绩的返回 */
const DETAIL = {
  ...ABSTRACT,
  record_list: [
    {
      map_name: "废弃工厂",
      difficult: "Hell",
      start_time: { year: 2026, month: 9, day: 6, hour: 21, minute: 4, second: 12 },
      challenge_time: { hour: 0, minute: 18, second: 33 },
      is_leave: true,
      material_total_value: 486_200,
      item_list: [{ name: "以太结晶", icon: "https://a.invalid/i.png", rarity: 5, num: 3 }]
    }
  ]
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
      query: async (api: string): Promise<Record<string, unknown>> => {
        sent.calls.push(api)
        const got = answers.data?.[api]
        if (got === null) return { ok: false, kind: "http", message: "连不上" }
        return { ok: true, uid: "1300000001", data: got ?? {} }
      }
    }
  } as unknown as MhyDeps

  return { s, deps, sent }
}

describe("按后缀分派", () => {
  it("裸的 `%迷宫诡域` 走概要接口", async () => {
    const { s, deps, sent } = make({ data: { zenkov: ABSTRACT } })
    await zzzZenkovEntry(s, deps)

    expect(sent.calls).toEqual(["zenkov"])
    expect(sent.images[0]?.name).toBe("zzz/zenkov")
  })

  it("`%迷宫诡域战绩` 走逐场接口 —— 两条命令合成一条登记，认错后缀就会打错接口", async () => {
    const { s, deps, sent } = make({ rest: "战绩", data: { zenkovDetail: DETAIL } })
    await zzzZenkovEntry(s, deps)

    expect(sent.calls).toEqual(["zenkovDetail"])
    expect(sent.images[0]?.name).toBe("zzz/zenkov-detail")
  })

  it("「记录」「详情」「回顾」与「战绩」同义", async () => {
    for (const word of ["记录", "详情", "回顾"]) {
      const { s, deps, sent } = make({ rest: word, data: { zenkovDetail: DETAIL } })
      await zzzZenkovEntry(s, deps)
      expect(sent.calls).toEqual(["zenkovDetail"])
    }
  })

  it("认不出的后缀按概要处理 —— 那多半是随手多打了个字", async () => {
    const { s, deps, sent } = make({ rest: "上期", data: { zenkov: ABSTRACT } })
    await zzzZenkovEntry(s, deps)

    expect(sent.calls).toEqual(["zenkov"])
  })

  it("两条都各只发一次请求 —— 概要与逐场是两条独立接口，合并取数白占额度", async () => {
    const { s, deps, sent } = make({ rest: "战绩", data: { zenkovDetail: DETAIL } })
    await zzzZenkovEntry(s, deps)

    expect(sent.calls).toHaveLength(1)
  })
})

describe("边界", () => {
  it("另两个游戏发这条命令时说清只有绝区零有", async () => {
    for (const game of ["gs", "sr"] as const) {
      const { s, deps, sent } = make({ game })
      await zzzZenkovEntry(s, deps)
      expect(sent.calls).toEqual([])
      expect(sent.texts.join("")).toContain("只有绝区零有")
    }
  })

  it("玩法没开时只回一句，不出一张空图", async () => {
    const { s, deps, sent } = make({ data: { zenkov: {} } })
    await zzzZenkovEntry(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("尚无数据")
  })

  it("进过但一场没打完时，战绩那条给出可操作的话", async () => {
    const { s, deps, sent } = make({ rest: "战绩", data: { zenkovDetail: { total_enter_num: 0 } } })
    await zzzZenkovEntry(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("逐场记录")
  })

  it("接口失败时把原因说出来", async () => {
    const { s, deps, sent } = make({ data: { zenkov: null } })
    await zzzZenkovEntry(s, deps)

    expect(sent.images).toEqual([])
    // `failText` 对网络类失败给的是固定话术，不透传接口原文
    expect(sent.texts.join("")).toContain("连不上米游社")
  })

  it("没有渲染器时退回文字，且概要与战绩各印自己的标题", async () => {
    const one = make({ data: { zenkov: ABSTRACT }, imageOk: false })
    await zzzZenkovEntry(one.s, one.deps)
    expect(one.sent.texts.join("")).toContain("迷宫诡域")

    const two = make({ rest: "战绩", data: { zenkovDetail: DETAIL }, imageOk: false })
    await zzzZenkovEntry(two.s, two.deps)
    expect(two.sent.texts.join("")).toContain("迷宫诡域战绩")
    // 文字形态里逐场那一段要真的印出来，否则退回文字等于什么都没说
    expect(two.sent.texts.join("")).toContain("高危")
  })
})
