/**
 * 模块职责：`#XX养成`、`#角色养成`（帮助）与 `#尘歌壶模数` 三条命令的测试
 * 依赖方向：测试文件，依赖 commands/calculator、真实的 MetaLoader（夹具写在临时目录里）
 *          与一个记录调用的假查询服务
 * 生命周期：每个用例一套新临时目录
 * 注意事项：固定五处：**认不出名字时一个字都不说**（`#XX计算` 这个后缀别的插件也在用）、旅行者
 *          明确拒绝、未拥有的角色走另一个接口且等级按 1 起算、三星以下武器的目标等级压到 70、
 *          星铁未拥有时把忆灵行迹并进来。假查询服务按接口名分派并记下每次调用，故"发了哪几个
 *          请求、请求体长什么样"都可断言 —— 那正是这条命令最容易搬错的地方。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { RenderDress } from "../core/render.js"
import type { Session } from "../core/session.js"
import { MetaLoader } from "../meta/loader.js"
import type { MetaLoaderOptions } from "../meta/loader.js"
import type { QueryOptions } from "../service/mys.js"
import type { CalculatorView } from "../views/calculator.js"
import type { MhyDeps } from "./deps.js"
import { blueprint, charCalculator } from "./calculator.js"

/** 不出声的日志器 */
const LOGGER = {
  debug: (): void => undefined,
  info: (): void => undefined,
  mark: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  trace: (): void => undefined,
  fatal: (): void => undefined,
  child: (): typeof LOGGER => LOGGER
} as unknown as MetaLoaderOptions["logger"]

let dir = ""

/**
 * 写一个条目目录
 * @param path 目录绝对路径
 * @param data data.json 的内容
 * @param imgs 要造的图片文件名，落在 imgs/ 下
 */
