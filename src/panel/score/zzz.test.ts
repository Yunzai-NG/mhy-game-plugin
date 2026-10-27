/**
 * 模块职责：绝区零驱动盘评分的测试
 * 依赖方向：测试文件，依赖 panel/score/zzz；覆盖表读本文件里照 `meta-zzz/equip/artis-mark.js` 写法造的替身
 * 生命周期：无状态
 * 注意事项：**口径集中在「抄错了不会报错」的那几处**：出现次数是否按权重累加、1~3 号位的起评分、
 *          4~6 号位主词条不对路时的扣分、数值词条权重按白值折算、属性伤害加成是否落到该代理人自己
 *          那一种 —— 算错的表现是一个看着正常的错分。覆盖表的键照元数据写正式名（`星见雅`）而接口给短名
 *          （`雅`），归一这一步漏掉则表里一半条目静默失效。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ZzzDisc } from "../profile/index.js"
import { scoreDiscs, scoreOneDisc, ZzzScoreTable, zzzScoreInput, zzzScoreWeight } from "./zzz.js"
import type { ZzzScoreInput } from "./zzz.js"

/*
 * 以下替身照元数据的写法手写，数值与角色随手取、不随游戏版本维护；真实元数据的整份解析由 `MHY_REAL_META` 那组覆盖
 */
const ZZZ_MARK = `export const usefulAttr = {
  "照": { "生命值百分比": 100, "攻击力百分比": 0, "暴击率": 50, "暴击伤害": 50, "能量自动回复": 100 },
  "星见雅": { "rules": ["主C·双爆"], "异常精通": 30, "异常掌控": 75 },
  "浮波柚叶": { "rules": ["辅助·异常", "辅助·双爆"], "攻击力百分比": 100 },
  "席德": ["主C·双爆"],
  "哲": {}
}
`

/**
 * 把覆盖表替身写进一个元数据根目录
 * @param root 元数据根目录
 */
function writeArtiMeta(root: string): void {
  const path = join(root, "meta-zzz", "equip", "artis-mark.js")
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, ZZZ_MARK, "utf8")
}

/** 落着覆盖表替身的元数据目录 */
const SHIPPED = mkdtempSync(join(tmpdir(), "zzz-score-shipped-"))
writeArtiMeta(SHIPPED)
afterAll(() => rmSync(SHIPPED, { recursive: true, force: true }))

/** 一位双爆拉满的物理强攻代理人 */
const MAIN_DPS: ZzzScoreInput = {
  name: "叶瞬光",
  prof: 1,
  elem: 200,
  final: { atk: 2760, cpct: 0.434, cdmg: 2.244, am: 94, ap: 102 },
  base: { hp: 7673, atk: 1681, def: 606 }
}

/**
 * 造一件驱动盘
 * @param pos 部位
 * @param main 主词条编号
 * @param subs 副词条，`[编号, 出现次数]`
 * @param opts 等级与稀有度
 * @returns 驱动盘
 */
function disc(
  pos: number,
  main: number,
  subs: readonly [number, number][],
  opts: { level?: number; rank?: string } = {}
): ZzzDisc {
  return {
    id: 30000 + pos,
    name: `测试[${pos}]`,
    pos,
    level: opts.level ?? 15,
    rank: opts.rank ?? "S",
    main: { id: main, name: "", value: "0", rolls: 1 },
    subs: subs.map(([id, rolls]) => ({ id, name: "", value: "0", rolls }))
  }
}

