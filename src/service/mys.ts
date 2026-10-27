/**
 * 模块职责：查询服务 —— 把"用户 → uid → 可用 CK → 米游社接口 → 结果"这条链串起来
 * 依赖方向：依赖本插件的 client / ck / user / region；对内核只用到日志契约
 * 生命周期：随插件 setup 创建一个实例，无状态（状态都在它依赖的三个存储里）
 * 注意事项：命令层只接触本层。「取 uid → 取 CK → 判 retcode → 决定是否停用该条 CK」
 *          只在此处写一遍，命令不得自行重复。
 *
 *          `-100`（CK 确已失效）时自动换一条 CK 重试；失效那条同时被停用，故不会成环。
 *
 *          风控（`1034`）既不换 CK 也不停用 —— 换 CK 只会把同一台设备的风控扩散到第二个账号。
 *          指纹重试已在 client.ts 做过一次，本层至多再走一遍过码（见 {@link MysService.passCaptcha}）。
 */
import type { Logger } from "@yunzai-ng/types"
import type { ApiData } from "../core/api.js"
import type { CaptchaService } from "../core/captcha.js"
import { currentCaptchaNotice } from "../core/captcha.js"
import type { CookiePool, CookieRecord } from "../store/ck.js"
import type { MysClient, MysFailKind } from "../core/client.js"
import { hasIllegalChar, hasLoginToken, normalizeCookie, pickLtuid } from "../core/cookie.js"
import { maskLtuid as maskId } from "../core/text.js"
import { traceNote } from "../core/trace.js"
import type { GameKey } from "../core/region.js"
import { GAME_KEYS, isValidUid } from "../core/region.js"
import type { UserStore } from "../store/user.js"

/** 更换 CK 重试的次数上限 —— 超出该值只会把本人名下覆盖该 uid 的 CK 逐条耗尽 */
const MAX_CK_TRIES = 3

/** 查询失败的原因，除接口层的归类外另有两种"请求尚未发出"的情形 */
export type QueryFailKind =
  | MysFailKind
  /** 未绑定 uid，且命令中未给出 uid */
  | "nouid"
  /** 无可用的 CK（没有覆盖该 uid 的、全部已停用或今日均已到顶） */
  | "nock"

/** 查询成功 */
export interface QueryOk<T> {
  /** 成功标记 */
  ok: true
  /** 接口名 */
  api: string
  /** 实际查询的 uid */
  uid: string
  /** 实际使用的米游社账号 */
  ltuid: string
  /** 接口数据 */
  data: T
  /** 是否来自响应缓存 */
  cached: boolean
}

/** 查询失败 */
export interface QueryFail {
  /** 失败标记 */
  ok: false
  /** 接口名 */
  api: string
  /** 查询的 uid，尚未取得时为 undefined */
  uid?: string
  /** 使用的账号，尚未选定时为 undefined */
  ltuid?: string
  /** 米游社 retcode，请求未发出时为 0 */
  retcode: number
  /** 可直接展示的提示 */
  message: string
  /** 失败归类 */
  kind: QueryFailKind
}

/** 查询结果 */
export type QueryResult<T> = QueryOk<T> | QueryFail

/** 一次查询的参数 */
export interface QueryOptions {
  /**
   * 发起查询的用户标识，必填
   *
   * 既用于未给 uid 时取其绑定的 uid，也是选 CK 的归属闸：只会用该用户本人绑定、且覆盖被查
   * uid 的 CK（见 {@link CookiePool.pick}）。后台任务同样必须带上（`state.user`）。
   */
  user: string
  /** 指定 uid；未给出时采用该使用者当前绑定的 uid */
  uid?: string | number
  /** 游戏，缺省为原神 */
  game?: GameKey
  /** 接口参数 */
  data?: ApiData
  /**
   * 额外请求头，会覆盖同名默认值
   *
   * 尘歌壶模数要它：那个接口只认从计算器活动页发来的请求，故要为它单独指定 Referer。
   */
  headers?: Record<string, string>
}

