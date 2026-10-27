/**
 * 模块职责：今日材料视图的测试
 * 依赖方向：测试文件，依赖 views/gs/today-material
 * 生命周期：无状态
 * 注意事项：固定四处易错口径：凌晨四点前算前一天（错了不报错，只是四点前查到明天的材料）、
 *          周一为 0 的折算（用 JS 的 `getDay()` 会整体错一天）、「明天」加在四点回退之后
 *          （四点前查「明天」要的是当天而非次日）、满级的排在最后。
 */
import { describe, expect, it } from "vitest"
import type { TodayAvatar, TodayMaterialDeps } from "./today-material.js"
import {
  buildTodayMaterial,
  cityIcon,
  isMaxTalent,
  isMaxWeapon,
  materialWeek,
  sortWeight,
  todayMaterialText,
  weekdayOf
} from "./today-material.js"

/* 2026-08-31 是周一，故 09-01 周二、09-06 周日 —— 下面的日期都据此挑 */
const MON_10 = new Date(2026, 7, 31, 10, 0)
const MON_02 = new Date(2026, 7, 31, 2, 0)
const TUE_10 = new Date(2026, 8, 1, 10, 0)
const TUE_02 = new Date(2026, 8, 1, 2, 0)
const SUN_10 = new Date(2026, 8, 6, 10, 0)

/** 够用的材料表：蒙德与璃月各一档天赋书，加一件蒙德武器材料与一件别的周期的 */
const MATS: Record<string, ReturnType<TodayMaterialDeps["material"]>> = {
  "「诗文」的哲学": { name: "「诗文」的哲学", city: "蒙德", cid: 1, week: 3, source: "周三/周六", icon: "t-mond.webp" },
  "「黄金」的哲学": { name: "「黄金」的哲学", city: "璃月", cid: 2, week: 3, source: "周三/周六", icon: "t-liyue.webp" },
  "「勤劳」的哲学": { name: "「勤劳」的哲学", city: "璃月", cid: 2, week: 2, source: "周二/周五", icon: "t-qin.webp" },
  狮牙斗士的理想: { name: "狮牙斗士的理想", city: "蒙德", cid: 1, week: 3, source: "周三/周六", icon: "w-mond.webp" },
  未编国家的材料: { name: "未编国家的材料", week: 3, source: "周三/周六", icon: "x.webp" }
}

/** 两个取值函数 */
const deps: TodayMaterialDeps = {
  material: name => MATS[name],
  ladder: name => [`${name}-4`, `${name}-3`]
}

/**
 * 造一个角色
 * @param over 要盖掉的字段
 * @returns 一个角色连同其武器
 */
function avatarOf(over: Partial<TodayAvatar["char"]> = {}, weapon?: Partial<TodayAvatar["weapon"]>): TodayAvatar {
  const one: TodayAvatar = {
    char: {
      id: "10000046",
      name: "胡桃",
      level: 90,
      cons: 2,
      star: 5,
      face: "face.webp",
      talent: { a: 10, e: 9, q: 10 },
      promote: 6,
      material: "「诗文」的哲学",
      ...over
    }
  }
  if (weapon) {
    one.weapon = {
      id: "13501",
      name: "护摩之杖",
      abbr: "护摩",
      star: 5,
      level: 90,
      affix: 1,
      promote: 6,
      icon: "w.webp",
      face: "side.webp",
      material: "狮牙斗士的理想",
      ...weapon
    }
  }
  return one
}

describe("weekdayOf", () => {
  it("周一为 0、周日为 6 —— 与 JS 的 getDay 差一天", () => {
    expect(weekdayOf(MON_10)).toBe(0)
    expect(weekdayOf(TUE_10)).toBe(1)
    expect(weekdayOf(SUN_10)).toBe(6)
  })
})

describe("materialWeek 的四点边界", () => {
  it("周一上午查到的是第一档", () => {
    expect(materialWeek("", MON_10)).toMatchObject({ sunday: false, week: 1, label: "周一/周四" })
  })

  it("周二凌晨两点仍算周一 —— 游戏日切在四点", () => {
    expect(materialWeek("", TUE_02).week).toBe(1)
  })

  it("周二上午才算周二", () => {
    expect(materialWeek("", TUE_10).week).toBe(2)
  })

  it("周一凌晨两点回退到周日，于是全部材料都可刷", () => {
    expect(materialWeek("", MON_02).sunday).toBe(true)
  })
})

