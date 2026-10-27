/**
 * 模块职责：伤害公式 —— 把属性表与技能倍率算成期望伤害与暴击伤害
 * 依赖方向：依赖 dmg/attr（属性表）、dmg/mastery（精通乘区）与 dmg/meta（数值表）；纯计算
 * 生命周期：无状态纯函数
 * 注意事项：**乘区的拆分与顺序一律不动**，任何挪位或并项都改结果而不报错。尤其：暴击率钳在 0~1、为 0 时爆伤一并归零；
 *          原神抗性分三段（≥75 走 `1/(1+3k)`、0~75 走 `(100-k)/100`、负抗走 `1-k/200`，不可合并）；星铁另有减伤区 0.9 与易伤区（原神无）；`mode === "basic"` 时不乘技能倍率（剧变反应与护盾走这条）。
 *          返回 `dmg`（必定暴击）与 `avg`（按暴击率的期望）；剧变反应类只有 `avg`（不暴击），故 `dmg` 可选。
 */
import type { DmgAttrTable, DmgDataSet } from "./attr.js"
import { attrValue } from "./attr.js"
import { masteryBasePct, masteryMultiple } from "./mastery.js"
import { baseDmgAt, BREAK_BASE_DMG, CRY_BASE_DMG, ELATION_BASE_DMG, ELE_BASE_DMG, ER_TITLE } from "./meta.js"

/** 一次伤害计算的结果 */
export interface DmgResult {
  /** 暴击伤害；剧变反应一类不暴击，故可缺 */
  dmg?: number
  /** 期望伤害，按暴击率加权 */
  avg: number
}

/** 动态加成，由公式在调用时传入 */
export interface DynamicData {
  /** 动态增伤 */
  dynamicDmg?: number
  /** 动态物伤 */
  dynamicPhy?: number
  /** 动态元素伤害 */
  dynamicDiffelem?: number
  /** 动态暴击率 */
  dynamicCpct?: number
  /** 动态爆伤 */
  dynamicCdmg?: number
  /** 动态易伤 */
  dynamicEnemydmg?: number
  /** 动态增笑，星铁欢愉用 */
  dynamicMerrymake?: number
}

/** 算一次伤害要的上下文 */
export interface DmgCalcData {
  /**
   * 数据集，公式里的 `ds`
   *
   * 可选：求值一律走 {@link attrValue}、本层实际不读它；留此字段是让形态完整，日后详情层要用时不必改签名。
   */
  ds?: DmgDataSet
  /** 属性表 */
  attr: DmgAttrTable
  /** 角色等级 */
  level: number
  /** 敌人等级 */
  enemyLv: number
  /** 游戏 */
  game: "gs" | "sr"
}

/**
 * 算一次伤害的入参
 *
 * 每项都可省、各有缺省（倍率 0、天赋与反应 false、模式 `talent`），缺省收进 {@link calcRet} 使单独调用与经 `dmgFn` 调用一致。
 */
export interface CalcArgs {
  /** 技能倍率，百分数 */
  pctNum?: number
  /** 天赋类型，逗号分隔可给多个 */
  talent?: string | false
  /** 元素反应 */
  ele?: string | false
  /** 基础数值，`mode` 为 basic 时用它替代倍率 */
  basicNum?: number
  /** 模式，`basic` 时不乘技能倍率 */
  mode?: string
  /** 动态加成 */
  dynamicData?: DynamicData | false
  /**
   * 反应基数要用的额外参数，叠层数一类
   *
   * 与 {@link DmgCalcData.ds} 里那份公式参数不是同一个：这一份由公式在调用 `dmgFn` 时逐次传入（同一条详情里不同段可以给不同层数）。
   */
  params?: Record<string, unknown> | false
}

/** 击破持续伤害的几种 */
const DOT_KINDS = new Set(["shock", "burn", "windShear", "bleed"])

