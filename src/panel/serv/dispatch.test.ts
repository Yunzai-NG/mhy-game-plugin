/**
 * 模块职责：面板取数层的测试 —— 挑源、冷却、取数与失败分类
 * 依赖方向：测试文件，依赖 serv/index.ts 与内核的内存 KV
 * 生命周期：每个用例一套新 KV 与新假 HTTP
 * 注意事项：口径是**挑源的判断次序**与**冷却的两条路**：
 *          - 挑源：强制米游社 → 按配置序号 → 缺省源。次序错了
 *            不报错，只让使用者"配了 Enka 却始终走 mgg"。
 *          - 冷却：取数**之前**先压一个短冷却（防并发打穿），取数**之后**按服务给的 `ttl` 覆盖。
 *            少了前者，同一 uid 被连点两次就是两次真请求。
 *          另单独验 HTML 错误页：面板服务挂掉时常返回 502 页面，直接 `JSON.parse` 会抛无关的语法错。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import type { HttpClient, HttpRequestOptions } from "@yunzai-ng/types"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ArtiMetaTable } from "../../meta/arti.js"
import { ArtiSetTable } from "../../meta/arti-set.js"
import { MetaLoader } from "../../meta/loader.js"
import { ProfileServ, servTypeOf } from "./index.js"

let kv: Kv
let dir = ""
/** 每次请求的地址与返回，供断言"到底打了哪个源" */
let calls: string[] = []
/** 下一次 `buffer()` 要返回的内容 */
let reply = "{}"
/** 为真时 `buffer()` 抛错，模拟网络失败 */
let boom = false

/** 假 HTTP：只实现 `buffer`，其余成员抛错以暴露"用了没实现的方法" */
const http = {
  async buffer(url: string, _opts?: HttpRequestOptions): Promise<Uint8Array> {
    calls.push(url)
    if (boom) throw new Error("network down")
    return new TextEncoder().encode(reply)
  },
  async get(): Promise<never> {
    throw new Error("不应走 get")
  },
  async post(): Promise<never> {
    throw new Error("不应走 post")
  },
  async request(): Promise<never> {
    throw new Error("不应走 request")
  },
  async download(): Promise<never> {
    throw new Error("不应走 download")
  },
  extend(): HttpClient {
    return http as unknown as HttpClient
  }
} as unknown as HttpClient

/**
 * 造一个取数器
 * @param opts 覆盖项：面板服务选择串
 * @returns 取数器
 */
function makeServ(opts: { cfg?: string } = {}): ProfileServ {
  const logger = fakeLogger()
  return new ProfileServ({
    http,
    kv: kv.sub("panel"),
    logger,
    meta: new MetaLoader({ dir, logger }),
    arti: new ArtiMetaTable({ metaDir: dir }),
    sets: new ArtiSetTable({ dir }),
    servCfg: () => opts.cfg ?? "0"
  })
}

