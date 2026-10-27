/**
 * 模块职责：武器 / 光锥图鉴（`#护摩之杖图鉴`）的视图模型
 * 依赖方向：纯函数，依赖 views/panel 的格式化与 meta/material 的条目类型；不碰 IO
 * 生命周期：无状态
 * 注意事项：**满级主属性是算出来的、不是查出来的**：元数据只给整十级档位、满级在末段区间线性插值，副属性另按每五级一跳（故 {@link calcWeaponAttr} 两段）；带 `+` 的键是突破后同级、优先取它（反过来会把满级算成刚够突破的值）。
 *          精炼描述取**五档并列**形态（`20/25/30/35/40%`）而非某一档，排版两处细节：百分号只留末尾一个、值本身带斜杠时整段再套圆括号。原神精炼数据在 `affixData`，星铁与绝区零同在 `skill`/`talents`（占位符同形），故 {@link weaponAffix} 只分「原神」与「星铁绝区零」两支。
 */
import type { PanelGame } from "../panel/profile/index.js"
import { GS_WEAPON_ATTR_NAME } from "../panel/prop/gs.js"
import { SR_WEAPON_ATTR_NAME } from "../panel/prop/sr.js"
import { weaponStats, type ZzzWeaponDetail } from "../panel/zzz/attr.js"
import { comma, pct } from "./panel.js"
import type { WikiMaterial, WikiMaterialDeps } from "./char-wiki.js"
import { srMaterialsFrom } from "./char-wiki.js"
import { INDENT } from "../core/text.js"

/** 原神武器类型键 → 中文名 */
const WEAPON_TYPE_NAME: Readonly<Record<string, string>> = {
  sword: "单手剑",
  catalyst: "法器",
  bow: "弓",
  claymore: "双手剑",
  polearm: "长柄武器"
}

/** 副属性键 → 中文名，那张表在 panel/prop/gs.ts（一个游戏一份，见该文件的说明） */
const ATTR_NAME = GS_WEAPON_ATTR_NAME

/** 原神武器的等级档位，插值就在相邻两档之间做 */
const LV_STEP: readonly number[] = [1, 20, 40, 50, 60, 70, 80, 90]

/** 副属性每多少级跳一档 */
const BONUS_STEP = 5

/** 一份武器 `data.json` 里图鉴用到的字段 */
export interface WeaponDetail extends Record<string, unknown> {
  /** 一句武器介绍 */
  desc?: string
  /** 精炼名，原神独有 */
  affixTitle?: string
  /** 精炼数据，原神独有 */
  affixData?: { text?: string; datas?: Record<string, readonly string[]> }
  /** 技能，星铁独有 */
  skill?: { name?: string; desc?: string; tables?: Record<string, readonly (number | string)[]> }
  /** 叠影，绝区零独有；与 {@link skill} 同形，故 {@link weaponAffix} 两者共用一支 */
  talents?: { name?: string; desc?: string; tables?: Record<string, readonly (number | string)[]> }
  /** 音擎基础属性，绝区零独有 */
  base?: { name?: string; value?: number }
  /** 音擎高级属性，绝区零独有；`value` 是放大一百倍的百分点 */
  sub?: { name?: string; value?: number }
  /** 等级属性曲线 */
  attr?: unknown
  /** 成长值，星铁独有 */
  growAttr?: Record<string, number>
  /** 类别 → 材料全名 */
  materials?: Record<string, string>
}

/** 算好的满级主属性 */
export interface WeaponBase extends Record<string, unknown> {
  /** 基础攻击，原神独有 */
  atkBase?: string
  /** 副属性，原神独有 */
  attr?: { key: string; value: string }
  /** 生命值，星铁独有 */
  hp?: string
  /** 攻击力，星铁独有 */
  atk?: string
  /** 防御力，星铁独有 */
  def?: string
}

