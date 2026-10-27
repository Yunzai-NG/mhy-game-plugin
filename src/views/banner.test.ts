/**
 * 模块职责：复刻统计视图的测试
 * 依赖方向：测试文件，依赖 views/banner.ts 与 meta/pool.ts（读临时目录里的假卡池表）
 * 生命周期：无状态
 * 注意事项：本文件固定三项口径：**常驻恒有的角色不计入复刻**（`ALWAYS_UP`）、
 *          **按距今间隔降序**（越久没复刻的排越前，这正是使用者要看的），以及
 *          **未开始的池子标 `daysStar`** —— 模板据它区分"当期 UP"与"下期 UP"。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PoolTable } from "../meta/pool.js"
import type { BannerContext } from "./banner.js"
import { ALWAYS_UP, bannerAllData, bannerSingleData, bannerSingleText, bannerText } from "./banner.js"

/** 固定的"现在"：2026-08-22 */
const NOW = new Date(2026, 7, 22, 12, 0, 0).getTime()

let dir = ""

/**
 * 造一份假卡池表
 *
 * 三个版本：胡桃两次 UP（5.0 与 6.0），钟离一次（5.5），刻晴在 5.5 也 UP 但它在
 * `ALWAYS_UP` 里，用于验证黑名单确实生效。
 */
const POOL = {
  pool: [
    {
      version: "5.0",
      half: "上半",
      from: "2026-01-01 06:00:00",
      to: "2026-01-21 17:59:59",
      char5: ["胡桃"],
      char4: ["行秋"],
      weapon5: ["护摩之杖"],
      weapon4: ["笛剑"]
    },
    {
      version: "5.5",
      half: "上半",
      from: "2026-04-01 06:00:00",
      to: "2026-04-21 17:59:59",
      char5: ["钟离", "刻晴"],
      char4: ["北斗"],
      weapon5: ["贯虹之槊"],
      weapon4: ["钟剑"]
    },
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
  mix: [
    {
      version: "5.3",
      half: "下半",
      title: "玉岩之忆",
      from: "2026-03-01 06:00:00",
      to: "2026-03-21 17:59:59",
      char5: ["优菈"],
      weapon5: ["雾切之回光"]
    }
  ],
  name: { 胡桃: "赤团开时", 钟离: "陵薮市朝" }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "banner-test-"))
  // 卡池表只从元数据读（见 meta/pool.ts 的文件头），故夹具要摆成 `meta-gs/info/pool.js` 那副形态。
  // 键带引号即可 —— 解析器对 JSON 形态的写法原样通过，不必逐行手拼
  const at = join(dir, "meta-gs", "info")
  mkdirSync(at, { recursive: true })
  writeFileSync(
    join(at, "pool.js"),
    [
      `export const poolName = ${JSON.stringify(POOL.name)}`,
      `export const poolDetail = ${JSON.stringify(POOL.pool)}`,
      `export const mixPoolDetail = ${JSON.stringify(POOL.mix)}`,
      ""
    ].join("\n"),
    "utf8"
  )
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 造上下文
 * @returns 上下文
 */
function ctx(): BannerContext {
  return { game: "gs", pool: new PoolTable({ metaDir: dir }), now: NOW }
}

describe("bannerSingleData", () => {
  it("胡桃两次 UP，版本表新的在前", () => {
    const data = bannerSingleData("胡桃", "char", ctx())
    expect(data?.["count"]).toBe(2)
    const list = data?.["version_list"] as { version: string }[]
    expect(list[0]?.version).toBe("6.0")
    expect(list[1]?.version).toBe("5.0")
  })

  it("卡池标题取自当期 UP 五星的卡池名", () => {
    const data = bannerSingleData("胡桃", "char", ctx())
    const list = data?.["version_list"] as { title: string[] }[]
    expect(list[0]?.title).toEqual(["赤团开时"])
  })

  it("diffDay 是与上一次 UP 的间隔，最早那次没有它", () => {
    const data = bannerSingleData("胡桃", "char", ctx())
    const list = data?.["version_list"] as { diffDay?: number }[]
    // 5.0 结束 2026-01-21 到 6.0 开始 2026-08-01，约 192 天
    expect(list[0]?.diffDay).toBeGreaterThan(180)
    // 最早一次之前没有记录，故不给该字段，模板显示"首次 UP"
    expect(list[1]?.diffDay).toBeUndefined()
  })

  it("daysDiff 为距今天数 —— 刚结束一天", () => {
    const data = bannerSingleData("胡桃", "char", ctx())
    // 6.0 于 2026-08-21 结束，现在是 08-22
    expect(data?.["daysDiff"]).toBe(1)
  })

  it("角色与武器分开查 —— 同名不会串", () => {
    const data = bannerSingleData("护摩之杖", "weapon", ctx())
    expect(data?.["count"]).toBe(2)
    expect(data?.["type"]).toBe("weapon")
  })

  it("四星也能查 —— 它同样会 UP", () => {
    const data = bannerSingleData("行秋", "char", ctx())
    expect(data?.["count"]).toBe(1)
  })

  it("从未 UP 过时返回 undefined，命令层据此说查不到", () => {
    expect(bannerSingleData("不存在的角色", "char", ctx())).toBeUndefined()
  })

  it("武器那栏取 icon、角色取 face —— 只取 face 会让武器图整块空白", () => {
    const meta = {
      byName: (_g: string, n: string) =>
        n === "护摩之杖" ? { name: n, icon: "meta-gs/weapon/长柄武器/护摩之杖/icon.webp" } : { name: n, face: "meta-gs/character/胡桃/imgs/face.webp" }
    } as unknown as NonNullable<BannerContext["meta"]>
    const data = bannerSingleData("胡桃", "char", { ...ctx(), meta })
    const list = data?.["version_list"] as { weapon: { name: string; icon: string }[]; char: { name: string; icon: string }[] }[]
    expect(list.some(v => v.weapon.some(w => w.icon.endsWith("护摩之杖/icon.webp")))).toBe(true)
    expect(list.some(v => v.char.some(c => c.icon.endsWith("face.webp")))).toBe(true)
  })
})

