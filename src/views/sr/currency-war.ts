/**
 * 模块职责：货币战争·零和博弈（`*货币战争`）的视图模型
 * 依赖方向：纯函数，依赖 core/text；不发请求、不碰 IO
 * 生命周期：无状态
 * 注意事项：**数字几乎全是字符串**（比大小前过 {@link num}，否则 `"9"` > `"18"`）；**档位与评级是带前缀的枚举串**，剥前缀取末段（{@link enumTail}）。
 *          阵容前后台两组的 `pos` 是全局位次，按它排而非按下标；试用与投影要标出（关系到能否照抄）。
 *          角色头像取元数据（`iconOf`），羁绊 / 策略 / 段位图元数据里没有、用接口的绝对地址。
 */
import { INDENT } from "../../core/text.js"

/** 接口给的段位 */
export interface GridDivisionRaw {
  /** 段位图标，米游社绝对地址 */
  icon?: string
  /** 段位等级 */
  level?: string | number
  /** 带序号的段位名，如「财富造物主44」 */
  name_with_num?: string
  /** 段位名 */
  name?: string
  /** 是否处于晋级赛 */
  is_promotion?: boolean
  /** 带底纹的段位图 */
  icon_with_bg?: string
}

/** 接口给的一件装备 */
export interface GridEquipRaw {
  /** 装备 id */
  equip_id?: string | number
  /** 图标 */
  icon?: string
  /** 类别，形如 `GridFightEquipCategoryCraftable` */
  category?: string
  /** 名称 */
  name?: string
}

/** 接口给的一位上场角色 */
export interface GridRoleRaw {
  /** 角色 id */
  role_id?: string | number
  /** 头像 id，与 `role_id` 通常同值 */
  avatar_id?: string | number
  /** 头像，米游社绝对地址 */
  icon?: string
  /** 星级 */
  star?: string | number
  /** 稀有度 */
  rarity?: string | number
  /** 是否试用角色 */
  is_trial?: boolean
  /** 是否已升级 */
  is_upgrade?: boolean
  /** 是否投影 */
  is_projection?: boolean
  /** 携带的装备 */
  equip_list?: GridEquipRaw[]
  /** 全局位次，前后台合起来编号 */
  pos?: string | number
  /** 角色类别 */
  role_type?: string
  /** 名称，形如「姬子•启行」 */
  name?: string
}

/** 接口给的一个传送门 */
export interface GridPortalRaw {
  /** 传送门 id */
  portal_id?: string | number
  /** 图标 */
  icon?: string
  /** 名称 */
  name?: string
}

/** 接口给的一项投资策略 */
export interface GridAugmentRaw {
  /** 策略 id */
  augment_id?: string | number
  /** 图标 */
  icon?: string
  /** 名称 */
  name?: string
  /** 品质档位 */
  quality?: string | number
}

/** 接口给的一条羁绊 */
export interface GridTraitRaw {
  /** 羁绊 id */
  trait_id?: string | number
  /** 图标 */
  icon?: string
  /** 已激活层数 */
  trait_count?: string | number
  /** 羁绊名 */
  trait_name?: string
  /** 品质档位 */
  quality?: string | number
  /** 羁绊类型 */
  trait_type?: string | number
}

/** 接口给的一条伤害统计 */
export interface GridDamageRaw {
  /** 类型，`DamageTypeRole` 即角色 */
  damage_type?: string
  /** 对应的角色或装备 id */
  id?: string | number
  /** 伤害值，浮点字符串 */
  damage?: string | number
}

/** 接口给的一场存档 */
export interface GridArchiveRaw {
  /** 存档类型，形如 `ArchiveTypeNormal` */
  archive_type?: string
  /** 概要 */
  brief?: {
    /** 存档时刻 */
    archive_time?: string
    /** 存档时刻的秒级时间戳 */
    archive_time_ts?: string | number
    /** 评级，形如 `GridFightArchiveRankS` */
    archive_rank?: string
    /** 剩余生命值 */
    remain_hp?: string | number
    /** 总经济 */
    total_coin?: string | number
    /** 阵容价值 */
    lineup_coin?: string | number
    /** 当时的段位 */
    division?: GridDivisionRaw
  }
  /** 阵容与其余六块 */
  lineup?: {
    /** 前台角色 */
    front_roles?: GridRoleRaw[]
    /** 后台角色 */
    back_roles?: GridRoleRaw[]
    /** 传送门 */
    portal_list?: GridPortalRaw[]
    /** 投资策略 */
    augment_list?: GridAugmentRaw[]
    /** 羁绊 */
    trait_list?: GridTraitRaw[]
    /** 伤害统计 */
    damage_list?: GridDamageRaw[]
  }
}

