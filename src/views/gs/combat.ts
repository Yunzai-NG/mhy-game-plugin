/**
 * 模块职责：幻想真境剧诗与月谕圣牌 —— 把 `role_combat` 的返回转成既有模板要的形态
 * 依赖方向：依赖 core/text（时间格式化）、meta/elem（元素键归一）与 views/avatar-list 的卡片类型；纯函数，不发请求
 * 生命周期：无状态
 * 注意事项：**接口只在「已解锁且本期有明细」时才有内容**：`is_unlock` 为假是「还没打开这个模式」、`has_detail_data` 为假是「打过但明细还没生成」（后者过一阵再查就有），要分开说、直接出图会得一张全 0 的图。
 *          **两处显示值接口本不给、由本层补**（模板读 `stat.start_time`/`round.finish`，接口给的是 `schedule.start_time` 秒级戳与 `round.finish_time`）。**头像走元数据**（按 id 取目录名、取不到退回接口地址；旅行者接口名「旅行者」而目录是「空」/「荧」）。
 *          **月谕圣牌与本模式同一条接口**（只读返回里的 `tarot_card_state`，不需新接口）；圣牌那几幕按 `is_tarot` + `tarot_serial_no`（官方印罗马数字）编号、按幕数印会出现两个「第 3 幕」。
 */
import { INDENT, stamp } from "../../core/text.js"
import { elemOf } from "../../meta/elem.js"
import type { AvatarCardView } from "../avatar-list.js"

/** 接口返回里的一个角色 */
export interface CombatAvatarRaw {
  /** 角色 id */
  avatar_id?: number
  /** 1 自有、2 试用、3 助演 */
  avatar_type?: number
  /** 角色名 */
  name?: string
  /** 元素，形如 `Pyro` */
  element?: string
  /** 米游社给的头像地址 */
  image?: string
  /** 等级 */
  level?: number
  /** 星级 */
  rarity?: number
}

/** 一幕的记录 */
export interface CombatRoundRaw {
  /** 上场角色 */
  avatars?: CombatAvatarRaw[]
  /** 选中的诗筹 */
  choice_cards?: { icon?: string; name?: string }[]
  /** 生效的祝福 */
  buffs?: { icon?: string; name?: string }[]
  /** 是否拿到明星挑战星章 */
  is_get_medal?: boolean
  /** 第几幕 */
  round_id?: number
  /** 完成时刻，秒级时间戳 */
  finish_time?: number | string
  /** 这一幕是不是圣牌挑战 */
  is_tarot?: boolean
  /** 圣牌挑战的序号，官方印作罗马数字 */
  tarot_serial_no?: number
  /** 讨伐列表 */
  enemies?: { name?: string; icon?: string; level?: number }[]
  /** 辉彩祝福：总等级与逐项等级 */
  splendour_buff?: {
    /** 总等级，为 0 时官方整块不画 */
    summary?: { total_level?: number }
    /** 逐项 */
    buffs?: { name?: string; icon?: string; level?: number }[]
  }
}

/** 战斗数据里的一项：带角色的那几项给 id，数值是接口原样的串 */
export interface CombatStatAvatarRaw {
  /** 角色 id */
  avatar_id?: number
  /** 米游社给的头像地址，本插件不取（见 official-api-is-data-only） */
  avatar_icon?: string
  /** 数值，接口多给串 */
  value?: number | string
  /** 星级 */
  rarity?: number
}

/** 一期的战斗数据，在 `detail.fight_statisic` */
export interface CombatFightRaw {
  /** 最高伤害输出 */
  max_damage_avatar?: CombatStatAvatarRaw
  /** 击败最多敌人 */
  max_defeat_avatar?: CombatStatAvatarRaw
  /** 最高承受伤害 */
  max_take_damage_avatar?: CombatStatAvatarRaw
  /** 本次消耗幻剧之花，不带角色 */
  total_coin_consumed?: CombatStatAvatarRaw
  /** 最快完成演出队伍 */
  shortest_avatar_list?: CombatStatAvatarRaw[]
  /** 演出总时长，秒 */
  total_use_time?: number
  /** 为假时官方整块不画 */
  is_show_battle_stats?: boolean
}

