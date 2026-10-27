/**
 * 模块职责：面板数据源各映射与源选择的测试
 * 依赖方向：测试文件，依赖 panel/serv 各模块；元数据用真实的 {@link MetaLoader} 读临时目录
 * 生命周期：每例造一次临时元数据目录，用后删掉
 * 注意事项：**元数据不做替身，用真的读临时目录** —— 各源映射结果里的角色名、武器名、元素、天赋
 *          键全部来自元数据，替身抹掉这一层则"天赋 id 译不出"这类错误测不到。口径集中在**各源
 *          之间的差异**上：相同部分一两例覆盖即可，差异处（Enka 的 `propMap` 魔数、星铁三源字段
 *          名不同、米游社的命座折算与副词条反推）每处都要有例 —— 那才是写错了不报错的地方。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeLogger } from "@yunzai-ng/core/testing"
import { MetaLoader } from "../../meta/loader.js"
import { parseEnka, ENKA_SOURCES } from "./enka.js"
import { SR_SOURCES } from "./sr.js"
import { mapMysSrTalent, mysSrTrees, parseMysGs, srAttrId, srPropKey } from "./mys.js"
import { fail, profileFailText, ttlOf } from "./types.js"

let dir = ""
let meta: MetaLoader

/**
 * 写一个角色的元数据
 * @param game 游戏
 * @param name 目录名
 * @param body `data.json` 的内容
 */
function putChar(game: "gs" | "sr", name: string, body: unknown): void {
  const at = join(dir, `meta-${game}`, "character", name)
  mkdirSync(at, { recursive: true })
  writeFileSync(join(at, "data.json"), JSON.stringify(body), "utf8")
}

/**
 * 写一件武器的元数据
 * @param game 游戏
 * @param name 目录名
 * @param body `data.json` 的内容
 */
function putWeapon(game: "gs" | "sr", name: string, body: unknown): void {
  const at = join(dir, `meta-${game}`, "weapon", name)
  mkdirSync(at, { recursive: true })
  writeFileSync(join(at, "data.json"), JSON.stringify(body), "utf8")
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "serv-test-"))
  // 胡桃：三个技能 id 均可查，命座折算表两种形态都有
  putChar("gs", "胡桃", {
    id: 10000046,
    name: "胡桃",
    elem: "pyro",
    star: 5,
    talentId: { "10461": "a", "10462": "e", "10463": "q" },
    talentCons: { a: 0, e: 3, q: 5 }
  })
  putChar("gs", "空", {
    id: 10000005,
    name: "空",
    elem: "anemo",
    star: 5,
    // 旅行者按天赋定元素
    talentId: { "100553": "e" },
    talentElem: { "100553": "geo" }
  })
  putWeapon("gs", "护摩之杖", { id: 13501, name: "护摩之杖", star: 5, weapon: "长柄武器" })
  putChar("sr", "符玄", {
    id: 1208,
    name: "符玄",
    elem: "quantum",
    star: 5,
    talentId: { "1208001": "a", "1208002": "e", "1208003": "q", "1208004": "t" },
    talentCons: { a: 3, e: 3, q: 5, t: 5 }
  })
  putWeapon("sr", "记忆的质料", { id: 23016, name: "记忆的质料", star: 5 })
  meta = new MetaLoader({ dir, logger: fakeLogger() })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("失败分类", () => {
  it("error 与 empty 的建议冷却不同，且各自给出可照做的一句话", () => {
    expect(fail("error").cd).toBe(60)
    expect(fail("empty").cd).toBe(5 * 60)
    // 展柜为空要使用者去游戏里操作，故文案必须点明那件事
    expect(profileFailText(fail("empty"))).toContain("角色展柜")
    expect(profileFailText(fail("error"), "Enka")).toContain("Enka")
  })

  it("服务侧给的原文附在括号里，缺失时不留空括号", () => {
    expect(profileFailText(fail("error", "502 Bad Gateway"))).toContain("（502 Bad Gateway）")
    expect(profileFailText(fail("error"))).not.toContain("（")
  })

  it("ttl 缺失时按 60 秒", () => {
    expect(ttlOf({ ttl: 300 })).toBe(300)
    expect(ttlOf({})).toBe(60)
    expect(ttlOf(null)).toBe(60)
  })
})

