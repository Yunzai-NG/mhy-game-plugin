/**
 * 模块职责：绝区零伤害层的用例 —— 属性折算、buff 筛选与求值、乘区、倍率取用、文案解析
 * 依赖方向：只测同目录纯函数，不碰 IO、不读元数据
 * 生命周期：随测试跑
 * 注意事项：**几处判据是靠真机数据定下来的，用例里逐条钉住**：属性伤害加成落具体键而非合成键、
 *          `属性` 二字可省、`+` 与「提升」两种写法、无视抗性折正值、异常伤害默认不暴击。
 *          这些改错都不报错，只让数字不一样，故只能靠用例守。
 */
import { describe, expect, it } from "vitest"
import type { ZzzAvatarDetail } from "../../profile/index.js"
import { zzzPropOf, zzzAttrTables } from "./attr.js"
import type { ZzzBuff, ZzzBuffCtx } from "./buff.js"
import { zzzBuffValue, zzzPickBuffs, zzzSumBuffs } from "./buff.js"
import type { ZzzCalcCtx } from "./calc.js"
import { ZZZ_ENEMY, zzzCalcSkill, zzzCalcSkills, zzzLevelArea } from "./calc.js"
import { zzzSkillsOf } from "./skill.js"
import { fillWeaponIdx, weaponFitsProf } from "./build.js"

/** 一份最小可用的面板，属性照真机形态写 */
const DETAIL: ZzzAvatarDetail = {
  name: "艾莲",
  rank: "S",
  prof: "强攻",
  elemId: 202,
  attrs: [
    { key: "hp", name: "生命值", base: "6317", final: "8413" },
    { key: "atk", name: "攻击力", base: "1000", final: "2000" },
    { key: "def", name: "防御力", base: "491", final: "537" },
    { key: "cpct", name: "暴击率", final: "25.8%" },
    { key: "cdmg", name: "暴击伤害", final: "130.0%" },
    { key: "ap", name: "异常精通", final: "96" },
    { key: "pen", name: "穿透率", final: "0.0%" },
    { key: "penVal", name: "穿透值", final: "24" },
    { key: "er", name: "能量自动回复", final: "1.20" },
    { key: "dmgIce", name: "冰属性伤害加成", final: "30.0%" }
  ],
  discs: []
}

/** 求值与筛选要的上下文 */
const CTX: ZzzBuffCtx = {
  rank: 2,
  talent: { normal: 10, special: 8, core: 3, chain: 5, assist: 4, dodge: 6 },
  star: 3,
  setCount: { 极地重金属: 4, 折枝剑歌: 2 },
  attr: zzzAttrTables(DETAIL)
}

describe("zzzAttrTables", () => {
  it("百分比折成小数，数值原样", () => {
    const { final } = zzzAttrTables(DETAIL)
    expect(final.atk).toBe(2000)
    expect(final.cpct).toBeCloseTo(0.258, 5)
    expect(final.cdmg).toBeCloseTo(1.3, 5)
    expect(final.ap).toBe(96)
  })

  it("**属性伤害加成同时落具体键与合成键** —— 伤害层问的是后者", () => {
    const { final } = zzzAttrTables(DETAIL)
    expect(final.dmgIce).toBeCloseTo(0.3, 5)
    // 只落具体键会让增伤区恒为 1，那是每位代理人都少掉自己那条加成
    expect(final.dmgElem).toBeCloseTo(0.3, 5)
  })

  it("能量自动回复不进表 —— 它带单位且不入任何乘区", () => {
    expect(zzzAttrTables(DETAIL).final.er).toBeUndefined()
  })

  it("白值与最终值是两张表，混用会让百分比 buff 连滚雪球", () => {
    const { base, final } = zzzAttrTables(DETAIL)
    expect(base.atk).toBe(1000)
    expect(final.atk).toBe(2000)
  })

  it("接口不给 base 时白值退回最终值", () => {
    expect(zzzAttrTables(DETAIL).base.cpct).toBeCloseTo(0.258, 5)
  })

  it("面板缺席时两张表都空", () => {
    const got = zzzAttrTables(undefined)
    expect(got.final).toEqual({})
    expect(got.base).toEqual({})
  })

  it("zzzPropOf 缺项给 0", () => {
    expect(zzzPropOf({}, "atk")).toBe(0)
  })
})

