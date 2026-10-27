/**
 * 模块职责：圣遗物评分
 * 依赖方向：依赖 meta/arti（词条元数据与默认权重表）；纯函数，不碰 IO
 * 生命周期：无状态
 * 注意事项：评分不需要沙箱（通用权重表与词条元数据都是纯数据、已离线转 JSON），只有 69 个角色的自定义权重规则（`artis.js`）是代码、由沙箱可选提供、缺失回落默认。
 *          几处公式看着奇怪但不能动，改动则整套评分偏移：主词条评分除以 4；位置总分按 `(1+fixPct)/2/pMax*66` 归一（66 是定值）；小词条权重取自其大词条、攻击力另加 520 基数。
 */
import type { ArtiGame, ArtiMetaTable, AttrMeta, AttrWeight } from "../../meta/arti.js"
import { isElemKey } from "../../meta/arti.js"
import { isElem } from "../../meta/elem.js"
import { byWeightDesc } from "./pick.js"

/** 一条已格式化的词条 */
export interface MarkedAttr {
  /** 词条键 */
  key: string
  /** 展示值 */
  value: string
  /** 原始数值 */
  num: number
  /** 该词条得分，展示用 */
  mark: string
  /** 该词条得分，参与计算 */
  _mark: number
}

/** 一件圣遗物的输入形态 */
export interface ArtiInput {
  /** 名称 */
  name?: string
  /** 套装名 */
  set?: string
  /** 等级 */
  level?: number
  /** 主词条 */
  main?: { key?: string; value?: number }
  /** 副词条 */
  attrs?: { key?: string; value?: number }[]
}

/** 评分用到的角色信息 */
export interface MarkChar {
  /** 角色 id */
  id: string
  /** 全名 */
  name: string
  /** 简称 */
  abbr: string
  /** 元素 / 命途 */
  elem?: string
  /** 白值，小词条折算成大词条时作分母 */
  baseAttr?: { hp?: number; atk?: number; def?: number }
}

/** 评分用到的武器信息 */
export interface MarkWeapon {
  /** 武器名 */
  name?: string
  /** 精炼，1~5 */
  affix?: number
  /**
   * 武器副属性的词条键（`cdmg` / `recharge` / `atkPct` 一类），取自武器 `data.json` 的 `attr.bonusKey`
   *
   * 自定义评分规则会按它分档（爱可菲那份判「副属性是不是充能」来定纯辅阈值 200 还是 220）。
   * 不给则那些判定恒为假、评分静默退回另一档，图上看不出差别。
   */
  bonusKey?: string
}

/**
 * 自定义规则里的圣遗物判定
 *
 * 两种用法都是判错而不报错那一类：`artis.is("绝缘4")` 判套装（简称全名都认、只分二件四件两档），
 * `artis.is("cpct,cdmg,def", 5)` 判指定位置主词条（多位置须全满足），`artis.names` 是已成套的套装全名。
 */
export interface MarkArtis {
  /** 判套装（不传位置）或判该位置的主词条（传位置） */
  is: (check: string, pos?: string | number) => boolean
  /** 已成套（两件及以上）的套装全名 */
  names: string[]
}

/**
 * 角色自定义权重规则
 *
 * 即元数据里 `character/<名>/artis.js` 的 `export default`，是代码、只能由沙箱提供；命令层不开伤害计算时为空、回落默认权重表。
 * **入参要给足**：少给一项不会被类型挡住（那些文件不经本仓库编译），求值时抛 `Cannot read properties of undefined`，
 * 而这一步在装配面板中途，于是**整条命令连一张图都出不来**，日志只有一行看不出角色的 TypeError。
 */
export type CharRule = (arg: {
  /** 当前面板属性 */
  attr: Record<string, number>
  /** 元素 */
  elem: string
  /** 命座 */
  cons: number
  /** 武器 */
  weapon: MarkWeapon
  /** 圣遗物套装与主词条判定 */
  artis: MarkArtis
  /** 指定一套权重并给它起个名字 */
  rule: (title: string, weight: AttrWeight) => { title: string; attrWeight: AttrWeight }
  /**
   * 走默认流程，仅覆盖部分权重
   *
   * 第二参收自定义规则已攒好的标题段（`def(particularAttr, title)`，元数据里七十个 `artis.js` 都这么写）；不收它则那些标题整条丢失。
   */
  def: (weight?: AttrWeight, title?: string[]) => { title: string; attrWeight: AttrWeight }
}) => { title: string; attrWeight: AttrWeight }

