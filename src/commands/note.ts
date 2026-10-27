/**
 * 模块职责：实时便笺命令 —— `#体力`，以及挂在它后面的 `#体力提醒`
 * 依赖方向：依赖 session / text / views/note / commands/note-remind 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：出图失败一律回退为文本（见 {@link noteText}）。
 *
 *          三个游戏各用一套既有模板（见 {@link NOTE_TEMPLATES}）；星铁那套还要昵称与
 *          开拓等级，故多取一次 `UserGame`，该次失败**不影响出图**。
 *
 *          **`#体力提醒` 也由这一条承接**（入口是 {@link noteOrRemind}）：`#体力` 是它的
 *          前缀，前缀路由下另注册一条必定被这一条吃掉。
 */
import type { Session } from "../core/session.js"
import { failText } from "../core/text.js"
import type { NoteRaw, SrNoteExtra } from "../views/note.js"
import { buildNote, noteTemplateData, noteText, NOTE_TEMPLATES } from "../views/note.js"
import type { MhyDeps } from "./deps.js"
import { parseRemindRest, staminaRemind } from "./note-remind.js"

/** `UserGame` 接口返回的角色列表 */
interface UserGameRaw {
  /** 角色列表 */
  list?: {
    /** 游戏内昵称 */
    nickname?: string
    /** 等级 */
    level?: number
  }[]
}

/**
 * 取星铁模板另需的昵称与等级
 * @param s 会话
 * @param deps 依赖
 * @returns 昵称与等级；取不到时为空对象
 */
async function srExtra(s: Session, deps: MhyDeps): Promise<SrNoteExtra> {
  const res = await deps.mys.query<UserGameRaw>("UserGame", {
    user: s.user,
    game: s.game
  })
  return res.ok ? (res.data.list?.[0] ?? {}) : {}
}

/**
 * `#体力`
 * @param s 会话
 * @param deps 依赖
 */
export async function dailyNote(s: Session, deps: MhyDeps): Promise<void> {
  const res = await deps.mys.query<NoteRaw>("dailyNote", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const ctx = { game: s.game, uid: res.uid, name: s.name }
  const extra = s.game === "sr" ? await srExtra(s, deps) : {}
  if (await s.image(NOTE_TEMPLATES[s.game], noteTemplateData(res.data, ctx, extra))) return
  await s.text(noteText(buildNote(res.data, ctx)))
}

/**
 * `#体力` 的入口 —— 认出是设置提醒就转给提醒那一族，否则查便笺
 * @param s 会话
 * @param deps 依赖
 */
export async function noteOrRemind(s: Session, deps: MhyDeps): Promise<void> {
  const req = parseRemindRest(s.rest)
  if (req) {
    await staminaRemind(s, deps, req)
    return
  }
  await dailyNote(s, deps)
}
