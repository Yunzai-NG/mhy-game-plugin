/**
 * 模块职责：绝区零各张战绩图共用的形态与排版 —— 时刻、用时、排名、评级、阵容
 * 依赖方向：纯函数，不依赖本仓库其余任何模块；由 views/zzz-* 各自引用
 * 生命周期：无状态
 * 注意事项：抽在这里的都是多张图共用且各有一处易错的东西：
 *          **时刻与用时是两回事**（`challenge_time` 有时是通关时刻、有时只有 `minute`/`second` 的用时，混用会得「0026-00-00 00:03:41」，用时走 {@link zzzCostOf}）；
 *          **`rank_percent` 恒为放大一百倍的整数**（`2393` 即 23.93%，逐场那个 `rank` 两种都给过、走 {@link zzzBattleRank}）；**评级加号进不了 CSS 类名**故 `S+` 记 `SP`；**阵容恒三格**、缺位也占一格（否则同行卡片左移）。
 *          **头像与邦布图优先取元数据、取不到才用接口地址**（元数据缺省不装、新代理人未收录时按 id 查不到）；两个根由逐格的 `fromMeta` 区分，
 *          漏了就是 `template-img-two-roots` 的静默空图。给了 `cards` 时逐格附一张整卡（面板库没有的那位是占位卡），不给时出紧凑小卡。
 */
import { zzzPlaceholderCard, type ZzzAvatarCardView } from "./card.js"

/** 接口给的时刻，六个字段都可能缺 */
export interface ZzzTimeRaw {
  /** 年 */
  year?: number
  /** 月 */
  month?: number
  /** 日 */
  day?: number
  /** 时 */
  hour?: number
  /** 分 */
  minute?: number
  /** 秒 */
  second?: number
}

/** 接口给的一位上场代理人 */
export interface ZzzAvatarRaw {
  /** 代理人 id */
  id?: number | string
  /** 等级 */
  level?: number
  /** 已解锁影画层数，0 即没有 */
  rank?: number
  /** 稀有度，`S` 或 `A` */
  rarity?: string
  /** 方图，米游社的绝对地址 */
  role_square_url?: string
}
/** 接口给的一只邦布 */
export interface ZzzBuddyRaw {
  /** 邦布 id */
  id?: number | string
  /** 等级 */
  level?: number
  /** 稀有度 */
  rarity?: string
  /** 横版图，米游社的绝对地址 */
  bangboo_rectangle_url?: string
}

/** 接口给的一个首领 */
export interface ZzzBossRaw {
  /** 名称 */
  name?: string
  /** 立绘 */
  icon?: string
  /** 种族角标，只有危局强袭战给 */
  race_icon?: string
  /** 底图，只有危局强袭战给 */
  bg_icon?: string
  /** 奖牌，只有拟境湮灭战给 */
  medal?: {
    /** 奖牌图 */
    medal_icon?: string
    /** 奖牌 id */
    medal_id?: number
    /** 无伤通关 */
    is_no_injured?: boolean
  }
}

/** 接口给的一条增益 */
export interface ZzzBufferRaw {
  /** 增益名 */
  name?: string
  /** 图标 */
  icon?: string
  /** 说明，带 `<color=…>` 标记 */
  desc?: string
}

/** 一位上场代理人的出图形态 */
export interface ZzzAvatarView {
  /** 这一格是不是空位 */
  empty: boolean
  /** 代理人 id */
  id: string
  /** 名称，由元数据补；补不到时空串 */
  name: string
  /** 等级 */
  level: number
  /** 影画层数，0 即不印角标 */
  rank: number
  /** 稀有度，决定用哪张边框 */
  rarity: string
  /** 方图地址：元数据的相对路径，或接口给的完整地址 */
  icon: string
  /** 为真时 {@link icon} 相对元数据根（`_meta_path`），否则是完整地址、一处根都不加 */
  fromMeta: boolean
  /** 整张代理人卡（音擎 / 驱动盘 / 技能）；只有命令层传了 `cards` 才有，模板据此改出整卡 */
  card?: ZzzAvatarCardView
}

/** 一只邦布的出图形态 */
export interface ZzzBuddyView {
  /** 邦布 id */
  id: string
  /** 等级 */
  level: number
  /** 稀有度 */
  rarity: string
  /** 横版图地址：元数据的相对路径，或接口给的完整地址 */
  icon: string
  /** 为真时 {@link icon} 相对元数据根 */
  fromMeta: boolean
}

