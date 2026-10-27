/**
 * 模块职责：星铁活动日历（`get_act_calender`）→ 跃迁、活动、逐光捡金三块视图
 * 依赖方向：依赖 views/act-calendar-row，无 IO
 * 生命周期：无状态
 * 注意事项：时间以接口 `time_info.now` 为「现在」，不用本地时钟 —— 开启前后的判定与它同源。
 *          卡池「开没开」不只看时间：`is_after_version` 的卡池在**当前版本**内即算已开（版本更新
 *          那一刻才有准确开启时刻），判错则当期卡池整张印成「…后开启」。时长按小时向上取整，
 *          所以「不足一小时」印成「1小时」而非「0」。
 */
import type { ActBody, ActContext, ActFace, ActPool, ActRow, ActSection } from "../act-calendar-row.js"
import type { ActBar, RawReward } from "../act-calendar-row.js"
import { barOf, blankRow, faceOf, itemsOf, num } from "../act-calendar-row.js"

/** 时间三元组，秒或毫秒级时间戳（字符串亦可） */
interface SrTimeInfo {
  /** 现在 */
  now?: number | string
  /** 开始 */
  start_ts?: number | string
  /** 结束 */
  end_ts?: number | string
}

/** 卡池里的一项（角色或光锥） */
interface SrPoolItem {
  /** 物品 id */
  item_id?: number | string
  /** 名字 */
  item_name?: string
  /** 稀有度 */
  rarity?: number | string
  /** 角色的属性，形如 `fire` */
  damage_type?: string
}

/** 一个卡池 */
interface SrPool {
  /** 卡池 id */
  id?: number | string
  /** 卡池名 */
  name?: string
  /** 版本号 */
  version?: string
  /** 时间 */
  time_info?: SrTimeInfo
  /** 是否在版本更新后才开 */
  is_after_version?: boolean
  /** `GachaTimeTypeLong` 为常驻开放 */
  gacha_time_type?: string
  /** 角色 */
  avatar_list?: SrPoolItem[]
  /** 光锥 */
  equip_list?: SrPoolItem[]
}

/** 奖励里的一件 */
type SrReward = RawReward

/** 一条活动 */
interface SrAct {
  /** 活动 id */
  id?: number | string
  /** 名字 */
  name?: string
  /** 活动类型 */
  act_type?: string
  /** 活动状态 */
  act_status?: string
  /** `ActTimeTypeLong` 不印时间 */
  act_time_type?: string
  /** 时间 */
  time_info?: SrTimeInfo
  /** 当前进度 */
  current_progress?: number
  /** 总进度 */
  total_progress?: number
  /** 双倍类：0 为整期共用次数（不按日刷新） */
  count_refresh_type?: number
  /** 列表上展示的那件奖励 */
  special_reward?: SrReward
  /** 全部奖励，行下那一排 */
  reward_list?: SrReward[]
}

/** 一条逐光捡金 */
interface SrChallenge {
  /** 期 id */
  group_id?: number | string
  /** `ChallengeTypeChasm` / `Story` / `Boss` / `Peak` */
  challenge_type?: string
  /** 期名 */
  name_mi18n?: string
  /** `challengeStatusUnopened` / `InProgress` / `Finish` */
  status?: string
  /** 时间 */
  time_info?: SrTimeInfo
  /** 当前星数 */
  current_progress?: number
  /** 总星数 */
  total_progress?: number
  /** 满星之外的额外星，大于 0 即挂一枚标记 */
  extra_progress?: number | string
  /** 列表上展示的那件奖励 */
  special_reward?: SrReward
  /** 全部奖励，行下那一排 */
  reward_list?: SrReward[]
}

/** `get_act_calender` 返回的 data */
export interface SrActCalendarRaw {
  /** 当前版本号 */
  cur_game_version?: string
  /** 角色卡池 */
  avatar_card_pool_list?: SrPool[]
  /** 光锥卡池 */
  equip_card_pool_list?: SrPool[]
  /** 活动 */
  act_list?: SrAct[]
  /** 逐光捡金 */
  challenge_list?: SrChallenge[]
}

/** 资源目录 */
const RES = "sr/act-calendar/"

