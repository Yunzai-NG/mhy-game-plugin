/**
 * 模块职责：体力提醒任务的测试
 * 依赖方向：测试文件，依赖 service/note-task 与真实的 NoteRemindStore（内存 KV），查询是假的
 * 生命周期：每个用例一套新 KV
 * 注意事项：固定五处：**按需查而不是每轮全查**（每条 CK 有每日查询上限，每十分钟全查一遍会把
 *          使用者自己的额度耗光）、后台轮询优先走小组件（免验证码，拿不到时退回实时便笺）、
 *          只用自己的 CK、**阈值高过账号自己的上限时按上限算**（否则"阈值 200 而上限 160"
 *          永远不响，与"提醒坏了"无从区分）、推送失败也算提醒过。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { beforeEach, describe, expect, it } from "vitest"
import { NoteRemindStore } from "../store/note.js"
import type { RemindState } from "../store/note.js"
import type { NoteRaw } from "../views/note.js"
import { buildNote } from "../views/note.js"
import type { QueryOptions, QueryResult } from "./mys.js"
import type { WidgetQuery, WidgetResult } from "./widget.js"
import { nextCheckAt, REMIND_REPEAT, remindStamina, remindText } from "./note-task.js"

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

/** 固定的"现在" */
const NOW = new Date(2026, 8, 3, 10, 0, 0).getTime()

/** 一天一格 480 秒的原神树脂：还差 60 格回满 */
const GS_RAW: NoteRaw = { current_resin: 140, max_resin: 200, resin_recovery_time: 28_800 }

let store: NoteRemindStore

beforeEach(() => {
  store = new NoteRemindStore({ kv: new Kv(new MemoryKvDriver()).sub("remind"), now: (): number => NOW })
})

/** 一轮的观察结果 */
interface Watch {
  /** 查了哪些，连同查询参数 */
  asked: QueryOptions[]
  /** 走小组件问了哪些 */
  widget: WidgetQuery[]
  /** 推出去了什么 */
  sent: { user: string; groupId?: string; text: string; template: string }[]
}

/** 造一轮的选项 */
interface RunOptions {
  /** 接口给什么，缺省是 {@link GS_RAW} */
  raw?: NoteRaw
  /** 让查询失败 */
  fail?: boolean
  /** 让查询抛错 */
  throws?: boolean
  /** 让推送失败 */
  notifyOk?: boolean
  /** 挂上小组件；给 `raw` 表示它成功，给 `skip` 表示它取不到 */
  widget?: { raw?: NoteRaw; skip?: "nostoken" | "ambiguous" | "oversea" | "fail" }
  /** 取消信号 */
  signal?: AbortSignal
}

/**
 * 跑一轮
 * @param opts 选项
 * @returns 统计与观察结果
 */
async function run(
  opts: RunOptions = {}
): Promise<{ result: Awaited<ReturnType<typeof remindStamina>>; watch: Watch }> {
  const watch: Watch = { asked: [], widget: [], sent: [] }
  const result = await remindStamina({
    reminds: store,
    mys: {
      query: async <T,>(_type: string, o: QueryOptions): Promise<QueryResult<T>> => {
        watch.asked.push(o)
        if (opts.throws) throw new Error("connect ETIMEDOUT")
        if (opts.fail) {
          return { ok: false, api: "dailyNote", retcode: 0, message: "没有可用的 uid", kind: "nouid" }
        }
        return {
          ok: true,
          api: "dailyNote",
          uid: "100000001",
          ltuid: "1001",
          data: (opts.raw ?? GS_RAW) as T,
          cached: false
        }
      }
    },
    ...(opts.widget
      ? {
          widget: {
            note: async (q: WidgetQuery): Promise<WidgetResult> => {
              watch.widget.push(q)
              const raw = opts.widget?.raw
              if (raw) return { ok: true, data: raw }
              return { ok: false, skip: opts.widget?.skip ?? "fail", message: "测试用" }
            }
          }
        }
      : {}),
    logger: LOGGER as never,
    now: (): number => NOW,
    notify: async (state: RemindState, payload: { text: string; template: string }): Promise<boolean> => {
      watch.sent.push({
        user: state.user,
        ...(state.groupId ? { groupId: state.groupId } : {}),
        text: payload.text,
        template: payload.template
      })
      return opts.notifyOk ?? true
    },
    ...(opts.signal ? { signal: opts.signal } : {})
  })
  return { result, watch }
}

