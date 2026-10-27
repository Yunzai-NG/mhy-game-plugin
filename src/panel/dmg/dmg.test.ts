/**
 * 模块职责：伤害计算三层的测试 —— 数值表、属性折算、伤害公式
 * 依赖方向：测试文件，依赖 panel/dmg/{meta,mastery,attr,calc,buffs}
 * 生命周期：无状态
 * 注意事项：**这些用例只钉不可改的判据**，逐值正确性由落地时的差分比对负责（75909 个数值 0 处
 *          不一致，脚本用完即删）—— 自己写夹具验乘区连乘只会把同一个误解写两遍。故专覆三类：
 *          落地时踩过的坑（cons 守卫读 `meta` 而非属性表、千分位格式化恒带一位小数）、两个游戏
 *          形态不同处（gs 无易伤减伤区、sr 无精通反应）、边界（暴击率钳制、抗性三段、等级表缺档）。
 */
import { describe, expect, it } from "vitest"
import { attrValue, baseAttr, calcDmgAttr, cloneAttr, dataSet } from "./attr.js"
import { calcRet, getDmgFn } from "./calc.js"
import {
  keyIdxBuff,
  normalizeBuffs,
  staticAttrBuff,
  staticIdxBuff,
  stepValues,
  weaponBuffsOf,
  weaponTablesAt
} from "./buffs.js"
import { masteryBasePct, masteryMultiple } from "./mastery.js"
import { baseDmgAt, ELE_BASE_DMG, ER_TITLE, ER_TYPE } from "./meta.js"

/** 一份够用的原神面板属性，字段与 `panel/attr.ts` 的产出对齐 */
const PANEL_GS = {
  atkBase: 800,
  atk: 1800,
  defBase: 700,
  def: 900,
  hpBase: 15000,
  hp: 22000,
  mastery: 200,
  recharge: 140,
  cpct: 60,
  cdmg: 150,
  heal: 10,
  dmg: 46,
  phy: 0,
  diffelem: 0,
  shield: 0,
  staticAttr: {
    atk: { base: 0, plus: 0, pct: 60 },
    def: { base: 0, plus: 0, pct: 20 },
    hp: { base: 0, plus: 0, pct: 40 }
  }
}

/** 一份够用的星铁面板属性 */
const PANEL_SR = {
  atkBase: 700,
  atk: 2400,
  defBase: 500,
  def: 800,
  hpBase: 1200,
  hp: 3800,
  speed: 110,
  recharge: 120,
  cpct: 70,
  cdmg: 160,
  heal: 5,
  dmg: 40,
  enemydmg: 10,
  effPct: 20,
  effDef: 0,
  stance: 30,
  elation: 20,
  shield: 0,
  staticAttr: {
    atk: { base: 0, plus: 0, pct: 50 },
    def: { base: 0, plus: 0, pct: 10 },
    hp: { base: 0, plus: 0, pct: 30 },
    speed: { base: 0, plus: 0, pct: 0 }
  }
}

/**
 * 造一份基准属性表
 * @param game 游戏
 * @returns 属性表
 */
function base(game: "gs" | "sr") {
  return baseAttr({
    attr: game === "gs" ? PANEL_GS : PANEL_SR,
    game,
    element: game === "gs" ? "火" : "fire",
    weaponTypeName: game === "gs" ? "长柄武器" : "毁灭",
    weapon: { name: "护摩之杖", affix: 3 },
    cons: 6,
    level: 90,
    sp: game === "sr" ? 120 : 0
  })
}

/**
 * 喂一条 buff，取回折算后的属性表与文案
 * @param buff buff
 * @param game 游戏
 * @param meta 数据集里的 meta，cons / trees 的真正来源
 * @returns 折算结果
 */
function fold(buff: unknown, game: "gs" | "sr" = "gs", meta: Record<string, unknown> = { level: 90, cons: 6, trees: {} }) {
  return calcDmgAttr({
    base: base(game),
    buffs: [buff as never],
    meta,
    artis: {},
    game
  })
}