/** 逐光捡金四种玩法的名字与类型图 */
const CHALLENGE: Readonly<Record<string, string>> = {
  ChallengeTypeChasm: "忘却之庭",
  ChallengeTypeStory: "虚构叙事",
  ChallengeTypeBoss: "末日幻影",
  ChallengeTypePeak: "异相仲裁"
}

/** 活动类型 × 状态 → 视图状态与右侧那句 */
const ACT_STATUS: Readonly<Record<string, Readonly<Record<string, { type: ActRow["status"]; text: string }>>>> = {
  ActivityTypeSign: {
    SignStatusUnopened: { type: "pending", text: "未开启" },
    SignStatusUnSignedToday: { type: "active", text: "今日未签到" },
    SignStatusSignedToday: { type: "active", text: "今日已签到" },
    SignStatusUnclaimed: { type: "active", text: "奖励未领取" },
    SignStatusFinish: { type: "done", text: "已完成" }
  },
  ActivityTypeDouble: {
    DoubleRewardActStatusUnopened: { type: "pending", text: "未开启" },
    DoubleRewardActStatusProgress: { type: "active", text: "今日剩余" },
    DoubleRewardActStatusFinish: { type: "done", text: "已完成" }
  },
  ActivityTypeOther: {
    OtherActStatusUnopened: { type: "pending", text: "未开启" },
    OtherActStatusUnFinish: { type: "active", text: "进行中" },
    OtherActStatusFinish: { type: "done", text: "已完成" }
  },
  ActivityTypeRogueTourn: {
    RogueTournActStatusProgress: { type: "active", text: "拟合等级" },
    RogueTournActStatusFinish: { type: "active", text: "拟合等级" }
  },
  ActivityTypeGridFight: {
    RogueTournActStatusProgress: { type: "active", text: "晋升等级" },
    RogueTournActStatusFinish: { type: "active", text: "晋升等级" }
  }
}

/** 活动全部完成的那几种状态，「已全部完成」按它判 */
const ACT_FINISHED = new Set(["SignStatusFinish", "OtherActStatusFinish", "DoubleRewardActStatusFinish", "RogueTournActStatusFinish"])

/** 逐光捡金状态 → 视图状态 */
const CHALLENGE_STATUS: Readonly<Record<string, ActRow["status"]>> = {
  challengeStatusUnopened: "pending",
  challengeStatusInProgress: "active",
  challengeStatusFinish: "done"
}

/**
 * 秒级或毫秒级时间戳 → 毫秒
 * @param value 时间戳
 * @returns 毫秒；不是数时 0
 */
function ms(value: unknown): number {
  const n = num(value)
  return String(Math.trunc(n)).length <= 10 ? n * 1000 : n
}

/**
 * 小时数 → `3天7小时`
 * @param hours 小时数
 * @returns 文本；为 0 时空串
 */
function span(hours: number): string {
  const day = Math.floor(hours / 24)
  const hour = Math.ceil(hours % 24)
  if (day === 0) return hour !== 0 ? `${hour}小时` : ""
  return `${day}天${hour !== 0 ? `${hour}小时` : ""}`
}

/**
 * 两个时刻相差几小时，向上取整
 * @param later 较晚
 * @param earlier 较早
 * @returns 小时数
 */
function hoursBetween(later: number, earlier: number): number {
  return Math.ceil((later - earlier) / 3600000)
}

/** 一段时间的判定结果 */
interface SrTime {
  /** 未开启 / 进行中 / 已结束 */
  status: "pending" | "active" | "end"
  /** 那一句 */
  message: string
  /** 进行中且不足三天 */
  hot: boolean
}

/**
 * 按状态与余量拼那一句
 * @param status 状态
 * @param left 余量，毫秒
 * @param hours 余量，小时
 * @param today 是否今日开启
 * @returns 判定结果
 */
function timeMessage(status: "pending" | "active", left: number, hours: number, today: boolean): SrTime {
  const hot = status === "active" && left < 259200000
  if (status === "pending") return { status, message: today ? "今日开启" : `${span(hours)}后开启`, hot }
  return { status, message: span(hours), hot }
}

/**
 * 活动与逐光捡金的时间
 * @param info 时间三元组
 * @param fallback 接口不给 `now` 时用的现在
 * @returns 判定结果
 */
