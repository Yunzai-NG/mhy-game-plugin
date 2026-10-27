/**
 * 模块职责：群排行命令的测试 —— 交分数、换维度、刷新
 * 依赖方向：测试文件，依赖 commands/rank 与一份内存 KV
 * 生命周期：每个用例一份新 KV
 * 注意事项：钉住三件事。一是**伤害那一维确实会写**：`#胡桃排行` 不带关键词问的正是它，
 *          不写则满库的评分数据全看不见。二是**榜上已有这一位时不重算伤害** ——
 *          `#面板列表` 一次交几十个角色，每个都跑一遍沙箱公式会把那条命令拖垮。
 *          三是**请求的维度为空时换一维并给出说明**，不换则回落成一句"暂无数据"。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { describe, expect, it } from "vitest"
import type { Session } from "../core/session.js"
import type { BuiltPanel } from "../panel/build.js"
import { ProfileRank } from "../panel/rank.js"
import type { MhyDeps } from "./deps.js"
import type { ZzzAvatarDetail } from "../panel/profile/index.js"
import {
  charRank,
  refreshRank,
  rankTypeOf,
  submitRank,
  submitZzzRank,
  zzzCritScore,
  zzzValidScore
} from "./rank.js"

/** 群号 */
const GROUP = "10001"

/** uid，取在预设面板的上界之上 */
const UID = "100000101"

/** 发起者 */
const USER = "onebot11:1"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图：模板名与数据 */
  images: { tpl: string; data: Record<string, unknown> }[]
  /** 算过几次伤害 */
  dmgCalls: string[]
}

/**
 * 造一份装好的面板
 * @param over 要覆盖的字段
 * @returns 面板
 */
function panel(over: Partial<BuiltPanel> = {}): BuiltPanel {
  return {
    game: "gs",
    id: "10000046",
    name: "胡桃",
    abbr: "胡桃",
    uid: UID,
    level: 90,
    cons: 0,
    star: 5,
    elem: "pyro",
    talent: { a: 10, e: 10, q: 10 },
    trees: [],
    attr: { atk: 2000, hp: 15000, def: 800, cpct: 50, cdmg: 100, mastery: 100, recharge: 100 },
    sets: {},
    artis: [
      {
        set: "炽烈的炎之魔女",
        attrs: [
          { key: "cpct", value: 10, eff: 1 },
          { key: "cdmg", value: 20, eff: 1 }
        ]
      }
    ],
    mark: { _mark: 200, mark: "200", markClass: "ACE", charWeight: { cpct: 100, cdmg: 100 } },
    ...over
  } as unknown as BuiltPanel
}

/**
 * 造一个会话与一份依赖
 * @param opts 伤害是否算得出、库里存了什么
 * @returns 会话、依赖、排行器与记录
 */