/** 击破伤害的几种 */
const BREAK_TALENT_KINDS = new Set([
  "superBreak",
  "lightningBreak",
  "fireBreak",
  "windBreak",
  "physicalBreak",
  "quantumBreak",
  "imaginaryBreak",
  "iceBreak"
])

/** 走击破那一支的全部反应，含持续与附加 */
const BREAK_ALL = new Set([...DOT_KINDS, ...BREAK_TALENT_KINDS, "entanglement"])

/** 剧变反应，只有期望值 */
const FUSION_KINDS = new Set([
  "burning",
  "superConduct",
  "swirl",
  "electroCharged",
  "shatter",
  "overloaded",
  "bloom",
  "burgeon",
  "hyperBloom"
])

/**
 * 月反应与星反应
 *
 * 这一族的反应系数**由 {@link ER_TYPE} 按 `talent` 给**（走 `reaction()` 的取高档、挂技能的取低档），
 * 故本层不再自备一张"有伤害基数时换系数"的表。
 */
const LUNAR_KINDS = new Set([
  "lunarBloom",
  "lunarCharged",
  "lunarCrystallize",
  "stellarConduct",
  "stellarSwirl"
])

/**
 * 取属性表里一个盒子
 *
 * 值可能是 `AttrItem` 也可能是数字，统一成前者、缺失给全零盒子（公式里到处 `attr.dmg.base`，缺键就抛 TypeError、整张面板出不来）。
 * @param attr 属性表
 * @param key 键
 * @returns 盒子
 */
function box(attr: DmgAttrTable, key: string): { base: number; plus: number; pct: number; inc: number } {
  const got = attr[key]
  if (got && typeof got === "object") {
    const one = got as Record<string, unknown>
    return {
      base: Number(one["base"]) || 0,
      plus: Number(one["plus"]) || 0,
      pct: Number(one["pct"]) || 0,
      inc: Number(one["inc"]) || 0
    }
  }
  return { base: Number(got) || 0, plus: 0, pct: 0, inc: 0 }
}

/**
 * 取属性表里一个数字字段
 * @param attr 属性表
 * @param key 键
 * @returns 数值；缺失时 0
 */
function num(attr: DmgAttrTable, key: string): number {
  return Number(attr[key]) || 0
}

/**
 * 取技能加成盒子
 * @param attr 属性表
 * @param key 技能键
 * @returns 技能加成；缺失时 undefined
 */
function skill(attr: DmgAttrTable, key: string): Record<string, number> | undefined {
  const got = attr[key]
  if (!got || typeof got !== "object") return undefined
  return got as unknown as Record<string, number>
}

/**
 * 算原神的抗性乘区
 *
 * 三段公式不可合并（≥75 收益递减、0~75 线性、负抗只减半），合并会让减抗堆到 100% 以上时伤害虚高。
 * @param kx 减抗值
 * @returns 抗性乘区
 */
function gsResist(kx: number): number {
  const k = 10 - (kx || 0)
  if (k >= 75) return 1 / (1 + (3 * k) / 100)
  if (k >= 0) return (100 - k) / 100
  return 1 - k / 200
}

/**
 * 算一次伤害
 *
 * @param args 入参
 * @param data 上下文
 * @returns 伤害结果
 */
