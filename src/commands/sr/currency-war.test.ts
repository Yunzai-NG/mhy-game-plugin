/**
 * 模块职责：`*货币战争` 与 `*不可知域` 两条命令的测试
 * 依赖方向：测试文件，依赖 commands/sr/currency-war 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：最要紧的是**"当期没打就自动改问上期"**（赛季比忘却之庭长，"这一期还没打"是常态）
 *          与**回退的边界**：请求失败时一次都不许重问（"同一份凭据连发两个已鉴权请求"正是触发
 *          风控的形态），使用者显式说了「上期」时也不回退。断言看的是 `schedules` 这一串。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../../core/session.js"
import type { MhyDeps } from "../deps.js"
import { currencyWar, unknowableDomain } from "./currency-war.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口 */
  apis: string[]
  /** 每次问的是哪一期 —— 回退那几条用例全靠它 */
  schedules: number[]
}

/** 一份有存档的货币战争返回 */
const GRID_OK = {
  grid_fight_brief: { unlocked: true, division: { name: "财富造物主" }, season_level: "167" },
  grid_fight_archive_list: [
    { archive_type: "ArchiveTypeNormal", brief: { archive_rank: "GridFightArchiveRankS", remain_hp: "86" } }
  ]
}

/** 解锁了但没有存档 */
const GRID_EMPTY = { grid_fight_brief: { unlocked: true }, grid_fight_archive_list: [] }

/** 一份打过的不可知域返回 */
const MAGIC_OK = {
  role: { nickname: "其实雨很好", level: 70 },
  basic_info: { challenge_task_current_num: 3, challenge_task_total_num: 25 },
  normal_record_list: [
    { name: "记住他们", completed_time: { year: 2026, month: 9, day: 1, hour: 22, minute: 5 } }
  ],
  custom_record_list: []
}

/** 六条预设全为零 —— 从没打过时接口就是这个样子 */
const MAGIC_EMPTY = {
  role: { nickname: "其实雨很好" },
  basic_info: { magic_record: { schedule_current_floor_num: 0 } },
  normal_record_list: [],
  custom_record_list: [{ name: "记住他们", completed_time: { year: 0, month: 0, day: 0 } }]
}

/**
 * 造一个会话与一份依赖
 * @param answers 哪个游戏、每期分别回什么、命令后面跟了什么
 * @returns 会话、依赖与记录
 */
function make(answers: {
  /** 游戏 */
  game?: "gs" | "sr" | "zzz"
  /** 按期次给返回：键是 schedule_type */
  bySchedule?: Record<number, unknown>
  /** 请求失败 */
  fail?: boolean
  /** 命令后面跟的字 */
  rest?: string
  /** 出图是否成功 */
  imageOk?: boolean
}): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], apis: [], schedules: [] }

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
      query: async (api: string, opts: { data?: { schedule_type?: number } }): Promise<Record<string, unknown>> => {
        const schedule = opts.data?.schedule_type ?? 1
        sent.apis.push(api)
        sent.schedules.push(schedule)
        if (answers.fail) return { ok: false, kind: "cookie", message: "ck 失效" }
        return { ok: true, uid: "101234567", data: answers.bySchedule?.[schedule] ?? {} }
      }
    }
  } as unknown as MhyDeps

  return { s, deps, sent }
}

