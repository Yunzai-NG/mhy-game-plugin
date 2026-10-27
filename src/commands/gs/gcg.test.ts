/**
 * 模块职责：`#七圣卡组` 与 `#七圣卡牌` 两条命令的测试
 * 依赖方向：测试文件，依赖 commands/gs/gcg 与一个记录调用的假查询服务
 * 生命周期：无状态
 * 注意事项：固定四处：有没有数字决定画哪张模板、指定的牌组不存在时给出「无牌组N」而不是空图、
 *          指定角色 / 行动时少打一个接口，以及**任一接口失败就整体退出** —— 继续往下走只会渲染
 *          出一张缺块的图。
 */
import { describe, expect, it } from "vitest"
import type { RenderDress } from "../../core/render.js"
import type { Session } from "../../core/session.js"
import type { QueryOptions } from "../../service/mys.js"
import type { DeckCardView, DeckView } from "../../views/gs/index.js"
import type { MhyDeps } from "../deps.js"
import { gcgCards, gcgDeck } from "./gcg.js"

/** 不出声的日志器 */
const LOGGER = {
  debug: (): void => undefined,
  info: (): void => undefined,
  mark: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  trace: (): void => undefined,
  fatal: (): void => undefined
}

/** 假会话，记录回复与出图 */
interface Spy extends Session {
  /** 收到的全部文字回复 */
  readonly said: string[]
  /** 出图请求 */
  readonly drew: { template: string; data: Record<string, unknown> }[]
}

/**
 * 造一个假会话
 * @param rest 命令之后的内容
 * @param game 游戏
 * @param ok 出图是否成功
 * @returns 假会话
 */
function makeSession(rest = "", game: Session["game"] = "gs", ok = true): Spy {
  const said: string[] = []
  const drew: Spy["drew"] = []
  return {
    user: "qq:1",
    name: "旅行者",
    rest,
    game,
    isPrivate: true,
    isMaster: false,
    isGroupAdmin: false,
    botId: "bot-1",
    lastSent: (): string => "msg-1",
    images: [],
    said,
    drew,
    text: async (content: string): Promise<void> => void said.push(content),
    image: async (template: string, data: Record<string, unknown>, _dress?: RenderDress): Promise<boolean> => {
      drew.push({ template, data })
      return ok
    },
    ask: async (): Promise<undefined> => undefined,
    file: async (): Promise<undefined> => undefined,
    askFile: async (): Promise<undefined> => undefined,
    sendFile: async (): Promise<boolean> => false,
    imageBytes: async (): Promise<boolean> => false,
    imageFile: async (): Promise<boolean> => false,
    forward: async (): Promise<boolean> => false
  }
}

/** 记下来的一次查询 */
interface Call {
  /** 接口名 */
  api: string
  /** 查询参数 */
  opts: QueryOptions
}

/** 每个接口给什么 —— `Error` 表示让那一次查询失败 */
type Answers = Readonly<Record<string, unknown>>

/** 两副牌组 */
const DECK_LIST = {
  nickname: "旅行者",
  level: 60,
  deck_list: [
    { id: 1, name: "雷神队", avatar_cards: [{ name: "雷电将军", image: "https://x/r.png", hp: 10 }], action_cards: [] },
    {
      id: 2,
      name: "冰车队",
      avatar_cards: [{ name: "甘雨", image: "https://x/gy.png", hp: 10 }],
      action_cards: [{ name: "凯亚", image: "https://x/ky.png", num: 2, action_cost: [] }]
    }
  ]
}

/** 缺省的一套返回值 */
const ANSWERS: Answers = {
  deckList: DECK_LIST,
  basicInfo: {
    level: 10,
    nickname: "旅行者",
    avatar_card_num_gained: 41,
    avatar_card_num_total: 43,
    action_card_num_gained: 180,
    action_card_num_total: 200
  },
  avatar_cardList: { card_list: [{ name: "甘雨", image: "https://x/gy.png", hp: 10, num: 1, use_count: 9 }] },
  action_cardList: { card_list: [{ name: "参量质变仪", image: "https://x/c.png", num: 2, use_count: 5 }] }
}

/**
 * 造一份依赖包
 * @param answers 每个接口给什么
 * @returns 依赖包与调用记录
 */
function makeDeps(answers: Answers = ANSWERS): { deps: MhyDeps; calls: Call[] } {
  const calls: Call[] = []
  const mys = {
    query: async (api: string, opts: QueryOptions): Promise<unknown> => {
      calls.push({ api, opts })
      const got = answers[api]
      if (got instanceof Error) {
        return { ok: false, api, uid: "100000001", retcode: -1, message: got.message, kind: "unknown" }
      }
      return { ok: true, api, uid: "100000001", ltuid: "1", data: got ?? null, cached: false }
    }
  }
  const deps = { mys, logger: LOGGER, config: () => ({}) } as unknown as MhyDeps
  return { deps, calls }
}

