/**
 * 模块职责：日历取数与公告正文解析的测试
 * 依赖方向：测试文件，依赖 service/calendar 与内核的内存 KV；HTTP 是假的
 * 生命周期：每个用例一份新 KV
 * 注意事项：固定四处：「活动的真实时间写在正文的中文里」这一整套抠法（三种相对写法各一条）、
 *          认不出就跳过而不报错、两个游戏的分隔符不同（原神 `〓`、星铁由 `<h1>` 换来的 `※`，
 *          起止一个用波浪号一个用短横线），以及**第三方补丁源默认一个包都不发** ——
 *          那一份能决定哪几条活动出现、起止画在哪，故 `enableCalendarFix` 缺省关闭。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import type { HttpClient, KvNamespace } from "@yunzai-ng/types"
import { beforeEach, describe, expect, it } from "vitest"
import type { AnnContent } from "./calendar.js"
import {
  CalendarService,
  GS_IGNORE,
  GS_IGNORE_IDS,
  SR_IGNORE,
  SR_IGNORE_IDS,
  gsEntryTime,
  gsVersionTimes,
  srEntryTime,
  srVersionTimes,
  stripTags
} from "./calendar.js"

/** 一个只收不看的日志器 */
const logger = {
  debug: (): void => {},
  info: (): void => {},
  mark: (): void => {},
  warn: (): void => {},
  error: (): void => {}
} as unknown as ConstructorParameters<typeof CalendarService>[0]["logger"]

/** 记下来的请求地址 */
let urls: string[] = []

let kv: KvNamespace

beforeEach(() => {
  urls = []
  kv = new Kv(new MemoryKvDriver())
})

/**
 * 造一个假 HTTP 客户端
 * @param bodies 地址片段 → 响应体；值为 Error 时抛出
 * @returns 客户端
 */
function fakeHttp(bodies: Record<string, unknown>): HttpClient {
  return {
    get: async <T,>(url: string): Promise<T> => {
      urls.push(url)
      for (const [key, body] of Object.entries(bodies)) {
        if (!url.includes(key)) continue
        if (body instanceof Error) throw body
        return body as T
      }
      throw new Error(`没有为 ${url} 准备响应`)
    }
  } as unknown as HttpClient
}

/**
 * 造一个日历取数器
 * @param bodies 各接口的假响应
 * @param fix 是否允许请求第三方补丁
 * @returns 取数器
 */
function make(bodies: Record<string, unknown>, fix = false): CalendarService {
  return new CalendarService({ http: fakeHttp(bodies), kv, logger, fix: () => fix })
}

describe("stripTags", () => {
  it("剥掉带属性的开闭标签与 &nbsp;", () => {
    expect(stripTags('<p style="text-align:center;">胡桃</p>&nbsp;祈愿')).toBe("胡桃祈愿")
  })

  it("实体形态的尖括号也认", () => {
    expect(stripTags("&lt;p&gt;活动时间&lt;/p&gt;")).toBe("活动时间")
  })

  it("刻意留下夹着中文的尖括号 —— 通用写法会把公告里的装饰一起吃掉", () => {
    expect(stripTags("<活动时间>")).toBe("<活动时间>")
  })
})

describe("gsVersionTimes", () => {
  it("从「〓更新时间〓」那一节里取，并把六点换成十一点", () => {
    const list: AnnContent[] = [
      { ann_id: 1, title: "5.3版本更新通知", content: "〓更新时间〓2026/08/12 06:00:00〓预下载" }
    ]

    expect(gsVersionTimes(list)["5.3"]).toBe("2026/08/12 11:00:00")
  })

  it("「更新维护时间」也认", () => {
    const list: AnnContent[] = [{ ann_id: 1, title: "5.3版本更新说明", content: "〓更新维护时间〓2026/08/12 06:00:00〓" }]

    expect(gsVersionTimes(list)["5.3"]).toBe("2026/08/12 11:00:00")
  })

  it("没有那一节时退回全文里的「将于 …… 进行」", () => {
    const list: AnnContent[] = [
      { ann_id: 1, title: "5.3版本更新维护预告", content: '<p style="x">将于2026/08/12 06:00:00进行更新维护</p>' }
    ]

    expect(gsVersionTimes(list)["5.3"]).toBe("2026/08/12 11:00:00")
  })

  it("版本名也可以是书名号形态", () => {
    const list: AnnContent[] = [{ ann_id: 1, title: "「白露泽茂」版本更新通知", content: "〓更新时间〓2026/08/12 06:00:00〓" }]

    expect(gsVersionTimes(list)["「白露泽茂」"]).toBe("2026/08/12 11:00:00")
  })

  it("同一个版本出现两次时以先出现的为准", () => {
    const list: AnnContent[] = [
      { ann_id: 1, title: "5.3版本更新通知", content: "〓更新时间〓2026/08/12 06:00:00〓" },
      { ann_id: 2, title: "5.3版本更新说明", content: "〓更新时间〓2026/09/12 06:00:00〓" }
    ]

    expect(gsVersionTimes(list)["5.3"]).toBe("2026/08/12 11:00:00")
  })

  it("认不出版本号的公告不进表", () => {
    expect(gsVersionTimes([{ ann_id: 1, title: "有奖问卷调查开启！", content: "〓更新时间〓2026/08/12 06:00:00〓" }])).toEqual({})
  })
})

