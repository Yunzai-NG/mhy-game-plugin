/**
 * 模块职责：素材图服务的测试
 * 依赖方向：测试文件，依赖 service/material-img 与内核的内存 KV；HTTP 是假的、磁盘是真的
 * 生命周期：每个用例一份新 KV 与一个新临时目录
 * 注意事项：固定三处：每个合集的取图下标各不相同（那是各攻略组排版的结果，写错不报错，只是
 *          发出去的图不是素材图）、三个合集依次试且各有自己的缓存目录，以及**"接口失败"与
 *          "合集里没这个角色"要分得开** —— 前者不该记进空缓存，否则一次网络抖动会让这个角色
 *          一小时内都查不出来。
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import type { HttpClient, KvNamespace } from "@yunzai-ng/types"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { CollectionPost } from "./material-img.js"
import {
  COLLECTIONS,
  GS_COLLECTIONS,
  MaterialImgService,
  SR_COLLECTIONS,
  findCollectionImage,
  pickPostImage
} from "./material-img.js"

/** 一个只收不看的日志器 */
const logger = {
  debug: (): void => {},
  info: (): void => {},
  mark: (): void => {},
  warn: (): void => {},
  error: (): void => {}
} as unknown as ConstructorParameters<typeof MaterialImgService>[0]["logger"]

/** 记下来的请求地址 */
let urls: string[] = []

let kv: KvNamespace
let dir = ""

