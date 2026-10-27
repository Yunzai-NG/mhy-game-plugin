/**
 * 模块职责：配置 schema 的测试
 * 依赖方向：测试文件，只依赖 config.ts
 * 生命周期：无状态
 * 注意事项：钉住三件事。一是**每一项都有标题与说明** —— 少了在面板上就是一个没有名字的输入框。
 *          二是 `showWhen` 依赖的那个键必须真的存在：键名写错时那一项**永不显示**，面板上不报错。
 *          三是缺省值的两条口径（插件主动做的事缺省关、纯读的 `enable*` 缺省开），
 *          判据见 config.ts 的文件头。
 */
import { describe, expect, it } from "vitest"
import { CONFIG_SCHEMA } from "./config.js"

/** schema 里每一项的描述；说明那一项的键是 `description`，不是 `desc` */
const FIELDS = (CONFIG_SCHEMA.describe() as { properties?: Record<string, unknown> }).properties ?? {}

/** 全部字段名 */
const KEYS = Object.keys(CONFIG_SCHEMA.parse({}))

describe("配置 schema", () => {
  it("每一项都有标题与说明 —— 少了就是面板上一个没名字的输入框", () => {
    const bad = KEYS.filter(key => {
      const one = FIELDS[key] as { title?: string; description?: string } | undefined
      return !one?.title || !one?.description
    })

    expect(bad, `这些项缺标题或说明：${bad.join(", ")}`).toEqual([])
  })

  it("`showWhen` 依赖的键都真的存在 —— 写错键名那一项永不显示，且不报错", () => {
    const known = new Set(KEYS)
    const bad: string[] = []
    for (const key of KEYS) {
      const cond = (FIELDS[key] as { showWhen?: Record<string, unknown> } | undefined)?.showWhen
      for (const dep of Object.keys(cond ?? {})) {
        if (!known.has(dep)) bad.push(`${key} → ${dep}`)
      }
    }

    expect(bad, `这些依赖的键不存在：${bad.join(", ")}`).toEqual([])
  })

  it("纯读的 `enable*` 缺省开，会代替使用者写入或引第三方源的缺省关", () => {
    const cfg = CONFIG_SCHEMA.parse({})

    // 纯读
    expect(cfg.enablePanel).toBe(true)
    expect(cfg.enableGroupRank).toBe(true)
    expect(cfg.enableAbyss).toBe(true)
    // 会写入、会在使用者不知情时发请求、或要执行下载来的代码
    expect(cfg.enableAutoSign).toBe(false)
    expect(cfg.enableStaminaRemind).toBe(false)
    expect(cfg.enableDmgCalc).toBe(false)
    expect(cfg.enableWikiStat).toBe(false)
  })

  it("展柜头像两项缺省指向本插件的镜像 —— Enka 官方那两条路在国内常取不到", () => {
    const cfg = CONFIG_SCHEMA.parse({})

    expect(cfg.pfpsHost).toBe("https://enka-assets.072420.xyz")
    expect(cfg.assetHost).toBe(cfg.pfpsHost)
  })
})
