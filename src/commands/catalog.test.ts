/**
 * 模块职责：帮助目录、细分帮助与命令表的对账测试
 * 依赖方向：测试文件，依赖 catalog.ts、index.ts 的命令表与 views 下三张帮助的视图
 * 生命周期：无状态
 * 注意事项：这一份是**手写目录唯一的约束**，守四件事：一、目录里每条逐游戏路由到真正实现它的那条命令
 *          （只验「路由得到」会被 priority 900 的角色卡片兜底糊过去）；二、真驱动一遍不会回「只有X有 / 暂不支持」；
 *          三、细分帮助里每一步的命令同样能路由；四、命令表里每条可见命令要么在目录里，要么在 IN_GUIDE 里且
 *          真在它说的那张帮助上露面 —— 新加一条命令忘了写进帮助，这里就红。
 */
import { describe, expect, it } from "vitest"
import { COMMAND_PREFIX, GAME_KEYS, SHORT_PREFIX, type GameKey } from "../core/region.js"
import { buildHelp, helpText } from "../views/help.js"
import { buildGachaGuide, buildPanelGuide, guideText, type GuideView } from "../views/guide.js"
import { buildBindGuide, buildRankGuide } from "../views/guide-extra.js"
import { CATALOG, GUIDES, IN_GUIDE, catalogOf, inGame, type CatalogItem } from "./catalog.js"
import { MHY_COMMANDS, commandPatterns, uidTailPatterns } from "./index.js"

/** 全部条目 */
const ITEMS: readonly CatalogItem[] = CATALOG.flatMap(sec => sec.items)

/**
 * 按内核的规则算一条消息会命中哪条命令
 * @param text 消息原文（`#星铁` 一类全称前缀）
 * @returns 命中的那条；一条都不中时 undefined
 */
