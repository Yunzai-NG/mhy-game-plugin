/**
 * 模块职责：面板相关模板的数据适配 —— 把装好的面板转成既有模板要的形态
 * 依赖方向：依赖 panel/build（装好的面板）与 core/text；纯函数，不碰 IO
 * 生命周期：无状态
 * 注意事项：图标的键由本层拼、不由装载器给（装载器只索引 face/gacha/side 三张，面板要十几张）；变体须按传入的 exists 判存在性，缺了主图不应遮掉可用的基础图。
 *          **原神天赋图标要按命座折算**（某天赋由命座提升时取那个命座的图，一律取 `talent-e` 只在有天赋加成的角色上错）。属性值格式化：主属性千分位（生命值不留小数、其余一位），**百分比项负值一律显示为 0**。原神 `dmg` 在物伤更高时改取 `phy`，星铁无此支。
 */
import { SHORT_PREFIX } from "../core/region.js"
import { INDENT, stamp } from "../core/text.js"
import type { ArtiMetaTable } from "../meta/arti.js"
import { isElemKey } from "../meta/arti.js"
import { eachElem, elemName, elemOf } from "../meta/elem.js"
import type { MetaDetail, MetaLoader } from "../meta/loader.js"
import { setDirOf } from "../meta/set-dir.js"
import type { BuiltArti, BuiltPanel } from "../panel/build.js"
import type { SelfCalcGame, PanelGame } from "../panel/profile/index.js"
import type { ZzzAvatarDetail, ZzzDisc, ZzzGearAttr } from "../panel/profile/index.js"
import { isGsTraveler, ZZZ_RANK_STAR, zzzElemName } from "../panel/profile/index.js"
import { propMapOf } from "../panel/prop/index.js"
import { ZZZ_ELEM_DMG_KEY, ZZZ_ELEM_DMG_PROP, ZZZ_ELEM_SLUG, ZZZ_PROP_NAME, isPct, propValue, zzzPropName } from "../panel/prop/zzz.js"
import type { ZzzScoreResult } from "../panel/score/index.js"
import { discBreakdown, markClassOf } from "../panel/score/index.js"
import { talentFrameOf } from "./char-talent.js"
import type { StoredAvatar, StoredPlayer } from "../store/panel.js"

/** 传给既有模板的一份数据 */
export type PanelTemplateData = Record<string, unknown>

/** 原神主属性四项，用千分位 */
const GS_MAIN = ["hp", "def", "atk", "mastery"] as const

/** 星铁主属性四项 */
const SR_MAIN = ["hp", "def", "atk", "speed"] as const

/** 原神百分比项 */
const GS_PCT = ["cpct", "cdmg", "recharge", "dmg"] as const

/** 星铁百分比项 */
const SR_PCT = ["cpct", "cdmg", "recharge", "dmg", "effPct", "effDef", "heal", "stance", "elation"] as const

/**
 * 取分隔位数的函数，由 {@link configureComma} 安装
 *
 * **本插件唯一一处模块级可变状态**：{@link comma} 在 21 处被调用（两处还交给沙箱里的 `Format.comma`），逐层穿一个纯展示偏好要改整条视图链。读时现调、故改配置即时生效。
 */
let commaGroupOf: () => number = () => 3

/**
 * 安装"每几位加一个逗号"的取值函数
 *
 * 由 `setup` 调一次，传 `() => config().commaGroup`。理由见 {@link commaGroupOf}。
 * @param fn 取分隔位数的函数
 */
export function configureComma(fn: () => number): void {
  commaGroupOf = fn
}

/**
 * 取头像风格的函数，由 {@link configureFaceStyle} 安装
 *
 * 同 {@link commaGroupOf} 的理由（{@link charImgs} 在十二处调用、一半在拿不到 ctx 的纯视图函数里）。缺省 `b` 与配置缺省一致。
 */
let faceStyleOf: () => string = () => "b"

/**
 * 安装"头像用哪一档"的取值函数
 *
 * 由 `setup` 调一次，传 `() => config().faceStyle`。理由见 {@link faceStyleOf}。
 * @param fn 取头像风格的函数
 */
export function configureFaceStyle(fn: () => string): void {
  faceStyleOf = fn
}

/**
 * 一档头像风格要依次尝试的变体文件名，越靠前越优先
 *
 * 次序：自定义 → 表情包 → Q 版 → 原始。**`face-b` 与 `face-z` 是 PNG**、另两个是 WebP，故连后缀一并列出。
 */
const FACE_CHAIN: Readonly<Record<string, readonly string[]>> = {
  z: ["face-z.png", "face-b.png", "face-q.webp"],
  b: ["face-b.png", "face-q.webp"],
  q: ["face-q.webp"],
  base: []
}

/**
 * 千分位格式化
 *
 * 整数部分插逗号，小数位固定保留 `fix` 位（**整数也补**，`33` 按一位得 `33.0`）。每几位插一逗号由 `commaGroup` 决定（3 或 4，读「万」的习惯按 4）。
 * @param num 数值
 * @param fix 小数位数
 * @returns 格式化结果
 */
export function comma(num: number, fix = 0): string {
  const value = Number(num)
  if (!Number.isFinite(value)) return "0"
  const fixed = value.toFixed(fix)
  const [int = "0", dec] = fixed.split(".")
  const group = commaGroupOf() === 4 ? 4 : 3
  const withComma = int.replace(new RegExp(`\\B(?=(\\d{${group}})+(?!\\d))`, "g"), ",")
  return dec === undefined ? withComma : `${withComma}.${dec}`
}

/**
 * 百分比格式化
 * @param num 数值
 * @param fix 小数位数
 * @returns 形如 `12.3%`
 */
export function pct(num: number, fix = 1): string {
  const value = Number(num)
  return `${Number.isFinite(value) ? value.toFixed(fix) : "0.0"}%`
}

/** 一组格式化好的属性，模板逐键取用 */
export type FormattedAttr = Record<string, string>

/**
 * 把面板属性格式化成模板要的形态
 *
 * 每项产出三键：`x`（当前值）、`xBase`（白值）、`xPlus`（加成值）。**百分比项负值一律显示为 0**。
 * @param attr 面板属性
 * @param base 白值表
 * @param game 游戏
 * @returns 格式化好的属性
 */
export function formatAttr(
  attr: Readonly<Record<string, unknown>>,
  base: Readonly<Record<string, number>>,
  game: PanelGame
): FormattedAttr {
  const out: FormattedAttr = {}

  /**
   * 取一项数值
   *
   * **两种形态都要认**：面板属性逐项是数值，伤害模式那份逐项是 `{base, plus, pct}` 盒子；只认数值会让伤害模式整栏属性全 0、加成列显示成「加负的白值」。折算：白值 + 加成值 + 白值 × 百分比。
   * @param src 取值来源
   * @param key 键
   * @returns 数值，非数一律 0
   */
  const num = (src: Readonly<Record<string, unknown>>, key: string): number => {
    const got = src[key]
    if (got !== null && typeof got === "object") {
      const one = got as Record<string, unknown>
      const white = Number(one["base"]) || 0
      const out = white + (Number(one["plus"]) || 0) + (white * (Number(one["pct"]) || 0)) / 100
      return Number.isFinite(out) ? out : 0
    }
    return typeof got === "number" && Number.isFinite(got) ? got : 0
  }

  for (const key of game === "gs" ? GS_MAIN : SR_MAIN) {
    // 生命值不留小数，其余留一位
    const fix = key === "hp" ? 0 : 1
    const now = num(attr, key)
    const white = num(base, key)
    out[key] = comma(now, fix)
    out[`${key}Base`] = comma(white, fix)
    out[`${key}Plus`] = comma(now - white, fix)
  }

  for (const key of game === "gs" ? GS_PCT : SR_PCT) {
    // 原神的伤害加成一栏在物伤更高时改取物伤，星铁没有这一支
    const read = game === "gs" && key === "dmg" && num(attr, "phy") > num(attr, "dmg") ? "phy" : key
    const now = num(attr, read)
    const white = num(base, read)
    out[key] = pct(Math.max(0, now))
    out[`${key}Base`] = pct(Math.max(0, white))
    out[`${key}Plus`] = pct(Math.max(0, now - white))
  }

  return out
}

/**
 * 副词条左侧那个数字 —— 印**词条效率**，不是评分权重
 *
 * `eff` 是「该词条累加值 ÷ 单次满词条值」，再除以平均单次占满值的比例（原神 0.85、星铁 0.9），折成大致的强化次数。
 * 与配色（评分权重）分开：把它印成权重会与颜色重复、且丢掉「出得好不好」这层信息。为 0 时写短横。
 * @param eff 累加后的原始效率
 * @param game 游戏
 * @returns 形如 `2.7` 的串；为 0 时 `-`
 */
export function formatEff(eff: number, game: PanelGame): string {
  const value = Number(eff)
  if (!Number.isFinite(value) || value === 0) return "-"
  // 绝区零副词条无档位随机、每次强化固定值，故 `eff` 已是整数次数、不再折算
  const ratio = game === "gs" ? 0.85 : game === "sr" ? 0.9 : 1
  return comma(value / ratio, 1)
}

/** 面板模板要的一份图标表 */
export type CharImgs = Record<string, string>

/**
 * 拼一个角色的全部图标路径
 *
 * **`exists` 是回落判据、不是可省的优化**：`face`/`qFace`/`side`/`splash` 的口径是「变体在就用变体、不在用基础图」，不判存在性会让没有时装/`face-q` 的角色的图指向 404（不报错、只是空白）。不传时一律取变体路径。
 * **`qFace` 按 `faceStyle` 逐档回落**（自定义 → 表情包 → Q 版 → 原始，见 {@link FACE_CHAIN}），产出的键仍只有 `qFace` 一个（把选择留模板里意味着七套模板各写一遍优先级）。
 * @param input 输入
 * @returns 图标键 → 相对元数据根目录的路径
 */
