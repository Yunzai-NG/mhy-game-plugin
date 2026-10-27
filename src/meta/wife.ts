/**
 * 模块职责：四类关系的可选角色名单 —— 读元数据里 `character/extra.js` 的 `wifeCfg`
 * 依赖方向：只读**已安装的元数据**；依赖 meta/extra-parse 的解析器。不发请求、不碰内核
 * 生命周期：首次查询时按游戏读一次并常驻内存；元数据更新后由 {@link WifeMetaTable.reload} 丢弃
 * 注意事项：这份表随元数据更新、不随插件发版（同别名表：写进插件则新角色上线后恒不在名单里，
 *          不报错、只是 `#老婆设置某新角色` 恒回「不在名单里」）。只解析不求值（见 meta/extra-parse）。
 *          绝区零的包里没有 `extra.js`，故一律返回空名单。解析失败也当作空名单而不抛错。
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { WifeKey, WifeTable as WifeNames } from "./extra-parse.js"
import { EXTRA_FILE, parseWifeFile } from "./extra-parse.js"

/** 有这份名单的游戏 */
export type WifeGame = "gs" | "sr"

/** 一份都没有时的空表，四个键都在，故下游不必判空 */
const EMPTY: WifeNames = { girlfriend: [], boyfriend: [], daughter: [], son: [] }

/** 构造参数 */
export interface WifeTableOptions {
  /** 元数据根目录，即数据目录下的 `meta/` */
  dir: string
}

/**
 * 四类关系的可选角色名单
 *
 * 一个实例管两个游戏，按游戏懒加载。文件缺失或解析失败时返回空名单而不抛错。
 */
export class WifeMetaTable {
  readonly #dir: string
  readonly #cache = new Map<WifeGame, WifeNames>()

  /**
   * @param opts 选项
   */
  constructor(opts: WifeTableOptions) {
    this.#dir = opts.dir
  }

  /**
   * 丢掉已装载的缓存，元数据更新后调用
   *
   * 与 {@link AliasTable.reload} 一同调用：不重读则表现为「元数据更新了、新角色仍不在名单里」。
   */
  reload(): void {
    this.#cache.clear()
  }

  /**
   * 读一个游戏的名单
   * @param game 游戏
   * @returns 四类名单，缺失时四个键都是空数组
   */
  #load(game: WifeGame): WifeNames {
    const cached = this.#cache.get(game)
    if (cached) return cached

    let out = EMPTY
    try {
      const src = readFileSync(join(this.#dir, `meta-${game}`, "character", EXTRA_FILE), "utf8")
      out = parseWifeFile(src) ?? EMPTY
    } catch {
      out = EMPTY
    }
    this.#cache.set(game, out)
    return out
  }

  /**
   * 取一类关系的可选角色名
   * @param game 游戏
   * @param key 关系
   * @returns 角色名；这一类为空或没装元数据时空数组
   */
  get(game: string, key: WifeKey): readonly string[] {
    if (game !== "gs" && game !== "sr") return []
    return this.#load(game)[key]
  }

  /**
   * 这个游戏有没有可用的名单
   * @param game 游戏
   * @returns 四类里至少一类非空时为真
   */
  ready(game: string): boolean {
    if (game !== "gs" && game !== "sr") return false
    const table = this.#load(game)
    return Object.values(table).some(one => one.length > 0)
  }
}