/**
 * 角色列表里一个 uid 的账号信息
 *
 * 绑 CK 时顺带取回，供调用方落进面板库 —— 这是**绝区零唯一的昵称与等级来源**：
 * 另两个游戏的展柜源会给，而绝区零两个面板源都不给，不落它则 `#uid` 那张图上恒印「暂无 uid 信息」。
 */
export interface BindRole {
  /** 游戏 uid */
  uid: string
  /** 游戏内昵称 */
  name?: string
  /** 冒险等阶 / 开拓等级 / 代理人等级 */
  level?: number
}

/** 绑定 CK 的结果 */
export interface BindResult {
  /** 是否成功 */
  ok: boolean
  /** 米游社账号标识 */
  ltuid?: string
  /** 取得的 uid 表 */
  uids?: Partial<Record<GameKey, string[]>>
  /** 逐 uid 的昵称与等级，见 {@link BindRole} */
  roles?: Partial<Record<GameKey, BindRole[]>>
  /** 失败提示 */
  message?: string
}

/** 米游社角色绑定记录（`bindings` 接口返回的一项） */
interface RoleItem {
  /** 游戏标识，形如 `hk4e_cn` */
  game_biz?: string
  /** 区服 */
  region?: string
  /** 游戏 uid */
  game_uid?: string
  /** 游戏昵称 */
  nickname?: string
  /** 等级 */
  level?: number
}

/** `game_biz` 前缀 → 游戏键 */
const BIZ_GAME: Readonly<Record<string, GameKey>> = { hk4e: "gs", hkrpg: "sr", nap: "zzz" }

/**
 * 探区服用的占位 uid
 *
 * `bindings` 的 query 不含 uid，它只用来让接口表选出国服或国际服的域名。绝区零另列一套：
 * 它的国际服 uid 是 10 位，用原神那个 9 位数字探会被判成国服，于是国际服绝区零永远探不到。
 */
const PROBE_UID: Readonly<Record<GameKey, { cn: string; os: string }>> = {
  gs: { cn: "100000001", os: "600000001" },
  sr: { cn: "100000001", os: "600000001" },
  zzz: { cn: "10000001", os: "1000000001" }
}

/** 查询服务的构造参数 */
export interface MysServiceOptions {
  /** 请求客户端 */
  client: MysClient
  /** Cookie 池 */
  cookies: CookiePool
  /** 用户档案 */
  users: UserStore
  /** 日志器 */
  logger: Logger
  /**
   * 图形验证的过码服务，不传即不过码
   *
   * 不传与"传了但没配地址"是同一条路径：风控原样返回给使用者。
   */
  captcha?: CaptchaService
}

/** 绑定 Cookie 时的附带信息 */
export interface BindOptions {
  /** 绑定者的用户标识，必填 —— 落库后即该 CK 的归属 */
  user: string
}

/** 查询服务 */
export class MysService {
  /** 请求客户端 */
  private readonly client: MysClient
  /** Cookie 池 */
  private readonly cookies: CookiePool
  /** 用户档案 */
  private readonly users: UserStore
  /** 日志器 */
  private readonly logger: Logger
  /** 过码服务，未接入时为空 */
  private readonly captcha?: CaptchaService

  /**
   * @param opts 构造参数
   */
  constructor(opts: MysServiceOptions) {
    this.client = opts.client
    this.cookies = opts.cookies
    this.users = opts.users
    this.logger = opts.logger
    if (opts.captcha) this.captcha = opts.captcha
  }

  /**
   * 确定本次查询的对象
   * @param opts 查询参数
   * @returns uid；命令中未给出且该使用者未绑定时为 undefined
   */
  async resolveUid(opts: QueryOptions): Promise<string | undefined> {
    if (opts.uid !== undefined) {
      const value = String(opts.uid)
      return isValidUid(value) ? value : undefined
    }
    if (!opts.user) return undefined
    return await this.users.uid(opts.user, opts.game ?? "gs")
  }

