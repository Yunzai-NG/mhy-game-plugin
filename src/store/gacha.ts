/**
 * 模块职责：抽卡记录 —— authkey 的保管、分页取全量、按 id 去重落库
 * 依赖方向：依赖内核的 `Kv` / `HttpClient` / `Logger` 契约与本插件的 api / region
 * 生命周期：随插件 setup 创建一个实例；数据全在 KV 里，无内存常驻
 * 注意事项：authkey 有效一日、期内可读全部抽卡历史，故只在私聊受理。**记录与 authkey 都按「用户 + uid」
 *          分键存**：uid 谁都能绑（`#绑定uid` 不要凭据），按 uid 共用一份就能看别人的全部历史；
 *          authkey 一个 uid 一份，`#切换uid` 后不会拿前一个 uid 的链接去更新。抽卡接口不用 Cookie 与 DS、
 *          域名另一套，故直接用 `HttpClient` 而非 {@link MysClient} —— 纳入那条调用链会让
 *          查抽卡也得有 CK，而它本不需要。记录只增不减（官方只留半年），每次只取到已知最新一条为止
 *          （{@link fetchPool} 的 `known`）。
 */
import type { HttpClient, KvNamespace, Logger } from "@yunzai-ng/types"
import { gachaLogUrl } from "../core/api.js"
import type { GameKey } from "../core/region.js"
import { gameBiz, isCnServer } from "../core/region.js"

/** 一条抽卡记录 */
export interface GachaRecord {
  /** 记录 id，米游社提供的雪花号，可直接作为排序键 */
  id: string
  /** 所属卡池，取值为 {@link GachaPoolSpec.key}，原神 400 的记录归并至 301 */
  pool: string
  /** 物品名 */
  name: string
  /** 物品类型，如 `角色` / `武器` / `光锥` */
  itemType: string
  /** 星级，3 / 4 / 5 */
  rank: number
  /** 抽取时间，接口返回的为服务器本地时间字符串 */
  time: string
}

/** 保管起来的 authkey */
export interface AuthRecord {
  /** authkey 本体 */
  authkey: string
  /** 链接中携带的 region */
  region: string
  /** 该链接所属的 uid */
  uid: string
  /** 存入的时刻 */
  savedAt: number
}

/** authkey 的有效期，米游社给出的为 24 小时，此处留有余量 */
const AUTH_MAX_AGE = 23 * 60 * 60 * 1000

/** 单页最多 20 条，此为接口的硬性上限 */
const PAGE_SIZE = 20

/** 单个卡池的最大翻页数，用于避免一次异常响应导致内存被无限占用 */
const MAX_PAGES = 200

/** 相邻两页之间的间隔，米游社对该接口的频率限制较严，请求过快将直接返回 -110 */
const PAGE_GAP = 300

/** 一个卡池的定义 */
export interface GachaPoolSpec {
  /** 卡池标识，用作分组键 */
  key: string
  /** 展示名 */
  name: string
  /** 需请求的 `gacha_type`，原神的角色池分为 301 与 400 两个编号，须合并计算 */
  types: readonly string[]
  /** 五星保底抽数，视图层据此判定单次抽取的运气评级 */
  limit: number
}

/**
 * 各游戏的卡池表
 *
 * 原神的角色活动祈愿 `301` 与 `400` 共用同一套保底，故合并为一个卡池 —— 分开算会得出
 * 两个均不正确的保底进度。
 */