describe("zzzBuffValue", () => {
  it("**绝对值小于 1 且属可折算那几项时乘白值**", () => {
    const buff: ZzzBuff = { name: "攻击力提升20%", type: "攻击力", value: 0.2, source: "套装" }
    // 白值 1000 × 20% = 200，而不是最终值 2000 的两成
    expect(zzzBuffValue(buff, CTX)).toBeCloseTo(200, 5)
  })

  it("大于等于 1 的按定值算 —— `19` 是十九点而不是一千九百倍", () => {
    const buff: ZzzBuff = { name: "攻击力+19", type: "攻击力", value: 19, source: "套装" }
    expect(zzzBuffValue(buff, CTX)).toBe(19)
  })

  it("不可折算的那些不乘白值 —— 暴击率 8% 就是 0.08", () => {
    const buff: ZzzBuff = { name: "暴击率+8%", type: "暴击率", value: 0.08, source: "套装" }
    expect(zzzBuffValue(buff, CTX)).toBeCloseTo(0.08, 5)
  })

  it("音擎的逐档值按叠影取", () => {
    const buff: ZzzBuff = { name: "音擎", type: "暴击伤害", value: [0.2, 0.25, 0.3, 0.35, 0.4], source: "音擎" }
    // star 为 3，取第三档
    expect(zzzBuffValue(buff, CTX)).toBeCloseTo(0.3, 5)
  })

  it("核心被动的逐档值按核心技等级取", () => {
    const buff: ZzzBuff = { name: "核心", type: "暴击率", value: [0.1, 0.15, 0.2, 0.25], source: "核心被动" }
    // talent.core 为 3
    expect(zzzBuffValue(buff, CTX)).toBeCloseTo(0.2, 5)
  })

  it("函数形态的值已是成品，不再折白值", () => {
    const buff: ZzzBuff = { name: "现算", type: "攻击力", value: () => 0.5, source: "其他" }
    expect(zzzBuffValue(buff, CTX)).toBeCloseTo(0.5, 5)
  })

  it("buffCount 把每层值乘上去 —— 音擎公式写每层值 + 层数，与原神同", () => {
    const buff: ZzzBuff = { name: "增伤(5层)", type: "增伤", value: [0.06, 0.075, 0.09, 0.105, 0.12], buffCount: 5, source: "音擎" }
    // star 为 3 取第三档 0.09，×5 层 = 0.45
    expect(zzzBuffValue(buff, CTX)).toBeCloseTo(0.45, 5)
  })

  it("buffCount 与折白值并存 —— 攻击力每层 3% × 8 层，再乘白值 1000", () => {
    const buff: ZzzBuff = { name: "攻击力(8层)", type: "攻击力", value: 0.03, buffCount: 8, source: "音擎" }
    // 0.03 × 白值 1000 = 30，× 8 层 = 240
    expect(zzzBuffValue(buff, CTX)).toBeCloseTo(240, 5)
  })

  it("有上限时取两者较小", () => {
    const buff: ZzzBuff = { name: "封顶", type: "异常精通", value: 300, max: 100, source: "套装" }
    expect(zzzBuffValue(buff, CTX)).toBe(100)
  })
})