function make(
  opts: {
    /** 伤害公式给的期望值；省略则这个角色算不出伤害 */
    dmg?: number
    /** 出图是否成功 */
    image?: boolean
    /** 消息里命令后跟的串 */
    rest?: string
    /** 是群管理 */
    admin?: boolean
    /** 库里存的面板：`<用户>|<uid>|<角色 id>` → 面板 */
    stored?: Record<string, BuiltPanel>
  } = {}
): { s: Session; deps: MhyDeps; ranks: ProfileRank; sent: Sent } {
  const sent: Sent = { texts: [], images: [], dmgCalls: [] }
  const ranks = new ProfileRank({ kv: new Kv(new MemoryKvDriver()), limit: () => 1 })

  const s = {
    user: USER,
    name: "旅行者",
    rest: opts.rest ?? "胡桃",
    game: "gs",
    groupId: GROUP,
    isPrivate: false,
    isMaster: false,
    isGroupAdmin: opts.admin ?? false,
    text: async (t: string): Promise<void> => void sent.texts.push(t),
    image: async (tpl: string, data: Record<string, unknown>): Promise<boolean> => {
      sent.images.push({ tpl, data })
      return opts.image ?? false
    }
  } as unknown as Session

  const stored = opts.stored ?? {}
  const deps = {
    ranks,
    config: (): Record<string, unknown> => ({ enableUnreleased: true, enableDmgCalc: true }),
    cookies: { find: async (): Promise<undefined> => undefined },
    meta: {
      loader: {
        byName: (_g: string, name: string): unknown => (name === "胡桃" ? { id: "10000046", name: "胡桃" } : undefined),
        detail: (): undefined => undefined,
        // 绝区零那条伤害路先问它；缺它时整条抛错而不是回落成"算不出"
        ready: (): boolean => false,
        exists: (): boolean => true
      }
    },
    artiMeta: { meta: (): unknown => ({ attrMap: {} }) },
    // 伤害那一层整个替掉：本文件要钉的是"算不算、算几次"，而不是算得准不准
    dmgBuffs: {
      enabled: true,
      charCalc: (_g: string, name: string): unknown => {
        sent.dmgCalls.push(name)
        return opts.dmg === undefined ? undefined : { details: [{ title: "测试", dmg: (): unknown => ({ avg: opts.dmg }) }] }
      },
      collect: (): unknown[] => []
    },
    panels: {
      of: (user: string) => ({
        // `isPanelReady` 逐项判，故这份存档要带齐源、武器、天赋与带主词条的圣遗物
        avatar: async (_g: string, uid: string, id: string): Promise<unknown> =>
          stored[`${user}|${uid}|${id}`]
            ? {
                id,
                level: 90,
                cons: 0,
                from: "enka",
                weapon: { name: "护摩之杖", level: 90 },
                talent: { a: 10, e: 10, q: 10 },
                artis: { 1: { mainId: "10001" } }
              }
            : undefined
      })
    },
    panelBuilder: {
      ready: (): boolean => true,
      build: (_g: string, uid: string, _one: unknown): BuiltPanel | undefined => panel({ uid })
    },
    logger: { debug: (): void => {}, info: (): void => {}, warn: (): void => {}, error: (): void => {} }
  } as unknown as MhyDeps

  return { s, deps, ranks, sent }
}

describe("rankTypeOf", () => {
  it("不带关键词时问的是伤害那一维 —— 它是综合练度排行", () => {
    expect(rankTypeOf("胡桃")).toBe("dmg")
    expect(rankTypeOf("胡桃评分")).toBe("mark")
    expect(rankTypeOf("胡桃双爆")).toBe("crit")
    expect(rankTypeOf("胡桃词条")).toBe("valid")
  })

  it("三个游戏的装备名都认作评分那一维", () => {
    expect(rankTypeOf("胡桃圣遗物")).toBe("mark")
    expect(rankTypeOf("青雀遗器")).toBe("mark")
    expect(rankTypeOf("艾莲驱动盘")).toBe("mark")
  })
})

