/**
 * 模块职责：深境螺旋 / 混沌回忆的视图模型
 * 依赖方向：纯函数，依赖 region / text；不碰 IO
 * 生命周期：无状态
 * 注意事项：原神给「层-间」（`max_floor: "12-3"`）加五项战斗排行，星铁给一串 `all_floor_detail`，两者只「打到哪、几星、谁上场」三件事重合、视图只留这三件。
 *          **本模块不把角色 id 转成名字**：接口只给 id 与头像地址，取名要查元数据、那是本层不该有的依赖；图里头像已足以识别、纯文字回退只给数值。绝区零零号空洞不属此形态、本文件不涉及、命令层回退总览。
 */
import type { GameKey } from "../core/region.js"
import { GAME_NAMES, REGION_NAMES, resolveRegionKind } from "../core/region.js"
import { INDENT } from "../core/text.js"
import type { AvatarCardView } from "./avatar-list.js"

/** 一层 / 一个关卡的成绩 */
export interface AbyssFloor {
  /** 层名，原神是 `第 12 层`，星铁直接用接口给的关卡名 */
  name: string
  /** 已得星数 */
  star: number
  /** 满星数 */
  maxStar: number
}

/** 一项战斗排行（原神独有） */
export interface AbyssRank {
  /** 排行名，如 `最强一击` */
  label: string
  /** 数值 */
  value: number
  /** 角色 id */
  id: string
  /** 角色头像 */
  icon?: string
}

/** 一个出场角色 */
export interface AbyssActor {
  /** 角色 id */
  id: string
  /** 头像 */
  icon?: string
  /** 出场次数，星铁没有这项 */
  times?: number
}

/** 深渊视图 */
export interface AbyssView {
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
  /** 期数说明，如 `8 月上半` */
  season: string
  /** 最深抵达，原神是 `12-3`，星铁是层数 */
  deepest: string
  /** 总星数 */
  totalStar: number
  /** 战斗次数 */
  battles: number
  /** 逐层成绩 */
  floors: AbyssFloor[]
  /** 战斗排行，星铁为空数组 */
  ranks: AbyssRank[]
  /** 出场角色 */
  actors: AbyssActor[]
}

/** 造深渊视图时的上下文 */
export interface AbyssContext {
  /** 游戏 */
  game: GameKey
  /** uid */
  uid: string
  /** 查询者昵称 */
  name: string
  /** 期数，1 本期 2 上期 */
  schedule: number
}

/** 一条排行的原始形态 */
interface RawRank {
  /** 角色 id */
  avatar_id?: number
  /** 数值 */
  value?: number
  /** 头像，米游社给的绝对地址 */
  avatar_icon?: string
  /** 稀有度，模板据此挑底框 */
  rarity?: number
}

/** 一层里的一间的一个半场 */
interface RawBattle {
  /** 半场序号，1 上半 2 下半 */
  index?: number
  /** 开始时刻，unix 秒 */
  timestamp?: string | number
  /** 上场角色 */
  avatars?: {
    /** 角色 id */
    id?: number
    /** 头像 */
    icon?: string
    /** 等级 */
    level?: number
    /** 稀有度 */
    rarity?: number
  }[]
}

/** 原神深渊的原始字段 */
export interface GsAbyssRaw {
  /** 本期开始时间，unix 秒 */
  start_time?: string | number
  /** 最深抵达，如 `12-3` */
  max_floor?: string
  /** 总星数 */
  total_star?: number
  /** 战斗次数 */
  total_battle_times?: number
  /** 逐层 */
  floors?: {
    /** 层号 */
    index?: number
    /** 已得星 */
    star?: number
    /** 满星 */
    max_star?: number
    /** 逐间明细，`#深渊12层` 用它 */
    levels?: {
      /** 间号 */
      index?: number
      /** 已得星 */
      star?: number
      /** 两个半场 */
      battles?: RawBattle[]
    }[]
  }[]
  /** 出场次数排行 */
  reveal_rank?: RawRank[]
  /** 最强一击 */
  damage_rank?: RawRank[]
  /** 承受伤害 */
  take_damage_rank?: RawRank[]
  /** 击败最多 */
  defeat_rank?: RawRank[]
  /** 元素战技释放数 */
  normal_skill_rank?: RawRank[]
  /** 元素爆发次数 */
  energy_skill_rank?: RawRank[]
}