describe("fillWeaponIdx", () => {
  /** 一把音擎的两张表：t1 是百分数、t2 是点数 */
  const TABLES = { "1": [15, 17.5, 20, 22.5, 25], "2": [30, 34, 38, 42, 46] }

  it("百分数类按叠影取那一档、÷100", () => {
    const got = fillWeaponIdx([{ name: "增伤", type: "增伤", idx: 1, source: "音擎" }], TABLES, 3)
    // 叠影3 取 t1[2]=20 → 0.2
    expect(got[0]?.value).toBeCloseTo(0.2, 5)
  })

  it("点数类（异常精通/贯穿力/穿透值）原样、不 ÷100", () => {
    const got = fillWeaponIdx([{ name: "精通", type: "异常精通", idx: 2, source: "音擎" }], TABLES, 5)
    // 叠影5 取 t2[4]=46，点数不折
    expect(got[0]?.value).toBe(46)
  })

  it("buffCount 留给引擎乘，本层只填每层值", () => {
    const got = fillWeaponIdx([{ name: "增伤(5层)", type: "增伤", idx: 1, buffCount: 5, source: "音擎" }], TABLES, 1)
    // 叠影1 取 t1[0]=15 → 0.15（每层），buffCount 不在这里乘
    expect(got[0]?.value).toBeCloseTo(0.15, 5)
    expect(got[0]?.buffCount).toBe(5)
  })

  it("取不到表就丢掉这条 —— 留着会印一条 0", () => {
    const got = fillWeaponIdx([{ name: "缺表", type: "增伤", idx: 9, source: "音擎" }], TABLES, 3)
    expect(got).toEqual([])
  })

  it("不带 idx 的原样返回 —— 角色 / 套装 buff 不受影响", () => {
    const one: ZzzBuff = { name: "角色自带", type: "增伤", value: [0.1, 0.2], source: "核心被动" }
    expect(fillWeaponIdx([one], TABLES, 3)[0]).toBe(one)
  })
})

describe("weaponFitsProf", () => {
  it("同职业生效、异职业不生效", () => {
    expect(weaponFitsProf("强攻", "强攻")).toBe(true)
    expect(weaponFitsProf("异常", "强攻")).toBe(false)
  })

  it("任一侧缺职业时不拦", () => {
    expect(weaponFitsProf(undefined, "强攻")).toBe(true)
    expect(weaponFitsProf("强攻", undefined)).toBe(true)
  })
})

describe("zzzPickBuffs", () => {
  /** 造一份 buff */
  const of = (one: Partial<ZzzBuff>): ZzzBuff =>
    ({ name: "x", type: "增伤", value: 0.1, source: "套装", ...one }) as ZzzBuff

  it("`range` 是前缀匹配 —— buff 写 `EQ` 要命中 `EQ1`", () => {
    const got = zzzPickBuffs([of({ range: ["EQ"] })], { type: "EQ1" }, CTX)
    expect(got).toHaveLength(1)
  })

  it("`range` 不含该技能时不生效", () => {
    expect(zzzPickBuffs([of({ range: ["EQ"] })], { type: "AP1" }, CTX)).toHaveLength(0)
  })

  it("没有 `range` 的对全部技能生效", () => {
    expect(zzzPickBuffs([of({})], { type: "AP1" }, CTX)).toHaveLength(1)
  })

  it("`include` 绕过 `range`", () => {
    expect(zzzPickBuffs([of({ range: ["EQ"], include: ["RL1"] })], { type: "RL1" }, CTX)).toHaveLength(1)
  })

  it("`exclude` 优先于其余判据", () => {
    expect(zzzPickBuffs([of({ exclude: ["EQ1"] })], { type: "EQ1" }, CTX)).toHaveLength(0)
  })

  it("属性限定只对该属性生效", () => {
    const buff = of({ element: "冰" })
    expect(zzzPickBuffs([buff], { type: "AP1", element: "冰" }, CTX)).toHaveLength(1)
    expect(zzzPickBuffs([buff], { type: "AP1", element: "电" }, CTX)).toHaveLength(0)
  })

  it("**套装的数字门槛看件数，影画的看影画数**", () => {
    // 极地重金属装了 4 件，四件套门槛过
    expect(zzzPickBuffs([of({ source: "套装", setName: "极地重金属", check: 4 })], { type: "AP1" }, CTX)).toHaveLength(1)
    // 折枝剑歌只装了 2 件，四件套门槛不过
    expect(zzzPickBuffs([of({ source: "套装", setName: "折枝剑歌", check: 4 })], { type: "AP1" }, CTX)).toHaveLength(0)
    // 影画 2，4 影的效果不生效
    expect(zzzPickBuffs([of({ source: "影画", check: 4 })], { type: "AP1" }, CTX)).toHaveLength(0)
    expect(zzzPickBuffs([of({ source: "影画", check: 2 })], { type: "AP1" }, CTX)).toHaveLength(1)
  })

  it("函数门槛直接调", () => {
    expect(zzzPickBuffs([of({ check: ctx => ctx.rank >= 6 })], { type: "AP1" }, CTX)).toHaveLength(0)
  })
})

