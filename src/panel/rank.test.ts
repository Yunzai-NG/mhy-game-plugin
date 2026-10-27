/**
 * 模块职责：群面板排行的测试
 * 依赖方向：测试文件，依赖 rank.ts 与内核 store
 * 生命周期：每个用例一份内存 KV
 * 注意事项：本文件固定三件事：**资格判定的五个档位**（挡刷榜小号，判错就是让人白排或错排）、
 *          **开拓者成对 id 的归并**（不归并则男女主角各排一榜）、以及**并列时名次稳定**
 *          （同分者的名次若每次读都互换，使用者会看到自己的名次无故变动）。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { beforeEach, describe, expect, it } from "vitest"
import { ProfileRank, isPresetUid, mergeCharId } from "./rank.js"

/** 一个正常的群号 */
const GROUP = "10001"

/** 一个正常的 uid，刻意取在 `100000006` 之上（小于它的按"内置预设面板"处置，一律不参与排名） */
const UID = "100000101"

/** 面板持有者：榜单条目按「用户 + uid」记 */
const USER = "qq:1"

describe("mergeCharId", () => {
  it("开拓者的成对 id 归并到同一个键 —— 否则男女主角各排一榜", () => {
    expect(mergeCharId("8002")).toBe("8001")
    expect(mergeCharId("8004")).toBe("8003")
    expect(mergeCharId("8009")).toBe("8010")
  })

  it("其余角色原样返回", () => {
    expect(mergeCharId("10000046")).toBe("10000046")
    expect(mergeCharId(1001)).toBe("1001")
  })
})

describe("isPresetUid", () => {
  it("内置预设面板的 uid 认得出 —— 不排掉的话群里第一名恒是那份满命数据", () => {
    expect(isPresetUid("100000000")).toBe(true)
    expect(isPresetUid("100000005")).toBe(true)
    expect(isPresetUid("100000006")).toBe(false)
    expect(isPresetUid(UID)).toBe(false)
  })

  it("绝区零的 8 位 uid 不是预设 —— 按原神那个下界判会把绝区零整个挡在榜外", () => {
    expect(isPresetUid("18707318", "zzz")).toBe(false)
    expect(isPresetUid("10000001", "zzz")).toBe(false)
    // 国际服是 10 位，同样放行
    expect(isPresetUid("1300000001", "zzz")).toBe(false)
  })

  it("原神星铁仍按下界判", () => {
    expect(isPresetUid("100000000", "gs")).toBe(true)
    expect(isPresetUid("100000000", "sr")).toBe(true)
    expect(isPresetUid("100000101", "gs")).toBe(false)
  })
})

