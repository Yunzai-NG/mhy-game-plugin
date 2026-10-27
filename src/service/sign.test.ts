/**
 * 模块职责：签到服务的测试
 * 依赖方向：测试文件，依赖 service/sign、core/sign-api，HTTP 与设备都是假的
 * 生命周期：无状态
 * 注意事项：固定四处**改了不报错、只会把风控从"这一次"变成"这个账号"**的口径：撞验证码只签一次
 *          不重试、Cookie 失效立刻停手（不再签下一个游戏）、请求头带 DS1 与活动页 Referer、
 *          只有原神带 `x-rpc-signgame`。`gap` 一律传 `() => 0`，真实间隔是每步几秒，不能真等。
 */
import { describe, expect, it } from "vitest"
import type { HttpClient } from "@yunzai-ng/types"
import type { DeviceStore } from "../core/device.js"
import { isCaptcha, SignService, signGamesOf } from "./sign.js"

/** 不出声的日志器 */
const LOGGER = {
  debug: (): void => undefined,
  info: (): void => undefined,
  mark: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  trace: (): void => undefined,
  fatal: (): void => undefined
}

/** 假设备存储：恒给同一台设备 */
const DEVICES = {
  use: async (): Promise<{ id: string; name: string; spec: { model: string } }> => ({
    id: "TESTDEVICE",
    name: "HUAWEI P40",
    spec: { model: "ANA-AN00" }
  })
} as unknown as DeviceStore

/** 记下来的一次请求 */
interface Call {
  /** 完整 URL */
  url: string
  /** 请求头 */
  headers: Record<string, string>
  /** 请求体 */
  body?: string
}

/** 每类接口给什么 */
interface Answers {
  /** 角色列表 */
  roles?: unknown
  /** 签到状态 */
  info?: unknown
  /** 签到 */
  sign?: unknown
  /** 奖励表 */
  home?: unknown
}

/** 缺省的一套：一个国服原神角色，今天还没签 */
const OK: Answers = {
  roles: { retcode: 0, data: { list: [{ region: "cn_gf01", game_uid: "100000001", nickname: "旅行者" }] } },
  info: { retcode: 0, data: { is_sign: false, total_sign_day: 6 } },
  sign: { retcode: 0, data: {} },
  home: { retcode: 0, data: { awards: Array.from({ length: 30 }, (_, i) => ({ name: `第${i + 1}天`, cnt: i + 1 })) } }
}

/**
 * 造一个假 HTTP 与一个签到服务
 * @param answers 每类接口给什么
 * @returns 服务与调用记录
 */
function make(answers: Answers = OK): { service: SignService; calls: Call[] } {
  const calls: Call[] = []
  const http = {
    request: async <T,>(url: string, opts: { headers: Record<string, string>; body?: string }): Promise<T> => {
      calls.push({ url, headers: opts.headers, ...(opts.body ? { body: opts.body } : {}) })
      const pick = url.includes("getUserGameRolesByCookie")
        ? answers.roles
        : url.includes("/luna/info")
          ? answers.info
          : url.includes("/luna/sign")
            ? answers.sign
            : answers.home
      return { ok: true, status: 200, data: pick ?? { retcode: 0, data: {} } } as T
    }
  } as unknown as HttpClient
  return {
    service: new SignService({ http, logger: LOGGER as never, devices: DEVICES, gap: (): number => 0 }),
    calls
  }
}

describe("isCaptcha", () => {
  it("三个字段任一有值都算撞上验证码 —— 只认 gt 会让新形态被当成签到成功", () => {
    expect(isCaptcha({ gt: "abc" })).toBe(true)
    expect(isCaptcha({ challenge: "abc" })).toBe(true)
    expect(isCaptcha({ risk_code: 375 })).toBe(true)
    expect(isCaptcha({})).toBe(false)
    expect(isCaptcha(undefined)).toBe(false)
  })
})

describe("signGamesOf", () => {
  it("认出指名的游戏，没指名时 undefined", () => {
    expect(signGamesOf("原神")).toEqual(["gs"])
    expect(signGamesOf("星铁")).toEqual(["sr"])
    expect(signGamesOf("原神 星穹")).toEqual(["gs", "sr"])
    expect(signGamesOf("")).toBeUndefined()
  })
})

