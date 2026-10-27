/**
 * 模块职责：玩家头像库 —— 逐 uid 记住头像与账号信息，页头一律读这一份
 * 依赖方向：依赖 ctx.http / ctx.kv 与 node:fs；被命令层与 views/who 组装页头时使用
 * 生命周期：随插件 setup 造一个；pfps 索引在内存里缓存一份
 * 注意事项：**文件按头像自身标识命名**（米游社取直链哈希、展柜取头像 id），按 uid 命名则同一张头像
 *          存成多份、缓存失去意义。两张头像按更新时间取较新，一张都没有时由调用方垫默认图；
 *          **不拿元数据角色头像顶替**，那不是玩家设的头像。
 */
import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { HttpClient, KvNamespace, Logger } from "@yunzai-ng/types"
import type { GameKey } from "../core/region.js"
import { safeSegment } from "../core/text.js"

/** 下载一张头像的超时：Enka 图床冷连接慢，短了会让首次取图恒失败 */
const TIMEOUT = 30 * 1000

/** 取 pfps 索引的超时 */
const INDEX_TIMEOUT = 15 * 1000

/** pfps 索引的落盘缓存有效期 */
const PFPS_TTL = 7 * 24 * 3600 * 1000

/** 索引里查不到某个 id 时，这段时间内只重新取一次远端：不限的话每个未知 id 都是一次外部请求 */
const MISS_TTL = 10 * 60 * 1000

/** `pfpsHost` 为空时的索引地址。走 jsDelivr 而非 raw.githubusercontent.com：后者常不可达，取不到索引即无头像 */
const PFPS_FALLBACK: Readonly<Record<GameKey, string>> = {
  gs: "https://cdn.jsdelivr.net/gh/EnkaNetwork/API-docs@master/store/gi/pfps.json",
  sr: "https://cdn.jsdelivr.net/gh/EnkaNetwork/API-docs@master/store/hsr/pfps.json",
  zzz: "https://cdn.jsdelivr.net/gh/EnkaNetwork/API-docs@master/store/zzz/pfps.json"
}

/** Enka 的图片根 —— 索引里给的是站内绝对路径段，拼上它才是可下载地址 */
const ENKA_HOST = "https://enka.network"

/**
 * 头像的来源
 *
 * 只分两类：星铁 Mihomo 给的 `headIcon` 本就是 pfps 索引里那个键，与 Enka 同一条路，故归 `enka`。
 */
export type FaceSource = "mys" | "enka"

/** 一个 uid 的固定信息，页头所需的全部内容 */
export interface FaceInfo {
  /** 游戏内昵称 */
  name?: string
  /** 冒险等阶 / 开拓等级 / 代理人等级 */
  level?: number
  /** 世界等级，仅原神 */
  world?: number
  /** 米游社那张头像的本地路径，相对头像库根 */
  mysIcon?: string
  /** 米游社那张的更新时间 */
  mysAt?: number
  /** 展柜那张头像的本地路径，相对头像库根 */
  enkaIcon?: string
  /** 展柜那张的更新时间 */
  enkaAt?: number
}

/** 造头像库需要的东西 */
export interface FaceStoreOptions {
  /** 头像库根目录，取自 `join(ctx.dataDir, "face")` */
  dir: string
  /** HTTP 客户端 */
  http: HttpClient
  /** kv，逐 uid 记一条 {@link FaceInfo} */
  kv: KvNamespace
  /** 日志器 */
  logger: Logger
  /**
   * 读配置：pfps 索引的自建前缀
   *
   * 传函数故配置改完即生效。空串时用 {@link PFPS_FALLBACK}；非空时按
   * `<前缀>/<gs|sr|zzz>/pfps.json` 拼。
   */
  host: () => string
  /**
   * 读配置：头像图的下载根
   *
   * 空串时走 {@link ENKA_HOST}（那边路径就是 `/ui/…`）；非空时按自建镜像的形态拼
   * `<前缀>/<gs|sr|zzz>/assets/ui/…`。传函数故配置改完即生效。
   */
  assetHost: () => string
}

/** 玩家头像库 */
export class FaceStore {
  readonly #dir: string
  readonly #http: HttpClient
  readonly #kv: KvNamespace
  readonly #logger: Logger
  readonly #host: () => string
  readonly #assetHost: () => string
  /** 内存里的 pfps 索引，一个游戏一份 */
  readonly #index = new Map<GameKey, Record<string, string>>()

