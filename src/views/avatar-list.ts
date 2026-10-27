/**
 * 模块职责：`#角色列表` 的数据适配 —— 把 index 接口、面板库与元数据拼成 `character/avatar-list` 要的形态
 * 依赖方向：依赖 views/panel（图标拼法与时刻格式）、views/profile（index 的原始字段）、
 *          meta/elem 与 meta/loader 的类型；纯函数，不碰 IO
 * 生命周期：无状态
 * 注意事项：三块内容各有来源、**缺哪块都不影响另两块**：横幅统计/探索度/宝箱来自 index 接口，角色格子里的武器/天赋/圣遗物来自本地面板库，头像/横幅底图来自元数据。本模块不发请求不读盘、三份输入由调用方给。
 *          **模板每个取值点都要给到**（`avatar-card.html` 直接读 `weapon.star`/`artisSet.imgs`/`talent[k].original`，取不到印字面 `undefined`），故武器给全壳、天赋没有时给空对象。**探索度只原神有**（星铁 index 不给分区探索度、不产出 `areas` 键、宝箱同理）；地区卡片与 `#信息` 同一份（见 views/gs/player.ts 的 exploreCards）。
 */
import { elemOf } from "../meta/elem.js"
import type { SelfCalcGame } from "../panel/profile/index.js"
import type { MetaLoader } from "../meta/loader.js"
import type { BuiltPanel } from "../panel/build.js"
import { artiSetImg, charImgs, timeText } from "./panel.js"
import type { GsIndexRaw, IndexRaw, SrIndexRaw } from "./profile.js"
import type { PlayerIndexRaw } from "./gs/index.js"
import { CHEST_LIMITS, exploreCards } from "./gs/index.js"

/** 传给既有模板的一份数据 */
export type AvatarListTemplateData = Record<string, unknown>

/** 旅行者与开拓者的 id，接口对两种性别均称同一个名字，展示时须予区分 */
const TRAVELER: Readonly<Record<string, string>> = {
  "10000005": "空",
  "10000007": "荧",
  "8001": "穹",
  "8002": "星",
  "8003": "穹",
  "8004": "星",
  "8005": "穹",
  "8006": "星"
}

/** 原神 index 的统计段，宝箱字段名按它约束 */
type GsStats = NonNullable<GsIndexRaw["stats"]>

/** 五类宝箱：次序即 `chest.webp` 雪碧图的格子次序，不可调换；`max` 随版本增长，过期只影响「x/y」的 y */
const CHESTS: readonly { key: string; title: string; field: keyof GsStats; max: number }[] = [
  { key: "commonChest", title: "普通宝箱", field: "common_chest_number", max: CHEST_LIMITS.common },
  { key: "exquisiteChest", title: "精致宝箱", field: "exquisite_chest_number", max: CHEST_LIMITS.exquisite },
  { key: "preciousChest", title: "珍贵宝箱", field: "precious_chest_number", max: CHEST_LIMITS.precious },
  { key: "luxuriousChest", title: "华丽宝箱", field: "luxurious_chest_number", max: CHEST_LIMITS.luxurious },
  { key: "magicChest", title: "奇馈宝箱", field: "magic_chest_number", max: CHEST_LIMITS.magic }
]

/** 一天按 365.0 折年、30.41 折月 */
const DAYS_PER_YEAR = 365
/** 一月按几天折算 */
const DAYS_PER_MONTH = 30.41

/** 卡片上取哪几项天赋；星铁记忆 / 欢愉那几项没有时取不到、自然不出现，有时画成头像角标 */
const TALENT_KEYS: Readonly<Record<SelfCalcGame, readonly string[]>> = {
  gs: ["a", "e", "q"],
  sr: ["a", "e", "q", "t", "me", "mt", "j"]
}

/** 额外技能的满级（含星魂加成）：忆灵两项到不了 10，按天赋行那条 `>= 10` 判就永不戴冠 */
const EXTRA_TALENT_MAX: Readonly<Record<string, number>> = { me: 7, mt: 7, j: 12 }