/** `grid_fight` 接口的返回 */
export interface GridFightRaw {
  /** 总览 */
  grid_fight_brief?: {
    /** 当前段位 */
    division?: GridDivisionRaw
    /** 赛季等级 */
    season_level?: string | number
    /** 本周积分 */
    weekly_score_cur?: string | number
    /** 本周积分上限 */
    weekly_score_max?: string | number
    /** 玩法是否已解锁 */
    unlocked?: boolean
    /** 有没有打过 */
    has_played?: boolean
    /** 图鉴进度（百分数的整数部分） */
    handbook_progress?: string | number
    /** 羁绊进度 */
    trait_progress?: string | number
    /** 任务已完成数 */
    quest_cur?: string | number
    /** 任务总数 */
    quest_max?: string | number
  }
  /** 逐场存档，新的在前 */
  grid_fight_archive_list?: GridArchiveRaw[]
}

/** 出图与出文字共用的上下文 */
export interface GridFightContext {
  /** uid */
  uid: string
  /** 玩家昵称 */
  nickname?: string
  /**
   * 看的是哪一期，「本期」或「上期」
   *
   * **必须印在图上。** 这一块的赛季长，命令层在本期没存档时会自动改问上期 ——
   * 不标明的话，使用者看到的是一张"本期战绩"，而里面其实是上一期的数据。
   */
  period?: string
  /** 角色 id → 元数据头像；不给时头像位空着 */
  iconOf?: (id: string) => string
  /** 看第几场，1 起、新的在前；缺省 1，超出已有场数时取最后一场 */
  pick?: number
}

/** 官方页只列最近这么多场，`*货币战争N` 的 N 也以它为上限 */
export const GRID_RECENT = 10

/** 模式名：官方页只判 `ArchiveTypeHard`（超频博弈），其余一律标准博弈 */
const archiveTypeName = (type: string): string => (type === "Hard" ? "超频博弈" : "标准博弈")

/** 三种「没有内容」，各自要说的话不同 */
export type GridFightState = "locked" | "noData" | "ok"

/**
 * 取一个数
 *
 * 这一族接口的数字几乎全以字符串给出，比大小与算百分比前必须转 —— 不转会把 `"9"` 判成大于 `"18"`。
 * @param value 原值
 * @returns 数值；转不出时 0
 */
function num(value: unknown): number {
  const got = Number(value)
  return Number.isFinite(got) ? got : 0
}

/**
 * 剥掉枚举串的前缀，只留末段
 *
 * 官方这一族的枚举都带长前缀（`GridFightArchiveRankS` 一类），原样印会在图上出现一长串英文、且这些值要进 CSS 类名。判据是**取最后一段大写开头的词**（`...RankS` → `S`、`...TypeNormal` → `Normal`）；认不出时返回空串而非原串。
 * @param value 枚举串
 * @param prefix 已知前缀，给了就按它剥；不给则取末尾那段大写词
 * @returns 末段
 */
export function enumTail(value: string | undefined, prefix?: string): string {
  const text = (value ?? "").trim()
  if (!text) return ""
  if (prefix && text.startsWith(prefix)) return text.slice(prefix.length)
  // 末尾那段以大写起头的词：`...RankS` 取 `S`，`...TypeNormal` 取 `Normal`
  const hit = /([A-Z][a-z0-9]*)$/.exec(text)
  return hit?.[1] ?? ""
}

/**
 * 伤害折算成可读文本
 *
 * 伤害是浮点字符串且量级极大（六百多亿），原样印会占满一行；按万 / 亿折算，与札记、抽卡同一口径。
 * @param value 伤害原值
 * @returns 如 `657.2亿`；没有伤害时 `0`
 */
export function damageText(value: unknown): string {
  const got = num(value)
  if (got <= 0) return "0"
  if (got >= 1e8) return `${(got / 1e8).toFixed(1)}亿`
  if (got >= 1e4) return `${(got / 1e4).toFixed(1)}万`
  return String(Math.round(got))
}

/**
 * 判这份返回有没有可出图的内容
 *
 * **三种分开**：没解锁（`unlocked` 为假）、解锁了但没打过（没有存档）、有内容 —— 合成一句会让「过一阵就有」与「这账号没这个玩法」分不出来。
 * @param raw 接口返回
 * @returns 状态
 */
export function gridFightState(raw: GridFightRaw | undefined): GridFightState {
  const brief = raw?.grid_fight_brief
  if (!brief || brief.unlocked === false) return "locked"
  if (!raw?.grid_fight_archive_list?.length) return "noData"
  return "ok"
}

