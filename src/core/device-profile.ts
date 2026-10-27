/**
 * 模块职责：虚拟设备的生成与序列化 —— 机型目录、按账号确定性派生、ext_fields / 请求头
 * 依赖方向：只依赖 node:crypto，不依赖内核，因此可以纯函数式单测
 * 生命周期：无状态纯函数
 * 注意事项：一个账号对应一台设备，且该设备不再变更 —— 连续出现超过一天的设备被米游社
 *          判为"常用设备"，风控随之放松；每次请求换一套等同于每次都是新设备登录。
 *
 *          派生是确定性的：seed = sha256("yzng:device:v1:" + ltuid)，故存储损坏或重装后
 *          同一账号仍还原出同一台设备。存储只是缓存，派生函数才是唯一真相。
 *
 *          机型目录只增不改：改动任何一条都会使已养成的设备转为新设备，新增机型必须追加
 *          在数组末尾。
 */
import { createHash } from "node:crypto"

/** 一款机型的静态规格，字段名对应 Android 的 `ro.product.*` / `ro.build.*` */
export interface DeviceSpec {
  /** 品牌，对应 `ro.product.brand` */
  brand: string
  /** 厂商，对应 `ro.product.manufacturer` */
  manufacturer: string
  /** 市场名，用作 `x-rpc-device_name` */
  marketName: string
  /** 内部型号，对应 `ro.product.model` 与 `x-rpc-device_model` */
  model: string
  /** 产品代号，对应 `ro.product.name` / `ro.product.device` */
  product: string
  /** 主板代号，对应 `ro.product.board` */
  board: string
  /** 硬件平台，对应 `ro.hardware` */
  hardware: string
  /** CPU 架构 */
  cpu: string
  /** Android 版本号 */
  osVersion: string
  /** Android API 级别 */
  sdk: number
  /** 屏幕分辨率，形如 `1080x2400` */
  screen: string
  /** 运行内存（GB） */
  ram: number
  /** 存储容量（GB） */
  rom: number
  /** 系统构建号，对应 `ro.build.id` */
  buildId: string
  /** 系统增量版本，对应 `ro.build.version.incremental` */
  incremental: string
}

/**
 * 机型目录
 *
 * 顺序即身份：{@link deriveDevice} 以账号的散列值在本数组中取下标，故只可在末尾追加，
 * 不得插入、删除或改写已有条目。
 */
export const DEVICE_CATALOG: readonly DeviceSpec[] = [
  {
    brand: "Xiaomi",
    manufacturer: "Xiaomi",
    marketName: "Xiaomi 13",
    model: "2211133C",
    product: "fuxi",
    board: "kalama",
    hardware: "qcom",
    cpu: "arm64-v8a",
    osVersion: "13",
    sdk: 33,
    screen: "1080x2400",
    ram: 12,
    rom: 256,
    buildId: "TKQ1.220829.002",
    incremental: "V14.0.14.0.TMCCNXM"
  },
  {
    brand: "Xiaomi",
    manufacturer: "Xiaomi",
    marketName: "Redmi K60",
    model: "23013RK75C",
    product: "corot",
    board: "taro",
    hardware: "qcom",
    cpu: "arm64-v8a",
    osVersion: "13",
    sdk: 33,
    screen: "1440x3200",
    ram: 12,
    rom: 256,
    buildId: "TKQ1.221114.001",
    incremental: "V14.0.5.0.TMKCNXM"
  },
  {
    brand: "OPPO",
    manufacturer: "OPPO",
    marketName: "OPPO Find X6",
    model: "PGFM10",
    product: "PGFM10",
    board: "kalama",
    hardware: "qcom",
    cpu: "arm64-v8a",
    osVersion: "13",
    sdk: 33,
    screen: "1240x2772",
    ram: 12,
    rom: 256,
    buildId: "TP1A.220905.001",
    incremental: "PGFM10_11.C.20"
  },
  {
    brand: "vivo",
    manufacturer: "vivo",
    marketName: "vivo X90",
    model: "V2241A",
    product: "PD2227",
    board: "mt6985",
    hardware: "mt6985",
    cpu: "arm64-v8a",
    osVersion: "13",
    sdk: 33,
    screen: "1260x2800",
    ram: 12,
    rom: 256,
    buildId: "TP1A.220624.014",
    incremental: "compiler05122"
  },
  {
    brand: "OnePlus",
    manufacturer: "OnePlus",
    marketName: "OnePlus 11",
    model: "PHB110",
    product: "OP594DL1",
    board: "kalama",
    hardware: "qcom",
    cpu: "arm64-v8a",
    osVersion: "13",
    sdk: 33,
    screen: "1440x3216",
    ram: 16,
    rom: 256,
    buildId: "TP1A.220905.001",
    incremental: "PHB110_11_A.15"
  },
  {
    brand: "HONOR",
    manufacturer: "HONOR",
    marketName: "HONOR Magic5",
    model: "PGT-AN00",
    product: "PGT-AN00",
    board: "kalama",
    hardware: "qcom",
    cpu: "arm64-v8a",
    osVersion: "13",
    sdk: 33,
    screen: "1224x2700",
    ram: 12,
    rom: 256,
    buildId: "HONORPGT-AN00",
    incremental: "7.1.0.153"
  },
  {
    brand: "samsung",
    manufacturer: "samsung",
    marketName: "Galaxy S22",
    model: "SM-S9010",
    product: "r0qcn",
    board: "taro",
    hardware: "qcom",
    cpu: "arm64-v8a",
    osVersion: "13",
    sdk: 33,
    screen: "1080x2340",
    ram: 8,
    rom: 256,
    buildId: "TP1A.220624.014",
    incremental: "S9010ZCU3CWA1"
  },
  {
    brand: "HUAWEI",
    manufacturer: "HUAWEI",
    marketName: "HUAWEI P40",
    model: "ANA-AN00",
    product: "ANA-AN00",
    board: "ANA",
    hardware: "kirin990",
    cpu: "arm64-v8a",
    osVersion: "12",
    sdk: 31,
    screen: "1080x2340",
    ram: 8,
    rom: 128,
    buildId: "HUAWEIANA-AN00",
    incremental: "102.0.0.230C00"
  }
] as const

