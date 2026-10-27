/**
 * 模块职责：元数据装载器的测试
 * 依赖方向：测试文件，在临时目录里搭一棵与真实元数据同形的树
 * 生命周期：每个用例自建自清
 * 注意事项：夹具形态**照真实包核对过**：角色目录名即角色名、原神武器按类型分一层
 *          （`weapon/sword/冷刃/`）、星铁光锥按命途分一层（`weapon/巡猎/于夜色中/`）、星铁的
 *          `data.json` 没有 `abbr`。最要紧的一条：**没装元数据时全部查询返回 undefined 而不
 *          抛错** —— 少一个图标不该让整条命令失败。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AliasTable } from "./alias.js"
import type { MetaLoaderOptions } from "./loader.js"
import { isReleased, MetaLoader } from "./loader.js"

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

let dir = ""

/**
 * 写一个条目目录
 * @param path 目录绝对路径
 * @param data data.json 的内容
 * @param imgs 要造的图片文件名
 */
function item(path: string, data: Record<string, unknown>, imgs: readonly string[] = []): void {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, "data.json"), JSON.stringify(data), "utf8")
  if (imgs.length) mkdirSync(join(path, "imgs"), { recursive: true })
  for (const img of imgs) writeFileSync(join(path, "imgs", img), "x", "utf8")
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "meta-loader-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 造一个装载器
 * @returns 装载器
 */
function loader(): MetaLoader {
  return new MetaLoader({ dir, logger: LOGGER })
}

describe("简称的两处来源", () => {
  /**
   * 写一份别名索引 —— 那是安装器解析 `alias.js` 之后就地生成的产物
   * @param game 游戏
   * @param index 索引内容
   */
  function writeAlias(game: string, index: unknown): void {
    const at = join(dir, `meta-${game}`, "character")
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, "alias.json"), JSON.stringify(index), "utf8")
  }

  it("`data.json` 里有 `abbr` 时以它为准 —— 原神那份包是这样存的", () => {
    item(join(dir, "meta-gs", "character", "胡桃"), { id: 10000046, name: "胡桃", abbr: "胡桃", star: 5 })
    writeAlias("gs", { alias: {}, abbr: { 胡桃: "别的" } })

    expect(new MetaLoader({ dir, logger: LOGGER, alias: new AliasTable({ dir }) }).byName("gs", "胡桃")?.abbr).toBe("胡桃")
  })

  it("`data.json` 里没有时取别名表的 `abbr` —— 星铁与绝区零那两份包是这样存的", () => {
    item(join(dir, "meta-zzz", "character", "「11号」"), { id: 1041, name: "「11号」", star: 4 })
    writeAlias("zzz", { alias: { "11号": "「11号」" }, abbr: { "「11号」": "11号" } })

    const got = new MetaLoader({ dir, logger: LOGGER, alias: new AliasTable({ dir }) }).byName("zzz", "「11号」")
    expect(got?.abbr).toBe("11号")
  })

  it("两处都没有时用全名 —— 不给别名表时也不该抛错", () => {
    item(join(dir, "meta-sr", "character", "三月七"), { id: 1001, name: "三月七", star: 4 })

    expect(loader().byName("sr", "三月七")?.abbr).toBe("三月七")
  })
})

describe("MetaLoader 未安装时", () => {
  it("按 id 查返回 undefined，不抛错", () => {
    expect(loader().byId("gs", 10000035)).toBeUndefined()
  })

  it("按名称查返回 undefined，不抛错", () => {
    expect(loader().byName("gs", "七七")).toBeUndefined()
  })

  it("ready 为假 —— 命令层据此决定是否提示装元数据", () => {
    expect(loader().ready("gs")).toBe(false)
  })
})

