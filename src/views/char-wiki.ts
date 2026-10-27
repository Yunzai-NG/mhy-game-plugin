/**
 * 模块职责：角色图鉴（`#胡桃图鉴`）与养成材料（`#胡桃材料`）两页的视图模型
 * 依赖方向：纯函数，依赖 meta/elem、meta/material 的条目类型与 views/panel 的格式化；不碰 IO
 * 生命周期：无状态
 * 注意事项：数据分两类来源不同：立绘/基础属性/CV/突破材料来自元数据（装了就有），「平均命座/持有率/常用武器/常用圣遗物」四块只来自第三方统计站（缺省不请求），故 {@link buildCharWiki} 的 `stat` 可选、缺它那四块整块不出。
 *          突破材料份数是写死的展示文本（`1/9/9/6` 等），四星角色与开拓者另有一套（{@link SR_MATS} 的 `alt`）。**份数按次计算、不改共享表**（就地写回模块级表会让查过四星后每个五星拿到四星份数、不报错）。**星铁材料按 id 查、原神按全名查**（星铁从 `tree`/`treeData` 的 `cost` 收 id，缺后一条星铁材料栏整个空）。
 */
import { elemName } from "../meta/elem.js"
import { INDENT } from "../core/text.js"
import type { MaterialItem } from "../meta/material.js"
import type { PanelGame } from "../panel/profile/index.js"
import { propName } from "../panel/prop/index.js"
import type { CharImgs } from "./panel.js"
import { comma } from "./panel.js"

/** 基础属性键 → 标题；不在表里的键不显示 */
const BASE_ATTR_NAME: Readonly<Record<string, string>> = {
  hp: "基础生命",
  atk: "基础攻击",
  def: "基础防御",
  speed: "基础速度"
}

/** 成长属性键 → 标题 */
export const GROW_ATTR_NAME: Readonly<Record<string, string>> = {
  atkPct: "大攻击",
  atk: "大攻击",
  hpPct: "大生命",
  hp: "大生命",
  defPct: "大防御",
  def: "大防御",
  speed: "速度",
  cpct: "暴击",
  cdmg: "爆伤",
  recharge: "充能",
  mastery: "精通",
  heal: "治疗",
  phy: "物伤",
  stance: "击破特攻",
  effPct: "效果命中",
  effDef: "效果抵抗",
  elation: "欢愉度"
}

/** 原神武器类型键 → 中文名 */
const WEAPON_TYPE_NAME: Readonly<Record<string, string>> = {
  sword: "单手剑",
  catalyst: "法器",
  bow: "弓",
  claymore: "双手剑",
  polearm: "长柄武器"
}

/** 一行属性 */
export interface AttrLine {
  /** 标题 */
  title: string
  /** 已格式化的值 */
  value: string
}

/** 图鉴上的一件材料 */
export interface WikiMaterial {
  /** 标题，如「蒙德·诗文」 */
  label: string
  /** 星级 */
  star: number
  /** 图标，相对元数据根目录 */
  icon: string
  /** 类别，模板用它拼 class */
  type: string
  /** 份数或可刷日说明 */
  num: string
}

/** 一份角色 `data.json` 里图鉴用到的字段 */
export interface WikiDetail extends Record<string, unknown> {
  /** 称号，星铁没有 */
  title?: string
  /** 归属 */
  allegiance?: string
  /** 生日，形如 `7-15`，原神独有 */
  birth?: string
  /** 命之座名，原神独有 */
  astro?: string
  /** 一句角色介绍 */
  desc?: string
  /** 中文 CV */
  cncv?: string
  /** 日文 CV */
  jpcv?: string
  /** 能量上限，星铁独有 */
  sp?: number
  /**
   * 基础属性
   *
   * 原神与星铁是裸数字。**绝区零那份混着字符串**（`"5%"`/`"1.2/秒"`，造包时已折好），故取值处按类型分派排版。
   */
  baseAttr?: Record<string, number | string>
  /** 职业（强攻、击破……），绝区零独有 */
  prof?: string
  /** 阵营，绝区零独有 */
  camp?: string
  /** 伤害类型（斩击、打击、穿透），绝区零独有 */
  hit?: string
  /** 全名，绝区零独有；与名称相同时包里不给这一项 */
  fullName?: string
  /** 稀有度，绝区零独有（`S` / `A`）；元数据的 `star` 是内部值（S=4、A=3），图上按稀有度显示 */
  rank?: string
  /** 身高，绝区零独有 */
  stature?: number | string
  /** 成长属性，原神是 `{key,value}`、星铁是逐键的成长值 */
  growAttr?: Record<string, unknown>
  /** 类别 → 材料全名，原神独有 */
  materials?: Record<string, string>
  /** 行迹加成表，星铁独有 */
  tree?: Record<string, { key?: string; value?: number }>
  /**
   * 行迹节点表，星铁独有
   *
   * 三处都用：`cost` 是突破材料 id（材料栏靠它）、`type` 为 `skill` 的在天赋页当「额外能力」铺、`idx` 决定行迹图标。`desc` 在 char-talent 里会被折成数组，故两种形态都收。
   */
  treeData?: Record<
    string,
    { type?: string; cost?: Record<string, number>; name?: string; desc?: string | string[]; idx?: number }
  >
  /** 突破表；星铁的每一阶带 `cost` */
  attr?: unknown
}

