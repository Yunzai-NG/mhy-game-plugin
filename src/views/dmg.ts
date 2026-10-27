/**
 * 模块职责：伤害计算结果 → 面板模板要的 `dmgCalc` —— 只做取舍与格式化，不算伤害
 * 依赖方向：依赖 panel/dmg/detail 的结果类型与 views/panel 的数字格式化；不碰 IO
 * 生命周期：纯函数
 * 注意事项：算出来的形态（`{ret,msg,...}` 数值）与模板要的（`{dmgData,dmgMsg,...}` 串）不是一个，这一层就是那道转换。
 *          **暴击伤害缺失时给字面 `"NaN"`、不是 `0`、也不是不给**：剧变反应不暴击、模板三处都拿这串去比（`=== "NaN"`），给 `0` 会走「有暴击」支印出「0/期望」两格、对比表处不给则拼出 `/undefined`。
 *          **`type` 为 `text` 的行不能再格式化**（公式已给成 `28.0%`、再过千分位得 `NaN`，判据 `type !== "text"`）。**基准行不是数字时整块词条对比不画**（逐格减出 `NaN`），伤害表与 Buff 列表照常。**`msg` 是「标题：内容」串**，模板按两列画、按全角冒号切第一处。
 */
import type { DmgCalcResult, DmgCompare } from "../panel/dmg/index.js"
import { comma } from "./panel.js"

/** 没有暴击伤害时那一格的值，见文件头 */
const NO_CRIT = "NaN"

/** 模板里 `dmgCalc` 的形态 */
export interface DmgCalcView {
  /** 逐条伤害，已格式化 */
  dmgData: DmgDataRow[]
  /** 当前展示那条的 buff 文案，逐条切成两列 */
  dmgMsg: string[][]
  /** 敌人名 */
  enemyName: string
  /** 敌人等级 */
  enemyLv: number
  /** 公式作者，空串时模板不画那一行 */
  createdBy: string
  /** 词条收益对比的配置，只在 `dmg` 模式下有 */
  dmgCfg?: DmgCfgView
  /** 词条收益对比的表体，只在 `dmg` 模式下有 */
  dmgRet?: DmgCellView[][]
}

/** 伤害表里的一行 */
export interface DmgDataRow {
  /** 标题 */
  title: string
  /** 期望伤害 */
  avg: string
  /** 暴击伤害；不暴击时为 `"NaN"`，见文件头 */
  dmg: string
  /** 文本型结果 */
  type?: string
  /** 面板替换后期望伤害比原面板多出的量，带正负号；没有原面板或不变时省略 */
  avgDiff?: string
  /** 同上，暴击伤害那一格 */
  dmgDiff?: string
}

/** 对比表的一格 */
export interface DmgCellView {
  /** 格子类型 */
  type: string
  /** 与基准的差值，带正号 */
  val?: string
  /** 期望伤害 */
  avg?: string
  /** 暴击伤害；不暴击时为 `"NaN"` */
  dmg?: string
}

/** 对比表的配置 */
export interface DmgCfgView {
  /** 被对比的那条伤害的标题 */
  title: string
  /** 它的序号 */
  userIdx: number
  /** 基准结果 */
  basicRet: { avg: string; dmg: string }
  /** 参与对比的词条 */
  attr: { title: string; text: string }[]
}

/**
 * 数值转成模板要的串，非有限数给 `"NaN"`
 * @param one 数值
 * @returns 已加千分位的串，或 `"NaN"`
 */
function num(one: unknown): string {
  const value = Number(one)
  return Number.isFinite(value) ? comma(value, 0) : NO_CRIT
}

/**
 * 两个原值之差，带正负号；任一边不是数或差为零时 undefined
 * @param now 现值
 * @param before 原值
 * @returns 形如 `+1,234` / `-567`
 */
function diffOf(now: unknown, before: unknown): string | undefined {
  const a = Number(now)
  const b = Number(before)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined
  const diff = Math.round(a - b)
  if (diff === 0) return undefined
  return `${diff > 0 ? "+" : "-"}${comma(Math.abs(diff), 0)}`
}

