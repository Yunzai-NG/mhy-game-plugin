/**
 * 模块职责：面板替换的解析与改造的测试
 * 依赖方向：测试文件，只依赖 panel/change.ts（纯函数）与两份假的元数据表
 * 生命周期：无状态
 * 注意事项：钉住五条最容易静默出错的口径：认不出就整体失败（猜错只会出一张改错了的面板）、
 *          **部位词两个游戏不能混**（原神的「头」是理之冠即第 5 件，星铁的「头」是第 1 件）、
 *          换套装时旧 id 必须去掉（装配层先按 id 查，留着它就名字换了而套装效果还是旧的）、
 *          改造不动传进来那一份（写回去会让此后每次 `#胡桃面板` 都显示别人的武器）、借不到的
 *          部件只记一笔不整体失败。
 */
import { describe, expect, it } from "vitest"
import type { ArtiSetTable } from "../meta/arti-set.js"
import type { MetaLoader } from "../meta/loader.js"
import type { StoredAvatar } from "../store/panel.js"
import { applyChange, parseChange } from "./change.js"

/** 认得的角色与武器，够这几条测试用 */
const ITEMS: Record<string, { id: string; name: string; kind?: "char" | "weapon"; weapon?: string }> = {
  胡桃: { id: "10000046", name: "胡桃", kind: "char" },
  钟离: { id: "10000030", name: "钟离", kind: "char" },
  刻晴: { id: "10000042", name: "刻晴", kind: "char" },
  护摩之杖: { id: "13501", name: "护摩之杖", kind: "weapon" },
  // 元数据的武器别名表里本来就有这条（许多武器带 `专武` 别名）
  胡桃专武: { id: "13501", name: "护摩之杖", kind: "weapon" },
  青雀: { id: "1202", name: "青雀", kind: "char", weapon: "巡猎" },
  于夜色中: { id: "23015", name: "于夜色中", kind: "weapon" },
  // 换天赋的位序随命途变，故三类各备一个：`weapon` 在星铁角色上存的是命途
  爻光: { id: "1407", name: "爻光", kind: "char", weapon: "欢愉" },
  昔涟: { id: "1405", name: "昔涟", kind: "char", weapon: "记忆" }
}

/**
 * 认得的套装：原神两个、星铁一个遗器套加一个位面套
 *
 * 都带上简称：使用者打的是「深林」「宗室」而不是全名，那一级由 `ArtiSetTable` 的
 * `byAbbr` 索引提供（见 meta/arti-set.ts）。
 */
const SETS: Record<string, { name: string; id: string; abbr?: string; idxs: Record<string, string> }> = {
  宗室之翎: {
    name: "宗室之翎",
    id: "15008",
    abbr: "宗室",
    idxs: { 1: "宗室之花", 2: "宗室之翎", 3: "宗室之壶", 4: "宗室之杯", 5: "宗室之冠" }
  },
  深林的记忆: {
    name: "深林的记忆",
    id: "15025",
    abbr: "深林",
    idxs: { 1: "深林之花", 2: "深林之羽", 3: "深林之沙", 4: "深林之杯", 5: "深林之冠" }
  },
  猎人: { name: "猎人", id: "101", abbr: "猎人", idxs: { 1: "猎人头", 2: "猎人手", 3: "猎人衣", 4: "猎人鞋" } },
  仙舟: { name: "仙舟", id: "301", abbr: "仙舟", idxs: { 5: "仙舟球", 6: "仙舟绳" } }
}

/** 假的元数据装载器与套装索引 */
const DEPS = {
  meta: {
    byName: (_game: string, name: string) => ITEMS[name.trim()]
  } as unknown as MetaLoader,
  sets: {
    // 与真实的 ArtiSetTable.set 同一口径：全名与**简称**都认（使用者打的是「深林」）
    set: (_game: string, name: string | number) => {
      const key = String(name).trim()
      return SETS[key] ?? Object.values(SETS).find(one => one.abbr === key)
    }
  } as unknown as ArtiSetTable
}

/**
 * 造一份库里的角色面板
 * @param over 要覆盖的字段
 * @returns 角色面板
 */
function stored(over: Partial<StoredAvatar> = {}): StoredAvatar {
  return {
    id: "10000046",
    level: 90,
    promote: 6,
    cons: 1,
    talent: { a: 9, e: 9, q: 9 },
    weapon: { name: "护摩之杖", level: 90, affix: 1 },
    artis: {
      1: { name: "宗室之花", set: "宗室之翎", id: "15008", level: 20, star: 5, mainId: "2000", attrIds: ["501012"] },
      2: { name: "宗室之翎", set: "宗室之翎", id: "15018", level: 20, star: 5, mainId: "2001", attrIds: ["501022"] }
    },
    from: "enka",
    ...over
  }
}