  /**
   * 查询一个接口
   *
   * CK 失效或米游社判该 CK 今日到顶时自动更换下一条重试（最多 {@link MAX_CK_TRIES} 条）；风控、
   * 数据未公开、uid 不存在则立即返回 —— 更换 CK 对上述情形并无帮助，只会把本人其余 CK 也送去撞。
   * @param type 接口名，如 `dailyNote`
   * @param opts 查询参数
   * @returns 结果对象，不抛错
   */
  async query<T = unknown>(type: string, opts: QueryOptions): Promise<QueryResult<T>> {
    const game = opts.game ?? "gs"
    const uid = await this.resolveUid(opts)
    if (!uid) {
      return { ok: false, api: type, retcode: 0, message: "尚未绑定 uid，请发送「#绑定uid100000001」", kind: "nouid" }
    }

    const tried: string[] = []
    let last: QueryFail | undefined

    for (let round = 0; round < MAX_CK_TRIES; round += 1) {
      const pickOpts = { uid, game, owner: opts.user, exclude: tried }
      const record = await this.cookies.pick(pickOpts)
      if (!record) {
        if (last) return last
        // 没有覆盖该 uid 的自有 CK、今日到顶、全被停用三者该说的话完全不同，故问一次 explain；
        // 一律说「请先绑定 CK」会让到顶的人去重绑一遍，而绑完照旧不行
        const why = await this.cookies.explain(pickOpts)
        traceNote(`${type} 无可用 CK：${why.message}`)
        this.logger.debug(`[米游社][${type}][${uid}] 没有可用 CK（已试 ${tried.length} 条）：${why.message}`)
        return {
          ok: false,
          api: type,
          uid,
          retcode: 0,
          message: tried.length ? "ck 都已尝试，请稍后再试" : why.message,
          kind: "nock"
        }
      }
      tried.push(record.ltuid)
      traceNote(`${type} 用 CK ${maskId(record.ltuid)}`)

      const res = await this.request<T>(type, uid, game, record, opts.data, opts.headers)
      if (res.ok) return res
      last = res
      // 仅以下两种情形更换 CK 有意义：该条已失效，或米游社判它今日到顶
      if (res.kind !== "cookie" && res.kind !== "limit") return res
      this.logger.debug(`[米游社][${type}][${uid}] CK ${maskId(record.ltuid)} ${res.kind === "cookie" ? "已失效" : "今日已到顶"}，换下一条`)
    }
    return last as QueryFail
  }

  /**
   * 以指定的一条 CK 发送一次请求，风控且配了过码服务时过一遍码再重发
   *
   * 过码只做一次：第二次仍然风控说明并非验证码所致（多为该设备本身已被限制），
   * 再走一遍只是让使用者多等两分钟。
   * @param type 接口名
   * @param uid 游戏 uid
   * @param game 游戏
   * @param record CK 记录
   * @param data 接口参数
   * @param headers 额外请求头
   * @returns 结果对象
   */
  private async request<T>(
    type: string,
    uid: string,
    game: GameKey,
    record: CookieRecord,
    data?: ApiData,
    headers?: Record<string, string>
  ): Promise<QueryResult<T>> {
    const first = await this.send<T>(type, uid, game, record, data, headers)
    if (first.ok || first.kind !== "risk" || !this.captcha?.enabled) return first
    if (!(await this.passCaptcha(uid, game, record))) return first
    // 星铁的 `x-rpc-challenge_game` 在整条验证流程里都要带着，重发那次也加上
    const retry = game === "sr" ? { ...(headers ?? {}), "x-rpc-challenge_game": "6" } : headers
    return await this.send<T>(type, uid, game, record, data, retry)
  }

