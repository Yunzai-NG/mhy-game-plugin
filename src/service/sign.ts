/**
 * 模块职责：米游社签到 —— 逐账号、逐游戏、逐角色地签一次，并把结果整理成可直接展示的清单
 * 依赖方向：依赖内核的 HttpClient / Logger 与本插件的 device / ds / sign-api；不认识命令层
 * 生命周期：随插件 setup 创建一个实例，无状态（开关与流水在 store/sign.ts 里）
 * 注意事项：这是本插件唯一会代替使用者向米游社写入的功能，四条硬约束不得破坏：
 *
 *          1. 缺省关闭、逐账号可开（见 store/sign.ts），不会因为"绑了 CK"而生效。
 *          2. 不重试到触发风控：签到失败只签一次就走 —— 在已出验证码的账号上再敲一次，
 *             正是把风控从"这一次"变成"这个账号"。
 *          3. 请求之间留间隔（{@link SignService} 的 `gap`）：连着打米游社会直接吃验证码。
 *          4. 日志与返回值里都不出现 Cookie 的任何部分，只出现 `ltuid` 与游戏 uid。
 *
 *          验证码不自动过：遇到 `gt` / `challenge` 时只报告，让使用者自己去米游社点一次。
 */
import type { HttpClient, Logger } from "@yunzai-ng/types"
import type { DeviceStore } from "../core/device.js"
import { SALT_K2, SALT_X6, signDs, signDs1 } from "../core/ds.js"
import type { SignBoard, SignGame, SignSpec } from "../core/sign-api.js"
import {
  awardsSpec,
  bbsMissionsSpec,
  bbsSignSpec,
  infoSpec,
  rolesSpec,
  signBoard,
  SIGN_BOARDS,
  signSpec
} from "../core/sign-api.js"
import { INDENT } from "../core/text.js"

/** 米游社 App 版本号，签到请求头里的那个 */
const APP_VERSION = "2.70.1"

/** 各步之间的间隔 */
const GAPS = { roles: 3000, info: 500, sign: 2000 } as const

/** 每个角色签完之后的随机间隔下限与浮动范围 —— 定长间隔本身就是一种可识别的特征 */
const ROLE_GAP = { base: 4000, range: 5000 } as const

/** 一次签到的结果分类 */
export type SignStatus =
  /** 刚签成 */
  | "signed"
  /** 今天已经签过了 */
  | "already"
  /** 撞上验证码，需要人去米游社点一次 */
  | "captcha"
  /** 这个账号名下没有该游戏的角色 */
  | "norole"
  /** Cookie 已失效 */
  | "cookie"
  /** 其他失败 */
  | "fail"

/** 一个角色的签到结果 */
export interface SignItem {
  /** 游戏 */
  game: SignGame
  /** 游戏展示名 */
  name: string
  /** 游戏 uid */
  uid: string
  /** 游戏昵称 */
  nickname: string
  /** 结果分类 */
  status: SignStatus
  /** 一句可直接展示的说明 */
  message: string
  /** 累计签到天数 */
  total?: number
  /** 今天领到的奖励，形如 `原石*60` */
  award?: string
}

/** 一个米游社账号的签到报告 */
export interface SignReport {
  /** 米游社账号标识 */
  ltuid: string
  /** 逐角色的结果 */
  items: SignItem[]
  /**
   * 这条 Cookie 是否已失效
   *
   * 单列一栏而不让调用方去翻 `items`：调用方要据它停用那条 CK，那是有副作用的动作。
   */
  dead: boolean
}

/** 签到服务的构造参数 */
export interface SignServiceOptions {
  /** HTTP 客户端，取 `ctx.http` */
  http: HttpClient
  /** 日志器 */
  logger: Logger
  /** 设备存储 —— 签到与查询用同一台设备，设备漂移是米游社的重点风控特征 */
  devices: DeviceStore
  /** 取一次间隔的毫秒数，测试里传 `() => 0`（真实间隔有好几档，测试不能真的等十几秒） */
  gap?: (ms: number) => number
}

/** 米游社返回的信封 */
interface Envelope<T> {
  /** 业务返回码 */
  retcode?: number
  /** 提示 */
  message?: string
  /** 数据 */
  data?: T
}

