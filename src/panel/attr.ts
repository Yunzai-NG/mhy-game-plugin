/**
 * 模块职责：面板属性计算
 * 依赖方向：依赖 panel/attr-data（累加器）、panel/level（等级插值）、meta/buffs（静态 buff）、
 *          meta/elem（元素折算）；元数据本体由调用方读好后传入，本模块不碰 IO
 * 生命周期：一次计算一次调用，无状态
 * 注意事项：四步顺序不能改：角色 → 武器 → 圣遗物词条 → 圣遗物套装 —— **白值必须在百分比之前落到 `base`**，否则「攻击 +N%」
 *          乘的是还没加武器攻击的白值，面板攻击少一大截且不报错。原神起手自带三项定值（充能 100%、暴击 5%、爆伤 50%），
 *          星铁没有（写在角色 `data.json` 里），给星铁也补会使暴击率凭空多 5%。两个自带元素精通的角色按 id 硬编码（译名会变，id 不会）。
 */
import { eachSetBuff, type BuffGame, type BuffTable, type SetStaticBuff } from "../meta/buffs.js"
import { isElem, sameElem } from "../meta/elem.js"
import { AttrData, type AttrResult } from "./attr-data.js"
import {
  fourthIsBase,
  gsCharLevelAttr,
  gsWeaponAttr,
  srLevelAttr,
  type GsCharAttr,
  type GsWeaponAttr,
  type SrLevelAttr
} from "./level.js"

/** 有面板属性计算的两个游戏 */
export type AttrGame = BuffGame

/** 原神起手自带的三项 */
const GS_INNATE: Readonly<Record<string, number>> = { recharge: 100, cpct: 5, cdmg: 50 }

/** 旅行者（空 / 荧）自带的固定加成，两个 id 共用 */
const TRAVELER_INNATE: Readonly<Record<string, number>> = {
  mastery: 15,
  hpBase: 50,
  atkBase: 7,
  cpct: 10,
  cdmg: 20,
  recharge: 20,
  hpPct: 20,
  atkPct: 20,
  defPct: 20
}

/**
 * 自带属性的几个角色，键为角色 id（译名会改，id 不会）
 *
 * `xxxPct` 结尾的项走百分比通道，见 {@link calcAttr}。
 */
const INNATE_BY_ID: Readonly<Record<string, Record<string, number>>> = {
  "10000119": { mastery: 200 },
  "10000122": { mastery: 100 },
  "10000005": TRAVELER_INNATE,
  "10000007": TRAVELER_INNATE
}

/** 会被当成"百分比"而非"固定值"的三项：命途加成与圣遗物词条里的 atk/hp/def 都是百分比 */
const PCT_KEYS = ["atk", "hp", "def"] as const

/** 原神里"异种元素伤害"的四个元素 */
const DIFF_ELEM = ["electro", "pyro", "hydro", "cryo"] as const

/** 一个角色的元数据，只列本模块用到的字段 */
export interface AttrChar {
  /** 角色 id */
  id: string
  /** 角色名，查自带静态 buff 用 */
  name: string
  /** 元素 / 命途 */
  elem?: string
  /** 武器类型（原神）或命途（星铁）；星铁只在光锥命途与它相符时才吃光锥 buff */
  weapon?: string
  /** 原神的等级属性段 */
  attr?: GsCharAttr
  /** 星铁的等级属性段 */
  srAttr?: SrLevelAttr
  /** 星铁的行迹加点表：行迹 id → 键与值 */
  tree?: Record<string, { key?: string; value?: number }>
}

/** 一把武器的元数据 */
export interface AttrWeaponMeta {
  /** 武器名，查静态 buff 用 */
  name: string
  /** 武器类型；星铁只在命途与角色相符时才吃武器 buff */
  type?: string
  /** 原神的属性段 */
  attr?: GsWeaponAttr
  /** 星铁的属性段 */
  srAttr?: SrLevelAttr
  /** 星铁的成长值 */
  growAttr?: Record<string, number>
  /**
   * 星铁的技能数值表：`idx` → 五个精炼的值
   *
   * 元数据里个别条目把数值写成了字符串，故值类型收两种；读的一方一律 `Number()` 一次。
   */
  tables?: Record<string, readonly (number | string)[]>
}

/** 面板上那把武器的实际状态 */
export interface AttrWeaponState {
  /** 等级 */
  level?: number
  /** 突破阶数 */
  promote?: number
  /** 精炼，1~5 */
  affix?: number
}

