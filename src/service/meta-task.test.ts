/**
 * 模块职责：元数据定时增量更新与失败通知的测试
 * 依赖方向：测试文件，安装器与通知都是假的；不下载、不写盘
 * 生命周期：无状态
 * 注意事项：固定四件"不报错但表现相反"的事：**未安装的游戏一律跳过**（否则关掉自动安装之后照样
 *          会被下三百兆）、首次失败立刻通知而此后按间隔节流、**成功一次就把节流清零**（不清则
 *          故障恢复后的下一次故障反被挡住）、**通知发不出去时不记时刻**（记了等于算成已通知过）。
 */
import { describe, expect, it } from "vitest"
import type { MetaGame, MetaResult } from "../meta/download.js"
import type { MetaTaskDeps } from "./meta-task.js"
import { autoUpdateMeta, noticeKey } from "./meta-task.js"

/** 不出声的日志器 */
const LOGGER = {
  debug: (): void => undefined,
  info: (): void => undefined,
  mark: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  trace: (): void => undefined,
  fatal: (): void => undefined
} as unknown as MetaTaskDeps["logger"]

/** 一次运行的观察结果 */
interface Watch {
  /** 真的去装了哪些游戏 */
  ran: MetaGame[]
  /** 发出去的通知 */
  sent: string[]
  /** 节流状态 */
  notice: Map<string, number>
  /** 丢过几次缓存 */
  reloads: number
}

/**
 * 造一套依赖
 * @param init 初值
 * @returns 依赖与观察结果
 */
function make(
  init: {
    /** 各游戏装没装 */
    installed?: Partial<Record<MetaGame, boolean>>
    /** 各游戏正在下载 */
    busy?: Partial<Record<MetaGame, boolean>>
    /** install 的返回，或抛出的错 */
    result?: (game: MetaGame) => MetaResult | Error
    /** 通知能不能发出去 */
    notifyOk?: boolean
    /** 要不要通知 */
    notice?: boolean
    /** 节流间隔 */
    gap?: number
    /** 已有的节流状态 */
    lastNotice?: Record<string, number>
    /** 当前时刻 */
    now?: number
  } = {}
): { deps: MetaTaskDeps; watch: Watch } {
  const watch: Watch = { ran: [], sent: [], notice: new Map(Object.entries(init.lastNotice ?? {})), reloads: 0 }
  const deps: MetaTaskDeps = {
    installer: {
      installed: (game: MetaGame): boolean => init.installed?.[game] ?? true,
      busy: (game: MetaGame): boolean => init.busy?.[game] ?? false,
      install: async (game: MetaGame): Promise<MetaResult> => {
        watch.ran.push(game)
        const got = init.result?.(game) ?? { game, status: "latest", message: "已是最新", count: 0, sha: "abc" }
        if (got instanceof Error) throw got
        return got
      }
    } as unknown as MetaTaskDeps["installer"],
    logger: LOGGER,
    lastNotice: async (game: MetaGame): Promise<number | undefined> => watch.notice.get(noticeKey(game)),
    setNotice: async (game: MetaGame, at: number | undefined): Promise<void> => {
      if (at === undefined) watch.notice.delete(noticeKey(game))
      else watch.notice.set(noticeKey(game), at)
    },
    notify: async (text: string): Promise<boolean> => {
      if (init.notifyOk === false) return false
      watch.sent.push(text)
      return true
    },
    reload: (): void => void (watch.reloads += 1),
    notice: (): boolean => init.notice ?? true,
    noticeGap: (): number => init.gap ?? 3600_000,
    now: (): number => init.now ?? 1_000_000
  }
  return { deps, watch }
}

