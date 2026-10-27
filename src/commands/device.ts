/**
 * 模块职责：设备相关命令 —— 查看设备 / 绑定真机 / 解绑真机
 * 依赖方向：依赖 session / text / device 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**设备以米游社账号（ltuid）为单位**，故绑定真机时一并绑给名下全部 CK。
 *
 *          绑定与解绑都会重置"已养成的常用设备"，故两条命令都明说这个代价而不静默变更。
 *
 *          抓包内容常混有 Cookie，故这两条命令**仅在私聊受理**。
 */
import type { Session } from "../core/session.js"
import { maskLtuid, stamp, INDENT } from "../core/text.js"
import { isBlankOaid, parseBoundDevice, rawOaidOf } from "../core/device.js"
import type { DeviceView } from "../core/device.js"
import type { DeviceIdentity } from "../core/device-profile.js"
import type { MhyDeps } from "./deps.js"

/**
 * 获取真机设备信息的指引，回复使用者时原样发出
 *
 * **两条路都要写清**：工具导出的 JSON 带 `oaid` 但没有 device_id，只有抓包才拿得到后者。
 */
const DEVICE_GUIDE = [
  "两种方式都可以，任选其一：",
  "一、用手机上的「设备信息」类工具导出一段 JSON 直接发来，形如：",
  '{"deviceModel":"AB1234X","androidVersion":"14","deviceFingerprint":"acme/AB1234/…","deviceName":"AB1234","deviceBoard":"demo","deviceProduct":"AB1234","oaid":"ffd1…"}',
  "其中 oaid 是必需的（用于稳定标识这台设备），其余有几项发几项；oaid 全是 0 时先去系统设置里给那个工具开匿名设备标识。",
  "二、抓一次米游社 App 的请求，发送请求头里的这几项：",
  "x-rpc-device_id、x-rpc-device_fp、x-rpc-device_name、x-rpc-device_model、x-rpc-sys_version",
  "抓包原文可直接整段粘贴，本插件自行解析 —— 但请先删掉其中的 Cookie 各行"
].join("\n")

/** oaid 是一串 0 或 `error_xxx` 时的回复：没取到，不能拿来标识设备 */
const BLANK_OAID = [
  "这段设备信息里的 oaid 没取到（全是 0 或 error），不能用来标识这台设备，本次未绑定。",
  "原因是系统没给这个工具开「匿名设备标识符」。以 vivo 为例：",
  `${INDENT}设置 → 安全 → 更多安全设置 → 广告与隐私 → 匿名设备标识符管理，把这个工具打开`,
  "其他品牌在「隐私」或「广告与隐私」里找同名的开关。开了之后重新打开工具复制一次，再发「#绑定设备」"
].join("\n")

/**
 * 把设备现状排成可读文本
 * @param view 设备现状
 * @param full 是否展示完整 device_id（仅私聊）
 * @returns 多行文本
 */
function describeDevice(view: DeviceView, full: boolean): string {
  const { active } = view
  const id = full ? active.id : `${active.id.slice(0, 8)}…`
  return [
    `${INDENT}当前用${active.source === "bound" ? "绑定的真机" : "分配的虚拟设备"}：${active.name}`,
    `${INDENT}${active.spec.brand} ${active.spec.model}｜Android ${active.spec.osVersion}｜${active.spec.screen}`,
    `${INDENT}device_id ${id}`,
    `${INDENT}启用于 ${stamp(active.createdAt)}｜${view.trusted ? "已满一天，算常用设备" : "还没满一天，风控会严一些"}`,
    `${INDENT}device_fp ${view.hasFp ? "已取得" : "还没取到，下次查询时自动取"}`,
    ...(view.bound ? [`${INDENT}另有分配的虚拟设备 ${view.virtual.name}，解绑后回落到它`] : [])
  ].join("\n")
}

/**
 * `#设备信息`
 * @param s 会话
 * @param deps 依赖
 */
export async function deviceInfo(s: Session, deps: MhyDeps): Promise<void> {
  const owned = await deps.cookies.owned(s.user)
  if (!owned.length) {
    await s.text("您名下未绑定任何 Cookie，设备于绑定 Cookie 时分配")
    return
  }

  const blocks: string[] = []
  for (const it of owned) {
    const view = await deps.devices.describe(it.ltuid)
    blocks.push([`米游社 ${maskLtuid(it.ltuid)}`, describeDevice(view, s.isPrivate)].join("\n"))
  }
  const tail = deps.config().allowBindDevice
    ? "如需启用手机上已养成的设备，请私聊发送「#绑定设备」"
    : "主人关闭了绑定真机，当前只用分配的虚拟设备"
  await s.text([...blocks, tail].join("\n"))
}

/**
 * `#绑定设备`
 *
 * 一次绑到名下全部账号：用户想表达的是"这台手机是我的常用设备"。
 * @param s 会话
 * @param deps 依赖
 */
export async function bindDevice(s: Session, deps: MhyDeps): Promise<void> {
  if (!deps.config().allowBindDevice) {
    await s.text("主人关闭了绑定真机，当前统一使用框架分配的虚拟设备")
    return
  }
  if (!s.isPrivate) {
    await s.text("绑定设备仅支持私聊 —— 抓包内容中常混有 Cookie。请私聊发送「#绑定设备」")
    return
  }

  const owned = await deps.cookies.owned(s.user)
  if (!owned.length) {
    await s.text("您名下未绑定任何 Cookie，请先发送「#绑定CK」，再绑定设备")
    return
  }

  const raw = s.rest || (await s.ask(`把设备信息发过来吧，60 秒内有效\n${DEVICE_GUIDE}`))
  const input = raw ? parseBoundDevice(raw) : undefined
  if (!input) {
    const oaid = raw ? rawOaidOf(raw) : undefined
    await s.text(
      !raw
        ? ["未收到设备信息，本次操作已取消。", DEVICE_GUIDE].join("\n")
        : oaid && isBlankOaid(oaid)
          ? BLANK_OAID
          : ["这段内容里既没有 device_id，也没有 oaid —— 两者至少要有一个才能标识这台设备：", DEVICE_GUIDE].join("\n")
    )
    return
  }

  const devices: DeviceIdentity[] = []
  for (const it of owned) devices.push(await deps.devices.bind(it.ltuid, input))
  const first = devices[0]
  await s.text(
    [
      `已把这台设备绑给名下 ${owned.length} 个米游社账号：${first?.name ?? input.id}`,
      `${INDENT}device_id ${input.id}`,
      input.fp ? `${INDENT}device_fp 已一并保存，将直接沿用手机上已养成的取值` : `${INDENT}未携带 device_fp，将于下次查询时自动获取`,
      "设备变了就要重新养一天，这一天里遇到验证码是正常的",
      "如需恢复为分配的虚拟设备，请发送「#解绑设备」"
    ].join("\n")
  )
}

/**
 * `#解绑设备`
 * @param s 会话
 * @param deps 依赖
 */
export async function unbindDevice(s: Session, deps: MhyDeps): Promise<void> {
  const owned = await deps.cookies.owned(s.user)
  if (!owned.length) {
    await s.text("您名下未绑定任何 Cookie")
    return
  }

  let count = 0
  for (const it of owned) if (await deps.devices.unbind(it.ltuid)) count += 1
  if (!count) {
    await s.text("您名下未绑定任何真机，此前始终使用分配的虚拟设备")
    return
  }
  await s.text(
    `已解绑 ${count} 个账号的真机，回落至各自分配的虚拟设备。虚拟设备的 device_id 未曾变更，此前养成的常用设备状态仍然有效`
  )
}