describe("submitRank", () => {
  it("四个维度都写进去 —— 漏写伤害那一维则伤害榜恒为空", async () => {
    const { s, deps, ranks } = make({ dmg: 12345 })
    await submitRank(deps, s, panel())

    for (const type of ["mark", "crit", "valid", "dmg"] as const) {
      const got = await ranks.board({ group: GROUP, game: "gs", type, charId: "10000046" })
      expect(got, type).toHaveLength(1)
    }
    expect((await ranks.board({ group: GROUP, game: "gs", type: "dmg", charId: "10000046" }))[0]?.score).toBe(12345)
  })

  it("算不出伤害时只写评分三维，不写 0 —— 写 0 会让没有公式的角色占着伤害榜末位", async () => {
    const { s, deps, ranks } = make({})
    await submitRank(deps, s, panel())

    expect(await ranks.board({ group: GROUP, game: "gs", type: "mark", charId: "10000046" })).toHaveLength(1)
    expect(await ranks.board({ group: GROUP, game: "gs", type: "dmg", charId: "10000046" })).toEqual([])
  })

  it("榜上已有这一位时不再算伤害，`force` 才重算 —— 一次 `#面板列表` 交几十个角色", async () => {
    const { s, deps, ranks, sent } = make({ dmg: 100 })
    await submitRank(deps, s, panel())
    expect(sent.dmgCalls).toHaveLength(1)

    await submitRank(deps, s, panel())
    expect(sent.dmgCalls, "榜上已有，不该再算").toHaveLength(1)

    await submitRank(deps, s, panel(), true)
    expect(sent.dmgCalls).toHaveLength(2)
    expect((await ranks.board({ group: GROUP, game: "gs", type: "dmg", charId: "10000046" }))[0]?.score).toBe(100)
  })

  it("私聊里不入榜", async () => {
    const { deps, ranks } = make({ dmg: 1 })
    const s = { user: USER, game: "gs", text: async (): Promise<void> => {} } as unknown as Session
    await submitRank(deps, s, panel())

    expect(await ranks.board({ group: GROUP, game: "gs", type: "mark", charId: "10000046" })).toEqual([])
  })
})

describe("zzzCritScore", () => {
  it("副词条的 value 是带百分号的串 —— 直接 Number() 得 NaN，整条双爆分就没了", () => {
    const detail = {
      discs: [
        { subs: [{ key: "cpct", value: "9.6%" }, { key: "cdmg", value: "19.2%" }] },
        { subs: [{ key: "atk", value: "316" }, { key: "cpct", value: "2.4%" }] }
      ]
    } as unknown as Parameters<typeof zzzCritScore>[0]

    // 暴击率两倍计入：(9.6 + 2.4) * 2 + 19.2
    expect(zzzCritScore(detail)).toBeCloseTo(43.2, 5)
  })

  it("没有驱动盘时为 0，不抛错", () => {
    expect(zzzCritScore(undefined)).toBe(0)
    expect(zzzCritScore({ discs: [] } as unknown as Parameters<typeof zzzCritScore>[0])).toBe(0)
  })
})

describe("submitZzzRank", () => {
  /** 一位带两条双爆副词条的代理人存档 */
  function zzzStored(): Parameters<typeof submitZzzRank>[3] {
    return {
      id: "1021",
      level: 60,
      cons: 0,
      from: "mysPanelZZZ",
      zzz: {
        discs: [
          {
            pos: 1,
            subs: [
              { key: "cpct", value: "10%", rolls: 3 },
              { key: "cdmg", value: "20%", rolls: 2 }
            ]
          }
        ]
      }
    } as unknown as Parameters<typeof submitZzzRank>[3]
  }

  it("评分三维都写 —— 评分、双爆与加权词条在装配时就齐了", async () => {
    const { s, deps, ranks } = make({})
    const mark = { score: 88.5, keyWeight: { cpct: 100, cdmg: 100 } } as unknown as Parameters<
      typeof submitZzzRank
    >[4]

    await submitZzzRank(deps, s, "1300000001", zzzStored(), mark)

    const board = async (type: "mark" | "crit" | "dmg" | "valid"): Promise<unknown[]> =>
      ranks.board({ group: GROUP, game: "zzz", type, charId: "1021" })
    expect(await board("mark")).toHaveLength(1)
    expect(await board("crit")).toHaveLength(1)
    expect(await board("valid")).toHaveLength(1)
  })

  it("没有权重表时词条那一维不写，不写成 0", async () => {
    const { s, deps, ranks } = make({})
    await submitZzzRank(deps, s, "1300000001", zzzStored(), { score: 50 } as unknown as Parameters<
      typeof submitZzzRank
    >[4])

    expect(await ranks.board({ group: GROUP, game: "zzz", type: "valid", charId: "1021" })).toEqual([])
  })

  it("键里带游戏名，故与原神同 id 的榜互不干扰", async () => {
    const { s, deps, ranks } = make({})
    await submitZzzRank(deps, s, "1300000001", zzzStored(), { score: 50 } as unknown as Parameters<
      typeof submitZzzRank
    >[4])

    expect(await ranks.board({ group: GROUP, game: "zzz", type: "mark", charId: "1021" })).toHaveLength(1)
    expect(await ranks.board({ group: GROUP, game: "gs", type: "mark", charId: "1021" })).toEqual([])
  })
})

