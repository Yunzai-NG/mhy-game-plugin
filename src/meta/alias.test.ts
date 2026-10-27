/**
 * 模块职责：别名表的测试
 * 依赖方向：测试文件，在临时目录里搭出元数据的布局；另读真实的 `alias.js` 作端到端验证
 * 生命周期：无状态
 * 注意事项：**别名表读的是已安装的元数据，不是随插件提交的资源**，故测试须搭出
 *          `meta-{game}/character/alias.json`（那份 JSON 由安装器落盘后就地生成）。固定四项：
 *          大小写与空白不影响查表、**跨游戏回落以请求的游戏优先**（它决定 `#三月七面板` 能不能
 *          用）、表文件缺失时不抛错、**reload 之后看得到新装的别名**（漏了它新角色的社区叫法要
 *          等重启才认得出）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildAliasIndex, parseAliasFile } from "./alias-parse.js"
import { AliasTable } from "./alias.js"
import type { AliasGame } from "./alias.js"

/** 元数据里那两份 `alias.js` 的所在，装了元数据才有 */
const REAL = process.env["MHY_REAL_META"] ?? ""

/**
 * 在临时目录里写一份别名表，摆成元数据的布局
 * @param dir 临时目录
 * @param game 游戏
 * @param index 别名表内容
 */
function writeAlias(dir: string, game: AliasGame, index: unknown): void {
  const at = join(dir, `meta-${game}`, "character")
  mkdirSync(at, { recursive: true })
  writeFileSync(join(at, "alias.json"), JSON.stringify(index), "utf8")
}

describe("AliasTable 查表", () => {
  let dir: string
  let table: AliasTable

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mhy-alias-"))
    // 键一律小写，与安装器生成的形态一致：归一在生成时做一次，不在每次查询时做
    writeAlias(dir, "gs", {
      alias: { 团长: "琴", jean: "琴", "77": "七七", 钟离: "钟离", 胡桃: "胡桃" }
    })
    writeAlias(dir, "sr", {
      alias: { 饮月君: "丹恒•饮月", 三月七: "三月七" },
      abbr: { "丹恒•饮月": "饮月君", "托帕&账账": "托帕" }
    })
    table = new AliasTable({ dir })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("两个游戏的表都装得上", () => {
    expect(table.ready("gs")).toBe(true)
    expect(table.ready("sr")).toBe(true)
  })

  it("社区叫法译回角色名", () => {
    expect(table.nameIn("gs", "团长")).toBe("琴")
    expect(table.nameIn("gs", "钟离")).toBe("钟离")
    expect(table.nameIn("sr", "饮月君")).toBe("丹恒•饮月")
  })

  it("大小写与前后空白都不影响", () => {
    // 表里存的是小写 `jean`，而使用者多半打 `Jean`
    expect(table.nameIn("gs", "Jean")).toBe("琴")
    expect(table.nameIn("gs", "  JEAN  ")).toBe("琴")
  })

  it("纯数字的别名同样认得 —— 「77」是七七最常见的写法", () => {
    expect(table.nameIn("gs", "77")).toBe("七七")
  })

  it("角色全名本身也在表里，故打全名一样查得到", () => {
    expect(table.nameIn("gs", "胡桃")).toBe("胡桃")
    expect(table.nameIn("sr", "三月七")).toBe("三月七")
  })

  it("查不到时给 undefined 而不是空串", () => {
    expect(table.nameIn("gs", "这个角色不存在")).toBeUndefined()
    expect(table.nameIn("gs", "")).toBeUndefined()
  })

  it("跨游戏回落：原神前缀也查得到星铁角色", () => {
    // 这一条决定 `#三月七面板` 可用与否 —— 相当多使用者不习惯加 `*`
    const got = table.resolve("gs", "饮月君")

    expect(got).toEqual({ name: "丹恒•饮月", game: "sr" })
  })

  it("回落时请求的游戏优先", () => {
    // `钟离` 只在原神表里，`饮月君` 只在星铁表里；两边都从自己那一侧先查
    expect(table.resolve("gs", "钟离")?.game).toBe("gs")
    expect(table.resolve("sr", "饮月君")?.game).toBe("sr")
  })

  it("两个游戏都查不到时给 undefined", () => {
    expect(table.resolve("gs", "不存在的角色")).toBeUndefined()
  })

  it("星铁的简称查得到，原神的表没有这一项", () => {
    expect(table.abbr("sr", "丹恒•饮月")).toBe("饮月君")
    expect(table.abbr("sr", "托帕&账账")).toBe("托帕")
    // 原神的简称在元数据的 data.json 里，不在别名表里
    expect(table.abbr("gs", "胡桃")).toBeUndefined()
  })

  it("reload 之后才看得到新装的别名 —— 元数据更新的落点", () => {
    expect(table.nameIn("gs", "新角色小名")).toBeUndefined()

    writeAlias(dir, "gs", { alias: { 团长: "琴", 新角色小名: "某新角色" } })
    // 未 reload 时仍是旧的：缓存在，这一步正是"更新完却查不到"的成因
    expect(table.nameIn("gs", "新角色小名")).toBeUndefined()

    table.reload()
    expect(table.nameIn("gs", "新角色小名")).toBe("某新角色")
  })
})

