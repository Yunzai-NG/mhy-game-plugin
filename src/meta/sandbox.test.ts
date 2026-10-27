/**
 * 模块职责：公式沙箱的测试
 * 依赖方向：测试文件，依赖 meta/sandbox.ts 与临时目录里的假公式文件
 * 生命周期：无状态
 * 注意事项：重点是**逃逸尝试** —— 沙箱是全插件唯一执行下载来的代码的地方，"上下文里没有 IO
 *          能力"必须由用例固定而非靠注释承诺。另固定三项：只求值白名单内的文件名、路径须位于
 *          元数据目录内、**求值失败一律返回 undefined 而不抛异常**（一个角色的公式写坏了，
 *          面板仍应出图，只是少这一项伤害）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { comma, forEach, percent } from "../panel/dmg/deps.js"
import type { SandboxDeps } from "./sandbox.js"
import { CALC_FILES, evalCalc, rewrite } from "./sandbox.js"

let root = ""

/** 注入的依赖：只有评分表这份数据，Format / lodash 在上下文里造 */
const DEPS: SandboxDeps = { usefulAttr: { 胡桃: { hp: 80, atk: 50 } } }

/**
 * 写一个公式文件
 * @param rel 相对元数据根目录的路径
 * @param body 文件内容
 * @returns 该文件的绝对路径
 */
function put(rel: string, body: string): string {
  const path = join(root, rel)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, body, "utf8")
  return path
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sandbox-test-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("rewrite", () => {
  it("具名导出去掉 export 后仍可求值", () => {
    const out = rewrite("export const details = [1, 2]\n")
    expect(out).toContain("const details = [1, 2]")
    expect(out).toContain("__out =")
  })

  it("export default 换成内部变量", () => {
    const out = rewrite("export default function() { return 1 }\n")
    expect(out).toContain("const __default = function()")
  })

  it("import 行整体去掉 —— 依赖由宿主注入", () => {
    const out = rewrite('import { Format } from "#miao"\nexport const buffs = []\n')
    expect(out).not.toContain("import")
    expect(out).toContain("const buffs = []")
  })

  it("import 了预期之外的模块时拒绝改写，而不是注入 undefined 让它半途失败", () => {
    expect(() => rewrite('import fs from "node:fs"\nexport const details = []\n')).toThrow(/预期之外/)
  })

  it("默认评分表的相对 import 放行 —— 它按注入处理", () => {
    const out = rewrite('import { usefulAttr } from "../../artifact/artis-mark.js"\nexport default function() {}\n')
    expect(out).not.toContain("import")
  })

  // 两个套装目录名都要放行：绝区零那份权重表同名同形却在 `equip/` 下，只认 `artifact/`
  // 会让 meta-zzz 的公式文件整份求值失败，表现是那一位的伤害栏退回兜底
  it("绝区零那份在 equip/ 下的评分表同样放行", () => {
    const out = rewrite('import { usefulAttr } from "../../equip/artis-mark.js"\nexport default function() {}\n')
    expect(out).not.toContain("import")
  })

  it("放行只限 artis-mark.js，不放宽到套装目录下别的文件", () => {
    expect(() => rewrite('import x from "../../equip/data.json"\nexport const details = []\n')).toThrow(/预期之外/)
  })

  it("残留未预期的 export 语法时明确报错", () => {
    expect(() => rewrite("export function foo() {}\n")).toThrow(/未预期/)
  })
})

