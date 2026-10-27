/**
 * 模块职责：Enka 绝区零属性计算的测试
 * 依赖方向：测试文件，喂真机核对过的数值
 * 生命周期：无状态
 * 注意事项：**关键在"拿米游社给的成品值交叉核对自己算的"** —— 米游社面板直接给算好的属性，Enka
 *          只给原始档位要自己算，两条源口径一致，故用米游社面板的真值当基准。`charBaseMap` 里
 *          `atk` 含核心技数值加成、不含音擎（雅 1623 = 805 角色 + 743 音擎 + 75 核心技 →
 *          charBaseMap 得 880）。
 */
import { describe, expect, it } from "vitest"
import { computeZzzPanel } from "./enka-zzz.js"
import { charBaseMap } from "../zzz/attr.js"
import type { MetaLoader } from "../../meta/loader.js"

/** 雅（1091）data.json 的基础数据块，取自真实元数据 */
const MIYABI = {
  attr: {
    attack: 127,
    attack_growth: 76728,
    break_stun: 86,
    crit: 500,
    crit_damage: 5000,
    defence: 49,
    defence_growth: 66203,
    element_abnormal_power: 116,
    element_mystery: 148,
    hp_growth: 837238,
    hp_max: 617,
    sp_recover: 120
  },
  promote: {
    "1": { hp_max: 0, attack: 0, defence: 0, level_min: 0 },
    "2": { hp_max: 423, attack: 45, defence: 33, level_min: 10 },
    "3": { hp_max: 847, attack: 90, defence: 67, level_min: 20 },
    "4": { hp_max: 1270, attack: 136, defence: 100, level_min: 30 },
    "5": { hp_max: 1694, attack: 181, defence: 134, level_min: 40 },
    "6": { hp_max: 2117, attack: 226, defence: 167, level_min: 50 }
  },
  core: {
    "6": { add: { 基础攻击力: "75", 异常精通: "90" } }
  }
}

describe("charBaseMap 拿雅的真实数据交叉核对", () => {
  it("lv60 满突破满核心技：hp/atk/def 与米游社面板逐字对上", () => {
    const base = charBaseMap(MIYABI, 60, "6")
    // 米游社面板：雅 hp base 7673、def base 606（不受音擎影响）
    expect(Math.trunc(base[111]!)).toBe(7673)
    expect(Math.trunc(base[131]!)).toBe(606)
    // atk：角色 805（=baseAttr）+ 核心技 75 = 880；米游社那 1623 里另有音擎 743
    expect(Math.trunc(base[121]!)).toBe(880)
    // 异常精通（ap=312）：148 + 核心技 90 = 238
    expect(Math.trunc(base[312]!)).toBe(238)
    // 冲击力（122）与暴击率（201，除 100）
    expect(base[122]).toBe(86)
    expect(base[201]).toBeCloseTo(5, 5)
    expect(base[211]).toBeCloseTo(50, 5)
  })

  it("等级越低突破阶越低：lv50 取 promote[5]", () => {
    const base = charBaseMap(MIYABI, 50, "6")
    // lv50：617 + 837238×49/10000 + promote[5].hp_max(1694)
    expect(Math.trunc(base[111]!)).toBe(617 + Math.trunc((837238 * 49) / 10000) + 1694 - 1 + 1)
    // 更稳的断言：与手算一致（±1）
    const expectHp = 617 + (837238 * 49) / 10000 + 1694
    expect(Math.abs(base[111]! - expectHp)).toBeLessThan(0.001)
  })

  it("核心技档不同，atk 的核心技那一份随之变", () => {
    // 没有 core["1"] 数据时不加核心技（缺档按 0）
    const noCoreTable = { ...MIYABI, core: {} }
    const base = charBaseMap(noCoreTable, 60, "6")
    // 只有角色 805，没有 +75
    expect(Math.trunc(base[121]!)).toBe(805)
  })
})