describe("zzzSumBuffs", () => {
  it("同一乘区上的累加，别的乘区不掺进来", () => {
    const buffs: ZzzBuff[] = [
      { name: "a", type: "增伤", value: 0.1, source: "套装" },
      { name: "b", type: "增伤", value: 0.2, source: "套装" },
      { name: "c", type: "暴击率", value: 0.5, source: "套装" }
    ]
    const got = zzzSumBuffs(buffs, "增伤", 1, CTX)
    expect(got.value).toBeCloseTo(1.3, 5)
    expect(got.used).toHaveLength(2)
  })

  it("**不可叠加的同名取高的那一份，且低值先出现时要撤回**", () => {
    const buffs: ZzzBuff[] = [
      { name: "同名", type: "增伤", value: 0.1, source: "音擎", stackable: false },
      { name: "同名", type: "增伤", value: 0.3, source: "音擎", stackable: false }
    ]
    const got = zzzSumBuffs(buffs, "增伤", 1, CTX)
    // 只跳过后来的会得 1.1，撤回后应是 1.3
    expect(got.value).toBeCloseTo(1.3, 5)
    expect(got.used).toHaveLength(1)
  })

  it("不可叠加时后来的更低则不计", () => {
    const buffs: ZzzBuff[] = [
      { name: "同名", type: "增伤", value: 0.3, source: "音擎", stackable: false },
      { name: "同名", type: "增伤", value: 0.1, source: "音擎", stackable: false }
    ]
    expect(zzzSumBuffs(buffs, "增伤", 1, CTX).value).toBeCloseTo(1.3, 5)
  })
})

