/**
 * 模块职责：命令注册表与前缀中间件的测试
 * 依赖方向：测试文件，只依赖 commands/index.ts 的纯函数与一个极简假上下文
 * 生命周期：无状态
 * 注意事项：本文件固定六项口径：每条命令具备三个游戏形态、**任何两个模式不得互为前缀**（前缀
 *          路由下互为前缀即相互遮挡）、命令表按游戏分四块排列、帮助各印自己那个游戏的前缀、
 *          `*体力` 由中间件规整为 `#星铁体力` 并把游戏写进状态袋，以及**「名字在触发词之前」
 *          的那几条关掉后必须静默** —— 它们会过一遍每条 `#` 开头的消息，出声等于把所有笔误
 *          都变成一句报错。
 */
import type { CommandBuilder, CommandHandler, CommandOptions, CommandPattern, MessageEvent } from "@yunzai-ng/types"
import { afterEach, describe, expect, it } from "vitest"
import type { MhyConfigView } from "../config.js"
import { CONFIG_SCHEMA } from "../config.js"
import { COMMAND_PREFIX, GAME_KEYS } from "../core/region.js"
import { GAME_STATE_KEY } from "../core/session.js"
import { MHY_COMMANDS, applyGame, commandPatterns, mhyHelp, registerMhyCommands, uidTailPatterns } from "./index.js"
import type { MhyCommandSpec } from "./index.js"
import type { MhyDeps } from "./deps.js"

/** 注册下来的一条命令 */
interface Registered {
  /** 主模式 */
  pattern: CommandPattern
  /** 选项 */
  opts: CommandOptions | undefined
  /** 处理函数，用来验功能开关 */
  action?: CommandHandler
}

/** 假上下文记录下来的注册结果 */
interface Recorded {
  /** 全部命令 */
  commands: Registered[]
  /** 注册了几个中间件 */
  middlewares: number
}

/**
 * 造一个只记录注册动作的假上下文
 * @returns 假上下文与记录
 */
function fakeCtx(): { ctx: Parameters<typeof registerMhyCommands>[0]; got: Recorded } {
  const got: Recorded = { commands: [], middlewares: 0 }
  const ctx = {
    command: (pattern: CommandPattern, opts?: CommandOptions): CommandBuilder => {
      const entry: Registered = { pattern, opts }
      got.commands.push(entry)
      const builder: CommandBuilder = {
        action: (fn: CommandHandler): CommandBuilder => {
          entry.action = fn
          return builder
        },
        dispose: (): void => undefined
      } as CommandBuilder
      return builder
    },
    middleware: (): (() => void) => {
      got.middlewares += 1
      return (): void => undefined
    }
  } as unknown as Parameters<typeof registerMhyCommands>[0]
  return { ctx, got }
}

/**
 * 造一条只有 text 与 state 的假消息事件
 * @param text 消息文本
 * @returns 假事件
 */
function fakeEvent(text: string): MessageEvent {
  return { kind: "message", text, state: {} } as unknown as MessageEvent
}

/**
 * 取全部注册模式（含别名）里的字符串部分
 *
 * **`tail: "uid"` 的那几条不算在内**：它们注册的是 `^…$` 锚定正则、一条裸前缀都没有，
 * 故既不会遮挡别人、也不会被别人遮挡（见 {@link MhyCommandSpec.tail}）。
 */
function allStringPatterns(): string[] {
  return MHY_COMMANDS.filter(spec => spec.tail !== "uid").flatMap(spec => commandPatterns(spec.words))
}

describe("commandPatterns", () => {
  it("一个词展开成三个游戏的完整命令", () => {
    expect(commandPatterns(["体力"])).toEqual(["#体力", "#星铁体力", "#绝区零体力"])
  })

  it("每条命令的每个词都覆盖到三个游戏", () => {
    for (const spec of MHY_COMMANDS) {
      expect(commandPatterns(spec.words)).toHaveLength(spec.words.length * GAME_KEYS.length)
    }
  })
})