export const GACHA_POOLS: Readonly<Record<GameKey, readonly GachaPoolSpec[]>> = {
  gs: [
    { key: "301", name: "角色活动祈愿", types: ["301", "400"], limit: 90 },
    { key: "302", name: "武器活动祈愿", types: ["302"], limit: 80 },
    { key: "500", name: "集录祈愿", types: ["500"], limit: 80 },
    { key: "200", name: "常驻祈愿", types: ["200"], limit: 90 },
    { key: "100", name: "新手祈愿", types: ["100"], limit: 90 }
  ],
  sr: [
    { key: "11", name: "角色活动跃迁", types: ["11"], limit: 90 },
    { key: "12", name: "光锥活动跃迁", types: ["12"], limit: 80 },
    { key: "1", name: "群星跃迁", types: ["1"], limit: 90 },
    { key: "2", name: "始发跃迁", types: ["2"], limit: 50 }
  ],
  zzz: [
    { key: "2", name: "独家频段", types: ["2001"], limit: 90 },
    { key: "12", name: "独家重映", types: ["12001"], limit: 80 },
    { key: "3", name: "音擎频段", types: ["3001"], limit: 80 },
    { key: "13", name: "音擎回响", types: ["13001"], limit: 70 },
    { key: "1", name: "常规频段", types: ["1001"], limit: 90 },
    { key: "5", name: "邦布频段", types: ["5001"], limit: 80 }
  ]
}

/**
 * 绝区零展示分类 → 真实类型（`real_gacha_type`）
 *
 * 重映两支不是「真实类型 + 001」：`12001→102`、`13001→103`。
 */
const ZZZ_REAL_TYPE: Readonly<Record<string, string>> = {
  "2001": "2",
  "12001": "102",
  "3001": "3",
  "13001": "103",
  "1001": "1",
  "5001": "5"
}

/**
 * 取一个卡池编号的真实类型
 *
 * 绝区零卡池表存的是展示分类，UIGF 文件与 `real_gacha_type` 用的是真实类型；另两个游戏两者相同。
 * @param game 游戏
 * @param type 卡池表里的编号
 * @returns 真实类型
 */
export function gachaRealType(game: GameKey, type: string): string {
  if (game !== "zzz") return type
  return ZZZ_REAL_TYPE[type] ?? type.replace(/001$/, "")
}

/** 抽卡记录接口返回的一条原始记录 */
interface RawGachaItem {
  /** 记录 id */
  id?: string
  /** 卡池 id */
  gacha_type?: string
  /** 物品名 */
  name?: string
  /** 物品类型 */
  item_type?: string
  /** 星级 */
  rank_type?: string
  /** 时间 */
  time?: string
  /** uid */
  uid?: string
}

/** 抽卡记录接口的返回体 */
interface RawGachaPage {
  /** 返回码 */
  retcode?: number
  /** 提示 */
  message?: string
  /** 数据 */
  data?: {
    /** 记录列表 */
    list?: RawGachaItem[]
    /** 区服 */
    region?: string
  } | null
}

/** {@link GachaStore} 的构造参数 */
export interface GachaStoreOptions {
  /** KV 命名空间，建议传 `ctx.kv.sub("gacha")` */
  kv: KvNamespace
  /** HTTP 客户端 */
  http: HttpClient
  /** 日志器 */
  logger: Logger
  /** 取超时设置 */
  timeout?: () => number
  /** 取当前时间，测试用 */
  now?: () => number
  /** 翻页间隔，测试里传 0 */
  gap?: () => number
}

/** 从链接里读出来的东西 */
export interface LinkParse {
  /** 解析成功 */
  ok: boolean
  /** authkey 本体，已 URL 解码 */
  authkey?: string
  /** 链接中携带的 region；部分客户端不携带，此时须进行探测 */
  region?: string
  /** 失败原因，可直接回复给使用者 */
  message?: string
}

/**
 * 从游戏内复制的链接中提取 authkey
 *
 * 三类脏输入都要认（链接经使用者从移动端多次转发）：`〈=`、`&amp;` 与末尾的 `#/log`。
 * 星铁的链接把 `#/` 放在 `?` 之前，故先切第一个 `?`、再切其后的第一个 `#`。
 * @param text 使用者发送的整段文本
 * @returns 解析结果
 */
