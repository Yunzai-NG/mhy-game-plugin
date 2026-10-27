/**
 * 模块职责：绝区零伤害公式 —— 把属性表、技能倍率与 buff 算成暴击伤害与期望伤害
 * 依赖方向：依赖同目录 attr（属性表）与 buff（筛选与求值）；纯计算，不碰 IO
 * 生命周期：无状态
 * 注意事项：**乘区的拆分与顺序一律不动**（挪位或并项只让数字不一样、不报错）；与原神星铁不共用乘区、故单独一个文件。要点：
 *          等级区**只异常伤害有**（`1+(等级-1)/59`，直伤加上去会虚高一倍）；异常伤害不吃常规暴击、另有异常精通区与异常增伤区、倍率来自异常本身；贯穿伤害（命破）不吃防御区、改吃贯穿增伤区（贯穿力缺省是攻击三成取整）。
 *          防御区基数是二次曲线（等级封顶 60），**穿透率先乘、穿透值后减**（反了会算出负防御）；抗性区初值 `1 - 敌人抗性`、默认敌人抗性 **-0.2**（标准假想敌，换 0 会全部低两成）。
 *          **每个乘区都有各不相同的上下限**（暴击率 0~1、爆伤 0~5、增伤 0~6、易伤 0.2~2…），那是游戏规则而非防御性代码。期望伤害是 `1 + 暴击率·爆伤`；异常伤害在暴击率为 0 时**暴击伤害整个为 0**（表示不会暴击、出图留空）。
 */
import { zzzPropOf } from "./attr.js"
import type { ZzzBuff, ZzzBuffCtx, ZzzBuffResult, ZzzBuffType } from "./buff.js"
import { zzzPickBuffs, zzzSumBuffs } from "./buff.js"

/** 假想敌 */
export interface ZzzEnemy {
  /** 等级 */
  level: number
  /** 基础防御，参照实现的标准值 50 */
  basicDEF: number
  /** 抗性，负值表示易伤；标准假想敌是 -0.2 */
  resistance: number
}

/** 标准假想敌，等级由代理人等级补齐 */
export const ZZZ_ENEMY: Readonly<Omit<ZzzEnemy, "level">> = { basicDEF: 50, resistance: -0.2 }

/** 一次伤害计算要的上下文 */
export interface ZzzCalcCtx extends ZzzBuffCtx {
  /** 代理人等级 */
  level: number
  /** 代理人自身的属性伤害类型，如 `冰` */
  element: string
  /** 假想敌 */
  enemy: ZzzEnemy
  /** 全部 buff */
  buffs: readonly ZzzBuff[]
}

/** 一个待算的技能 */
export interface ZzzSkill {
  /** 出图时印的名字 */
  name: string
  /** 技能类型，如 `AP` / `EQ1`；buff 的 `range` 按前缀匹配它 */
  type: string
  /** 倍率，已折成小数（`3.286` 表示 328.6%） */
  multiplier: number
  /** 造成哪种属性伤害；缺省取代理人自身那种 */
  element?: string
  /** 异常伤害 */
  isAnomaly?: boolean
  /** 贯穿伤害（命破） */
  isSheer?: boolean
  /** 锐化伤害（锋御） */
  isSharp?: boolean
}

/** 各乘区算出的值，出图时可逐项展开 */
export interface ZzzAreas {
  /** 基础伤害区（攻击力或贯穿力 × 倍率） */
  basic: number
  /** 暴击期望区（`1 + 暴击率·爆伤`） */
  critical: number
  /** 增伤区 */
  boost: number
  /** 易伤区 */
  vulnerability: number
  /** 抗性区 */
  resistance: number
  /** 防御区 */
  defence: number
  /** 失衡易伤区 */
  stun: number
  /** 异常精通区，仅异常伤害 */
  proficiency?: number
  /** 异常增伤区，仅异常伤害 */
  anomalyBoost?: number
  /** 等级区，仅异常伤害 */
  levelArea?: number
  /** 贯穿增伤区，仅贯穿伤害 */
  sheerBoost?: number
  /** 锐化增伤区，仅锐化伤害（锋御） */
  sharpBoost?: number
}

/** 一次伤害计算的结果 */
export interface ZzzDmgResult {
  /** 技能名 */
  name: string
  /** 技能类型 */
  type: string
  /** 暴击伤害；异常伤害在不会暴击时为 0 */
  crit: number
  /** 期望伤害 */
  avg: number
  /** 暴击率 */
  cpct: number
  /** 暴击伤害倍率 */
  cdmg: number
  /** 各乘区 */
  areas: ZzzAreas
  /** 参与这一次计算的 buff */
  buffs: ZzzBuffResult[]
}

