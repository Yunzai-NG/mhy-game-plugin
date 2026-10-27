/**
 * 模块职责：攻略三条命令的测试
 * 依赖方向：测试文件，依赖 commands/strategy、真实的 MetaLoader 与 StrategyService
 *          （夹具写在临时目录里，HTTP 是假的）
 * 生命周期：每个用例一套新临时目录与新 KV
 * 注意事项：固定四处：**`#XX攻略` 认不出名字时一句话都不说**（别的插件的 `#XX攻略` 都会落进来）、
 *          开关关着时同样静默、没有作者的条目要跳过，以及 **`#攻略帮助` 与 `#设置攻略` 反过来
 *          必须出声** —— 它们是明确的触发词，静默会让人以为命令没生效。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import type { HttpClient } from "@yunzai-ng/types"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ForwardPart, Session } from "../core/session.js"
import { MetaLoader } from "../meta/loader.js"
import type { MetaLoaderOptions } from "../meta/loader.js"
import { StrategyService } from "../service/strategy.js"
import type { MhyDeps } from "./deps.js"
import { charStrategy, setStrategy, strategyHelp } from "./strategy.js"

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
  dir = mkdtempSync(join(tmpdir(), "mhy-strategy-cmd-"))
  urls = []
  item(join(dir, "meta-gs", "character", "胡桃"), {
    id: 10000046,
    name: "胡桃",
    abbr: "胡桃",
    star: 5,
    elem: "pyro",
    weapon: "polearm"
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
  item(join(dir, "meta-sr", "character", "姬子"), {
    id: 1003,
    name: "姬子",
    abbr: "姬子",
    star: 5,
    elem: "火",
    weapon: "智识"
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 假会话，记录回复与合并转发 */
interface Spy extends Session {
  /** 收到的全部文字回复 */
  readonly said: string[]
  /** 请求过的合并转发 */
  readonly sent: { nodes: readonly (readonly ForwardPart[])[]; title?: string }[]
}

/**
 * 造一个假会话
 * @param rest 命令之后的内容
 * @param game 游戏
 * @param isMaster 是否主人
 * @returns 假会话
 */
function makeSession(rest: string, game: Session["game"] = "gs", isMaster = true): Spy {
  const said: string[] = []
  const sent: { nodes: readonly (readonly ForwardPart[])[]; title?: string }[] = []
  return {
    user: "qq:1",
    name: "旅行者",
    rest,
    game,
    isPrivate: true,
    isMaster,
    isGroupAdmin: false,
    botId: "bot-1",
    lastSent: (): string => "msg-1",
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
    imageFile: async (): Promise<boolean> => true,
    forward: async (nodes, title): Promise<boolean> => {
      sent.push(title === undefined ? { nodes } : { nodes, title })
      return true
    }
  }
}

/** 一份原神索引 —— 关蝎那条是新攻略、猫冬那条较早、第三条没有作者 */
const GS_INDEX = JSON.stringify({
  strategy: [
    { author: "猫冬", article: "47935576", url: "https://img.example/a.png" },
    { author: "关蝎", article: "69017936", url: "https://img.example/b.png" },
    { article: "58871146", url: "https://img.example/nobody.png" }
  ]
})

/** 一份 author.json */
const GS_AUTHORS = JSON.stringify({ material: [], strategy: ["猫冬", "关蝎", "Asgater"] })

/**
 * 造一份依赖包
 * @param texts 路径片段 → 要返回的文本；命中第一个包含关系即返回
 * @param opts 选项
 * @returns 依赖包与攻略服务
 */
function makeDeps(
  texts: Record<string, string> = {},
  opts: { enabled?: boolean; withMeta?: boolean; withServ?: boolean } = {}
): { deps: MhyDeps; serv: StrategyService } {
  const http = {
    get: async <T,>(url: string): Promise<T> => {
      urls.push(url)
      for (const [key, value] of Object.entries(texts)) {
        if (url.includes(key)) return value as T
      }
      throw new Error("404")
    },
    buffer: async (url: string): Promise<Uint8Array> => {
      urls.push(url)
      return new Uint8Array([1, 2, 3])
    }
  } as unknown as HttpClient

  const serv = new StrategyService({
    dir: join(dir, "cache"),
    http,
    kv: new Kv(new MemoryKvDriver()),
    logger: LOGGER as never,
    enabled: () => opts.enabled ?? true
  })
  const loader = new MetaLoader({ dir, logger: LOGGER })
  const deps = {
    logger: LOGGER,
    config: () => ({}) as ReturnType<MhyDeps["config"]>,
    ...((opts.withMeta ?? true) ? { meta: { loader, installer: {} as never } } : {}),
    ...((opts.withServ ?? true) ? { strategy: serv } : {})
  } as unknown as MhyDeps
  return { deps, serv }
}