export function calcRet(args: CalcArgs, data: DmgCalcData): DmgResult {
  // 缺省值：倍率 0、天赋 false、模式 talent
  const { talent = false, basicNum = 0, mode = "talent" } = args
  let { pctNum = 0, ele = false } = args
  const { attr, level, enemyLv, game } = data
  const dyn = args.dynamicData || {}
  const erParams = args.params || {}

  const dynamicDmg = Number(dyn.dynamicDmg) || 0
  const dynamicPhy = Number(dyn.dynamicPhy) || 0
  const dynamicDiffelem = Number(dyn.dynamicDiffelem) || 0
  const dynamicCpct = Number(dyn.dynamicCpct) || 0
  const dynamicCdmg = Number(dyn.dynamicCdmg) || 0
  const dynamicEnemydmg = Number(dyn.dynamicEnemydmg) || 0
  const dynamicMerrymake = Number(dyn.dynamicMerrymake) || 0

  const atk = box(attr, "atk")
  const dmg = box(attr, "dmg")
  const phy = box(attr, "phy")
  const diffelem = box(attr, "diffelem")
  const cdmg = box(attr, "cdmg")
  const cpct = box(attr, "cpct")
  const enemydmg = box(attr, "enemydmg")

  // 攻击区
  const atkNum = attrValue(atk)

  // 倍率独立乘区
  let multiNum = num(attr, "multi") / 100
  const fyplus = num(attr, "fyplus")
  const fypct = num(attr, "fypct") / 100

  // 增伤区
  let dmgNum = 1 + dmg.base / 100 + dmg.plus / 100 + dynamicDmg / 100
  const elevatedNum = num(attr, "elevated") / 100

  if (ele === "phy") dmgNum = 1 + phy.base / 100 + phy.plus / 100 + dynamicPhy / 100
  if (ele === "diffelem") dmgNum = 1 + diffelem.base / 100 + diffelem.plus / 100 + dynamicDiffelem / 100

  // `scene`（场景伤害）不吃角色自身增伤词条，故把静态增伤那份从增伤区减掉、减完不低于 1
  if (typeof ele === "string" && (/^scene,/.test(ele) || /,scene$/.test(ele) || ele === "scene")) {
    const staticAttr = attr["staticAttr"] as Record<string, { plus?: number }> | undefined
    const dmgPct = (Number(staticAttr?.["dmg"]?.plus) || 0) / 100
    if (dmgPct > 0) dmgNum = dmgNum - dmgPct < 1 ? 1 : dmgNum - dmgPct
    if (ele !== "scene") ele = ele.replace(/(,)?scene(,)?/g, "")
  }

  // 易伤区，只有星铁有
  let enemydmgNum = 1
  if (game === "sr") {
    enemydmgNum = 1 + enemydmg.base / 100 + enemydmg.plus / 100 + dynamicEnemydmg / 100
  }

  // 暴击区
  let cpctNum = cpct.base / 100 + cpct.plus / 100 + dynamicCpct / 100

  // 爆伤区
  let cdmgNum = cdmg.base / 100 + cdmg.plus / 100 + dynamicCdmg / 100

  // 敌方承受暴击伤害提高：星铁独立乘区，与己方爆伤同区叠加
  if (game === "sr") cdmgNum += num(attr, "enemyCdmg") / 100

  const enemy = (attr["enemy"] ?? {}) as { def?: number; ignore?: number }
  let enemyDef = (Number(enemy.def) || 0) / 100
  let enemyIgnore = (Number(enemy.ignore) || 0) / 100

  let plusNum = 0
  pctNum = pctNum / 100

  // 把天赋自身加成折进各乘区；`talent` 可为 `"e,q"` 多项。**欢愉那项刻意跳过前三个乘区**（plus/pct/dmg），欢愉伤害另有一套乘区、重复计入会翻倍
  if (talent) {
    for (const t of String(talent).split(",")) {
      const one = skill(attr, t)
      if (!one) continue
      if (t !== "elation") {
        plusNum += Number(one["plus"]) || 0
        pctNum += (Number(one["pct"]) || 0) / 100
        dmgNum += (Number(one["dmg"]) || 0) / 100
      }
      enemydmgNum += game === "gs" ? 0 : (Number(one["enemydmg"]) || 0) / 100
      cpctNum += (Number(one["cpct"]) || 0) / 100
      cdmgNum += (Number(one["cdmg"]) || 0) / 100
      multiNum += (Number(one["multi"]) || 0) / 100
      enemyDef += (Number(one["def"]) || 0) / 100
      enemyIgnore += (Number(one["ignore"]) || 0) / 100
    }
  }

  if (ele === "superBreak") {
    const sb = (attr["superBreak"] ?? {}) as { ignore?: number }
    enemyIgnore += (Number(sb.ignore) || 0) / 100
  }

  // 防御区：两游戏公式不同，星铁的减防与无视防御**先相加再封顶 1**、原神是两个独立乘子；写错会让减防堆高后伤害偏高而不报错
  let defNum = (level + 100) / (level + 100 + (enemyLv + 100) * (1 - enemyDef) * (1 - enemyIgnore))
  if (game === "sr") {
    const down = enemyDef + enemyIgnore <= 1 ? enemyDef + enemyIgnore : 1
    defNum = (200 + level * 10) / (200 + level * 10 + (200 + enemyLv * 10) * (1 - down))
  }

  // 抗性区
  let kNum = 0.9
  if (game === "sr") {
    kNum = 1 + num(attr, "kx") / 100
  } else {
    let kx = num(attr, "kx")
    // 扩散取反应抗性，染色伤害两者相加
    if (ele === "swirl") kx = num(attr, "fykx")
    else if (ele === "coloringDmg") kx = num(attr, "kx") + num(attr, "fykx")
    kNum = gsResist(kx)
  }

  // 减伤区：星铁恒 0.9，原神没有这一区
  const dmgReduceNum = game === "sr" ? 0.9 : 1

  // 暴击率钳在 0~1；为 0 时爆伤一并归零
  cpctNum = Math.max(0, Math.min(1, cpctNum))
  if (cpctNum === 0) cdmgNum = 0

  const isEle = ele !== false && ele !== "phy" && ele !== "scene" && ele !== "diffelem"

  // 反应区，只有原神在此处算
  let eleNum = 1
  let eleBase = 1
  if (game === "gs") {
    const element = String(attr["element"] ?? "")
    eleNum = isEle ? masteryBasePct(String(ele), element, talent, erParams) : 1
    eleBase = isEle
      ? 1 + num(attr, String(ele)) / 100 + masteryMultiple(String(ele), attrValue(box(attr, "mastery")))
      : 1
  }

  // 星铁的击破与欢愉乘区
  let stanceNum = 1
  let elationNum = 1
  if (game === "sr" && typeof ele === "string") {
    if (BREAK_ALL.has(ele)) {
      eleNum = masteryBasePct(ele, String(attr["element"] ?? ""), talent, erParams)
      stanceNum += attrValue(box(attr, "stance")) / 100
    } else if (ele === "elation") {
      eleNum += (6 * basicNum) / (basicNum + 200)
      elationNum += attrValue(box(attr, "elation")) / 100
    }
  }

  // 伤害基数：basic 模式不乘技能倍率
  let dmgBase = mode === "basic" ? basicNum * (1 + multiNum) + plusNum : atkNum * pctNum * (1 + multiNum) + plusNum

  const key = typeof ele === "string" ? ele : ""

  // 增幅反应：蒸发与融化
  if (key === "vaporize" || key === "melt") {
    return {
      dmg: dmgBase * dmgNum * (1 + cdmgNum) * defNum * kNum * eleBase * eleNum,
      avg: dmgBase * dmgNum * (1 + cpctNum * cdmgNum) * defNum * kNum * eleBase * eleNum
    }
  }

  // 剧变反应：不暴击，只有期望值
  if (FUSION_KINDS.has(key)) {
    const lvBase = baseDmgAt(ELE_BASE_DMG, level)
    return {
      avg: (lvBase * (1 + fypct) * eleBase * eleNum + fyplus) * kNum
    }
  }

  // 月反应与星反应：**基数由 `ele` 自己的 `num()` 按 `talent` 与叠层给**（见 meta.ts 的 ER_TYPE），
  // 本层不再按反应键查一张专属系数表 —— 查表那份挡不住「同一反应走技能与走 reaction() 两档不同基数」
  if (LUNAR_KINDS.has(key)) {
    const lunarBase = dmgBase || baseDmgAt(ELE_BASE_DMG, level)
    const body = lunarBase * (1 + fypct) * eleBase * eleNum + fyplus
    return {
      dmg: body * (1 + elevatedNum) * kNum * (1 + cdmgNum),
      avg: body * (1 + elevatedNum) * kNum * (1 + cpctNum * cdmgNum)
    }
  }

  // 结晶护盾
  if (key === "crystallize") {
    const shield = box(attr, "shield")
    eleBase *= baseDmgAt(CRY_BASE_DMG, level)
    return { avg: eleBase * (attrValue(shield) / 100) * (shield.inc / 100) }
  }

  // 激化反应：把反应基数加进伤害基数，而非乘上去
  if (key === "aggravate" || key === "spread") {
    eleBase *= baseDmgAt(ELE_BASE_DMG, level)
    dmgBase += eleBase * eleNum
    return {
      dmg: dmgBase * dmgNum * (1 + cdmgNum) * defNum * kNum,
      avg: dmgBase * dmgNum * (1 + cpctNum * cdmgNum) * defNum * kNum
    }
  }

  // 技能持续伤害：不暴击
  if (key === "skillDot") {
    return { avg: dmgBase * dmgNum * enemydmgNum * defNum * kNum * dmgReduceNum }
  }

  // 击破类伤害（含持续与附加）。**三项刻意未计入**：层数（风化、纠缠）、韧性条系数（击破、纠缠）、削韧值（超击破）——计入会改既有击破口径
  if (BREAK_ALL.has(key)) {
    const breakBase = baseDmgAt(BREAK_BASE_DMG, level)
    return { avg: breakBase * eleNum * stanceNum * enemydmgNum * defNum * kNum * dmgReduceNum }
  }

  // 欢愉伤害
  if (key === "elation") {
    const elation = (attr["elation"] ?? {}) as { merrymake?: number }
    const elationBase = baseDmgAt(ELATION_BASE_DMG, level) * (pctNum * (1 + multiNum) + plusNum)
    const merry = 1 + (Number(elation.merrymake) || 0) / 100 + dynamicMerrymake / 100
    const body = elationBase * elationNum * merry * eleNum * enemydmgNum * dmgReduceNum * defNum * kNum
    return { dmg: body * (1 + cdmgNum), avg: body * (1 + cpctNum * cdmgNum) }
  }

  // 常规伤害
  return {
    dmg: dmgBase * dmgNum * enemydmgNum * (1 + cdmgNum) * defNum * kNum * dmgReduceNum,
    avg: dmgBase * dmgNum * enemydmgNum * (1 + cpctNum * cdmgNum) * defNum * kNum * dmgReduceNum
  }
}

