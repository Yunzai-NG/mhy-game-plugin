/**
 * 模块职责：天赋 / 命座页（`#胡桃天赋`、`#胡桃命座`、`%安比技能`、`%安比影画`）的视图模型
 * 依赖方向：纯函数，依赖 views/char-wiki 的属性折算与 views/panel 的格式化；不碰 IO
 * 生命周期：无状态
 * 注意事项：三游戏天赋形态不同、差别恰在「要不要代入数值」：原神 `desc` 已是切好的数组、`tables` 已是成品文本（直接铺）；星铁 `desc` 是带 `$1[i]%` 占位符的整句、`tables` 是对象且值是裸数字，故走 {@link talentDesc} 代入并把 `tables` 摊成数组（不摊则 `ds.tables.length>0` 恒假、整张表不出）。
 *          绝区零与原神同形（造包时已折成 meta-gs 形状），几乎不必分支，只页首基础数据另取一支。**代入等级按种类分两档**：普攻与两种记忆技用 5 级、其余 8 级（见 {@link LOW_LV_KEYS}，取同一级会越界）。**占位符先收齐再替换**（循环体里改写 desc 会让正则 lastIndex 落旧串上、跳过后面的）。
 */
import { comma } from "./panel.js"
import type { CharImgs } from "./panel.js"
import { INDENT } from "../core/text.js"
import type { WikiCharInput, WikiDetail } from "./char-wiki.js"
import { charAttrList, charDesc, treeSum } from "./char-wiki.js"
import { propName } from "../panel/prop/index.js"
import type { PanelGame } from "../panel/profile/index.js"
import { elemOf } from "../meta/elem.js"

/** 天赋等级最多到 15 级（原神的普攻带命座加成后可到 13，星铁的到 15） */
const MAX_TALENT_LV = 15

/**
 * 逐游戏的天赋等级上限
 *
 * **绝区零六个技能都只到 12 级**，按 15 列画会每行末三格恒空、把整张图撑宽近两成（这页本就是全仓库最大的一张，图越大越易发送侧超时，见 commands/wiki.ts）。
 */
const TALENT_MAX_LV: Readonly<Record<PanelGame, number>> = { gs: MAX_TALENT_LV, sr: MAX_TALENT_LV, zzz: 12 }

/**
 * 星铁天赋页的成长属性标题
 *
 * **与图鉴页那份（`GROW_ATTR_NAME`）刻意不同**：暴击一栏这里叫「暴击率」、图鉴页叫「暴击」，两页各按自己的叫法。
 */
const SR_LINE_ATTR: Readonly<Record<string, string>> = {
  atk: "大攻击",
  def: "大防御",
  hp: "大生命",
  speed: "速度",
  cpct: "暴击率",
  cdmg: "暴击伤害",
  recharge: "充能效率",
  heal: "治疗加成",
  stance: "击破特攻",
  effPct: "效果命中",
  effDef: "效果抵抗",
  elation: "欢愉度"
}

/** 星铁基础数据一栏的四项与标题（**速度这一项不带「基础」二字**） */
const SR_BASE_LINE: readonly [string, string][] = [
  ["hp", "基础生命"],
  ["atk", "基础攻击"],
  ["def", "基础防御"],
  ["speed", "速度"]
]

/** 用 5 级数值代入描述的天赋键，其余用 8 级 */
const LOW_LV_KEYS: readonly string[] = ["a", "a2", "me", "me2", "mt", "mt1", "mt2"]

/** 基础数据一栏的一格 */
export interface LineItem {
  /** 数值 */
  num: string
  /** 标题 */
  label: string
}

/** 一张天赋数值表 */
export interface TalentTable {
  /** 表名 */
  name: string
  /** 单位，原神独有 */
  unit?: string
  /** 逐级同值时为真，模板把它挪到表外单列一行 */
  isSame?: boolean
  /** 逐级数值，已格式化 */
  values: string[]
}

