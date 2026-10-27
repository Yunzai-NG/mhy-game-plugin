/**
 * 模块职责：等级属性插值
 * 依赖方向：只吃元数据 `data.json` 里的 `attr` 段，纯计算
 * 生命周期：无状态纯函数
 * 注意事项：原神与星铁是两套完全不同的数据形态，勿统一 —— 原神档位间线性插值（突破后同级另有 `<等级>+` 键，取左端点先试它），
 *          星铁按 `attr[突破阶]` 的基础值 + 每级成长 ×(等级-1)。原神第四项属性走**每五级一档的阶梯插值**（改线性会让
 *          89/90 级暴伤差一档），武器副属性用**第三套**算法（`Math.ceil` 从右端点往回数）。三套都不可改，各自对齐游戏内显示值。
 */

/** 原神的等级档位，突破一次跨一档 */
const GS_STEPS: readonly number[] = [1, 20, 40, 50, 60, 70, 80, 90, 100]

/** 星铁的等级档位 */
const SR_STEPS: readonly number[] = [1, 20, 30, 40, 50, 60, 70, 80]

/**
 * 按等级推突破阶数
 *
 * 接口有时不给突破阶数，只能由等级反推。
 * @param lv 等级
 * @param game 游戏
 * @returns 突破阶数，0 起
 */
export function calcPromote(lv: number, game: "gs" | "sr" = "gs"): number {
  const steps = game === "gs" ? GS_STEPS : SR_STEPS
  let promote = 0
  for (let idx = 0; idx <= steps.length - 1; idx++) {
    const left = steps[idx]
    const right = steps[idx + 1]
    if (left !== undefined && right !== undefined && lv >= left && lv <= right) return promote
    promote++
  }
  return promote
}

/**
 * 定出等级所处的档位区间
 *
 * 同一等级可能落在两区间边界上（如 80 级），此时由突破阶数决定取哪一个 —— 即「满级未突破」与「刚突破」白值不同的由来。
 * @param level 等级
 * @param promote 突破阶数
 * @param steps 档位表
 * @returns 左右端点
 */
function spanOf(level: number, promote: number, steps: readonly number[]): { left: number; right: number } {
  let currPromote = 0
  for (let idx = 0; idx < steps.length - 1; idx++) {
    const left = steps[idx]
    const right = steps[idx + 1]
    if (currPromote === promote && left !== undefined && right !== undefined && level >= left && level <= right) {
      return { left, right }
    }
    currPromote++
  }
  return { left: 0, right: 0 }
}

/** 原神角色 `data.json` 的 `attr` 段 */
export interface GsCharAttr {
  /** 四项属性的键，第四项是突破加成属性 */
  keys?: string[]
  /** 等级 → 四项属性的值 */
  details?: Record<string, number[]>
}

/** 一次插值的结果，键为属性键 */
export type LevelAttr = Record<string, number>

/**
 * 算原神角色的等级属性
 *
 * @param attr 元数据的 `attr` 段
 * @param level 等级
 * @param promote 突破阶数
 * @returns 属性键 → 数值，含 `hpBase` / `atkBase` / `defBase` 与第四项
 */
export function gsCharLevelAttr(attr: GsCharAttr, level: number, promote: number): LevelAttr {
  const details = attr.details ?? {}
  const keys = attr.keys ?? []
  const { left, right } = spanOf(level, promote, GS_STEPS)
  // 突破后的左端点另有一份"<等级>+"，取不到再退回裸等级
  const dLeft = details[`${left}+`] ?? details[String(left)] ?? []
  const dRight = details[String(right)] ?? []

  /**
   * 取第 idx 项在当前等级的值
   * @param idx 项下标
   * @param step 为真时走每五级一档的阶梯插值
   * @returns 数值
   */
  const at = (idx: number, step = false): number => {
    const a = Number(dLeft[idx]) || 0
    const b = Number(dRight[idx]) || 0
    if (right === left) return a
    if (!step) return a + ((b - a) * (level - left)) / (right - left)
    const denom = Math.round((right - left) / 5)
    if (!denom) return a
    return a + ((b - a) * Math.floor((level - left) / 5)) / denom
  }

  const out: LevelAttr = {
    hpBase: at(0),
    atkBase: at(1),
    defBase: at(2)
  }
  const fourth = keys[3]
  if (fourth) out[fourth] = at(3, true)
  return out
}

