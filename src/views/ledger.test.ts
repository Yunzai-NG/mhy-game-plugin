/**
 * 模块职责：札记视图模型的测试
 * 依赖方向：测试文件，只依赖 views/ledger.ts（纯函数）
 * 生命周期：无状态
 * 注意事项：固定两项：月份范围为显式结果（超出三个月即不发起请求）、两个游戏的货币字段归一为
 *          同一形状（`current_primogems` 对应 `current_hcoin`）。
 */
import { describe, expect, it } from "vitest"
import { buildLedger, ledgerTemplateData, ledgerText, resolveMonth } from "./ledger.js"

/** `ledgerTemplateData` 第三个参数的类型，造假元数据装载器时要它 */
type LedgerExtra = NonNullable<Parameters<typeof ledgerTemplateData>[2]>

/** 固定的当前时间：2026-08-22 */
const NOW = new Date(2026, 7, 22, 13, 20, 0).getTime()

/** 跨年场景使用的当前时间：2027-01-15 */
const NEW_YEAR = new Date(2027, 0, 15, 10, 0, 0).getTime()

describe("resolveMonth", () => {
  it("未指定月份时取本月，原神返回数字、星铁返回 202608", () => {
    expect(resolveMonth("", "gs", NOW)).toMatchObject({ ok: true, month: 8, label: "8 月", param: 8 })
    expect(resolveMonth("", "sr", NOW)).toMatchObject({ ok: true, month: 8, param: "202608" })
  })

  it("同时识别阿拉伯数字与中文数字", () => {
    expect(resolveMonth("7", "gs", NOW)).toMatchObject({ ok: true, month: 7, param: 7 })
    expect(resolveMonth("七月", "gs", NOW)).toMatchObject({ ok: true, month: 7 })
    expect(resolveMonth("#6月札记", "sr", NOW)).toMatchObject({ ok: true, month: 6, param: "202606" })
  })

  it("超出三个月即不发起请求，并明确指出可查询的月份", () => {
    const pick = resolveMonth("3", "gs", NOW)

    expect(pick.ok).toBe(false)
    expect(pick.message).toContain("最近三个月")
    expect(pick.message).toContain("6、7、8")
  })

  it("月份无法解析时给出一条可直接照用的示例", () => {
    expect(resolveMonth("上个月", "gs", NOW)).toMatchObject({ ok: false })
    expect(resolveMonth("13", "gs", NOW).message).toContain("#8月札记")
  })

  it("跨年时回退至上一年 —— 1 月查询 11 月取得的是上一年的 202611", () => {
    expect(resolveMonth("11", "sr", NEW_YEAR)).toMatchObject({ ok: true, month: 11, param: "202611" })
    expect(resolveMonth("11", "gs", NEW_YEAR)).toMatchObject({ ok: true, param: 11 })
  })
})

describe("buildLedger", () => {
  it("原神：原石折算抽数、与上月的差值、来源按数量降序排列", () => {
    const view = buildLedger(
      {
        data_month: 8,
        month_data: {
          current_primogems: 8080,
          last_primogems: 6000,
          current_mora: 3_000_000,
          last_mora: 3_500_000,
          group_by: [
            { action: "other", num: 80, percent: 1 },
            { action: "daily_activity", num: 4000, percent: 49 },
            { action: "spiral_abyss", num: 4000, percent: 50 }
          ]
        },
        day_data: { current_primogems: 60, current_mora: 20_000 }
      },
      { game: "gs", uid: "100000001", name: "旅行者", month: "8 月" }
    )

    expect(view.gameName).toBe("原神")
    expect(view.region).toBe("官服")
    expect(view.primary).toMatchObject({ label: "原石", current: 8080, last: 6000, delta: 2080 })
    expect(view.secondary).toMatchObject({ label: "摩拉", current: 3_000_000, delta: -500_000 })
    expect(view.gacha).toBe(50)
    expect(view.today).toEqual({ primary: 60, secondary: 20_000 })
    expect(view.slices.map(it => it.num)).toEqual([4000, 4000, 80])
  })

  it("星铁：字段名整套不同，输出形状完全一致", () => {
    const view = buildLedger(
      {
        month_data: {
          current_hcoin: 1600,
          last_hcoin: 1600,
          current_rails_pass: 12,
          last_rails_pass: 8,
          group_by: [{ action: "daily_reward", action_name: "每日活跃", num: 1600, percent: 100 }]
        },
        day_data: { current_hcoin: 20, current_rails_pass: 1 }
      },
      { game: "sr", uid: "100000001", name: "开拓者", month: "8 月" }
    )

    expect(view.primary).toMatchObject({ label: "星琼", current: 1600, delta: 0 })
    expect(view.secondary).toMatchObject({ label: "列车票", current: 12, delta: 4 })
    expect(view.gacha).toBe(10)
    // 星铁提供 action_name，原神仅有 action，标签取用的是面向使用者展示的那一项
    expect(view.slices[0]?.label).toBe("每日活跃")
  })

  it("data 为空时同样可生成视图，来源缺少 action 时补一个占位标签", () => {
    const view = buildLedger({ month_data: { group_by: [{ num: 5 }] } }, {
      game: "gs",
      uid: "100000001",
      name: "旅行者",
      month: "8 月"
    })

    expect(view.primary).toMatchObject({ current: 0, last: 0, delta: 0 })
    expect(view.gacha).toBe(0)
    expect(view.slices[0]?.label).toBe("其他")
    expect(() => ledgerText(view)).not.toThrow()
  })
})

