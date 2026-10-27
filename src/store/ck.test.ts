/**
 * 模块职责：Cookie 池的测试
 * 依赖方向：测试文件，依赖 ck.ts / device.ts 与内核 testing 包
 * 生命周期：每项用例各自使用一份内存 KV
 * 注意事项：核心固定「归属硬闸」—— 查 uid X 只能用「owner 为发起者本人、且 uids[game] 含 X」的 CK，
 *          不回落、无公共池、owner 为空的记录任何查询都选不中；否则绑一串别人的 uid 即可读他的私有数据。
 *          另固定停用口径：`risk`（验证码）完全不改动记录、`cookie`（-100）立即停用；以及计数按本地
 *          日期分键、跨日自动清零。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import type { KvNamespace } from "@yunzai-ng/types"
import { beforeEach, describe, expect, it } from "vitest"
import { CookiePool } from "./ck.js"
import { DeviceStore } from "../core/device.js"

/** 一份可用的 Cookie */
const CK_A = "ltuid_v2=100; ltoken_v2=v2_a="

/** 另一份可用的 Cookie */
const CK_B = "ltuid_v2=200; ltoken_v2=v2_b="

describe("CookiePool", () => {
  let kv: Kv
  let ckKv: KvNamespace
  let devices: DeviceStore
  let pool: CookiePool
  let now: number

  beforeEach(() => {
    kv = new Kv(new MemoryKvDriver())
    ckKv = kv.sub("cookie")
    now = new Date(2026, 7, 22, 10, 0, 0).getTime()
    devices = new DeviceStore({ kv: kv.sub("device"), logger: fakeLogger(), now: () => now })
    pool = new CookiePool({ kv: ckKv, logger: fakeLogger(), devices, now: () => now })
  })

  it("绑定时规整 Cookie、取出 ltuid，并于绑定时即确定设备", async () => {
    const record = await pool.save(" ltuid_v2=100 ;\n ltoken_v2=v2_a= ; ", { owner: "qq:1" })

    expect(record?.ltuid).toBe("100")
    expect(record?.cookie).toBe(CK_A)
    expect(record?.owner).toBe("qq:1")
    // 设备须于绑定时即存在，否则首次请求将临时构造一台
    expect(await devices.bound("100")).toBeUndefined()
    expect((await devices.assign("100")).createdAt).toBe(now)
  })

  it("缺 owner 一律拒写 —— 无归属的记录无从判定归属闸", async () => {
    expect(await pool.save(CK_A, { owner: "" })).toBeUndefined()
    expect(await pool.list()).toHaveLength(0)
  })

  it("不含 ltuid 的 Cookie 直接拒绝，不留存任何记录", async () => {
    expect(await pool.save("mi18nLang=zh-cn", { owner: "qq:1" })).toBeUndefined()
    expect(await pool.list()).toHaveLength(0)
  })

  it("重复绑定视为更新：首次绑定时间保留、uid 合并、停用标记清除、归属改记为本次绑定者", async () => {
    await pool.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await pool.disable("100", "测试停用")
    now += 60_000

    const again = await pool.save("ltuid_v2=100; ltoken_v2=v2_new=", { owner: "qq:2", uids: { sr: ["100000002"] } })

    expect(again?.at).toBe(new Date(2026, 7, 22, 10, 0, 0).getTime())
    expect(again?.disabled).toBe(false)
    expect(again?.reason).toBeUndefined()
    expect(again?.uids).toEqual({ gs: ["100000001"], sr: ["100000002"] })
    // 谁持有 Cookie 谁即拥有该账号，故归属改记为本次的绑定者
    expect(again?.owner).toBe("qq:2")
  })

  it("删除 Cookie 时一并清除设备痕迹", async () => {
    await pool.save(CK_A, { owner: "qq:1" })
    await devices.bind("100", { id: "A1B2C3D4E5F60718", fp: "fp-真机" })

    expect(await pool.remove("100")).toBe(true)
    expect(await pool.remove("100")).toBe(false)
    expect(await devices.bound("100")).toBeUndefined()
    expect(await devices.fp("100")).toBeUndefined()
  })

  it("归属硬闸：查 uid X 只用「本人绑定、且覆盖 X」的 CK", async () => {
    // A(qq:1) 自己的账号覆盖 100000001，B(qq:2) 的账号覆盖 100000002
    await pool.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await pool.save(CK_B, { owner: "qq:2", uids: { gs: ["100000002"] } })

    // 本人查自己的 uid：命中自己那条
    expect((await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" }))?.ltuid).toBe("100")
    // A 绑了 B 的 uid 也查不到：A 名下没有覆盖 100000002 的 CK，不回落到自己的其他 CK
    expect(await pool.pick({ uid: "100000002", game: "gs", owner: "qq:1" })).toBeUndefined()
    // 反过来 B 也读不了 A 的 uid
    expect(await pool.pick({ uid: "100000001", game: "gs", owner: "qq:2" })).toBeUndefined()
  })

  it("按 uid 命中但归属他人的 CK 一概不取 —— 绑别人的 uid 也借不到他的 CK", async () => {
    await pool.save(CK_A, { owner: "qq:2", uids: { gs: ["100000001"] } })

    expect(await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" })).toBeUndefined()
    expect((await pool.pick({ uid: "100000001", game: "gs", owner: "qq:2" }))?.ltuid).toBe("100")
  })

  it("owner 为空的旧记录任何查询都选不中 —— 手工落库的无主记录不属于任何人", async () => {
    // 绕过 save 直接写一条无 owner 的记录（save 会拒写这种）
    await ckKv.set("ck:400", { ltuid: "400", cookie: CK_A, uids: { gs: ["100000001"] }, disabled: false, at: 0 })

    expect(await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" })).toBeUndefined()
    expect(await pool.list()).toHaveLength(0)
  })

  it("owner 为空串的记录同样选不中，发起者为空串时也一条都不给", async () => {
    await ckKv.set("ck:401", { ltuid: "401", cookie: CK_A, owner: "", uids: { gs: ["100000001"] }, disabled: false, at: 0 })

    expect(await pool.list()).toHaveLength(0)
    expect(await pool.pick({ uid: "100000001", game: "gs", owner: "" })).toBeUndefined()
    expect(await pool.owned("")).toEqual([])
  })

  it("只认覆盖该 uid 的那条 —— 名下另有 CK 但不覆盖此 uid 时不回落", async () => {
    await pool.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })

    // 同一发起者、同一游戏，但查的是他没有的 uid：不拿他另一条 CK 顶上
    expect(await pool.pick({ uid: "100000009", game: "gs", owner: "qq:1" })).toBeUndefined()
  })

  it("本人名下覆盖同一 uid 的多条 CK 之间换用 —— 首条被米游社判到顶则取次条", async () => {
    await pool.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await pool.save(CK_B, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await pool.report("100", "limit", "已达上限")

    expect((await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" }))?.ltuid).toBe("200")
  })

  it("本地不设上限：查多少次都仍可用", async () => {
    await pool.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    for (let i = 0; i < 100; i += 1) await pool.use("100")
    expect((await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" }))?.ltuid).toBe("100")
  })

  it("已停用、到顶、被排除的记录均不会被选中", async () => {
    await pool.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await pool.save(CK_B, { owner: "qq:1", uids: { gs: ["100000001"] } })

    await pool.disable("100", "失效")
    expect((await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" }))?.ltuid).toBe("200")

    await pool.report("200", "limit", "已达上限")
    expect(await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" })).toBeUndefined()

    await pool.enable("100")
    expect((await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" }))?.ltuid).toBe("100")
    expect(await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1", exclude: ["100"] })).toBeUndefined()
  })

  it("三种「挑不出来」分得开 —— 报错要说对是哪一种", async () => {
    // 没有覆盖该 uid 的自有 CK：该说「未绑定你本人的 ck」
    const none = await pool.explain({ uid: "1300000001", game: "zzz", owner: "qq:1" })
    expect(none.kind).toBe("none")
    expect(none.message).toContain("你本人的 ck")

    // 米游社判今日到顶：说是米游社那一侧、零点恢复
    await pool.save(CK_A, { owner: "qq:1", uids: { zzz: ["1300000001"] } })
    await pool.report("100", "limit", "已达上限")
    const blocked = await pool.explain({ owner: "qq:1", uid: "1300000001", game: "zzz" })
    expect(blocked.kind).toBe("blocked")
    expect(blocked.message).toContain("米游社")
    expect(await pool.pick({ owner: "qq:1", uid: "1300000001", game: "zzz" })).toBeUndefined()

    /*
     * 绑了但被停用：只说该发哪条命令。**停用原因不印给使用者** —— 那是内部判据，
     * 使用者据此做不了任何事，而「发 #刷新ck」是他此刻唯一能做的动作。原因仍留在库里供主人排查。
     */
    await pool.disable("100", "Cookie 已失效")
    const off = await pool.explain({ owner: "qq:1", uid: "1300000001", game: "zzz" })
    expect(off.kind).toBe("disabled")
    expect(off.message).toContain("#刷新ck")
  })

  it("别人绑的 CK 不算「我绑过」 —— explain 与 pick 同一道闸", async () => {
    await pool.save(CK_B, { owner: "qq:2", uids: { gs: ["100000001"] } })

    expect((await pool.explain({ uid: "100000001", game: "gs", owner: "qq:1" })).kind).toBe("none")
  })

  it("计数按本地日期分键，跨日即自动清零", async () => {
    await pool.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })

    expect(await pool.use("100")).toBe(1)
    expect(await pool.use("100")).toBe(2)
    expect(await pool.count("100")).toBe(2)

    now = new Date(2026, 7, 23, 0, 30, 0).getTime()
    expect(await pool.count("100")).toBe(0)
    expect((await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" }))?.ltuid).toBe("100")
  })

  it("仅 -100 触发停用；1034 完全不改动记录", async () => {
    await pool.save(CK_A, { owner: "qq:1" })
    await pool.save(CK_B, { owner: "qq:2" })

    await pool.report("200", "risk", "验证码")
    expect((await pool.get("200"))?.disabled).toBe(false)
    expect(await pool.count("200")).toBe(0)

    await pool.report("100", "cookie", "请先登录")
    const record = await pool.get("100")
    expect(record?.disabled).toBe(true)
    expect(record?.reason).toBe("请先登录")
  })

  it("服务端判定已达上限时另记一个当日标记，不再以其发起请求", async () => {
    await pool.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await pool.use("100")

    await pool.report("100", "limit", "已达上限")

    // 计数不动：靠独立标记表达「今天别再用」
    expect(await pool.count("100")).toBe(1)
    expect(await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" })).toBeUndefined()
    // 与 disabled 分开报，否则 `#CK状态` 会说它可用而它一次都挑不出来
    expect(await pool.usage("100")).toEqual({ ltuid: "100", used: 1, disabled: false, blocked: true })
  })

  it("到顶标记只管当天，且 resetCount 一并清掉", async () => {
    await pool.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"] } })
    await pool.report("100", "limit", "已达上限")
    expect(await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" })).toBeUndefined()

    await pool.resetCount("100")

    expect(await pool.pick({ uid: "100000001", game: "gs", owner: "qq:1" })).toBeDefined()
    expect((await pool.usage("100")).blocked).toBeUndefined()
  })

  it("uid 表随绑定写入；find 与 owned 只认发起者本人", async () => {
    await pool.save(CK_A, { owner: "qq:1", uids: { gs: ["100000001"], zzz: ["1000000002"] } })
    await pool.save(CK_B, { owner: "qq:2", uids: { zzz: ["1000000001"] } })

    const record = await pool.get("100")
    expect(record?.uids).toEqual({ gs: ["100000001"], zzz: ["1000000002"] })
    // find 走归属闸：本人查自己的命中，查别人绑的那条返回 undefined
    expect((await pool.find("1000000002", "zzz", "qq:1"))?.ltuid).toBe("100")
    expect(await pool.find("1000000001", "zzz", "qq:1")).toBeUndefined()
    expect((await pool.owned("qq:1")).map(it => it.ltuid)).toEqual(["100"])
  })

  it("stoken 存成整段请求头片段，供小组件与社区签到使用", async () => {
    // 存的不是裸 token 而是 `stuid=..;stoken=..;mid=..;` —— mid 在 v2 体系里是必需的，
    // 只存 token 会让那几条接口回「请先登录」
    const record = await pool.save("ltuid_v2=100; ltoken_v2=v2_a=; stoken_v2=st_x; mid=m1_y", { owner: "qq:1" })

    expect(record?.stoken).toBe("stuid=100;stoken=st_x;mid=m1_y;")
    // 后续粘贴的 Cookie 未携带 stoken 时，不应清除已有取值
    expect((await pool.save(CK_A, { owner: "qq:1" }))?.stoken).toBe("stuid=100;stoken=st_x;mid=m1_y;")
  })

  it("扫码登录后可单独写入 stoken，不动已有的 Cookie", async () => {
    await pool.save(CK_A, { owner: "qq:1" })
    const before = await pool.get("100")

    expect(await pool.setStoken("100", "stuid=100;stoken=v2_new;mid=m1_z;")).toBe(true)
    const after = await pool.get("100")
    expect(after?.stoken).toBe("stuid=100;stoken=v2_new;mid=m1_z;")
    expect(after?.cookie).toBe(before?.cookie)
  })
})

