/**
 * 模块职责：只读的最小 zip 解包器 —— 元数据包按扩展名白名单落盘
 * 依赖方向：只依赖 node:zlib 与 node:path，不引第三方库
 * 生命周期：无状态纯函数
 * 注意事项：**存在的理由是那份白名单**：包里除 JSON 与图片外还有几十个可执行 JS，本解包器只写白名单内的扩展名，
 *          `.js` 只按调用方给的**文件名**放行（`calc.js`、`alias.js` 一类，见 download.ts），其余一概不落盘。
 *          框架自带 tar.gz 解包，而元数据源只提供 zip，故另写；zip 要随机读尾部中央目录、无法流式，故调用方须先
 *          下载到磁盘再整份读入。不支持 zip64（元数据包远未触及界限），真遇到时明确报错而非静默解出缺文件的目录。
 */
import { inflateRawSync } from "node:zlib"
import { isAbsolute, join, normalize, relative, sep } from "node:path"

/** 中央目录条目的签名 */
const SIG_CENTRAL = 0x02014b50

/** 中央目录结束记录的签名 */
const SIG_EOCD = 0x06054b50

/** 本地文件头的签名 */
const SIG_LOCAL = 0x04034b50

/** 中央目录条目的固定长度 */
const CENTRAL_SIZE = 46

/** 本地文件头的固定长度 */
const LOCAL_SIZE = 30

/** 32 位字段的溢出标记，出现即意味着该包用了 zip64 */
const ZIP64_MARK = 0xffffffff

/** 允许落盘的扩展名 —— 元数据里只有这些是数据，其余（尤其 `.js`）一概不写 */
export const META_EXTENSIONS: readonly string[] = [
  ".json",
  ".webp",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ttf",
  ".woff",
  ".woff2",
  ".sha",
  ".txt",
  ".yaml",
  ".yml"
]

/** 一个 zip 条目 */
export interface ZipEntry {
  /** 包内路径，一律正斜杠 */
  path: string
  /** 压缩方式，0 存储 8 deflate */
  method: number
  /** 压缩后字节数 */
  compressedSize: number
  /** 解压后字节数 */
  size: number
  /** 本地文件头在包中的偏移 */
  offset: number
}

/** 解包选项 */
export interface UnzipOptions {
  /** 剥离前若干层路径；git 归档带一层分支名目录，取 1 */
  strip?: number
  /** 允许落盘的扩展名，缺省 {@link META_EXTENSIONS} */
  extensions?: readonly string[]
  /**
   * 额外按**文件名**放行的条目，如 `calc.js`
   *
   * 伤害公式必须以代码形态执行，故开启伤害计算时需让 `calc.js`/`artis.js` 落盘。刻意按文件名而非扩展名放行——
   * 改成放行 `.js` 会让包里其余几十个 JS 一并落盘、白名单失去意义。缺省为空。
   */
  filenames?: readonly string[]
  /** 解出总字节上限，超出即抛错 */
  maxBytes?: number
}

/**
 * 找到中央目录结束记录
 *
 * 该记录位于包尾，其后可跟最多 65535 字节的注释，故从尾部往前找签名。
 * @param buf 整个 zip
 * @returns 记录的偏移
 * @throws 找不到时（不是 zip，或被截断）
 */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 0xffff - 22)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  throw new Error("不是有效的 zip：找不到中央目录结束记录")
}

/**
 * 列出包内全部条目
 * @param buf 整个 zip
 * @returns 条目列表，顺序同中央目录
 * @throws 结构非法或用了 zip64 时
 */
export function listEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf)
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  if (at === ZIP64_MARK || count === 0xffff) throw new Error("该 zip 使用了 zip64，本解包器不支持")

  const out: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_SIZE > buf.length || buf.readUInt32LE(at) !== SIG_CENTRAL) {
      throw new Error(`zip 中央目录第 ${i + 1} 条已损坏`)
    }
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const compressedSize = buf.readUInt32LE(at + 20)
    const size = buf.readUInt32LE(at + 24)
    if (compressedSize === ZIP64_MARK || size === ZIP64_MARK) {
      throw new Error("该 zip 使用了 zip64，本解包器不支持")
    }
    out.push({
      path: buf.toString("utf8", at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLen).replaceAll("\\", "/"),
      method: buf.readUInt16LE(at + 10),
      compressedSize,
      size,
      offset: buf.readUInt32LE(at + 42)
    })
    at += CENTRAL_SIZE + nameLen + extraLen + commentLen
  }
  return out
}

/**
 * 取一个条目的内容
 * @param buf 整个 zip
 * @param entry 条目
 * @returns 解压后的字节
 * @throws 本地文件头损坏或压缩方式不受支持时
 */
