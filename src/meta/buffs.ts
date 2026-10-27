/**
 * 模块职责：静态 buff 表 —— 圣遗物套装、武器精炼与角色被动里**只加属性**的那部分
 * 依赖方向：读已装元数据里套装、各类武器与各角色的 `calc.js`，经 meta/buff-parse **只解析不求值**；不发请求
 * 生命周期：按游戏首次查询时读一遍并常驻内存，元数据更新后 {@link BuffTable.reload}
 * 注意事项：面板属性计算要它、而伤害计算缺省关，故这里绝不进沙箱。带 `check`/箭头函数的条目是伤害计算那一层的
 *          动态 buff、不在这里；**认不出的写法记一条日志**，漏收一条静态 buff 则面板少一截属性且不报错。
 *          sr 武器数值不在本表：`staticIdx` 只给 `{idx,key}`，真值在武器 `data.json` 的
 *          `skill.tables[idx][精炼-1]`，取值由 {@link WeaponStaticBuff} 调用方负责。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Logger } from "@yunzai-ng/types"
import { parseCharBuffs, parseSetBuffs, parseWeaponBuffs } from "./buff-parse.js"
import { setDirOf } from "./set-dir.js"

/** 有静态 buff 表的两个游戏 */
export type BuffGame = "gs" | "sr"

/** 一条圣遗物套装的静态 buff */
export interface SetStaticBuff {
  /** 词条键 → 加值 */
  data: Record<string, number>
  /** 限定元素；有值时只对该元素的角色生效 */
  elem?: string
}

/** 一条武器的静态 buff */
export interface WeaponStaticBuff {
  /** 原神：词条键 → 逐档精炼的加值，下标为 `affix - 1`（0~4 对应精一至精五） */
  refine?: Record<string, number[]>
  /** 星铁：数值在武器 `data.json` 的 `skill.tables[idx]` 里 */
  idx?: number
  /** 星铁：词条键 */
  key?: string
}

/** 一个游戏的静态 buff 表 */
interface BuffFile {
  /** 套装名 → 件数 → buff */
  artiSets: Record<string, Record<string, SetStaticBuff[]>>
  /** 武器名 → buff */
  weapons: Record<string, WeaponStaticBuff[]>
  /** 角色名 → buff */
  chars: Record<string, SetStaticBuff[]>
}

/** 造 buff 表需要的东西 */
export interface BuffTableOptions {
  /** 元数据根目录，与安装器的 `dir` 一致 */
  metaDir: string
  /** 日志器，有认不出的写法时报一条 */
  logger?: Logger
}

/**
 * 读一个文本文件
 * @param path 文件路径
 * @returns 内容；不在或读不了时 undefined
 */
function readText(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/**
 * 列一个目录下的子目录名
 * @param dir 目录
 * @returns 子目录名；目录不在时空数组
 */
function subDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(it => it.isDirectory())
      .map(it => it.name)
  } catch {
    return []
  }
}

/**
 * 静态 buff 表
 *
 * 一个实例管两个游戏，按游戏懒加载。
 */
export class BuffTable {
  readonly #metaDir: string
  readonly #logger: Logger | undefined
  readonly #cache = new Map<BuffGame, BuffFile>()

  /**
   * @param opts 选项
   */
  constructor(opts: BuffTableOptions) {
    this.#metaDir = opts.metaDir
    this.#logger = opts.logger
  }

  /**
   * 丢掉已装载的缓存
   *
   * 元数据更新后调用，不重读就表现为「新套装、新武器的静态加成不生效」。
   */
  reload(): void {
    this.#cache.clear()
  }