describe("zzzCalcSkill", () => {
  /** 一份算伤害的上下文 */
  const calcCtx = (buffs: ZzzBuff[] = []): ZzzCalcCtx => ({
    ...CTX,
    level: 60,
    element: "冰",
    enemy: { ...ZZZ_ENEMY, level: 60 },
    buffs
  })

  it("常规伤害：暴击伤害高于期望，两者都为正", () => {
    const got = zzzCalcSkill({ name: "普攻", type: "AP1", multiplier: 3.2 }, calcCtx())
    expect(got.avg).toBeGreaterThan(0)
    expect(got.crit).toBeGreaterThan(got.avg)
  })

  it("**增伤区的初值是面板那条属性加成**，且只在属性一致时计入", () => {
    const own = zzzCalcSkill({ name: "冰刀", type: "AP1", multiplier: 3.2 }, calcCtx())
    const other = zzzCalcSkill({ name: "以太刀", type: "AP1", multiplier: 3.2, element: "以太" }, calcCtx())
    expect(own.areas.boost).toBeCloseTo(1.3, 5)
    // 冰属性代理人打出的以太伤害不吃冰伤加成
    expect(other.areas.boost).toBeCloseTo(1, 5)
    expect(own.avg).toBeGreaterThan(other.avg)
  })

  it("**抗性区的初值是 `1 - 敌人抗性`**，标准假想敌是 -0.2 故为 1.2", () => {
    expect(zzzCalcSkill({ name: "x", type: "AP1", multiplier: 1 }, calcCtx()).areas.resistance).toBeCloseTo(1.2, 5)
  })

  it("暴击率钳在 0~1 —— 堆过头不会让期望虚高", () => {
    const buffs: ZzzBuff[] = [{ name: "堆爆", type: "暴击率", value: 5, source: "其他" }]
    expect(zzzCalcSkill({ name: "x", type: "AP1", multiplier: 1 }, calcCtx(buffs)).cpct).toBe(1)
  })

  it("倍率区的 buff 与技能自身倍率相加", () => {
    const buffs: ZzzBuff[] = [{ name: "额外倍率", type: "倍率", value: 1, source: "其他" }]
    const plain = zzzCalcSkill({ name: "x", type: "AP1", multiplier: 1 }, calcCtx())
    const more = zzzCalcSkill({ name: "x", type: "AP1", multiplier: 1 }, calcCtx(buffs))
    expect(more.areas.basic).toBeCloseTo(plain.areas.basic * 2, 3)
  })

  it("**异常伤害默认不暴击**：暴击栏为 0，且吃异常精通区与等级区", () => {
    const got = zzzCalcSkill({ name: "碎冰", type: "碎冰", multiplier: 7.13, isAnomaly: true }, calcCtx())
    expect(got.crit).toBe(0)
    expect(got.avg).toBeGreaterThan(0)
    expect(got.areas.proficiency).toBeCloseTo(0.96, 5)
    expect(got.areas.levelArea).toBeCloseTo(2, 3)
  })

  it("异常伤害有「异常暴击率」时才暴击", () => {
    const buffs: ZzzBuff[] = [
      { name: "异暴", type: "异常暴击率", value: 0.5, source: "其他" },
      { name: "异爆", type: "异常暴击伤害", value: 1, source: "其他" }
    ]
    const got = zzzCalcSkill({ name: "碎冰", type: "碎冰", multiplier: 7.13, isAnomaly: true }, calcCtx(buffs))
    expect(got.crit).toBeGreaterThan(got.avg)
  })

  it("**贯穿伤害不吃防御区**，改吃贯穿增伤区", () => {
    const got = zzzCalcSkill({ name: "贯穿", type: "AP1", multiplier: 3.2, isSheer: true }, calcCtx())
    expect(got.areas.defence).toBe(1)
    expect(got.areas.sheerBoost).toBeCloseTo(1, 5)
  })

  it("贯穿力缺省是攻击力的三成取整", () => {
    const got = zzzCalcSkill({ name: "贯穿", type: "AP1", multiplier: 1, isSheer: true }, calcCtx())
    // 攻击力 2000 → 贯穿力 600
    expect(got.areas.basic).toBeCloseTo(600, 5)
  })

  it("防御区随穿透率上升", () => {
    const buffs: ZzzBuff[] = [{ name: "穿透", type: "穿透率", value: 0.5, source: "其他" }]
    const plain = zzzCalcSkill({ name: "x", type: "AP1", multiplier: 1 }, calcCtx())
    const pen = zzzCalcSkill({ name: "x", type: "AP1", multiplier: 1 }, calcCtx(buffs))
    expect(pen.areas.defence).toBeGreaterThan(plain.areas.defence)
  })

  it("参与计算的 buff 按绝对值降序印出", () => {
    const buffs: ZzzBuff[] = [
      { name: "小", type: "增伤", value: 0.1, source: "套装" },
      { name: "大", type: "增伤", value: 0.5, source: "套装" }
    ]
    const got = zzzCalcSkill({ name: "x", type: "AP1", multiplier: 1 }, calcCtx(buffs))
    expect(got.buffs.map(one => one.name)).toEqual(["大", "小"])
  })
})

describe("zzzCalcSkills", () => {
  /** 一份算伤害的上下文 */
  const ctx: ZzzCalcCtx = { ...CTX, level: 60, element: "冰", enemy: { ...ZZZ_ENEMY, level: 60 }, buffs: [] }

  it("倍率为 0 的不出，期望高的在前", () => {
    const got = zzzCalcSkills(
      [
        { name: "小", type: "AP1", multiplier: 1 },
        { name: "无倍率", type: "AP2", multiplier: 0 },
        { name: "大", type: "AP3", multiplier: 5 }
      ],
      ctx
    )
    expect(got).toHaveLength(2)
    expect(got[0]?.name).toBe("大")
  })
})

