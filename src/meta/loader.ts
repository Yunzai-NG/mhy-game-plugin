/**
 * 模块职责：元数据的装载与查询 —— 角色 / 武器 / 光锥的 id、别名、图标
 * 依赖方向：只读磁盘上由 {@link MetaInstaller} 装好的目录；不发请求、不碰内核
 * 生命周期：随插件 setup 造一个实例，首次查询时按游戏懒加载并常驻内存
 * 注意事项：只读 `data.json` 与 `alias.json`，不 `import()` 任何 JS；落盘的 `calc.js` / `artis.js` 只由 meta/sandbox.ts 求值。
 *          原神旅行者按元素选目录，「冰主」一类名字也按已装的元素目录生成 —— 缺了它们会落到星铁的同名别名
 *          （星铁「冰主」是穹·记忆），回一句「原神没有冰主」。其余游戏即使 id 相同也不借旅行者目录。
 *          图标返回**相对 `meta-<游戏>/` 的路径**，由渲染桥拼成 URL。元数据未装时全部查询返回
 *          undefined 而不抛错。绝区零那份包形态与另两份一致，
 *          多出 `equip`（驱动盘套装）与 `bangboo`（邦布）两层，代理人职业记在 `prof` 上。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { elemOf } from "./elem.js"
import { isGsTraveler, travelerNamesOf } from "./traveler.js"
import type { Logger } from "@yunzai-ng/types"
import type { AliasTable } from "./alias.js"
import type { MetaGame } from "./download.js"

/** 一个角色 / 光锥 / 武器条目 */
export interface MetaItem {
  /** 物品 id，米游社与抽卡记录用的就是它 */
  id: string
  /** 全名 */
  name: string
  /** 简称，模板里格子窄时用它 */
  abbr: string
  /** 星级 */
  star: number
  /** 元素 / 命途，武器没有 */
  elem?: string
  /** 武器类型，角色没有 */
  weapon?: string
  /**
   * 职业 / 特性（强攻、击破、异常……），**只有绝区零的代理人有**
   *
   * 与 {@link elem} 分开：绝区零一位代理人同时有属性与职业，两者都要显示。
   */
  prof?: string
  /**
   * 武器 / 光锥自身的类别，角色没有
   *
   * 原神是 `polearm` 一类英文键、星铁是命途中文名。**它来自目录层级而非 `data.json`**：原神武器数据里
   * 没有这一栏，而图鉴要用它取类型图标与中文名。
   */
  type?: string
  /** 头像，相对元数据根目录 */
  face?: string
  /** 抽卡立绘，相对元数据根目录 */
  gacha?: string
  /** 侧脸，相对元数据根目录 */
  side?: string
  /**
   * 图标，相对元数据根目录 —— **武器与光锥用这一项，角色没有**
   *
   * 武器目录下的图在目录根而非 `imgs/`（`weapon/bow/信使/icon.webp`），故与 `face` 分两键。
   * 少了它，凡要画武器小图的模板（今日材料、练度统计）都只能拿到空串。
   */
  icon?: string
  /** 精炼后的图标，原神武器独有 */
  awaken?: string
  /**
   * 立绘，相对元数据根目录 —— **星铁光锥用这一项**
   *
   * 原神武器立绘叫 `gacha.webp`（记在 {@link gacha} 上），星铁光锥的叫 `splash.webp`。面板星铁那块读
   * `weapon.splash`，只认 `gacha` 会让**光锥图整块空白**。
   */
  splash?: string
  /**
   * 这是角色、武器，还是绝区零那两族 —— 取自它在哪个目录下
   *
   * 日历要「这个游戏的全部角色」，据 `type` 反着筛不如直接记一笔。`equip`/`bangboo` 只有绝区零有。
   */
  kind?: "character" | "weapon" | "equip" | "bangboo"
  /**
   * 生日，形如 `7-15`；只有原神角色有
   *
   * 装载时记下而非每次读 `data.json`：日历要一次问过全部角色的生日（一百来次文件读取）。
   */
  birth?: string
  /**
   * 预计实装时间（毫秒时间戳），只有尚未实装的角色有
   *
   * **它在 `character/data.json` 那份汇总索引里、不在角色自己的 `data.json`**。实装后维护者不删它，
   * 故判据是「时间过去了没有」而非「有没有这一项」，见 {@link isReleased}。
   */
  eta?: number
}