  /**
   * 取一个游戏的整张表
   *
   * 读三处：`artifact/calc.js`（套装）、`weapon/<类别>/calc.js`（武器）、`character/<名>/calc.js`（角色被动）。
   * @param game 游戏
   * @returns 静态 buff 表；元数据未装时各项为空
   */
  #file(game: BuffGame): BuffFile {
    const cached = this.#cache.get(game)
    if (cached) return cached
    const base = join(this.#metaDir, `meta-${game}`)
    const unknown: string[] = []
    const out: BuffFile = { artiSets: {}, weapons: {}, chars: {} }

    const sets = readText(join(base, setDirOf(game), "calc.js"))
    if (sets !== undefined) {
      const got = parseSetBuffs(sets)
      out.artiSets = got.table
      unknown.push(...got.unknown.map(it => `套装 ${it}`))
    }
    for (const type of subDirs(join(base, "weapon"))) {
      const src = readText(join(base, "weapon", type, "calc.js"))
      if (src === undefined) continue
      const got = parseWeaponBuffs(src, game)
      Object.assign(out.weapons, got.table)
      unknown.push(...got.unknown.map(it => `武器 ${type}/${it}`))
    }
    for (const name of subDirs(join(base, "character"))) {
      const src = readText(join(base, "character", name, "calc.js"))
      if (src === undefined) continue
      const got = parseCharBuffs(src)
      if (got.table.length) out.chars[name] = got.table
      unknown.push(...got.unknown.map(it => `角色 ${name}/${it}`))
    }
    if (unknown.length) {
      this.#logger?.warn(`[米游社][元数据] meta-${game} 有 ${unknown.length} 处静态 buff 写法认不出、已跳过：${unknown.slice(0, 5).join("、")}`)
    }
    this.#cache.set(game, out)
    return out
  }

  /**
   * 取一套圣遗物在某件数下的静态 buff
   *
   * **四件套要另外自取两件套那一份**：四件套同时享有两件套效果，凑齐两次的责任在调用方
   * （见 {@link eachSetBuff}）。
   * @param game 游戏
   * @param set 套装名
   * @param num 件数，2 或 4
   * @returns 该件数下的静态 buff；没有时空数组
   */
  setBuff(game: BuffGame, set: string, num: number): SetStaticBuff[] {
    return this.#file(game).artiSets[set]?.[String(num)] ?? []
  }

  /**
   * 取一把武器的静态 buff
   * @param game 游戏
   * @param name 武器名
   * @returns 静态 buff；没有时空数组
   */
  weaponBuff(game: BuffGame, name: string): WeaponStaticBuff[] {
    return this.#file(game).weapons[name] ?? []
  }

  /**
   * 取一个角色自带的静态 buff
   *
   * 极少数角色有（如心海、行秋），但都会明显改变面板，漏掉即评分与伤害全错。键是角色目录名。
   * @param game 游戏
   * @param name 角色名
   * @returns 静态 buff；没有时空数组
   */
  charBuff(game: BuffGame, name: string): SetStaticBuff[] {
    return this.#file(game).chars[name] ?? []
  }

  /**
   * 表是否可用
   * @param game 游戏
   * @returns 有套装条目时为真
   */
  ready(game: BuffGame): boolean {
    return Object.keys(this.#file(game).artiSets).length > 0
  }
}

/**
 * 遍历已激活的套装
 *
 * **四件套先按两件套调一次、再按四件调一次**：漏掉这一次会让所有四件套角色少一截属性。件数不足 2 不产出。
 * **件数一律归到 2 / 4 两档**：{@link BuffTable.setBuff} 只认 `"2"` 与 `"4"` 两个键，件数为 3 或 5 时
 * 原样传进去会引到空表 —— 三件散件里凑的那个两件套、或五件同套里的四件套效果就整条丢失，面板偏低而不报错。
 * @param sets 套装名 → 件数
 * @returns 套装名与件数的调用序列
 */
export function eachSetBuff(sets: Readonly<Record<string, number>>): { set: string; num: number }[] {
  const out: { set: string; num: number }[] = []
  for (const [set, num] of Object.entries(sets)) {
    if (num >= 2) out.push({ set, num: 2 })
    if (num >= 4) out.push({ set, num: 4 })
  }
  return out
}
