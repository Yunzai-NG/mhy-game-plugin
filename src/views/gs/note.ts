/**
 * 模块职责：原神实时便笺 —— 接口原始字段 → `gs/note` 模板要的几块
 * 依赖方向：依赖 views/note-row 与 core/text；纯函数，不发请求
 * 生命周期：无状态
 * 注意事项：各块出不出现、文案取哪句照官方便笺页的判据：魔神任务按 `chapter_type` 分主线与间章（2 为间章，
 *          间章只并成一行「进行中」）；历练点与长效历练点受 `attendance_visible` 把关；砺行修远整块看
 *          `week_active_progress` 在不在，未解锁或不在活动期间只给一句说明。周本印**剩余**次数（与官方一致），
 *          参量质变仪冷却天数超过 6 一律印 6。
 */
import { at, duration } from "../../core/text.js"
import type { NoteBody, NoteExpedition, NoteMark, NoteRow } from "../note-row.js"
import { frac, gauge, num, rowsToTasks } from "../note-row.js"

/** 一项奖励的领取状态 */
interface RewardStatus {
  /** 状态，`TaskRewardStatus*` 或 `AttendanceRewardStatus*` */
  status?: string
  /** 历练点进度，满值 2000 */
  progress?: number
}

/** 魔神任务的一章 */
interface ArchonChapter {
  /** `StatusFinished` / `StatusOngoing` / `StatusNotOpen` */
  status?: string
  /** 章节号，如「第五章第六幕」 */
  chapter_num?: string
  /** 章节标题 */
  chapter_title?: string
  /** 2 为间章 */
  chapter_type?: number
}

/** 原神便笺的原始字段（只列用到的） */
export interface GsNoteRaw {
  /** 当前树脂 */
  current_resin?: number
  /** 树脂上限 */
  max_resin?: number
  /** 树脂回满剩余秒数，字符串形态 */
  resin_recovery_time?: string | number
  /** 已完成委托数 */
  finished_task_num?: number
  /** 委托总数 */
  total_task_num?: number
  /** 是否领过额外奖励 */
  is_extra_task_reward_received?: boolean
  /** 剩余周本折扣次数 */
  remain_resin_discount_num?: number
  /** 周本折扣次数上限 */
  resin_discount_num_limit?: number
  /** 当前洞天宝钱 */
  current_home_coin?: number
  /** 洞天宝钱上限；为 0 即尘歌壶未开启 */
  max_home_coin?: number
  /** 洞天宝钱存满剩余秒数 */
  home_coin_recovery_time?: string | number
  /** 已派出探索派遣数 */
  current_expedition_num?: number
  /** 探索派遣上限 */
  max_expedition_num?: number
  /** 参量质变仪 */
  transformer?: {
    /** 是否已获得 */
    obtained?: boolean
    /** 冷却剩余 */
    recovery_time?: {
      /** 天 */
      Day?: number
      /** 时 */
      Hour?: number
      /** 分 */
      Minute?: number
      /** 秒 */
      Second?: number
      /** 是否可用 */
      reached?: boolean
    }
  }
  /** 派遣列表 */
  expeditions?: {
    /** 角色侧脸图 */
    avatar_side_icon?: string
    /** 状态，`Finished` 为已完成 */
    status?: string
    /** 剩余秒数 */
    remained_time?: string | number
  }[]
  /** 每日委托与历练点 */
  daily_task?: {
    /** 委托总数 */
    total_num?: number
    /** 已完成委托数 */
    finished_num?: number
    /** 是否领过额外奖励 */
    is_extra_task_reward_received?: boolean
    /** 四个委托逐个的状态 */
    task_rewards?: RewardStatus[]
    /** 四份历练点逐个的状态 */
    attendance_rewards?: RewardStatus[]
    /** 历练点那一行要不要出现 */
    attendance_visible?: boolean
    /** 长效历练点，形如 `"0.6"` */
    stored_attendance?: string | number
    /** 长效历练点重置倒计时，秒 */
    stored_attendance_refresh_countdown?: number
  }
  /** 魔神任务进度 */
  archon_quest_progress?: {
    /** 进行中的章节 */
    list?: ArchonChapter[]
    /** 是否已开启魔神任务 */
    is_open_archon_quest?: boolean
    /** 主线是否全部完成 */
    is_finish_all_mainline?: boolean
    /** 间章是否全部完成 */
    is_finish_all_interchapter?: boolean
  }
  /** 砺行修远 */
  week_active_progress?: {
    /** 是否已解锁 */
    unlock?: boolean
    /** 是否在活动期间 */
    is_active_period?: boolean
    /** 本周进度 */
    progress_current?: number
    /** 本周进度上限 */
    progress_total?: number
    /** 本周已打卡的星期（1~7） */
    progress_current_arr?: number[]
    /** 今天星期几（1~7） */
    current_weekday?: number
    /** 周期进度 */
    period_progress_current?: number
    /** 周期进度上限 */
    period_progress_total?: number
  }
}

