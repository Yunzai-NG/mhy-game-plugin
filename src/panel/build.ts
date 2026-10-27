/**
 * 模块职责：面板装配 —— 把库里存的一份面板 + 元数据，装成模板与伤害层能直接用的形态
 * 依赖方向：依赖 meta/{loader,arti,arti-set,buffs} 与 panel/{attr,arti-attr,artis-mark}；不碰 IO
 * 生命周期：随插件 setup 造一个实例，每次装配一次调用
 * 注意事项：这一层是「存的东西」与「算的东西」之间唯一的转换处。**词条求值必须在属性计算之前**：存的是数字 id，
 *          `calcAttr` 要的是 `{key, value}`，顺序颠倒则读到 undefined、每项只剩角色白值、不报错只是明显偏低。
 *          元数据缺失时返回 undefined 而非抛错（缺省不装元数据，应提示使用者先装）。
 */
import type { ArtiGame, ArtiMetaTable } from "../meta/arti.js"
import type { ArtiSetTable } from "../meta/arti-set.js"
import type { BuffTable } from "../meta/buffs.js"
import type { MetaDetail, MetaItem, MetaLoader } from "../meta/loader.js"
import type { StoredAvatar } from "../store/panel.js"
import { artiAttrs } from "./arti-attr.js"
import type { MainAttr, SubAttr } from "./arti-attr.js"
import { calcAttr } from "./attr.js"
import type { AttrArti, AttrChar, AttrWeaponMeta, AttrWeaponState } from "./attr.js"
import type { AttrResult } from "./attr-data.js"
import { markAll, markCfg } from "./score/index.js"
import type { CfgInput, CharRule, MarkCfg, MarkResult } from "./score/index.js"
import { calcPromote, gsWeaponAttr, srLevelAttr } from "./level.js"
import { isGsTraveler, unfoldCons } from "./profile/index.js"
import type { SelfCalcGame } from "./profile/index.js"

/** 装好的一件圣遗物 / 遗器 */
export interface BuiltArti {
  /** 部位，1 起 */
  idx: number
  /** 名称 */
  name: string
  /** 套装名 */
  set: string
  /** 强化等级 */
  level: number
  /** 星级 */
  star: number
  /** 图标，相对元数据根目录 */
  img?: string
  /** 主词条 */
  main?: MainAttr
  /** 副词条 */
  attrs: SubAttr[]
}

/** 装好的武器 / 光锥 */
export interface BuiltWeapon {
  /** 名称 */
  name: string
  /** 简称 */
  abbr: string
  /** 等级 */
  level: number
  /** 突破阶数 */
  promote: number
  /** 精炼 / 叠影；源没给时缺省为 1（见 {@link hasAffix}） */
  affix: number
  /**
   * 源确实给了精炼 / 叠影
   *
   * 星铁光锥 buff 按 `skill.tables[idx][affix-1]` 取值，源没给叠影时整条 buff 应跳过；
   * 按缺省的 1 取会凭空多一档加成。取数方据本字段决定用不用 {@link affix}。
   */
  hasAffix?: boolean
  /** 星级 */
  star: number
  /** 武器类型 / 命途 */
  type?: string
  /** 图标，相对元数据根目录 */
  img?: string
  /** 立绘，相对元数据根目录 */
  splash?: string
  /**
   * 武器自身在当前等级 / 突破下的属性
   *
   * 原神是 `{atkBase, <副属性键>}`，星铁是那一档全部属性。模板直接读它，缺了那格印 `undefined`；值是数值，格式化留给视图层。
   */
  attrs?: Record<string, number>
  /**
   * 当前精炼 / 叠影下的效果说明
   *
   * 模板写 `{{@weapon.desc?.desc}}`；不给它会印出字面 `undefined`（可选链只保证不抛错，取不到值照样印出）。
   */
  desc?: { name: string; desc: string }
}