export function charImgs(input: {
  /** 游戏 */
  game: PanelGame
  /** 角色名，即元数据里的目录名 */
  name: string
  /** 时装 id，非 0 时取 `splash2` 一类 */
  costume?: number
  /** 武器类型英文名，原神的普攻图标按它取 */
  weaponType?: string
  /**
   * 命座与天赋的对应关系
   *
   * **两游戏形态不同、星铁那份混着两种键**，故值类型 `string | number`：原神是「天赋键 → 生效命座号」（值数字），星铁另有「命座号 → 天赋键」（值字符串）前两条。原神按前者折算天赋图标，星铁按后者定三/五命图标。
   */
  talentCons?: Record<string, string | number>
  /** 旅行者的元素，非空时图标另在 `旅行者/<元素>/` 下 */
  travelerElem?: string
  /**
   * 判一个相对元数据根目录的路径是否存在
   *
   * 见本函数说明：这是**回落判据**。不传时一律取变体路径。
   */
  exists?: (rel: string) => boolean
}): CharImgs {
  const { game, name } = input
  const out: CharImgs = {}
  const suffix = Number(input.costume) === 2 ? "2" : ""

  /**
   * 变体在就用变体，否则回落到基础图
   *
   * 没有 `exists` 时直接取变体（「不关心回落」的场合）。
   * @param variant 变体路径
   * @param base 基础路径
   * @returns 实际可用的路径
   */
  const pick = (variant: string, base: string): string => {
    if (variant === base) return base
    if (!input.exists) return variant
    return input.exists(variant) ? variant : base
  }

  /**
   * 按 `faceStyle` 逐档挑一张小头像
   *
   * 与 {@link pick} 的分别在候选有三档、各档后缀不同（表情包与自定义是 PNG）；一档都不在时回落原始头像（每角色都有）。
   * @param dir 角色的 `imgs/` 目录前缀
   * @returns 相对元数据根目录的路径
   */
  const face = (dir: string): string => {
    const fallback = `${dir}face.webp`
    for (const one of FACE_CHAIN[faceStyleOf()] ?? FACE_CHAIN["b"] ?? []) {
      const path = `${dir}${one}`
      if (!input.exists) return path
      if (input.exists(path)) return path
    }
    return fallback
  }

  if (game === "zzz") {
    const base = `meta-zzz/character/${name}/`
    // 方形头像个别代理人在源站上没有（新上线那几位），故回落到立绘（缺图那格空白，而列表每格都是头像）
    out["face"] = pick(`${base}imgs/face.webp`, `${base}imgs/gacha.webp`)
    // 没有小头像变体，两处取同一张 —— 模板里 `qFace||face` 那一支因此也是它
    out["qFace"] = out["face"]
    out["side"] = `${base}imgs/side.webp`
    out["gacha"] = `${base}imgs/gacha.webp`
    // 面板那张大图用立绘：包里没有竖版立绘，`gacha` 就是那一张
    out["splash"] = `${base}imgs/gacha.webp`
    // 天赋/影画页页首底图取全游戏共用的 `common/imgs/card.webp`（与星铁同位置），缺它回落立绘
    out["card"] = pick("meta-zzz/character/common/imgs/card.webp", `${base}imgs/gacha.webp`)
    // 六张技能图标不逐代理人一份、在 `character/common/imgs/` 下全游戏共用（键名与技能分类键一致，天赋页与面板详情都按 `imgs[key]` 取）
    for (const key of ["basic", "dodge", "assist", "special", "chain", "core"]) {
      out[key] = `meta-zzz/character/common/imgs/talent-${key}.webp`
    }
    // 影画图标：官方没有逐影画的图，用通用编号徽章（`1`~`6`），随插件走而非元数据（前缀落到 `_res_path`）；天赋页与面板详情都按 `imgs[cons<n>]` 取
    for (let idx = 1; idx <= 6; idx++) out[`cons${idx}`] = `character/imgs/rank-zzz/${idx}.png`
    return out
  }

  if (game === "sr") {
    const base = `meta-sr/character/${name}/`
    out["face"] = `${base}imgs/face.webp`
    // 小头像按 faceStyle 逐档回落；星铁其余几项没有变体
    out["qFace"] = face(`${base}imgs/`)
    out["splash"] = `${base}imgs/splash.webp`
    out["preview"] = `${base}imgs/preview.webp`
    for (let idx = 1; idx <= 4; idx++) out[`tree${idx}`] = `${base}imgs/tree-${idx}.webp`
    // 独立变体缺图时使用对应基础技能，不拿另一个技能代替。
    for (const key of ["a", "e", "q", "t", "z", "j", "j2", "as", "as1", "as2", "a2", "e1", "e2", "q1", "q2", "t2", "me", "me2", "mt", "mt1", "mt2"]) {
      out[key] = pick(`${base}imgs/talent-${key}.webp`, `${base}imgs/talent-${key.replace(/[12]$/, "")}.webp`)
    }
    // 三命与五命提升的是天赋而非独立图标，故这两个下标没有对应文件
    for (const idx of [1, 2, 4, 6]) out[`cons${idx}`] = `${base}imgs/cons-${idx}.webp`
    out["banner"] = "meta-sr/character/common/imgs/banner.webp"
    out["card"] = "meta-sr/character/common/imgs/card.webp"
    // 三命 / 五命的图标取它提升的那个天赋的图
    const cons = input.talentCons ?? {}
    for (const idx of [3, 5]) {
      const key = cons[String(idx)]
      const got = key === undefined ? undefined : out[String(key)]
      if (got) out[`cons${idx}`] = got
    }
    return out
  }

  const base = `meta-gs/character/${name}/`
  // 旅行者的命座与天赋图按元素分目录，其余的图仍在角色目录下
  const iconBase = input.travelerElem ? `meta-gs/character/旅行者/${input.travelerElem}/` : base
  // 这四项都有回落：时装图与小头像并非每个角色都有（见本函数说明）
  out["face"] = pick(`${base}imgs/face${suffix}.webp`, `${base}imgs/face.webp`)
  out["qFace"] = face(`${base}imgs/`)
  out["side"] = pick(`${base}imgs/side${suffix}.webp`, `${base}imgs/side.webp`)
  out["gacha"] = `${base}imgs/gacha.webp`
  out["splash"] = pick(`${base}imgs/splash${suffix}.webp`, `${base}imgs/splash.webp`)
  out["card"] = `${iconBase}imgs/card.webp`
  out["banner"] = `${iconBase}imgs/banner.webp`
  for (let idx = 1; idx <= 6; idx++) out[`cons${idx}`] = `${iconBase}icons/cons-${idx}.webp`
  for (let idx = 0; idx <= 4; idx++) out[`passive${idx}`] = `${iconBase}icons/passive-${idx}.webp`
  // 普攻图标按武器类型取，且它在本插件自带的资源里而非元数据里
  out["a"] = `gs/atk/atk-${input.weaponType ?? "sword"}.webp`
  const cons = input.talentCons ?? {}
  for (const key of ["e", "q"]) {
    const at = Number(cons[key]) || 0
    // 有命座提升该天赋时用那个命座的图
    out[key] = at > 0
      ? pick(out[`cons${at}`] ?? `${iconBase}icons/talent-${key}.webp`, `${iconBase}icons/talent-${key}.webp`)
      : `${iconBase}icons/talent-${key}.webp`
  }
  return out
}

/**
 * 圣遗物 / 遗器的图标路径
 *
 * 两游戏目录形态不同、不能合成一条：原神在 `artifact/imgs/` 之下按部位分文件，星铁在 `artifact/` 之下、文件名带 `arti-` 前缀。
 * 原神漏 `imgs/`、星铁漏 `arti-` 的表现是每格圣遗物图空白（404 不报错、只是不画）。
 * @param game 游戏
 * @param one 装好的圣遗物
 * @returns 相对元数据根目录的路径；套装名缺失时空串
 */
export function artiImg(game: PanelGame, one: BuiltArti): string {
  if (!one.set) return ""
  return artiSetImg(game, one.set, one.idx)
}

/* ── 绝区零那一路 ────────────────────────────────────────────────────────────
 * 它不经面板装配层（属性由接口算好）、不能复用 profileDetailData 的入口；但出图共用同两张模板
 * （`character/profile-detail` 与 `character/profile-list`），故这几个函数的产出逐键同形，差异只在「从哪儿取」。
 * ──────────────────────────────────────────────────────────────────────── */

/** 绝区零除核心技外五个技能的满级 */
const ZZZ_SKILL_MAX = 12

/**
 * 绝区零核心技的满级
 *
 * 元数据里核心技只有 6 档，而接口给的等级是档位加一（A~F 对应 2~7），故满级是 7 而非 6。
 */
const ZZZ_CORE_MAX = 7

/**
 * 绝区零一个技能的满级
 * @param key 技能键
 * @returns 核心技 7，其余 12
 */
export function zzzSkillMax(key: string): number {
  return key === "core" ? ZZZ_CORE_MAX : ZZZ_SKILL_MAX
}

/**
 * 技能键 → 展示名与图标键，次序即出图次序
 *
 * **`key` 与 `icon` 不是同一套叫法、不能省**：`key` 是米游社接口给技能等级用的键（`normal`…），`icon` 是元数据那六张图标的键（`basic`…）。普攻两处分别叫 `normal` 与 `basic`，拿 `key` 取图标那格恒空且不报错。
 */
export const ZZZ_SKILL_NAMES: readonly { key: string; name: string; icon: string }[] = [
  { key: "normal", name: "普通攻击", icon: "basic" },
  { key: "special", name: "特殊技", icon: "special" },
  { key: "dodge", name: "闪避", icon: "dodge" },
  { key: "chain", name: "连携技", icon: "chain" },
  { key: "core", name: "核心技", icon: "core" },
  { key: "assist", name: "支援技", icon: "assist" }
]

/**
 * 整张图的缺省配色，逐游戏一档
 *
 * 模板把它折成 `elem-<类名>` 挂 `<body>` 上。**给的是那张映射表的入参而非类名本身**：原神星铁给类名（`hydro`/`sr`），绝区零给属性中文名（`流明`）由表折成 `geo`。
 * **绝区零没有自己的主题**、借原神岩色那一套（有意的回落，做专属主题要添底图与 CSS）。
 */
const DEFAULT_ELEM: Readonly<Record<PanelGame, string>> = {
  gs: "hydro",
  sr: "sr",
  zzz: "流明"
}

/**
 * 汇总套装件数
 *
 * 两件成套、四件成套，故只列到两件为止的那些也要显示 —— 一件的那些不成套，不列。
 * @param discs 驱动盘
 * @returns 套装名 → 件数，按件数降序
 */
export function zzzSets(discs: readonly ZzzDisc[]): { name: string; own: number }[] {
  const count = new Map<string, number>()
  for (const one of discs) {
    if (!one.set) continue
    count.set(one.set, (count.get(one.set) ?? 0) + 1)
  }
  return [...count]
    .filter(([, own]) => own >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, own]) => ({ name, own }))
}

/**
 * 一套圣遗物某一部位的图标路径
 *
 * 与 {@link artiImg} 同一套拼法，只是入参是套装名而非装好的那一件 —— 图鉴里的"常用圣遗物"
 * 只知道套装名。
 * @param game 游戏
 * @param set 套装名
 * @param idx 部位，1 起
 * @returns 相对元数据根目录的路径；套装名缺失时空串
 */
export function artiSetImg(game: PanelGame, set: string, idx: number): string {
  if (!set) return ""
  // **只有目录名那段共用一处表**（{@link setDirOf}），其余三处差别逐游戏各写：绝区零一套一张图（六部位共用）、原神多一层 `imgs/` 且按部位分文件、星铁不分子目录但文件名带 `arti-` 前缀。最易错的是「少一层目录」或「少一个前缀」，表现是每格图空白
  const dir = `meta-${game}/${setDirOf(game)}`
  if (game === "zzz") return `${dir}/imgs/${set}.webp`
  if (game === "sr") return `${dir}/${set}/arti-${idx}.webp`
  return `${dir}/imgs/${set}/${idx}.webp`
}

/** 一件格式化好的圣遗物，模板逐字段取用 */
export interface ArtiView {
  /** 部位 */
  idx: number
  /** 名称 */
  name: string
  /** 套装名 */
  set: string
  /** 强化等级 */
  level: number
  /** 图标 */
  img: string
  /** 主词条；`mark` 是这一条的得分 */
  main?: { key: string; value: string; mark: number }
  /** 副词条；`_mark` 是这一条的得分 */
  attrs: { key: string; value: string; upNum: number; eff: string; _mark: number }[]
  /** 对齐前的原始分，评分拆解表用 */
  rawMark?: number
  /** 该件得分 */
  mark?: string
  /** 得分档位 */
  markClass?: string
}

/**
 * 词条值的格式化
 *
 * 百分比项与固定值项的量纲不同：前者存的是 `46.6`（百分数），后者是 `311`（点数）。
 * 判据是词条键。
 * @param key 词条键
 * @param value 数值
 * @returns 格式化结果
 */
export function formatAttrValue(key: string, value: number): string {
  // 小词条（`hpPlus` 一类）与速度是点数，其余按百分比
  if (/Plus$/.test(key) || key === "speed" || key === "mastery") return comma(value, key === "speed" ? 1 : 0)
  return pct(value)
}

/**
 * 把装好的面板转成 `character/profile-detail` 要的形态
 * @param panel 装好的面板
 * @param opts 选项
 * @returns 模板数据
 */