/** 角色列表里的一条 */
interface RoleRaw {
  /** 区服标识 */
  region?: string
  /** 游戏 uid */
  game_uid?: string
  /** 游戏昵称 */
  nickname?: string
}

/** `info` 接口的返回 */
interface InfoRaw {
  /** 今天签没签 */
  is_sign?: boolean
  /** 累计签到天数 */
  total_sign_day?: number
}

/** `sign` 接口的返回 —— 带 `gt` 就是撞上验证码了 */
interface SignRaw {
  /** 极验的 gt */
  gt?: string
  /** 极验的 challenge */
  challenge?: string
  /** 部分版本用这一栏表示需要验证 */
  risk_code?: number
}

/** `home` 接口的返回 */
interface AwardsRaw {
  /** 本月逐日的奖励 */
  awards?: { name?: string; cnt?: number }[]
}

/** 社区任务状态的返回 */
interface MissionsRaw {
  /** 当前米游币 */
  total_points?: number
  /** 今日还能获得多少 */
  can_get_points?: number
}

/** 米游币查询的结果 */
export interface CoinResult {
  /** 是否查到了 */
  ok: boolean
  /** 登录态是否已失效 */
  dead: boolean
  /** 当前米游币 */
  points?: number
  /** 今日还能获得 */
  canGet?: number
  /** 失败时的说明 */
  message?: string
}

/** 一个社区版块的签到结果分类 */
export type BbsStatus = "signed" | "already" | "captcha" | "fail"

/** 社区签到的报告 */
export interface BbsReport {
  /** 米游社账号标识 */
  ltuid: string
  /** 逐版块的结果 */
  items: { name: string; status: BbsStatus; message: string }[]
  /** stoken 是否已失效 */
  dead: boolean
  /** 当前米游币 */
  points?: number
  /** 今日还能获得 */
  canGet?: number
  /** 整体性的一句说明（今日已满、登录失效等） */
  message?: string
}

/** Cookie 已失效的 retcode，与 core/client.ts 的判据一致：`10001` 也是签错的表现，不算 */
const DEAD_CODES: ReadonlySet<number> = new Set([-100])

/**
 * 判一次签到返回是不是撞上了验证码
 *
 * 三个字段任一有值就算：米游社不同时期用不同那一栏，只认 `gt` 会让新形态被当成签到成功。
 * @param data 返回体
 * @returns 撞上验证码时为真
 */
export function isCaptcha(data: SignRaw | undefined): boolean {
  if (!data) return false
  return !!data.gt || !!data.challenge || Number(data.risk_code) > 0
}

/** 米游社签到服务 */
export class SignService {
  /** HTTP 客户端 */
  readonly #http: HttpClient
  /** 日志器 */
  readonly #logger: Logger
  /** 设备存储 */
  readonly #devices: DeviceStore
  /** 取一次间隔的毫秒数 */
  readonly #gap: (ms: number) => number

  /**
   * @param opts 构造参数
   */
  constructor(opts: SignServiceOptions) {
    this.#http = opts.http
    this.#logger = opts.logger
    this.#devices = opts.devices
    this.#gap = opts.gap ?? ((ms: number): number => ms)
  }

