/**
 * 模块职责：武器列表（`#武器` / `*武器` / `%武器`）的模板数据
 * 依赖方向：纯函数，依赖 core/text、meta/loader 与面板库的存档形状；不碰 IO
 * 生命周期：无状态
 * 注意事项：排序**两轮**（先 `firstSort` 再 `sort`），效果是「练度高优先、同练度按稀有度与精炼」，合成一轮权重数得不到同样结果。
 *          武器图与佩戴者头像**一律取元数据**（见 `official-api-is-data-only`），接口给的地址不用，查不到就空着。
 *          星铁三处键名不同（列表在 `avatar_list`、光锥在 `equip`、叠影叫 `rank`），光锥星级接口未必给、缺时回落元数据。
 *          绝区零的战绩接口不给音擎，只能读面板库（{@link zzzWeaponTemplateData}）。武器类型图例只有原神有。
 */
import type { StoredAvatar } from "../store/panel.js"
import { INDENT } from "../core/text.js"
import type { MetaLoader } from "../meta/loader.js"

/** 传给既有模板的一份数据 */
export type TemplateData = Record<string, unknown>

/**
 * 活动试用武器，其精炼等级不计入排序
 *
 * 试用武器名单：试用武器一律满精炼，
 * 计入排序会把它顶到最前面。
 */
const ACT_WEAPONS = new Set(["黑岩斩刀", "黑岩长剑", "黑岩战弓", "黑岩绯玉", "黑岩刺枪"])

/** 五类武器，模板的图例按这个顺序排；键名即接口的 `type_name` */
const WEAPON_TYPES = ["单手剑", "双手剑", "长柄武器", "弓", "法器"] as const

/** `character` 接口里本模块用到的字段 */
export interface CharacterListRaw {
  /** 角色列表，原神旧接口在这个键下 */
  avatars?: CharacterListItem[]
  /** 角色列表，原神 `character/list` 在这个键下 */
  list?: CharacterListItem[]
  /** 角色列表，**星铁在这个键下** */
  avatar_list?: CharacterListItem[]
}

/** `character` 接口里的一个角色 */
export interface CharacterListItem {
  /** 角色 id */
  id?: number
  /** 角色名 */
  name?: string
  /** 等级 */
  level?: number
  /** 稀有度 */
  rarity?: number
  /** 头像，米游社给的绝对地址 */
  icon?: string
  /** 立绘 */
  image?: string
  /** 已装备武器，原神 */
  weapon?: CharacterListWeapon
  /** 已装备光锥，**星铁在这个键下** */
  equip?: CharacterListWeapon
}

/** `character` 接口里的一件武器 / 光锥 */
export interface CharacterListWeapon {
  /** 武器 id */
  id?: number
  /** 武器名 */
  name?: string
  /** 图标，米游社给的绝对地址 */
  icon?: string
  /** 稀有度 */
  rarity?: number
  /** 等级 */
  level?: number
  /** 精炼等级，原神 */
  affix_level?: number
  /** 叠影，星铁 */
  rank?: number
  /** 武器类型中文名，原神 */
  type_name?: string
}

/** 造武器列表时的上下文 */
export interface WeaponContext {
  /** uid */
  uid: string
  /** 查询者昵称 */
  name: string
  /** 游戏，缺省按原神 */
  game?: string
  /** 元数据装载器，星铁光锥的星级与图标缺失时按名字回落 */
  meta?: MetaLoader
}

