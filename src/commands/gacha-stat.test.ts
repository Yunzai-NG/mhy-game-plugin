/**
 * 模块职责：抽卡分析 / 统计 / 复刻统计三条命令的测试
 * 依赖方向：测试文件，依赖 commands/gacha-stat.ts 与真实的 GachaStore / UserStore / PoolTable
 * 生命周期：无状态
 * 注意事项：固定四项口径：绝区零补了卡池表后同样支持（按频段编号切分）、没有记录时给出下一步操作、
 *          未装元数据时仍出文字（不出一张空框图）、`#全部统计` 确实把多个卡池合起来算。三条命令都
 *          只读本地库，故不需要假 HTTP。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { MhyConfigView } from "../config.js"
import { CONFIG_SCHEMA } from "../config.js"
import { PoolTable } from "../meta/pool.js"
import type { Session } from "../core/session.js"
import type { GachaRecord } from "../store/gacha.js"
import { GachaStore } from "../store/gacha.js"
import { UserStore } from "../store/user.js"
import type { MhyDeps } from "./deps.js"
import { bannerStat, gachaDetail, gachaStat, pickPool } from "./gacha-stat.js"

/** 固定的"现在"：2026-08-22 */
const NOW = new Date(2026, 7, 22, 12, 0, 0).getTime()

/** 假卡池表：胡桃在 6.0 上半 UP */
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

/** 假绝区零卡池表：雅在 1.4 上半 UP（独家频段） */
const ZZZ_POOL = {
  pool: [
    {
      version: "1.4",
      half: "上半",
      from: "2026-08-01 06:00:00",
      to: "2026-08-21 17:59:59",
      char5: ["雅"],
      weapon5: ["星流霜华"]
    }
  ],
  mix: [],
  name: { 雅: "霜华绽落" }
}

/** 默认配置，由 schema 现算 —— 抄一份的话每加一个配置项都要跟着改 */
const CONFIG: MhyConfigView = {
  ...CONFIG_SCHEMA.parse({}),
  metaHost: "https://example.invalid"
}

/** 静默日志器，用框架自带的那个 */
const LOGGER = fakeLogger()

/** 假会话，记录所有回复 */
interface Spy extends Session {
  /** 收到的全部回复 */
  readonly said: string[]
  /** 最后一句回复 */
  last(): string
}

/** 造一个假会话 */
function makeSession(init: Partial<Session> = {}): Spy {
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
    // 未装元数据时命令层不会走出图分支，此处恒返回 false，逼它退回文字
    image: async (): Promise<boolean> => false,
    ask: async (): Promise<string | undefined> => undefined,
    file: async (): Promise<{ name: string; text: string } | undefined> => undefined,
    askFile: async (): Promise<{ name: string; text: string } | undefined> => undefined,
    sendFile: async (): Promise<boolean> => true
  }
}

let dir = ""
let deps: MhyDeps
let gacha: GachaStore
let users: UserStore