  /**
   * 走一遍图形验证
   *
   * 三步：取验证串、把串交给过码服务等它回传 validate、把 validate 报回米游社。
   * 只有第一步与第三步带 CK，交给外部服务的仅 uid 与两个公开验证串。
   * @param uid 游戏 uid
   * @param game 游戏
   * @param record CK 记录
   * @returns 是否已通过验证
   */
  private async passCaptcha(uid: string, game: GameKey, record: CookieRecord): Promise<boolean> {
    const extra: Record<string, string> = game === "sr" ? { "x-rpc-challenge_game": "6" } : {}
    const created = await this.client.request<{ gt?: string; challenge?: string }>("createVerification", {
      uid,
      game,
      cookie: record.cookie,
      ltuid: record.ltuid,
      headers: extra
    })
    if (!created.ok) {
      this.logger.warn(`[米游社][过码] 取验证串失败：${created.message}`)
      return false
    }
    const gt = created.data?.gt
    const challenge = created.data?.challenge
    if (!gt || !challenge) {
      this.logger.warn("[米游社][过码] 米游社没有下发 gt / challenge")
      return false
    }

    const notice = currentCaptchaNotice()
    const validate = await this.captcha?.solve({
      uid,
      gt,
      challenge,
      ...(notice ? { notify: notice } : {})
    })
    if (!validate) return false

    const submitted = await this.client.request("verifyVerification", {
      uid,
      game,
      cookie: record.cookie,
      ltuid: record.ltuid,
      data: { body: validate },
      headers: extra
    })
    if (!submitted.ok) {
      this.logger.warn(`[米游社][过码] 回报校验结果失败：${submitted.message}`)
      return false
    }
    this.logger.mark(`[米游社][过码] uid ${uid} 已通过图形验证，重发原请求`)
    return true
  }

  /**
   * 以指定的一条 CK 发送一次请求，并将结果回报至池
   *
   * 只在"请求确已到达米游社"时计数：`unsupported` 没发出去、`http` 是本地网络问题，
   * 记进去会让 `#用户统计` 的次数虚高。
   * @param type 接口名
   * @param uid 游戏 uid
   * @param game 游戏
   * @param record CK 记录
   * @param data 接口参数
   * @param headers 额外请求头
   * @returns 结果对象
   */
  private async send<T>(
    type: string,
    uid: string,
    game: GameKey,
    record: CookieRecord,
    data?: ApiData,
    headers?: Record<string, string>
  ): Promise<QueryResult<T>> {
    const res = await this.client.request<T>(type, {
      uid,
      game,
      cookie: record.cookie,
      ltuid: record.ltuid,
      ...(data ? { data } : {}),
      ...(headers ? { headers } : {})
    })

    if (res.ok) {
      if (!res.cached) await this.cookies.use(record.ltuid)
      return { ok: true, api: type, uid, ltuid: record.ltuid, data: res.data, cached: res.cached }
    }

    if (res.kind !== "unsupported" && res.kind !== "http") await this.cookies.use(record.ltuid)
    await this.cookies.report(record.ltuid, res.kind, res.message)
    return { ok: false, api: type, uid, ltuid: record.ltuid, retcode: res.retcode, message: res.message, kind: res.kind }
  }

  /**
   * 向米游社查询该账号名下的角色列表
   *
   * 探区服用的 uid 是占位常量（见 {@link PROBE_UID}）：`bindings` 的 query 不含 uid，
   * 它只用来让接口表选出国服或国际服的域名。
   * @param cookie Cookie 文本
   * @param game 游戏
   * @param cn 是否国服
   * @returns 角色列表；失败时给出失败原因
   */
  private async roles(
    cookie: string,
    game: GameKey,
    cn: boolean
  ): Promise<{ list: RoleItem[] } | { fail: QueryFailKind; message: string }> {
    const res = await this.client.request<{ list?: RoleItem[] }>("bindings", {
      uid: cn ? PROBE_UID[game].cn : PROBE_UID[game].os,
      game,
      cookie
    })
    if (!res.ok) return { fail: res.kind, message: res.message }
    return { list: res.data?.list ?? [] }
  }

