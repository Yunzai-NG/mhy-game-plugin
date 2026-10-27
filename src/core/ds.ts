/**
 * 模块职责：米游社请求签名（DS）
 * 依赖方向：只依赖 Node 内置 crypto
 * 生命周期：无状态纯函数
 * 注意事项：签名算错的表现是 `retcode: 10001`（"请先登录"）而非 401，极易误判成 Cookie 过期
 *          进而把有效 CK 移出池；`t` / `r` 故设计为可注入，供测试固定签名字节。
 *
 *          `b` 与 `q` 的顺序、空值时保留空串而不省略键，都是服务端逐字节对账的一部分，
 *          任何以整洁为目的的改写都会让签名失效。
 */
import { createHash } from "node:crypto"

/** 国服 DS 盐 */
export const SALT_CN = "xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs"

/** 国际服 DS 盐 */
export const SALT_OS = "okr4obncj8bw5a65hbnn5oo6ixjc3l9w"

/**
 * 签到接口的盐（lk2）
 *
 * 签到走另一套签名：只对 `salt` / `t` / `r` 取 md5，`r` 是六位随机字符串而非数字。
 * 误用 {@link signDs} 得到的是 `retcode: 10001`「请先登录」，与 Cookie 失效同形。
 */
export const SALT_SIGN = "sjdNFJB7XxyDWGIAk0eTV8AOCfMJmyEo"

/**
 * 米游社 App 内部接口的盐（x6）
 *
 * 走 {@link signDs} 那套算法（含 `b` 与 `q`），但换这把盐。小组件取数、社区签到都用它。
 */
export const SALT_X6 = "t0qEgfub6cvueAPgR5m9aQWWVciEer7v"

/**
 * 米游社 App 内部接口的另一把盐（k2）
 *
 * 走 {@link signDs1}（只对 `salt` / `t` / `r` 取 md5）。小组件的原神与绝区零、
 * 社区任务状态查询都用它。
 */
export const SALT_K2 = "S9Hrn38d2b55PamfIR9BNA3Tx9sQTOem"

/**
 * 通行证接口的盐
 *
 * 扫码登录那一族（`passport-api.mihoyo.com`）单独一把，算法同 {@link signDs}。
 */
export const SALT_PASS = "JwYDpKvLj6MrMqqYU6jTKF17KNO2PXoS"

/** DS 签名的输入 */
export interface DsInput {
  /** query 串，不含问号；无 query 时留空 */
  query?: string
  /** 请求体的 JSON 文本；GET 请求留空串 */
  body?: string
  /** 盐，默认国服盐 */
  salt?: string
  /** 时间戳（秒），测试用 */
  time?: number
  /** 随机数，测试用 */
  random?: number
}

/**
 * 生成 6 位随机数
 *
 * 位数须与米游社客户端一致：改了服务端不拒绝，但请求在风控日志里的特征会与真实客户端不同。
 * @returns 100000~999999 的整数
 */
function randomSix(): number {
  return Math.floor(Math.random() * 900000 + 100000)
}

/**
 * 算 DS 请求头
 * @param input 签名输入
 * @returns 形如 `t,r,md5` 的 DS 值
 */
export function signDs(input: DsInput = {}): string {
  const salt = input.salt ?? SALT_CN
  const t = input.time ?? Math.round(Date.now() / 1000)
  const r = input.random ?? randomSix()
  const q = input.query ?? ""
  const b = input.body ?? ""
  const ds = createHash("md5").update(`salt=${salt}&t=${t}&r=${r}&b=${b}&q=${q}`).digest("hex")
  return `${t},${r},${ds}`
}

/**
 * 按区服选盐
 * @param cn 是否国服
 * @returns 对应的盐
 */
export function saltFor(cn: boolean): string {
  return cn ? SALT_CN : SALT_OS
}

/** DS1 的随机串取值范围，取六位小写字母与数字 */
const DS1_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789"

/**
 * 生成 DS1 用的六位随机串
 * @returns 六位小写字母与数字
 */
function randomStr(): string {
  let out = ""
  for (let i = 0; i < 6; i += 1) {
    out += DS1_CHARS[Math.floor(Math.random() * DS1_CHARS.length)]
  }
  return out
}

/**
 * 算签到接口的 DS（DS1）
 *
 * 与 {@link signDs} 是**两套不同的算法**，理由与用错的表现见 {@link SALT_SIGN}。
 * @param input 盐与可注入的时间、随机串
 * @returns 形如 `t,r,md5` 的 DS 值
 */
export function signDs1(input: { salt?: string; time?: number; random?: string } = {}): string {
  const salt = input.salt ?? SALT_SIGN
  const t = input.time ?? Math.floor(Date.now() / 1000)
  const r = input.random ?? randomStr()
  return `${t},${r},${createHash("md5").update(`salt=${salt}&t=${t}&r=${r}`).digest("hex")}`
}
