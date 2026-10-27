/**
 * 模块职责：群面板排行
 * 依赖方向：依赖内核的 `KvNamespace`；不装配面板、不算伤害（分数由调用方算好传入）
 * 生命周期：随插件 setup 造一个实例
 * 注意事项：`KvNamespace` 无有序集合，故一个角色一个键、值为 uid→分数的普通对象、读时排序（此处 n 是群内查过某角色的人数，可接受）。
 *          分数不在本层算、由调用方传入，排行逻辑因而可单测。**开拓者的成对 id 要归并**（见 {@link TRAILBLAZER_MERGE}），
 *          否则男女主角各排一榜。**预设面板不参与排名**（见 {@link isPresetUid}），否则群里第一名恒是满命满级的内置数据。
 */
import type { KvNamespace } from "@yunzai-ng/types"
import type { PanelGame } from "./profile/index.js"

/** 排行的四个维度 */
export type RankType =
  /** 圣遗物总评分 */
  | "mark"
  /** 伤害期望 */
  | "dmg"
  /** 双爆副词条 */
  | "crit"
  /** 加权有效词条 */
  | "valid"

/** 四个维度，注册与遍历共用 */
export const RANK_TYPES: readonly RankType[] = ["mark", "dmg", "crit", "valid"]

/**
 * 开拓者的 id 归并表
 *
 * 星铁的开拓者按命途成对存在（男 / 女），同一条排行须归并。
 */
const TRAILBLAZER_MERGE: Readonly<Record<string, string>> = {
  "8002": "8001",
  "8004": "8003",
  "8006": "8005",
  "8008": "8007",
  "8009": "8010"
}

/** 原神星铁参与排名的 uid 下界：小于它的是内置预设面板 */
const PRESET_UID_MAX = 100000006

/** 一条排行里默认留多少名 */
const DEFAULT_LIMIT = 15

/**
 * 判定「基础角色」用的名字：开局就有的角色，第 4、5 档据此判断账号是否真在玩
 *
 * 按游戏分开列，好让档位说明（{@link LIMIT_TEXT}）与计数（{@link ProfileRank.setUidInfo}）同源。
 */
const BASIC_CHARS: Readonly<Record<PanelGame, readonly string[]>> = {
  gs: ["安柏", "凯亚", "丽莎"],
  sr: ["丹恒", "三月七", "三月七·巡猎"],
  zzz: ["安比", "妮可", "比利"]
}

/** 各游戏基础角色的展示串，如「安柏&凯亚&丽莎」 */
const BASIC_TEXT: Readonly<Record<PanelGame, string>> = {
  gs: "安柏&凯亚&丽莎",
  sr: "丹恒&三月七",
  zzz: "安比&妮可&比利"
}

/** 排名限制的档位说明 */
const LIMIT_TEXT: Readonly<Record<number, (game: PanelGame) => string>> = {
  1: () => "无限制",
  2: () => "绑定有CK的用户",
  3: () => "绑定CK，或列表有16个角色数据",
  4: game => `绑定CK，或列表有${BASIC_TEXT[game]}的数据`,
  5: game => `绑定CK，或列表有16个角色数据且包含${BASIC_TEXT[game]}`
}

/** 一个 uid 的排名资格信息 */
export interface UidRankInfo {
  /** 有面板数据的角色数 */
  totalCount: number
  /** 其中"基础角色"的个数 */
  basicCount: number
  /** uid 的来源：绑了 CK 的更可信 */
  uidType: "ck" | "bind"
  /** 关联的用户标识 */
  user?: string
}

/** 一个群的排行配置 */
export interface GroupRankCfg {
  /** 开关：0 开启、1 关闭 */
  status: number
  /** 本群排行数据的起算时刻 */
  timestamp: number
  /** 起算时刻的展示形态 */
  time: string
  /** 参与要求的说明 */
  limitTxt: string
  /** 一条排行留多少名 */
  number: number
}

/** 排行榜上的一名 */
export interface RankEntry {
  /** 上榜面板的持有者 —— 面板按用户分存，读榜时要凭它取回那一份 */
  user: string
  /** uid */
  uid: string
  /** 分数 */
  score: number
  /** 名次，1 起 */
  rank: number
}

/** 一个角色在某个维度上的名次 */
export interface TypeRank {
  /** 名次，1 起 */
  rank: number
  /** 分数 */
  score?: number
}

/** 造排行器需要的东西 */
export interface ProfileRankOptions {
  /** kv */
  kv: KvNamespace
  /** 读配置：排名限制档位，1~5 */
  limit: () => number
  /** 读配置：一条排行留多少名 */
  number?: () => number
}

