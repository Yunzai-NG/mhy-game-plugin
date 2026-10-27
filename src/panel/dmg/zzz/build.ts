/**
 * 模块职责：把一份存下来的绝区零面板装成一次伤害计算 —— 取属性、取倍率、从元数据取 buff
 * 依赖方向：依赖同目录 attr / buff / calc / skill，以及 dmg/buffs 的装载器与 meta/loader；不发请求
 * 生命周期：无状态
 * 注意事项：**buff 全部来自元数据里的 `calc.js`**（代理人/音擎/套装各一份，由 {@link DmgBuffLoader} 在沙箱求值），插件内不写任何加成，故新代理人上线只要包更新过就能算。
 *          因此这一路与另两个游戏**同受 `enableDmgCalc` 约束**（开关挡的是求值下载来的代码），给它开后门等于让使用者以为关掉了这件事。
 *          **倍率与 buff 来源不同、勿混**：倍率取自 `data.json` 的 `talent.<族>.tables`（纯数值、不必求值），buff 取自 `calc.js`（须求值）；「没装元数据」「包里没这位倍率」「开关关着」是三种缺失、各有处置（见 {@link ZzzDmgMiss}）。
 *          **套装件数按实际装了几件、而非接口的 `own`**（那是名下总数、含没装的，照它判会让两件套凭空生效）。
 */
import type { MetaLoader } from "../../../meta/loader.js"
import type { DmgBuffLoader } from "../buffs.js"
import type { ProfileAvatar } from "../../profile/index.js"
import { zzzElemName } from "../../profile/index.js"
import type { ZzzAttrTables } from "./attr.js"
import { zzzAttrTables } from "./attr.js"
import type { ZzzBuff, ZzzBuffCtx } from "./buff.js"
import type { ZzzCalcCtx, ZzzDmgResult, ZzzEnemy } from "./calc.js"
import { ZZZ_ENEMY, zzzCalcSkills } from "./calc.js"
import type { ZzzDetailSpec } from "./detail.js"
import { zzzRunDetails } from "./detail.js"
import { zzzSkillsOf } from "./skill.js"

/** 算不出来时的成因，各有各的处置 */
export type ZzzDmgMiss =
  /** 「开启伤害计算」关着 */
  | "off"
  /** 元数据没装 */
  | "noMeta"
  /** 装了，但包里没有这一位的倍率表 */
  | "noRate"

/** 一位代理人的伤害计算结果 */
export interface ZzzDmgData {
  /** 逐刀的结果，期望伤害高的在前 */
  list: ZzzDmgResult[]
  /** 假想敌 */
  enemy: ZzzEnemy
  /** 两张属性表，出图时属性栏要 */
  attr: ZzzAttrTables
  /** 假想敌名字，取自 `calc.js` 的 `enemyName` */
  enemyName: string
  /** 公式作者，取自 `calc.js` 的 `createdBy` */
  createdBy: string
}

/**
 * 数一份面板上逐套装的件数
 *
 * 数的是**实际装在身上的**，不取接口的 `own`（那是名下总数，含没装的）。
 * @param avatar 面板里这一位
 * @returns 套装名 → 件数
 */
function setCountOf(avatar: ProfileAvatar): Record<string, number> {
  const out: Record<string, number> = {}
  for (const disc of avatar.zzz?.discs ?? []) {
    if (!disc.set) continue
    out[disc.set] = (out[disc.set] ?? 0) + 1
  }
  return out
}

/** 值是点数（不 ÷100）的乘区；其余按百分数从 `tables` ÷100 */
const POINT_TYPES: ReadonlySet<string> = new Set(["异常精通", "贯穿力", "穿透值"])

/**
 * 把带 `idx` 的音擎 buff 的值从 `data.json.talents.tables` 现填出来
 *
 * 与原神星铁武器公式同一副做法：公式只写表序号，真值在元数据里。按当前叠影取那一档（`tables[idx][叠影-1]`），
 * 百分数 ÷100、点数原样。**取不到表就丢掉这条**（值算不出，留着会印一条 0）。不带 `idx` 的原样返回。
 * @param buffs 收集到的 buff
 * @param tables 该音擎 `data.json.talents.tables`
 * @param star 叠影，1~5
 * @returns 填好值的 buff
 */
export function fillWeaponIdx(
  buffs: readonly ZzzBuff[],
  tables: Readonly<Record<string, readonly (number | string)[]>> | undefined,
  star: number
): ZzzBuff[] {
  const out: ZzzBuff[] = []
  for (const b of buffs) {
    if (b.idx === undefined) {
      out.push(b)
      continue
    }
    const col = tables?.[String(b.idx)]
    if (!col?.length) continue
    const raw = Number(col[Math.min(col.length, Math.max(1, star)) - 1]) || 0
    out.push({ ...b, value: POINT_TYPES.has(b.type) ? raw : raw / 100 })
  }
  return out
}

/**
 * 判一把音擎的效果对这位代理人生不生效
 *
 * **音擎效果只对同职业代理人生效**（游戏规则）：装别的职业的音擎只拿主副属性、不拿特效。
 * 音擎的职业目录名即职业中文名，与面板 `detail.prof` 同口径。任一侧缺职业时不拦（宁可多算也不凭空砍掉）。
 * @param weaponType 音擎所在的职业目录名
 * @param prof 代理人职业中文名
 * @returns 生效时为真
 */
