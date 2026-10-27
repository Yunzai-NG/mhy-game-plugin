/**
 * 模块职责：`#日历` / `#活动` 的测试
 * 依赖方向：测试文件，依赖 commands/calendar、真实的 MetaLoader / MaterialTable / PoolTable
 *          （夹具写在临时目录里）与 CalendarService（HTTP 是假的）
 * 生命周期：每个用例一套新临时目录与新 KV
 * 注意事项：固定四处：绝区零照样受理、公告取不到时不出图、缺元数据仍出图、星铁公告缺跃迁时由
 *          卡池表顶上。**必须钉住"现在"** —— 命令层取系统时间而夹具窗口是写死的日期，不钉则
 *          窗口一过期这些用例就随真实日期自行失效。只伪造 `Date` 而不碰 `setTimeout`：一并
 *          伪造会让实现里的 `await` 永远等不到，表现为用例整体挂住。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import type { HttpClient } from "@yunzai-ng/types"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RenderDress } from "../core/render.js"
import type { Session } from "../core/session.js"
import { MetaLoader } from "../meta/loader.js"
import type { MetaLoaderOptions } from "../meta/loader.js"
import { MaterialTable } from "../meta/material.js"
import { PoolTable } from "../meta/pool.js"
import { CalendarService } from "../service/calendar.js"
import type { CalendarView } from "../views/calendar.js"
import { calendar, calendarChars, calendarTalents, srFakeGacha } from "./calendar.js"
import type { MhyDeps } from "./deps.js"

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

/** 材料数据：两档天赋书、一件周本材料 */
const MATERIALS = {
  "「诗文」的哲学": { id: 403, name: "「诗文」的哲学", type: "talent", star: 4 },
  "「勤劳」的哲学": { id: 402, name: "「勤劳」的哲学", type: "talent", star: 4 },
  北风的魂匣: { id: 601, name: "北风的魂匣", type: "weekly", star: 5 }
}

/** 与上面对得上的轮换表 */
const DAILY = `export default {
  talent: {
    1: [ "自由", "繁荣" ],
    2: [ "抗争", "勤劳" ],
    3: [ "诗文", "黄金" ]
  }
}
`

/** 卡池版本表，最后一条对得上下面公告里的 3.4 */
const POOL_SR = {
  pool: [
    {
      version: "3.3",
      half: "上",
      from: "2026-07-02 12:00:00",
      to: "2026-07-23 14:59:59",
      char5: ["姬子"],
      weapon5: ["于夜色中"]
    },
    {
      version: "3.4",
      half: "上",
      from: "2026-08-13 11:00:00",
      to: "2026-09-03 03:59:00",
      char5: ["三月七"],
      weapon5: ["于夜色中"]
    }
  ],
  name: { 姬子: "炎起之时", 三月七: "冰之少女" },
  mix: [] as { version: string; half: string; from: string; to: string; char5?: string[]; weapon5?: string[] }[]
}

let dir = ""

/**
 * 写一个条目目录
 * @param path 目录绝对路径
 * @param data data.json 的内容
 * @param imgs 要造的图片文件名，落在 imgs/ 下
 * @param files 要造的文件名，落在目录根下
 */
function item(
  path: string,
  data: Record<string, unknown>,
  imgs: readonly string[] = [],
  files: readonly string[] = []
): void {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, "data.json"), JSON.stringify(data), "utf8")
  if (imgs.length) mkdirSync(join(path, "imgs"), { recursive: true })
  for (const img of imgs) writeFileSync(join(path, "imgs", img), "x", "utf8")
  for (const one of files) writeFileSync(join(path, one), "x", "utf8")
}

/** 钉住的"现在"：2026-09-01 12:00（本地时区），取在各份夹具窗口的正中而非边缘 */
const NOW = new Date(2026, 8, 1, 12, 0, 0).getTime()

