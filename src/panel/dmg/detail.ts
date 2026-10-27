/**
 * 模块职责：伤害详情
 * 依赖方向：依赖 dmg/{attr,calc} 与 panel/build（装好的面板）；公式由沙箱求值后传入
 * 生命周期：无状态函数
 * 注意事项：**每条详情从同一份基准属性重新折算、折算前深拷**，改成「在上一条结果上继续加」会让第二条带着第一条的 buff、表现为「后面的技能凭空更高」且不报错。
 *          **天赋倍率表按等级取那一档、带后缀的键取基础键的等级**（`values[level-1]`；`a2`/`e2` 等共用基础键、`as*` 取 `t` 的等级，由 {@link SUFFIX_KEY} 认），搞错来源会让某段倍率取 1 级值、伤害偏低。
 *          **`details` 元素可以是函数**（要先算一次属性喂数据集才返回真正详情），漏掉这一支会让那些角色一条伤害都算不出。**`isStatic` 的详情只参与折算、不产出伤害行**，在折算之后产出之前跳过。
 */
import type { ArtiMetaTable } from "../../meta/arti.js"
import { elemName } from "../../meta/elem.js"
import type { MetaDetail } from "../../meta/loader.js"
import type { BuiltPanel } from "../build.js"
import { baseAttr, calcDmgAttr, cloneAttr, dataSet } from "./attr.js"
import type { DmgAttrTable, DmgBuff, DmgDataSet } from "./attr.js"
import { getDmgFn } from "./calc.js"
import type { DmgFn, DmgResult } from "./calc.js"

/** 星铁要建的技能倍率键，次序即建表次序 */
const SR_TALENT_KEYS = [
  "a",
  "a2",
  "e",
  "e1",
  "e2",
  "q",
  "q2",
  "t",
  "t2",
  "me",
  "me2",
  "me2list",
  "mt",
  "mt1",
  "mt2",
  "j",
  "j2",
  "as",
  "as1",
  "as2"
] as const

/** 原神要建的技能倍率键 */
const GS_TALENT_KEYS = ["a", "e", "q"] as const

/** 带后缀的键取哪个基础键的等级 */
const SUFFIX_KEY = /^(a|e|q|t|me|mt|j|as)(1|2)(list)?$/

/**
 * 敌人等级的缺省值
 *
 * **两游戏同为 103**，属既定口径。星铁按满级 80 取会让防御区偏大，全部星铁伤害偏高约 11.5% 而不报错。
 */
const DEFAULT_ENEMY_LV: Readonly<Record<string, number>> = { gs: 103, sr: 103 }

/**
 * 原神武器类型目录名 → 中文名
 *
 * 公式按中文判（`["法器", "弓"].includes(weaponTypeName)`）；传目录名不报错，只会让这类 buff 恒不生效。星铁的目录名本就是命途中文名，不经此表。
 */
const GS_WEAPON_TYPE_NAME: Readonly<Record<string, string>> = {
  sword: "单手剑",
  catalyst: "法器",
  bow: "弓",
  claymore: "双手剑",
  polearm: "长柄武器"
}

/** 生命之契的上限 */
const BOND_OF_LIFE_MAX = 200

/** 词条收益对比的缺省三项 */
const DEFAULT_MAIN_ATTR = "atk,cpct,cdmg"

/** 一条算好的伤害 */
export interface DmgRow {
  /** 展示标题 */
  title: string
  /**
   * 暴击伤害；剧变反应一类没有
   *
   * `type` 为 `text` 时这一项与 {@link avg} 可能是公式自己格式化好的串（`28.0%`），那时不可再按数字格式化（见 views/dmg.ts）。
   */
  dmg?: number | string
  /** 期望伤害；`type` 为 `text` 时是串 */
  avg: number | string
  /** 文本型结果，部分公式直接给一段字 */
  type?: string
  /** 在详情表里的下标，`#伤害2` 之类的序号即它加一 */
  userIdx?: number
}