export function parseGachaLink(text: string): LinkParse {
  const raw = text.replace(/〈=/g, "&").replace(/&amp;/g, "&").trim()
  const at = raw.indexOf("?")
  if (at < 0) {
    return { ok: false, message: "这不是抽卡记录链接，请在游戏「历史记录」页复制链接后重发" }
  }

  const tail = raw.slice(at + 1)
  const cut = tail.indexOf("#")
  const params = new URLSearchParams(cut < 0 ? tail : tail.slice(0, cut))
  const authkey = params.get("authkey")?.trim()
  if (!authkey) return { ok: false, message: "链接不完整，请完整发送整条链接" }

  const region = params.get("region")?.trim()
  const out: LinkParse = { ok: true, authkey }
  if (region) out.region = region
  return out
}

/**
 * 链接未携带 region 时的候选区服，顺序即尝试顺序
 *
 * 国服在前，多数情形首次即命中。三个游戏的写法各不相同，不可归纳为统一模板。
 */
const PROBE_REGIONS: Readonly<Record<GameKey, readonly string[]>> = {
  gs: ["cn_gf01", "cn_qd01", "os_asia", "os_usa", "os_euro", "os_cht"],
  sr: ["prod_gf_cn", "prod_qd_cn", "prod_official_asia", "prod_official_usa", "prod_official_eur", "prod_official_cht"],
  zzz: ["prod_gf_cn", "prod_gf_us", "prod_gf_eu", "prod_gf_jp", "prod_gf_sg"]
}

/** 接口返回非 0 时抛出该异常，命令层依据 retcode 给出可读提示 */
export class GachaApiError extends Error {
  /** 米游社返回码 */
  readonly retcode: number

  /**
   * @param retcode 返回码
   * @param message 接口给的提示
   */
  constructor(retcode: number, message?: string) {
    super(message && message.length ? message : `retcode ${retcode}`)
    this.name = "GachaApiError"
    this.retcode = retcode
  }
}

/** 各 retcode 对应的提示文案，均经实测确认 */
const RETCODE_TEXT: Readonly<Record<string, string>> = {
  "-100": "链接不完整，请重新复制整条链接后发送",
  "-101": "链接已失效，请在游戏内重新打开抽卡记录后复制",
  "-109": "链接不对，请在游戏内「祈愿 - 历史记录」页复制",
  "-110": "请求过于频繁，请一分钟后重试",
  "400": "米游社返回异常，请稍后重试"
}

/**
 * 将抽卡接口的失败转换为一条可直接发送的提示
 * @param err 捕获到的异常
 * @returns 提示文本
 */
export function gachaFailText(err: unknown): string {
  if (err instanceof GachaApiError) {
    return RETCODE_TEXT[String(err.retcode)] ?? `米游社返回 ${err.retcode}：${err.message}`
  }
  return "无法连接抽卡接口，请检查网络或代理后重试"
}

/**
 * 比两条记录 id 的先后
 *
 * id 为雪花号，位数一致时字典序即数值序，不一致时先比长度。用字符串比而非 `Number()`：
 * 该数字串超出 `Number.MAX_SAFE_INTEGER`，转成数字会丢精度，于是判不出"已知的最新记录"，
 * 每次都执行全量翻页。
 * @param a 左
 * @param b 右
 * @returns a 比 b 新时为正
 */
export function compareGachaId(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 原始记录 → 落库形态
 *
 * 星级按接口给的原样存，不在此处折算刻度：绝区零的 `rank_type` 是 2 / 3 / 4，与元数据里
 * 它的 `star` 一致；此处折了会与元数据打架，而已存下来的记录补不回来（记录只增不减）。
 * 归一放在分析那一侧的唯一入口（`views/gacha-stat.ts` 的 `normalizeStar`）。
 * @param raw 接口给的一条
 * @param pool 归并后的卡池键
 * @returns 记录
 */
function toRecord(raw: RawGachaItem, pool: string): GachaRecord {
  return {
    id: String(raw.id ?? ""),
    pool,
    name: raw.name ?? "未知",
    itemType: raw.item_type ?? "",
    rank: Number(raw.rank_type ?? 3) || 3,
    time: raw.time ?? ""
  }
}

/**
 * 等待指定时长
 * @param ms 毫秒，取值为 0 或负数时直接返回
 * @returns 等待完成
 */
async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise<void>(resolve => setTimeout(resolve, ms))
}

