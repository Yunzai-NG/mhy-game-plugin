/**
 * 模块职责：Enka 绝区零展柜源 —— 取 `enka.network/api/zzz/uid/<uid>`，把原始档位喂给本地计算层
 * 依赖方向：依赖 panel/zzz/attr（本地属性计算，与米游社源共用）、panel/profile 与 meta/loader
 * 生命周期：无状态，源是模块级常量
 * 注意事项：属性计算全在 {@link computeZzzAttrs}（见 panel/zzz/attr.ts），本层只把 Enka 的原始形态映射进去。
 *          **Enka 只给单次副词条值**，故要乘出现次数 `PropertyLevel`；米游社源那边给的已是总值（两源差别只在这一处）。
 *          **核心技 `CoreSkillEnhancement` 本就是档位号（0~6），原样交进去**：米游社那一路给的是等级 1~7 故要减一，此处不减。多减一档不报错、只让每位少吃一档加成。
 */
import {
  buildZzzWeapon,
  computeZzzAttrs,
  num,
  weaponStats,
  zzzFmt,
  PCT_CAT,
  RARITY_MAIN_RATE,
  type ZzzAdd,
  type ZzzCharDetail,
  type ZzzWeaponDetail
} from "../zzz/attr.js"
import type { MetaLoader } from "../../meta/loader.js"
import type { PanelProfile, ProfileAvatar, ProfileWeapon } from "../profile/index.js"
import { type ZzzAttr, type ZzzAvatarDetail, type ZzzDisc, type ZzzGearAttr, type ZzzWeapon, zzzProfName } from "../profile/index.js"
import { ZZZ_PROP_NAME, zzzPropKey } from "../prop/zzz.js"
import { fail, ttlOf, type PanelSource, type ParseDeps, type ProfileResult } from "./types.js"

/** Enka 返回里的一条装备词条 */
interface EnkaProp {
  /** 属性编号，五位（如 `11103`） */
  PropertyId: number
  /** 基础值（每次出现的量，或主词条 +0 级的值） */
  PropertyValue: number
  /** 出现次数，副词条用；主词条恒 0 或 1 */
  PropertyLevel: number
}

/** Enka 返回里的一件驱动盘 */
interface EnkaEquip {
  /** 部位，1~6 */
  Slot: number
  /** 装备本体 */
  Equipment?: {
    /** 驱动盘 id */
    Id: number
    /** 强化等级 */
    Level: number
    /** 主词条 */
    MainPropertyList?: EnkaProp[]
    /** 副词条 */
    RandomPropertyList?: EnkaProp[]
  }
}

/** Enka 返回里的音擎 */
interface EnkaWeapon {
  /** 音擎 id */
  Id: number
  /** 等级 */
  Level: number
  /** 叠影（精炼），1~5 */
  UpgradeLevel?: number
  /** 突破阶，0~5 —— **音擎属性算的是它，不是叠影** */
  BreakLevel?: number
}

/** Enka 返回里的一位代理人 */
interface EnkaAvatar {
  /** 代理人 id */
  Id: number
  /** 等级 */
  Level: number
  /** 突破阶（Enka 给的，本层仍按等级推以与米游社口径一致） */
  PromotionLevel?: number
  /** 影画数 */
  TalentLevel?: number
  /** 核心技档，0~6（A~F） */
  CoreSkillEnhancement?: number
  /** 技能等级表 */
  SkillLevelList?: { Index: number; Level: number }[]
  /** 音擎 */
  Weapon?: EnkaWeapon | null
  /** 六件驱动盘 */
  EquippedList?: EnkaEquip[]
}

/** Enka zzz 接口的返回 */
interface EnkaZzzResp {
  /** 玩家信息 */
  PlayerInfo?: {
    /** 昵称、等级与头像 id（`ProfileId` 即 pfps 索引里那个键） */
    SocialDetail?: { ProfileDetail?: { Nickname?: string; Level?: number; ProfileId?: number | string } }
    /** 展柜 */
    ShowcaseDetail?: { AvatarList?: EnkaAvatar[] }
  }
  /** 缓存有效期 */
  ttl?: number
}

/**
 * 判一条 Enka 装备词条是不是百分比形态
 *
 * **两个判据缺一不可，只看三位编号会把 ATK% 当数值加**：五位编号末两位是形态位（`…02` 百分比、`…03` 数值），
 * 生命/攻击/防御/冲击四项两种形态都有且共用三位编号；而暴击率/暴击伤害/穿透率与六种属性伤害只有百分比一种、末两位却写 `03`，那一族靠三位编号认。
 * 判错非差一点：真机里 `12102`（攻击 +6%）被当成 +600 攻击，叶瞬光攻击从 2726 印成 6075。与米游社源判据不同（那边值带 `%` 按字符串判，Enka 给裸数字只能靠编号）。
 * @param propertyId 五位属性编号
 * @returns 是百分比形态则真
 */
function enkaPctProp(propertyId: number): boolean {
  return propertyId % 100 === 2 || PCT_CAT.has(Math.trunc(propertyId / 100))
}

