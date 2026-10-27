/**
 * 模块职责：抽卡分析与卡池统计的视图模型 —— 逐池分析与按版本统计
 * 依赖方向：依赖 store/gacha 的记录类型、meta/pool 的版本表与 meta/loader 的图标；不碰 IO
 * 生命周期：无状态纯函数
 * 注意事项：与 {@link ../views/gacha.ts} 分工：那份是「逐池保底进度」（`#抽卡记录`），本份是「按版本切分的 UP 分析」（`#抽卡分析`/`#抽卡统计`），口径不同不能合并。
 *          **「歪」的判定是三态的**（见 meta/pool 的 `isUp`）：卡池表未覆盖该时段时既不算 UP 也不算歪，写成二态会让新版本刚开那几天每一发都算「歪」。统计**从最早一条往后走**（垫抽是「上个五星之后又抽了多少」，方向反了就不是垫抽），故先按 id 升序排。
 */
import { INDENT } from "../core/text.js"
import type { GachaRecord } from "../store/gacha.js"
import { compareGachaId } from "../store/gacha.js"
import type { MetaLoader } from "../meta/loader.js"
import type { PoolGame, PoolTable } from "../meta/pool.js"

/** 传给既有模板的一份数据 */
export type TemplateData = Record<string, unknown>

/** 单抽折算的原石 / 星琼数 */
const PULL_COST = 160

/** 五星未收录时的占位 id */
const UNKNOWN_CHAR = "404"

/** 武器未收录时的占位 id */
const UNKNOWN_WEAPON = "403"

/** "距今仍未出金"那一条的占位 id */
const PENDING_ID = "888"

/** 未出金占位项不给元数据图：模板按 `img` 为空换插件自带的 no-avatar 占位（在资源根，不在元数据根） */
const NO_AVATAR = ""

/** 造分析视图的上下文 */
export interface GachaStatContext {
  /** 游戏 */
  game: PoolGame
  /** uid */
  uid: string
  /** 卡池表 */
  pool: PoolTable
  /** 元数据装载器，取图标与简称用 */
  meta?: MetaLoader
  /** 当前时间，测试注入 */
  now?: number
}

/** 分析用到的一条记录，已补好元数据 */
interface Item {
  /** 物品 id 或占位 id */
  id: string
  /** 记录 id */
  logId: string
  /** 抽取时刻的毫秒值 */
  at: number
  /** 星级 */
  star: number
  /** 是角色还是武器 */
  kind: "char" | "weapon"
  /** 物品名 */
  name: string
}

/** 模板里 `itemMap` 的一项 */
interface MapEntry {
  /** 类型 */
  type: "char" | "weapon"
  /** 出现次数 */
  count: number
  /** 星级 */
  star: number
  /** 全名 */
  name: string
  /** 简称 */
  abbr: string
  /** 图标，相对元数据根目录 */
  img: string
}

/**
 * 把时间字符串解析成毫秒
 *
 * 抽卡记录给的是服务器本地时间（`2026-08-12 18:03:21`），不带时区，与卡池表口径一致。
 * @param text 时间字符串
 * @returns 毫秒值；解析不出时为 0
 */
