/**
 * 模块职责：`#米游社签到`、`#自动签到`、`#签到状态` 三条命令的测试
 * 依赖方向：测试文件，依赖 commands/sign 与真实的 SignStore（内存 KV），Cookie 池与签到服务是假的
 * 生命周期：每个用例一套新 KV
 * 注意事项：固定三项与"代替使用者写入"相关的口径：只签自己名下的账号（断言取 `owned` 而非
 *          `list`）、开启自动签到时把每天会做什么说清、**总开关没开时明说现在还不会真的执行**
 *          —— 否则使用者以为开了、其实没开。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { beforeEach, describe, expect, it } from "vitest"
import type { MhyConfigView } from "../config.js"
import type { Session } from "../core/session.js"
import type { CookieRecord } from "../store/ck.js"
import { SignStore } from "../store/sign.js"
import type { SignReport } from "../service/sign.js"
import type { MhyDeps } from "./deps.js"
import { cronText, pickSignGames, signNow, signStatus, toggleAutoSign } from "./sign.js"

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

/** 假会话，记录回复 */
interface Spy extends Session {
  /** 收到的全部回复 */
  readonly said: string[]
}

/**
 * 造一个假会话
 * @param rest 命令之后的内容
 * @param game 游戏
 * @returns 假会话
 */
function makeSession(rest = "", game: Session["game"] = "gs"): Spy {
  const said: string[] = []
  return {
    user: "qq:1",
    name: "旅行者",
    rest,
    game,
    isPrivate: true,
    isMaster: false,
    isGroupAdmin: false,
    botId: "bot-1",
    lastSent: (): string => "msg-1",
    images: [],
    said,
    text: async (content: string): Promise<void> => void said.push(content),
    image: async (): Promise<boolean> => false,
    ask: async (): Promise<undefined> => undefined,
    file: async (): Promise<undefined> => undefined,
    askFile: async (): Promise<undefined> => undefined,
    sendFile: async (): Promise<boolean> => false,
    imageBytes: async (): Promise<boolean> => false,
    imageFile: async (): Promise<boolean> => false,
    forward: async (): Promise<boolean> => false
  }
}

/** 一份配置，只有签到那两项要紧 */
const CONFIG = { enableAutoSign: false, autoSignCron: "0 35 8 * * *" } as unknown as MhyConfigView

let signs: SignStore

beforeEach(() => {
  signs = new SignStore({ kv: new Kv(new MemoryKvDriver()).sub("sign") })
})

/** 一次运行的观察结果 */
interface Watch {
  /** 真的签了哪些账号 */
  ran: { ltuid: string; games?: readonly string[] }[]
  /** 被停用的账号 */
  disabled: string[]
  /** `list` 有没有被调用过 —— 它一次都不该被调用 */
  listed: boolean
}

/**
 * 造一份依赖包
 * @param owned 这个使用者名下的 CK
 * @param opts 让签到返回失效，或改配置
 * @returns 依赖包与观察结果
 */
function makeDeps(
  owned: readonly Partial<CookieRecord>[],
  opts: { dead?: boolean; config?: Partial<MhyConfigView> } = {}
): { deps: MhyDeps; watch: Watch } {
  const watch: Watch = { ran: [], disabled: [], listed: false }
  const records = owned.map(one => ({ ltuid: "1001", cookie: "ltuid=1001", disabled: false, ...one }) as CookieRecord)
  const deps = {
    cookies: {
      owned: async (): Promise<CookieRecord[]> => records,
      list: async (): Promise<CookieRecord[]> => {
        watch.listed = true
        return records
      },
      disable: async (ltuid: string): Promise<boolean> => {
        watch.disabled.push(ltuid)
        return true
      }
    },
    signs,
    sign: {
      run: async ({ ltuid }: { ltuid: string }, games?: readonly string[]): Promise<SignReport> => {
        watch.ran.push({ ltuid, ...(games ? { games } : {}) })
        return {
          ltuid,
          dead: opts.dead ?? false,
          items: [
            {
              game: "gs",
              name: "原神",
              uid: "100000001",
              nickname: "旅行者",
              status: opts.dead ? "cookie" : "signed",
              message: opts.dead ? "Cookie 已失效" : "签到成功",
              total: 7
            }
          ]
        }
      }
    },
    logger: LOGGER,
    config: () => ({ ...CONFIG, ...opts.config })
  } as unknown as MhyDeps
  return { deps, watch }
}

describe("pickSignGames", () => {
  it("指名的优先，其次「全部」，最后回落到游戏前缀", () => {
    expect(pickSignGames(makeSession("星铁"))).toEqual(["sr"])
    expect(pickSignGames(makeSession("全部"))).toBeUndefined()
    expect(pickSignGames(makeSession("", "sr"))).toEqual(["sr"])
    expect(pickSignGames(makeSession(""))).toEqual(["gs"])
  })

  it("绝区零也签 —— 它与另两个走同一条签到接口，只是活动 id 与 signgame 不同", () => {
    expect(pickSignGames(makeSession("", "zzz"))).toEqual(["zzz"])
  })
})

