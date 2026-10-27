/**
 * 模块职责：绝区零三类战绩的视图模型 —— 式舆防卫战、危局强袭战、拟境湮灭战
 * 依赖方向：纯函数，依赖 views/zzz/common 与 core/text；不发请求、不读元数据
 * 生命周期：无状态
 * 注意事项：三条接口**互不同形、官方自己就不一致**：式舆防卫战（`hadal_info_v2`）按防线分层（**第五层键官方拼错成 `fitfh`、照抄不可「修正」**），`buffer` 是对象、名字在 `title`；危局强袭战（`hadal_mem_detail_v2`）不分层、`buffer` 是数组、名字在 `name`、满分由接口给；拟境湮灭战（`holo_boss_detail`）逐场首领、**`challenge_time` 是用时**（按时刻排会印「0026-00-00 00:03:41」）。
 *          时刻/用时/排名/评级/阵容排版都在 views/zzz/common。**图一律绝对地址、不可加资源根**（加了拼成 `file:///…https://…`、空白），元数据方图用不上（接口那张随时装与影画变）。
 */
import { INDENT } from "../../core/text.js"
import type { ZzzAvatarCardView } from "./card.js"
import type { ZzzAvatarRaw, ZzzAvatarView, ZzzBossRaw, ZzzBuddyRaw, ZzzBufferRaw, ZzzIconOf, ZzzTimeRaw } from "./common.js"
import {
  zzzAvatars,
  zzzBoss,
  zzzBuddy,
  zzzCost,
  zzzCostOf,
  zzzDate,
  zzzBattleRank,
  zzzRank,
  zzzRankTier,
  zzzRating,
  zzzStars,
  zzzTeamText,
  zzzTime
} from "./common.js"

/** 式舆防卫战里的一间 */
export interface ZzzDefenseRoomRaw {
  /** 该间评级 */
  rating?: string
  /** 得分 */
  score?: number
  /** 敌人立绘 */
  monster_pic?: string
  /** 通关时刻 */
  challenge_time?: ZzzTimeRaw
  /** 增益，**是对象而非数组** */
  buffer?: {
    /** 增益名 */
    title?: string
  }
  /** 上场代理人 */
  avatar_list?: ZzzAvatarRaw[]
  /** 上场邦布 */
  buddy?: ZzzBuddyRaw
}
/** 式舆防卫战的一层防线 */
export interface ZzzDefenseLayerRaw {
  /** 该层评级 */
  rating?: string
  /** 通关时刻 */
  challenge_time?: ZzzTimeRaw
  /** 逐间 */
  layer_challenge_info_list?: ZzzDefenseRoomRaw[]
}

/** `hadal_info_v2` 里那一段正文 */
export interface ZzzDefenseRaw {
  /** 本期起 */
  hadal_begin_time?: ZzzTimeRaw
  /** 本期止 */
  hadal_end_time?: ZzzTimeRaw
  /** 第五层的总览 */
  brief?: {
    /** 总分 */
    score?: number
    /** 排名，放大一百倍 */
    rank_percent?: number
    /** 总评级 */
    rating?: string
    /** 通关时刻 */
    challenge_time?: ZzzTimeRaw
    /** 总用时，秒 */
    battle_time?: number
  }
  /** 第一层防线 */
  first_layer_detail?: ZzzDefenseLayerRaw
  /** 第二层防线 */
  second_layer_detail?: ZzzDefenseLayerRaw
  /** 第三层防线 */
  third_layer_detail?: ZzzDefenseLayerRaw
  /** 第四层防线 */
  fourth_layer_detail?: ZzzDefenseLayerRaw
  /** 第五层防线，**官方把 fifth 拼成了 fitfh** */
  fitfh_layer_detail?: ZzzDefenseLayerRaw
}

/** `hadal_info_v2` 接口的整份返回 */
export interface ZzzDefenseWrapRaw {
  /** 数据版本，只认 `v2` */
  hadal_ver?: string
  /** 正文 */
  hadal_info_v2?: ZzzDefenseRaw
}