/** 一期的统计 */
export interface CombatStatRaw {
  /** 难度：1 轻简、2 普通、3 困难、4 卓越、5 月谕 */
  difficulty_id?: number
  /** 最高幕数 */
  max_round_id?: number
  /** 纹章数 */
  heraldry?: number
  /** 逐幕是否拿到星章，`1` 拿到、`0` 没拿到 —— **是逐幕的标记，不是幕号** */
  get_medal_round_list?: number[]
  /** 消耗的幻剧之花 */
  coin_num?: number
  /** 触发场外观众声援次数 */
  avatar_bonus_num?: number
  /** 助演角色支援其他玩家次数 */
  rent_cnt?: number
  /** 已完成的圣牌数，月谕模式下官方在标题后印「圣牌N」 */
  tarot_finished_cnt?: number
}

/** 月谕圣牌收藏里的一张牌 */
export interface TarotCardRaw {
  /** 牌名 */
  name?: string
  /** 图，米游社给的绝对地址 */
  icon?: string
  /** 是否已解锁 */
  is_unlock?: boolean
  /** 已获得几张，大于 1 时官方在右上角印一个数字 */
  unlock_num?: number
}

/** 月谕圣牌的收藏进度，与剧诗同一条接口返回 */
export interface TarotCardStateRaw {
  /** 逐张牌 */
  list?: TarotCardRaw[]
  /** 已解锁张数 */
  curr_num?: number
  /** 总张数 */
  total_num?: number
}

/** 一期的完整返回 */
export interface CombatSeasonRaw {
  /** 明细 */
  detail?: { rounds_data?: CombatRoundRaw[]; fight_statisic?: CombatFightRaw }
  /** 统计 */
  stat?: CombatStatRaw
  /** 期次 */
  schedule?: { start_time?: number | string; end_time?: number | string; schedule_id?: number }
  /** 本期有没有战绩 */
  has_data?: boolean
  /** 明细是否已生成 */
  has_detail_data?: boolean
}

/** `role_combat` 的返回 */
export interface RoleCombatRaw {
  /** 逐期，第一项是本期 */
  data?: CombatSeasonRaw[]
  /** 该账号是否已解锁 */
  is_unlock?: boolean
  /**
   * 月谕圣牌的收藏进度
   *
   * **与剧诗同一条接口**：官方那个子页面（`/ys/role-combat/tarot`）打的就是 `role_combat`，
   * 只读这一个键，故 `#月谕圣牌` 不需要新接口。它在逐期数组之外，不随期次变化。
   */
  tarot_card_state?: TarotCardStateRaw
}

/** 出图要的上下文 */
export interface CombatContext {
  /** uid */
  uid: string
  /** 玩家信息，取自 `index` 接口的 `role` */
  role?: { nickname?: string; level?: number; game_head_icon?: string; AvatarUrl?: string }
  /** 按角色 id 取元数据里的头像相对路径，取不到时返回空串 */
  faceOf?: (id: string) => string
  /** 自有角色的整卡（天赋 / 武器 / 圣遗物），由 `index` 加面板库造；试用与助演角色不从这里取 */
  cards?: Readonly<Record<string, AvatarCardView>>
}

/** 试用 / 助演角色卡右上角那枚标 */
const TYPE_MARK: Readonly<Record<number, string>> = { 2: "试用", 3: "助演" }

/**
 * 玩家信息补成全壳
 *
 * 模板直接印 `role.nickname` 与 `role.game_head_icon`，而那次 `index` **允许失败**（见 commands/gs/combat.ts）—— 给空对象会让图上印出字面的 `undefined`。
 * @param role 上下文里的玩家信息
 * @returns 三项都有值的一份
 */
function roleShell(role: CombatContext["role"]): Record<string, unknown> {
  return {
    nickname: role?.nickname ?? "",
    level: Number(role?.level) || 0,
    game_head_icon: role?.game_head_icon ?? role?.AvatarUrl ?? "",
    AvatarUrl: role?.AvatarUrl ?? ""
  }
}

/** 判定结果 */
export type CombatState = "ok" | "locked" | "noData" | "noDetail"

/**
 * 取本期
 * @param raw 接口返回
 * @returns 本期；没有时 undefined
 */
export function combatSeason(raw: RoleCombatRaw | undefined): CombatSeasonRaw | undefined {
  return raw?.data?.[0]
}

/**
 * 判这份返回能不能出图
 *
 * 三种不出图的情形要分开说：没解锁、没打过、明细还没生成。
 * @param raw 接口返回
 * @returns 判定结果
 */
export function combatState(raw: RoleCombatRaw | undefined): CombatState {
  if (raw?.is_unlock === false) return "locked"
  const season = combatSeason(raw)
  if (!season || season.has_data === false) return "noData"
  if (season.has_detail_data === false) return "noDetail"
  if ((season.detail?.rounds_data ?? []).length === 0) return "noData"
  return "ok"
}

