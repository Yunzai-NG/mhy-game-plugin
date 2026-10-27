/**
 * 模块职责：邦布一览模板数据的测试
 * 依赖方向：测试文件，只依赖 views/zzz/buddy.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：本文件固定的是**稀有度折算成数字再排序**：接口给的是字母，按字母排会得到
 *          "A 在 S 前面"这个反的次序，而那不报错、只是一张次序不对的图。
 */
import { describe, expect, it } from "vitest"
import type { MetaLoader } from "../../meta/loader.js"
import { buddyTemplateData, buddyText } from "./buddy.js"

/** 上下文 */
const CTX = { uid: "1300000001", name: "绳匠" }

describe("buddyTemplateData", () => {
  it("S 级排在 A 级前面，同级按等级降序", () => {
    const data = buddyTemplateData(
      {
        list: [
          { name: "企鹅布", rarity: "A", level: 60, star: 5 },
          { name: "左轮布", rarity: "S", level: 30, star: 3 },
          { name: "共鸣布", rarity: "S", level: 60, star: 5 }
        ]
      },
      CTX
    )
    expect((data["list"] as { name?: string }[]).map(it => it.name)).toEqual(["共鸣布", "左轮布", "企鹅布"])
  })

  it("缺稀有度时按 A 处理 —— 模板据其挑底框，缺值会露出无底框的格子", () => {
    const data = buddyTemplateData({ list: [{ name: "新邦布" }] }, CTX)
    expect((data["list"] as { rarity: string }[])[0]?.rarity).toBe("A")
  })

  it("空数据不炸", () => {
    expect(buddyTemplateData({}, CTX)["list"]).toEqual([])
  })

  it("**装了元数据就用元数据那张，并标明它相对元数据根**", () => {
    const meta = {
      byName: (game: string, name: string) =>
        game === "zzz" && name === "共鸣布" ? { icon: "meta-zzz/bangboo/imgs/共鸣布.webp" } : undefined
    } as unknown as MetaLoader
    const data = buddyTemplateData({ list: [{ name: "共鸣布", rarity: "S" }] }, { ...CTX, meta })
    const one = (data["list"] as { img: string; fromMeta: boolean }[])[0]

    expect(one?.img).toBe("meta-zzz/bangboo/imgs/共鸣布.webp")
    // 这一栏漏了就是静默空图：模板据它在 _meta_path 与 _res_path 之间挑前缀
    expect(one?.fromMeta).toBe(true)
  })

  it("没装元数据时回落到提交的那一份 —— 一张图都没有比大一点更糟", () => {
    const data = buddyTemplateData({ list: [{ name: "共鸣布", rarity: "S" }] }, CTX)
    const one = (data["list"] as { img: string; fromMeta: boolean }[])[0]

    expect(one?.img).toBe("zzz/buddy/共鸣布.png")
    expect(one?.fromMeta).toBe(false)
  })

  it("元数据里没有这一只时也回落 —— 新邦布两处都没有，由模板的 onerror 兜住", () => {
    const meta = { byName: () => undefined } as unknown as MetaLoader
    const data = buddyTemplateData({ list: [{ name: "新邦布" }] }, { ...CTX, meta })

    expect((data["list"] as { fromMeta: boolean }[])[0]?.fromMeta).toBe(false)
  })
})

describe("buddyText", () => {
  it("没有数据时给出可操作的提示", () => {
    expect(buddyText(buddyTemplateData({}, CTX))).toContain("查询显示")
  })

  it("逐只列出稀有度、等级与星级", () => {
    const text = buddyText(buddyTemplateData({ list: [{ name: "共鸣布", rarity: "S", level: 60, star: 5 }] }, CTX))
    expect(text).toContain("已拥有邦布 1 只")
    expect(text).toContain("S 共鸣布 Lv.60 5 星")
  })
})