describe("materialWeek 的明天与周N", () => {
  it("「明日」在四点回退之后再加一天：周二凌晨说明日，指的是周二", () => {
    // 反直觉但次序如此：先回退到周一，再加一天
    expect(materialWeek("明日", TUE_02).week).toBe(2)
  })

  it("周二上午说明天，指的是周三", () => {
    expect(materialWeek("明天", TUE_10).week).toBe(3)
  })

  it("「周N」整个覆盖前两条 —— 明确指定了就不再猜", () => {
    expect(materialWeek("周4", TUE_10).week).toBe(1)
    expect(materialWeek("周三", MON_10).week).toBe(3)
    expect(materialWeek("周三", TUE_02).week).toBe(3)
  })

  it("汉字与数字两种写法等价", () => {
    expect(materialWeek("周1", MON_10).week).toBe(materialWeek("周一", MON_10).week)
    expect(materialWeek("周6", MON_10).week).toBe(materialWeek("周六", MON_10).week)
  })

  it("周日与周7 都落到「全部可刷」", () => {
    expect(materialWeek("周日", MON_10).sunday).toBe(true)
    expect(materialWeek("周7", MON_10).sunday).toBe(true)
  })

  it("三档各自的说明文字", () => {
    expect(materialWeek("周一", MON_10).label).toBe("周一/周四")
    expect(materialWeek("周二", MON_10).label).toBe("周二/周五")
    expect(materialWeek("周三", MON_10).label).toBe("周三/周六")
    expect(materialWeek("周四", MON_10).label).toBe("周一/周四")
  })

  it("周日时 week 为 0，调用方据 sunday 判而非据 week", () => {
    expect(materialWeek("周日", MON_10).week).toBe(0)
  })
})

describe("cityIcon", () => {
  it("有图的国家给相对 _res_path 的路径", () => {
    expect(cityIcon("蒙德")).toBe("gs/area-mat/蒙德.png")
    // 挪德卡莱那张不在 common/item 下，而在探索度那套图里
    expect(cityIcon("挪德卡莱")).toBe("gs/area/挪德卡莱.png")
  })

  it("没有图的国家给空串 —— 模板据此不出 img，而不是指向一个 404", () => {
    expect(cityIcon("至冬")).toBe("")
    expect(cityIcon("")).toBe("")
  })
})

describe("sortWeight", () => {
  it("四项按 10^6 / 10^4 / 10^2 / 10^0 加权", () => {
    expect(sortWeight([1, 0, 0, 0], false)).toBe(1000000)
    expect(sortWeight([0, 1, 0, 0], false)).toBe(10000)
    expect(sortWeight([0, 0, 1, 0], false)).toBe(100)
    expect(sortWeight([0, 0, 0, 1], false)).toBe(1)
  })

  it("等级永远压过星级", () => {
    expect(sortWeight([90, 4, 0, 0], false)).toBeGreaterThan(sortWeight([89, 5, 0, 0], false))
  })

  it("满级减 10^8，比满级的等级项还大一档，故必然垫底", () => {
    expect(sortWeight([90, 5, 6, 99], true)).toBeLessThan(sortWeight([1, 1, 0, 0], false))
  })

  it("只取前四项，多给的不计", () => {
    expect(sortWeight([0, 0, 0, 0, 999], false)).toBe(0)
  })
})

describe("isMaxTalent", () => {
  it("上限随突破阶数走 —— 四阶角色天赋只能点到 6，点到就该置灰", () => {
    expect(isMaxTalent({ a: 6, e: 6, q: 6 }, 4)).toBe(true)
    expect(isMaxTalent({ a: 6, e: 5, q: 6 }, 4)).toBe(false)
  })

  it("六阶的上限是 10", () => {
    expect(isMaxTalent({ a: 10, e: 10, q: 10 }, 6)).toBe(true)
    expect(isMaxTalent({ a: 10, e: 9, q: 10 }, 6)).toBe(false)
  })

  it("突破阶数缺失时按 10 判", () => {
    expect(isMaxTalent({ a: 10, e: 10, q: 10 })).toBe(true)
    expect(isMaxTalent({ a: 8, e: 8, q: 8 })).toBe(false)
  })

  it("天赋数据缺失时不置灰 —— 那只说明本地没有面板数据，不说明已点满", () => {
    expect(isMaxTalent(undefined, 6)).toBe(false)
    expect(isMaxTalent({}, 6)).toBe(false)
  })
})

