/**
 * 模块职责：体力提醒存储的测试
 * 依赖方向：测试文件，只依赖 store/note 与内存 KV
 * 生命周期：每个用例一套新 KV
 * 注意事项：本文件固定三处**改了不报错、只是行为悄悄变了**的口径：
 *          **私聊里再开一次要把旧群号去掉**（否则"在群里开过、后来私聊又开"会继续往那个群
 *          播他的体力）、**关闭只翻开关而不删阈值**（调过的数下次再开时该还在）、
 *          以及**`list()` 不会把群级开关那些键当成使用者设置**（两者共用一个命名空间）。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { beforeEach, describe, expect, it } from "vitest"
import { clampThreshold, NoteRemindStore, REMIND_CAPS } from "./note.js"

/** 固定的"现在" */
const NOW = new Date(2026, 8, 3, 10, 0, 0).getTime()

let store: NoteRemindStore

beforeEach(() => {
  store = new NoteRemindStore({ kv: new Kv(new MemoryKvDriver()).sub("remind"), now: (): number => NOW })
})

describe("clampThreshold", () => {
  it("压进上下限，脏值取该游戏的缺省值", () => {
    expect(clampThreshold("gs", 150)).toBe(150)
    expect(clampThreshold("gs", 9999)).toBe(REMIND_CAPS.gs.max)
    expect(clampThreshold("gs", 1)).toBe(20)
    expect(clampThreshold("gs", 0)).toBe(REMIND_CAPS.gs.def)
    expect(clampThreshold("sr", Number.NaN)).toBe(REMIND_CAPS.sr.def)
    expect(clampThreshold("zzz", 200.4)).toBe(200)
  })

  it("三个游戏的缺省值与上限各不相同 —— 上限不同是因为体力上限本就不同", () => {
    expect(REMIND_CAPS.gs.max).toBe(200)
    expect(REMIND_CAPS.sr.max).toBeGreaterThan(REMIND_CAPS.gs.max)
    expect(REMIND_CAPS.zzz.def).toBe(180)
  })
})

describe("NoteRemindStore", () => {
  it("没存过时是关着的，阈值取该游戏的缺省值", async () => {
    expect(await store.get("qq:1", "gs")).toMatchObject({ enabled: false, threshold: 120, nextAt: 0, lastAt: 0 })
    expect(await store.get("qq:1", "sr")).toMatchObject({ threshold: REMIND_CAPS.sr.def })
  })

  it("开启时记下阈值、群号与首次检查时刻", async () => {
    const state = await store.enable("qq:1", "gs", { threshold: 160, groupId: "9001", nextAt: NOW + 1000 })

    expect(state).toMatchObject({ enabled: true, threshold: 160, groupId: "9001", nextAt: NOW + 1000 })
    expect(await store.get("qq:1", "gs")).toMatchObject({ threshold: 160, groupId: "9001" })
  })

  it("私聊里再开一次要把旧群号去掉 —— 否则会继续往那个群播他的体力", async () => {
    await store.enable("qq:1", "gs", { groupId: "9001" })
    const state = await store.enable("qq:1", "gs")

    expect(state.groupId).toBeUndefined()
    expect(await store.get("qq:1", "gs")).not.toHaveProperty("groupId")
  })

  it("换了 Bot 号重开一次就换成新的 —— 挂两个号时按平台随便挑会挑到没进那个群的那一个", async () => {
    await store.enable("qq:1", "gs", { botId: "bot-1" })
    expect((await store.get("qq:1", "gs")).botId).toBe("bot-1")

    expect((await store.enable("qq:1", "gs", { botId: "bot-2" })).botId).toBe("bot-2")
    // 认不出时留空，由推送层退回"同平台第一个"
    expect(await store.enable("qq:1", "gs")).not.toHaveProperty("botId")
  })

  it("remember 只记 uid —— 定时任务据它下一轮直接走小组件", async () => {
    await store.enable("qq:1", "gs", { threshold: 60, nextAt: NOW + 1000 })
    await store.remember("qq:1", "gs", "100000001")

    expect(await store.get("qq:1", "gs")).toMatchObject({
      uid: "100000001",
      threshold: 60,
      nextAt: NOW + 1000,
      enabled: true
    })
  })

  it("开启时把上次提醒时刻清零 —— 刚亲手开的不该还压着上一次的推送间隔", async () => {
    await store.enable("qq:1", "gs")
    await store.markSent("qq:1", "gs", NOW, NOW + 1000)
    expect((await store.get("qq:1", "gs")).lastAt).toBe(NOW)

    expect((await store.enable("qq:1", "gs")).lastAt).toBe(0)
  })

  it("不给阈值时沿用已存的那个", async () => {
    await store.enable("qq:1", "gs", { threshold: 60 })
    await store.disable("qq:1", "gs")
    expect((await store.enable("qq:1", "gs")).threshold).toBe(60)
  })

  it("关闭只翻开关，阈值还在", async () => {
    await store.enable("qq:1", "gs", { threshold: 60 })
    const state = await store.disable("qq:1", "gs")

    expect(state).toMatchObject({ enabled: false, threshold: 60 })
  })

  it("schedule 只动下次检查时刻", async () => {
    await store.enable("qq:1", "gs", { threshold: 60 })
    await store.schedule("qq:1", "gs", NOW + 7200_000)

    expect(await store.get("qq:1", "gs")).toMatchObject({ enabled: true, threshold: 60, nextAt: NOW + 7200_000 })
  })

  it("markSent 同时记下提醒时刻与下次检查时刻", async () => {
    await store.enable("qq:1", "gs")
    await store.markSent("qq:1", "gs", NOW, NOW + 43_200_000)

    expect(await store.get("qq:1", "gs")).toMatchObject({ lastAt: NOW, nextAt: NOW + 43_200_000 })
  })

  it("list 列出全部设置，逐游戏各算一条", async () => {
    await store.enable("qq:1", "gs")
    await store.enable("qq:1", "sr", { threshold: 200 })
    await store.enable("qq:2", "gs", { groupId: "9001" })

    const list = await store.list()
    expect(list).toHaveLength(3)
    expect(list.map(one => `${one.user}:${one.game}`).sort()).toEqual(["qq:1:gs", "qq:1:sr", "qq:2:gs"])
  })

  it("list 不会把群级开关那些键当成使用者设置 —— 两者共用一个命名空间", async () => {
    await store.enable("qq:1", "gs")
    await store.setGroupEnabled("9001", false)

    expect(await store.list()).toHaveLength(1)
  })

  it("群级开关缺省是开着的 —— 它的用处是被大量占据屏幕时能关掉，而不是多一道要先开的闸", async () => {
    expect(await store.groupEnabled("9001")).toBe(true)

    await store.setGroupEnabled("9001", false)
    expect(await store.groupEnabled("9001")).toBe(false)

    await store.setGroupEnabled("9001", true)
    expect(await store.groupEnabled("9001")).toBe(true)
  })
})
