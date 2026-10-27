/**
 * 模块职责：面板数据的落库 —— 玩家与逐角色面板的持久化
 * 依赖方向：依赖内核的 `KvNamespace` 与 panel/profile（统一形态）；不发请求、不算属性
 * 生命周期：随插件 setup 造一个实例；数据全在 KV 里，无内存常驻
 * 注意事项：{@link PanelStore.merge} 逐字段"新值优先、缺则留旧"——各源给的东西不重合，整体替换会让一次更新冲掉上个源存的。
 *          {@link isPanelReady} 要数据源在册、有天赋、圣遗物带词条，原神另需有武器（星铁绝区零空着是常态）；
 *          缺一项下游就算出看着正常而全错的属性。突破阶数不在其内：星铁米游社接口不给，由装配层按等级反推。
 *          键是 `<使用者>:<游戏>:<uid>`：使用者在最前是隔离的闸，同 uid 两个游戏是两个账号。绝区零多存一块
 *          `zzz`（见 panel/profile/zzz.ts）。判"变了没有"按游戏取字段白名单再归一（{@link COMPARE_FIELDS}），
 *          逐字节比会把"换了个源"判成名下每个角色都变了，列表标记从此恒亮。
 */
import type { KvNamespace } from "@yunzai-ng/types"
import type { PanelGame, PanelProfile, ProfileArti, ProfileAvatar, ProfileWeapon } from "../panel/profile/index.js"
import type { ZzzAvatarDetail } from "../panel/profile/index.js"

/**
 * 认得的数据源标识
 *
 * 白名单，不认识的源一律不算有效面板：只有名字与等级的那种记录（如从角色列表接口带回来的）
 * 也落在这张表外，拿它去算属性与评分只会得出一份看着正常而完全错误的结果。
 */
export const PANEL_SOURCES: readonly string[] = [
  "enka",
  "mgg",
  "hanxuan",
  "lyln",
  "homo",
  "avocado.wiki",
  "enkaHSR",
  "mysPanel",
  "mysPanelHSR",
  "mysPanelZZZ",
  "enkaZZZ",
  "change"
]

/** 存起来的一个角色面板 */
export interface StoredAvatar {
  /** 角色 id */
  id: string
  /** 等级 */
  level: number
  /** 突破阶数 */
  promote?: number
  /** 好感度，原神独有 */
  fetter?: number
  /** 命座 / 星魂 */
  cons: number
  /** 时装 id，原神独有 */
  costume?: number
  /** 元素 / 命途 */
  elem?: string
  /** 武器 / 光锥 */
  weapon?: ProfileWeapon
  /** 天赋等级，键为 `a` / `e` / `q` 等；**不含命座加成** */
  talent?: Record<string, number>
  /** 已激活的行迹 id，星铁独有 */
  trees?: string[]
  /** 圣遗物 / 遗器，带词条 id，可评分 */
  artis?: Record<string, ProfileArti>
  /** 绝区零专属的那几块 */
  zzz?: ZzzAvatarDetail
  /** 数据源标识 */
  from?: string
  /** 面板数据的时间戳 */
  at?: number
}

/** 存起来的一个玩家 */
export interface StoredPlayer {
  /** 游戏 */
  game: PanelGame
  /** uid */
  uid: string
  /** 昵称 */
  name?: string
  /** 冒险等阶 / 开拓等级 */
  level?: number
  /** 头像 id */
  face?: string
  /** 名片 id */
  card?: string
  /** 签名 */
  sign?: string
  /** 世界等级 */
  word?: number
  /** 逐角色的面板，键为角色 id */
  avatars: Record<string, StoredAvatar>
  /** 面板最后更新的时间戳 */
  profileAt?: number
}

/** 一次合并的结果 */
export interface MergeResult {
  /** 本次请求带回了哪些角色 id */
  updated: string[]
  /** 其中哪些角色的数据确实变了 */
  changed: string[]
}

