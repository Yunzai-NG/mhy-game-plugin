/**
 * 模块职责：用户档案的测试
 * 依赖方向：测试文件，依赖 user.ts 与内核 store
 * 生命周期：每个用例一份内存 KV
 * 注意事项：当前 uid 以"数组首项"表示，故每一项改动 uid 列表的操作均须同时确认
 *          队首取值 —— 该点为"查询结果并非所需账号"一类问题的唯一来源。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { beforeEach, describe, expect, it } from "vitest"
import { UserStore } from "./user.js"

describe("UserStore", () => {
  let users: UserStore

  beforeEach(() => {
    users = new UserStore({ kv: new Kv(new MemoryKvDriver()) })
  })

  it("未绑定的用户同样返回一份空档案，调用方无需判空", async () => {
    expect(await users.get("qq:1")).toEqual({ id: "qq:1", uids: {}, at: 0 })
    expect(await users.uid("qq:1", "gs")).toBeUndefined()
    expect(await users.uids("qq:1", "gs")).toEqual([])
  })

  it("新绑定的 uid 直接成为当前 uid，重复绑定等价于切换", async () => {
    await users.addUid("qq:1", "gs", "100000001")
    await users.addUid("qq:1", "gs", 500000002)

    expect(await users.uids("qq:1", "gs")).toEqual(["500000002", "100000001"])
    await users.addUid("qq:1", "gs", "100000001")
    expect(await users.uid("qq:1", "gs")).toBe("100000001")
  })

  it("三个游戏的 uid 各自独立", async () => {
    await users.addUid("qq:1", "gs", "100000001")
    await users.addUid("qq:1", "sr", "100000002")

    expect(await users.uid("qq:1", "sr")).toBe("100000002")
    expect(await users.uid("qq:1", "zzz")).toBeUndefined()
  })

  it("非法 uid 一律拒绝，且不占用位置", async () => {
    expect(await users.addUid("qq:1", "gs", "123")).toBeUndefined()
    expect(await users.addUid("qq:1", "gs", "10000000a")).toBeUndefined()
    expect(await users.uids("qq:1", "gs")).toEqual([])
  })

  it("切换 uid 同时接受序号与完整 uid", async () => {
    await users.addUid("qq:1", "gs", "100000001")
    await users.addUid("qq:1", "gs", "600000002")
    // 此时顺序是 [600000002, 100000001]

    expect(await users.switchUid("qq:1", "gs", 2)).toBe("100000001")
    expect(await users.uids("qq:1", "gs")).toEqual(["100000001", "600000002"])
    expect(await users.switchUid("qq:1", "gs", "600000002")).toBe("600000002")
    expect(await users.switchUid("qq:1", "gs", 9)).toBeUndefined()
    expect(await users.switchUid("qq:2", "gs", 1)).toBeUndefined()
  })

  it("删除 uid 后队首自动顺延", async () => {
    await users.addUid("qq:1", "gs", "100000001")
    await users.addUid("qq:1", "gs", "600000002")

    expect(await users.removeUid("qq:1", "gs", "600000002")).toEqual(["100000001"])
    expect(await users.uid("qq:1", "gs")).toBe("100000001")
    expect(await users.removeUid("qq:1", "gs", "600000002")).toBeUndefined()
  })

  it("全部绑定删除后不保留空档案，遍历时亦不出现该条目", async () => {
    await users.addUid("qq:1", "gs", "100000001")
    await users.addUid("qq:2", "gs", "100000002")
    expect(await users.list()).toHaveLength(2)

    await users.removeUid("qq:1", "gs", "100000001")
    expect((await users.list()).map(it => it.id)).toEqual(["qq:2"])

    await users.remove("qq:2")
    expect(await users.list()).toHaveLength(0)
  })
})
