/**
 * 模块职责：星铁三条挑战战绩命令的测试
 * 依赖方向：测试文件，用假的查询服务驱动 commands/sr/challenge
 * 生命周期：无状态
 * 注意事项：要点是**两种「没有内容」各回一句不同的话** —— 本期没打过与给了数据却没有关卡明细
 *          同样返回 retcode 0，共用一句话会让「去打一局」与「这条命令需要修」分不出来。另固定：
 *          游戏不对时明确说明而不是发一次注定失败的请求、三类各打各自那条接口（传错种类不报错，
 *          只是查到别的玩法上）。
 */
import { describe, expect, it } from "vitest"
import type { Session } from "../../core/session.js"
import type { MhyDeps } from "../deps.js"
import { challengeBoss, challengePeak, challengeStory } from "./challenge.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图：模板名与数据 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口名 */
  apis: string[]
  /** 打接口时带的参数 */
  data: (Record<string, unknown> | undefined)[]
}

/** 一份能出图的星铁挑战返回 */
const SR_OK = {
  has_data: true,
  star_num: 9,
  max_floor: "第 4 层",
  battle_num: 12,
  groups: [{ name_mi18n: "第 20 期", begin_time: { year: 2026, month: 8, day: 1 } }],
  all_floor_detail: [
    { name: "第 1 层", star_num: 3, round_num: 4, node_1: { avatars: [{ id: 1306, level: 80, icon: "https://b.png", rarity: 5 }] } }
  ]
}

/**
 * 造一个会话与一份依赖
 * @param answers 每个接口给什么；`imageOk` 为假时模拟没有渲染器
 * @returns 会话、依赖与记录
 */
function make(answers: {
  /** 战绩接口给的数据 */
  raw?: unknown
  /** 战绩接口是否成功 */
  rawOk?: boolean
  /** 出图是否成功 */
  imageOk?: boolean
  /** 游戏 */
  game?: "gs" | "sr" | "zzz"
  /** 命令后面跟的那一串 */
  rest?: string
}): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], apis: [], data: [] }
  const s = {
    user: "onebot11:1",
    name: "开拓者",
    rest: answers.rest ?? "",
    game: answers.game ?? "sr",
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
      query: async (name: string, opts?: { data?: Record<string, unknown> }): Promise<unknown> => {
        sent.apis.push(name)
        sent.data.push(opts?.data)
        return answers.rawOk === false
          ? { ok: false, kind: "retcode", message: "请先绑定角色" }
          : { ok: true, uid: "100000001", data: answers.raw }
      }
    },
    meta: {
      loader: {
        byId: (game: string, id: string): { face: string; abbr: string } | undefined =>
          id === "1306" ? { face: "", abbr: "花火" } : undefined
      }
    },
    config: (): Record<string, unknown> => ({})
  } as unknown as MhyDeps

  return { s, deps, sent }
}

