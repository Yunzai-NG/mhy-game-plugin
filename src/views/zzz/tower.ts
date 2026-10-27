/**
 * 模块职责：绝区零两类逐关战绩的视图模型 —— 拟真鏖战试炼（爬塔）与临界推演
 * 依赖方向：纯函数，依赖 views/zzz/common 与 core/text；不发请求、不读元数据
 * 生命周期：无状态
 * 注意事项：两条接口都有一处**同名不同形**：拟真鏖战试炼（`climbing_tower_detail`，`%爬塔`）一次返回四赛季、**前两季与后两季形态不同**（S3/S4 挪进 `layer_info`/`mvp_info`、多出总分排名与角色排行），无期次参数、不认「上期」；临界推演（`void_front_battle_period_detail`）正文包在 `void_front_battle_detail` 里，逐关 `star` 是**评级字母**（当类名用）、`buffer` 是对象（三条接口三种写法、取错只空白不报错）、**`end_time` 允许缺**（本期未结束、印「超过42天」）。
 *          排名/评级/阵容排版都在 views/zzz/common、与另三张战绩图共用一份。
 */
import { INDENT } from "../../core/text.js"
import type { ZzzAvatarCardView } from "./card.js"
import type { ZzzAvatarRaw, ZzzAvatarView, ZzzBuddyRaw, ZzzIconOf, ZzzTimeRaw } from "./common.js"
import { zzzAvatars, zzzBuddy, zzzDate, zzzRank, zzzRankTier, zzzRating, zzzTeamText, zzzTime } from "./common.js"

/** 出图与出文字共用的上下文 */
export interface ZzzTowerContext {
  /** uid */
  uid: string
  /** 按名字查代理人 id：这一族接口只给名字 */
  idOf?: (name: string) => string
  /** 玩家昵称 */
  nickname?: string
  /** 期次说明，「本期」或「上期」；拟真鏖战试炼没有期次，给空串 */
  period: string
  /** 由代理人 id 取名称，通常查元数据 */
  nameOf?: (id: string) => string
  /**
   * 由 id 取元数据里那张方图；不给即一律用接口给的地址
   *
   * 官方接口只取数不取图，见 `views/zzz/common.ts` 的文件头。
   */
  iconOf?: ZzzIconOf
  /** 代理人 id → 整卡（命令层从绝区零面板库造好）；给了就出整张代理人卡，不给出紧凑小卡 */
  cards?: Readonly<Record<string, ZzzAvatarCardView>>
}

/** 角色排行里的一位，与上场阵容那一族不同形 —— 它给的是 `icon` 与名字，不是方图 */
export interface ZzzTowerRankAvatarRaw {
  /** 稀有度 */
  rarity?: string
  /** 图标 */
  icon?: string
  /** 名称，这一族接口自带 */
  name?: string
  /** 该角色得分 */
  score?: number
  /** 该角色排名，放大一百倍 */
  rank_percent?: number
}
/** 一个赛季。S1、S2 用顶层那几项，S3、S4 用两个子对象 */
export interface ZzzTowerSeasonRaw {
  /** 徽章，S1、S2 在这里 */
  medal_icon?: string
  /** 层数，S1、S2 在这里 */
  climbing_tower_layer?: number
  /** 无伤通关层数，S2 在这里 */
  floor_mvp_num?: number
  /** S3、S4 的层数与总分 */
  layer_info?: {
    /** 徽章 */
    medal_icon?: string
    /** 层数 */
    climbing_tower_layer?: number
    /** 总分 */
    total_score?: number
  }
  /** S3、S4 的无伤层数与排名 */
  mvp_info?: {
    /** 无伤通关层数 */
    floor_mvp_num?: number
    /** 排名，放大一百倍 */
    rank_percent?: number
  }
  /** 角色排行，只有 S4 给 */
  display_avatar_rank_list?: ZzzTowerRankAvatarRaw[]
}