describe("AliasTable 表文件缺失或损坏", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mhy-alias-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("元数据整个没装时给空表，不抛错", () => {
    // 这是缺省状态：`autoInstallMeta` 为假，使用者没执行过 `#更新元数据`
    const table = new AliasTable({ dir })

    expect(table.ready("gs")).toBe(false)
    expect(table.nameIn("gs", "团长")).toBeUndefined()
    expect(table.resolve("gs", "团长")).toBeUndefined()
    expect(table.abbr("sr", "丹恒•饮月")).toBeUndefined()
  })

  it("文件解不开时按空表处理", () => {
    const at = join(dir, "meta-gs", "character")
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, "alias.json"), "{ 这不是 JSON", "utf8")
    const table = new AliasTable({ dir })

    expect(table.ready("gs")).toBe(false)
  })

  it("缺 alias 键的文件同样按空表处理，下游不必逐次判空", () => {
    writeAlias(dir, "sr", { abbr: { 甲: "乙" } })
    const table = new AliasTable({ dir })

    expect(table.ready("sr")).toBe(false)
    // abbr 仍可用：两项互不依赖
    expect(table.abbr("sr", "甲")).toBe("乙")
  })
})

describe("只有 alias.js 的手工包", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mhy-alias-src-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * 只放一份 `alias.js`，不放安装流程才会产出的 `alias.json`
   * @param game 游戏
   * @param body 文件内容
   */
  function writeSource(game: AliasGame, body: string): void {
    const at = join(dir, `meta-${game}`, "character")
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, "alias.js"), body, "utf8")
  }

  it("没有 alias.json 时就地解析 alias.js —— 造包脚本把包直接放进数据目录即这种形态", () => {
    // 手工放的包不经安装流程，故没有预解析结果；缺了它简称一并失效，
    // 而简称正是面板列表里印的那个名字
    writeSource(
      "zzz",
      'export const alias = {\n  "「11号」": "11号,Ellen"\n}\n\nexport const abbr = {\n  "「11号」": "11号"\n}\n'
    )
    const table = new AliasTable({ dir })

    expect(table.ready("zzz")).toBe(true)
    expect(table.nameIn("zzz", "ellen")).toBe("「11号」")
    expect(table.abbr("zzz", "「11号」")).toBe("11号")
  })

  it("两份都在时以 alias.json 为准 —— 那一份是安装流程的产物", () => {
    writeAlias(dir, "gs", { alias: { 团长: "琴" } })
    writeSource("gs", 'export const alias = {\n  "旅行者": "荧"\n}\n')
    const table = new AliasTable({ dir })

    expect(table.nameIn("gs", "团长")).toBe("琴")
    expect(table.nameIn("gs", "荧")).toBeUndefined()
  })

  it("alias.js 形态不认时按空表处理，而不是让每条按名字查的命令一并失败", () => {
    writeSource("zzz", "export const alias = { 安比: 计算(1) }\n")
    const table = new AliasTable({ dir })

    expect(table.ready("zzz")).toBe(false)
    expect(table.nameIn("zzz", "安比")).toBeUndefined()
  })
})

