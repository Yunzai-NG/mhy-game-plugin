/**
 * 模块职责：三个游戏便笺共用的形态 —— 出图那一行（{@link NoteRow}）与文字回退那份视图的零件
 * 依赖方向：纯类型与纯函数，依赖 core/text；被 views/note.ts 与 views/{gs,sr,zzz}/note.ts 引用
 * 生命周期：无状态
 * 注意事项：接口的秒数常是字符串、字段随版本增删，一律经 {@link num} 取，脏值当 0 而不抛错。
 */
import { at, duration } from "../core/text.js"

/** 一条进度量表（体力、洞天宝钱之类） */
export interface NoteGauge {
  /** 量表标识 */
  key: string
  /** 展示名 */
  label: string
  /** 当前值 */
  current: number
  /** 上限 */
  max: number
  /** 百分比，0~100，已夹到区间内 */
  percent: number
  /** 恢复满的时刻，如 `明天 08:05`；已满时 undefined */
  fullAt?: string
  /** 距恢复满的时长，如 `3 小时 25 分`；已满时 undefined */
  left?: string
  /** 距恢复满的原始秒数，已满时 0；体力提醒拿它算「下次几点再查」 */
  seconds: number
}

/** 一条事项 */
export interface NoteTask {
  /** 事项名 */
  label: string
  /** 展示值 */
  value: string
  /** 是否已不必处理 */
  done: boolean
}

/** 一次派遣 / 委托 */
export interface NoteExpedition {
  /** 委托名 */
  name?: string
  /** 头像地址 */
  icon?: string
  /** 是否已完成 */
  done: boolean
  /** 剩余时长 */
  left?: string
}

/** 文字回退与体力提醒用的那份内容 */
export interface NoteBody {
  /** 主体力 */
  stamina: NoteGauge
  /** 其余量表 */
  gauges: NoteGauge[]
  /** 事项 */
  tasks: NoteTask[]
  /** 派遣；没有派遣的游戏给 `total: 0` */
  expedition: {
    /** 已派出数 */
    done: number
    /** 可派出总数 */
    total: number
    /** 明细 */
    list: NoteExpedition[]
  }
}

/**
 * 造一条量表
 * @param key 量表标识
 * @param label 展示名
 * @param current 当前值
 * @param max 上限
 * @param seconds 回满剩余秒数，0 表示已满
 * @param now 当前时间
 * @returns 量表
 */
export function gauge(key: string, label: string, current: number, max: number, seconds: number, now: number): NoteGauge {
  const out: NoteGauge = {
    key,
    label,
    current,
    max,
    percent: max > 0 ? Math.min(100, Math.max(0, Math.round((current / max) * 100))) : 0,
    seconds: seconds > 0 ? seconds : 0
  }
  if (seconds > 0) {
    out.fullAt = at(seconds, now)
    out.left = duration(seconds)
  }
  return out
}

/**
 * 出图那几行 → 文字回退的事项
 * @param rows 行
 * @returns 事项
 */
export function rowsToTasks(rows: readonly NoteRow[]): NoteTask[] {
  return rows.map(it => ({ label: it.label, value: it.desc ? `${it.value}（${it.desc}）` : it.value, done: !it.hot }))
}

/** 便笺上的一行：图标 + 名目 + 说明 + 右侧值 */
export interface NoteRow {
  /** 图标，相对 `resources/` 的路径；不给即不画图标格 */
  icon?: string
  /** 名目 */
  label: string
  /** 名目下那行小字 */
  desc?: string
  /** 右侧值 */
  value: string
  /** 是否值得此刻去处理（满了、可领、可用），模板据此换强调色 */
  hot: boolean
  /** 值是文字而非数字，模板据此不用数字字体 */
  text?: boolean
}

/** 一行里的一枚小图（委托四格、历练点四格） */
export interface NoteMark {
  /** 图标，相对 `resources/` 的路径 */
  icon: string
  /** 要不要套进度环；模板里判不了 undefined，故另给一个布尔 */
  ringed: boolean
  /** 进度环，0~100 */
  ring: number
}

/**
 * 取数字，脏值一律当 0
 * @param value 原始值
 * @returns 数字
 */
export function num(value: unknown): number {
  const out = typeof value === "string" ? Number(value) : value
  return typeof out === "number" && Number.isFinite(out) ? out : 0
}

/**
 * `当前/上限`
 * @param current 当前
 * @param max 上限
 * @returns 文本
 */
export function frac(current: number, max: number): string {
  return `${current}/${max}`
}
