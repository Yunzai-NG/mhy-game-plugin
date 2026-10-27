/**
 * 模块职责：区服判定、DS 签名与接口表的测试
 * 依赖方向：测试文件，依赖 region.ts / ds.ts / api.ts
 * 生命周期：纯函数，无夹具
 * 注意事项：三者出错都不报错 —— 区服错给空数据，DS 与 query 顺序错给 `retcode 10001`（形似
 *          Cookie 过期），故断言一律固定字面取值而非只验"可执行"。
 */
import { describe, expect, it } from "vitest"
import { apiHosts, apiNames, buildApi, fpUrl } from "./api.js"
import { SALT_CN, SALT_OS, saltFor, signDs } from "./ds.js"
import { detectGame, gameBiz, getServer, isCnServer, isValidUid, resolveRegionKind, stripUids, uidInText } from "./region.js"

describe("getServer", () => {
  it("原神：官服 / B服 / 美服 / 欧服 / 亚服 / 港澳台", () => {
    expect(getServer("100000001", "gs")).toBe("cn_gf01")
    expect(getServer("500000001", "gs")).toBe("cn_qd01")
    expect(getServer("600000001", "gs")).toBe("os_usa")
    expect(getServer("700000001", "gs")).toBe("os_euro")
    expect(getServer("800000001", "gs")).toBe("os_asia")
    expect(getServer("1800000001", "gs")).toBe("os_asia")
    expect(getServer("900000001", "gs")).toBe("os_cht")
  })

  it("星铁沿用同一套前缀，区服标识改为 prod_*", () => {
    expect(getServer("100000001", "sr")).toBe("prod_gf_cn")
    expect(getServer("500000001", "sr")).toBe("prod_qd_cn")
    expect(getServer("800000001", "sr")).toBe("prod_official_asia")
  })

  it("绝区零：不足 10 位一律官服，10 位看前两位", () => {
    expect(getServer("10000001", "zzz")).toBe("prod_gf_cn")
    expect(getServer("1000000001", "zzz")).toBe("prod_gf_us")
    expect(getServer("1500000001", "zzz")).toBe("prod_gf_eu")
    expect(getServer("1300000001", "zzz")).toBe("prod_gf_jp")
    expect(getServer("1700000001", "zzz")).toBe("prod_gf_sg")
    expect(getServer("500000001", "zzz")).toBe("prod_gf_cn")
  })

  it("无法识别的前缀归为官服，而非抛出异常", () => {
    expect(resolveRegionKind("300000001", "gs")).toBe("official")
    expect(getServer("300000001", "gs")).toBe("cn_gf01")
  })
})

describe("isCnServer / gameBiz", () => {
  it("三个游戏的国服标识形态各异，但均可识别", () => {
    expect(isCnServer("cn_gf01")).toBe(true)
    expect(isCnServer("prod_gf_cn")).toBe(true)
    expect(isCnServer("os_asia")).toBe(false)
    expect(isCnServer("prod_official_usa")).toBe(false)
  })

  it("game_biz 按游戏与区服拼装", () => {
    expect(gameBiz("gs", true)).toBe("hk4e_cn")
    expect(gameBiz("sr", false)).toBe("hkrpg_global")
    expect(gameBiz("zzz", true)).toBe("nap_cn")
  })
})

describe("isValidUid", () => {
  it("仅拦截明显的非法输入", () => {
    expect(isValidUid("100000001")).toBe(true)
    expect(isValidUid(1800000001)).toBe(true)
    expect(isValidUid("10000001")).toBe(true)
    expect(isValidUid("123")).toBe(false)
    expect(isValidUid("01000000")).toBe(false)
    expect(isValidUid("10000000a")).toBe(false)
  })
})