describe("currencyWar", () => {
  it("有存档时出自己那张图，且标明看的是本期", async () => {
    const { s, deps, sent } = make({ bySchedule: { 1: GRID_OK } })
    await currencyWar(s, deps)

    expect(sent.apis).toEqual(["gridFight"])
    expect(sent.schedules).toEqual([1])
    expect(sent.images[0]?.name).toBe("sr/currency-war")
    expect(sent.images[0]?.data["period"]).toBe("本期")
  })

  it("**本期没存档时自动改问上期**，并在图上标明是上期", async () => {
    const { s, deps, sent } = make({ bySchedule: { 1: GRID_EMPTY, 2: GRID_OK } })
    await currencyWar(s, deps)

    // 先问本期、再问上期，恰好两次
    expect(sent.schedules).toEqual([1, 2])
    expect(sent.images[0]?.data["period"]).toBe("上期")
  })

  it("两期都没有时只回一句话，不出一张空图", async () => {
    const { s, deps, sent } = make({ bySchedule: { 1: GRID_EMPTY, 2: GRID_EMPTY } })
    await currencyWar(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("尚无存档")
  })

  it("**请求失败时一次都不重问** —— 再问不会成功，且连发两个已鉴权请求正是撞风控的形态", async () => {
    const { s, deps, sent } = make({ fail: true })
    await currencyWar(s, deps)

    expect(sent.schedules).toEqual([1])
    expect(sent.images).toEqual([])
  })

  it("显式说了「上期」就直接问上期，不再回退 —— 那时「上期没打」就是答案本身", async () => {
    const { s, deps, sent } = make({ rest: "上期", bySchedule: { 2: GRID_EMPTY } })
    await currencyWar(s, deps)

    expect(sent.schedules).toEqual([2])
    expect(sent.texts.join("")).toContain("上期")
  })

  it("玩法没解锁时说的是「未解锁」而不是「没有战绩」", async () => {
    const { s, deps, sent } = make({ bySchedule: { 1: { grid_fight_brief: { unlocked: false } } } })
    await currencyWar(s, deps)

    // 没解锁不回退：上期同样没有，白发一个请求
    expect(sent.schedules).toEqual([1])
    expect(sent.texts.join("")).toContain("尚未解锁")
  })

  it("原神明确说不支持，一个包都不发", async () => {
    const { s, deps, sent } = make({ game: "gs" })
    await currencyWar(s, deps)

    expect(sent.apis).toEqual([])
    expect(sent.texts.join("")).toContain("仅支持星穹铁道")
  })

  it("出不了图时退回文字，段位那一行仍在", async () => {
    const { s, deps, sent } = make({ bySchedule: { 1: GRID_OK }, imageOk: false })
    await currencyWar(s, deps)

    expect(sent.texts.join("")).toContain("财富造物主")
  })
})

describe("unknowableDomain", () => {
  it("打过时出自己那张图", async () => {
    const { s, deps, sent } = make({ bySchedule: { 1: MAGIC_OK } })
    await unknowableDomain(s, deps)

    expect(sent.apis).toEqual(["rogueMagic"])
    expect(sent.images[0]?.name).toBe("sr/unknowable")
    expect(sent.images[0]?.data["period"]).toBe("本期")
  })

  it("**本期没打时自动改问上期** —— 这一块的赛季长，没打是常态", async () => {
    const { s, deps, sent } = make({ bySchedule: { 1: MAGIC_EMPTY, 2: MAGIC_OK } })
    await unknowableDomain(s, deps)

    expect(sent.schedules).toEqual([1, 2])
    expect(sent.images[0]?.data["period"]).toBe("上期")
  })

  it("**六条预设全为零不算打过** —— 按数组长度判会出一张全零的记录，故改出官方那种空态", async () => {
    const { s, deps, sent } = make({ bySchedule: { 1: MAGIC_EMPTY, 2: MAGIC_EMPTY } })
    await unknowableDomain(s, deps)

    expect(sent.images).toHaveLength(1)
    expect(sent.images[0]?.data["empty"]).toBe(true)
  })

  it("请求失败时不重问", async () => {
    const { s, deps, sent } = make({ fail: true })
    await unknowableDomain(s, deps)

    expect(sent.schedules).toEqual([1])
  })

  it("原神明确说不支持", async () => {
    const { s, deps, sent } = make({ game: "gs" })
    await unknowableDomain(s, deps)

    expect(sent.apis).toEqual([])
    expect(sent.texts.join("")).toContain("仅支持星穹铁道")
  })
})
