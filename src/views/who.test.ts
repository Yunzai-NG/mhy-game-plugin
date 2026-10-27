/**
 * 模块职责：页头右上角那一格的测试
 * 依赖方向：测试文件，依赖 views/who
 * 生命周期：无状态
 * 注意事项：钉两处判据。一是**头像的根由标记指出**（`fromFace` 头像库 / `fromRes` 插件资源），
 *          两者都不给时模板一处根都不拼、于是相对路径取不到文件、表现是静默空白。
 *          二是昵称回落各游戏的称呼而非聊天平台昵称 —— 代查时印查询者的昵称就是错的。
 */
import { describe, expect, it } from "vitest"
import { PLAYER_NAMES, buildWho } from "./who.js"

describe("buildWho", () => {
  it("头像库里有那张时标 fromFace，模板据此拼 _face_path", () => {
    const got = buildWho({ game: "gs", uid: "100000001", face: "gs/mys/100000001.png" })
    expect(got.face).toBe("gs/mys/100000001.png")
    expect(got.fromFace).toBe(true)
    expect(got.fromRes).toBeUndefined()
  })

  it("一张都没取到时垫该游戏的默认图并标 fromRes", () => {
    for (const [game, file] of [
      ["gs", "common/face/gs.png"],
      ["sr", "common/face/sr.png"],
      ["zzz", "common/face/zzz.png"]
    ] as const) {
      const got = buildWho({ game })
      expect(got.face).toBe(file)
      expect(got.fromRes).toBe(true)
      expect(got.fromFace).toBeUndefined()
    }
  })

  it("昵称缺省回落各游戏的称呼，而不是留空或印聊天平台昵称", () => {
    expect(buildWho({ game: "gs" }).name).toBe(PLAYER_NAMES.gs)
    expect(buildWho({ game: "sr" }).name).toBe("开拓者")
    expect(buildWho({ game: "zzz" }).name).toBe("绳匠")
    expect(buildWho({ game: "gs", name: "昕城" }).name).toBe("昕城")
  })

  it("等级与世界等级排成可直接印的文案，缺则不给键", () => {
    const full = buildWho({ game: "gs", uid: "100000001", level: 60, world: 8 })
    expect(full.level).toBe("Lv.60")
    expect(full.world).toBe("世界 8")

    // 另两个游戏没有世界等级，那一段整个不画
    const sr = buildWho({ game: "sr", uid: "100000001", level: 70 })
    expect(sr.level).toBe("Lv.70")
    expect(sr.world).toBeUndefined()
  })

  it("等级为 0 与缺失同等对待 —— 印「Lv.0」比不印更像是数据错了", () => {
    const got = buildWho({ game: "gs", uid: "100000001", level: 0, world: 0 })
    expect(got.level).toBeUndefined()
    expect(got.world).toBeUndefined()
  })

  it("uid 为空时不给那个键，故不属某个玩家的图不会印出「UID」二字", () => {
    expect(buildWho({ game: "gs" }).uid).toBeUndefined()
    expect(buildWho({ game: "gs", uid: "" }).uid).toBeUndefined()
  })
})
