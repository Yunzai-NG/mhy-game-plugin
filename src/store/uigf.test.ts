/**
 * 模块职责：UIGF / SRGF 导入导出的测试
 * 依赖方向：测试文件，只依赖 store/uigf.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：本文件固定四项口径：**v2 与 v4 两套格式都认**、**原神 400 池并入 301**、
 *          **同一 id 重复时追加序号**（一次十连的十条记录时间戳完全相同），以及
 *          **缺字段时明确指出缺哪个** —— 只回一句"格式错误"，使用者无从修正。
 */
import { describe, expect, it } from "vitest"
import type { UigfFile } from "./uigf.js"
import { buildUigf, detectUigfGame, parseUigf } from "./uigf.js"

/** 固定的"现在"：2026-08-22 13:20 */
const NOW = new Date(2026, 7, 22, 13, 20, 0).getTime()

/** 造一条 v2 记录 */
function item(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "1700000000000000001",
    gacha_type: "301",
    uigf_gacha_type: "301",
    name: "胡桃",
    item_type: "角色",
    rank_type: "5",
    time: "2026-08-12 18:03:21",
    ...over
  }
}

describe("detectUigfGame", () => {
  it("v4 按游戏键认", () => {
    expect(detectUigfGame({ hkrpg: [{ uid: "1", list: [] }] }, "gs")).toBe("sr")
    expect(detectUigfGame({ hk4e: [{ uid: "1", list: [] }] }, "sr")).toBe("gs")
    expect(detectUigfGame({ nap: [{ uid: "1", list: [] }] }, "gs")).toBe("zzz")
  })

  it("v2 靠 srgf_version 认星铁 —— 它没有游戏键", () => {
    expect(detectUigfGame({ info: { srgf_version: "v1.0" }, list: [] }, "gs")).toBe("sr")
  })

  it("都认不出时用调用方给的游戏 —— 使用者发的命令前缀本身就是一次表态", () => {
    expect(detectUigfGame({ info: { uid: "1" }, list: [] }, "zzz")).toBe("zzz")
  })
})

describe("parseUigf 校验", () => {
  it("不是 UIGF 结构时说清楚", () => {
    const ret = parseUigf({} as UigfFile, "gs")
    expect(ret.ok).toBe(false)
    expect(ret.message).toContain("统一祈愿记录")
  })

  it("记录为空时说清楚", () => {
    const ret = parseUigf({ info: { uid: "100000001" }, list: [] }, "gs")
    expect(ret.ok).toBe(false)
    expect(ret.message).toContain("没有任何抽卡记录")
  })

  it("缺字段时指出缺哪个 —— 只说「格式错误」使用者无从修正", () => {
    const ret = parseUigf({ info: { uid: "100000001" }, list: [{ time: "2026-08-12 18:03:21" }] }, "gs")
    expect(ret.ok).toBe(false)
    expect(ret.message).toContain("gacha_type")
  })

  it("没有 uid 时不收 —— 记录得挂在某个 uid 名下", () => {
    const ret = parseUigf({ list: [item()] } as UigfFile, "gs")
    expect(ret.ok).toBe(false)
    expect(ret.message).toContain("uid")
  })
})

describe("parseUigf v2", () => {
  it("读出 uid 与逐池记录", () => {
    const ret = parseUigf({ info: { uid: "100000001", uigf_version: "v2.3" }, list: [item()] }, "gs")
    expect(ret.ok).toBe(true)
    expect(ret.uid).toBe("100000001")
    expect(ret.records?.get("301")).toHaveLength(1)
    expect(ret.records?.get("301")?.[0]?.name).toBe("胡桃")
    expect(ret.records?.get("301")?.[0]?.rank).toBe(5)
  })

  it("原神 400 池并进 301 —— 两者共用同一套保底", () => {
    const ret = parseUigf(
      { info: { uid: "100000001" }, list: [item({ gacha_type: "400", uigf_gacha_type: "400", id: "1700000000000000002" })] },
      "gs"
    )
    expect(ret.records?.get("301")).toHaveLength(1)
    expect(ret.records?.get("400")).toBeUndefined()
  })

  it("13 位 id 补六个零 —— 拉取来的记录是 19 位，不补齐两者排不到一起", () => {
    const ret = parseUigf({ info: { uid: "100000001" }, list: [item({ id: "1700000000000" })] }, "gs")
    expect(ret.records?.get("301")?.[0]?.id).toBe("1700000000000000000")
  })

  it("同一 id 出现十几次时补出的序号互不相同、id 长度不变 —— 长度一变整组次序就乱", () => {
    const list = Array.from({ length: 12 }, () => item({ id: undefined }))
    const ids = (parseUigf({ info: { uid: "100000001" }, list }, "gs").records?.get("301") ?? []).map(it => it.id)
    expect(ids).toHaveLength(12)
    expect(new Set(ids).size).toBe(12)
    expect(new Set(ids.map(it => it.length)).size).toBe(1)
  })

  it("没有 id 时按时间造一个", () => {
    const ret = parseUigf({ info: { uid: "100000001" }, list: [item({ id: undefined })] }, "gs")
    const id = ret.records?.get("301")?.[0]?.id ?? ""
    expect(id.length).toBeGreaterThan(13)
    expect(id.endsWith("000000")).toBe(true)
  })

  it("同一 id 重复时追加序号 —— 一次十连的十条记录时间戳完全相同", () => {
    const ret = parseUigf(
      {
        info: { uid: "100000001" },
        list: [item({ id: "1700000000000" }), item({ id: "1700000000000", name: "行秋", rank_type: "4" })]
      },
      "gs"
    )
    const list = ret.records?.get("301") ?? []
    expect(list).toHaveLength(2)
    // 两条的 id 必须不同，否则去重时会被合并成一条
    expect(new Set(list.map(it => it.id)).size).toBe(2)
  })

  it("落库形态是新的在前", () => {
    const ret = parseUigf(
      {
        info: { uid: "100000001" },
        list: [item({ id: "1700000000000000001" }), item({ id: "1700000000000000009" })]
      },
      "gs"
    )
    expect(ret.records?.get("301")?.[0]?.id).toBe("1700000000000000009")
  })
})

