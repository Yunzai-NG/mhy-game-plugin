/**
 * 模块职责：二维码编码的测试
 * 依赖方向：测试文件，只依赖 core/qr.ts
 * 生命周期：无状态
 * 注意事项：**编码写错的表现是一张扫不出的图而不是异常**，故从三个互不依赖的角度各固定一道：版本表交叉核对（`块数×(数据+纠错)` 须等于总码字数）、纠错码的代数性质（完整码字在生成多项式每个根上取值为零）、自带最小解码器反向还原原文（放置顺序、掩码范围、交织次序错一处即还原失败）。
 */
import { describe, expect, it } from "vitest"
import {
  EC_BLOCKS_M,
  TOTAL_CODEWORDS,
  formatBits,
  maskAt,
  pickVersion,
  qrMatrix,
  qrPng,
  qrRender,
  qrSvg,
  rsEncode,
  versionBits
} from "./qr.js"

/** GF(256) 指数表，解码端自行重建一份，不复用实现里的 */
const EXP: number[] = []
for (let i = 0, x = 1; i < 255; i += 1) {
  EXP.push(x)
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}

/**
 * GF(256) 上求积
 * @param a 乘数
 * @param b 乘数
 * @returns 积
 */
function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  let out = 0
  let x = a
  let y = b
  while (y > 0) {
    if (y & 1) out ^= x
    y >>= 1
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  return out
}

/**
 * 按 Horner 法在某个点上求码字多项式的值
 * @param coeffs 码字，最高次在前
 * @param at 求值点
 * @returns 值
 */
function evalAt(coeffs: readonly number[], at: number): number {
  let out = 0
  for (const one of coeffs) out = mul(out, at) ^ one
  return out
}

/**
 * 独立重建功能模块分布，与实现无关；解码时靠它区分数据格与功能格
 * @param size 边长
 * @param version 版本
 * @returns 为真处即功能模块
 */
function functionMap(size: number, version: number): boolean[][] {
  const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  /**
   * 标记一块矩形
   * @param top 上边
   * @param left 左边
   * @param height 高
   * @param width 宽
   */
  const mark = (top: number, left: number, height: number, width: number): void => {
    for (let y = top; y < top + height; y += 1) {
      for (let x = left; x < left + width; x += 1) {
        if (y >= 0 && x >= 0 && y < size && x < size) (map[y] as boolean[])[x] = true
      }
    }
  }

  // 三个寻像图案连同分隔符各占 8×8
  mark(0, 0, 8, 8)
  mark(0, size - 8, 8, 8)
  mark(size - 8, 0, 8, 8)
  // 时序图案
  mark(6, 0, 1, size)
  mark(0, 6, size, 1)
  // 格式信息两份
  mark(8, 0, 1, 9)
  mark(0, 8, 9, 1)
  mark(8, size - 8, 1, 8)
  mark(size - 8, 8, 8, 1)

  const centers: Record<number, readonly number[]> = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50],
    11: [6, 30, 54],
    12: [6, 32, 58],
    13: [6, 34, 62]
  }
  const list = centers[version] ?? []
  for (const cy of list) {
    for (const cx of list) {
      const nearFinder = (cy <= 8 && cx <= 8) || (cy <= 8 && cx >= size - 9) || (cy >= size - 9 && cx <= 8)
      if (!nearFinder) mark(cy - 2, cx - 2, 5, 5)
    }
  }
  if (version >= 7) {
    mark(size - 11, 0, 3, 6)
    mark(0, size - 11, 6, 3)
  }
  return map
}

/**
 * 把一张模块矩阵解回原文
 * @param matrix 模块矩阵
 * @returns 原文
 */