/** 各乘区的上下限，键为 buff 类型或乘区名 */
const LIMIT: Readonly<Record<string, readonly [number, number]>> = {
  攻击力: [0, 10000],
  暴击率: [0, 1],
  暴击伤害: [0, 5],
  增伤: [0, 6],
  易伤: [0.2, 2],
  失衡易伤: [0.2, 5],
  无视抗性: [0, 2],
  防御区: [0, 1],
  异常精通区: [0, 10],
  异常增伤: [0, 3],
  异常暴击率: [0, 1],
  异常暴击伤害: [0, 5],
  贯穿力: [0, 10000],
  贯穿增伤: [0.2, 9],
  锐暴伤害: [0, 5],
  锐化增伤: [0.2, 9],
  // 锐化伤害基础区用防御力，与攻击力同量纲上限。**不能复用 `防御力` 的 `[0,1000]`**（那钳的是「防御力」buff 加成量，此处钳面板防御力本身、共用会把克拉蕾基础区压到 1000）
  防御力区: [0, 10000],
  // 锐化那支暴击率上限是 2 而非 1：锋御核心被动「暴击率超 100% 且已暴击时基于超出部分再判一次锐暴」，钳到 1 会抹掉那截；常规伤害仍钳 `[0,1]`、两者不共用键
  锐暴暴击率: [0, 2],
  异常掌控: [0, 1000],
  生命值: [0, 100000],
  防御力: [0, 1000],
  冲击力: [0, 1000]
}

/**
 * 钳一个值
 * @param key 乘区名，查 {@link LIMIT}
 * @param value 值
 * @returns 钳后的值；没有限制时原样
 */
function clamp(key: string, value: number): number {
  const range = LIMIT[key]
  if (!range) return value
  const [min, max] = range
  return Math.min(Math.max(value, min), max)
}

/**
 * 防御区那条基数曲线
 *
 * **等级封顶 60**：超过 60 的等级不再增长。
 * @param level 等级
 * @returns 基数
 */
function defBase(level: number): number {
  const lv = Math.min(60, level)
  return Math.floor(0.1551 * lv ** 2 + 3.141 * lv + 47.2039)
}

/** 一次累加的记录，把 buff 汇总到一处 */
interface Acc {
  /** 已收集的 buff */
  used: ZzzBuffResult[]
}

/**
 * 累加一个乘区，并把参与的 buff 记进 `acc`
 * @param picked 已筛过的 buff
 * @param type 乘区
 * @param initial 初值
 * @param ctx 上下文
 * @param acc 记录
 * @returns 钳后的值
 */
function area(
  picked: readonly ZzzBuff[],
  type: ZzzBuffType,
  initial: number,
  ctx: ZzzCalcCtx,
  acc: Acc
): number {
  const { value, used } = zzzSumBuffs(picked, type, initial, ctx)
  for (const one of used) {
    // 同一份 buff 可能落在多个乘区的筛选结果里，按名字与乘区去重
    if (!acc.used.some(had => had.name === one.name && had.type === one.type)) acc.used.push(one)
  }
  return clamp(type, value)
}

/**
 * 算防御区
 *
 * 穿透率先乘、穿透值后减，且有效防御不为负。
 * @param picked 已筛过的 buff
 * @param ctx 上下文
 * @param acc 记录
 * @returns 防御区
 */
function defenceArea(picked: readonly ZzzBuff[], ctx: ZzzCalcCtx, acc: Acc): number {
  const base = defBase(ctx.level)
  const enemyDef = (ctx.enemy.basicDEF / 50) * defBase(ctx.enemy.level)
  const ignore = area(picked, "无视防御", 0, ctx, acc)
  const pen = Math.min(area(picked, "穿透值", zzzPropOf(ctx.attr.final, "penVal"), ctx, acc), 1000)
  const penRatio = Math.min(area(picked, "穿透率", zzzPropOf(ctx.attr.final, "pen"), ctx, acc), 2)
  const defence = enemyDef * (1 - ignore)
  const effective = Math.max(0, defence * (1 - penRatio) - pen)
  return clamp("防御区", base / (effective + base))
}

/**
 * 算等级区，只有异常伤害吃它
 * @param level 代理人等级
 * @returns 等级区
 */
export function zzzLevelArea(level: number): number {
  return Number((1 + (level - 1) / 59).toFixed(4))
}

/**
 * 算一次伤害
 *
 * @param skill 技能
 * @param ctx 上下文
 * @returns 伤害结果
 */