/** 一格词条收益对比 */
export interface DmgCell {
  /** 格子类型：`na` 对角线、`gt` 更高、`lt` 更低、`avg` 相同 */
  type: string
  /** 暴击伤害 */
  dmg?: number | string
  /** 期望伤害 */
  avg?: number | string
}

/** 词条收益对比表 */
export interface DmgCompare {
  /** 被对比的那条伤害的标题 */
  title: string
  /** 它在详情表里的下标 */
  userIdx: number
  /** 它的基准结果 */
  basic?: DmgRow
  /**
   * 参与对比的词条
   *
   * `text` 是该词条单次强化的档位值（`5.8%`）；模板表头写「`{{attr.title}}` +`{{attr.text}}`」，少了它印字面 `undefined`。
   */
  attrs: { title: string; text: string }[]
  /** 逐行的对比结果，行列都按 {@link attrs} 的顺序 */
  rows: DmgCell[][]
  /** 该条伤害生效时的属性表 */
  attr?: DmgAttrTable
}

/** 一次伤害计算的结果 */
export interface DmgCalcResult {
  /** 逐条伤害 */
  ret: DmgRow[]
  /** 当前展示的那条对应的 buff 文案 */
  msg: string[]
  /** 逐条详情各自的 buff 文案 */
  msgList: string[][]
  /** 敌人名 */
  enemyName: string
  /** 敌人等级 */
  enemyLv: number
  /** 公式作者 */
  createdBy: string
  /** 词条收益对比，只在 `dmg` 模式下有 */
  compare?: DmgCompare
}

/** 一条伤害详情的形态，即元数据 `calc.js` 里 `details` 的元素 */
interface DetailSpec {
  /** 标题 */
  title?: string
  /** 算伤害的函数 */
  dmg?: (ds: DmgDataSet, fn: DmgFn) => DmgResult & { type?: string }
  /** 生效条件 */
  check?: (ds: DmgDataSet) => unknown
  /** 所需命座 */
  cons?: number
  /** 只参与属性折算，不产出伤害行 */
  isStatic?: boolean
  /** 该条对应的技能键 */
  talent?: string
  /** 该条专用的公式参数 */
  params?: Record<string, unknown> | ((meta: Record<string, unknown>) => Record<string, unknown>)
  /** 该条的伤害键，`defDmgKey` 据此挑默认展示哪条 */
  dmgKey?: string
  /** 是否展示明细 */
  showDetail?: boolean
  /** 由本层填入的下标 */
  userIdx?: number
}

/** 一个角色的公式规则，即 `calc.js` 求值后的形态 */
export interface CharCalcRule {
  /** 公式作者 */
  createdBy: string
  /** 逐条详情；元素可以是函数 */
  details: readonly (DetailSpec | ((ds: DmgDataSet) => DetailSpec))[]
  /** 角色自带的 buff */
  buffs: readonly (DmgBuff | string | false | null | undefined)[]
  /** 缺省公式参数 */
  defParams: Record<string, unknown> | ((meta: Record<string, unknown>) => Record<string, unknown>)
  /** 缺省展示第几条，-1 表示不指定 */
  defDmgIdx: number | ((meta: Record<string, unknown>) => number)
  /** 缺省展示哪个伤害键 */
  defDmgKey: string | ((meta: Record<string, unknown>) => string)
  /** 参与词条收益对比的三项 */
  mainAttr: string
  /** 敌人名 */
  enemyName: string
}

/**
 * 从求值出的公式模块里取出规则
 *
 * 缺省值逐项兜底（少 `mainAttr` 走 `atk,cpct,cdmg`，少 `enemyName` 按游戏取「小宝」或「弱点敌人」）。
 * **公式作者优先取模块自己导出的 `createdBy`**，取不到用调用方给的，都没有留空串（模板 `{{if createdBy}}` 空串即不画那行，随便填会写错作者）。
 * @param mod `calc.js` 求值后的模块
 * @param game 游戏
 * @param createdBy 模块没有导出作者时的回落
 * @returns 规则；模块为空或没有 `details` 时 undefined
 */
