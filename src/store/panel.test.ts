/**
 * 模块职责：面板数据落库的测试
 * 依赖方向：测试文件，依赖 panel.ts 与内核 store
 * 生命周期：每个用例一份内存 KV
 * 注意事项：重心是三件各有"不报错但结果全错"失效方式的事：**逐字段合并**（整体替换会让一次
 *          米游社更新冲掉可评分的圣遗物）、**面板可用性判定**（漏判一项则下游拿残缺数据算出
 *          一组看着正常的错数）、以及**「这一位的数据变了没有」的判据**（判得太严会在换源、
 *          副词条换序、星铁速度反推差一档时全判成"变了"，列表图上那个标记于是恒亮）。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { beforeEach, describe, expect, it } from "vitest"
import type { PanelProfile } from "../panel/profile/index.js"
import { PanelStore, hasAvatarData, isPanelReady } from "./panel.js"
import type { StoredAvatar, UserPanels } from "./panel.js"

/**
 * 造一份可用的面板角色数据
 * @param over 要覆盖的字段
 * @returns 角色面板
 */
function avatar(over: Partial<StoredAvatar> = {}): StoredAvatar {
  return {
    id: "10000046",
    level: 90,
    cons: 2,
    from: "enka",
    weapon: { name: "护摩之杖", level: 90, promote: 6, affix: 1 },
    talent: { a: 9, e: 9, q: 9 },
    artis: { "1": { name: "追忆的形骸", set: "追忆之注连", mainId: "10001", attrIds: [1, 2] } },
    ...over
  }
}

/**
 * 造一份取数结果；数据源标识写在整份面板上而非逐个角色上，故此处的角色不带 `from`
 * @param over 要覆盖的字段
 * @returns 统一形态的面板
 */
function profile(over: Partial<PanelProfile> = {}): PanelProfile {
  return {
    game: "gs",
    uid: "100000001",
    name: "旅行者",
    level: 60,
    from: "enka",
    avatars: {
      "10000046": {
        id: "10000046",
        level: 90,
        cons: 2,
        weapon: { name: "护摩之杖", level: 90, promote: 6, affix: 1 },
        talent: { a: 9, e: 9, q: 9 },
        artis: { "1": { name: "追忆的形骸", set: "追忆之注连", mainId: "10001", attrIds: [1, 2] } }
      }
    },
    ...over
  }
}

