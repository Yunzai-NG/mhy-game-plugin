/**
 * 模块职责：二维码编码 —— 把一段文本编成模块矩阵，并输出为 PNG 字节
 * 依赖方向：只依赖 `node:zlib`（PNG 的 IDAT 要 deflate）；不依赖内核，也不引第三方库
 * 生命周期：无状态纯函数
 * 注意事项：只做字节模式、只做纠错等级 M —— 唯一用途是把一条登录地址画成图。
 *
 *          写错的后果是一张无法识别的图而不是一个异常，故三处各有一道验证手段：纠错码按
 *          公开测试向量逐字节比对；模块放置、掩码与交织由测试里的最小解码器反向读回；
 *          版本表由「每版总码字数」这一独立已知量交叉核对。
 *
 *          矩阵不含空白区：{@link qrPng} 出图时才补四个模块宽的白边，缺了它多数手机无法识别。
 */
import { deflateSync } from "node:zlib"

/** 支持到的最大版本 —— 20 版在等级 M 下可放 669 个字节，远超一条登录地址 */
const MAX_VERSION = 20

/** 字节模式的模式指示符 */
const MODE_BYTE = 0b0100

/** 等级 M 的格式信息位，`(等级 << 3) | 掩码` 里的等级部分 */
const EC_LEVEL_M = 0b00

/** 填充字节，交替使用，照标准 */
const PAD_BYTES = [0xec, 0x11] as const

/**
 * 等级 M 各版本的分块参数
 *
 * 每项为 `[每块纠错码字数, 第一组块数, 第一组每块数据码字数, 第二组块数, 第二组每块数据码字数]`。
 * 与 {@link TOTAL_CODEWORDS} 交叉核对：两者由标准的不同表格给出，
 * `块数 × (数据 + 纠错)` 之和必须等于总码字数，任一项抄错都会在测试里当场暴露。
 */
export const EC_BLOCKS_M: readonly (readonly [number, number, number, number, number])[] = [
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
  [30, 1, 50, 4, 51],
  [22, 6, 36, 2, 37],
  [22, 8, 37, 1, 38],
  [24, 4, 40, 5, 41],
  [24, 5, 41, 5, 42],
  [28, 7, 45, 3, 46],
  [28, 10, 46, 1, 47],
  [26, 9, 43, 4, 44],
  [26, 3, 44, 11, 45],
  [26, 3, 41, 13, 42]
]

/** 各版本的总码字数，取自标准，用于交叉核对 {@link EC_BLOCKS_M} */
export const TOTAL_CODEWORDS: readonly number[] = [
  26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085
]

/** 各版本的定位图案中心坐标，取自标准；1 版没有定位图案 */
const ALIGN_CENTERS: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90]
]

/** GF(256) 的指数表，本原多项式 0x11d */
const GF_EXP = new Uint8Array(512)
/** GF(256) 的对数表 */
const GF_LOG = new Uint8Array(256)

for (let i = 0, x = 1; i < 255; i += 1) {
  GF_EXP[i] = x
  GF_LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}
for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255] as number

/**
 * GF(256) 上的乘法
 * @param a 乘数
 * @param b 乘数
 * @returns 积
 */
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[((GF_LOG[a] as number) + (GF_LOG[b] as number)) % 255] as number
}

/**
 * 生成 n 次纠错生成多项式
 * @param n 纠错码字数
 * @returns 系数，最高次在前
 */
function rsGenerator(n: number): number[] {
  let poly = [1]
  for (let i = 0; i < n; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] as number) ^ gfMul(poly[j] as number, 1)
      next[j + 1] = (next[j + 1] as number) ^ gfMul(poly[j] as number, GF_EXP[i] as number)
    }
    poly = next
  }
  return poly
}

/**
 * 算一组数据码字的纠错码字
 * @param data 数据码字
 * @param count 要几个纠错码字
 * @returns 纠错码字
 */
