/**
 * 模块职责：日历视图的测试
 * 依赖方向：测试文件，只依赖 views/calendar 与 core/when；无 IO
 * 生命周期：无状态；时刻一律显式传入，不取系统时间
 * 注意事项：固定四处"错了不报错、只是画歪"的口径：时间窗是今天前后各六天共十三天（起点当天零点、
 *          终点当天 23:59:59）、进度条的裁剪与收录是两回事（`left`/`width` 按裁剪后算、"要不要"
 *          按未裁剪的起止算，反了会让跨窗的长期活动整条消失）、两个游戏的深渊轮换算法完全不同
 *          （星铁对齐锚点时交换首末标题）、配对成行的判据是"我结束不晚于对方开始"且不与自己配对。
 */
import { fullTime } from "../core/when.js"
import { describe, expect, it } from "vitest"
import type { AnnItem } from "../service/calendar.js"
import type { CalCharInput, CalItem, CalItemCtx, CalTalentInput } from "./calendar.js"
import {
  abyssType,
  buildCalendar,
  buildItem,
  calendarText,
  charBirthOf,
  charTalentOf,
  dateWindow,
  gsAbyssSpans,
  gsClassify,
  mergeRows,
  srAbyssSpans,
  srClassify
} from "./calendar.js"

/** 固定的"当前时刻"：2026-09-02 12:00，星期三 */
const NOW = new Date(2026, 8, 2, 12, 0, 0).getTime()

/** NOW 对应的时间窗，2026-08-27 00:00:00 ~ 2026-09-08 23:59:59 */
const WINDOW = dateWindow(NOW)

/**
 * 造一个造日历项要用的上下文
 * @param timeMap 时间修正表
 * @returns 上下文
 */
function ctxOf(timeMap: CalItemCtx["timeMap"] = {}): CalItemCtx {
  return { window: WINDOW, now: NOW, timeMap }
}

/**
 * 造一条活动公告
 * @param start 开始时间
 * @param end 结束时间
 * @param title 标题
 * @returns 公告
 */
function act(start: string, end: string, title = "「盛典与慧业」"): AnnItem {
  return {
    ann_id: 100,
    title,
    start_time: start,
    end_time: end,
    banner: "https://img.example/banner.png",
    tag_icon: "https://img.example/tag.png"
  }
}

/**
 * 造一条日历项，默认按活动公告
 * @param one 公告
 * @param ctx 上下文
 * @param over 覆盖项
 * @returns 日历项；被排除时 undefined
 */
function build(
  one: AnnItem,
  ctx: CalItemCtx = ctxOf(),
  over: Partial<Parameters<typeof buildItem>[2]> = {}
): CalItem | undefined {
  return buildItem(one, ctx, {
    type: "activity",
    title: one.title ?? "",
    extra: {},
    isAct: true,
    ...over
  })
}