describe("命令表", () => {
  it("没有重复的触发模式", () => {
    const all = allStringPatterns()
    expect(new Set(all).size).toBe(all.length)
  })

  it("没有任何模式是另一个的前缀 —— 前缀路由下那等于互相遮挡", () => {
    // 被遮挡但**自己的 priority 更小**的放过：内核多条都中时取 priority 最小的那条，
    // 故 `#排行帮助`（90）压过裸的 `#排行`（缺省 100）。不认这一条就只能把命令改成别扭的名字
    const priority = new Map<string, number>()
    for (const spec of MHY_COMMANDS) {
      if (spec.tail === "uid") continue
      for (const one of commandPatterns(spec.words)) priority.set(one, spec.opts?.priority ?? 100)
    }

    const all = [...priority.keys()]
    const shadowed = all.filter(one =>
      all.some(other => {
        if (other === one || !one.startsWith(other)) return false
        return (priority.get(one) ?? 100) >= (priority.get(other) ?? 100)
      })
    )
    expect(shadowed).toEqual([])
  })

  it("每条命令都有说明与分组，帮助才有得可写", () => {
    for (const spec of MHY_COMMANDS) {
      expect(spec.desc.length).toBeGreaterThan(0)
      expect(spec.group.length).toBeGreaterThan(0)
      expect(spec.words.length).toBeGreaterThan(0)
    }
  })

  it("按游戏分四块排列：通用在前，随后原神、星铁、绝区零", () => {
    // 表的顺序即帮助的顺序；条目交错排列不报错，只是那张清单从此没有条理
    const rank: Readonly<Record<string, number>> = { gs: 1, sr: 2, zzz: 3 }
    const seq = MHY_COMMANDS.map(spec => rank[spec.game ?? ""] ?? 0)

    expect(seq).toEqual([...seq].sort((a, b) => a - b))
  })
})

