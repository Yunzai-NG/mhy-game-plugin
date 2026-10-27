/**
 * 模块职责：材料表的测试
 * 依赖方向：测试文件，在临时目录里搭出 `meta-gs/material/` 的布局
 * 生命周期：无状态
 * 注意事项：固定四处：轮换信息只落在最高一阶上、**低阶材料的登记不能覆盖高阶**（天赋书的最高阶
 *          在自己的 `items` 里也出现一次，写反次序会把带 week 的那份冲掉，于是一个角色都排不出
 *          来）、星级阶梯高阶在前、daily.js 缺失时不抛错。另两个游戏那一支按桶分组、桶内按材料
 *          id 索引，无轮换与阶梯；三份索引不能串，串了的表现是查原神的材料查到星铁的图。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MaterialTable } from "./material.js"

/** 一份完整的材料元数据所在，装了元数据才有 */
const REAL = process.env["MHY_REAL_META"] ?? ""

/** 一份够用的材料数据：蒙德的三档天赋书之一，加一件武器材料与一件不轮换的材料 */
const DATA = {
  "「诗文」的哲学": {
    id: 403,
    name: "「诗文」的哲学",
    type: "talent",
    star: 4,
    items: {
      "「自由」的教导": { id: 421, name: "「自由」的教导", type: "talent", star: 2 },
      "「抗争」的指引": { id: 452, name: "「抗争」的指引", type: "talent", star: 3 },
      "「诗文」的哲学": { id: 403, name: "「诗文」的哲学", type: "talent", star: 4 }
    }
  },
  "「勤劳」的哲学": { id: 402, name: "「勤劳」的哲学", type: "talent", star: 4 },
  高塔孤王的碎梦: { id: 504, name: "高塔孤王的碎梦", type: "weapon", star: 5 },
  常燃火种: { id: 201, name: "常燃火种", type: "boss", star: 4 }
}

/** 与 DATA 对得上的轮换表 */
const DAILY = `export default {
  talent: {
    1: [ "自由", "繁荣" ],
    2: [ "抗争", "勤劳" ],
    3: [ "诗文", "黄金" ]
  },
  weapon: {
    1: [ "高塔孤王" ]
  }
}
`

/** 简称表，只有原神有这个文件 */
const ABBR = `export const abbr = {
  // 周本
  "恒常机关之心": "恒常之心"
}
`

/** 一份星铁材料数据：按四个桶分组、桶内按 id 索引，`type` 是突破位次 */
const SR_DATA = {
  normal: { "29328": { id: 29328, type: 101, name: "信用点", star: 3 } },
  char: {
    "67219": { id: 67219, type: 201, name: "风雪之角", star: 4 },
    "110400": { id: 110400, type: 201, name: "深邃的星外质", star: 5 }
  },
  material: { "635675": { id: 635675, type: 301, name: "此间寻梦", star: 3 } }
}

/** 一份绝区零材料数据：与星铁同形，桶名按用途分 */
const ZZZ_DATA = {
  skill: { "100133": { id: "100133", type: "skill", name: "特化电击芯片", star: 3 } },
  promote: { "100231": { id: "100231", type: "promote", name: "先行者认证章", star: 3 } },
  special: { "100941": { id: "100941", type: "special", name: "「仓鼠笼」访问器", star: 4 } }
}

/** 绝区零那份包带简称表 */
const ZZZ_ABBR = `export const abbr = {
  "「仓鼠笼」访问器": "仓鼠笼访问器"
}
`

/**
 * 在临时目录里搭出材料元数据
 * @param dir 临时目录
 * @param daily 轮换表内容；不传则不写这个文件
 * @param abbr 简称表内容；不传则不写这个文件
 */
function writeMeta(dir: string, daily?: string, abbr?: string): void {
  const at = join(dir, "meta-gs", "material")
  mkdirSync(at, { recursive: true })
  writeFileSync(join(at, "data.json"), JSON.stringify(DATA), "utf8")
  if (daily !== undefined) writeFileSync(join(at, "daily.js"), daily, "utf8")
  if (abbr !== undefined) writeFileSync(join(at, "abbr.js"), abbr, "utf8")
}

/**
 * 在临时目录里搭出星铁的材料元数据
 * @param dir 临时目录
 */
function writeSrMeta(dir: string): void {
  const at = join(dir, "meta-sr", "material")
  mkdirSync(at, { recursive: true })
  writeFileSync(join(at, "data.json"), JSON.stringify(SR_DATA), "utf8")
}

/** 一个只收不看的日志器 */
const logger = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {}
} as unknown as ConstructorParameters<typeof MaterialTable>[0]["logger"]