/** `climbing_tower_detail` 接口的返回 */
export interface ZzzTowerRaw {
  /** 第一赛季 */
  climbing_tower_s1?: ZzzTowerSeasonRaw
  /** 第二赛季 */
  climbing_tower_s2?: ZzzTowerSeasonRaw
  /** 第三赛季 */
  climbing_tower_s3?: ZzzTowerSeasonRaw
  /** 第四赛季 */
  climbing_tower_s4?: ZzzTowerSeasonRaw
}

/** 赛季名照官方，序号越大越新，故由高到低排 */
const TOWER_SEASONS: readonly { key: keyof ZzzTowerRaw; name: string }[] = [
  { key: "climbing_tower_s4", name: "鏖战试炼：狂澜" },
  { key: "climbing_tower_s3", name: "鏖战试炼：荣耀" },
  { key: "climbing_tower_s2", name: "鏖战试炼：末路" },
  { key: "climbing_tower_s1", name: "拟真鏖战试炼" }
]

/** 角色排行最多列几位 */
const RANK_TOP = 3
/**
 * 判这份拟真鏖战试炼返回能不能出图
 * @param raw 接口返回
 * @returns 有任一赛季即可出图
 */
export function zzzTowerState(raw: ZzzTowerRaw | undefined): "ok" | "empty" {
  const some = TOWER_SEASONS.some(it => {
    const one = raw?.[it.key]
    return (one?.climbing_tower_layer ?? one?.layer_info?.climbing_tower_layer ?? 0) > 0
  })
  return some ? "ok" : "empty"
}

/**
 * 拟真鏖战试炼的出图数据
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzTowerData(raw: ZzzTowerRaw | undefined, ctx: ZzzTowerContext): Record<string, unknown> {
  const seasons = TOWER_SEASONS.map(it => {
    const one = raw?.[it.key]
    // 前两季在顶层、后两季在子对象里，此处一次抹平，模板不必知道这回事
    const layer = one?.layer_info?.climbing_tower_layer ?? one?.climbing_tower_layer ?? 0
    const percent = one?.mvp_info?.rank_percent
    return {
      name: it.name,
      layer,
      medal: one?.layer_info?.medal_icon ?? one?.medal_icon ?? "",
      score: one?.layer_info?.total_score ?? 0,
      mvp: one?.mvp_info?.floor_mvp_num ?? one?.floor_mvp_num ?? 0,
      rank: zzzRank(percent),
      rankTier: zzzRankTier(percent),
      avatars: (one?.display_avatar_rank_list ?? []).slice(0, RANK_TOP).map(a => ({
        // 这一族接口自带名字，不必查元数据
        name: a.name ?? "",
        icon: a.icon ?? "",
        rarity: a.rarity ?? "A",
        score: a.score ?? 0,
        rank: zzzRank(a.rank_percent),
        rankTier: zzzRankTier(a.rank_percent),
        // 面板库里有这一位时带整卡，模板据此出卡、没有时退回接口那张方图
        card: ctx.cards?.[ctx.idOf?.(a.name ?? "") ?? ""]
      }))
    }
  }).filter(it => it.layer > 0)

  return {
    game: "zzz",
    title: "拟真鏖战试炼",
    uid: ctx.uid,
    nickname: ctx.nickname ?? "",
    seasons
  }
}
/**
 * 拟真鏖战试炼的文字形态，出图失败时用
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function zzzTowerText(raw: ZzzTowerRaw | undefined, ctx: ZzzTowerContext): string {
  const view = zzzTowerData(raw, ctx)
  const seasons = view["seasons"] as { name: string; layer: number; score: number; mvp: number; rank: string }[]
  const lines = [`UID${ctx.uid} 拟真鏖战试炼`]
  if (seasons.length === 0) return `${lines[0]}\n${INDENT}还没有任何赛季的记录`
  for (const one of seasons) {
    const bits = [`第 ${one.layer} 层`]
    if (one.score > 0) bits.push(`${one.score} 分`)
    if (one.mvp > 0) bits.push(`无伤 ${one.mvp} 层`)
    if (one.rank) bits.push(`排名 ${one.rank}`)
    lines.push(`${INDENT}${one.name} ${bits.join(" · ")}`)
  }
  return lines.join("\n")
}

/** 临界推演里的一关，主关与子关同形 */
export interface ZzzVoidStageRaw {
  /** 关卡名 */
  name?: string
  /** 评级字母，**不是星数** */
  star?: string
  /** 得分 */
  score?: number
  /** 该关满分 */
  max_score?: number
  /** 得分倍率 */
  score_ratio?: number | string
  /** 通关时刻 */
  challenge_time?: ZzzTimeRaw
  /** 增益，**是一个对象** */
  buffer?: {
    /** 增益名 */
    name?: string
    /** 图标 */
    icon?: string
  }
  /** 上场代理人 */
  avatar_list?: ZzzAvatarRaw[]
  /** 上场邦布 */
  buddy?: ZzzBuddyRaw
  /** 子关卡 */
  sub_challenge_record?: ZzzVoidStageRaw[]
}
/** `void_front_battle_period_detail` 里那一段正文 */
export interface ZzzVoidRaw {
  /** 本期总览 */
  void_front_battle_abstract_info_brief?: {
    /** 本期起 */
    start_time?: ZzzTimeRaw
    /** 本期止，**允许缺** */
    end_time?: ZzzTimeRaw
    /** 总分 */
    total_score?: number
    /** 总分满分 */
    max_score?: number
    /** 排名，放大一百倍 */
    rank_percent?: number
    /** 结局名 */
    ending_record_name?: string
    /** 结局底图 */
    ending_record_bg_pic?: string
  }
  /** 首领关 */
  boss_challenge_record?: {
    /** 首领 */
    boss_info?: {
      /** 名称 */
      name?: string
      /** 立绘 */
      icon?: string
    }
    /** 首领关本身 */
    main_challenge_record?: ZzzVoidStageRaw
  }
  /** 普通关卡，新的在前 */
  main_challenge_record_list?: ZzzVoidStageRaw[]
}

