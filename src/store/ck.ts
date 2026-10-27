/**
 * 模块职责：Cookie 池 —— 存储 CK、按「发起者 + uid」选取其本人的 CK、记录查询次数、按失败原因停用
 * 依赖方向：依赖内核的 KV / 日志契约与本插件的 cookie / device / region
 * 生命周期：随插件 setup 创建一个实例，状态全部保存于 KV，卸载时无需清理
 * 注意事项：**归属是硬闸**（规则见 README「账号与隐私」，实现在 {@link CookiePool.pick}）：故 `save` 无 `owner`
 *          一律拒写；`uids` 只在绑定时由 `bindings` 的返回写入，不开「给 CK 补挂 uid」的入口 ——
 *          那等于留一把手工绕过这道闸的钥匙。`save` / `remove` 分别 `devices.assign` / `devices.forget`，
 *          漏一处就留下悬挂的 CK 或设备。停用只认确已失效（`-100`），风控（`1034`）绝不停用，否则一次
 *          验证码就清空某人名下全部 CK。本地不设查询上限：CK 只给本人查自己，限了只会挡住自己；
 *          用量只计数供 `#用户统计` 看。
 */
import type { KvNamespace, Logger } from "@yunzai-ng/types"
import type { MysFailKind } from "../core/client.js"
import { normalizeCookie, pickLtuid, stokenCookie } from "../core/cookie.js"
import type { DeviceStore } from "../core/device.js"
import type { GameKey } from "../core/region.js"

/** CK 记录的键前缀 */
const CK_PREFIX = "ck:"

/** 每日计数的键前缀 */
const COUNT_PREFIX = "count:"

/** 「服务端已判定今日到顶」标记的键前缀 */
const BLOCK_PREFIX = "block:"

/** 一条 Cookie 记录 */
export interface CookieRecord {
  /** 米游社账号标识，本池的主键 */
  ltuid: string
  /** 规整后的 Cookie */
  cookie: string
  /**
   * stoken 那一份，形如 `stuid=1;stoken=v2_x;mid=m1_y;`
   *
   * 存整段可直接作请求头的片段而不是裸 token：`mid` 在 v2 体系里必需，只存 token 会让
   * 小组件与社区签到回 `10001`「请先登录」。
   */
  stoken?: string
  /** 该账号下各游戏的 uid */
  uids: Partial<Record<GameKey, string[]>>
  /**
   * 绑定者的用户标识 —— **归属闸的依据**
   *
   * 查任何私有数据都要求它等于发起者本人（见 {@link CookiePool.pick}），故必填；
   * 无归属的记录无从判定，任何查询都不会选中它。
   */
  owner: string
  /** 是否已停用 */
  disabled: boolean
  /** 停用原因，用于向管理员展示 */
  reason?: string
  /** 绑定时间（毫秒时间戳） */
  at: number
}

/** 绑定 Cookie 时可携带的信息 */
export interface SaveCookieOptions {
  /** 绑定者的用户标识，必填 —— 归属闸的依据，缺失即拒绝写入 */
  owner: string
  /** 已知的游戏 uid */
  uids?: Partial<Record<GameKey, string[]>>
}

/** 一个 CK 的使用情况 */
export interface CookieUsage {
  /** 账号标识 */
  ltuid: string
  /** 今日已用次数，只作统计 */
  used: number
  /** 是否已停用 */
  disabled: boolean
  /** 停用原因 */
  reason?: string
  /**
   * 米游社那一侧是否已判定它今日到顶
   *
   * 与 `disabled` 分开：那一个是"这条 CK 坏了，去重绑"，这一个是"今天别再用了，明天自己好"。
   * 不露出来的话 `#CK状态` 会说它可用，而它其实一次都挑不出来。
   */
  blocked?: boolean
}

