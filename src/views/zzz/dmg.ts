/**
 * 模块职责：绝区零伤害结果 → 面板模板要的 `dmgCalc` —— 只做取舍与格式化，不算伤害
 * 依赖方向：依赖 panel/dmg/zzz 的结果类型与 views/panel 的数字格式化；不碰 IO
 * 生命周期：纯函数
 * 注意事项：**刻意产出与 `views/dmg.ts` 逐键同形的对象**（三游戏伤害栏共用同段模板、一行不必改）。**没有暴击伤害时给字面 `"NaN"`**（模板既定判据，给 `0` 会走「有暴击」支印「0/期望」两格，异常伤害正是此情形）。
 *          **`dmgMsg` 是 buff 列表、按两列画**（绝区零 buff 自带 `name`/`type`/`value`、直接拼两列不必切串）。**本层不判「该不该算」**（元数据缺席/倍率取不到由 `zzzDmgOf` 返回 undefined 表达）。
 */
import type { ZzzBuffResult, ZzzDmgData } from "../../panel/dmg/zzz/index.js"
import { comma, pct } from "../panel.js"

/** 没有暴击伤害时那一格的值，见文件头 */
const NO_CRIT = "NaN"

/** 伤害表里最多印几条 */
const MAX_ROWS = 12

/** buff 列表最多印几条 */
const MAX_BUFFS = 10

/** 模板里 `dmgCalc` 的形态，与 `views/dmg.ts` 的 `DmgCalcView` 同形 */
export interface ZzzDmgView {
  /** 逐条伤害，已格式化 */
  dmgData: { title: string; avg: string; dmg: string }[]
  /** buff 文案，逐条两列 */
  dmgMsg: string[][]
  /** 敌人名 */
  enemyName: string
  /** 敌人等级 */
  enemyLv: number
  /** 公式作者；本仓库自己算的，故印来源而不是人名 */
  createdBy: string
}

/**
 * 一条 buff → 两列文案
 *
 * 左列是名字、右列是「乘区 +值」。**百分比与点数要分开印**：暴击率那类是比例（`0.08` → `+8.0%`）、异常精通那类是点数（`30` → `+30`）。判据取乘区名 —— buff 值在同一个字段里两种含义（见 `panel/dmg/zzz/buff.ts`），而这里已是算完的成品值。
 * @param one 一条算好的 buff
 * @returns 两列
 */
function buffRow(one: ZzzBuffResult): string[] {
  const flat = FLAT_TYPES.has(one.type)
  const value = flat ? `+${comma(one.value, 0)}` : `+${pct(one.value * 100)}`
  return [one.name, `${one.type} ${value}`]
}

/**
 * 值是点数而非比例的那几个乘区
 *
 * 其余乘区（增伤、易伤、暴击率……）都是比例，印成百分数。
 */
const FLAT_TYPES: ReadonlySet<string> = new Set<string>([
  "攻击力",
  "生命值",
  "防御力",
  "冲击力",
  "异常掌控",
  "异常精通",
  "穿透值",
  "贯穿力"
])

/**
 * 把绝区零伤害结果转成模板要的形态
 *
 * **buff 列表取自伤害最高那一条**：逐条各印一份会让列表长到几十行，而各条差别通常只在招式限定的那一两条上；这也与另两个游戏「当前展示那条的 buff」同一个口径。
 * **假想敌名与公式作者都由伤害层给**，本层不再自带缺省值：那两项出自元数据里
 * `calc.js` 的 `enemyName` / `createdBy`（与原神星铁同一副做法），在这里另设一个缺省
 * 只会让"包里写了什么"与"图上印了什么"两处对不上。
 * @param got 伤害层算出的结果
 * @returns 模板数据
 */
export function zzzDmgView(got: ZzzDmgData): ZzzDmgView {
  const top = got.list[0]
  return {
    dmgData: got.list.slice(0, MAX_ROWS).map(one => ({
      title: one.name,
      avg: comma(one.avg, 0),
      // 不会暴击时给字面的 NaN，那是模板的判据
      dmg: one.crit > 0 ? comma(one.crit, 0) : NO_CRIT
    })),
    dmgMsg: (top?.buffs ?? []).slice(0, MAX_BUFFS).map(buffRow),
    enemyName: got.enemyName,
    enemyLv: got.enemy.level,
    createdBy: got.createdBy
  }
}

/**
 * 出图失败时的纯文字伤害表
 *
 * 只列前八条，与另两个游戏那一份同一个口径。
 * @param name 代理人名
 * @param got 已格式化的伤害视图
 * @returns 文本
 */
export function zzzDmgText(name: string, got: ZzzDmgView): string {
  const lines = [`${name} 伤害计算（目标 ${got.enemyLv} 级${got.enemyName}）`]
  for (const one of got.dmgData.slice(0, 8)) {
    const crit = one.dmg === NO_CRIT ? "" : ` / 暴击 ${one.dmg}`
    lines.push(`  ${one.title} ${one.avg}${crit}`)
  }
  if (got.dmgData.length > 8) lines.push(`  …另有 ${got.dmgData.length - 8} 条`)
  return lines.join("\n")
}