describe("MetaLoader 原神", () => {
  beforeEach(() => {
    item(
      join(dir, "meta-gs", "character", "七七"),
      { id: 10000035, name: "七七", abbr: "七七", star: 5, elem: "cryo", weapon: "sword" },
      ["face.webp", "gacha.webp", "side.webp"]
    )
    item(
      join(dir, "meta-gs", "character", "神里绫华"),
      { id: 10000002, name: "神里绫华", abbr: "绫华", star: 5, elem: "cryo" },
      ["face.webp"]
    )
    // 原神武器多一层类型目录
    item(join(dir, "meta-gs", "weapon", "sword", "冷刃"), { id: 11301, name: "冷刃", star: 3 }, ["icon.webp"])
  })

  it("按 id 查角色，星级与元素都在", () => {
    const got = loader().byId("gs", 10000035)

    expect(got?.name).toBe("七七")
    expect(got?.star).toBe(5)
    expect(got?.elem).toBe("cryo")
  })

  it("图标是相对元数据根的路径 —— 由渲染桥拼成 URL", () => {
    const got = loader().byId("gs", 10000035)

    expect(got?.face).toBe("meta-gs/character/七七/imgs/face.webp")
    expect(got?.gacha).toBe("meta-gs/character/七七/imgs/gacha.webp")
  })

  it("缺哪张图就不给哪个字段，模板据此回退", () => {
    const got = loader().byId("gs", 10000002)

    expect(got?.face).toBe("meta-gs/character/神里绫华/imgs/face.webp")
    expect(got?.gacha).toBeUndefined()
  })

  it("简称与全名都能查到同一条", () => {
    const l = loader()

    expect(l.byName("gs", "绫华")?.id).toBe("10000002")
    expect(l.byName("gs", "神里绫华")?.id).toBe("10000002")
  })

  it("武器藏在类型目录下，同样查得到", () => {
    const got = loader().byId("gs", 11301)

    expect(got?.name).toBe("冷刃")
    expect(got?.face).toBeUndefined()
  })

  it("武器带上类别，且它来自目录层级 —— 原神的武器 data.json 里根本没有这一栏", () => {
    // 图鉴要用它取类型图标与中文名；角色不该有这一项，命令层正是靠它把角色与武器分开
    expect(loader().byId("gs", 11301)?.type).toBe("sword")
    expect(loader().byId("gs", 10000035)?.type).toBeUndefined()
  })

  it("find 先按 id 再按名称 —— 早年的抽卡记录 item_id 是空串", () => {
    const l = loader()

    expect(l.find("gs", 10000035, "随便")?.name).toBe("七七")
    expect(l.find("gs", "", "七七")?.name).toBe("七七")
    expect(l.find("gs", undefined, "七七")?.name).toBe("七七")
  })

  it("查不到的 id 返回 undefined，而不是造一条空条目", () => {
    expect(loader().byId("gs", 99999999)).toBeUndefined()
  })

  it("ready 为真", () => {
    expect(loader().ready("gs")).toBe(true)
  })
})

describe("预计实装时间", () => {
  /** 一天的毫秒数 */
  const DAY = 24 * 60 * 60 * 1000

  beforeEach(() => {
    item(join(dir, "meta-gs", "character", "七七"), { id: 10000035, name: "七七", abbr: "七七", star: 5 }, ["face.webp"])
    item(join(dir, "meta-gs", "character", "早了一步"), { id: 10000099, name: "早了一步", star: 5 }, ["face.webp"])
    item(join(dir, "meta-gs", "character", "已经上线"), { id: 10000098, name: "已经上线", star: 5 }, ["face.webp"])
    // eta 只在这份汇总索引里，逐角色那份 data.json 里没有它
    writeFileSync(
      join(dir, "meta-gs", "character", "data.json"),
      JSON.stringify({
        "10000035": { id: 10000035, abbr: "七七" },
        "10000099": { id: 10000099, eta: Date.now() + 30 * DAY },
        "10000098": { id: 10000098, eta: Date.now() - 30 * DAY }
      }),
      "utf8"
    )
  })

  it("eta 从汇总索引里读进条目", () => {
    expect(loader().byId("gs", 10000099)?.eta).toBeTypeOf("number")
    // 汇总索引里没写 eta 的那些不该被塞上这一项
    expect(loader().byId("gs", 10000035)?.eta).toBeUndefined()
  })

  it("isReleased 看的是时间过去了没有，而不是有没有这一项", () => {
    // 维护者在角色实装之后并不删 eta，故"有 eta"不等于"未实装"
    const l = loader()

    expect(isReleased(l.byId("gs", 10000035))).toBe(true)
    expect(isReleased(l.byId("gs", 10000098))).toBe(true)
    expect(isReleased(l.byId("gs", 10000099))).toBe(false)
  })

  it("条目缺失时视作已实装 —— 调用方不必先判空", () => {
    expect(isReleased(undefined)).toBe(true)
    expect(isReleased({})).toBe(true)
  })

  it("没有汇总索引时一个条目都不带 eta —— 星铁就是这样", () => {
    rmSync(join(dir, "meta-gs", "character", "data.json"), { force: true })

    expect(loader().byId("gs", 10000099)?.eta).toBeUndefined()
    expect(isReleased(loader().byId("gs", 10000099))).toBe(true)
  })
})