function decode(matrix: readonly boolean[][]): string {
  const size = matrix.length
  const version = (size - 17) / 4
  const fixed = functionMap(size, version)

  // 读第一份格式信息：第 0 位在 (0, 8)，沿第 8 列向下，到第 8 行后折向左
  let raw = 0
  for (let i = 0; i < 15; i += 1) {
    let on: boolean
    if (i < 6) on = (matrix[i] as boolean[])[8] as boolean
    else if (i === 6) on = (matrix[7] as boolean[])[8] as boolean
    else if (i === 7) on = (matrix[8] as boolean[])[8] as boolean
    else if (i === 8) on = (matrix[8] as boolean[])[7] as boolean
    else on = (matrix[8] as boolean[])[14 - i] as boolean
    if (on) raw |= 1 << i
  }
  // 高五位是「纠错等级 + 掩码编号」，低十位是它的 BCH 校验位
  const info = (raw ^ 0x5412) >> 10
  const level = (info >> 3) & 0b11
  const mask = info & 0b111
  expect(level, "纠错等级位应为等级 M").toBe(0)

  // 按同一套蛇形顺序把数据读回来，读到的每一格去掩码
  const bits: number[] = []
  let upward = true
  let col = size - 1
  while (col > 0) {
    if (col === 6) col = 5
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step
      for (const x of [col, col - 1]) {
        if ((fixed[y] as boolean[])[x]) continue
        const value = (matrix[y] as boolean[])[x] as boolean
        bits.push((value !== maskAt(mask, y, x) ? 1 : 0) as number)
      }
    }
    upward = !upward
    col -= 2
  }

  const codewords: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] as number)
    codewords.push(byte)
  }

  // 反交织：按列取回各块的数据码字
  const [, g1, d1, g2, d2] = EC_BLOCKS_M[version - 1] as readonly [number, number, number, number, number]
  const sizes = [...Array.from({ length: g1 }, () => d1), ...Array.from({ length: g2 }, () => d2)]
  const blocks: number[][] = sizes.map(() => [])
  let at = 0
  for (let i = 0; i < Math.max(...sizes); i += 1) {
    for (let b = 0; b < sizes.length; b += 1) {
      if (i >= (sizes[b] as number)) continue
      ;(blocks[b] as number[]).push(codewords[at] as number)
      at += 1
    }
  }
  const data = blocks.flat()

  // 剥掉头部：4 位模式 + 字符计数
  let bit = 0
  /**
   * 读若干位
   * @param length 位数
   * @returns 值
   */
  const take = (length: number): number => {
    let out = 0
    for (let i = 0; i < length; i += 1) {
      const byte = data[bit >> 3] ?? 0
      out = (out << 1) | ((byte >> (7 - (bit & 7))) & 1)
      bit += 1
    }
    return out
  }
  expect(take(4), "模式指示符应为字节模式").toBe(0b0100)
  const count = take(version < 10 ? 8 : 16)
  const bytes = new Uint8Array(count)
  for (let i = 0; i < count; i += 1) bytes[i] = take(8)
  return new TextDecoder().decode(bytes)
}

describe("版本表", () => {
  it("分块表与总码字表相符 —— 两者出自标准的不同表格", () => {
    EC_BLOCKS_M.forEach(([ec, g1, d1, g2, d2], idx) => {
      expect(g1 * (d1 + ec) + g2 * (d2 + ec), `第 ${idx + 1} 版`).toBe(TOTAL_CODEWORDS[idx])
    })
  })

  it("按内容长度挑最小的够用版本", () => {
    expect(pickVersion(1)).toBe(1)
    expect(pickVersion(14)).toBe(1)
    expect(pickVersion(15)).toBe(2)
    expect(pickVersion(200)).toBeLessThanOrEqual(12)
  })

  it("超出容量时明确报错，而不是出一张读不出内容的图", () => {
    expect(() => pickVersion(10000)).toThrow(/过长/)
  })
})

describe("纠错码", () => {
  it("完整码字在生成多项式的每个根上取值为零 —— 这是解码端的判据", () => {
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11]
    const ec = rsEncode(data, 10)

    expect(ec).toHaveLength(10)
    for (let i = 0; i < 10; i += 1) {
      expect(evalAt([...data, ...ec], EXP[i] as number), `第 ${i} 个根`).toBe(0)
    }
  })

  it("换一组数据与一个块长仍成立", () => {
    const data = Array.from({ length: 44 }, (_, i) => (i * 37 + 11) & 0xff)
    const ec = rsEncode(data, 26)

    for (let i = 0; i < 26; i += 1) {
      expect(evalAt([...data, ...ec], EXP[i] as number)).toBe(0)
    }
  })
})