/** 装好的一个角色面板 */
export interface BuiltPanel {
  /** 游戏 */
  game: SelfCalcGame
  /** uid */
  uid: string
  /** 角色 id */
  id: string
  /** 全名 */
  name: string
  /** 简称 */
  abbr: string
  /** 星级 */
  star: number
  /** 元素 / 命途 */
  elem: string
  /**
   * 角色的武器类型 / 命途，取自元数据的 `weapon` 字段
   *
   * 星铁面板模板按它选天赋表（`记忆` 多两格忆灵技、`欢愉` 多一格欢愉技），缺了一律按四格画、少那两格。
   */
  charWeapon?: string
  /** 等级 */
  level: number
  /** 突破阶数 */
  promote: number
  /** 命座 / 星魂 */
  cons: number
  /** 好感度 */
  fetter: number
  /** 时装 id */
  costume: number
  /** 天赋等级，不含命座加成 */
  talent: Record<string, number>
  /**
   * 天赋等级，含命座加成
   *
   * 库里只存 {@link talent}，此份由 {@link unfoldCons} 在装配时折出，供伤害计算与面板详情使用。
   */
  talentLevel: Record<string, number>
  /**
   * 天赋键 → 生效命座号，或命座号 → 天赋键
   *
   * 视图层取天赋图标要它：原神绝大多数角色元数据里没有 `icons/talent-e.webp`，战技与爆发的图标取「提升该天赋的那个命座」的图，
   * 缺了它两格天赋图标一律空白（浏览器对 404 的图只是不画）。
   */
  talentCons?: Record<string, string | number>
  /**
   * 行迹属性小点，星铁独有：行迹 id → `{key, value}`
   *
   * 模板那张行迹盘上十个小点各有自己的图标，按此表逐个替换；不给它则十个点全画成同一张图。
   */
  tree?: Record<string, { key?: string; value?: number }>
  /** 已激活的行迹 id */
  trees: string[]
  /** 数据源展示名 */
  source: string
  /** 面板更新时间戳 */
  at?: number
  /** 武器 */
  weapon?: BuiltWeapon
  /** 逐件圣遗物 */
  artis: BuiltArti[]
  /** 套装名 → 件数 */
  sets: Record<string, number>
  /** 面板属性 */
  attr: AttrResult
  /** 白值表 */
  base: Record<string, number>
  /** 圣遗物评分 */
  mark?: MarkResult
  /**
   * 评分配置
   *
   * `artis-mark` 模板要读它的 `attrs`（逐词条权重）与 `posMaxMark`（各部位满分参照）；与 {@link mark} 同源，一并算好带出。
   */
  markCfg?: MarkCfg
  /** 各类图，相对元数据根目录 */
  imgs: Record<string, string>
}

/**
 * 数据源标识 → 展示名
 */
const SOURCE_NAMES: Readonly<Record<string, string>> = {
  enka: "Enka.Network",
  mgg: "MiniGG-Api",
  hanxuan: "X-Enka",
  lyln: "Lyln-Enka",
  homo: "Mihomo",
  "avocado.wiki": "鳄梨",
  enkaHSR: "EnkaHSR",
  mysPanel: "米游社",
  mysPanelHSR: "米游社",
  mysPanelZZZ: "米游社",
  enkaZZZ: "Enka.Network",
  change: "面板变换"
}

/**
 * 数据源标识 → 图上印的名字
 * @param from 存档里的 `from`
 * @returns 展示名；不认得时原样返回
 */
export function sourceName(from: string | undefined): string {
  return SOURCE_NAMES[from ?? ""] ?? from ?? ""
}

/** 各游戏的圣遗物部位数 */
const POS_COUNT: Readonly<Record<SelfCalcGame, number>> = { gs: 5, sr: 6 }

/** 造装配器需要的东西 */
export interface PanelBuilderOptions {
  /** 元数据装载器 */
  meta: MetaLoader
  /** 词条元数据表 */
  arti: ArtiMetaTable
  /** 套装索引 */
  sets: ArtiSetTable
  /** 静态 buff 表 */
  buffs: BuffTable
  /**
   * 取一个角色的自定义评分规则
   *
   * 由沙箱提供（`character/<名>/artis.js`），缺省关闭伤害计算时为 undefined，评分回落默认权重表。
   */
  artisRule?: (game: ArtiGame, name: string) => CharRule | undefined
}

/**
 * 面板装配器
 *
 * 一个实例管两个游戏。不留缓存：面板每次按最新库内容装，缓存会让「刚更新完却看到旧面板」。
 */
export class PanelBuilder {
  readonly #opts: PanelBuilderOptions

  /**
   * @param opts 选项
   */
  constructor(opts: PanelBuilderOptions) {
    this.#opts = opts
  }

  /**
   * 元数据是否够用
   * @param game 游戏
   * @returns 角色索引与词条元数据都在时为真
   */
  ready(game: SelfCalcGame): boolean {
    return this.#opts.meta.ready(game) && this.#opts.arti.ready(game)
  }

