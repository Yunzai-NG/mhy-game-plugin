/**
 * 模块职责：元数据安装器的测试
 * 依赖方向：测试文件，用临时目录与假 HttpClient 驱动 MetaInstaller
 * 生命周期：每个用例一个临时目录，用后即删
 * 注意事项：固定三条：**只有按文件名放行的那几个 JS 落盘**（用含 calc.js 与别的 JS 的真 zip 跑完整安装再断言），
 *          **增量附件须带 sha256**（不带的整批改走完整包），以及
 *          **增量包剥层的判定** —— 只改 character/ 的提交其包内路径顶层全是 character，按
 *          "只有一个顶层目录就剥一层"处理会把前缀削掉、文件落错位置。
 */
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deflateRawSync } from "node:zlib"
import type { HttpClient } from "@yunzai-ng/types"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { MetaCommit, MetaInstallerOptions } from "./download.js"
import { cleanupEmptyDirs, DownloadProgress, incrementalMatch, incrementalStrip, MetaInstaller, POOL_SOURCE, verifyHash } from "./download.js"

/** 静默日志器，测试不关心日志内容 */
const LOGGER = {
  trace: (): void => undefined,
  debug: (): void => undefined,
  info: (): void => undefined,
  mark: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  fatal: (): void => undefined,
  child: (): typeof LOGGER => LOGGER
} as unknown as MetaInstallerOptions["logger"]

/** 造一个 zip，与 zip.test.ts 同一套最小实现 */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path, "utf8")
    const raw = Buffer.from(content, "utf8")
    const deflated = deflateRawSync(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, deflated)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + deflated.length
  }

  const body = Buffer.concat(locals)
  const dir = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(dir.length, 12)
  eocd.writeUInt32LE(body.length, 16)
  return Buffer.concat([body, dir, eocd])
}

/** 一份带包装目录、含可执行 JS 的完整包，形态照真实归档 */
const FULL_ZIP = makeZip({
  "meta-gs/character/七七/data.json": '{"id":10000035,"name":"七七","abbr":"七七","star":5}',
  "meta-gs/character/七七/calc.js": "export default function calc() { return 1 }",
  "meta-gs/character/七七/artis.js": "export default {}",
  "meta-gs/character/data.json": '{"10000035":{"id":10000035,"name":"七七"}}',
  "meta-gs/weapon/sword/冷刃/data.json": '{"id":11301,"name":"冷刃","star":3}',
  "meta-gs/weapon/index.js": "export default {}",
  // 这一份是 hasCalc 的判据：原神星铁看 `artifact/`，路径固定
  "meta-gs/artifact/calc.js": "export default {}",
  "meta-gs/artifact/data.json": '{"idxs":[]}',
  // 这一份是 hasPool 的判据：三个游戏同在 `info/pool.js`。缺了它每条用例都会被自愈那一支
  // 推去下完整包（那正是它该有的行为），故各游戏的假包里都要有
  "meta-gs/info/pool.js": "export const poolDetail = []",
  // hasArtiMeta 的判据，缺了同样被推去下完整包
  "meta-gs/artifact/extra.js": "export const mainAttr = {}"
})

/**
 * 一份绝区零形态的完整包
 *
 * **不能并进 {@link FULL_ZIP}**：两个顶层目录会让解包那一步判成"没有包装目录"而不剥层，
 * 于是整份树多出一层、`character/` 找不到。与另两个游戏只差公式文件落在 `equip/` 而非
 * `artifact/` —— 绝区零没有 `artifact/` 那一层。
 */
const ZZZ_ZIP = makeZip({
  "meta-zzz/character/安比/data.json": '{"id":"1011","name":"安比","abbr":"安比","star":4}',
  "meta-zzz/character/安比/calc.js": "export default {}",
  "meta-zzz/character/data.json": '{"1011":{"id":"1011","name":"安比"}}',
  "meta-zzz/equip/calc.js": "export default {}",
  "meta-zzz/equip/data.json": '{"31000":{"id":"31000","name":"啄木鸟电音"}}',
  "meta-zzz/info/pool.js": "export const poolDetail = []"
})