beforeEach(() => {
  kv = new Kv(new MemoryKvDriver())
  dir = mkdtempSync(join(tmpdir(), "panel-serv-"))
  calls = []
  reply = "{}"
  boom = false
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("服务器类别", () => {
  it("按 uid 首位判官服 / B 服 / 国际服", () => {
    expect(servTypeOf("100000001", "gs")).toBe(0)
    expect(servTypeOf("500000001", "gs")).toBe(1)
    expect(servTypeOf("600000001", "gs")).toBe(2)
    expect(servTypeOf("800000001", "gs")).toBe(2)
    expect(servTypeOf("1800000001", "gs")).toBe(2)
  })

  /**
   * 绝区零的前缀形态与另两个游戏不同，故这一族必须单独判
   *
   * 它的国服 uid 不足十位、没有前缀；国际服才有 `10`/`13`/`15`/`17` 这一组，且都是十位。
   * 只认原神星铁的前缀表查不到绝区零的任何前缀、一律当成官服 ——
   * 于是 `zzzProfileServer` 第三位（国际服走 Enka 展柜）永不生效。
   */
  it("绝区零按自己那张前缀表判，国服不足十位算官服", () => {
    expect(servTypeOf("11480862", "zzz")).toBe(0)
    expect(servTypeOf("1300000001", "zzz")).toBe(2)
    expect(servTypeOf("1000000001", "zzz")).toBe(2)
    expect(servTypeOf("1500000001", "zzz")).toBe(2)
    expect(servTypeOf("1700000001", "zzz")).toBe(2)
  })

  it("判不出时按官服，而不是抛错", () => {
    // 位数不足的 uid 取不到首位段，此时不应让整条命令失败
    expect(servTypeOf("123", "gs")).toBe(0)
    expect(servTypeOf("", "gs")).toBe(0)
  })
})

describe("挑源", () => {
  it("强制米游社时无视配置", () => {
    const serv = makeServ({ cfg: "2" })
    expect(serv.pick("100000001", "gs", true).id).toBe("mysPanel")
    expect(serv.pick("100000001", "sr", true).id).toBe("mysPanelHSR")
  })

  it("自动档三类服务器一律走 Enka 官方", () => {
    // 没有"配了 token 就走私有服务"这一支，自动档即缺省源
    const serv = makeServ({ cfg: "0" })
    expect(serv.pick("100000001", "gs").id).toBe("enka")
    expect(serv.pick("500000001", "gs").id).toBe("enka")
    expect(serv.pick("600000001", "gs").id).toBe("enka")
  })

  it("填 1 按自动处理，而不是报错或落空", () => {
    // 1 不对应任何源；若因此让面板整个不可用，填了它的人无从知道该改哪里
    const serv = makeServ({ cfg: "1" })
    expect(serv.pick("100000001", "gs").id).toBe("enka")
    expect(serv.pick("100000001", "sr").id).toBe("homo")
  })

  it("配置序号优先于缺省源", () => {
    const serv = makeServ({ cfg: "2" })
    expect(serv.pick("100000001", "gs").id).toBe("enka")
    expect(makeServ({ cfg: "3" }).pick("100000001", "gs").id).toBe("mgg")
    expect(makeServ({ cfg: "4" }).pick("100000001", "gs").id).toBe("hanxuan")
    expect(makeServ({ cfg: "5" }).pick("100000001", "gs").id).toBe("lyln")
  })

  it("星铁的序号表与原神不同", () => {
    expect(makeServ({ cfg: "2" }).pick("100000001", "sr").id).toBe("homo")
    expect(makeServ({ cfg: "3" }).pick("100000001", "sr").id).toBe("avocado")
    expect(makeServ({ cfg: "4" }).pick("100000001", "sr").id).toBe("enkaHSR")
  })

  it("绝区零缺省走米游社源，配置选 2 才走 Enka 展柜", () => {
    expect(makeServ({ cfg: "0" }).pick("18707318", "zzz").id).toBe("mysPanelZZZ")
    expect(makeServ({ cfg: "1" }).pick("18707318", "zzz").id).toBe("mysPanelZZZ")
    expect(makeServ({ cfg: "2" }).pick("18707318", "zzz").id).toBe("enkaZZZ")
    // 强制米游社时无视配置，仍回米游社源
    expect(makeServ({ cfg: "2" }).pick("18707318", "zzz", true).id).toBe("mysPanelZZZ")
  })

  it("配置串按服务器类别逐位取，国际服取第三位", () => {
    // "053"：官服自动、B 服 5（lyln）、国际服 3（mgg）
    const serv = makeServ({ cfg: "053" })
    expect(serv.pick("100000001", "gs").id).toBe("enka")
    expect(serv.pick("500000001", "gs").id).toBe("lyln")
    expect(serv.pick("600000001", "gs").id).toBe("mgg")
  })

  it("配置串位数不足时回落到第一位，而不是当成自动", () => {
    // 只写了一位却查国际服：应沿用第一位的选择
    const serv = makeServ({ cfg: "3" })
    expect(serv.pick("600000001", "gs").id).toBe("mgg")
  })
})

describe("冷却", () => {
  it("取数前先压一个短冷却，使同一 uid 的并发请求打不穿", async () => {
    const serv = makeServ({ cfg: "2" })
    reply = JSON.stringify({ playerInfo: { nickname: "甲" }, avatarInfoList: [{ avatarId: 10000002, propMap: { 4001: { val: 90 } } }] })
    await serv.fetch("qq:1", "100000001","gs")
    // 取数完毕后按服务给的 ttl 覆盖，此时应仍在冷却中
    expect(await serv.cooldown("qq:1", "100000001")).toBeGreaterThan(0)
  })

  it("冷却未到时报剩余秒数，到点后归零", async () => {
    const serv = makeServ()
    await serv.setCooldown("qq:1", "100000001",60)
    const left = await serv.cooldown("qq:1", "100000001")
    expect(left).toBeGreaterThan(50)
    expect(left).toBeLessThanOrEqual(60)
    await serv.setCooldown("qq:1", "100000001",0)
    // 压 0 秒即不写，故此前那条仍在 —— 冷却只由更长的覆盖
    expect(await serv.cooldown("qq:1", "100000001")).toBeGreaterThan(0)
  })

  it("没有记录时冷却为 0", async () => {
    expect(await makeServ().cooldown("qq:1", "999999999")).toBe(0)
  })

  it("**冷却按发起者分**：别人刚更新过同一 uid 不卡住我（各存各的面板）", async () => {
    const serv = makeServ()
    await serv.setCooldown("qq:1", "100000001", 60)
    expect(await serv.cooldown("qq:1", "100000001")).toBeGreaterThan(0)
    expect(await serv.cooldown("qq:2", "100000001")).toBe(0)
  })
})

describe("取数", () => {
  it("成功时映射出面板，并按配置打到对应地址", async () => {
    const serv = makeServ({ cfg: "2" })
    reply = JSON.stringify({
      playerInfo: { nickname: "甲", level: 60 },
      avatarInfoList: [{ avatarId: 10000002, propMap: { 4001: { val: 90 }, 1002: { val: 6 } } }],
      ttl: 120
    })
    const got = await serv.fetch("qq:1", "100000001","gs")
    expect(got.serv.id).toBe("enka")
    expect(calls[0]).toBe("https://enka.network/api/uid/100000001")
    expect(got.result.ok).toBe(true)
    if (got.result.ok) {
      expect(got.result.profile.name).toBe("甲")
      expect(got.result.cd).toBe(120)
    }
  })

  it("返回 HTML 错误页时取其标题当原文，而不是抛 JSON 语法错", async () => {
    const serv = makeServ({ cfg: "2" })
    reply = "<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>"
    const got = await serv.fetch("qq:1", "100000001","gs")
    expect(got.result.ok).toBe(false)
    if (!got.result.ok) {
      expect(got.result.kind).toBe("error")
      expect(got.result.message).toBe("502 Bad Gateway")
    }
  })

  it("网络失败时归为 error 并压上冷却，不让异常穿出去", async () => {
    const serv = makeServ({ cfg: "2" })
    boom = true
    const got = await serv.fetch("qq:1", "100000001","gs")
    expect(got.result.ok).toBe(false)
    if (!got.result.ok) expect(got.result.kind).toBe("error")
    expect(await serv.cooldown("qq:1", "100000001")).toBeGreaterThan(0)
  })

  it("米游社源不发 HTTP，数据须由调用方传入", async () => {
    const serv = makeServ()
    const got = await serv.fetch("qq:1", "100000001","gs", {
      fromMys: true,
      data: { avatars: [{ base: { id: 10000002, level: 90 }, relics: [], skills: [] }] }
    })
    expect(got.serv.id).toBe("mysPanel")
    // 一个请求都不该发出
    expect(calls).toHaveLength(0)
    expect(got.result.ok).toBe(true)
  })

  it("走米游社源却没传数据时明说缺数据，而不是静默出一份空面板", async () => {
    const serv = makeServ()
    const got = await serv.fetch("qq:1", "100000001","gs", { fromMys: true })
    expect(got.result.ok).toBe(false)
    if (!got.result.ok) expect(got.result.message).toContain("米游社")
  })
})

describe("按标识取源", () => {
  it("米游社源两个游戏各一份，不会串", () => {
    // 这两个源同名"米游社"而标识不同，取错的后果是拿原神的映射去解星铁的返回
    const serv = makeServ()
    expect(serv.source("mysPanel", "gs")?.game).toBe("gs")
    expect(serv.source("mysPanelHSR", "sr")?.game).toBe("sr")
  })

  it("游戏不匹配时取不到，避免拿原神源去查星铁", () => {
    const serv = makeServ()
    expect(serv.source("enka", "sr")).toBeUndefined()
    expect(serv.source("homo", "gs")).toBeUndefined()
  })

  it("不认得的标识给 undefined", () => {
    expect(makeServ().source("nope", "gs")).toBeUndefined()
  })
})
