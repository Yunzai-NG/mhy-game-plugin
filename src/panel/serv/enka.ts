/**
 * 模块职责：Enka 形态的面板源 —— Enka 本体与三个同形态的镜像
 * 依赖方向：依赖 panel/profile 与 serv/types；纯映射，不发请求
 * 生命周期：无状态，四个源是模块级常量
 * 注意事项：四个源共用一份映射（差别仅 `id`/`name`/URL），收成 {@link makeEnkaSource} 加一张表，避免改映射漏改某处、表现为「换个源就少一栏属性」。
 *          等级藏在 `propMap` 里（`4001` 等级、`1002` 突破，接口自定魔数），命座数取 `talentIdList.length`。
 *          **判空要看 `propMap` 而非数组长度**：展柜关闭时 Enka 返回只有 `avatarId` 的壳，只看长度会产出一份等级为 0 的面板。
 */
import { mapTalent, type PanelProfile, type ProfileArti, type ProfileAvatar, type ProfileWeapon } from "../profile/index.js"
import { fail, ttlOf, type PanelSource, type ParseDeps, type ProfileResult } from "./types.js"

/** Enka 的部位键 → 部位号，另收中文名以防镜像改了字段 */
const ARTI_IDX: Readonly<Record<string, number>> = {
  EQUIP_BRACER: 1,
  EQUIP_NECKLACE: 2,
  EQUIP_SHOES: 3,
  EQUIP_RING: 4,
  EQUIP_DRESS: 5,
  生之花: 1,
  死之羽: 2,
  时之沙: 3,
  空之杯: 4,
  理之冠: 5
}

/** `propMap` 里等级与突破的键 */
const PROP_LEVEL = "4001"
/** 突破阶数在 `propMap` 里的键 */
const PROP_PROMOTE = "1002"

/** Enka 返回里一件装备 */
interface EnkaEquip {
  /** 物品 id */
  itemId?: number | string
  /** 扁平化的展示数据 */
  flat?: {
    /** 物品大类 */
    itemType?: string
    /** 部位 */
    equipType?: string
    /** 星级 */
    rankLevel?: number
  }
  /** 武器数据 */
  weapon?: {
    /** 等级 */
    level?: number
    /** 突破阶数 */
    promoteLevel?: number
    /** 精炼，值为 0 起 */
    affixMap?: Record<string, number>
  }
  /** 圣遗物数据 */
  reliquary?: {
    /** 强化等级，1 起 */
    level?: number
    /** 主词条 id */
    mainPropId?: number | string
    /** 副词条 id */
    appendPropIdList?: (number | string)[]
  }
}

/** Enka 返回里一个角色 */
interface EnkaAvatar {
  /** 角色 id */
  avatarId?: number | string
  /** 等级与突破 */
  propMap?: Record<string, { val?: number | string }>
  /** 好感度 */
  fetterInfo?: { expLevel?: number }
  /** 命座 id 列表，长度即命座数 */
  talentIdList?: (number | string)[]
  /** 时装 id */
  costumeId?: number | string
  /** 装备，武器与圣遗物混在一个数组里 */
  equipList?: EnkaEquip[]
  /** 技能 id → 等级 */
  skillLevelMap?: Record<string, number>
}

/** Enka 的返回 */
interface EnkaResponse {
  /** 玩家信息 */
  playerInfo?: {
    /** 昵称 */
    nickname?: string
    /**
     * 头像
     *
     * 两种形态二择一：`id` 是玩家头像在 pfps 索引里的 id（头像系统里那批特殊头像），
     * `avatarId` 是「拿某个角色当头像」、给的是角色 id、**不在 pfps 索引里**，得配 `costumeId`
     * 去查那张角色头像表（见 store/face.ts 的 icons 表）。**`avatarId` 与 `avatarID` 两种拼写都要认**：
     * 接口给的是小写 d 那个，只认大写会让这一路恒取不到头像。
     */
    profilePicture?: {
      avatarID?: number | string
      avatarId?: number | string
      costumeId?: number | string
      id?: number | string
    }
    /** 名片 id */
    nameCardID?: number | string
    /** 冒险等阶 */
    level?: number
    /** 世界等级 */
    worldLevel?: number
    /** 签名 */
    signature?: string
  }
  /** 角色详情 */
  avatarInfoList?: EnkaAvatar[]
  /** 服务侧给的冷却 */
  ttl?: number
  /** 出错时的原文 */
  error?: string
}

/**
 * 从装备列表里挑出武器
 * @param list 装备列表
 * @param names 名称查询，由 id 查武器名
 * @returns 武器；没有武器时 undefined
 */
function pickWeapon(
  list: readonly EnkaEquip[],
  names: (id: string | number) => string | undefined
): ProfileWeapon | undefined {
  const got = list.find(it => it.flat?.itemType === "ITEM_WEAPON")
  if (!got) return undefined
  const w = got.weapon ?? {}
  const out: ProfileWeapon = {
    // 精炼在接口里是 0 起，故加一
    affix: (Object.values(w.affixMap ?? {})[0] ?? 0) + 1
  }
  const name = got.itemId === undefined ? undefined : names(got.itemId)
  if (name) out.name = name
  if (got.itemId !== undefined) out.id = got.itemId
  if (w.level !== undefined) out.level = Number(w.level) || 0
  if (w.promoteLevel !== undefined) out.promote = Number(w.promoteLevel) || 0
  return out
}