describe("数值表", () => {
  it("蒸发与融化的基数取决于触发元素，正反应 2 倍、逆反应 1.5 倍", () => {
    // 这一条搞反会让所有蒸发流角色的期望伤害差三成
    expect(ER_TYPE["vaporize"]?.num({ element: "水" })).toBe(2)
    expect(ER_TYPE["vaporize"]?.num({ element: "火" })).toBe(1.5)
    expect(ER_TYPE["melt"]?.num({ element: "火" })).toBe(2)
    expect(ER_TYPE["melt"]?.num({ element: "水" })).toBe(1.5)
  })

  it("其余反应的基数与触发元素无关", () => {
    expect(ER_TYPE["overloaded"]?.num({ element: "火" })).toBe(11)
    expect(ER_TYPE["overloaded"]?.num({})).toBe(11)
  })

  it("月反应与星扩散的基数按 `talent` 分两档 —— 走 reaction() 的那一路取高档", () => {
    // 判错不报错，只让这一族伤害差一倍上下
    expect(ER_TYPE["lunarCharged"]?.num({ talent: "fy" })).toBe(7.2)
    expect(ER_TYPE["lunarCharged"]?.num({ talent: "e" })).toBe(3)
    expect(ER_TYPE["lunarCrystallize"]?.num({ talent: "fy" })).toBe(3.84)
    expect(ER_TYPE["lunarCrystallize"]?.num({ talent: "e" })).toBe(1.6)
    expect(ER_TYPE["stellarSwirl"]?.num({ talent: "fy" })).toBe(3)
    expect(ER_TYPE["stellarSwirl"]?.num({ talent: "e" })).toBe(1)
  })

  it("星超导按叠层取基数，公式没传层数时按满层算", () => {
    expect(ER_TYPE["stellarConduct"]?.num({ params: { stellarConductCount: 1 } })).toBe(1.45)
    expect(ER_TYPE["stellarConduct"]?.num({ params: { stellarConductCount: 12 } })).toBe(2)
    // 不传即满层；越界的层数回落成 1
    expect(ER_TYPE["stellarConduct"]?.num({})).toBe(2)
    expect(ER_TYPE["stellarConduct"]?.num({ params: { stellarConductCount: 99 } })).toBe(1)
  })

  it("中文反应名可反查回键，公式文件里两种写法都有", () => {
    expect(ER_TITLE["蒸发"]).toBe("vaporize")
    expect(ER_TITLE["超激化"]).toBe("aggravate")
    expect(ER_TITLE["雷击破"]).toBe("lightningBreak")
  })

  it("等级表缺档时给 0 而非 undefined，避免一路传成 NaN", () => {
    expect(baseDmgAt(ELE_BASE_DMG, 90)).toBe(361.713)
    // 91~94 在源表里就没有
    expect(baseDmgAt(ELE_BASE_DMG, 91)).toBe(0)
    expect(baseDmgAt(ELE_BASE_DMG, 95)).toBe(390.367)
  })
})

describe("精通乘区", () => {
  it("五类反应各走一条公式，不可混用", () => {
    // 增幅 25/9、剧变 16、激化 5、结晶 40/9，分母也各不相同
    expect(masteryMultiple("vaporize", 1400)).toBeCloseTo((25 / 9) * 0.5, 10)
    expect(masteryMultiple("overloaded", 2000)).toBeCloseTo(8, 10)
    expect(masteryMultiple("aggravate", 1200)).toBeCloseTo(2.5, 10)
    expect(masteryMultiple("crystallize", 1400)).toBeCloseTo((40 / 9) * 0.5, 10)
  })

  it("月反应与星反应共用 6 / (m+2000)", () => {
    expect(masteryMultiple("lunarBloom", 2000)).toBeCloseTo(3, 10)
    expect(masteryMultiple("stellarConduct", 2000)).toBeCloseTo(3, 10)
  })

  it("击破类没有精通加成，返回 0", () => {
    expect(masteryMultiple("lightningBreak", 3000)).toBe(0)
    expect(masteryMultiple("shock", 3000)).toBe(0)
  })

  it("不认得的反应名返回 0 而不抛错", () => {
    expect(masteryMultiple("nonexistent", 1000)).toBe(0)
    expect(masteryBasePct("nonexistent")).toBe(1)
  })
})

describe("属性值公式", () => {
  it("值为 base * (1 + pct/100) + plus", () => {
    expect(attrValue({ base: 800, plus: 400, pct: 50 })).toBe(1600)
  })

  it("传数字时原样返回，公式里两种形态都有", () => {
    expect(attrValue(123)).toBe(123)
    expect(attrValue(undefined)).toBe(0)
  })
})