/** 天赋行里那几格的键；其余是星铁记忆 / 欢愉多出来的技能，画成头像右下的角标 */
const MAIN_TALENT_KEYS: ReadonlySet<string> = new Set(["a", "e", "q", "t"])

/** 角标上的短名：头像只有 70px 宽，「忆灵天赋」四个字放不下 */
const EXTRA_TALENT_NAMES: Readonly<Record<string, string>> = { me: "忆技", mt: "忆赋", j: "欢愉" }

/** 卡片上的一格天赋 */
export interface CardTalent {
  /** 天赋键 */
  key: string
  /** 角标上印的短名；天赋行那几格不印名，为空串 */
  name: string
  /** 当前等级，含命座 / 星魂加成 */
  level: number
  /** 是否满级，模板据此画金底 */
  crown: boolean
  /** 等级里有命座 / 星魂加成，模板据此换色 */
  plus?: boolean
}

/**
 * 把一组天赋拆成「天赋行」与「角标」两份
 *
 * **记忆与欢愉角色的额外技能不进天赋行**：卡宽 70px，五六格塞一行时每格被压到 8px、「10」塞不下。
 * 不认得的键（如秘技 `z`，它没有等级）两份都不进，以免多出一格空角标。
 * @param list 依次排好的天赋
 * @returns 天赋行与角标
 */
export function splitCardTalents(list: readonly CardTalent[]): { tals: CardTalent[]; xtals: CardTalent[] } {
  const tals: CardTalent[] = []
  const xtals: CardTalent[] = []
  for (const one of list) {
    if (MAIN_TALENT_KEYS.has(one.key)) tals.push({ ...one, name: "" })
    else if (EXTRA_TALENT_NAMES[one.key]) xtals.push({ ...one, name: EXTRA_TALENT_NAMES[one.key] ?? one.key })
  }
  return { tals, xtals }
}

/** 一件武器 / 光锥在卡片上要的三项 */
export interface AvatarCardWeapon {
  /** 星级，0 表示没有武器数据；模板据它决定那一格画不画 */
  star: number
  /** 图标，相对元数据根目录 */
  img: string
  /** 精炼 / 叠影 */
  affix: number
}

/** 卡片上的一个角色 */
export interface AvatarCardView {
  /** 角色 id */
  id: string
  /** 全名，模板用它拼 CSS 类 */
  name: string
  /** 简称，格子里印的是这个 */
  abbr: string
  /** 元素 / 命途键 */
  elem: string
  /** 星级 */
  star: number
  /** 等级 */
  level: number
  /** 命座 / 星魂 / 影画 */
  cons: number
  /** 游戏 */
  game: SelfCalcGame
  /** 小头像，相对元数据根目录；元数据里没有这个角色时为米游社给的绝对地址 */
  face: string
  /** 立绘，宽卡片才用；此处仍给出以免模板取空 */
  gacha: string
  /** 立绘（星铁），同上 */
  preview: string
  /** 天赋等级，没有面板数据时为空对象，模板据此改印「暂无天赋数据」 */
  talent: Record<string, { level: number; original: number }>
  /** `common/avatar-card` 天赋行那几格，由 {@link splitCardTalents} 拆出；没有面板数据时为空 */
  tals: CardTalent[]
  /** `common/avatar-card` 头像右下的角标（星铁记忆 / 欢愉的额外技能）；原神恒为空 */
  xtals: CardTalent[]
  /** 武器 */
  weapon: AvatarCardWeapon
  /** 圣遗物 / 遗器套装 */
  artisSet: { names: string[]; imgs: string[] }
}

/** 造这份数据要的东西 */
export interface AvatarListOptions {
  /** 游戏，只有这两个有元数据 */
  game: SelfCalcGame
  /** uid */
  uid: string
  /** 查询者昵称，接口不给游戏昵称时用它 */
  name: string
  /** 面板库里已有的角色，按 id 与 index 的角色配对 */
  panels?: readonly BuiltPanel[]
  /** 元数据装载器，取简称与元素 */
  meta?: MetaLoader
  /** 判元数据里的路径是否存在，图标的回落要用 */
  exists?: (rel: string) => boolean
  /** 本次查询用的是不是发起者自己的 Cookie，否则模板顶部多一句提示 */
  isSelfCookie?: boolean
  /** 面板数据的更新时刻 */
  profileAt?: number
  /** 当前时间，测试注入 */
  now?: number
}

