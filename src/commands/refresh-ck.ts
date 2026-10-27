/**
 * 模块职责：`#刷新CK` —— 凭已有的 stoken 换一份新的查询 Cookie
 * 依赖方向：依赖 session / text / service/refresh-ck 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**只处理使用者自己名下的账号**（`cookies.owned`），别人名下的一概不动。
 *
 *          群聊亦可用：整个过程只在服务端与米游社之间进行，一个凭据字符都不经过消息。
 */
import type { Session } from "../core/session.js"
import { maskLtuid } from "../core/text.js"
import type { MhyDeps } from "./deps.js"

/** 一个账号都没绑时的提示 */
const NO_CK = "尚未绑定 ck，请发送「#扫码登录」或「#绑定CK」"

/** 绑了但一个都没有 stoken 时的提示 */
const NO_STOKEN = "刷新失败，名下账号都没有 stoken，请发送「#扫码登录」"

/**
 * `#刷新CK`
 * @param s 会话
 * @param deps 依赖
 */
export async function refreshCk(s: Session, deps: MhyDeps): Promise<void> {
  const service = deps.refreshCk
  if (!service) {
    await s.text("刷新 ck 未启用")
    return
  }

  const owned = await deps.cookies.owned(s.user)
  if (owned.length === 0) {
    await s.text(NO_CK)
    return
  }
  if (owned.every(one => !one.stoken)) {
    await s.text(NO_STOKEN)
    return
  }

  await s.text(`正在刷新 ${owned.length} 个账号的 Cookie，请稍候`)
  const res = await service.refresh(s.user)

  const lines: string[] = []
  for (const one of res.items) {
    const who = one.uids[0] ? `UID${one.uids[0]}` : `账号 ${maskLtuid(one.ltuid)}`
    if (one.state === "ok") lines.push(`${who} 已刷新`)
    else if (one.state === "noStoken") lines.push(`${who} 没有 stoken，已跳过`)
    else lines.push(`${who} 刷新失败：${one.message ?? "请稍后重试"}`)
  }

  const tail =
    res.ok > 0
      ? `共 ${res.ok} 个已刷新${res.failed > 0 ? `，${res.failed} 个失败` : ""}${res.skipped > 0 ? `，${res.skipped} 个跳过` : ""}`
      : "一个都没刷新成功，请重新「#扫码登录」"

  await s.text([...lines, tail].join("\n"))
}