/** 元数据里一条天赋 / 命座 / 行迹的原样形态 */
export interface RawTalent extends Record<string, unknown> {
  /** 名称 */
  name?: string
  /** 描述；原神是数组，星铁是一整句 */
  desc?: string | string[]
  /** 数值表；原神是数组，星铁是对象 */
  tables?: unknown
}

/** 星铁数值表里的一行 */
interface RawSrTable {
  /** 表名 */
  name?: string
  /** 逐级同值时为真 */
  isSame?: boolean
  /** 逐级裸数值 */
  values?: readonly (number | string)[]
}

/**
 * 百分比格式化
 *
 * 先乘一百再带百分号（星铁数值表存的是 `1.1` 这样的倍率，直接显示会变「攻击力 1.1%」）。
 * @param num 倍率
 * @param fix 小数位数
 * @returns 形如 `110.0%`
 */
export function percent(num: number | string, fix = 1): string {
  const value = Number(num)
  return `${(Number.isFinite(value) ? value * 100 : 0).toFixed(fix)}%`
}

/**
 * 把描述里的 `$N[i]%` 占位符换成某一级的实际数值，并把数值表摊成数组
 *
 * 三条口径：**取不到数值（含为 0）时占位符原样留着**（露出 `$4[i]`，比换成 0 好）；**代入的值缀 ` (lvN)`**；**未被描述引用的表按千分位格式化**（只有被 `%` 占位符引用过的才按百分比）。
 * @param desc 原始描述
 * @param tables 星铁的数值表，键为占位符里的序号
 * @param lv 代入第几级
 * @returns 折行后的描述与摊平的数值表
 */
export function talentDesc(
  desc: string,
  tables: Readonly<Record<string, RawSrTable>> | undefined,
  lv = 5
): { desc: string[]; tables: TalentTable[] } {
  const idxFormat: Record<string, "percent" | "comma"> = {}
  let out = desc

  // 先从原串收齐全部占位符再逐个替换，理由见文件头
  for (const got of [...desc.matchAll(/\$(\d)\[(i|f1|f2)](%?)/g)]) {
    const [all, idx = "", format = "", pct = ""] = got
    const raw = tables?.[idx]?.values?.[lv - 1]
    if (!raw) continue
    let value: string
    if (pct === "%") {
      idxFormat[idx] = "percent"
      value = percent(raw, format === "f2" ? 2 : 1)
    } else {
      idxFormat[idx] = "comma"
      value = comma(Number(raw))
    }
    out = out.replaceAll(all, `${value} (lv${lv})`)
  }

  const flat: TalentTable[] = []
  for (const [idx, ds] of Object.entries(tables ?? {})) {
    const one: TalentTable = {
      name: ds.name ?? "",
      values: (ds.values ?? []).map(v =>
        ds.isSame ? String(v) : idxFormat[idx] === "percent" ? percent(v) : comma(Number(v))
      )
    }
    if (ds.isSame) one.isSame = true
    flat.push(one)
  }
  return { desc: out.split("<br>"), tables: flat }
}

/**
 * 原神描述里要着元素色的词
 *
 * 游戏内这些词带 `<color>`，造包时被剥掉了，故按字面补回。只认「X元素」打头的（并列写法逐个着色）；「元素战技」「元素精通」「物理伤害」游戏内本是白字，不在其列。
 */
const GS_ELEM_WORD = /([火水风雷草冰岩])元素(?:伤害加成|伤害|抗性)?/g

/**
 * 绝区零 `<nobr>` 开头的属性名 → 元素色类（`.e-*`）
 *
 * 包里只把高亮的词裹进 `<nobr>`、不带颜色，故按开头补色类；数值与「[强击]」一类状态不在表里，只按高亮色印。烈霜、玄墨、凄刃是冰、以太、物理的分支，同色。
 */
const ZZZ_ELEM_CLASS: Readonly<Record<string, string>> = {
  物理: "physical",
  凄刃: "physical",
  火: "fire",
  冰: "ice",
  烈霜: "ice",
  电: "electric",
  以太: "ether",
  玄墨: "ether",
  风: "wind"
}

