/**
 * 模块职责：账号总览（`#原神信息` / `#角色列表`）的视图模型
 * 依赖方向：纯函数，依赖 region；不碰 IO
 * 生命周期：无状态
 * 注意事项：三游戏 `index` 接口字段名与嵌套形态各不相同，本模块转成同一份「统计条目 + 探索进度 + 角色简表」，模板只需一份。
 *          只读 `index` 一条：官方主页上 index 不给的格子（星铁货币战争等）不印，不为它另打战绩接口。页头背景直接用
 *          https 地址（`official-api-is-data-only` 唯一的例外，见 README「模板约定」）。
 *          原神地区名直接用接口返回的 `name`、不维护本地 id→中文表（每个大版本新增地区、本地表遗漏即空白）。角色排序按稀有度→等级→命座依次比较、不折算成单权重数。字段全可选，接口改名最多让某条统计缺席、不会让命令失败。
 */
import type { GameKey } from "../core/region.js"
import { GAME_NAMES, REGION_NAMES, resolveRegionKind } from "../core/region.js"
import { INDENT } from "../core/text.js"
import { elemOf } from "../meta/elem.js"
import { ZZZ_ELEM_CSS } from "../panel/prop/zzz.js"

/** 一条统计条目 */
export interface StatItem {
  /** 条目名 */
  label: string
  /** 展示值，已格式化成字符串 */
  value: string
  /** 值里没有数字：数字字体没有汉字字形，模板换正文字体 */
  text: boolean
}

/** 一条探索进度 */
export interface ExploreItem {
  /** 地区 / 区域名 */
  label: string
  /** 探索度百分比，0~100，保留一位小数 */
  percent: number
  /** 附注，如声望等级或供奉等级 */
  extra?: string
}

/** 角色简表里的一个角色 */
export interface AvatarBrief {
  /** 角色 id */
  id: string
  /** 角色名 */
  name: string
  /** 等级 */
  level: number
  /** 稀有度，绝区零的 S/A 也折算成 5/4 */
  rarity: number
  /** 命座 / 星魂 / 影画层数 */
  cons: number
  /** 头像：原神星铁是米游社给的绝对地址，绝区零是元数据里的相对路径（模板按 `meta-` 前缀挑根） */
  icon?: string
  /** 属性，已折成皮肤 css 的元素类名（`pyro` / `lightning` / `electric`），头像格拼成 `e-xxx` */
  element?: string
}

/** 账号总览视图 */
export interface ProfileView {
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
  /** 游戏内昵称，接口没给时回落成查询者昵称 */
  nickname: string
  /** 冒险等阶 / 开拓等级 / 代理人等级 */
  level: number
  /** 头像地址 */
  icon?: string
  /** 活跃天数 */
  activeDays: number
  /** 统计条目 */
  stats: StatItem[]
  /** 探索进度，星铁与绝区零没有这项，给空数组让模板整块隐藏 */
  explore: ExploreItem[]
  /** 角色简表，已按稀有度 → 等级 → 命座降序 */
  avatars: AvatarBrief[]
  /** 页头背景：星铁的手机壁纸、绝区零的名片，都是玩家自己选的、取自 index；原神 index 不给 */
  bg?: string
  /** 绝区零的称号，带官方给的两段底色 */
  title?: { text: string; main: string; bottom: string }
  /** 原神的尘歌壶，未开启时空数组 */
  home: StatItem[]
  /** 尘歌壶名（洞天等级名），没有时空串 */
  homeName: string
  /**
   * 原神的地区卡片（底图与徽记按 `key` 取 `gs/area/`、`gs/area-icon/`），由命令层用 `exploreCards` 填；
   * 空数组时模板退回 {@link ProfileView.explore} 那排进度条
   */
  areas: { key: string; name: string; line: { name: string; text: string }[] }[]
}

/** 造总览视图时的上下文 */
export interface ProfileContext {
  /** 游戏 */
  game: GameKey
  /** uid */
  uid: string
  /** 查询者昵称 */
  name: string
  /** 角色简表最多留几个，`#角色列表` 全要、卡片只要前几个 */
  limit?: number
  /**
   * 按角色 id 取元数据里的头像相对路径，取不到时返回空串
   *
   * **绝区零只能靠它**：`index` 的 `avatar_list` 里没有代理人头像，只有阵营徽记与空洞徽记两张。
   */
  faceOf?: (id: string) => string
}