/** {@link GachaStore.saveAuth} 的结果 */
export interface GachaAuthResult {
  /** 成功 */
  ok: boolean
  /** 识别出的 uid；该账号无任何记录时为空串（此时链接不落库） */
  uid?: string
  /** 最终采用的 region */
  region?: string
  /** 失败原因 */
  message?: string
}

/** {@link GachaStore.sync} 的结果 */
export interface GachaSyncResult {
  /** 成功 */
  ok: boolean
  /** uid */
  uid?: string
  /** 本次新增的记录条数 */
  added?: number
  /** 本地已存储的记录总条数 */
  total?: number
  /** 逐卡池的新增明细，只列本次确有新增的卡池 */
  pools?: GachaImportPool[]
  /** 失败原因 */
  message?: string
}

/** 导入结果里一个卡池的明细 */
export interface GachaImportPool {
  /** 卡池键 */
  pool: string
  /** 卡池名，直接取自卡池表，命令层不必再查一次 */
  name: string
  /** 本卡池新增条数 */
  added: number
  /** 本卡池合并后的总数 */
  total: number
}

/** {@link GachaStore.importRecords} 的结果 */
export interface GachaImportResult {
  /** 合计新增条数 */
  added: number
  /** 合并后的记录总数 */
  total: number
  /** 逐卡池的明细，只列本次文件里确实带了记录的卡池 */
  pools: GachaImportPool[]
}

/** 一个卡池及其记录 */
export interface PoolRecords {
  /** 卡池定义 */
  spec: GachaPoolSpec
  /** 记录，较新者在前 */
  records: GachaRecord[]
}

/** 抽卡记录存储 */
export class GachaStore {
  /** KV 命名空间 */
  private readonly kv: KvNamespace
  /** HTTP 客户端 */
  private readonly http: HttpClient
  /** 日志器 */
  private readonly logger: Logger
  /** 取超时 */
  private readonly timeout: () => number
  /** 取当前时间 */
  private readonly now: () => number
  /** 取翻页间隔 */
  private readonly gap: () => number

  /**
   * @param opts 构造参数
   */
  constructor(opts: GachaStoreOptions) {
    this.kv = opts.kv
    this.http = opts.http
    this.logger = opts.logger
    this.timeout = opts.timeout ?? ((): number => 20_000)
    this.now = opts.now ?? ((): number => Date.now())
    this.gap = opts.gap ?? ((): number => PAGE_GAP)
  }

  /**
   * authkey 的键
   *
   * 键里带 uid：一个用户名下可绑多个 uid，各自的链接分开存、互不覆盖。只存一份时 `#切换uid`
   * 之后 `#更新抽卡记录` 拿的仍是前一个 uid 那份未过期的链接，更新的始终是前一个 uid。
   * @param id 用户标识
   * @param game 游戏
   * @param uid 游戏 uid；留空即得这个用户这个游戏全部链接的公共前缀
   * @returns KV 键
   */
  private authKey(id: string, game: GameKey, uid: string): string {
    return `auth:${game}:${id}:${uid}`
  }

  /**
   * 不分 uid 的那份 authkey 的键 —— 只为认领（{@link takeLegacy}）与一并删除
   * @param id 用户标识
   * @param game 游戏
   * @returns KV 键
   */
  private legacyAuthKey(id: string, game: GameKey): string {
    return `auth:${game}:${id}`
  }

