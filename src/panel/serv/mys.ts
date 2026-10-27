/**
 * 模块职责：米游社面板源 —— 原神与星铁，数据来自已登录的米游社接口而非第三方展柜
 * 依赖方向：依赖 panel/profile、meta/arti（反推副词条要查档位表）与 serv/types；纯映射
 * 生命周期：无状态，两个源是模块级常量
 * 注意事项：这两个源不发 HTTP（`url` 恒空串、`fromMys` 为真，数据由 service/mys.ts 用 cookie 取来）。米游社不给副词条 id、只给
 *          「属性、强化次数、最终值」，故**反推**一组和最接近的档位（枚举 `档位数^(强化次数+1)`）；**「误差相等取先枚举到的那组」是口径的一部分**，
 *          枚举顺序变则反推的数值变。反推只是近似（未必等于真实强化过程，与 Enka 源可能极小差异）。**天赋等级已含命座加成、必须折算回去**
 *          （见 {@link foldCons}），否则同角色两源天赋等级不同。
 */
import type { ArtiMetaTable } from "../../meta/arti.js"
import type { ArtiSetTable } from "../../meta/arti-set.js"
import { foldCons, type PanelProfile, type ProfileArti, type ProfileAvatar, type ProfileWeapon } from "../profile/index.js"
import { fail, type PanelSource, type ParseDeps, type ProfileResult } from "./types.js"

/** 原神：部位号 → 主词条 `property_type` → 主词条 id */
const GS_MAIN_ID: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "1": { "2": 14001 },
  "2": { "5": 12001 },
  "3": { "3": 10002, "6": 10004, "9": 10006, "23": 10007, "28": 10008 },
  "4": {
    "3": 15002,
    "6": 15004,
    "9": 15006,
    "28": 15007,
    "30": 15015,
    "40": 15008,
    "41": 15009,
    "42": 15011,
    "43": 15014,
    "44": 15012,
    "45": 15013,
    "46": 15010
  },
  "5": { "3": 13002, "6": 13004, "9": 13006, "20": 13007, "22": 13008, "26": 13009, "28": 13010 }
}

/** 原神：`property_type` → 词条键 */
const GS_PROP_KEY: Readonly<Record<string, string>> = {
  "6": "atk",
  "5": "atkPlus",
  "3": "hp",
  "2": "hpPlus",
  "9": "def",
  "8": "defPlus",
  "20": "cpct",
  "22": "cdmg",
  "23": "recharge",
  "28": "mastery"
}

/** 原神：这几个词条给的是点数而非百分比，反推时不必去掉百分号 */
const GS_FIXED = ["hpPlus", "defPlus", "mastery", "atkPlus"]

/** 该角色的普攻等级要减一 */
const A_MINUS_ONE = "10000033"

/**
 * 反推一条副词条的档位组合
 *
 * **枚举顺序与「误差相等取先到者」必须与源实现一致**，否则反推结果不同。
 * @param star 星级
 * @param times 强化次数
 * @param propType 属性类型
 * @param valueText 最终值，形如 `"5.8%"` 或 `"311"`
 * @param table 词条元数据表
 * @returns 档位 id 组合；该属性无档位可用时空数组
 */
