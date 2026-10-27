/**
 * 模块职责：体力提醒的开关与节流 —— 谁开了提醒、阈值多少、推到哪、下次该几点去看
 * 依赖方向：依赖内核的 KV 契约与本插件的 region；不发请求，也不认识 Cookie
 * 生命周期：随插件 setup 创建一个实例，状态全在 KV 里
 * 注意事项：存的是"下次该几点看"，而不是每轮把所有人查一遍 —— 每十分钟扫一次等于一天替
 *          使用者撞米游社一百多次，正常查询反而被挡在外面。检查时刻由上一次拿到的回满秒数
 *          推算，推算在 service/note-task.ts。
 *
 *          提醒发到"开启时所在的那个会话"：群里开的发到那个群并 @ 一句，私聊开的就私聊；
 *          换个地方要重开一次 —— 猜错的后果是把某个人的体力播给一整群人。
 *
 *          连"当时是哪个 Bot 收到的"一并记下（{@link RemindState.botId}）：挂两个号时只按
 *          平台名挑一个在线 Bot 会挑到没进那个群的那一个，表现为"提醒不响"且日志里看不出原因。
 *
 *          群级开关是 opt-out（缺省开着）：它的用处是让群管理在被大量提醒占屏时能一处关掉。
 */
import type { KvNamespace } from "@yunzai-ng/types"
import type { GameKey } from "../core/region.js"

/** 逐使用者的提醒设置的 KV 键前缀 */
const REMIND_PREFIX = "remind:"

/** 群级开关的 KV 键前缀 */
const GROUP_PREFIX = "group:"

/** 阈值下限：低于它的阈值一律压到 20，否则刚回一点体力就响一次 */
export const REMIND_MIN = 20

/**
 * 各游戏的阈值缺省值与上限
 *
 * 上限只挡 `#体力提醒9999` 这类笔误，不是"高过上限就不提醒"：真正的判据是账号自己报上来的
 * 上限（见 service/note-task.ts 的 `want`）。
 */
export const REMIND_CAPS: Readonly<Record<GameKey, { def: number; max: number }>> = {
  gs: { def: 120, max: 200 },
  sr: { def: 180, max: 300 },
  zzz: { def: 180, max: 240 }
}

/** 一个使用者在一款游戏上的体力提醒设置 */
export interface RemindState {
  /** 使用者标识，形如 `qq:10001` */
  user: string
  /** 游戏 */
  game: GameKey
  /** 是否开着 */
  enabled: boolean
  /** 到多少体力时提醒 */
  threshold: number
  /** 推到哪个群；私聊里开的没有这一项 */
  groupId?: string
  /**
   * 开启时是哪个 Bot 收到的（`selfId`）
   *
   * 推送时优先用它。部署者挂两个号时，只按平台挑一个在线 Bot 会挑到没进那个群的那一个。
   */
  botId?: string
  /**
   * 上次查到的游戏 uid
   *
   * 小组件那条路要它，而提醒设置是按"使用者 + 游戏"存的、不含 uid。故第一轮走实时便笺
   * 并把 uid 记下来，之后才走小组件。
   */
  uid?: string
  /** 下次该去查的时刻（毫秒）；0 表示下一轮就查 */
  nextAt: number
  /** 上次提醒发出去的时刻（毫秒）；0 表示从未提醒过 */
  lastAt: number
  /** 上次变更时间（毫秒） */
  at: number
}

/** 一个群的提醒开关 */
export interface GroupRemindState {
  /** 群号 */
  gid: string
  /** 是否允许本群的提醒（缺省允许） */
  enabled: boolean
  /** 上次变更时间（毫秒） */
  at: number
}

/** 开启提醒时可给的东西 */
export interface RemindEnableOptions {
  /** 阈值；不给时沿用已存的，没存过则取该游戏的缺省值 */
  threshold?: number
  /** 推到哪个群；不给表示私聊 */
  groupId?: string
  /** 开启时是哪个 Bot 收到的（`selfId`），推送时优先用它 */
  botId?: string
  /** 已知的游戏 uid；给了它定时任务第一轮就能走小组件 */
  uid?: string
  /** 首次检查的时刻（毫秒）；不给表示下一轮就查 */
  nextAt?: number
}

/** 提醒存储的构造参数 */
export interface NoteRemindStoreOptions {
  /** KV 命名空间，建议传 `ctx.kv.sub("remind")` */
  kv: KvNamespace
  /** 取当前时间，测试用 */
  now?: () => number
}

/**
 * 把阈值压进合理区间
 * @param game 游戏
 * @param value 使用者给的数
 * @returns 压过的阈值；给的不是数时取该游戏的缺省值
 */
export function clampThreshold(game: GameKey, value: number): number {
  const caps = REMIND_CAPS[game]
  if (!Number.isFinite(value) || value <= 0) return caps.def
  return Math.min(caps.max, Math.max(REMIND_MIN, Math.round(value)))
}

/**
 * 判断 KV 读回的值是不是一份完整设置
 * @param value KV 里的值
 * @returns 完整时为真
 */
function isState(value: unknown): value is RemindState {
  if (!value || typeof value !== "object") return false
  const it = value as Partial<RemindState>
  return typeof it.user === "string" && typeof it.game === "string" && typeof it.enabled === "boolean"
}