/** 难度名，下标即 `difficulty_id`；官方那张表是「轻简模式」…「月谕模式」，此处只留那个词 */
const DIFFICULTY: Readonly<Record<string, string>> = {
  1: "轻简",
  2: "普通",
  3: "困难",
  4: "卓越",
  5: "月谕"
}

/** 月谕模式的 `difficulty_id`，官方在这一档才印圣牌数 */
const MOON_DIFFICULTY = 5

/** 圣牌挑战的序号 → 展示写法，官方就印罗马数字 */
const TAROT_SERIAL: Readonly<Record<string, string>> = { 1: "I", 2: "II" }

/**
 * 取难度名
 * @param id 难度 id
 * @returns 难度名；不认得时为空串
 */
export function combatDifficulty(id: number | undefined): string {
  return DIFFICULTY[String(id ?? "")] ?? ""
}

/**
 * 秒级时间戳 → "08-22 10:05"
 *
 * 模板读 `stat.start_time` 与 `round.finish` 两处，而接口给的是 `schedule.start_time`
 * 与 `round.finish_time`，故这两处的显示值由本层补，见文件头。
 * @param sec 秒级时间戳，接口有时给字符串
 * @returns 可读时刻；没有时为空串
 */
export function combatTimeText(sec: number | string | undefined): string {
  const num = Number(sec) || 0
  return num > 0 ? stamp(num * 1000) : ""
}

/** 模板要的一个上场角色 */
export interface CombatAvatarView extends Record<string, unknown> {
  /** 角色 id，模板按它到 `avatars` 里取整卡 */
  id: string
  /** 角色名 */
  name: string
  /** 元素键，小写 */
  element: string
  /** 头像，相对元数据根目录 */
  face: string
  /** 等级 */
  level: number
  /** 星级，模板据此选底色 */
  rarity: number
  /** 1 自有、2 试用、3 助演 */
  avatar_type: number
}

/** 模板要的一幕 */
export interface CombatRoundView extends Record<string, unknown> {
  /** 第几幕 */
  round_id: number
  /** 完成时刻，已格式化 */
  finish: string
  /** 是否拿到星章 */
  is_get_medal: boolean
  /** 这一幕是不是圣牌挑战 */
  is_tarot: boolean
  /** 标题：圣牌挑战印「圣牌挑战 I」，其余印「第 N 幕」 */
  title: string
  /** 上场角色 */
  avatars: CombatAvatarView[]
  /** 奇妙助益 */
  buffs: { icon: string; name: string }[]
  /** 神秘收获 */
  choice_cards: { icon: string; name: string }[]
  /** 讨伐列表 */
  enemies: { icon: string; name: string; level: number }[]
  /** 辉彩祝福总等级，0 时模板整块不画 */
  splendour: number
  /** 辉彩祝福逐项 */
  splendourBuffs: { icon: string; name: string; level: number }[]
  /** 祝福总等级换成的四项属性加成（每级生命 800、攻防 50、精通 20） */
  splendourGain: { hp: number; atk: number; def: number; em: number }
}

/** 战斗数据的一格 */
export interface CombatFightCell extends Record<string, unknown> {
  /** 项名 */
  title: string
  /** 数值，原样 */
  value: string
  /** 角色头像，相对元数据根；该项不带角色或查不到时为空串 */
  face: string
  /** 星级 */
  star: number
}

/**
 * 演出总时长 → 「12分钟5秒」，官方页面同此写法
 * @param sec 秒
 * @returns 可读时长；没有时为空串
 */
function useTimeText(sec: unknown): string {
  const num = Number(sec) || 0
  return num > 0 ? `${Math.floor(num / 60)}分钟${num % 60}秒` : ""
}

/**
 * 逐幕星章标记 → 模板逐枚画的一串
 *
 * 月谕模式第 10 枚之后官方画一道竖线隔开圣牌那几幕，`gap` 即那一枚之后要不要画线。
 * @param list 接口的 `get_medal_round_list`
 * @param difficulty 难度 id
 * @returns 逐枚
 */
function medalsOf(list: number[], difficulty: number): { on: boolean; gap: boolean }[] {
  return list.map((one, i) => ({ on: Number(one) === 1, gap: difficulty === MOON_DIFFICULTY && i === 9 && i < list.length - 1 }))
}

