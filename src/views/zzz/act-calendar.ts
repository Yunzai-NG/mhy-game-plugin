/**
 * 模块职责：绝区零活动日历（`gacha_calendar` + `activity_calendar`）→ 调频与活动两块视图
 * 依赖方向：依赖 views/act-calendar-row 与 panel/profile/zzz 的职业名表，无 IO
 * 生命周期：无状态
 * 注意事项：`left_end_ts` / `left_start_ts` 是**剩余秒数**而非时间戳，按时间戳算会印出几万天。
 *          时长两位补零（`02天09时`），超过 24 小时才带天。活动的奖励恒为菲林，接口不给物品，
 *          故图写死；未开启的只印总数、不印进度。职业角标图不在包里时整枚不挂（见 `has`）。
 *          接口不给开始时刻，倒计时线只能按剩余换色、长度恒满（见 {@link barOf}）。
 *          调频格子的图先查元数据，查不到（正式服已开、元数据还没跟上）才用接口给的 https 地址。
 */
import { INDENT } from "../../core/text.js"
import { zzzProfName } from "../../panel/profile/zzz.js"
import { ZZZ_ELEM_CSS, ZZZ_ELEM_SLUG } from "../../panel/prop/zzz.js"
import type { ActBody, ActContext, ActFace, ActPool, ActRow } from "../act-calendar-row.js"
import { barOf, blankRow, faceOf, num } from "../act-calendar-row.js"

/** 调频里的一个代理人 */
interface ZzzGachaAvatar {
  /** 代理人 id */
  avatar_id?: number | string
  /** 名字 */
  avatar_name?: string
  /** `S` / `A`，个别接口给数字 */
  rarity?: string | number
  /** 属性编号 */
  avatar_element_type?: number
  /** 职业编号 */
  avatar_profession?: number
  /** 米游社的头像地址，元数据没有这位代理人时才用 */
  icon?: string
}

/** 调频里的一件音擎：**接口不给名字**（只有 id 与特效名），图与名全靠按 id 查元数据 */
interface ZzzGachaWeapon {
  /** 音擎 id */
  weapon_id?: number | string
  /** `S` / `A` */
  rarity?: string | number
  /** 职业编号 */
  profession?: number
  /** 米游社的图标地址，元数据没有这件音擎时才用 */
  icon?: string
}

/** 一个调频 */
interface ZzzGacha {
  /** 版本号 */
  version?: string
  /** `GACHA_STATE_IN_PROGRESS` / `GACHA_STATE_NOT_START` */
  gacha_state?: string
  /** 调频类型，重映一类有保底说明 */
  gacha_type?: string
  /** 距结束的秒数 */
  left_end_ts?: number | string
  /** 距开启的秒数 */
  left_start_ts?: number | string
  /** 重映保底是否未生效 */
  sup_lock_show?: boolean
  /** 代理人 */
  avatar_list?: ZzzGachaAvatar[]
  /** 音擎 */
  weapon_list?: ZzzGachaWeapon[]
}

/** `gacha_calendar` 返回的 data */
export interface ZzzGachaCalendarRaw {
  /** 代理人调频 */
  avatar_gacha_schedule_list?: ZzzGacha[]
  /** 音擎调频 */
  weapon_gacha_schedule_list?: ZzzGacha[]
}

/** 一条活动 */
interface ZzzActivity {
  /** 活动 id */
  activity_id?: number | string
  /** 名字 */
  name?: string
  /** `STATE_IN_PROGRESS` / `STATE_NOT_START` / `STATE_COMPLETED` / `STATE_END` */
  state?: string
  /** 距结束的秒数 */
  left_end_ts?: number | string
  /** 距开启的秒数 */
  left_start_ts?: number | string
  /** 可得菲林 */
  monochrome_cnt?: number
  /** 已得菲林 */
  monochrome_got_cnt?: number
}

/** `activity_calendar` 返回的 data */
export interface ZzzActivityCalendarRaw {
  /** 活动 */
  activity_list?: ZzzActivity[]
}

/** 两条接口合起来 */
export interface ZzzActCalendarRaw {
  /** 调频 */
  gacha?: ZzzGachaCalendarRaw
  /** 活动 */
  activity?: ZzzActivityCalendarRaw
}

/** 资源目录 */
const RES = "zzz/act-calendar/"

/** 稀有度字母 → 星级 */
const RANK_STAR: Readonly<Record<string, number>> = { S: 5, A: 4, B: 3 }

/** 重映一类调频 */
const RETURN_TYPES = new Set(["GACHA_TYPE_CHARACTER_RETURN", "GACHA_TYPE_WEAPON_RETURN"])

/**
 * 稀有度 → 字母
 * @param rarity 接口给的稀有度
 * @returns `S` / `A` / `B`
 */
function rankOf(rarity: unknown): string {
  if (typeof rarity === "string" && RANK_STAR[rarity.toUpperCase()]) return rarity.toUpperCase()
  const n = num(rarity)
  if (n >= 4) return "S"
  return n === 3 ? "A" : "B"
}

/**
 * 剩余秒数 → `02天09时` / `22小时` / `不足1小时`
 * @param sec 剩余秒数
 * @param toStart 是否距开启
 * @returns 文本；不大于 0 时空串
 */