/** Cookie 池的构造参数 */
export interface CookiePoolOptions {
  /** KV 命名空间，建议传入 `ctx.kv.sub("cookie")` */
  kv: KvNamespace
  /** 日志器 */
  logger: Logger
  /** 设备存储，绑定与删除时同步设备生命周期 */
  devices: DeviceStore
  /** 取当前时间，供测试注入 */
  now?: () => number
}

/**
 * 在日志中遮蔽账号标识
 * @param ltuid 账号标识
 * @returns 遮蔽后的字符串
 */
function mask(ltuid: string): string {
  return ltuid.length <= 4 ? "****" : `${ltuid.slice(0, 3)}****${ltuid.slice(-2)}`
}

/**
 * 判断自 KV 读回的值是否为完整的 CK 记录
 * @param value KV 中的值
 * @returns 完整时为真
 */
function isRecord(value: unknown): value is CookieRecord {
  if (!value || typeof value !== "object") return false
  const it = value as Partial<CookieRecord>
  // owner 也须存在：无归属的记录无从判定，直接当作不完整、任何查询都不选中
  return (
    typeof it.ltuid === "string" &&
    typeof it.cookie === "string" &&
    typeof it.owner === "string" &&
    it.owner !== "" &&
    !!it.uids &&
    typeof it.uids === "object"
  )
}

/**
 * 取本地日期戳，形如 `20260822`
 *
 * 用本地时区：按 UTC 算会让国服使用者的计数在上午 8 点清零，表现近似限额随机失效。
 * @param at 时间戳
 * @returns 日期戳
 */
function dateStamp(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
}

/**
 * 距当日结束的剩余毫秒数
 *
 * 作计数键的 ttl，故"次日自动清零"由存储层负责，不必另设定时任务。
 * @param at 时间戳
 * @returns 剩余毫秒，至少 1000
 */
function untilMidnight(at: number): number {
  const d = new Date(at)
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
  return Math.max(next - at, 1000)
}

/**
 * 合并两份 uid 表并去重
 * @param base 原有 uid 表
 * @param extra 新增 uid 表
 * @returns 合并结果
 */
function mergeUids(
  base: Partial<Record<GameKey, string[]>>,
  extra: Partial<Record<GameKey, string[]>> | undefined
): Partial<Record<GameKey, string[]>> {
  if (!extra) return base
  const out: Partial<Record<GameKey, string[]>> = { ...base }
  for (const [game, uids] of Object.entries(extra) as [GameKey, string[] | undefined][]) {
    if (!uids?.length) continue
    out[game] = [...new Set([...(out[game] ?? []), ...uids])]
  }
  return out
}

/** 选取 CK 时提供的线索 —— uid / game / owner 三者缺一不可，见 {@link CookiePool.pick} */
export interface PickOptions {
  /** 待查询的游戏 uid */
  uid: string
  /** 游戏 */
  game: GameKey
  /** 查询发起者 —— **只会选中他本人绑定的 CK**，这是越权的那道闸 */
  owner: string
  /** 本次不再使用的账号（刚被判定为失效者） */
  exclude?: readonly string[]
}

/**
 * Cookie 池
 *
 * 私人 CK 的存放、按归属选取、用量记账三者共用同一份记录，故合于一处。
 */
export class CookiePool {
  /** KV 命名空间 */
  private readonly kv: KvNamespace
  /** 日志器 */
  private readonly logger: Logger
  /** 设备存储 */
  private readonly devices: DeviceStore
  /** 取当前时间 */
  private readonly now: () => number

  /**
   * @param opts 构造参数
   */
  constructor(opts: CookiePoolOptions) {
    this.kv = opts.kv
    this.logger = opts.logger
    this.devices = opts.devices
    this.now = opts.now ?? ((): number => Date.now())
  }

  /**
   * 今日计数键
   * @param ltuid 账号标识
   * @returns KV 键
   */
  private countKey(ltuid: string): string {
    return `${COUNT_PREFIX}${ltuid}:${dateStamp(this.now())}`
  }