describe("实际输入落到哪条命令", () => {
  /**
   * 按内核的规则算出一条消息会命中哪条命令：字符串模式按前缀匹配、正则按整条，多条都中时取
   * `priority` 最小的（缺省 100）
   * @param text 消息原文
   * @returns 命中的那条命令；一条都不中时 undefined
   */
  function routeOf(text: string): MhyCommandSpec | undefined {
    const hits = MHY_COMMANDS.filter(spec => {
      // 与 registerMhyCommands 一致：`tail: "uid"` 的那几条一条裸前缀都不注册
      if (spec.tail === "uid") {
        if (uidTailPatterns(spec.words).some(re => re.test(text))) return true
      } else if (commandPatterns(spec.words).some(one => text.startsWith(one))) {
        return true
      }
      return (spec.extra ?? []).some(re => re.test(text))
    })
    return [...hits].sort((a, b) => (a.opts?.priority ?? 100) - (b.opts?.priority ?? 100))[0]
  }

  /**
   * 取一条命令的主词，用于断言
   * @param text 消息原文
   * @returns 主词；没命中时空串
   */
  function wordOf(text: string): string {
    return routeOf(text)?.words[0] ?? ""
  }

  it("「#活动」是「#活动日历」的前缀，两条各归其位", () => {
    expect(wordOf("#活动日历")).toBe("活动日历")
    expect(wordOf("#绝区零活动日历")).toBe("活动日历")
    expect(wordOf("#活动")).toBe("日历")
  })

  it("带角色名的那几条落到对应命令", () => {
    // 角色面板归 `#面板` 那一条（缺省优先级），裸角色名才归优先级 900 的角色卡片
    expect(wordOf("#胡桃面板")).toBe("面板")
    expect(wordOf("#胡桃")).toBe("角色卡片")
    expect(wordOf("#胡桃图鉴")).toBe("角色图鉴")
    expect(wordOf("#胡桃天赋")).toBe("角色天赋")
    expect(wordOf("#胡桃攻略")).toBe("角色攻略")
    expect(wordOf("#胡桃更新攻略")).toBe("角色攻略")
    expect(wordOf("#更新胡桃攻略")).toBe("角色攻略")
    expect(wordOf("#胡桃素材")).toBe("角色素材")
  })

  it("「换」到圣遗物的写法归换装试算，不被「X圣遗物」截走", () => {
    expect(wordOf("#胡桃换刻晴圣遗物")).toBe("换装试算")
    expect(wordOf("#星铁青雀换景元遗器")).toBe("换装试算")
    // 「上期」两种语序都落到挑战那条，不被角色卡片截走
    expect(wordOf("#星铁上期虚构叙事")).toBe("虚构叙事")
    expect(wordOf("#星铁上期末日幻影")).toBe("末日幻影")
    expect(wordOf("#星铁上期异相仲裁")).toBe("异相仲裁")
    expect(wordOf("#胡桃圣遗物")).toBe("圣遗物")
    expect(wordOf("#胡桃伤害换满命")).toBe("换装试算")
  })

  it("`#绑定<uid>` 省去 uid 二字也归绑定，`#绑定CK` 不受影响", () => {
    expect(wordOf("#绑定258044862")).toBe("绑定uid")
    expect(wordOf("#绑定uid100000001")).toBe("绑定uid")
    expect(wordOf("#绑定CK")).toBe("绑定CK")
    expect(wordOf("#星铁绑定258044862")).toBe("绑定uid")
  })

  it("`#更新面板` 不被「查一个叫「更新」的角色」抢走", () => {
    // 星铁形态用中间件规整之后的写法：`*更新面板` 到达路由时已是 `#星铁更新面板`
    expect(wordOf("#更新面板")).toBe("更新面板")
    expect(wordOf("#星铁更新面板")).toBe("更新面板")
  })

  it("`#米游社更新面板` 落到自己那条，而不是面板列表", () => {
    // 排除词的否定预查只覆盖角色名开头时，这条会被面板那条抢走，回一句「暂无面板数据」
    expect(wordOf("#米游社更新面板")).toBe("米游社更新面板")
    expect(wordOf("#米游社面板")).toBe("米游社更新面板")
  })

  it("`#展柜更新面板` 落到自己那条 —— 它不能叫「面板服务更新面板」", () => {
    // 限定词放在前面：那时 `面板` 是裸前缀，以它起头的任何一串都会被整条吃掉。
    // `面板` 收口之后不再吃，但限定词仍放在前面 —— 改回去只会让这条命令与收口那条重叠
    expect(wordOf("#展柜更新面板")).toBe("展柜更新面板")
    expect(wordOf("#星铁展柜更新面板")).toBe("展柜更新面板")
    // 收口后它不被 `面板` 吃掉，而是落到角色卡片那条、得到一句"认不出这个角色"
    expect(wordOf("#面板服务更新面板")).toBe("角色卡片")
  })

  it("`#刷新CK` 三种写法都发得出去，且不与主人专用的 `#刷新CK缓存` 相抢", () => {
    // core/text.ts 的失效提示指的是裸的「#刷新ck」，命令必须接得住它
    for (const one of ["#刷新ck", "#刷新CK", "#刷新Ck", "#刷新cookie", "#刷新Cookie", "#更新cookie"]) {
      expect(wordOf(one), one).toBe("刷新CK凭据")
    }
    expect(wordOf("#刷新CK缓存")).toBe("刷新用户缓存")
    expect(wordOf("#刷新用户缓存")).toBe("刷新用户缓存")
    // 游戏前缀规整后的形态同样要收
    expect(wordOf("#星铁刷新ck")).toBe("刷新CK凭据")
  })

  it("`#最强XX面板` 落到榜一那条，维度关键词夹在中间也一样", () => {
    expect(wordOf("#最强胡桃面板")).toBe("最强")
    expect(wordOf("#最强双爆胡桃面板")).toBe("最强")
    expect(wordOf("#最强评分胡桃面板")).toBe("最强")
    expect(wordOf("#群内最强胡桃面板")).toBe("最强")
    expect(wordOf("#星铁最强青雀面板")).toBe("最强")
    // 不与排行那几条相抢
    expect(wordOf("#胡桃排行")).toBe("排行")
    expect(wordOf("#刷新排名")).toBe("刷新排名")
  })

  it("提示语里提到的每条命令都真能路由 —— 指一条发不出去的命令等于把人挡在门外", () => {
    // 判据是 core/text.ts 的失效提示：它是使用者最常撞见的一句
    for (const one of ["#刷新ck", "#扫码登录"]) {
      expect(wordOf(one), `${one} 路由不到`).not.toBe("")
    }
  })

  it("收口过的那几条只接「光一个词」或「词 + uid」，别的一概不接", () => {
    // `words` 是裸前缀，不收口则 `#面板发这个` 也会命中、rest 变成「发这个」
    expect(wordOf("#面板")).toBe("面板")
    expect(wordOf("#面板列表")).toBe("面板")
    expect(wordOf("#面板123456789")).toBe("面板")
    expect(wordOf("#面板 123456789")).toBe("面板")
    expect(wordOf("#星铁面板123456789")).toBe("面板")
    expect(wordOf("#面板发这个")).not.toBe("面板")
    expect(wordOf("#面板12")).not.toBe("面板")

    expect(wordOf("#圣遗物")).toBe("圣遗物")
    expect(wordOf("#圣遗物列表")).toBe("圣遗物")
    expect(wordOf("#圣遗物123456789")).toBe("圣遗物")
    expect(wordOf("#圣遗物发这个")).not.toBe("圣遗物")

    expect(wordOf("#角色列表")).toBe("角色列表")
    expect(wordOf("#角色123456789")).toBe("角色列表")
    expect(wordOf("#练度统计123456789")).toBe("练度统计")
    expect(wordOf("#练度统计发这个")).not.toBe("练度统计")
  })

  it("带角色名那一支不受收口影响 —— 它走的是另一条正则", () => {
    expect(wordOf("#胡桃面板")).toBe("面板")
    expect(wordOf("#胡桃圣遗物")).toBe("圣遗物")
    expect(wordOf("#绝区零安比驱动盘")).toBe("圣遗物")
  })

  it("`#原图` 落到原图那条，`#背景原图` 已撤掉", () => {
    expect(wordOf("#原图")).toBe("原图")
    expect(wordOf("#背景原图")).not.toBe("背景原图")
  })

  it("`#<角色>伤害` 落到伤害那条，带序号也一样", () => {
    expect(wordOf("#胡桃伤害")).toBe("伤害")
    expect(wordOf("#胡桃伤害2")).toBe("伤害")
    expect(wordOf("#星铁青雀伤害")).toBe("伤害")
    // 裸词也要在，否则整条命令连别名一起不注册
    expect(wordOf("#伤害")).toBe("伤害")
  })

  it("排行那一族的三条互不相抢", () => {
    expect(wordOf("#胡桃排行")).toBe("排行")
    expect(wordOf("#重置排名")).toBe("重置排名")
    expect(wordOf("#启用排名")).toBe("启用排名")
    // 带装备名的那几种写法也落到排行，不被圣遗物 / 驱动盘的面板页抢走
    expect(wordOf("#胡桃圣遗物排行")).toBe("排行")
    expect(wordOf("#绝区零艾莲驱动盘排行")).toBe("排行")
  })

  it("日期词归今日材料，不被图鉴的材料页抢走", () => {
    expect(wordOf("#今日材料")).toBe("今日材料")
    expect(wordOf("#明日材料")).toBe("今日材料")
    expect(wordOf("#周三材料")).toBe("今日材料")
  })

  it("养成一律算养成（不带数字按满级算），材料另走「材料」", () => {
    expect(wordOf("#刻晴养成")).toBe("养成计算")
    expect(wordOf("#刻晴养成81 90 9 9 9")).toBe("养成计算")
    expect(wordOf("#刻晴材料")).toBe("角色材料")
  })

  it("元数据那几种说法都认得出", () => {
    for (const one of ["#更新元数据", "#安装meta", "#更新meta", "#安装元数据"]) {
      expect(wordOf(one), one).toBe("更新元数据")
    }
    expect(wordOf("#元数据状态")).toBe("元数据状态")
  })

  it("签到三族分得清：游戏、社区、余额", () => {
    expect(wordOf("#米游社签到")).toBe("米游社签到")
    expect(wordOf("#社区签到")).toBe("社区签到")
    expect(wordOf("#米游币")).toBe("米游币")
    expect(wordOf("#扫码登录")).toBe("扫码登录")
  })

  it("裸的「签到」「角色」认得，且不吃掉以它们开头的命令", () => {
    // 这两个词最自然，一条都不中时发出去毫无回应
    expect(wordOf("#签到")).toBe("米游社签到")
    // 文档写的就是这一句；`cmdRe` 以 `$` 收尾，只收「签到」会让它静默落空
    expect(wordOf("#签到全部")).toBe("米游社签到")
    expect(wordOf("#绝区零签到全部")).toBe("米游社签到")
    expect(wordOf("#角色")).toBe("角色列表")
    expect(wordOf("#星铁角色")).toBe("角色列表")
    // 整串正则的作用就在这里：以它们开头的那些词一条也不受影响
    expect(wordOf("#签到状态")).toBe("签到状态")
    expect(wordOf("#角色列表")).toBe("角色列表")
    expect(wordOf("#角色图鉴")).toBe("角色图鉴")
    expect(wordOf("#角色天赋")).toBe("角色天赋")
    expect(wordOf("#角色素材")).toBe("角色素材")
    expect(wordOf("#角色养成")).toBe("角色养成")
    expect(wordOf("#角色统计")).toBe("抽卡统计")
  })

  it("「更新抽卡记录」与「抽卡记录」是两条命令：前者只更新、后者出时间轴", () => {
    expect(wordOf("#更新抽卡记录")).toBe("更新抽卡记录")
    expect(wordOf("#抽卡记录")).toBe("抽卡记录")
    expect(wordOf("#删除抽卡链接")).toBe("删除抽卡链接")
  })

  it("体力提醒一族仍归 `#体力` 那一条 —— 它是前者的前缀", () => {
    expect(wordOf("#体力")).toBe("体力")
    expect(wordOf("#体力提醒")).toBe("体力")
    expect(wordOf("#体力提醒150")).toBe("体力")
  })
})

