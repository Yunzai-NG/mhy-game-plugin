/**
 * 模块职责：圣遗物 / 遗器的套装索引与星级档位 —— 按 id 或名称查套装、部位与主副词条档位
 * 依赖方向：只读**已安装的元数据目录**（`meta-{game}/artifact/*.json`）；不发请求、不碰内核
 * 生命周期：首次查询时按游戏读一次并常驻内存
 * 注意事项：与 meta/arti.ts（词条表与权重）都必需且不重合：面板给「套装 id + 主/副词条 id」、要变成「套装名 + 部位 +
 *          词条值」。读的全是 `.json`，
 *          外加一份只解析不求值的 `alias.js`（套装简称）。**原神星铁部位表示不同、记 id 的地方也不同**：原神部位由
 *          圣遗物 id 决定、id 在 `idxs[*].id`（一件一个），星铁部位由接口 `type` 给、id 在 `idxs[*].ids`（一件四个），
 *          只认前者会让星铁的 id 索引恒为空表、而星铁面板源给的正是 id。
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { constBlock, parseStringMap, stripComments } from "./js-lit.js"

/** 有圣遗物元数据的两个游戏 */
export type SetGame = "gs" | "sr"

/** 一件具体的圣遗物 / 遗器 */
export interface ArtiEntry {
  /** 名称 */
  name: string
  /** 所属套装名 */
  set: string
  /** 部位，1 起 */
  idx: number
  /**
   * 星级，只有星铁按 id 查得出
   *
   * 面板源不给遗器星级，而副词条档位基数按星级不同——缺了它四星遗器一律按五星折算。
   */
  star?: number
}

/** 一套圣遗物 */
export interface ArtiSetEntry {
  /** 套装名 */
  name: string
  /** 套装 id */
  id: string
  /** 部位 → 该部位的圣遗物名 */
  idxs: Record<string, string>
  /**
   * 套装简称，如「深林」「风套」
   *
   * 取自 `artifact/alias.js`（原神 `setAbbr`、星铁 `artiSetAbbr`）。**这一项容易漏**：只登记进别名索引而不写回
   * 套装条目，会让 `artiSet.abbr` 恒为 undefined、图鉴「常用圣遗物」标题写成 `undefined4`。表里没有的为空串。
   */
  abbr?: string
  /** 件数 → 套装效果说明 */
  skills: Record<string, string>
}

/** 星铁某一星级的主词条档位 */
export interface SrMainStep {
  /** 基数 */
  base: number
  /** 每级步进 */
  step: number
}

/** 星铁某一星级的副词条档位 */
export interface SrSubStep {
  /** 词条键 */
  key: string
  /** 单档基数 */
  base: number
  /** 每级步进 */
  step: number
}

/** 星铁的星级档位表 */
export interface SrStarData {
  /** 主词条键 → 档位 */
  main: Record<string, SrMainStep>
  /** 副词条 id → 档位 */
  sub: Record<string, SrSubStep>
}

/** 星铁 `artifact/meta.json` 的形态 */
export interface SrArtiMetaFile {
  /** 部位 → 主词条 id → 键 */
  mainIdx: Record<string, Record<string, string>>
  /** 星级 → 档位表 */
  starData: Record<string, SrStarData>
}

/** 一个游戏的套装索引 */
interface GameSets {
  /** 圣遗物 id → 条目；原神取自 `idxs[*].id`，星铁取自 `idxs[*].ids` */
  byId: Map<string, ArtiEntry>
  /** 圣遗物名 → 条目 */
  byName: Map<string, ArtiEntry>
  /** 套装名 → 套装 */
  sets: Map<string, ArtiSetEntry>
  /**
   * 套装简称 → 套装名
   *
   * `artifact/alias.js` 给的就是这层（「深林」→「深林的记忆」）。**没有它使用者打的简称一律查不到**：
   * `#胡桃换深林` 里的「深林」不是全名。全名那层不受影响，两者同时可查。
   */
  byAbbr: Map<string, string>
  /** 圣遗物 id 前两位 → 套装名，按五位 id 查套装时靠它 */
  byPrefix: Map<string, string>
}

/** `artifact/data.json` 里本模块用到的字段 */
interface RawSet {
  /** 套装 id */
  id?: string | number
  /** 套装名 */
  name?: string
  /** 部位 → 该部位的圣遗物 */
  idxs?: Record<string, { id?: string | number; name?: string; ids?: Record<string, number> }>
  /** 件数 → 效果说明 */
  skills?: Record<string, string>
}

