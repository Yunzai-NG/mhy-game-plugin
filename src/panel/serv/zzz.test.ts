/**
 * 模块职责：米游社绝区零面板源的映射测试
 * 依赖方向：测试文件，依赖 panel/serv/zzz、panel/profile/zzz 与 panel/prop/zzz；元数据用真实的 {@link MetaLoader} 读临时目录
 * 生命周期：每例造一次临时元数据目录，用后删掉
 * 注意事项：**样例取自真机存下来的 `avatar/info` 返回**，逐字保留两处易抄错处：总属性栏编号有界面序号（`1`/`2`/`5`）
 *          与系统编号（`111`/`121`/`201`）两套，且副词条出现次数由 `add` 而非 `level` 表达。
 *          **属性一律本地算**（角色 / 核心技 / 套装二件读元数据，音擎与驱动盘取接口成品值），故临时目录要放全 `attr`/`promote`/`core`；
 *          缺元数据整份回 `noMeta`。基础值那几行（hp/atk 的 `base`）由「角色 + 音擎基础攻击力」定、与真机逐字对得上，故拿它当基准。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeLogger } from "@yunzai-ng/core/testing"
import { MetaLoader } from "../../meta/loader.js"
import { isPanelReady } from "../../store/panel.js"
import type { StoredAvatar } from "../../store/panel.js"
import { zzzElemName, zzzProfName } from "../profile/index.js"
import { isPct, propValue, zzzPropKey, zzzPropName } from "../prop/zzz.js"
import { parseMysZzz, ZZZ_SOURCES } from "./zzz.js"

let dir = ""
let meta: MetaLoader

/** 叶瞬光（1431）的基础数据块，取自真实元数据 */
const YE_CHAR = {
  id: 1431,
  name: "叶瞬光",
  elem: "凄刃",
  star: 5,
  attr: {
    attack: 135,
    attack_growth: 82578,
    break_stun: 83,
    crit: 500,
    crit_damage: 5000,
    defence: 49,
    defence_growth: 66203,
    element_abnormal_power: 94,
    element_mystery: 93,
    hp_growth: 837238,
    hp_max: 617,
    sp_recover: 120
  },
  promote: {
    "1": { hp_max: 0, attack: 0, defence: 0, level_min: 0 },
    "5": { hp_max: 1694, attack: 193, defence: 134, level_min: 40 },
    "6": { hp_max: 2117, attack: 241, defence: 167, level_min: 50 }
  },
  core: { "6": { add: { 基础攻击力: "75", 暴击率: "14.4%" } } }
}

/** 照（1341）的基础数据块，够算出属性即可 */
const ZHAO_CHAR = {
  id: 1341,
  name: "照",
  elem: "冰",
  star: 5,
  attr: { attack: 120, attack_growth: 80000, defence: 48, defence_growth: 60000, hp_max: 600, hp_growth: 800000, break_stun: 90, crit: 500, crit_damage: 5000 },
  promote: { "6": { hp_max: 2000, attack: 230, defence: 160, level_min: 50 } },
  core: { "6": { add: { 冲击力: "50" } } }
}

/** 驱动盘套装的二件加成，键为套装 id */
const EQUIP = {
  "33500": { id: 33500, name: "沧浪行歌", set2: [{ id: 31501, name: "物理伤害", value: "10%" }] },
  "32700": { id: 32700, name: "折枝剑歌", set2: [{ id: 31401, name: "异常掌控", value: "30" }] },
  "32800": { id: 32800, name: "静听嘉音", set2: [{ id: 11201, name: "攻击力", value: "10%" }] }
}

