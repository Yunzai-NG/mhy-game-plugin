/**
 * 模块职责：面板图存取的测试
 * 依赖方向：测试文件，依赖 img.ts；用系统临时目录当面板图根
 * 生命周期：每个用例一个临时目录，用完即删
 * 注意事项：**"练满"的判据是本文件的重心**：判宽了会让没练满的角色也用上超级面板图，
 *          判窄了则那张图永不出现 —— 两者都不报错。故五个分支（满命、评分档位、天赋全满、
 *          星铁的行迹全亮、以及天赋满但行迹没满）逐个固定。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fakeLogger } from "@yunzai-ng/core/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PanelImgStore, isSuperPanel, sniffExt, splashDirName } from "./img.js"

/** 面板图管理器的选项类型，造假 HTTP 客户端时要它 */
type ImgOpts = ConstructorParameters<typeof PanelImgStore>[0]

/**
 * 造一个只会返回固定字节的假 HTTP 客户端
 * @param bytes 要返回的字节；传 undefined 表示下载失败
 * @returns 假客户端
 */
function fakeHttp(bytes?: Uint8Array): ImgOpts["http"] {
  return {
    buffer: async (): Promise<Uint8Array> => {
      if (!bytes) throw new Error("网络错误")
      return bytes
    }
  } as unknown as ImgOpts["http"]
}

/** 那十六个行迹点，凑"全亮"用 */
const FULL_TREES = [
  "1101101",
  "1101102",
  "1101103",
  "1101201",
  "1101202",
  "1101203",
  "1101204",
  "1101205",
  "1101206",
  "1101207",
  "1101208",
  "1101209",
  "1101210",
  "1101301",
  "1101302",
  "1101501"
]

describe("isSuperPanel", () => {
  it("满命就算练满", () => {
    expect(isSuperPanel({ game: "gs", cons: 6, talent: { a: 1, e: 1, q: 1 } })).toBe(true)
  })

  it("评分到 ACE 或 MAX 就算练满", () => {
    const base = { game: "gs" as const, cons: 0, talent: { a: 1, e: 1, q: 1 } }

    expect(isSuperPanel({ ...base, markClass: "ACE" })).toBe(true)
    expect(isSuperPanel({ ...base, markClass: "MAX" })).toBe(true)
    expect(isSuperPanel({ ...base, markClass: "SSS" })).toBe(false)
  })

  it("原神天赋全满（10/10/10）算练满", () => {
    expect(isSuperPanel({ game: "gs", cons: 0, talent: { a: 10, e: 10, q: 10 } })).toBe(true)
    expect(isSuperPanel({ game: "gs", cons: 0, talent: { a: 10, e: 10, q: 9 } })).toBe(false)
  })

  it("星铁要天赋全满且十六个行迹点全亮", () => {
    const talent = { a: 6, e: 10, q: 10, t: 10 }

    expect(isSuperPanel({ game: "sr", cons: 0, talent, trees: FULL_TREES })).toBe(true)
    // 少一个行迹点就不算
    expect(isSuperPanel({ game: "sr", cons: 0, talent, trees: FULL_TREES.slice(0, 15) })).toBe(false)
  })

  it("星铁行迹全亮但天赋没满同样不算", () => {
    expect(
      isSuperPanel({ game: "sr", cons: 0, talent: { a: 6, e: 10, q: 10, t: 9 }, trees: FULL_TREES })
    ).toBe(false)
  })

  it("什么都不满时不算", () => {
    expect(isSuperPanel({ game: "gs", cons: 2, talent: { a: 9, e: 9, q: 9 } })).toBe(false)
  })
})