/**
 * 把 Enka 的一件驱动盘算成 {@link ZzzDisc} 与它对总属性的加成
 *
 * 主词条值 = 基础值 ×(1 + 等级 × 稀有度率)；副词条值 = 基础值 × 出现次数（Enka 给的是**单次**值，故要乘）。
 * @param equip Enka 的一件驱动盘
 * @param meta 元数据装载器，查套装名
 * @returns 驱动盘与它对总属性的加成；无本体时 undefined
 */
function mapDisc(equip: EnkaEquip, meta: MetaLoader): { disc: ZzzDisc; adds: ZzzAdd[] } | undefined {
  const e = equip.Equipment
  if (!e?.Id) return undefined
  const pos = num(equip.Slot)
  // 稀有度取 id 第四位：4→S、3→A、2→B
  const rarity = ({ "4": "S", "3": "A", "2": "B" } as Record<string, string>)[String(e.Id)[3] ?? ""] ?? "S"
  const rate = RARITY_MAIN_RATE[rarity] ?? 0.2
  const setId = Number(`${String(e.Id).slice(0, 3)}00`)
  const setItem = meta.byId("zzz", setId)
  const adds: ZzzAdd[] = []

  /**
   * 把一条原始词条算成展示形态，并登记它对总属性的加成
   * @param p 原始词条
   * @param isMain 是不是主词条
   * @returns 展示形态；空词条时 undefined
   */
  const gear = (p: EnkaProp | undefined, isMain: boolean): ZzzGearAttr | undefined => {
    if (!p?.PropertyId) return undefined
    const cat = Math.trunc(p.PropertyId / 100)
    const key = zzzPropKey(p.PropertyId)
    const pct = enkaPctProp(p.PropertyId)
    const rolls = isMain ? 1 : Math.max(1, num(p.PropertyLevel))
    const raw = isMain ? p.PropertyValue * (1 + num(e.Level) * rate) : p.PropertyValue * rolls
    // 源站把百分数放大一百倍存（`300` 即 3%）
    const value = pct ? raw / 100 : raw
    adds.push([cat, value, pct])
    return {
      id: p.PropertyId,
      ...(key ? { key } : {}),
      name: key ? ZZZ_PROP_NAME[key] : "",
      value: zzzFmt(cat, value, pct),
      rolls
    }
  }

  const main = gear(e.MainPropertyList?.[0], true)
  const subs = (e.RandomPropertyList ?? []).map(p => gear(p, false)).filter((it): it is ZzzGearAttr => !!it)
  const disc: ZzzDisc = {
    id: num(e.Id),
    name: setItem?.name ? `${setItem.name}[${pos}]` : `[${pos}]`,
    pos,
    level: num(e.Level),
    rank: rarity,
    ...(main ? { main } : {}),
    subs,
    ...(setItem?.name ? { set: setItem.name, setId } : {})
  }
  return { disc, adds }
}

/**
 * 算一位代理人的完整属性栏、驱动盘与音擎（导出供测试）
 *
 * 属性计算交给 {@link computeZzzAttrs}，本函数只把 Enka 的原始驱动盘 / 音擎映射进去。
 * @param avatar Enka 的一位代理人
 * @param char 代理人基础数据
 * @param weaponDetail 音擎基础数据（可空）
 * @param meta 元数据装载器
 * @param elemId 属性类型编号
 * @returns 属性栏与映射好的驱动盘 / 音擎
 */
export function computeZzzPanel(
  avatar: EnkaAvatar,
  char: ZzzCharDetail,
  weaponDetail: ZzzWeaponDetail | undefined,
  meta: MetaLoader,
  elemId: number
): { attrs: ZzzAttr[]; discs: ZzzDisc[]; weapon?: ZzzWeapon } {
  // 六件驱动盘 + 套装件数
  const discs: ZzzDisc[] = []
  const discAdds: ZzzAdd[] = []
  const suitCount = new Map<number, number>()
  for (const equip of avatar.EquippedList ?? []) {
    const got = mapDisc(equip, meta)
    if (!got) continue
    discs.push(got.disc)
    discAdds.push(...got.adds)
    if (got.disc.setId) suitCount.set(got.disc.setId, (suitCount.get(got.disc.setId) ?? 0) + 1)
  }
  discs.sort((a, b) => a.pos - b.pos)
  for (const disc of discs) {
    if (disc.setId) disc.own = suitCount.get(disc.setId)
  }
  const activeSetIds = [...suitCount].filter(([, own]) => own >= 2).map(([setId]) => setId)

  // 音擎主副属性从元数据档位算（Enka 只给原始档位）；主属性（基础攻击力）落基础列、副属性入加成
  const w = avatar.Weapon
  const brk = w?.BreakLevel === undefined ? undefined : num(w.BreakLevel)
  const st = w?.Id && weaponDetail ? weaponStats(weaponDetail, num(w.Level), brk) : {}
  const baseAdds: [number, number][] = st.main ? [[st.main.cat, st.main.value]] : []
  if (st.sub) discAdds.push([st.sub.cat, st.sub.value, st.sub.pct])

  const got = computeZzzAttrs({
    char,
    level: num(avatar.Level),
    coreLevel: num(avatar.CoreSkillEnhancement),
    elemId,
    baseAdds,
    adds: discAdds,
    activeSetIds,
    meta
  })

  let weapon: ZzzWeapon | undefined
  if (w?.Id && weaponDetail) {
    const item = meta.byId("zzz", w.Id)
    weapon = buildZzzWeapon({
      id: num(w.Id),
      name: item?.name ?? "",
      level: num(w.Level),
      star: num(w.UpgradeLevel),
      ...(item?.star ? { metaStar: item.star } : {}),
      ...(st.main ? { main: st.main } : {}),
      ...(st.sub ? { sub: st.sub } : {})
    })
  }

  return { attrs: got.attrs, discs, ...(weapon ? { weapon } : {}) }
}