/**
 * 一份星铁形态的完整包
 *
 * **卡池表在 `info/index.js`（不是 `pool.js`）**：真实的星铁下载源就是这个名字。用它验白名单认得出这个文件名、
 * 且 `hasPool("sr")` 据此为真、不再每次重下。
 */
const SR_ZIP = makeZip({
  "meta-sr/character/三月七/data.json": '{"id":1001,"name":"三月七","abbr":"三月七","star":4}',
  "meta-sr/character/data.json": '{"1001":{"id":1001,"name":"三月七"}}',
  "meta-sr/info/index.js": "export const poolDetailSr = []",
  "meta-sr/artifact/meta.js": "export const mainAttr = {}",
  "meta-sr/artifact/calc.js": "export default {}"
})

/** 造一个假 HttpClient：提交列表与包内容都由参数给定 */
/**
 * 增量附件：带上包的 sha256，未带哈希的附件会被整批改走完整包
 * @param path 地址
 * @param zip 包
 * @returns 附件
 */
function asset(path: string, zip: Buffer): NonNullable<MetaCommit["assets"]> {
  return { path, hash_algo: "sha256", hash_value: createHash("sha256").update(zip).digest("hex") }
}

function fakeHttp(commits: MetaCommit[], zip: Buffer): HttpClient {
  return {
    get: async <T,>(): Promise<T> => commits as unknown as T,
    download: async (_url: string, dest: string): Promise<string> => {
      mkdirSync(join(dest, ".."), { recursive: true })
      writeFileSync(dest, zip)
      return dest
    },
    buffer: async (): Promise<Uint8Array> => zip,
    request: async (): Promise<never> => {
      throw new Error("测试不该走到这里")
    },
    post: async (): Promise<never> => {
      throw new Error("测试不该走到这里")
    },
    extend: (): HttpClient => {
      throw new Error("测试不该走到这里")
    }
  } as unknown as HttpClient
}

/** 列出目录下的全部文件，相对根目录 */
function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const it of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, it.name)
    if (it.isDirectory()) out.push(...walk(full, base))
    else out.push(full.slice(base.length + 1).replaceAll("\\", "/"))
  }
  return out
}

describe("verifyHash", () => {
  it("sha256 一致时通过", () => {
    // "abc" 的 sha256
    const want = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    expect(verifyHash(Buffer.from("abc"), "sha256", want)).toBe(true)
  })

  it("sha256 不一致时拒绝", () => {
    expect(verifyHash(Buffer.from("abc"), "sha256", "0".repeat(64))).toBe(false)
  })

  it("没给哈希时拒绝 —— 增量包里有 calc.js，无从校验的包不能铺开（这类提交整批改走完整包）", () => {
    expect(verifyHash(Buffer.from("abc"), undefined, undefined)).toBe(false)
  })

  it("算法不是 sha256 时同样拒绝", () => {
    expect(verifyHash(Buffer.from("abc"), "md5", "900150983cd24fb0d6963f7d28e17f72")).toBe(false)
  })
})

describe("incrementalStrip", () => {
  it("包内路径与提交清单直接对得上时不剥层", () => {
    const commit: MetaCommit = {
      sha: "a".repeat(40),
      files: [{ path: "character/七七/calc.js", status: "modify" }, { path: "artifact/data.json", status: "modify" }]
    }
    expect(incrementalStrip(["character/七七/calc.js", "artifact/data.json"], commit)).toBe(0)
  })

  it("只改了一个目录下的文件时同样不剥层 —— 顶层同名不等于有包装目录", () => {
    // 这是照抄 singleRoot 判定会出错的那种情形：顶层全是 character，但它是真实前缀
    const commit: MetaCommit = {
      sha: "a".repeat(40),
      files: [
        { path: "character/七七/calc.js", status: "modify" },
        { path: "character/阿罗夏/calc.js", status: "modify" }
      ]
    }
    expect(incrementalStrip(["character/七七/calc.js", "character/阿罗夏/calc.js"], commit)).toBe(0)
  })

  it("确有包装目录时剥一层", () => {
    const commit: MetaCommit = {
      sha: "a".repeat(40),
      files: [{ path: "character/七七/calc.js", status: "modify" }]
    }
    expect(incrementalStrip(["meta-gs/character/七七/calc.js"], commit)).toBe(1)
  })

  it("提交清单为空时不剥层", () => {
    expect(incrementalStrip(["character/a.json"], { sha: "a".repeat(40) })).toBe(0)
  })

  it("删除条目不参与比对 —— 它们本就不在包里", () => {
    const commit: MetaCommit = {
      sha: "a".repeat(40),
      files: [{ path: "character/旧角色/data.json", status: "delete" }, { path: "character/a.json", status: "add" }]
    }
    expect(incrementalStrip(["character/a.json"], commit)).toBe(0)
  })

  it("一个改动文件都对不上时 undefined —— 那个包与提交信息不是一回事", () => {
    const commit: MetaCommit = {
      sha: "a".repeat(40),
      files: [{ path: "character/七七/data.json", status: "modify" }]
    }
    expect(incrementalStrip(["完全不相干/x.json"], commit)).toBeUndefined()
  })
})