describe("computeZzzPanel 音擎主副属性（合成安比拘缚者的真值档位）", () => {
  // 安比拘缚者 14114：base 46、lv60 levelRate 94090、break5 star_rate 44606 → 主 684；
  // 副 720（冲击力%）、break5 rand_rate 15000 → 18%
  const WEAPON = {
    base: { name: "基础攻击力", value: 46 },
    sub: { name: "冲击力", value: 720, pct: true },
    levelRate: (() => {
      const arr: number[] = []
      arr[60] = 94090
      return arr
    })(),
    stars: { "5": { star_rate: 44606, rand_rate: 15000 } }
  }
  // 安比（1011）基础数据（lv50、击破）；只列算 atk/hp/def 要用的
  const ANBY = {
    attr: {
      attack: 100,
      attack_growth: 70000,
      defence: 49,
      defence_growth: 55000,
      hp_max: 600,
      hp_growth: 700000,
      break_stun: 90,
      crit: 500,
      crit_damage: 5000,
      element_abnormal_power: 90,
      element_mystery: 90
    },
    promote: { "1": { level_min: 0 }, "5": { hp_max: 1600, attack: 180, defence: 130, level_min: 40 } },
    core: { "5": { add: { 基础攻击力: "50" } } }
  }

  /** 只实现本测试要用到的两个方法的假装载器 */
  const fakeMeta = {
    byId: (_g: string, id: string | number) =>
      String(id) === "14114" ? { id: "14114", name: "拘缚者", star: 4 } : undefined,
    detail: () => undefined,
    pathOf: () => "",
    exists: () => false
  } as unknown as MetaLoader

  it("音擎主属性 684、副属性 18% —— 突破阶按等级推 5", () => {
    const avatar = {
      Id: 1011,
      Level: 50,
      CoreSkillEnhancement: 5,
      Weapon: { Id: 14114, Level: 60, UpgradeLevel: 1 },
      EquippedList: []
    }
    const { weapon } = computeZzzPanel(avatar, ANBY, WEAPON, fakeMeta, 203)
    expect(weapon?.main?.value).toBe("684")
    expect(weapon?.sub?.value).toBe("18.0%")
    // 叠影取 UpgradeLevel
    expect(weapon?.star).toBe(1)
  })

  it("**整十级突破前后同级，突破阶取 BreakLevel**：lv50 已突破查 stars[5] 而非按等级推的 4", () => {
    const w50 = {
      ...WEAPON,
      levelRate: (() => {
        const arr: number[] = []
        arr[50] = 70000
        return arr
      })(),
      stars: { "4": { star_rate: 30000, rand_rate: 10000 }, "5": { star_rate: 44606, rand_rate: 15000 } }
    }
    const avatar = (brk?: number) => ({
      Id: 1011,
      Level: 50,
      Weapon: { Id: 14114, Level: 50, UpgradeLevel: 1, ...(brk === undefined ? {} : { BreakLevel: brk }) },
      EquippedList: []
    })
    // 46×(1+(70000+44606)/10000)=573；720×(1+15000/10000)/100=18
    const broken = computeZzzPanel(avatar(5), ANBY, w50, fakeMeta, 203).weapon
    expect(broken?.main?.value).toBe("573")
    expect(broken?.sub?.value).toBe("18.0%")
    // 缺 BreakLevel 时退回按等级推：46×11=506；720×2/100=14.4
    const inferred = computeZzzPanel(avatar(), ANBY, w50, fakeMeta, 203).weapon
    expect(inferred?.main?.value).toBe("506")
    expect(inferred?.sub?.value).toBe("14.4%")
  })

  it("音擎主属性并入 atk 基础：角色+核心技+音擎", () => {
    const avatar = {
      Id: 1011,
      Level: 50,
      CoreSkillEnhancement: 5,
      Weapon: { Id: 14114, Level: 60, UpgradeLevel: 1 },
      EquippedList: []
    }
    const { attrs } = computeZzzPanel(avatar, ANBY, WEAPON, fakeMeta, 203)
    const atk = attrs.find(a => a.key === "atk")
    // 角色 atk(100 + 70000×49/10000 + promote5 180) = 623 + 核心技 50 + 音擎 684
    const charAtk = 100 + (70000 * 49) / 10000 + 180
    expect(atk?.base).toBe(String(Math.trunc(charAtk + 50 + 684)))
  })
})

