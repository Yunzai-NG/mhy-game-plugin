/**
 * 模块职责：图鉴统计取数器的测试
 * 依赖方向：测试文件，依赖 service/wiki-stat 与内核的内存 KV；HTTP 客户端是假的
 * 生命周期：每个用例一份新 KV
 * 注意事项：固定四处：**开关关着时一个包都不发**（接第三方源的前提，不是优化）、**请求里只带
 *          角色名**（不带 uid、不带 Cookie）、两家的响应形态都要认（一家把角色包在 result 数组
 *          里、另一家直接给 data），以及查不到也缓存（否则没收录的角色每次查询都要等一次超时）。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import type { HttpClient, KvNamespace } from "@yunzai-ng/types"
import { beforeEach, describe, expect, it } from "vitest"
import { CharStatService, pickPct, pickStat } from "./wiki-stat.js"

/** 一个只收不看的日志器 */
const logger = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {}
} as unknown as ConstructorParameters<typeof CharStatService>[0]["logger"]

/** 记下来的请求地址 */
let urls: string[] = []

let kv: KvNamespace

beforeEach(() => {
  urls = []
  kv = new Kv(new MemoryKvDriver())
})

/**
 * 造一个假 HTTP 客户端
 * @param body 要返回的响应体；传 Error 则抛出
 * @returns 客户端
 */
function fakeHttp(body: unknown): HttpClient {
  return {
    get: async <T,>(url: string): Promise<T> => {
      urls.push(url)
      if (body instanceof Error) throw body
      return body as T
    }
  } as unknown as HttpClient
}

/**
 * 造一个取数器
 * @param body 假响应
 * @param enabled 开关
 * @returns 取数器
 */
function make(body: unknown, enabled = true): CharStatService {
  return new CharStatService({ http: fakeHttp(body), kv, logger, enabled: () => enabled })
}

/** 一份提瓦特小助手形态的响应 */
const GS_BODY = { code: 200, result: [{ role: "胡桃", avg_class: "2.34", c0: 45.6 }] }

/** 一份 ArkApi 形态的响应 */
const SR_BODY = { code: 0, data: { role: "姬子", avg_class: "1.2" } }

describe("pickStat", () => {
  it("认得出 result 数组里的第一项", () => {
    expect(pickStat(GS_BODY)?.role).toBe("胡桃")
  })

  it("也认得出直接给的 data", () => {
    expect(pickStat(SR_BODY)?.role).toBe("姬子")
  })

  it("没有 role 字段即视为没查到 —— 统计站对未实装角色会给一份空壳", () => {
    expect(pickStat({ code: 200, result: [{ avg_class: "0" }] })).toBeUndefined()
    expect(pickStat({ code: 0, data: {} })).toBeUndefined()
  })

  it("形态认不出时给 undefined 而非抛错", () => {
    expect(pickStat(undefined)).toBeUndefined()
    expect(pickStat("一段文字")).toBeUndefined()
    expect(pickStat({ code: 500 })).toBeUndefined()
  })

  it("result 为空数组时也算没查到", () => {
    expect(pickStat({ code: 200, result: [] })).toBeUndefined()
  })
})

describe("CharStatService 的开关", () => {
  it("关着时一个包都不发 —— 这是接第三方源的前提，不是优化", async () => {
    const got = await make(GS_BODY, false).get("gs", "胡桃")

    expect(got).toBeUndefined()
    expect(urls).toEqual([])
  })

  it("角色名为空时同样不发", async () => {
    await make(GS_BODY).get("gs", "")

    expect(urls).toEqual([])
  })

  it("开着时才请求", async () => {
    expect((await make(GS_BODY).get("gs", "胡桃"))?.role).toBe("胡桃")
    expect(urls).toHaveLength(1)
  })
})

describe("CharStatService 的请求", () => {
  it("原神打提瓦特小助手，**只带角色名与星级** —— 不带 uid、不带 Cookie", async () => {
    await make(GS_BODY).get("gs", "胡桃")

    expect(urls[0]).toBe("https://api.lelaer.com/ys/getRoleAvg.php?role=%E8%83%A1%E6%A1%83&star=all")
    expect(urls[0]).not.toMatch(/uid|cookie|ltoken/i)
  })

  it("星铁打 ArkApi，角色名进路径", async () => {
    await make(SR_BODY).get("sr", "姬子")

    expect(urls[0]).toBe("https://ark.ivny.cn/stats/sr/%E5%A7%AC%E5%AD%90?style=miao")
  })

  it("角色名做过转义 —— 名字里有「·」一类字符时不该拼出一个坏地址", async () => {
    await make(GS_BODY).get("gs", "菲米尼·测试")

    expect(urls[0]).not.toContain("·")
  })
})

