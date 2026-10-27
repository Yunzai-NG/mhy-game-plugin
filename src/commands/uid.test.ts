/**
 * 模块职责：`#我的uid` 那张图上的玩家信息的测试
 * 依赖方向：测试文件，依赖 commands/uid 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：钉的是**头像从哪来**：头像读头像库、昵称等级与横幅读面板库，一条请求都不发。
 *          这张图上可以有六十行，逐行打一次 `index` 的表现不是报错，而是发一次 `#我的uid`
 *          就把当日查询额度用光。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../core/session.js"
import type { GameKey } from "../core/region.js"
import type { StoredPlayer } from "../store/panel.js"
import type { MhyDeps } from "./deps.js"
import { myUid } from "./uid.js"

/** 视图里的一个 uid 段 */
interface Section {
  /** 游戏 */
  key: GameKey
  /** 该段的全部 uid */
  uidList: {
    uid: string
    name?: string
    level?: number
    face?: string
    fromFace?: boolean
    fromRes?: boolean
    banner?: string
  }[]
}

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口 */
  apis: string[]
}

/**
 * 造一个会话与一份依赖
 * @param uids 各游戏绑定的 uid
 * @param players 面板库里存着的玩家，键为 `<游戏>:<uid>`
 * @param faces 头像库里存着的那些，键为 `<游戏>:<uid>`
 * @returns 会话、依赖与记录
 */
function make(
  uids: Partial<Record<GameKey, string[]>>,
  players: Readonly<Record<string, Partial<StoredPlayer>>> = {},
  faces: Readonly<Record<string, string>> = {}
): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], apis: [] }
  const s = {
    user: "onebot11:1",
    name: "旅行者",
    rest: "",
    game: "gs",
    isPrivate: true,
    text: async (t: string): Promise<void> => void sent.texts.push(t),
    image: async (name: string, data: Record<string, unknown>): Promise<boolean> => {
      sent.images.push({ name, data })
      return true
    }
  } as unknown as Session

  const deps = {
    users: { uids: async (_user: string, game: GameKey): Promise<string[]> => uids[game] ?? [] },
    cookies: { find: async (): Promise<undefined> => undefined },
    mys: {
      query: async (api: string): Promise<Record<string, unknown>> => {
        sent.apis.push(api)
        return { ok: false }
      }
    },
    faces: {
      pick: async (game: GameKey, uid: string): Promise<string | undefined> => faces[`${game}:${uid}`]
    },
    panels: {
      of: () => ({
        load: async (game: string, uid: string): Promise<StoredPlayer> => ({
          game: game as "gs" | "sr",
          uid,
          avatars: {},
          ...players[`${game}:${uid}`]
        })
      })
    },
    meta: {
      loader: {
        // 元数据里认得的两个角色，其余一律不认识
        byId: (game: string, id: string): { name: string } | undefined => {
          if (game === "gs" && id === "10000046") return { name: "胡桃" }
          if (game === "sr" && id === "1306") return { name: "花火" }
          return undefined
        },
        // 一律不认变体图，故小头像回落到 face.webp —— 断言因此与 faceStyle 配置无关
        exists: (): boolean => false
      }
    }
  } as unknown as MhyDeps

  return { s, deps, sent }
}

/**
 * 取出图数据里的某个游戏段
 * @param sent 记录
 * @param key 游戏
 * @returns 该段
 */
function section(sent: Sent, key: GameKey): Section | undefined {
  return (sent.images[0]?.data["uids"] as Section[] | undefined)?.find(one => one.key === key)
}

describe("myUid", () => {
  it("头像取头像库里那张，横幅仍按面板库记下的角色取，且一条请求都不发", async () => {
    const { s, deps, sent } = make(
      { gs: ["100000001"] },
      { "gs:100000001": { name: "旅行者", level: 60, face: "10000046" } },
      { "gs:100000001": "gs/mys/100000001.png" }
    )
    await myUid(s, deps)

    expect(sent.apis).toEqual([])
    const first = section(sent, "gs")?.uidList[0]
    expect(first?.name).toBe("旅行者")
    expect(first?.level).toBe(60)
    expect(first?.face).toBe("gs/mys/100000001.png")
    expect(first?.fromFace).toBe(true)
    expect(first?.banner).toBe("meta-gs/character/胡桃/imgs/banner.webp")
  })

  it("星铁不拿 face 当角色 id —— 那一路给的不是角色 id，横幅改以库里排头那个角色兜底", async () => {
    const { s, deps, sent } = make(
      { sr: ["101234567"] },
      { "sr:101234567": { face: "201001", avatars: { "1306": { id: "1306", level: 80, cons: 0 } } } }
    )
    await myUid(s, deps)

    const first = section(sent, "sr")?.uidList[0]
    // 星铁的横幅是公用的那张，不按角色分
    expect(first?.banner).toBe("meta-sr/character/common/imgs/banner.webp")
  })

  it("头像库里没有这个 uid 时给该游戏的默认头像 —— 那三张随插件提交，装不装元数据都在", async () => {
    const { s, deps, sent } = make({ gs: ["100000002"], sr: ["100000002"], zzz: ["1000000002"] })
    await myUid(s, deps)

    const gs = section(sent, "gs")?.uidList[0]
    expect(gs?.face).toBe("common/face/gs.png")
    expect(gs?.fromRes).toBe(true)
    expect(gs?.name).toBeUndefined()
    // 三个游戏同一条路，绝区零没有另一条占位分支
    expect(section(sent, "sr")?.uidList[0]?.face).toBe("common/face/sr.png")
    expect(section(sent, "zzz")?.uidList[0]?.face).toBe("common/face/zzz.png")
  })

  it("绝区零取到头像时与另两个游戏同一条路", async () => {
    const { s, deps, sent } = make({ zzz: ["1000000001"] }, {}, { "zzz:1000000001": "zzz/mys/1000000001.png" })
    await myUid(s, deps)

    const first = section(sent, "zzz")?.uidList[0]
    expect(first?.face).toBe("zzz/mys/1000000001.png")
    expect(first?.fromFace).toBe(true)
  })
})