describe("MaterialTable 有轮换表", () => {
  let dir: string
  let table: MaterialTable

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mhy-material-"))
    writeMeta(dir, DAILY)
    table = new MaterialTable({ dir, logger })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("装得上", () => {
    expect(table.ready()).toBe(true)
  })

  it("天赋书按书名号取简称，并查到周期与国家", () => {
    const got = table.get("「诗文」的哲学")

    expect(got?.abbr).toBe("诗文")
    expect(got?.week).toBe(3)
    expect(got?.city).toBe("蒙德")
    expect(got?.cid).toBe(1)
    expect(got?.source).toBe("周三/周六")
  })

  it("第二列是璃月，周期号跟着轮换表", () => {
    const got = table.get("「勤劳」的哲学")

    expect(got?.week).toBe(2)
    expect(got?.city).toBe("璃月")
    expect(got?.cid).toBe(2)
    expect(got?.source).toBe("周二/周五")
  })

  it("武器材料取前四字作简称，同样查得到轮换", () => {
    const got = table.get("高塔孤王的碎梦")

    expect(got?.abbr).toBe("高塔孤王")
    expect(got?.week).toBe(1)
    expect(got?.source).toBe("周一/周四")
  })

  it("不轮换的材料没有周期，也不给它编国家", () => {
    const got = table.get("常燃火种")

    expect(got?.week).toBeUndefined()
    expect(got?.city).toBeUndefined()
    expect(got?.source).toBe("")
  })

  it("图标按类别与全名拼，相对元数据根目录", () => {
    expect(table.get("「诗文」的哲学")?.icon).toBe("meta-gs/material/talent/「诗文」的哲学.webp")
    expect(table.get("常燃火种")?.icon).toBe("meta-gs/material/boss/常燃火种.webp")
  })

  it("低阶材料也在表里，但不带轮换信息", () => {
    const got = table.get("「自由」的教导")

    expect(got?.star).toBe(2)
    expect(got?.week).toBeUndefined()
  })

  it("最高一阶的轮换信息没被自己的 items 冲掉 —— 冲掉的话一个角色都排不出来", () => {
    // 「诗文」的哲学 在自己的 items 里也占一格，登记次序反了就会退化成一条无 week 的记录
    expect(table.get("「诗文」的哲学")?.week).toBe(3)
  })

  it("星级阶梯高阶在前", () => {
    expect(table.ladder("「诗文」的哲学")).toEqual([
      "meta-gs/material/talent/「诗文」的哲学.webp",
      "meta-gs/material/talent/「抗争」的指引.webp",
      "meta-gs/material/talent/「自由」的教导.webp"
    ])
  })

  it("没有 items 的材料阶梯为空", () => {
    expect(table.ladder("常燃火种")).toEqual([])
  })

  it("查不到的名字给 undefined 而非抛错", () => {
    expect(table.get("并不存在的材料")).toBeUndefined()
    expect(table.get("")).toBeUndefined()
  })

  it("标题冠上国家名 —— 同一档三个副本只有国家名区分得开", () => {
    expect(table.get("「诗文」的哲学")?.label).toBe("蒙德·诗文")
    expect(table.get("高塔孤王的碎梦")?.label).toBe("蒙德·高塔孤王")
  })

  it("不轮换的材料没有国家，标题就是简称", () => {
    expect(table.get("常燃火种")?.label).toBe("常燃火种")
  })

  it("原神的突破位次与类别同值 —— 星铁那边才是数字", () => {
    expect(table.get("「诗文」的哲学")?.poseType).toBe("talent")
    expect(table.get("常燃火种")?.poseType).toBe("boss")
  })

  it("each 列出一类材料 —— 日历要「今天能刷的天赋书有哪几本」，那与角色无关", () => {
    const names = table.each("talent").map(one => one.name)

    expect(names).toContain("「诗文」的哲学")
    expect(names).toContain("「勤劳」的哲学")
    expect(names).not.toContain("高塔孤王的碎梦")
  })

  it("each 把低阶也给出来 —— 调用方按 star 自己筛，因为只有最高一阶带 week", () => {
    const four = table.each("talent").filter(one => one.star === 4)

    expect(table.each("talent").some(one => one.name === "「自由」的教导")).toBe(true)
    expect(four.map(one => one.name).sort()).toEqual(["「勤劳」的哲学", "「诗文」的哲学"])
    expect(four.every(one => one.week !== undefined)).toBe(true)
  })

  it("each 每个条目只出现一次 —— 高阶在自己的 items 里也占一格", () => {
    const names = table.each("talent").map(one => one.name)

    expect(new Set(names).size).toBe(names.length)
  })

  it("each 查不认识的类别给空数组", () => {
    expect(table.each("并不存在的类别")).toEqual([])
  })

  it("each 分游戏 —— 星铁的桶名才是它的类别", () => {
    expect(table.each("talent", "sr")).toEqual([])
  })
})

