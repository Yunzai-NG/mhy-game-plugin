/**
 * 模块职责：养成计算与尘歌壶模数视图层的测试
 * 依赖方向：测试文件，只依赖 views/calculator（纯函数，不发请求）
 * 生命周期：无状态
 * 注意事项：固定四项口径：参数超上限是压回上限而非报错、少给几个合法而多给才错、三星以下武器的
 *          目标等级压到 70、星铁必须先丢掉 `coin_id`（那一栏是数字而非数组，混进来会摊出一堆空
 *          条目）。
 */
import { describe, expect, it } from "vitest"
import {
  blueprintBody,
  blueprintText,
  buildBlueprint,
  buildCalculator,
  calcLevels,
  calcNameOf,
  calcNum,
  calculatorText,
  flattenGsConsume,
  flattenSrConsume,
  gsCalcBody,
  gsSkillViews,
  srCalcBody,
  srSkillViews,
  weaponTargetOf
} from "./calculator.js"

describe("calcNameOf", () => {
  it("剥掉触发词、数字与分隔符，剩下的就是名字", () => {
    expect(calcNameOf("刻晴养成81 90 9 9 9")).toBe("刻晴")
    expect(calcNameOf("克拉拉养成75,80,6,9,9,9")).toBe("克拉拉")
    expect(calcNameOf("胡桃计算")).toBe("胡桃")
  })

  it("认「喵喵」前缀与残留的游戏名", () => {
    expect(calcNameOf("喵喵刻晴养成")).toBe("刻晴")
    expect(calcNameOf("星铁克拉拉养成")).toBe("克拉拉")
  })

  it("什么都没剩时给空串 —— 那是求帮助", () => {
    expect(calcNameOf("养成计算")).toBe("")
  })
})

describe("calcLevels", () => {
  it("不带参数就是练满", () => {
    expect(calcLevels("刻晴养成", "gs", "刻晴")).toEqual([90, 90, 10, 10, 10])
    expect(calcLevels("克拉拉养成", "sr", "克拉拉")).toEqual([80, 80, 6, 10, 10, 10, 6, 6])
  })

  it("少给几个是合法的，后面的取缺省", () => {
    expect(calcLevels("刻晴养成81 90 9", "gs", "刻晴")).toEqual([81, 90, 9, 10, 10])
  })

  it("全角逗号与空格都认", () => {
    expect(calcLevels("刻晴养成81，90 9,9,9", "gs", "刻晴")).toEqual([81, 90, 9, 9, 9])
  })

  it("超出上限压回上限，而不是报一句参数有误", () => {
    expect(calcLevels("刻晴养成99 99 15 15 15", "gs", "刻晴")).toEqual([90, 90, 10, 10, 10])
  })

  it("给多了才是错的", () => {
    expect(calcLevels("刻晴养成1 2 3 4 5 6", "gs", "刻晴")).toBeUndefined()
  })

  it("星铁的八个参数按位对上", () => {
    expect(calcLevels("克拉拉养成75 80 6 9 9 9", "sr", "克拉拉")).toEqual([75, 80, 6, 9, 9, 9, 6, 6])
  })
})

describe("weaponTargetOf", () => {
  it("三星以下压到 70 —— 一二星武器的上限就是 70", () => {
    expect(weaponTargetOf([90, 90, 10, 10, 10], 2)[1]).toBe(70)
    expect(weaponTargetOf([90, 90, 10, 10, 10], 1)[1]).toBe(70)
  })

  it("三星及以上原样，没有武器时也原样", () => {
    expect(weaponTargetOf([90, 90, 10, 10, 10], 3)[1]).toBe(90)
    expect(weaponTargetOf([90, 88, 10, 10, 10])[1]).toBe(88)
  })

  it("不改原数组 —— 调用方还要用它算别的", () => {
    const levels = [90, 90, 10, 10, 10]
    weaponTargetOf(levels, 1)
    expect(levels[1]).toBe(90)
  })
})

/** 原神的三个可升技能，另附一个满级为 1 的被动 */
const GS_SKILLS = [
  { group_id: 4321, level_current: 3, max_level: 10, name: "云来剑法", icon: "https://x/a.png" },
  { group_id: 4322, level_current: 5, max_level: 10, name: "星斗归位", icon: "https://x/e.png" },
  { group_id: 4323, level_current: 1, max_level: 10, name: "天街巡游", icon: "https://x/q.png" }
]