/**
 * 一次更新带回来的东西，供列表图打标记用
 *
 * 放在这里而不在命令层：原神星铁与绝区零两条更新路径都要传它，而那两处的命令文件互相引用，
 * 类型落在其中一边会绕成一个环。取名与用法见 commands/panel.ts 的说明。
 */
export interface RefreshMark extends MergeResult {
  /** 数据源展示名 */
  servName?: string
  /** 附在提示语末尾的一句话，如「名下另有 N 位未取」 */
  note?: string
}

/** 造面板库需要的东西 */
export interface PanelStoreOptions {
  /** kv */
  kv: KvNamespace
}

/**
 * 判一份存起来的面板是否可用于计算
 *
 * 逐项缺一不可，理由见文件头。
 * @param one 存起来的角色面板
 * @param game 游戏
 * @returns 可用时为真
 */
export function isPanelReady(one: StoredAvatar | undefined, game: PanelGame): boolean {
  if (!one?.from || !PANEL_SOURCES.includes(one.from)) return false
  // 只有原神必须有武器：原神角色出场即带一把且卸不掉，另两个游戏空着是常态
  // 不按突破阶数判：星铁那一路的米游社接口不给它，按它判会把名下全部星铁角色判成"无面板"。
  // 缺失的阶数由装配层按等级反推
  if (game === "gs" && !(Number(one.weapon?.level) > 0)) return false
  if (!one.talent || Object.keys(one.talent).length === 0) return false

  // 绝区零的驱动盘落在 `zzz.discs` 而不在共用的 `artis` 里，故按自己那一块判。
  // 判「有几件盘」而不判「属性齐不齐」：属性那一栏接口一律给满，缺的只会是驱动盘
  if (game === "zzz") {
    const detail = one.zzz
    if (!detail || detail.attrs.length === 0) return false
    return detail.discs.some(it => it.main?.id !== undefined)
  }

  // 圣遗物要带主词条 id，否则算不出任何属性
  const artis = Object.values(one.artis ?? {})
  if (artis.length === 0) return false
  if (!artis.some(it => it.mainId !== undefined && it.mainId !== "")) return false

  // 旅行者要认得出元素，否则不知道该按哪套天赋算
  if (game === "gs" && ["10000005", "10000007"].includes(one.id)) return !!one.elem
  return true
}

/**
 * 一个角色是否有可展示的数据
 *
 * 等级大于 1 或带了武器即算有数据。用于"角色列表"这类不需要完整面板的场合。
 * @param one 存起来的角色面板
 * @returns 有数据时为真
 */
export function hasAvatarData(one: StoredAvatar | undefined): boolean {
  if (!one) return false
  return one.level > 1 || !!one.weapon?.name || !!one.weapon?.id
}

/**
 * 取一个对象的稳定签名，用于判"数据是否变了"
 *
 * 按键排序后序列化：各数据源的字段顺序不同，不排序会让同一份数据每次都判成"变了"。
 * @param value 任意可序列化值
 * @returns 签名
 */
function signature(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(signature).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${signature(v)}`).join(",")}}`
}

/**
 * 合并两份武器数据
 *
 * 新值优先，缺则留旧。`promote` 单独判 undefined —— 它的 0 是合法值。
 * @param old 旧值
 * @param next 新值
 * @returns 合并结果；两者都没有时 undefined
 */
function mergeWeapon(old: ProfileWeapon | undefined, next: ProfileWeapon | undefined): ProfileWeapon | undefined {
  if (!next) return old
  const out: ProfileWeapon = { ...old, ...stripUndefined(next) }
  if (out.promote === undefined && old?.promote !== undefined) out.promote = old.promote
  return out
}

/**
 * 去掉值为 undefined 的键
 *
 * 展开合并时 `next` 里显式的 undefined 会把旧值覆盖掉，于是"新数据没给这一项"变成"这一项被删了"。
 * @param one 对象
 * @returns 去掉 undefined 后的浅拷贝
 */