/**
 * 几件会改变权重取向的武器
 *
 * 拿护摩的胡桃该看生命值，拿薙刀的雷神该看充能，故这几件武器在身上时权重另有一档。
 */
const WEAPON_CFG: Readonly<Record<string, { attr: string; abbr?: string; max?: number; min?: number }>> = {
  磐岩结绿: { attr: "hp", abbr: "绿剑", max: 30, min: 15 },
  猎人之径: { attr: "mastery" },
  薙草之稻光: { attr: "recharge", abbr: "薙刀" },
  护摩之杖: { attr: "hp", abbr: "护摩", max: 18, min: 10 }
}

/** 评分档位与其上界 */
const SCORE_MAP: readonly [string, number][] = [
  ["D", 7],
  ["C", 14],
  ["B", 21],
  ["A", 28],
  ["S", 35],
  ["SS", 42],
  ["SSS", 49],
  ["ACE", 56],
  ["MAX", 70]
]

/** 白值缺失时的兜底 */
const DEFAULT_BASE: Readonly<Record<string, number>> = { hp: 14_000, atk: 230, def: 700 }

/** 攻击力的小词条折算时另加的基数 */
const ATK_PLUS_BASE = 520

/** 元素伤害主词条所在的位置：原神在杯（4），星铁在球（5） */
const DMG_POS: Readonly<Record<ArtiGame, number>> = { gs: 4, sr: 5 }

/**
 * 取评分档位
 * @param mark 分数
 * @returns 档位名，如 `S`；超出最高档时为 `MAX`
 */
export function markClassOf(mark: number): string {
  for (const [name, max] of SCORE_MAP) {
    if (mark < max) return name
  }
  return "MAX"
}

/** 一个词条在评分体系里的算好的系数 */
export interface AttrCoef extends AttrMeta {
  /** 该词条的权重，0~100 */
  weight: number
  /** 折算成同一量纲后的权重，用于挑"最优词条" */
  fixWeight: number
  /** 每一点该词条值得多少分 */
  mark: number
}

/** 一个角色的评分配置 */
export interface MarkCfg {
  /** 各词条的系数 */
  attrs: Record<string, AttrCoef>
  /** 权重方案名，如 `胡桃-护摩` */
  classTitle: string
  /** 各位置的满分参照 */
  posMaxMark: Record<string, number>
}

/**
 * 从若干候选里挑权重最高的几个
 *
 * **并列时取候选列表里靠后的那个**，次序（含并列取舍）由 pick.ts 一处给出，理由见其文件头（改动会让整套评分偏移）。
 * @param attrs 词条系数
 * @param list 候选词条键
 * @param maxLen 最多取几个
 * @param ban 排除的词条键
 * @returns 词条键，权重降序；并列者按候选列表逆序
 */
function maxAttrs(attrs: Record<string, AttrCoef>, list: readonly string[], maxLen = 1, ban = ""): string[] {
  const tmp: { attr: string; mark: number }[] = []
  for (const attr of list) {
    if (attr === ban) continue
    const one = attrs[attr]
    if (!one) continue
    tmp.push({ attr, mark: one.fixWeight })
  }
  // 次序（含并列取舍）由 pick.ts 一处给出，三个游戏共用；理由见上方说明与那个文件的文件头
  return byWeightDesc(tmp, it => it.mark)
    .slice(0, maxLen)
    .map(it => it.attr)
}

/**
 * 算各位置的满分参照
 *
 * 满分即「这个位置理论上最好的一件」：主词条取权重最高候选，副词条取最高四条、**第一条按六倍计**（对应满级单条最多的强化档数）。
 * @param attrs 词条系数
 * @param meta 词条元数据
 * @param game 游戏
 * @returns 位置 → 满分；另有 `m<位置>` 为该位置主词条的满分
 */
export function maxMarks(attrs: Record<string, AttrCoef>, meta: { mainAttr: Record<string, string[]>; subAttr: string[] }, game: ArtiGame): Record<string, number> {
  const out: Record<string, number> = {}
  const last = game === "gs" ? 5 : 6

  for (let idx = 1; idx <= last; idx++) {
    let total = 0
    let mMark = 0
    let mAttr = ""

    if (idx === 1) {
      // 花恒为小生命，叶恒为小攻击，两者没有主词条可挑
      mAttr = "hpPlus"
    } else if (idx === 2) {
      mAttr = "atkPlus"
    } else {
      const candidates = maxAttrs(attrs, meta.mainAttr[String(idx)] ?? [])
      const first = candidates[0]
      if (first) {
        mAttr = first
        mMark = attrs[first]?.fixWeight ?? 0
        total += mMark * 2
      } else {
        mAttr = meta.mainAttr[String(idx)]?.[0] ?? ""
      }
    }

    const subs = maxAttrs(attrs, meta.subAttr, 4, mAttr)
    subs.forEach((attr, at) => {
      total += (attrs[attr]?.fixWeight ?? 0) * (at === 0 ? 6 : 1)
    })
    out[String(idx)] = total
    out[`m${idx}`] = mMark
  }
  return out
}

