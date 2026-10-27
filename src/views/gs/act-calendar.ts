/**
 * 模块职责：原神活动日历（`act_calendar`）→ 卡池与活动两块视图
 * 依赖方向：依赖 views/act-calendar-row，无 IO
 * 生命周期：无状态
 * 注意事项：剩余时间按接口给的 `countdown_seconds` 算，不用本地时钟 —— 那是服务端截取时的余量，
 *          与卡池 / 活动状态出自同一次计算。深渊（`ActTypeTower`）与剧诗（`ActTypeRoleCombat`）
 *          各有一套时间措辞，与其余活动不同句式。`type === "ActTypeNone"` 的条目整条不画。
 *          `fixed_act_list`（深渊、剧诗、幽境危战等常驻玩法）另起一块，不与限时活动混排。
 */
import type { ActBody, ActContext, ActFace, ActPool, ActPoolGroup, ActRow, RawReward } from "../act-calendar-row.js"
import { barOf, blankRow, faceOf, itemsOf, num } from "../act-calendar-row.js"

/** 卡池里的一个角色 */
interface GsPoolAvatar {
  /** 角色 id */
  id?: number | string
  /** 名字 */
  name?: string
  /** 元素，形如 `Pyro` */
  element?: string
  /** 稀有度 */
  rarity?: number | string
}

/** 卡池里的一件武器 */
interface GsPoolWeapon {
  /** 武器 id */
  id?: number | string
  /** 名字 */
  name?: string
  /** 稀有度 */
  rarity?: number | string
}

/** 一个卡池 */
interface GsPool {
  /** 卡池 id */
  pool_id?: number
  /** 版本号，如 `6.1` */
  version_name?: string
  /** 卡池名 */
  pool_name?: string
  /** 1 角色 / 2 武器 / 3 集录 */
  pool_type?: number
  /** 1 未开启 / 2 进行中 */
  pool_status?: number
  /** 距结束（进行中）或距开启（未开启）的秒数 */
  countdown_seconds?: number
  /** 开始，秒级时间戳 */
  start_timestamp?: number | string
  /** 结束，秒级时间戳 */
  end_timestamp?: number | string
  /** 角色 */
  avatars?: GsPoolAvatar[]
  /** 武器 */
  weapon?: GsPoolWeapon[]
}

/** 奖励里的一件 */
interface GsReward extends RawReward {
  /** 是否放在列表上展示 */
  homepage_show?: boolean
}

/** 一条活动 */
interface GsAct {
  /** 活动 id */
  id?: number
  /** 名字 */
  name?: string
  /** 活动类型 */
  type?: string
  /** 1 未开启 / 2 进行中 */
  status?: number
  /** 是否已完成 */
  is_finished?: boolean
  /** 距结束（进行中）或距开启（未开启）的秒数 */
  countdown_seconds?: number
  /** 开始，秒级时间戳 */
  start_timestamp?: number | string
  /** 结束，秒级时间戳 */
  end_timestamp?: number | string
  /** 奖励 */
  reward_list?: GsReward[]
  /** 签到类的进度 */
  sign_in_detail?: { progress?: number; total?: number; status?: number }
  /** 礼包兑换类的进度 */
  liben_detail?: { progress?: number; total?: number; status?: number; is_has_taken_special_reward?: boolean }
  /** 双倍类的剩余次数 */
  double_detail?: { left?: number; total?: number }
  /** 探索类的探索度 */
  explore_detail?: { explore_percent?: number }
  /** 剧诗 */
  role_combat_detail?: { has_data?: boolean; max_round_id?: number; difficulty_id?: number; tarot_finished_cnt?: number }
  /** 深渊 */
  tower_detail?: { max_star?: number; total_star?: number }
  /** 幽境危战 */
  hard_challenge_detail?: {
    difficulty?: number
    second?: number
    sub?: { seconds?: number; x?: number; y?: number }
  }
}

/** `act_calendar` 返回的 data */
export interface GsActCalendarRaw {
  /** 角色卡池 */
  avatar_card_pool_list?: GsPool[]
  /** 武器卡池 */
  weapon_card_pool_list?: GsPool[]
  /** 集录卡池 */
  mixed_card_pool_list?: GsPool[]
  /** 限时活动 */
  act_list?: GsAct[]
  /** 常驻玩法 */
  fixed_act_list?: GsAct[]
}

/** 摩拉的物品 id：列表上只印图、不印数量 */
const MORA_ID = 202

/** 资源目录 */
const RES = "gs/act-calendar/"

