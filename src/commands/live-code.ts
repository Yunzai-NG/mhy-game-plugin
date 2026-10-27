/**
 * 模块职责：`#前瞻兑换码` —— 取官方前瞻直播当期发的兑换码
 * 依赖方向：依赖 session 与 service/live-code
 * 生命周期：无状态函数
 * 注意事项：**与 `#兑换码` 是两回事**，故另立命令词（两条词互不为前缀）：那一条拿使用者凭据
 *          去国际服网页兑换，这一条只念出直播间公开放出的码，不要凭据、不写入任何东西。
 *
 *          尚未放出的码也列出来、标一句「还没放出」：一场直播固定发三个、陆续放出，
 *          只列已放出的会让人以为这场只有一个码。
 */
import type { Session } from "../core/session.js"
import type { MhyDeps } from "./deps.js"


/** 各游戏的兑换页 —— 一律给原神那页时，星铁与绝区零的码拿去也兑不了 */
const REDEEM: Readonly<Record<string, string>> = {
  gs: "https://genshin.hoyoverse.com/gift",
  sr: "https://hsr.hoyoverse.com/gift",
  zzz: "https://zenless.hoyoverse.com/redemption"
}
/**
 * `#前瞻兑换码`
 * @param s 会话
 * @param deps 依赖
 */
export async function liveCode(s: Session, deps: MhyDeps): Promise<void> {
  const service = deps.liveCode
  if (!service) {
    await s.text("前瞻兑换码这一项没有启用")
    return
  }

  const res = await service.codes(s.game)
  if (!res.ok) {
    await s.text(res.message)
    return
  }

  const lines = [res.title]
  if (res.startAt) lines.push(`本场直播 ${res.startAt} 开始，以下是已放出的部分`)

  for (const one of res.codes) {
    lines.push(one.code ? `${one.items}\n${one.code}` : `${one.items}\n（还没放出）`)
  }
  lines.push(`兑换地址：${REDEEM[s.game] ?? REDEEM.gs}`)

  await s.text(lines.join("\n"))
}
