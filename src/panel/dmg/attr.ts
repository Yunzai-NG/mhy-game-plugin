/**
 * 模块职责：伤害计算的属性层 —— 把 buff 折进一份属性表，供公式层取用
 * 依赖方向：依赖 dmg/meta（数值表）与 dmg/mastery；由沙箱求值出的 buff 由调用方传入
 * 生命周期：无状态纯函数
 * 注意事项：**每条伤害详情都要从同一份基准属性重新折算，折算前做一次深拷（{@link cloneAttr}）**，少了它第二条会带着第一条的 buff、表现为「倍率越靠后伤害越高」且不报错。
 *          **属性值公式是 `base + plus + base × pct / 100`**（百分比只作用于 base）：写成 `(base+plus)×(1+pct/100)` 会让面板攻击偏高（武器副词条与小攻击进 plus、不该被大攻击百分比再乘）。
 *          **buff 键名靠正则分派、次序不可换**（技能→欢愉→基础四项→其余属性→敌人→反应→超击破），改次序会让键落错桶而不报错。**`xxxBase` 要补一次静态百分比**，否则胡桃 E 一类「基于生命提攻击」会少一大块。
 */
import type { AttrGame } from "../attr.js"
import { ELE_BASE_DMG, baseDmgAt } from "./meta.js"
import { masteryBasePct, masteryMultiple } from "./mastery.js"

/** 一项可累加的属性 */
export interface AttrItem {
  /** 基础值 */
  base: number
  /** 加成值，不受百分比影响 */
  plus: number
  /** 百分比加成，只作用于 base */
  pct: number
  /** 提高：护盾增效与治疗增效走它 */
  inc: number
}

/** 一项技能加成 */
export interface SkillItem {
  /** 倍率加成 */
  pct: number
  /** 独立倍率乘区 */
  multi: number
  /** 伤害值提高 */
  plus: number
  /** 伤害提高 */
  dmg: number
  /** 承受伤害提高 */
  enemydmg: number
  /** 暴击率提高 */
  cpct: number
  /** 爆伤提高 */
  cdmg: number
  /** 擢升 */
  elevated: number
  /** 防御降低 */
  def: number
  /** 无视防御 */
  ignore: number
}

/** 敌方相关 */
export interface EnemyItem {
  /** 降低防御 */
  def: number
  /** 无视防御 */
  ignore: number
  /** 物理防御 */
  phy: number
}

/** 一份折算好的伤害属性表 */
export interface DmgAttrTable {
  /** 逐属性的可累加项 */
  [key: string]: unknown
}

/** 原神的属性键 */
const GS_ATTRS = ["mastery", "recharge", "cpct", "cdmg", "heal", "dmg", "phy", "diffelem"] as const

/** 星铁的属性键 */
const SR_ATTRS = [
  "speed",
  "recharge",
  "cpct",
  "cdmg",
  "heal",
  "dmg",
  "enemydmg",
  "effPct",
  "effDef",
  "stance"
] as const

/** 原神的技能键 */
const GS_SKILLS = ["a", "a2", "a3", "e", "q", "nightsoul"] as const

/** 星铁的技能键 */
const SR_SKILLS = [
  "a",
  "a2",
  "a3",
  "e",
  "e2",
  "q",
  "q2",
  "t",
  "me",
  "me2",
  "mt",
  "mt2",
  "j",
  "j2",
  "as",
  "dot",
  "break"
] as const

/** 原神的反应与反应修正键，缺省全为 0 */
const GS_REACTIONS = [
  "elevated",
  "vaporize",
  "melt",
  "burning",
  "crystallize",
  "superConduct",
  "swirl",
  "electroCharged",
  "shatter",
  "overloaded",
  "bloom",
  "burgeon",
  "hyperBloom",
  "aggravate",
  "spread",
  "lunarCharged",
  "lunarBloom",
  "lunarCrystallize",
  "stellarConduct",
  "stellarSwirl",
  "stellarVortex",
  "fykx",
  "fyplus",
  "fypct",
  "fycdmg"
] as const

/**
 * 可由 buff 直接累加的反应键
 *
 * 与 {@link GS_REACTIONS} 大致相同，但**多出 `kx` 与 `multi` 两项**（那两个不是反应而是
 * 可累加的乘区）。两张表刻意各写一份：前者定的是"属性表里要建哪些键"，这一张定的是
 * "buff 里写了这个键就直接累加"，用途不同，合并只会让日后改一处而伤到另一处。
 */
