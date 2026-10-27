/**
 * 模块职责：玩家头像库的测试
 * 依赖方向：测试文件，依赖 store/face.ts；写临时目录，HTTP 用替身
 * 生命周期：每个用例一份临时目录与内存 KV
 * 注意事项：钉四项口径：**文件按头像自身标识命名**（同一张头像多个 uid 共用一份、第二个 uid 不再下载）、
 *          **两源并存时取较新那个**（时间戳由 Date.now 钉住，否则同一毫秒内写入时先后判不出）、
 *          **Enka 的 id 不在 pfps 索引里就不写**、以及**取数失败不抹掉 kv 里那张旧的**。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import type { HttpClient, HttpRequestOptions, KvNamespace } from "@yunzai-ng/types"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FaceStore } from "./face.js"

/** 一张假图，内容无所谓、非空即可 */
const PNG = new Uint8Array([137, 80, 78, 71])

/** 三游戏的索引字段名不同，这里把两种都放进来 */
const PFPS = { "9101": { IconPath: "/ui/one.png" }, "202063": { Icon: "/ui/hsr/two.png" } }

/**
 * 并进索引之后的样子：原神「拿角色当头像」给的两个 id 也在同一张表里
 *
 * 那两个键由自建镜像从 avatars.json 推出来并进去（见 enka-assets 的 buildCharIcons），
 * 上游原始索引里没有 —— 所以插件侧只需查这一张表。
 */
const PFPS_WITH_CHARS = {
  ...PFPS,
  "10000002": { IconPath: "/ui/UI_AvatarIcon_Ayaka.png" },
  "200201": { IconPath: "/ui/UI_AvatarIcon_AyakaCostumeFruhling.png" }
}

/** 一次用例记录下的请求 */
let hits: string[] = []

let dir = ""
let kv: KvNamespace

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mhy-face-"))
  kv = new Kv(new MemoryKvDriver()).sub("face")
  hits = []
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 造一个头像库，同一用例内共用目录与 kv
 * @param opts 替身的行为：`pfps` 为索引内容，`fail` 为真时所有请求都抛错，`assetHost` 为自建镜像前缀
 * @returns 头像库
 */
function store(opts: { pfps?: Record<string, unknown>; fail?: boolean; assetHost?: string } = {}): FaceStore {
  const http = {
    buffer: async (url: string, _o?: HttpRequestOptions): Promise<Uint8Array> => {
      hits.push(url)
      if (opts.fail) throw new Error("网络不可用")
      return PNG
    },
    get: async <T>(url: string): Promise<T> => {
      hits.push(url)
      if (opts.fail) throw new Error("网络不可用")
      return (opts.pfps ?? {}) as T
    }
  } as unknown as HttpClient

  return new FaceStore({
    dir,
    http,
    kv,
    logger: fakeLogger(),
    host: () => "",
    assetHost: () => opts.assetHost ?? ""
  })
}

describe("FaceStore 米游社源", () => {
  it("文件名取直链的哈希，落在 `mys/<游戏>/` 下", async () => {
    const got = await store().saveMys("gs", "100000001", "https://a.invalid/one.png")
    expect(got).toMatch(/^mys\/gs\/[0-9a-f]{16}\.png$/)
  })

  it("**同一张头像多个 uid 共用一份**：第二个 uid 不再下载", async () => {
    const one = store()
    const a = await one.saveMys("gs", "100000001", "https://a.invalid/one.png")
    const b = await one.saveMys("gs", "100000002", "https://a.invalid/one.png")
    expect(b).toBe(a)
    expect(hits).toHaveLength(1)
    expect((await one.info("gs", "100000002")).mysIcon).toBe(a)
  })

  it("换了地址就是另一张，重下", async () => {
    const one = store()
    const a = await one.saveMys("gs", "100000001", "https://a.invalid/one.png")
    const b = await one.saveMys("gs", "100000001", "https://a.invalid/two.png")
    expect(b).not.toBe(a)
    expect(hits).toHaveLength(2)
  })

  it("地址为空或不是 http 时不发请求 —— 接口没给这一项是常态", async () => {
    const one = store()
    expect(await one.saveMys("gs", "100000001", undefined)).toBeUndefined()
    expect(await one.saveMys("gs", "100000001", "")).toBeUndefined()
    expect(await one.saveMys("gs", "100000001", "/ui/x.png")).toBeUndefined()
    expect(hits).toEqual([])
  })

  it("**取数失败不抹掉旧头像**：kv 里那张仍在，页头照用", async () => {
    const old = await store().saveMys("gs", "100000001", "https://a.invalid/one.png")
    const bad = store({ fail: true })
    expect(await bad.saveMys("gs", "100000001", "https://a.invalid/two.png")).toBeUndefined()
    expect(await bad.pick("gs", "100000001")).toBe(old)
  })
})