/** 图鉴视图要用的角色输入 */
export interface WikiCharInput {
  /** 游戏 */
  game: PanelGame
  /** 全名 */
  name: string
  /** 简称，模板上那句「输入 #XX天赋」用它 */
  abbr: string
  /** 星级 */
  star: number
  /** 元素键（原神 `pyro`）或命途名（星铁 `火`） */
  elem: string
  /** 武器类型键（原神 `polearm`）或命途（星铁 `智识`） */
  weapon: string
  /** 是否旅行者 / 开拓者：前者没有 boss 材料，后者的份数按四星那一套算 */
  isMain: boolean
  /** 整份 `data.json` */
  detail: WikiDetail
  /** 图标表，由 views/panel 的 `charImgs` 算好 */
  imgs: CharImgs
}

/** 查材料的两条路 */
export interface WikiMaterialDeps {
  /** 按全名查，原神用 */
  byName: (name: string) => MaterialItem | undefined
  /** 按材料 id 查，星铁用 */
  byId: (id: string) => MaterialItem | undefined
}

/**
 * 把装载器读出来的整份 `data.json` 收成本模块的形态
 *
 * 装载器给 `Record<string, unknown>`（只声明面板计算那几段），图鉴另要十几个字段，故此处一次收窄并**一并挡住 null**（元数据缺失时给空对象比每个取值处各判一次干净）。
 * @param raw 装载器读出来的详情
 * @returns 图鉴用的详情
 */
export function asWikiDetail(raw: unknown): WikiDetail {
  return (typeof raw === "object" && raw !== null ? raw : {}) as WikiDetail
}

/** 一行最多容纳的字数 */
const DESC_LINE = 26

/**
 * 把一句角色介绍折成一到两行
 *
 * 按逗号切块逐块塞两行、塞不下的丢掉（卡片那栏只两行高，第三行会溢到立绘上）。**丢掉多余的块是有意为之**。
 * @param parts 按逗号切开的块
 * @returns 一到两行，行间以 `</br>` 分隔
 */
export function descLines(parts: readonly string[]): string {
  const taken: string[] = []
  let len = 0
  for (const one of parts) {
    // 阈值是"两行的字数"，故这一步只挡明显过长的整句，真正的分行在下面
    if (len + one.length >= DESC_LINE * 2) break
    taken.push(one)
    len += one.length
  }
  if (len <= DESC_LINE - 6) return taken.join("，")

  const rows: string[][] = [[], []]
  let at = 0
  for (const one of taken) {
    // 当前行塞不下就换行；只有两行，第三块起一律并进第二行
    if ((rows[at] ?? []).join(" ").length + one.length > DESC_LINE) at = Math.min(at + 1, rows.length - 1)
    ;(rows[at] ??= []).push(one)
    // 恰好两块时强制一块一行
    if (taken.length === 2) at = Math.min(at + 1, rows.length - 1)
  }
  return `${(rows[0] ?? []).join("，")}</br>${(rows[1] ?? []).join("，")}`
}

/**
 * 规整一句角色介绍
 *
 * 去句末句号、句号与半角逗号统一成全角逗号、破折号前断句，短句原样返回、长句折行。
 * **`replace` 用字符串参数时只替换第一处**（`</br>` 与 `——` 都刻意如此）。以 `/-/` 测半角连字符却以 `indexOf("—")` 查破折号、两者不会同时命中，故找不到破折号时改走折行。
 * @param desc 原始介绍
 * @returns 可直接写进模板的 HTML（可能含 `</br>`）
 */
