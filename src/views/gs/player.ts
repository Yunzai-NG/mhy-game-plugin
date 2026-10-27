/**
 * 模块职责：角色卡片（`#角色`）与探索度（`#探索`）两套既有模板的数据适配
 * 依赖方向：纯函数，依赖 core/text；不碰 IO
 * 生命周期：无状态
 * 注意事项：两套模板的数据形状是「若干行、每行若干格」的表格（`line`），按模板排布填、不另归并（少一格整行宽度错位）。
 *          `extra` 是各项统计当前上限（随插件写死），会随版本增长、过期只影响「x/y」里的 y、不值得另开配置。
 */
import { INDENT } from "../../core/text.js"
import { elemOf } from "../../meta/elem.js"

/** 传给既有模板的一份数据 */
export type TemplateData = Record<string, unknown>

/** 旅行者的两个 id，接口对两种性别均称"旅行者" */
const TRAVELER: Readonly<Record<string, string>> = { "10000005": "空", "10000007": "荧" }

/** 表格里的一格 */
interface Cell {
  /** 名目 */
  lable: string
  /** 取值 */
  num: number | string
  /** 上限，形如 `1711`；给出时模板显示成 `x/y` */
  extra?: number
  /** 字色，仅获取率那一格用 */
  color?: string
}

/**
 * 各项统计的当前上限
 *
 * 会随游戏版本增长，过期只影响 `x/y` 里的 y。
 */
const LIMITS = {
  achievement: 1711,
  avatar: 115,
  level: 60,
  magic_chest: 381,
  luxurious_chest: 377,
  precious_chest: 992,
  exquisite_chest: 3136,
  common_chest: 3646,
  way_point: 726,
  domain: 69,
  anemoculus: 66,
  geoculus: 131,
  electroculus: 181,
  dendroculus: 271,
  hydroculus: 271,
  pyroculus: 271,
  moonoculus: 192
} as const

/** 宝箱总数，五类宝箱上限之和；获取率按其折算 */
const ALL_CHEST =
  LIMITS.magic_chest + LIMITS.luxurious_chest + LIMITS.precious_chest + LIMITS.exquisite_chest + LIMITS.common_chest

/**
 * 五类宝箱各自的当前总数
 *
 * 取自 {@link LIMITS} 的同名项；另立一份是为了不把整张表（含各类神瞳与传送点）暴露出去，`#角色列表` 的宝箱一栏只要这五个。同样随版本增长。
 */
export const CHEST_LIMITS = {
  common: LIMITS.common_chest,
  exquisite: LIMITS.exquisite_chest,
  precious: LIMITS.precious_chest,
  luxurious: LIMITS.luxurious_chest,
  magic: LIMITS.magic_chest
} as const

/** 原神公测日，活跃天数按其折算"共几天" */
const LAUNCH = Date.UTC(2020, 8, 15)

/** 地区 id → 中文名 */
const AREA_NAMES: Readonly<Record<number, string>> = {
  1: "蒙德",
  2: "璃月",
  3: "雪山",
  4: "稻妻",
  5: "渊下宫",
  6: "层岩巨渊",
  7: "层岩地下",
  8: "须弥",
  9: "枫丹",
  10: "沉玉谷",
  11: "来歆山",
  12: "沉玉谷·南陵",
  13: "沉玉谷·上谷",
  14: "旧日之海",
  15: "纳塔",
  16: "远古圣山",
  17: "挪德卡莱",
  18: "风息山",
  19: "空之神殿",
  20: "至冬"
}

/** 官方「世界探索」页里几处按地区 id 判的特例 */
const W = { naTa: 15, ancientMountain: 16, nordkalei: 17, kongZhiShenDian: 19, zhiDong: 20, chenYu: 10 } as const

/**
 * 接口没给 `world_exploration_display` 时的分组：一张卡片一个主地区，`items` 是挂在它下面的特殊区域，
 * 每项取 `area_ids[0]` 的那份数据、其余 id 的区域与首领并进详细列表
 *
 * 次序即出图次序，与接口给的那份一致；表外的新地区单独成卡、排在最前。
 */
