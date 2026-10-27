/**
 * 模块职责：活动日历（`#活动日历`）的视图出口 —— 按游戏分派、补页头，另给出图失败时的文字版
 * 依赖方向：依赖 views/{gs,sr,zzz}/act-calendar 与 act-calendar-row，无 IO
 * 生命周期：无状态
 * 注意事项：三个游戏共用一张模板（`act-calendar`），皮肤按视图里的 `game` 选；漏了它整张图退回中性皮。
 *          文字版只列名字与时间，奖励与进度不进去 —— 那几项离了图读不明白。
 */
import { INDENT, stamp } from "../core/text.js"
import type { ActBody, ActContext, ActRow } from "./act-calendar-row.js"
import type { GsActCalendarRaw } from "./gs/act-calendar.js"
import { gsActCalendar } from "./gs/act-calendar.js"
import type { SrActCalendarRaw } from "./sr/act-calendar.js"
import { srActCalendar } from "./sr/act-calendar.js"
import type { ZzzActCalendarRaw, ZzzActivityCalendarRaw, ZzzGachaCalendarRaw } from "./zzz/act-calendar.js"
import { zzzActCalendar } from "./zzz/act-calendar.js"

export type { ActBody, ActContext, ActFace, ActItemMeta, ActPool, ActRow, ActSection } from "./act-calendar-row.js"
export type { GsActCalendarRaw, SrActCalendarRaw, ZzzActCalendarRaw, ZzzActivityCalendarRaw, ZzzGachaCalendarRaw }

/** 三个游戏的原始数据 */
export type ActCalendarRaw = GsActCalendarRaw | SrActCalendarRaw | ZzzActCalendarRaw

/** 模板 */
export const ACT_CALENDAR_TEMPLATE = "act-calendar"

/** 整张图的视图 */
export interface ActCalendarView extends ActBody, Record<string, unknown> {
  /** 游戏，选皮肤用 */
  game: string
  /** uid */
  uid: string
  /** 发起者昵称 */
  name: string
  /** 页头副标题 */
  day: string
}

/**
 * 原始数据 → 视图
 * @param raw 接口返回的 data（绝区零为两条合起来）
 * @param ctx 上下文
 * @returns 视图
 */
export function buildActCalendar(raw: ActCalendarRaw, ctx: ActContext): ActCalendarView {
  const body =
    ctx.game === "gs"
      ? gsActCalendar(raw as GsActCalendarRaw, ctx)
      : ctx.game === "sr"
        ? srActCalendar(raw as SrActCalendarRaw, ctx)
        : zzzActCalendar(raw as ZzzActCalendarRaw, ctx)
  for (const sec of body.sections) {
    for (const block of sec.blocks) {
      for (const row of block.rows) {
        row.text = row.value !== "" && !/\d/.test(row.value)
        // 同一件不印两遍：详细奖励只有右边那一件时留右边，否则右边让给详细奖励那一排
        if (row.items.length === 1 && row.items[0]?.name === row.rewardName) row.items = []
        else if (row.items.length > 0) Object.assign(row, { reward: "", rewardIcon: "", rewardName: "" })
      }
    }
  }
  return { ...body, game: ctx.game, uid: ctx.uid, name: ctx.name, day: stamp(ctx.now) }
}

/**
 * 一条活动 → 一行文字
 * @param row 活动
 * @returns 文字
 */
function rowText(row: ActRow): string {
  const tail = row.done || row.check ? "已完成" : row.time || row.value
  return tail ? `${row.name}${INDENT}${tail}` : row.name
}

/**
 * 出图失败时的文字版
 * @param view 视图
 * @returns 文字
 */
export function actCalendarText(view: ActCalendarView): string {
  const lines = [`活动日历${INDENT}UID ${view.uid}`]
  for (const group of view.groups) {
    lines.push("", `【${view.poolTitle}·${group.title}】`)
    for (const pool of group.pools) {
      const names = pool.faces.map(f => f.name).filter(Boolean).join("、")
      lines.push(`${pool.version} ${pool.name}${INDENT}${pool.time || pool.state}`)
      if (names) lines.push(`${INDENT}${names}`)
    }
  }
  for (const sec of view.sections) {
    lines.push("", `【${sec.title}】${sec.note ? `${INDENT}${sec.note}` : ""}`)
    for (const block of sec.blocks) for (const row of block.rows) lines.push(rowText(row))
  }
  return lines.filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n").trim()
}
