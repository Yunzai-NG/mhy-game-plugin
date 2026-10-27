/**
 * 模块职责：前瞻直播兑换码服务的测试
 * 依赖方向：测试文件，依赖 service/live-code 与一个假的 HTTP 客户端
 * 生命周期：无状态
 * 注意事项：钉住五条：三个码全给出来、**`act_id` 从社区导航栏反查**（写死一个即永远返回上个
 *          版本的失效码）、标题里的 HTML 标记要剥掉、**开播时刻按东八区解析**（按本机时区解析
 *          会在别的时区把"已开播"判成"还没开播"），以及失败也缓存（没有直播的日子里那是常态，
 *          不缓存等于每次都白发三个请求）。
 */
import type { HttpClient, Logger } from "@yunzai-ng/types"
import { beforeEach, describe, expect, it } from "vitest"
import { LiveCodeService } from "./live-code.js"

/** 固定的"现在"：2026-09-08 12:00 东八区 */
const NOW = new Date("2026-09-08 12:00:00 GMT+0800").getTime()

/** 这一轮发出去的请求，只记接口名 */
let sent: string[] = []

/** 各接口分别回什么 */
interface Answers {
  /** 社区首页 */
  hub?: Record<string, unknown>
  /** 直播场次 */
  index?: Record<string, unknown>
  /** 兑换码 */
  code?: Record<string, unknown>
}

/** 一份正常的社区首页返回，导航栏里有前瞻直播那一项 */
const HUB = {
  retcode: 0,
  data: {
    navigator: [
      { name: "官方公告", app_path: "mihoyobbs://article?post_id=1&" },
      { name: "3.4版本前瞻直播", app_path: "mihoyobbs://act?act_id=e20260908live&game_biz=nap_cn&" }
    ]
  }
}

/** 一份正常的场次返回：已开播、未结束 */
const INDEX = {
  retcode: 0,
  data: { live: { code_ver: "3.4", title: "3.4版本前瞻特别直播", is_end: false, start: "2026-09-08 11:00:00" } }
}

/** 一份正常的兑换码返回：官方每场三个，第三个尚未放出 */
const CODE = {
  retcode: 0,
  data: {
    code_list: [
      { title: "<span>菲林</span>×100", code: "ZZZAAA111" },
      { title: "丁尼×50000", code: "ZZZBBB222" },
      { title: "原装菲林×5", code: "" }
    ]
  }
}

/** 什么都不记的日志器 */
const LOGGER = {
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
  debug: (): void => {},
  mark: (): void => {}
} as unknown as Logger

/**
 * 造一套服务
 * @param answers 三条接口分别回什么
 * @param now 当前时间
 * @returns 服务
 */
function make(answers: Answers = {}, now = NOW): LiveCodeService {
  const http = {
    request: async (url: string): Promise<{ status: number; data: unknown }> => {
      const name = url.includes("apihub") ? "hub" : url.includes("refreshCode") ? "code" : "index"
      sent.push(name)
      const body =
        name === "hub" ? (answers.hub ?? HUB) : name === "index" ? (answers.index ?? INDEX) : (answers.code ?? CODE)
      return { status: 200, data: body }
    }
  } as unknown as HttpClient
  return new LiveCodeService({ http, logger: LOGGER, now: () => now })
}

beforeEach(() => {
  sent = []
})

describe("取兑换码", () => {
  it("**三个码全给出来** —— 只印第一个是漏掉了另两个", async () => {
    const got = await make().codes("zzz")

    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.codes).toHaveLength(3)
    expect(got.codes.map(one => one.code)).toEqual(["ZZZAAA111", "ZZZBBB222", ""])
  })

  it("标题里的 HTML 标记剥掉 —— 原样印会把标签当文字显示", async () => {
    const got = await make().codes("zzz")

    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.codes[0]?.items).toBe("菲林×100")
  })

  it("三条接口按次序各打一次：反查 act_id → 场次 → 兑换码", async () => {
    await make().codes("gs")

    expect(sent).toEqual(["hub", "index", "code"])
  })

  it("标题去掉「特别直播」四个字，剩下的才是版本", async () => {
    const got = await make().codes("zzz")

    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.title).toBe("3.4版本前瞻")
  })
})

describe("act_id 反查", () => {
  it("导航栏里没有前瞻那一项时只回一句，不再打后两条接口", async () => {
    const service = make({ hub: { retcode: 0, data: { navigator: [{ name: "官方公告", app_path: "x?post_id=1&" }] } } })
    const got = await service.codes("zzz")

    expect(got.ok).toBe(false)
    expect(sent).toEqual(["hub"])
  })

  it("社区首页本身失败时也不往下走", async () => {
    const service = make({ hub: { retcode: -1, message: "系统繁忙" } })
    const got = await service.codes("zzz")

    expect(got.ok).toBe(false)
    expect(sent).toEqual(["hub"])
  })
})

describe("开播时刻", () => {
  it("**还没开播时给出开播时刻** —— 按东八区解析，不看本机时区", async () => {
    // 现在是 09-08 10:00 东八区，开播在 11:00
    const service = make({}, new Date("2026-09-08 10:00:00 GMT+0800").getTime())
    const got = await service.codes("zzz")

    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.startAt).toBe("2026-09-08 11:00:00")
  })

  it("已开播时不给开播时刻", async () => {
    const got = await make().codes("zzz")

    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.startAt).toBe("")
  })

  it("已结束时不给开播时刻", async () => {
    const service = make({
      index: { retcode: 0, data: { live: { code_ver: "3.4", title: "3.4版本前瞻特别直播", is_end: true } } }
    })
    const got = await service.codes("zzz")

    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.startAt).toBe("")
  })
})

describe("缓存", () => {
  it("十分钟内不重复请求", async () => {
    const service = make()
    await service.codes("zzz")
    await service.codes("zzz")

    expect(sent).toEqual(["hub", "index", "code"])
  })

  it("**失败也缓存** —— 没有直播的日子里那是常态，不缓存等于每次都白发请求", async () => {
    const service = make({ hub: { retcode: 0, data: { navigator: [] } } })
    await service.codes("zzz")
    await service.codes("zzz")

    expect(sent).toEqual(["hub"])
  })

  it("按游戏各缓存一份 —— 三个游戏的直播是三回事", async () => {
    const service = make()
    await service.codes("gs")
    await service.codes("zzz")

    expect(sent).toEqual(["hub", "index", "code", "hub", "index", "code"])
  })
})

describe("边界", () => {
  it("场次里没有 code_ver 时只回一句", async () => {
    const service = make({ index: { retcode: 0, data: { live: {} } } })
    const got = await service.codes("zzz")

    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.message).toContain("场次")
  })

  it("码还没放出（空数组）时说清是这个原因", async () => {
    const service = make({ code: { retcode: 0, data: { code_list: [] } } })
    const got = await service.codes("zzz")

    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.message).toContain("还没有放出")
  })
})