describe("isPanelReady", () => {
  it("四项齐备才算可用", () => {
    expect(isPanelReady(avatar(), "gs")).toBe(true)
  })

  it("数据源不在册的一律不算 —— 挡住只有名字与等级的那种记录", () => {
    expect(isPanelReady(avatar({ from: "mys" }), "gs")).toBe(false)
    expect(isPanelReady(avatar({ from: undefined }), "gs")).toBe(false)
  })

  it("不按突破阶数判 —— 星铁那一路的接口不给它，按它判会把全部星铁角色判成无面板", () => {
    expect(isPanelReady(avatar({ weapon: { name: "护摩之杖", level: 1 } }), "gs")).toBe(true)
    expect(isPanelReady(avatar({ weapon: { name: "护摩之杖", level: 1, promote: 0 } }), "gs")).toBe(true)
  })

  it("原神没有武器、或武器连等级都没有的不算 —— 那是一条只有名字的壳记录", () => {
    expect(isPanelReady(avatar({ weapon: undefined }), "gs")).toBe(false)
    expect(isPanelReady(avatar({ weapon: { name: "护摩之杖" } }), "gs")).toBe(false)
  })

  it("**星铁没有光锥照样可用** —— 游戏不送初始光锥，空着是常态", () => {
    // 原神角色出场即带一把武器且卸不掉，星铁与绝区零不送；按原神那样判会把这些角色整体判成
    // 无面板、连图都出不来（真机存档里确有光锥栏为 `{}` 的角色）
    expect(isPanelReady(avatar({ weapon: undefined }), "sr")).toBe(true)
    expect(isPanelReady(avatar({ weapon: {} }), "sr")).toBe(true)
  })

  it("**绝区零没有音擎照样可用** —— 同理，判据是驱动盘与属性栏", () => {
    const zzz = {
      name: "叶瞬光",
      rank: "S" as const,
      prof: "强攻",
      elemId: 200,
      attrs: [{ key: "hp" as const, name: "生命值", final: "11018" }],
      discs: [{ id: 31_041, name: "驱动盘[1]", rank: "S", pos: 1, level: 15, main: { id: 11_103, name: "主词条", value: "2200", rolls: 1 }, subs: [] }]
    }
    const bare = avatar({ id: "1431", from: "mysPanelZZZ", weapon: undefined, zzz })
    expect(isPanelReady(bare, "zzz")).toBe(true)
    // 驱动盘那一栏才是绝区零的判据：一件都没有仍不算可用
    expect(isPanelReady({ ...bare, zzz: { ...zzz, discs: [] } }, "zzz")).toBe(false)
  })

  it("没有天赋不算", () => {
    expect(isPanelReady(avatar({ talent: {} }), "gs")).toBe(false)
    expect(isPanelReady(avatar({ talent: undefined }), "gs")).toBe(false)
  })

  it("圣遗物没有主词条 id 不算 —— 那种算不出任何属性", () => {
    expect(isPanelReady(avatar({ artis: {} }), "gs")).toBe(false)
    expect(isPanelReady(avatar({ artis: { "1": { name: "追忆的形骸" } } }), "gs")).toBe(false)
  })

  it("旅行者要认得出元素，否则不知道按哪套天赋算", () => {
    const one = avatar({ id: "10000005" })
    expect(isPanelReady(one, "gs")).toBe(false)
    expect(isPanelReady({ ...one, elem: "anemo" }, "gs")).toBe(true)
  })
})

describe("hasAvatarData", () => {
  it("等级大于 1 或带了武器就算有数据", () => {
    expect(hasAvatarData({ id: "1", level: 80, cons: 0 })).toBe(true)
    expect(hasAvatarData({ id: "1", level: 1, cons: 0, weapon: { name: "无锋剑" } })).toBe(true)
    expect(hasAvatarData({ id: "1", level: 1, cons: 0 })).toBe(false)
    expect(hasAvatarData(undefined)).toBe(false)
  })
})

