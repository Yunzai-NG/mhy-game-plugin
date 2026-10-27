/**
 * 模块职责：`parseDataExport` 的测试 —— 尤其钉住键名里带特殊字符时仍解析得出
 * 依赖方向：测试文件，纯字符串输入
 * 生命周期：无状态
 * 注意事项：重点是那条**无引号键补引号**的正则。角色与音擎名里带 `·`、`•`、`「」`、`&`，按
 *          `一-龥` 逐字符枚举会漏掉这些，漏一个就整份 `JSON.parse` 失败、卡池表与评分表静默
 *          回落，故这些名字既作键又作值各钉一条。
 */
import { describe, expect, it } from "vitest"
import { parseDataExport } from "./js-lit.js"

describe("parseDataExport 认对象与数组", () => {
  it("认嵌套对象、数字与字符串数组 —— 卡池那份的形态", () => {
    const src = `export const poolDetail = [
      { version: "3.3", half: "上半", char5: ["苍角"], weapon5: ["空related"] }
    ]`
    const got = parseDataExport<{ version: string; char5: string[] }[]>(src, "poolDetail")

    expect(got).toHaveLength(1)
    expect(got?.[0]?.version).toBe("3.3")
    expect(got?.[0]?.char5).toEqual(["苍角"])
  })

  it("无引号的中文键补得上引号", () => {
    const src = "export const poolName = { 胡桃: 赤团开时, 甘雨: 浮生梦影 }".replace(
      /(赤团开时|浮生梦影)/g,
      '"$1"'
    )
    const got = parseDataExport<Record<string, string>>(src, "poolName")

    expect(got?.["胡桃"]).toBe("赤团开时")
  })

  it("键名带 `·` `•` `「」` `&` 时不再整份失败", () => {
    // 这些字符都在 `一-龥` 之外，只按那一段认键名会让整份静默回落
    const src = `export const usefulAttr = {
      零号·安比: { atk: 100 },
      丹恒•饮月: { hp: 75 },
      「11号」: ["主C·双爆"],
      托帕&账账: { rules: ["辅助·异常"], 攻击力: 1 }
    }`
    const got = parseDataExport<Record<string, unknown>>(src, "usefulAttr")

    expect(got).toBeDefined()
    expect(got?.["零号·安比"]).toEqual({ atk: 100 })
    expect(got?.["丹恒•饮月"]).toEqual({ hp: 75 })
    // 值里的 `·` 是字符串内容，原样保留
    expect(got?.["「11号」"]).toEqual(["主C·双爆"])
    expect(got?.["托帕&账账"]).toEqual({ rules: ["辅助·异常"], 攻击力: 1 })
  })

  it("已带双引号的键原样通过", () => {
    const src = `export const usefulAttr = { "零号·安比": { atk: 100 }, "普通": { hp: 1 } }`
    const got = parseDataExport<Record<string, unknown>>(src, "usefulAttr")

    expect(got?.["零号·安比"]).toEqual({ atk: 100 })
    expect(got?.["普通"]).toEqual({ hp: 1 })
  })

  it("认不出的导出名给 undefined", () => {
    expect(parseDataExport("export const other = {}", "usefulAttr")).toBeUndefined()
  })

  it("表达式或函数一律解析失败而非求值", () => {
    // 只解析不求值：出现调用就 JSON.parse 失败，返回 undefined
    expect(parseDataExport("export const usefulAttr = { 安比: calc(1) }", "usefulAttr")).toBeUndefined()
  })
})
