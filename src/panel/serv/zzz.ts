/**
 * 模块职责：米游社绝区零面板源 —— 把 `avatar/info` 的返回映射成统一形态，属性本地计算
 * 依赖方向：依赖 panel/zzz/attr（本地属性计算，与 Enka 源共用）、panel/profile 与 panel/prop/zzz；纯映射
 * 生命周期：无状态，源是模块级常量
 * 注意事项：不发 HTTP（`url` 恒空串、`fromMys` 为真，数据由取数那层用 cookie 取来）。**属性不取接口的 `final`、一律本地算**：
 *          角色 / 音擎 / 核心技 / 套装二件读元数据，驱动盘那份加成取接口给的词条（玩家自己抽的、算不出来）。**接口给的副词条 `base` 已是总值**
 *          （出现两次的 4.8% 记成 9.6%），与 Enka 的单次值不同 —— 那是两源唯一的差别，见 {@link discAddsOf}。
 *          **缺元数据即算不出属性**，此时整份回 `noMeta`（提示先更新元数据），而非出一张全 0 的图。
 *          共用字段要填满：音擎落 `weapon`、技能落 `talent`、驱动盘落 `artis`，否则 `isPanelReady` 判不出可用。
 */
import {
  computeZzzAttrs,
  type ZzzAdd,
  type ZzzCharDetail
} from "../zzz/attr.js"
import { type PanelProfile, type ProfileAvatar } from "../profile/index.js"
import { isPct, propValue, zzzPropKey, zzzPropName } from "../prop/zzz.js"
import {
  type ZzzAvatarDetail,
  type ZzzDisc,
  type ZzzGearAttr,
  type ZzzWeapon,
  zzzProfName
} from "../profile/index.js"
import { fail, type PanelSource, type ParseDeps, type ProfileResult } from "./types.js"

/**
 * 技能类别 → 天赋键
 *
 * `skill_type` 即游戏内六栏顺序。键取英文缩写而不沿用另两游戏的 `a`/`e`/`q`（六栏与四栏不是一回事，同名会让模板取错）。
 */
const SKILL_KEY: Readonly<Record<string, string>> = {
  "0": "normal",
  "1": "special",
  "2": "dodge",
  "3": "chain",
  "5": "core",
  "6": "assist"
}

/**
 * 米游社给的评分档位 → 展示形态
 *
 * `ER_Default` 是「没有评分」而非档位（总与 `equip_rating_score` 为 0 同现），映射成空串由调用方丢掉；
 * 不少代理人没有这一项，故只当「有则多印一行」而非评分本身。
 */
const MYS_RATING: Readonly<Record<string, string>> = {
  ER_SS: "SS",
  ER_S_Plus: "S+",
  ER_S: "S",
  ER_A: "A",
  ER_B: "B",
  ER_C: "C",
  ER_Default: ""
}

/** 返回里的一条属性 */
interface RawProp {
  /** 中文名 */
  property_name?: string
  /** 属性编号 */
  property_id?: number | string
  /** 基础值 */
  base?: string
  /** 加成值 */
  add?: string | number
  /** 最终值 */
  final?: string
  /** 出现次数减一，装备副词条用 */
  level?: number
  /** 是否为有效词条 */
  valid?: boolean
}

/** 返回里的一件驱动盘 */
interface RawEquip {
  /** 驱动盘 id */
  id?: number | string
  /** 名称 */
  name?: string
  /** 强化等级 */
  level?: number
  /** 稀有度 */
  rarity?: string
  /** 部位，1~6 */
  equipment_type?: number
  /** 副词条 */
  properties?: RawProp[]
  /** 主词条 */
  main_properties?: RawProp[]
  /** 套装 */
  equip_suit?: {
    /** 套装 id */
    suit_id?: number | string
    /** 套装名 */
    name?: string
    /** 已装几件 */
    own?: number
  }
}

