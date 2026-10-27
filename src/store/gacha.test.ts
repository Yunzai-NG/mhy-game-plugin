/**
 * 模块职责：抽卡记录存储的测试
 * 依赖方向：测试文件，依赖 gacha.ts 与内核的内存 KV
 * 生命周期：每个用例一套新 KV 与新假 HTTP
 * 注意事项：本文件固定四项口径：**链接无论何种脏形态均须解析出 authkey**、**原神 400
 *          归并至 301**、**第二次仅拉取增量**（以请求次数断言，此为本模块存在的理由），
 *          以及 **authkey 过期即删除**。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import type { HttpClient, HttpRequestOptions } from "@yunzai-ng/types"
import { beforeEach, describe, expect, it } from "vitest"
import { GachaStore, parseGachaLink } from "./gacha.js"

/** 测试用 uid */
const UID = "100000001"

/** 一条正常形态的原神抽卡链接 */
const LINK = `https://webstatic.mihoyo.com/hk4e/event/e20190909gacha/index.html?authkey_ver=1&sign_type=2&auth_appid=webview_gacha&region=cn_gf01&authkey=abc%3d%3d&game_biz=hk4e_cn#/log`

/** 模拟的一条原始记录 */
interface FakeItem {
  /** id */
  id: string
  /** 卡池号 */
  gacha_type: string
  /** 物品名 */
  name: string
  /** 类型 */
  item_type: string
  /** 星级 */
  rank_type: string
  /** 时间 */
  time: string
  /** uid */
  uid: string
}

/**
 * 构造一条记录
 * @param id 记录 id，测试中采用 10 位数字，既可比较大小又不损失精度
 * @param type 卡池号
 * @param rank 星级
 * @param name 物品名
 * @returns 记录
 */
function item(id: string, type: string, rank = 3, name = "某物"): FakeItem {
  return { id, gacha_type: type, name, item_type: "角色", rank_type: String(rank), time: "2026-08-01 12:00:00", uid: UID }
}

/** 模拟 HTTP 的返回体 */
interface FakePage {
  /** 返回码 */
  retcode: number
  /** 提示 */
  message: string
  /** 数据 */
  data: { region: string; list: FakeItem[] } | null
}

/**
 * 构造一个仅实现 `get` 的模拟 HTTP，按 `end_id` 实际分页
 * @param data 全部记录
 * @param retcode 期望接口返回的码，非 0 时不返回数据
 * @returns 客户端与其收到的每次 query
 */
function fakeHttp(data: FakeItem[], retcode = 0): { http: HttpClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = []
  const fail = (): never => {
    throw new Error("测试只用 get")
  }

  const http: HttpClient = {
    request: fail,
    get: async <T>(_url: string, opts: Omit<HttpRequestOptions, "method"> = {}): Promise<T> => {
      const query = (opts.query ?? {}) as Record<string, unknown>
      calls.push(query)
      if (retcode !== 0) return { retcode, message: "authkey timeout", data: null } as FakePage as T

      const type = String(query["gacha_type"])
      const endId = String(query["end_id"] ?? "0")
      const size = Number(query["size"] ?? 20)
      const all = data.filter(it => it.gacha_type === type).sort((a, b) => Number(b.id) - Number(a.id))
      const rest = endId === "0" ? all : all.filter(it => Number(it.id) < Number(endId))
      return { retcode: 0, message: "OK", data: { region: "cn_gf01", list: rest.slice(0, size) } } as FakePage as T
    },
    post: fail,
    buffer: fail,
    download: fail,
    extend: fail
  }
  return { http, calls }
}