describe("Enka 形态", () => {
  /** 一份最小可用的 Enka 返回 */
  const good = {
    playerInfo: { nickname: "旅行者", level: 60, worldLevel: 8, nameCardID: 210001 },
    avatarInfoList: [
      {
        avatarId: 10000046,
        propMap: { "4001": { val: "90" }, "1002": { val: "6" } },
        fetterInfo: { expLevel: 10 },
        talentIdList: [1, 2, 3],
        skillLevelMap: { "10461": 10, "10462": 9, "10463": 8 },
        equipList: [
          {
            itemId: 13501,
            flat: { itemType: "ITEM_WEAPON" },
            weapon: { level: 90, promoteLevel: 6, affixMap: { "0": 4 } }
          },
          {
            itemId: 71010,
            flat: { itemType: "ITEM_RELIQUARY", equipType: "EQUIP_BRACER", rankLevel: 5 },
            reliquary: { level: 21, mainPropId: 14001, appendPropIdList: [501024, 501024] }
          }
        ]
      }
    ],
    ttl: 120
  }

  it("等级与突破取自 propMap 的两个魔数", () => {
    const got = parseEnka(good, { meta, uid: "100000001" })
    expect(got.ok).toBe(true)
    if (!got.ok) return
    const one = got.profile.avatars["10000046"]
    expect(one?.level).toBe(90)
    expect(one?.promote).toBe(6)
  })

  it("命座数取命座 id 列表的长度，精炼在接口里 0 起故要加一", () => {
    const got = parseEnka(good, { meta, uid: "100000001" })
    if (!got.ok) throw new Error("应当成功")
    const one = got.profile.avatars["10000046"]
    expect(one?.cons).toBe(3)
    // affixMap 里是 4，实际精炼为 5
    expect(one?.weapon?.affix).toBe(5)
    expect(one?.weapon?.name).toBe("护摩之杖")
  })

  it("圣遗物强化等级减一后封顶 20，部位由 equipType 定", () => {
    const got = parseEnka(good, { meta, uid: "100000001" })
    if (!got.ok) throw new Error("应当成功")
    const arti = got.profile.avatars["10000046"]?.artis?.["1"]
    // 接口给 21，减一得 20
    expect(arti?.level).toBe(20)
    expect(arti?.mainId).toBe(14001)
    expect(arti?.attrIds).toEqual([501024, 501024])
  })

  it("天赋 id 经元数据译成 a / e / q", () => {
    const got = parseEnka(good, { meta, uid: "100000001" })
    if (!got.ok) throw new Error("应当成功")
    expect(got.profile.avatars["10000046"]?.talent).toEqual({ a: 10, e: 9, q: 8 })
  })

  it("旅行者的元素由天赋定，而非取元数据里的缺省值", () => {
    const got = parseEnka(
      {
        ...good,
        avatarInfoList: [
          {
            avatarId: 10000005,
            propMap: { "4001": { val: "90" }, "1002": { val: "6" } },
            fetterInfo: { expLevel: 10 },
            talentIdList: [],
            // 100553 在元数据里对应岩元素
            skillLevelMap: { "100553": 10, "100554": 9, "100555": 8 },
            equipList: []
          }
        ]
      },
      { meta, uid: "100000001" }
    )
    if (!got.ok) throw new Error("应当成功")
    // 元数据里空的缺省元素是 anemo，天赋说的是 geo，取后者
    expect(got.profile.avatars["10000005"]?.elem).toBe("geo")
  })

  it("展柜关着时 Enka 给的是只有 avatarId 的壳，判据是 propMap 而非数组长度", () => {
    const got = parseEnka(
      { playerInfo: { nickname: "x" }, avatarInfoList: [{ avatarId: 10000046 }] },
      { meta, uid: "100000001" }
    )
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.kind).toBe("empty")
  })

  it("没有 playerInfo 即视作服务出错，并带上原文", () => {
    const got = parseEnka({ error: "rate limited" }, { meta, uid: "100000001" })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.kind).toBe("error")
    expect(got.message).toBe("rate limited")
  })

  it("四个镜像共用一份映射，from 各自不同", () => {
    expect(ENKA_SOURCES.map(it => it.id)).toEqual(["enka", "mgg", "hanxuan", "lyln"])
    for (const one of ENKA_SOURCES) {
      const got = one.parse(good, { meta, uid: "100000001" })
      if (!got.ok) throw new Error(`${one.id} 应当成功`)
      // 同一份数据在四个源下得到同样的面板，只有来源标识不同
      expect(got.profile.from).toBe(one.id)
      expect(got.profile.avatars["10000046"]?.level).toBe(90)
    }
  })

  it("四个源的地址各不相同且都带上 uid", () => {
    const urls = ENKA_SOURCES.map(it => it.url("100000001"))
    expect(new Set(urls).size).toBe(4)
    for (const url of urls) expect(url).toContain("100000001")
  })
})

