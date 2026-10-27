/**
 * 模块职责：实时便笺（体力）的出口 —— 出图数据、文字回退与体力提醒共用的那份视图
 * 依赖方向：纯函数，依赖 views/{gs,sr,zzz}/note 与 region / text；不碰 IO
 * 生命周期：无状态
 * 注意事项：三游戏便笺字段毫无共性，逐块怎么取各在自己的 `views/<游戏>/note.ts`。出图与文字回退
 *          **从同一份块里取**（文字那份经 `NoteBody`），两处各写必走样。字段全按可选处理：米游社增删
 *          字段从不预告，缺一字段不应使整条命令失败。
 */
import type { GameKey } from "../core/region.js"
import { GAME_NAMES, REGION_NAMES, resolveRegionKind } from "../core/region.js"
import { cnDate, INDENT, weekOf } from "../core/text.js"
import type { GsNoteRaw } from "./gs/note.js"
import { gsNoteBlocks, gsNoteBody } from "./gs/note.js"
import type { NoteBody } from "./note-row.js"
import type { SrNoteRaw } from "./sr/note.js"
import { srNoteBlocks, srNoteBody } from "./sr/note.js"
import type { ZzzNoteRaw } from "./zzz/note.js"
import { zzzNoteBlocks, zzzNoteBody } from "./zzz/note.js"

export type { NoteExpedition, NoteGauge, NoteTask } from "./note-row.js"
export type { GsNoteRaw, SrNoteRaw, ZzzNoteRaw }

/** 便笺视图 */
export interface NoteView extends NoteBody {
  /** 游戏 */
  game: GameKey
  /** 游戏中文名 */
  gameName: string
  /** 查询的 uid */
  uid: string
  /** 区服中文名 */
  region: string
  /** 查询者昵称 */
  name: string
  /** 出图时刻，如 `08-22 13:20 星期五` */
  day: string
}

/** 造视图时的上下文 */
export interface NoteContext {
  /** 游戏 */
  game: GameKey
  /** uid */
  uid: string
  /** 查询者昵称 */
  name: string
  /** 当前时间，测试注入 */
  now?: number
}

/** 三个游戏的便笺原始数据 */
export type NoteRaw = GsNoteRaw | SrNoteRaw | ZzzNoteRaw

/**
 * 时刻 → `08-22 13:20 星期六`
 * @param now 时刻
 * @returns 文本
 */
function stamp(now: number): string {
  const d = new Date(now)
  const two = (n: number): string => String(n).padStart(2, "0")
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())} ${weekOf(now)}`
}

/**
 * 便笺原始数据 → 视图
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @returns 视图
 */
export function buildNote(raw: NoteRaw, ctx: NoteContext): NoteView {
  const now = ctx.now ?? Date.now()
  const body =
    ctx.game === "sr"
      ? srNoteBody(raw as SrNoteRaw, now)
      : ctx.game === "zzz"
        ? zzzNoteBody(raw as ZzzNoteRaw, now)
        : gsNoteBody(raw as GsNoteRaw, now)
  return {
    game: ctx.game,
    gameName: GAME_NAMES[ctx.game],
    uid: ctx.uid,
    region: REGION_NAMES[resolveRegionKind(ctx.uid, ctx.game)],
    name: ctx.name,
    day: stamp(now),
    ...body
  }
}

/**
 * 便笺视图 → 纯文字
 *
 * 没装渲染器的用户拿到的就是这段，须自成完整答案；信息顺序照用户最关心的来（先体力、再几时回满、最后杂项）。
 * @param view 视图
 * @returns 多行文本
 */
export function noteText(view: NoteView): string {
  const lines = [
    `${view.gameName} ${view.uid}（${view.region}）`,
    `${view.stamina.label} ${view.stamina.current}/${view.stamina.max}`,
    view.stamina.left ? `${INDENT}${view.stamina.left}后回满，约 ${view.stamina.fullAt}` : `${INDENT}已经回满了`,
    ...view.gauges.map(it => `${it.label} ${it.current}/${it.max}${it.left ? `，${it.left}后存满` : ""}`),
    ...view.tasks.map(it => `${it.label} ${it.value}`)
  ]
  if (view.expedition.total > 0) {
    const undone = view.expedition.list.filter(it => !it.done)
    const soon = undone.map(it => it.left).filter(Boolean)[0]
    lines.push(`派遣 ${view.expedition.done}/${view.expedition.total}${undone.length ? `，最快 ${soon} 后回来` : "，都回来了"}`)
  }
  return lines.join("\n")
}

/** 星铁便笺模板另需的账号信息，取自 `UserGame` 接口 */
export interface SrNoteExtra {
  /** 游戏内昵称 */
  nickname?: string
  /** 开拓等级 */
  level?: number
}

/** 传给模板的一份数据 */
export type TemplateData = Record<string, unknown>

/** 三个游戏的便笺模板名 */
export const NOTE_TEMPLATES: Readonly<Record<GameKey, string>> = {
  gs: "gs/note",
  sr: "sr/note",
  zzz: "zzz/note"
}

/**
 * 给每一行补上 `text`：值里没有数字的（尚未开启、冷却中）不走数字字体，否则中文落到那套字体上会变形
 * @param data 模板数据
 * @returns 同一份，已就地补好
 */
function tagText<T>(data: T): T {
  if (Array.isArray(data)) {
    for (const it of data) tagText(it)
  } else if (data && typeof data === "object") {
    const row = data as Record<string, unknown>
    if (typeof row["value"] === "string" && typeof row["hot"] === "boolean") row["text"] = !/\d/.test(row["value"])
    for (const v of Object.values(row)) if (v && typeof v === "object") tagText(v)
  }
  return data
}

/**
 * 便笺原始数据 → 模板数据
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @param extra 星铁模板另需的昵称与等级
 * @returns 模板数据
 */
export function noteTemplateData(raw: NoteRaw, ctx: NoteContext, extra: SrNoteExtra = {}): TemplateData {
  const now = ctx.now ?? Date.now()
  const head = { uid: ctx.uid, saveId: ctx.uid, name: ctx.name }
  if (ctx.game === "sr") {
    return {
      ...tagText(srNoteBlocks(raw as SrNoteRaw, now)),
      ...head,
      nickname: extra.nickname ?? "",
      level: extra.level ?? 0,
      day: `${cnDate(now)}${INDENT}${weekOf(now)}`
    }
  }
  if (ctx.game === "zzz") return { ...tagText(zzzNoteBlocks(raw as ZzzNoteRaw, now)), ...head, day: stamp(now) }
  return { ...tagText(gsNoteBlocks(raw as GsNoteRaw, now)), ...head, day: stamp(now) }
}