export function profileDetailData(
  panel: BuiltPanel,
  opts: {
    /** 模式：`profile` 面板 / `dmg` 伤害 / `weapon` 武器 */
    mode?: string
    /** 伤害计算结果，由 dmg/detail 算好 */
    dmgCalc?: unknown
    /** 伤害模式下要展示的那份属性（已折算 buff） */
    dmgAttr?: Readonly<Record<string, unknown>>
    /** 立绘地址，由调用方按面板图规则挑好 */
    splash?: string
    /**
     * {@link splash} 是使用者上传的面板图
     *
     * 两者的根不同：上传的图在 `_panel_path` 下，元数据里的立绘在 `_meta_path` 下，
     * 故模板要知道该用哪个前缀。
     */
    splashUpload?: boolean
    /** 判元数据里的路径是否存在，图标的回落要用（见 {@link charImgs}） */
    exists?: (rel: string) => boolean
    /**
     * 词条元数据表
     *
     * 模板要 `artisKeyTitle` 把 `cpct` 显示成「暴击率」。**缺了它整张图渲染不出来**：
     * art-template 把未提供的名字解析成 undefined，`artisKeyTitle[attr.key]` 随即抛错，
     * 而出图失败会退回纯文字 —— 表现是这条命令永远只回文字。
     */
    table?: ArtiMetaTable
  } = {}
): PanelTemplateData {
  const travelerElem = panel.game === "gs" && isGsTraveler(panel.id) ? elemOf(panel.elem) : ""
  const imgs = charImgs({
    game: panel.game,
    name: panel.name,
    costume: panel.costume,
    ...(travelerElem ? { travelerElem } : {}),
    ...(panel.weapon?.type ? { weaponType: panel.weapon.type } : {}),
    ...(panel.talentCons ? { talentCons: panel.talentCons } : {}),
    ...(opts.exists ? { exists: opts.exists } : {})
  })

  const attr = formatAttr(panel.attr as Record<string, unknown>, panel.base, panel.game)
  // 伤害模式下属性栏展示的是折算过 buff 的那份，由此处显式传入而不藏在模板里
  const shown = opts.dmgAttr ? formatAttr(opts.dmgAttr, panel.base, panel.game) : attr

  return {
    game: panel.game,
    uid: panel.uid,
    save_id: panel.uid,
    elem: panel.elem,
    mode: opts.mode ?? "profile",
    bodyClass: `char-${panel.name}`,
    attr: shown,
    data: {
      name: panel.name,
      abbr: panel.abbr,
      ...(travelerElem ? { travelerElem: `${elemName(travelerElem)}元素` } : {}),
      level: panel.level,
      cons: panel.cons,
      // 好感只有原神有；旅行者接口不给，按满级印（与练度统计同一口径）
      fetter: panel.game === "gs" ? (isGsTraveler(panel.id) ? 10 : panel.fetter) : 0,
      star: panel.star,
      talent: talentView(panel),
      dataSource: panel.source,
      // **这里要串而非对象**：`profile-detail` 直接印 `{{data.updateTime}}`，给对象会印出 JSON。面板/角色/练度列表那三张要的才是 `{profile, mys}` 形态，读的是**顶层** `updateTime`
      updateTime: panel.at ? timeText(panel.at) : "",
      imgs,
      costumeSplash: opts.splash ?? imgs["splash"] ?? "",
      // 模板据此决定立绘用哪个根，见 opts.splashUpload
      splashUpload: opts.splashUpload === true,
      weapon: weaponView(panel),
      // 星铁的天赋表按命途选，见 BuiltPanel.charWeapon
      ...(panel.charWeapon ? { charWeapon: panel.charWeapon } : {}),
      ...(panel.game === "sr" ? { treeData: treeView(panel, imgs) } : {})
    },
    artisDetail: artisDetailView(panel),
    artisKeyTitle: artisKeyTitles(panel.game, opts.table),
    // 属性栏那十二行的名字与次序由 panel/prop 给，不写在模板里（见该目录的说明）
    attrMap: propMapOf(panel.game),
    // `artis` 模式（`#胡桃圣遗物`）另要评分规则与词条表；与上面那个 attrMap 不是一张表，故另起名字
    ...(opts.mode === "artis"
      ? { charCfg: panel.markCfg ?? { attrs: {}, classTitle: "", posMaxMark: {} }, artiAttrMap: opts.table?.meta(panel.game).attrMap ?? {} }
      : {}),
    ...(opts.dmgCalc ? { dmgCalc: opts.dmgCalc } : {})
  }
}

/**
 * 天赋等级转成模板要的形态
 *
 * 模板读 `talent[key].level` 与 `.original`：前者含命座加成，后者不含。库里存的是不含的
 * 那份（见 store/panel.ts），故 `level` 由此处按命座折算加回去 —— 反过来做会让米游社源与
 * Enka 源显示不同的等级。
 * @param panel 装好的面板
 * @returns 天赋键 → 等级
 */
function talentView(panel: BuiltPanel): Record<string, { level: number; original: number }> {
  const out: Record<string, { level: number; original: number }> = {}
  for (const [key, lv] of Object.entries(panel.talent)) {
    const original = Number(lv) || 0
    // 含命座加成的那份由装配层算好（panel.talentLevel），缺某键时回落到 original
    const level = Number(panel.talentLevel?.[key]) || original
    out[key] = { level, original }
  }
  return out
}

/**
 * 武器转成模板要的形态
 *
 * `attrs` 的格式化按游戏分：原神只有 `atkBase`（一位小数）与一个副属性
 * （百分比项按百分比、元素精通按整数），星铁那一档的全部属性一律一位小数。
 * @param panel 装好的面板
 * @returns 武器视图；没有武器时空对象
 */
function weaponView(panel: BuiltPanel): Record<string, unknown> {
  const w = panel.weapon
  if (!w) return {}
  const attrs: Record<string, string> = {}
  for (const [key, val] of Object.entries(w.attrs ?? {})) {
    if (panel.game === "sr") {
      attrs[key] = comma(val, 1)
      continue
    }
    // 原神：白值攻击一位小数，副属性里只有元素精通是点数，其余都是百分比
    attrs[key] = key === "atkBase" || key === "mastery" ? comma(val, key === "atkBase" ? 1 : 0) : pct(val)
  }
  return {
    name: w.name,
    sName: w.abbr,
    level: w.level,
    promote: w.promote,
    affix: w.affix,
    star: w.star,
    img: w.img ?? "",
    splash: w.splash ?? "",
    // 模板写 `{{@weapon.desc?.desc}}`，取不到时印的是字面的 `undefined`，故这里兜一个空串
    desc: w.desc ?? { name: "", desc: "" },
    attrs
  }
}

/**
 * 星铁的行迹盘转成模板要的形态
 *
 * 十个属性小点按 `0113355778` 的位置分布、三个能力点在 2/4/6 位、另有 `501`。**位置串不可改**（对应模板那张盘的格子）。
 * **十个小点图标要按元数据逐个替换**（先一律填 `tree-cpct` 只是占位）；少了这步十个点全画成同一张暴击率图（图出得来而内容错）。
 * @param panel 装好的面板
 * @param imgs 图标表
 * @returns 行迹盘数据
 */
function treeView(panel: BuiltPanel, imgs: CharImgs): unknown[] {
  const data: unknown[] = []
  const map: Record<string, { type: string; img: string; value?: number }> = {}

  // 十个属性小点，位置串固定
  "0113355778".split("").forEach((pos, idx) => {
    const list = (data[Number(pos)] as unknown[] | undefined) ?? []
    const one = { type: "tree", img: "meta-sr/public/icons/tree-cpct.webp" }
    list.push(one)
    data[Number(pos)] = list
    map[String(idx + 201)] = one
  })

  // 按元数据把每个小点换成它实际加的那一项的图标；`2` 开头的那批才是属性小点
  for (const [id, one] of Object.entries(panel.tree ?? {})) {
    const key = /([125][01][0-9])$/.exec(id)?.[1]
    if (!key || key[0] !== "2" || !one?.key) continue
    const at = map[key]
    if (at) at.img = `meta-sr/public/icons/tree-${one.key}.webp`
  }

  // 三个能力点
  ;[2, 4, 6].forEach((pos, idx) => {
    const one = { type: "talent", img: imgs[`tree${idx + 1}`] ?? "" }
    data[pos] = one
    map[String(idx + 101)] = one
  })
  map["501"] = { type: "talent", img: imgs["tree4"] ?? "" }

  // 点亮已激活的那些
  for (const id of panel.trees) {
    const hit = /([125][01][0-9])$/.exec(String(id))
    const key = hit?.[1]
    if (key && map[key]) map[key].value = 1
  }
  return data
}

/**
 * 圣遗物评分转成模板要的形态
 * @param panel 装好的面板
 * @returns 评分视图
 */
function artisDetailView(panel: BuiltPanel): Record<string, unknown> {
  const artis: Record<string, ArtiView> = {}
  // 逐条词条的得分：系数 × 原值，主词条再除四（与 panel/score/artis.ts 的 markOne 同口径）。
  // 模板按 `_mark` / `main.mark` 印每行右侧那一列，不给即整列印 NaN
  const coef = panel.markCfg?.attrs ?? {}
  const markOf = (key: string, value: number): number => (coef[isElemKey(key) ? "dmg" : key]?.mark ?? 0) * value
  for (const one of panel.artis) {
    const scored = panel.mark?.artis[String(one.idx)]
    const view: ArtiView = {
      idx: one.idx,
      name: one.name,
      set: one.set,
      level: one.level,
      img: artiImg(panel.game, one),
      attrs: one.attrs.map(it => ({
        key: it.key,
        value: formatAttrValue(it.key, it.value),
        upNum: it.upNum,
        eff: formatEff(it.eff, panel.game),
        _mark: markOf(it.key, it.value)
      }))
    }
    if (one.main) {
      view.main = { key: one.main.key, value: formatAttrValue(one.main.key, one.main.value), mark: markOf(one.main.key, one.main.value) / 4 }
    }
    // 对齐前的原始分（46.6 分制）：副词条逐条累加，沙杯头再加主词条那四分之一。
    // 在模板里 each 中累加取不到值（art-template 的 set 在循环里另起作用域），故在这里算好
    const subs = view.attrs.reduce((sum, it) => sum + it._mark, 0)
    view.rawMark = (46.6 / 6 / 100) * (subs + (one.idx > 2 ? (view.main?.mark ?? 0) : 0))
    if (scored) {
      view.mark = scored.mark
      view.markClass = scored.markClass
    }
    artis[String(one.idx)] = view
  }

  // 模板固定画九格词条汇总，不足的补空对象 —— 否则末尾几格的边框错位
  const allAttr = sumAttrs(panel)
  while (allAttr.length < 9) allAttr.push({})

  return {
    artis,
    allAttr,
    mark: panel.mark?.mark ?? "",
    markClass: panel.mark?.markClass ?? "",
    classTitle: panel.mark?.classTitle ?? "",
    charWeight: panel.mark?.charWeight ?? {}
  }
}

/**
 * 汇总全部副词条
 *
 * 按词条键累加值与效率，再按效率降序；徽标印**词条效率合计**（与逐件那份同口径，见 {@link formatEff}）。
 * @param panel 装好的面板
 * @returns 汇总后的词条，效率降序
 */
export function sumAttrs(panel: BuiltPanel): Record<string, unknown>[] {
  const map = new Map<string, { key: string; value: number; upNum: number; eff: number }>()
  for (const one of panel.artis) {
    for (const attr of one.attrs) {
      const got = map.get(attr.key) ?? { key: attr.key, value: 0, upNum: 0, eff: 0 }
      got.value += attr.value
      got.upNum += attr.upNum
      got.eff += attr.eff
      map.set(attr.key, got)
    }
  }
  return [...map.values()]
    .sort((a, b) => b.eff - a.eff)
    .map(it => ({ ...it, value: formatAttrValue(it.key, it.value), eff: formatEff(it.eff, panel.game) }))
}

/** 面板列表里的一个角色 */
export interface PanelListItem {
  /** 角色 id */
  id: string
  /** 全名 */
  name: string
  /** 简称 */
  abbr: string
  /** 星级 */
  star: number
  /** 元素 */
  element: string
  /** 等级 */
  level: number
  /** 命座 */
  cons: number
  /** 头像 */
  face: string
  /** 本次是否新获取 */
  isNew: number
  /** 本次是否有更新 */
  isUpdate: number
  /** 圣遗物 / 遗器 / 驱动盘评分，评不出时省略 */
  mark?: string
  /** 评分档位 */
  markClass?: string
  /**
   * 这一位在本群的名次，不在榜上时省略
   *
   * 模板按它在角色格上画一枚角标（前三名各一色、其余第四色、超出展示名额的一律第十色）。
   */
  groupRank?: { rank: number; rankType: string }
}

/** 造面板列表要的上下文，三个游戏同一份 */
export interface PanelListOptions {
  /** uid */
  uid: string
  /** 游戏 */
  game: PanelGame
  /** 本次新获取的角色 id */
  fresh?: readonly string[]
  /** 本次数据有变的角色 id */
  changed?: readonly string[]
  /** 数据源展示名 */
  servName?: string
  /** 顶部提示语 */
  msg?: string
  /** 面板更新时间戳 */
  at?: number
  /** 判元数据里的路径是否存在，图标的回落要用（见 {@link charImgs}） */
  exists?: (rel: string) => boolean
  /**
   * 本群的排名上下文，私聊里不给
   *
   * 给了才画那一段。`allow` 为假时模板改印参与要求 —— 使用者得知道自己为什么没上榜。
   * 逐角色的名次在 {@link PanelListItem.groupRank} 上。
   */
  rank?: {
    /** 这个 uid 有没有上榜资格 */
    allow: boolean
    /** 群排行配置，底部那段说明要用 */
    cfg: { limitTxt: string; time: string; number: number }
    /** 角色 id → 名次与维度 */
    ranks: Readonly<Record<string, { rank: number; rankType: string }>>
  }
}

/**
 * 列表里的分块：0 本次有变、1 本次取到但没变、2 本次没取到
 * @param one 一个角色
 * @returns 块号
 */
