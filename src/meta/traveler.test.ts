/**
 * 模块职责：原神旅行者识别的测试
 * 依赖方向：测试文件，依赖 meta/traveler
 * 生命周期：无状态
 * 注意事项：钉住两处：叫法由元素表摊出、七个元素都在（漏一个则那个元素的主角又会被指去星铁），
 *          以及「空」「荧」本身不带元素（带上则查空时会被当成指定元素、按元素校验存档）。
 */
import { describe, expect, it } from "vitest"
import { eachElem } from "./elem.js"
import { isGsTraveler, isGsTravelerName, travelerElemOf, travelerNamesOf } from "./traveler.js"

describe("旅行者 id 与目录名", () => {
  it("男女 id、元数据 id 与米游社 id 都认，普通角色不误中", () => {
    for (const id of [7, "10000005", "10000007", "20000000"]) expect(isGsTraveler(id)).toBe(true)
    expect(isGsTraveler("10000130")).toBe(false)
  })

  it("空、荧与旅行者三个目录名都认，别的角色名不认", () => {
    for (const name of ["空", "荧", "旅行者"]) expect(isGsTravelerName(name)).toBe(true)
    expect(isGsTravelerName("莉奈娅")).toBe(false)
  })
})

describe("按元素的叫法", () => {
  it("七个元素各有「X主」「X主角」两种叫法，且认回同一个元素", () => {
    for (const { key, title } of eachElem("gs")) {
      expect(travelerNamesOf(key)).toEqual([`${title}主`, `${title}主角`])
      expect(travelerElemOf(`${title}主`)).toBe(key)
      expect(travelerElemOf(`${title}主角`)).toBe(key)
    }
  })

  it("中文元素名也能取叫法；认不出的元素给空数组", () => {
    expect(travelerNamesOf("冰")).toEqual(["冰主", "冰主角"])
    expect(travelerNamesOf("multi")).toEqual([])
  })

  it("空、荧与别的名字不带元素", () => {
    for (const name of ["空", "荧", "主角", "胡桃", "冰"]) expect(travelerElemOf(name)).toBe("")
  })
})