/**
 * 一台设备的随机身份字段
 *
 * 真机上由系统生成、终生不变，故这里也必须派生一次即永久固定，不可每次请求现算。
 */
export interface DeviceIds {
  /** 匿名设备标识 OAID */
  oaid: string
  /** 应用匿名标识 AAID */
  aaid: string
  /** 开发者匿名标识 VAID */
  vaid: string
  /** 设备序列号 */
  serial: string
  /** Android ID（16 位十六进制） */
  androidId: string
  /** 取 device_fp 时用的 seed_id，与设备同生共死 */
  seedId: string
  /** 主机名，出现在 ext_fields 的 `hostname` */
  hostname: string
  /** 构建者，出现在 ext_fields 的 `buildUser` */
  buildUser: string
  /** 构建时间戳（毫秒字符串） */
  buildTime: string
}

/** 请求米游社时使用的完整设备身份 */
export interface DeviceIdentity {
  /** 设备唯一标识，大写 UUID，对应 `x-rpc-device_id` */
  id: string
  /** 设备名，对应 `x-rpc-device_name` */
  name: string
  /** 机型规格 */
  spec: DeviceSpec
  /** 随机身份字段 */
  ids: DeviceIds
  /** 来源：`virtual` 为框架分配的虚拟设备，`bound` 为用户绑定的真机 */
  source: "virtual" | "bound"
  /** 首次分配时间（毫秒时间戳），用于判断是否已达成常用设备条件 */
  createdAt: number
}

/** 首次取得 fp 之前的占位值：接口要求 `device_fp` 字段非空 */
export const PLACEHOLDER_FP = "38d7ee834d1e9"

/** 米游社 App 内置 WebView 的 Chrome 版本，出现于 UA 之中 */
export const CHROME_VERSION = "104.0.5112.97"

/**
 * 派生用的域前缀
 *
 * 改动它等同于令全部账号同时更换设备，一经发布即不得变更；确需换算法时新增 `v2`
 * 并保留 `v1` 的派生分支。
 */
const SEED_DOMAIN = "yzng:device:v1:"

/**
 * 由种子展开出的确定性字节流
 *
 * 用 `sha256(seed || 轮次)` 逐轮扩展而非 mulberry32 一类的小状态 PRNG：小状态在连续取用
 * 数十字节时相邻输出易于相关，而此处正是以同一条流依次决定机型下标、UUID 与多个十六进制串。
 */
class SeedStream {
  /** 当前轮的字节 */
  private buf: Buffer
  /** 当前轮已消费到的位置 */
  private at = 0
  /** 轮次 */
  private round = 0

