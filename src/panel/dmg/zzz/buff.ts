/**
 * 模块职责：绝区零的 buff —— 声明形态、按技能筛选、把声明值求成数值
 * 依赖方向：依赖同目录 attr（两张属性表）；纯函数，不读文件、不发请求
 * 生命周期：无状态，表是模块级常量
 * 注意事项：**类型名即乘区落点**（`ZzzBuffType` 联合类型），写错不报错、只会让加成落到别的乘区（把「异常增伤」写成「增伤」会连乘两次）。
 *          筛选三道缺一都多算：`range`（对哪几个技能，前缀匹配——写 `EQ` 命中 `EQ1`/`EQ2`）、`element`（只对某属性）、`check`（影画/套装门槛或自定义），另有 `include`/`exclude` 做例外。
 *          **百分比 buff 乘白值不乘最终值**（`0.2` 是两成、`19` 是十九点攻击，判据是**绝对值小于 1**），乘最终值会让高配面板收益虚高。**不可叠加的同名 buff 取高的那份**（`stackable: false`），须能撤回已计入的低值。
 */
import type { ZzzAttrTables, ZzzPropTable } from "./attr.js"
import { zzzPropOf } from "./attr.js"

/**
 * buff 落在哪个乘区
 *
 * **「增伤」与「异常增伤」是两个乘区**，「易伤」与「失衡易伤」同样是两个 —— 并项会让吃两种加成的技能少算一层。
 */
export type ZzzBuffType =
  | "攻击力"
  | "倍率"
  | "增伤"
  | "易伤"
  | "无视抗性"
  | "无视防御"
  | "穿透值"
  | "穿透率"
  | "失衡易伤"
  | "暴击率"
  | "暴击伤害"
  | "异常精通"
  | "异常增伤"
  | "异常暴击率"
  | "异常暴击伤害"
  | "异常持续时间"
  | "贯穿力"
  | "贯穿增伤"
  | "锐暴伤害"
  | "锐化增伤"
  | "生命值"
  | "防御力"
  | "冲击力"
  | "异常掌控"

/** buff 的来源，决定 `check` 的含义与逐等级值按什么取 */
export type ZzzBuffSource = "核心被动" | "额外能力" | "技能" | "影画" | "音擎" | "套装" | "驱动盘" | "其他"

/** 求值与判据要的上下文 */
export interface ZzzBuffCtx {
  /** 影画数，0~6 */
  rank: number
  /** 六个技能等级，键同面板的 `talent` */
  talent: Readonly<Record<string, number>>
  /** 音擎叠影，1~5；没装音擎时 0 */
  star: number
  /** 逐套装已装件数 */
  setCount: Readonly<Record<string, number>>
  /** 两张属性表 */
  attr: ZzzAttrTables
}

/** buff 的声明值：常数、逐等级表、或一个现算的函数 */
export type ZzzBuffValue = number | readonly number[] | ((ctx: ZzzBuffCtx) => number)

