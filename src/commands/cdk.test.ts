/**
 * 模块职责：兑换码命令的测试
 * 依赖方向：测试文件，依赖 commands/cdk.ts 与真实的四个服务（跑在内存 KV 上）
 * 生命周期：每个用例一套新 KV
 * 注意事项：本文件固定三项口径：**国服直接拦截且不发出任何请求**、**仅使用本人的 CK**
 *          （借用公共池等同于将礼包兑换至他人账号）、以及**单次最多五个**。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@yunzai-ng/types"
import { beforeEach, describe, expect, it } from "vitest"
import { CookiePool } from "../store/ck.js"
import { MysClient } from "../core/client.js"
import type { MhyConfigView } from "../config.js"
import { CONFIG_SCHEMA } from "../config.js"
import { DeviceStore } from "../core/device.js"
import { GachaStore } from "../store/gacha.js"
import { MysService } from "../service/mys.js"
import type { Session } from "../core/session.js"
import { UserStore } from "../store/user.js"
import { useCdk } from "./cdk.js"
import type { MhyDeps } from "./deps.js"

/** 国际服（亚服）uid */
const OS_UID = "800000001"

/** 国服 uid */
const CN_UID = "100000001"

/** 米游社账号 id */
const LTUID = "123456789"

/** 一份能用的 Cookie */
const CK = `ltuid_v2=${LTUID}; ltoken_v2=v2_a=`

/** 默认配置，由 schema 现算：抄一份就得随每个新配置项改一次，而这里在意的只有下面那项覆盖 */
const CONFIG: MhyConfigView = {
  ...CONFIG_SCHEMA.parse({}),
  metaHost: "https://example.invalid"
}

/** 假会话，记录所有回复 */
interface Spy extends Session {
  /** 收到的全部回复 */
  readonly said: string[]
  /** 最后一句回复 */
  last(): string
}

/** 造一个假会话 */
const makeSession = (init: Partial<Session> = {}): Spy => {
  const said: string[] = []
  return {
    user: init.user ?? "qq:1",
    name: init.name ?? "旅行者",
    rest: init.rest ?? "",
    game: init.game ?? "gs",
    isPrivate: init.isPrivate ?? true,
    isMaster: init.isMaster ?? false,
    isGroupAdmin: init.isGroupAdmin ?? false,
    botId: init.botId ?? "bot-1",
    lastSent: (): string => "msg-1",
    images: init.images ?? [],
    imageBytes: async (): Promise<boolean> => false,
    imageFile: async (): Promise<boolean> => false,
    forward: async (): Promise<boolean> => false,
    said,
    last: (): string => said[said.length - 1] ?? "",
    text: async (content: string): Promise<void> => void said.push(content),
    image: async (): Promise<boolean> => false,
    ask: async (): Promise<string | undefined> => undefined,
    file: async (): Promise<{ name: string; text: string } | undefined> => undefined,
    askFile: async (): Promise<{ name: string; text: string } | undefined> => undefined,
    sendFile: async (): Promise<boolean> => false
  }
}

/**
 * 造一个假 HTTP：指纹给 fp-1，兑换按码查表返回
 * @param table 兑换码 → 返回码，缺省 0
 * @returns 客户端与它请求过的每个 URL
 */
const makeHttp = (table: Record<string, { retcode: number; message: string }> = {}): { http: HttpClient; urls: string[] } => {
  const urls: string[] = []
  const fail = (): never => {
    throw new Error("测试只用 request")
  }

  /**
   * 包一层 HTTP 响应
   * @param body 米游社信封
   * @param url 请求地址
   * @returns 响应
   */
  const wrap = <T>(body: unknown, url: string): HttpResponse<T> => ({
    status: 200,
    statusText: "OK",
    headers: {},
    data: body as T,
    ok: true,
    url,
    cost: 1
  })

  const http: HttpClient = {
    request: async <T>(url: string, _opts: HttpRequestOptions = {}): Promise<HttpResponse<T>> => {
      urls.push(url)
      if (url.includes("device-fp/api/getFp")) return wrap<T>({ retcode: 0, data: { device_fp: "fp-1" } }, url)
      if (url.includes("apicdkey")) {
        const cdk = new URL(url).searchParams.get("cdkey") ?? ""
        const hit = table[cdk] ?? { retcode: 0, message: "OK" }
        return wrap<T>({ retcode: hit.retcode, message: hit.message, data: {} }, url)
      }
      return wrap<T>({ retcode: 0, data: { list: [] } }, url)
    },
    get: fail,
    post: fail,
    buffer: fail,
    download: fail,
    extend: () => http
  }
  return { http, urls }
}

