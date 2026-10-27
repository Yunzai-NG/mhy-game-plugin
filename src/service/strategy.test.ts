/**
 * 模块职责：攻略服务的测试
 * 依赖方向：测试文件，依赖 service/strategy 与内核的内存 KV；HTTP 与磁盘一真一假
 * 生命周期：每个用例一份新 KV 与一个新临时目录
 * 注意事项：固定四处只在实际使用时才暴露的口径：排序按「档位在前、文章号在后」的字符串比较
 *          （改成按数字不报错，只是次序会变）、没有作者的条目要跳过（出图要署名）、
 *          **远端字段进文件名前必须过一遍过滤**（否则那份 JSON 能写到缓存目录之外），
 *          以及取不到也缓存（否则没有攻略的角色每次都徒然等一次超时）。
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import type { HttpClient, KvNamespace } from "@yunzai-ng/types"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { StrategyEntry } from "./strategy.js"
import {
  DEFAULT_STRATEGY_HOST,
  StrategyService,
  articleLink,
  isEarlyArticle,
  sortStrategy,
  strategyCacheDir,
  strategyDirOf,
  strategyFileName,
  strategyImgExt,
  strategyIndexName,
  strategySortKey
} from "./strategy.js"

/** 一个只收不看的日志器 */
const logger = {
  debug: (): void => {},
  info: (): void => {},
  mark: (): void => {},
  warn: (): void => {},
  error: (): void => {}
} as unknown as ConstructorParameters<typeof StrategyService>[0]["logger"]

/** 记下来的请求地址 */
let urls: string[] = []

let kv: KvNamespace
let dir = ""