/**
 * 秒数 → 天、时、分
 * @param sec 秒数
 * @returns 三段
 */
function split(sec: number): { day: number; hour: number; min: number } {
  const day = Math.floor(sec / 86400)
  const hour = Math.floor((sec - day * 86400) / 3600)
  return { day, hour, min: Math.floor((sec - day * 86400 - hour * 3600) / 60) }
}

/**
 * 卡池与普通活动的时间那一句
 * @param sec 秒数
 * @param active 是否进行中
 * @returns 文本
 */
function countdown(sec: number, active: boolean): string {
  const { day, hour, min } = split(sec)
  const head = `${day > 0 ? `${day}天` : ""}${hour > 0 ? `${hour}时` : ""}${Math.max(min, 1)}分`
  return active ? `剩余时间: ${head}` : `还有${head}将开启`
}

/**
 * 深渊与剧诗的时间那一句（只在进行中时有）
 * @param sec 秒数
 * @param type 活动类型
 * @returns 文本
 */
function fixedCountdown(sec: number, type: string): string {
  const { day, hour, min } = split(sec)
  const body = `${day > 0 ? `${day}天` : ""}${hour > 0 ? `${hour}小时` : ""}${day > 0 ? "" : `${Math.max(min, 1)}分`}`
  return type === "ActTypeTower" ? `距渊月螺旋重置还有${body}` : `剩余时间：${body}`
}

/**
 * 全程秒数
 * @param it 带起止时间的卡池或活动
 * @returns 秒数；缺任一端时 0
 */
function totalOf(it: { start_timestamp?: number | string; end_timestamp?: number | string }): number {
  const start = num(it.start_timestamp)
  const end = num(it.end_timestamp)
  return start > 0 && end > start ? end - start : 0
}

/**
 * 一个卡池 → 视图
 * @param pool 卡池
 * @param ctx 上下文
 * @returns 视图
 */
function poolOf(pool: GsPool, ctx: ActContext): ActPool {
  const active = pool.pool_status === 2
  const avatars = (pool.avatars ?? []).map((a): ActFace => {
    const face = faceOf(ctx, "char", a.id, a.name, num(a.rarity))
    const elem = face.elem || (a.element ?? "").toLowerCase()
    return { ...face, elem, badges: elem ? [{ icon: `gs/element/${elem}.png`, at: "bl" }] : [] }
  })
  const weapons = (pool.weapon ?? []).map(w => faceOf(ctx, "weapon", w.id, w.name, num(w.rarity)))
  const faces = pool.pool_type === 2 ? weapons : pool.pool_type === 1 ? avatars : [...avatars, ...weapons]
  const bar = active ? barOf(num(pool.countdown_seconds), totalOf(pool)) : undefined
  return {
    ...(bar ? { bar } : {}),
    version: pool.version_name ?? "",
    name: pool.pool_name ?? "",
    status: active ? "active" : "pending",
    time: active ? countdown(num(pool.countdown_seconds), true) : "",
    timeIcon: active ? "clock" : "",
    hot: false,
    state: active ? "进行中" : "未开启",
    note: "",
    faces
  }
}

/**
 * 幽境危战最佳纪录的勋章，活动日历与 `#幽境危战` 共用
 * @param difficulty 难度
 * @param second 用时
 * @returns 资源路径；没有难度时空串
 */
export function medalOf(difficulty: number, second: number): string {
  if (!difficulty) return ""
  const key = difficulty === 6 && second <= 180 ? "6_1" : String(difficulty)
  return `${RES}勋章-${key}.png`
}

/**
 * 一条活动右侧那一栏
 * @param row 活动行，就地改
 * @param act 活动
 */
