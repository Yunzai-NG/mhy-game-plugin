/**
 * 模块职责：绝区零伤害层的对外出口 —— 这一层公开的全部取值与类型
 * 依赖方向：只从同目录各文件转出，不含任何实现
 * 生命周期：无状态
 * 注意事项：与 `dmg/index.ts` 同形态，外面只认这个出口。绝区零这份与原神星铁**不共用乘区**（等级区只异常伤害有、贯穿不吃防御区、抗性区初值取自假想敌），故是 `dmg/` 下并列的一层而非分支。
 *          目录内部互引仍走各自文件、不经这里（绕自己的 index 会成环）。
 */
export { zzzPropOf, zzzAttrTables } from "./attr.js"
export type { ZzzAttrTables, ZzzDmgPropKey, ZzzPropTable } from "./attr.js"
export { zzzBuffValue, zzzPickBuffs, zzzSumBuffs } from "./buff.js"
export type {
  ZzzBuff,
  ZzzBuffCtx,
  ZzzBuffFilter,
  ZzzBuffResult,
  ZzzBuffSource,
  ZzzBuffType,
  ZzzBuffValue,
  ZzzSumResult
} from "./buff.js"
export { ZZZ_ENEMY, zzzCalcSkill, zzzCalcSkills, zzzLevelArea } from "./calc.js"
export type { ZzzAreas, ZzzCalcCtx, ZzzDmgResult, ZzzEnemy, ZzzSkill } from "./calc.js"
export { zzzDmgFn, zzzRate, zzzRunDetails, zzzTalentTables } from "./detail.js"
export type { ZzzDataSet, ZzzDetailSpec, ZzzDmgFn } from "./detail.js"
export { zzzSkillsOf } from "./skill.js"
export { isZzzDmg, zzzDmgOf, fillWeaponIdx } from "./build.js"
export type { ZzzDmgData, ZzzDmgMiss } from "./build.js"