/** 一份 buff 声明 */
export interface ZzzBuff {
  /** 名称，出图时印出来 */
  name: string
  /** 落哪个乘区 */
  type: ZzzBuffType
  /**
   * 值；音擎公式**不写它、改写 {@link idx}** 从 data.json 取
   *
   * 收集时若这条带 `idx` 则由装载层按当前叠影从 `data.json.talents.tables[idx]` 填出，故此处可缺。
   */
  value?: ZzzBuffValue
  /**
   * 音擎公式专用：引用 `data.json.talents.tables` 的第几张表（1 起），值由装载层按叠影现填
   *
   * 与原神星铁武器公式同一副做法（`staticIdx`/`keyIdx` 只给序号，真值在 `data.json`）：音擎数值单一同源、
   * 改数值只改元数据一处。百分数类 ÷100、点数类（异常精通/贯穿力/穿透值）原样，见 `dmg/zzz/build.ts` 的解析。
   */
  idx?: number
  /** 来源 */
  source: ZzzBuffSource
  /** 只对这几种属性伤害生效；缺省不限 */
  element?: string | readonly string[]
  /** 只对这几个技能生效（前缀匹配）；缺省对全部 */
  range?: readonly string[]
  /** 额外命中这几个技能，绕过 `range` */
  include?: readonly string[]
  /** 这几个技能不吃这份 buff，优先于其余判据 */
  exclude?: readonly string[]
  /** 影画数 / 套装件数门槛，或一个自定义判据 */
  check?: number | ((ctx: ZzzBuffCtx) => boolean)
  /** 同名不可叠加时取高的那一份 */
  stackable?: boolean
  /**
   * 叠满层数 / 条件成立的份数，缺省 1
   *
   * 与原神武器公式同一副做法：{@link idx} 指的那张表是**每层值**，层数放这里由引擎乘上去，
   * 而非把「每层 × 层数」烘进数值。烘进去会与 data.json 对不上、改数值要两处改。
   */
  buffCount?: number
  /** 上限，形态同 `value` */
  max?: ZzzBuffValue
  /** 百分比按白值折算时，套装名（`check` 为件数门槛时要它查件数） */
  setName?: string
}

/** 折算百分比时乘白值的那几项 */
const RATIO_ABLE: ReadonlySet<ZzzBuffType> = new Set<ZzzBuffType>([
  "生命值",
  "防御力",
  "攻击力",
  "冲击力",
  "异常掌控"
])

/** buff 类型 → 白值表里的键 */
const BASE_KEY: Readonly<Partial<Record<ZzzBuffType, keyof ZzzPropTable>>> = {
  生命值: "hp",
  防御力: "def",
  攻击力: "atk",
  冲击力: "impact",
  异常掌控: "am"
}

/**
 * 求一份声明值
 *
 * 三种形态：常数直接用；数组按来源取一档（音擎按叠影、核心被动与额外能力按核心技等级、
 * 其余按影画数）；函数现算。
 * @param value 声明值
 * @param source 来源
 * @param ctx 上下文
 * @returns 数值
 */
function rawValue(value: ZzzBuffValue, source: ZzzBuffSource, ctx: ZzzBuffCtx): number {
  if (typeof value === "number") return value
  if (typeof value === "function") return Number(value(ctx)) || 0
  if (source === "音擎") return Number(value[ctx.star - 1]) || 0
  if (source === "核心被动" || source === "额外能力") {
    return Number(value[(ctx.talent["core"] ?? 1) - 1]) || 0
  }
  return Number(value[ctx.rank - 1]) || 0
}

/**
 * 求一份 buff 的最终数值
 *
 * **百分比折白值那步只对可折算五项、且绝对值小于 1 时做**（`19` 点与 `0.2` 两成写在同字段、判据只有大小），改判据会让所有定值 buff 变百分比。
 * @param buff buff 声明
 * @param ctx 上下文
 * @returns 数值
 */
export function zzzBuffValue(buff: ZzzBuff, ctx: ZzzBuffCtx): number {
  // 带 idx 的音擎 buff 由装载层把值现填进 value；没填出（缺表）时按 0，别让 rawValue 在 undefined 上取下标
  if (buff.value === undefined) return 0
  const one = (value: ZzzBuffValue): number => {
    const add = rawValue(value, buff.source, ctx)
    if (!add || !RATIO_ABLE.has(buff.type) || Math.abs(add) >= 1) return add
    // 函数形态的值已是成品，不再折算
    if (typeof value === "function") return add
    const key = BASE_KEY[buff.type]
    const base = key ? zzzPropOf(ctx.attr.base, key) : 0
    return base ? add * base : add
  }
  const value = one(buff.value) * (buff.buffCount ?? 1)
  if (!value || buff.max === undefined) return value
  return Math.min(value, one(buff.max))
}

/** 筛选时要知道的技能特征 */
export interface ZzzBuffFilter {
  /** 技能类型，如 `EQ` / `AP1` */
  type: string
  /** 该技能造成哪种属性伤害 */
  element?: string
}

