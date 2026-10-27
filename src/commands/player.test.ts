/**
 * 模块职责：`#成就` 与 `#宝箱` 两条按游戏分派的命令的测试
 * 依赖方向：测试文件，依赖 commands/player 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：钉的是**分派**：这两个词在原神一路出 `#探索` 那张图，星铁一路走各自的接口。
 *          混淆不报错，只是原神使用者发 `#成就` 收到一句"米游社没有返回成就数据"。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../core/session.js"
import type { MhyDeps } from "./deps.js"
import { achieveList, chestList } from "./player.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口 */
  apis: string[]
}

/** 各接口给什么 */
const ANSWERS: Readonly<Record<string, unknown>> = {
  achievement: {
    gold_num: "12",
    silver_num: "88",
    copper_num: "306",
    list: [{ series_id: 1, name: "开拓的路上", cur: "9", max: "10" }]
  },
  chest: {
    world_list: [
      { world_id: "1", name: "空间站「黑塔」", world_cur: "40", world_max: "50", map_entrances: [{ id: 1, name: "基座舱段", cur_chest: "20", max_chest: "20" }] }
    ]
  },
  index: { role: { nickname: "旅行者" }, stats: {}, world_explorations: [] }
}

/**
 * 造一个会话与一份依赖
 * @param game 游戏
 * @param empty 为真时两条新接口都返回空
 * @returns 会话、依赖与记录
 */
function make(game: "gs" | "sr" | "zzz", empty = false): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], apis: [] }
  const s = {
    user: "onebot11:1",
    name: "开拓者",
    rest: "",
    game,
    isPrivate: true,
    isMaster: false,
    isGroupAdmin: false,
    botId: "1",
    lastSent: (): string => "",
    text: async (t: string): Promise<void> => void sent.texts.push(t),
    image: async (name: string, data: Record<string, unknown>): Promise<boolean> => {
      sent.images.push({ name, data })
      return true
    }
  } as unknown as Session

  const deps = {
    config: (): Record<string, unknown> => ({}),
    mys: {
      query: async (api: string): Promise<Record<string, unknown>> => {
        sent.apis.push(api)
        return { ok: true, uid: "101234567", data: empty && api !== "index" ? {} : (ANSWERS[api] ?? {}) }
      }
    }
  } as unknown as MhyDeps

  return { s, deps, sent }
}

describe("achieveList", () => {
  it("星铁走 achievement 接口与自己那张图", async () => {
    const { s, deps, sent } = make("sr")
    await achieveList(s, deps)

    expect(sent.apis).toEqual(["achievement"])
    expect(sent.images[0]?.name).toBe("sr/achieve")
    expect(sent.images[0]?.data["total"]).toBe(406)
  })

  it("原神转给 #探索 —— 这两个词在原神就是它", async () => {
    const { s, deps, sent } = make("gs")
    await achieveList(s, deps)

    expect(sent.apis).toContain("index")
    expect(sent.apis).not.toContain("achievement")
    expect(sent.images[0]?.name).toBe("gs/role-explore")
  })

  it("接口没给列表时只回一句话，不出一张空表", async () => {
    const { s, deps, sent } = make("sr", true)
    await achieveList(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("战绩展示")
  })
})

describe("chestList", () => {
  it("星铁走 chest 接口与自己那张图", async () => {
    const { s, deps, sent } = make("sr")
    await chestList(s, deps)

    expect(sent.apis).toEqual(["chest"])
    expect(sent.images[0]?.name).toBe("sr/chest")
    expect(sent.images[0]?.data["cur"]).toBe(40)
  })

  it("原神仍转给 #探索", async () => {
    const { s, deps, sent } = make("gs")
    await chestList(s, deps)

    expect(sent.images[0]?.name).toBe("gs/role-explore")
  })

  it("绝区零随 #探索 转到区域收集 —— 它的收集品本就画在那张图上", async () => {
    const { s, deps, sent } = make("zzz")
    await chestList(s, deps)

    expect(sent.apis).toEqual(["exploration"])
    expect(sent.texts.join("")).not.toContain("只有原神有")
  })
})