describe("FaceStore Enka 源", () => {
  it("经 pfps 索引把头像 id 换成地址，文件名即头像 id", async () => {
    const one = store({ pfps: PFPS })
    expect(await one.saveEnka("gs", "100000001", 9101)).toBe("enka/gs/9101.png")
    expect(hits).toContain("https://enka.network/ui/one.png")
  })

  it("`Icon` 与 `IconPath` 两种字段名都认 —— 原神与星铁的索引不同名", async () => {
    const one = store({ pfps: PFPS })
    expect(await one.saveEnka("sr", "101234567", "202063")).toBe("enka/sr/202063.png")
    expect(hits).toContain("https://enka.network/ui/hsr/two.png")
  })

  it("**id 不在索引里就不写**：原神「拿角色当头像」给的是角色 id，页头退默认图", async () => {
    const one = store({ pfps: PFPS })
    expect(await one.saveEnka("gs", "100000001", 10000046)).toBeUndefined()
    expect((await one.info("gs", "100000001")).enkaIcon).toBeUndefined()
    expect(await one.pick("gs", "100000001")).toBeUndefined()
  })


  it("id 为空时连索引都不取", async () => {
    expect(await store({ pfps: PFPS }).saveEnka("gs", "100000001", undefined)).toBeUndefined()
    expect(hits).toEqual([])
  })

  it("**文件已在就连索引都不取** —— 别的 uid 落过同一张时也一样", async () => {
    const one = store({ pfps: PFPS })
    await one.saveEnka("gs", "100000001", 9101)
    const before = hits.length
    expect(await one.saveEnka("gs", "100000002", 9101)).toBe("enka/gs/9101.png")
    expect(hits).toHaveLength(before)
  })

  it("默认从 Enka 官方取图，路径就挂在根上", async () => {
    await store({ pfps: PFPS }).saveEnka("gs", "100000001", 9101)
    expect(hits).toContain("https://enka.network/ui/one.png")
  })

  it("**配了自建镜像就按它的形态拼**：`/<游戏>/assets/ui/…`，与官方那台不同", async () => {
    await store({ pfps: PFPS, assetHost: "https://mirror.example" }).saveEnka("sr", "101234567", "202063")
    expect(hits).toContain("https://mirror.example/sr/assets/ui/hsr/two.png")
  })

  it("自建镜像前缀带尾斜杠时不拼出双斜杠", async () => {
    await store({ pfps: PFPS, assetHost: "https://mirror.example/" }).saveEnka("gs", "100000001", 9101)
    expect(hits).toContain("https://mirror.example/gs/assets/ui/one.png")
  })

  it("**「拿角色当头像」也能取到**：角色 id 与时装 id 由镜像并进了同一张索引", async () => {
    const one = store({ pfps: PFPS_WITH_CHARS, assetHost: "https://mirror.example" })
    expect(await one.saveEnka("gs", "100000001", "10000002")).toBe("enka/gs/10000002.png")
    expect(hits).toContain("https://mirror.example/gs/assets/ui/UI_AvatarIcon_Ayaka.png")

    expect(await one.saveEnka("gs", "100000002", "200201")).toBe("enka/gs/200201.png")
    expect(hits).toContain("https://mirror.example/gs/assets/ui/UI_AvatarIcon_AyakaCostumeFruhling.png")
  })

  it("**上游没并进去的 id 就不写**：没配镜像时那一批键是不存在的", async () => {
    const one = store({ pfps: PFPS })
    expect(await one.saveEnka("gs", "100000001", "10000002")).toBeUndefined()
    expect(await one.pick("gs", "100000001")).toBeUndefined()
  })

  it("**缓存里查不到该 id 时会重新校验远端** —— 索引是会长大的，不校验要白等一周", async () => {
    // 盘上是十一分钟前那份旧表，里面没有角色 id 那批键
    writeFileSync(join(dir, "pfps-gs.json"), JSON.stringify({ at: Date.now() - 11 * 60 * 1000, table: { "9101": "/ui/one.png" } }))
    const one = store({ pfps: PFPS_WITH_CHARS, assetHost: "https://mirror.example" })
    expect(await one.saveEnka("gs", "100000001", "10000002")).toBe("enka/gs/10000002.png")
  })

  it("刚校验过就不再打远端 —— 否则未知 id 会变成打对方服务器的入口", async () => {
    writeFileSync(join(dir, "pfps-gs.json"), JSON.stringify({ at: Date.now(), table: { "9101": "/ui/one.png" } }))
    const one = store({ pfps: PFPS_WITH_CHARS, assetHost: "https://mirror.example" })
    expect(await one.saveEnka("gs", "100000001", "10000002")).toBeUndefined()
    expect(hits).toEqual([])
  })
})

