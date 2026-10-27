/**
 * 模块职责：UIGF 导入导出命令的测试
 * 依赖方向：测试文件，依赖 commands/uigf.ts 与真实的 GachaStore（跑在内存 KV 上）
 * 生命周期：无状态
 * 注意事项：固定三项口径：群聊一律拒绝（文件含完整抽卡历史与 uid）、导入的 uid 一并绑定（uid
 *          来自文件本身，可信）、**导入与同步共用去重**（先导一份朋友给的文件再自己同步一次不出
 *          现重复）。
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import { describe, expect, it } from "vitest"
import type { MhyConfigView } from "../config.js"
import { CONFIG_SCHEMA } from "../config.js"
import type { Session } from "../core/session.js"
import { GachaFileStore } from "../store/gacha-file.js"
import { GachaStore } from "../store/gacha.js"
import { UserStore } from "../store/user.js"
import type { MhyDeps } from "./deps.js"
import { exportGacha, importGacha } from "./uigf.js"

/** 静默日志器，用框架自带的那个 */
const LOGGER = fakeLogger()

/** 配置，由 schema 现算 —— 抄一份的话每加一个配置项都要跟着改 */
const CONFIG: MhyConfigView = {
  ...CONFIG_SCHEMA.parse({}),
  metaHost: "https://example.invalid"
}

/** 假会话，另带一个可注入的附件 */
interface Spy extends Session {
  /** 收到的全部回复 */
  readonly said: string[]
  /** 最后一句回复 */
  last(): string
  /** 发出去的文件 */
  readonly sent: { name: string; text: string }[]
}

/** 造一个假会话 */
function makeSession(
  init: Partial<Session> & { attach?: { name: string; text: string }; prompt?: { name: string; text: string } } = {}
): Spy {
  const said: string[] = []
  const sent: { name: string; text: string }[] = []
  return {
    user: init.user ?? "qq:1",
    name: init.name ?? "旅行者",
    rest: init.rest ?? "",
    game: init.game ?? "gs",
    isPrivate: init.isPrivate ?? true,
    isMaster: init.isMaster ?? false,
    isGroupAdmin: init.isGroupAdmin ?? false,
    botId: init.botId ?? "bot-1",
    lastSent: (): string => "msg-1",
    images: init.images ?? [],
    imageBytes: async (): Promise<boolean> => false,
    imageFile: async (): Promise<boolean> => false,
    forward: async (): Promise<boolean> => false,
    said,
    sent,
    last: (): string => said[said.length - 1] ?? "",
    text: async (content: string): Promise<void> => void said.push(content),
    image: async (): Promise<boolean> => false,
    ask: async (): Promise<string | undefined> => undefined,
    file: async (): Promise<{ name: string; text: string } | undefined> => init.attach,
    // 追问回来的下一条文件；导入的正常路径是本条无文件、由它把文件收下
    askFile: async (): Promise<{ name: string; text: string } | undefined> => init.prompt,
    sendFile: async (name: string, text: string): Promise<boolean> => {
      sent.push({ name, text })
      return true
    }
  }
}

/** 造一套依赖 */
function makeDeps(): { deps: MhyDeps; gacha: GachaStore; users: UserStore; dir: string } {
  const kv = new Kv(new MemoryKvDriver())
  const users = new UserStore({ kv: kv.sub("user") })
  const gacha = new GachaStore({
    kv: kv.sub("gacha"),
    // 导入导出全在本地完成，一个请求都不发，故这里不需要真的 HTTP
    http: {} as unknown as ConstructorParameters<typeof GachaStore>[0]["http"],
    logger: LOGGER,
    gap: (): number => 0
  })
  const dir = mkdtempSync(join(tmpdir(), "mhy-gacha-file-"))
  const gachaFiles = new GachaFileStore({ dir, logger: LOGGER })
  const deps = {
    gacha,
    users,
    gachaFiles,
    // 导出那一路要问一句"这个 uid 属于哪个米游社账号"（存档按 stuid 分层）。
    // 缺省答不上来 —— 那正是常态：抽卡记录只要 authkey，不要 Cookie
    cookies: { find: async (): Promise<undefined> => undefined },
    config: (): MhyConfigView => CONFIG,
    logger: LOGGER
  } as unknown as MhyDeps
  return { deps, gacha, users, dir }
}

/** 一份最小的 UIGF v4 文件 */
const FILE = JSON.stringify({
  info: { export_app: "test", version: "v4.0" },
  hk4e: [
    {
      uid: "100000001",
      list: [
        {
          id: "1700000000000000001",
          gacha_type: "301",
          uigf_gacha_type: "301",
          name: "胡桃",
          item_type: "角色",
          rank_type: "5",
          time: "2026-08-12 18:03:21"
        },
        {
          id: "1700000000000000002",
          gacha_type: "400",
          uigf_gacha_type: "301",
          name: "行秋",
          item_type: "角色",
          rank_type: "4",
          time: "2026-08-12 18:03:22"
        }
      ]
    }
  ]
})