function item(path: string, data: Record<string, unknown>, imgs: readonly string[] = []): void {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, "data.json"), JSON.stringify(data), "utf8")
  if (imgs.length) mkdirSync(join(path, "imgs"), { recursive: true })
  for (const img of imgs) writeFileSync(join(path, "imgs", img), "x", "utf8")
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mhy-calc-cmd-"))
  item(join(dir, "meta-gs", "character", "刻晴"), { id: 10000042, name: "刻晴", abbr: "刻晴", star: 5 }, ["face.webp"])
  item(join(dir, "meta-gs", "character", "旅行者", "anemo"), { id: 10000005, name: "旅行者", abbr: "空", star: 5 }, [
    "face.webp"
  ])
  item(join(dir, "meta-gs", "weapon", "sword", "磐岩结绿"), { id: 11509, name: "磐岩结绿", star: 5 })
  item(join(dir, "meta-sr", "character", "克拉拉"), { id: 1107, name: "克拉拉", abbr: "克拉拉", star: 5 }, [
    "face.webp"
  ])
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 假会话，记录回复与出图 */
interface Spy extends Session {
  /** 收到的全部文字回复 */
  readonly said: string[]
  /** 出图请求 */
  readonly drew: { template: string; data: Record<string, unknown>; dress?: RenderDress }[]
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
    image: async (template: string, data: Record<string, unknown>, dress?: RenderDress): Promise<boolean> => {
      drew.push({ template, data, ...(dress ? { dress } : {}) })
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

/** 原神的技能表：三条可升的，外加一条满级为 1 的被动 */
const GS_DETAIL = {
  skill_list: [
    { group_id: 4321, level_current: 3, max_level: 10, name: "云来剑法", icon: "https://x/a.png" },
    { group_id: 4322, level_current: 5, max_level: 10, name: "星斗归位", icon: "https://x/e.png" },
    { group_id: 4323, level_current: 1, max_level: 10, name: "天街巡游", icon: "https://x/q.png" },
    { group_id: 4324, level_current: 1, max_level: 1, name: "玉衡之石", icon: "https://x/p.png" }
  ]
}

/** `avatarSkill` 给的技能表：与上面同三条，但**不带当前等级** —— 那正是它与 detail 的差别 */
const GS_SKILL_LIST = [
  { group_id: 4321, max_level: 10, name: "云来剑法", icon: "https://x/a.png" },
  { group_id: 4322, max_level: 10, name: "星斗归位", icon: "https://x/e.png" },
  { group_id: 4323, max_level: 10, name: "天街巡游", icon: "https://x/q.png" }
]

/** 记下来的一次查询 */
interface Call {
  /** 接口名 */
  api: string
  /** 查询参数 */
  opts: QueryOptions
}

/** 每个接口给什么 —— `Error` 表示让那一次查询失败 */
type Answers = Readonly<Record<string, unknown>>

/** 缺省的一套返回值：刻晴 80 级、二命、佩磐岩结绿 */
const GS_ANSWERS: Answers = {
  character: {
    avatars: [
      {
        id: 10000042,
        level: 80,
        actived_constellation_num: 2,
        weapon: { id: 11509, name: "磐岩结绿", level: 20, rarity: 5, icon: "https://x/w.png" }
      }
    ]
  },
  detail: GS_DETAIL,
  compute: {
    overall_material_consume: {
      avatar_consume: [{ consume: [{ name: "摩拉", icon: "https://x/m.png", num: 420000, lack_num: 0 }] }],
      avatar_skill_consume: [{ consume: [{ name: "「繁荣」的哲学", icon: "", num: 6, lack_num: 6 }] }],
      weapon_consume: [{ consume: [{ name: "白铁矿", icon: "", num: 9, lack_num: 9 }] }]
    }
  }
}

/** 星铁的一套：克拉拉 70 级、一星魂、佩于夜色中 */
const SR_ANSWERS: Answers = {
  avatarInfo: {
    avatar_list: [
      { id: 1107, level: 70, rank: 1, equip: { id: 23015, name: "于夜色中", level: 60, rarity: 5, icon: "https://x/l.png" } }
    ]
  },
  detail: {
    skill_list: [
      { point_id: 110701, cur_level: 1, max_level: 6, anchor: "Point01", item_url: "https://x/1.png" },
      { point_id: 110702, cur_level: 4, max_level: 10, anchor: "Point02", item_url: "https://x/2.png" }
    ]
  },
  compute: {
    coin_id: 2,
    avatar_consume: [{ item_name: "信用点", item_url: "https://x/c.png", num: 200000 }],
    skill_consume: [{ item_name: "命运的足迹", item_url: "", num: 8 }],
    equipment_consume: [{ item_name: "「毁灭」的开端", item_url: "", num: 4 }]
  }
}

/**
 * 造一份依赖包；`answers` 里某个接口的值为 `Error` 时那一次查询按失败返回
 * @param answers 每个接口给什么
 * @param uid 查询实际用的 uid
 * @param withMeta 是否装了元数据
 * @returns 依赖包与调用记录
 */
function makeDeps(
  answers: Answers,
  uid = "100000001",
  withMeta = true
): { deps: MhyDeps; calls: Call[] } {
  const calls: Call[] = []
  const loader = new MetaLoader({ dir, logger: LOGGER })
  const mys = {
    query: async (api: string, opts: QueryOptions): Promise<unknown> => {
      calls.push({ api, opts })
      const got = answers[api]
      if (got instanceof Error) {
        return { ok: false, api, uid, retcode: -1, message: got.message, kind: "unknown" }
      }
      return { ok: true, api, uid, ltuid: "1", data: got ?? null, cached: false }
    }
  }
  const deps = {
    mys,
    logger: LOGGER,
    config: () => ({}),
    ...(withMeta ? { meta: { loader, installer: {} } } : {})
  } as unknown as MhyDeps
  return { deps, calls }
}

describe("charCalculator 的入口判断", () => {
  it("`#角色养成` 给帮助，示例按游戏分两套", async () => {
    const { deps } = makeDeps(GS_ANSWERS)
    const gs = makeSession("")
    await charCalculator(gs, deps)
    expect(gs.said[0]).toContain("#刻晴养成")

    const sr = makeSession("", "sr")
    await charCalculator(sr, deps)
    expect(sr.said[0]).toContain("*克拉拉养成")
  })

  it("`#养成计算` 同样落到帮助 —— 剥掉触发词后什么都不剩", async () => {
    const { deps, calls } = makeDeps(GS_ANSWERS)
    const s = makeSession("养成计算")
    await charCalculator(s, deps)
    expect(s.said[0]).toContain("角色养成计算")
    expect(calls).toHaveLength(0)
  })

  it("绝区零前缀下写别的游戏的角色名时一个字都不说 —— 这个后缀太常见", async () => {
    const { deps, calls } = makeDeps(GS_ANSWERS)
    const s = makeSession("刻晴养成90", "zzz")
    await charCalculator(s, deps)
    expect(s.said).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it("认不出名字时一个字都不说", async () => {
    const { deps, calls } = makeDeps(GS_ANSWERS)
    const s = makeSession("莫得此人养成90")
    await charCalculator(s, deps)
    expect(s.said).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it("没装元数据时同样静默 —— 连「这是不是角色名」都判不出", async () => {
    const { deps } = makeDeps(GS_ANSWERS, "100000001", false)
    const s = makeSession("刻晴养成90")
    await charCalculator(s, deps)
    expect(s.said).toEqual([])
  })

  it("查到的是武器时也静默 —— 武器与角色同在一张索引里", async () => {
    const { deps } = makeDeps(GS_ANSWERS)
    const s = makeSession("磐岩结绿养成90")
    await charCalculator(s, deps)
    expect(s.said).toEqual([])
  })

  it("旅行者明确拒绝 —— 名字已经认出来了，此时沉默会让人以为命令坏了", async () => {
    const { deps, calls } = makeDeps(GS_ANSWERS)
    const s = makeSession("旅行者养成90")
    await charCalculator(s, deps)
    expect(s.said[0]).toContain("暂不支持旅行者")
    expect(calls).toHaveLength(0)
  })

  it("参数给多了时把示例里的角色名换成查的那个", async () => {
    const { deps, calls } = makeDeps(GS_ANSWERS)
    const s = makeSession("刻晴养成1 2 3 4 5 6")
    await charCalculator(s, deps)
    expect(s.said[0]).toContain("等级有误")
    expect(s.said[0]).toContain("#刻晴养成")
    // 参数先判、再发请求：一次 CK 额度都不该为此花掉
    expect(calls).toHaveLength(0)
  })
})

describe("charCalculator 原神", () => {
  it("三个接口依次打，出图走 calculator-gs", async () => {
    const { deps, calls } = makeDeps(GS_ANSWERS)
    const s = makeSession("刻晴养成81 90 9 9 9")
    await charCalculator(s, deps)

    expect(calls.map(one => one.api)).toEqual(["character", "detail", "compute"])
    expect(s.drew).toHaveLength(1)
    expect(s.drew[0]?.template).toBe("gs/calculator")
  })

  it("图上的等级与消耗都对得上", async () => {
    const { deps } = makeDeps(GS_ANSWERS)
    const s = makeSession("刻晴养成81 90 9 9 9")
    await charCalculator(s, deps)

    const view = s.drew[0]?.data as unknown as CalculatorView
    expect(view.uid).toBe("100000001")
    expect(view.role).toMatchObject({ name: "刻晴", level: 80, target: 81, star: 5, cons: 2 })
    expect(view.role.face).toBe("meta-gs/character/刻晴/imgs/face.webp")
    expect(view.equip).toMatchObject({ name: "磐岩结绿", level: 20, target: 90 })
    // 满级为 1 的被动不进技能表
    expect(view.skills).toHaveLength(3)
    expect(view.skills.map(one => one.target)).toEqual([9, 9, 9])
    expect(view.avatarConsume[0]?.num).toBe("42.0 w")
    expect(view.skillConsume[0]?.isTalent).toBe(true)
  })

  it("请求体里只有前三个技能，且带上 uid 与区服", async () => {
    const { deps, calls } = makeDeps(GS_ANSWERS)
    await charCalculator(makeSession("刻晴养成"), deps)

    const body = calls[2]?.opts.data?.body as Record<string, unknown>
    expect(body["region"]).toBe("cn_gf01")
    const first = (body["items"] as Record<string, unknown>[])[0]
    expect((first?.["skill_list"] as unknown[]).length).toBe(3)
    expect(first?.["avatar_level_target"]).toBe(90)
  })

  it("未拥有的角色改走 avatarSkill，等级按 1 起算且不带武器", async () => {
    const { deps, calls } = makeDeps({
      ...GS_ANSWERS,
      character: { avatars: [] },
      avatarSkill: { list: GS_SKILL_LIST }
    })
    const s = makeSession("刻晴养成")
    await charCalculator(s, deps)

    expect(calls.map(one => one.api)).toEqual(["character", "avatarSkill", "compute"])
    const view = s.drew[0]?.data as unknown as CalculatorView
    expect(view.role.level).toBe(1)
    expect(view.equip).toBeUndefined()
    expect(view.skills.map(one => one.current)).toEqual([1, 1, 1])
  })

  it("三星以下的武器把目标等级压到 70 —— 图上与请求体取同一个值", async () => {
    const { deps, calls } = makeDeps({
      ...GS_ANSWERS,
      character: {
        avatars: [
          {
            id: 10000042,
            level: 80,
            weapon: { id: 11101, name: "无锋剑", level: 20, rarity: 1, icon: "" }
          }
        ]
      }
    })
    const s = makeSession("刻晴养成90 90 10 10 10")
    await charCalculator(s, deps)

    const view = s.drew[0]?.data as unknown as CalculatorView
    expect(view.equip?.target).toBe(70)
    const body = calls[2]?.opts.data?.body as Record<string, unknown>
    const first = (body["items"] as Record<string, unknown>[])[0]
    expect((first?.["weapon"] as Record<string, unknown>)["level_target"]).toBe(70)
  })

  it("技能表不足三条时说清是数据还没上线", async () => {
    const { deps } = makeDeps({ ...GS_ANSWERS, detail: { skill_list: GS_DETAIL.skill_list.slice(0, 2) } })
    const s = makeSession("刻晴养成")
    await charCalculator(s, deps)
    expect(s.said[0]).toContain("暂无角色数据")
  })

  it("查询失败时把接口的原因带出来", async () => {
    const { deps } = makeDeps({ ...GS_ANSWERS, character: new Error("请先登录") })
    const s = makeSession("刻晴养成")
    await charCalculator(s, deps)
    expect(s.said[0]).toContain("请先登录")
  })

  it("出不了图时退回文字，而不是什么都不回", async () => {
    const { deps } = makeDeps(GS_ANSWERS)
    const s = makeSession("刻晴养成", "gs", false)
    await charCalculator(s, deps)
    expect(s.said[0]).toContain("刻晴 养成计算")
    expect(s.said[0]).toContain("摩拉")
  })
})

describe("charCalculator 星穹铁道", () => {
  it("两个接口就够，且 tab_from 是 TabOwned", async () => {
    const { deps, calls } = makeDeps(SR_ANSWERS)
    const s = makeSession("克拉拉养成75 80 6 9 9 9", "sr")
    await charCalculator(s, deps)

    expect(calls.map(one => one.api)).toEqual(["avatarInfo", "detail", "compute"])
    expect(calls[1]?.opts.data?.tab_from).toBe("TabOwned")
    expect(s.drew[0]?.template).toBe("sr/calculator")
  })

  it("图上按行迹取名，信用点那一节不带「还缺多少」", async () => {
    const { deps } = makeDeps(SR_ANSWERS)
    const s = makeSession("克拉拉养成75 80 6 9 9 9", "sr")
    await charCalculator(s, deps)

    const view = s.drew[0]?.data as unknown as CalculatorView
    expect(view.role).toMatchObject({ name: "克拉拉", level: 70, target: 75, cons: 1 })
    expect(view.equip).toMatchObject({ name: "于夜色中", level: 60, target: 80 })
    expect(view.skills.map(one => one.name)).toEqual(["普通攻击", "战技"])
    expect(view.skillTitle).toBe("行迹消耗")
    expect(view.avatarConsume[0]).toEqual({ name: "信用点", icon: "https://x/c.png", num: "20.0 w" })
  })

  it("未拥有时改用 TabAll，并把忆灵行迹并进来", async () => {
    const { deps, calls } = makeDeps({
      ...SR_ANSWERS,
      avatarInfo: { avatar_list: [] },
      detail: {
        skills: [{ point_id: 110701, cur_level: 1, max_level: 6, anchor: "Point01", item_url: "" }],
        skills_servant: [{ point_id: 110705, cur_level: 1, max_level: 6, anchor: "Point19", item_url: "" }]
      }
    })
    const s = makeSession("克拉拉养成", "sr")
    await charCalculator(s, deps)

    expect(calls[1]?.opts.data?.tab_from).toBe("TabAll")
    const view = s.drew[0]?.data as unknown as CalculatorView
    expect(view.skills.map(one => one.name)).toEqual(["普通攻击", "忆灵技"])
    expect(view.role.level).toBe(1)
  })

  it("行迹表是空的时候说清是数据还没上线", async () => {
    const { deps } = makeDeps({ ...SR_ANSWERS, detail: { skill_list: [] } })
    const s = makeSession("克拉拉养成", "sr")
    await charCalculator(s, deps)
    expect(s.said[0]).toContain("暂无角色数据")
  })
})

/** 一套尘歌壶的返回值 */
const BP_ANSWERS: Answers = {
  blueprint: { list: [{ id: 373301, name: "「郊郊有神」", num: 2, icon_url: "https://x/f.png" }] },
  blueprintCompute: { list: [{ name: "松木", icon: "https://x/w.png", num: 40 }] }
}

describe("blueprint", () => {
  it("不带分享码时给帮助", async () => {
    const { deps, calls } = makeDeps(BP_ANSWERS)
    const s = makeSession("")
    await blueprint(s, deps)
    expect(s.said[0]).toContain("尘歌壶模数")
    expect(calls).toHaveLength(0)
  })

  it("位数不对时说参数有误 —— 分享码是 10 到 15 位", async () => {
    const { deps, calls } = makeDeps(BP_ANSWERS)
    const s = makeSession("123")
    await blueprint(s, deps)
    expect(s.said[0]).toContain("有误")
    expect(calls).toHaveLength(0)
  })

  it("只有原神有尘歌壶", async () => {
    const { deps } = makeDeps(BP_ANSWERS)
    const s = makeSession("1234567890", "sr")
    await blueprint(s, deps)
    expect(s.said[0]).toContain("只有原神")
  })

  it("两个接口依次打，第一个带上计算器活动页的 Referer", async () => {
    const { deps, calls } = makeDeps(BP_ANSWERS)
    const s = makeSession("1234567890")
    await blueprint(s, deps)

    expect(calls.map(one => one.api)).toEqual(["blueprint", "blueprintCompute"])
    expect(calls[0]?.opts.headers?.["Referer"]).toContain("adopt_calculator")
    expect(calls[1]?.opts.data?.body).toEqual({ list: [{ cnt: 2, id: 373301 }] })
    expect(s.drew[0]?.template).toBe("gs/blueprint")
  })

  it("查不到这份模数时不再发第二个请求", async () => {
    const { deps, calls } = makeDeps({ ...BP_ANSWERS, blueprint: { list: [] } })
    const s = makeSession("1234567890")
    await blueprint(s, deps)
    expect(s.said[0]).toContain("1234567890")
    expect(calls).toHaveLength(1)
  })

  it("出不了图时退回文字", async () => {
    const { deps } = makeDeps(BP_ANSWERS)
    const s = makeSession("1234567890", "gs", false)
    await blueprint(s, deps)
    expect(s.said[0]).toContain("松木 x 40")
  })
})
