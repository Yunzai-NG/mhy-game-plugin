/**
 * 模块职责：`#信息` 与 `#角色列表` 两条命令的测试
 * 依赖方向：测试文件，依赖 commands/profile 与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：`#角色列表` 钉住**按游戏分两路**：原神与星铁出 `character/avatar-list`（格子带武器与命座），
 *          绝区零仍出 `avatars`。`#信息` 钉住只打 index（原神多一次战绩卡片取页头背景）——
 *          官方主页上 index 不给的格子按约定不另打战绩接口。另钉住没有面板库也照样出图。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../core/session.js"
import type { MhyDeps } from "./deps.js"
import { avatarList, profileCard } from "./profile.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口 */
  apis: string[]
  /** 每次查询带的参数 */
  opts: Record<string, unknown>[]
}

/** 一份能出图的原神 index */
const GS_INDEX = {
  role: { nickname: "旅行者", level: 60, game_head_icon: "https://a.invalid/head.png" },
  stats: { active_day_number: 800, achievement_number: 1100, common_chest_number: 3000 },
  world_explorations: [{ id: 1, name: "蒙德", exploration_percentage: 1000 }],
  avatars: [{ id: 10000046, name: "胡桃", level: 90, rarity: 5, actived_constellation_num: 2, element: "Pyro" }]
}

/** 一份能出图的星铁 index */
const SR_INDEX = {
  cur_head_icon_url: "https://a.invalid/sr.png",
  stats: { active_days: 400, achievement_num: 600, chest_num: 2000 },
  avatar_list: [{ id: 1306, name: "花火", level: 80, rarity: 5, rank: 2, element: "quantum" }]
}

/**
 * 造一个会话与一份依赖
 * @param answers 各项输入
 * @returns 会话、依赖与记录
 */
function make(answers: {
  /** 接口给的数据 */
  raw?: unknown
  /** 出图是否成功 */
  imageOk?: boolean
  /** 游戏 */
  game?: "gs" | "sr" | "zzz"
  /** 发起者名下的米游社账号 */
  owned?: { ltuid: string }[]
  /** 命令之后的内容 */
  rest?: string
}): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], apis: [], opts: [] }
  const s = {
    user: "onebot11:1",
    name: "某人",
    rest: answers.rest ?? "",
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
    config: (): Record<string, unknown> => ({}),
    mys: {
      query: async (api: string, opts: Record<string, unknown>): Promise<Record<string, unknown>> => {
        sent.apis.push(api)
        sent.opts.push(opts)
        return { ok: true, uid: "100000001", ltuid: "1001", data: answers.raw ?? {} }
      }
    },
    cookies: {
      owned: async (): Promise<{ ltuid: string }[]> => answers.owned ?? [{ ltuid: "1001" }]
    }
  } as unknown as MhyDeps

  return { s, deps, sent }
}

describe("avatarList", () => {
  it("消息里写了 uid 就查那一个，没写就不带 —— 选 CK 的归属闸在 mys.query 里", async () => {
    const one = make({ raw: GS_INDEX, rest: "100000002" })
    await avatarList(one.s, one.deps)
    expect(one.sent.opts[0]?.["uid"]).toBe("100000002")

    const two = make({ raw: GS_INDEX })
    await avatarList(two.s, two.deps)
    expect(two.sent.opts[0]).not.toHaveProperty("uid")
  })

  it("原神出 character/avatar-list，横幅与角色格子都在", async () => {
    const { s, deps, sent } = make({ raw: GS_INDEX })
    await avatarList(s, deps)

    expect(sent.apis).toEqual(["index"])
    expect(sent.images[0]?.name).toBe("character/avatar-list")
    const data = sent.images[0]?.data ?? {}
    expect((data["avatars"] as unknown[]).length).toBe(1)
    expect((data["face"] as Record<string, unknown>)["name"]).toBe("旅行者")
    // 用的是发起者自己那份 Cookie，故不印那句"信息可能不完全"
    expect(data["isSelfCookie"]).toBe(true)
  })

  it("星铁也出同一张图，且不给探索度与宝箱明细", async () => {
    const { s, deps, sent } = make({ raw: SR_INDEX, game: "sr" })
    await avatarList(s, deps)

    expect(sent.images[0]?.name).toBe("character/avatar-list")
    const info = (sent.images[0]?.data["info"] ?? {}) as Record<string, unknown>
    expect(info["areas"]).toBeUndefined()
    expect(info["chestMap"]).toBeUndefined()
  })

  it("绝区零仍走跨游戏那张简表 —— 它没有元数据，套那张带武器的图只有空格子", async () => {
    const { s, deps, sent } = make({ raw: { stats: {}, avatar_list: [] }, game: "zzz" })
    await avatarList(s, deps)

    expect(sent.images[0]?.name).toBe("avatars")
  })

  it("用的 Cookie 不在发起者名下时图上多一句提示", async () => {
    const { s, deps, sent } = make({ raw: GS_INDEX, owned: [] })
    await avatarList(s, deps)

    expect(sent.images[0]?.data["isSelfCookie"]).toBe(false)
  })

  it("没有渲染器时退回文字", async () => {
    const { s, deps, sent } = make({ raw: GS_INDEX, imageOk: false })
    await avatarList(s, deps)

    expect(sent.texts.join("")).toContain("旅行者")
    expect(sent.texts.join("")).toContain("胡桃")
  })
})

describe("profileCard", () => {
  it("三个游戏同一张 profile、都只打 index 一条；原神的背景取自战绩页文案表，不经米游社查询", async () => {
    const gs = make({ raw: GS_INDEX })
    const urls: string[] = []
    ;(gs.deps as { http?: unknown }).http = {
      get: async (url: string): Promise<unknown> => {
        urls.push(url)
        return { header_bg: "https://a.invalid/gs-bg.png" }
      }
    }
    await profileCard(gs.s, gs.deps)
    expect(gs.sent.images[0]?.name).toBe("profile")
    expect(gs.sent.apis).toEqual(["index"])
    expect(urls[0]).toContain("/mi18n/hk4e_cn/")
    expect(gs.sent.images[0]?.data["bg"]).toBe("https://a.invalid/gs-bg.png?x-oss-process=image/quality,Q_75/format,webp")
    // 地区卡片由同一份 index 造，蒙德那张在
    expect((gs.sent.images[0]?.data["areas"] as { name: string }[]).map(a => a.name)).toContain("蒙德")

    const sr = make({ raw: { ...SR_INDEX, phone_background_image_url: "https://a.invalid/bg.png" }, game: "sr" })
    await profileCard(sr.s, sr.deps)
    expect(sr.sent.images[0]?.name).toBe("profile")
    expect(sr.sent.apis).toEqual(["index"])
    expect(sr.sent.images[0]?.data["bg"]).toBe("https://a.invalid/bg.png")
  })

  it("常用角色画成角色卡：原神星铁由 index 造卡，绝区零面板库里没有的退回占位卡", async () => {
    const gs = make({ raw: GS_INDEX })
    await profileCard(gs.s, gs.deps)
    expect((gs.sent.images[0]?.data["cards"] as { id: string; name: string }[]).map(c => c.name)).toEqual(["胡桃"])

    const zzz = make({ raw: { stats: {}, avatar_list: [{ id: 1191, name_mi18n: "艾莲", level: 60, rarity: "S", rank: 1 }] }, game: "zzz" })
    await profileCard(zzz.s, zzz.deps)
    expect(zzz.sent.images[0]?.data["cards"]).toEqual([expect.objectContaining({ id: "1191", name: "艾莲", level: 60 })])
  })
})
