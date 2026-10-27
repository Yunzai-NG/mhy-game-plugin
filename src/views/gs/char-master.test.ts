/**
 * 模块职责：绘想游迹视图模型的测试
 * 依赖方向：测试文件，只依赖 views/gs/char-master.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：钉住**状态是三档而不是布尔**：官方判 `status === 1` 锁着、`status === 3` 已完成，
 *          其间那一档是"开了但没做完"；按布尔处理会把"进行中"画成"已完成"。另钉页头那一行按
 *          `status === 3` 的个数数出来，不取接口的某个计数。
 */
import { describe, expect, it } from "vitest"
import type { CharMasterRaw } from "./char-master.js"
import { charMasterState, charMasterTemplateData, charMasterText } from "./char-master.js"

/** 一份三档都有的返回 */
const RAW: CharMasterRaw = {
  is_unlock: true,
  list: [
    { avatar_id: 10000046, name: "胡桃", icon: "https://a.png", status: 3 },
    { avatar_id: 10000030, name: "钟离", icon: "https://b.png", status: 2 },
    { avatar_id: 10000002, name: "神里绫华", icon: "https://c.png", status: 1, has_red_dot: true }
  ]
}

describe("charMasterState", () => {
  it("没解锁与没有数据分得开", () => {
    expect(charMasterState(RAW)).toBe("ok")
    expect(charMasterState({ is_unlock: false })).toBe("locked")
    expect(charMasterState({ is_unlock: true, list: [] })).toBe("noData")
    expect(charMasterState(undefined)).toBe("noData")
  })
})

describe("charMasterTemplateData", () => {
  it("三档状态各自成两个布尔 —— 按布尔处理会把「进行中」画成「已完成」", () => {
    const view = charMasterTemplateData(RAW, { uid: "100000001" })
    const items = view["items"] as { name: string; locked: boolean; done: boolean }[]

    expect(items[0]).toMatchObject({ name: "胡桃", done: true, locked: false })
    // 中间那一档两个布尔都是假：开了但没做完
    expect(items[1]).toMatchObject({ name: "钟离", done: false, locked: false })
    expect(items[2]).toMatchObject({ name: "神里绫华", done: false, locked: true })
  })

  it("页头那一行按已完成的个数数出来", () => {
    const view = charMasterTemplateData(RAW, { uid: "100000001" })

    expect(view["done"]).toBe(1)
    expect(view["total"]).toBe(3)
  })

  it("玩家信息补成全壳 —— 模板直接印它，给空对象会印出字面的 undefined", () => {
    const view = charMasterTemplateData(RAW, { uid: "1" })

    expect(view["role"]).toEqual({ nickname: "", level: 0, game_head_icon: "" })
  })

  it("空返回也出得来视图", () => {
    const view = charMasterTemplateData(undefined, { uid: "1" })

    expect(view["items"]).toEqual([])
    expect(view["done"]).toBe(0)
    expect(view["total"]).toBe(0)
  })
})

describe("charMasterText", () => {
  it("已完成与进行中分两行，锁着的不列", () => {
    const text = charMasterText(RAW, { uid: "100000001" })

    expect(text).toContain("UID100000001 绘想游迹")
    expect(text).toContain("已完成 1/3")
    expect(text).toContain("胡桃")
    expect(text).toContain("进行中：钟离")
    expect(text).not.toContain("神里绫华")
  })

  it("一条都没有时也是一段可读文本", () => {
    expect(charMasterText({ is_unlock: true, list: [] }, { uid: "1" })).toContain("已完成 0/0")
  })
})