export function rsEncode(data: readonly number[], count: number): number[] {
  const gen = rsGenerator(count)
  const out = new Array<number>(count).fill(0)
  for (const byte of data) {
    const factor = byte ^ (out[0] as number)
    out.shift()
    out.push(0)
    if (factor !== 0) {
      for (let i = 0; i < count; i += 1) {
        out[i] = (out[i] as number) ^ gfMul(gen[i + 1] as number, factor)
      }
    }
  }
  return out
}

/**
 * 选一个装得下的版本
 * @param bytes 待编码的字节数
 * @returns 版本号（1 起）
 * @throws 超出 {@link MAX_VERSION} 的容量时
 */
export function pickVersion(bytes: number): number {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const [, g1, d1, g2, d2] = EC_BLOCKS_M[version - 1] as readonly [number, number, number, number, number]
    const dataCw = g1 * d1 + g2 * d2
    // 头部为 4 位模式 + 字符计数（9 版及以下 8 位、10 版起 16 位）
    const headerBits = 4 + (version < 10 ? 8 : 16)
    if (dataCw * 8 >= headerBits + bytes * 8) return version
  }
  throw new Error(`二维码内容过长：${bytes} 字节超出 ${MAX_VERSION} 版在等级 M 下的容量`)
}

/**
 * 把内容编成数据码字（含头部、结束符、填充与纠错交织）
 * @param data 内容字节
 * @param version 版本
 * @returns 最终码字序列
 */
export function encodeCodewords(data: Uint8Array, version: number): number[] {
  const [ecCount, g1, d1, g2, d2] = EC_BLOCKS_M[version - 1] as readonly [number, number, number, number, number]
  const totalData = g1 * d1 + g2 * d2

  const bits: number[] = []
  /**
   * 追加若干位
   * @param value 值
   * @param length 位数
   */
  const push = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1)
  }

  push(MODE_BYTE, 4)
  push(data.length, version < 10 ? 8 : 16)
  for (const byte of data) push(byte, 8)
  // 结束符最多四位，剩余空间不足时按剩余位数补
  push(0, Math.min(4, totalData * 8 - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)

  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] as number)
    codewords.push(byte)
  }
  // 余下的空间交替填 0xEC / 0x11，第一个恒为 0xEC
  for (let i = 0; codewords.length < totalData; i += 1) {
    codewords.push(PAD_BYTES[i % 2] as number)
  }

  // 分块：第一组每块 d1 个数据码字，第二组每块 d2 个
  const blocks: { data: number[]; ec: number[] }[] = []
  let at = 0
  for (let i = 0; i < g1 + g2; i += 1) {
    const size = i < g1 ? d1 : d2
    const chunk = codewords.slice(at, at + size)
    at += size
    blocks.push({ data: chunk, ec: rsEncode(chunk, ecCount) })
  }

  // 交织：先按列取遍所有块的数据码字，再按列取遍纠错码字
  const out: number[] = []
  const maxData = Math.max(...blocks.map(one => one.data.length))
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) {
      const one = block.data[i]
      if (one !== undefined) out.push(one)
    }
  }
  for (let i = 0; i < ecCount; i += 1) {
    for (const block of blocks) out.push(block.ec[i] as number)
  }
  return out
}

/** 一格的状态：`undefined` 为尚未写入，用于区分「功能图案占位」与「数据区留空」 */
type Cell = boolean | undefined

/** 模块矩阵，`true` 为深色 */
export type QrMatrix = boolean[][]

/**
 * 在矩阵上画一个 7×7 的寻像图案
 * @param grid 矩阵
 * @param row 左上角行
 * @param col 左上角列
 */
function drawFinder(grid: Cell[][], row: number, col: number): void {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r
      const x = col + c
      if (y < 0 || x < 0 || y >= grid.length || x >= grid.length) continue
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3))
      // 分隔符（ring 为 4）留白，其余按同心方环取色
      ;(grid[y] as Cell[])[x] = ring !== 2 && ring <= 3
    }
  }
}

/**
 * 画定位图案、时序图案与固定的深色模块
 * @param grid 矩阵
 * @param version 版本
 */
