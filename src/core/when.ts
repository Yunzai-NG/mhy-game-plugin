/**
 * 模块职责：时刻的解析、加减与格式化 —— 本仓库不引日期库，这里是它的替代
 * 依赖方向：纯函数，不碰 IO
 * 生命周期：无状态
 * 注意事项：一律按本地时区，且解析前先把短横线换成斜杠 —— `new Date("2026-08-12 06:00:00")`
 *          在部分 Node 版本上按 UTC 解析。差八小时不报错，只让日历进度条整体偏移。
 */

/** 一天的毫秒数 */
export const DAY_MS = 86_400_000

/**
 * 解析 `2026-08-12 06:00:00` 一类的时刻
 *
 * 也认斜杠写法与只有日期的写法。
 * @param text 时刻串
 * @returns 毫秒值；解析不出时为 0
 */
export function parseWhen(text: string): number {
  const ms = new Date(text.trim().replace(/-/g, "/")).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * 加减若干天
 * @param ms 毫秒值
 * @param days 天数，可为负
 * @returns 新的毫秒值
 */
export function addDays(ms: number, days: number): number {
  const at = new Date(ms)
  at.setDate(at.getDate() + days)
  return at.getTime()
}

/**
 * 把时刻挪到当天的某个整点
 * @param ms 毫秒值
 * @param hour 小时
 * @returns 新的毫秒值，分秒毫秒一律归零
 */
export function atHour(ms: number, hour: number): number {
  const at = new Date(ms)
  at.setHours(hour, 0, 0, 0)
  return at.getTime()
}

/**
 * 补两位
 * @param n 数字
 * @returns 两位字符串
 */
function two(n: number): string {
  return String(n).padStart(2, "0")
}

/**
 * 格式化成 `08-12 06:00`
 * @param ms 毫秒值
 * @returns 月日与时分
 */
export function monthDayTime(ms: number): string {
  const at = new Date(ms)
  return `${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`
}

/**
 * 格式化成 `2026-08-12 06:00`
 * @param ms 毫秒值
 * @returns 年月日与时分
 */
export function dateTime(ms: number): string {
  const at = new Date(ms)
  return `${at.getFullYear()}-${monthDayTime(ms)}`
}

/**
 * 格式化成 `2026-08-12 06:00:00`
 * @param ms 毫秒值
 * @returns 年月日与时分秒
 */
export function fullTime(ms: number): string {
  return `${dateTime(ms)}:${two(new Date(ms).getSeconds())}`
}

/**
 * 格式化成 `2026-08-12`
 * @param ms 毫秒值
 * @returns 年月日
 */
export function isoDate(ms: number): string {
  const at = new Date(ms)
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
}