/** 返回里的音擎 */
interface RawWeapon {
  /** 音擎 id */
  id?: number | string
  /** 名称 */
  name?: string
  /** 等级 */
  level?: number
  /** 叠影 */
  star?: number
  /** 稀有度 */
  rarity?: string
  /** 适配职业 */
  profession?: number
  /** 高级属性 */
  properties?: RawProp[]
  /** 主属性 */
  main_properties?: RawProp[]
}

/** 返回里的一个代理人 */
interface RawAvatar {
  /** 代理人 id */
  id?: number | string
  /** 等级 */
  level?: number
  /** 名称 */
  name_mi18n?: string
  /** 全名 */
  full_name_mi18n?: string
  /** 属性类型 */
  element_type?: number
  /** 属性子类型 */
  sub_element_type?: number
  /** 阵营 */
  camp_name_mi18n?: string
  /** 职业 */
  avatar_profession?: number
  /** 稀有度 */
  rarity?: string
  /** 已解锁影画数 */
  rank?: number
  /** 驱动盘 */
  equip?: RawEquip[]
  /** 音擎 */
  weapon?: RawWeapon | null
  /** 总属性 */
  properties?: RawProp[]
  /** 技能 */
  skills?: { level?: number; skill_type?: number }[]
  /** 养成方案，配过才有；米游社自己的评分在里面 */
  equip_plan_info?: {
    /** 评分档位，形如 `ER_S` */
    equip_rating?: string
    /** 评分分数 */
    equip_rating_score?: number
  } | null
}

/**
 * 映射一条装备词条
 * @param one 返回里的属性
 * @returns 词条；缺编号或缺值时 undefined
 */
function gearAttr(one: RawProp | undefined): ZzzGearAttr | undefined {
  if (!one?.property_id || one.base === undefined) return undefined
  const id = Number(one.property_id) || 0
  const key = zzzPropKey(id)
  // 出现次数：`add` 是「多出来的次数」，故加一即总次数；旧版返回缺它时按 `level` 取
  const rolls = one.add === undefined ? Math.max(1, Number(one.level) || 1) : (Number(one.add) || 0) + 1
  return {
    id,
    ...(key ? { key } : {}),
    name: one.property_name ?? zzzPropName(id),
    value: one.base,
    rolls,
    ...(one.valid ? { valid: true } : {})
  }
}

/**
 * 映射一件驱动盘
 * @param one 返回里的驱动盘
 * @returns 驱动盘；缺部位时 undefined
 */
function mapDisc(one: RawEquip): ZzzDisc | undefined {
  const pos = Number(one.equipment_type) || 0
  if (!pos) return undefined
  const main = gearAttr(one.main_properties?.[0])
  const subs = (one.properties ?? []).map(gearAttr).filter((it): it is ZzzGearAttr => !!it)
  const suit = one.equip_suit
  return {
    id: Number(one.id) || 0,
    name: one.name ?? "",
    pos,
    level: Number(one.level) || 0,
    rank: one.rarity ?? "S",
    ...(main ? { main } : {}),
    subs,
    ...(suit?.name ? { set: suit.name } : {}),
    ...(suit?.suit_id ? { setId: Number(suit.suit_id) || 0 } : {}),
    ...(suit?.own === undefined ? {} : { own: Number(suit.own) || 0 })
  }
}

/**
 * 映射音擎，主副属性取自接口
 *
 * **音擎属性直接取接口给的成品值**：那是玩家装上的音擎的实际数值（属「装配」而非要本地推的总属性），
 * 且现装的元数据包缺 `levelRate`、本地按档位算主属性会偏几百点。展示与并入计算都用这一份。
 * @param one 返回里的音擎
 * @returns 音擎；没装时 undefined
 */
function mapWeapon(one: RawWeapon | null | undefined): ZzzWeapon | undefined {
  if (!one?.id) return undefined
  const main = gearAttr(one.main_properties?.[0])
  const sub = gearAttr(one.properties?.[0])
  return {
    id: Number(one.id) || 0,
    name: one.name ?? "",
    level: Number(one.level) || 0,
    // 叠影至少一层：没有「零叠影」这一档，接口给 0 时那是缺字段而非真的没有
    star: Math.max(1, Number(one.star) || 1),
    rank: one.rarity ?? "S",
    ...(one.profession === undefined ? {} : { prof: Number(one.profession) || 0 }),
    ...(main ? { main } : {}),
    ...(sub ? { sub } : {})
  }
}