describe("MaterialTable 的简称表", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mhy-material-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("非天赋书 / 武器材料的简称去 abbr.js 里查", () => {
    // DATA 里没有恒常机关之心，另写一份带它的数据
    const at = join(dir, "meta-gs", "material")
    mkdirSync(at, { recursive: true })
    writeFileSync(
      join(at, "data.json"),
      JSON.stringify({ 恒常机关之心: { id: 1, name: "恒常机关之心", type: "weekly", star: 5 } }),
      "utf8"
    )
    writeFileSync(join(at, "abbr.js"), ABBR, "utf8")
    const table = new MaterialTable({ dir, logger })

    expect(table.get("恒常机关之心")?.abbr).toBe("恒常之心")
    expect(table.get("恒常机关之心")?.label).toBe("恒常之心")
  })

  it("没有简称表时用全名，不报错", () => {
    writeMeta(dir, DAILY)
    const table = new MaterialTable({ dir, logger })

    expect(table.get("常燃火种")?.abbr).toBe("常燃火种")
  })

  it("简称表语法坏掉时也只是用全名", () => {
    writeMeta(dir, DAILY, "export const abbr = { 甲: 123 }")
    const table = new MaterialTable({ dir, logger })

    expect(table.ready()).toBe(true)
    expect(table.get("常燃火种")?.abbr).toBe("常燃火种")
  })

  it("天赋书与武器材料不查简称表 —— 它们的简称由书名号与前四字定", () => {
    writeMeta(dir, DAILY, 'export const abbr = { "「诗文」的哲学": "不该用这个" }')
    const table = new MaterialTable({ dir, logger })

    expect(table.get("「诗文」的哲学")?.abbr).toBe("诗文")
  })
})

describe("MaterialTable 的星铁那一支", () => {
  let dir: string
  let table: MaterialTable

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mhy-material-"))
    writeSrMeta(dir)
    table = new MaterialTable({ dir, logger })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("装得上，且与原神各占一份缓存", () => {
    expect(table.ready("sr")).toBe(true)
    expect(table.ready("gs")).toBe(false)
  })

  it("按 id 查得到 —— 星铁角色的 cost 里只给 id，缺这条路材料一栏整个空着", () => {
    expect(table.byId("67219", "sr")?.name).toBe("风雪之角")
    expect(table.byId(29328, "sr")?.name).toBe("信用点")
  })

  it("按名字也查得到", () => {
    expect(table.get("风雪之角", "sr")?.star).toBe(4)
  })

  it("类别取桶名，突破位次取那个数字 type", () => {
    const got = table.get("风雪之角", "sr")

    expect(got?.type).toBe("char")
    expect(got?.poseType).toBe("201")
  })

  it("图标按桶名分目录", () => {
    expect(table.get("信用点", "sr")?.icon).toBe("meta-sr/material/normal/信用点.webp")
  })

  it("星铁没有简称表，标题就是全名", () => {
    expect(table.get("深邃的星外质", "sr")?.label).toBe("深邃的星外质")
  })

  it("星铁没有轮换与阶梯", () => {
    expect(table.get("风雪之角", "sr")?.week).toBeUndefined()
    expect(table.get("风雪之角", "sr")?.items).toBeUndefined()
  })

  it("查原神的名字查不到星铁的材料，反之亦然 —— 两份索引不能串", () => {
    expect(table.get("风雪之角", "gs")).toBeUndefined()
    expect(table.byId("67219", "gs")).toBeUndefined()
  })
})

describe("MaterialTable 的绝区零那一支", () => {
  let dir: string
  let table: MaterialTable

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mhy-material-"))
    const at = join(dir, "meta-zzz", "material")
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, "data.json"), JSON.stringify(ZZZ_DATA), "utf8")
    writeFileSync(join(at, "abbr.js"), ZZZ_ABBR, "utf8")
    table = new MaterialTable({ dir, logger })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("与星铁走同一支：按桶分组、桶内按 id 索引", () => {
    expect(table.ready("zzz")).toBe(true)
    expect(table.byId("100231", "zzz")?.name).toBe("先行者认证章")
    expect(table.get("特化电击芯片", "zzz")?.type).toBe("skill")
  })

  it("图标按桶名分目录，前缀是本游戏的包", () => {
    expect(table.get("先行者认证章", "zzz")?.icon).toBe("meta-zzz/material/promote/先行者认证章.webp")
  })

  it("**带 `abbr.js` 时标题用简称** —— 那份包里的长名字在窄格子里排不开", () => {
    expect(table.get("「仓鼠笼」访问器", "zzz")?.label).toBe("仓鼠笼访问器")
    // 表里没有的仍用全名
    expect(table.get("先行者认证章", "zzz")?.label).toBe("先行者认证章")
  })

  it("三个游戏各占一份缓存，索引不串", () => {
    expect(table.ready("gs")).toBe(false)
    expect(table.ready("sr")).toBe(false)
    expect(table.get("先行者认证章", "sr")).toBeUndefined()
  })
})