describe("importGacha", () => {
  it("群聊里拒绝 —— 文件含完整抽卡历史与 uid", async () => {
    const { deps } = makeDeps()
    const s = makeSession({ isPrivate: false, attach: { name: "a.json", text: FILE } })
    await importGacha(s, deps)
    expect(s.last()).toContain("私聊")
  })

  it("没带文件时说清怎么发", async () => {
    const { deps } = makeDeps()
    const s = makeSession()
    await importGacha(s, deps)
    expect(s.last()).toContain("UIGF")
  })

  it("本条没文件时收下追问回来的那一条 —— QQ 发不出命令自带附件，故走这条路", async () => {
    const { deps, gacha } = makeDeps()
    const s = makeSession({ prompt: { name: "a.json", text: FILE } })
    await importGacha(s, deps)

    expect(s.last()).toContain("导入完成")
    expect((await gacha.pools("qq:1", "gs", "100000001")).length).toBeGreaterThan(0)
  })

  it("不是 json 时指出文件名，而不是只说格式错误", async () => {
    const { deps } = makeDeps()
    const s = makeSession({ attach: { name: "坏文件.json", text: "{不是json" } })
    await importGacha(s, deps)
    expect(s.last()).toContain("坏文件.json")
  })

  it("导入成功后记录进本地库，400 池并进 301", async () => {
    const { deps, gacha } = makeDeps()
    const s = makeSession({ attach: { name: "a.json", text: FILE } })
    await importGacha(s, deps)

    const records = await gacha.records("qq:1", "gs", "100000001", "301")
    expect(records).toHaveLength(2)
    expect(s.last()).toContain("100000001")
  })

  it("uid 一并绑上 —— 它来自文件本身，可信", async () => {
    const { deps, users } = makeDeps()
    await importGacha(makeSession({ attach: { name: "a.json", text: FILE } }), deps)
    expect(await users.uid("qq:1", "gs")).toBe("100000001")
  })

  it("导入两次不会翻倍 —— 按 id 去重", async () => {
    const { deps, gacha } = makeDeps()
    await importGacha(makeSession({ attach: { name: "a.json", text: FILE } }), deps)
    const second = makeSession({ attach: { name: "a.json", text: FILE } })
    await importGacha(second, deps)

    expect(await gacha.records("qq:1", "gs", "100000001", "301")).toHaveLength(2)
    expect(second.last()).toContain("新增 0")
  })

  it("不是 UIGF 格式时明确说不是", async () => {
    const { deps } = makeDeps()
    const s = makeSession({ attach: { name: "a.json", text: JSON.stringify({ hello: "world" }) } })
    await importGacha(s, deps)
    expect(s.last()).toContain("统一祈愿记录")
  })
})

describe("exportGacha", () => {
  it("群聊里拒绝", async () => {
    const { deps } = makeDeps()
    const s = makeSession({ isPrivate: false })
    await exportGacha(s, deps)
    expect(s.last()).toContain("私聊")
  })

  it("没有 uid 时提示先导入", async () => {
    const { deps } = makeDeps()
    const s = makeSession()
    await exportGacha(s, deps)
    expect(s.last()).toContain("抽卡链接")
  })

  it("导出成 v4，文件名带 uid", async () => {
    const { deps } = makeDeps()
    await importGacha(makeSession({ attach: { name: "a.json", text: FILE } }), deps)

    const s = makeSession()
    await exportGacha(s, deps)
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0]?.name).toContain("100000001")

    const out = JSON.parse(s.sent[0]?.text ?? "{}") as { info?: { version?: string }; hk4e?: unknown[] }
    expect(out.info?.version).toBe("v4.0")
    expect(out.hk4e).toHaveLength(1)
  })

  it("附加 v2 时导出旧格式 —— 有些工具只认它", async () => {
    const { deps } = makeDeps()
    await importGacha(makeSession({ attach: { name: "a.json", text: FILE } }), deps)

    const s = makeSession({ rest: "v2" })
    await exportGacha(s, deps)
    const out = JSON.parse(s.sent[0]?.text ?? "{}") as { info?: { uigf_version?: string }; list?: unknown[] }
    expect(out.info?.uigf_version).toBe("v2.3")
    expect(out.list).toHaveLength(2)
  })

  it("**同时在数据目录里落一份**：发文件依赖平台支持，存档不依赖", async () => {
    const { deps, dir } = makeDeps()
    await importGacha(makeSession({ attach: { name: "a.json", text: FILE } }), deps)

    const s = makeSession()
    await exportGacha(s, deps)

    // 按发起者（qq:1）分目录
    const file = join(dir, "qq_1", "gs", "100000001.json")
    expect(existsSync(file)).toBe(true)
    // 与发出去那份逐字相同 —— 两者不是两种格式
    expect(readFileSync(file, "utf8")).toBe(s.sent[0]?.text)
  })

  it("旧格式另存一个文件，不覆盖 v4 那一份 —— 两者口径不同", async () => {
    const { deps, dir } = makeDeps()
    await importGacha(makeSession({ attach: { name: "a.json", text: FILE } }), deps)

    await exportGacha(makeSession(), deps)
    await exportGacha(makeSession({ rest: "v2" }), deps)

    expect(existsSync(join(dir, "qq_1", "gs", "100000001.json"))).toBe(true)
    expect(existsSync(join(dir, "qq_1", "gs", "100000001_v2.json"))).toBe(true)
  })

  it("发不出文件时把存档路径告诉使用者 —— 那正是最需要存档的情形", async () => {
    const { deps } = makeDeps()
    await importGacha(makeSession({ attach: { name: "a.json", text: FILE } }), deps)

    const s = makeSession()
    // 平台发不了文件
    const dumb: Spy = { ...s, sendFile: async (): Promise<boolean> => false }
    await exportGacha(dumb, deps)

    expect(dumb.last()).toContain("100000001.json")
  })

  it("一条记录都没有时不发空文件", async () => {
    const { deps, users } = makeDeps()
    await users.addUid("qq:1", "gs", "100000009")

    const s = makeSession()
    await exportGacha(s, deps)
    expect(s.sent).toHaveLength(0)
    expect(s.last()).toContain("没有")
  })
})
