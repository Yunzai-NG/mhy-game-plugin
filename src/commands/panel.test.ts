/**
 * 模块职责：面板命令里 `#刷新天赋` / `*刷新行迹` 的测试
 * 依赖方向：测试文件，依赖 commands/panel 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：钉住三件事 —— **只用自己名下、覆盖该 uid 的 CK**（`query` 自带这道归属闸，见 store/ck）、
 *          天赋解析口径（原神取 skill_list 前三、星铁按 anchor 归位）、入库形态（展柜之外的角色以
 *          `from: "talentRefresh"` 的最小记录承载，练度统计据此显示全表）。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../core/session.js"
import type { MhyDeps } from "./deps.js"
import { noSuchCharText, readyPanel, refreshPanelEntry, refreshTalent } from "./panel.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 打过的接口与参数 */
  calls: { api: string; id?: string }[]
  /** 落库过的玩家 */
  saved: Record<string, unknown>[]
}

/**
 * 造一个会话与一份依赖
 * @param answers 游戏、名下角色、每个接口的返回、命令后跟的串
 * @returns 会话、依赖与记录
 */
function make(answers: {
  /** 游戏，缺省原神 */
  game?: "gs" | "sr" | "zzz"
  /** 角色列表接口给回的角色 */
  roster?: Record<string, unknown>[]
  /** `avatar/detail` 每个 id 给回的技能表；缺省对任意 id 给同一份 */
  detail?: Record<string, unknown>
  /** 角色列表接口是否失败 */
  rosterFail?: boolean
  /** 库里已经存了哪些角色 */
  stored?: Record<string, Record<string, unknown>>
}): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], calls: [], saved: [] }
  const avatars: Record<string, Record<string, unknown>> = { ...(answers.stored ?? {}) }

  const s = {
    user: "onebot11:1",
    name: "旅行者",
    rest: "",
    game: answers.game ?? "gs",
    isPrivate: true,
    text: async (t: string): Promise<void> => void sent.texts.push(t)
  } as unknown as Session

  const deps = {
    config: (): Record<string, unknown> => ({}),
    mys: {
      query: async (
        api: string,
        opts: { data?: { avatar_id?: string } }
      ): Promise<Record<string, unknown>> => {
        sent.calls.push({ api, ...(opts.data?.avatar_id ? { id: opts.data.avatar_id } : {}) })
        if (api === "character") {
          if (answers.rosterFail) return { ok: false, kind: "cookie", message: "请先绑定 CK" }
          const list = answers.roster ?? []
          const key = (answers.game ?? "gs") === "gs" ? "avatars" : "avatar_list"
          return { ok: true, uid: "100000001", data: { [key]: list } }
        }
        // detail
        return { ok: true, uid: "100000001", data: answers.detail ?? {} }
      }
    },
    panels: {
      of: () => ({
        load: async (): Promise<Record<string, unknown>> => ({ game: answers.game ?? "gs", uid: "100000001", avatars }),
        save: async (player: Record<string, unknown>): Promise<void> => void sent.saved.push(player)
      })
    }
  } as unknown as MhyDeps

  return { s, deps, sent }
}

/** 原神一份技能表：三条可升的 + 一条满级为 1 的被动 */
const GS_DETAIL = {
  skill_list: [
    { group_id: 4323, level_current: 8, max_level: 10 },
    { group_id: 4321, level_current: 6, max_level: 10 },
    { group_id: 4322, level_current: 10, max_level: 10 },
    { group_id: 4324, level_current: 1, max_level: 1 }
  ]
}