describe("evalCalc 正常求值", () => {
  it("取回具名导出", () => {
    const path = put("character/胡桃/calc.js", 'export const details = [{ title: "重击" }]\nexport const buffs = []\n')
    const mod = evalCalc(path, { root, deps: DEPS })
    expect((mod?.details as { title: string }[])[0]?.title).toBe("重击")
    expect(mod?.buffs).toEqual([])
  })

  it("取回 export default", () => {
    const path = put("character/胡桃/artis.js", "export default function() { return 42 }\n")
    const mod = evalCalc(path, { root, deps: DEPS })
    expect((mod?.default as () => number)()).toBe(42)
  })

  it("上下文里的 Format / lodash 与宿主那份逐值同口径 —— 不一致则每条 buff 文案变样", () => {
    const nums = [0, 5, -5, 0.05, 1234.5, -1234.5, 1234567.891, 999.999, 1e21, Number.NaN]
    const fixes = [0, 1, 2]
    const path = put(
      "character/甲/calc.js",
      `const nums = ${JSON.stringify(nums.map(n => (Number.isNaN(n) ? "NaN" : n)))}.map(n => n === "NaN" ? NaN : n)
const fixes = ${JSON.stringify(fixes)}
const out = []
for (const n of nums) for (const f of fixes) out.push([Format.comma(n, f), Format.percent(n / 100, f)])
const seen = []
lodash.forEach({ a: 1, b: 2, c: 3 }, (v, k) => { seen.push(k + v); if (k === "b") return false })
lodash.forEach([7, 8], (v, i) => { seen.push(i + ":" + v) })
export const details = { out, seen, def: [Format.comma(1234.56), Format.percent(0.123)] }
`
    )
    const got = evalCalc(path, { root, deps: DEPS })?.details as { out: string[][]; seen: string[]; def: string[] }
    const want: string[][] = []
    for (const n of nums) for (const fx of fixes) want.push([comma(n, fx), percent(n / 100, fx)])
    const seen: string[] = []
    forEach({ a: 1, b: 2, c: 3 }, (v, k) => {
      seen.push(`${String(k)}${String(v)}`)
      return k === "b" ? false : undefined
    })
    forEach([7, 8], (v, i) => {
      seen.push(`${String(i)}:${String(v)}`)
    })
    expect(JSON.parse(JSON.stringify(got.out))).toEqual(want)
    expect(JSON.parse(JSON.stringify(got.seen))).toEqual(seen)
    expect(JSON.parse(JSON.stringify(got.def))).toEqual([comma(1234.56), percent(0.123)])
  })

  it("注入的 usefulAttr 能用 —— 那 57 个 artis.js 靠它", () => {
    const path = put(
      "character/胡桃/artis.js",
      'import { usefulAttr } from "../../artifact/artis-mark.js"\nexport default () => usefulAttr["胡桃"].hp\n'
    )
    const mod = evalCalc(path, { root, deps: DEPS })
    expect((mod?.default as () => number)()).toBe(80)
  })

  it("公式里的函数留到调用时才跑，参数由伤害计算层给", () => {
    const path = put(
      "character/甲/calc.js",
      "export const details = [{ dmg: ({ talent }) => talent.e.伤害 * 2 }]\n"
    )
    const mod = evalCalc(path, { root, deps: DEPS })
    const item = (mod?.details as { dmg: (ctx: unknown) => number }[])[0]
    expect(item?.dmg({ talent: { e: { 伤害: 50 } } })).toBe(100)
  })
})

