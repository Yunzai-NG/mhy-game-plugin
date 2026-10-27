/**
 * 模块职责：Cookie 文本的解析、规范化，以及"这条 Cookie 属于哪个账号"的判定
 * 依赖方向：纯函数，只依赖 Node 标准库；不依赖内核
 * 生命周期：无状态，随调用创建与销毁
 * 注意事项：账号标识（下称 ltuid）是全部按人存储的主键，取值规则必须稳定 —— 同一份 Cookie
 *          无论多出空格、缺分号或键顺序不同都要得出同一个 ltuid，否则使用者会被分到第二台
 *          虚拟设备，而"更换设备"是米游社风控最敏感的动作。
 *
 *          故先切成键值对再按优先级取值，不在原始串上跑正则：`ltuid` 一类的正则会命中
 *          `ltuid_v2`，也分不出 `login_uid`。
 */

/**
 * 账号标识候选键，按优先级从高到低
 *
 * 前四项为数字 uid；后两项为 v2 体系的 mid（形如 `m1_xxxx`）。部分仅采用
 * `ltoken_v2 + ltmid_v2` 的 Cookie 不含数字 uid，此时 mid 为唯一可用的稳定键。
 */
export const LTUID_KEYS = ["ltuid_v2", "ltuid", "account_id_v2", "account_id", "ltmid_v2", "account_mid_v2"] as const

/** 判定 Cookie 是否具备"取角色面板/深渊"等要求登录态的键 */
const LOGIN_KEYS = ["cookie_token", "cookie_token_v2", "ltoken", "ltoken_v2"] as const

/**
 * 视同"这一项没有"的取值
 *
 * 浏览器里读不到某个键时拼串会得出字面量 `undefined`。按"键在即有值"处理，绑定会带着一个
 * 无效 token 发到米游社，报回 `-100`，与 Cookie 过期完全相同。
 */
const EMPTY_VALUES = new Set(["undefined", "null", "nan", "false", "-"])

/**
 * 不可见格式字符的码点区间
 *
 * 零宽空格、方向标记与 BOM，自手机端复制时常被一并带入。按码点列出而不写成含这些字符的
 * 正则 —— 那一行在编辑器里看起来是空的。
 */
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff]
]

/**
 * 去掉不可见的格式字符
 * @param raw 原始文本
 * @returns 去掉后的文本
 */
function stripInvisible(raw: string): string {
  let out = ""
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    if (INVISIBLE_RANGES.some(([lo, hi]) => code >= lo && code <= hi)) continue
    out += ch
  }
  return out
}

/**
 * 判文本里是否有 HTTP 头放不进去的字符
 *
 * 请求头只接受 latin1。判定放在绑定阶段，是为把「粘贴内容里混进了别的东西」与
 * 「Cookie 已过期」分开 —— 两者到了请求层是同样的一句报错。
 * @param raw 文本
 * @returns 含此类字符时为真
 */
export function hasIllegalChar(raw: string): boolean {
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    if (code > 0xff || code < 0x20) return true
  }
  return false
}

/**
 * 把 Cookie 文本切成键值对
 *
 * 只按第一个 `=` 拆分：`ltoken` 的取值里可能有 `=`（base64 填充），`split("=")` 会把它截断。
 * 取值为字面量 `undefined` 一类时按"这一项没有"处理，见 {@link EMPTY_VALUES}。
 * @param raw Cookie 文本，形如 `a=1; b=2`
 * @returns 键值对，键统一小写
 */
export function parseCookie(raw: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const piece of stripInvisible(raw).split(";")) {
    const at = piece.indexOf("=")
    if (at <= 0) continue
    const key = piece.slice(0, at).trim().toLowerCase()
    const value = piece.slice(at + 1).trim()
    if (!key || !value || EMPTY_VALUES.has(value.toLowerCase())) continue
    out.set(key, value)
  }
  return out
}

/**
 * 把键值对重新拼回 Cookie 文本
 * @param pairs 键值对
 * @returns Cookie 文本
 */
