/**
 * 模块职责：扫码登录卡片的视图模型 —— 把一条登录地址与该使用者的标识码折成一张图的数据
 * 依赖方向：依赖 core/qr（画 SVG）；纯函数，不碰 IO
 * 生命周期：无状态
 * 注意事项：说明一律画在图里、不另发文字（分两条消息时，扫的人会对着新说明扫上一张过期码）。**必须印标识码**：印发起者平台账号让扫的人核对是不是发给自己的，扫错会把账号绑到别人名下。
 *          标识码**只印平台与账号尾数**（见 {@link maskAccount}），印全串等于在群里公开它。
 */
import { qrSvg } from "../core/qr.js"

/** 卡片上那几句提示 */
export interface QrTip {
  /** 提示正文 */
  text: string
  /** 是否为警示（模板据此改用红色） */
  warn?: boolean
}

/** 扫码登录卡片的数据 */
export interface QrCardView {
  /** 主标题 */
  title: string
  /** 副标题 */
  subtitle: string
  /** 二维码的 SVG 文本，模板以 `{{@svg}}` 原样嵌入 */
  svg: string
  /** 标识码，即发起者的平台账号（已遮蔽） */
  code: string
  /** 有效期说明 */
  expire: string
  /** 逐条提示 */
  tips: QrTip[]
}

/** 二维码在卡片上的边长（像素） */
const QR_SIZE = 460

/**
 * 遮蔽平台账号，只留平台名与尾四位
 *
 * 印全串等于在群里公开它；核对「是不是我的」只需尾数。
 * @param user 会话里的使用者标识，形如 `qq:123456789`
 * @returns 形如 `qq:****6789`
 */
export function maskAccount(user: string): string {
  const at = user.indexOf(":")
  const platform = at > 0 ? user.slice(0, at) : ""
  const id = at > 0 ? user.slice(at + 1) : user
  const tail = id.length <= 4 ? id : `****${id.slice(-4)}`
  return platform ? `${platform}:${tail}` : tail
}

/**
 * 造扫码登录卡片的数据
 * @param url 二维码里那条登录地址
 * @param user 发起者的平台标识，用于印标识码
 * @param opts 选项
 * @returns 卡片数据
 */
export function buildQrCard(url: string, user: string, opts: { minutes?: number } = {}): QrCardView {
  return {
    title: "米游社扫码登录",
    subtitle: "用米游社 App 扫码并在手机上确认",
    svg: qrSvg(url, { size: QR_SIZE }),
    code: maskAccount(user),
    expire: `${opts.minutes ?? 3} 分钟内有效`,
    tips: [
      { text: "请核对下方标识码是不是你自己的，扫错会把账号绑到别人名下", warn: true },
      { text: "本插件由此取得 stoken：能查体力、能签到、能取米游币，权限大于 Cookie", warn: true },
      { text: "凭据只存在机器人所在机器的数据目录里，不出现在任何回复或日志中" },
      { text: "随时可发送「#删除CK」清掉它" }
    ]
  }
}

/**
 * 卡片出不了图时的纯文字回退
 *
 * **须自成完整答案**：出不了图时使用者只拿到它，随后那张二维码靠 `imageBytes` 直接发字节（不需渲染器）。
 * @param view 卡片数据
 * @returns 多行文本
 */
export function qrCardText(view: QrCardView): string {
  return [
    `${view.title}（标识码 ${view.code}）`,
    view.subtitle,
    ...view.tips.map(one => `· ${one.text}`),
    view.expire
  ].join("\n")
}
