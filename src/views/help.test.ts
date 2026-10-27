/**
 * 模块职责：主帮助与细分帮助视图的测试
 * 依赖方向：测试文件，依赖 views/help、views/guide、views/guide-extra 与 commands/catalog
 * 生命周期：无状态
 * 注意事项：钉的是**谁看得到什么**：普通人看不到群管理与主人两块，被关掉的条目不印且计数；
 *          以及记号随游戏换（星铁 `*`、绝区零 `%`），写死 `#` 会让人照抄得到一条发不出去的命令。
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildHelp, helpText } from "./help.js"
import { buildGachaGuide, buildPanelGuide, guideText } from "./guide.js"
import { buildBindGuide } from "./guide-extra.js"

/** 插件资源根 */
const RES = join(import.meta.dirname, "..", "..", "resources")

/** 普通群友 */
const NOBODY = { isMaster: false, isAdmin: false }

describe("buildHelp", () => {
  it("普通人看不到群管理与主人两块；群管理只多一块，主人两块都有", () => {
    const names = (who: typeof NOBODY): string[] => buildHelp("gs", who).sections.map(one => one.name)
    expect(names(NOBODY)).not.toContain("群管理")
    expect(names(NOBODY)).not.toContain("主人")
    expect(names({ isMaster: false, isAdmin: true })).toContain("群管理")
    expect(names({ isMaster: false, isAdmin: true })).not.toContain("主人")
    expect(names({ isMaster: true, isAdmin: false })).toEqual(expect.arrayContaining(["群管理", "主人"]))
  })

  it("整张图用当前游戏的记号，且只有这个游戏能用的条目", () => {
    const sr = buildHelp("sr", NOBODY)
    const cmds = sr.sections.flatMap(one => one.items.map(it => it.cmd))
    expect(cmds.every(one => one.startsWith("*"))).toBe(true)
    expect(cmds).toContain("*模拟宇宙")
    expect(cmds).not.toContain("*七圣卡组")
    expect(cmds).not.toContain("*危局强袭战")
    expect(buildHelp("zzz", NOBODY).sections.flatMap(one => one.items.map(it => it.cmd))).toContain("%安比面板")
  })

  it("关掉的条目不印，计入 hidden；文字版末尾说一句", () => {
    const view = buildHelp("gs", { ...NOBODY, visible: one => one.needs !== "enableDmgCalc" })
    expect(view.sections.flatMap(one => one.items.map(it => it.cmd))).not.toContain("#胡桃伤害")
    expect(view.hidden).toBe(1)
    expect(helpText(view)).toContain("另有 1 项已被主人关闭")
    expect(buildHelp("gs", NOBODY).hidden).toBe(0)
  })

  it("只在私聊受理的打「私聊」角标", () => {
    const items = buildHelp("gs", NOBODY).sections.flatMap(one => one.items)
    expect(items.find(one => one.cmd === "#绑定CK")?.tag).toBe("私聊")
    expect(items.find(one => one.cmd === "#抽卡导入")?.tag).toBe("私聊")
    expect(items.find(one => one.cmd === "#体力")?.tag).toBe("")
  })

  it("说明里的 {p} 换成当前游戏的记号，没有残留", () => {
    for (const game of ["gs", "sr", "zzz"] as const) {
      const text = helpText(buildHelp(game, { isMaster: true, isAdmin: true }))
      expect(text).not.toContain("{p}")
    }
    expect(helpText(buildHelp("zzz", NOBODY))).toContain("%7月札记")
  })

  it("每块的图标与吉祥物都在插件资源里", () => {
    for (const game of ["gs", "sr", "zzz"] as const) {
      const view = buildHelp(game, { isMaster: true, isAdmin: true })
      expect(existsSync(join(RES, view.hero)), view.hero).toBe(true)
      for (const one of view.sections) expect(existsSync(join(RES, one.icon)), one.icon).toBe(true)
    }
  })

  it("页脚提示另两个游戏的帮助怎么发", () => {
    const tips = buildHelp("gs", NOBODY).tips.join("")
    expect(tips).toContain("*帮助")
    expect(tips).toContain("%帮助")
  })
})

describe("细分帮助", () => {
  it("命令记号随游戏换", () => {
    const steps = buildGachaGuide("zzz").sections.flatMap(one => one.steps)
    expect(steps.filter(one => one.cmd).every(one => one.cmd?.startsWith("%"))).toBe(true)
    expect(guideText(buildGachaGuide("sr"))).toContain("SRGF v1.0")
    expect(guideText(buildGachaGuide("gs"))).toContain("祈愿记录")
  })

  it("绝区零的面板帮助没有换装试算，且不教它刷新天赋", () => {
    const zzz = guideText(buildPanelGuide("zzz"))
    expect(zzz).not.toContain("换钟离")
    expect(zzz).not.toContain("刷新天赋")
    expect(zzz).toContain("驱动盘")
    expect(guideText(buildPanelGuide("sr"))).toContain("*刷新行迹")
  })

  it("绑定帮助不说「只绑 uid 能查战绩」—— 按 CK 归属规则，战绩要本人的 CK", () => {
    const text = guideText(buildBindGuide("gs"))
    expect(text).toContain("战绩、便笺要 CK")
    expect(text).not.toMatch(/只绑 uid[^。]*能查[^。]*战绩/)
  })
})