describe("基准属性表", () => {
  it("精炼是 0 起，故由武器的 affix 减一", () => {
    // 公式里写 `step(40)[refine]`，差一档就是差一个精炼的数值
    expect(base("gs").refine).toBe(2)
  })

  it("原神有精通与异元素盒子，星铁没有", () => {
    expect(base("gs")["mastery"]).toBeDefined()
    expect(base("gs")["diffelem"]).toBeDefined()
    expect(base("sr")["mastery"]).toBeUndefined()
  })

  it("星铁有速度、击破特攻与欢愉，原神没有", () => {
    expect(base("sr")["speed"]).toBeDefined()
    expect(base("sr")["stance"]).toBeDefined()
    expect(base("sr")["elation"]).toBeDefined()
    expect(base("gs")["speed"]).toBeUndefined()
  })

  it("原神建 6 个技能盒子，星铁建 12 个", () => {
    // 拿星铁的键去喂原神会打到 undefined 上，这一点是有意如此，不另加守卫
    expect(base("gs")["nightsoul"]).toBeDefined()
    expect(base("gs")["dot"]).toBeUndefined()
    expect(base("sr")["dot"]).toBeDefined()
    expect(base("sr")["break"]).toBeDefined()
  })

  it("护盾的基数与吸收倍率都是 100，不是 0", () => {
    const shield = base("gs")["shield"] as { base: number; inc: number }
    expect(shield.base).toBe(100)
    expect(shield.inc).toBe(100)
  })

  it("深拷贝互不影响 —— 每条详情各自折算，buff 不该在详情之间累积", () => {
    const one = base("gs")
    const two = cloneAttr(one)
    ;(two["dmg"] as { plus: number }).plus += 50
    expect((one["dmg"] as { plus: number }).plus).toBe(0)
  })

  it("属性项可隐式转成属性值 —— 公式里写 `0.16 * attr.hp`，深拷之后也要保住", () => {
    const one = base("gs")
    const hp = attrValue(one["hp"] as never)
    expect(Number(one["hp"])).toBe(hp)
    expect(0.5 * (cloneAttr(one)["hp"] as unknown as number)).toBe(hp * 0.5)
  })
})