describe("evalCalc 拒绝求值", () => {
  it("白名单外的文件名一律不求值", () => {
    const path = put("character/甲/index.js", "export const details = []\n")
    expect(evalCalc(path, { root, deps: DEPS })).toBeUndefined()
    expect(CALC_FILES).toEqual(["calc.js", "artis.js"])
  })

  it("元数据目录之外的文件不求值 —— 路径可能来自别处拼接", () => {
    const outside = mkdtempSync(join(tmpdir(), "sandbox-out-"))
    try {
      const path = join(outside, "calc.js")
      writeFileSync(path, "export const details = []\n", "utf8")
      expect(evalCalc(path, { root, deps: DEPS })).toBeUndefined()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("文件不存在时返回 undefined", () => {
    expect(evalCalc(join(root, "character/无/calc.js"), { root, deps: DEPS })).toBeUndefined()
  })

  it("语法错误时返回 undefined，不抛异常 —— 一个角色写坏了不该让面板整个失败", () => {
    const path = put("character/甲/calc.js", "export const details = [[[\n")
    expect(() => evalCalc(path, { root, deps: DEPS })).not.toThrow()
    expect(evalCalc(path, { root, deps: DEPS })).toBeUndefined()
  })

  it("求值期抛异常时返回 undefined", () => {
    const path = put("character/甲/calc.js", 'export const details = (() => { throw new Error("x") })()\n')
    expect(evalCalc(path, { root, deps: DEPS })).toBeUndefined()
  })

  it("死循环被超时挡住，不会挂住整个进程", () => {
    const path = put("character/甲/calc.js", "while (true) {}\nexport const details = []\n")
    expect(evalCalc(path, { root, deps: DEPS })).toBeUndefined()
  })
})

describe("evalCalc 逃逸尝试", () => {
  /**
   * 求值一段代码，取回它算出的 details
   * @param body 文件内容
   * @returns details 的值；求值失败时 undefined
   */
  function detailsOf(body: string): unknown {
    const path = put("character/甲/calc.js", body)
    return evalCalc(path, { root, deps: DEPS })?.details
  }

  it("上下文里没有 require", () => {
    expect(detailsOf('export const details = typeof require\n')).toBe("undefined")
  })

  it("上下文里没有 process —— 拿不到 env，也拿不到 mainModule", () => {
    expect(detailsOf('export const details = typeof process\n')).toBe("undefined")
  })

  it("上下文里没有 fetch 与计时器", () => {
    expect(detailsOf('export const details = [typeof fetch, typeof setTimeout, typeof setInterval]\n')).toEqual([
      "undefined",
      "undefined",
      "undefined"
    ])
  })

  it("上下文里没有 Buffer / global / globalThis.process", () => {
    expect(detailsOf('export const details = [typeof Buffer, typeof global]\n')).toEqual(["undefined", "undefined"])
  })

  it("动态求值被关掉 —— codeGeneration.strings 为 false", () => {
    // Function 构造器与 eval 在该上下文里造不出代码，故整段求值失败
    expect(detailsOf('export const details = new Function("return 1")()\n')).toBeUndefined()
  })

  it("import() 拿不到模块 —— 上下文没有动态 import 的回调，那一句只得到被拒绝的承诺", async () => {
    const got = detailsOf('export const details = import("node:fs")\n') as Promise<unknown>
    await expect(got).rejects.toBeTruthy()
  })

  /** 公式里试着从拿到的东西摸回宿主 `process` 的几条路，每条返回 "blocked" 或摸到的类型 */
  const PROBE = `const tryIt = f => { try { const p = f(); return typeof p === "object" && p ? "escaped" : "blocked" } catch { return "blocked" } }
export default (arg, fn) => {
  let thrown
  try { fn("throw") } catch (e) { thrown = e }
  return [
    tryIt(() => arg.constructor.constructor("return process")()),
    tryIt(() => Object.getPrototypeOf(arg).constructor.constructor("return process")()),
    tryIt(() => arg.__proto__.constructor.constructor("return process")()),
    tryIt(() => arg.nested.list.constructor.constructor("return process")()),
    tryIt(() => fn.constructor("return process")()),
    tryIt(() => Object.getPrototypeOf(fn).constructor("return process")()),
    tryIt(() => fn("obj").constructor.constructor("return process")()),
    tryIt(() => thrown.constructor.constructor("return process")()),
    tryIt(() => arg.self.constructor.constructor("return process")()),
    tryIt(() => Reflect.getOwnPropertyDescriptor(arg, "nested").value.constructor.constructor("return process")())
  ]
}
`

  it("宿主传进来的对象、函数、抛出的错都摸不回宿主 Function —— 每条路都过代理", () => {
    const path = put("character/甲/artis.js", PROBE)
    const fn = evalCalc(path, { root, deps: DEPS })?.default as (a: unknown, b: unknown) => string[]
    const arg: Record<string, unknown> = { nested: { list: [1, 2] } }
    arg["self"] = arg
    const host = (mode: string): unknown => {
      if (mode === "throw") throw new Error("宿主的错")
      return { x: 1 }
    }
    const got = fn(arg, host)
    expect(got).toHaveLength(10)
    expect([...got]).toEqual(Array.from({ length: 10 }, () => "blocked"))
  })

  it("宿主类实例的原型方法照常可用（`0.16 * attr.hp` 靠 toString 取值），类的 constructor 仍摸不到", () => {
    const path = put(
      "character/甲/artis.js",
      `export default ({ hp }) => [0.16 * hp, (() => { try { return typeof hp.constructor } catch { return "throw" } })(),
  (() => { try { return typeof Object.getPrototypeOf(Object.getPrototypeOf(hp)).constructor("return process")() } catch { return "blocked" } })()]
`
    )
    /** 只靠原型上的 toString 给出数值的属性项，形同 dmg/attr.ts 的 AttrBox */
    class Box {
      /** @returns 属性值 */
      toString(): string {
        return 100 as unknown as string
      }
    }
    const fn = evalCalc(path, { root, deps: DEPS })?.default as (ds: unknown) => unknown[]
    expect([...fn({ hp: new Box() })]).toEqual([16, "undefined", "blocked"])
  })

  it("公式改宿主给的对象，宿主看得见（武器公式靠它累计生命之契）", () => {
    const path = put(
      "character/甲/artis.js",
      "export default ({ params }) => { params.BondOfLife = Math.min(params.BondOfLife + 25, 200); return true }\n"
    )
    const fn = evalCalc(path, { root, deps: DEPS })?.default as (ds: unknown) => boolean
    const ds = { params: { BondOfLife: 190 } }
    expect(fn(ds)).toBe(true)
    expect(ds.params.BondOfLife).toBe(200)
  })

  it("宿主数组在公式里仍是数组，map / 展开 / Object.keys 照常；公式返回的宿主对象原样交回", () => {
    const path = put(
      "character/甲/artis.js",
      `export default (ds, calc) => ({
  isArr: Array.isArray(ds.list),
  mapped: ds.list.map(x => x * 2),
  spread: [...ds.list],
  keys: Object.keys(ds.obj),
  sum: calc(ds.obj.a) + calc(ds.obj.b),
  back: ds.obj
})
`
    )
    const fn = evalCalc(path, { root, deps: DEPS })?.default as (ds: unknown, calc: unknown) => Record<string, unknown>
    const ds = { list: [1, 2, 3], obj: { a: 1, b: 2 } }
    const got = fn(ds, (n: number) => n * 10)
    expect(got["isArr"]).toBe(true)
    expect([...(got["mapped"] as number[])]).toEqual([2, 4, 6])
    expect([...(got["spread"] as number[])]).toEqual([1, 2, 3])
    expect([...(got["keys"] as string[])]).toEqual(["a", "b"])
    expect(got["sum"]).toBe(30)
    expect(got["back"]).toBe(ds.obj)
  })

  it("评分表以文本进上下文 —— 公式改它影响不到宿主那份", () => {
    detailsOf('usefulAttr["胡桃"].hp = 1\nexport const details = 1\n')
    expect(DEPS.usefulAttr?.["胡桃"]).toEqual({ hp: 80, atk: 50 })
  })
})
