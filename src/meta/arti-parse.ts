/**
 * 模块职责：解析元数据里的圣遗物 / 遗器词条表（原神 `artifact/extra.js`、星铁 `artifact/meta.js`）
 * 依赖方向：依赖 meta/js-lit 的解析原语；纯字符串处理，无 IO
 * 生命周期：无状态，装载词条表时调用
 * 注意事项：两份文件是字面量加一段派生循环（算单次强化值、大小词条、展示文字），**只解析不求值**：字面量里
 *          认 `"a,b".split(",")` 与纯数字四则（`127 / 6`），派生那段由 {@link deriveGs} / {@link deriveSr} 照原样
 *          重做。认不出的写法整体抛错 —— 静默少一项则那个词条的评分恒为 0。星铁那份是 `const attrMap` 加
 *          `export { attrMap }`，只认 `export const` 会整份读空。
 */
import type { ArtiGame, ArtiMeta, AttrMeta } from "./arti.js"
import { parseDataExport, stripComments } from "./js-lit.js"

/** 各游戏词条表的文件名，都在 `artifact/` 下 */
export const ARTI_META_FILE: Readonly<Record<ArtiGame, string>> = { gs: "extra.js", sr: "meta.js" }

/** 小词条 → 对应的大词条 */
const PLUS_BASE: Readonly<Record<string, string>> = { hpPlus: "hp", atkPlus: "atk", defPlus: "def" }

/**
 * 求一段只含数字与 `+ - * /`、可带括号的算式
 * @param expr 算式
 * @returns 结果
 * @throws 出现数字与运算符之外的字符时
 */
export function evalArith(expr: string): number {
  const tokens = expr.match(/\d+(?:\.\d+)?|[-+*/()]/g) ?? []
  if (tokens.join("") !== expr.replace(/\s+/g, "")) throw new Error(`算式里有认不出的写法：${expr}`)
  let at = 0
  const factor = (): number => {
    const tok = tokens[at++]
    if (tok === "(") {
      const v = sum()
      if (tokens[at++] !== ")") throw new Error(`算式括号不配对：${expr}`)
      return v
    }
    if (tok === "-") return -factor()
    const n = Number(tok)
    if (tok === undefined || Number.isNaN(n)) throw new Error(`算式残缺：${expr}`)
    return n
  }
  const product = (): number => {
    let v = factor()
    while (tokens[at] === "*" || tokens[at] === "/") v = tokens[at++] === "*" ? v * factor() : v / factor()
    return v
  }
  const sum = (): number => {
    let v = product()
    while (tokens[at] === "+" || tokens[at] === "-") v = tokens[at++] === "+" ? v + product() : v - product()
    return v
  }
  const out = sum()
  if (at !== tokens.length) throw new Error(`算式残缺：${expr}`)
  return out
}

/**
 * 把字面量里的两种表达式换成 JSON 认得的值
 *
 * `"a,b".split(",")` 换成数组；冒号后、逗号或右括号前的纯数字算式换成结果。
 * @param body 字面量文本
 * @returns 换过的文本
 */