/*
 * 以下几条钉的是"值的形态"，数值取自同一批装备的两份数据
 * （Enka 的原始档位 + 米游社的成品值）。
 *
 * 判错的共同表现是**数量级错**而不是差一点：判错一处，面板上就是「攻击力 6075」
 * 或「暴击率 2429%」。故每一条都用米游社的成品值作基准逐字对。
 */
describe("装备词条的形态判定", () => {
  /** 只认套装 id 的假装载器；驱动盘那几条用不到别的 */
  const discMeta = {
    byId: () => undefined,
    detail: () => undefined,
    pathOf: () => "",
    exists: () => false
  } as unknown as MetaLoader

  /** 一位不带音擎的最简代理人基础数据，属性栏只看驱动盘那部分 */
  const PLAIN = {
    attr: { attack: 100, attack_growth: 0, defence: 0, defence_growth: 0, hp_max: 1000, hp_growth: 0 },
    promote: { "1": { level_min: 0 } },
    core: {}
  }

  /**
   * 造一件驱动盘
   * @param id 驱动盘 id，第四位是稀有度
   * @param main 主词条
   * @param subs 副词条
   * @returns Enka 形态的一件驱动盘
   */
  const disc = (
    id: number,
    main: { PropertyId: number; PropertyValue: number },
    subs: { PropertyId: number; PropertyValue: number; PropertyLevel: number }[] = []
  ) => ({
    Slot: 1,
    Equipment: {
      Id: id,
      Level: 15,
      MainPropertyList: [{ ...main, PropertyLevel: 1 }],
      RandomPropertyList: subs
    }
  })

  it("主词条按稀有度与等级成长：S 盘 Lv15 是四倍", () => {
    // 真机：11103 Value=550 的 S 盘满级，米游社印「生命值 2200」
    const { discs } = computeZzzPanel(
      { Id: 1431, Level: 60, EquippedList: [disc(33541, { PropertyId: 11103, PropertyValue: 550 })] },
      PLAIN,
      undefined,
      discMeta,
      200
    )
    expect(discs[0]?.main?.value).toBe("2200")
  })

  it("**同一个三位编号的两种形态靠末两位分**：12102 是百分比、12103 是数值", () => {
    const { discs } = computeZzzPanel(
      {
        Id: 1431,
        Level: 60,
        EquippedList: [
          disc(33541, { PropertyId: 11103, PropertyValue: 550 }, [
            // 真机：米游社印「攻击力 6% ×2」
            { PropertyId: 12102, PropertyValue: 300, PropertyLevel: 2 },
            // 真机：米游社印「攻击力 57 ×3」
            { PropertyId: 12103, PropertyValue: 19, PropertyLevel: 3 }
          ])
        ]
      },
      PLAIN,
      undefined,
      discMeta,
      200
    )
    const subs = discs[0]?.subs ?? []
    expect(subs[0]?.value).toBe("6.0%")
    expect(subs[1]?.value).toBe("57")
  })

  it("暴击率一族末两位写作 03 却仍是百分比 —— 只看末两位会印成 480%", () => {
    const { discs } = computeZzzPanel(
      {
        Id: 1431,
        Level: 60,
        EquippedList: [
          disc(33541, { PropertyId: 11103, PropertyValue: 550 }, [
            // 真机：米游社印「暴击伤害 14.4% ×3」
            { PropertyId: 21103, PropertyValue: 480, PropertyLevel: 3 },
            // 真机：米游社印「暴击率 4.8% ×2」
            { PropertyId: 20103, PropertyValue: 240, PropertyLevel: 2 }
          ])
        ]
      },
      PLAIN,
      undefined,
      discMeta,
      200
    )
    const subs = discs[0]?.subs ?? []
    expect(subs[0]?.value).toBe("14.4%")
    expect(subs[1]?.value).toBe("4.8%")
  })

  it("异常精通那一族是整数：末两位 03 且三位编号不在百分比族里", () => {
    const { discs } = computeZzzPanel(
      {
        Id: 1431,
        Level: 60,
        EquippedList: [
          disc(33541, { PropertyId: 11103, PropertyValue: 550 }, [
            // 真机：米游社印「异常精通 18 ×2」
            { PropertyId: 31203, PropertyValue: 9, PropertyLevel: 2 }
          ])
        ]
      },
      PLAIN,
      undefined,
      discMeta,
      200
    )
    expect(discs[0]?.subs[0]?.value).toBe("18")
  })

  it("**百分比副词条乘基础而非直接加**：攻击力 +6% 不是 +6 点", () => {
    const { attrs } = computeZzzPanel(
      {
        Id: 1431,
        Level: 60,
        EquippedList: [
          disc(33541, { PropertyId: 11103, PropertyValue: 550 }, [
            { PropertyId: 12102, PropertyValue: 300, PropertyLevel: 2 }
          ])
        ]
      },
      PLAIN,
      undefined,
      discMeta,
      200
    )
    const atk = attrs.find(a => a.key === "atk")
    // 基础 100，+6% → 加成 6、总 106
    expect(atk?.base).toBe("100")
    expect(atk?.add).toBe("6")
    expect(atk?.final).toBe("106")
  })
})