describe("parseUigf v4", () => {
  it("从 hk4e 块里读记录", () => {
    const ret = parseUigf(
      { info: { version: "v4.0" }, hk4e: [{ uid: "100000001", lang: "zh-cn", list: [item()] }] },
      "sr"
    )
    expect(ret.ok).toBe(true)
    // 文件本身说了是原神，故不采用调用方给的 sr
    expect(ret.game).toBe("gs")
    expect(ret.uid).toBe("100000001")
  })

  it("只给 item_id 时靠元数据补名字", () => {
    const meta = {
      find: (): { id: string; name: string; abbr: string; star: number } | undefined => ({
        id: "10000046",
        name: "胡桃",
        abbr: "胡桃",
        star: 5
      })
    } as unknown as Parameters<typeof parseUigf>[2]
    const ret = parseUigf(
      {
        info: { version: "v4.0" },
        hk4e: [
          {
            uid: "100000001",
            list: [{ id: "1700000000000000001", gacha_type: "301", item_id: "10000046", time: "2026-08-12 18:03:21" }]
          }
        ]
      },
      "gs",
      meta
    )
    expect(ret.records?.get("301")?.[0]?.name).toBe("胡桃")
    expect(ret.records?.get("301")?.[0]?.rank).toBe(5)
  })

  it("星铁的块也认", () => {
    const ret = parseUigf(
      {
        info: { version: "v4.0" },
        hkrpg: [
          {
            uid: "100000001",
            // 星铁的 uigf_gacha_type 与 gacha_type 同值（该字段本是原神 301/400 合并用的），
            // 故此处一并改掉 —— 只改 gacha_type 会留下一个原神卡池号，记录会被整条跳过
            list: [item({ gacha_type: "11", uigf_gacha_type: "11", item_type: "光锥", name: "于夜色中" })]
          }
        ]
      },
      "gs"
    )
    expect(ret.game).toBe("sr")
    expect(ret.records?.get("11")?.[0]?.name).toBe("于夜色中")
  })

  it("星铁文件完全不带 uigf_gacha_type 也认 —— 那个字段本是原神专用", () => {
    const one = item({ gacha_type: "12", item_type: "光锥", name: "于夜色中" })
    delete one["uigf_gacha_type"]
    const ret = parseUigf({ info: { version: "v4.0" }, hkrpg: [{ uid: "100000001", list: [one] }] }, "gs")
    expect(ret.ok).toBe(true)
    expect(ret.records?.get("12")?.[0]?.name).toBe("于夜色中")
  })
})