/**
 * 把开拓者的成对 id 归并
 * @param id 角色 id
 * @returns 归并后的 id
 */
export function mergeCharId(id: string | number): string {
  const key = String(id)
  return TRAILBLAZER_MERGE[key] ?? key
}

/**
 * 判一个 uid 是否为内置预设面板
 *
 * **必须按游戏分**：这个下界是原神星铁的（它们的 uid 恒 9~10 位，`100000000~100000005` 是演示数据），
 * 而绝区零国服 uid 只有 8 位、一律小于它。不分游戏就等于把绝区零整个挡在榜外，且因无资格的分数
 * 本就静默不写（见 {@link ProfileRank.setScore}），表现为出图一切正常而榜永远是空的。
 * @param uid uid
 * @param game 游戏
 * @returns 是预设时为真
 */
export function isPresetUid(uid: string | number, game: PanelGame = "gs"): boolean {
  // 绝区零没有内置预设面板，也没有换装试算那种假 uid
  if (game === "zzz") return false
  return Number(uid) < PRESET_UID_MAX
}

/**
 * 榜单条目的键：`<用户>|<uid>`
 *
 * **带上用户**：面板按用户分存（见 store/panel.ts），两人更新同一 uid 是两份数据，只记 uid
 * 会让后写的那人覆盖前一人的分数、读榜时也不知该去谁名下取面板。用户标识形如 `qq:1`，故分隔符用 `|`。
 * @param user 用户标识
 * @param uid uid
 * @returns 条目键
 */
function entryKey(user: string, uid: string): string {
  return `${user}|${uid}`
}

/**
 * 拆开条目键
 * @param key 条目键
 * @returns 用户与 uid；不带分隔符的旧条目返回 undefined，读榜时丢弃
 */
function splitEntry(key: string): { user: string; uid: string } | undefined {
  const at = key.lastIndexOf("|")
  if (at <= 0) return undefined
  return { user: key.slice(0, at), uid: key.slice(at + 1) }
}

/**
 * 群面板排行
 *
 * 一个实例管全部群与两个游戏，键里带着群号与游戏。
 */
export class ProfileRank {
  readonly #opts: ProfileRankOptions

  /**
   * @param opts 选项
   */
  constructor(opts: ProfileRankOptions) {
    this.#opts = opts
  }