describe("zzzLevelArea", () => {
  it("一级是 1、六十级是 2", () => {
    expect(zzzLevelArea(1)).toBe(1)
    expect(zzzLevelArea(60)).toBeCloseTo(2, 3)
  })
})

describe("zzzSkillsOf", () => {
  /** 一份最小的元数据详情 */
  const detail = {
    talent: {
      basic: {
        name: "普通攻击",
        tables: [
          { name: "一段伤害倍率", values: ["100%", "110%", "120%"] },
          { name: "一段失衡倍率", values: ["50%", "55%", "60%"] },
          { name: "对小体型敌人伤害倍率", values: ["200%", "210%", "220%"] },
          { name: "对中体型敌人伤害倍率", values: ["300%", "310%", "320%"] },
          { name: "对大体型敌人伤害倍率", values: ["400%", "410%", "420%"] }
        ]
      },
      special: {
        name: "特殊技",
        tables: [
          { name: "伤害倍率", values: ["93.4%", "101.9%"] },
          { name: "能量消耗", isSame: true, values: ["60点"] }
        ]
      }
    }
  }

  it("**只取伤害倍率，失衡倍率一概不取**", () => {
    const got = zzzSkillsOf(detail, { normal: 2, special: 1 })
    expect(got.some(one => one.name.includes("失衡"))).toBe(false)
  })

  it("**体型分支只取中体型那一支** —— 三支全取会让同一刀记三遍", () => {
    const got = zzzSkillsOf(detail, { normal: 1, special: 1 })
    const sizes = got.filter(one => one.name.includes("体型"))
    expect(sizes).toHaveLength(1)
    expect(sizes[0]?.multiplier).toBeCloseTo(3, 5)
  })

  it("倍率按该族的技能等级取，且折成小数", () => {
    const lv1 = zzzSkillsOf(detail, { normal: 1, special: 1 })
    const lv3 = zzzSkillsOf(detail, { normal: 3, special: 1 })
    expect(lv1[0]?.multiplier).toBeCloseTo(1, 5)
    expect(lv3[0]?.multiplier).toBeCloseTo(1.2, 5)
  })

  it("**等级超出表长时按等差外推**，不夹在末档 —— 官方表只 12 档而技能等级可到 16", () => {
    // 表 100%/110%/120%，步长 0.1；12 级外推得 1.2 + 0.1×9 = 2.1
    const got = zzzSkillsOf(detail, { normal: 12, special: 1 })
    expect(got[0]?.multiplier).toBeCloseTo(2.1, 5)
  })

  it("不等差的表仍夹在末档 —— 少算可查，外推错则无迹象", () => {
    const bumpy = {
      talent: { basic: { name: "普通攻击", tables: [{ name: "一段伤害倍率", values: ["100%", "110%", "300%"] }] } }
    }
    const got = zzzSkillsOf(bumpy, { normal: 9 })
    expect(got[0]?.multiplier).toBeCloseTo(3, 5)
  })

  it("`isSame` 的单档行等级再高也取那一条，不凭一档外推", () => {
    const same = {
      talent: { basic: { name: "普通攻击", tables: [{ name: "一段伤害倍率", isSame: true, values: ["250%"] }] } }
    }
    const got = zzzSkillsOf(same, { normal: 16 })
    expect(got[0]?.multiplier).toBeCloseTo(2.5, 5)
  })

  it("同族同名的行按出现次序编号，故 buff 的 `range` 能分别命中", () => {
    const got = zzzSkillsOf(detail, { normal: 1, special: 1 })
    expect(got.map(one => one.type)).toContain("AP1")
    expect(got.map(one => one.type)).toContain("EQ1")
  })

  it("元数据缺席时一刀都不出 —— 调用方据此不画伤害栏", () => {
    expect(zzzSkillsOf(undefined, {})).toEqual([])
  })
})

