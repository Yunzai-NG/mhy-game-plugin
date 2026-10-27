/**
 * 模块职责：元素精通对各类反应的加成
 * 依赖方向：依赖 dmg/meta 的反应表；纯函数
 * 生命周期：无状态
 * 注意事项：**分子要写成分数而非小数**（`25/9`、`40/9` 而非 2.78、4.44），写小数在高精通下差出可见伤害；各类公式见下方 switch。
 *          不认得的反应键返回 0 而非抛错：一个反应算不出不该让整张面板出不来，0 表现为「该反应无精通加成」。
 */
import { ER_TYPE } from "./meta.js"

/**
 * 算元素精通给某类反应的加成倍率
 * @param type 反应键
 * @param mastery 元素精通
 * @returns 加成倍率；该反应不吃精通或反应键不认得时 0
 */
export function masteryMultiple(type: string, mastery = 0): number {
  const cfg = ER_TYPE[type]
  if (!cfg) return 0
  const m = Math.max(0, Number(mastery) || 0)
  switch (cfg.type) {
    case "pct":
      return ((25 / 9) * m) / (m + 1400)
    case "fusion":
      return (16 * m) / (m + 2000)
    case "lunar":
    case "stellar":
      return (6 * m) / (m + 2000)
    case "bonus":
      return (5 * m) / (m + 1200)
    case "shield":
      return ((40 / 9) * m) / (m + 1400)
    default:
      return 0
  }
}

/**
 * 取某类反应的基数
 *
 * 三项上下文各有用处，见 {@link ErCtx}：蒸发融化看元素、月反应与星扩散看是不是走 `reaction()`（`talent` 为 `"fy"`）、星超导看叠层数。
 * @param type 反应键
 * @param element 当前元素名，如 `"水"`
 * @param talent 当前天赋；`"fy"` 即纯反应伤害那一路
 * @param params 公式参数，叠层数一类
 * @returns 基数；反应键不认得、或该反应算出 0 时 1（即不改变伤害）
 */
export function masteryBasePct(
  type: string,
  element = "",
  talent: string | false = false,
  params: Record<string, unknown> = {}
): number {
  const cfg = ER_TYPE[type]
  if (!cfg) return 1
  return cfg.num({ element, talent, params }) || 1
}