describe("mhyHelp", () => {
  it("按分组列出每条命令的主形态，隐藏项不出现", () => {
    const help = mhyHelp()

    for (const spec of MHY_COMMANDS) {
      // 只对某一个游戏成立的那几条印它自己的前缀，理由见 mhyHelp
      const line = `${COMMAND_PREFIX[spec.game ?? "gs"]}${spec.words[0]}`
      if (spec.opts?.hidden) expect(help).not.toContain(line)
      else expect(help).toContain(line)
    }
    expect(help).toContain("【账号】")
    expect(help).toContain("【查询】")
    expect(help).toContain("【抽卡】")
  })

  it("星铁与绝区零专属的那几条印自己的前缀 —— 印 `#虚构叙事` 等于给一个发出去会被拒的形态", () => {
    const help = mhyHelp()

    expect(help).toContain(`${COMMAND_PREFIX.sr}虚构叙事`)
    expect(help).toContain(`${COMMAND_PREFIX.zzz}式舆防卫战`)
    expect(help).not.toContain(`${COMMAND_PREFIX.gs}虚构叙事`)
  })

  it("末尾说明另外两个游戏怎么加前缀", () => {
    expect(mhyHelp()).toContain("*体力")
  })
})

describe("applyGame", () => {
  it("`*体力` 规整成 `#星铁体力`，游戏写进状态袋", () => {
    const e = fakeEvent("*体力")

    expect(applyGame(e)).toBe("sr")
    expect(e.text).toBe("#星铁体力")
    expect(e.state[GAME_STATE_KEY]).toBe("sr")
  })

  it("`%体力` 认成绝区零", () => {
    const e = fakeEvent("%体力")

    expect(applyGame(e)).toBe("zzz")
    expect(e.text).toBe("#绝区零体力")
  })

  it("没有前缀时按原神算，且一个字都不改", () => {
    const e = fakeEvent("#体力")

    expect(applyGame(e)).toBe("gs")
    expect(e.text).toBe("#体力")
    expect(e.state[GAME_STATE_KEY]).toBe("gs")
  })
})

