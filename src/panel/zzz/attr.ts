/**
 * 模块职责：绝区零属性本地计算 —— 基础 + 成长 + 突破 + 核心技 + 音擎 + 驱动盘 + 套装二件
 * 依赖方向：依赖 meta/loader（读代理人 / 音擎基础数据、套装二件）与 panel/prop/zzz（编号对照）；纯计算，不发请求
 * 生命周期：无状态
 * 注意事项：**两个面板源共用这一套**（Enka 只给原始档位、米游社的成品值也不用，一律本地算），差别只在「驱动盘那份加成从哪来」——
 *          各源自己把驱动盘映射成 {@link ZzzAdd} 列表再交进来。角色 / 音擎 / 核心技 / 套装二件三源同源、全读元数据。
 *          **音擎属性算的是突破阶（源给了用源的，缺省 {@link breakOf} 按等级推 0~5）查 `stars`，不是叠影**；混淆会把 lv60 主属性从 684 算成 478。
 *          `attr` / 核心技里暴击率一族是放大一百倍的百分点（{@link CENTI_CAT}），落库要除 100；中文词条名三种写法都要收（{@link NAME_TO_CAT}），少收一种那条加成整条丢失且无迹象。
 */
import type { MetaLoader } from "../../meta/loader.js"
import { ZZZ_ELEM_DMG_ID, ZZZ_PANEL_ATTRS, ZZZ_PROP_NAME, propValue, zzzPropKey, type ZzzPropKey } from "../prop/zzz.js"
import type { ZzzAttr, ZzzWeapon } from "../profile/index.js"

/** 一条加成：`[三位编号, 值, 是否百分比]` */
export type ZzzAdd = [number, number, boolean]

/** 一位代理人 data.json 的基础数据块 */
export interface ZzzCharDetail {
  /** 基础值 + 成长 */
  attr?: Record<string, number>
  /** 突破阶 → 加成 */
  promote?: Record<string, { hp_max?: number; attack?: number; defence?: number; level_min?: number }>
  /** 核心技档 → 加成（中文词条名 → 值） */
  core?: Record<string, { add?: Record<string, string> }>
}

/** 一把音擎 data.json 的属性数据 */
export interface ZzzWeaponDetail {
  /** 主属性（基础攻击力等） */
  base?: { name?: string; value?: number; pct?: boolean }
  /** 高级属性 */
  sub?: { name?: string; value?: number; pct?: boolean }
  /** 主属性每级成长率，下标即等级 */
  levelRate?: number[]
  /** 突破阶 → 成长率与副属性率 */
  stars?: Record<string, { star_rate?: number; rand_rate?: number }>
}

/**
 * 代理人 `attr` 键 → 三位属性编号（系统编号）
 *
 * 只列基础数据块里出现的那些；伤害加成一族基础恒 0，不在此。
 */
const ATTR_TO_CAT: Readonly<Record<string, number>> = {
  hp_max: 111,
  attack: 121,
  defence: 131,
  break_stun: 122,
  crit: 201,
  crit_damage: 211,
  pen_ratio: 231,
  sp_recover: 305,
  element_mystery: 312,
  element_abnormal_power: 314
}

/** 那几项 `attr` 是"放大一百倍的百分数"（暴击率/暴击伤害/穿透率/能量自动回复），落库要除 100 */
const CENTI_CAT: ReadonlySet<number> = new Set([201, 211, 231, 305])

/**
 * 中文词条名 → 三位属性编号；核心技加成、套装二件、音擎属性都按名查
 *
 * **三种写法都要收**：裸名（`攻击力`）、带「基础」前缀（核心技那份用）、带「百分比」后缀（音擎副属性那份用）。
 * 少收一种那条加成会被**整条丢掉**且无迹象。
 */
const NAME_TO_CAT: Readonly<Record<string, number>> = {
  基础生命值: 111,
  生命值: 111,
  生命值百分比: 111,
  基础攻击力: 121,
  攻击力: 121,
  攻击力百分比: 121,
  基础防御力: 131,
  防御力: 131,
  防御力百分比: 131,
  冲击力: 122,
  冲击力百分比: 122,
  基础冲击力: 122,
  暴击率: 201,
  暴击伤害: 211,
  穿透率: 231,
  穿透值: 232,
  能量自动回复: 305,
  基础能量自动回复: 305,
  能量自动回复百分比: 305,
  异常精通: 312,
  基础异常精通: 312,
  异常掌控: 314,
  物理伤害: 315,
  火属性伤害: 316,
  冰属性伤害: 317,
  电属性伤害: 318,
  以太伤害: 319,
  风属性伤害: 323
}