/**
 * 第四项属性是否应计入白值表
 *
 * 判据是键名里不含 `hp` / `atk` / `def` —— 生命 / 攻击 / 防御的百分比加成不算白值，
 * 其余（暴击、精通一类）算。
 * @param key 第四项属性键
 * @returns 应计入白值时为真
 */
export function fourthIsBase(key: string): boolean {
  return !/(hp|atk|def)/.test(key)
}

/** 星铁一个突破阶的属性数据 */
export interface SrPromoteAttr {
  /** 该阶的基础值 */
  attrs?: Record<string, number>
  /** 每级的成长值；光锥的成长值另存在顶层 `growAttr` 里 */
  grow?: Record<string, number>
}

/** 星铁的等级属性段：突破阶数 → 该阶数据 */
export type SrLevelAttr = Record<string, SrPromoteAttr>

/**
 * 算星铁角色 / 光锥的等级属性
 *
 * 该阶基础值 + 每级成长值 ×(等级-1)。
 * @param attr 元数据的 `attr` 段
 * @param level 等级
 * @param promote 突破阶数
 * @param grow 光锥的成长值另存在 `growAttr` 里，角色的在 `attr[promote].grow` 里
 * @returns 属性键 → 数值
 */
export function srLevelAttr(
  attr: SrLevelAttr,
  level: number,
  promote: number,
  grow?: Record<string, number>
): LevelAttr {
  const one = attr[String(promote)]
  if (!one) return {}
  const out: LevelAttr = {}
  for (const [key, val] of Object.entries(one.attrs ?? {})) {
    out[key] = Number(val) || 0
  }
  for (const [key, val] of Object.entries(grow ?? one.grow ?? {})) {
    out[key] = (out[key] ?? 0) + (Number(val) || 0) * (level - 1)
  }
  return out
}

/** 原神武器 `data.json` 的 `attr` 段 */
export interface GsWeaponAttr {
  /** 等级 → 基础攻击 */
  atk?: Record<string, number>
  /** 副属性的键 */
  bonusKey?: string
  /** 等级 → 副属性值 */
  bonusData?: Record<string, number>
}

/** 原神武器的属性计算结果 */
export interface GsWeaponResult {
  /** 基础攻击 */
  atkBase: number
  /** 副属性 */
  attr?: { key: string; value: number }
}

/**
 * 算原神武器的属性
 *
 * `promote` 传 `-1` 表示不限突破，取第一个含该等级的区间 —— 接口不给武器突破时用它。
 * @param attr 元数据的 `attr` 段
 * @param level 等级
 * @param promote 突破阶数，-1 为不限
 * @returns 基础攻击与副属性
 */
export function gsWeaponAttr(attr: GsWeaponAttr, level: number, promote = -1): GsWeaponResult {
  let left = 1
  let right = 20
  let currPromote = 0
  // 武器只到 90 级，故档位表少最后一档
  const steps = GS_STEPS.slice(0, -1)
  for (let idx = 0; idx < steps.length - 1; idx++) {
    const l = steps[idx]
    const r = steps[idx + 1]
    if ((promote === -1 || currPromote === promote) && l !== undefined && r !== undefined && level >= l && level <= r) {
      left = l
      right = r
      break
    }
    currPromote++
  }

  const atkMap = attr.atk ?? {}
  const aLeft = Number(atkMap[`${left}+`] ?? atkMap[String(left)]) || 0
  const aRight = Number(atkMap[String(right)]) || 0
  const atkBase = right === left ? aLeft : aLeft + ((aRight - aLeft) * (level - left)) / (right - left)

  const out: GsWeaponResult = { atkBase }
  const bonus = attr.bonusData ?? {}
  const bKey = attr.bonusKey
  if (bKey && Object.keys(bonus).length) {
    const bLeft = Number(bonus[`${left}+`] ?? bonus[String(left)]) || 0
    const bRight = Number(bonus[String(right)]) || 0
    // 副属性按每五级一档，自右端点往回数 —— 与角色第四项的往前数不是同一个算法
    const stepCount = Math.ceil((right - left) / 5)
    const valueStep = stepCount ? (bRight - bLeft) / stepCount : 0
    out.attr = { key: bKey, value: bLeft + (stepCount - Math.ceil((right - level) / 5)) * valueStep }
  }
  return out
}
