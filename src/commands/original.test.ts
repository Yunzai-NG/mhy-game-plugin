/**
 * 模块职责：原图索引与 `#原图` 的测试
 * 依赖方向：测试文件，依赖 store/original 与 commands/original，KV 是内存的，图片文件写在临时目录
 * 生命周期：每个用例一套新 KV 与一个新临时目录
 * 注意事项：固定四件"不报错但功能等于没有"的事：**平台不回消息 id 时索引不写**（空键会让所有出图
 *          消息互相覆盖，随后谁要原图都拿到别人那张）、两个槽位互不干扰、文件已经不在时照实说、
 *          没有引用时给出可操作的下一步。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { MhyConfigView } from "../config.js"
import type { Session } from "../core/session.js"
import { OriginalImgStore } from "../store/original.js"
import type { MhyDeps } from "./deps.js"
import { originalPathOf, originalPic, rememberOriginal } from "./original.js"

/** 不出声的日志器 */
const LOGGER = {
  debug: (): void => undefined,
  info: (): void => undefined,
  mark: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  trace: (): void => undefined,
  fatal: (): void => undefined
} as unknown as MhyDeps["logger"]

/** 假会话，记录回复与发出去的图 */
interface Spy extends Session {
  /** 收到的全部文字回复 */
  readonly said: string[]
  /** 发出去的图片路径 */
  readonly sent: string[]
}

/**
 * 造一个假会话
 * @param init 要覆盖的字段
 * @returns 假会话
 */
function makeSession(init: { quotedId?: string; lastSent?: string; fileOk?: boolean } = {}): Spy {
  const said: string[] = []
  const sent: string[] = []
  return {
    user: "qq:1",
    name: "旅行者",
    rest: "",
    game: "gs",
    isPrivate: true,
    isMaster: false,
    isGroupAdmin: false,
    botId: "bot-1",
    ...(init.quotedId === undefined ? {} : { quotedId: init.quotedId }),
    lastSent: (): string => init.lastSent ?? "msg-1",
    images: [],
    said,
    sent,
    text: async (content: string): Promise<void> => void said.push(content),
    image: async (): Promise<boolean> => false,
    ask: async (): Promise<undefined> => undefined,
    file: async (): Promise<undefined> => undefined,
    askFile: async (): Promise<undefined> => undefined,
    sendFile: async (): Promise<boolean> => false,
    imageBytes: async (): Promise<boolean> => false,
    imageFile: async (path: string): Promise<boolean> => {
      sent.push(path)
      return init.fileOk ?? true
    },
    forward: async (): Promise<boolean> => false
  }
}

let dir = ""
let store: OriginalImgStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "original-"))
  store = new OriginalImgStore({ kv: new Kv(new MemoryKvDriver()).sub("original"), logger: LOGGER })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 造一份依赖包
 * @param over 要覆盖的项
 * @returns 依赖包
 */
function makeDeps(over: Partial<MhyDeps> & { allow?: boolean } = {}): MhyDeps {
  const { allow, ...rest } = over
  return {
    originals: store,
    config: (): MhyConfigView => ({ allowOriginalPic: allow ?? true }) as unknown as MhyConfigView,
    logger: LOGGER,
    ...rest
  } as unknown as MhyDeps
}

/**
 * 写一张假图片
 * @param name 文件名
 * @returns 绝对路径
 */
function makeImg(name: string): string {
  const path = join(dir, name)
  writeFileSync(path, "png-bytes", "utf8")
  return path
}

describe("OriginalImgStore", () => {
  it("记下再取回来", async () => {
    await store.remember("msg-1", "pic", { kind: "profile", path: "/a/b.webp" })

    expect(await store.get("msg-1", "pic")).toEqual({ kind: "profile", path: "/a/b.webp" })
  })

  it("消息 id 为空时什么都不写 —— 否则这类消息会互相覆盖", async () => {
    // 平台不返回消息 id 时那是常态。写一条键为空串的记录，随后谁发 #原图 都拿到别人那张图
    await store.remember("", "pic", { kind: "profile", path: "/a/b.webp" })

    expect(await store.get("", "pic")).toBeUndefined()
  })

  it("路径为空时同样不写", async () => {
    await store.remember("msg-1", "pic", { kind: "profile", path: "" })

    expect(await store.get("msg-1", "pic")).toBeUndefined()
  })

  it("没记过的消息取到 undefined，而不是一条空记录", async () => {
    expect(await store.get("msg-9", "pic")).toBeUndefined()
  })
})

