/**
 * 模块职责：面板装配器的武器查找那一段的测试
 * 依赖方向：测试文件，依赖 panel/build；元数据、词条、套装、buff 都是手写替身，不读盘
 * 生命周期：无状态
 * 注意事项：钉住「库里只有武器 id、没有名字」时仍装得出武器 —— 展柜源的武器名是取数当时查元数据得来的，
 *          元数据还没装好就只存下 id；只认名字则那件武器永远查不到，面板整块没有武器。
 */
import { describe, expect, it } from "vitest"
import type { ArtiMetaTable } from "../meta/arti.js"
import type { ArtiSetTable } from "../meta/arti-set.js"
import type { BuffTable } from "../meta/buffs.js"
import type { MetaItem, MetaLoader } from "../meta/loader.js"
import type { StoredAvatar } from "../store/panel.js"
import { PanelBuilder } from "./build.js"

/** 一个角色与一件武器的元数据条目 */
const ITEMS: MetaItem[] = [
  { id: "10000047", name: "枫原万叶", abbr: "万叶", star: 5, elem: "anemo", kind: "character" } as MetaItem,
  { id: "11509", name: "苍古自由之誓", abbr: "苍古", star: 5, type: "sword", kind: "weapon", icon: "meta-gs/weapon/sword/苍古自由之誓/icon.webp" } as MetaItem
]

/**
 * 造一个只认上面两条的元数据装载器替身
 * @returns 装载器
 */
function meta(): MetaLoader {
  return {
    ready: () => true,
    byId: (_g: string, id: string | number) => ITEMS.find(it => it.id === String(id)),
    byName: (_g: string, name: string) => ITEMS.find(it => it.name === name || it.abbr === name),
    detail: () => undefined,
    exists: () => false
  } as unknown as MetaLoader
}

/**
 * 造装配器，词条 / 套装 / buff 一律空表
 * @returns 装配器
 */
function builder(): PanelBuilder {
  return new PanelBuilder({
    meta: meta(),
    arti: { ready: () => true, attrMap: () => ({}), mainAttr: () => ({}), subAttr: () => ({}) } as unknown as ArtiMetaTable,
    sets: { set: () => undefined, setOf: () => undefined } as unknown as ArtiSetTable,
    buffs: { setBuff: () => [], weaponBuff: () => [], charBuff: () => [] } as unknown as BuffTable
  })
}

/**
 * 库里存的万叶面板
 * @param weapon 武器那一项
 * @returns 面板
 */
function stored(weapon: StoredAvatar["weapon"]): StoredAvatar {
  return { id: "10000047", level: 90, promote: 6, cons: 0, talent: { a: 9, e: 9, q: 9 }, artis: {}, weapon } as unknown as StoredAvatar
}

describe("PanelBuilder 武器查找", () => {
  it("库里只有 id、没有名字时按 id 查到武器", () => {
    const got = builder().build("gs", "100000001", stored({ id: 11509, level: 90, promote: 6, affix: 1 }))
    expect(got?.weapon?.name).toBe("苍古自由之誓")
    expect(got?.weapon?.img).toBe("meta-gs/weapon/sword/苍古自由之誓/icon.webp")
  })

  it("名字与 id 都在时以名字为准（原神的源给的是名字）", () => {
    const got = builder().build("gs", "100000001", stored({ name: "苍古自由之誓", id: 99999, level: 90, affix: 1 }))
    expect(got?.weapon?.name).toBe("苍古自由之誓")
  })

  it("两条路都查不到时面板没有武器，而不是抛错", () => {
    const got = builder().build("gs", "100000001", stored({ id: 1, level: 90, affix: 1 }))
    expect(got).toBeDefined()
    expect(got?.weapon).toBeUndefined()
  })
})