/**
 * 判一份 buff 的 `range` 是否命中某技能
 *
 * `exclude` 优先于全部；`include` 绕过 `range`；`range` 缺省时对全部技能生效。
 * @param buff buff 声明
 * @param type 技能类型
 * @returns 命中时为真
 */
function inRange(buff: ZzzBuff, type: string): boolean {
  if (buff.exclude?.includes(type)) return false
  if (buff.include?.includes(type)) return true
  if (!buff.range) return true
  // 前缀匹配：buff 写 `EQ`，`EQ1` / `EQ2` 都该命中
  return buff.range.some(one => type.startsWith(one))
}

/**
 * 判一份 buff 的属性限制是否命中
 * @param buff buff 声明
 * @param element 技能的属性
 * @returns 命中时为真
 */
function inElement(buff: ZzzBuff, element: string | undefined): boolean {
  if (!buff.element || !element) return true
  return Array.isArray(buff.element) ? buff.element.includes(element) : buff.element === element
}

/**
 * 判一份 buff 的门槛
 *
 * 数字门槛的含义随来源变：套装看件数、影画看影画数。函数门槛直接调。
 * @param buff buff 声明
 * @param ctx 上下文
 * @returns 达标时为真
 */
function passCheck(buff: ZzzBuff, ctx: ZzzBuffCtx): boolean {
  const { check } = buff
  if (check === undefined) return true
  if (typeof check === "function") return !!check(ctx)
  if (buff.source === "套装") return (ctx.setCount[buff.setName ?? buff.name] ?? 0) >= check
  return ctx.rank >= check
}

/**
 * 挑出对某技能生效的 buff
 * @param buffs 全部 buff
 * @param skill 技能特征
 * @param ctx 上下文
 * @returns 生效的那些
 */
export function zzzPickBuffs(buffs: readonly ZzzBuff[], skill: ZzzBuffFilter, ctx: ZzzBuffCtx): ZzzBuff[] {
  return buffs.filter(one => inRange(one, skill.type) && inElement(one, skill.element) && passCheck(one, ctx))
}

/** 一份算好的 buff，出图时逐条印 */
export interface ZzzBuffResult {
  /** 名称 */
  name: string
  /** 乘区 */
  type: ZzzBuffType
  /** 数值 */
  value: number
  /** 来源 */
  source: ZzzBuffSource
}

/** 累加的结果 */
export interface ZzzSumResult {
  /** 累加后的值 */
  value: number
  /** 参与累加的那些 buff */
  used: ZzzBuffResult[]
}

/**
 * 把某一个乘区上的 buff 累加起来
 *
 * **同名不可叠加时取高的那份、且要撤回已计入的低值**（只「跳过后来的」会在低值先出现时算错）。
 * @param buffs 已按技能筛过的 buff
 * @param type 要累加的乘区
 * @param initial 初值
 * @param ctx 上下文
 * @returns 累加结果与参与的 buff
 */
export function zzzSumBuffs(
  buffs: readonly ZzzBuff[],
  type: ZzzBuffType,
  initial: number,
  ctx: ZzzBuffCtx
): ZzzSumResult {
  let value = initial
  const used: ZzzBuffResult[] = []
  /** 同名不可叠加的那些，记下已计入的值以便撤回 */
  const kept = new Map<string, number>()
  for (const buff of buffs) {
    if (buff.type !== type) continue
    const add = zzzBuffValue(buff, ctx)
    if (!add) continue
    if (buff.stackable === false) {
      const had = kept.get(buff.name)
      if (had !== undefined) {
        // 已有的更高或相等，这一份不计
        if (Math.abs(had) >= Math.abs(add)) continue
        // 已有的更低，撤回它再计这一份
        value -= had
        const at = used.findIndex(one => one.name === buff.name)
        if (at >= 0) used.splice(at, 1)
      }
      kept.set(buff.name, add)
    }
    value += add
    used.push({ name: buff.name, type: buff.type, value: add, source: buff.source })
  }
  return { value, used }
}