export function charDesc(desc: string): string {
  let out = (desc || "").replace(/。$/, "")
  out = out.replace("</br>", "，")
  out = out.replace(/[。,]/g, "，")
  out = out.replace("——", "，——")
  if (out.length < 25) return out

  if (/-/.test(out)) {
    const at = out.indexOf("—")
    if (at > 0) return `${out.slice(0, at)}</br>${out.slice(at)}`
  }
  return descLines(out.split("，"))
}

/**
 * 武器类型键 → 中文名
 * @param game 游戏
 * @param weapon 武器类型键（原神）或命途（星铁）
 * @returns 中文名；原神认不出时空串，星铁原样返回（它本就是中文）
 */
export function weaponTypeName(game: PanelGame, weapon: string): string {
  if (game === "sr") return weapon
  return WEAPON_TYPE_NAME[(weapon || "").toLowerCase()] ?? ""
}

/**
 * `7-15` → `7月15日`
 * @param birth 元数据里的生日
 * @returns 中文生日；没有时空串
 */
export function birthdayOf(birth?: string): string {
  if (!birth) return ""
  const [month, day] = birth.split("-")
  return month && day ? `${month}月${day}日` : ""
}

/**
 * 基础属性与成长属性
 *
 * 两条排版规则：**基础属性按元数据自身键序输出**（不另排序，那正是图上顺序）；**成长值过长时才走千分位**（`length > 10`，实则在挑精通那项——它算出来是 `115.19999999999999`，暴击爆伤一类 `38.4` 直接显示）。
 * @param input 角色输入
 * @returns 基础属性与成长属性两组
 */
export function charAttrList(input: WikiCharInput): { attr: AttrLine[]; growret: AttrLine[] } {
  const attr: AttrLine[] = []
  const growret: AttrLine[] = []
  const base = input.detail.baseAttr ?? {}

  // 绝区零的 baseAttr 键多（hp/atk/impact/cpct…）且值混着字符串（`5%`/`1.2/秒`），按 panel/prop 认名、原样印
  if (input.game === "zzz") {
    for (const [key, value] of Object.entries(base)) {
      const title = propName("zzz", key)
      if (!title) continue
      attr.push({ title, value: typeof value === "string" ? value : comma(Number(value)) })
    }
    return { attr, growret }
  }

  for (const [key, value] of Object.entries(base)) {
    const title = BASE_ATTR_NAME[key]
    if (title) attr.push({ title, value: comma(Number(value), 1) })
  }

  if (input.game === "gs") {
    const grow = input.detail.growAttr ?? {}
    const key = String(grow["key"] ?? "")
    const value = Number(grow["value"] ?? 0)
    if (key) {
      const name = key === "dmg" ? `${elemName(input.elem, input.elem, "gs")}伤` : (GROW_ATTR_NAME[key] ?? key)
      attr.push({ title: `成长·${name}`, value: String(value).length > 10 ? comma(value, 1) : String(value) })
    }
    return { attr, growret }
  }

  // 星铁的成长不是一项而是一张行迹表：同一个键在多个行迹节点上各加一点，要先按键累加
  for (const [key, value] of Object.entries(treeSum(input.detail.tree))) {
    growret.push({ title: GROW_ATTR_NAME[key] ?? `${input.elem}伤`, value: comma(value, 1) })
  }
  return { attr, growret }
}

/**
 * 把星铁的行迹加成按键累加
 * @param tree 行迹表
 * @returns 键 → 合计值，键序即行迹表的键序
 */
export function treeSum(tree: WikiDetail["tree"]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const one of Object.values(tree ?? {})) {
    const key = one?.key
    if (!key) continue
    out[key] = (out[key] ?? 0) + (Number(one.value) || 0)
  }
  return out
}

/** 原神的六格材料：类别键与"练到满级共需多少" */
const GS_MATS: readonly { key: string; num?: string; skipMain?: boolean }[] = [
  { key: "gem", num: "1/9/9/6" },
  // 旅行者没有 boss 材料，故这一格对它整个不出
  { key: "boss", num: "46", skipMain: true },
  { key: "normal", num: "18/30/36" },
  { key: "specialty", num: "168" },
  // 天赋书与周本材料不写份数，改显示可刷日（那一格问的是"什么时候能刷"）
  { key: "talent" },
  { key: "weekly" }
]