/**
 * 原神圣遗物 id 的第四位 → 部位号
 *
 * 折算式 `[4, 2, 5, 1, 3][id[3] - 1]`：`71544` 第四位是 `4`，故它是部位 1（花）。**这一层不可省**——
 * 元数据的 `idxs[*].id` 记的是某一星级那份（末位 0），面板给的是玩家实际那件（五星末位 4），只按整串相等去查
 * 则五星圣遗物一件都查不到，表现是**面板五格圣遗物全空白而评分照常有**。
 */
const GS_ID_POS: readonly number[] = [4, 2, 5, 1, 3]

/** 造套装表需要的东西 */
export interface ArtiSetTableOptions {
  /** 已安装的元数据根目录，与元数据安装器的 `dir` 一致 */
  dir: string
}

/**
 * 读一个 JSON 文件
 * @param path 文件路径
 * @returns 解析结果；读不到或解不开时 undefined
 */
function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return undefined
  }
}

/** 各游戏 alias.js 里放套装简称的导出名，按序合并 —— 原神主简称在 `setAbbr`、全量别名在 `setAlias` */
const ABBR_EXPORTS: Readonly<Record<SetGame, readonly string[]>> = {
  gs: ["setAbbr", "setAlias"],
  sr: ["artiSetAbbr"]
}

/**
 * 读并解析套装简称表
 *
 * **只解析从不求值**，文件本就在落盘白名单里。原神把简称分放两个导出：`setAbbr` 只有主简称、
 * `setAlias` 才是逗号分隔的全量别名（「深林」只在后者），故两个都要读、按套装名合并。
 * 解析失败返回空表——简称缺失只是标题写全名，不该让整份套装索引装不上。
 * @param base 该游戏的 `artifact/` 目录
 * @param game 游戏
 * @returns 套装名 → 简称（多个时逗号分隔，交由调用方拆开）；文件不存在或解析失败时空表
 */