describe("parseGachaLink", () => {
  it("自正常链接中取出 authkey 与 region，末尾的 #/log 不产生影响", () => {
    const out = parseGachaLink(LINK)

    expect(out.ok).toBe(true)
    // URLSearchParams 会执行解码，存入的即应为解码后的原值
    expect(out.authkey).toBe("abc==")
    expect(out.region).toBe("cn_gf01")
  })

  it("QQ 将 & 显示为〈= 的形态同样可识别", () => {
    const out = parseGachaLink(LINK.replace(/&/g, "〈="))

    expect(out.ok).toBe(true)
    expect(out.authkey).toBe("abc==")
  })

  it("星铁将 #/ 置于 ? 之前的链接同样可解析", () => {
    const out = parseGachaLink("https://public-operation-hkrpg.mihoyo.com/x/index.html#/?authkey=zzz&region=prod_gf_cn")

    expect(out.ok).toBe(true)
    expect(out.authkey).toBe("zzz")
    expect(out.region).toBe("prod_gf_cn")
  })

  it("缺少 authkey 时只说该怎么办 —— 不解释「被截断」这个成因", () => {
    const out = parseGachaLink("https://webstatic.mihoyo.com/hk4e/x/index.html?region=cn_gf01")

    expect(out.ok).toBe(false)
    // 使用者要的是下一步动作：把整条链接重发一遍
    expect(out.message).toContain("完整")
  })

  it("输入完全不是链接时指明复制位置", () => {
    const out = parseGachaLink("我的抽卡记录呢")

    expect(out.ok).toBe(false)
    expect(out.message).toContain("历史记录")
  })
})

