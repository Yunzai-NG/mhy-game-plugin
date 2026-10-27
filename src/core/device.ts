/**
 * 模块职责：设备信息的存储与选用 —— 绑定设备优先，没有则用按账号固定分配的虚拟设备
 * 依赖方向：依赖 `@yunzai-ng/types` 的 KV / 日志接口与本插件的 device-profile
 * 生命周期：随插件 setup 创建一个实例，插件卸载时无需清理（状态都在 KV 里）
 * 注意事项：绑定 Cookie 时即确定设备、此后不换 —— 设备一换，验证码、`1034`、`-100` 成片出现，故每个写操作都要
 *          先确认不会让已有账号换设备。使用者绑定的真机优先于虚拟设备（省掉重新养一天）；虚拟设备由账号标识确定性
 *          派生，存储只是缓存、缺失时直接重算。`device_fp` 记下取用时的 device_id，换设备时旧 fp 立即作废。
 */
import type { KvNamespace, Logger } from "@yunzai-ng/types"
import type { DeviceIdentity, DeviceSpec } from "./device-profile.js"
import { deriveDevice } from "./device-profile.js"

/** 虚拟设备的 KV 键前缀 */
const VIRTUAL_PREFIX = "virtual:"

/** 绑定设备的 KV 键前缀 */
const BOUND_PREFIX = "bound:"

/** fp 记录的 KV 键前缀 */
const FP_PREFIX = "fp:"

/** 一日的毫秒数 —— 米游社判定"常用设备"的门槛 */
const ONE_DAY = 24 * 60 * 60 * 1000

/** fp 默认复用上限：15 天。到期主动更换，避免服务端已使其失效而每次请求均被拦截 */
const DEFAULT_FP_MAX_AGE = 15 * ONE_DAY

/** 已取得的 device_fp 记录 */
export interface FpRecord {
  /** fp 值 */
  fp: string
  /** 取得该 fp 时使用的 device_id，与当前设备不一致即作废 */
  deviceId: string
  /** 取得时间（毫秒时间戳） */
  at: number
}

/**
 * 使用者绑定真机时可提供的字段
 *
 * 除 `id` 外均为可选：多数使用者仅能获取 `device_id` 与 `device_fp`，其余字段以虚拟
 * 设备的同名取值补齐 —— 机型仅影响 UA 与 ext_fields 的自洽性。
 */
export interface BoundDeviceInput {
  /**
   * 设备唯一标识（device_id）
   *
   * 可缺：真机上的取设备信息工具多只给 `oaid`。缺它时由 {@link parseBoundDevice} 从 `oaid`
   * 确定性派生一个。
   */
  id?: string
  /** 已在真机上取得的 device_fp */
  fp?: string
  /** 设备名 */
  name?: string
  /** 机型 */
  model?: string
  /** 品牌 */
  brand?: string
  /** 系统版本 */
  osVersion?: string
  /** 屏幕分辨率 */
  screen?: string
  /** 产品代号，对应 `ro.product.name` */
  product?: string
  /** 主板代号，对应 `ro.product.board` */
  board?: string
  /** 匿名设备标识 OAID，真机上系统生成、终生不变，故可作为派生 device_id 的种子 */
  oaid?: string
  /**
   * Android 指纹串
   *
   * 一串里带品牌、产品代号、系统版本、构建号与增量版本五项，后两项是 `ext_fields` 要用、
   * 又最难让使用者单独填对的。拆法见 {@link parseFingerprint}。
   */
  fingerprint?: string
}

/** 一个账号的设备现状，用于给用户展示 */
export interface DeviceView {
  /** 实际用于请求的设备 */
  active: DeviceIdentity
  /** 分配的虚拟设备 */
  virtual: DeviceIdentity
  /** 绑定的真机，未绑定时 undefined */
  bound?: DeviceIdentity
  /** 当前设备是否已满一日（米游社的常用设备门槛） */
  trusted: boolean
  /** 是否已取得可用的 device_fp */
  hasFp: boolean
}

/** 设备存储的构造参数 */
export interface DeviceStoreOptions {
  /** KV 命名空间，建议传 `ctx.kv.sub("device")` */
  kv: KvNamespace
  /** 日志器 */
  logger: Logger
  /** fp 复用上限（毫秒），默认 15 天；传函数可跟随配置变更 */
  fpMaxAge?: number | (() => number)
  /** 取当前时间，测试用 */
  now?: () => number
}