/** 借部件时能读到的那几份存档 */
const LIBRARY: Record<string, StoredAvatar> = {
  "100000001:钟离": stored({ id: "10000030", weapon: { name: "护摩之杖", level: 80, affix: 3 } }),
  "100000001:刻晴": stored({
    id: "10000042",
    artis: { 1: { name: "深林之花", set: "深林的记忆", id: "15025", level: 20, star: 5 } }
  }),
  // 这一位有面板但**没有武器**，用来验"借不到只记一笔"
  "100000001:青雀": { id: "1202", level: 80, cons: 0 }
}

/** 造改造要用的依赖 */
const APPLY = {
  ...DEPS,
  load: (uid: string, name: string): StoredAvatar | undefined => LIBRARY[`${uid}:${name}`]
}

describe("parseChange 认角色与出图种类", () => {
  it("认出角色、缺省出面板图", () => {
    const got = parseChange("胡桃换钟离武器", "gs", DEPS)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.char).toBe("胡桃")
    expect(got.mode).toBe("panel")
  })

  it("「圣遗物」「伤害」各出各的图，伤害还认序号", () => {
    const artis = parseChange("胡桃圣遗物换深林", "gs", DEPS)
    expect(artis.ok && artis.mode).toBe("artis")

    const dmg = parseChange("胡桃伤害2换钟离武器", "gs", DEPS)
    expect(dmg.ok && dmg.mode).toBe("dmg")
    expect(dmg.ok && dmg.dmgIndex).toBe(2)
  })

  it("带 uid 时认出来 —— 那是「查别人的面板再试算」", () => {
    const got = parseChange("100000001胡桃换钟离武器", "gs", DEPS)
    expect(got.ok && got.uid).toBe("100000001")
  })

  it("「变」「改」两个同义字一并认", () => {
    expect(parseChange("胡桃变钟离武器", "gs", DEPS).ok).toBe(true)
    expect(parseChange("胡桃改钟离武器", "gs", DEPS).ok).toBe(true)
  })

  it("**认不出的角色名整体失败** —— 猜错只会出一张改错了的图", () => {
    const got = parseChange("某个不存在的人换钟离武器", "gs", DEPS)
    expect(got.ok).toBe(false)
    expect(got.ok === false && got.message).toContain("没认出")
  })

  it("**「换」后面认不出也整体失败**，不是把认出的那半拿去出图", () => {
    const got = parseChange("胡桃换某件不存在的东西", "gs", DEPS)
    expect(got.ok).toBe(false)
  })

  it("没有「换」字、或两侧空着时各回一句", () => {
    expect(parseChange("胡桃面板", "gs", DEPS).ok).toBe(false)
    expect(parseChange("换钟离武器", "gs", DEPS).ok).toBe(false)
    expect(parseChange("胡桃换", "gs", DEPS).ok).toBe(false)
  })
})