/**
 * 那几个三位编号是百分比属性（本身即以百分比呈现），加成时直接加而非乘基础
 *
 * 含风伤 323。**不含能量自动回复 305**（显示成 `1.20` 而非百分数，见 {@link zzzFmt}）、**不含异常掌控 314 / 异常精通 312**（整数）。
 */
export const PCT_CAT: ReadonlySet<number> = new Set([201, 211, 231, 315, 316, 317, 318, 319, 323])

/** 稀有度 → 驱动盘主词条每级成长率 */
export const RARITY_MAIN_RATE: Readonly<Record<string, number>> = { S: 0.2, A: 0.25, B: 0.3 }

/**
 * 取一个数
 * @param v 值
 * @returns 数；非数字为 0
 */
export function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * 判一个装备词条值是不是百分比：值本身带 `%`
 * @param v 值
 * @returns 是则真
 */
export function pctVal(v: string): boolean {
  return v.trimEnd().endsWith("%")
}

/**
 * 中文词条名 → 三位属性编号
 * @param name 词条名
 * @returns 编号；认不出时 0
 */
export function catOfName(name: string): number {
  return NAME_TO_CAT[name] ?? 0
}

/** 面板栏键 → 三位编号 */
function catOfKey(key: string): number {
  const map: Record<string, number> = {
    hp: 111, atk: 121, def: 131, impact: 122, cpct: 201, cdmg: 211,
    am: 314, ap: 312, pen: 231, er: 305, penVal: 232
  }
  return map[key] ?? 0
}

/**
 * 按属性类别格式化成米游社那种字符串
 *
 * 百分比属性存的是百分点（`18` 即 18%），故补 `%`；能量自动回复（305）显示成两位小数的每秒值（`1.20`）；其余取整。
 * @param cat 三位属性编号
 * @param value 数值
 * @param pct 是否百分比属性
 * @returns 展示字符串
 */
export function zzzFmt(cat: number, value: number, pct: boolean): string {
  if (cat === 305) return value.toFixed(2)
  if (pct) return `${value.toFixed(1)}%`
  return String(Math.trunc(value))
}

/**
 * 按等级推突破阶（0~5）
 *
 * 突破阶决定音擎 `stars` 查哪一档、代理人 `promote` 取哪一档。与米游社口径一致（真机验通）：等级每上一个十位坎才多一阶。
 * @param level 等级
 * @returns 突破阶
 */
export function breakOf(level: number): number {
  return Math.min(5, Math.max(0, Math.ceil(level / 10) - 1))
}

/** 一份基础属性映射：三位编号 → 数值 */
type BaseMap = Record<number, number>

/**
 * 按等级取突破阶加成
 *
 * 与米游社口径一致：按 `level > level_min` 取最大的那一档（已用真机数据验通）。
 * @param detail 代理人基础数据
 * @param level 等级
 * @returns 该阶的 hp / atk / def 加成
 */
function promoteBonus(detail: ZzzCharDetail, level: number): { hp: number; atk: number; def: number } {
  let hit: { hp_max?: number; attack?: number; defence?: number } = {}
  for (const [, one] of Object.entries(detail.promote ?? {})) {
    if (level > num(one.level_min)) hit = one
  }
  return { hp: num(hit.hp_max), atk: num(hit.attack), def: num(hit.defence) }
}

/**
 * 算一位代理人的基础属性（含成长、突破、核心技的**数值**加成，不含音擎与装备）
 *
 * 与米游社面板 `base` 一栏同口径。核心技里带百分号的那种（如攻击力%）不落在这里，由 {@link coreScaleAdds} 作乘区加成处理。
 * @param detail 代理人基础数据
 * @param level 等级
 * @param coreKey 核心技档键（`core` 表的键）
 * @returns 三位编号 → 基础值
 */
