/**
 * 模块职责：`#刻晴素材` 的取图 —— 从米游社公开合集里取现成的一图流素材
 * 依赖方向：依赖 `ctx.http` / `ctx.kv` 与磁盘（数据目录下的素材图缓存）；不碰 Cookie、不碰元数据
 * 生命周期：随插件 setup 造一个实例
 * 注意事项：这不是「养成材料一览」—— 那一条是 `#胡桃材料`（图鉴那一族，按元数据自己出图）。
 *          这一条取的是米游社合集里现成的一张攻略图，两者只是名字像。
 *
 *          接口是米游社的公开合集接口，不带 Cookie、不需要 DS，故不进 core/api.ts 那张表
 *          （那张表的前提是"有 CK 才能查"）。
 *
 *          每个合集的取图口径都不一样（见 {@link GS_COLLECTIONS}）：这些下标是各攻略组排版的
 *          结果、没有规律，改了不报错，只是发出去的那张不是素材图。
 *
 *          `gids=2` 连星铁也照传：星铁的板块 id 本是 6，但两个游戏都传 2 实测可用
 *          （合集由 `collection_id` 定）。
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { HttpClient, KvNamespace, Logger } from "@yunzai-ng/types"
import { safeSegment } from "../core/text.js"
import type { MetaGame } from "../meta/download.js"

/**
 * 有素材合集的两个游戏
 *
 * 绝区零的元数据包里没有素材那一族。基准取 `MetaGame` 而非 `GameKey`：素材图取自元数据包，
 * "包里有没有素材那一族"正是决定这一族边界的那件事。
 */
export type MaterialImgGame = Exclude<MetaGame, "zzz">

/** 米游社合集接口 */
const COLLECTION_URL = "https://bbs-api.mihoyo.com/post/wapi/getPostFullInCollection"

/** 出图时给图片地址加的 oss 参数：压到 1000 宽的 jpg */
const OSS = "?x-oss-process=image//resize,s_1000/quality,q_80/auto-orient,0/interlace,1/format,jpg"

/** 单次请求的等待上限 */
const TIMEOUT = "20s"

/** 单张素材图的大小上限；oss 已压到 1000 宽，十兆足以挡住异常响应 */
const MAX_BYTES = 10 * 1024 * 1024

/** 查不到时记一笔的时长 —— 新角色进合集要几天，一小时后再试一次足够 */
const MISS_TTL = "1h"

/**
 * 原神第一个合集里另取一张的那八个角色
 *
 * 这八个的帖子多一页（多半是双形态或双配装），故素材图在第三张而非第二张。
 */
const GS_SPECIAL: readonly string[] = [
  "雷电将军",
  "珊瑚宫心海",
  "菲谢尔",
  "托马",
  "八重神子",
  "九条裟罗",
  "辛焱",
  "神里绫华"
]

/** 一个合集的取图口径 */
export interface CollectionSpec {
  /** 合集 id */
  id: number
  /** 缓存子目录 —— 取该合集的攻略组名，`other` 是合并存放的那一档 */
  dir: string
  /** 从帖子的哪一栏取图：`image_list` 是带 url 的对象数组，`images` 是裸地址数组 */
  from: "image_list" | "images"
  /** 取第几张 */
  at: number
  /** 这些角色另取一张 */
  special?: readonly string[]
  /** {@link special} 命中时取第几张 */
  specialAt?: number
}

/** 原神的三个合集，顺序即尝试顺序 */
export const GS_COLLECTIONS: readonly CollectionSpec[] = [
  { id: 428421, dir: "友人A", from: "image_list", at: 1, special: GS_SPECIAL, specialAt: 2 },
  { id: 1164644, dir: "other", from: "image_list", at: 0 },
  { id: 1362644, dir: "other", from: "image_list", at: 2 }
]

/** 星铁的三个合集，顺序即尝试顺序 */
export const SR_COLLECTIONS: readonly CollectionSpec[] = [
  { id: 1998643, dir: "小橙子啊", from: "images", at: 2 },
  { id: 2146693, dir: "other", from: "images", at: 0 },
  { id: 2279356, dir: "other", from: "image_list", at: 0 }
]

/** 合集里的一个帖子 */
export interface CollectionPost {
  /** 帖子本体 */
  post?: {
    /** 标题，按它匹配角色名 */
    subject?: string
    /** 裸图片地址数组 */
    images?: string[]
  }
  /** 带 url 的图片数组 */
  image_list?: { url?: string }[]
}

/** 合集接口的响应 */
export interface CollectionBody {
  /** 0 为成功 */
  retcode?: number
  /** 失败说明 */
  message?: string
  /** 数据 */
  data?: {
    /** 帖子列表 */
    posts?: CollectionPost[]
  }
}

/** 一次取图的结果 */
export interface MaterialImgResult {
  /** 图片的绝对路径 */
  path?: string
  /** 三个合集都请求失败（区别于"合集里没这个角色"） */
  failed?: boolean
}

/** 两个游戏的合集表 */
export const COLLECTIONS: Readonly<Record<MaterialImgGame, readonly CollectionSpec[]>> = {
  gs: GS_COLLECTIONS,
  sr: SR_COLLECTIONS
}