export function calcRuleOf(
  mod: Record<string, unknown> | undefined,
  game: "gs" | "sr",
  createdBy = ""
): CharCalcRule | undefined {
  if (!mod) return undefined
  const details = mod["details"]
  if (!Array.isArray(details) || details.length === 0) return undefined

  const own = mod["createdBy"]
  const author = typeof own === "string" && own ? own : createdBy
  return {
    // 作者名截到 15 字：模板上那一栏放不下更长的
    createdBy: author.slice(0, 15),
    details: details as CharCalcRule["details"],
    buffs: (mod["buffs"] as CharCalcRule["buffs"] | undefined) ?? [],
    defParams: (mod["defParams"] as CharCalcRule["defParams"] | undefined) ?? {},
    defDmgIdx: (mod["defDmgIdx"] as CharCalcRule["defDmgIdx"] | undefined) ?? -1,
    defDmgKey: (mod["defDmgKey"] as CharCalcRule["defDmgKey"] | undefined) ?? "",
    mainAttr: (mod["mainAttr"] as string | undefined) ?? DEFAULT_MAIN_ATTR,
    enemyName: (mod["enemyName"] as string | undefined) ?? (game === "sr" ? "弱点敌人" : "小宝")
  }
}

/**
 * 建技能倍率表
 *
 * 取值是 `values[level - 1]`，带后缀的键取基础键的等级。
 * @param talentLevel 天赋等级，键为 `a` / `e` / `q` 等
 * @param detail 角色的整份 `data.json`
 * @param game 游戏
 * @returns 技能键 → 倍率名 → 该等级的值；另有 `talentLevel` 一项原样带回
 */
export function talentTables(
  talentLevel: Readonly<Record<string, number>>,
  detail: MetaDetail | undefined,
  game: "gs" | "sr"
): Record<string, unknown> {
  const out: Record<string, unknown> = { talentLevel }
  const keys = game === "sr" ? SR_TALENT_KEYS : GS_TALENT_KEYS

  for (const key of keys) {
    // 带后缀的键（`a2` / `me2list` / `as1`）取其基础键的等级；`as*` 取 `t` 的
    const hit = SUFFIX_KEY.exec(key)
    const from = hit ? (hit[1] === "as" ? "t" : (hit[1] ?? key)) : key
    const level = Number(talentLevel[from]) || 1
    const map: Record<string, unknown> = {}

    if (game === "gs") {
      const table = (detail?.["talentData"] as Record<string, Record<string, unknown[]>> | undefined)?.[key]
      for (const [name, values] of Object.entries(table ?? {})) {
        map[name] = values[level - 1]
      }
    } else {
      const talent = detail?.["talent"] as Record<string, unknown> | undefined
      const one = talent?.[key]
      if (!one) {
        out[key] = map
        continue
      }
      if (key === "me2list") {
        // 忆灵的第二段是一份逐段的表，每段各有自己的 `tables`
        for (const [idx, ds] of Object.entries(one as Record<string, { tables?: unknown }>)) {
          const inner: Record<string, unknown> = {}
          for (const table of tableList(ds?.tables)) {
            if (table.name) inner[table.name] = table.values?.[level - 1]
          }
          map[idx] = inner
        }
      } else {
        for (const table of tableList((one as { tables?: unknown }).tables)) {
          if (table.name) map[table.name] = table.values?.[level - 1]
        }
      }
    }
    out[key] = map
  }
  return out
}

/**
 * 把一份倍率表规整成数组
 *
 * **两游戏形态不同**：原神的 `talent[key].tables` 是数组，星铁的是以 `"1"`/`"2"` 为键的对象，故两种都要吃得下。
 * 直接 `for...of` 只吃得下数组——星铁那侧会抛 `tables is not iterable`，而那步在算伤害最前面，**表现是星铁伤害命令整条不出图**。
 * @param one `tables` 字段，数组或对象
 * @returns 逐张表；取不到时空数组
 */
function tableList(one: unknown): { name?: string; values?: number[] }[] {
  if (!one || typeof one !== "object") return []
  const list = Array.isArray(one) ? one : Object.values(one)
  return list.filter((it): it is { name?: string; values?: number[] } => !!it && typeof it === "object")
}