export function charBaseMap(detail: ZzzCharDetail, level: number, coreKey: string): BaseMap {
  const attr = detail.attr ?? {}
  const base: BaseMap = {}
  for (const [key, cat] of Object.entries(ATTR_TO_CAT)) {
    const raw = num(attr[key])
    if (raw !== 0 || key === "hp_max" || key === "attack" || key === "defence") {
      base[cat] = CENTI_CAT.has(cat) ? raw / 100 : raw
    }
  }
  // 成长：hp / atk / def 逐级增长，成长值已 ×10000
  const grow: [number, string][] = [[111, "hp_growth"], [121, "attack_growth"], [131, "defence_growth"]]
  for (const [cat, gk] of grow) base[cat] = num(base[cat]) + (num(attr[gk]) * (level - 1)) / 10000
  // 突破
  const pr = promoteBonus(detail, level)
  base[111] = num(base[111]) + pr.hp
  base[121] = num(base[121]) + pr.atk
  base[131] = num(base[131]) + pr.def
  // 核心技的数值加成（带百分号的另行处理）；**放大一百倍存的要跟着除 100**（CENTI_CAT），
  // 与 `attr` 同刻度，`基础能量自动回复: "24"` 是 +0.24 而非 +24，漏了会把耀嘉音能量自动回复由 1.94 印成 34.02
  for (const [name, val] of Object.entries(detail.core?.[coreKey]?.add ?? {})) {
    if (pctVal(String(val))) continue
    const cat = NAME_TO_CAT[name]
    if (cat) base[cat] = num(base[cat]) + (CENTI_CAT.has(cat) ? num(val) / 100 : num(val))
  }
  return base
}

/**
 * 核心技里带百分号的加成（如某些代理人核心技给「攻击力+X%」）
 * @param detail 代理人基础数据
 * @param coreKey 核心技档键
 * @returns 加成条目
 */
export function coreScaleAdds(detail: ZzzCharDetail, coreKey: string): ZzzAdd[] {
  const out: ZzzAdd[] = []
  for (const [name, val] of Object.entries(detail.core?.[coreKey]?.add ?? {})) {
    if (!pctVal(String(val))) continue
    const cat = NAME_TO_CAT[name]
    // 值形如 `14.4%`，`num` 会得 NaN，故用 propValue 取百分号前的数
    if (cat) out.push([cat, propValue(val), true])
  }
  return out
}

/**
 * 算音擎的主副属性
 *
 * 主属性 = 基础 ×(1 + (levelRate[等级] + stars[突破].star_rate)/10000)；副属性 = 基础 ×(1 + stars[突破].rand_rate/10000)。
 * @param detail 音擎基础数据
 * @param level 等级
 * @param brk 突破阶；源给了就用源的，缺省按等级推 —— 整十级那一档突破前后同级，按等级推一律当未突破
 * @returns 主副属性；数据不全时相应项缺省
 */
export function weaponStats(
  detail: ZzzWeaponDetail,
  level: number,
  brk: number = breakOf(level)
): { main?: { cat: number; value: number }; sub?: { cat: number; value: number; pct: boolean } } {
  const stars = detail.stars?.[String(brk)] ?? {}
  const out: { main?: { cat: number; value: number }; sub?: { cat: number; value: number; pct: boolean } } = {}
  if (detail.base?.name && detail.base.value !== undefined) {
    const cat = NAME_TO_CAT[detail.base.name]
    if (cat) {
      const rate = num(detail.levelRate?.[level]) + num(stars.star_rate)
      out.main = { cat, value: num(detail.base.value) * (1 + rate / 10000) }
    }
  }
  /*
   * 副属性**一律是百分比**，且包里存的是放大一百倍的百分点（真机四把逐字验通，突破阶按等级推）。
   * 故**不看包里的 `pct` 字段**（现装的包根本没有，照它判会把每条副属性当数值：幻变魔方「+25% 攻击」变「+2500 点攻击」）。
   */
  if (detail.sub?.name && detail.sub.value !== undefined) {
    const cat = NAME_TO_CAT[detail.sub.name]
    if (cat) {
      const raw = (num(detail.sub.value) * (1 + num(stars.rand_rate) / 10000)) / 100
      out.sub = { cat, value: raw, pct: true }
    }
  }
  return out
}

/**
 * 从二件套文案解出加成
 *
 * 文案形如 `暴击率+8%。` / `<nobr>火属性伤害</nobr>+10%。` / `异常精通+30点。` / `生命值+10%`（末尾句号可有可无）。
 * **只收「属性名+数值」这一种**：`[普通攻击]造成的伤害提升15%`、`施加的护盾值提升15%` 这类条件或非面板加成不进属性栏，词条名认不出即跳过。
 * @param text 二件套文案
 * @returns 加成条目；解不出时空
 */
