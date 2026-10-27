/**
 * 模块职责：伤害规则装载与倍率表形态的测试
 * 依赖方向：依赖 dmg/buffs、dmg/detail 与临时元数据目录；不发请求
 * 生命周期：每个用例一份临时目录，结束后删除
 * 注意事项：旅行者必须用当前元素的公式；倍率二元组不能转数或拆成另一组键，否则其他角色的治疗与多段伤害会失真。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Logger } from "@yunzai-ng/types"
import { DmgBuffLoader } from "./buffs.js"
import { sandboxDeps } from "./deps.js"
import { talentTables } from "./detail.js"

let dir = ""
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mhy-dmg-loader-")) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

/** 写一份仅含标题的公式。 */
function rule(name: string, title: string): void {
  const root = join(dir, "meta-gs", "character", name)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "calc.js"), `export const details = [{title:${JSON.stringify(title)}}]`, "utf8")
}

/** 造启用状态可配置的装载器。 */
function loader(enabled = true): DmgBuffLoader {
  const noop = (): void => {}
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, mark: noop } as unknown as Logger
  return new DmgBuffLoader({ dir, deps: () => sandboxDeps({}), logger, enabled: () => enabled })
}

describe("旅行者伤害规则", () => {
  it("空、荧与旅行者按当前元素找公式，缓存不会混淆元素", () => {
    rule("旅行者/cryo", "冰主")
    rule("旅行者/pyro", "火主")
    const l = loader()
    expect(l.charCalc("gs", "荧", "冰")?.details).toEqual([{ title: "冰主" }])
    expect(l.charCalc("gs", "空", "pyro")?.details).toEqual([{ title: "火主" }])
    expect(l.charCalc("gs", "旅行者", "cryo")?.details).toEqual([{ title: "冰主" }])
    expect(l.charCalc("gs", "荧", "hydro")).toBeUndefined()
  })

  it("不传元素、未知元素或关闭开关时不猜另一元素的公式", () => {
    rule("旅行者/cryo", "冰主")
    expect(loader().charCalc("gs", "空")).toBeUndefined()
    expect(loader().charCalc("gs", "空", "未知")).toBeUndefined()
    expect(loader(false).charCalc("gs", "空", "cryo")).toBeUndefined()
  })

  it("普通角色不会改取旅行者目录", () => {
    rule("胡桃", "胡桃")
    expect(loader().charCalc("gs", "胡桃", "pyro")?.details).toEqual([{ title: "胡桃" }])
  })
})

describe("复合治疗倍率", () => {
  it("保持该档二元组：第一个数是防御倍率，第二个数是固定治疗值", () => {
    const tables = talentTables({ q: 2 }, {
      talentData: { q: { 治疗量: [930.38, 1019.42], 治疗量2: [[160, 770.38], [172, 847.42]] } }
    }, "gs")
    const q = tables["q"] as Record<string, unknown>
    expect(q["治疗量2"]).toEqual([172, 847.42])
    expect(q["治疗量"]).toBe(1019.42)
    const [pct, flat] = q["治疗量2"] as [number, number]
    expect(pct / 100 * 2000 + flat).toBeCloseTo(4287.42)
  })
})
