/**
 * 模块职责：属性名的统一取法 —— 数据源给了就用它的，没给才用代码表
 * 依赖方向：只依赖同目录三张按游戏分的表与 meta/elem；纯函数
 * 生命周期：无状态
 * 注意事项：元数据里的 `attrMap[key].title` 是**圣遗物词条**名（`大攻击`/`小攻击`），非面板属性名
 *          （`攻击力`），拿来填面板会印错，故取名不引元数据。取不到时返回空串而非键名。
 */
import { elemName } from "../../meta/elem.js"
import type { PanelGame } from "../profile/index.js"
import { GS_PROP_NAME } from "./gs.js"
import { SR_PROP_NAME } from "./sr.js"
import { ZZZ_PANEL_ATTRS, ZZZ_PROP_NAME } from "./zzz.js"

/** 逐游戏的属性名表，取名用的全集 */
export const PROP_NAME: Readonly<Record<PanelGame, Readonly<Record<string, string>>>> = {
  gs: GS_PROP_NAME,
  sr: SR_PROP_NAME,
  zzz: ZZZ_PROP_NAME
}

/**
 * 逐游戏的**面板属性栏**，键序即出图顺序
 *
 * 与 {@link PROP_NAME} 分开只因绝区零两份不同：它认十九项属性，属性栏只画十二行。
 */
const PANEL_ATTRS: Readonly<Record<PanelGame, Readonly<Record<string, string>>>> = {
  gs: GS_PROP_NAME,
  sr: SR_PROP_NAME,
  zzz: ZZZ_PANEL_ATTRS
}

/**
 * 取一项属性的中文名
 * @param game 游戏
 * @param key 属性键
 * @param given 数据源给的名字，有则以它为准
 * @returns 中文名；取不到时空串
 */
export function propName(game: PanelGame, key: string, given?: string): string {
  const from = given?.trim()
  if (from) return from
  const hit = PROP_NAME[game][key]
  if (hit) return hit
  // 伤害加成逐元素一个键，落到元素表；绝区零的元素名在它自己那份里
  return game === "zzz" ? "" : elemName(key, "", game)
}

/**
 * 取一个游戏的面板属性栏
 *
 * 取的是**属性栏那一份**而非取名全集：绝区零两者不同，见 {@link PANEL_ATTRS}。
 * @param game 游戏
 * @returns 属性键 → 中文名
 */
export function propMapOf(game: PanelGame): Readonly<Record<string, string>> {
  return PANEL_ATTRS[game]
}