/** 公式里调用的伤害函数，带几个变体 */
export interface DmgFn {
  /**
   * 算一次伤害
   * @param pctNum 技能倍率
   * @param talent 天赋类型
   * @param ele 元素反应
   * @param basicNum 基础数值
   * @param mode 模式
   * @param dynamicData 动态加成
   * @returns 伤害结果
   */
  (
    pctNum?: number,
    talent?: string | false,
    ele?: string | false,
    basicNum?: number,
    mode?: string,
    dynamicData?: DynamicData | false,
    params?: Record<string, unknown> | false
  ): DmgResult
  /**
   * 按基础数值算，不乘技能倍率
   * @param basicNum 基础数值
   * @param talent 天赋类型
   * @param ele 元素反应
   * @param dynamicData 动态加成
   * @param params 反应参数，叠层数一类
   * @returns 伤害结果
   */
  basic: (
    basicNum?: number,
    talent?: string | false,
    ele?: string | false,
    dynamicData?: DynamicData | false,
    params?: Record<string, unknown> | false
  ) => DmgResult
  /**
   * 算欢愉伤害
   * @param pctNum 技能倍率
   * @param punchlineNum 笑点值
   * @param dynamicData 动态加成
   * @param params 反应参数
   * @returns 伤害结果
   */
  elation: (
    pctNum?: number,
    punchlineNum?: number,
    dynamicData?: DynamicData | false,
    params?: Record<string, unknown> | false
  ) => DmgResult
  /**
   * 算反应伤害
   *
   * **`params` 在第二位、`talent` 在第三位**，属既定形参次序。
   * @param ele 反应
   * @param params 反应参数，叠层数一类
   * @param talent 天赋类型，缺省 `fy`
   * @returns 伤害结果
   */
  reaction: (ele?: string | false, params?: Record<string, unknown> | false, talent?: string) => DmgResult
  /**
   * 带动态加成算伤害
   * @param pctNum 技能倍率
   * @param talent 天赋类型
   * @param dynamicData 动态加成
   * @param ele 元素反应
   * @param params 反应参数，叠层数一类
   * @returns 伤害结果
   */
  dynamic: (
    pctNum?: number,
    talent?: string | false,
    dynamicData?: DynamicData | false,
    ele?: string | false,
    params?: Record<string, unknown> | false
  ) => DmgResult
  /**
   * 算治疗量
   * @param n 治疗基数
   * @returns 治疗结果
   */
  heal: (n: number) => DmgResult
  /**
   * 算护盾量
   * @param n 护盾基数
   * @returns 护盾结果
   */
  shield: (n: number) => DmgResult
  /**
   * 算扩散伤害
   * @returns 伤害结果
   */
  swirl: () => DmgResult
}