/** 危局强袭战与拟境湮灭战共有的一场记录 */
export interface ZzzBattleRaw {
  /** 得分 */
  score?: number
  /** 已得星数 */
  star?: number
  /** 满星数 */
  total_star?: number
  /** 危局是通关时刻，拟境是用时 */
  challenge_time?: ZzzTimeRaw
  /** 逐场排名，拟境才有 */
  rank?: number
  /** 首领。危局给数组，拟境给对象 */
  boss?: ZzzBossRaw[] | ZzzBossRaw
  /** 增益。危局给数组 */
  buffer?: ZzzBufferRaw[]
  /** 上场代理人 */
  avatar_list?: ZzzAvatarRaw[]
  /** 上场邦布，拟境不给 */
  buddy?: ZzzBuddyRaw
}
/** `hadal_mem_detail_v2` 接口的返回 */
export interface ZzzDeadlyRaw {
  /** 有没有记录 */
  has_data?: boolean
  /** 本期起 */
  start_time?: ZzzTimeRaw
  /** 本期止 */
  end_time?: ZzzTimeRaw
  /** 排名，放大一百倍 */
  rank_percent?: number
  /** 昵称，这一条接口自带 */
  nick_name?: string
  /** 玩家头像，米游社的绝对地址 */
  avatar_icon?: string
  /** 总分 */
  total_score?: number
  /** 总星数 */
  total_star?: number
  /** 总分满分 */
  total_max_score?: number
  /** 单间满分 */
  room_max_score?: number
  /** 逐间 */
  list?: ZzzBattleRaw[]
  /** 绝境一档开没开 */
  has_hard?: boolean
  /** 绝境逐间 */
  hard_list?: ZzzBattleRaw[]
  /** 绝境排名，放大一百倍 */
  hard_rank_percent?: number
}

/** `holo_boss_detail` 接口的返回 */
export interface ZzzHoloRaw {
  /** 玩法开没开 */
  unlock?: boolean
  /** 本期起 */
  start_time?: ZzzTimeRaw
  /** 本期止 */
  end_time?: ZzzTimeRaw
  /** 逐场 */
  list?: ZzzBattleRaw[]
}

/** 出图与出文字共用的上下文 */
export interface ZzzChallengeContext {
  /** uid */
  uid: string
  /** 玩家昵称 */
  nickname?: string
  /** 期次说明，「本期」或「上期」 */
  period: string
  /**
   * 由代理人 id 取名称
   *
   * 接口只给 id 与方图，名字一律由元数据补 —— 与星铁那几张战绩图同一处置。补不到时图上
   * 只有头像、文字形态里只有 id，都不算错。
   */
  nameOf?: (id: string) => string
  /** 由 id 取元数据里那张方图；不给即用接口给的地址 */
  iconOf?: ZzzIconOf
  /** 代理人 id → 整卡（命令层从绝区零面板库造好）；给了就出整张代理人卡，不给出紧凑小卡 */
  cards?: Readonly<Record<string, ZzzAvatarCardView>>
  /** 按名字查代理人 id，拟真鏖战试炼的角色排行只给名字 */
  idOf?: (name: string) => string
}

/**
 * 式舆防卫战的满分
 *
 * 接口不给这两个数（危局强袭战那一路给），故此处写死；改版后表现只是满分角标不出现，不影响其余各项。
 */
const DEFENSE_MAX = { total: 150_000, room: 50_000 } as const

/** 判定结果：`old` 是旧版深渊的数据，`empty` 是这一期一次都没打 */
export type ZzzChallengeState = "ok" | "old" | "empty"
/** 五层防线由高到低，第五层在最上面 —— 与官方页面一致 */
const DEFENSE_LAYERS: readonly { key: keyof ZzzDefenseRaw; name: string }[] = [
  // 第五层那个键官方拼错成 fitfh，照抄
  { key: "fitfh_layer_detail", name: "剧变节点第五防线" },
  { key: "fourth_layer_detail", name: "剧变节点第四防线" },
  { key: "third_layer_detail", name: "剧变节点第三防线" },
  { key: "second_layer_detail", name: "剧变节点第二防线" },
  { key: "first_layer_detail", name: "剧变节点第一防线" }
]

/**
 * 判这份式舆防卫战返回能不能出图
 * @param wrap 接口返回
 * @returns 判定结果
 */
export function zzzDefenseState(wrap: ZzzDefenseWrapRaw | undefined): ZzzChallengeState {
  // 旧版深渊的字段整个不同名，按新版读会得到一张全零的图
  if (wrap?.hadal_ver !== "v2") return "old"
  const raw = wrap.hadal_info_v2
  const some = DEFENSE_LAYERS.some(
    it => ((raw?.[it.key] as ZzzDefenseLayerRaw | undefined)?.layer_challenge_info_list ?? []).length > 0
  )
  return some ? "ok" : "empty"
}

