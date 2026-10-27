/**
 * 模块职责：星铁形态的面板源 —— Mihomo、鳄梨、EnkaHSR
 * 依赖方向：依赖 panel/profile 与 serv/types；纯映射，不发请求
 * 生命周期：无状态，三个源是模块级常量
 * 注意事项：三个源结构相同而字段名不同，收成一份映射加一张字段表（差异逐项列在 {@link SR_SHAPES}）。
 *          **EnkaHSR 的助战角色键名首字母大写**（`AvatarID` 而非 `avatarId`），故取 id 时两种写法都试。
 *          **助战角色先并进去、再让展柜角色覆盖**：同一角色可能两处都有，展柜那份带完整遗器，次序不可颠倒。
 *          副词条压成 `"id,档数,步进"` 字符串（与 panel/arti-attr 解析对应，保留源形态以免存量面板数据迁移）。
 */
import {
  splitSkillTree,
  type PanelProfile,
  type ProfileArti,
  type ProfileAvatar,
  type ProfileWeapon
} from "../profile/index.js"
import { fail, ttlOf, type PanelSource, type ParseDeps, type ProfileResult } from "./types.js"

/** 一个星铁源的字段名差异 */
export interface SrShape {
  /** 源标识 */
  id: string
  /** 展示名 */
  name: string
  /** 拼地址 */
  url: (uid: string) => string
  /** 外层容器的键 */
  root: string
  /** 助战角色的键 */
  assist: string
  /** 助战角色是数组还是单个对象 */
  assistList: boolean
  /** 展柜角色数组的键 */
  list: string
  /** 头像字段名 */
  faceKey: string
  /** 技能树数组的键 */
  tree: string
  /** 技能树项里 id 的键 */
  treeId: string
  /** 遗器数组的键 */
  relics: string
  /** 遗器 id 的键 */
  relicId: string
  /** 遗器主词条 id 的键 */
  mainId: string
  /** 遗器副词条数组的键 */
  subs: string
  /** 副词条 id 的键 */
  subId: string
  /** 光锥 id 的键 */
  weaponId: string
}

/** 任意对象，映射时逐字段取值 */
type Bag = Record<string, unknown>

/**
 * 取一个字段并转成对象
 * @param obj 源对象
 * @param key 字段名
 * @returns 该字段；不是对象时 undefined
 */
function bag(obj: unknown, key: string): Bag | undefined {
  const got = (obj as Bag | null)?.[key]
  return got && typeof got === "object" ? (got as Bag) : undefined
}

/**
 * 取一个字段并转成数组
 * @param obj 源对象
 * @param key 字段名
 * @returns 该字段；不是数组时空数组
 */
function list(obj: unknown, key: string): Bag[] {
  const got = (obj as Bag | null)?.[key]
  return Array.isArray(got) ? (got as Bag[]) : []
}

/**
 * 取一个字段并转成数字
 * @param obj 源对象
 * @param key 字段名
 * @returns 数字；取不到时 0
 */
function num(obj: unknown, key: string): number {
  return Number((obj as Bag | null)?.[key]) || 0
}

/**
 * 映射一件遗器
 * @param one 遗器
 * @param shape 字段表
 * @returns 遗器；主词条缺失时仍返回，由词条求值那层判定
 */
function mapRelic(one: Bag, shape: SrShape): ProfileArti {
  const out: ProfileArti = { level: num(one, "level") }
  const id = one[shape.relicId]
  if (id !== undefined) out.id = id as string | number
  const mainId = one[shape.mainId]
  if (mainId !== undefined) out.mainId = mainId as string | number

  const ids: string[] = []
  for (const sub of list(one, shape.subs)) {
    const subId = sub[shape.subId]
    if (subId === undefined || subId === null || subId === "") continue
    // 压成 "id,档数,步进"，与 arti-attr 的解析对应
    ids.push([String(subId), num(sub, "cnt"), num(sub, "step")].join(","))
  }
  if (ids.length > 0) out.attrIds = ids
  return out
}

/**
 * 映射一个角色
 * @param one 角色
 * @param shape 字段表
 * @param deps 外部依赖
 * @returns 角色面板；角色 id 缺失时 undefined
 */