describe("srVersionTimes", () => {
  it("1.1 是写死的种子 —— 那个版本的公告标题不合正则", () => {
    expect(srVersionTimes([])).toEqual({ "1.1": "2022-06-07 11:00:00" })
  })

  it("从「■更新时间」那一节里取，同样把六点换成十一点", () => {
    const list: AnnContent[] = [{ ann_id: 1, title: "3.4版本更新概览", content: "■更新时间2026/08/13 06:00:00■后续" }]

    expect(srVersionTimes(list)["3.4"]).toBe("2026/08/13 11:00:00")
  })

  it("标题里版本号与「更新」之间可以夹字", () => {
    const list: AnnContent[] = [{ ann_id: 1, title: "3.4版本「银河沉眠」更新说明", content: "■更新时间2026/08/13 06:00:00■" }]

    expect(srVersionTimes(list)["3.4"]).toBe("2026/08/13 11:00:00")
  })
})

describe("gsEntryTime", () => {
  /** 版本更新时刻表 */
  const versions = { "5.3": "2026/08/12 11:00:00" }

  it("最简单的一种：波浪号分隔的起止", () => {
    const one: AnnContent = {
      ann_id: 10,
      title: "「盛典与慧业」活动",
      content: "〓活动时间〓2026/08/12 11:00:00 ~ 2026/08/26 03:59:00〓活动说明"
    }

    expect(gsEntryTime(one, versions)).toEqual({ start: "2026-08-12 11:00:00", end: "2026-08-26 03:59:00" })
  })

  it("「X.Y 版本更新后」换算成那个版本的更新时刻", () => {
    const one: AnnContent = {
      ann_id: 11,
      title: "「赤团开时」祈愿",
      content: "〓祈愿介绍〓5.3版本更新后~2026/08/26 03:59:00〓"
    }

    expect(gsEntryTime(one, versions)).toEqual({ start: "2026-08-12 11:00:00", end: "2026-08-26 03:59:00" })
  })

  it("「版本更新后永久开放」收尾到 2099", () => {
    const one: AnnContent = { ann_id: 12, title: "新地图开放", content: "〓任务开放时间〓5.3版本更新后永久开放〓" }

    expect(gsEntryTime(one, versions)).toEqual({ start: "2026-08-12 11:00:00", end: "2099-01-01 00:00:00" })
  })

  it("「版本期间持续开放」按 42 天算，末日当天六点", () => {
    const one: AnnContent = { ann_id: 13, title: "限时挑战", content: "〓活动时间〓5.3版本期间持续开放〓" }

    expect(gsEntryTime(one, versions)).toEqual({ start: "2026-08-12 11:00:00", end: "2026-09-23 06:00:00" })
  })

  it("「后永久开放」用前面那个时刻起算", () => {
    const one: AnnContent = { ann_id: 14, title: "新增内容", content: "〓活动时间〓2026/08/12 11:00:00 后永久开放〓" }

    expect(gsEntryTime(one, versions)).toEqual({ start: "2026-08-12 11:00:00", end: "2099-01-01 00:00:00" })
  })

  it("提到的版本不在表里时整条放弃 —— 起点无从换算，画出来的进度条必然是错的", () => {
    const one: AnnContent = { ann_id: 15, title: "祈愿", content: "〓祈愿介绍〓9.9版本更新后~2026/08/26 03:59:00〓" }

    expect(gsEntryTime(one, versions)).toBeUndefined()
  })

  it("认不出「活动时间」那一节时跳过这一条", () => {
    expect(gsEntryTime({ ann_id: 16, title: "某活动", content: "<p>详见游戏内</p>" }, versions)).toBeUndefined()
  })

  it("那一节里根本没有时间时也跳过，而不是抛错", () => {
    const one: AnnContent = { ann_id: 17, title: "某活动", content: "〓活动时间〓详见游戏内公告〓" }

    expect(gsEntryTime(one, versions)).toBeUndefined()
  })

  it("被排除的标题一律不解析", () => {
    const one: AnnContent = { ann_id: 18, title: "版本更新说明", content: "〓活动时间〓2026/08/12 11:00:00 ~ 2026/08/26 03:59:00〓" }

    expect(gsEntryTime(one, versions)).toBeUndefined()
  })

  it("正文里带 HTML 标签时先剥再抠", () => {
    const one: AnnContent = {
      ann_id: 19,
      title: "某活动",
      content: '〓活动时间〓<p style="text-align:left;">2026/08/12 11:00:00 ~ 2026/08/26 03:59:00</p>〓'
    }

    expect(gsEntryTime(one, versions)).toEqual({ start: "2026-08-12 11:00:00", end: "2026-08-26 03:59:00" })
  })

  it("表格式活动（多阶段开启时间与结束时间分列、无 ~ 分隔）取最早开启与最晚结束", () => {
    // 银翎溯月一类：正文用表格列三个阶段的开启时间，列表 start_time 是公告发布时刻（早两天）
    const one: AnnContent = {
      ann_id: 20,
      title: "「银翎溯月」活动",
      content:
        "〓活动时间〓活动内容 开启时间 结束时间 第一阶段 2026/09/24 10:00 2026/10/12 03:59 第二阶段 2026/09/26 04:00 第三阶段 2026/09/28 04:00〓活动说明"
    }

    expect(gsEntryTime(one, versions)).toEqual({ start: "2026-09-24 10:00", end: "2026-10-12 03:59" })
  })
})