describe("交分数的入口要齐全", () => {
  it("**单角色面板那条也要交** —— 只接在列表上时，只发过「%安比面板」的人永远不进榜", async () => {
    // 漏接时使用者看到的是一张正常的面板图、毫无异样，kv 里却一条绝区零的排行数据都没有
    const zzz = await import("./zzz/panel.js")
    const src = (await import("node:fs")).readFileSync("src/commands/zzz/panel.ts", "utf8")
    // 两处都要调：zzzPanelList 与 zzzCharPanel
    expect(zzz.zzzCharPanel, "zzzCharPanel 要在").toBeDefined()
    const at = src.indexOf("export async function zzzCharPanel")
    const body = src.slice(at, src.indexOf("export async function", at + 10))
    expect(body, "zzzCharPanel 里没有 submitZzzRank").toContain("submitZzzRank")
  })

  it("**列表那条还要记资格** —— 不记则排名限制第 2~5 档一律判不通过，榜照样是空的", async () => {
    const src = (await import("node:fs")).readFileSync("src/commands/zzz/panel.ts", "utf8")
    const at = src.indexOf("export async function zzzPanelList")
    const body = src.slice(at, src.indexOf("\nexport ", at + 10))
    expect(body, "zzzPanelList 里没有 markRankUid").toContain("markRankUid")
  })
})

describe("zzzValidScore", () => {
  it("按「次数 × 权重」折算 —— 绝区零没有装配层算好的 eff，只有 rolls", () => {
    const detail = {
      discs: [
        {
          subs: [
            { key: "cpct", value: "9.6%", rolls: 3 },
            { key: "atk", value: "316", rolls: 2 }
          ]
        }
      ]
    } as unknown as ZzzAvatarDetail

    // cpct 权重 100 → 3 × 1；atk 权重 50 → 2 × 0.5
    expect(zzzValidScore(detail, { cpct: 100, atk: 50 })).toBeCloseTo(4, 5)
  })

  it("没有权重表时为 0 —— 评分算不出来时整条不入榜", () => {
    expect(zzzValidScore({ discs: [] } as unknown as ZzzAvatarDetail, undefined)).toBe(0)
  })
})

