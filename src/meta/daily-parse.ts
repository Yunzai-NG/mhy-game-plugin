/**
 * 模块职责：把元数据里的 `material/daily.js` 解析成纯数据 —— **解析，不求值**
 * 依赖方向：只依赖 meta/js-lit 的解析原语
 * 生命周期：装载材料表时按游戏读一次
 * 注意事项：不能硬编码进插件——它是「每周几刷哪个国家的材料」的对应，每出新国家多一列，写死则新
 *          国家材料等发版才认得出、在那之前 `#今日材料` 把那些角色静默漏掉。它按简称索引而非全名，
 *          简称算法在 {@link materialAbbr}、纯由全名推出且固定，改动会让每条都对不上。能认的语法很窄：
 *          `export default { talent: { 1: ["简称"] }, weapon: {...} }`，认不出整体失败（见 js-lit）。
 */
import { assertConsumed, blockAfter, parseStringList, stripComments } from "./js-lit.js"

/** `daily.js` 里的两类材料 */
export type DailyType = "talent" | "weapon"

/**
 * 一份解析出来的每日轮换表
 *
 * 外层键是周期号（`1`/`2`/`3`，对应周一四 / 周二五 / 周三六），内层是按国家次序排列的材料简称
 * ——**次序即国家**，见 {@link CITY_BY_INDEX}。
 */
export type ParsedDaily = Record<DailyType, Record<string, string[]>>

/** `daily.js` 里两类材料的键 */
const DAILY_TYPES: readonly DailyType[] = ["talent", "weapon"]

/**
 * 数组次序对应的国家名
 *
 * 刻意比元数据自带的那份长两项：那份只到纳塔（六个），而 `daily.js` 早有八列，少两项则第七八列
 * 材料拿不到国家名（分组标题空白、国家图标 404）。再多出的列由 {@link cityAt} 回落到材料简称。
 */
export const CITY_BY_INDEX: readonly string[] = ["蒙德", "璃月", "稻妻", "须弥", "枫丹", "纳塔", "挪德卡莱", "至冬"]

/**
 * 取某一列对应的国家名
 * @param at 列号，0 起
 * @returns 国家名；超出已知范围时空串
 */
export function cityAt(at: number): string {
  return CITY_BY_INDEX[at] ?? ""
}

/**
 * 从材料全名算出 `daily.js` 里用的简称
 *
 * 天赋书取书名号里那一段，武器材料取前四字。这两条规则不能换成「读元数据的 abbr」——abbr 在这一步
 * 之后才覆盖上去、且不覆盖天赋书，用错一处则整类材料对不上、`#今日材料` 出一张空图。
 * @param name 材料全名
 * @param type 材料类别
 * @returns 简称
 */
export function materialAbbr(name: string, type: DailyType): string {
  if (type === "talent") return /「(.+)」/.exec(name)?.[1] ?? name
  return name.slice(0, 4) || name
}

/**
 * 解析 `material/daily.js`
 * @param src 文件内容
 * @returns 每日轮换表；没有 `export default` 时 undefined
 * @throws 语法与预期不符时抛错
 */
export function parseDailyFile(src: string): ParsedDaily | undefined {
  const clean = stripComments(src)
  const root = blockAfter(clean, /export\s+default\s*\{/)
  if (!root) return undefined

  const out: ParsedDaily = { talent: {}, weapon: {} }
  for (const type of DAILY_TYPES) {
    const block = blockAfter(root.body, new RegExp(`(?:"${type}"|'${type}'|${type})\\s*:\\s*\\{`))
    if (!block) continue
    out[type] = parseWeeks(block.body, `daily.${type}`)
  }
  return out
}

/**
 * 解析 `{ 1: [...], 2: [...] }` 这一层
 * @param body 花括号内的文本
 * @param where 出错时报给调用方的位置说明
 * @returns 周期号 → 简称数组
 * @throws 遇到认不出的形态时抛错
 */
function parseWeeks(body: string, where: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const head = /(?:"([^"]*)"|'([^']*)'|([^\s:,{}[\]"'`]+))\s*:\s*\[/g
  let rest = ""
  let at = 0

  for (;;) {
    head.lastIndex = at
    const got = head.exec(body)
    if (!got) break
    const list = blockAfter(body, /\[/, "[", "]", got.index + got[0].length - 1)
    if (!list) break
    const key = String(got[1] ?? got[2] ?? got[3] ?? "")
    out[key] = parseStringList(list.body, `${where}.${key}`)
    rest += body.slice(at, got.index)
    at = list.end
  }
  rest += body.slice(at)

  assertConsumed(rest, where)
  return out
}