describe("isMaxWeapon", () => {
  it("三星及以上六阶封顶", () => {
    expect(isMaxWeapon(5, 6)).toBe(true)
    expect(isMaxWeapon(5, 5)).toBe(false)
    expect(isMaxWeapon(3, 6)).toBe(true)
  })

  it("一二星四阶封顶", () => {
    expect(isMaxWeapon(2, 4)).toBe(true)
    expect(isMaxWeapon(1, 4)).toBe(true)
    expect(isMaxWeapon(2, 3)).toBe(false)
  })

  it("突破阶数缺失时不置灰", () => {
    expect(isMaxWeapon(5)).toBe(false)
  })
})

describe("buildTodayMaterial 分组", () => {
  const view = buildTodayMaterial(
    {
      uid: "100000001",
      week: 3,
      avatars: [
        avatarOf({}, {}),
        avatarOf({ id: "10000037", name: "甘雨", level: 80, cons: 0, material: "「黄金」的哲学" }),
        // 这一位的天赋书是第二档，今天刷不到，故整个不该出现
        avatarOf({ id: "10000042", name: "刻晴", material: "「勤劳」的哲学" })
      ]
    },
    deps
  )

  it("按国家分组，只留今天这一档", () => {
    expect(view.data.map(one => one.city)).toEqual(["璃月", "蒙德"])
  })

  it("国家序号倒序 —— 新国家排在前面", () => {
    expect(view.data[0]?.city).toBe("璃月")
  })

  it("天赋书与武器材料各占一格", () => {
    const mond = view.data.find(one => one.city === "蒙德")

    expect(mond?.talent?.data).toHaveLength(1)
    expect(mond?.weapon?.data).toHaveLength(1)
  })

  it("别的周期的角色整个不出现", () => {
    const liyue = view.data.find(one => one.city === "璃月")

    expect(liyue?.talent?.data.map(one => one["name"])).toEqual(["甘雨"])
  })

  it("分组标题带材料名、可刷日与星级阶梯", () => {
    const mond = view.data.find(one => one.city === "蒙德")

    expect(mond?.talent?.material.name).toBe("「诗文」的哲学")
    expect(mond?.talent?.material.source).toBe("周三/周六")
    expect(mond?.talent?.material.icons).toEqual(["「诗文」的哲学-4", "「诗文」的哲学-3"])
  })

  it("国家图标算好放进视图，模板不自己拼", () => {
    expect(view.data.find(one => one.city === "蒙德")?.cityIcon).toBe("gs/area-mat/蒙德.png")
  })

  it("标题旁的可刷日按周期给", () => {
    expect(view.day).toBe("周三/周六")
  })

  it("天赋格子带等级与不含命座加成的那一份 —— 模板据后者画皇冠", () => {
    const mond = view.data.find(one => one.city === "蒙德")
    const char = mond?.talent?.data[0]

    expect(char?.["talent"]).toEqual([
      { key: "a", level: 10, original: 10 },
      { key: "e", level: 9, original: 9 },
      { key: "q", level: 10, original: 10 }
    ])
  })

  it("武器格子带持有者侧脸 —— 那一格画的是「谁在用它」", () => {
    const mond = view.data.find(one => one.city === "蒙德")

    expect(mond?.weapon?.data[0]?.["face"]).toBe("side.webp")
    expect(mond?.weapon?.data[0]?.["abbr"]).toBe("护摩")
  })
})