/** `void_front_battle_period_detail` 接口的整份返回 */
export interface ZzzVoidWrapRaw {
  /** 正文 */
  void_front_battle_detail?: ZzzVoidRaw
}

/**
 * 判这份临界推演返回能不能出图
 * @param wrap 接口返回
 * @returns 判定结果
 */
export function zzzVoidState(wrap: ZzzVoidWrapRaw | undefined): "ok" | "empty" {
  const raw = wrap?.void_front_battle_detail
  if (!raw) return "empty"
  const stages = (raw.main_challenge_record_list ?? []).length
  return stages > 0 || raw.boss_challenge_record?.main_challenge_record ? "ok" : "empty"
}
/**
 * 一关的出图形态，主关与子关共用
 * @param raw 接口给的一关
 * @param nameOf 由 id 取名称
 * @param iconOf 由 id 取元数据里那张图
 * @returns 出图形态
 */
function voidStage(
  raw: ZzzVoidStageRaw | undefined,
  nameOf?: (id: string) => string,
  iconOf?: ZzzIconOf,
  cards?: Readonly<Record<string, ZzzAvatarCardView>>
): Record<string, unknown> {
  const score = raw?.score ?? 0
  const max = raw?.max_score ?? 0
  const buddy = zzzBuddy(raw?.buddy, iconOf)
  const ratio = raw?.score_ratio
  return {
    name: raw?.name ?? "",
    rating: raw?.star ?? "",
    ratingClass: zzzRating(raw?.star),
    score,
    maxScore: max,
    full: max > 0 && score >= max,
    // 倍率接口有时给数字有时给字符串，一律按字符串印 —— 这一栏只是展示
    ratio: ratio === undefined || ratio === 0 ? "" : String(ratio),
    time: zzzTime(raw?.challenge_time),
    buff: { name: raw?.buffer?.name ?? "", icon: raw?.buffer?.icon ?? "" },
    avatars: zzzAvatars(raw?.avatar_list, nameOf, iconOf, cards),
    ...(buddy ? { buddy } : {}),
    subs: (raw?.sub_challenge_record ?? []).map(it => ({
      name: it.name ?? "",
      rating: it.star ?? "",
      ratingClass: zzzRating(it.star),
      buff: { name: it.buffer?.name ?? "", icon: it.buffer?.icon ?? "" },
      avatars: zzzAvatars(it.avatar_list, nameOf, iconOf, cards),
      ...(zzzBuddy(it.buddy, iconOf) ? { buddy: zzzBuddy(it.buddy, iconOf) } : {})
    }))
  }
}
/**
 * 临界推演的出图数据
 * @param wrap 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzVoidData(wrap: ZzzVoidWrapRaw | undefined, ctx: ZzzTowerContext): Record<string, unknown> {
  const raw = wrap?.void_front_battle_detail
  const brief = raw?.void_front_battle_abstract_info_brief
  const total = brief?.total_score ?? 0
  const max = brief?.max_score ?? 0
  const boss = raw?.boss_challenge_record

  return {
    game: "zzz",
    title: "临界推演",
    uid: ctx.uid,
    nickname: ctx.nickname ?? "",
    period: ctx.period,
    begin: zzzDate(brief?.start_time),
    // 本期未结束时接口不给止期，官方页面此时印这一句
    end: zzzDate(brief?.end_time) || "超过 42 天",
    score: total,
    maxScore: max,
    full: max > 0 && total >= max,
    rank: zzzRank(brief?.rank_percent),
    rankTier: zzzRankTier(brief?.rank_percent),
    ending: { name: brief?.ending_record_name ?? "", bg: brief?.ending_record_bg_pic ?? "" },
    ...(boss?.main_challenge_record
      ? {
          boss: {
            name: boss.boss_info?.name ?? "",
            icon: boss.boss_info?.icon ?? "",
            stage: voidStage(boss.main_challenge_record, ctx.nameOf, ctx.iconOf, ctx.cards)
          }
        }
      : {}),
    stages: (raw?.main_challenge_record_list ?? []).map(one => voidStage(one, ctx.nameOf, ctx.iconOf, ctx.cards))
  }
}
/** 文字形态里一关的形状 */
interface StageTextView {
  /** 关卡名 */
  name: string
  /** 评级 */
  rating: string
  /** 得分 */
  score: number
  /** 阵容 */
  avatars: ZzzAvatarView[]
  /** 子关卡 */
  subs: { name: string; rating: string }[]
}

