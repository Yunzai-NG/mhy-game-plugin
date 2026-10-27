/**
 * 模块职责：卡池版本表的测试
 * 依赖方向：测试文件，在临时目录里搭出 `meta-<游戏>/info/pool.js` 的布局
 * 生命周期：无状态
 * 注意事项：固定三项口径：**UP 判定为三态**（未覆盖时段答 `unknown` 而非 `wai`）、末尾兜底版本
 *          必须存在（新卡池刚开那几天全靠它，缺了会让每一发都显示为歪）、元数据是唯一来源。
 *          **表读不出来时一律 `unknown` 而不抛错** —— 没装、被白名单挡下、文件写坏三种同一
 *          结果，命令层据此让使用者去更新元数据。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PoolTable } from "./pool.js"

/** 造一个只有两个版本的小表，用于精确断言边界 */
const FIXTURE = {
  pool: [
    {
      version: "1.0",
      half: "上半",
      from: "2026-01-01 06:00:00",
      to: "2026-01-21 17:59:59",
      char5: ["甲角色"],
      weapon5: ["甲武器"]
    },
    {
      version: "1.1",
      half: "下半",
      from: "2026-01-21 18:00:00",
      to: "2026-02-10 14:59:59",
      char5: ["乙角色"],
      weapon5: ["乙武器"]
    }
  ],
  mix: [
    {
      version: "1.0",
      half: "上半",
      title: "集录一期",
      from: "2026-01-05 06:00:00",
      to: "2026-01-15 17:59:59",
      char5: ["集录角色"]
    }
  ],
  name: { 甲角色: "甲之诗" }
}

let dir = ""

/**
 * 在临时目录里搭出 `meta-<游戏>/info/pool.js`；键不带引号、末尾带逗号、值里有中文键，这几处
 * 正是解析器要认的
 * @param game 游戏
 * @param pools 常规池
 * @param names 角色名 → 卡池名
 * @param mixes 集录池
 */
/**
 * 在临时目录里搭出卡池表；键不带引号、末尾带逗号、值里有中文键，这几处正是解析器要认的。
 * **文件名与导出名按游戏取**：星铁是 `info/index.js` + `poolDetailSr` 一族，其余是 `info/pool.js` + `poolDetail` 一族。
 * @param game 游戏
 * @param pools 常规池
 * @param names 角色名 → 卡池名
 * @param mixes 集录池
 */
