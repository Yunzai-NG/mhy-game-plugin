/**
 * 模块职责：签到开关与流水的测试
 * 依赖方向：测试文件，依赖 store/sign 与内存 KV
 * 生命周期：每个用例一套新 KV
 * 注意事项：本文件固定三项口径：**缺省关着**（自动签到会代替使用者写入，不能"绑了 CK 就默认帮
 *          你签"）、**只有确实签成了才写日期**（失败也写会让今天剩下的时间里不再重试），
 *          以及**日期按本地时区算**（用 UTC 会让东八区的凌晨被算成前一天，表现是八点前又签一次）。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { beforeEach, describe, expect, it } from "vitest"
import { signDay, SignStore } from "./sign.js"

/** 固定的"现在"：2026-09-02 08:35 本地时间 */
const NOW = new Date(2026, 8, 2, 8, 35, 0).getTime()

let store: SignStore
let clock = NOW

beforeEach(() => {
  clock = NOW
  store = new SignStore({ kv: new Kv(new MemoryKvDriver()).sub("sign"), now: (): number => clock })
})

describe("signDay", () => {
  it("按本地时区给出 YYYY-MM-DD", () => {
    expect(signDay(new Date(2026, 0, 5, 1, 0, 0).getTime())).toBe("2026-01-05")
    expect(signDay(new Date(2026, 11, 31, 23, 59, 0).getTime())).toBe("2026-12-31")
  })

  it("凌晨仍算当天 —— 用 UTC 的话东八区这一刻会被算成前一天", () => {
    expect(signDay(new Date(2026, 8, 2, 0, 30, 0).getTime())).toBe("2026-09-02")
  })
})

describe("SignStore", () => {
  it("没有记录时给一份关着的状态，而不是 undefined", async () => {
    const state = await store.get("1001")
    expect(state).toEqual({ ltuid: "1001", enabled: false, day: "", text: "", at: 0 })
  })

  it("开关按米游社账号存 —— 一个人可能只想让其中一个自动签", async () => {
    await store.setEnabled("1001", true)
    expect((await store.get("1001")).enabled).toBe(true)
    expect((await store.get("1002")).enabled).toBe(false)

    await store.setEnabled("1001", false)
    expect((await store.get("1001")).enabled).toBe(false)
  })

  it("签成了才写日期，据此判定今天已签", async () => {
    expect(await store.signedToday("1001")).toBe(false)
    await store.mark("1001", true, "原神 旅行者：签到成功")
    expect(await store.signedToday("1001")).toBe(true)
    expect((await store.get("1001")).day).toBe("2026-09-02")
  })

  it("失败不写日期 —— 否则今天剩下的时间里不会再重试", async () => {
    await store.mark("1001", false, "签到请求没有回应")
    expect(await store.signedToday("1001")).toBe(false)
    // 但结果那句话仍要留着，`#签到状态` 要展示它
    expect((await store.get("1001")).text).toContain("没有回应")
  })

  it("到了第二天就不算签过了", async () => {
    await store.mark("1001", true, "签到成功")
    clock = new Date(2026, 8, 3, 8, 35, 0).getTime()
    expect(await store.signedToday("1001")).toBe(false)
  })

  it("开关不会被 mark 冲掉 —— 两者是同一条记录里的两件事", async () => {
    await store.setEnabled("1001", true)
    await store.mark("1001", true, "签到成功")
    expect((await store.get("1001")).enabled).toBe(true)
  })

  it("删掉之后回到缺省的关闭状态", async () => {
    await store.setEnabled("1001", true)
    await store.remove("1001")
    expect((await store.get("1001")).enabled).toBe(false)
  })
})
