/**
 * 模块职责：绝区零迷宫诡域（搜打撤）两张图的视图模型 —— 概要与逐场战绩
 * 依赖方向：纯函数，依赖 views/zzz/common 与 core/text；不发请求、不读元数据
 * 生命周期：无状态
 * 注意事项：**排名两种口径由 `is_show_percent` 决定**（为真是放大百倍百分数、为假是名次本身印「TOP 3」，按一种处理会把「TOP 3」印成「0.03%」不报错）。**两个刷新时间单位都是秒但排版不同**（周刷新「NN天NN时」、赛季刷新「N天」）。**`leave_percent` 是撤离率、同样放大百倍**、整数不留小数。
 *          **战绩里时刻与用时都是对象**（与 `ZzzTimeRaw` 同形、复用 {@link zzzTime}/{@link zzzCostOf}），但用时**可能带小时**、不能只取分秒。难度是英文枚举（`Hell`/`Hard` 译「高危」「困难」、认不出原样印）。
 */
import { INDENT } from "../../core/text.js"
import type { ZzzTimeRaw } from "./common.js"
import { zzzCost, zzzRank, zzzRankTier, zzzTime } from "./common.js"

/** 出图与出文字共用的上下文 */
export interface ZzzZenkovContext {
  /** uid */
  uid: string
  /** 玩家昵称 */
  nickname?: string
}

/** 一张地图的战况 */
export interface ZzzZenkovMapRaw {
  /** 地图名 */
  name?: string
  /** 地图图标 */
  icon?: string
  /** 进入次数 */
  enter_num?: number
  /** 撤离次数 */
  leave_num?: number
  /** 撤离率，放大一百倍 */
  leave_percent?: number
}

/** 带出的一件物资 */
export interface ZzzZenkovItemRaw {
  /** 物资名 */
  name?: string
  /** 图标 */
  icon?: string
  /** 稀有度，5 最高 */
  rarity?: number
  /** 件数 */
  num?: number
}

/** 一场战绩 */
export interface ZzzZenkovRecordRaw {
  /** 地图名 */
  map_name?: string
  /** 难度，`Hell` / `Hard` 一类英文枚举 */
  difficult?: string
  /** 开始时刻 */
  start_time?: ZzzTimeRaw
  /** 本场用时，**可能带小时** */
  challenge_time?: ZzzTimeRaw
  /** 是否成功撤离 */
  is_leave?: boolean
  /** 带出物资总价值 */
  material_total_value?: number | string
  /** 带出的物资 */
  item_list?: ZzzZenkovItemRaw[]
}

/** 赛季段 */
export interface ZzzZenkovSeasonRaw {
  /** 赛季名 */
  name?: string
  /** 赛季等级 */
  level?: number
  /** 赛季距刷新的秒数 */
  refresh_time?: number
}

/** `zenkov_abstract_info` 与 `zenkov_detail` 共用的形态 */
export interface ZzzZenkovRaw {
  /** 距周刷新的秒数 */
  refresh_time?: number
  /** 赛季 */
  season_data?: ZzzZenkovSeasonRaw
  /** 最好排名；口径由 `is_show_percent` 决定 */
  max_rank?: number
  /** 为真时 `max_rank` 是百分数，为假时是名次 */
  is_show_percent?: boolean
  /** 累计进入次数 */
  total_enter_num?: number
  /** 累计撤离次数 */
  total_leave_num?: number
  /** 累计带出价值 */
  total_material_value?: number | string
  /** 逐地图战况 */
  map_list?: ZzzZenkovMapRaw[]
  /** 逐场战绩，只有 `zenkov_detail` 给 */
  record_list?: ZzzZenkovRecordRaw[]
}

/** 难度的中文名 */
const DIFFICULTY: Readonly<Record<string, string>> = {
  Hell: "高危",
  Hard: "困难",
  Normal: "普通"
}

/**
 * 判这份返回能不能出图
 * @param raw 接口返回
 * @returns 有任一地图记录或任一场战绩即可出图
 */
