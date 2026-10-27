/**
 * 模块职责：面板数据的统一形态 —— 各数据源的响应最终都归到这里
 * 依赖方向：纯类型与纯函数，不碰 IO、不依赖元数据是否安装
 * 生命周期：无状态
 * 注意事项：统一形态是本层存在的理由：六个原神源与四个星铁源字段互不相同，各源只映射到 {@link PanelProfile}，下游只认这一种。
 *          **天赋等级的键必须是 `a`/`e`/`q`**（普攻/战技/爆发）而非接口给的技能 id，靠元数据 `talentId` 译；译不出时落到按出现
 *          顺序取的兜底路径。**命座对天赋等级的折算不可省**：米游社给的已含命座加成、Enka 不含，不统一则同角色两源差 3 级（见 {@link foldCons}）。
 *          绝区零走同一副骨架但**不走属性计算**（接口直接给 `properties[].final`），不同形的那几块挂在 {@link ProfileAvatar.zzz} 上，
 *          共用字段仍要填满。zzz 那几块定义在同目录 `zzz.ts`、由本文件一并再导出。
 */
import type { ZzzAvatarDetail } from "./zzz.js"
import type { GameKey } from "../../core/region.js"

export * from "./zzz.js"

/** 有面板的三个游戏 */
export type PanelGame = GameKey

/**
 * 面板属性要由本插件算出来的那两个游戏
 *
 * 原神与星铁的源只给词条 id 与等级，属性/求值/评分都要本插件按元数据算；绝区零接口直接给算好的值，故装配层、伤害层、
 * 词条评分一概不收它 —— 给那些函数传 `"zzz"` 意味着要为它编一份不存在的等级曲线与档位表。另有一个判据无关的集合
 * {@link MysCalcGame}（米游社养成计算器开放了哪几个游戏），两者今天都是 `gs | sr`、互相赋值合法，但会各自变动，勿混用。
 */
export type SelfCalcGame = Exclude<PanelGame, "zzz">

/**
 * 判一个游戏的面板属性是否由本插件自算
 *
 * **`readonly SelfCalcGame[]` 的 `includes` 不收窄**，没有这个守卫时调用方只剩 `as SelfCalcGame` 一条路，
 * 而断言无法验证，绝区零漏进原神星铁专用查表（拿到 `undefined` 而非报错）正从那几处进。
 * @param game 游戏
 * @returns 由本插件自算时为真
 */
export function isSelfCalcGame(game: string | undefined): game is SelfCalcGame {
  return game === "gs" || game === "sr"
}

/** 一件圣遗物 / 遗器的原始形态，词条求值前 */
export interface ProfileArti {
  /** 名称，原神由 id 查得，星铁存 id */
  name?: string
  /** 套装名 */
  set?: string
  /** 遗器 id，星铁用 */
  id?: string | number
  /** 强化等级 */
  level?: number
  /** 星级 */
  star?: number
  /** 主词条 id */
  mainId?: string | number
  /** 副词条 id */
  attrIds?: (string | number)[]
}

/** 面板里那把武器 / 光锥 */
export interface ProfileWeapon {
  /** 名称 */
  name?: string
  /** id，星铁的源只给 id */
  id?: string | number
  /** 等级 */
  level?: number
  /** 突破阶数 */
  promote?: number
  /** 精炼 / 叠影，1~5 */
  affix?: number
}

// 旅行者识别归在 meta 层（装载器也要用），这里转出供本层与命令层沿用原导入路径
export { isGsTraveler } from "../../meta/traveler.js"

/** 一个角色的面板 */
export interface ProfileAvatar {
  /** 角色 id */
  id: string
  /** 等级 */
  level: number
  /** 突破阶数 */
  promote?: number
  /** 好感度，原神独有 */
  fetter?: number
  /** 命座 / 星魂 */
  cons: number
  /** 时装 id，原神独有 */
  costume?: number
  /** 元素 / 命途，旅行者与开拓者随天赋变 */
  elem?: string
  /** 武器 / 光锥 */
  weapon?: ProfileWeapon
  /** 天赋等级，键为 `a` / `e` / `q` 等 */
  talent?: Record<string, number>
  /** 已激活的行迹 id，星铁独有 */
  trees?: string[]
  /** 逐部位的圣遗物 / 遗器，键为部位号 */
  artis?: Record<string, ProfileArti>
  /** 绝区零专属的那几块，见 {@link ZzzAvatarDetail} */
  zzz?: ZzzAvatarDetail
  /** 数据来源标识，模板上写"数据来自 X" */
  from?: string
}

