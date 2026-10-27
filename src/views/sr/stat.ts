/**
 * 模块职责：星穹铁道战绩图的版式数据 —— 忘却之庭三类玩法共用一套模板出图
 * 依赖方向：依赖 views/sr/challenge（接口形态与三条口径）、views/panel（图标拼法）、views/avatar-list
 *          （天赋拆成天赋行与角标）与 panel/build 的类型；纯函数，不发请求、不读盘
 * 生命周期：无状态
 * 注意事项：**本模块只改版式，口径仍在 views/sr/challenge.ts**（星数减额外星、哪关不计分、节点认键三条从那取，两处各写必走样）。键名刻意与模板一致（`nodes[]` 那套）。
 *          **星格是「有几颗画几颗」**（`starList` 长度等于星数，art-template 无「重复 N 次」原语）。**图有两个根、混用不报错只是空白**（角色/光锥/套装/命途图标在元数据要 `_meta_path`，星星底图在 `resources/sr/challenge/` 要 `_res_path`，祝福与首领图标是绝对地址不加根）。
 *          **命途图标文件名有两处拼错**（`elm-ice`、`elem-auantum`），那是元数据里的真实文件名、不可「修正」（改对图标就没了）。
 */
import type { PanelGame } from "../../panel/profile/index.js"
import type { BuiltPanel } from "../../panel/build.js"
import { splitCardTalents, type CardTalent } from "../avatar-list.js"
import { artiSetImg, charImgs } from "../panel.js"
import { peakPeriod, type PeakChallengeRaw, type PeakRecordRaw } from "./peak-challenge.js"
import {
  floorNodes,
  srChallengePlain,
  srChallengeTime,
  srChallengeTitle,
  type SrChallengeAvatarRaw,
  type SrChallengeFloorRaw,
  type SrChallengeKind,
  type SrChallengeNodeRaw,
  type SrChallengeRaw
} from "./challenge.js"

/** 命途键 → 元数据里那张图标的文件名，两处拼错是元数据的真实文件名 */
const ELEM_ICON: Readonly<Record<string, string>> = {
  physical: "elem-phy",
  phy: "elem-phy",
  fire: "elem-fire",
  ice: "elm-ice",
  lightning: "elem-elec",
  elec: "elem-elec",
  wind: "elem-wind",
  quantum: "elem-auantum",
  imaginary: "elem-imaginary"
}

/** 各天赋键的满级；表里没有的按 12 */
const TALENT_MAX: Readonly<Record<string, number>> = { a: 7, e: 12, q: 12, t: 12, me: 7, mt: 7, j: 12 }

/** 天赋键在图上的次序 */
const TALENT_ORDER: readonly string[] = ["a", "e", "q", "t", "z", "me", "mt", "j"]

/**
 * 命途 → 图标的相对路径
 *
 * 战绩接口给 `lightning` / `physical`，面板一路给 `elec` / `phy`，两套写法都收。
 * @param element 命途键
 * @returns 相对元数据根的路径；不认得时空串
 */
export function srElemIcon(element: string): string {
  const name = ELEM_ICON[String(element).toLowerCase()]
  return name === undefined ? "" : `meta-sr/public/icons/${name}.webp`
}

/** 战绩图上一个角色格子里那份面板数据 */
export interface SrStatAvatarView extends Record<string, unknown> {
  /** 星级 */
  star: number
  /** 星魂数 */
  cons: number
  /** 等级 */
  level: number
  /** 简称 */
  abbr: string
  /** 全名 */
  name: string
  /** 头像，相对元数据根 */
  face: string
  /** 竖版立绘，相对元数据根；一队不足四人时宽卡用它 */
  preview?: string
  /** 天赋等级与各自的满级 */
  talent: Record<string, { level: number; max: number }>
  /** 天赋格数；为 0 时模板不画天赋行 */
  talentCount: number
  /** `common/avatar-card` 天赋行那几格（普攻 / 战技 / 终结技 / 天赋） */
  tals: CardTalent[]
  /** `common/avatar-card` 头像右下的角标：记忆的忆灵技与忆灵天赋、欢愉的欢愉技 */
  xtals: CardTalent[]
  /** 光锥 */
  weapon?: { img: string; star: number; affix: number }
  /** 套装图，最多两张 */
  artisSet?: { imgs: string[] }
}

/**
 * 面板库 → 战绩图上按角色 id 取的那张表
 *
 * 取不到面板的角色不在表里，模板据此退回接口给的头像与等级：仍出得来图，只是没有天赋与装备两行。
 * @param panels 已装好的面板
 * @param game 游戏
 * @param exists 判元数据里的路径是否存在，图标回落要用
 * @returns 角色 id → 面板视图
 */