/**
 * 一幕的标题
 *
 * 圣牌挑战那几幕不按幕数编号，官方印的是「圣牌挑战 I」/「圣牌挑战 II」 —— 仍按幕数印会
 * 出现两个「第 3 幕」。序号认不出时退回幕数，不编一个罗马数字。
 * @param one 一幕的原始记录
 * @returns 标题
 */
export function combatRoundTitle(one: CombatRoundRaw): string {
  const round = Number(one.round_id) || 0
  if (one.is_tarot !== true) return `第${round}幕`
  const serial = TAROT_SERIAL[String(one.tarot_serial_no ?? "")]
  return serial === undefined ? `第${round}幕` : `圣牌挑战 ${serial}`
}

/**
 * 辉彩祝福总等级 → 四项属性加成
 * @param level 总等级
 * @returns 生命上限、攻击、防御、元素精通各加多少
 */
export function splendourGainOf(level: number): { hp: number; atk: number; def: number; em: number } {
  return { hp: level * 800, atk: level * 50, def: level * 50, em: level * 20 }
}

/** 剧诗里的一张卡：多一枚试用 / 助演标 */
type CombatCard = AvatarCardView & { mark?: string }

/**
 * 各幕上场角色 → 角色 id → 整卡
 *
 * **试用与助演角色不取面板库**：那是官方借给你的配装，画成自己那份等于张冠李戴；只给头像等级，右上角印「试用」/「助演」。
 * 自有角色面板库里没有时同样退回只带头像的卡，模板印「暂无天赋数据」。
 * @param rounds 各幕原始记录
 * @param ctx 上下文
 * @returns 角色 id → 卡；同一 id 在不同幕里身份不变，取先见到的那份
 */
function combatCards(rounds: readonly CombatRoundRaw[], ctx: CombatContext): Record<string, CombatCard> {
  const faceOf = ctx.faceOf ?? ((): string => "")
  const out: Record<string, CombatCard> = {}
  for (const one of rounds) {
    for (const it of one.avatars ?? []) {
      if (it.avatar_id === undefined) continue
      const id = String(it.avatar_id)
      if (out[id]) continue
      const type = Number(it.avatar_type) || 1
      const own = type === 1 ? ctx.cards?.[id] : undefined
      if (own) {
        out[id] = own
        continue
      }
      const mark = TYPE_MARK[type]
      out[id] = {
        id,
        name: it.name ?? "",
        abbr: it.name ?? "",
        elem: elemOf(it.element ?? "", ""),
        star: Number(it.rarity) || 4,
        level: Number(it.level) || 0,
        cons: 0,
        game: "gs",
        face: faceOf(id),
        gacha: "",
        preview: "",
        talent: {},
        tals: [],
        xtals: [],
        weapon: { star: 0, img: "", affix: 0 },
        artisSet: { names: [], imgs: [] },
        ...(mark ? { mark } : {})
      }
    }
  }
  return out
}

