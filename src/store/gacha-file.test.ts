/**
 * 模块职责：抽卡本地存档的测试
 * 依赖方向：测试文件，依赖 store/gacha-file.ts，写临时目录
 * 生命周期：无状态
 * 注意事项：本文件固定三项口径：**路径分层为 `<用户>/<游戏>/<uid>.json`**（按发起导出的平台账号分目录，
 *          uid 在最里层，同一用户同一 uid 只有一个文件，重复导出即覆盖）、**旧格式另存 `_v2` 不覆盖 v4**，
 *          以及**路径每一段都要洗** —— 用户标识与 uid 都是外部来的串，`..` 直接拼进路径就能写到数据目录之外。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fakeLogger } from "@yunzai-ng/core/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { GachaFileStore } from "./gacha-file.js"

/** 静默日志器 */
const LOGGER = fakeLogger()

let dir = ""

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mhy-gacha-file-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 造一个存档器
 * @returns 存档器
 */
function store(): GachaFileStore {
  return new GachaFileStore({ dir, logger: LOGGER })
}

describe("GachaFileStore pathOf", () => {
  it("按 `<用户>/<游戏>/<uid>.json` 分层", () => {
    const got = store().pathOf("qq:1", "gs", "100000001")
    expect(relative(dir, got).split(/[\\/]/)).toEqual(["qq_1", "gs", "100000001.json"])
  })

  it("不同 qq 号各存各的 —— 同一个 uid 也落在各自目录下", () => {
    const one = store()
    expect(one.pathOf("qq:1", "gs", "100000001")).not.toBe(one.pathOf("qq:2", "gs", "100000001"))
  })

  it("旧格式另存一个文件，不覆盖 v4 那一份 —— 两者内容口径不同", () => {
    const one = store()
    expect(one.pathOf("qq:1", "sr", "100000001")).not.toBe(one.pathOf("qq:1", "sr", "100000001", { legacy: true }))
    expect(one.pathOf("qq:1", "sr", "100000001", { legacy: true })).toContain("100000001_v2.json")
  })

  it("**路径穿越的段被洗掉**：拼进 `..` 不该写到数据目录之外", () => {
    const got = store().pathOf("../x", "gs", "../../evil")
    // 洗过之后仍在根目录之下：relative 不以 `..` 起头
    expect(relative(dir, got).startsWith("..")).toBe(false)
    expect(got).not.toContain("..")
  })

  it("整段洗空时给一个固定名，而不是留一个空目录名", () => {
    const got = store().pathOf("...", "gs", "///")
    expect(relative(dir, got).split(/[\\/]/)).toEqual(["unknown", "gs", "unknown.json"])
  })
})

describe("GachaFileStore save", () => {
  it("目录不存在时一路建出来，内容逐字落盘", () => {
    const file = store().save("qq:1", "gs", "100000001", '{"a":1}')

    expect(file).toBeDefined()
    expect(existsSync(file ?? "")).toBe(true)
    expect(readFileSync(file ?? "", "utf8")).toBe('{"a":1}')
  })

  it("同一用户同一 uid 重复存即覆盖 —— 它是同一份数据，不该攒出一堆副本", () => {
    const one = store()
    one.save("qq:1", "gs", "100000001", "第一次")
    const file = one.save("qq:1", "gs", "100000001", "第二次")

    expect(readFileSync(file ?? "", "utf8")).toBe("第二次")
  })

  it("三个游戏各自成堆，同一用户下互不覆盖", () => {
    const one = store()
    one.save("qq:1", "gs", "100000001", "原神")
    one.save("qq:1", "zzz", "18707318", "绝区零")

    expect(readFileSync(one.pathOf("qq:1", "gs", "100000001"), "utf8")).toBe("原神")
    expect(readFileSync(one.pathOf("qq:1", "zzz", "18707318"), "utf8")).toBe("绝区零")
  })

  it("**写不进去时只记日志、交回 undefined**：存档是导出附带的一步，不该让整条命令报错", () => {
    /*
     * 在本该是目录的位置放一个文件，于是 `mkdirSync` 必然失败
     *
     * 这一条钉的是那个 `catch`：`#抽卡导出` 的正事是把文件发给使用者，存档是附带的一步 ——
     * 磁盘满了或目录不可写时抛错会让整条命令失败，而使用者要的那个文件本来是发得出去的。
     */
    writeFileSync(join(dir, "qq_1"), "我不是目录", "utf8")
    const one = store()

    expect(one.save("qq:1", "gs", "100000001", "x")).toBeUndefined()
  })
})