beforeEach(() => {
  urls = []
  kv = new Kv(new MemoryKvDriver())
  dir = mkdtempSync(join(tmpdir(), "mhy-strategy-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 假 HTTP 客户端的行为 */
interface FakeHttp {
  /** `get` 要返回的文本；传 Error 则抛出 */
  text?: string | Error
  /** `buffer` 要返回的字节；传 Error 则抛出 */
  bytes?: Uint8Array | Error
}

/**
 * 造一个假 HTTP 客户端
 * @param one 行为
 * @returns 客户端
 */
function fakeHttp(one: FakeHttp): HttpClient {
  return {
    get: async <T,>(url: string): Promise<T> => {
      urls.push(url)
      if (one.text instanceof Error) throw one.text
      return (one.text ?? "") as T
    },
    buffer: async (url: string): Promise<Uint8Array> => {
      urls.push(url)
      if (one.bytes instanceof Error) throw one.bytes
      return one.bytes ?? new Uint8Array([1, 2, 3])
    }
  } as unknown as HttpClient
}

/**
 * 造一个攻略服务
 * @param one 假 HTTP 的行为
 * @param enabled 开关
 * @returns 服务
 */
function make(one: FakeHttp = {}, enabled = true): StrategyService {
  return new StrategyService({ dir, http: fakeHttp(one), kv, logger, enabled: () => enabled })
}

/** 一份索引文件的内容 —— 三条正好覆盖三个档位 */
const INDEX = JSON.stringify({
  strategy: [
    { author: "猫冬", article: "47935576", url: "https://img.example/a.png" },
    { author: "O丶Ha丶Yo", article: "68871146", url: "https://img.example/b.png" },
    { author: "丘秋_XT", article: "Nob8j5Vm5", articleUrl: "https://weibo.com/x", url: "https://img.example/c.jpg" }
  ]
})

describe("strategySortKey", () => {
  it("大于六千万的纯数字文章号进第三档 —— 那是较新的攻略", () => {
    expect(strategySortKey({ article: "68871146" })).toBe("3,68871146")
  })

  it("不是纯数字的进第二档 —— 站外攻略的短号无从判断时间", () => {
    expect(strategySortKey({ article: "Nob8j5Vm5" })).toBe("2,Nob8j5Vm5")
  })

  it("小于六千万的进第一档", () => {
    expect(strategySortKey({ article: "47935576" })).toBe("1,47935576")
  })

  it("没有文章号时按第二档算 —— 与「不是纯数字」同一档", () => {
    expect(strategySortKey({})).toBe("2,")
  })
})

describe("sortStrategy", () => {
  it("按「档位在前、文章号在后」的字符串降序 —— 新攻略、站外攻略、早期攻略", () => {
    const got = sortStrategy(JSON.parse(INDEX).strategy as StrategyEntry[])

    expect(got.map(one => one.article)).toEqual(["68871146", "Nob8j5Vm5", "47935576"])
  })

  it("同一档内按文章号降序", () => {
    const got = sortStrategy([{ article: "58957682" }, { article: "59125535" }, { article: "58871146" }])

    expect(got.map(one => one.article)).toEqual(["59125535", "58957682", "58871146"])
  })

  it("不改动传入的数组", () => {
    const list: StrategyEntry[] = [{ article: "1" }, { article: "99999999" }]
    sortStrategy(list)

    expect(list.map(one => one.article)).toEqual(["1", "99999999"])
  })
})

describe("isEarlyArticle", () => {
  it("小于六千万且没有站外地址时为真", () => {
    expect(isEarlyArticle({ article: "47935576" })).toBe(true)
  })

  it("有站外地址时一律为假 —— 那种短号判不出时间", () => {
    expect(isEarlyArticle({ article: "1", articleUrl: "https://weibo.com/x" })).toBe(false)
  })

  it("新文章号与非数字都为假", () => {
    expect(isEarlyArticle({ article: "68871146" })).toBe(false)
    expect(isEarlyArticle({ article: "Nob8j5Vm5" })).toBe(false)
    expect(isEarlyArticle({})).toBe(false)
  })
})

describe("articleLink", () => {
  it("有站外地址就用它", () => {
    expect(articleLink({ articleUrl: "https://weibo.com/x", article: "1" }, "gs")).toBe("https://weibo.com/x")
  })

  it("否则按游戏拼米游社地址 —— 原神是 ys、星铁是 sr", () => {
    expect(articleLink({ article: "123" }, "gs")).toBe("https://www.miyoushe.com/ys/article/123")
    expect(articleLink({ article: "123" }, "sr")).toBe("https://www.miyoushe.com/sr/article/123")
  })

  it("两者都没有时给空串，调用方据此不写出处那一行", () => {
    expect(articleLink({}, "gs")).toBe("")
  })
})

describe("文件名与目录名", () => {
  it("缓存文件名沿用 `作者_文章号[_更新标记]`", () => {
    expect(strategyFileName({ author: "猫冬", article: "47935576" })).toBe("猫冬_47935576")
    expect(strategyFileName({ author: "猫冬", article: "47935576", update: "2" })).toBe("猫冬_47935576_2")
  })

  it("远端字段里的路径字符会被换掉 —— 否则那份 JSON 能写到缓存目录之外", () => {
    const got = strategyFileName({ author: "../../etc", article: "x" })

    expect(got).not.toContain("..")
    expect(got).not.toContain("/")
    expect(got).toBe("etc_x")
  })

  it("后缀取自地址，认不出按 png", () => {
    expect(strategyImgExt("https://a/b.jpg")).toBe("jpg")
    expect(strategyImgExt("https://a/b.jpeg?x=1")).toBe("jpg")
    expect(strategyImgExt("https://a/b.webp")).toBe("webp")
    expect(strategyImgExt("https://a/b")).toBe("png")
  })

  it("原神按元素折算成中文目录，星铁直接用命途", () => {
    expect(strategyDirOf("gs", "pyro", "polearm")).toBe("火")
    expect(strategyDirOf("sr", "火", "智识")).toBe("智识")
  })

  it("原神认不出元素时给空串，调用方据此放弃 —— 拼一个空目录只会 404", () => {
    expect(strategyDirOf("gs", "", "polearm")).toBe("")
  })

  it("主角的索引文件名固定，与它在哪个元素目录下无关", () => {
    expect(strategyIndexName("荧", true, "gs")).toBe("旅行者")
    expect(strategyIndexName("穹", true, "sr")).toBe("开拓者")
    expect(strategyIndexName("胡桃", false, "gs")).toBe("胡桃")
  })

  it("主角的缓存目录带上元素 / 命途，否则各元素的攻略会互相覆盖", () => {
    expect(strategyCacheDir("旅行者", "火")).toBe("旅行者_火")
    expect(strategyCacheDir("开拓者", "同谐")).toBe("开拓者_同谐")
    expect(strategyCacheDir("胡桃", "火")).toBe("胡桃")
  })
})

describe("StrategyService.entries", () => {
  it("取回来的列表已排好序", async () => {
    const got = await make({ text: INDEX }).entries("gs", "火", "胡桃")

    expect(got.map(one => one.article)).toEqual(["68871146", "Nob8j5Vm5", "47935576"])
  })

  it("地址按「前缀/游戏/raw/游戏/目录/名字.json」拼，中文逐段编码", async () => {
    await make({ text: INDEX }).entries("gs", "火", "胡桃")

    expect(urls).toEqual([
      `${DEFAULT_STRATEGY_HOST}/gs/raw/gs/${encodeURIComponent("火")}/${encodeURIComponent("胡桃")}.json`
    ])
  })

  it("开关关着时一个包都不发", async () => {
    const got = await make({ text: INDEX }, false).entries("gs", "火", "胡桃")

    expect(got).toEqual([])
    expect(urls).toEqual([])
  })

  it("第二次读缓存，不再请求", async () => {
    const serv = make({ text: INDEX })
    await serv.entries("gs", "火", "胡桃")
    await serv.entries("gs", "火", "胡桃")

    expect(urls).toHaveLength(1)
  })

  it("取不到也缓存 —— 否则没有攻略的角色每次都徒然等待一次超时", async () => {
    const serv = make({ text: new Error("boom") })

    expect(await serv.entries("gs", "火", "胡桃")).toEqual([])
    expect(await serv.entries("gs", "火", "胡桃")).toEqual([])
    expect(urls).toHaveLength(1)
  })

  it("响应不是 JSON、或没有 strategy 一栏时按取不到算", async () => {
    expect(await make({ text: "<!DOCTYPE html>" }).entries("gs", "火", "胡桃")).toEqual([])
    expect(await make({ text: "{}" }).entries("gs", "火", "胡桃")).toEqual([])
  })

  it("目录名或文件名为空时不发请求", async () => {
    const serv = make({ text: INDEX })
    await serv.entries("gs", "", "胡桃")
    await serv.entries("gs", "火", "")

    expect(urls).toEqual([])
  })
})

describe("StrategyService.authors 与攻略组白名单", () => {
  /** 一份 author.json */
  const AUTHORS = JSON.stringify({ material: [], strategy: ["猫冬", "Asgater", "关蝎"] })

  it("次序原样保留 —— 序号就是 #设置攻略 里用的那个", async () => {
    expect(await make({ text: AUTHORS }).authors("gs")).toEqual(["猫冬", "Asgater", "关蝎"])
  })

  it("地址是分支根下的 author.json", async () => {
    await make({ text: AUTHORS }).authors("sr")

    expect(urls).toEqual([`${DEFAULT_STRATEGY_HOST}/sr/raw/sr/author.json`])
  })

  it("缺省是「全部」，即空数组", async () => {
    expect(await make().picked("gs")).toEqual([])
  })

  it("设过之后读得回来，两个游戏各一份", async () => {
    const serv = make()
    await serv.pick("gs", ["猫冬"])

    expect(await serv.picked("gs")).toEqual(["猫冬"])
    expect(await serv.picked("sr")).toEqual([])
  })

  it("设成空数组即恢复为「全部」", async () => {
    const serv = make()
    await serv.pick("gs", ["猫冬"])
    await serv.pick("gs", [])

    expect(await serv.picked("gs")).toEqual([])
  })

  it("白名单不受开关影响 —— 关掉再打开，选的还是那几个", async () => {
    const off = new StrategyService({ dir, http: fakeHttp({}), kv, logger, enabled: () => false })
    await off.pick("gs", ["关蝎"])

    expect(await off.picked("gs")).toEqual(["关蝎"])
  })
})

describe("StrategyService.image", () => {
  /** 一条有图的攻略 */
  const ONE: StrategyEntry = { author: "猫冬", article: "47935576", url: "https://img.example/a.png" }

  it("下载后落盘，路径按「游戏/缓存目录/作者_文章号.后缀」", async () => {
    const got = await make().image("gs", "胡桃", ONE)

    expect(got).toBe(join(dir, "gs", "胡桃", "猫冬_47935576.png"))
    expect(existsSync(got as string)).toBe(true)
  })

  it("第二次直接用缓存，不再下载", async () => {
    const serv = make()
    await serv.image("gs", "胡桃", ONE)
    urls = []
    await serv.image("gs", "胡桃", ONE)

    expect(urls).toEqual([])
  })

  it("更新标记变了就是另一个文件名，于是自然重下", async () => {
    const serv = make()
    const a = await serv.image("gs", "胡桃", ONE)
    const b = await serv.image("gs", "胡桃", { ...ONE, update: "2" })

    expect(a).not.toBe(b)
  })

  it("没有地址时不下载", async () => {
    expect(await make().image("gs", "胡桃", { author: "猫冬", article: "1" })).toBeUndefined()
    expect(urls).toEqual([])
  })

  it("下载失败时不留半个文件 —— 先写临时名再改名，故目录里干干净净", async () => {
    const got = await make({ bytes: new Error("boom") }).image("gs", "胡桃", ONE)

    expect(got).toBeUndefined()
    expect(existsSync(join(dir, "gs", "胡桃"))).toBe(false)
  })

  it("空响应也算失败", async () => {
    expect(await make({ bytes: new Uint8Array() }).image("gs", "胡桃", ONE)).toBeUndefined()
  })

  it("成功之后目录里只有那一个文件 —— 临时名已改掉，不留半成品", async () => {
    const got = (await make().image("gs", "胡桃", ONE)) as string

    expect(readdirSync(join(dir, "gs", "胡桃"))).toEqual([basename(got)])
  })

  it("远端字段全被过滤光时放弃，不写到目录根上", async () => {
    expect(await make().image("gs", "..", ONE)).toBeUndefined()
    expect(readdirSync(dir)).toEqual([])
  })
})