/** Enka 的技能序号 → 天赋键，与米游社源 `SKILL_KEY` 同一套含义 */
const SKILL_KEY: Readonly<Record<string, string>> = {
  "0": "normal",
  "1": "special",
  "2": "dodge",
  "3": "chain",
  "5": "core",
  "6": "assist"
}

/**
 * 把 Enka 的一位代理人映射成统一形态
 * @param avatar Enka 代理人
 * @param deps 外部依赖
 * @returns 统一形态；缺元数据或没装驱动盘时 undefined
 */
function mapAvatar(avatar: EnkaAvatar, deps: ParseDeps): ProfileAvatar | undefined {
  if (!avatar.Id) return undefined
  const id = String(avatar.Id)
  const item = deps.meta.byId("zzz", id)
  const char = deps.meta.detail("zzz", id) as ZzzCharDetail | undefined
  // 元数据缺这一位就算不出属性，跳过而不是出一张全 0 的图
  if (!item || !char?.attr) return undefined

  const elemId = num((char as { elemId?: number }).elemId) || elemIdOf(item.elem)
  const weaponDetail = avatar.Weapon?.Id ? (deps.meta.detail("zzz", avatar.Weapon.Id) as ZzzWeaponDetail | undefined) : undefined
  const { attrs, discs, weapon } = computeZzzPanel(avatar, char, weaponDetail, deps.meta, elemId)
  if (discs.length === 0) return undefined

  const talent: Record<string, number> = {}
  for (const skill of avatar.SkillLevelList ?? []) {
    const key = SKILL_KEY[String(skill.Index)]
    if (key) talent[key] = num(skill.Level)
  }

  const detail: ZzzAvatarDetail = {
    name: item.name,
    rank: item.star === 4 ? "S" : "A",
    ...(zzzProfName(item.prof) ? { prof: zzzProfName(item.prof) } : {}),
    ...(elemId ? { elemId } : {}),
    attrs,
    ...(weapon ? { weapon } : {}),
    discs
  }

  const avatarOut: ProfileAvatar = {
    id,
    level: num(avatar.Level),
    cons: num(avatar.TalentLevel),
    talent,
    zzz: detail
  }
  if (item.elem) avatarOut.elem = item.elem
  if (weapon) {
    const shared: ProfileWeapon = { id: weapon.id, name: weapon.name, level: weapon.level, affix: weapon.star }
    avatarOut.weapon = shared
  }
  return avatarOut
}

/** 属性类型中文名 → 编号，元数据 `elem` 存的是中文（冰/电/物理…） */
function elemIdOf(elem: string | undefined): number {
  const map: Record<string, number> = { 物理: 200, 火: 201, 冰: 202, 电: 203, 风: 204, 以太: 205 }
  return elem ? (map[elem] ?? 0) : 0
}

/**
 * 映射 Enka 绝区零的返回
 * @param data 返回
 * @param deps 外部依赖
 * @returns 映射结果
 */
export function parseEnkaZzz(data: unknown, deps: ParseDeps): ProfileResult {
  const resp = data as EnkaZzzResp | null
  const list = resp?.PlayerInfo?.ShowcaseDetail?.AvatarList
  if (!Array.isArray(list)) return fail("error")
  if (list.length === 0) return fail("empty")

  const who = resp?.PlayerInfo?.SocialDetail?.ProfileDetail
  const level = Number(who?.Level) || 0
  const profile: PanelProfile = {
    game: "zzz",
    uid: deps.uid,
    avatars: {},
    from: "enkaZZZ",
    ...(who?.Nickname ? { name: who.Nickname } : {}),
    ...(level > 0 ? { level } : {}),
    ...(who?.ProfileId !== undefined ? { pfp: who.ProfileId } : {})
  }
  for (const one of list) {
    const avatar = mapAvatar(one, deps)
    if (avatar) profile.avatars[avatar.id] = avatar
  }
  if (Object.keys(profile.avatars).length === 0) return fail("empty")
  return { ok: true, profile, cd: ttlOf(data) }
}

/** Enka 绝区零展柜源 */
export const ENKA_ZZZ_SOURCES: readonly PanelSource[] = [
  {
    id: "enkaZZZ",
    name: "Enka 展柜",
    game: "zzz",
    url: (uid: string) => `https://enka.network/api/zzz/uid/${uid}`,
    parse: parseEnkaZzz
  }
]
