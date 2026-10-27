/**
 * 模块职责：复刻统计的视图模型 —— 某个角色 / 武器复刻过几次、各版本 UP 名单
 * 依赖方向：依赖 meta/pool（卡池表）与 meta/loader（图标）；不碰 IO、不碰模板
 * 生命周期：无状态
 * 注意事项：**集录池并入常规池表**并给 `half` 加「(混池)」后缀（集录池也是一次 UP、漏掉会少数）。{@link ALWAYS_UP} 里的角色武器不参与统计（常驻池恒有、计入会占满榜首）。图标取自元数据、未装时为空串、不因缺图整条命令失败。
 */
import type { MetaLoader } from "../meta/loader.js"
import type { PoolGame, PoolVersion } from "../meta/pool.js"
import type { PoolTable } from "../meta/pool.js"
import { INDENT } from "../core/text.js"

/** 传给既有模板的一份数据 */
export type TemplateData = Record<string, unknown>

/** 常驻池恒有的角色与武器，不计入复刻统计（不随版本增删） */
export const ALWAYS_UP: readonly string[] = [
  "刻晴",
  "提纳里",
  "迪希雅",
  "梦见月瑞希",
  "狼的末路",
  "风鹰剑",
  "阿莫斯之弓",
  "四风原典",
  "和璞鸢",
  "天空之翼",
  "天空之刃",
  "天空之傲",
  "天空之卷",
  "天空之脊"
]

/** 要查的是角色还是武器 */
export type BannerKind = "char" | "weapon"

/** 造复刻统计视图的上下文 */
export interface BannerContext {
  /** 游戏 */
  game: PoolGame
  /** 卡池表 */
  pool: PoolTable
  /** 元数据装载器，取图标用 */
  meta?: MetaLoader
  /** 当前时间，测试注入 */
  now?: number
}

/**
 * 一天的毫秒数
 */
const DAY = 24 * 60 * 60 * 1000

/**
 * 算两个时刻相隔几天
 *
 * 四舍五入到整天，`from` 早于 `to` 时为正。
 * @param from 起点时间字符串
 * @param to 终点，省略时取 `now`
 * @param now 当前时间
 * @returns 天数
 */
function daysSince(from: string, to: string | undefined, now: number): number {
  const end = to ? new Date(to.replace(/-/g, "/")).getTime() : now
  const start = new Date(from.replace(/-/g, "/")).getTime()
  if (!Number.isFinite(end) || !Number.isFinite(start)) return 0
  return Math.round((end - start) / DAY)
}

/**
 * 版本号 → 可比较的数字
 *
 * `5.3` 直接 `Number()`；`新版本` 一类兜底条目取不出、归为最大值恒排最前（它正是「当前正在开的池子」）。
 * @param version 版本号
 * @returns 可比较的数字
 */
function versionNum(version: string): number {
  const got = Number(version)
  return Number.isFinite(got) ? got : Number.MAX_SAFE_INTEGER
}

/**
 * 取一份"常规池 + 集录池"的合并版本表
 *
 * 集录池的 `half` 加后缀以示区别。
 * @param table 卡池表
 * @param game 游戏
 * @returns 合并后的版本表
 */
function allVersions(table: PoolTable, game: PoolGame): PoolVersion[] {
  const suffix = game === "gs" ? "(混池)" : "(联动池)"
  return [...table.versions(game), ...table.mixVersions(game).map(it => ({ ...it, half: `${it.half}${suffix}` }))]
}

/**
 * 取一个条目的图标
 * @param ctx 上下文
 * @param name 名称
 * @returns 相对元数据根的图标路径；查不到时空串
 */
function iconOf(ctx: BannerContext, name: string): string {
  const item = ctx.meta?.byName(ctx.game, name)
  // 角色有 face、武器 / 光锥有 icon（两者互斥，见 MetaItem），只取 face 会让武器那栏整块空白
  return item?.face ?? item?.icon ?? ""
}

/**
 * 取一个条目的简称
 * @param ctx 上下文
 * @param name 名称
 * @returns 简称；查不到时用原名
 */
function abbrOf(ctx: BannerContext, name: string): string {
  return ctx.meta?.byName(ctx.game, name)?.abbr ?? name
}

/**
 * 单个角色 / 武器的复刻统计 → `gacha/banner-single` 的模板数据
 *
 * 版本表按版本号降序（新的在前），`diffDay` 为与**上一次** UP 的间隔天数。
 * @param name 角色或武器名
 * @param kind 角色还是武器
 * @param ctx 上下文
 * @returns 模板数据；从未 UP 过时 undefined
 */
