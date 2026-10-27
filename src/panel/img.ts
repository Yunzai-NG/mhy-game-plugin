/**
 * 模块职责：面板图 —— 使用者上传的角色立绘的存取与挑选
 * 依赖方向：只碰磁盘（`dataDir` 下的面板图目录）与 `HttpClient`（下载上传的图）
 * 生命周期：随插件 setup 造一个实例
 * 注意事项：面板图存 `dataDir` 而非 `resources` —— 后者属插件自身、更新会覆盖，存错地方会把群友攒的图一次冲掉；
 *          模板因而用另一路径变量 `_panel_path`。「超级面板图」判据：满命 / 评分到 ACE·MAX / 天赋全满，满足其一先从
 *          `super-character/` 挑、挑不到回落 `normal-character/`。随机挑一张（刻意，随机源可注入）；上传文件名用时间戳（原名可能重复/带分隔符/编码不一）。
 */
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { HttpClient, Logger } from "@yunzai-ng/types"
import type { PanelGame } from "./profile/index.js"

/** 认得的图片后缀，上传时按响应类型另行判定 */
const IMG_EXT = /\.(png|jpe?g|webp|gif)$/i

/** 单张图的大小上限，固定为 5MB */
const MAX_BYTES = 5 * 1024 * 1024

/** 判「超级面板图」要看的那套行迹：星铁这十六个行迹点全亮才算练满 */
const SR_FULL_TREES = [
  "101",
  "102",
  "103",
  "201",
  "202",
  "203",
  "204",
  "205",
  "206",
  "207",
  "208",
  "209",
  "210",
  "301",
  "302",
  "501"
] as const

/** 评分到这两档算练满 */
const SUPER_MARK = new Set(["ACE", "MAX"])

/** 造面板图管理器需要的东西 */
export interface PanelImgOptions {
  /** 面板图根目录，取 `join(ctx.dataDir, "panel-img")` */
  dir: string
  /** HTTP 客户端，下载上传的图 */
  http?: HttpClient
  /** 日志器 */
  logger: Logger
  /** 随机源，测试里可固定 */
  random?: () => number
}

/** 判是否该用超级面板图的输入 */
export interface SuperInput {
  /** 游戏 */
  game: PanelGame
  /** 命座 / 星魂 */
  cons: number
  /** 圣遗物评分档位 */
  markClass?: string
  /** 天赋等级，不含命座加成 */
  talent: Readonly<Record<string, number>>
  /** 已激活的行迹 id，星铁用 */
  trees?: readonly string[]
}

/**
 * 判一个角色是否够"练满"，够则优先用超级面板图
 *
 * @param input 输入
 * @returns 够练满时为真
 */
export function isSuperPanel(input: SuperInput): boolean {
  if (input.cons === 6) return true
  if (input.markClass && SUPER_MARK.has(input.markClass)) return true

  // 天赋等级拼成一串再比
  const talent = Object.values(input.talent).join("")
  if (input.game === "gs") return talent === "101010"
  // 绝区零只按上面两条判：它六栏技能满级不是定值（影画会把特殊技/连携技推到 12 级以上），拼串比字面值无从成立
  if (input.game === "zzz") return false

  // 星铁另要求那十六个行迹点全亮
  const trees = input.trees ?? []
  const allTrees = SR_FULL_TREES.every(want => trees.some(one => String(one).includes(want)))
  return talent === "6101010" && allTrees
}

/**
 * 面板图目录名 —— 把「同一个角色的多个元数据目录」折成一个
 *
 * 星铁同一角色换命途各占一个元数据目录（`三月七` 与 `三月七·巡猎`），面板图是逐张上传的，不折则一边传的图另一边用不到。
 * **开拓者不受配置约束、一律折叠**（`穹·毁灭` → `穹`）；三月七只两个命途，故留一道开关。
 * **上传、列表、删除与出图必须都过这一道** —— 只在出图时折会让图传进出图时不看的目录，表现是「传成功却不出现」。
 * @param name 元数据里的角色名
 * @param shared 三月七一族要不要共用目录
 * @returns 面板图目录名
 */
export function splashDirName(name: string, shared: boolean): string {
  const main = /^([穹星])·/.exec(name)?.[1]
  if (main) return main
  if (shared && name.startsWith("三月七")) return "三月七"
  return name
}

/**
 * 面板图管理器
 *
 * 目录形态：`normal-character/<角色名>/` 与 `super-character/<角色名>/`。
 */
export class PanelImgStore {
  readonly #opts: PanelImgOptions

  /**
   * @param opts 选项
   */
  constructor(opts: PanelImgOptions) {
    this.#opts = opts
  }