beforeEach(() => {
  // 只伪造 Date，理由见文件头
  vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  dir = mkdtempSync(join(tmpdir(), "mhy-calendar-cmd-"))

  item(
    join(dir, "meta-gs", "character", "钟离"),
    {
      id: 10000030,
      name: "钟离",
      abbr: "钟离",
      star: 5,
      elem: "geo",
      birth: "12-31",
      materials: { talent: "「勤劳」的哲学", weekly: "北风的魂匣" }
    },
    ["face.webp", "card.webp"]
  )
  item(
    join(dir, "meta-gs", "character", "旅行者", "anemo"),
    { id: 10000005, name: "旅行者", abbr: "空", star: 5, birth: "1-1", materials: { talent: "「勤劳」的哲学" } },
    ["face.webp"]
  )
  const mat = join(dir, "meta-gs", "material")
  mkdirSync(mat, { recursive: true })
  writeFileSync(join(mat, "data.json"), JSON.stringify(MATERIALS), "utf8")
  writeFileSync(join(mat, "daily.js"), DAILY, "utf8")

  item(join(dir, "meta-sr", "character", "三月七"), { id: 1001, name: "三月七", star: 4, elem: "冰" }, ["face.webp"])
  item(join(dir, "meta-sr", "weapon", "巡猎", "于夜色中"), { id: "23015", name: "于夜色中", star: 5 }, [], ["icon.webp"])

  // 卡池表只从元数据读（见 meta/pool.ts 的文件头）。**星铁那份是 `info/index.js` 且导出名带 Sr 后缀**
  const poolAt = join(dir, "meta-sr", "info")
  mkdirSync(poolAt, { recursive: true })
  writeFileSync(
    join(poolAt, "index.js"),
    [
      `export const poolNameSr = ${JSON.stringify(POOL_SR.name ?? {})}`,
      `export const poolDetailSr = ${JSON.stringify(POOL_SR.pool ?? [])}`,
      `export const mixPoolDetailSr = ${JSON.stringify(POOL_SR.mix ?? [])}`,
      ""
    ].join("\n"),
    "utf8"
  )
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

/** 假会话，记录回复与出图 */
interface Spy extends Session {
  /** 收到的全部文字回复 */
  readonly said: string[]
  /** 出图请求：模板名、数据与展示参数 */
  readonly drew: { template: string; data: CalendarView; dress?: RenderDress }[]
}

/**
 * 造一个假会话
 * @param rest 命令之后的内容
 * @param game 游戏
 * @param ok 出图是否成功
 * @returns 假会话
 */
function makeSession(rest = "", game: Session["game"] = "gs", ok = true): Spy {
  const said: string[] = []
  const drew: Spy["drew"] = []
  return {
    user: "qq:1",
    name: "旅行者",
    rest,
    game,
    isPrivate: true,
    isMaster: false,
    isGroupAdmin: false,
    botId: "bot-1",
    lastSent: (): string => "msg-1",
    images: [],
    said,
    drew,
    text: async (content: string): Promise<void> => void said.push(content),
    image: async (template: string, data: Record<string, unknown>, dress?: RenderDress): Promise<boolean> => {
      drew.push({ template, data: data as CalendarView, ...(dress ? { dress } : {}) })
      return ok
    },
    ask: async (): Promise<undefined> => undefined,
    file: async (): Promise<undefined> => undefined,
    askFile: async (): Promise<undefined> => undefined,
    sendFile: async (): Promise<boolean> => false,
    imageBytes: async (): Promise<boolean> => false,
    imageFile: async (): Promise<boolean> => false,
    forward: async (): Promise<boolean> => false
  }
}

/** 一份原神公告列表 */
const GS_LIST = {
  data: {
    list: [
      { list: [{ ann_id: 201, title: "「深秘之息」商店上架", start_time: "2026-08-28 11:00:00", end_time: "2026-09-08 03:59:00" }] },
      { list: [{ ann_id: 102, title: "「盛典与慧业」", start_time: "2026-08-28 11:00:00", end_time: "2026-09-07 03:59:00" }] }
    ]
  }
}

/** 一份星铁公告列表，刻意不含跃迁 */
const SR_LIST = {
  data: {
    list: [
      {
        list: [
          { ann_id: 301, title: "3.4版本更新概览", start_time: "2026-08-13 11:00:00", end_time: "2026-09-03 03:59:00" },
          { ann_id: 302, title: "「浮生逆旅」活动", start_time: "2026-08-28 11:00:00", end_time: "2026-09-07 03:59:00" }
        ]
      }
    ]
  }
}

/**
 * 造一份依赖包
 * @param opts 选项
 * @returns 依赖包
 */
function makeDeps(
  opts: { list?: unknown; withMeta?: boolean; withMats?: boolean; withPool?: boolean; withServ?: boolean } = {}
): MhyDeps {
  const http = {
    get: async <T,>(url: string): Promise<T> => {
      if (url.includes("getAnnList")) {
        const body = opts.list ?? GS_LIST
        if (body instanceof Error) throw body
        return body as T
      }
      return { data: { list: [] } } as T
    }
  } as unknown as HttpClient

  const loader = new MetaLoader({ dir, logger: LOGGER })
  const materials = new MaterialTable({ dir, logger: LOGGER as never })
  const pool = new PoolTable({ metaDir: dir })
  const serv = new CalendarService({
    http,
    kv: new Kv(new MemoryKvDriver()),
    logger: LOGGER as never,
    fix: () => false
  })

  return {
    logger: LOGGER,
    config: () => ({}) as ReturnType<MhyDeps["config"]>,
    ...((opts.withMeta ?? true) ? { meta: { loader, installer: {} as never } } : {}),
    ...((opts.withMats ?? true) ? { materials } : {}),
    ...((opts.withPool ?? true) ? { pool } : {}),
    ...((opts.withServ ?? true) ? { calendar: serv } : {})
  } as unknown as MhyDeps
}

describe("calendarChars", () => {
  it("逐个角色给出生日、天赋书与周本材料图标", () => {
    const loader = new MetaLoader({ dir, logger: LOGGER })
    const mats = new MaterialTable({ dir, logger: LOGGER as never })
    const got = calendarChars(loader, mats)
    const one = got.find(it => it.name === "钟离")

    expect(one).toMatchObject({
      id: "10000030",
      name: "钟离",
      star: 5,
      face: "meta-gs/character/钟离/imgs/face.webp",
      birth: "12-31",
      talent: "「勤劳」的哲学",
      weekly: "meta-gs/material/weekly/北风的魂匣.webp"
    })
  })

  it("展示名取简称 —— 格子只有 65px 宽", () => {
    const got = calendarChars(new MetaLoader({ dir, logger: LOGGER }))

    expect(got.find(one => one.id === "10000005")?.name).toBe("空")
  })

  it("旅行者带上 isMain 标记 —— 天赋书那一块不收他", () => {
    const got = calendarChars(new MetaLoader({ dir, logger: LOGGER }))

    expect(got.find(one => one.id === "10000005")?.isMain).toBe(true)
    expect(got.find(one => one.id === "10000030")).not.toHaveProperty("isMain")
  })

  it("没有材料表时不写周本那一键，其余照常", () => {
    const got = calendarChars(new MetaLoader({ dir, logger: LOGGER }))

    expect(got.find(one => one.name === "钟离")).not.toHaveProperty("weekly")
    expect(got.find(one => one.name === "钟离")?.talent).toBe("「勤劳」的哲学")
  })

  it("元数据没装时给空数组", () => {
    expect(calendarChars(new MetaLoader({ dir: join(dir, "无"), logger: LOGGER }))).toEqual([])
  })
})

describe("calendarTalents", () => {
  /** 材料表 */
  const mats = (): MaterialTable => new MaterialTable({ dir, logger: LOGGER as never })

  it("只要今天那一档的四星天赋书", () => {
    const got = calendarTalents(mats(), { sunday: false, week: 2, label: "周二/周五" })

    expect(got.map(one => one.name)).toEqual(["「勤劳」的哲学"])
    expect(got[0]).toMatchObject({ abbr: "勤劳", city: "璃月", cid: 2, week: 2 })
  })

  it("周日三个副本全开，全部四星天赋书都收", () => {
    const got = calendarTalents(mats(), { sunday: true, week: 0, label: "周日" })

    expect(got.map(one => one.name).sort()).toEqual(["「勤劳」的哲学", "「诗文」的哲学"])
  })

  it("那一档没有书时给空数组", () => {
    expect(calendarTalents(mats(), { sunday: false, week: 1, label: "周一/周四" })).toEqual([])
  })
})

describe("srFakeGacha", () => {
  it("每个版本两条：角色池与光锥池", () => {
    const got = srFakeGacha(new PoolTable({ metaDir: dir }), new MetaLoader({ dir, logger: LOGGER }))

    expect(got).toHaveLength(4)
    expect(got[2]?.title).toBe("角色活动跃迁：「冰之少女」")
    expect(got[3]?.title).toBe("光锥活动跃迁：「流光定影」")
  })

  it("角色头像与光锥图都取自元数据", () => {
    const got = srFakeGacha(new PoolTable({ metaDir: dir }), new MetaLoader({ dir, logger: LOGGER }))

    expect(got[2]?.banner2).toEqual(["meta-sr/character/三月七/imgs/face.webp"])
    expect(got[3]?.banner3).toEqual(["meta-sr/weapon/巡猎/于夜色中/icon.webp"])
  })

  it("起止取卡池表里那个版本的起止", () => {
    const got = srFakeGacha(new PoolTable({ metaDir: dir }), new MetaLoader({ dir, logger: LOGGER }))

    expect(got[2]?.start_time).toBe("2026-08-13 11:00:00")
    expect(got[2]?.end_time).toBe("2026-09-03 03:59:00")
  })

  it("查不到的角色只少一张图，标题仍带卡池名", () => {
    const got = srFakeGacha(new PoolTable({ metaDir: dir }), new MetaLoader({ dir, logger: LOGGER }))

    expect(got[0]?.title).toBe("角色活动跃迁：「炎起之时」")
    expect(got[0]?.banner2).toEqual([])
  })
})

describe("calendar", () => {
  it("原神出图，倍率交给 calendar.css 而不在命令层再给一份", async () => {
    const s = makeSession()
    await calendar(s, makeDeps())

    expect(s.drew).toHaveLength(1)
    expect(s.drew[0]?.template).toBe("wiki/calendar")
    expect(s.drew[0]?.dress).toBeUndefined()
    expect(s.said).toEqual([])
  })

  it("活动与普通公告都进去了，深渊单独一层", async () => {
    const s = makeSession()
    await calendar(s, makeDeps())
    const view = s.drew[0]?.data

    expect(view?.list.flat().map(one => one.id)).toEqual([102, 201])
    expect(view?.abyss.length).toBeGreaterThan(0)
  })

  it("原神多出生日与今日天赋书两块", async () => {
    const s = makeSession()
    await calendar(s, makeDeps())
    const view = s.drew[0]?.data

    // 生日在窗口里才出现，故这里只校验"每一天都有一格"这件事
    expect(Object.keys(view?.charBirth ?? {})).toHaveLength(13)
    expect(Array.isArray(view?.charTalent)).toBe(true)
  })

  it("带「列表」时只换展示形态", async () => {
    const s = makeSession("列表")
    await calendar(s, makeDeps())

    expect(s.drew[0]?.data.displayMode).toBe("list")
  })

  it("不带时是整张日历", async () => {
    const s = makeSession()
    await calendar(s, makeDeps())

    expect(s.drew[0]?.data.displayMode).toBe("calendar")
  })

  it("没装元数据也出图，只是那两块空着", async () => {
    const s = makeSession("", "gs")
    await calendar(s, makeDeps({ withMeta: false, withMats: false }))

    expect(s.drew).toHaveLength(1)
    expect(s.drew[0]?.data.charTalent).toEqual([])
    expect(s.drew[0]?.data.list.flat().length).toBeGreaterThan(0)
  })

  it("装了元数据但没有材料表时，天赋书那一块空着", async () => {
    const s = makeSession("", "gs")
    await calendar(s, makeDeps({ withMats: false }))

    expect(s.drew[0]?.data.charTalent).toEqual([])
    expect(Object.keys(s.drew[0]?.data.charBirth ?? {})).toHaveLength(13)
  })

  it("星铁公告里没有跃迁时由卡池表顶上", async () => {
    const s = makeSession("", "sr")
    await calendar(s, makeDeps({ list: SR_LIST }))
    const types = s.drew[0]?.data.list.flat().map(one => one.type) ?? []

    expect(types).toContain("character")
    expect(types).toContain("weapon")
  })

  it("星铁的深渊按本版本开始时间对齐，三档都在", async () => {
    const s = makeSession("", "sr")
    await calendar(s, makeDeps({ list: SR_LIST }))

    expect(s.drew[0]?.data.abyss).toHaveLength(3)
    expect(s.drew[0]?.data.game).toBe("sr")
  })

  it("星铁没有卡池表时不顶，其余照常", async () => {
    const s = makeSession("", "sr")
    await calendar(s, makeDeps({ list: SR_LIST, withPool: false }))
    const types = s.drew[0]?.data.list.flat().map(one => one.type) ?? []

    expect(types).not.toContain("character")
    expect(s.drew).toHaveLength(1)
  })

  it("绝区零照样受理 —— 走自己的公告接口，取不到时与另两游戏同一句", async () => {
    const s = makeSession("", "zzz")
    await calendar(s, makeDeps({ list: new Error("boom") }))

    expect(s.said).toEqual(["取不到米游社的活动公告，请稍后重试"])
    expect(s.drew).toEqual([])
  })

  it("公告取不到时不出图，只说一句", async () => {
    const s = makeSession()
    await calendar(s, makeDeps({ list: new Error("boom") }))

    expect(s.said).toEqual(["取不到米游社的活动公告，请稍后重试"])
    expect(s.drew).toEqual([])
  })

  it("没有取数器时也说一句", async () => {
    const s = makeSession()
    await calendar(s, makeDeps({ withServ: false }))

    expect(s.said).toEqual(["日历暂不可用，请稍后重试"])
  })

  it("出图失败时退回文字形式", async () => {
    const s = makeSession("", "gs", false)
    await calendar(s, makeDeps())

    expect(s.said[0]).toContain("原神日历")
    expect(s.said[0]).toContain("「盛典与慧业」")
  })
})