  /**
   * @param opts 选项
   */
  constructor(opts: FaceStoreOptions) {
    this.#dir = opts.dir
    this.#http = opts.http
    this.#kv = opts.kv
    this.#logger = opts.logger
    this.#host = opts.host
    this.#assetHost = opts.assetHost
  }

  /**
   * 一张头像图的可下载地址
   *
   * Enka 官方是 `/ui/…`，自建镜像是 `/<游戏>/assets/ui/…`；拼错则每张图都 404。
   * @param game 游戏
   * @param icon 索引里给的站内路径段
   * @returns 完整地址
   */
  #assetUrl(game: GameKey, icon: string): string {
    const path = icon.startsWith("/") ? icon : `/${icon}`
    const host = this.#assetHost().replace(/\/+$/, "")
    return host ? `${host}/${game}/assets${path}` : `${ENKA_HOST}${path}`
  }

  /**
   * kv 里那条记录的键
   * @param game 游戏
   * @param uid uid
   * @returns 键
   */
  #key(game: GameKey, uid: string): string {
    return `${game}:${uid}`
  }

  /**
   * 取一个 uid 的固定信息；页头唯一的取数口，不发请求
   * @param game 游戏
   * @param uid uid
   * @returns 固定信息；没存过时一份空的
   */
  async info(game: GameKey, uid: string): Promise<FaceInfo> {
    if (!uid) return {}
    return (await this.#kv.get<FaceInfo>(this.#key(game, uid))) ?? {}
  }

  /**
   * 取一个 uid 当前该用的那张头像
   *
   * 两源都有时取较新：按源固定优先会让刚换完头像的人看到旧的那张。
   * @param game 游戏
   * @param uid uid
   * @returns 相对头像库根的路径；没有时 undefined
   */
  async pick(game: GameKey, uid: string): Promise<string | undefined> {
    const got = await this.info(game, uid)
    const mys = this.#alive(got.mysIcon)
    const enka = this.#alive(got.enkaIcon)
    if (mys && enka) return (got.enkaAt ?? 0) > (got.mysAt ?? 0) ? enka : mys
    return mys ?? enka
  }

  /**
   * 文件不在盘上时当作没有：头像库是缓存目录，清掉之后 kv 里那条仍在
   * @param rel 记下来的相对路径
   * @returns 可用时原样返回，否则 undefined
   */
  #alive(rel: string | undefined): string | undefined {
    if (!rel) return undefined
    return existsSync(join(this.#dir, rel)) ? rel : undefined
  }

  /**
   * 逐字段并一条固定信息进去
   * @param game 游戏
   * @param uid uid
   * @param patch 要写的那几项
   */
  async merge(game: GameKey, uid: string, patch: FaceInfo): Promise<void> {
    if (!uid) return
    const old = await this.info(game, uid)
    await this.#kv.set(this.#key(game, uid), { ...old, ...patch })
  }

  /**
   * 下载一张头像到库里；同名文件已在则不发请求（文件名即头像标识）
   *
   * 失败重试一次：偶发超时不重试，这位使用者要等到下次更新面板才有头像。
   * @param rel 相对头像库根的路径，由调用方按头像标识算好
   * @param url 可下载地址
   * @returns 相对路径；取不到时 undefined
   */
  async #fetch(rel: string, url: string): Promise<string | undefined> {
    const path = join(this.#dir, rel)
    if (existsSync(path)) {
      this.#logger.debug(`[头像] 本地已有 ${rel}`)
      return rel
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const bytes = await this.#http.buffer(url, { timeout: TIMEOUT })
        if (bytes.length === 0) continue
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, bytes)
        this.#logger.debug(`[头像] 已存 ${rel}`)
        return rel
      } catch {
        // 失败已由外部请求日志记下（见 core/trace.ts），此处只管重试
      }
    }
    this.#logger.warn(`[头像] ${rel} 两次都没取到，本次用默认头像`)
    return undefined
  }

  /**
   * 落一张米游社的头像；文件名取直链哈希（换头像即换地址）
   * @param game 游戏
   * @param uid uid
   * @param url 接口给的完整地址
   * @returns 相对头像库根的路径；地址为空或取不到时 undefined
   */
  async saveMys(game: GameKey, uid: string, url: string | undefined): Promise<string | undefined> {
    if (!url || !/^https?:\/\//.test(url)) return undefined
    const name = createHash("sha1").update(url).digest("hex").slice(0, 16)
    const rel = `mys/${game}/${name}.png`
    const got = await this.#fetch(rel, url)
    if (got) await this.merge(game, uid, { mysIcon: got, mysAt: Date.now() })
    return got
  }

  /**
   * 落一张展柜的头像
   *
   * 原神的 id 可能是头像 id、角色 id 或时装 id，后两者由镜像并进了 pfps 索引，故只查这一张表。
   * @param game 游戏
   * @param uid uid
   * @param id 头像 id、角色 id 或时装 id
   * @returns 相对头像库根的路径；查不到或取不到时 undefined
   */
  async saveEnka(game: GameKey, uid: string, id: string | number | undefined): Promise<string | undefined> {
    if (id === undefined || id === "") return undefined
    const key = String(id)
    const rel = `enka/${game}/${safeSegment(key)}.png`
    // 文件已在就不必取表：文件名即头像标识
    if (existsSync(join(this.#dir, rel))) {
      await this.merge(game, uid, { enkaIcon: rel, enkaAt: Date.now() })
      return rel
    }

    const icon = (await this.#pfps(game, key))[key]
    if (!icon) {
      this.#logger.debug(`[头像] ${game} 的 pfps 索引里没有 ${key}，${uid} 用默认头像`)
      return undefined
    }
    const got = await this.#fetch(rel, this.#assetUrl(game, icon))
    if (got) await this.merge(game, uid, { enkaIcon: got, enkaAt: Date.now() })
    return got
  }

  /**
   * 取某个游戏的 pfps 索引：内存 → 落盘缓存 → 远端
   *
   * 查不到 `key` 时重取一次远端（{@link MISS_TTL} 内只一次）：索引会长大，只认缓存的话
   * 新头像要等缓存过期才查得到。
   * @param game 游戏
   * @param key 本次要查的 id，给了才做上面那次重新校验
   * @returns 头像 id → 站内路径段
   */
  async #pfps(game: GameKey, key?: string): Promise<Record<string, string>> {
    const got = this.#index.get(game)
    if (got && (!key || got[key])) return got ?? {}

    const cache = join(this.#dir, `pfps-${game}.json`)
    const cached = await this.#readCache(cache)
    // 表里有这个键、或刚校验过（MISS_TTL 内），就用缓存的
    if (cached && (!key || cached.table[key] || Date.now() - cached.at < MISS_TTL)) {
      this.#index.set(game, cached.table)
      return cached.table
    }

    const host = this.#host().replace(/\/+$/, "")
    const url = host ? `${host}/${game}/pfps.json` : PFPS_FALLBACK[game]
    let table: Record<string, string> = {}
    try {
      const raw = await this.#http.get<Record<string, unknown>>(url, { timeout: INDEX_TIMEOUT, retry: 1 })
      table = flatten(raw)
    } catch {
      // 失败已由外部请求日志记下
    }

    // 取不到时保留旧表：远端偶发失败不该把在用的索引清掉
    if (Object.keys(table).length === 0) {
      this.#logger.warn(`[头像] ${game} 的 pfps 索引取不到，沿用${cached || got ? "旧表" : "空表"}`)
      return cached?.table ?? got ?? {}
    }

    try {
      await mkdir(dirname(cache), { recursive: true })
      await writeFile(cache, JSON.stringify({ at: Date.now(), table }), "utf8")
    } catch {
      // 写不下缓存不影响本次使用，下次再取一遍远端
    }
    this.#index.set(game, table)
    return table
  }

  /**
   * 读 pfps 的落盘缓存
   * @param path 缓存文件路径
   * @returns 表与写入时间；过期、损坏或不存在时 undefined
   */
  async #readCache(path: string): Promise<{ at: number; table: Record<string, string> } | undefined> {
    if (!existsSync(path)) return undefined
    try {
      const got = JSON.parse(await readFile(path, "utf8")) as { at?: number; table?: Record<string, string> }
      if (!got.table || Date.now() - (got.at ?? 0) > PFPS_TTL) return undefined
      return { at: got.at ?? 0, table: got.table }
    } catch {
      return undefined
    }
  }
}

/**
 * pfps 索引 → `id → 路径段`；原神字段是 `IconPath`，星铁绝区零是 `Icon`
 * @param raw 远端给的 JSON
 * @returns 扁平表
 */
function flatten(raw: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, one] of Object.entries(raw ?? {})) {
    if (!one || typeof one !== "object") continue
    const bag = one as { IconPath?: unknown; Icon?: unknown }
    const icon = typeof bag.IconPath === "string" ? bag.IconPath : typeof bag.Icon === "string" ? bag.Icon : ""
    if (icon) out[id] = icon
  }
  return out
}
