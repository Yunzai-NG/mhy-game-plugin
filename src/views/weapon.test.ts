/**
 * 模块职责：武器列表模板数据的测试
 * 依赖方向：测试文件，只依赖 views/weapon.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：本文件固定的是**两轮排序**与**计数口径**。两轮排序不可合成一轮权重数 ——
 *          那得不到同样的结果；计数口径决定图例上的"五星：N"，错一个使用者立刻看得出。
 */
import { describe, expect, it } from "vitest"
import type { StoredAvatar } from "../store/panel.js"
import type { CharacterListRaw } from "./weapon.js"
import { weaponTemplateData, weaponText, zzzWeaponTemplateData } from "./weapon.js"

/** 上下文 */
const CTX = { uid: "100000001", name: "旅行者" }

/**
 * 造一个带武器的角色
 * @param name 角色名
 * @param weapon 武器项
 * @returns 一个角色
 */
function avatar(
  name: string,
  weapon: { name: string; rarity: number; level: number; affix_level: number; type_name: string }
): NonNullable<CharacterListRaw["avatars"]>[number] {
  return {
    id: 10000000 + name.length,
    name,
    level: 90,
    rarity: 5,
    icon: `https://${name}.png`,
    weapon: { ...weapon, icon: `https://${weapon.name}.png` }
  }
}

describe("weaponTemplateData", () => {
  it("按稀有度与武器种类计数", () => {
    const data = weaponTemplateData(
      {
        avatars: [
          avatar("北斗", { name: "狼的末路", rarity: 5, level: 90, affix_level: 1, type_name: "双手剑" }),
          avatar("行秋", { name: "祭礼剑", rarity: 4, level: 80, affix_level: 3, type_name: "单手剑" }),
          avatar("香菱", { name: "千岩长枪", rarity: 4, level: 90, affix_level: 1, type_name: "长柄武器" })
        ]
      },
      CTX
    )
    const count = data["count"] as Record<string, number>
    expect(count["five"]).toBe(1)
    expect(count["four"]).toBe(2)
    expect(count["双手剑"]).toBe(1)
    expect(count["长柄武器"]).toBe(1)
    expect(count["法器"]).toBe(0)
  })

  it("稀有度 1 的初始武器不计入 —— 它只说明这个角色没给武器", () => {
    const data = weaponTemplateData(
      {
        avatars: [
          avatar("安柏", { name: "无锋剑", rarity: 1, level: 1, affix_level: 1, type_name: "单手剑" }),
          avatar("行秋", { name: "祭礼剑", rarity: 4, level: 80, affix_level: 3, type_name: "单手剑" })
        ]
      },
      CTX
    )
    expect((data["list"] as unknown[]).length).toBe(1)
  })

  it("五星满精炼排在四星前面", () => {
    const data = weaponTemplateData(
      {
        avatars: [
          avatar("行秋", { name: "祭礼剑", rarity: 4, level: 90, affix_level: 5, type_name: "单手剑" }),
          avatar("北斗", { name: "狼的末路", rarity: 5, level: 90, affix_level: 1, type_name: "双手剑" })
        ]
      },
      CTX
    )
    expect((data["list"] as { name: string }[]).map(it => it.name)).toEqual(["狼的末路", "祭礼剑"])
  })

  it("武器图与佩戴者头像取元数据，接口给的地址一律不用", () => {
    const meta = {
      find: (_g: string, _id: unknown, name: string) =>
        name === "狼的末路" ? { icon: "meta-gs/weapon/claymore/狼的末路/icon.webp" } : name === "北斗" ? { face: "meta-gs/character/北斗/imgs/face.webp" } : undefined
    }
    const data = weaponTemplateData(
      { avatars: [avatar("北斗", { name: "狼的末路", rarity: 5, level: 90, affix_level: 1, type_name: "双手剑" })] },
      { ...CTX, meta: meta as unknown as Parameters<typeof weaponTemplateData>[1]["meta"] }
    )
    const one = (data["list"] as { icon: string; role_icon: string }[])[0]
    expect(one?.icon).toBe("meta-gs/weapon/claymore/狼的末路/icon.webp")
    expect(one?.role_icon).toBe("meta-gs/character/北斗/imgs/face.webp")
  })

  it("元数据里没有时图位空着，不回落到接口地址", () => {
    const data = weaponTemplateData(
      { avatars: [avatar("北斗", { name: "狼的末路", rarity: 5, level: 90, affix_level: 1, type_name: "双手剑" })] },
      CTX
    )
    const one = (data["list"] as { icon: string; role_icon: string }[])[0]
    expect(one?.icon).toBe("")
    expect(one?.role_icon).toBe("")
  })

  it("试用武器的精炼不计入第一轮排序 —— 两件 sort 相同时它排在后面", () => {
    // 黑岩系列一律满精炼。两件的 sort 完全相同，胜负就落在第一轮的 firstSort 上：
    // 试用武器不加精炼加成，故排在真正练过的那件之后
    const data = weaponTemplateData(
      {
        avatars: [
          avatar("重云", { name: "黑岩斩刀", rarity: 4, level: 20, affix_level: 5, type_name: "双手剑" }),
          avatar("行秋", { name: "祭礼剑", rarity: 4, level: 20, affix_level: 5, type_name: "单手剑" })
        ]
      },
      CTX
    )
    expect((data["list"] as { name: string }[])[0]?.name).toBe("祭礼剑")
  })

  it("排序以 sort 为主 —— 稀有度、精炼、武器等级依次压过角色练度", () => {
    const data = weaponTemplateData(
      {
        avatars: [
          avatar("重云", { name: "黑岩斩刀", rarity: 4, level: 20, affix_level: 5, type_name: "双手剑" }),
          avatar("行秋", { name: "祭礼剑", rarity: 4, level: 30, affix_level: 1, type_name: "单手剑" })
        ]
      },
      CTX
    )
    // 精炼 5 的那件 sort 更高，即便另一件武器等级更高、第一轮排在它前面
    expect((data["list"] as { name: string }[])[0]?.name).toBe("黑岩斩刀")
  })

  it("空数据不炸，各项归零", () => {
    const data = weaponTemplateData({}, CTX)
    expect(data["list"]).toEqual([])
    expect((data["count"] as Record<string, number>)["five"]).toBe(0)
  })
})

