/**
 * 模块职责：每日自动签到任务的测试
 * 依赖方向：测试文件，依赖 service/sign-task 与真实的 SignStore（内存 KV），Cookie 池与签到服务是假的
 * 生命周期：每个用例一套新 KV
 * 注意事项：固定那四道闸 —— CK 已停用、该账号没开自动签到、**今天已经签过**、取消信号。第三道
 *          尤其要紧：框架重启会让定时任务重新排一次，没有它就会在同一天里签第二次。另两处：推送
 *          失败不算签到失败（签到已落到米游社，重签无意义）、一个账号出错不影响后面的。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { beforeEach, describe, expect, it } from "vitest"
import type { CookieRecord } from "../store/ck.js"
import { SignStore } from "../store/sign.js"
import type { SignReport } from "./sign.js"
import { dailySign } from "./sign-task.js"

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
const NOW = new Date(2026, 8, 2, 8, 35, 0).getTime()

/**
 * 造一条 Cookie 记录
 * @param ltuid 账号标识
 * @param over 要覆盖的字段
 * @returns 记录
 */
function record(ltuid: string, over: Partial<CookieRecord> = {}): CookieRecord {
  return {
    ltuid,
    cookie: `ltuid=${ltuid};ltoken=x`,
    uids: {},
    owner: `qq:${ltuid}`,
    disabled: false,
    at: NOW,
    ...over
  } as CookieRecord
}

/**
 * 造一份签成了的报告
 * @param ltuid 账号标识
 * @returns 报告
 */
function okReport(ltuid: string): SignReport {
  return {
    ltuid,
    dead: false,
    items: [
      { game: "gs", name: "原神", uid: "100000001", nickname: "旅行者", status: "signed", message: "签到成功", total: 7 }
    ]
  }
}

let signs: SignStore

beforeEach(() => {
  signs = new SignStore({ kv: new Kv(new MemoryKvDriver()).sub("sign"), now: (): number => NOW })
})

/** 一次运行的观察结果 */
interface Watch {
  /** 真的签了哪些账号 */
  ran: string[]
  /** 被停用的账号与原因 */
  disabled: { ltuid: string; reason: string }[]
  /** 推送出去的消息 */
  sent: { user: string; text: string }[]
}

/**
 * 跑一轮
 * @param records Cookie 记录
 * @param opts 让某个账号的签到抛错，或让推送失败
 * @returns 统计与观察结果
 */
async function run(
  records: readonly CookieRecord[],
  opts: { throws?: string; deadOf?: string; notifyOk?: boolean; signal?: AbortSignal } = {}
): Promise<{ result: Awaited<ReturnType<typeof dailySign>>; watch: Watch }> {
  const watch: Watch = { ran: [], disabled: [], sent: [] }
  const result = await dailySign({
    cookies: {
      list: async (): Promise<CookieRecord[]> => [...records],
      disable: async (ltuid: string, reason: string): Promise<boolean> => {
        watch.disabled.push({ ltuid, reason })
        return true
      }
    },
    signs,
    sign: {
      run: async ({ ltuid }: { ltuid: string }): Promise<SignReport> => {
        watch.ran.push(ltuid)
        if (opts.throws === ltuid) throw new Error("connect ETIMEDOUT")
        if (opts.deadOf === ltuid) {
          return {
            ltuid,
            dead: true,
            items: [{ game: "gs", name: "原神", uid: "", nickname: "", status: "cookie", message: "Cookie 已失效" }]
          }
        }
        return okReport(ltuid)
      }
    },
    logger: LOGGER as never,
    notify: async (user: string, text: string): Promise<boolean> => {
      watch.sent.push({ user, text })
      return opts.notifyOk ?? true
    },
    ...(opts.signal ? { signal: opts.signal } : {})
  })
  return { result, watch }
}

describe("dailySign", () => {
  it("没开自动签到的账号一个都不动 —— 这是缺省状态", async () => {
    const { result, watch } = await run([record("1001"), record("1002")])
    expect(watch.ran).toEqual([])
    expect(result).toEqual({ total: 0, ran: 0, skipped: 0, failed: 0 })
  })

  it("开了的才签，且把结果推给绑定者", async () => {
    await signs.setEnabled("1001", true)
    const { result, watch } = await run([record("1001"), record("1002")])

    expect(watch.ran).toEqual(["1001"])
    expect(watch.sent).toHaveLength(1)
    expect(watch.sent[0]?.user).toBe("qq:1001")
    expect(watch.sent[0]?.text).toContain("自动签到")
    expect(watch.sent[0]?.text).toContain("签到成功")
    expect(result.ran).toBe(1)
  })

  it("已停用的 CK 跳过 —— 用一条已知失效的 Cookie 去打米游社只会加深风控", async () => {
    await signs.setEnabled("1001", true)
    const { result, watch } = await run([record("1001", { disabled: true })])
    expect(watch.ran).toEqual([])
    expect(result.total).toBe(0)
  })

  it("今天已经签过就跳过 —— 重启会让定时任务重排一次", async () => {
    await signs.setEnabled("1001", true)
    await signs.mark("1001", true, "签到成功")
    const { result, watch } = await run([record("1001")])

    expect(watch.ran).toEqual([])
    expect(result).toMatchObject({ total: 1, ran: 0, skipped: 1 })
  })

  it("发现 Cookie 失效就把那条停用", async () => {
    await signs.setEnabled("1001", true)
    const { watch } = await run([record("1001")], { deadOf: "1001" })

    expect(watch.disabled).toHaveLength(1)
    expect(watch.disabled[0]?.ltuid).toBe("1001")
    expect(watch.disabled[0]?.reason).toContain("已失效")
    // 失效不算签成，故不写日期，下一轮换了新 CK 还能再签
    expect(await signs.signedToday("1001")).toBe(false)
  })

  it("推送失败不算签到失败 —— 签到已经落到米游社了", async () => {
    await signs.setEnabled("1001", true)
    const { result } = await run([record("1001")], { notifyOk: false })

    expect(result.ran).toBe(1)
    expect(result.failed).toBe(0)
    expect(await signs.signedToday("1001")).toBe(true)
  })

  it("没有绑定者时不推送，但照样签", async () => {
    await signs.setEnabled("1001", true)
    const { result, watch } = await run([record("1001", { owner: undefined })])

    expect(result.ran).toBe(1)
    expect(watch.sent).toEqual([])
  })

  it("一个账号出错不影响后面的账号", async () => {
    await signs.setEnabled("1001", true)
    await signs.setEnabled("1002", true)
    const { result, watch } = await run([record("1001"), record("1002")], { throws: "1001" })

    expect(watch.ran).toEqual(["1001", "1002"])
    expect(result).toMatchObject({ total: 2, ran: 1, failed: 1 })
    expect(await signs.signedToday("1002")).toBe(true)
  })

  it("收到取消信号就停下剩下的账号", async () => {
    await signs.setEnabled("1001", true)
    await signs.setEnabled("1002", true)
    const controller = new AbortController()
    controller.abort()
    const { watch } = await run([record("1001"), record("1002")], { signal: controller.signal })

    expect(watch.ran).toEqual([])
  })
})