describe("bannerAllData", () => {
  it("按距今间隔降序 —— 越久没复刻的排越前", () => {
    const data = bannerAllData("char", 5, ctx())
    const list = (data["data"] as { name: string }[]).map(it => it.name)
    // 集录池一并计入（它把 mixPoolDetail 也推进同一张表），故顺序为
    // 优菈（3 月，集录）→ 钟离（4 月）→ 胡桃（8 月）
    expect(list).toEqual(["优菈", "钟离", "胡桃"])
  })

  it("集录池的 UP 也算复刻 —— 两张表并在一起统计", () => {
    const data = bannerAllData("char", 5, ctx())
    const eula = (data["data"] as { name: string; version: string }[]).find(it => it.name === "优菈")
    // 半场名后缀着 `(混池)` —— 列表里据此
    // 一眼能看出这一次 UP 来自集录池而非常规池
    expect(eula?.version).toBe("5.3下半(混池)")
  })

  it("常驻恒有的角色不计入 —— 刻晴在黑名单里", () => {
    const data = bannerAllData("char", 5, ctx())
    const names = (data["data"] as { name: string }[]).map(it => it.name)
    expect(names).not.toContain("刻晴")
    expect(ALWAYS_UP).toContain("刻晴")
  })

  it("count 是 UP 过的次数，version 记最近一次", () => {
    const data = bannerAllData("char", 5, ctx())
    const hutao = (data["data"] as { name: string; count: number; version: string }[]).find(it => it.name === "胡桃")
    expect(hutao?.count).toBe(2)
    // 升序遍历，故收尾于最新一次
    expect(hutao?.version).toBe("6.0上半")
  })

  it("四星与五星分开统计", () => {
    const four = bannerAllData("char", 4, ctx())
    const names = (four["data"] as { name: string }[]).map(it => it.name)
    expect(names).toContain("行秋")
    expect(names).not.toContain("胡桃")
  })

  it("武器池的类型名按游戏区分 —— 星铁叫光锥", () => {
    expect(bannerAllData("weapon", 5, ctx())["type"]).toBe("武器")
    const sr = { game: "sr" as const, pool: new PoolTable({ metaDir: dir }), now: NOW }
    expect(bannerAllData("weapon", 5, sr)["type"]).toBe("光锥")
  })

  it("当期仍在开放的记进 new_pool", () => {
    // 把"现在"挪到 6.0 开放期内
    const during = { game: "gs" as const, pool: new PoolTable({ metaDir: dir }), now: new Date(2026, 7, 10).getTime() }
    const data = bannerAllData("char", 5, during)
    expect(data["new_pool"]).toMatchObject({ name: ["胡桃"] })
  })

  it("尚未开始的池子标 daysStar，不算当期", () => {
    // 把"现在"挪到 6.0 开始之前
    const before = { game: "gs" as const, pool: new PoolTable({ metaDir: dir }), now: new Date(2026, 6, 25).getTime() }
    const data = bannerAllData("char", 5, before)
    const hutao = (data["data"] as { name: string; daysStar?: number }[]).find(it => it.name === "胡桃")
    expect(hutao?.daysStar).toBeLessThan(0)
    // 未开始的不算"当期 UP"
    expect((data["new_pool"] as { name: string[] }).name).not.toContain("胡桃")
  })

  it("卡池表为空时不炸，只是列表为空", () => {
    const empty = mkdtempSync(join(tmpdir(), "banner-empty-"))
    try {
      const data = bannerAllData("char", 5, { game: "gs", pool: new PoolTable({ metaDir: empty }), now: NOW })
      expect(data["data"]).toEqual([])
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

describe("文字回退", () => {
  it("复刻统计列出次数与距今间隔", () => {
    const text = bannerText(bannerAllData("char", 5, ctx()))
    expect(text).toContain("5 星角色复刻统计")
    expect(text).toContain("钟离")
    expect(text).toContain("天未复刻")
  })

  it("卡池表空时给出可操作的提示", () => {
    const empty = mkdtempSync(join(tmpdir(), "banner-empty2-"))
    try {
      const data = bannerAllData("char", 5, { game: "gs", pool: new PoolTable({ metaDir: empty }), now: NOW })
      expect(bannerText(data)).toContain("更新元数据")
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it("单个条目列出每次 UP 的版本", () => {
    const data = bannerSingleData("胡桃", "char", ctx())
    const text = bannerSingleText(data ?? {})
    expect(text).toContain("胡桃 共复刻 2 次")
    expect(text).toContain("6.0")
    expect(text).toContain("首次 UP")
  })

  it("仍在开放时说「当前 UP」而不是「已 N 天未复刻」", () => {
    const during = { game: "gs" as const, pool: new PoolTable({ metaDir: dir }), now: new Date(2026, 7, 10).getTime() }
    const data = bannerSingleData("胡桃", "char", during)
    expect(bannerSingleText(data ?? {})).toContain("当前 UP")
  })
})
