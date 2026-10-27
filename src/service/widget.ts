/**
 * 模块职责：走小组件接口取一次体力 —— 体力提醒的后台轮询用它，免验证码
 * 依赖方向：依赖内核的 HttpClient / Logger、本插件的 core/widget-api 与 store/ck；不认识命令层
 * 生命周期：随插件 setup 创建一个实例，无状态
 * 注意事项：它只服务于后台轮询，使用者当场发 `#体力` 仍走实时便笺（后者字段更全）。
 *          小组件的用处只有一个：在使用者不知情时每天查几次不会撞验证码，而实时便笺会。
 *
 *          拿不到就明说，由调用方退回实时便笺。三种取不到：没绑 stoken、账号是国际服、
 *          以及这个账号在这个游戏下有多个 uid。
 *
 *          最后那条是本文件最要紧的取舍：小组件返回的是米游社里"当前选中的那个角色"的数据、
 *          响应不带 uid，故无从校验拿回来的是不是想查的账号。`changeGameRoleByDefault` 能改选中
 *          角色，但那是代替使用者写入（会改掉他手机上小组件显示的角色），故不做 —— 多 uid 的
 *          账号一律退回实时便笺。
 */
import type { HttpClient, Logger } from "@yunzai-ng/types"
import type { DeviceStore } from "../core/device.js"
import type { GameKey } from "../core/region.js"
import { isCnServer, getServer } from "../core/region.js"
import { widgetCookie, widgetHeaders, widgetUrl } from "../core/widget-api.js"
import type { CookiePool } from "../store/ck.js"
import type { NoteRaw } from "../views/note.js"

/** 小组件取不到数据的原因 */
export type WidgetSkip =
  /** 这个账号没绑 stoken */
  | "nostoken"
  /** 国际服，没有这套接口 */
  | "oversea"
  /** 这个账号在这个游戏下有多个 uid，无从判定拿回来的是哪一个 */
  | "ambiguous"
  /** 池子里挑不出这个 uid 的 CK */
  | "nock"
  /** 请求失败或接口报错 */
  | "fail"

/** 取一次小组件的结果 */
export type WidgetResult =
  | {
      /** 成功 */
      ok: true
      /** 便笺形态的数据 —— 字段名与实时便笺一致，故 views/note 原样可用 */
      data: NoteRaw
    }
  | {
      /** 失败 */
      ok: false
      /** 为什么取不到 */
      skip: WidgetSkip
      /** 一句给日志看的说明，不含凭据的任何部分 */
      message: string
    }

/** 小组件服务的构造参数 */
export interface WidgetServiceOptions {
  /** HTTP 客户端，取 `ctx.http` */
  http: HttpClient
  /** Cookie 池 —— 要从中取 stoken 与"这个账号有几个 uid" */
  cookies: CookiePool
  /** 设备存储 —— 与查询、签到用同一台设备 */
  devices: DeviceStore
  /** 日志器 */
  logger: Logger
}

/** 米游社返回的信封 */
interface Envelope {
  /** 业务返回码 */
  retcode?: number
  /** 提示 */
  message?: string
  /** 数据 */
  data?: NoteRaw
}

/** 取一次小组件要的参数 */
export interface WidgetQuery {
  /** 游戏 */
  game: GameKey
  /** 游戏 uid */
  uid: string
  /** 发起者标识，挑 CK 时优先选他自己的 */
  owner: string
}

/** 米游社小组件取数服务 */
export class WidgetService {
  /** HTTP 客户端 */
  readonly #http: HttpClient
  /** Cookie 池 */
  readonly #cookies: CookiePool
  /** 设备存储 */
  readonly #devices: DeviceStore
  /** 日志器 */
  readonly #logger: Logger

  /**
   * @param opts 构造参数
   */
  constructor(opts: WidgetServiceOptions) {
    this.#http = opts.http
    this.#cookies = opts.cookies
    this.#devices = opts.devices
    this.#logger = opts.logger
  }

  /**
   * 走小组件取一次体力
   *
   * 只用发起者本人绑定该 uid 的 CK（`pick` 自带这道归属闸）：小组件凭 stoken，而 stoken 比
   * Cookie 更强，绝不该拿别人的跑背景任务。
   * @param q 游戏、uid 与发起者
   * @returns 结果；取不到时带上原因，由调用方退回实时便笺
   */
  async note(q: WidgetQuery): Promise<WidgetResult> {
    if (!isCnServer(getServer(q.uid, q.game))) {
      return { ok: false, skip: "oversea", message: "国际服没有小组件接口" }
    }

    const record = await this.#cookies.pick({ uid: q.uid, game: q.game, owner: q.owner })
    if (!record) return { ok: false, skip: "nock", message: "挑不出这个 uid 自己的 CK" }

    const mine = record.uids[q.game] ?? []
    if (mine.length > 1) {
      return { ok: false, skip: "ambiguous", message: `该账号在此游戏下有 ${mine.length} 个 uid，无从判定小组件返回的是哪个` }
    }

    // stoken 可能单独存过一栏，也可能就在整份 Cookie 里，两处都要看
    const cookie = widgetCookie(record.stoken ? `${record.cookie}; ${record.stoken}` : record.cookie)
    if (!cookie) {
      return { ok: false, skip: "nostoken", message: "该账号没有 stoken，可私聊发送「#扫码登录」补一份" }
    }

    const device = await this.#devices.use(record.ltuid)
    const headers = widgetHeaders(q.game, cookie, {
      id: device.id,
      name: device.name,
      model: device.spec.model
    })

    try {
      const res = await this.#http.request<Envelope>(widgetUrl(q.game), {
        method: "GET",
        headers,
        timeout: "20s",
        responseType: "json",
        throwOnError: false
      })
      if (!res.ok) return { ok: false, skip: "fail", message: `HTTP ${res.status}` }

      const body = res.data
      if (body?.retcode !== 0 || !body.data) {
        return { ok: false, skip: "fail", message: `retcode ${body?.retcode ?? "?"}：${body?.message ?? ""}` }
      }
      return { ok: true, data: body.data }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.#logger.debug(`[米游社][小组件] ${q.game} ${q.uid} 请求失败：${message}`)
      return { ok: false, skip: "fail", message }
    }
  }
}