/**
 * 一间的出图形态，式舆防卫战用
 * @param raw 接口给的一间
 * @param nameOf 由 id 取名称
 * @returns 出图形态
 */
function defenseRoom(
  raw: ZzzDefenseRoomRaw,
  nameOf?: (id: string) => string,
  iconOf?: ZzzIconOf,
  cards?: Readonly<Record<string, ZzzAvatarCardView>>
): Record<string, unknown> {
  const score = raw.score ?? 0
  const buddy = zzzBuddy(raw.buddy, iconOf)
  return {
    score,
    full: score >= DEFENSE_MAX.room,
    rating: raw.rating ?? "",
    ratingClass: zzzRating(raw.rating),
    time: zzzTime(raw.challenge_time),
    // 增益在这一条接口里是对象，名字在 title 里；危局那一条是数组、在 name 里
    buff: raw.buffer?.title ?? "",
    monster: raw.monster_pic ?? "",
    avatars: zzzAvatars(raw.avatar_list, nameOf, iconOf, cards),
    ...(buddy ? { buddy } : {})
  }
}
/**
 * 式舆防卫战的出图数据
 * @param wrap 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzDefenseData(wrap: ZzzDefenseWrapRaw | undefined, ctx: ZzzChallengeContext): Record<string, unknown> {
  const raw = wrap?.hadal_info_v2
  const brief = raw?.brief
  const score = brief?.score ?? 0
  const layers = DEFENSE_LAYERS.map((it, idx) => {
    const layer = raw?.[it.key] as ZzzDefenseLayerRaw | undefined
    const rooms = (layer?.layer_challenge_info_list ?? []).map(one => defenseRoom(one, ctx.nameOf, ctx.iconOf, ctx.cards))
    return {
      // 第五层的总览另有一块，故模板要认得出哪一层是它
      top: idx === 0,
      name: it.name,
      rating: layer?.rating ?? "",
      ratingClass: zzzRating(layer?.rating),
      time: zzzTime(layer?.challenge_time),
      rooms
    }
  }).filter(it => it.rooms.length > 0)

  return {
    game: "zzz",
    title: "式舆防卫战",
    uid: ctx.uid,
    nickname: ctx.nickname ?? "",
    period: ctx.period,
    begin: zzzDate(raw?.hadal_begin_time),
    end: zzzDate(raw?.hadal_end_time),
    score,
    full: score >= DEFENSE_MAX.total,
    rating: brief?.rating ?? "",
    ratingClass: zzzRating(brief?.rating),
    rank: zzzRank(brief?.rank_percent),
    rankTier: zzzRankTier(brief?.rank_percent),
    time: zzzTime(brief?.challenge_time),
    cost: zzzCost(brief?.battle_time),
    layers
  }
}
/**
 * 一场战斗的出图形态，危局强袭战与拟境湮灭战共用
 *
 * 两处不同由 `duration` 分开：危局的 `challenge_time` 是通关时刻，拟境的是用时。
 * @param raw 接口给的一场
 * @param opts 单场满分、时间的含义与取名函数
 * @returns 出图形态
 */
function battleCard(
  raw: ZzzBattleRaw,
  opts: {
    maxScore: number
    duration: boolean
    nameOf?: (id: string) => string
    iconOf?: ZzzIconOf
    cards?: Readonly<Record<string, ZzzAvatarCardView>>
  }
): Record<string, unknown> {
  const score = raw.score ?? 0
  const boss = zzzBoss(raw.boss)
  const buff = raw.buffer?.[0]
  const rank = zzzBattleRank(raw.rank)
  // 邦布图同代理人一样优先查元数据（iconOf），否则退回接口给的长图
  const buddy = zzzBuddy(raw.buddy, opts.iconOf)

  return {
    score,
    full: opts.maxScore > 0 && score >= opts.maxScore,
    star: raw.star ?? 0,
    totalStar: raw.total_star ?? 0,
    stars: zzzStars(raw.star ?? 0, raw.total_star ?? 0),
    time: opts.duration ? "" : zzzTime(raw.challenge_time),
    cost: opts.duration ? zzzCostOf(raw.challenge_time) : "",
    rank: zzzRank(rank),
    rankTier: zzzRankTier(rank),
    boss: {
      name: boss.name ?? "",
      icon: boss.icon ?? "",
      race: boss.race_icon ?? "",
      bg: boss.bg_icon ?? ""
    },
    ...(boss.medal
      ? { medal: { icon: boss.medal.medal_icon ?? "", noInjured: boss.medal.is_no_injured === true } }
      : {}),
    buff: { name: buff?.name ?? "", icon: buff?.icon ?? "" },
    avatars: zzzAvatars(raw.avatar_list, opts.nameOf, opts.iconOf, opts.cards),
    ...(buddy ? { buddy } : {})
  }
}
/**
 * 判这份危局强袭战返回能不能出图
 * @param raw 接口返回
 * @returns 判定结果，这一路不存在旧版
 */