  /**
   * @param seed 种子字节
   */
  constructor(private readonly seed: Buffer) {
    this.buf = SeedStream.expand(seed, 0)
  }

  /**
   * 算一轮字节
   * @param seed 种子
   * @param round 轮次
   * @returns 32 字节
   */
  private static expand(seed: Buffer, round: number): Buffer {
    return createHash("sha256").update(seed).update(String(round)).digest()
  }

  /**
   * 取若干字节
   * @param n 字节数
   * @returns 字节
   */
  bytes(n: number): Buffer {
    const out = Buffer.alloc(n)
    let filled = 0
    while (filled < n) {
      if (this.at >= this.buf.length) {
        this.round += 1
        this.buf = SeedStream.expand(this.seed, this.round)
        this.at = 0
      }
      const take = Math.min(n - filled, this.buf.length - this.at)
      this.buf.copy(out, filled, this.at, this.at + take)
      this.at += take
      filled += take
    }
    return out
  }

  /**
   * 取十六进制串
   * @param n 字节数
   * @returns 小写十六进制
   */
  hex(n: number): string {
    return this.bytes(n).toString("hex")
  }

  /**
   * 取 `[0, max)` 的整数
   * @param max 上界（不含）
   * @returns 整数
   */
  int(max: number): number {
    return max <= 0 ? 0 : this.bytes(4).readUInt32BE(0) % max
  }

  /**
   * 从数组里挑一项
   * @param list 候选
   * @returns 选中的项
   * @throws 数组为空时抛错
   */
  pick<T>(list: readonly T[]): T {
    const item = list[this.int(list.length)]
    if (item === undefined) throw new Error("候选列表为空，无法派生设备")
    return item
  }

  /**
   * 取一个 v4 形态的 UUID
   * @returns 大写 UUID
   */
  uuid(): string {
    const b = this.bytes(16)
    b[6] = (b[6]! & 0x0f) | 0x40
    b[8] = (b[8]! & 0x3f) | 0x80
    const hex = b.toString("hex")
    const parts = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)]
    return parts.join("-").toUpperCase()
  }

  /**
   * 取一个小数（保留六位），用于伪造传感器读数
   * @param center 中心值
   * @param spread 上下浮动范围
   * @returns 形如 `9.703191` 的字符串
   */
  float(center: number, spread: number): string {
    const offset = (this.int(2_000_001) / 1_000_000 - 1) * spread
    return (center + offset).toFixed(6)
  }
}

/**
 * 由账号标识派生虚拟设备
 *
 * 取值顺序就是身份的一部分：机型下标 → device_id → oaid → aaid → vaid → 序列号 →
 * androidId → seedId → hostname → 构建时间。中间插入一次取值会让此后的字段整体错位，
 * 等于给全体老账号换设备，故加字段只能追加在末尾。
 * @param ltuid 账号标识，见 cookie.ts 的 `pickLtuid`
 * @param createdAt 首次分配时间，默认当前时间
 * @returns 虚拟设备身份
 */
export function deriveDevice(ltuid: string, createdAt: number = Date.now()): DeviceIdentity {
  const seed = createHash("sha256")
    .update(SEED_DOMAIN + ltuid)
    .digest()
  const stream = new SeedStream(seed)
  const spec = stream.pick(DEVICE_CATALOG)

  return {
    id: stream.uuid(),
    name: spec.marketName,
    spec,
    ids: {
      oaid: stream.uuid().toLowerCase(),
      aaid: stream.uuid().toLowerCase(),
      vaid: stream.uuid().toLowerCase(),
      serial: stream.hex(8).toUpperCase(),
      androidId: stream.hex(8),
      seedId: stream.uuid().toLowerCase(),
      hostname: `builder-${stream.hex(3)}`,
      buildUser: "builder",
      // 构建时间落在 2022-04 之后的两年区间内，与目录中的机型年代相称
      buildTime: String(1_650_000_000_000 + stream.int(60_000_000_000))
    },
    source: "virtual",
    createdAt
  }
}

/**
 * 拼 `device-fp/api/getFp` 的 `ext_fields`
 *
 * 一律按 Android 形态拼装，四处必须同源：UA、`x-rpc-device_model`、`ext_fields`、`platform`
 * 取自同一份规格 —— 混写 iOS 形态会让设备画像自相矛盾，那本身就是可识别的特征。
 *
 * 波动字段（剩余内存、传感器读数）由 `sha256("ext:" + device_id)` 派生而非即时随机：
 * 同一台设备每次上报的读数必须一致。
 * @param device 设备身份
 * @returns JSON 字符串
 */