/**
 * 算一件圣遗物的得分
 * @param arg 参数
 * @returns 得分
 */
export function markOne(arg: {
  /** 角色 */
  char: MarkChar
  /** 评分配置 */
  cfg: MarkCfg
  /** 位置，1 起 */
  idx: number
  /** 该件圣遗物 */
  arti: ArtiInput
  /** 角色元素 */
  elem?: string
  /** 游戏 */
  game: ArtiGame
}): number {
  const { char, cfg, idx, arti, game } = arg
  const key = arti.main?.key
  if (!key) return 0

  const { attrs, posMaxMark } = cfg
  let elem = arg.elem ?? ""
  let ret = 0
  let fixPct = 1

  // 前两个位置的主词条固定（花小生命、叶小攻击），不参与评分；三以后才算
  if (idx >= 3) {
    let mainKey = key
    // 充能沙漏单独放过：它的权重不按"主词条契合度"打折
    if (key !== "recharge") {
      // 该 id 特判：其元素伤害要按主词条自身的元素算
      if (char.id === "10000128" && isElemKey(key)) elem = key
      if (idx === DMG_POS[game] && elem && elem === key) mainKey = "dmg"
      const mMax = posMaxMark[`m${idx}`] ?? 0
      const weight = attrs[mainKey]?.weight ?? 0
      fixPct = mMax > 0 ? Math.max(0, Math.min(1, weight / mMax)) : 1
      // 原神：攻击 / 生命 / 防御主词条的权重够高时不打折
      if (game === "gs" && ["atk", "hp", "def"].includes(mainKey) && weight >= 75) fixPct = 1
    }
    // 主词条按四分之一计
    ret += (attrs[mainKey]?.mark ?? 0) * (arti.main?.value ?? 0) / 4
  }

  for (const ds of arti.attrs ?? []) {
    if (!ds.key) continue
    ret += (attrs[ds.key]?.mark ?? 0) * (ds.value ?? 0)
  }

  const pMax = posMaxMark[String(idx)] ?? 0
  return pMax > 0 ? (ret * (1 + fixPct)) / 2 / pMax * 66 : 0
}

/** 造评分配置需要的东西 */
export interface CfgInput {
  /** 游戏 */
  game: ArtiGame
  /** 角色 */
  char: MarkChar
  /** 武器 */
  weapon?: MarkWeapon
  /** 当前面板属性，自定义规则会读它 */
  attr?: Record<string, number>
  /** 命座 */
  cons?: number
  /** 已激活的套装，判定「绝缘4」一类用 */
  sets?: Record<string, number>
  /**
   * 逐位置的主词条键，键为位置（1 起）
   *
   * `artis.is("heal", 5)` 那种按位置判定要它，缺了则那些判定**恒为假**（六个角色权重方案据此切换，判错会退回通用那套）。
   */
  mains?: Record<string, string>
  /** 套装全名 → 简称；`artis.is("冰套4")` 写的是简称 */
  setAbbr?: Readonly<Record<string, string>>
  /** 角色自定义权重规则，由沙箱提供；缺失时用默认权重表 */
  rule?: CharRule
}

/**
 * 按分隔符拆一串判据
 *
 * 逗号、分号、顿号都算分隔符，两侧空白剔掉。
 * @param one 一串判据，也可以是数字（位置）
 * @returns 逐项
 */
function eachStr(one: string | number): string[] {
  return String(one)
    .split(/[,;；、，]/)
    .map(it => it.trim())
    .filter(it => it !== "")
}

/**
 * 造自定义规则要的圣遗物判定
 * @param input 评分输入
 * @returns 判定
 */