  /**
   * 一个卡池记录的键
   *
   * 键里带用户标识：抽卡历史按「用户 + uid」分开存，互不可见（见文件头）。
   * @param id 用户标识
   * @param game 游戏
   * @param uid 游戏 uid
   * @param pool 卡池键
   * @returns KV 键
   */
  private logKey(id: string, game: GameKey, uid: string, pool: string): string {
    return `log:${game}:${id}:${uid}:${pool}`
  }

  /**
   * 取一页
   *
   * `auth_appid=webview_gacha` 与 `authkey_ver=1` 缺一即回 -100。两处按游戏分岔：
   * 星铁与绝区零必带 `game_biz`（缺失回 `-111`），原神那条不带；绝区零要同时带展示分类
   * `gacha_type` 与真实类型 `real_gacha_type`，只带后者同样回 `-111`。
   * @param auth authkey 记录
   * @param game 游戏
   * @param type 卡池表里的编号（绝区零为展示分类 `2001` 一类）
   * @param endId 上一页最后一条记录的 id，首页传入 `0`
   * @param index 页码；接口仅用于记录日志，但缺少该参数将返回 -100
   * @returns 接口返回体
   * @throws {GachaApiError} retcode 非 0
   */
  private async fetchPage(auth: AuthRecord, game: GameKey, type: string, endId: string, index: number): Promise<RawGachaPage> {
    const cn = isCnServer(auth.region)
    const res = await this.http.get<RawGachaPage>(gachaLogUrl(game, auth.region), {
      query: {
        authkey_ver: 1,
        sign_type: 2,
        auth_appid: "webview_gacha",
        lang: "zh-cn",
        authkey: auth.authkey,
        region: auth.region,
        gacha_type: type,
        ...(game === "zzz" ? { real_gacha_type: gachaRealType(game, type) } : {}),
        // 原神那条不带 game_biz；星铁与绝区零必带，否则 -111
        ...(game === "gs" ? {} : { game_biz: gameBiz(game, cn) }),
        size: PAGE_SIZE,
        end_id: endId,
        page: index
      },
      timeout: this.timeout(),
      responseType: "json"
    })

    const retcode = Number(res?.retcode ?? 0)
    if (retcode !== 0) throw new GachaApiError(retcode, res?.message)
    return res ?? {}
  }

  /**
   * 以指定 region 尝试一次请求，并从中识别 uid
   *
   * uid 只能从记录里读 —— 接口不单独给。无任何记录同样算成功，uid 留空串。
   * @param authkey authkey
   * @param game 游戏
   * @param region 区服
   * @returns 采用的 region 与 uid
   * @throws {GachaApiError} 接口返回错误
   */
  private async probeOne(authkey: string, game: GameKey, region: string): Promise<{ region: string; uid: string }> {
    const auth: AuthRecord = { authkey, region, uid: "", savedAt: this.now() }
    for (const pool of GACHA_POOLS[game]) {
      const page = await this.fetchPage(auth, game, pool.types[0] ?? pool.key, "0", 1)
      const first = page.data?.list?.[0]
      if (first?.uid) return { region: page.data?.region ?? region, uid: String(first.uid) }
      await sleep(this.gap())
    }
    return { region, uid: "" }
  }

  /**
   * 定出这条链接该用哪个 region
   *
   * 链接自带 region 时直接采用，不逐个尝试 —— 那会无谓发出六次请求且易触发限流。
   * 只在未携带时按 {@link PROBE_REGIONS} 顺序探测，全部失败才抛最后一个错误。
   * @param authkey authkey
   * @param game 游戏
   * @param region 链接里带的 region
   * @returns 采用的 region 与 uid
   * @throws {GachaApiError} 全部候选都失败
   */
  private async probe(authkey: string, game: GameKey, region?: string): Promise<{ region: string; uid: string }> {
    if (region) return await this.probeOne(authkey, game, region)

    let last: unknown = new GachaApiError(-101)
    for (const it of PROBE_REGIONS[game]) {
      try {
        return await this.probeOne(authkey, game, it)
      } catch (err) {
        last = err
        this.logger.debug(`[抽卡] region ${it} 不可用，改用下一候选`)
      }
    }
    throw last
  }

