/**
 * 模块职责：幻想真境剧诗那一族命令的测试
 * 依赖方向：测试文件，用假的查询服务驱动 commands/gs/combat
 * 生命周期：无状态
 * 注意事项：要点是**三种「没有内容」各回一句不同的话** —— 没解锁、本期没打过、明细未生成三者
 *          同样返回 retcode 0，共用一句话会让「过一阵就有」与「这个账号根本没有这个玩法」分不出来。
 *          另固定：取玩家信息失败不影响出图、非原神明确说明，以及**月谕圣牌与剧诗同一条接口**
 *          （`role_combat` 的 `tarot_card_state`）而**绘想游迹是另一条**（`char_master`）——
 *          混起来不报错，只是拿一份没有对应键的返回出一张空图。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../../core/session.js"
import type { MhyDeps } from "../deps.js"
import { charMaster, roleCombat, tarotCards } from "./combat.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图：模板名与数据 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口名 */
  apis: string[]
}

/** 一份能出图的返回 */
const OK_RAW = {
  is_unlock: true,
  data: [
    {
      has_data: true,
      has_detail_data: true,
      schedule: { start_time: 1_785_000_000 },
      stat: { difficulty_id: 4, max_round_id: 10 },
      detail: {
        rounds_data: [
          {
            round_id: 1,
            finish_time: 1_785_000_600,
            avatars: [{ avatar_id: 10000046, name: "胡桃", element: "Pyro", level: 90, rarity: 5 }]
          }
        ]
      }
    }
  ]
}

/** 一份带月谕圣牌收藏的返回，与剧诗同一条接口 */
const TAROT_RAW = {
  is_unlock: true,
  tarot_card_state: {
    curr_num: 1,
    total_num: 22,
    list: [
      { name: "愚者", icon: "https://a.invalid/0.png", is_unlock: true, unlock_num: 3 },
      { name: "魔术师", icon: "https://a.invalid/1.png", is_unlock: false, unlock_num: 0 }
    ]
  }
}

/** 一份绘想游迹的返回：一条已完成、一条进行中、一条锁着 */
const MASTER_RAW = {
  is_unlock: true,
  list: [
    { avatar_id: 10000046, name: "胡桃", icon: "https://a.invalid/a.png", status: 3 },
    { avatar_id: 10000030, name: "钟离", icon: "https://a.invalid/b.png", status: 2 },
    { avatar_id: 10000002, name: "神里绫华", icon: "https://a.invalid/c.png", status: 1 }
  ]
}

/**
 * 造一个会话与一份依赖
 * @param answers 每个接口给什么；`imageOk` 为假时模拟没有渲染器
 * @returns 会话、依赖与记录
 */
function make(answers: {
  /** 剧诗接口 */
  combat?: unknown
  /** 绘想游迹接口 */
  master?: unknown
  /** 剧诗接口是否成功 */
  combatOk?: boolean
  /** 玩家信息接口是否成功 */
  indexOk?: boolean
  /** 出图是否成功 */
  imageOk?: boolean
  /** 游戏 */
  game?: "gs" | "sr" | "zzz"
}): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], apis: [] }
  const s = {
    user: "onebot11:1",
    name: "旅行者",
    rest: "",
    game: answers.game ?? "gs",
    isPrivate: true,
    isMaster: false,
    isGroupAdmin: false,
    botId: "1",
    lastSent: (): string => "",
    text: async (t: string): Promise<void> => void sent.texts.push(t),
    image: async (name: string, data: Record<string, unknown>): Promise<boolean> => {
      sent.images.push({ name, data })
      return answers.imageOk !== false
    }
  } as unknown as Session

  const deps = {
    mys: {
      query: async (name: string): Promise<unknown> => {
        sent.apis.push(name)
        if (name === "index") {
          return answers.indexOk === false
            ? { ok: false, kind: "retcode", message: "取不到" }
            : { ok: true, uid: "100000001", data: { role: { nickname: "旅行者", level: 60 } } }
        }
        if (name === "char_master") {
          return { ok: true, uid: "100000001", data: answers.master ?? MASTER_RAW }
        }
        return answers.combatOk === false
          ? { ok: false, kind: "retcode", message: "请先绑定角色" }
          : { ok: true, uid: "100000001", data: answers.combat ?? OK_RAW }
      }
    },
    meta: { loader: { byId: (): { face: string } => ({ face: "meta-gs/character/胡桃/imgs/face.webp" }) } },
    config: (): Record<string, unknown> => ({})
  } as unknown as MhyDeps

  return { s, deps, sent }
}

