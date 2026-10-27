/**
 * 模块职责：日历的取数 —— 米游社公告列表与公告正文，以及从正文里抠出活动起止时间
 * 依赖方向：依赖 `ctx.http` / `ctx.kv`；不碰元数据、不碰 Cookie
 * 生命周期：随插件 setup 造一个实例
 * 注意事项：公告接口不带 Cookie、不要 DS（uid 写死 100000000），故不进 core/api.ts 那张表。
 *          列表的 `start_time` 往往是发布时间，真实起止要从正文里按分隔符切开再用正则抠「活动时间」
 *          （原神 `〓`，星铁先把 `<h1>` 换成 `※`）。认不出就退回列表时间 —— 排版每个版本都在变，
 *          整条命令报错不是合理结果。第三方源 `miao.games/api/calendar` 只给时间表打补丁
 *          （`display: false` 可隐掉某条），由 `enableCalendarFix` 把关且缺省关闭。列表与正文一并缓存十分钟。
 */
import type { HttpClient, KvNamespace, Logger } from "@yunzai-ng/types"
import type { GameKey } from "../core/region.js"
import { addDays, atHour, fullTime, parseWhen } from "../core/when.js"

/**
 * 有日历的游戏
 *
 * 三个游戏都有：原神星铁的起止要从正文里抠，绝区零的公告列表直接给真实起止（其活动全在图片公告 `pic_list` 里）。
 */
export type CalendarGame = GameKey

/** 两个游戏的公告列表接口 */
const LIST_API: Readonly<Record<CalendarGame, string>> = {
  gs:
    "https://hk4e-api.mihoyo.com/common/hk4e_cn/announcement/api/getAnnList?game=hk4e&game_biz=hk4e_cn" +
    "&lang=zh-cn&bundle_id=hk4e_cn&platform=pc&region=cn_gf01&level=55&uid=100000000",
  sr:
    "https://hkrpg-api.mihoyo.com/common/hkrpg_cn/announcement/api/getAnnList?game=hkrpg&game_biz=hkrpg_cn" +
    "&lang=zh-cn&auth_appid=announcement&authkey_ver=1&bundle_id=hkrpg_cn&channel_id=1&level=65&platform=pc" +
    "&region=prod_gf_cn&sdk_presentation_style=fullscreen&sdk_screen_transparent=true&sign_type=2&uid=100000000",
  zzz:
    "https://announcement-api.mihoyo.com/common/nap_cn/announcement/api/getAnnList?game=nap&game_biz=nap_cn" +
    "&lang=zh-cn&bundle_id=nap_cn&channel_id=1&level=60&platform=pc&region=prod_gf_cn&uid=10000000"
}

/** 两个游戏的公告正文接口 */
const CONTENT_API: Readonly<Record<CalendarGame, string>> = {
  gs:
    "https://hk4e-api.mihoyo.com/common/hk4e_cn/announcement/api/getAnnContent?game=hk4e&game_biz=hk4e_cn" +
    "&lang=zh-cn&bundle_id=hk4e_cn&platform=pc&region=cn_gf01&level=55&uid=100000000",
  sr:
    "https://hkrpg-api-static.mihoyo.com/common/hkrpg_cn/announcement/api/getAnnContent?game=hkrpg" +
    "&game_biz=hkrpg_cn&lang=zh-cn&bundle_id=hkrpg_cn&platform=pc&region=prod_gf_cn&level=65&channel_id=1",
  zzz:
    "https://announcement-static.mihoyo.com/common/nap_cn/announcement/api/getAnnContent?game=nap&game_biz=nap_cn" +
    "&lang=zh-cn&bundle_id=nap_cn&platform=pc&region=prod_gf_cn&level=60&channel_id=1"
}

/** 第三方的时间表补丁源 —— 由 `enableCalendarFix` 把关，缺省不请求 */
const FIX_API = "http://miao.games/api/calendar"

/** 缓存时长 */
const CACHE_TTL = "10m"

/** 单次请求的等待上限 */
const TIMEOUT = "20s"

