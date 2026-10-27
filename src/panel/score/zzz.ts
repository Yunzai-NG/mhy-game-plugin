/**
 * 模块职责：绝区零驱动盘评分 —— 挑一套权重，按权重给六件盘各打一分
 * 依赖方向：纯函数 + 一个只读 `meta-zzz/equip/artis-mark.js` 的表；不发请求
 * 生命周期：表随插件 setup 造一个实例并缓存；评分本身无状态
 * 注意事项：接口自带评分约半数为空或 `ER_Default`（等于没评），故自己算一份。权重先按职业给几套候选、再用当前面板试判据命中哪套，故新代理人上线不必等表更新（表只作覆盖纠正）。
 *          **百分比词条与数值词条的权重要按该代理人白值换算**（数值那三项由百分比按白值折算），写常数会让低白值代理人的数值词条被系统性低估。
 *          覆盖表是元数据里的纯数据、不内联；表里方案名须与方案表一致，对不上则那位的权重整个为空、六件盘全 0 分。
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseDataExport } from "../../meta/js-lit.js"
import { setDirOf } from "../../meta/set-dir.js"
import { markClassOf } from "./artis.js"
import { byWeightDesc } from "./pick.js"
import type { ZzzAvatarDetail, ZzzDisc } from "../profile/index.js"
import { ZZZ_PROF_ID } from "../profile/index.js"
import type { ZzzPropKey } from "../prop/zzz.js"
import { isPct, propValue, zzzPropKey, ZZZ_ELEM_DMG_ID } from "../prop/zzz.js"

/** 权重表：属性编号 → 权重，0~100 */
export type ZzzWeight = Readonly<Record<string, number>>

/**
 * 属性伤害加成在方案里的占位键
 *
 * 各代理人只有自己那一种伤害加成算有效词条，故声明时用占位，取权重时换成该代理人的编号。
 */
const DMG = "dmg"

/** 驱动盘副词条的十种编号 */
const SUB_IDS: readonly number[] = [11102, 11103, 12102, 12103, 13102, 13103, 20103, 21103, 23203, 31203]

/** 逐种副词条一次强化的数值，S 级口径 */
const SUB_BASE: Readonly<Record<string, number>> = {
  "11102": 3,
  "11103": 112,
  "12102": 3,
  "12103": 19,
  "13102": 4.8,
  "13103": 15,
  "20103": 2.4,
  "21103": 4.8,
  "23203": 9,
  "31203": 9
}

/** 逐部位可能出现的主词条；1~3 号位固定，故不参与主词条评分 */
const MAIN_IDS: Readonly<Record<string, readonly number[]>> = {
  "1": [11103],
  "2": [12103],
  "3": [13103],
  "4": [11102, 12102, 13102, 20103, 21103, 31203],
  "5": [11102, 12102, 13102, 23103, 31503, 31603, 31703, 31803, 32303, 31903],
  "6": [11102, 12102, 12202, 13102, 30502, 31402]
}

/** 稀有度对满分的折算 */
const RARITY_MUL: Readonly<Record<string, number>> = { S: 1, A: 2 / 3, B: 1 / 3 }

/** 数值词条的权重由百分比那一项折算：`[数值编号, 百分比编号, 白值键]` */
const FLAT_FROM_PCT: readonly [number, number, "hp" | "atk" | "def"][] = [
  [11103, 11102, "hp"],
  [12103, 12102, "atk"],
  [13103, 13102, "def"]
]

/** 一件盘的副词条满分占比：1~3 号位全部 55 分，4~6 号位主词条占 12、副词条占 43 */
const SUB_FULL = 43
/** 主词条满分 */
const MAIN_FULL = 12
/** 1~3 号位的满分 */
const FIXED_FULL = 55

