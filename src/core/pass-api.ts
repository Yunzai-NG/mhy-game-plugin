/**
 * 模块职责：扫码登录用到的接口与它们的请求头
 * 依赖方向：依赖 core/ds（签名）与 core/device-profile 的设备形态；不碰 IO
 * 生命周期：无状态纯函数
 * 注意事项：取到的是 stoken（权限大于 ltoken），凭据与 ticket 的保密约束见 service/qr-login.ts。
 *          走通行证那条路（{@link createQrRequest} → {@link queryQrRequest}），不走 `hk4e-sdk` ——
 *          那条实测报「当前设备或网络环境存在风险」，且 `app_id=4` 的码登录的是原神而非米游社。
 *          三处写错都不报错：地址参数叫 `tk` 不是 `ticket`；状态字段叫 `status`（只认旧接口的
 *          `stat` 就"扫了码却一直等待扫码"）；`tokens` 的项只有 `token_type` 没有 `name`
 *          （{@link TOKEN_KINDS}）。签名算法同 {@link signDs}、盐用 {@link SALT_PASS}，请求体须与签名时逐字节相同。
 */
import { SALT_PASS, signDs } from "./ds.js"

/** 通行证接口域名 */
export const PASS_HOST = "https://passport-api.mihoyo.com"

/** 换 cookie_token 用的域名 */
export const TAKUMI_HOST = "https://api-takumi.mihoyo.com"

/** 米游社 App 版本号 */
const APP_VERSION = "2.70.1"

/** 通行证接口固定的应用标识 */
const APP_ID = "bll8iq97cem8"


/** 一次通行证请求 */
export interface PassRequest {
  /** 完整 URL */
  url: string
  /** 请求方法 */
  method: "GET" | "POST"
  /** 请求头 */
  headers: Record<string, string>
  /** 请求体的 JSON 文本；GET 时为 undefined */
  body?: string
}

/** 签名与请求头要用到的设备信息 */
export interface PassDevice {
  /** device_id */
  id: string
  /** 设备名 */
  name: string
  /** 设备型号 */
  model: string
  /** device_fp */
  fp: string
}

/**
 * 拼通行证接口的请求头
 *
 * 两处看着多余但都留着：`x-rpc-aigis` 为空串（服务端据它判"没有正在进行的验证"），
 * 以及 `Content-Type` 不带 charset —— 那是实测可用的形态。
 * @param device 设备
 * @param body 请求体 JSON 文本，GET 时传空串
 * @returns 请求头
 */
export function passHeaders(device: PassDevice, body: string): Record<string, string> {
  return {
    "x-rpc-app_id": APP_ID,
    "x-rpc-app_version": APP_VERSION,
    "x-rpc-client_type": "2",
    "x-rpc-game_biz": "bbs_cn",
    "x-rpc-sdk_version": "1.3.1.2",
    "x-rpc-device_id": device.id,
    "x-rpc-device_name": device.name,
    "x-rpc-device_model": device.model,
    "x-rpc-device_fp": device.fp,
    "x-rpc-sys_version": "11",
    "x-rpc-channel": "appstore",
    "x-rpc-aigis": "",
    "User-Agent": "okhttp/4.8.0",
    "Content-Type": "application/json;",
    DS: signDs({ salt: SALT_PASS, query: "", body })
  }
}

/**
 * 申请一个登录二维码
 *
 * 请求体是空对象：`token_types` 由服务端定，写了不改变结果却会改变签名覆盖的 body。
 * @param device 设备
 * @returns 请求
 */
export function createQrRequest(device: PassDevice): PassRequest {
  const body = JSON.stringify({})
  return {
    url: `${PASS_HOST}/account/ma-cn-passport/app/createQRLogin`,
    method: "POST",
    headers: passHeaders(device, body),
    body
  }
}

/**
 * 查一次二维码的状态
 *
 * 返回的 `data.status` 依次为 `Created` / `Scanned` / `Confirmed`（旧接口叫 `stat`，
 * 取值也不同，故调用方两者都要认）。到 `Confirmed` 时 `data.tokens` 里直接就有 stoken，
 * `data.user_info` 里有 `aid` 与 `mid`。
 * @param device 设备
 * @param ticket 申请时拿到的 ticket
 * @returns 请求
 */
export function queryQrRequest(device: PassDevice, ticket: string): PassRequest {
  const body = JSON.stringify({ ticket })
  return {
    url: `${PASS_HOST}/account/ma-cn-passport/app/queryQRLoginStatus`,
    method: "POST",
    headers: passHeaders(device, body),
    body
  }
}

