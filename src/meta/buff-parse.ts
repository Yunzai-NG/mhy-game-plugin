/**
 * 模块职责：从元数据的 `calc.js` 里认出**静态** buff（套装、武器精炼、角色被动里只加属性的那部分），只解析不求值
 * 依赖方向：依赖 meta/arti-parse 的字面量与算式解析、meta/js-lit 的剥注释；纯字符串处理，无 IO
 * 生命周期：无状态，装载 buff 表时调用
 * 注意事项：静态 buff 在 `calc.js` 里只有四种写法：套装的 `attr(键, 值[, 元素])`、原神武器的 `staticStep(键, 起始[, 步长])`、
 *          星铁光锥的 `staticIdx(行, 键)`、以及带 `isStatic: true` 的字面量对象。其余条目（带 `check`、箭头函数、
 *          `keyIdx`）都是伤害计算那一层的动态 buff，按"不是静态"跳过。**认不出的写法不猜**：记进 `unknown`
 *          由调用方报日志 —— 静默当成动态会让面板少一截属性且不报错。
 */
import { evalArith, parseLiteral } from "./arti-parse.js"
import { stripComments } from "./js-lit.js"

/** 一条套装 / 角色的静态 buff */
export interface ParsedSetBuff {
  /** 词条键 → 加值 */
  data: Record<string, number>
  /** 限定元素（中文名）；有值时只对该元素的角色生效 */
  elem?: string
}

/** 一条武器的静态 buff */
export interface ParsedWeaponBuff {
  /** 原神：词条键 → 逐档精炼的加值，下标 0~4 对应精一至精五（即 `affix - 1`） */
  refine?: Record<string, number[]>
  /** 星铁：数值在光锥 `data.json` 的 `skill.tables[idx]` 里 */
  idx?: number
  /** 星铁：词条键 */
  key?: string
}

/** 一次解析的产出 */
export interface Parsed<T> {
  /** 名字 → 条目 */
  table: T
  /** 认不出、已跳过的条目，形如 `行者之心.4` */
  unknown: string[]
}

/**
 * 算一条武器精炼档位数值
 *
 * **产出 6 项**：下标 0~4 对应精一至精五，末项不用；公式里 `step(40)[refine]` 而 `refine = 精炼 - 1`。
 * @param start 精一的值
 * @param step 每档步长；不传时取 `start / 4`
 * @returns 6 项数值
 */
export function stepValues(start: number, step = 0): number[] {
  const d = step || start / 4
  const out: number[] = []
  for (let idx = 0; idx <= 5; idx++) out.push(start + d * idx)
  return out
}

/**
 * 从开括号起找配对的闭括号
 *
 * 字符串、模板字符串（含 `${}` 里的表达式）内的括号不计。
 * @param src 源文本
 * @param from 开括号的位置
 * @returns 闭括号的位置；配不上时 -1
 */
function closeOf(src: string, from: number): number {
  const stack: string[] = []
  const pair: Record<string, string> = { "(": ")", "[": "]", "{": "}" }
  let quote = ""
  for (let at = from; at < src.length; at++) {
    const ch = src[at] ?? ""
    if (quote) {
      if (ch === "\\") at++
      else if (quote === "`" && ch === "$" && src[at + 1] === "{") {
        const end = closeOf(src, at + 1)
        if (end < 0) return -1
        at = end
      } else if (ch === quote) quote = ""
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if (pair[ch]) stack.push(pair[ch] ?? "")
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== ch) return -1
      if (stack.length === 0) return at
    }
  }
  return -1
}

/**
 * 按顶层逗号切开一段括号内的文本
 * @param body 括号内的文本
 * @returns 各段，已去首尾空白、去掉空段
 */
function splitTop(body: string): string[] {
  const out: string[] = []
  let start = 0
  for (let at = 0; at < body.length; at++) {
    const ch = body[at] ?? ""
    if (ch === '"' || ch === "'" || ch === "`" || ch === "(" || ch === "[" || ch === "{") {
      // 借 closeOf 跳过整段：字符串当作一对引号看
      const end = ch === '"' || ch === "'" || ch === "`" ? quoteEnd(body, at) : closeOf(body, at)
      if (end < 0) break
      at = end
      continue
    }
    if (ch === ",") {
      out.push(body.slice(start, at))
      start = at + 1
    }
  }
  out.push(body.slice(start))
  return out.map(it => it.trim()).filter(it => it !== "")
}

/**
 * 字符串字面量的结束位置
 * @param src 源文本
 * @param from 开引号的位置
 * @returns 闭引号的位置；没有时 -1
 */
function quoteEnd(src: string, from: number): number {
  const q = src[from]
  for (let at = from + 1; at < src.length; at++) {
    const ch = src[at]
    if (ch === "\\") at++
    else if (q === "`" && ch === "$" && src[at + 1] === "{") {
      const end = closeOf(src, at + 1)
      if (end < 0) return -1
      at = end
    } else if (ch === q) return at
  }
  return -1
}