export function readEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const at = entry.offset
  if (at + LOCAL_SIZE > buf.length || buf.readUInt32LE(at) !== SIG_LOCAL) {
    throw new Error(`zip 条目 ${entry.path} 的本地文件头已损坏`)
  }
  // 数据起点要按本地头自己的名字与扩展域长度算，它们可以与中央目录不同
  const start = at + LOCAL_SIZE + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28)
  const raw = buf.subarray(start, start + entry.compressedSize)
  // 解压产出按中央目录自报的大小封顶：`maxBytes` 累加的就是这个数，不封顶则伪造的小 size 配一个压缩炸弹能绕过上限
  if (entry.method === 0) return Buffer.from(raw.subarray(0, entry.size))
  if (entry.method === 8) {
    const out = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) })
    if (out.length !== entry.size) throw new Error(`zip 条目 ${entry.path} 解出的大小与目录记录不符`)
    return out
  }
  throw new Error(`zip 条目 ${entry.path} 用了不支持的压缩方式 ${entry.method}`)
}

/**
 * 剥掉前若干层路径
 * @param path 包内路径
 * @param strip 剥几层
 * @returns 剥后的路径；剥空时为空串
 */
function stripPath(path: string, strip: number): string {
  if (strip <= 0) return path
  const parts = path.split("/")
  return parts.length <= strip ? "" : parts.slice(strip).join("/")
}

/**
 * 拼一个位于目标目录内的路径，越界即抛错
 *
 * 包内路径来自远端，`../../` 一类写法可以把文件写到目标目录之外，故逐条复核。
 * @param base 基准目录绝对路径
 * @param name 包内相对路径
 * @returns 绝对路径
 * @throws 越出基准目录时
 */
export function joinWithin(base: string, name: string): string {
  if (isAbsolute(name) || /^[a-zA-Z]:/.test(name)) throw new Error(`zip 条目路径越界：${name}`)
  const full = normalize(join(base, name))
  const rel = relative(base, full)
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`zip 条目路径越界：${name}`)
  return full
}

/**
 * 判断一个路径的扩展名是否在白名单内
 * @param path 路径
 * @param allow 白名单
 * @returns 允许落盘时为真
 */
export function allowed(path: string, allow: readonly string[]): boolean {
  const at = path.lastIndexOf(".")
  if (at < 0) return false
  return allow.includes(path.slice(at).toLowerCase())
}

/** 一次解包的结果 */
export interface UnzipPlan {
  /** 要写的文件，路径相对目标目录 */
  files: { path: string; content: Buffer }[]
  /** 因扩展名不在白名单而跳过的条目数 */
  skipped: number
}

/**
 * 解出白名单内的条目
 *
 * 只算出"要写哪些文件"而不落盘：落盘涉及 IO，交由调用方处理，本模块得以保持为纯函数
 * 并可完整单测。
 * @param buf 整个 zip
 * @param opts 解包选项
 * @returns 待写文件与跳过条目数
 * @throws 结构非法、路径越界或超出体积上限时
 */
export function unzip(buf: Buffer, opts: UnzipOptions = {}): UnzipPlan {
  const allow = opts.extensions ?? META_EXTENSIONS
  const names = opts.filenames ?? []
  const strip = opts.strip ?? 0
  const files: { path: string; content: Buffer }[] = []
  let skipped = 0
  let total = 0

  for (const entry of listEntries(buf)) {
    // 目录条目以斜杠结尾，本身不承载内容
    if (entry.path.endsWith("/")) continue
    const path = stripPath(entry.path, strip)
    if (!path) continue
    // 扩展名在白名单内，或文件名被显式放行（见 UnzipOptions.filenames）
    const base = path.slice(path.lastIndexOf("/") + 1)
    if (!allowed(path, allow) && !names.includes(base)) {
      skipped++
      continue
    }
    total += entry.size
    if (opts.maxBytes !== undefined && total > opts.maxBytes) {
      throw new Error(`元数据包解出的体积超过上限 ${opts.maxBytes} 字节`)
    }
    files.push({ path, content: readEntry(buf, entry) })
  }
  return { files, skipped }
}

/**
 * 判断包内是否只有一个顶层目录
 *
 * git 归档统一带一层分支名目录，而增量包不带。调用方据此决定 `strip` 取 0 还是 1。
 * @param paths 包内路径列表
 * @returns 唯一的顶层目录名；不唯一或存在顶层文件时 undefined
 */
export function singleRoot(paths: readonly string[]): string | undefined {
  const roots = new Set<string>()
  for (const path of paths) {
    const at = path.indexOf("/")
    // 顶层就有文件，说明没有包装目录
    if (at <= 0) return undefined
    roots.add(path.slice(0, at))
  }
  const only = [...roots]
  return only.length === 1 ? only[0] : undefined
}

/** 供调用方复用的路径分隔符，Windows 上写文件时要用它拼目录 */
export const PATH_SEP = sep