describe("GachaStore", () => {
  let kv: Kv
  let clock: number

  /**
   * 构造一个 store
   * @param data 模拟接口中包含的记录
   * @param retcode 期望接口返回的码
   * @returns store 与其发出的每次 query
   */
  const make = (data: FakeItem[], retcode = 0): { store: GachaStore; calls: Record<string, unknown>[] } => {
    const { http, calls } = fakeHttp(data, retcode)
    const store = new GachaStore({
      kv: kv.sub("gacha"),
      http,
      logger: fakeLogger(),
      gap: (): number => 0,
      now: (): number => clock
    })
    return { store, calls }
  }

  beforeEach(() => {
    kv = new Kv(new MemoryKvDriver())
    clock = Date.parse("2026-08-22T10:00:00Z")
  })

  it("受理链接时识别出 uid 与 region，此后可读回", async () => {
    const { store } = make([item("1000000001", "301", 5, "钟离")])
    const saved = await store.saveAuth("qq:1", "gs", LINK)

    expect(saved).toMatchObject({ ok: true, uid: UID, region: "cn_gf01" })
    expect(await store.auth("qq:1", "gs", UID)).toMatchObject({ authkey: "abc==", region: "cn_gf01", uid: UID })
  })

  it("saveAuthKey 直接收下已换好的 authkey，不再探测，随后即可增量同步", async () => {
    const { store, calls } = make([item("1000000001", "301", 5, "钟离")])
    await store.saveAuthKey("qq:1", "gs", "auto-key==", "cn_gf01", UID)

    // 直接落库、不曾为探测 uid/region 而发请求
    expect(calls).toHaveLength(0)
    expect(await store.auth("qq:1", "gs", UID)).toMatchObject({ authkey: "auto-key==", region: "cn_gf01", uid: UID })

    const synced = await store.sync("qq:1", "gs", UID)
    expect(synced).toMatchObject({ ok: true, uid: UID, added: 1, total: 1 })
  })

  it("原神的 getGachaLog 不带 game_biz、gacha_type 直用 301（既有可用实现如此）", async () => {
    const { store, calls } = make([item("1000000001", "301", 5, "钟离")])
    await store.saveAuthKey("qq:1", "gs", "k==", "cn_gf01", UID)
    await store.sync("qq:1", "gs", UID)

    expect(calls[0]?.["game_biz"]).toBeUndefined()
    expect(String(calls[0]?.["gacha_type"])).toBe("301")
  })

  it("星铁的 getGachaLog 必带 game_biz=hkrpg_cn，否则 -111", async () => {
    const { store, calls } = make([])
    await store.saveAuthKey("qq:1", "sr", "k==", "prod_gf_cn", "100000001")
    await store.sync("qq:1", "sr", "100000001")

    // 首个卡池是角色活动跃迁，gacha_type 直用 11
    expect(calls[0]?.["game_biz"]).toBe("hkrpg_cn")
    expect(String(calls[0]?.["gacha_type"])).toBe("11")
  })

  it("绝区零：带 game_biz=nap_cn，且 gacha_type 拼成 2001 形态、real_gacha_type 给真实类型 2", async () => {
    const { store, calls } = make([])
    await store.saveAuthKey("qq:1", "zzz", "k==", "prod_gf_cn", "10000001")
    await store.sync("qq:1", "zzz", "10000001")

    // 首个卡池是独家频段，真实类型 2 → 展示分类 2001
    expect(calls[0]?.["game_biz"]).toBe("nap_cn")
    expect(String(calls[0]?.["gacha_type"])).toBe("2001")
    expect(String(calls[0]?.["real_gacha_type"])).toBe("2")
  })

  it("绝区零重映频段：独家重映展示 12001→真实 102、音擎回响 13001→真实 103", async () => {
    const { store, calls } = make([])
    await store.saveAuthKey("qq:1", "zzz", "k==", "prod_gf_cn", "10000001")
    await store.sync("qq:1", "zzz", "10000001")

    const rerun = calls.find(c => String(c["gacha_type"]) === "12001")
    expect(String(rerun?.["real_gacha_type"])).toBe("102")
    const echo = calls.find(c => String(c["gacha_type"]) === "13001")
    expect(String(echo?.["real_gacha_type"])).toBe("103")
  })

  it("链接失效时不写入存储，且返回可据以操作的提示", async () => {
    const { store } = make([], -101)
    const saved = await store.saveAuth("qq:1", "gs", LINK)

    expect(saved.ok).toBe(false)
    expect(saved.message).toContain("链接已失效")
    expect(await store.auth("qq:1", "gs", UID)).toBeUndefined()
  })

  it("原神 400 的记录归并至 301：两条线共用一套保底", async () => {
    const { store } = make([
      item("1000000001", "301", 5, "钟离"),
      item("1000000002", "400", 3, "冷刃"),
      item("1000000003", "301", 4, "香菱"),
      item("1000000004", "302", 5, "护摩")
    ])
    await store.saveAuth("qq:1", "gs", LINK)
    const synced = await store.sync("qq:1", "gs", UID)

    expect(synced).toMatchObject({ ok: true, uid: UID, added: 4, total: 4 })
    const pools = await store.pools("qq:1", "gs", UID)
    expect(pools[0]?.spec.key).toBe("301")
    expect(pools[0]?.records.map(it => it.name)).toEqual(["香菱", "冷刃", "钟离"])
    expect(pools[0]?.records.every(it => it.pool === "301")).toBe(true)
    expect(pools[1]?.records.map(it => it.name)).toEqual(["护摩"])
    // 未抽取过的卡池同样出现在结果中，以便视图渲染出"该卡池无记录"
    expect(pools).toHaveLength(5)
  })

  it("第二次仅拉取增量：到达已知记录即停止，不再遍历半年窗口", async () => {
    const data = [item("1000000001", "301", 3), item("1000000002", "301", 5, "钟离")]
    const { store, calls } = make(data)
    await store.saveAuth("qq:1", "gs", LINK)
    await store.sync("qq:1", "gs", UID)

    calls.length = 0
    data.push(item("1000000003", "301", 4, "香菱"))
    const again = await store.sync("qq:1", "gs", UID)

    expect(again).toMatchObject({ ok: true, added: 1, total: 3 })
    // 301 仅发出一页请求：首页即命中已知的 1000000002
    expect(calls.filter(it => it["gacha_type"] === "301")).toHaveLength(1)
    const pools = await store.pools("qq:1", "gs", UID)
    // 去重依据 id，重复出现的两条旧记录未被再次写入
    expect(pools[0]?.records.map(it => it.id)).toEqual(["1000000003", "1000000002", "1000000001"])
  })

  it("超过一页时按 end_id 向前翻页，end_id 取上一页最后一条", async () => {
    const data = Array.from({ length: 25 }, (_, i) => item(String(1000000001 + i), "301"))
    const { store, calls } = make(data)
    await store.saveAuth("qq:1", "gs", LINK)
    calls.length = 0
    const synced = await store.sync("qq:1", "gs", UID)

    expect(synced.total).toBe(25)
    const pages = calls.filter(it => it["gacha_type"] === "301")
    expect(pages).toHaveLength(2)
    expect(pages[0]?.["end_id"]).toBe("0")
    // 倒序第 20 条为 1000000006，第二页自该条继续向前翻页
    expect(pages[1]?.["end_id"]).toBe("1000000006")
  })

  it("authkey 超过一天即视为不存在，并同时从 KV 中删除", async () => {
    const { store } = make([item("1000000001", "301", 5, "钟离")])
    await store.saveAuth("qq:1", "gs", LINK)
    clock += 24 * 60 * 60 * 1000

    expect(await store.auth("qq:1", "gs", UID)).toBeUndefined()
    // 凭据保留既无用途又构成风险，故为实际删除而非仅判定过期
    expect(await kv.sub("gacha").get(`auth:gs:qq:1:${UID}`)).toBeUndefined()
  })

  it("无链接时 sync 直接提示需提供链接，不发出请求", async () => {
    const { store, calls } = make([])
    const synced = await store.sync("qq:1", "gs", UID)

    expect(synced.ok).toBe(false)
    expect(synced.message).toContain("抽卡链接")
    expect(calls).toHaveLength(0)
  })

  it("链接有效而账号无任何抽取记录：认不出 uid，故不落库 —— 链接按 uid 存，无 uid 即无处可存", async () => {
    const { store } = make([])
    const saved = await store.saveAuth("qq:1", "gs", LINK)

    expect(saved).toMatchObject({ ok: true, uid: "" })
    expect(await collect(kv.sub("gacha").keys("auth:"))).toEqual([])
    const synced = await store.sync("qq:1", "gs", UID)
    expect(synced.ok).toBe(false)
    expect(synced.message).toContain("抽卡链接")
  })

  it("同一用户名下两个 uid 的链接分开存：后存的不覆盖先存的，各自同步各自的记录", async () => {
    const OTHER = "100000002"
    const { store } = make([item("1000000001", "301", 5, "钟离")])
    await store.saveAuthKey("qq:1", "gs", "key-a==", "cn_gf01", UID)
    await store.saveAuthKey("qq:1", "gs", "key-b==", "cn_gf01", OTHER)

    expect((await store.auth("qq:1", "gs", UID))?.authkey).toBe("key-a==")
    expect((await store.auth("qq:1", "gs", OTHER))?.authkey).toBe("key-b==")

    // 更新的是传入的那个 uid：记录落在它自己的键下，另一个 uid 名下仍是空的
    const synced = await store.sync("qq:1", "gs", OTHER)
    expect(synced).toMatchObject({ ok: true, uid: OTHER, added: 1 })
    expect((await store.records("qq:1", "gs", OTHER, "301")).length).toBe(1)
    expect((await store.records("qq:1", "gs", UID, "301")).length).toBe(0)
  })

  it("改版前不分 uid 的那份链接：属于这个 uid 时认领并挪到新键，属于别的 uid 时原样留着", async () => {
    const { store } = make([])
    const legacy = { authkey: "old==", region: "cn_gf01", uid: UID, savedAt: clock }
    await kv.sub("gacha").set("auth:gs:qq:1", legacy)

    // 别的 uid 来取：拿不到，也不动它
    expect(await store.auth("qq:1", "gs", "100000002")).toBeUndefined()
    expect(await kv.sub("gacha").get("auth:gs:qq:1")).toEqual(legacy)

    // 它自己的 uid 来取：认领，旧键随之删除
    expect((await store.auth("qq:1", "gs", UID))?.authkey).toBe("old==")
    expect(await kv.sub("gacha").get("auth:gs:qq:1")).toBeUndefined()
    expect(await kv.sub("gacha").get(`auth:gs:qq:1:${UID}`)).toEqual(legacy)
  })

  it("删链接删的是名下这个游戏全部 uid 的链接，连同改版前那份", async () => {
    const { store } = make([])
    await store.saveAuthKey("qq:1", "gs", "key-a==", "cn_gf01", UID)
    await store.saveAuthKey("qq:1", "gs", "key-b==", "cn_gf01", "100000002")
    await kv.sub("gacha").set("auth:gs:qq:1", { authkey: "old==", region: "cn_gf01", uid: UID, savedAt: clock })
    // 别人的链接与别的游戏的链接不受影响
    await store.saveAuthKey("qq:2", "gs", "key-c==", "cn_gf01", UID)
    await store.saveAuthKey("qq:1", "sr", "key-d==", "prod_gf_cn", UID)

    await store.dropAuth("qq:1", "gs")

    expect(await store.auth("qq:1", "gs", UID)).toBeUndefined()
    expect(await store.auth("qq:1", "gs", "100000002")).toBeUndefined()
    expect(await kv.sub("gacha").get("auth:gs:qq:1")).toBeUndefined()
    expect((await store.auth("qq:2", "gs", UID))?.authkey).toBe("key-c==")
    expect((await store.auth("qq:1", "sr", UID))?.authkey).toBe("key-d==")
  })
})

/**
 * 把异步迭代器收成数组
 * @param it 迭代器
 * @returns 数组
 */
async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const one of it) out.push(one)
  return out
}