/**
 * 把一个对象字面量的文本切成「键 → 值文本」
 *
 * 方法简写（`check ({ x }) { … }`）与展开（`...x`）没有顶层冒号，按原样留在 `rest` 里，调用方据此判它不是纯数据。
 * @param text 以 `{` 开头的对象字面量
 * @returns 各键的值文本，与没有键的那些段
 */
function entriesOf(text: string): { entries: [string, string][]; rest: string[] } {
  const end = closeOf(text, 0)
  const body = end < 0 ? "" : text.slice(1, end)
  const entries: [string, string][] = []
  const rest: string[] = []
  for (const part of splitTop(body)) {
    const key = /^(?:"([^"]*)"|'([^']*)'|([^\s:([{]+))\s*:/.exec(part)
    if (!key) {
      rest.push(part)
      continue
    }
    entries.push([key[1] ?? key[2] ?? key[3] ?? "", part.slice(key[0].length).trim()])
  }
  return { entries, rest }
}

/**
 * 认一个函数调用 `名(参数…)`
 * @param text 值文本
 * @param name 函数名
 * @returns 参数文本；不是这个调用时 undefined
 */
function callArgs(text: string, name: string): string[] | undefined {
  const head = new RegExp(`^${name}\\s*\\(`).exec(text)
  if (!head) return undefined
  const open = head[0].length - 1
  const end = closeOf(text, open)
  if (end !== text.length - 1) return undefined
  return splitTop(text.slice(open + 1, end))
}

/**
 * 认一个字符串字面量
 * @param text 值文本
 * @returns 字符串；不是字符串字面量时 undefined
 */
