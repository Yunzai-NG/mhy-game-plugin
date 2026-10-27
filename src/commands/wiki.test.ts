/**
 * 模块职责：图鉴四条命令的测试
 * 依赖方向：测试文件，依赖 commands/wiki 与真实的 MetaLoader（夹具写在临时目录里）
 * 生命周期：每个用例一套新临时目录
 * 注意事项：固定三处只在实际使用时才暴露的口径：**认不出名字时一句话都不说**（这几条命令会过一遍
 *          很多消息，别的插件的 `#XX图鉴` 也会落进来，出声等于把别人的命令变成一句报错）、角色与
 *          武器共用同一个后缀故要分得开（武器条目带 `type` 而角色不带，判错即查角色查到一把武器的
 *          数据）、图标一律由 charImgs 算。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Session } from "../core/session.js"
import { MetaLoader } from "../meta/loader.js"
import type { MetaLoaderOptions } from "../meta/loader.js"
import { MaterialTable } from "../meta/material.js"
import type { MhyDeps } from "./deps.js"
import { charCons, charInputOf, charMaterial, charTalent, charWiki, wikiNameOf } from "./wiki.js"

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
 * @param imgs 要造的图片文件名，落在 `imgs/` 下
 */
function item(path: string, data: Record<string, unknown>, imgs: readonly string[] = []): void {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, "data.json"), JSON.stringify(data), "utf8")
  if (imgs.length) mkdirSync(join(path, "imgs"), { recursive: true })
  for (const img of imgs) writeFileSync(join(path, "imgs", img), "x", "utf8")
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mhy-wiki-cmd-"))
  item(
    join(dir, "meta-gs", "character", "胡桃"),
    {
      id: 10000046,
      name: "胡桃",
      abbr: "胡桃",
      star: 5,
      elem: "pyro",
      weapon: "polearm",
      title: "雪霁梅香",
      desc: "「往生堂」七十七代堂主。",
      talentCons: { a: 0, e: 0, q: 0 },
      baseAttr: { hp: 15552, atk: 106.4, def: 876 },
      growAttr: { key: "cdmg", value: 38.4 },
      // 天赋与命座两段都要有：命令层在这一段为空时改回文字，故缺了它天赋页那条用例测不到出图
      talent: { a: { name: "灭却之戒法", desc: ["进行至多五段的连续枪击。"], tables: [] } },
      cons: { "1": { name: "赤团开时斜飞去", desc: ["重击不消耗体力。"] } },
      materials: { talent: "「勤劳」的哲学" }
    },
    ["splash.webp", "face.webp"]
  )
  // 旅行者的图标按元素分目录，故它的目录形态与别人不同
  item(
    join(dir, "meta-gs", "character", "旅行者", "anemo"),
    { id: 10000005, name: "旅行者", abbr: "空", star: 5, elem: "anemo", weapon: "sword" },
    ["splash.webp"]
  )
  // 武器在类型目录下，且带一个角色不会有的 `type`
  item(join(dir, "meta-gs", "weapon", "polearm", "护摩之杖"), {
    id: 13501,
    name: "护摩之杖",
    star: 5,
    desc: "朱赤柴火杖。",
    affixTitle: "无羁的朱赤之蝶",
    affixData: { text: "生命值提升$[0]。", datas: { "0": ["20%", "40%"] } },
    attr: { atk: { "80": 532.23, "80+": 563.33, "90": 608.07 }, bonusKey: "cdmg", bonusData: { "80+": 60.34, "90": 66.15 } }
  })

  const mats = join(dir, "meta-gs", "material")
  mkdirSync(mats, { recursive: true })
  writeFileSync(
    join(mats, "data.json"),
    JSON.stringify({ "「勤劳」的哲学": { id: 402, name: "「勤劳」的哲学", type: "talent", star: 4 } }),
    "utf8"
  )

  // 绝区零那份包的技能与意象影画落在 `talent` / `cons` / `passive` 三段，与 meta-gs 同名同形，
  // 故天赋页与命座页三个游戏共用一条路
  item(
    join(dir, "meta-zzz", "character", "安比"),
    {
      id: 1011,
      name: "安比",
      abbr: "安比",
      star: 3,
      rank: "A",
      elem: "电",
      prof: "击破",
      hit: "斩击",
      camp: "狡兔屋",
      fullName: "安比·德玛拉",
      baseAttr: { hp: 7500, atk: 583, def: 612, impact: 118, cpct: "5%", cdmg: "50%" },
      talent: {
        basic: {
          name: "普通攻击",
          desc: ["<h3>普通攻击：伏特速攻</h3>"],
          tables: [{ name: "一段伤害倍率", values: ["31.2%", "34.1%"] }]
        }
      },
      cons: { "1": { name: "快充模式", desc: ["<p>能量获得效率提升 12%。</p>"] } },
      passive: [{ name: "核心被动：波动电压", desc: ["<p>失衡值提升 64%。</p>"] }]
    },
    ["face.webp", "gacha.webp"]
  )
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 假会话，记录回复与出图请求 */
interface Spy extends Session {
  /** 收到的全部文字回复 */
  readonly said: string[]
  /** 请求过的模板与倍率 */
  readonly drawn: { template: string; scale?: number }[]
}