/**
 * 把装载器读出来的整份 `data.json` 收成本模块的形态
 *
 * 与 views/char-wiki 的 `asWikiDetail` 同一处置，理由见那边。
 * @param raw 装载器读出来的详情
 * @returns 武器图鉴用的详情
 */
export function asWeaponDetail(raw: unknown): WeaponDetail {
  return (typeof raw === "object" && raw !== null ? raw : {}) as WeaponDetail
}

/** 武器图鉴要用的输入 */
export interface WeaponWikiInput {
  /** 游戏 */
  game: PanelGame
  /** 全名 */
  name: string
  /** 星级 */
  star: number
  /** 类别：原神是 `polearm` 一类的键、星铁是命途 */
  type: string
  /** 立绘，相对元数据根目录 */
  gacha: string
  /** 整份 `data.json` */
  detail: WeaponDetail
}

/**
 * 满级等级与突破阶数
 *
 * 原神一二星只到 70 级四阶，其余 90 级六阶；星铁一律 80 级六阶。
 * @param game 游戏
 * @param star 星级
 * @returns 满级等级与突破阶数
 */
export function weaponMaxLv(game: PanelGame, star: number): { level: number; promote: number } {
  if (game === "sr") return { level: 80, promote: 6 }
  return star <= 2 ? { level: 70, promote: 4 } : { level: 90, promote: 6 }
}

/**
 * 找出某个等级与突破阶数落在哪一段档位区间里
 *
 * 档位表相邻两项构成一段，`promote` 决定用第几段 —— 90 级可以是"六阶满级"也可以是
 * "五阶顶着突破线"，两者的基础攻击不同。
 * @param level 等级
 * @param promote 突破阶数
 * @returns 区间左右端点
 */
export function lvRange(level: number, promote: number): { left: number; right: number } {
  let at = 0
  for (let idx = 0; idx < LV_STEP.length - 1; idx++) {
    const left = LV_STEP[idx] ?? 1
    const right = LV_STEP[idx + 1] ?? 20
    if (promote === -1 || at === promote) {
      if (level >= left && level <= right) return { left, right }
    }
    at++
  }
  return { left: 1, right: 20 }
}

/**
 * 算满级主属性
 *
 * 原神那支两段插值（基础攻击线性、副属性按五级一跳），星铁那支是
 * "该阶的基础值 + 成长值 × (等级 - 1)"。
 * @param input 武器输入
 * @returns 未格式化的主属性；没有属性曲线时 undefined
 */
export function calcWeaponAttr(
  input: WeaponWikiInput
): { atkBase?: number; attr?: { key: string; value: number }; hp?: number; atk?: number; def?: number } | undefined {
  const meta = input.detail.attr
  if (typeof meta !== "object" || meta === null) return undefined
  const { level, promote } = weaponMaxLv(input.game, input.star)

  if (input.game === "sr") {
    const step = (meta as Record<string, { attrs?: Record<string, number> }>)[String(promote)]
    if (!step?.attrs) return undefined
    const out: Record<string, number> = {}
    for (const [key, value] of Object.entries(step.attrs)) out[key] = Number(value)
    for (const [key, value] of Object.entries(input.detail.growAttr ?? {})) {
      out[key] = (Number(out[key]) || 0) + Number(value) * (level - 1)
    }
    return out
  }

  const curve = meta as { atk?: Record<string, number>; bonusKey?: string; bonusData?: Record<string, number> }
  const { left, right } = lvRange(level, promote)
  const atk = curve.atk ?? {}
  // 带 `+` 的键是"突破后的同一等级"，优先取它 —— 取不到才回落，反过来会把满级算成刚够突破的值
  const atkLeft = Number(atk[`${left}+`] ?? atk[left] ?? 0)
  const atkRight = Number(atk[right] ?? 0)
  const atkBase = atkLeft + ((atkRight - atkLeft) * (level - left)) / (right - left)

  const bonus = curve.bonusData ?? {}
  const bonusLeft = Number(bonus[`${left}+`] ?? bonus[left])
  const bonusRight = Number(bonus[right])
  const steps = Math.ceil((right - left) / BONUS_STEP)
  const value = bonusLeft + (steps - Math.ceil((right - level) / BONUS_STEP)) * ((bonusRight - bonusLeft) / steps)
  return { atkBase, attr: { key: curve.bonusKey ?? "", value } }
}

