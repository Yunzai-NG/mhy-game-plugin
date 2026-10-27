/**
 * 模块职责：星铁三条挑战战绩命令 —— 虚构叙事 / 末日幻影 / 异相仲裁
 * 依赖方向：依赖 session / text / views/sr 下的挑战视图与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**"没有内容"的几种成因分开说**：接口在"本期没打过"与"有本期数据但无关卡明细"
 *          两种情形下同样返回 retcode 0。后者意味着接口形态可能已变。
 *
 *          三类不另取玩家信息（星铁对应接口不给 `role`），故只印 uid；异相仲裁自带
 *          `role.nickname` 是例外。
 *
 *          **异相仲裁不走那个工厂**：它的返回与另两类没有一栏重合（见 views/sr/peak-challenge）。
 */
import type { Session } from "../../core/session.js"
import { failText } from "../../core/text.js"
import type { PeakChallengeContext, PeakChallengeRaw } from "../../views/sr/index.js"
import { peakChallengeState, peakChallengeText } from "../../views/sr/index.js"
import type { SrChallengeContext, SrChallengeKind, SrChallengeRaw } from "../../views/sr/index.js"
import {
  srChallengeApi,
  srChallengeState,
  srChallengeText,
  srChallengeTitle
} from "../../views/sr/index.js"
import { srChallengeStatData, peakChallengeStatData, srStatAvatars } from "../../views/sr/index.js"
import { loadPanels } from "../_cards.js"

/** 三类玩法各自的模板，图身共用一份片段、各引一份样式表 */
const STAT_TPL: Readonly<Record<Exclude<SrChallengeKind, "peak">, string>> = {
  memory: "sr/challenge-memory",
  story: "sr/challenge-story",
  boss: "sr/challenge-boss"
}
import type { MhyDeps } from "../deps.js"
import { onlyIn, PREV_SEASON } from "../_hints.js"

/**
 * 造一条星铁挑战命令
 *
 * 三类挑战的取数与判定一致，差别只在接口名与标题，故由同一个工厂产出。
 * @param kind 挑战种类
 * @returns 命令处理函数
 */
export function srChallengeCommand(
  kind: Exclude<SrChallengeKind, "peak">
): (s: Session, deps: MhyDeps) => Promise<void> {
  const title = srChallengeTitle(kind)
  return async (s: Session, deps: MhyDeps): Promise<void> => {
    if (s.game !== "sr") {
      await s.text(onlyIn(title, "星穹铁道", s.game))
      return
    }

    const schedule = PREV_SEASON.test(s.rest) ? 2 : 1
    const res = await deps.mys.query<SrChallengeRaw>(srChallengeApi(kind), {
      user: s.user,
      game: s.game,
      data: { schedule_type: schedule }
    })
    if (!res.ok) {
      await s.text(failText(res))
      return
    }

    const period = schedule === 2 ? "上期" : "本期"
    const state = srChallengeState(res.data)
    if (state === "otherShape") {
      await s.text(`${title}这一期换了玩法，暂时查不了，等插件更新`)
      return
    }
    if (state === "noData") {
      await s.text(`${period}${title}尚无战绩，完成一次挑战后再来查询`)
      return
    }
    if (state === "noDetail") {
      await s.text(`米游社返回了${period}${title}的数据，但其中没有关卡明细，暂时无法出图`)
      return
    }

    const loader = deps.meta?.loader
    const ctx: SrChallengeContext = {
      kind,
      uid: res.uid,
      period,
      // groups 里本期是第 0 项、上期是第 1 项，恒取第 0 项会让上期那张图印着本期的期次
      ...(schedule === 2 ? { prev: true } : {}),
      ...(loader ? { nameOf: (id: string): string => loader.byId("sr", id)?.abbr ?? "" } : {})
    }

    const { panels, name } = await loadPanels(deps, s.user, "sr", res.uid)
    const stat = srChallengeStatData(res.data, {
      kind,
      uid: res.uid,
      nickname: name ?? s.name,
      ...(schedule === 2 ? { prev: true } : {}),
      ...(loader ? { nameOf: (id: string): string => loader.byId("sr", id)?.abbr ?? "" } : {}),
      avatars: srStatAvatars(panels, "sr", loader ? (rel: string): boolean => loader.exists(rel) : undefined)
    })

    // 收窄到一队的宽度（见 base.css 的 `.pic-team`）
    if (await s.image(STAT_TPL[kind], { ...stat, bodyClass: "pic-team" })) return
    await s.text(srChallengeText(res.data, ctx))
  }
}

/** `*虚构叙事` */
export const challengeStory = srChallengeCommand("story")

/** `*末日幻影` */
export const challengeBoss = srChallengeCommand("boss")

/**
 * `*异相仲裁`
 * @param s 会话
 * @param deps 依赖
 */
export async function challengePeak(s: Session, deps: MhyDeps): Promise<void> {
  const title = srChallengeTitle("peak")
  if (s.game !== "sr") {
    await s.text(onlyIn(title, "星穹铁道", s.game))
    return
  }

  const schedule = PREV_SEASON.test(s.rest) ? 2 : 1
  const res = await deps.mys.query<PeakChallengeRaw>(srChallengeApi("peak"), {
    user: s.user,
    game: s.game,
    data: { schedule_type: schedule }
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const period = schedule === 2 ? "上期" : "本期"
  const state = peakChallengeState(res.data)
  if (state === "otherShape") {
    await s.text(`米游社返回的${title}数据里没有战绩那一栏，形态可能已变，暂时无法出图`)
    return
  }
  if (state === "noData") {
    await s.text(`${period}${title}尚无战绩，完成一次挑战后再来查询`)
    return
  }

  const loader = deps.meta?.loader
  const ctx: PeakChallengeContext = {
    uid: res.uid,
    period,
    ...(loader ? { nameOf: (id: string): string => loader.byId("sr", id)?.abbr ?? "" } : {})
  }

  const { panels, name } = await loadPanels(deps, s.user, "sr", res.uid)
  const stat = peakChallengeStatData(res.data, {
    uid: res.uid,
    nickname: name ?? s.name,
    ...(schedule === 2 ? { prev: true } : {}),
    ...(loader ? { nameOf: (id: string): string => loader.byId("sr", id)?.abbr ?? "" } : {}),
    avatars: srStatAvatars(panels, "sr", loader ? (rel: string): boolean => loader.exists(rel) : undefined)
  })

  if (await s.image("sr/peak-challenge", { ...stat, bodyClass: "pic-team" })) return
  await s.text(peakChallengeText(res.data, ctx))
}