export function zzzZenkovState(raw: ZzzZenkovRaw | undefined): "ok" | "empty" {
  if (!raw) return "empty"
  const maps = (raw.map_list ?? []).some(it => (it.enter_num ?? 0) > 0)
  const records = (raw.record_list ?? []).length > 0
  return maps || records || (raw.total_enter_num ?? 0) > 0 ? "ok" : "empty"
}

/**
 * 秒数排成「NN天NN时」
 *
 * 周刷新那一栏用它。**天与时都补两位**。
 * @param seconds 秒
 * @returns `02天07时`；不是正数时 `00天00时`
 */
export function zenkovDaysHours(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "00天00时"
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  return `${String(days).padStart(2, "0")}天${String(hours).padStart(2, "0")}时`
}

/**
 * 秒数排成「N天」
 *
 * 赛季刷新那一栏用它 —— 赛季按月计，印到小时没有意义。
 * @param seconds 秒
 * @returns `23天`；不是正数时 `0天`
 */
export function zenkovDays(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "0天"
  return `${Math.floor(seconds / 86400)}天`
}

/**
 * 撤离率排版
 *
 * 与 {@link zzzRank} 的差别在于**整数不留小数位**：撤离率常是 `100%`，印成 `100.00%` 会把那一格挤开。
 * @param percent 放大一百倍的撤离率
 * @returns `62.50%` 或 `100%`；没有这一项时 `0%`
 */