const ADDABLE = new Set([
  "vaporize",
  "melt",
  "crystallize",
  "burning",
  "superConduct",
  "swirl",
  "electroCharged",
  "shatter",
  "overloaded",
  "bloom",
  "burgeon",
  "hyperBloom",
  "aggravate",
  "spread",
  "elevated",
  "lunarCharged",
  "lunarBloom",
  "lunarCrystallize",
  "stellarConduct",
  "stellarSwirl",
  "stellarVortex",
  "kx",
  "fykx",
  "multi",
  "fyplus",
  "fypct",
  "fycdmg"
])

/** 增幅反应的键 → 中文名 */
const AMPLIFY: Readonly<Record<string, string>> = { vaporize: "蒸发", melt: "融化", swirl: "扩散" }

/** 激化反应的键 → 中文名 */
const CATALYZE: Readonly<Record<string, string>> = { aggravate: "超激化", spread: "蔓激化" }

/**
 * 属性项的实体
 *
 * **必须带 `toString` 且返回属性值**：公式里直接写 `0.16 * attr.hp`、`x * attr.def`，靠隐式转换取值；普通对象转出 NaN，那一条伤害整行算不出、不报错。
 */
class AttrBox implements AttrItem {
  /** 基础值 */
  base: number
  /** 加成值 */
  plus: number
  /** 百分比加成 */
  pct: number
  /** 提高 */
  inc: number

  /**
   * @param init 初值
   */
  constructor(init: Partial<AttrItem> = {}) {
    this.base = Number(init.base) || 0
    this.plus = Number(init.plus) || 0
    this.pct = Number(init.pct) || 0
    this.inc = Number(init.inc) || 0
  }

  /**
   * 隐式转换时给出属性值；返回数而非串，属既定口径
   * @returns 属性值
   */
  toString(): string {
    return attrValue(this) as unknown as string
  }
}

/**
 * 造一项属性
 * @param init 初值
 * @returns 属性项
 */
function item(init: Partial<AttrItem> = {}): AttrItem {
  return new AttrBox(init)
}

/**
 * 造一项技能加成，各项缺省为 0
 * @returns 技能加成
 */
function skill(): SkillItem {
  return {
    pct: 0,
    multi: 0,
    plus: 0,
    dmg: 0,
    enemydmg: 0,
    cpct: 0,
    cdmg: 0,
    elevated: 0,
    def: 0,
    ignore: 0
  }
}

/**
 * 求一项属性的值
 *
 * **百分比只乘 base，不乘 plus。**
 * @param ds 属性项，缺字段按 0 论
 * @returns 属性值
 */
export function attrValue(ds: Partial<AttrItem> | number | undefined): number {
  if (typeof ds === "number") return ds
  if (!ds) return 0
  const base = Number(ds.base) || 0
  const plus = Number(ds.plus) || 0
  const pct = Number(ds.pct) || 0
  return base + plus + (base * pct) / 100
}

/** 造基准属性表需要的东西 */
export interface BaseAttrInput {
  /**
   * 面板属性计算的结果，即 `panel/attr.ts` 的 `calcAttr` 产出
   *
   * 内层用 `Partial<AttrItem>`：`staticAttr` 只有 `base`/`plus`/`pct` 三项、无 `inc`，本层读它按缺字段为 0 处理。
   */
  attr: Record<string, number | Record<string, Partial<AttrItem>>>
  /** 游戏 */
  game: AttrGame
  /** 元素中文名，反应基数要用 */
  element?: string
  /** 武器类型中文名，公式里的 `weaponTypeName` */
  weaponTypeName?: string
  /** 武器状态，公式里按 `refine` 取精炼档 */
  weapon?: { affix?: number; name?: string }
  /** 命座 / 星魂 */
  cons?: number
  /** 等级 */
  level?: number
  /** 已激活行迹，星铁的 buff 按 `tree` 判定 */
  trees?: Record<string, boolean>
  /** 战技点上限，星铁独有 */
  sp?: number
}

/**
 * 造一份基准属性表
 *
 * @param input 输入
 * @returns 基准属性表
 */