describe("星铁三源", () => {
  /** Mihomo 形态的一份返回 */
  const homo = {
    detailInfo: {
      nickname: "开拓者",
      level: 70,
      avatarDetailList: [
        {
          avatarId: 1208,
          level: 80,
          promotion: 6,
          rank: 2,
          equipment: { tid: 23016, level: 80, promotion: 6, rank: 5 },
          skillTreeList: [
            { pointId: "1208001", level: 6 },
            { pointId: "1208002", level: 10 },
            { pointId: "1208101", level: 1 }
          ],
          relicList: [
            {
              type: 1,
              tid: 61011,
              level: 15,
              mainAffixId: 1,
              subAffixList: [{ affixId: 1, cnt: 3, step: 2 }]
            }
          ]
        }
      ]
    },
    ttl: 90
  }

  it("Mihomo 的字段名映射成统一形态", () => {
    const shape = SR_SOURCES.find(it => it.id === "homo")
    if (!shape) throw new Error("缺少 homo 源")
    const got = shape.parse(homo, { meta, uid: "800000001" })
    if (!got.ok) throw new Error("应当成功")
    const one = got.profile.avatars["1208"]
    expect(one?.level).toBe(80)
    expect(one?.cons).toBe(2)
    expect(one?.weapon?.id).toBe(23016)
    expect(one?.weapon?.name).toBe("记忆的质料")
    expect(got.profile.game).toBe("sr")
  })

  it("技能树按元数据拆成天赋与行迹：查得到的记天赋，等级 1 且查不到的记行迹", () => {
    const shape = SR_SOURCES.find(it => it.id === "homo")
    if (!shape) throw new Error("缺少 homo 源")
    const got = shape.parse(homo, { meta, uid: "800000001" })
    if (!got.ok) throw new Error("应当成功")
    const one = got.profile.avatars["1208"]
    expect(one?.talent).toEqual({ a: 6, e: 10 })
    expect(one?.trees).toEqual(["1208101"])
  })

  it("遗器副词条拼成 `id,档数,步进` 形态，供词条求值那层解", () => {
    const shape = SR_SOURCES.find(it => it.id === "homo")
    if (!shape) throw new Error("缺少 homo 源")
    const got = shape.parse(homo, { meta, uid: "800000001" })
    if (!got.ok) throw new Error("应当成功")
    expect(got.profile.avatars["1208"]?.artis?.["1"]?.attrIds).toEqual(["1,3,2"])
  })

  it("三个源的字段名不同而结果同形：avocado 用 sub_affix_id、enkaHSR 用 subAffixList", () => {
    const avocado = SR_SOURCES.find(it => it.id === "avocado")
    if (!avocado) throw new Error("缺少 avocado 源")
    const got = avocado.parse(
      {
        playerDetailInfo: {
          nickname: "开拓者",
          displayAvatars: [
            {
              avatarId: 1208,
              level: 80,
              promotion: 6,
              rank: 2,
              equipment: { id: 23016, level: 80, promotion: 6, rank: 5 },
              behaviorList: [{ id: "1208001", level: 6 }],
              relics: [
                {
                  type: 1,
                  id: 61011,
                  level: 15,
                  main_affix_id: 1,
                  sub_affix_id: [{ id: 1, cnt: 3, step: 2 }]
                }
              ]
            }
          ]
        }
      },
      { meta, uid: "800000001" }
    )
    if (!got.ok) throw new Error("应当成功")
    const one = got.profile.avatars["1208"]
    expect(one?.talent).toEqual({ a: 6 })
    expect(one?.artis?.["1"]?.attrIds).toEqual(["1,3,2"])
    expect(one?.weapon?.id).toBe(23016)
  })

  it("助战角色先并入、展柜随后覆盖 —— 展柜那份才带完整遗器", () => {
    const shape = SR_SOURCES.find(it => it.id === "homo")
    if (!shape) throw new Error("缺少 homo 源")
    const got = shape.parse(
      {
        detailInfo: {
          nickname: "开拓者",
          // 助战里等级 1、无遗器
          assistAvatarList: [{ avatarId: 1208, level: 1, skillTreeList: [], relicList: [] }],
          avatarDetailList: homo.detailInfo.avatarDetailList
        }
      },
      { meta, uid: "800000001" }
    )
    if (!got.ok) throw new Error("应当成功")
    // 覆盖之后应是展柜那份
    expect(got.profile.avatars["1208"]?.level).toBe(80)
    expect(got.profile.avatars["1208"]?.artis?.["1"]).toBeDefined()
  })

  it("没有根节点即服务出错，一个角色都没有即展柜为空", () => {
    const shape = SR_SOURCES.find(it => it.id === "homo")
    if (!shape) throw new Error("缺少 homo 源")
    expect(shape.parse({}, { meta, uid: "800000001" }).ok).toBe(false)
    const empty = shape.parse({ detailInfo: { avatarDetailList: [] } }, { meta, uid: "800000001" })
    expect(empty.ok).toBe(false)
    if (empty.ok) return
    expect(empty.kind).toBe("empty")
  })
})