  /**
   * 绑定一份 Cookie
   *
   * 先查一次角色列表：这一步既验证 Cookie 有效，又顺带取到 uid，此后"该 uid 用哪条 CK"
   * 即可精确命中。国服探到角色后不再探国际服 —— 一个米游社账号不会同时属于两侧。
   * @param raw 使用者粘贴的 Cookie 文本
   * @param opts 附带信息
   * @returns 绑定结果，`message` 可直接回复给使用者
   */
  async bind(raw: string, opts: BindOptions): Promise<BindResult> {
    const cookie = normalizeCookie(raw)
    const ltuid = pickLtuid(cookie)
    if (!cookie || !ltuid) return { ok: false, message: "ck 不完整，缺少 ltuid，请重新复制完整内容" }
    // 请求头只接受 latin1，故先判一次：不判的话报错来自请求层，使用者无从知道该怎么办
    if (hasIllegalChar(cookie)) {
      return {
        ok: false,
        message: "ck 含非法字符，请用电脑浏览器重新取一份"
      }
    }
    if (!hasLoginToken(cookie)) return { ok: false, message: "ck 缺少 ltoken / cookie_token，请重新复制完整内容" }

    const uids: Partial<Record<GameKey, string[]>> = {}
    // 昵称与等级一并收下：绝区零两个面板源都不给这两项，此处是它唯一的来源（见 BindRole）
    const roles: Partial<Record<GameKey, BindRole[]>> = {}
    let cn: boolean | undefined
    let failure: string | undefined

    for (const game of GAME_KEYS) {
      for (const region of cn === undefined ? [true, false] : [cn]) {
        const out = await this.roles(cookie, game, region)
        if ("fail" in out) {
          failure = out.message
          // Cookie 本身无效，继续探测其他游戏只会重复得到同一错误
          if (out.fail === "cookie") return { ok: false, message: out.message }
          continue
        }
        if (!out.list.length) continue
        cn = region
        for (const item of out.list) {
          const key = BIZ_GAME[item.game_biz?.split("_")[0] ?? ""] ?? game
          const uid = item.game_uid
          if (!uid || !isValidUid(uid)) continue
          uids[key] = [...new Set([...(uids[key] ?? []), uid])]
          const level = Number(item.level) || 0
          roles[key] = [
            ...(roles[key] ?? []),
            { uid, ...(item.nickname ? { name: item.nickname } : {}), ...(level > 0 ? { level } : {}) }
          ]
        }
        break
      }
    }

    if (!Object.keys(uids).length) {
      return { ok: false, message: failure ?? "该账号名下未查询到任何角色" }
    }
    return await this.store(cookie, ltuid, uids, roles, opts)
  }

  /**
   * 将验证通过的 Cookie 落地
   *
   * 顺带给绑定者绑上该账号名下的全部 uid，省掉再发一次 `#绑定uid`；已绑的不会重复，只是提到队首。
   * @param cookie 规范化后的 Cookie
   * @param ltuid 账号标识
   * @param uids 探到的 uid 表
   * @param roles 逐 uid 的昵称与等级，原样带回给调用方
   * @param opts 附带信息
   * @returns 绑定结果
   */
  private async store(
    cookie: string,
    ltuid: string,
    uids: Partial<Record<GameKey, string[]>>,
    roles: Partial<Record<GameKey, BindRole[]>>,
    opts: BindOptions
  ): Promise<BindResult> {
    const saved = await this.cookies.save(cookie, { uids, owner: opts.user })
    if (!saved) return { ok: false, message: "Cookie 保存失败，请重试" }

    // 「名下有哪些米游社账号」由 CookieRecord.owner 唯一记载，此处只顺手绑上 uid；
    // 倒序逐个提到队首，绑完首项即当前 uid。只绑首项的话同账号的第二个号不进 #uid 列表，也就切不过去
    for (const game of GAME_KEYS) {
      for (const uid of [...(uids[game] ?? [])].reverse()) await this.users.addUid(opts.user, game, uid)
    }
    this.logger.info(`Cookie 绑定完成，名下 uid：${JSON.stringify(uids)}`)
    return { ok: true, ltuid, uids, roles }
  }

  /**
   * 删除一份 Cookie（连同设备痕迹）
   *
   * 归属随记录一并消失（`owner` 存在记录上），故不必另解一次关系。绑定的游戏 uid 刻意保留：
   * 删 CK 与删 uid 是两件事，面板、抽卡等公开查询仍要用它。
   * @param ltuid 账号标识
   * @returns 原本存在时为真
   */
  async unbind(ltuid: string): Promise<boolean> {
    return await this.cookies.remove(ltuid)
  }
}