  /**
   * 一条排行的存储键
   * @param group 群号
   * @param game 游戏
   * @param type 维度
   * @param charId 角色 id
   * @returns 键
   */
  #boardKey(group: string, game: PanelGame, type: RankType, charId: string | number): string {
    return `board:${group}:${game}:${type}:${mergeCharId(charId)}`
  }

  /**
   * 一个 uid 的资格信息的存储键
   * @param game 游戏
   * @param uid uid
   * @returns 键
   */
  #infoKey(game: PanelGame, uid: string): string {
    return `uid:${game}:${uid}`
  }

  /**
   * 一个群的配置的存储键
   * @param group 群号
   * @param game 游戏
   * @returns 键
   */
  #cfgKey(group: string, game: PanelGame): string {
    return `cfg:${group}:${game}`
  }

  /**
   * 记一个 uid 的排名资格
   *
   * **`uidType` 只升不降**：一旦认定绑了 CK，别人查它时不该降回 `bind`。
   * @param input 输入
   */
  async setUidInfo(input: {
    /** 游戏 */
    game: PanelGame
    /** uid */
    uid: string
    /** 有面板数据的角色名 */
    names: readonly string[]
    /** uid 来源 */
    uidType?: "ck" | "bind"
    /** 关联的用户标识 */
    user?: string
  }): Promise<void> {
    const key = this.#infoKey(input.game, input.uid)
    const old = await this.#opts.kv.get<UidRankInfo>(key)
    // 星铁从 1 起：开拓者人人都有，但面板列表里不计入
    let basicCount = input.game === "sr" ? 1 : 0
    const basic = new Set(BASIC_CHARS[input.game])
    for (const name of input.names) {
      if (basic.has(name)) basicCount++
    }

    const next: UidRankInfo = {
      totalCount: input.names.length,
      basicCount,
      // 只升不降：绑过 CK 的 uid 不因别人查一次而降级
      uidType: old?.uidType === "ck" ? "ck" : (input.uidType ?? old?.uidType ?? "bind"),
      ...(input.user ?? old?.user ? { user: input.user ?? old?.user } : {})
    }
    await this.#opts.kv.set(key, next)
  }

  /**
   * 读一个 uid 的排名资格
   * @param game 游戏
   * @param uid uid
   * @returns 资格信息；没记过时 undefined
   */
  async uidInfo(game: PanelGame, uid: string): Promise<UidRankInfo | undefined> {
    return this.#opts.kv.get<UidRankInfo>(this.#infoKey(game, uid))
  }

  /**
   * 判一个 uid 是否有资格上榜
   *
   * 五档用意是挡住专为刷榜建的小号，判据是这份面板像不像真在玩的账号。
   * @param game 游戏
   * @param uid uid
   * @returns 有资格时为真
   */
  async allowRank(game: PanelGame, uid: string): Promise<boolean> {
    if (!uid) return false
    // 预设面板一律不参与，否则群里第一名恒是那份满命满级的内置数据
    if (isPresetUid(uid, game)) return false

    const limit = Number(this.#opts.limit()) || 1
    if (limit === 1) return true

    const info = await this.uidInfo(game, uid)
    if (!info) return false
    // 绑了 CK 的一律放行：那已经证明账号是本人的
    if (info.uidType === "ck") return true
    if (limit === 2) return false
    if (info.totalCount < 16 && [3, 5].includes(limit)) return false
    if (info.basicCount < 3 && [4, 5].includes(limit)) return false
    return true
  }

  /**
   * 记一个分数
   *
   * 无资格的 uid 不写入 —— 写了再在读时过滤，会让"第几名"这件事随资格变化而跳动。
   * @param input 输入
   * @returns 写入成功时为真
   */
  async setScore(input: {
    /** 群号 */
    group: string
    /** 游戏 */
    game: PanelGame
    /** 维度 */
    type: RankType
    /** 角色 id */
    charId: string | number
    /** 面板持有者 */
    user: string
    /** uid */
    uid: string
    /** 分数 */
    score: number
  }): Promise<boolean> {
    if (!input.group || !input.user || !Number.isFinite(input.score)) return false
    if (!(await this.allowRank(input.game, input.uid))) return false

    const key = this.#boardKey(input.group, input.game, input.type, input.charId)
    const board = (await this.#opts.kv.get<Record<string, number>>(key)) ?? {}
    board[entryKey(input.user, input.uid)] = input.score
    await this.#opts.kv.set(key, board)
    return true
  }

  /**
   * 读一条排行
   * @param input 输入
   * @returns 排行榜，分数降序
   */
  async board(input: {
    /** 群号 */
    group: string
    /** 游戏 */
    game: PanelGame
    /** 维度 */
    type: RankType
    /** 角色 id */
    charId: string | number
    /** 最多取几名 */
    limit?: number
  }): Promise<RankEntry[]> {
    const key = this.#boardKey(input.group, input.game, input.type, input.charId)
    const board = (await this.#opts.kv.get<Record<string, number>>(key)) ?? {}
    const rows = Object.entries(board)
      .flatMap(([key, score]) => {
        const who = splitEntry(key)
        return who ? [{ ...who, score: Number(score) || 0 }] : []
      })
      // 分数降序；并列时按 uid、再按用户升序，使名次稳定（否则同分者的名次每次读都可能互换）
      .sort((a, b) => b.score - a.score || a.uid.localeCompare(b.uid) || a.user.localeCompare(b.user))
    const limit = input.limit ?? this.#opts.number?.() ?? DEFAULT_LIMIT
    return rows.slice(0, limit).map((one, idx) => ({ ...one, rank: idx + 1 }))
  }

  /**
   * 查一个 uid 在某条排行里的名次
   * @param input 输入
   * @returns 名次与分数；不在榜上时 undefined
   */
  async rankOf(input: {
    /** 群号 */
    group: string
    /** 游戏 */
    game: PanelGame
    /** 维度 */
    type: RankType
    /** 角色 id */
    charId: string | number
    /** 面板持有者 */
    user: string
    /** uid */
    uid: string
  }): Promise<TypeRank | undefined> {
    // 取全榜而非截断的那一段：要问的是"我第几名"，而我可能在十五名之外
    const all = await this.board({ ...input, limit: Number.POSITIVE_INFINITY })
    const at = all.findIndex(one => one.uid === input.uid && one.user === input.user)
    if (at < 0) return undefined
    const got = all[at]
    return { rank: at + 1, ...(got ? { score: got.score } : {}) }
  }

  /**
   * 取某条排行的第一名
   * @param input 输入
   * @returns 第一名的 uid；榜为空时 undefined
   */
  async topUid(input: {
    /** 群号 */
    group: string
    /** 游戏 */
    game: PanelGame
    /** 维度 */
    type: RankType
    /** 角色 id */
    charId: string | number
  }): Promise<{ user: string; uid: string } | undefined> {
    const got = (await this.board({ ...input, limit: 1 }))[0]
    return got ? { user: got.user, uid: got.uid } : undefined
  }

  /**
   * 列出一个群在某一维度上有排行数据的角色 id
   * @param group 群号
   * @param game 游戏
   * @param type 维度
   * @returns 角色 id
   */
  async charIds(group: string, game: PanelGame, type: RankType): Promise<string[]> {
    const prefix = `board:${group}:${game}:${type}:`
    const out: string[] = []
    for await (const [key] of this.#opts.kv.entries<Record<string, number>>(prefix)) {
      const charId = key.slice(prefix.length)
      if (charId) out.push(charId)
    }
    return out
  }

  /**
   * 列出一个群里有排行数据的角色，各取其第一名
   *
   * @param group 群号
   * @param game 游戏
   * @param type 维度
   * @returns 角色 id 与其第一名的 uid
   */
  async topOfEach(
    group: string,
    game: PanelGame,
    type: RankType
  ): Promise<{ charId: string; user: string; uid: string }[]> {
    const prefix = `board:${group}:${game}:${type}:`
    const out: { charId: string; user: string; uid: string }[] = []
    for await (const [key] of this.#opts.kv.entries<Record<string, number>>(prefix)) {
      const charId = key.slice(prefix.length)
      if (!charId) continue
      const top = await this.topUid({ group, game, type, charId })
      if (top) out.push({ charId, ...top })
    }
    return out
  }

  /**
   * 读一个群的排行配置
   * @param group 群号
   * @param game 游戏
   * @returns 配置；没存过时给一份缺省的并落库
   */
  async groupCfg(group: string, game: PanelGame): Promise<GroupRankCfg> {
    const key = this.#cfgKey(group, game)
    const old = await this.#opts.kv.get<{ status: number; timestamp: number }>(key)
    const base = old ?? { status: 0, timestamp: Date.now() }
    if (!old) await this.#opts.kv.set(key, base)

    const limit = Number(this.#opts.limit()) || 1
    const d = new Date(base.timestamp)
    const pad = (n: number): string => String(n).padStart(2, "0")
    return {
      status: base.status,
      timestamp: base.timestamp,
      time: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      limitTxt: (LIMIT_TEXT[limit] ?? LIMIT_TEXT[1])?.(game) ?? "无限制",
      number: this.#opts.number?.() ?? DEFAULT_LIMIT
    }
  }

  /**
   * 开关一个群的排行
   * @param group 群号
   * @param game 游戏
   * @param status 0 开启、1 关闭
   */
  async setGroupStatus(group: string, game: PanelGame, status: number): Promise<void> {
    const key = this.#cfgKey(group, game)
    const old = await this.#opts.kv.get<{ status: number; timestamp: number }>(key)
    await this.#opts.kv.set(key, { status, timestamp: old?.timestamp ?? Date.now() })
  }

  /**
   * 重置一个群的排行
   *
   * 不给角色 id 时清掉整个群的全部维度，并把起算时刻推到现在。
   * @param group 群号
   * @param game 游戏
   * @param charId 只重置某个角色；省略则全清
   * @returns 清掉的键数
   */
  async reset(group: string, game: PanelGame, charId?: string | number): Promise<number> {
    if (charId !== undefined && charId !== "") {
      let count = 0
      for (const type of RANK_TYPES) {
        const key = this.#boardKey(group, game, type, charId)
        if (await this.#opts.kv.has(key)) {
          await this.#opts.kv.del(key)
          count++
        }
      }
      return count
    }

    const count = await this.#opts.kv.clear(`board:${group}:${game}:`)
    // 起算时刻推到现在：清空之后那句"X 之后查看过的数据"须随之更新
    await this.#opts.kv.set(this.#cfgKey(group, game), { status: 0, timestamp: Date.now() })
    return count
  }

  /**
   * 删掉某人名下一个 uid 的全部排行痕迹
   *
   * 面板数据被删时一并调用 —— 留着的话那一条仍挂在榜上，而它的面板已经查不到了。
   * **只删这个人的那一条**：同一 uid 别人也存过一份时，那份照常留在榜上。资格信息按 uid 记、
   * 与谁存的无关，故不动。
   * @param user 面板持有者
   * @param game 游戏
   * @param uid uid
   * @returns 从几条排行里删掉了它
   */
  async dropUid(user: string, game: PanelGame, uid: string): Promise<number> {
    const entry = entryKey(user, uid)
    let count = 0
    for await (const [key, board] of this.#opts.kv.entries<Record<string, number>>("board:")) {
      // 键形如 `board:<群>:<游戏>:<维度>:<角色>`，只动本游戏的
      if (!key.includes(`:${game}:`)) continue
      if (!board || board[entry] === undefined) continue
      delete board[entry]
      await this.#opts.kv.set(key, board)
      count++
    }
    return count
  }
}
