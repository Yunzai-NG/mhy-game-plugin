/**
 * 模块职责：星穹铁道开拓力便笺 —— 接口原始字段 → `sr/note` 模板要的几块
 * 依赖方向：依赖 views/note-row 与 core/text；纯函数，不发请求
 * 生命周期：无状态
 * 注意事项：照官方便笺组件的判据：历战余响两栏都空即「尚未开启」（印 `0/0` 会让人以为漏做了什么），
 *          周期积分上限为 0 即不开放、整行不出；模拟宇宙积分同理。后备开拓力满了说「已满」。
 *          委托的进度条按 20 小时折算宽度，单人委托补一格占位头像（头像位固定两格）。
 */
import { at, cnDuration, duration } from "../../core/text.js"
import type { NoteBody, NoteExpedition, NoteRow } from "../note-row.js"
import { frac, gauge, num, rowsToTasks } from "../note-row.js"

/** 星穹铁道便笺的原始字段 */
export interface SrNoteRaw {
  /** 当前开拓力 */
  current_stamina?: number
  /** 开拓力上限 */
  max_stamina?: number
  /** 开拓力回满剩余秒数 */
  stamina_recover_time?: number
  /** 当前后备开拓力 */
  current_reserve_stamina?: number
  /** 后备开拓力是否已满 */
  is_reserve_stamina_full?: boolean
  /** 每日实训分 */
  current_train_score?: number
  /** 每日实训分上限 */
  max_train_score?: number
  /** 模拟宇宙积分 */
  current_rogue_score?: number
  /** 模拟宇宙积分上限 */
  max_rogue_score?: number
  /** 历战余响剩余次数 */
  weekly_cocoon_cnt?: number
  /** 历战余响每周次数 */
  weekly_cocoon_limit?: number
  /** 周期积分 */
  period_score?: number
  /** 周期积分上限 */
  period_max_score?: number
  /** 已派出委托数（米游社的拼写就是 epedition） */
  accepted_epedition_num?: number
  /** 委托上限 */
  total_expedition_num?: number
  /** 委托列表 */
  expeditions?: {
    /** 委托名 */
    name?: string
    /** 剩余秒数 */
    remaining_time?: number
    /** 参与角色头像 */
    avatars?: string[]
  }[]
}

/** 一条委托 */
export interface SrExpedition {
  /** 委托名 */
  name: string
  /** 头像两格；字面量「派遣头像」表示插件自带的占位图 */
  avatars: string[]
  /** 是否已完成 */
  done: boolean
  /** 剩余时长，如 `3小时5分钟` */
  left: string
  /** 进度条宽度，带百分号 */
  width: string
}

/** `sr/note` 模板数据里的便笺部分 */
export interface SrNoteBlocks {
  /** 开拓力 */
  stamina: NoteRow
  /** 开拓力进度条宽度，带百分号 */
  staminaWidth: string
  /** 后备开拓力 */
  reserve: NoteRow
  /** 每日实训、历战余响、周期积分、模拟宇宙 */
  daily: NoteRow[]
  /** 委托标题里的 `已派/上限` */
  expeditionCount: string
  /** 委托明细 */
  expeditions: SrExpedition[]
}

/** 委托满档时长，进度条按其折算宽度 */
const EXPEDITION_FULL = 72_000

/**
 * 星铁便笺 → 模板里的那几块
 * @param raw 原始数据
 * @param now 当前时间
 * @returns 各块
 */
export function srNoteBlocks(raw: SrNoteRaw, now: number): SrNoteBlocks {
  const cur = num(raw.current_stamina)
  const max = num(raw.max_stamina) || 240
  const left = num(raw.stamina_recover_time)
  const train = num(raw.current_train_score)
  const trainMax = num(raw.max_train_score) || 500
  const cocoon = num(raw.weekly_cocoon_cnt)
  const cocoonMax = num(raw.weekly_cocoon_limit)
  const daily: NoteRow[] = [
    { label: "每日实训", value: frac(train, trainMax), hot: train < trainMax },
    cocoon || cocoonMax
      ? { label: "历战余响剩余", value: frac(cocoon, cocoonMax), hot: cocoon > 0 }
      : { label: "历战余响剩余", value: "尚未开启", hot: false }
  ]
  if (num(raw.period_max_score) > 0) {
    const s = num(raw.period_score)
    daily.push({ label: "周期积分", value: frac(s, num(raw.period_max_score)), hot: s < num(raw.period_max_score) })
  }
  if (num(raw.max_rogue_score) > 0) {
    const s = num(raw.current_rogue_score)
    daily.push({ label: "模拟宇宙", value: frac(s, num(raw.max_rogue_score)), hot: s < num(raw.max_rogue_score) })
  }

  return {
    stamina: {
      icon: "sr/note/开拓力.png",
      label: "开拓力",
      desc: left > 0 ? `${at(left, now)} 回满` : "已回满",
      value: frac(cur, max),
      hot: cur >= max
    },
    staminaWidth: `${max > 0 ? Math.min(100, Math.round((cur / max) * 1000) / 10) : 0}%`,
    reserve: {
      icon: "sr/note/后备开拓力.png",
      label: "后备开拓力",
      desc: raw.is_reserve_stamina_full ? "已满" : "后备开拓力",
      value: String(num(raw.current_reserve_stamina)),
      hot: raw.is_reserve_stamina_full === true
    },
    daily,
    expeditionCount: frac(num(raw.accepted_epedition_num), num(raw.total_expedition_num)),
    expeditions: (raw.expeditions ?? []).map(it => {
      const remaining = num(it.remaining_time)
      const avatars = [...(it.avatars ?? [])]
      if (avatars.length === 1) avatars.push("派遣头像")
      return {
        name: it.name ?? "",
        avatars,
        done: remaining <= 0,
        left: cnDuration(remaining),
        width: `${Math.min(100, Math.max(0, ((EXPEDITION_FULL - remaining) / EXPEDITION_FULL) * 100))}%`
      }
    })
  }
}

/**
 * 星铁便笺 → 文字回退与体力提醒用的那份
 * @param raw 原始数据
 * @param now 当前时间
 * @returns 内容
 */
export function srNoteBody(raw: SrNoteRaw, now: number): NoteBody {
  const b = srNoteBlocks(raw, now)
  return {
    stamina: gauge("stamina", "开拓力", num(raw.current_stamina), num(raw.max_stamina) || 240, num(raw.stamina_recover_time), now),
    gauges: [],
    tasks: [...rowsToTasks(b.daily), { label: "后备开拓力", value: b.reserve.hot ? "已存满" : b.reserve.value, done: b.reserve.hot }],
    expedition: {
      done: num(raw.accepted_epedition_num),
      total: num(raw.total_expedition_num),
      list: (raw.expeditions ?? []).map(it => {
        const left = num(it.remaining_time)
        const one: NoteExpedition = { done: left <= 0 }
        if (it.name) one.name = it.name
        const icon = it.avatars?.[0]
        if (icon) one.icon = icon
        if (!one.done) one.left = duration(left)
        return one
      })
    }
  }
}