/** `#绑定设备` 文本中可识别的键名别名 → 规范字段 */
const FIELD_ALIASES: Readonly<Record<string, keyof BoundDeviceInput>> = {
  "x-rpc-device_id": "id",
  device_id: "id",
  deviceid: "id",
  id: "id",
  "x-rpc-device_fp": "fp",
  device_fp: "fp",
  devicefp: "fp",
  fp: "fp",
  "x-rpc-device_name": "name",
  device_name: "name",
  devicename: "name",
  name: "name",
  "x-rpc-device_model": "model",
  device_model: "model",
  devicemodel: "model",
  model: "model",
  brand: "brand",
  "x-rpc-sys_version": "osVersion",
  sys_version: "osVersion",
  os_version: "osVersion",
  osversion: "osVersion",
  android: "osVersion",
  screen: "screen",
  screen_size: "screen",
  screensize: "screen",
  // 以下是真机取设备信息的工具给出的那套键名（camelCase），上面那批 snake_case 是抓包请求头
  // 里的写法。两套都收；键名一律先转小写再查表，故此处只写小写形态。
  // 那套输入没有 device_id，故 `oaid` 在此处是必需的种子，见 parseBoundDevice
  androidversion: "osVersion",
  devicefingerprint: "fingerprint",
  fingerprint: "fingerprint",
  deviceboard: "board",
  board: "board",
  deviceproduct: "product",
  product: "product",
  oaid: "oaid"
}

/** device_id 的形态：UUID 或十六进制串，长度 8~64 */
const DEVICE_ID_RE = /^[0-9a-fA-F][0-9a-fA-F-]{7,63}$/

/**
 * 将使用者输入的逐行键值对归集为规范字段
 * @param text 使用者输入
 * @returns 规范字段
 */
function collectFields(text: string): Partial<Record<keyof BoundDeviceInput, string>> {
  const out: Partial<Record<keyof BoundDeviceInput, string>> = {}
  const pieces = text.startsWith("{") ? jsonPieces(text) : text.split(/[\r\n,;、]+/)

  for (const piece of pieces) {
    const at = piece.search(/[=:：]/)
    if (at <= 0) continue
    const key = piece.slice(0, at).trim().toLowerCase().replace(/\s+/g, "").replace(/^"|"$/g, "")
    const field = FIELD_ALIASES[key]
    if (!field) continue
    const value = piece
      .slice(at + 1)
      .trim()
      .replace(/^["']|["',]$/g, "")
      .trim()
    if (value) out[field] = value
  }
  return out
}

/**
 * 将 JSON 文本拆分为 `键=值` 片段，交由同一套别名表处理
 *
 * 解析失败时退回按行处理：手工转录的 JSON 多有引号缺失或逗号冗余，不该因此拒绝整次绑定。
 * @param text JSON 文本
 * @returns 片段数组
 */
function jsonPieces(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" || typeof value === "number")
        .map(([key, value]) => `${key}=${String(value)}`)
    }
  } catch {
    // 转由下方按行解析
  }
  return text.replace(/[{}]/g, "").split(/[\r\n,;、]+/)
}

/** 从 Android 指纹串里拆出的几项 */
export interface FingerprintParts {
  /** 品牌 */
  brand?: string
  /** 产品代号 */
  product?: string
  /** 系统版本 */
  osVersion?: string
  /** 构建号 */
  buildId?: string
  /** 增量版本 */
  incremental?: string
}

/**
 * 拆开 Android 指纹串
 *
 * 形态是 `品牌/产品/设备:版本/构建号/增量:类型/签名`，例如
 * `acme/AB1234/AB1234:14/UP1A.231005.007/eng.20240101.120000:user/release-keys`。
 * `buildId` 与 `incremental` 只在这里拿得到，而那两项要写进 `ext_fields`。
 *
 * 拆不出时返回空对象而非抛错：形态不符只意味着少几项自洽的字段，不该让整次绑定失败。
 * @param fp 指纹串
 * @returns 拆出的各项
 */
export function parseFingerprint(fp: string): FingerprintParts {
  // 品牌/产品/设备:版本/构建号/增量:类型/签名
  const hit = /^([^/]+)\/([^/]+)\/([^:]+):([^/]+)\/([^/]+)\/([^:]+):/.exec(fp.trim())
  if (!hit) return {}
  const out: FingerprintParts = {}
  if (hit[1]) out.brand = hit[1]
  if (hit[2]) out.product = hit[2]
  if (hit[4]) out.osVersion = hit[4]
  if (hit[5]) out.buildId = hit[5]
  if (hit[6]) out.incremental = hit[6]
  return out
}

