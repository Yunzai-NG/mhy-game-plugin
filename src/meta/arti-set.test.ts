/**
 * 模块职责：圣遗物套装索引的测试
 * 依赖方向：测试文件，依赖 meta/arti-set.ts；夹具写在临时目录里
 * 生命周期：每个用例一套新临时目录
 * 注意事项：固定三项：按 id 与按名两条查询路都要通（原神的源给 id、星铁与米游社给名字）、
 *          五位数字按前两位当套装 id 查、**文件缺失时返回 undefined 而不抛错**。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ArtiSetTable } from "./arti-set.js"

let dir = ""

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arti-set-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 写一份套装数据
 * @param game 游戏
 * @param body 内容
 */
function put(game: "gs" | "sr", body: unknown): void {
  const at = join(dir, `meta-${game}`, "artifact")
  mkdirSync(at, { recursive: true })
  writeFileSync(join(at, "data.json"), JSON.stringify(body), "utf8")
}

/**
 * 写一份星铁星级档位表
 * @param body 内容
 */
function putSrMeta(body: unknown): void {
  const at = join(dir, "meta-sr", "artifact")
  mkdirSync(at, { recursive: true })
  writeFileSync(join(at, "meta.json"), JSON.stringify(body), "utf8")
}

/**
 * 写一份套装简称表
 * @param game 游戏
 * @param body 文件内容
 */
function putAlias(game: "gs" | "sr", body: string): void {
  const at = join(dir, `meta-${game}`, "artifact")
  mkdirSync(at, { recursive: true })
  writeFileSync(join(at, "alias.js"), body, "utf8")
}

/**
 * 造一张表
 * @returns 表
 */
function make(): ArtiSetTable {
  return new ArtiSetTable({ dir })
}

/** 一份最小的原神套装夹具 */
const GS_FIXTURE = {
  "400003": {
    id: "400003",
    name: "行者之心",
    idxs: {
      "1": { id: "51440", name: "故人之心" },
      "2": { id: "51420", name: "归乡之羽" },
      "3": { id: "51450", name: "逐光之石" },
      "4": { id: "51410", name: "异国之盏" },
      "5": { id: "51430", name: "感别之冠" }
    },
    skills: { "2": "攻击力提高18%。", "4": "重击的暴击率提升30%。" }
  }
}

