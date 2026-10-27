/**
 * 模块职责：角色别名 —— 把使用者打的「椰羊」「饮月君」「77」译回元数据里的角色名
 * 依赖方向：只读**已安装的元数据**里的 `meta-{game}/character/alias.json`；不发请求、不碰内核
 * 生命周期：首次查询时按游戏读一次并常驻内存；元数据更新后由 {@link AliasTable.reload} 丢弃
 * 注意事项：这份表随元数据更新、不随插件发版（随插件提交则新角色上线后要等发版才能用社区叫法查它）。
 *          `alias.json` 不在时就地解析 `alias.js`——手工放进数据目录的包没经过安装流程、没有预解析结果，
 *          缺了它别名与简称一并失效（简称正是面板列表印的名字）。放行 `alias.js` 落盘是安全的：**只解析
 *          从不执行**，解析器只认 `export const 名 = { 键: "字符串" }`、遇别的整体失败。查表先转小写再 trim。
 *          跨游戏回落次序不可改（请求的游戏优先、再试另一个），去掉它会让不加 `*` 的一批使用者突然查不到。
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { buildAliasIndex, parseAliasFile } from "./alias-parse.js"
import { constBlock, parseStringMap, stripComments } from "./js-lit.js"
import type { GameKey } from "../core/region.js"

/** 有别名表的游戏，即全部游戏 */
export type AliasGame = GameKey

/** 一个游戏的别名表文件形态 */
export interface AliasFile {
  /** 别名（已转小写）→ 角色名 */
  alias: Record<string, string>
  /** 角色名 → 简称，星铁独有 */
  abbr?: Record<string, string>
}

/** 造别名表需要的东西 */
export interface AliasTableOptions {
  /** 已安装的元数据根目录，与 {@link MetaInstaller} 的 `dir` 一致 */
  dir: string
}

/**
 * 查找次序：请求的那个优先，然后试另一个
 *
 * **绝区零不参与跨游戏回落**：其代理人名与另两个游戏角色名无重合，互试只会让笔误查到别的游戏去。
 */
const FALLBACK: Readonly<Record<AliasGame, readonly AliasGame[]>> = {
  gs: ["gs", "sr"],
  sr: ["sr", "gs"],
  zzz: ["zzz"]
}

/** 表文件缺失时的空表 */
const EMPTY: AliasFile = { alias: {} }

/**
 * 读一个 JSON 文件
 * @param path 文件路径
 * @returns 解析结果；读不到或解不开时 undefined
 */
function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return undefined
  }
}

/**
 * 就地把包里的 `alias.js` 解析成索引
 *
 * 只在 `alias.json` 不在时走这一支。**解析失败按"没有别名"处理**：抛错会让每一条按名字查的命令一并失败。
 * @param path `alias.js` 的路径
 * @returns 别名与简称；文件不在或形态不认时 undefined
 */
function parseSource(path: string): AliasFile | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = parseAliasFile(readFileSync(path, "utf8"))
    if (!parsed) return undefined
    const index = buildAliasIndex(parsed)
    return { alias: index.alias, ...(index.abbr ? { abbr: index.abbr } : {}) }
  } catch {
    return undefined
  }
}

/**
 * 就地把武器 / 音擎的 `weapon/alias.js` 里的 `abbr` 导出解析成"名 → 简称"
 *
 * **不可拿角色那张 `abbr` 表给武器定简称**：两张键不重合，一个都查不中、三个游戏的武器恒回落成全名。安装流程不为武器生成 `.json`，
 * 故直接解析 `.js`（解析而非求值）。gs 那份只导出 `abbr` 无 `alias`，故单取 `abbr` 块、不走 {@link parseAliasFile}。
 * @param dir `meta-{game}/weapon` 目录
 * @returns 名 → 简称；文件不在或形态不认时空表
 */
function readWeaponAbbr(dir: string): Record<string, string> {
  // 安装流程若日后也为武器生成 .json，优先读它；眼下没有，落到 .js
  if (existsSync(join(dir, "alias.json"))) {
    try {
      const got = JSON.parse(readFileSync(join(dir, "alias.json"), "utf8")) as { abbr?: Record<string, string> }
      if (got?.abbr) return got.abbr
    } catch {
      // 落到 .js
    }
  }
  const jsPath = join(dir, "alias.js")
  if (!existsSync(jsPath)) return {}
  try {
    const body = constBlock(stripComments(readFileSync(jsPath, "utf8")), "abbr")
    if (body === undefined) return {}
    return parseStringMap(body, "weapon abbr")
  } catch {
    return {}
  }
}