/**
 * 判一条词条是不是「基础值」那一档（五位编号末两位 `01`）
 *
 * 音擎主属性 `12101` 是基础攻击力，要落进基础一列（攻击力% 乘的是含它的基础），不是加成。判漏会让 ATK% 少乘一截。
 * @param id 词条编号
 * @returns 是基础值时为真
 */
function isBaseStat(id: number): boolean {
  const text = String(id)
  return text.length === 5 && text.slice(3) === "01"
}

/**
 * 一件驱动盘的词条对总属性的加成
 *
 * **接口的副词条 `base` 已是总值**（出现两次的 4.8% 记成 9.6%），故直接取、不乘出现次数 —— 这与 Enka 给单次值不同。
 * @param disc 已映射的驱动盘
 * @returns 加成条目
 */
export function discAddsOf(disc: ZzzDisc): ZzzAdd[] {
  const out: ZzzAdd[] = []
  const push = (attr: ZzzGearAttr | undefined): void => {
    if (!attr) return
    out.push([Math.trunc(attr.id / 100), propValue(attr.value), isPct(attr.value)])
  }
  push(disc.main)
  for (const sub of disc.subs) push(sub)
  return out
}

/**
 * 一把音擎的词条对总属性的加成
 *
 * 主属性若是基础值那一档（`…01`）落进基础列（{@link ZzzAttrInput.baseAdds}），否则连副属性一并作加成。
 * @param weapon 已映射的音擎
 * @returns 基础列加成与百分比/数值加成
 */
export function weaponAddsOf(weapon: ZzzWeapon | undefined): { baseAdds: [number, number][]; adds: ZzzAdd[] } {
  const baseAdds: [number, number][] = []
  const adds: ZzzAdd[] = []
  const main = weapon?.main
  if (main) {
    const cat = Math.trunc(main.id / 100)
    if (isBaseStat(main.id)) baseAdds.push([cat, propValue(main.value)])
    else adds.push([cat, propValue(main.value), isPct(main.value)])
  }
  const sub = weapon?.sub
  if (sub) adds.push([Math.trunc(sub.id / 100), propValue(sub.value), isPct(sub.value)])
  return { baseAdds, adds }
}

/**
 * 映射一个代理人
 *
 * 属性本地算（见文件头），故必须有该代理人的元数据 —— 缺则整份回 {@link parseMysZzz} 的 `noMeta`。
 * @param one 返回里的代理人
 * @param deps 外部依赖
 * @returns 统一形态；缺 id / 缺元数据 / 没装驱动盘时 undefined
 */