describe("gsCalcBody", () => {
  it("只取前三个技能，且外层带 uid 与区服", () => {
    const body = gsCalcBody({
      id: "10000042",
      level: 80,
      levels: [90, 90, 10, 9, 8],
      skills: GS_SKILLS,
      uid: "100000001",
      server: "cn_gf01"
    })
    expect(body["uid"]).toBe("100000001")
    expect(body["region"]).toBe("cn_gf01")
    const item = (body["items"] as Record<string, unknown>[])[0]
    expect(item?.["avatar_level_current"]).toBe(80)
    expect(item?.["avatar_level_target"]).toBe(90)
    expect(item?.["skill_list"]).toEqual([
      { id: 4321, level_current: 3, level_target: 10 },
      { id: 4322, level_current: 5, level_target: 9 },
      { id: 4323, level_current: 1, level_target: 8 }
    ])
    // 没有已装备武器时不带 weapon 一节，带了空的会让接口报参数错误
    expect(item).not.toHaveProperty("weapon")
  })

  it("有武器时按第二个参数定目标", () => {
    const body = gsCalcBody({
      id: "10000042",
      level: 80,
      levels: [90, 70, 10, 10, 10],
      skills: GS_SKILLS,
      equip: { id: "11509", name: "磐岩结绿", star: 5, level: 20, icon: "" },
      uid: "100000001",
      server: "cn_gf01"
    })
    const item = (body["items"] as Record<string, unknown>[])[0]
    expect(item?.["weapon"]).toEqual({ id: 11509, level_current: 20, level_target: 70 })
  })

  it("国际服在内层也补一个 lang，不一并去重", () => {
    const body = gsCalcBody({
      id: "10000042",
      level: 1,
      levels: [90, 90, 10, 10, 10],
      skills: GS_SKILLS,
      uid: "600000001",
      server: "os_usa"
    })
    expect(body["lang"]).toBe("zh-cn")
    expect((body["items"] as Record<string, unknown>[])[0]?.["lang"]).toBe("zh-cn")
  })
})

/** 星铁的六条行迹，最后一条刻意不给 anchor */
const SR_SKILLS = [
  { point_id: 110701, cur_level: 1, max_level: 6, anchor: "Point01", item_url: "https://x/1.png" },
  { point_id: 110702, cur_level: 4, max_level: 10, anchor: "Point02", item_url: "https://x/2.png" },
  { point_id: 110703, cur_level: 4, max_level: 10, anchor: "Point03", item_url: "https://x/3.png" },
  { point_id: 110704, cur_level: 4, max_level: 10, anchor: "Point04", item_url: "https://x/4.png" },
  { point_id: 110705, cur_level: 1, max_level: 6, anchor: "Point19", item_url: "https://x/5.png" },
  { point_id: 110706, cur_level: 1, max_level: 6, target_level: 5, item_url: "https://x/6.png" }
]

describe("srCalcBody", () => {
  it("行迹按表内顺序对上第三个参数往后的那几个", () => {
    const body = srCalcBody({
      id: "1107",
      level: 70,
      levels: [80, 80, 6, 9, 9, 9, 6, 6],
      skills: SR_SKILLS,
      server: "prod_gf_cn"
    })
    expect(body["game"]).toBe("hkrpg")
    expect(body["avatar"]).toEqual({ item_id: 1107, cur_level: 70, target_level: 80 })
    const list = body["skill_list"] as Record<string, unknown>[]
    expect(list.map(one => one["target_level"])).toEqual([6, 9, 9, 9, 6, 6])
    expect(body).not.toHaveProperty("equipment")
  })

  it("参数对不上的那一条取接口自带的目标等级", () => {
    const body = srCalcBody({
      id: "1107",
      level: 70,
      // 只给到第五项，第六条行迹因此对不上
      levels: [80, 80, 6, 9, 9],
      skills: SR_SKILLS,
      server: "prod_gf_cn"
    })
    const list = body["skill_list"] as Record<string, unknown>[]
    expect(list[5]?.["target_level"]).toBe(5)
  })

  it("有光锥时带 equipment 一节", () => {
    const body = srCalcBody({
      id: "1107",
      level: 70,
      levels: [80, 75, 6, 9, 9, 9, 6, 6],
      skills: SR_SKILLS,
      equip: { id: "23015", name: "于夜色中", star: 5, level: 60, icon: "" },
      server: "prod_gf_cn"
    })
    expect(body["equipment"]).toEqual({ item_id: 23015, cur_level: 60, target_level: 75 })
  })
})

describe("calcNum", () => {
  it("超过一万折成 w，正好一万不折", () => {
    expect(calcNum(12345)).toBe("1.2 w")
    expect(calcNum(10000)).toBe("10000")
    expect(calcNum(9)).toBe("9")
  })

  it("认不出的一律算 0", () => {
    expect(calcNum(undefined)).toBe("0")
    expect(calcNum("x")).toBe("0")
  })
})