/** 一位上场角色的出图形态 */
export interface GridRoleView {
  /** 角色 id */
  id: string
  /** 名称 */
  name: string
  /** 头像，元数据相对路径（见 `official-api-is-data-only`）；查不到时空串 */
  icon: string
  /** 星级 */
  star: number
  /** 全局位次 */
  pos: number
  /** 试用角色 */
  trial: boolean
  /** 投影 */
  projection: boolean
  /** 已升级 */
  upgrade: boolean
  /** 携带的装备 */
  equips: { id: string; name: string; icon: string; category: string }[]
}

/**
 * 一组角色摊成出图形态
 *
 * **按 `pos` 排而不是按下标**：`pos` 是前后台合起来的全局位次，接口给的次序未必与它一致，而图上要按位次画。
 * @param list 接口给的一组角色
 * @returns 出图形态
 */
function rolesOf(list: readonly GridRoleRaw[] | undefined, iconOf?: (id: string) => string): GridRoleView[] {
  return [...(list ?? [])]
    .map(one => ({
      id: String(one.role_id ?? one.avatar_id ?? ""),
      name: one.name ?? "",
      icon: iconOf?.(String(one.role_id ?? one.avatar_id ?? "")) ?? "",
      star: num(one.star),
      pos: num(one.pos),
      trial: !!one.is_trial,
      projection: !!one.is_projection,
      upgrade: !!one.is_upgrade,
      equips: (one.equip_list ?? []).map(it => ({
        id: String(it.equip_id ?? ""),
        name: it.name ?? "",
        icon: it.icon ?? "",
        category: enumTail(it.category, "GridFightEquipCategory")
      }))
    }))
    .sort((a, b) => a.pos - b.pos)
}

/**
 * 段位摊成出图形态
 * @param raw 接口给的段位
 * @returns 出图形态
 */
function divisionOf(raw: GridDivisionRaw | undefined): Record<string, unknown> {
  return {
    name: raw?.name ?? "",
    // 带序号那一份更具体（「财富造物主44」），没有才退回不带序号的
    label: raw?.name_with_num ?? raw?.name ?? "",
    level: num(raw?.level),
    icon: raw?.icon ?? "",
    bg: raw?.icon_with_bg ?? "",
    promotion: !!raw?.is_promotion
  }
}

/**
 * 一场存档摊成出图形态
 * @param raw 接口给的一场
 * @returns 出图形态
 */
function archiveOf(raw: GridArchiveRaw, iconOf?: (id: string) => string): Record<string, unknown> {
  const brief = raw.brief
  const lineup = raw.lineup
  const damages = lineup?.damage_list ?? []
  const front = rolesOf(lineup?.front_roles, iconOf)
  const back = rolesOf(lineup?.back_roles, iconOf)
  // 伤害条只给 id 与类型：角色 / 羁绊 / 投资策略三族，名字与图从同一场的阵容、羁绊、策略里按 id 取（官方页同法）
  const roles = new Map([...front, ...back].map(one => [one.id, one]))
  const traits = new Map((lineup?.trait_list ?? []).map(one => [String(one.trait_id ?? ""), one]))
  const augments = new Map((lineup?.augment_list ?? []).map(one => [String(one.augment_id ?? ""), one]))
  const roleDamage = damages
    .map(one => {
      const id = String(one.id ?? "")
      const kind = one.damage_type === "DamageTypeRole" ? "role" : one.damage_type === "DamageTypeTrait" ? "trait" : one.damage_type === "DamageTypeAugment" ? "augment" : ""
      const name = kind === "role" ? roles.get(id)?.name : kind === "trait" ? traits.get(id)?.trait_name : kind === "augment" ? augments.get(id)?.name : undefined
      return { id, kind, name: name ?? "", icon: kind === "role" ? (roles.get(id)?.icon ?? iconOf?.(id) ?? "") : "", raw: num(one.damage), text: damageText(one.damage) }
    })
    .filter(one => one.kind !== "")
    .sort((a, b) => b.raw - a.raw)
  const total = roleDamage.reduce((sum, one) => sum + one.raw, 0)
  const type = enumTail(raw.archive_type, "ArchiveType")

  return {
    type,
    typeName: archiveTypeName(type),
    time: brief?.archive_time ?? "",
    // 评级只留末段（`S` / `A`），模板据它挑颜色
    rank: enumTail(brief?.archive_rank, "GridFightArchiveRank"),
    hp: num(brief?.remain_hp),
    coin: num(brief?.total_coin),
    lineupCoin: num(brief?.lineup_coin),
    division: divisionOf(brief?.division),
    front,
    back,
    portals: (lineup?.portal_list ?? []).map(one => ({
      id: String(one.portal_id ?? ""),
      name: one.name ?? "",
      icon: one.icon ?? ""
    })),
    augments: (lineup?.augment_list ?? []).map(one => ({
      id: String(one.augment_id ?? ""),
      name: one.name ?? "",
      icon: one.icon ?? "",
      quality: num(one.quality)
    })),
    traits: (lineup?.trait_list ?? []).map(one => ({
      id: String(one.trait_id ?? ""),
      name: one.trait_name ?? "",
      icon: one.icon ?? "",
      count: num(one.trait_count),
      quality: num(one.quality)
    })),
    damages: roleDamage.map(one => ({
      ...one,
      // 占比给百分数，图上画条形；总伤害为 0 时不画
      pct: total > 0 ? Math.round((one.raw / total) * 100) : 0
    })),
    damageTotal: damageText(total)
  }
}