function writePool(game: string, pools: unknown[], names: Record<string, string> = {}, mixes: unknown[] = []): void {
  const at = join(dir, `meta-${game}`, "info")
  mkdirSync(at, { recursive: true })
  const rows = (list: unknown[]): string =>
    list
      .map(
        one =>
          `  {\n${Object.entries(one as Record<string, unknown>)
            .map(([key, value]) => `    ${key}: ${JSON.stringify(value)},`)
            .join("\n")}\n  }`
      )
      .join(", ")
  const nameRows = Object.entries(names)
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`)
    .join("\n")
  const sfx = game === "sr" ? "Sr" : ""
  const body = [
    "// 卡池版本表",
    `export const poolName${sfx} = {\n${nameRows}\n}`,
    `export const poolDetail${sfx} = [\n${rows(pools)}\n]`,
    `export const mixPoolDetail${sfx} = [\n${rows(mixes)}\n]`,
    ""
  ].join("\n\n")
  writeFileSync(join(at, game === "sr" ? "index.js" : "pool.js"), body, "utf8")
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mhy-pool-"))
  writePool("gs", FIXTURE.pool, FIXTURE.name, FIXTURE.mix)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 把 `2026-01-10 12:00:00` 换成毫秒，与被测模块同一套解析
 * @param text 时间字符串
 * @returns 毫秒值
 */
function at(text: string): number {
  return new Date(text.replace(/-/g, "/")).getTime()
}

describe("PoolTable versionAt", () => {
  it("落在区间内的时刻查得到版本", () => {
    const table = new PoolTable({ metaDir: dir })
    expect(table.versionAt("gs", at("2026-01-10 12:00:00"))?.version).toBe("1.0")
    expect(table.versionAt("gs", at("2026-01-25 12:00:00"))?.version).toBe("1.1")
  })

  it("两端都是闭区间：开池与收池那一秒都落进本版本", () => {
    const table = new PoolTable({ metaDir: dir })
    expect(table.versionAt("gs", at("2026-01-01 06:00:00"))?.version).toBe("1.0")
    expect(table.versionAt("gs", at("2026-01-21 17:59:59"))?.version).toBe("1.0")
    expect(table.versionAt("gs", at("2026-01-21 18:00:00"))?.version).toBe("1.1")
  })

  it("星铁读的是 info/index.js 且导出名带 Sr 后缀 —— 判错任一处都会让星铁卡池表恒空、UP 一律「无从判定」", () => {
    writePool("sr", FIXTURE.pool, FIXTURE.name, FIXTURE.mix)
    const table = new PoolTable({ metaDir: dir })

    expect(table.ready("sr")).toBe(true)
    expect(table.versionAt("sr", at("2026-01-10 12:00:00"))?.version).toBe("1.0")
    expect(table.isUp("sr", at("2026-01-10 12:00:00"), "甲角色", true)).toBe("up")
    expect(table.poolName("sr", "甲角色")).toBe("甲之诗")
  })

  it("最后一个版本之后的时刻落进兜底的「新版本」", () => {
    const table = new PoolTable({ metaDir: dir })
    // 卡池表还没更新时，新卡池那几天的记录靠这条兜住
    expect(table.versionAt("gs", at("2026-03-01 12:00:00"))?.version).toBe("新版本")
  })

  it("第一个版本之前的时刻查不到 —— 那时游戏还没开服", () => {
    const table = new PoolTable({ metaDir: dir })
    expect(table.versionAt("gs", at("2019-01-01 00:00:00"))).toBeUndefined()
  })

  it("集录池查的是另一张表", () => {
    const table = new PoolTable({ metaDir: dir })
    const mix = table.versionAt("gs", at("2026-01-10 12:00:00"), true)
    expect(mix?.title).toBe("集录一期")
    // 同一时刻在常规表里是 1.0，两张表互不干扰
    expect(table.versionAt("gs", at("2026-01-10 12:00:00"))?.version).toBe("1.0")
  })
})

describe("PoolTable isUp", () => {
  it("当期 UP 角色答 up，非当期答 wai", () => {
    const table = new PoolTable({ metaDir: dir })
    expect(table.isUp("gs", at("2026-01-10 12:00:00"), "甲角色", true)).toBe("up")
    expect(table.isUp("gs", at("2026-01-10 12:00:00"), "乙角色", true)).toBe("wai")
  })

  it("角色与武器的名单分开 —— 武器名不该在角色名单里命中", () => {
    const table = new PoolTable({ metaDir: dir })
    expect(table.isUp("gs", at("2026-01-10 12:00:00"), "甲武器", false)).toBe("up")
    expect(table.isUp("gs", at("2026-01-10 12:00:00"), "甲武器", true)).toBe("wai")
  })

  it("兜底版本的名单是空的，故答 unknown 而不是 wai", () => {
    const table = new PoolTable({ metaDir: dir })
    // 这是本模块最要紧的一条：把"不知道"算成"歪了"，新版本刚开时每一发都显示为歪
    expect(table.isUp("gs", at("2026-03-01 12:00:00"), "任何角色", true)).toBe("unknown")
  })

  it("卡池表未覆盖的时段答 unknown", () => {
    const table = new PoolTable({ metaDir: dir })
    expect(table.isUp("gs", at("2019-01-01 00:00:00"), "甲角色", true)).toBe("unknown")
  })

  it("那个游戏的表没装时一律 unknown，不抛错", () => {
    const table = new PoolTable({ metaDir: dir })
    expect(table.isUp("sr", at("2026-01-10 12:00:00"), "任何角色", true)).toBe("unknown")
    expect(table.ready("sr")).toBe(false)
  })
})

describe("PoolTable poolName", () => {
  it("查得到卡池名", () => {
    expect(new PoolTable({ metaDir: dir }).poolName("gs", "甲角色")).toBe("甲之诗")
  })

  it("查不到时 undefined", () => {
    expect(new PoolTable({ metaDir: dir }).poolName("gs", "乙角色")).toBeUndefined()
  })
})

describe("PoolTable 读不出来的那几种", () => {
  it("整份解不开时当空表处理，不炸", () => {
    const at2 = join(dir, "meta-sr", "info")
    mkdirSync(at2, { recursive: true })
    // 值是个函数调用：解析器认不出，整份放弃。星铁读的是 info/index.js（导出名带 Sr）
    writeFileSync(join(at2, "index.js"), "export const poolDetailSr = [ { version: 计算(1) } ]\n", "utf8")
    const table = new PoolTable({ metaDir: dir })

    expect(table.ready("sr")).toBe(false)
    expect(() => table.versionAt("sr", Date.now())).not.toThrow()
  })

  it("元数据根目录都没有时不抛错 —— 一次都没装过的机器就是这样", () => {
    const table = new PoolTable({ metaDir: join(dir, "从来没有") })
    expect(table.ready("gs")).toBe(false)
    expect(table.isUp("gs", at("2026-01-10 12:00:00"), "甲角色", true)).toBe("unknown")
  })

  it("三段导出都空时当没装 —— 一份空文件不该让表看着像装好了", () => {
    writePool("sr", [])
    const table = new PoolTable({ metaDir: dir })
    expect(table.ready("sr")).toBe(false)
  })
})

describe("PoolTable 元数据即唯一来源", () => {
  it("集录池那一段也读得出来 —— 它在 mixPoolDetail 里", () => {
    writePool(
      "zzz",
      [{ version: "3.3", half: "上半", from: "2026-07-29 06:00:00", to: "2026-09-08 14:59:59" }],
      {},
      [{ version: "3.3", half: "混池", from: "2026-07-29 06:00:00", to: "2026-09-08 14:59:59", char5: ["爱丽丝"] }]
    )
    const table = new PoolTable({ metaDir: dir })

    expect(table.mixVersions("zzz")).toHaveLength(1)
    expect(table.isUp("zzz", at("2026-08-01 12:00:00"), "爱丽丝", true, true)).toBe("up")
  })

  it("整部历史都从元数据来 —— 复刻统计要的是全部版本而不只是当期", () => {
    writePool("zzz", [
      { version: "1.0", half: "上半", from: "2024-07-04 10:00:00", to: "2024-07-24 11:59:59", char5: ["艾莲"] },
      { version: "1.0", half: "下半", from: "2024-07-24 12:00:00", to: "2024-08-13 14:59:59", char5: ["朱鸢"] },
      { version: "3.3", half: "上半", from: "2026-07-29 06:00:00", to: "2026-09-08 14:59:59", char5: ["蕾米埃尔"] }
    ])
    const table = new PoolTable({ metaDir: dir })

    // 三期都在（`versions` 不含末尾兜底）
    expect(table.versions("zzz")).toHaveLength(3)
    expect(table.isUp("zzz", at("2024-07-10 12:00:00"), "艾莲", true)).toBe("up")
    expect(table.isUp("zzz", at("2024-07-10 12:00:00"), "朱鸢", true)).toBe("wai")
    expect(table.isUp("zzz", at("2024-08-01 12:00:00"), "朱鸢", true)).toBe("up")
    expect(table.isUp("zzz", at("2026-08-01 12:00:00"), "蕾米埃尔", true)).toBe("up")
  })

  it("同一期里两位五星同窗时都算 UP —— 绝区零的双 S 频段", () => {
    writePool("zzz", [
      { version: "1.4", half: "上半", from: "2025-01-01 06:00:00", to: "2025-01-21 17:59:59", char5: ["雅", "悠真"] }
    ])
    const table = new PoolTable({ metaDir: dir })

    expect(table.isUp("zzz", at("2025-01-10 12:00:00"), "雅", true)).toBe("up")
    expect(table.isUp("zzz", at("2025-01-10 12:00:00"), "悠真", true)).toBe("up")
  })

  it("reload 之后才看得到新装的卡池 —— 元数据更新的落点", () => {
    const table = new PoolTable({ metaDir: dir })
    expect(table.ready("zzz")).toBe(false)

    writePool("zzz", [{ version: "3.3", half: "上半", from: "2026-07-29 06:00:00", to: "2026-09-08 14:59:59" }])
    expect(table.ready("zzz")).toBe(false)

    table.reload()
    expect(table.ready("zzz")).toBe(true)
  })
})
