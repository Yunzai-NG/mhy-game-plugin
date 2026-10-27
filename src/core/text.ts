/**
 * 模块职责：面向使用者的文案 —— 失败提示与若干通用格式化
 * 依赖方向：仅依赖本插件的 mys 类型，无任何 IO
 * 生命周期：无状态纯函数，可自由并发调用
 * 注意事项：失败提示要指明下一步该做什么，而不是把 retcode 原样抛给使用者。
 *          文案集中于此，同一类失败在体力、札记、角色三处说的是同一句话。
 */
import type { QueryFail } from "../service/mys.js"

/**
 * 列表缩进使用的全角空格
 *
 * 与中文等宽，可与上一行对齐。抽成常量另有一项作用：在模板字符串里直接写该字符
 * 会被 `no-irregular-whitespace` 拦截。
 */
export const INDENT = "　"

/** 未实装角色被 `enableUnreleased` 挡下时的固定文案，图鉴、面板、排行三处共用 */
export const UNRELEASED_TEXT = "该角色尚未正式实装，主人已关闭「允许查未实装角色」"

/** 各类失败对应的固定文案；`undefined` 表示采用接口原文更为合适 */
const FAIL_TEXT: Readonly<Record<string, string | undefined>> = {
  nouid: "请先「#绑定uid100000001」或「#绑定CK」",
  nock: undefined,
  cookie: "ck已失效，请「#刷新ck」，无效则重新「#扫码登录」",
  risk: "需过验证码，请在米游社 App 里查一次战绩后重试",
  limit: "今日查询已达上限，零点后重试",
  private: "对方未公开战绩，请其在米游社「我的角色」开启「查询显示」",
  notfound: "查不到该 uid，请确认填写无误",
  unsupported: "当前游戏不支持此查询",
  http: "连不上米游社，请稍后重试",
  unknown: undefined
}

/**
 * 将查询失败转换为一条可据以操作的提示
 *
 * 认得的那几类只给处置办法；认不得的那一类另印接口名与 retcode —— 一条命令里往往有三四个
 * 请求，接口原文不指明是哪一条失败的。
 * @param fail 查询失败结果
 * @returns 提示文案
 */
export function failText(fail: QueryFail): string {
  const fixed = FAIL_TEXT[fail.kind]
  if (fixed) return fixed
  const raw = fail.message || "查询失败，请稍后重试"
  // 没有可用 CK 是插件自己判的、一个请求都没发：那句话已说清该做什么，接口名对使用者只是噪音
  if (fail.kind === "nock") return raw
  const mark = [fail.api, fail.retcode ? `retcode ${fail.retcode}` : ""].filter(one => !!one).join(" ")
  return mark ? `${raw}（${mark}）` : raw
}

/**
 * 遮蔽米游社账号 id
 *
 * ltuid 即账号本体，而使用者会把回复原样贴到群里求助，故回复文案一律只给遮蔽形态。
 * @param ltuid 账号标识
 * @returns 遮蔽后的字符串
 */
export function maskLtuid(ltuid: string): string {
  return ltuid.length <= 4 ? "****" : `${ltuid.slice(0, 3)}****${ltuid.slice(-2)}`
}

/**
 * 秒数 → "3 小时 25 分"
 * @param seconds 秒数
 * @returns 可读时长；不足一分钟时返回 "不足 1 分钟"
 */
export function duration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return "不足 1 分钟"
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (!hours) return `${minutes} 分钟`
  if (!minutes) return `${hours} 小时`
  return `${hours} 小时 ${minutes} 分`
}

/**
 * 秒数 → 恢复的时刻，形如 "今天 21:30" / "明天 08:05"
 * @param seconds 距当前时间的秒数
 * @param now 当前时间，缺省取系统时间（供测试注入）
 * @returns 可读时刻；超过两日时仅给出日期
 */