const DISPLAY_FALLBACK: readonly WorldDisplay[] = [
  { exploration_id: 20 },
  { exploration_id: 19 },
  { exploration_id: 17 },
  { exploration_id: 15, group: { items: [{ area_ids: [16] }] } },
  { exploration_id: 9, group: { items: [{ area_ids: [14] }] } },
  { exploration_id: 8 },
  { exploration_id: 4, group: { items: [{ area_ids: [5] }] } },
  { exploration_id: 2, group: { items: [{ area_ids: [6, 7] }, { area_ids: [10, 11, 12, 13] }] } },
  { exploration_id: 1, group: { items: [{ area_ids: [3] }, { area_ids: [18] }] } }
]

/** 一张卡片的分组：主地区 id 与挂在它下面的特殊区域 */
interface WorldDisplay {
  /** 主地区 id */
  exploration_id?: number
  /** 特殊区域 */
  group?: {
    /** 每项一行；`exploration_percentage` 给出时以它为这一行的探索度（沉玉谷本身恒 0，靠它） */
    items?: { area_ids?: number[]; exploration_percentage?: number }[]
  }
}

/** 原神 index 接口里本模块用到的字段 */
export interface PlayerIndexRaw {
  /** 账号信息 */
  role?: {
    /** 游戏内昵称 */
    nickname?: string
    /** 冒险等阶 */
    level?: number
    /** 头像 */
    game_head_icon?: string
    /** 区服名 */
    region?: string
  }
  /** 统计 */
  stats?: Record<string, unknown>
  /** 地区探索 */
  world_explorations?: {
    /** 地区 id */
    id?: number
    /** 地区名 */
    name?: string
    /** 探索度，千分数 */
    exploration_percentage?: number
    /** 声望等级 */
    level?: number
    /** 所属地区 id，主地区为 0 */
    parent_id?: number
    /** `Reputation` / `Offering` / `TypeUnknow`，决定头部印哪几种等级 */
    type?: string
    /** 1 特殊区域、2 主要区域；特殊区域的探索度行印自己的名字 */
    world_type?: number
    /** 七天神像（新月神像）等级 */
    seven_statue_level?: number
    /** 供奉 */
    offerings?: {
      /** 供奉名 */
      name?: string
      /** 等级 */
      level?: number
      /** 图标地址；只取文件名去插件资源里找同名图 */
      icon?: string
      /** `OfferingOpenStateLocked` 时官方页印「未开启」 */
      open_state?: string
    }[]
    /** 纳塔的部族声望 */
    natan_reputation?: { tribal_list?: { id?: number; name?: string; level?: number }[] }
    /** 详细区域探索度，千分数 */
    area_exploration_list?: { name?: string; exploration_percentage?: number }[]
    /** 区域首领图鉴：击败次数 */
    boss_list?: { name?: string; kill_num?: number }[]
  }[]
  /** 地区分组与次序，见 {@link DISPLAY_FALLBACK} */
  world_exploration_display?: WorldDisplay[]
  /** 尘歌壶 */
  homes?: {
    /** 名称 */
    name?: string
    /** 图标 */
    icon?: string
    /** 信任等阶 */
    level?: number
    /** 最高仙力 */
    comfort_num?: number
    /** 摆设数 */
    item_num?: number
    /** 访客数 */
    visit_num?: number
    /** 仙力等级名 */
    comfort_level_name?: string
    /** 仙力等级图标 */
    comfort_level_icon?: string
  }[]
  /** 角色列表 */
  avatars?: {
    /** 角色 id */
    id?: number
    /** 角色名 */
    name?: string
    /** 等级 */
    level?: number
    /** 已激活命座数 */
    actived_constellation_num?: number
    /** 立绘，米游社给的绝对地址 */
    image?: string
    /** 头像 */
    icon?: string
    /** 元素，首字母大写的英文（`Pyro`） */
    element?: string
    /** 稀有度；埃洛伊是 105 */
    rarity?: number
  }[]
}

/** 七圣召唤基础信息，`role-explore` 用它 */
export interface BasicInfoRaw {
  /** 等级 */
  level?: number
  /** 已收集角色牌 */
  avatar_card_num_gained?: number
  /** 角色牌总数 */
  avatar_card_num_total?: number
  /** 已收集行动牌 */
  action_card_num_gained?: number
  /** 行动牌总数 */
  action_card_num_total?: number
}

