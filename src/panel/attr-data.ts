/**
 * 模块职责：面板属性的累加器
 * 依赖方向：依赖 meta/elem（星铁的元素折算）；纯计算，不碰 IO
 * 生命周期：一个角色一份实例，算完即弃
 * 注意事项：每项属性取值公式为 `base * (1 + pct / 100) + plus`，白值走 `base`、百分比走 `pct`、固定值走 `plus`，
 *          三者混淆只差一点点而不报错（如武器白值误加进 `plus`，圣遗物「攻击 +N%」就不乘到武器攻击）。键名两套：
 *          `atk` 取结果、`atkBase`/`atkPlus`/`atkPct`/`atkInc` 写分量。**`Inc` 后缀要认**：它落 `attr[key].inc` 不
 *          参与计算，但元数据有条目写它，不认会让 `addAttr` 返回 false、被当成未识别属性。星铁与角色自身元素相同的元素伤害
 *          折算成 `dmg`（原神不做，其元素伤害加成与通用增伤是两个乘区）。
 */
import { isElem, sameElem, type ElemGame } from "../meta/elem.js"

/** 一项属性的三个分量 */
interface AttrParts {
  /** 白值 */
  base: number
  /** 固定加值 */
  plus: number
  /** 百分比加成，单位为百分点（`50` 即 +50%） */
  pct: number
  /** 元数据里有条目写它，但不参与计算；留着这一栏以免 `addAttr` 误判 */
  inc?: number
}

/** 原神的属性键，次序即面板上的展示次序 */
export const GS_ATTR_KEYS: readonly string[] = [
  "atk",
  "def",
  "hp",
  "mastery",
  "recharge",
  "cpct",
  "cdmg",
  "dmg",
  "phy",
  "heal",
  "shield",
  "diffelem"
]

/** 星铁的属性键，次序即面板上的展示次序 */
export const SR_ATTR_KEYS: readonly string[] = [
  "atk",
  "def",
  "hp",
  "speed",
  "recharge",
  "cpct",
  "cdmg",
  "dmg",
  "heal",
  "stance",
  "effPct",
  "effDef",
  "shield",
  "elation"
]

/** 取某个游戏的属性键 */
const KEYS: Readonly<Record<ElemGame, readonly string[]>> = { gs: GS_ATTR_KEYS, sr: SR_ATTR_KEYS }

/** 分量后缀 → 落到哪个字段 */
const SUFFIX = ["Base", "Plus", "Pct", "Inc"] as const

/** 会被当作"白值 + 加值"拆开的三项 */
const WITH_BASE = ["hp", "def", "atk"] as const

/** 输出里额外带白值的几项 */
const BASE_OUT = ["hp", "atk", "def", "speed"] as const

/** 一次面板计算的输出 */
export interface AttrResult extends Record<string, unknown> {
  /** 标记这是算出来的面板，模板据此判断要不要画"计算"字样 */
  _calc: true
  /** 各项属性的三个分量原样带出，伤害计算要读它 */
  staticAttr: Record<string, AttrParts>
}

/** 造累加器需要的角色信息 */
export interface AttrChar {
  /** 元素 / 命途 */
  elem?: string
}

/**
 * 面板属性累加器
 *
 * 所有写入都经 {@link addAttr}，取值经 {@link get}。
 */
export class AttrData {
  readonly #game: ElemGame
  readonly #char: AttrChar
  readonly #attr: Record<string, AttrParts> = {}
  readonly #base: Record<string, number> = {}
  readonly #reg: RegExp

  /**
   * @param game 游戏
   * @param char 角色信息，星铁折算元素伤害时要读它的元素
   * @param data 初始属性，等同于造好之后调一次 {@link setAttr}
   */
  constructor(game: ElemGame, char: AttrChar = {}, data?: Readonly<Record<string, number>>) {
    this.#game = game
    this.#char = char
    this.#reg = new RegExp(`^(${KEYS[game].join("|")})(${SUFFIX.join("|")})$`)
    for (const key of KEYS[game]) {
      this.#attr[key] = { base: 0, plus: 0, pct: 0 }
      this.#base[key] = 0
    }
    if (data) this.setAttr(data, true)
  }