describe("weaponTemplateData 的星铁一路", () => {
  /** 一份星铁返回：列表在 avatar_list 下、光锥在 equip 下、叠影叫 rank */
  const SR: CharacterListRaw = {
    avatar_list: [
      {
        id: 1225,
        name: "花火",
        level: 80,
        rarity: 5,
        icon: "https://花火.png",
        equip: { name: "两个人的演唱会", level: 80, rank: 3, rarity: 5, icon: "https://演唱会.png" }
      },
      // 接口不给星级的那一件，靠元数据补
      { id: 1006, name: "银狼", level: 80, rarity: 5, equip: { name: "无处可逃", level: 60, rank: 1 } }
    ]
  }

  it("三处键名都换过来 —— 只认原神那套的表现是整张图一件都没有", () => {
    const data = weaponTemplateData(SR, { ...CTX, game: "sr" })
    const list = data["list"] as { name: string; affix_level: number; level: number }[]

    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ name: "两个人的演唱会", level: 80, affix_level: 3 })
  })

  it("接口不给星级时按名字查元数据，查不到才当四星", () => {
    const meta = { find: (_g: string, _id: unknown, name: string) => (name === "无处可逃" ? { star: 5 } : undefined) }
    const data = weaponTemplateData(SR, {
      ...CTX,
      game: "sr",
      meta: meta as unknown as Parameters<typeof weaponTemplateData>[1]["meta"]
    })
    const count = data["count"] as Record<string, number>

    expect(count["five"]).toBe(2)
    expect(count["four"]).toBe(0)
  })

  it("不产出 types 键，模板据此隐去武器类型那一排图例", () => {
    expect(weaponTemplateData(SR, { ...CTX, game: "sr" })["types"]).toBeUndefined()
    expect(weaponTemplateData({ avatars: [] }, CTX)["types"]).toBeDefined()
  })

  it("量词随游戏变，文字形态里印的是「光锥」与「叠」", () => {
    const text = weaponText(weaponTemplateData(SR, { ...CTX, game: "sr" }))

    expect(text).toContain("已装备光锥 2 件")
    expect(text).toContain("叠3")
  })
})

describe("weaponText", () => {  it("没有数据时给出可操作的提示，而不是空白", () => {
    expect(weaponText(weaponTemplateData({}, CTX))).toContain("查询显示")
  })

  it("列出前十件并说明还有多少", () => {
    const avatars = Array.from({ length: 12 }, (_, i) =>
      avatar(`角色${i}`, { name: `武器${i}`, rarity: 4, level: 90 - i, affix_level: 1, type_name: "单手剑" })
    )
    const text = weaponText(weaponTemplateData({ avatars }, CTX))
    expect(text).toContain("已装备武器 12 件")
    expect(text).toContain("另有 2 件")
  })
})

describe("zzzWeaponTemplateData", () => {
  /**
   * 造一位面板库里的代理人
   * @param id 代理人 id
   * @param weapon 音擎
   * @returns 存档里的一位
   */
  function stored(id: string, weapon?: { name: string; rank: string; star: number; level: number }): StoredAvatar {
    return {
      id,
      level: 60,
      cons: 0,
      zzz: { name: "代理人" + id, rank: "S", attrs: [], discs: [], ...(weapon ? { weapon: { id: 1, ...weapon } } : {}) }
    } as StoredAvatar
  }

  it("读面板库的音擎：S 计五星、叠影即精炼，没装音擎的那位不列", () => {
    const data = zzzWeaponTemplateData(
      [stored("1", { name: "深海访客", rank: "S", star: 1, level: 60 }), stored("2", { name: "街头巨星", rank: "A", star: 5, level: 60 }), stored("3")],
      CTX
    )
    expect((data["list"] as { name: string; affix_level: number }[]).map(it => [it.name, it.affix_level])).toEqual([
      ["深海访客", 1],
      ["街头巨星", 5]
    ])
    expect(data["count"]).toMatchObject({ five: 1, four: 1 })
    expect(data["noun"]).toBe("音擎")
  })
})
