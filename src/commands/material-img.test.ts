/**
 * 模块职责：`#刻晴素材` 的测试
 * 依赖方向：测试文件，依赖 commands/material-img、真实的 MetaLoader 与 MaterialImgService
 *          （夹具写在临时目录里，HTTP 是假的）
 * 生命周期：每个用例一套新临时目录与新 KV
 * 注意事项：固定三处：**认不出名字时静默**（后缀 `素材` / `突破` / `培养` 很常见）、名字认出来了
 *          就出声、主角直接回一句"暂无"（米游社的素材合集里没有主角）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import type { HttpClient } from "@yunzai-ng/types"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Session } from "../core/session.js"
import { MetaLoader } from "../meta/loader.js"
import type { MetaLoaderOptions } from "../meta/loader.js"
import { MaterialImgService } from "../service/material-img.js"
import type { MhyDeps } from "./deps.js"
import { charMaterialImg } from "./material-img.js"

/** 不出声的日志器 */
const LOGGER = {
  debug: (): void => undefined,
  info: (): void => undefined,
  mark: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  trace: (): void => undefined,
  fatal: (): void => undefined,
  child: (): typeof LOGGER => LOGGER
} as unknown as MetaLoaderOptions["logger"]

let dir = ""
let urls: string[] = []

/**
 * 写一个条目目录
 * @param path 目录绝对路径
 * @param data data.json 的内容
 */
function item(path: string, data: Record<string, unknown>): void {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, "data.json"), JSON.stringify(data), "utf8")
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mhy-material-img-cmd-"))
  urls = []
  item(join(dir, "meta-gs", "character", "刻晴"), {
    id: 10000042,
    name: "刻晴",
    abbr: "刻晴",
    star: 5,
    elem: "electro",
    weapon: "sword"
  })
  item(join(dir, "meta-gs", "character", "旅行者", "anemo"), {
    id: 10000005,
    name: "旅行者",
    abbr: "空",
    star: 5,
    elem: "anemo",
    weapon: "sword"
  })
  item(join(dir, "meta-gs", "weapon", "polearm", "护摩之杖"), { id: 13501, name: "护摩之杖", star: 5 })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 假会话，记录回复与发出去的图 */
interface Spy extends Session {
  /** 收到的全部文字回复 */
  readonly said: string[]
  /** 发出去的图片路径 */
  readonly shown: string[]
}

/**
 * 造一个假会话
 * @param rest 命令之后的内容
 * @param game 游戏
 * @returns 假会话
 */
function makeSession(rest: string, game: Session["game"] = "gs"): Spy {
  const said: string[] = []
  const shown: string[] = []
  return {
    user: "qq:1",
    name: "旅行者",
    rest,
    game,
    isPrivate: true,
    isMaster: false,
    isGroupAdmin: false,
    botId: "bot-1",
    lastSent: (): string => "msg-1",
    images: [],
    said,
    shown,
    text: async (content: string): Promise<void> => void said.push(content),
    image: async (): Promise<boolean> => false,
    ask: async (): Promise<undefined> => undefined,
    file: async (): Promise<undefined> => undefined,
    askFile: async (): Promise<undefined> => undefined,
    sendFile: async (): Promise<boolean> => false,
    imageBytes: async (): Promise<boolean> => false,
    imageFile: async (path: string): Promise<boolean> => {
      shown.push(path)
      return true
    },
    forward: async (): Promise<boolean> => false
  }
}

/**
 * 造一份依赖包
 * @param bodies 合集 id → 响应体；传 Error 则抛出
 * @param opts 选项
 * @returns 依赖包
 */
function makeDeps(
  bodies: Record<number, unknown> = {},
  opts: { withMeta?: boolean; withServ?: boolean } = {}
): MhyDeps {
  const http = {
    get: async <T,>(url: string): Promise<T> => {
      urls.push(url)
      const id = Number(/collection_id=(\d+)/.exec(url)?.[1] ?? 0)
      const one = bodies[id]
      if (one instanceof Error) throw one
      return (one ?? { retcode: 0, data: { posts: [] } }) as T
    },
    buffer: async (url: string): Promise<Uint8Array> => {
      urls.push(url)
      return new Uint8Array([1, 2, 3])
    }
  } as unknown as HttpClient

  const serv = new MaterialImgService({
    dir: join(dir, "cache"),
    http,
    kv: new Kv(new MemoryKvDriver()),
    logger: LOGGER as never
  })
  const loader = new MetaLoader({ dir, logger: LOGGER })
  return {
    logger: LOGGER,
    config: () => ({}) as ReturnType<MhyDeps["config"]>,
    ...((opts.withMeta ?? true) ? { meta: { loader, installer: {} as never } } : {}),
    ...((opts.withServ ?? true) ? { materialImgs: serv } : {})
  } as unknown as MhyDeps
}