describe("FaceStore pick", () => {
  it("一张都没有时为空 —— 调用方据此垫默认图", async () => {
    expect(await store().pick("gs", "100000001")).toBeUndefined()
  })

  it("uid 为空时为空", async () => {
    expect(await store().pick("gs", "")).toBeUndefined()
  })

  it("**两源都有时取较新那个**：按源固定优先会让刚在游戏里换完头像的人看到旧的", async () => {
    const one = store({ pfps: PFPS })
    const now = vi.spyOn(Date, "now")
    now.mockReturnValue(1000)
    const mys = await one.saveMys("gs", "100000001", "https://a.invalid/one.png")
    now.mockReturnValue(2000)
    await one.saveEnka("gs", "100000001", 9101)
    expect(await one.pick("gs", "100000001")).toBe("enka/gs/9101.png")

    now.mockReturnValue(3000)
    await one.saveMys("gs", "100000001", "https://a.invalid/one.png")
    expect(await one.pick("gs", "100000001")).toBe(mys)
  })

  it("**元数据那张不算头像**：它不在头像库里，故取不到、由调用方垫默认图", async () => {
    const one = store()
    // 早期版本往 enkaIcon 里写过这种值
    await one.merge("gs", "100000001", { enkaIcon: "meta-gs/character/胡桃/imgs/face.webp", enkaAt: 9999 })
    expect(await one.pick("gs", "100000001")).toBeUndefined()
  })

  it("**旧数据里那条元数据路径不该顶掉真头像**", async () => {
    const one = store()
    const real = await one.saveMys("gs", "100000001", "https://a.invalid/one.png")
    await one.merge("gs", "100000001", { enkaIcon: "meta-gs/character/神里绫华/imgs/face.webp", enkaAt: Date.now() + 10_000 })
    expect(await one.pick("gs", "100000001")).toBe(real)
  })

  it("文件被清掉时当作没有，而不是给一条取不到的路径", async () => {
    const one = store()
    await one.saveMys("gs", "100000001", "https://a.invalid/one.png")
    rmSync(join(dir, "mys"), { recursive: true, force: true })
    expect(await one.pick("gs", "100000001")).toBeUndefined()
  })

  it("游戏与 uid 各存各的，互不串台", async () => {
    const one = store()
    await one.saveMys("gs", "100000001", "https://a.invalid/one.png")
    expect(await one.pick("sr", "100000001")).toBeUndefined()
    expect(await one.pick("gs", "100000002")).toBeUndefined()
  })
})

describe("FaceStore merge", () => {
  it("逐字段合并：展柜带的世界等级不冲掉米游社带的昵称", async () => {
    const one = store()
    await one.merge("gs", "100000001", { name: "旅行者", level: 60 })
    await one.merge("gs", "100000001", { world: 9 })
    expect(await one.info("gs", "100000001")).toEqual({ name: "旅行者", level: 60, world: 9 })
  })
})
