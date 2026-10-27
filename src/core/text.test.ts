/**
 * 模块职责：core/text 里两处"必须与 moment 同口径"的东西的测试
 * 依赖方向：测试文件，只依赖 core/text；无 IO
 * 生命周期：无状态
 * 注意事项：{@link humanize} 与 {@link CN_MONTHS} 沿用 moment 的口径，错了不报错，只是相对时间显示不一致；其中 `%d 秒` 与 `%d 个月` 的 11 两条分支在缺省阈值下走不到，沿用 moment 形态，故边界两侧都固定。{@link failText} 认不得的那一类必须带接口名与 retcode，否则一条命令三四个请求无从查起。
 */
import { describe, expect, it } from "vitest"
import type { QueryFail } from "../service/mys.js"
import { CN_MONTHS, failText, humanize } from "./text.js"

/** 一秒 */
const S = 1000

/** 一分 */
const M = 60 * S

/** 一小时 */
const H = 60 * M

/** 一天 */
const D = 24 * H

describe("humanize", () => {
  it("不足 45 秒一律是「几秒」", () => {
    expect(humanize(0)).toBe("几秒")
    expect(humanize(30 * S)).toBe("几秒")
    expect(humanize(44 * S)).toBe("几秒")
  })

  it("秒数跨过 44 就进分钟档 —— 「%d 秒」那一档在缺省阈值下走不到", () => {
    expect(humanize(44.5 * S)).toBe("1 分钟")
    expect(humanize(90 * S)).toBe("2 分钟")
  })

  it("分钟档到 45 分为止", () => {
    expect(humanize(25 * M)).toBe("25 分钟")
    expect(humanize(44 * M)).toBe("44 分钟")
    expect(humanize(44 * M + 40 * S)).toBe("1 小时")
  })

  it("小时档到 22 小时为止", () => {
    expect(humanize(3 * H)).toBe("3 小时")
    expect(humanize(21 * H)).toBe("21 小时")
    expect(humanize(22 * H)).toBe("1 天")
  })

  it("天数档到 26 天为止", () => {
    expect(humanize(3 * D)).toBe("3 天")
    expect(humanize(25 * D)).toBe("25 天")
    expect(humanize(26 * D)).toBe("1 个月")
  })

  it("月数按天数 × 4800 / 146097 折算，与 moment 的 daysToMonths 一致", () => {
    expect(humanize(60 * D)).toBe("2 个月")
    expect(humanize(300 * D)).toBe("10 个月")
  })

  it("月数一到 11 就报「1 年」—— 「11 个月」那一档同样走不到", () => {
    expect(humanize(330 * D)).toBe("1 年")
    expect(humanize(365 * D)).toBe("1 年")
  })

  it("超过一年按年报", () => {
    expect(humanize(1095 * D)).toBe("3 年")
  })

  it("取绝对值：日历里「多久前开始」与「多久后结束」用的是同一个函数", () => {
    expect(humanize(-3 * D)).toBe("3 天")
  })
})

describe("CN_MONTHS", () => {
  it("十二个月名，下标即 getMonth()", () => {
    expect(CN_MONTHS).toHaveLength(12)
    expect(CN_MONTHS[0]).toBe("一月")
    expect(CN_MONTHS[7]).toBe("八月")
    expect(CN_MONTHS[11]).toBe("十二月")
  })

  it("与 moment 的 zh-cn format(MMMM) 同形 —— 十月起是三个字", () => {
    expect(CN_MONTHS.slice(9)).toEqual(["十月", "十一月", "十二月"])
  })
})

describe("failText", () => {
  /**
   * 造一条失败结果
   * @param over 要覆盖的字段
   * @returns 失败结果
   */
  const fail = (over: Partial<QueryFail> = {}): QueryFail =>
    ({ ok: false, api: "avatarInfo", retcode: -400_005, message: "网页异常，请重新打开或联系客服", kind: "unknown", ...over }) as QueryFail

  it("认不得的那一类带上接口名与 retcode —— 一条命令里有三四个请求，不带就无从查起", () => {
    expect(failText(fail())).toBe("网页异常，请重新打开或联系客服（avatarInfo retcode -400005）")
  })

  it("认得的那几类只给处置办法，不带编号", () => {
    expect(failText(fail({ kind: "cookie" }))).toBe("ck已失效，请「#刷新ck」，无效则重新「#扫码登录」")
  })

  it("接口一句话都没给时仍有一句可读的话", () => {
    expect(failText(fail({ message: "", retcode: 0, api: "" }))).toBe("查询失败，请稍后重试")
  })
})