describe("dateWindow", () => {
  it("十三天，今天前后各六天", () => {
    expect(WINDOW.dateList.flatMap(one => one.date)).toHaveLength(13)
  })

  it("按月分段，跨月处切开", () => {
    expect(WINDOW.dateList.map(one => one.month)).toEqual([8, 9])
    expect(WINDOW.dateList[0]?.date).toEqual([27, 28, 29, 30, 31])
    expect(WINDOW.dateList[1]?.date).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it("起点是六天前的零点、终点是六天后的 23:59:59", () => {
    expect(fullTime(WINDOW.startTime)).toBe("2026-08-27 00:00:00")
    expect(fullTime(WINDOW.endTime)).toBe("2026-09-08 23:59:59")
  })

  it("周几按「周一为 0」记，不是 JS 的周日为 0", () => {
    // 2026-08-27 是星期四，故第一格是 3；末格 2026-09-08 是星期二，故是 1
    expect(WINDOW.dateList[0]?.week[0]).toBe(3)
    expect(WINDOW.dateList[1]?.week.at(-1)).toBe(1)
  })

  it("当前时刻在正中间时 nowLeft 是 50%", () => {
    expect(WINDOW.nowLeft).toBeCloseTo(50, 3)
  })
})

describe("gsAbyssSpans", () => {
  /** NOW 那一天的四档里与窗口有交集的三档 */
  const spans = gsAbyssSpans(WINDOW, NOW)

  it("上月与本月各两档，与窗口有交集的才收下", () => {
    expect(spans.map(one => one.title)).toEqual([
      "「幻想真境剧诗」· 八月",
      "「幻想真境剧诗」· 九月",
      "「深境螺旋」· 八月"
    ])
  })

  it("剧诗每月 1 日四点换，螺旋每月 16 日四点换", () => {
    expect(fullTime(spans[1]?.start ?? 0)).toBe("2026-09-01 04:00:00")
    expect(fullTime(spans[1]?.end ?? 0)).toBe("2026-10-01 03:59:59")
    expect(fullTime(spans[2]?.start ?? 0)).toBe("2026-08-16 04:00:00")
    expect(fullTime(spans[2]?.end ?? 0)).toBe("2026-09-16 03:59:59")
  })

  it("月名用中文；跨年时回绕", () => {
    const jan = gsAbyssSpans(dateWindow(new Date(2026, 0, 5, 12).getTime()), new Date(2026, 0, 5, 12).getTime())

    expect(jan.some(one => one.title === "「幻想真境剧诗」· 十二月")).toBe(true)
    expect(jan.some(one => one.title === "「深境螺旋」· 十二月")).toBe(true)
  })
})

describe("srAbyssSpans", () => {
  /** 3.4 版本「更新概览」公告的开始时间 */
  const spans = srAbyssSpans(WINDOW, "2026-08-13 11:00:00", NOW)

  it("三档同时在跑 —— 一档 42 天、每 14 天开一档", () => {
    expect(spans).toHaveLength(3)
    expect(spans.map(one => fullTime(one.start))).toEqual([
      "2026-08-03 04:00:00",
      "2026-08-17 04:00:00",
      "2026-08-31 04:00:00"
    ])
    expect(spans.map(one => fullTime(one.end))).toEqual([
      "2026-09-14 04:00:00",
      "2026-09-28 04:00:00",
      "2026-10-12 04:00:00"
    ])
  })

  it("版本开始时间先对齐到周一四点、再按 14 天与 2024-06-24 那个锚点取模", () => {
    // 2026-08-13 是星期四，故先退到 08-10 04:00；它与锚点相差 777 天、模 14 余 7，故再退七天
    expect(fullTime(spans[0]?.start ?? 0)).toBe("2026-08-03 04:00:00")
  })

  it("三种模式的标题按档位轮转", () => {
    expect(spans.map(one => one.title)).toEqual(["「混沌回忆」", "「末日幻影」", "「虚构叙事」"])
  })

  it("档位与模式的对应随版本开始时间走 —— 差半个周期，标题整体转一位", () => {
    const other = srAbyssSpans(WINDOW, "2026-08-17 11:00:00", NOW)

    // 起止与上面那一组完全相同，但每一档挂的模式不同：first 挪了 14 天，标题随之轮转
    expect(other.map(one => fullTime(one.start))).toEqual(spans.map(one => fullTime(one.start)))
    expect(other.map(one => one.title)).toEqual(["「虚构叙事」", "「混沌回忆」", "「末日幻影」"])
  })

  it("公告里没有「更新概览」时退回当前时刻起算，仍给出三档", () => {
    expect(srAbyssSpans(WINDOW, "", NOW)).toHaveLength(3)
  })
})

describe("abyssType", () => {
  it("原神按剧诗与螺旋分两类", () => {
    expect(abyssType("gs", "「幻想真境剧诗」· 八月")).toBe("newAbyss")
    expect(abyssType("gs", "「深境螺旋」· 八月")).toBe("abyss")
  })

  it("星铁三种模式各一类", () => {
    expect(abyssType("sr", "「混沌回忆」")).toBe("abyss-1")
    expect(abyssType("sr", "「虚构叙事」")).toBe("abyss-2")
    expect(abyssType("sr", "「末日幻影」")).toBe("abyss-3")
  })
})

describe("gsClassify", () => {
  /** 按名字查角色 */
  const char = (name: string): { elem?: string; face?: string; card?: string } | undefined =>
    name === "可莉"
      ? { elem: "火", face: "meta-gs/character/可莉/imgs/face.webp", card: "meta-gs/character/可莉/imgs/card.webp" }
      : undefined

  it("武器池：抠掉标题里的武器类型前缀，权重 3", () => {
    const got = gsClassify("「神铸赋形」武器祈愿：长柄武器·护摩之杖、弓·若水 概率UP！")

    expect(got.type).toBe("weapon")
    expect(got.title).toBe("「神铸赋形」武器祈愿：护摩之杖、若水 概率UP！")
    expect(got.extra.sort).toBe(3)
  })

  it("集录池只改权重，不改类别 —— 它落回 activity", () => {
    const got = gsClassify("「集录祈愿」概率UP！")

    expect(got.type).toBeUndefined()
    expect(got.extra).toEqual({ sort: 2 })
  })

  it("角色池：从标题里抠出角色名，带上卡面、头像与元素", () => {
    const got = gsClassify("「烟火之邀」祈愿：「琉焰华舞」·可莉(火)概率UP！", char)

    expect(got.type).toBe("character")
    expect(got.extra).toEqual({
      sort: 1,
      character: "可莉",
      banner2: "meta-gs/character/可莉/imgs/card.webp",
      face: "meta-gs/character/可莉/imgs/face.webp",
      elem: "火"
    })
  })

  it("查不到这个角色时仍算角色池，只是没有图 —— 不因查不到而抛错", () => {
    expect(gsClassify("「未知」祈愿：「新池」·某某(火)概率UP！", char).extra).toEqual({ sort: 1 })
  })

  it("标题里没有半角括号时同样不抛错", () => {
    const got = gsClassify("「烟火之邀」祈愿：概率UP！", char)

    expect(got.type).toBe("character")
    expect(got.extra).toEqual({ sort: 1 })
  })

  it("纪行单独一类", () => {
    expect(gsClassify("「妙论纪行」开启").type).toBe("pass")
  })

  it("其余的不分类，原样交回", () => {
    expect(gsClassify("「盛典与慧业」活动")).toEqual({ title: "「盛典与慧业」活动", extra: {} })
  })
})

describe("srClassify", () => {
  it("光锥池取走一张跃迁图，权重 2", () => {
    const imgs = ["https://img.example/a.png", "https://img.example/b.png"]
    const got = srClassify({ title: "「流光定影」跃迁", banner3: ["meta-sr/weapon/x/icon.webp"] }, imgs)

    expect(got.type).toBe("weapon")
    expect(got.extra).toEqual({ sort: 2, banner3: ["meta-sr/weapon/x/icon.webp"] })
    expect(got.banner).toBe("https://img.example/a.png")
    expect(imgs).toEqual(["https://img.example/b.png"])
  })

  it("角色池取走下一张，权重 1", () => {
    const imgs = ["https://img.example/a.png", "https://img.example/b.png"]
    srClassify({ title: "「流光定影」跃迁" }, imgs)
    const got = srClassify({ title: "「角色活动跃迁」" }, imgs)

    expect(got.type).toBe("character")
    expect(got.banner).toBe("https://img.example/b.png")
  })

  it("图用光了给空串，而不是 undefined", () => {
    expect(srClassify({ title: "「角色活动跃迁」" }, []).banner).toBe("")
  })

  it("无名勋礼是纪行那一类", () => {
    expect(srClassify({ title: "「无名勋礼」开启" }).type).toBe("pass")
  })
})

describe("buildItem", () => {
  it("正在进行的活动：进度条按窗口算百分比，标签带「多久后结束」", () => {
    const got = build(act("2026-08-28 11:00:00", "2026-09-07 03:59:00"))

    expect(got?.left).toBeCloseTo(11.218, 2)
    expect(got?.width).toBeCloseTo(74.674, 2)
    expect(got?.label).toBe("08-28 11:00 ~ 09-07 03:59 (5 天后结束)")
    expect(got?.start).toBe("08-28 11:00")
    expect(got?.end).toBe("09-07 03:59")
  })

  it("尚未开始的活动：标签带「多久后开始」，右端裁到窗口边", () => {
    const got = build(act("2026-09-05 11:00:00", "2026-09-20 03:59:00"))

    expect(got?.left).toBeCloseTo(72.756, 2)
    expect(got?.width).toBeCloseTo(27.244, 2)
    expect(got?.label).toBe("09-05 11:00 (3 天后开始)")
    // 裁剪只影响进度条，标签上的结束时刻仍是真实的那个
    expect(got?.end).toBe("09-20 03:59")
  })

  it("已开始又已结束的活动：左端裁到窗口边，标签写起止", () => {
    const got = build(act("2026-08-20 11:00:00", "2026-08-30 03:59:00"))

    expect(got?.left).toBe(0)
    expect(got?.width).toBeCloseTo(24.354, 2)
    expect(got?.label).toBe("08-20 11:00 ~ 08-30 03:59")
  })

  it("普通公告在同样的宽度下不加起始时刻 —— 两类的阈值不同（38 与 55）", () => {
    const one = act("2026-09-01 12:00:00", "2026-09-06 12:00:00")
    const asAct = build(one)
    const asNormal = build(one, ctxOf(), { type: "normal", isAct: false })

    expect(asAct?.width).toBeCloseTo(38.462, 2)
    expect(asAct?.label).toBe("09-01 12:00 ~ 09-06 12:00 (4 天后结束)")
    expect(asNormal?.label).toBe("09-06 12:00 (4 天后结束)")
  })

  it("标题命中「魔神任务」一律按永久有效", () => {
    expect(build(act("2026-08-28 11:00:00", "2026-09-07 03:59:00", "「魔神任务」第五章"))?.label).toBe(
      "08-28 11:00 后永久有效"
    )
    expect(build(act("2026-09-05 11:00:00", "2026-09-20 03:59:00", "「魔神任务」第六章"))?.label).toBe("永久有效")
  })

  it("跨度超过一年的也按永久有效", () => {
    expect(build(act("2026-08-28 11:00:00", "2028-08-28 03:59:00"))?.label).toBe("08-28 11:00 后永久有效")
  })

  it("普通公告在这几档之外时标签为空 —— 那一类只画标题", () => {
    const got = build(act("2026-08-20 11:00:00", "2026-08-30 03:59:00"), ctxOf(), { type: "normal", isAct: false })

    expect(got?.label).toBe("")
    // 普通公告不画横幅，权重也比活动低
    expect(got?.banner).toBe("")
    expect(got?.sort).toBe(10)
  })

  it("时间表里的修正优先，但太短的一律不认（长度须超过六个字符）", () => {
    const fixed = build(act("2026-08-28 11:00:00", "2026-09-07 03:59:00"), ctxOf({
      "100": { start: "2026-08-29 11:00:00", end: "2026-09-06 03:59:00" }
    }))
    const tooShort = build(act("2026-08-28 11:00:00", "2026-09-07 03:59:00"), ctxOf({ "100": { start: "08-29" } }))

    expect(fixed?.start).toBe("08-29 11:00")
    expect(tooShort?.start).toBe("08-28 11:00")
  })

  it("修正里写了 display: false 就整条不出现", () => {
    expect(build(act("2026-08-28 11:00:00", "2026-09-07 03:59:00"), ctxOf({ "100": { display: false } }))).toBeUndefined()
  })

  it("完全落在窗口外的两侧都不收", () => {
    expect(build(act("2026-10-01 11:00:00", "2026-10-20 03:59:00"))).toBeUndefined()
    expect(build(act("2026-07-01 11:00:00", "2026-08-20 03:59:00"))).toBeUndefined()
  })

  it("**是否收下看的是未裁剪的起止** —— 跨过整个窗口的长期活动照样在", () => {
    const got = build(act("2026-01-01 11:00:00", "2026-12-01 03:59:00"))

    expect(got?.left).toBe(0)
    expect(got?.width).toBe(100)
  })

  it("只有活动与普通公告参与配对，卡池那几类不参与", () => {
    expect(build(act("2026-08-28 11:00:00", "2026-09-07 03:59:00"))?.mergeStatus).toBe(1)
    expect(build(act("2026-08-28 11:00:00", "2026-09-07 03:59:00"), ctxOf(), { type: "normal" })?.mergeStatus).toBe(1)
    expect(build(act("2026-08-28 11:00:00", "2026-09-07 03:59:00"), ctxOf(), { type: "character" })?.mergeStatus).toBe(0)
  })

  it("分类给的附加字段并进结果，但 id / 标题 / 类别不可被它盖掉", () => {
    const got = build(act("2026-08-28 11:00:00", "2026-09-07 03:59:00"), ctxOf(), {
      type: "character",
      extra: { sort: 1, character: "可莉", elem: "火" }
    })

    expect(got?.sort).toBe(1)
    expect(got?.character).toBe("可莉")
    expect(got?.elem).toBe("火")
    expect(got?.type).toBe("character")
    expect(got?.id).toBe(100)
  })
})

/**
 * 造一条最简单的日历项
 * @param over 覆盖项
 * @returns 日历项
 */
function item(over: Partial<CalItem> = {}): CalItem {
  return {
    id: 0,
    title: "",
    type: "activity",
    sort: 5,
    mergeStatus: 1,
    banner: "",
    icon: "",
    left: 0,
    width: 0,
    label: "",
    duration: 0,
    start: "",
    end: "",
    ...over
  }
}

describe("mergeRows", () => {
  it("不重叠的两条并作一行", () => {
    const list = [item({ id: 1, left: 0, width: 30 }), item({ id: 2, left: 40, width: 30 })]
    const got = mergeRows(list)

    expect(got.rows).toHaveLength(1)
    expect(got.rows[0]?.map(one => one.id)).toEqual([1, 2])
  })

  it("重叠的各占一行", () => {
    const list = [item({ id: 1, left: 0, width: 50 }), item({ id: 2, left: 40, width: 30 })]

    expect(mergeRows(list).rows.map(one => one.length)).toEqual([1, 1])
  })

  it("**宽度为零的条目不与自己配对** —— 少了这一条，那一行会出现两次", () => {
    expect(mergeRows([item({ id: 1, left: 0, width: 0 })]).rows).toEqual([[expect.objectContaining({ id: 1 })]])
  })

  it("不参与配对的条目各占一行", () => {
    const list = [item({ id: 1, type: "character", mergeStatus: 0 }), item({ id: 2, type: "weapon", mergeStatus: 0 })]

    expect(mergeRows(list).rows.map(one => one.length)).toEqual([1, 1])
  })

  it("角色池与武器池各自编号，配色靠它", () => {
    const list = [
      item({ id: 1, type: "character", mergeStatus: 0, left: 0 }),
      item({ id: 2, type: "character", mergeStatus: 0, left: 20 }),
      item({ id: 3, type: "weapon", mergeStatus: 0, left: 0 })
    ]
    const got = mergeRows(list)

    expect(list.map(one => one.idx)).toEqual([1, 2, 1])
    // 两个角色池，其中一个从窗口最左端就开始 —— 模板据此决定上方留几行
    expect(got.charMode).toBe("char-2-1")
    expect(got.charCount).toBe(2)
  })

  it("一个角色池都没有时也给出 charMode", () => {
    expect(mergeRows([]).charMode).toBe("char-0-0")
  })
})

describe("charBirthOf", () => {
  /** 几个角色 */
  const chars: CalCharInput[] = [
    { id: "10000029", name: "可莉", star: 5, face: "f1", birth: "7-27" },
    { id: "10000030", name: "钟离", star: 5, face: "f2", birth: "8-28" },
    { id: "10000031", name: "菲谢尔", star: 4, face: "f3", birth: "8-28" },
    { id: "10000005", name: "空", star: 5, face: "f4", birth: "1-1" }
  ]

  it("窗口里每一天都有一格，哪天没人也是空数组", () => {
    const got = charBirthOf(WINDOW.dateList, chars)

    expect(got.charBirth["8-27"]).toEqual([])
    expect(Object.keys(got.charBirth)).toHaveLength(13)
  })

  it("生日落在窗口里的才收，一格里可以有好几个", () => {
    const got = charBirthOf(WINDOW.dateList, chars)

    expect(got.charBirth["8-28"]?.map(one => one.name)).toEqual(["钟离", "菲谢尔"])
    expect(got.charNum).toBe(2)
  })

  it("生日为 1-1 的一律不收 —— 那是旅行者的占位值", () => {
    const got = charBirthOf(WINDOW.dateList, chars)

    expect(Object.values(got.charBirth).flat().some(one => one.name === "空")).toBe(false)
  })

  it("窗口外的生日不进结果", () => {
    const got = charBirthOf(WINDOW.dateList, chars)

    expect(got.charBirth["7-27"]).toBeUndefined()
  })

  it("一个人都没有时 charNum 是 0", () => {
    expect(charBirthOf(WINDOW.dateList, []).charNum).toBe(0)
  })
})

describe("charTalentOf", () => {
  /** 今日的两本天赋书，刻意按国家序号倒序给 */
  const talents: CalTalentInput[] = [
    { name: "「勤劳」的哲学", abbr: "勤劳", city: "璃月", icon: "i2", week: 1, cid: 2 },
    { name: "「诗文」的哲学", abbr: "诗文", city: "蒙德", icon: "i1", week: 1, cid: 1 }
  ]

  /** 几个角色 */
  const chars: CalCharInput[] = [
    { id: "10000032", name: "行秋", star: 4, face: "f1", talent: "「勤劳」的哲学", weekly: "w1" },
    { id: "10000030", name: "钟离", star: 5, face: "f2", talent: "「勤劳」的哲学" },
    { id: "10000042", name: "魈", star: 5, face: "f3", talent: "「勤劳」的哲学" },
    { id: "10000034", name: "诺艾尔", star: 4, face: "f4", talent: "「诗文」的哲学" },
    { id: "10000005", name: "空", star: 5, face: "f5", talent: "「勤劳」的哲学", isMain: true },
    { id: "10000099", name: "某某", star: 5, face: "f6", talent: "「浮世」的哲学" },
    { id: "10000098", name: "无书", star: 4, face: "f7" }
  ]

  it("按国家序号排，而不是按传进来的顺序", () => {
    expect(charTalentOf(talents, chars).map(one => one.city)).toEqual(["蒙德", "璃月"])
  })

  it("同一本书下的角色按星级降序、同星级里 id 降序", () => {
    const got = charTalentOf(talents, chars)

    expect(got[1]?.chars.map(one => one.name)).toEqual(["魈", "钟离", "行秋"])
  })

  it("旅行者不收 —— 他没有固定的天赋书", () => {
    expect(charTalentOf(talents, chars)[1]?.chars.some(one => one.name === "空")).toBe(false)
  })

  it("用别的书或根本没有书的角色都不进结果", () => {
    const names = charTalentOf(talents, chars).flatMap(one => one.chars.map(it => it.name))

    expect(names).not.toContain("某某")
    expect(names).not.toContain("无书")
  })

  it("周本材料的图标带着走，没有的那些不写这一键", () => {
    const got = charTalentOf(talents, chars)[1]?.chars ?? []

    expect(got.find(one => one.name === "行秋")?.weekly).toBe("w1")
    expect(got.find(one => one.name === "钟离")).not.toHaveProperty("weekly")
  })

  it("书名保留全名、标题保留简称与国家 —— 模板写作「蒙德·诗文」", () => {
    const got = charTalentOf(talents, chars)[0]

    expect(got?.name).toBe("「诗文」的哲学")
    expect(got?.abbr).toBe("诗文")
    expect(got?.icon).toBe("i1")
  })
})

describe("buildCalendar（原神）", () => {
  /** 活动公告：一个角色池、一个短活动、两条该被排除的 */
  const acts: AnnItem[] = [
    {
      ann_id: 101,
      title: "「烟火之邀」祈愿：「琉焰华舞」·可莉(火)概率UP！",
      start_time: "2026-08-28 11:00:00",
      end_time: "2026-09-16 03:59:00"
    },
    { ann_id: 102, title: "「盛典与慧业」", start_time: "2026-08-28 11:00:00", end_time: "2026-08-31 03:59:00" },
    { ann_id: 103, title: "5.3版本更新说明", start_time: "2026-08-28 11:00:00", end_time: "2026-09-16 03:59:00" },
    { ann_id: 495, title: "有奖问卷调查开启！", start_time: "2026-08-28 11:00:00", end_time: "2026-09-16 03:59:00" }
  ]

  /** 普通公告 */
  const normal: AnnItem[] = [
    { ann_id: 201, title: "「深秘之息」商店上架", start_time: "2026-09-05 11:00:00", end_time: "2026-09-08 03:59:00" }
  ]

  /** 造一份视图 */
  const view = buildCalendar({
    game: "gs",
    acts,
    normal,
    now: NOW,
    chars: [{ id: "10000030", name: "钟离", star: 5, face: "f2", birth: "8-28", talent: "「勤劳」的哲学" }],
    talents: [{ name: "「勤劳」的哲学", abbr: "勤劳", city: "璃月", icon: "i2", week: 1, cid: 2 }],
    char: name =>
      name === "可莉" ? { elem: "火", face: "meta-gs/character/可莉/imgs/face.webp", card: "card.webp" } : undefined
  })

  it("排除名单里的两条都不出现", () => {
    const ids = view.list.flat().map(one => one.id)

    expect(ids).toContain(101)
    expect(ids).not.toContain(103)
    expect(ids).not.toContain(495)
  })

  it("排序键是「权重、开始时刻、时长」—— 角色池在前，普通公告在后", () => {
    expect(view.list.flat().map(one => one.type)).toEqual(["character", "activity", "normal"])
  })

  it("不重叠的活动与普通公告并进同一行", () => {
    expect(view.list.map(one => one.length)).toEqual([1, 2])
  })

  it("角色池带上元素与卡面，模板据元素换配色", () => {
    const one = view.list.flat().find(it => it.type === "character")

    expect(one?.elem).toBe("火")
    expect(one?.character).toBe("可莉")
    expect(one?.banner2).toBe("card.webp")
  })

  it("深渊单独一层，类别决定图标与配色", () => {
    expect(view.abyss.map(one => one.type)).toEqual(["newAbyss", "newAbyss", "abyss"])
  })

  it("生日与今日天赋书两块都在", () => {
    expect(view.charBirth["8-28"]?.map(one => one.name)).toEqual(["钟离"])
    expect(view.charNum).toBe(1)
    expect(view.charTalent[0]?.chars.map(one => one.name)).toEqual(["钟离"])
  })

  it("窗口那几项与展示参数一并带给模板", () => {
    expect(view.game).toBe("gs")
    expect(view.charMode).toBe("char-1-0")
    expect(view.nowTime).toBe("2026-09-02 12:00")
    expect(view.nowDate).toBe(2)
    expect(view.displayMode).toBe("calendar")
    expect(view.dateList).toHaveLength(2)
  })

  it("列表形态只改 displayMode，内容不变", () => {
    const listMode = buildCalendar({ game: "gs", acts, normal, now: NOW, mode: "list" })

    expect(listMode.displayMode).toBe("list")
    expect(listMode.list.flat()).toHaveLength(view.list.flat().length)
  })

  it("没有元数据时那两块为空，活动时间轴照常", () => {
    const bare = buildCalendar({ game: "gs", acts, normal, now: NOW })

    expect(bare.charTalent).toEqual([])
    expect(Object.values(bare.charBirth).flat()).toEqual([])
    expect(bare.list.flat().length).toBeGreaterThan(0)
  })
})

describe("buildCalendar（星铁）", () => {
  /** 活动公告，刻意不含跃迁 */
  const acts: AnnItem[] = [
    { ann_id: 301, title: "「浮生逆旅」活动", start_time: "2026-08-28 11:00:00", end_time: "2026-09-07 03:59:00" }
  ]

  /** 卡池表顶上来的两条 */
  const fakeGacha: AnnItem[] = [
    {
      ann_id: 0,
      title: "角色活动跃迁：「赤团开时」",
      start_time: "2026-08-13 11:00:00",
      end_time: "2026-09-03 03:59:00",
      banner: "",
      banner2: ["meta-sr/character/姬子/imgs/face.webp"],
      tag_icon: ""
    },
    {
      ann_id: 0,
      title: "光锥活动跃迁：「流光定影」",
      start_time: "2026-08-13 11:00:00",
      end_time: "2026-09-03 03:59:00",
      banner: "",
      banner3: ["meta-sr/weapon/巡猎/x/icon.webp"],
      tag_icon: ""
    }
  ]

  it("公告里没有跃迁时用卡池表顶上", () => {
    const view = buildCalendar({ game: "sr", acts, fakeGacha, versionStart: "2026-08-13 11:00:00", now: NOW })
    const types = view.list.flat().map(one => one.type)

    expect(types).toContain("character")
    expect(types).toContain("weapon")
  })

  it("公告里已有跃迁时不顶 —— 免得同一个池出现两次", () => {
    const withGacha: AnnItem[] = [
      ...acts,
      { ann_id: 302, title: "「角色活动跃迁」开启", start_time: "2026-08-28 11:00:00", end_time: "2026-09-07 03:59:00" }
    ]
    const view = buildCalendar({ game: "sr", acts: withGacha, fakeGacha, versionStart: "2026-08-13 11:00:00", now: NOW })

    expect(view.list.flat().filter(one => one.type === "character")).toHaveLength(1)
  })

  it("跃迁公告自带的图按出现顺序发给跃迁条目", () => {
    const withGacha: AnnItem[] = [
      { ann_id: 302, title: "「角色活动跃迁」开启", start_time: "2026-08-28 11:00:00", end_time: "2026-09-07 03:59:00" }
    ]
    const view = buildCalendar({
      game: "sr",
      acts: withGacha,
      gachaImgs: ["https://img.example/gacha.png"],
      versionStart: "2026-08-13 11:00:00",
      now: NOW
    })

    expect(view.list.flat().find(one => one.type === "character")?.banner).toBe("https://img.example/gacha.png")
  })

  it("深渊三档各带自己的类别", () => {
    const view = buildCalendar({ game: "sr", acts, versionStart: "2026-08-13 11:00:00", now: NOW })

    expect(view.abyss.map(one => one.title)).toEqual(["「混沌回忆」", "「末日幻影」", "「虚构叙事」"])
    expect(view.abyss.map(one => one.type)).toEqual(["abyss-1", "abyss-3", "abyss-2"])
  })

  it("星铁没有生日与天赋书那两块", () => {
    const view = buildCalendar({ game: "sr", acts, versionStart: "2026-08-13 11:00:00", now: NOW })

    expect(view.charTalent).toEqual([])
    expect(view.game).toBe("sr")
  })
})

describe("calendarText", () => {
  it("没有渲染器时逐条列出，深渊单独一段", () => {
    const view = buildCalendar({
      game: "gs",
      acts: [{ ann_id: 102, title: "「盛典与慧业」", start_time: "2026-08-28 11:00:00", end_time: "2026-09-07 03:59:00" }],
      now: NOW
    })
    const text = calendarText(view)

    expect(text.split("\n")[0]).toContain("原神日历")
    expect(text).toContain("【深渊】")
    expect(text).toContain("【活动】")
    expect(text).toContain("「盛典与慧业」")
  })

  it("一条都没有时给一句说明，而不是一个只有标题的空壳", () => {
    const empty = { ...buildCalendar({ game: "sr", acts: [], now: NOW }), abyss: [], list: [] }

    expect(calendarText(empty)).toBe("这十三天里没有正在进行或即将开始的活动")
  })
})