describe("MetaLoader.each", () => {
  beforeEach(() => {
    item(join(dir, "meta-gs", "character", "钟离"), { id: 10000030, name: "钟离", abbr: "钟离", star: 5, birth: "12-31" }, [
      "face.webp"
    ])
    // 旅行者按元素分七个目录，却共用一个 id
    item(join(dir, "meta-gs", "character", "旅行者", "anemo"), { id: 10000005, name: "旅行者", abbr: "空", star: 5, elem: "anemo", birth: "1-1" }, [
      "face.webp"
    ])
    item(join(dir, "meta-gs", "character", "旅行者", "geo"), { id: 10000005, name: "旅行者", abbr: "空", star: 5, elem: "geo", birth: "1-1" }, [
      "face.webp"
    ])
    item(join(dir, "meta-gs", "weapon", "polearm", "护摩之杖"), { id: 13501, name: "护摩之杖", star: 5 }, [])
  })

  it("旅行者按指定元素取详情，中文元素归一，星铁同 id 不跨游戏借目录", () => {
    const l = loader()
    for (const id of [7, "10000005", "10000007", "20000000"]) {
      expect(l.detail("gs", id, "风")?.name).toBe("旅行者")
      expect(l.detail("gs", id, "geo")?.name).toBe("旅行者")
    }
    expect(l.detail("sr", 7, "anemo")).toBeUndefined()
  })

  it("「冰主」一类按已装的元素目录认作空，并带上那个元素；没装的元素认不出", () => {
    item(join(dir, "meta-gs", "character", "空"), { id: 10000005, name: "空", abbr: "空", star: 5, elem: "multi" })
    const l = loader()

    expect(l.byName("gs", "风主")).toMatchObject({ id: "10000005", name: "空", elem: "anemo" })
    expect(l.byName("gs", "岩主角")).toMatchObject({ id: "10000005", elem: "geo" })
    // 只装了风、岩两个目录：冰主不能凭空认出来，命令层据此提示更新元数据
    expect(l.byName("gs", "冰主")).toBeUndefined()
    expect(l.byName("sr", "风主")).toBeUndefined()
  })

  it("按种类筛，种类取自它在哪个目录下", () => {
    const l = loader()

    expect(l.each("gs", "character").map(one => one.abbr).sort()).toEqual(["空", "空", "钟离"])
    expect(l.each("gs", "weapon").map(one => one.name)).toEqual(["护摩之杖"])
  })

  it("**同一个 id 的多个目录都在** —— 走 byId 会只剩最后一个", () => {
    const l = loader()

    expect(l.each("gs", "character").filter(one => one.id === "10000005")).toHaveLength(2)
    expect(l.byId("gs", 10000005)).toBeDefined()
  })

  it("不传种类时两类都要，顺序即装载顺序（角色在前）", () => {
    expect(loader().each("gs").map(one => one.kind)).toEqual([
      "character",
      "character",
      "character",
      "weapon"
    ])
  })

  it("生日随条目记下来 —— 日历要一次问过全部角色，逐个读 data.json 是一百来次文件读取", () => {
    expect(loader().byId("gs", 10000030)?.birth).toBe("12-31")
    expect(loader().byId("gs", 13501)?.birth).toBeUndefined()
  })

  it("元数据没装时给空数组，不抛错", () => {
    expect(new MetaLoader({ dir: join(dir, "并不存在"), logger: LOGGER }).each("gs")).toEqual([])
  })
})

