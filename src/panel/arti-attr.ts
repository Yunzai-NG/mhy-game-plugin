/**
 * 模块职责：圣遗物词条求值
 * 依赖方向：依赖 meta/arti（词条元数据）与 meta/arti-set（星铁的星级档位）；纯计算
 * 生命周期：无状态纯函数
 * 注意事项：数据源给的是**词条 id 而非数值**，本模块把 id 变成「键 + 值」；两游戏算法不同（原神主词条按等级/部位/星级系数、
 *          副词条按 id 累加，星铁按星级档位表的基数 + 步进）。**原神百分比词条要乘 100、固定值不乘**（元数据 `hp` 存 0.0583、
 *          `hpPlus` 存 253.94，判据 `format === "pct"`）—— 搞反会把「+5.83%」变「+0.0583%」，面板看不出而评分全错。
 *          `eff`（词条效率，按「相当于几个满档」算）是评分之外的量，只供画词条条、不参与评分，两者不可互换。
 */
import type { ArtiGame, ArtiMetaTable } from "../meta/arti.js"
import { isElemKey } from "../meta/arti.js"
import type { ArtiSetTable } from "../meta/arti-set.js"

/** 一条求值后的主词条 */
export interface MainAttr {
  /** 词条 id */
  id: string
  /** 词条键 */
  key: string
  /** 数值 */
  value: number
}

/** 一条求值后的副词条 */
export interface SubAttr {
  /** 词条键 */
  key: string
  /** 强化次数 */
  upNum: number
  /** 词条效率，按"相当于几个满档"算 */
  eff: number
  /** 数值 */
  value: number
}

/** 一件圣遗物求值后的词条 */
export interface ArtiAttrs {
  /** 主词条 */
  main?: MainAttr
  /** 副词条 */
  attrs: SubAttr[]
}

/** 数据源给出的一件圣遗物 */
export interface RawArti {
  /** 主词条 id */
  mainId?: string | number
  /** 副词条 id；原神是 id 数组，星铁是 `"id,档数,步进"` 形态的字符串数组 */
  attrIds?: (string | number | { id?: string | number; count?: number; step?: number })[]
  /** 强化等级 */
  level?: number
  /** 星级 */
  star?: number
}

/** 原神各星级的主词条系数 */
const GS_STAR_EFF: Readonly<Record<string, number>> = { "1": 0.21, "2": 0.36, "3": 0.6, "4": 0.9, "5": 1 }

/** 主词条取双倍系数的三个键：花的小生命与叶的小攻击即在此列 */
const GS_DOUBLE = ["hpPlus", "atkPlus", "defPlus"] as const

/**
 * 算原神一件圣遗物的主词条
 *
 * @param id 主词条 id
 * @param level 强化等级
 * @param star 星级
 * @param table 词条元数据表
 * @returns 主词条；id 查不到时 undefined
 */
export function gsMainAttr(
  id: string | number,
  level: number,
  star: number,
  table: ArtiMetaTable
): MainAttr | undefined {
  const key = table.mainById("gs", id)
  if (!key) return undefined
  const attrMap = table.meta("gs").attrMap
  // 元素伤害杯（风岩雷草水火冰）在词条元数据里没有各自的单档值，共用 dmg 那一条。**物理伤害杯是例外**：
  // 它有自己的单档值（满值 58.3%，元素杯 46.6%，正好差四分之一），故有专属条目就用专属、没有才按元素回落
  // dmg。漏掉这层会把物理杯当元素杯算，物理伤害面板少四分之一而不报错。
  const cfg = attrMap[key] ?? (isElemKey(key) ? attrMap["dmg"] : undefined)
  if (!cfg) return undefined
  const posEff = (GS_DOUBLE as readonly string[]).includes(key) ? 2 : 1
  const starEff = GS_STAR_EFF[String(star || 5)] ?? 1
  return {
    id: String(id),
    key,
    value: (Number(cfg.value) || 0) * (1.2 + 0.34 * (Number(level) || 0)) * posEff * starEff
  }
}

/**
 * 算原神一件圣遗物的副词条
 *
 * 同一个键出现多次即累加，`upNum` 记它被强化了几次。
 * @param ids 副词条 id
 * @param table 词条元数据表
 * @returns 副词条，顺序为首次出现的顺序
 */