  /**
   * 等待一段时间
   * @param ms 缺省毫秒数
   */
  async #wait(ms: number): Promise<void> {
    const real = this.#gap(ms)
    if (real > 0) await new Promise<void>(resolve => setTimeout(resolve, real))
  }

  /**
   * 发一次签到相关的请求
   *
   * 请求头按签到接口那一套拼（与查询那一套不同），设备号取本插件里那台稳定的设备。
   * @param spec 地址与请求体
   * @param board 签到活动，取 Referer 与 `x-rpc-signgame`
   * @param cookie 该账号的 Cookie
   * @param ltuid 账号标识，取设备用
   * @returns 信封；网络层失败时 undefined
   */
  async #call<T>(spec: SignSpec, board: SignBoard, cookie: string, ltuid: string): Promise<Envelope<T> | undefined> {
    const device = await this.#devices.use(ltuid)
    const body = spec.body ? JSON.stringify(spec.body) : ""
    const headers: Record<string, string> = {
      "accept-language": "zh-CN,zh;q=0.9,ja-JP;q=0.8,ja;q=0.7,en-US;q=0.6,en;q=0.5",
      "x-rpc-device_id": device.id,
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0_1 like Mac OS X) AppleWebKit/605.1.15 " +
        `(KHTML, like Gecko) miHoYoBBS/${APP_VERSION}`,
      Referer: board.referer,
      "x-rpc-channel": "appstore",
      "x-rpc-app_version": APP_VERSION,
      "x-requested-with": "com.mihoyo.hyperion",
      "x-rpc-client_type": "5",
      DS: signDs1(),
      Cookie: cookie
    }
    if (board.signGame) headers["x-rpc-signgame"] = board.signGame
    if (body) headers["Content-Type"] = "application/json;charset=UTF-8"

    try {
      const res = await this.#http.request<Envelope<T>>(spec.url, {
        method: body ? "POST" : "GET",
        headers,
        ...(body ? { body } : {}),
        timeout: "20s",
        responseType: "json",
        throwOnError: false
      })
      if (!res.ok) {
        this.#logger.warn(`[米游社][签到][${ltuid}] HTTP ${res.status}`)
        return undefined
      }
      return res.data
    } catch (err) {
      this.#logger.warn(`[米游社][签到][${ltuid}] 请求失败：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  /**
   * 签一个账号名下的全部角色
   * @param account 账号标识与 Cookie
   * @param games 要签哪些游戏，缺省两个都签
   * @returns 报告
   */
  async run(account: { ltuid: string; cookie: string }, games?: readonly SignGame[]): Promise<SignReport> {
    const wanted = games?.length ? SIGN_BOARDS.filter(one => games.includes(one.game)) : SIGN_BOARDS
    const report: SignReport = { ltuid: account.ltuid, items: [], dead: false }

    for (const board of wanted) {
      const roles = await this.#call<{ list?: RoleRaw[] }>(rolesSpec(board), board, account.cookie, account.ltuid)
      if (roles && DEAD_CODES.has(Number(roles.retcode))) {
        report.dead = true
        report.items.push({
          game: board.game,
          name: board.name,
          uid: "",
          nickname: "",
          status: "cookie",
          message: "ck 已失效，请发送「#刷新ck」"
        })
        // Cookie 失效对所有游戏都一样，继续签只会重复得到同一个错误
        return report
      }
      const list = roles?.data?.list ?? []
      if (list.length === 0) {
        report.items.push({
          game: board.game,
          name: board.name,
          uid: "",
          nickname: "",
          status: "norole",
          message: `名下没有${board.name}角色`
        })
        await this.#wait(GAPS.roles)
        continue
      }

      await this.#wait(GAPS.roles)
      for (const role of list) {
        const uid = String(role.game_uid ?? "")
        const region = String(role.region ?? "")
        if (!uid || !region) continue
        report.items.push(await this.#one(board, { region, uid, nickname: String(role.nickname ?? "") }, account))
        await this.#wait(ROLE_GAP.base + Math.floor(Math.random() * ROLE_GAP.range))
      }
    }
    return report
  }

  /**
   * 签一个角色
   *
   * 只签一次，失败不重试，理由见文件头第二条。
   * @param board 签到活动
   * @param role 角色
   * @param account 账号
   * @returns 这个角色的结果
   */
  async #one(
    board: SignBoard,
    role: { region: string; uid: string; nickname: string },
    account: { ltuid: string; cookie: string }
  ): Promise<SignItem> {
    const base = { game: board.game, name: board.name, uid: role.uid, nickname: role.nickname }
    const info = await this.#call<InfoRaw>(infoSpec(board, role), board, account.cookie, account.ltuid)
    await this.#wait(GAPS.info)
    if (!info || Number(info.retcode) !== 0) {
      return { ...base, status: "fail", message: info?.message || "查询签到状态失败" }
    }

    let total = Number(info.data?.total_sign_day) || 0
    if (info.data?.is_sign) {
      return { ...base, status: "already", message: "今天已经签过了", total, ...(await this.#award(board, account, total)) }
    }

    await this.#wait(GAPS.sign)
    const done = await this.#call<SignRaw>(signSpec(board, role), board, account.cookie, account.ltuid)
    if (!done) return { ...base, status: "fail", message: "签到请求没有回应" }
    if (DEAD_CODES.has(Number(done.retcode))) {
      return { ...base, status: "cookie", message: "ck 已失效，请发送「#刷新ck」" }
    }
    if (isCaptcha(done.data)) {
      return { ...base, status: "captcha", message: "需要验证码，请在米游社 App 内手动签到", total }
    }
    if (Number(done.retcode) !== 0) {
      return { ...base, status: "fail", message: done.message || `签到失败（${done.retcode}）`, total }
    }

    total += 1
    return { ...base, status: "signed", message: "签到成功", total, ...(await this.#award(board, account, total)) }
  }

  /**
   * 取今天那一档的奖励
   *
   * 取不到只是少一句"领到了什么"，故一律不让它影响签到结果。
   * @param board 签到活动
   * @param account 账号
   * @param total 累计签到天数，奖励表按它取下标
   * @returns 含 `award` 的片段；取不到时空对象
   */
  async #award(
    board: SignBoard,
    account: { ltuid: string; cookie: string },
    total: number
  ): Promise<{ award?: string }> {
    if (total <= 0) return {}
    const res = await this.#call<AwardsRaw>(awardsSpec(board), board, account.cookie, account.ltuid)
    const one = res?.data?.awards?.[total - 1]
    if (!one?.name) return {}
    return { award: `${one.name}*${one.cnt ?? 1}` }
  }

  /**
   * 把一份报告折成一段可直接发出去的文字
   * @param report 报告
   * @returns 文案；一条结果都没有时空串
   */
  static text(report: SignReport): string {
    if (report.items.length === 0) return ""
    const lines: string[] = []
    for (const one of report.items) {
      const head = one.uid ? `${one.name} ${one.nickname || one.uid}` : one.name
      const tail = one.status === "signed" || one.status === "already" ? `（累计 ${one.total ?? 0} 天）` : ""
      lines.push(`${head}：${one.message}${tail}${one.award ? `${INDENT}${one.award}` : ""}`)
    }
    return lines.join("\n")
  }

  /**
   * 发一次社区接口的请求
   *
   * 请求头与游戏签到那一套完全不同，且签名分两套：带请求体的签到走 DS2 + x6 盐，
   * 不带的状态查询走 DS1 + k2 盐。用错报 `retcode: 10001`，与 stoken 失效相同。
   * @param spec 地址与请求体
   * @param cookie stoken 形态的 Cookie（只有 stuid / stoken / mid 三项）
   * @param ltuid 账号标识，取设备用
   * @returns 信封；网络层失败时 undefined
   */
  async #bbsCall<T>(spec: SignSpec, cookie: string, ltuid: string): Promise<Envelope<T> | undefined> {
    const device = await this.#devices.use(ltuid)
    const body = spec.body ? JSON.stringify(spec.body) : ""
    const headers: Record<string, string> = {
      "x-rpc-app_version": APP_VERSION,
      "x-rpc-client_type": "2",
      "x-rpc-channel": "miyousheluodi",
      "x-rpc-device_id": device.id,
      "x-rpc-device_name": device.name,
      "x-rpc-device_model": device.spec.model,
      "x-rpc-sys_version": "12",
      Referer: "https://app.mihoyo.com",
      "User-Agent": "okhttp/4.8.0",
      DS: body ? signDs({ salt: SALT_X6, query: "", body }) : signDs1({ salt: SALT_K2 }),
      Cookie: cookie
    }
    if (body) headers["Content-Type"] = "application/json;charset=UTF-8"

    try {
      const res = await this.#http.request<Envelope<T>>(spec.url, {
        method: body ? "POST" : "GET",
        headers,
        ...(body ? { body } : {}),
        timeout: "20s",
        responseType: "json",
        throwOnError: false
      })
      if (!res.ok) {
        this.#logger.warn(`[米游社][社区签到][${ltuid}] HTTP ${res.status}`)
        return undefined
      }
      return res.data
    } catch (err) {
      this.#logger.warn(`[米游社][社区签到][${ltuid}] 请求失败：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  /**
   * 查米游币余额与今日剩余可得
   *
   * 与社区签到是同一条接口：`can_get_points` 为 0 即今天该拿的都拿到了。
   * @param account 账号标识与 stoken 形态的 Cookie
   * @returns 米游币情况
   */
  async coins(account: { ltuid: string; stoken: string }): Promise<CoinResult> {
    const res = await this.#bbsCall<MissionsRaw>(bbsMissionsSpec(), account.stoken, account.ltuid)
    if (!res) return { ok: false, dead: false, message: "米游社没有回应，请稍后再试" }
    if (DEAD_CODES.has(Number(res.retcode))) {
      return { ok: false, dead: true, message: "登录态已失效，请重新发送「#扫码登录」" }
    }
    if (Number(res.retcode) !== 0 || !res.data) {
      return { ok: false, dead: false, message: res.message || `查询失败（${res.retcode}）` }
    }
    return {
      ok: true,
      dead: false,
      points: Number(res.data.total_points) || 0,
      canGet: Number(res.data.can_get_points) || 0
    }
  }

  /**
   * 社区签到
   *
   * 与游戏签到分开三处：凭据是 stoken 而非 Cookie、按版块而非按角色签、收益是米游币。
   * 同样只签一次，撞验证码不重试。
   * @param account 账号标识与 stoken 形态的 Cookie
   * @param games 要签哪些版块，缺省全签
   * @returns 逐版块的结果
   */
  async bbs(account: { ltuid: string; stoken: string }, games?: readonly SignGame[]): Promise<BbsReport> {
    const wanted = games?.length ? SIGN_BOARDS.filter(one => games.includes(one.game)) : SIGN_BOARDS
    const report: BbsReport = { ltuid: account.ltuid, items: [], dead: false }

    const before = await this.coins(account)
    if (!before.ok) {
      report.dead = before.dead
      report.message = before.message
      return report
    }
    report.points = before.points
    report.canGet = before.canGet
    // 今日额度已满时一个包都不发：签了也不会再给米游币
    if (before.canGet === 0) {
      report.message = "今天该拿的米游币都拿到了"
      return report
    }

    for (const board of wanted) {
      const res = await this.#bbsCall<unknown>(bbsSignSpec(board.gids), account.stoken, account.ltuid)
      if (res && DEAD_CODES.has(Number(res.retcode))) {
        report.dead = true
        report.message = "登录态已失效，请重新发送「#扫码登录」"
        return report
      }
      report.items.push({ name: board.name, ...bbsVerdict(res) })
      await this.#wait(GAPS.sign)
    }

    const after = await this.coins(account)
    if (after.ok) {
      report.points = after.points
      report.canGet = after.canGet
    }
    return report
  }

  /**
   * 把一份社区签到报告折成文字
   * @param report 报告
   * @returns 文案
   */
  static bbsText(report: BbsReport): string {
    const lines: string[] = []
    if (report.points !== undefined) {
      lines.push(`米游币 ${report.points}，今日还能获得 ${report.canGet ?? 0}`)
    }
    if (report.message) lines.push(report.message)
    for (const one of report.items) lines.push(`${INDENT}${one.name}：${one.message}`)
    return lines.join("\n")
  }
}

/**
 * 判一次社区签到的返回
 *
 * `1008` 是"今天已签"而不是失败，把它当失败会让每天第二次执行都报一次错。
 * @param res 返回信封
 * @returns 结果分类与说明
 */
function bbsVerdict(res: Envelope<unknown> | undefined): { status: BbsStatus; message: string } {
  if (!res) return { status: "fail", message: "没有回应" }
  const code = Number(res.retcode)
  if (code === 0) return { status: "signed", message: "签到成功" }
  if (code === 1008) return { status: "already", message: "今天已经签过了" }
  if (code === 1034) return { status: "captcha", message: "需要验证码，请在米游社 App 内手动签到" }
  return { status: "fail", message: res.message || `失败（${code}）` }
}

/**
 * 认出一段文本里指定的游戏
 * @param rest 命令剩余文本
 * @returns 指定的游戏；未指明时 undefined（全部都签）
 */
export function signGamesOf(rest: string): readonly SignGame[] | undefined {
  const out: SignGame[] = []
  if (/原神|gs/i.test(rest)) out.push("gs")
  if (/星铁|星穹|崩铁|sr/i.test(rest)) out.push("sr")
  if (/绝区零|zzz/i.test(rest)) out.push("zzz")
  return out.length ? out : undefined
}

/** 判一个游戏能不能签到，供命令层在绝区零时给出明确说法 */
export const canSign = (game: string): boolean => !!signBoard(game)