/**
 * 造一个假会话
 * @param rest 命令之后的内容
 * @param canDraw 出图是否成功；为假时命令会退回文字
 * @param game 游戏
 * @returns 假会话
 */
function makeSession(rest: string, canDraw = false, game: Session["game"] = "gs"): Spy {
  const said: string[] = []
  const drawn: { template: string; scale?: number }[] = []
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
    drawn,
    text: async (content: string): Promise<void> => void said.push(content),
    image: async (template: string, _data, dress): Promise<boolean> => {
      drawn.push({ template, ...(dress?.scale === undefined ? {} : { scale: dress.scale }) })
      return canDraw
    },
    ask: async (): Promise<undefined> => undefined,
    file: async (): Promise<undefined> => undefined,
    askFile: async (): Promise<undefined> => undefined,
    sendFile: async (): Promise<boolean> => false,
    imageBytes: async (): Promise<boolean> => false,
    imageFile: async (): Promise<boolean> => true,
    forward: async (): Promise<boolean> => false
  }
}

/**
 * 造一份依赖包
 * @param withMeta 传假时不给元数据，用于验"没装元数据时静默"
 * @returns 依赖包
 */
function makeDeps(withMeta = true): MhyDeps {
  const loader = new MetaLoader({ dir, logger: LOGGER })
  const materials = new MaterialTable({ dir, logger: LOGGER })
  return {
    logger: LOGGER,
    config: () => ({}) as ReturnType<MhyDeps["config"]>,
    ...(withMeta ? { meta: { loader, installer: {} as never }, materials } : {})
  } as unknown as MhyDeps
}

describe("wikiNameOf", () => {
  it("剥掉「喵喵」前缀与首尾空白", () => {
    expect(wikiNameOf("  喵喵胡桃 ")).toBe("胡桃")
  })

  it("名字里带「喵」不受影响：只剥开头那一对", () => {
    expect(wikiNameOf("喵怪")).toBe("喵怪")
    expect(wikiNameOf("胡桃喵喵")).toBe("胡桃喵喵")
  })

  it("空串原样返回", () => {
    expect(wikiNameOf("")).toBe("")
  })
})