describe("nextCheckAt", () => {
  it("按「回满秒数 ÷ 还差几格」折出每格的秒数，不按游戏写死回复速度", () => {
    // 还差 60 格、28800 秒回满 → 每格 480 秒；到 150 还差 10 格 = 4800 秒，另加一分钟余量
    expect(nextCheckAt({ current: 140, max: 200, seconds: 28_800 }, 150, NOW)).toBe(NOW + 4_800_000 + 60_000)
    // 星铁六分钟一格：还差 60 格、21600 秒 → 每格 360 秒
    expect(nextCheckAt({ current: 180, max: 240, seconds: 21_600 }, 200, NOW)).toBe(NOW + 7_200_000 + 60_000)
  })

  it("算出来太近的压到十分钟 —— 免得同一个人在相邻两轮里被查两次", () => {
    expect(nextCheckAt({ current: 199, max: 200, seconds: 480 }, 200, NOW)).toBe(NOW + 600_000)
  })

  it("算出来太远的压到六小时 —— 推算失准时不至于把提醒搁到明天", () => {
    expect(nextCheckAt({ current: 0, max: 200, seconds: 96_000 }, 200, NOW)).toBe(NOW + 6 * 3600_000)
  })

  it("已经满了、或字段缺失时退回六小时", () => {
    expect(nextCheckAt({ current: 200, max: 200, seconds: 0 }, 200, NOW)).toBe(NOW + 6 * 3600_000)
    expect(nextCheckAt({ current: 0, max: 0, seconds: 0 }, 20, NOW)).toBe(NOW + 6 * 3600_000)
  })
})

describe("remindText", () => {
  it("自成完整答案，且关闭方法带着当前游戏的前缀", () => {
    const view = buildNote(
      { current_stamina: 240, max_stamina: 240 },
      { game: "sr", uid: "100000001", name: "", now: NOW }
    )
    const text = remindText(view, 180)

    expect(text).toContain("【体力提醒】")
    expect(text).toContain("已经回满了")
    // 便笺正文照样带上：使用者要做的决定是"现在要不要上游戏"
    expect(text).toContain("开拓力 240/240")
    expect(text).toContain("#星铁体力提醒关闭")
  })
  it("没满时把阈值一起说出来", () => {
    const view = buildNote(GS_RAW, { game: "gs", uid: "100000001", name: "", now: NOW })
    expect(remindText(view, 120)).toContain("超过你设的 120")
  })
})

