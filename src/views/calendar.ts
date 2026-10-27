/**
 * 模块职责：日历视图 —— 十三天的时间窗、活动进度条、深渊轮换，以及原神的生日与今日天赋书
 * 依赖方向：依赖 core/when、core/text 与 service/calendar 的类型；不发请求、不碰磁盘
 * 生命周期：无状态纯函数
 * 注意事项：本仓库不引日期库，日期加减/中文月名/「多久之前」都在 core/when 与 core/text 里自备。**时间窗是「今天前后各六天」共十三天**，进度条 `left`/`width` 相对这十三天、超窗部分裁掉、但**是否收下看未裁剪的起止**。
 *          **深渊轮换两游戏算法完全不同**：原神按自然月与每月 16 日各两档；星铁是以本版本开始时间对齐出的 14 天轮换、三模式轮转、取模为零时首末标题互换。
 */
import { humanize } from "../core/text.js"
import { CN_MONTHS, INDENT } from "../core/text.js"
import { DAY_MS, addDays, atHour, dateTime, isoDate, monthDayTime, parseWhen } from "../core/when.js"
import type { AnnItem, TimeFix } from "../service/calendar.js"
import { FULLTIME, GS_IGNORE, GS_IGNORE_IDS, SR_IGNORE, SR_IGNORE_IDS } from "../service/calendar.js"
import { weekdayOf } from "./gs/index.js"

/** 时间窗的天数 */
const WINDOW_DAYS = 13

/** 一年的毫秒数 —— 比这更长的活动一律按"永久有效"显示 */
const YEAR_MS = 365 * DAY_MS

/** 一个版本的天数，星铁深渊与原神「版本期间持续开放」都按它算 */
const VERSION_DAYS = 42

/** 星铁深渊的轮换周期 */
const SR_CYCLE_DAYS = 14

/** 星铁三种深渊模式换算的锚点 */
const SR_ABYSS_ANCHOR = "2024-06-24 04:00:00"

/** 一个月里的一段日期 */
export interface CalMonth {
  /** 月份，1 起 */
  month: number
  /** 这一段里的日号 */
  date: number[]
  /** 与 `date` 一一对应的周几，周一为 0 */
  week: number[]
}

/** 十三天的时间窗 */
export interface CalWindow {
  /** 按月分段的日期 */
  dateList: CalMonth[]
  /** 窗口起点，当天 00:00:00 */
  startTime: number
  /** 窗口终点，当天 23:59:59 */
  endTime: number
  /** 窗口总跨度，毫秒 */
  totalRange: number
  /** 当前时刻在窗口里的百分比位置 */
  nowLeft: number
}

/**
 * 算出十三天的时间窗
 *
 * 起点是六天前的零点、终点是六天后的 23:59:59。
 * @param now 当前时刻，缺省取系统时间
 * @returns 时间窗
 */
export function dateWindow(now: number = Date.now()): CalWindow {
  const dateList: CalMonth[] = []
  let month = 0
  let date: number[] = []
  let week: number[] = []
  let first = 0
  let last = 0

  for (let idx = 0; idx < WINDOW_DAYS; idx++) {
    const at = new Date(addDays(now, idx - 6))
    const m = at.getMonth() + 1
    const d = at.getDate()
    if (month === 0) {
      first = at.getTime()
      month = m
    }
    if (month !== m && date.length > 0) {
      dateList.push({ month, date, week })
      date = []
      week = []
      month = m
    }
    date.push(d)
    week.push(weekdayOf(at))
    if (idx === WINDOW_DAYS - 1) {
      dateList.push({ month, date, week })
      last = at.getTime()
    }
  }

  const startTime = parseWhen(`${isoDate(first)} 00:00:00`)
  const endTime = parseWhen(`${isoDate(last)} 23:59:59`)
  const totalRange = endTime - startTime
  return { dateList, startTime, endTime, totalRange, nowLeft: ((now - startTime) / totalRange) * 100 }
}

/** 一段深渊周期 */
export interface AbyssSpan {
  /** 开始时刻 */
  start: number
  /** 结束时刻 */
  end: number
  /** 标题，形如 `「深境螺旋」· 八月` */
  title: string
}