describe("buildTodayMaterial 排序", () => {
  it("等级高的在前", () => {
    const view = buildTodayMaterial(
      {
        uid: "1",
        week: 3,
        avatars: [
          avatarOf({ id: "10000037", name: "甘雨", level: 70 }),
          avatarOf({ id: "10000046", name: "胡桃", level: 90 }),
          avatarOf({ id: "10000030", name: "钟离", level: 80 })
        ]
      },
      deps
    )

    expect(view.data[0]?.talent?.data.map(one => one["name"])).toEqual(["胡桃", "钟离", "甘雨"])
  })

  it("已点满的排在最后，哪怕等级最高", () => {
    const view = buildTodayMaterial(
      {
        uid: "1",
        week: 3,
        avatars: [
          avatarOf({ id: "10000037", name: "甘雨", level: 70, talent: { a: 1, e: 1, q: 1 } }),
          // 六阶且三个天赋都满 10，故置灰并垫底
          avatarOf({ id: "10000046", name: "胡桃", level: 90, talent: { a: 10, e: 10, q: 10 }, promote: 6 })
        ]
      },
      deps
    )
    const list = view.data[0]?.talent?.data ?? []

    expect(list.map(one => one["name"])).toEqual(["甘雨", "胡桃"])
    expect(list[1]?.["isMax"]).toBe(true)
  })

  it("同等级时星级高的在前", () => {
    const view = buildTodayMaterial(
      {
        uid: "1",
        week: 3,
        avatars: [
          avatarOf({ id: "10000039", name: "迪奥娜", star: 4 }),
          avatarOf({ id: "10000046", name: "胡桃", star: 5 })
        ]
      },
      deps
    )

    expect(view.data[0]?.talent?.data.map(one => one["name"])).toEqual(["胡桃", "迪奥娜"])
  })
})

describe("buildTodayMaterial 的边界", () => {
  it("没有角色时给一份空视图而非抛错", () => {
    const view = buildTodayMaterial({ uid: "1", week: 3, avatars: [] }, deps)

    expect(view.data).toEqual([])
  })

  it("材料表里查不到的材料直接丢掉", () => {
    const view = buildTodayMaterial({ uid: "1", week: 3, avatars: [avatarOf({ material: "没有的材料" })] }, deps)

    expect(view.data).toEqual([])
  })

  it("角色没有天赋书一栏时不进任何分组", () => {
    const one = avatarOf()
    delete one.char.material
    const view = buildTodayMaterial({ uid: "1", week: 3, avatars: [one] }, deps)

    expect(view.data).toEqual([])
  })

  it("材料没有国家序号时不分组 —— 没有序号就没法与别的材料并到一处", () => {
    const view = buildTodayMaterial({ uid: "1", week: 3, avatars: [avatarOf({ material: "未编国家的材料" })] }, deps)

    expect(view.data).toEqual([])
  })

  it("没有面板数据的角色仍然出现，只是天赋格子空着", () => {
    const one = avatarOf()
    delete one.char.talent
    delete one.char.promote
    const view = buildTodayMaterial({ uid: "1", week: 3, avatars: [one] }, deps)
    const char = view.data[0]?.talent?.data[0]

    expect(char?.["talent"]).toEqual([])
    expect(char?.["isMax"]).toBe(false)
  })

  it("只有武器对得上今天时，那一组只有武器一格", () => {
    const view = buildTodayMaterial(
      { uid: "1", week: 3, avatars: [avatarOf({ material: "「勤劳」的哲学" }, {})] },
      deps
    )

    expect(view.data[0]?.talent).toBeUndefined()
    expect(view.data[0]?.weapon?.data).toHaveLength(1)
  })
})

describe("todayMaterialText", () => {
  it("一组一行，带上材料名与角色名", () => {
    const view = buildTodayMaterial({ uid: "100000001", week: 3, avatars: [avatarOf({}, {})] }, deps)
    const text = todayMaterialText(view)

    expect(text).toContain("UID100000001")
    expect(text).toContain("周三/周六")
    expect(text).toContain("「诗文」的哲学")
    expect(text).toContain("胡桃")
    expect(text).toContain("护摩")
  })

  it("已满的标出来", () => {
    const view = buildTodayMaterial(
      { uid: "1", week: 3, avatars: [avatarOf({ talent: { a: 10, e: 10, q: 10 }, promote: 6 })] },
      deps
    )

    expect(todayMaterialText(view)).toContain("(满)")
  })

  it("一组都没有时给一句说明而非空串", () => {
    const view = buildTodayMaterial({ uid: "1", week: 3, avatars: [] }, deps)

    expect(todayMaterialText(view)).toBe("今天没有可刷的材料对应到你的角色")
  })
})