  /**
   * 装一个角色的面板
   * @param game 游戏
   * @param uid uid
   * @param one 库里存的角色面板
   * @returns 装好的面板；元数据缺失或角色查不到时 undefined
   */
  build(game: SelfCalcGame, uid: string, one: StoredAvatar): BuiltPanel | undefined {
    const { meta, arti, buffs } = this.#opts
    const item = meta.byId(game, one.id)
    if (!item) return undefined

    const elem = one.elem ?? item.elem ?? ""
    // 带元素：旅行者的等级曲线在 `旅行者/<元素>` 下
    const detail = meta.detail(game, one.id, elem)
    const level = Number(one.level) || 1
    // 突破阶数缺失时按等级反推（星铁米游社接口不给），缺它会让白值按 0 阶算、面板整体偏低而不报错；取两者较大值
    const promote = Math.max(Number(one.promote) || 0, calcPromote(level, game))
    const talent = one.talent ?? {}
    // 库里存不含命座加成的等级，含加成的那份在此折出
    const talentLevel = unfoldCons(talent, Number(one.cons) || 0, detail ?? {}, game)
    const trees = one.trees ?? []

    const weapon = this.#buildWeapon(game, one)
    const artis = this.#buildArtis(game, one)
    const setCount = this.#countSets(artis)

    const char: AttrChar = { id: one.id, name: item.name }
    if (elem) char.elem = elem
    if (item.weapon) char.weapon = item.weapon
    if (game === "gs") {
      const got = levelAttr(detail, "gs")
      if (got) char.attr = got as AttrChar["attr"]
    } else {
      const got = levelAttr(detail, "sr")
      if (got) char.srAttr = got as AttrChar["srAttr"]
      if (detail?.tree) char.tree = detail.tree
    }

    const weaponMeta = this.#weaponMeta(game, one)
    const weaponLevel = Number(one.weapon?.level) || 1
    const weaponState: AttrWeaponState = {
      level: weaponLevel,
      promote: Math.max(Number(one.weapon?.promote) || 0, calcPromote(weaponLevel, game)),
      affix: Number(one.weapon?.affix) || 1
    }

    const { attr, base } = calcAttr(
      {
        game,
        char,
        level,
        promote,
        trees,
        artis: artis.map(toAttrArti),
        sets: setCount,
        ...(weaponMeta ? { weapon: weaponMeta, weaponState } : {})
      },
      buffs
    )

    const out: BuiltPanel = {
      game,
      uid,
      id: one.id,
      name: item.name,
      abbr: item.abbr,
      star: item.star,
      elem,
      level,
      promote,
      cons: Number(one.cons) || 0,
      fetter: Number(one.fetter) || 0,
      costume: Number(one.costume) || 0,
      talent,
      talentLevel,
      trees,
      source: sourceName(one.from),
      artis,
      sets: setCount,
      attr,
      base,
      imgs: imgsOf(item),
      ...(one.at === undefined ? {} : { at: one.at }),
      ...(weapon ? { weapon } : {}),
      ...(item.weapon ? { charWeapon: item.weapon } : {}),
      ...(detail?.talentCons ? { talentCons: detail.talentCons } : {}),
      ...(game === "sr" && detail?.tree ? { tree: detail.tree } : {})
    }

    // 评分要用白值折算小词条，故必须在 calcAttr 之后
    if (artis.some(it => it.main)) {
      const list: Record<string, { name: string; set: string; level: number; main?: { key?: string; value?: number }; attrs?: { key?: string; value?: number }[] }> = {}
      for (const it of artis) {
        if (!it.main) continue
        list[String(it.idx)] = {
          name: it.name,
          set: it.set,
          level: it.level,
          main: { key: it.main.key, value: it.main.value },
          attrs: it.attrs.map(a => ({ key: a.key, value: a.value }))
        }
      }
      // 评分输入两处共用：`markAll` 内部会算一次配置、`artis-mark` 模板也要那份，重算一遍是刻意的（纯函数、只一遍表遍历）
      const markInput: CfgInput = {
        game,
        char: {
          id: one.id,
          name: item.name,
          abbr: item.abbr,
          baseAttr: { hp: base["hp"] ?? 0, atk: base["atk"] ?? 0, def: base["def"] ?? 0 },
          ...(elem ? { elem } : {})
        },
        attr: attr as unknown as Record<string, number>,
        cons: out.cons,
        sets: setCount,
        // 这两项供角色自定义权重规则判「某位置的主词条是什么」与「某套装在不在身上」
        mains: mainKeys(artis),
        setAbbr: this.#setAbbrs(game, setCount),
        // `bonusKey` 是武器副属性的词条键，部分自定义权重规则按它分档，缺了则那条判定恒为假
        ...(one.weapon?.name
          ? {
              weapon: {
                name: one.weapon.name,
                affix: weaponState.affix,
                ...(weaponMeta?.attr?.bonusKey ? { bonusKey: weaponMeta.attr.bonusKey } : {})
              }
            }
          : {}),
        // 旅行者的评分规则在 `旅行者/artis.js`（按元素分支），空 / 荧自己的目录里没有，按名取会恒走通用权重
        ...(this.#opts.artisRule
          ? { rule: this.#opts.artisRule(game, game === "gs" && isGsTraveler(one.id) ? "旅行者" : item.name) }
          : {})
      }
      out.mark = markAll(list, markInput, arti)
      out.markCfg = markCfg(markInput, arti)
    }

    return out
  }

  /**
   * 装武器展示信息
   * @param game 游戏
   * @param one 库里存的角色面板
   * @returns 武器；没有武器或查不到时 undefined
   */
  #buildWeapon(game: SelfCalcGame, one: StoredAvatar): BuiltWeapon | undefined {
    const w = one.weapon
    if (!w) return undefined
    const fallback = this.#weaponItem(game, w)
    if (!fallback) return undefined

    const level = Number(w.level) || 1
    const out: BuiltWeapon = {
      name: fallback.name,
      abbr: fallback.abbr,
      level,
      // 与角色同理：缺突破阶数时按等级反推，否则光锥白值按 0 阶算
      promote: Math.max(Number(w.promote) || 0, calcPromote(level, game)),
      affix: Number(w.affix) || 1,
      star: fallback.star
    }
    if (Number(w.affix) > 0) out.hasAffix = true
    // 武器类别在 `type`；`weapon` 是角色的武器种类，对武器条目恒空，读它则武器 buff 整族不加载
    if (fallback.type) out.type = fallback.type
    // **武器的图在 `icon` 而非 `face`**：武器目录下的图在根（`weapon/bow/信使/icon.webp`），取错则面板武器那格空白
    if (fallback.icon ?? fallback.face) out.img = fallback.icon ?? fallback.face
    // **立绘文件名两游戏不同**：原神武器 `gacha.webp`、星铁光锥 `splash.webp`；星铁读 `weapon.splash`，只认 `gacha` 会整块空白
    if (fallback.gacha ?? fallback.splash) out.splash = fallback.gacha ?? fallback.splash

    // 武器自身的属性：模板要 `weapon.attrs.atkBase` 与那个副属性
    const detail = this.#opts.meta.detail(game, fallback.id || fallback.name)
    const meta = this.#weaponMeta(game, one)
    if (meta) {
      const attrs: Record<string, number> = {}
      if (game === "gs") {
        const got = gsWeaponAttr(meta.attr ?? {}, out.level, out.promote)
        attrs["atkBase"] = got.atkBase
        if (got.attr?.key) attrs[got.attr.key] = got.attr.value
      } else {
        for (const [key, val] of Object.entries(srLevelAttr(meta.srAttr ?? {}, out.level, out.promote, meta.growAttr))) {
          attrs[key] = val
        }
      }
      out.attrs = attrs
    }
    const desc = weaponAffixDesc(detail, game, out.affix)
    if (desc) out.desc = desc
    return out
  }

