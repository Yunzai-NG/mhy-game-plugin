/**
 * 模块职责：圣遗物 / 遗器的词条元数据 —— 词条表、主副词条候选、id 映射与默认评分权重
 * 依赖方向：只读已装的 `meta-<游戏>/artifact/` 下三个文件（词条表见 meta/arti-parse、`artis-mark.js`）；不发请求
 * 生命周期：首次查询时读一次并常驻内存，元数据更新后 {@link ArtiMetaTable.reload}
 * 注意事项：两份都**只解析不求值**，故评分不需要沙箱。`usefulAttr` 同时被沙箱当注入依赖用（那 57 个 `artis.js`
 *          import 它），是两处共用的。**词条 id 映射是必需的**：米游社面板给副词条时只给 id、不给键名与数值，
 *          `attrIdMap` 与 `mainIdMap` 缺一不可。元数据未装或文件解不开时各表为空、评分恒 0 而不抛错，只记一条日志。
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Logger } from "@yunzai-ng/types"
import { ARTI_META_FILE, parseArtiMeta } from "./arti-parse.js"
import { parseDataExport } from "./js-lit.js"
import { setDirOf } from "./set-dir.js"

/** 有圣遗物元数据的两个游戏；绝区零的驱动盘另有一套评分，见 panel/score/zzz */
export type ArtiGame = "gs" | "sr"

/** 一个词条的元数据 */
export interface AttrMeta {
  /** 展示名，如 `大攻击` */
  title: string
  /** 展示格式，`pct` 百分比 / `comma` 千分位 */
  format: string
  /** 伤害计算时落到哪种字段，`pct` 乘区 / `plus` 加值 */
  calc?: string
  /** 单次强化的最大档位值 */
  value: number
  /** 小词条对应的大词条，如 `atkPlus` → `atk` */
  base?: string
  /** 词条类型，`plus` 小词条 / `normal` 普通 */
  type?: string
  /** 预格式化的展示文字，如 `5.83%` */
  text?: string
}

/** 一个游戏的圣遗物元数据 */
export interface ArtiMeta {
  /** 部位 → 可出现的主词条键，部位号 3/4/5（原神）或 3/4/5/6（星铁） */
  mainAttr: Record<string, string[]>
  /** 可出现的副词条键 */
  subAttr: string[]
  /** 键 → 词条元数据 */
  attrMap: Record<string, AttrMeta>
  /** 展示名 → 键，如 `暴击率` → `cpct` */
  attrNameMap?: Record<string, string>
  /** 主词条 id → 键 */
  mainIdMap?: Record<string, string>
  /** 副词条 id → 键与数值 */
  attrIdMap?: Record<string, { key: string; value: number }>
  /** 单次强化的基准值，原神 3.885 */
  basicNum?: number
  /** 键 → 相对基准值的倍率 */
  attrPct?: Record<string, number>
}

/** 一个角色的默认评分权重，键为词条键，值为 0~100 的权重 */
export type AttrWeight = Record<string, number>

/** 造元数据表需要的东西 */
export interface ArtiMetaOptions {
  /** 元数据根目录，与安装器的 `dir` 一致 */
  metaDir: string
  /** 日志器，文件解不开时报一条 */
  logger?: Logger
}

/**
 * 读一个文本文件
 * @param path 文件路径
 * @returns 内容；不在或读不了时 undefined
 */
