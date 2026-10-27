/**
 * 模块职责：绝区零的公式调用约定 —— 建倍率表、造 `dmg` 函数、跑元数据里的 `details`
 * 依赖方向：依赖同目录 attr / buff / calc 与 meta/loader 的类型；纯计算，不碰 IO
 * 生命周期：无状态
 * 注意事项：刻意与 `dmg/detail.ts`（原神星铁那份）同一副调用约定，故绝区零的 `character/<名>/calc.js` 写法与另两个游戏一致。
 *          倍率按名字从元数据现取（`talent.<族>[<倍率名>]` 取当前技能等级那一档），故升级或改数值不必改公式。**绝区零倍率是带百分号的字符串**（`"328.6%"`），在 {@link zzzRate} 里化解成小数（让公式自己 parseFloat 会漏一份、大一百倍）。
 *          **族名与面板技能等级键不同名**（元数据 `basic`、接口 `normal`），映射只写在 {@link GROUP_LEVEL_KEY} 一处、取错栏伤害偏差不报错。技能类型的第二参给 buff 筛选用（`range` 前缀匹配），不参与倍率查表。
 */
import type { MetaDetail } from "../../../meta/loader.js"
import type { ZzzCalcCtx, ZzzDmgResult, ZzzSkill } from "./calc.js"
import { zzzCalcSkill } from "./calc.js"
import { zzzRateAt } from "./skill.js"

/**
 * 元数据的技能族 → 面板技能等级的键
 *
 * 只有 `basic`/`normal` 不同名，其余四族同名；仍逐条列出（同名是巧合而非约定）。
 */
const GROUP_LEVEL_KEY: Readonly<Record<string, string>> = {
  basic: "normal",
  dodge: "dodge",
  assist: "assist",
  special: "special",
  chain: "chain"
}

/**
 * 把一个倍率值折成可直接相乘的小数
 *
 * 元数据存的是成品文本（`"328.6%"`/`"60点"`），带百分号除以 100、其余取数值部分（能量消耗类取到也不抛错）。
 * @param raw 元数据里那一档的值
 * @returns 小数；取不出时 0
 */
export function zzzRate(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0
  const text = String(raw ?? "").trim()
  if (!text) return 0
  const num = Number.parseFloat(text)
  if (Number.isNaN(num)) return 0
  return text.endsWith("%") ? num / 100 : num
}

/**
 * 建倍率表，供公式按 `talent.<族>[<倍率名>]` 取用
 *
 * 逐族按该族自己的技能等级取一档。**一族里同名的行会出现多次**（`special` 里两条「伤害倍率」是特殊技与强化特殊技），
 * 头一条落原名、其后落 `<名>2`/`<名>3`…（一律覆盖则强化特殊技那刀取不到自己的倍率）。
 * @param talentLevel 面板给的技能等级，键为 `normal` / `special` 等
 * @param detail 代理人的整份 `data.json`
 * @returns 族名 → 倍率名 → 该等级的小数值；另有 `talentLevel` 一项原样带回
 */
export function zzzTalentTables(
  talentLevel: Readonly<Record<string, number>>,
  detail: MetaDetail | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = { talentLevel }

  for (const [group, levelKey] of Object.entries(GROUP_LEVEL_KEY)) {
    const level = Number(talentLevel[levelKey]) || 1
    const map: Record<string, number> = {}
    const tables = detail?.talent?.[group]?.tables ?? []

    for (const table of tables) {
      const name = table.name
      if (!name) continue
      // 等级超出表长时按等差外推（官方表只 12 档而技能等级可到 16），见 {@link zzzRateAt}
      const value = zzzRateAt(table.values, level)
      // 同名的第二条起改落 `<名>2` / `<名>3`，否则强化特殊技取不到自己那一档
      let key = name
      for (let idx = 2; key in map; idx++) key = `${name}${idx}`
      map[key] = value
    }
    out[group] = map
  }
  return out
}

/**
 * 公式里那个 `dmg` 函数
 *
 * 与原神星铁的 {@link DmgFn} 同一副形态：直接调是常规伤害，另有三个变体。
 */
export interface ZzzDmgFn {
  /**
   * 算一刀常规伤害
   * @param rate 倍率，小数
   * @param type 技能类型，buff 的 `range` 按前缀匹配它
   * @param element 属性；缺省取代理人自身那种
   * @returns 伤害结果
   */
  (rate: number, type?: string, element?: string): ZzzDmgResult
  /**
   * 算一刀属性异常伤害
   *
   * 不吃常规暴击、另吃异常精通区与等级区，见 `calc.ts`。
   * @param rate 倍率
   * @param type 技能类型
   * @param element 属性
   * @returns 伤害结果
   */
  anomaly: (rate: number, type?: string, element?: string) => ZzzDmgResult
  /**
   * 算一刀贯穿伤害（命破那一族）
   *
   * 不吃防御区、改吃贯穿增伤区；贯穿力缺省是攻击力的三成取整。
   * @param rate 倍率
   * @param type 技能类型
   * @param element 属性
   * @returns 伤害结果
   */
  sheer: (rate: number, type?: string, element?: string) => ZzzDmgResult
  /**
   * 算一刀锐化伤害（锋御那一族）
   *
   * 用**防御力**而非攻击力作基数，暴击吃**锐暴伤害**、另有锐化增伤区，暴击率钳到 2（超 100% 部分再判一次锐暴）。见 `calc.ts`。
   * @param rate 倍率
   * @param type 技能类型
   * @param element 属性
   * @returns 伤害结果
   */
  sharp: (rate: number, type?: string, element?: string) => ZzzDmgResult
  /**
   * 把几刀加成一条
   *
   * 连招（「三段普攻 + 一段强化特殊技」）在图上是一行，故要能相加。
   * @param list 各刀的结果
   * @returns 合并后的结果，取头一刀的乘区
   */
  sum: (...list: readonly ZzzDmgResult[]) => ZzzDmgResult
}