  /**
   * 取一项属性
   *
   * 传 `atk` 得结果值（`base * (1 + pct / 100) + plus`），传 `atkBase` 一类得该分量。
   * @param key 属性键
   * @returns 数值；键不认得时 undefined
   */
  get(key: string): number | undefined {
    const parts = this.#attr[key]
    if (parts && KEYS[this.#game].includes(key)) {
      return parts.base * (1 + parts.pct / 100) + parts.plus
    }
    const hit = this.#reg.exec(key)
    if (hit?.[1] && hit[2]) {
      const field = hit[2].toLowerCase() as keyof AttrParts
      return this.#attr[hit[1]]?.[field] ?? 0
    }
    return undefined
  }

  /**
   * 加一项属性
   *
   * 传 `atk` 一类的裸键时**落到 `plus`**—— 想加白值必须显式写 `atkBase`。
   * @param key 属性键
   * @param val 加值
   * @param isBase 是否同时计入白值表，白值表供伤害计算折算小词条用
   * @returns 键被识别时为真
   */
  addAttr(key: string, val: number, isBase = false): boolean {
    let k = key
    // 星铁：与角色自身元素相同的元素伤害即通用增伤
    if (this.#game === "sr" && isElem(k, "sr") && sameElem(this.#char.elem ?? "", k, "sr")) {
      k = "dmg"
    }

    const num = Number(val) || 0

    if (KEYS[this.#game].includes(k)) {
      const parts = this.#attr[k]
      if (!parts) return false
      parts.plus += num
      if (isBase) this.#base[k] = (this.#base[k] ?? 0) + num
      return true
    }

    const hit = this.#reg.exec(k)
    if (hit?.[1] && hit[2]) {
      const name = hit[1]
      const field = hit[2].toLowerCase() as keyof AttrParts
      const parts = this.#attr[name]
      if (!parts) return false
      parts[field] = (parts[field] ?? 0) + num
      if (field === "base" || isBase) this.#base[name] = (this.#base[name] ?? 0) + num
      return true
    }
    return false
  }

  /**
   * 批量设置属性
   * @param data 属性键 → 数值
   * @param withBase 为真时把 `hp` / `atk` / `def` 视作**结果值**而非加值：
   *        接口给的面板是结果，减去白值才是加值。缺了这一步，白值会被重复计入一次。
   */
  setAttr(data: Readonly<Record<string, number>>, withBase = false): void {
    const src: Record<string, number> = { ...data }
    if (withBase) {
      for (const key of WITH_BASE) {
        const base = src[`${key}Base`]
        if (src[key] && base) {
          src[`${key}Plus`] = src[key] - base
          delete src[key]
        }
      }
    }
    for (const [key, val] of Object.entries(src)) {
      this.addAttr(key, val)
    }
  }

  /**
   * 取整份面板
   * @returns 各项结果值，另带 `hpBase` 一类白值、`_calc` 标记与 `staticAttr` 原始分量
   */
  getAttr(): AttrResult {
    const out: Record<string, unknown> = {}
    for (const key of KEYS[this.#game]) {
      out[key] = this.get(key) ?? 0
      if ((BASE_OUT as readonly string[]).includes(key)) out[`${key}Base`] = this.get(`${key}Base`) ?? 0
    }
    out["_calc"] = true
    // 主副词条、套装常驻、武器副词条、突破加成之和都在其中，伤害计算按分量读，故原样带出
    out["staticAttr"] = this.#attr
    return out as AttrResult
  }

  /**
   * 取白值表
   *
   * 圣遗物评分把小词条折算成大词条时以它作分母。
   * @returns 属性键 → 白值
   */
  getBase(): Record<string, number> {
    return this.#base
  }
}