describe("remindStamina", () => {
  it("没开提醒的一条都不查 —— 这是缺省状态", async () => {
    const { result, watch } = await run()

    expect(watch.asked).toEqual([])
    expect(result).toEqual({ total: 0, checked: 0, byWidget: 0, sent: 0, failed: 0 })
  })

  it("没到点的不查 —— 每轮全查会把使用者自己的每日额度耗光", async () => {
    await store.enable("qq:1", "gs", { nextAt: NOW + 3600_000 })
    const { result, watch } = await run()

    expect(watch.asked).toEqual([])
    expect(result).toMatchObject({ total: 1, checked: 0 })
  })

  it("到点且过了阈值就推一张便笺图，并把下次检查压到 8 小时后", async () => {
    await store.enable("qq:1", "gs", { threshold: 120 })
    const { result, watch } = await run()

    expect(result).toMatchObject({ total: 1, checked: 1, sent: 1, failed: 0 })
    expect(watch.sent).toHaveLength(1)
    expect(watch.sent[0]?.text).toContain("【体力提醒】")
    // 出图与文字都给：推送层先试模板，出不来才发文字
    expect(watch.sent[0]?.template).toBe("gs/note")
    expect(await store.get("qq:1", "gs")).toMatchObject({ lastAt: NOW, nextAt: NOW + REMIND_REPEAT })
    expect(REMIND_REPEAT).toBe(8 * 3600_000)
  })

  it("查到之后把 uid 记回设置里 —— 下一轮才走得了小组件", async () => {
    await store.enable("qq:1", "gs", { threshold: 150 })
    await run()

    expect(await store.get("qq:1", "gs")).toMatchObject({ uid: "100000001" })
  })

  it("只用自己绑的 CK —— 实时便笺只对账号本人开放，且必须带上 state.user", async () => {
    await store.enable("qq:1", "gs", { threshold: 120 })
    const { watch } = await run()

    expect(watch.asked[0]).toMatchObject({ user: "qq:1", game: "gs" })
  })

  it("没到阈值就不推，下次检查按回满秒数推算", async () => {
    await store.enable("qq:1", "gs", { threshold: 150 })
    const { result, watch } = await run()

    expect(watch.sent).toEqual([])
    expect(result).toMatchObject({ checked: 1, sent: 0, failed: 0 })
    expect((await store.get("qq:1", "gs")).nextAt).toBe(NOW + 4_800_000 + 60_000)
  })

  it("阈值高过这个账号的上限时按上限算 —— 否则永远不响，而那与提醒坏了完全相同", async () => {
    await store.enable("qq:1", "gs", { threshold: 200 })
    const { watch } = await run({ raw: { current_resin: 160, max_resin: 160, resin_recovery_time: 0 } })

    expect(watch.sent).toHaveLength(1)
    expect(watch.sent[0]?.text).toContain("已经回满了")
  })

  it("已经知道 uid 时先走小组件，一个实时便笺的包都不发 —— 那一条才吃验证码", async () => {
    await store.enable("qq:1", "gs", { threshold: 120, uid: "100000001" })
    const { result, watch } = await run({ widget: { raw: GS_RAW } })

    expect(watch.widget).toEqual([{ game: "gs", uid: "100000001", owner: "qq:1" }])
    expect(watch.asked).toEqual([])
    expect(result).toMatchObject({ checked: 1, byWidget: 1, sent: 1 })
  })

  it("还不知道 uid 时不走小组件 —— 它的返回不带 uid，拿不准是哪个账号时不猜", async () => {
    await store.enable("qq:1", "gs", { threshold: 120 })
    const { watch } = await run({ widget: { raw: GS_RAW } })

    expect(watch.widget).toEqual([])
    expect(watch.asked).toHaveLength(1)
  })

  it("小组件取不到就退回实时便笺，而不是放弃这一条", async () => {
    await store.enable("qq:1", "gs", { threshold: 120, uid: "100000001" })
    const { result, watch } = await run({ widget: { skip: "nostoken" } })

    expect(watch.widget).toHaveLength(1)
    expect(watch.asked).toHaveLength(1)
    expect(result).toMatchObject({ checked: 1, byWidget: 0, sent: 1, failed: 0 })
  })

  it("查不到就往后压两小时，不推也不重试 —— uid 解绑、CK 停用不会在五分钟后好转", async () => {
    await store.enable("qq:1", "gs")
    const { result } = await run({ fail: true })

    expect(result).toMatchObject({ checked: 1, sent: 0, failed: 1 })
    expect((await store.get("qq:1", "gs")).nextAt).toBe(NOW + 2 * 3600_000)
  })

  it("推送失败也算提醒过 —— 不是好友、群踢了 Bot 都不会自己好转", async () => {
    await store.enable("qq:1", "gs", { threshold: 120 })
    const { result } = await run({ notifyOk: false })

    expect(result.sent).toBe(0)
    expect(await store.get("qq:1", "gs")).toMatchObject({ lastAt: NOW, nextAt: NOW + REMIND_REPEAT })
  })

  it("群里开的推到那个群；群级开关关掉之后一条都不查", async () => {
    await store.enable("qq:1", "gs", { threshold: 120, groupId: "9001" })
    const first = await run()
    expect(first.watch.sent[0]?.groupId).toBe("9001")

    await store.enable("qq:1", "gs", { threshold: 120, groupId: "9001" })
    await store.setGroupEnabled("9001", false)
    const second = await run()
    expect(second.watch.asked).toEqual([])
    expect(second.result).toMatchObject({ total: 1, checked: 0 })
  })

  it("一条出错不影响后面的，且出错的那条也往后压", async () => {
    await store.enable("qq:1", "gs")
    await store.enable("qq:2", "gs")
    const { result } = await run({ throws: true })

    expect(result).toMatchObject({ total: 2, checked: 2, failed: 2 })
    expect((await store.get("qq:1", "gs")).nextAt).toBe(NOW + 2 * 3600_000)
    expect((await store.get("qq:2", "gs")).nextAt).toBe(NOW + 2 * 3600_000)
  })

  it("收到取消信号就停下剩下的条目", async () => {
    await store.enable("qq:1", "gs", { threshold: 120 })
    const controller = new AbortController()
    controller.abort()
    const { watch } = await run({ signal: controller.signal })

    expect(watch.asked).toEqual([])
  })
})
