/**
 * 模块职责：元数据里那几个"纯数据 JS"的解析原语 —— 剥注释、按配对取块、认字符串字面量
 * 依赖方向：无依赖，纯字符串处理
 * 生命周期：安装或装载元数据时调用，无状态
 * 注意事项：这里全是「解析」、一行都不求值——纯数据却写成 JS 的那几个文件（alias.js、daily.js）
 *          必须落盘随元数据更新，而落盘物一律不进 `node:vm`。认不出的语法要整体抛错、不要跳过：
 *          静默跳过会让「某角色别名凭空消失」这类缺失极难追到解析器。字符串内部的 `//` 与花括号
 *          不计，故按字符扫。
 */

/**
 * 剥掉行注释与块注释
 *
 * 只剥字符串**之外**的注释：值本身也可能带斜杠。
 * @param src 源文本
 * @returns 剥掉注释后的文本
 */
export function stripComments(src: string): string {
  let out = ""
  let quote = ""
  let at = 0

  while (at < src.length) {
    const ch = src[at] ?? ""
    const next = src[at + 1] ?? ""

    if (quote) {
      out += ch
      // 转义的下一个字符原样收下，免得 `\"` 被当成引号结束
      if (ch === "\\") {
        out += next
        at += 2
        continue
      }
      if (ch === quote) quote = ""
      at++
      continue
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      out += ch
      at++
      continue
    }
    if (ch === "/" && next === "/") {
      while (at < src.length && src[at] !== "\n") at++
      continue
    }
    if (ch === "/" && next === "*") {
      at += 2
      while (at < src.length && !(src[at] === "*" && src[at + 1] === "/")) at++
      at += 2
      continue
    }
    out += ch
    at++
  }
  return out
}

/**
 * 取一个块的内容，按括号配对数
 *
 * `head` 须匹配到**含**开括号为止，从那个开括号起数配对。字符串内的括号不计——否则值里一个 `}`
 * 就会让整块提前结束、表现为"后半段数据凭空消失"。
 * @param src 已剥注释的文本
 * @param head 匹配到开括号的正则
 * @param open 开括号，缺省 `{`
 * @param close 闭括号，缺省 `}`
 * @param from 起始位置，用于在同一份文本里接着往后找
 * @returns 括号内的文本与该块结束后的位置；没找到时 undefined
 */
export function blockAfter(
  src: string,
  head: RegExp,
  open = "{",
  close = "}",
  from = 0
): { body: string; end: number } | undefined {
  // 每次现造一个带 g 的副本：调用方传进来的正则不该被本函数改掉 lastIndex
  const seek = new RegExp(head.source, head.flags.includes("g") ? head.flags : `${head.flags}g`)
  seek.lastIndex = from
  const got = seek.exec(src)
  if (!got) return undefined

  let depth = 0
  let quote = ""
  const start = got.index + got[0].length - 1
  for (let at = start; at < src.length; at++) {
    const ch = src[at] ?? ""
    if (quote) {
      if (ch === "\\") {
        at++
        continue
      }
      if (ch === quote) quote = ""
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return { body: src.slice(start + 1, at), end: at + 1 }
    }
  }
  return undefined
}

/**
 * 检查一段文本"认完之后没剩下东西"
 *
 * 抹掉全部认出的片段后只该剩逗号与空白，剩别的就说明写法超出本解析器，抛错。
 * @param rest 抹掉认出片段后的残留
 * @param where 出错时报给调用方的位置说明
 * @throws 有残留时抛错
 */
export function assertConsumed(rest: string, where: string): void {
  const leftover = rest.replace(/[\s,]+/g, "")
  if (leftover) {
    throw new Error(
      `${where} 里有认不出的语法（残留 ${leftover.length} 字符，形如 ${leftover.slice(0, 40)}），本解析器不再成立`
    )
  }
}