export function formatCookie(pairs: Map<string, string> | Iterable<readonly [string, string]>): string {
  const entries = pairs instanceof Map ? [...pairs] : [...pairs]
  return entries.map(([key, value]) => `${key}=${value}`).join("; ")
}

/**
 * 规范化用户粘贴的 Cookie
 *
 * 整段复制常夹带换行、重复键与末尾分号；规范化后同一份 Cookie 只有一种文本形态。
 * @param raw 原始文本
 * @returns 规范化后的 Cookie 文本；没有任何有效键时返回空串
 */
export function normalizeCookie(raw: string): string {
  return formatCookie(parseCookie(raw.replace(/[\r\n]+/g, ";")))
}

/**
 * 取账号标识
 * @param cookie Cookie 文本或已解析的键值对
 * @returns 账号标识；一个都找不到时 undefined
 */
export function pickLtuid(cookie: string | Map<string, string>): string | undefined {
  const pairs = typeof cookie === "string" ? parseCookie(cookie) : cookie
  for (const key of LTUID_KEYS) {
    const value = pairs.get(key)
    if (value) return value
  }
  return undefined
}

/**
 * 取数字账号 uid
 *
 * 与 {@link pickLtuid} 的区别：这个只收数字 uid，供必须填 `account_id` 的接口用；
 * 那个允许回落到 mid，供本地存储主键用。
 * @param cookie Cookie 文本或已解析的键值对
 * @returns 数字 uid 字符串；没有时 undefined
 */
export function pickAccountId(cookie: string | Map<string, string>): string | undefined {
  const pairs = typeof cookie === "string" ? parseCookie(cookie) : cookie
  for (const key of ["ltuid_v2", "ltuid", "account_id_v2", "account_id"] as const) {
    const value = pairs.get(key)
    if (value && /^\d+$/.test(value)) return value
  }
  return undefined
}

/**
 * 判断 Cookie 是否带着可用的登录态
 *
 * 只查键名，不发请求：用于在绑定阶段拦下"只复制了一部分"的粘贴失误。
 * @param cookie Cookie 文本或已解析的键值对
 * @returns 具备登录态键时为真
 */
export function hasLoginToken(cookie: string | Map<string, string>): boolean {
  const pairs = typeof cookie === "string" ? parseCookie(cookie) : cookie
  return LOGIN_KEYS.some(key => pairs.has(key))
}

/**
 * 取 stoken（用于米游币/兑换码等需要 SToken 的接口）
 * @param cookie Cookie 文本或已解析的键值对
 * @returns stoken；没有时 undefined
 */
export function pickStoken(cookie: string | Map<string, string>): string | undefined {
  const pairs = typeof cookie === "string" ? parseCookie(cookie) : cookie
  return pairs.get("stoken_v2") ?? pairs.get("stoken")
}

/**
 * 从整份 Cookie 里抠出 stoken 那一套请求头要的三项
 *
 * 只能有这三项：多带别的键会被判成另一种登录态，回的是 `retcode: 10001`「请先登录」。
 * `mid` 只有 v2 体系（`stoken` 以 `v2_` 打头）才必需，故取不到时不拼它而非整体失败。
 * @param cookie Cookie 文本
 * @returns 形如 `stuid=1;stoken=v2_x;mid=m1_y;` 的串；没有 stoken 时 undefined
 */
export function stokenCookie(cookie: string): string | undefined {
  const pairs = parseCookie(cookie)
  const stoken = pickStoken(pairs)
  if (!stoken) return undefined
  const stuid = pairs.get("stuid") ?? pairs.get("ltuid_v2") ?? pairs.get("ltuid") ?? pairs.get("account_id")
  if (!stuid) return undefined
  const mid = pairs.get("mid") ?? pairs.get("ltmid_v2") ?? pairs.get("account_mid_v2")
  const parts = [`stuid=${stuid}`, `stoken=${stoken}`]
  if (mid) parts.push(`mid=${mid}`)
  return `${parts.join(";")};`
}