export function gsSubAttrs(ids: readonly (string | number)[], table: ArtiMetaTable): SubAttr[] {
  const meta = table.meta("gs")
  const out: SubAttr[] = []
  const seen = new Map<string, SubAttr>()

  for (const id of ids) {
    const cfg = table.subById("gs", id)
    if (!cfg) continue
    const attrCfg = meta.attrMap[cfg.key]
    if (!attrCfg) continue

    let one = seen.get(cfg.key)
    if (!one) {
      one = { key: cfg.key, upNum: 0, eff: 0, value: 0 }
      seen.set(cfg.key, one)
      out.push(one)
    }
    // 百分比词条在元数据里存的是比例（0.0583），点数词条存的是点数（253.94）
    const scale = attrCfg.format === "pct" ? 100 : 1
    const single = Number(attrCfg.value) || 0
    one.value += cfg.value * scale
    one.upNum++
    if (single > 0) one.eff += (cfg.value / single) * scale
  }
  return out
}

/** 一条已解析的星铁副词条 id */
interface SrSubId {
  /** 词条 id */
  id: string
  /** 档数 */
  count: number
  /** 步进数 */
  step: number
}

/**
 * 解析星铁的副词条 id
 *
 * 数据源给两种形态：`"1,3,2"` 这样的逗号串（Mihomo / EnkaHSR / 鳄梨都拼成字符串），
 * 或已拆好的对象。**三段缺一不可**：只取 id 会丢掉档数与步进，值直接算成一个满档。
 * @param raw 原始 id
 * @returns 已解析的三段；形态不认得时 undefined
 */
function parseSrSub(raw: string | number | { id?: string | number; count?: number; step?: number }): SrSubId | undefined {
  if (typeof raw === "string") {
    const [id, count, step] = raw.split(",")
    if (!id) return undefined
    return { id, count: Number(count) || 0, step: Number(step) || 0 }
  }
  if (typeof raw === "number") return { id: String(raw), count: 0, step: 0 }
  if (raw.id === undefined || raw.id === "") return undefined
  return { id: String(raw.id), count: Number(raw.count) || 0, step: Number(raw.step) || 0 }
}

/**
 * 算星铁一件遗器的词条
 *
 * 主副词条的基数与步进按星级不同，故必须查星级档位表。
 * @param arti 数据源给出的遗器
 * @param idx 部位，1 起
 * @param sets 套装表，星级档位表在它那里
 * @returns 词条；档位表缺失或主词条查不到时 undefined
 */
export function srArtiAttrs(arti: RawArti, idx: number, sets: ArtiSetTable): ArtiAttrs | undefined {
  const meta = sets.srMeta("sr")
  if (!meta) return undefined

  const mainId = arti.mainId
  if (mainId === undefined || mainId === "") return undefined
  const mainKey = meta.mainIdx[String(idx)]?.[String(mainId)]
  const starCfg = meta.starData[String(arti.star ?? 5)]
  const mainCfg = mainKey ? starCfg?.main[mainKey] : undefined
  if (!mainKey || !starCfg || !mainCfg) return undefined

  const level = Number(arti.level) || 0
  const main: MainAttr = {
    id: String(mainId),
    key: mainKey,
    value: mainCfg.base + mainCfg.step * level
  }

  const attrs: SubAttr[] = []
  for (const raw of arti.attrIds ?? []) {
    const one = parseSrSub(raw)
    if (!one) continue

    const cfg = starCfg.sub[one.id]
    if (!cfg) continue
    const value = cfg.base * one.count + cfg.step * one.step
    attrs.push({
      key: cfg.key,
      upNum: one.count,
      // 满档即"基数 + 两个步进"
      eff: cfg.base + cfg.step * 2 > 0 ? value / (cfg.base + cfg.step * 2) : 0,
      value
    })
  }

  return { main, attrs }
}

/**
 * 算一件圣遗物的词条
 * @param arti 数据源给出的圣遗物
 * @param idx 部位，1 起；只有星铁用得到
 * @param game 游戏
 * @param table 词条元数据表
 * @param sets 套装表，星铁的星级档位表在它那里
 * @returns 词条；算不出时 undefined
 */
export function artiAttrs(
  arti: RawArti,
  idx: number,
  game: ArtiGame,
  table: ArtiMetaTable,
  sets: ArtiSetTable
): ArtiAttrs | undefined {
  if (game === "sr") return srArtiAttrs(arti, idx, sets)
  if (arti.mainId === undefined || arti.mainId === "") return undefined
  const main = gsMainAttr(arti.mainId, Number(arti.level) || 0, Number(arti.star) || 5, table)
  if (!main) return undefined
  const ids = (arti.attrIds ?? []).filter(
    (it): it is string | number => typeof it === "string" || typeof it === "number"
  )
  return { main, attrs: gsSubAttrs(ids, table) }
}