export function at(seconds: number, now: number = Date.now()): string {
  const when = new Date(now + Math.max(0, seconds) * 1000)
  const hm = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`
  const today = new Date(now)
  const days = Math.round(
    (new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000
  )
  if (days <= 0) return `今天 ${hm}`
  if (days === 1) return `明天 ${hm}`
  if (days === 2) return `后天 ${hm}`
  return `${when.getMonth() + 1} 月 ${when.getDate()} 日 ${hm}`
}

/**
 * 秒数 → "2天3小时5分钟"
 *
 * 与 {@link duration} 的差别只在书写形态：模板的排版按不含空格的紧凑写法设计，加空格会撑破格子。
 * @param seconds 秒数
 * @returns 紧凑时长；不足一分钟时返回 "即将完成"
 */
export function cnDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const parts = [
    Math.floor(total / 86_400) ? `${Math.floor(total / 86_400)}天` : "",
    Math.floor((total % 86_400) / 3600) ? `${Math.floor((total % 86_400) / 3600)}小时` : "",
    Math.floor((total % 3600) / 60) ? `${Math.floor((total % 3600) / 60)}分钟` : ""
  ].filter(Boolean)
  return parts.length ? parts.join("") : "即将完成"
}

/**
 * 时间戳 → "2026年08月22日"
 * @param ms 毫秒时间戳
 * @returns 年月日
 */
export function cnDate(ms: number): string {
  const d = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, "0")
  return `${d.getFullYear()}年${two(d.getMonth() + 1)}月${two(d.getDate())}日`
}

/** 星期名，`Date.getDay()` 直接取下标 */
export const WEEK = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const

/**
 * 时间戳 → 星期名
 * @param ms 毫秒时间戳
 * @returns 形如 `星期五`
 */
export function weekOf(ms: number): string {
  return WEEK[new Date(ms).getDay()] ?? ""
}

/**
 * 时间戳 → 时段称谓，如 `上午` / `深夜`
 *
 * 绝区零便笺把"预计恢复时间"写成"时段 + 12 小时制时刻"两段，此为其前一段。
 * @param ms 毫秒时间戳
 * @returns 时段称谓
 */
export function dayPart(ms: number): string {
  const h = new Date(ms).getHours()
  if (h < 6) return "凌晨"
  if (h < 12) return "上午"
  if (h < 18) return "下午"
  if (h < 20) return "傍晚"
  if (h < 22) return "晚上"
  return "深夜"
}

/**
 * 时间戳 → 12 小时制 "hh:mm"
 * @param ms 毫秒时间戳
 * @returns 形如 `09:05`
 */
export function clock12(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours() % 12
  const two = (n: number): string => String(n).padStart(2, "0")
  return `${two(h === 0 ? 12 : h)}:${two(d.getMinutes())}`
}

/**
 * 时间戳 → "08-22 10:05"
 * @param ms 毫秒时间戳
 * @returns 可读日期时间；传入 0 时返回 "—"
 */
export function stamp(ms: number): string {
  if (!ms) return "—"
  const d = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, "0")
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/**
 * 把一段远端来的文本收拾成可以进路径的一节
 *
 * 只留字母、数字、下划线与连字符（`\p{L}` 含中日韩，故「胡桃」原样保留），其余换成下划线。
 *
 * 这是一道安全边界，不是美观问题：攻略索引里的作者名与文章号来自远端 JSON 且会成为缓存文件名，
 * 原样拼进路径等于把"写到缓存目录之外去"的能力交给那份 JSON。`.` 与两种斜杠都在被换掉的字符里。
 * @param one 原文
 * @returns 可以进路径的一节；原文为空或全被过滤时为空串
 */
export function safeSegment(one: string): string {
  return one.replace(/[^\p{L}\p{N}_-]/gu, "_").replace(/^_+|_+$/g, "")
}

/** 中文月名，`Date.getMonth()` 直接取下标 */
export const CN_MONTHS = [
  "一月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "十一月",
  "十二月"
] as const

/**
 * 毫秒数 → 一句相对时长
 *
 * 日历进度条标签「MM-DD HH:mm (3 天后结束)」括号里那一段。分档与中文串是固定口径，
 * 改了会让同一条活动的相对时间与别处显示的不一致。
 * @param ms 毫秒数，取绝对值
 * @returns 形如 `几秒` / `25 分钟` / `3 天` / `2 个月` / `1 年`
 */
export function humanize(ms: number): string {
  const abs = Math.abs(ms)
  const round = (n: number): number => Math.round(n)
  const seconds = round(abs / 1000)
  const minutes = round(abs / 60_000)
  const hours = round(abs / 3_600_000)
  const days = round(abs / 86_400_000)
  const months = round((abs / 86_400_000) * (4800 / 146_097))
  const years = round(months / 12)

  if (seconds <= 44) return "几秒"
  if (seconds < 45) return `${seconds} 秒`
  if (minutes <= 1) return "1 分钟"
  if (minutes < 45) return `${minutes} 分钟`
  if (hours <= 1) return "1 小时"
  if (hours < 22) return `${hours} 小时`
  if (days <= 1) return "1 天"
  if (days < 26) return `${days} 天`
  if (months <= 1) return "1 个月"
  if (months < 11) return `${months} 个月`
  if (years <= 1) return "1 年"
  return `${years} 年`
}