describe("MetaLoader 星穹铁道", () => {
  beforeEach(() => {
    // 星铁的 data.json 没有 abbr
    item(join(dir, "meta-sr", "character", "三月七"), { id: 1001, key: "mar7th", name: "三月七", star: 4, elem: "冰" }, [
      "face.webp"
    ])
    item(join(dir, "meta-sr", "character", "Archer"), { id: 1015, key: "archer", name: "Archer", star: 5, elem: "量子" })
    // 光锥按命途分一层；图在目录根而非 imgs/ 下，且立绘叫 splash.webp 而不是 gacha.webp
    item(join(dir, "meta-sr", "weapon", "巡猎", "于夜色中"), { id: "23015", name: "于夜色中", star: 5 })
    for (const img of ["icon.webp", "splash.webp"]) {
      writeFileSync(join(dir, "meta-sr", "weapon", "巡猎", "于夜色中", img), "x", "utf8")
    }
  })

  it("没有 abbr 时以全名兜底 —— 模板拿 abbr 显示，缺值会露空格子", () => {
    const got = loader().byId("sr", 1001)

    expect(got?.name).toBe("三月七")
    expect(got?.abbr).toBe("三月七")
  })

  it("光锥按命途分层，同样查得到", () => {
    expect(loader().byId("sr", "23015")?.name).toBe("于夜色中")
  })

  it("光锥的立绘记在 splash 上 —— 星铁那张叫 splash.webp，原神武器才叫 gacha.webp", () => {
    // 面板上星铁那一块读 `weapon.splash`，只认 `gacha` 会让光锥图整块空白
    const got = loader().byId("sr", "23015")

    expect(got?.icon).toBe("meta-sr/weapon/巡猎/于夜色中/icon.webp")
    expect(got?.splash).toBe("meta-sr/weapon/巡猎/于夜色中/splash.webp")
    expect(got?.gacha).toBeUndefined()
  })

  it("两个游戏各自独立 —— 原神没装不影响星铁", () => {
    const l = loader()

    expect(l.ready("sr")).toBe(true)
    expect(l.ready("gs")).toBe(false)
  })
})