function routeOf(text: string): (typeof MHY_COMMANDS)[number] | undefined {
  const hits = MHY_COMMANDS.filter(spec => {
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
 * 把图上印的短记号写法换成内核认的全称前缀（`*体力` → `#星铁体力`）
 * @param cmd 图上那一条
 * @param game 游戏
 * @returns 全称写法
 */
function full(cmd: string, game: GameKey): string {
  return COMMAND_PREFIX[game] + cmd.slice(SHORT_PREFIX[game].length)
}

/** 三个游戏的四张细分帮助，按触发词 */
const GUIDE_VIEWS: Readonly<Record<string, (game: GameKey) => GuideView>> = {
  绑定帮助: buildBindGuide,
  面板帮助: buildPanelGuide,
  排行帮助: buildRankGuide,
  抽卡帮助: buildGachaGuide
}

/** 被挡的那几句话都长这样，见 commands 下各处 */
const REJECT = /只有(?:原神|星铁|星穹铁道|绝区零)(?:与绝区零)?有|当前仅支持|暂不支持|这个游戏还没有/

describe("帮助目录与命令表对账", () => {
  it("**每条都落到真正实现它的那条命令上**", () => {
    const bad: string[] = []
    for (const one of ITEMS) {
      for (const game of one.games) {
        const text = COMMAND_PREFIX[game] + inGame(one.word, game)
        const want = one.spec ?? inGame(one.word, game)
        const got = routeOf(text)
        if (!got) bad.push(`${text} 路由不到`)
        else if (!got.words.includes(want)) bad.push(`${text} 落到了「${got.words[0]}」而不是「${want}」`)
        if (got?.game && got.game !== game) bad.push(`${text} → 命令表标的是 ${got.game}`)
      }
    }
    expect(bad, bad.join("； ")).toEqual([])
  })

  it("**真驱动一遍：目录里每条都不会回「只有X有 / 暂不支持」**", async () => {
    const bad: string[] = []
    for (const one of ITEMS) {
      for (const game of one.games) {
        const word = inGame(one.word, game)
        const spec = routeOf(COMMAND_PREFIX[game] + word)
        if (!spec) continue
        const said: string[] = []
        // 任何一处取依赖就抛出去：说明它已经过了"这个游戏有没有这功能"那道判断
        const deps = new Proxy(
          { config: (): unknown => ({}), logger: { debug: (): void => undefined } },
          {
            get(target, key): unknown {
              if (key === "config" || key === "logger") return target[key as "config" | "logger"]
              throw new Error("PASSED")
            }
          }
        ) as unknown as Parameters<typeof spec.handler>[1]
        const s = {
          user: "qq:1",
          game,
          rest: word,
          isPrivate: true,
          isMaster: true,
          isGroupAdmin: true,
          text: async (t: string): Promise<void> => void said.push(t),
          image: async (): Promise<boolean> => false
        } as unknown as Parameters<typeof spec.handler>[0]
        await spec.handler(s, deps).catch(() => undefined)
        const hit = said.find(t => REJECT.test(t))
        if (hit) bad.push(`${COMMAND_PREFIX[game]}${word} → ${hit}`)
      }
    }
    expect(bad, bad.join("； ")).toEqual([])
  })

  it("细分帮助里每一步给出的命令都能路由，底部那排帮助触发词也能", () => {
    const bad: string[] = []
    for (const game of GAME_KEYS) {
      for (const build of Object.values(GUIDE_VIEWS)) {
        for (const sec of build(game).sections) {
          for (const one of sec.steps) if (one.cmd && !routeOf(full(one.cmd, game))) bad.push(`${game} ${one.cmd}`)
        }
      }
      for (const one of GUIDES) if (!routeOf(COMMAND_PREFIX[game] + one.word)) bad.push(`${game} ${one.word}`)
    }
    expect(bad, bad.join("； ")).toEqual([])
  })

  it("**命令表里每条可见命令都有去处**：要么在目录里，要么在 IN_GUIDE 说的那张帮助上真的露面", () => {
    const inCatalog = new Set(ITEMS.map(one => one.spec ?? (typeof one.word === "string" ? one.word : "")))
    const helpWords = new Set(MHY_COMMANDS.filter(c => c.group === "帮助" || GUIDES.some(g => c.words.includes(g.word))).flatMap(c => c.words))
    const bad: string[] = []
    for (const spec of MHY_COMMANDS) {
      const word = spec.words[0] ?? ""
      if (spec.opts?.hidden || helpWords.has(word) || inCatalog.has(word)) continue
      const where = IN_GUIDE[word]
      if (!where) {
        bad.push(`「${word}」既不在目录里，也没在 IN_GUIDE 里登记`)
        continue
      }
      const texts = GAME_KEYS.map(game => {
        if (where === "主帮助") return helpText(buildHelp(game, { isMaster: true, isAdmin: true }))
        if (where === "上期") return helpText(buildHelp(game, { isMaster: true, isAdmin: true })) + "上期"
        const build = GUIDE_VIEWS[where]
        return build ? guideText(build(game)) : ""
      }).join("\n")
      // 「上期X」只要 X 在、且「上期」这层讲到了
      const needle = where === "上期" ? word.replace(/^上期/, "") : word.replace(/^(查看|移除)/, "")
      if (!texts.includes(needle)) bad.push(`「${word}」说在${where}，那里却没有它`)
    }
    expect(bad, bad.join("； ")).toEqual([])
  })

  it("IN_GUIDE 里登记的都是命令表里真有的首个触发词", () => {
    const first = new Set(MHY_COMMANDS.map(c => c.words[0]))
    const bad = Object.keys(IN_GUIDE).filter(one => !first.has(one))
    expect(bad, `命令表里没有这些：${bad.join(", ")}`).toEqual([])
  })

  it("三个游戏各自的目录都有内容，且只留本游戏能用的条目", () => {
    for (const game of GAME_KEYS) {
      const got = catalogOf(game)
      expect(got.length, `${game} 的帮助是空的`).toBeGreaterThan(4)
      for (const sec of got) for (const one of sec.items) expect(one.games, `${sec.name}/${inGame(one.word, game)}`).toContain(game)
    }
  })
})