/**
 * 判一个条目是否已实装
 *
 * 没有 `eta` 一律算已实装，有则看它过去了没有。**星铁元数据不带 `eta`**，故对星铁恒为真——无从判定。
 * @param item 条目；缺省视作已实装，好让调用方不必先判空
 * @returns 已实装时为真
 */
export function isReleased(item?: Pick<MetaItem, "eta">): boolean {
  const eta = item?.eta
  if (!eta) return true
  return eta < Date.now()
}

/**
 * 一个条目的整份 `data.json`
 *
 * 字段随游戏与条目类型不同，故只列面板计算要用的那几段，其余以索引签名放行。
 */
export interface MetaDetail extends Record<string, unknown> {
  /** 等级属性曲线；原神是 `{keys, details}`，星铁是"突破阶数 → 该阶数据" */
  attr?: unknown
  /** 星铁光锥的成长值 */
  growAttr?: Record<string, number>
  /** 技能 id → 天赋键（`a` / `e` / `q` 等） */
  talentId?: Record<string, string>
  /** 技能 id → 元素，旅行者按天赋定元素 */
  talentElem?: Record<string, string>
  /** 天赋键 → 生效命座号，或命座号 → 天赋键 */
  talentCons?: Record<string, string | number>
  /** 星铁的行迹表：行迹 id → 键与值 */
  tree?: Record<string, { key?: string; value?: number }>
  /** 武器的精炼效果名，原神独有 */
  affixTitle?: string
  /** 武器的精炼效果，原神独有：`text` 里的 `$[n]` 由 `datas[n]` 逐档代入 */
  affixData?: { text?: string; datas?: Record<string, readonly string[]> }
  /** 星铁光锥的技能：名称、描述与数值表 */
  skill?: { name?: string; desc?: string; tables?: Record<string, readonly (number | string)[]> }
  /**
   * 音擎的高级效果，**绝区零独有**：与 {@link skill} 同形，`desc` 里的 `$N[i]` 由 `tables[N]` 逐档代入
   *
   * `tables` 一项是五档值（下标即叠影 - 1），存百分点（`18` 即 18%）、百分号在 `desc` 里。
   * 逐档相同的数字（持续秒数、层数）写死在 `desc` 里、不进 `tables`。
   * **也有包是「叠影档 → 整句」的逐档形态**，故两种都要认（见 `views/panel.ts` 的 `zzzWeaponDesc`），
   * 只认一种会让另一种的音擎效果整块空白。
   */
  talents?:
    | { name?: string; desc?: string; tables?: Record<string, readonly (number | string)[]> }
    | Record<string, { name?: string; desc?: readonly string[] }>
  /**
   * 代理人的六族技能，**绝区零独有**：`basic` / `dodge` / `assist` / `special` / `chain` / `core`
   *
   * 每族一份 `{name, desc, tables}`，`tables` 一项是「一行倍率」且**逐等级各一条**（十二档，对应 1~12 级），
   * 伤害层由它取倍率。`isSame` 为真的行是「逐等级相同」，只存一条。
   */
  talent?: Record<
    string,
    {
      /** 族名，如 `普通攻击` */
      name?: string
      /** 长文，已带标签 */
      desc?: readonly string[]
      /** 逐行数值表 */
      tables?: readonly { name?: string; values?: readonly string[]; isSame?: boolean }[]
    }
  >
}

/** 一个游戏的元数据 */
interface GameMeta {
  /** id → 条目 */
  byId: Map<string, MetaItem>
  /** 名称与别名 → 条目 */
  byName: Map<string, MetaItem>
  /** id → 该条目的绝对目录，{@link MetaLoader.detail} 据此读整份 `data.json` */
  dirs: Map<string, string>
  /**
   * 全部条目，按装载顺序
   *
   * 与 `byId` 分开：旅行者按元素分成好几个目录却共用一个 id，只走 `byId` 会只剩最后一个。
   */
  all: MetaItem[]}