/**
 * 把已激活的行迹 id 折成 buff 判定用的形态
 *
 * buff 里写的是 `tree: 102` 一类三位号，而存的是完整 id（`1102102`），故取末三位。
 * @param trees 已激活的行迹 id
 * @returns 三位号 → true
 */
export function treeFlags(trees: readonly string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const one of trees) {
    const hit = /1?\d{4}(\d{3})/.exec(String(one))
    if (hit?.[1]) out[hit[1]] = true
  }
  return out
}

/** 算伤害要的东西 */
export interface CalcDmgInput {
  /** 装好的面板 */
  panel: BuiltPanel
  /** 角色的整份 `data.json`，技能倍率表在它里面 */
  detail?: MetaDetail
  /** 公式规则 */
  rule: CharCalcRule
  /** 已收集好的 buff */
  buffs: readonly DmgBuff[]
  /** 词条元数据表，词条收益对比要按它取步长 */
  arti: ArtiMetaTable
  /** 敌人等级；不传按游戏取缺省 */
  enemyLv?: number
  /**
   * 模式
   *
   * `profile` 列出全部伤害、`dmg` 额外算词条收益对比、`single` 只算一条（排行用）。
   */
  mode?: "profile" | "dmg" | "single"
  /** 展示第几条，`#伤害2` 里的那个数 */
  dmgIdx?: number
  /** 序号是使用者显式给的 */
  idxIsInput?: boolean
}

/** 详情表里一条已就位的详情 */
interface ResolvedDetail {
  /** 详情本体 */
  spec: DetailSpec
  /** 在原 `details` 数组里的下标 */
  sysIdx: number
}

/**
 * 算一个角色的伤害
 *
 * @param input 输入
 * @returns 伤害结果；`single` 模式下没有可算的详情时 undefined
 */