/**
 * 按 id 取一张图的取法 —— 由调用方接上元数据装载器
 *
 * 返回空串即「元数据里没有」，那时回落到接口给的地址。做成回调而不直接依赖装载器：本模块是纯函数、不碰 IO。
 */
export type ZzzIconOf = (id: string) => string
/**
 * 补成两位
 * @param value 数字
 * @returns 两位字符串
 */
function pad(value: number | undefined): string {
  return String(value ?? 0).padStart(2, "0")
}

/**
 * 时刻排版到秒
 * @param time 接口给的时刻
 * @returns `2026-07-29 12:57:29`；没给年份即视为没有这一项，返回空串
 */
export function zzzTime(time: ZzzTimeRaw | undefined): string {
  if (!time?.year) return ""
  return `${time.year}-${pad(time.month)}-${pad(time.day)} ${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`
}

/**
 * 时刻排版到日
 * @param time 接口给的时刻
 * @returns `2026.07.29`；没给年份时空串
 */
export function zzzDate(time: ZzzTimeRaw | undefined): string {
  if (!time?.year) return ""
  return `${time.year}.${pad(time.month)}.${pad(time.day)}`
}

/**
 * 秒数排版成用时
 * @param seconds 秒
 * @returns 不足一小时给 `mm:ss`，否则 `h:mm:ss`；不是正数时空串
 */
export function zzzCost(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return ""
  const hour = Math.floor(seconds / 3600)
  const rest = seconds % 3600
  const body = `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`
  return hour > 0 ? `${hour}:${body}` : body
}

/**
 * 用时对象排版成 `mm:ss`
 *
 * 拟境湮灭战的 `challenge_time` 是**用时**而非时刻，只有 `minute` 与 `second` 有意义。
 * @param time 接口给的用时
 * @returns `mm:ss`；一秒都没有时空串
 */
export function zzzCostOf(time: ZzzTimeRaw | undefined): string {
  return zzzCost((time?.minute ?? 0) * 60 + (time?.second ?? 0))
}
/**
 * 排名排版
 * @param percent 放大一百倍的排名
 * @returns `23.93%`；没有这一项时空串
 */
export function zzzRank(percent: number | undefined): string {
  if (!percent || percent <= 0) return ""
  return `${(percent / 100).toFixed(2)}%`
}

/**
 * 排名落在哪一档
 *
 * 五档边界是 1% / 5% / 10% / 50%，模板据此换底色。**没有这一项时给最后一档**：0 落在「小于 1%」里，照算会把「没有排名」画成最靠前的那一档。
 * @param percent 放大一百倍的排名
 * @returns 1 到 5，越小越靠前
 */
export function zzzRankTier(percent: number | undefined): number {
  if (!percent || percent <= 0) return 5
  const pct = percent / 100
  if (pct < 1) return 1
  if (pct < 5) return 2
  if (pct < 10) return 3
  if (pct < 50) return 4
  return 5
}

/**
 * 逐场排名的取值
 *
 * 拟境湮灭战逐场那个 `rank` 官方时而给百分数、时而给放大一百倍的值，故判据是**大于 100 即视为放大值**；`rank_percent` 那一族不走这里（它恒为放大值）。
 * @param rank 接口给的逐场排名
 * @returns 放大一百倍后的值，便于与 {@link zzzRank} 共用
 */
export function zzzBattleRank(rank: number | undefined): number {
  if (!rank || rank <= 0) return 0
  return rank > 100 ? rank : rank * 100
}

/**
 * 评级的样式名
 *
 * CSS 类名里不能有加号，故 `S+` 记作 `SP`。接口不给评级时记作 `none`，模板据此不画那枚角标。
 * @param rating 接口给的评级
 * @returns 样式名
 */
export function zzzRating(rating: string | undefined): string {
  const text = (rating ?? "").trim()
  return text ? text.replaceAll("+", "P") : "none"
}
/** 一队固定三格，缺位也要占住 —— 少一格会让同一行的其余卡片跟着错位 */
const TEAM_SIZE = 3

