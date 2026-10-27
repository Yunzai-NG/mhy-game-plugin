/**
 * 模块职责：材料元数据的装载与查询 —— 星级阶梯、图标、简称，以及原神的"周几能刷"
 * 依赖方向：只读磁盘上已装好的 `meta-<游戏>/material/`；依赖 meta/daily-parse 与 meta/abbr-parse
 * 生命周期：随插件 setup 造一个实例，首次查询时按游戏懒加载并常驻内存
 * 注意事项：`material/data.json` 两种形态、装载分两支，分界在包而非游戏：原神是「全名 → 条目」的
 *          扁平表且带低阶阶梯，星铁绝区零先按桶分组、桶内按**材料 id** 索引、无阶梯无轮换，合成一支
 *          必丢其一。按名查与按 id 查两张索引都要建——星铁 `tree` 的 `cost`、绝区零 `promote` 给的都是
 *          材料 id，缺 id 索引则那两个游戏的材料一栏整个空着。国家由数组下标决定、不在数据里
 *          （见 daily-parse 的 `CITY_BY_INDEX`）。元数据未装时全部查询返回 undefined 而不抛错。
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Logger } from "@yunzai-ng/types"
import { ABBR_SOURCE, parseAbbrFile } from "./abbr-parse.js"
import type { DailyType, ParsedDaily } from "./daily-parse.js"
import { cityAt, materialAbbr, parseDailyFile } from "./daily-parse.js"
import type { MetaGame } from "./download.js"

/**
 * `material/daily.js` 的文件名
 *
 * 恒放行落盘、只解析不求值的 `.js`（见 meta/daily-parse 文件头）。
 */
export const DAILY_SOURCE = "daily.js"

/** 一个材料条目 */
export interface MaterialItem {
  /** 全名 */
  name: string
  /**
   * 类别
   *
   * 原神是 `talent`/`weapon`/`boss`/`gem` 等字符串，星铁是四个桶名之一。图标目录按它分，两边都原样留。
   */
  type: string
  /**
   * 突破位次
   *
   * 原神与 {@link type} 同值；星铁是 `data.json` 里那个数字类别（`101` 信用点、`201` 晋升材料……）。
   * **星铁材料表按它去重**：同一位次出现好几个星级、取最高，见 views/char-wiki 的 `srMaterials`。
   */
  poseType: string
  /** 星级 */
  star: number
  /** 简称 */
  abbr: string
  /** 图鉴上的标题；有国家写成「蒙德·诗文」，没有的就是简称 */
  label: string
  /** 轮换周期，`1` 周一四 / `2` 周二五 / `3` 周三六；不轮换的材料没有 */
  week?: number
  /** 所属国家；超出已知国家名时为空串 */
  city?: string
  /** 国家序号，1 起，分组用 */
  cid?: number
  /** 星级 → 该阶的材料名，低阶在前 */
  items?: Record<string, string>
  /** 图标，相对元数据根目录 */
  icon: string
  /** 「周一/周四」一类的可刷日说明；不轮换的材料为空串 */
  source: string
}

/** `material/data.json` 里本模块用到的字段 */
interface RawMaterial {
  /** id，星铁的索引键 */
  id?: number | string
  /** 全名 */
  name?: string
  /** 类别；原神是字符串，星铁是数字（即 {@link MaterialItem.poseType}） */
  type?: string | number
  /** 星级 */
  star?: number
  /** 低阶材料，键为名称，仅原神有 */
  items?: Record<string, { name?: string; star?: number; type?: string }>
}

/** 轮换周期号 → 可刷日说明 */
const WEEK_TEXT: readonly string[] = ["周一/周四", "周二/周五", "周三/周六"]

/** 一个游戏的两张索引 */
interface GameMaterials {
  /** 全名 → 条目 */
  byName: Map<string, MaterialItem>
  /** 材料 id → 条目，星铁用 */
  byId: Map<string, MaterialItem>
}

/** 造材料表需要的东西 */
export interface MaterialTableOptions {
  /** 元数据根目录，与安装器的 `dir` 一致 */
  dir: string
  /** 日志器 */
  logger: Logger
}

/**
 * 判一个类别是否参与每日轮换
 * @param type 类别
 * @returns 是天赋书或武器材料时为真
 */
function isDaily(type: string): type is DailyType {
  return type === "talent" || type === "weapon"
}

/**
 * 材料表
 *
 * 按游戏懒加载，一次装完该游戏的全部条目（两个游戏各几百条，远小于角色详情），
 * 故不像 loader 那样再分一级详情缓存。
 */
export class MaterialTable {
  readonly #dir: string
  readonly #logger: Logger
  /** 游戏 → 两张索引；缺键表示还没装过 */
  readonly #cache = new Map<MetaGame, GameMaterials>()

