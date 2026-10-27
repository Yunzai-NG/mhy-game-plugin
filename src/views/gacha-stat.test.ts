/**
 * 模块职责：抽卡分析与版本统计的测试
 * 依赖方向：测试文件，依赖 views/gacha-stat.ts 与一份临时卡池表
 * 生命周期：无状态
 * 注意事项：固定四项口径：垫抽从最早一条往后数、卡池表未覆盖的时段不计入「歪」（否则新版本刚开
 *          那几天每一发都显示歪）、出金率排除当前垫抽那一段（那几抽还没有结果）、元数据缺失时仍
 *          能出数（少一个图标不该让整条命令失败）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PoolTable } from "../meta/pool.js"
import type { GachaRecord } from "../store/gacha.js"
import { gachaDetailData, gachaDetailText, gachaStatData, gachaStatText } from "./gacha-stat.js"

/** 固定的"现在"：2026-08-22 13:20 */
const NOW = new Date(2026, 7, 22, 13, 20, 0).getTime()

/** 临时卡池表目录 */
let dir = ""

/** 两个版本的卡池表：5.0 上半 UP 胡桃，5.0 下半 UP 钟离 */
const TABLE = {
  pool: [
    {
      version: "5.0",
      half: "上半",
      from: "2026-08-01 06:00:00",
      to: "2026-08-10 17:59:59",
      char5: ["胡桃"],
      char4: ["行秋"],
      weapon5: ["护摩之杖"]
    },
    {
      version: "5.0",
      half: "下半",
      from: "2026-08-10 18:00:00",
      to: "2026-08-20 14:59:59",
      char5: ["钟离"],
      char4: ["北斗"],
      weapon5: ["贯虹之槊"]
    }
  ],
  mix: [
    {
      version: "5.0",
      half: "上半",
      title: "晨风之诗",
      from: "2026-08-01 06:00:00",
      to: "2026-08-20 14:59:59",
      char5: ["优菈"],
      weapon5: []
    }
  ],
  name: { 胡桃: "赤团开时" }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mhy-gstat-"))
  // 卡池表只从元数据读（见 meta/pool.ts 的文件头），故夹具摆成 `meta-gs/info/pool.js` 那副形态
  const at = join(dir, "meta-gs", "info")
  mkdirSync(at, { recursive: true })
  writeFileSync(
    join(at, "pool.js"),
    [
      `export const poolName = ${JSON.stringify(TABLE.name)}`,
      `export const poolDetail = ${JSON.stringify(TABLE.pool)}`,
      `export const mixPoolDetail = ${JSON.stringify(TABLE.mix)}`,
      ""
    ].join("\n"),
    "utf8"
  )
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 造一份上下文 */
function ctx(): { game: "gs"; uid: string; pool: PoolTable; now: number } {
  return { game: "gs", uid: "100000001", pool: new PoolTable({ metaDir: dir }), now: NOW }
}

/**
 * 造一条记录
 *
 * id 一律 19 位并按序号递增，使排序稳定。
 * @param n 序号，越大越新
 * @param over 要覆盖的字段
 * @returns 记录
 */
function rec(n: number, over: Partial<GachaRecord> = {}): GachaRecord {
  return {
    id: `170000000000000${String(1000 + n)}`,
    pool: "301",
    name: "琴",
    itemType: "角色",
    rank: 3,
    time: "2026-08-05 12:00:00",
    ...over
  }
}

describe("gachaDetailData 垫抽", () => {
  it("垫抽从最早一条往后数 —— 反着数出来的保底进度是错的", () => {
    // 三三三金：这一发用了 4 抽
    const records = [
      rec(4, { name: "胡桃", rank: 5, time: "2026-08-05 12:00:00" }),
      rec(3),
      rec(2),
      rec(1)
    ]
    const data = gachaDetailData(records, ctx())
    const gacha = data?.["gacha"] as { fiveLog: Record<string, { count: number; isUp: boolean }[]> }
    expect(gacha.fiveLog["2026"]?.[0]?.count).toBe(4)
  })

  it("末尾补一条「已抽 N 未出金」，即当前保底进度", () => {
    // 出金后又抽了两发
    const records = [rec(3), rec(2), rec(1, { name: "胡桃", rank: 5 })]
    const data = gachaDetailData(records, ctx())
    const gacha = data?.["gacha"] as { fiveLog: Record<string, { id: string; count: number }[]> }
    // 占位那条排在最前，count 即当前垫抽
    expect(gacha.fiveLog["2026"]?.[0]?.id).toBe("888")
    expect(gacha.fiveLog["2026"]?.[0]?.count).toBe(2)
  })

  it("一发五星都没出过时，全部抽数都算垫抽", () => {
    const data = gachaDetailData([rec(2), rec(1)], ctx())
    const stat = (data?.["gacha"] as { stat: Record<string, unknown> }).stat
    expect(stat["fiveNum"]).toBe(0)
    expect(stat["noFiveNum"]).toBe(2)
  })

  it("一发金都没出时平均出金与 UP 花费印「-」，占位那条不带图 —— 0 读起来像「0 抽就出金」", () => {
    const data = gachaDetailData([rec(2), rec(1)], ctx())
    const gacha = data?.["gacha"] as { stat: Record<string, unknown>; items: Record<string, { img: string }> }
    expect(gacha.stat["fiveAvg"]).toBe("-")
    expect(gacha.stat["upYs"]).toBe("-")
    expect(gacha.items["888"]?.img).toBe("")
  })

  it("同一年内的五星按时间倒序 —— 新的排在上，与年份倒序方向一致", () => {
    const records = [
      rec(1, { name: "胡桃", rank: 5, time: "2026-03-18 12:00:00" }),
      rec(2),
      rec(3, { name: "刻晴", rank: 5, time: "2026-08-12 12:00:00" })
    ]
    const data = gachaDetailData(records, ctx())
    const gacha = data?.["gacha"] as { fiveLog: Record<string, { date: string }[]> }
    expect(gacha.fiveLog["2026"]?.map(it => it.date)).toEqual(["08-12", "03-18"])
  })
})

describe("gachaDetailData UP 判定", () => {
  it("当期 UP 记为 up，不计入歪", () => {
    const data = gachaDetailData([rec(1, { name: "胡桃", rank: 5, time: "2026-08-05 12:00:00" })], ctx())
    const gacha = data?.["gacha"] as { stat: Record<string, unknown>; fiveLog: Record<string, { isUp: boolean }[]> }
    expect(gacha.fiveLog["2026"]?.[0]?.isUp).toBe(true)
    expect(gacha.stat["wai"]).toBe(0)
  })

  it("同一时段抽到别的五星记为歪", () => {
    const data = gachaDetailData([rec(1, { name: "刻晴", rank: 5, time: "2026-08-05 12:00:00" })], ctx())
    const gacha = data?.["gacha"] as { stat: Record<string, unknown>; fiveLog: Record<string, { isUp: boolean }[]> }
    expect(gacha.fiveLog["2026"]?.[0]?.isUp).toBe(false)
    expect(gacha.stat["wai"]).toBe(1)
  })

  it("卡池表没覆盖到的时段不计入歪 —— 新版本刚开那几天否则每发都显示歪", () => {
    // 2026-09 已超出表中最后一个版本，落进兜底版本（UP 名单为空）
    const data = gachaDetailData([rec(1, { name: "某新角色", rank: 5, time: "2026-09-05 12:00:00" })], ctx())
    const gacha = data?.["gacha"] as { stat: Record<string, unknown> }
    expect(gacha.stat["fiveNum"]).toBe(1)
    expect(gacha.stat["wai"]).toBe(0)
  })

  it("集录池查另一张表", () => {
    // 优菈在集录表里是 UP，在常规表里不是
    const data = gachaDetailData([rec(1, { pool: "500", name: "优菈", rank: 5, time: "2026-08-05 12:00:00" })], ctx(), true)
    const gacha = data?.["gacha"] as { fiveLog: Record<string, { isUp: boolean }[]> }
    expect(gacha.fiveLog["2026"]?.[0]?.isUp).toBe(true)
  })
})

describe("gachaDetailData 统计量", () => {
  it("平均出金排除当前垫抽那一段 —— 那几抽还没有结果", () => {
    // 两发金各用 2 抽，之后又抽了 3 发没出金
    const records = [
      rec(7),
      rec(6),
      rec(5),
      rec(4, { name: "钟离", rank: 5, time: "2026-08-15 12:00:00" }),
      rec(3),
      rec(2, { name: "胡桃", rank: 5, time: "2026-08-05 12:00:00" }),
      rec(1)
    ]
    const data = gachaDetailData(records, ctx())
    const stat = (data?.["gacha"] as { stat: Record<string, unknown> }).stat
    expect(stat["allNum"]).toBe(7)
    // 结算部分 4 抽出 2 金，故平均 2.00；若把垫抽的 3 抽算进分子会得 3.50
    expect(stat["fiveAvg"]).toBe("2.00")
  })

  it("四星出得最多的那个能报出来", () => {
    const records = [
      rec(3, { name: "行秋", rank: 4 }),
      rec(2, { name: "行秋", rank: 4 }),
      rec(1, { name: "北斗", rank: 4 })
    ]
    const data = gachaDetailData(records, ctx())
    const max = (data?.["gacha"] as { maxFour: { name: string; count: number } }).maxFour
    expect(max.name).toBe("行秋")
    expect(max.count).toBe(2)
  })

  it("没有记录时返回 undefined，命令层据此提示还没导入", () => {
    expect(gachaDetailData([], ctx())).toBeUndefined()
  })

  it("元数据缺失时仍出数，图标留空", () => {
    const data = gachaDetailData([rec(1, { name: "胡桃", rank: 5 })], ctx())
    const items = (data?.["gacha"] as { items: Record<string, { img: string; abbr: string }> }).items
    // 没有元数据，故落到占位 id，简称回落成全名
    expect(Object.values(items)[0]?.img).toBe("")
    expect(Object.values(items).some(it => it.abbr === "胡桃")).toBe(true)
  })
})

describe("gachaStatData", () => {
  it("按版本切分 —— 两个版本各成一块", () => {
    const records = [
      rec(3, { name: "钟离", rank: 5, time: "2026-08-15 12:00:00" }),
      rec(2, { time: "2026-08-15 12:00:00" }),
      rec(1, { name: "胡桃", rank: 5, time: "2026-08-05 12:00:00" })
    ]
    const data = gachaStatData(records, ctx())
    const list = (data?.["gacha"] as { versionData: Record<string, unknown>[] }).versionData
    expect(list).toHaveLength(2)
    // 新版本在前
    expect(list[0]?.["version"]).toBe("5.0下半")
  })

  it("UP 与非 UP 分开计数", () => {
    const records = [
      rec(2, { name: "刻晴", rank: 5, time: "2026-08-05 12:00:00" }),
      rec(1, { name: "胡桃", rank: 5, time: "2026-08-05 12:00:00" })
    ]
    const data = gachaStatData(records, ctx())
    const total = (data?.["gacha"] as { totalStat: Record<string, number> }).totalStat
    expect(total["star5Num"]).toBe(2)
    expect(total["upNum"]).toBe(1)
  })

  it("hasVersion 为假时并成一块 —— 常驻池没有版本概念", () => {
    const records = [rec(2, { pool: "200", time: "2026-08-15 12:00:00" }), rec(1, { pool: "200" })]
    const data = gachaStatData(records, ctx(), { hasVersion: false, title: "常驻池" })
    const list = (data?.["gacha"] as { versionData: Record<string, unknown>[] }).versionData
    expect(list).toHaveLength(1)
    expect(list[0]?.["version"]).toBe("常驻池")
  })

  it("没有记录时返回 undefined", () => {
    expect(gachaStatData([], ctx())).toBeUndefined()
  })
})

describe("绝区零的星级刻度", () => {
  /*
   * 绝区零那一路的星级是 B / A / S 三档，接口与元数据都记作 2 / 3 / 4，而原神星铁是 3 / 4 / 5。
   * 不折算的表现不是报错，而是**一个五星都数不出来** —— 真机上「429 抽 0 出金」正是这么来的，
   * 四星、五星那两块图也一并整块为空。
   *
   * 本组用例一律按**接口真给的刻度**写（S 记 4、A 记 3）：照原神刻度写 `rank: 5` 的假数据
   * 折不折算都通得过，钉不住这一条。
   */

  /** 绝区零的上下文，卡池表借用同一份（只判星级，与 UP 名单无关） */
  function zzzCtx(): { game: "zzz"; uid: string; pool: PoolTable; now: number } {
    return { game: "zzz", uid: "18707318", pool: new PoolTable({ metaDir: dir }), now: NOW }
  }

  it("S 级记作 4 也算出金 —— 否则 429 抽会报成 0 出金", () => {
    const records = [
      rec(3, { pool: "2", name: "雅", itemType: "代理人", rank: 4, time: "2026-08-05 12:00:00" }),
      rec(2, { pool: "2", name: "安比", itemType: "代理人", rank: 2 }),
      rec(1, { pool: "2", name: "妮可", itemType: "代理人", rank: 2 })
    ]
    const data = gachaDetailData(records, zzzCtx())
    const gacha = data?.["gacha"] as { stat: Record<string, unknown>; fiveLog: Record<string, unknown[]> }
    expect(gacha.stat["fiveNum"]).toBe(1)
    // 那一发用了 3 抽；恒为 0 即说明这一条 S 级没被认成出金
    expect(gacha.fiveLog["2026"]).toHaveLength(1)
  })

  it("A 级记作 3 落到四星那一档，B 级记作 2 不算", () => {
    const records = [
      rec(3, { pool: "2", name: "苍角", itemType: "代理人", rank: 3 }),
      rec(2, { pool: "2", name: "苍角", itemType: "代理人", rank: 3 }),
      rec(1, { pool: "2", name: "安比", itemType: "代理人", rank: 2 })
    ]
    const data = gachaDetailData(records, zzzCtx())
    const max = (data?.["gacha"] as { maxFour: { name: string; count: number } }).maxFour
    expect(max.name).toBe("苍角")
    expect(max.count).toBe(2)
  })

  it("版本统计里 S 级计入金卡数", () => {
    const records = [
      rec(2, { pool: "2", name: "雅", itemType: "代理人", rank: 4, time: "2026-08-05 12:00:00" }),
      rec(1, { pool: "2", name: "安比", itemType: "代理人", rank: 2, time: "2026-08-05 12:00:00" })
    ]
    const data = gachaStatData(records, zzzCtx())
    const total = (data?.["gacha"] as { totalStat: Record<string, number> }).totalStat
    expect(total["star5Num"]).toBe(1)
  })

  it("原神星铁的刻度一动不动 —— 折算只对绝区零生效", () => {
    // 同一条 `rank: 4` 在原神那一路仍是四星，不该被抬成五星
    const data = gachaDetailData([rec(1, { name: "行秋", rank: 4 })], ctx())
    const gacha = data?.["gacha"] as { stat: Record<string, unknown> }
    expect(gacha.stat["fiveNum"]).toBe(0)
  })
})

describe("文字回退", () => {
  it("分析：总抽数、金卡数与平均出金都在", () => {
    const data = gachaDetailData([rec(2), rec(1, { name: "胡桃", rank: 5 })], ctx())
    const text = gachaDetailText(data ?? {})
    expect(text).toContain("共 2 抽")
    expect(text).toContain("出金 1")
  })

  it("统计：逐版本列出抽数", () => {
    const data = gachaStatData([rec(1, { name: "胡桃", rank: 5, time: "2026-08-05 12:00:00" })], ctx())
    expect(gachaStatText(data ?? {})).toContain("5.0上半")
  })

  it("空数据不炸", () => {
    expect(() => gachaDetailText({})).not.toThrow()
    expect(() => gachaStatText({})).not.toThrow()
  })
})