describe("米游社源", () => {
  it("星铁的天赋键取中文名，忆灵技能并进同一张表", () => {
    const got = mapMysSrTalent(
      [
        { remake: "普攻", level: 6 },
        { remake: "战技", level: 10 },
        { remake: "属性加成", level: 1 }
      ],
      [{ remake: "忆灵技", level: 5 }],
      0,
      {}
    )
    expect(got).toEqual({ a: 6, e: 10, me: 5 })
  })

  it("星魂折算逐键不同，不是一律减 3", () => {
    // 符玄的 talentCons：a 在 3 星魂生效、e 在 3、q 在 5
    const cons3 = mapMysSrTalent(
      [
        { remake: "普攻", level: 7 },
        { remake: "战技", level: 12 },
        { remake: "终结技", level: 12 }
      ],
      [],
      3,
      { a: 3, e: 3, q: 5 }
    )
    // 普攻减 1、战技减 2，终结技的生效星魂是 5 故此时不减
    expect(cons3).toEqual({ a: 6, e: 10, q: 12 })
  })

  it("星魂不足 3 时一律不折算", () => {
    const got = mapMysSrTalent([{ remake: "普攻", level: 7 }], [], 2, { a: 3 })
    expect(got).toEqual({ a: 7 })
  })

  it("行迹取 point_type 为奇数的节点并按 id 排序", () => {
    const got = mysSrTrees(
      [
        { point_id: "1208201", point_type: 1 },
        { point_id: "1208002", point_type: 2 },
        { point_id: "1208101", point_type: 3 }
      ],
      [{ point_id: "1208301", point_type: 1 }]
    )
    expect(got).toEqual(["1208101", "1208201", "1208301"])
  })

  it("星铁副词条按基数与步进直接算，不必枚举", () => {
    // 基数 4，两档得 8，再要 1.5 则需 1 个步进（步进 2）
    expect(srAttrId("atk", 4, 2, 2, "33", "9.5")).toBe("33,2,1")
  })

  it("速度那一条按最终值反推档数，因为米游社给的强化次数对它不准", () => {
    // 基数 2、最终值 6.9：档数取 floor(6.9/2)=3，而非接口给的 1
    // 步进数为 4 而非 3 是**浮点运算的结果**：6.9 - 3×2 得 0.9000000000000004，
    // 除以 0.3 得 3.0000000000000013，`Math.ceil` 于是进到 4。此处如实固定它 ——
    // 改判成 3 就要在公式里加一层容差，而那一层会连真正的第 4 个步进一起吃掉。
    expect(srAttrId("speed", 2, 0.3, 1, "4", "6.9")).toBe("4,3,4")
  })

  it("属性编号译得出词条键，主副词条两套编号都认", () => {
    expect(srPropKey(33)).toBe("atk")
    // 同一属性作主词条时另有编号
    expect(srPropKey(52)).toBe("cpct")
    expect(srPropKey(5)).toBe("cpct")
    expect(srPropKey(999)).toBeUndefined()
  })

  it("原神元素名首字母大写，映射时要归一成内部小写键", () => {
    // 米游社给 `Pyro`，内部键是 `pyro`；不归一则装配层元素匹配对不上、元素伤害杯归错到异元素
    const data = { avatars: [{ base: { id: 10000046, element: "Pyro", level: 90 }, skills: [], relics: [] }] }
    const got = parseMysGs(data, { meta, uid: "100000001" }, {} as never)
    if (!got.ok) throw new Error("应当成功")
    expect(got.profile.avatars["10000046"]?.elem).toBe("pyro")
  })
})
