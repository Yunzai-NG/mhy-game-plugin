/**
 * 模块职责：`*模拟宇宙` 的测试
 * 依赖方向：测试文件，依赖 commands/sr/rogue 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：本文件钉的是**少带 `need_detail` 时的表现**：那时 `records` 为空，与"本期没打过"
 *          在返回上无从区分，故只回一句话而不出一张空表。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../../core/session.js"
import type { MhyDeps } from "../deps.js"
import { rogueList } from "./rogue.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口 */
  apis: string[]
}

/** 一份能出图的模拟宇宙返回 */
const ROGUE = {
  role: { nickname: "其实雨很好" },
  basic_info: { unlocked_buff_num: "128" },
  latest_record: { has_data: true, basic: { finish_cnt: "3" }, records: [{ name: "第八世界", difficulty: 5 }] }
}

/**
 * 造一个会话与一份依赖
 * @param game 游戏
 * @param empty 为真时接口返回空
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
        return { ok: true, uid: "101234567", data: empty ? {} : ROGUE }
      }
    }
  } as unknown as MhyDeps

  return { s, deps, sent }
}

describe("rogueList", () => {
  it("星铁走 rogue 接口与自己那张图", async () => {
    const { s, deps, sent } = make("sr")
    await rogueList(s, deps)

    expect(sent.apis).toEqual(["rogue"])
    expect(sent.images[0]?.name).toBe("sr/rogue")
    expect(sent.images[0]?.data["finishCnt"]).toBe(3)
    expect(sent.images[0]?.data["nickname"]).toBe("其实雨很好")
  })

  it("原神明确说不支持，不发一次注定失败的请求", async () => {
    const { s, deps, sent } = make("gs")
    await rogueList(s, deps)

    expect(sent.apis).toEqual([])
    expect(sent.texts.join("")).toContain("只有星穹铁道有")
  })

  it("没有明细时只回一句话 —— 少带 need_detail 的表现就是 records 为空", async () => {
    const { s, deps, sent } = make("sr", true)
    await rogueList(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("尚无通关记录")
  })
})