/** 一条圣遗物词条 */
export interface AttrArtiAttr {
  /** 词条键 */
  key?: string
  /** 数值 */
  value?: number
}

/** 一件圣遗物 */
export interface AttrArti {
  /** 主词条 */
  main?: AttrArtiAttr
  /** 副词条 */
  attrs?: AttrArtiAttr[]
}

/** 一次面板计算的输入 */
export interface AttrInput {
  /** 游戏 */
  game: AttrGame
  /** 角色元数据 */
  char: AttrChar
  /** 角色等级 */
  level: number
  /** 角色突破阶数 */
  promote: number
  /** 星铁的已激活行迹 id */
  trees?: string[]
  /** 武器元数据；没有武器时省略 */
  weapon?: AttrWeaponMeta
  /** 武器状态 */
  weaponState?: AttrWeaponState
  /** 逐件圣遗物 */
  artis?: AttrArti[]
  /** 已激活的套装：套装名 → 件数 */
  sets?: Record<string, number>
}

/** 一次面板计算的结果 */
export interface AttrCalcResult {
  /** 各项面板属性 */
  attr: AttrResult
  /** 白值表，圣遗物评分折算小词条时作分母 */
  base: Record<string, number>
}

/**
 * 算一个角色的面板属性
 *
 * 四步顺序见文件头。
 * @param input 输入
 * @param buffs 静态 buff 表
 * @returns 面板属性与白值表
 */
export function calcAttr(input: AttrInput, buffs: BuffTable): AttrCalcResult {
  const { game, char } = input
  const data = new AttrData(game, char.elem === undefined ? {} : { elem: char.elem })

  if (game === "gs") {
    for (const [key, val] of Object.entries(GS_INNATE)) data.addAttr(key, val, true)
    for (const [key, val] of Object.entries(INNATE_BY_ID[char.id] ?? {})) {
      // `xxxPct` 走百分比通道、其余走白值；当成固定值会把 20% 记成 20 点
      data.addAttr(key, val, !key.endsWith("Pct"))
    }
  }

  setCharAttr(data, input, buffs)
  setWeaponAttr(data, input, buffs)
  setArtisAttr(data, input, buffs)

  return { attr: data.getAttr(), base: data.getBase() }
}

/**
 * 写入角色自身的属性
 *
 * 原神走 `attr.details` 的线性 / 阶梯插值，星铁走 `attr[promote]` 加成长值再叠行迹。
 * @param data 累加器
 * @param input 输入
 * @param buffs 静态 buff 表
 */
function setCharAttr(data: AttrData, input: AttrInput, buffs: BuffTable): void {
  const { game, char, level, promote } = input

  if (game === "sr") {
    const lv = srLevelAttr(char.srAttr ?? {}, level, promote)
    for (const [key, val] of Object.entries(lv)) {
      // 星铁的四项主属性在元数据里是裸键，但那是白值，故补上 Base 后缀
      const k = (["hp", "atk", "def", "speed"] as readonly string[]).includes(key) ? `${key}Base` : key
      data.addAttr(k, val, true)
    }
    // 行迹：atk / hp / def 三项是百分比加成，其余是固定值
    for (const tid of input.trees ?? []) {
      // 面板源给的行迹 id 比元数据多一位前导 `1`（元数据 `1306201`，源给 `11306201`），故整串查不到时脱一位再查；
      // 少了这一步全部行迹加成静默丢失，而属性栏看着正常
      const cfg = char.tree?.[tid] ?? (tid.startsWith("1") ? char.tree?.[tid.slice(1)] : undefined)
      if (!cfg?.key) continue
      const k = (PCT_KEYS as readonly string[]).includes(cfg.key) ? `${cfg.key}Pct` : cfg.key
      data.addAttr(k, Number(cfg.value) || 0)
    }
    return
  }

  const lv = gsCharLevelAttr(char.attr ?? {}, level, promote)
  for (const [key, val] of Object.entries(lv)) {
    // 第四项是突破加成属性：生命 / 攻击 / 防御的百分比不算白值，其余算
    const isBase = key.endsWith("Base") || fourthIsBase(key)
    data.addAttr(key, val, isBase)
  }

  applyStaticBuffs(data, buffs.charBuff(game, char.name), char.elem)
}