export function calcDmg(input: CalcDmgInput): DmgCalcResult | undefined {
  const { panel, rule, buffs, arti } = input
  const game = panel.game
  const enemyLv = input.enemyLv ?? DEFAULT_ENEMY_LV[game] ?? 103
  const mode = input.mode ?? "profile"

  // 天赋倍率按**含命座加成**的等级取（命座满足门槛时天赋 +N 级）：库里存的是不含命座的
  // original，装配层已折出 talentLevel，缺它才回落 talent。漏折算会让所有满足命座门槛的角色伤害偏低一截
  const talent = talentTables(panel.talentLevel ?? panel.talent, input.detail, game)
  const meta: Record<string, unknown> = {
    charId: panel.id,
    uid: panel.uid,
    level: panel.level,
    cons: panel.cons,
    talent,
    trees: treeFlags(panel.trees),
    weapon: panel.weapon ?? {}
  }

  const defParams = typeof rule.defParams === "function" ? rule.defParams(meta) : (rule.defParams ?? {})
  const defDmgKey = typeof rule.defDmgKey === "function" ? rule.defDmgKey(meta) : rule.defDmgKey
  const defDmgIdx = typeof rule.defDmgIdx === "function" ? rule.defDmgIdx(meta) : rule.defDmgIdx

  const base = baseAttr({
    attr: panel.attr as unknown as Record<string, number>,
    game,
    // 公式按中文元素名判（`element === "水"`）；传 `hydro` 会让蒸发恒按逆反应算、按元素判的 buff 不生效。
    // 星铁转不出，回落原值
    element: elemName(panel.elem, panel.elem),
    cons: panel.cons,
    level: panel.level,
    trees: meta["trees"] as Record<string, boolean>,
    ...(panel.weapon
      ? {
          weapon: { affix: panel.weapon.affix, name: panel.weapon.name },
          weaponTypeName: game === "gs"
            ? (GS_WEAPON_TYPE_NAME[(panel.weapon.type ?? "").toLowerCase()] ?? "")
            : (panel.weapon.type ?? "")
        }
      : {})
  })

  const attrMap = arti.meta(game).attrMap
  const artis = panel.sets

  // 没进任何详情时的兜底文案：先整体算一次，取它的 msg
  const { msg: baseMsg } = calcDmgAttr({ base, buffs, meta, artis, params: defParams, game, attrMap })

  // 使用者给的序号从 1 起
  let dmgIdx = Number(input.dmgIdx) || 0
  if (input.idxIsInput) dmgIdx = Math.max(0, dmgIdx - 1)
  if (mode === "single") dmgIdx = defDmgIdx > -1 ? defDmgIdx : 0

  const ret: DmgRow[] = []
  const msgList: string[][] = []
  const resolved: ResolvedDetail[] = []
  let dmgAttr: DmgAttrTable | undefined

  rule.details.forEach((raw, sysIdx) => {
    if (mode === "single") {
      // 指定了伤害键就按键挑，否则按下标挑
      if (defDmgKey) {
        const one = typeof raw === "function" ? undefined : raw
        if (one?.dmgKey !== defDmgKey) return
      } else if (sysIdx !== dmgIdx) return
    }

    const spec = resolveDetail(raw, { base, buffs, meta, artis, game, attrMap, talent, panel })
    if (!spec) return

    const own = typeof spec.params === "function" ? spec.params(meta) : (spec.params ?? {})
    const params: Record<string, unknown> = { ...defParams, ...own }
    // 生命之契不能超过 200
    if (typeof params["BondOfLife"] === "number") {
      params["BondOfLife"] = Math.min(params["BondOfLife"], BOND_OF_LIFE_MAX)
    }

    const { attr, msg } = calcDmgAttr({
      base,
      buffs,
      meta,
      artis,
      params,
      game,
      attrMap,
      ...(spec.talent ? { talent: spec.talent } : {})
    })
    if (mode === "dmg" && sysIdx === dmgIdx) dmgAttr = cloneAttr(attr)
    if (spec.isStatic) return

    const ds = dataSet(attr, { ...meta, talent }, params)
    ds.artis = artis
    if (spec.check && !spec.check(ds)) return
    if (spec.cons !== undefined && panel.cons < Number(spec.cons)) return

    const fn = getDmgFn({ ds, attr, level: panel.level, enemyLv, game })
    if (spec.dmg) {
      const got = spec.dmg(ds, fn)
      spec.userIdx = ret.length
      resolved.push({ spec, sysIdx })
      ret.push({ ...got, title: spec.title ?? "", userIdx: ret.length })
    }
    msgList.push(msg)
  })

  if (mode === "single") {
    const first = ret[0]
    if (!first) return undefined
    return {
      ret: [first],
      msg: msgList[0] ?? baseMsg,
      msgList,
      enemyName: rule.enemyName,
      enemyLv,
      createdBy: rule.createdBy
    }
  }

  const out: DmgCalcResult = {
    ret,
    // 展示哪条的文案：使用者指定了序号就用那条，否则用缺省那条
    msg: msgList[input.idxIsInput ? dmgIdx : defDmgIdx > -1 ? defDmgIdx : dmgIdx] ?? baseMsg,
    msgList,
    enemyName: rule.enemyName,
    enemyLv,
    createdBy: rule.createdBy
  }

  if (mode === "dmg") {
    const got = compareAttrs({
      input,
      rule,
      base,
      buffs,
      meta,
      artis,
      attrMap,
      talent,
      resolved,
      ret,
      defParams,
      defDmgIdx,
      dmgIdx,
      enemyLv,
      ...(dmgAttr ? { dmgAttr } : {})
    })
    if (got) out.compare = got
  }
  return out
}

/**
 * 把一条详情就位
 *
 * `details` 的元素可以是函数：那种要先算一次属性、把数据集喂给它才拿到真正的详情。
 * @param raw 原始详情
 * @param ctx 上下文
 * @returns 详情；函数抛错或返回空时 undefined
 */