/** 原神 index 的原始字段（只列用到的） */
export interface GsIndexRaw {
  /** 账号信息 */
  role?: {
    /** 游戏内昵称 */
    nickname?: string
    /** 冒险等阶 */
    level?: number
    /** 头像 */
    game_head_icon?: string
  }
  /** 统计 */
  stats?: {
    /** 活跃天数 */
    active_day_number?: number
    /** 成就数 */
    achievement_number?: number
    /** 角色数 */
    avatar_number?: number
    /** 满好感角色数 */
    full_fetter_avatar_num?: number
    /** 传送点 */
    way_point_number?: number
    /** 秘境 */
    domain_number?: number
    /** 深境螺旋进度，形如 `12-3` */
    spiral_abyss?: string
    /** 华丽宝箱 */
    luxurious_chest_number?: number
    /** 珍贵宝箱 */
    precious_chest_number?: number
    /** 精致宝箱 */
    exquisite_chest_number?: number
    /** 普通宝箱 */
    common_chest_number?: number
    /** 奇馈宝箱 */
    magic_chest_number?: number
    /** 七国神瞳，键名即元素 */
    anemoculus_number?: number
    /** 岩神瞳 */
    geoculus_number?: number
    /** 雷神瞳 */
    electroculus_number?: number
    /** 草神瞳 */
    dendroculus_number?: number
    /** 水神瞳 */
    hydroculus_number?: number
    /** 火神瞳 */
    pyroculus_number?: number
    /** 月神瞳 */
    moonoculus_number?: number
    /** 冰神瞳 */
    iceculus_number?: number
    /** 幻想真境剧诗 */
    role_combat?: { has_data?: boolean; max_round_id?: number; difficulty_id?: number; tarot_finished_cnt?: number }
    /** 幽境危战 */
    hard_challenge?: { has_data?: boolean; difficulty?: number }
  }
  /** 地区探索 */
  world_explorations?: {
    /** 地区 id */
    id?: number
    /** 地区名 */
    name?: string
    /** 探索度，接口给的是千分数 */
    exploration_percentage?: number
    /** 声望等级 */
    level?: number
    /** 供奉 */
    offerings?: {
      /** 供奉名 */
      name?: string
      /** 供奉等级 */
      level?: number
    }[]
  }[]
  /** 尘歌壶 */
  homes?: {
    /** 信任等阶 */
    level?: number
    /** 最高洞天仙力 */
    comfort_num?: number
    /** 获得摆设数 */
    item_num?: number
    /** 历史访客数 */
    visit_num?: number
    /** 洞天等级名，如 `贝阙珠宫` */
    comfort_level_name?: string
  }[]
  /** 角色列表 */
  avatars?: {
    /** 角色 id */
    id?: number
    /** 角色名 */
    name?: string
    /** 等级 */
    level?: number
    /** 稀有度 */
    rarity?: number
    /** 已激活命座数 */
    actived_constellation_num?: number
    /** 头像 */
    icon?: string
    /** 属性中文名 */
    element?: string
  }[]
}

/** 星穹铁道 index 的原始字段 */
export interface SrIndexRaw {
  /** 统计 */
  stats?: {
    /** 活跃天数 */
    active_days?: number
    /** 角色数 */
    avatar_num?: number
    /** 成就数 */
    achievement_num?: number
    /** 宝箱数 */
    chest_num?: number
    /** 混沌回忆进度，接口直接给中文 */
    abyss_process?: string
    /** 差分宇宙 / 梦境贴纸数 */
    dream_paster_num?: number
    /** 差分宇宙的赛季称号 */
    season_title?: string
    /** 随宠款式数 */
    pet_num?: number
  }
  /** 当前头像 */
  cur_head_icon_url?: string
  /** 手机壁纸，官方主页的页头背景 */
  phone_background_image_url?: string
  /** 角色列表 */
  avatar_list?: {
    /** 角色 id */
    id?: number | string
    /** 角色名 */
    name?: string
    /** 等级 */
    level?: number
    /** 稀有度 */
    rarity?: number
    /** 星魂 */
    rank?: number
    /** 头像 */
    icon?: string
    /** 属性 */
    element?: string
  }[]
}