describe("buff 折算", () => {
  it("技能键按后缀落到对应字段", () => {
    const got = fold({ title: "测试 [eDmg]", data: { eDmg: 30 } })
    expect((got.attr["e"] as { dmg: number }).dmg).toBe(30)
  })

  it("基础属性键无后缀时记进 plus 而非 base", () => {
    // 基准 plus 是"面板值减基础值"，即 1800 - 800 = 1000
    const got = fold({ title: "测试 [atk]", data: { atk: 100 } })
    const atk = got.attr["atk"] as { base: number; plus: number }
    expect(atk.base).toBe(800)
    expect(atk.plus).toBe(1000 + 100)
  })

  it("加基础值时按静态百分比一并放大 —— 漏掉这一步面板攻击会偏低", () => {
    // atkBase +100 且静态 atk 百分比为 60，故 base 加 100 之外，plus 另加 100×60% = 60
    const got = fold({ title: "测试 [atkBase]", data: { atkBase: 100 } })
    const atk = got.attr["atk"] as { base: number; plus: number }
    expect(atk.base).toBe(900)
    expect(atk.plus).toBe(1000 + 60)
  })

  it("isStatic 的条目一律跳过，它们已计入面板属性", () => {
    const got = fold({ title: "静态 [dmg]", isStatic: true, data: { dmg: 99 } })
    expect((got.attr["dmg"] as { plus: number }).plus).toBe(0)
    expect(got.msg).toEqual([])
  })

  it("check 返回假时跳过", () => {
    const on = fold({ title: "过 [dmg]", check: () => true, data: { dmg: 50 } })
    const off = fold({ title: "不过 [dmg]", check: () => false, data: { dmg: 50 } })
    expect((on.attr["dmg"] as { plus: number }).plus).toBe(50)
    expect((off.attr["dmg"] as { plus: number }).plus).toBe(0)
  })

  it("命座门槛按 meta 里的 cons 判，不是按属性表", () => {
    // 门槛读 ds.cons（来自 meta），读成 attr.cons 会使门槛恒按 0 判，
    // 于是 cons 门槛一律不过、maxCons 一律通过，两个方向同时错
    const meta = { level: 90, cons: 6, trees: {} }
    const pass = fold({ title: "满足 [dmg]", cons: 2, data: { dmg: 40 } }, "gs", meta)
    expect((pass.attr["dmg"] as { plus: number }).plus).toBe(40)

    const low = fold({ title: "不足 [dmg]", cons: 7, data: { dmg: 40 } }, "gs", meta)
    expect((low.attr["dmg"] as { plus: number }).plus).toBe(0)

    const over = fold({ title: "超出 [dmg]", maxCons: 3, data: { dmg: 30 } }, "gs", meta)
    expect((over.attr["dmg"] as { plus: number }).plus).toBe(0)
  })

  it("行迹门槛查 meta 的 trees，501 是通用档不查表", () => {
    const meta = { level: 80, cons: 6, trees: { "10201": true } }
    const hit = fold({ title: "行迹 [dmg]", tree: 201, data: { dmg: 20 } }, "sr", meta)
    expect((hit.attr["dmg"] as { plus: number }).plus).toBe(20)

    const miss = fold({ title: "行迹 [dmg]", tree: 202, data: { dmg: 20 } }, "sr", meta)
    expect((miss.attr["dmg"] as { plus: number }).plus).toBe(0)

    const always = fold({ title: "通用 [dmg]", tree: 501, data: { dmg: 20 } }, "sr", meta)
    expect((always.attr["dmg"] as { plus: number }).plus).toBe(20)
  })

  it("data 的值可以是函数，收整个数据集", () => {
    const got = fold({
      title: "函数 [atkPlus]",
      data: { atkPlus: (ds: { attr: Record<string, { base: number }> }) => ds.attr["atk"]!.base * 0.2 }
    })
    const atk = got.attr["atk"] as { plus: number }
    // 函数收到的是折算中的属性表，atk.base = 800 → 加 160
    expect(atk.plus).toBe(1000 + 160)
  })

  it("文案里的占位符换成数值，且恒带一位小数 —— 整数也要 .0", () => {
    // 格式化恒带一位小数，写成"整数不带小数"会让每条 buff 文案的写法前后两版对不上
    const got = fold({ title: "提高 [dmg]%", data: { dmg: 33 } })
    expect(got.msg).toEqual(["提高 33.0%"])
  })

  it("四位以上的数值带千分位", () => {
    const got = fold({ title: "提高 [atkPlus]", data: { atkPlus: 12345 } })
    expect(got.msg).toEqual(["提高 12,345.0"])
  })

  it("title 也可以是函数", () => {
    const got = fold({ title: () => "动态标题", data: { dmg: 10 } })
    expect(got.msg).toEqual(["动态标题"])
  })

  it("敌人相关的键落到 enemy 盒子", () => {
    const def = fold({ title: "减防 [enemyDef]", data: { enemyDef: 20 } })
    // enemy 盒子的三项都从 0 起，敌人属性不来自面板
    expect((def.attr["enemy"] as { def: number }).def).toBe(20)
    const ign = fold({ title: "无视 [enemyIgnore]", data: { enemyIgnore: 15 } })
    expect((ign.attr["enemy"] as { ignore: number }).ignore).toBe(15)
  })

  it("反应键直接累加到同名字段", () => {
    const got = fold({ title: "蒸发 [vaporize]", data: { vaporize: 15 } })
    expect(got.attr["vaporize"]).toBe(15)
  })

  it("星扩散一族也在可累加之列 —— 漏收会让圣遗物与武器给的那份加成静默丢掉", () => {
    // 新版元数据的四类武器表、圣遗物表与两个角色都写了这两个键
    const swirl = fold({ title: "星扩散 [stellarSwirl]", data: { stellarSwirl: 40 } })
    expect(swirl.attr["stellarSwirl"]).toBe(40)
    const vortex = fold({ title: "冰旋 [stellarVortex]", data: { stellarVortex: 20 } })
    expect(vortex.attr["stellarVortex"]).toBe(20)
  })

  it("精通型 buff 的数值由当前精通现算，不是写死的", () => {
    const got = fold({ title: "蒸发提高[_vaporize]%", mastery: "vaporize" })
    // 精通 300（base 200 + 反应无关的 plus 100 不在此处），按 25/9 那条算
    expect(got.msg[0]).toMatch(/^蒸发提高\d/)
  })

  it("激化型另给一个伤害值，故文案里有两个占位符", () => {
    const got = fold({
      title: "超激化提高[_aggravate]%，伤害值提升[_aggravatenum]",
      mastery: "aggravate"
    })
    expect(got.msg[0]).not.toContain("[_aggravate]")
    expect(got.msg[0]).not.toContain("[_aggravatenum]")
  })

  it("incAttr / reduceAttr 按词条元数据加减一档，供词条收益对比", () => {
    const got = calcDmgAttr({
      base: base("gs"),
      buffs: [],
      meta: { level: 90, cons: 6, trees: {} },
      artis: {},
      game: "gs",
      attrMap: { cpct: { calc: "plus", value: 3.3 } },
      incAttr: "cpct"
    })
    // 面板暴击率落在 base 上，plus 从 0 起，故加一档即 3.3
    expect((got.attr["cpct"] as { plus: number }).plus).toBeCloseTo(3.3, 10)
  })
})

