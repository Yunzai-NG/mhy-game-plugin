/**
 * 模块职责：「老婆 / 老公」指定名单 —— 谁把哪几个角色指成了哪一类
 * 依赖方向：依赖内核的 KV 契约；不认识元数据、不发请求
 * 生命周期：随插件 setup 创建一个实例，状态全在 KV 里
 * 注意事项：按平台用户 + 游戏 + 类别存，三者都要：混在一处会让「#老婆设置三月七」在原神那边
 *          也生效。
 *
 *          名单存角色正式名而不是 id：这一份要在 `#老婆是谁` 里原样印出来，存 id 就得在展示时
 *          反查元数据，而元数据可能没装。写入时已按元数据归一（见 commands/wife.ts）。
 *
 *          「随机」是哨兵值而不是空名单：空名单是"没设置过，从名下角色里挑"，「随机」是
 *          "设置过，就要每次随机"，两者的回复不同。
 */
import type { KvNamespace } from "@yunzai-ng/types"
import type { GameKey } from "../core/region.js"

/** 名单的 KV 键前缀 */
const WIFE_PREFIX = "wife:"

/** 表示"每次从名下角色里随机挑"的哨兵值 */
export const WIFE_RANDOM = "随机"

/** 认得的四个类别 */
export type WifeKind = "girlfriend" | "boyfriend" | "daughter" | "son"

/** 构造参数 */
export interface WifeStoreOptions {
  /** KV 命名空间，建议传 `ctx.kv.sub("wife")` */
  kv: KvNamespace
}

/** 指定名单 */
export class WifeStore {
  /** KV 命名空间 */
  private readonly kv: KvNamespace

  /**
   * @param opts 构造参数
   */
  constructor(opts: WifeStoreOptions) {
    this.kv = opts.kv
  }

  /**
   * 拼一个键
   * @param user 平台用户标识
   * @param game 游戏
   * @param kind 类别
   * @returns KV 键
   */
  private key(user: string, game: GameKey, kind: WifeKind): string {
    return `${WIFE_PREFIX}${user}:${game}:${kind}`
  }

  /**
   * 读一类的名单
   * @param user 平台用户标识
   * @param game 游戏
   * @param kind 类别
   * @returns 角色正式名；没设置过时空数组
   */
  async get(user: string, game: GameKey, kind: WifeKind): Promise<string[]> {
    const got = await this.kv.get<string[]>(this.key(user, game, kind))
    return Array.isArray(got) ? got.filter(one => typeof one === "string" && one) : []
  }

  /**
   * 写一类的名单
   * @param user 平台用户标识
   * @param game 游戏
   * @param kind 类别
   * @param names 角色正式名，或单元素的 `["随机"]`
   */
  async set(user: string, game: GameKey, kind: WifeKind, names: readonly string[]): Promise<void> {
    // 去重并去空：追加那一支会把旧名单并进来，可能重复
    const list = [...new Set(names.filter(one => one))]
    if (list.length === 0) {
      await this.kv.del(this.key(user, game, kind))
      return
    }
    await this.kv.set(this.key(user, game, kind), list)
  }

  /**
   * 清掉一类的名单
   * @param user 平台用户标识
   * @param game 游戏
   * @param kind 类别
   */
  async clear(user: string, game: GameKey, kind: WifeKind): Promise<void> {
    await this.kv.del(this.key(user, game, kind))
  }
}