describe("charStrategy", () => {
  it("认出角色时把每条攻略折成一个转发节点", async () => {
    const s = makeSession("胡桃")
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }).deps)

    expect(s.sent).toHaveLength(1)
    expect(s.sent[0]?.title).toBe("胡桃攻略，共2张")
    expect(s.said).toEqual([])
  })

  it("没有作者的条目跳过 —— 出图要署名", async () => {
    const s = makeSession("胡桃")
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }).deps)

    const authors = (s.sent[0]?.nodes ?? []).flatMap(one =>
      one.flatMap(part => ("text" in part && part.text.startsWith("版主：") ? [part.text] : []))
    )
    expect(authors).toEqual([
      "版主：关蝎\nhttps://www.miyoushe.com/ys/article/69017936",
      "版主：猫冬\nhttps://www.miyoushe.com/ys/article/47935576"
    ])
  })

  it("发布较早的那条带上提醒，新的不带", async () => {
    const s = makeSession("胡桃")
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }).deps)

    const texts = (s.sent[0]?.nodes ?? []).map(one => one.map(part => ("text" in part ? part.text : "[图]")))
    expect(texts[0]?.[0]).toBe("[图]")
    expect(texts[1]?.[0]).toContain("发布时间较早")
  })

  it("每条节点都是「[提醒]图片说明」这个次序", async () => {
    const s = makeSession("胡桃")
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }).deps)

    const first = s.sent[0]?.nodes[0] ?? []
    expect(first).toHaveLength(2)
    expect(first[0]).toHaveProperty("image")
    expect(first[1]).toHaveProperty("text")
  })

  it("星铁按命途取索引", async () => {
    const s = makeSession("姬子", "sr")
    await charStrategy(s, makeDeps({ [encodeURIComponent("智识")]: GS_INDEX }).deps)

    expect(s.sent).toHaveLength(1)
    expect(urls[0]).toContain(`/sr/raw/sr/${encodeURIComponent("智识")}/${encodeURIComponent("姬子")}.json`)
  })

  it("主角取「旅行者」那一份，缓存目录带上元素", async () => {
    const s = makeSession("旅行者")
    await charStrategy(s, makeDeps({ [encodeURIComponent("风")]: GS_INDEX }).deps)

    expect(urls[0]).toContain(encodeURIComponent("旅行者"))
    expect(s.sent[0]?.title).toBe("旅行者攻略，共2张")
  })
})