/**
 * 把算好的主属性格式化成模板要的形态
 *
 * 副属性一栏的键换成中文，值除元素精通外都带百分号；**副属性算不出
 * （一二星武器没有副属性）时整栏留空**，那时模板的 `|| ''` 会把它渲染成空白。
 * @param raw 算好的主属性
 * @returns 已格式化的主属性
 */
export function formatWeaponBase(raw: ReturnType<typeof calcWeaponAttr>): WeaponBase {
  const out: WeaponBase = {}
  if (!raw) return out

  for (const [key, value] of Object.entries(raw)) {
    if (key === "attr") continue
    out[key] = comma(Number(value), 1)
  }
  const attr = raw.attr
  if (attr && Number.isFinite(attr.value) && attr.value) {
    const name = ATTR_NAME[attr.key] ?? attr.key
    out.attr = { key: name, value: name === "元素精通" ? comma(attr.value, 1) : pct(attr.value, 1) }
  } else if (attr) {
    out.attr = { key: "", value: "" }
  }
  return out
}

/**
 * 精炼 / 叠影描述，五档并列
 *
 * 两游戏分两支（见文件头）。**占位符先收齐再替换**（循环体里改写被匹配的串会让 `lastIndex` 落旧串上）。
 * @param input 武器输入
 * @returns 精炼名与描述（含 `<nobr>` 标签，模板以 `{{@}}` 原样输出）
 */
export function weaponAffix(input: WeaponWikiInput): { name: string; desc: string } {
  // 绝区零的 `talents` 与星铁 `skill` 同形，故共用这一支；落到下面原神那支会去读包里没有的 `affixData`、叠影说明整块空白
  if (input.game === "sr" || input.game === "zzz") {
    const skill = (input.game === "zzz" ? input.detail.talents : input.detail.skill) ?? {}
    const src = skill.desc ?? ""
    let desc = src
    for (const got of [...src.matchAll(/\$(\d)\[(i|f1|f2)](%?)/g)]) {
      const [all, idx = "", format = "", mark = ""] = got
      const list = skill.tables?.[idx] ?? []
      const values = list.map(v => (mark === "%" ? pct(Number(v), format === "f2" ? 2 : 1) : comma(Number(v))))
      // 百分号只在末尾留一个（`8/10/12/14/16%` 才读得出档差）；`.replace(/(.00?)?%/g,"")` 顺带去掉 `.0`，故 14.0000…2 也显示成 14
      const value = mark === "%" ? `${values.join("/").replace(/(.00?)?%/g, "")}%` : values.join("/")
      desc = desc.replaceAll(all, value)
    }
    return { name: skill.name ?? "", desc }
  }

  const affix = input.detail.affixData ?? {}
  const src = affix.text ?? ""
  let desc = src
  for (const got of [...src.matchAll(/\$\[(\d)]/g)]) {
    const [all, idx = ""] = got
    const list = affix.datas?.[idx] ?? []
    // 值本身带斜杠时（形如 `12/14`）整段再套一层圆括号，否则五档连起来分不清哪个斜杠是哪层
    const nested = /\//.test(list[0] ?? "")
    let value = list.join(nested ? ")(" : "/")
    if (nested) value = `(${value})`
    if (/%/.test(value)) value = `${value.replaceAll("%", "")}%`
    desc = desc.replaceAll(all, `<nobr>${value}</nobr>`)
  }
  return { name: input.detail.affixTitle ?? "", desc }
}