export function bannerSingleData(name: string, kind: BannerKind, ctx: BannerContext): TemplateData | undefined {
  const now = ctx.now ?? Date.now()
  const sorted = allVersions(ctx.pool, ctx.game).sort((a, b) => versionNum(b.version) - versionNum(a.version))
  const hit = sorted.filter(it => (it[`${kind}4`] ?? []).includes(name) || (it[`${kind}5`] ?? []).includes(name))
  if (!hit.length) return undefined

  const list = hit.map((it, index) => {
    const one: TemplateData = {
      ...it,
      // 卡池标题取自当期 UP 五星角色的卡池名，如 `赤团开时`
      title: (it.char5 ?? []).map(c => ctx.pool.poolName(ctx.game, c) ?? c),
      char: [
        ...(it.char5 ?? []).map(c => ({ name: abbrOf(ctx, c), star: 5, icon: iconOf(ctx, c) })),
        ...(it.char4 ?? []).map(c => ({ name: abbrOf(ctx, c), star: 4, icon: iconOf(ctx, c) }))
      ],
      weapon: [
        ...(it.weapon5 ?? []).map(w => ({ name: abbrOf(ctx, w), star: 5, icon: iconOf(ctx, w) })),
        ...(it.weapon4 ?? []).map(w => ({ name: abbrOf(ctx, w), star: 4, icon: iconOf(ctx, w) }))
      ]
    }
    // 与上一次 UP 的间隔：下一条（更旧的那条）的结束时刻到本条开始时刻
    const older = hit[index + 1]
    if (older) one["diffDay"] = daysSince(older.to, it.from, now)
    return one
  })

  const newest = hit[0]
  return {
    type: kind,
    name,
    game: ctx.game,
    version_list: list,
    count: list.length,
    // 距今多少天未复刻；仍在开放时为负数，模板据此显示"当前 UP"
    daysDiff: newest ? daysSince(newest.to, undefined, now) : 0
  }
}

/**
 * 全部角色 / 武器的复刻统计 → `gacha/banner-all` 的模板数据
 *
 * 按"距今间隔"降序 —— 越久没复刻的排越前，这正是使用者要看的。
 * @param kind 角色还是武器
 * @param star 星级，4 或 5
 * @param ctx 上下文
 * @returns 模板数据
 */
export function bannerAllData(kind: BannerKind, star: 4 | 5, ctx: BannerContext): TemplateData {
  const now = ctx.now ?? Date.now()
  const key = `${kind}${star}` as "char4" | "char5" | "weapon4" | "weapon5"
  // 版本号升序遍历，使同一角色的统计以最新一次 UP 收尾
  const sorted = allVersions(ctx.pool, ctx.game).sort((a, b) => versionNum(a.version) - versionNum(b.version))

  const map = new Map<string, TemplateData>()
  for (const version of sorted) {
    for (const name of version[key] ?? []) {
      if (ALWAYS_UP.includes(name)) continue
      const prev = map.get(name)
      const count = Number(prev?.["count"] ?? 0) + 1
      const one: TemplateData = {
        ...version,
        name,
        count,
        icon: iconOf(ctx, name),
        version: `${version.version}${version.half}`,
        daysDiff: daysSince(version.to, undefined, now)
      }
      // 尚未开始的池子：模板据 daysStar 显示"下期 UP"
      const fromDiff = daysSince(version.from, undefined, now)
      if (Number(one["daysDiff"]) < 0 && fromDiff < 0) one["daysStar"] = fromDiff
      map.set(name, one)
    }
  }

  const data = [...map.values()].sort((a, b) => Number(b["daysDiff"]) - Number(a["daysDiff"]))
  const fresh = data.filter(it => Number(it["daysDiff"]) < 0 && it["daysStar"] === undefined)

  return {
    game: ctx.game,
    type: kind === "char" ? "角色" : ctx.game === "sr" ? "光锥" : "武器",
    star,
    data,
    new_pool: { name: fresh.map(it => String(it["name"])), data: fresh }
  }
}

/**
 * 复刻统计 → 纯文字
 * @param data 模板数据
 * @returns 多行文本
 */
export function bannerText(data: TemplateData): string {
  const list = (data["data"] ?? []) as { name?: string; count?: number; version?: string; daysDiff?: number }[]
  if (!list.length) return "卡池表里没有可统计的条目，请先发送「#更新元数据」"
  const lines = [`${data["star"]} 星${data["type"]}复刻统计（共 ${list.length} 个）`]
  for (const it of list.slice(0, 15)) {
    const days = Number(it.daysDiff ?? 0)
    const when = days > 0 ? `已 ${days} 天未复刻` : "当前 UP"
    lines.push(`${INDENT}${it.name ?? ""} ${it.count ?? 0} 次，上次 ${it.version ?? "?"}，${when}`)
  }
  if (list.length > 15) lines.push(`${INDENT}另有 ${list.length - 15} 个未列出`)
  return lines.join("\n")
}

/**
 * 单个条目的复刻统计 → 纯文字
 * @param data 模板数据
 * @returns 多行文本
 */
export function bannerSingleText(data: TemplateData): string {
  const list = (data["version_list"] ?? []) as { version?: string; half?: string; from?: string; diffDay?: number }[]
  const days = Number(data["daysDiff"] ?? 0)
  const lines = [
    `${data["name"]} 共复刻 ${data["count"]} 次，${days > 0 ? `已 ${days} 天未复刻` : "当前 UP"}`
  ]
  for (const it of list.slice(0, 12)) {
    const gap = it.diffDay === undefined ? "首次 UP" : `距上次 ${it.diffDay} 天`
    lines.push(`${INDENT}${it.version ?? ""} ${it.half ?? ""} ${it.from?.slice(0, 10) ?? ""} ${gap}`)
  }
  if (list.length > 12) lines.push(`${INDENT}另有 ${list.length - 12} 次未列出`)
  return lines.join("\n")
}