/** 砺行修远那一块 */
export interface GsJourney extends NoteRow {
  /** 未解锁或不在活动期间 */
  locked: boolean
  /** 本周进度那一行的右侧，如 `0/5`、`已完成` */
  week: string
  /** 一周七个点，`done` 打勾、`today` 画星 */
  dots: { done: boolean; today: boolean }[]
}

/** 每日委托那一块 */
export interface GsTask extends NoteRow {
  /** 委托四格 */
  tasks: NoteMark[]
  /** 历练点四格；不该出现时为空 */
  points: NoteMark[]
  /** 长效历练点，如 `x0.6`；不该出现时为空串 */
  stored: string
  /** 长效历练点重置倒计时，如 `10天`；不该出现时为空串 */
  storedLeft: string
}

/** 一次派遣 */
export interface GsExpedition {
  /** 角色侧脸图（米游社给的绝对地址） */
  icon: string
  /** 是否已完成 */
  done: boolean
  /** 状态句，「探险完成」或「剩余探索时间 …」 */
  text: string
}

/** `gs/note` 模板数据里的便笺部分 */
export interface GsNoteBlocks {
  /** 魔神任务，主线逐章一行、间章并一行 */
  archon: NoteRow[]
  /** 原粹树脂 */
  resin: NoteRow
  /** 洞天宝钱 */
  coin: NoteRow
  /** 每日委托与历练点 */
  task: GsTask
  /** 砺行修远；接口没给这一块时不出现 */
  journey?: GsJourney
  /** 值得铭记的强敌 */
  boss: NoteRow
  /** 参量质变仪 */
  transformer: NoteRow
  /** 派遣标题里的 `已派/上限` */
  expeditionCount: string
  /** 派遣明细 */
  expeditions: GsExpedition[]
}

/** 图标目录 */
const IC = "gs/note/"

/** 委托一格的图 */
const TASK_ICON: Readonly<Record<string, string>> = {
  TaskRewardStatusTakenAward: `${IC}委托-已领.png`,
  TaskRewardStatusFinished: `${IC}委托-完成.png`,
  TaskRewardStatusUnfinished: `${IC}委托-未完成.png`
}

/** 历练点一格的图 */
const POINT_ICON: Readonly<Record<string, string>> = {
  AttendanceRewardStatusTakenAward: `${IC}历练点-已领.png`,
  AttendanceRewardStatusWaitTaken: `${IC}历练点-可领.png`,
  AttendanceRewardStatusUnfinished: `${IC}历练点-未完成.png`,
  AttendanceRewardStatusFinishedNonReward: `${IC}历练点-未完成.png`,
  AttendanceRewardStatusForbid: `${IC}历练点-不可领.png`
}

/** 魔神任务的状态句 */
const ARCHON_STATUS: Readonly<Record<string, string>> = {
  StatusFinished: "全部完成",
  StatusOngoing: "进行中",
  StatusNotOpen: "尚未开启"
}

/**
 * 秒数 → 「3小时25分钟」，不足一小时只给分钟
 * @param seconds 秒数
 * @returns 时长
 */
export function gsRemain(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds / 60) % 60)
  return h < 1 ? `${m}分钟` : `${h}小时${m}分钟`
}

/**
 * 魔神任务
 * @param raw 原始数据
 * @returns 一到数行
 */