export function zenkovPercent(percent: number | undefined): string {
  if (percent === undefined || percent === null) return "0%"
  const pct = Number(percent) / 100
  if (Number.isNaN(pct)) return "0%"
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 2)}%`
}

/**
 * 最好排名排版
 *
 * **两种口径**：`is_show_percent` 为真时 `max_rank` 是放大一百倍的百分数，为假时它就是名次本身。取错不报错，只是那一格数字毫无意义。
 * @param raw 接口返回
 * @returns 排名文本与档位；没有排名时文本为 `-`、档位取最后一档
 */
export function zenkovRank(raw: ZzzZenkovRaw | undefined): { text: string; tier: number } {
  const value = raw?.max_rank
  if (value === undefined || value === null || Number.isNaN(Number(value))) return { text: "-", tier: 5 }
  if (raw?.is_show_percent) return { text: zzzRank(Number(value)) || "-", tier: zzzRankTier(Number(value)) }
  // 名次口径下没有百分比可分档，一律给最靠前那一档 —— 能进榜本身就说明靠前
  return { text: `TOP ${Math.floor(Number(value))}`, tier: 1 }
}

/**
 * 用时排版
 *
 * 与 `zzzCostOf` 的差别是**这一族的用时可能带小时**，故要把小时一并折进秒数。
 * @param time 接口给的用时对象
 * @returns `1:02:33` 或 `02:33`；一秒都没有时空串
 */
function zenkovCost(time: ZzzTimeRaw | undefined): string {
  const seconds = (time?.hour ?? 0) * 3600 + (time?.minute ?? 0) * 60 + (time?.second ?? 0)
  return zzzCost(seconds)
}

/**
 * 千分位排版
 * @param value 接口给的数值，可能是字符串
 * @returns `1,234,567`；认不出时原样返回
 */
function commas(value: number | string | undefined): string {
  if (value === undefined || value === null || value === "") return "0"
  const num = Number(value)
  if (Number.isNaN(num)) return String(value)
  return num.toLocaleString("en-US")
}

/**
 * 逐地图那一段的出图形态
 * @param list 接口给的地图列表
 * @returns 出图形态
 */
function zenkovMaps(list: readonly ZzzZenkovMapRaw[] | undefined): Record<string, unknown>[] {
  return (list ?? []).map(one => ({
    name: one.name ?? "",
    icon: one.icon ?? "",
    enter: one.enter_num ?? 0,
    leave: one.leave_num ?? 0,
    percent: zenkovPercent(one.leave_percent)
  }))
}

/**
 * `%迷宫诡域` 概要的出图数据
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzZenkovData(raw: ZzzZenkovRaw | undefined, ctx: ZzzZenkovContext): Record<string, unknown> {
  const rank = zenkovRank(raw)
  const season = raw?.season_data
  return {
    game: "zzz",
    title: "迷宫诡域",
    uid: ctx.uid,
    nickname: ctx.nickname ?? "",
    weekRefresh: zenkovDaysHours(raw?.refresh_time),
    season: {
      name: season?.name ?? "",
      level: season?.level ?? 0,
      refresh: zenkovDays(season?.refresh_time)
    },
    rank: rank.text,
    rankTier: rank.tier,
    enter: raw?.total_enter_num ?? 0,
    leave: raw?.total_leave_num ?? 0,
    value: commas(raw?.total_material_value),
    maps: zenkovMaps(raw?.map_list)
  }
}

/**
 * `%迷宫诡域战绩` 的出图数据
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzZenkovDetailData(raw: ZzzZenkovRaw | undefined, ctx: ZzzZenkovContext): Record<string, unknown> {
  const base = zzzZenkovData(raw, ctx)
  return {
    ...base,
    title: "迷宫诡域战绩",
    records: (raw?.record_list ?? []).map(one => ({
      map: one.map_name ?? "",
      // 认不出的难度原样印：编一个中文名比留着原文更糟
      difficulty: DIFFICULTY[one.difficult ?? ""] ?? one.difficult ?? "普通",
      begin: zzzTime(one.start_time),
      cost: zenkovCost(one.challenge_time),
      leave: one.is_leave === true,
      value: commas(one.material_total_value),
      items: (one.item_list ?? []).map(it => ({
        name: it.name ?? "",
        icon: it.icon ?? "",
        // 稀有度只有 3/4/5 有底色，其余不画底
        rarity: [3, 4, 5].includes(it.rarity ?? 0) ? String(it.rarity) : "",
        num: it.num ?? 0
      }))
    }))
  }
}

/**
 * 迷宫诡域的文字形态，出图失败时用
 * @param raw 接口返回
 * @param ctx 上下文
 * @param detail 是否带逐场战绩
 * @returns 多行文本
 */
export function zzzZenkovText(raw: ZzzZenkovRaw | undefined, ctx: ZzzZenkovContext, detail = false): string {
  const view = detail ? zzzZenkovDetailData(raw, ctx) : zzzZenkovData(raw, ctx)
  const season = view["season"] as { name: string; level: number; refresh: string }
  const lines = [`UID${ctx.uid} ${String(view["title"])}`]
  if (season.name) lines.push(`${INDENT}${season.name}${season.level ? ` Lv.${season.level}` : ""}（${season.refresh}后刷新）`)
  lines.push(`${INDENT}进入 ${String(view["enter"])} 次 · 撤离 ${String(view["leave"])} 次 · 带出 ${String(view["value"])}`)
  if (view["rank"] !== "-") lines.push(`${INDENT}最好排名 ${String(view["rank"])}`)

  const maps = view["maps"] as { name: string; enter: number; percent: string }[]
  for (const one of maps) {
    if (one.enter <= 0) continue
    lines.push(`${INDENT}${one.name} 进入 ${one.enter} 次，撤离率 ${one.percent}`)
  }

  if (detail) {
    const records = view["records"] as { map: string; difficulty: string; cost: string; leave: boolean; value: string }[]
    if (records.length === 0) lines.push(`${INDENT}还没有逐场战绩`)
    for (const one of records) {
      const bits = [one.difficulty]
      if (one.cost) bits.push(one.cost)
      bits.push(one.leave ? "撤离成功" : "未撤离")
      bits.push(one.value)
      lines.push(`${INDENT}${one.map} ${bits.join(" · ")}`)
    }
  }
  return lines.join("\n")
}