/**
 * `grid_fight` → 出图数据
 *
 * **一张图只画一场**（`one`，缺省最新那场），另给最近 {@link GRID_RECENT} 场的一行摘要（`recent`）供按序号挑；
 * 全部画出来图会长到没法看。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function gridFightData(raw: GridFightRaw | undefined, ctx: GridFightContext): Record<string, unknown> {
  const brief = raw?.grid_fight_brief
  const list = (raw?.grid_fight_archive_list ?? []).slice(0, GRID_RECENT)
  const archives = list.map(one => archiveOf(one, ctx.iconOf))
  const pick = Math.min(Math.max(1, Math.floor(ctx.pick ?? 1)), Math.max(1, archives.length))

  return {
    game: "sr",
    title: "货币战争·零和博弈",
    uid: ctx.uid,
    nickname: ctx.nickname ?? "",
    // 缺省「本期」：调用方不给时那就是本期，图上留空会让人以为漏印了
    period: ctx.period ?? "本期",
    division: divisionOf(brief?.division),
    seasonLevel: num(brief?.season_level),
    weekly: {
      cur: num(brief?.weekly_score_cur),
      max: num(brief?.weekly_score_max),
      // 满了另标一枚角标：本周该拿的分都拿到了
      full: num(brief?.weekly_score_max) > 0 && num(brief?.weekly_score_cur) >= num(brief?.weekly_score_max)
    },
    // 这三项接口给的就是百分数的整数部分，直接补 % 即可
    handbook: num(brief?.handbook_progress),
    trait: num(brief?.trait_progress),
    quest: { cur: num(brief?.quest_cur), max: num(brief?.quest_max) },
    total: list.length,
    archives,
    pick,
    one: archives[pick - 1] ?? {},
    recent: archives.map((it, i) => ({
      index: i + 1,
      rank: it["rank"],
      division: (it["division"] as { label: string }).label,
      time: it["time"],
      on: i + 1 === pick
    }))
  }
}

/**
 * 货币战争 → 纯文字，出图失败时用
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function gridFightText(raw: GridFightRaw | undefined, ctx: GridFightContext): string {
  const state = gridFightState(raw)
  if (state === "locked") return "货币战争尚未解锁，请在游戏内开启后再查询"
  if (state === "noData") return "货币战争本赛季尚无存档，完成一次挑战后再来查询"

  const data = gridFightData(raw, ctx)
  const division = data["division"] as { label: string }
  const weekly = data["weekly"] as { cur: number; max: number }
  const quest = data["quest"] as { cur: number; max: number }
  const lines = [
    `${data["title"] as string} UID ${ctx.uid}`,
    `${INDENT}段位 ${division.label}${INDENT}赛季等级 ${String(data["seasonLevel"])}`,
    `${INDENT}本周积分 ${weekly.cur}/${weekly.max}${INDENT}任务 ${quest.cur}/${quest.max}`,
    `${INDENT}图鉴 ${String(data["handbook"])}%${INDENT}羁绊 ${String(data["trait"])}%`
  ]

  for (const one of data["archives"] as Record<string, unknown>[]) {
    const front = one["front"] as GridRoleView[]
    const back = one["back"] as GridRoleView[]
    const names = [...front, ...back].map(it => it.name || it.id)
    lines.push(
      `${INDENT}${String(one["time"])}${INDENT}评级 ${String(one["rank"]) || "无"}${INDENT}剩余生命 ${String(one["hp"])}`,
      `${INDENT}${INDENT}总经济 ${String(one["coin"])}${INDENT}阵容价值 ${String(one["lineupCoin"])}${INDENT}总伤害 ${String(one["damageTotal"])}`,
      `${INDENT}${INDENT}阵容 ${names.length > 0 ? names.join("、") : "无记录"}`
    )
  }
  return lines.join("\n")
}