/**
 * 摊平上场阵容，缺位补空格
 *
 * **头像优先取元数据**（`iconOf`），取不到才用接口给的 `role_square_url` —— 见文件头。
 * 给了 `cards`（命令层从绝区零面板库造好的 id→卡）时，每格再附一张整卡：面板库里有的用那张，没有的
 * 退回只带接口头像 / 等级 / 影画的占位卡（技能空、音擎 / 驱动盘无，模板印「暂无面板数据」）。
 * @param list 接口给的代理人列表
 * @param nameOf 由 id 取名称，通常查元数据
 * @param iconOf 由 id 取元数据里那张方图；不给即一律用接口地址
 * @param cards 代理人 id → 整卡；给了就逐格附卡（含占位），不给维持紧凑小卡
 * @returns 恰好三格
 */
export function zzzAvatars(
  list: readonly ZzzAvatarRaw[] | undefined,
  nameOf?: (id: string) => string,
  iconOf?: ZzzIconOf,
  cards?: Readonly<Record<string, ZzzAvatarCardView>>
): ZzzAvatarView[] {
  const out: ZzzAvatarView[] = []
  for (let i = 0; i < TEAM_SIZE; i++) {
    const one = list?.[i]
    if (!one) {
      out.push({ empty: true, id: "", name: "", level: 0, rank: 0, rarity: "", icon: "", fromMeta: false })
      continue
    }
    const id = String(one.id ?? "")
    const local = id ? (iconOf?.(id) ?? "") : ""
    const name = nameOf?.(id) ?? ""
    const icon = local || (one.role_square_url ?? "")
    const slot: ZzzAvatarView = {
      empty: false,
      id,
      name,
      level: one.level ?? 0,
      rank: one.rank ?? 0,
      // 稀有度决定用哪张边框，接口不给时按 A 处理 —— 边框缺一张比错一张显眼
      rarity: one.rarity ?? "A",
      icon,
      fromMeta: !!local
    }
    if (cards) {
      // 占位卡头像与小卡同一张：有元数据用元数据、没有才用接口方图（战绩页本就允许接口图）
      slot.card =
        cards[id] ??
        zzzPlaceholderCard({
          id,
          name,
          star: one.rarity === "S" ? 5 : 4,
          level: one.level ?? 0,
          cons: one.rank ?? 0,
          face: icon
        })
    }
    out.push(slot)
  }
  return out
}

/**
 * 邦布的出图形态
 *
 * 图与代理人同一处置：先查元数据，取不到用接口给的横版图。
 * @param raw 接口给的邦布
 * @param iconOf 由 id 取元数据里那张图；不给即一律用接口地址
 * @returns 出图形态；没有邦布时 undefined
 */
export function zzzBuddy(raw: ZzzBuddyRaw | undefined, iconOf?: ZzzIconOf): ZzzBuddyView | undefined {
  if (!raw?.id) return undefined
  const id = String(raw.id)
  const local = iconOf?.(id) ?? ""
  return {
    id,
    level: raw.level ?? 0,
    rarity: raw.rarity ?? "A",
    icon: local || (raw.bangboo_rectangle_url ?? ""),
    fromMeta: !!local
  }
}

/**
 * 星格逐个摊开
 *
 * 在模板里数不出来：art-template 里取不到 `Array`，循环只能照着一个真实数组来。
 * @param star 已得星数
 * @param total 满星数
 * @returns 长度为满星数的布尔数组，已得的在前
 */
export function zzzStars(star: number, total: number): boolean[] {
  const out: boolean[] = []
  for (let i = 0; i < total; i++) out.push(i < star)
  return out
}
/**
 * 一队的文字形态，出图失败时用
 * @param avatars 出图形态的三格
 * @returns 逗号分隔的名字；名字补不到时退回 id
 */
export function zzzTeamText(avatars: readonly ZzzAvatarView[]): string {
  const names = avatars.filter(it => !it.empty).map(it => `${it.name || it.id}${it.rank ? `（${it.rank}影）` : ""}`)
  return names.length > 0 ? names.join("、") : "无阵容记录"
}

/**
 * 取首领：一部分接口给数组，一部分给对象
 * @param boss 接口给的那一项
 * @returns 第一个首领；没有时空对象
 */
export function zzzBoss(boss: ZzzBossRaw[] | ZzzBossRaw | undefined): ZzzBossRaw {
  if (Array.isArray(boss)) return boss[0] ?? {}
  return boss ?? {}
}