describe("flattenGsConsume", () => {
  it("摊两层，且带上还缺多少", () => {
    const out = flattenGsConsume({
      avatar_consume: [
        { consume: [{ name: "摩拉", icon: "https://x/m.png", num: 420000, lack_num: 0 }] },
        { consume: [{ name: "地脉的旧血", icon: "https://x/b.png", num: 18, lack_num: 6 }] }
      ]
    })
    expect(out["avatar_consume"]).toEqual([
      { name: "摩拉", icon: "https://x/m.png", num: "42.0 w", lack: "0" },
      { name: "地脉的旧血", icon: "https://x/b.png", num: "18", lack: "6" }
    ])
  })

  it("名字里带书名号的记作天赋书 —— 模板据它换色", () => {
    const out = flattenGsConsume({
      avatar_skill_consume: [{ consume: [{ name: "「繁荣」的哲学", icon: "", num: 6, lack_num: 6 }] }]
    })
    expect(out["avatar_skill_consume"]?.[0]?.isTalent).toBe(true)
  })

  it("接口没给这一栏时给空表，而不是抛错", () => {
    expect(flattenGsConsume(undefined)).toEqual({})
    expect(flattenGsConsume({ weapon_consume: [] })).toEqual({ weapon_consume: [] })
  })
})

describe("flattenSrConsume", () => {
  it("先丢掉 coin_id —— 那是个数字，摊出来全是空条目", () => {
    const out = flattenSrConsume({
      coin_id: 2,
      avatar_consume: [{ item_name: "信用点", item_url: "https://x/c.png", num: 200000 }]
    })
    expect(out).not.toHaveProperty("coin_id")
    expect(out["avatar_consume"]).toEqual([{ name: "信用点", icon: "https://x/c.png", num: "20.0 w" }])
  })

  it("不给「还缺多少」—— 星铁的接口本就没有这一栏", () => {
    const out = flattenSrConsume({ skill_consume: [{ item_name: "命运的足迹", item_url: "", num: 8 }] })
    expect(out["skill_consume"]?.[0]).not.toHaveProperty("lack")
  })
})

describe("gsSkillViews", () => {
  it("目标等级取第三个参数往后的那几个", () => {
    const out = gsSkillViews(GS_SKILLS, [90, 90, 10, 9, 8])
    expect(out.map(one => one.target)).toEqual([10, 9, 8])
    expect(out[0]?.name).toBe("云来剑法")
    expect(out[0]?.current).toBe(3)
    expect(out[0]?.max).toBe(10)
  })

  it("参数对不上时按「这一项不动」处理", () => {
    const out = gsSkillViews(GS_SKILLS, [90, 90, 10])
    expect(out[1]?.target).toBe(out[1]?.current)
  })
})

describe("srSkillViews", () => {
  it("展示名由 anchor 折算，认不出的一律叫天赋", () => {
    const out = srSkillViews(SR_SKILLS, [80, 80, 6, 9, 9, 9, 6, 6])
    expect(out.map(one => one.name)).toEqual(["普通攻击", "战技", "终结技", "天赋", "忆灵技", "天赋"])
    expect(out.map(one => one.target)).toEqual([6, 9, 9, 9, 6, 6])
  })
})

/** 一份原神的消耗清单 */
const GS_CONSUME = {
  avatar_consume: [{ name: "摩拉", icon: "", num: "42.0 w", lack: "0" }],
  avatar_skill_consume: [{ name: "「繁荣」的哲学", icon: "", num: "6", lack: "6", isTalent: true }],
  weapon_consume: [{ name: "白铁矿", icon: "", num: "9", lack: "9" }]
}