/** 评分要的那一份代理人信息 */
export interface ZzzScoreInput {
  /** 代理人名，查覆盖表用 */
  name: string
  /** 职业编号 */
  prof: number
  /** 属性类型编号 */
  elem: number
  /** 当前面板的最终值，键为词条键；百分比按小数计（43.4% 记 0.434） */
  final: Readonly<Partial<Record<ZzzPropKey, number>>>
  /** 白值，折算数值词条的权重用 */
  base: { hp: number; atk: number; def: number }
  /**
   * 已装的套装名 → 件数，只列 ≥2 件的
   *
   * 下面四项都是判据入参面，与原神星铁那份 {@link CfgInput} 对等；都可选，缺一项时判据退回按面板值反推、不报错。
   */
  sets?: Readonly<Record<string, number>>
  /** 音擎名与叠影；没装音擎时省略 */
  weapon?: { name: string; star: number }
  /** 影画数 0~6。**它不在 `ZzzAvatarDetail` 上**（共用字段落在 `StoredAvatar.cons`），故要另传 */
  cons?: number
  /** 部位号 → 该件的主词条编号，只列装着的那几件 */
  mains?: Readonly<Record<string, number>>
}

/** 一套预设权重方案 */
interface Scheme {
  /** 判据：该代理人当前面板是否合用这一套 */
  fit: (one: ZzzScoreInput) => boolean
  /** 权重 */
  value: ZzzWeight
}

/**
 * 九套预设权重方案
 *
 * 键即方案名，印在图上。判据读当前面板最终值，故同一代理人换配装可能落到另一套方案（有意为之）。
 * **权重量纲是 0~100**，与原神星铁那两份 `artis-mark.js` 同口径；不做「最大值超 1 即百分制」的运行期嗅探（那有盲区）。
 */
const SCHEMES: Readonly<Record<string, Scheme>> = {
  "主C·双爆": {
    fit: one =>
      num(one.final.atk) > 2400 &&
      crit(one) >= 2.2 &&
      num(one.final.am) < 150 &&
      num(one.final.ap) < 200,
    value: { "12102": 75, "20103": 100, "21103": 100, "23103": 100, "23203": 25, [DMG]: 100 }
  },
  "主C·异常": {
    fit: one => {
      if (crit(one) >= 2) return false
      if (num(one.final.atk) < 2400) return false
      const am = num(one.final.am)
      const ap = num(one.final.ap)
      if (am >= 180 && ap >= 200) return true
      if (am >= 120 && ap >= 300) return true
      return am >= 150 && ap >= 250
    },
    value: { "12102": 75, "23103": 100, "23203": 25, "31203": 100, "31402": 100, [DMG]: 100 }
  },
  "命破·双爆": {
    fit: () => true,
    value: { "11102": 50, "12102": 25, "20103": 100, "21103": 100, [DMG]: 100 }
  },
  // 锋御那一族倍率基数是**防御力**而非攻击力：伤害是锐化伤害（见 dmg/zzz/calc.ts 的 isSharp），防御力才是主词条；
  // 暴伤权重压到 0.5 —— 锐化不吃暴伤而吃锐暴伤，面板那条暴伤只经核心被动折 0.35% 成暴击率，收益不到常规一半
  "锋御·双爆": {
    fit: () => true,
    value: { "13102": 100, "20103": 100, "21103": 50, "23103": 75, "23203": 25, [DMG]: 100 }
  },
  "辅助·双爆": {
    fit: one => crit(one) >= 1.5 && num(one.final.ap) < 200,
    value: { "12102": 75, "20103": 100, "21103": 100, "23103": 75, "23203": 25, "30502": 100, [DMG]: 100 }
  },
  "辅助·攻击": {
    fit: one => crit(one) >= 1.5,
    value: { "12102": 100, "20103": 100, "21103": 75, "23103": 75, "23203": 25, "30502": 100, [DMG]: 100 }
  },
  "辅助·异常": {
    fit: one => crit(one) < 2 && num(one.final.ap) >= 200,
    value: { "12102": 75, "23103": 75, "23203": 25, "30502": 100, "31203": 100, "31402": 100, [DMG]: 100 }
  },
  "冲击·双爆": {
    fit: one => crit(one) >= 1.5 && num(one.final.am) < 150 && num(one.final.ap) < 200,
    value: {
      "12102": 75,
      "12202": 100,
      "20103": 100,
      "21103": 100,
      "23103": 75,
      "23203": 25,
      "30502": 100,
      [DMG]: 100
    }
  },
  "冲击·攻击": {
    fit: one =>
      num(one.final.atk) > 2000 &&
      crit(one) >= 1 &&
      num(one.final.am) < 150 &&
      num(one.final.ap) < 200,
    value: {
      "12102": 100,
      "12202": 100,
      "20103": 100,
      "21103": 75,
      "23103": 75,
      "23203": 25,
      "30502": 100,
      [DMG]: 100
    }
  },
  "冲击·异常": {
    fit: one => crit(one) < 2 && (num(one.final.am) >= 150 || num(one.final.ap) >= 200),
    value: {
      "12102": 75,
      "12202": 100,
      "23103": 75,
      "23203": 25,
      "30502": 100,
      "31203": 100,
      "31402": 100,
      [DMG]: 100
    }
  }
}