describe("刷新天赋", () => {
  it("原神：逐角色取 skill_list，按 group_id 排序后前三＝普攻/战技/终结技，入库", async () => {
    const { s, deps, sent } = make({
      game: "gs",
      roster: [{ id: 10000042, level: 80, actived_constellation_num: 2 }],
      detail: GS_DETAIL
    })
    await refreshTalent(s, deps)

    // 一次角色列表 + 一次 detail
    expect(sent.calls.map(c => c.api)).toEqual(["character", "detail"])
    // 按 group_id 升序：4321→a(6)、4322→e(10)、4323→q(8)，被动(满级1)剔除
    const saved = sent.saved[0] as { avatars: Record<string, { talent: Record<string, number>; from?: string }> }
    expect(saved.avatars["10000042"]?.talent).toEqual({ a: 6, e: 10, q: 8 })
    // 展柜之外的角色以 talentRefresh 承载 —— 面板列表/排行的 isPanelReady 认不过它
    expect(saved.avatars["10000042"]?.from).toBe("talentRefresh")
    expect(sent.texts[0]).toContain("练度统计")
  })

  it("星铁：按 anchor 的 Point 号归位天赋键", async () => {
    const { s, deps, sent } = make({
      game: "sr",
      roster: [{ id: 1107, level: 70, rank: 1 }],
      detail: {
        skill_list: [
          { anchor: "Point01", cur_level: 6 },
          { anchor: "Point02", cur_level: 8 },
          { anchor: "Point03", cur_level: 9 },
          { anchor: "Point04", cur_level: 7 }
        ]
      }
    })
    await refreshTalent(s, deps)

    // 星铁的 detail 一次到位，按 anchor 归位天赋键
    const saved = sent.saved[0] as { avatars: Record<string, { talent: Record<string, number> }> }
    expect(saved.avatars["1107"]?.talent).toEqual({ a: 6, e: 8, q: 9, t: 7 })
  })

  it("已有展柜数据的角色只更新天赋，不动其余字段、也不改数据源", async () => {
    const { s, deps, sent } = make({
      game: "gs",
      roster: [{ id: 10000042, level: 80, actived_constellation_num: 2 }],
      detail: GS_DETAIL,
      stored: { "10000042": { id: "10000042", level: 90, cons: 6, from: "enka", weapon: { name: "磐岩结绿" } } }
    })
    await refreshTalent(s, deps)

    const one = (sent.saved[0] as { avatars: Record<string, Record<string, unknown>> }).avatars["10000042"]
    expect(one?.["from"]).toBe("enka")
    expect(one?.["level"]).toBe(90)
    expect((one?.["weapon"] as { name: string }).name).toBe("磐岩结绿")
    expect(one?.["talent"]).toEqual({ a: 6, e: 10, q: 8 })
  })

  it("角色列表取不到时不刷、给一句可照做的话", async () => {
    const { s, deps, sent } = make({ game: "gs", rosterFail: true })
    await refreshTalent(s, deps)

    expect(sent.calls.map(c => c.api)).toEqual(["character"])
    expect(sent.saved).toHaveLength(0)
    expect(sent.texts[0]).toBeTruthy()
  })

  it("绝区零不走这条路 —— 技能随更新面板一并取", async () => {
    const { s, deps, sent } = make({ game: "zzz" })
    await refreshTalent(s, deps)

    expect(sent.calls).toHaveLength(0)
    expect(sent.texts[0]).toContain("更新面板")
  })
})

describe("开拓者 / 旅行者按存档性别回退", () => {
  // 一份能过 isPanelReady 的星铁角色：数据源在册、有天赋、圣遗物带主词条 id
  const srReady = { id: "8010", level: 80, cons: 0, from: "mysPanelHSR", talent: { a: 6, e: 10, q: 10 }, artis: { "1": { mainId: "1" } } }

  /** 造一个只认得 has 里那几个 id 的最小依赖 */
  const mk = (has: Record<string, unknown>) => {
    const texts: string[] = []
    const s = { text: async (t: string) => void texts.push(t) } as unknown as Session
    const deps = { panels: { of: () => ({ avatar: async (_g: string, _u: string, id: string) => has[id] }) } } as unknown as MhyDeps
    return { s, deps, texts }
  }

  it("查穹·欢愉(8009)取不到时，回退到存档里的星·欢愉(8010)、不再误报暂无", async () => {
    const { s, deps, texts } = mk({ "8010": srReady })
    const got = await readyPanel(s, deps, "sr", "100000001", "8009", "穹·欢愉")
    expect(got?.id).toBe("8010")
    expect(texts).toHaveLength(0)
  })

  it("两种性别都没有时才提示暂无", async () => {
    const { s, deps, texts } = mk({})
    const got = await readyPanel(s, deps, "sr", "100000001", "8009", "穹·欢愉")
    expect(got).toBeUndefined()
    expect(texts[0]).toContain("暂无 穹·欢愉")
  })

  // 一份能过 isPanelReady 的冰主：存档里是荧，元素冰
  const gsCryo = { id: "10000007", elem: "cryo", level: 90, cons: 0, from: "enka", weapon: { level: 90 }, talent: { a: 1, e: 1, q: 1 }, artis: { "1": { mainId: "1" } } }

  it("查冰主回退到存档里的荧，元素一致时直接用", async () => {
    const { s, deps, texts } = mk({ "10000007": gsCryo })
    const got = await readyPanel(s, deps, "gs", "100000001", "10000005", "空", undefined, "cryo")
    expect(got?.id).toBe("10000007")
    expect(texts).toHaveLength(0)
  })

  it("存档里的旅行者是别的元素时不拿它冒充火主，说清要切元素", async () => {
    const { s, deps, texts } = mk({ "10000007": gsCryo })
    const got = await readyPanel(s, deps, "gs", "100000001", "10000005", "空", undefined, "pyro")
    expect(got).toBeUndefined()
    expect(texts[0]).toContain("不是火元素")
  })
})

