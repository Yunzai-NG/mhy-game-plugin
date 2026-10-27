/**
 * 模块职责：活动日历视图的测试 —— 三个游戏的卡池、活动行取值与出没，以及文字回退
 * 依赖方向：测试文件，依赖 views/act-calendar 与夹具；纯函数
 * 生命周期：无状态
 * 注意事项：钉住官方页那几句时间措辞（三个游戏各一套）与「图只从元数据和插件资源取」（绝区零调频格子
 *          元数据缺时退用接口图是唯一例外）；
 *          另钉字段缺失不抛错 —— 米游社增减字段不作通知，视图要接得住一份近乎为空的 data。
 */
import { describe, expect, it } from "vitest"
import type { ActContext, ActRow } from "./act-calendar.js"
import { actCalendarText, buildActCalendar } from "./act-calendar.js"
import { ACT_NOW, GS_ACT, SR_ACT, ZZZ_ACT } from "./act-calendar-fixtures.test-data.js"

/**
 * 造上下文：元数据按名字给一张假图，奖励图只认原石、星琼
 * @param game 游戏
 * @returns 上下文
 */
function ctxOf(game: ActContext["game"]): ActContext {
  return {
    game,
    uid: "100000001",
    name: "某人",
    now: ACT_NOW,
    item: (kind, _id, name) => (name ? { face: `meta-${game}/${kind}/${name}.webp`, star: 0, elem: "" } : undefined),
    reward: name => (["原石", "星琼"].includes(name) ? `${game}/act-calendar/奖励/${name}.png` : ""),
    has: () => false
  }
}

/**
 * 按名字取一条活动
 * @param rows 全部活动
 * @param name 名字
 * @returns 那一条
 */
function rowNamed(rows: ActRow[], name: string): ActRow {
  const got = rows.find(r => r.name === name)
  if (!got) throw new Error(`no row ${name}`)
  return got
}

describe("原神活动日历", () => {
  const view = buildActCalendar(GS_ACT, ctxOf("gs"))
  const rows = view.sections.flatMap(s => s.blocks.flatMap(b => b.rows))

  it("卡池按角色 / 武器分组，进行中的印剩余时间，未开启的只印状态", () => {
    expect(view.poolTitle).toBe("活动祈愿")
    expect(view.groups.map(g => g.title)).toEqual(["角色", "武器"])
    const [on, off] = view.groups[0]?.pools ?? []
    expect(on).toMatchObject({ version: "7.1", status: "active", time: "剩余时间: 16天9时30分", state: "进行中" })
    expect(off).toMatchObject({ status: "pending", time: "", state: "未开启" })
  })

  it("角色挂元素角标，武器池只放武器；头像取元数据而非接口", () => {
    const hutao = view.groups[0]?.pools[0]?.faces[0]
    expect(hutao).toMatchObject({ face: "meta-gs/char/胡桃.webp", elem: "pyro" })
    expect(hutao?.badges).toEqual([{ icon: "gs/element/pyro.png", at: "bl" }])
    expect(view.groups[1]?.pools[0]?.faces.map(f => f.face)).toEqual(["meta-gs/weapon/护摩之杖.webp"])
  })

  it("限时活动：不足三天高亮；摩拉只印图不印数；已完成画勾；未开启印「未开启」；ActTypeNone 不画", () => {
    expect(rowNamed(rows, "流光拾遗之月")).toMatchObject({ hot: true, reward: "420", rewardIcon: "gs/act-calendar/奖励/原石.png", value: "进行中" })
    expect(rowNamed(rows, "冒险家试炼")).toMatchObject({ hot: false, reward: "", rewardName: "摩拉", value: "2", total: "/3", desc: "剩余双倍次数" })
    expect(rowNamed(rows, "绘想签到")).toMatchObject({ status: "done", done: true })
    expect(rowNamed(rows, "下期活动")).toMatchObject({ status: "pending", time: "", value: "未开启", text: true })
    expect(rows.some(r => r.name === "不画")).toBe(false)
  })

  it("深渊与剧诗各有一套时间措辞；幽境危战挂勋章与紊乱爆发期", () => {
    expect(rowNamed(rows, "深境螺旋")).toMatchObject({
      time: "距渊月螺旋重置还有28天22小时",
      value: "36/36",
      post: "star"
    })
    expect(rowNamed(rows, "幻想真境剧诗")).toMatchObject({ time: "剩余时间：13天22小时", value: "第10幕", desc: "圣牌2" })
    const hard = rowNamed(rows, "幽境危战")
    expect(hard).toMatchObject({ pre: "gs/act-calendar/勋章-6.png", value: "241秒", desc: "最佳纪录" })
    expect(hard.sub).toMatchObject({ label: "紊乱爆发期", time: "2天1时1分", hot: true, value: "1", total: "/3" })
  })

  it("进行中的挂倒计时线：长度是剩余占全程，刚开始 / 中段 / 将结束三色；未开启与已完成不挂", () => {
    expect(view.groups[0]?.pools[0]?.bar).toEqual({ pct: 78, tone: "fresh" })
    expect(view.groups[0]?.pools[1]?.bar).toBeUndefined()
    expect(rowNamed(rows, "冒险家试炼").bar).toEqual({ pct: 48, tone: "mid" })
    // 不给起止时间：整条画满，只按剩余换色
    expect(rowNamed(rows, "流光拾遗之月").bar).toEqual({ pct: 100, tone: "end" })
    expect(rowNamed(rows, "绘想签到").bar).toBeUndefined()
    expect(rowNamed(rows, "下期活动").bar).toBeUndefined()
  })

  it("详细奖励逐项列出：万以上折成「万」、没给数量不印数、没名字的不画；有这一排时右侧不再印那件", () => {
    const tower = rowNamed(rows, "深境螺旋")
    expect(tower.items).toEqual([
      { name: "原石", icon: "gs/act-calendar/奖励/原石.png", num: "×800", star: 5 },
      { name: "摩拉", icon: "", num: "×12.5万", star: 3 },
      { name: "大英雄的经验", icon: "", num: "×12", star: 4 },
      { name: "「自由」的指引", icon: "", num: "", star: 3 }
    ])
    expect(tower).toMatchObject({ reward: "", rewardIcon: "", rewardName: "" })
  })

  it("详细奖励只有右侧那一件时不画这一排，右侧照印", () => {
    expect(rowNamed(rows, "流光拾遗之月")).toMatchObject({ items: [], reward: "420", rewardIcon: "gs/act-calendar/奖励/原石.png" })
    expect(rowNamed(rows, "冒险家试炼")).toMatchObject({ items: [], rewardName: "摩拉" })
  })

  it("限时活动与常驻玩法分两块", () => {
    expect(view.sections).toHaveLength(1)
    expect(view.sections[0]?.blocks.map(b => b.rows.length)).toEqual([4, 3])
  })
})