describe("武器 / 音擎简称 weaponAbbr", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mhy-alias-weapon-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * 写一份 `meta-{game}/weapon/alias.js`
   * @param game 游戏
   * @param body 文件内容
   */
  function writeWeapon(game: AliasGame, body: string): void {
    const at = join(dir, `meta-${game}`, "weapon")
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, "alias.js"), body, "utf8")
  }

  it("读 weapon/alias.js 的 abbr —— 绝区零音擎带 `「」` 与 `-`", () => {
    writeWeapon(
      "zzz",
      'export const alias = {}\n\nexport const abbr = {\n  "「月相」-朔": "月相-朔",\n  "「残响」-Ⅰ型": "残响-Ⅰ型"\n}\n'
    )
    const table = new AliasTable({ dir })

    expect(table.weaponAbbr("zzz", "「月相」-朔")).toBe("月相-朔")
    expect(table.weaponAbbr("zzz", "「残响」-Ⅰ型")).toBe("残响-Ⅰ型")
    expect(table.weaponAbbr("zzz", "不存在的音擎")).toBeUndefined()
  })

  it("只导出 abbr、没有 alias 也认 —— 原神那份音擎表就是这形态", () => {
    // gs 的 weapon/alias.js 只有 `export const abbr`，故不能走要求有 alias 导出的 parseAliasFile
    writeWeapon("gs", 'export const abbr = {\n  磐岩结绿: "绿剑",\n  "阿莫斯之弓": "阿莫斯"\n}\n')
    const table = new AliasTable({ dir })

    expect(table.weaponAbbr("gs", "磐岩结绿")).toBe("绿剑")
    expect(table.weaponAbbr("gs", "阿莫斯之弓")).toBe("阿莫斯")
  })

  it("武器表整个缺失时给 undefined，不抛错", () => {
    const table = new AliasTable({ dir })

    expect(table.weaponAbbr("zzz", "月相")).toBeUndefined()
  })

  it("reload 之后重新读武器简称", () => {
    writeWeapon("zzz", 'export const abbr = { "旧音擎": "旧" }\n')
    const table = new AliasTable({ dir })
    expect(table.weaponAbbr("zzz", "旧音擎")).toBe("旧")

    writeWeapon("zzz", 'export const abbr = { "旧音擎": "旧", "新音擎": "新" }\n')
    expect(table.weaponAbbr("zzz", "新音擎")).toBeUndefined()
    table.reload()
    expect(table.weaponAbbr("zzz", "新音擎")).toBe("新")
  })
})

describe("拿真实的 alias.js 走通整条链", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mhy-alias-real-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // 元数据是运行时下载的，没装就跳过 —— 与 alias-parse.test.ts 同一处理
  it.skipIf(!existsSync(`${REAL}/meta-gs/character/alias.js`))("解析真实文件 → 写成 alias.json → 查得到社区叫法", () => {
    const src = `${REAL}/meta-gs/character/alias.js`
    // 这一串正是安装器 `#buildAlias` 做的事，此处验它接到表上确实可用
    const parsed = parseAliasFile(readFileSync(src, "utf8"))
    expect(parsed).toBeDefined()
    writeAlias(dir, "gs", buildAliasIndex(parsed!))

    const table = new AliasTable({ dir })

    expect(table.ready("gs")).toBe(true)
    expect(table.nameIn("gs", "岩王帝君")).toBe("钟离")
    expect(table.nameIn("gs", "椰羊")).toBe("甘雨")
    // 全名与大小写归一同样经由生成的这份表生效
    expect(table.nameIn("gs", "钟离")).toBe("钟离")
    expect(table.nameIn("gs", "JEAN")).toBe("琴")
  })
})