describe("charInputOf", () => {
  it("元数据里的字段都收进来", () => {
    const loader = new MetaLoader({ dir, logger: LOGGER })
    const item = loader.byName("gs", "胡桃")
    const got = charInputOf("gs", item!, loader)

    expect(got).toMatchObject({ game: "gs", name: "胡桃", abbr: "胡桃", star: 5, elem: "pyro", weapon: "polearm" })
    expect(got?.detail.title).toBe("雪霁梅香")
  })

  it("图标由 charImgs 算 —— 普攻那张来自本插件资源，故不以 meta- 开头", () => {
    const loader = new MetaLoader({ dir, logger: LOGGER })
    const got = charInputOf("gs", loader.byName("gs", "胡桃")!, loader)

    expect(got?.imgs["splash"]).toBe("meta-gs/character/胡桃/imgs/splash.webp")
    expect(got?.imgs["a"]).toBe("gs/atk/atk-polearm.webp")
  })

  it("旅行者认得出来 —— 它没有 boss 材料，且图标另在元素子目录下", () => {
    const loader = new MetaLoader({ dir, logger: LOGGER })
    const got = charInputOf("gs", loader.byName("gs", "旅行者")!, loader)

    expect(got?.isMain).toBe(true)
    expect(got?.imgs["cons1"]).toContain("旅行者/anemo/")
  })

  it("没有独立技能图时不传坏路径，已有图保留", () => {
    const icons = join(dir, "meta-gs", "character", "胡桃", "icons")
    mkdirSync(icons, { recursive: true })
    writeFileSync(join(icons, "talent-e.webp"), "x", "utf8")
    const loader = new MetaLoader({ dir, logger: LOGGER })
    const got = charInputOf("gs", loader.byName("gs", "胡桃")!, loader)

    expect(got?.imgs["e"]).toBe("meta-gs/character/胡桃/icons/talent-e.webp")
    expect(got?.imgs["q"]).toBeUndefined()
    expect(got?.imgs["passive3"]).toBeUndefined()
    expect(got?.imgs["a"]).toBe("gs/atk/atk-polearm.webp")
  })

  it("别的角色不设元素子目录 —— 设上会让命座与天赋格子全空白", () => {
    const loader = new MetaLoader({ dir, logger: LOGGER })
    const got = charInputOf("gs", loader.byName("gs", "胡桃")!, loader)

    expect(got?.isMain).toBe(false)
    expect(got?.imgs["cons1"]).toContain("character/胡桃/")
  })

  it("没有 data.json 时给 undefined 而非一份空视图", () => {
    const loader = new MetaLoader({ dir, logger: LOGGER })

    expect(charInputOf("gs", { id: "999", name: "不存在", abbr: "", star: 0 }, loader)).toBeUndefined()
  })
})

describe("charWiki", () => {
  it("认出角色时出图，倍率交给 character-wiki.css 而不在命令层再给一份", async () => {
    const s = makeSession("胡桃", true)
    await charWiki(s, makeDeps())

    expect(s.drawn).toEqual([{ template: "wiki/character-wiki" }])
    expect(s.said).toEqual([])
  })

  it("出不了图时退回文字", async () => {
    const s = makeSession("胡桃")
    await charWiki(s, makeDeps())

    expect(s.said[0]).toContain("胡桃")
    expect(s.said[0]).toContain("武器类型")
    expect(s.said[0]).toContain("基础生命")
  })

  it("角色查不到时改查武器 —— 两者的后缀完全一样，只能靠先后顺序分派", async () => {
    const s = makeSession("护摩之杖", true)
    await charWiki(s, makeDeps())

    expect(s.drawn).toEqual([{ template: "wiki/weapon-wiki" }])
  })

  it("两个都查不到时**一句话都不说** —— 别的插件的 #XX图鉴 也会落进来", async () => {
    const s = makeSession("并不存在的名字")
    await charWiki(s, makeDeps())

    expect(s.said).toEqual([])
    expect(s.drawn).toEqual([])
  })

  it("没装元数据时同样静默 —— 那时连「这是不是角色名」都判不出来", async () => {
    const s = makeSession("胡桃")
    await charWiki(s, makeDeps(false))

    expect(s.said).toEqual([])
  })

  it("绝区零前缀下写别的游戏的角色名时整条命令不生效", async () => {
    const s = makeSession("胡桃", true, "zzz")
    await charWiki(s, makeDeps())

    expect(s.drawn).toEqual([])
    expect(s.said).toEqual([])
  })

  it("名字为空时静默 —— `#图鉴` 这种输入不该招来一句报错", async () => {
    const s = makeSession("")
    await charWiki(s, makeDeps())

    expect(s.said).toEqual([])
  })

  it("不开第三方统计时那四块不出现，图仍照出", async () => {
    const s = makeSession("胡桃")
    await charWiki(s, makeDeps())

    expect(s.said[0]).not.toContain("平均命座")
  })
})