/** 造这两套模板数据时的上下文 */
export interface PlayerContext {
  /** uid */
  uid: string
  /** 查询者昵称 */
  name: string
  /** 当前时间，测试注入 */
  now?: number
}

/**
 * 取数字，脏值一律当 0
 * @param value 原始值
 * @returns 数字
 */
function num(value: unknown): number {
  const out = typeof value === "string" ? Number(value) : value
  return typeof out === "number" && Number.isFinite(out) ? out : 0
}

/**
 * 五类宝箱求和
 * @param s 统计
 * @returns 总数
 */
function chestSum(s: Record<string, unknown> | undefined): number {
  return (
    num(s?.["precious_chest_number"]) +
    num(s?.["luxurious_chest_number"]) +
    num(s?.["exquisite_chest_number"]) +
    num(s?.["common_chest_number"]) +
    num(s?.["magic_chest_number"])
  )
}

/** 获取率等第 → 字色 */
const GRADE_COLORS: Readonly<Record<string, string>> = {
  D: "#12a182",
  C: "#2775b6",
  B: "#806d9e",
  A: "#c04851",
  S: "#f86b1d"
}

/**
 * 宝箱获取率 → 等第与字色
 * @param s 统计
 * @param digits 百分比保留几位小数
 * @returns 形如 `A[86.5%]` 与其字色
 */
function grade(s: Record<string, unknown> | undefined, digits: number): { text: string; color: string } {
  const pct = Number(((chestSum(s) / ALL_CHEST) * 100).toFixed(digits))
  const letter = pct < 60 ? "D" : pct < 70 ? "C" : pct < 80 ? "B" : pct < 90 ? "A" : "S"
  return { text: `${letter}[${pct}%]`, color: GRADE_COLORS[letter] ?? "" }
}

/**
 * 地区排序：有探索度的按 id 倒序（新地区在前），探索度为 0 的整组沉底
 *
 * 只按 id 倒序时，接口提前下发的未开放地区（id 最大、恒 0%）会排在最前、挤掉真正在探的地区。
 * 沉玉谷（10）本身恒 0%、探索度在子区域上，故不参与沉底。
 * @param list 接口给的地区
 * @returns 排好的新数组
 */
function sortAreas(list: PlayerIndexRaw["world_explorations"]): NonNullable<PlayerIndexRaw["world_explorations"]> {
  const zero = (it: { id?: number; exploration_percentage?: number }): number =>
    num(it.id) === 10 || num(it.exploration_percentage) > 0 ? 0 : 1
  return [...(list ?? [])].sort((a, b) => zero(a) - zero(b) || num(b.id) - num(a.id))
}

/**
 * 活跃天数 → "活跃天数：380/2170天"
 * @param days 活跃天数
 * @param now 当前时间
 * @returns 说明文本
 */
function activeDay(days: number, now: number): string {
  const total = Math.floor((now - LAUNCH) / 86_400_000) + 1
  return `活跃天数：${Math.floor(days)}/${total}天`
}

/**
 * 原神 index → `gs/role-card` 的模板数据
 *
 * 两行统计 + 两行探索度，角色取前八个；立绘用接口自带的 `image`（绝对地址）而不查元数据 —— 这一页本就不要求装元数据。
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @returns 模板数据
 */