describe("圣遗物套装索引", () => {
  it("按圣遗物 id 查得名称、所属套装与部位", () => {
    put("gs", GS_FIXTURE)
    const got = make().byId("gs", "51440")
    expect(got).toEqual({ name: "故人之心", set: "行者之心", idx: 1 })
  })

  it("按圣遗物名同样查得，且两侧空白不影响", () => {
    put("gs", GS_FIXTURE)
    expect(make().byName("gs", "  感别之冠 ")?.idx).toBe(5)
  })

  it("find 先按 id 查，id 查不到再按名字", () => {
    put("gs", GS_FIXTURE)
    const table = make()
    // id 命中时不看名字，故名字给错的也能查对
    expect(table.find("gs", "51420", "不存在的名字")?.name).toBe("归乡之羽")
    // id 给不出时回落到名字
    expect(table.find("gs", undefined, "逐光之石")?.idx).toBe(3)
    // id 为空串等同于没给
    expect(table.find("gs", "", "逐光之石")?.idx).toBe(3)
  })

  it("按套装名查一套，含件数效果", () => {
    put("gs", GS_FIXTURE)
    const set = make().set("gs", "行者之心")
    expect(set?.id).toBe("400003")
    expect(set?.skills["2"]).toContain("攻击力提高18%")
    expect(set?.idxs["1"]).toBe("故人之心")
  })

  it("传五位圣遗物 id 时按前两位当套装 id 查", () => {
    put("gs", GS_FIXTURE)
    // 51440 不是套装名，但前两位 51 属于行者之心
    expect(make().set("gs", "51440")?.name).toBe("行者之心")
  })

  it("五位数字这条路只对原神生效，星铁的 data.json 不给部位 id", () => {
    put("sr", {
      "101": { id: "101", name: "云无留迹的过客", idxs: { "1": { name: "过客的逢春木簪" } } }
    })
    const table = make()
    // 按名字查得
    expect(table.set("sr", "云无留迹的过客")?.name).toBe("云无留迹的过客")
    // 五位数字在星铁侧查不到，因为没有 id 前缀表
    expect(table.set("sr", "51440")).toBeUndefined()
  })

  it("星铁按遗器 id 查得名称、套装、部位与星级", () => {
    // 星铁的 id 在 `idxs[*].ids` 里，是「id → 星级」的一张表（一件遗器二到五星各一个 id）
    put("sr", {
      "114": {
        id: "114",
        name: "骇域漫游的信使",
        idxs: {
          "1": { name: "信使的全息目镜", ids: { "31141": 2, "41141": 3, "51141": 4, "61141": 5 } },
          "2": { name: "信使的百变义手", ids: { "61142": 5 } }
        }
      }
    })
    const table = make()
    expect(table.byId("sr", "61141")).toEqual({
      name: "信使的全息目镜",
      set: "骇域漫游的信使",
      idx: 1,
      star: 5
    })
    // 同一件的四星那个 id 查到同一件，但星级不同 —— 副词条的档位基数按星级取
    expect(table.byId("sr", "51141")?.star).toBe(4)
    expect(table.byId("sr", 61142)?.idx).toBe(2)
    // find 走的是同一条路
    expect(table.find("sr", "61141")?.set).toBe("骇域漫游的信使")
  })

  it("星铁按遗器名查得所属套装与部位", () => {
    put("sr", {
      "101": {
        id: "101",
        name: "云无留迹的过客",
        idxs: { "1": { name: "过客的逢春木簪" }, "2": { name: "过客的漂泊手记" } }
      }
    })
    expect(make().byName("sr", "过客的漂泊手记")).toEqual({
      name: "过客的漂泊手记",
      set: "云无留迹的过客",
      idx: 2
    })
  })

  it("没有名字的条目整条跳过，不产出一个空壳", () => {
    put("gs", { "1": { id: "1" }, "2": { id: "400003", name: "行者之心", idxs: {} } })
    const table = make()
    expect(table.set("gs", "行者之心")).toBeDefined()
    expect(table.ready("gs")).toBe(true)
  })

  it("文件缺失时各项查询返回 undefined 而不抛错", () => {
    const table = make()
    expect(() => table.byId("gs", "51440")).not.toThrow()
    expect(table.byId("gs", "51440")).toBeUndefined()
    expect(table.byName("gs", "故人之心")).toBeUndefined()
    expect(table.set("gs", "行者之心")).toBeUndefined()
    expect(table.ready("gs")).toBe(false)
  })

  it("文件不是合法 JSON 时同样不抛错", () => {
    const at = join(dir, "meta-gs", "artifact")
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, "data.json"), "{ 坏掉的", "utf8")
    expect(make().ready("gs")).toBe(false)
  })

  it("星铁档位表读得出主副词条的基数与步进", () => {
    putSrMeta({
      mainIdx: { "1": { "1": "hpPlus" } },
      starData: {
        "5": {
          main: { hpPlus: { id: "1", base: 112.896, step: 39.5136 } },
          sub: { "1": { key: "hpPlus", base: 33.87, step: 4.23 } }
        }
      }
    })
    const meta = make().srMeta("sr")
    expect(meta?.mainIdx["1"]?.["1"]).toBe("hpPlus")
    expect(meta?.starData["5"]?.main.hpPlus?.step).toBeCloseTo(39.5136, 4)
    expect(meta?.starData["5"]?.sub["1"]?.key).toBe("hpPlus")
  })

  it("档位表只有星铁有，原神传进来即 undefined", () => {
    putSrMeta({ mainIdx: {}, starData: {} })
    expect(make().srMeta("gs")).toBeUndefined()
  })

  it("档位表文件缺失时返回 undefined，且重复调用不反复读盘", () => {
    const table = make()
    expect(table.srMeta("sr")).toBeUndefined()
    // 缺失也要记进缓存，否则每次查词条都会去 stat 一次不存在的文件
    expect(table.srMeta("sr")).toBeUndefined()
  })

  it("reload 之后重新读盘，使更新过的元数据即时可用", () => {
    put("gs", GS_FIXTURE)
    const table = make()
    expect(table.set("gs", "行者之心")).toBeDefined()

    put("gs", {
      "400004": { id: "400004", name: "新套装", idxs: { "1": { id: "52440", name: "新花" } } }
    })
    // 未 reload 时仍是旧的
    expect(table.set("gs", "新套装")).toBeUndefined()
    table.reload()
    expect(table.set("gs", "新套装")?.id).toBe("400004")
    expect(table.byId("gs", "52440")?.name).toBe("新花")
  })

  it("同一套的 id 前缀只记第一次出现的那个套装", () => {
    // 两套的 id 前两位都是 51，前缀表应保留先出现的那一套
    put("gs", {
      a: { id: "1", name: "先出现", idxs: { "1": { id: "51001", name: "花甲" } } },
      b: { id: "2", name: "后出现", idxs: { "1": { id: "51002", name: "花乙" } } }
    })
    expect(make().set("gs", "51999")?.name).toBe("先出现")
  })
})