describe("ledgerText", () => {
  it("先输出总数与抽数，其次为与上月的比较，最后为来源明细", () => {
    const view = buildLedger(
      {
        month_data: {
          current_primogems: 1600,
          last_primogems: 2000,
          current_mora: 100,
          last_mora: 100,
          group_by: [{ action: "任务", num: 1600, percent: 100 }]
        },
        day_data: { current_primogems: 0, current_mora: 0 }
      },
      { game: "gs", uid: "100000001", name: "旅行者", month: "8 月" }
    )
    const lines = ledgerText(view).split("\n")

    expect(lines[0]).toBe("原神 100000001（官服）8 月")
    expect(lines[1]).toBe("原石 1600，约 10 抽")
    expect(lines[2]).toContain("比上月少 400")
    expect(lines[4]).toContain("比上月多 0")
    expect(ledgerText(view)).toContain("任务 1600（100%）")
  })
})

describe("ledgerTemplateData", () => {
  /** 固定的"现在"：2026-08-22 */
  const NOW = new Date(2026, 7, 22, 13, 20, 0).getTime()

  it("原神：折算抽数、配色与两个 JSON 串都齐了", () => {
    const data = ledgerTemplateData(
      {
        data_month: 8,
        month_data: {
          current_primogems: 1600,
          last_primogems: 2000,
          current_mora: 500,
          last_mora: 400,
          group_by: [
            { action: "每日活跃", action_id: 3, num: 1000, percent: 62 },
            { action: "深境螺旋", action_id: 4, num: 600, percent: 38 }
          ]
        },
        day_data: { current_primogems: 60, current_mora: 20 }
      },
      { game: "gs", uid: "100000001", name: "旅行者", month: "8 月" },
      {},
      NOW
    )

    const md = data["month_data"] as Record<string, unknown>
    expect(md["gacha"]).toBe("10")
    // 2000/160 = 12.5，`toFixed(0)` 会进到 13
    expect(md["last_gacha"]).toBe("13")
    // 查的就是本月，故另附日期
    expect(data["day"]).toBe("8月22号")
    // 模板把这两串塞进 g2plot 的配置，故须为 JSON 文本
    expect(typeof data["group_by"]).toBe("string")
    expect(JSON.parse(String(data["color"]))).toEqual(["#bd9a5a", "#739970"])
  })

  it("原神：超过一万的数值折成 w，模板的数字格子按四字宽排版", () => {
    const data = ledgerTemplateData(
      { data_month: 8, month_data: { current_primogems: 23_456, current_mora: 1_234_567 } },
      { game: "gs", uid: "100000001", name: "旅行者", month: "8 月" },
      {},
      NOW
    )

    const md = data["month_data"] as Record<string, unknown>
    expect(md["current_primogems"]).toBe("2.35 w")
    expect(md["current_mora"]).toBe("123.5 w")
    // 折算前的原值才是抽数的依据
    expect(md["gacha"]).toBe("147")
  })

  it("原神：没装元数据时角标回落到既有的角色卡，随机数可注入", () => {
    const data = ledgerTemplateData(
      { data_month: 8 },
      { game: "gs", uid: "100000001", name: "旅行者", month: "8 月" },
      {},
      NOW,
      0
    )

    expect(data["icon"]).toBe("gs/ledger/icon/七七.png")
    expect(data["iconFromMeta"]).toBe(false)
  })

  it("装了元数据时角标改取元数据里的头像 —— 同一个角色，文件小得多", () => {
    // 只需 byName 一个方法，故用最小假件而非造一份真装载器
    const meta = {
      byName: (_game: string, name: string) => ({ face: `meta-gs/character/${name}/imgs/face.webp` })
    } as unknown as LedgerExtra["meta"]

    const data = ledgerTemplateData(
      { data_month: 8 },
      { game: "gs", uid: "100000001", name: "旅行者", month: "8 月" },
      { meta },
      NOW,
      0
    )

    expect(data["icon"]).toBe("meta-gs/character/七七/imgs/face.webp")
    // 两者不同根，模板据此选前缀
    expect(data["iconFromMeta"]).toBe(true)
  })

  it("元数据里查不到该角色时仍回落，不产出一个空路径", () => {
    const meta = { byName: () => undefined } as unknown as LedgerExtra["meta"]
    const data = ledgerTemplateData(
      { data_month: 8 },
      { game: "gs", uid: "100000001", name: "旅行者", month: "8 月" },
      { meta },
      NOW,
      0
    )

    expect(data["icon"]).toBe("gs/ledger/icon/七七.png")
    expect(data["iconFromMeta"]).toBe(false)
  })

  it("星铁：没装元数据时用 logo 兜底，装了则取角色头像", () => {
    const ctx = { game: "sr" as const, uid: "100000001", name: "开拓者", month: "8 月" }
    const bare = ledgerTemplateData({ data_month: "202608" }, ctx, {}, NOW, 0)
    expect(bare["icon"]).toBe("sr/other/logo.png")
    expect(bare["iconFromMeta"]).toBe(false)

    const meta = {
      byName: (_game: string, name: string) => ({ face: `meta-sr/character/${name}/imgs/face.webp` })
    } as unknown as LedgerExtra["meta"]
    const withMeta = ledgerTemplateData({ data_month: "202608" }, ctx, { meta }, NOW, 0)
    // 装了元数据时取角色头像
    expect(withMeta["icon"]).toBe("meta-sr/character/三月七/imgs/face.webp")
    expect(withMeta["iconFromMeta"]).toBe(true)
  })

  it("调用方显式给的 icon 按插件资源根处理", () => {
    const data = ledgerTemplateData(
      { data_month: 8 },
      { game: "gs", uid: "100000001", name: "旅行者", month: "8 月" },
      { icon: "gs/other/x.png" },
      NOW,
      0
    )

    expect(data["icon"]).toBe("gs/other/x.png")
    expect(data["iconFromMeta"]).toBe(false)
  })

  it("星铁：月份从 202608 里取，来源名截到四字并按标识配色", () => {
    const data = ledgerTemplateData(
      {
        data_month: "202608",
        month_data: {
          current_hcoin: 1600,
          current_rails_pass: 3,
          group_by: [{ action: "daily_reward", action_name: "每日实训奖励", num: 800, percent: 50 }]
        }
      },
      { game: "sr", uid: "100000001", name: "开拓者", month: "8 月" },
      {},
      NOW
    )

    expect(data["day"]).toBe("8月22号")
    const groups = JSON.parse(String(data["group_by"])) as { action_name: string; color: string }[]
    expect(groups[0]?.action_name).toBe("每日实训")
    expect(groups[0]?.color).toBe("#bd9a5a")
  })

  it("查往月时只给月份，不附日期", () => {
    const data = ledgerTemplateData(
      { data_month: 7 },
      { game: "gs", uid: "100000001", name: "旅行者", month: "7 月" },
      {},
      NOW
    )

    expect(data["day"]).toBe("7月")
  })

  it("空数据不炸，抽数为 0", () => {
    const data = ledgerTemplateData({}, { game: "gs", uid: "100000001", name: "旅行者", month: "8 月" }, {}, NOW)

    expect((data["month_data"] as Record<string, unknown>)["gacha"]).toBe("0")
    expect(JSON.parse(String(data["group_by"]))).toEqual([])
    expect(data["hasPie"]).toBe(false)
  })

  it("占比按数量重算 —— 接口给数量为 0 的项也报 1%，图例因此与饼图对不上", () => {
    const data = ledgerTemplateData(
      {
        data_month: "202608",
        month_data: {
          group_by: [
            { action: "daily_reward", action_name: "每日实训", num: 680, percent: 67 },
            { action: "event_reward", action_name: "活动奖励", num: 320, percent: 32 },
            { action: "other", action_name: "其他", num: 0, percent: 1 }
          ]
        }
      },
      { game: "sr", uid: "100000001", name: "开拓者", month: "8 月" },
      {},
      NOW
    )

    const md = data["month_data"] as { group_by: { percent: number }[] }
    expect(md.group_by.map(one => one.percent)).toEqual([68, 32, 0])
    // 饼图只画非零项，数量为 0 的那项不进 g2plot
    expect(JSON.parse(String(data["group_by"]))).toHaveLength(2)
    expect(data["hasPie"]).toBe(true)
  })

  it("各项数量全为 0 时不起饼图 —— g2plot 会把它们画成等分扇区", () => {
    const data = ledgerTemplateData(
      {
        data_month: 8,
        month_data: {
          group_by: [
            { action: "每日活跃", action_id: 3, num: 0, percent: 0 },
            { action: "深境螺旋", action_id: 4, num: 0, percent: 0 }
          ]
        }
      },
      { game: "gs", uid: "100000001", name: "旅行者", month: "8 月" },
      {},
      NOW
    )

    expect(data["hasPie"]).toBe(false)
    expect(JSON.parse(String(data["group_by"]))).toEqual([])
    // 图例仍列出全部来源
    expect((data["month_data"] as { group_by: unknown[] }).group_by).toHaveLength(2)
  })

  it("昵称给了就用，没给回落成聊天昵称", () => {
    const ctx = { game: "gs" as const, uid: "100000001", name: "旅行者", month: "8 月" }
    expect(ledgerTemplateData({}, ctx, { nickname: "派蒙" }, NOW)["nickname"]).toBe("派蒙")
    expect(ledgerTemplateData({}, ctx, {}, NOW)["nickname"]).toBe("旅行者")
  })
})