describe("sniffExt", () => {
  it("认出四种常见格式", () => {
    expect(sniffExt(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe("gif")
    expect(sniffExt(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg")
    expect(
      sniffExt(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))
    ).toBe("webp")
    expect(sniffExt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("png")
  })

  it("认不出时按 png —— 那是最宽容的选择", () => {
    expect(sniffExt(new Uint8Array([1, 2, 3, 4]))).toBe("png")
  })
})

describe("PanelImgStore", () => {
  let dir: string
  let store: PanelImgStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mhy-panel-img-"))
    // 固定随机源，使"挑一张"的结果可断言
    store = new PanelImgStore({ dir, logger: fakeLogger(), random: () => 0 })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * 放几张假图进去
   * @param kind 普通图或超级图
   * @param name 角色名
   * @param files 文件名
   */
  function put(kind: string, name: string, files: readonly string[]): void {
    const target = join(dir, `${kind}-character`, name)
    mkdirSync(target, { recursive: true })
    for (const one of files) writeFileSync(join(target, one), "x")
  }

  it("目录不存在时列出空数组，而非抛错", () => {
    expect(store.list("胡桃")).toEqual([])
    expect(store.pick("胡桃")).toBeUndefined()
  })

  it("只认图片后缀 —— 目录里的其他文件不算面板图", () => {
    put("normal", "胡桃", ["1.webp", "2.png", "note.txt", "3.jpg"])

    expect(store.list("胡桃")).toEqual(["1.webp", "2.png", "3.jpg"])
  })

  it("挑一张，路径相对面板图根且用正斜杠", () => {
    put("normal", "胡桃", ["1.webp"])

    expect(store.pick("胡桃")).toBe("normal-character/胡桃/1.webp")
  })

  it("练满的角色先看超级图", () => {
    put("normal", "胡桃", ["n.webp"])
    put("super", "胡桃", ["s.webp"])

    expect(store.pick("胡桃", true)).toBe("super-character/胡桃/s.webp")
    expect(store.pick("胡桃", false)).toBe("normal-character/胡桃/n.webp")
  })

  it("没有超级图时回落到普通图", () => {
    put("normal", "胡桃", ["n.webp"])

    expect(store.pick("胡桃", true)).toBe("normal-character/胡桃/n.webp")
  })

  it("随机挑：随机源换一个，挑到的也换", () => {
    put("normal", "胡桃", ["1.webp", "2.webp", "3.webp"])
    const last = new PanelImgStore({ dir, logger: fakeLogger(), random: () => 0.99 })

    expect(store.pick("胡桃")).toBe("normal-character/胡桃/1.webp")
    expect(last.pick("胡桃")).toBe("normal-character/胡桃/3.webp")
  })

  it("按序号删，序号 1 起", () => {
    put("normal", "胡桃", ["1.webp", "2.webp"])

    expect(store.del("胡桃", 1)).toBe("1.webp")
    expect(store.list("胡桃")).toEqual(["2.webp"])
  })

  it("序号越界时不删任何东西", () => {
    put("normal", "胡桃", ["1.webp"])

    expect(store.del("胡桃", 5)).toBeUndefined()
    expect(store.del("胡桃", 0)).toBeUndefined()
    expect(store.list("胡桃")).toEqual(["1.webp"])
  })

  it("存一张图：文件名取时间戳，后缀按内容嗅探", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
    const store2 = new PanelImgStore({ dir, logger: fakeLogger(), http: fakeHttp(png) })

    const file = await store2.save({ name: "胡桃", url: "https://example.invalid/a" })

    expect(file).toMatch(/^\d+\.png$/)
    expect(store2.list("胡桃")).toEqual([file])
  })

  it("没有 HTTP 客户端时存不下来，但不抛错", async () => {
    expect(await store.save({ name: "胡桃", url: "https://example.invalid/a" })).toBeUndefined()
  })

  it("图太大时拒收", async () => {
    const big = new Uint8Array(6 * 1024 * 1024)
    const store2 = new PanelImgStore({ dir, logger: fakeLogger(), http: fakeHttp(big) })

    expect(await store2.save({ name: "胡桃", url: "https://example.invalid/a" })).toBeUndefined()
  })

  it("下载失败时给 undefined，而非把异常抛给命令层", async () => {
    const store2 = new PanelImgStore({ dir, logger: fakeLogger(), http: fakeHttp() })

    expect(await store2.save({ name: "胡桃", url: "https://example.invalid/a" })).toBeUndefined()
  })

  it("绝对路径拼得出来 —— 列表要逐张发图", () => {
    expect(store.pathOf("normal-character/胡桃/1.webp")).toBe(
      join(dir, "normal-character", "胡桃", "1.webp")
    )
  })
})

describe("splashDirName", () => {
  it("开拓者一律折到 穹 / 星，不看配置", () => {
    // 那五个命途目录是同一个角色，分开存等于要人为每个命途各传一次
    expect(splashDirName("穹·毁灭", false)).toBe("穹")
    expect(splashDirName("星·记忆", false)).toBe("星")
    expect(splashDirName("穹·同谐", true)).toBe("穹")
  })

  it("三月七一族按配置折叠", () => {
    expect(splashDirName("三月七·巡猎", true)).toBe("三月七")
    expect(splashDirName("三月七", true)).toBe("三月七")
    expect(splashDirName("三月七·巡猎", false)).toBe("三月七·巡猎")
  })

  it("其余角色名原样返回", () => {
    for (const one of ["胡桃", "神里绫华", "丹恒·饮月", "刻晴"]) {
      expect(splashDirName(one, true)).toBe(one)
    }
  })
})