describe("MetaLoader 绝区零", () => {
  beforeEach(() => {
    // 代理人带 prof，音擎按职业分一层
    item(join(dir, "meta-zzz", "character", "安比"), { id: "1011", name: "安比", star: 3, elem: "电", prof: "击破" }, [
      "face.webp",
      "gacha.webp"
    ])
    item(join(dir, "meta-zzz", "weapon", "强攻", "「月相」-望"), { id: "12001", name: "「月相」-望", star: 2 })
    writeFileSync(join(dir, "meta-zzz", "weapon", "强攻", "「月相」-望", "icon.webp"), "x", "utf8")
    // 驱动盘套装与邦布是**一份根表 + 一个 imgs 目录**（与 `meta-gs/artifact/` 同形），
    // 图按条目名取；造包脚本就是按名字落的，两侧要对得上
    mkdirSync(join(dir, "meta-zzz", "equip", "imgs"), { recursive: true })
    writeFileSync(
      join(dir, "meta-zzz", "equip", "data.json"),
      JSON.stringify({ 31000: { id: "31000", name: "啄木鸟电音", skills: { 2: "暴击率+8%。" } } }),
      "utf8"
    )
    writeFileSync(join(dir, "meta-zzz", "equip", "imgs", "啄木鸟电音.webp"), "x", "utf8")
    mkdirSync(join(dir, "meta-zzz", "bangboo"), { recursive: true })
    writeFileSync(
      join(dir, "meta-zzz", "bangboo", "data.json"),
      JSON.stringify({ 53001: { id: "53001", name: "企鹅布", star: 3 } }),
      "utf8"
    )
    // 长文那一份不该被装载器读，故此处刻意放一份坏的
    writeFileSync(join(dir, "meta-zzz", "character", "安比", "skill.json"), "{ 这不是 json", "utf8")
  })

  it("代理人的职业记在 prof 上 —— 属性与职业两栏都要显示", () => {
    const got = loader().byId("zzz", "1011")

    expect(got?.name).toBe("安比")
    expect(got?.elem).toBe("电")
    expect(got?.prof).toBe("击破")
    expect(got?.face).toBe("meta-zzz/character/安比/imgs/face.webp")
  })

  it("音擎按职业分一层，`type` 由目录层级得出", () => {
    const got = loader().byId("zzz", "12001")

    expect(got?.type).toBe("强攻")
    expect(got?.icon).toBe("meta-zzz/weapon/强攻/「月相」-望/icon.webp")
  })

  it("驱动盘套装与邦布也进索引 —— 面板要按名字查它们的图", () => {
    const l = loader()

    expect(l.byName("zzz", "啄木鸟电音")?.kind).toBe("equip")
    expect(l.byName("zzz", "啄木鸟电音")?.icon).toBe("meta-zzz/equip/imgs/啄木鸟电音.webp")
    expect(l.byName("zzz", "企鹅布")?.kind).toBe("bangboo")
    // 那两族先装（读一份表），逐条一个目录的两族后装
    expect(l.each("zzz").map(one => one.kind)).toEqual(["equip", "bangboo", "character", "weapon"])
  })

  it("套装表里没有图的那一条不写 icon —— 缺图要让调用方看得出来", () => {
    writeFileSync(
      join(dir, "meta-zzz", "equip", "data.json"),
      JSON.stringify({ 31000: { id: "31000", name: "无图套装" } }),
      "utf8"
    )
    const got = loader().byName("zzz", "无图套装")

    expect(got?.kind).toBe("equip")
    expect(got?.icon).toBeUndefined()
  })

  it("skill.json 不参与装载 —— 那份长文只有面板与图鉴才读", () => {
    // 坏的 skill.json 不影响装载，说明它压根没被读
    expect(loader().ready("zzz")).toBe(true)
    expect(loader().each("zzz", "character")).toHaveLength(1)
  })

  it("三个游戏各自独立", () => {
    const l = loader()

    expect(l.ready("zzz")).toBe(true)
    expect(l.ready("gs")).toBe(false)
    expect(l.ready("sr")).toBe(false)
  })
})

describe("MetaLoader 容错", () => {
  it("data.json 损坏时跳过该条，其余照常装载", () => {
    const base = join(dir, "meta-gs", "character")
    mkdirSync(join(base, "坏的"), { recursive: true })
    writeFileSync(join(base, "坏的", "data.json"), "{ 这不是 json", "utf8")
    item(join(base, "七七"), { id: 10000035, name: "七七", abbr: "七七", star: 5 })

    const l = loader()
    expect(l.byId("gs", 10000035)?.name).toBe("七七")
    expect(l.byName("gs", "坏的")).toBeUndefined()
  })

  it("没有 name 的条目不入表 —— 无名条目在模板里就是一个空格子", () => {
    item(join(dir, "meta-gs", "character", "无名"), { id: 123, star: 5 })

    expect(loader().byId("gs", 123)).toBeUndefined()
  })

  it("reload 之后能看见新装的角色，不必重启", () => {
    const l = loader()
    expect(l.ready("gs")).toBe(false)

    item(join(dir, "meta-gs", "character", "七七"), { id: 10000035, name: "七七", abbr: "七七", star: 5 })
    // 缓存还在，故仍看不到
    expect(l.byId("gs", 10000035)).toBeUndefined()

    l.reload()
    expect(l.byId("gs", 10000035)?.name).toBe("七七")
  })
})
