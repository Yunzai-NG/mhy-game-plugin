/**
 * 模块职责：`#活动日历` 命令层的测试 —— 奖励图表里的每一张都真在插件资源里
 * 依赖方向：测试文件，依赖 commands/act-calendar 与仓库的 resources/；只读文件系统
 * 生命周期：无状态
 * 注意事项：表里路径写错不报错，图上那一格只是退成文字，故逐项钉文件存在。
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { REWARD_ICONS } from "./act-calendar.js"

const RES = join(import.meta.dirname, "..", "..", "resources")

describe("活动日历的奖励图表", () => {
  it.each(Object.entries(REWARD_ICONS).flatMap(([game, table]) => Object.entries(table).map(([name, rel]) => [game, name, rel])))(
    "%s %s → %s 在插件资源里",
    (_game, _name, rel) => {
      expect(existsSync(join(RES, rel))).toBe(true)
    }
  )
})