function parseTime(text: string): number {
  const ms = new Date(text.replace(/-/g, "/")).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * 判断一条记录是角色还是武器
 *
 * 三个游戏的 `item_type` 各不相同（`角色` / `武器` / `光锥`），故按"不是武器就是角色"处理。
 * @param itemType 接口给的物品类型
 * @returns 类型
 */
function kindOf(itemType: string): "char" | "weapon" {
  return /武器|光锥|音擎/.test(itemType) ? "weapon" : "char"
}

/**
 * 星级归一到"三星起、五星顶"这一套刻度
 *
 * **绝区零是 B/A/S 三档、接口与元数据都记作 2/3/4**（另两游戏是 3/4/5），不折算则绝区零**永远数不出一个五星**（本层按 `star===5` 挑金卡）、四五星两块图整块空。
 * 折算放读取侧而非落库侧：元数据里绝区零 `star` 同样是 2/3/4（落库折了会打架），且已存记录补不回来（只增不减），归一放这里存量与新取一并为真、不必迁移。{@link prepare} 是接口星级与元数据星级唯一汇合处。
 * @param star 原始星级
 * @param game 游戏
 * @returns 三到五之间的星级
 */
export function normalizeStar(star: number, game: GachaStatContext["game"]): number {
  if (game !== "zzz") return star
  // B=2 / A=3 / S=4，整体加一即与另两个游戏同刻度；已是新刻度的（导入进来的 UIGF）不再动
  return star >= 5 ? star : Math.min(5, Math.max(3, star + 1))
}

/**
 * 记录 → 分析用的形态，并顺便建好 `itemMap`
 *
 * 元数据未安装时图标为空串、简称回落成全名 —— 少一个图标仍应出图。
 * 星级在此处一并归一（见 {@link normalizeStar}），故本层往下一律是 3 / 4 / 5 那一套刻度。
 * @param records 记录，新的在前
 * @param ctx 上下文
 * @returns 升序的记录与 itemMap
 */
function prepare(records: readonly GachaRecord[], ctx: GachaStatContext): { items: Item[]; map: Record<string, MapEntry> } {
  const map: Record<string, MapEntry> = {}
  const items: Item[] = []

  // 升序：垫抽必须从最早一条往后数
  const asc = [...records].sort((a, b) => compareGachaId(a.id, b.id))
  for (const it of asc) {
    const kind = kindOf(it.itemType)
    const found = ctx.meta?.byName(ctx.game, it.name)
    // 查不到元数据时按 `404:名字` 造键、不共用一个 404（共用会把它们并成一条、星级取自第一条、三星被算成五星）。元数据必然存在时可写定值，而本插件元数据可选，故按名字分开
    const fallback = kind === "char" ? UNKNOWN_CHAR : UNKNOWN_WEAPON
    const id = found?.id || `${fallback}:${it.name}`
    // 接口给的与元数据给的都要折：绝区零两边都是 2/3/4，混用会让同一件物品有两个星级
    const star = normalizeStar(found?.star || it.rank, ctx.game)
    if (!map[id]) {
      map[id] = {
        type: kind,
        count: 0,
        star,
        name: found?.name ?? it.name,
        abbr: found?.abbr ?? it.name,
        // 武器图三个游戏各在一键：原神 `gacha`、星铁光锥 `splash`、绝区零音擎只有 `icon`；只认 `gacha` 时后两者整排是问号
        img: (kind === "char" ? found?.face : (found?.gacha ?? found?.splash ?? found?.icon)) ?? ""
      }
    }
    items.push({ id, logId: it.id, at: parseTime(it.time), star: normalizeStar(it.rank, ctx.game), kind, name: it.name })
  }
  return { items, map }
}

/**
 * 这一发算欧还是非
 *
 * 按保底上限折算：四成以内出金算欧、八成以上（软保底之后）算非。两头之外不标，满屏标签反而看不出谁是谁。
 * @param count 用了多少抽
 * @param maxPity 该池保底上限
 * @returns 欧非标记
 */
function luckOf(count: number, maxPity: number): FiveLog["luck"] {
  if (count <= maxPity * 0.4) return "ou"
  if (count >= maxPity * 0.8) return "fei"
  return ""
}

/** 一次出金的记录，模板按年分组呈现 */
export interface FiveLog {
  /** 物品 id */
  id: string
  /** 是否当期 UP */
  isUp: boolean
  /** 名字旁的标签：`UP` / `歪`；卡池表没覆盖到、或常驻池时为空串（三态，理由见文件头） */
  tag: "UP" | "歪" | ""
  /** 这一发的欧非：`ou` 早出（四成保底内）、`fei` 临近保底（八成以上）、其余空串 */
  luck: "ou" | "fei" | ""
  /** 末尾补的那条「当前垫抽、还没出金」 */
  pending?: boolean
  /** 用了多少抽 */
  count: number
  /** 日期，形如 `08-12` */
  date: string
}

/**
 * 抽卡分析 → `gacha/gacha-detail` 的模板数据
 *
 * 逐条走一遍升序记录即可同时得出五星清单、每发垫抽与当前保底进度。
 * @param records 一个卡池的记录，新的在前
 * @param ctx 上下文
 * @param mix 是否集录 / 联动池，UP 判定要查另一张表
 * @returns 模板数据；没有记录时 undefined
 */
export function gachaDetailData(
  records: readonly GachaRecord[],
  ctx: GachaStatContext,
  mix = false
): TemplateData | undefined {
  const { items, map } = prepare(records, ctx)
  if (!items.length) return undefined

  const now = ctx.now ?? Date.now()
  // 保底上限：角色 / 常驻池 90，武器 / 光锥 / 音擎池 80；条长与欧非都按它折算。
  // 池号三个游戏各一套（星铁 12 是光锥池、绝区零 12 是重映），故按记录里的物品类型判，不按池号
  // 三星恒是武器，故只看四五星：这些全是武器才是武器池
  const ranked = items.filter(it => (map[it.id]?.star ?? it.star) >= 4)
  const maxPity = ranked.length > 0 && ranked.every(it => it.kind === "weapon") ? 80 : 90
  const fiveLog: Record<string, FiveLog[]> = {}
  const years: string[] = []
  let all = 0
  let fiveNum = 0
  let fourNum = 0
  let wai = 0
  let sinceFive = 0
  let sinceFour = 0
  let noFive = 0
  let noFour = 0

  for (const item of items) {
    all++
    const entry = map[item.id]
    if (entry) entry.count++
    const star = entry?.star ?? item.star

    if (star === 4) {
      fourNum++
      if (noFour === 0) noFour = sinceFour
      sinceFour = 0
    }
    sinceFour++

    if (star === 5) {
      fiveNum++
      const verdict = ctx.pool.isUp(ctx.game, item.at, item.name, item.kind === "char", mix)
      // 三态：卡池表没覆盖到就不计入"歪"，理由见文件头
      if (verdict === "wai") wai++

      const year = String(new Date(item.at).getFullYear())
      if (!fiveLog[year]) {
        fiveLog[year] = []
        years.push(year)
      }
      const count = sinceFive + 1
      fiveLog[year].push({
        id: item.id,
        isUp: verdict === "up",
        tag: verdict === "up" ? "UP" : verdict === "wai" ? "歪" : "",
        luck: luckOf(count, maxPity),
        count,
        date: monthDay(item.at)
      })
      sinceFive = 0
      continue
    }
    sinceFive++
  }

  // 一发五星都没出过时，全部抽数都是垫抽
  if (!fiveNum) noFive = all

  // 每年内的五星此前按时间正序（旧→新）压入，翻成倒序让新的排在上，与年份倒序方向一致；
  // 「已抽」那条随后 unshift 到最前，仍在年内最上
  for (const year of years) fiveLog[year]?.reverse()

  // 末尾补一条"已抽 N 未出金"，即当前保底进度
  if (sinceFive > 0) {
    const year = String(new Date(now).getFullYear())
    if (!fiveLog[year]) {
      fiveLog[year] = []
      years.push(year)
    }
    fiveLog[year].unshift({ id: PENDING_ID, isUp: true, tag: "", luck: "", pending: true, count: sinceFive, date: monthDay(now) })
    map[PENDING_ID] = { type: "char", count: 0, star: 5, name: "已抽", abbr: "已抽", img: NO_AVATAR }
  }

  // 出金率与平均出金都排除当前垫抽那一段：那几抽还没有结果
  const settled = all - sinceFive
  // 一发金都没出时这两项无从算起，印「-」而非 0：0 读起来像「平均 0 抽就出金」
  const fiveAvg = fiveNum > 0 ? (settled / fiveNum).toFixed(2) : "-"
  const fourAvg = fourNum > 0 ? ((all - noFour) / fourNum).toFixed(2) : "0"

  // 有效抽卡：平均多少抽能拿到一个 UP
  const upNum = fiveNum - wai
  const valid = upNum > 0 ? (settled / upNum).toFixed(2) : "0"
  const upYs = upNum > 0 ? fold(Number(valid) * PULL_COST) : "-"

  // 四星出得最多的那个
  const fours = Object.values(map)
    .filter(it => it.star === 4)
    .sort((a, b) => b.count - a.count)

  return {
    uid: ctx.uid,
    saveId: ctx.uid,
    game: ctx.game,
    isChar: !mix,
    maxPity,
    // 软保底起点：角色池第 74 抽、武器池第 63 抽起五星概率陡升，条上画一道刻度
    softPity: maxPity === 80 ? 63 : 74,
    gacha: {
      stat: {
        allNum: all,
        noFiveNum: sinceFive || noFive,
        noFourNum: sinceFour,
        fiveNum,
        fourNum,
        fiveAvg,
        fourAvg,
        wai,
        isvalidNum: valid,
        upYs
      },
      yearLists: [...years].sort((a, b) => Number(b) - Number(a)),
      maxFour: fours[0] ?? { name: "无", count: 0 },
      fiveLog,
      noWaiRate: fiveNum > 0 ? (((fiveNum - wai) / fiveNum) * 100).toFixed(1) : "0",
      items: map
    }
  }
}

/**
 * 超过一万折成 "1.23w"
 * @param value 原值
 * @returns 折算后的字符串
 */
function fold(value: number): string {
  return value >= 10_000 ? `${(value / 10_000).toFixed(2)}w` : value.toFixed(0)
}

/**
 * 毫秒 → `08-12`
 * @param ms 毫秒值
 * @returns 月日
 */
function monthDay(ms: number): string {
  const d = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, "0")
  return `${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/**
 * 抽卡分析 → 纯文字
 * @param data 模板数据
 * @returns 多行文本
 */
export function gachaDetailText(data: TemplateData): string {
  const gacha = data["gacha"] as { stat?: Record<string, unknown>; maxFour?: { name?: string; count?: number } } | undefined
  const stat = gacha?.stat ?? {}
  const lines = [
    `${String(data["uid"] ?? "")} 抽卡分析`,
    `共 ${String(stat["allNum"] ?? 0)} 抽，出金 ${String(stat["fiveNum"] ?? 0)} 个，已垫 ${String(stat["noFiveNum"] ?? 0)} 抽`,
    `平均 ${String(stat["fiveAvg"] ?? 0)} 抽出金，歪 ${String(stat["wai"] ?? 0)} 次`,
    `每个 UP 约 ${String(stat["isvalidNum"] ?? 0)} 抽（${String(stat["upYs"] ?? 0)} 原石）`
  ]
  const four = gacha?.maxFour
  if (four?.name && four.name !== "无") lines.push(`四星最多：${four.name} ${four.count ?? 0} 个`)
  return lines.join("\n")
}

/**
 * 按版本切分的卡池统计 → `gacha/gacha-stat` 的模板数据
 *
 * 可传入多个卡池的记录合并统计（`#全部统计` 即角色池 + 武器池 + 集录池）。
 * @param records 记录，可来自多个卡池
 * @param ctx 上下文
 * @param opts 选项
 * @returns 模板数据；没有记录时 undefined
 */
export function gachaStatData(
  records: readonly GachaRecord[],
  ctx: GachaStatContext,
  opts: { mix?: boolean; hasVersion?: boolean; title?: string } = {}
): TemplateData | undefined {
  const { items, map } = prepare(records, ctx)
  if (!items.length) return undefined

  const mix = opts.mix ?? false
  const hasVersion = opts.hasVersion ?? true

  /** 版本键 → 该版本内各物品的出现次数 */
  const buckets = new Map<string, { label: string; from: string; to: string; up: Set<string>; count: Map<string, number> }>()

  for (const item of items) {
    const version = hasVersion ? ctx.pool.versionAt(ctx.game, item.at, mix) : undefined
    const key = hasVersion ? `${version?.version ?? "未知"}${version?.half ?? ""}` : "all"
    let bucket = buckets.get(key)
    if (!bucket) {
      const up = new Set<string>([...(version?.char5 ?? []), ...(version?.weapon5 ?? [])])
      bucket = {
        label: hasVersion ? key : (opts.title ?? "全部统计"),
        from: version?.from ?? "",
        to: version?.to ?? "",
        up,
        count: new Map()
      }
      buckets.set(key, bucket)
    }
    bucket.count.set(item.id, (bucket.count.get(item.id) ?? 0) + 1)
  }

  const versionData: TemplateData[] = []
  const totals: Record<string, number> = {}

  // 新版本在前
  for (const bucket of [...buckets.values()].reverse()) {
    const list: TemplateData[] = []
    const stats: Record<string, number> = {
      w5Num: 0,
      w5UpNum: 0,
      c5Num: 0,
      c5UpNum: 0,
      c4Num: 0,
      w4Num: 0,
      w3Num: 0
    }
    const names: string[] = []

    for (const [id, num] of bucket.count) {
      const entry = map[id]
      if (!entry) continue
      const isUp = bucket.up.has(entry.name)
      if (isUp && entry.star === 5) names.push(entry.abbr)
      list.push({ id, num, star: entry.star, isUp: isUp ? 1 : 0 })

      if (entry.type === "char") {
        if (entry.star === 5) {
          stats["c5Num"] = (stats["c5Num"] ?? 0) + num
          if (isUp) stats["c5UpNum"] = (stats["c5UpNum"] ?? 0) + num
        } else {
          stats["c4Num"] = (stats["c4Num"] ?? 0) + num
        }
      } else if (entry.star === 5) {
        stats["w5Num"] = (stats["w5Num"] ?? 0) + num
        if (isUp) stats["w5UpNum"] = (stats["w5UpNum"] ?? 0) + num
      } else if (entry.star === 4) {
        stats["w4Num"] = (stats["w4Num"] ?? 0) + num
      } else {
        stats["w3Num"] = (stats["w3Num"] ?? 0) + num
      }
    }

    stats["upNum"] = (stats["w5UpNum"] ?? 0) + (stats["c5UpNum"] ?? 0)
    stats["star5Num"] = (stats["w5Num"] ?? 0) + (stats["c5Num"] ?? 0)
    stats["star4Num"] = (stats["w4Num"] ?? 0) + (stats["c4Num"] ?? 0)
    stats["totalNum"] =
      (stats["w5Num"] ?? 0) + (stats["w4Num"] ?? 0) + (stats["w3Num"] ?? 0) + (stats["c5Num"] ?? 0) + (stats["c4Num"] ?? 0)

    for (const [key, num] of Object.entries(stats)) totals[key] = (totals[key] ?? 0) + num

    versionData.push({
      version: bucket.label,
      half: "",
      name: names.join(" / "),
      from: bucket.from ? shortDate(bucket.from) : "",
      to: bucket.to ? shortDate(bucket.to) : "",
      // 星级高的、抽到多的排前面
      items: list.sort((a, b) => Number(b["star"]) - Number(a["star"]) || Number(b["num"]) - Number(a["num"])),
      stats
    })
  }

  const avgUp = (totals["upNum"] ?? 0) === 0 ? 0 : ((totals["totalNum"] ?? 0) / (totals["upNum"] ?? 1)).toFixed(1)

  return {
    uid: ctx.uid,
    saveId: ctx.uid,
    game: ctx.game,
    gacha: { versionData, itemMap: map, totalStat: { ...totals, avgUpNum: avgUp }, isMix: mix }
  }
}

/**
 * `2026-08-12 06:00:00` → `26-08-12`
 * @param text 时间字符串
 * @returns 短日期
 */
function shortDate(text: string): string {
  const d = new Date(text.replace(/-/g, "/"))
  if (!Number.isFinite(d.getTime())) return ""
  const two = (n: number): string => String(n).padStart(2, "0")
  return `${two(d.getFullYear() % 100)}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/**
 * 卡池统计 → 纯文字
 * @param data 模板数据
 * @returns 多行文本
 */
export function gachaStatText(data: TemplateData): string {
  const gacha = data["gacha"] as { versionData?: TemplateData[]; totalStat?: Record<string, unknown> } | undefined
  const total = gacha?.totalStat ?? {}
  const lines = [
    `${String(data["uid"] ?? "")} 卡池统计`,
    `共 ${String(total["totalNum"] ?? 0)} 抽，金卡 ${String(total["star5Num"] ?? 0)} 个，其中 UP ${String(total["upNum"] ?? 0)} 个`,
    `平均 ${String(total["avgUpNum"] ?? 0)} 抽一个 UP`
  ]
  for (const it of (gacha?.versionData ?? []).slice(0, 6)) {
    const stats = it["stats"] as Record<string, unknown> | undefined
    lines.push(`${INDENT}${String(it["version"] ?? "")} ${String(stats?.["totalNum"] ?? 0)} 抽，金 ${String(stats?.["star5Num"] ?? 0)}`)
  }
  return lines.join("\n")
}