/** 绝区零 index 的原始字段 */
export interface ZzzIndexRaw {
  /** 统计 */
  stats?: {
    /** 活跃天数 */
    active_days?: number
    /** 代理人数 */
    avatar_num?: number
    /** 邦布数 */
    buddy_num?: number
    /** 成就数 */
    achievement_count?: number
    /** 本期零号空洞层数 */
    cur_period_zone_layer_count?: number
    /** 绳网声望名 */
    world_level_name?: string
    /** 危局强袭战 */
    hadal_brief?: { hadal_brief_v2?: { rating?: string; cur_period_zone_layer_count?: number } }
    /** 临界推演 */
    void_front_brief?: { has_ending_record?: boolean; ending_record_name?: string }
    /** 运筹中枢修复计划 */
    rab_brief?: { cur_stage?: number }
    /** 「布连邦」 */
    bangboo_micro_web_brief?: { level?: number }
  }
  /** 当前头像 */
  cur_head_icon_url?: string
  /** 名片与称号 */
  game_data_show?: {
    /** 名片图，官方主页的页头背景 */
    card_url?: string
    /** 称号 */
    personal_title?: string
    /** 称号主色，六位十六进制、不带井号 */
    title_main_color?: string
    /** 称号底色 */
    title_bottom_color?: string
  }
  /** 代理人列表 */
  avatar_list?: {
    /** 代理人 id */
    id?: number | string
    /** 代理人名 */
    name_mi18n?: string
    /** 等级 */
    level?: number
    /** 稀有度，`S` / `A` */
    rarity?: string
    /** 影画层数 */
    rank?: number
    /** **阵营徽记**（云岿山、狡兔屋……），不是代理人头像；该接口不给头像 */
    group_icon_path?: string
    /** 属性编号 */
    element_type?: number | string
  }[]
}

/** 三个游戏的 index 原始数据 */
export type IndexRaw = GsIndexRaw | SrIndexRaw | ZzzIndexRaw

/** 旅行者的两个 id，接口对两种性别均称"旅行者"，展示时须予区分 */
const TRAVELER: Readonly<Record<string, string>> = { "10000005": "空", "10000007": "荧" }

/** 绝区零用字母表示稀有度，折算成和另两个游戏一致的数字 */
const ZZZ_RARITY: Readonly<Record<string, number>> = { S: 5, A: 4, B: 3 }

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
 * 构造一条统计条目，取值为 0 时同样保留
 *
 * 「成就 0」与「这一项查不到」对用户是两回事，故不做「为 0 就省略」。
 * @param label 条目名
 * @param value 值
 * @returns 条目
 */
function stat(label: string, value: number | string | undefined): StatItem {
  const text = typeof value === "string" ? value : String(num(value))
  return { label, value: text, text: !/\d/.test(text) && text !== "-" }
}

/**
 * 角色简表排序：稀有度 → 等级 → 命座，都是降序
 * @param list 角色简表
 * @param limit 最多留几个
 * @returns 排好序并截断的简表
 */
function rank(list: AvatarBrief[], limit?: number): AvatarBrief[] {
  const sorted = [...list].sort(
    (a, b) => b.rarity - a.rarity || b.level - a.level || b.cons - a.cons || a.name.localeCompare(b.name)
  )
  return typeof limit === "number" && limit > 0 ? sorted.slice(0, limit) : sorted
}

/** 幽境危战难度 → 官方主页那枚罗马数字 */
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"]

/**
 * 零与空串印成「-」，与官方主页一致（没打过的玩法不印 0）
 * @param value 值
 * @returns 文本
 */
function dash(value: number | string | undefined): string {
  if (typeof value === "string") return value || "-"
  return num(value) ? String(num(value)) : "-"
}

/**
 * 六位十六进制色 → css 色，不是合法值时空串（防样式注入）
 * @param hex 接口给的色值
 * @returns `#rrggbb` 或空串
 */
function color(hex: string | undefined): string {
  return hex && /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : ""
}

/** 总览视图里由游戏决定的那几项 */
type ProfileBody = Pick<ProfileView, "nickname" | "level" | "icon" | "activeDays" | "stats" | "explore" | "avatars" | "home" | "homeName"> &
  Partial<Pick<ProfileView, "bg" | "title">>

/**
 * 原神 index → 视图
 * @param raw 原始数据
 * @param limit 角色简表上限
 * @returns 视图主体
 */