describe("ProfileRank 资格判定", () => {
  /**
   * 造一个排行器
   * @param limit 排名限制档位
   * @returns 排行器
   */
  function make(limit: number): ProfileRank {
    return new ProfileRank({ kv: new Kv(new MemoryKvDriver()), limit: () => limit })
  }

  it("第一档无限制，只要不是预设 uid 就放行", async () => {
    const rank = make(1)

    expect(await rank.allowRank("gs", UID)).toBe(true)
    expect(await rank.allowRank("gs", "100000000")).toBe(false)
  })

  it("第二档只放行绑了 CK 的", async () => {
    const rank = make(2)
    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: ["胡桃"], uidType: "bind" })
    expect(await rank.allowRank("gs", UID)).toBe(false)

    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: ["胡桃"], uidType: "ck" })
    expect(await rank.allowRank("gs", UID)).toBe(true)
  })

  it("第三档要 16 个角色，或绑了 CK", async () => {
    const rank = make(3)
    const few = Array.from({ length: 10 }, (_, i) => `角色${i}`)
    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: few, uidType: "bind" })
    expect(await rank.allowRank("gs", UID)).toBe(false)

    const many = Array.from({ length: 16 }, (_, i) => `角色${i}`)
    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: many, uidType: "bind" })
    expect(await rank.allowRank("gs", UID)).toBe(true)
  })

  it("第四档要那三个开局角色", async () => {
    const rank = make(4)
    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: ["胡桃", "钟离"], uidType: "bind" })
    expect(await rank.allowRank("gs", UID)).toBe(false)

    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: ["安柏", "凯亚", "丽莎"], uidType: "bind" })
    expect(await rank.allowRank("gs", UID)).toBe(true)
  })

  it("星铁的基础角色数从 1 起算 —— 开拓者本身算一个", async () => {
    const rank = make(4)
    // 星铁只需再有两个：丹恒与三月七
    await rank.setUidInfo({ game: "sr", user: USER, uid: UID, names: ["丹恒", "三月七"], uidType: "bind" })

    expect(await rank.allowRank("sr", UID)).toBe(true)
  })

  it("绝区零的 8 位 uid 第一档就放行 —— 这是「出图正常而榜永远空着」的成因", async () => {
    const rank = make(1)

    expect(await rank.allowRank("zzz", "18707318")).toBe(true)
  })

  it("绝区零第四档认它自己那三个开局代理人，而不是星铁的", async () => {
    const rank = make(4)
    const uid = "18707318"
    await rank.setUidInfo({ game: "zzz", user: USER, uid, names: ["丹恒", "三月七"], uidType: "bind" })
    expect(await rank.allowRank("zzz", uid)).toBe(false)

    await rank.setUidInfo({ game: "zzz", user: USER, uid, names: ["安比", "妮可", "比利"], uidType: "bind" })
    expect(await rank.allowRank("zzz", uid)).toBe(true)
  })

  it("第五档两个条件都要", async () => {
    const rank = make(5)
    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: ["安柏", "凯亚", "丽莎"], uidType: "bind" })
    expect(await rank.allowRank("gs", UID)).toBe(false)

    const many = ["安柏", "凯亚", "丽莎", ...Array.from({ length: 13 }, (_, i) => `角色${i}`)]
    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: many, uidType: "bind" })
    expect(await rank.allowRank("gs", UID)).toBe(true)
  })

  it("uidType 只升不降 —— 别人查一次不该把绑了 CK 的 uid 降级", async () => {
    const rank = make(2)
    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: ["胡桃"], uidType: "ck" })
    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: ["胡桃"], uidType: "bind" })

    expect((await rank.uidInfo("gs", UID))?.uidType).toBe("ck")
    expect(await rank.allowRank("gs", UID)).toBe(true)
  })

  it("没记过资格信息的 uid 在第二档及以上一律不放行", async () => {
    expect(await make(2).allowRank("gs", UID)).toBe(false)
  })
})