/** `data.json` 里本模块用到的字段 */
interface RawData {
  /** id */
  id?: number | string
  /** 全名 */
  name?: string
  /** 简称 */
  abbr?: string
  /** 星级 */
  star?: number
  /** 元素 */
  elem?: string
  /** 武器类型 */
  weapon?: string
  /** 职业 / 特性，绝区零独有 */
  prof?: string
  /** 生日，形如 `7-15` */
  birth?: string
}

/** 造装载器需要的东西 */
export interface MetaLoaderOptions {
  /** 元数据根目录，与 {@link MetaInstaller} 的 `dir` 一致 */
  dir: string
  /** 日志器 */
  logger: Logger
  /**
   * 别名表
   *
   * 可选：缺它时 {@link MetaLoader.byName} 只认全名与元数据自带的简称，「椰羊」一类社区叫法查不到。
   * 读的是**已装元数据**里的 `character/alias.json`，故未装元数据时同样为空表；留成可选只为让既有测试无须构造它。
   */
  alias?: AliasTable
}

/**
 * 读一个 JSON 文件，失败时返回 undefined
 *
 * 元数据是下载来的，个别文件损坏不应使整个装载失败——少一个角色远好过一个都没有。
 * @param path 文件路径
 * @returns 解析结果；读不到或解不开时 undefined
 */
function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return undefined
  }
}

/**
 * 列出一个目录下的子目录名
 * @param path 目录
 * @returns 子目录名；目录不存在时空数组
 */
function subDirs(path: string): string[] {
  if (!existsSync(path)) return []
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter(it => it.isDirectory())
      .map(it => it.name)
  } catch {
    return []
  }
}

/**
 * 元数据装载器
 *
 * 按游戏懒加载：没查过星铁就不读星铁的三千个文件。
 */
export class MetaLoader {
  readonly #dir: string
  readonly #logger: Logger
  readonly #cache = new Map<MetaGame, GameMeta>()
  /**
   * 整份 `data.json` 的缓存，键为 `<游戏>:<id>`
   *
   * 与 `#cache`（两张索引表）分开：这是逐角色详情，面板计算每个角色读一次，全量预读等于把三千个文件都解析一遍。
   */
  readonly #detail = new Map<string, MetaDetail | undefined>()
  /**
   * 路径存在性的缓存，见 {@link MetaLoader.exists}
   *
   * 与另两份缓存一同在 {@link reload} 里清掉：元数据更新后新角色的图才认得出。
   */
  readonly #exists = new Map<string, boolean>()
  /**
   * 别名表，可选
   *
   * 缺它时 {@link byName} 只认全名与元数据自带的简称——「岩王帝君」查不到钟离，而这是社区最常见的输入形态。
   */
  readonly #alias: AliasTable | undefined

  /**
   * @param opts 装载器选项
   */
  constructor(opts: MetaLoaderOptions) {
    this.#dir = opts.dir
    this.#logger = opts.logger
    this.#alias = opts.alias
  }

  /**
   * 丢掉已装载的缓存
   *
   * 元数据更新之后调用，使新角色即时可查而无须重启。
   */
  reload(): void {
    this.#cache.clear()
    this.#detail.clear()
    this.#exists.clear()
  }

