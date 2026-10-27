/**
 * 模块职责：`#米游社签到`、`#自动签到`（逐账号开关）与 `#签到状态`
 * 依赖方向：依赖 service/sign、store/sign、store/ck 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**这是本插件唯一会代替使用者写入的功能**，故有三条口径：
 *
 *          1. **只签自己名下的账号**（`cookies.owned(s.user)`），别人名下的 CK 一概不动。
 *          2. 开启自动签到时把每天几点、遇验证码不过码、随时可关说清。
 *          3. **签到时发现 Cookie 失效就停用那条**；但撞上验证码不停用也不重试。
 *
 *          自动签到另有总开关 `enableAutoSign`（缺省关）：主人不开，逐账号的开关也不生效 ——
 *          部署者要能一处关掉全部代写行为。
 */
import type { Session } from "../core/session.js"
import { stokenCookie } from "../core/cookie.js"
import type { SignGame } from "../core/sign-api.js"
import { INDENT, maskLtuid } from "../core/text.js"
import { canSign, SignService, signGamesOf } from "../service/sign.js"
import type { MhyDeps } from "./deps.js"

/** 消息所在的游戏没有签到版块时那一句，说明为什么不签而不是静默 */
const NO_BOARD = "该游戏暂不支持米游社签到"

/**
 * 把签到时间的 cron 说成人话
 *
 * 只认「每天固定时分」那一种（5 段或 6 段，日月周都是 `*`），说成「每天 08:35」；其余原样给出 cron，
 * 猜错一种写法会把签到时间说错，比印 cron 更糟。
 * @param cron cron 表达式
 * @returns 一小句，如「每天 08:35」
 */
export function cronText(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  const [min, hour, ...rest] = parts.length === 6 ? parts.slice(1) : parts
  const daily = parts.length >= 5 && parts.length <= 6 && rest.length === 3 && rest.every(one => one === "*")
  if (daily && /^\d{1,2}$/.test(min ?? "") && /^\d{1,2}$/.test(hour ?? "") && (parts.length === 5 || /^\d{1,2}$/.test(parts[0] ?? ""))) {
    return `每天 ${hour?.padStart(2, "0")}:${min?.padStart(2, "0")}`
  }
  return `按 cron「${cron.trim()}」`
}

/**
 * 认出这次要签哪些游戏
 *
 * 优先看剩余文本里指名的（`#米游社签到星铁`），其次看「全部」，最后回落到本条消息的游戏前缀。
 * @param s 会话
 * @returns 要签的游戏；全部都签时 undefined
 */
export function pickSignGames(s: Session): readonly SignGame[] | undefined {
  const named = signGamesOf(s.rest)
  if (named) return named
  if (/全部|所有/.test(s.rest)) return undefined
  return canSign(s.game) ? [s.game as SignGame] : []
}

/**
 * `#米游社签到` —— 当场签一次
 *
 * 只签自己名下的账号，理由见文件头。
 * @param s 会话
 * @param deps 依赖
 */
export async function signNow(s: Session, deps: MhyDeps): Promise<void> {
  const service = deps.sign
  const store = deps.signs
  if (!service || !store) {
    await s.text("签到功能未启用")
    return
  }

  const games = pickSignGames(s)
  if (games && games.length === 0) {
    await s.text(NO_BOARD)
    return
  }

  const records = (await deps.cookies.owned(s.user)).filter(one => !one.disabled)
  if (records.length === 0) {
    await s.text("签到要用你自己的 Cookie，请先私聊发送「#绑定CK」")
    return
  }

  await s.text(
    `开始签到，共 ${records.length} 个米游社账号。为避开风控每步之间有间隔，可能要一两分钟，期间请勿重复执行`
  )

  const lines: string[] = []
  for (const record of records) {
    const report = await service.run({ ltuid: record.ltuid, cookie: record.cookie }, games)
    const text = SignService.text(report)
    if (report.dead) await deps.cookies.disable(record.ltuid, "签到时发现 Cookie 已失效")
    const ok = report.items.some(one => one.status === "signed" || one.status === "already")
    await store.mark(record.ltuid, ok, text)
    lines.push(`【${maskLtuid(record.ltuid)}】`, text || "没有可签到的角色")
  }
  await s.text(lines.join("\n"))
}

/**
 * `#自动签到` / `#自动签到关闭` —— 逐账号开关每日自动签到
 *
 * 开启时把"每天会代替你做什么"说清。
 * @param s 会话
 * @param deps 依赖
 */
export async function toggleAutoSign(s: Session, deps: MhyDeps): Promise<void> {
  const store = deps.signs
  if (!store) {
    await s.text("签到功能未启用")
    return
  }

  const off = /关闭|关掉|停止|取消|禁用|关$/.test(s.rest)
  const records = await deps.cookies.owned(s.user)
  if (records.length === 0) {
    await s.text("你名下还没有 Cookie，请先私聊发送「#绑定CK」")
    return
  }

  for (const record of records) await store.setEnabled(record.ltuid, !off)
  if (off) {
    await s.text(`已关闭 ${records.length} 个账号的自动签到，之后不会再代替你签到。「#米游社签到」仍可手动签`)
    return
  }

  const cfg = deps.config()
  const lines = [
    `已为 ${records.length} 个账号开启自动签到，${cronText(cfg.autoSignCron)} 执行一次。`,
    `${INDENT}它会代替你向米游社签到，可随时发送「#自动签到关闭」停掉。`,
    `${INDENT}撞上验证码时不会自动过码，只会告诉你去米游社手动点一次。`
  ]
  if (!cfg.enableAutoSign) {
    lines.push(`${INDENT}注意：主人尚未开启插件的「每日自动签到」总开关，故现在还不会真的执行。`)
  }
  await s.text(lines.join("\n"))
}