describe("SignService.run", () => {
  it("签成时给出累计天数与今天的奖励", async () => {
    const { service } = make()
    const report = await service.run({ ltuid: "1001", cookie: "ltuid=1001;ltoken=x" }, ["gs"])

    expect(report.dead).toBe(false)
    expect(report.items).toHaveLength(1)
    expect(report.items[0]).toMatchObject({
      game: "gs",
      name: "原神",
      uid: "100000001",
      nickname: "旅行者",
      status: "signed",
      total: 7,
      award: "第7天*7"
    })
  })

  it("请求头带 DS1 与活动页 Referer，且只有原神带 signgame", async () => {
    const { service, calls } = make()
    await service.run({ ltuid: "1001", cookie: "ltuid=1001" }, ["gs"])
    const first = calls[0]
    // DS1 的形态是 `t,r,md5`，且 r 是六位字母数字而不是六位数字
    expect(first?.headers["DS"]).toMatch(/^\d{10},[a-z0-9]{6},[0-9a-f]{32}$/)
    expect(first?.headers["Referer"]).toContain("signin-ys")
    expect(first?.headers["x-rpc-signgame"]).toBe("hk4e")
    expect(first?.headers["Cookie"]).toBe("ltuid=1001")

    const sr = make()
    await sr.service.run({ ltuid: "1001", cookie: "ltuid=1001" }, ["sr"])
    expect(sr.calls[0]?.headers["x-rpc-signgame"]).toBeUndefined()
    expect(sr.calls[0]?.headers["Referer"]).toContain("hkrpg")
  })

  it("今天已签过时不再打签到接口", async () => {
    const { service, calls } = make({ ...OK, info: { retcode: 0, data: { is_sign: true, total_sign_day: 9 } } })
    const report = await service.run({ ltuid: "1001", cookie: "c" }, ["gs"])

    expect(report.items[0]?.status).toBe("already")
    expect(report.items[0]?.total).toBe(9)
    expect(calls.filter(one => one.url.includes("/luna/sign"))).toHaveLength(0)
  })

  it("撞上验证码只签一次，绝不重试 —— 再敲一次就是把风控从这一次变成这个账号", async () => {
    const { service, calls } = make({ ...OK, sign: { retcode: 0, data: { gt: "abc", challenge: "def" } } })
    const report = await service.run({ ltuid: "1001", cookie: "c" }, ["gs"])

    expect(report.items[0]?.status).toBe("captcha")
    expect(report.items[0]?.message).toContain("手动签")
    expect(calls.filter(one => one.url.includes("/luna/sign"))).toHaveLength(1)
  })

  it("Cookie 失效时立刻停手，不再签下一个游戏", async () => {
    const { service, calls } = make({ ...OK, roles: { retcode: -100, message: "请先登录" } })
    const report = await service.run({ ltuid: "1001", cookie: "c" })

    expect(report.dead).toBe(true)
    expect(report.items).toHaveLength(1)
    expect(report.items[0]?.status).toBe("cookie")
    // 只打了第一个游戏的角色列表，星铁那一轮根本没发
    expect(calls).toHaveLength(1)
  })

  it("名下没有该游戏的角色时说清，而不是当成失败", async () => {
    const { service } = make({ ...OK, roles: { retcode: 0, data: { list: [] } } })
    const report = await service.run({ ltuid: "1001", cookie: "c" }, ["sr"])

    expect(report.items[0]?.status).toBe("norole")
    expect(report.items[0]?.message).toContain("星穹铁道")
  })

  it("签到接口回错时把它的原话带出来", async () => {
    const { service } = make({ ...OK, sign: { retcode: -5003, message: "traveler, you've already checked in today" } })
    const report = await service.run({ ltuid: "1001", cookie: "c" }, ["gs"])

    expect(report.items[0]?.status).toBe("fail")
    expect(report.items[0]?.message).toContain("already checked in")
  })

  it("不指定游戏时三个都签", async () => {
    const { service } = make()
    const report = await service.run({ ltuid: "1001", cookie: "c" })
    expect(report.items.map(one => one.game)).toEqual(["gs", "sr", "zzz"])
  })

  it("text 把报告折成一段可直接发出去的话", () => {
    const text = SignService.text({
      ltuid: "1001",
      dead: false,
      items: [
        { game: "gs", name: "原神", uid: "100000001", nickname: "旅行者", status: "signed", message: "签到成功", total: 7, award: "原石*60" },
        { game: "sr", name: "星穹铁道", uid: "", nickname: "", status: "norole", message: "这个账号名下没有星穹铁道的角色" }
      ]
    })
    expect(text).toContain("原神 旅行者：签到成功（累计 7 天）")
    expect(text).toContain("原石*60")
    expect(text).toContain("星穹铁道：这个账号名下没有星穹铁道的角色")
  })
})

/** 社区签到那一族的假返回 */
interface BbsAnswers {
  /** 任务状态（米游币余额） */
  missions?: unknown
  /** 逐次签到的返回，按调用顺序取 */
  signs?: readonly unknown[]
}

/** 一份 stoken 形态的账号 */
const STOKEN_ACCOUNT = { ltuid: "1001", stoken: "stuid=1001;stoken=v2_x;mid=m1_y;" }

/**
 * 造一个只答社区接口的假 HTTP
 * @param answers 每类接口给什么
 * @returns 服务与调用记录
 */