function mapAvatar(one: Bag, shape: SrShape, deps: ParseDeps): ProfileAvatar | undefined {
  // EnkaHSR 的助战角色用 AvatarID，其余用 avatarId
  const rawId = one.avatarId ?? one.AvatarID
  if (rawId === undefined) return undefined
  const id = String(rawId)

  const detail = deps.meta.detail("sr", id)
  const trees = list(one, shape.tree).map(it => ({
    id: String(it[shape.treeId] ?? ""),
    level: num(it, "level")
  }))
  const split = splitSkillTree(trees, detail ?? {})

  const avatar: ProfileAvatar = {
    id,
    level: num(one, "level"),
    promote: num(one, "promotion"),
    cons: num(one, "rank"),
    talent: split.talent,
    trees: split.trees,
    artis: {}
  }

  const equip = bag(one, "equipment")
  if (equip) {
    const weapon: ProfileWeapon = {
      level: num(equip, "level"),
      promote: num(equip, "promotion"),
      // 星铁的叠影在接口里叫 rank
      affix: num(equip, "rank")
    }
    const wid = equip[shape.weaponId]
    if (wid !== undefined) {
      weapon.id = wid as string | number
      const name = deps.meta.byId("sr", wid as string | number)?.name
      if (name) weapon.name = name
    }
    avatar.weapon = weapon
  }

  const artis: Record<string, ProfileArti> = {}
  for (const relic of list(one, shape.relics)) {
    // 部位号由接口的 type 给出
    const idx = num(relic, "type")
    if (!idx) continue
    artis[String(idx)] = mapRelic(relic, shape)
  }
  avatar.artis = artis

  const elem = deps.meta.byId("sr", id)?.elem
  if (elem) avatar.elem = elem
  return avatar
}

/**
 * 映射星铁形态的返回
 * @param data 返回
 * @param shape 字段表
 * @param deps 外部依赖
 * @returns 映射结果
 */
export function parseSr(data: unknown, shape: SrShape, deps: ParseDeps): ProfileResult {
  const root = bag(data, shape.root)
  if (!root) return fail("error", (data as { error?: string } | null)?.error)

  // 助战先并入，展柜随后覆盖 —— 展柜那份带完整遗器
  const raws: Bag[] = []
  if (shape.assistList) raws.push(...list(root, shape.assist))
  else {
    const one = bag(root, shape.assist)
    if (one && Object.keys(one).length > 0) raws.push(one)
  }
  raws.push(...list(root, shape.list))

  if (raws.length === 0) return fail("empty")

  const profile: PanelProfile = {
    game: "sr",
    uid: deps.uid,
    avatars: {},
    from: shape.id
  }
  const nickname = root.nickname
  if (typeof nickname === "string" && nickname) profile.name = nickname
  const face = root[shape.faceKey]
  // 星铁三源的头像字段给的就是 pfps 索引里那个 id（如 202063），故两处同值
  if (face !== undefined) {
    profile.face = face as string | number
    profile.pfp = face as string | number
  }
  const level = num(root, "level")
  if (level) profile.level = level
  const sign = root.signature
  if (typeof sign === "string" && sign) profile.sign = sign

  for (const raw of raws) {
    const avatar = mapAvatar(raw, shape, deps)
    if (avatar) profile.avatars[avatar.id] = avatar
  }

  if (Object.keys(profile.avatars).length === 0) return fail("empty")
  return { ok: true, profile, cd: ttlOf(data) }
}

/** 三个星铁源的字段差异，各按其接口实际给的形态 */
export const SR_SHAPES: readonly SrShape[] = [
  {
    id: "homo",
    name: "Mihomo",
    url: uid => `https://api.mihomo.me/sr_info/${uid}`,
    root: "detailInfo",
    assist: "assistAvatarList",
    assistList: true,
    list: "avatarDetailList",
    faceKey: "headIcon",
    tree: "skillTreeList",
    treeId: "pointId",
    relics: "relicList",
    relicId: "tid",
    mainId: "mainAffixId",
    subs: "subAffixList",
    subId: "affixId",
    weaponId: "tid"
  },
  {
    id: "avocado",
    name: "avocado.wiki",
    url: uid => `https://avocado.wiki/v1/raw/info/${uid}`,
    root: "playerDetailInfo",
    assist: "assistAvatar",
    assistList: false,
    list: "displayAvatars",
    faceKey: "headIconID",
    tree: "behaviorList",
    treeId: "id",
    relics: "relics",
    relicId: "id",
    mainId: "main_affix_id",
    subs: "sub_affix_id",
    subId: "id",
    weaponId: "id"
  },
  {
    id: "enkaHSR",
    name: "EnkaHSR",
    url: uid => `https://enka.network/api/hsr/uid/${uid}`,
    root: "detailInfo",
    assist: "assistAvatarDetail",
    assistList: false,
    list: "avatarDetailList",
    faceKey: "headIcon",
    tree: "skillTreeList",
    treeId: "pointId",
    relics: "relicList",
    relicId: "tid",
    mainId: "mainAffixId",
    subs: "subAffixList",
    subId: "affixId",
    weaponId: "tid"
  }
]

/** 三个星铁面板源 */
export const SR_SOURCES: readonly PanelSource[] = SR_SHAPES.map(shape => ({
  id: shape.id,
  name: shape.name,
  game: "sr" as const,
  url: shape.url,
  parse: (raw: unknown, deps: ParseDeps): ProfileResult => parseSr(raw, shape, deps)
}))
