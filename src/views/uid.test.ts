/**
 * 模块职责：uid 列表视图（`#我的uid`）的测试
 * 依赖方向：测试文件，只依赖 views/uid（纯函数）
 * 生命周期：无状态
 * 注意事项：三段顺序固定、没绑的游戏留空段而不消失 —— 模板按位置排版，缺一段就错位。
 *          手工绑的 uid 不标设备：设备随 CK 分配，标上会让人以为那个 uid 也在查私有数据。
 */
import { describe, expect, it } from "vitest"
import { buildUidList, uidListText } from "./uid.js"

describe("buildUidList", () => {
  it("三个游戏各一段，顺序固定 —— 模板据此排版，缺一段会错位", () => {
    const view = buildUidList({})
    expect(view.uids.map(it => it.key)).toEqual(["gs", "sr", "zzz"])
    expect(view.uids.map(it => it.mark)).toEqual(["#", "#星铁", "#绝区零"])
  })

  it("首项即当前 uid，只有它带 active", () => {
    const view = buildUidList({ gs: { uids: ["100000001", "100000002"] } })
    const gs = view.uids[0]
    expect(gs?.uid).toBe("100000001")
    expect(gs?.uidList.map(it => it.active)).toEqual([true, false])
  })

  it("区分 CK uid 与手工绑定 uid —— 前者能查私有数据，这个差别对使用者是实质的", () => {
    const view = buildUidList({
      gs: { uids: ["100000001", "100000002"], ckUids: ["100000001"] }
    })
    expect(view.uids[0]?.uidList.map(it => it.type)).toEqual(["ck", "reg"])
  })

  it("有 CK 的 uid 标出走真机还是虚拟设备", () => {
    const view = buildUidList({
      gs: {
        uids: ["100000001", "100000002"],
        ckUids: ["100000001", "100000002"],
        deviceUids: ["100000001"]
      }
    })
    expect(view.uids[0]?.uidList.map(it => it.device)).toEqual(["bound", "virtual"])
  })

  it("手工绑的 uid 不给设备 —— 设备随 CK 分配，标上会让人以为那个 uid 也在查私有数据", () => {
    const view = buildUidList({ gs: { uids: ["100000001"] } })
    expect(view.uids[0]?.uidList[0]?.device).toBeUndefined()
  })

  it("按 uid 前缀标出区服", () => {
    const view = buildUidList({ gs: { uids: ["100000001", "600000001", "800000001"] } })
    expect(view.uids[0]?.uidList.map(it => it.region)).toEqual(["官服", "美服", "亚服"])
  })

  it("带游戏昵称与等级，没有则不写这两个字段", () => {
    const view = buildUidList({
      gs: { uids: ["100000001", "100000002"], info: { "100000001": { name: "旅行者", level: 60 } } }
    })
    const [first, second] = view.uids[0]?.uidList ?? []
    expect(first?.name).toBe("旅行者")
    expect(first?.level).toBe(60)
    expect(second?.name).toBeUndefined()
    expect(second?.level).toBeUndefined()
  })

  it("没绑的游戏留空段而不是消失 —— 模板要显示「暂无 uid」的引导", () => {
    const view = buildUidList({ sr: { uids: ["100000001"] } })
    expect(view.uids[0]?.uidList).toEqual([])
    expect(view.uids[0]?.uid).toBeUndefined()
    expect(view.uids[1]?.uidList).toHaveLength(1)
  })

  it("头像库里那张走 fromFace，横幅原样带出、模板按 meta- 前缀决定资源根", () => {
    const view = buildUidList({
      gs: {
        uids: ["100000001"],
        info: {
          "100000001": {
            face: "gs/mys/100000001.png",
            banner: "meta-gs/character/胡桃/imgs/banner.webp"
          }
        }
      }
    })
    const first = view.uids[0]?.uidList[0]
    expect(first?.face).toBe("gs/mys/100000001.png")
    expect(first?.fromFace).toBe(true)
    expect(first?.fromRes).toBeUndefined()
    expect(first?.banner).toBe("meta-gs/character/胡桃/imgs/banner.webp")
  })

  it("一张头像都没取到时垫该游戏的默认图，而不是留空 —— 空串会让模板拼出资源根本身", () => {
    const view = buildUidList({ gs: { uids: ["100000001"] }, sr: { uids: ["100000001"] } })
    const gs = view.uids[0]?.uidList[0]
    expect(gs?.face).toBe("common/face/gs.png")
    // 默认图在插件资源里，根与头像库那条不同，标错是静默空白
    expect(gs?.fromRes).toBe(true)
    expect(gs?.fromFace).toBeUndefined()
    expect(gs?.banner).toBe("meta-gs/character/common/imgs/banner.webp")
    // 默认头像与公用横幅都按游戏分开，星铁那两张不在 gs 那一份下
    expect(view.uids[1]?.uidList[0]?.face).toBe("common/face/sr.png")
    expect(view.uids[1]?.uidList[0]?.banner).toBe("meta-sr/character/common/imgs/banner.webp")
  })

  it("绝区零与另两个游戏同一条路，头像不再有自己的分支；横幅仍用自带那张", () => {
    const view = buildUidList({ zzz: { uids: ["1000000001"] } })
    const first = view.uids[2]?.uidList[0]
    expect(first?.face).toBe("common/face/zzz.png")
    expect(first?.fromRes).toBe(true)
    expect(first?.zzz_banner).toBe(true)
    expect(first?.banner).toBeUndefined()
  })

  it("绝区零取到头像时印真头像与昵称等级，横幅仍用自带那张", () => {
    const view = buildUidList({
      zzz: {
        uids: ["1000000001"],
        info: { "1000000001": { name: "绳匠", level: 55, face: "zzz/mys/1000000001.png" } }
      }
    })
    const first = view.uids[2]?.uidList[0]

    expect(first?.face).toBe("zzz/mys/1000000001.png")
    expect(first?.fromFace).toBe(true)
    // 横幅元数据里没有逐代理人的那张，故仍走自带的
    expect(first?.zzz_banner).toBe(true)
    expect(first?.name).toBe("绳匠")
    expect(first?.level).toBe(55)
  })
})

describe("uidListText", () => {
  it("全都没绑时给出绑定命令，而不是回一句无数据", () => {
    const text = uidListText(buildUidList({}))
    expect(text).toContain("#绑定uid")
    expect(text).toContain("#绑定CK")
  })

  it("标出当前使用的那个，并注明来源", () => {
    const text = uidListText(
      buildUidList({ gs: { uids: ["100000001", "100000002"], ckUids: ["100000001"] } })
    )
    expect(text).toContain("原神")
    expect(text).toContain("1. 100000001（官服·CK）")
    expect(text).toContain("当前使用")
    expect(text).toContain("2. 100000002（官服·绑定）")
  })

  it("没绑的游戏不出现在文本里", () => {
    const text = uidListText(buildUidList({ gs: { uids: ["100000001"] } }))
    expect(text).toContain("原神")
    expect(text).not.toContain("绝区零")
  })
})
