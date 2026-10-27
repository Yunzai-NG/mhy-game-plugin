/**
 * 模块职责：原神的固定对照表 —— 属性键 → 中文名
 * 依赖方向：纯数据，不碰 IO、不依赖元数据
 * 生命周期：无状态，表是模块级常量
 * 注意事项：留在代码里而不搬进元数据包，因元数据可缺可过期，属性名一旦只存在那里则「没装元数据」= 属性栏整栏空白。
 *          面板与武器图鉴**不是同一张表**：同一 `recharge`，面板印「元素充能」、武器副属性印「充能效率」，
 *          合成一张必有一处不对。{@link GS_PROP_NAME} **键序即出图顺序**。
 */

/** 属性键 → 中文名，面板属性栏用；键序即出图顺序 */
export const GS_PROP_NAME: Readonly<Record<string, string>> = {
  hp: "生命值",
  atk: "攻击力",
  def: "防御力",
  mastery: "元素精通",
  cpct: "暴击率",
  cdmg: "暴击伤害",
  recharge: "元素充能",
  dmg: "伤害加成"
}

/** 属性键 → 中文名，武器图鉴的副属性用 */
export const GS_WEAPON_ATTR_NAME: Readonly<Record<string, string>> = {
  hp: "生命值",
  atk: "攻击力",
  def: "防御力",
  cpct: "暴击率",
  cdmg: "暴击伤害",
  recharge: "充能效率",
  mastery: "元素精通",
  phy: "物伤加成"
}
