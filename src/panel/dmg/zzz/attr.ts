/**
 * 模块职责：把面板上那张已算好的属性栏折成伤害层要的数值表
 * 依赖方向：只依赖 panel/prop（属性编号与百分号判据）与 panel/profile 的类型；纯函数
 * 生命周期：无状态
 * 注意事项：绝区零不必自己装配属性、这一层只做单位换算（接口直接给 `base`/`add`/`final`）。**两张表含义不可混**：`final` 是带装备的最终值（倍率乘它）、`base` 是白值（百分比 buff 按它），混用会让高配面板的百分比 buff 滚雪球。
 *          **百分比一律折小数、数值原样**（暴击率 `0.435` 非 `43.5`），折错差两个数量级、判据是值本身带不带百分号。能量自动回复不进表（带单位且不入乘区）。属性伤害加成按代理人自己那种取（面板已把六种并成一行）。
 */
import type { ZzzAvatarDetail } from "../../profile/index.js"
import type { ZzzPropKey } from "../../prop/zzz.js"
import { isPct, propValue, ZZZ_ELEM_DMG_KEY } from "../../prop/zzz.js"

/** 伤害层用得到的属性键，含属性栏那个合成键 */
export type ZzzDmgPropKey = ZzzPropKey | typeof ZZZ_ELEM_DMG_KEY

/** 一张属性表：键为属性键，值已折好单位 */
export type ZzzPropTable = Partial<Record<ZzzDmgPropKey, number>>

/** 面板属性折出的两张表 */
export interface ZzzAttrTables {
  /** 最终值，含驱动盘与音擎；倍率乘的是它 */
  final: ZzzPropTable
  /** 白值，不含装备；百分比 buff 按它折算 */
  base: ZzzPropTable
}

/** 不进属性表的那几项：能量自动回复带单位、闪能自动累积同理，都不入任何乘区 */
const SKIP: ReadonlySet<string> = new Set<string>(["er", "sheerRate"])

/**
 * 六种属性伤害加成的键
 *
 * **面板给的是这六个之一而非合成键**：属性栏并成一行是出图那侧的事，接口与库里存的是具体那种。伤害层若只问合成键、增伤区恒为 1（不报错、每位少掉自己那条加成）。故落表时**两个键都写**：具体键供逐条展示、合成键供伤害层取用。
 */
const ELEM_DMG_KEYS: ReadonlySet<string> = new Set<string>([
  "dmgPhy",
  "dmgFire",
  "dmgIce",
  "dmgElec",
  "dmgWind",
  "dmgEther"
])

/**
 * 折一条属性值
 *
 * 带百分号的除以 100 成小数，数值原样。
 * @param value 接口给的值，形如 `"43.5%"` 或 `"2413"`
 * @returns 折好的数值
 */
function scale(value: string | undefined): number {
  const num = propValue(value)
  return isPct(value) ? num / 100 : num
}

/**
 * 把面板属性栏折成伤害层要的两张表
 *
 * 未装驱动盘时接口不给 `base`、白值退回最终值（那种面板本就不出图，此处只是不让表里出现 `undefined`）。
 * @param detail 面板里绝区零那一块
 * @returns 最终值与白值两张表
 */
export function zzzAttrTables(detail: ZzzAvatarDetail | undefined): ZzzAttrTables {
  const final: ZzzPropTable = {}
  const base: ZzzPropTable = {}
  for (const one of detail?.attrs ?? []) {
    const key = (one.key ?? (one.name === "属性伤害加成" ? ZZZ_ELEM_DMG_KEY : undefined)) as ZzzDmgPropKey | undefined
    if (!key || SKIP.has(key)) continue
    const finalValue = scale(one.final)
    // 未装盘时接口只给 `final`，白值退回它
    const baseValue = one.base === undefined ? finalValue : scale(one.base)
    final[key] = finalValue
    base[key] = baseValue
    // 具体那一种伤害加成同时写到合成键上，伤害层只问合成键
    if (ELEM_DMG_KEYS.has(key)) {
      final[ZZZ_ELEM_DMG_KEY] = finalValue
      base[ZZZ_ELEM_DMG_KEY] = baseValue
    }
  }
  return { final, base }
}

/**
 * 取表里一项
 * @param table 属性表
 * @param key 属性键
 * @returns 数值；缺项为 0
 */
export function zzzPropOf(table: ZzzPropTable, key: ZzzDmgPropKey): number {
  return table[key] ?? 0
}
