/**
 * 模块职责：材料简称表解析器的测试
 * 依赖方向：测试文件，依赖 meta/abbr-parse
 * 生命周期：无状态
 * 注意事项：固定三处：分节注释要剥掉、**认不出要整体抛错而不是跳过那一条**（静默跳过的表现是
 *          某个材料的标题突然写全名，没人会想到是解析器漏了）、只认 `abbr` 这一个导出。
 */
import { describe, expect, it } from "vitest"
import { ABBR_SOURCE, parseAbbrFile } from "./abbr-parse.js"

describe("ABBR_SOURCE", () => {
  it("文件名是 abbr.js —— 它按 basename 列在落盘白名单里", () => {
    expect(ABBR_SOURCE).toBe("abbr.js")
  })
})

describe("parseAbbrFile", () => {
  it("认得出裸键与带引号的键", () => {
    const got = parseAbbrFile('export const abbr = {\n  恒常机关之心: "恒常之心",\n  "「图比昂装置」": "图比昂装置"\n}\n')

    expect(got).toEqual({ 恒常机关之心: "恒常之心", "「图比昂装置」": "图比昂装置" })
  })

  it("分节注释与块注释都剥掉", () => {
    const src = [
      "export const abbr = {",
      "  // 周本",
      '  恒常机关之心: "恒常之心",',
      "  /* 蒙德武器 */",
      '  狮牙斗士的理想: "狮牙斗士"',
      "}"
    ].join("\n")

    expect(parseAbbrFile(src)).toEqual({ 恒常机关之心: "恒常之心", 狮牙斗士的理想: "狮牙斗士" })
  })

  it("单引号的值也认", () => {
    expect(parseAbbrFile("export const abbr = { 甲: '乙' }")).toEqual({ 甲: "乙" })
  })

  it("没有 abbr 导出时给 undefined 而非空表 —— 两者要分得开", () => {
    expect(parseAbbrFile("export const other = { 甲: '乙' }")).toBeUndefined()
  })

  it("空表也是有效结果", () => {
    expect(parseAbbrFile("export const abbr = {}")).toEqual({})
  })

  it("值不是字符串时整体抛错 —— 静默跳过会让一个材料的标题凭空变长", () => {
    expect(() => parseAbbrFile("export const abbr = { 甲: 123 }")).toThrow(/认不出的语法/)
  })

  it("值是表达式时同样抛错", () => {
    expect(() => parseAbbrFile('export const abbr = { 甲: "乙" + "丙" }')).toThrow(/认不出的语法/)
  })

  it("嵌套对象抛错 —— 这份文件的形态本就只有一层", () => {
    expect(() => parseAbbrFile('export const abbr = { 甲: { 乙: "丙" } }')).toThrow(/认不出的语法/)
  })

  it("值里含斜杠不会被当成注释", () => {
    expect(parseAbbrFile('export const abbr = { "甲/乙": "丙//丁" }')).toEqual({ "甲/乙": "丙//丁" })
  })
})
