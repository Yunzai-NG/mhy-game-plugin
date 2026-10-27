/**
 * 模块职责：绝区零三类进度与收支的视图模型 —— 零号空洞（枯萎苗圃 / 迷失之地）、区域收集、菲林月报
 * 依赖方向：纯函数，依赖 views/zzz/common 与 core/text；不发请求、不读元数据
 * 生命周期：无状态
 * 注意事项：**零号空洞收集项没有名字**（`abyss_collect` 只给数量），名称由**位置**决定（见 {@link GARDEN_COLLECT}/{@link LOST_COLLECT}），多给一项按「其他 N」列、少给那格不出（位置一错整排移位、不报错）。**枯萎苗圃通关阵容在另一条接口**（`abyss_detail?type=3`，角色多 `damage_rate`、邦布在 `buddy_list` 数组）。
 *          **菲林月报只有收入没有支出**（与札记不同形，`month_data.list` 三种货币进项、`action` 代码中文名在 {@link LEDGER_ACTIONS}）。零号空洞几处耗时是秒数、按 {@link zzzCost} 排。
 */
import { INDENT } from "../../core/text.js"
import type { ZzzAvatarCardView } from "./card.js"
import type { ZzzAvatarRaw, ZzzAvatarView, ZzzBuddyRaw, ZzzIconOf } from "./common.js"
import { zzzAvatars, zzzBuddy, zzzCost, zzzTeamText } from "./common.js"

/** 出图与出文字共用的上下文 */
export interface ZzzCollectContext {
  /** uid */
  uid: string
  /** 玩家昵称 */
  nickname?: string
  /** 由代理人 id 取名称，通常查元数据 */
  nameOf?: (id: string) => string
  /** 由代理人 id 取元数据里那张方图；不给即一律用接口地址 */
  iconOf?: ZzzIconOf
  /** 代理人 id → 整卡（命令层从绝区零面板库造好）；给了「刀耕火焚」那队就出整张代理人卡 */
  cards?: Readonly<Record<string, ZzzAvatarCardView>>
}

/** 一项收集进度 */
export interface ZzzCollectRaw {
  /** 已收集 */
  cur_collect?: number
  /** 总数 */
  max_collect?: number
}

/** 执照等级 */
export interface ZzzAbyssLevelRaw {
  /** 当前等级 */
  cur_level?: number
  /** 上限 */
  max_level?: number
  /** 图标，米游社的绝对地址 */
  icon?: string
}
/** `abyss_abstract`（枯萎苗圃）的返回 */
export interface ZzzGardenRaw {
  /** 执照等级 */
  abyss_level?: ZzzAbyssLevelRaw
  /** 作战机略 */
  abyss_talent?: {
    /** 已解锁 */
    cur_talent?: number
    /** 总数 */
    max_talent?: number
  }
  /** 收集进度，**名称由位置决定** */
  abyss_collect?: ZzzCollectRaw[]
  /** 刀耕火焚的最高战绩概要 */
  abyss_throne?: {
    /** 最高伤害 */
    max_damage?: number
  }
}

/** `abyss_detail`（枯萎苗圃的挑战明细）的返回 */
export interface ZzzGardenDetailRaw {
  /** 刀耕火焚的最好那一次 */
  abyss_throne_max?: {
    /** 探索耗时，秒 */
    time?: number
    /** 对首领造成的伤害 */
    max_damage?: number
    /** 通关阵容，这一份的角色多一栏伤害占比 */
    avatar_list?: (ZzzAvatarRaw & {
      /** 伤害占比，百分数 */
      damage_rate?: number
    })[]
    /** 邦布，**是数组** */
    buddy_list?: ZzzBuddyRaw[]
  }
}

/** 枯萎苗圃的收集项名称，照官方页面按位置写死 */
const GARDEN_COLLECT: readonly string[] = ["鸣徽图鉴", "特殊区域记录", "哨站课题", "异域模块", "战术棱镜方案"]

/** 迷失之地的收集项名称，同样按位置 */
const LOST_COLLECT: readonly string[] = [
  "探究勋证",
  "武备图鉴",
  "战术档案",
  "异域模块",
  "战术棱镜方案",
  "零号碎片",
  "空洞异闻"
]

/**
 * 摊平收集进度
 *
 * 接口只给数字、不给名字，故名称按位置取。**多给的那些不丢**，按「其他 N」列出 —— 玩法更新时那一项才是新增的，丢掉会让人以为漏了数据。
 * @param list 接口给的收集进度
 * @param names 按位置对应的名称
 * @returns 出图形态
 */