/**
 * 临界推演的文字形态，出图失败时用
 * @param wrap 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function zzzVoidText(wrap: ZzzVoidWrapRaw | undefined, ctx: ZzzTowerContext): string {
  const view = zzzVoidData(wrap, ctx)
  const stages = view["stages"] as StageTextView[]
  const boss = view["boss"] as { name: string; stage: StageTextView } | undefined
  const ending = view["ending"] as { name: string }
  const lines = [`UID${ctx.uid} ${ctx.period}临界推演 ${String(view["score"])} 分`]
  if (view["rank"]) lines.push(`${INDENT}排名 ${String(view["rank"])}`)
  if (ending.name) lines.push(`${INDENT}结局 ${ending.name}`)
  if (boss) {
    lines.push(`${INDENT}${boss.name || "首领关"} ${boss.stage.score} 分${boss.stage.rating ? ` ${boss.stage.rating}` : ""}`)
    lines.push(`${INDENT}${INDENT}${zzzTeamText(boss.stage.avatars)}`)
  }
  if (stages.length === 0 && !boss) return `${lines[0]}\n${INDENT}本期还没有战斗记录`
  for (const one of stages) {
    lines.push(`${INDENT}${one.name || "关卡"} ${one.score} 分${one.rating ? ` ${one.rating}` : ""}`)
    lines.push(`${INDENT}${INDENT}${zzzTeamText(one.avatars)}`)
  }
  return lines.join("\n")
}