  /**
   * 收下一条抽卡链接
   *
   * 存入之前先实际发起一次请求，在此处拦下链接过期、复制错行与 region 判错三种情形 ——
   * 否则要等到下一次 `#抽卡记录` 才报错，使用者会误认为记录已损坏。
   * @param id 用户标识
   * @param game 游戏
   * @param link 用户发来的整段文本
   * @returns 保存结果
   */
  async saveAuth(id: string, game: GameKey, link: string): Promise<GachaAuthResult> {
    const parsed = parseGachaLink(link)
    if (!parsed.ok || !parsed.authkey) return { ok: false, message: parsed.message ?? "链接解析失败" }

    try {
      const found = await this.probe(parsed.authkey, game, parsed.region)
      // 账号一条记录都没有时认不出 uid，也就无从按 uid 存；那时本也无可同步，故不收
      if (found.uid) {
        const record: AuthRecord = {
          authkey: parsed.authkey,
          region: found.region,
          uid: found.uid,
          savedAt: this.now()
        }
        await this.kv.set(this.authKey(id, game, found.uid), record)
      }
      return { ok: true, uid: found.uid, region: found.region }
    } catch (err) {
      return { ok: false, message: gachaFailText(err) }
    }
  }

  /**
   * 直接收下一份已换好的 authkey（自助取链接用）
   *
   * 与 {@link saveAuth} 分开：这一条的 region 与 uid 在换取时已经知道，不必再探测。
   * 落库后由 {@link sync} 校验其可用并拉取记录。
   * @param id 用户标识
   * @param game 游戏
   * @param authkey 已换好的 authkey
   * @param region 该 authkey 对应的区服
   * @param uid 游戏 uid
   * @returns 落库完成
   */
  async saveAuthKey(id: string, game: GameKey, authkey: string, region: string, uid: string): Promise<void> {
    const record: AuthRecord = { authkey, region, uid, savedAt: this.now() }
    await this.kv.set(this.authKey(id, game, uid), record)
  }

  /**
   * 取某个 uid 还能用的 authkey
   *
   * 已过期者直接删除后返回 undefined：它是凭据，留着既无作用又构成风险。
   * @param id 用户标识
   * @param game 游戏
   * @param uid 游戏 uid
   * @returns authkey 记录；没有或已过期时 undefined
   */
  async auth(id: string, game: GameKey, uid: string): Promise<AuthRecord | undefined> {
    const key = this.authKey(id, game, uid)
    const value = (await this.kv.get<AuthRecord>(key)) ?? (await this.takeLegacy(id, game, uid))
    if (!value || typeof value.authkey !== "string" || !value.authkey) return undefined
    if (this.now() - Number(value.savedAt ?? 0) > AUTH_MAX_AGE) {
      await this.kv.del(key)
      return undefined
    }
    return value
  }

  /**
   * 认领不分 uid 的那份 authkey
   *
   * 它正是这个 uid 的就挪到按 uid 分的键下；属于别的 uid 时原样留着，等切回那个 uid 时再认领。
   * @param id 用户标识
   * @param game 游戏
   * @param uid 游戏 uid
   * @returns 认领到的记录；没有或不属于这个 uid 时 undefined
   */
  private async takeLegacy(id: string, game: GameKey, uid: string): Promise<AuthRecord | undefined> {
    const key = this.legacyAuthKey(id, game)
    const value = await this.kv.get<AuthRecord>(key)
    if (!value || value.uid !== uid) return undefined
    await this.kv.set(this.authKey(id, game, uid), value)
    await this.kv.del(key)
    return value
  }