/** 职业编号 → 候选方案，覆盖表里没有这一位时按它挑 */
const BY_PROF: Readonly<Record<string, readonly string[]>> = {
  "1": ["主C·双爆"],
  "2": ["冲击·双爆", "冲击·攻击", "冲击·异常"],
  "3": ["主C·异常", "辅助·异常"],
  "4": ["辅助·双爆", "辅助·异常"],
  "5": ["辅助·双爆", "辅助·异常"],
  "6": ["命破·双爆"],
  "7": ["锋御·双爆"]
}

/**
 * 覆盖表里词条名 → 属性编号；`dmg` / `属性伤害加成` 落到占位键
 *
 * **英文键与中文名两套都收**：英文键与 `meta-gs`/`meta-sr` 的 `artifact/artis-mark.js` 同一套写法（正路），
 * 也有表用中文名——丢掉这一套会让那些表里有专门权重的代理人静默落回按职业挑方案。键名取自 {@link ZzzPropKey}。
 */
const NAME_TO_ID: Readonly<Record<string, string>> = {
  // 英文键，与 meta-gs / meta-sr 同一套写法
  hp: "11102",
  atk: "12102",
  def: "13102",
  impact: "12202",
  cpct: "20103",
  cdmg: "21103",
  pen: "23103",
  penVal: "23203",
  er: "30502",
  ap: "31203",
  am: "31402",
  dmg: DMG,
  // 中文名那一套
  生命值百分比: "11102",
  生命值: "11103",
  攻击力百分比: "12102",
  攻击力: "12103",
  防御力百分比: "13102",
  防御力: "13103",
  冲击力: "12202",
  暴击率: "20103",
  暴击伤害: "21103",
  穿透率: "23103",
  穿透值: "23203",
  能量自动回复: "30502",
  异常精通: "31203",
  异常掌控: "31402",
  属性伤害加成: DMG
}

/**
 * 取一个可能缺失的数
 * @param one 值
 * @returns 数；缺失时 0
 */
function num(one: number | undefined): number {
  return Number.isFinite(one) ? (one as number) : 0
}

/**
 * 算双爆当量
 *
 * 一点暴击率与两点爆伤等价，故按 `暴击率 × 2 + 爆伤` 折算；两者都按小数计。
 * @param one 代理人信息
 * @returns 双爆当量
 */
function crit(one: ZzzScoreInput): number {
  return num(one.final.cpct) * 2 + num(one.final.cdmg)
}