describe("权重的挑法", () => {
  it("职业定候选，判据定用哪一套", () => {
    // 强攻只有一套候选，不试判据
    expect(zzzScoreWeight(MAIN_DPS).rule).toBe("主C·双爆")
    // 击破有三套：双爆够就按双爆，不够而异常高就按异常
    const burst = { ...MAIN_DPS, prof: 2 }
    expect(zzzScoreWeight(burst).rule).toBe("冲击·双爆")
    expect(zzzScoreWeight({ ...burst, final: { atk: 2000, cpct: 0.05, cdmg: 0.5, ap: 260 } }).rule).toBe("冲击·异常")
  })

  it("属性伤害加成只认该代理人自己那一种", () => {
    const phy = zzzScoreWeight(MAIN_DPS).weight
    // 量纲是 0~100，与原神星铁那两份 `artifact/artis-mark.js` 同一副口径
    expect(phy["31503"]).toBe(100)
    expect(phy["31603"]).toBeUndefined()

    const fire = zzzScoreWeight({ ...MAIN_DPS, elem: 201 }).weight
    expect(fire["31603"]).toBe(100)
    expect(fire["31503"]).toBeUndefined()
  })

  it("数值词条的权重按白值折算：白值越低，一次数值强化越值", () => {
    const high = zzzScoreWeight(MAIN_DPS).weight
    const low = zzzScoreWeight({ ...MAIN_DPS, base: { hp: 7673, atk: 840, def: 606 } }).weight
    // 一次攻击力百分比是白值的 3%，一次数值固定 19 点
    expect(high["12103"]).toBeCloseTo((19 * 100) / (3 * 1681) * 75, 2)
    expect(low["12103"]).toBeGreaterThan(high["12103"] ?? 0)
    // 方案里没给生命值百分比权重，故数值那一项也不补
    expect(high["11103"]).toBeUndefined()
  })

  it("覆盖表里整套自定的那几位不走预设方案", () => {
    const table = new ZzzScoreTable({ metaDir: SHIPPED })
    const got = zzzScoreWeight({ ...MAIN_DPS, name: "照", prof: 5, elem: 202 }, table.override("照"))
    expect(got.rule).toBe("自定")
    // 按生命值成长的代理人：生命值百分比才是主要词条
    expect(got.weight["11102"]).toBe(100)
    // 整套自定的那几位把不要的词条显式写成 0，那与「没写」是同一个意思，都不计分
    expect(got.weight["12102"]).toBe(0)
  })

  it("覆盖表的正式名要归一到接口给的短名，否则一半条目静默失效", () => {
    const bare = new ZzzScoreTable({ metaDir: SHIPPED })
    // 表里写的是「星见雅」，接口给的是「雅」
    expect(bare.override("星见雅")).toBeDefined()
    expect(bare.override("雅")).toBeUndefined()

    const table = new ZzzScoreTable({
      metaDir: SHIPPED,
      canonical: name => ({ 星见雅: "雅", 浮波柚叶: "柚叶", 席德: "「席德」" })[name]
    })
    expect(table.override("雅")).toBeDefined()
    expect(table.override("柚叶")).toBeDefined()
    expect(table.override("「席德」")).toBeDefined()
    // 指定方案之外还改了几项时方案名带个记号
    const got = zzzScoreWeight({ ...MAIN_DPS, name: "雅", prof: 3, elem: 202 }, table.override("雅"))
    expect(got.rule).toBe("主C·双爆·改")
    expect(got.weight["31203"]).toBe(30)
  })

  it("覆盖表给空对象的那两位不评分", () => {
    const table = new ZzzScoreTable({ metaDir: SHIPPED })
    const got = zzzScoreWeight({ ...MAIN_DPS, name: "哲" }, table.override("哲"))
    expect(got.weight).toEqual({})
    expect(scoreOneDisc(disc(1, 11103, [[20103, 3]]), got.weight)).toBe(0)
  })

  it("覆盖表缺文件时不抛错，逐位回落到按职业挑", () => {
    const table = new ZzzScoreTable({ metaDir: join(SHIPPED, "不存在") })
    expect(table.override("照")).toBeUndefined()
    expect(zzzScoreWeight({ ...MAIN_DPS, prof: 6 }, table.override("仪玄")).rule).toBe("命破·双爆")
  })
})

