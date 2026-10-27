/**
 * 模块职责：抽卡命令的测试
 * 依赖方向：测试文件，依赖 commands/gacha.ts 与真实的 GachaStore / PoolTable（跑在内存 KV 上）
 * 生命周期：每个用例一套新 KV
 * 注意事项：固定这几项：**群聊中一律不受理抽卡链接**（authkey 等同于凭据）、`#更新抽卡记录`
 *          只做更新且按卡池报新增条数（文字不出图，时间轴归 gacha-stat.test.ts）、**删除链接
 *          不删除记录**，以及 stoken 自助换取 authkey 的那几条。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import type { HttpClient, HttpRequestOptions } from "@yunzai-ng/types"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CookiePool } from "../store/ck.js"
import { MysClient } from "../core/client.js"
import type { MhyConfigView } from "../config.js"
import { CONFIG_SCHEMA } from "../config.js"
import { DeviceStore } from "../core/device.js"
import { GachaStore } from "../store/gacha.js"
import { PoolTable } from "../meta/pool.js"
import { MysService } from "../service/mys.js"
import { AuthKeyService } from "../service/authkey.js"
import type { Session } from "../core/session.js"
import { UserStore } from "../store/user.js"
import type { MhyDeps } from "./deps.js"
import { dropGachaLink, gachaLink, gachaUpdate } from "./gacha.js"

/** 测试用 uid */
const UID = "100000001"

/** 一条正常的原神抽卡链接 */
const LINK = "https://webstatic.mihoyo.com/hk4e/event/e20190909gacha/index.html?authkey_ver=1&region=cn_gf01&authkey=abc%3d%3d#/log"

/** 假卡池表：胡桃在 6.0 上半 UP，覆盖测试记录的时段（`#抽卡记录` 出时间轴要它判 UP/歪） */
const POOL = {
  pool: [
    {
      version: "6.0",
      half: "上半",
      from: "2026-08-01 06:00:00",
      to: "2026-08-21 17:59:59",
      char5: ["胡桃"],
      char4: ["香菱"],
      weapon5: ["护摩之杖"],
      weapon4: ["西风剑"]
    }
  ],
  mix: [],
  name: { 胡桃: "赤团开时" }
}

/** 默认配置，由 schema 现算 —— 抄一份的话每加一个配置项都要跟着改 */
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
const makeSession = (init: Partial<Session> & { answer?: string } = {}): Spy => {
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
    ask: async (): Promise<string | undefined> => init.answer,
    file: init.file ?? (async (): Promise<undefined> => undefined),
    askFile: async (): Promise<undefined> => undefined,
    sendFile: init.sendFile ?? (async (): Promise<boolean> => false)
  }
}

/**
 * 造一个假 HTTP：`get` 供抽卡记录翻页用（原神角色池两条记录，一条五星），
 * `request` 供 genAuthKey 换 authkey 用
 * @param retcode 想让抽卡接口返回的码
 * @param authOk genAuthKey 是否成功；false 时回 10001（stoken 失效）
 * @returns 客户端
 */
const makeHttp = (retcode = 0, authOk = true): HttpClient => {
  const fail = (): never => {
    throw new Error("测试只用 get 与 genAuthKey 的 request")
  }
  const rows = [
    { id: "1000000002", gacha_type: "301", name: "钟离", item_type: "角色", rank_type: "5", time: "2026-08-02 12:00:00", uid: UID },
    { id: "1000000001", gacha_type: "301", name: "冷刃", item_type: "武器", rank_type: "3", time: "2026-08-01 12:00:00", uid: UID }
  ]

  return {
    request: async <T>(url: string): Promise<T> => {
      if (!url.includes("genAuthKey")) fail()
      return (
        authOk
          ? { ok: true, status: 200, data: { retcode: 0, message: "OK", data: { authkey: "auto-authkey==" } } }
          : { ok: true, status: 200, data: { retcode: 10001, message: "登录失效", data: null } }
      ) as T
    },
    get: async <T>(_url: string, opts: Omit<HttpRequestOptions, "method"> = {}): Promise<T> => {
      const query = (opts.query ?? {}) as Record<string, unknown>
      if (retcode !== 0) return { retcode, message: "authkey timeout", data: null } as T
      const list = String(query["gacha_type"]) === "301" && String(query["end_id"] ?? "0") === "0" ? rows : []
      return { retcode: 0, message: "OK", data: { region: "cn_gf01", list } } as T
    },
    post: fail,
    buffer: fail,
    download: fail,
    extend: fail
  }
}