  /**
   * 查库里那件武器在元数据里的条目
   *
   * 名字与 id 两条路都走：展柜源的武器名是取数当时查元数据得来的，那时元数据还没装好就只存下 id
   * —— 只认名字的话这件武器永远查不到，面板整块没有武器。
   * @param game 游戏
   * @param w 库里存的武器
   * @returns 元数据条目；两条路都查不到时 undefined
   */
  #weaponItem(game: SelfCalcGame, w: NonNullable<StoredAvatar["weapon"]>): MetaItem | undefined {
    const byName = w.name ? this.#opts.meta.byName(game, w.name) : undefined
    const byId = w.id !== undefined && w.id !== "" ? this.#opts.meta.byId(game, String(w.id)) : undefined
    // 原神的源给武器名，星铁的源只给光锥 id：各取各的主路，另一条兜底
    return game === "gs" ? (byName ?? byId) : (byId ?? byName)
  }

  /**
   * 取武器的属性元数据
   * @param game 游戏
   * @param one 库里存的角色面板
   * @returns 属性元数据；武器查不到时 undefined
   */
  #weaponMeta(game: SelfCalcGame, one: StoredAvatar): AttrWeaponMeta | undefined {
    const w = one.weapon
    if (!w) return undefined
    const item = this.#weaponItem(game, w)
    if (!item) return undefined
    const detail = this.#opts.meta.detail(game, item.id || item.name)

    const out: AttrWeaponMeta = { name: item.name }
    // 类别在 `type` 而非 `weapon`，读错则「命途不符不吃光锥 buff」的判定永不成立
    if (item.type) out.type = item.type
    if (game === "gs") {
      const got = weaponLevelAttr(detail)
      if (got) out.attr = got as AttrWeaponMeta["attr"]
    } else {
      const got = levelAttr(detail, "sr")
      if (got) out.srAttr = got as AttrWeaponMeta["srAttr"]
      if (detail?.growAttr) out.growAttr = detail.growAttr
      if (detail?.skill?.tables) out.tables = detail.skill.tables
    }
    return out
  }

  /**
   * 装逐件圣遗物，含词条求值
   * @param game 游戏
   * @param one 库里存的角色面板
   * @returns 逐件圣遗物，按部位升序
   */
  #buildArtis(game: SelfCalcGame, one: StoredAvatar): BuiltArti[] {
    const { arti, sets } = this.#opts
    const raw = one.artis ?? {}
    const out: BuiltArti[] = []

    for (let idx = 1; idx <= POS_COUNT[game]; idx++) {
      const ds = raw[String(idx)]
      if (!ds) continue

      // 名称与套装两条路：面板源记的 id（两游戏都按 id 查）或源直接给的名字。**回落用 `||` 而非 `??`**：
      // 源给的可能是空串，`??` 只在 undefined 时才往下走，那时名称留空、模板判据 `ds.name && ds.main` 为假，五格全空白而分数照常有
      const entry = sets.find(game, ds.id, ds.name)
      const name = ds.name || entry?.name || ""
      const set = ds.set || entry?.set || ""
      const built: BuiltArti = {
        idx,
        name,
        set,
        level: Number(ds.level) || 0,
        // 星铁的源不给星级，它藏在 `idxs[*].ids` 那张「id → 星级」表里；一律按五星折算会让四星遗器副词条偏高
        star: Number(ds.star) || entry?.star || 5,
        attrs: []
      }

      const got = artiAttrs(
        {
          ...(ds.mainId === undefined ? {} : { mainId: ds.mainId }),
          ...(ds.attrIds ? { attrIds: ds.attrIds } : {}),
          level: built.level,
          star: built.star
        },
        idx,
        game,
        arti,
        sets
      )
      if (got?.main) built.main = got.main
      if (got?.attrs) built.attrs = got.attrs
      out.push(built)
    }
    return out
  }

  /**
   * 数套装件数
   * @param artis 逐件圣遗物
   * @returns 套装名 → 件数
   */
  #countSets(artis: readonly BuiltArti[]): Record<string, number> {
    const out: Record<string, number> = {}
    for (const one of artis) {
      if (!one.set) continue
      out[one.set] = (out[one.set] ?? 0) + 1
    }
    return out
  }

  /**
   * 取套装的简称
   *
   * 角色自定义权重规则里写的是简称（`artis.is("冰套4")`），而件数表的键是全名。
   * @param game 游戏
   * @param sets 套装名 → 件数
   * @returns 套装全名 → 简称；没有简称的不列入
   */
  #setAbbrs(game: SelfCalcGame, sets: Readonly<Record<string, number>>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const name of Object.keys(sets)) {
      const short = this.#opts.sets.set(game, name)?.abbr
      if (short) out[name] = short
    }
    return out
  }
}

