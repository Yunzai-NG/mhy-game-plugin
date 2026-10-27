/**
 * 模块职责：公式文件里 `Format` 与 `lodash` 那几个成员的宿主侧实现，以及给沙箱的注入数据
 * 依赖方向：无依赖，纯函数
 * 生命周期：模块级常量
 * 注意事项：沙箱里用的是 meta/sandbox.ts 的 PRELUDE 那份（宿主函数塞进上下文即逃逸），本文件这份给宿主自己用，
 *          **两份与 dmg/attr.ts 的 `fmt` 三处同口径**（sandbox.test.ts 逐值比对）：`comma` 千分位分组固定 3，
 *          `fix > 0` 时恒补足小数位、整数也补 `.0`。不一致的表现是每条 buff 文案变样，只能逐字比对发现。
 */
import type { SandboxDeps } from "../../meta/sandbox.js"

/** 千分位分组位数 */
const COMMA_GROUP = 3

/**
 * 千分位格式化
 *
 * `fix > 0` 时恒带该位数的小数，缺位补零。
 * @param num 数值
 * @param fix 小数位数
 * @returns 文本
 */
export function comma(num: number, fix = 0): string {
  const fixed = Number.parseFloat((Number(num) || 0).toFixed(fix))
  const [int = "", dec] = String(fixed).split(".")
  const re = new RegExp(`\\d(?=(\\d{${COMMA_GROUP}})+$)`, "g")
  const grouped = int.replace(re, "$&,")
  if (fix <= 0) return grouped
  return `${grouped}.${dec ?? "0".repeat(fix)}`
}

/**
 * 百分数格式化
 *
 * 直接按位数取整并加百分号，不乘 100。
 * @param num 数值，已是百分数
 * @param fix 小数位数
 * @returns 文本
 */
export function pct(num: number, fix = 1): string {
  return `${(Number(num) || 0).toFixed(fix)}%`
}

/**
 * 比例转百分数
 *
 * 先乘 100 再加百分号。公式文件里用得最多的就是它。
 * @param num 比例，如 0.35
 * @param fix 小数位数
 * @returns 文本，如 `"35.0%"`
 */
export function percent(num: number, fix = 1): string {
  return pct((Number(num) || 0) * 100, fix)
}

/**
 * 遍历数组或对象，回调返回 `false` 即中断
 *
 * **中断语义不可省**：角色公式里有靠 `return false` 提前结束的写法，不支持它会让那些公式多跑几圈并可能算错。
 * @param coll 数组或对象
 * @param fn 回调，返回 `false` 时中断
 */
export function forEach(coll: unknown, fn: (val: unknown, key: unknown) => unknown): void {
  if (!coll || typeof coll !== "object") return
  if (Array.isArray(coll)) {
    for (const [idx, val] of coll.entries()) {
      if (fn(val, idx) === false) return
    }
    return
  }
  for (const [key, val] of Object.entries(coll as Record<string, unknown>)) {
    if (fn(val, key) === false) return
  }
}

/**
 * 造一份沙箱依赖
 *
 * `usefulAttr` 由调用方按游戏给出：那 57 个 `artis.js` 以相对路径 import 它，它是纯数据、已离线转 JSON，故按注入处理而不求值那文件。
 * @param usefulAttr 默认圣遗物评分表
 * @returns 沙箱依赖
 */
export function sandboxDeps(usefulAttr: Record<string, unknown> = {}): SandboxDeps {
  return { usefulAttr }
}