function stripUndefined<T extends object>(one: T): T {
  const out = {} as Record<string, unknown>
  for (const [key, val] of Object.entries(one)) {
    if (val !== undefined) out[key] = val
  }
  return out as T
}

/**
 * 参与「数据是否变了」比较的字段，逐游戏一份
 *
 * 白名单而不是黑名单：时间戳每次都变、`from` 换源就变、`zzz.attrs` 是推导结果，算进去
 * 「本次有变化」这个标记就恒亮。
 *
 * `promote`（突破阶数）不在任何一份里：米游社那一路不给它而展柜源给，两条路来回换时它会
 * 反复出现与消失。
 */
const COMPARE_FIELDS: Readonly<Record<PanelGame, readonly string[]>> = {
  gs: ["id", "level", "fetter", "cons", "costume", "elem", "weapon", "talent", "artis"],
  sr: ["level", "cons", "weapon", "talent", "trees", "artis"],
  zzz: ["level", "cons", "weapon", "talent", "zzz"]
}

/**
 * 星铁要从比较里剔掉的副词条 —— 速度那一族，id 以 `7` 开头
 *
 * 各源给速度的精度不同（游戏内取整、展柜给原值），反推出的档位会在两次更新之间来回跳一档。
 */
const SR_IGNORE_ATTR = "7"

/**
 * 取一件圣遗物 / 遗器里参与比较的部分
 *
 * 副词条要排序：展柜源按强化次序给、米游社按展示次序给，不归一则换一次源名下每一件都判成
 * "变了"。不用求和代替排序 —— `[1,2]` 与 `[0,3]` 会撞成同一个和，即真变了却判成没变。
 * **原神再去掉档位末位**：副词条 id 末位是档位、前缀是属性。展柜给精确档位、米游社反推近似档位，
 * 不抹则两源来回换时每一件都判成变了。代价是只换了档位的同种圣遗物判不出变化。
 * @param one 一件圣遗物 / 遗器
 * @param game 游戏
 * @returns 归一后的浅拷贝
 */
function comparableArti(one: ProfileArti, game: PanelGame): Record<string, unknown> {
  const { attrIds, ...rest } = one
  if (!attrIds) return rest
  const ids = attrIds
    .map(it => String(it))
    // 星铁的副词条写成 `id,档数,步进`，判前缀要取第一段
    .filter(it => !(game === "sr" && (it.split(",")[0] ?? it).startsWith(SR_IGNORE_ATTR)))
    .map(it => (game === "gs" ? it.slice(0, -1) : it))
    .sort((a, b) => a.localeCompare(b))
  return { ...rest, attrIds: ids }
}

/**
 * 取绝区零一份面板里参与比较的部分
 *
 * 只留六件驱动盘的"哪一件、几级、什么词条"，理由见 {@link COMPARE_FIELDS}。
 * @param detail 绝区零专属那一份
 * @returns 蒸干后的形态
 */
function discSign(detail: ZzzAvatarDetail): Record<string, unknown>[] {
  return [...detail.discs]
    .sort((a, b) => a.pos - b.pos)
    .map(one => ({
      pos: one.pos,
      id: one.id,
      level: one.level,
      main: one.main?.id ?? 0,
      subs: one.subs
        .map(sub => `${sub.id}:${sub.rolls}`)
        .sort((a, b) => a.localeCompare(b))
    }))
}

/**
 * 面板数据库
 *
 * **只发放按使用者绑定的视图**（{@link PanelStore.of}），本类自身不提供任何按 uid 读写的方法：
 * 面板里混着凭本人 CK 取来的私有数据（`#米游社更新面板` 的全部角色、`#刷新天赋` 的技能等级），
 * 而 uid 谁都能绑。按 uid 共用一份即等于「绑了别人的 uid 就能看、能删他的面板」。
 * 拿视图而非逐个方法带 user 参数，是让命令层**在类型上写不出**跨使用者的读写。
 *
 * 代价是两个人看同一个 uid 时各存一份展柜数据，可接受。
 */