/**
 * 星铁的六格材料
 *
 * 键是材料的**突破位次**（`101` 信用点、`201` 晋升材料……）而非类别名。`alt` 是四星角色与
 * 开拓者那一套份数 —— 它们的消耗比五星低一档。
 */
const SR_MATS: readonly { key: string; num: string; alt?: string | ((weapon: string) => string) }[] = [
  { key: "101", num: "388.8w", alt: "322.64w" },
  { key: "201", num: "65", alt: "28" },
  { key: "701", num: "56/71/73", alt: (w): string => (w === "记忆" ? "40/52/55" : "40/55/54") },
  { key: "501", num: "8", alt: "5" },
  { key: "401", num: "12" },
  { key: "301", num: "18/69/139", alt: (w): string => (w === "记忆" ? "9/53/105" : "12/54/105") }
]

/**
 * 收集星铁角色的突破材料
 *
 * 材料 id 散在 `treeData` 与 `attr` 每一阶的 `cost` 里，收齐逐个查表、**同一突破位次留星级最高的那个**（图上只画最高阶）。
 * @param detail 整份 `data.json`
 * @param byId 按材料 id 查
 * @returns 突破位次 → 材料全名
 */
export function srMaterials(detail: WikiDetail, byId: WikiMaterialDeps["byId"]): Record<string, string> {
  const attrs = (detail.attr ?? {}) as Record<string, { cost?: Record<string, number> }>
  return srMaterialsFrom([...Object.values(detail.treeData ?? {}), ...Object.values(attrs)], byId)
}

/**
 * 从若干处 `cost` 里挑出每个突破位次该显示的材料
 *
 * **同一位次留星级最高的那个**（星级相等后来者顶掉前者）。角色与光锥共用：前者 `cost` 在 `treeData` 与 `attr` 两处、后者只在 `attr`。
 * @param sources 带 `cost` 的若干条目
 * @param byId 按材料 id 查
 * @returns 突破位次 → 材料全名
 */
export function srMaterialsFrom(
  sources: readonly ({ cost?: Record<string, number> } | undefined)[],
  byId: WikiMaterialDeps["byId"]
): Record<string, string> {
  const ids = new Set<string>()
  for (const cfg of sources) {
    for (const id of Object.keys(cfg?.cost ?? {})) ids.add(id)
  }

  const out: Record<string, string> = {}
  const stars: Record<string, number> = {}
  for (const id of ids) {
    const mat = byId(id)
    if (!mat?.poseType) continue
    const held = out[mat.poseType]
    if (held !== undefined && (stars[held] ?? 0) > mat.star) continue
    out[mat.poseType] = mat.name
    stars[mat.name] = mat.star
  }
  return out
}

/**
 * 绝区零代理人的四类养成材料
 *
 * `data.json.materials` 给的是**材料名**（`{promote,skill,special,boss}`）。**星级与图标一律走材料表**
 * （`deps.byName`）——每类材料稀有度不同，旧实现把四格都写死 4 档，出图是清一色紫框、与游戏内不符。
 * 份数绝区零不写（包里无逐级消耗，凭空标数反而误导），故 `num` 放**两字**类别名当表头——四字会把
 * 那一格撑宽、四张卡与表头错位（`.num` 宽度联动格宽），这正是"排版杂乱"的成因。表未装或该材料比包新
 * （查不到）时回落成按名拼路径 + S 档金框（专精/专业两类恒 S，回落多半落在它们身上），宁可画出也不整格空掉。
 */
const ZZZ_MAT_BUCKETS: readonly { key: string; label: string }[] = [
  { key: "promote", label: "晋升" },
  { key: "skill", label: "技能" },
  { key: "special", label: "专业" },
  { key: "boss", label: "专精" }
]

/**
 * 绝区零材料的内部星级 → 出图档位
 *
 * 包里星级是 1~4 的内部值（与代理人 S=4 同一把尺），而框图沿用原神 2~5 档的配色（5 金、4 紫、3 蓝）。
 * 直接用会把 S 档材料画成紫框，故 +1 对齐：内部 4（S）→ 5 档金框、3（A）→ 4 档紫框，以此类推。
 * @param star 材料表里的内部星级
 * @returns 出图档位（2~5）
 */
function zzzMatStar(star: number): number {
  return Math.min(5, (Number(star) || 4) + 1)
}