function fillRight(row: ActRow, act: GsAct): void {
  const finished = row.status === "done"
  switch (act.type) {
    case "ActTypeSignIn": {
      const d = act.sign_in_detail ?? {}
      if (finished) row.done = true
      else Object.assign(row, { value: String(num(d.progress)), total: `/${num(d.total)}`, desc: d.status === 1 ? "今日未领取" : "今日已领取" })
      return
    }
    case "ActTypeLiBen": {
      const d = act.liben_detail ?? {}
      const desc = d.status === 1 ? "今日未兑换" : "今日已兑换"
      if (finished) row.done = true
      else if (d.is_has_taken_special_reward) Object.assign(row, { value: desc, desc: "大礼盒已领取" })
      else Object.assign(row, { value: String(num(d.progress)), total: `/${num(d.total)}`, desc })
      return
    }
    case "ActTypeDouble": {
      const d = act.double_detail ?? {}
      Object.assign(row, { value: String(num(d.left)), total: `/${num(d.total)}`, desc: "剩余双倍次数" })
      return
    }
    case "ActTypeOther":
      if (finished) row.done = true
      else row.value = "进行中"
      return
    case "ActTypeTower": {
      const d = act.tower_detail ?? {}
      Object.assign(row, { value: `${num(d.max_star)}/${num(d.total_star)}`, post: "star" })
      return
    }
    case "ActTypeRoleCombat": {
      const d = act.role_combat_detail ?? {}
      Object.assign(row, {
        value: d.has_data ? `第${num(d.max_round_id)}幕` : "第-幕",
        desc: d.difficulty_id === 5 ? `圣牌${num(d.tarot_finished_cnt)}` : "已抵达"
      })
      return
    }
    case "ActTypeExplore":
      Object.assign(row, { value: `${num(act.explore_detail?.explore_percent)}%`, desc: "当前区域探索度" })
      return
    case "ActTypeHardChallenge": {
      const d = act.hard_challenge_detail ?? {}
      const difficulty = num(d.difficulty)
      Object.assign(row, {
        pre: medalOf(difficulty, num(d.second)),
        value: difficulty ? `${num(d.second)}秒` : "-",
        light: true,
        desc: "最佳纪录"
      })
      const left = num(d.sub?.seconds)
      if (row.status === "active" && left > 0) {
        const { day, hour, min } = split(left)
        row.sub = {
          label: "紊乱爆发期",
          time: `${day > 0 ? `${day}天` : ""}${hour > 0 ? `${hour}时` : ""}${Math.max(min, 1)}分`,
          hot: day < 3,
          icon: `${RES}紊乱爆发期.png`,
          value: String(num(d.sub?.x)),
          total: `/${num(d.sub?.y)}`
        }
      }
      return
    }
    default:
      return
  }
}

/**
 * 一条活动 → 视图
 * @param act 活动
 * @param ctx 上下文
 * @returns 视图；`ActTypeNone` 不画，返回 undefined
 */
function rowOf(act: GsAct, ctx: ActContext): ActRow | undefined {
  const type = act.type ?? ""
  if (type === "ActTypeNone") return undefined
  const active = act.status === 2
  const status = act.status === 1 ? "pending" : active && act.is_finished ? "done" : "active"
  const row = blankRow(act.name ?? "", status)

  if (active) {
    const sec = num(act.countdown_seconds)
    const fixed = type === "ActTypeTower" || type === "ActTypeRoleCombat"
    row.time = fixed ? fixedCountdown(sec, type) : countdown(sec, true)
    row.timeIcon = "clock"
    row.hot = split(sec).day < 3
    const bar = status === "active" ? barOf(sec, totalOf(act)) : undefined
    if (bar) row.bar = bar
  }

  row.items = itemsOf(act.reward_list, ctx)
  const reward = (act.reward_list ?? []).find(it => it.homepage_show)
  if (reward) {
    const name = reward.name ?? ""
    row.rewardName = name
    row.rewardIcon = ctx.reward?.(name) ?? ""
    if (num(reward.num) > 0 && reward.item_id !== MORA_ID) row.reward = String(num(reward.num))
  }

  if (status === "pending") row.value = "未开启"
  else fillRight(row, act)
  return row
}

/**
 * 原神活动日历 → 主体
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @returns 主体
 */
export function gsActCalendar(raw: GsActCalendarRaw, ctx: ActContext): ActBody {
  const groups: ActPoolGroup[] = [
    { title: "角色", pools: (raw.avatar_card_pool_list ?? []).map(p => poolOf(p, ctx)) },
    { title: "武器", pools: (raw.weapon_card_pool_list ?? []).map(p => poolOf(p, ctx)) },
    { title: "集录/溯光", pools: (raw.mixed_card_pool_list ?? []).map(p => poolOf(p, ctx)) }
  ].filter(g => g.pools.length > 0)

  const limited = (raw.act_list ?? []).map(a => rowOf(a, ctx)).filter((r): r is ActRow => r !== undefined)
  const fixed = (raw.fixed_act_list ?? []).map(a => rowOf(a, ctx)).filter((r): r is ActRow => r !== undefined)
  const blocks = [{ rows: limited }, { rows: fixed }].filter(b => b.rows.length > 0)

  return {
    poolTitle: "活动祈愿",
    groups,
    sections: blocks.length ? [{ title: "活动一览", note: "", blocks }] : []
  }
}