export function roleCardTemplateData(raw: PlayerIndexRaw, ctx: PlayerContext): TemplateData {
  const s = raw.stats ?? {}
  const role = raw.role ?? {}
  const line: Cell[][] = [
    [
      { lable: "活跃天数", num: num(s["active_day_number"]) },
      { lable: "成就", num: num(s["achievement_number"]) },
      { lable: "等级", num: num(role.level) },
      { lable: "角色数", num: num(s["avatar_number"]) },
      { lable: "满好感角色数", num: num(s["full_fetter_avatar_num"]) },
      { lable: "总宝箱", num: chestSum(s) }
    ],
    [
      { lable: "华丽宝箱", num: num(s["luxurious_chest_number"]) },
      { lable: "珍贵宝箱", num: num(s["precious_chest_number"]) },
      { lable: "精致宝箱", num: num(s["exquisite_chest_number"]) },
      { lable: "普通宝箱", num: num(s["common_chest_number"]) },
      { lable: "奇馈宝箱", num: num(s["magic_chest_number"]) },
      { lable: "传送点", num: num(s["way_point_number"]) }
    ]
  ]

  const areas = sortAreas(raw.world_explorations)
  const first: Cell[] = []
  const second: Cell[] = []
  for (const it of areas) {
    const cell: Cell = {
      lable: AREA_NAMES[num(it.id)] ?? (it.name ?? "").slice(0, 6),
      num: `${num(it.exploration_percentage) / 10}%`
    }
    if (first.length < 5) first.push(cell)
    else second.push(cell)
  }
  second.push(
    { lable: "月神瞳", num: num(s["moonoculus_number"]) },
    { lable: "火神瞳", num: num(s["pyroculus_number"]) },
    { lable: "水神瞳", num: num(s["hydroculus_number"]) },
    { lable: "草神瞳", num: num(s["dendroculus_number"]) },
    { lable: "雷神瞳", num: num(s["electroculus_number"]) },
    { lable: "岩神瞳", num: num(s["geoculus_number"]) },
    { lable: "风神瞳", num: num(s["anemoculus_number"]) }
  )
  line.push(first, second.slice(0, 5))

  const avatars = (raw.avatars ?? []).slice(0, 8).map(it => ({
    ...it,
    name: TRAVELER[String(it.id ?? "")] ?? it.name ?? "",
    img: it.image ?? it.icon ?? "",
    // css 的元素类是元素键（`.e-pyro`），接口原样的 `Pyro` 配不上、整排没有元素色
    element: elemOf(it.element ?? "", "anemo"),
    star: num(it.rarity) === 4 ? 4 : 5
  }))

  return {
    uid: ctx.uid,
    saveId: ctx.uid,
    name: ctx.name,
    role: {
      nickname: role.nickname ?? ctx.name,
      level: num(role.level),
      game_head_icon: role.game_head_icon ?? ""
    },
    line,
    avatars
  }
}

/**
 * 原神 index → `gs/role-explore` 的模板数据
 *
 * 五行统计 + 逐地区探索卡片（分组见 {@link exploreCards}）+ 尘歌壶 + 七圣召唤。
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @param basicInfo 七圣召唤基础信息，取不到时省略该块
 * @returns 模板数据
 */