export class PanelStore {
  readonly #kv: KvNamespace

  /**
   * @param opts 选项
   */
  constructor(opts: PanelStoreOptions) {
    this.#kv = opts.kv
  }

  /**
   * 取一位使用者名下的面板库
   * @param user 使用者标识
   * @returns 绑定该使用者的视图
   * @throws {Error} user 为空 —— 空串会让所有人落进同一个命名空间，宁可当场报错
   */
  of(user: string): UserPanels {
    if (!user) throw new Error("PanelStore.of 需要使用者标识")
    return new UserPanels(this.#kv, user)
  }
}

/**
 * 一位使用者名下的面板库
 *
 * 一个实例管三个游戏。所有读写都过 KV，不留内存缓存 —— 面板数据每次查询都要读最新的，
 * 缓存一份只会让"刚更新完却看到旧数据"。
 */
export class UserPanels {
  readonly #kv: KvNamespace
  readonly #user: string

  /**
   * @param kv 面板库的命名空间
   * @param user 使用者标识
   */
  constructor(kv: KvNamespace, user: string) {
    this.#kv = kv
    this.#user = user
  }

  /** 视图所属的使用者 */
  get user(): string {
    return this.#user
  }

  /**
   * 取存储键
   * @param game 游戏
   * @param uid uid
   * @returns 键，使用者在最前
   */
  #key(game: PanelGame, uid: string): string {
    return `${this.#user}:${game}:${uid}`
  }

  /**
   * 读一个玩家
   * @param game 游戏
   * @param uid uid
   * @returns 玩家；没存过时给一份空的
   */
  async load(game: PanelGame, uid: string): Promise<StoredPlayer> {
    const got = await this.#kv.get<StoredPlayer>(this.#key(game, uid))
    if (got) return { ...got, game, uid, avatars: got.avatars ?? {} }
    return { game, uid, avatars: {} }
  }

  /**
   * 写一个玩家
   * @param player 玩家
   */
  async save(player: StoredPlayer): Promise<void> {
    await this.#kv.set(this.#key(player.game, player.uid), player)
  }

  /**
   * 删一个玩家的面板数据
   * @param game 游戏
   * @param uid uid
   */
  async del(game: PanelGame, uid: string): Promise<void> {
    await this.#kv.del(this.#key(game, uid))
  }