describe("detectGame", () => {
  it("* 识别为星铁，% 与全角％识别为绝区零，并规整为统一前缀", () => {
    expect(detectGame("*体力")).toEqual({ game: "sr", text: "#星铁体力", matched: true })
    expect(detectGame("%体力")).toEqual({ game: "zzz", text: "#绝区零体力", matched: true })
    expect(detectGame("％体力").game).toBe("zzz")
    expect(detectGame("#星穹铁道角色").text).toBe("#星铁角色")
  })

  it("无前缀时归为原神，消息原样保留", () => {
    expect(detectGame("#体力")).toEqual({ game: "gs", text: "#体力", matched: false })
    expect(detectGame("#体力", "sr").game).toBe("sr")
  })
})

describe("signDs", () => {
  it("固定 t / r 时签名是确定值，形态为 t,r,md5", () => {
    const ds = signDs({ query: "role_id=1&server=cn_gf01", time: 1700000000, random: 123456 })

    expect(ds.startsWith("1700000000,123456,")).toBe(true)
    expect(ds).toMatch(/^\d+,\d+,[0-9a-f]{32}$/)
    expect(signDs({ query: "role_id=1&server=cn_gf01", time: 1700000000, random: 123456 })).toBe(ds)
  })

  it("query 顺序、body、盐任一处不同，签名即不同", () => {
    const base = { time: 1700000000, random: 123456 }
    const a = signDs({ ...base, query: "role_id=1&server=cn_gf01" })
    const b = signDs({ ...base, query: "server=cn_gf01&role_id=1" })
    const c = signDs({ ...base, query: "role_id=1&server=cn_gf01", body: "{}" })
    const d = signDs({ ...base, query: "role_id=1&server=cn_gf01", salt: SALT_OS })

    expect(new Set([a, b, c, d]).size).toBe(4)
  })

  it("未传入 t / r 时采用当前时间与 6 位随机数", () => {
    const [t, r] = signDs().split(",")

    expect(Number(t)).toBeGreaterThan(1_700_000_000)
    expect(r).toMatch(/^\d{6}$/)
  })

  it("按区服选盐", () => {
    expect(saltFor(true)).toBe(SALT_CN)
    expect(saltFor(false)).toBe(SALT_OS)
  })
})

describe("apiHosts / fpUrl", () => {
  it("国服与国际服的三组域名各不相同", () => {
    expect(apiHosts(true).hostRecord).toBe("https://api-takumi-record.mihoyo.com/")
    expect(apiHosts(false).hostRecord).toBe("https://bbs-api-os.hoyolab.com/")
    expect(fpUrl(true)).toBe("https://public-data-api.mihoyo.com/device-fp/api/getFp")
    expect(fpUrl(false)).toBe("https://sg-public-data-api.hoyoverse.com/device-fp/api/getFp")
  })
})