/**
 * 取数字，脏值一律当 0
 * @param value 原始值
 * @returns 数字
 */
function num(value: unknown): number {
  const out = typeof value === "string" ? Number(value) : value
  return typeof out === "number" && Number.isFinite(out) ? out : 0
}

/**
 * 活跃天数 → `1年2个月3天`
 * @param days 活跃天数
 * @returns 说明文本；不足一天时空串
 */
export function activeDayText(days: number): string {
  const total = Math.floor(num(days))
  if (total <= 0) return ""
  const year = Math.floor(total / DAYS_PER_YEAR)
  const rest = total % DAYS_PER_YEAR
  const month = Math.floor(rest / DAYS_PER_MONTH)
  const day = Math.floor(rest % DAYS_PER_MONTH)
  return `${year > 0 ? `${year}年` : ""}${month > 0 ? `${month}个月` : ""}${day > 0 ? `${day}天` : ""}`
}

/** index 接口里的一个角色，两个游戏的字段名不同，此处收成一份 */
interface IndexAvatar {
  /** 角色 id */
  id: string
  /** 接口给的角色名 */
  name: string
  /** 等级 */
  level: number
  /** 星级 */
  star: number
  /** 命座 / 星魂 */
  cons: number
  /** 接口给的元素名 */
  elem: string
  /** 米游社给的头像绝对地址 */
  icon: string
}

/**
 * index 的角色列表 → 一份形状统一的简表
 * @param raw 接口返回的 data
 * @param game 游戏
 * @returns 角色简表，次序即接口给的次序
 */
function indexAvatars(raw: IndexRaw, game: SelfCalcGame): IndexAvatar[] {
  const list =
    game === "sr" ? ((raw as SrIndexRaw).avatar_list ?? []) : ((raw as GsIndexRaw).avatars ?? [])
  return list.map(one => {
    const it = one as {
      id?: number | string
      name?: string
      level?: number
      rarity?: number
      rank?: number
      actived_constellation_num?: number
      icon?: string
      element?: string
    }
    return {
      id: String(it.id ?? ""),
      name: it.name ?? "",
      level: num(it.level),
      star: Math.min(5, num(it.rarity)),
      cons: num(game === "sr" ? it.rank : it.actived_constellation_num),
      elem: it.element ?? "",
      icon: it.icon ?? ""
    }
  })
}

/**
 * 面板里的天赋等级 → 卡片要的形态
 *
 * 只取 {@link TALENT_KEYS} 里那几个键，且**按声明次序输出**：库里的键序随数据源而异，直接透传会让同一角色在两个源下图标次序不同。
 * `level` 含命座 / 星魂加成（装配层的 `talentLevel`），`original` 不含 —— 满级皇冠按后者判，否则 6 命角色凭空多冠。
 * @param panel 装好的面板
 * @param game 游戏
 * @returns 天赋键 → 等级；一个都取不到时空对象
 */
function talentOf(panel: BuiltPanel | undefined, game: SelfCalcGame): Record<string, { level: number; original: number }> {
  const out: Record<string, { level: number; original: number }> = {}
  if (!panel) return out
  for (const key of TALENT_KEYS[game]) {
    const original = num(panel.talent[key])
    if (original <= 0) continue
    out[key] = { level: num(panel.talentLevel?.[key]) || original, original }
  }
  return out
}

/**
 * 面板里的圣遗物 → 卡片上那一两张套装图
 *
 * 同一套装凑够两件才算一套。图取该套装的第一个部位；**星铁的位面饰品没有第 1 部位、故回落到第 5**
 * —— 少这一步不报错，只是位面饰品那一格空白。
 * @param panel 装好的面板
 * @param game 游戏
 * @param exists 判元数据里的路径是否存在
 * @returns 套装名与套装图
 */
