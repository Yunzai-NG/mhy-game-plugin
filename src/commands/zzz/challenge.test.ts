/**
 * 模块职责：绝区零三类战绩命令的测试
 * 依赖方向：测试文件，依赖 commands/zzz/challenge 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：本文件钉住三件：**非绝区零时一个请求都不发**（这三条命令词三个游戏前缀都注册
 *          得到，不挡住就会拿绝区零的接口去打原神的 uid）、**接口名与模板名成对**（错配的表现
 *          不是报错而是一张各项均为空的图）、以及**「上期」要变成 `schedule_type=2`**。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../../core/session.js"
import type { MhyDeps } from "../deps.js"
import { zzzDeadly, zzzDefense, zzzHolo, zzzTower, zzzVoid } from "./challenge.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口与参数 */
  calls: { api: string; data: Record<string, unknown> | undefined }[]
}

/** 一份能出图的式舆防卫战返回 */
const DEFENSE = {
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

/** 一份能出图的危局强袭战返回 */
const DEADLY = {
  has_data: true,
  total_score: 110_998,
  total_star: 9,
  room_max_score: 65_000,
  list: [{ score: 45_323, star: 3, total_star: 3, boss: [{ name: "滞变畸兽" }], avatar_list: [] }]
}

/** 一份能出图的拟境湮灭战返回 */
const HOLO = {
  unlock: true,
  list: [{ star: 3, total_star: 3, challenge_time: { minute: 3, second: 41 }, boss: { name: "「白祸」" } }]
}

/** 一份能出图的拟真鏖战试炼返回 */
const TOWER = { climbing_tower_s1: { medal_icon: "https://a.png", climbing_tower_layer: 30 } }

/** 一份能出图的临界推演返回 */
const VOID = {
  void_front_battle_detail: {
    void_front_battle_abstract_info_brief: { total_score: 92_400, max_score: 100_000 },
    main_challenge_record_list: [{ name: "STAGE 04", star: "A", score: 18_200, avatar_list: [] }]
  }
}
/**
 * 造一个会话与一份依赖
 * @param answers 接口给什么、出不出得了图、哪个游戏、命令后面跟什么
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
  /** 接口是否成功 */
  ok?: boolean
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
        if (answers.ok === false) return { ok: false, kind: "http", message: "连不上" }
        return { ok: true, uid: "1300000001", data: answers.raw ?? {} }
      }
    },
    meta: {
      loader: {
        byId: (_game: string, id: string): { abbr: string } | undefined => (id === "1011" ? { abbr: "安比" } : undefined)
      }
    }
  } as unknown as MhyDeps

  return { s, deps, sent }
}
describe("zzz-challenge", () => {
  it("不是绝区零时一个请求都不发 —— 这三条命令词三个游戏前缀都注册得到", async () => {
    for (const game of ["gs", "sr"] as const) {
      const { s, deps, sent } = make({ game, raw: DEFENSE })
      await zzzDefense(s, deps)

      expect(sent.calls).toEqual([])
      expect(sent.texts.join("")).toContain("只有绝区零有")
    }
  })

  it("式舆防卫战：接口与模板成对，本期是 schedule_type 1", async () => {
    const { s, deps, sent } = make({ raw: DEFENSE })
    await zzzDefense(s, deps)

    expect(sent.calls).toEqual([{ api: "spiralAbyss", data: { schedule_type: 1 } }])
    expect(sent.images[0]?.name).toBe("zzz/defense")
    expect(sent.images[0]?.data["period"]).toBe("本期")
  })

  it("危局强袭战：接口与模板成对", async () => {
    const { s, deps, sent } = make({ raw: DEADLY })
    await zzzDeadly(s, deps)

    expect(sent.calls[0]?.api).toBe("challengeDeadly")
    expect(sent.images[0]?.name).toBe("zzz/deadly")
  })

  it("拟境湮灭战：接口与模板成对", async () => {
    const { s, deps, sent } = make({ raw: HOLO })
    await zzzHolo(s, deps)

    expect(sent.calls[0]?.api).toBe("challengeHoloBoss")
    expect(sent.images[0]?.name).toBe("zzz/holo")
  })

  it("「上期」与「往期」都认，变成 schedule_type 2", async () => {
    for (const rest of ["上期", "上一期", "往期"]) {
      const { s, deps, sent } = make({ raw: DEADLY, rest })
      await zzzDeadly(s, deps)

      expect(sent.calls[0]?.data).toEqual({ schedule_type: 2 })
      expect(sent.images[0]?.data["period"]).toBe("上期")
    }
  })

  it("拟真鏖战试炼不带期次 —— 接口不收这个参数，一次给四个赛季", async () => {
    const { s, deps, sent } = make({ raw: TOWER, rest: "上期" })
    await zzzTower(s, deps)

    expect(sent.calls).toEqual([{ api: "climbingTower", data: undefined }])
    expect(sent.images[0]?.name).toBe("zzz/tower")
  })

  it("临界推演：接口与模板成对", async () => {
    const { s, deps, sent } = make({ raw: VOID })
    await zzzVoid(s, deps)

    expect(sent.calls[0]?.api).toBe("voidFront")
    expect(sent.images[0]?.name).toBe("zzz/void")
  })
})
describe("出不了图的几种情形", () => {
  it("接口失败时按失败分类回一句，不出图", async () => {
    const { s, deps, sent } = make({ ok: false })
    await zzzDeadly(s, deps)

    expect(sent.images).toEqual([])
    // 网络层失败由 failText 统一措辞，不把内部错误原文抛给使用者
    expect(sent.texts.join("")).toContain("米游社")
  })

  it("本期没打过时只回一句，不出一张全零的图", async () => {
    const { s, deps, sent } = make({ raw: { has_data: false } })
    await zzzDeadly(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("尚无战绩")
  })

  it("旧版深渊的数据单说一句 —— 按新版读会得到一张全零的图", async () => {
    const { s, deps, sent } = make({ raw: { hadal_ver: "v1" } })
    await zzzDefense(s, deps)

    expect(sent.images).toEqual([])
    // 钉"说了是旧版、且说了不出图"，不钉具体措辞
    expect(sent.texts.join("")).toContain("旧版")
    expect(sent.texts.join("")).toContain("全是零")
  })

  it("没有渲染器时退回文字，且名字仍由元数据补", async () => {
    const { s, deps, sent } = make({ raw: DEFENSE, imageOk: false })
    await zzzDefense(s, deps)

    expect(sent.texts.join("")).toContain("式舆防卫战")
    expect(sent.texts.join("")).toContain("安比")
  })
})