  /**
   * 「服务端说这个账号今天到顶了」的标记键
   *
   * 与计数分开存：本地不设上限，无从用"把计数顶满"表达停手。见 {@link report}。
   * @param ltuid 账号标识
   * @returns KV 键
   */
  private blockKey(ltuid: string): string {
    return `${BLOCK_PREFIX}${ltuid}:${dateStamp(this.now())}`
  }

  /**
   * 存入或更新一条 Cookie
   *
   * 同一账号重复绑定视为更新：`at` 保留，uid 表合并，停用标记清除，归属改记为本次的绑定者
   * （谁持有 Cookie 谁即拥有该账号）。今日计数刻意不清零 —— 否则删掉重绑即可绕过限额。
   * @param raw 使用者粘贴的 Cookie 文本
   * @param opts 附带信息，`owner` 必填
   * @returns 已存储的记录；Cookie 缺账号标识或未给 `owner` 时为 undefined
   */
  async save(raw: string, opts: SaveCookieOptions): Promise<CookieRecord | undefined> {
    const cookie = normalizeCookie(raw)
    const ltuid = pickLtuid(cookie)
    if (!cookie || !ltuid || !opts.owner) return undefined

    const old = await this.get(ltuid)
    const record: CookieRecord = {
      ltuid,
      cookie,
      uids: mergeUids(old?.uids ?? {}, opts.uids),
      owner: opts.owner,
      disabled: false,
      at: old?.at ?? this.now()
    }
    const stoken = stokenCookie(cookie) ?? old?.stoken
    if (stoken) record.stoken = stoken

    await this.kv.set(CK_PREFIX + ltuid, record)
    // 于绑定时即确定设备信息，此后该账号的每次请求均使用该设备
    await this.devices.assign(ltuid)
    this.logger.info(`账号 ${mask(ltuid)} 的 Cookie 已${old ? "更新" : "绑定"}`)
    return record
  }

  /**
   * 读取一条记录
   * @param ltuid 账号标识
   * @returns 记录；不存在时为 undefined
   */
  async get(ltuid: string): Promise<CookieRecord | undefined> {
    const value = await this.kv.get<CookieRecord>(CK_PREFIX + ltuid)
    return isRecord(value) ? value : undefined
  }

  /**
   * 列出全部记录
   *
   * 直接扫描 KV 而不另维护索引：CK 是"数十条"量级，一次扫描比维护两份可能不一致的数据便宜。
   * @returns 记录数组，按绑定时间升序
   */
  async list(): Promise<CookieRecord[]> {
    const out: CookieRecord[] = []
    for await (const [, value] of this.kv.entries<CookieRecord>(CK_PREFIX)) {
      if (isRecord(value)) out.push(value)
    }
    return out.sort((a, b) => a.at - b.at || a.ltuid.localeCompare(b.ltuid))
  }

  /**
   * 列出某人绑定的记录
   * @param owner 绑定者的用户标识
   * @returns 记录数组
   */
  async owned(owner: string): Promise<CookieRecord[]> {
    // 空串不是任何人：调用方没拿到发起者时宁可一条都不给，也不能让无归属的旧记录借空串对上
    if (!owner) return []
    return (await this.list()).filter(it => it.owner === owner)
  }

  /**
   * 删除一条 Cookie
   *
   * 设备痕迹一并清除，否则成为"CK 已删而设备仍存"的悬挂数据。重新绑定会派生出完全相同的
   * device_id，只是"常用设备"的计时从头开始。
   * @param ltuid 账号标识
   * @returns 原记录存在时为真
   */
  async remove(ltuid: string): Promise<boolean> {
    if (!(await this.kv.has(CK_PREFIX + ltuid))) return false
    await this.kv.del(CK_PREFIX + ltuid)
    await this.devices.forget(ltuid)
    this.logger.info(`账号 ${mask(ltuid)} 的 Cookie 已删除，设备信息一并清理`)
    return true
  }