export function guessAttrIds(
  star: number,
  times: number,
  propType: string | number,
  valueText: string,
  table: ArtiMetaTable
): number[] {
  const key = GS_PROP_KEY[String(propType)]
  if (!key) return []

  // 百分比词条的文本带百分号，去掉后按比例算；点数词条直接取数
  const want = GS_FIXED.includes(key)
    ? Number.parseFloat(valueText)
    : Number.parseFloat(valueText.slice(0, -1)) * 0.01
  if (Number.isNaN(want)) return []

  // 该星级下该词条的全部档位
  const tiers: { value: number; id: number }[] = []
  for (const [id, cfg] of Object.entries(table.meta("gs").attrIdMap ?? {})) {
    if (!id.startsWith(String(star)) || cfg.key !== key) continue
    tiers.push({ value: Number(cfg.value) || 0, id: Number(id) })
  }
  if (tiers.length === 0) return []

  let bestErr = Number.POSITIVE_INFINITY
  let best: number[] = []
  // 组合数 = 档位数 ^ (强化次数 + 1)，逐个试算
  const slots = Math.max(0, times) + 1
  const idx = new Array<number>(slots).fill(0)

  for (;;) {
    let sum = 0
    const ids: number[] = []
    for (let i = 0; i < slots; i++) {
      const tier = tiers[idx[i] ?? 0]
      if (!tier) break
      sum += tier.value
      ids.push(tier.id)
    }
    const err = Math.abs(want - sum)
    // 严格小于：误差相等时保留先枚举到的那组
    if (err < bestErr) {
      bestErr = err
      best = ids
    }

    // 进位，末位最快变化 —— 这个顺序即上面所说的枚举次序，不可改
    let carry = slots - 1
    while (carry >= 0) {
      const next = (idx[carry] ?? 0) + 1
      if (next < tiers.length) {
        idx[carry] = next
        break
      }
      idx[carry] = 0
      carry--
    }
    if (carry < 0) break
  }

  return best
}

/** 米游社原神返回里一个角色 */
interface MysAvatar {
  /** 基础信息 */
  base?: {
    /** 角色 id */
    id?: number | string
    /** 元素 */
    element?: string
    /** 等级 */
    level?: number
    /** 好感度 */
    fetter?: number
    /** 已激活命座数 */
    actived_constellation_num?: number
  }
  /** 武器 */
  weapon?: {
    /** id */
    id?: number | string
    /** 名称 */
    name?: string
    /** 等级 */
    level?: number
    /** 突破 */
    promote_level?: number
    /** 精炼 */
    affix_level?: number
  }
  /** 时装 */
  costumes?: { id?: number | string }[]
  /** 圣遗物 */
  relics?: {
    /** 部位号 */
    pos?: number
    /** 套装 id */
    id?: number | string
    /** 强化等级 */
    level?: number
    /** 星级 */
    rarity?: number
    /** 主词条 */
    main_property?: { property_type?: number | string }
    /** 副词条 */
    sub_property_list?: {
      /** 属性类型 */
      property_type?: number | string
      /** 最终值 */
      value?: string
      /** 强化次数 */
      times?: number
    }[]
  }[]
  /** 技能 */
  skills?: {
    /** 技能 id */
    skill_id?: number | string
    /** 等级 */
    level?: number
    /** 技能类别，1 为主动技能 */
    skill_type?: number
  }[]
}

/**
 * 映射米游社原神的技能列表
 *
 * **只有 `skill_type === 1` 才走兜底键**：米游社把固有天赋也放进同一数组，一并按顺序取会让普攻/战技/爆发错位。
 * @param skills 技能列表
 * @param talentId 技能 id → 天赋键
 * @returns 天赋等级
 */
function mapMysTalent(
  skills: readonly NonNullable<MysAvatar["skills"]>[number][],
  talentId: Readonly<Record<string, string>>
): Record<string, number> {
  const out: Record<string, number> = {}
  const fallback = ["a", "e", "q"] as const
  let idx = 0
  for (const one of skills) {
    const named = talentId[String(one.skill_id)]
    if (named) {
      out[named] = Number(one.level) || 0
      continue
    }
    if (one.skill_type !== 1) continue
    const key = fallback[idx]
    idx++
    if (!key) continue
    out[key] ??= Number(one.level) || 0
  }
  return out
}

/**
 * 映射米游社原神的返回
 * @param data 返回，形如 `{ avatars: [...] }`
 * @param deps 外部依赖
 * @param table 词条元数据表，反推副词条要用
 * @returns 映射结果
 */