/** 覆盖表里一位代理人的形态 */
export type ZzzScoreOverride =
  /** 只指定用哪几套预设方案，按序试判据 */
  | readonly string[]
  /** 指定方案再改几项 */
  | { rules: readonly string[]; [name: string]: unknown }
  /** 中文词条名 → 权重，整套自定 */
  | Readonly<Record<string, number>>

/**
 * 把词条名的权重表译成属性编号的
 *
 * `dmg` / `属性伤害加成` 落到该代理人自己那一种；认不出的名字跳过。**量纲就是 0~100，不再猜**
 * （{@link SCHEMES} 与 `meta-zzz/equip/artis-mark.js` 两处一律 0~100，与原神星铁同口径）。
 * @param one 词条名 → 权重，0~100
 * @param elem 属性类型编号
 * @returns 属性编号 → 权重，0~100
 */
function byName(one: Readonly<Record<string, unknown>>, elem: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [name, value] of Object.entries(one)) {
    if (name === "rules") continue
    const weight = Number(value)
    if (!Number.isFinite(weight)) continue
    const id = NAME_TO_ID[name] ?? (/^\d+$/.test(name) ? name : undefined)
    if (!id) continue
    out[id] = weight
  }
  return resolveDmg(out, elem)
}

/**
 * 把占位的属性伤害加成键换成该代理人自己那一种
 * @param one 权重
 * @param elem 属性类型编号
 * @returns 换好的权重；该属性没有对应的伤害加成编号时丢掉这一项
 */
function resolveDmg(one: Record<string, number>, elem: number): Record<string, number> {
  const value = one[DMG]
  if (value === undefined) return one
  const { [DMG]: _drop, ...rest } = one
  const id = ZZZ_ELEM_DMG_ID[String(elem)]
  if (id) rest[String(id)] = value
  return rest
}

/**
 * 按几套候选方案挑一套
 *
 * 只有一套候选时直接用它（不试判据 —— 覆盖表指名一套即是「就按这套评」）；多套时按序试判据，
 * 都不命中时用第一套存在的那一套兜底。
 * @param names 候选方案名
 * @param one 代理人信息
 * @returns 方案名与权重；一套都不存在时权重为空
 */
function pickScheme(names: readonly string[], one: ZzzScoreInput): { rule: string; weight: Record<string, number> } {
  if (names.length === 1) {
    const only = names[0] ?? ""
    const got = SCHEMES[only]
    return { rule: only, weight: got ? resolveDmg({ ...got.value }, one.elem) : {} }
  }
  for (const name of names) {
    const got = SCHEMES[name]
    if (got?.fit(one)) return { rule: name, weight: resolveDmg({ ...got.value }, one.elem) }
  }
  for (const name of names) {
    const got = SCHEMES[name]
    if (got) return { rule: name, weight: resolveDmg({ ...got.value }, one.elem) }
  }
  return { rule: "默认", weight: {} }
}

/**
 * 定出一位代理人的权重
 *
 * 次序：覆盖表 → 职业候选 → 空。覆盖表里给 `{}` 的那两位是主角（哲/铃）**不给评分**（配装取向随主线选择变）。
 * @param one 代理人信息
 * @param override 覆盖表里这一位的条目
 * @returns 方案名与权重
 */
export function zzzScoreWeight(
  one: ZzzScoreInput,
  override?: ZzzScoreOverride
): { rule: string; weight: Record<string, number> } {
  let rule = "默认"
  let weight: Record<string, number> = {}

  if (Array.isArray(override)) {
    const got = pickScheme(override as readonly string[], one)
    rule = got.rule
    weight = got.weight
  } else if (override && typeof override === "object") {
    const table = override as { rules?: readonly string[] } & Record<string, unknown>
    if (Array.isArray(table.rules)) {
      const got = pickScheme(table.rules, one)
      rule = got.rule
      weight = got.weight
      // 指定方案之外还改了几项：并进去并在方案名后加个记号
      const extra = byName(table, one.elem)
      if (Object.keys(extra).length > 0) {
        rule = `${rule}·改`
        weight = { ...weight, ...extra }
      }
    } else {
      // 整张表自己写权重，与原神星铁那两份 `artis-mark.js` 同形（meta-zzz 里逐位一行的常态）
      weight = byName(table, one.elem)
      if (Object.keys(weight).length > 0) rule = "自定"
    }
  } else {
    const got = pickScheme(BY_PROF[String(one.prof)] ?? [], one)
    rule = got.rule
    weight = got.weight
  }

  return { rule, weight: flatWeights(weight, one.base) }
}