function archonRows(raw: GsNoteRaw): NoteRow[] {
  const p = raw.archon_quest_progress ?? {}
  const list = p.list ?? []
  const icon = `${IC}魔神任务.png`
  if (!list.length) {
    return [{ icon, label: "魔神任务", value: p.is_open_archon_quest ? "全部完成" : "尚未开启", hot: false }]
  }
  const chapter = (it: ArchonChapter): string => [it.chapter_num, it.chapter_title].filter(Boolean).join("　")
  const main = list.filter(it => it.chapter_type !== 2)
  const sub = list.filter(it => it.chapter_type === 2)
  const label = p.is_open_archon_quest && p.is_finish_all_mainline && !p.is_finish_all_interchapter ? "魔神任务（不包含间章）" : "魔神任务"
  const rows: NoteRow[] = main.map(it => ({
    icon,
    label,
    desc: chapter(it),
    value: ARCHON_STATUS[it.status ?? ""] ?? "进行中",
    hot: false
  }))
  if (sub.length) rows.push({ icon, label, desc: sub.map(chapter).join("、"), value: "进行中", hot: false })
  return rows
}

/**
 * 每日委托与历练点
 * @param raw 原始数据
 * @returns 那一块
 */
function taskBlock(raw: GsNoteRaw): GsTask {
  const d = raw.daily_task ?? {}
  const finished = num(d.finished_num ?? raw.finished_task_num)
  const total = num(d.total_num ?? raw.total_task_num) || 4
  const received = (d.is_extra_task_reward_received ?? raw.is_extra_task_reward_received) === true
  const all = finished >= total
  const showPoints = d.attendance_visible !== false && (d.attendance_rewards?.length ?? 0) > 0
  const stored = d.attendance_visible && num(d.stored_attendance) > 0 ? `x${d.stored_attendance}` : ""
  const left = num(d.stored_attendance_refresh_countdown)
  const storedLeft =
    stored && left > 0 && left <= 3_628_800
      ? left > 86_400
        ? `${Math.floor(left / 86_400)}天`
        : left > 3600
          ? `${Math.floor(left / 3600)}小时`
          : "即将重置"
      : ""
  return {
    icon: `${IC}委托.png`,
    label: "每日委托奖励",
    value: all ? (received ? "已全部领取" : "奖励未领取") : frac(finished, total),
    hot: all && !received,
    tasks: (d.task_rewards ?? []).map(it => ({
      icon: TASK_ICON[it.status ?? ""] ?? `${IC}委托-未完成.png`,
      ringed: false,
      ring: 0
    })),
    points: showPoints
      ? (d.attendance_rewards ?? []).map(
          (it): NoteMark => ({
            icon: POINT_ICON[it.status ?? ""] ?? `${IC}历练点-未完成.png`,
            // 进度环只在没领完时画：委托全做完后已领的那格只剩一个勾
            ringed:
              it.status === "AttendanceRewardStatusFinishedNonReward" ||
              it.status === "AttendanceRewardStatusWaitTaken" ||
              it.status === "AttendanceRewardStatusUnfinished" ||
              (it.status === "AttendanceRewardStatusTakenAward" && !all),
            ring: Math.min(100, Math.max(0, Math.round((num(it.progress) / 2000) * 100)))
          })
        )
      : [],
    stored,
    storedLeft
  }
}

/**
 * 砺行修远
 * @param raw 原始数据
 * @returns 那一块；接口没给时 undefined
 */
function journeyBlock(raw: GsNoteRaw): GsJourney | undefined {
  const w = raw.week_active_progress
  if (!w || !Object.keys(w).length) return undefined
  const base = { icon: `${IC}砺行修远.png`, label: "砺行修远", hot: false }
  if (!w.unlock || !w.is_active_period) {
    return { ...base, desc: w.is_active_period ? "暂未解锁" : "不在活动期间", value: "未开启", locked: true, week: "", dots: [] }
  }
  const cur = num(w.progress_current)
  const total = num(w.progress_total)
  const done = new Set((w.progress_current_arr ?? []).map(num))
  const today = num(w.current_weekday)
  return {
    ...base,
    desc: "本周进度",
    value: frac(num(w.period_progress_current), num(w.period_progress_total)),
    locked: false,
    week: cur >= total ? "已完成" : frac(cur, total),
    dots: [1, 2, 3, 4, 5, 6, 7].map(n => ({ done: done.has(n), today: n === today && !done.has(n) }))
  }
}

/**
 * 砺行修远，包成可展开的键（`exactOptionalPropertyTypes` 下不能直接给 undefined）
 * @param raw 原始数据
 * @returns `{ journey }` 或空对象
 */
function journeyOf(raw: GsNoteRaw): { journey?: GsJourney } {
  const journey = journeyBlock(raw)
  return journey ? { journey } : {}
}

