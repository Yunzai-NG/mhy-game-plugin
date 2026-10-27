/**
 * 模块职责：把元数据里的 `material/abbr.js` 解析成纯数据 —— **解析，不求值**
 * 依赖方向：只依赖 meta/js-lit 的三个原语，纯字符串处理
 * 生命周期：材料表装载时调用一次，结果随材料表常驻内存
 * 注意事项：与 `alias.js` 同一取舍——恒放行落盘、只解析不求值、随元数据更新（写进插件则新材料
 *          等发版才短得下来，不报错、只是图鉴上材料标题挤成一长条）。形状与 `alias.js` 完全一样，
 *          故直接复用 {@link parseStringMap}、认不出整体抛错。只有原神有此文件，星铁材料标题即全名。
 */
import { constBlock, parseStringMap, stripComments } from "./js-lit.js"

/**
 * `material/abbr.js` 的文件名
 *
 * 列在 meta/download.ts 的 `#filenames()` 白名单里。
 */
export const ABBR_SOURCE = "abbr.js"

/**
 * 解析 `material/abbr.js`
 * @param src 文件内容
 * @returns 材料全名 → 简称；没有 `abbr` 导出时 undefined
 * @throws 语法与预期不符时抛错
 */
export function parseAbbrFile(src: string): Record<string, string> | undefined {
  const body = constBlock(stripComments(src), "abbr")
  if (body === undefined) return undefined
  return parseStringMap(body, "abbr")
}