describe("ProfileRank 榜单", () => {
  let rank: ProfileRank

  beforeEach(() => {
    rank = new ProfileRank({ kv: new Kv(new MemoryKvDriver()), limit: () => 1 })
  })

  it("分数降序，名次从 1 起", async () => {
    for (const [uid, score] of [
      ["100000101", 40],
      ["100000102", 55],
      ["100000103", 48]
    ] as const) {
      await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "10000046", user: USER, uid, score })
    }
    const got = await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "10000046" })

    expect(got.map(one => one.uid)).toEqual(["100000102", "100000103", "100000101"])
    expect(got[0]?.rank).toBe(1)
  })

  it("同分时按 uid 升序，使名次稳定", async () => {
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: "100000102", score: 50 })
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: "100000101", score: 50 })

    const first = await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "1" })
    const second = await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "1" })
    expect(first.map(o => o.uid)).toEqual(["100000101", "100000102"])
    expect(second.map(o => o.uid)).toEqual(first.map(o => o.uid))
  })

  it("同一个 uid 再交一次分数是覆盖，不是新增一名", async () => {
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: UID, score: 40 })
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: UID, score: 50 })

    const got = await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "1" })
    expect(got).toHaveLength(1)
    expect(got[0]?.score).toBe(50)
  })

  it("无资格的 uid 不入榜 —— 写了再在读时过滤会让名次跳动", async () => {
    const limited = new ProfileRank({ kv: new Kv(new MemoryKvDriver()), limit: () => 2 })
    const ok = await limited.setScore({
      group: GROUP,
      game: "gs",
      type: "mark",
      charId: "1",
      user: USER, uid: UID,
      score: 50
    })

    expect(ok).toBe(false)
    expect(await limited.board({ group: GROUP, game: "gs", type: "mark", charId: "1" })).toEqual([])
  })

  it("预设面板的 uid 交不进去", async () => {
    const ok = await rank.setScore({
      group: GROUP,
      game: "gs",
      type: "mark",
      charId: "1",
      user: USER, uid: "100000000",
      score: 999
    })

    expect(ok).toBe(false)
  })

  it("开拓者的成对 id 落在同一条榜上", async () => {
    await rank.setScore({ group: GROUP, game: "sr", type: "mark", charId: "8001", user: USER, uid: "100000101", score: 40 })
    await rank.setScore({ group: GROUP, game: "sr", type: "mark", charId: "8002", user: USER, uid: "100000102", score: 50 })

    const got = await rank.board({ group: GROUP, game: "sr", type: "mark", charId: "8001" })
    expect(got).toHaveLength(2)
    expect(got[0]?.uid).toBe("100000102")
  })

  it("查自己的名次时看的是全榜，而非截断后的那一段", async () => {
    // 从 101 起编号：100000000~100000005 是预设 uid，交不进榜
    for (let idx = 0; idx < 20; idx++) {
      await rank.setScore({
        group: GROUP,
        game: "gs",
        type: "mark",
        charId: "1",
        user: USER, uid: `1000001${String(idx).padStart(2, "0")}`,
        score: 100 - idx
      })
    }
    // 第 18 名在缺省的 15 名之外，仍应查得到
    const got = await rank.rankOf({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: "100000117" })

    expect(got?.rank).toBe(18)
  })

  it("不在榜上时给 undefined", async () => {
    expect(
      await rank.rankOf({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: UID })
    ).toBeUndefined()
  })

  it("按上限截断", async () => {
    // 同上，从 101 起编号
    for (let idx = 0; idx < 20; idx++) {
      await rank.setScore({
        group: GROUP,
        game: "gs",
        type: "mark",
        charId: "1",
        user: USER, uid: `1000001${String(idx).padStart(2, "0")}`,
        score: idx
      })
    }

    expect(await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "1" })).toHaveLength(15)
    expect(await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "1", limit: 3 })).toHaveLength(3)
  })

  it("取第一名", async () => {
    await rank.setScore({ group: GROUP, game: "gs", type: "dmg", charId: "1", user: USER, uid: "100000101", score: 10 })
    await rank.setScore({ group: GROUP, game: "gs", type: "dmg", charId: "1", user: USER, uid: "100000102", score: 20 })

    expect(await rank.topUid({ group: GROUP, game: "gs", type: "dmg", charId: "1" })).toEqual({
      user: USER,
      uid: "100000102"
    })
  })

  it("**两人更新同一个 uid 是两条条目**：面板按用户分存，后写的不能覆盖前一人的分数", async () => {
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: "qq:1", uid: UID, score: 40 })
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: "qq:2", uid: UID, score: 50 })

    const got = await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "1" })
    expect(got.map(one => one.user)).toEqual(["qq:2", "qq:1"])
    // 删一人的不动另一人的
    await rank.dropUid("qq:2", "gs", UID)
    expect((await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "1" })).map(one => one.user)).toEqual([
      "qq:1"
    ])
  })

  it("列出全部角色各自的第一名", async () => {
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: "100000101", score: 10 })
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "2", user: USER, uid: "100000102", score: 20 })

    const got = await rank.topOfEach(GROUP, "gs", "mark")
    expect(got).toHaveLength(2)
    expect(got.find(one => one.charId === "2")?.uid).toBe("100000102")
  })

  it("四个维度互不干扰", async () => {
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: UID, score: 40 })

    expect(await rank.board({ group: GROUP, game: "gs", type: "dmg", charId: "1" })).toEqual([])
  })

  it("两个群互不干扰", async () => {
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: UID, score: 40 })

    expect(await rank.board({ group: "20002", game: "gs", type: "mark", charId: "1" })).toEqual([])
  })

  it("两个游戏互不干扰", async () => {
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: UID, score: 40 })

    expect(await rank.board({ group: GROUP, game: "sr", type: "mark", charId: "1" })).toEqual([])
  })
})

