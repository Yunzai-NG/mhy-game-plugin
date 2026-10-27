/**
 * 模块职责：绝区零面板的专属形态 —— 另两个游戏没有的那几块（总属性、驱动盘、音擎、影画）
 * 依赖方向：只依赖同目录的 prop（属性编号对照）；纯类型与纯数据，不碰 IO
 * 生命周期：无状态，表是模块级常量
 * 注意事项：这一份挂在 `ProfileAvatar.zzz` 上而不取代它 —— id/等级/影画/音擎/技能/驱动盘部位仍落共用字段，只有「接口已算好属性」进这里。
 *          **属性值按接口给的字符串原样存**（`"43.4%"`/`"1.20"`），自己重排会在小数位上与游戏内不一致；参与计算处用 {@link propValue} 现取。
 *          官方美术地址一概不存（出图走已装元数据），长文（技能/影画/音擎/套装描述）一概不存（逐版本几乎不变，存则一个 uid 几百 KB）。
 */
import type { ZzzPropKey } from "../prop/zzz.js"

/** 属性类型 → 中文名 */
export const ZZZ_ELEM_NAME: Readonly<Record<string, string>> = {
  "200": "物理",
  "201": "火",
  "202": "冰",
  "203": "电",
  "204": "风",
  "205": "以太",
  "300": "流明"
}

/**
 * 属性类型 + 子类型 → 中文名
 *
 * 部分代理人的伤害类型是主属性下的分支（`202/1` 烈霜、`205/2` 玄墨），键为 `<属性>-<子类型>`，查不到回落 {@link ZZZ_ELEM_NAME}。
 */
export const ZZZ_SUB_ELEM_NAME: Readonly<Record<string, string>> = {
  "200-4": "凄刃",
  "202-1": "烈霜",
  "205-2": "玄墨"
}

/** 职业编号 → 中文名 */
export const ZZZ_PROF_NAME: Readonly<Record<string, string>> = {
  "1": "强攻",
  "2": "击破",
  "3": "异常",
  "4": "支援",
  "5": "防护",
  "6": "命破"
}

/**
 * 中文名 → 职业编号
 *
 * 面板里存的是中文名（出图直接用），而驱动盘评分按职业挑候选权重方案时要编号，故反查一次。
 */
export const ZZZ_PROF_ID: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(ZZZ_PROF_NAME).map(([id, name]) => [name, Number(id)])
)

/** 稀有度 → 星级，与邦布那一份同一口径 */
export const ZZZ_RANK_STAR: Readonly<Record<string, number>> = { S: 5, A: 4, B: 3 }

/** 代理人总属性栏里的一行 */
export interface ZzzAttr {
  /** 词条键，认不出时缺省 */
  key?: ZzzPropKey
  /** 中文名 */
  name: string
  /** 基础值；未装驱动盘时接口不给 */
  base?: string
  /** 装备带来的加成值 */
  add?: string
  /** 最终值 */
  final: string
}

/** 装备（驱动盘 / 音擎）上的一条词条 */
export interface ZzzGearAttr {
  /** 属性编号 */
  id: number
  /** 词条键，认不出时缺省 */
  key?: ZzzPropKey
  /** 中文名 */
  name: string
  /** 值，形如 `"9.6%"` 或 `"316"` */
  value: string
  /** 出现次数，1 起（接口给的 `add` 是它减一） */
  rolls: number
  /** 接口判定的有效性；使用者未在米游社配过养成方案时恒为假 */
  valid?: boolean
}

/** 一件驱动盘 */
export interface ZzzDisc {
  /** 驱动盘 id */
  id: number
  /** 名称，带部位后缀如 `沧浪行歌[1]` */
  name: string
  /** 部位，1~6 */
  pos: number
  /** 强化等级，满级 15 */
  level: number
  /** 稀有度 S / A / B */
  rank: string
  /** 主词条 */
  main?: ZzzGearAttr
  /** 副词条 */
  subs: ZzzGearAttr[]
  /** 套装名 */
  set?: string
  /** 套装 id */
  setId?: number
  /** 这一套已装几件 */
  own?: number
}

/** 音擎 */
export interface ZzzWeapon {
  /** 音擎 id */
  id: number
  /** 名称 */
  name: string
  /** 等级 */
  level: number
  /** 叠影，1~5 */
  star: number
  /** 稀有度 S / A / B */
  rank: string
  /** 适配职业编号 */
  prof?: number
  /** 主属性（基础攻击力） */
  main?: ZzzGearAttr
  /** 高级属性 */
  sub?: ZzzGearAttr
}

/**
 * 一个代理人面板里另两个游戏没有的那些东西
 *
 * **这里不存评分**：评分按当前面板现算（见 `panel/score/zzz.ts`），权重方案与覆盖表逐版本会改，存下来就可能已不对。
 */
export interface ZzzAvatarDetail {
  /** 代理人名 */
  name: string
  /** 全名 */
  fullName?: string
  /** 稀有度 S / A */
  rank: string
  /** 职业中文名 */
  prof?: string
  /** 阵营 */
  camp?: string
  /** 属性类型编号，评分要按它挑该代理人的伤害加成词条 */
  elemId?: number
  /** 总属性，按接口给的顺序 —— 那就是游戏内的顺序 */
  attrs: ZzzAttr[]
  /** 音擎 */
  weapon?: ZzzWeapon
  /** 驱动盘，按部位升序 */
  discs: ZzzDisc[]
  /** 米游社自己给的评分档位，形如 `S`；使用者配过养成方案才有 */
  mysRating?: string
  /** 米游社自己给的分数 */
  mysScore?: number
}

/**
 * 取一个代理人的伤害类型名
 *
 * 先按「属性 + 子类型」查分支名，查不到再按主属性查。
 * @param elem 属性类型编号
 * @param sub 子类型编号
 * @returns 中文名；不认得时空串
 */
export function zzzElemName(elem: string | number | undefined, sub: string | number = 0): string {
  if (elem === undefined) return ""
  const branch = ZZZ_SUB_ELEM_NAME[`${elem}-${sub}`]
  return branch ?? ZZZ_ELEM_NAME[String(elem)] ?? ""
}

/**
 * 取一个代理人的职业名
 * @param prof 职业编号
 * @returns 中文名；不认得时空串
 */
export function zzzProfName(prof: string | number | undefined): string {
  return prof === undefined ? "" : (ZZZ_PROF_NAME[String(prof)] ?? "")
}