function collectRows(
  list: readonly ZzzCollectRaw[] | undefined,
  names: readonly string[]
): { name: string; cur: number; max: number; full: boolean }[] {
  return (list ?? []).map((one, idx) => {
    const cur = one.cur_collect ?? 0
    const max = one.max_collect ?? 0
    return { name: names[idx] ?? `其他 ${idx + 1}`, cur, max, full: max > 0 && cur >= max }
  })
}
/**
 * 判这份枯萎苗圃返回能不能出图
 * @param raw 接口返回
 * @returns 有执照等级或收集进度即可出图
 */
export function zzzGardenState(raw: ZzzGardenRaw | undefined): "ok" | "empty" {
  if (!raw) return "empty"
  return (raw.abyss_level?.max_level ?? 0) > 0 || (raw.abyss_collect ?? []).length > 0 ? "ok" : "empty"
}

/**
 * 零号空洞·枯萎苗圃的出图数据
 * @param raw 概要接口返回
 * @param detail 挑战明细接口返回，没打过时不给
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzGardenData(
  raw: ZzzGardenRaw | undefined,
  detail: ZzzGardenDetailRaw | undefined,
  ctx: ZzzCollectContext
): Record<string, unknown> {
  const throne = detail?.abyss_throne_max
  const buddy = zzzBuddy(throne?.buddy_list?.[0], ctx.iconOf)
  // 伤害占比只有这一条接口给，故不走 zzzAvatars 的通用形态，另摊一份
  const avatars = zzzAvatars(throne?.avatar_list, ctx.nameOf, ctx.iconOf, ctx.cards).map((one, idx) => ({
    ...one,
    rate: throne?.avatar_list?.[idx]?.damage_rate ?? 0
  }))

  return {
    game: "zzz",
    title: "零号空洞·枯萎苗圃",
    uid: ctx.uid,
    nickname: ctx.nickname ?? "",
    level: {
      cur: raw?.abyss_level?.cur_level ?? 0,
      max: raw?.abyss_level?.max_level ?? 0,
      icon: raw?.abyss_level?.icon ?? ""
    },
    talent: { cur: raw?.abyss_talent?.cur_talent ?? 0, max: raw?.abyss_talent?.max_talent ?? 0 },
    collects: collectRows(raw?.abyss_collect, GARDEN_COLLECT),
    damage: raw?.abyss_throne?.max_damage ?? 0,
    // 「刀耕火焚」没打过时整块不画：那一段的每一项都来自另一条接口
    ...(throne
      ? {
          throne: {
            cost: zzzCost(throne.time),
            damage: throne.max_damage ?? 0,
            avatars,
            ...(buddy ? { buddy } : {})
          }
        }
      : {})
  }
}
/** 一档挑战的最高战绩 */
export interface ZzzLostMaxRaw {
  /** 难度名 */
  max_name?: string
  /** 以太活性 */
  heat_count?: number
  /** 通关次数 */
  max_count?: number
  /** 最短耗时，秒 */
  best_time?: number
}

/** `abysss2_abstract`（迷失之地）的返回 */
export interface ZzzLostRaw {
  /** 执照等级 */
  abyss_level?: ZzzAbyssLevelRaw
  /** 悬赏委托进度 */
  abyss_duty?: {
    /** 已完成 */
    cur_duty?: number
    /** 总数 */
    max_duty?: number
  }
  /** 探索任务 */
  abyss_task?: {
    /** 已完成 */
    cur_task?: number
    /** 总数 */
    max_task?: number
  }
  /** 收集进度，**名称由位置决定** */
  abyss_collect?: ZzzCollectRaw[]
  /** 矩阵行动 */
  abyss_max?: ZzzLostMaxRaw
  /** 特遣调查 */
  abyss_task_force_investigation_max?: ZzzLostMaxRaw
  /** 特别任务 */
  special_mission?: ZzzLostMaxRaw
}

/**
 * 判这份迷失之地返回能不能出图
 * @param raw 接口返回
 * @returns 判定结果
 */
export function zzzLostState(raw: ZzzLostRaw | undefined): "ok" | "empty" {
  if (!raw) return "empty"
  return (raw.abyss_level?.max_level ?? 0) > 0 || (raw.abyss_collect ?? []).length > 0 ? "ok" : "empty"
}

/**
 * 一档挑战的出图形态
 * @param raw 接口给的那一档
 * @param name 这一档叫什么
 * @returns 出图形态；接口没给这一档时 undefined
 */