  /**
   * @param opts 选项
   */
  constructor(opts: MaterialTableOptions) {
    this.#dir = opts.dir
    this.#logger = opts.logger
  }

  /**
   * 丢掉已装载的缓存
   *
   * 元数据更新后调用：新国家的天赋书要即时认得出，否则那批角色在 `#今日材料` 里整个漏掉。
   */
  reload(): void {
    this.#cache.clear()
  }

  /**
   * 读并解析每日轮换表
   * @param base 该游戏的元数据目录
   * @returns 轮换表；文件不存在或解析失败时 undefined
   */
  #daily(base: string): ParsedDaily | undefined {
    const path = join(base, "material", DAILY_SOURCE)
    if (!existsSync(path)) return undefined
    try {
      return parseDailyFile(readFileSync(path, "utf8"))
    } catch (err) {
      this.#logger.warn(
        `[米游社][元数据] ${DAILY_SOURCE} 解析失败，今日材料暂不可用：${err instanceof Error ? err.message : String(err)}`
      )
      return undefined
    }
  }

  /**
   * 读并解析简称表
   * @param base 该游戏的元数据目录
   * @returns 全名 → 简称；文件不存在或解析失败时空表
   */
  #abbr(base: string): Record<string, string> {
    const path = join(base, "material", ABBR_SOURCE)
    if (!existsSync(path)) return {}
    try {
      return parseAbbrFile(readFileSync(path, "utf8")) ?? {}
    } catch (err) {
      this.#logger.warn(
        `[米游社][元数据] ${ABBR_SOURCE} 解析失败，材料简称暂用全名：${err instanceof Error ? err.message : String(err)}`
      )
      return {}
    }
  }

  /**
   * 装载一个游戏的材料表
   * @param game 游戏
   * @returns 两张索引
   */
  #load(game: MetaGame): GameMaterials {
    const cached = this.#cache.get(game)
    if (cached) return cached

    const out: GameMaterials = { byName: new Map(), byId: new Map() }
    const base = join(this.#dir, `meta-${game}`)
    const raw = readJson<Record<string, unknown>>(join(base, "material", "data.json"))
    if (!raw) {
      this.#logger.debug(`[米游社][元数据] meta-${game} 的材料数据尚未安装，图鉴的材料一栏暂不可用`)
      this.#cache.set(game, out)
      return out
    }

    if (game === "gs") this.#loadGs(out, base, raw as Record<string, RawMaterial>)
    else this.#loadBuckets(out, base, raw as Record<string, Record<string, RawMaterial>>, game)

    this.#cache.set(game, out)
    return out
  }

  /**
   * 装载原神的材料表
   *
   * 先按全名建条目、给天赋书与武器材料算简称并查周期，再登记低阶材料。**登记次序不能反**：低阶先写、
   * 高阶后写——天赋书最高阶在 `items` 里也出现一次，反过来写会把带 `week` 的那份覆盖成不带的，
   * 于是 `#今日材料` 一个角色都排不出来。
   * @param out 要填的两张索引
   * @param base 元数据目录
   * @param raw `material/data.json`
   */
  #loadGs(out: GameMaterials, base: string, raw: Readonly<Record<string, RawMaterial>>): void {
    const daily = this.#daily(base)
    const abbr = this.#abbr(base)

    for (const ds of Object.values(raw)) {
      const name = ds.name
      const type = typeof ds.type === "string" ? ds.type : ""
      if (!name || !type) continue

      const one: MaterialItem = {
        name,
        type,
        poseType: type,
        star: Number(ds.star) || 0,
        abbr: isDaily(type) ? materialAbbr(name, type) : (abbr[name] ?? name),
        label: "",
        icon: iconOf("gs", type, name),
        source: ""
      }

      if (isDaily(type)) {
        const found = findWeek(daily?.[type], one.abbr)
        if (found) {
          one.week = found.week
          one.city = cityAt(found.at)
          one.cid = found.at + 1
          one.source = WEEK_TEXT[found.week - 1] ?? ""
          if (!one.city) one.city = one.abbr
        }
      }
      one.label = labelOf(one)

      if (ds.items) {
        const items: Record<string, string> = {}
        for (const item of Object.values(ds.items)) {
          if (!item.name) continue
          items[String(item.star ?? 0)] = item.name
          const sub: MaterialItem = {
            name: item.name,
            type: item.type ?? type,
            poseType: item.type ?? type,
            star: Number(item.star) || 0,
            abbr: abbr[item.name] ?? item.name,
            label: "",
            icon: iconOf("gs", item.type ?? type, item.name),
            source: ""
          }
          sub.label = labelOf(sub)
          out.byName.set(item.name, sub)
        }
        one.items = items
      }

      out.byName.set(name, one)
    }
  }

  /**
   * 装载按桶分组的材料表 —— 星铁与绝区零两份包都是这个形态
   *
   * 桶名当类别（图标目录按它分），桶内条目的数字 `type` 当突破位次；无轮换无阶梯。简称表有则用、没有用全名。
   * @param out 要填的两张索引
   * @param base 元数据目录
   * @param raw `material/data.json`，先按桶分组
   * @param game 游戏，拼图标路径用
   */
  #loadBuckets(
    out: GameMaterials,
    base: string,
    raw: Readonly<Record<string, Record<string, RawMaterial>>>,
    game: MetaGame
  ): void {
    const abbr = this.#abbr(base)
    for (const [bucket, items] of Object.entries(raw)) {
      for (const ds of Object.values(items ?? {})) {
        const name = ds.name
        if (!name) continue
        const short = abbr[name] ?? name
        const one: MaterialItem = {
          name,
          type: bucket,
          poseType: String(ds.type ?? ""),
          star: Number(ds.star) || 0,
          abbr: short,
          label: short,
          icon: iconOf(game, bucket, name),
          source: ""
        }
        out.byName.set(name, one)
        if (ds.id !== undefined) out.byId.set(String(ds.id), one)
      }
    }
  }

  /**
   * 按名称查一个材料
   * @param name 材料全名
   * @param game 游戏，缺省原神
   * @returns 条目；查不到时 undefined
   */
  get(name: string, game: MetaGame = "gs"): MaterialItem | undefined {
    if (!name) return undefined
    return this.#load(game).byName.get(name)
  }

  /**
   * 按材料 id 查一个材料
   *
   * 星铁的突破材料在 `tree` / `treeData` 的 `cost` 里只给 id，故这条路不可省。
   * @param id 材料 id
   * @param game 游戏，缺省原神
   * @returns 条目；查不到时 undefined
   */
  byId(id: string | number, game: MetaGame = "gs"): MaterialItem | undefined {
    const key = String(id)
    if (!key) return undefined
    return this.#load(game).byId.get(key)
  }

  /**
   * 列出一类材料
   *
   * **低阶材料（教导 / 指引）也在返回里**，调用方须自行按 `star` 筛：只有最高一阶带 `week` 与 `city`。
   * @param type 类别，如 `talent` / `weapon`
   * @param game 游戏，缺省原神
   * @returns 条目数组，调用方不应改动它
   */
  each(type: string, game: MetaGame = "gs"): readonly MaterialItem[] {
    return [...this.#load(game).byName.values()].filter(one => one.type === type)
  }

  /**
   * 材料数据是否可用
   * @param game 游戏，缺省原神
   * @returns 有条目时为真
   */
  ready(game: MetaGame = "gs"): boolean {
    return this.#load(game).byName.size > 0
  }

  /**
   * 取一个材料的星级阶梯图标，高阶在前
   *
   * `items` 按星级升序存，取出整体反转即高阶在前。只有原神有阶梯。
   * @param name 材料全名
   * @returns 图标路径，相对元数据根目录
   */
  ladder(name: string): string[] {
    const one = this.get(name)
    if (!one?.items) return []
    return Object.values(one.items)
      .map(it => this.get(it)?.icon ?? "")
      .filter(it => !!it)
      .reverse()
  }
}