/** 绝区零 `<nobr>` 里的属性名，要紧跟「属性 / 伤害 / 异常」才算（免得「电量」一类误中） */
const ZZZ_ELEM_HEAD = new RegExp(`^(${Object.keys(ZZZ_ELEM_CLASS).join("|")})(?=属性|伤害|异常)`)

/**
 * 转义 HTML 特殊字符
 * @param text 纯文字
 * @returns 可直接拼进 HTML 的串
 */
function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

/**
 * 原神的一行描述 → 段落
 *
 * 以 `<` 开头的（`<h3>` 小标题、`<i>` 技能故事）原样留着；纯文字转义后给元素词挂色类、包成 `<p>`。
 * @param line 一行描述
 * @returns 模板可原样输出的 HTML；空行仍是空串
 */
function markGsLine(line: string): string {
  if (line === "" || line.startsWith("<")) return line
  const body = escapeHtml(line).replace(
    GS_ELEM_WORD,
    (word, head: string) => `<span class="wk-el e-${elemOf(head, "", "gs")}">${word}</span>`
  )
  return `<p>${body}</p>`
}

/**
 * 绝区零的一行描述：给裹着属性名的 `<nobr>` 挂元素色类
 * @param line 一行描述
 * @returns 改写后的一行
 */
function markZzzLine(line: string): string {
  return line.replace(/<nobr>([^<]*)<\/nobr>/g, (all, inner: string) => {
    const head = ZZZ_ELEM_HEAD.exec(inner)?.[1]
    const cls = head ? ZZZ_ELEM_CLASS[head] : undefined
    return cls ? `<nobr class="wk-el e-${cls}">${inner}</nobr>` : all
  })
}

/**
 * 逐行改写天赋、命座、固有天赋三段的描述，返回副本
 *
 * 只动 `desc`，故事文案 `story` 不着色。
 * @param detail 整份 `data.json`
 * @param mark 一行的改写
 * @returns 副本
 */
function markDetail(detail: WikiDetail, mark: (line: string) => string): WikiDetail {
  const markOne = (raw: RawTalent): RawTalent => (Array.isArray(raw.desc) ? { ...raw, desc: raw.desc.map(mark) } : raw)
  const out: Record<string, unknown> = { ...detail }
  for (const key of ["talent", "cons", "passive"] as const) {
    const section = detail[key]
    if (typeof section !== "object" || section === null) continue
    out[key] = Array.isArray(section)
      ? section.map(raw => markOne(raw as RawTalent))
      : Object.fromEntries(Object.entries(section as Record<string, RawTalent>).map(([idx, raw]) => [idx, markOne(raw)]))
  }
  return out as WikiDetail
}

/**
 * 把天赋 / 命座 / 行迹描述处理成模板能铺的形态
 *
 * 星铁的天赋走 {@link talentDesc}（要代入数值），命座与行迹只按 `<br>` 折行；原神与绝区零只给描述行着色（见 {@link GS_ELEM_WORD}、{@link ZZZ_ELEM_CLASS}）。**不改原对象**（装载器缓存复用，改了会污染后续每次查询）。
 * @param detail 整份 `data.json`
 * @param game 游戏
 * @returns 处理过的副本
 */
export function prepareDetail(detail: WikiDetail, game: PanelGame): WikiDetail {
  if (game === "gs") return markDetail(detail, markGsLine)
  if (game === "zzz") return markDetail(detail, markZzzLine)

  // 用宽类型改写：`treeData` 声明的是带 cost 的行迹节点，而这一步要往里放已折行的描述、字段对不上
  const out: Record<string, unknown> = { ...detail }
  for (const key of ["cons", "talent", "treeData"] as const) {
    const section = detail[key]
    if (typeof section !== "object" || section === null) continue

    const copy: Record<string, RawTalent> = {}
    for (const [idx, raw] of Object.entries(section as Record<string, RawTalent>)) {
      const one: RawTalent = { ...raw }
      if (typeof one.desc === "string") {
        if (key === "talent") {
          const got = talentDesc(one.desc, one.tables as Record<string, RawSrTable> | undefined, lvOf(idx))
          one.desc = got.desc
          one.tables = got.tables
        } else {
          one.desc = one.desc.split("<br>")
        }
      }
      copy[idx] = one
    }
    out[key] = copy
  }
  return out as WikiDetail
}