/** 一位装了六件驱动盘的代理人，编号用界面序号那一套 */
const GEARED = {
  id: 1431,
  level: 60,
  name_mi18n: "叶瞬光",
  full_name_mi18n: "叶瞬光",
  element_type: 200,
  sub_element_type: 4,
  camp_name_mi18n: "云岿山",
  avatar_profession: 1,
  rarity: "S",
  rank: 2,
  role_vertical_painting_url: "https://act-webstatic.mihoyo.com/game_record/zzzv2/a.png",
  role_square_url: "https://act-webstatic.mihoyo.com/game_record/zzzv2/b.png",
  vertical_painting_color: "#de493e",
  weapon: {
    id: 14143,
    level: 60,
    name: "云霓孤光",
    star: 1,
    icon: "https://act-webstatic.mihoyo.com/darkmatter/nap/w.png",
    rarity: "S",
    profession: 1,
    properties: [{ property_name: "暴击伤害", property_id: 21103, base: "48%", level: 0, add: 0 }],
    main_properties: [{ property_name: "基础攻击力", property_id: 12101, base: "743", level: 0, add: 0 }]
  },
  equip: [
    {
      id: 33541,
      level: 15,
      name: "沧浪行歌[1]",
      icon: "https://act-webstatic.mihoyo.com/darkmatter/nap/d1.png",
      rarity: "S",
      equipment_type: 1,
      invalid_property_cnt: 2,
      all_hit: false,
      properties: [
        { property_name: "暴击伤害", property_id: 21103, base: "9.6%", level: 2, valid: true, add: 1 },
        { property_name: "防御力", property_id: 13102, base: "14.4%", level: 3, valid: false, add: 2 }
      ],
      main_properties: [{ property_name: "生命值", property_id: 11103, base: "2200", level: 1, add: 0 }],
      equip_suit: { suit_id: 33500, name: "沧浪行歌", own: 4, desc1: "物理伤害+10%。" }
    },
    {
      id: 32746,
      level: 15,
      name: "折枝剑歌[6]",
      rarity: "S",
      equipment_type: 6,
      properties: [{ property_name: "穿透值", property_id: 23203, base: "18", level: 2, add: 1 }],
      main_properties: [{ property_name: "攻击力", property_id: 12102, base: "30%", level: 1, add: 0 }],
      equip_suit: { suit_id: 32700, name: "折枝剑歌", own: 2 }
    }
  ],
  properties: [
    { property_name: "生命值", property_id: 1, base: "7673", add: "3345", final: "11018" },
    { property_name: "攻击力", property_id: 2, base: "1681", add: "1079", final: "2760" }
  ],
  skills: [
    { level: 12, skill_type: 0 },
    { level: 12, skill_type: 1 },
    { level: 7, skill_type: 2 },
    { level: 12, skill_type: 3 },
    { level: 7, skill_type: 5 },
    { level: 5, skill_type: 6 }
  ],
  equip_plan_info: { equip_rating: "ER_S", equip_rating_score: 79.35 }
}

/** 另一位，编号用系统编号那一套；同一份返回里可以混着两种 */
const SYSTEM_ID = {
  id: 1341,
  level: 60,
  name_mi18n: "照",
  element_type: 202,
  sub_element_type: 1,
  avatar_profession: 5,
  rarity: "S",
  rank: 0,
  weapon: { id: 13007, level: 60, name: "正版变身器", star: 2, rarity: "A" },
  equip: [
    {
      id: 32841,
      level: 15,
      name: "静听嘉音[1]",
      rarity: "S",
      equipment_type: 1,
      properties: [{ property_name: "生命值", property_id: 11102, base: "6%", level: 2, add: 1 }],
      main_properties: [{ property_name: "生命值", property_id: 11103, base: "2200", level: 1, add: 0 }],
      equip_suit: { suit_id: 32800, name: "静听嘉音", own: 4 }
    }
  ],
  skills: [{ level: 7, skill_type: 0 }]
}