function strOf(text: string | undefined): string | undefined {
  const got = /^(["'])([^"'\\]*)\1$/.exec(text ?? "")
  return got ? got[2] : undefined
}

/**
 * 认一个数（含负号与四则算式）
 * @param text 值文本
 * @returns 数；认不出时 undefined
 */
function numOf(text: string | undefined): number | undefined {
  if (text === undefined || !/^[\d.\s()*/+-]+$/.test(text)) return undefined
  try {
    const n = evalArith(text.trim())
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

/** 一个值的分类结果 */
type Kind<T> = { static: T[] } | { dynamic: true } | { unknown: true }

/**
 * 一个值是否明显是动态 buff 或空项
 * @param text 值文本
 * @returns 是时为真
 */
function plainlyNotStatic(text: string): boolean {
  if (/^(false|null|undefined|true)$/.test(text)) return true
  // 箭头函数与 function 表达式
  if (/^(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/.test(text)) return true
  // 反应名一类的字符串
  return strOf(text) !== undefined
}

/**
 * 分类一个对象字面量：带 `isStatic: true` 且 `data` 是纯字面量的才算静态
 * @param text 以 `{` 开头的值文本
 * @param elemOk 是否收 `elem` 字段
 * @returns 分类结果
 */
function objectKind(text: string, elemOk: boolean): Kind<ParsedSetBuff> {
  const { entries } = entriesOf(text)
  const map = new Map(entries)
  if (map.get("isStatic") !== "true") return { dynamic: true }
  const data = parseLiteral<Record<string, number>>(map.get("data") ?? "")
  if (!data || Object.values(data).some(v => typeof v !== "number")) return { unknown: true }
  const one: ParsedSetBuff = { data }
  const elem = strOf(map.get("elem"))
  if (elemOk && elem) one.elem = elem
  return { static: [one] }
}

/**
 * 分类一个值：单条、数组、或一眼可知的动态项
 * @param text 值文本
 * @param single 认单条的函数（helper 调用或字面量对象）
 * @returns 分类结果
 */
function valueKind<T>(text: string, single: (text: string) => Kind<T>): Kind<T> {
  if (plainlyNotStatic(text)) return { dynamic: true }
  if (text.startsWith("[")) {
    const end = closeOf(text, 0)
    if (end !== text.length - 1) return { unknown: true }
    const out: T[] = []
    for (const part of splitTop(text.slice(1, end))) {
      const got = valueKind(part, single)
      if ("unknown" in got) return got
      if ("static" in got) out.push(...got.static)
    }
    return { static: out }
  }
  return single(text)
}

/**
 * 把分类结果收进表里
 * @param kind 分类结果
 * @param where 位置说明，认不出时记进 `unknown`
 * @param out 产出
 * @returns 静态条目；没有时空数组
 */
function take<T>(kind: Kind<T>, where: string, out: Parsed<unknown>): T[] {
  if ("unknown" in kind) out.unknown.push(where)
  return "static" in kind ? kind.static : []
}

/**
 * 取 `export default` 那个对象字面量的文本
 *
 * 认三种：直接导出字面量；导出一个标识符、字面量在它的 `const`/`let` 声明里；导出一个函数、字面量是它 `return` 的那个。
 * @param src 已剥注释的源文本
 * @returns 以 `{` 开头的对象字面量；认不出时 undefined
 */
function defaultObject(src: string): string | undefined {
  const head = /export\s+default\s+/.exec(src)
  if (!head) return undefined
  const rest = src.slice(head.index + head[0].length)
  const slice = (text: string, at: number): string | undefined => {
    const end = closeOf(text, at)
    return end < 0 ? undefined : text.slice(at, end + 1)
  }
  if (rest.startsWith("{")) return slice(rest, 0)
  if (/^(?:async\s+)?function\b/.test(rest)) {
    const ret = /\breturn\s*\{/.exec(rest)
    return ret ? slice(rest, ret.index + ret[0].length - 1) : undefined
  }
  const ident = /^([\w$]+)/.exec(rest)?.[1]
  if (!ident) return undefined
  const decl = new RegExp(`(?:const|let|var)\\s+${ident}\\s*=\\s*\\{`).exec(src)
  return decl ? slice(src, decl.index + decl[0].length - 1) : undefined
}

/**
 * 解析套装的 `artifact/calc.js`
 * @param src 源文本
 * @returns 套装名 → 件数 → 静态 buff
 */
export function parseSetBuffs(src: string): Parsed<Record<string, Record<string, ParsedSetBuff[]>>> {
  const out: Parsed<Record<string, Record<string, ParsedSetBuff[]>>> = { table: {}, unknown: [] }
  const root = defaultObject(stripComments(src))
  if (!root) {
    out.unknown.push("export default")
    return out
  }
  const single = (text: string): Kind<ParsedSetBuff> => {
    const args = callArgs(text, "attr")
    if (args) {
      const key = strOf(args[0])
      const val = numOf(args[1])
      if (!key || val === undefined) return { unknown: true }
      const one: ParsedSetBuff = { data: { [key]: val } }
      const elem = strOf(args[2])
      if (elem) one.elem = elem
      return { static: [one] }
    }
    if (text.startsWith("{")) return objectKind(text, true)
    return { unknown: true }
  }
  for (const [set, body] of entriesOf(root).entries) {
    if (!body.startsWith("{")) continue
    const counts: Record<string, ParsedSetBuff[]> = {}
    for (const [num, value] of entriesOf(body).entries) {
      const got = take(valueKind(value, single), `${set}.${num}`, out)
      if (got.length) counts[num] = got
    }
    if (Object.keys(counts).length) out.table[set] = counts
  }
  return out
}

/**
 * 解析一类武器的 `weapon/<类别>/calc.js`
 * @param src 源文本
 * @param game 游戏，决定认 `staticStep` 还是 `staticIdx`
 * @returns 武器名 → 静态 buff
 */
export function parseWeaponBuffs(src: string, game: "gs" | "sr"): Parsed<Record<string, ParsedWeaponBuff[]>> {
  const out: Parsed<Record<string, ParsedWeaponBuff[]>> = { table: {}, unknown: [] }
  const root = defaultObject(stripComments(src))
  if (!root) {
    out.unknown.push("export default")
    return out
  }
  const single = (text: string): Kind<ParsedWeaponBuff> => {
    if (game === "gs") {
      const args = callArgs(text, "staticStep")
      if (args) {
        const key = strOf(args[0])
        const start = numOf(args[1])
        const step = args[2] === undefined ? 0 : numOf(args[2])
        if (!key || start === undefined || step === undefined) return { unknown: true }
        return { static: [{ refine: { [key]: stepValues(start, step) } }] }
      }
    } else {
      const args = callArgs(text, "staticIdx")
      if (args) {
        const idx = numOf(args[0])
        const key = strOf(args[1])
        if (idx === undefined || !key) return { unknown: true }
        return { static: [{ idx, key }] }
      }
      if (callArgs(text, "keyIdx")) return { dynamic: true }
    }
    // 字面量对象恒是动态的那种（带 title / refine / check），武器的静态 buff 只经上面两个 helper 写
    if (text.startsWith("{")) return entriesOf(text).entries.some(([k, v]) => k === "isStatic" && v === "true") ? { unknown: true } : { dynamic: true }
    return { unknown: true }
  }
  for (const [name, value] of entriesOf(root).entries) {
    const got = take(valueKind(value, single), name, out)
    if (got.length) out.table[name] = got
  }
  return out
}

/**
 * 解析一个角色的 `character/<名>/calc.js` 里 `buffs` 导出中的静态条目
 * @param src 源文本
 * @returns 静态 buff；没有 `buffs` 导出时空数组
 */
export function parseCharBuffs(src: string): Parsed<ParsedSetBuff[]> {
  const out: Parsed<ParsedSetBuff[]> = { table: [], unknown: [] }
  const clean = stripComments(src)
  const head = /export\s+const\s+buffs\s*=\s*\[/.exec(clean)
  if (!head) return out
  const open = head.index + head[0].length - 1
  const end = closeOf(clean, open)
  if (end < 0) {
    out.unknown.push("buffs")
    return out
  }
  // 角色的静态被动只写成带 isStatic 的字面量；其余（字符串反应名、带 check 的对象）都是动态的
  const single = (text: string): Kind<ParsedSetBuff> => (text.startsWith("{") ? objectKind(text, false) : { unknown: true })
  out.table = take(valueKind(clean.slice(open, end + 1), single), "buffs", out)
  return out
}
