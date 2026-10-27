/**
 * 模块职责：CK 池管理命令 —— `#用户统计` 看池子概况、`#删除无效用户` 清掉已失效的 CK、刷新 / 重置用户缓存
 * 依赖方向：依赖 session、store/ck 与 views/admin；由 commands/index 注册
 * 生命周期：无状态函数
 * 注意事项：`#刷新用户缓存` / `#重置用户缓存`（见 {@link resetCkCache}）**不重建任何计数缓存**
 *          （用量在 KV 里、由日期戳与 ttl 自然过期），做的是把误判停用的 CK 重新启用。
 */
import type { Session } from "../core/session.js"
import { maskLtuid, INDENT } from "../core/text.js"
import { GAME_KEYS, resolveRegionKind } from "../core/region.js"
import type { CookieRecord } from "../store/ck.js"
import type { AdminInput } from "../views/admin.js"
import { adminText, buildAdmin } from "../views/admin.js"
import type { MhyDeps } from "./deps.js"

/**
 * `#用户统计`（仅主人）
 *
 * 出图失败时退回文本，与其余查询命令一致。
 * @param s 会话
 * @param deps 依赖
 */
export async function userStat(s: Session, deps: MhyDeps): Promise<void> {
  const items: AdminInput[] = []
  for (const record of await deps.cookies.list()) {
    // 国服与国际服是两套服务，按 uid 归属分组统计
    items.push({ record, usage: await deps.cookies.usage(record.ltuid), os: isOs(record) })
  }
  const view = buildAdmin(items)

  if (await s.image("admin/user-admin", { ...view, _skin: "skin-neutral" })) return
  await s.text(adminText(view))
}

/**
 * 判断一条 CK 是否属于国际服账号
 *
 * 依据其名下任一 uid 的区服归类：国际服 uid 带前缀（6/7/8/9 开头），
 * 国服则无。名下无 uid 时按国服处理 —— 国服为绝大多数情形。
 * @param record CK 记录
 * @returns 国际服时为真
 */
function isOs(record: CookieRecord): boolean {
  for (const game of GAME_KEYS) {
    for (const uid of record.uids[game] ?? []) {
      if (resolveRegionKind(uid, game) !== "official" && resolveRegionKind(uid, game) !== "bilibili") return true
    }
  }
  return false
}

/**
 * `#刷新用户缓存` / `#重置用户缓存`（仅主人）
 *
 * 这两条命令**不重建计数缓存**（本插件的用量存于 KV、由日期戳与 ttl 自然过期，没有中间层
 * 可重建），它们做的是另一件事：**把被停用的 CK 重新启用**。停用可能源于一次误判
 * （网络异常期间连续几次失败），若没有这条命令，使用者唯一的办法是重新粘贴一遍 Cookie。
 *
 * 「重置」较「刷新」多一步清零今日用量与「米游社判今日到顶」的标记：确认对方限制已解除时使用。
 * @param s 会话
 * @param deps 依赖
 */
export async function resetCkCache(s: Session, deps: MhyDeps): Promise<void> {
  const hard = /重置/.test(s.rest)
  const all = await deps.cookies.list()
  const dead = all.filter(it => it.disabled)

  for (const it of dead) await deps.cookies.enable(it.ltuid)
  if (hard) for (const it of all) await deps.cookies.resetCount(it.ltuid)

  await s.text(
    [
      hard ? "已重置 CK 缓存" : "已刷新 CK 缓存",
      `共 ${all.length} 条 Cookie，其中 ${dead.length} 条已由停用恢复为可用`,
      hard ? "今日用量计数已清零" : "今日用量计数保留，如需一并清零请发送「#重置用户缓存」"
    ].join("\n")
  )
}

/**
 * `#删除失效CK`（仅主人）
 *
 * 只删除已被停用的那些 —— 停用的唯一入口是米游社明确返回 Cookie 失效
 * （参见 `CookiePool.report`），故这里不必再逐条去请求一次验证。
 * @param s 会话
 * @param deps 依赖
 */
export async function dropDeadCk(s: Session, deps: MhyDeps): Promise<void> {
  const dead = (await deps.cookies.list()).filter(it => it.disabled)
  if (!dead.length) {
    await s.text("当前没有失效的 Cookie")
    return
  }

  for (const it of dead) {
    await deps.cookies.remove(it.ltuid)
    await deps.signs?.remove(it.ltuid)
  }
  await s.text(
    [`已删除 ${dead.length} 条失效 Cookie：`, ...dead.map(it => `${INDENT}${maskLtuid(it.ltuid)}：${it.reason ?? "原因未知"}`)].join(
      "\n"
    )
  )
}