/**
 * 绝区零一位代理人练满要的每样材料合计：突破六阶 + 五个技能各 1→12 + 核心技 1→7
 *
 * 突破表在 `promote[阶].materials`，逐级技能表在 `cost.skill` / `cost.core`（`等级 → 材料 id → 数量`，第 n 级是 n→n+1 那一次）；
 * 五个可升技能同表，故乘 5。包里缺 `cost` 时只合计突破那一份，技能材料的格子退回类别名。
 * @param detail 整份 `data.json`
 * @returns 材料 id → 数量
 */
export function zzzMatTotals(detail: WikiDetail): Record<string, number> {
  const out: Record<string, number> = {}
  const add = (mats: Record<string, number> | undefined, times = 1): void => {
    for (const [id, n] of Object.entries(mats ?? {})) out[id] = (out[id] ?? 0) + (Number(n) || 0) * times
  }
  const promote = (detail["promote"] ?? {}) as Record<string, { materials?: Record<string, number> }>
  for (const one of Object.values(promote)) add(one.materials)
  const cost = (detail["cost"] ?? {}) as { skill?: Record<string, Record<string, number>>; core?: Record<string, Record<string, number>> }
  for (const one of Object.values(cost.skill ?? {})) add(one, 5)
  for (const one of Object.values(cost.core ?? {})) add(one)
  return out
}

/**
 * 一个角色的突破材料，按图上的格子顺序
 *
 * 原神直接读 `materials`；星铁先走 {@link srMaterials} 把 id 折成全名；绝区零按四类材料名拼图路径。查不到的整格不出（元数据里没它的图，画空框更难看）。
 * @param input 角色输入
 * @param deps 查材料的两条路
 * @returns 逐格材料
 */
export function charMaterials(input: WikiCharInput, deps: WikiMaterialDeps): WikiMaterial[] {
  const out: WikiMaterial[] = []

  if (input.game === "zzz") {
    // 合计按 id 记，格子按名字取：材料表的条目不带 id，故先把 id 折成名字
    const total: Record<string, number> = {}
    for (const [id, n] of Object.entries(zzzMatTotals(input.detail))) {
      const name = deps.byId(id)?.name
      if (name) total[name] = (total[name] ?? 0) + n
    }
    const own = input.detail.materials ?? {}
    for (const { key, label } of ZZZ_MAT_BUCKETS) {
      const name = own[key]
      if (!name) continue
      // 稀有度与图标以材料表为准；表未装或查不到时回落到按名拼路径、按视觉给 S 档金框
      const mat = deps.byName(name)
      const num = total[name]
      out.push({
        label: name,
        star: mat ? zzzMatStar(mat.star) : 5,
        icon: mat?.icon ?? `meta-zzz/material/${key}/${name}.webp`,
        type: key,
        // 数量从突破表与逐级技能表合计（满级）；包里没有那一份时退回类别名，不编数
        num: num ? String(num) : label
      })
    }
    return out
  }

  if (input.game === "gs") {
    const own = input.detail.materials ?? {}
    for (const cfg of GS_MATS) {
      if (cfg.skipMain && input.isMain) continue
      const mat = deps.byName(own[cfg.key] ?? "")
      if (!mat) continue
      out.push({ label: mat.label, star: mat.star, icon: mat.icon, type: mat.type, num: cfg.num ?? mat.source })
    }
    return out
  }

  const own = srMaterials(input.detail, deps.byId)
  // 四星与开拓者走另一套份数。**按次计算、不改 SR_MATS**（就地改这张模块级表会让查过四星后每个五星拿到四星份数、不报错）
  const light = input.isMain || input.star === 4
  for (const cfg of SR_MATS) {
    const mat = deps.byName(own[cfg.key] ?? "")
    if (!mat) continue
    const alt = typeof cfg.alt === "function" ? cfg.alt(input.weapon) : cfg.alt
    out.push({
      label: mat.label,
      star: mat.star,
      icon: mat.icon,
      type: mat.type,
      num: (light ? alt : undefined) ?? cfg.num
    })
  }
  return out
}

/** 第三方统计站给的一份角色统计，字段名即接口给的那一套 */
export interface CharStatRaw extends Record<string, unknown> {
  /** 角色名；缺它说明这一份没查到，整块不出 */
  role?: string
  /** 平均命座 */
  avg_class?: number | string
  /** 常用武器 / 光锥 */
  weapon?: readonly { name?: string; rate?: number | string }[]
  /** 常用圣遗物 / 遗器套装，名字形如 `深林的记忆4` 或 `乐团2+翠绿2` */
  artifacts_set?: readonly { name?: string; rate?: number | string }[]
}