describe("charStrategy 的静默分支", () => {
  it("认不出名字时一句话都不说，也不发请求 —— 别的插件的 #XX攻略 都会落进来", async () => {
    const s = makeSession("并不存在的名字")
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }).deps)

    expect(s.said).toEqual([])
    expect(s.sent).toEqual([])
    expect(urls).toEqual([])
  })

  it("开关关着时同样静默", async () => {
    const s = makeSession("胡桃")
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }, { enabled: false }).deps)

    expect(s.said).toEqual([])
    expect(urls).toEqual([])
  })

  it("没装元数据时静默 —— 那时连「这是不是角色名」都判不出来", async () => {
    const s = makeSession("胡桃")
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }, { withMeta: false }).deps)

    expect(s.said).toEqual([])
  })

  it("绝区零没有攻略索引，整条命令不生效", async () => {
    const s = makeSession("胡桃", "zzz")
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }).deps)

    expect(s.said).toEqual([])
    expect(s.sent).toEqual([])
  })

  it("查到的是武器时不接手 —— 武器没有攻略", async () => {
    const s = makeSession("护摩之杖")
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }).deps)

    expect(s.sent).toEqual([])
    expect(urls).toEqual([])
  })

  it("索引取不到时静默", async () => {
    const s = makeSession("胡桃")
    await charStrategy(s, makeDeps({}).deps)

    expect(s.said).toEqual([])
    expect(s.sent).toEqual([])
  })

  it("名字为空时静默", async () => {
    const s = makeSession("")
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }).deps)

    expect(s.said).toEqual([])
  })

  it("设了攻略组时只留选中的那些；一条都不剩就静默", async () => {
    const { deps, serv } = makeDeps({ "%E7%81%AB": GS_INDEX })
    await serv.pick("gs", ["Asgater"])
    const s = makeSession("胡桃")
    await charStrategy(s, deps)

    expect(s.sent).toEqual([])
    expect(s.said).toEqual([])
  })

  it("选中其中一个时只出那一条", async () => {
    const { deps, serv } = makeDeps({ "%E7%81%AB": GS_INDEX })
    await serv.pick("gs", ["猫冬"])
    const s = makeSession("胡桃")
    await charStrategy(s, deps)

    expect(s.sent[0]?.nodes).toHaveLength(1)
    expect(s.sent[0]?.title).toBe("胡桃攻略，共1张")
  })
})

describe("charStrategy 的「更新」", () => {
  it("「胡桃更新攻略」与「更新胡桃」都认出胡桃，并绕过索引缓存重取", async () => {
    const { deps } = makeDeps({ "%E7%81%AB": GS_INDEX })
    await charStrategy(makeSession("胡桃"), deps)
    const first = urls.filter(one => one.endsWith(".json")).length

    const a = makeSession("胡桃更新")
    await charStrategy(a, deps)
    const b = makeSession("更新胡桃")
    await charStrategy(b, deps)

    expect(a.sent[0]?.title).toBe("胡桃攻略，共2张")
    expect(b.sent[0]?.title).toBe("胡桃攻略，共2张")
    expect(urls.filter(one => one.endsWith(".json")).length).toBe(first + 2)
  })

  it("已缓存的图也重下", async () => {
    const { deps } = makeDeps({ "%E7%81%AB": GS_INDEX })
    await charStrategy(makeSession("胡桃"), deps)
    const before = urls.filter(one => one.startsWith("https://img.example/")).length
    await charStrategy(makeSession("胡桃"), deps)
    expect(urls.filter(one => one.startsWith("https://img.example/")).length).toBe(before)

    await charStrategy(makeSession("胡桃更新"), deps)
    expect(urls.filter(one => one.startsWith("https://img.example/")).length).toBe(before + 2)
  })

  it("重取失败时仍用缓存里那份索引，不拿空壳冲掉", async () => {
    const texts: Record<string, string> = { "%E7%81%AB": GS_INDEX }
    const { deps } = makeDeps(texts)
    await charStrategy(makeSession("胡桃"), deps)
    delete texts["%E7%81%AB"]

    const s = makeSession("胡桃更新")
    await charStrategy(s, deps)
    expect(s.sent[0]?.title).toBe("胡桃攻略，共2张")

    const again = makeSession("胡桃")
    await charStrategy(again, deps)
    expect(again.sent[0]?.title).toBe("胡桃攻略，共2张")
  })

  it("取不到时说一句 —— 这是明确的请求", async () => {
    const s = makeSession("胡桃更新")
    await charStrategy(s, makeDeps({}).deps)

    expect(s.sent).toEqual([])
    expect(s.said[0]).toContain("没有取到胡桃的攻略")
  })

  it("仅限主人；不是主人时不发请求，指回普通的查法", async () => {
    const s = makeSession("胡桃更新", "gs", false)
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }).deps)

    expect(s.said[0]).toContain("#胡桃攻略")
    expect(urls).toEqual([])
  })

  it("认不出名字时照旧静默", async () => {
    const s = makeSession("更新")
    await charStrategy(s, makeDeps({ "%E7%81%AB": GS_INDEX }).deps)

    expect(s.said).toEqual([])
    expect(urls).toEqual([])
  })
})

