/**
 * 模块职责：绝区零每日便笺 —— 接口原始字段 → `zzz/note` 模板要的几块
 * 依赖方向：依赖 views/note-row 与 core/text；纯函数，不发请求
 * 生命周期：无状态
 * 注意事项：照官方便笺页分三块：每日任务、周期任务、随便观经营。周期任务里**悬赏委托只在接口给了
 *          `bounty_commission` 时出现**；上限为 0 或缺失的项值印「-」、不给刷新时刻。随便观开着
 *          自动托管时只出一行「自动托管」，否则游历 / 制造 / 售卖三行。`refresh_time`、`left_ts`、
 *          `exp_time` 都是剩余秒数而非时刻。文案取官方战绩页的 mi18n 中文表（项目 `m20240410hy38foxb7k`）。
 */
import type { NoteBody, NoteRow } from "../note-row.js"
import { frac, gauge, num, rowsToTasks } from "../note-row.js"

/** 一项进度 */
interface Progress {
  /** 当前 */
  current?: number
  /** 上限 */
  max?: number
}

/** 绝区零便笺的原始字段 */
export interface ZzzNoteRaw {
  /** 电量 */
  energy?: {
    /** 进度 */
    progress?: Progress
    /** 回满剩余秒数 */
    restore?: number
    /** 回满那天：1 今日、2 明日 */
    day_type?: number
    /** 回满那一刻的时 */
    hour?: number
    /** 回满那一刻的分 */
    minute?: number
  }
  /** 今日活跃度 */
  vitality?: Progress
  /** 录像店经营 */
  vhs_sale?: {
    /** `SaleStateNo` / `SaleStateDoing` / `SaleStateDone` */
    sale_state?: string
  }
  /** 饼铺盲盒 / 刮刮卡 / 占卜，`CardSignDone` 为已完成 */
  card_sign?: string
  /** 悬赏委托 */
  bounty_commission?: {
    /** 已完成 */
    num?: number
    /** 上限 */
    total?: number
    /** 刷新剩余秒数 */
    refresh_time?: number
  }
  /** 丽都周纪 */
  weekly_task?: {
    /** 已获取积分 */
    cur_point?: number
    /** 积分上限 */
    max_point?: number
    /** 刷新剩余秒数 */
    refresh_time?: number
  }
  /** 随便观经营 */
  temple_running?: {
    /** 邦布游历 */
    expedition_state?: string
    /** 制造 */
    bench_state?: string
    /** 售卖 */
    shelve_state?: string
    /** 百通宝本周已获取 */
    current_currency?: number
    /** 百通宝每周上限 */
    weekly_currency_max?: number
    /** 百通宝刷新剩余秒数 */
    currency_next_refresh_ts?: number
    /** 自动托管 */
    auto_work?: {
      /** 是否在托管 */
      is_auto_work_running?: boolean
      /** 是否已托管完毕、待结算 */
      auto_work_ended?: boolean
      /** 托管剩余秒数 */
      left_ts?: number
    }
  }
  /** 绳网会员 */
  member_card?: {
    /** 是否开通 */
    is_open?: boolean
    /** `MemberCardStateACK` 为今日已领 */
    member_card_state?: string
    /** 剩余秒数 */
    exp_time?: number
  }
}

/** 一块任务 */
export interface ZzzNoteGroup {
  /** 块名 */
  title: string
  /** 块名右侧，如 `周期任务：1/3`；不给即不印 */
  note?: string
  /** 逐行 */
  rows: NoteRow[]
}

/** `zzz/note` 模板数据里的便笺部分 */
export interface ZzzNoteBlocks {
  /** 电量 */
  energy: NoteRow
  /** 绳网会员；未开通时不出现 */
  member?: NoteRow
  /** 每日任务、周期任务、随便观经营 */
  groups: ZzzNoteGroup[]
}

