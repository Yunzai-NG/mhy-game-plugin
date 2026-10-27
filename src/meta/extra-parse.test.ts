/**
 * 模块职责：`character/extra.js` 里那份四类名单的解析测试
 * 依赖方向：测试文件，只依赖 meta/extra-parse.ts（纯字符串处理）
 * 生命周期：无状态
 * 注意事项：**值有两种形态** —— 元数据里那份写成 `[ "…", "…" ].join(",")`，使用者的追加配置
 *          写成裸字符串；只认一种的表现不是报错而是那一类整块为空，随后 `#老婆` 恒回「元数据里
 *          没有名单」而文件明明在。另一条是**认不出要抛错而不是跳过**：静默跳过会让某一类凭空
 *          少掉半截名单，那种缺失极难追到解析器这里。
 */
import { describe, expect, it } from "vitest"
import { parseWifeFile } from "./extra-parse.js"

/** 元数据里那份的形态：按版本分行、行尾带注释、末尾 `.join(",")` */
const REAL = `
export const extraChars = { 派蒙: "派蒙,应急食物" }

export const wifeCfg = {
  girlfriend: [
    // 1.0
    "琴, 丽莎, 荧",
    // 2.0
    "绫华, 宵宫",
    // 自定义
    "女士, 萍姥姥"
  ].join(","),

  boyfriend: [
    "空, 凯亚",
    "散兵, 魈"
  ].join(","),

  daughter: [
    "可莉, 七七"
  ].join(","),

  son: "".split(",").join(",")
}
`

describe("parseWifeFile", () => {
  it("认 `[…].join(\",\")` 这一种形态，逐段拼起来并按逗号切开", () => {
    const got = parseWifeFile(REAL)
    expect(got?.girlfriend).toEqual(["琴", "丽莎", "荧", "绫华", "宵宫", "女士", "萍姥姥"])
    expect(got?.boyfriend).toEqual(["空", "凯亚", "散兵", "魈"])
    expect(got?.daughter).toEqual(["可莉", "七七"])
  })

  it("认裸字符串那一种形态 —— 使用者的追加配置就写成这样", () => {
    const got = parseWifeFile(`export const wifeCfg = { girlfriend: "雷神", boyfriend: "散兵, 魈", daughter: "", son: "" }`)
    expect(got?.girlfriend).toEqual(["雷神"])
    expect(got?.boyfriend).toEqual(["散兵", "魈"])
    expect(got?.daughter).toEqual([])
  })

  it("行注释里的名字不算数 —— 那几行是分版本的说明", () => {
    const got = parseWifeFile(`
      export const wifeCfg = {
        girlfriend: [
          // 胡桃, 刻晴 这两个在注释里，不该被算进去
          "琴"
        ].join(","),
        boyfriend: "", daughter: "", son: ""
      }
    `)
    expect(got?.girlfriend).toEqual(["琴"])
  })

  it("认不出的形态给空名单，不抛错也不猜 —— 那一类只是空着", () => {
    // 值是个函数调用，不是本解析器认得的两种形态
    const got = parseWifeFile(`export const wifeCfg = { girlfriend: buildList(), boyfriend: "空", daughter: "", son: "" }`)
    expect(got?.girlfriend).toEqual([])
    // 同一份文件里认得出的那几类照旧
    expect(got?.boyfriend).toEqual(["空"])
  })

  it("四个键恒在，缺的那一类给空数组 —— 下游因此不必判空", () => {
    const got = parseWifeFile(`export const wifeCfg = { girlfriend: "琴" }`)
    expect(got).toEqual({ girlfriend: ["琴"], boyfriend: [], daughter: [], son: [] })
  })

  it("没有 wifeCfg 导出时 undefined，与「有这个导出但四类都空」区分得开", () => {
    expect(parseWifeFile(`export const extraChars = { 派蒙: "派蒙" }`)).toBeUndefined()
  })

  it("空文件不炸", () => {
    expect(parseWifeFile("")).toBeUndefined()
  })

  it("名字两侧的空白都去掉 —— 源文件里逗号后面带一个空格", () => {
    const got = parseWifeFile(`export const wifeCfg = { girlfriend: "  琴 ,  丽莎  ", boyfriend: "", daughter: "", son: "" }`)
    expect(got?.girlfriend).toEqual(["琴", "丽莎"])
  })
})