describe("parseChange 认换什么", () => {
  it("借武器", () => {
    const got = parseChange("胡桃换钟离武器", "gs", DEPS)
    expect(got.ok && got.change.weapon?.from?.name).toBe("钟离")
  })

  it("指名一把武器，可带等级与精炼", () => {
    const got = parseChange("胡桃换5精90级护摩之杖", "gs", DEPS)
    expect(got.ok && got.change.weapon?.name).toBe("护摩之杖")
    expect(got.ok && got.change.weapon?.affix).toBe(5)
    expect(got.ok && got.change.weapon?.level).toBe(90)
  })

  it("借整套圣遗物", () => {
    const got = parseChange("胡桃换刻晴圣遗物", "gs", DEPS)
    expect(got.ok && got.change.artis?.name).toBe("刻晴")
  })

  it("借单个部位，`+` 连写多件", () => {
    const got = parseChange("胡桃换刻晴花+杯", "gs", DEPS)
    expect(got.ok && got.change.pos?.[1]?.name).toBe("刻晴")
    expect(got.ok && got.change.pos?.[4]?.name).toBe("刻晴")
  })

  it("**部位词两个游戏不混** —— 原神的「头」是理之冠（第 5 件），星铁的「头」是第 1 件", () => {
    const gs = parseChange("胡桃换刻晴头", "gs", DEPS)
    expect(gs.ok && Object.keys(gs.ok ? (gs.change.pos ?? {}) : {})).toEqual(["5"])

    const sr = parseChange("青雀换青雀头", "sr", DEPS)
    expect(sr.ok && Object.keys(sr.ok ? (sr.change.pos ?? {}) : {})).toEqual(["1"])
  })

  it("换套装：原神一个名字铺满五件，两个名字前三后二", () => {
    const one = parseChange("胡桃换深林的记忆", "gs", DEPS)
    expect(one.ok && one.change.sets?.[1]).toBe("深林的记忆")
    expect(one.ok && one.change.sets?.[5]).toBe("深林的记忆")

    const two = parseChange("胡桃换深林的记忆+宗室之翎", "gs", DEPS)
    expect(two.ok && two.change.sets?.[1]).toBe("深林的记忆")
    expect(two.ok && two.change.sets?.[4]).toBe("宗室之翎")
  })

  it("**星铁的位面套只铺 5、6 两件** —— 铺到头与手上那两件在游戏里不存在", () => {
    const got = parseChange("青雀换仙舟", "sr", DEPS)
    expect(got.ok && Object.keys(got.ok ? (got.change.sets ?? {}) : {})).toEqual(["5", "6"])

    const relic = parseChange("青雀换猎人", "sr", DEPS)
    expect(relic.ok && Object.keys(relic.ok ? (relic.change.sets ?? {}) : {})).toEqual(["1", "2", "3", "4"])
  })

  it("命座、等级、天赋、满行迹", () => {
    expect(parseChange("胡桃换6命", "gs", DEPS).ok).toBe(true)
    expect(parseChange("胡桃换满命", "gs", DEPS)).toMatchObject({ change: { cons: 6 } })
    expect(parseChange("胡桃换80级", "gs", DEPS)).toMatchObject({ change: { level: 80 } })
    expect(parseChange("胡桃换天赋10 10 10", "gs", DEPS)).toMatchObject({
      change: { talent: { a: 10, e: 10, q: 10 } }
    })
    expect(parseChange("青雀换满行迹", "sr", DEPS)).toMatchObject({ change: { fullTrees: true } })
  })

  it("**满行迹只有星铁认** —— 原神没有行迹这回事", () => {
    expect(parseChange("胡桃换满行迹", "gs", DEPS).ok).toBe(false)
  })

  it("不带分隔的那一串逐位切，两位数只可能是 10~15 —— 整串当一个数解会被截到 15", () => {
    expect(parseChange("胡桃换天赋10109", "gs", DEPS)).toMatchObject({
      change: { talent: { a: 10, e: 10, q: 9 } }
    })
    expect(parseChange("胡桃换天赋999", "gs", DEPS)).toMatchObject({
      change: { talent: { a: 9, e: 9, q: 9 } }
    })
    // 0 不是合法等级，整条认不出
    expect(parseChange("胡桃换天赋900", "gs", DEPS).ok).toBe(false)
  })

  it("**星铁换天赋的位序随命途变** —— 欢愉角色没有忆灵技，第 5 位该落在欢愉技上", () => {
    // 爻光是欢愉：第 5 位是 `j`，而不是记忆角色的 `me`
    expect(parseChange("爻光换天赋610101010", "sr", DEPS)).toMatchObject({
      change: { talent: { a: 6, e: 10, t: 10, q: 10, j: 10 } }
    })
    // 昔涟是记忆：第 5、6 位才是忆灵技与忆灵天赋
    expect(parseChange("昔涟换天赋61010101010", "sr", DEPS)).toMatchObject({
      change: { talent: { a: 6, e: 10, t: 10, q: 10, me: 10, mt: 10 } }
    })
    // 青雀是巡猎：只有四位，多给的那些丢掉而不是错落到忆灵技上
    const got = parseChange("青雀换天赋6101010", "sr", DEPS)
    expect(got.ok && got.change.talent).toEqual({ a: 6, e: 10, t: 10, q: 10 })
  })

  it("天赋认不出时把这个角色的位序念出来 —— 不然使用者得猜第 5 位是什么", () => {
    const got = parseChange("爻光换天赋", "sr", DEPS)
    expect(got.ok).toBe(false)
    expect(!got.ok && got.message).toContain("普攻/战技/天赋/终结技/欢愉技")
  })

  it("**「XX专武」折成元数据里那条别名** —— 别名表里本来就有「神里绫华专武」这种写法", () => {
    // 简称也认：`雾切` 这一步由别名表负责，此处只负责把「胡桃专武」折成正式名 + 专武
    expect(parseChange("胡桃换胡桃专武", "gs", DEPS)).toMatchObject({
      change: { weapon: { name: "护摩之杖" } }
    })
    // 不带角色名的裸「专武」折不出来，认不出而非静默换错一把
    expect(parseChange("胡桃换专武", "gs", DEPS).ok).toBe(false)
  })

  it("一句里换好几样", () => {
    const got = parseChange("胡桃换钟离武器换刻晴圣遗物换6命", "gs", DEPS)
    expect(got.ok && got.change.weapon?.from?.name).toBe("钟离")
    expect(got.ok && got.change.artis?.name).toBe("刻晴")
    expect(got.ok && got.change.cons).toBe(6)
  })
})