describe("buildUigf", () => {
  /** 一份可导出的本地记录 */
  const pools = [
    {
      spec: { key: "301", types: ["301", "400"] },
      records: [
        { id: "1700000000000000009", pool: "301", name: "胡桃", itemType: "角色", rank: 5, time: "2026-08-12 18:03:21" },
        { id: "1700000000000000001", pool: "301", name: "行秋", itemType: "角色", rank: 4, time: "2026-08-12 18:03:20" }
      ]
    }
  ]

  it("v4 按游戏键分块，并带上导出程序信息", () => {
    const file = buildUigf("gs", "100000001", pools, "v4", { name: "Yunzai-NG", version: "0.1.0" }, undefined, NOW)
    expect(file.info?.version).toBe("v4.0")
    expect(file.info?.export_app).toBe("Yunzai-NG")
    expect(file.hk4e?.[0]?.uid).toBe("100000001")
    expect(file.hk4e?.[0]?.list).toHaveLength(2)
  })

  it("导出按 id 升序 —— 各家导入工具普遍如此排列", () => {
    const file = buildUigf("gs", "100000001", pools, "v4", { name: "Yunzai-NG", version: "0.1.0" }, undefined, NOW)
    const list = file.hk4e?.[0]?.list ?? []
    expect(list[0]?.id).toBe("1700000000000000001")
  })

  it("v2 原神写 uigf_version，且每条带 uigf_gacha_type", () => {
    const file = buildUigf("gs", "100000001", pools, "v2", { name: "Yunzai-NG", version: "0.1.0" }, undefined, NOW)
    expect(file.info?.uigf_version).toBe("v2.3")
    expect(file.list?.[0]?.uigf_gacha_type).toBe("301")
    // gacha_type 取卡池的第一个原始编号
    expect(file.list?.[0]?.gacha_type).toBe("301")
  })

  it("v2 星铁写 srgf_version 与时区，不写 uigf_gacha_type", () => {
    const srPools = [
      {
        spec: { key: "11", types: ["11"] },
        records: [
          { id: "1700000000000000001", pool: "11", name: "希儿", itemType: "角色", rank: 5, time: "2026-08-12 18:03:21" }
        ]
      }
    ]
    const file = buildUigf("sr", "100000001", srPools, "v2", { name: "Yunzai-NG", version: "0.1.0" }, undefined, NOW)
    expect(file.info?.srgf_version).toBe("v1.0")
    expect(typeof file.info?.region_time_zone).toBe("number")
    expect(file.list?.[0]?.uigf_gacha_type).toBeUndefined()
  })

  it("有元数据时补上 item_id —— 别处的工具靠它认物品", () => {
    const meta = {
      find: (_g: unknown, _id: unknown, name: string): { id: string; name: string; abbr: string; star: number } | undefined =>
        name === "胡桃" ? { id: "10000046", name: "胡桃", abbr: "胡桃", star: 5 } : undefined
    } as unknown as Parameters<typeof buildUigf>[5]
    const file = buildUigf("gs", "100000001", pools, "v4", { name: "Yunzai-NG", version: "0.1.0" }, meta, NOW)
    const hit = (file.hk4e?.[0]?.list ?? []).find(it => it.name === "胡桃")
    expect(hit?.item_id).toBe("10000046")
  })

  it("空记录也能导出一份合法文件 —— 导入方不该因此解析失败", () => {
    const file = buildUigf("gs", "100000001", [], "v4", { name: "Yunzai-NG", version: "0.1.0" }, undefined, NOW)
    expect(file.hk4e?.[0]?.list).toEqual([])
  })
})

describe("导出再导入", () => {
  it("走一圈回来，记录条数与物品名都对得上", () => {
    const pools = [
      {
        spec: { key: "301", types: ["301", "400"] },
        records: [
          { id: "1700000000000000009", pool: "301", name: "胡桃", itemType: "角色", rank: 5, time: "2026-08-12 18:03:21" },
          { id: "1700000000000000001", pool: "301", name: "行秋", itemType: "角色", rank: 4, time: "2026-08-12 18:03:20" }
        ]
      }
    ]
    const file = buildUigf("gs", "100000001", pools, "v4", { name: "Yunzai-NG", version: "0.1.0" }, undefined, NOW)
    // 经一次 JSON 往返，与真实的"导出成文件、再读回来"一致
    const back = parseUigf(JSON.parse(JSON.stringify(file)) as UigfFile, "gs")

    expect(back.ok).toBe(true)
    expect(back.uid).toBe("100000001")
    const list = back.records?.get("301") ?? []
    expect(list).toHaveLength(2)
    expect(list.map(it => it.name).sort()).toEqual(["胡桃", "行秋"])
  })

  it("v2 同样走得通", () => {
    const pools = [
      {
        spec: { key: "11", types: ["11"] },
        records: [
          { id: "1700000000000000001", pool: "11", name: "希儿", itemType: "角色", rank: 5, time: "2026-08-12 18:03:21" }
        ]
      }
    ]
    const file = buildUigf("sr", "100000001", pools, "v2", { name: "Yunzai-NG", version: "0.1.0" }, undefined, NOW)
    const back = parseUigf(JSON.parse(JSON.stringify(file)) as UigfFile, "gs")

    expect(back.game).toBe("sr")
    expect(back.records?.get("11")?.[0]?.name).toBe("希儿")
  })

  it("绝区零写真实类型、读回归到原卡池 —— 展示分类 `12001` 别家不认", () => {
    const pools = [
      {
        spec: { key: "12", types: ["12001"] },
        records: [
          { id: "1700000000000000001", pool: "12", name: "艾莲", itemType: "代理人", rank: 4, time: "2026-08-12 18:03:21" }
        ]
      }
    ]
    const file = buildUigf("zzz", "10000001", pools, "v4", { name: "Yunzai-NG", version: "0.1.0" }, undefined, NOW)
    const back = parseUigf(JSON.parse(JSON.stringify(file)) as UigfFile, "zzz")

    expect(file.nap?.[0]?.list?.[0]?.gacha_type).toBe("102")
    expect(back.records?.get("12")?.[0]?.name).toBe("艾莲")
  })
})