describe("格式与版本信息", () => {
  it("等级 M 掩码 0 的格式信息是标准里那个固定值", () => {
    expect(formatBits(0)).toBe(0b101010000010010)
  })

  it("八个掩码的格式信息互不相同，且两两至少差三位", () => {
    const all = [0, 1, 2, 3, 4, 5, 6, 7].map(formatBits)
    expect(new Set(all).size).toBe(8)
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue
        let diff = 0
        for (let i = 0; i < 15; i += 1) if (((a >> i) & 1) !== ((b >> i) & 1)) diff += 1
        expect(diff).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it("7 版的版本信息是标准里那个固定值", () => {
    expect(versionBits(7)).toBe(0b000111110010010100)
  })
})

describe("qrMatrix", () => {
  it("边长按版本算，三个角上都是寻像图案", () => {
    const matrix = qrMatrix("hello")

    expect(matrix.length).toBe(21)
    for (const [row, col] of [
      [0, 0],
      [0, 14],
      [14, 0]
    ] as const) {
      // 外环深、次环浅、内芯深
      expect((matrix[row] as boolean[])[col]).toBe(true)
      expect((matrix[row + 1] as boolean[])[col + 1]).toBe(false)
      expect((matrix[row + 3] as boolean[])[col + 3]).toBe(true)
    }
  })

  it("时序图案沿第 6 行与第 6 列交替", () => {
    const matrix = qrMatrix("hello")

    for (let i = 8; i < matrix.length - 8; i += 1) {
      expect((matrix[6] as boolean[])[i], `第 6 行第 ${i} 列`).toBe(i % 2 === 0)
      expect((matrix[i] as boolean[])[6], `第 ${i} 行第 6 列`).toBe(i % 2 === 0)
    }
  })

  it("固定深色模块在位", () => {
    const matrix = qrMatrix("hello")
    expect((matrix[matrix.length - 8] as boolean[])[8]).toBe(true)
  })

  it("解得回来 —— 短内容", () => {
    expect(decode(qrMatrix("hello"))).toBe("hello")
  })

  it("解得回来 —— 一条真实形态的登录地址", () => {
    const url =
      "https://user.mihoyo.com/qr_code_in_game.html?app_id=8&app_name=%E7%B1%B3%E6%B8%B8%E7%A4%BE&bbs=true&biz_key=bbs_cn&expire=1788372931&ticket=0123456789abcdef0123456789abcdef"
    expect(decode(qrMatrix(url))).toBe(url)
  })

  it("解得回来 —— 跨到多块分组的长内容", () => {
    const text = Array.from({ length: 300 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("")
    const matrix = qrMatrix(text)

    // 300 字节时数据码字分成两组不等长的块，交织写错在此才暴露
    expect(matrix.length).toBeGreaterThan(53)
    expect(decode(matrix)).toBe(text)
  })

  it("解得回来 —— 含中文（字节模式按 UTF-8 编码）", () => {
    expect(decode(qrMatrix("扫码登录米游社"))).toBe("扫码登录米游社")
  })
})

describe("qrRender", () => {
  it("矩阵与 qrMatrix 一致，另给出功能图案的位置", () => {
    const { matrix, fixed } = qrRender("hello")

    expect(matrix).toEqual(qrMatrix("hello"))
    expect(fixed[0]?.[0]).toBe(true)
    expect(fixed[6]?.[10]).toBe(true)
    expect(fixed[matrix.length - 8]?.[8]).toBe(true)
  })

  it("功能格之外的都是数据区 —— 掩码与样式都只作用于那里", () => {
    const { matrix, fixed } = qrRender("hello")
    const last = matrix.length - 1
    expect(fixed[last]?.[last]).toBe(false)
  })
})

describe("qrSvg", () => {
  /**
   * 数一个 SVG 里各类图元的个数
   * @param svg SVG 文本
   * @returns 圆点、方块与桥接条的个数
   */
  const count = (svg: string): { circles: number; rects: number } => ({
    circles: (svg.match(/<circle/g) ?? []).length,
    rects: (svg.match(/<rect/g) ?? []).length
  })

  it("是一张合法 SVG，viewBox 含两侧各五格的空白区", () => {
    const svg = qrSvg("hello")

    expect(svg.startsWith("<svg")).toBe(true)
    expect(svg.endsWith("</svg>")).toBe(true)
    // 21 个模块 + 两侧各 5 格空白
    expect(svg).toContain(`viewBox="0 0 ${21 + 10} ${21 + 10}"`)
  })

  it("功能图案画成满格方块，数据点画成圆点 —— 前者改成圆点即无法识别", () => {
    const { matrix, fixed } = qrRender("hello")
    const svg = qrSvg("hello")
    const got = count(svg)

    let fixedDark = 0
    let dataDark = 0
    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < matrix.length; c += 1) {
        if (matrix[r]?.[c] !== true) continue
        if (fixed[r]?.[c] === true) fixedDark += 1
        else dataDark += 1
      }
    }

    // 每个数据暗格恰一个圆点
    expect(got.circles).toBe(dataDark)
    // 方块 = 底色 + 边框 + 每个功能暗格 + 桥接条若干
    expect(got.rects).toBeGreaterThanOrEqual(fixedDark + 2)
  })

  it("配色可换，且底色给 none 时透明", () => {
    const svg = qrSvg("hello", { fg: "#123456", bg: "none", size: 300 })

    expect(svg).toContain("#123456")
    expect(svg).toContain('fill="none"')
    expect(svg).toContain('width="300"')
  })

  it("同一条内容画出来的 SVG 与位图取自同一个矩阵 —— 两条路不许出现分叉", () => {
    // 位图走 qrMatrix、SVG 走 qrRender，两者须同一矩阵，否则「图能扫、退回位图扫不了」无从察觉
    const url = "https://user.mihoyo.com/qr_code_in_game.html?ticket=abc123"
    expect(qrRender(url).matrix).toEqual(qrMatrix(url))
    expect(() => qrSvg(url)).not.toThrow()
  })
})

describe("qrPng", () => {
  it("是一张合法的 PNG，且尺寸含四个模块宽的空白区", () => {
    const png = qrPng("hello", 4)

    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(new TextDecoder().decode(png.slice(12, 16))).toBe("IHDR")
    const view = new DataView(png.buffer, png.byteOffset)
    // 21 个模块 + 两侧各 4 个空白模块，每模块 4 像素
    expect(view.getUint32(16)).toBe((21 + 8) * 4)
    expect(view.getUint32(20)).toBe((21 + 8) * 4)
  })

  it("末尾是 IEND", () => {
    const png = qrPng("hello", 2)
    expect(new TextDecoder().decode(png.slice(png.length - 8, png.length - 4))).toBe("IEND")
  })
})