describe("星铁活动日历", () => {
  const view = buildActCalendar(SR_ACT, ctxOf("sr"))
  const [acts, chasm] = view.sections
  const actRows = acts?.blocks[0]?.rows ?? []
  const chasmRows = chasm?.blocks[0]?.rows ?? []

  it("当期卡池印余量；版本后才开的卡池在下一版本时印「…后开启」", () => {
    const on = view.groups[0]?.pools[0]
    expect(on).toMatchObject({ version: "4.6", name: "韶艾栽英", status: "active", time: "3天7小时", timeIcon: "clock" })
    // 没名字的那一格不画
    expect(on?.faces.map(f => f.name)).toEqual(["花火", "三月七"])
    expect(view.groups[1]?.pools[0]).toMatchObject({ status: "pending", time: "3天7小时后开启", timeIcon: "" })
  })

  it("活动：进行中 / 双倍次数 / 已完成画勾 / 未开启", () => {
    expect(rowNamed(actRows, "星芒战幕")).toMatchObject({ value: "进行中", reward: "", rewardIcon: "" })
    expect(rowNamed(actRows, "花藏繁生")).toMatchObject({ value: "2", total: "/3", light: true, desc: "今日剩余", hot: true })
    expect(rowNamed(actRows, "巡星之礼")).toMatchObject({ done: true, rewardIcon: "", rewardName: "星轨专票", reward: "×10" })
    expect(rowNamed(actRows, "下期活动")).toMatchObject({ status: "pending", time: "3天7小时后开启", timeIcon: "", value: "未开启" })
  })

  it("详细奖励取 reward_list，图走奖励图表；只给 special_reward 的没有这一行、右侧照印", () => {
    expect(rowNamed(actRows, "星芒战幕").items).toEqual([
      { name: "星琼", icon: "sr/act-calendar/奖励/星琼.png", num: "×500", star: 5 },
      { name: "信用点", icon: "", num: "×8000", star: 3 }
    ])
    expect(rowNamed(actRows, "巡星之礼").items).toEqual([])
  })

  it("逐光捡金：类型图、星数、满星额外标记、不足一天高亮", () => {
    expect(chasm?.title).toBe("逐光捡金")
    expect(rowNamed(chasmRows, "虚构叙事·天外乐章")).toMatchObject({
      icon: "sr/act-calendar/虚构叙事.svg",
      value: "10",
      total: "/12",
      time: "23小时",
      hot: true
    })
    expect(rowNamed(chasmRows, "末日幻影·混沌之海")).toMatchObject({ status: "done", value: "12", light: false, post: "sr/act-calendar/额外星.png" })
    expect(rowNamed(chasmRows, "异相仲裁·王座之上")).toMatchObject({ value: "未开启", time: "3天7小时后开启" })
  })

  it("倒计时线按接口的起止与 now 算：当期卡池剩 79 小时、全程 319 小时", () => {
    expect(view.groups[0]?.pools[0]?.bar).toEqual({ pct: 25, tone: "mid" })
    expect(view.groups[1]?.pools[0]?.bar).toBeUndefined()
    expect(rowNamed(chasmRows, "虚构叙事·天外乐章").bar?.tone).toBe("end")
    expect(rowNamed(chasmRows, "末日幻影·混沌之海").bar).toBeUndefined()
  })

  it("全部完成与空列表各印一句右注", () => {
    const done = buildActCalendar({ act_list: [{ act_type: "ActivityTypeSign", act_status: "SignStatusFinish" }] }, ctxOf("sr"))
    expect(done.sections[0]?.note).toBe("已全部完成")
    expect(done.sections[1]).toMatchObject({ note: "敬请期待", blocks: [] })
  })
})