/**
 * 一个天赋键该代入第几级
 * @param key 天赋键
 * @returns 5 或 8
 */
export function lvOf(key: string): number {
  return LOW_LV_KEYS.includes(key) ? 5 : 8
}

/**
 * 页首那一栏基础数据
 *
 * 原神复用 {@link charAttrList}；星铁分两行（上行四项基础属性、下行能量上限与逐项行迹加成）；绝区零那份造包时已算好（按键序摊开、标题交给 panel/prop，值是串原样印、是数字按千分位）。
 * @param input 角色输入
 * @returns 原神与绝区零给一维数组，星铁给两组
 */
export function talentLine(input: WikiCharInput): LineItem[] | { ret: LineItem[]; growret: LineItem[] } {
  if (input.game === "gs") {
    return charAttrList(input).attr.map(one => ({ num: one.value, label: one.title }))
  }

  if (input.game === "zzz") {
    const out: LineItem[] = []
    for (const [key, value] of Object.entries(input.detail.baseAttr ?? {})) {
      const label = propName("zzz", key)
      if (!label) continue
      out.push({ num: typeof value === "string" ? value : comma(Number(value)), label })
    }
    return out
  }

  const base = input.detail.baseAttr ?? {}
  const ret: LineItem[] = []
  for (const [key, label] of SR_BASE_LINE) {
    if (base[key] === undefined) continue
    ret.push({ num: comma(Number(base[key]), 1), label })
  }
  const growret: LineItem[] = []
  for (const [key, value] of Object.entries(treeSum(input.detail.tree))) {
    growret.push({ num: comma(value, 1), label: SR_LINE_ATTR[key] ?? `${input.elem}伤` })
  }
  return { ret, growret }
}

/**
 * 绝区零页首那一句
 *
 * 包里没有现成的一句介绍（人物志长文刻意不落盘），故用身份那几项凑一行：全名在上、
 * 属性与职业、伤害类型、阵营在下。
 * @param input 角色输入
 * @returns 已折行的一句
 */
function zzzIntro(input: WikiCharInput): string {
  const detail = input.detail
  const line = [input.elem ? `${input.elem}属性` : "", detail.prof ?? "", detail.hit ?? "", detail.camp ?? ""]
    .filter(one => one)
    .join("　")
  const full = detail.fullName && detail.fullName !== input.name ? detail.fullName : ""
  return [full, line].filter(one => one).join("<br>")
}

/**
 * 这一页的标题词
 * @param game 游戏
 * @param mode 画天赋还是命座
 * @returns 「天赋」「技能」「命之座」「星魂」「意象影画」之一
 */
export function talentTitle(game: PanelGame, mode: "talent" | "cons"): string {
  if (mode === "talent") return game === "zzz" ? "技能" : "天赋"
  if (game === "sr") return "星魂"
  return game === "zzz" ? "意象影画" : "命之座"
}