  /**
   * 主动丢掉 authkey
   *
   * 丢的是名下这个游戏**全部 uid** 的链接（连同不分 uid 的那份）：使用者说「删链接」要的是不再留凭据，
   * 而不是只删当前 uid 那一条、别的还留着。
   * @param id 用户标识
   * @param game 游戏
   * @returns 删除完成
   */
  async dropAuth(id: string, game: GameKey): Promise<void> {
    await this.kv.clear(this.authKey(id, game, ""))
    await this.kv.del(this.legacyAuthKey(id, game))
  }

  /**
   * 翻一个 `gacha_type` 的新记录
   *
   * 分页按 `end_id` 向前推进（`page` 只供服务端记日志），到已知最新那一条为止 ——
   * 这就是"记录只增不减"的做法，一次 `#抽卡记录` 通常只发一两个请求。
   * @param auth authkey 记录
   * @param game 游戏
   * @param pool 归并后的卡池键
   * @param type `gacha_type`
   * @param known 本地已知最新的记录 id，空串表示首次拉取
   * @returns 新记录，接口顺序（新的在前）
   * @throws {GachaApiError} 接口报错
   */
  private async fetchType(auth: AuthRecord, game: GameKey, pool: string, type: string, known: string): Promise<GachaRecord[]> {
    const out: GachaRecord[] = []
    let endId = "0"

    for (let index = 1; index <= MAX_PAGES; index++) {
      const page = await this.fetchPage(auth, game, type, endId, index)
      const list = page.data?.list ?? []
      if (!list.length) break

      let reached = false
      for (const it of list) {
        const id = String(it.id ?? "")
        if (!id) continue
        if (known && compareGachaId(id, known) <= 0) {
          reached = true
          break
        }
        out.push(toRecord(it, pool))
      }

      endId = String(list[list.length - 1]?.id ?? "")
      if (reached || list.length < PAGE_SIZE || !endId) break
      await sleep(this.gap())
    }

    return out
  }

  /**
   * 翻一个卡池的新记录（可能对应多个 `gacha_type`）
   * @param auth authkey 记录
   * @param game 游戏
   * @param pool 卡池定义
   * @param known 本地已知最新的记录 id
   * @returns 新记录
   * @throws {GachaApiError} 接口报错
   */
  private async fetchPool(auth: AuthRecord, game: GameKey, pool: GachaPoolSpec, known: string): Promise<GachaRecord[]> {
    const out: GachaRecord[] = []
    for (const type of pool.types) {
      out.push(...(await this.fetchType(auth, game, pool.key, type, known)))
      await sleep(this.gap())
    }
    return out
  }

  /**
   * 合并新旧记录
   *
   * 按 id 去重而非"时间 + 物品名"：十连抽那十条的时间戳完全一致，按后者去重会并成一条。
   * @param stored 本地已有的记录
   * @param fresh 本次拉取到的记录
   * @returns 合并后的记录，新的在前
   */
  private merge(stored: GachaRecord[], fresh: GachaRecord[]): GachaRecord[] {
    const seen = new Map<string, GachaRecord>()
    for (const it of [...fresh, ...stored]) {
      if (it.id && !seen.has(it.id)) seen.set(it.id, it)
    }
    return [...seen.values()].sort((a, b) => compareGachaId(b.id, a.id))
  }

  /**
   * 读一个卡池的本地记录
   * @param id 用户标识
   * @param game 游戏
   * @param uid 游戏 uid
   * @param pool 卡池键
   * @returns 记录，新的在前
   */
  async records(id: string, game: GameKey, uid: string, pool: string): Promise<GachaRecord[]> {
    const value = await this.kv.get<GachaRecord[]>(this.logKey(id, game, uid, pool))
    return Array.isArray(value) ? value : []
  }