/** `tokens` 数组里的一项 */
export interface PassToken {
  /** 名字，形如 `stoken_v2` / `ltoken`；**通行证接口不给这一项** */
  name?: string
  /** 类别编号，取值见 {@link TOKEN_KINDS} */
  token_type?: number
  /** token 本体 */
  token?: string
}

/**
 * 三类 token 各自的名字与类别编号
 *
 * 通行证接口给的是编号不是名字：`tokens` 里只有 `{token_type, token}`，只按名字挑的表现是
 * 明明取到了 stoken 却报「没有给出 stoken」。`1` 是 stoken 而不是"第一个"。
 * 名字这一支仍留着：换 ltoken 那条旧接口给的是名字。
 */
export const TOKEN_KINDS = {
  stoken: { names: ["stoken_v2", "stoken"], type: 1 },
  ltoken: { names: ["ltoken_v2", "ltoken"], type: 2 },
  cookieToken: { names: ["cookie_token_v2", "cookie_token"], type: 4 }
} as const

/** 认得的 token 类别 */
export type PassTokenKind = keyof typeof TOKEN_KINDS

/**
 * 从 `tokens` 数组里挑一类 token
 *
 * 名字先按整串比、再按前缀比，都没有再按 {@link TOKEN_KINDS} 的编号比。
 * 刻意不退回"第一个有值的"：只有 stoken 的返回里那样会把 stoken 当成 ltoken 塞进 Cookie，
 * 两者权限不同且不报错。
 * @param tokens tokens 数组
 * @param kind 想要哪一类
 * @returns token 本体；一个都没有时 undefined
 */
export function pickToken(tokens: readonly PassToken[] | undefined, kind: PassTokenKind): string | undefined {
  const list = tokens ?? []
  const { names, type } = TOKEN_KINDS[kind]
  for (const want of names) {
    const exact = list.find(one => one?.name === want && one.token)
    if (exact?.token) return exact.token
  }
  for (const want of names) {
    const like = list.find(one => one?.name?.startsWith(want) && one.token)
    if (like?.token) return like.token
  }
  return list.find(one => one?.token_type === type && one.token)?.token
}

/**
 * 把一项 token 说成一句不含凭据的话
 *
 * 供诊断日志用：只出名字与编号，绝不出 token 本体。
 * @param one 一项 token
 * @returns 形如 `stoken_v2` 或 `编号 1`
 */
export function tokenLabel(one: PassToken | undefined): string {
  if (one?.name) return one.name
  if (one?.token_type !== undefined) return `编号 ${one.token_type}`
  return "无名无编号"
}


/**
 * 凭 stoken 换 ltoken
 * @param device 设备
 * @param stoken stoken 形态的 Cookie 片段
 * @returns 请求
 */
export function ltokenRequest(device: PassDevice, stoken: { stuid: string; stoken: string; mid?: string }): PassRequest {
  const query = [`stuid=${stoken.stuid}`, `stoken=${stoken.stoken}`, ...(stoken.mid ? [`mid=${stoken.mid}`] : [])].join(
    "&"
  )
  return {
    url: `${PASS_HOST}/account/auth/api/getLTokenBySToken?${query}`,
    method: "GET",
    headers: passHeaders(device, "")
  }
}

/**
 * 凭 stoken 换 cookie_token
 *
 * `game_biz` 固定为原神：这一条只是取通行证层面的 cookie_token，与查哪个游戏无关。
 * @param stoken stoken 形态的 Cookie 片段
 * @returns 请求
 */
export function cookieTokenRequest(stoken: { stuid: string; stoken: string; mid?: string }): PassRequest {
  const query = [
    "game_biz=hk4e_cn",
    `uid=${stoken.stuid}`,
    `stoken=${stoken.stoken}`,
    ...(stoken.mid ? [`mid=${stoken.mid}`] : [])
  ].join("&")
  return {
    url: `${TAKUMI_HOST}/auth/api/getCookieAccountInfoBySToken?${query}`,
    method: "GET",
    headers: { "User-Agent": "okhttp/4.8.0" }
  }
}

/**
 * 从二维码地址里取出 ticket
 *
 * 两种参数名都要认：通行证那条地址里它叫 `tk`，游戏登录那条叫 `ticket`。调用方应优先用
 * 返回里的 `data.ticket`，这个函数只是兜底。
 * @param url 二维码地址
 * @returns ticket；解析不出时 undefined
 */
export function parseTicket(url: string): string | undefined {
  return /[?&](?:ticket|tk)=([^&#]+)/.exec(url)?.[1]
}