describe("ZzzScoreTable 读元数据", () => {
  let metaDir = ""

  beforeEach(() => {
    metaDir = mkdtempSync(join(tmpdir(), "zzz-score-meta-"))
    mkdirSync(join(metaDir, "meta-zzz", "equip"), { recursive: true })
  })

  afterEach(() => {
    rmSync(metaDir, { recursive: true, force: true })
  })

  /**
   * 写一份 meta 里的 `equip/artis-mark.js`
   * @param body 文件内容
   */
  function putMetaMark(body: string): void {
    writeFileSync(join(metaDir, "meta-zzz", "equip", "artis-mark.js"), body, "utf8")
  }

  it("读 equip/artis-mark.js 的 usefulAttr", () => {
    putMetaMark('export const usefulAttr = {\n  照: { 攻击力百分比: 1 },\n  新代理人: ["命破·双爆"]\n}\n')
    const table = new ZzzScoreTable({ metaDir })

    expect(table.override("照")).toEqual({ 攻击力百分比: 1 })
    expect(table.override("新代理人")).toEqual(["命破·双爆"])
  })

  it("解不出内容时为空表，逐位回落到按职业挑", () => {
    putMetaMark("export const usefulAttr = { 照: 计算() }\n")
    expect(new ZzzScoreTable({ metaDir }).override("照")).toBeUndefined()
  })

  it("也走 canonical 归一 —— 表里正式名、接口短名", () => {
    putMetaMark('export const usefulAttr = {\n  "星见雅": ["主C·异常"]\n}\n')
    const table = new ZzzScoreTable({ metaDir, canonical: name => ({ 星见雅: "雅" })[name] })

    expect(table.override("雅")).toEqual(["主C·异常"])
  })

  it("reload 之后重新读", () => {
    putMetaMark('export const usefulAttr = { 照: ["辅助·双爆"] }\n')
    const table = new ZzzScoreTable({ metaDir })
    expect(table.override("照")).toEqual(["辅助·双爆"])

    putMetaMark('export const usefulAttr = { 照: ["辅助·异常"] }\n')
    expect(table.override("照")).toEqual(["辅助·双爆"])
    table.reload()
    expect(table.override("照")).toEqual(["辅助·异常"])
  })
})

describe("scoreOneDisc", () => {
  const weight = zzzScoreWeight(MAIN_DPS).weight

  it("副词条按「权重 × 出现次数」累加", () => {
    const few = scoreOneDisc(disc(1, 11103, [[21103, 1]]), weight)
    const many = scoreOneDisc(disc(1, 11103, [[21103, 4]]), weight)
    expect(many).toBeGreaterThan(few)
    // 理论上限是「最高权重那条算六次 + 另三条各一次」，故四次爆伤远不到满分
    expect(many).toBeLessThan(55)
  })

  it("1~3 号位主词条固定，副词条全不对路仍给起评分", () => {
    // 防御力百分比在双爆方案里权重为零
    const got = scoreOneDisc(disc(2, 12103, [[13102, 5]]), weight)
    expect(got).toBeCloseTo(12, 5)
  })

  it("4~6 号位主词条不对路要扣分", () => {
    const subs: readonly [number, number][] = [[12102, 3], [23203, 2]]
    // 暴击率与暴击伤害在双爆方案里权重相同，故主词条选哪个都一样
    expect(scoreOneDisc(disc(4, 21103, subs), weight)).toBeCloseTo(scoreOneDisc(disc(4, 20103, subs), weight), 5)
    // 生命值百分比在双爆方案里权重为零，主词条那 12 分全丢；**差值大于 12** ——
    // 主词条同时被排除在副词条的理论上限之外，故换成一个零权重的主词条时上限也随之变化
    const best = scoreOneDisc(disc(4, 21103, subs), weight)
    const worst = scoreOneDisc(disc(4, 11102, subs), weight)
    expect(best - worst).toBeGreaterThan(12)
  })

  it("等级与稀有度按倍率折算", () => {
    const subs: readonly [number, number][] = [[21103, 3], [20103, 2]]
    const full = scoreOneDisc(disc(4, 21103, subs), weight)
    // +0 是 0.25 倍
    expect(scoreOneDisc(disc(4, 21103, subs, { level: 0 }), weight)).toBeCloseTo(full * 0.25, 5)
    expect(scoreOneDisc(disc(4, 21103, subs, { rank: "A" }), weight)).toBeCloseTo(full * (2 / 3), 5)
    expect(scoreOneDisc(disc(4, 21103, subs, { rank: "B" }), weight)).toBeCloseTo(full / 3, 5)
  })

  it("权重整个为空时给 0 分而不是满分", () => {
    expect(scoreOneDisc(disc(4, 21103, [[21103, 5]]), {})).toBe(0)
  })
})