function markArtis(input: CfgInput): MarkArtis {
  const sets = input.sets ?? {}
  const names: string[] = []
  // 件数只分两档：三件按两件算、五件按四件算
  const combos: string[] = []
  for (const [name, count] of Object.entries(sets)) {
    if (count < 2) continue
    const at = count >= 4 ? 4 : 2
    names.push(name)
    combos.push(`${name}${at}`)
    const short = input.setAbbr?.[name]
    if (short) combos.push(`${short}${at}`)
  }

  const mains = input.mains ?? {}
  const dmgPos = DMG_POS[input.game]

  /**
   * 判指定位置的主词条
   * @param check 词条键，可用逗号列多个
   * @param pos 位置，可用逗号列多个；省略时判全部带主词条可选的位置
   * @returns 每个位置都命中时为真
   */
  const isAttr = (check: string, pos: string | number): boolean => {
    const want = eachStr(check)
    const list = pos === "" ? eachStr(input.game === "gs" ? "3,4,5" : "3,4,5,6") : eachStr(pos)
    for (const one of list) {
      const got = mains[one] ?? ""
      if (want.includes(got)) continue
      // 伤害位上的元素主词条算作 `dmg`
      if (Number(one) === dmgPos && want.includes("dmg") && isElem(got)) continue
      return false
    }
    return true
  }

  return {
    names,
    is: (check: string, pos: string | number = ""): boolean => {
      if (pos) return isAttr(check, pos)
      return eachStr(check).some(one => combos.includes(one))
    }
  }
}

/**
 * 定出一个角色该用哪套权重
 *
 * 默认走权重表，叠加两条调整：换了改变取向的武器（见 {@link WEAPON_CFG}）、绝缘四件套把充能权重拉高。
 * @param input 输入
 * @param table 词条元数据表
 * @returns 权重方案名与各词条权重
 */
export function charWeight(input: CfgInput, table: ArtiMetaTable): { title: string; attrWeight: AttrWeight } {
  const { game, char } = input
  const weapon = input.weapon ?? {}
  const affix = Number(weapon.affix) || 1
  const useful = table.weightOf(game, char.name)
  const judge = markArtis(input)

  /**
   * 指定一套权重并起名
   * @param title 方案名
   * @param attrWeight 权重
   * @returns 方案
   */
  const rule = (title: string, attrWeight: AttrWeight): { title: string; attrWeight: AttrWeight } => ({ title, attrWeight })

  /**
   * 走默认流程
   *
   * **第二参是自定义规则自己攒的标题段**：`character/<名>/artis.js` 里写 `def(particularAttr, title)`，
   * 把「纯辅」「高命」一类判定结果交进来，与本函数再追加的武器 / 绝缘段并成一串。
   * 不收它则那些标题整条丢失（方案名恒为「通用」，评分本身不变、只让图上那行看不出走了哪套）。
   * @param over 覆盖的权重；省略时取权重表
   * @param title 自定义规则已攒好的标题段，就地续写
   * @returns 方案
   */
  const def = (over?: AttrWeight, title: string[] = []): { title: string; attrWeight: AttrWeight } => {
    const titles: string[] = [...title]
    const weight: AttrWeight = { ...(over ?? useful ?? {}) }

    /**
     * 按精炼把某项权重往上抬，抬到上限为止
     * @param key 词条键
     * @param maxAffix 精五时的加量
     * @param minAffix 精一时的加量
     * @param max 上限
     * @returns 确实抬了就为真
     */
    const weaponCheck = (key: string, maxAffix = 20, minAffix = 10, max = 100): boolean => {
      const original = weight[key] ?? 0
      if (original === max) return false
      const plus = minAffix + ((maxAffix - minAffix) * (affix - 1)) / 4
      weight[key] = Math.min(Math.round(original + plus), max)
      return true
    }

    /**
     * 把某项权重抬到与另一项齐平
     * @param key 词条键
     * @param max 上限
     * @param maxPlus 加量
     * @returns 确实抬了就为真
     */
    const check = (key: string, max = 75, maxPlus = 75): boolean => {
      const original = weight[key] ?? 0
      if (original >= max) return false
      weight[key] = Math.min(Math.round(original + maxPlus), max)
      return true
    }

    if (game === "gs") {
      const wn = weapon.name ?? ""
      const wCfg = WEAPON_CFG[wn]
      // 只在该角色本来就看攻击时才调整：奶妈拿护摩不该因此去堆生命
      if ((weight["atk"] ?? 0) > 0 && wCfg) {
        if (weaponCheck(wCfg.attr, wCfg.max ?? 20, wCfg.min ?? 10)) titles.push(wCfg.abbr ?? wn)
      }
      // 绝缘四件套：充能直接转化为伤害，故把它抬到与当前最高的主属性齐平
      const maxWeight = Math.max(weight["atk"] ?? 0, weight["hp"] ?? 0, weight["def"] ?? 0, weight["mastery"] ?? 0)
      // 简称与全名都列上：简称表由调用方给，缺了它这一条不该静默失效
      if (judge.is("绝缘4,绝缘之旗印4") && check("recharge", maxWeight, 75)) titles.push("绝缘4")
    }

    return {
      // 多段用 `|` 分隔，直接相接会黏成「纯辅高命」
      title: `${char.abbr}-${titles.length ? titles.join("|") : "通用"}`,
      attrWeight: weight
    }
  }

  if (input.rule) {
    const got = input.rule({
      attr: input.attr ?? {},
      elem: char.elem ?? "",
      cons: input.cons ?? 0,
      weapon,
      artis: judge,
      rule,
      def
    })
    if (got?.attrWeight) return got
  }

  // 权重表里没有该角色时给一套通用权重
  const fallback: AttrWeight =
    game === "gs"
      ? { atk: 75, cpct: 100, cdmg: 100, dmg: 100, phy: 100 }
      : { atk: 75, cpct: 100, cdmg: 100, dmg: 100, speed: 100 }
  return def(useful ?? fallback)
}