export function baseAttr(input: BaseAttrInput): DmgAttrTable {
  const { attr, game } = input
  const out: DmgAttrTable = {}

  /**
   * 取面板属性里的一个数
   * @param key 键
   * @returns 数值
   */
  const num = (key: string): number => {
    const got = attr[key]
    return typeof got === "number" ? got : 0
  }

  // 攻防生三项：面板给的是结果值，此处要拆回 base 与 plus
  for (const key of ["atk", "def", "hp"] as const) {
    out[key] = item({ base: num(`${key}Base`), plus: num(key) - num(`${key}Base`) })
  }

  for (const key of game === "gs" ? GS_ATTRS : SR_ATTRS) {
    out[key] = item({ base: num(key) })
  }

  for (const key of game === "gs" ? GS_SKILLS : SR_SKILLS) {
    out[key] = skill()
  }

  out.enemy = { def: 0, ignore: 0, phy: 0 } satisfies EnemyItem
  // 护盾的三项含义与别处不同：base 是基数 100、plus 是护盾强效、inc 是吸收倍率
  out.shield = item({ base: 100, plus: num("shield"), inc: 100 })

  out.weapon = input.weapon ?? {}
  out.weaponTypeName = input.weaponTypeName ?? ""
  out.element = input.element ?? ""
  // 精炼在公式里是 0 起（`refine` 即"第几档"），故减一
  out.refine = Math.max(0, (Number(input.weapon?.affix) || 1) - 1)
  out.staticAttr = attr.staticAttr ?? {}
  out.multi = 0
  out.kx = 0
  out.cons = Number(input.cons) || 0
  out.level = Number(input.level) || 0
  out.trees = input.trees ?? {}

  if (game === "gs") {
    for (const key of GS_REACTIONS) out[key] = 0
  } else {
    out.sp = Number(input.sp) || 0
    out.enemyCdmg = 0
    out.superBreak = { ignore: 0 }
    out.elation = {
      base: num("elation"),
      pct: 0,
      plus: 0,
      multi: 0,
      merrymake: 0,
      enemydmg: 0,
      cpct: 0,
      cdmg: 0,
      def: 0,
      ignore: 0
    }
  }

  return out
}

/**
 * 深拷贝一份属性表
 *
 * **不是可省的形式**：每条详情从同一份基准重新折算 buff，共用一个对象会让加成在详情间累积。
 * @param src 基准属性表
 * @returns 副本
 */
export function cloneAttr(src: DmgAttrTable): DmgAttrTable {
  const out: DmgAttrTable = {}
  for (const [key, val] of Object.entries(src)) {
    // 属性项要保住类型：展开成普通对象会丢掉 toString，公式里的 `x * attr.hp` 随之变 NaN
    if (val instanceof AttrBox) {
      out[key] = new AttrBox(val)
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      out[key] = { ...(val as Record<string, unknown>) }
    } else {
      out[key] = val
    }
  }
  return out
}

/** 一条 buff */
export interface DmgBuff {
  /** 展示文案，可以是函数 */
  title?: string | ((ds: DmgDataSet) => string)
  /** 加成数据，值可以是函数 */
  data?: Record<string, unknown>
  /** 静态 buff 由面板属性层处理，此处跳过 */
  isStatic?: boolean
  /** 生效条件 */
  check?: (ds: DmgDataSet) => unknown
  /** 所需命座 */
  cons?: number
  /** 命座上限 */
  maxCons?: number
  /** 所需行迹 */
  tree?: number | string
  /** 该 buff 表达的是哪个反应的精通加成 */
  mastery?: string
  /** 排序，小的先算 */
  sort?: number
}

/** 传给 buff 的 `check` 与函数值的数据集 */
export interface DmgDataSet {
  /** 属性表 */
  attr: DmgAttrTable
  /** 公式参数 */
  params: Record<string, unknown>
  /** 精炼档，0 起 */
  refine: number
  /** 武器类型中文名 */
  weaponTypeName: string
  /** 元素中文名 */
  element: string
  /** 求一项属性的值 */
  calc: (ds: Partial<AttrItem> | number | undefined) => number
  /** 当前算的是哪个技能 */
  currentTalent?: string
  /** 圣遗物 */
  artis?: unknown
  /** 其余由元数据带入的字段 */
  [key: string]: unknown
}

/**
 * 造传给 buff 的数据集
 *
 * @param attr 属性表
 * @param meta 角色的公式元数据，逐字段并入
 * @param params 公式参数
 * @returns 数据集
 */
export function dataSet(
  attr: DmgAttrTable,
  meta: Record<string, unknown> = {},
  params: Record<string, unknown> = {}
): DmgDataSet {
  return {
    ...meta,
    attr,
    params,
    refine: Number(attr.refine) || 0,
    weaponTypeName: String(attr.weaponTypeName ?? ""),
    element: String(attr.element ?? ""),
    calc: attrValue
  }
}

