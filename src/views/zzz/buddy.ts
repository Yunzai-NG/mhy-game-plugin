/**
 * 模块职责：邦布一览（`%邦布`）的数据适配
 * 依赖方向：纯函数，依赖 core/text；不碰 IO
 * 生命周期：无状态
 * 注意事项：接口给的稀有度是字母（`S`/`A`），排序折算成数字（按字母排会得到「A 在 S 前」的反次序）。
 *          **邦布图有元数据用元数据、没有回落提交那份**（同札记角标，见 `ledgerIcon`），**不能一律取元数据**（缺省不装、没装的人一张都没有）。两者不同根，逐条给 `fromMeta` 让模板挑前缀；新邦布两处都没有时留空、由 `onerror` 换占位图。
 */
import { INDENT } from "../../core/text.js"
import type { MetaLoader } from "../../meta/loader.js"

/** 传给模板的一份数据 */
export type TemplateData = Record<string, unknown>

/** 造邦布一览时的上下文 */
export interface BuddyContext {
  /** 游戏 uid */
  uid: string
  /** 使用者昵称 */
  name: string
  /**
   * 元数据装载器；不给即视为没装元数据，图一律回落到提交的那一份
   *
   * 只用来按邦布名取一张图，故是可选的 —— 少一张图仍要出图。
   */
  meta?: MetaLoader
}

/** `buddy` 接口里本模块用到的字段 */
export interface BuddyRaw {
  /** 邦布列表 */
  list?: {
    /** 邦布 id */
    id?: number
    /** 名称，模板据其取本地图片 */
    name?: string
    /** 稀有度，`S` / `A` */
    rarity?: string
    /** 等级 */
    level?: number
    /** 星级 */
    star?: number
  }[]
}

/** 邦布稀有度 → 序号，接口给的是字母，排序时折算成数字 */
const BUDDY_RANK: Readonly<Record<string, number>> = { S: 5, A: 4, B: 3 }

/**
 * 取一只邦布的图 —— 有元数据用元数据，没有回落到提交的那一份
 *
 * 与札记角标（`ledgerIcon`）同一形态：元数据那份更小且**是全的**（41 只），提交的只有 21 只。**不能一律取元数据**（缺省不安装，那样没装的人一张图都没有）。两者不同根，故一并返回它相对哪个根、由模板据此选前缀 —— 那是 `template-img-two-roots`（README「模板约定」）那类静默空图的成因。
 * @param name 邦布名
 * @param meta 元数据装载器；省略即视为没装元数据
 * @returns 图路径与它的根
 */
function buddyIcon(name: string, meta?: MetaLoader): { img: string; fromMeta: boolean } {
  const icon = name ? meta?.byName("zzz", name)?.icon : undefined
  if (icon) return { img: icon, fromMeta: true }
  return { img: `zzz/buddy/${name}.png`, fromMeta: false }
}

/**
 * 取一个数，取不到按 0 算
 * @param value 原值
 * @returns 数值
 */
function num(value: unknown): number {
  const got = Number(value)
  return Number.isFinite(got) ? got : 0
}

/**
 * `buddy` 接口 → `zzz/buddy` 的模板数据
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @returns 模板数据
 */
export function buddyTemplateData(raw: BuddyRaw, ctx: BuddyContext): TemplateData {
  const list = [...(raw.list ?? [])]
    .map(it => ({
      ...it,
      level: num(it.level),
      star: num(it.star),
      rarity: it.rarity ?? "A",
      ...buddyIcon(it.name ?? "", ctx.meta)
    }))
    // 稀有度优先、再按等级与星级，与武器列表同一口径：先看到练得最好的
    .sort(
      (a, b) =>
        (BUDDY_RANK[b.rarity] ?? 0) - (BUDDY_RANK[a.rarity] ?? 0) || b.level - a.level || b.star - a.star
    )
  return { uid: ctx.uid, saveId: ctx.uid, name: ctx.name, list }
}

/**
 * 邦布 → 纯文字
 * @param data 模板数据
 * @returns 多行文本
 */
export function buddyText(data: TemplateData): string {
  const list = (data["list"] ?? []) as { name?: string; level: number; star: number; rarity: string }[]
  if (!list.length) return "米游社没有公开邦布数据，请在 App 的「我的角色」里打开「查询显示」"
  const lines = [`已拥有邦布 ${list.length} 只`]
  for (const it of list) lines.push(`${INDENT}${it.rarity} ${it.name ?? ""} Lv.${it.level} ${it.star} 星`)
  return lines.join("\n")
}
