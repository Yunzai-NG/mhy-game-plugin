/**
 * 模块职责：绝区零面板命令的测试
 * 依赖方向：测试文件，依赖 commands/zzz/panel、commands/panel（分派）与一份假的会话与依赖
 * 生命周期：无状态
 * 注意事项：最要紧的一条是**取数的请求次数** —— 三十位代理人逐个问即三十次已鉴权请求，那正是触发
 *          风控的形态，故做成「先合批、不成再逐个、逐个有上限」，五种情形各一例。更新出的是同一张
 *          列表图（多带标记与提示）而**不另回文字**，故那几条断言看图上的 `msg` 与 `isNew` /
 *          `isUpdate`。另钉住三条命令在绝区零那一路的分派落点：改错不报错，只走回「暂无面板服务」。
 */
import { describe, expect, it, vi } from "vitest"
import type { Session } from "../../core/session.js"
import type { MhyDeps } from "../deps.js"
import { artisEntry, mysRefreshPanel, panelEntry, panelStat, refreshPanel, refreshPanelEntry } from "../panel.js"
import { zzzCharPanel, zzzPanelList, zzzRefreshPanel } from "./panel.js"

/** 一次调用的记录 */
interface Sent {
  /** 回过的文字 */
  texts: string[]
  /** 出过的图 */
  images: { name: string; data: Record<string, unknown> }[]
  /** 打过的接口与参数 */
  calls: { api: string; ids?: (string | number)[] }[]
  /** 落库过的面板 */
  merged: Record<string, unknown>[]
}

/**
 * 造一位 `avatar/info` 形态的代理人
 * @param id 代理人 id
 * @param name 名称
 * @returns 返回里的一位
 */
function detail(id: number, name: string): Record<string, unknown> {
  return {
    id,
    level: 60,
    name_mi18n: name,
    rarity: "S",
    rank: 2,
    element_type: 200,
    avatar_profession: 1,
    weapon: { id: 14_143, name: "云霓孤光", level: 60, star: 1, rarity: "S" },
    equip: [1, 2, 3, 4, 5, 6].map(pos => ({
      id: 33_540 + pos,
      level: 15,
      name: `沧浪行歌[${pos}]`,
      rarity: "S",
      equipment_type: pos,
      properties: [{ property_name: "暴击伤害", property_id: 21_103, base: "9.6%", level: 2, add: 1 }],
      main_properties: [{ property_name: "攻击力", property_id: 12_103, base: "316", level: 1, add: 0 }],
      equip_suit: { suit_id: 33_500, name: "沧浪行歌", own: 6 }
    })),
    properties: [
      { property_name: "生命值", property_id: 1, base: "7673", add: "3345", final: "11018" },
      { property_name: "攻击力", property_id: 2, base: "1681", add: "1079", final: "2760" }
    ],
    skills: [{ level: 12, skill_type: 0 }]
  }
}

/**
 * 造一个会话与一份依赖
 * @param answers 名下有哪些代理人、`avatar/info` 每次回几位、出不出得了图、命令后面跟什么
 * @returns 会话、依赖与记录
 */