describe("roleCombat", () => {
  it("出图，且头像走元数据", async () => {
    const { s, deps, sent } = make({})
    await roleCombat(s, deps)

    expect(sent.images).toHaveLength(1)
    expect(sent.images[0]?.name).toBe("gs/combat")
    const rounds = (sent.images[0]?.data["detail"] as { rounds_data: { avatars: { face: string }[] }[] }).rounds_data
    expect(rounds[0]?.avatars[0]?.face).toBe("meta-gs/character/胡桃/imgs/face.webp")
    expect(sent.texts).toEqual([])
  })

  it("没有渲染器时退回文字", async () => {
    const { s, deps, sent } = make({ imageOk: false })
    await roleCombat(s, deps)

    expect(sent.texts.join("")).toContain("幻想真境剧诗")
    expect(sent.texts.join("")).toContain("胡桃")
  })

  it("三种没有内容各回一句不同的话，且都不出图", async () => {
    const cases: [unknown, string][] = [
      [{ is_unlock: false }, "还没有解锁"],
      [{ is_unlock: true, data: [{ has_data: false }] }, "尚无战绩"],
      [{ is_unlock: true, data: [{ has_data: true, has_detail_data: false }] }, "还没有生成明细"]
    ]
    for (const [raw, want] of cases) {
      const { s, deps, sent } = make({ combat: raw })
      await roleCombat(s, deps)

      expect(sent.images, want).toEqual([])
      expect(sent.texts.join(""), want).toContain(want)
    }
  })

  it("取数失败时把原因说出来", async () => {
    const { s, deps, sent } = make({ combatOk: false })
    await roleCombat(s, deps)

    expect(sent.texts.join("")).toContain("请先绑定角色")
    expect(sent.images).toEqual([])
  })

  it("取玩家信息失败照样出图 —— 顶栏少一个头像好过整条命令失败", async () => {
    const { s, deps, sent } = make({ indexOk: false })
    await roleCombat(s, deps)

    expect(sent.images).toHaveLength(1)
    // 三项都补成空值：模板直接印它们，给空对象会在图上印出字面的 undefined
    expect(sent.images[0]?.data["role"]).toEqual({ nickname: "", level: 0, game_head_icon: "", AvatarUrl: "" })
  })

  it("非原神明确说明，一个请求都不发", async () => {
    const { s, deps, sent } = make({ game: "sr" })
    await roleCombat(s, deps)

    expect(sent.apis).toEqual([])
    expect(sent.texts.join("")).toContain("只有原神有")
  })
})

describe("tarotCards", () => {
  it("与剧诗同一条接口 —— 不多占一次查询额度", async () => {
    const { s, deps, sent } = make({ combat: TAROT_RAW })
    await tarotCards(s, deps)

    expect(sent.apis).toEqual(["role_combat", "index"])
    expect(sent.images[0]?.name).toBe("gs/tarot")
    expect(sent.images[0]?.data["current"]).toBe(1)
    expect(sent.images[0]?.data["total"]).toBe(22)
  })

  it("没有渲染器时退回文字，只列已收集的那些", async () => {
    const { s, deps, sent } = make({ combat: TAROT_RAW, imageOk: false })
    await tarotCards(s, deps)

    expect(sent.texts.join("")).toContain("已收集 1/22")
    expect(sent.texts.join("")).toContain("愚者")
    expect(sent.texts.join("")).not.toContain("魔术师")
  })

  it("没解锁与这一期没有月谕模式分开说，且都不出图", async () => {
    const cases: [unknown, string][] = [
      [{ is_unlock: false }, "还没有解锁"],
      [{ is_unlock: true, tarot_card_state: { list: [] } }, "没有月谕模式"]
    ]
    for (const [raw, want] of cases) {
      const { s, deps, sent } = make({ combat: raw })
      await tarotCards(s, deps)

      expect(sent.images, want).toEqual([])
      expect(sent.texts.join(""), want).toContain(want)
    }
  })

  it("非原神明确说明，一个请求都不发", async () => {
    const { s, deps, sent } = make({ game: "sr" })
    await tarotCards(s, deps)

    expect(sent.apis).toEqual([])
    expect(sent.texts.join("")).toContain("只有原神有")
  })
})

describe("charMaster", () => {
  it("打的是另一条接口 —— 绘想游迹不在 role_combat 里", async () => {
    const { s, deps, sent } = make({ master: MASTER_RAW })
    await charMaster(s, deps)

    expect(sent.apis).toEqual(["char_master", "index"])
    expect(sent.images[0]?.name).toBe("gs/char-master")
    expect(sent.images[0]?.data["done"]).toBe(1)
    expect(sent.images[0]?.data["total"]).toBe(3)
  })

  it("没有渲染器时退回文字，已完成与进行中分两行", async () => {
    const { s, deps, sent } = make({ master: MASTER_RAW, imageOk: false })
    await charMaster(s, deps)

    const text = sent.texts.join("")
    expect(text).toContain("已完成 1/3")
    expect(text).toContain("胡桃")
    expect(text).toContain("进行中：钟离")
  })

  it("没解锁与没有数据分开说", async () => {
    for (const [raw, want] of [
      [{ is_unlock: false }, "还没有解锁"],
      [{ is_unlock: true, list: [] }, "暂无绘想游迹"]
    ] as [unknown, string][]) {
      const { s, deps, sent } = make({ master: raw })
      await charMaster(s, deps)

      expect(sent.images, want).toEqual([])
      expect(sent.texts.join(""), want).toContain(want)
    }
  })
})