describe("抽卡命令", () => {
  let deps: MhyDeps
  let clock: number
  let poolDir: string

  /**
   * 组一套依赖
   * @param retcode 假抽卡接口返回码
   * @param authOk genAuthKey 是否成功
   * @returns 依赖包
   */
  const build = (retcode = 0, authOk = true): MhyDeps => {
    const kv = new Kv(new MemoryKvDriver())
    const logger = fakeLogger()
    const http = makeHttp(retcode, authOk)
    const devices = new DeviceStore({ kv: kv.sub("device"), logger })
    const cookies = new CookiePool({
      kv: kv.sub("cookie"),
      logger,
      devices
    })
    const users = new UserStore({ kv: kv.sub("user") })
    const client = new MysClient({ http, logger, devices })
    return {
      mys: new MysService({ client, cookies, users, logger }),
      cookies,
      users,
      devices,
      gacha: new GachaStore({ kv: kv.sub("gacha"), http, logger, gap: (): number => 0, now: (): number => clock }),
      authKey: new AuthKeyService({ http, devices, logger }),
      // #抽卡记录 现在出「出金时间轴」，与 #抽卡分析 同一条渲染路径，故要卡池表判 UP/歪
      pool: new PoolTable({ metaDir: poolDir }),
      config: (): MhyConfigView => CONFIG,
      logger
    }
  }

  beforeEach(() => {
    clock = Date.parse("2026-08-22T10:00:00Z")
    poolDir = mkdtempSync(join(tmpdir(), "gacha-cmd-"))
    // 卡池表只从元数据读（见 meta/pool.ts 的文件头），故摆成 `meta-gs/info/pool.js`
    const poolAt = join(poolDir, "meta-gs", "info")
    mkdirSync(poolAt, { recursive: true })
    writeFileSync(
      join(poolAt, "pool.js"),
      [
        `export const poolName = ${JSON.stringify(POOL.name ?? {})}`,
        `export const poolDetail = ${JSON.stringify(POOL.pool ?? [])}`,
        `export const mixPoolDetail = ${JSON.stringify(POOL.mix ?? [])}`,
        ""
      ].join("\n"),
      "utf8"
    )
    deps = build()
  })

  afterEach(() => {
    rmSync(poolDir, { recursive: true, force: true })
  })

  it("群里发链接：拒绝、提醒撤回，且一个字都不落库", async () => {
    const s = makeSession({ isPrivate: false, rest: LINK })
    await gachaLink(s, deps)

    expect(s.last()).toContain("立刻撤回")
    expect(s.last()).toContain("只能私聊")
    expect(await deps.gacha.auth("qq:1", "gs", UID)).toBeUndefined()
  })

  it("私聊发链接：收下、当场同步、一并把 uid 绑上", async () => {
    const s = makeSession({ rest: LINK })
    await gachaLink(s, deps)

    expect(s.last()).toContain("同步完成")
    expect(s.last()).toContain("新增 2 条")
    expect(await deps.users.uid("qq:1", "gs")).toBe(UID)
  })

  it("未携带链接时追问一次，使用者无须先查阅命令格式", async () => {
    const s = makeSession({ answer: LINK })
    await gachaLink(s, deps)

    expect(s.last()).toContain("同步完成")
  })

  it("链接失效时明确说明原因，并附上复制位置", async () => {
    deps = build(-101)
    const s = makeSession({ rest: LINK })
    await gachaLink(s, deps)

    expect(s.last()).toContain("链接已失效")
    expect(s.last()).toContain("历史记录")
  })

  it("#更新抽卡记录 按卡池报新增条数（文字，不出图）", async () => {
    await gachaLink(makeSession({ rest: LINK }), deps)
    // 首次已同步 2 条；再更新一次应报"已是最新"
    const s = makeSession()
    await gachaUpdate(s, deps)

    expect(s.last()).toContain("已是最新")
    expect(s.last()).toContain("本地共 2 条")
    // 引导去看时间轴
    expect(s.last()).toContain("抽卡记录")
  })

  it("#更新抽卡记录 首次拉取：逐卡池列出新增，合计与累计都对", async () => {
    // 先绑好 uid 与 authkey，但本地还没有记录
    await deps.users.addUid("qq:1", "gs", UID)
    await deps.gacha.saveAuthKey("qq:1", "gs", "k==", "cn_gf01", UID)
    const s = makeSession()
    await gachaUpdate(s, deps)

    expect(s.last()).toContain("「角色活动祈愿」新增 2 条")
    expect(s.last()).toContain("合计新增 2 条")
  })

  it("#更新抽卡记录 没有任何链接时给手贴引导", async () => {
    const s = makeSession()
    await gachaUpdate(s, deps)

    expect(s.last()).toContain("历史记录")
  })

  it("#切换uid 之后更新的是新的 uid —— 前一个 uid 那份未过期的链接不会被拿来用", async () => {
    const OTHER = "100000002"
    // UID 的链接落库并成为当前 uid，随后绑上 OTHER（新绑的即为当前）
    await gachaLink(makeSession({ rest: LINK }), deps)
    await deps.users.addUid("qq:1", "gs", OTHER)

    const s = makeSession()
    await gachaUpdate(s, deps)

    // OTHER 没有自己的链接、名下也没有 stoken：点名 OTHER 给手贴引导，而不是拿 UID 的链接去更新 UID
    expect(s.last()).toContain(`${OTHER} 还没有可用的抽卡链接`)
    expect((await deps.gacha.records("qq:1", "gs", OTHER, "301")).length).toBe(0)

    // 切回 UID：用的是它自己那份链接
    await deps.users.switchUid("qq:1", "gs", UID)
    const back = makeSession()
    await gachaUpdate(back, deps)
    expect(back.last()).toContain(`${UID} 的抽卡记录已是最新`)
  })

  it("#切换uid 之后新 uid 名下有 stoken：替它自助换一份链接，记录落在新 uid 下", async () => {
    const OTHER = "100000002"
    await gachaLink(makeSession({ rest: LINK }), deps)
    await deps.cookies.save("ltuid=999;ltoken=abc;cookie_token=def;account_id=999;", {
      owner: "qq:1",
      uids: { gs: [OTHER] }
    })
    await deps.cookies.setStoken("999", "stuid=999;stoken=v2_x;mid=m1_y;")
    await deps.users.addUid("qq:1", "gs", OTHER)

    const s = makeSession()
    await gachaUpdate(s, deps)

    expect(s.last()).toContain(`${OTHER} 更新完成`)
    expect((await deps.gacha.auth("qq:1", "gs", OTHER))?.authkey).toBe("auto-authkey==")
    expect((await deps.gacha.records("qq:1", "gs", OTHER, "301")).length).toBe(2)
    // UID 那份链接原样留着，没被覆盖
    expect((await deps.gacha.auth("qq:1", "gs", UID))?.authkey).toBe("abc==")
  })

  it("删链接只删凭据，记录还在", async () => {
    await gachaLink(makeSession({ rest: LINK }), deps)
    const s = makeSession()
    await dropGachaLink(s, deps)

    expect(s.last()).toContain("抽卡记录还留着")
    expect(await deps.gacha.auth("qq:1", "gs", UID)).toBeUndefined()
    expect((await deps.gacha.records("qq:1", "gs", UID, "301")).length).toBe(2)
  })

  /**
   * 给使用者名下放一条带 stoken 的自有 CK，并绑好这条 uid
   * @param deps 依赖
   * @param withStoken 是否写入 stoken；false 时只有 CK 没有 stoken
   */
  const seedStokenCk = async (deps: MhyDeps, withStoken = true): Promise<void> => {
    await deps.cookies.save("ltuid=999;ltoken=abc;cookie_token=def;account_id=999;", {
      owner: "qq:1",
      uids: { gs: [UID] }
    })
    if (withStoken) await deps.cookies.setStoken("999", "stuid=999;stoken=v2_x;mid=m1_y;")
    await deps.users.addUid("qq:1", "gs", UID)
  }

  it("没链接但名下有 stoken：自动换取 authkey 再同步，报新增", async () => {
    await seedStokenCk(deps)
    const s = makeSession()
    await gachaUpdate(s, deps)

    expect(s.last()).toContain("新增 2 条")
    // authkey 已落库，下次可直接增量
    expect(await deps.gacha.auth("qq:1", "gs", UID)).toBeDefined()
  })

  it("自动换取在群聊同样可用 —— 凭据早在库、并未在此传输", async () => {
    await seedStokenCk(deps)
    const s = makeSession({ isPrivate: false })
    await gachaUpdate(s, deps)

    expect(s.last()).toContain("新增 2 条")
    expect(await deps.gacha.auth("qq:1", "gs", UID)).toBeDefined()
  })

  it("stoken 失效(10001)时说清是 stoken 失效，且不落任何 authkey", async () => {
    deps = build(0, false)
    await seedStokenCk(deps)
    const s = makeSession()
    await gachaUpdate(s, deps)

    expect(s.last()).toContain("stoken 已失效")
    expect(await deps.gacha.auth("qq:1", "gs", UID)).toBeUndefined()
  })

  it("名下没有带 stoken 的账号时不自动换取，给手贴引导", async () => {
    await seedStokenCk(deps, false)
    const s = makeSession()
    await gachaUpdate(s, deps)

    // 没有 stoken 就不自动换取：不落 authkey，退回手贴链接引导
    expect(await deps.gacha.auth("qq:1", "gs", UID)).toBeUndefined()
    expect(s.last()).toContain("历史记录")
  })
})