/** 图鉴上的一件常用武器 */
export interface StatWeapon {
  /** 全名 */
  name: string
  /** 简称 */
  abbr: string
  /** 图标，相对元数据根目录 */
  img: string
  /** 星级 */
  star: number
  /** 使用率，形如 `12.3%` */
  value: string
}

/** 图鉴上的一组常用圣遗物 */
export interface StatArti {
  /**
   * 逐套图标
   *
   * **可能混着两个根**：套装图在元数据里、「暂无套装」那格用插件自带的通用图；模板按「以 `meta-` 开头走 `_meta_path`、其余走 `_res_path`」挑（见 {@link OTHER_SET_IMG}）。
   */
  imgs: string[]
  /** 标题，形如 `深林4` 或 `乐团+翠绿` */
  title: string
  /** 使用率 */
  value: string
}

/** 第三方统计换算成视图时要查的两张表 */
export interface StatDeps {
  /** 按名称查武器 / 光锥 */
  weapon: (name: string) => { name: string; abbr: string; star: number; icon?: string } | undefined
  /** 按名称查圣遗物套装，返回简称与代表图 */
  artiSet: (name: string) => { abbr: string; img: string } | undefined
}

/** 第三方统计换算出的那四块 */
export interface CharStatView {
  /** 平均命座 */
  num: string
  /** 命座号（0~6）→ 持有率 */
  holding: Record<string, string>
  /** 使用率 */
  usage: { weapons: StatWeapon[]; artis: StatArti[] }
}

/**
 * 「暂无套装」那一格用的通用图
 *
 * **它在本插件资源里而非元数据里**，故不以 `meta-` 开头 —— 模板正是按这一点挑根目录的。
 */
const OTHER_SET_IMG = "common/item/artifact-icon.webp"

/**
 * 把百分比数值化成 `12.3%`
 * @param rate 接口给的数值
 * @returns 带百分号的文本
 */
function rateText(rate: number | string | undefined): string {
  return `${rate ?? 0}%`
}

/**
 * 第三方统计 → 视图
 *
 * **`role` 字段缺失即视为没查到**：统计站对未实装或刚上线的角色会返回一份空壳，
 * 那时那四块整块不该出现。
 * @param raw 接口给的一份统计
 * @param deps 要查的两张表
 * @returns 四块的视图；没查到时 undefined
 */
export function buildCharStat(raw: CharStatRaw | undefined, deps: StatDeps): CharStatView | undefined {
  if (!raw?.role) return undefined

  const holding: Record<string, string> = {}
  for (const at of [0, 1, 2, 3, 4, 5, 6]) holding[String(at)] = rateText(raw[`c${at}`] as number | undefined)

  const weapons: StatWeapon[] = []
  for (const one of raw.weapon ?? []) {
    const got = deps.weapon(one.name ?? "")
    weapons.push({
      // 查不到就用接口给的名字：统计站认得的新武器可能比本地元数据新
      name: got?.name ?? one.name ?? "",
      abbr: got?.abbr ?? one.name ?? "",
      img: got?.icon ?? "",
      star: got?.star ?? 0,
      value: rateText(one.rate)
    })
  }

  return { num: String(raw.avg_class ?? ""), holding, usage: { weapons, artis: statArtis(raw, deps) } }
}

/**
 * 把「常用圣遗物」那一列换算成逐套图标与标题
 *
 * 接口名字有三形态：`深林的记忆4`、`乐团2+翠绿2`、`暂无套装`。**只有单套时才把件数写进标题**，认不出套装名的那段整段丢掉。
 * @param raw 接口给的一份统计
 * @param deps 要查的两张表
 * @returns 逐组常用圣遗物
 */
function statArtis(raw: CharStatRaw, deps: StatDeps): StatArti[] {
  const out: StatArti[] = []
  for (const one of raw.artifacts_set ?? []) {
    const parts = (one.name ?? "").split("+")
    const imgs: string[] = []
    const abbrs: string[] = []
    for (const part of parts) {
      if (part === "暂无套装") {
        imgs.push(OTHER_SET_IMG)
        abbrs.push("其他")
        continue
      }
      const got = /([\s\S]*?)([24])/.exec(part)
      const set = got?.[1] ? deps.artiSet(got[1]) : undefined
      if (!set) continue
      imgs.push(set.img)
      abbrs.push(set.abbr + (parts.length === 1 ? (got?.[2] ?? "") : ""))
    }
    out.push({ imgs, title: abbrs.join("+"), value: rateText(one.rate) })
  }
  return out
}