/**
 * 从装备列表里挑出圣遗物
 *
 * **只记 id、不在这里查名字**：圣遗物名称与套装在 `ArtiSetTable`，本层只拿得到 `MetaLoader`（查恒 undefined），
 * 由装配器据 `itemId` 查。少了这一步面板五格圣遗物全空白（模板判据 `ds.name && ds.main`），而评分照常算得出，即「分数有、格子空」。
 * @param list 装备列表
 * @returns 部位号 → 圣遗物
 */
function pickArtis(list: readonly EnkaEquip[]): Record<string, ProfileArti> {
  const out: Record<string, ProfileArti> = {}
  for (const one of list) {
    const idx = ARTI_IDX[one.flat?.equipType ?? ""]
    if (!idx || !one.reliquary) continue
    const re = one.reliquary
    const arti: ProfileArti = {
      // 接口的强化等级 1 起，减一后封顶 20
      level: Math.min(20, (Number(re.level) || 0) - 1),
      star: Number(one.flat?.rankLevel) || 5
    }
    if (one.itemId !== undefined) arti.id = one.itemId
    if (re.mainPropId !== undefined) arti.mainId = re.mainPropId
    if (re.appendPropIdList) arti.attrIds = [...re.appendPropIdList]
    out[String(idx)] = arti
  }
  return out
}

/**
 * 造一个 Enka 形态的源
 * @param cfg 该源的标识、名字与地址模板
 * @returns 面板源
 */
export function makeEnkaSource(cfg: {
  /** 源标识 */
  id: string
  /** 展示名 */
  name: string
  /** 拼地址 */
  url: (uid: string) => string
}): PanelSource {
  return {
    id: cfg.id,
    name: cfg.name,
    game: "gs",
    url: cfg.url,
    parse: (raw, deps) => parseEnka(raw as EnkaResponse, deps, cfg.id)
  }
}

/**
 * 映射 Enka 形态的返回
 * @param data 返回
 * @param deps 外部依赖
 * @param source 源标识，写进结果的 `source` 供下游显示"这份面板是哪个源给的"
 * @returns 映射结果
 */
export function parseEnka(data: EnkaResponse, deps: ParseDeps, source = "enka"): ProfileResult {
  if (!data?.playerInfo) return fail("error", data?.error)
  const list = data.avatarInfoList ?? []
  // 展柜关闭时 Enka 会给一个只有 avatarId 的壳，故判据是 propMap 而非数组长度
  if (list.length === 0 || !list[0]?.propMap) return fail("empty")

  const info = data.playerInfo
  const profile: PanelProfile = {
    game: "gs",
    uid: deps.uid,
    avatars: {},
    from: source
  }
  if (info.nickname) profile.name = info.nickname
  const avatarFace = info.profilePicture?.avatarID ?? info.profilePicture?.avatarId
  if (avatarFace !== undefined) profile.face = avatarFace
  if (info.profilePicture?.id !== undefined) profile.pfp = info.profilePicture.id
  if (info.profilePicture?.costumeId !== undefined) profile.pfpCostume = info.profilePicture.costumeId
  if (info.nameCardID !== undefined) profile.card = info.nameCardID
  if (info.level !== undefined) profile.level = Number(info.level) || 0
  if (info.worldLevel !== undefined) profile.word = Number(info.worldLevel) || 0
  if (info.signature) profile.sign = info.signature

  /**
   * 由 id 查名称
   * @param id 物品 id
   * @returns 名称；查不到时 undefined
   */
  const names = (id: string | number): string | undefined => deps.meta.byId("gs", id)?.name

  for (const one of list) {
    if (one.avatarId === undefined) continue
    const id = String(one.avatarId)
    const detail = deps.meta.detail("gs", id)
    const talentRet = mapTalent(one.skillLevelMap ?? {}, detail ?? {})
    const equips = one.equipList ?? []

    const avatar: ProfileAvatar = {
      id,
      level: Number(one.propMap?.[PROP_LEVEL]?.val) || 0,
      promote: Number(one.propMap?.[PROP_PROMOTE]?.val) || 0,
      cons: one.talentIdList?.length ?? 0,
      talent: talentRet.talent,
      artis: pickArtis(equips)
    }
    if (one.fetterInfo?.expLevel !== undefined) avatar.fetter = Number(one.fetterInfo.expLevel) || 0
    if (one.costumeId !== undefined) avatar.costume = Number(one.costumeId) || 0
    const elem = talentRet.elem || deps.meta.byId("gs", id)?.elem
    if (elem) avatar.elem = elem
    const weapon = pickWeapon(equips, names)
    if (weapon) avatar.weapon = weapon

    profile.avatars[id] = avatar
  }

  return { ok: true, profile, cd: ttlOf(data) }
}

/** Enka 本体与三个同形态镜像的地址 */
export const ENKA_SOURCES: readonly PanelSource[] = [
  makeEnkaSource({ id: "enka", name: "Enka", url: uid => `https://enka.network/api/uid/${uid}` }),
  makeEnkaSource({ id: "mgg", name: "MiniGG-Api", url: uid => `http://profile.microgg.cn/gi/${uid}` }),
  makeEnkaSource({ id: "hanxuan", name: "X-Enka", url: uid => `https://enka.928100.xyz/api/uid/${uid}` }),
  makeEnkaSource({ id: "lyln", name: "Lyln-Enka", url: uid => `http://enka.lyln114514.top/api/uid/${uid}` })
]