function lostMax(raw: ZzzLostMaxRaw | undefined, name: string): Record<string, unknown> | undefined {
  if (!raw || (!raw.max_name && !raw.max_count)) return undefined
  return {
    name,
    difficulty: raw.max_name ?? "",
    heat: raw.heat_count ?? 0,
    count: raw.max_count ?? 0,
    cost: zzzCost(raw.best_time)
  }
}
/**
 * 零号空洞·迷失之地的出图数据
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzLostData(raw: ZzzLostRaw | undefined, ctx: ZzzCollectContext): Record<string, unknown> {
  // 三档挑战形态相同，接口没给的那一档不出现 —— 印一排「0 次」看着像刚清过档
  const modes = [
    lostMax(raw?.abyss_max, "矩阵行动"),
    lostMax(raw?.abyss_task_force_investigation_max, "特遣调查"),
    lostMax(raw?.special_mission, "特别任务")
  ].filter(it => it !== undefined)

  return {
    game: "zzz",
    title: "零号空洞·迷失之地",
    uid: ctx.uid,
    nickname: ctx.nickname ?? "",
    level: {
      cur: raw?.abyss_level?.cur_level ?? 0,
      max: raw?.abyss_level?.max_level ?? 0,
      icon: raw?.abyss_level?.icon ?? ""
    },
    duty: { cur: raw?.abyss_duty?.cur_duty ?? 0, max: raw?.abyss_duty?.max_duty ?? 0 },
    task: { cur: raw?.abyss_task?.cur_task ?? 0, max: raw?.abyss_task?.max_task ?? 0 },
    collects: collectRows(raw?.abyss_collect, LOST_COLLECT),
    modes
  }
}

/**
 * 零号空洞两张图的文字形态，出图失败时用
 * @param view 出图数据
 * @returns 多行文本
 */
export function zzzHollowText(view: Record<string, unknown>): string {
  const level = view["level"] as { cur: number; max: number }
  const collects = view["collects"] as { name: string; cur: number; max: number }[]
  const throne = view["throne"] as { cost: string; damage: number; avatars: ZzzAvatarView[] } | undefined
  const modes = (view["modes"] ?? []) as { name: string; difficulty: string; count: number; cost: string }[]
  const lines = [`UID${String(view["uid"])} ${String(view["title"])} 执照 ${level.cur}/${level.max} 级`]
  for (const one of collects) lines.push(`${INDENT}${one.name} ${one.cur}/${one.max}`)
  for (const one of modes) {
    lines.push(`${INDENT}${one.name} ${one.difficulty}${one.count ? ` × ${one.count}` : ""}${one.cost ? ` 最短 ${one.cost}` : ""}`)
  }
  if (throne) {
    lines.push(`${INDENT}刀耕火焚 伤害 ${throne.damage}${throne.cost ? ` 耗时 ${throne.cost}` : ""}`)
    lines.push(`${INDENT}${INDENT}${zzzTeamText(throne.avatars)}`)
  }
  return lines.join("\n")
}
/** 区域收集里的一项 */
export interface ZzzExploreItemRaw {
  /** 名称 */
  name?: string
  /** 图标 */
  icon?: string
  /** 已收集 */
  num?: number
  /** 总数 */
  total?: number
}

/** 区域收集里的一个子区域 */
export interface ZzzExploreMapRaw {
  /** 名称 */
  name?: string
  /** 图标 */
  icon?: string
  /** 完成度，百分数 */
  collection_progress?: number
  /** 逐项 */
  collections?: ZzzExploreItemRaw[]
}

/** `exploration_detail` 接口的返回 */
export interface ZzzExploreRaw {
  /** 逐个区域 */
  area_collections?: {
    /** 区域名 */
    name?: string
    /** 完成度，百分数 */
    collection_progress?: number
    /** 逐个子区域 */
    map_collections?: ZzzExploreMapRaw[]
  }[]
}

/**
 * 判这份区域收集返回能不能出图
 * @param raw 接口返回
 * @returns 判定结果
 */
export function zzzExploreState(raw: ZzzExploreRaw | undefined): "ok" | "empty" {
  return (raw?.area_collections ?? []).length > 0 ? "ok" : "empty"
}