/**
 * 原神的深渊与剧诗周期
 *
 * 深境螺旋每月 16 日四点换，幻想真境剧诗每月 1 日四点换。上月与本月各一档，
 * 与时间窗有交集的才收下。
 * @param window 时间窗
 * @param now 当前时刻
 * @returns 与窗口有交集的周期
 */
export function gsAbyssSpans(window: CalWindow, now: number = Date.now()): AbyssSpan[] {
  const at = new Date(now)
  const ym = (offset: number): string => {
    const one = new Date(at.getFullYear(), at.getMonth() + offset, 1)
    return `${one.getFullYear()}-${String(one.getMonth() + 1).padStart(2, "0")}`
  }
  const name = (offset: number): string => CN_MONTHS[(((at.getMonth() + offset) % 12) + 12) % 12] ?? ""

  const [last, curr, next] = [ym(-1), ym(0), ym(1)]
  const lastM = name(-1)
  const currM = name(0)
  const check: AbyssSpan[] = [
    { start: parseWhen(`${last}-01 04:00:00`), end: parseWhen(`${curr}-01 03:59:59`), title: `「幻想真境剧诗」· ${lastM}` },
    { start: parseWhen(`${curr}-01 04:00:00`), end: parseWhen(`${next}-01 03:59:59`), title: `「幻想真境剧诗」· ${currM}` },
    { start: parseWhen(`${last}-16 04:00:00`), end: parseWhen(`${curr}-16 03:59:59`), title: `「深境螺旋」· ${lastM}` },
    { start: parseWhen(`${curr}-16 04:00:00`), end: parseWhen(`${next}-16 03:59:59`), title: `「深境螺旋」· ${currM}` }
  ]

  const { startTime, endTime } = window
  return check.filter(
    one => (one.start <= startTime && startTime <= one.end) || (one.start <= endTime && endTime <= one.end)
  )
}

/**
 * 星铁的三种深渊周期
 *
 * 一档 42 天、每 14 天开一档、故同时三档在跑。档位与模式的对应由本版本开始时间对齐到周一四点、再与锚点按 14 天取模得出；**取模为零时首末标题互换**（少了那一档模式名整体错位）。
 * @param window 时间窗
 * @param versionStart 本版本「更新概览」公告的开始时间
 * @param now 当前时刻
 * @returns 与窗口有交集的周期，每段带模式标题
 */
export function srAbyssSpans(window: CalWindow, versionStart: string, now: number = Date.now()): AbyssSpan[] {
  const anchor = parseWhen(SR_ABYSS_ANCHOR)
  const base = versionStart ? parseWhen(versionStart) : now
  // `day(1)` 取的是「周日起算的那一周」的周一，故周日会往后挪一天而不是往前挪六天
  const at = new Date(base)
  // 分秒在此归零：版本开始时间一律是整点，故归零与否无差别
  let first = atHour(addDays(base, 1 - at.getDay()), 4)
  const drift = Math.abs(Math.trunc((anchor - first) / DAY_MS) % SR_CYCLE_DAYS)
  if (drift !== 0) first = addDays(first, -drift)

  const before1 = addDays(first, -2 * SR_CYCLE_DAYS)
  const before0 = addDays(first, -SR_CYCLE_DAYS)
  let titles = ["「混沌回忆」", "「虚构叙事」", "「末日幻影」"]
  if (Math.trunc((anchor - before0) / DAY_MS) % SR_CYCLE_DAYS === 0) {
    titles = [titles[2] ?? "", titles[1] ?? "", titles[0] ?? ""]
  }

  const starts = [before1, before0, first, ...[1, 2, 3, 4].map(n => addDays(first, n * SR_CYCLE_DAYS))]
  const check: AbyssSpan[] = starts.map((start, idx) => ({
    start,
    end: addDays(start, VERSION_DAYS),
    title: titles[idx % 3] ?? ""
  }))

  return check.filter(one => (one.start <= now && now <= one.end) || (now <= one.start && one.start <= window.endTime))
}

