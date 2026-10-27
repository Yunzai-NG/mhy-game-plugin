/**
 * 模块职责：出场率视图的测试
 * 依赖方向：测试文件，只依赖 views/abyss-pct（纯函数）
 * 生命周期：无状态
 * 注意事项：固定四条最容易静默出错的口径：档位由接口给而不由本层按数值切、认不出的档并进末档而
 *          不丢掉那位角色、空档整块不出（印一个没有角色的 `S+` 会被读成"本期无人达到"）、使用率
 *          取不到时给空串而非 `0%`（印 0 会被读成"这个角色没人用"）。
 */
import { describe, expect, it } from "vitest"
import type { AbyssPctRaw } from "../service/wiki-stat.js"
import { abyssPctData, abyssPctText, pctText, pctUpdated } from "./abyss-pct.js"

/** 一份能出图的返回：五档各有人 */
const RAW: AbyssPctRaw = {
  code: 200,
  title: "深渊使用率",
  version: "6.0",
  update: "更新时间：2026-09-08",
  top_own: 128_400,
  tips: "本期数据仍在累积",
  has_list: [
    { name: "胡桃", use_rate: 62.3, rank_class: "s1" },
    { name: "钟离", use_rate: 58, rank_class: "s" },
    { name: "行秋", use_rate: 41.5, rank_class: "a" },
    { name: "香菱", use_rate: 20.2, rank_class: "b" },
    { name: "安柏", use_rate: 1.1, rank_class: "f" }
  ]
}

describe("pctText", () => {
  it("整数不留小数位，其余留一位", () => {
    expect(pctText(58)).toBe("58%")
    expect(pctText(62.34)).toBe("62.3%")
    // 接口有时给字符串
    expect(pctText("41.5")).toBe("41.5%")
  })

  it("**取不到时给空串而不是 `0%`** —— 印 0 会被读成「这个角色没人用」", () => {
    expect(pctText(undefined)).toBe("")
    expect(pctText("")).toBe("")
    expect(pctText("认不出")).toBe("")
  })
})

describe("pctUpdated", () => {
  it("剥掉「更新时间：」只留日期", () => {
    expect(pctUpdated("更新时间：2026-09-08")).toBe("2026-09-08")
    expect(pctUpdated("更新时间: 2026-09-08")).toBe("2026-09-08")
  })

  it("认不出格式时原样返回，而不是留空", () => {
    expect(pctUpdated("2026-09-08")).toBe("2026-09-08")
    expect(pctUpdated(undefined)).toBe("")
  })
})

describe("abyssPctData", () => {
  it("五档按由高到低排，档内次序照接口给的（使用率倒序）", () => {
    const view = abyssPctData(RAW, { mode: "abyss" })
    const tiers = view["tiers"] as { key: string; label: string; chars: { name: string }[] }[]

    expect(tiers.map(one => one.label)).toEqual(["S+", "S", "A", "B", "C"])
    expect(tiers[0]?.chars[0]?.name).toBe("胡桃")
  })

  it("**`f` 印作 `C`** —— 站方的键名与它自己页面上印的字本就不一致", () => {
    const view = abyssPctData(RAW, { mode: "abyss" })
    const tiers = view["tiers"] as { key: string; label: string }[]

    expect(tiers.find(one => one.key === "f")?.label).toBe("C")
  })

  it("**认不出的档并进末档，而不是把那位角色丢掉**", () => {
    const view = abyssPctData(
      { code: 200, has_list: [{ name: "新角色", use_rate: 30, rank_class: "ss" }] },
      { mode: "abyss" }
    )
    const tiers = view["tiers"] as { key: string; chars: { name: string }[] }[]

    expect(tiers).toHaveLength(1)
    expect(tiers[0]?.key).toBe("f")
    expect(tiers[0]?.chars[0]?.name).toBe("新角色")
  })

  it("**空档整块不出** —— 印一个没有角色的 S+ 会被读成「本期无人达到」", () => {
    const view = abyssPctData({ code: 200, has_list: [{ name: "胡桃", use_rate: 62, rank_class: "a" }] }, { mode: "abyss" })
    const tiers = view["tiers"] as { label: string }[]

    expect(tiers.map(one => one.label)).toEqual(["A"])
  })

  it("没有名字的条目整条跳过，不产出一个空格子", () => {
    const view = abyssPctData({ code: 200, has_list: [{ use_rate: 30, rank_class: "a" }, { name: "  ", rank_class: "a" }] }, { mode: "abyss" })
    const tiers = view["tiers"] as { chars: unknown[] }[]

    expect(tiers).toEqual([])
  })

  it("**那两行口径定义恒在** —— 少了它们这张图会被读反", () => {
    const view = abyssPctData(RAW, { mode: "abyss" })
    const defs = view["defs"] as string[]

    expect(defs).toHaveLength(2)
    expect(defs.join("")).toContain("持有该角色的记录数")
  })

  it("两种模式的叫法与统计范围各按自己的来", () => {
    const abyss = abyssPctData(RAW, { mode: "abyss" })
    const hard = abyssPctData(RAW, { mode: "hard" })

    expect(abyss["modeName"]).toBe("深渊")
    expect(hard["modeName"]).toBe("幽境危战")
    expect((abyss["tips"] as string[]).join("")).toContain("十二层满星")
    expect((hard["tips"] as string[]).join("")).toContain("难度 5 / 6")
  })

  it("站方那句补充说明附在末尾；没有时不留空项", () => {
    const withTip = abyssPctData(RAW, { mode: "abyss" })
    expect((withTip["tips"] as string[]).at(-1)).toBe("本期数据仍在累积")

    const noTip = abyssPctData({ code: 200, has_list: RAW.has_list }, { mode: "abyss" })
    expect((noTip["tips"] as string[]).every(one => one)).toBe(true)
  })

  it("没有返回时各档为空，不抛错", () => {
    const view = abyssPctData(undefined, { mode: "abyss" })

    expect(view["tiers"]).toEqual([])
    expect(view["version"]).toBe("")
  })
})

describe("abyssPctText", () => {
  it("逐档列出，且点明使用率与出场率不是一个数", () => {
    const text = abyssPctText(RAW, { mode: "abyss" })

    expect(text).toContain("S+ 胡桃 62.3%")
    expect(text).toContain("持有该角色的记录数")
  })

  it("没有数据时说的是「还没有本期的统计」，而不是出一份空清单", () => {
    expect(abyssPctText(undefined, { mode: "abyss" })).toContain("还没有本期的统计数据")
  })

  it("一档人多时只列前若干位并报总数 —— 几十个名字连成一行读不出东西", () => {
    const many = Array.from({ length: 12 }, (_v, at) => ({ name: `角色${at}`, use_rate: 30, rank_class: "a" }))
    const text = abyssPctText({ code: 200, has_list: many }, { mode: "abyss" })

    expect(text).toContain("等 12 位")
  })
})
