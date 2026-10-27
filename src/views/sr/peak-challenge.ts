/**
 * 模块职责：异相仲裁战绩 —— 把 `challenge_peak` 的返回转成模板要的形态
 * 依赖方向：依赖 meta/elem（命途键归一）与 views/sr/challenge（时刻格式化、剥富文本、角色视图类型）；
 *          纯函数，不发请求、不读元数据
 * 生命周期：无状态
 * 注意事项：**异相仲裁与另三类挑战没有一栏重合、故单独一份视图与模板**（它给 `challenge_peak_records[]`，每期分「王棋」与「骑士关卡」两块，星数/次数/奖牌在 `challenge_peak_best_record_brief`；塞进共用视图会一栏都取不到、恒回「本期尚无战绩」）。
 *          **`mob_infos` 与 `mob_records` 是两个平行数组、按下标配对**（前者关卡恒有、后者战绩可空），以 `mob_infos` 为准遍历（反过来会让没打的关卡整个不出现）。**两块星数上限都是 3**（与另三类不同），按 3 摊成布尔数组。**奖牌档位是字符串枚举**（`Ultra` 那档沿用接口写法、官方中文名无从核实）。
 */
import { elemOf } from "../../meta/elem.js"
import { INDENT } from "../../core/text.js"
import type { SrChallengeAvatarView, SrChallengeTimeRaw } from "./challenge.js"
import { srChallengePlain, srChallengeTime } from "./challenge.js"

/** 一个上场角色 */
export interface PeakAvatarRaw {
  /** 角色 id */
  id?: number | string
  /** 角色名，这一族接口给得出 */
  name?: string
  /** 等级 */
  level?: number
  /** 头像，米游社的绝对地址 */
  icon?: string
  /** 星级 */
  rarity?: number
  /** 命途，形如 `lightning` */
  element?: string
  /** 星魂数 */
  rank?: number
}

/** 一场的祝福 */
export interface PeakBuffRaw {
  /** 名称 */
  name_mi18n?: string
  /** 说明，带富文本标签 */
  desc_mi18n?: string
  /** 图标 */
  icon?: string
}

/** 一场战绩，首领战与杂兵战同形 */
export interface PeakRecordRaw {
  /** 这一场有没有打过 */
  has_challenge_record?: boolean
  /** 是否快速通关 */
  is_fast?: boolean
  /** 是否绝境难度，仅首领战有 */
  hard_mode?: boolean
  /** 使用轮次 */
  round_num?: number
  /** 已得星数 */
  star_num?: number
  /** 挑战时刻 */
  challenge_time?: SrChallengeTimeRaw
  /** 上场角色 */
  avatars?: PeakAvatarRaw[]
  /** 本场生效的祝福 */
  buff?: PeakBuffRaw
}

/** 一个关卡的介绍，与战绩按下标配对 */
export interface PeakInfoRaw {
  /** 关卡名，杂兵关给这一栏 */
  name?: string
  /** 关卡名，首领关给这一栏 */
  name_mi18n?: string
  /** 图标 */
  icon?: string
}

/** 一期的期次信息 */
export interface PeakGroupRaw {
  /** 期次名 */
  name_mi18n?: string
  /** 起始版本号，这一族接口以"某版本更新后"表述本期开始 */
  game_version?: string
  /** 结束时刻 */
  end_time?: SrChallengeTimeRaw
}

/** 一期的战绩 */
export interface PeakPeriodRaw {
  /** 期次 */
  group?: PeakGroupRaw
  /** 本期有没有战绩 */
  has_challenge_record?: boolean
  /** 本期首领关 */
  boss_info?: PeakInfoRaw
  /** 首领战战绩 */
  boss_record?: PeakRecordRaw
  /** 本期各杂兵关 */
  mob_infos?: PeakInfoRaw[]
  /** 各杂兵战战绩，与 `mob_infos` 按下标配对 */
  mob_records?: PeakRecordRaw[]
}

/** 全期汇总，星数与挑战次数在这里而不在逐期里 */
export interface PeakBriefRaw {
  /** 奖牌档位，字符串枚举 */
  challenge_peak_rank_icon_type?: string
  /** 首领星数 */
  boss_stars?: number
  /** 杂兵星数 */
  mob_stars?: number
  /** 挑战次数 */
  total_battle_num?: number
}

/** `challenge_peak` 的返回 */
export interface PeakChallengeRaw {
  /** 玩家信息，这一族接口自带，不必另取 `index` */
  role?: {
    /** 昵称 */
    nickname?: string
    /** 开拓等级 */
    level?: number
  }
  /** 全期汇总 */
  challenge_peak_best_record_brief?: PeakBriefRaw
  /** 逐期，下标 0 即请求的那一期 */
  challenge_peak_records?: PeakPeriodRaw[]
}