describe("绝区零活动日历", () => {
  const view = buildActCalendar(ZZZ_ACT, ctxOf("zzz"))
  const rows = view.sections[0]?.blocks[0]?.rows ?? []

  it("调频：两位补零的余量、未开启的带锁、重映挂保底说明", () => {
    const [on, off] = view.groups[0]?.pools ?? []
    expect(on).toMatchObject({ version: "3.2", name: "独家频段", time: "02天09时", timeIcon: "clock" })
    expect(off).toMatchObject({ status: "pending", time: "03天03小时后开启", timeIcon: "lock" })
    expect(view.groups[1]?.pools[0]).toMatchObject({ name: "音擎回响", time: "22小时", note: "首次S信号必定为UP音擎　未生效" })
  })

  it("代理人格子：稀有度与属性角标；职业图不在时不挂", () => {
    const ya = view.groups[0]?.pools[0]?.faces[0]
    expect(ya).toMatchObject({ star: 5, elem: "ice", rank: "S" })
    expect(ya?.badges).toEqual([{ icon: "meta-zzz/character/common/imgs/ice.webp", at: "bl" }])
    expect(view.groups[0]?.pools[0]?.faces[1]).toMatchObject({ star: 4, rank: "A" })
  })

  it("职业图放进去就挂上", () => {
    const got = buildActCalendar(ZZZ_ACT, { ...ctxOf("zzz"), has: rel => rel.endsWith("职业-异常.png") })
    expect(got.groups[0]?.pools[0]?.faces[0]?.badges).toContainEqual({ icon: "zzz/act-calendar/职业-异常.png", at: "br" })
  })

  it("元数据查得到用元数据的图，查不到才用接口给的 https 图", () => {
    const api = "https://a.invalid/zzz-face.png"
    const pool = ZZZ_ACT.gacha?.avatar_gacha_schedule_list?.[0]
    const raw = {
      gacha: {
        avatar_gacha_schedule_list: [
          { ...pool, avatar_list: (pool?.avatar_list ?? []).map(a => ({ ...a, icon: api })) }
        ]
      }
    }
    const metaOnlyYa: ActContext = { ...ctxOf("zzz"), item: (_k, _id, name) => (name === "雅" ? { face: "meta-zzz/雅.webp", star: 5 } : undefined) }
    const faces = buildActCalendar(raw, metaOnlyYa).groups[0]?.pools[0]?.faces ?? []
    expect(faces.map(f => f.face)).toEqual(["meta-zzz/雅.webp", api])
    const noApi = buildActCalendar(ZZZ_ACT, { ...ctxOf("zzz"), item: () => undefined }).groups[0]?.pools[0]?.faces ?? []
    expect(noApi.map(f => f.face)).toEqual(["", ""])
  })

  it("倒计时线只按剩余换色、长度恒满（接口不给开始时刻）", () => {
    expect(view.groups[0]?.pools[0]?.bar).toEqual({ pct: 100, tone: "end" })
    expect(view.groups[0]?.pools[1]?.bar).toBeUndefined()
    expect(rowNamed(rows, "限时挑战").bar).toEqual({ pct: 100, tone: "end" })
    expect(rowNamed(rows, "惊喜放映企划").bar).toBeUndefined()
  })

  it("活动：已完成压暗带勾、未开启只印总数", () => {
    expect(rowNamed(rows, "惊喜放映企划")).toMatchObject({ dim: true, check: true, reward: "300/300", time: "01天22时" })
    expect(rowNamed(rows, "限时挑战")).toMatchObject({ status: "active", reward: "150/800", time: "22小时", rewardIcon: "zzz/act-calendar/菲林.png" })
    expect(rowNamed(rows, "下期活动")).toMatchObject({ status: "pending", reward: "600", timeIcon: "lock" })
  })

  it("只有一条接口拿到数据时另一块不画", () => {
    const got = buildActCalendar({ activity: ZZZ_ACT.activity ?? {} }, ctxOf("zzz"))
    expect(got.groups).toEqual([])
    expect(got.sections[0]?.blocks[0]?.rows).toHaveLength(3)
  })
})

describe("空数据与文字回退", () => {
  it.each(["gs", "sr", "zzz"] as const)("%s：空 data 不抛错", game => {
    const view = buildActCalendar({}, ctxOf(game))
    expect(view.groups).toEqual([])
    expect(view.game).toBe(game)
  })

  it("文字版列卡池与活动名，没有图片地址", () => {
    const text = actCalendarText(buildActCalendar(GS_ACT, ctxOf("gs")))
    expect(text).toContain("【活动祈愿·角色】")
    expect(text).toContain("7.1 角色活动祈愿　剩余时间: 16天9时30分")
    expect(text).toContain("胡桃、行秋")
    expect(text).toContain("绘想签到　已完成")
    expect(text).not.toContain("http")
  })
})
