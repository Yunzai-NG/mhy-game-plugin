/**
 * 模块职责：`#体力提醒` 一族与 `#体力` 分派的测试
 * 依赖方向：测试文件，依赖 commands/note、commands/note-remind 与真实的 NoteRemindStore（内存 KV）
 * 生命周期：每个用例一套新 KV
 * 注意事项：最要紧的一条是 **`#体力` 本身不能被认成设置提醒** —— 两件事共用一条命令，认错就等于
 *          把查体力这条命令吃掉。另三条与"主动推送"相关：开启前先真查一次（查不到就不开，否则
 *          提醒静默地永远不响）、群里开的要明说这个群都看得到你的体力、总开关没开时明说现在
 *          还不会真的推。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { beforeEach, describe, expect, it } from "vitest"
import type { MhyConfigView } from "../config.js"
import type { Session } from "../core/session.js"
import type { QueryOptions, QueryResult } from "../service/mys.js"
import { NoteRemindStore } from "../store/note.js"
import type { NoteRaw } from "../views/note.js"
import type { MhyDeps } from "./deps.js"
import { noteOrRemind } from "./note.js"
import { parseRemindRest } from "./note-remind.js"

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

/** 一份便笺：树脂 140/200，还差 60 格 */
const RAW: NoteRaw = { current_resin: 140, max_resin: 200, resin_recovery_time: 28_800 }

/** 假会话，记录回复 */
interface Spy extends Session {
  /** 收到的全部回复 */
  readonly said: string[]
  /** 出过几张图 */
  readonly drew: string[]
}

/**
 * 造一个假会话
 * @param rest 命令之后的内容
 * @param over 要覆盖的字段
 * @returns 假会话
 */
function makeSession(rest = "", over: Partial<Session> = {}): Spy {
  const said: string[] = []
  const drew: string[] = []
  return {
    user: "qq:1",
    name: "旅行者",
    rest,
    game: "gs",
    isPrivate: true,
    isMaster: false,
    isGroupAdmin: false,
    botId: "bot-1",
    lastSent: (): string => "msg-1",
    images: [],
    said,
    drew,
    text: async (content: string): Promise<void> => void said.push(content),
    image: async (template: string): Promise<boolean> => {
      drew.push(template)
      return false
    },
    ask: async (): Promise<undefined> => undefined,
    file: async (): Promise<undefined> => undefined,
    askFile: async (): Promise<undefined> => undefined,
    sendFile: async (): Promise<boolean> => false,
    imageBytes: async (): Promise<boolean> => false,
    imageFile: async (): Promise<boolean> => false,
    forward: async (): Promise<boolean> => false,
    ...over
  }
}

let store: NoteRemindStore

beforeEach(() => {
  store = new NoteRemindStore({ kv: new Kv(new MemoryKvDriver()).sub("remind") })
})

/** 一次运行的观察结果 */
interface Watch {
  /** 查了哪些接口 */
  asked: string[]
}

/**
 * 造一份依赖包
 * @param opts 让查询失败，或改配置
 * @returns 依赖包与观察结果
 */
function makeDeps(opts: { fail?: boolean; on?: boolean } = {}): { deps: MhyDeps; watch: Watch } {
  const watch: Watch = { asked: [] }
  const deps = {
    mys: {
      query: async <T,>(type: string, _o: QueryOptions): Promise<QueryResult<T>> => {
        watch.asked.push(type)
        if (opts.fail) {
          return { ok: false, api: type, retcode: 0, message: "没有可用的 Cookie，请先绑定 CK", kind: "nock" }
        }
        return { ok: true, api: type, uid: "100000001", ltuid: "1001", data: RAW as T, cached: false }
      }
    },
    reminds: store,
    logger: LOGGER,
    config: () => ({ enableStaminaRemind: opts.on ?? false }) as unknown as MhyConfigView
  } as unknown as MhyDeps
  return { deps, watch }
}

describe("parseRemindRest", () => {
  it("`#体力` 本身不算设置提醒 —— 认错就把查体力这条命令吃掉了", () => {
    expect(parseRemindRest("")).toBeUndefined()
    expect(parseRemindRest("100000001")).toBeUndefined()
    expect(parseRemindRest("查询")).toBeUndefined()
  })

  it("认出开、关、状态与群级开关", () => {
    expect(parseRemindRest("提醒")).toEqual({ kind: "on" })
    expect(parseRemindRest("推送开启")).toEqual({ kind: "on" })
    expect(parseRemindRest("提醒150")).toEqual({ kind: "on", threshold: 150 })
    expect(parseRemindRest("提醒 150")).toEqual({ kind: "on", threshold: 150 })
    expect(parseRemindRest("提醒关闭")).toEqual({ kind: "off" })
    expect(parseRemindRest("推送关")).toEqual({ kind: "off" })
    expect(parseRemindRest("提醒群关闭")).toEqual({ kind: "group", groupOn: false })
    expect(parseRemindRest("提醒群开启")).toEqual({ kind: "group", groupOn: true })
  })

  it("认不出的后缀一律当看状态 —— `#体力提醒帮助` 不该反而把它开了", () => {
    expect(parseRemindRest("提醒帮助")).toEqual({ kind: "status" })
    expect(parseRemindRest("提醒状态")).toEqual({ kind: "status" })
  })
})

