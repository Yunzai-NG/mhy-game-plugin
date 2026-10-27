/**
 * 模块职责：`#老婆` 一族的测试
 * 依赖方向：测试文件，依赖 commands/wife 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：钉住四条最容易静默出错的口径：**长的叫法先认**（短的先匹配会把「女朋友」认成
 *          「女儿」）、六类叫法归四类名单但设置分开存、只挑名下已有面板的角色（画得出卡片才算
 *          可挑）、不在名单里的名字要报出来而不是静默丢掉。
 */
import { describe, expect, it } from "vitest"
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import type { Session } from "../core/session.js"
import { WifeStore } from "../store/wife.js"
import type { MhyDeps } from "./deps.js"
import { parseWife, splitWanted, wifeCard } from "./wife.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
}

/** 原神那份名单，只取几位够用 */
const NAMES = {
  girlfriend: ["胡桃", "刻晴", "甘雨"],
  boyfriend: ["钟离", "魈"],
  daughter: ["可莉"],
  son: [] as string[]
}

/**
 * 造一个会话与一份依赖
 * @param answers 命令后面跟什么、哪个游戏、名下有哪几位角色
 * @returns 会话、依赖、记录与指定名单库
 */
function make(answers: {
  /** 命令原文，形如 `老婆设置胡桃` */
  rest?: string
  /** 游戏 */
  game?: "gs" | "sr" | "zzz"
  /** 名下已有面板的角色名 */
  owned?: readonly string[]
  /** 元数据装没装 */
  ready?: boolean
}): { s: Session; deps: MhyDeps; sent: Sent; picks: WifeStore } {
  const sent: Sent = { texts: [], images: [] }
  const s = {
    user: "onebot11:1",
    name: "旅行者",
    rest: answers.rest ?? "老婆",
    game: answers.game ?? "gs",
    isPrivate: true,
    isMaster: false,
    text: async (t: string): Promise<void> => void sent.texts.push(t),
    image: async (name: string, data: Record<string, unknown>): Promise<boolean> => {
      sent.images.push({ name, data })
      return true
    }
  } as unknown as Session

  /** 名字 → id，两位数字够区分 */
  const ids: Record<string, string> = { 胡桃: "10000046", 刻晴: "10000042", 甘雨: "10000037", 钟离: "10000030" }
  const owned = answers.owned ?? []
  const picks = new WifeStore({ kv: new Kv(new MemoryKvDriver()).sub("wife") })

  const deps = {
    config: (): Record<string, unknown> => ({ enableAvatarCard: true, enableCustomSplash: false }),
    users: { uid: async (): Promise<string> => "100000001" },
    wife: { get: (_game: string, key: keyof typeof NAMES): readonly string[] => NAMES[key] },
    wifePick: picks,
    meta: {
      loader: {
        ready: (): boolean => answers.ready !== false,
        byName: (_game: string, name: string): { id: string; name: string } | undefined =>
          ids[name] ? { id: ids[name], name } : undefined,
        detail: (): undefined => undefined,
        exists: (): boolean => false,
        // 出图成功后要记一手"这张图的原图在哪"，那一步会问它
        pathOf: (): undefined => undefined
      }
    },
    panels: {
      of: () => ({
        load: async (): Promise<{ avatars: Record<string, unknown> }> => ({
          avatars: Object.fromEntries(owned.map(one => [ids[one] ?? one, { id: ids[one] ?? one }]))
        }),
        avatar: async (): Promise<undefined> => undefined
      })
    },
    panelBuilder: { build: (): undefined => undefined }
  } as unknown as MhyDeps

  return { s, deps, sent, picks }
}

describe("parseWife 认关系与动作", () => {
  it("**长的叫法先认** —— 「女朋友」不该被认成「女儿」", () => {
    expect(parseWife("女朋友")?.rel.key).toBe("girlfriend")
    expect(parseWife("女儿")?.rel.key).toBe("daughter")
  })

  it("六类叫法各归各的名单", () => {
    expect(parseWife("老婆")?.rel.key).toBe("girlfriend")
    expect(parseWife("媳妇")?.rel.key).toBe("girlfriend")
    expect(parseWife("老公")?.rel.key).toBe("boyfriend")
    expect(parseWife("男神")?.rel.key).toBe("boyfriend")
    expect(parseWife("儿子")?.rel.key).toBe("son")
  })

  it("认得出三种动作", () => {
    expect(parseWife("老婆")?.action).toBe("card")
    expect(parseWife("老婆设置胡桃")?.action).toBe("set")
    expect(parseWife("老婆是谁")?.action).toBe("list")
    expect(parseWife("老婆列表")?.action).toBe("list")
  })

  it("设置那一支把名字留在 param 里", () => {
    expect(parseWife("老婆设置胡桃,刻晴")?.param).toBe("胡桃,刻晴")
    expect(parseWife("老婆添加甘雨")?.param).toBe("甘雨")
  })

  it("「老婆照片」一类后缀当作出卡片", () => {
    expect(parseWife("老婆照片")?.action).toBe("card")
    expect(parseWife("老婆卡片")?.action).toBe("card")
  })

  it("认不出关系时返回 undefined", () => {
    expect(parseWife("胡桃")).toBeUndefined()
    expect(parseWife("")).toBeUndefined()
  })
})