/** 体力提醒的开关与节流 */
export class NoteRemindStore {
  /** KV 命名空间 */
  private readonly kv: KvNamespace
  /** 取当前时间 */
  private readonly now: () => number

  /**
   * @param opts 构造参数
   */
  constructor(opts: NoteRemindStoreOptions) {
    this.kv = opts.kv
    this.now = opts.now ?? ((): number => Date.now())
  }

  /**
   * 一条设置的 KV 键
   * @param user 使用者标识
   * @param game 游戏
   * @returns 键
   */
  private key(user: string, game: GameKey): string {
    return `${REMIND_PREFIX}${user}:${game}`
  }

  /**
   * 读一条设置
   *
   * 没存过时返回一份"关着的"设置而不是 undefined，省掉每处调用点的空值分支。
   * @param user 使用者标识
   * @param game 游戏
   * @returns 设置
   */
  async get(user: string, game: GameKey): Promise<RemindState> {
    const value = await this.kv.get<RemindState>(this.key(user, game))
    if (!isState(value)) {
      return { user, game, enabled: false, threshold: REMIND_CAPS[game].def, nextAt: 0, lastAt: 0, at: 0 }
    }
    return { ...value, user, game }
  }

  /**
   * 开启提醒
   *
   * `lastAt` 一并清零：使用者刚刚亲手开了一次，此时不该还压着上一次提醒留下的那几个小时。
   * @param user 使用者标识
   * @param game 游戏
   * @param opts 阈值、推送目标与首次检查时刻
   * @returns 新设置
   */
  async enable(user: string, game: GameKey, opts: RemindEnableOptions = {}): Promise<RemindState> {
    const prev = await this.get(user, game)
    const state: RemindState = {
      ...prev,
      enabled: true,
      threshold: clampThreshold(game, opts.threshold ?? prev.threshold),
      nextAt: opts.nextAt ?? 0,
      lastAt: 0,
      at: this.now()
    }
    // 私聊里开的要把旧的群号去掉，否则"在群里开过、后来私聊又开一次"会继续往那个群发
    if (opts.groupId) state.groupId = opts.groupId
    else delete state.groupId
    // Bot 号同理：换了号重开一次就该换成新的那个，认不出时留空由推送层按平台挑
    if (opts.botId) state.botId = opts.botId
    else delete state.botId
    if (opts.uid) state.uid = opts.uid
    await this.kv.set(this.key(user, game), state)
    return state
  }

  /**
   * 关闭提醒
   *
   * 只翻开关而不删记录：阈值是使用者调过的，下次再开时该还在。
   * @param user 使用者标识
   * @param game 游戏
   * @returns 新设置
   */
  async disable(user: string, game: GameKey): Promise<RemindState> {
    const state: RemindState = { ...(await this.get(user, game)), enabled: false, at: this.now() }
    await this.kv.set(this.key(user, game), state)
    return state
  }

  /**
   * 记下"下次几点再看"
   * @param user 使用者标识
   * @param game 游戏
   * @param nextAt 时刻（毫秒）
   */
  async schedule(user: string, game: GameKey, nextAt: number): Promise<void> {
    const prev = await this.get(user, game)
    await this.kv.set(this.key(user, game), { ...prev, nextAt })
  }

  /**
   * 记下这一条查到的是哪个 uid
   *
   * 只由定时任务调用，为的是下一轮能直接走小组件。
   * @param user 使用者标识
   * @param game 游戏
   * @param uid 游戏 uid
   */
  async remember(user: string, game: GameKey, uid: string): Promise<void> {
    const prev = await this.get(user, game)
    await this.kv.set(this.key(user, game), { ...prev, uid })
  }

  /**
   * 记一次已提醒
   *
   * 推送失败也照样记：发不出去的常见原因（不是好友、群把 Bot 踢了）不会在五分钟后自己好转，
   * 不记就等于每一轮都去米游社查一次、每一轮都发不出去。
   * @param user 使用者标识
   * @param game 游戏
   * @param at 提醒时刻（毫秒）
   * @param nextAt 下次检查时刻（毫秒）
   */
  async markSent(user: string, game: GameKey, at: number, nextAt: number): Promise<void> {
    const prev = await this.get(user, game)
    await this.kv.set(this.key(user, game), { ...prev, lastAt: at, nextAt, at })
  }

  /**
   * 列出全部设置，供定时任务遍历
   * @returns 设置数组
   */
  async list(): Promise<RemindState[]> {
    const out: RemindState[] = []
    for await (const [, value] of this.kv.entries<RemindState>(REMIND_PREFIX)) {
      if (isState(value)) out.push(value)
    }
    return out
  }

  /**
   * 本群是否允许提醒
   * @param gid 群号
   * @returns 允许时为真；没设置过按允许算
   */
  async groupEnabled(gid: string): Promise<boolean> {
    const value = await this.kv.get<GroupRemindState>(GROUP_PREFIX + gid)
    if (!value || typeof value !== "object" || typeof value.enabled !== "boolean") return true
    return value.enabled
  }

  /**
   * 开关整个群的提醒
   * @param gid 群号
   * @param enabled 是否允许
   * @returns 新状态
   */
  async setGroupEnabled(gid: string, enabled: boolean): Promise<GroupRemindState> {
    const state: GroupRemindState = { gid, enabled, at: this.now() }
    await this.kv.set(GROUP_PREFIX + gid, state)
    return state
  }
}