beforeEach(() => {
  urls = []
  kv = new Kv(new MemoryKvDriver())
  dir = mkdtempSync(join(tmpdir(), "mhy-material-img-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 造一个假 HTTP 客户端
 * @param bodies 合集 id → 响应体；传 Error 则抛出。缺的那些按接口报错处理
 * @returns 客户端
 */
function fakeHttp(bodies: Record<number, unknown>): HttpClient {
  return {
    get: async <T,>(url: string): Promise<T> => {
      urls.push(url)
      const id = Number(/collection_id=(\d+)/.exec(url)?.[1] ?? 0)
      const body = bodies[id]
      if (body instanceof Error) throw body
      return (body ?? { retcode: -1, message: "没有这个合集" }) as T
    },
    buffer: async (url: string): Promise<Uint8Array> => {
      urls.push(url)
      return new Uint8Array([1, 2, 3])
    }
  } as unknown as HttpClient
}

/**
 * 造一个素材图服务
 * @param bodies 各合集的假响应
 * @returns 服务
 */
function make(bodies: Record<number, unknown> = {}): MaterialImgService {
  return new MaterialImgService({ dir, http: fakeHttp(bodies), kv, logger })
}

/**
 * 造一份合集响应
 * @param posts 帖子
 * @returns 响应体
 */
function body(posts: CollectionPost[]): unknown {
  return { retcode: 0, data: { posts } }
}

/**
 * 造一个带 image_list 的帖子
 * @param subject 标题
 * @param count 图片张数
 * @returns 帖子
 */
function withList(subject: string, count = 3): CollectionPost {
  return {
    post: { subject },
    image_list: Array.from({ length: count }, (_, i) => ({ url: `https://img.example/${subject}-${i}.jpg` }))
  }
}

/**
 * 造一个带 post.images 的帖子
 * @param subject 标题
 * @param count 图片张数
 * @returns 帖子
 */
function withImages(subject: string, count = 3): CollectionPost {
  return {
    post: { subject, images: Array.from({ length: count }, (_, i) => `https://img.example/${subject}-${i}.jpg`) }
  }
}

describe("合集表", () => {
  it("两个游戏各三个合集，顺序即尝试顺序", () => {
    expect(COLLECTIONS.gs).toBe(GS_COLLECTIONS)
    expect(COLLECTIONS.sr).toBe(SR_COLLECTIONS)
    expect(GS_COLLECTIONS).toHaveLength(3)
    expect(SR_COLLECTIONS).toHaveLength(3)
  })

  it("合集 id 就是米游社上那几个合集的编号", () => {
    expect(GS_COLLECTIONS.map(one => one.id)).toEqual([428421, 1164644, 1362644])
    expect(SR_COLLECTIONS.map(one => one.id)).toEqual([1998643, 2146693, 2279356])
  })

  it("后两个合集共用 other 这一档缓存目录", () => {
    expect(GS_COLLECTIONS.map(one => one.dir)).toEqual(["友人A", "other", "other"])
    expect(SR_COLLECTIONS.map(one => one.dir)).toEqual(["小橙子啊", "other", "other"])
  })
})

describe("pickPostImage", () => {
  it("原神第一个合集取 image_list 的第二张", () => {
    expect(pickPostImage(withList("胡桃培养"), GS_COLLECTIONS[0]!, "胡桃")).toBe("https://img.example/胡桃培养-1.jpg")
  })

  it("那八个角色改取第三张 —— 他们的帖子多一页", () => {
    const got = pickPostImage(withList("雷电将军培养"), GS_COLLECTIONS[0]!, "雷电将军")

    expect(got).toBe("https://img.example/雷电将军培养-2.jpg")
  })

  it("星铁第一个合集取的是 post.images 的第三张，不是 image_list", () => {
    expect(pickPostImage(withImages("姬子"), SR_COLLECTIONS[0]!, "姬子")).toBe("https://img.example/姬子-2.jpg")
  })

  it("那一栏没有第 at 张时给空串", () => {
    expect(pickPostImage(withList("胡桃", 1), GS_COLLECTIONS[0]!, "胡桃")).toBe("")
    expect(pickPostImage({}, SR_COLLECTIONS[0]!, "姬子")).toBe("")
  })
})

describe("findCollectionImage", () => {
  it("按标题包含角色名匹配", () => {
    const posts = [withList("钟离培养"), withList("胡桃培养")]

    expect(findCollectionImage(posts, GS_COLLECTIONS[0]!, "胡桃")).toContain("胡桃培养-1")
  })

  it("第一个标题命中的帖子就是答案 —— 即便它取不到图也不再往后找", () => {
    const posts = [withList("胡桃培养", 1), withList("胡桃攻略", 3)]

    expect(findCollectionImage(posts, GS_COLLECTIONS[0]!, "胡桃")).toBe("")
  })

  it("一个都不命中时给空串", () => {
    expect(findCollectionImage([withList("钟离")], GS_COLLECTIONS[0]!, "胡桃")).toBe("")
  })
})

describe("MaterialImgService.image", () => {
  it("第一个合集就命中时落在那个攻略组的目录下", async () => {
    const got = await make({ 428421: body([withList("胡桃培养")]) }).image("gs", "胡桃")

    expect(got.path).toBe(join(dir, "gs", "友人A", "胡桃.jpg"))
    expect(existsSync(got.path as string)).toBe(true)
  })

  it("请求带上 gids=2 与合集 id，图片地址带上 oss 参数", async () => {
    await make({ 428421: body([withList("胡桃培养")]) }).image("gs", "胡桃")

    expect(urls[0]).toContain("gids=2")
    expect(urls[0]).toContain("collection_id=428421")
    expect(urls[1]).toContain("x-oss-process")
  })

  it("星铁也传 gids=2 —— 该接口不按游戏分，合集由 collection_id 定", async () => {
    await make({ 1998643: body([withImages("姬子")]) }).image("sr", "姬子")

    expect(urls[0]).toContain("gids=2")
  })

  it("第一个合集里没有就往后找，落进 other 目录", async () => {
    const got = await make({
      428421: body([withList("钟离培养")]),
      1164644: body([withList("胡桃培养")])
    }).image("gs", "胡桃")

    expect(got.path).toBe(join(dir, "gs", "other", "胡桃.jpg"))
  })

  it("第二次直接用缓存，一个请求都不发", async () => {
    const serv = make({ 428421: body([withList("胡桃培养")]) })
    await serv.image("gs", "胡桃")
    urls = []
    await serv.image("gs", "胡桃")

    expect(urls).toEqual([])
  })

  it("带 force 时忽略缓存重下", async () => {
    const serv = make({ 428421: body([withList("胡桃培养")]) })
    await serv.image("gs", "胡桃")
    urls = []
    await serv.image("gs", "胡桃", true)

    expect(urls.length).toBeGreaterThan(0)
  })

  it("三个合集都没有这个角色时记一笔空缓存，第二次不再请求", async () => {
    const bodies = { 428421: body([]), 1164644: body([]), 1362644: body([]) }
    const serv = make(bodies)

    expect(await serv.image("gs", "刻晴")).toEqual({})
    expect(urls).toHaveLength(3)
    urls = []
    expect(await serv.image("gs", "刻晴")).toEqual({})
    expect(urls).toEqual([])
  })

  it("接口失败时给 failed，且**不**记空缓存 —— 一次网络抖动不该让这个角色一小时查不出来", async () => {
    const serv = make({ 428421: new Error("boom"), 1164644: new Error("boom"), 1362644: new Error("boom") })

    expect(await serv.image("gs", "刻晴")).toEqual({ failed: true })
    urls = []
    await serv.image("gs", "刻晴")
    expect(urls).toHaveLength(3)
  })

  it("retcode 不为零也算接口失败", async () => {
    const serv = make({ 428421: { retcode: -502, message: "服务繁忙" } })

    expect((await serv.image("gs", "刻晴")).failed).toBe(true)
  })

  it("名字为空时什么都不做", async () => {
    expect(await make().image("gs", "")).toEqual({})
    expect(urls).toEqual([])
  })
})