describe("incrementalMatch", () => {
  it("只对上一部分时把命中数报出来 —— 调用方据此提醒包可能不完整", () => {
    const commit: MetaCommit = {
      sha: "a".repeat(40),
      files: [
        { path: "character/七七/data.json", status: "modify" },
        { path: "character/阿贝多/data.json", status: "modify" }
      ]
    }
    expect(incrementalMatch(["character/七七/data.json"], commit)).toEqual({ strip: 0, hits: 1, expected: 2 })
  })

  it("提交清单为空时命中数与期望数都是零", () => {
    expect(incrementalMatch(["character/a.json"], { sha: "a".repeat(40) })).toEqual({
      strip: 0,
      hits: 0,
      expected: 0
    })
  })
})

describe("cleanupEmptyDirs", () => {
  let dir = ""

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "meta-clean-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("一路向上删空目录，删到有东西的那一层就停", () => {
    mkdirSync(join(dir, "character", "七七", "imgs"), { recursive: true })
    writeFileSync(join(dir, "character", "data.json"), "{}", "utf8")

    cleanupEmptyDirs(dir, join(dir, "character", "七七", "imgs"))

    expect(existsSync(join(dir, "character", "七七"))).toBe(false)
    expect(existsSync(join(dir, "character", "data.json"))).toBe(true)
  })

  it("非空目录一个都不删", () => {
    mkdirSync(join(dir, "character", "七七"), { recursive: true })
    writeFileSync(join(dir, "character", "七七", "data.json"), "{}", "utf8")

    cleanupEmptyDirs(dir, join(dir, "character", "七七"))

    expect(existsSync(join(dir, "character", "七七"))).toBe(true)
  })

  it("绝不删基准目录自己 —— 那是整份元数据的根", () => {
    cleanupEmptyDirs(dir, dir)
    expect(existsSync(dir)).toBe(true)
  })
})

describe("DownloadProgress", () => {
  it("每涨过一档才报一行", () => {
    const p = new DownloadProgress({ at: 0, step: 100, idle: 1000 })
    expect(p.tick(10, 1)).toBe("log")
    // 同一档内不重复报
    expect(p.tick(50, 2)).toBe("quiet")
    expect(p.tick(120, 3)).toBe("log")
  })

  it("字节数不涨且超过阈值时报卡住，且报过就重新计时", () => {
    const p = new DownloadProgress({ at: 0, step: 100, idle: 1000 })
    p.tick(10, 1)
    expect(p.tick(10, 500)).toBe("quiet")
    expect(p.tick(10, 1001)).toBe("stall")
    expect(p.tick(10, 1002)).toBe("quiet")
    expect(p.tick(10, 2002)).toBe("stall")
  })

  it("一次都没涨过就绝不报卡住 —— 那多半是看错了地方，不该误报", () => {
    const p = new DownloadProgress({ at: 0, step: 100, idle: 1000 })
    expect(p.tick(0, 5000)).toBe("quiet")
    expect(p.tick(0, 99999)).toBe("quiet")
  })
})