export function zzzCalcSkill(skill: ZzzSkill, ctx: ZzzCalcCtx): ZzzDmgResult {
  const element = skill.element ?? ctx.element
  const picked = zzzPickBuffs(ctx.buffs, { type: skill.type, element }, ctx)
  const acc: Acc = { used: [] }

  const isAnomaly = skill.isAnomaly === true
  const isSheer = skill.isSheer === true
  const isSharp = skill.isSharp === true

  // 倍率区：buff 里的「倍率」是额外倍率，与技能自身倍率相加
  const multiplier = skill.multiplier + area(picked, "倍率", 0, ctx, acc)

  // 基础伤害区：贯穿伤害用贯穿力、锐化伤害用防御力，其余用攻击力
  let basic: number
  if (isSheer) {
    const fromAtk = Math.trunc(area(picked, "攻击力", zzzPropOf(ctx.attr.final, "atk"), ctx, acc) * 0.3)
    const sheer = clamp("贯穿力", area(picked, "贯穿力", fromAtk, ctx, acc))
    basic = sheer * multiplier
  } else if (isSharp) {
    const def = clamp("防御力区", area(picked, "防御力", zzzPropOf(ctx.attr.final, "def"), ctx, acc))
    basic = def * multiplier
  } else {
    const atk = clamp("攻击力", area(picked, "攻击力", zzzPropOf(ctx.attr.final, "atk"), ctx, acc))
    basic = atk * multiplier
  }

  // 暴击区：**异常伤害默认不暴击**（只有「异常暴击率」类加成才让它暴击，故初值 0），常规伤害初值才是面板那两项。
  // **锐化伤害（锋御）不吃暴击伤害、改吃锐暴伤害，且暴击率不钳在 1**（核心被动「超 100% 且已暴击时基于超出部分再判锐暴」，上限 2，见 `锐暴暴击率`）
  let cpct: number
  let cdmg: number
  if (isAnomaly) {
    cpct = area(picked, "异常暴击率", 0, ctx, acc)
    cdmg = area(picked, "异常暴击伤害", 0, ctx, acc)
  } else if (isSharp) {
    cpct = clamp("锐暴暴击率", area(picked, "暴击率", zzzPropOf(ctx.attr.final, "cpct"), ctx, acc))
    cdmg = area(picked, "锐暴伤害", zzzPropOf(ctx.attr.final, "sharpCdmg"), ctx, acc)
  } else {
    cpct = area(picked, "暴击率", zzzPropOf(ctx.attr.final, "cpct"), ctx, acc)
    cdmg = area(picked, "暴击伤害", zzzPropOf(ctx.attr.final, "cdmg"), ctx, acc)
  }
  const critical = 1 + cpct * cdmg

  // 增伤区初值是面板那条属性伤害加成，**只在技能属性与代理人自身属性一致时计入**（冰属性代理人打出的以太伤害不吃冰伤加成）
  const ownDmg = element === ctx.element ? zzzPropOf(ctx.attr.final, "dmgElem") : 0
  const boost = area(picked, "增伤", 1 + ownDmg, ctx, acc)
  const vulnerability = area(picked, "易伤", 1, ctx, acc)
  const stun = area(picked, "失衡易伤", 1, ctx, acc)
  const resistance = area(picked, "无视抗性", 1 - ctx.enemy.resistance, ctx, acc)
  // 贯穿伤害不吃防御区
  const defence = isSheer ? 1 : defenceArea(picked, ctx, acc)

  const areas: ZzzAreas = { basic, critical, boost, vulnerability, resistance, defence, stun }
  const common = basic * boost * vulnerability * resistance * defence * stun

  let crit: number
  let avg: number
  if (isAnomaly) {
    const proficiency = clamp("异常精通区", area(picked, "异常精通", zzzPropOf(ctx.attr.final, "ap"), ctx, acc) / 100)
    const anomalyBoost = area(picked, "异常增伤", 1, ctx, acc)
    const levelArea = zzzLevelArea(ctx.level)
    areas.proficiency = proficiency
    areas.anomalyBoost = anomalyBoost
    areas.levelArea = levelArea
    const tail = proficiency * levelArea * anomalyBoost
    // 不会暴击时暴击栏留 0，出图据此空着那一格
    crit = critical === 1 ? 0 : common * (1 + cdmg) * tail
    avg = common * critical * tail
  } else {
    // 贯穿与锐化各有自己的尾部增伤区、两者互斥；常规伤害没有这一区故是 1。锐化的 `cdmg` 此时已是锐暴伤害（见上文暴击区）
    let tail = 1
    if (isSheer) {
      tail = area(picked, "贯穿增伤", 1, ctx, acc)
      areas.sheerBoost = tail
    } else if (isSharp) {
      tail = area(picked, "锐化增伤", 1, ctx, acc)
      areas.sharpBoost = tail
    }
    crit = common * (1 + cdmg) * tail
    avg = common * critical * tail
  }

  return {
    name: skill.name,
    type: skill.type,
    crit,
    avg,
    cpct,
    cdmg,
    areas,
    // 高值在前，出图时先印影响大的
    buffs: acc.used.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  }
}

/**
 * 算一组技能
 *
 * 倍率为 0 的技能不出（那是元数据里没有该段倍率），期望为 0 的同样不出。
 * @param skills 技能表
 * @param ctx 上下文
 * @returns 逐技能的结果，期望伤害高的在前
 */
export function zzzCalcSkills(skills: readonly ZzzSkill[], ctx: ZzzCalcCtx): ZzzDmgResult[] {
  const out: ZzzDmgResult[] = []
  for (const skill of skills) {
    if (!skill.multiplier) continue
    const got = zzzCalcSkill(skill, ctx)
    if (!got.avg) continue
    out.push(got)
  }
  return out.sort((a, b) => b.avg - a.avg)
}