/** 一个玩家的面板 */
export interface PanelProfile {
  /** 游戏 */
  game: PanelGame
  /** uid */
  uid: string
  /** 昵称 */
  name?: string
  /** 头像 id */
  face?: string | number
  /**
   * 玩家头像在 Enka 的 pfps 索引里的 id
   *
   * **与 {@link face} 不是一回事**：原神那一项是角色 id（`#uid` 拿它查该角色的头像图），
   * 这一项是米游社里设的那个玩家头像（原神 `profilePicture.id`、星铁 `headIcon`、
   * 绝区零 `ProfileId`），要经 pfps 索引换成地址，见 store/face.ts。混用则页头恒是默认图。
   */
  pfp?: string | number
  /**
   * 玩家所用的时装 id，原神独有
   *
   * 玩家把某个角色设成头像、且那角色穿着时装时，展柜给的 {@link face} 是角色 id、这一项是时装 id，
   * 两个一起才定位得到那张头像（`<角色id>:<时装id>`）。
   */
  pfpCostume?: string | number
  /** 名片 id，原神独有 */
  card?: string | number
  /** 冒险等阶 / 开拓等级 */
  level?: number
  /** 世界等级，原神独有 */
  word?: number
  /** 签名 */
  sign?: string
  /** 逐角色的面板，键为角色 id */
  avatars: Record<string, ProfileAvatar>
  /** 数据来源标识 */
  from?: string
  /** 服务端给的下次可查询间隔，秒 */
  ttl?: number
}

/** 一个角色的元数据里本层用到的字段 */
export interface TalentMeta {
  /** 技能 id → 天赋键（`a` / `e` / `q` 等） */
  talentId?: Record<string, string>
  /** 技能 id → 元素，旅行者按天赋定元素 */
  talentElem?: Record<string, string>
  /** 天赋键 → 命座等级，或命座号 → 天赋键 */
  talentCons?: Record<string, string | number>
}

/** 天赋映射的结果 */
export interface TalentResult {
  /** 天赋等级，键为 `a` / `e` / `q` 等 */
  talent: Record<string, number>
  /** 由天赋定出的元素，旅行者用；定不出时空串 */
  elem: string
}

/** 兜底的三个天赋键，按出现顺序取 */
const FALLBACK_KEYS = ["a", "e", "q"] as const

/**
 * 把接口给的「技能 id → 等级」译成「天赋键 → 等级」
 *
 * **两类源的兜底下标推进方式不同**（`bumpOnHit` 区分）：面板服务只在走兜底支时推进，米游社每条都推进。
 * 差别体现在「元数据认得出一部分 id」的角色上 —— 认得出的那条若也推进下标，后面走兜底的键会错位（战技记成爆发）。
 * @param levels 技能 id → 等级
 * @param meta 角色元数据
 * @param bumpOnHit 为真时每条都推进兜底下标（米游社那一类的行为）
 * @returns 天赋等级与元素
 */
export function mapTalent(
  levels: Readonly<Record<string, number>>,
  meta: TalentMeta,
  bumpOnHit = false
): TalentResult {
  const talentId = meta.talentId ?? {}
  const talentElem = meta.talentElem ?? {}
  const out: Record<string, number> = {}
  let elem = ""
  let idx = 0

  for (const [id, lv] of Object.entries(levels)) {
    const named = talentId[id]
    if (named) {
      elem ||= talentElem[id] ?? ""
      out[named] = Number(lv) || 0
      if (bumpOnHit) idx++
      continue
    }
    const key = FALLBACK_KEYS[idx]
    idx++
    if (!key) continue
    // 同一个键只取第一次出现的值
    out[key] ??= Number(lv) || 0
  }

  return { talent: out, elem }
}

/**
 * 把含命座加成的天赋等级折算回不含的
 *
 * 米游社给的已含命座加成（3/5 命各 +3 级），Enka 不含，不折则同角色两源差 3 级。
 * **`talentCons` 里混两种键，只认「天赋键 → 生效命座」那种**：星铁形如 `{ "3": "e", a: 3, e: 3, ... }`，
 * 数字键那几条是「命座号 → 天赋键」，守卫（`out[key]`）使其恒被跳过。**不要为那两条另开一支** ——
 * 开了 `e`/`q` 各折算两次（6 命 10 级战技本该得 8、开后得 4）。折算量固定 3 级（原神规则；星铁逐键不同，见 `mapMysSrTalent`）。
 * @param talent 含命座加成的天赋等级
 * @param cons 命座数
 * @param meta 角色元数据
 * @returns 不含命座加成的天赋等级
 */