export function roleExploreTemplateData(
  raw: PlayerIndexRaw,
  ctx: PlayerContext,
  basicInfo?: BasicInfoRaw
): TemplateData {
  const now = ctx.now ?? Date.now()
  const s = raw.stats ?? {}
  const role = raw.role ?? {}
  const total = Math.floor((now - LAUNCH) / 86_400_000) + 1
  const g = grade(s, 2)

  const head: Cell[] = [
    { lable: "活跃天数", num: num(s["active_day_number"]), extra: total },
    { lable: "深境螺旋", num: (s["spiral_abyss"] as string) ?? "-" },
    { lable: "幻想真境剧诗", num: num((s["role_combat"] as Record<string, unknown>)?.["max_round_id"]) }
  ]

  const line: Cell[][] = [
    [
      { lable: "获得角色数", num: num(s["avatar_number"]), extra: LIMITS.avatar },
      { lable: "满好感角色数", num: num(s["full_fetter_avatar_num"]) },
      { lable: "达成成就数", num: num(s["achievement_number"]), extra: LIMITS.achievement },
      { lable: "幽境危战", num: num((s["hard_challenge"] as Record<string, unknown>)?.["difficulty"]) }
    ],
    [
      { lable: "解锁传送点", num: num(s["way_point_number"]), extra: LIMITS.way_point },
      { lable: "解锁秘境", num: num(s["domain_number"]), extra: LIMITS.domain },
      { lable: "宝箱获取率", num: g.text, color: g.color },
      { lable: "宝箱总数", num: chestSum(s), extra: ALL_CHEST }
    ],
    [
      { lable: "普通宝箱", num: num(s["common_chest_number"]), extra: LIMITS.common_chest },
      { lable: "精致宝箱", num: num(s["exquisite_chest_number"]), extra: LIMITS.exquisite_chest },
      { lable: "珍贵宝箱", num: num(s["precious_chest_number"]), extra: LIMITS.precious_chest },
      { lable: "华丽宝箱", num: num(s["luxurious_chest_number"]), extra: LIMITS.luxurious_chest }
    ],
    [
      { lable: "奇馈宝箱", num: num(s["magic_chest_number"]), extra: LIMITS.magic_chest },
      { lable: "月神瞳", num: num(s["moonoculus_number"]), extra: LIMITS.moonoculus },
      { lable: "风神瞳", num: num(s["anemoculus_number"]), extra: LIMITS.anemoculus },
      { lable: "岩神瞳", num: num(s["geoculus_number"]), extra: LIMITS.geoculus }
    ],
    [
      { lable: "雷神瞳", num: num(s["electroculus_number"]), extra: LIMITS.electroculus },
      { lable: "草神瞳", num: num(s["dendroculus_number"]), extra: LIMITS.dendroculus },
      { lable: "水神瞳", num: num(s["hydroculus_number"]), extra: LIMITS.hydroculus },
      { lable: "火神瞳", num: num(s["pyroculus_number"]), extra: LIMITS.pyroculus }
    ]
  ]

  const explor = exploreCards(raw)

  const home = raw.homes?.[0]
  const data: TemplateData = {
    nickname: role.nickname ?? ctx.name,
    level: num(role.level),
    region: role.region ?? "天空岛",
    game_head_icon: role.game_head_icon ?? "",
    head,
    ...(home
      ? {
          homes: {
            name: home.name ?? "",
            icon: home.icon ?? "",
            comfort_name: home.comfort_level_name ?? "",
            comfort_icon: home.comfort_level_icon ?? "",
            line: [
              { lable: "信任等级", num: num(home.level) },
              { lable: "最高仙力", num: num(home.comfort_num) },
              { lable: "获得摆设", num: num(home.item_num) },
              { lable: "历史访客", num: num(home.visit_num) }
            ]
          }
        }
      : {})
  }

  return {
    uid: ctx.uid,
    saveId: ctx.uid,
    name: ctx.name,
    activeDay: activeDay(num(s["active_day_number"]), now),
    data,
    line,
    explor,
    ...(basicInfo ? { basicInfo } : {})
  }
}

/** 卡片头部的一项等级：七天神像、供奉、声望；`icon` 是插件资源里的相对路径 */
export interface ExploreLevel {
  /** 图标，`gs/area-offering/` 下 */
  icon: string
  /** 名目，已带「等级：」 */
  name: string
  /** 等级 */
  value: number
}

/** 一行探索度（主要区域或某个特殊区域）与它自己的那几项等级 */
export interface ExplorePercent {
  /** 「主要区域探索度：」或「龙脊雪山探索度：」 */
  name: string
  /** `12.3%` */
  pct: string
  /** 0~100，进度条宽度 */
  num: number
  /** 满 100% 时为真，数值换金色 */
  full: boolean
  /** 特殊区域自己的等级（如龙脊雪山的忍冬之树）；主要区域那一行的等级在卡片头部 */
  levels: ExploreLevel[]
}

/** 一张地区卡片：底图、徽记按 `key` 取 `gs/area/`、`gs/area-icon/` */
export interface ExploreCard extends TemplateData {
  /** 图名与配色键（`雪山`、`至冬` 一类插件内的叫法） */
  key: string
  /** 地区名，照接口 */
  name: string
  /** 头部的等级 */
  levels: ExploreLevel[]
  /** 主要区域那一行 */
  main: ExplorePercent
  /** 挂在下面的特殊区域，每个一行 */
  kids: ExplorePercent[]
  /** 纳塔的部族声望 */
  tribes: { id: number; name: string; level: number }[]
  /** 挪德卡莱、至冬的聚所 / 特殊供奉：未开启的 `locked` */
  gathers: { name: string; icon: string; text: string; locked: boolean }[]
  /** 详细区域探索度（含特殊区域并进来的） */
  areas: { name: string; pct: string }[]
  /** 区域首领图鉴：名字与击败次数 */
  bosses: { name: string; num: number }[]
  /** `#信息` 与 `#角色列表` 那种小卡片用的几行：探索度、各特殊区域、声望 */
  line: { name: string; text: string }[]
}

