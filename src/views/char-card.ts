/**
 * 模块职责：角色卡片（`#胡桃`）的视图模型 —— 一张图说清"这个角色我练到哪了"
 * 依赖方向：纯函数，依赖 panel/build 的装配结果与 panel/img 的挑图；不碰 IO
 * 生命周期：无状态
 * 注意事项：**卡片与面板详情是两件事、勿合并**：详情铺开全部词条与伤害，卡片只回答等级/命座/武器/天赋/圣遗物套装五项（合成一个模板会让卡片也背上伤害计算的前提，而卡片在只绑 uid 的账号上也应可用）。
 *          **没有面板数据时仍要出图**（只有角色名与立绘、附一句「把角色放进展柜」），故 {@link buildCharCard} 的 `panel` 可选、缺它时 {@link CharCardView.hasData} 为假。**皇冠数按不含命座加成的等级数**（含加成会让 6 命角色凭空多两个皇冠，库里 `talent` 本就不含加成）。
 */
import { SHORT_PREFIX } from "../core/region.js"
import { INDENT } from "../core/text.js"
import type { BuiltPanel } from "../panel/build.js"
import { sourceName } from "../panel/build.js"
import type { PanelGame, SelfCalcGame } from "../panel/profile/index.js"
import { ZZZ_RANK_STAR, zzzElemName } from "../panel/profile/index.js"
import type { StoredAvatar } from "../store/panel.js"
import type { CharImgs } from "./panel.js"
import { artiImg, artiSetImg, charImgs, ZZZ_SKILL_NAMES, zzzSets, zzzSkillMax } from "./panel.js"

/** 卡片上的武器一栏 */
export interface CharCardWeapon {
  /** 名称，过长时用简称 */
  name: string
  /** 等级 */
  level: number
  /** 精炼 / 叠影 */
  affix: number
  /** 星级 */
  star: number
  /** 图标，相对元数据根目录 */
  img?: string
}

/** 卡片上的一个天赋 */
export interface CharCardTalent {
  /** 天赋键，`a` / `e` / `q`（星铁另有 `t`） */
  key: string
  /** 等级，含命座 / 星魂加成 */
  level: number
  /** 是否已点到 10 级（画皇冠），按不含加成的等级判 */
  crown: boolean
  /** 等级里有命座 / 星魂加成 */
  plus: boolean
  /** 图标，相对元数据根目录 */
  img: string
}

/** 卡片上的一个圣遗物格子 */
export interface CharCardArti {
  /** 部位，1 起 */
  idx: number
  /** 强化等级；缺件时 undefined，模板据此画空格子 */
  level?: number
  /** 图标，相对元数据根目录；缺件时空串 */
  img: string
}

/**
 * 角色卡片视图
 *
 * 继承 `Record<string, unknown>` 只为满足 `Session.image` 的入参形态（模板数据是任意键值对）。
 */
export interface CharCardView extends Record<string, unknown> {
  /** 游戏 */
  game: PanelGame
  /** uid */
  uid: string
  /** 角色名 */
  name: string
  /** 简称，模板优先用它 */
  abbr: string
  /** 星级 */
  star: number
  /** 元素 / 命途 */
  elem: string
  /** 有没有面板数据；为假时模板只画角色名与提示 */
  hasData: boolean
  /** 等级 */
  level: number
  /** 命座 / 星魂 */
  cons: number
  /** 好感度，原神独有；0 表示未知 */
  fetter: number
  /** 武器 */
  weapon?: CharCardWeapon
  /** 天赋 */
  talents: CharCardTalent[]
  /** 皇冠数 */
  crowns: number
  /**
   * 圣遗物套装名，凑不成套时空串
   *
   * **刻意不叫 `set`**：art-template 的 `{{set x = 1}}` 是赋值语句，写 `{{set || '圣遗物'}}` 会被当语句解析而报错。
   */
  artisSet: string
  /** 圣遗物评分档位，如 `ACE` */
  markClass: string
  /** 逐件圣遗物，按部位铺满；缺件的那一位 `level` 为 undefined */
  artis: CharCardArti[]
  /** 数据源展示名 */
  source: string
  /** 面板更新时间，已格式化 */
  updateTime: string
  /** 立绘，相对面板图根目录；没有上传过时 undefined */
  splash?: string
  /** 元数据里的立绘，`splash` 缺失时的回落 */
  gacha?: string
  /** 各类图标，相对元数据根目录；由 {@link charImgs} 算好，模板取 `imgs[key]`，与 `profile-detail` 同形态 */
  imgs: CharImgs
  /**
   * 模板 `<head>` 里那一行 `{{@widthStyle}}` 的内容
   *
   * 原用于按背景图长宽比算 `<style>` 定宽，本仓库不读图片尺寸故恒为空串。**不能省**（`{{@}}` 不转义也不兜空，缺了 `<head>` 里会出现字面 `undefined`）。
   */
  widthStyle: string
  /** 没有面板数据时给使用者的一句提示 */
  tip: string
}