  /**
   * 单独写入 stoken
   *
   * 不并进 Cookie 文本：只有小组件取数、社区签到与米游币三处用它，其余请求一律只带 Cookie。
   * @param ltuid 账号标识
   * @param stoken stoken 形态的 Cookie 片段
   * @returns 记录存在时为真
   */
  async setStoken(ltuid: string, stoken: string): Promise<boolean> {
    const record = await this.get(ltuid)
    if (!record) return false
    await this.kv.set(CK_PREFIX + ltuid, { ...record, stoken })
    return true
  }

  /**
   * 查找发起者本人绑定、且覆盖某个 uid 的 CK
   *
   * 与 {@link pick} 同一道归属闸：命令层据此判「这个 uid 能不能走 CK」——`#uid` 的 CK 标记、
   * `#更新面板` 选路、导出 stuid 三处在用。不过闸就会把别人的 CK 当成自己的，等于越权。
   * @param uid 游戏 uid
   * @param game 游戏
   * @param owner 发起者本人
   * @returns 记录；不存在时为 undefined
   */
  async find(uid: string, game: GameKey, owner: string): Promise<CookieRecord | undefined> {
    return (await this.owned(owner)).find(it => it.uids[game]?.includes(uid))
  }

  /**
   * 今日已用次数
   * @param ltuid 账号标识
   * @returns 次数
   */
  async count(ltuid: string): Promise<number> {
    return await this.kv.getOr<number>(this.countKey(ltuid), 0)
  }

  /**
   * 记录一次查询
   *
   * 键带日期戳、ttl 至当日零点，故"次日清零"由存储层完成，不依赖任何 Redis 专有能力。
   * @param ltuid 账号标识
   * @returns 记录后的今日次数
   */
  async use(ltuid: string): Promise<number> {
    return await this.kv.incr(this.countKey(ltuid), 1, { ttl: untilMidnight(this.now()) })
  }

  /**
   * 清零今日计数
   *
   * 只供主人的 `#重置用户缓存` 用：别处再开清零入口，删除后重新绑定即可绕过限额。
   * 服务端那个到顶标记要一并清掉，不清则"重置"之后那条 CK 仍然挑不出来。
   * @param ltuid 账号标识
   * @returns 清零完成
   */
  async resetCount(ltuid: string): Promise<void> {
    await this.kv.del(this.countKey(ltuid))
    await this.kv.del(this.blockKey(ltuid))
  }

  /**
   * 判定该条 CK 当前是否可用
   *
   * 两道判据：没被停用、服务端没说过它今天到顶。
   * @param record 记录
   * @returns 可用时为真
   */
  private async usable(record: CookieRecord): Promise<boolean> {
    if (record.disabled) return false
    return !(await this.kv.has(this.blockKey(record.ltuid)))
  }

  /**
   * 取使用情况，用于 `#CK状态` 一类的展示
   * @param ltuid 账号标识
   * @returns 使用情况
   */
  async usage(ltuid: string): Promise<CookieUsage> {
    const record = await this.get(ltuid)
    const out: CookieUsage = {
      ltuid,
      used: await this.count(ltuid),
      disabled: record?.disabled ?? false
    }
    if (record?.reason) out.reason = record.reason
    if (await this.kv.has(this.blockKey(ltuid))) out.blocked = true
    return out
  }