/**
 * 造伤害函数
 *
 * **星铁的技能倍率在元数据里是小数**（0.8 而非 80），故此处乘 100 折成百分数，漏掉会让星铁全部伤害小两个数量级。
 * @param data 上下文
 * @returns 伤害函数
 */
export function getDmgFn(data: DmgCalcData): DmgFn {
  const { attr, game } = data

  const fn = ((
    pctNum = 0,
    talent: string | false = false,
    ele: string | false = false,
    basicNum = 0,
    mode = "talent",
    dynamicData: DynamicData | false = false,
    params: Record<string, unknown> | false = false
  ): DmgResult => {
    // 公式里可以写中文反应名，此处译回键
    const key = ele ? (ER_TITLE[String(ele)] ?? ele) : ele
    const pct = game === "sr" ? pctNum * 100 : pctNum
    return calcRet({ pctNum: pct, talent, ele: key, basicNum, mode, dynamicData, params }, data)
  }) as DmgFn

  fn.basic = (basicNum = 0, talent = false, ele = false, dynamicData = false, params = false) =>
    fn(0, talent, ele, basicNum, "basic", dynamicData, params)

  fn.elation = (pctNum = 0, punchlineNum = 0, dynamicData = false, params = false) =>
    fn(pctNum, "elation", "elation", punchlineNum, "elation", dynamicData, params)

  // `params` 在第二位：调错位置不报错，只让层数被当成天赋名、反应按缺省满层算
  fn.reaction = (ele = false, params = false, talent = "fy") => {
    let t = talent
    if (typeof ele === "string") {
      if (DOT_KINDS.has(ele)) t = "dot"
      else if (BREAK_TALENT_KINDS.has(ele)) t = "break"
    }
    return fn(0, t, ele, 0, "basic", false, params)
  }

  fn.dynamic = (pctNum = 0, talent = false, dynamicData = false, ele = false, params = false) =>
    fn(pctNum, talent, ele, 0, "talent", dynamicData, params)

  fn.heal = (n: number): DmgResult => {
    const heal = box(attr, "heal")
    return { avg: n * (1 + attrValue(heal) / 100 + heal.inc / 100) }
  }

  fn.shield = (n: number): DmgResult => {
    const shield = box(attr, "shield")
    return { avg: n * (attrValue(shield) / 100) * (shield.inc / 100) }
  }

  fn.swirl = () => fn(0, "fy", "swirl")

  return fn
}