/**
 * `#签到状态` —— 看名下各账号的开关与上次结果
 * @param s 会话
 * @param deps 依赖
 */
export async function signStatus(s: Session, deps: MhyDeps): Promise<void> {
  const store = deps.signs
  if (!store) {
    await s.text("签到功能未启用")
    return
  }

  const records = await deps.cookies.owned(s.user)
  if (records.length === 0) {
    await s.text("你名下还没有 Cookie，请先私聊发送「#绑定CK」")
    return
  }

  const cfg = deps.config()
  const lines = [`每日自动签到总开关：${cfg.enableAutoSign ? `已开启（${cronText(cfg.autoSignCron)}）` : "未开启（主人可在面板打开）"}`]
  for (const record of records) {
    const state = await store.get(record.ltuid)
    lines.push(
      `【${maskLtuid(record.ltuid)}】${state.enabled ? "自动签到已开" : "自动签到已关"}${record.disabled ? "　该 CK 已停用" : ""}`
    )
    if (state.day) lines.push(`${INDENT}上次签到：${state.day}`)
    if (state.text) lines.push(...state.text.split("\n").map(one => `${INDENT}${one}`))
  }
  await s.text(lines.join("\n"))
}

/** 缺 stoken 时的那句提示，社区签到与米游币共用 */
const NEED_STOKEN =
  "这两件事要用 stoken，而绑定 CK 拿到的那一份权限不够。两条路任选：\n" +
  "　一、私聊发送「#扫码登录」，用米游社 App 扫一次码；\n" +
  "　二、手上已有 stoken 的话，把 stoken、stuid、mid 三项一并接在 CK 后面重新「#绑定ck」，形如 " +
  "`...;stoken=v2_xxx;stuid=123456;mid=xxx_mhy;`"

/**
 * 收集名下可用的 stoken
 *
 * 与游戏签到一样只用自己名下的账号。
 * @param s 会话
 * @param deps 依赖
 * @returns 账号标识与 stoken 形态的 Cookie；一个都没有时空数组
 */
async function ownedStokens(s: Session, deps: MhyDeps): Promise<{ ltuid: string; stoken: string }[]> {
  const out: { ltuid: string; stoken: string }[] = []
  for (const record of await deps.cookies.owned(s.user)) {
    const cookie = stokenCookie(record.stoken ? `${record.cookie}; ${record.stoken}` : record.cookie)
    if (cookie) out.push({ ltuid: record.ltuid, stoken: cookie })
  }
  return out
}

/**
 * `#社区签到` —— 米游社社区版块签到，收益是米游币
 *
 * 与 `#米游社签到` 是两件事：那一条签**游戏**（原石、信用点），这一条签**社区**（米游币），
 * 凭据也不同（stoken 而非 Cookie）。
 * @param s 会话
 * @param deps 依赖
 */
export async function bbsSignNow(s: Session, deps: MhyDeps): Promise<void> {
  const service = deps.sign
  if (!service) {
    await s.text("签到功能未启用")
    return
  }

  const accounts = await ownedStokens(s, deps)
  if (accounts.length === 0) {
    await s.text(NEED_STOKEN)
    return
  }

  const games = signGamesOf(s.rest)
  await s.text(`开始社区签到，共 ${accounts.length} 个米游社账号。每个版块之间有间隔，请勿重复执行`)

  const lines: string[] = []
  for (const account of accounts) {
    const report = await service.bbs(account, games)
    lines.push(`【${maskLtuid(account.ltuid)}】`, SignService.bbsText(report) || "没有可签的版块")
  }
  await s.text(lines.join("\n"))
}

/**
 * `#米游币` —— 查余额与今日剩余可得
 * @param s 会话
 * @param deps 依赖
 */
export async function coinStatus(s: Session, deps: MhyDeps): Promise<void> {
  const service = deps.sign
  if (!service) {
    await s.text("签到功能未启用")
    return
  }

  const accounts = await ownedStokens(s, deps)
  if (accounts.length === 0) {
    await s.text(NEED_STOKEN)
    return
  }

  const lines: string[] = []
  for (const account of accounts) {
    const got = await service.coins(account)
    if (!got.ok) {
      lines.push(`【${maskLtuid(account.ltuid)}】${got.message ?? "查询失败"}`)
      continue
    }
    lines.push(
      `【${maskLtuid(account.ltuid)}】米游币 ${got.points ?? 0}`,
      `${INDENT}今日还能获得 ${got.canGet ?? 0}${got.canGet === 0 ? "（今天的都拿到了）" : "，可发送「#社区签到」领取"}`
    )
  }
  await s.text(lines.join("\n"))
}