/** 图鉴页上的角色基本信息，模板从 `data.*` 取 */
export interface CharWikiData extends Record<string, unknown> {
  /** 全名 */
  name: string
  /** 简称，那句「输入 #XX天赋」用它 */
  abbr: string
  /** 称号，星铁没有 */
  title: string
  /** 星级 */
  star: number
  /** 一句介绍，已折行，模板以 `{{@}}` 原样输出 */
  desc: string
  /** 武器类型键 / 命途，中文名取不到时模板回落到它 */
  weapon: string
  /** 武器类型中文名 */
  weaponTypeName: string
  /** 命之座名，星铁为空串 */
  astro: string
  /** 生日，星铁为空串 */
  birthday: string
  /** 归属 */
  allegiance: string
  /** 中文 CV */
  cncv: string
  /** 日文 CV */
  jpcv: string
  /** 属性中文名（绝区零：冰/电…），布局标题用 */
  elemName?: string
  /** 职业，绝区零独有（强攻/击破…） */
  prof?: string
  /** 伤害类型，绝区零独有（斩击/打击/穿透） */
  hit?: string
  /** 阵营，绝区零独有 */
  camp?: string
  /** 身高，绝区零独有 */
  stature?: string
}

/** 角色图鉴视图 */
export interface CharWikiView extends Record<string, unknown> {
  /** 游戏 */
  game: PanelGame
  /** 基本信息 */
  data: CharWikiData
  /** 基础属性与成长属性 */
  attr: { attr: AttrLine[]; growret: AttrLine[] }
  /** 整份详情，星铁的能量上限与介绍从这里取 */
  detail: WikiDetail
  /** 图标表 */
  imgs: CharImgs
  /** 突破材料 */
  materials: WikiMaterial[]
  /** 元素键 / 命途，布局按它取配色 */
  elem: string
  /** 平均命座；没有第三方统计时不出 */
  num?: string
  /** 命座持有率 */
  holding?: Record<string, string>
  /** 武器与圣遗物使用率 */
  usage?: { weapons: StatWeapon[]; artis: StatArti[] }
}

/**
 * 绝区零代理人的稀有度 → 图上按几星显示
 *
 * 游戏用 S / A 级，元数据的 `star` 存的是内部值（S=4、A=3）。图上沿用社区惯称的「五星 / 四星」，故按 `rank` 换算而非
 * 直接用 `star`——直接用会把 S 级代理人写成「4 星」。
 */
const ZZZ_RANK_STAR: Readonly<Record<string, number>> = { S: 5, A: 4, B: 3 }

/**
 * 角色的基本信息一栏
 * @param input 角色输入
 * @returns 模板要的 `data`
 */
function wikiData(input: WikiCharInput): CharWikiData {
  const d = input.detail
  return {
    name: input.name,
    abbr: input.abbr,
    title: d.title ?? "",
    // 绝区零按稀有度显示（S→5 星），其余游戏直接用星级
    star: input.game === "zzz" ? (ZZZ_RANK_STAR[d.rank ?? ""] ?? input.star) : input.star,
    // 绝区零 data.json 不带人物志长文，故 desc 空、身份改由下面几项承载
    desc: charDesc(d.desc ?? ""),
    weapon: input.weapon,
    weaponTypeName: weaponTypeName(input.game, input.weapon),
    astro: d.astro ?? "",
    birthday: birthdayOf(d.birth),
    allegiance: d.allegiance ?? "",
    cncv: d.cncv ?? "",
    jpcv: d.jpcv ?? "",
    // 绝区零专属身份项
    elemName: input.game === "zzz" ? input.elem : "",
    prof: d.prof ?? "",
    hit: d.hit ?? "",
    camp: d.camp ?? "",
    stature: d.stature ? `${d.stature}cm` : ""
  }
}

/**
 * 造角色图鉴视图
 *
 * `stat` 缺失时那四块整块不出现，理由见文件头。
 * @param input 角色输入
 * @param deps 查材料的两条路
 * @param stat 第三方统计换算出的四块；不接第三方源时不传
 * @returns 图鉴视图
 */