/** 星铁混沌回忆的原始字段 */
export interface SrAbyssRaw {
  /** 期数信息 */
  schedule?: {
    /** 开始时间 */
    begin_time?: {
      /** 年 */
      year?: number
      /** 月 */
      month?: number
      /** 日 */
      day?: number
    }
  }
  /** 最深抵达层数 */
  max_floor?: string
  /** 总星数 */
  star_num?: number
  /** 战斗次数 */
  battle_num?: number
  /** 逐关明细 */
  all_floor_detail?: {
    /** 关卡名 */
    name?: string
    /** 已得星 */
    star_num?: number
    /** 回合数 */
    round_num?: number
    /**
     * 逐个节点，键形如 `node_1`
     *
     * **不写死两个**：新档位每关有三个节点，只读前两个会静默丢掉第三个节点里的角色。
     */
    [key: `node_${number}`]:
      | {
          /** 上场角色 */
          avatars?: {
            /** 角色 id */
            id?: number | string
            /** 头像 */
            icon?: string
          }[]
        }
      | undefined
  }[]
}

/** 两个游戏的深渊原始数据 */
export type AbyssRaw = GsAbyssRaw | SrAbyssRaw

/** 原神五项战斗排行的字段名与展示名 */
const GS_RANKS: readonly (readonly [keyof GsAbyssRaw, string])[] = [
  ["damage_rank", "最强一击"],
  ["take_damage_rank", "承受伤害"],
  ["defeat_rank", "击败最多"],
  ["normal_skill_rank", "元素战技"],
  ["energy_skill_rank", "元素爆发"]
]

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
 * 原神深渊 → 视图
 *
 * **只统计 9 层及以上**：前八层随便打就满星，算进总星数会让这个数失去意义（群聊说的「36 星」即 9~12 层）。
 * @param raw 原始数据
 * @returns 视图主体
 */
function fromGs(raw: GsAbyssRaw): Pick<AbyssView, "season" | "deepest" | "totalStar" | "battles" | "floors" | "ranks" | "actors"> {
  const deep = (raw.floors ?? []).filter(it => num(it.index) >= 9)
  const floors: AbyssFloor[] = deep.map(it => ({
    name: `第 ${num(it.index)} 层`,
    star: num(it.star),
    maxStar: num(it.max_star) || 9
  }))

  const ranks: AbyssRank[] = []
  for (const [key, label] of GS_RANKS) {
    const top = (raw[key] as RawRank[] | undefined)?.[0]
    if (!top) continue
    const one: AbyssRank = { label, value: num(top.value), id: String(top.avatar_id ?? "") }
    if (top.avatar_icon) one.icon = top.avatar_icon
    ranks.push(one)
  }

  const actors: AbyssActor[] = (raw.reveal_rank ?? []).map(it => {
    const one: AbyssActor = { id: String(it.avatar_id ?? ""), times: num(it.value) }
    if (it.avatar_icon) one.icon = it.avatar_icon
    return one
  })

  const start = num(raw.start_time)
  return {
    // 接口给出的是 unix 秒；以月份表述本期比"第几期"更易理解
    season: start > 0 ? `${new Date(start * 1000).getMonth() + 1} 月` : "本期",
    deepest: raw.max_floor ?? "-",
    totalStar: deep.reduce((sum, it) => sum + num(it.star), 0),
    battles: num(raw.total_battle_times),
    floors,
    ranks,
    actors
  }
}

/**
 * 就地认出一关里全部节点的上场角色
 *
 * 键形如 `node_1`，**个数不写死**，理由见 {@link SrAbyssRaw} 那一栏。
 * @param floor 一关的明细
 * @returns 逐个上场角色，含重复
 */
function srFloorAvatars(floor: Record<string, unknown>): { id?: number | string; icon?: string }[] {
  const out: { id?: number | string; icon?: string }[] = []
  for (const [key, value] of Object.entries(floor)) {
    if (!/^node_\d+$/.test(key) || value === null || typeof value !== "object") continue
    const avatars = (value as { avatars?: { id?: number | string; icon?: string }[] }).avatars
    if (Array.isArray(avatars)) out.push(...avatars)
  }
  return out
}

