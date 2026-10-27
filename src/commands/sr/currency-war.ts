/**
 * 模块职责：`*货币战争` 与 `*不可知域` —— 星铁两块玩法的战绩
 * 依赖方向：依赖 session / text / views/sr 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**当期没打过时自动改问上期**（`schedule_type=2`），并在图上标明看的是哪一期。
 *
 *          自动回退**只做一次**，且只在"当期确实没有记录"时做 —— 请求失败一律就地停住：
 *          "同一份凭据连发两个已鉴权请求"正是触发风控的形态。
 *
 *          使用者显式说了「上期」时不再回退。
 */
import type { Session } from "../../core/session.js"
import { failText } from "../../core/text.js"
import type { GridFightRaw, RogueMagicRaw } from "../../views/sr/index.js"
import {
  gridFightData,
  gridFightState,
  gridFightText,
  rogueMagicData,
  rogueMagicState,
  rogueMagicText
} from "../../views/sr/index.js"
import { GRID_RECENT, srStatAvatars } from "../../views/sr/index.js"
import { loadPanels } from "../_cards.js"
import type { MhyDeps } from "../deps.js"

/** 认「上期」「上一期」「上」三种写法，与 `#深渊` 同一口径 */
const PREV = /上一?期?$/

/**
 * `*货币战争`（另收「零和博弈」）
 * @param s 会话
 * @param deps 依赖
 */
export async function currencyWar(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "sr") {
    await s.text("货币战争当前仅支持星穹铁道")
    return
  }

  const wantPrev = PREV.test(s.rest.replace(/\d+$/, "").trim())
  // 末尾的数字挑第几场（1 起、新的在前），最多到官方页列的那几场
  const pick = Math.min(GRID_RECENT, Math.max(1, Number(/(\d+)\s*场?$/.exec(s.rest)?.[1] ?? 1)))

  /**
   * 问一期
   * @param schedule 1 本期 / 2 上期
   * @returns 查询结果
   */
  const ask = async (
    schedule: number
  ): Promise<Awaited<ReturnType<typeof deps.mys.query<GridFightRaw>>>> =>
    deps.mys.query<GridFightRaw>("gridFight", {
      user: s.user,
      game: s.game,
      data: { schedule_type: schedule }
    })

  let schedule = wantPrev ? 2 : 1
  let res = await ask(schedule)
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  // 只在 noData 时回退；locked（玩法没开）不回退，上期同样没有
  if (!wantPrev && gridFightState(res.data) === "noData") {
    const back = await ask(2)
    if (back.ok && gridFightState(back.data) !== "noData") {
      res = back
      schedule = 2
    }
  }

  const state = gridFightState(res.data)
  if (state === "locked") {
    await s.text("货币战争尚未解锁，在游戏里开启这个玩法后再来查询")
    return
  }
  const period = schedule === 2 ? "上期" : "本期"
  if (state === "noData") {
    await s.text(`${period}货币战争尚无存档，完成一次挑战后再来查询`)
    return
  }

  const loader = deps.meta?.loader
  const ctx = {
    uid: res.uid,
    period,
    ...(s.name ? { nickname: s.name } : {}),
    pick,
    ...(loader ? { iconOf: (id: string): string => loader.byId("sr", id)?.face ?? "" } : {})
  }
  const view = gridFightData(res.data, ctx)
  if (pick > (view["archives"] as unknown[]).length) {
    await s.text(`${period}只有 ${(view["archives"] as unknown[]).length} 场存档，发送 *货币战争1~${(view["archives"] as unknown[]).length} 挑一场`)
    return
  }
  if (await s.image("sr/currency-war", view)) return
  await s.text(gridFightText(res.data, ctx))
}

/**
 * `*不可知域`
 * @param s 会话
 * @param deps 依赖
 */
export async function unknowableDomain(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "sr") {
    await s.text("不可知域当前仅支持星穹铁道")
    return
  }

  const wantPrev = PREV.test(s.rest)

  /**
   * 问一期
   * @param schedule 1 本期 / 2 上期
   * @returns 查询结果
   */
  const ask = async (
    schedule: number
  ): Promise<Awaited<ReturnType<typeof deps.mys.query<RogueMagicRaw>>>> =>
    deps.mys.query<RogueMagicRaw>("rogueMagic", {
      user: s.user,
      game: s.game,
      data: { schedule_type: schedule }
    })

  let schedule = wantPrev ? 2 : 1
  let res = await ask(schedule)
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  if (!wantPrev && rogueMagicState(res.data) === "noData") {
    const back = await ask(2)
    if (back.ok && rogueMagicState(back.data) !== "noData") {
      res = back
      schedule = 2
    }
  }

  const period = schedule === 2 ? "上期" : "本期"
  // 没打过时照官方页仍出图：四项进度照印，记录区只放一句「近期暂无挑战数据~」；连进度都没有才回文字
  const empty = rogueMagicState(res.data) === "noData"
  if (empty && !res.data?.basic_info) {
    await s.text(`${period}不可知域尚无通关记录，完成一次挑战后再来查询`)
    return
  }

  const loader = deps.meta?.loader
  const ctx = {
    uid: res.uid,
    period,
    ...(s.name ? { nickname: s.name } : {}),
    ...(loader ? { iconOf: (id: string): string => loader.byId("sr", id)?.face ?? "" } : {})
  }
  // 阵容用与忘却之庭同一张角色卡
  const { panels } = await loadPanels(deps, s.user, "sr", res.uid)
  const avatars = srStatAvatars(panels, "sr", loader ? (rel: string): boolean => loader.exists(rel) : undefined)
  // 收窄到「名目栏 + 一队」的宽度（见 base.css 的 `.pic-lineup`）
  if (await s.image("sr/unknowable", { ...rogueMagicData(res.data, ctx), avatars, empty, bodyClass: "pic-lineup" })) return
  await s.text(rogueMagicText(res.data, ctx))
}
