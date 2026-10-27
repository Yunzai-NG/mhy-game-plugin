/**
 * 模块职责：原神旅行者的识别 —— id、目录名，以及「冰主」一类按元素的叫法
 * 依赖方向：纯函数，只依赖 meta/elem；被装载器、命令层与伤害层共用
 * 生命周期：模块加载时由元素表摊出叫法，此后只读
 * 注意事项：id 要收元数据目录的 7 与米游社的 20000000，漏了则那一路的曲线与图标静默落到空 / 荧
 *          自己的目录（只有 baseAttr、白值归零）。「冰主」的叫法由元素表现生成：装载器生成别名、
 *          命令层认元素、缺元数据时的提示三处都读这里，各写一份则新元素能认出却不校验元素。
 */
import { eachElem, elemOf } from "./elem.js"

/** 原神旅行者的角色 id；七元素共用男女 id，元数据还用 7，米游社另用 20000000 */
const GS_TRAVELER_IDS: ReadonlySet<string> = new Set(["7", "10000005", "10000007", "20000000"])

/** 旅行者在元数据里的三个目录名：空、荧两个存档角色，与按元素分目录的「旅行者」 */
const GS_TRAVELER_NAMES: ReadonlySet<string> = new Set(["空", "荧", "旅行者"])

/** 按元素叫旅行者的后缀，`冰主` 与 `冰主角` 两种写法都认 */
const ELEM_NAME_SUFFIXES: readonly string[] = ["主", "主角"]

/** 「冰主」→ 元素键，由元素表的展示名摊出 */
const ELEM_NAMES: ReadonlyMap<string, string> = new Map(
  eachElem("gs").flatMap(one => ELEM_NAME_SUFFIXES.map(suffix => [`${one.title}${suffix}`, one.key] as const))
)

/**
 * 判一个原神角色是否旅行者
 * @param id 角色 id
 * @returns 旅行者时为真
 */
export function isGsTraveler(id: string | number): boolean {
  return GS_TRAVELER_IDS.has(String(id))
}

/**
 * 判一个原神角色名是否旅行者
 *
 * 伤害公式按目录名取，故按名判；按 id 判的场合用 {@link isGsTraveler}。
 * @param name 角色名，即元数据里的目录名
 * @returns 旅行者时为真
 */
export function isGsTravelerName(name: string): boolean {
  return GS_TRAVELER_NAMES.has(name)
}

/**
 * 从「冰主」一类叫法里认出元素
 * @param name 使用者输入的名字
 * @returns 元素键，如 `cryo`；不是这类叫法时空串
 */
export function travelerElemOf(name: string): string {
  return ELEM_NAMES.get(name.trim()) ?? ""
}

/**
 * 列出一个元素的全部叫法
 * @param elem 元素键或展示名
 * @returns 如 `["冰主", "冰主角"]`；认不出的元素给空数组
 */
export function travelerNamesOf(elem: string): string[] {
  const key = elemOf(elem, "", "gs")
  return [...ELEM_NAMES].filter(([, one]) => one === key).map(([name]) => name)
}