/**
 * 按白值补出数值词条的权重
 *
 * 百分比那三项有权重而数值那三项没写时按「一次强化各值多少」折算（一次攻击力百分比是白值的 3%、一次攻击力数值固定 19 点，孰优取决于白值）。
 * @param weight 权重
 * @param base 白值
 * @returns 补好的权重
 */
function flatWeights(weight: Record<string, number>, base: ZzzScoreInput["base"]): Record<string, number> {
  const out = { ...weight }
  for (const [flat, pct, key] of FLAT_FROM_PCT) {
    const pctWeight = out[String(pct)]
    if (!pctWeight) continue
    if (out[String(flat)] !== undefined) continue
    const white = num(base[key])
    if (white <= 0) continue
    const flatBase = SUB_BASE[String(flat)] ?? 0
    const pctBase = SUB_BASE[String(pct)] ?? 0
    if (pctBase <= 0) continue
    out[String(flat)] = Number(((flatBase * 100) / (pctBase * white) * pctWeight).toFixed(2))
  }
  return out
}

/**
 * 把按属性编号索引的权重折成按词条键索引的
 *
 * 出图那一路要这一份（模板按 `charWeight[attr.key]` 取配色，`attr.key` 是词条键 `cpct`）；计分那份按属性编号（`20103`），是同一套权重的两种键空间。
 * **一个词条键会对上多个编号**（`11102` 与 `11103` 都是 `hp`），取高的那份（取低会把有用词条画成灰的）。**两侧量纲相同，只换键不换数**（都 0~100，模板 `> 79.9` 门槛按百分制写）。
 * @param weight 按属性编号索引的权重，0~100
 * @returns 按词条键索引的权重，0~100
 */
function keyWeightsOf(weight: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, value] of Object.entries(weight)) {
    const key = zzzPropKey(id)
    if (!key) continue
    const scaled = Number(value.toFixed(2))
    // 同一个键对上多个编号时取高的那一份
    if ((out[key] ?? 0) >= scaled) continue
    out[key] = scaled
  }
  return out
}

/**
 * 给一件驱动盘打分
 *
 * 分主副两截：1~3 号位主词条固定（三围数值），整 55 分全看副词条并给「起评分」（全不对路的盘仍算一件、给 0 会让一件跑偏就整份垮）；4~6 号位主 12 分 + 副 43 分。
 * 等级与稀有度按倍率折算：+0 的盘 0.25 倍、+15 是 1 倍；A 级 2/3、B 级 1/3。
 * @param disc 驱动盘
 * @param weight 权重
 * @returns 分数
 */