describe("splitWanted", () => {
  it("认全角逗号与顿号 —— 群里没人只用半角", () => {
    expect(splitWanted("胡桃、刻晴，甘雨")).toEqual(["胡桃", "刻晴", "甘雨"])
  })

  it("去空白与空项", () => {
    expect(splitWanted(" 胡桃 , , 刻晴 ")).toEqual(["胡桃", "刻晴"])
  })
})

describe("出卡片", () => {
  it("从名下已有面板的角色里挑一位", async () => {
    const { s, deps, sent } = make({ rest: "老婆", owned: ["胡桃"] })
    await wifeCard(s, deps)

    expect(sent.images[0]?.name).toBe("character/character-card")
  })

  it("**名下一位都没有时说去更新面板** —— 那不是名单的问题", async () => {
    const { s, deps, sent } = make({ rest: "老婆", owned: [] })
    await wifeCard(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("更新面板")
  })

  it("**只挑名单里那一类** —— 名下有钟离也不该被当成老婆", async () => {
    const { s, deps, sent } = make({ rest: "老婆", owned: ["钟离"] })
    await wifeCard(s, deps)

    // 钟离在 boyfriend 名单里，girlfriend 那一类挑不出人
    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("更新面板")
  })

  it("儿子那一类名单为空时如实说明", async () => {
    const { s, deps, sent } = make({ rest: "儿子", owned: ["胡桃"] })
    await wifeCard(s, deps)

    expect(sent.texts.join("")).toContain("没有")
  })
})

describe("设置与查看", () => {
  it("设置之后出卡片只从设定的那几位里挑", async () => {
    const { s, deps, picks } = make({ rest: "老婆设置刻晴", owned: ["胡桃", "刻晴"] })
    await wifeCard(s, deps)

    expect(await picks.get("onebot11:1", "gs", "girlfriend")).toEqual(["刻晴"])
  })

  it("**不在名单里的名字要报出来**，不静默丢掉", async () => {
    const { s, deps, sent } = make({ rest: "老婆设置钟离", owned: ["胡桃"] })
    await wifeCard(s, deps)

    expect(sent.texts.join("")).toContain("钟离")
    expect(sent.texts.join("")).toContain("名单")
  })

  it("追加而不是覆盖 —— 「设置」与「添加」同一条路", async () => {
    const first = make({ rest: "老婆设置胡桃", owned: ["胡桃", "刻晴"] })
    await wifeCard(first.s, first.deps)
    // 同一份库上再设一次
    const second = make({ rest: "老婆添加刻晴", owned: ["胡桃", "刻晴"] })
    const deps = { ...second.deps, wifePick: first.picks } as MhyDeps
    await wifeCard(second.s, deps)

    expect(await first.picks.get("onebot11:1", "gs", "girlfriend")).toEqual(["胡桃", "刻晴"])
  })

  it("「随机」存成一个记号，此后从整份名单里挑", async () => {
    const { s, deps, picks } = make({ rest: "老婆设置随机", owned: ["胡桃"] })
    await wifeCard(s, deps)

    expect(await picks.get("onebot11:1", "gs", "girlfriend")).toEqual(["随机"])
  })

  it("查看时印出设定的那几位", async () => {
    const one = make({ rest: "老婆设置胡桃", owned: ["胡桃"] })
    await wifeCard(one.s, one.deps)

    const two = make({ rest: "老婆是谁", owned: ["胡桃"] })
    await wifeCard(two.s, { ...two.deps, wifePick: one.picks } as MhyDeps)

    expect(two.sent.texts.join("")).toContain("胡桃")
  })

  it("没设置过时指路怎么设", async () => {
    const { s, deps, sent } = make({ rest: "老婆列表" })
    await wifeCard(s, deps)

    expect(sent.texts.join("")).toContain("设置")
  })

  it("老婆与女朋友是同一份设置（都在 girlfriend 键下）", async () => {
    const { s, deps, picks } = make({ rest: "老婆设置胡桃", owned: ["胡桃"] })
    await wifeCard(s, deps)

    expect(await picks.get("onebot11:1", "gs", "girlfriend")).toEqual(["胡桃"])
  })

  it("设置但没写名字时问要设成谁", async () => {
    const { s, deps, sent } = make({ rest: "老婆设置" })
    await wifeCard(s, deps)

    expect(sent.texts.join("")).toContain("设置成谁")
  })
})

describe("边界", () => {
  it("绝区零没有这份名单，只回一句", async () => {
    const { s, deps, sent } = make({ rest: "老婆", game: "zzz" })
    await wifeCard(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("绝区零")
  })

  it("元数据没装时指路去装", async () => {
    const { s, deps, sent } = make({ rest: "老婆", ready: false })
    await wifeCard(s, deps)

    expect(sent.texts.join("")).toContain("更新元数据")
  })

  it("认不出关系时回一句而不是静默 —— 这一族有实词触发，不必兜住笔误", async () => {
    const { s, deps, sent } = make({ rest: "胡桃" })
    await wifeCard(s, deps)

    expect(sent.texts.join("")).toContain("没认出")
  })
})