describe("srEntryTime", () => {
  /** 版本更新时刻表 */
  const versions = { "1.1": "2022-06-07 11:00:00", "3.4": "2026/08/13 11:00:00" }

  it("分隔符是由 h1 换来的 ※，起止用短横线", () => {
    const one: AnnContent = {
      ann_id: 20,
      title: "「浮生逆旅」活动",
      content: '<h1 style="">活动时间</h1><p>2026/08/13 11:00:00 - 2026/09/03 03:59:00</p>'
    }

    expect(srEntryTime(one, versions)?.time).toEqual({ start: "2026-08-13 11:00:00", end: "2026-09-03 03:59:00" })
  })

  it("「X.Y 版本更新后」同样换算", () => {
    const one: AnnContent = {
      ann_id: 21,
      title: "「流光定影」跃迁",
      content: '<h1 style="">开放时间</h1><p>3.4版本更新后至2026/09/03 03:59:00</p>'
    }

    expect(srEntryTime(one, versions)?.time).toEqual({ start: "2026-08-13 11:00:00", end: "2026-09-03 03:59:00" })
  })

  it("「版本更新后永久开放」收尾到 2099", () => {
    const one: AnnContent = {
      ann_id: 22,
      title: "新模式",
      content: '<h1 style="">开启时间</h1><p>3.4版本更新后永久开放</p>'
    }

    expect(srEntryTime(one, versions)?.time).toEqual({ start: "2026-08-13 11:00:00", end: "2099-01-01 00:00:00" })
  })

  it("跃迁公告把自带的图收走，供跃迁条目当横幅用", () => {
    const one: AnnContent = {
      ann_id: 23,
      title: "「角色活动跃迁」",
      content: '<h1 style="">活动跃迁</h1><p>2026/08/13 11:00:00 - 2026/09/03 03:59:00</p>',
      img: "https://img.example/gacha.png"
    }

    expect(srEntryTime(one, versions)?.gacha).toBe("https://img.example/gacha.png")
  })

  it("不是跃迁公告时不收图", () => {
    const one: AnnContent = {
      ann_id: 24,
      title: "活动",
      content: '<h1 style="">活动时间</h1><p>2026/08/13 11:00:00 - 2026/09/03 03:59:00</p>',
      img: "https://img.example/other.png"
    }

    expect(srEntryTime(one, versions)?.gacha).toBeUndefined()
  })

  it("被排除的标题与认不出的正文都跳过", () => {
    expect(srEntryTime({ ann_id: 25, title: "版本更新概览", content: '<h1 style="">活动时间</h1><p>1</p>' }, versions)).toBeUndefined()
    expect(srEntryTime({ ann_id: 26, title: "活动", content: "<p>详见游戏内</p>" }, versions)).toBeUndefined()
  })
})

describe("排除名单", () => {
  it("按 id 排除的那几条是逐个核对过的常驻公告", () => {
    expect(GS_IGNORE_IDS).toEqual([495, 1263, 423, 422, 762])
    expect(SR_IGNORE_IDS).toEqual([257, 194, 203, 183, 187, 185, 171])
  })

  it("星铁那份比原神多认几类 —— 角色 PV、动画短片一类", () => {
    expect(SR_IGNORE.test("角色PV：「姬子」")).toBe(true)
    expect(GS_IGNORE.test("角色PV：「胡桃」")).toBe(false)
    expect(GS_IGNORE.test("角色演示：「胡桃」")).toBe(true)
  })
})

