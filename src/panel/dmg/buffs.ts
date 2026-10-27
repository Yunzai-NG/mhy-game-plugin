/**
 * 模块职责：伤害计算的 buff 收集 —— 从武器、圣遗物套装与角色公式里取出**非静态** buff
 * 依赖方向：依赖 meta/sandbox（求值公式文件）与 dmg/attr 的类型；求值失败时一律回落到空表
 * 生命周期：按"游戏 + 文件"缓存求值结果，同一局内不重复求值
 * 注意事项：这一层是唯一需要沙箱的地方（静态 buff 已离线转 JSON，非静态的写成箭头函数无法转数据；`enableDmgCalc` 关闭时返回空表）。
 *          武器 buff 公式默认导出一个收 `(step, staticStep)` 的**函数**（角色 `calc.js` 直接导出 `buffs`）；`step(start)` 产出 6 项（下标 0 不用，1~5 对应精一至精五），少一项会让精五取到 undefined。
 *          **`isStatic` 的条目要丢掉**：已由属性计算层加过、再加就是加倍（20% 变 40%、面板只表现为数字偏高）。反应 buff 可以是字符串（展开成带 `mastery` 的对象），最后按 `sort` 升序排——属性转化（sort 4~9）必须在常规加成（sort 1）之后。
 */
import { join } from "node:path"
import type { Logger } from "@yunzai-ng/types"
import { stepValues } from "../../meta/buff-parse.js"
import { CALC_FILES, evalCalc, type SandboxDeps } from "../../meta/sandbox.js"
import { setFileOf } from "../../meta/set-dir.js"
import { elemOf } from "../../meta/elem.js"
import { isGsTravelerName } from "../../meta/traveler.js"
import type { DmgBuff } from "./attr.js"
import type { GameKey } from "../../core/region.js"

/**
 * 支持伤害计算的三个游戏
 *
 * **绝区零同样走这一层**，而非在插件里内置一套 buff：乘区虽不同，但「buff 从哪来」三游戏一致（逐个 calc.js 落在 meta 里由本层求值），故 `enableDmgCalc` 对它同样适用。
 */
export type DmgGame = GameKey

/** 增幅反应的展开文案 */
const AMPLIFY_TITLE: Readonly<Record<string, string>> = {
  vaporize: "蒸发",
  melt: "融化",
  swirl: "扩散"
}

/** 激化反应的展开文案 */
const CATALYZE_TITLE: Readonly<Record<string, string>> = {
  aggravate: "超激化",
  spread: "蔓激化"
}

// 精炼档位的算法与静态 buff 表同一份（见 meta/buff-parse），公式里的 `step` 与静态那张表才对得上
export { stepValues }

/**
 * 造一条静态属性 buff
 *
 * 产出的条目一律带 `isStatic: true`、随后会被筛掉；仍提供此 helper 是因武器公式文件会调用它，不给就求值失败。
 * @param key 词条键
 * @param start 精一的值
 * @param step 每档步长
 * @returns 静态 buff
 */
export function staticAttrBuff(key: string, start: number, step?: number): DmgBuff {
  const refine: Record<string, number[]> = { [key]: stepValues(start, step) }
  // 占位符是字面量 `[key]` 而非词条键名，那是公式数据本身的写法；这些条目一律 isStatic 会被筛掉，故不自行「修正」
  return { title: `${key}提高[key]`, isStatic: true, refine } as DmgBuff
}

/**
 * 把 buff 列表规整化
 *
 * 丢掉空项、把字符串反应名展开成对象、补缺省 `sort`，最后按 `sort` 升序稳定排序。
 * @param buffs 原始列表，元素可以是 buff 对象或反应名字符串
 * @returns 规整后的 buff 列表
 */