function drawPatterns(grid: Cell[][], version: number): void {
  const size = grid.length
  drawFinder(grid, 0, 0)
  drawFinder(grid, 0, size - 7)
  drawFinder(grid, size - 7, 0)

  const centers = ALIGN_CENTERS[version - 1] as readonly number[]
  for (const cy of centers) {
    for (const cx of centers) {
      // 三个角上的寻像图案已占位，定位图案不落在那里
      const nearFinder = (cy <= 8 && cx <= 8) || (cy <= 8 && cx >= size - 9) || (cy >= size - 9 && cx <= 8)
      if (nearFinder) continue
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          ;(grid[cy + r] as Cell[])[cx + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0
    ;(grid[6] as Cell[])[i] = dark
    ;(grid[i] as Cell[])[6] = dark
  }

  // 恒为深色的那一格，位置由标准固定
  ;(grid[size - 8] as Cell[])[8] = true
}

/**
 * 占住格式信息与版本信息的位置
 *
 * 先占位再放数据：这两块的内容依赖掩码编号，而掩码要在数据放完之后才评分选出来。
 * @param grid 矩阵
 * @param version 版本
 */
function reserveInfo(grid: Cell[][], version: number): void {
  const size = grid.length
  for (let i = 0; i < 9; i += 1) {
    if ((grid[8] as Cell[])[i] === undefined) (grid[8] as Cell[])[i] = false
    if ((grid[i] as Cell[])[8] === undefined) (grid[i] as Cell[])[8] = false
  }
  for (let i = 0; i < 8; i += 1) {
    if ((grid[8] as Cell[])[size - 1 - i] === undefined) (grid[8] as Cell[])[size - 1 - i] = false
    if ((grid[size - 1 - i] as Cell[])[8] === undefined) (grid[size - 1 - i] as Cell[])[8] = false
  }
  if (version < 7) return
  for (let i = 0; i < 18; i += 1) {
    const row = Math.floor(i / 3)
    const col = i % 3
    ;(grid[size - 11 + col] as Cell[])[row] = false
    ;(grid[row] as Cell[])[size - 11 + col] = false
  }
}

/**
 * 把码字按标准的蛇形顺序放进数据区
 *
 * 两列一组自右向左走，组内自下而上与自上而下交替。第 6 列是竖向时序图案，整列跳过 ——
 * 不跳过时列的配对会整体错开一位，随后每一格都放错。
 * @param grid 矩阵
 * @param codewords 码字
 */
function placeData(grid: Cell[][], codewords: readonly number[]): void {
  const size = grid.length
  let bit = 0
  let upward = true
  let col = size - 1
  while (col > 0) {
    if (col === 6) col = 5
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step
      for (const x of [col, col - 1]) {
        if ((grid[y] as Cell[])[x] !== undefined) continue
        const byte = codewords[bit >> 3] ?? 0
        ;(grid[y] as Cell[])[x] = ((byte >> (7 - (bit & 7))) & 1) === 1
        bit += 1
      }
    }
    upward = !upward
    col -= 2
  }
}

/**
 * 掩码函数
 * @param mask 掩码编号 0~7
 * @param row 行
 * @param col 列
 * @returns 该格是否取反
 */
export function maskAt(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0
    case 1:
      return row % 2 === 0
    case 2:
      return col % 3 === 0
    case 3:
      return (row + col) % 3 === 0
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
  }
}

/**
 * 算格式信息的 15 位
 * @param mask 掩码编号
 * @returns 15 位，最高位在前
 */
export function formatBits(mask: number): number {
  const value = (EC_LEVEL_M << 3) | mask
  let rest = value << 10
  for (let i = 4; i >= 0; i -= 1) {
    if ((rest >> (10 + i)) & 1) rest ^= 0x537 << i
  }
  return ((value << 10) | rest) ^ 0x5412
}

/**
 * 算版本信息的 18 位
 * @param version 版本
 * @returns 18 位，最高位在前
 */
export function versionBits(version: number): number {
  let rest = version << 12
  for (let i = 5; i >= 0; i -= 1) {
    if ((rest >> (12 + i)) & 1) rest ^= 0x1f25 << i
  }
  return (version << 12) | rest
}