describe("scoreDiscs", () => {
  it("六件合计，档位按每件平均分取", () => {
    const discs = [1, 2, 3, 4, 5, 6].map(pos =>
      disc(pos, pos <= 3 ? [11103, 12103, 13103][pos - 1] as number : 21103, [
        [21103, 3],
        [20103, 3],
        [12102, 2],
        [23203, 1]
      ])
    )
    const got = scoreDiscs(discs, MAIN_DPS)
    expect(got.rule).toBe("主C·双爆")
    expect(got.score).toBeCloseTo([1, 2, 3, 4, 5, 6].reduce((sum, pos) => sum + (got.byPos[String(pos)] ?? 0), 0), 5)
    expect(Object.keys(got.byPos)).toHaveLength(6)
    expect(got.markClass).not.toBe("D")
  })

  it("少装一件要扣分：平均分按固定的六件算", () => {
    const one = disc(4, 21103, [[21103, 4], [20103, 3]])
    const six = scoreDiscs([1, 2, 3, 4, 5, 6].map(pos => ({ ...one, pos })), MAIN_DPS)
    const five = scoreDiscs([1, 2, 3, 4, 5].map(pos => ({ ...one, pos })), MAIN_DPS)
    expect(five.score).toBeLessThan(six.score)
  })
})

describe("zzzScoreInput", () => {
  it("百分比折成小数，白值缺失时用最终值兜", () => {
    const got = zzzScoreInput({
      name: "叶瞬光",
      rank: "S",
      prof: "强攻",
      elemId: 200,
      attrs: [
        { key: "atk", name: "攻击力", base: "1681", add: "1079", final: "2760" },
        { key: "cpct", name: "暴击率", final: "43.4%" },
        { key: "cdmg", name: "暴击伤害", final: "224.4%" }
      ],
      discs: []
    })
    expect(got.prof).toBe(1)
    expect(got.elem).toBe(200)
    expect(got.final.atk).toBe(2760)
    // 判据写的是「暴击率 × 2 + 爆伤 >= 2.2」，不折成小数会让每一位都命中第一套方案
    expect(got.final.cpct).toBeCloseTo(0.434)
    expect(got.final.cdmg).toBeCloseTo(2.244)
    expect(got.base.atk).toBe(1681)
    // 未装驱动盘那几行接口只给 final
    expect(got.base.hp).toBe(0)
  })

  it("套装 / 音擎 / 影画 / 逐位主词条一并交出，判据据此才看得见前提", () => {
    const got = zzzScoreInput(
      {
        name: "叶瞬光",
        rank: "S",
        prof: "强攻",
        elemId: 200,
        attrs: [],
        weapon: { id: 14143, name: "云霓孤光", level: 60, star: 3, rank: "S" },
        discs: [
          { ...disc(1, 11103, []), set: "啄木鸟电音" },
          { ...disc(2, 12103, []), set: "啄木鸟电音" },
          { ...disc(4, 20103, []), set: "啄木鸟电音" },
          { ...disc(5, 31503, []), set: "啄木鸟电音" },
          // 只装了一件的那套不成套，不该出现在 sets 里
          { ...disc(6, 30502, []), set: "獵兵重甲" }
        ]
      },
      3
    )
    // 件数按实际装着的数，不取接口的 `own`
    expect(got.sets).toEqual({ 啄木鸟电音: 4 })
    expect(got.weapon).toEqual({ name: "云霓孤光", star: 3 })
    // 影画数不在专属形态上，由调用方从 `StoredAvatar.cons` 传进来
    expect(got.cons).toBe(3)
    expect(got.mains).toEqual({ "1": 11103, "2": 12103, "4": 20103, "5": 31503, "6": 30502 })
  })

  it("四项都缺时一项都不出现，判据退回按面板值反推", () => {
    const got = zzzScoreInput({ name: "哲", rank: "S", prof: "强攻", elemId: 200, attrs: [], discs: [] })
    expect(got.sets).toBeUndefined()
    expect(got.weapon).toBeUndefined()
    expect(got.cons).toBeUndefined()
    expect(got.mains).toBeUndefined()
  })
})