function readText(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/** 元数据缺失时的兜底，使调用方不必到处判空 */
const EMPTY: ArtiMeta = { mainAttr: {}, subAttr: [], attrMap: {} }

/**
 * 圣遗物词条元数据表
 *
 * 一个实例管两个游戏，按游戏懒加载。
 */
export class ArtiMetaTable {
  readonly #metaDir: string
  readonly #logger: Logger | undefined
  readonly #meta = new Map<ArtiGame, ArtiMeta>()
  readonly #useful = new Map<ArtiGame, Record<string, AttrWeight>>()

  /**
   * @param opts 选项
   */
  constructor(opts: ArtiMetaOptions) {
    this.#metaDir = opts.metaDir
    this.#logger = opts.logger
  }

  /**
   * 丢掉已装载的缓存
   *
   * 元数据更新后调用，不重读就表现为「新角色装好了、评分仍按旧权重算」。
   */
  reload(): void {
    this.#meta.clear()
    this.#useful.clear()
  }

  /**
   * 该游戏 `artifact/` 下一个文件的绝对路径
   * @param game 游戏
   * @param name 文件名
   * @returns 路径
   */
  #path(game: ArtiGame, name: string): string {
    return join(this.#metaDir, `meta-${game}`, setDirOf(game), name)
  }

  /**
   * 取一个游戏的词条元数据
   * @param game 游戏
   * @returns 元数据；文件缺失或解不开时各项为空
   */
  meta(game: ArtiGame): ArtiMeta {
    const cached = this.#meta.get(game)
    if (cached) return cached
    const file = ARTI_META_FILE[game]
    const src = readText(this.#path(game, file))
    let got = EMPTY
    if (src !== undefined) {
      try {
        got = parseArtiMeta(src, game)
      } catch (err) {
        this.#logger?.warn(`[米游社][元数据] meta-${game} 的 ${file} 解析失败，评分暂不可用：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    this.#meta.set(game, got)
    return got
  }

  /**
   * 取默认评分权重表（`artis-mark.js` 的 `usefulAttr`）
   * @param game 游戏
   * @returns 角色名 → 权重表；文件不在或解不出内容时空表
   */
  usefulAttr(game: ArtiGame): Record<string, AttrWeight> {
    const cached = this.#useful.get(game)
    if (cached) return cached
    const src = readText(this.#path(game, "artis-mark.js"))
    const got = (src === undefined ? undefined : parseDataExport<Record<string, AttrWeight>>(src, "usefulAttr")) ?? {}
    this.#useful.set(game, got)
    return got
  }

  /**
   * 取一个角色的默认评分权重
   * @param game 游戏
   * @param name 角色名
   * @returns 权重表；未收录时 undefined
   */
  weightOf(game: ArtiGame, name: string): AttrWeight | undefined {
    return this.usefulAttr(game)[name]
  }

  /**
   * 按 id 查一条副词条
   *
   * 米游社面板接口的副词条只给 id，故必须查表。接口给的百分比是小数形态（`0.0777` 而非 `7.77`），
   * 表里存原样，换算由调用方按 `format` 处理。
   * @param game 游戏
   * @param id 词条 id
   * @returns 键与数值；查不到时 undefined
   */
  subById(game: ArtiGame, id: string | number): { key: string; value: number } | undefined {
    return this.meta(game).attrIdMap?.[String(id)]
  }

  /**
   * 按 id 查主词条的键
   * @param game 游戏
   * @param id 词条 id
   * @returns 键；查不到时 undefined
   */
  mainById(game: ArtiGame, id: string | number): string | undefined {
    return this.meta(game).mainIdMap?.[String(id)]
  }

  /**
   * 按展示名查键，如 `暴击率` → `cpct`
   *
   * 部分数据源只给中文名不给键，故留这条路。
   * @param game 游戏
   * @param title 展示名
   * @returns 键；查不到时 undefined
   */
  keyByTitle(game: ArtiGame, title: string): string | undefined {
    return this.meta(game).attrNameMap?.[title.trim()]
  }

  /**
   * 元数据是否可用
   * @param game 游戏
   * @returns 有词条条目时为真
   */
  ready(game: ArtiGame): boolean {
    return Object.keys(this.meta(game).attrMap).length > 0
  }
}

/** 元素伤害加成的键，评分时它们与 `dmg` 同权 */
export const ELEM_KEYS: readonly string[] = [
  "anemo",
  "geo",
  "electro",
  "dendro",
  "hydro",
  "pyro",
  "cryo",
  "phy",
  "imaginary",
  "quantum",
  "wind",
  "ice",
  "thunder",
  "fire",
  "physical"
]

/**
 * 判断一个键是不是元素伤害加成
 * @param key 词条键
 * @returns 是元素伤害时为真
 */
export function isElemKey(key: string): boolean {
  return ELEM_KEYS.includes(key)
}
