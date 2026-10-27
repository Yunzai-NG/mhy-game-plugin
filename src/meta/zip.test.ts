/**
 * 模块职责：zip 解包器的测试
 * 依赖方向：测试文件，只依赖 meta/zip.ts 与 node:zlib（自己造包）
 * 生命周期：无状态
 * 注意事项：本文件最要紧的一条是**白名单挡住 `.js`**：没按文件名放行时，包里的 `calc.js` 一类可执行代码
 *          一个都不落盘。这件事必须由断言看住，而不是靠记得。
 */
import { deflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { allowed, joinWithin, listEntries, singleRoot, unzip } from "./zip.js"

/** 造一个 zip 条目要写的两截字节 */
interface Piece {
  /** 本地文件头 + 数据 */
  local: Buffer
  /** 中央目录条目 */
  central: Buffer
}

/**
 * 造一个 zip 条目
 * @param path 包内路径
 * @param content 内容
 * @param offset 本地头在包中的偏移
 * @param store 是否用存储（不压缩）
 * @returns 两截字节
 */
function entry(path: string, content: string, offset: number, store = false): Piece {
  const name = Buffer.from(path, "utf8")
  const raw = Buffer.from(content, "utf8")
  const body = store ? raw : deflateRawSync(raw)
  const method = store ? 0 : 8

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(name.length, 26)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(body.length, 20)
  central.writeUInt32LE(raw.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE(offset, 42)

  return { local: Buffer.concat([local, name, body]), central: Buffer.concat([central, name]) }
}

/**
 * 造一个完整的 zip
 * @param files 路径 → 内容
 * @returns zip 字节
 */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [path, content] of Object.entries(files)) {
    const piece = entry(path, content, offset)
    locals.push(piece.local)
    centrals.push(piece.central)
    offset += piece.local.length
  }
  const body = Buffer.concat(locals)
  const dir = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(centrals.length, 8)
  eocd.writeUInt16LE(centrals.length, 10)
  eocd.writeUInt32LE(dir.length, 12)
  eocd.writeUInt32LE(body.length, 16)
  return Buffer.concat([body, dir, eocd])
}

describe("listEntries", () => {
  it("读出全部条目的路径与长度", () => {
    const zip = makeZip({ "a/data.json": '{"id":1}', "a/imgs/face.webp": "webp-bytes" })
    const list = listEntries(zip)

    expect(list.map(it => it.path)).toEqual(["a/data.json", "a/imgs/face.webp"])
    expect(list[0]?.size).toBe(8)
  })

  it("不是 zip 时明确报错，而不是解出一份空目录", () => {
    expect(() => listEntries(Buffer.from("这不是 zip"))).toThrow(/不是有效的 zip/)
  })
})

describe("allowed", () => {
  it("放行数据与图片", () => {
    for (const path of ["a/data.json", "a/face.webp", "a/x.png", "a/.sha"]) {
      expect(allowed(path, [".json", ".webp", ".png", ".sha"]), path).toBe(true)
    }
  })

  it("挡住 .js —— 这是本模块存在的理由", () => {
    for (const path of ["character/七七/calc.js", "artifact/artis-mark.js", "weapon/index.js"]) {
      expect(allowed(path, [".json", ".webp"]), path).toBe(false)
    }
  })

  it("没有扩展名的一律不放行", () => {
    expect(allowed("LICENSE", [".json"])).toBe(false)
  })
})

describe("unzip", () => {
  it("只解出白名单内的条目，可执行 JS 连内容都不取", () => {
    const zip = makeZip({
      "meta-gs/character/七七/data.json": '{"id":10000035,"name":"七七"}',
      "meta-gs/character/七七/calc.js": "export default function(){ throw new Error('不该被执行') }",
      "meta-gs/character/七七/imgs/face.webp": "webp"
    })
    const plan = unzip(zip, { strip: 1 })

    expect(plan.files.map(it => it.path)).toEqual(["character/七七/data.json", "character/七七/imgs/face.webp"])
    expect(plan.skipped).toBe(1)
  })

  it("解出的内容与原文一致", () => {
    const zip = makeZip({ "root/character/data.json": '{"10000035":{"name":"七七"}}' })
    const plan = unzip(zip, { strip: 1 })

    expect(plan.files[0]?.content.toString("utf8")).toBe('{"10000035":{"name":"七七"}}')
  })

  it("strip 剥掉归档的包装目录", () => {
    const zip = makeZip({ "meta-gs-abc123/character/data.json": "{}" })

    expect(unzip(zip, { strip: 1 }).files[0]?.path).toBe("character/data.json")
    expect(unzip(zip, { strip: 0 }).files[0]?.path).toBe("meta-gs-abc123/character/data.json")
  })

  it("超出体积上限时抛错 —— 远端给一个超大响应时不能一直往内存里读", () => {
    const zip = makeZip({ "a/data.json": "x".repeat(1000) })

    expect(() => unzip(zip, { maxBytes: 100 })).toThrow(/超过上限/)
  })

  it("目录里谎报小体积的压缩炸弹解不出来 —— 上限按自报体积累加，解压产出也按它封顶", () => {
    const zip = makeZip({ "a/data.json": "x".repeat(100_000) })
    const at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    zip.writeUInt32LE(10, at + 24)
    expect(() => unzip(zip, { maxBytes: 100 })).toThrow()
  })

  it("空文件照常解出", () => {
    expect(unzip(makeZip({ "a/empty.json": "" })).files[0]?.content.length).toBe(0)
  })

  it("目录条目不当成文件", () => {
    const zip = makeZip({ "a/": "", "a/data.json": "{}" })

    expect(unzip(zip).files.map(it => it.path)).toEqual(["a/data.json"])
  })
})

describe("joinWithin", () => {
  it("正常路径拼在目标目录内", () => {
    expect(joinWithin("/base", "character/七七/data.json")).toContain("character")
  })

  it("越界的路径一律拒绝 —— 包是下载来的，`../` 能写到目录之外", () => {
    for (const bad of ["../evil.json", "a/../../evil.json", "/etc/passwd", "C:/Windows/x.json"]) {
      expect(() => joinWithin("/base", bad), bad).toThrow(/越界/)
    }
  })
})

describe("singleRoot", () => {
  it("只有一个顶层目录时给出它的名字", () => {
    expect(singleRoot(["meta-gs/a.json", "meta-gs/b/c.json"])).toBe("meta-gs")
  })

  it("顶层有文件或有多个顶层目录时为 undefined", () => {
    expect(singleRoot(["a.json", "meta-gs/b.json"])).toBeUndefined()
    expect(singleRoot(["meta-gs/a.json", "meta-sr/b.json"])).toBeUndefined()
  })
})
