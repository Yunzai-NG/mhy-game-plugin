/**
 * 模块职责：签到开关与签到流水 —— 哪些米游社账号开了自动签到、上次签到是哪天
 * 依赖方向：依赖内核的 KV 契约；不认识 Cookie 也不发请求
 * 生命周期：随插件 setup 创建一个实例，状态全在 KV 里
 * 注意事项：逐账号开关且缺省关闭 —— 自动签到会代替使用者写入。开关按米游社账号（`ltuid`）
 *          而非平台用户存：一个人可能绑三个账号，只想让其中一个自动签。
 *
 *          流水只记日期与一句结果，不记 Cookie 的任何部分。
 *
 *          日期用本地时区的 `YYYY-MM-DD` 而非时间戳：米游社的签到日切按自然日算。
 */
import type { KvNamespace } from "@yunzai-ng/types"

/** 签到记录的 KV 键前缀 */
const SIGN_PREFIX = "sign:"

/** 一个米游社账号的签到状态 */
export interface SignState {
  /** 米游社账号标识 */
  ltuid: string
  /** 是否开了自动签到 */
  enabled: boolean
  /** 上次签到成功的那一天，形如 `2026-09-02`；从未签过时为空串 */
  day: string
  /** 上次的结果一句话，供 `#签到状态` 展示；不含任何凭据 */
  text: string
  /** 上次变更时间（毫秒） */
  at: number
}

/** 签到存储的构造参数 */
export interface SignStoreOptions {
  /** KV 命名空间，建议传 `ctx.kv.sub("sign")` */
  kv: KvNamespace
  /** 取当前时间，测试用 */
  now?: () => number
}

/**
 * 本地时区的 `YYYY-MM-DD`
 *
 * 不用 `toISOString()`：那是 UTC，东八区的零点到八点会被算成前一天，表现是"明明签过了又签一次"。
 * @param at 毫秒时间戳
 * @returns 形如 `2026-09-02`
 */
export function signDay(at: number): string {
  const date = new Date(at)
  const two = (n: number): string => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/** 签到开关与流水 */
export class SignStore {
  /** KV 命名空间 */
  private readonly kv: KvNamespace
  /** 取当前时间 */
  private readonly now: () => number

  /**
   * @param opts 构造参数
   */
  constructor(opts: SignStoreOptions) {
    this.kv = opts.kv
    this.now = opts.now ?? ((): number => Date.now())
  }

  /**
   * 读一个账号的签到状态
   *
   * 没有记录时返回一份"关着的"状态而不是 undefined，省掉每处调用点的空值分支。
   * @param ltuid 米游社账号标识
   * @returns 状态
   */
  async get(ltuid: string): Promise<SignState> {
    const value = await this.kv.get<SignState>(SIGN_PREFIX + ltuid)
    if (!value || typeof value !== "object" || typeof value.enabled !== "boolean") {
      return { ltuid, enabled: false, day: "", text: "", at: 0 }
    }
    return { ...value, ltuid }
  }

  /**
   * 开关一个账号的自动签到
   * @param ltuid 米游社账号标识
   * @param enabled 是否开启
   * @returns 新状态
   */
  async setEnabled(ltuid: string, enabled: boolean): Promise<SignState> {
    const state = { ...(await this.get(ltuid)), enabled, at: this.now() }
    await this.kv.set(SIGN_PREFIX + ltuid, state)
    return state
  }

  /**
   * 判一个账号今天是否已经签过
   * @param ltuid 米游社账号标识
   * @returns 今天签过时为真
   */
  async signedToday(ltuid: string): Promise<boolean> {
    return (await this.get(ltuid)).day === signDay(this.now())
  }

  /**
   * 记一次签到结果
   *
   * 只有确实签成了才写日期：失败也写会让今天剩下的时间里不再重试，而网络抖动一类本该重试。
   * @param ltuid 米游社账号标识
   * @param ok 是否签成
   * @param text 一句结果，不得含凭据
   * @returns 新状态
   */
  async mark(ltuid: string, ok: boolean, text: string): Promise<SignState> {
    const at = this.now()
    const prev = await this.get(ltuid)
    const state: SignState = { ...prev, text, at, ...(ok ? { day: signDay(at) } : {}) }
    await this.kv.set(SIGN_PREFIX + ltuid, state)
    return state
  }

  /**
   * 删掉一个账号的签到记录（含自动签到开关），随 `#删除CK` 与 `#删除失效CK` 一并清理
   * @param ltuid 米游社账号标识
   */
  async remove(ltuid: string): Promise<void> {
    await this.kv.del(SIGN_PREFIX + ltuid)
  }
}
