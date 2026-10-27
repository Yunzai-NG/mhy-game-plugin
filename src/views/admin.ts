/**
 * 模块职责：Cookie 概况（`#用户统计`）的视图模型 —— 可用 / 失效 / 今日已查，按国服与国际服分组
 * 依赖方向：只依赖 store/ck 的类型与 core/text；被 commands/admin 调用，不碰 IO
 * 生命周期：无状态纯函数
 * 注意事项：本地不设查询上限，故没有「剩余次数」可算；逐条的条长按本组用得最多的那条折算，
 *          只表示相对多少。「可用」排除停用与米游社判今日到顶（`blocked`）的两种。
 */
import type { CookieRecord, CookieUsage } from "../store/ck.js"
import { maskLtuid, INDENT } from "../core/text.js"

/** 一条 CK 在概况里的展示形态 */
export interface AdminCkItem {
  /** 遮蔽后的账号标识 */
  ltuid: string
  /** 今日已用次数 */
  num: number
  /** 条长百分比，相对本组用得最多的那条 */
  pct: number
  /** 是否已停用 */
  disabled: boolean
  /** 停用原因 */
  reason?: string
}

/** 一组（国服 / 国际服）的统计 */
export interface AdminServCount {
  /** CK 总数 */
  total: number
  /** 可用数 */
  normal: number
  /** 失效数 */
  disable: number
  /** 今日已消耗次数 */
  query: number
}

/** 一组的明细与统计 */
export interface AdminServ {
  /** 明细，按今日已用次数降序 */
  list: AdminCkItem[]
  /** 统计 */
  count: AdminServCount
}

/** Cookie 池概况视图 */
export interface AdminView {
  /** 按来源分组，键为 `mys`（国服）与 `hoyolab`（国际服） */
  servs: Record<string, AdminServ>
  /** 合计 */
  count: AdminServCount
}

/** 造视图所需的一条记录 */
export interface AdminInput {
  /** CK 记录 */
  record: CookieRecord
  /** 使用情况 */
  usage: CookieUsage
  /** 是否国际服账号 */
  os?: boolean
}

/** 空统计，作为累加的初值 */
function emptyCount(): AdminServCount {
  return { total: 0, normal: 0, disable: 0, query: 0 }
}

/**
 * 汇总一组 CK
 * @param items 该组的输入
 * @returns 明细与统计
 */
function summarize(items: readonly AdminInput[]): AdminServ {
  const top = Math.max(0, ...items.map(it => it.usage.used))
  const list = items.map(({ record, usage }) => {
    const one: AdminCkItem = {
      ltuid: maskLtuid(record.ltuid),
      num: usage.used,
      pct: top > 0 ? Math.round((usage.used / top) * 100) : 0,
      disabled: usage.disabled
    }
    if (usage.reason) one.reason = usage.reason
    return one
  })
  list.sort((a, b) => b.num - a.num || a.ltuid.localeCompare(b.ltuid))

  const count: AdminServCount = {
    total: items.length,
    normal: items.filter(it => !it.usage.disabled && !it.usage.blocked).length,
    disable: items.filter(it => it.usage.disabled).length,
    query: items.reduce((sum, it) => sum + it.usage.used, 0)
  }
  return { list, count }
}

/**
 * Cookie 池 → 概况视图
 * @param items 全部 CK 的记录与使用情况
 * @returns 视图
 */
export function buildAdmin(items: readonly AdminInput[]): AdminView {
  const servs: Record<string, AdminServ> = {
    mys: summarize(items.filter(it => !it.os)),
    hoyolab: summarize(items.filter(it => it.os === true))
  }

  const total = emptyCount()
  for (const serv of Object.values(servs)) {
    total.total += serv.count.total
    total.normal += serv.count.normal
    total.disable += serv.count.disable
    total.query += serv.count.query
  }
  return { servs, count: total }
}

/**
 * 概况视图 → 纯文字
 * @param view 视图
 * @returns 多行文本
 */
export function adminText(view: AdminView): string {
  const { count } = view
  if (!count.total) return "还没有任何 Cookie，可让使用者私聊发送「#绑定CK」或「#扫码登录」"
  const lines = [`Cookie 共 ${count.total} 个账号`, `可用 ${count.normal}，失效 ${count.disable}`, `今日已查 ${count.query} 次`]
  const disabled = Object.values(view.servs)
    .flatMap(it => it.list)
    .filter(it => it.disabled)
  if (disabled.length) {
    lines.push("已停用：", ...disabled.map(it => `${INDENT}${it.ltuid}${INDENT}${it.reason ?? "Cookie 已失效"}`))
  }
  return lines.join("\n")
}