/** 一条公告在列表里的形态 */
export interface AnnItem {
  /** 公告 id */
  ann_id?: number
  /** 标题 */
  title?: string
  /** 横幅图，绝对地址 */
  banner?: string
  /** 原神角色池的第二张图；星铁是头像数组 */
  banner2?: string | string[]
  /** 星铁光锥池的图数组 */
  banner3?: string[]
  /** 标签小图，绝对地址 */
  tag_icon?: string
  /** 列表里给的开始时间，多为公告发布时间 */
  start_time?: string
  /** 列表里给的结束时间 */
  end_time?: string
  /** 图片公告自带的图 */
  img?: string
}

/** 一条公告的正文 */
export interface AnnContent {
  /** 公告 id */
  ann_id?: number
  /** 标题 */
  title?: string
  /** 正文，HTML */
  content?: string
  /** 图片公告自带的图 */
  img?: string
}

/** 一条时间修正 */
export interface TimeFix {
  /** 开始时间 */
  start?: string
  /** 结束时间 */
  end?: string
  /** 显式为 false 时整条不出现（只有第三方补丁源会给） */
  display?: boolean
}

/** 一次取数的结果 */
export interface CalendarRaw {
  /** 活动公告 */
  acts: AnnItem[]
  /** 普通公告，只有原神分这两类 */
  normal: AnnItem[]
  /** 公告 id → 时间修正 */
  timeMap: Record<string, TimeFix>
  /** 星铁跃迁公告自带的图，按出现顺序取用 */
  gachaImgs: string[]
  /** 星铁用：本版本「更新概览」公告的开始时间，深渊轮换以它对齐 */
  versionStart: string
}

/** 标题里出现这些词的公告不进日历（原神那一份） */
export const GS_IGNORE =
  /(内容专题页|版本更新说明|调研|防沉迷|米游社|专项意见|更新修复与优化|问卷调查|版本更新通知|更新时间说明|预下载功能|周边限时|周边上新|角色演示)/

/** 星铁那一份，比原神长不少 */
export const SR_IGNORE =
  /(更新概览|游戏优化|优化说明|内容专题页|专题展示页|版本更新说明|循星归程|调研|防沉迷|米游社|专项意见|更新修复与优化|问卷调查|版本更新通知|更新时间说明|预下载功能|周边限时|周边上新|角色演示|角色PV|版本PV|动画短片|bilibili|激励计划|调整说明|攻略征集|测试招募|跃迁记录统计|有奖问卷|联动跃迁说明|商店上新)/

/** 按 id 排除的公告（注释即那条公告的标题） */
export const GS_IGNORE_IDS: readonly number[] = [
  495, // 有奖问卷调查开启！
  1263, // 米游社《原神》专属工具一览
  423, // 《原神》玩家社区一览
  422, // 《原神》防沉迷系统说明
  762 // 《原神》公平运营声明
]

/** 星铁那一份 */
export const SR_IGNORE_IDS: readonly number[] = [
  257, // 保密测试参与意愿调研
  194, // 有奖问卷
  203, // 《崩坏：星穹铁道》社媒聚合页上线
  183, // 官方社群一览
  187, // 《崩坏：星穹铁道》防沉迷系统公告
  185, // 《崩坏：星穹铁道》公平运营声明
  171 // 《崩坏：星穹铁道》社区专属工具一览
]

/** 永久有效的那类活动，标题命中即不按时间算进度条 */
export const FULLTIME = /(魔神任务)/

/** 时间串：至少九个「数字 / 斜杠 / 冒号 / 空格」 */
const TIME_RUN = /([0-9\\/: ]){9,}/

/** 带波浪号的起止时间串 */
const TIME_RANGE = /(?:活动时间)?(?:〓|\s)*([0-9\\/: ~]{6,})/

/** 星铁那一份用短横线分隔起止 */
const SR_TIME_RANGE = /(?:活动时间)?(?:※|\s)*([0-9\\/: -]{6,})/

/** 永久有效那一档的收尾时间 */
const FOREVER = "2099/01/01 00:00:00"

/**
 * 把正文里的标签剥掉
 *
 * 刻意不写成通用的 `<[^>]*>`：公告正文里有中文夹在尖括号里，通用写法会把它们一起吃掉。
 * @param html 正文
 * @returns 剥完的文本
 */