function listBlock(one: PanelListItem): number {
  return one.isUpdate ? 0 : one.isNew ? 1 : 2
}

/**
 * 整张面板列表的顶层形态 —— **三个游戏共用这一段与这一张模板**
 *
 * 排序：变 → 新 → 未变三块，块内按 id 升序。id 按数值比：原神八位、星铁与绝区零四位，
 * 按字符串比则「1005」排到「10000046」之后。三块同在一个框里，靠头像外框的光区分。
 * @param chars 逐个角色
 * @param opts 上下文
 * @returns 模板数据
 */
function panelListView(chars: PanelListItem[], opts: PanelListOptions): PanelTemplateData {
  chars.sort((a, b) => listBlock(a) - listBlock(b) || Number(a.id) - Number(b.id) || a.id.localeCompare(b.id))

  return {
    game: opts.game,
    uid: opts.uid,
    save_id: opts.uid,
    chars: chars.map(one => ({ ...one, state: ["chg", "new", ""][listBlock(one)] })),
    hasNew: (opts.fresh?.length ?? 0) > 0,
    chgCount: chars.filter(one => one.isUpdate).length,
    msg: opts.msg ?? "",
    servName: opts.servName ?? "",
    // 排名那三项由命令层给：私聊里没有排行，故缺省是"不画"
    groupRank: !!opts.rank,
    allowRank: opts.rank?.allow ?? false,
    rankCfg: opts.rank?.cfg ?? { limitTxt: "未启用", time: "", number: 15 },
    updateTime: opts.at ? { profile: timeText(opts.at) } : {},
    // 整张图的配色：原神取水色、星铁取它自己那套、绝区零取流明（黄黑）
    elem: DEFAULT_ELEM[opts.game]
  }
}

/**
 * 把一批装好的面板转成 `character/profile-list` 要的形态 —— 原神与星铁这一路
 * @param list 装好的面板
 * @param opts 上下文
 * @returns 模板数据
 */
export function profileListData(list: readonly BuiltPanel[], opts: PanelListOptions): PanelTemplateData {
  const fresh = new Set(opts.fresh ?? [])
  const changed = new Set(opts.changed ?? [])

  const chars: PanelListItem[] = list.map(one => ({
    id: one.id,
    name: one.name,
    abbr: one.abbr,
    star: one.star,
    element: one.elem,
    level: one.level,
    cons: one.cons,
    face:
      charImgs({
        game: one.game,
        name: one.name,
        costume: one.costume,
        ...(opts.exists ? { exists: opts.exists } : {})
      })["qFace"] ?? "",
    isNew: fresh.has(one.id) ? 1 : 0,
    isUpdate: changed.has(one.id) ? 1 : 0,
    ...(one.mark ? { mark: one.mark.mark, markClass: one.mark.markClass } : {}),
    ...(opts.rank?.ranks[one.id] ? { groupRank: opts.rank.ranks[one.id] } : {})
  }))

  return panelListView(chars, opts)
}

/**
 * 时间戳 → `MM-DD HH:mm`
 *
 * 不引 moment：一个格式化就装一个日期库不划算。
 * @param at 时间戳
 * @returns 形如 `08-30 14:05`
 */
export function timeText(at: number): string {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 面板列表的纯文字形态
 *
 * 无渲染器时用。只列角色名与等级 —— 评分与伤害在文字里排不开，列出来也读不成。
 * @param list 装好的面板
 * @param uid uid
 * @returns 多行文本
 */
export function panelListText(list: readonly BuiltPanel[], uid: string): string {
  if (list.length === 0) return `UID ${uid} 暂无面板数据`
  const lines = [`UID ${uid} 面板 ${list.length} 个`]
  for (const one of list) {
    const mark = one.mark ? `，评分 ${one.mark.mark}（${one.mark.markClass}）` : ""
    lines.push(`${INDENT}${one.abbr} ${one.level} 级 ${one.cons} 命${mark}`)
  }
  return lines.join("\n")
}

/**
 * 词条键 → 展示名
 *
 * 先取词条元数据里的 `title`，再把各元素补成 `<元素>伤加成`。模板用它把 `cpct`
 * 显示成「暴击率」。
 * @param game 游戏
 * @param table 词条元数据表
 * @returns 键 → 展示名
 */
export function artisKeyTitles(game: SelfCalcGame, table?: ArtiMetaTable): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, one] of Object.entries(table?.meta(game).attrMap ?? {})) {
    out[key] = one.title
  }
  for (const { key, title } of eachElem(game)) out[key] = `${title}伤加成`
  return out
}

/**
 * 把一批面板转成 `character/artis-list` 要的形态
 *
 * 模板要的是**跨角色拉平的一张列表**（每一行是一件圣遗物，带着它属于谁），而非按角色分组。
 * 排序按评分**稳定升序后整体反转**（见下方实现）。
 * @param list 装好的面板
 * @param opts 选项
 * @param table 词条元数据表
 * @returns 模板数据
 */
export function artisListData(
  list: readonly BuiltPanel[],
  opts: {
    /** uid */
    uid: string
    /** 游戏 */
    game: SelfCalcGame
    /** 最多显示几件 */
    limit?: number
    /** 判元数据里的路径是否存在，图标的回落要用（见 {@link charImgs}） */
    exists?: (rel: string) => boolean
  },
  table?: ArtiMetaTable
): PanelTemplateData {
  const rows: Record<string, unknown>[] = []

  for (const panel of list) {
    const imgs = charImgs({
      game: panel.game,
      name: panel.name,
      costume: panel.costume,
      ...(opts.exists ? { exists: opts.exists } : {})
    })
    for (const one of panel.artis) {
      const scored = panel.mark?.artis[String(one.idx)]
      if (!one.main || !scored) continue
      rows.push({
        idx: one.idx,
        name: one.name,
        set: one.set,
        level: one.level,
        img: artiImg(panel.game, one),
        main: { key: one.main.key, value: formatAttrValue(one.main.key, one.main.value) },
        attrs: one.attrs.map(it => ({
          key: it.key,
          value: formatAttrValue(it.key, it.value),
          upNum: it.upNum,
          eff: formatEff(it.eff, panel.game)
        })),
        mark: scored.mark,
        markClass: scored.markClass,
        _mark: scored._mark,
        avatar: panel.name,
        side: imgs["side"] ?? imgs["qFace"] ?? "",
        charWeight: panel.mark?.charWeight ?? {}
      })
    }
  }

  // 稳定升序后反转：同分的几件按原次序倒序排布，与直接降序不等价
  rows.sort((a, b) => Number(a["_mark"]) - Number(b["_mark"]))
  rows.reverse()

  return {
    game: opts.game,
    uid: opts.uid,
    save_id: opts.uid,
    elem: DEFAULT_ELEM[opts.game],
    artis: rows.slice(0, opts.limit ?? 28),
    artisKeyTitle: artisKeyTitles(opts.game, table)
  }
}

/**
 * 绝区零那一路的 `character/artis-list`：名下全部代理人身上评分最高的若干件驱动盘
 *
 * 与 {@link artisListData} 产出同形（逐件带 `charWeight` 与 `side`），故同一张模板。权重按**这件盘所属的代理人**取。
 * @param rows 逐位代理人与其评分
 * @param opts 选项
 * @returns 模板数据
 */
export function zzzArtisListData(
  rows: readonly ZzzPanelRow[],
  opts: { uid: string; limit?: number; exists?: (rel: string) => boolean }
): PanelTemplateData {
  const out: Record<string, unknown>[] = []
  const titles: Record<string, string> = {}
  for (const { one, mark } of rows) {
    const detail = one.zzz
    if (!detail || !mark) continue
    Object.assign(titles, zzzKeyTitles(detail))
    const imgs = charImgs({ game: "zzz", name: detail.name, ...(opts.exists ? { exists: opts.exists } : {}) })
    for (const disc of detail.discs) {
      const score = mark.byPos[String(disc.pos)]
      if (!disc.main || score === undefined) continue
      out.push({
        idx: disc.pos,
        name: disc.name,
        set: disc.set ?? "",
        level: disc.level,
        img: artiSetImg("zzz", disc.set ?? "", disc.pos),
        main: { key: zzzAttrRow(disc.main).key, value: disc.main.value },
        attrs: disc.subs.map(sub => zzzAttrRow(sub)),
        mark: score.toFixed(1),
        markClass: markClassOf(score),
        _mark: score,
        avatar: detail.name,
        side: imgs["qFace"] ?? imgs["face"] ?? "",
        charWeight: mark.keyWeight
      })
    }
  }
  out.sort((a, b) => Number(a["_mark"]) - Number(b["_mark"]))
  out.reverse()
  return {
    game: "zzz",
    uid: opts.uid,
    save_id: opts.uid,
    elem: DEFAULT_ELEM["zzz"],
    artis: out.slice(0, opts.limit ?? 28),
    artisKeyTitle: titles
  }
}

/** `character` 接口里练度统计用到的字段 */
export interface StatCharacterRaw {
  /** 角色列表，原神旧接口在这个键下 */
  avatars?: StatCharacterItem[]
  /** 角色列表，原神 `character/list` 在这个键下；只认 `avatars` 时练度统计退回面板库、刷新天赋直接报没有角色 */
  list?: StatCharacterItem[]
  /**
   * 角色列表，**星铁与绝区零在这个键下**
   *
   * 三个游戏的键名不同，少收一个的表现是那一路的列表整个为空。
   */
  avatar_list?: StatCharacterItem[]
}

/** `character` 接口里的一个角色 */
export interface StatCharacterItem {
  /** 角色 id */
  id?: number | string
  /** 角色名，原神与星铁 */
  name?: string
  /** 代理人名，**绝区零在这个键下** */
  name_mi18n?: string
  /** 等级 */
  level?: number
  /** 稀有度；原神星铁是数字，绝区零是 `S` / `A` */
  rarity?: number | string
  /** 已激活命座数，原神 */
  actived_constellation_num?: number
  /** 星魂数 / 影画数，星铁与绝区零 */
  rank?: number
  /** 好感度 */
  fetter?: number
  /** 元素，原神与星铁 */
  element?: string
  /** 属性编号，绝区零 */
  element_type?: number | string
  /** 属性子类型，绝区零；凛刃 / 烈霜 / 玄墨靠它区分 */
  sub_element_type?: number | string
  /** 已装备武器，原神 */
  weapon?: StatCharacterWeapon
  /** 已装备光锥，**星铁在这个键下** */
  equip?: StatCharacterWeapon
  /** 圣遗物 */
  reliquaries?: {
    /** 部位 */
    pos?: number
    /** 所属套装 */
    set?: { name?: string }
  }[]
  /** 遗器，星铁的四件本体 */
  relics?: { name?: string }[]
  /** 位面饰品，星铁的两件 */
  ornaments?: { name?: string }[]
}

/** `character` 接口里的一件武器 / 光锥 / 音擎 */
export interface StatCharacterWeapon {
  /** 武器名 */
  name?: string
  /** 等级 */
  level?: number
  /** 稀有度，原神与星铁 */
  rarity?: number
  /** 星级，绝区零那一路由调用方折算好后传入 */
  star?: number
  /** 精炼等级，原神 */
  affix_level?: number
  /** 叠影，星铁 */
  rank?: number
  /** 叠影，绝区零那一路由调用方传入 */
  affix?: number
  /** 突破阶数；今日材料据它判"已突破满"，练度统计不用 */
  promote_level?: number
}

/**
 * 把米游社的角色列表转成 `character/profile-stat` 要的形态
 *
 * **这条命令与面板数据无关**（读米游社角色列表接口，没更新过面板也能用）；已有面板数据的角色额外带评分与天赋等级（调用方算好传入）。
 * 排序：`level`→`star`→`aeq`→`cons`→武器等级→好感度稳定升序后整体反转（`aeq` 是各天赋等级之和）。**三个游戏共用这一份与这张模板**，三处字段名都不同（差异全吃在这一层）。
 * @param raw 接口返回的 data
 * @param opts 选项
 * @returns 模板数据
 */