function fromGs(raw: GsIndexRaw, limit?: number): ProfileBody {
  const s = raw.stats ?? {}
  const rc = s.role_combat
  const combat = rc?.has_data ? `第${num(rc.max_round_id)}幕${rc.difficulty_id === 5 ? ` 圣牌${num(rc.tarot_finished_cnt)}` : ""}` : "-"
  const hard = s.hard_challenge?.has_data ? (ROMAN[num(s.hard_challenge.difficulty)] ?? "-") : "-"

  // 次序照官方主页那一格格：先玩法，再收集，最后神瞳与宝箱
  const stats: StatItem[] = [
    stat("活跃天数", s.active_day_number),
    stat("深境螺旋", dash(s.spiral_abyss)),
    stat("幻想真境剧诗", combat),
    stat("幽境危战", hard),
    stat("获得角色数", s.avatar_number),
    stat("满好感角色数", s.full_fetter_avatar_num),
    stat("成就达成数", s.achievement_number),
    stat("解锁传送点", s.way_point_number),
    stat("解锁秘境", s.domain_number),
    stat("风神瞳", s.anemoculus_number),
    stat("岩神瞳", s.geoculus_number),
    stat("雷神瞳", s.electroculus_number),
    stat("草神瞳", s.dendroculus_number),
    stat("水神瞳", s.hydroculus_number),
    stat("火神瞳", s.pyroculus_number),
    stat("月神瞳", s.moonoculus_number),
    stat("冰神瞳", s.iceculus_number),
    stat("华丽宝箱", s.luxurious_chest_number),
    stat("珍贵宝箱", s.precious_chest_number),
    stat("精致宝箱", s.exquisite_chest_number),
    stat("普通宝箱", s.common_chest_number),
    stat("奇馈宝箱", s.magic_chest_number)
  ]
  const h = raw.homes?.[0]
  const home = h
    ? [stat("信任等阶", h.level), stat("最高洞天仙力", h.comfort_num), stat("获得摆设数", h.item_num), stat("历史访客数", h.visit_num)]
    : []

  // 接口给的是千分数（`889` 表示 88.9%），除以 10 才是百分比
  const explore: ExploreItem[] = (raw.world_explorations ?? [])
    .map(it => {
      const one: ExploreItem = { label: it.name ?? "未知地区", percent: num(it.exploration_percentage) / 10 }
      const offering = it.offerings?.[0]
      if (offering?.name) one.extra = `${offering.name} ${num(offering.level)} 级`
      else if (num(it.level)) one.extra = `声望 ${num(it.level)} 级`
      return one
    })
    .sort((a, b) => b.percent - a.percent)

  const avatars = (raw.avatars ?? []).map(it => {
    const id = String(it.id ?? "")
    const one: AvatarBrief = {
      id,
      name: TRAVELER[id] ?? it.name ?? "未知",
      level: num(it.level),
      rarity: Math.min(5, num(it.rarity)),
      cons: num(it.actived_constellation_num)
    }
    if (it.icon) one.icon = it.icon
    // 接口给 `Pyro`，css 的类是元素键 `e-pyro`：原样拼则整排没有元素色
    const elem = elemOf(it.element ?? "")
    if (elem) one.element = elem
    return one
  })

  const body: ProfileBody = {
    nickname: raw.role?.nickname ?? "",
    level: num(raw.role?.level),
    activeDays: num(s.active_day_number),
    stats,
    explore,
    avatars: rank(avatars, limit),
    home,
    homeName: h?.comfort_level_name ?? ""
  }
  if (raw.role?.game_head_icon) body.icon = raw.role.game_head_icon
  return body
}

/**
 * 星穹铁道 index → 视图
 *
 * 星铁的 index 不给游戏昵称与开拓等级（那两项在 `bindings` 里），这里留空让上层回落。
 * @param raw 原始数据
 * @param limit 角色简表上限
 * @returns 视图主体
 */
function fromSr(raw: SrIndexRaw, limit?: number): ProfileBody {
  const s = raw.stats ?? {}
  // 官方主页另有「货币战争」一格，index 不给，按约定不为它另打战绩接口
  const stats: StatItem[] = [
    stat("活跃天数", s.active_days),
    stat("已解锁角色", s.avatar_num),
    stat("战利品开启", s.chest_num),
    stat("达成成就数", s.achievement_num),
    stat("随宠款式", s.pet_num),
    stat("逐光捡金", dash(s.abyss_process)),
    stat("差分宇宙", dash(s.season_title))
  ]

  const avatars = (raw.avatar_list ?? []).map(it => {
    const one: AvatarBrief = {
      id: String(it.id ?? ""),
      name: it.name ?? "未知",
      level: num(it.level),
      rarity: num(it.rarity),
      cons: num(it.rank)
    }
    if (it.icon) one.icon = it.icon
    if (it.element) one.element = it.element.toLowerCase()
    return one
  })

  const body: ProfileBody = {
    nickname: "",
    level: 0,
    activeDays: num(s.active_days),
    stats,
    explore: [],
    avatars: rank(avatars, limit),
    home: [],
    homeName: ""
  }
  if (raw.cur_head_icon_url) body.icon = raw.cur_head_icon_url
  if (raw.phone_background_image_url) body.bg = raw.phone_background_image_url
  return body
}