function actTime(info: SrTimeInfo | undefined, fallback: number): SrTime {
  const now = info?.now === undefined ? fallback : ms(info.now)
  const start = ms(info?.start_ts)
  const end = ms(info?.end_ts)
  if (now < start) return timeMessage("pending", start - now, hoursBetween(start, now), false)
  if (now <= end) return timeMessage("active", end - now, hoursBetween(end, now), false)
  return { status: "end", message: "", hot: false }
}

/**
 * 进行中那一项的倒计时线
 * @param info 时间三元组
 * @param fallback 接口不给 `now` 时用的现在
 * @returns 线；不在进行中时 undefined
 */
function barFrom(info: SrTimeInfo | undefined, fallback: number): ActBar | undefined {
  const now = info?.now === undefined ? fallback : ms(info.now)
  const start = ms(info?.start_ts)
  const end = ms(info?.end_ts)
  if (now < start || now > end) return undefined
  return barOf((end - now) / 1000, start > 0 ? (end - start) / 1000 : 0)
}

/**
 * 两个时刻是否同一天（同月同日）
 * @param a 其一，毫秒
 * @param b 其二，毫秒
 * @returns 是否同一天
 */
function sameDay(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getDate() === y.getDate() && x.getMonth() === y.getMonth()
}

/**
 * 卡池的时间
 * @param pool 卡池
 * @param curVersion 当前版本
 * @param fallback 接口不给 `now` 时用的现在
 * @returns 判定结果；常驻开放的卡池 message 为「长期开放」
 */
function poolTime(pool: SrPool, curVersion: string, fallback: number): SrTime {
  const info = pool.time_info
  const now = info?.now === undefined ? fallback : ms(info.now)
  const start = ms(info?.start_ts)
  const end = ms(info?.end_ts)
  const toStart = hoursBetween(start, now)
  const afterVersion = pool.is_after_version === true
  if ((afterVersion && pool.version === curVersion) || (!afterVersion && toStart <= 0)) {
    if (pool.gacha_time_type === "GachaTimeTypeLong") return { status: "active", message: "长期开放", hot: false }
    return timeMessage("active", end - now, hoursBetween(end, now), false)
  }
  const today = toStart < 0 || (afterVersion && toStart < 24 && sameDay(start, now))
  return timeMessage("pending", start - now, toStart, today)
}

/**
 * 一个卡池 → 视图
 * @param pool 卡池
 * @param kind 角色或光锥
 * @param raw 整份返回
 * @param ctx 上下文
 * @returns 视图
 */
function poolOf(pool: SrPool, kind: "char" | "weapon", raw: SrActCalendarRaw, ctx: ActContext): ActPool {
  const time = poolTime(pool, raw.cur_game_version ?? "", ctx.now)
  const list = (kind === "char" ? pool.avatar_list : pool.equip_list) ?? []
  const faces = list
    .filter(it => !!it.item_name)
    .map((it): ActFace => faceOf(ctx, kind, it.item_id, it.item_name, num(it.rarity)))
  const bar = time.status === "active" && pool.gacha_time_type !== "GachaTimeTypeLong" ? barFrom(pool.time_info, ctx.now) : undefined
  return {
    ...(bar ? { bar } : {}),
    version: pool.version ?? "",
    name: pool.name ?? "",
    status: time.status === "pending" ? "pending" : "active",
    time: time.message,
    timeIcon: time.status !== "pending" && pool.gacha_time_type !== "GachaTimeTypeLong" ? "clock" : "",
    hot: time.hot,
    state: "",
    note: "",
    faces
  }
}

/**
 * 列表上那件奖励
 * @param row 活动行，就地改
 * @param reward 奖励
 * @param ctx 上下文
 */
function fillReward(row: ActRow, reward: SrReward | undefined, ctx: ActContext): void {
  if (!reward?.item_id) return
  const name = reward.name ?? ""
  row.rewardName = name
  row.rewardIcon = ctx.reward?.(name) ?? ""
  if (num(reward.num)) row.reward = `×${num(reward.num)}`
}

/**
 * 一条活动 → 视图
 * @param act 活动
 * @param ctx 上下文
 * @returns 视图
 */