/** 折算 buff 需要的东西 */
export interface CalcDmgAttrInput {
  /** 基准属性表，由 {@link baseAttr} 造 */
  base: DmgAttrTable
  /** 要折算的 buff */
  buffs: readonly DmgBuff[]
  /** 角色的公式元数据 */
  meta?: Record<string, unknown>
  /** 圣遗物，buff 的 `check` 可能读它 */
  artis?: unknown
  /** 公式参数 */
  params?: Record<string, unknown>
  /** 要抬高一档的属性，词条收益对比用 */
  incAttr?: string
  /** 要压低一档的属性 */
  reduceAttr?: string
  /** 当前算的是哪个技能 */
  talent?: string
  /** 游戏 */
  game: AttrGame
  /** 词条元数据的 `attrMap`，抬高 / 压低一档时按它取步长 */
  attrMap?: Record<string, { calc?: string; value?: number }>
}

/** 折算结果 */
export interface CalcDmgAttrResult {
  /** 折算后的属性表 */
  attr: DmgAttrTable
  /** 生效的 buff 文案 */
  msg: string[]
}

/**
 * 把 buff 折进属性表
 *
 * @param input 输入
 * @returns 折算后的属性表与文案
 */
export function calcDmgAttr(input: CalcDmgAttrInput): CalcDmgAttrResult {
  const attr = cloneAttr(input.base)
  const msg: string[] = []
  const attrMap = input.attrMap ?? {}
  const meta: Record<string, unknown> = { ...(input.meta ?? {}) }

  // 词条收益对比：把某一项抬高 / 压低一档，看伤害怎么变
  for (const [key, sign] of [
    [input.incAttr, 1],
    [input.reduceAttr, -1]
  ] as const) {
    if (!key) continue
    const cfg = attrMap[key]
    const box = attr[key]
    if (!cfg || !box || typeof box !== "object") continue
    const field = cfg.calc ?? "plus"
    const bag = box as Record<string, number>
    bag[field] = (bag[field] ?? 0) + sign * (Number(cfg.value) || 0)
  }

  // 先扫一遍定下反应类型：`mastery` 决定后面按哪个反应算精通加成
  for (const buff of input.buffs) {
    if (!meta.mastery && buff.mastery) meta.mastery = buff.mastery
  }

  for (const buff of input.buffs) {
    if (buff.isStatic) continue

    const ds = dataSet(attr, meta, input.params ?? {})
    ds.currentTalent = input.talent ?? ""
    ds.artis = input.artis

    if (buff.check && !buff.check(ds)) continue
    // 命座与行迹取自**数据集**而非属性表（ds 的这两项来自角色公式元数据）；读错来源不报错，
    // 只会让守卫恒按 0 判定——「三命起生效」的一律不生效、「三命以下才生效」的一律生效，两方向同时错、面板只表现为伤害数字不同
    const cons = Number(ds.cons) || 0
    if (buff.cons !== undefined && cons < Number(buff.cons)) continue
    if (buff.maxCons !== undefined && cons > Number(buff.maxCons)) continue
    if (buff.tree !== undefined) {
      const trees = (ds.trees ?? {}) as Record<string, unknown>
      // 501 是通用档，不查行迹表
      if (!trees[`10${buff.tree}`] && String(buff.tree) !== "501") continue
    }

    let title = typeof buff.title === "function" ? buff.title(ds) : (buff.title ?? "")
    const data: Record<string, unknown> = { ...(buff.data ?? {}) }

    // 反应类 buff 的数值由精通现算，不是写死在元数据里的
    if (buff.mastery) {
      const mastery = Math.max(
        0,
        (Number((attr.mastery as AttrItem | undefined)?.base) || 0)
          + (Number((attr.mastery as AttrItem | undefined)?.plus) || 0)
      )
      const key = buff.mastery
      if (AMPLIFY[key]) {
        data[`_${key}`] = masteryMultiple(key, mastery) * 100
      } else if (CATALYZE[key]) {
        // 激化的基数不看 talent 与 params，照传是为入口形态统一
        const eleNum = masteryBasePct(key, String(attr.element ?? ""), input.talent ?? "", input.params ?? {})
        // 等级取自数据集而非 attr：ds 的 level 来自角色计算元数据，attr 上那份只兜底
        const lv = Number(ds.level ?? attr.level) || 0
        const eleBase = (1 + (Number(attr[key]) || 0) / 100 + masteryMultiple(key, mastery))
          * baseDmgAt(ELE_BASE_DMG, lv)
        data[`_${key}`] = masteryMultiple(key, mastery) * 100
        data[`_${key}num`] = eleNum * eleBase
      }
    }

    for (const [key, raw] of Object.entries(data)) {
      const val = typeof raw === "function" ? (raw as (ds: DmgDataSet) => unknown)(ds) : raw
      const value = Number(val)
      // 只放行数字：**0 要保留**（它是有意义的取值），NaN 与空值丢掉
      if (Number.isNaN(value) || val === null || val === undefined || val === "") continue

      title = title.replace(`[${key}]`, fmt(value))
      applyOne(attr, key, value, input.game)
    }

    msg.push(title)
  }

  return { attr, msg }
}