export function scoreOneDisc(disc: ZzzDisc, weight: ZzzWeight): number {
  const levelMul = 0.25 + disc.level * 0.05 || 1
  const rarityMul = RARITY_MUL[disc.rank] ?? 1
  const mainId = disc.main?.id ?? 0

  // 理论上限：权重最高那条按满六次算、另三条各一次。次序（含并列取舍）走 pick.ts，与原神星铁同一副
  const best = byWeightDesc(
    SUB_IDS.filter(id => id !== mainId && weight[String(id)]),
    id => weight[String(id)] ?? 0
  ).slice(0, 4)
  if (best.length === 0) return 0
  let max = (weight[String(best[0])] ?? 0) * 6
  for (const id of best.slice(1)) max += weight[String(id)] ?? 0
  if (max <= 0) return 0

  let actual = 0
  for (const sub of disc.subs) actual += (weight[String(sub.id)] ?? 0) * sub.rolls

  if (disc.pos <= 3) {
    const min = MAIN_FULL * levelMul * rarityMul
    if (actual === 0) return min
    return Math.max((actual / max) * levelMul * rarityMul * FIXED_FULL, min)
  }

  // 同上：次序走 pick.ts。挑「这个部位理论上最好的主词条」，4~6 号位候选里并列极常见
  const mainBest = byWeightDesc(
    (MAIN_IDS[String(disc.pos)] ?? []).filter(id => weight[String(id)]),
    id => weight[String(id)] ?? 0
  )[0]
  const mainScore = mainBest
    ? (MAIN_FULL * (weight[String(mainId)] ?? 0)) / (weight[String(mainBest)] ?? 1)
    : MAIN_FULL
  const subScore = (actual / max) * SUB_FULL
  return (mainScore + subScore) * levelMul * rarityMul
}

/** 一件驱动盘得分的拆解，`#<代理人>驱动盘` 那张表逐列印它 */
export interface ZzzDiscBreakdown {
  /** 部位号 */
  pos: number
  /** 主词条那截的分；1~3 号位没有，给 undefined */
  main?: number
  /** 副词条那截的分（1~3 号位即整件未乘倍率的分） */
  sub: number
  /** 等级倍率 */
  levelMul: number
  /** 稀有度倍率 */
  rarityMul: number
  /** 最终得分，与 {@link scoreOneDisc} 同一个数 */
  total: number
}

/**
 * 把一件驱动盘的得分拆成主词条、副词条与两道倍率
 *
 * 与 {@link scoreOneDisc} 同一套算法逐步写出，**两处要同改**：这里改了而那边没改，表里逐列相乘就对不上最终分。
 * @param disc 驱动盘
 * @param weight 权重
 * @returns 拆解
 */
export function discBreakdown(disc: ZzzDisc, weight: ZzzWeight): ZzzDiscBreakdown {
  const levelMul = 0.25 + disc.level * 0.05 || 1
  const rarityMul = RARITY_MUL[disc.rank] ?? 1
  const total = scoreOneDisc(disc, weight)
  const mainId = disc.main?.id ?? 0
  const best = byWeightDesc(
    SUB_IDS.filter(id => id !== mainId && weight[String(id)]),
    id => weight[String(id)] ?? 0
  ).slice(0, 4)
  let max = (weight[String(best[0])] ?? 0) * 6
  for (const id of best.slice(1)) max += weight[String(id)] ?? 0
  let actual = 0
  for (const sub of disc.subs) actual += (weight[String(sub.id)] ?? 0) * sub.rolls
  const ratio = max > 0 ? actual / max : 0
  if (disc.pos <= 3) return { pos: disc.pos, sub: ratio * FIXED_FULL, levelMul, rarityMul, total }
  const mainBest = byWeightDesc(
    (MAIN_IDS[String(disc.pos)] ?? []).filter(id => weight[String(id)]),
    id => weight[String(id)] ?? 0
  )[0]
  const main = mainBest ? (MAIN_FULL * (weight[String(mainId)] ?? 0)) / (weight[String(mainBest)] ?? 1) : MAIN_FULL
  return { pos: disc.pos, main, sub: ratio * SUB_FULL, levelMul, rarityMul, total }
}

/** 一次整套评分的结果 */
export interface ZzzScoreResult {
  /** 六件合计 */
  score: number
  /** 档位，按每件平均分取 —— 与原神星铁那一路同一张档位表 */
  markClass: string
  /** 用了哪一套权重 */
  rule: string
  /** 部位号 → 该件的分 */
  byPos: Record<string, number>
  /** 属性编号 → 权重，0~100；**计分用的那一份**，键与驱动盘词条的 `id` 同一套 */
  weight: Record<string, number>
  /**
   * 词条键 → 权重，0~100；**出图用的那一份**
   *
   * 与 {@link weight} 是同一套权重的两种键空间、量纲相同、只换键不换数。少了这份折算，模板里 `charWeight[key]` 恒 undefined ——
   * 每条副词条落 `nouse` 被 css 灰掉、属性栏那列整列不画，而两处都不报错。
   */
  keyWeight: Record<string, number>
}