  /**
   * 装载"一份根表 + 一个 imgs 目录"那种形态的一族
   *
   * 驱动盘套装与邦布各只有三四十条、每条也小，故落成一份 `data.json` 加一个 `imgs/`，而非逐条一个目录。
   * **图按条目名取而非按 id**：`equip/imgs/啄木鸟电音.webp`，造包脚本按名字落、两侧要对上。
   * @param meta 正在装的索引表
   * @param root 该游戏的元数据根目录
   * @param game 游戏
   * @param kind 哪一族
   */
  #loadFlat(meta: GameMeta, root: string, game: MetaGame, kind: "equip" | "bangboo"): void {
    const table = readJson<Record<string, RawData>>(join(root, kind, "data.json"))
    if (!table) return
    for (const raw of Object.values(table)) {
      if (!raw?.name) continue
      const item: MetaItem = {
        id: String(raw.id ?? ""),
        name: raw.name,
        abbr: raw.abbr ?? this.#alias?.abbr(game, raw.name) ?? raw.name,
        star: Number(raw.star) || 0,
        kind
      }
      const rel = `meta-${game}/${kind}/imgs/${raw.name}.webp`
      if (existsSync(join(root, kind, "imgs", `${raw.name}.webp`))) item.icon = rel
      if (item.id) meta.byId.set(item.id, item)
      meta.byName.set(item.name, item)
      if (item.abbr !== item.name) meta.byName.set(item.abbr, item)
      meta.all.push(item)
      // 详情直接塞进缓存：这一族没有各自的目录，`detail()` 那条按目录读盘的路走不通
      if (item.id) this.#detail.set(`${game}:${item.id}`, raw as MetaDetail)
    }
  }

  /**
   * 装载一个游戏的元数据
   * @param game 游戏
   * @returns 该游戏的两张索引表
   */
  #load(game: MetaGame): GameMeta {
    const cached = this.#cache.get(game)
    if (cached) return cached

    const meta: GameMeta = { byId: new Map(), byName: new Map(), dirs: new Map(), all: [] }
    const root = join(this.#dir, `meta-${game}`)

    // 汇总索引 `character/data.json`（id → eta）：只从它取 eta 一项，其余各栏逐角色那份都有。原神有、星铁没有
    const etas = new Map<string, number>()
    const summary = readJson<Record<string, { eta?: number }>>(join(root, "character", "data.json"))
    for (const [id, one] of Object.entries(summary ?? {})) {
      if (typeof one?.eta === "number") etas.set(id, one.eta)
    }

    // 驱动盘与邦布落成"一份根表 + 一个 imgs 目录"，与逐条一个目录的那两族读法不同
    for (const kind of ["equip", "bangboo"] as const) this.#loadFlat(meta, root, game, kind)

    // 逐条一个目录的那两族：`character` 与 `weapon` 三个游戏都有
    for (const kind of ["character", "weapon"] as const) {
      const base = join(root, kind)
      for (const name of subDirs(base)) {
        // 星铁的武器按命途再分一层，故两层都试
        for (const dir of [join(base, name), ...subDirs(join(base, name)).map(it => join(base, name, it))]) {
          const raw = readJson<RawData>(join(dir, "data.json"))
          if (!raw?.name) continue
          const rel = dir.slice(root.length + 1).replaceAll("\\", "/")
          const item: MetaItem = {
            id: String(raw.id ?? ""),
            name: raw.name,
            // 简称来源随种类分两处：角色走 `abbr`（`character/alias.js`），武器/音擎走 `weaponAbbr`
            // （`weapon/alias.js`）；用角色那张表查武器一个都命中不了、短名会恒回落成全名
            abbr:
              raw.abbr ??
              (kind === "weapon" ? this.#alias?.weaponAbbr(game, raw.name) : this.#alias?.abbr(game, raw.name)) ??
              raw.name,
            star: Number(raw.star) || 0,
            kind
          }
          if (raw.elem) item.elem = raw.elem
          if (raw.weapon) item.weapon = raw.weapon
          if (raw.prof) item.prof = raw.prof
          if (raw.birth) item.birth = raw.birth
          const eta = etas.get(item.id)
          if (eta !== undefined) item.eta = eta
          // 武器 / 光锥的类别取自目录层级（`weapon/<类别>/<名称>`），原神的 data.json 里没有它
          if (kind === "weapon") {
            const at = rel.split("/")[1]
            if (at) item.type = at
          }
          for (const [key, file] of [
            ["face", "imgs/face.webp"],
            ["gacha", "imgs/gacha.webp"],
            ["side", "imgs/side.webp"],
            // 武器 / 光锥的图在目录根而非 `imgs/` 下，故另列四项；逐项判存在，角色不会被写上 icon、武器不会被写上 face
            ["icon", "icon.webp"],
            ["awaken", "awaken.webp"],
            ["gacha", "gacha.webp"],
            ["splash", "splash.webp"]
          ] as const) {
            if (existsSync(join(dir, file))) item[key] = `meta-${game}/${rel}/${file}`
          }
          if (item.id) meta.byId.set(item.id, item)
          meta.byName.set(item.name, item)
          if (item.abbr !== item.name) meta.byName.set(item.abbr, item)
          meta.all.push(item)
          // 目录同时按 id 与名称记一份：星铁的源只给光锥 id，米游社给的是名称
          if (item.id) meta.dirs.set(item.id, dir)
          meta.dirs.set(item.name, dir)
          // 旅行者按元素分目录、共用一个 id：另按「旅行者:<元素>」记一份。存档里的空 / 荧共用旅行者
          // id，但它们自己的目录只有 baseAttr、缺等级插值表，正确的曲线在 `旅行者/<元素>` 下，
          // 供 {@link detail} 按元素回退取用
          if (item.name === "旅行者" && item.elem) meta.dirs.set(`旅行者:${item.elem}`, dir)
        }
      }
    }

    if (game === "gs") {
      for (const item of meta.all) {
        if (item.name !== "旅行者" || !item.elem) continue
        const names = travelerNamesOf(item.elem)
        if (names.length === 0) continue
        // 按名取空：旅行者目录在部分包里也写着 10000005，按 id 取可能拿到的是旅行者那条
        const male = meta.byName.get("空")
        const traveler = {
          ...(male ?? item),
          id: "10000005",
          name: male?.name ?? "空",
          abbr: male?.abbr ?? "空",
          elem: item.elem
        }
        // 以已安装的元素目录生成别名，面板 id 仍用规范性别，由命令层回退到另一性别。
        for (const alias of names) {
          if (!meta.byName.has(alias)) meta.byName.set(alias, traveler)
        }
      }
    }

    if (meta.byId.size === 0) {
      this.#logger.debug(`[米游社][元数据] meta-${game} 尚未安装，图标与简称暂不可用`)
    }
    this.#cache.set(game, meta)
    return meta
  }

  /**
   * 按 id 查一个条目
   * @param game 游戏
   * @param id 物品 id
   * @returns 条目；查不到时 undefined
   */
  byId(game: MetaGame, id: string | number): MetaItem | undefined {
    return this.#load(game).byId.get(String(id))
  }

  /**
   * 列出一个游戏的全部条目
   *
   * 顺序即装载顺序。**同一个 id 的多个目录都会出现**——旅行者按元素分了七个目录却共用一个 id，
   * 日历生日那块要的正是「每个角色一条」，走 `byId` 会只剩最后一个。
   * @param game 游戏
   * @param kind 只要角色或只要武器；省略时两者都要
   * @returns 条目数组，调用方不应改动它
   */
  each(game: MetaGame, kind?: "character" | "weapon"): readonly MetaItem[] {
    const all = this.#load(game).all
    return kind ? all.filter(one => one.kind === kind) : all
  }

  /**
   * 按名称、简称或别名查一个条目
   *
   * 三级依次尝试：元数据全名与简称 → 别名表 → 小写形态。**别名表这一级不可省**：使用者打的是「椰羊」
   * 「岩王帝君」而非「优菈」「钟离」。别名表未装时退化为只认全名，不报错。
   * @param game 游戏
   * @param name 名称、简称或别名
   * @returns 条目；查不到时 undefined
   */
  byName(game: MetaGame, name: string): MetaItem | undefined {
    const key = name.trim()
    if (!key) return undefined
    const direct = this.#load(game).byName.get(key)
    if (direct) return direct

    // 别名表只收角色，武器与光锥不在其中
    const alias = this.#alias?.nameIn(game, key)
    if (alias) {
      const got = this.#load(game).byName.get(alias)
      if (got) return got
    }

    // 英文别名在别名表里已折成小写，这一级兜住「元数据里就是小写」的少数条目
    return this.#load(game).byName.get(key.toLowerCase())
  }

  /**
   * 按 id 或名称查一个条目
   *
   * 抽卡记录同时给了 `item_id` 与 `name`，但早年的记录 `item_id` 为空串，故两条路都要留。
   * @param game 游戏
   * @param id 物品 id，可为空
   * @param name 名称
   * @returns 条目；查不到时 undefined
   */
  find(game: MetaGame, id: string | number | undefined, name: string): MetaItem | undefined {
    const byId = id ? this.byId(game, id) : undefined
    return byId ?? this.byName(game, name)
  }

  /**
   * 读一个条目的整份 `data.json`
   *
   * 索引只留查图标与简称要用的字段，面板计算另需 `attr`/`talentId`/`talentCons`/`tree`，那几段合计几十 KB、
   * 全存内存是几百兆，故**按需读、读过即缓存**。
   *
   * 旅行者要传 `elem`：存档里空 / 荧共用旅行者 id，但它们自己的目录只有 `baseAttr`、缺等级插值表；
   * 正确的曲线在 `旅行者/<元素>` 下，不按元素回退则白值算不出、面板整体归零而不报错。
   * @param game 游戏
   * @param id 物品 id
   * @param elem 元素；仅旅行者需要，用于回退到 `旅行者/<元素>` 目录
   * @returns 整份 `data.json`；条目或文件不存在时 undefined
   */
  detail(game: MetaGame, id: string | number, elem?: string): MetaDetail | undefined {
    // 先装载再查缓存，顺序不可颠倒：flat 那两族的详情是装载时直接塞进缓存的（见 #loadFlat），
    // 先查缓存会在冷启动时一律落空、套装效果整族取不到（伤害层「套装 buff 一条都没有」的成因）
    const loaded = this.#load(game)
    // 旅行者按元素回退：判据是 id 白名单而非名称 —— 存档里旅行者是空 / 荧，其目录 name 就叫「空」「荧」，
    // 只有 `旅行者/<元素>` 那份的 name 才是「旅行者」。缓存键带元素，否则空 / 荧两条会互相覆盖成同一份
    const element = game === "gs" && isGsTraveler(id) ? elemOf(elem) : ""
    const useElem = !!element && loaded.dirs.has(`旅行者:${element}`)
    const key = useElem ? `${game}:旅行者:${element}` : `${game}:${id}`
    if (this.#detail.has(key)) return this.#detail.get(key)
    const dir = useElem ? loaded.dirs.get(`旅行者:${element}`) : loaded.dirs.get(String(id))
    const got = dir ? readJson<MetaDetail>(join(dir, "data.json")) : undefined
    this.#detail.set(key, got)
    return got
  }

  /**
   * 一个游戏的元数据是否可用
   * @param game 游戏
   * @returns 有条目时为真
   */
  ready(game: MetaGame): boolean {
    return this.#load(game).byId.size > 0
  }

  /**
   * 判一个相对元数据根目录的路径是否存在
   *
   * 面板图标按「变体在就用变体、不在回落基础图」取（见 views/panel.ts 的 `charImgs`），不判存在性就会让
   * 没有时装图 / 小头像的角色对应格子指向 404。**结果按路径缓存且不设过期**，{@link reload} 会连它一起清掉。
   * @param rel 相对元数据根目录的路径，形如 `meta-gs/character/胡桃/imgs/face.webp`
   * @returns 存在时为真
   */
  exists(rel: string): boolean {
    const cached = this.#exists.get(rel)
    if (cached !== undefined) return cached
    const got = existsSync(join(this.#dir, rel))
    this.#exists.set(rel, got)
    return got
  }

  /**
   * 把一个相对元数据根目录的路径拼成绝对路径
   *
   * `#原图` 要它：模板里立绘是相对路径，作为文件发出去要的是磁盘绝对位置。**不判存在性**——调用方本就要处理「发不出去」。
   * @param rel 相对元数据根目录的路径
   * @returns 绝对路径
   */
  pathOf(rel: string): string {
    return join(this.#dir, rel)
  }
}