function resolveDetail(
  raw: DetailSpec | ((ds: DmgDataSet) => DetailSpec),
  ctx: {
    base: DmgAttrTable
    buffs: readonly DmgBuff[]
    meta: Record<string, unknown>
    artis: unknown
    game: "gs" | "sr"
    attrMap: Record<string, { calc?: string; value?: number }>
    talent: Record<string, unknown>
    panel: BuiltPanel
  }
): DetailSpec | undefined {
  if (typeof raw !== "function") return raw
  const { attr } = calcDmgAttr({
    base: ctx.base,
    buffs: ctx.buffs,
    meta: ctx.meta,
    artis: ctx.artis,
    game: ctx.game,
    attrMap: ctx.attrMap
  })
  const ds = dataSet(attr, { ...ctx.meta, talent: ctx.talent })
  ds.artis = ctx.artis
  try {
    return raw({ ...ds, attr, profile: ctx.panel } as DmgDataSet)
  } catch {
    // 公式是下载来的代码，一条算不出不该让整张面板失败
    return undefined
  }
}

/**
 * 算词条收益对比
 *
 * 对 `mainAttr` 的每两项组合，一项加一档、另一项减一档看伤害怎么变；对角线不算。
 * @param arg 上下文
 * @returns 对比表；挑不出要对比的那条详情时 undefined
 */
function compareAttrs(arg: {
  input: CalcDmgInput
  rule: CharCalcRule
  base: DmgAttrTable
  buffs: readonly DmgBuff[]
  meta: Record<string, unknown>
  artis: unknown
  attrMap: Record<string, { calc?: string; value?: number; title?: string; text?: string }>
  talent: Record<string, unknown>
  resolved: readonly ResolvedDetail[]
  ret: readonly DmgRow[]
  defParams: Record<string, unknown>
  defDmgIdx: number
  dmgIdx: number
  enemyLv: number
  dmgAttr?: DmgAttrTable
}): DmgCompare | undefined {
  const { input, rule, resolved, ret, defDmgIdx, dmgIdx } = arg
  const panel = input.panel
  const game = panel.game

  // 挑哪条：使用者指定的序号 → 缺省序号 → 第一条
  let picked: ResolvedDetail | undefined
  if (input.idxIsInput) picked = resolved[dmgIdx]
  else if (defDmgIdx > -1) picked = resolved.find(it => it.sysIdx === defDmgIdx) ?? resolved[0]
  else picked = resolved[0]
  if (!picked) return undefined

  const spec = picked.spec
  const userIdx = spec.userIdx ?? 0
  const basic = ret[userIdx]
  const own = typeof spec.params === "function" ? spec.params(arg.meta) : (spec.params ?? {})
  const params: Record<string, unknown> = { ...arg.defParams, ...own }

  const keys = rule.mainAttr
    .split(",")
    .map(it => it.trim())
    .filter(Boolean)
  const out: DmgCompare = {
    title: spec.title ?? "",
    userIdx,
    attrs: keys.map(key => ({ title: arg.attrMap[key]?.title ?? key, text: arg.attrMap[key]?.text ?? "" })),
    rows: [],
    ...(basic ? { basic } : {}),
    ...(arg.dmgAttr ? { attr: arg.dmgAttr } : {})
  }

  for (const reduceAttr of keys) {
    const row: DmgCell[] = []
    for (const incAttr of keys) {
      if (incAttr === reduceAttr) {
        row.push({ type: "na" })
        continue
      }
      const { attr } = calcDmgAttr({
        base: arg.base,
        buffs: arg.buffs,
        meta: arg.meta,
        artis: arg.artis,
        params,
        incAttr,
        reduceAttr,
        game,
        attrMap: arg.attrMap,
        ...(spec.talent ? { talent: spec.talent } : {})
      })
      const ds = dataSet(attr, { ...arg.meta, talent: arg.talent }, params)
      ds.artis = arg.artis
      const fn = getDmgFn({ ds, attr, level: panel.level, enemyLv: arg.enemyLv, game })
      if (!spec.dmg) continue
      const got = spec.dmg(ds, fn)
      const avg = Number(got.avg) || 0
      const baseAvg = Number(basic?.avg) || 0
      row.push({
        type: avg === baseAvg ? "avg" : avg > baseAvg ? "gt" : "lt",
        ...(got.dmg === undefined ? {} : { dmg: got.dmg }),
        avg
      })
    }
    out.rows.push(row)
  }
  return out
}