/**
 * 取逐位置的主词条键
 * @param artis 逐件圣遗物
 * @returns 位置 → 主词条键
 */
function mainKeys(artis: readonly BuiltArti[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const one of artis) {
    if (one.main?.key) out[String(one.idx)] = one.main.key
  }
  return out
}

/**
 * 把装好的圣遗物转成属性计算要的形态
 * @param one 装好的圣遗物
 * @returns 属性计算用的形态
 */
function toAttrArti(one: BuiltArti): AttrArti {
  const out: AttrArti = { attrs: one.attrs.map(it => ({ key: it.key, value: it.value })) }
  if (one.main) out.main = { key: one.main.key, value: one.main.value }
  return out
}

/**
 * 从整份 `data.json` 里取等级属性段
 *
 * 两游戏形态不同（原神 `{keys, details}`，星铁「突破阶数 → 数据」），此处只作类型收窄，解析交给 panel/level.ts。
 * @param detail 整份 `data.json`
 * @param game 游戏
 * @returns 属性段；缺失时 undefined
 */
function levelAttr(detail: MetaDetail | undefined, game: SelfCalcGame): unknown {
  const got = detail?.attr
  if (!got || typeof got !== "object") return undefined
  // 星铁那份以突破阶数为键，原神那份带 `details`，据此判它是不是本游戏的形态
  const hasDetails = "details" in (got as Record<string, unknown>)
  if (game === "gs" && !hasDetails) return undefined
  return got
}