function zzzLeft(sec: number, toStart: boolean): string {
  if (sec <= 0) return ""
  const two = (n: number): string => String(n).padStart(2, "0")
  const hours = Math.floor(sec / 3600)
  const day = Math.floor(hours / 24)
  const hour = hours % 24
  if (hours > 24) return toStart ? `${two(day)}天${two(hour)}小时后开启` : `${two(day)}天${two(hour)}时`
  if (hours >= 1) return toStart ? `${two(hours)}小时后开启` : `${two(hours)}小时`
  return toStart ? "不足1小时后开启" : "不足1小时"
}

/**
 * 一个代理人或音擎的格子
 * @param ctx 上下文
 * @param kind 代理人或音擎
 * @param id id
 * @param name 名字
 * @param rarity 稀有度
 * @param elem 属性编号，音擎没有
 * @param prof 职业编号
 * @param api 接口给的图，元数据查不到时才用
 * @returns 格子
 */
function zzzFace(
  ctx: ActContext,
  kind: "char" | "weapon",
  id: unknown,
  name: unknown,
  rarity: unknown,
  elem: unknown,
  prof: unknown,
  api: unknown
): ActFace {
  const rank = rankOf(rarity)
  const face = faceOf(ctx, kind, id, name, RANK_STAR[rank] ?? 5)
  if (!face.face && typeof api === "string" && api.startsWith("https://")) face.face = api
  const badges: ActFace["badges"] = []
  const icon = elem === undefined ? undefined : ZZZ_ELEM_SLUG[String(elem)]
  const css = elem === undefined ? undefined : ZZZ_ELEM_CSS[String(elem)]
  if (icon) badges.push({ icon: `meta-zzz/character/common/imgs/${icon}.webp`, at: "bl" })
  const profName = zzzProfName(prof === undefined ? undefined : num(prof))
  const profIcon = profName ? `${RES}职业-${profName}.png` : ""
  if (profIcon && ctx.has?.(profIcon)) badges.push({ icon: profIcon, at: "br" })
  return { ...face, star: RANK_STAR[rank] ?? face.star, elem: css ?? "", badges, rank }
}

/**
 * 一个调频 → 视图
 * @param g 调频
 * @param kind 代理人或音擎
 * @param ctx 上下文
 * @returns 视图
 */
function poolOf(g: ZzzGacha, kind: "char" | "weapon", ctx: ActContext): ActPool {
  const active = g.gacha_state === "GACHA_STATE_IN_PROGRESS"
  const discount = RETURN_TYPES.has(g.gacha_type ?? "")
  const label = kind === "char" ? (discount ? "独家重映" : "独家频段") : discount ? "音擎回响" : "音擎频段"
  const faces =
    kind === "char"
      ? (g.avatar_list ?? []).map(a =>
          zzzFace(ctx, "char", a.avatar_id, a.avatar_name, a.rarity, a.avatar_element_type, a.avatar_profession, a.icon)
        )
      : (g.weapon_list ?? []).map(w =>
          zzzFace(ctx, "weapon", w.weapon_id, "", w.rarity, undefined, w.profession, w.icon)
        )
  const lock = g.sup_lock_show === true ? "未生效" : "已生效"
  const note = `首次S信号必定为UP${kind === "char" ? "代理人" : "音擎"}${INDENT}${lock}`
  const bar = active ? barOf(num(g.left_end_ts), 0) : undefined
  return {
    ...(bar ? { bar } : {}),
    version: g.version ?? "",
    name: label,
    status: active ? "active" : "pending",
    time: active ? zzzLeft(num(g.left_end_ts), false) : zzzLeft(num(g.left_start_ts), true),
    timeIcon: active ? "clock" : "lock",
    hot: false,
    state: "",
    note: discount ? note : "",
    faces
  }
}

/**
 * 一条活动 → 视图
 * @param a 活动
 * @returns 视图
 */
function rowOf(a: ZzzActivity): ActRow {
  const state = a.state ?? ""
  const status = state === "STATE_IN_PROGRESS" ? "active" : state === "STATE_COMPLETED" ? "done" : "pending"
  const row = blankRow(a.name ?? "", status)
  row.dim = status === "done"
  row.check = status === "done"
  if (state === "STATE_IN_PROGRESS" || state === "STATE_COMPLETED") row.time = zzzLeft(num(a.left_end_ts), false)
  else if (state === "STATE_NOT_START") row.time = zzzLeft(num(a.left_start_ts), true)
  row.timeIcon = status === "pending" ? "lock" : "clock"
  const bar = status === "active" ? barOf(num(a.left_end_ts), 0) : undefined
  if (bar) row.bar = bar
  row.rewardIcon = `${RES}菲林.png`
  row.rewardName = "菲林"
  const total = num(a.monochrome_cnt)
  row.reward = status === "pending" ? String(total) : `${num(a.monochrome_got_cnt)}/${total}`
  return row
}

/**
 * 绝区零活动日历 → 主体
 * @param raw 两条接口合起来
 * @param ctx 上下文
 * @returns 主体
 */
export function zzzActCalendar(raw: ZzzActCalendarRaw, ctx: ActContext): ActBody {
  const acts = raw.activity?.activity_list ?? []
  return {
    poolTitle: "调频",
    groups: [
      { title: "代理人", pools: (raw.gacha?.avatar_gacha_schedule_list ?? []).map(g => poolOf(g, "char", ctx)) },
      { title: "音擎", pools: (raw.gacha?.weapon_gacha_schedule_list ?? []).map(g => poolOf(g, "weapon", ctx)) }
    ].filter(g => g.pools.length > 0),
    sections: [{ title: "活动", note: acts.length ? "" : "暂无数据", blocks: acts.length ? [{ rows: acts.map(rowOf) }] : [] }]
  }
}