/** 造素材图服务需要的东西 */
export interface MaterialImgOptions {
  /** 缓存目录，取 `join(ctx.dataDir, "material-img")` */
  dir: string
  /** HTTP 客户端 */
  http: HttpClient
  /** KV 命名空间，建议传 `ctx.kv.sub("materialImg")` */
  kv: KvNamespace
  /** 日志器 */
  logger: Logger
}

/**
 * 从一个帖子里取图片地址
 * @param post 帖子
 * @param spec 合集口径
 * @param name 角色名，判是否属于 {@link CollectionSpec.special}
 * @returns 图片地址；那一栏没有第 at 张时为空串
 */
export function pickPostImage(post: CollectionPost, spec: CollectionSpec, name: string): string {
  const at = spec.special?.includes(name) && spec.specialAt !== undefined ? spec.specialAt : spec.at
  if (spec.from === "images") return String(post.post?.images?.[at] ?? "")
  return String(post.image_list?.[at]?.url ?? "")
}

/**
 * 在一个合集里找一个角色的素材图
 *
 * 判据是"帖子标题里含这个角色名"。
 * @param posts 帖子列表
 * @param spec 合集口径
 * @param name 角色名
 * @returns 图片地址；没有匹配的帖子或那张图不存在时为空串
 */
export function findCollectionImage(
  posts: readonly CollectionPost[],
  spec: CollectionSpec,
  name: string
): string {
  for (const one of posts) {
    if (!String(one.post?.subject ?? "").includes(name)) continue
    // 第一个标题命中的帖子就是答案：同一个合集里一个角色只有一篇
    return pickPostImage(one, spec, name)
  }
  return ""
}

/**
 * 素材图服务
 */
export class MaterialImgService {
  readonly #dir: string
  readonly #http: HttpClient
  readonly #kv: KvNamespace
  readonly #logger: Logger

  /**
   * @param opts 选项
   */
  constructor(opts: MaterialImgOptions) {
    this.#dir = opts.dir
    this.#http = opts.http
    this.#kv = opts.kv
    this.#logger = opts.logger
  }

  /**
   * 一张素材图的缓存路径
   * @param game 游戏
   * @param dir 合集的缓存子目录
   * @param name 角色名
   * @returns 绝对路径
   */
  #pathOf(game: MaterialImgGame, dir: string, name: string): string {
    return join(this.#dir, game, dir, `${safeSegment(name)}.jpg`)
  }

  /**
   * 请求一个合集
   * @param spec 合集口径
   * @returns 帖子列表；请求失败或接口报错时 undefined
   */
  async #posts(spec: CollectionSpec): Promise<CollectionPost[] | undefined> {
    try {
      const body = await this.#http.get<CollectionBody>(
        `${COLLECTION_URL}?&gids=2&order_type=2&collection_id=${spec.id}`,
        { timeout: TIMEOUT }
      )
      if (!body || body.retcode !== 0) {
        this.#logger.warn(`[米游社][素材图] 合集 ${spec.id} 接口报错：${body?.message ?? "未知错误"}`)
        return undefined
      }
      return body.data?.posts ?? []
    } catch (err) {
      this.#logger.warn(
        `[米游社][素材图] 合集 ${spec.id} 请求失败：${err instanceof Error ? err.message : String(err)}`
      )
      return undefined
    }
  }

  /**
   * 下载一张图
   *
   * 先写临时文件再改名，理由同 service/strategy.ts：中途失败留下的截断文件会一直命中缓存。
   * @param url 图片地址，不含 oss 参数
   * @param file 目标绝对路径
   * @returns 成功时为真
   */
  async #download(url: string, file: string): Promise<boolean> {
    try {
      const bytes = await this.#http.buffer(`${url}${OSS}`, { timeout: TIMEOUT })
      if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) {
        this.#logger.debug(`[米游社][素材图] 大小异常（${bytes.byteLength} 字节），跳过`)
        return false
      }
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp-${Date.now()}`
      writeFileSync(tmp, bytes)
      renameSync(tmp, file)
      return true
    } catch (err) {
      this.#logger.debug(`[米游社][素材图] 下载失败：${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  /**
   * 取一个角色的素材图
   *
   * 三个合集依次试：先看缓存，没有就请求。查不到时记一笔一小时的空缓存 —— 不记的话，
   * 还没进合集的新角色每次查询都要打三次接口。
   * @param game 游戏
   * @param name 角色全名
   * @param force 为真时忽略磁盘缓存重下（`#刻晴素材更新`）
   * @returns 图片路径，或"三个合集都请求失败"
   */
  async image(game: MaterialImgGame, name: string, force = false): Promise<MaterialImgResult> {
    if (!name) return {}
    const missKey = `miss:${game}:${name}`
    if (!force && (await this.#kv.get<boolean>(missKey))) return {}

    let failed = false
    for (const spec of COLLECTIONS[game]) {
      const file = this.#pathOf(game, spec.dir, name)
      if (!force && existsSync(file)) return { path: file }

      const posts = await this.#posts(spec)
      if (!posts) {
        failed = true
        continue
      }
      const url = findCollectionImage(posts, spec, name)
      if (!url) continue
      if (await this.#download(url, file)) return { path: file }
    }

    // 接口本身失败时不记空缓存：那是一时的网络问题，不是"这个角色没有素材图"
    if (!failed) await this.#kv.set<boolean>(missKey, true, { ttl: MISS_TTL })
    return failed ? { failed: true } : {}
  }
}