describe("PanelStore", () => {
  /** 一位使用者名下的面板库 —— 本组用例都在同一人名下，故直接拿视图 */
  let store: UserPanels

  beforeEach(() => {
    store = new PanelStore({ kv: new Kv(new MemoryKvDriver()) }).of("qq:1")
  })

  it("没存过的玩家返回一份空档案，调用方无需判空", async () => {
    expect(await store.load("gs", "100000001")).toEqual({ game: "gs", uid: "100000001", avatars: {} })
    expect(await store.hasPanel("gs", "100000001")).toBe(false)
    expect(await store.panelIds("gs", "100000001")).toEqual([])
  })

  it("首次合并落库，并报出本次取到与确实变了的角色", async () => {
    const got = await store.merge(profile(), { now: 1000 })

    expect(got.updated).toEqual(["10000046"])
    expect(got.changed).toEqual(["10000046"])
    const player = await store.load("gs", "100000001")
    expect(player.name).toBe("旅行者")
    expect(player.profileAt).toBe(1000)
    expect(player.avatars["10000046"]?.at).toBe(1000)
  })

  it("数据源标识从整份面板落到每个角色上 —— 少了它每条面板命令都回「暂无面板数据」", async () => {
    await store.merge(profile(), { now: 1000 })

    expect((await store.avatar("gs", "100000001", "10000046"))?.from).toBe("enka")
    expect(await store.panelIds("gs", "100000001")).toEqual(["10000046"])
    expect(await store.hasPanel("gs", "100000001")).toBe(true)
  })

  it("角色自带的数据源标识优先于整份面板的", async () => {
    const one = profile()
    const first = one.avatars["10000046"]
    if (first) first.from = "mgg"
    await store.merge(one, { now: 1000 })

    expect((await store.avatar("gs", "100000001", "10000046"))?.from).toBe("mgg")
  })

  it("同一份数据再合一次：取到了，但没有变 —— 两者分开才能只给真变了的打标记", async () => {
    await store.merge(profile(), { now: 1000 })
    const got = await store.merge(profile(), { now: 2000 })

    expect(got.updated).toEqual(["10000046"])
    expect(got.changed).toEqual([])
  })

  it("字段顺序不同不算变 —— 各源的字段次序本就不同", async () => {
    await store.merge(profile(), { now: 1000 })
    const reordered = profile({
      avatars: {
        "10000046": {
          // 与上一次同值，只是键序颠倒
          talent: { q: 9, e: 9, a: 9 },
          artis: { "1": { mainId: "10001", attrIds: [1, 2], set: "追忆之注连", name: "追忆的形骸" } },
          weapon: { affix: 1, promote: 6, level: 90, name: "护摩之杖" },
          from: "enka",
          cons: 2,
          level: 90,
          id: "10000046"
        }
      }
    })
    const got = await store.merge(reordered, { now: 2000 })

    expect(got.changed).toEqual([])
  })

  it("换一条数据源不算变 —— 否则那个标记在换源时恒亮，等于不再有信息", async () => {
    await store.merge(profile(), { now: 1000 })
    const got = await store.merge(profile({ from: "mysPanel" }), { now: 2000 })

    expect(got.changed).toEqual([])
    expect((await store.avatar("gs", "100000001", "10000046"))?.from).toBe("mysPanel")
  })

  it("副词条顺序不同不算变 —— 展柜按强化次序给，米游社按展示次序给", async () => {
    await store.merge(profile(), { now: 1000 })
    const got = await store.merge(
      profile({
        avatars: {
          "10000046": {
            ...(profile().avatars["10000046"] as NonNullable<PanelProfile["avatars"][string]>),
            artis: { "1": { name: "追忆的形骸", set: "追忆之注连", mainId: "10001", attrIds: [2, 1] } }
          }
        }
      }),
      { now: 2000 }
    )

    expect(got.changed).toEqual([])
  })

  it("原神换源时副词条只差档位末位不算变 —— 展柜给精确档位、米游社反推近似，前缀同即同一属性", async () => {
    const base = profile().avatars["10000046"] as NonNullable<PanelProfile["avatars"][string]>
    const withIds = (attrIds: number[], from = "enka"): PanelProfile =>
      profile({ from, avatars: { "10000046": { ...base, artis: { "1": { name: "追忆的形骸", set: "追忆之注连", mainId: "15010", attrIds } } } } })
    await store.merge(withIds([501062, 501222, 501232]), { now: 1000 })
    // 换米游社：同属性（50106/50122/50123 前缀不变）但反推出不同档位末位
    const got = await store.merge(withIds([501061, 501224, 501232], "mysPanel"), { now: 2000 })
    expect(got.changed).toEqual([])
  })

  it("原神副词条属性种类真变了仍要判变 —— 前缀不同", async () => {
    const base = profile().avatars["10000046"] as NonNullable<PanelProfile["avatars"][string]>
    const withIds = (attrIds: number[]): PanelProfile =>
      profile({ avatars: { "10000046": { ...base, artis: { "1": { name: "追忆的形骸", set: "追忆之注连", mainId: "15010", attrIds } } } } })
    await store.merge(withIds([501062, 501222]), { now: 1000 })
    // 50106 → 50107（防御% 换成元素精通），前缀变，应判成变了
    const got = await store.merge(withIds([501072, 501222]), { now: 2000 })
    expect(got.changed).toEqual(["10000046"])
  })

  it("突破阶数出现或消失不算变 —— 米游社那一路不给它", async () => {
    await store.merge(profile(), { now: 1000 })
    const one = profile()
    const first = one.avatars["10000046"]
    if (first) {
      first.promote = 6
      first.weapon = { name: "护摩之杖", level: 90, affix: 1 }
    }
    const got = await store.merge(one, { now: 2000 })

    expect(got.changed).toEqual([])
  })

  it("星铁的速度副词条变一档不算变 —— 各源的速度精度不同，反推的档位会来回跳", async () => {
    const sr = (attrIds: string[]): PanelProfile => ({
      game: "sr",
      uid: "800000001",
      from: "enkaHSR",
      avatars: {
        "1306": {
          id: "1306",
          level: 80,
          cons: 0,
          weapon: { id: "23020", level: 80, affix: 1 },
          talent: { a: 6, e: 10, q: 10 },
          trees: ["1306101"],
          artis: { "1": { id: "61171", mainId: "1", attrIds } }
        }
      }
    })
    await store.merge(sr(["7,2,1", "2,1,1"]), { now: 1000 })

    expect((await store.merge(sr(["7,3,1", "2,1,1"]), { now: 2000 })).changed).toEqual([])
    // 速度之外的那一条变了仍要判成变
    expect((await store.merge(sr(["7,3,1", "2,2,1"]), { now: 3000 })).changed).toEqual(["1306"])
  })

  it("真变了还是要判成变 —— 归一是为了滤掉无关差异，不是为了少报", async () => {
    await store.merge(profile(), { now: 1000 })
    const one = profile()
    const first = one.avatars["10000046"]
    if (first) first.level = 91

    expect((await store.merge(one, { now: 2000 })).changed).toEqual(["10000046"])
  })

  it("绝区零：属性栏的数值变了不算变，驱动盘换了才算 —— 属性是推导结果", async () => {
    const zzz = (opts: { hp: string; discLevel: number }): PanelProfile => ({
      game: "zzz",
      uid: "1300000001",
      from: "mysPanelZZZ",
      avatars: {
        "1431": {
          id: "1431",
          level: 60,
          cons: 2,
          weapon: { id: 14_143, name: "云霓孤光", level: 60, affix: 1 },
          talent: { normal: 12 },
          zzz: {
            name: "叶瞬光",
            rank: "S",
            attrs: [{ key: "hp", name: "生命值", final: opts.hp }],
            discs: [
              {
                id: 33_541,
                name: "沧浪行歌[1]",
                pos: 1,
                level: opts.discLevel,
                rank: "S",
                subs: [{ id: 21_103, name: "暴击伤害", value: "9.6%", rolls: 2 }]
              }
            ]
          }
        }
      }
    })
    await store.merge(zzz({ hp: "11018", discLevel: 15 }), { now: 1000 })

    expect((await store.merge(zzz({ hp: "11020", discLevel: 15 }), { now: 2000 })).changed).toEqual([])
    expect((await store.merge(zzz({ hp: "11020", discLevel: 12 }), { now: 3000 })).changed).toEqual(["1431"])
  })

  it("米游社那份圣遗物同样写进 artis，天赋与命座一并生效", async () => {
    await store.merge(profile(), { now: 1000 })
    // 米游社给天赋与命座，圣遗物的档位由反推得出，与展柜源一样带 mainId 与 attrIds
    const mys = profile({
      avatars: {
        "10000046": {
          id: "10000046",
          level: 90,
          cons: 4,
          from: "mysPanel",
          talent: { a: 10, e: 10, q: 10 },
          artis: { "1": { mainId: "10001", attrIds: [3, 4], set: "追忆之注连", name: "追忆的形骸" } }
        }
      }
    })
    await store.merge(mys, { now: 2000 })

    const one = await store.avatar("gs", "100000001", "10000046")
    // 圣遗物换成了这一次取到的那份，仍可评分
    expect(one?.artis?.["1"]?.mainId).toBe("10001")
    expect(one?.artis?.["1"]?.attrIds).toEqual([3, 4])
    // 米游社带来的命座与天赋生效了
    expect(one?.cons).toBe(4)
    expect(one?.talent).toEqual({ a: 10, e: 10, q: 10 })
    expect(one?.at).toBe(2000)
  })

  it("新数据缺某一项时留旧值，而非把它删掉", async () => {
    await store.merge(profile(), { now: 1000 })
    const partial = profile({
      avatars: {
        "10000046": { id: "10000046", level: 90, cons: 2, from: "enka", talent: { a: 9, e: 9, q: 9 } }
      }
    })
    await store.merge(partial, { now: 2000 })

    const one = await store.avatar("gs", "100000001", "10000046")
    expect(one?.weapon?.name).toBe("护摩之杖")
    expect(one?.artis?.["1"]?.mainId).toBe("10001")
  })

  it("玩家自身的信息同样只增不删", async () => {
    await store.merge(profile({ sign: "签名", level: 60 }), { now: 1000 })
    await store.merge(profile({ sign: undefined, level: 61 }), { now: 2000 })

    const player = await store.load("gs", "100000001")
    expect(player.sign).toBe("签名")
    expect(player.level).toBe(61)
  })

  it("两个游戏的同号 uid 各自独立", async () => {
    await store.merge(profile(), { now: 1000 })
    await store.merge(profile({ game: "sr", avatars: {} }), { now: 1000 })

    expect(await store.hasPanel("gs", "100000001")).toBe(true)
    expect(await store.panelIds("sr", "100000001")).toEqual([])
  })

  it("panelIds 只列可用的那些", async () => {
    await store.merge(
      profile({
        avatars: {
          "10000046": profile().avatars["10000046"] as PanelProfile["avatars"][string],
          // 这个只有等级，缺武器与天赋，故不可用
          "10000002": { id: "10000002", level: 80, cons: 0, from: "enka" }
        }
      }),
      { now: 1000 }
    )

    expect(await store.panelIds("gs", "100000001")).toEqual(["10000046"])
  })

  it("删掉之后读回一份空档案", async () => {
    await store.merge(profile(), { now: 1000 })
    await store.del("gs", "100000001")

    expect(await store.hasPanel("gs", "100000001")).toBe(false)
  })
})