/**
 * 别名表
 *
 * 一个实例管三个游戏，按游戏懒加载。表文件缺失时各项查询返回 undefined 而不抛错。
 */
export class AliasTable {
  readonly #dir: string
  readonly #cache = new Map<AliasGame, AliasFile>()
  /**
   * 武器 / 音擎的简称表缓存，键为游戏，值为"名 → 简称"
   *
   * 与角色那张缓存分开：读的是 `weapon/alias.js` 而非 `character/`、且键不重合。
   */
  readonly #weapon = new Map<AliasGame, Record<string, string>>()

  /**
   * @param opts 选项
   */
  constructor(opts: AliasTableOptions) {
    this.#dir = opts.dir
  }

  /**
   * 丢掉已装载的缓存，元数据更新后调用
   *
   * 与 {@link MetaLoader.reload} 一同调用：不重读就表现为「新角色装好了却查不到它的别名」。
   */
  reload(): void {
    this.#cache.clear()
    this.#weapon.clear()
  }

  /**
   * 取一个游戏的别名表
   * @param game 游戏
   * @returns 别名表；两份文件都没有时空表
   */
  #load(game: AliasGame): AliasFile {
    const cached = this.#cache.get(game)
    if (cached) return cached
    const dir = join(this.#dir, `meta-${game}`, "character")
    const got = readJson<AliasFile>(join(dir, "alias.json")) ?? parseSource(join(dir, "alias.js")) ?? EMPTY
    // 缺 alias 键的损坏文件按空表处理，免得下游每次都判一遍
    const out: AliasFile = { alias: got.alias ?? {}, ...(got.abbr ? { abbr: got.abbr } : {}) }
    this.#cache.set(game, out)
    return out
  }

  /**
   * 把一个别名译成角色名，只在本游戏的表里查
   * @param game 游戏
   * @param text 使用者输入
   * @returns 角色名；查不到时 undefined
   */
  nameIn(game: AliasGame, text: string): string | undefined {
    const key = text.trim().toLowerCase()
    if (!key) return undefined
    return this.#load(game).alias[key]
  }

  /**
   * 把一个别名译成角色名，本游戏查不到时试另一个
   *
   * 次序是请求的游戏优先。返回时一并带上命中的游戏。
   * @param game 游戏
   * @param text 使用者输入
   * @returns 角色名与命中的游戏；两个游戏都查不到时 undefined
   */
  resolve(game: AliasGame, text: string): { name: string; game: AliasGame } | undefined {
    for (const one of FALLBACK[game]) {
      const name = this.nameIn(one, text)
      if (name) return { name, game: one }
    }
    return undefined
  }

  /**
   * 取一个角色的简称
   *
   * 只有星铁的表带这一项（`丹恒•饮月`、`托帕&账账` 这种窄格子排不开）。原神的简称在 `data.json` 的 `abbr`，
   * 由 {@link MetaLoader} 给出。
   * @param game 游戏
   * @param name 角色名
   * @returns 简称；没有时 undefined
   */
  abbr(game: AliasGame, name: string): string | undefined {
    return this.#load(game).abbr?.[name.trim()]
  }

  /**
   * 取一个武器 / 音擎的简称
   *
   * 读 `meta-{game}/weapon/alias.js` 的 `abbr` 导出。**与角色的 {@link AliasTable.abbr} 分成两张表**：
   * 武器名与角色名不重合，查角色那张一个都命中不了，见 {@link readWeaponAbbr}。
   * @param game 游戏
   * @param name 武器 / 音擎名
   * @returns 简称；没有时 undefined
   */
  weaponAbbr(game: AliasGame, name: string): string | undefined {
    const cached = this.#weapon.get(game)
    const table = cached ?? readWeaponAbbr(join(this.#dir, `meta-${game}`, "weapon"))
    if (!cached) this.#weapon.set(game, table)
    return table[name.trim()]
  }

  /**
   * 别名表是否可用
   * @param game 游戏
   * @returns 有条目时为真
   */
  ready(game: AliasGame): boolean {
    return Object.keys(this.#load(game).alias).length > 0
  }
}