  /**
   * 取一个角色的面板图目录
   * @param name 角色名
   * @param kind 普通图或超级图
   * @returns 绝对路径
   */
  #dirOf(name: string, kind: "normal" | "super" = "normal"): string {
    return join(this.#opts.dir, `${kind}-character`, name)
  }

  /**
   * 列出一个角色已有的面板图
   * @param name 角色名
   * @param kind 普通图或超级图
   * @returns 文件名，按名称排序（即上传时间序，文件名是时间戳）
   */
  list(name: string, kind: "normal" | "super" = "normal"): string[] {
    const dir = this.#dirOf(name, kind)
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir)
        .filter(one => IMG_EXT.test(one))
        .sort()
    } catch (err) {
      this.#opts.logger.debug(`[米游社][面板图] 列目录失败：${dir} ${String(err)}`)
      return []
    }
  }

  /**
   * 挑一张面板图
   *
   * 练满的角色先看超级图、挑不到再看普通图；两者都没有时返回 undefined，由调用方回落到元数据立绘。
   * @param name 角色名
   * @param superFirst 为真时先看超级图
   * @returns 相对面板图根目录的路径；一张都没有时 undefined
   */
  pick(name: string, superFirst = false): string | undefined {
    const kinds: ("normal" | "super")[] = superFirst ? ["super", "normal"] : ["normal"]
    for (const kind of kinds) {
      const files = this.list(name, kind)
      if (files.length === 0) continue
      const rand = this.#opts.random ?? Math.random
      const at = Math.min(files.length - 1, Math.floor(rand() * files.length))
      // 路径分隔符固定用 `/`：这是给浏览器的地址，不是磁盘路径
      return `${kind}-character/${name}/${files[at]}`
    }
    return undefined
  }

  /**
   * 存一张上传的图
   *
   * 文件名取时间戳 —— 原名可能重复、带分隔符或是一串编码不一致的中文。
   * @param input 输入
   * @returns 存下来的文件名；失败时 undefined
   */
  async save(input: {
    /** 角色名 */
    name: string
    /** 图片地址 */
    url: string
    /** 普通图或超级图 */
    kind?: "normal" | "super"
  }): Promise<string | undefined> {
    const http = this.#opts.http
    if (!http) {
      this.#opts.logger.warn("[米游社][面板图] 没有 HTTP 客户端，无法下载上传的图")
      return undefined
    }

    let bytes: Uint8Array
    try {
      bytes = await http.buffer(input.url, { timeout: "30s" })
    } catch (err) {
      this.#opts.logger.debug(`[米游社][面板图] 下载失败：${String(err)}`)
      return undefined
    }
    if (bytes.byteLength > MAX_BYTES) {
      this.#opts.logger.debug(`[米游社][面板图] 图太大：${bytes.byteLength} 字节`)
      return undefined
    }

    const dir = this.#dirOf(input.name, input.kind ?? "normal")
    try {
      mkdirSync(dir, { recursive: true })
      // 后缀按内容嗅探：上传来的地址常常不带后缀，而浏览器认的是内容
      const file = `${Date.now()}.${sniffExt(bytes)}`
      writeFileSync(join(dir, file), bytes)
      return file
    } catch (err) {
      this.#opts.logger.warn(`[米游社][面板图] 写盘失败：${dir} ${String(err)}`)
      return undefined
    }
  }

  /**
   * 删一张面板图
   * @param name 角色名
   * @param idx 序号，1 起（与 {@link list} 的次序一致）
   * @param kind 普通图或超级图
   * @returns 删掉的文件名；序号越界时 undefined
   */
  del(name: string, idx: number, kind: "normal" | "super" = "normal"): string | undefined {
    const files = this.list(name, kind)
    const file = files[idx - 1]
    if (!file) return undefined
    try {
      unlinkSync(join(this.#dirOf(name, kind), file))
      return file
    } catch (err) {
      this.#opts.logger.debug(`[米游社][面板图] 删除失败：${file} ${String(err)}`)
      return undefined
    }
  }

  /**
   * 一张面板图的绝对路径
   *
   * 供命令层把图片发出去。
   * @param rel 相对面板图根目录的路径
   * @returns 绝对路径
   */
  pathOf(rel: string): string {
    return join(this.#opts.dir, rel)
  }
}

/**
 * 按内容嗅探图片后缀
 *
 * 上传地址常不带后缀，浏览器按内容判类型。只认四种常见格式，认不出按 png（最宽容）。
 * @param bytes 图片字节
 * @returns 后缀，不带点
 */
export function sniffExt(bytes: Uint8Array): string {
  // GIF：`GIF8`
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif"
  // JPEG：`FF D8 FF`
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg"
  // WebP：`RIFF....WEBP`
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp"
  }
  return "png"
}
