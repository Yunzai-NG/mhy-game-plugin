/**
 * 模块职责：`material/daily.js` 解析器的测试
 * 依赖方向：测试文件，依赖 meta/daily-parse；另可读一份真实的 `daily.js` 作端到端验证
 * 生命周期：无状态
 * 注意事项：固定三处：**简称算法须与元数据那份表一致**（算错一处就整类材料对不上、`#今日材料`
 *          出一张空图）、**认不出的语法要抛错而非跳过**（跳过的表现是某个国家的天赋书凭空消失）、
 *          国家名表比元数据自带的那份长两项。端到端那一组要一份真实元数据目录，路径由环境变量
 *          `MHY_REAL_META` 给出，未设时整组跳过。
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CITY_BY_INDEX, cityAt, materialAbbr, parseDailyFile } from "./daily-parse.js"

/** 真实那份 `daily.js` 的所在，由环境变量给出 */
const REAL = process.env["MHY_REAL_META"] === undefined ? "" : join(process.env["MHY_REAL_META"], "meta-gs/material/daily.js")

/** 一份最小的 `daily.js` */
const SAMPLE = `export default {
  talent: {
    1: [ "自由", "繁荣" ],
    2: [ "抗争", "勤劳" ],
    3: [ "诗文", "黄金" ]
  },
  weapon: {
    1: [ "高塔孤王" ],
    2: [ "凛风奔狼" ]
  }
}
`

describe("materialAbbr", () => {
  it("天赋书取书名号里的那一段", () => {
    expect(materialAbbr("「勤劳」的哲学", "talent")).toBe("勤劳")
    expect(materialAbbr("「自由」的教导", "talent")).toBe("自由")
  })

  it("武器材料取前四字", () => {
    expect(materialAbbr("高塔孤王的碎梦", "weapon")).toBe("高塔孤王")
    expect(materialAbbr("凛雪帝皇的辞决", "weapon")).toBe("凛雪帝皇")
  })

  it("天赋书没有书名号时用全名，不至于变成空串", () => {
    expect(materialAbbr("某种材料", "talent")).toBe("某种材料")
  })

  it("武器材料不足四字时用全名", () => {
    expect(materialAbbr("三个字", "weapon")).toBe("三个字")
  })
})

describe("cityAt", () => {
  it("下标即国家，前六个按开放次序", () => {
    expect([0, 1, 2, 3, 4, 5].map(cityAt)).toEqual(["蒙德", "璃月", "稻妻", "须弥", "枫丹", "纳塔"])
  })

  it("第七、第八列要有名字 —— 表只到纳塔时那两列的分组标题是空的", () => {
    expect(cityAt(6)).toBe("挪德卡莱")
    expect(cityAt(7)).toBe("至冬")
    expect(CITY_BY_INDEX).toHaveLength(8)
  })

  it("再往后没有名字时给空串，由调用方回落", () => {
    expect(cityAt(8)).toBe("")
  })
})

describe("parseDailyFile", () => {
  it("两类材料各自按周期号成表", () => {
    const got = parseDailyFile(SAMPLE)

    expect(got?.talent["1"]).toEqual(["自由", "繁荣"])
    expect(got?.talent["3"]).toEqual(["诗文", "黄金"])
    expect(got?.weapon["2"]).toEqual(["凛风奔狼"])
  })

  it("数组次序保留 —— 次序就是国家，乱一位整组材料就归错国家", () => {
    const got = parseDailyFile(`export default { talent: { 1: [ "甲", "乙", "丙" ] } }`)

    expect(got?.talent["1"]).toEqual(["甲", "乙", "丙"])
  })

  it("键带引号也认", () => {
    const got = parseDailyFile(`export default { "talent": { "1": [ "甲" ] } }`)

    expect(got?.talent["1"]).toEqual(["甲"])
  })

  it("注释先剥掉", () => {
    const got = parseDailyFile(`export default {
      // 5.0 新增
      talent: { 1: [ "甲" /* 蒙德 */ ] }
    }`)

    expect(got?.talent["1"]).toEqual(["甲"])
  })

  it("缺一类时那一类为空表而非抛错", () => {
    const got = parseDailyFile(`export default { talent: { 1: [ "甲" ] } }`)

    expect(got?.weapon).toEqual({})
  })

  it("没有 export default 时给 undefined", () => {
    expect(parseDailyFile("export const x = 1")).toBeUndefined()
  })

  it("数组里混进非字符串就整体失败 —— 静默跳过会让某个国家的材料凭空消失", () => {
    expect(() => parseDailyFile(`export default { talent: { 1: [ "甲", 2 ] } }`)).toThrow(/认不出的语法/)
  })

  it("值不是数组时整体失败", () => {
    expect(() => parseDailyFile(`export default { talent: { 1: "甲" } }`)).toThrow(/认不出的语法/)
  })

  it("混进箭头函数时整体失败 —— 那说明这份文件已经不是纯数据了", () => {
    expect(() => parseDailyFile(`export default { talent: { 1: [ "甲" ], f: () => 1 } }`)).toThrow(/认不出的语法/)
  })
})

describe("parseDailyFile 读真实的 daily.js", () => {
  const src = existsSync(REAL) ? readFileSync(REAL, "utf8") : undefined

  it.skipIf(!src)("两类都解得开，且每类三个周期", () => {
    const got = parseDailyFile(src ?? "")

    expect(Object.keys(got?.talent ?? {})).toEqual(["1", "2", "3"])
    expect(Object.keys(got?.weapon ?? {})).toEqual(["1", "2", "3"])
  })

  it.skipIf(!src)("每个周期的列数一致 —— 不一致说明某个国家漏了一档，那会静默少一组材料", () => {
    const got = parseDailyFile(src ?? "")
    const lens = Object.values(got?.talent ?? {}).map(one => one.length)

    expect(new Set(lens).size).toBe(1)
    // 文件里至少八列 —— 这正是 CITY_BY_INDEX 要凑满八项的由来
    expect(lens[0]).toBeGreaterThanOrEqual(8)
  })

  it.skipIf(!src)("蒙德的三档与游戏里一致：自由 周一四、抗争 周二五、诗文 周三六", () => {
    const got = parseDailyFile(src ?? "")

    expect(got?.talent["1"]?.[0]).toBe("自由")
    expect(got?.talent["2"]?.[0]).toBe("抗争")
    expect(got?.talent["3"]?.[0]).toBe("诗文")
  })

  it.skipIf(!src)("璃月的武器材料在第二列", () => {
    const got = parseDailyFile(src ?? "")

    expect(got?.weapon["1"]?.[1]).toBe("孤云寒林")
    expect(cityAt(1)).toBe("璃月")
  })
})