  /**
   * 选取一条可用的 CK
   *
   * **归属硬闸**：查 uid X 的私有数据（札记、角色详情、深渊、绝区零战绩……）只能用发起者本人
   * 绑定、且 `uids[game]` 含 X 的 CK。米游社那些接口不校验「这条 CK 是不是这个账号自己的」，
   * 一旦回落到发起者的其他 CK 或任意公共 CK，绑了别人的 uid 就能借它读到他的私有数据。故只在
   * 发起者名下、覆盖该 uid 的 CK 中选一条可用的；一条都没有即返回 undefined，不作任何回落。
   * @param opts 线索，uid / game / owner 三者缺一不可
   * @returns 可用记录；无任何可用记录时为 undefined
   */
  async pick(opts: PickOptions): Promise<CookieRecord | undefined> {
    const skip = new Set(opts.exclude ?? [])
    for (const it of await this.owned(opts.owner)) {
      if (skip.has(it.ltuid)) continue
      if (!it.uids[opts.game]?.includes(opts.uid)) continue
      if (await this.usable(it)) return it
    }
    return undefined
  }

  /**
   * 说清 {@link pick} 为什么没挑出东西
   *
   * 三种成因该说的话完全不同：没有覆盖该 uid 的自有 CK、都被停用、米游社那一侧判定该账号今日
   * 查询已达上限。
   * @param opts 与 `pick` 同一份线索
   * @returns 成因与给使用者的一句话
   */
  async explain(opts: PickOptions): Promise<{ kind: "none" | "disabled" | "blocked"; message: string }> {
    const mine = (await this.owned(opts.owner)).filter(it => it.uids[opts.game]?.includes(opts.uid))
    if (mine.length === 0) {
      return {
        kind: "none",
        message: "该 uid 未绑定你本人的 ck，无法查看其私有数据（不能借用他人账号的 ck）。请对该账号发送「#扫码登录」或「#绑定CK」"
      }
    }
    const live = mine.filter(it => !it.disabled)
    if (live.length === 0) {
      return { kind: "disabled", message: "ck 已失效，请发送「#刷新ck」，无效则重新「#扫码登录」" }
    }
    // 余下的未停用者挑不出来，只能是服务端判的到顶
    return { kind: "blocked", message: "米游社已限制该账号今日查询，零点后恢复" }
  }

  /**
   * 停用一条 CK
   * @param ltuid 账号标识
   * @param reason 原因，将展示给管理员
   * @returns 记录存在时为真
   */
  async disable(ltuid: string, reason: string): Promise<boolean> {
    const record = await this.get(ltuid)
    if (!record) return false
    if (record.disabled && record.reason === reason) return true
    await this.kv.set(CK_PREFIX + ltuid, { ...record, disabled: true, reason })
    this.logger.warn(`账号 ${mask(ltuid)} 的 Cookie 已停用：${reason}`)
    return true
  }

  /**
   * 恢复一条被停用的 CK
   * @param ltuid 账号标识
   * @returns 记录存在时为真
   */
  async enable(ltuid: string): Promise<boolean> {
    const record = await this.get(ltuid)
    if (!record) return false
    const next: CookieRecord = { ...record, disabled: false }
    delete next.reason
    await this.kv.set(CK_PREFIX + ltuid, next)
    return true
  }

  /**
   * 将一次请求结果回报至池
   *
   * 规则只三条：
   * - `cookie`：确已失效，予以停用 —— 这是唯一会停用 CK 的路径；
   * - `limit`：另记一个当日到零点过期的标记，本日不再选它；
   * - 其他（尤其 `risk`）：不做任何操作。验证码是全局风控，在此停用会让一次风控清空某人名下的
   *   全部 CK，表现为"CK 突然全部失效"。
   * @param ltuid 账号标识
   * @param kind 失败归类，成功时传 undefined
   * @param message 服务端原文，作为停用原因
   * @returns 处理完成
   */
  async report(ltuid: string, kind?: MysFailKind, message?: string): Promise<void> {
    if (!kind) return
    if (kind === "cookie") {
      await this.disable(ltuid, message ?? "Cookie 已失效")
      return
    }
    if (kind === "limit") {
      await this.kv.set(this.blockKey(ltuid), true, { ttl: untilMidnight(this.now()) })
      this.logger.warn(`账号 ${mask(ltuid)} 今日查询已达上限，本日不再以其发起请求`)
    }
  }
}

