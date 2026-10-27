/**
 * 模块职责：Cookie 概况视图（`#用户统计`）的测试
 * 依赖方向：测试文件，只依赖 views/admin（纯函数）
 * 生命周期：无状态
 * 注意事项：钉住「可用」排除停用与米游社判到顶两种、查了多少次都不影响可用；
 *          账号标识一律遮蔽，这张图主人可能转发到群里。
 */
import { describe, expect, it } from "vitest"
import type { CookieRecord, CookieUsage } from "../store/ck.js"
import type { AdminInput } from "./admin.js"
import { adminText, buildAdmin } from "./admin.js"

/**
 * 造一条输入
 * @param ltuid 账号标识
 * @param used 今日已用次数
 * @param extra 覆盖项
 * @returns 一条输入
 */
function item(ltuid: string, used: number, extra: Partial<AdminInput> = {}): AdminInput {
  const record = { ltuid, cookie: `ltuid=${ltuid}`, uids: {}, owner: "qq:1", disabled: false, at: 0 } as CookieRecord
  const usage: CookieUsage = { ltuid, used, disabled: false }
  return { record, usage, ...extra }
}

/**
 * 造一条已停用的输入
 * @param ltuid 账号标识
 * @param reason 停用原因
 * @returns 一条输入
 */
function dead(ltuid: string, reason = "Cookie 已失效"): AdminInput {
  const one = item(ltuid, 0)
  return {
    record: { ...one.record, disabled: true, reason },
    usage: { ...one.usage, disabled: true, reason }
  }
}

describe("buildAdmin", () => {
  it("国服与国际服分开统计", () => {
    const view = buildAdmin([item("1", 0), item("2", 0, { os: true })])
    expect(view.servs["mys"]?.count.total).toBe(1)
    expect(view.servs["hoyolab"]?.count.total).toBe(1)
    expect(view.count.total).toBe(2)
  })

  it("查了多少次都仍算可用 —— 本地不设上限", () => {
    const view = buildAdmin([item("1", 999)])
    expect(view.servs["mys"]?.count.normal).toBe(1)
  })

  it("米游社判今日到顶的不算可用，也不算失效", () => {
    const one = item("1", 5)
    const view = buildAdmin([{ ...one, usage: { ...one.usage, blocked: true } }, item("2", 5)])
    const count = view.servs["mys"]?.count
    expect(count?.normal).toBe(1)
    expect(count?.disable).toBe(0)
  })

  it("停用的计入 disable", () => {
    const view = buildAdmin([dead("1"), item("2", 0)])
    const count = view.servs["mys"]?.count
    expect(count?.disable).toBe(1)
    expect(count?.normal).toBe(1)
  })

  it("今日已查是逐条之和，条长相对本组最多的那条", () => {
    const view = buildAdmin([item("1", 10), item("2", 5)])
    expect(view.servs["mys"]?.count.query).toBe(15)
    expect(view.servs["mys"]?.list.map(it => it.pct)).toEqual([100, 50])
  })

  it("明细按今日已用降序", () => {
    const view = buildAdmin([item("1", 3), item("2", 20), item("3", 11)])
    expect(view.servs["mys"]?.list.map(it => it.num)).toEqual([20, 11, 3])
  })

  it("账号标识一律遮蔽 —— 这份图主人可能转发到群里", () => {
    const view = buildAdmin([item("123456789", 0)])
    const shown = view.servs["mys"]?.list[0]?.ltuid ?? ""
    expect(shown).not.toBe("123456789")
    expect(shown).toContain("****")
  })

  it("空池不炸，各项归零", () => {
    const view = buildAdmin([])
    expect(view.count).toEqual({ total: 0, normal: 0, disable: 0, query: 0 })
  })
})

describe("adminText", () => {
  it("空池时给出让使用者绑定 CK 的引导", () => {
    expect(adminText(buildAdmin([]))).toContain("#绑定CK")
  })

  it("列出停用账号及原因", () => {
    const text = adminText(buildAdmin([dead("123456789", "登录过期")]))
    expect(text).toContain("已停用")
    expect(text).toContain("登录过期")
  })

  it("有可用 CK 时不出现停用段", () => {
    expect(adminText(buildAdmin([item("1", 0)]))).not.toContain("已停用")
  })

  it("只报今日已查，不印剩余次数", () => {
    const text = adminText(buildAdmin([item("1", 5)]))
    expect(text).toContain("今日已查 5 次")
    expect(text).not.toMatch(/剩余|还能查/)
  })
})
