/**
 * 模块职责：绝区零属性编号 —— 接口给的 `property_id` 与本插件的词条键、名称、单位对照
 * 依赖方向：纯数据与纯函数，不碰 IO、不依赖元数据
 * 生命周期：无状态，表是模块级常量
 * 注意事项：同一属性有两套编号（界面序号 `1`/`2`… 与系统编号 `111`/`121`…），两套都要认，否则属性栏整条查不到名字、
 *          十二行全空。装备词条编号是「三位系统编号 + 两位变体位」，取前三位再查即可。是否百分比**看值本身带不带
 *          百分号**而非看编号 —— 变体位与百分比不对应，按末位判会把暴击率当数值。
 */

/** 一个属性的词条键 */
export type ZzzPropKey =
  | "hp"
  | "atk"
  | "def"
  | "impact"
  | "cpct"
  | "cdmg"
  | "am"
  | "ap"
  | "pen"
  | "penVal"
  | "er"
  | "sheer"
  | "sheerRate"
  | "sharpCdmg"
  | "dmgPhy"
  | "dmgFire"
  | "dmgIce"
  | "dmgElec"
  | "dmgWind"
  | "dmgEther"

/**
 * 属性编号 → 词条键
 *
 * 两套编号并在一张表：界面序号与系统编号不重叠。装备五位编号由 {@link zzzPropKey} 取前三位落到系统编号段。
 */
const KEY_BY_ID: Readonly<Record<string, ZzzPropKey>> = {
  // 界面序号
  "1": "hp",
  "2": "atk",
  "3": "def",
  "4": "impact",
  "5": "cpct",
  "6": "cdmg",
  "7": "am",
  "8": "ap",
  "9": "pen",
  "11": "er",
  "19": "sheer",
  "20": "sheerRate",
  // 系统编号
  "111": "hp",
  "121": "atk",
  "122": "impact",
  "131": "def",
  "201": "cpct",
  "211": "cdmg",
  "231": "pen",
  "232": "penVal",
  "305": "er",
  "312": "ap",
  "314": "am",
  "315": "dmgPhy",
  "316": "dmgFire",
  "317": "dmgIce",
  "318": "dmgElec",
  "319": "dmgEther",
  "323": "dmgWind"
}

/** 词条键 → 中文名，出图与文本兜底两处都用它 */
export const ZZZ_PROP_NAME: Readonly<Record<ZzzPropKey, string>> = {
  hp: "生命值",
  atk: "攻击力",
  def: "防御力",
  impact: "冲击力",
  cpct: "暴击率",
  cdmg: "暴击伤害",
  am: "异常掌控",
  ap: "异常精通",
  pen: "穿透率",
  penVal: "穿透值",
  er: "能量自动回复",
  sheer: "贯穿力",
  sheerRate: "闪能自动累积",
  sharpCdmg: "锐暴伤害",
  dmgPhy: "物理伤害加成",
  dmgFire: "火属性伤害加成",
  dmgIce: "冰属性伤害加成",
  dmgElec: "电属性伤害加成",
  dmgWind: "风属性伤害加成",
  dmgEther: "以太伤害加成"
}

/**
 * 属性类型 → 该属性的伤害加成编号
 *
 * 评分要把「属性伤害加成」权重落到该代理人自己那一种上。键为接口的 `element_type`。
 */
export const ZZZ_ELEM_DMG_ID: Readonly<Record<string, number>> = {
  "200": 31503,
  "201": 31603,
  "202": 31703,
  "203": 31803,
  "204": 32303,
  "205": 31903
}

/**
 * 属性栏里那一行「属性伤害加成」的键
 *
 * 六种属性伤害加成在属性栏上并成一行（一个代理人只有一种非零），值取该代理人自己那一种。
 * 驱动盘词条那一路不并，印词条本身的全名。
 */
export const ZZZ_ELEM_DMG_KEY = "dmgElem"

/**
 * 属性类型 → 该属性的伤害加成词条键
 *
 * 由 {@link ZZZ_ELEM_DMG_ID} 现推，故对应关系只有一处定义。
 */
export const ZZZ_ELEM_DMG_PROP: Readonly<Record<string, ZzzPropKey>> = Object.fromEntries(
  Object.entries(ZZZ_ELEM_DMG_ID).flatMap(([elem, id]) => {
    const key = zzzPropKey(id)
    return key ? [[elem, key] as const] : []
  })
)

/**
 * 属性类型 → 出图时的类名后缀
 *
 * 属性伤害加成那一行的图标按代理人换一张，换图靠 CSS，视图层只把后缀拼进 `bodyClass`。
 */
export const ZZZ_ELEM_SLUG: Readonly<Record<string, string>> = {
  "200": "phy",
  "201": "fire",
  "202": "ice",
  "203": "elec",
  "204": "wind",
  "205": "ether"
}

/**
 * 属性类型 → 皮肤 css 的元素色类名（头像格拼成 `e-xxx`）
 *
 * 与 {@link ZZZ_ELEM_SLUG} 是两套：那一套是图标文件名，`phy` / `elec` 在 css 里没有对应的色。
 */
export const ZZZ_ELEM_CSS: Readonly<Record<string, string>> = {
  "200": "physical",
  "201": "fire",
  "202": "ice",
  "203": "electric",
  "204": "wind",
  "205": "ether"
}

/**
 * 面板属性栏固定画这几行，键序即出图顺序
 *
 * 刻意是固定清单而非 {@link ZZZ_PROP_NAME} 的全部键：后者是「认得的属性名」全集（十九项，装备词条也从中取名）。
 */
export const ZZZ_PANEL_ATTRS: Readonly<Record<string, string>> = {
  hp: "生命值",
  atk: "攻击力",
  def: "防御力",
  impact: "冲击力",
  cpct: "暴击率",
  cdmg: "暴击伤害",
  am: "异常掌控",
  ap: "异常精通",
  pen: "穿透率",
  er: "能量自动回复",
  penVal: "穿透值",
  [ZZZ_ELEM_DMG_KEY]: "属性伤害加成"
}

/**
 * 取一个属性编号的词条键
 *
 * 整串查不到时按「三位系统编号 + 两位变体位」取前三位再查一次，故装备词条与总属性共用一张表。
 * @param id 属性编号
 * @returns 词条键；不认得时 undefined
 */
export function zzzPropKey(id: string | number): ZzzPropKey | undefined {
  const text = String(id)
  const got = KEY_BY_ID[text]
  if (got) return got
  return text.length > 3 ? KEY_BY_ID[text.slice(0, 3)] : undefined
}

/**
 * 取一个属性编号的中文名
 * @param id 属性编号
 * @returns 中文名；不认得时空串
 */
export function zzzPropName(id: string | number): string {
  const key = zzzPropKey(id)
  return key ? ZZZ_PROP_NAME[key] : ""
}

/**
 * 判一条属性值是不是百分比
 * @param value 接口给的值，形如 `"4.8%"` 或 `"316"`
 * @returns 带百分号时为真
 */
export function isPct(value: string | undefined): boolean {
  return typeof value === "string" && value.trimEnd().endsWith("%")
}

/**
 * 取一条属性值的数值部分
 *
 * `Number.parseFloat` 本就会忽略尾部的百分号，故百分比与数值走同一条路；空串与非数字给 0。
 * @param value 接口给的值
 * @returns 数值；取不出时 0
 */
export function propValue(value: string | number | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const got = Number.parseFloat(value ?? "")
  return Number.isNaN(got) ? 0 : got
}