/**
 * 读一个 JSON 文件，失败时返回 undefined
 * @param path 文件路径
 * @returns 解析结果；读不到或解不开时 undefined
 */
function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return undefined
  }
}

/**
 * 拼一个材料的图标路径
 * @param game 游戏
 * @param type 类别
 * @param name 全名
 * @returns 相对元数据根目录的路径
 */
function iconOf(game: MetaGame, type: string, name: string): string {
  return `meta-${game}/material/${type}/${name}.webp`
}

/**
 * 算一个材料在图鉴上的标题
 *
 * 有国家就冠上国家名——那是天赋书与武器材料唯一能区分同档三个副本的信息。
 * @param one 条目
 * @returns 标题
 */
function labelOf(one: Readonly<Pick<MaterialItem, "abbr" | "city">>): string {
  return one.city ? `${one.city}·${one.abbr}` : one.abbr
}

/**
 * 在轮换表里找一个简称
 * @param table 某一类的轮换表，周期号 → 按国家次序的简称
 * @param abbr 简称
 * @returns 周期号与列号；找不到时 undefined
 */
function findWeek(
  table: Readonly<Record<string, string[]>> | undefined,
  abbr: string
): { week: number; at: number } | undefined {
  for (const [week, list] of Object.entries(table ?? {})) {
    const at = list.indexOf(abbr)
    if (at !== -1) return { week: Number(week), at }
  }
  return undefined
}