/**
 * 奖牌档位 → 类名与中文名
 *
 * **图标不在这里**：那张图按官方编号取（`sr/challenge/peak/icon_type_<N>.png`），序号由 `views/sr/stat.ts` 按同一张次序表算出 —— 那个编号不按奖牌高低排（1 铜、2 金、3 银、4 Ultra）。此处只留纯文字形态要的那两项。
 */
const MEDAL: Readonly<Record<string, { key: string; name: string }>> = {
  ChallengePeakRankIconTypeNone: { key: "none", name: "" },
  ChallengePeakRankIconTypeBronze: { key: "bronze", name: "铜牌" },
  ChallengePeakRankIconTypeSilver: { key: "silver", name: "银牌" },
  ChallengePeakRankIconTypeGold: { key: "gold", name: "金牌" },
  // 这一档官方中文名无从核实，沿用接口自己的写法
  ChallengePeakRankIconTypeUltra: { key: "ultra", name: "Ultra" }
}

/** 每一块的星数上限，异相仲裁两块都是 3 */
const MAX_STAR = 3

/** 判定结果 */
export type PeakChallengeState = "ok" | "noData" | "otherShape"

/**
 * 取要展示的那一期
 *
 * 请求里已带 `schedule_type`，返回的 `challenge_peak_records` 第 0 项即那一期，故不按本期 / 上期挑下标（与另三类的 `groups` 不同）。
 * @param raw 接口返回
 * @returns 那一期；没有时 undefined
 */
export function peakPeriod(raw: PeakChallengeRaw | undefined): PeakPeriodRaw | undefined {
  return raw?.challenge_peak_records?.[0]
}

/**
 * 判这份返回能不能出图
 *
 * `otherShape` 单独一档：连 `challenge_peak_records` 这一栏都没有，说明形态又变了，与「这一期没打过」的处置不同 —— 后者过一局就有，前者要改代码。
 * @param raw 接口返回
 * @returns 判定结果
 */
export function peakChallengeState(raw: PeakChallengeRaw | undefined): PeakChallengeState {
  if (!raw || !Array.isArray(raw.challenge_peak_records)) return "otherShape"
  const period = peakPeriod(raw)
  if (!period || period.has_challenge_record === false) return "noData"
  return "ok"
}

/** 模板要的一场战绩 */
export interface PeakRecordView extends Record<string, unknown> {
  /** 关卡名 */
  name: string
  /** 关卡图标，接口给的绝对地址；没有时为空串 */
  icon: string
  /** 这一场打过没有 */
  has: boolean
  /** 是否快速通关 */
  fast: boolean
  /** 使用轮次，0 表示接口没给 */
  round: number
  /** 已得星数 */
  star: number
  /** 逐个星格是否已得，恒为三项 */
  stars: boolean[]
  /** 挑战时刻，没有时为空串 */
  time: string
  /** 上场角色 */
  avatars: SrChallengeAvatarView[]
  /** 祝福名，没有时为空串 */
  buffName: string
  /** 祝福图标，没有时为空串 */
  buffIcon: string
  /** 祝福说明，已剥标签 */
  buffDesc: string
}

/** 模板要的首领战，多一档难度 */
export interface PeakBossView extends PeakRecordView {
  /** 是否绝境难度 */
  hardMode: boolean
  /** 难度名 */
  modeName: string
}

/** 出图与出文字共用的上下文 */
export interface PeakChallengeContext {
  /** uid */
  uid: string
  /**
   * 期次标签，形如「本期」「上期」
   *
   * 同一张模板同时服务两期，而 `name_mi18n` 未必有值；缺了它两张图看起来一模一样。
   */
  period?: string
  /**
   * 按角色 id 取中文名，取不到时返回空串
   *
   * 这一族接口**给了 `name`**，故它只作补充：接口那个名字对开拓者是「开拓者」，
   * 而元数据里分「穹」「星」，能补上时更准。
   */
  nameOf?: (id: string) => string
}

/**
 * 把一个上场角色转成模板要的形态
 * @param raw 角色
 * @param nameOf 按 id 取角色名
 * @returns 角色视图
 */
function avatarView(raw: PeakAvatarRaw, nameOf: (id: string) => string): SrChallengeAvatarView {
  const id = String(raw.id ?? "")
  return {
    id,
    // 元数据那份更准（开拓者按命途分「穹」「星」），取不到才退回接口给的
    name: (id === "" ? "" : nameOf(id)) || (raw.name ?? ""),
    icon: raw.icon ?? "",
    level: Number(raw.level) || 0,
    rarity: Number(raw.rarity) || 5,
    rank: Number(raw.rank) || 0,
    element: elemOf(raw.element ?? "", "", "sr")
  }
}

/**
 * 把一场战绩转成模板要的形态
 * @param record 战绩；接口在"没打过那一场"时不给
 * @param info 关卡介绍
 * @param nameOf 按 id 取角色名
 * @returns 战绩视图
 */