/**
 * 星铁混沌回忆 → 视图
 *
 * 星铁没有战斗排行，`ranks` 给空数组让模板整块隐藏；各节点的上场角色合起来去重。
 * @param raw 原始数据
 * @returns 视图主体
 */
function fromSr(raw: SrAbyssRaw): Pick<AbyssView, "season" | "deepest" | "totalStar" | "battles" | "floors" | "ranks" | "actors"> {
  const detail = raw.all_floor_detail ?? []
  const floors: AbyssFloor[] = detail.map(it => ({
    name: it.name ?? "未知关卡",
    star: num(it.star_num),
    maxStar: 3
  }))

  const seen = new Map<string, AbyssActor>()
  for (const floor of detail) {
    for (const it of srFloorAvatars(floor as unknown as Record<string, unknown>)) {
      const id = String(it.id ?? "")
      if (!id || seen.has(id)) continue
      const one: AbyssActor = { id }
      if (it.icon) one.icon = it.icon
      seen.set(id, one)
    }
  }

  const begin = raw.schedule?.begin_time
  return {
    season: num(begin?.month) > 0 ? `${num(begin?.month)} 月` : "本期",
    deepest: raw.max_floor ?? "-",
    totalStar: num(raw.star_num) || floors.reduce((sum, it) => sum + it.star, 0),
    battles: num(raw.battle_num),
    floors,
    ranks: [],
    actors: [...seen.values()]
  }
}

/**
 * 深渊原始数据 → 视图
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @returns 视图
 */
export function buildAbyss(raw: AbyssRaw, ctx: AbyssContext): AbyssView {
  const body = ctx.game === "sr" ? fromSr(raw as SrAbyssRaw) : fromGs(raw as GsAbyssRaw)
  const last = ctx.schedule === 2
  /*
   * 期数名取不到时的兜底与期数本身有关：星铁上期的返回里 `schedule.begin_time.month`
   * 常为空，此时若一律兜成「本期」，再补上「（上期）」就得出「本期（上期）」。
   */
  const season = body.season === "本期" ? (last ? "上期" : "本期") : `${body.season}${last ? "（上期）" : ""}`
  return {
    game: ctx.game,
    gameName: GAME_NAMES[ctx.game],
    uid: ctx.uid,
    region: REGION_NAMES[resolveRegionKind(ctx.uid, ctx.game)],
    name: ctx.name,
    ...body,
    season
  }
}

/**
 * 深渊视图 → 纯文字
 *
 * 排行只报数字不报名字，原因见文件头：接口不给名字，而查名字要依赖插件。
 * @param view 视图
 * @returns 多行文本
 */
export function abyssText(view: AbyssView): string {
  const lines = [
    `${view.gameName} ${view.uid}（${view.region}）${view.season}`,
    `最深抵达 ${view.deepest}，共 ${view.totalStar} 星，战斗 ${view.battles} 次`,
    ...view.floors.map(it => `${INDENT}${it.name} ${it.star}/${it.maxStar}`)
  ]
  if (view.ranks.length) lines.push(view.ranks.map(it => `${it.label} ${it.value}`).join("，"))
  if (view.actors.length) lines.push(`出场 ${view.actors.length} 个角色`)
  return lines.join("\n")
}

/**
 * 判断本期是否完全没有挑战记录
 *
 * 一次未挑战时接口同样返回 retcode 0，仅各项取值为空。命令层据此回复"本期尚无记录"，
 * 而不生成一张各项均为 0 的图片。
 * @param view 视图
 * @returns 没有战斗记录就为 true
 */
export function abyssEmpty(view: AbyssView): boolean {
  return view.battles <= 0 && view.floors.every(it => it.star <= 0)
}

/** 传给既有模板的一份数据 */
export type TemplateData = Record<string, unknown>

/** 角色 id → 命座数，取自 index 接口 */
export type ConsMap = Readonly<Record<string, number>>

/** 顶部五张排行卡：次序即图上次序，两项伤害折成「万」、其余记次数 */
const STAT_CARDS: readonly { key: keyof GsAbyssRaw; title: string; wan: boolean }[] = [
  { key: "damage_rank", title: "最强一击", wan: true },
  { key: "take_damage_rank", title: "最高承伤", wan: true },
  { key: "defeat_rank", title: "最多击破", wan: false },
  { key: "normal_skill_rank", title: "元素战技", wan: false },
  { key: "energy_skill_rank", title: "元素爆发", wan: false }
]