export function panelStatData(
  raw: unknown,
  opts: {
    /** uid */
    uid: string
    /** 游戏 */
    game: PanelGame
    /** 查询者昵称 */
    name: string
    /** 角色 id → 评分，已有面板数据的那些才有 */
    marks?: Readonly<Record<string, { mark: string; markClass: string }>>
    /**
     * 角色 id → 天赋等级，已有面板数据的那些才有
     *
     * `character` 接口本身**不给天赋等级**，缺了这一项时全表恒印 1 级 —— 看着像"没数据"。
     * 故由调用方把面板库里那份并进来。
     */
    talents?: Readonly<Record<string, Readonly<Record<string, number>>>>
    /**
     * 角色 id → 含命座 / 星魂加成的天赋等级（{@link talents} 那份不含）
     *
     * 缺某键时按不含的印；模板见 `level > original` 时换色，故两份都要给。
     */
    talentLevels?: Readonly<Record<string, Readonly<Record<string, number>>>>
    /**
     * 角色 id → 已装的武器 / 音擎，**绝区零那一路要它**
     *
     * 原神与星铁的角色列表接口自带武器那一块，绝区零的不带，故由调用方从面板库里并进来。
     */
    equips?: Readonly<Record<string, StatCharacterWeapon>>
    /**
     * 角色 id → 命中的套装（**≥2 件的那些**），绝区零那一路要它
     *
     * 原神与星铁的角色列表接口逐件给圣遗物带套装名，这一层自己数得出；绝区零的驱动盘不在
     * 那个列表里（在面板库的 `zzz.discs` 上），故由调用方数好二 / 四件套后并进来。
     */
    sets?: Readonly<Record<string, { name: string; own: number; img: string }[]>>
    /** 元数据装载器，取简称与图标 */
    meta?: MetaLoader
    /** 模式：`stat` 练度 / `talent` 天赋 */
    mode?: string
    /** 判元数据里的路径是否存在，图标的回落要用（见 {@link charImgs}） */
    exists?: (rel: string) => boolean
  }
): PanelTemplateData {
  const got = raw as StatCharacterRaw | null
  // 星铁与绝区零把列表放在 `avatar_list` 下，原神放在 `avatars` 下 —— 只认一个的表现是那一路整个空表
  const list = got?.avatars ?? got?.list ?? got?.avatar_list ?? []
  const marks = opts.marks ?? {}
  const isSr = opts.game === "sr"
  const isZzz = opts.game === "zzz"
  // 这一族的技能键，同时交给模板。**本处是唯一来源**，模板不另写键名字面量：art-template 键名写错只渲染成空、那几格技能等级空白不报错。绝区零那份取自 {@link ZZZ_SKILL_NAMES}（出图次序也由它定），另两个游戏是 a/e/q 加星铁的 t
  const talentKeys = isZzz ? ZZZ_SKILL_NAMES.map(it => it.key) : isSr ? ["a", "e", "q", "t"] : ["a", "e", "q"]

  const avatars = list.map(one => {
    const id = String(one.id ?? "")
    const item = opts.meta?.byId(opts.game, id)
    const name = item?.name ?? one.name_mi18n ?? one.name ?? "未知"
    // 战技与爆发的图取「提升它的那个命座」的图（见 charImgs），不带 talentCons 则两格指向 404、天赋圈只剩数字
    const talentCons = item ? opts.meta?.detail(opts.game, id, item.elem)?.["talentCons"] : undefined
    const imgs = charImgs({
      game: opts.game,
      name,
      ...(talentCons && typeof talentCons === "object" ? { talentCons: talentCons as Record<string, string | number> } : {}),
      ...(opts.exists ? { exists: opts.exists } : {})
    })
    const sets: Record<string, number> = {}
    // 原神给的是逐件圣遗物带套装名，星铁只给遗器与位面饰品的名称（套装名要另查）
    for (const it of one.reliquaries ?? []) {
      const set = it.set?.name
      if (set) sets[set] = (sets[set] ?? 0) + 1
    }
    // 命中的套装（带图与件数）由调用方从面板库数好并进来 —— 三个游戏同一条路：
    // 圣遗物 / 遗器 / 驱动盘的套装图都随面板数据落在库里，接口那份角色列表不带它
    const setList = opts.sets?.[id] ?? []
    // 接口不给天赋等级，故取面板库里那一份；两处都没有时按 1 级展示
    const known = opts.talents?.[id]
    const plus = opts.talentLevels?.[id]
    const talent: Record<string, { level: number; original: number }> = {}
    let aeq = 0
    for (const key of talentKeys) {
      const original = Math.max(1, Number(known?.[key]) || 0)
      const level = Math.max(original, Number(plus?.[key]) || 0)
      talent[key] = { level, original }
      aeq += level
    }

    // 光锥在 `equip` 下、叠影叫 `rank`，与原神的 `weapon` / `affix_level` 均不同名；
    // 绝区零的角色列表不带武器块，那一路由调用方从面板库并进来
    const weapon = (isZzz ? opts.equips?.[id] : isSr ? one.equip : one.weapon) ?? undefined
    // **武器的图在 `icon` 里而不是 `face` 里** —— 取 face 恒为空串，表现是每个格子的武器位空白
    const weaponMeta = weapon?.name ? opts.meta?.byName(opts.game, weapon.name) : undefined
    const weaponImg = weaponMeta?.icon ?? weaponMeta?.face ?? ""
    return {
      id,
      name,
      abbr: item?.abbr ?? name,
      level: Number(one.level) || 1,
      // 绝区零用字母表示稀有度，折算成与另两个游戏一致的数字
      star: isZzz ? (ZZZ_RANK_STAR[String(one.rarity ?? "")] ?? 4) : Math.min(5, Number(one.rarity) || 0),
      cons: Number(isSr || isZzz ? one.rank : one.actived_constellation_num) || 0,
      fetter: Number(one.fetter) || 0,
      elem: (isZzz ? zzzElemName(one.element_type, one.sub_element_type) : one.element) || item?.elem || "",
      face: imgs["qFace"] ?? imgs["face"] ?? "",
      // 天赋圈底下那张元素框，与角色卡片 / 排行同一套（见 char-talent.ts 的 talentFrameOf）；白色线稿图标不垫框在浅色皮肤上看不见
      frame: talentFrameOf(opts.game, (isZzz ? "" : one.element) || item?.elem || ""),
      talent,
      // 天赋圈：与排行同一套（图标 + 等级牌 + 满级冠），键序按 talentKeys
      tals: talentKeys.map(key => {
        const it = talent[key] ?? { level: 1, original: 1 }
        const max = isZzz ? zzzSkillMax(key) : isSr && key === "a" ? 6 : 10
        const icon = isZzz ? (imgs[ZZZ_SKILL_NAMES.find(s => s.key === key)?.icon ?? key] ?? "") : (imgs[key] ?? "")
        return { key, level: it.level, plus: it.level > it.original, crown: it.original >= max, icon }
      }),
      // 面板库里没有这位的天赋时为真：那一行不画天赋圈、只印「暂无天赋数据」，免得满表都是 1 级
      noTalent: known === undefined,
      // 各天赋等级之和，排序用
      aeq,
      weapon: weapon?.name
        ? {
            name: weapon.name,
            // 短名给模板印（格子窄）；元数据没这一条时回落到全名，一律不留空
            abbr: weaponMeta?.abbr ?? weapon.name,
            level: Number(weapon.level) || 1,
            star: Number(isZzz ? weapon.star : weapon.rarity) || 0,
            affix: Number(isZzz ? weapon.affix : isSr ? weapon.rank : weapon.affix_level) || 1,
            img: weaponImg,
            imgs: { icon2: weaponImg }
          }
        : {},
      artisSet: {
        sets,
        // 套装图三个游戏同取自 `setList`（调用方从面板库数好）；名字缺它时回落到接口那份计数
        names: setList.length ? setList.map(s => s.name) : Object.keys(sets),
        imgs: setList.map(s => s.img),
        // 逐套带件数，绝区零那一路模板据它印「4 件 / 2 件」；原神星铁走 imgs 那一支
        list: setList
      },
      ...(marks[id] ? { artisMark: marks[id] } : {})
    }
  })

  // 稳定升序后反转：同级同星的两个角色次序不会随每次取数抖动
  avatars.sort(
    (a, b) =>
      a.level - b.level ||
      a.star - b.star ||
      a.aeq - b.aeq ||
      a.cons - b.cons ||
      (a.weapon.level ?? 0) - (b.weapon.level ?? 0) ||
      a.fetter - b.fetter
  )
  avatars.reverse()

  const first = avatars[0]
  return {
    game: opts.game,
    uid: opts.uid,
    save_id: opts.uid,
    elem: DEFAULT_ELEM[opts.game],
    mode: opts.mode ?? "stat",
    isRole: false,
    // 模板按周几高亮今日可刷的天赋材料；`#天赋统计` 属后续阶段，此处给当前周几即可
    week: new Date().getDay(),
    // 技能键的次序，模板照它逐列画。**由本层给而非在模板里再写一遍**：权威来源是 {@link ZZZ_SKILL_NAMES}，两处漂移会让技能列取到 undefined 全印 1 级、而模板取不到键只渲染成空不报错
    talentKeys,
    avatars,
    face: {
      banner: first
        ? (charImgs({
            game: opts.game,
            name: first.name,
            ...(opts.exists ? { exists: opts.exists } : {})
          })["banner"] ?? "")
        : "",
      face: first?.face ?? "",
      qFace: first?.face ?? "",
      name: opts.name,
      sign: "",
      level: 0
    },
    info: {
      stats: {},
      statMap: { achievement: "成就", avatar: "角色", avatar5: "五星角色" }
    },
    updateTime: {}
  }
}

/** 排行维度 → 标题里的那个词 */
const RANK_TITLE: Readonly<Record<string, string>> = {
  dmg: "",
  mark: "圣遗物评分",
  crit: "双爆副词条",
  valid: "加权有效词条"
}

/** 星铁的遗器叫遗器，标题里要跟着换 */
const SR_RANK_TITLE: Readonly<Record<string, string>> = { ...RANK_TITLE, mark: "遗器评分" }

/** 绝区零的驱动盘同理 */
const ZZZ_RANK_TITLE: Readonly<Record<string, string>> = { ...RANK_TITLE, mark: "驱动盘评分" }

/** 排行一行的天赋圈 */
export interface RankTalent {
  /** 天赋键 */
  key: string
  /** 含命座 / 星魂加成的等级 */
  level: number
  /** 有加成 */
  plus: boolean
  /** 原始等级已满 */
  crown: boolean
  /** 图标，相对元数据根或资源根（按 `meta-` 前缀判） */
  icon: string
}

/** 排行图上一位玩家：头像与昵称 */
export interface RankWho {
  /** 头像路径 */
  face: string
  /** 头像的根：头像库 / 插件资源 / 元数据 */
  root: "face" | "res" | "meta"
  /** 游戏内昵称；空串时模板印角色简称 */
  name: string
}

/** 排行图共用的几项选项 */
export interface RankViewOptions {
  /** uid → 玩家头像与昵称，取不到的那位用角色头像垫 */
  who?: Readonly<Record<string, { face: string; fromFace?: boolean; fromRes?: boolean; name: string }>>
  /** 天赋圈的元素框（`common/bg/talent-<frame>.webp`），空串即不垫框 */
  frame?: string
  /** 伤害维那条伤害的标题，各行共用 */
  dmgTitle?: string
  /** 套装名 → 简称，几套并列时用 */
  setAbbr?: (name: string) => string | undefined
  /** 发起者自己名下的 uid，那几行加框 */
  selfUids?: readonly string[]
  /** 榜上这几份面板最晚的那次更新（毫秒）；不给则副标题不印这一段 */
  updatedAt?: number
  /** 满级冠图，相对元数据根；只绝区零给（「仓鼠笼」访问器），另两游戏用插件资源里的冠 */
  crownIcon?: string
}

/**
 * 排行页头的副标题：伤害标题、最后更新、换维说明三段，哪段没有就不接
 * @param dmgTitle 伤害维那条伤害的标题
 * @param opts 视图选项
 * @param note 换维说明
 * @returns 副标题
 */
function rankHeadSub(dmgTitle: string, opts: RankViewOptions, note: string): string {
  return [
    dmgTitle ? `当前排行伤害：${dmgTitle}` : "",
    opts.updatedAt ? `榜上面板最后更新 ${stamp(opts.updatedAt)}` : "",
    note
  ]
    .filter(Boolean)
    .join("　")
}

/** 天赋圈的次序：星铁忆灵 / 欢愉多出来的那几项排在末尾，绝区零六项另起一套 */
const RANK_TALENT_ORDER: Readonly<Record<PanelGame, readonly string[]>> = {
  gs: ["a", "e", "q"],
  sr: ["a", "e", "t", "q", "me", "mt", "j"],
  zzz: ["normal", "special", "dodge", "chain", "core", "assist"]
}