/**
 * 绝区零 index → 视图
 * @param raw 原始数据
 * @param limit 角色简表上限
 * @param faceOf 按 id 取元数据头像
 * @returns 视图主体
 */
function fromZzz(raw: ZzzIndexRaw, limit?: number, faceOf?: (id: string) => string): ProfileBody {
  const s = raw.stats ?? {}
  const hadal = s.hadal_brief?.hadal_brief_v2
  const vf = s.void_front_brief
  // 官方主页另有鏖战试炼、拟真鏖战试炼两格，index 里那两段在没打时为 null、打过时形态未见过，故不印
  const stats: StatItem[] = [
    stat("活跃天数", s.active_days),
    stat("危局强袭战", dash(hadal?.rating)),
    stat("式舆防卫战", dash(s.cur_period_zone_layer_count)),
    stat("临界推演", vf?.has_ending_record ? dash(vf.ending_record_name) : "-"),
    stat("获得代理人数", s.avatar_num),
    stat("获得邦布数", s.buddy_num),
    stat("达成成就数", s.achievement_count),
    stat("运筹中枢修复计划", dash(s.rab_brief?.cur_stage)),
    stat("绳网声望", dash(s.world_level_name)),
    stat("「布连邦」账号等级", dash(s.bangboo_micro_web_brief?.level))
  ]

  const avatars = (raw.avatar_list ?? []).map(it => {
    const one: AvatarBrief = {
      id: String(it.id ?? ""),
      name: it.name_mi18n ?? "未知",
      level: num(it.level),
      rarity: ZZZ_RARITY[it.rarity ?? ""] ?? 0,
      cons: num(it.rank)
    }
    // 不回落到 group_icon_path：那是阵营徽记，画出来是一排云岿山、狡兔屋的牌子
    const face = one.id ? (faceOf?.(one.id) ?? "") : ""
    if (face) one.icon = face
    const elem = ZZZ_ELEM_CSS[String(it.element_type ?? "")]
    if (elem) one.element = elem
    return one
  })

  const body: ProfileBody = {
    nickname: "",
    level: 0,
    activeDays: num(s.active_days),
    stats,
    explore: [],
    avatars: rank(avatars, limit),
    home: [],
    homeName: ""
  }
  if (raw.cur_head_icon_url) body.icon = raw.cur_head_icon_url
  const show = raw.game_data_show
  if (show?.card_url) body.bg = show.card_url
  if (show?.personal_title) {
    body.title = { text: show.personal_title, main: color(show.title_main_color), bottom: color(show.title_bottom_color) }
  }
  return body
}

/**
 * index 原始数据 → 账号总览视图
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @returns 视图
 */
export function buildProfile(raw: IndexRaw, ctx: ProfileContext): ProfileView {
  const body =
    ctx.game === "sr"
      ? fromSr(raw as SrIndexRaw, ctx.limit)
      : ctx.game === "zzz"
        ? fromZzz(raw as ZzzIndexRaw, ctx.limit, ctx.faceOf)
        : fromGs(raw as GsIndexRaw, ctx.limit)
  return {
    game: ctx.game,
    gameName: GAME_NAMES[ctx.game],
    uid: ctx.uid,
    region: REGION_NAMES[resolveRegionKind(ctx.uid, ctx.game)],
    name: ctx.name,
    ...body,
    areas: [],
    // 接口未提供游戏昵称时采用聊天平台的昵称，优于显示空值
    nickname: body.nickname || ctx.name
  }
}

/**
 * 账号总览视图 → 纯文字
 *
 * 统计条目太多，纯文字里只留前六条（再多要翻屏、翻屏等于没有），想看全的去看图。
 * @param view 视图
 * @returns 多行文本
 */
export function profileText(view: ProfileView): string {
  const lines = [
    `${view.nickname} ${view.uid}（${view.region}）`,
    `${view.gameName} ${view.level} 级，活跃 ${view.activeDays} 天`,
    // 活跃天数已在第二行
    ...view.stats
      .filter(it => it.label !== "活跃天数")
      .slice(0, 6)
      .map(it => `${INDENT}${it.label} ${it.value}`)
  ]
  if (view.explore.length) {
    const top = view.explore.slice(0, 3).map(it => `${it.label} ${it.percent}%`)
    lines.push(`探索度 ${top.join("、")}`)
  }
  if (view.avatars.length) {
    const top = view.avatars.slice(0, 5).map(it => `${it.name}${it.level}`)
    lines.push(`角色 ${view.avatars.length} 个：${top.join("、")}${view.avatars.length > 5 ? " …" : ""}`)
  }
  return lines.join("\n")
}