/**
 * 把一份 `role_combat` 转成 `gs/combat` 要的形态
 *
 * **三处不可省的兜底，缺一整张图都出不来**：模板对 `round.buffs` 与 `round.choice_cards`
 * 取 `.length`，而接口在"那一幕没有祝福"时**不给这两个键** —— 取 undefined 的 `length`
 * 抛错，而出图失败只会退回纯文字，日志里看不出是哪一行。`avatars` 同样兜一个空数组。
 *
 * **元素键要转小写**：接口给的是 `Pyro`，而图标文件名是 `pyro.png`。不转的表现是每个角色
 * 右下角那枚元素角标空白。
 *
 * **头像按角色 id 到元数据里取目录名**，不按接口给的名字拼路径：旅行者的接口名是「旅行者」
 * 而元数据目录是「空」/「荧」，按名字拼必然空白。取不到时留空串，模板画一个空格子。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function combatTemplateData(raw: RoleCombatRaw | undefined, ctx: CombatContext): Record<string, unknown> {
  const season = combatSeason(raw)
  const stat = season?.stat ?? {}
  const faceOf = ctx.faceOf ?? ((): string => "")

  const rounds: CombatRoundView[] = (season?.detail?.rounds_data ?? []).map(one => ({
    round_id: Number(one.round_id) || 0,
    finish: combatTimeText(one.finish_time),
    is_get_medal: one.is_get_medal === true,
    is_tarot: one.is_tarot === true,
    title: combatRoundTitle(one),
    avatars: (one.avatars ?? []).map(it => ({
      id: it.avatar_id === undefined ? "" : String(it.avatar_id),
      name: it.name ?? "",
      element: elemOf(it.element ?? "", ""),
      face: it.avatar_id === undefined ? "" : faceOf(String(it.avatar_id)),
      level: Number(it.level) || 0,
      rarity: Number(it.rarity) || 4,
      avatar_type: Number(it.avatar_type) || 1
    })),
    buffs: (one.buffs ?? []).map(it => ({ icon: it.icon ?? "", name: it.name ?? "" })),
    choice_cards: (one.choice_cards ?? []).map(it => ({ icon: it.icon ?? "", name: it.name ?? "" })),
    enemies: (one.enemies ?? []).map(it => ({ icon: it.icon ?? "", name: it.name ?? "", level: Number(it.level) || 0 })),
    splendour: Number(one.splendour_buff?.summary?.total_level) || 0,
    splendourBuffs: (one.splendour_buff?.buffs ?? []).map(it => ({
      icon: it.icon ?? "",
      name: it.name ?? "",
      level: Number(it.level) || 0
    })),
    splendourGain: splendourGainOf(Number(one.splendour_buff?.summary?.total_level) || 0)
  }))

  const difficulty = Number(stat.difficulty_id) || 0
  const medalList = stat.get_medal_round_list ?? []
  const fight = season?.detail?.fight_statisic ?? {}
  const cell = (title: string, one: CombatStatAvatarRaw | undefined): CombatFightCell[] =>
    one
      ? [
          {
            title,
            value: String(one.value ?? "") || "-",
            face: one.avatar_id === undefined ? "" : faceOf(String(one.avatar_id)),
            star: Number(one.rarity) || 5
          }
        ]
      : []
  // 官方在 `is_show_battle_stats` 为假时整块不画；头像只走元数据，接口那个地址不用
  const cells =
    fight.is_show_battle_stats === true
      ? [
          ...cell("最高伤害输出", fight.max_damage_avatar),
          ...cell("击败最多敌人", fight.max_defeat_avatar),
          ...cell("最高承受伤害", fight.max_take_damage_avatar),
          ...cell("消耗幻剧之花", fight.total_coin_consumed)
        ]
      : []
  const shortest =
    fight.is_show_battle_stats === true
      ? (fight.shortest_avatar_list ?? []).map(it => ({
          face: it.avatar_id === undefined ? "" : faceOf(String(it.avatar_id)),
          star: Number(it.rarity) || 5
        }))
      : []

  return {
    uid: ctx.uid,
    role: roleShell(ctx.role),
    stat: {
      ...stat,
      difficulty_id: difficulty,
      // 难度名由本层给，模板不再自带一张同样的表 —— 两张表里只改一处的表现是那一行空白
      difficultyName: combatDifficulty(difficulty),
      max_round_id: Number(stat.max_round_id) || 0,
      heraldry: Number(stat.heraldry) || 0,
      get_medal_round_list: medalList,
      medals: medalsOf(medalList, difficulty),
      medal_num: medalList.filter(it => Number(it) === 1).length,
      use_time: useTimeText(fight.total_use_time),
      coin_num: Number(stat.coin_num) || 0,
      avatar_bonus_num: Number(stat.avatar_bonus_num) || 0,
      rent_cnt: Number(stat.rent_cnt) || 0,
      // 官方只在月谕模式印这一项，其余难度那一栏根本不出现
      tarot_finished_cnt: difficulty >= MOON_DIFFICULTY ? Number(stat.tarot_finished_cnt) || 0 : 0,
      // 模板把它印在难度那一行的角标上，而接口把开启时刻放在 `schedule` 里
      start_time: combatTimeText(season?.schedule?.start_time)
    },
    fight: { cells, shortest },
    detail: { rounds_data: rounds },
    avatars: combatCards(season?.detail?.rounds_data ?? [], ctx)
  }
}

/**
 * 幻想真境剧诗的纯文字形态
 *
 * 无渲染器时用。逐幕只列上场角色名 —— 祝福与诗筹只有图标没有可读名称，列不出来。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function combatText(raw: RoleCombatRaw | undefined, ctx: CombatContext): string {
  const season = combatSeason(raw)
  const stat = season?.stat ?? {}
  const lines = [`UID${ctx.uid} 幻想真境剧诗`]
  const mode = combatDifficulty(stat.difficulty_id)
  lines.push(`${mode ? `${mode}模式，` : ""}最佳记录第 ${Number(stat.max_round_id) || 0} 幕，纹章 ${Number(stat.heraldry) || 0}`)

  // 月谕模式才有圣牌，其余难度不提这一句
  if ((Number(stat.difficulty_id) || 0) >= MOON_DIFFICULTY) {
    lines.push(`圣牌 ${Number(stat.tarot_finished_cnt) || 0}`)
  }

  // 逐幕标记，数 1 的个数；月谕模式第 10 枚之后是圣牌那几幕，按幕号列会编出「第 11 幕」
  const medals = (stat.get_medal_round_list ?? []).filter(it => Number(it) === 1).length
  if (medals > 0) lines.push(`明星挑战星章 ${medals} 枚`)
  lines.push(`消耗幻剧之花 ${Number(stat.coin_num) || 0}，场外声援 ${Number(stat.avatar_bonus_num) || 0} 次`)

  for (const one of season?.detail?.rounds_data ?? []) {
    const names = (one.avatars ?? []).map(it => it.name ?? "").filter(it => it !== "")
    lines.push(`${combatRoundTitle(one)}${one.is_get_medal ? "（星章）" : ""}：${names.join("、") || "无记录"}`)
  }
  return lines.join("\n")
}

/** 月谕圣牌收藏的判定结果 */
export type TarotState = "ok" | "locked" | "noData"

