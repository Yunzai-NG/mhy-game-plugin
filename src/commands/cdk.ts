/**
 * 模块职责：兑换码命令 —— `#兑换码 XXXX`
 * 依赖方向：依赖 session / text / region 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**国服不存在该接口**（仅国际服有 `webExchangeCdkeyHyl`），故国服 uid 在此处
 *          直接拦截并告知游戏内兑换途径。
 *
 *          兑换对象是该 CK 所属账号：查询一律只用发起者本人绑定该 uid 的 CK（`query` 自带这道
 *          归属闸），故不会把礼包兑换到别人账号上。
 *
 *          多个兑换码之间须留间隔，否则第二个即收到 `-2016`。
 */
import type { Session } from "../core/session.js"
import { resolveRegionKind } from "../core/region.js"
import type { MhyDeps } from "./deps.js"

/** 单次最多兑换的数量 */
const MAX_CDK = 5

/** 两次兑换之间的间隔，毫秒 */
const CDK_GAP = 5_000

/** 兑换码的形态：字母数字，6~24 位 */
const CDK_RE = /^[A-Za-z0-9]{6,24}$/

/** 兑换码入口的说明 */
const CDK_GUIDE = "兑换码通常于官方直播、公告中发放，格式形如「GENSHINGIFT」，发送「#兑换码 XXXX」即可，支持一次发送多个"

/** 兑换接口的 retcode → 可读文案 */
const CDK_TEXT: Readonly<Record<string, string>> = {
  "-2017": "这个兑换码已经用过了",
  "-2018": "这个兑换码已经用过了",
  "-2001": "兑换码已过期",
  "-2003": "兑换码不存在，请确认是否填写有误",
  "-2004": "兑换码有误，请确认是否填写有误",
  "-2016": "兑换过于频繁，请十秒后重试",
  "-1071": "需重新登录一次米游社，请私聊发送一次「#绑定CK」后重试",
  "-1073": "该账号尚未在米游社绑定角色",
  "-1004": "该兑换码不适用于当前账号所在的区服"
}

/**
 * 等待一段时间
 * @param ms 毫秒
 */
async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>(resolve => setTimeout(resolve, ms))
}

/**
 * `#兑换码`
 * @param s 会话
 * @param deps 依赖
 * @param gap 两次兑换之间的间隔
 */
export async function useCdk(s: Session, deps: MhyDeps, gap: number = CDK_GAP): Promise<void> {
  const codes = [...new Set(s.rest.split(/[\s,，、;；]+/).filter(Boolean))]
  if (!codes.length) {
    await s.text(CDK_GUIDE)
    return
  }

  const uid = await deps.mys.resolveUid({ user: s.user, game: s.game })
  if (!uid) {
    await s.text("尚未绑定 uid，请先发送「#绑定CK」完成账号绑定后再行兑换")
    return
  }

  const kind = resolveRegionKind(uid, s.game)
  if (kind === "official" || kind === "bilibili") {
    await s.text(
      [
        `${uid} 为国服账号，米游社未对国服开放网页兑换。`,
        "国服兑换码请在游戏内「设置 - 账户 - 兑换码」中输入，或于官方兑换页面完成兑换。"
      ].join("\n")
    )
    return
  }

  const bad = codes.filter(code => !CDK_RE.test(code))
  const good = codes.filter(code => CDK_RE.test(code)).slice(0, MAX_CDK)
  const lines: string[] = []

  for (const [index, code] of good.entries()) {
    if (index > 0) await sleep(gap)
    const res = await deps.mys.query("useCdk", {
      user: s.user,
      game: s.game,
      uid,
      data: { cdk: code }
    })
    if (res.ok) {
      lines.push(`✓ ${code} 兑换成功，请在游戏邮件中领取`)
      continue
    }
    lines.push(`✗ ${code} ${CDK_TEXT[String(res.retcode)] ?? res.message}`)
  }

  for (const code of bad) lines.push(`✗ ${code} 不像兑换码，兑换码仅包含字母与数字`)
  if (codes.length > good.length + bad.length) {
    lines.push(`一次最多兑换 ${MAX_CDK} 个，其余部分请稍后重新发送`)
  }

  await s.text(`${uid}\n${lines.join("\n")}`)
}
