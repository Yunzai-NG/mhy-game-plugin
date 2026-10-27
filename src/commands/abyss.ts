/**
 * 模块职责：深境螺旋 / 混沌回忆命令 —— `#深渊` 与 `#深渊12层`
 * 依赖方向：依赖 session / text / views/abyss 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：`上期` 仅对应同一接口的 `schedule_type=2`，不另行注册命令。
 *
 *          "本期尚无记录"由 {@link abyssEmpty} 判定后单独回复一条：接口在无战斗记录时
 *          同样返回 retcode 0，直接出图会得到一张各项均为 0 的图。
 *
 *          命座另取一次 `index`（深渊接口不给这一项）。该次查询失败**不影响出图**，命座按 0 处理。
 *
 *          **三个游戏各走一路**：原神走 `views/abyss`，星铁走 `views/sr/challenge`
 *          （与虚构叙事、末日幻影同一族形态），绝区零整条交给 `commands/zzz/challenge`。
 */
import type { Session } from "../core/session.js"
import { failText } from "../core/text.js"
import type { AbyssRaw, ConsMap, GsAbyssRaw } from "../views/abyss.js"
import {
  abyssEmpty,
  abyssFloorTemplateData,
  abyssTemplateData,
  abyssText,
  buildAbyss,
  resolveFloor
} from "../views/abyss.js"
import type { AvatarCardView } from "../views/avatar-list.js"
import type { GsIndexRaw, IndexRaw } from "../views/profile.js"
import { avatarCardMap } from "./_cards.js"
import type { SrChallengeContext, SrChallengeRaw } from "../views/sr/index.js"
import { srChallengeState, srChallengeText } from "../views/sr/index.js"
import { srChallengeStatData, srStatAvatars } from "../views/sr/index.js"
import { abyssPct } from "./abyss-pct.js"
import { loadPanels } from "./_cards.js"
import { zzzDefense } from "./zzz/index.js"
import type { MhyDeps } from "./deps.js"
import { PREV_SEASON } from "./_hints.js"

/**
 * 取深渊出图要的两份附加数据：命座表与上场角色卡
 *
 * 只打一次 `index`：命座（单层图要）与角色卡（总览图要，经面板库补天赋 / 武器 / 圣遗物）都从它来。
 * 该次查询失败**不影响出图** —— 命座按 0、卡退回接口头像（见 `fallbackCard`）。
 * @param s 会话
 * @param deps 依赖
 * @returns 命座表与「角色 id → 头像卡」
 */
async function indexExtras(
  s: Session,
  deps: MhyDeps
): Promise<{ cons: ConsMap; cards: Record<string, AvatarCardView> }> {
  const res = await deps.mys.query<IndexRaw>("index", { user: s.user, game: s.game })
  if (!res.ok) return { cons: {}, cards: {} }

  const cons: Record<string, number> = {}
  for (const it of (res.data as GsIndexRaw).avatars ?? []) {
    if (it.id !== undefined) cons[String(it.id)] = it.actived_constellation_num ?? 0
  }

  const cards = await avatarCardMap(deps, s.user, "gs", res.data, res.uid)
  return { cons, cards }
}

/**
 * 星铁那一路：混沌回忆与另两类共用一份视图与模板
 * @param s 会话
 * @param deps 依赖
 * @param raw 接口返回
 * @param uid 游戏 uid
 * @param schedule 期次，1 本期 2 上期
 */
async function srAbyss(
  s: Session,
  deps: MhyDeps,
  raw: SrChallengeRaw,
  uid: string,
  schedule: number
): Promise<void> {
  const period = schedule === 2 ? "上期" : "本期"
  const state = srChallengeState(raw)
  if (state === "noDetail") {
    await s.text(`米游社返回了${period}混沌回忆的数据，但其中没有关卡明细，暂时无法出图`)
    return
  }
  if (state !== "ok") {
    await s.text(`${period}混沌回忆尚无战绩，完成一次挑战后再来查询`)
    return
  }

  const loader = deps.meta?.loader
  const ctx: SrChallengeContext = {
    kind: "memory",
    uid,
    period,
    // groups 里本期是第 0 项、上期是第 1 项
    ...(schedule === 2 ? { prev: true } : {}),
    // 接口只给角色 id，名字一律由元数据补
    ...(loader ? { nameOf: (id: string): string => loader.byId("sr", id)?.abbr ?? "" } : {})
  }

  // 面板库里那份只是锦上添花：取不到时模板仍按接口给的头像与等级出图
  const { panels, name } = await loadPanels(deps, s.user, "sr", uid)
  const stat = srChallengeStatData(raw, {
    kind: "memory",
    uid,
    nickname: name ?? s.name,
    ...(schedule === 2 ? { prev: true } : {}),
    ...(loader ? { nameOf: (id: string): string => loader.byId("sr", id)?.abbr ?? "" } : {}),
    avatars: srStatAvatars(panels, "sr", loader ? (rel: string): boolean => loader.exists(rel) : undefined)
  })

  // 收窄到一队的宽度（见 base.css 的 `.pic-team`）
  if (await s.image("sr/challenge-memory", { ...stat, bodyClass: "pic-team" })) return
  await s.text(srChallengeText(raw, ctx))
}

/**
 * `#深渊` / `#上期深渊` / `#深渊12层`
 * @param s 会话
 * @param deps 依赖
 */
export async function abyss(s: Session, deps: MhyDeps): Promise<void> {
  // 绝区零那一路是式舆防卫战，与另两个游戏毫无重合，整条交给它自己那份实现
  if (s.game === "zzz") {
    await zzzDefense(s, deps)
    return
  }

  /*
   * `#深渊出场率` 由这里分派出去
   *
   * **不能另立一条命令**：`深渊` 是 `深渊出场率` 的前缀，前缀路由下注册两条必定互相遮挡
   * （`index.test.ts` 那条不变量当场拦下）。而使用者习惯打的正是 `#深渊出场率`，
   * 故那一族另有自己的裸词（`#角色出场率`），同时在这里认后缀。
   */
  if (/出场率|使用率/.test(s.rest)) {
    await abyssPct(s, deps)
    return
  }

  const schedule = PREV_SEASON.test(s.rest) ? 2 : 1
  const res = await deps.mys.query<AbyssRaw>("spiralAbyss", {
    user: s.user,
    game: s.game,
    data: { schedule_type: schedule }
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  if (s.game === "sr") {
    await srAbyss(s, deps, res.data as SrChallengeRaw, res.uid, schedule)
    return
  }

  const ctx = { game: s.game, uid: res.uid, name: s.name, schedule }
  const view = buildAbyss(res.data, ctx)
  if (abyssEmpty(view)) {
    await s.text(`${view.season}尚无战斗记录，请完成一次挑战后再行查询`)
    return
  }

  const raw = res.data as GsAbyssRaw
  const { cards } = await indexExtras(s, deps)
  const floorIndex = resolveFloor(s.rest)
  if (floorIndex !== undefined) {
    const data = abyssFloorTemplateData(raw, ctx, floorIndex, cards)
    if (!data) {
      await s.text(`${view.season}第 ${floorIndex} 层尚无完整记录`)
      return
    }
    if (await s.image("gs/abyss-floor", data)) return
    await s.text(abyssText(view))
    return
  }

  if (await s.image("gs/abyss", abyssTemplateData(raw, ctx, cards))) return
  await s.text(abyssText(view))
}