describe("PanelStore 按用户隔离", () => {
  /*
   * 这一组钉的是越权那道口子：面板里有 `#米游社更新面板` 用本人 CK 取来的私有数据，
   * 若按 `game:uid` 共用一份，别人 `#绑定uid` 后即可读到、也能 `#删除面板` 删掉。
   */
  let a: ReturnType<PanelStore["of"]>
  let b: ReturnType<PanelStore["of"]>

  beforeEach(() => {
    const root = new PanelStore({ kv: new Kv(new MemoryKvDriver()) })
    a = root.of("qq:1")
    b = root.of("qq:2")
  })

  it("**A 存的面板，B 查同一 uid 读不到**", async () => {
    await a.merge(profile(), { now: 1000 })

    expect(await a.hasPanel("gs", "100000001")).toBe(true)
    expect(await b.hasPanel("gs", "100000001")).toBe(false)
    expect(await b.avatar("gs", "100000001", "10000046")).toBeUndefined()
  })

  it("**B 删同一 uid 不动 A 那份**", async () => {
    await a.merge(profile(), { now: 1000 })
    await b.merge(profile(), { now: 1000 })
    await b.del("gs", "100000001")

    expect(await b.hasPanel("gs", "100000001")).toBe(false)
    expect(await a.hasPanel("gs", "100000001")).toBe(true)
  })

  it("两人各自更新同一 uid，互不覆盖", async () => {
    await a.merge(profile({ sign: "甲" }), { now: 1000 })
    await b.merge(profile({ sign: "乙" }), { now: 2000 })

    expect((await a.load("gs", "100000001")).sign).toBe("甲")
    expect((await b.load("gs", "100000001")).sign).toBe("乙")
  })
})