export function parseMysGs(data: unknown, deps: ParseDeps, table: ArtiMetaTable): ProfileResult {
  const list = (data as { avatars?: MysAvatar[]; list?: MysAvatar[] } | null)?.avatars
    ?? (data as { list?: MysAvatar[] } | null)?.list
  if (!Array.isArray(list)) return fail("error")
  if (list.length === 0) return fail("empty")

  const profile: PanelProfile = { game: "gs", uid: deps.uid, avatars: {}, from: "mysPanel" }

  for (const one of list) {
    const base = one.base ?? {}
    if (base.id === undefined) continue
    const id = String(base.id)
    const detail = deps.meta.detail("gs", id)
    const cons = Number(base.actived_constellation_num) || 0

    const talent = foldCons(mapMysTalent(one.skills ?? [], detail?.talentId ?? {}), cons, detail ?? {})
    // 该角色的普攻等级在米游社侧多算了一级
    if (id === A_MINUS_ONE && talent.a !== undefined) talent.a -= 1

    const avatar: ProfileAvatar = {
      id,
      level: Number(base.level) || 0,
      cons,
      talent,
      artis: mapMysArtis(one.relics ?? [], deps, table)
    }
    if (base.fetter !== undefined) avatar.fetter = Number(base.fetter) || 0
    // 米游社给的是首字母大写英文（`Cryo`），内部元素键一律小写；不归一则装配层按元素匹配时对不上，
    // 元素伤害杯被当异元素（diffelem）而非本元素（dmg），伤害加成栏少一个杯、该杯评分也偏低
    if (base.element) avatar.elem = String(base.element).toLowerCase()
    else {
      const elem = deps.meta.byId("gs", id)?.elem
      if (elem) avatar.elem = elem
    }
    const costume = one.costumes?.[0]?.id
    if (costume !== undefined) avatar.costume = Number(costume) || 0

    if (one.weapon) {
      const w = one.weapon
      const weapon: ProfileWeapon = {
        level: Number(w.level) || 0,
        promote: Number(w.promote_level) || 0,
        affix: Number(w.affix_level) || 1
      }
      const name = w.id === undefined ? undefined : deps.meta.byId("gs", w.id)?.name
      if (name ?? w.name) weapon.name = name ?? w.name
      if (w.id !== undefined) weapon.id = w.id
      avatar.weapon = weapon
    }

    profile.avatars[id] = avatar
  }

  if (Object.keys(profile.avatars).length === 0) return fail("empty")
  return { ok: true, profile, cd: 60 }
}

/**
 * 映射米游社原神的圣遗物
 * @param relics 圣遗物列表
 * @param deps 外部依赖
 * @param table 词条元数据表
 * @returns 部位号 → 圣遗物
 */
function mapMysArtis(
  relics: readonly NonNullable<MysAvatar["relics"]>[number][],
  deps: ParseDeps,
  table: ArtiMetaTable
): Record<string, ProfileArti> {
  const out: Record<string, ProfileArti> = {}
  for (const one of relics) {
    const idx = Number(one.pos) || 0
    if (!idx) continue
    const star = Number(one.rarity) || 5
    const arti: ProfileArti = {
      level: Math.min(20, Number(one.level) || 0),
      star
    }
    // **只记 id、不在这里查名字**：圣遗物名称与套装在 `ArtiSetTable`，本层只拿得到 `MetaLoader`（用它查恒 undefined），由装配器据 id 查
    if (one.id !== undefined) arti.id = one.id

    const mainType = one.main_property?.property_type
    const mainId = mainType === undefined ? undefined : GS_MAIN_ID[String(idx)]?.[String(mainType)]
    if (mainId !== undefined) arti.mainId = mainId

    const ids: number[] = []
    for (const sub of one.sub_property_list ?? []) {
      if (sub.property_type === undefined || sub.value === undefined) continue
      ids.push(...guessAttrIds(star, Number(sub.times) || 0, sub.property_type, sub.value, table))
    }
    if (ids.length > 0) arti.attrIds = ids
    out[String(idx)] = arti
  }
  return out
}