/**
 * 半场开始时刻 → `MM-DD HH:mm:ss`
 * @param ts unix 秒
 * @returns 时刻文本；缺值时空串
 */
function battleTime(ts: unknown): string {
  const sec = num(ts)
  if (sec <= 0) return ""
  const d = new Date(sec * 1000)
  const two = (n: number): string => String(n).padStart(2, "0")
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
/**
 * index 里查不到的角色（试用角色、或 index 那次查询失败）的头像卡
 *
 * 只有接口给的头像、星级与等级；天赋、武器、套装三格给空壳，模板据此只画头像。
 * @param id 角色 id
 * @param icon 接口给的头像绝对地址
 * @param star 星级
 * @param level 等级
 * @returns 头像卡
 */
function fallbackCard(id: string, icon: string, star: number, level: number): AvatarCardView {
  return {
    id,
    name: "",
    abbr: "",
    elem: "",
    star,
    level,
    cons: 0,
    game: "gs",
    face: icon,
    gacha: "",
    preview: "",
    talent: {},
    tals: [],
    xtals: [],
    weapon: { star: 0, img: "", affix: 0 },
    artisSet: { names: [], imgs: [] }
  }
}

/**
 * 原神深渊 → `gs/abyss` 的模板数据
 *
 * 版式三块：顶部五项排行（立绘卡）、逐层取最后一间的上下半队伍（头像卡）、逐间的星数、时刻与上场头像。
 * 头像卡由调用方按 index + 面板库造好传入（与 `#角色列表` 同一份）；**查不到的 id 退回接口给的头像**，
 * 不丢掉 —— 试用角色本就不在 index 里，丢掉即那一格空白。
 * @param raw 原始数据
 * @param ctx 上下文
 * @param cards 角色 id → 头像卡
 * @returns 模板数据
 */
export function abyssTemplateData(
  raw: GsAbyssRaw,
  ctx: AbyssContext,
  cards: Readonly<Record<string, AvatarCardView>> = {}
): TemplateData {
  const avatars: Record<string, AvatarCardView> = {}
  const need = (id: unknown, icon?: string, star?: unknown, level?: unknown): string => {
    const key = id === undefined || id === null ? "" : String(id)
    if (!key) return ""
    avatars[key] ??= cards[key] ?? fallbackCard(key, icon ?? "", Math.min(5, num(star)) || 4, num(level))
    return key
  }

  const stat = STAT_CARDS.map(one => {
    const top = (raw[one.key] as RawRank[] | undefined)?.[0]
    const id = need(top?.avatar_id, top?.avatar_icon, top?.rarity)
    // 缺这一项时给空对象，模板照样占一格，五张卡的位置不因缺项而错开
    if (!id) return {}
    const card = avatars[id]
    const value = num(top?.value)
    return {
      title: one.title,
      id,
      value: one.wan ? `${(value / 10_000).toFixed(1)} W` : `${value}次`,
      // 立绘取不到（试用角色）时退回头像，模板按 `meta-` 前缀挑根
      banner: card?.gacha || card?.face || ""
    }
  })
  for (const it of raw.reveal_rank ?? []) need(it.avatar_id, it.avatar_icon, it.rarity)

  // 只列 9 层及以上，理由见 fromGs
  const floors = (raw.floors ?? [])
    .filter(it => num(it.index) >= 9)
    .map(floor => {
      const levels: Record<string, Record<string, unknown>> = {}
      for (const level of floor.levels ?? []) {
        const one: Record<string, unknown> = { index: num(level.index), star: num(level.star) }
        for (const battle of level.battles ?? []) {
          const ids = (battle.avatars ?? []).map(a => need(a.id, a.icon, a.rarity, a.level)).filter(Boolean)
          one[num(battle.index) === 1 ? "up" : "down"] = { time: battleTime(battle.timestamp), avatars: ids }
        }
        levels[String(num(level.index))] = one
      }
      return {
        index: num(floor.index),
        star: num(floor.star),
        maxStar: num(floor.max_star) || 9,
        levels,
        // 逐间那一排按间号排好给模板，模板里遍历对象键的次序不可靠
        levelList: Object.values(levels).sort((a, b) => num(a["index"]) - num(b["index"])),
        // 顶部那排队伍取打到的最后一间
        display: levels["3"] ?? levels["2"] ?? levels["1"] ?? {}
      }
    })

  const start = num(raw.start_time)
  const cardList = Object.values(avatars)
  return {
    uid: ctx.uid,
    saveId: ctx.uid,
    save_id: ctx.uid,
    msg: ctx.schedule === 2 ? "上期" : "",
    abyss: {
      schedule: start > 0 ? `${new Date(start * 1000).getMonth() + 1}月` : "本期",
      total: num(raw.total_battle_times),
      maxFloor: raw.max_floor ?? "-",
      // 与 fromGs 同口径：只算 9 层及以上
      totalStar: floors.reduce((sum, it) => sum + it.star, 0),
      maxStar: floors.reduce((sum, it) => sum + it.maxStar, 0),
      floors
    },
    avatars,
    stat,
    // 上场角色一个面板都没有（这个 uid 从没更新过面板）时页脚提示去更新 —— 否则满屏「暂无天赋数据」像是图坏了
    noPanel: cardList.length > 0 && cardList.every(card => Object.keys(card.talent).length === 0)
  }
}

/** 中文层数写法 → 层号，`#深渊十二层` 一类写法在群聊中常见 */
const CN_FLOOR: Readonly<Record<string, number>> = {
  九: 9,
  十: 10,
  十一: 11,
  十二: 12
}

/**
 * 从命令剩余文本里认出要看第几层
 *
 * 只认 9~12 层：前八层随手就能满星，米游社也不给它们的逐间明细。
 * @param text 命令剩余文本
 * @returns 层号；认不出时为 undefined
 */
export function resolveFloor(text: string): number | undefined {
  const hit = /(9|10|11|12|九|十一|十二|十)层/.exec(text)
  if (!hit?.[1]) return undefined
  const got = CN_FLOOR[hit[1]] ?? Number(hit[1])
  return got >= 9 && got <= 12 ? got : undefined
}

/**
 * 原神深渊某一层 → `gs/abyss-floor` 的模板数据
 *
 * 逐间明细的口径：只留打满两个半场的间，
 * 时刻取上半场的开始时刻。试用角色不在已拥有列表里，命座按 0 处理。
 * @param raw 原始数据
 * @param ctx 上下文
 * @param floorIndex 层号
 * @param cons 角色 id → 命座数
 * @returns 模板数据；该层无记录时为 undefined
 */
export function abyssFloorTemplateData(
  raw: GsAbyssRaw,
  ctx: AbyssContext,
  floorIndex: number,
  cards: Readonly<Record<string, AvatarCardView>> = {}
): TemplateData | undefined {
  const floor = (raw.floors ?? []).find(it => num(it.index) === floorIndex)
  if (!floor) return undefined

  // 与总览同一套：上场的存 id，头像卡另放一张表；查不到的退回接口给的头像（试用角色）
  const avatars: Record<string, AvatarCardView> = {}
  const need = (a: NonNullable<RawBattle["avatars"]>[number]): string => {
    const key = a.id === undefined ? "" : String(a.id)
    if (key) avatars[key] ??= cards[key] ?? fallbackCard(key, a.icon ?? "", Math.min(5, num(a.rarity)) || 4, num(a.level))
    return key
  }
  const rooms = (floor.levels ?? [])
    .filter(level => (level.battles ?? []).length >= 2)
    .map(level => {
      const room: Record<string, unknown> = { index: num(level.index), star: num(level.star) }
      for (const battle of level.battles ?? []) {
        room[num(battle.index) === 1 ? "up" : "down"] = {
          time: battleTime(battle.timestamp),
          avatars: (battle.avatars ?? []).map(need).filter(Boolean)
        }
      }
      return room
    })
    .sort((a, b) => num(a["index"]) - num(b["index"]))
  if (!rooms.length) return undefined

  return {
    uid: ctx.uid,
    saveId: ctx.uid,
    name: ctx.name,
    msg: ctx.schedule === 2 ? "上期" : "",
    floorIndex,
    floor: { star: num(floor.star), maxStar: num(floor.max_star) || 9 },
    rooms,
    avatars
  }
}