/**
 * 排行一行的天赋圈
 *
 * 只排面板里有的键：星铁普通角色没有 `me`/`mt`/`j`，写死七项会多出几个空圈。原神星铁原始等级满 10 戴冠，绝区零按各技能的满级。
 * @param game 游戏
 * @param talent 键 → 等级与原始等级（绝区零另带满级）
 * @param imgs 角色图标表，按天赋键取
 * @returns 天赋圈
 */
function rankTalents(
  game: PanelGame,
  talent: Readonly<Record<string, { level: number; original: number; max?: number }>>,
  imgs: Readonly<Record<string, string | undefined>>
): RankTalent[] {
  return RANK_TALENT_ORDER[game]
    .filter(key => talent[key] !== undefined)
    .map(key => {
      const it = talent[key] ?? { level: 0, original: 0 }
      return {
        key,
        level: it.level,
        plus: it.level > it.original,
        crown: it.original >= (it.max ?? 10),
        icon: imgs[key] ?? ""
      }
    })
}

/**
 * 套装那一行字：一套写「名字 + 件数」，几套并列时换简称
 * @param sets 套装名 → 件数，已只留两件以上的
 * @param abbr 套装名 → 简称
 * @returns 那一行字；一套都没有时「散件」
 */
function rankSetText(sets: readonly [string, number][], abbr?: (name: string) => string | undefined): string {
  if (sets.length === 0) return "散件"
  if (sets.length === 1) return `${sets[0]?.[0] ?? ""}${sets[0]?.[1] ?? ""}`
  return sets.map(([name, n]) => `${abbr?.(name) || name.slice(0, 2)}${n}`).join("+")
}

/**
 * 一位玩家的头像与昵称：头像库里没有时垫角色头像
 * @param who 命令层取到的那一份
 * @param charFace 角色头像，相对元数据根
 * @returns 头像与昵称
 */
function rankWho(
  who: { face: string; fromFace?: boolean; fromRes?: boolean; name: string } | undefined,
  charFace: string
): RankWho {
  if (who?.fromFace) return { face: who.face, root: "face", name: who.name }
  return { face: charFace, root: "meta", name: who?.name ?? "" }
}

/** 分值那一栏下的小字：伤害维换成那条伤害的标题 */
const RANK_VAL_LABEL: Readonly<Record<string, string>> = {
  dmg: "期望伤害",
  mark: "评分",
  crit: "双爆副词条",
  valid: "加权有效词条"
}

/**
 * 把一批排名转成 `character/rank-profile-list` 要的形态
 *
 * 模板逐行读 `who` / `tals` / `weapon` / `artisSet` / `artisMark` / `_formatmark` 六块；
 * 天赋圈、套装字与玩家头像都由本层排好，模板不再按游戏查表。
 * @param rows 逐名的面板与名次
 * @param opts 选项
 * @returns 模板数据
 */
export function rankListData(
  rows: readonly { panel: BuiltPanel; rank: number; score: number }[],
  opts: {
    /** 游戏 */
    game: PanelGame
    /** 排行维度 */
    type: string
    /** 角色名 */
    charName: string
    /** 元素，决定整张图的配色 */
    elem: string
    /** 群排行配置，模板底部那段说明要用 */
    cfg: { time: string; limitTxt: string; number: number }
    /** 副标题里多出来的一句，如"换了维度"的说明；不给则不画 */
    note?: string
    /** 判元数据里的路径是否存在，图标的回落要用（见 {@link charImgs}） */
    exists?: (rel: string) => boolean
  } & RankViewOptions
): PanelTemplateData {
  const titles = opts.game === "sr" ? SR_RANK_TITLE : RANK_TITLE
  const list = rows.map(({ panel, score }) => {
    const imgs = charImgs({
      game: panel.game,
      name: panel.name,
      costume: panel.costume,
      ...(panel.weapon?.type ? { weaponType: panel.weapon.type } : {}),
      ...(panel.talentCons ? { talentCons: panel.talentCons } : {}),
      ...(opts.exists ? { exists: opts.exists } : {})
    })
    // 只有两件以上才算成套，单件不显示
    const setCounts = Object.entries(panel.sets).filter(([, count]) => count >= 2)
    const talent = talentView(panel)
    return {
      uid: panel.uid,
      id: panel.id,
      star: panel.star,
      sName: panel.abbr,
      name: panel.name,
      level: panel.level,
      cons: panel.cons,
      elem: panel.elem,
      imgs,
      who: rankWho(opts.who?.[panel.uid], imgs["face"] ?? ""),
      self: opts.selfUids?.includes(panel.uid) ?? false,
      tals: rankTalents(panel.game, talent, imgs),
      talent,
      weapon: panel.weapon
        ? {
            name: panel.weapon.name,
            abbr: panel.weapon.abbr,
            level: panel.weapon.level,
            affix: panel.weapon.affix,
            star: panel.weapon.star,
            img: panel.weapon.img ?? ""
          }
        : undefined,
      artisSet: {
        name: rankSetText(setCounts, opts.setAbbr),
        imgs: setImgs(panel.game, setCounts.map(([name]) => name), panel.artis)
      },
      artisMark: panel.mark ? { mark: panel.mark.mark, markClass: panel.mark.markClass } : false,
      _formatmark: comma(score, 1),
      isMax: false
    }
  })

  const dmgTitle = opts.type === "dmg" ? (opts.dmgTitle ?? "") : ""
  return {
    game: opts.game,
    elem: opts.elem,
    mode: opts.type,
    bodyClass: `char-${opts.charName}`,
    title: `${SHORT_PREFIX[opts.game]}${opts.charName}${titles[opts.type] ?? ""}排行`,
    list,
    groupRank: true,
    rankCfg: opts.cfg,
    rankNote: opts.note ?? "",
    headSub: rankHeadSub(dmgTitle, opts, opts.note ?? ""),
    frame: opts.frame ?? "",
    crownIcon: "",
    valLabel: dmgTitle || (opts.type === "mark" ? titles["mark"] : RANK_VAL_LABEL[opts.type]) || "",
    data: { title: dmgTitle }
  }
}

/**
 * 套装那一格的图：每套取一件，最多两张
 *
 * 逐件全取会让四件套占满两格而第二套挤不进去。
 * @param game 游戏
 * @param sets 成套的套装名
 * @param artis 各件
 * @returns 图，相对元数据根
 */
function setImgs(game: PanelGame, sets: readonly string[], artis: readonly BuiltArti[]): string[] {
  return sets
    .map(name => artis.find(one => one.set === name))
    .filter((one): one is BuiltArti => one !== undefined)
    .map(one => artiImg(game, one))
    .slice(0, 2)
}

/**
 * 排行的纯文字形态
 * @param rows 逐名的面板与名次
 * @param charName 角色名
 * @param type 排行维度
 * @returns 多行文本
 */
export function rankListText(
  rows: readonly { panel: BuiltPanel; rank: number; score: number }[],
  charName: string,
  type: string
): string {
  if (rows.length === 0) return `暂无 ${charName} 的排行数据`
  const lines = [`${charName}${RANK_TITLE[type] ?? ""}排行`]
  for (const { panel, rank, score } of rows) {
    lines.push(`${INDENT}${rank}. UID ${panel.uid} ${panel.level} 级 ${panel.cons} 命 —— ${comma(score, 1)}`)
  }
  return lines.join("\n")
}

/**
 * 练度统计的纯文字形态
 * @param data 模板数据
 * @returns 多行文本
 */
export function panelStatText(data: PanelTemplateData): string {
  const avatars = (data["avatars"] as { abbr?: string; level?: number; cons?: number }[] | undefined) ?? []
  if (avatars.length === 0) return "暂无角色数据"
  const lines = [`共 ${avatars.length} 个角色`]
  for (const one of avatars.slice(0, 20)) {
    lines.push(`${INDENT}${one.abbr ?? ""} ${one.level ?? 0} 级 ${one.cons ?? 0} 命`)
  }
  if (avatars.length > 20) lines.push(`${INDENT}…另有 ${avatars.length - 20} 个`)
  return lines.join("\n")
}

/**
 * 单个角色面板的纯文字形态
 * @param panel 装好的面板
 * @returns 多行文本
 */
export function panelText(panel: BuiltPanel): string {
  const attr = formatAttr(panel.attr as Record<string, unknown>, panel.base, panel.game)
  const keys = panel.game === "gs" ? ["hp", "atk", "def", "mastery", "cpct", "cdmg", "recharge"] : ["hp", "atk", "def", "speed", "cpct", "cdmg"]
  const titles: Record<string, string> = {
    hp: "生命",
    atk: "攻击",
    def: "防御",
    mastery: "精通",
    speed: "速度",
    cpct: "暴击",
    cdmg: "爆伤",
    recharge: "充能"
  }
  const lines = [
    `${panel.name} ${panel.level} 级 ${panel.cons} 命（UID ${panel.uid}）`,
    ...(panel.weapon ? [`${INDENT}武器 ${panel.weapon.abbr} ${panel.weapon.level} 级 ${panel.weapon.affix} 精`] : []),
    ...keys.map(key => `${INDENT}${titles[key] ?? key} ${attr[key] ?? "-"}`)
  ]
  if (panel.mark) lines.push(`${INDENT}评分 ${panel.mark.mark}（${panel.mark.markClass}）${panel.mark.classTitle}`)
  if (panel.source) lines.push(`数据来自 ${panel.source}`)
  return lines.join("\n")
}

/** 出图要的一份上下文，绝区零那一路 */
export interface ZzzPanelOptions {
  /** uid */
  uid: string
  /** 评分结果，评不出时省略 */
  mark?: ZzzScoreResult
  /** 面板数据的时间戳 */
  at?: number
  /**
   * 使用者上传的面板图，相对面板图根目录
   *
   * 给了就用它顶掉元数据里的立绘。模板据 `data.splashUpload` 决定用哪个根 ——
   * 上传的那张在 `_panel_path` 下、元数据里那张在 `_meta_path` 下。
   */
  splash?: string
  /** 元数据装载器，音擎图要按名字查（它在 `weapon/<职业>/<名>/icon.webp` 下） */
  meta?: MetaLoader
  /** 判元数据里的路径是否存在，图标的回落要用（见 {@link charImgs}） */
  exists?: (rel: string) => boolean
  /**
   * 伤害计算结果，由 `views/zzz/dmg.ts` 折成模板要的形态
   *
   * **与另两个游戏同一个键**：模板那一段伤害栏三个游戏共用（见 `character/profile-detail`
   * 的 `{{ set {...} = dmgCalc || {} }}`），故这里也叫 `dmgCalc`。算不出时省略即可，
   * 模板兜的那个空对象会让整栏不画。
   */
  dmgCalc?: unknown
  /**
   * 模式：`profile` 面板 / `dmg` 伤害 / `artis` 驱动盘评分拆解
   *
   * 与另两个游戏同一个键、同一套取值。`dmg` 模式下模板另画一块 Buff 列表；
   * 词条收益对比那一块要 `dmgCfg` 与 `dmgRet`，绝区零不给那两项，故那一块自然不画。
   * `artis` 模式要同时给 `mark`，否则拆解表无从算起、退回普通面板。
   */
  mode?: string
}

/**
 * 一条驱动盘词条 → 模板要的形态
 *
 * 键取词条键（认不出时退回中文名），模板按 `artisKeyTitle[key]` 取标题、按
 * `charWeight[key]` 取配色，两处都与另两个游戏同一副用法。
 * @param one 词条
 * @returns 模板要的一条
 */
function zzzAttrRow(one: ZzzGearAttr): { key: string; value: string; upNum: number; eff: string } {
  const rolls = Math.max(1, one.rolls || 1)
  return {
    key: one.key ?? one.name ?? zzzPropName(one.id),
    value: one.value,
    // 出现次数即强化档：1 次是初始、sprite 的 up-1 不画箭头，与另两个游戏的 upNum 同一含义
    upNum: rolls,
    // 左侧数字印词条效率（见 formatEff）。绝区零每次强化固定值、无档位随机，故效率即出现次数
    eff: formatEff(rolls, "zzz")
  }
}

/**
 * 词条键 → 展示名，绝区零那一路
 *
 * 以代码里那份属性名表为底，再把这一位身上实际出现的词条按它自己的中文名补一遍 ——
 * 接口给的名字是当期官方叫法，比任何本地表都新，而认不出的键若不补就会印出字面的 undefined。
 * @param detail 面板
 * @returns 键 → 展示名
 */