describe("registerMhyCommands", () => {
  const deps = {} as MhyDeps

  it("一条命令注册一次，主模式是原神形态，其余进 alias", () => {
    const { ctx, got } = fakeCtx()
    registerMhyCommands(ctx, deps)

    expect(got.commands).toHaveLength(MHY_COMMANDS.length)
    const note = got.commands[0]
    expect(note?.pattern).toBe(`${COMMAND_PREFIX.gs}${MHY_COMMANDS[0]?.words[0]}`)
    expect(Array.isArray(note?.opts?.alias)).toBe(true)
  })

  it("先挂中间件：前缀规整必须发生在命令匹配之前", () => {
    const { ctx, got } = fakeCtx()
    registerMhyCommands(ctx, deps)

    expect(got.middlewares).toBe(1)
  })

  it("札记带上「月份写在前面」的正则形态", () => {
    const { ctx, got } = fakeCtx()
    registerMhyCommands(ctx, deps)

    const ledger = got.commands.find(it => it.pattern === "#札记")
    const alias = [ledger?.opts?.alias ?? []].flat()
    expect(alias.some(it => it instanceof RegExp)).toBe(true)
    expect(alias.filter(it => it instanceof RegExp).some(re => (re as RegExp).test("#7月札记"))).toBe(true)
  })

  it("CK池 只给主人，别的命令不设这个门槛", () => {
    const { ctx, got } = fakeCtx()
    registerMhyCommands(ctx, deps)

    expect(got.commands.find(it => it.pattern === "#CK池")?.opts?.master).toBe(true)
    expect(got.commands.find(it => it.pattern === "#体力")?.opts?.master).toBeUndefined()
  })
})