/**
 * 算一个角色的评分配置
 *
 * 小词条（`atkPlus` 一类）权重取自其大词条，并按角色白值折算成同一量纲（否则「小攻击 +50」与「大攻击 +5%」无从比较）。
 * @param input 输入
 * @param table 词条元数据表
 * @returns 评分配置
 */
export function markCfg(input: CfgInput, table: ArtiMetaTable): MarkCfg {
  const { game, char } = input
  const meta = table.meta(game)
  const { title, attrWeight } = charWeight(input, table)
  const base = { ...DEFAULT_BASE, ...(char.baseAttr ?? {}) }

  const attrs: Record<string, AttrCoef> = {}
  for (const [key, attr] of Object.entries(meta.attrMap)) {
    const k = attr.base ?? ""
    const weight = attrWeight[k || key]
    if (!weight) continue

    const value = Number(attr.value) || 0
    if (!k) {
      attrs[key] = { ...attr, weight, fixWeight: weight, mark: value > 0 ? weight / value : 0 }
      continue
    }

    // 小词条：按大词条每点价值除以角色白值折算；攻击力另加 520（武器基础攻击的量级），去掉会让小攻击评分显著偏高
    const bigValue = Number(meta.attrMap[k]?.value) || 0
    const denom = (base[k as "hp" | "atk" | "def"] ?? 0) + (k === "atk" ? ATK_PLUS_BASE : 0)
    if (bigValue <= 0 || denom <= 0) continue
    attrs[key] = {
      ...attr,
      weight,
      fixWeight: (weight * value) / bigValue / denom * 100,
      mark: weight / bigValue / denom * 100
    }
  }

  return { attrs, classTitle: title, posMaxMark: maxMarks(attrs, meta, game) }
}

/** 一次整套评分的结果 */
export interface MarkResult {
  /** 权重方案名 */
  classTitle: string
  /** 逐件的评分 */
  artis: Record<string, { mark: string; _mark: number; markClass: string; level: number; name: string; set: string }>
  /** 总分，展示用 */
  mark: string
  /** 总分 */
  _mark: number
  /** 总分档位 */
  markClass: string
  /** 各词条的权重，模板里画权重条用 */
  charWeight: AttrWeight
}

/**
 * 给一整套圣遗物评分
 *
 * 总分档位按**每件平均分**取（除以 5 或 6），逐件档位按该件自身分取，两者用同一张档位表。
 * @param list 逐件圣遗物，下标 1 起
 * @param input 评分输入
 * @param table 词条元数据表
 * @returns 评分结果
 */
export function markAll(list: Readonly<Record<string, ArtiInput>>, input: CfgInput, table: ArtiMetaTable): MarkResult {
  const cfg = markCfg(input, table)
  const count = input.game === "gs" ? 5 : 6
  const artis: MarkResult["artis"] = {}
  let total = 0

  for (let idx = 1; idx <= count; idx++) {
    const arti = list[String(idx)]
    if (!arti?.main?.key) continue
    const mark = markOne({ char: input.char, cfg, idx, arti, game: input.game, ...(input.char.elem ? { elem: input.char.elem } : {}) })
    total += mark
    artis[String(idx)] = {
      mark: mark.toFixed(1),
      _mark: mark,
      markClass: markClassOf(mark),
      level: Number(arti.level) || 0,
      name: arti.name ?? "",
      set: arti.set ?? ""
    }
  }

  const weightOut: AttrWeight = {}
  for (const [key, one] of Object.entries(cfg.attrs)) weightOut[key] = one.weight

  return {
    classTitle: cfg.classTitle,
    artis,
    mark: total.toFixed(1),
    _mark: total,
    markClass: markClassOf(total / count),
    charWeight: weightOut
  }
}