describe("buildCalculator", () => {
  it("原神按 avatar_skill_consume / weapon_consume 取，标题写天赋", () => {
    const view = buildCalculator({
      game: "gs",
      uid: "100000001",
      char: { name: "刻晴", face: "meta-gs/character/刻晴/imgs/face.webp", level: 80, target: 90, star: 5, cons: 2 },
      equip: { name: "磐岩结绿", icon: "", star: 5, level: 20, target: 90 },
      skills: gsSkillViews(GS_SKILLS, [90, 90, 10, 10, 10]),
      consume: GS_CONSUME
    })
    expect(view.skillTitle).toBe("天赋消耗")
    expect(view.skillConsume).toHaveLength(1)
    expect(view.equipConsume).toHaveLength(1)
    expect(view.done).toBe(false)
  })

  it("星铁按 skill_consume / equipment_consume 取，标题写行迹", () => {
    const view = buildCalculator({
      game: "sr",
      uid: "100000001",
      char: { name: "克拉拉", face: "meta-sr/character/克拉拉/imgs/face.webp", level: 70, target: 80, star: 5, cons: 0 },
      skills: srSkillViews(SR_SKILLS, [80, 80, 6, 9, 9, 9, 6, 6]),
      consume: {
        skill_consume: [{ name: "命运的足迹", icon: "", num: "8" }],
        equipment_consume: [{ name: "「毁灭」的开端", icon: "", num: "4" }]
      }
    })
    expect(view.skillTitle).toBe("行迹消耗")
    expect(view.skillConsume).toHaveLength(1)
    expect(view.equipConsume).toHaveLength(1)
    // 星铁没有已装备光锥时不给 equip 一栏
    expect(view.equip).toBeUndefined()
  })

  it("三节都空时记作毕业 —— 模板据它换成一句话", () => {
    const view = buildCalculator({
      game: "gs",
      uid: "100000001",
      char: { name: "刻晴", face: "", level: 90, target: 90, star: 5, cons: 6 },
      skills: [],
      consume: {}
    })
    expect(view.done).toBe(true)
    expect(view.avatarConsume).toEqual([])
  })
})

describe("calculatorText", () => {
  it("列出等级变化与三节消耗", () => {
    const view = buildCalculator({
      game: "gs",
      uid: "100000001",
      char: { name: "刻晴", face: "", level: 80, target: 90, star: 5, cons: 2 },
      equip: { name: "磐岩结绿", icon: "", star: 5, level: 20, target: 90 },
      skills: gsSkillViews(GS_SKILLS, [90, 90, 10, 10, 10]),
      consume: GS_CONSUME
    })
    const text = calculatorText(view)
    expect(text).toContain("刻晴 养成计算")
    expect(text).toContain("Lv.80 → Lv.90")
    expect(text).toContain("磐岩结绿")
    expect(text).toContain("【天赋消耗】")
    expect(text).toContain("「繁荣」的哲学 x 6（缺 6）")
    // 不缺的那一项不写括号
    expect(text).toContain("摩拉 x 42.0 w\n")
  })

  it("毕业时只说一句", () => {
    const view = buildCalculator({
      game: "sr",
      uid: "100000001",
      char: { name: "克拉拉", face: "", level: 80, target: 80, star: 5, cons: 0 },
      skills: [],
      consume: {}
    })
    expect(calculatorText(view)).toContain("毕业了")
  })
})

/** 一份尘歌壶模数详情 */
const BLUEPRINT = {
  list: [
    { id: 373301, name: "「郊郊有神」", num: 2, icon_url: "https://x/f1.png" },
    { id: 373302, name: "「石凳」", num: 8, icon_url: "https://x/f2.png" }
  ]
}

describe("blueprintBody", () => {
  it("只留 cnt 与 id 两栏", () => {
    expect(blueprintBody(BLUEPRINT)).toEqual({
      list: [
        { cnt: 2, id: 373301 },
        { cnt: 8, id: 373302 }
      ]
    })
  })

  it("一件模具都没有时 undefined —— 那时不该再发一次计算请求", () => {
    expect(blueprintBody({ list: [] })).toBeUndefined()
    expect(blueprintBody(undefined)).toBeUndefined()
  })
})

describe("buildBlueprint", () => {
  it("模具与消耗各成一节，数量不做万位折算", () => {
    const view = buildBlueprint({
      uid: "100000001",
      code: "1234567890",
      blueprint: BLUEPRINT,
      computes: [{ name: "摩拉", icon: "https://x/m.png", num: 1250000 }]
    })
    expect(view.molds.map(one => one.name)).toEqual(["「郊郊有神」", "「石凳」"])
    expect(view.molds[0]?.num).toBe("2")
    // 尘歌壶那一份不折算成万，故这里是原数而非 125.0 w
    expect(view.consume[0]?.num).toBe("1250000")
    expect(view.consume[0]?.icon).toBe("https://x/m.png")
  })

  it("文字形态带上分享码", () => {
    const view = buildBlueprint({ uid: "100000001", code: "1234567890", blueprint: BLUEPRINT, computes: [] })
    const text = blueprintText(view)
    expect(text).toContain("1234567890")
    expect(text).toContain("【所需模具】")
  })

  it("空模数时说清是空的，而不是给两张空表", () => {
    const view = buildBlueprint({ uid: "100000001", code: "1234567890", blueprint: {}, computes: [] })
    expect(blueprintText(view)).toContain("没有任何模具")
  })
})






