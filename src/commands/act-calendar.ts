/**
 * 模块职责：`#活动日历` —— 三个游戏的卡池、限时活动与周期玩法进度
 * 依赖方向：依赖 session / text / views/act-calendar 与命令层依赖包（米游社查询、元数据、渲染桥）
 * 生命周期：无状态函数
 * 注意事项：绝区零分两条接口（调频、活动），一条失败另一条照常出图，两条都失败才回失败话术。
 *          图只取已装的元数据：角色 / 武器按 id 与名字查，奖励按物品名查（见 {@link rewardIcon}），
 *          查不到只印字。
 *          出图失败回退为文字（见 {@link actCalendarText}）。
 */
import type { GameKey } from "../core/region.js"
import type { Session } from "../core/session.js"
import { failText } from "../core/text.js"
import { elemOf } from "../meta/elem.js"
import type { ActCalendarRaw, ActContext, ActItemMeta } from "../views/act-calendar.js"
import { ACT_CALENDAR_TEMPLATE, actCalendarText, buildActCalendar } from "../views/act-calendar.js"
import type { ZzzActivityCalendarRaw, ZzzGachaCalendarRaw } from "../views/act-calendar.js"
import type { MhyDeps } from "./deps.js"

/**
 * 元数据里查不到时的奖励图，只剩绝区零的菲林 —— 活动接口不给物品，图恒是这一张
 *
 * 表里每一项都由测试钉住文件存在 —— 路径写错不报错，只是那一格退成文字。
 */
export const REWARD_ICONS: Readonly<Record<GameKey, Readonly<Record<string, string>>>> = {
  gs: {},
  sr: {},
  zzz: { 菲林: "zzz/act-calendar/菲林.png" }
}

/**
 * 按物品名取奖励图：查材料表（货币与活动道具在 `material/data.json` 的 `item` 一类里），随元数据更新
 *
 * 材料表的图标路径是按类别与名字拼的，登记了却没放图时照样给路径，故还要看文件在不在。
 * @param name 物品名
 * @param game 游戏
 * @param deps 依赖
 * @returns 相对元数据根或资源根的路径；没有图时空串
 */
export function rewardIcon(name: string, game: GameKey, deps: Pick<MhyDeps, "meta" | "materials">): string {
  const mat = deps.materials?.get(name, game)?.icon
  if (mat && deps.meta?.loader.exists(mat)) return mat
  return REWARD_ICONS[game][name] ?? ""
}

/** 星铁元素键 → 色 class 的后半；元数据给中文名，`elemOf` 折成键后再对到皮肤里那套写法 */
const SR_ELEM_CSS: Readonly<Record<string, string>> = { elec: "lightning", phy: "physical" }

/**
 * 造取图的上下文
 * @param s 会话
 * @param deps 依赖
 * @param uid 查询的 uid
 * @returns 上下文
 */
function contextOf(s: Session, deps: MhyDeps, uid: string): ActContext {
  const game: GameKey = s.game
  const loader = deps.meta?.loader
  const render = deps.render
  const ctx: ActContext = { game, uid, name: s.name, now: Date.now() }

  if (loader) {
    ctx.item = (kind, id, name): ActItemMeta | undefined => {
      const got = loader.find(game, id, name)
      if (!got) return undefined
      // 角色的图在 face、武器的在 icon（见 MetaItem），取反则那一栏整排空白
      const face = (kind === "char" ? (got.face ?? got.icon) : (got.icon ?? got.face)) ?? ""
      const elem = game === "gs" ? elemOf(got.elem) : game === "sr" ? elemOf(got.elem, "", "sr") : ""
      return { face, star: got.star, elem: SR_ELEM_CSS[elem] ?? elem }
    }
  }
  if (render) ctx.has = (rel: string): boolean => render.hasRes(rel)
  ctx.reward = (name: string): string => rewardIcon(name, game, deps)
  return ctx
}

/**
 * 取原始数据
 * @param s 会话
 * @param deps 依赖
 * @returns 成功时为数据与 uid；失败时为话术
 */
async function fetchRaw(s: Session, deps: MhyDeps): Promise<{ raw: ActCalendarRaw; uid: string } | { fail: string }> {
  const opts = { user: s.user, game: s.game }
  if (s.game !== "zzz") {
    const res = await deps.mys.query<ActCalendarRaw>("act_calendar", opts)
    return res.ok ? { raw: res.data, uid: res.uid } : { fail: failText(res) }
  }
  const gacha = await deps.mys.query<ZzzGachaCalendarRaw>("gacha_calendar", opts)
  const activity = await deps.mys.query<ZzzActivityCalendarRaw>("activity_calendar", opts)
  if (!gacha.ok && !activity.ok) return { fail: failText(gacha) }
  const uid = gacha.ok ? gacha.uid : activity.ok ? activity.uid : ""
  return {
    raw: { ...(gacha.ok ? { gacha: gacha.data } : {}), ...(activity.ok ? { activity: activity.data } : {}) },
    uid
  }
}

/**
 * `#活动日历`
 * @param s 会话
 * @param deps 依赖
 */
export async function actCalendar(s: Session, deps: MhyDeps): Promise<void> {
  const got = await fetchRaw(s, deps)
  if ("fail" in got) {
    await s.text(got.fail)
    return
  }
  const view = buildActCalendar(got.raw, contextOf(s, deps, got.uid))
  if (await s.image(ACT_CALENDAR_TEMPLATE, view)) return
  await s.text(actCalendarText(view))
}
