/**
 * 模块职责：原图索引 —— 记住"刚发出去的那张图，它的立绘取自哪个文件"
 * 依赖方向：只用内核的 KV；不碰磁盘、不发请求
 * 生命周期：随插件 setup 造一个实例
 * 注意事项：键是平台给的消息 id，故这件事只在平台既回消息 id、又在引用里带消息 id 时成立；
 *          两者缺一时 `#原图` 只能回一句"认不出你回复的是哪张图"，那是平台能力的边界而非缺陷。
 *
 *          存的是路径而不是图片本身：把字节写进 KV 会让一次面板查询往库里写几百 KB，
 *          而三小时内没人要原图的那些全是白写。
 */
import type { KvNamespace, Logger } from "@yunzai-ng/types"

/** 原图索引在 KV 里的子空间 */
const NS = "original"

/** 有效期，固定为三小时 */
const TTL = "3h"

/** 槽位，只有立绘一格；仍进键名，故改它会让三小时内已记下的索引全部失效 */
export type OriginalSlot = "pic"

/** 立绘的来源，只为让提示语说得准（"角色卡片原图" / "面板原图"） */
export type OriginalKind = "character" | "profile"

/** 一条原图记录 */
export interface OriginalRecord {
  /** 来源 */
  kind: OriginalKind
  /** 本机绝对路径，或一个可直接发出去的地址 */
  path: string
}

/** 造原图索引需要的东西 */
export interface OriginalStoreOptions {
  /** KV 命名空间 */
  kv: KvNamespace
  /** 日志器 */
  logger: Logger
}

/**
 * 原图索引
 *
 * 出图的命令发完图之后记一笔，`#原图` 凭被引用的消息 id 取回来。
 */
export class OriginalImgStore {
  readonly #kv: KvNamespace
  readonly #logger: Logger

  /**
   * @param opts 选项
   */
  constructor(opts: OriginalStoreOptions) {
    this.#kv = opts.kv
    this.#logger = opts.logger
  }

  /**
   * 记一笔"这条消息里那张图的原图在哪"
   *
   * 消息 id 或路径为空时**什么都不做**：平台不回消息 id 时那是常态，写一条键为空串的记录
   * 会让所有这类消息互相覆盖，`#原图` 随之取到别人那张图。
   * @param messageId 平台给的消息 id
   * @param slot 槽位
   * @param rec 记录
   */
  async remember(messageId: string, slot: OriginalSlot, rec: OriginalRecord): Promise<void> {
    if (!messageId || !rec.path) return
    try {
      await this.#kv.set(`${NS}:${slot}:${messageId}`, rec, { ttl: TTL })
    } catch (err) {
      this.#logger.debug(`[米游社][原图] 写索引失败：${String(err)}`)
    }
  }

  /**
   * 取一条原图记录
   * @param messageId 被引用的那条消息的 id
   * @param slot 槽位
   * @returns 记录；没有或已过期时 undefined
   */
  async get(messageId: string, slot: OriginalSlot): Promise<OriginalRecord | undefined> {
    if (!messageId) return undefined
    try {
      const got = await this.#kv.get<OriginalRecord>(`${NS}:${slot}:${messageId}`)
      return got?.path ? got : undefined
    } catch (err) {
      this.#logger.debug(`[米游社][原图] 读索引失败：${String(err)}`)
      return undefined
    }
  }
}