/** 米游社星铁：`property_type` → 词条键 */
const SR_PROP_KEY: Readonly<Record<string, string>> = {
  "1": "hpPlus",
  "2": "atkPlus",
  "3": "defPlus",
  "4": "speed",
  "5": "cpct",
  "6": "cdmg",
  "7": "heal",
  "9": "recharge",
  "10": "effPct",
  "11": "effDef",
  "12": "phy",
  "14": "fire",
  "16": "ice",
  "18": "elec",
  "20": "wind",
  "22": "quantum",
  "24": "imaginary",
  "32": "hp",
  "33": "atk",
  "34": "def",
  "58": "stance",
  // 同一属性作主词条时另有一套编号
  "51": "speed",
  "52": "cpct",
  "53": "cdmg",
  "27": "hpPlus",
  "29": "atkPlus",
  "31": "defPlus",
  "54": "recharge",
  "55": "heal",
  "56": "effPct",
  "57": "effDef",
  "59": "stance"
}

/**
 * 取米游社星铁的词条键
 * @param propType 属性类型
 * @returns 词条键；不认得时 undefined
 */
export function srPropKey(propType: string | number): string | undefined {
  return SR_PROP_KEY[String(propType)]
}

/** 米游社星铁：技能中文名 → 天赋键 */
const SR_TALENT_KEY: Readonly<Record<string, string>> = {
  普攻: "a",
  战技: "e",
  终结技: "q",
  天赋: "t",
  秘技: "z",
  忆灵技: "me",
  忆灵天赋: "mt",
  欢愉技: "j"
}

/**
 * 命座对各天赋的加成级数
 *
 * **与原神「一律减 3」不同**：星铁逐键不同，欢愉技还随星魂数变。
 * @param cons 星魂数
 * @returns 天赋键 → 该键要减掉的级数
 */
function srConsBonus(cons: number): Readonly<Record<string, number>> {
  return { a: 1, e: 2, q: 2, t: 2, me: 1, mt: 1, j: cons > 4 ? 2 : 1 }
}

/** 米游社星铁返回里一个技能 */
interface SrSkill {
  /** 技能中文名 */
  remake?: string
  /** 等级 */
  level?: number
  /** 节点 id */
  point_id?: number | string
  /** 节点类别，奇数为行迹加点 */
  point_type?: number
}

/** 米游社星铁返回里一个角色 */
interface MysSrAvatar {
  /** 角色 id */
  id?: number | string
  /** 等级 */
  level?: number
  /** 星魂数 */
  rank?: number
  /** 光锥 */
  equip?: {
    /** id */
    id?: number | string
    /** 等级 */
    level?: number
    /** 叠影 */
    rank?: number
  }
  /** 技能树，天赋与行迹混在一起 */
  skills?: SrSkill[]
  /** 额外技能节点 */
  special_skills?: SrSkill[]
  /** 忆灵 */
  servant_detail?: {
    /** 忆灵技能 */
    servant_skills?: SrSkill[]
  }
  /** 遗器 */
  relics?: MysSrRelic[]
  /** 位面饰品，与遗器同形态 */
  ornaments?: MysSrRelic[]
}

/** 米游社星铁返回里一件遗器 */
interface MysSrRelic {
  /** 部位号 */
  pos?: number
  /** 遗器 id */
  id?: number | string
  /** 强化等级 */
  level?: number
  /** 星级 */
  rarity?: number
  /** 主词条 */
  main_property?: { property_type?: number | string }
  /** 副词条 */
  properties?: {
    /** 属性类型 */
    property_type?: number | string
    /** 最终值 */
    value?: string
    /** 强化次数 */
    times?: number
  }[]
}