describe("数据集", () => {
  it("把属性表、meta 与参数并成一个对象，另带 calc 求值函数", () => {
    const ds = dataSet(base("gs"), { level: 90, cons: 6 }, { foo: 1 })
    expect(ds.level).toBe(90)
    expect(ds.params["foo"]).toBe(1)
    expect(ds.calc({ base: 100, plus: 10, pct: 50 })).toBe(160)
  })
})

describe("伤害公式", () => {
  /** 一份够用的计算入参 */
  const input = (game: "gs" | "sr" = "gs", over: Record<string, unknown> = {}) => ({
    attr: base(game),
    level: game === "gs" ? 90 : 80,
    enemyLv: 90,
    game,
    ...over
  })

  it("暴击率钳在 0~1 之间 —— 不钳则堆到 120% 的角色期望伤害虚高", () => {
    const attr = base("gs")
    ;(attr["cpct"] as { plus: number }).plus = 200
    const got = calcRet({ pctNum: 100 }, { ...input(), attr })
    // 钳到 1 之后期望等于必定暴击
    expect(got.avg).toBeCloseTo(got.dmg ?? 0, 6)
  })

  it("暴击率为 0 时爆伤一并归零", () => {
    const attr = base("gs")
    ;(attr["cpct"] as { base: number; plus: number }).base = 0
    ;(attr["cpct"] as { plus: number }).plus = -100
    const got = calcRet({ pctNum: 100 }, { ...input(), attr })
    // 爆伤归零后两者相等
    expect(got.avg).toBeCloseTo(got.dmg ?? 0, 6)
  })

  it("易伤区只对星铁生效 —— 原神堆承受伤害提高不改变结果", () => {
    /**
     * 加一档承受伤害提高，看伤害变不变
     * @param game 游戏
     * @returns 加成前后的期望伤害
     */
    const withEnemyDmg = (game: "gs" | "sr"): { before: number; after: number } => {
      // 两侧都显式给一个归零的易伤盒子再比：原神验的是"就算字段在也不读它"，星铁从 0 起算
      // 才使比率恰好是 1.25 而不受基准表里那 10% 的干扰
      const plain = base(game)
      plain["enemydmg"] = { base: 0, plus: 0, pct: 0, inc: 0 }
      const before = calcRet({ pctNum: 100 }, { ...input(game), attr: plain }).avg
      const boosted = base(game)
      boosted["enemydmg"] = { base: 0, plus: 25, pct: 0, inc: 0 }
      const after = calcRet({ pctNum: 100 }, { ...input(game), attr: boosted }).avg
      return { before, after }
    }

    // 原神没有易伤区，故这一档加成对结果毫无影响
    const gs = withEnemyDmg("gs")
    expect(gs.after).toBeCloseTo(gs.before, 6)
    // 星铁有，25% 承受伤害提高即伤害乘 1.25
    const sr = withEnemyDmg("sr")
    expect(sr.after / sr.before).toBeCloseTo(1.25, 6)
  })

  it("抗性区分三段，分界在 75 与 0", () => {
    /**
     * 按给定的抗性降低取期望伤害；抗性系数是连乘里的一个因子，故用两次结果之比验分段
     * @param kx 抗性降低
     * @returns 期望伤害
     */
    const dmgAt = (kx: number): number => {
      const attr = base("gs")
      attr["kx"] = kx
      return calcRet({ pctNum: 100 }, { ...input(), attr }).avg
    }

    // 基准：kx=0 → 抗性 10 → 系数 0.9
    const at0 = dmgAt(0)
    // kx=10 → 抗性 0 → (100-0)/100 = 1
    expect(dmgAt(10) / at0).toBeCloseTo(1 / 0.9, 6)
    // kx=-90 → 抗性 100，落在 ≥75 那一段 → 1/(1+3×1) = 0.25
    expect(dmgAt(-90) / at0).toBeCloseTo(0.25 / 0.9, 6)
    // kx=30 → 抗性 -20，落在负抗那一段 → 1+20/200 = 1.1
    expect(dmgAt(30) / at0).toBeCloseTo(1.1 / 0.9, 6)
  })

  it("mode=basic 时技能倍率被忽略", () => {
    const withPct = calcRet({ pctNum: 500, basicNum: 1000, mode: "basic" }, input())
    const noPct = calcRet({ pctNum: 0, basicNum: 1000, mode: "basic" }, input())
    // 倍率无论多大都不参与，两者应逐位相等
    expect(withPct.avg).toBeCloseTo(noPct.avg, 6)
    expect(withPct.dmg ?? 0).toBeCloseTo(noPct.dmg ?? 0, 6)
    // 而 talent 模式下倍率是要算进去的，否则这条断言就没有意义
    const talent = calcRet({ pctNum: 500, basicNum: 1000, mode: "talent" }, input())
    expect(talent.avg).not.toBeCloseTo(noPct.avg, 6)
  })

  it("剧变反应只给期望值，没有暴击值", () => {
    const got = calcRet({ ele: "overloaded" }, input())
    expect(got.avg).toBeGreaterThan(0)
    expect(got.dmg).toBeUndefined()
  })

  it("增幅反应两个值都有，且期望低于必定暴击", () => {
    const got = calcRet({ pctNum: 200, ele: "vaporize" }, input())
    expect(got.dmg).toBeGreaterThan(got.avg)
  })

  it("激化反应把反应基数加进伤害基数，而非乘上去", () => {
    const plain = calcRet({ pctNum: 200 }, input())
    const agg = calcRet({ pctNum: 200, ele: "aggravate" }, input())
    expect(agg.avg).toBeGreaterThan(plain.avg)
  })

  it("结晶护盾走护盾公式，与伤害无关", () => {
    const got = calcRet({ ele: "crystallize" }, input())
    expect(got.avg).toBeGreaterThan(0)
    expect(got.dmg).toBeUndefined()
  })

  it("星铁的击破伤害吃击破特攻", () => {
    const attr = base("sr")
    const low = calcRet({ ele: "fireBreak" }, { ...input("sr"), attr })
    ;(attr["stance"] as { plus: number }).plus = 100
    const high = calcRet({ ele: "fireBreak" }, { ...input("sr"), attr })
    expect(high.avg).toBeGreaterThan(low.avg)
  })

  it("星铁的敌方承受爆伤与己方爆伤同区叠加", () => {
    const attr = base("sr")
    const before = calcRet({ pctNum: 100 }, { ...input("sr"), attr })
    attr["enemyCdmg"] = 50
    const after = calcRet({ pctNum: 100 }, { ...input("sr"), attr })
    expect(after.avg).toBeGreaterThan(before.avg)
  })

  it("dmgFn 的中文反应名会译回键", () => {
    const fn = getDmgFn({ attr: base("gs"), level: 90, enemyLv: 90, game: "gs" })
    const byName = fn(200, false, "蒸发")
    const byKey = fn(200, false, "vaporize")
    expect(byName.avg).toBeCloseTo(byKey.avg, 10)
  })

  it("星铁的倍率是小数，dmgFn 代为乘 100", () => {
    const srFn = getDmgFn({ attr: base("sr"), level: 80, enemyLv: 90, game: "sr" })
    const a = srFn(1.5)
    const raw = calcRet({ pctNum: 150 }, { attr: base("sr"), level: 80, enemyLv: 90, game: "sr" })
    expect(a.avg).toBeCloseTo(raw.avg, 6)
  })

  it("治疗与护盾各走自己的公式", () => {
    const fn = getDmgFn({ attr: base("gs"), level: 90, enemyLv: 90, game: "gs" })
    // 治疗加成 10%
    expect(fn.heal(1000).avg).toBeCloseTo(1100, 6)
    // 护盾：基数 100、吸收 100%
    expect(fn.shield(1000).avg).toBeCloseTo(1000, 6)
  })

  it("持续伤害不吃暴击", () => {
    const fn = getDmgFn({ attr: base("sr"), level: 80, enemyLv: 90, game: "sr" })
    const got = fn.reaction("burn")
    expect(got.dmg).toBeUndefined()
  })
})

