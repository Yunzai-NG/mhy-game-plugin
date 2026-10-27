/**
 * 模块职责：小组件取数服务的测试
 * 依赖方向：测试文件，依赖 service/widget，HTTP、Cookie 池与设备都是假的
 * 生命周期：无状态
 * 注意事项：最要紧的一条是 **多 uid 的账号一律不走小组件**：它返回的是米游社里当前选中那个角色
 *          的数据而**响应不带 uid**，无从校验拿回来的是不是想查的那个；放松这一条不报错，只是把
 *          A 账号的体力当成 B 账号报出去。另两条：国际服没有这套接口，Cookie 头里只有那三项。
 */
import { describe, expect, it } from "vitest"
import type { HttpClient } from "@yunzai-ng/types"
import type { DeviceStore } from "../core/device.js"
import type { CookiePool, CookieRecord } from "../store/ck.js"
import { WidgetService } from "./widget.js"

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

/** 假设备存储：恒给同一台设备 */
const DEVICES = {
  use: async (): Promise<{ id: string; name: string; spec: { model: string } }> => ({
    id: "testdevice",
    name: "yz",
    spec: { model: "Mi 10" }
  })
} as unknown as DeviceStore

/** 一条带 stoken、单 uid 的国服原神 CK */
const RECORD: CookieRecord = {
  ltuid: "1001",
  cookie: "ltuid_v2=1001; ltoken_v2=abc; stoken=v2_tok; mid=m1_x",
  uids: { gs: ["100000001"] },
  owner: "qq:1",
  disabled: false,
  at: 0
}

/** 记下来的一次请求 */
interface Call {
  /** 完整 URL */
  url: string
  /** 请求头 */
  headers: Record<string, string>
}

/**
 * 造一个小组件服务
 * @param over 要改的 CK 记录字段；传 null 表示池子里挑不出来
 * @param answer 接口给什么
 * @returns 服务与调用记录
 */
function make(
  over: Partial<CookieRecord> | null = {},
  answer: unknown = { retcode: 0, data: { current_resin: 140, max_resin: 200, resin_recovery_time: 28_800 } }
): { service: WidgetService; calls: Call[] } {
  const calls: Call[] = []
  const http = {
    request: async <T,>(url: string, opts: { headers: Record<string, string> }): Promise<T> => {
      calls.push({ url, headers: opts.headers })
      return { ok: true, status: 200, data: answer } as T
    }
  } as unknown as HttpClient
  const cookies = {
    pick: async (): Promise<CookieRecord | undefined> => (over === null ? undefined : { ...RECORD, ...over })
  } as unknown as CookiePool
  return { service: new WidgetService({ http, cookies, devices: DEVICES, logger: LOGGER as never }), calls }
}

/** 一次取数的参数 */
const Q = { game: "gs", uid: "100000001", owner: "qq:1" } as const

describe("WidgetService.note", () => {
  it("单 uid、带 stoken 的国服账号取得到，字段与实时便笺同形", async () => {
    const { service, calls } = make()
    const got = await service.note(Q)

    expect(got.ok).toBe(true)
    expect(got.ok && got.data).toMatchObject({ current_resin: 140, max_resin: 200 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain("aapi/widget/v2")
  })

  it("Cookie 头里只有 stuid / stoken / mid 三项 —— 多带别的键会被判成另一种登录态", async () => {
    const { service, calls } = make()
    await service.note(Q)

    expect(calls[0]?.headers["Cookie"]).toBe("stuid=1001;stoken=v2_tok;mid=m1_x;")
    expect(calls[0]?.headers["Cookie"]).not.toContain("ltoken")
  })

  it("同一游戏下有多个 uid 时一个包都不发 —— 小组件不带 uid，无从判定拿回来的是哪个", async () => {
    const { service, calls } = make({ uids: { gs: ["100000001", "100000002"] } })
    const got = await service.note(Q)

    expect(got).toMatchObject({ ok: false, skip: "ambiguous" })
    expect(calls).toEqual([])
  })

  it("没绑 stoken 时不发包，由调用方退回实时便笺", async () => {
    const { service, calls } = make({ cookie: "ltuid_v2=1001; ltoken_v2=abc" })
    const got = await service.note(Q)

    expect(got).toMatchObject({ ok: false, skip: "nostoken" })
    expect(calls).toEqual([])
  })

  it("stoken 单独存过一栏时也认得出", async () => {
    const { service, calls } = make({
      cookie: "ltuid_v2=1001; ltoken_v2=abc",
      stoken: "stuid=1001;stoken=v2_only;mid=m1_x;"
    })
    const got = await service.note(Q)

    expect(got.ok).toBe(true)
    expect(calls[0]?.headers["Cookie"]).toContain("stoken=v2_only")
  })

  it("国际服没有这套接口 —— 连 CK 都不挑", async () => {
    const { service, calls } = make()
    const got = await service.note({ game: "gs", uid: "800000001", owner: "qq:1" })

    expect(got).toMatchObject({ ok: false, skip: "oversea" })
    expect(calls).toEqual([])
  })

  it("池子里挑不出这个 uid 自己的 CK 时明说 —— 小组件绝不借公共池", async () => {
    const { service } = make(null)
    expect(await service.note(Q)).toMatchObject({ ok: false, skip: "nock" })
  })

  it("接口报错时归 fail，且说明里不带凭据的任何部分", async () => {
    const { service } = make({}, { retcode: 10001, message: "请先登录" })
    const got = await service.note(Q)

    expect(got).toMatchObject({ ok: false, skip: "fail" })
    expect(got.ok === false && got.message).not.toContain("v2_tok")
  })
})
