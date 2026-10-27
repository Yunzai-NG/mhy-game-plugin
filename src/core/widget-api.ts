/**
 * 模块职责：米游社小组件（widget）接口 —— 桌面小组件用的那条免验证码体力接口
 * 依赖方向：纯数据与纯函数，依赖 core/cookie 与 core/ds；不碰 IO
 * 生命周期：无状态
 * 注意事项：本插件第三套签名与请求头（前两套见 core/api.ts 与 core/sign-api.ts）。
 *
 *          它凭 stoken 而不是 Cookie：Cookie 头只有 `stuid` / `stoken` / `mid` 三项，
 *          没绑 stoken 的账号用不了它，调用方须自行退回实时便笺。
 *
 *          单独接它的理由是背景轮询不吃验证码：实时便笺是风控最紧的一条，在使用者不知情的
 *          情况下每天查几次容易撞上 `1034`，而撞上之后使用者自己手动查也一并被挡。
 *          故后台轮询走这条，使用者当场发 `#体力` 仍走实时便笺 —— 后者字段更全（派遣剩余
 *          时间、洞天宝钱回复时间、周本与质变仪）。
 *
 *          只有国服：国际服没有这套 `aapi/widget`，那类账号一律退回实时便笺。
 */
import type { GameKey } from "./region.js"
import { stokenCookie } from "./cookie.js"
import { SALT_K2, SALT_X6, signDs, signDs1 } from "./ds.js"

/** 原神与绝区零小组件的 DS 盐（k2），走 DS1；定义在 core/ds.ts，此处只作转出 */
export const SALT_WIDGET_K2 = SALT_K2

/**
 * 星穹铁道小组件的 DS 盐（x6）
 *
 * 星铁这一条走 DS2（带 `b` 与 `q`，即 {@link signDs} 那一套），与另两个游戏不同；
 * 用错报 `retcode: 10001`「请先登录」，与 stoken 失效完全相同。
 */
export const SALT_WIDGET_X6 = SALT_X6

/** 小组件请求头里的米游社 App 版本号 */
const APP_VERSION = "2.70.1"

/** 三个游戏的小组件地址，均为国服 */
const WIDGET_URLS: Readonly<Record<GameKey, string>> = {
  gs: "https://api-takumi-record.mihoyo.com/game_record/genshin/aapi/widget/v2",
  sr: "https://api-takumi-record.mihoyo.com/game_record/app/hkrpg/aapi/widget",
  zzz: "https://api-takumi-record.mihoyo.com/event/game_record_zzz/api/zzz/widget"
}

/**
 * 取小组件接口地址
 * @param game 游戏
 * @returns 完整 URL
 */
export function widgetUrl(game: GameKey): string {
  return WIDGET_URLS[game]
}

/**
 * 从整份 Cookie 里抠出小组件要的那三项
 *
 * 与社区签到共用同一套取法，实现在 core/cookie.ts。
 * @param cookie Cookie 文本
 * @returns 形如 `stuid=1;stoken=v2_x;mid=m1_y;` 的串；没有 stoken 时 undefined
 */
export function widgetCookie(cookie: string): string | undefined {
  return stokenCookie(cookie)
}

/**
 * 算小组件请求的 DS
 *
 * 星铁与另两个游戏是两套算法，理由见 {@link SALT_WIDGET_X6}。小组件是 GET 且不带 query，
 * 故星铁那一支的 `b` 与 `q` 都是空串 —— 空值要保留而不是省略，服务端逐字节对账。
 * @param game 游戏
 * @returns DS 头的值
 */
export function widgetDs(game: GameKey): string {
  return game === "sr" ? signDs({ salt: SALT_WIDGET_X6, query: "", body: "" }) : signDs1({ salt: SALT_WIDGET_K2 })
}

/** 拼小组件请求头要的那台设备 */
export interface WidgetDevice {
  /** `x-rpc-device_id` */
  id: string
  /** `x-rpc-device_name` */
  name: string
  /** `x-rpc-device_model` */
  model: string
}

/**
 * 拼小组件请求头
 *
 * 设备号取本插件里那台稳定的设备而非每次随机：设备漂移是米游社的重点风控特征。
 * @param game 游戏
 * @param cookie {@link widgetCookie} 拼好的那三项
 * @param device 设备
 * @returns 请求头
 */
export function widgetHeaders(game: GameKey, cookie: string, device: WidgetDevice): Record<string, string> {
  return {
    "x-rpc-app_version": APP_VERSION,
    "x-rpc-client_type": "2",
    "x-rpc-channel": "miyousheluodi",
    "x-rpc-device_id": device.id.toUpperCase(),
    "x-rpc-device_name": device.name,
    "x-rpc-device_model": device.model,
    "x-rpc-sys_version": "12",
    Referer: "https://app.mihoyo.com",
    "User-Agent": "okhttp/4.8.0",
    DS: widgetDs(game),
    Cookie: cookie
  }
}
