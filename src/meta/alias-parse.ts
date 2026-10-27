/**
 * 模块职责：把元数据里的 `character/alias.js` 解析成纯数据 —— **解析，不求值**
 * 依赖方向：无依赖，纯字符串处理
 * 生命周期：安装元数据时调用一次，产出 `alias.json` 落盘
 * 注意事项：刻意不走沙箱——`alias.js` 是纯数据（只有两个 `export const` 与对象字面量），无须为它
 *          扩大「执行下载代码」的范围，故按很窄的语法手工解析。能认的形态：`export const 名 =
 *          { 键: "逗号串" }`，键可带引号也可不带、值必须是字符串字面量。认不出要整体失败而非
 *          跳过那一条——静默跳过会让某角色别名凭空消失、表现为「查不到这个角色」而极难追到这里。
 */
import { constBlock, parseStringMap, stripComments } from "./js-lit.js"

/** 一份解析出来的别名数据 */
export interface ParsedAlias {
  /** 角色名 → 逗号分隔的别名串，与源文件的形态一致 */
  alias: Record<string, string>
  /** 角色名 → 简称，星铁独有 */
  abbr?: Record<string, string>
}

/**
 * 解析 `character/alias.js`
 * @param src 文件内容
 * @returns 别名与简称；没有 `alias` 导出时 undefined
 * @throws 语法与预期不符时抛错
 */
export function parseAliasFile(src: string): ParsedAlias | undefined {
  const clean = stripComments(src)
  const aliasBody = constBlock(clean, "alias")
  if (aliasBody === undefined) return undefined

  const out: ParsedAlias = { alias: parseStringMap(aliasBody, "alias") }
  const abbrBody = constBlock(clean, "abbr")
  if (abbrBody !== undefined) {
    const abbr = parseStringMap(abbrBody, "abbr")
    if (Object.keys(abbr).length > 0) out.abbr = abbr
  }
  return out
}

/** 展开后的别名表，即落盘的 `alias.json` 形态 */
export interface AliasIndex {
  /** 别名（已转小写）→ 角色名 */
  alias: Record<string, string>
  /** 角色名 → 简称 */
  abbr?: Record<string, string>
}

/**
 * 把解析结果展开成"别名 → 正名"的索引
 *
 * 展开三类键：别名串里的每一项、角色全名、简称。少了后两类则 `#胡桃面板` 与 `*饮月君面板`
 * 都查不到人。
 * @param parsed 解析结果
 * @returns 展开后的索引
 */
export function buildAliasIndex(parsed: ParsedAlias): AliasIndex {
  const alias: Record<string, string> = {}

  for (const [name, raw] of Object.entries(parsed.alias)) {
    for (const one of String(raw).split(",")) {
      const key = one.trim().toLowerCase()
      if (key) alias[key] = name
    }
  }
  // 全名与简称都只在还没被占用时写入：显式别名优先
  for (const name of Object.keys(parsed.alias)) {
    const key = name.trim().toLowerCase()
    if (key) alias[key] ??= name
  }
  for (const [name, txt] of Object.entries(parsed.abbr ?? {})) {
    const key = txt.trim().toLowerCase()
    if (key) alias[key] ??= name
  }

  return { alias, ...(parsed.abbr ? { abbr: parsed.abbr } : {}) }
}