export function normalizeBuffs(buffs: readonly (DmgBuff | string | false | null | undefined)[]): DmgBuff[] {
  const out: DmgBuff[] = []
  for (const raw of buffs) {
    if (!raw) continue
    let one: DmgBuff
    if (typeof raw === "string") {
      if (AMPLIFY_TITLE[raw]) {
        one = {
          title: `元素精通：${AMPLIFY_TITLE[raw]}伤害提高[_${raw}]%`,
          mastery: raw,
          sort: 9
        } as DmgBuff
      } else if (CATALYZE_TITLE[raw]) {
        one = {
          title: `元素精通：${CATALYZE_TITLE[raw]}伤害提高[_${raw}]%，造成的伤害值提升[_${raw}num]`,
          mastery: raw,
          sort: 9
        } as DmgBuff
      } else {
        // 不认得的字符串直接丢掉：留一个没 data 的 buff 只会在 msg 里多出一行无意义文案
        continue
      }
    } else {
      one = raw
    }
    out.push({ ...one, sort: one.sort === undefined ? 1 : one.sort })
  }
  // 稳定升序：同 sort 的条目保持加入顺序，与 lodash.sortBy 一致
  return out
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => (Number(a.it.sort) || 0) - (Number(b.it.sort) || 0) || a.idx - b.idx)
    .map(one => one.it)
}

/**
 * 本层对一条 buff 的唯一要求：可能带一个 `isStatic` 标记
 *
 * 「从表里读出几条、筛掉静态的」与 buff 自身形态无关，故读表那两个函数按这个最小形态泛型化（原神星铁的 {@link DmgBuff} 与绝区零的 `ZzzBuff` 字段不重合）。
 */
export interface MaybeStatic {
  /** 已由属性计算层加过一遍的那些，本层要丢掉 */
  isStatic?: boolean
}

/**
 * 判一条 buff 是不是静态的
 *
 * **不把 {@link MaybeStatic} 直接用作泛型约束**：它全属性可选，TS 弱类型检查会拒绝与它毫无共同属性的类型（如 `ZzzBuff`，报 TS2559），故约束放宽到 `object`。
 * 没有这个字段即不是静态的（绝区零核心技加成在造包时就没落进包里）。
 * @param one 一条 buff
 * @returns 是静态 buff 时为真
 */
function isStaticBuff(one: unknown): boolean {
  return !!(one as MaybeStatic | undefined)?.isStatic
}

/**
 * 从一份"套装名 → 件数 → buff"的表里读出某几套的非静态 buff
 *
 * **四件套同时吃两件套效果**，故 4 件时取 2 与 4 两档，漏掉会让四件套角色少一截加成。连套装名与档位一并交回（原神星铁据此给标题加前缀）。
 * @param sets 套装名 → 件数
 * @param table 套装 buff 表
 * @returns 逐条：套装名、档位与那条 buff
 */
function setBuffsOf<T extends object>(
  sets: Readonly<Record<string, number>>,
  table: Readonly<Record<string, unknown>>
): { name: string; tier: number; buff: T }[] {
  const out: { name: string; tier: number; buff: T }[] = []
  for (const [name, count] of Object.entries(sets)) {
    const num = Number(count) || 0
    if (num < 2) continue
    const entry = table[name] as Record<string, unknown> | undefined
    if (!entry) continue
    // 2 件先算一次，4 件时再算 4 件那一档
    const tiers = num >= 4 ? [2, 4] : [2]
    for (const tier of tiers) {
      const raw = entry[String(tier)]
      const list = Array.isArray(raw) ? raw : raw ? [raw] : []
      for (const one of list) {
        const buff = one as T | undefined
        if (!buff || isStaticBuff(buff)) continue
        out.push({ name, tier, buff })
      }
    }
  }
  return out
}

/**
 * 从一份"套装名 → 件数 → buff"的表里取出某几套的非静态 buff
 *
 * 原神星铁那一路：读表交给 {@link setBuffsOf}，这里只做**标题加前缀**这一件本路专属的事。
 * @param sets 套装名 → 件数
 * @param table 套装 buff 表
 * @returns 非静态 buff，标题前缀已加上"套装名 + 件数"
 */