describe("buff 表", () => {
  it("精炼档位是等差六档，缺省步长为起始值的四分之一", () => {
    expect(stepValues(20)).toEqual([20, 25, 30, 35, 40, 45])
    expect(stepValues(16, 4)).toEqual([16, 20, 24, 28, 32, 36])
  })

  it("静态属性 buff 的占位符是字面量 [key]，不是键名", () => {
    // 占位符写死为 `[key]`，改成键名会让每条武器 buff 的文案都变样
    expect(staticAttrBuff("cdmg", 20).title).toBe("cdmg提高[key]")
  })

  it("字符串形态的反应名展开成对象，并落在 sort 9", () => {
    const [one] = normalizeBuffs(["vaporize"])
    expect(one?.mastery).toBe("vaporize")
    expect(one?.sort).toBe(9)
  })

  it("空项被丢掉，缺 sort 的补 1", () => {
    const got = normalizeBuffs([false, null, undefined, { title: "甲" }])
    expect(got).toHaveLength(1)
    expect(got[0]?.sort).toBe(1)
  })

  it("按 sort 升序稳定排序 —— 同序号者保持原顺序", () => {
    const got = normalizeBuffs([
      { title: "后", sort: 9 },
      { title: "甲", sort: 1 },
      { title: "乙", sort: 1 }
    ])
    expect(got.map(it => it.title)).toEqual(["甲", "乙", "后"])
  })

  it("武器 buff 表里值为 false 即这把武器没有 buff", () => {
    expect(weaponBuffsOf("某把没有 buff 的", { "某把没有 buff 的": false })).toEqual([])
  })

  it("武器 buff 可以是单个对象或数组，两种都要认", () => {
    expect(weaponBuffsOf("甲", { 甲: { title: "一条" } })).toHaveLength(1)
    expect(weaponBuffsOf("乙", { 乙: [{ title: "一" }, { title: "二" }] })).toHaveLength(2)
  })

  it("静态条目不进伤害计算 —— 它们已计入面板属性", () => {
    const got = weaponBuffsOf("甲", { 甲: [{ title: "静态", isStatic: true }, { title: "动态" }] })
    expect(got).toHaveLength(1)
    // 非静态 buff 的标题加武器名前缀，与套装 buff 同理
    expect(got[0]?.title).toBe("甲：动态")
  })

  it("标题已含全角冒号时不再加武器名前缀", () => {
    const got = weaponBuffsOf("甲", { 甲: { title: "别处：已有前缀" } })
    expect(got[0]?.title).toBe("别处：已有前缀")
  })

  it("refine 精炼档展开进 data —— calcDmgAttr 只读 data，不展开 refine 的加成整条会丢", () => {
    // 雾切之回光式：refine.dmg = 逐档数组，精一取下标 0
    const got = weaponBuffsOf("雾切", { 雾切: { title: "满层获得伤害加成[dmg]%", refine: { dmg: [28, 35, 42, 49, 56] } } })
    expect(got).toHaveLength(1)
    const data = (got[0] as { data?: Record<string, unknown> }).data ?? {}
    const fn = data["dmg"] as (ds: { refine?: number }) => number
    expect(typeof fn).toBe("function")
    expect(fn({ refine: 0 })).toBe(28)
    expect(fn({ refine: 4 })).toBe(56)
  })

  it("refine 展开乘 buffCount —— 千岩长枪一类满队层数", () => {
    const got = weaponBuffsOf("千岩", { 千岩: { title: "[atkPct]%攻击力", buffCount: 4, refine: { atkPct: [7, 8, 9, 10, 11] } } })
    const data = (got[0] as { data?: Record<string, unknown> }).data ?? {}
    const fn = data["atkPct"] as (ds: { refine?: number }) => number
    expect(fn({ refine: 0 })).toBe(28)
    expect(fn({ refine: 4 })).toBe(44)
  })
})