function artisSetOf(
  panel: BuiltPanel | undefined,
  game: SelfCalcGame,
  exists?: (rel: string) => boolean
): { names: string[]; imgs: string[] } {
  const names: string[] = []
  const imgs: string[] = []
  for (const [set, count] of Object.entries(panel?.sets ?? {})) {
    if (num(count) < 2) continue
    names.push(set)
    const first = artiSetImg(game, set, 1)
    imgs.push(exists && !exists(first) ? artiSetImg(game, set, 5) : first)
  }
  return { names, imgs }
}

/** 两个游戏的 index 都可能带的账号信息；星铁那份不给它，昵称与等级要另查 `bindings` */
interface IndexRole {
  /** 游戏内昵称 */
  nickname?: string
  /** 冒险等阶 / 开拓等级 */
  level?: number
  /** 头像，米游社给的绝对地址 */
  game_head_icon?: string
}

/**
 * 横幅上的玩家信息
 *
 * 头像优先取米游社那张（账号自己挑的）、取不到回落排头角色的小头像（模板按 `meta-` 前缀挑根，故共用一个键）。
 * **星铁的 index 不给昵称与开拓等级**（在 `bindings` 里），故昵称回落查询者昵称、等级给 0。
 * @param raw index 接口返回的 data
 * @param game 游戏
 * @param name 查询者昵称
 * @param fallback 排头角色的小头像
 * @param banner 横幅底图
 * @returns 模板要的 face
 */
function faceOf(
  raw: IndexRaw,
  game: SelfCalcGame,
  name: string,
  fallback: string,
  banner: string
): Record<string, unknown> {
  const role: IndexRole = (raw as { role?: IndexRole }).role ?? {}
  const icon = game === "sr" ? ((raw as SrIndexRaw).cur_head_icon_url ?? "") : (role.game_head_icon ?? "")
  const head = icon || fallback
  return {
    banner,
    face: head,
    qFace: head,
    name: role.nickname ?? name,
    sign: "",
    level: num(role.level)
  }
}

/**
 * 横幅上的统计、探索度与宝箱
 *
 * 三块判据都是「取不到就不给那个键」，模板据此整块隐藏（星铁本就没有分区探索度与宝箱明细）。角色数与五星数由本层数出来、不取接口的 `avatar_num`（那个只算「实时角色」里公开的那些）。
 * @param raw index 接口返回的 data
 * @param game 游戏
 * @param avatars 已装好的角色格子
 * @returns 模板要的 info
 */
function infoOf(raw: IndexRaw, game: SelfCalcGame, avatars: readonly AvatarCardView[]): Record<string, unknown> {
  const stats: Record<string, number | string> = {
    avatar: avatars.length,
    avatar5: avatars.filter(one => one.star === 5).length
  }
  const statMap: Record<string, string> = { achievement: "成就", avatar: "角色", avatar5: "五星角色" }

  if (game === "sr") {
    const s = (raw as SrIndexRaw).stats ?? {}
    stats["achievement"] = num(s.achievement_num)
    stats["chest"] = num(s.chest_num)
    statMap["chest"] = "宝箱"
    return { activeDay: activeDayText(num(s.active_days)), stats, statMap }
  }

  const s = (raw as GsIndexRaw).stats ?? {}
  stats["achievement"] = num(s.achievement_number)
  stats["wayPoint"] = num(s.way_point_number)
  statMap["wayPoint"] = "锚点"
  for (const one of CHESTS) stats[one.key] = num(s[one.field])

  const info: Record<string, unknown> = {
    activeDay: activeDayText(num(s.active_day_number)),
    stats,
    statMap,
    chestMap: CHESTS.map(one => ({ key: one.key, title: one.title, max: one.max }))
  }

  const areas = exploreCards(raw as PlayerIndexRaw)
  if (areas.length > 0) info["areas"] = areas
  return info
}

/**
 * index 原始数据 + 面板库 + 元数据 → 逐角色的卡片
 *
 * 深渊 / 幽境危战的上场角色卡与 `#角色列表` 同一份造法，故抽出来共用；次序即接口给的次序，
 * 排序由调用方按需另做（按 id 取用的场合不关心次序）。
 * @param raw index 接口返回的 data
 * @param opts 选项，只用到 game / panels / meta / exists
 * @returns 角色卡数组
 */