export function weaponFitsProf(weaponType: string | undefined, prof: string | undefined): boolean {
  return !weaponType || !prof || weaponType === prof
}

/**
 * 从元数据取这一局要用的全部 buff
 *
 * 三个来源逐个取、缺哪个就少哪份、不报错。**音擎按职业目录取**（其 `calc.js` 与原神武器同形），故要知道这把音擎在哪个职业目录下。
 * **音擎 buff 的值由 {@link fillWeaponIdx} 从 data.json 现填**（公式只写 `idx`），故要把音擎的整份 `data.json` 与叠影一并交给它。
 * @param avatar 面板里这一位
 * @param loader buff 装载器
 * @param meta 元数据装载器
 * @returns buff 列表
 */
function collectBuffs(avatar: ProfileAvatar, loader: DmgBuffLoader, meta: MetaLoader): ZzzBuff[] {
  const detail = avatar.zzz
  const name = detail?.name ?? ""
  const own = name ? loader.charCalc("zzz", name) : undefined
  const charBuffs = (own?.["buffs"] as readonly ZzzBuff[] | undefined) ?? []

  const weapon = detail?.weapon
  const weaponMeta = weapon?.name ? meta.byName("zzz", weapon.name) : undefined
  const weaponType = weaponMeta?.type
  const weaponFits = weaponFitsProf(weaponType, detail?.prof)
  // 走 `collectOf` 而非 `collect`：后者收尾（反应展开、补 sort、按 sort 排）是原神星铁的形态，对绝区零是死路
  const buffs = loader.collectOf<ZzzBuff>({
    game: "zzz",
    charBuffs,
    ...(weapon?.name && weaponType && weaponFits ? { weaponName: weapon.name, weaponType } : {}),
    sets: setCountOf(avatar)
  })
  // 音擎 buff 的值现填自 data.json（公式只写 idx）；只有音擎 buff 带 idx，故一份表足矣
  const wtables = weaponMeta
    ? (meta.detail("zzz", weaponMeta.id) as { talents?: { tables?: Record<string, readonly (number | string)[]> } } | undefined)?.talents?.tables
    : undefined
  return fillWeaponIdx(buffs, wtables, weapon?.star ?? 0)
}

/**
 * 算一位代理人的伤害
 *
 * @param avatar 面板里这一位
 * @param deps 装载器：buff 走沙箱、倍率走 `data.json`
 * @param enemyLevel 假想敌等级；缺省与代理人同级
 * @returns 伤害数据，或算不出来的成因
 */
export function zzzDmgOf(
  avatar: ProfileAvatar,
  deps: { buffs: DmgBuffLoader; meta: MetaLoader },
  enemyLevel?: number
): ZzzDmgData | { miss: ZzzDmgMiss } {
  const detail = avatar.zzz
  if (!detail) return { miss: "noRate" }
  if (!deps.buffs.enabled) return { miss: "off" }
  if (!deps.meta.ready("zzz")) return { miss: "noMeta" }

  const talent = avatar.talent ?? {}
  // 整份 `data.json` 取一次给两处用：兜底那一份要按它推倍率，`details` 要按它建倍率表
  const meta = deps.meta.detail("zzz", avatar.id)
  const skills = zzzSkillsOf(meta, talent)
  if (skills.length === 0) return { miss: "noRate" }

  const attr = zzzAttrTables(detail)
  const enemy: ZzzEnemy = { ...ZZZ_ENEMY, level: enemyLevel ?? avatar.level }
  const buffCtx: ZzzBuffCtx = {
    rank: avatar.cons,
    talent,
    star: detail.weapon?.star ?? 0,
    setCount: setCountOf(avatar),
    attr
  }
  const own = detail.name ? deps.buffs.charCalc("zzz", detail.name) : undefined
  const ctx: ZzzCalcCtx = {
    ...buffCtx,
    level: avatar.level,
    element: zzzElemName(detail.elemId),
    enemy,
    buffs: collectBuffs(avatar, deps.buffs, deps.meta)
  }

  // 伤害表以元数据的 `details` 为准（倍率由公式按名字从元数据现取，与原神星铁同一副写法：看哪几刀、哪几段连招算一行、哪行判影画都是人的判断、落在包里）；
  // 倍率表那份是**兜底**：没写公式的代理人仍能出一张按招式分段的表，但只把每行倍率各印一行、不懂连招也不懂条件
  const details = own?.["details"] as readonly ZzzDetailSpec[] | undefined
  const ran = details?.length ? zzzRunDetails(details, ctx, meta) : []
  // 公式一行都没算出来时同样退回兜底：那多半是公式写错了，而空栏与"没有公式"无从区分
  const list = ran.length > 0 ? ran : zzzCalcSkills(skills, ctx)

  const enemyName = own?.["enemyName"]
  const createdBy = own?.["createdBy"]
  return {
    list,
    enemy,
    attr,
    enemyName: typeof enemyName === "string" && enemyName ? enemyName : "标准假想敌",
    createdBy: typeof createdBy === "string" ? createdBy.slice(0, 15) : ""
  }
}

/**
 * 判一次结果是不是"算出来了"
 *
 * 收窄用：返回的联合类型里只有失败那一支带 `miss`。
 * @param got 计算结果
 * @returns 算出来时为真
 */
export function isZzzDmg(got: ZzzDmgData | { miss: ZzzDmgMiss }): got is ZzzDmgData {
  return !("miss" in got)
}