/**
 * 映射米游社星铁的技能列表
 *
 * **判据是中文名而非 id**：接口给的 `remake` 就是「普攻」「战技」这样的中文；忆灵技能另在 `servant_detail` 里，要并进同一表。
 * @param skills 技能列表
 * @param servant 忆灵技能列表
 * @param cons 星魂数
 * @param talentCons 元数据里的"天赋键 → 生效星魂号"
 * @returns 天赋等级
 */
export function mapMysSrTalent(
  skills: readonly SrSkill[],
  servant: readonly SrSkill[],
  cons: number,
  talentCons: Readonly<Record<string, string | number>>
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const one of [...skills, ...servant]) {
    const key = SR_TALENT_KEY[one.remake ?? ""]
    if (key) out[key] = Number(one.level) || 0
  }

  if (cons < 3) return out
  const bonus = srConsBonus(cons)
  for (const [key, at] of Object.entries(talentCons)) {
    const level = Number(at)
    if (Number.isNaN(level) || level === 0) continue
    if (out[key] === undefined || cons < level) continue
    out[key] = Math.max(1, (out[key] ?? 0) - (bonus[key] ?? 0))
  }
  return out
}

/**
 * 取已激活的行迹节点
 *
 * **判据是 `point_type` 为奇数**（偶数是天赋，已由 {@link mapMysSrTalent} 取走）；按 `point_id` 排序使顺序稳定。
 * @param skills 技能树
 * @param special 额外节点
 * @returns 行迹节点 id
 */
export function mysSrTrees(skills: readonly SrSkill[], special: readonly SrSkill[]): string[] {
  return [...skills, ...special]
    .filter(it => (Number(it.point_type) || 0) % 2 !== 0)
    .map(it => String(it.point_id ?? ""))
    .filter(it => it !== "")
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0))
}

/**
 * 反推星铁一条副词条的档位
 *
 * **与原神不同，星铁不必枚举**：档位基数与步进已知，直接算「几档 + 几个步进」。
 * **速度那一条要另算档数**：米游社给的强化次数对速度不准，按「最终值 ÷ 基数」反推，否则速度算少而它决定出手顺序。
 * @param key 词条键
 * @param base 单档基数
 * @param step 步进
 * @param times 强化次数
 * @param propertyId 档位 id
 * @param valueText 最终值
 * @returns `"id,档数,步进数"` 形态的字符串
 */
export function srAttrId(
  key: string,
  base: number,
  step: number,
  times: number,
  propertyId: string,
  valueText: string
): string {
  // parseFloat 忽略尾部百分号，故百分比与点数走同一条路
  const want = Number.parseFloat(valueText)
  let count = Math.max(0, Number(times) || 0)
  if (key === "speed" && base > 0) count = Math.floor(want / base) || 1
  const steps = step > 0 ? Math.ceil((want - count * base) / step) : 0
  return `${propertyId},${count},${steps}`
}

/**
 * 映射米游社星铁的返回
 *
 * **一处未落地，如实记下**：此后本应有一段「速度校正」（拿算出的面板速度与 `properties[3].final` 比、差超 0.2 逐条加步进），
 * 它依赖已算好的面板属性，待属性计算层就位后再补；缺它星铁速度可能比游戏内少零点几点，不影响其余词条。
 * @param data 返回，形如 `{ avatar_list: [...] }`
 * @param deps 外部依赖
 * @param sets 套装表，星级档位表在它那里
 * @returns 映射结果
 */
