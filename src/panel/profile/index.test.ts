/**
 * 模块职责：统一面板形态与天赋映射的测试
 * 依赖方向：测试文件，依赖 panel/profile.ts
 * 生命周期：无状态纯函数，无须夹具
 * 注意事项：固定三件容易静默出错的事：兜底下标的推进方式（两个源不同，弄反了战技会被记成爆发）、
 *          命座折算只认"天赋键 → 命座号"这一种写法（多认一种就会重复减级）、天赋与行迹的分界。
 *          三件都不抛错，只让数值悄悄偏掉，故都以"与另一种写法对照"的形式断言。
 */
import { describe, expect, it } from "vitest"
import { foldCons, isGsTraveler, mapTalent, splitSkillTree, unfoldCons } from "./index.js"

describe("原神旅行者识别", () => {
  it("男女 id、元数据 id 与米游社 id 都能识别，普通角色不能误中", () => {
    for (const id of [7, "10000005", "10000007", "20000000"]) expect(isGsTraveler(id)).toBe(true)
    expect(isGsTraveler("10000130")).toBe(false)
  })
})

describe("天赋映射", () => {
  it("元数据认得出的技能 id 按表译成天赋键", () => {
    const got = mapTalent({ "10461": 8, "10462": 9, "10463": 10 }, {
      talentId: { "10461": "a", "10462": "e", "10463": "q" }
    })
    expect(got.talent).toEqual({ a: 8, e: 9, q: 10 })
  })

  it("表里没有的 id 按出现顺序落到 a / e / q", () => {
    const got = mapTalent({ "99901": 1, "99902": 2, "99903": 3 }, {})
    expect(got.talent).toEqual({ a: 1, e: 2, q: 3 })
  })

  it("旅行者的元素由命中的那条天赋定出", () => {
    const got = mapTalent({ "10001": 5 }, {
      talentId: { "10001": "e" },
      talentElem: { "10001": "pyro" }
    })
    expect(got.elem).toBe("pyro")
  })

  it("定不出元素时给空串而不是 undefined，调用方可直接 || 兜底", () => {
    expect(mapTalent({ "1": 1 }, {}).elem).toBe("")
  })

  // 这一条是两个源的唯一差别，弄反即错位
  it("bumpOnHit 为假时命中不推进兜底下标，故其后的未命中项仍从 a 起", () => {
    const got = mapTalent({ "10461": 8, "88888": 7 }, { talentId: { "10461": "e" } }, false)
    // 命中 e 不推进，故 88888 拿到 a
    expect(got.talent).toEqual({ e: 8, a: 7 })
  })

  it("bumpOnHit 为真时命中也推进，故其后的未命中项跳过 a", () => {
    const got = mapTalent({ "10461": 8, "88888": 7 }, { talentId: { "10461": "e" } }, true)
    // 命中时 idx 已推到 1，故 88888 拿到 e —— 但 e 已被命中项占了，`??=` 保住先到的值
    expect(got.talent.e).toBe(8)
    expect(got.talent.a).toBeUndefined()
  })

  it("兜底键最多三个，多出来的技能一律丢掉", () => {
    const got = mapTalent({ "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 }, {})
    expect(Object.keys(got.talent).sort()).toEqual(["a", "e", "q"])
  })

  it("同一个兜底键只取先出现的那个值", () => {
    const got = mapTalent({ "1": 9 }, {}, true)
    expect(got.talent.a).toBe(9)
  })
})

describe("命座折算", () => {
  it("命座不足 3 时原样返回", () => {
    const got = foldCons({ a: 10, e: 10 }, 2, { talentCons: { e: 3 } })
    expect(got).toEqual({ a: 10, e: 10 })
  })

  it("达到生效命座的那一项减 3 级", () => {
    const got = foldCons({ a: 10, e: 13, q: 13 }, 5, { talentCons: { a: 3, e: 3, q: 5 } })
    expect(got).toEqual({ a: 7, e: 10, q: 10 })
  })

  it("生效命座号为 0 的项不折算", () => {
    const got = foldCons({ a: 10 }, 6, { talentCons: { a: 0 } })
    expect(got.a).toBe(10)
  })

  it("未达到生效命座的项不折算", () => {
    const got = foldCons({ e: 10, q: 10 }, 3, { talentCons: { e: 3, q: 5 } })
    expect(got).toEqual({ e: 7, q: 10 })
  })

  it("折算不会把等级压到 1 以下", () => {
    const got = foldCons({ e: 2 }, 6, { talentCons: { e: 3 } })
    expect(got.e).toBe(1)
  })

  it("天赋里没有的键不会被凭空造出来", () => {
    const got = foldCons({ a: 10 }, 6, { talentCons: { e: 3 } })
    expect(got.e).toBeUndefined()
  })

  /**
   * 星铁的 `talentCons` 形如
   * `{"3":"e","5":"q","a":3,"e":3,"q":5,"t":5}` —— 两种写法混在同一个对象里。
   * 只认"天赋键 → 命座号"这一种时，数字键那两条查不出天赋键而被跳过；另认一支
   * "命座号 → 天赋键"就会让 e 与 q 各被减两次（8 变 4）。
   */
  it("数字键的条目不参与折算，故混合写法下每个键只减一次", () => {
    const mixed = { "3": "e", "5": "q", a: 3, e: 3, q: 5, t: 5 }
    const got = foldCons({ a: 8, e: 11, q: 11, t: 11 }, 6, { talentCons: mixed })
    // 只按字母键那四条减，各减一次
    expect(got).toEqual({ a: 5, e: 8, q: 8, t: 8 })
  })

  it("同一份数据只留字母键时结果相同，可证数字键确实未生效", () => {
    const mixed = { "3": "e", "5": "q", a: 3, e: 3, q: 5, t: 5 }
    const clean = { a: 3, e: 3, q: 5, t: 5 }
    const talent = { a: 8, e: 11, q: 11, t: 11 }
    expect(foldCons(talent, 6, { talentCons: mixed })).toEqual(foldCons(talent, 6, { talentCons: clean }))
  })
})

describe("命座反折算（含命座加成）", () => {
  it("命座不足 3 时原样返回", () => {
    const got = unfoldCons({ a: 10, e: 10 }, 2, { talentCons: { e: 3 } }, "gs")
    expect(got).toEqual({ a: 10, e: 10 })
  })

  // 如凝光 3 命 Q：存的是不含命座的 1 级，含命座后是 4 级
  it("原神达到生效命座的那一项加 3 级", () => {
    const got = unfoldCons({ a: 1, e: 1, q: 1 }, 3, { talentCons: { a: 0, e: 5, q: 3 } }, "gs")
    expect(got).toEqual({ a: 1, e: 1, q: 4 })
  })

  it("原神满命两项都达门槛，各加 3 级；普攻门槛为 0 不加", () => {
    const got = unfoldCons({ a: 10, e: 10, q: 10 }, 5, { talentCons: { a: 0, e: 3, q: 5 } }, "gs")
    expect(got).toEqual({ a: 10, e: 13, q: 13 })
  })

  it("未达到生效命座的项不加成", () => {
    const got = unfoldCons({ e: 7, q: 10 }, 3, { talentCons: { e: 3, q: 5 } }, "gs")
    expect(got).toEqual({ e: 10, q: 10 })
  })

  it("生效命座号为 0 的项不加成", () => {
    const got = unfoldCons({ a: 10 }, 6, { talentCons: { a: 0 } }, "gs")
    expect(got.a).toBe(10)
  })

  it("天赋里没有的键不会被凭空造出来", () => {
    const got = unfoldCons({ a: 10 }, 6, { talentCons: { e: 3 } }, "gs")
    expect(got.e).toBeUndefined()
  })

  // 星铁逐键不同：a+1、e/q/t+2、me/mt+1，欢愉技随星魂数变
  it("星铁按键各加不同级数", () => {
    const got = unfoldCons(
      { a: 5, e: 8, q: 8, t: 8 },
      6,
      { talentCons: { a: 3, e: 3, q: 5, t: 5 } },
      "sr"
    )
    expect(got).toEqual({ a: 6, e: 10, q: 10, t: 10 })
  })

  it("星铁欢愉技 5 命及以上加 2 级、以下加 1 级", () => {
    const at4 = unfoldCons({ j: 6 }, 4, { talentCons: { j: 4 } }, "sr")
    const at5 = unfoldCons({ j: 6 }, 5, { talentCons: { j: 4 } }, "sr")
    expect(at4.j).toBe(7)
    expect(at5.j).toBe(8)
  })

  it("数字键的条目不参与，故混合写法下每个键只加一次", () => {
    const mixed = { "3": "e", "5": "q", a: 3, e: 3, q: 5, t: 5 }
    const got = unfoldCons({ a: 5, e: 8, q: 8, t: 8 }, 6, { talentCons: mixed }, "sr")
    expect(got).toEqual({ a: 6, e: 10, q: 10, t: 10 })
  })

  // unfoldCons 与 foldCons 互为镜像：折过去再折回来应还原
  it("与 foldCons 互为逆运算（原神）", () => {
    const original = { a: 10, e: 10, q: 10 }
    const meta = { talentCons: { a: 3, e: 3, q: 5 } }
    const folded = unfoldCons(original, 6, meta, "gs")
    expect(foldCons(folded, 6, meta)).toEqual(original)
  })
})

describe("星铁技能树拆分", () => {
  it("元数据认得出的节点记作天赋，其余记作行迹", () => {
    const got = splitSkillTree(
      [{ id: "1015001", level: 6 }, { id: "1015101", level: 1 }],
      { talentId: { "1015001": "a" } }
    )
    expect(got.talent).toEqual({ a: 6 })
    expect(got.trees).toEqual(["1015101"])
  })

  it("接口给的 id 多一位前导 1 时脱掉再查一次", () => {
    /*
     * 元数据记的是 `1306001`（角色 id 1306 + 序号），而 Enka / Mihomo 给的是 `11306001`。
     * 少了这一步天赋键就是原始的八位 id，模板按 `talent.a` 取值，四格天赋等级全是空白。
     */
    const got = splitSkillTree(
      [
        { id: "11306001", level: 6 },
        { id: "11306002", level: 10 },
        { id: "11306101", level: 1 }
      ],
      { talentId: { "1306001": "a", "1306002": "e" } }
    )
    expect(got.talent).toEqual({ a: 6, e: 10 })
    expect(got.trees).toEqual(["11306101"])
  })

  it("整串能查到时不脱前导 1，脱了会查错", () => {
    // 两个键同时在表里：整串优先，故 `1015001` 取 `a` 而不是脱成 `015001` 后的那个
    const got = splitSkillTree([{ id: "1015001", level: 3 }], {
      talentId: { "1015001": "a", "015001": "q" }
    })
    expect(got.talent).toEqual({ a: 3 })
  })

  it("认不出但等级大于 1 的仍记作天赋，键为原始 id", () => {
    // 新角色上线而元数据未更新时即如此，丢掉会让天赋整段缺失
    const got = splitSkillTree([{ id: "9990001", level: 5 }], {})
    expect(got.talent["9990001"]).toBe(5)
    expect(got.trees).toEqual([])
  })

  it("认不出且等级为 1 的记作行迹", () => {
    const got = splitSkillTree([{ id: "9990002", level: 1 }], {})
    expect(got.talent).toEqual({})
    expect(got.trees).toEqual(["9990002"])
  })

  it("缺等级字段时按 0 计，落到行迹", () => {
    const got = splitSkillTree([{ id: "777" }], {})
    expect(got.trees).toEqual(["777"])
  })
})