/**
 * 由 oaid 派生一个 device_id
 *
 * 真机上取不到米游社的 device_id，而 `oaid` 是系统生成、终生不变的匿名设备标识，
 * 故以它为种子派生出的 device_id 同样稳定 —— 同一台真机每次绑定都得到同一个。
 *
 * 取 32 位十六进制并按 UUID 分段，与虚拟设备的形态一致。
 * @param oaid 匿名设备标识
 * @returns 大写 UUID 形态的 device_id
 */
export function deviceIdFromOaid(oaid: string): string {
  // oaid 本身多为 64 位十六进制，取其前 32 位即可；不足时用它自身重复补足
  const hex = oaid.replace(/[^0-9a-fA-F]/g, "").toLowerCase()
  const padded = hex.length >= 32 ? hex.slice(0, 32) : hex.repeat(Math.ceil(32 / Math.max(1, hex.length))).slice(0, 32)
  const parts = [
    padded.slice(0, 8),
    padded.slice(8, 12),
    padded.slice(12, 16),
    padded.slice(16, 20),
    padded.slice(20, 32)
  ]
  return parts.join("-").toUpperCase()
}

/**
 * 判断 oaid 是不是「没取到」的占位值
 *
 * 系统没给本应用开匿名设备标识时，工具拿到的是一串 0 或 `error_xxx`。拿它派生 device_id
 * 会让所有这样的手机得到同一个，等于一群人共用一台设备。
 * @param oaid 工具给出的 oaid
 * @returns 是占位值时为真
 */
export function isBlankOaid(oaid: string): boolean {
  const v = oaid.trim()
  return !/[1-9a-f]/i.test(v.replace(/[-\s]/g, "")) || /^error/i.test(v)
}

/**
 * 从使用者输入里取出 oaid 原文，不论能不能用
 *
 * 供命令层在解析失败时说清楚是不是 oaid 没取到。
 * @param text 使用者输入
 * @returns oaid 原文；没写时 undefined
 */
export function rawOaidOf(text: string): string | undefined {
  return collectFields(text.trim()).oaid
}

/**
 * 解析使用者输入的绑定设备信息
 *
 * 接受四种写法：真机工具给的 camelCase JSON、抓包的 snake_case JSON、`device_id=xxx`
 * 每行一条、`device_id: xxx` 冒号分隔。
 *
 * device_id 可以缺：真机工具常只给 `oaid`，此时由它确定性派生一个（见
 * {@link deviceIdFromOaid}）。两者都没有才拒绝；取不到的 oaid（{@link isBlankOaid}）当作没有。
 * @param text 使用者输入
 * @returns 绑定信息；既无合法 device_id 又无可用 oaid 时 undefined
 */
export function parseBoundDevice(text: string): BoundDeviceInput | undefined {
  const fields = collectFields(text.trim())
  // 指纹串里的品牌 / 产品 / 版本作为兜底，显式给出的同名字段优先
  const fromFp = fields.fingerprint ? parseFingerprint(fields.fingerprint) : {}

  const explicit = fields.id && DEVICE_ID_RE.test(fields.id) ? fields.id.toUpperCase() : undefined
  const oaid = fields.oaid && !isBlankOaid(fields.oaid) ? fields.oaid : undefined
  const id = explicit ?? (oaid ? deviceIdFromOaid(oaid) : undefined)
  if (!id) return undefined

  const input: BoundDeviceInput = { id }
  if (fields.fp) input.fp = fields.fp
  if (fields.name) input.name = fields.name
  if (fields.model) input.model = fields.model
  if (fields.brand ?? fromFp.brand) input.brand = fields.brand ?? fromFp.brand
  if (fields.osVersion ?? fromFp.osVersion) input.osVersion = fields.osVersion ?? fromFp.osVersion
  if (fields.screen) input.screen = fields.screen
  if (fields.product ?? fromFp.product) input.product = fields.product ?? fromFp.product
  if (fields.board) input.board = fields.board
  if (oaid) input.oaid = oaid
  if (fields.fingerprint) input.fingerprint = fields.fingerprint
  return input
}

/**
 * 判断从 KV 读回的值是不是完整的设备身份
 *
 * 字段不完整时视为不存在：派生是确定性的，重算所得的 device_id 与原值完全一致。
 * @param value KV 里的值
 * @returns 完整时为真
 */
function isIdentity(value: unknown): value is DeviceIdentity {
  if (!value || typeof value !== "object") return false
  const it = value as Partial<DeviceIdentity>
  return (
    typeof it.id === "string" &&
    typeof it.name === "string" &&
    typeof it.createdAt === "number" &&
    !!it.spec &&
    typeof it.spec === "object" &&
    !!it.ids &&
    typeof it.ids === "object" &&
    typeof it.ids.seedId === "string"
  )
}