describe("noSuchCharText", () => {
  /** 造一份只认得 names 里那几个名字的元数据依赖 */
  const mk = (names: Record<string, string[]>) =>
    ({
      meta: { loader: { byName: (g: string, n: string) => (names[g]?.includes(n) ? { id: "1", name: n } : undefined), ready: () => true } }
    }) as unknown as MhyDeps

  it("原神「冰主」认不出时是缺元数据，而不是指去星铁 —— 星铁也有个「冰主」别名", () => {
    const text = noSuchCharText("gs", "冰主", "面板", mk({ sr: ["冰主"] }))
    expect(text).toContain("#更新元数据")
    expect(text).not.toContain("星穹铁道")
  })

  it("别的名字照旧指路到另一个游戏", () => {
    expect(noSuchCharText("gs", "三月七", "面板", mk({ sr: ["三月七"] }))).toContain("那是星穹铁道的角色")
  })
})

describe("#更新面板 缺省源：绑 CK 走米游社，否则回落面板服务", () => {
  /** 造依赖：byMys 是配置开关，hasCk 是该 uid 有没有绑 Cookie；记下走了哪条路的接口 */
  const mk = (opts: { byMys: boolean; hasCk: boolean }) => {
    const calls: string[] = []
    const s = { game: "gs", user: "u1", rest: "100000001", text: async () => undefined } as unknown as Session
    const deps = {
      config: () => ({ panelUpdateByMys: opts.byMys }),
      users: { uid: async () => "100000001" },
      cookies: { find: async () => (opts.hasCk ? { ltuid: "1" } : undefined) },
      mys: {
        query: async (api: string) => {
          calls.push(`mys:${api}`)
          return { ok: false, kind: "cookie", message: "x" }
        }
      },
      panel: {
        cooldown: async () => 0,
        fetch: async () => {
          calls.push("serv:fetch")
          return { result: { ok: false, kind: "error" }, serv: { name: "面板服务" } }
        }
      },
      panels: { of: () => ({}) }
    } as unknown as MhyDeps
    return { s, deps, calls }
  }

  it("缺省开启且该 uid 绑了 CK：走米游社", async () => {
    const { s, deps, calls } = mk({ byMys: true, hasCk: true })
    await refreshPanelEntry(s, deps)
    expect(calls.some(c => c.startsWith("mys:"))).toBe(true)
    expect(calls).not.toContain("serv:fetch")
  })

  it("该 uid 没绑 CK：即便缺省开启也回落面板服务", async () => {
    const { s, deps, calls } = mk({ byMys: true, hasCk: false })
    await refreshPanelEntry(s, deps)
    expect(calls).toContain("serv:fetch")
    expect(calls.some(c => c.startsWith("mys:"))).toBe(false)
  })

  it("配置关闭：一律走面板服务", async () => {
    const { s, deps, calls } = mk({ byMys: false, hasCk: true })
    await refreshPanelEntry(s, deps)
    expect(calls).toContain("serv:fetch")
    expect(calls.some(c => c.startsWith("mys:"))).toBe(false)
  })
})
