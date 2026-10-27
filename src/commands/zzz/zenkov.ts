/**
 * 模块职责：绝区零迷宫诡域两条命令 —— 概要与逐场战绩
 * 依赖方向：依赖 session / text / views/zzz/zenkov 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：两条命令各打一条接口，互不合并。
 *
 *          **命令表里只登记一条**：`迷宫诡域` 是 `迷宫诡域战绩` 的前缀，前缀路由下注册两条
 *          必定互相遮挡。故由 {@link zzzZenkovEntry} 按 `s.rest` 分派。
 */
import type { Session } from "../../core/session.js"
import { failText } from "../../core/text.js"
import type { ZzzZenkovRaw } from "../../views/zzz/index.js"
import { zzzZenkovData, zzzZenkovDetailData, zzzZenkovState, zzzZenkovText } from "../../views/zzz/index.js"
import type { MhyDeps } from "../deps.js"

/** 认作「要逐场战绩」的后缀，与命令表那条的触发词一致 */
const DETAIL_WORDS = /^(?:战绩|记录|详情|回顾)/

/**
 * `%迷宫诡域` 一族的入口，按后缀分派
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzZenkovEntry(s: Session, deps: MhyDeps): Promise<void> {
  if (DETAIL_WORDS.test(s.rest.trim())) {
    await zzzZenkovDetail(s, deps)
    return
  }
  await zzzZenkov(s, deps)
}

/**
 * `%迷宫诡域` —— 本期概要与逐地图撤离率
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzZenkov(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "zzz") {
    await s.text("迷宫诡域只有绝区零有，请发送 %迷宫诡域")
    return
  }

  const res = await deps.mys.query<ZzzZenkovRaw>("zenkov", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }
  if (zzzZenkovState(res.data) !== "ok") {
    await s.text("迷宫诡域尚无数据，玩法未开启或本期还没进过")
    return
  }

  const ctx = { uid: res.uid, ...(s.name ? { nickname: s.name } : {}) }
  const view = zzzZenkovData(res.data, ctx)
  if (await s.image("zzz/zenkov", view)) return
  await s.text(zzzZenkovText(res.data, ctx))
}

/**
 * `%迷宫诡域战绩` —— 逐场记录，含撤离物资
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzZenkovDetail(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "zzz") {
    await s.text("迷宫诡域只有绝区零有，请发送 %迷宫诡域战绩")
    return
  }

  const res = await deps.mys.query<ZzzZenkovRaw>("zenkovDetail", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }
  if (zzzZenkovState(res.data) !== "ok") {
    await s.text("迷宫诡域还没有逐场记录，本期进过一次之后再看")
    return
  }

  const ctx = { uid: res.uid, ...(s.name ? { nickname: s.name } : {}) }
  const view = zzzZenkovDetailData(res.data, ctx)
  if (await s.image("zzz/zenkov-detail", view)) return
  await s.text(zzzZenkovText(res.data, ctx, true))
}