/** 天赋 / 命座页视图 */
export interface CharTalentView extends Record<string, unknown> {
  /** 游戏 */
  game: PanelGame
  /** 这一页画天赋还是命座 */
  mode: "talent" | "cons"
  /** 全名 */
  name: string
  /** 称号，星铁为空串 */
  title: string
  /** 简称 */
  abbr: string
  /** 一句介绍，已折行；星铁的从 `detail.desc` 取 */
  desc: string
  /** 处理过的详情 */
  detail: WikiDetail
  /** 图标表 */
  imgs: CharImgs
  /** 等级表头，`Lv1` ~ `Lv15` */
  lvs: string[]
  /** 页首那一栏基础数据 */
  line: LineItem[] | { ret: LineItem[]; growret: LineItem[] }
  /** 元素键 / 命途，布局按它取配色 */
  elem: string
  /**
   * 天赋 / 命座图标垫的那张元素框（`resources/common/bg/talent-<这个>.webp`）；绝区零为空串、不垫框
   *
   * **由视图给、不靠 `<body>` 上的元素类**：本族的 skin 布局不挂 `elem-xxx`，按 `<body>` 元素类写的选择器永远命不中。
   */
  frame: string
}

/**
 * 归一后的元素键 → 元素框图名
 *
 * 星铁没有自己的七张框：火冰风雷用原神那四张、虚数借岩、物理用通用那张 `talent-sr`。
 */
const FRAME_OF: Readonly<Record<string, string>> = {
  pyro: "pyro",
  cryo: "cryo",
  anemo: "anemo",
  electro: "electro",
  geo: "geo",
  hydro: "hydro",
  dendro: "dendro",
  fire: "pyro",
  ice: "cryo",
  wind: "anemo",
  elec: "electro",
  quantum: "quantum",
  imaginary: "geo",
  phy: "sr"
}

/**
 * 取这一页图标垫的元素框
 * @param game 游戏
 * @param elem 元数据里的元素
 * @returns 框图名；绝区零或认不出时空串
 */
export function talentFrameOf(game: PanelGame, elem: string): string {
  if (game === "zzz") return ""
  return FRAME_OF[elemOf(elem, "", game)] ?? ""
}

/**
 * 造天赋 / 命座页视图
 * @param input 角色输入
 * @param mode 画天赋还是命座
 * @returns 视图
 */
export function buildCharTalent(input: WikiCharInput, mode: "talent" | "cons"): CharTalentView {
  return {
    game: input.game,
    mode,
    name: input.name,
    title: input.detail.title ?? "",
    abbr: input.abbr,
    // 绝区零的包里没有一句现成的介绍，故用身份那几项凑一行
    desc: input.game === "zzz" ? zzzIntro(input) : charDesc(input.detail.desc ?? ""),
    detail: prepareDetail(input.detail, input.game),
    imgs: input.imgs,
    lvs: Array.from({ length: TALENT_MAX_LV[input.game] ?? MAX_TALENT_LV }, (_unused, at) => `Lv${at + 1}`),
    line: talentLine(input),
    elem: input.elem,
    frame: talentFrameOf(input.game, input.elem)
  }
}

/**
 * 天赋 / 命座页视图 → 纯文字
 *
 * 没有渲染器时用。**只列名字，不铺描述与数值表**（一个角色六命座加三天赋展开有两千字，是一堵墙，要细节就出图）。
 * @param view 视图
 * @returns 多行文本
 */
export function charTalentText(view: CharTalentView): string {
  const section = view.detail[view.mode === "cons" ? "cons" : "talent"]
  const lines = [`${view.name} ${talentTitle(view.game, view.mode)}`]

  const entries = typeof section === "object" && section !== null ? Object.entries(section) : []
  for (const [key, raw] of entries) {
    const one = raw as RawTalent
    if (!one?.name) continue
    // 绝区零技能键是英文（`basic` 一类）、印出来是噪声，故那一路只列名字；影画层数与命座同形、只是量词不同
    if (view.mode === "cons") lines.push(`${key} ${view.game === "zzz" ? "影" : "命"}${INDENT}${one.name}`)
    else if (view.game === "zzz") lines.push(one.name)
    else lines.push(`${key}${INDENT}${one.name}`)
  }
  if (entries.length === 0) lines.push("元数据里没有这个角色的详细数据，请发送「#更新元数据」")
  else lines.push("出图才看得到描述与逐级数值，当前渲染器不可用")
  return lines.join("\n")
}