function actRow(act: SrAct, ctx: ActContext): ActRow {
  const type = act.act_type ?? ""
  const st = ACT_STATUS[type]?.[act.act_status ?? ""]
  const row = blankRow(act.name ?? "", st?.type ?? "active")
  const time = actTime(act.time_info, ctx.now)
  if (act.act_time_type !== "ActTimeTypeLong") {
    row.time = time.message
    row.timeIcon = st?.type === "pending" ? "" : "clock"
    row.hot = time.hot
    const bar = st?.type === "active" || !st ? barFrom(act.time_info, ctx.now) : undefined
    if (bar) row.bar = bar
  }
  fillReward(row, act.special_reward, ctx)
  row.items = itemsOf(act.reward_list, ctx)

  if (!st) return row
  if (st.type === "pending") {
    row.value = st.text || "未开启"
    return row
  }
  if (st.type === "done") {
    row.done = true
    return row
  }
  if (type === "ActivityTypeOther") {
    row.value = st.text
    return row
  }
  const cur = num(act.current_progress)
  const total = num(act.total_progress)
  row.value = String(cur)
  row.total = `/${total}`
  row.light = !(type === "ActivityTypeDouble" && cur === 0) && !(type === "ActivityTypeRogueTourn" && cur === total)
  row.desc = type === "ActivityTypeDouble" && act.count_refresh_type === 0 ? "剩余次数" : st.text
  return row
}

/**
 * 一条逐光捡金 → 视图
 * @param ch 逐光捡金
 * @param ctx 上下文
 * @returns 视图
 */
function challengeRow(ch: SrChallenge, ctx: ActContext): ActRow {
  const type = ch.challenge_type ?? ""
  const status = CHALLENGE_STATUS[ch.status ?? ""] ?? "active"
  const title = CHALLENGE[type] ?? ""
  const row = blankRow(`${title}·${ch.name_mi18n ?? ""}`, status)
  row.icon = title ? `${RES}${title}.svg` : ""
  const time = actTime(ch.time_info, ctx.now)
  row.time = time.message
  row.timeIcon = status === "pending" ? "" : "clock"
  row.hot = time.hot
  const bar = status === "active" ? barFrom(ch.time_info, ctx.now) : undefined
  if (bar) row.bar = bar
  fillReward(row, ch.special_reward, ctx)
  row.items = itemsOf(ch.reward_list, ctx)

  if (status === "pending") {
    row.value = "未开启"
    return row
  }
  const cur = num(ch.current_progress)
  const total = num(ch.total_progress)
  row.pre = "star"
  row.value = String(cur)
  row.total = `/${total}`
  row.light = status === "active" || cur !== total
  if (num(ch.extra_progress) > 0) row.post = `${RES}额外星.png`
  return row
}

/**
 * 一节的右注
 * @param count 条数
 * @param allDone 是否全部完成
 * @returns 右注
 */
function noteOf(count: number, allDone: boolean): string {
  if (count === 0) return "敬请期待"
  return allDone ? "已全部完成" : ""
}

/**
 * 星铁活动日历 → 主体
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @returns 主体
 */
export function srActCalendar(raw: SrActCalendarRaw, ctx: ActContext): ActBody {
  const acts = raw.act_list ?? []
  const challenges = raw.challenge_list ?? []
  const sections: ActSection[] = [
    {
      title: "活动",
      note: noteOf(acts.length, acts.every(a => ACT_FINISHED.has(a.act_status ?? ""))),
      blocks: acts.length ? [{ rows: acts.map(a => actRow(a, ctx)) }] : []
    },
    {
      title: "逐光捡金",
      note: noteOf(challenges.length, challenges.every(c => c.status === "challengeStatusFinish")),
      blocks: challenges.length ? [{ rows: challenges.map(c => challengeRow(c, ctx)) }] : []
    }
  ]
  return {
    poolTitle: "活动跃迁",
    groups: [
      { title: "角色活动跃迁", pools: (raw.avatar_card_pool_list ?? []).map(p => poolOf(p, "char", raw, ctx)) },
      { title: "光锥活动跃迁", pools: (raw.equip_card_pool_list ?? []).map(p => poolOf(p, "weapon", raw, ctx)) }
    ].filter(g => g.pools.length > 0),
    sections
  }
}
