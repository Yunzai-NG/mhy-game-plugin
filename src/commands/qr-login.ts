/**
 * 模块职责：`#扫码登录` —— 发一张登录二维码卡片，扫码确认后把凭据落库
 * 依赖方向：依赖 service/qr-login、service/mys、views/qr 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：群聊同样受理。凭据落到**发码的人**（`s.user`）名下，群里同时挂着几张一样的码时扫错一张，就是把
 *          自己的账号绑给了别人，故图上印发起者的标识码让扫的人核对。说明也全画进图里。
 *
 *          出图失败时退回纯文字 + 位图二维码，那一条不需要渲染器。
 *
 *          **落库走 `mys.bind`**（与绑定 CK 同一条路）：那一步查一次角色列表，
 *          既验证凭据可用又把 uid 记下来。少了它会"登录成功但查不到 uid"。
 *
 *          **stoken 单独存一栏**，不并进 Cookie 文本：权限更大、取用点也不同。
 */
import type { Session } from "../core/session.js"
import { maskLtuid } from "../core/text.js"
import { buildQrCard, qrCardText } from "../views/qr.js"
import { saveBindRoles } from "./ck.js"
import type { MhyDeps } from "./deps.js"

/**
 * `#扫码登录`
 * @param s 会话
 * @param deps 依赖
 */
export async function qrLogin(s: Session, deps: MhyDeps): Promise<void> {
  const service = deps.qrLogin
  if (!service) {
    await s.text("扫码登录未启用")
    return
  }

  const created = await service.create(s.user)
  if (!created.ok) {
    await s.text(`取二维码失败，请稍后重试：${created.message}`)
    return
  }

  const card = buildQrCard(created.url, s.user)
  if (!(await s.image("qr-login", { ...card, _skin: "skin-neutral" }))) {
    await s.text(qrCardText(card))
    if (!(await s.imageBytes(created.png))) {
      await s.text("二维码发不出去，本次已取消。请确认适配器支持发图")
      return
    }
  }

  const got = await service.wait(s.user, created.ticket, {
    onScanned: async (): Promise<void> => {
      await s.text("已扫描，请在手机上点确认")
    }
  })
  if (!got.ok) {
    await s.text(got.message)
    return
  }

  const out = await deps.mys.bind(got.credentials.cookie, { user: s.user })
  if (!out.ok) {
    await s.text(`绑定失败，请重新「#扫码登录」：${out.message ?? "请稍后重试"}`)
    return
  }
  await deps.cookies.setStoken(got.credentials.ltuid, got.credentials.stoken)
  await saveBindRoles(deps, s.user, out)

  await s.text(
    [
      `扫码登录完成，米游社账号 ${maskLtuid(got.credentials.ltuid)}`,
      "现在可用「#社区签到」「#米游币」"
    ].join("\n")
  )
}