/**
 * 把格式信息与版本信息写进矩阵
 * @param grid 矩阵
 * @param version 版本
 * @param mask 掩码编号
 */
function writeInfo(grid: boolean[][], version: number, mask: number): void {
  const size = grid.length
  const fmt = formatBits(mask)
  for (let i = 0; i < 15; i += 1) {
    const on = ((fmt >> i) & 1) === 1
    // 位序照标准：第 0 位落在 (0, 8)，沿第 8 列向下，到第 8 行折向左；
    // 第 6 行与第 6 列被时序图案占着，故 i = 6 与 i = 9 各跳一格
    if (i < 6) (grid[i] as boolean[])[8] = on
    else if (i === 6) (grid[7] as boolean[])[8] = on
    else if (i === 7) (grid[8] as boolean[])[8] = on
    else if (i === 8) (grid[8] as boolean[])[7] = on
    else (grid[8] as boolean[])[14 - i] = on

    // 第二份分列右上与左下，两段各自连续
    if (i < 8) (grid[8] as boolean[])[size - 1 - i] = on
    else (grid[size - 15 + i] as boolean[])[8] = on
  }
  if (version < 7) return
  const ver = versionBits(version)
  for (let i = 0; i < 18; i += 1) {
    const on = ((ver >> i) & 1) === 1
    const row = Math.floor(i / 3)
    const col = i % 3
    ;(grid[size - 11 + col] as boolean[])[row] = on
    ;(grid[row] as boolean[])[size - 11 + col] = on
  }
}

/**
 * 掩码的惩罚分
 *
 * 四项规则照标准：连续同色、2×2 同色块、形似寻像图案的行列、深色占比偏离一半。
 * 评分只影响挑哪个掩码，四项都算低了也仍是一张可扫的图，但对比度会差。
 * @param grid 矩阵
 * @returns 分数，越低越好
 */
function penalty(grid: readonly boolean[][]): number {
  const size = grid.length
  let score = 0

  /**
   * 一行（或一列）里的连续同色惩罚
   * @param line 该行取值
   * @returns 分数
   */
  const runs = (line: readonly boolean[]): number => {
    let sum = 0
    let run = 1
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1
        continue
      }
      if (run >= 5) sum += run - 2
      run = 1
    }
    return run >= 5 ? sum + run - 2 : sum
  }

  const pattern = [true, false, true, true, true, false, true, false, false, false, false]
  /**
   * 一行（或一列）里形似寻像图案的次数
   * @param line 该行取值
   * @returns 分数
   */
  const finderLike = (line: readonly boolean[]): number => {
    let sum = 0
    for (let i = 0; i + 11 <= line.length; i += 1) {
      let hit = true
      let back = true
      for (let j = 0; j < 11; j += 1) {
        if (line[i + j] !== pattern[j]) hit = false
        if (line[i + j] !== pattern[10 - j]) back = false
      }
      if (hit) sum += 40
      if (back) sum += 40
    }
    return sum
  }

  for (let i = 0; i < size; i += 1) {
    const row = grid[i] as boolean[]
    const col = grid.map(one => (one as boolean[])[i] as boolean)
    score += runs(row) + runs(col) + finderLike(row) + finderLike(col)
  }

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const one = (grid[y] as boolean[])[x]
      if (
        one === (grid[y] as boolean[])[x + 1] &&
        one === (grid[y + 1] as boolean[])[x] &&
        one === (grid[y + 1] as boolean[])[x + 1]
      ) {
        score += 3
      }
    }
  }

  const dark = grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10
  return score
}

/**
 * 把一段文本编成模块矩阵
 *
 * 不含空白区，出图时由 {@link qrPng} 补。
 * @param text 内容
 * @returns 模块矩阵，`true` 为深色
 * @throws 内容超出容量时
 */
export function qrMatrix(text: string): QrMatrix {
  return qrRender(text).matrix
}

