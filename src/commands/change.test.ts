/**
 * 模块职责：面板替换命令的测试
 * 依赖方向：测试文件，依赖 commands/change 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：钉住四条：**一律不落库**（写回去等于让此后每次 `#胡桃面板` 都显示一份假面板）、
 *          借不到的部件只说一句而不整体失败、三种 mode 各出各的模板、绝区零走自己那一路。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../core/session.js"
import type { MhyDeps } from "./deps.js"
import { panelChange } from "./change.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 落过库的次数 —— 必须恒为 0，见文件头 */
  saves: number
  /**
   * 装配层每次收到的那份角色数据
   *
   * **在这里记而不是从出图数据里读回**：视图层只挑它认得的字段，自查字段过不了那一层，
   * 断言取到的恒是 undefined。
   */
  builds: Record<string, unknown>[]
}

/** 认得的角色与武器 */
const ITEMS: Record<string, { id: string; name: string; kind?: string }> = {
  胡桃: { id: "10000046", name: "胡桃" },
  钟离: { id: "10000030", name: "钟离" },
  刻晴: { id: "10000042", name: "刻晴" },
  护摩之杖: { id: "13501", name: "护摩之杖", kind: "weapon" }
}

/** 认得的套装 */
const SETS: Record<string, { name: string; id: string; abbr?: string; idxs: Record<string, string> }> = {
  深林的记忆: {
    name: "深林的记忆",
    id: "15025",
    abbr: "深林",
    idxs: { 1: "深林之花", 2: "深林之羽", 3: "深林之沙", 4: "深林之杯", 5: "深林之冠" }
  }
}

/** 造一份库里的角色面板 */
function stored(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    level: 90,
    cons: 0,
    talent: { a: 9, e: 9, q: 9 },
    // `from` 必须是 store/panel.ts 的 `PANEL_SOURCES` 里认得的源：`isPanelReady` 头一行就判它，
    // 缺了它这份存档一律算"没有面板数据"，于是命令层在读到它之前就回一句提示
    from: "enka",
    weapon: { name: "护摩之杖", level: 90, affix: 1 },
    artis: {
      1: { name: "宗室之花", set: "宗室之翎", id: "15008", level: 20, star: 5, mainId: "2000", attrIds: ["501012"] }
    },
    ...over
  }
}

/**
 * 造一个会话与一份依赖
 * @param answers 库里有哪些角色、哪个游戏、命令后面跟什么、出不出得了图
 * @returns 会话、依赖与记录
 */
function make(answers: {
  /** `uid:角色id` → 库里那份；不在即没有面板数据 */
  panels?: Record<string, Record<string, unknown>>
  /** 游戏 */
  game?: "gs" | "sr" | "zzz"
  /** 命令后面跟的那一串 */
  rest?: string
  /** 出图是否成功 */
  imageOk?: boolean
  /** 元数据是否就绪 */
  ready?: boolean
}): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], saves: 0, builds: [] }
  const s = {
    user: "onebot11:1",
    name: "旅行者",
    rest: answers.rest ?? "",
    game: answers.game ?? "gs",
    isPrivate: true,
    text: async (t: string): Promise<void> => void sent.texts.push(t),
    image: async (name: string, data: Record<string, unknown>): Promise<boolean> => {
      sent.images.push({ name, data })
      return answers.imageOk !== false
    }
  } as unknown as Session

  const panels = answers.panels ?? {}
  const deps = {
    config: (): Record<string, unknown> => ({ enablePanel: true, enableUnreleased: true, enableCustomSplash: false }),
    users: { uid: async (): Promise<string> => "100000001" },
    meta: {
      loader: {
        byName: (_game: string, name: string) => ITEMS[name.trim()],
        byId: (_game: string, id: string) => Object.values(ITEMS).find(one => one.id === String(id)),
        detail: (): undefined => undefined,
        exists: (): boolean => false,
        pathOf: (): undefined => undefined,
        // 替身只有原神星铁两族条目，绝区零按「没装」答
        ready: (game: string): boolean => game !== "zzz"
      }
    },
    artiSets: {
      set: (_game: string, name: string | number) => {
        const key = String(name).trim()
        return SETS[key] ?? Object.values(SETS).find(one => one.abbr === key)
      }
    },
    panels: {
      of: () => ({
        avatar: async (_game: string, uid: string, id: string): Promise<Record<string, unknown> | undefined> =>
          panels[`${uid}:${id}`],
        // 落库口一律不该被碰到，被碰到就让计数涨起来
        save: async (): Promise<void> => void sent.saves++,
        merge: async (): Promise<void> => void sent.saves++
      })
    },
    panelBuilder: {
      ready: (): boolean => answers.ready !== false,
      // 装配层这里只需回一份"算得出来"的壳：本文件测的是替换那几步，不是属性计算
      build: (game: string, uid: string, one: Record<string, unknown>) => (sent.builds.push(one), {
        game,
        uid,
        id: one["id"],
        name: Object.values(ITEMS).find(it => it.id === String(one["id"]))?.name ?? "",
        abbr: "",
        star: 5,
        elem: "fire",
        level: one["level"],
        promote: 6,
        cons: one["cons"],
        fetter: 10,
        costume: 0,
        talent: one["talent"] ?? {},
        trees: one["trees"] ?? [],
        source: "预设面板",
        weapon: one["weapon"],
        artis: [],
        sets: {},
        attr: {},
        base: {},
        imgs: {}
      })
    }
  } as unknown as MhyDeps

  return { s, deps, sent }
}