/** 武器列表里的一件 */
export interface WeaponItem {
  /** 角色名 */
  role_name: string
  /** 角色头像，元数据相对路径；元数据里没有时为空串 */
  role_icon: string
  /** 角色等级 */
  role_level: number
  /** 角色稀有度 */
  role_rarity: number
  /** 武器名 */
  name: string
  /** 武器图标，元数据相对路径；元数据里没有时为空串 */
  icon: string
  /** 模板显示的名称 */
  showName: string
  /** 武器稀有度 */
  rarity: number
  /** 武器等级 */
  level: number
  /** 精炼等级 */
  affix_level: number
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
 * `character` 接口 → `avatar/weapon` 的模板数据
 *
 * 武器一览的口径：稀有度 1 的"无锋剑"一类不计，
 * 计数分五星 / 四星 / 三星与五类武器，排序为两轮。
 * @param raw 接口返回的 data
 * @param ctx 上下文
 * @returns 模板数据
 */
export function weaponTemplateData(raw: CharacterListRaw, ctx: WeaponContext): TemplateData {
  const isSr = ctx.game === "sr"
  const count: Record<string, number> = { five: 0, four: 0, three: 0 }
  for (const type of WEAPON_TYPES) count[type] = 0

  const list: (WeaponItem & { firstSort: number; sort: number })[] = []
  for (const it of (isSr ? raw.avatar_list : (raw.avatars ?? raw.list)) ?? []) {
    const w = isSr ? it.equip : it.weapon
    if (!w) continue
    const game = isSr ? "sr" : "gs"
    const metaItem = ctx.meta?.find(game, w.id ?? "", w.name ?? "")
    const metaRole = ctx.meta?.find(game, it.id ?? "", it.name ?? "")
    // 星铁接口未必给光锥星级，缺时按元数据、两处都没有时当四星（否则整排印成三星底框）
    const rarity = num(w.rarity) || num(metaItem?.star) || (isSr ? 4 : 0)
    if (rarity <= 1) continue
    const affix = num(isSr ? w.rank : w.affix_level)

    if (rarity === 5) count["five"] = (count["five"] ?? 0) + 1
    if (rarity === 4) count["four"] = (count["four"] ?? 0) + 1
    if (rarity === 3) count["three"] = (count["three"] ?? 0) + 1
    const type = w.type_name ?? ""
    if (type in count) count[type] = (count[type] ?? 0) + 1

    // 第一轮：武器练度为主，武器满 20 级后角色等级才参与
    let firstSort = num(w.level) + (rarity - 4) * 20
    if (num(w.level) >= 20) firstSort += num(it.level)
    if (!ACT_WEAPONS.has(w.name ?? "")) firstSort += affix * 5

    const sort =
      rarity * 1_000_000 + affix * 100_000 + num(w.level) * 1000 + num(it.rarity) * 100 + num(it.level)

    list.push({
      role_name: it.name ?? "",
      role_icon: metaRole?.face ?? "",
      role_level: num(it.level),
      role_rarity: Math.min(5, num(it.rarity)),
      name: w.name ?? "",
      icon: metaItem?.icon ?? "",
      showName: w.name ?? "",
      rarity,
      level: num(w.level),
      affix_level: affix,
      firstSort,
      sort
    })
  }

  // 两轮排序：先 firstSort 再 sort，二者均为降序
  list.sort((a, b) => b.firstSort - a.firstSort)
  list.sort((a, b) => b.sort - a.sort)

  return {
    uid: ctx.uid,
    saveId: ctx.uid,
    name: ctx.name,
    list,
    count,
    noun: isSr ? "光锥" : "武器",
    // 武器类型那一排图例只有原神有，星铁不产出这个键，模板据此整块隐藏
    ...(isSr ? {} : { types: WEAPON_TYPES })
  }
}

/** 绝区零音擎稀有度字母 → 星级 */
const ZZZ_RANK: Readonly<Record<string, number>> = { S: 5, A: 4, B: 3 }

/**
 * 绝区零面板库 → `avatar/weapon` 的模板数据
 *
 * 排序沿用两轮的口径，叠影即精炼。
 * @param avatars 面板库里这个 uid 的代理人
 * @param ctx 上下文
 * @returns 模板数据
 */
export function zzzWeaponTemplateData(avatars: readonly StoredAvatar[], ctx: WeaponContext): TemplateData {
  const count: Record<string, number> = { five: 0, four: 0, three: 0 }
  const list: (WeaponItem & { firstSort: number; sort: number })[] = []
  for (const one of avatars) {
    const z = one.zzz
    const w = z?.weapon
    if (!z || !w) continue
    const rarity = ZZZ_RANK[w.rank] ?? 4
    if (rarity === 5) count["five"] = (count["five"] ?? 0) + 1
    if (rarity === 4) count["four"] = (count["four"] ?? 0) + 1
    if (rarity === 3) count["three"] = (count["three"] ?? 0) + 1
    const role = ctx.meta?.byId("zzz", one.id)
    const roleRarity = ZZZ_RANK[z.rank] ?? 4
    list.push({
      role_name: z.name,
      role_icon: role?.face ?? "",
      role_level: one.level,
      role_rarity: roleRarity,
      name: w.name,
      icon: ctx.meta?.find("zzz", w.id, w.name)?.icon ?? "",
      showName: w.name,
      rarity,
      level: w.level,
      affix_level: w.star,
      firstSort: w.level + (rarity - 4) * 20 + (w.level >= 20 ? one.level : 0) + w.star * 5,
      sort: rarity * 1_000_000 + w.star * 100_000 + w.level * 1000 + roleRarity * 100 + one.level
    })
  }
  list.sort((a, b) => b.firstSort - a.firstSort)
  list.sort((a, b) => b.sort - a.sort)
  return { uid: ctx.uid, saveId: ctx.uid, name: ctx.name, list, count, noun: "音擎" }
}

/**
 * 武器列表 → 纯文字
 * @param data 模板数据
 * @returns 多行文本
 */
export function weaponText(data: TemplateData): string {
  const list = (data["list"] ?? []) as WeaponItem[]
  const count = (data["count"] ?? {}) as Record<string, number>
  const noun = String(data["noun"] ?? "武器")
  if (!list.length) return "米游社没有公开角色数据，请在 App 的「我的角色」里打开「查询显示」"
  const lines = [
    `已装备${noun} ${list.length} 件（五星 ${count["five"] ?? 0} 四星 ${count["four"] ?? 0} 三星 ${count["three"] ?? 0}）`
  ]
  for (const it of list.slice(0, 10)) {
    lines.push(`${INDENT}${it.showName} Lv.${it.level} ${noun === "武器" ? "精" : "叠"}${it.affix_level} —— ${it.role_name}`)
  }
  if (list.length > 10) lines.push(`${INDENT}……另有 ${list.length - 10} 件`)
  return lines.join("\n")
}