/** 一次编码的结果：模块矩阵与「哪些格属于功能图案」 */
export interface QrRender {
  /** 模块矩阵，`true` 为深色 */
  matrix: QrMatrix
  /**
   * 功能图案（寻像、定位、时序与格式信息）占住的格
   *
   * 这些格必须保持满格方块，改成圆点会破坏定位与透视校正，扫码器直接认不出。
   */
  fixed: readonly boolean[][]
}

/**
 * 把一段文本编成模块矩阵，并一并给出功能图案的位置
 *
 * 与 {@link qrMatrix} 同一件事，只多返回一份 {@link QrRender.fixed} —— 那是 {@link qrSvg}
 * 区分"可做样式的数据格"与"必须留满格的功能格"的唯一依据。
 * @param text 内容
 * @returns 矩阵与功能图案位置
 * @throws 内容超出容量时
 */
export function qrRender(text: string): QrRender {
  const bytes = new TextEncoder().encode(text)
  const version = pickVersion(bytes.length)
  const size = version * 4 + 17
  const codewords = encodeCodewords(bytes, version)

  const base: Cell[][] = Array.from({ length: size }, () => new Array<Cell>(size).fill(undefined))
  drawPatterns(base, version)
  reserveInfo(base, version)
  // 功能图案占了哪些格要在放数据之前记下来：掩码只作用于数据区
  const fixed = base.map(row => row.map(one => one !== undefined))
  placeData(base, codewords)

  let best: boolean[][] | undefined
  let bestScore = Number.POSITIVE_INFINITY
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = base.map((row, y) =>
      row.map((one, x) => (one === true) !== (!((fixed[y] as boolean[])[x] as boolean) && maskAt(mask, y, x)))
    )
    writeInfo(grid, version, mask)
    const score = penalty(grid)
    if (score < bestScore) {
      bestScore = score
      best = grid
    }
  }
  return { matrix: best as boolean[][], fixed }
}

/** 画 SVG 时的配色与尺寸 */
export interface QrSvgStyle {
  /** 数据点颜色 */
  fg?: string
  /** 三个寻像图案（与时序、格式信息）的颜色 */
  posColor?: string
  /** 定位图案的颜色 */
  alignColor?: string
  /** 底色；给 `none` 即透明 */
  bg?: string
  /** 边长像素 */
  size?: number
}

/**
 * 把内容画成一张 SVG —— 数据点为圆点并与相邻点连成流体块面
 *
 * 可扫性靠三条硬约束，改样式时不得破坏：功能图案一律满格方块（{@link QrRender.fixed} 那些格）；
 * 圆点半径恰为半格、连接条不超出两格中心连线，墨迹始终落在暗格内部；空白区不少于四格
 * （标准下限，此处取五格）。
 *
 * 返回 SVG 文本而非字节：它要嵌进模板（`{{@svg}}`），由渲染器随整张卡片一起出图。
 * @param text 内容
 * @param style 配色与尺寸
 * @returns SVG 文本
 * @throws 内容超出容量时
 */