export function srStatAvatars(
  panels: readonly BuiltPanel[],
  game: PanelGame,
  exists?: (rel: string) => boolean
): Record<string, SrStatAvatarView> {
  const out: Record<string, SrStatAvatarView> = {}
  for (const panel of panels) {
    const imgs = charImgs({ game, name: panel.name, ...(exists ? { exists } : {}) })
    const talent: Record<string, { level: number; max: number }> = {}
    for (const key of TALENT_ORDER) {
      const level = Number(panel.talent[key]) || 0
      if (level <= 0) continue
      talent[key] = { level, max: TALENT_MAX[key] ?? 12 }
    }
    const imgList: string[] = []
    for (const [set, count] of Object.entries(panel.sets ?? {})) {
      if ((Number(count) || 0) < 2) continue
      // 位面饰品没有第 1 部位，故按 exists 回落到第 5 —— 少这一步那一格空白
      const first = artiSetImg(game, set, 1)
      const img = exists === undefined || exists(first) ? first : artiSetImg(game, set, 5)
      if (img) imgList.push(img)
    }
    const split = splitCardTalents(
      Object.entries(talent).map(([key, it]) => ({ key, name: "", level: it.level, crown: it.level >= it.max }))
    )
    const one: SrStatAvatarView = {
      star: Number(panel.star) || 5,
      cons: Number(panel.cons) || 0,
      level: Number(panel.level) || 0,
      abbr: panel.abbr || panel.name,
      name: panel.name,
      face: imgs["qFace"] ?? imgs["face"] ?? "",
      ...(imgs["preview"] ? { preview: imgs["preview"] } : {}),
      talent,
      talentCount: Object.keys(talent).length,
      tals: split.tals,
      xtals: split.xtals
    }
    if (panel.weapon?.img) {
      one.weapon = {
        img: panel.weapon.img,
        star: Number(panel.weapon.star) || 4,
        affix: Number(panel.weapon.affix) || 1
      }
    }
    if (imgList.length > 0) one.artisSet = { imgs: imgList.slice(0, 2) }
    out[panel.id] = one
  }
  return out
}

/** 出这三张图需要的上下文 */
export interface SrStatContext {
  /** 挑战种类，异相仲裁不走这里 */
  kind: Exclude<SrChallengeKind, "peak">
  /** uid */
  uid: string
  /** 玩家昵称 */
  nickname?: string
  /** 查的是不是上期；`groups` 里本期是第 0 项、上期是第 1 项 */
  prev?: boolean
  /** 按角色 id 取中文名，接口不给角色名 */
  nameOf?: (id: string) => string
  /** 面板库里那份，键为角色 id；空表时模板退回接口给的头像与等级 */
  avatars?: Readonly<Record<string, SrStatAvatarView>>
}

/**
 * 逐关的取舍：哪些关卡要列出来
 *
 * 三条判据：混沌回忆排掉速通关（那几关没有战斗记录、列出来只是空卡片）；虚构叙事只要有节点就列；末日幻影速通关也列，其余要求至少一个节点有人上场。
 * @param kind 挑战种类
 * @param one 一关的记录
 * @returns 要列出来时为真
 */
function keepFloor(kind: SrStatContext["kind"], one: SrChallengeFloorRaw): boolean {
  const nodes = floorNodes(one).filter(it => it !== undefined)
  const manned = nodes.some(it => (it?.avatars ?? []).length > 0)
  if (kind === "memory") return one.is_fast !== true && nodes.length > 0
  if (kind === "boss") return one.is_fast === true || manned
  return nodes.length > 0
}

/**
 * 一个上场角色 → 模板要的形态
 * @param raw 接口给的角色
 * @param nameOf 按 id 取角色名
 * @returns 角色视图
 */
function statAvatar(raw: SrChallengeAvatarRaw, nameOf: (id: string) => string): Record<string, unknown> {
  const id = String(raw.id ?? "")
  return {
    id,
    name: id === "" ? "" : nameOf(id),
    icon: raw.icon ?? "",
    level: Number(raw.level) || 0,
    rarity: Number(raw.rarity) || 5,
    rank: Number(raw.rank) || 0,
    elemIcon: srElemIcon(raw.element ?? "")
  }
}

/** 祝福那一段，三条键名都收：不同玩法给的键不同名 */
interface StatBuffRaw {
  /** 祝福名 */
  name_mi18n?: string
  /** 另一种写法 */
  name?: string
  /** 说明，带富文本标签 */
  desc_mi18n?: string
  /** 另一种写法 */
  desc?: string
  /** 战意机制那一行，官方的键名末位是 m 而不是 n */
  simple_desc_mi18m?: string
  /** 图标，米游社的绝对地址 */
  icon?: string
}