function mapAvatar(one: RawAvatar, deps: ParseDeps): ProfileAvatar | undefined {
  if (one.id === undefined) return undefined
  const id = String(one.id)
  const char = deps.meta.detail("zzz", id) as ZzzCharDetail | undefined
  // 缺这一位的元数据就算不出属性；由 parseMysZzz 先统一判 ready，此处再兜一层
  if (!char?.attr) return undefined

  const discs = (one.equip ?? []).map(mapDisc).filter((it): it is ZzzDisc => !!it)
  discs.sort((a, b) => a.pos - b.pos)
  // 一件驱动盘都没装即不算有面板：出图等于一张只有等级的空表
  if (discs.length === 0) return undefined

  const talent: Record<string, number> = {}
  for (const skill of one.skills ?? []) {
    const key = SKILL_KEY[String(skill.skill_type)]
    if (key) talent[key] = Number(skill.level) || 0
  }

  const item = deps.meta.byId("zzz", id)
  const elemId = Number(one.element_type) || elemIdOf(item?.elem)
  const weapon = mapWeapon(one.weapon)
  const wa = weaponAddsOf(weapon)
  const suitCount = new Map<number, number>()
  for (const disc of discs) {
    if (disc.setId) suitCount.set(disc.setId, (suitCount.get(disc.setId) ?? 0) + 1)
  }
  const activeSetIds = [...suitCount].filter(([, own]) => own >= 2).map(([setId]) => setId)

  const computed = computeZzzAttrs({
    char,
    level: Number(one.level) || 0,
    // 接口给的核心技等级是 1~7（1 即未强化），元数据 `core` 表的键是 1~6 六档，故减一
    coreLevel: (talent["core"] ?? 0) - 1,
    elemId,
    baseAdds: wa.baseAdds,
    adds: [...discs.flatMap(discAddsOf), ...wa.adds],
    activeSetIds,
    meta: deps.meta
  })
  const rating = MYS_RATING[one.equip_plan_info?.equip_rating ?? ""] ?? ""
  const score = propValue(one.equip_plan_info?.equip_rating_score)
  const detail: ZzzAvatarDetail = {
    name: one.name_mi18n ?? item?.name ?? "",
    ...(one.full_name_mi18n ? { fullName: one.full_name_mi18n } : {}),
    rank: one.rarity ?? "A",
    ...(zzzProfName(one.avatar_profession) ? { prof: zzzProfName(one.avatar_profession) } : {}),
    ...(one.camp_name_mi18n ? { camp: one.camp_name_mi18n } : {}),
    ...(elemId ? { elemId } : {}),
    attrs: computed.attrs,
    ...(weapon ? { weapon } : {}),
    discs,
    // 档位与分数同时有才算取到了：`ER_Default` 与 0 分是「这一位没评过」的表达
    ...(rating && score > 0 ? { mysRating: rating, mysScore: score } : {})
  }

  const avatar: ProfileAvatar = {
    id,
    level: Number(one.level) || 0,
    cons: Number(one.rank) || 0,
    talent,
    zzz: detail
  }
  // 元数据在位时以它的伤害类型为准（子类型分支它已折算过），否则用接口给的编号
  if (item?.elem) avatar.elem = item.elem
  if (weapon) {
    avatar.weapon = { id: weapon.id, name: weapon.name, level: weapon.level, affix: weapon.star }
  }
  return avatar
}

/** 属性类型中文名 → 编号，元数据 `elem` 存的是中文（冰/电/物理…） */
function elemIdOf(elem: string | undefined): number {
  const map: Record<string, number> = { 物理: 200, 火: 201, 冰: 202, 电: 203, 风: 204, 以太: 205 }
  return elem ? (map[elem] ?? 0) : 0
}

/**
 * 映射米游社绝区零的返回
 * @param data 返回，形如 `{ avatar_list: [...] }`；也认直接给数组的形态
 * @param deps 外部依赖
 * @returns 映射结果
 */
export function parseMysZzz(data: unknown, deps: ParseDeps): ProfileResult {
  const raw = data as { avatar_list?: RawAvatar[]; list?: RawAvatar[] } | RawAvatar[] | null
  const list = Array.isArray(raw) ? raw : (raw?.avatar_list ?? raw?.list)
  if (!Array.isArray(list)) return fail("error")
  if (list.length === 0) return fail("empty")
  // 属性本地算，缺元数据这一步做不了 —— 明说要更新元数据，而非出一张空表
  if (!deps.meta.ready("zzz")) return fail("noMeta")

  const profile: PanelProfile = { game: "zzz", uid: deps.uid, avatars: {}, from: "mysPanelZZZ" }
  for (const one of list) {
    const avatar = mapAvatar(one, deps)
    if (avatar) profile.avatars[avatar.id] = avatar
  }

  if (Object.keys(profile.avatars).length === 0) return fail("empty")
  return { ok: true, profile, cd: 60 }
}

/** 米游社绝区零面板源 */
export const ZZZ_SOURCES: readonly PanelSource[] = [
  {
    id: "mysPanelZZZ",
    name: "米游社",
    game: "zzz",
    fromMys: true,
    url: () => "",
    parse: parseMysZzz
  }
]