export function qrSvg(text: string, style: QrSvgStyle = {}): string {
  const { matrix, fixed } = qrRender(text)
  const quiet = 5
  const count = matrix.length
  const total = count + quiet * 2
  /** 连接条的宽度，取略窄于一格 —— 满格会让相邻两点糊成一片，失去圆点的观感 */
  const link = 0.62

  const fg = style.fg ?? "#1d2540"
  const posColor = style.posColor ?? "#d94f3d"
  const alignColor = style.alignColor ?? "#3d7fd9"
  const bg = style.bg ?? "#ffffff"
  const size = style.size ?? 500

  /**
   * 这一格是不是深色
   * @param r 行
   * @param c 列
   * @returns 深色为真；越界为假
   */
  const dark = (r: number, c: number): boolean => r >= 0 && c >= 0 && r < count && c < count && matrix[r]?.[c] === true

  /** 数据区的圆点与连接条 */
  const dots: string[] = []
  /** 寻像 / 时序 / 格式信息，一律满格 */
  const pos: string[] = []
  /** 定位图案，同样满格，另给一色以便看出结构 */
  const align: string[] = []

  // `fixed` 分不出寻像与定位，故按版本表另算一遍；仅用于着色，算错只是颜色不同
  const version = (count - 17) / 4
  const centers = ALIGN_CENTERS[version - 1] ?? []
  const inAlign = (r: number, c: number): boolean =>
    centers.some(cy => centers.some(cx => Math.abs(r - cy) <= 2 && Math.abs(c - cx) <= 2))

  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (!dark(r, c)) continue
      const x = c + quiet
      const y = r + quiet

      if (fixed[r]?.[c] === true) {
        const cell = `<rect x="${x}" y="${y}" width="1" height="1"/>`
        if (inAlign(r, c)) align.push(cell)
        else pos.push(cell)
        continue
      }

      const cx = x + 0.5
      const cy = y + 0.5
      dots.push(`<circle cx="${cx}" cy="${cy}" r="0.5"/>`)
      // 与右 / 下相邻的暗格之间搭一段桥，墨迹始终落在两个暗格内部
      if (dark(r, c + 1)) dots.push(`<rect x="${cx}" y="${cy - link / 2}" width="1" height="${link}"/>`)
      if (dark(r + 1, c)) dots.push(`<rect x="${cx - link / 2}" y="${cy}" width="${link}" height="1"/>`)
    }
  }

  const inset = 0.75
  const frame =
    `<rect x="${inset}" y="${inset}" width="${total - inset * 2}" height="${total - inset * 2}"` +
    ` rx="2.5" fill="none" stroke="${posColor}" stroke-width="0.5" opacity="0.55"/>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"` +
    ` width="${size}" height="${size}" shape-rendering="geometricPrecision">` +
    `<rect width="${total}" height="${total}" fill="${bg}"/>${frame}` +
    `<g fill="${fg}">${dots.join("")}</g>` +
    `<g fill="${alignColor}">${align.join("")}</g>` +
    `<g fill="${posColor}">${pos.join("")}</g></svg>`
  )
}

/** PNG 的固定文件签名 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/** CRC32 查表，PNG 每个数据块尾部都要它 */
const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i += 1) {
  let c = i
  for (let j = 0; j < 8; j += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[i] = c >>> 0
}

/**
 * 算 CRC32
 * @param bytes 字节
 * @returns 校验值
 */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = ((CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

/**
 * 拼一个 PNG 数据块
 * @param type 四字节类型名
 * @param body 内容
 * @returns 完整数据块
 */
function chunk(type: string, body: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type)
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  out.set(name, 4)
  out.set(body, 8)
  const crcBody = new Uint8Array(4 + body.length)
  crcBody.set(name, 0)
  crcBody.set(body, 4)
  view.setUint32(8 + body.length, crc32(crcBody))
  return out
}

/**
 * 把内容画成一张 PNG
 *
 * 灰度八位、无滤波：二维码只有黑白两色，为省几 KB 换一套滤波与调色板不值得。
 * 空白区取四个模块宽 —— 标准的下限，少了多数手机无法识别。
 * @param text 内容
 * @param scale 每个模块占几个像素
 * @returns PNG 字节
 */
export function qrPng(text: string, scale = 8): Uint8Array {
  const matrix = qrMatrix(text)
  const quiet = 4
  const modules = matrix.length + quiet * 2
  const side = modules * scale

  const raw = new Uint8Array((side + 1) * side)
  for (let y = 0; y < side; y += 1) {
    const rowStart = y * (side + 1)
    // 每行首字节是滤波类型，0 为不滤波
    raw[rowStart] = 0
    const my = Math.floor(y / scale) - quiet
    const row = matrix[my]
    for (let x = 0; x < side; x += 1) {
      const mx = Math.floor(x / scale) - quiet
      const dark = row !== undefined && row[mx] === true
      raw[rowStart + 1 + x] = dark ? 0x00 : 0xff
    }
  }

  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, side)
  view.setUint32(4, side)
  ihdr[8] = 8
  ihdr[9] = 0
  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0))
  ]
  const total = parts.reduce((sum, one) => sum + one.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const one of parts) {
    out.set(one, at)
    at += one.length
  }
  return out
}
