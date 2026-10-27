/**
 * 模块职责：札记 / 开拓月历 / 菲林月报命令 —— `#札记`
 * 依赖方向：依赖 session / text / views/ledger 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：绝区零那一路整条交给 `commands/zzz/collect`（菲林月报只有收入、月份写 `202601`）。
 *
 *          月份的合法范围由 {@link resolveMonth} 判定，越界时回一条提示而不发请求。
 *
 *          两个游戏各用一套模板（见 {@link LEDGER_TEMPLATES}）；原神那套要游戏内昵称，
 *          故多取一次 `UserGame`，该次失败不影响出图。
 */
import type { Session } from "../core/session.js"
import { failText } from "../core/text.js"
import type { LedgerRaw } from "../views/ledger.js"
import { buildLedger, LEDGER_TEMPLATES, ledgerTemplateData, ledgerText, resolveMonth } from "../views/ledger.js"
import { zzzLedger } from "./zzz/index.js"
import type { MhyDeps } from "./deps.js"

/** `UserGame` 接口返回的角色列表，只取昵称 */
interface UserGameRaw {
  /** 角色列表 */
  list?: {
    /** 游戏内昵称 */
    nickname?: string
  }[]
}

/**
 * 取游戏内昵称
 * @param s 会话
 * @param deps 依赖
 * @returns 昵称；取不到时为空对象
 */
async function nickname(s: Session, deps: MhyDeps): Promise<{ nickname?: string }> {
  const res = await deps.mys.query<UserGameRaw>("UserGame", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) return {}
  const name = res.data.list?.[0]?.nickname
  return name ? { nickname: name } : {}
}

/**
 * `#札记`
 * @param s 会话
 * @param deps 依赖
 */
export async function ledger(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    await zzzLedger(s, deps)
    return
  }

  const pick = resolveMonth(s.rest, s.game)
  if (!pick.ok) {
    await s.text(pick.message ?? "无法识别月份")
    return
  }

  const res = await deps.mys.query<LedgerRaw>("ys_ledger", {
    user: s.user,
    game: s.game,
    data: { month: pick.param }
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const ctx = { game: s.game, uid: res.uid, name: s.name, month: pick.label ?? "" }
  const extra = s.game === "sr" ? {} : await nickname(s, deps)
  const template = LEDGER_TEMPLATES[s.game === "sr" ? "sr" : "gs"]
  const withMeta = { ...extra, ...(deps.meta ? { meta: deps.meta.loader } : {}) }
  if (await s.image(template, ledgerTemplateData(res.data, ctx, withMeta))) return
  await s.text(ledgerText(buildLedger(res.data, ctx)))
}