function readSetAbbr(base: string, game: SetGame): Record<string, string> {
  const path = join(base, "alias.js")
  if (!existsSync(path)) return {}
  try {
    const src = stripComments(readFileSync(path, "utf8"))
    const out: Record<string, string> = {}
    for (const name of ABBR_EXPORTS[game]) {
      const body = constBlock(src, name)
      if (body === undefined) continue
      for (const [set, val] of Object.entries(parseStringMap(body, `${game} ${name}`))) {
        out[set] = out[set] ? `${out[set]},${val}` : val
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 圣遗物套装索引
 *
 * 一个实例管两个游戏，按游戏懒加载。元数据未安装时各项查询返回 undefined 而不抛错。
 */
export class ArtiSetTable {
  readonly #dir: string
  readonly #cache = new Map<SetGame, GameSets>()
  readonly #srMeta = new Map<SetGame, SrArtiMetaFile | undefined>()

  /**
   * @param opts 选项
   */
  constructor(opts: ArtiSetTableOptions) {
    this.#dir = opts.dir
  }

  /**
   * 丢掉已装载的缓存，元数据更新后调用
   */
  reload(): void {
    this.#cache.clear()
    this.#srMeta.clear()
  }

  /**
   * 装载一个游戏的套装索引
   * @param game 游戏
   * @returns 索引
   */
  #load(game: SetGame): GameSets {
    const cached = this.#cache.get(game)
    if (cached) return cached

    const out: GameSets = {
      byId: new Map(),
      byName: new Map(),
      sets: new Map(),
      byPrefix: new Map(),
      byAbbr: new Map()
    }
    const base = join(this.#dir, `meta-${game}`, "artifact")
    const raw = readJson<Record<string, RawSet>>(join(base, "data.json")) ?? {}
    const abbr = readSetAbbr(base, game)

    for (const ds of Object.values(raw)) {
      if (!ds.name) continue
      const set: ArtiSetEntry = {
        name: ds.name,
        id: String(ds.id ?? ""),
        idxs: {},
        skills: ds.skills ?? {}
      }
      const short = abbr[ds.name]
      if (short) {
        // 一个套装可挂多个简称，元数据里写成逗号分隔的一串（如「草套,深林」）。整串当一个键登记
        // 则使用者打其中任一个都查不到，且 `set.abbr` 会连着逗号一起显示；故拆开、每个都建索引
        const aliases = short.split(/[,，、]/).map(a => a.trim()).filter(Boolean)
        if (aliases[0]) set.abbr = aliases[0]
        for (const one of aliases) {
          // 已有全名占着的键不覆盖（全名优先）
          if (!out.byAbbr.has(one)) out.byAbbr.set(one, ds.name)
        }
      }
      for (const [idx, one] of Object.entries(ds.idxs ?? {})) {
        if (!one?.name) continue
        set.idxs[idx] = one.name
        const entry: ArtiEntry = { name: one.name, set: ds.name, idx: Number(idx) || 0 }
        out.byName.set(one.name, entry)
        // 原神的部位由圣遗物 id 决定；星铁的 data.json 不给部位 id，故这一支只对原神生效
        if (one.id !== undefined && one.id !== "") {
          const id = String(one.id)
          out.byId.set(id, entry)
          // 同一套的圣遗物 id 共享前两位
          if (!out.byPrefix.has(id.slice(0, 2))) out.byPrefix.set(id.slice(0, 2), ds.name)
        }
        /*
         * **星铁的遗器 id 在 `idxs[*].ids` 里，是「id → 星级」的表**（一件二到五星四个 id）。星铁 `data.json`
         * 没有 `idxs[*].id`，只认那一项就等于星铁 `byId` 恒为空表——而星铁面板源给的正是 id（`tid`），
         * 表现是**遗器六格全空白而评分照常有**。星级也一并记下：源不给星级、而四星词条档位与五星不同。
         */
        for (const [id, star] of Object.entries(one.ids ?? {})) {
          if (!id) continue
          out.byId.set(id, { ...entry, star: Number(star) || 5 })
        }
      }
      out.sets.set(ds.name, set)
    }

    this.#cache.set(game, out)
    return out
  }

  /**
   * 按 id 查一件圣遗物
   *
   * 两级：先按整串相等查，查不到再按原神那套 id 编码折算（见 {@link GS_ID_POS}）。
   * @param game 游戏
   * @param id 圣遗物 id
   * @returns 条目；查不到时 undefined
   */
  byId(game: SetGame, id: string | number): ArtiEntry | undefined {
    const key = String(id)
    const direct = this.#load(game).byId.get(key)
    if (direct) return direct
    if (game !== "gs" || !/^\d{5}$/.test(key)) return undefined

    // 五位 id 前两位定套装、第四位定部位；元数据记的是某星级那份，玩家那件末位随星级不同，整串比不上
    const set = this.set(game, key)
    const pos = GS_ID_POS[Number(key[3]) - 1]
    const name = pos === undefined ? undefined : set?.idxs[String(pos)]
    if (!set || !name || pos === undefined) return undefined
    return { name, set: set.name, idx: pos }
  }

  /**
   * 按名称查一件圣遗物
   * @param game 游戏
   * @param name 圣遗物名
   * @returns 条目；查不到时 undefined
   */
  byName(game: SetGame, name: string): ArtiEntry | undefined {
    return this.#load(game).byName.get(name.trim())
  }

  /**
   * 按 id 或名称查一件圣遗物
   *
   * 两条路都要留：原神的数据源给 id，星铁与米游社给名字。
   * @param game 游戏
   * @param id 圣遗物 id，可为空
   * @param name 名称，可为空
   * @returns 条目；查不到时 undefined
   */
  find(game: SetGame, id: string | number | undefined, name?: string): ArtiEntry | undefined {
    const byId = id === undefined || id === "" ? undefined : this.byId(game, id)
    return byId ?? (name ? this.byName(game, name) : undefined)
  }

  /**
   * 按套装名或简称查一套
   *
   * 三级：全名 → **简称** → 五位圣遗物 id（按前两位折算）。**简称这一级不可省**：使用者打的是「深林」「宗室」，
   * 而元数据里是「深林的记忆」「昔日宗室之仪」，只认全名则 `#胡桃换深林` 一律回「没认出要换成什么」。
   * @param game 游戏
   * @param name 套装名、简称或圣遗物 id
   * @returns 套装；查不到时 undefined
   */
  set(game: SetGame, name: string | number): ArtiSetEntry | undefined {
    const key = String(name).trim()
    const sets = this.#load(game)
    const direct = sets.sets.get(key)
    if (direct) return direct
    const byAbbr = sets.byAbbr.get(key)
    if (byAbbr) {
      const got = sets.sets.get(byAbbr)
      if (got) return got
    }
    if (game === "gs" && /^\d{5}$/.test(key)) {
      const setName = sets.byPrefix.get(key.slice(0, 2))
      if (setName) return sets.sets.get(setName)
    }
    return undefined
  }

  /**
   * 取星铁的星级档位表
   *
   * 主副词条的基数与步进按星级不同，故遗器的词条值必须查它才算得出。
   * @param game 游戏，只有 `sr` 有
   * @returns 档位表；文件缺失时 undefined
   */
  srMeta(game: SetGame): SrArtiMetaFile | undefined {
    if (game !== "sr") return undefined
    if (this.#srMeta.has(game)) return this.#srMeta.get(game)
    const got = readJson<SrArtiMetaFile>(join(this.#dir, "meta-sr", "artifact", "meta.json"))
    this.#srMeta.set(game, got)
    return got
  }

  /**
   * 索引是否可用
   * @param game 游戏
   * @returns 有套装条目时为真
   */
  ready(game: SetGame): boolean {
    return this.#load(game).sets.size > 0
  }
}