describe("CharStatService 的缓存", () => {
  it("同一个角色只打一次", async () => {
    const serv = make(GS_BODY)
    await serv.get("gs", "胡桃")
    await serv.get("gs", "胡桃")

    expect(urls).toHaveLength(1)
  })

  it("两个游戏各存一份 —— 键要带游戏，否则星铁查到原神的数据", async () => {
    const serv = make(GS_BODY)
    await serv.get("gs", "胡桃")
    await serv.get("sr", "胡桃")

    expect(urls).toHaveLength(2)
  })

  it("查不到也记一笔 —— 否则一个没收录的角色会让每次查询都徒然等待一次", async () => {
    const serv = make({ code: 200, result: [] })
    expect(await serv.get("gs", "新角色")).toBeUndefined()
    expect(await serv.get("gs", "新角色")).toBeUndefined()

    expect(urls).toHaveLength(1)
  })

  it("请求失败时不抛错，只是那四块不出现，且同样记一笔", async () => {
    const serv = make(new Error("连接超时"))
    expect(await serv.get("gs", "胡桃")).toBeUndefined()
    expect(await serv.get("gs", "胡桃")).toBeUndefined()

    expect(urls).toHaveLength(1)
  })
})

/** 一份出场率形态的响应 */
const PCT_BODY = {
  code: 200,
  version: "6.1",
  update: "更新时间：2026-09-08",
  top_own: 12_345,
  has_list: [
    { name: "胡桃", use_rate: 62.3, rank_class: "s1" },
    { name: "钟离", use_rate: 41, rank_class: "s" }
  ]
}

describe("pickPct", () => {
  it("认得出正常响应", () => {
    expect(pickPct(PCT_BODY)?.has_list).toHaveLength(2)
  })

  it("**`code` 不是 200 一律不认** —— 这一家没有当期数据时也回一个别的码带一句说明", () => {
    expect(pickPct({ ...PCT_BODY, code: 500 })).toBeUndefined()
    // 不判 code 就会出一张每档都空的图，而使用者分不出那是"还没统计"还是"接口挂了"
    expect(pickPct({ code: 404, msg: "暂无数据" })).toBeUndefined()
  })

  it("一位角色都没有时也算没查到", () => {
    expect(pickPct({ code: 200, has_list: [] })).toBeUndefined()
    expect(pickPct({ code: 200 })).toBeUndefined()
  })

  it("形态认不出时给 undefined 而非抛错", () => {
    expect(pickPct(undefined)).toBeUndefined()
    expect(pickPct("一段文字")).toBeUndefined()
  })
})

describe("CharStatService.pct", () => {
  it("关着时一个包都不发 —— 与图鉴那一族共用同一道开关", async () => {
    expect(await make(PCT_BODY, false).pct("abyss")).toBeUndefined()
    expect(urls).toEqual([])
  })

  it("深渊与幽境危战各打各的地址，且**都不带 uid 与 Cookie**", async () => {
    const serv = make(PCT_BODY)
    await serv.pct("abyss")
    await serv.pct("hard")

    expect(urls[0]).toBe("https://api.lelaer.com/ys/getAbyssRank.php?star=all&lang=zh-Hans")
    expect(urls[1]).toBe("https://api.lelaer.com/ys/getAbyssRank2.php?star=all&lang=zh-Hans")
    // 这一条是接第三方源的底线：请求里只该有"查哪一种"，不含任何使用者信息
    for (const url of urls) expect(url).not.toMatch(/uid|cookie|ltoken|stoken/i)
  })

  it("两种模式各存一份缓存 —— 共用键会让幽境危战读到深渊那份", async () => {
    const serv = make(PCT_BODY)
    await serv.pct("abyss")
    await serv.pct("abyss")
    await serv.pct("hard")

    expect(urls).toHaveLength(2)
  })

  it("缓存键与图鉴那一族不冲突 —— 值形态不同，混用会互相顶掉", async () => {
    const serv = make(PCT_BODY)
    await serv.pct("abyss")
    // 若两者共用 `gs:xxx` 一类键，这一次会读到出场率那份而不再发请求
    await serv.get("gs", "abyss")

    expect(urls).toHaveLength(2)
  })

  it("没有当期数据时不抛错，且同样记一笔", async () => {
    const serv = make({ code: 404, msg: "暂无数据" })
    expect(await serv.pct("abyss")).toBeUndefined()
    expect(await serv.pct("abyss")).toBeUndefined()

    expect(urls).toHaveLength(1)
  })

  it("请求失败时不抛错", async () => {
    const serv = make(new Error("连接超时"))
    expect(await serv.pct("abyss")).toBeUndefined()

    expect(urls).toHaveLength(1)
  })
})
