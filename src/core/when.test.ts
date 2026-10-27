/**
 * 模块职责：core/when 的测试
 * 依赖方向：测试文件，只依赖 core/when；无 IO
 * 生命周期：无状态
 * 注意事项：**一律本地时区**，差八小时不报错，只让日历上每条活动的进度条整体偏移；
 *          {@link addDays} 须走 `setDate` 而非加毫秒，后者在有夏令时的时区上差一小时。
 */
import { describe, expect, it } from "vitest"
import { DAY_MS, addDays, atHour, dateTime, fullTime, isoDate, monthDayTime, parseWhen } from "./when.js"

/** 本地时区的 2026-08-12 06:00:00 */
const AUG12 = new Date(2026, 7, 12, 6, 0, 0).getTime()

describe("parseWhen", () => {
  it("按本地时区解析短横线写法", () => {
    expect(parseWhen("2026-08-12 06:00:00")).toBe(AUG12)
  })

  it("斜杠写法与短横线同解", () => {
    expect(parseWhen("2026/08/12 06:00:00")).toBe(AUG12)
  })

  it("只有日期时取当天零点", () => {
    expect(parseWhen("2026-08-12")).toBe(new Date(2026, 7, 12, 0, 0, 0).getTime())
  })

  it("首尾空白不影响", () => {
    expect(parseWhen("  2026-08-12 06:00:00  ")).toBe(AUG12)
  })

  it("解析不出时给 0，而不是 NaN —— NaN 会让整条进度条算成 NaN%", () => {
    expect(parseWhen("")).toBe(0)
    expect(parseWhen("下周三")).toBe(0)
  })
})

describe("addDays", () => {
  it("一天的毫秒数就是它", () => {
    expect(DAY_MS).toBe(86_400_000)
  })

  it("加减都认", () => {
    expect(isoDate(addDays(AUG12, 3))).toBe("2026-08-15")
    expect(isoDate(addDays(AUG12, -3))).toBe("2026-08-09")
  })

  it("跨月与跨年", () => {
    expect(isoDate(addDays(parseWhen("2026-08-31"), 1))).toBe("2026-09-01")
    expect(isoDate(addDays(parseWhen("2026-12-31"), 1))).toBe("2027-01-01")
    expect(isoDate(addDays(parseWhen("2026-01-01"), -1))).toBe("2025-12-31")
  })

  it("时分秒原样带着走 —— 深渊那 42 天靠它，改了时刻就换了一档", () => {
    expect(monthDayTime(addDays(AUG12, 42))).toBe("09-23 06:00")
  })
})

describe("atHour", () => {
  it("挪到当天某个整点，分秒归零", () => {
    expect(fullTime(atHour(parseWhen("2026-08-12 06:30:45"), 4))).toBe("2026-08-12 04:00:00")
  })

  it("小时可以比原来的大", () => {
    expect(fullTime(atHour(AUG12, 23))).toBe("2026-08-12 23:00:00")
  })
})

describe("格式化", () => {
  it("monthDayTime 是 MM-DD HH:mm，逐位补零", () => {
    expect(monthDayTime(parseWhen("2026-01-02 03:04:05"))).toBe("01-02 03:04")
  })

  it("dateTime 是 YYYY-MM-DD HH:mm", () => {
    expect(dateTime(AUG12)).toBe("2026-08-12 06:00")
  })

  it("fullTime 带上秒", () => {
    expect(fullTime(parseWhen("2026-08-12 06:00:09"))).toBe("2026-08-12 06:00:09")
  })

  it("isoDate 只有年月日", () => {
    expect(isoDate(AUG12)).toBe("2026-08-12")
  })

  it("三个格式化与 parseWhen 互逆", () => {
    expect(parseWhen(fullTime(AUG12))).toBe(AUG12)
  })
})