type World = NonNullable<PlayerIndexRaw["world_explorations"]>[number]

/**
 * 千分数 → 百分数，封顶 100
 * @param v 接口的千分数
 * @returns 百分数
 */
function permille(v: unknown): number {
  return Math.min(100, num(v) / 10)
}

/**
 * 供奉图标：取接口地址的文件名，去掉 `UI_ChapterOffering_` 前缀后到插件资源里找同名图
 * @param url 接口给的图标地址
 * @returns 插件资源里的相对路径；没有地址时空串
 */
function offeringIcon(url: string | undefined): string {
  const file = (url ?? "").split("/").pop() ?? ""
  return file ? `gs/area-offering/${file.replace(/^UI_ChapterOffering_/, "")}` : ""
}

/**
 * 一个地区头部印的那几项等级 —— 判据照官方页：类型缺省或 `TypeUnknow` 一项都不印；
 * 挪德卡莱与至冬的供奉另成「聚所」一块、不进头部；`Offering` 类与纳塔不印声望
 * @param w 地区
 * @returns 等级
 */
function levelsOf(w: World): ExploreLevel[] {
  const id = num(w.id)
  const gathering = id === W.nordkalei || id === W.zhiDong
  const statue = num(w.seven_statue_level) > 0
  const offerings = !gathering && (w.offerings?.length ?? 0) > 0
  const country = w.type !== "Offering" && id !== W.naTa && !gathering
  if (!w.type || w.type === "TypeUnknow" || !(statue || offerings || country || id === W.kongZhiShenDian)) return []
  const out: ExploreLevel[] = []
  if (statue) {
    out.push({ icon: "gs/area-offering/statue.png", name: `${id === W.nordkalei ? "新月" : "七天"}神像等级：`, value: num(w.seven_statue_level) })
  }
  if (offerings) {
    for (const o of w.offerings ?? []) {
      const icon = id === W.kongZhiShenDian ? "gs/area-offering/statue.png" : offeringIcon(o.icon)
      out.push({ icon, name: `${o.name ?? ""}等级：`, value: num(o.level) })
    }
  }
  if (country) out.push({ icon: "gs/area-offering/country.png", name: "声望等级：", value: num(w.level) })
  return out
}

/**
 * 一行探索度
 * @param w 地区
 * @param permil 这一行的千分数（特殊区域取分组里给的那个）
 * @param levels 这一行附带的等级
 * @returns 一行
 */
function percentOf(w: World, permil: unknown, levels: ExploreLevel[]): ExplorePercent {
  const p = permille(permil)
  return {
    name: `${num(w.world_type) === 1 ? (w.name ?? "") : "主要区域"}探索度：`,
    pct: `${p}%`,
    num: p,
    full: p >= 100,
    levels
  }
}

/**
 * index 的地区探索 → 一组地区卡片（`#探索`、`#信息`、`#角色列表` 共用）
 *
 * 分组照官方「世界探索」页：一张卡片一个主地区，龙脊雪山、层岩巨渊、沉玉谷、渊下宫、旧日之海一类挂在所属地区下各成一行，
 * 它们的详细区域与首领并进主地区那两张表。分组取 `world_exploration_display`，接口没给时用 {@link DISPLAY_FALLBACK}。
 * @param raw 接口返回的 data
 * @returns 卡片，按官方次序
 */
