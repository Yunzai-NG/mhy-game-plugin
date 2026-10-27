/**
 * 模块职责：绝区零战绩里一张代理人卡的数据形态与构建 —— 由面板库里存下的代理人面板造出
 * 依赖方向：依赖 store/panel 的 StoredAvatar、panel/profile/zzz 的类型与 views/panel 的图标 / 套装算法；纯函数
 * 生命周期：无状态
 * 注意事项：战绩接口只给代理人 id / 等级 / 影画 / 星级，养成（音擎 / 驱动盘 / 技能）只有面板库有，故这张卡
 *          由面板库里的 `StoredAvatar.zzz` 造；面板库里没有的代理人由命令层退回占位卡，不在此处理。
 *          图一律走元数据（头像经 charImgs、音擎图经 MetaLoader.byName、套装图经 artiSetImg），不取接口地址。
 */
import type { MetaLoader } from "../../meta/loader.js"
import { ZZZ_RANK_STAR, zzzElemName } from "../../panel/profile/zzz.js"
import type { StoredAvatar } from "../../store/panel.js"
import type { CardTalent } from "../avatar-list.js"
import { artiSetImg, charImgs, zzzSets, zzzSkillMax, ZZZ_SKILL_NAMES } from "../panel.js"

/** 一张代理人卡上的音擎 */
export interface ZzzCardWeapon {
  /** 名称 */
  name: string
  /** 稀有度折成的星级 */
  star: number
  /** 叠影，1~5 */
  affix: number
  /** 图标，相对元数据根目录；取不到时空串 */
  img: string
}

/** 战绩图上一张代理人卡 */
export interface ZzzAvatarCardView {
  /** 代理人 id */
  id: string
  /** 全名 */
  name: string
  /** 简称，格子里印这个 */
  abbr: string
  /** 伤害类型中文名 */
  elem: string
  /** 星级，S 记作 5 / A 记作 4 */
  star: number
  /** 等级 */
  level: number
  /** 影画 */
  cons: number
  /** 头像，相对元数据根目录；占位卡可能是接口地址 */
  face: string
  /** 立绘，宽卡才用 */
  gacha: string
  /** 六个技能的等级，次序即 {@link ZZZ_SKILL_NAMES}；无面板数据时各级为 0 */
  skills: { key: string; name: string; level: number }[]
  /**
   * `common/avatar-card` 天赋行那六格，满级按 {@link zzzSkillMax} 判
   *
   * **一个技能都没有等级时为空**而非六个 0：模板据空数组改印提示，印六个 0 看着像真练到 0 级。
   */
  tals: CardTalent[]
  /** 音擎；没装时为 null */
  weapon: ZzzCardWeapon | null
  /** 驱动盘套装（凑够两件的），每套取第一个部位的图 */
  sets: { name: string; own: number; img: string }[]
}

/**
 * 面板库里没有这位时的占位卡：只有头像、等级与影画，技能空、音擎与驱动盘无，模板据此印「暂无面板数据」
 * @param base 接口给得出的那几项
 * @returns 占位卡
 */
export function zzzPlaceholderCard(base: {
  /** 代理人 id */
  id: string
  /** 名称 */
  name: string
  /** 星级，S 记作 5 / A 记作 4 */
  star: number
  /** 等级 */
  level: number
  /** 影画 */
  cons: number
  /** 头像：元数据里的相对路径，或接口方图的绝对地址 */
  face: string
}): ZzzAvatarCardView {
  return {
    ...base,
    abbr: base.name,
    elem: "",
    gacha: "",
    skills: [],
    tals: [],
    weapon: null,
    sets: []
  }
}

/**
 * 面板库里的一位代理人 → 战绩卡
 * @param one 存下来的代理人面板
 * @param opts 元数据装载器与路径存在性判定（取简称、音擎图、图标回落用）
 * @returns 代理人卡；该条没有绝区零面板时为 undefined
 */
export function buildZzzCard(
  one: StoredAvatar,
  opts: { meta?: MetaLoader; exists?: (rel: string) => boolean } = {}
): ZzzAvatarCardView | undefined {
  const detail = one.zzz
  if (!detail) return undefined

  const imgs = charImgs({
    game: "zzz",
    name: detail.name,
    ...(opts.exists ? { exists: opts.exists } : {})
  })
  const skills = ZZZ_SKILL_NAMES.map(it => ({ key: it.key, name: it.name, level: Number(one.talent?.[it.key]) || 0 }))
  const tals: CardTalent[] = skills.some(s => s.level > 0)
    ? skills.map(s => ({ key: s.key, name: "", level: s.level, crown: s.level >= zzzSkillMax(s.key) }))
    : []
  const weapon: ZzzCardWeapon | null = detail.weapon
    ? {
        name: detail.weapon.name,
        star: ZZZ_RANK_STAR[detail.weapon.rank] ?? 4,
        affix: detail.weapon.star,
        img: opts.meta?.byName("zzz", detail.weapon.name)?.icon ?? ""
      }
    : null
  const sets = zzzSets(detail.discs).map(s => ({ name: s.name, own: s.own, img: artiSetImg("zzz", s.name, 1) }))

  return {
    id: one.id,
    name: detail.name,
    abbr: opts.meta?.byName("zzz", detail.name)?.abbr ?? detail.name,
    elem: zzzElemName(detail.elemId),
    star: ZZZ_RANK_STAR[detail.rank] ?? 4,
    level: one.level,
    cons: one.cons,
    face: imgs["qFace"] ?? imgs["face"] ?? "",
    gacha: imgs["gacha"] ?? imgs["splash"] ?? "",
    skills,
    tals,
    weapon,
    sets
  }
}