export function artisBuffsOf(
  sets: Readonly<Record<string, number>>,
  table: Readonly<Record<string, unknown>>
): DmgBuff[] {
  return setBuffsOf<DmgBuff>(sets, table).map(it => ({
    ...it.buff,
    title: `${it.name}${it.tier}：${String(it.buff.title ?? "")}`
  }))
}

/** 武器公式里可能出现的 `refine` 精炼档字段（非静态那一路要展开进 `data`） */
interface WeaponRefineBuff {
  /** 展示文案，可以是函数 */
  title?: unknown
  /** 加成数据 */
  data?: Record<string, unknown>
  /** 逐词条的精炼档数值，下标 0 起（`refine` 即精几减一） */
  refine?: Record<string, readonly number[]>
  /** 该 buff 的层数倍数，缺省 1 */
  buffCount?: number
  /**
   * 数值表的行号，**星铁那一路**用
   *
   * 值取自武器 `data.json` 的 `skill.tables[idx]`（已按精炼档收口，见 {@link weaponTablesAt}）。
   */
  idx?: number | string
  /** 该行数值落到哪个词条键上，与 {@link idx} 成对出现 */
  key?: string
}

/**
 * 星铁武器公式的静态 helper —— 公式里的 `staticIdx(idx, key)`
 *
 * 产出的条目带 `isStatic`、随后被筛掉（属性层已加过）；不提供它则公式整份求值失败。
 * @param idx 数值表的行号
 * @param key 词条键
 * @returns 静态 buff
 */
export function staticIdxBuff(idx: number | string, key: string): DmgBuff {
  return { isStatic: true, idx, key } as DmgBuff
}

/**
 * 星铁武器公式的非静态 helper —— 公式里的 `keyIdx(title, key, idx)`
 *
 * **两种返回形态**：`key` 是对象时返回收 `tables` 的函数（一条 buff 摊多个词条），
 * 否则返回带 `idx`/`key` 的条目，由 {@link expandWeaponRefine} 展开。
 * @param title 展示文案
 * @param key 词条键，或"词条键 → 行号"的对照表
 * @param idx 数值表的行号；`key` 为对象时不用
 * @returns buff 条目，或收 `tables` 的函数
 */
export function keyIdxBuff(
  title: string,
  key: string | Readonly<Record<string, number | string>>,
  idx?: number | string
): DmgBuff | ((tables: Readonly<Record<string, unknown>>) => DmgBuff) {
  if (key && typeof key === "object") {
    return (tables: Readonly<Record<string, unknown>>): DmgBuff => {
      const data: Record<string, unknown> = {}
      for (const [k, at] of Object.entries(key)) data[k] = tables[String(at)]
      return { title, data } as DmgBuff
    }
  }
  return { title, idx, key } as DmgBuff
}

/**
 * 把武器的技能数值表按精炼档收口成"行号 → 该档的值"
 *
 * 星铁武器 `data.json` 的 `skill.tables` 是"行号 → 五个精炼的值"，公式只写行号。
 *
 * **叠影缺失时返回空表，不回落成精一**：存档里确有不带 `affix` 的光锥，属既定口径是整条 buff 跳过；
 * 回落成精一会凭空多一档加成（伤害偏高 3.5%~9%）。
 * @param detail 武器的整份 `data.json`
 * @param affix 精炼 / 叠影，1~5；缺失或非数时返回空表
 * @returns 行号 → 该精炼档的值；取不到时空表
 */
export function weaponTablesAt(detail: unknown, affix: unknown): Record<string, unknown> {
  const tables = (detail as { skill?: { tables?: Record<string, readonly unknown[]> } } | undefined)?.skill?.tables
  if (!tables) return {}
  // 刻意不给缺省：缺叠影时得 NaN，整表取不到值
  const at = Number(affix) - 1
  if (!Number.isInteger(at) || at < 0) return {}
  const out: Record<string, unknown> = {}
  for (const [row, values] of Object.entries(tables)) out[row] = values?.[at]
  return out
}