function recordView(
  record: PeakRecordRaw | undefined,
  info: PeakInfoRaw | undefined,
  nameOf: (id: string) => string
): PeakRecordView {
  const star = Number(record?.star_num) || 0
  return {
    name: info?.name ?? info?.name_mi18n ?? "",
    icon: info?.icon ?? "",
    has: record?.has_challenge_record === true,
    fast: record?.is_fast === true,
    round: Number(record?.round_num) || 0,
    star,
    stars: Array.from({ length: MAX_STAR }, (_unused, idx) => idx < star),
    time: srChallengeTime(record?.challenge_time),
    avatars: (record?.avatars ?? []).map(one => avatarView(one, nameOf)),
    buffName: record?.buff?.name_mi18n ?? "",
    buffIcon: record?.buff?.icon ?? "",
    buffDesc: srChallengePlain(record?.buff?.desc_mi18n)
  }
}

/**
 * 把一份 `challenge_peak` 转成 `sr/peak-challenge` 要的形态
 *
 * **`mobs` 以 `mob_infos` 为准遍历**、**每项的 `avatars` 与 `stars` 恒为数组**：模板对它们取 `.length` 并逐项取值，缺键会让整张图出不来而只退回纯文字。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function peakChallengeTemplateData(
  raw: PeakChallengeRaw | undefined,
  ctx: PeakChallengeContext
): Record<string, unknown> {
  const nameOf = ctx.nameOf ?? ((): string => "")
  const period = peakPeriod(raw)
  const brief = raw?.challenge_peak_best_record_brief ?? {}
  const medal = MEDAL[brief.challenge_peak_rank_icon_type ?? ""] ?? MEDAL["ChallengePeakRankIconTypeNone"]

  const bossRaw = period?.boss_record
  const boss: PeakBossView = {
    ...recordView(bossRaw, period?.boss_info, nameOf),
    hardMode: bossRaw?.hard_mode === true,
    modeName: bossRaw?.hard_mode === true ? "绝境" : "普通"
  }
  // 首领关打过之后官方就不再印关卡名，而改印「将杀王棋·难度」，此处照录
  if (boss.has) boss.name = `将杀王棋·${boss.modeName}`

  const infos = period?.mob_infos ?? []
  const records = period?.mob_records ?? []
  const mobs: PeakRecordView[] = infos.map((info, idx) => recordView(records[idx], info, nameOf))

  return {
    uid: ctx.uid,
    nickname: raw?.role?.nickname ?? "",
    period: ctx.period ?? "",
    season: period?.group?.name_mi18n ?? "",
    version: period?.group?.game_version ?? "",
    end: srChallengeTime(period?.group?.end_time),
    medalKey: medal?.key ?? "none",
    medalName: medal?.name ?? "",
    bossStars: Number(brief.boss_stars) || 0,
    mobStars: Number(brief.mob_stars) || 0,
    battleNum: Number(brief.total_battle_num) || 0,
    boss,
    mobs
  }
}

/**
 * 一场战绩的一行文字
 * @param one 战绩视图
 * @returns 一行；没打过时只报关卡名与未通关
 */
function recordLine(one: PeakRecordView): string {
  if (!one.has) return `${one.name || "未命名关卡"}${INDENT}未通关`
  const who = one.avatars.map(it => it.name || it.id).filter(Boolean)
  const parts = [`${one.star} 星`]
  if (one.round > 0) parts.push(`${one.round} 轮`)
  if (one.fast) parts.push("速通")
  if (one.buffName) parts.push(`祝福 ${one.buffName}`)
  return (
    `${one.name || "未命名关卡"}${INDENT}${parts.join(INDENT)}` +
    `${who.length > 0 ? `\n${INDENT}出战：${who.join("、")}` : ""}`
  )
}

/**
 * 异相仲裁的纯文字形态
 *
 * 无渲染器时用。奖牌档位与两块星数是这个玩法里最要紧的三项，故排在最前。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function peakChallengeText(raw: PeakChallengeRaw | undefined, ctx: PeakChallengeContext): string {
  const view = peakChallengeTemplateData(raw, ctx)
  const season = String(view["season"] ?? "")
  const lines = [`UID${ctx.uid} 异相仲裁${season ? ` · ${season}` : ""}`]
  const medal = String(view["medalName"] ?? "")
  lines.push(
    `${medal ? `${medal}${INDENT}` : ""}王棋 ${String(view["bossStars"])} 星${INDENT}` +
      `骑士 ${String(view["mobStars"])} 星${INDENT}挑战 ${String(view["battleNum"])} 次`
  )
  lines.push(recordLine(view["boss"] as PeakRecordView))
  for (const one of view["mobs"] as PeakRecordView[]) lines.push(recordLine(one))
  return lines.join("\n")
}