/**
 * 日志里遮掉账号标识
 *
 * ltuid 即米游社账号 id，而日志会落盘、也会被使用者贴到群里求助。
 * @param ltuid 账号标识
 * @returns 遮蔽后的字符串
 */
function mask(ltuid: string): string {
  return ltuid.length <= 4 ? "****" : `${ltuid.slice(0, 3)}****${ltuid.slice(-2)}`
}

/**
 * 设备存储
 *
 * 一切"本次请求使用哪台设备"的判定均由本类给出，业务代码不得自行拼接 device_id。
 */
export class DeviceStore {
  /** KV 命名空间 */
  private readonly kv: KvNamespace
  /** 日志器 */
  private readonly logger: Logger
  /** fp 复用上限（毫秒） */
  private readonly fpMaxAge: () => number
  /** 取当前时间 */
  private readonly now: () => number

  /**
   * @param opts 构造参数
   */
  constructor(opts: DeviceStoreOptions) {
    this.kv = opts.kv
    this.logger = opts.logger
    const age = opts.fpMaxAge ?? DEFAULT_FP_MAX_AGE
    this.fpMaxAge = typeof age === "function" ? age : (): number => age
    this.now = opts.now ?? ((): number => Date.now())
  }

  /**
   * 绑定 Cookie 时调用：确保这个账号有一台固定的虚拟设备
   *
   * 幂等。已分配过时原样返回，尤其不得重写 `createdAt` —— 那等同于把已养成三日的
   * 常用设备退回首日。
   * @param ltuid 账号标识
   * @returns 虚拟设备
   */
  async assign(ltuid: string): Promise<DeviceIdentity> {
    const key = VIRTUAL_PREFIX + ltuid
    const saved = await this.kv.get<DeviceIdentity>(key)
    if (isIdentity(saved)) return saved

    const fresh = deriveDevice(ltuid, this.now())
    // 记录不完整（多因升级后字段有增减）时保留原有的首次分配时间
    const at = (saved as Partial<DeviceIdentity> | undefined)?.createdAt
    if (typeof at === "number") fresh.createdAt = at
    await this.kv.set(key, fresh)
    this.logger.info(`账号 ${mask(ltuid)} 分配固定虚拟设备：${fresh.name}（${fresh.spec.model}）`)
    return fresh
  }

  /**
   * 取本次请求应当使用的设备
   *
   * 绑定的真机优先，无绑定设备时使用分配的虚拟设备。本方法为全插件唯一的设备入口。
   * @param ltuid 账号标识
   * @returns 设备身份
   */
  async use(ltuid: string): Promise<DeviceIdentity> {
    return (await this.bound(ltuid)) ?? (await this.assign(ltuid))
  }

  /**
   * 取绑定的真机
   * @param ltuid 账号标识
   * @returns 绑定设备；未绑定时 undefined
   */
  async bound(ltuid: string): Promise<DeviceIdentity | undefined> {
    const saved = await this.kv.get<DeviceIdentity>(BOUND_PREFIX + ltuid)
    return isIdentity(saved) ? saved : undefined
  }

  /**
   * 绑定真机
   *
   * 只填 device_id 也能绑：缺的机型字段以虚拟设备的取值补齐，保证 UA 与 ext_fields 自洽。
   * 带 fp 时直接存入 —— 那份指纹已在真机上养成。
   *
   * 未带 fp 时不清空旧记录：旧 fp 属于虚拟设备，`fp()` 会因 device_id 不匹配而忽略它，
   * 解绑之后仍可继续使用。
   * @param ltuid 账号标识
   * @param input 绑定信息
   * @returns 绑定后的设备
   */
  async bind(ltuid: string, input: BoundDeviceInput): Promise<DeviceIdentity> {
    const base = await this.assign(ltuid)
    const spec: DeviceSpec = { ...base.spec }
    if (input.brand) {
      spec.brand = input.brand
      spec.manufacturer = input.brand
    }
    if (input.model) spec.model = input.model
    if (input.osVersion) spec.osVersion = input.osVersion
    if (input.screen) spec.screen = input.screen
    if (input.product) spec.product = input.product
    if (input.board) spec.board = input.board
    // 指纹串里的构建号与增量版本要写进 spec：`ext_fields` 用它们，而那两项只有指纹串里有
    if (input.fingerprint) {
      const parts = parseFingerprint(input.fingerprint)
      if (parts.buildId) spec.buildId = parts.buildId
      if (parts.incremental) spec.incremental = parts.incremental
    }
    // 机型给了而市场名没给时，市场名跟着机型走 —— 否则 UA 里会出现"虚拟设备的市场名 +
    // 真机的机型"这种不自洽的组合
    if (input.model && !input.name) spec.marketName = input.model
    if (input.name) spec.marketName = input.name

    const ids = { ...base.ids }
    // 真机的 oaid 优先：它是系统生成、终生不变的，比派生出来的那个更接近真实设备
    if (input.oaid) ids.oaid = input.oaid

    const device: DeviceIdentity = {
      id: input.id ?? base.id,
      name: input.name ?? input.model ?? base.name,
      spec,
      ids,
      source: "bound",
      createdAt: this.now()
    }
    await this.kv.set(BOUND_PREFIX + ltuid, device)
    if (input.fp) await this.saveFp(ltuid, input.fp, device.id)
    this.logger.info(`账号 ${mask(ltuid)} 绑定真机：${device.name}（${device.spec.model}）`)
    return device
  }

