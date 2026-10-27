/**
 * 模块职责：把元数据里的 `character/extra.js` 解析成纯数据 —— **解析，不求值**
 * 依赖方向：只依赖 meta/js-lit 的原语，纯字符串处理
 * 生命周期：装载时调用一次，结果随调用方常驻内存
 * 注意事项：恒放行落盘、只解析不求值、随元数据更新（写进插件则新角色永远不会被挑中、不报错）。
 *          值形态与 alias/daily/abbr 都不同、不能复用 `parseStringMap`：值写作 `[…].join(",")`
 *          这个**表达式**，故先取方括号那段、按 {@link parseStringList} 认出各段再自拼，`.join(",")`
 *          尾巴只跳过一次都不求值；裸字符串也一并认。原神与星铁的包里都有此文件，绝区零无、不是漏的。
 */
import { blockAfter, parseStringList, stripComments } from "./js-lit.js"

/**
 * `character/extra.js` 的文件名
 *
 * 列在 meta/download.ts 的 `#filenames()` 白名单里。
 */
export const EXTRA_FILE = "extra.js"

/** 四类关系，键名照元数据里那份 */
export const WIFE_KEYS = ["girlfriend", "boyfriend", "daughter", "son"] as const

/** 一类关系 */
export type WifeKey = (typeof WIFE_KEYS)[number]

/** 四类各自的角色名单 */
export type WifeTable = Readonly<Record<WifeKey, readonly string[]>>

/** 一个都没解析出来时的空表，免得调用方逐类判 undefined */
export const EMPTY_WIFE: WifeTable = { girlfriend: [], boyfriend: [], daughter: [], son: [] }

/**
 * 认一类的值
 *
 * 两种形态都认：`[…].join(",")`（元数据那份）与裸字符串（追加配置那份），认出后按逗号切、去空白。
 * @param src 已剥注释的整份文本
 * @param key 类别键
 * @param from 从哪里开始找，用来跳过前面已认过的部分
 * @returns 角色名与该条结束的位置；这一类不存在时 undefined
 */
function parseOne(src: string, key: WifeKey, from: number): { names: string[]; end: number } | undefined {
  const head = new RegExp(`\\b${key}\\s*:\\s*`)
  const seek = new RegExp(head.source, "g")
  seek.lastIndex = from
  const got = seek.exec(src)
  if (!got) return undefined

  const at = got.index + got[0].length
  const ch = src[at] ?? ""

  // 形态一：`[…].join(",")`。blockAfter 要求 head 匹配到含开括号为止，故另造一个带 `[` 的正则
  if (ch === "[") {
    const block = blockAfter(src, new RegExp(`${head.source}\\[`), "[", "]", from)
    if (!block) return undefined
    const parts = parseStringList(block.body, `extra.js 的 ${key}`)
    return { names: splitNames(parts.join(",")), end: block.end }
  }

  // 形态二：裸字符串
  if (ch === '"' || ch === "'") {
    const close = src.indexOf(ch, at + 1)
    if (close < 0) return undefined
    return { names: splitNames(src.slice(at + 1, close)), end: close + 1 }
  }

  // 别的形态一概不认：宁可这一类为空，也不猜
  return undefined
}

/**
 * 把一串逗号分隔的名字切开
 * @param text 形如 `琴, 丽莎, 荧`
 * @returns 去空白、去空项后的名字
 */
function splitNames(text: string): string[] {
  return text
    .split(",")
    .map(one => one.trim())
    .filter(one => one.length > 0)
}

/**
 * 解析 `character/extra.js` 的 `wifeCfg`
 * @param src 文件内容
 * @returns 四类各自的角色名单；没有 `wifeCfg` 导出时 undefined
 */
export function parseWifeFile(src: string): WifeTable | undefined {
  const clean = stripComments(src)
  const block = blockAfter(clean, /export\s+const\s+wifeCfg\s*=\s*\{/)
  if (!block) return undefined

  const out: Record<WifeKey, string[]> = { girlfriend: [], boyfriend: [], daughter: [], son: [] }
  for (const key of WIFE_KEYS) {
    // 在 wifeCfg 那一块之内找，免得认到文件里别处同名的键
    const got = parseOne(block.body, key, 0)
    if (got) out[key] = got.names
  }
  return out
}