describe("MaterialTable 没有轮换表", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mhy-material-"))
    writeMeta(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("仍装得上，图标与星级可用，只是没有周期", () => {
    const table = new MaterialTable({ dir, logger })

    expect(table.ready()).toBe(true)
    expect(table.get("「诗文」的哲学")?.star).toBe(4)
    expect(table.get("「诗文」的哲学")?.week).toBeUndefined()
  })

  it("轮换表语法坏掉时不中断，只是没有周期", () => {
    writeFileSync(join(dir, "meta-gs", "material", "daily.js"), "export default { talent: { 1: [ 2 ] } }", "utf8")
    const table = new MaterialTable({ dir, logger })

    expect(table.ready()).toBe(true)
    expect(table.get("「诗文」的哲学")?.week).toBeUndefined()
  })
})

describe("MaterialTable 元数据未安装", () => {
  it("全部查询给 undefined，ready 为假，不抛错", () => {
    const dir = mkdtempSync(join(tmpdir(), "mhy-material-"))
    const table = new MaterialTable({ dir, logger })

    expect(table.ready()).toBe(false)
    expect(table.get("「诗文」的哲学")).toBeUndefined()
    expect(table.ladder("「诗文」的哲学")).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  it("reload 之后能看到新装的材料 —— 漏了它，新国家的天赋书要等重启才认得出", () => {
    const dir = mkdtempSync(join(tmpdir(), "mhy-material-"))
    const table = new MaterialTable({ dir, logger })
    expect(table.ready()).toBe(false)

    writeMeta(dir, DAILY)
    // 先不 reload：仍是空表
    expect(table.get("「诗文」的哲学")).toBeUndefined()

    table.reload()
    expect(table.get("「诗文」的哲学")?.week).toBe(3)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("MaterialTable 读真实的元数据", () => {
  const table = existsSync(join(REAL, "meta-gs", "material", "data.json"))
    ? new MaterialTable({ dir: REAL, logger })
    : undefined

  it.skipIf(!table)("装得上", () => {
    expect(table?.ready()).toBe(true)
  })

  it.skipIf(!table)("最高一阶的天赋书与武器材料**全部**查到轮换 —— 漏一个就说明简称的算法错了", () => {
    // 这是本节最要紧的一条：`daily.js` 是 3 档 × 8 国，故每类恰好该有 24 条对得上。
    // 少一条的表现不是报错，而是那一个国家的角色在 `#今日材料` 里静默消失
    const missed: string[] = []
    for (const [name, star, type] of [
      ["「勤劳」的哲学", 4, "talent"],
      ["「诗文」的哲学", 4, "talent"],
      ["「月光」的哲学", 4, "talent"],
      ["高塔孤王的碎梦", 5, "weapon"],
      ["苍星军势的征服", 5, "weapon"]
    ] as const) {
      const got = table?.get(name)
      if (!got || got.star !== star || got.type !== type || !got.week) missed.push(name)
    }

    expect(missed).toEqual([])
  })

  it.skipIf(!table)("璃月的勤劳是周二五、蒙德的诗文是周三六，与游戏内一致", () => {
    expect(table?.get("「勤劳」的哲学")).toMatchObject({ week: 2, city: "璃月", cid: 2, source: "周二/周五" })
    expect(table?.get("「诗文」的哲学")).toMatchObject({ week: 3, city: "蒙德", cid: 1, source: "周三/周六" })
  })

  it.skipIf(!table)("最后两列国家名同样有 —— 国家名表要跟得上新版本", () => {
    // 「月光」是挪德卡莱、苍星军势是至冬：国家名表若只到纳塔，这两组的标题就是空的
    expect(table?.get("「月光」的哲学")?.city).toBe("挪德卡莱")
    expect(table?.get("苍星军势的征服")?.city).toBe("至冬")
  })

  it.skipIf(!table)("星级阶梯取到三张图，高阶在前", () => {
    const got = table?.ladder("「诗文」的哲学") ?? []

    expect(got).toHaveLength(3)
    expect(got[0]).toContain("「诗文」的哲学")
  })

  it.skipIf(!table)("不轮换的材料没有周期", () => {
    expect(table?.get("常燃火种")?.week).toBeUndefined()
  })

  it.skipIf(!table)("真实的简称表认得下来 —— 认不出会整体抛错，故这一条同时验了解析器", () => {
    // 周本材料的简称只能来自 abbr.js，认不出的表现是标题写成七个字的全名
    expect(table?.get("魔王之刃·残片")?.abbr).toBe("公子·残片")
  })
})