/**
 * 把伤害计算结果转成模板要的形态
 *
 * 给了 `base`（面板替换前那份的结果）时逐行带上差值。按标题配对而不按下标：换了命座，
 * 公式可能多出或少掉几行。比的是原值，格式化后的串经千分位与取整，减出来会差一两点。
 * @param got 伤害计算结果
 * @param base 替换前的伤害计算结果
 * @returns 模板数据；没有可展示的伤害时仍返回（模板按 `dmgData.length` 判空）
 */
export function dmgCalcView(got: DmgCalcResult, base?: DmgCalcResult): DmgCalcView {
  const before = new Map((base?.ret ?? []).filter(one => one.type !== "text").map(one => [one.title, one]))
  const out: DmgCalcView = {
    dmgData: got.ret.map(one => {
      // 文本型的那些已由公式自己格式化好，再过一遍千分位只会得到 NaN
      const text = one.type === "text"
      const row: DmgDataRow = {
        title: one.title,
        avg: text ? String(one.avg ?? "") : num(one.avg),
        dmg: text ? (one.dmg === undefined ? NO_CRIT : String(one.dmg)) : num(one.dmg)
      }
      if (one.type) row.type = one.type
      const old = text ? undefined : before.get(one.title)
      if (old) {
        const avgDiff = diffOf(one.avg, old.avg)
        const dmgDiff = diffOf(one.dmg, old.dmg)
        if (avgDiff) row.avgDiff = avgDiff
        if (dmgDiff) row.dmgDiff = dmgDiff
      }
      return row
    }),
    dmgMsg: got.msg.map(splitMsg),
    enemyName: got.enemyName,
    enemyLv: got.enemyLv,
    createdBy: got.createdBy
  }
  if (got.compare && Number.isFinite(Number(got.compare.basic?.avg))) {
    out.dmgCfg = cfgView(got.compare)
    out.dmgRet = rowsView(got.compare)
  }
  return out
}

/**
 * 出图失败时的纯文字伤害表
 *
 * 只列前八条（伤害表往往十几条、全塞一条消息读不下来，最靠前的正是公式作者按重要性排的）。
 * @param name 角色名
 * @param got 已格式化的伤害视图
 * @returns 文本
 */
export function dmgText(name: string, got: DmgCalcView): string {
  const lines = [`${name} 伤害计算（目标 ${got.enemyLv} 级${got.enemyName}）`]
  for (const one of got.dmgData.slice(0, 8)) {
    const crit = one.dmg === NO_CRIT ? "" : ` / 暴击 ${one.dmg}`
    lines.push(`  ${one.title} ${one.avg}${crit}`)
  }
  if (got.dmgData.length > 8) lines.push(`  …另有 ${got.dmgData.length - 8} 条`)
  if (got.createdBy) lines.push(`公式来源 ${got.createdBy}`)
  return lines.join("\n")
}

/**
 * 把一条 buff 文案切成两列
 * @param one 文案，形如「雾切之回光：元素伤害加成 +12%」
 * @returns 两列；没有冒号时第二列为空串
 */
function splitMsg(one: string): string[] {
  const at = one.indexOf("：")
  if (at < 0) return [one, ""]
  return [one.slice(0, at), one.slice(at + 1)]
}

/**
 * 对比表的配置
 * @param compare 对比结果
 * @returns 配置视图
 */
function cfgView(compare: DmgCompare): DmgCfgView {
  return {
    title: compare.title,
    userIdx: compare.userIdx,
    basicRet: { avg: num(compare.basic?.avg), dmg: num(compare.basic?.dmg) },
    attr: compare.attrs.map(one => ({ title: one.title, text: one.text }))
  }
}

/**
 * 对比表的表体
 *
 * `val` 是与基准的差值、模板当大号数字印。**正数要带正号**（表达「换这词条高/低多少」，不带则看不出方向）。
 * @param compare 对比结果
 * @returns 逐行逐格的视图
 */
function rowsView(compare: DmgCompare): DmgCellView[][] {
  const base = Number(compare.basic?.avg) || 0
  return compare.rows.map(row =>
    row.map(cell => {
      const out: DmgCellView = { type: cell.type }
      // 对角线那一格模板走另一支（印基准值），不需要这三项
      if (cell.type === "na") return out
      const avg = Number(cell.avg) || 0
      const diff = avg - base
      out.val = `${diff > 0 ? "+" : ""}${comma(diff, 0)}`
      out.avg = comma(avg, 0)
      out.dmg = num(cell.dmg)
      return out
    })
  )
}
