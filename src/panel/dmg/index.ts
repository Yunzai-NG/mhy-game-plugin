/**
 * 模块职责：伤害计算层的对外出口 —— 这一层公开的全部取值与类型
 * 依赖方向：只从同目录各文件转出，不含任何实现
 * 生命周期：无状态
 * 注意事项：与 `panel/prop`、`panel/score`、`panel/profile` 同一形态：文件划分是这一层自己的事，外面只认这个出口。
 *          目录内部互引仍走各自文件、不经这里（绕一趟自己的 index 会成环）。
 */
export { attrValue, baseAttr, calcDmgAttr, cloneAttr, dataSet } from "./attr.js"
export type {
  AttrItem,
  BaseAttrInput,
  CalcDmgAttrInput,
  CalcDmgAttrResult,
  DmgAttrTable,
  DmgBuff,
  DmgDataSet,
  EnemyItem,
  SkillItem
} from "./attr.js"
export {
  DmgBuffLoader,
  artisBuffsOf,
  keyIdxBuff,
  normalizeBuffs,
  staticAttrBuff,
  staticIdxBuff,
  stepValues,
  weaponBuffsOf,
  weaponTablesAt
} from "./buffs.js"
export type { DmgBuffLoaderOptions, DmgGame } from "./buffs.js"
export { calcRet, getDmgFn } from "./calc.js"
export type { CalcArgs, DmgCalcData, DmgFn, DmgResult, DynamicData } from "./calc.js"
export { comma, forEach, pct, percent, sandboxDeps } from "./deps.js"
export { calcDmg, calcRuleOf, talentTables, treeFlags } from "./detail.js"
export type { CalcDmgInput, CharCalcRule, DmgCalcResult, DmgCell, DmgCompare, DmgRow } from "./detail.js"
export { masteryBasePct, masteryMultiple } from "./mastery.js"
export {
  BREAK_BASE_DMG,
  CRY_BASE_DMG,
  ELATION_BASE_DMG,
  ELE_BASE_DMG,
  ER_TITLE,
  ER_TYPE,
  baseDmgAt
} from "./meta.js"
export type { ErEntry, ErKind } from "./meta.js"
