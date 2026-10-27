/**
 * 模块职责：钉住版本号与更新日志一致
 * 依赖方向：测试文件，读 package.json 与 CHANGELOG.md
 * 生命周期：无状态
 * 注意事项：版本号只在 package.json 里写（内核据它补插件定义的 version）；发版忘了写更新日志时这里红。
 *          更新日志按 Keep a Changelog：标题形如 `## [1.0.0] - 2026-10-27`，文末有同名的链接定义。
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/** 仓库根 */
const ROOT = join(import.meta.dirname, "..")

describe("版本号", () => {
  it("更新日志里有 package.json 这一版的标题", () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }
    const log = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8")
    const v = version.replace(/\./g, "\\.")
    expect(log).toMatch(new RegExp(`^## \\[${v}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"))
    expect(log).toMatch(new RegExp(`^\\[${v}\\]: https://`, "m"))
  })

  it("入口不另写版本 —— 写了就有两处，改漏一处内核只记一条警告", () => {
    const entry = readFileSync(join(ROOT, "src", "index.ts"), "utf8")
    expect(entry).not.toMatch(/^\s+version:\s*["'`]/m)
  })
})
