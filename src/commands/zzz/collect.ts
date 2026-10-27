/**
 * 模块职责：绝区零三类进度命令 —— 零号空洞（枯萎苗圃 / 迷失之地）、区域收集、菲林月报
 * 依赖方向：依赖 session / text / views/zzz/collect 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**枯萎苗圃的明细只在打过「刀耕火焚」时才取**：概要里 `abyss_throne.max_damage`
 *          为空即说明没打过，那时第二条接口给的是空数据。
 *
 *          `%零号空洞` 只回一句指路（底下有枯萎苗圃与迷失之地两个玩法），不发任何请求。
 *
 *          菲林月报的月份**在本层解析**（见 {@link zzzLedgerMonth}）：这条接口收的是
 *          `202601` 这种写法，不走 `resolveMonth`。
 */
import type { Session } from "../../core/session.js"
import { failText } from "../../core/text.js"
import type {
  ZzzCollectContext,
  ZzzExploreRaw,
  ZzzGardenDetailRaw,
  ZzzGardenRaw,
  ZzzLedgerRaw,
  ZzzLostRaw
} from "../../views/zzz/index.js"
import {
  zzzExploreData,
  zzzExploreState,
  zzzExploreText,
  zzzGardenData,
  zzzGardenState,
  zzzHollowText,
  zzzLedgerData,
  zzzLedgerMonth,
  zzzLedgerState,
  zzzLedgerText,
  zzzLostData,
  zzzLostState
} from "../../views/zzz/index.js"
import { zzzAvatarCardMap } from "../_cards.js"
import type { MhyDeps } from "../deps.js"

/**
 * 造上下文：名字一律由元数据补
 * @param s 会话
 * @param deps 依赖
 * @param uid 游戏 uid
 * @returns 上下文
 */
function ctxOf(s: Session, deps: MhyDeps, uid: string): ZzzCollectContext {
  const loader = deps.meta?.loader
  return {
    uid,
    ...(s.name ? { nickname: s.name } : {}),
    ...(loader
      ? {
          nameOf: (id: string): string => loader.byId("zzz", id)?.abbr ?? "",
          iconOf: (id: string): string => loader.byId("zzz", id)?.face ?? ""
        }
      : {})
  }
}
/**
 * `%零号空洞` —— 只指路，不发请求
 * @param s 会话
 */
export async function zzzHollowHelp(s: Session): Promise<void> {
  if (s.game !== "zzz") {
    await s.text("零号空洞只有绝区零有，请发送 %零号空洞")
    return
  }
  await s.text("零号空洞底下有两个玩法，各自一条接口：\n发送「%枯萎苗圃」查枯萎苗圃\n发送「%迷失之地」查迷失之地")
}

/**
 * `%枯萎苗圃`
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzGarden(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "zzz") {
    await s.text("零号空洞只有绝区零有，请发送 %枯萎苗圃")
    return
  }

  const res = await deps.mys.query<ZzzGardenRaw>("hollowZero", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }
  if (zzzGardenState(res.data) !== "ok") {
    await s.text("零号空洞·枯萎苗圃尚无数据，玩法未开启或本档还没进过")
    return
  }

  // 明细只在打过「刀耕火焚」时才取：没有 `max_damage` 时第二条接口给的是空数据
  let detail: ZzzGardenDetailRaw | undefined
  if ((res.data.abyss_throne?.max_damage ?? 0) > 0) {
    const got = await deps.mys.query<ZzzGardenDetailRaw>("hollowZeroDetail", {
      user: s.user,
      game: s.game
    })
    if (got.ok) detail = got.data
  }

  const ctx = ctxOf(s, deps, res.uid)
  // 「刀耕火焚」那队出整张代理人卡：音擎/驱动盘/技能从绝区零面板库取，没有的退占位卡
  const view = zzzGardenData(res.data, detail, { ...ctx, cards: await zzzAvatarCardMap(deps, s.user, res.uid) })
  if (await s.image("zzz/garden", { ...view, bodyClass: "pic-team" })) return
  await s.text(zzzHollowText(view))
}
/**
 * `%迷失之地`
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzLost(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "zzz") {
    await s.text("零号空洞只有绝区零有，请发送 %迷失之地")
    return
  }

  const res = await deps.mys.query<ZzzLostRaw>("hollowZeroS2", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }
  if (zzzLostState(res.data) !== "ok") {
    await s.text("零号空洞·迷失之地尚无数据，玩法未开启或本档还没进过")
    return
  }

  const view = zzzLostData(res.data, ctxOf(s, deps, res.uid))
  if (await s.image("zzz/lost", view)) return
  await s.text(zzzHollowText(view))
}

/**
 * `%区域收集` —— 也是 `%探索` 在绝区零那一路的落点
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzExplore(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "zzz") {
    await s.text("区域收集只有绝区零有，请发送 %区域收集")
    return
  }

  const res = await deps.mys.query<ZzzExploreRaw>("exploration", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }
  const ctx = ctxOf(s, deps, res.uid)
  if (zzzExploreState(res.data) !== "ok") {
    await s.text("米游社没有返回区域收集数据，请确认已在 App 里开启战绩展示")
    return
  }

  if (await s.image("zzz/explore", zzzExploreData(res.data, ctx))) return
  await s.text(zzzExploreText(res.data, ctx))
}
/**
 * `%札记` 在绝区零那一路的落点 —— 菲林月报
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzLedger(s: Session, deps: MhyDeps): Promise<void> {
  const pick = zzzLedgerMonth(s.rest, new Date())
  if (!pick.ok) {
    await s.text(pick.message ?? "无法识别月份")
    return
  }

  const res = await deps.mys.query<ZzzLedgerRaw>("ys_ledger", {
    user: s.user,
    game: s.game,
    ...(pick.param ? { data: { month: pick.param } } : {})
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }
  const ctx = ctxOf(s, deps, res.uid)
  if (zzzLedgerState(res.data) !== "ok") {
    await s.text(`米游社没有返回${pick.label ?? ""}的菲林月报，那个月可能已超出可查范围`)
    return
  }

  if (await s.image("zzz/ledger", zzzLedgerData(res.data, ctx))) return
  await s.text(zzzLedgerText(res.data, ctx))
}
