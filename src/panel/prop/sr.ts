/**
 * 模块职责：星铁的固定对照表 —— 属性键 → 中文名
 * 依赖方向：纯数据，不碰 IO、不依赖元数据
 * 生命周期：无状态，表是模块级常量
 * 注意事项：留在代码里的理由同 prop/gs.ts。**键序即出图顺序**。`elation`（欢愉度）只在走欢愉命途的角色上有值，
 *          其余角色取 0 照常画出。
 */

/** 属性键 → 中文名，面板属性栏用；键序即出图顺序 */
export const SR_PROP_NAME: Readonly<Record<string, string>> = {
  hp: "生命值",
  atk: "攻击力",
  def: "防御力",
  speed: "速度",
  cpct: "暴击率",
  cdmg: "暴击伤害",
  dmg: "伤害加成",
  stance: "击破特攻",
  effPct: "效果命中",
  effDef: "效果抵抗",
  heal: "治疗加成",
  elation: "欢愉度"
}

/** 属性键 → 中文名，光锥图鉴的三项主属性用 */
export const SR_WEAPON_ATTR_NAME: Readonly<Record<string, string>> = {
  hp: "生命值",
  atk: "攻击力",
  def: "防御力"
}