describe("功能开关", () => {
  /** 会话构造要用到的那几个字段，别的一概不给 */
  const EVENT = {
    kind: "message",
    state: {},
    isGroup: false,
    isPrivate: true,
    isMaster: false,
    isGroupAdmin: false,
    images: [],
    message: [],
    target: { scene: "private", uid: "1" },
    bot: { selfId: "bot-1" },
    sender: { uid: "1", name: "旅行者" },
    platform: "qq",
    command: { rest: "", groups: {} }
  }

  /**
   * 触发一条命令；依赖包只给四项，别的被读到即抛错，故"处理函数跑没跑"不必替换任何东西就看得出
   * @param pattern 主模式
   * @param over 要覆盖的配置项
   * @returns 处理函数跑没跑、以及回了什么
   */
  async function fire(
    pattern: string,
    over: Partial<MhyConfigView> = {}
  ): Promise<{ ran: boolean; said: string[] }> {
    const said: string[] = []
    const allowed = new Set(["config", "logger", "render", "http"])
    const base = {
      config: (): MhyConfigView => ({ ...CONFIG_SCHEMA.parse({}), ...over }),
      logger: { debug: (): void => undefined, warn: (): void => undefined }
    }
    const deps = new Proxy(base, {
      get(target, key): unknown {
        if (allowed.has(String(key))) return target[key as keyof typeof target]
        throw new Error(`RAN:${String(key)}`)
      }
    }) as unknown as MhyDeps

    const { ctx, got } = fakeCtx()
    registerMhyCommands(ctx, deps)
    // `tail: "uid"` 的那几条主模式是正则而非字符串，故两种形态都试
    const entry = got.commands.find(one =>
      one.pattern instanceof RegExp ? one.pattern.test(pattern) : one.pattern === pattern
    )
    expect(entry?.action, `找不到 ${pattern} 这条命令`).toBeDefined()

    try {
      await entry?.action?.({
        ...EVENT,
        text: pattern,
        reply: async (content: unknown): Promise<void> => void said.push(String(content))
      } as unknown as MessageEvent)
    } catch (err) {
      // 只有"读到了被禁的依赖"这一种错才算跑起来了，别的错要原样抛出去
      if (!(err instanceof Error) || !err.message.startsWith("RAN:")) throw err
      return { ran: true, said }
    }
    return { ran: false, said }
  }

  it("缺省全开 —— 纯读的功能开关不该多一道要人先开的闸", () => {
    const cfg = CONFIG_SCHEMA.parse({})
    for (const key of [
      "enableAvatarList",
      "enableAvatarCard",
      "enableAbyss",
      "enablePanel",
      "enableGroupRank",
      "enableProfileStat",
      "enableGachaStat",
      "enableCharWiki",
      "enableCharTalent",
      "enableCharPic",
      "enableUnreleased",
      "enableCustomSplash",
      "srSharedSplashDir",
      "panelImgList",
      "allowBindDevice",
      "enableCharStrategy"
    ] as const) {
      expect(cfg[key]).toBe(true)
    }
    // 而"插件自己主动做的事"一律缺省关，两类不能混
    expect(cfg.enableAutoSign).toBe(false)
    expect(cfg.enableStaminaRemind).toBe(false)
    expect(cfg.enableWikiStat).toBe(false)
    expect(cfg.enableDmgCalc).toBe(false)
    expect(cfg.enableCalendarFix).toBe(false)
    expect(cfg.autoInstallMeta).toBe(false)
    // 缺省走米游社（绑了 CK 时才实际走，没绑自动回落面板服务）
    expect(cfg.panelUpdateByMys).toBe(true)
  })

  it("开着就照常执行", async () => {
    expect((await fire("#角色列表")).ran).toBe(true)
  })

  it("关掉的普通命令明说是被主人关了 —— 静悄悄没反应形同故障", async () => {
    const got = await fire("#角色列表", { enableAvatarList: false })

    expect(got.ran).toBe(false)
    expect(got.said.join("")).toContain("主人关掉")
  })

  it("角色卡片与图鉴关掉后静默 —— 它们会过一遍每条 # 开头的消息", async () => {
    for (const pattern of ["#角色卡片", "#角色图鉴", "#角色天赋", "#角色图片"]) {
      const spec = MHY_COMMANDS.find(one => `${COMMAND_PREFIX.gs}${one.words[0]}` === pattern)
      expect(spec?.gate).toBeDefined()
      expect(spec?.offText).toBeUndefined()
    }

    const got = await fire("#角色卡片", { enableAvatarCard: false })
    expect(got.ran).toBe(false)
    expect(got.said).toEqual([])
  })

  it("排行要面板与排行两道都开着 —— 它读的是面板那份数据", async () => {
    expect((await fire("#排行", { enablePanel: false })).ran).toBe(false)
    expect((await fire("#排行", { enableGroupRank: false })).ran).toBe(false)
    expect((await fire("#排行")).ran).toBe(true)
  })

  // 内核只记 `err.message`，而那类消息不含位置，同一句话在本插件里有七十余处可能的出处
  describe("出错时记栈", () => {
    /**
     * 驱动一条命令，其 handler 必定抛出给定的错误
     * @param err 要抛的错误
     * @param logger 日志器
     * @returns 传出来的错误
     */
    async function fireThrowing(err: unknown, logger: unknown): Promise<unknown> {
      const deps = {
        config: (): MhyConfigView => CONFIG_SCHEMA.parse({}),
        logger
      } as unknown as MhyDeps
      const { ctx, got } = fakeCtx()
      registerMhyCommands(ctx, deps)
      // 借「帮助」那条：它没有开关，且 handler 只读 deps.config
      const entry = got.commands.find(one => one.pattern === `${COMMAND_PREFIX.gs}${MHY_COMMANDS[0]?.words[0]}`)
      const spec = MHY_COMMANDS[0]
      if (spec) spec.handler = async (): Promise<void> => Promise.reject(err)

      try {
        await entry?.action?.({
          ...EVENT,
          text: entry.pattern,
          reply: async (): Promise<void> => undefined
        } as unknown as MessageEvent)
      } catch (caught) {
        return caught
      }
      return undefined
    }

    /** 原来的 handler，改完要还回去 —— 命令表是模块级常量 */
    const original = MHY_COMMANDS[0]?.handler

    afterEach(() => {
      const spec = MHY_COMMANDS[0]
      if (spec && original) spec.handler = original
    })

    it("记的是栈而不只是那一句话，且错误原样传出去", async () => {
      const lines: string[] = []
      const boom = new TypeError("Cannot read properties of undefined (reading 'includes')")
      const got = await fireThrowing(boom, {
        debug: (): void => undefined,
        warn: (): void => undefined,
        error: (msg: string): void => void lines.push(msg)
      })

      expect(got).toBe(boom)
      expect(lines).toHaveLength(1)
      // 有栈才定位得到出处：只有 message 时这条日志与内核那条等价，等于没加
      expect(lines[0]).toContain("Cannot read properties of undefined")
      expect(lines[0]).toContain("index.test.ts")
    })

    it("日志器没有 error 时照样把原错误抛出去 —— 记日志不许改变结果", async () => {
      const boom = new Error("原本的错误")
      // 只给 debug 与 warn，与本文件 `fire` 里那个日志器同形
      const got = await fireThrowing(boom, { debug: (): void => undefined, warn: (): void => undefined })

      expect(got).toBe(boom)
    })
  })

  it("账号绑定一族恒没有开关 —— 给「用别的功能的前提」加闸只会让人卡在第一步", () => {
    for (const pattern of ["#绑定CK", "#绑定uid", "#我的uid", "#设备信息", "#米游社帮助"]) {
      const spec = MHY_COMMANDS.find(one => one.words.some(w => `${COMMAND_PREFIX.gs}${w}` === pattern))
      expect(spec, pattern).toBeDefined()
      expect(spec?.gate).toBeUndefined()
    }
  })

  it("带 offText 的都不是「名字在触发词之前」那一类，反之亦然", () => {
    for (const spec of MHY_COMMANDS) {
      if (!spec.gate) continue
      const silent = (spec.opts?.priority ?? 100) >= 800
      expect(spec.offText === undefined).toBe(silent)
    }
  })
})