/**
 * 拼武器在某一精炼档下的效果说明
 *
 * 与图鉴那份（views/weapon-wiki 的 `weaponAffix`）是两个口径：图鉴并排列五档，面板只要当前这一档。
 * 原神占位符 `$[n]`、值已是 `"20%"` 文本；星铁 `$n[i|f1|f2]%`、值是裸数字。
 * @param detail 整份 `data.json`
 * @param game 游戏
 * @param affix 精炼 / 叠影，1 起
 * @returns 效果名与说明；数据不全时 undefined
 */
function weaponAffixDesc(
  detail: MetaDetail | undefined,
  game: SelfCalcGame,
  affix: number
): { name: string; desc: string } | undefined {
  if (!detail) return undefined
  const at = Math.max(0, affix - 1)

  if (game === "sr") {
    const skill = detail.skill
    if (!skill?.desc) return undefined
    let desc = skill.desc
    // 占位符先从原串收齐再替换：边遍历边改写时，长度一变就可能跳过后面的占位符
    for (const got of [...skill.desc.matchAll(/\$(\d)\[(i|f1|f2)](%?)/g)]) {
      const [all, idx = "", format = "", mark = ""] = got
      const raw = Number(skill.tables?.[idx]?.[at] ?? 0)
      const value = mark === "%" ? `${trimZero(raw.toFixed(format === "f2" ? 2 : 1))}%` : trimZero(raw.toFixed(0))
      desc = desc.replaceAll(all, value)
    }
    return { name: skill.name ?? "", desc }
  }

  const text = detail.affixData?.text
  if (!text) return undefined
  let desc = text
  for (const got of [...text.matchAll(/\$\[(\d)]/g)]) {
    const [all, idx = ""] = got
    const value = detail.affixData?.datas?.[idx]?.[at] ?? ""
    // 数值裹一层 `<nobr>`：它不该被折行折断
    desc = desc.replaceAll(all, `<nobr>${value}</nobr>`)
  }
  return { name: detail.affixTitle ?? "", desc }
}

/**
 * 去掉小数末尾多余的零
 * @param one 已定小数位的数字串
 * @returns 去零后的串
 */
function trimZero(one: string): string {
  return one.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")
}

/**
 * 取原神武器的等级属性表
 *
 * **武器的 `attr` 与角色不是同一形状**：角色 `{keys, details}`、武器 `{atk, bonusKey, bonusData}`。用 {@link levelAttr}
 * 取武器会因无 `details` 一律返回 undefined，后果是武器对面板的贡献凭空消失（攻击少一大截），与「面板数据不全」表面难分。
 * @param detail 整份 `data.json`
 * @returns `attr` 段；不是武器的形状时 undefined
 */
function weaponLevelAttr(detail: MetaDetail | undefined): unknown {
  const got = detail?.attr
  if (!got || typeof got !== "object") return undefined
  return "atk" in (got as Record<string, unknown>) ? got : undefined
}

/**
 * 取一个条目的各类图
 * @param item 元数据条目
 * @returns 图名 → 相对路径
 */
function imgsOf(item: MetaItem): Record<string, string> {
  const out: Record<string, string> = {}
  if (item.face) out["face"] = item.face
  if (item.gacha) out["gacha"] = item.gacha
  if (item.side) out["side"] = item.side
  return out
}