/** 一位没装驱动盘的代理人：接口照样返回，只是 `equip` 为空 */
const BARE = {
  id: 1021,
  level: 1,
  name_mi18n: "猫又",
  element_type: 200,
  avatar_profession: 1,
  rarity: "S",
  rank: 0,
  equip: [],
  weapon: null,
  skills: [{ level: 1, skill_type: 0 }]
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zzz-serv-"))
  for (const char of [YE_CHAR, ZHAO_CHAR]) {
    const at = join(dir, "meta-zzz", "character", char.name)
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, "data.json"), JSON.stringify(char), "utf8")
  }
  const equipDir = join(dir, "meta-zzz", "equip")
  mkdirSync(equipDir, { recursive: true })
  writeFileSync(join(equipDir, "data.json"), JSON.stringify(EQUIP), "utf8")
  meta = new MetaLoader({ dir, logger: fakeLogger() })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("属性编号对照", () => {
  it("界面序号与系统编号指向同一个词条键", () => {
    expect(zzzPropKey(1)).toBe("hp")
    expect(zzzPropKey(111)).toBe("hp")
    expect(zzzPropKey(5)).toBe("cpct")
    expect(zzzPropKey(201)).toBe("cpct")
    // 冲击力在两套里的序号不同（4 与 122），认错会把它印成攻击力
    expect(zzzPropKey(4)).toBe("impact")
    expect(zzzPropKey(122)).toBe("impact")
  })

  it("装备词条按「系统编号 + 变体位」落到同一个键", () => {
    expect(zzzPropKey(12101)).toBe("atk")
    expect(zzzPropKey(12102)).toBe("atk")
    expect(zzzPropKey(12103)).toBe("atk")
    expect(zzzPropName(21103)).toBe("暴击伤害")
    expect(zzzPropKey(99999)).toBeUndefined()
  })

  it("百分比只看值本身带不带百分号", () => {
    // 末位同为 3，一个是百分比一个是数值 —— 按编号判会把其中一个算错
    expect(isPct("4.8%")).toBe(true)
    expect(isPct("9")).toBe(false)
    expect(propValue("43.4%")).toBeCloseTo(43.4)
    expect(propValue("")).toBe(0)
  })

  it("伤害类型认到子类型那一层", () => {
    expect(zzzElemName(200, 4)).toBe("凄刃")
    expect(zzzElemName(200, 0)).toBe("物理")
    expect(zzzElemName(202, 1)).toBe("烈霜")
    expect(zzzElemName(205, 2)).toBe("玄墨")
    expect(zzzProfName(6)).toBe("命破")
  })
})