export function androidExtFields(device: DeviceIdentity): string {
  const s = device.spec
  const stream = new SeedStream(createHash("sha256").update(`ext:${device.id}`).digest())
  const romTotal = s.rom * 1024
  const ramTotal = s.ram * 1024
  const romRemain = Math.floor(romTotal * (0.2 + stream.int(50) / 100))
  const ramRemain = Math.floor(ramTotal * (0.15 + stream.int(40) / 100))
  const accelerometer = `${stream.float(0.1, 0.4)},${stream.float(-0.2, 0.4)},${stream.float(9.7, 0.3)}`
  const gyroscope = `${stream.float(0, 0.01)},${stream.float(0, 0.01)},${stream.float(0, 0.01)}`

  return JSON.stringify({
    cpuType: s.cpu,
    romCapacity: String(romTotal),
    productName: s.product,
    romRemain: String(romRemain),
    manufacturer: s.manufacturer,
    appMemory: "512",
    hostname: device.ids.hostname,
    screenSize: s.screen,
    osVersion: s.osVersion,
    aaid: device.ids.aaid,
    vendor: "中国移动",
    accelerometer,
    buildTags: "release-keys",
    model: s.model,
    brand: s.brand,
    oaid: device.ids.oaid,
    hardware: s.hardware,
    deviceType: s.product,
    devId: "REL",
    serialNumber: device.ids.serial,
    sdCapacity: String(romTotal - 1024),
    buildTime: device.ids.buildTime,
    buildUser: device.ids.buildUser,
    simState: "5",
    ramRemain: String(ramRemain),
    deviceInfo: `${s.brand}/${s.product}/${s.product}:${s.osVersion}/${s.buildId}/${s.incremental}:user/release-keys`,
    gyroscope,
    vaid: device.ids.vaid,
    buildType: "user",
    sdkVersion: String(s.sdk),
    board: s.board,
    aid: device.ids.androidId
  })
}

/** 取 fp 时的应用标识：国服米游社 / 国际服 HoYoLAB */
export type FpApp = "cn" | "os"

/**
 * 拼 `device-fp/api/getFp` 的请求体
 *
 * `seed_id` 取设备自带的值而非每次重新生成：服务端把 `seed_id + device_id` 视为同一台设备的
 * 两个组成部分，换 seed 等同于换设备。
 * @param device 设备身份
 * @param app 应用标识
 * @param previous 上一次取得的 fp，缺失时使用占位值
 * @returns 请求体
 */
export function fpRequestBody(device: DeviceIdentity, app: FpApp, previous?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    seed_id: device.ids.seedId,
    device_id: device.id,
    platform: "2",
    seed_time: String(Date.now()),
    ext_fields: androidExtFields(device),
    app_name: app === "cn" ? "bbs_cn" : "bbs_oversea",
    device_fp: previous ?? PLACEHOLDER_FP
  }
  // 国际服多出一个字段，且与 seed_id 取值相同：HoYoLAB 以其进行设备聚合
  if (app === "os") body["hoyolab_device_id"] = device.ids.seedId
  return body
}

/**
 * 设备相关的请求头
 * @param device 设备身份
 * @param fp 已取得的 device_fp，缺失时使用占位值
 * @returns 请求头
 */
export function deviceHeaders(device: DeviceIdentity, fp?: string): Record<string, string> {
  return {
    "x-rpc-device_id": device.id,
    "x-rpc-device_fp": fp ?? PLACEHOLDER_FP,
    "x-rpc-device_name": device.name,
    "x-rpc-device_model": device.spec.model,
    "x-rpc-sys_version": device.spec.osVersion
  }
}

/**
 * 米游社 / HoYoLAB App 的 UA
 * @param device 设备身份
 * @param appVersion App 版本号
 * @param app 应用标识，决定 UA 尾部的 App 标记
 * @returns UA 字符串
 */
export function deviceUserAgent(device: DeviceIdentity, appVersion: string, app: FpApp = "cn"): string {
  const s = device.spec
  const tail = app === "cn" ? `miHoYoBBS/${appVersion}` : `miHoYoBBSOversea/${appVersion}`
  return (
    `Mozilla/5.0 (Linux; Android ${s.osVersion}; ${s.model}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Version/4.0 Chrome/${CHROME_VERSION} Mobile Safari/537.36 ${tail}`
  )
}