/**
 * 区域收集的出图数据
 *
 * 图标一律是米游社的绝对地址，模板不可加资源根。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzExploreData(raw: ZzzExploreRaw | undefined, ctx: ZzzCollectContext): Record<string, unknown> {
  const areas = (raw?.area_collections ?? []).map(area => {
    const maps = (area.map_collections ?? []).map(one => ({
      name: one.name ?? "",
      icon: one.icon ?? "",
      progress: one.collection_progress ?? 0,
      items: (one.collections ?? []).map(it => {
        const num = it.num ?? 0
        const total = it.total ?? 0
        return { name: it.name ?? "", icon: it.icon ?? "", num, total, full: total > 0 && num >= total }
      })
    }))
    const progress = area.collection_progress ?? 0
    // 有的大区（如莱姆尼安空洞）接口给 0 而子区自有进度，照印就是「大区 0%、子区 30%」。
    // 此时不印大区百分比：接口的汇总口径不是子区平均（雅努斯区子区 91/83/100/100 而大区 77），自己算的数对不上
    return { name: area.name ?? "", progress, hasProgress: progress > 0 || !maps.some(one => one.progress > 0), maps }
  })

  return {
    game: "zzz",
    title: "区域收集",
    uid: ctx.uid,
    nickname: ctx.nickname ?? "",
    areas
  }
}
/**
 * 区域收集的文字形态，出图失败时用
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function zzzExploreText(raw: ZzzExploreRaw | undefined, ctx: ZzzCollectContext): string {
  const view = zzzExploreData(raw, ctx)
  const areas = view["areas"] as {
    name: string
    progress: number
    hasProgress: boolean
    maps: { name: string; progress: number }[]
  }[]
  const lines = [`UID${ctx.uid} 区域收集`]
  if (areas.length === 0) return `${lines[0]}\n${INDENT}米游社没有返回区域列表`
  for (const area of areas) {
    lines.push(`${INDENT}${area.name}${area.hasProgress ? ` ${area.progress}%` : ""}`)
    for (const one of area.maps) lines.push(`${INDENT}${INDENT}${one.name} ${one.progress}%`)
  }
  return lines.join("\n")
}

/** 菲林月报只留最近这么多个月 —— 接口的 `optional_month` 恒是三项 */
const LEDGER_MONTHS = 3

/** 一次月份解析的结果 */
export interface ZzzMonthPick {
  /** 认不认这个写法 */
  ok: boolean
  /** 传给接口的月份，形如 `202601`；查当月时为空串（接口据此给当月） */
  param?: string
  /** 可读的月份 */
  label?: string
  /** 不认时说明为什么 */
  message?: string
}

/**
 * 认出要查哪个月
 *
 * 认「上月」「上个月」「N 月」「YYYY 年 N 月」四种写法，都不带即查当月。**超出最近三个月即直接回一句话**：接口只留三个月，硬发一次请求换回一份空数据，与「这个月没有收入」无从区分。
 * @param rest 命令后面跟的那一串
 * @param now 当前时刻，测试可注入
 * @returns 解析结果
 */