describe("MetaInstaller", () => {
  let dir = ""

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "meta-test-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** 一条最新提交 */
  const commits: MetaCommit[] = [{ sha: "b".repeat(40), commit: { message: "test" } }]

  it("完整安装：只写数据文件与按文件名放行的 JS，别的 JS 一个都不落盘", async () => {
    const it0 = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    const res = await it0.install("gs")

    expect(res.status).toBe("install")
    const files = walk(join(dir, "meta-gs"))
    // 公式文件恒落盘：静态 buff 要从里面解析；执不执行另由 enableDmgCalc 管，落盘不等于执行
    expect(files).toContain("artifact/calc.js")
    expect(files).toContain("character/七七/calc.js")
    expect(files).toContain("character/七七/artis.js")
    // 不在放行名单里的 JS 照旧挡下
    expect(files).not.toContain("weapon/index.js")
    // 恒放行的那一份落盘了，它是卡池表的来源（见 hasPool）
    expect(files).toContain("info/pool.js")
    expect(files).toContain("character/七七/data.json")
    expect(files).toContain("weapon/sword/冷刃/data.json")
  })

  it("完整安装后记下版本号，据此判定已装", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await inst.install("gs")

    expect(inst.localSha("gs")).toBe("b".repeat(40))
    expect(inst.installed("gs")).toBe(true)
    expect(readFileSync(join(dir, "meta-gs", ".sha"), "utf8")).toBe("b".repeat(40))
  })

  it("已装且只要求补装时直接跳过，不重复下载", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await inst.install("gs")
    const again = await inst.install("gs", { installOnly: true })

    expect(again.status).toBe("exists")
  })

  it("本地已是最新时不动它", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await inst.install("gs")
    const again = await inst.install("gs")

    expect(again.status).toBe("latest")
  })

  it("本地没有公式文件时改走完整包 —— 早先关着伤害计算装的那种树，增量永远补不上", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await inst.install("gs")
    rmSync(join(dir, "meta-gs", "artifact", "calc.js"))
    expect(inst.hasCalc("gs")).toBe(false)

    const got = await inst.install("gs")
    expect(got.status).toBe("full")
    expect(got.message).toContain("公式")
    expect(inst.hasCalc("gs")).toBe(true)
    // 补上之后不再重复重下
    expect((await inst.install("gs")).status).toBe("latest")
  })

  it("本地缺卡池表时改走完整包 —— 与公式文件同理，增量永远补不上", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await inst.install("gs")
    expect(inst.hasPool("gs")).toBe(true)

    // 删掉它，模拟缺这个文件而版本号已是最新的那种树：
    // 于是卡池表一直空着、UP 判定一律答「无从判定」，且不报错
    rmSync(join(dir, "meta-gs", "info", POOL_SOURCE))
    expect(inst.hasPool("gs")).toBe(false)

    const got = await inst.install("gs")
    expect(got.status).toBe("full")
    expect(got.message).toContain("卡池")
    expect(inst.hasPool("gs")).toBe(true)
    // 补上之后不再重复重下
    expect((await inst.install("gs")).status).toBe("latest")
  })

  it("只要求补装时不因缺卡池表重下 —— 那会让每次启动都多下一遍整包", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await inst.install("gs")
    rmSync(join(dir, "meta-gs", "info", POOL_SOURCE))

    expect((await inst.install("gs", { installOnly: true })).status).toBe("exists")
  })

  it("星铁卡池表在 info/index.js —— 白名单认得出这个名、装完 hasPool 为真、不再每次重下整包", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, SR_ZIP), logger: LOGGER })
    const got = await inst.install("sr")

    expect(got.status).toBe("install")
    // 名字判错的表现：index.js 被当非数据滤掉、hasPool 恒假、下一次更新又重下整包
    expect(existsSync(join(dir, "meta-sr", "info", "index.js"))).toBe(true)
    expect(inst.hasPool("sr")).toBe(true)
    expect((await inst.install("sr")).status).toBe("latest")
  })

  it("只要求补装时不因缺公式文件重下 —— 那会让每次启动都多下一遍整包", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await inst.install("gs")
    rmSync(join(dir, "meta-gs", "artifact", "calc.js"))

    expect((await inst.install("gs", { installOnly: true })).status).toBe("exists")
    expect(inst.hasCalc("gs")).toBe(false)
  })

  it("未安装时 installed 为假 —— 空目录不算装好", () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    mkdirSync(join(dir, "meta-gs", "character"), { recursive: true })

    expect(inst.installed("gs")).toBe(false)
  })

  it("手工放进来的包：present 为真而 installed 为假，版本取自 version.json", () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    mkdirSync(join(dir, "meta-zzz", "character", "安比"), { recursive: true })
    writeFileSync(join(dir, "meta-zzz", "version.json"), JSON.stringify({ game: "zzz", version: "3.1" }), "utf8")

    // 没有 `.sha`，故"从下载源装好"不成立；但装载器读得了，故 present 为真
    expect(inst.installed("zzz")).toBe(false)
    expect(inst.present("zzz")).toBe(true)
    expect(inst.packVersion("zzz")).toBe("3.1")
    expect(inst.packVersion("gs")).toBe("")
  })

  it("绝区零与另两份同一条路 —— 分支名按 meta-<游戏> 拼，安装器这一层不为它分路", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    const res = await inst.install("zzz")

    expect(res.status).toBe("install")
    expect(inst.installed("zzz")).toBe(true)
    expect(existsSync(join(dir, "meta-zzz", "character", "七七", "data.json"))).toBe(true)
  })

  // 判据路径写错不报错 —— `hasCalc` 恒为假，于是**每次启动都重下一遍 45MB**
  it("绝区零的公式文件判据看 `equip/` —— 它没有 `artifact/` 那一层", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, ZZZ_ZIP), logger: LOGGER })
    await inst.install("zzz")
    expect(inst.hasCalc("zzz")).toBe(true)
    rmSync(join(dir, "meta-zzz", "equip", "calc.js"))

    const got = await inst.install("zzz")
    expect(got.status).toBe("full")
    expect(inst.hasCalc("zzz")).toBe(true)
    // 补上之后不再重复重下
    expect((await inst.install("zzz")).status).toBe("latest")
  })

  it("自动补装不覆盖手工放进来的包 —— 那一路是整目录换上，会把脚本另拉的内容一并删掉", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    mkdirSync(join(dir, "meta-zzz", "character", "安比"), { recursive: true })
    writeFileSync(join(dir, "meta-zzz", "character", "安比", "data.json"), '{"id":"1011"}', "utf8")

    const res = await inst.install("zzz", { installOnly: true })

    expect(res.status).toBe("exists")
    expect(readFileSync(join(dir, "meta-zzz", "character", "安比", "data.json"), "utf8")).toBe('{"id":"1011"}')
    // 仍没有 `.sha`：它不是从下载源装的，`#更新元数据` 才会把它换成有版本的那一份
    expect(inst.installed("zzz")).toBe(false)
  })

  it("取提交列表失败时给出可读结果而不是抛错 —— 网络不通不该让插件起不来", async () => {
    const http = {
      get: async (): Promise<never> => {
        throw new Error("connect ETIMEDOUT")
      }
    } as unknown as HttpClient
    const inst = new MetaInstaller({ dir, http, logger: LOGGER })
    const res = await inst.install("gs")

    expect(res.status).toBe("error")
    expect(res.message).toContain("ETIMEDOUT")
  })

  it("远端提交列表为空时同样不抛错", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp([], FULL_ZIP), logger: LOGGER })
    const res = await inst.install("gs")

    expect(res.status).toBe("error")
  })

  it("完整包缺 character 数据时判为校验失败，且不动原有目录", async () => {
    const bad = makeZip({ "meta-gs/info/index.json": "{}" })
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, bad), logger: LOGGER })

    await expect(inst.install("gs")).rejects.toThrow(/校验失败/)
    expect(existsSync(join(dir, "meta-gs", "character"))).toBe(false)
  })

  it("同一游戏并发安装会排队，不会同时写一个目录", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    const [a, b] = await Promise.all([inst.install("gs"), inst.install("gs")])

    // 先到的那个真装，后到的看到已是最新
    expect([a.status, b.status].sort()).toEqual(["install", "latest"])
  })

  it("两个游戏各自独立，装 gs 不影响 sr", async () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await inst.install("gs")

    expect(inst.installed("gs")).toBe(true)
    expect(inst.installed("sr")).toBe(false)
  })

  it("dirOf 落在给定的根目录之下", () => {
    const inst = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })

    expect(inst.dirOf("gs")).toBe(join(dir, "meta-gs"))
    expect(inst.dirOf("sr")).toBe(join(dir, "meta-sr"))
  })

  it("增量更新把远端的提交说明一并带回来 —— 只报「N 个提交」等于什么都没说", async () => {
    const first = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await first.install("gs")

    const inc = makeZip({ "character/阿贝多/data.json": '{"id":10000038,"name":"阿贝多","star":5}' })
    const next: MetaCommit[] = [
      {
        sha: "c".repeat(40),
        commit: { message: "新增阿贝多\n顺带换了一张图" },
        assets: asset("https://example.invalid/c.zip", inc),
        files: [{ path: "character/阿贝多/data.json", status: "add" }]
      },
      ...commits
    ]
    const second = new MetaInstaller({ dir, http: fakeHttp(next, inc), logger: LOGGER })
    const res = await second.install("gs")

    expect(res.status).toBe("update")
    expect(res.count).toBe(1)
    expect(res.messages).toEqual(["新增阿贝多\n顺带换了一张图"])
    expect(existsSync(join(dir, "meta-gs", "character", "阿贝多", "data.json"))).toBe(true)
    expect(second.localSha("gs")).toBe("c".repeat(40))
  })

  it("增量附件不带哈希时不铺开它，整批改走完整包 —— 无从校验的包里可能夹着 calc.js", async () => {
    const first = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await first.install("gs")

    const next: MetaCommit[] = [
      {
        sha: "c".repeat(40),
        assets: { path: "https://example.invalid/c.zip" },
        files: [{ path: "character/阿贝多/data.json", status: "add" }]
      },
      ...commits
    ]
    const res = await new MetaInstaller({ dir, http: fakeHttp(next, FULL_ZIP), logger: LOGGER }).install("gs")

    expect(res.status).toBe("full")
    expect(existsSync(join(dir, "meta-gs", "character", "阿贝多"))).toBe(false)
  })

  it("增量删掉最后一个文件后，那个空目录也一并清掉", async () => {
    const first = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await first.install("gs")
    expect(existsSync(join(dir, "meta-gs", "character", "七七"))).toBe(true)

    // 只删不加的提交不带增量附件，故不会被判成"增量资源不完整"
    const next: MetaCommit[] = [
      {
        sha: "d".repeat(40),
        commit: { message: "删掉七七" },
        files: [
          { path: "character/七七/data.json", status: "delete" },
          { path: "character/七七/calc.js", status: "delete" },
          { path: "character/七七/artis.js", status: "delete" }
        ]
      },
      ...commits
    ]
    const second = new MetaInstaller({ dir, http: fakeHttp(next, FULL_ZIP), logger: LOGGER })
    const res = await second.install("gs")

    expect(res.status).toBe("update")
    expect(existsSync(join(dir, "meta-gs", "character", "七七"))).toBe(false)
    // 上一层还有别的文件，故不该被一并删掉
    expect(existsSync(join(dir, "meta-gs", "character", "data.json"))).toBe(true)
  })

  it("增量包与提交信息对不上时拒绝铺开", async () => {
    const first = new MetaInstaller({ dir, http: fakeHttp(commits, FULL_ZIP), logger: LOGGER })
    await first.install("gs")

    const wrong = makeZip({ "毫不相干/x.json": "{}" })
    const next: MetaCommit[] = [
      {
        sha: "e".repeat(40),
        assets: asset("https://example.invalid/e.zip", wrong),
        files: [{ path: "character/阿贝多/data.json", status: "add" }]
      },
      ...commits
    ]
    const second = new MetaInstaller({ dir, http: fakeHttp(next, wrong), logger: LOGGER })

    await expect(second.install("gs")).rejects.toThrow(/不匹配/)
    expect(existsSync(join(dir, "meta-gs", "毫不相干"))).toBe(false)
  })
})