export function zzzDeadlyState(raw: ZzzDeadlyRaw | undefined): ZzzChallengeState {
  return raw?.has_data === true && (raw.list ?? []).length > 0 ? "ok" : "empty"
}

/**
 * 危局强袭战的出图数据
 *
 * 昵称与头像**这一条接口自带**（`nick_name` / `avatar_icon`），故不必另取一次 `index`。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzDeadlyData(raw: ZzzDeadlyRaw | undefined, ctx: ZzzChallengeContext): Record<string, unknown> {
  const room = raw?.room_max_score ?? 0
  const total = raw?.total_score ?? 0
  const opts = {
    maxScore: room,
    duration: false,
    ...(ctx.nameOf ? { nameOf: ctx.nameOf } : {}),
    ...(ctx.iconOf ? { iconOf: ctx.iconOf } : {}),
    ...(ctx.cards ? { cards: ctx.cards } : {})
  }
  const hard = (raw?.hard_list ?? []).map(one => battleCard(one, opts))

  return {
    game: "zzz",
    title: "危局强袭战",
    uid: ctx.uid,
    // 接口自带的昵称优先：它就是游戏里那个，而会话上那个可能是平台昵称
    nickname: raw?.nick_name ?? ctx.nickname ?? "",
    avatar: raw?.avatar_icon ?? "",
    period: ctx.period,
    begin: zzzDate(raw?.start_time),
    end: zzzDate(raw?.end_time),
    score: total,
    maxScore: raw?.total_max_score ?? 0,
    full: (raw?.total_max_score ?? 0) > 0 && total >= (raw?.total_max_score ?? 0),
    star: raw?.total_star ?? 0,
    rank: zzzRank(raw?.rank_percent),
    rankTier: zzzRankTier(raw?.rank_percent),
    rooms: (raw?.list ?? []).map(one => battleCard(one, opts)),
    // 绝境一档单列：它另有一个排名，与普通档不是一回事
    hasHard: raw?.has_hard === true && hard.length > 0,
    hardRank: zzzRank(raw?.hard_rank_percent),
    hardRankTier: zzzRankTier(raw?.hard_rank_percent),
    hard
  }
}
/**
 * 判这份拟境湮灭战返回能不能出图
 * @param raw 接口返回
 * @returns 判定结果
 */
export function zzzHoloState(raw: ZzzHoloRaw | undefined): ZzzChallengeState {
  return raw?.unlock === true && (raw.list ?? []).length > 0 ? "ok" : "empty"
}