/**
 * 给一整套驱动盘评分
 *
 * 档位按**每件平均分**取，与原神星铁一致（见 `markAll`）—— 六件合计量纲不同，直接套档位表会让所有人都是 MAX。
 * @param discs 驱动盘
 * @param one 代理人信息
 * @param override 覆盖表里这一位的条目
 * @returns 评分结果
 */
export function scoreDiscs(
  discs: readonly ZzzDisc[],
  one: ZzzScoreInput,
  override?: ZzzScoreOverride
): ZzzScoreResult {
  const { rule, weight } = zzzScoreWeight(one, override)
  const byPos: Record<string, number> = {}
  let score = 0
  for (const disc of discs) {
    const got = scoreOneDisc(disc, weight)
    byPos[String(disc.pos)] = got
    score += got
  }
  // 除以固定的 6 而不是实际件数：少装一件本身就该扣分，按实际件数平均等于不扣
  return { score, markClass: markClassOf(score / 6), rule, byPos, weight, keyWeight: keyWeightsOf(weight) }
}

/**
 * 从存下来的面板里取出评分要的那几项
 *
 * **百分比一律折成小数**（43.4% 记 0.434）：判据写的是 `暴击率 × 2 + 爆伤 >= 2.2`，按原数比会让每位都命中第一套。白值取 `base`，未装驱动盘那几行只给 `final` 故以它兜底。
 * **套装、音擎与逐位主词条一并交出**（在驱动盘与音擎上现成）；**套装件数按实际装着的数**、不取接口 `own`（那是名下总数，用它会把「攒够四件只装两件」判成四件套）。
 * **影画数要调用方给**（三游戏共用字段落在 `StoredAvatar.cons`），缺它时判据退回按面板值反推、不报错。
 * @param detail 存下来的绝区零面板
 * @param cons 影画数 0~6，取自 `StoredAvatar.cons`
 * @returns 评分入参
 */
export function zzzScoreInput(detail: ZzzAvatarDetail, cons?: number): ZzzScoreInput {
  const final: Partial<Record<ZzzPropKey, number>> = {}
  const base: Record<string, number> = {}
  for (const attr of detail.attrs) {
    if (!attr.key) continue
    const pct = isPct(attr.final)
    final[attr.key] = pct ? propValue(attr.final) / 100 : propValue(attr.final)
    base[attr.key] = propValue(attr.base || attr.final)
  }

  // 逐套数实际装着的件数，同时记下逐位主词条
  const count = new Map<string, number>()
  const mains: Record<string, number> = {}
  for (const disc of detail.discs) {
    if (disc.set) count.set(disc.set, (count.get(disc.set) ?? 0) + 1)
    if (disc.main?.id) mains[String(disc.pos)] = disc.main.id
  }
  const sets: Record<string, number> = {}
  for (const [name, own] of count) {
    // 只列成套的：一件不成套，列它只会让判据里的「装了这套没有」多一层判断
    if (own >= 2) sets[name] = own
  }

  return {
    name: detail.name,
    prof: ZZZ_PROF_ID[detail.prof ?? ""] ?? 0,
    elem: detail.elemId ?? 0,
    final,
    base: { hp: base["hp"] ?? 0, atk: base["atk"] ?? 0, def: base["def"] ?? 0 },
    ...(Object.keys(sets).length > 0 ? { sets } : {}),
    ...(detail.weapon ? { weapon: { name: detail.weapon.name, star: detail.weapon.star } } : {}),
    ...(cons !== undefined ? { cons } : {}),
    ...(Object.keys(mains).length > 0 ? { mains } : {})
  }
}