export function set2AddsOfText(text: string): ZzzAdd[] {
  const plain = text.replace(/<[^>]*>/g, "").trim()
  const hit = /^([^+\s]+)\+(\d+(?:\.\d+)?)(%|点)?[。.]?$/.exec(plain)
  if (!hit) return []
  const cat = catOfName(hit[1] ?? "")
  if (!cat) return []
  return [[cat, num(hit[2]), hit[3] === "%"]]
}

/**
 * 读一份套装的二件加成
 *
 * 优先读 `set2`（造包脚本从二件套文案解出、落在 `equip/data.json`）；**现装的包没有这一项**，此时退回现解 `skills["2"]` 文案（{@link set2AddsOfText}）。
 * 两路都产出**百分点**（`10%` 记 10），与驱动盘词条同刻度，由 {@link aggregate} 统一乘基础或直接加。
 * **经装载器取、本函数不碰文件系统**：装载器装载时已把每条塞进详情缓存，此处问它即得。
 * @param meta 元数据装载器
 * @param setId 套装 id
 * @returns 加成条目
 */
export function set2Adds(meta: MetaLoader, setId: number): ZzzAdd[] {
  const table = meta.detail("zzz", setId) as
    | { set2?: { id?: number; value?: string }[]; skills?: Record<string, string> }
    | undefined
  if (!table?.set2) return set2AddsOfText(table?.skills?.["2"] ?? "")
  const out: ZzzAdd[] = []
  for (const one of table.set2) {
    if (one.id === undefined || one.value === undefined) continue
    const cat = Math.trunc(num(one.id) / 100)
    // 值形如 `10%` / `30`，`num` 对带百分号的会得 NaN，故用 propValue
    out.push([cat, propValue(one.value), pctVal(String(one.value))])
  }
  return out
}

/**
 * 把基础值与各路加成汇总成属性栏
 *
 * 汇总规则：百分比加成乘基础、数值加成直接加，随后 base+add=final。六种属性伤害加成只留该代理人自己那一种，并成一行（`dmgElem`）。
 * @param base 基础值映射
 * @param adds 各路加成
 * @param elemId 属性类型编号，决定留哪一种伤害加成
 * @returns 属性栏
 */
export function aggregate(base: BaseMap, adds: readonly ZzzAdd[], elemId: number): ZzzAttr[] {
  const addFlat: Record<number, number> = {}
  const addPct: Record<number, number> = {}
  for (const [cat, val, pct] of adds) {
    if (pct && !PCT_CAT.has(cat)) addPct[cat] = num(addPct[cat]) + val
    else addFlat[cat] = num(addFlat[cat]) + val
  }
  // 该代理人自己那一种伤害加成的编号（三位）
  const dmgCat = Math.trunc(num(ZZZ_ELEM_DMG_ID[String(elemId)]) / 100)

  const rows: ZzzAttr[] = []
  for (const [key, name] of Object.entries(ZZZ_PANEL_ATTRS)) {
    // 属性伤害加成那一行取该代理人的那一种
    const cat = key === "dmgElem" ? dmgCat : catOfKey(key)
    if (!cat) {
      rows.push({ key: key as ZzzPropKey, name, final: "0.0%" })
      continue
    }
    const b = num(base[cat])
    const flat = num(addFlat[cat])
    const scaled = (num(addPct[cat]) / 100) * b
    const add = flat + scaled
    const pct = PCT_CAT.has(cat)
    const final = b + add
    const row: ZzzAttr = { name, final: zzzFmt(cat, final, pct) }
    const pk = zzzPropKey(cat)
    if (key === "dmgElem") row.key = "dmgElem" as ZzzPropKey
    else if (pk) row.key = pk
    /*
     * 三栏都给：`base` 是白值（代理人固有 + 核心技数值加成），`add` 是装备与百分比加成那一截。
     * **百分比属性同样要拆**（暴击伤害固有 50%、暴击率固有 5%）：只给 `final` 会让出图侧把整个
     * 最终值印进「初始」那一列、加成恒显示 +0.0%。
     */
    row.base = zzzFmt(cat, b, pct)
    row.add = zzzFmt(cat, add, pct)
    rows.push(row)
  }
  return rows
}

