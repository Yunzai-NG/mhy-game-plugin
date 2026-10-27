/**
 * 模块职责：深渊 / 幽境危战出场率图的视图模型 —— 把第三方站的排行摊成按档分组的形态
 * 依赖方向：纯函数，依赖 core/text 与 views/panel 的 `charImgs`；不发请求、不碰凭据
 * 生命周期：无状态
 * 注意事项：**「出场率」与「使用率」是两个数、图上那两句说明不能省**：`use_rate` 口径是「出场数 ÷ 持有该角色的记录数」而非「÷ 总记录数」，冷门角色的这个数可以很高、当「多少人在用」读会得出相反结论，故两行定义印在最上面。
 *          **档位由接口给、不由本层按数值分**（`rank_class` 是站方分档 `s1`/`s`/`a`/`b`/`f`，自己切会与站方不一致），认不出的并进末档、不丢那位角色。**角色头像查元数据**，查不到的**仍留在图上**（新角色上线时站方先有数据、丢掉等于让最该看的消失）。
 */
import { INDENT } from "../core/text.js"
import type { AbyssPctMode, AbyssPctRaw } from "../service/wiki-stat.js"
import { charImgs } from "./panel.js"

/**
 * 五个档位，由高到低
 *
 * 键是接口给的 `rank_class`、值是图上印的字。`f` 印作 `C`（站方键名与它页面上印的字本就不一致）。
 */
const TIERS: readonly { key: string; label: string }[] = [
  { key: "s1", label: "S+" },
  { key: "s", label: "S" },
  { key: "a", label: "A" },
  { key: "b", label: "B" },
  { key: "f", label: "C" }
]

/** 认不出档位时并进哪一档 —— 末档，而不是丢掉那位角色 */
const FALLBACK_TIER = "f"

/** 两种模式各自的叫法 */
const MODE_NAMES: Readonly<Record<AbyssPctMode, string>> = {
  abyss: "深渊",
  hard: "幽境危战"
}

/** 出图与出文字共用的上下文 */
export interface AbyssPctContext {
  /** 查的是哪一种 */
  mode: AbyssPctMode
  /** 判一个相对路径在元数据里是否存在，用于头像回落 */
  exists?: (rel: string) => boolean
}

/** 图上的一位角色 */
export interface AbyssPctChar {
  /** 角色名 */
  name: string
  /** 使用率，形如 `62.3%` */
  rate: string
  /** 头像，相对元数据根目录；查不到时空串 */
  face: string
}

/** 图上的一档 */
export interface AbyssPctTier {
  /** 档位键，模板按它取底色 */
  key: string
  /** 档位名，如 `S+` */
  label: string
  /** 这一档的角色，按接口给的次序（使用率倒序） */
  chars: AbyssPctChar[]
}

/**
 * 使用率排版
 *
 * 接口给不带百分号的数（可能是字符串）。**认不出时给空串而非 `0%`**（印 0 会被读成「没人用」，而实情是没拿到）。
 * @param value 接口给的值
 * @returns 形如 `62.3%`；认不出时空串
 */
export function pctText(value: number | string | undefined): string {
  if (value === undefined || value === null || value === "") return ""
  const num = Number(value)
  if (!Number.isFinite(num)) return ""
  // 整数不留小数位，其余留一位 —— 站方给的精度本就到一位
  return `${num % 1 === 0 ? num : num.toFixed(1)}%`
}

/**
 * 更新时间说明里那个日期
 *
 * 接口给的形如 `更新时间：2026-09-08`，图上那一栏只要日期。取不到时原样返回。
 * @param text 接口给的说明
 * @returns 日期，或原文
 */
export function pctUpdated(text: string | undefined): string {
  if (!text) return ""
  return text.replace(/^.*?[：:]\s*/, "").trim() || text.trim()
}

/**
 * 造出场率图的数据
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function abyssPctData(raw: AbyssPctRaw | undefined, ctx: AbyssPctContext): Record<string, unknown> {
  const name = MODE_NAMES[ctx.mode]
  const list = raw?.has_list ?? []

  // 先按档分桶再逐桶排版；不重排次序（接口已按使用率倒序、重排会与站方页面不一致）
  const buckets = new Map<string, AbyssPctChar[]>()
  for (const one of TIERS) buckets.set(one.key, [])
  for (const one of list) {
    const charName = (one.name ?? "").trim()
    if (!charName) continue
    const key = (one.rank_class ?? "").trim().toLowerCase()
    const bucket = buckets.get(key) ?? buckets.get(FALLBACK_TIER)
    if (!bucket) continue
    // 头像查本地元数据；查不到时留空串，那一格不画图但角色仍在
    const imgs = charImgs({
      game: "gs",
      name: charName,
      ...(ctx.exists ? { exists: ctx.exists } : {})
    })
    bucket.push({
      name: charName,
      rate: pctText(one.use_rate),
      face: imgs["face"] ?? ""
    })
  }

  // 空档整块不出：印一个没有角色的 `S+` 会让人以为这一档"本期无人达到"
  const tiers: AbyssPctTier[] = TIERS.filter(one => (buckets.get(one.key) ?? []).length > 0).map(one => ({
    key: one.key,
    label: one.label,
    chars: buckets.get(one.key) ?? []
  }))

  return {
    game: "gs",
    title: `${name}使用率`,
    mode: ctx.mode,
    modeName: name,
    version: raw?.version ?? "",
    updated: pctUpdated(raw?.update),
    total: raw?.top_own ?? "",
    tiers,
    // 那两句定义与三句免责印在图上：前两句是口径说明（见文件头、少了会被读反），后三句说明数据来自使用者自主上传、故有滞后
    defs: [
      `出场率 = 出场总数 ÷ 总记录数`,
      `使用率 = 出场总数 ÷ 持有该角色的记录数（本图印的是这一个）`
    ],
    tips: [
      "数据来自微信小程序「提瓦特小助手」，为其使用者自主上传",
      `仅统计${ctx.mode === "abyss" ? "十二层满星" : "难度 5 / 6"}的记录`,
      "由于是自主上传，数据有一定滞后，会在本期开启后逐步稳定",
      ...(raw?.tips ? [raw.tips] : [])
    ]
  }
}

/**
 * 出场率的文字形态，出图失败时用
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function abyssPctText(raw: AbyssPctRaw | undefined, ctx: AbyssPctContext): string {
  const view = abyssPctData(raw, ctx)
  const tiers = view["tiers"] as AbyssPctTier[]
  const lines = [`${String(view["modeName"])}使用率${view["version"] ? ` ${String(view["version"])}` : ""}`]
  if (tiers.length === 0) return `${lines[0]}\n${INDENT}还没有本期的统计数据`

  for (const tier of tiers) {
    // 文字形态下每档只列前若干位：一档几十个名字连成一行读不出东西
    const head = tier.chars.slice(0, 8).map(one => `${one.name}${one.rate ? ` ${one.rate}` : ""}`)
    const more = tier.chars.length > head.length ? ` 等 ${tier.chars.length} 位` : ""
    lines.push(`${INDENT}${tier.label} ${head.join("、")}${more}`)
  }
  lines.push(`${INDENT}使用率 = 出场数 ÷ 持有该角色的记录数，与「出场率」不是一个数`)
  return lines.join("\n")
}