/**
 * 认一段 `{ 键: "值" }` 里的字符串条目
 *
 * 键三种形态都认：裸标识符（中文标识符在 JS 里合法）、双引号、单引号。值只认字符串字面量。
 * @param body 花括号内的文本
 * @param where 出错时报给调用方的位置说明
 * @returns 键值对
 * @throws 遇到认不出的形态时抛错 —— 静默跳过会让某一条数据凭空消失
 */
export function parseStringMap(body: string, where: string): Record<string, string> {
  const out: Record<string, string> = {}
  const item = /(?:"([^"]*)"|'([^']*)'|([^\s:,{}"'`]+))\s*:\s*(?:"([^"]*)"|'([^']*)')/g

  const rest = body.replace(item, (_all, dq, sq, bare, vdq, vsq) => {
    const key = String(dq ?? sq ?? bare ?? "")
    if (key) out[key] = String(vdq ?? vsq ?? "")
    return ""
  })

  assertConsumed(rest, where)
  return out
}

/**
 * 取一个 `export const 名 = { ... }` 的花括号内容
 * @param src 已剥注释的文本
 * @param name 导出名
 * @returns 花括号内的文本；没有该导出时 undefined
 */
export function constBlock(src: string, name: string): string | undefined {
  return blockAfter(src, new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\{`))?.body
}

/**
 * 认一段 `[ "a", "b" ]` 里的字符串字面量
 *
 * 值只认字符串。数字、变量、嵌套数组一概认不出而抛错。
 * @param body 方括号内的文本
 * @param where 出错时报给调用方的位置说明
 * @returns 按出现次序排列的字符串
 * @throws 遇到认不出的形态时抛错
 */
export function parseStringList(body: string, where: string): string[] {
  const out: string[] = []
  const item = /"([^"]*)"|'([^']*)'/g
  const rest = body.replace(item, (_all, dq: string | undefined, sq: string | undefined) => {
    out.push(String(dq ?? sq ?? ""))
    return ""
  })
  assertConsumed(rest, where)
  return out
}

/**
 * 取一个 `export const 名 = …` 的字面量并按 JSON 解析
 *
 * 比 {@link parseStringMap} 宽一档：对象数组、嵌套对象、字符串数组、数字与布尔都行。做法仍是
 * **解析而非求值**（补键引号、单引号换双、去尾逗号后交给 `JSON.parse`），故文件里任何表达式、
 * 函数或引用都只会解析失败而不被执行。键名允许中文。
 * @param src 源文本，未剥注释也可
 * @param name 导出名
 * @returns 解析结果；没有该导出或解析失败时 undefined
 */
export function parseDataExport<T>(src: string, name: string): T | undefined {
  const clean = stripComments(src)
  const head = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*([[{])`).exec(clean)
  if (!head) return undefined
  const open = head[1] === "[" ? "[" : "{"
  const close = open === "[" ? "]" : "}"
  const from = head.index + head[0].length - 1
  // 按配对取整块，字符串内部的括号不计数——卡池名里就有方括号
  let depth = 0
  let quote = ""
  let end = -1
  for (let at = from; at < clean.length; at++) {
    const ch = clean[at]
    if (quote) {
      if (ch === "\\") at += 1
      else if (ch === quote) quote = ""
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) {
        end = at
        break
      }
    }
  }
  if (end < 0) return undefined
  const body = clean.slice(from, end + 1)
  try {
    const json = body
      // 无引号的键补引号：取「`{`/`,` 与 `:` 之间的整段」而非逐字符枚举字符类——角色名里带
      // `·•「」&` 等，逐字符枚举漏一个就整份解析失败、静默回落。已带引号的键由下一步单转双处理
      .replace(/([{,]\s*)([^\s:,{}[\]"'`]+)(\s*:)/g, '$1"$2"$3')
      .replace(/'([^'\\]*)'/g, '"$1"')
      .replace(/,(\s*[}\]])/g, "$1")
    return JSON.parse(json) as T
  } catch {
    return undefined
  }
}