describe("音擎副属性的形态", () => {
  const noMeta = {
    byId: () => undefined,
    detail: () => undefined,
    pathOf: () => "",
    exists: () => false
  } as unknown as MetaLoader

  const PLAIN = {
    attr: { attack: 100, attack_growth: 0, defence: 0, defence_growth: 0, hp_max: 1000, hp_growth: 0, sp_recover: 120 },
    promote: { "1": { level_min: 0 } },
    core: {}
  }

  /** 满突破那一档的成长率，真实元数据里每把音擎都是这一份 */
  const STARS = { "5": { star_rate: 44610, rand_rate: 15000 } }

  it("**副属性恒百分比、且存的是放大一百倍的值**：960 → 24%", () => {
    // 真机：钢铁肉垫 sub={name:"暴击率",value:960}，米游社印「暴击率 24%」
    const weapon = {
      base: { name: "基础攻击力", value: 46 },
      sub: { name: "暴击率", value: 960 },
      stars: STARS
    }
    const { weapon: got } = computeZzzPanel(
      { Id: 1431, Level: 60, Weapon: { Id: 14102, Level: 60, UpgradeLevel: 1 }, EquippedList: [] },
      PLAIN,
      weapon,
      noMeta,
      200
    )
    expect(got?.sub?.value).toBe("24.0%")
  })

  it("「攻击力百分比」这种写法也要认得 —— 收不到就整条丢掉且毫无迹象", () => {
    // 真机：幻变魔方 sub={name:"攻击力百分比",value:1000}，米游社印「攻击力 25%」
    const weapon = {
      base: { name: "基础攻击力", value: 40 },
      sub: { name: "攻击力百分比", value: 1000 },
      stars: STARS
    }
    const { weapon: got, attrs } = computeZzzPanel(
      { Id: 1431, Level: 60, Weapon: { Id: 13012, Level: 60, UpgradeLevel: 1 }, EquippedList: [] },
      PLAIN,
      weapon,
      noMeta,
      200
    )
    expect(got?.sub?.value).toBe("25.0%")
    // 并且真的乘进了攻击力：基础 100 + 音擎主属性，加成是那 25%
    const atk = attrs.find(a => a.key === "atk")
    expect(atk?.add).not.toBe("0")
  })
})

describe("核心技加成里那几项 ×100 系属性", () => {
  it("**能量自动回复的核心技加成要除 100**：24 是 0.24 而不是 24", () => {
    // 真机：耀嘉音核心技档 3 给「基础能量自动回复: 24」，米游社最终印 1.94
    const char = {
      attr: { attack: 100, attack_growth: 0, defence: 0, defence_growth: 0, hp_max: 1000, hp_growth: 0, sp_recover: 120 },
      promote: { "1": { level_min: 0 } },
      core: { "3": { add: { 基础能量自动回复: "24" } } }
    }
    const base = charBaseMap(char, 60, "3")
    // 基础 1.20 + 核心技 0.24 = 1.44
    expect(base[305]).toBeCloseTo(1.44, 5)
  })

  it("不是 ×100 系的那些照原样加：异常精通 +90 就是 90", () => {
    const base = charBaseMap(MIYABI, 60, "6")
    expect(Math.trunc(base[312]!)).toBe(238)
  })
})