/** 原神武器的突破材料：类别键与逐星级的份数，即"从 1 级练到满级共需多少" */
const GS_WEAPON_MATS: readonly { key: string; num: Readonly<Record<string, string>> }[] = [
  { key: "weapon", num: { 1: "1/3/1", 2: "1/4/1", 3: "2/6/6/3", 4: "3/9/9/4", 5: "5/14/14/6" } },
  { key: "monster", num: { 1: "5/6", 2: "6/8", 3: "10/12/18", 4: "15/18/27", 5: "23/27/41" } },
  { key: "normal", num: { 1: "3/5", 2: "5/7", 3: "6/10/12", 4: "10/15/18", 5: "15/23/27" } }
]

/** 星铁光锥的突破材料：突破位次与逐星级的份数，即"从 1 级练到满级共需多少" */
const SR_WEAPON_MATS: readonly { key: string; num: Readonly<Record<string, string>> }[] = [
  { key: "101", num: { 3: "53.1w", 4: "70.7w", 5: "88.3w" } },
  { key: "301", num: { 3: "2/6/9", 4: "3/9/12", 5: "4/12/15" } },
  { key: "701", num: { 3: "12/10/8", 4: "15/15/12", 5: "20/20/14" } }
]

/**
 * 一把武器的突破材料
 *
 * 原神直接读武器的 `materials`；星铁的材料 id 散在 `attr`
 * 每一阶的 `cost` 里，先折算成全名。
 * @param input 武器输入
 * @param deps 查材料的两条路
 * @returns 逐格材料
 */
export function weaponMaterials(input: WeaponWikiInput, deps: WikiMaterialDeps): WikiMaterial[] {
  const out: WikiMaterial[] = []
  const star = String(input.star)

  // 绝区零音擎的材料按 id 逐阶记（`materials` 是 `[{<id>:数}]`），按 id 合计后查材料表取名字与图；丁尼单独一格放最后
  if (input.game === "zzz") {
    const total: Record<string, number> = {}
    for (const stage of (input.detail["materials"] ?? []) as Record<string, number>[]) {
      for (const [id, n] of Object.entries(stage)) total[id] = (total[id] ?? 0) + (Number(n) || 0)
    }
    const coin = total["10"]
    for (const [id, n] of Object.entries(total)) {
      if (id === "10") continue
      const mat = deps.byId(id)
      if (!mat) continue
      out.push({ label: mat.label, star: Math.min(5, (Number(mat.star) || 1) + 1), icon: mat.icon, type: mat.type, num: String(n) })
    }
    const coinMat = coin ? deps.byId("10") : undefined
    if (coin && coinMat) out.push({ label: coinMat.label, star: 3, icon: coinMat.icon, type: coinMat.type, num: coin >= 10000 ? `${(coin / 10000).toFixed(1)}w` : String(coin) })
    return out
  }

  if (input.game === "gs") {
    const own = input.detail.materials ?? {}
    for (const cfg of GS_WEAPON_MATS) {
      const mat = deps.byName(own[cfg.key] ?? "")
      if (!mat) continue
      out.push({ label: mat.label, star: mat.star, icon: mat.icon, type: mat.type, num: cfg.num[star] ?? "" })
    }
    return out
  }

  const attrs = (input.detail.attr ?? {}) as Record<string, { cost?: Record<string, number> }>
  const own = srMaterialsFrom(Object.values(attrs), deps.byId)
  for (const cfg of SR_WEAPON_MATS) {
    const mat = deps.byName(own[cfg.key] ?? "")
    if (!mat) continue
    out.push({ label: mat.label, star: mat.star, icon: mat.icon, type: mat.type, num: cfg.num[star] ?? "" })
  }
  return out
}

