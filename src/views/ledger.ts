/**
 * 模块职责：札记 / 开拓月历的视图模型与月份解析
 * 依赖方向：纯函数，依赖 region / text；不碰 IO
 * 生命周期：无状态
 * 注意事项：原神与星铁字段名整套不同（`current_primogems` 对 `current_hcoin`）、月份参数形态也不同（原神 `8`、星铁 `202608`），差异全收敛在本文件、命令层只说「查哪个月」。
 *          米游社仅保留最近三个月，该规则表达为 {@link resolveMonth} 的显式结果（命令层据此明确告知「只能查最近三个月」）。绝区零无札记接口、本文件不涉及。
 */
import type { GameKey } from "../core/region.js"
import { GAME_NAMES, REGION_NAMES, resolveRegionKind } from "../core/region.js"
import { cnDate, INDENT, weekOf } from "../core/text.js"
import type { MetaLoader } from "../meta/loader.js"

/** 收入来源的一片 */
export interface LedgerSlice {
  /** 来源名 */
  label: string
  /** 数量 */
  num: number
  /** 占比，0~100 */
  percent: number
}

/** 一项货币的本月与上月 */
export interface LedgerAmount {
  /** 货币名 */
  label: string
  /** 本月 */
  current: number
  /** 上月 */
  last: number
  /** 与上月的差值，正数表示高于上月 */
  delta: number
}

/** 札记视图 */
export interface LedgerView {
  /** 游戏 */
  game: GameKey
  /** 游戏中文名 */
  gameName: string
  /** uid */
  uid: string
  /** 区服中文名 */
  region: string
  /** 查询者昵称 */
  name: string
  /** 月份说明，如 `8 月` */
  month: string
  /** 抽卡货币（原石 / 星琼） */
  primary: LedgerAmount
  /** 通用货币（摩拉 / 列车票） */
  secondary: LedgerAmount
  /** 本月抽卡货币折算的抽数 */
  gacha: number
  /** 今日收入 */
  today: {
    /** 抽卡货币 */
    primary: number
    /** 通用货币 */
    secondary: number
  }
  /** 收入来源分布，已按数量降序 */
  slices: LedgerSlice[]
}

/** 札记接口的原始字段（两个游戏合并成一份可选字段表） */
export interface LedgerRaw {
  /** 数据所属月份，原神为 `8`，星铁为 `202608` */
  data_month?: number | string
  /** 本月与上月汇总 */
  month_data?: {
    /** 本月原石 */
    current_primogems?: number
    /** 上月原石 */
    last_primogems?: number
    /** 本月摩拉 */
    current_mora?: number
    /** 上月摩拉 */
    last_mora?: number
    /** 本月星琼 */
    current_hcoin?: number
    /** 上月星琼 */
    last_hcoin?: number
    /** 本月列车票 */
    current_rails_pass?: number
    /** 上月列车票 */
    last_rails_pass?: number
    /** 收入来源分布 */
    group_by?: {
      /** 来源标识 */
      action?: string
      /** 来源名，星铁返回的为该字段 */
      action_name?: string
      /** 来源编号，原神返回的为该字段；配色按其取下标 */
      action_id?: number
      /** 数量 */
      num?: number
      /** 占比 */
      percent?: number
    }[]
  }
  /** 今日汇总 */
  day_data?: {
    /** 今日原石 */
    current_primogems?: number
    /** 今日摩拉 */
    current_mora?: number
    /** 今日星琼 */
    current_hcoin?: number
    /** 今日列车票 */
    current_rails_pass?: number
  }
}

/** 各游戏的货币名与字段名 */
const CURRENCY: Readonly<
  Record<"gs" | "sr", { primary: string; secondary: string; primaryKey: string; secondaryKey: string }>
> = {
  gs: { primary: "原石", secondary: "摩拉", primaryKey: "primogems", secondaryKey: "mora" },
  sr: { primary: "星琼", secondary: "列车票", primaryKey: "hcoin", secondaryKey: "rails_pass" }
}

/** 单抽所需数量，用于将原石 / 星琼折算为可抽次数 */
const PULL_COST = 160

/** 中文数字月份，`#一月札记` 一类写法在群聊中较为常见 */
const CN_MONTH = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"] as const

/** 月份解析结果 */
export interface MonthPick {
  /** 是否可查 */
  ok: boolean
  /** 传给接口的月份参数 */
  param?: string | number
  /** 月份数字，1~12 */
  month?: number
  /** 展示用说明，如 `8 月` */
  label?: string
  /** 不可查时的原因 */
  message?: string
}