describe("parseMysZzz", () => {
  it("认信封也认裸数组", () => {
    const a = parseMysZzz({ avatar_list: [GEARED] }, { meta, uid: "11480862" })
    const b = parseMysZzz([GEARED], { meta, uid: "11480862" })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
  })

  it("不是数组算 error，空数组算 empty", () => {
    expect(parseMysZzz({ retcode: -1 }, { meta, uid: "1" })).toMatchObject({ ok: false, kind: "error" })
    expect(parseMysZzz([], { meta, uid: "1" })).toMatchObject({ ok: false, kind: "empty" })
  })

  it("一件驱动盘都没装的代理人被丢掉；整份都是这样时算 empty", () => {
    const got = parseMysZzz([BARE], { meta, uid: "11480862" })
    expect(got).toMatchObject({ ok: false, kind: "empty" })

    const mixed = parseMysZzz([GEARED, BARE], { meta, uid: "11480862" })
    if (!mixed.ok) throw new Error("应当映射成功")
    expect(Object.keys(mixed.profile.avatars)).toEqual(["1431"])
  })

  it("共用字段填满，故面板库那几道判定认得出它是一份可用面板", () => {
    const got = parseMysZzz([GEARED], { meta, uid: "11480862" })
    if (!got.ok) throw new Error("应当映射成功")
    const one = got.profile.avatars["1431"]
    if (!one) throw new Error("应当有 1431")

    expect(got.profile.game).toBe("zzz")
    expect(got.profile.from).toBe("mysPanelZZZ")
    expect(one.level).toBe(60)
    // 影画数落在共用的 cons 上
    expect(one.cons).toBe(2)
    expect(one.weapon).toMatchObject({ id: 14143, name: "云霓孤光", level: 60, affix: 1 })
    // 六栏技能各有自己的键，不与另两个游戏的 a / e / q 混用
    expect(one.talent).toEqual({ normal: 12, special: 12, dodge: 7, chain: 12, core: 7, assist: 5 })

    /*
     * **驱动盘不折一份进共用的 `artis`。**
     *
     * 那份影子数据没有任何读者（`COMPARE_FIELDS.zzz` 不含 `artis`、装配层不收 zzz），
     * `isPanelReady` 对绝区零查的是 `zzz.discs`。
     */
    expect(one.artis).toBeUndefined()
    expect(one.zzz?.discs.map(it => it.pos)).toEqual([1, 6])
    expect(one.zzz?.discs[0]).toMatchObject({ id: 33541, set: "沧浪行歌", level: 15, rank: "S" })

    // 元数据在位时伤害类型以它为准
    expect(one.elem).toBe("凄刃")
    // 数据源标识写在整份面板上，落库时才逐个补到角色上，故此处照面板库的做法补一次
    expect(isPanelReady({ ...one, from: got.profile.from } as StoredAvatar, "zzz")).toBe(true)
  })

  it("驱动盘副词条的出现次数取自 add 而非 level", () => {
    const got = parseMysZzz([GEARED], { meta, uid: "11480862" })
    if (!got.ok) throw new Error("应当映射成功")
    const discs = got.profile.avatars["1431"]?.zzz?.discs ?? []
    const first = discs[0]
    expect(first).toMatchObject({ pos: 1, level: 15, rank: "S", set: "沧浪行歌", own: 4 })
    expect(first?.main).toMatchObject({ id: 11103, key: "hp", value: "2200" })
    // add 为 1 即出现两次；照 level 取会算成三次，于是评分与「有效词条」都偏高
    expect(first?.subs[0]).toMatchObject({ id: 21103, key: "cdmg", value: "9.6%", rolls: 2, valid: true })
    expect(first?.subs[1]).toMatchObject({ id: 13102, rolls: 3 })
    expect(first?.subs[1]?.valid).toBeUndefined()
    // 按部位升序，接口给的顺序不保证
    expect(discs.map(it => it.pos)).toEqual([1, 6])
  })

  it("属性本地算：hp/atk 的基础列由「角色 + 音擎基础攻击力」定，与真机逐字对上", () => {
    const got = parseMysZzz([GEARED, SYSTEM_ID], { meta, uid: "11480862" })
    if (!got.ok) throw new Error("应当映射成功")

    const a = got.profile.avatars["1431"]?.zzz?.attrs ?? []
    // 十二行固定属性栏，六种属性伤害并成一行 dmgElem
    expect(a.length).toBe(12)
    const hp = a.find(it => it.key === "hp")
    const atk = a.find(it => it.key === "atk")
    // 生命：617 + 837238×59/10000 + 突破 2117 = 7673（截断）；攻击：135 + 82578×59/10000 + 突破 241 + 核心 75 + 音擎基础 743 = 1681
    expect(hp?.base).toBe("7673")
    expect(atk?.base).toBe("1681")
    // 每一行基础 + 加成 = 最终（本地算保证自洽）
    for (const one of a) {
      if (one.base === undefined) continue
      expect(propValue(one.base) + propValue(one.add)).toBeCloseTo(propValue(one.final), 1)
    }

    const b = got.profile.avatars["1341"]?.zzz?.attrs ?? []
    expect(b.length).toBe(12)
    // 照：600 + 800000×59/10000 + 突破 2000 = 7320
    expect(b.find(it => it.key === "hp")?.base).toBe("7320")
  })

  it("暴击率一族是百分比行：固有值落基础、核心技加成落加成", () => {
    const got = parseMysZzz([GEARED], { meta, uid: "11480862" })
    if (!got.ok) throw new Error("应当映射成功")
    const cpct = (got.profile.avatars["1431"]?.zzz?.attrs ?? []).find(it => it.key === "cpct")
    // 面板固有 5% + 核心技 14.4% = 19.4%（夹具无暴击率词条）；百分比行同样拆基础/加成，
    // 否则出图侧把整个最终值印进「初始」那一列、加成恒 +0.0%
    expect(cpct?.final).toBe("19.4%")
    expect(cpct?.base).toBe("5.0%")
    expect(cpct?.add).toBe("14.4%")
  })

  it("攻击力% 乘的是含音擎基础攻击力的基础 —— 折枝剑歌 30% 主词条落到加成上", () => {
    const got = parseMysZzz([GEARED], { meta, uid: "11480862" })
    if (!got.ok) throw new Error("应当映射成功")
    const atk = (got.profile.avatars["1431"]?.zzz?.attrs ?? []).find(it => it.key === "atk")
    // 基础 1681 × 30% ≈ 504（加成里含它）；不含则加成为 0
    expect(propValue(atk?.add)).toBeGreaterThan(400)
    expect(propValue(atk?.final)).toBeGreaterThan(propValue(atk?.base))
  })

  it("音擎主副属性取接口给的成品值 —— 现装的包缺 levelRate、本地按档位算会偏", () => {
    const got = parseMysZzz([GEARED, SYSTEM_ID], { meta, uid: "11480862" })
    if (!got.ok) throw new Error("应当映射成功")
    expect(got.profile.avatars["1431"]?.zzz?.weapon).toMatchObject({
      id: 14143,
      star: 1,
      rank: "S",
      prof: 1,
      main: { id: 12101, name: "基础攻击力", value: "743" },
      sub: { id: 21103, key: "cdmg", value: "48%" }
    })
    // 接口缺 star 时按一层算：没有「零叠影」这一档
    expect(got.profile.avatars["1341"]?.zzz?.weapon?.star).toBe(2)
  })

  it("米游社自己的评分档位去掉 ER_ 前缀；没配养成方案或未评过时两项都缺", () => {
    const got = parseMysZzz([GEARED, SYSTEM_ID], { meta, uid: "11480862" })
    if (!got.ok) throw new Error("应当映射成功")
    expect(got.profile.avatars["1431"]?.zzz).toMatchObject({ mysRating: "S", mysScore: 79.35 })
    expect(got.profile.avatars["1341"]?.zzz?.mysRating).toBeUndefined()
    expect(got.profile.avatars["1341"]?.zzz?.mysScore).toBeUndefined()
  })

  it("ER_Default 是「没评过」而不是一个档位", () => {
    const raw = { ...GEARED, equip_plan_info: { equip_rating: "ER_Default", equip_rating_score: 0 } }
    const got = parseMysZzz([raw], { meta, uid: "11480862" })
    if (!got.ok) throw new Error("应当映射成功")
    expect(got.profile.avatars["1431"]?.zzz?.mysRating).toBeUndefined()

    const plus = { ...GEARED, equip_plan_info: { equip_rating: "ER_S_Plus", equip_rating_score: 80.43 } }
    const two = parseMysZzz([plus], { meta, uid: "11480862" })
    if (!two.ok) throw new Error("应当映射成功")
    expect(two.profile.avatars["1431"]?.zzz?.mysRating).toBe("S+")
  })

  it("元数据不在位时整份回 noMeta —— 属性本地算，出一张空表不如明说要更新", () => {
    const bare = new MetaLoader({ dir: join(dir, "空"), logger: fakeLogger() })
    const got = parseMysZzz([SYSTEM_ID], { meta: bare, uid: "11480862" })
    expect(got).toMatchObject({ ok: false, kind: "noMeta" })
  })
})

describe("源定义", () => {
  it("不发请求，走米游社那条路", () => {
    const one = ZZZ_SOURCES[0]
    expect(one).toMatchObject({ id: "mysPanelZZZ", game: "zzz", fromMys: true })
    expect(one?.url("11480862")).toBe("")
  })

  it("**返回里的官方美术地址一个都不落库** —— 出图一律走已装的元数据", () => {
    const got = parseMysZzz({ avatar_list: [GEARED] }, { meta, uid: "11480862" })
    expect(got.ok).toBe(true)
    if (!got.ok) return

    /*
     * 夹具里那几个地址是真实返回的形态（立绘、方图、立绘主色、音擎图、驱动盘图）。
     * 落库就意味着每次出图都要从外网取十来张图，且那些地址随官方活动改动。
     */
    expect(JSON.stringify(got.profile)).not.toContain("act-webstatic")
    expect(JSON.stringify(got.profile)).not.toContain("#de493e")
  })
})