  /**
   * 把外部记录并进本地库
   *
   * 供 UIGF 导入使用，与 {@link sync} 共用 {@link merge}，故"先导入朋友给的文件、再自己同步
   * 一次"不会重复。只增不减：导入的可能是一份半年前的备份，以其为准会抹掉此后的全部记录。
   * @param id 用户标识
   * @param game 游戏
   * @param uid 游戏 uid
   * @param records 外部记录，顺序不限
   * @returns 合计新增与总数，另附逐卡池的明细
   */
  async importRecords(id: string, game: GameKey, uid: string, records: readonly GachaRecord[]): Promise<GachaImportResult> {
    // 先按卡池分组，使每个卡池只写一次 KV
    const grouped = new Map<string, GachaRecord[]>()
    for (const it of records) {
      if (!it.id || !it.pool) continue
      const list = grouped.get(it.pool) ?? []
      list.push(it)
      grouped.set(it.pool, list)
    }

    let added = 0
    let total = 0
    const pools: GachaImportPool[] = []
    for (const spec of GACHA_POOLS[game]) {
      const stored = await this.records(id, game, uid, spec.key)
      const fresh = grouped.get(spec.key) ?? []
      const merged = fresh.length ? this.merge(stored, fresh) : stored
      if (fresh.length && merged.length !== stored.length) {
        await this.kv.set(this.logKey(id, game, uid, spec.key), merged)
      }
      added += merged.length - stored.length
      total += merged.length
      // 本次文件里没有该卡池的记录时不列出来 —— 一份只含角色池的文件，
      // 列上四行「新增 0 条」只会淹掉真正导进去的那一行
      if (fresh.length) {
        pools.push({ pool: spec.key, name: spec.name, added: merged.length - stored.length, total: merged.length })
      }
    }

    this.logger.info(`[抽卡] ${uid} 导入完成，新增 ${added} 条，本地共 ${total} 条`)
    return { added, total, pools }
  }

  /**
   * 读一个 uid 的全部卡池
   *
   * 无记录的卡池同样在结果里（`records: []`），故视图层能印出"该卡池未参与抽取"而不是整块缺失。
   * @param id 用户标识
   * @param game 游戏
   * @param uid 游戏 uid
   * @returns 各卡池的记录，顺序同 {@link GACHA_POOLS}
   */
  async pools(id: string, game: GameKey, uid: string): Promise<PoolRecords[]> {
    const out: PoolRecords[] = []
    for (const spec of GACHA_POOLS[game]) {
      out.push({ spec, records: await this.records(id, game, uid, spec.key) })
    }
    return out
  }

  /**
   * 拉某个 uid 的一次增量并落库
   * @param id 用户标识
   * @param game 游戏
   * @param uid 游戏 uid，用的是它自己那份 authkey
   * @returns 同步结果
   */
  async sync(id: string, game: GameKey, uid: string): Promise<GachaSyncResult> {
    const auth = await this.auth(id, game, uid)
    if (!auth) return { ok: false, message: `${uid} 没有可用的抽卡链接，请私聊发送「#抽卡链接」提交新链接` }

    try {
      let added = 0
      let total = 0
      const pools: GachaImportPool[] = []
      for (const pool of GACHA_POOLS[game]) {
        const stored = await this.records(id, game, uid, pool.key)
        const fresh = await this.fetchPool(auth, game, pool, stored[0]?.id ?? "")
        const merged = fresh.length ? this.merge(stored, fresh) : stored
        if (fresh.length) await this.kv.set(this.logKey(id, game, uid, pool.key), merged)
        const poolAdded = merged.length - stored.length
        added += poolAdded
        total += merged.length
        // 只记确有新增的卡池，供命令层报"哪个卡池、新增多少"
        if (poolAdded > 0) pools.push({ pool: pool.key, name: pool.name, added: poolAdded, total: merged.length })
        await sleep(this.gap())
      }

      this.logger.info(`[抽卡] ${uid} 同步完成，新增 ${added} 条，本地共 ${total} 条`)
      return { ok: true, uid, added, total, pools }
    } catch (err) {
      return { ok: false, message: gachaFailText(err) }
    }
  }
}