export function foldCons(
  talent: Readonly<Record<string, number>>,
  cons: number,
  meta: TalentMeta
): Record<string, number> {
  const out: Record<string, number> = { ...talent }
  if (cons < 3) return out

  for (const [key, at] of Object.entries(meta.talentCons ?? {})) {
    const level = Number(at)
    // 值不是数字的那些是"命座号 → 天赋键"，与本函数无关，跳过
    if (Number.isNaN(level) || level === 0) continue
    // 用真值判断而非 !== undefined：等级为 0 的同样跳过
    if (!out[key] || cons < level) continue
    out[key] = Math.max(1, (out[key] ?? 0) - 3)
  }
  return out
}

/** 命座满足门槛时各天赋加的级数 —— 与 {@link foldCons}/`mapMysSrTalent` 的减法互为镜像 */
const CONS_BONUS: Readonly<Record<SelfCalcGame, (cons: number) => Readonly<Record<string, number>>>> = {
  // 原神一律 +3
  gs: () => ({ a: 3, e: 3, q: 3 }),
  // 星铁逐键不同，欢愉技随星魂数变（同 mys.ts 的 srConsBonus）
  sr: cons => ({ a: 1, e: 2, q: 2, t: 2, me: 1, mt: 1, j: cons > 4 ? 2 : 1 })
}

/**
 * 把不含命座加成的天赋等级折算成含的
 *
 * 库里存的是不含命座加成的那一份，伤害计算与面板显示要的是含命座加成的等级（原神 +3、星铁逐键不同）。
 * 漏掉这一步会让满足命座门槛的角色伤害偏低约两成。是 {@link foldCons} 的正向镜像。
 *
 * **只认 `talentCons` 里「天赋键 → 生效命座」那种数字条目**：星铁形如 `{ "3": "e", a: 3, ... }`，数字键那几条是
 * 「命座号 → 天赋键」，由 `Number.isNaN` 与 `out[key]` 两道守卫跳过（理由同 {@link foldCons}，另开一支会加两次）。
 *
 * **刻意不加达达利亚（10000033）普攻的那 +1**：既定口径下那一级从不生效，加上反而对不上既定数值。
 * @param talent 不含命座加成的天赋等级
 * @param cons 命座 / 星魂数
 * @param meta 角色元数据
 * @param game 游戏
 * @returns 含命座加成的天赋等级
 */
export function unfoldCons(
  talent: Readonly<Record<string, number>>,
  cons: number,
  meta: TalentMeta,
  game: SelfCalcGame
): Record<string, number> {
  const out: Record<string, number> = { ...talent }
  if (cons < 3) return out
  const bonus = CONS_BONUS[game](cons)

  for (const [key, at] of Object.entries(meta.talentCons ?? {})) {
    const level = Number(at)
    // 值不是数字的那些是"命座号 → 天赋键"，与本函数无关，跳过
    if (Number.isNaN(level) || level === 0) continue
    // 用真值判断而非 !== undefined：等级为 0 的同样跳过
    if (!out[key] || cons < level) continue
    out[key] = (out[key] ?? 0) + (bonus[key] ?? 0)
  }
  return out
}

/**
 * 按元数据把星铁的技能树拆成「天赋」与「行迹」
 *
 * 同一份 `skillTreeList` 里既有天赋也有行迹加点，判据是能否在 `talentId` 里查到；查不到而等级 >1 的仍记作天赋（新角色未更新元数据时），等级为 1 的记作行迹。
 * **接口给的 id 比元数据多一位前导 `1`**（元数据 `1306001`，Enka/Mihomo 给 `11306001`），整串查不到时脱掉前导 `1` 再查；
 * 少了这一步天赋键就是原始八位 id，模板按 `talent.a`/`talent.e` 取值、**四个天赋等级全空白**，而行迹小点照常点亮（按后三位匹配）。
 * @param list 技能树，每项含 id 与等级
 * @param meta 角色元数据
 * @returns 天赋等级与已激活的行迹 id
 */
export function splitSkillTree(
  list: readonly { id: string | number; level?: number }[],
  meta: TalentMeta
): { talent: Record<string, number>; trees: string[] } {
  const talentId = meta.talentId ?? {}
  const talent: Record<string, number> = {}
  const trees: string[] = []

  for (const one of list) {
    const id = String(one.id)
    const lv = Number(one.level) || 0
    const key = talentId[id] ?? (id.startsWith("1") ? talentId[id.slice(1)] : undefined)
    if (key || lv > 1) talent[key ?? id] = lv
    else trees.push(id)
  }
  return { talent, trees }
}