function makeBbs(answers: BbsAnswers = {}): { service: SignService; calls: Call[] } {
  const calls: Call[] = []
  let signAt = 0
  const http = {
    request: async <T,>(url: string, opts: { headers: Record<string, string>; body?: string }): Promise<T> => {
      calls.push({ url, headers: opts.headers, ...(opts.body ? { body: opts.body } : {}) })
      if (url.includes("getUserMissionsState")) {
        return { ok: true, status: 200, data: answers.missions ?? { retcode: 0, data: { total_points: 100, can_get_points: 20 } } } as T
      }
      const pick = answers.signs?.[signAt] ?? { retcode: 0 }
      signAt += 1
      return { ok: true, status: 200, data: pick } as T
    }
  } as unknown as HttpClient
  return {
    service: new SignService({ http, logger: LOGGER as never, devices: DEVICES, gap: (): number => 0 }),
    calls
  }
}

describe("SignService.coins", () => {
  it("给出余额与今日剩余可得", async () => {
    const { service } = makeBbs()
    const got = await service.coins(STOKEN_ACCOUNT)

    expect(got).toMatchObject({ ok: true, points: 100, canGet: 20 })
  })

  it("stoken 失效时单独标出来 —— 调用方据它引导去重新扫码，而不是当成一次普通失败", async () => {
    const { service } = makeBbs({ missions: { retcode: -100, message: "登录已过期" } })
    const got = await service.coins(STOKEN_ACCOUNT)

    expect(got).toMatchObject({ ok: false, dead: true })
    expect(got.message).toContain("扫码登录")
  })

  it("Cookie 头只有 stoken 那三项，不带 ltoken", async () => {
    const { service, calls } = makeBbs()
    await service.coins({ ltuid: "1001", stoken: "stuid=1001;stoken=v2_x;mid=m1_y;" })

    const cookie = calls[0]?.headers["Cookie"] ?? ""
    expect(cookie).toBe("stuid=1001;stoken=v2_x;mid=m1_y;")
    expect(cookie).not.toContain("ltoken")
  })
})

describe("SignService.bbs", () => {
  it("三个版块各签一次，末尾再取一遍余额", async () => {
    const { service, calls } = makeBbs()
    const report = await service.bbs(STOKEN_ACCOUNT)

    expect(report.items.map(one => one.name)).toEqual(["原神", "星穹铁道", "绝区零"])
    expect(report.items.every(one => one.status === "signed")).toBe(true)
    // 先查余额、三次签到、再查一次余额
    expect(calls).toHaveLength(5)
  })

  it("今日额度已满时一个签到的包都不发 —— 签了也不会再给米游币", async () => {
    const { service, calls } = makeBbs({ missions: { retcode: 0, data: { total_points: 1500, can_get_points: 0 } } })
    const report = await service.bbs(STOKEN_ACCOUNT)

    expect(report.items).toEqual([])
    expect(report.message).toContain("都拿到了")
    expect(calls).toHaveLength(1)
  })

  it("1008 是「今天已签」而不是失败 —— 当成失败会让每天第二次执行都报一次错", async () => {
    const { service } = makeBbs({ signs: [{ retcode: 1008, message: "已签到" }] })
    const report = await service.bbs(STOKEN_ACCOUNT, ["gs"])

    expect(report.items[0]).toMatchObject({ status: "already" })
  })

  it("1034 是验证码，明说要去 App 里手动签，且不重试", async () => {
    const { service, calls } = makeBbs({ signs: [{ retcode: 1034 }] })
    const report = await service.bbs(STOKEN_ACCOUNT, ["gs"])

    expect(report.items[0]?.status).toBe("captcha")
    expect(report.items[0]?.message).toContain("手动签")
    expect(calls.filter(one => one.url.includes("signIn"))).toHaveLength(1)
  })

  it("stoken 失效立刻停手，不再签下一个版块", async () => {
    const { service, calls } = makeBbs({ signs: [{ retcode: -100 }] })
    const report = await service.bbs(STOKEN_ACCOUNT)

    expect(report.dead).toBe(true)
    expect(calls.filter(one => one.url.includes("signIn"))).toHaveLength(1)
  })

  it("两条接口的签名是两套：查状态不带 b/q，签到带", async () => {
    const { service, calls } = makeBbs()
    await service.bbs(STOKEN_ACCOUNT, ["gs"])

    const missions = calls.find(one => one.url.includes("getUserMissionsState"))
    const sign = calls.find(one => one.url.includes("signIn"))
    // DS 形如 `t,r,md5`；DS1 的 r 是六位小写字母数字，DS2 的 r 是六位数字
    expect(missions?.headers["DS"]?.split(",")[1]).toMatch(/^[a-z0-9]{6}$/)
    expect(sign?.headers["DS"]?.split(",")[1]).toMatch(/^\d{6}$/)
    // 签到那一条带请求体，版块 id 在里面
    expect(sign?.body).toBe(JSON.stringify({ gids: "2" }))
  })

  it("bbsText 把余额与逐版块结果折成一段话", () => {
    const text = SignService.bbsText({
      ltuid: "1001",
      dead: false,
      points: 120,
      canGet: 0,
      items: [{ name: "原神", status: "signed", message: "签到成功" }]
    })
    expect(text).toContain("米游币 120")
    expect(text).toContain("原神：签到成功")
  })
})