/** 组装一位代理人属性所需的输入 */
export interface ZzzAttrInput {
  /** 代理人基础数据 */
  char: ZzzCharDetail
  /** 等级 */
  level: number
  /**
   * 核心技**档位**，0~6（0 即未强化、一份加成都不给）
   *
   * **收的是档位而非接口等级**：元数据 `core` 表的键是 1~6 六档，而米游社接口给的核心技等级是 1~7
   * （1 表示未强化），差一档。换算落在各源（米游社 `等级-1`、Enka 的 `CoreSkillEnhancement` 本就是档位），
   * 错一档不报错、只让每位都多吃一档加成。
   */
  coreLevel: number
  /** 属性类型编号 */
  elemId: number
  /**
   * 直接加进基础值那一列的加成 `[三位编号, 值]`
   *
   * 音擎的基础攻击力落这里而非 {@link adds}：攻击力% 乘的是「角色基础 + 音擎基础攻击力」，落进 adds 会少乘一截。
   */
  baseAdds?: readonly [number, number][]
  /** 百分比 / 数值加成：驱动盘主副词条、音擎副属性、核心技百分比（源各按自己的原始形态算） */
  adds: readonly ZzzAdd[]
  /** 已装 ≥2 件的套装 id，用来取二件加成 */
  activeSetIds: readonly number[]
  /** 元数据装载器，取套装二件 */
  meta: MetaLoader
}

/**
 * 算一位代理人的完整属性栏
 *
 * 两个面板源共用：角色基础 / 核心技 / 套装二件读元数据，音擎与驱动盘那份加成由各源按自己的原始形态算好交进来
 * （Enka 从元数据档位算、米游社取接口给的成品值 —— 两源唯一的差别在此）。
 * @param input 组装输入
 * @returns 属性栏
 */
export function computeZzzAttrs(input: ZzzAttrInput): { attrs: ZzzAttr[] } {
  // **下界是 0 而非 1**：0 即未强化，`core` 表没有 `"0"` 这一档故一份加成都不给。夹到 1 会让每位未强化的都凭空多一档
  const coreKey = String(Math.min(6, Math.max(0, num(input.coreLevel))))
  const base = charBaseMap(input.char, num(input.level), coreKey)
  for (const [cat, val] of input.baseAdds ?? []) base[cat] = num(base[cat]) + val

  const adds: ZzzAdd[] = [...coreScaleAdds(input.char, coreKey), ...input.adds]
  for (const setId of input.activeSetIds) adds.push(...set2Adds(input.meta, setId))

  return { attrs: aggregate(base, adds, input.elemId) }
}

/**
 * 把本地算出的音擎主副属性拼成 {@link ZzzWeapon}
 * @param opts 音擎标识与算出的主副属性
 * @returns 音擎块
 */
export function buildZzzWeapon(opts: {
  /** 音擎 id */
  id: number
  /** 音擎名 */
  name: string
  /** 等级 */
  level: number
  /** 叠影，1~5 */
  star: number
  /** 元数据里的星级，4→S、其余→A */
  metaStar?: number
  /** 主属性 */
  main?: { cat: number; value: number }
  /** 副属性 */
  sub?: { cat: number; value: number; pct: boolean }
}): ZzzWeapon {
  const mainKey = opts.main ? zzzPropKey(opts.main.cat) : undefined
  const subKey = opts.sub ? zzzPropKey(opts.sub.cat) : undefined
  return {
    id: opts.id,
    name: opts.name,
    level: opts.level,
    star: Math.max(1, opts.star),
    rank: opts.metaStar ? (["", "", "B", "A", "S", "S"][opts.metaStar] ?? "S") : "S",
    ...(opts.main && mainKey
      ? { main: { id: opts.main.cat * 100 + 1, key: mainKey, name: ZZZ_PROP_NAME[mainKey], value: zzzFmt(opts.main.cat, opts.main.value, false), rolls: 1 } }
      : {}),
    ...(opts.sub && subKey
      ? { sub: { id: opts.sub.cat * 100 + 2, key: subKey, name: ZZZ_PROP_NAME[subKey], value: zzzFmt(opts.sub.cat, opts.sub.value, opts.sub.pct), rolls: 1 } }
      : {})
  }
}