/**
 * 把一条武器 buff 的 `refine` 展开进 `data`，并给标题加武器名前缀
 *
 * **`calcDmgAttr` 只读 `data`**，三种写法都要落成它，否则那条加成整条丢失：
 * - 直接写 `data`，原样留用；
 * - 原神 `refine: { 词条: 逐档数组 }` → `data[词条] = ds => 数组[ds.refine] × buffCount`；
 * - 星铁 `idx` + `key` → `data[key] = tables[idx]`。
 *
 * 标题不含全角冒号时加"武器名："前缀。
 * @param buff 一条非静态武器 buff
 * @param name 武器名
 * @param tables 武器数值表，星铁那一路要用；原神传空表
 * @returns 展开后的 buff
 */
function expandWeaponRefine<T extends object>(
  buff: T,
  name: string,
  tables: Readonly<Record<string, unknown>> = {}
): T {
  const src = buff as WeaponRefineBuff
  const out = { ...buff } as WeaponRefineBuff
  if (typeof src.title === "string" && !src.title.includes("：")) out.title = `${name}：${src.title}`
  if (src.refine) {
    const data: Record<string, unknown> = { ...(out.data ?? {}) }
    const count = Number(src.buffCount) || 1
    for (const [key, values] of Object.entries(src.refine)) {
      data[key] = (ds: { refine?: number }) => (Number(values[Number(ds.refine) || 0]) || 0) * count
    }
    out.data = data
    delete out.refine
  }
  // 两者缺一、或那行取不到数时跳过，免得往 data 里塞 undefined
  if (src.idx !== undefined && src.key) {
    const got = tables[String(src.idx)]
    if (got !== undefined) out.data = { ...(out.data ?? {}), [src.key]: got }
    delete out.idx
    delete out.key
  }
  return out as T
}

/**
 * 从一份"武器名 → buff"的表里取出某把武器的非静态 buff
 *
 * 逐条经 {@link expandWeaponRefine} 展开。**条目可以是函数**（见 {@link keyIdxBuff}），先喂 `tables` 得到真正的 buff。
 * @param name 武器名
 * @param table 武器 buff 表
 * @param tables 武器数值表，星铁那一路要用；原神传空表
 * @returns 非静态 buff
 */
export function weaponBuffsOf<T extends object = DmgBuff>(
  name: string,
  table: Readonly<Record<string, unknown>>,
  tables: Readonly<Record<string, unknown>> = {}
): T[] {
  const raw = table[name]
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  const out: T[] = []
  for (const one of list) {
    // 函数型条目要先喂 tables；调用失败不该让整族 buff 消失，故整条跳过
    let got: unknown = one
    if (typeof one === "function") {
      try {
        got = (one as (t: Readonly<Record<string, unknown>>) => unknown)(tables)
      } catch {
        continue
      }
    }
    const buff = got as T | undefined
    if (!buff || isStaticBuff(buff)) continue
    out.push(expandWeaponRefine(buff, name, tables))
  }
  return out
}

/** 造 buff 装载器需要的东西 */
export interface DmgBuffLoaderOptions {
  /** 已安装的元数据根目录 */
  dir: string
  /**
   * 注入沙箱的依赖，按游戏取
   *
   * 收游戏参数而非直接收依赖：`usefulAttr` 两游戏各一份，混用不报错、只会让星铁评分按原神那份算（静默）。
   */
  deps: (game: DmgGame) => SandboxDeps
  /** 日志器 */
  logger: Logger
  /** 读配置：伤害计算是否开启。为假时一律返回空表，不求值任何文件 */
  enabled: () => boolean
}

/**
 * 伤害 buff 装载器
 *
 * 求值结果按路径缓存（一次 `#面板` 要算十来条详情，重复求值同一 `calc.js` 是白花）；缓存的是**模块**而非数值（数值依赖当前技能与敌人）。
 */
export class DmgBuffLoader {
  readonly #opts: DmgBuffLoaderOptions
  readonly #cache = new Map<string, Record<string, unknown> | undefined>()

  /**
   * @param opts 装载器选项
   */
  constructor(opts: DmgBuffLoaderOptions) {
    this.#opts = opts
  }

