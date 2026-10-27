/**
 * 模块职责：幻想真境剧诗那一族命令 —— `#幻想真境剧诗` / `#月谕圣牌` / `#绘想游迹`
 * 依赖方向：依赖 session / text / views/gs/combat / views/gs/char-master、commands/_cards（剧诗的角色卡）与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**三种"没有内容"要分开说**（见 views/gs/combat 的 `combatState`）：没解锁、本期没打过、
 *          明细还没生成 —— 接口在这三种情形下都返回 retcode 0。
 *
 *          昵称、头像与角色卡另取一次 `index`（剧诗接口不给），该次失败不影响出图；头像走元数据，
 *          取不到时留空串。
 *
 *          `#月谕圣牌` 与剧诗同一条接口（`role_combat` 的 `tarot_card_state`），
 *          `#绘想游迹` 是另一条（`char_master`）。官方那条消红点的接口是写入，本插件不碰。
 */
import type { Session } from "../../core/session.js"
import { failText } from "../../core/text.js"
import type { CharMasterContext, CharMasterRaw } from "../../views/gs/index.js"
import { charMasterState, charMasterTemplateData, charMasterText } from "../../views/gs/index.js"
import type { CombatContext, RoleCombatRaw } from "../../views/gs/index.js"
import { combatState, combatTemplateData, combatText, tarotState, tarotTemplateData, tarotText } from "../../views/gs/index.js"
import type { IndexRaw } from "../../views/profile.js"
import { avatarCardMap } from "../_cards.js"
import type { MhyDeps } from "../deps.js"
import { onlyIn } from "../_hints.js"

/** `index` 接口里用得上的那两项 */
interface IndexRoleRaw {
  /** 玩家信息 */
  role?: {
    /** 昵称 */
    nickname?: string
    /** 冒险等阶 */
    level?: number
    /** 头像地址 */
    game_head_icon?: string
    /** 旧字段名的头像地址 */
    AvatarUrl?: string
  }
}

/** 三种"没有内容"各自的说法 */
const STATE_TEXT: Readonly<Record<string, string>> = {
  locked: "这个账号还没有解锁幻想真境剧诗，通关后再来查询",
  noData: "本期幻想真境剧诗尚无战绩，完成一次演出后再来查询",
  noDetail: "本期战绩米游社还没有生成明细，通常过一阵即可，稍后再试"
}

/**
 * 取一次 `index`，失败时不影响出图
 * @param s 会话
 * @param deps 依赖
 * @returns 接口返回；失败时 undefined
 */
async function indexOf(s: Session, deps: MhyDeps): Promise<(IndexRaw & IndexRoleRaw) | undefined> {
  const info = await deps.mys.query<IndexRaw & IndexRoleRaw>("index", {
    user: s.user,
    game: s.game
  })
  return info.ok ? info.data : undefined
}

/**
 * 取一次玩家昵称与头像，失败时不影响出图
 * @param s 会话
 * @param deps 依赖
 * @returns 可直接展开进上下文的一个片段
 */
async function roleOf(s: Session, deps: MhyDeps): Promise<{ role?: IndexRoleRaw["role"] }> {
  const info = await indexOf(s, deps)
  return info?.role ? { role: info.role } : {}
}

/**
 * `#幻想真境剧诗`
 * @param s 会话
 * @param deps 依赖
 */
export async function roleCombat(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "gs") {
    await s.text(onlyIn("幻想真境剧诗", "原神", s.game))
    return
  }

  const res = await deps.mys.query<RoleCombatRaw>("role_combat", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const state = combatState(res.data)
  if (state !== "ok") {
    await s.text(STATE_TEXT[state] ?? STATE_TEXT["noData"] ?? "")
    return
  }

  const loader = deps.meta?.loader
  const info = await indexOf(s, deps)
  const ctx: CombatContext = {
    uid: res.uid,
    ...(info?.role ? { role: info.role } : {}),
    ...(loader ? { faceOf: (id: string): string => loader.byId("gs", id)?.face ?? "" } : {}),
    // 与深渊总览同一份造法；index 那次失败时不给，自有角色退回只带头像的卡
    ...(info ? { cards: await avatarCardMap(deps, s.user, "gs", info, res.uid) } : {})
  }

  if (await s.image("gs/combat", combatTemplateData(res.data, ctx))) return
  await s.text(combatText(res.data, ctx))
}

/**
 * `#月谕圣牌` —— 那二十余张牌的收藏进度，读 `role_combat` 的 `tarot_card_state`
 * @param s 会话
 * @param deps 依赖
 */
export async function tarotCards(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "gs") {
    await s.text("月谕圣牌只有原神有")
    return
  }

  const res = await deps.mys.query<RoleCombatRaw>("role_combat", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const state = tarotState(res.data)
  if (state !== "ok") {
    await s.text(
      state === "locked" ? (STATE_TEXT["locked"] ?? "") : "这一期没有月谕模式，或米游社还没有给出圣牌数据"
    )
    return
  }

  const ctx: CombatContext = { uid: res.uid, ...(await roleOf(s, deps)) }
  if (await s.image("gs/tarot", tarotTemplateData(res.data, ctx))) return
  await s.text(tarotText(res.data, ctx))
}

/**
 * `#绘想游迹` —— 逐角色的专精进度，接口另是一条（`char_master`）
 * @param s 会话
 * @param deps 依赖
 */
export async function charMaster(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "gs") {
    await s.text("绘想游迹只有原神有")
    return
  }

  const res = await deps.mys.query<CharMasterRaw>("char_master", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const state = charMasterState(res.data)
  if (state !== "ok") {
    await s.text(state === "locked" ? (STATE_TEXT["locked"] ?? "") : "米游社暂无绘想游迹的数据")
    return
  }

  const ctx: CharMasterContext = { uid: res.uid, ...(await roleOf(s, deps)) }
  if (await s.image("gs/char-master", charMasterTemplateData(res.data, ctx))) return
  await s.text(charMasterText(res.data, ctx))
}