export function exploreCards(raw: Pick<PlayerIndexRaw, "world_explorations" | "world_exploration_display">): ExploreCard[] {
  const byId = new Map((raw.world_explorations ?? []).map(w => [num(w.id), w]))
  let display = raw.world_exploration_display?.length ? raw.world_exploration_display : undefined
  if (!display) {
    const known = new Set(DISPLAY_FALLBACK.flatMap(d => [d.exploration_id, ...(d.group?.items ?? []).flatMap(i => i.area_ids ?? [])]))
    const extra = [...byId.values()]
      .filter(w => !known.has(num(w.id)) && !num(w.parent_id))
      .sort((a, b) => num(b.id) - num(a.id))
      .map(w => ({ exploration_id: num(w.id) }))
    display = [...extra, ...DISPLAY_FALLBACK]
  }

  const cards: ExploreCard[] = []
  for (const d of display) {
    const w = byId.get(num(d.exploration_id))
    if (!w) continue
    const id = num(w.id)
    const areas = [...(w.area_exploration_list ?? [])]
    const bosses = [...(w.boss_list ?? [])]
    const kids: ExplorePercent[] = []
    const line: { name: string; text: string }[] = [{ name: "探索度", text: `${permille(w.exploration_percentage)}%` }]

    for (const item of d.group?.items ?? []) {
      const [first, ...rest] = item.area_ids ?? []
      const kid = byId.get(num(first))
      if (!kid) continue
      const permil = item.exploration_percentage ?? kid.exploration_percentage
      // 沉玉谷本身不给探索度，详细列表里只列它的子区域
      if (num(kid.id) !== W.chenYu) areas.push({ name: kid.name ?? "", exploration_percentage: num(kid.exploration_percentage) })
      areas.push(...(kid.area_exploration_list ?? []))
      bosses.push(...(kid.boss_list ?? []))
      for (const sub of rest) {
        const s = byId.get(num(sub))
        if (!s) continue
        areas.push({ name: s.name ?? "", exploration_percentage: num(s.exploration_percentage) }, ...(s.area_exploration_list ?? []))
        bosses.push(...(s.boss_list ?? []))
      }
      // 远古圣山只并进纳塔的详细列表，不单列一行
      if (num(kid.id) === W.ancientMountain) continue
      kids.push(percentOf({ ...kid, world_type: 1 }, permil, levelsOf(kid)))
      line.push({ name: kid.name ?? "", text: `${permille(permil)}%` })
    }
    const country = w.type !== "Offering" && id !== W.naTa && id !== W.nordkalei && id !== W.zhiDong && w.type && w.type !== "TypeUnknow"
    if (country) line.push({ name: "声望", text: `${num(w.level)}级` })

    cards.push({
      key: AREA_NAMES[id] ?? w.name ?? "",
      name: w.name ?? AREA_NAMES[id] ?? "",
      levels: levelsOf(w),
      main: percentOf(w, w.exploration_percentage, []),
      kids,
      tribes:
        id === W.naTa
          ? (w.natan_reputation?.tribal_list ?? []).map(t => ({
              id: num(t.id),
              name: (t.name ?? "").replace(/^「(.*)」$/, "$1"),
              level: num(t.level)
            }))
          : [],
      gathers:
        id === W.nordkalei || id === W.zhiDong
          ? (w.offerings ?? []).map(o => {
              const locked = o.open_state === "OfferingOpenStateLocked"
              return { name: o.name ?? "", icon: offeringIcon(o.icon), text: locked ? "未开启" : `${num(o.level)}级`, locked }
            })
          : [],
      areas: areas.map(a => ({ name: a.name ?? "", pct: `${permille(a.exploration_percentage)}%` })),
      bosses: bosses.map(b => ({ name: b.name ?? "", num: num(b.kill_num) })),
      line
    })
  }
  return cards
}


/**
 * 角色卡片 / 探索度 → 纯文字
 *
 * 没装渲染器的使用者拿到的就是这段，故给出最主要的几项而非全表。
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @returns 多行文本
 */
export function playerText(raw: PlayerIndexRaw, ctx: PlayerContext): string {
  const s = raw.stats ?? {}
  const g = grade(s, 1)
  return [
    `${raw.role?.nickname ?? ctx.name} ${ctx.uid}`,
    `冒险等阶 ${num(raw.role?.level)}，${activeDay(num(s["active_day_number"]), ctx.now ?? Date.now())}`,
    `${INDENT}成就 ${num(s["achievement_number"])}/${LIMITS.achievement}`,
    `${INDENT}角色 ${num(s["avatar_number"])}/${LIMITS.avatar}`,
    `${INDENT}宝箱 ${chestSum(s)}/${ALL_CHEST}（${g.text}）`,
    `${INDENT}深境螺旋 ${(s["spiral_abyss"] as string) ?? "-"}`
  ].join("\n")
}