/**
 * 参量质变仪
 * @param raw 原始数据
 * @returns 那一行
 */
function transformerRow(raw: GsNoteRaw): NoteRow {
  const base = { icon: `${IC}参量质变仪.png`, label: "参量质变仪" }
  const t = raw.transformer
  if (!t?.obtained) return { ...base, value: "尚未获得", hot: false }
  const r = t.recovery_time ?? {}
  if (r.reached === true) return { ...base, desc: "已准备完成", value: "可使用", hot: true }
  const day = num(r.Day)
  const hour = num(r.Hour)
  const minute = num(r.Minute)
  const desc = day
    ? `${Math.min(day, 6)}天后可再次使用`
    : hour
      ? `${hour}小时后可再次使用`
      : minute >= 5
        ? `${minute}分钟后可再次使用`
        : `${minute * 60 + num(r.Second)}秒后可再次使用`
  return { ...base, desc, value: "冷却中", hot: false }
}

/**
 * 原神便笺 → 模板里的那几块
 * @param raw 原始数据
 * @param now 当前时间
 * @returns 各块
 */
export function gsNoteBlocks(raw: GsNoteRaw, now: number): GsNoteBlocks {
  const resinLeft = num(raw.resin_recovery_time)
  const coinMax = num(raw.max_home_coin)
  const coinLeft = num(raw.home_coin_recovery_time)
  const remain = num(raw.remain_resin_discount_num)
  return {
    archon: archonRows(raw),
    resin: {
      icon: `${IC}树脂.png`,
      label: "原粹树脂",
      desc: resinLeft > 0 ? `将于${gsRemain(resinLeft)}后全部恢复（${at(resinLeft, now)}）` : "原粹树脂已完全恢复",
      value: frac(num(raw.current_resin), num(raw.max_resin) || 200),
      hot: resinLeft <= 0 && num(raw.current_resin) >= (num(raw.max_resin) || 200)
    },
    coin: {
      icon: `${IC}洞天宝钱.png`,
      label: "洞天财瓮 - 洞天宝钱",
      ...(coinMax ? { desc: coinLeft > 0 ? `预计${gsRemain(coinLeft)}后达到存储上限` : "已满" } : {}),
      value: coinMax ? frac(num(raw.current_home_coin), coinMax) : "未开启",
      hot: coinMax > 0 && coinLeft <= 0
    },
    task: taskBlock(raw),
    ...journeyOf(raw),
    boss: {
      icon: `${IC}周本.png`,
      label: "值得铭记的强敌",
      desc: "本周剩余消耗减半次数",
      value: frac(remain, num(raw.resin_discount_num_limit) || 3),
      hot: false
    },
    transformer: transformerRow(raw),
    expeditionCount: frac(num(raw.current_expedition_num), num(raw.max_expedition_num)),
    expeditions: (raw.expeditions ?? []).map(it => {
      const left = num(it.remained_time)
      const done = it.status === "Finished" || left <= 0
      return { icon: it.avatar_side_icon ?? "", done, text: done ? "探险完成" : `剩余探索时间 ${gsRemain(left)}` }
    })
  }
}

/**
 * 原神便笺 → 文字回退与体力提醒用的那份
 * @param raw 原始数据
 * @param now 当前时间
 * @returns 内容
 */
export function gsNoteBody(raw: GsNoteRaw, now: number): NoteBody {
  const b = gsNoteBlocks(raw, now)
  const rows = [...b.archon, b.task, ...(b.journey ? [b.journey] : []), b.boss, b.transformer]
  return {
    stamina: gauge("resin", "原粹树脂", num(raw.current_resin), num(raw.max_resin) || 200, num(raw.resin_recovery_time), now),
    gauges: [
      gauge("coin", "洞天宝钱", num(raw.current_home_coin), num(raw.max_home_coin), num(raw.home_coin_recovery_time), now)
    ],
    tasks: rowsToTasks(rows),
    expedition: {
      done: num(raw.current_expedition_num),
      total: num(raw.max_expedition_num),
      list: (raw.expeditions ?? []).map(it => {
        const left = num(it.remained_time)
        const one: NoteExpedition = { done: it.status === "Finished" || left <= 0 }
        if (it.avatar_side_icon) one.icon = it.avatar_side_icon
        if (!one.done) one.left = duration(left)
        return one
      })
    }
  }
}
