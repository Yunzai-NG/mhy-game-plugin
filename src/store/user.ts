/**
 * 模块职责：用户档案 —— 一个人绑了哪些 uid、当前用哪个
 * 依赖方向：依赖内核的 KV 契约与本插件的 region
 * 生命周期：随插件 setup 创建一个实例，状态全在 KV 里
 * 注意事项：这里只存"平台用户 → 游戏 uid"。**不存"名下有哪些米游社账号"** —— 那件事由
 *          `CookieRecord.owner` 唯一记载（见 ck.ts），要查就 `cookies.owned(user)`。
 *          两处都记的话，同一个 Cookie 被另一个人重绑后 `owner` 变了而这里的名单不变，
 *          「我的 CK」与实际能用的 CK 就对不上。
 *
 *          当前 uid 以数组首项表示而不另设 `current` 字段：同一事实存两处必然出现
 *          "current 指向已删除的 uid"。
 */
import type { KvNamespace } from "@yunzai-ng/types"
import type { GameKey } from "../core/region.js"
import { isValidUid } from "../core/region.js"

/** 用户档案的 KV 键前缀 */
const USER_PREFIX = "user:"

/** 单个使用者每款游戏可绑定的 uid 上限，免得一个人的 uid 名单无限增长 */
const MAX_UIDS = 20

/** 单个使用者的档案 */
export interface UserProfile {
  /** 使用者标识，由适配器提供（形如 `qq:10001`） */
  id: string
  /** 各游戏绑定的 uid，**首项为当前 uid** */
  uids: Partial<Record<GameKey, string[]>>
  /** 最后一次变更时间（毫秒时间戳） */
  at: number
}

/** 用户存储的构造参数 */
export interface UserStoreOptions {
  /** KV 命名空间，建议传 `ctx.kv.sub("user")` */
  kv: KvNamespace
  /** 取当前时间，测试用 */
  now?: () => number
}

/**
 * 判断 KV 读回的值是不是完整档案
 * @param value KV 里的值
 * @returns 完整时为真
 */
function isProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object") return false
  const it = value as Partial<UserProfile>
  return typeof it.id === "string" && !!it.uids && typeof it.uids === "object"
}

/** 用户档案存储 */
export class UserStore {
  /** KV 命名空间 */
  private readonly kv: KvNamespace
  /** 取当前时间 */
  private readonly now: () => number

  /**
   * @param opts 构造参数
   */
  constructor(opts: UserStoreOptions) {
    this.kv = opts.kv
    this.now = opts.now ?? ((): number => Date.now())
  }

  /**
   * 读取档案，不存在时返回一份空档案
   *
   * 返回对象而非 undefined：调用点都是"读它绑了什么"，省掉每处的空值分支。
   * @param id 用户标识
   * @returns 档案
   */
  async get(id: string): Promise<UserProfile> {
    const value = await this.kv.get<UserProfile>(USER_PREFIX + id)
    return isProfile(value) ? value : { id, uids: {}, at: 0 }
  }

  /**
   * 写回档案；全空时直接删键，不留空壳
   * @param profile 档案
   * @returns 保存完成
   */
  private async put(profile: UserProfile): Promise<void> {
    const empty = Object.values(profile.uids).every(list => !list?.length)
    if (empty) {
      await this.kv.del(USER_PREFIX + profile.id)
      return
    }
    await this.kv.set(USER_PREFIX + profile.id, { ...profile, at: this.now() })
  }

  /**
   * 取当前 uid
   * @param id 用户标识
   * @param game 游戏
   * @returns 当前 uid；没绑过时 undefined
   */
  async uid(id: string, game: GameKey): Promise<string | undefined> {
    return (await this.get(id)).uids[game]?.[0]
  }

  /**
   * 取绑过的全部 uid
   * @param id 用户标识
   * @param game 游戏
   * @returns uid 数组，首项为当前 uid
   */
  async uids(id: string, game: GameKey): Promise<string[]> {
    return [...((await this.get(id)).uids[game] ?? [])]
  }

  /**
   * 绑定一个 uid
   *
   * 新绑的 uid 直接成为当前 uid；重复绑定等价于切换，同样提到首位。
   * @param id 用户标识
   * @param game 游戏
   * @param uid 游戏 uid
   * @returns 绑定后的 uid 列表；uid 不合法或已达上限时 undefined
   */
  async addUid(id: string, game: GameKey, uid: string | number): Promise<string[] | undefined> {
    const value = String(uid)
    if (!isValidUid(value)) return undefined

    const profile = await this.get(id)
    const list = profile.uids[game] ?? []
    const rest = list.filter(it => it !== value)
    if (rest.length >= MAX_UIDS) return undefined

    const next = [value, ...rest]
    profile.uids = { ...profile.uids, [game]: next }
    await this.put(profile)
    return next
  }

  /**
   * 切换当前 uid
   *
   * 既收完整 uid 也收序号（`#切换uid2`），序号自 1 起计，与展示顺序一致。
   * @param id 用户标识
   * @param game 游戏
   * @param target uid 或序号
   * @returns 切换后的当前 uid；目标不存在时 undefined
   */
  async switchUid(id: string, game: GameKey, target: string | number): Promise<string | undefined> {
    const profile = await this.get(id)
    const list = profile.uids[game] ?? []
    if (!list.length) return undefined

    const text = String(target)
    const index = /^\d{1,2}$/.test(text) ? Number(text) - 1 : list.indexOf(text)
    const uid = list[index]
    if (!uid) return undefined

    profile.uids = { ...profile.uids, [game]: [uid, ...list.filter(it => it !== uid)] }
    await this.put(profile)
    return uid
  }

  /**
   * 删除一个 uid
   * @param id 用户标识
   * @param game 游戏
   * @param uid 游戏 uid
   * @returns 删除后的 uid 列表；原本没绑时 undefined
   */
  async removeUid(id: string, game: GameKey, uid: string | number): Promise<string[] | undefined> {
    const value = String(uid)
    const profile = await this.get(id)
    const list = profile.uids[game] ?? []
    if (!list.includes(value)) return undefined

    const next = list.filter(it => it !== value)
    profile.uids = { ...profile.uids, [game]: next }
    await this.put(profile)
    return next
  }

  /**
   * 列出全部档案，供面板与推送任务遍历
   * @returns 档案数组
   */
  async list(): Promise<UserProfile[]> {
    const out: UserProfile[] = []
    for await (const [, value] of this.kv.entries<UserProfile>(USER_PREFIX)) {
      if (isProfile(value)) out.push(value)
    }
    return out
  }

  /**
   * 删除某一使用者的全部绑定
   * @param id 用户标识
   * @returns 删除完成
   */
  async remove(id: string): Promise<void> {
    await this.kv.del(USER_PREFIX + id)
  }
}




