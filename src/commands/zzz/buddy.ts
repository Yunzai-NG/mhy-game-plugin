/**
 * 模块职责：`%邦布` —— 已拥有的邦布一览
 * 依赖方向：依赖 session / text / views/zzz/buddy 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：只有绝区零有，另两个游戏在第一行分派出去。
 */
import type { Session } from "../../core/session.js"
import { failText } from "../../core/text.js"
import type { BuddyRaw } from "../../views/zzz/index.js"
import { buddyTemplateData, buddyText } from "../../views/zzz/index.js"
import type { MhyDeps } from "../deps.js"

/**
 * `%邦布`
 * @param s 会话
 * @param deps 依赖
 */
export async function buddyList(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "zzz") {
    await s.text("邦布是绝区零的，请发送 #绝区零邦布 或 %邦布")
    return
  }

  const res = await deps.mys.query<BuddyRaw>("buddy", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const loader = deps.meta?.loader
  const data = buddyTemplateData(res.data, { uid: res.uid, name: s.name, ...(loader ? { meta: loader } : {}) })
  if (await s.image("zzz/buddy", data)) return
  await s.text(buddyText(data))
}