describe("星铁三类挑战", () => {
  /** 共用那份视图的两类各自的处理函数、接口名、标题与模板；异相仲裁另有一份，见下 */
  const KINDS = [
    [challengeStory, "challengeStory", "虚构叙事", "sr/challenge-story"],
    [challengeBoss, "challengeBoss", "末日幻影", "sr/challenge-boss"]
  ] as const

  it("两类各打各自那条接口，模板与标题也各是各的", async () => {
    for (const [handler, api, title, tpl] of KINDS) {
      const { s, deps, sent } = make({ game: "sr", raw: SR_OK })
      await handler(s, deps)

      expect(sent.apis, title).toEqual([api])
      expect(sent.images, title).toHaveLength(1)
      expect(sent.images[0]?.name, title).toBe(tpl)
      expect(sent.images[0]?.data["title"], title).toBe(title)
      // 星铁不另取玩家信息，故只有一次请求
      expect(sent.data[0], title).toEqual({ schedule_type: 1 })
    }
  })

  it("名字按 id 查元数据 —— 接口只给 id", async () => {
    const { s, deps, sent } = make({ game: "sr", raw: SR_OK })
    await challengeStory(s, deps)

    const story = sent.images[0]?.data["story"] as { floors: { nodes: { avatars: { name: string }[] }[] }[] }
    expect(story.floors[0]?.nodes[0]?.avatars[0]?.name).toBe("花火")
  })

  it("「上期」既改接口参数也换那一期", async () => {
    const { s, deps, sent } = make({ game: "sr", raw: SR_OK, rest: "上期" })
    await challengeStory(s, deps)

    expect(sent.data[0]).toEqual({ schedule_type: 2 })
    expect(sent.images[0]?.data["type"]).toBe(2)
  })

  it("两种没有内容各回一句不同的话 —— 第二种意味着接口形态可能已变", async () => {
    const { s, deps, sent } = make({ game: "sr", raw: { has_data: false } })
    await challengeStory(s, deps)
    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("尚无战绩")

    const other = make({ game: "sr", raw: { has_data: true } })
    await challengeStory(other.s, other.deps)
    expect(other.sent.images).toEqual([])
    expect(other.sent.texts.join("")).toContain("没有关卡明细")
  })

  it("异相仲裁走自己那份视图与模板 —— 它的返回与另两类没有一栏重合", async () => {
    const raw = {
      role: { nickname: "其实雨很好" },
      challenge_peak_best_record_brief: { challenge_peak_rank_icon_type: "ChallengePeakRankIconTypeGold", boss_stars: 3 },
      challenge_peak_records: [
        {
          has_challenge_record: true,
          group: { name_mi18n: "财富造物主31" },
          boss_record: { has_challenge_record: true, star_num: 3, avatars: [{ id: 1306, name: "花火", level: 80 }] },
          mob_infos: [{ name: "骑士其一" }],
          mob_records: [{ has_challenge_record: true, star_num: 2, avatars: [{ id: 1013, level: 80 }] }]
        }
      ]
    }
    const { s, deps, sent } = make({ game: "sr", raw })
    await challengePeak(s, deps)

    expect(sent.apis).toEqual(["challengePeak"])
    expect(sent.images[0]?.name).toBe("sr/peak-challenge")
    // 金牌是官方编号的第 2 档 —— 那张表不按奖牌高低排
    expect(sent.images[0]?.data["iconType"]).toBe(2)
    expect(sent.images[0]?.data["nickname"]).toBe("其实雨很好")
  })

  it("异相仲裁的形态又变了时说实话，不说成「尚无战绩」", async () => {
    const { s, deps, sent } = make({ game: "sr", raw: {} })
    await challengePeak(s, deps)

    expect(sent.images).toEqual([])
    expect(sent.texts.join("")).toContain("形态可能已变")
    // 不能说成"尚无战绩"：那会让人打完一局再来看同一句话
    expect(sent.texts.join("")).not.toContain("尚无战绩")
  })

  it("上期取 groups 的第 1 项 —— 恒取第 0 项会让上期那张图印着本期的期次", async () => {
    const raw = {
      ...SR_OK,
      groups: [{ name_mi18n: "第 20 期" }, { name_mi18n: "第 19 期" }]
    }
    const { s, deps, sent } = make({ game: "sr", raw, rest: "上期" })
    await challengeStory(s, deps)

    const story = sent.images[0]?.data["story"] as { season: string }
    expect(story.season).toBe("第 19 期")
  })

  it("没有渲染器时退回文字", async () => {
    const { s, deps, sent } = make({ game: "sr", raw: SR_OK, imageOk: false })
    await challengeBoss(s, deps)

    expect(sent.texts.join("")).toContain("末日幻影")
    expect(sent.texts.join("")).toContain("花火")
  })

  it("取数失败时把原因说出来", async () => {
    const { s, deps, sent } = make({ game: "sr", rawOk: false })
    await challengePeak(s, deps)

    expect(sent.texts.join("")).toContain("请先绑定角色")
    expect(sent.images).toEqual([])
  })

  it("非星铁明确说明，一个请求都不发", async () => {
    for (const game of ["gs", "zzz"] as const) {
      const { s, deps, sent } = make({ game })
      await challengeStory(s, deps)

      expect(sent.apis, game).toEqual([])
      expect(sent.texts.join(""), game).toContain("只有星穹铁道有")
    }
  })
})