/** 武器图鉴视图 */
export interface WeaponWikiView extends Record<string, unknown> {
  /** 游戏 */
  game: PanelGame
  /** 全名 */
  name: string
  /** 星级 */
  star: number
  /** 类别键，模板按它取类型图标 */
  type: string
  /** 类别中文名 */
  typeName: string
  /** 立绘，相对元数据根目录 */
  gacha: string
  /** 一句介绍 */
  desc: string
  /** 满级主属性 */
  base: WeaponBase
  /** 精炼 / 叠影描述 */
  affixText: { name: string; desc: string }
  /** 突破材料 */
  materials: WikiMaterial[]
  /** 布局配色；武器没有元素，故按游戏取一个固定值 */
  elem: string
}

/**
 * 造武器图鉴视图
 * @param input 武器输入
 * @param deps 查材料的两条路
 * @returns 视图
 */
export function buildWeaponWiki(input: WeaponWikiInput, deps: WikiMaterialDeps): WeaponWikiView {
  // 绝区零音擎：基础攻击 + 高级属性都取自 data.json（不走精炼曲线插值），叠影效果由 weaponAffix 从 talents 折出
  if (input.game === "zzz") {
    const base: WeaponBase = {}
    const sub = input.detail.sub
    // data.json 的 base / sub 是 1 级值，图鉴印的是满级（60 级五阶突破），按面板那一套成长率现算
    const top = weaponStats(input.detail as ZzzWeaponDetail, 60, 5)
    if (top.main) base.atkBase = comma(top.main.value, 0)
    if (sub?.name && top.sub) base.attr = { key: sub.name, value: top.sub.pct ? pct(top.sub.value, 1) : comma(top.sub.value, 0) }
    return {
      game: "zzz",
      name: input.name,
      star: input.star,
      type: input.type,
      typeName: input.type,
      gacha: input.gacha,
      desc: "",
      base,
      affixText: weaponAffix(input),
      materials: weaponMaterials(input, deps),
      // 绝区零暂统一用冰元素配色
      elem: "cryo"
    }
  }
  return {
    game: input.game,
    name: input.name,
    star: input.star,
    type: input.type,
    typeName: input.game === "sr" ? input.type : (WEAPON_TYPE_NAME[input.type.toLowerCase()] ?? ""),
    gacha: input.gacha,
    // 元数据里的介绍带换行标签，图鉴那一栏是定高的多行截断，标签留着会撑开它
    desc: (input.detail.desc ?? "").replace(/<\/br>|<br \/>/g, ""),
    base: formatWeaponBase(calcWeaponAttr(input)),
    affixText: weaponAffix(input),
    materials: weaponMaterials(input, deps),
    // 武器没有元素：原神一律按水元素配色，星铁用它自己那套
    elem: input.game === "gs" ? "hydro" : "sr"
  }
}

/**
 * 武器图鉴视图 → 纯文字
 * @param view 视图
 * @returns 多行文本
 */
export function weaponWikiText(view: WeaponWikiView): string {
  const lines = [`${view.name}${INDENT}${view.star} 星${view.typeName ? `${INDENT}${view.typeName}` : ""}`]

  const base: string[] = []
  if (view.base.atkBase) base.push(`基础攻击 ${view.base.atkBase}`)
  if (view.base.attr?.key) base.push(`${view.base.attr.key} ${view.base.attr.value}`)
  for (const [key, title] of Object.entries(SR_WEAPON_ATTR_NAME)) {
    const got = view.base[key as "hp" | "atk" | "def"]
    if (got) base.push(`${title} ${got}`)
  }
  if (base.length) lines.push(`满级${INDENT}${base.join(INDENT)}`)

  if (view.affixText.name) {
    // 标签在纯文字里没有意义，只留数值
    lines.push(`${view.affixText.name}${INDENT}${view.affixText.desc.replaceAll(/<\/?nobr>/g, "")}`)
  }
  if (view.desc) lines.push(view.desc)
  if (view.materials.length) {
    lines.push(`突破材料${INDENT}${view.materials.map(one => `${one.label}${one.num ? `(${one.num})` : ""}`).join("、")}`)
  }
  return lines.join("\n")
}