describe("strategyHelp", () => {
  it("列出全部攻略组与当前选中的那些", async () => {
    const s = makeSession("")
    await strategyHelp(s, makeDeps({ "author.json": GS_AUTHORS }).deps)

    expect(s.said[0]).toContain("当前攻略组：全部")
    expect(s.said[0]).toContain("1——猫冬")
    expect(s.said[0]).toContain("3——Asgater")
  })

  it("设过之后显示选中的那些", async () => {
    const { deps, serv } = makeDeps({ "author.json": GS_AUTHORS })
    await serv.pick("gs", ["猫冬", "关蝎"])
    const s = makeSession("")
    await strategyHelp(s, deps)

    expect(s.said[0]).toContain("当前攻略组：猫冬,关蝎")
  })

  it("开关关着时说清是开关的事，并指到设置面板", async () => {
    const s = makeSession("")
    await strategyHelp(s, makeDeps({ "author.json": GS_AUTHORS }, { enabled: false }).deps)

    expect(s.said[0]).toContain("设置面板")
  })

  it("取不到列表时出声 —— 这是明确的触发词，静默会让人以为命令没生效", async () => {
    const s = makeSession("")
    await strategyHelp(s, makeDeps({}).deps)

    expect(s.said[0]).toContain("取不到")
  })

  it("绝区零直说没有", async () => {
    const s = makeSession("", "zzz")
    await strategyHelp(s, makeDeps({ "author.json": GS_AUTHORS }).deps)

    expect(s.said[0]).toContain("绝区零")
  })
})

describe("setStrategy", () => {
  it("按序号选，回一句当前选中的", async () => {
    const { deps, serv } = makeDeps({ "author.json": GS_AUTHORS })
    const s = makeSession("1,3")
    await setStrategy(s, deps)

    expect(s.said[0]).toBe("设置成功\n当前攻略组：猫冬,Asgater")
    expect(await serv.picked("gs")).toEqual(["猫冬", "Asgater"])
  })

  it("全角逗号也认", async () => {
    const { deps, serv } = makeDeps({ "author.json": GS_AUTHORS })
    await setStrategy(makeSession("1，2"), deps)

    expect(await serv.picked("gs")).toEqual(["猫冬", "关蝎"])
  })

  it("重复的序号只算一次", async () => {
    const { deps, serv } = makeDeps({ "author.json": GS_AUTHORS })
    await setStrategy(makeSession("2,2"), deps)

    expect(await serv.picked("gs")).toEqual(["关蝎"])
  })

  it("「全部」即清掉白名单", async () => {
    const { deps, serv } = makeDeps({ "author.json": GS_AUTHORS })
    await serv.pick("gs", ["猫冬"])
    const s = makeSession("全部")
    await setStrategy(s, deps)

    expect(s.said[0]).toContain("全部")
    expect(await serv.picked("gs")).toEqual([])
  })

  it("有一个不是整数就整条拒绝，不做部分采纳", async () => {
    const { deps, serv } = makeDeps({ "author.json": GS_AUTHORS })
    const s = makeSession("1,abc")
    await setStrategy(s, deps)

    expect(s.said[0]).toBe("请输入正确的序号")
    expect(await serv.picked("gs")).toEqual([])
  })

  it("序号全都越界时也拒绝", async () => {
    const s = makeSession("9")
    await setStrategy(s, makeDeps({ "author.json": GS_AUTHORS }).deps)

    expect(s.said[0]).toBe("请输入正确的序号")
  })

  it("不带序号时退回帮助", async () => {
    const s = makeSession("")
    await setStrategy(s, makeDeps({ "author.json": GS_AUTHORS }).deps)

    expect(s.said[0]).toContain("当前攻略组")
  })

  it("写「开启」「关闭」时指到设置面板 —— 这个开关在本仓库是面板项，不由命令改", async () => {
    const s = makeSession("开启")
    await setStrategy(s, makeDeps({ "author.json": GS_AUTHORS }).deps)

    expect(s.said[0]).toContain("设置面板")
  })

  it("取不到攻略组列表时不写入任何白名单", async () => {
    const { deps, serv } = makeDeps({})
    const s = makeSession("1")
    await setStrategy(s, deps)

    expect(s.said[0]).toContain("取不到")
    expect(await serv.picked("gs")).toEqual([])
  })
})