function zzzKeyTitles(detail: ZzzAvatarDetail): Record<string, string> {
  // 底表取**认得的属性名全集**而不是属性栏那十二行：词条里的 `冰属性伤害加成` 该印全名，
  // 而属性栏那一份已把六种并成了一个合成键，拿它当底表会让那几条词条印出键名
  const out: Record<string, string> = { ...ZZZ_PROP_NAME }
  const put = (one?: ZzzGearAttr): void => {
    if (!one) return
    const key = one.key ?? one.name ?? zzzPropName(one.id)
    if (key) out[key] = one.name || out[key] || key
  }
  for (const disc of detail.discs) {
    put(disc.main)
    for (const sub of disc.subs) put(sub)
  }
  // **音擎的主副属性不进这张表**：它的主属性叫「基础攻击力」而键同样是 `atk`，收进来会把
  // 驱动盘上那条「攻击力」一并改名。音擎那一块有自己的 `attrList` 标题，不读这张表
  return out
}

/**
 * 总属性栏 → 模板要的形态
 *
 * 模板逐键取 `attr[key]` / `attr[key+'Base']` / `attr[key+'Plus']`，与另两个游戏同一副用法。
 * **值原样透传，不重排小数位**：接口给的是与游戏内逐字相同的成品文本，自己按数值重排会差一位。
 *
 * **六种属性伤害加成并成一行 `dmgElem`**：属性栏那一份（`ZZZ_PANEL_ATTRS`）只留这一个合成键，
 * 值取**该代理人自己那一种** —— 逐种各占一行的结果是六行里五行恒为 0。接口不给那一条时
 * 补一份 0 的三联，否则模板会在那一格印字面的 undefined。
 * @param detail 面板
 * @returns 键 → 成品文本
 */
function zzzAttrView(detail: ZzzAvatarDetail): FormattedAttr {
  const out: FormattedAttr = {}
  for (const one of detail.attrs) {
    const key = one.key ?? ""
    if (!key) continue
    // 与原神星铁那栏同形：`value` 印最终值、`value2` 印「白值 +加成」，两格恒有值。三围接口给了 base/add 直接用；暴击率一类只给 final 的，白值取 final、加成按「没有就为 0」补（百分数补 0.0%）
    const zero = isPct(one.final) ? "0.0%" : "0"
    out[key] = one.final
    out[`${key}Base`] = one.base ?? one.final
    out[`${key}Plus`] = one.add ?? zero
  }

  const mine = ZZZ_ELEM_DMG_PROP[String(detail.elemId ?? "")]
  const has = mine && out[mine] !== undefined
  out[ZZZ_ELEM_DMG_KEY] = has ? (out[mine] as string) : "0.0%"
  out[`${ZZZ_ELEM_DMG_KEY}Base`] = has ? (out[`${mine}Base`] as string) : "0.0%"
  out[`${ZZZ_ELEM_DMG_KEY}Plus`] = has ? (out[`${mine}Plus`] as string) : "0.0%"
  return out
}

/**
 * 六件驱动盘 → `artisDetail` 那一块
 *
 * 与另两个游戏逐键同形：`artis` 按部位号索引、`allAttr` 是九格词条汇总、`charWeight` 决定配色。
 * **`allAttr` 不足九格要补空对象** —— 模板固定画九格，少了末尾几格的边框错位。
 * @param detail 面板
 * @param mark 评分结果
 * @returns `artisDetail` 那一块
 */
function zzzDiscsView(detail: ZzzAvatarDetail, mark?: ZzzScoreResult): Record<string, unknown> {
  const artis: Record<string, ArtiView> = {}
  const byPos = mark?.byPos ?? {}
  for (const one of detail.discs) {
    const view: ArtiView = {
      idx: one.pos,
      name: one.name,
      set: one.set ?? "",
      level: one.level,
      img: artiSetImg("zzz", one.set ?? "", one.pos),
      // 驱动盘的评分不逐条拆，每条记 0：模板那一列印 0.0 而不是 NaN
      attrs: one.subs.map(sub => ({ ...zzzAttrRow(sub), _mark: 0 }))
    }
    if (one.main) view.main = { key: zzzAttrRow(one.main).key, value: one.main.value, mark: 0 }
    const score = byPos[String(one.pos)]
    if (score !== undefined) {
      view.mark = score.toFixed(1)
      view.markClass = one.rank
    }
    artis[String(one.pos)] = view
  }

  // 词条汇总：按键累加**数值**（印六件合计值、非出现次数），强化次数改由逐盘那格的圆点展示。**按「键 + 单位」分组**：生命/攻击/防御既有数值又有百分比两种副词条且共用一个键（`atk`），只按键分组会把「攻击 13」与「攻击 2%」加成无意义的 15，故点数与百分比各成一行
  const agg = new Map<string, { key: string; sum: number; pct: boolean; rolls: number }>()
  for (const one of detail.discs) {
    for (const sub of one.subs) {
      const key = zzzAttrRow(sub).key
      const pct = isPct(sub.value)
      const bucket = `${key}|${pct ? "1" : "0"}`
      const got = agg.get(bucket) ?? { key, sum: 0, pct, rolls: 0 }
      got.sum += propValue(sub.value)
      got.rolls += sub.rolls || 1
      agg.set(bucket, got)
    }
  }
  const allAttr: Record<string, unknown>[] = [...agg.values()]
    .sort((a, b) => b.rolls - a.rolls || a.key.localeCompare(b.key))
    .map(it => ({
      key: it.key,
      value: it.pct ? `${it.sum.toFixed(1)}%` : String(Math.round(it.sum)),
      // 汇总那一栏不画箭头（与原神星铁一致），数字印**词条效率合计**（绝区零即总出现次数）
      upNum: it.rolls,
      eff: formatEff(it.rolls, "zzz")
    }))
  while (allAttr.length < 9) allAttr.push({})

  return {
    artis,
    allAttr,
    mark: mark ? mark.score.toFixed(1) : "",
    markClass: mark?.markClass ?? "",
    classTitle: mark?.rule ?? "",
    // 取 `keyWeight` 而不是 `weight`：模板按 `charWeight[attr.key]` 取配色，而 `attr.key`
    // 是词条键（见 zzzAttrRow），`weight` 那一份按属性编号索引、只供计分用
    charWeight: mark?.keyWeight ?? {}
  }
}

/**
 * 单个代理人的面板 → `character/profile-detail` 要的形态
 *
 * **产出与 {@link profileDetailData} 逐键同形**，故三个游戏共用那一张模板：驱动盘落
 * `artisDetail`、音擎落 `data.weapon`、六个技能等级落 `data.talent`、影画数落 `data.cons`。
 * @param one 存下来的面板
 * @param opts 上下文
 * @returns 模板数据
 */
/**
 * 把一批绝区零的排名转成 `character/rank-profile-list` 要的形态
 *
 * 与 {@link rankListData} 同一张模板：逐行那六块（`sName` / `talent` / `weapon` / `artisSet` /
 * `artisMark` / `dmg`）照绝区零自己的形态填 —— 音擎当武器、驱动盘套装当圣遗物套装、
 * 技能等级当天赋。`dmg` 那一块一律不给：榜上那个数由 `_formatmark` 印，模板据此走另一支。
 * @param rows 逐名的存档与名次
 * @param opts 选项
 * @returns 模板数据
 */
export function zzzRankListData(
  rows: readonly { one: StoredAvatar; rank: number; score: number; mark?: ZzzScoreResult; uid?: string }[],
  opts: {
    /** 排行维度 */
    type: string
    /** 代理人名 */
    charName: string
    /** 群排行配置 */
    cfg: { time: string; limitTxt: string; number: number }
    /** 副标题里多出来的一句 */
    note?: string
    /** 元数据装载器 */
    meta?: MetaLoader
    /** 判元数据里的路径是否存在 */
    exists?: (rel: string) => boolean
  } & Omit<RankViewOptions, "frame">
): PanelTemplateData {
  const list = rows.flatMap(({ one, score, mark, uid }) => {
    const detail = one.zzz
    if (!detail) return []
    const imgs = charImgs({
      game: "zzz",
      name: detail.name,
      ...(opts.exists ? { exists: opts.exists } : {})
    })
    const talent: Record<string, { level: number; original: number; max: number }> = {}
    for (const it of ZZZ_SKILL_NAMES) {
      const level = Number(one.talent?.[it.key]) || 0
      // **核心技满级是 7 而其余是 12**：皇冠按 `level >= max` 判，给死 12 则练满的核心技永不戴冠
      talent[it.key] = { level, original: level, max: zzzSkillMax(it.key) }
      // 模板一律按技能键取图标（`imgs[key]`），而绝区零普攻的图标键是 `basic`
      // 而非技能键 `normal`。此处补一份别名，不补则普攻那一格恒是空图
      if (it.icon !== it.key) imgs[it.key] = imgs[it.icon] ?? ""
    }
    const weaponMeta = detail.weapon ? opts.meta?.byName("zzz", detail.weapon.name) : undefined
    // zzzSets 已只留两件以上的，不必再过一遍
    const setList = zzzSets(detail.discs)
    const sets = setList.map(it => it.name)
    // 存档的 id 是代理人 id，不是玩家 uid：行上印 uid、取玩家头像都要命令层给的那个
    const owner = uid ?? ""
    return [
      {
        uid: owner,
        id: one.id,
        who: rankWho(opts.who?.[owner], imgs["face"] ?? ""),
        self: owner !== "" && (opts.selfUids?.includes(owner) ?? false),
        tals: rankTalents("zzz", talent, imgs),
        star: ZZZ_RANK_STAR[detail.rank] ?? 4,
        sName: opts.meta?.byName("zzz", detail.name)?.abbr ?? detail.name,
        name: detail.name,
        level: one.level,
        cons: one.cons,
        elem: zzzElemName(detail.elemId),
        imgs,
        talent,
        // **没有音擎时整项不给而不是给 `{}`**：模板那一支按 `ds.weapon` 判真假，
        // 空对象照样为真、随后取 `.name.length` 当场抛错（真渲染测试即由此发现）
        ...(detail.weapon ? { weapon: zzzWeaponView(detail, weaponMeta?.icon ?? "", undefined) } : {}),
        artisSet: {
          name: rankSetText(setList.map(it => [it.name, it.own]), opts.setAbbr),
          // 每套取一件，与原神星铁那一路同口径
          imgs: sets
            .map(name => detail.discs.find(it => it.set === name))
            .flatMap(it => (it?.set ? [artiSetImg("zzz", it.set, it.pos)] : []))
            .slice(0, 2)
        },
        artisMark: mark ? { mark: mark.score.toFixed(1), markClass: mark.markClass } : false,
        _formatmark: comma(score, 1),
        isMax: false
      }
    ]
  })

  const dmgTitle = opts.type === "dmg" ? (opts.dmgTitle ?? "") : ""
  return {
    game: "zzz",
    elem: zzzElemName(rows[0]?.one.zzz?.elemId) || "流明",
    mode: opts.type,
    bodyClass: `char-${opts.charName}`,
    title: `${SHORT_PREFIX.zzz}${opts.charName}${ZZZ_RANK_TITLE[opts.type] ?? ""}排行`,
    list,
    groupRank: true,
    rankCfg: opts.cfg,
    rankNote: opts.note ?? "",
    headSub: rankHeadSub(dmgTitle, opts, opts.note ?? ""),
    frame: "",
    crownIcon: opts.crownIcon ?? "",
    valLabel: dmgTitle || (opts.type === "mark" ? ZZZ_RANK_TITLE["mark"] : RANK_VAL_LABEL[opts.type]) || "",
    data: { title: dmgTitle }
  }
}

/**
 * 把一位代理人的存档转成 `character/profile-detail` 要的形态 —— 绝区零这一路
 *
 * 与原神星铁同一张模板：属性栏、武器栏与装备栏各按绝区零自己的形态填。
 * @param one 存起来的代理人面板
 * @param opts 上下文
 * @returns 模板数据
 */