describe("buildApi", () => {
  const gs = { uid: "100000001", game: "gs" as const, server: "cn_gf01" }

  it("原神主链路接口的 URL 与 query 逐字符固定", () => {
    expect(buildApi("dailyNote", gs)).toEqual({
      url: "https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/dailyNote",
      query: "role_id=100000001&server=cn_gf01"
    })
    expect(buildApi("spiralAbyss", gs, { schedule_type: 2 })?.query).toBe(
      "role_id=100000001&schedule_type=2&server=cn_gf01"
    )
    expect(buildApi("spiralAbyss", gs)?.query).toContain("schedule_type=1")
    expect(buildApi("character", gs)?.body).toEqual({ role_id: "100000001", server: "cn_gf01" })
    expect(buildApi("ys_ledger", gs, { month: 8 })?.url).toBe("https://hk4e-api.mihoyo.com/event/ys_ledger/monthInfo")
  })

  it("原神国际服换算器与札记使用另一套域名并补充 lang", () => {
    const os = { uid: "600000001", game: "gs" as const, server: "os_usa" }

    expect(buildApi("detail", os, { avatar_id: 10000002 })?.url).toBe(
      "https://sg-public-api.hoyolab.com/event/calculateos/sync/avatar/detail"
    )
    expect(buildApi("detail", os, { avatar_id: 10000002 })?.query).toContain("lang=zh-cn")
    expect(buildApi("ys_ledger", os, { month: 8 })?.url).toBe("https://sg-hk4e-api.hoyolab.com/event/ysledgeros/month_info")
    expect(buildApi("blueprintCompute", os, { body: { a: 1 } })?.body).toEqual({ lang: "zh-cn", a: 1 })
  })

  it("星铁的四个深渊类接口各有独立路径", () => {
    const sr = { uid: "100000001", game: "sr" as const, server: "prod_gf_cn" }
    const path = (type: string): string | undefined => buildApi(type, sr)?.url

    expect(path("spiralAbyss")).toContain("/hkrpg/api/challenge")
    expect(path("challengeStory")).toContain("/hkrpg/api/challenge_story")
    expect(path("challengeBoss")).toContain("/hkrpg/api/challenge_boss")
    expect(path("challengePeak")).toContain("/hkrpg/api/challenge_peak")
    // 只有混沌回忆带 isPrev=true，其余三个须留空
    expect(buildApi("spiralAbyss", sr)?.query?.startsWith("isPrev=true")).toBe(true)
    expect(buildApi("challengeStory", sr)?.query?.startsWith("isPrev=&")).toBe(true)
  })

  it("绝区零国际服更换域名，且 dailyNote 不携带 lang", () => {
    const zzz = { uid: "1000000001", game: "zzz" as const, server: "prod_gf_us" }

    expect(buildApi("index", zzz)?.url).toBe("https://sg-act-nap-api.hoyolab.com/event/game_record_zzz/api/zzz/index")
    expect(buildApi("index", zzz)?.query).toBe("lang=zh-cn&role_id=1000000001&server=prod_gf_us")
    expect(buildApi("dailyNote", zzz)?.query).toBe("role_id=1000000001&server=prod_gf_us")
  })

  it("代理人面板的 id_list 落在 tail 上而不进 query —— 那一段不参与签名", () => {
    const zzz = { uid: "1300000001", game: "zzz" as const, server: "prod_gf_cn" }
    const got = buildApi("avatarInfo", zzz, { id_list: [1431, 1091] })

    // query 是签名覆盖的那一串，id_list 落进去即签名不符
    expect(got?.query).toBe("lang=zh-cn&role_id=1300000001&server=prod_gf_cn&need_wiki=false")
    expect(got?.tail).toBe("id_list[]=1431&id_list[]=1091")
    expect(buildApi("avatarInfo", zzz)?.tail).toBe("")
    expect(got?.query).toContain("lang=zh-cn")
  })

  it("接口名不存在时返回 undefined，由调用方决定应答内容", () => {
    expect(buildApi("不存在的接口", gs)).toBeUndefined()
    expect(buildApi("role_combat", { uid: "1000000001", game: "zzz", server: "prod_gf_cn" })).toBeUndefined()
  })

  it("每个游戏均具备 UserGame 与 dailyNote —— CK 校验与体力为全游戏主链路", () => {
    for (const game of ["gs", "sr", "zzz"] as const) {
      const names = apiNames(game)
      expect(names).toContain("UserGame")
      expect(names).toContain("dailyNote")
      expect(names).toContain("index")
    }
  })
})

describe("uidInText / stripUids", () => {
  it("8~10 位都认，两侧不挨着数字 —— 10 位国际服 uid 不被截成 9 位", () => {
    expect(uidInText("删除面板10000001")).toBe("10000001")
    expect(uidInText("更新面板100000001")).toBe("100000001")
    expect(uidInText("胡桃1500000001")).toBe("1500000001")
    expect(uidInText("12345678901")).toBeUndefined()
    expect(uidInText("胡桃")).toBeUndefined()
  })

  it("去掉全部 uid，名字留下", () => {
    expect(stripUids("胡桃100000001 面板")).toBe("胡桃 面板")
  })
})