/**
 * 把数值写进文案，千分位加**恒定一位**小数
 *
 * **整数也要补 `.0`**（33 得 `"33.0"`）：buff 文案是给人看的字符串，差一个 `.0` 不影响数值、只让说明文字不一样、无报错、只能逐字比对发现。
 * @param val 数值
 * @returns 文本
 */
function fmt(val: number): string {
  // 先按一位小数定值，再拆整数与小数部分
  const [int = "", dec] = String(Number.parseFloat(val.toFixed(1))).split(".")
  const withComma = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${withComma}.${dec ?? "0"}`
}

/** 技能加成的键形态：技能键 + 后缀 */
const SKILL_RE
  = /^(a|a2|a3|e|q|t|me|mt|j|as|dot|break|nightsoul)(Def|Ignore|Dmg|Enemydmg|Plus|Pct|Cpct|Cdmg|Multi|Elevated)$/

/** 欢愉的键形态，后缀可省（省则记进 plus） */
const ELATION_RE = /^(elation)(Base|Pct|Plus|Multi|Cpct|Cdmg|Enemydmg|Merrymake|Def|Ignore)?$/

/** 攻防生速四项 */
const BASIC_RE = /^(hp|def|atk|speed)(Base|Plus|Pct|Inc)?$/

/** 其余可累加属性 */
const OTHER_RE
  = /^(mastery|cpct|cdmg|heal|recharge|dmg|enemydmg|phy|diffelem|shield|stance)(Plus|Pct|Inc)?$/

/** 超击破 */
const SUPER_BREAK_RE = /^(superBreak)(Ignore)$/

/**
 * 把一条加成落到属性表的对应位置
 *
 * **分派次序不可换。** 同一个键名在多张表里都可能有落点，换了次序会静默落错桶。
 * @param attr 属性表，就地修改
 * @param key 加成键
 * @param val 数值
 * @param game 游戏
 */
function applyOne(attr: DmgAttrTable, key: string, val: number, game: AttrGame): void {
  /**
   * 往一个子对象的字段上加数
   * @param box 子对象名
   * @param field 字段名
   * @param amount 数值
   */
  const add = (box: string, field: string, amount: number): void => {
    const bag = attr[box]
    if (!bag || typeof bag !== "object") return
    const rec = bag as Record<string, number>
    rec[field] = (rec[field] ?? 0) + amount
  }

  const t = SKILL_RE.exec(key)
  if (t?.[1] && t[2]) {
    add(t[1], t[2].toLowerCase(), val)
    return
  }

  const el = ELATION_RE.exec(key)
  if (el?.[1]) {
    add(el[1], el[2] ? el[2].toLowerCase() : "plus", val)
    return
  }

  const basic = BASIC_RE.exec(key)
  if (basic?.[1]) {
    const name = basic[1]
    add(name, basic[2] ? basic[2].toLowerCase() : "plus", val)
    // buff 给的基础值同样要吃静态百分比，漏掉会让"基于生命上限提升攻击力"少一大块
    if (basic[2] === "Base") {
      const stat = (attr.staticAttr ?? {}) as Record<string, { pct?: number } | undefined>
      const pct = Number(stat[name]?.pct) || 0
      if (pct) add(name, "plus", (val * pct) / 100)
    }
    return
  }

  const other = OTHER_RE.exec(key)
  if (other?.[1]) {
    add(other[1], other[2] ? other[2].toLowerCase() : "plus", val)
    return
  }

  if (key === "enemyDef") {
    add("enemy", "def", val)
    return
  }
  if (key === "enemyCdmg") {
    attr.enemyCdmg = (Number(attr.enemyCdmg) || 0) + val
    return
  }
  if (key === "ignore" || key === "enemyIgnore") {
    add("enemy", "ignore", val)
    return
  }

  if (ADDABLE.has(key)) {
    // 星铁没有这些反应键，落上去只会造出一个凭空的字段
    if (game === "gs" || key === "kx" || key === "multi") {
      attr[key] = (Number(attr[key]) || 0) + val
    }
    return
  }

  const sb = SUPER_BREAK_RE.exec(key)
  if (sb?.[1] && sb[2]) add(sb[1], sb[2].toLowerCase(), val)
}
