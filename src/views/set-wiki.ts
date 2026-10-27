/**
 * 模块职责：套装图鉴（`#深林图鉴`、`*翁法罗斯图鉴`、`%沧浪行歌图鉴`）与邦布图鉴（`%企鹅布图鉴`）的视图模型
 * 依赖方向：纯函数，依赖 panel/prop 认属性中文与 views/panel 的格式化；不碰 IO
 * 生命周期：无状态
 * 注意事项：**模板仿武器光锥图鉴**（主图 + 名字 + 效果 + 若干小格），三游戏套装共用一份。套装效果按件数（2/4）逐条出，
 *          绝区零套装无部位、不出部位小图；原神星铁按 `idxs` 出部位小图。邦布另一份：基础属性 + 一句技能，图取邦布图。
 */
import { comma } from "./panel.js"
import type { PanelGame } from "../panel/profile/index.js"

/** 套装图鉴的一条效果 */
export interface SetEffect {
  /** 件数标题，如 `2 件` */
  piece: string
  /** 效果说明，已带 `<nobr>` 等标签，模板 `{{@}}` 原样输出 */
  desc: string
}

/** 套装图鉴的一个部位小图 */
export interface SetPiece {
  /** 部位名 */
  name: string
  /** 图，相对元数据根目录 */
  img: string
}

/** 造套装图鉴视图的输入，由命令层从元数据装配 */
export interface SetWikiInput {
  /** 游戏 */
  game: PanelGame
  /** 套装名 */
  name: string
  /** 主图，相对元数据根目录 */
  mainImg: string
  /** 件数 → 效果说明，如 `{2: "...", 4: "..."}` */
  skills: Readonly<Record<string, string>>
  /** 部位小图；绝区零套装无部位、给空数组 */
  pieces: readonly SetPiece[]
}

/** 套装图鉴视图 */
export interface SetWikiView extends Record<string, unknown> {
  /** 游戏 */
  game: PanelGame
  /** 类别标题：圣遗物 / 遗器 / 驱动盘 */
  kind: string
  /** 套装名 */
  name: string
  /** 主图 */
  mainImg: string
  /** 逐条件数效果 */
  effects: SetEffect[]
  /** 部位小图 */
  pieces: SetPiece[]
  /** 布局配色键 */
  elem: string
}

/** 各游戏套装的叫法 */
const KIND_NAME: Readonly<Record<PanelGame, string>> = { gs: "圣遗物", sr: "遗器", zzz: "驱动盘" }

/**
 * 造套装图鉴视图
 * @param input 套装输入
 * @returns 视图
 */
export function buildSetWiki(input: SetWikiInput): SetWikiView {
  const effects: SetEffect[] = []
  for (const [piece, desc] of Object.entries(input.skills)) {
    if (desc) effects.push({ piece: `${piece} 件`, desc })
  }
  return {
    game: input.game,
    kind: KIND_NAME[input.game],
    name: input.name,
    mainImg: input.mainImg,
    effects,
    pieces: [...input.pieces],
    // 绝区零暂统一用冰元素配色（其余套装元素背景另议）；原神无元素按水配色，星铁用自己那套
    elem: input.game === "gs" ? "hydro" : input.game === "zzz" ? "cryo" : input.game
  }
}

/**
 * 套装图鉴视图 → 纯文字
 * @param view 视图
 * @returns 多行文本
 */
export function setWikiText(view: SetWikiView): string {
  const lines = [`${view.name}（${view.kind}套装）`]
  for (const one of view.effects) lines.push(`${one.piece}：${one.desc.replace(/<[^>]+>/g, "")}`)
  return lines.join("\n")
}

/** 邦布图鉴视图 */
export interface BangbooWikiView extends Record<string, unknown> {
  /** 邦布名 */
  name: string
  /** 星级 */
  star: number
  /** 主图 */
  mainImg: string
  /** 基础属性 */
  attr: { title: string; value: string }[]
  /** 技能说明，已带标签 */
  skill: string
  /** 布局配色键；绝区零暂统一用冰元素 */
  elem: string
}

/** 邦布 `data.json` 里图鉴用到的字段 */
export interface BangbooDetail {
  /** 基础属性 */
  attr?: Record<string, number | string>
  /** 技能说明 */
  skill?: { name?: string; desc?: readonly string[] } | string
}

/** 邦布基础属性键 → 中文名（绝区零面板属性编号那套认不出邦布的原始键，单列一张） */
const BANGBOO_ATTR: Readonly<Record<string, string>> = {
  hp_max: "生命值",
  attack: "攻击力",
  defence: "防御力",
  break_stun: "冲击力",
  element_abnormal_power: "异常掌控",
  crit: "暴击率",
  crit_dmg: "暴击伤害"
}

/**
 * 造邦布图鉴视图
 * @param name 邦布名
 * @param star 星级
 * @param mainImg 主图
 * @param detail 整份 `data.json`
 * @returns 视图
 */
export function buildBangbooWiki(name: string, star: number, mainImg: string, detail: BangbooDetail): BangbooWikiView {
  const attr: { title: string; value: string }[] = []
  for (const [key, title] of Object.entries(BANGBOO_ATTR)) {
    const value = detail.attr?.[key]
    if (value === undefined) continue
    // 暴击率 / 暴击伤害存的是放大一百倍的百分点（`500` = 5%），其余取整
    const isPct = key === "crit" || key === "crit_dmg"
    attr.push({ title, value: isPct ? `${Number(value) / 100}%` : comma(Number(value)) })
  }
  const skill = typeof detail.skill === "string" ? detail.skill : (detail.skill?.desc ?? []).join("")
  return { name, star, mainImg, attr, skill, elem: "cryo" }
}

/**
 * 邦布图鉴视图 → 纯文字
 * @param view 视图
 * @returns 多行文本
 */
export function bangbooWikiText(view: BangbooWikiView): string {
  const lines = [`${view.name}（${view.star}星邦布）`]
  for (const one of view.attr) lines.push(`  ${one.title} ${one.value}`)
  if (view.skill) lines.push(view.skill.replace(/<[^>]+>/g, ""))
  return lines.join("\n")
}