/** 造一条记录 */
function rec(seq: number, over: Partial<GachaRecord> = {}): GachaRecord {
  return {
    id: `17000000000000000${String(seq).padStart(2, "0")}`,
    pool: "301",
    name: "刻晴",
    itemType: "角色",
    rank: 3,
    time: "2026-08-12 18:03:21",
    ...over
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gacha-cmd-"))
  mkdirSync(dir, { recursive: true })
  // 卡池表只从元数据读（见 meta/pool.ts 的文件头），故夹具摆成 `meta-<游戏>/info/pool.js`。
  // 键带引号即可 —— 解析器对 JSON 形态的写法原样通过
  for (const [game, table] of [
    ["gs", POOL],
    ["zzz", ZZZ_POOL]
  ] as const) {
    const at = join(dir, `meta-${game}`, "info")
    mkdirSync(at, { recursive: true })
    writeFileSync(
      join(at, "pool.js"),
      [
        `export const poolName = ${JSON.stringify(table.name ?? {})}`,
        `export const poolDetail = ${JSON.stringify(table.pool ?? [])}`,
        `export const mixPoolDetail = ${JSON.stringify(table.mix ?? [])}`,
        ""
      ].join("\n"),
      "utf8"
    )
  }

  const kv = new Kv(new MemoryKvDriver())
  gacha = new GachaStore({
    kv: kv.sub("gacha"),
    http: {} as never,
    logger: LOGGER,
    now: (): number => NOW,
    gap: (): number => 0
  })
  users = new UserStore({ kv: kv.sub("user") })
  deps = {
    mys: {} as never,
    cookies: {} as never,
    users,
    devices: {} as never,
    gacha,
    pool: new PoolTable({ metaDir: dir }),
    config: (): MhyConfigView => CONFIG,
    logger: LOGGER
  }
  await users.addUid("qq:1", "gs", "100000001")
  await users.addUid("qq:1", "zzz", "18707318")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("pickPool", () => {
  it("默认角色池", () => {
    expect(pickPool("", "gs")).toEqual({ pool: "301", mix: false })
    expect(pickPool("", "sr")).toEqual({ pool: "11", mix: false })
  })

  it("武器与光锥都指向武器池", () => {
    expect(pickPool("武器", "gs").pool).toBe("302")
    expect(pickPool("光锥", "sr").pool).toBe("12")
  })

  it("常驻与群星都指常驻池", () => {
    expect(pickPool("常驻", "gs").pool).toBe("200")
    expect(pickPool("群星", "sr").pool).toBe("1")
  })

  it("集录走另一张卡池表", () => {
    expect(pickPool("集录", "gs")).toEqual({ pool: "500", mix: true })
  })

  it("星铁的联动池是独立编号，原神没有这种形态", () => {
    expect(pickPool("联动角色", "sr")).toEqual({ pool: "21", mix: true })
    expect(pickPool("联动光锥", "sr")).toEqual({ pool: "22", mix: true })
    // 原神没有联动池，"联动"二字应被忽略而回落到角色池
    expect(pickPool("联动", "gs")).toEqual({ pool: "301", mix: false })
  })

  it("绝区零另有一套频段编号", () => {
    expect(pickPool("", "zzz")).toEqual({ pool: "2", mix: false })
    expect(pickPool("音擎", "zzz").pool).toBe("3")
    expect(pickPool("武器", "zzz").pool).toBe("3")
    expect(pickPool("常驻", "zzz").pool).toBe("1")
    expect(pickPool("邦布", "zzz").pool).toBe("5")
  })
})

describe("gachaDetail", () => {
  it("绝区零补了卡池表后可用 —— 有独家频段记录时报出抽数", async () => {
    await gacha.importRecords("qq:1", "zzz", "18707318",[
      rec(3, { pool: "2", name: "安比", itemType: "代理人" }),
      rec(2, { pool: "2", name: "妮可", itemType: "代理人" }),
      rec(1, { pool: "2", name: "雅", itemType: "代理人", rank: 5, time: "2026-08-05 12:00:00" })
    ])
    const s = makeSession({ game: "zzz" })
    await gachaDetail(s, deps)
    // 绝区零照样受理；未装元数据时退回文字，报出总抽数
    expect(s.said.join("\n")).not.toContain("不支持")
    expect(s.said.join("\n")).toContain("共 3 抽")
  })

  it("没有记录时说清下一步", async () => {
    const s = makeSession()
    await gachaDetail(s, deps)
    expect(s.last()).toContain("抽卡记录")
  })

  it("**绑了别人的 uid 读不到他的抽卡记录** —— 记录按「用户 + uid」分键，各存各的", async () => {
    // 别人（qq:2）名下这条 uid 的记录
    await gacha.importRecords("qq:2", "gs", "100000001", [rec(1, { rank: 5, name: "胡桃" })])
    // qq:1 虽绑了同一个 uid，但自己名下这条 uid 没有记录
    const s = makeSession()
    await gachaDetail(s, deps)
    expect(s.last()).toContain("抽卡记录")
    expect(s.said.join("\n")).not.toContain("胡桃")
  })

  it("自己名下有记录才读得到 —— 与他人同一 uid 的记录互不相干", async () => {
    await gacha.importRecords("qq:2", "gs", "100000001", [rec(1, { rank: 5, name: "可莉" })])
    await gacha.importRecords("qq:1", "gs", "100000001", [rec(2, { rank: 5, name: "胡桃" })])
    const s = makeSession()
    await gachaDetail(s, deps)
    // 只应出 qq:1 自己那条，不串到 qq:2 的
    expect(s.said.join("\n")).not.toContain("可莉")
  })

  it("出图数据里 face 恒为对象，模板不会再读到 undefined.banner", async () => {
    await gacha.importRecords("qq:1", "gs", "100000001",[rec(1, { rank: 5, name: "胡桃" })])
    let captured: Record<string, unknown> | undefined
    const s = makeSession()
    // 命令层先查 meta.loader.ready 才走出图分支，故给一个"就绪但查不到图"的假 loader；
    // 截获传给模板的数据：face 必须是对象，不传则模板读 undefined.banner 而出图失败
    const fakeLoader = {
      ready: (): boolean => true,
      byName: (): undefined => undefined,
      exists: (): boolean => false
    }
    deps.meta = { loader: fakeLoader as never, installer: {} as never, reload: (): void => undefined }
    s.image = async (_tpl: string, data: Record<string, unknown>): Promise<boolean> => {
      captured = data
      return true
    }
    await gachaDetail(s, deps)

    expect(captured?.["face"]).toBeTypeOf("object")
    const face = captured?.["face"] as { banner?: unknown; face?: unknown; name?: unknown }
    expect(face).toHaveProperty("banner")
    expect(face).toHaveProperty("face")
    expect(face.name).toBe("100000001")
  })

  it("有记录时报出总抽数与出金", async () => {
    await gacha.importRecords("qq:1", "gs", "100000001",[
      rec(3),
      rec(2),
      rec(1, { name: "胡桃", rank: 5, time: "2026-08-05 12:00:00" })
    ])
    const s = makeSession()
    await gachaDetail(s, deps)
    expect(s.said.join("\n")).toContain("共 3 抽")
  })

  it("未装元数据时先说明再出文字 —— 出一张空框图更让人困惑", async () => {
    await gacha.importRecords("qq:1", "gs", "100000001",[rec(1, { name: "胡桃", rank: 5 })])
    const s = makeSession()
    await gachaDetail(s, deps)
    expect(s.said.join("\n")).toContain("元数据")
  })

  it("卡池表缺失时说清是哪里的问题", async () => {
    const s = makeSession()
    await gachaDetail(s, { ...deps, pool: new PoolTable({ metaDir: join(dir, "nope") }) })
    expect(s.last()).toContain("卡池版本表")
  })
})

describe("gachaStat", () => {
  it("没有记录时说清下一步", async () => {
    const s = makeSession()
    await gachaStat(s, deps)
    expect(s.last()).toContain("抽卡记录")
  })

  it("按版本切分统计", async () => {
    await gacha.importRecords("qq:1", "gs", "100000001",[
      rec(2, { name: "胡桃", rank: 5, time: "2026-08-05 12:00:00" }),
      rec(1)
    ])
    const s = makeSession()
    await gachaStat(s, deps)
    expect(s.said.join("\n")).toContain("6.0")
  })

  it("全部统计把多个卡池合起来算", async () => {
    await gacha.importRecords("qq:1", "gs", "100000001",[
      rec(2, { pool: "301", name: "胡桃", rank: 5, time: "2026-08-05 12:00:00" }),
      rec(1, { pool: "302", name: "护摩之杖", itemType: "武器", rank: 5, time: "2026-08-06 12:00:00" })
    ])
    const s = makeSession({ rest: "全部" })
    await gachaStat(s, deps)
    // 两个池各一发金，合并统计应报出 2 个金
    expect(s.said.join("\n")).toContain("金卡 2 个")
  })

  it("绝区零补了卡池表后可用 —— 按版本切分独家频段", async () => {
    await gacha.importRecords("qq:1", "zzz", "18707318",[
      rec(2, { pool: "2", name: "雅", itemType: "代理人", rank: 5, time: "2026-08-05 12:00:00" }),
      rec(1, { pool: "2", name: "安比", itemType: "代理人" })
    ])
    const s = makeSession({ game: "zzz" })
    await gachaStat(s, deps)
    expect(s.said.join("\n")).not.toContain("不支持")
    expect(s.said.join("\n")).toContain("1.4")
  })
})

describe("bannerStat", () => {
  it("不带名字时给全表", async () => {
    const s = makeSession()
    await bannerStat(s, deps)
    expect(s.said.join("\n")).toContain("复刻统计")
  })

  it("带名字时只给那一个", async () => {
    const s = makeSession({ rest: "胡桃" })
    await bannerStat(s, deps)
    expect(s.said.join("\n")).toContain("胡桃")
  })

  it("名字查不到时说清查不到，而不是给一张空表", async () => {
    // 名字里刻意不含「角色」「武器」一类类型词：那些词会被剥掉，因为
    // `#五星角色复刻` 要列出全部五星角色，而不是查一个叫"角色"的角色
    const s = makeSession({ rest: "莫得此人" })
    await bannerStat(s, deps)
    expect(s.last()).toContain("莫得此人")
  })

  it("绝区零补了卡池表后可用 —— 复刻统计不再回不支持", async () => {
    const s = makeSession({ game: "zzz" })
    await bannerStat(s, deps)
    expect(s.said.join("\n")).not.toContain("不支持")
    expect(s.said.join("\n")).toContain("复刻统计")
  })

  it("绝区零按名字查某位代理人的历次 UP", async () => {
    const s = makeSession({ game: "zzz", rest: "雅" })
    await bannerStat(s, deps)
    expect(s.said.join("\n")).toContain("雅")
  })
})