/**
 * 写入武器属性
 * @param data 累加器
 * @param input 输入
 * @param buffs 静态 buff 表
 */
function setWeaponAttr(data: AttrData, input: AttrInput, buffs: BuffTable): void {
  const { game, char } = input
  const weapon = input.weapon
  if (!weapon?.name) return
  const state = input.weaponState ?? {}
  const level = Number(state.level) || 1
  const affix = Number(state.affix) || 1

  if (game === "sr") {
    const lv = srLevelAttr(weapon.srAttr ?? {}, level, Number(state.promote) || 0, weapon.growAttr)
    for (const [key, val] of Object.entries(lv)) {
      const k = (PCT_KEYS as readonly string[]).includes(key) ? `${key}Base` : key
      data.addAttr(k, val, true)
    }
    // 光锥的命途与角色不符时不给 buff，只给白值 —— 游戏内即是如此
    if (weapon.type && weapon.type !== char.elem && weapon.type !== charPath(char)) return
    for (const one of buffs.weaponBuff(game, weapon.name)) {
      if (!one.idx || !one.key) continue
      const val = weapon.tables?.[String(one.idx)]?.[affix - 1]
      if (val === undefined) continue
      data.addAttr(one.key, Number(val) || 0)
    }
    return
  }

  const got = gsWeaponAttr(weapon.attr ?? {}, level, state.promote ?? -1)
  data.addAttr("atkBase", got.atkBase)
  if (got.attr?.key) data.addAttr(got.attr.key, got.attr.value)

  for (const one of buffs.weaponBuff(game, weapon.name)) {
    for (const [key, steps] of Object.entries(one.refine ?? {})) {
      // 精炼下标从 0 起：精一取 steps[0]
      const val = steps[affix - 1]
      if (val === undefined) continue
      data.addAttr(key, Number(val) || 0)
    }
  }
}

/**
 * 取星铁角色的命途
 *
 * 元数据里角色的 `weapon` 字段即命途名；取不到时回落空串即「不校验命途」。
 * @param char 角色
 * @returns 命途名；取不到时空串
 */
function charPath(char: AttrChar): string {
  return (char as { weapon?: string }).weapon ?? ""
}

/**
 * 写入圣遗物的词条与套装加成
 * @param data 累加器
 * @param input 输入
 * @param buffs 静态 buff 表
 */
function setArtisAttr(data: AttrData, input: AttrInput, buffs: BuffTable): void {
  const { game, char } = input

  for (const arti of input.artis ?? []) {
    calcArtisAttr(data, arti.main, char, game)
    for (const ds of arti.attrs ?? []) calcArtisAttr(data, ds, char, game)
  }

  for (const { set, num } of eachSetBuff(input.sets ?? {})) {
    applyStaticBuffs(data, buffs.setBuff(game, set, num), char.elem)
  }
}

/**
 * 写入一批静态 buff
 *
 * 带 `elem` 的条目只对该元素的角色生效。
 * @param data 累加器
 * @param list 静态 buff
 * @param elem 角色元素
 */
function applyStaticBuffs(data: AttrData, list: readonly SetStaticBuff[], elem?: string): void {
  for (const one of list) {
    if (one.elem && !sameElem(elem ?? "", one.elem)) continue
    for (const [key, val] of Object.entries(one.data ?? {})) {
      data.addAttr(key, Number(val) || 0)
    }
  }
}

/**
 * 写入一条圣遗物词条
 *
 * 两处折算：与角色同元素的伤害加成记 `dmg`，四个可反应的异种元素记 `diffelem`（原神独有）。
 * `atk`/`hp`/`def` 是百分比要补 `Pct` 后缀 —— 漏掉会把「攻击 +46.6%」当成「+46.6」，面板几乎不变而不报错。
 * @param data 累加器
 * @param ds 词条
 * @param char 角色
 * @param game 游戏
 */
function calcArtisAttr(data: AttrData, ds: AttrArtiAttr | undefined, char: AttrChar, game: AttrGame): void {
  if (!ds?.key) return
  let key = ds.key

  if (game === "gs" && isElem(key, "gs")) {
    if (char.elem === key) key = "dmg"
    else if ((DIFF_ELEM as readonly string[]).includes(key)) key = "diffelem"
  }

  if ((PCT_KEYS as readonly string[]).includes(key)) key = `${key}Pct`
  data.addAttr(key, Number(ds.value) || 0)
}