/** 一个节点里祝福可能落在的三处 */
interface StatNodeExtra {
  /** 忘却之庭那一族 */
  buff?: StatBuffRaw
  /** 混沌回忆给的是这个键 */
  maze_buff?: StatBuffRaw
  /** 另有给成数组的 */
  buff_list?: StatBuffRaw[]
}

/**
 * 一个节点 → 模板要的形态
 *
 * 接口没给这个节点时给空壳而不是丢掉它：**丢掉会让节点号错位** —— 只打了第一与第三个节点时，第三个会被印成「节点2」。空壳里角色数为 0，模板据此整块不画。
 * @param raw 节点记录
 * @param nameOf 按 id 取角色名
 * @returns 节点视图
 */
function statNode(raw: SrChallengeNodeRaw | undefined, nameOf: (id: string) => string): Record<string, unknown> {
  const extra = (raw ?? {}) as SrChallengeNodeRaw & StatNodeExtra
  const buff = extra.buff ?? extra.maze_buff ?? extra.buff_list?.[0]
  return {
    score: Number(raw?.score) || 0,
    time: srChallengeTime(raw?.challenge_time),
    avatars: (raw?.avatars ?? []).map(one => statAvatar(one, nameOf)),
    buffName: buff?.name_mi18n ?? buff?.name ?? "",
    buffIcon: buff?.icon ?? "",
    buffDesc: srChallengePlain(buff?.desc_mi18n ?? buff?.desc),
    buffMech: srChallengePlain(buff?.simple_desc_mi18m)
  }
}

/** 奖牌档位在图标文件名里的编号，沿用官方那张表的次序（1 铜、2 金、3 银、4 Ultra） */
const MEDAL_ORDER: readonly string[] = [
  "ChallengePeakRankIconTypeNone",
  "ChallengePeakRankIconTypeBronze",
  "ChallengePeakRankIconTypeGold",
  "ChallengePeakRankIconTypeSilver",
  "ChallengePeakRankIconTypeUltra"
]

/** 一场战斗的星格上限，官方那张图上恒为三格 */
const PEAK_STARS = 3

/**
 * 一场战斗 → 模板要的形态
 * @param raw 战斗记录
 * @param nameOf 按 id 取角色名
 * @returns 战斗视图
 */
function peakRecord(
  raw: PeakRecordRaw | undefined,
  nameOf: (id: string) => string
): Record<string, unknown> {
  const star = Math.max(0, Math.min(PEAK_STARS, Number(raw?.star_num) || 0))
  return {
    done: raw?.has_challenge_record === true,
    isFast: raw?.is_fast === true,
    hardMode: raw?.hard_mode === true,
    roundNum: Number(raw?.round_num) || 0,
    starList: Array.from({ length: star }, (_unused, idx) => idx),
    failList: Array.from({ length: PEAK_STARS - star }, (_unused, idx) => idx),
    timeText: srChallengeTime(raw?.challenge_time),
    avatars: (raw?.avatars ?? []).map(one => statAvatar(one, nameOf)),
    buffName: raw?.buff?.name_mi18n ?? "",
    buffIcon: raw?.buff?.icon ?? "",
    buffDesc: srChallengePlain(raw?.buff?.desc_mi18n)
  }
}

/**
 * 把一份异相仲裁返回转成既有版式那张图要的形态
 *
 * **骑士关卡以 `mob_infos` 为准遍历**，`mob_records` 按下标配对：两个平行数组，以后者为准会让「还没打的关卡」整个不出现。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function peakChallengeStatData(
  raw: PeakChallengeRaw | undefined,
  ctx: Omit<SrStatContext, "kind">
): Record<string, unknown> {
  const nameOf = ctx.nameOf ?? ((): string => "")
  const period = peakPeriod(raw)
  const brief = raw?.challenge_peak_best_record_brief ?? {}
  const infos = period?.mob_infos ?? []

  return {
    title: "异相仲裁",
    uid: ctx.uid,
    save_id: ctx.uid,
    type: ctx.prev === true ? 2 : 1,
    // 这一族接口自带昵称，故这张图印得出昵称（忘却之庭那三张印不出）
    nickname: raw?.role?.nickname ?? ctx.nickname ?? "",
    mysFailed: Object.keys(ctx.avatars ?? {}).length === 0,
    avatars: ctx.avatars ?? {},
    // 官方那张表的次序不按奖牌高低排，逐张核对过图案；None 那一档没有对应图标
    iconType: Math.max(0, MEDAL_ORDER.indexOf(brief.challenge_peak_rank_icon_type ?? "")),
    bossStars: Number(brief.boss_stars) || 0,
    mobStars: Number(brief.mob_stars) || 0,
    battleNum: Number(brief.total_battle_num) || 0,
    season: period?.group?.name_mi18n ?? "",
    gameVersion: period?.group?.game_version ?? "",
    endText: srChallengeTime(period?.group?.end_time),
    bossName: period?.boss_info?.name_mi18n ?? period?.boss_info?.name ?? "",
    bossIcon: period?.boss_info?.icon ?? "",
    boss: peakRecord(period?.boss_record, nameOf),
    mobs: infos.map((info, idx) => ({
      name: info.name_mi18n ?? info.name ?? "",
      icon: info.icon ?? "",
      record: peakRecord(period?.mob_records?.[idx], nameOf)
    }))
  }
}

interface StatBossGroup {
  /** 节点一的首领 */
  upper_boss?: { icon?: string; name_mi18n?: string }
  /** 节点二的首领 */
  lower_boss?: { icon?: string; name_mi18n?: string }
  /** 节点三的首领，三节点档位才有 */
  tierce_boss?: { icon?: string; name_mi18n?: string }
}