describe("星铁武器 buff 的三种形态", () => {
  /** 一把光锥的数值表，两行各五个精炼档 */
  const DETAIL = { skill: { tables: { "1": [8, 10, 12, 14, 16], "2": [12, 15, 18, 21, 24] } } }

  it("按精炼档把 tables 收口成「行号 → 该档的值」", () => {
    // 精炼 1 起，故精三取下标 2
    expect(weaponTablesAt(DETAIL, 3)).toEqual({ "1": 12, "2": 18 })
    expect(weaponTablesAt(DETAIL, 1)).toEqual({ "1": 8, "2": 12 })
  })

  it("**叠影缺失时整表取不到值，不回落成精一** —— 星铁不送初始光锥，真机存档里确有没记叠影的", () => {
    // 回落成精一会凭空多给一档加成（彦卿配残泪即此，伤害偏高 3.5%~9%）
    expect(weaponTablesAt(DETAIL, undefined)).toEqual({})
    expect(weaponTablesAt(DETAIL, 0)).toEqual({})
    expect(weaponTablesAt(DETAIL, 1)).toEqual({ "1": 8, "2": 12 })
  })

  it("没有 skill.tables 的武器给空表，不抛错", () => {
    expect(weaponTablesAt(undefined, 3)).toEqual({})
    expect(weaponTablesAt({ skill: {} }, 3)).toEqual({})
  })

  it("staticIdx 造的条目一律静态 —— 那份加成已由属性层加过，再加就是加倍", () => {
    const got = staticIdxBuff(1, "recharge") as { isStatic?: boolean; idx?: number; key?: string }
    expect(got.isStatic).toBe(true)
    expect(got.idx).toBe(1)
    expect(got.key).toBe("recharge")
    // 静态的进不了伤害计算
    expect(weaponBuffsOf("甲", { 甲: [staticIdxBuff(1, "recharge")] }, { "1": 8 })).toEqual([])
  })

  it("keyIdx 的 idx/key 形态展开成 data —— 数值取自该精炼档那一行", () => {
    const table = { 甲: keyIdxBuff("终结技治疗量提高[qHeal]%", "qHeal", 2) }
    const got = weaponBuffsOf("甲", table, weaponTablesAt(DETAIL, 3))
    expect(got).toHaveLength(1)
    const one = got[0] as { title?: string; data?: Record<string, unknown>; idx?: unknown; key?: unknown }
    expect(one.data?.["qHeal"]).toBe(18)
    // 展开后不该再留着 idx / key，否则下游会当成未展开的条目
    expect(one.idx).toBeUndefined()
    expect(one.key).toBeUndefined()
    expect(one.title).toBe("甲：终结技治疗量提高[qHeal]%")
  })

  it("keyIdx 收对象时返回函数 —— 一条 buff 摊多个词条，要先喂 tables", () => {
    const made = keyIdxBuff("治疗量提高[heal]%、充能提高[recharge]%", { heal: 1, recharge: 2 })
    expect(typeof made).toBe("function")
    const got = weaponBuffsOf("甲", { 甲: made }, weaponTablesAt(DETAIL, 5))
    expect(got).toHaveLength(1)
    const data = (got[0] as { data?: Record<string, unknown> }).data ?? {}
    expect(data["heal"]).toBe(16)
    expect(data["recharge"]).toBe(24)
  })

  it("那一行取不到数时整条跳过 —— 往 data 里塞 undefined 会让那条加成算成 NaN", () => {
    // 公式写了第 9 行，而这把光锥只有两行
    const got = weaponBuffsOf("甲", { 甲: keyIdxBuff("[x]", "x", 9) }, weaponTablesAt(DETAIL, 3))
    const data = (got[0] as { data?: Record<string, unknown> }).data ?? {}
    expect(data["x"]).toBeUndefined()
  })
})