describe("signNow", () => {
  it("三个游戏都签得动，绝区零不再被挡在门外", async () => {
    const { deps, watch } = makeDeps([{}])
    const s = makeSession("", "zzz")
    await signNow(s, deps)

    expect(s.said[0]).toContain("开始签到")
    expect(watch.ran.length).toBeGreaterThan(0)
  })

  it("没有自己的 CK 时指路到绑定，不解释内部为什么", async () => {
    const { deps } = makeDeps([])
    const s = makeSession()
    await signNow(s, deps)

    expect(s.said[0]).toContain("#绑定CK")
    // 不提"公共池"：查询只用本人的 CK，提它只会让人以为还有这回事
    expect(s.said[0]).not.toContain("公共池")
  })

  it("只签自己名下的账号 —— 一次都不该去翻整个池子", async () => {
    const { deps, watch } = makeDeps([{ ltuid: "1001" }])
    await signNow(makeSession(), deps)

    expect(watch.listed).toBe(false)
    expect(watch.ran.map(one => one.ltuid)).toEqual(["1001"])
  })

  it("先说一句已开始，再报结果，并把结果记进流水", async () => {
    const { deps } = makeDeps([{ ltuid: "1001" }])
    const s = makeSession()
    await signNow(s, deps)

    expect(s.said[0]).toContain("开始签到")
    expect(s.said[1]).toContain("签到成功")
    expect(await signs.signedToday("1001")).toBe(true)
  })

  it("已停用的 CK 不参与", async () => {
    const { deps, watch } = makeDeps([{ ltuid: "1001", disabled: true }])
    const s = makeSession()
    await signNow(s, deps)

    expect(watch.ran).toEqual([])
    expect(s.said[0]).toContain("#绑定CK")
  })

  it("签到时发现 Cookie 失效就把那条停用", async () => {
    const { deps, watch } = makeDeps([{ ltuid: "1001" }], { dead: true })
    await signNow(makeSession(), deps)

    expect(watch.disabled).toEqual(["1001"])
    expect(await signs.signedToday("1001")).toBe(false)
  })

  it("带「全部」时不限定游戏", async () => {
    const { deps, watch } = makeDeps([{ ltuid: "1001" }])
    await signNow(makeSession("全部"), deps)
    expect(watch.ran[0]?.games).toBeUndefined()
  })
})

describe("cronText", () => {
  it("每天固定时分说成「每天 HH:MM」，5 段与 6 段都认", () => {
    expect(cronText("0 35 8 * * *")).toBe("每天 08:35")
    expect(cronText("5 21 * * *")).toBe("每天 21:05")
  })

  it("其余写法原样给出 cron —— 猜错会把签到时间说错", () => {
    expect(cronText("0 */2 * * *")).toBe("按 cron「0 */2 * * *」")
    expect(cronText("0 35 8 * * 1-5")).toBe("按 cron「0 35 8 * * 1-5」")
  })
})

describe("toggleAutoSign", () => {
  it("开启时把每天几点、验证码怎么办、怎么关都说清", async () => {
    const { deps } = makeDeps([{ ltuid: "1001" }])
    const s = makeSession()
    await toggleAutoSign(s, deps)

    expect(await signs.get("1001")).toMatchObject({ enabled: true })
    expect(s.said[0]).toContain("每天 08:35 执行一次")
    expect(s.said[0]).toContain("代替你")
    expect(s.said[0]).toContain("#自动签到关闭")
    expect(s.said[0]).toContain("不会自动过码")
  })

  it("总开关没开时明说现在还不会真的执行", async () => {
    const { deps } = makeDeps([{ ltuid: "1001" }])
    const s = makeSession()
    await toggleAutoSign(s, deps)
    expect(s.said[0]).toContain("总开关")

    const on = makeDeps([{ ltuid: "1001" }], { config: { enableAutoSign: true } })
    const s2 = makeSession()
    await toggleAutoSign(s2, on.deps)
    expect(s2.said[0]).not.toContain("总开关")
  })

  it("关闭时说清手动签仍然可用", async () => {
    const { deps } = makeDeps([{ ltuid: "1001" }])
    await toggleAutoSign(makeSession(), deps)
    const s = makeSession("关闭")
    await toggleAutoSign(s, deps)

    expect(await signs.get("1001")).toMatchObject({ enabled: false })
    expect(s.said[0]).toContain("#米游社签到")
  })

  it("名下没有 CK 时先让人去绑", async () => {
    const { deps } = makeDeps([])
    const s = makeSession()
    await toggleAutoSign(s, deps)
    expect(s.said[0]).toContain("#绑定CK")
  })
})

describe("signStatus", () => {
  it("列出总开关、逐账号开关与上次结果", async () => {
    const { deps } = makeDeps([{ ltuid: "1001" }])
    await signs.setEnabled("1001", true)
    await signs.mark("1001", true, "原神 旅行者：签到成功")

    const s = makeSession()
    await signStatus(s, deps)

    expect(s.said[0]).toContain("未开启")
    // ltuid 即账号本体，群里也能发这条，回复里只给遮蔽形态
    expect(s.said[0]).toContain("【****】自动签到已开")
    expect(s.said[0]).not.toContain("1001")
    expect(s.said[0]).toContain("上次签到：")
    expect(s.said[0]).toContain("签到成功")
  })

  it("停用的 CK 在状态里标出来", async () => {
    const { deps } = makeDeps([{ ltuid: "1001", disabled: true }])
    const s = makeSession()
    await signStatus(s, deps)
    expect(s.said[0]).toContain("已停用")
  })
})