/** 刮刮卡一类 */
const CARD: Readonly<Record<string, string>> = { CardSignNo: "未完成", CardSignDone: "已完成" }
/** 录像店 */
const SALE: Readonly<Record<string, string>> = { SaleStateNo: "等待营业", SaleStateDoing: "正在营业", SaleStateDone: "待结算" }
/** 邦布游历 */
const EXPEDITION: Readonly<Record<string, string>> = {
  ExpeditionStateInProgress: "游历中",
  ExpeditionStateInCanSend: "可派遣",
  ExpeditionStateEnd: "小队返回"
}
/** 制造 */
const BENCH: Readonly<Record<string, string>> = { BenchStateProducing: "制造中", BenchStateCanProduce: "可制造" }
/** 售卖 */
const SHELVE: Readonly<Record<string, string>> = {
  ShelveStateSelling: "售卖中",
  ShelveStateSoldOut: "待补货",
  ShelveStateCanSell: "可上架"
}

/**
 * 两位数
 * @param n 数
 * @returns 补零
 */
const two = (n: number): string => String(n).padStart(2, "0")

/**
 * 刷新剩余秒数 → 「01天01小时后刷新」
 * @param seconds 秒数
 * @returns 说明；不大于 0 时空串
 */
function refreshText(seconds: number): string {
  if (seconds <= 0) return ""
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours >= 24
    ? `${two(Math.floor(hours / 24))}天${two(hours % 24)}小时后刷新`
    : `${two(hours)}小时${two(hours === 0 && minutes === 0 ? 1 : minutes)}分钟后刷新`
}

/**
 * 电量回满时刻 → 「今日20:32回满」
 *
 * 优先用接口给的 `day_type/hour/minute`（官方页就是这么拼的）；缺了才由 `restore` 推，隔两天以上给日期而不说「明日」。
 * @param raw 原始数据
 * @param now 当前时间
 * @returns 说明
 */