describe("noteOrRemind", () => {
  it("不是设置提醒就照旧查便笺", async () => {
    const { deps, watch } = makeDeps()
    const s = makeSession()
    await noteOrRemind(s, deps)

    expect(watch.asked).toContain("dailyNote")
    expect(s.drew).toEqual(["gs/note"])
    expect(await store.get("qq:1", "gs")).toMatchObject({ enabled: false })
  })

  it("开启前先真查一次，且把阈值、推到哪、怎么关都说清", async () => {
    const { deps, watch } = makeDeps()
    const s = makeSession("提醒")
    await noteOrRemind(s, deps)

    expect(watch.asked).toEqual(["dailyNote"])
    expect(await store.get("qq:1", "gs")).toMatchObject({ enabled: true, threshold: 120 })
    expect((await store.get("qq:1", "gs")).nextAt).toBeGreaterThan(0)
    expect(s.said[0]).toContain("120")
    expect(s.said[0]).toContain("私聊发给你")
    expect(s.said[0]).toContain("8 小时")
    expect(s.said[0]).toContain("#体力提醒关闭")
  })

  it("一并把 uid 与 Bot 号存下 —— 前者让后台走小组件，后者让推送从同一个号发出去", async () => {
    const { deps } = makeDeps()
    await noteOrRemind(makeSession("提醒"), deps)

    expect(await store.get("qq:1", "gs")).toMatchObject({ uid: "100000001", botId: "bot-1" })
  })

  it("查不到就不开 —— 否则提醒会静默地永远不响", async () => {
    const { deps } = makeDeps({ fail: true })
    const s = makeSession("提醒")
    await noteOrRemind(s, deps)

    expect(await store.get("qq:1", "gs")).toMatchObject({ enabled: false })
    expect(s.said[0]).toContain("提醒没有开启")
    expect(s.said[0]).toContain("#绑定CK")
  })

  it("总开关没开时明说现在还不会真的推", async () => {
    const off = makeDeps()
    const s = makeSession("提醒")
    await noteOrRemind(s, off.deps)
    expect(s.said[0]).toContain("总开关")

    const on = makeDeps({ on: true })
    const s2 = makeSession("提醒")
    await noteOrRemind(s2, on.deps)
    expect(s2.said[0]).not.toContain("总开关")
  })

  it("群里开的记下群号，并明说这个群都看得到", async () => {
    const { deps } = makeDeps()
    const s = makeSession("提醒", { groupId: "9001", isPrivate: false })
    await noteOrRemind(s, deps)

    expect(await store.get("qq:1", "gs")).toMatchObject({ groupId: "9001" })
    expect(s.said[0]).toContain("本群")
    expect(s.said[0]).toContain("都看得到")
  })

  it("阈值超出范围时按压过的算，并说清", async () => {
    const { deps } = makeDeps()
    const s = makeSession("提醒9999")
    await noteOrRemind(s, deps)

    expect(await store.get("qq:1", "gs")).toMatchObject({ threshold: 200 })
    expect(s.said[0]).toContain("已按 200 算")
  })

  it("现在就已经超过阈值时说清第一次提醒要等 8 小时", async () => {
    const { deps } = makeDeps()
    const s = makeSession("提醒60")
    await noteOrRemind(s, deps)

    expect(s.said[0]).toContain("已经超过")
  })

  it("关闭时说清手动查仍然可用", async () => {
    const { deps } = makeDeps()
    await noteOrRemind(makeSession("提醒"), deps)
    const s = makeSession("提醒关闭")
    await noteOrRemind(s, deps)

    expect(await store.get("qq:1", "gs")).toMatchObject({ enabled: false })
    expect(s.said[0]).toContain("#体力")
  })

  it("状态列出总开关、逐游戏的开关与用法", async () => {
    const { deps } = makeDeps()
    await noteOrRemind(makeSession("提醒150"), deps)
    const s = makeSession("提醒状态")
    await noteOrRemind(s, deps)

    expect(s.said[0]).toContain("未开启（主人可在面板打开）")
    expect(s.said[0]).toContain("【原神】已开启，阈值 150")
    expect(s.said[0]).toContain("私聊推送")
    expect(s.said[0]).toContain("用法")
  })

  it("星铁与原神各算一条，互不影响", async () => {
    const { deps } = makeDeps()
    await noteOrRemind(makeSession("提醒", { game: "sr" }), deps)

    expect(await store.get("qq:1", "sr")).toMatchObject({ enabled: true })
    expect(await store.get("qq:1", "gs")).toMatchObject({ enabled: false })
  })
})

describe("群级开关", () => {
  it("私聊里发不了 —— 它开关的是整个群", async () => {
    const { deps } = makeDeps()
    const s = makeSession("提醒群关闭")
    await noteOrRemind(s, deps)

    expect(s.said[0]).toContain("要在群里发")
  })

  it("不是群管理也不是主人时拒绝", async () => {
    const { deps } = makeDeps()
    const s = makeSession("提醒群关闭", { groupId: "9001", isPrivate: false })
    await noteOrRemind(s, deps)

    expect(s.said[0]).toContain("只有群管理或主人")
    expect(await store.groupEnabled("9001")).toBe(true)
  })

  it("群管理关掉之后，群里再开提醒会被告知去找管理", async () => {
    const { deps, watch } = makeDeps()
    const admin = makeSession("提醒群关闭", { groupId: "9001", isPrivate: false, isGroupAdmin: true })
    await noteOrRemind(admin, deps)
    expect(await store.groupEnabled("9001")).toBe(false)

    const s = makeSession("提醒", { groupId: "9001", isPrivate: false })
    await noteOrRemind(s, deps)
    expect(s.said[0]).toContain("被管理员关掉")
    // 连查询都不发：这一条本来就开不起来
    expect(watch.asked).toEqual([])
    expect(await store.get("qq:1", "gs")).toMatchObject({ enabled: false })
  })
})