export function buildCharWiki(
  input: WikiCharInput,
  deps: WikiMaterialDeps,
  stat?: CharStatView
): CharWikiView {
  const view: CharWikiView = {
    game: input.game,
    data: wikiData(input),
    attr: charAttrList(input),
    detail: input.detail,
    imgs: input.imgs,
    materials: charMaterials(input, deps),
    elem: input.elem
  }
  if (stat) {
    view.num = stat.num
    view.holding = stat.holding
    view.usage = stat.usage
  }
  return view
}

/** 养成材料页视图 */
export interface CharMaterialView extends Record<string, unknown> {
  /** 游戏 */
  game: PanelGame
  /** 基本信息 */
  data: CharWikiData
  /** 基础属性与成长属性，已摊平成一维 */
  attr: AttrLine[]
  /** 整份详情 */
  detail: WikiDetail
  /** 图标表 */
  imgs: CharImgs
  /** 突破材料 */
  materials: WikiMaterial[]
  /** 元素键 / 命途 */
  elem: string
}

/**
 * 造养成材料页的视图
 *
 * 与图鉴页共用大半数据，区别在**不带第三方统计**、属性栏是摊平的一维数组（模板 `{{each attr ds}}` 直接遍历，传嵌套对象会让那栏整栏空白）。
 * @param input 角色输入
 * @param deps 查材料的两条路
 * @returns 养成材料页视图
 */
export function buildCharMaterialPage(input: WikiCharInput, deps: WikiMaterialDeps): CharMaterialView {
  const both = charAttrList(input)
  return {
    game: input.game,
    data: wikiData(input),
    attr: [...both.attr, ...both.growret],
    detail: input.detail,
    imgs: input.imgs,
    materials: charMaterials(input, deps),
    elem: input.elem
  }
}

/**
 * 养成材料页视图 → 纯文字
 * @param view 养成材料页视图
 * @returns 多行文本
 */
export function charMaterialText(view: CharMaterialView): string {
  const lines = [`${view.data.name} 养成材料`]
  if (view.attr.length) lines.push(view.attr.map(one => `${one.title} ${one.value}`).join(INDENT))
  if (view.materials.length) {
    for (const one of view.materials) lines.push(`${one.label}${one.num ? `${INDENT}${one.num}` : ""}`)
  } else {
    lines.push("暂无材料数据，元数据里没有这个角色的突破材料")
  }
  return lines.join("\n")
}

/**
 * 图鉴视图 → 纯文字
 *
 * 没有渲染器时用。介绍里的 `</br>` 换成换行 —— 那是折行标记，直接输出会露出标签。
 * @param view 图鉴视图
 * @returns 多行文本
 */
export function charWikiText(view: CharWikiView): string {
  const d = view.data
  const lines = [`${d.title ? `${d.title}·` : ""}${d.name}${d.star ? `${INDENT}${d.star} 星` : ""}`]
  const desc = d.desc.replaceAll("</br>", "\n")
  if (desc) lines.push(desc)

  const meta = [
    [view.game === "gs" ? "武器类型" : "光锥类型", d.weaponTypeName || d.weapon],
    ["命之座", d.astro],
    ["生日", d.birthday],
    ["归属", d.allegiance],
    ["中文CV", d.cncv],
    ["日文CV", d.jpcv]
  ].filter(([, value]) => !!value)
  for (const [title, value] of meta) lines.push(`${title}${INDENT}${value}`)

  const attrs = [...view.attr.attr, ...view.attr.growret]
  if (attrs.length) lines.push(attrs.map(one => `${one.title} ${one.value}`).join(INDENT))
  if (view.materials.length) {
    lines.push(`养成材料${INDENT}${view.materials.map(one => `${one.label}${one.num ? `(${one.num})` : ""}`).join("、")}`)
  }
  if (view.num) lines.push(`平均命座${INDENT}${view.num}`)
  const weapons = view.usage?.weapons ?? []
  if (weapons.length) {
    lines.push(`常用${view.game === "gs" ? "武器" : "光锥"}${INDENT}${weapons.slice(0, 7).map(one => `${one.abbr} ${one.value}`).join("、")}`)
  }
  const artis = view.usage?.artis ?? []
  if (artis.length) {
    lines.push(`常用${view.game === "gs" ? "圣遗物" : "遗器"}${INDENT}${artis.slice(0, 7).map(one => `${one.title} ${one.value}`).join("、")}`)
  }
  lines.push(`详细天赋与命座：#${d.abbr}天赋、#${d.abbr}命座`)
  return lines.join("\n")
}
