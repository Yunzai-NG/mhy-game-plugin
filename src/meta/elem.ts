/**
 * 模块职责：元素 / 命途的键与别名互查
 * 依赖方向：纯数据与纯函数，不碰 IO、不依赖元数据是否安装
 * 生命周期：模块加载时把别名表摊平成两张 Map，此后只读
 * 注意事项：原神星铁两张表不能合并——两边都有「风火冰雷」四个中文名但键不同，合并后星铁的
 *          元素伤害加成会静默折算到原神键上、那一栏恒为 0。星铁表要同时收 `elec`/`phy` 与
 *          `lightning`/`physical` 两套拼法，少一套则那几张战绩图上对应命途圆点静默不出现。
 */

/** 原神的元素键 → 别名，第一个别名同时用作展示名 */
const GS_ALIAS: Readonly<Record<string, readonly string[]>> = {
  anemo: ["风", "蒙德"],
  geo: ["岩", "璃月"],
  electro: ["雷", "电", "雷电", "稻妻"],
  dendro: ["草", "须弥"],
  pyro: ["火", "纳塔"],
  hydro: ["水", "枫丹"],
  cryo: ["冰", "至冬"]
}

/** 星铁的命途键 → 别名，第一个别名同时用作展示名 */
const SR_ALIAS: Readonly<Record<string, readonly string[]>> = {
  fire: ["火"],
  ice: ["冰"],
  wind: ["风"],
  elec: ["雷", "lightning"],
  phy: ["物理", "physical"],
  quantum: ["量子"],
  imaginary: ["虚数"]
}

/** 有元素体系的两个游戏 */
export type ElemGame = "gs" | "sr"

/** 别名（含键自身） → 键 */
const MAPS: Record<ElemGame, Map<string, string>> = { gs: new Map(), sr: new Map() }
/** 键 → 展示名 */
const TITLES: Record<ElemGame, Map<string, string>> = { gs: new Map(), sr: new Map() }

for (const [key, alias] of Object.entries(GS_ALIAS)) {
  MAPS.gs.set(key, key)
  TITLES.gs.set(key, alias[0] ?? key)
  for (const one of alias) MAPS.gs.set(one.toLowerCase(), key)
}
for (const [key, alias] of Object.entries(SR_ALIAS)) {
  MAPS.sr.set(key, key)
  TITLES.sr.set(key, alias[0] ?? key)
  for (const one of alias) MAPS.sr.set(one.toLowerCase(), key)
}

/**
 * 按名称或别名取元素键
 * @param elem 元素名、别名或键本身
 * @param def 查不到时的回落值
 * @param game 游戏，缺省原神
 * @returns 元素键，如 `pyro`；查不到时为 `def`
 */
export function elemOf(elem = "", def = "", game: ElemGame = "gs"): string {
  return MAPS[game].get(elem.trim().toLowerCase()) ?? def
}

/**
 * 按元素键取展示名
 * @param elem 元素键或别名
 * @param def 查不到时的回落值
 * @param game 游戏，缺省原神
 * @returns 展示名，如 `火`；查不到时为 `def`
 */
export function elemName(elem = "", def = "", game: ElemGame = "gs"): string {
  const key = elemOf(elem, "", game)
  return (key ? TITLES[game].get(key) : undefined) ?? def
}

/**
 * 判断一个键是不是该游戏的元素
 * @param elem 元素键或别名
 * @param game 游戏，缺省原神
 * @returns 是元素时为真
 */
export function isElem(elem = "", game: ElemGame = "gs"): boolean {
  return MAPS[game].has(elem.trim().toLowerCase())
}

/**
 * 判断两个名字是不是同一个元素
 *
 * 两者都查不到时为假——否则两个 undefined 相等会把任意非元素键判为「同元素」，折算进元素伤害。
 * @param a 其一
 * @param b 其二
 * @param game 游戏，缺省原神
 * @returns 同元素时为真
 */
export function sameElem(a = "", b = "", game: ElemGame = "gs"): boolean {
  const ka = elemOf(a, "", game)
  return ka !== "" && ka === elemOf(b, "", game)
}

/**
 * 列出一个游戏的全部元素键与展示名
 * @param game 游戏，缺省原神
 * @returns 键与展示名的数组，顺序与声明顺序一致
 */
export function eachElem(game: ElemGame = "gs"): { key: string; title: string }[] {
  return [...TITLES[game].entries()].map(([key, title]) => ({ key, title }))
}