/**
 * 拟境湮灭战的出图数据
 *
 * 这一条接口**不给昵称与头像**，故只能用会话上那一份；总星数与总用时由逐场加出来（接口没有这两栏）。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzHoloData(raw: ZzzHoloRaw | undefined, ctx: ZzzChallengeContext): Record<string, unknown> {
  const list = raw?.list ?? []
  const opts = {
    maxScore: 0,
    duration: true,
    ...(ctx.nameOf ? { nameOf: ctx.nameOf } : {}),
    ...(ctx.iconOf ? { iconOf: ctx.iconOf } : {}),
    ...(ctx.cards ? { cards: ctx.cards } : {})
  }
  const battles = list.map(one => battleCard(one, opts))
  const star = list.reduce((sum, one) => sum + (one.star ?? 0), 0)
  const seconds = list.reduce(
    (sum, one) => sum + (one.challenge_time?.minute ?? 0) * 60 + (one.challenge_time?.second ?? 0),
    0
  )
  const noInjured = list.filter(one => zzzBoss(one.boss).medal?.is_no_injured === true).length

  return {
    game: "zzz",
    title: "拟境湮灭战",
    uid: ctx.uid,
    nickname: ctx.nickname ?? "",
    period: ctx.period,
    begin: zzzDate(raw?.start_time),
    end: zzzDate(raw?.end_time),
    star,
    cost: zzzCost(seconds),
    noInjured,
    battles
  }
}
/**
 * 式舆防卫战的文字形态，出图失败时用
 * @param wrap 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function zzzDefenseText(wrap: ZzzDefenseWrapRaw | undefined, ctx: ZzzChallengeContext): string {
  const view = zzzDefenseData(wrap, ctx)
  const layers = view["layers"] as { name: string; rating: string; rooms: { score: number; avatars: ZzzAvatarView[] }[] }[]
  const rating = String(view["rating"] ?? "")
  const lines = [`UID${ctx.uid} ${ctx.period}式舆防卫战 ${String(view["score"])} 分${rating ? `（${rating}）` : ""}`]
  if (view["rank"]) lines.push(`${INDENT}排名 ${String(view["rank"])}`)
  if (view["cost"]) lines.push(`${INDENT}总用时 ${String(view["cost"])}`)
  if (layers.length === 0) return `${lines[0]}\n${INDENT}本期还没有战斗记录`
  for (const layer of layers) {
    lines.push(`${INDENT}${layer.name}${layer.rating ? ` ${layer.rating}` : ""}`)
    for (const room of layer.rooms) lines.push(`${INDENT}${INDENT}${room.score} 分 · ${zzzTeamText(room.avatars)}`)
  }
  return lines.join("\n")
}

/** 文字形态里一场记录的形状 */
interface BattleTextView {
  /** 得分 */
  score: number
  /** 星数 */
  star: number
  /** 满星数 */
  totalStar: number
  /** 用时 */
  cost: string
  /** 首领 */
  boss: { name: string }
  /** 阵容 */
  avatars: ZzzAvatarView[]
  /** 奖牌 */
  medal?: { noInjured: boolean }
}
/**
 * 危局强袭战的文字形态，出图失败时用
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function zzzDeadlyText(raw: ZzzDeadlyRaw | undefined, ctx: ZzzChallengeContext): string {
  const view = zzzDeadlyData(raw, ctx)
  const rooms = view["rooms"] as BattleTextView[]
  const hard = view["hard"] as BattleTextView[]
  const lines = [`UID${ctx.uid} ${ctx.period}危局强袭战 ${String(view["score"])} 分 ${String(view["star"])} 星`]
  if (view["rank"]) lines.push(`${INDENT}排名 ${String(view["rank"])}`)
  if (rooms.length === 0) return `${lines[0]}\n${INDENT}本期还没有战斗记录`
  for (const one of rooms) {
    lines.push(`${INDENT}${one.boss.name || "首领"} ${one.score} 分 ${one.star}/${one.totalStar} 星`)
    lines.push(`${INDENT}${INDENT}${zzzTeamText(one.avatars)}`)
  }
  if (view["hasHard"] === true) {
    lines.push(`${INDENT}绝境${view["hardRank"] ? ` 排名 ${String(view["hardRank"])}` : ""}`)
    for (const one of hard) {
      lines.push(`${INDENT}${INDENT}${one.boss.name || "首领"} ${one.score} 分 ${one.star}/${one.totalStar} 星`)
    }
  }
  return lines.join("\n")
}

/**
 * 拟境湮灭战的文字形态，出图失败时用
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function zzzHoloText(raw: ZzzHoloRaw | undefined, ctx: ZzzChallengeContext): string {
  const view = zzzHoloData(raw, ctx)
  const battles = view["battles"] as BattleTextView[]
  const lines = [`UID${ctx.uid} ${ctx.period}拟境湮灭战 ${String(view["star"])} 星`]
  if (view["cost"]) lines.push(`${INDENT}总用时 ${String(view["cost"])}`)
  if (Number(view["noInjured"]) > 0) lines.push(`${INDENT}无伤通关 ${String(view["noInjured"])} 场`)
  if (battles.length === 0) return `${lines[0]}\n${INDENT}本期还没有战斗记录`
  for (const one of battles) {
    const injured = one.medal?.noInjured === true ? "（无伤）" : ""
    lines.push(
      `${INDENT}${one.boss.name || "首领"} ${one.star}/${one.totalStar} 星${one.cost ? ` 用时 ${one.cost}` : ""}${injured}`
    )
    lines.push(`${INDENT}${INDENT}${zzzTeamText(one.avatars)}`)
  }
  return lines.join("\n")
}