describe("兑换码命令", () => {
  let deps: MhyDeps
  let urls: string[]

  /**
   * 组一套依赖
   * @param table 兑换码 → 返回码
   * @returns 依赖包
   */
  const build = (table: Record<string, { retcode: number; message: string }> = {}): MhyDeps => {
    const kv = new Kv(new MemoryKvDriver())
    const logger = fakeLogger()
    const fake = makeHttp(table)
    urls = fake.urls
    const devices = new DeviceStore({ kv: kv.sub("device"), logger })
    const cookies = new CookiePool({
      kv: kv.sub("cookie"),
      logger,
      devices
    })
    const users = new UserStore({ kv: kv.sub("user") })
    const client = new MysClient({ http: fake.http, logger, devices })
    return {
      mys: new MysService({ client, cookies, users, logger }),
      cookies,
      users,
      devices,
      gacha: new GachaStore({ kv: kv.sub("gacha"), http: fake.http, logger, gap: (): number => 0 }),
      config: (): MhyConfigView => CONFIG,
      logger
    }
  }

  /**
   * 给 qq:1 绑一个 uid 与一份自己的 CK
   * @param uid 游戏 uid
   */
  const bind = async (uid: string): Promise<void> => {
    await deps.users.addUid("qq:1", "gs", uid)
    await deps.cookies.save(CK, { uids: { gs: [uid] }, owner: "qq:1" })
  }

  beforeEach(() => {
    deps = build()
  })

  it("国服直接拦截并指明兑换入口，不发出任何请求", async () => {
    await bind(CN_UID)
    const s = makeSession({ rest: "GENSHINGIFT" })
    await useCdk(s, deps, 0)

    expect(s.last()).toContain("国服")
    expect(s.last()).toContain("设置 - 账户 - 兑换码")
    expect(urls).toEqual([])
  })

  it("国际服兑换成功时提醒去邮件里领", async () => {
    await bind(OS_UID)
    const s = makeSession({ rest: "GENSHINGIFT" })
    await useCdk(s, deps, 0)

    expect(s.last()).toContain("GENSHINGIFT 兑换成功")
    expect(s.last()).toContain("邮件")
    expect(urls.some(it => it.includes("apicdkey"))).toBe(true)
  })

  it("已使用过的兑换码转换为可读说明，而非返回 -2017", async () => {
    deps = build({ USEDGIFT: { retcode: -2017, message: "Redemption code has been used" } })
    await bind(OS_UID)
    const s = makeSession({ rest: "USEDCODE1 USEDGIFT" })
    await useCdk(s, deps, 0)

    expect(s.last()).toContain("USEDGIFT 这个兑换码已经用过了")
    expect(s.last()).not.toContain("-2017")
    // 同一条消息中的其他兑换码照常兑换，单个失败不中断其余兑换
    expect(s.last()).toContain("USEDCODE1 兑换成功")
  })

  it("兑换只用自己的 CK：别人绑的 CK 不顶用", async () => {
    await deps.users.addUid("qq:1", "gs", OS_UID)
    // 别人那条恰好覆盖同一个 uid：只有按归属判才挡得住，按 uid 判会把它拿来用
    await deps.cookies.save(CK, { uids: { gs: [OS_UID] }, owner: "qq:2" })
    const s = makeSession({ rest: "GENSHINGIFT" })
    await useCdk(s, deps, 0)

    // 说的是「你自己还没绑」而不是「池子空了」：后者让人无从下手
    expect(s.last()).toContain("你本人的 ck")
    expect(urls.some(it => it.includes("apicdkey"))).toBe(false)
  })

  it("没绑 uid 时让人先绑账号", async () => {
    const s = makeSession({ rest: "GENSHINGIFT" })
    await useCdk(s, deps, 0)

    expect(s.last()).toContain("#绑定CK")
    expect(urls).toEqual([])
  })

  it("单次上限五个，超出部分明确提示稍后再发送", async () => {
    await bind(OS_UID)
    const s = makeSession({ rest: "AAAAAA BBBBBB CCCCCC DDDDDD EEEEEE FFFFFF" })
    await useCdk(s, deps, 0)

    expect(s.said[0]?.match(/兑换成功/g)).toHaveLength(5)
    expect(s.last()).toContain("最多兑换 5 个")
  })

  it("非兑换码形态的输入即时指出，不额外发出请求", async () => {
    await bind(OS_UID)
    const s = makeSession({ rest: "我的兑换码" })
    await useCdk(s, deps, 0)

    expect(s.last()).toContain("不像兑换码")
    expect(urls.some(it => it.includes("apicdkey"))).toBe(false)
  })

  it("什么都没带时给一句引导", async () => {
    const s = makeSession()
    await useCdk(s, deps, 0)

    expect(s.last()).toContain("GENSHINGIFT")
  })
})