describe("autoUpdateMeta", () => {
  it("没装过的游戏一律跳过 —— 首次那几百兆由自动安装单管", async () => {
    const { deps, watch } = make({ installed: { gs: true, sr: false, zzz: false } })

    const ret = await autoUpdateMeta(deps)

    expect(watch.ran).toEqual(["gs"])
    expect(ret.checked).toBe(1)
  })

  it("正在下载的也跳过 —— 上一轮还没结束时再发一次只会撞在串行锁上", async () => {
    const { deps, watch } = make({ busy: { gs: true }, installed: { zzz: false } })

    await autoUpdateMeta(deps)

    expect(watch.ran).toEqual(["sr"])
  })

  it("`latest` 那一支不丢缓存 —— 什么都没动，白丢一次会让下次查询重读三千个文件", async () => {
    const { deps, watch } = make()

    const ret = await autoUpdateMeta(deps)

    expect(ret.updated).toBe(0)
    expect(watch.reloads).toBe(0)
  })

  it("真的更新了才丢缓存，且只丢一次", async () => {
    const { deps, watch } = make({
      result: (game): MetaResult => ({ game, status: "update", message: "更新完成", count: 3, sha: "def" })
    })

    const ret = await autoUpdateMeta(deps)

    expect(ret.updated).toBe(3)
    expect(watch.reloads).toBe(1)
  })

  it("首次失败立刻通知", async () => {
    const { deps, watch } = make({
      installed: { gs: true, sr: false, zzz: false },
      result: (game): MetaResult => ({ game, status: "error", message: "连不上", count: 0, sha: "" })
    })

    const ret = await autoUpdateMeta(deps)

    expect(ret.failed).toBe(1)
    expect(ret.notified).toBe(1)
    expect(watch.sent.join("")).toContain("连不上")
    expect(watch.notice.get(noticeKey("gs"))).toBe(1_000_000)
  })

  it("间隔没到时不再通知，到了才通知", async () => {
    const fail = (game: MetaGame): MetaResult => ({ game, status: "error", message: "连不上", count: 0, sha: "" })
    // 间隔取十万毫秒，好让"差一千"与"差五十万"分别落在两侧
    const near = make({
      installed: { gs: true, sr: false, zzz: false },
      result: fail,
      gap: 100_000,
      now: 1_000_000,
      lastNotice: { [noticeKey("gs")]: 999_000 }
    })
    const far = make({
      installed: { gs: true, sr: false, zzz: false },
      result: fail,
      gap: 100_000,
      now: 1_000_000,
      lastNotice: { [noticeKey("gs")]: 500_000 }
    })

    expect((await autoUpdateMeta(near.deps)).notified).toBe(0)
    expect((await autoUpdateMeta(far.deps)).notified).toBe(1)
  })

  it("抛异常与 `status: error` 一样算失败", async () => {
    const { deps, watch } = make({
      installed: { gs: true, sr: false, zzz: false },
      result: (): Error => new Error("包坏了")
    })

    const ret = await autoUpdateMeta(deps)

    expect(ret.failed).toBe(1)
    expect(watch.sent.join("")).toContain("包坏了")
  })

  it("成功一次就把节流清零 —— 不清则故障恢复后的下一次故障反被挡住", async () => {
    const { deps, watch } = make({ installed: { gs: true, sr: false, zzz: false }, lastNotice: { [noticeKey("gs")]: 999_000 } })

    await autoUpdateMeta(deps)

    expect(watch.notice.has(noticeKey("gs"))).toBe(false)
  })

  it("通知发不出去时不记时刻 —— 记了就等于把这次故障算成已通知过", async () => {
    const { deps, watch } = make({
      installed: { gs: true, sr: false, zzz: false },
      result: (game): MetaResult => ({ game, status: "error", message: "连不上", count: 0, sha: "" }),
      notifyOk: false
    })

    const ret = await autoUpdateMeta(deps)

    expect(ret.notified).toBe(0)
    expect(watch.notice.has(noticeKey("gs"))).toBe(false)
  })

  it("关掉通知时只记日志，一条都不发", async () => {
    const { deps, watch } = make({
      result: (game): MetaResult => ({ game, status: "error", message: "连不上", count: 0, sha: "" }),
      notice: false
    })

    const ret = await autoUpdateMeta(deps)

    expect(ret.failed).toBe(3)
    expect(watch.sent).toEqual([])
  })
})