/** 最高一关的高难档，额外星只在这一档拿得到 */
const HARD_MODE = "星启模式"

/**
 * 关名拆出末尾的模式名
 *
 * 最高一关分「常规模式 / 星启模式」两档，接口把模式名直接拼在关名后面；不拆则标题挤成一长串、星启那档也无从换色。
 * @param name 接口给的关名
 * @returns 关名、模式名与是否高难档；没有模式后缀时模式名为空串
 */
function floorMode(name: string): { name: string; mode: string; hard: boolean } {
  const hit = /^(.+?)(\S{2}模式)$/.exec(name)
  if (!hit?.[1] || !hit[2]) return { name, mode: "", hard: false }
  return { name: hit[1], mode: hit[2], hard: hit[2] === HARD_MODE }
}

/**
 * 把一份挑战返回转成三张既有版式的图要的形态
 *
 * 口径全部取自 views/sr/challenge（星数先减额外星、虚构叙事速通关不计分不记轮次、节点按 `node_<数字>` 就地认键），本层只改键名与摊数组。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function srChallengeStatData(
  raw: SrChallengeRaw | undefined,
  ctx: SrStatContext
): Record<string, unknown> {
  const nameOf = ctx.nameOf ?? ((): string => "")
  const group = raw?.groups?.[ctx.prev === true ? 1 : 0]
  const boss = (group ?? {}) as StatBossGroup
  const bosses = [
    { label: "节点1", icon: boss.upper_boss?.icon ?? "" },
    { label: "节点2", icon: boss.lower_boss?.icon ?? "" },
    { label: "节点3", icon: boss.tierce_boss?.icon ?? "" }
  ].filter(one => one.icon !== "")

  const floors = (raw?.all_floor_detail ?? []).filter(one => keepFloor(ctx.kind, one)).map(one => {
    const isFast = one.is_fast === true
    const extraStar = Number(one.extra_star_num) || 0
    const star = Math.max(0, (Number(one.star_num) || 0) - extraStar)
    const nodes = floorNodes(one).map(node => statNode(node, nameOf))
    // 虚构叙事速通的那一关既不计分也不记轮次 —— 速通是没打的意思
    const noScore = ctx.kind === "story" && isFast
    const title = floorMode(one.name ?? srChallengeTitle(ctx.kind))
    return {
      ...title,
      star,
      extraStar,
      starList: Array.from({ length: star }, (_unused, idx) => idx),
      extraStarList: Array.from({ length: extraStar }, (_unused, idx) => idx),
      score: noScore ? 0 : nodes.reduce((sum, node) => sum + (Number(node["score"]) || 0), 0),
      roundNum: noScore ? 0 : Number(one.round_num) || 0,
      isFast,
      nodes
    }
  })

  return {
    kind: ctx.kind,
    title: srChallengeTitle(ctx.kind),
    uid: ctx.uid,
    save_id: ctx.uid,
    type: ctx.prev === true ? 2 : 1,
    nickname: ctx.nickname ?? "",
    // 面板库为空时模板退回接口给的头像与等级，天赋与装备两行整块不画
    mysFailed: Object.keys(ctx.avatars ?? {}).length === 0,
    avatars: ctx.avatars ?? {},
    story: {
      beginText: srChallengeTime(group?.begin_time),
      endText: srChallengeTime(group?.end_time),
      season: group?.name_mi18n ?? "",
      bosses,
      battleNum: Number(raw?.battle_num) || 0,
      totalStar: Number(raw?.star_num) || 0,
      extraStar: Number(raw?.extra_star_num) || 0,
      extraStarList: Array.from({ length: Number(raw?.extra_star_num) || 0 }, (_unused, idx) => idx),
      totalScore: raw?.score === undefined || raw.score === "" ? 0 : Number(raw.score) || 0,
      bestFloor: raw?.max_floor ?? "",
      floors
    }
  }
}