/** 各游戏的圣遗物部位数 */
const POS_COUNT: Readonly<Record<SelfCalcGame, number>> = { gs: 5, sr: 6 }

/** 天赋在卡片上的排列次序，星铁多一个终结技之外的天赋 */
const TALENT_KEYS: Readonly<Record<SelfCalcGame, readonly string[]>> = {
  gs: ["a", "e", "q"],
  sr: ["a", "e", "q", "t"]
}

/** 武器名超过这个长度就用简称 —— 卡片那一栏放不下更长的名字 */
const ABBR_AT = 4

/**
 * 把时间戳格式化成 `MM-DD HH:mm`
 *
 * 不带年份：卡片上的更新时间是"多久之前的数据"，年份占位置而不提供信息。
 * @param at 时间戳；缺失时返回空串
 * @returns 格式化结果
 */
export function formatUpdateTime(at: number | undefined): string {
  if (!at) return ""
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 数皇冠
 *
 * 数的是"点到 10 级"的天赋个数，不含命座加成 —— 理由见文件头。
 * @param talent 天赋等级
 * @returns 皇冠数
 */
export function countCrowns(talent: Readonly<Record<string, number>>): number {
  return Object.values(talent).filter(one => Number(one) >= 10).length
}

/**
 * 挑出件数最多的那个套装名
 *
 * 两套各两件时取件数多的、相等取先枚举到的；只有一件也照实返回（模板写「圣遗物」比写一个不成套的名字更没信息）。
 * @param sets 套装名 → 件数
 * @returns 套装名；一件都没有时空串
 */
export function mainSet(sets: Readonly<Record<string, number>>): string {
  let best = ""
  let most = 0
  for (const [name, count] of Object.entries(sets)) {
    if (count > most) {
      best = name
      most = count
    }
  }
  return most >= 2 ? best : ""
}

/** 造卡片视图的上下文 */
export interface CharCardContext {
  /** 游戏 */
  game: SelfCalcGame
  /** uid */
  uid: string
  /** 角色名 */
  name: string
  /** 简称 */
  abbr?: string
  /** 星级 */
  star?: number
  /** 元素 / 命途 */
  elem?: string
  /** 使用者上传的立绘，相对面板图根目录；有它时模板走 `_panel_path` */
  splash?: string
  /** 武器类型英文名，原神的普攻图标按它取 */
  weaponType?: string
  /**
   * 命座与天赋的对应关系
   *
   * 原神天赋图标要按命座折算，故原样传给 {@link charImgs}；形态两游戏间不同、见那边说明。
   */
  talentCons?: Record<string, string | number>
  /** 旅行者 / 开拓者的元素，图标另在 `<角色>/<元素>/` 下 */
  travelerElem?: string
  /**
   * 判一个相对元数据根目录的路径是否存在
   *
   * 图标要按"变体在就用变体、不在就回落"来取，不传时一律取变体路径。
   */
  exists?: (rel: string) => boolean
}

/**
 * 装好的面板 → 角色卡片视图
 *
 * `panel` 缺失时出一张"只有角色名"的卡片，理由见文件头。
 * @param ctx 上下文
 * @param panel 装好的面板；没有面板数据时不传
 * @returns 卡片视图
 */
export function buildCharCard(ctx: CharCardContext, panel?: BuiltPanel): CharCardView {
  const game = ctx.game
  // 图标路径一律由 charImgs 算、不在此处也不在模板里拼（那套回落规则只该有一处实现）
  const imgs = charImgs({
    game,
    name: ctx.name,
    ...(panel?.costume ? { costume: panel.costume } : {}),
    ...(ctx.weaponType ? { weaponType: ctx.weaponType } : {}),
    ...(ctx.talentCons ? { talentCons: ctx.talentCons } : {}),
    ...(ctx.travelerElem ? { travelerElem: ctx.travelerElem } : {}),
    ...(ctx.exists ? { exists: ctx.exists } : {})
  })

  const view: CharCardView = {
    game,
    uid: ctx.uid,
    name: ctx.name,
    abbr: ctx.abbr || ctx.name,
    star: ctx.star ?? 5,
    elem: panel?.elem || ctx.elem || "",
    hasData: !!panel,
    level: panel?.level ?? 0,
    cons: panel?.cons ?? 0,
    fetter: panel?.fetter ?? 0,
    talents: [],
    crowns: 0,
    artisSet: "",
    markClass: panel?.mark?.markClass ?? "",
    artis: [],
    source: panel?.source ?? "",
    updateTime: formatUpdateTime(panel?.at),
    imgs,
    // `<head>` 里那行 `{{@widthStyle}}` 原按背景图长宽比定宽，本仓库不读图片尺寸故给空串（`{{@}}` 不转义也不兜空、不给会印字面 `undefined`）
    widthStyle: "",
    tip: ""
  }
  if (ctx.splash) view.splash = ctx.splash
  // 没有上传图时回落到元数据的立绘（时装立绘已由 charImgs 处理）
  const gacha = imgs["splash"] ?? imgs["gacha"]
  if (gacha) view.gacha = gacha

  if (!panel) {
    // 这句话要指出可操作的下一步。"更新失败"之类的说法对使用者没有用
    view.tip = `暂无 ${ctx.name} 的面板数据，请在游戏内把它放进角色展柜并开启「显示角色详情」，然后发送「${SHORT_PREFIX[game]}更新面板」`
    return view
  }

  if (panel.weapon) {
    const w = panel.weapon
    const one: CharCardWeapon = {
      // 名字过长用简称：卡片那一栏放不下五个字以上
      name: w.name.length > ABBR_AT ? w.abbr || w.name : w.name,
      level: w.level,
      affix: w.affix,
      star: w.star
    }
    if (w.img) one.img = w.img
    view.weapon = one
  }

  const talent = panel.talent ?? {}
  view.talents = (TALENT_KEYS[game] ?? [])
    .filter(key => talent[key] !== undefined)
    .map(key => {
      const original = Number(talent[key]) || 0
      const level = Number(panel.talentLevel?.[key]) || original
      return { key, level, crown: original >= 10, plus: level > original, img: imgs[key] ?? "" }
    })
  view.crowns = countCrowns(talent)
  view.artisSet = mainSet(panel.sets ?? {})

  // 按部位铺满：缺件的那一位 `level` 留 undefined，模板据此画一个空格子而不是让后面的件挪位
  const byIdx = new Map(panel.artis.map(one => [one.idx, one]))
  view.artis = Array.from({ length: POS_COUNT[game] }, (_unused, at) => {
    const idx = at + 1
    const got = byIdx.get(idx)
    if (!got) return { idx, img: "" }
    return { idx, level: got.level, img: artiImg(game, got) }
  })

  return view
}

/** 绝区零卡片的上下文 */
export interface ZzzCharCardContext {
  /** uid */
  uid: string
  /** 代理人名 */
  name: string
  /** 简称 */
  abbr?: string
  /** 使用者上传的立绘，相对面板图根目录 */
  splash?: string
  /** 音擎图，相对元数据根目录 */
  weaponImg?: string
  /** 评分档位 */
  markClass?: string
  /** 判元数据里的路径是否存在 */
  exists?: (rel: string) => boolean
}

/**
 * 绝区零代理人 → 角色卡片视图
 *
 * 与 {@link buildCharCard} 同一张模板、同形态的视图：六个技能（核心技满级 7、其余 12，皇冠按各自满级判）、音擎、六件驱动盘。
 * `game` 给 `zzz` 让模板换叫法（影画 / 驱动盘）。
 * @param ctx 上下文
 * @param one 存下来的面板；没有时出只有立绘与提示的那一张
 * @returns 卡片视图
 */
export function buildZzzCharCard(ctx: ZzzCharCardContext, one?: StoredAvatar): CharCardView {
  const detail = one?.zzz
  const imgs = charImgs({ game: "zzz", name: ctx.name, ...(ctx.exists ? { exists: ctx.exists } : {}) })
  const view: CharCardView = {
    game: "zzz",
    uid: ctx.uid,
    name: ctx.name,
    abbr: ctx.abbr || ctx.name,
    star: ZZZ_RANK_STAR[detail?.rank ?? "S"] ?? 5,
    elem: detail ? zzzElemName(detail.elemId) : "",
    hasData: !!detail,
    level: one?.level ?? 0,
    cons: one?.cons ?? 0,
    fetter: 0,
    talents: [],
    crowns: 0,
    artisSet: "",
    markClass: ctx.markClass ?? "",
    artis: [],
    source: sourceName(one?.from),
    updateTime: formatUpdateTime(one?.at),
    imgs,
    widthStyle: "",
    tip: ""
  }
  if (ctx.splash) view.splash = ctx.splash
  const gacha = imgs["splash"] ?? imgs["gacha"]
  if (gacha) view.gacha = gacha
  if (!one || !detail) {
    view.tip = `暂无 ${ctx.name} 的面板数据，请先发送「${SHORT_PREFIX.zzz}更新面板」`
    return view
  }
  if (detail.weapon) {
    view.weapon = {
      name: detail.weapon.name,
      level: detail.weapon.level,
      affix: detail.weapon.star,
      star: ZZZ_RANK_STAR[detail.weapon.rank] ?? 4,
      ...(ctx.weaponImg ? { img: ctx.weaponImg } : {})
    }
  }
  view.talents = ZZZ_SKILL_NAMES.map(it => {
    const level = Number(one.talent?.[it.key]) || 0
    return { key: it.key, level, crown: level >= zzzSkillMax(it.key), plus: false, img: imgs[it.icon] ?? "" }
  })
  view.crowns = view.talents.filter(it => it.crown).length
  view.artisSet = zzzSets(detail.discs).map(it => `${it.name}${it.own}`).join(" + ")
  const byPos = new Map(detail.discs.map(it => [it.pos, it]))
  view.artis = Array.from({ length: 6 }, (_unused, at) => {
    const got = byPos.get(at + 1)
    return got ? { idx: at + 1, level: got.level, img: artiSetImg("zzz", got.set ?? "", got.pos) } : { idx: at + 1, img: "" }
  })
  return view
}

/**
 * 角色卡片视图 → 纯文字
 *
 * 没有渲染器时用。天赋写成 `10/10/10` 的形态 —— 那是群里最常见的写法。
 * @param view 卡片视图
 * @returns 多行文本
 */
export function charCardText(view: CharCardView): string {
  if (!view.hasData) return view.tip

  const lines = [`${view.name} Lv.${view.level}${INDENT}${view.cons} 命${INDENT}uid ${view.uid}`]
  if (view.weapon) {
    lines.push(`武器${INDENT}${view.weapon.name} Lv.${view.weapon.level} 精${view.weapon.affix}`)
  }
  if (view.talents.length) {
    lines.push(
      `天赋${INDENT}${view.talents.map(one => one.level).join("/")}${view.crowns ? `（${view.crowns} 皇冠）` : ""}`
    )
  }
  if (view.artisSet) {
    lines.push(`圣遗物${INDENT}${view.artisSet}${view.markClass ? `${INDENT}评分 ${view.markClass}` : ""}`)
  }
  if (view.source) lines.push(`数据源${INDENT}${view.source}${view.updateTime ? ` ${view.updateTime}` : ""}`)
  return lines.join("\n")
}