/** 日历上的一条 */
export interface CalItem {
  /** 公告 id */
  id: number
  /** 标题 */
  title: string
  /** 类别，决定配色与图标：`activity` / `normal` / `character` / `weapon` / `pass` / `abyss*` */
  type: string
  /** 排序权重，小者在前 */
  sort: number
  /** 合并状态：1 待配对、2 已定 */
  mergeStatus: number
  /** 横幅图，绝对地址 */
  banner: string
  /** 原神角色池的卡面；星铁是头像数组 */
  banner2?: string | string[]
  /** 星铁光锥池的图数组 */
  banner3?: string[]
  /** 标签小图，绝对地址 */
  icon: string
  /** 左端在窗口里的百分比 */
  left: number
  /** 宽度百分比 */
  width: number
  /** 进度条上的文字 */
  label: string
  /** 裁剪后的时长，排序用 */
  duration: number
  /** 开始时刻，`MM-DD HH:mm` */
  start: string
  /** 结束时刻 */
  end: string
  /** 同类里的序号，配色用 */
  idx?: number
  /** 原神角色池的头像 */
  face?: string
  /** 原神角色池的角色元素 */
  elem?: string
  /** 原神角色池的角色名 */
  character?: string
}

/** 一个角色在日历里要用到的图与元素 */
export interface CalChar {
  /** 元素键 */
  elem?: string
  /** 头像，相对元数据根 */
  face?: string
  /** 卡面，相对元数据根 */
  card?: string
}

/** 造一条时要用到的上下文 */
export interface CalItemCtx {
  /** 时间窗 */
  window: CalWindow
  /** 当前时刻 */
  now: number
  /** 公告 id → 时间修正 */
  timeMap: Record<string, TimeFix>
  /** 按名字查角色，只有原神角色池要 */
  char?: (name: string) => CalChar | undefined
  /** 星铁跃迁公告自带的图，按出现顺序取用；本函数会从中取走 */
  gachaImgs?: string[]
}

/**
 * 按标题给原神的一条公告分类
 *
 * 「概率UP」的三种形态：武器（标题里带 `长柄武器·` 一类前缀）、集录、角色祈愿。
 * @param title 标题
 * @param char 查角色
 * @returns 类别、清理过的标题与附加字段
 */
