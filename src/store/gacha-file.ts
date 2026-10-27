/**
 * 模块职责：抽卡记录的本地存档 —— `#抽卡导出` 之外再落一份到数据目录
 * 依赖方向：只写盘；不碰 KV、不发请求、不认 UIGF 的形态（内容由调用方给）
 * 生命周期：随插件 setup 造一个实例，无状态
 * 注意事项：与发给使用者的那个文件是同一份内容，不是另一种格式 —— 发文件那一路依赖平台支持
 *          （`sendFile` 在不少适配器上发不出去），存档这一路不依赖任何平台能力。
 *
 *          层级是 `<用户>/<游戏>/<uid>.json`：**按发起导出的平台账号（qq 号一类）分目录**，各存各的 ——
 *          抽卡记录按「用户 + uid」隔离（见 store/gacha 文件头），存档随之同口径。同一用户同一 uid
 *          只有一个文件，重复导出即覆盖。
 *
 *          路径里的每一段都要过滤：用户标识与 uid 都是外部来的串，直接拼进路径意味着 `../`
 *          能写到数据目录之外。
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Logger } from "@yunzai-ng/types"
import type { GameKey } from "../core/region.js"

/**
 * 洗一段路径
 *
 * 用户标识与 uid 来自外部，直接拼进路径意味着 `..` 与分隔符都能穿出去。
 * @param text 原串
 * @returns 可安全作为一段路径的串
 */
function safe(text: string): string {
  const out = text.replace(/[^0-9A-Za-z_-]/g, "_")
  return out && !/^_*$/.test(out) ? out : "unknown"
}

/** 造抽卡存档需要的东西 */
export interface GachaFileStoreOptions {
  /** 存档根目录，取 `join(ctx.dataDir, "gacha")` */
  dir: string
  /** 日志器 */
  logger: Logger
}

/**
 * 抽卡记录的本地存档
 *
 * 一个实例管全部游戏与全部账号，路径由参数定。
 */
export class GachaFileStore {
  readonly #dir: string
  readonly #logger: Logger

  /**
   * @param opts 选项
   */
  constructor(opts: GachaFileStoreOptions) {
    this.#dir = opts.dir
    this.#logger = opts.logger
  }

  /**
   * 一份存档的绝对路径
   *
   * 旧格式（UIGF v2 / SRGF）另存一个带 `_v2` 后缀的文件而不覆盖 v4 那一份：两者内容口径不同。
   * @param id 发起导出的平台账号标识（qq 号一类）
   * @param game 游戏
   * @param uid 游戏 uid
   * @param opts 选项：`legacy` 是否旧格式
   * @returns 绝对路径
   */
  pathOf(id: string, game: GameKey, uid: string, opts: { legacy?: boolean } = {}): string {
    return join(this.#dir, safe(id), game, `${safe(uid)}${opts.legacy ? "_v2" : ""}.json`)
  }

  /**
   * 存一份
   *
   * 失败只记日志、不抛错：调用方 `#抽卡导出` 的正事是把文件发给使用者，存档是附带的一步。
   * @param id 发起导出的平台账号标识（qq 号一类）
   * @param game 游戏
   * @param uid 游戏 uid
   * @param text 文件内容，与发给使用者的那份逐字相同
   * @param opts 选项：`legacy` 是否旧格式
   * @returns 落盘成功时交回绝对路径，失败时 undefined
   */
  save(id: string, game: GameKey, uid: string, text: string, opts: { legacy?: boolean } = {}): string | undefined {
    const file = this.pathOf(id, game, uid, opts)
    try {
      mkdirSync(join(file, ".."), { recursive: true })
      writeFileSync(file, text, "utf8")
      this.#logger.debug(`[米游社][抽卡] 已存档到 ${file}`)
      return file
    } catch (err) {
      this.#logger.warn(
        `[米游社][抽卡] 存档失败（导出本身不受影响）：${err instanceof Error ? err.message : String(err)}`
      )
      return undefined
    }
  }
}