export function stripTags(html: string): string {
  return html.replace(/(<|&lt;)[\w "%:;=\-\\/(),.]+(>|&gt;)|(&nbsp;)/g, "")
}

/**
 * 从一段文本里取第一个时间串
 * @param text 文本
 * @returns 时间串；没有时为空串
 */
function timeIn(text: string): string {
  return TIME_RUN.exec(text)?.[0] ?? ""
}

/**
 * 把 `2026/08/12 11:00:00` 一类的写法规整成 `2026-08-12 11:00:00`
 * @param text 时间串
 * @returns 规整后的串
 */
function normalizeTime(text: string): string {
  return text.trim().replace(/\//g, "-")
}

/**
 * 收集原神各版本的更新时刻
 *
 * 后面「X.Y 版本更新后开启」一类相对写法要靠它换算成绝对时刻。六点换成十一点：公告写的是
 * 维护开始时间（六点），而活动实际在维护结束（十一点）后开。
 * @param list 公告正文列表
 * @returns 版本号（或「「XXX」」形态的版本名）→ 更新时刻
 */
export function gsVersionTimes(list: readonly AnnContent[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const one of list) {
    const version = /(\d\.\d|「[^」]*」)版本更新(?:通知|说明|维护预告)/.exec(one.title ?? "")?.[1]
    if (!version || out[version]) continue
    const raw = one.content ?? ""

    const section = /(?:更新(?:维护)?时间)\s*〓([^〓]+)(?:〓|$)/.exec(raw)?.[1]
    if (section) {
      const got = timeIn(section)
      if (got) out[version] = got.replace("06:00", "11:00")
      continue
    }
    // 没有「〓更新时间〓」那一节时退回全文里的「将于 …… 进行」
    const fallback = /(将于)(([0-9\\/: ]){9,})(进行)/.exec(stripTags(raw))?.[2]
    if (fallback) out[version] = fallback.replace("06:00", "11:00")
  }
  return out
}

/**
 * 收集星铁各版本的更新时刻
 *
 * 1.1 那一条是写死的种子 —— 那个版本的公告标题不合下面的正则。
 * @param list 公告正文列表
 * @returns 版本号 → 更新时刻
 */
export function srVersionTimes(list: readonly AnnContent[]): Record<string, string> {
  const out: Record<string, string> = { "1.1": "2022-06-07 11:00:00" }
  for (const one of list) {
    const version = /(\d\.\d)版本\S*更新(?:概览|说明)/.exec(one.title ?? "")?.[1]
    if (!version || out[version]) continue
    const section = /■(?:更新时间)\s*([^■]+)(?:■|$)/.exec(one.content ?? "")?.[1]
    if (!section) continue
    const got = timeIn(section)
    if (got) out[version] = got.replace("06:00", "11:00")
  }
  return out
}

/**
 * 从一条原神公告的正文里抠出活动起止时间
 *
 * 三种相对写法都要认，认不出就返回 undefined（调用方跳过这一条，退回列表里的时间）。
 * @param one 公告正文
 * @param versions {@link gsVersionTimes} 的返回
 * @returns 起止时间；认不出时 undefined
 */
export function gsEntryTime(one: AnnContent, versions: Record<string, string>): TimeFix | undefined {
  if (GS_IGNORE.test(one.title ?? "")) return undefined
  const text = stripTags(one.content ?? "")
  // 「冒险....包」是「冒险助力礼包」一类标题，中间四个字每次都不一样
  const section = /(?:活动时间|祈愿介绍|任务开放时间|冒险....包|折扣时间)\s*〓([^〓]+)(?:〓|$)/.exec(text)?.[1]
  if (!section) return undefined

  const range = TIME_RANGE.exec(section)?.[1] ?? ""
  let span = range ? range.split("~") : []

  const afterUpdate = /(\d\.\d|「[^」]*」)版本更新(?:完成)?后/.exec(section)?.[1]
  const during = /(\d\.\d|「[^」]*」)版本期间持续开放/.exec(section)?.[1]
  if (afterUpdate !== undefined) {
    const from = versions[afterUpdate]
    if (!from) return undefined
    if (/永久开放/.test(section)) span = [from, FOREVER]
    else {
      const got = timeIn(section)
      span = got ? [from, got] : []
    }
  } else if (during !== undefined) {
    const from = versions[during]
    if (!from) return undefined
    // 一个版本 42 天，末日按当天六点算
    span = [from, fullTime(atHour(addDays(parseWhen(from), 42), 6))]
  } else if (/后永久开放/.test(section)) {
    // 认不出就放弃这一条：直接取捕获组会在没有匹配时抛错，让整条命令一并失败
    span = range ? [range, FOREVER] : []
  }

  // 表格式活动：正文用表格分列多个阶段的开启时间与结束时间，没有 `~` 分隔（银翎溯月一类）。
  // 不补这一支就退回列表里的 start_time＝公告发布时刻，比活动实际开放早两天。取最早开启与最晚结束
  if (span.length !== 2) {
    const stamps = section.match(/\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/g) ?? []
    if (stamps.length >= 2) {
      const sorted = stamps.map(normalizeTime).sort((a, b) => a.localeCompare(b))
      span = [sorted[0] ?? "", sorted[sorted.length - 1] ?? ""]
    }
  }

  if (span.length !== 2) return undefined
  return { start: normalizeTime(span[0] ?? ""), end: normalizeTime(span[1] ?? "") }
}

/**
 * 从一条星铁公告的正文里抠出活动起止时间
 *
 * 与原神的差别有三处：分隔符是 `※`（由 `<h1>` 换来）、起止用短横线分隔（而非波浪号），
 * 以及「活动跃迁」那类公告要把自带的图收走给跃迁条目用。
 * @param one 公告正文
 * @param versions {@link srVersionTimes} 的返回
 * @returns 起止时间与是否为跃迁公告；认不出时 undefined
 */
export function srEntryTime(
  one: AnnContent,
  versions: Record<string, string>
): { time?: TimeFix; gacha?: string } | undefined {
  if (SR_IGNORE.test(one.title ?? "")) return undefined
  let text = (one.content ?? "").replaceAll('<h1 style="">', "※").replaceAll("</h1>", "※")
  text = text.replace(/(<|&lt;)[\w "%:;=\-\\/(),.]+(>|&gt;)/g, "")

  const matched = /(?:活动时间|活动跃迁|开放时间|开启时间|折扣时间|上架时间)\s*※([^※]+)(?:※|$)/.exec(text)
  if (!matched?.[1]) return undefined
  const gacha = /活动跃迁/.test(matched[0]) ? (one.img ?? "") : undefined
  const section = matched[1]

  let span: string[] = []
  const range = SR_TIME_RANGE.exec(section)?.[1] ?? ""
  const afterUpdate = /(\d\.\d)版本更新后/.exec(section)?.[1]
  if (afterUpdate !== undefined) {
    const from = versions[afterUpdate]
    if (!from) return undefined
    if (/永久开放/.test(section)) span = [from, FOREVER]
    else {
      const got = timeIn(section)
      span = got ? [from, got] : []
    }
  } else if (range) {
    span = range.split("-")
  }

  const out: { time?: TimeFix; gacha?: string } = {}
  if (gacha !== undefined) out.gacha = gacha
  if (span.length === 2) out.time = { start: normalizeTime(span[0] ?? ""), end: normalizeTime(span[1] ?? "") }
  return out
}

/** 公告列表接口的响应 */
interface ListBody {
  /** 数据 */
  data?: {
    /** 分组列表：原神 `[0]` 是游戏公告、`[1]` 是活动公告；星铁只有 `[0]` */
    list?: { list?: AnnItem[] }[]
    /** 图片公告，星铁的跃迁与活动在这里 */
    pic_list?: { type_list?: { list?: AnnItem[] }[] }[]
  }
}

/** 公告正文接口的响应 */
interface ContentBody {
  /** 数据 */
  data?: {
    /** 文字公告的正文 */
    list?: AnnContent[]
    /** 图片公告的正文，只有星铁要看 */
    pic_list?: AnnContent[]
  }
}

/** 造日历取数器需要的东西 */
export interface CalendarServiceOptions {
  /** HTTP 客户端 */
  http: HttpClient
  /** KV 命名空间，建议传 `ctx.kv.sub("calendar")` */
  kv: KvNamespace
  /** 日志器 */
  logger: Logger
  /** 取"是否允许请求第三方时间补丁"，每次现读 */
  fix: () => boolean
}

/**
 * 日历取数器
 */
export class CalendarService {
  readonly #http: HttpClient
  readonly #kv: KvNamespace
  readonly #logger: Logger
  readonly #fix: () => boolean

  /**
   * @param opts 选项
   */
  constructor(opts: CalendarServiceOptions) {
    this.#http = opts.http
    this.#kv = opts.kv
    this.#logger = opts.logger
    this.#fix = opts.fix
  }

  /**
   * 取一个游戏的日历原始数据
   * @param game 游戏
   * @returns 原始数据；公告列表取不到时 undefined
   */
  async fetch(game: CalendarGame): Promise<CalendarRaw | undefined> {
    const cached = await this.#kv.get<CalendarRaw>(`raw:${game}`)
    if (cached) return cached

    let list: ListBody
    try {
      list = await this.#http.get<ListBody>(LIST_API[game], { timeout: TIMEOUT, retry: 1 })
    } catch (err) {
      this.#logger.warn(`[米游社][日历] 取公告列表失败：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }

    const groups = list.data?.list ?? []
    const acts = (game === "gs" ? groups[1]?.list : groups[0]?.list) ?? []
    const normal = (game === "gs" ? groups[0]?.list : []) ?? []
    // 绝区零的活动与卡池分散在几组图片公告里，全收；星铁只看第一组（另几组是常驻说明）
    const picGroups = game === "zzz" ? (list.data?.pic_list ?? []) : (list.data?.pic_list ?? []).slice(0, 1)
    const pics = picGroups.flatMap(one => one.type_list ?? []).flatMap(one => one.list ?? [])

    // 绝区零的公告列表自带真实起止，正文不必取
    const parsed = game === "zzz" ? { timeMap: {}, gachaImgs: [] } : await this.#times(game)
    const raw: CalendarRaw = {
      acts: game === "gs" ? acts : [...acts, ...pics],
      normal,
      timeMap: parsed.timeMap,
      gachaImgs: parsed.gachaImgs,
      versionStart: acts.find(one => /版本更新(概览|说明)/.test(one.title ?? ""))?.start_time ?? ""
    }
    await this.#kv.set<CalendarRaw>(`raw:${game}`, raw, { ttl: CACHE_TTL })
    return raw
  }

  /**
   * 取公告正文并解析出时间表
   *
   * 正文取不到时返回空表 —— 那时每条活动退回列表里给的时间，日历照样出图（只是几条活动的
   * 起止会偏），比整条命令失败好。
   * @param game 游戏
   * @returns 时间表与星铁的跃迁图
   */
  async #times(game: CalendarGame): Promise<{ timeMap: Record<string, TimeFix>; gachaImgs: string[] }> {
    const timeMap: Record<string, TimeFix> = {}
    const gachaImgs: string[] = []

    let body: ContentBody | undefined
    try {
      body = await this.#http.get<ContentBody>(CONTENT_API[game], { timeout: TIMEOUT, retry: 1 })
    } catch (err) {
      this.#logger.warn(`[米游社][日历] 取公告正文失败，活动时间退回列表里的：${err instanceof Error ? err.message : String(err)}`)
    }

    const texts = body?.data?.list ?? []
    if (game === "gs") {
      const versions = gsVersionTimes(texts)
      for (const one of texts) {
        const got = gsEntryTime(one, versions)
        if (got && one.ann_id !== undefined) timeMap[String(one.ann_id)] = got
      }
    } else {
      const versions = srVersionTimes(texts)
      for (const one of [...texts, ...(body?.data?.pic_list ?? [])]) {
        const got = srEntryTime(one, versions)
        if (!got) continue
        if (got.gacha) gachaImgs.push(got.gacha)
        if (got.time && one.ann_id !== undefined) timeMap[String(one.ann_id)] = got.time
      }
    }

    await this.#applyFix(timeMap)
    return { timeMap, gachaImgs }
  }

  /**
   * 打上第三方的时间补丁
   *
   * 开关关着时一个包都不发。取不到只记一条 debug —— 补丁缺了日历照常出图。
   * @param timeMap 要打补丁的时间表，原地修改
   */
  async #applyFix(timeMap: Record<string, TimeFix>): Promise<void> {
    if (!this.#fix()) return
    try {
      const body = await this.#http.get<{ status?: number; data?: Record<string, TimeFix> }>(FIX_API, {
        timeout: TIMEOUT
      })
      if (body?.status !== 0 || !body.data) return
      for (const [id, one] of Object.entries(body.data)) timeMap[id] = one
    } catch (err) {
      this.#logger.debug(`[米游社][日历] 第三方时间补丁取不到：${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