describe("originalPathOf", () => {
  it("上传的图走面板图目录，元数据的图走元数据目录", () => {
    const deps = makeDeps({
      panelImgs: { pathOf: (rel: string): string => `/panel/${rel}` },
      meta: { loader: { pathOf: (rel: string): string => `/meta/${rel}` } }
    } as unknown as Partial<MhyDeps>)

    expect(originalPathOf(deps, "normal-character/胡桃/1.webp", true)).toBe("/panel/normal-character/胡桃/1.webp")
    expect(originalPathOf(deps, "meta-gs/character/胡桃/imgs/splash.webp", false)).toBe(
      "/meta/meta-gs/character/胡桃/imgs/splash.webp"
    )
  })

  it("相对路径为空、或根不可用时给 undefined", () => {
    expect(originalPathOf(makeDeps(), "", true)).toBeUndefined()
    // 没造面板图管理器时拼不出来，此时索引不该被写进一条 "undefined/xxx"
    expect(originalPathOf(makeDeps(), "a.webp", true)).toBeUndefined()
  })
})

describe("#原图", () => {
  it("回复一张记过的图就把原图发出去", async () => {
    const path = makeImg("splash.webp")
    await store.remember("msg-7", "pic", { kind: "profile", path })
    const s = makeSession({ quotedId: "msg-7" })

    await originalPic(s, makeDeps())

    expect(s.sent).toEqual([path])
    expect(s.said).toEqual([])
  })

  it("没有引用时给出可操作的下一步", async () => {
    const s = makeSession()

    await originalPic(s, makeDeps())

    expect(s.said.join("")).toContain("回复")
    expect(s.sent).toEqual([])
  })

  it("索引里没有时说的是「太久了」，那比「没有这张图」准确", async () => {
    const s = makeSession({ quotedId: "msg-7" })

    await originalPic(s, makeDeps())

    expect(s.said.join("")).toContain("三小时")
  })

  it("文件已经不在时照实说 —— 元数据更新会换掉旧文件", async () => {
    await store.remember("msg-7", "pic", { kind: "profile", path: join(dir, "没有这个文件.webp") })
    const s = makeSession({ quotedId: "msg-7" })

    await originalPic(s, makeDeps())

    expect(s.said.join("")).toContain("已经不在")
    expect(s.sent).toEqual([])
  })

  it("开关关掉时明说是被主人关了", async () => {
    const path = makeImg("splash.webp")
    await store.remember("msg-7", "pic", { kind: "profile", path })
    const s = makeSession({ quotedId: "msg-7" })

    await originalPic(s, makeDeps({ allow: false }))

    expect(s.said.join("")).toContain("主人关掉")
    expect(s.sent).toEqual([])
  })

  it("平台拒收时补一句，而不是让人以为发出去了", async () => {
    const path = makeImg("splash.webp")
    await store.remember("msg-7", "pic", { kind: "profile", path })
    const s = makeSession({ quotedId: "msg-7", fileOk: false })

    await originalPic(s, makeDeps())

    expect(s.said.join("")).toContain("发送失败")
  })

  it("提示语按来源说「角色卡片原图」还是「面板原图」", async () => {
    const path = makeImg("splash.webp")
    await store.remember("msg-7", "pic", { kind: "character", path })
    let tip = ""
    const s = makeSession({ quotedId: "msg-7" })
    const spy = { ...s, imageFile: async (_p: string, t?: string): Promise<boolean> => ((tip = t ?? ""), true) }

    await originalPic(spy as Session, makeDeps())

    expect(tip).toBe("角色卡片原图")
  })
})

describe("rememberOriginal", () => {
  it("没造索引时静默跳过 —— 出图本身不该因为它失败", async () => {
    const s = makeSession()

    await rememberOriginal(s, makeDeps({ originals: undefined }), { kind: "profile", path: "/a/b.webp" })

    expect(s.said).toEqual([])
  })

  it("平台不回消息 id 时不写索引", async () => {
    const s = makeSession({ lastSent: "" })

    await rememberOriginal(s, makeDeps(), { kind: "profile", path: "/a/b.webp" })

    expect(await store.get("", "pic")).toBeUndefined()
  })

  it("记的就是 lastSent 那条消息", async () => {
    const s = makeSession({ lastSent: "msg-42" })

    await rememberOriginal(s, makeDeps(), { kind: "profile", path: "/a/b.webp" })

    expect((await store.get("msg-42", "pic"))?.kind).toBe("profile")
  })
})