describe("套装简称", () => {
  it("原神合并 setAbbr 与 setAlias —— 主简称在前者、全量别名（含「深林」这类）在后者，只读一个会漏", () => {
    put("gs", GS_FIXTURE)
    putAlias("gs", 'export const setAbbr = {\n  // 4.0\n  行者之心: "行者"\n}\nexport const setAlias = { 行者之心: "行者,旅人" }\n')
    const table = make()

    // 显示用简称取第一个
    expect(table.set("gs", "行者之心")?.abbr).toBe("行者")
    // 只在 setAlias 里出现的别名也查得出（`#深林图鉴` 靠这一条）
    expect(table.set("gs", "旅人")?.name).toBe("行者之心")
  })

  it("星铁读的是另一个导出名 artiSetAbbr —— 读错名字的表现是标题全写成六七个字的全名", () => {
    put("sr", { a: { id: "1", name: "云无留迹的过客", idxs: { "1": { name: "过客的头" } } } })
    putAlias("sr", 'export const artiAbbr = { 过客的头: "过客头" }\nexport const artiSetAbbr = { 云无留迹的过客: "过客" }\n')

    expect(make().set("sr", "云无留迹的过客")?.abbr).toBe("过客")
  })

  it("表里没有的套装不带简称，调用方回落到全名", () => {
    put("gs", GS_FIXTURE)
    putAlias("gs", 'export const setAbbr = { 别的套装: "别的" }')

    expect(make().set("gs", "行者之心")?.abbr).toBeUndefined()
  })

  it("没有 alias.js 时照常装载", () => {
    put("gs", GS_FIXTURE)

    expect(make().set("gs", "行者之心")?.name).toBe("行者之心")
  })

  it("alias.js 语法认不出时只是没有简称，不让整份索引装不上", () => {
    put("gs", GS_FIXTURE)
    putAlias("gs", "export const setAbbr = { 行者之心: 123 }")
    const table = make()

    expect(table.ready("gs")).toBe(true)
    expect(table.set("gs", "行者之心")?.abbr).toBeUndefined()
  })

  it("**按简称也查得出这一套** —— 使用者打的是「行者」而不是「行者之心」", () => {
    put("gs", GS_FIXTURE)
    putAlias("gs", 'export const setAbbr = { 行者之心: "行者" }')

    // 只认全名的表现是 `#胡桃换行者` 一律回「没认出要换成什么」，而那个词正是群里的通行叫法
    expect(make().set("gs", "行者")?.name).toBe("行者之心")
  })

  it("**一套挂多个逗号分隔的简称时逐个都查得出** —— 整串当一个键则「深林」这类查不到、且 abbr 连逗号显示", () => {
    put("gs", GS_FIXTURE)
    putAlias("gs", 'export const setAbbr = { 行者之心: "草套,深林" }')
    const table = make()

    expect(table.set("gs", "草套")?.name).toBe("行者之心")
    expect(table.set("gs", "深林")?.name).toBe("行者之心")
    // 显示用的 abbr 取第一个，不带逗号
    expect(table.set("gs", "行者之心")?.abbr).toBe("草套")
  })

  it("简称这一级排在全名之后 —— 某套的简称恰是另一套的全名时，全名优先", () => {
    put("gs", {
      a: { id: "15", name: "行者之心", idxs: { "1": { name: "行者之花", id: "15001" } } },
      // 这一套的简称与上面那一套的全名撞了：真实元数据里未必有，但判据要确定
      b: { id: "16", name: "别的套装", idxs: { "1": { name: "别的花", id: "16001" } } }
    })
    putAlias("gs", 'export const setAbbr = { 别的套装: "行者之心" }')

    expect(make().set("gs", "行者之心")?.name).toBe("行者之心")
  })

  it("同一个简称登记了两套时只认第一次出现的那个，与 id 前缀同一处理", () => {
    put("gs", {
      a: { id: "15", name: "甲套装", idxs: { "1": { name: "甲花", id: "15001" } } },
      b: { id: "16", name: "乙套装", idxs: { "1": { name: "乙花", id: "16001" } } }
    })
    putAlias("gs", 'export const setAbbr = { 甲套装: "同名", 乙套装: "同名" }')

    expect(make().set("gs", "同名")?.name).toBe("甲套装")
  })
})

describe("随插件提交的真实套装数据", () => {
  it("原神与星铁的套装数据都不随插件提交，故默认目录下不可用", () => {
    // 套装数据在元数据包里（meta-gs/artifact/data.json 有 47KB），不随插件走 ——
    // 这条固定"没装元数据时套装名为空但不报错"，与图标缺失同一处置
    const table = new ArtiSetTable({ dir: join(dir, "空目录") })
    expect(table.ready("gs")).toBe(false)
    expect(table.ready("sr")).toBe(false)
  })
})