describe("CalendarService.fetch", () => {
  /** 一份最小的原神公告列表 */
  const gsList = {
    data: {
      list: [
        { list: [{ ann_id: 1, title: "米游社《原神》专属工具一览" }] },
        { list: [{ ann_id: 2, title: "「盛典与慧业」活动", start_time: "2026-08-12 11:00:00", end_time: "2026-08-26 03:59:00" }] }
      ]
    }
  }

  /** 一份最小的原神公告正文 */
  const gsContent = {
    data: {
      list: [
        { ann_id: 2, title: "「盛典与慧业」活动", content: "〓活动时间〓2026/08/12 11:00:00 ~ 2026/08/26 03:59:00〓" }
      ]
    }
  }

  it("原神的活动在 list[1]、普通公告在 list[0]", async () => {
    const got = await make({ getAnnList: gsList, getAnnContent: gsContent }).fetch("gs")

    expect(got?.acts.map(one => one.ann_id)).toEqual([2])
    expect(got?.normal.map(one => one.ann_id)).toEqual([1])
  })

  it("正文里抠出来的时间进时间表，键是公告 id", async () => {
    const got = await make({ getAnnList: gsList, getAnnContent: gsContent }).fetch("gs")

    expect(got?.timeMap["2"]).toEqual({ start: "2026-08-12 11:00:00", end: "2026-08-26 03:59:00" })
  })

  it("缺省不请求第三方补丁源 —— 只打米游社那两个", async () => {
    await make({ getAnnList: gsList, getAnnContent: gsContent }).fetch("gs")

    expect(urls.some(one => one.includes("miao.games"))).toBe(false)
    expect(urls).toHaveLength(2)
  })

  it("开了补丁开关才请求，且补丁覆盖同一个 id", async () => {
    const fixBody = { status: 0, data: { "2": { start: "2026-08-13 11:00:00", end: "2026-08-27 03:59:00" } } }
    const got = await make({ getAnnList: gsList, getAnnContent: gsContent, "miao.games": fixBody }, true).fetch("gs")

    expect(urls.some(one => one.includes("miao.games"))).toBe(true)
    expect(got?.timeMap["2"]).toEqual({ start: "2026-08-13 11:00:00", end: "2026-08-27 03:59:00" })
  })

  it("补丁源取不到时照样出结果", async () => {
    const bodies = { getAnnList: gsList, getAnnContent: gsContent, "miao.games": new Error("boom") }
    const got = await make(bodies, true).fetch("gs")

    expect(got?.timeMap["2"]?.start).toBe("2026-08-12 11:00:00")
  })

  it("第二次走缓存，一个包都不发", async () => {
    const serv = make({ getAnnList: gsList, getAnnContent: gsContent })
    await serv.fetch("gs")
    urls = []
    await serv.fetch("gs")

    expect(urls).toEqual([])
  })

  it("公告列表取不到时返回 undefined —— 那时整张日历没有内容可画", async () => {
    expect(await make({ getAnnList: new Error("boom") }).fetch("gs")).toBeUndefined()
  })

  it("正文取不到时仍出结果，时间表为空 —— 每条活动退回列表里给的时间", async () => {
    const got = await make({ getAnnList: gsList, getAnnContent: new Error("boom") }).fetch("gs")

    expect(got?.acts).toHaveLength(1)
    expect(got?.timeMap).toEqual({})
  })

  it("星铁把图片公告并进活动，并记下本版本的开始时间", async () => {
    const srList = {
      data: {
        list: [{ list: [{ ann_id: 3, title: "3.4版本更新概览", start_time: "2026-08-13 11:00:00" }] }],
        pic_list: [
          {
            type_list: [
              { list: [{ ann_id: 4, title: "「角色活动跃迁」" }] },
              { list: [{ ann_id: 5, title: "「流光定影」" }] }
            ]
          }
        ]
      }
    }
    const got = await make({ getAnnList: srList, getAnnContent: { data: { list: [] } } }).fetch("sr")

    expect(got?.acts.map(one => one.ann_id)).toEqual([3, 4, 5])
    expect(got?.normal).toEqual([])
    expect(got?.versionStart).toBe("2026-08-13 11:00:00")
  })

  it("星铁的跃迁图按出现顺序收在 gachaImgs 里", async () => {
    const srList = { data: { list: [{ list: [] }] } }
    const srContent = {
      data: {
        list: [],
        pic_list: [
          {
            ann_id: 4,
            title: "跃迁",
            content: '<h1 style="">活动跃迁</h1><p>2026/08/13 11:00:00 - 2026/09/03 03:59:00</p>',
            img: "https://img.example/a.png"
          }
        ]
      }
    }
    const got = await make({ getAnnList: srList, getAnnContent: srContent }).fetch("sr")

    expect(got?.gachaImgs).toEqual(["https://img.example/a.png"])
  })
})