describe("ProfileRank 群配置与重置", () => {
  let rank: ProfileRank

  // 这一组用 limit=3 是为了验"参与要求"的文案，而它同时意味着 setScore 要求资格 ——
  // 故用到 setScore 的用例须先记一份够格的资格信息（16 个角色），否则分数一律被拒收，
  // 榜是空的而断言看着像"清多了"
  beforeEach(async () => {
    rank = new ProfileRank({ kv: new Kv(new MemoryKvDriver()), limit: () => 3, number: () => 20 })
    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: Array.from({ length: 16 }, (_, i) => `角色${i}`) })
    await rank.setUidInfo({ game: "sr", user: USER, uid: UID, names: Array.from({ length: 16 }, (_, i) => `角色${i}`) })
  })

  it("没配过的群给一份缺省配置，且带上参与要求的说明", async () => {
    const cfg = await rank.groupCfg(GROUP, "gs")

    expect(cfg.status).toBe(0)
    expect(cfg.limitTxt).toBe("绑定CK，或列表有16个角色数据")
    expect(cfg.number).toBe(20)
    expect(cfg.time).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it("参与要求的说明按游戏给出不同的角色名", async () => {
    const four = new ProfileRank({ kv: new Kv(new MemoryKvDriver()), limit: () => 4 })

    expect((await four.groupCfg(GROUP, "gs")).limitTxt).toContain("安柏")
    expect((await four.groupCfg(GROUP, "sr")).limitTxt).toContain("丹恒")
  })

  it("关掉再打开，起算时刻不变", async () => {
    const before = await rank.groupCfg(GROUP, "gs")
    await rank.setGroupStatus(GROUP, "gs", 1)
    const closed = await rank.groupCfg(GROUP, "gs")

    expect(closed.status).toBe(1)
    expect(closed.timestamp).toBe(before.timestamp)
  })

  it("重置单个角色只清那个角色", async () => {
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: UID, score: 40 })
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "2", user: USER, uid: UID, score: 40 })
    await rank.reset(GROUP, "gs", "1")

    expect(await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "1" })).toEqual([])
    expect(await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "2" })).toHaveLength(1)
  })

  it("整群重置清掉全部维度，并把起算时刻推到现在", async () => {
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: UID, score: 40 })
    await rank.setScore({ group: GROUP, game: "gs", type: "dmg", charId: "1", user: USER, uid: UID, score: 40 })
    const before = await rank.groupCfg(GROUP, "gs")

    await new Promise(resolve => setTimeout(resolve, 5))
    await rank.reset(GROUP, "gs")

    expect(await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "1" })).toEqual([])
    expect(await rank.board({ group: GROUP, game: "gs", type: "dmg", charId: "1" })).toEqual([])
    expect((await rank.groupCfg(GROUP, "gs")).timestamp).toBeGreaterThan(before.timestamp)
  })

  it("整群重置不动别的群", async () => {
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: UID, score: 40 })
    await rank.setScore({ group: "20002", game: "gs", type: "mark", charId: "1", user: USER, uid: UID, score: 40 })
    await rank.reset(GROUP, "gs")

    expect(await rank.board({ group: "20002", game: "gs", type: "mark", charId: "1" })).toHaveLength(1)
  })

  it("删一个 uid 会把它从全部榜上摘掉；资格信息按 uid 记、与谁存的无关，故保留", async () => {
    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: Array.from({ length: 16 }, (_, i) => `角色${i}`) })
    await rank.setScore({ group: GROUP, game: "gs", type: "mark", charId: "1", user: USER, uid: UID, score: 40 })
    await rank.setScore({ group: "20002", game: "gs", type: "dmg", charId: "2", user: USER, uid: UID, score: 40 })

    const count = await rank.dropUid(USER, "gs", UID)

    expect(count).toBe(2)
    expect(await rank.board({ group: GROUP, game: "gs", type: "mark", charId: "1" })).toEqual([])
    expect(await rank.uidInfo("gs", UID)).toBeDefined()
  })

  it("删 uid 只动本游戏的榜", async () => {
    await rank.setUidInfo({ game: "gs", user: USER, uid: UID, names: Array.from({ length: 16 }, (_, i) => `角色${i}`) })
    await rank.setUidInfo({ game: "sr", user: USER, uid: UID, names: Array.from({ length: 16 }, (_, i) => `角色${i}`) })
    await rank.setScore({ group: GROUP, game: "sr", type: "mark", charId: "1", user: USER, uid: UID, score: 40 })

    await rank.dropUid(USER, "gs", UID)

    expect(await rank.board({ group: GROUP, game: "sr", type: "mark", charId: "1" })).toHaveLength(1)
  })
})