export function buildAvatarCards(
  raw: IndexRaw,
  opts: Pick<AvatarListOptions, "game" | "panels" | "meta" | "exists">
): AvatarCardView[] {
  const { game } = opts
  const byId = new Map((opts.panels ?? []).map(one => [one.id, one]))

  return indexAvatars(raw, game).map(one => {
    const panel = byId.get(one.id)
    const item = opts.meta?.find(game, one.id, one.name)
    const name = panel?.name ?? item?.name ?? TRAVELER[one.id] ?? one.name ?? "未知"
    const imgs = charImgs({
      game,
      name,
      ...(panel?.costume ? { costume: panel.costume } : {}),
      ...(opts.exists ? { exists: opts.exists } : {})
    })
    // 元数据与面板库都不认识这个角色（刚上线、或压根没装元数据）时，图只能取米游社给的
    // 绝对地址 —— 那时按约定拼出来的元数据路径一定是个 404，而 404 的图浏览器只是不画
    const known = panel !== undefined || item !== undefined
    const face = imgs["qFace"] ?? imgs["face"] ?? ""
    const weapon = panel?.weapon
    const talent = talentOf(panel, game)
    // 天赋行的满级判据：基础三项到 10 级；额外技能按各自上限
    const split = splitCardTalents(
      Object.entries(talent).map(([key, it]) => ({
        key,
        name: "",
        level: it.level,
        crown: it.original >= (EXTRA_TALENT_MAX[key] ?? 10),
        plus: it.level > it.original
      }))
    )
    return {
      id: one.id,
      name,
      abbr: panel?.abbr ?? item?.abbr ?? TRAVELER[one.id] ?? name,
      elem: elemOf(one.elem || panel?.elem || item?.elem, "", game),
      star: Math.max(one.star, num(panel?.star)),
      level: Math.max(one.level, num(panel?.level)),
      cons: Math.max(one.cons, num(panel?.cons)),
      game,
      // 模板按 `meta-` 前缀决定加不加元数据根，故两种地址可以走同一个键
      face: known ? face : one.icon || face,
      gacha: imgs["gacha"] ?? "",
      preview: imgs["preview"] ?? imgs["splash"] ?? "",
      talent,
      tals: split.tals,
      xtals: split.xtals,
      weapon: { star: num(weapon?.star), img: weapon?.img ?? "", affix: num(weapon?.affix) },
      artisSet: artisSetOf(panel, game, opts.exists)
    }
  })
}

/**
 * index 原始数据 + 面板库 + 元数据 → `character/avatar-list` 的模板数据
 * @param raw index 接口返回的 data
 * @param opts 选项
 * @returns 模板数据
 */
export function avatarListData(raw: IndexRaw, opts: AvatarListOptions): AvatarListTemplateData {
  const { game, uid } = opts
  const now = opts.now ?? Date.now()

  const avatars = buildAvatarCards(raw, opts)

  // 稀有度 → 等级 → 命座降序，与 `#信息` 那张卡片同一口径
  avatars.sort(
    (a, b) => b.star - a.star || b.level - a.level || b.cons - a.cons || a.name.localeCompare(b.name)
  )

  const first = avatars[0]
  const banner = first
    ? (charImgs({ game, name: first.name, ...(opts.exists ? { exists: opts.exists } : {}) })["banner"] ?? "")
    : ""

  const updateTime: Record<string, string> = { mys: timeText(now) }
  if (opts.profileAt !== undefined) updateTime["profile"] = timeText(opts.profileAt)

  return {
    game,
    uid,
    saveId: uid,
    save_id: uid,
    name: opts.name,
    // 布局按这个键选整页配色，与面板列表一致
    elem: game === "gs" ? "hydro" : "sr",
    face: faceOf(raw, game, opts.name, first?.face ?? "", banner),
    info: infoOf(raw, game, avatars),
    isSelfCookie: opts.isSelfCookie !== false,
    avatars,
    updateTime
  }
}