/**
 * 将使用者填写的月份解析为接口参数
 *
 * 接受留空（本月）、`8`、`八` 三种写法；米游社仅保留最近三个月、超范围直接给说明而不发必然失败的请求。
 * @param text 命令中剩余的文本
 * @param game 游戏
 * @param now 当前时间，测试注入
 * @returns 解析结果
 */
export function resolveMonth(text: string, game: GameKey, now: number = Date.now()): MonthPick {
  const d = new Date(now)
  const thisMonth = d.getMonth() + 1
  const want = text.replace(/[#月札记原石星琼开拓历\s]/g, "")
  let month = thisMonth
  if (want) {
    const cn = CN_MONTH.indexOf(want as (typeof CN_MONTH)[number])
    const parsed = cn >= 0 ? cn + 1 : Number(want)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
      return { ok: false, message: "无法识别月份，请使用「#8月札记」，或直接发送「#札记」查询本月" }
    }
    month = parsed
  }

  // 最近三个月：本月与前两个月；跨年时回退至上一年
  const allowed = [0, 1, 2].map(back => ((thisMonth - 1 - back + 12) % 12) + 1)
  if (!allowed.includes(month)) {
    return { ok: false, message: `札记仅保留最近三个月，可查询的月份为 ${allowed.reverse().join("、")} 月` }
  }

  const year = month > thisMonth ? d.getFullYear() - 1 : d.getFullYear()
  return {
    ok: true,
    month,
    label: `${month} 月`,
    // 星铁需 `202608` 形态，原神仅需月份数字
    param: game === "sr" ? `${year}${String(month).padStart(2, "0")}` : month
  }
}

/** 造札记视图时的上下文 */
export interface LedgerContext {
  /** 游戏 */
  game: GameKey
  /** uid */
  uid: string
  /** 查询者昵称 */
  name: string
  /** 月份说明，取自 {@link MonthPick.label} */
  month: string
}

/**
 * 取数字，非法取值一律视为 0
 * @param value 原始值
 * @returns 数字
 */
function num(value: unknown): number {
  const out = typeof value === "string" ? Number(value) : value
  return typeof out === "number" && Number.isFinite(out) ? out : 0
}

/**
 * 按数量重算各项占比
 *
 * 不用接口给的 `percent`：它与饼图按 `num` 现算的取整口径不同，且数量为 0 的项也会给出 1%，图例与饼图因此对不上。
 * @param nums 各项数量
 * @returns 各项占比，取整到个位；总数为 0 时全为 0
 */
function percentsOf(nums: readonly number[]): number[] {
  const total = nums.reduce((sum, one) => sum + one, 0)
  return nums.map(one => (total > 0 ? Math.round((one / total) * 100) : 0))
}

/**
 * 从月度汇总中取一项货币
 *
 * 两游戏字段名整套不同，故按 `current_${key}`/`last_${key}` 拼接、不写两份分支。
 * @param month_data 月度汇总
 * @param label 货币名
 * @param key 字段名主干，如 `primogems`
 * @returns 本月、上月与差值
 */
function amount(month_data: Record<string, unknown> | undefined, label: string, key: string): LedgerAmount {
  const current = num(month_data?.[`current_${key}`])
  const last = num(month_data?.[`last_${key}`])
  return { label, current, last, delta: current - last }
}

/**
 * 札记原始数据 → 视图
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @returns 视图
 */
export function buildLedger(raw: LedgerRaw, ctx: LedgerContext): LedgerView {
  const money = CURRENCY[ctx.game === "sr" ? "sr" : "gs"]
  const month_data = raw.month_data as Record<string, unknown> | undefined
  const day_data = raw.day_data as Record<string, unknown> | undefined
  const primary = amount(month_data, money.primary, money.primaryKey)
  const secondary = amount(month_data, money.secondary, money.secondaryKey)

  // 米游社返回的 group_by 顺序并不稳定，此处按数量排序一次，使首行即可反映主要来源
  const list = raw.month_data?.group_by ?? []
  const pcts = percentsOf(list.map(it => num(it.num)))
  const slices: LedgerSlice[] = list
    .map((it, idx) => ({ label: it.action_name ?? it.action ?? "其他", num: num(it.num), percent: pcts[idx] ?? 0 }))
    .sort((a, b) => b.num - a.num)

  return {
    game: ctx.game,
    gameName: GAME_NAMES[ctx.game],
    uid: ctx.uid,
    region: REGION_NAMES[resolveRegionKind(ctx.uid, ctx.game)],
    name: ctx.name,
    month: ctx.month,
    primary,
    secondary,
    gacha: Math.floor(primary.current / PULL_COST),
    today: {
      primary: num(day_data?.[`current_${money.primaryKey}`]),
      secondary: num(day_data?.[`current_${money.secondaryKey}`])
    },
    slices
  }
}

/**
 * 札记视图 → 纯文字
 *
 * 与 {@link LedgerView} 同序：先给出本月总数与折算抽数（使用者最主要关注的数值），
 * 再给出与上月的比较，最后为来源明细。
 * @param view 视图
 * @returns 多行文本
 */
export function ledgerText(view: LedgerView): string {
  const sign = (n: number): string => (n >= 0 ? `多 ${n}` : `少 ${-n}`)
  const lines = [
    `${view.gameName} ${view.uid}（${view.region}）${view.month}`,
    `${view.primary.label} ${view.primary.current}，约 ${view.gacha} 抽`,
    `${INDENT}比上月${sign(view.primary.delta)}`,
    `${view.secondary.label} ${view.secondary.current}`,
    `${INDENT}比上月${sign(view.secondary.delta)}`,
    `今日 ${view.primary.label} ${view.today.primary}、${view.secondary.label} ${view.today.secondary}`
  ]
  if (view.slices.length) {
    lines.push(`${view.primary.label}来源`)
    for (const it of view.slices) lines.push(`${INDENT}${it.label} ${it.num}（${it.percent}%）`)
  }
  return lines.join("\n")
}

/**
 * 饼图各扇区的配色，按来源编号取下标
 *
 * 配色不可随意更换（使用者对「深渊蓝、活动紫」已形成认知）。
 */
const SLICE_COLORS = [
  "#73a9c6",
  "#d56565",
  "#70b2b4",
  "#bd9a5a",
  "#739970",
  "#7a6da7",
  "#597ea0",
  "#ffb6c1"
] as const

/** 星铁的来源标识 → 编号，其接口不给 `action_id`，配色靠这张表折算 */
const SR_ACTIONS: Readonly<Record<string, number>> = {
  other: 0,
  adventure_reward: 1,
  space_reward: 2,
  daily_reward: 3,
  abyss_reward: 4,
  mail_reward: 5,
  event_reward: 6,
  combat_reward: 7
}

/**
 * 原神札记图右上角的角色卡，随机取一张
 *
 * 这二十四张随插件提交在 `resources/gs/ledger/icon/`；元数据里有同样这二十四个角色的头像且小得多，故 {@link ledgerIcon} 优先取元数据、取不到才回落这份（不能反过来一律取元数据，元数据缺省不装）。
 */
const GS_LEDGER_ICONS = [
  "七七",
  "丽莎",
  "凝光",
  "凯亚",
  "刻晴",
  "北斗",
  "可莉",
  "安柏",
  "温迪",
  "班尼特",
  "琴",
  "砂糖",
  "芭芭拉",
  "莫娜",
  "菲谢尔",
  "行秋",
  "诺艾尔",
  "达达利亚",
  "迪卢克",
  "迪奥娜",
  "重云",
  "阿贝多",
  "雷泽",
  "香菱"
] as const

/**
 * 星铁开拓月历图的角标 —— 元数据缺失时的兜底
 *
 * 本该是角色头像、装了元数据即按名字取；没装则退回这张 logo。
 */
const SR_LEDGER_ICON = "sr/other/logo.png"

/** 星铁月历角标取哪个角色：在这几个开局角色里随机取（人人都有、不缺图） */
const SR_LEDGER_CHARS = ["三月七", "丹恒", "姬子", "瓦尔特"] as const

/** 一张角标：路径 + 它相对哪个根 */
export interface LedgerIcon {
  /** 路径 */
  path: string
  /** 为真时相对元数据根（`_meta_path`），否则相对插件资源根（`_res_path`） */
  fromMeta: boolean
}

/**
 * 取札记图的角标
 *
 * **有元数据用元数据、没有回落提交那份**。两者不同根，故一并返回它相对哪个根（模板据此选前缀）。
 * @param game 游戏
 * @param pick 随机数，测试注入
 * @param meta 元数据装载器；省略即视为没装元数据
 * @returns 角标路径与它的根
 */
function ledgerIcon(game: GameKey, pick: number, meta?: MetaLoader): LedgerIcon {
  if (game === "sr") {
    const name = SR_LEDGER_CHARS[Math.floor(pick * SR_LEDGER_CHARS.length)] ?? SR_LEDGER_CHARS[0]
    const face = meta?.byName("sr", name)?.face
    // 这一格画的就是角色头像，装了元数据即可取到
    if (face) return { path: face, fromMeta: true }
    return { path: SR_LEDGER_ICON, fromMeta: false }
  }

  const name = GS_LEDGER_ICONS[Math.floor(pick * GS_LEDGER_ICONS.length)] ?? GS_LEDGER_ICONS[0]
  const face = meta?.byName("gs", name)?.face
  if (face) return { path: face, fromMeta: true }
  return { path: `gs/ledger/icon/${name}.png`, fromMeta: false }
}

/**
 * 算角标要传给模板的两个字段
 *
 * 调用方显式给了 `icon` 时按"相对插件资源根"处理 —— 那是既有调用方（与测试）的约定。
 * @param game 游戏
 * @param pick 随机数
 * @param extra 调用方给的附加项
 * @returns 含 `icon` 与 `iconFromMeta` 两个键的片段
 */
function iconFields(
  game: GameKey,
  pick: number,
  extra: { icon?: string; meta?: MetaLoader }
): { icon: string; iconFromMeta: boolean } {
  if (extra.icon !== undefined) return { icon: extra.icon, iconFromMeta: false }
  const got = ledgerIcon(game, pick, extra.meta)
  return { icon: got.path, iconFromMeta: got.fromMeta }
}

/** 传给既有模板的一份数据 */
export type TemplateData = Record<string, unknown>

/** 两个游戏的札记模板名，与 `templates/ledger/` 下的文件同名 */
export const LEDGER_TEMPLATES: Readonly<Record<"gs" | "sr", string>> = {
  gs: "gs/ledger",
  sr: "sr/ledger"
}

/**
 * 超过一万时折成 "1.23 w"
 *
 * 模板数字格子按四字宽排版，六位数会撑破格子。
 * @param value 原始数值
 * @param digits 小数位
 * @returns 折算后的字符串或原数值
 */
function fold(value: number, digits: number): number | string {
  return value > 10_000 ? `${(value / 10_000).toFixed(digits)} w` : value
}

/** 札记图上「本月 / 上月」对比的一行 */
export interface LedgerCmpRow {
  /** 货币名 */
  label: string
  /** 图标，插件资源里的相对路径 */
  icon: string
  /** 本月，已折算 */
  now: number | string
  /** 上月，已折算 */
  last: number | string
  /** 本月比上月，带正负号与百分号；上月为 0 时空串 */
  rate: string
  /** 增减方向：`up` / `dn` / 空串（持平） */
  dir: string
  /** 两条进度条的长度，0~100，按两者中较大的一边归一 */
  nowBar: number
  /** 同上，上月那条 */
  lastBar: number
}

/** 两种货币的图标，`resources/` 下的相对路径 */
const CURRENCY_ICON: Readonly<Record<"gs" | "sr", readonly [string, string]>> = {
  gs: ["gs/ledger/原石.png", "gs/ledger/摩拉.png"],
  sr: ["sr/other/星琼.png", "sr/other/rails_pass.png"]
}

/**
 * 「本月 / 上月」对比的两行
 *
 * 比的是接口原值，故要在 {@link fold} 改写之前取。本月未过完，比上月少是常态，模板据 `dir`
 * 着色而不另下结论。
 * @param md 接口的 `month_data`
 * @param game 游戏
 * @returns 两行，抽卡货币在前
 */
function ledgerCmp(md: Readonly<Record<string, unknown>>, game: "gs" | "sr"): LedgerCmpRow[] {
  const money = CURRENCY[game]
  const keys = [
    [money.primary, money.primaryKey, 2],
    [money.secondary, money.secondaryKey, 1]
  ] as const
  return keys.map(([label, key, digits], idx) => {
    const now = num(md[`current_${key}`])
    const last = num(md[`last_${key}`])
    const top = Math.max(now, last, 1)
    const rate = last > 0 ? Math.round(((now - last) / last) * 100) : 0
    return {
      label,
      icon: CURRENCY_ICON[game][idx] ?? "",
      now: fold(now, digits),
      last: fold(last, digits),
      rate: last > 0 ? `${rate > 0 ? "+" : ""}${rate}%` : "",
      dir: last <= 0 || rate === 0 ? "" : rate > 0 ? "up" : "dn",
      nowBar: Math.round((now / top) * 100),
      lastBar: Math.round((last / top) * 100)
    }
  })
}

/**
 * 札记原始数据 → 既有模板所需的数据
 *
 * 模板读接口原字段，故整份 raw 原样透传，另补 `gacha`/`last_gacha` 折算抽数、各扇区配色，以及供 g2plot 用的 `group_by`/`color` 两个 JSON 串。
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @param extra 原神模板另需的游戏内昵称，以及取角标用的元数据装载器
 * @param now 当前时间，测试注入
 * @param pick 角标随机数，测试注入
 * @returns 模板数据
 */
export function ledgerTemplateData(
  raw: LedgerRaw,
  ctx: LedgerContext,
  extra: { nickname?: string; icon?: string; meta?: MetaLoader } = {},
  now: number = Date.now(),
  pick: number = Math.random()
): TemplateData {
  const sr = ctx.game === "sr"
  const money = CURRENCY[sr ? "sr" : "gs"]
  const md = { ...(raw.month_data ?? {}) } as Record<string, unknown>
  const dd = { ...(raw.day_data ?? {}) } as Record<string, unknown>

  const cmp = ledgerCmp(md, sr ? "sr" : "gs")
  const current = num(md[`current_${money.primaryKey}`])
  const last = num(md[`last_${money.primaryKey}`])
  md["gacha"] = (current / PULL_COST).toFixed(0)
  md["last_gacha"] = (last / PULL_COST).toFixed(0)
  md[`current_${money.primaryKey}`] = fold(current, 2)
  md[`last_${money.primaryKey}`] = fold(last, 2)
  md[`current_${money.secondaryKey}`] = fold(num(md[`current_${money.secondaryKey}`]), 1)
  md[`last_${money.secondaryKey}`] = fold(num(md[`last_${money.secondaryKey}`]), 1)
  dd[`current_${money.primaryKey}`] = fold(num(dd[`current_${money.primaryKey}`]), 1)
  dd[`current_${money.secondaryKey}`] = fold(num(dd[`current_${money.secondaryKey}`]), 1)

  const list = raw.month_data?.group_by ?? []
  const pcts = percentsOf(list.map(it => num(it.num)))
  const groups = list.map((it, idx) => {
    // 星铁不给 action_id，按标识查表折算；来源名截到四字 —— 长名会在格子里换行
    const id = sr ? (SR_ACTIONS[it.action ?? ""] ?? 0) : num(it.action_id)
    const color = SLICE_COLORS[id % SLICE_COLORS.length] ?? SLICE_COLORS[0]
    const one: Record<string, unknown> = { ...it, color, percent: pcts[idx] ?? 0 }
    if (sr && it.action_name) one["action_name"] = it.action_name.slice(0, 4)
    // 两个游戏的来源名字段不同（原神 `action`、星铁 `action_name`），并成一个键，两张模板共用一段图例
    one["label"] = (sr ? one["action_name"] : it.action) ?? ""
    return one
  })
  md["group_by"] = groups
  // 饼图只画数量非零的项：全为 0 时 g2plot 会把每项画成等分扇区，而不是一个空环
  const drawn = groups.filter(one => num(one["num"]) > 0)

  const d = new Date(now)
  const monthNum = sr ? Number(String(raw.data_month ?? "").slice(-2)) : num(raw.data_month)
  // 查的就是本月时另附日期 —— 本月数据每日都在变，标出日期才知道图是几号出的
  const day = monthNum === d.getMonth() + 1 ? `${monthNum}月${d.getDate()}号` : `${monthNum}月`

  return {
    ...raw,
    month_data: md,
    day_data: dd,
    uid: ctx.uid,
    saveId: ctx.uid,
    name: ctx.name,
    nickname: extra.nickname ?? ctx.name,
    ...iconFields(ctx.game, pick, extra),
    day,
    srday: weekOf(now),
    nowDay: cnDate(now),
    // 模板把这两串塞进 g2plot 的配置里，故须为 JSON 而非对象
    group_by: JSON.stringify(drawn),
    color: JSON.stringify(drawn.map(one => one["color"])),
    // 为假时模板不起 g2plot、改画一个空环：g2plot 拿到空数据什么都不画，连「总计」都没有数
    hasPie: drawn.length > 0,
    pie: JSON.stringify(drawn.map(one => ({ label: one["label"], num: num(one["num"]) }))),
    slices: groups,
    top: drawn.length > 0 ? [...drawn].sort((a, b) => num(b["num"]) - num(a["num"]))[0] : undefined,
    cmp,
    gacha: md["gacha"],
    monthLabel: `${monthNum} 月`,
    primaryName: money.primary,
    today: [
      { label: money.primary, icon: CURRENCY_ICON[sr ? "sr" : "gs"][0], value: dd[`current_${money.primaryKey}`] },
      { label: money.secondary, icon: CURRENCY_ICON[sr ? "sr" : "gs"][1], value: dd[`current_${money.secondaryKey}`] }
    ],
    // 内容少（两行对比加一张饼图），按整族 640px 排两侧大片留空，收窄一档（见 base.css 的 `.pic-narrow`）
    bodyClass: "pic-narrow"
  }
}