describe("applyChange 改造", () => {
  it("**不动传进来那一份** —— 写回去会让此后每次看面板都是假的", () => {
    const base = stored()
    const before = JSON.stringify(base)
    applyChange("gs", base, { cons: 6, weapon: { name: "护摩之杖" } }, "100000001", APPLY)
    expect(JSON.stringify(base)).toBe(before)
  })

  it("换命座、等级、天赋", () => {
    const { avatar } = applyChange("gs", stored(), { cons: 6, level: 80, talent: { a: 10 } }, "100000001", APPLY)
    expect(avatar.cons).toBe(6)
    expect(avatar.level).toBe(80)
    expect(avatar.talent?.a).toBe(10)
    // 原有的其余天赋保持不变
    expect(avatar.talent?.e).toBe(9)
  })

  it("**换等级要丢掉突破阶数** —— 留着旧的会让 80 级配 6 阶白值", () => {
    const { avatar } = applyChange("gs", stored(), { level: 80 }, "100000001", APPLY)
    expect(avatar.promote).toBeUndefined()
  })

  it("借武器时连等级与精炼一并借过来", () => {
    const { avatar } = applyChange("gs", stored(), { weapon: { from: { name: "钟离" } } }, "100000001", APPLY)
    expect(avatar.weapon?.level).toBe(80)
    expect(avatar.weapon?.affix).toBe(3)
  })

  it("指名武器时不指定练度即按满级 —— 试算问的是「这把武器值不值」", () => {
    const { avatar } = applyChange("gs", stored(), { weapon: { name: "护摩之杖" } }, "100000001", APPLY)
    expect(avatar.weapon?.level).toBe(90)
  })

  it("借整套圣遗物", () => {
    const { avatar } = applyChange("gs", stored(), { artis: { name: "刻晴" } }, "100000001", APPLY)
    expect(avatar.artis?.["1"]?.name).toBe("深林之花")
  })

  it("借单个部位时其余部位不动", () => {
    const { avatar } = applyChange("gs", stored(), { pos: { 1: { name: "刻晴" } } }, "100000001", APPLY)
    expect(avatar.artis?.["1"]?.name).toBe("深林之花")
    expect(avatar.artis?.["2"]?.name).toBe("宗室之翎")
  })

  it("**换套装时旧 id 要去掉** —— 装配层先按 id 查，留着它就名字换了而套装还是旧的", () => {
    const { avatar } = applyChange("gs", stored(), { sets: { 1: "深林的记忆" } }, "100000001", APPLY)
    const one = avatar.artis?.["1"]
    expect(one?.name).toBe("深林之花")
    expect(one?.set).toBe("深林的记忆")
    expect(one?.id).toBeUndefined()
    // 词条一个都不动：换套装问的是「同样这几条词条，换成深林会怎样」
    expect(one?.attrIds).toEqual(["501012"])
  })

  it("换套装不会凭空长出一件 —— 本来空着的部位仍空着", () => {
    const { avatar } = applyChange("gs", stored(), { sets: { 1: "深林的记忆", 5: "深林的记忆" } }, "100000001", APPLY)
    expect(avatar.artis?.["5"]).toBeUndefined()
  })

  it("**借不到的只记一笔，不整体失败** —— 出一张只换了一半的图比回一句报错更接近本意", () => {
    const { avatar, missed } = applyChange(
      "gs",
      stored(),
      { weapon: { from: { name: "青雀" } }, cons: 6 },
      "100000001",
      APPLY
    )
    // 青雀那份没有武器，故武器没换成
    expect(missed).toContain("武器")
    // 但命座照改
    expect(avatar.cons).toBe(6)
  })

  it("借不到的角色整个不在库里时也只记一笔", () => {
    const { missed } = applyChange("gs", stored(), { artis: { name: "钟离" } }, "999999999", APPLY)
    expect(missed.length).toBe(1)
  })

  it("满行迹写进 trees", () => {
    const { avatar } = applyChange("sr", stored({ trees: [] }), { fullTrees: true }, "100000001", APPLY)
    expect(avatar.trees?.length).toBe(16)
  })

  it("改过的那份标成 change —— 图上「数据来源」随之显示「预设面板」", () => {
    const { avatar } = applyChange("gs", stored(), { cons: 6 }, "100000001", APPLY)
    expect(avatar.from).toBe("change")
  })
})