/**
 * 造一份第一个合集命中的响应
 * @param subject 帖子标题
 * @returns 响应体
 */
function hit(subject: string): unknown {
  return {
    retcode: 0,
    data: {
      posts: [
        {
          post: { subject },
          image_list: [{ url: "https://img.example/0.jpg" }, { url: "https://img.example/1.jpg" }]
        }
      ]
    }
  }
}

describe("charMaterialImg", () => {
  it("命中时把图发出去，不留任何文字", async () => {
    const s = makeSession("刻晴")
    await charMaterialImg(s, makeDeps({ 428421: hit("刻晴培养") }))

    expect(s.shown).toEqual([join(dir, "cache", "gs", "友人A", "刻晴.jpg")])
    expect(s.said).toEqual([])
  })

  it("认不出名字时一句话都不说，也不打接口", async () => {
    const s = makeSession("并不存在的名字")
    await charMaterialImg(s, makeDeps({ 428421: hit("刻晴培养") }))

    expect(s.said).toEqual([])
    expect(s.shown).toEqual([])
    expect(urls).toEqual([])
  })

  it("主角直接回一句 —— 合集里根本没有主角", async () => {
    const s = makeSession("旅行者")
    await charMaterialImg(s, makeDeps({ 428421: hit("旅行者培养") }))

    expect(s.said).toEqual(["暂无主角素材"])
    expect(urls).toEqual([])
  })

  it("查到的是武器时不接手", async () => {
    const s = makeSession("护摩之杖")
    await charMaterialImg(s, makeDeps({ 428421: hit("护摩之杖") }))

    expect(s.said).toEqual([])
    expect(urls).toEqual([])
  })

  it("名字认出来了但三个合集都没有时出声，并指到图鉴那一条", async () => {
    const s = makeSession("刻晴")
    await charMaterialImg(s, makeDeps())

    expect(s.said[0]).toContain("暂无 刻晴 的素材图")
    expect(s.said[0]).toContain("#刻晴材料")
  })

  it("接口全都失败时另一句话 —— 与「合集里没有」分得开", async () => {
    const s = makeSession("刻晴")
    await charMaterialImg(
      s,
      makeDeps({ 428421: new Error("boom"), 1164644: new Error("boom"), 1362644: new Error("boom") })
    )

    expect(s.said).toEqual(["暂无素材数据，请稍后再试"])
  })

  it("名字里带「更新」时剥掉它并重下", async () => {
    const deps = makeDeps({ 428421: hit("刻晴培养") })
    await charMaterialImg(makeSession("刻晴"), deps)
    urls = []
    const s = makeSession("刻晴更新")
    await charMaterialImg(s, deps)

    expect(s.shown).toHaveLength(1)
    expect(urls.length).toBeGreaterThan(0)
  })

  it("「更新」写在前面也认", async () => {
    const s = makeSession("更新刻晴")
    await charMaterialImg(s, makeDeps({ 428421: hit("刻晴培养") }))

    expect(s.shown).toHaveLength(1)
  })

  it("没装元数据时静默", async () => {
    const s = makeSession("刻晴")
    await charMaterialImg(s, makeDeps({ 428421: hit("刻晴培养") }, { withMeta: false }))

    expect(s.said).toEqual([])
  })

  it("绝区零没有素材合集，整条命令不生效", async () => {
    const s = makeSession("刻晴", "zzz")
    await charMaterialImg(s, makeDeps({ 428421: hit("刻晴培养") }))

    expect(s.said).toEqual([])
    expect(urls).toEqual([])
  })

  it("名字为空时静默", async () => {
    const s = makeSession("")
    await charMaterialImg(s, makeDeps({ 428421: hit("刻晴培养") }))

    expect(s.said).toEqual([])
  })
})