function lower(body: string): string {
  return body
    .replace(/(["'])([^"']*)\1\s*\.split\(\s*(["'])([^"']*)\3\s*\)/g, (_all, _q, list: string, _q2, sep: string) =>
      JSON.stringify(list.split(sep))
    )
    .replace(/(:\s*)([\d.\s()*/+-]*[*/+-][\d.\s()*/+-]*?)(\s*[,}\n])/g, (_all, head: string, expr: string, tail: string) =>
      `${head}${evalArith(expr.trim())}${tail}`
    )
}

/**
 * 解析一段对象 / 数组字面量，认 `"a,b".split(",")` 与纯数字算式
 * @param text 以 `{` 或 `[` 开头的字面量文本
 * @returns 值；认不出时 undefined
 */
export function parseLiteral<T>(text: string): T | undefined {
  try {
    return parseDataExport<T>(`export const __v = ${lower(text)}`, "__v")
  } catch {
    return undefined
  }
}

/**
 * 取一个常量声明的值
 *
 * `export const X =` 与 `const X =` 都认（星铁的词条表是后者）。值只认对象 / 数组字面量、
 * `"a,b".split(",")` 与数字（含算式）。
 * @param src 已剥注释的源文本
 * @param name 常量名
 * @returns 值；没有这个声明时 undefined
 * @throws 声明在、值却认不出时
 */
function constValue<T>(src: string, name: string): T | undefined {
  const head = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*=\\s*`).exec(src)
  if (!head) return undefined
  const rest = src.slice(head.index + head[0].length)
  const split = /^(["'])([^"']*)\1\s*\.split\(\s*(["'])([^"']*)\3\s*\)/.exec(rest)
  if (split) return (split[2] ?? "").split(split[4] ?? "") as T
  if (rest[0] === "{" || rest[0] === "[") {
    const got = parseLiteral<T>(rest)
    if (got === undefined) throw new Error(`${name} 的字面量认不出`)
    return got
  }
  const num = /^([\d.\s()*/+-]+?)\s*(?:\n|;|$)/.exec(rest)
  if (num) return evalArith((num[1] ?? "").trim()) as T
  throw new Error(`${name} 的值认不出`)
}

/**
 * 照 `Format.comma` 的写法出千分位文字
 * @param num 数值
 * @param fix 小数位
 * @returns 文字；小数部分按 `toFixed` 再转数字后的位数，不足不补零（`23.3` 而非 `23.30`）
 */
function comma(num: number, fix: number): string {
  const [integer = "", decimal] = String(parseFloat(num.toFixed(fix))).split(".")
  const head = integer.replace(/\d(?=(\d{3})+$)/g, "$&,")
  return `${head}${fix > 0 ? `.${decimal || "0".repeat(fix)}` : ""}`
}

/**
 * 词条的展示文字
 * @param format `pct` / `comma`
 * @param value 数值
 * @returns 文字
 */
function textOf(format: string, value: number): string {
  return format === "pct" ? `${value.toFixed(2)}%` : comma(value, 2)
}

/**
 * 补上大小词条两个字段
 * @param attr 词条
 * @param key 词条键
 */
function setKind(attr: AttrMeta, key: string): void {
  const base = PLUS_BASE[key]
  if (base) attr.base = base
  attr.type = base ? "plus" : "normal"
}

/**
 * 原神的派生：单次强化值 = 基准 × 倍率，副词条另有最小档（× 0.7），并建「展示名 → 键」
 * @param meta 字面量部分
 */
function deriveGs(meta: ArtiMeta): void {
  const names: Record<string, string> = {}
  const basic = meta.basicNum ?? 0
  for (const [key, attr] of Object.entries(meta.attrMap)) {
    names[attr.title] = key
    const pct = meta.attrPct?.[key]
    if (!pct) continue
    attr.value = basic * pct
    if (meta.subAttr.includes(key)) (attr as AttrMeta & { valueMin?: number }).valueMin = basic * pct * 0.7
    setKind(attr, key)
    attr.text = textOf(attr.format, attr.value)
  }
  meta.attrNameMap = names
}

/**
 * 星铁的派生：单次强化值已写在字面量里，只补大小词条与展示文字
 * @param meta 字面量部分
 */
function deriveSr(meta: ArtiMeta): void {
  for (const [key, attr] of Object.entries(meta.attrMap)) {
    if (!attr.value) continue
    setKind(attr, key)
    attr.text = textOf(attr.format, attr.value)
  }
}

/**
 * 解析一份词条表
 * @param src 源文本
 * @param game 游戏
 * @returns 词条元数据
 * @throws 三张必需的表缺任一张、或出现认不出的写法时
 */
export function parseArtiMeta(src: string, game: ArtiGame): ArtiMeta {
  const clean = stripComments(src)
  const mainAttr = constValue<Record<string, string[]>>(clean, "mainAttr")
  const subAttr = constValue<string[]>(clean, "subAttr")
  const attrMap = constValue<Record<string, AttrMeta>>(clean, "attrMap")
  if (!mainAttr || !subAttr || !attrMap) throw new Error(`${ARTI_META_FILE[game]} 缺 mainAttr / subAttr / attrMap`)
  const meta: ArtiMeta = { mainAttr, subAttr, attrMap }
  if (game === "gs") {
    const basicNum = constValue<number>(clean, "basicNum")
    const attrPct = constValue<Record<string, number>>(clean, "attrPct")
    const mainIdMap = constValue<Record<string, string>>(clean, "mainIdMap")
    const attrIdMap = constValue<Record<string, { key: string; value: number }>>(clean, "attrIdMap")
    if (basicNum !== undefined) meta.basicNum = basicNum
    if (attrPct) meta.attrPct = attrPct
    if (mainIdMap) meta.mainIdMap = mainIdMap
    if (attrIdMap) meta.attrIdMap = attrIdMap
    deriveGs(meta)
  } else {
    deriveSr(meta)
  }
  return meta
}