function make(answers: {
  /** `avatar/basic` 给回的代理人，`[id, 名称, 等级]` */
  roster?: [number, string, number][]
  /** `avatar/info` 每次最多回几位；不给即照问的全回 */
  perCall?: number
  /** 第几次 `avatar/info` 起开始失败，1 起 */
  failAt?: number
  /** 为真时只有「一次问多个 id」那种请求失败，逐个问的照常成功 */
  failMulti?: boolean
  /** 失败的归类，缺省 `http`；`risk` 一类不该退回逐个 */
  failKind?: string
  /** 库里已经存了哪些代理人 */
  stored?: Record<string, unknown>
  /** 出图是否成功 */
  imageOk?: boolean
  /** 命令后面跟的那一串 */
  rest?: string
  /** 绑定的 uid，空串表示没绑 */
  uid?: string
  /** 挑到的源标识，缺省米游社；填 `enkaZZZ` 走 Enka 那条（不打米游社请求） */
  serv?: string
  /** 元数据在不在位；为假模拟"没装元数据" */
  metaReady?: boolean
  /** 为真时元数据在位但这一位没有倍率表，对应"这一位不在包里" */
  noTalent?: boolean
  /** `#更新面板` 缺省是否走米游社（panelUpdateByMys） */
  panelByMys?: boolean
  /** 该 uid 有没有绑 Cookie */
  hasCk?: boolean
}): { s: Session; deps: MhyDeps; sent: Sent } {
  const sent: Sent = { texts: [], images: [], calls: [], merged: [] }
  const roster = answers.roster ?? [[1431, "叶瞬光", 60]]
  let infoCalls = 0

  const s = {
    user: "onebot11:1",
    name: "绳匠",
    rest: answers.rest ?? "",
    game: "zzz",
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

  const avatars: Record<string, unknown> = { ...(answers.stored ?? {}) }
  let profileAt: number | undefined
  const deps = {
    config: (): Record<string, unknown> => ({ enableCustomSplash: false, panelUpdateByMys: answers.panelByMys ?? false }),
    users: { uid: async (): Promise<string> => answers.uid ?? "1300000001" },
    cookies: { find: async (): Promise<Record<string, unknown> | undefined> => (answers.hasCk ? { ltuid: "1" } : undefined) },
    mys: {
      query: async (
        api: string,
        opts: { data?: { id_list?: (string | number)[] } }
      ): Promise<Record<string, unknown>> => {
        const ids = opts.data?.id_list
        sent.calls.push({ api, ...(ids ? { ids } : {}) })
        if (api === "character") {
          return {
            ok: true,
            uid: "1300000001",
            data: { avatar_list: roster.map(([id, name, level]) => ({ id, name_mi18n: name, level, rarity: "S" })) }
          }
        }
        infoCalls++
        const kind = answers.failKind ?? "http"
        if (answers.failAt !== undefined && infoCalls >= answers.failAt) {
          return { ok: false, kind, message: "连不上" }
        }
        if (answers.failMulti && (ids ?? []).length > 1) {
          return { ok: false, kind, message: "网页异常，请重新打开或联系客服" }
        }
        const want = (ids ?? []).slice(0, answers.perCall ?? (ids ?? []).length)
        const list = want.map(id => detail(Number(id), roster.find(one => one[0] === Number(id))?.[1] ?? "未知"))
        return { ok: true, uid: "1300000001", data: { avatar_list: list } }
      }
    },
    panels: {
      of: () => ({
        // `profileAt` 照真实实现在合并时写下：图上那句「更新于」读的就是它
        load: async (): Promise<Record<string, unknown>> => ({
          game: "zzz",
          uid: "1300000001",
          avatars,
          ...(profileAt === undefined ? {} : { profileAt })
        }),
        avatar: async (_g: string, _uid: string, id: string): Promise<unknown> => avatars[id],
        merge: async (profile: { avatars: Record<string, Record<string, unknown>> }): Promise<unknown> => {
          sent.merged.push(profile)
          profileAt = Date.now()
          const ids = Object.keys(profile.avatars)
          for (const id of ids) avatars[id] = { ...profile.avatars[id], from: "mysPanelZZZ" }
          return { updated: ids, changed: ids }
        }
      })
    },
    panel: {
      cooldown: async (): Promise<number> => 0,
      setCooldown: async (): Promise<void> => undefined,
      // 缺省挑到米游社源，故这些用例走的是「先合批取数、再喂给源」那条；填 serv:enkaZZZ 走 Enka 那条
      pick: (): { id: string } => ({ id: answers.serv ?? "mysPanelZZZ" }),
      // Enka 那条（无 data）不打米游社请求，直接给一份现成的展柜面板
      fetch: async (_user: string, uid: string, _game: string, opts: { data?: unknown } = {}): Promise<unknown> => {
        if (opts.data === undefined) {
          const profile = {
            game: "zzz",
            uid,
            from: "enkaZZZ",
            avatars: { "1431": { id: "1431", level: 60, cons: 0, zzz: { name: "叶瞬光", rank: "S", attrs: [], discs: [{ pos: 1 }] } } }
          }
          return { result: { ok: true, profile, cd: 60 }, serv: { name: "Enka 展柜" } }
        }
        const mod = await import("../../panel/serv/zzz.js")
        // 属性本地算，故解析要一份 ready 的元数据 + 每位的基础数据块；metaReady:false 时不 ready，parse 回 noMeta
        const meta = {
          ready: (): boolean => answers.metaReady !== false,
          byId: (): undefined => undefined,
          detail: (_g: string, _id: string): Record<string, unknown> | undefined =>
            answers.metaReady === false
              ? undefined
              : { attr: { hp_max: 600, attack: 100, defence: 50, crit: 500, crit_damage: 5000 } }
        } as never
        return { result: mod.parseMysZzz(opts.data, { meta, uid }), serv: { name: "米游社" } }
      }
    },
    meta: {
      loader: {
        ready: (): boolean => answers.metaReady !== false,
        // 图标一律按名字拼路径，这一支只判"元数据里有没有那张图"；测试里一律当作有
        exists: (): boolean => true,
        byId: (): undefined => undefined,
        byName: (_g: string, name: string): { id: string; name: string; abbr: string } | undefined => {
          const hit = roster.find(one => one[1] === name)
          return hit ? { id: String(hit[0]), name: hit[1], abbr: hit[1] } : undefined
        },
        // `noTalent` 为真时给一份没有倍率的详情，对应"元数据装了但这一位不在包里"，
        // 与"整个没装"是两回事，两者提示语不同
        detail: (_g: string, _id: string): Record<string, unknown> | undefined => {
          if (answers.noTalent) return {}
          return {
            talent: {
              basic: {
                name: "普通攻击",
                tables: [
                  { name: "一段伤害倍率", values: ["100%", "110%", "120%"] },
                  { name: "一段失衡倍率", values: ["50%", "55%", "60%"] }
                ]
              },
              chain: { name: "连携技", tables: [{ name: "伤害倍率", values: ["300%", "330%", "360%"] }] }
            }
          }
        }
      }
    }
  } as unknown as MhyDeps

  return { s, deps, sent }
}

describe("取数的请求次数", () => {
  it("合批一次问全部；服务端认多个 id 时只花两个请求", async () => {
    const { s, deps, sent } = make({
      roster: [
        [1431, "叶瞬光", 60],
        [1091, "雅", 60],
        [1011, "安比", 50]
      ]
    })
    await zzzRefreshPanel(s, deps)

    // 更新完顺手出一张列表，而那一张只读库，故整条命令就两个请求
    expect(sent.calls.map(it => it.api)).toEqual(["character", "avatarInfo"])
    expect(sent.calls[1]?.ids).toEqual(["1431", "1091", "1011"])
    expect(sent.texts).toHaveLength(0)
    expect(sent.images.at(-1)?.data["msg"]).toContain("本次取到 3 位代理人")
  })

  it("配置选 Enka 时走展柜、一个米游社请求都不打", async () => {
    const { s, deps, sent } = make({ serv: "enkaZZZ", roster: [[1431, "叶瞬光", 60]] })
    await zzzRefreshPanel(s, deps)

    expect(sent.calls).toHaveLength(0)
    expect(sent.merged).toHaveLength(1)
    expect(sent.images.at(-1)?.data["msg"]).toContain("Enka")
  })

  it("合批只回一位时对余下的逐个补问", async () => {
    vi.useFakeTimers()
    try {
      const { s, deps, sent } = make({
        roster: [
          [1431, "叶瞬光", 60],
          [1091, "雅", 60]
        ],
        perCall: 1
      })
      const done = zzzRefreshPanel(s, deps)
      await vi.runAllTimersAsync()
      await done

      const info = sent.calls.filter(it => it.api === "avatarInfo")
      expect(info).toHaveLength(2)
      expect(info[0]?.ids).toEqual(["1431", "1091"])
      expect(info[1]?.ids).toEqual(["1091"])
      expect(sent.images.at(-1)?.data["msg"]).toContain("本次取到 2 位代理人")
    } finally {
      vi.useRealTimers()
    }
  })

  it("补问中途失败就地停住 —— 接着问下去只会把风控引到使用者的凭据上", async () => {
    vi.useFakeTimers()
    try {
      const { s, deps, sent } = make({
        roster: [
          [1431, "叶瞬光", 60],
          [1091, "雅", 60],
          [1011, "安比", 50]
        ],
        perCall: 1,
        failAt: 2
      })
      const done = zzzRefreshPanel(s, deps)
      await vi.runAllTimersAsync()
      await done

      expect(sent.calls.filter(it => it.api === "avatarInfo")).toHaveLength(2)
      const msg = String(sent.images.at(-1)?.data["msg"])
      expect(msg).toContain("本次取到 1 位代理人")
      expect(msg).toContain("另有 2 位未取")
    } finally {
      vi.useRealTimers()
    }
  })

  it("没绑 uid 时不发任何请求", async () => {
    const { s, deps, sent } = make({ uid: "" })
    await zzzRefreshPanel(s, deps)
    expect(sent.calls).toHaveLength(0)
    expect(sent.texts[0]).toContain("绑定uid")
  })

  it("合批整批报错时退回逐个问 —— 「不成」包含「报错」，不只是「回得少」", async () => {
    vi.useFakeTimers()
    try {
      const { s, deps, sent } = make({
        roster: [
          [1431, "叶瞬光", 60],
          [1091, "雅", 60]
        ],
        failMulti: true
      })
      const done = zzzRefreshPanel(s, deps)
      await vi.runAllTimersAsync()
      await done

      const info = sent.calls.filter(it => it.api === "avatarInfo")
      expect(info.map(it => it.ids)).toEqual([["1431", "1091"], ["1431"], ["1091"]])
      expect(sent.images.at(-1)?.data["msg"]).toContain("本次取到 2 位代理人")
    } finally {
      vi.useRealTimers()
    }
  })

  it("合批因风控失败时就地停住 —— 逐个再问十六次只会把风控引到使用者的凭据上", async () => {
    const { s, deps, sent } = make({
      roster: [
        [1431, "叶瞬光", 60],
        [1091, "雅", 60],
        [1011, "安比", 50]
      ],
      failMulti: true,
      failKind: "risk"
    })
    await zzzRefreshPanel(s, deps)

    expect(sent.calls.filter(it => it.api === "avatarInfo")).toHaveLength(1)
    expect(sent.images).toHaveLength(0)
    expect(sent.texts[0]).toContain("验证")
  })
})

describe("单个代理人", () => {
  it("库里没有这一位时当场只问一个 id", async () => {
    const { s, deps, sent } = make({ rest: "叶瞬光面板" })
    await zzzCharPanel(s, deps)

    expect(sent.calls.map(it => it.api)).toEqual(["avatarInfo"])
    expect(sent.calls[0]?.ids).toEqual(["1431"])
    expect(sent.images[0]?.name).toBe("character/profile-detail")
  })

  it("库里已有时一个请求都不发", async () => {
    const { s, deps, sent } = make({ rest: "叶瞬光面板" })
    await zzzRefreshPanel(s, deps)
    sent.calls.length = 0
    await zzzCharPanel(s, deps)

    expect(sent.calls).toHaveLength(0)
    expect(sent.images.at(-1)?.name).toBe("character/profile-detail")
  })

  it("认不出名字时说清是名字的问题，而不是静默", async () => {
    const { s, deps, sent } = make({ rest: "不存在的人面板" })
    await zzzCharPanel(s, deps)
    expect(sent.calls).toHaveLength(0)
    expect(sent.texts[0]).toContain("认不出")
  })

  it("那一位没装驱动盘时说的是「去练」而不是「服务出问题了」", async () => {
    const { s, deps, sent } = make({ rest: "叶瞬光面板" })
    const raw = deps.mys.query.bind(deps.mys)
    deps.mys.query = (async (api: string, opts: never) => {
      const got = (await raw(api, opts)) as { ok: boolean; data?: { avatar_list?: Record<string, unknown>[] } }
      if (api === "avatarInfo" && got.data?.avatar_list?.[0]) got.data.avatar_list[0]["equip"] = []
      return got
    }) as typeof deps.mys.query
    await zzzCharPanel(s, deps)

    expect(sent.images).toHaveLength(0)
    expect(sent.texts[0]).toContain("还没装驱动盘")
  })
})

describe("分派", () => {
  it("`#面板` 不带名字看列表，带名字看那一位", async () => {
    const { s, deps, sent } = make({ rest: "叶瞬光面板" })
    await zzzRefreshPanel(s, deps)
    sent.images.length = 0

    await panelEntry(s, deps)
    expect(sent.images.at(-1)?.name).toBe("character/profile-detail")

    const bare = make({ rest: "", stored: {} })
    await zzzRefreshPanel(bare.s, bare.deps)
    bare.sent.images.length = 0
    await panelEntry(bare.s, bare.deps)
    expect(bare.sent.images.at(-1)?.name).toBe("character/profile-list")
  })

  it("`#面板` 认不出的名字说清楚、不退回列表 —— 退列表看着像这命令只会出列表", async () => {
    const { s, deps, sent } = make({ rest: "绫华面板" })
    await panelEntry(s, deps)

    expect(sent.images).toHaveLength(0)
    expect(sent.texts.at(-1)).toContain("没有「绫华」")
  })

  it("`#驱动盘` 带名字时落到那一位的面板图上", async () => {
    const { s, deps, sent } = make({ rest: "叶瞬光驱动盘" })
    await artisEntry(s, deps)
    expect(sent.images.at(-1)?.name).toBe("character/profile-detail")
  })

  it("`#练度统计` 只读本地库，一个米游社请求都不打", async () => {
    const { s, deps, sent } = make({
      roster: [
        [1431, "叶瞬光", 60],
        [1021, "猫又", 60]
      ]
    })
    await zzzRefreshPanel(s, deps)
    sent.calls.length = 0
    sent.images.length = 0

    await panelStat(s, deps)

    expect(sent.calls).toHaveLength(0)
    expect(sent.images[0]?.name).toBe("character/profile-stat")
    expect((sent.images[0]?.data["avatars"] as unknown[]).length).toBe(2)
  })

  it("库里没有面板时，让人先去更新而不是空表", async () => {
    const { s, deps, sent } = make({ stored: {} })
    await panelStat(s, deps)

    expect(sent.calls).toHaveLength(0)
    expect(sent.images).toHaveLength(0)
    expect(sent.texts[0]).toContain("#绝区零更新面板")
  })

  it("`#更新面板` 缺省开启且该 uid 绑了 CK：走米游社", async () => {
    const { s, deps, sent } = make({ panelByMys: true, hasCk: true })
    await refreshPanelEntry(s, deps)
    expect(sent.calls.map(it => it.api)).toContain("avatarInfo")
  })

  it("`#更新面板` 没绑 CK：回落 Enka 展柜（绝区零也有 Enka），不打米游社", async () => {
    const { s, deps, sent } = make({ panelByMys: true, hasCk: false })
    await refreshPanelEntry(s, deps)
    expect(sent.calls.map(it => it.api)).not.toContain("avatarInfo")
    expect(sent.merged[0]?.["from"]).toBe("enkaZZZ")
  })

  it("`#展柜更新面板` 指名走 Enka —— 按配置选会落回米游社、与命令名对不上", async () => {
    // 配置缺省指米游社（make 不填 serv 即 mysPanelZZZ），这条仍须走展柜、一个米游社请求都不打
    const { s, deps, sent } = make({})
    await refreshPanel(s, deps)

    expect(sent.calls.map(it => it.api)).not.toContain("avatarInfo")
    expect(sent.merged[0]?.["from"]).toBe("enkaZZZ")
  })

  it("`#米游社更新面板` 指名走米游社 —— 配置选了 Enka 也照走", async () => {
    const { s, deps, sent } = make({ serv: "enkaZZZ" })
    await mysRefreshPanel(s, deps)

    expect(sent.calls.map(it => it.api)).toContain("avatarInfo")
  })
})

describe("面板列表", () => {
  it("一位都没有时给出可照做的一句话", async () => {
    const { s, deps, sent } = make({})
    await zzzPanelList(s, deps)
    expect(sent.images).toHaveLength(0)
    expect(sent.texts[0]).toContain("#绝区零更新面板")
  })

  it("出图失败时回文字，且带上位数", async () => {
    const { s, deps, sent } = make({ imageOk: false })
    await zzzRefreshPanel(s, deps)
    expect(sent.texts.at(-1)).toContain("共 1 位代理人有面板数据")
  })

  it("直接看列表时不带本次更新那几项 —— 那张图上只该剩「更新时间」", async () => {
    const { s, deps, sent } = make({
      roster: [
        [1431, "叶瞬光", 60],
        [1091, "雅", 60]
      ]
    })
    await zzzRefreshPanel(s, deps)
    sent.images.length = 0

    await zzzPanelList(s, deps)
    const data = sent.images.at(-1)?.data
    expect(data?.["msg"]).toBe("")
    expect(data?.["hasNew"]).toBe(false)
    expect((data?.["chars"] as { isNew: number }[]).every(one => one.isNew === 0)).toBe(true)
    expect((data?.["updateTime"] as { profile?: string }).profile).toBeTruthy()
  })

  it("更新之后有变化的排在最前，且逐位带上标记", async () => {
    const { s, deps, sent } = make({
      roster: [
        [1011, "安比", 50],
        [1431, "叶瞬光", 60]
      ]
    })
    await zzzRefreshPanel(s, deps)

    const list = sent.images.at(-1)?.data["chars"] as { id: string; isNew: number; isUpdate: number }[]
    expect(list.every(one => one.isNew === 1 && one.isUpdate === 1)).toBe(true)
    expect(sent.images.at(-1)?.data["hasNew"]).toBe(true)
  })
})
