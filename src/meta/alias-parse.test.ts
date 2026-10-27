/**
 * 模块职责：别名解析器的测试
 * 依赖方向：测试文件，依赖 alias-parse.ts；另读真实的 `alias.js` 作端到端验证
 * 生命周期：无状态
 * 注意事项：要点在**"认不出就抛错"**：解析器失效必须在安装元数据时就炸出来，静默产出半张表的
 *          表现是「#胡桃面板」查不到人，从那里追回本文件极其困难。真实文件那几条带跳过分支 ——
 *          元数据是运行时下载的，CI 上不一定装了。
 */
import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { buildAliasIndex, parseAliasFile } from "./alias-parse.js"

/** 真实那两份 `alias.js` 的所在，装了元数据才有 */
const REAL = process.env["MHY_REAL_META"] ?? ""

describe("parseAliasFile", () => {
  it("认裸键、双引号键与单引号键", () => {
    const got = parseAliasFile(`export const alias = {
      琴: "Jean,团长",
      "穹·毁灭": "穹毁灭,毁灭穹",
      '三月七': "三月,37"
    }`)

    expect(got?.alias).toEqual({
      琴: "Jean,团长",
      "穹·毁灭": "穹毁灭,毁灭穹",
      三月七: "三月,37"
    })
  })

  it("剥掉行注释与块注释 —— 源文件里满是 `// 1.0` 这样的版本分隔", () => {
    const got = parseAliasFile(`export const alias = {
      // 1.0
      琴: "Jean",
      /* 一段块注释
         跨了两行 */
      丽莎: "Lisa"
    }`)

    expect(got?.alias).toEqual({ 琴: "Jean", 丽莎: "Lisa" })
  })

  it("同时取出 abbr", () => {
    const got = parseAliasFile(`export const alias = { "丹恒•饮月": "饮月君" }
export const abbr = { "丹恒•饮月": "饮月君" }`)

    expect(got?.abbr).toEqual({ "丹恒•饮月": "饮月君" })
  })

  it("没有 abbr 时不带这一项", () => {
    expect(parseAliasFile('export const alias = { 琴: "Jean" }')?.abbr).toBeUndefined()
  })

  it("没有 alias 导出时给 undefined —— 那说明文件不是这个形态", () => {
    expect(parseAliasFile("export const other = { a: 1 }")).toBeUndefined()
    expect(parseAliasFile("")).toBeUndefined()
  })

  it("认不出的语法整体抛错，不静默跳过", () => {
    // 值不是字符串字面量：源文件若改成数组或模板串，本解析器就不再成立
    expect(() => parseAliasFile('export const alias = { 琴: ["Jean"] }')).toThrow(/认不出的语法/)
    expect(() => parseAliasFile("export const alias = { 琴: `Jean` }")).toThrow(/认不出的语法/)
    // 掺进一个函数：那是"必须走沙箱"的信号，绝不能当数据解析
    expect(() => parseAliasFile('export const alias = { 琴: "Jean", f: () => 1 }')).toThrow(/认不出的语法/)
  })

  it("字符串里的花括号不影响配对", () => {
    const got = parseAliasFile('export const alias = { 琴: "a{b}c" }')

    expect(got?.alias["琴"]).toBe("a{b}c")
  })

  it("字符串里的 // 不当注释剥掉", () => {
    const got = parseAliasFile('export const alias = { 琴: "a//b" }')

    expect(got?.alias["琴"]).toBe("a//b")
  })
})

describe("buildAliasIndex", () => {
  it("逗号串展开成逐条别名，键转小写", () => {
    const got = buildAliasIndex({ alias: { 琴: "Jean,团长, 琴团长 " } })

    expect(got.alias["jean"]).toBe("琴")
    expect(got.alias["团长"]).toBe("琴")
    // 两侧空白剥掉，否则「 琴团长 」这一条永远查不到
    expect(got.alias["琴团长"]).toBe("琴")
  })

  it("角色全名本身也进表 —— 否则打全名查不到人", () => {
    const got = buildAliasIndex({ alias: { 胡桃: "往生堂堂主" } })

    expect(got.alias["胡桃"]).toBe("胡桃")
    expect(got.alias["往生堂堂主"]).toBe("胡桃")
  })

  it("简称也进表，且原样保留 abbr 供模板取用", () => {
    const got = buildAliasIndex({
      alias: { "丹恒•饮月": "饮月" },
      abbr: { "丹恒•饮月": "饮月君" }
    })

    expect(got.alias["饮月君"]).toBe("丹恒•饮月")
    expect(got.abbr?.["丹恒•饮月"]).toBe("饮月君")
  })

  it("显式别名优先于全名与简称 —— 撞车时不让自动生成的那两类覆盖它", () => {
    // 「A」既是甲的显式别名、又是乙的全名：显式的那条胜出
    const got = buildAliasIndex({ alias: { 甲: "A", A: "别的" } })

    expect(got.alias["a"]).toBe("甲")
  })

  it("同一别名指向两个角色时后写覆盖先写", () => {
    const got = buildAliasIndex({ alias: { 卡齐娜: "岩莉莉", 莉奈娅: "岩莉莉" } })

    expect(got.alias["岩莉莉"]).toBe("莉奈娅")
  })
})

describe("拿真实的 alias.js 验", () => {
  for (const game of ["gs", "sr"] as const) {
    const path = `${REAL}/meta-${game}/character/alias.js`

    // 元数据是运行时下载的，没装就跳过 —— 见文件头
    it.skipIf(!existsSync(path))(`meta-${game} 的真实文件解析得出，且社区叫法查得到`, () => {
      const parsed = parseAliasFile(readFileSync(path, "utf8"))
      expect(parsed).toBeDefined()
      const index = buildAliasIndex(parsed!)

      // 别名条数远多于角色数：一个角色平均七八个叫法
      expect(Object.keys(index.alias).length).toBeGreaterThan(300)

      if (game === "gs") {
        expect(index.alias["岩王帝君"]).toBe("钟离")
        expect(index.alias["椰羊"]).toBe("甘雨")
        expect(index.alias["钟离"]).toBe("钟离")
      } else {
        expect(index.alias["饮月君"]).toBe("丹恒•饮月")
        expect(index.abbr?.["丹恒•饮月"]).toBe("饮月君")
      }
    })
  }
})