export function parseMysSr(data: unknown, deps: ParseDeps, sets: ArtiSetTable): ProfileResult {
  const raw = data as { avatar_list?: MysSrAvatar[]; list?: MysSrAvatar[] } | null
  const list = raw?.avatar_list ?? raw?.list
  if (!Array.isArray(list)) return fail("error")
  if (list.length === 0) return fail("empty")

  const meta = sets.srMeta("sr")
  const profile: PanelProfile = { game: "sr", uid: deps.uid, avatars: {}, from: "mysPanelHSR" }

  for (const one of list) {
    if (one.id === undefined) continue
    const id = String(one.id)
    const detail = deps.meta.detail("sr", id)
    const cons = Number(one.rank) || 0
    const skills = one.skills ?? []
    const special = one.special_skills ?? []

    const avatar: ProfileAvatar = {
      id,
      level: Number(one.level) || 0,
      cons,
      talent: mapMysSrTalent(skills, one.servant_detail?.servant_skills ?? [], cons, detail?.talentCons ?? {}),
      trees: mysSrTrees(skills, special),
      artis: mapMysSrArtis([...(one.relics ?? []), ...(one.ornaments ?? [])], meta)
    }
    const elem = deps.meta.byId("sr", id)?.elem
    if (elem) avatar.elem = elem
    if (one.equip) {
      const weapon: ProfileWeapon = {
        level: Number(one.equip.level) || 0,
        affix: Number(one.equip.rank) || 1
      }
      if (one.equip.id !== undefined) weapon.id = one.equip.id
      const name = one.equip.id === undefined ? undefined : deps.meta.byId("sr", one.equip.id)?.name
      if (name) weapon.name = name
      avatar.weapon = weapon
    }

    profile.avatars[id] = avatar
  }

  if (Object.keys(profile.avatars).length === 0) return fail("empty")
  return { ok: true, profile, cd: 60 }
}

/**
 * 映射米游社星铁的遗器
 * @param relics 遗器与位面饰品
 * @param meta 星级档位表；缺失时词条留空
 * @returns 部位号 → 遗器
 */
function mapMysSrArtis(
  relics: readonly MysSrRelic[],
  meta: ReturnType<ArtiSetTable["srMeta"]>
): Record<string, ProfileArti> {
  const out: Record<string, ProfileArti> = {}
  for (const one of relics) {
    const idx = Number(one.pos) || 0
    if (!idx) continue
    const star = Number(one.rarity) || 5
    const arti: ProfileArti = {
      // 星铁遗器满级 15
      level: Math.min(15, Number(one.level) || 0),
      star
    }
    if (one.id !== undefined) arti.id = one.id

    const starCfg = meta?.starData[String(star)]
    const mainType = one.main_property?.property_type
    const mainKey = mainType === undefined ? undefined : SR_PROP_KEY[String(mainType)]
    if (mainKey && meta) {
      // mainIdx 是"id → 键"，此处要反查，故遍历
      const found = Object.entries(meta.mainIdx[String(idx)] ?? {}).find(([, key]) => key === mainKey)
      if (found) arti.mainId = found[0]
    }

    const ids: string[] = []
    for (const sub of one.properties ?? []) {
      const key = SR_PROP_KEY[String(sub.property_type)]
      if (!key || sub.value === undefined || !starCfg) continue
      const tier = Object.entries(starCfg.sub).find(([, cfg]) => cfg.key === key)
      if (!tier) continue
      ids.push(srAttrId(key, tier[1].base, tier[1].step, Number(sub.times) || 0, tier[0], sub.value))
    }
    if (ids.length > 0) arti.attrIds = ids
    out[String(idx)] = arti
  }
  return out
}

/**
 * 造两个米游社面板源
 * @param table 词条元数据表，原神反推副词条要用
 * @param sets 套装表，星铁的星级档位表在它那里
 * @returns 面板源
 */
export function makeMysSources(table: ArtiMetaTable, sets: ArtiSetTable): readonly PanelSource[] {
  return [
    {
      id: "mysPanel",
      name: "米游社",
      game: "gs",
      fromMys: true,
      url: () => "",
      parse: (raw, deps) => parseMysGs(raw, deps, table)
    },
    {
      id: "mysPanelHSR",
      name: "米游社",
      game: "sr",
      fromMys: true,
      url: () => "",
      parse: (raw, deps) => parseMysSr(raw, deps, sets)
    }
  ]
}