  /**
   * 丢掉求值缓存，元数据更新或开关变动后调用
   */
  reload(): void {
    this.#cache.clear()
  }

  /**
   * 伤害计算是否可用
   * @returns 开关开启时为真
   */
  get enabled(): boolean {
    return this.#opts.enabled()
  }

  /**
   * 求值一个公式文件并取其默认导出
   * @param game 游戏，决定注入哪份评分权重表
   * @param rel 相对元数据根目录的路径
   * @returns 默认导出；求值失败或开关关闭时 undefined
   */
  #evalDefault(game: DmgGame, rel: string): unknown {
    if (!this.enabled) return undefined
    if (this.#cache.has(rel)) return this.#cache.get(rel)?.["default"]
    const path = join(this.#opts.dir, rel)
    const mod = evalCalc(path, { root: this.#opts.dir, deps: this.#opts.deps(game) })
    if (!mod) {
      this.#opts.logger.debug(`[米游社][伤害] 求值失败或文件缺失：${rel}`)
      this.#cache.set(rel, undefined)
      return undefined
    }
    this.#cache.set(rel, mod as Record<string, unknown>)
    return mod.default
  }

  /**
   * 取圣遗物 / 驱动盘套装的 buff 表
   *
   * 目录名由 {@link setFileOf} 给（绝区零那族在 `equip/` 而非 `artifact/`），路径写错不报错、只会让整族套装 buff 恒空表。
   * @param game 游戏
   * @returns 套装名 → 件数 → buff；不可用时空表
   */
  artisTable(game: DmgGame): Record<string, unknown> {
    const got = this.#evalDefault(game, setFileOf(game, CALC_FILES[0] ?? ""))
    return (got as Record<string, unknown> | undefined) ?? {}
  }

  /**
   * 取一类武器的 buff 表
   *
   * 武器公式默认导出是**函数**，要传两个 helper 才拿到表（与角色公式不同，见文件头）。
   * **两游戏的 helper 不是同一对**：原神收 `(step, staticStep)`（按精炼算数值），星铁收 `(staticIdx, keyIdx)`
   * （只记数值表的行号、值由 `skill.tables` 现取）。传错那一对不报错，只让整族武器 buff 恒空表或数值恒空。
   * @param game 游戏
   * @param type 武器类型目录名（gs 为 `sword` 一类，sr 为命途中文名）
   * @returns 武器名 → buff；不可用时空表
   */
  weaponTable(game: DmgGame, type: string): Record<string, unknown> {
    const got = this.#evalDefault(game, `meta-${game}/weapon/${type}/${CALC_FILES[0]}`)
    if (typeof got !== "function") return {}
    try {
      const fn = got as (a: unknown, b: unknown) => unknown
      const ret = game === "sr" ? fn(staticIdxBuff, keyIdxBuff) : fn(stepValues, staticAttrBuff)
      return (ret as Record<string, unknown> | undefined) ?? {}
    } catch (err) {
      this.#opts.logger.debug(`[米游社][伤害] 武器公式调用失败：${game}/${type} ${String(err)}`)
      return {}
    }
  }

  /**
   * 取一个角色的公式模块
   * @param game 游戏
   * @param name 角色名，即元数据里的目录名
   * @param elem 当前元素；原神旅行者不传时不能选择公式
   * @returns 公式模块；不可用时 undefined
   */
  charCalc(game: DmgGame, name: string, elem?: string): Record<string, unknown> | undefined {
    if (!this.enabled) return undefined
    if (game === "gs" && isGsTravelerName(name)) {
      const key = elemOf(elem, "", "gs")
      if (!key) return undefined
      name = `旅行者/${key}`
    }
    const rel = `meta-${game}/character/${name}/${CALC_FILES[0]}`
    if (this.#cache.has(rel)) return this.#cache.get(rel)
    const path = join(this.#opts.dir, rel)
    const mod = evalCalc(path, { root: this.#opts.dir, deps: this.#opts.deps(game) })
    const out = mod as Record<string, unknown> | undefined
    this.#cache.set(rel, out)
    if (!out) this.#opts.logger.debug(`[米游社][伤害] 角色公式求值失败或缺失：${rel}`)
    return out
  }

  /**
   * 取一个角色的自定义评分规则
   *
   * 即 `character/<名>/artis.js` 的默认导出。与伤害无关（评分层用它），但求值它要沙箱、而沙箱与缓存都在本类，故放这里。
   * **返回类型刻意留作 `unknown`**：本层不引评分层的 `CharRule`，否则伤害层反向依赖评分层；调用方自行收窄。
   * @param game 游戏
   * @param name 角色名，即元数据里的目录名
   * @returns 默认导出；开关关闭、文件缺失或求值失败时 undefined
   */
  artisRule(game: DmgGame, name: string): unknown {
    return this.#evalDefault(game, `meta-${game}/character/${name}/${CALC_FILES[1]}`)
  }

  /**
   * 收集一个角色这一局要用的全部 buff
   *
   * 角色自带 buff 加武器与圣遗物的非静态 buff，规整后按 `sort` 升序。
   * @param input 收集所需的输入
   * @returns 规整后的 buff 列表
   */
  collect(input: {
    /** 游戏 */
    game: DmgGame
    /** 角色公式里的 `buffs` */
    charBuffs?: readonly (DmgBuff | string | false | null | undefined)[]
    /** 武器名 */
    weaponName?: string
    /** 武器类型目录名 */
    weaponType?: string
    /** 圣遗物套装名 → 件数 */
    sets?: Readonly<Record<string, number>>
    /**
     * 武器的技能数值表，**星铁那一路必给**
     *
     * 由 {@link weaponTablesAt} 按精炼档收口成"行号 → 值"。不给则星铁 `idx`/`key` 型 buff 的数值取不到、那一族加成整条丢失（伤害偏低而不报错）。原神不用它。
     */
    weaponTables?: Readonly<Record<string, unknown>>
  }): DmgBuff[] {
    const { game } = input
    const weapon = input.weaponName && input.weaponType
      ? weaponBuffsOf(input.weaponName, this.weaponTable(game, input.weaponType), input.weaponTables ?? {})
      : []
    const artis = input.sets ? artisBuffsOf(input.sets, this.artisTable(game)) : []
    return normalizeBuffs([...(input.charBuffs ?? []), ...weapon, ...artis])
  }

  /**
   * 收集一个角色这一局要用的全部 buff —— 不按原神星铁那套规整
   *
   * 与 {@link collect} 的差别只在最后不调 `normalizeBuffs`（反应展开、补 `sort`、按 `sort` 排都是原神星铁的形态，绝区零乘区顺序由 {@link ZzzBuffType} 落点决定、不靠排序）。
   * **套装 buff 不加标题前缀**：绝区零套装 buff 造包时名字已带「××2件」，再加就重了。
   * @param input 收集所需的输入
   * @returns buff 列表，次序为「角色自带、音擎、套装」
   */
  collectOf<T extends object>(input: {
    /** 游戏 */
    game: DmgGame
    /** 角色公式里的 `buffs` */
    charBuffs?: readonly T[]
    /** 武器名 */
    weaponName?: string
    /** 武器类型目录名 */
    weaponType?: string
    /** 套装名 → 件数 */
    sets?: Readonly<Record<string, number>>
    /** 武器的技能数值表；绝区零走本函数、音擎 buff 的值另由 `fillWeaponIdx` 填，故缺省空表即可 */
    weaponTables?: Readonly<Record<string, unknown>>
  }): T[] {
    const { game } = input
    const weapon = input.weaponName && input.weaponType
      ? weaponBuffsOf<T>(input.weaponName, this.weaponTable(game, input.weaponType), input.weaponTables ?? {})
      : []
    const sets = input.sets ? setBuffsOf<T>(input.sets, this.artisTable(game)).map(it => it.buff) : []
    return [...(input.charBuffs ?? []), ...weapon, ...sets]
  }
}