/** 造覆盖表需要的东西 */
export interface ZzzScoreTableOptions {
  /** 元数据根目录，与安装器的 `dir` 一致；覆盖表在 `meta-zzz/equip/artis-mark.js` 的 `usefulAttr`，评分算法仍在代码 */
  metaDir: string
  /**
   * 把一个代理人名归一到元数据里的正式名
   *
   * **不给的话覆盖表会有一半查不中**：接口的 `name_mi18n` 是短名（`雅`），覆盖表写正式名（`星见雅`），直接比会静默落回按职业挑方案。通常是 `name => loader.byName("zzz", name)?.name`。
   */
  canonical?: (name: string) => string | undefined
}

/**
 * 驱动盘评分的权重覆盖表
 *
 * 读 `meta-zzz/equip/artis-mark.js`，键为代理人名。
 * **缺了或写坏了不抛错**（那时逐位走职业候选、分数仍算得出，只是几位按生命值成长的代理人会被低估）。
 */
export class ZzzScoreTable {
  readonly #metaDir: string
  readonly #canonical: ((name: string) => string | undefined) | undefined
  #table: Map<string, ZzzScoreOverride> | undefined

  /**
   * @param opts 选项
   */
  constructor(opts: ZzzScoreTableOptions) {
    this.#metaDir = opts.metaDir
    this.#canonical = opts.canonical
  }

  /**
   * 丢掉已装载的缓存，元数据更新后调用
   *
   * 覆盖表优先读 `meta-zzz/equip/artis-mark.js`，更新完不重读就表现为「新代理人的评分权重仍是旧的」。
   */
  reload(): void {
    this.#table = undefined
  }

  /**
   * 装载覆盖表，只读一次
   *
   * 键同时按原名与归一后的名字各存一份：归一函数可能取不到（元数据不在位），那时原名仍要能查中。
   * @returns 名字 → 覆盖
   */
  #load(): Map<string, ZzzScoreOverride> {
    if (this.#table) return this.#table
    const out = new Map<string, ZzzScoreOverride>()
    const raw = this.#readMeta() ?? {}
    for (const [name, value] of Object.entries(raw)) {
      out.set(name, value)
      const fixed = this.#canonical?.(name)
      if (fixed && fixed !== name) out.set(fixed, value)
    }
    this.#table = out
    return out
  }

  /**
   * 读元数据里那份 `equip/artis-mark.js` 的 `usefulAttr` 导出
   * @returns 覆盖表；文件不在、未配 metaDir 或解不出内容时 undefined
   */
  #readMeta(): Record<string, ZzzScoreOverride> | undefined {
    const file = join(this.#metaDir, "meta-zzz", setDirOf("zzz"), "artis-mark.js")
    if (!existsSync(file)) return undefined
    let src = ""
    try {
      src = readFileSync(file, "utf8")
    } catch {
      return undefined
    }
    const got = parseDataExport<Record<string, ZzzScoreOverride>>(src, "usefulAttr")
    return got && Object.keys(got).length > 0 ? got : undefined
  }

  /**
   * 查一位代理人的权重覆盖
   * @param name 代理人名，接口给的短名即可
   * @returns 覆盖；表里没有这一位时 undefined
   */
  override(name: string): ZzzScoreOverride | undefined {
    const table = this.#load()
    const got = table.get(name)
    if (got) return got
    const fixed = this.#canonical?.(name)
    return fixed ? table.get(fixed) : undefined
  }

  /**
   * 给一整套驱动盘评分
   * @param discs 驱动盘
   * @param one 代理人信息
   * @returns 评分结果
   */
  score(discs: readonly ZzzDisc[], one: ZzzScoreInput): ZzzScoreResult {
    return scoreDiscs(discs, one, this.override(one.name))
  }
}