function energyFull(raw: ZzzNoteRaw, now: number): string {
  const e = raw.energy ?? {}
  const word: Readonly<Record<number, string>> = { 1: "今日", 2: "明日" }
  const day = word[num(e.day_type)]
  if (day && e.hour !== undefined) return `${day}${two(num(e.hour))}:${two(num(e.minute))}回满`
  const restore = num(e.restore)
  if (restore <= 0) return ""
  const full = new Date(now + restore * 1000)
  const days = Math.round((new Date(full).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)
  const head = days <= 0 ? "今日" : days === 1 ? "明日" : `${full.getMonth() + 1}月${full.getDate()}日`
  return `${head}${two(full.getHours())}:${two(full.getMinutes())}回满`
}

/**
 * 一项周期进度
 * @param label 名目
 * @param current 当前
 * @param max 上限
 * @param refresh 刷新剩余秒数
 * @returns 那一行
 */
function periodRow(label: string, current: number, max: number, refresh: number): NoteRow {
  if (max <= 0) return { label, value: "-", hot: false }
  const row: NoteRow = { label, value: frac(current, max), hot: current !== max }
  const desc = refreshText(refresh)
  if (desc) row.desc = desc
  return row
}

/**
 * 状态枚举 → 一行
 * @param label 名目
 * @param table 枚举到文案
 * @param state 原值
 * @param idle 不必处理的那个值（进行中），其余都算待处理
 * @returns 那一行
 */
function stateRow(label: string, table: Readonly<Record<string, string>>, state: string | undefined, idle: string): NoteRow {
  const value = table[state ?? ""]
  return value ? { label, value, hot: state !== idle } : { label, value: "-", hot: false }
}

/**
 * 绝区零便笺 → 模板里的那几块
 * @param raw 原始数据
 * @param now 当前时间
 * @returns 各块
 */
export function zzzNoteBlocks(raw: ZzzNoteRaw, now: number): ZzzNoteBlocks {
  const cur = num(raw.energy?.progress?.current)
  const max = num(raw.energy?.progress?.max) || 240
  const energy: NoteRow = {
    icon: "zzz/note/energy.png",
    label: "电量",
    desc: cur >= max ? "已全部恢复" : energyFull(raw, now),
    value: frac(cur, max),
    hot: cur >= max
  }

  const vit = num(raw.vitality?.current)
  const vitMax = num(raw.vitality?.max) || 400
  const daily: ZzzNoteGroup = {
    title: "每日任务",
    rows: [
      { label: "今日活跃度", value: frac(vit, vitMax), hot: vit !== vitMax },
      stateRow("饼铺盲盒/刮刮卡/占卜", CARD, raw.card_sign, "CardSignDone"),
      stateRow("录像店经营", SALE, raw.vhs_sale?.sale_state, "SaleStateDoing")
    ]
  }

  const b = raw.bounty_commission
  const w = raw.weekly_task ?? {}
  const t = raw.temple_running ?? {}
  const periods = [
    ...(b && Object.keys(b).length ? [periodRow("悬赏委托进度", num(b.num), num(b.total), num(b.refresh_time))] : []),
    periodRow("丽都周纪获取积分", num(w.cur_point), num(w.max_point), num(w.refresh_time)),
    periodRow("百通宝", num(t.current_currency), num(t.weekly_currency_max), num(t.currency_next_refresh_ts))
  ]
  const periodGroup: ZzzNoteGroup = {
    title: "周期任务",
    note: `${periods.filter(it => !it.hot && it.value !== "-").length}/${periods.length}`,
    rows: periods
  }

  const auto = t.auto_work
  const left = num(auto?.left_ts)
  const temple: ZzzNoteGroup = {
    title: "随便观经营",
    rows: auto?.is_auto_work_running
      ? [
          {
            label: "自动托管",
            desc: auto.auto_work_ended
              ? "已完成"
              : left <= 0
                ? ""
                : left < 60
                  ? "剩余时间：不足1分钟"
                  : `剩余时间：${two(Math.floor(left / 3600))}时${two(Math.floor((left % 3600) / 60))}分`,
            value: auto.auto_work_ended ? "待结算" : "进行中",
            hot: auto.auto_work_ended === true
          }
        ]
      : [
          stateRow("游历", EXPEDITION, t.expedition_state, "ExpeditionStateInProgress"),
          stateRow("制造", BENCH, t.bench_state, "BenchStateProducing"),
          stateRow("售卖", SHELVE, t.shelve_state, "ShelveStateSelling")
        ]
  }

  const out: ZzzNoteBlocks = { energy, groups: [daily, periodGroup] }
  if (raw.temple_running && Object.keys(raw.temple_running).length) out.groups.push(temple)
  const m = raw.member_card
  if (m?.is_open) {
    const got = m.member_card_state === "MemberCardStateACK"
    const days = num(m.exp_time) > 0 ? Math.floor(num(m.exp_time) / 86_400) : 0
    out.member = { label: "绳网会员", desc: `剩余领取${days}天`, value: got ? "菲林已领取" : "菲林未领取", hot: !got }
  }
  return out
}

/**
 * 绝区零便笺 → 文字回退与体力提醒用的那份；没有派遣，`expedition` 给空壳
 * @param raw 原始数据
 * @param now 当前时间
 * @returns 内容
 */
export function zzzNoteBody(raw: ZzzNoteRaw, now: number): NoteBody {
  const b = zzzNoteBlocks(raw, now)
  const rows = [...b.groups.flatMap(it => it.rows).filter(it => it.label !== "今日活跃度"), ...(b.member ? [b.member] : [])]
  return {
    stamina: gauge("energy", "电量", num(raw.energy?.progress?.current), num(raw.energy?.progress?.max) || 240, num(raw.energy?.restore), now),
    gauges: [gauge("vitality", "今日活跃度", num(raw.vitality?.current), num(raw.vitality?.max) || 400, 0, now)],
    tasks: rowsToTasks(rows),
    expedition: { done: 0, total: 0, list: [] }
  }
}