/**
 * 造一个 `dmg` 函数
 * @param ctx 计算上下文
 * @returns 公式里用的那个 `dmg`
 */
export function zzzDmgFn(ctx: ZzzCalcCtx): ZzzDmgFn {
  /**
   * 算一刀
   * @param skill 技能声明
   * @returns 结果
   */
  const run = (skill: ZzzSkill): ZzzDmgResult => zzzCalcSkill(skill, ctx)

  const fn = ((rate: number, type = "AP", element?: string): ZzzDmgResult =>
    run({ name: "", type, multiplier: zzzRate(rate), ...(element ? { element } : {}) })) as ZzzDmgFn

  fn.anomaly = (rate: number, type = "AP", element?: string): ZzzDmgResult =>
    run({ name: "", type, multiplier: zzzRate(rate), isAnomaly: true, ...(element ? { element } : {}) })

  fn.sheer = (rate: number, type = "AP", element?: string): ZzzDmgResult =>
    run({ name: "", type, multiplier: zzzRate(rate), isSheer: true, ...(element ? { element } : {}) })

  fn.sharp = (rate: number, type = "AP", element?: string): ZzzDmgResult =>
    run({ name: "", type, multiplier: zzzRate(rate), isSharp: true, ...(element ? { element } : {}) })

  fn.sum = (...list: readonly ZzzDmgResult[]): ZzzDmgResult => {
    const head = list[0]
    if (!head) return { name: "", type: "", crit: 0, avg: 0, cpct: 0, cdmg: 0, areas: EMPTY_AREAS, buffs: [] }
    let crit = 0
    let avg = 0
    for (const one of list) {
      crit += one.crit || one.avg
      avg += one.avg
    }
    return { ...head, crit, avg }
  }

  return fn
}

/** 空乘区，`sum` 在一刀都没有时用它 —— 那种情形只出现在公式写错时 */
const EMPTY_AREAS = {
  basic: 0,
  critical: 1,
  boost: 1,
  vulnerability: 1,
  resistance: 1,
  defence: 1,
  stun: 1
} as const

/** 元数据 `calc.js` 里 `details` 的一条 */
export interface ZzzDetailSpec {
  /** 标题，印在伤害表那一行 */
  title?: string
  /** 算这一行的函数 */
  dmg?: (ds: ZzzDataSet, fn: ZzzDmgFn) => ZzzDmgResult
  /** 生效条件，返回假时这一行不出 */
  check?: (ds: ZzzDataSet) => unknown
  /** 所需影画数 */
  cons?: number
}

/** 公式拿到的那份数据集，即 `dmg` 的第一个参数 */
export interface ZzzDataSet {
  /** 倍率表，按 `talent.<族>[<倍率名>]` 取 */
  talent: Record<string, unknown>
  /** 最终属性表，键为 `atk` / `cpct` 一类 */
  attr: Record<string, number>
  /** 白值表 */
  base: Record<string, number>
  /** 影画数 */
  cons: number
  /** 代理人等级 */
  level: number
  /** 音擎叠影；没装时 0 */
  star: number
  /** 代理人自身的属性伤害类型，如 `冰` */
  element: string
}

/**
 * 跑一遍元数据里的 `details`
 *
 * **逐条各自 try**：一条公式写错（取到不存在的倍率名而得 `undefined`）只该让那一行不出、不该让整栏消失（少一行可发现，而整栏不出与「这位没公式」无从区分）。
 * @param details 元数据里那份 `details`
 * @param ctx 计算上下文
 * @param detail 代理人的整份 `data.json`
 * @returns 逐行结果，按 `details` 自己的顺序（那是公式作者排的重要性）
 */
export function zzzRunDetails(
  details: readonly ZzzDetailSpec[],
  ctx: ZzzCalcCtx,
  detail: MetaDetail | undefined
): ZzzDmgResult[] {
  const fn = zzzDmgFn(ctx)
  const ds: ZzzDataSet = {
    talent: zzzTalentTables(ctx.talent, detail),
    attr: ctx.attr.final as Record<string, number>,
    base: ctx.attr.base as Record<string, number>,
    cons: ctx.rank,
    level: ctx.level,
    star: ctx.star,
    element: ctx.element
  }

  const out: ZzzDmgResult[] = []
  for (const spec of details) {
    if (typeof spec?.dmg !== "function") continue
    // 影画不够或条件不成立的那几行不出
    if (typeof spec.cons === "number" && ctx.rank < spec.cons) continue
    try {
      if (spec.check && !spec.check(ds)) continue
      const got = spec.dmg(ds, fn)
      if (!got?.avg) continue
      out.push({ ...got, name: spec.title ?? got.name })
    } catch {
      continue
    }
  }
  return out
}