export function zzzLedgerMonth(rest: string, now: Date): ZzzMonthPick {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  if (/上个?月/.test(rest)) {
    const at = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
    return { ok: true, param: `${at.y}${String(at.m).padStart(2, "0")}`, label: `${at.y} 年 ${at.m} 月` }
  }

  const hit = /(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月/.exec(rest)
  if (!hit) return { ok: true, param: "", label: `${year} 年 ${month} 月` }
  const want = Number(hit[2])
  if (!(want >= 1 && want <= 12)) return { ok: false, message: "月份只能是 1 到 12" }
  // 没写年份时按"不晚于当月"推：一月里问「12月」问的是去年那个
  const wantYear = hit[1] ? Number(hit[1]) : want > month ? year - 1 : year
  const back = (year - wantYear) * 12 + (month - want)
  if (back < 0) return { ok: false, message: "那个月还没到" }
  if (back >= LEDGER_MONTHS) return { ok: false, message: `米游社的菲林月报只留最近 ${LEDGER_MONTHS} 个月` }
  return { ok: true, param: `${wantYear}${String(want).padStart(2, "0")}`, label: `${wantYear} 年 ${want} 月` }
}
/** 一抽要的菲林 */
const PULL_COST = 160

/** 菲林来源的配色，按来源次序取 */
const LEDGER_COLORS = ["#d6f01f", "#ff8a3d", "#45c3f5", "#b07cff", "#ff5d7a", "#5fe0a8", "#9aa0a6"] as const

/** 收入来源的代码 → 中文名，逐项列全 */
const LEDGER_ACTIONS: Readonly<Record<string, string>> = {
  daily_activity_rewards: "日常活跃奖励",
  growth_rewards: "成长奖励",
  event_rewards: "活动奖励",
  hollow_rewards: "零号空洞奖励",
  shiyu_rewards: "式舆防卫战奖励",
  mail_rewards: "邮件奖励",
  other_rewards: "其他奖励"
}

/** `nap_ledger/month_info` 接口的返回 */
export interface ZzzLedgerRaw {
  /** 当前月份，形如 `202601` */
  current_month?: string
  /** 这一份数据的月份 */
  data_month?: string
  /** 还查得到的月份 */
  optional_month?: string[]
  /** 本月数据 */
  month_data?: {
    /** 三种货币的当月进项 */
    list?: {
      /** 类型代码 */
      data_type?: string
      /** 数量 */
      count?: number
      /** 名称，**接口自带中文** */
      data_name?: string
    }[]
    /** 来源占比 */
    income_components?: {
      /** 来源代码 */
      action?: string
      /** 数量 */
      num?: number
      /** 占比，百分数 */
      percent?: number
    }[]
  }
  /** 玩家信息，这一条接口自带 */
  role_info?: {
    /** 昵称 */
    nickname?: string
    /** 头像，米游社的绝对地址 */
    avatar?: string
  }
}
/**
 * 判这份菲林月报能不能出图
 * @param raw 接口返回
 * @returns 判定结果
 */
export function zzzLedgerState(raw: ZzzLedgerRaw | undefined): "ok" | "empty" {
  return (raw?.month_data?.list ?? []).length > 0 ? "ok" : "empty"
}

/**
 * 把 `202601` 排成「2026 年 1 月」
 * @param month 接口给的月份
 * @returns 可读的月份；形态不对时原样返回
 */
export function zzzMonth(month: string | undefined): string {
  if (!month || !/^\d{6}$/.test(month)) return month ?? ""
  return `${month.slice(0, 4)} 年 ${Number(month.slice(4))} 月`
}

/**
 * 菲林月报的出图数据
 *
 * **只有收入没有支出**，与另两个游戏的札记不同形，故不与 views/ledger 合流。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzLedgerData(raw: ZzzLedgerRaw | undefined, ctx: ZzzCollectContext): Record<string, unknown> {
  const list = (raw?.month_data?.list ?? []).map(one => ({
    // 名称接口自带中文，取不到时才退回代码 —— 编一个比留着代码更糟
    name: one.data_name ?? one.data_type ?? "",
    type: one.data_type ?? "",
    count: one.count ?? 0
  }))
  const sources = (raw?.month_data?.income_components ?? []).map((one, idx) => ({
    name: LEDGER_ACTIONS[one.action ?? ""] ?? "其他奖励",
    num: one.num ?? 0,
    percent: one.percent ?? 0,
    color: LEDGER_COLORS[idx % LEDGER_COLORS.length] ?? LEDGER_COLORS[0]
  }))
  // 环图用 conic-gradient 画：按数量累计角度，占比只作图例上的字，二者取整口径不同时环也不会缺口
  const total = sources.reduce((sum, one) => sum + one.num, 0)
  let at = 0
  const ring = sources
    .map(one => {
      const from = at
      at += total > 0 ? (one.num / total) * 100 : 0
      return `${one.color} ${from.toFixed(2)}% ${at.toFixed(2)}%`
    })
    .join(", ")
  // 菲林在 list 里不一定排第一，按类型认
  const lead = list.find(one => one.type === "PolychromesData") ?? list[0]

  return {
    // 与原神星铁的札记同宽（见 base.css 的 `.pic-narrow`）
    bodyClass: "pic-narrow",
    lead,
    others: list.filter(one => one !== lead),
    pulls: lead ? Math.floor(lead.count / PULL_COST) : 0,
    ring: ring || "var(--p-line) 0 100%",
    total,
    game: "zzz",
    title: "菲林月报",
    uid: ctx.uid,
    nickname: raw?.role_info?.nickname ?? ctx.nickname ?? "",
    avatar: raw?.role_info?.avatar ?? "",
    month: zzzMonth(raw?.data_month),
    // 只在查的不是当月时提一句，避免每次都印一句废话
    isCurrent: !raw?.data_month || raw.data_month === raw.current_month,
    months: (raw?.optional_month ?? []).map(it => zzzMonth(it)),
    list,
    sources
  }
}

/**
 * 菲林月报的文字形态，出图失败时用
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function zzzLedgerText(raw: ZzzLedgerRaw | undefined, ctx: ZzzCollectContext): string {
  const view = zzzLedgerData(raw, ctx)
  const list = view["list"] as { name: string; count: number }[]
  const sources = view["sources"] as { name: string; num: number; percent: number }[]
  const lines = [`UID${ctx.uid} ${String(view["month"])}菲林月报`]
  if (list.length === 0) return `${lines[0]}\n${INDENT}米游社没有返回这个月的数据`
  for (const one of list) lines.push(`${INDENT}${one.name} ${one.count}`)
  for (const one of sources) lines.push(`${INDENT}${one.name} ${one.num}（${one.percent}%）`)
  return lines.join("\n")
}