export function gsClassify(
  title: string,
  char?: (name: string) => CalChar | undefined
): { type?: string; title: string; extra: Partial<CalItem> } {
  if (/概率UP/.test(title)) {
    const weapon = /(单手剑|双手剑|长柄武器|弓|法器)·/g
    if (weapon.test(title)) return { type: "weapon", title: title.replace(weapon, ""), extra: { sort: 3 } }
    if (/集录/.test(title)) return { title, extra: { sort: 2 } }
    if (/祈愿/.test(title)) {
      // 取组不能直接下标：标题里没有半角括号时匹配为空，硬取会抛错并让整条命令失败
      const name = /·(.*)\(/.exec(title)?.[1]
      const got = name ? char?.(name) : undefined
      if (!name || !got) return { type: "character", title, extra: { sort: 1 } }
      return {
        type: "character",
        title,
        extra: {
          sort: 1,
          character: name,
          ...(got.card ? { banner2: got.card } : {}),
          ...(got.face ? { face: got.face } : {}),
          ...(got.elem ? { elem: got.elem } : {})
        }
      }
    }
    return { title, extra: {} }
  }
  if (/纪行/.test(title)) return { type: "pass", title, extra: {} }
  return { title, extra: {} }
}

/**
 * 按标题给星铁的一条公告分类
 * @param one 公告
 * @param gachaImgs 跃迁公告自带的图，命中时从中取走一张
 * @returns 类别与附加字段
 */
export function srClassify(one: AnnItem, gachaImgs?: string[]): { type?: string; extra: Partial<CalItem>; banner?: string } {
  const title = one.title ?? ""
  if (/流光定影/.test(title)) {
    return {
      type: "weapon",
      extra: { sort: 2, ...(one.banner3 ? { banner3: one.banner3 } : {}) },
      banner: gachaImgs?.shift() ?? ""
    }
  }
  // 新版本把角色与光锥并成一条「x.x版本活动跃迁（其一 / 其二）」，那一条的图就是公告自带的那张
  if (/版本活动跃迁/.test(title)) {
    return { type: "character", extra: { sort: 1 }, banner: one.img ?? one.banner ?? gachaImgs?.shift() ?? "" }
  }
  if (/角色活动跃迁/.test(title)) {
    return {
      type: "character",
      extra: { sort: 1, ...(one.banner2 ? { banner2: one.banner2 } : {}) },
      banner: gachaImgs?.shift() ?? ""
    }
  }
  if (/无名勋礼/.test(title)) return { type: "pass", extra: {} }
  return { extra: {} }
}

/** 绝区零公告里不进日历的那些（系统说明、周边、社区类） */
export const ZZZ_IGNORE =
  /(更新公告|已知问题|游戏优化|FAQ|诈骗|防沉迷|公平运营|小程序|绳网认证|专属工具|周边|新品情报|商城|上新说明|问卷|调研)/

/**
 * 按标题给绝区零的一条公告分类
 *
 * 绝区零的卡池叫「限时频段」（代理人与音擎同一条），活动多以「…活动说明」为题。图片公告的标题常带一层 HTML，先剥掉。
 * @param one 公告
 * @returns 类别、清理过的标题与图
 */
export function zzzClassify(one: AnnItem): { type?: string; title: string; extra: Partial<CalItem>; banner: string } {
  const title = (one.title ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
  const banner = one.banner || one.img || ""
  if (/限时频段/.test(title)) return { type: "character", title, extra: { sort: 1 }, banner }
  if (/丽都城募|驱动之证/.test(title)) return { type: "pass", title, extra: {}, banner }
  return { title: title.replace(/活动说明$/, ""), extra: {}, banner }
}

/**
 * 造一条日历项
 *
 * 起止时刻取「时间表修正优先、否则用列表给的」（判据是修正串长度超六字符才认）。裁剪只影响进度条位置与长度，是否收下看未裁剪的起止（否则跨窗的长期活动会整条消失）。
 * @param one 公告
 * @param ctx 上下文
 * @param opts 分类结果与默认类别
 * @returns 日历项；被排除或落在窗口外时 undefined
 */
export function buildItem(
  one: AnnItem,
  ctx: CalItemCtx,
  opts: { type: string; title: string; extra: Partial<CalItem>; isAct: boolean; banner?: string }
): CalItem | undefined {
  const id = one.ann_id ?? 0
  const fix = ctx.timeMap[String(id)] ?? {}
  if (fix.display === false) return undefined

  const pick = (a: string | undefined, b: string | undefined): number =>
    parseWhen(a && a.length > 6 ? a : (b ?? ""))
  const sDate = pick(fix.start, one.start_time)
  const eDate = pick(fix.end, one.end_time)
  const { startTime, endTime, totalRange } = ctx.window
  const sTime = Math.max(sDate, startTime)
  const eTime = Math.min(eDate, endTime)

  const left = ((sTime - startTime) / totalRange) * 100
  const width = ((eTime - startTime) / totalRange) * 100 - left

  const now = ctx.now
  let label = ""
  if (FULLTIME.test(opts.title) || eDate - sDate > YEAR_MS) {
    label = sDate < now ? `${monthDayTime(sDate)} 后永久有效` : "永久有效"
  } else if (now > sDate && eDate > now) {
    label = `${monthDayTime(eDate)} (${humanize(eDate - now)}后结束)`
    if (width > (opts.isAct ? 38 : 55)) label = `${monthDayTime(sDate)} ~ ${label}`
  } else if (sDate > now) {
    label = `${monthDayTime(sDate)} (${humanize(sDate - now)}后开始)`
  } else if (opts.isAct) {
    label = `${monthDayTime(sDate)} ~ ${monthDayTime(eDate)}`
  }

  if (sDate > endTime || eDate < startTime) return undefined
  return {
    sort: opts.isAct ? 5 : 10,
    ...opts.extra,
    id,
    title: opts.title,
    type: opts.type,
    mergeStatus: ["activity", "normal"].includes(opts.type) ? 1 : 0,
    banner: opts.banner ?? (opts.isAct ? (one.banner ?? "") : ""),
    icon: one.tag_icon ?? "",
    left,
    width,
    label,
    duration: eTime - sTime,
    start: monthDayTime(sDate),
    end: monthDayTime(eDate)
  }
}

/**
 * 把待配对的两条并成一行
 *
 * `mergeStatus` 为 1 的条目里凡「我结束不晚于对方开始」就并作一行（两条不重叠的短活动共享一行）。同时给角色/武器池编号（配色用），并数出**从窗口最左端就开始的角色池有几个**（模板 `char-N-M` 类名靠它定上方留几行）。
 * @param list 已排好序的日历项
 * @returns 行、类名与角色池数
 */
export function mergeRows(list: CalItem[]): { rows: CalItem[][]; charMode: string; charCount: number } {
  let charCount = 0
  let charOld = 0
  let weaponCount = 0
  const rows: CalItem[][] = []

  for (const one of list) {
    if (one.type === "character") {
      charCount++
      if (one.left === 0) charOld++
      one.idx = charCount
    }
    if (one.type === "weapon") {
      weaponCount++
      one.idx = weaponCount
    }
    if (one.mergeStatus === 1) {
      for (const other of list) {
        // `other !== one` 不可省：`width` 为零的条目会与自己配对，那一行于是出现两次
        if (other.mergeStatus === 1 && other !== one && one.left + one.width <= other.left) {
          one.mergeStatus = 2
          other.mergeStatus = 2
          rows.push([one, other])
          break
        }
      }
    }
    if (one.mergeStatus !== 2) {
      one.mergeStatus = 2
      rows.push([one])
    }
  }
  return { rows, charMode: `char-${charCount}-${charOld}`, charCount }
}

/** 一个角色在日历里的输入形态 */
export interface CalCharInput {
  /** 角色 id */
  id: string
  /** 展示名，取简称 */
  name: string
  /** 星级 */
  star: number
  /** 头像，相对元数据根 */
  face: string
  /** 生日，形如 `7-15` */
  birth?: string
  /** 天赋书名 */
  talent?: string
  /** 周本材料图标，相对元数据根 */
  weekly?: string
  /** 是否旅行者 —— 天赋书那一块不收他 */
  isMain?: boolean
}

/** 一本天赋书在日历里的输入形态 */
export interface CalTalentInput {
  /** 全名，与角色的 `talent` 对得上 */
  name: string
  /** 简称 */
  abbr: string
  /** 国家名 */
  city: string
  /** 图标，相对元数据根 */
  icon: string
  /** 轮换周期号 */
  week?: number
  /** 国家序号，排序与配色用 */
  cid?: number
}

/** 生日那一格里的一个角色 */
export interface CalBirthChar {
  /** 展示名 */
  name: string
  /** 星级 */
  star: number
  /** 头像 */
  face: string
}

/** 今日天赋书的一组 */
export interface CalTalentGroup extends CalTalentInput {
  /** 用这本书的角色，按星级与 id 降序 */
  chars: (CalBirthChar & { id: string; weekly?: string })[]
}

/**
 * 算出生日表
 *
 * **生日为 `1-1` 的一律不收**（元数据里是旅行者的占位值，已实装角色没有真在 1 月 1 日过生日的）。
 * @param dateList 时间窗里的日期
 * @param chars 全部角色
 * @returns 日期 → 角色，以及一格里最多几个（模板据此定行高）
 */
export function charBirthOf(
  dateList: readonly CalMonth[],
  chars: readonly CalCharInput[]
): { charBirth: Record<string, CalBirthChar[]>; charNum: number } {
  const charBirth: Record<string, CalBirthChar[]> = {}
  for (const m of dateList) for (const d of m.date) charBirth[`${m.month}-${d}`] = []

  for (const one of chars) {
    if (!one.birth || one.birth === "1-1") continue
    charBirth[one.birth]?.push({ name: one.name, star: one.star, face: one.face })
  }
  let charNum = 0
  for (const list of Object.values(charBirth)) charNum = Math.max(charNum, list.length)
  return { charBirth, charNum }
}

/**
 * 算出今日天赋书与用得上它的角色
 *
 * 传进来的天赋书应已按"今天能刷"筛过（四星、周日全放行）。**角色里的旅行者不收**。
 * @param talents 今日的天赋书
 * @param chars 全部角色
 * @returns 按国家序号排好的组
 */
export function charTalentOf(
  talents: readonly CalTalentInput[],
  chars: readonly CalCharInput[]
): CalTalentGroup[] {
  const groups = new Map<string, CalTalentGroup>()
  for (const one of talents) groups.set(one.name, { ...one, chars: [] })

  for (const one of chars) {
    if (one.isMain || !one.talent) continue
    const group = groups.get(one.talent)
    if (!group) continue
    group.chars.push({
      id: one.id,
      name: one.name,
      star: one.star,
      face: one.face,
      ...(one.weekly ? { weekly: one.weekly } : {})
    })
  }

  const out = [...groups.values()].sort((a, b) => (a.cid ?? 0) - (b.cid ?? 0))
  for (const group of out) {
    // 星级高的在前，同星级里 id 大的在前
    group.chars.sort((a, b) => b.star - a.star || (Number(b.id) || 0) - (Number(a.id) || 0))
  }
  return out
}

/** 造日历视图的输入 */
export interface CalendarInput {
  /** 游戏 */
  game: "gs" | "sr" | "zzz"
  /** 活动公告 */
  acts: readonly AnnItem[]
  /** 普通公告，只有原神有 */
  normal?: readonly AnnItem[]
  /** 公告 id → 时间修正 */
  timeMap?: Record<string, TimeFix>
  /** 星铁跃迁公告自带的图 */
  gachaImgs?: readonly string[]
  /** 星铁：本版本更新公告的开始时间 */
  versionStart?: string
  /** 星铁：公告里没有跃迁条目时用来顶上的伪造条目 */
  fakeGacha?: readonly AnnItem[]
  /** 原神：按名字查角色的图与元素 */
  char?: (name: string) => CalChar | undefined
  /** 原神：全部角色 */
  chars?: readonly CalCharInput[]
  /** 原神：今日的天赋书 */
  talents?: readonly CalTalentInput[]
  /** 当前时刻，缺省取系统时间 */
  now?: number
  /** 展示模式：整张日历还是只列活动 */
  mode?: "calendar" | "list"
}

/** 日历视图 */
export interface CalendarView extends CalWindow, Record<string, unknown> {
  /** 游戏 */
  game: string
  /** 每行一到两条 */
  list: CalItem[][]
  /** 深渊那几条单独一层 */
  abyss: CalItem[]
  /** 模板据此定上方留几行 */
  charMode: string
  /** 生日一格里最多几个 */
  charNum: number
  /** 日期 → 生日的角色 */
  charBirth: Record<string, CalBirthChar[]>
  /** 今日天赋书 */
  charTalent: CalTalentGroup[]
  /** 当前时刻，`YYYY-MM-DD HH:mm` */
  nowTime: string
  /** 今天是几号，模板据此高亮那一列 */
  nowDate: number
  /** 展示模式 */
  displayMode: string
}

/**
 * 造日历视图
 *
 * 顺序：先活动公告（原神那一路它在 `list[1]`）、再普通公告，然后是深渊；
 * 排序键是 `sort, start, duration`，最后才配对成行。
 * @param input 输入
 * @returns 视图
 */
export function buildCalendar(input: CalendarInput): CalendarView {
  const now = input.now ?? Date.now()
  const window = dateWindow(now)
  const gachaImgs = [...(input.gachaImgs ?? [])]
  const ctx: CalItemCtx = {
    window,
    now,
    timeMap: input.timeMap ?? {},
    ...(input.char ? { char: input.char } : {}),
    gachaImgs
  }

  const list: CalItem[] = []
  const add = (one: AnnItem, isAct: boolean): void => {
    const id = one.ann_id ?? 0
    const title = one.title ?? ""
    if (!title) return
    if (input.game === "gs") {
      if (GS_IGNORE_IDS.includes(id) || GS_IGNORE.test(title)) return
      const got = gsClassify(title, ctx.char)
      const built = buildItem(one, ctx, {
        type: got.type ?? (isAct ? "activity" : "normal"),
        title: got.title,
        extra: got.extra,
        isAct
      })
      if (built) list.push(built)
      return
    }
    if (input.game === "zzz") {
      const got = zzzClassify(one)
      if (!got.title || ZZZ_IGNORE.test(got.title)) return
      const built = buildItem(one, ctx, { type: got.type ?? "activity", title: got.title, extra: got.extra, isAct: true, banner: got.banner })
      if (built) list.push(built)
      return
    }
    if (SR_IGNORE_IDS.includes(id) || SR_IGNORE.test(title)) return
    const got = srClassify(one, gachaImgs)
    const built = buildItem(one, ctx, {
      type: got.type ?? "activity",
      title,
      extra: got.extra,
      isAct: true,
      banner: got.banner ?? one.banner ?? ""
    })
    if (built) list.push(built)
  }

  for (const one of input.acts) add(one, true)
  for (const one of input.normal ?? []) add(one, false)
  // 星铁的跃迁公告有时整组缺失（版本刚开或公告延后），此时用卡池表顶上
  if (input.game === "sr" && !list.some(one => one.type === "character" || one.type === "weapon")) {
    for (const one of input.fakeGacha ?? []) add(one, true)
  }

  // 绝区零各挑战玩法的轮换没有公开的固定周期，不编时间条
  const spans =
    input.game === "gs"
      ? gsAbyssSpans(window, now)
      : input.game === "sr"
        ? srAbyssSpans(window, input.versionStart ?? "", now)
        : []
  const abyss: CalItem[] = []
  for (const span of spans) {
    const built = buildItem(
      { ann_id: 0, title: span.title, start_time: dateTime(span.start), end_time: dateTime(span.end) },
      ctx,
      { type: abyssType(input.game, span.title), title: span.title, extra: {}, isAct: true, banner: "" }
    )
    if (built) abyss.push(built)
  }

  list.sort((a, b) => a.sort - b.sort || cmp(a.start, b.start) || a.duration - b.duration)
  const merged = mergeRows(list)
  const birth = charBirthOf(window.dateList, input.chars ?? [])

  return {
    ...window,
    game: input.game,
    list: merged.rows,
    abyss,
    charMode: merged.charMode,
    charNum: birth.charNum,
    charBirth: birth.charBirth,
    charTalent: input.game === "gs" ? charTalentOf(input.talents ?? [], input.chars ?? []) : [],
    nowTime: dateTime(now),
    nowDate: new Date(now).getDate(),
    displayMode: input.mode ?? "calendar"
  }
}

/**
 * 按标题取深渊那一条的类别 —— 类别决定图标文件名与配色
 * @param game 游戏
 * @param title 标题
 * @returns 类别
 */
export function abyssType(game: string, title: string): string {
  if (game === "gs") return /「幻想真境剧诗」/.test(title) ? "newAbyss" : "abyss"
  if (title === "「混沌回忆」") return "abyss-1"
  if (title === "「虚构叙事」") return "abyss-2"
  return "abyss-3"
}

/**
 * 字符串比较，供排序用
 * @param a 其一
 * @param b 其二
 * @returns 负数、零或正数
 */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 游戏 → 纯文字形态的标题 */
const GAME_TITLE: Readonly<Record<string, string>> = { gs: "原神", sr: "星铁", zzz: "绝区零" }

/**
 * 日历视图 → 纯文字
 *
 * 没有渲染器时用。**只列标题与时间**（进度条那层信息在纯文本无从表达，退回每条一行）；深渊单列一段（最常被问的一项）。
 * @param view 视图
 * @returns 多行文本
 */
export function calendarText(view: CalendarView): string {
  const line = (one: CalItem): string => `${one.title}${INDENT}${one.label || `${one.start} ~ ${one.end}`}`
  const lines = [`${GAME_TITLE[view.game] ?? ""}日历${INDENT}${view.nowTime}`]
  if (view.abyss.length > 0) {
    lines.push("【深渊】", ...view.abyss.map(line))
  }
  const flat = view.list.flat()
  if (flat.length > 0) {
    lines.push("【活动】", ...flat.map(line))
  }
  if (flat.length === 0 && view.abyss.length === 0) return "这十三天里没有正在进行或即将开始的活动"
  return lines.join("\n")
}