describe("gcgDeck", () => {
  it("只有原神有七圣召唤", async () => {
    const { deps, calls } = makeDeps()
    const s = makeSession("", "sr")
    await gcgDeck(s, deps)
    expect(s.said[0]).toContain("只有原神")
    expect(calls).toHaveLength(0)
  })

  it("不带序号时画列表", async () => {
    const { deps } = makeDeps()
    const s = makeSession("")
    await gcgDeck(s, deps)
    expect(s.drew[0]?.template).toBe("gs/gcg-deck-list")
    expect((s.drew[0]?.data as unknown as DeckView).decks).toHaveLength(2)
  })

  it("带序号时画那一副，且换另一张模板", async () => {
    const { deps } = makeDeps()
    const s = makeSession("2")
    await gcgDeck(s, deps)
    expect(s.drew[0]?.template).toBe("gs/gcg-deck")
    const view = s.drew[0]?.data as unknown as DeckView
    expect(view.decks).toHaveLength(1)
    expect(view.decks[0]?.name).toBe("冰车队")
    expect(view.decks[0]?.actions[0]?.num).toBe(2)
  })

  it("序号不存在时说清并指路列表，而不是画一张空图", async () => {
    const { deps } = makeDeps()
    const s = makeSession("9")
    await gcgDeck(s, deps)
    expect(s.said[0]).toContain("无牌组9")
    expect(s.drew).toHaveLength(0)
  })

  it("接口失败时把原因带出来", async () => {
    const { deps } = makeDeps({ ...ANSWERS, deckList: new Error("请先登录") })
    const s = makeSession("")
    await gcgDeck(s, deps)
    expect(s.said[0]).toContain("请先登录")
  })

  it("出不了图时退回文字", async () => {
    const { deps } = makeDeps()
    const s = makeSession("", "gs", false)
    await gcgDeck(s, deps)
    expect(s.said[0]).toContain("雷神队")
    expect(s.said[0]).toContain("甘雨")
  })
})

describe("gcgCards", () => {
  it("只有原神有", async () => {
    const { deps, calls } = makeDeps()
    const s = makeSession("", "zzz")
    await gcgCards(s, deps)
    expect(s.said[0]).toContain("只有原神")
    expect(calls).toHaveLength(0)
  })

  it("三个接口都打，且先回一句「获取中」", async () => {
    const { deps, calls } = makeDeps()
    const s = makeSession("")
    await gcgCards(s, deps)

    expect(s.said[0]).toContain("获取中")
    expect(calls.map(one => one.api)).toEqual(["basicInfo", "avatar_cardList", "action_cardList"])
    expect(s.drew[0]?.template).toBe("gs/gcg-deck-card")
    const view = s.drew[0]?.data as unknown as DeckCardView
    expect(view.avatarGained).toBe("41/43")
    expect(view.avatars).toHaveLength(1)
    expect(view.actions).toHaveLength(1)
  })

  it("指定角色时不打行动牌那个接口", async () => {
    const { deps, calls } = makeDeps()
    const s = makeSession("角色")
    await gcgCards(s, deps)
    expect(calls.map(one => one.api)).toEqual(["basicInfo", "avatar_cardList"])
    expect((s.drew[0]?.data as unknown as DeckCardView).actions).toEqual([])
  })

  it("指定行动时不打角色牌那个接口", async () => {
    const { deps, calls } = makeDeps()
    const s = makeSession("行动")
    await gcgCards(s, deps)
    expect(calls.map(one => one.api)).toEqual(["basicInfo", "action_cardList"])
    expect((s.drew[0]?.data as unknown as DeckCardView).avatars).toEqual([])
  })

  it("概况取不到时把接口的原因带出来", async () => {
    const { deps, calls } = makeDeps({ ...ANSWERS, basicInfo: new Error("请先绑定 CK") })
    const s = makeSession("")
    await gcgCards(s, deps)
    expect(s.said[1]).toContain("请先绑定 CK")
    expect(calls).toHaveLength(1)
  })

  it("卡牌明细取不到时整体退出，不画半张图，并说出失败的真实原因", async () => {
    const { deps } = makeDeps({ ...ANSWERS, avatar_cardList: new Error("超时") })
    const s = makeSession("")
    await gcgCards(s, deps)
    // 风控、CK 失效与超时要分得清，一句「获取失败」使用者无从下手
    expect(s.said[1]).toContain("超时")
    expect(s.drew).toHaveLength(0)
  })

  it("出不了图时退回文字", async () => {
    const { deps } = makeDeps()
    const s = makeSession("", "gs", false)
    await gcgCards(s, deps)
    expect(s.said[1]).toContain("已收集角色牌")
    expect(s.said[1]).toContain("参量质变仪×2")
  })
})