describe("charTalent 与 charMaterial", () => {
  it("天赋页与素材页都不在命令层给倍率", async () => {
    const s = makeSession("胡桃", true)
    await charTalent(s, makeDeps())

    expect(s.drawn).toEqual([{ template: "wiki/character-talent" }])
  })

  it("材料页倍率是 1.4，且材料表查得到那本天赋书", async () => {
    const s = makeSession("胡桃")
    await charMaterial(s, makeDeps())

    expect(s.said[0]).toContain("勤劳")
  })

  it("这两条认不出名字时也静默 —— `#天赋统计` 一类前缀不该被它们截住", async () => {
    const talent = makeSession("并不存在")
    const material = makeSession("并不存在")
    await charTalent(talent, makeDeps())
    await charMaterial(material, makeDeps())

    expect(talent.said).toEqual([])
    expect(material.said).toEqual([])
  })

  it("查武器时这两条不接手 —— 武器没有天赋与养成材料页", async () => {
    const s = makeSession("护摩之杖")
    await charTalent(s, makeDeps())

    expect(s.said).toEqual([])
    expect(s.drawn).toEqual([])
  })
})

describe("绝区零走同一条路", () => {
  it("技能页出的是与另两个游戏同一张图", async () => {
    const s = makeSession("安比", true, "zzz")
    await charTalent(s, makeDeps())

    expect(s.drawn).toEqual([{ template: "wiki/character-talent" }])
    expect(s.said).toEqual([])
  })

  it("影画页同样是那张图，只是模式不同", async () => {
    const s = makeSession("安比", true, "zzz")
    await charCons(s, makeDeps())

    expect(s.drawn).toEqual([{ template: "wiki/character-talent" }])
  })

  it("出不了图时退回文字，且叫法随游戏变", async () => {
    const skill = makeSession("安比", false, "zzz")
    const cinema = makeSession("安比", false, "zzz")
    await charTalent(skill, makeDeps())
    await charCons(cinema, makeDeps())

    expect(skill.said[0]).toContain("安比 技能")
    expect(skill.said[0]).toContain("普通攻击")
    expect(cinema.said[0]).toContain("意象影画")
    expect(cinema.said[0]).toContain("1 影")
  })

  it("基础数据那一栏取包里算好的那一份，键由 panel/prop 认成中文", async () => {
    const loader = new MetaLoader({ dir, logger: LOGGER })
    const got = charInputOf("zzz", loader.byName("zzz", "安比")!, loader)

    expect(got?.detail.baseAttr).toMatchObject({ hp: 7500, cpct: "5%" })
    // 页首底图回落到立绘：意象影画那张大图缺省不随包走
    expect(got?.imgs["card"]).toBe("meta-zzz/character/安比/imgs/gacha.webp")
  })

  it("**元数据里没有那一段时不出图** —— 绝区零包可能不带这两段，空图会让人以为功能坏了", async () => {
    item(join(dir, "meta-zzz", "character", "缺段代理人"), {
      id: 1099,
      name: "缺段代理人",
      abbr: "缺段代理人",
      star: 4,
      elem: "以太",
      prof: "强攻"
    })
    const s = makeSession("缺段代理人", true, "zzz")
    await charTalent(s, makeDeps())

    expect(s.drawn).toEqual([])
    expect(s.said[0]).toContain("请发送「#更新元数据」")
  })

  it("绝区零代理人也出图鉴（和原神星铁同一张模板，只是没有持有率那四块）", async () => {
    const s = makeSession("安比", true, "zzz")
    await charWiki(s, makeDeps())

    expect(s.drawn).toEqual([{ template: "wiki/character-wiki" }])
  })

  it("图鉴认不出的名字仍静默 —— 别的插件的 #XX图鉴 会落进来，出声等于替它报错", async () => {
    const s = makeSession("查无此人", true, "zzz")
    await charWiki(s, makeDeps())

    expect(s.drawn).toEqual([])
    expect(s.said).toEqual([])
  })

  it("材料一条仍不对绝区零成立 —— 它没有材料元数据，也没有那一套形态", async () => {
    const material = makeSession("安比", true, "zzz")
    await charMaterial(material, makeDeps())

    expect(material.drawn).toEqual([])
    expect(material.said).toEqual([])
  })
})