  /**
   * 解绑真机，回落到分配的虚拟设备
   * @param ltuid 账号标识
   * @returns 原本绑过时为真
   */
  async unbind(ltuid: string): Promise<boolean> {
    const key = BOUND_PREFIX + ltuid
    if (!(await this.kv.has(key))) return false
    await this.kv.del(key)
    this.logger.info(`账号 ${mask(ltuid)} 已解绑真机，回落到分配的虚拟设备`)
    return true
  }

  /**
   * 清除该账号的全部设备痕迹（删除 Cookie 时调用）
   *
   * 这不是"更换设备"：虚拟设备按账号确定性派生，重新绑定 Cookie 得到完全一致的 device_id，
   * 只有 `createdAt` 重新计时。
   * @param ltuid 账号标识
   * @returns 清理完成
   */
  async forget(ltuid: string): Promise<void> {
    await Promise.all([
      this.kv.del(VIRTUAL_PREFIX + ltuid),
      this.kv.del(BOUND_PREFIX + ltuid),
      this.kv.del(FP_PREFIX + ltuid)
    ])
  }

  /**
   * 取可用的 device_fp
   *
   * 三项条件缺一不可：存在记录、记录中的 device_id 与当前设备一致、未超过复用上限。
   * @param ltuid 账号标识
   * @returns fp；无可用 fp 时 undefined
   */
  async fp(ltuid: string): Promise<string | undefined> {
    const record = await this.kv.get<FpRecord>(FP_PREFIX + ltuid)
    if (!record || typeof record.fp !== "string" || !record.fp) return undefined
    if (this.now() - (record.at ?? 0) > this.fpMaxAge()) return undefined
    const device = await this.use(ltuid)
    return record.deviceId === device.id ? record.fp : undefined
  }

  /**
   * 存入已取得的 fp
   * @param ltuid 账号标识
   * @param fp fp 值
   * @param deviceId 取得 fp 时使用的 device_id，默认取当前设备
   * @returns 保存完成
   */
  async saveFp(ltuid: string, fp: string, deviceId?: string): Promise<void> {
    const id = deviceId ?? (await this.use(ltuid)).id
    const record: FpRecord = { fp, deviceId: id, at: this.now() }
    await this.kv.set(FP_PREFIX + ltuid, record)
  }

  /**
   * 丢弃 fp，下次请求时重新取得
   *
   * 只在服务端明确否决 fp（`1034`、设备校验）时调用。丢弃的是 fp 而非设备：device_id 必须
   * 原样保留，否则一次风控就把已养成的常用设备清零。
   * @param ltuid 账号标识
   * @returns 清理完成
   */
  async dropFp(ltuid: string): Promise<void> {
    await this.kv.del(FP_PREFIX + ltuid)
  }

  /**
   * 当前设备是否已使用满一日
   *
   * 满一日后米游社才视其为常用设备，故用于提示"刚绑完不宜立即频繁查询"。
   * @param ltuid 账号标识
   * @returns 已满一日时为真
   */
  async trusted(ltuid: string): Promise<boolean> {
    const device = await this.use(ltuid)
    return this.now() - device.createdAt >= ONE_DAY
  }

  /**
   * 取设备现状，用于展示
   * @param ltuid 账号标识
   * @returns 设备现状
   */
  async describe(ltuid: string): Promise<DeviceView> {
    const [virtual, bound] = await Promise.all([this.assign(ltuid), this.bound(ltuid)])
    const active = bound ?? virtual
    const view: DeviceView = {
      active,
      virtual,
      trusted: this.now() - active.createdAt >= ONE_DAY,
      hasFp: (await this.fp(ltuid)) !== undefined
    }
    if (bound) view.bound = bound
    return view
  }
}