describe("charRank 换维度", () => {
  it("请求的伤害榜为空时换成有数据的那一维，并在图上说明 —— 不换则一群评分数据全看不见", async () => {
    const { s, deps, ranks, sent } = make({ image: true, stored: { [`${USER}|${UID}|10000046`]: panel() } })
    await ranks.setScore({ group: GROUP, game: "gs", type: "mark", charId: "10000046", user: USER, uid: UID, score: 88 })

    await charRank(s, deps)

    expect(sent.texts, `不该回"暂无数据"：${sent.texts.join(" / ")}`).toEqual([])
    expect(sent.images).toHaveLength(1)
    expect(sent.images[0]?.data["mode"]).toBe("mark")
    expect(String(sent.images[0]?.data["rankNote"])).toContain("伤害公式")
  })

  it("四维全空时才回「暂无数据」", async () => {
    const { s, deps, sent } = make({})
    await charRank(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("暂无排行数据")
  })

  it("请求的那一维有数据时不换，也不画说明", async () => {
    const { s, deps, ranks, sent } = make({
      image: true,
      rest: "胡桃评分",
      stored: { [`${USER}|${UID}|10000046`]: panel() }
    })
    await ranks.setScore({ group: GROUP, game: "gs", type: "mark", charId: "10000046", user: USER, uid: UID, score: 88 })
    await ranks.setScore({ group: GROUP, game: "gs", type: "dmg", charId: "10000046", user: USER, uid: UID, score: 99 })

    await charRank(s, deps)

    expect(sent.images[0]?.data["mode"]).toBe("mark")
    expect(sent.images[0]?.data["rankNote"]).toBe("")
  })
})

describe("charRank 自己那一行与页头", () => {
  const OTHER = "100000009"
  const MINE2 = "100000077"

  it("名下两个号都上榜时都加框，页头取名次靠前那个；别人的那一行不加", async () => {
    const { s, deps, ranks, sent } = make({
      image: true,
      rest: "胡桃评分",
      stored: {
        [`${USER}|${UID}|10000046`]: panel(),
        [`${USER}|${MINE2}|10000046`]: panel(),
        [`other|${OTHER}|10000046`]: panel()
      }
    })
    ;(deps as { users?: unknown }).users = {
      uids: async (): Promise<string[]> => [UID, MINE2],
      uid: async (): Promise<string> => UID
    }
    await ranks.setScore({ group: GROUP, game: "gs", type: "mark", charId: "10000046", user: "other", uid: OTHER, score: 99 })
    await ranks.setScore({ group: GROUP, game: "gs", type: "mark", charId: "10000046", user: USER, uid: MINE2, score: 90 })
    await ranks.setScore({ group: GROUP, game: "gs", type: "mark", charId: "10000046", user: USER, uid: UID, score: 80 })

    await charRank(s, deps)

    const data = sent.images[0]?.data ?? {}
    expect((data["list"] as { uid: string; self: boolean }[]).map(r => [r.uid, r.self])).toEqual([
      [OTHER, false],
      [MINE2, true],
      [UID, true]
    ])
    expect(data["uid"]).toBe(MINE2)
  })

  it("名下一个号都没上榜时不加框，页头取当前绑定的那个", async () => {
    const { s, deps, ranks, sent } = make({ image: true, rest: "胡桃评分", stored: { [`other|${OTHER}|10000046`]: panel() } })
    ;(deps as { users?: unknown }).users = {
      uids: async (): Promise<string[]> => [UID],
      uid: async (): Promise<string> => UID
    }
    await ranks.setScore({ group: GROUP, game: "gs", type: "mark", charId: "10000046", user: "other", uid: OTHER, score: 99 })

    await charRank(s, deps)

    const data = sent.images[0]?.data ?? {}
    expect((data["list"] as { self: boolean }[]).some(r => r.self)).toBe(false)
    expect(data["uid"]).toBe(UID)
  })
})

describe("refreshRank", () => {
  it("按库里已有的面板补齐伤害那一维 —— 没开伤害计算时查过面板的人身上只有评分三维", async () => {
    const { s, deps, ranks, sent } = make({
      dmg: 777,
      admin: true,
      rest: "",
      stored: { [`${USER}|${UID}|10000046`]: panel() }
    })
    await ranks.setScore({ group: GROUP, game: "gs", type: "mark", charId: "10000046", user: USER, uid: UID, score: 88 })
    expect(await ranks.board({ group: GROUP, game: "gs", type: "dmg", charId: "10000046" })).toEqual([])

    await refreshRank(s, deps)

    const got = await ranks.board({ group: GROUP, game: "gs", type: "dmg", charId: "10000046" })
    expect(got).toHaveLength(1)
    expect(got[0]?.score).toBe(777)
    expect(sent.texts.at(-1)).toContain("重算 1 条")
  })

  it("只有主人与群管理员能刷新", async () => {
    const { s, deps, sent } = make({ dmg: 1, rest: "" })
    await refreshRank(s, deps)

    expect(sent.texts.join("")).toContain("只有主人与群管理员")
  })
})