export function zzzPanelData(one: StoredAvatar, opts: ZzzPanelOptions): PanelTemplateData {
  const detail = one.zzz
  if (!detail) return { game: "zzz", uid: opts.uid, data: { name: "", level: one.level } }

  const imgs = charImgs({
    game: "zzz",
    name: detail.name,
    ...(opts.exists ? { exists: opts.exists } : {})
  })
  const talent: Record<string, { level: number; original: number }> = {}
  for (const it of ZZZ_SKILL_NAMES) {
    const level = Number(one.talent?.[it.key]) || 0
    talent[it.key] = { level, original: level }
  }
  const item = opts.meta?.byName("zzz", detail.name)
  const weaponMeta = detail.weapon ? opts.meta?.byName("zzz", detail.weapon.name) : undefined
  // 音擎的效果说明按叠影分五档，在整份 data.json 里而不在索引上，故按 id 另读一次
  const weaponDetail = weaponMeta ? opts.meta?.detail("zzz", weaponMeta.id) : undefined

  return {
    game: "zzz",
    uid: opts.uid,
    save_id: opts.uid,
    elem: zzzElemName(detail.elemId) || "流明",
    mode: opts.mode ?? "profile",
    // 属性那一段是给样式表用的：属性栏「属性伤害加成」那一格按它换图标，见 ZZZ_ELEM_SLUG
    bodyClass: `char-${detail.name} zzz-elem-${ZZZ_ELEM_SLUG[String(detail.elemId ?? "")] ?? "phy"}`,
    attr: zzzAttrView(detail),
    // 属性栏那几行的名字与次序由 panel/prop 给，不写在模板里
    attrMap: propMapOf("zzz"),
    data: {
      name: detail.name,
      abbr: item?.abbr ?? detail.name,
      level: one.level,
      // 影画与命座在模板上是同一栏，故用同一个键
      cons: one.cons,
      star: ZZZ_RANK_STAR[detail.rank] ?? 4,
      talent,
      dataSource: one.from ?? "",
      updateTime: opts.at ?? one.at ? timeText(opts.at ?? one.at ?? 0) : "",
      imgs,
      costumeSplash: opts.splash || imgs["splash"] || "",
      splashUpload: !!opts.splash,
      weapon: zzzWeaponView(detail, weaponMeta?.icon ?? "", weaponDetail),
      // 这三项只有绝区零有，模板据它多印一行身份
      zzzInfo: {
        fullName: detail.fullName ?? "",
        rank: detail.rank,
        prof: detail.prof ?? "",
        camp: detail.camp ?? "",
        skills: ZZZ_SKILL_NAMES,
        sets: zzzSets(detail.discs),
        ...(detail.mysRating && detail.mysScore
          ? { mysRating: detail.mysRating, mysScore: detail.mysScore.toFixed(2) }
          : {})
      }
    },
    artisDetail: zzzDiscsView(detail, opts.mark),
    artisKeyTitle: zzzKeyTitles(detail),
    ...(opts.mode === "artis" && opts.mark ? { zzzRule: zzzRuleView(detail, opts.mark) } : {}),
    ...(opts.dmgCalc ? { dmgCalc: opts.dmgCalc } : {})
  }
}

/**
 * `%<代理人>驱动盘` 那两张拆解表的数据
 *
 * 逐件分数由 {@link discBreakdown} 现算、与评分同一套算法，故表里逐列相乘恰是最终分。
 * 权重表按词条名合并同名的百分比与数值两项（`攻击力%` / `攻击力`），权重为 0 的不列。
 * @param detail 面板
 * @param mark 评分结果
 * @returns 模板 `zzzRule`
 */
function zzzRuleView(detail: ZzzAvatarDetail, mark: ZzzScoreResult): Record<string, unknown> {
  const discs = [...detail.discs]
    .sort((a, b) => a.pos - b.pos)
    .map(one => {
      const got = discBreakdown(one, mark.weight)
      return {
        pos: one.pos,
        main: got.main === undefined ? "-" : got.main.toFixed(1),
        sub: got.sub.toFixed(1),
        mul: `${got.levelMul.toFixed(2)} × ${got.rarityMul === 1 ? "1" : got.rarityMul.toFixed(2)}`,
        total: got.total.toFixed(1),
        markClass: markClassOf(got.total)
      }
    })
  const weights = Object.entries(mark.weight)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, w]) => {
      const name = zzzPropName(id) || id
      // 生命 / 攻击 / 防御有百分比（xx102）与数值（xx103）两种副词条，同名不分开就看不出折算
      const pct = /^1[123]102$/.test(id)
      return { title: pct ? `${name}%` : name, weight: Math.round(w) }
    })
  return { rule: mark.rule, discs, weights }
}

/**
 * 音擎的效果说明 → `weapon.desc` 那一块
 *
 * 与原神那路（`weaponAffixDesc`）同口径：**只取当前这一档**、不并列五档。文本里的 `<nobr>` 由模板 `{{@}}` 原样输出。
 *
 * **两种包形态都要认**：一种是 `{desc, tables}`（占位符由 `tables[N][叠影-1]` 代入，与 `meta-sr` 光锥同形），
 * 另一种是「叠影档 → 整句」。只认一种会让另一种的音擎效果整块空白。
 * @param affix 叠影，1~5
 * @param meta 整份 `data.json`
 * @returns 效果名与说明；包里没有这一段时 undefined
 */
function zzzWeaponDesc(affix: number, meta?: MetaDetail): { name: string; desc: string } | undefined {
  const talents = meta?.talents
  if (!talents) return undefined
  const at = Math.min(5, Math.max(1, affix))

  const folded = talents as { name?: string; desc?: string; tables?: Record<string, readonly (number | string)[]> }
  if (typeof folded.desc === "string") {
    let desc = folded.desc
    // 占位符先从原串收齐再替换：边遍历边改写时长度一变就可能跳过后面的
    for (const got of [...folded.desc.matchAll(/\$(\d)\[i]/g)]) {
      const [all, idx = ""] = got
      const raw = folded.tables?.[idx]?.[at - 1]
      if (raw === undefined) continue
      desc = desc.replaceAll(all, String(raw))
    }
    return desc ? { name: folded.name ?? "", desc } : undefined
  }

  const one = (talents as Record<string, { name?: string; desc?: readonly string[] }>)[String(at)]
  const desc = (one?.desc ?? []).join("")
  return desc ? { name: one?.name ?? "", desc } : undefined
}

/**
 * 音擎 → `data.weapon` 那一块
 *
 * 与另两个游戏的武器块同键：`name` / `sName` / `level` / `star` / `affix`（叠影）/ `img` /
 * `attrs` / `desc`。**`desc` 要兜一个空对象** —— 模板写 `{{@weapon.desc?.desc}}`，
 * 取不到时印的是字面的 `undefined`。
 * @param detail 面板
 * @param img 音擎图，相对元数据根目录
 * @param meta 音擎的整份 `data.json`，效果说明从里面取
 * @returns 武器块；没装音擎时空对象
 */
function zzzWeaponView(detail: ZzzAvatarDetail, img: string, meta?: MetaDetail): Record<string, unknown> {
  const w = detail.weapon
  if (!w) return {}
  const attrs: Record<string, string> = {}
  if (w.main) attrs[w.main.key ?? "atkBase"] = w.main.value
  if (w.sub) attrs[w.sub.key ?? "sub"] = w.sub.value
  return {
    /*
     * 两格属性连标题一起给、**不让模板去 `artisKeyTitle` 里查**：那张表的 `atk` 会被音擎主属性的接口名覆盖成「基础攻击力」，
     * 而那两格各占容器一半宽、14px 字体、五个字加数值挤不进去（数值被挤到第二行）。故按属性栏短名（`攻击力`）取
     */
    attrList: [
      ...(w.main ? [{ title: ZZZ_PROP_NAME[w.main.key ?? "atk"] || w.main.name, value: w.main.value }] : []),
      ...(w.sub ? [{ title: ZZZ_PROP_NAME[w.sub.key ?? "atk"] || w.sub.name, value: w.sub.value }] : [])
    ],
    name: w.name,
    sName: w.name,
    level: w.level,
    star: ZZZ_RANK_STAR[w.rank] ?? 4,
    // 叠影在模板上占的是"精炼"那一格
    affix: w.star,
    promote: 0,
    img,
    splash: img,
    desc: zzzWeaponDesc(w.star, meta) ?? { name: "", desc: "" },
    attrs
  }
}

/** 面板列表里的一行，绝区零那一路 */
export interface ZzzPanelRow {
  /** 存下来的面板 */
  one: StoredAvatar
  /** 评分结果，评不出时省略 */
  mark?: ZzzScoreResult
}

/**
 * 一份面板列表 → `character/profile-list` 要的形态
 *
 * 与 {@link profileListData} 走同一段收尾（{@link panelListView}），排序、顶部提示、「本次获取/更新」标记与另两个游戏逐字相同。
 * **格子里印简称**：米游社给全名（`「11号」`）、列表格只放得下四个字，简称在元数据别名表里、`meta` 在位时按它取。
 * @param rows 逐位代理人
 * @param player 存下来的玩家
 * @param opts 上下文；直接查看时只给 uid
 * @returns 模板数据
 */
export function zzzPanelListData(
  rows: readonly ZzzPanelRow[],
  player: StoredPlayer,
  opts: Omit<PanelListOptions, "game" | "uid"> & { uid?: string; meta?: MetaLoader } = {}
): PanelTemplateData {
  // **`flatMap` 而非 `filter` 加断言**：`filter` 之后 TS 仍认 `.zzz` 可选，写 `as ZzzAvatarDetail` 抹掉可选性遇空值会运行期抛错
  const chars: PanelListItem[] = rows
    .flatMap(it => {
      const detail = it.one.zzz
      if (!detail) return []
      return [{
        id: it.one.id,
        name: detail.name,
        abbr: opts.meta?.byName("zzz", detail.name)?.abbr ?? detail.name,
        star: ZZZ_RANK_STAR[detail.rank] ?? 4,
        element: zzzElemName(detail.elemId),
        level: it.one.level,
        cons: it.one.cons,
        face:
          charImgs({
            game: "zzz",
            name: detail.name,
            ...(opts.exists ? { exists: opts.exists } : {})
          })["qFace"] ?? "",
        isNew: (opts.fresh ?? []).includes(it.one.id) ? 1 : 0,
        isUpdate: (opts.changed ?? []).includes(it.one.id) ? 1 : 0,
        ...(it.mark ? { mark: it.mark.score.toFixed(1), markClass: it.mark.markClass } : {}),
        // 与 profileListData 同一条：漏了它则顶层 groupRank 为真而每格都没有角标
        ...(opts.rank?.ranks[it.one.id] ? { groupRank: opts.rank.ranks[it.one.id] } : {})
      }]
    })

  return panelListView(chars, {
    ...opts,
    game: "zzz",
    uid: opts.uid ?? player.uid,
    at: opts.at ?? player.profileAt ?? 0
  })
}

/**
 * 单个代理人的面板 → 出图失败时的文本
 * @param one 存下来的面板
 * @param mark 评分结果
 * @returns 文本
 */
export function zzzPanelText(one: StoredAvatar, mark?: ZzzScoreResult): string {
  const detail = one.zzz
  if (!detail) return "暂无面板数据"
  const lines = [[`${detail.name} Lv.${one.level}`, `影画 ${one.cons}`].join("　")]
  if (detail.weapon) lines.push(`音擎：${detail.weapon.name} Lv.${detail.weapon.level} 叠影${detail.weapon.star}`)
  const attrs = detail.attrs.filter(it => it.final).map(it => `${it.name} ${it.final}`)
  if (attrs.length > 0) lines.push(attrs.join("　"))
  const sets = zzzSets(detail.discs)
  if (sets.length > 0) lines.push(`套装：${sets.map(it => `${it.name}${it.own}件`).join("、")}`)
  if (mark) lines.push(`驱动盘评分 ${mark.score.toFixed(1)}（${mark.markClass}，按${mark.rule}）`)
  if (detail.mysRating && detail.mysScore) lines.push(`米游社评分 ${detail.mysRating} ${detail.mysScore}`)
  return lines.join("\n")
}

/**
 * 面板列表 → 出图失败时的文本
 * @param rows 逐位代理人
 * @param uid uid
 * @returns 文本
 */
export function zzzPanelListText(rows: readonly ZzzPanelRow[], uid: string): string {
  const list = rows
    .slice()
    .sort((a, b) => (b.mark?.score ?? 0) - (a.mark?.score ?? 0))
    // `flatMap` 兼判空与收窄，理由同 zzzPanelListData
    .flatMap(it => {
      const detail = it.one.zzz
      if (!detail) return []
      const mark = it.mark ? `${it.mark.score.toFixed(1)} ${it.mark.markClass}` : "未评分"
      return [`${INDENT}${detail.name} Lv.${it.one.level} 影画${it.one.cons} ${mark}`]
    })
  return [`UID ${uid} 共 ${list.length} 位代理人有面板数据`, ...list].join("\n")
}