/**
 * 判月谕圣牌那份收藏能不能出图
 *
 * `is_unlock` 为假是"这个账号还没打开幻想真境剧诗"；解锁了但 `tarot_card_state` 是空的，
 * 那是"这一期没有月谕模式"（该玩法逐期开放），两者要分开说。
 * @param raw 接口返回
 * @returns 判定结果
 */
export function tarotState(raw: RoleCombatRaw | undefined): TarotState {
  if (raw?.is_unlock === false) return "locked"
  return (raw?.tarot_card_state?.list ?? []).length > 0 ? "ok" : "noData"
}

/** 模板要的一张牌 */
export interface TarotCardView extends Record<string, unknown> {
  /** 牌名 */
  name: string
  /** 图，米游社给的绝对地址 */
  icon: string
  /** 是否已解锁 */
  unlock: boolean
  /** 已获得几张；官方只在多于一张时印这个数字，超过 999 印「999+」 */
  count: string
}

/** 一张牌最多印到几，再多印作 `999+`，与游戏内一致 */
const TAROT_COUNT_CAP = 999

/**
 * 把 `tarot_card_state` 转成 `gs/tarot` 要的形态
 *
 * 未解锁的牌官方画的是一张统一的背面图（`tarot_default.png`），本插件不带那张素材，
 * 由模板用一层遮罩加牌名代替 —— 故 `icon` 无论解锁与否都原样带出，解锁与否看 `unlock`。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function tarotTemplateData(raw: RoleCombatRaw | undefined, ctx: CombatContext): Record<string, unknown> {
  const state = raw?.tarot_card_state ?? {}
  const list = state.list ?? []
  const cards: TarotCardView[] = list.map(one => {
    const num = Number(one.unlock_num) || 0
    return {
      name: one.name ?? "",
      icon: one.icon ?? "",
      unlock: one.is_unlock === true,
      // 只有一张时不印数字，与官方一致
      count: num > 1 ? (num > TAROT_COUNT_CAP ? `${TAROT_COUNT_CAP}+` : String(num)) : ""
    }
  })

  return {
    uid: ctx.uid,
    saveId: ctx.uid,
    role: roleShell(ctx.role),
    // 接口给的两个计数与逐张牌可能不同步（比如接口只给了一部分），故各自原样带出
    current: Number(state.curr_num) || 0,
    total: Number(state.total_num) || cards.length,
    cards
  }
}

/**
 * 月谕圣牌的纯文字形态
 *
 * 无渲染器时用。二十余张牌全列出来要翻屏，故只列已解锁的那些。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function tarotText(raw: RoleCombatRaw | undefined, ctx: CombatContext): string {
  const view = tarotTemplateData(raw, ctx)
  const cards = view["cards"] as TarotCardView[]
  const got = cards.filter(one => one.unlock)
  const lines = [
    `UID${ctx.uid} 月谕圣牌`,
    `已收集 ${String(view["current"])}/${String(view["total"])}`
  ]
  if (got.length > 0) {
    lines.push(`${INDENT}${got.map(one => `${one.name}${one.count ? `×${one.count}` : ""}`).join("、")}`)
  }
  return lines.join("\n")
}