  /**
   * 把一份新取到的面板并进库里
   *
   * 逐字段合并，理由见文件头。返回"本次带回了哪些角色"与"其中哪些确实变了" ——
   * 模板据此在列表上给新角色打标记，两者分开是因为重复点更新时前者非空而后者为空。
   * @param profile 统一形态的面板
   * @param opts 选项
   * @returns 合并结果
   */
  async merge(
    profile: PanelProfile,
    opts: {
      /** 时间戳，测试里可固定 */
      now?: number
    } = {}
  ): Promise<MergeResult> {
    const now = opts.now ?? Date.now()
    const player = await this.load(profile.game, profile.uid)

    // 玩家自身的信息同样"新值优先、缺则留旧"：部分源不给签名与名片
    if (profile.name !== undefined) player.name = profile.name
    if (profile.level !== undefined) player.level = profile.level
    if (profile.face !== undefined) player.face = String(profile.face)
    if (profile.card !== undefined) player.card = String(profile.card)
    if (profile.sign !== undefined) player.sign = profile.sign
    if (profile.word !== undefined) player.word = profile.word

    const updated: string[] = []
    const changed: string[] = []

    for (const [id, one] of Object.entries(profile.avatars)) {
      const old = player.avatars[id]
      const before = old ? signature(this.#comparable(old, profile.game)) : ""
      const next = this.#mergeAvatar(old, one, { ...opts, now, source: profile.from })
      player.avatars[id] = next
      updated.push(id)
      if (before !== signature(this.#comparable(next, profile.game))) changed.push(id)
    }

    player.profileAt = now
    await this.save(player)
    return { updated, changed }
  }

  /**
   * 合并一个角色
   * @param old 旧数据
   * @param next 新数据
   * @param opts 选项
   * @returns 合并结果
   */
  #mergeAvatar(
    old: StoredAvatar | undefined,
    next: ProfileAvatar,
    opts: { now: number; source?: string }
  ): StoredAvatar {
    // 数据源标识写在整份面板上（`PanelProfile.from`）而非逐个角色上，故此处以其兜底：
    // 缺了它 `StoredAvatar.from` 恒为 undefined，{@link isPanelReady} 第一道判定必假 ——
    // 表现是取数与落库都成功，而每一条面板命令都回「暂无面板数据」
    const from = next.from ?? opts.source
    const out: StoredAvatar = {
      ...old,
      ...stripUndefined({
        id: next.id,
        level: next.level,
        promote: next.promote,
        fetter: next.fetter,
        cons: next.cons,
        costume: next.costume,
        elem: next.elem,
        talent: next.talent,
        trees: next.trees,
        zzz: next.zzz,
        from
      })
    }
    out.level = next.level || old?.level || 1
    out.cons = next.cons ?? old?.cons ?? 0

    const weapon = mergeWeapon(old?.weapon, next.weapon)
    if (weapon) out.weapon = weapon

    const artis = next.artis
    if (artis && Object.keys(artis).length > 0) out.artis = artis

    out.at = opts.now
    return out
  }

  /**
   * 取参与"是否变了"比较的那部分
   *
   * 按游戏取字段白名单（{@link COMPARE_FIELDS}）再逐项归一：武器剔掉突破阶数、圣遗物副词条排序
   * 并按游戏剔掉该忽略的那些、绝区零只留驱动盘的骨架。少了这一层，换一次数据源就会把名下
   * 每一个角色都判成"有变化"。
   * @param one 角色面板
   * @param game 游戏
   * @returns 归一后的可比较形态
   */
  #comparable(one: StoredAvatar, game: PanelGame): Record<string, unknown> {
    const src = one as unknown as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of COMPARE_FIELDS[game]) {
      const val = src[key]
      if (val === undefined) continue
      if (key === "weapon") {
        // 突破阶数不参与比较，理由同 COMPARE_FIELDS 的说明
        const { promote: _promote, ...rest } = val as ProfileWeapon
        out[key] = rest
        continue
      }
      if (key === "artis") {
        const artis: Record<string, unknown> = {}
        for (const [pos, arti] of Object.entries(val as Record<string, ProfileArti>)) {
          artis[pos] = comparableArti(arti, game)
        }
        out[key] = artis
        continue
      }
      if (key === "zzz") {
        out[key] = discSign(val as ZzzAvatarDetail)
        continue
      }
      out[key] = val
    }
    return out
  }

  /**
   * 列出一个玩家有面板数据的角色 id
   * @param game 游戏
   * @param uid uid
   * @returns 角色 id
   */
  async panelIds(game: PanelGame, uid: string): Promise<string[]> {
    const player = await this.load(game, uid)
    return Object.entries(player.avatars)
      .filter(([, one]) => isPanelReady(one, game))
      .map(([id]) => id)
  }

  /**
   * 取一个角色的面板
   * @param game 游戏
   * @param uid uid
   * @param id 角色 id
   * @returns 角色面板；没有时 undefined
   */
  async avatar(game: PanelGame, uid: string, id: string): Promise<StoredAvatar | undefined> {
    return (await this.load(game, uid)).avatars[id]
  }

  /**
   * 是否已有任何可用面板
   * @param game 游戏
   * @param uid uid
   * @returns 有时为真
   */
  async hasPanel(game: PanelGame, uid: string): Promise<boolean> {
    return (await this.panelIds(game, uid)).length > 0
  }
}