/**
 * 取出图时装配层收到的那份角色数据
 * @param sent 记录
 * @returns 改造后那份
 */
function inputOf(sent: Sent): Record<string, unknown> {
  return sent.builds[0] ?? {}
}

describe("面板替换", () => {
  it("换武器：借来那把落进出图数据，**一次都不落库**", async () => {
    const { s, deps, sent } = make({
      rest: "胡桃换钟离武器",
      panels: {
        "100000001:10000046": stored("10000046"),
        "100000001:10000030": stored("10000030", { weapon: { name: "护摩之杖", level: 80, affix: 3 } })
      }
    })
    await panelChange(s, deps)

    expect(sent.images[0]?.name).toBe("character/profile-detail")
    const weapon = inputOf(sent)["weapon"] as { level?: number; affix?: number }
    expect(weapon.affix).toBe(3)
    // 这一条是本文件最要紧的：改过的那份不许写回库里
    expect(sent.saves).toBe(0)
  })

  it("借不到的部件只说一句，其余照换、图照出", async () => {
    const { s, deps, sent } = make({
      rest: "胡桃换刻晴圣遗物换3命",
      // 刻晴不在库里
      panels: { "100000001:10000046": stored("10000046") }
    })
    await panelChange(s, deps)

    expect(sent.texts.join("")).toContain("没换成")
    expect(sent.texts.join("")).toContain("刻晴")
    // 命座那一处照样生效，图照样出
    expect(inputOf(sent)["cons"]).toBe(3)
    expect(sent.images).toHaveLength(1)
  })

  it("三种 mode 各出各的模板", async () => {
    const panels = { "100000001:10000046": stored("10000046") }

    const one = make({ rest: "胡桃圣遗物换深林", panels })
    await panelChange(one.s, one.deps)
    expect(one.sent.images[0]?.name).toBe("character/profile-detail")
    expect(one.sent.images[0]?.data["mode"]).toBe("artis")

    const two = make({ rest: "胡桃面板换3命", panels })
    await panelChange(two.s, two.deps)
    expect(two.sent.images[0]?.name).toBe("character/profile-detail")
  })

  it("命令里带 uid 时查那个人的存档", async () => {
    const { s, deps, sent } = make({
      rest: "100000002胡桃换3命",
      panels: { "100000002:10000046": stored("10000046", { level: 80 }) }
    })
    await panelChange(s, deps)

    expect(sent.images).toHaveLength(1)
    expect(inputOf(sent)["level"]).toBe(80)
  })

  it("绝区零走自己那一路 —— 没装绝区零元数据时指路去更新，不落进原神星铁的装配层", async () => {
    const { s, deps, sent } = make({ rest: "安比换3命", game: "zzz" })
    await panelChange(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("绝区零元数据")
  })

  it("角色本身没有面板数据时指路去更新，而不是出一张空图", async () => {
    const { s, deps, sent } = make({ rest: "胡桃换3命", panels: {} })
    await panelChange(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("更新面板")
  })

  it("认不出的写法回一句原因，不出图", async () => {
    const { s, deps, sent } = make({ rest: "胡桃换某个不存在的东西", panels: { "100000001:10000046": stored("10000046") } })
    await panelChange(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("没认出")
  })

  it("元数据没装好时先说明", async () => {
    const { s, deps, sent } = make({ rest: "胡桃换3命", ready: false })
    await panelChange(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("更新元数据")
  })

  it("出不了图时退回文字", async () => {
    const { s, deps, sent } = make({
      rest: "胡桃换3命",
      panels: { "100000001:10000046": stored("10000046") },
      imageOk: false
    })
    await panelChange(s, deps)

    expect(sent.texts.length).toBeGreaterThan(0)
  })
})
