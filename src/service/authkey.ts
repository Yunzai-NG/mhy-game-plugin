/**
 * 模块职责：抽卡链接自助获取 —— 凭 stoken 向米游社换取 authkey，免去手贴祈愿链接
 * 依赖方向：依赖内核的 HttpClient / Logger 与本插件的 api / ds / device / region
 * 生命周期：随插件 setup 创建一个实例，无状态（stoken 由 Cookie 池提供、authkey 交给抽卡库落库）
 * 注意事项：这条路要 stoken —— `genAuthKey` 只认 stoken 形态的 Cookie（`stuid;stoken;mid`），
 *          用查询用的 ltoken 去换只回 `retcode: 10001`「请先登录」。命令层据此在无 stoken 时
 *          退回手贴链接那条路。
 *
 *          签名是 DS1（只对 `salt` / `t` / `r` 取 md5）、盐为 lk2（{@link SALT_SIGN}）、
 *          `x-rpc-client_type` 为 5，三项一字不能改：签错、盐错、类型错的表现都是 10001，
 *          与 stoken 失效难以区分。请求体不进签名。
 *
 *          region 由 uid 推出（{@link getServer}），它既是入参又决定换来的 authkey 投哪个抽卡域名，
 *          两者同源故不会出现"换到了 authkey 却查不到记录"。
 */
import type { HttpClient, Logger } from "@yunzai-ng/types"
import { apiHosts } from "../core/api.js"
import type { DeviceStore } from "../core/device.js"
import { SALT_SIGN, signDs1 } from "../core/ds.js"
import type { GameKey } from "../core/region.js"
import { gameBiz, getServer, isCnServer } from "../core/region.js"

/** 客户端版本，与本插件其余 stoken 级请求一致 */
const APP_VERSION = "2.70.1"

/** 换取 authkey 的结果 */
export interface AuthKeyResult {
  /** 成功 */
  ok: boolean
  /** 换来的 authkey，已是可直接拼进抽卡接口的明文 */
  authkey?: string
  /** 该 authkey 对应的区服，与抽卡域名判定同源 */
  region?: string
  /** 失败原因，可直接回复给使用者 */
  message?: string
}

/** 换 authkey 服务的构造参数 */
export interface AuthKeyServiceOptions {
  /** HTTP 客户端 */
  http: HttpClient
  /** 设备存储，取 x-rpc-device 三件 */
  devices: DeviceStore
  /** 日志器 */
  logger: Logger
}

/** `genAuthKey` 的返回信封 */
interface GenAuthKeyRaw {
  /** 业务返回码 */
  retcode?: number
  /** 提示 */
  message?: string
  /** 数据 */
  data?: {
    /** authkey 本体 */
    authkey?: string
    /** authkey 版本，恒为 1 */
    authkey_ver?: number
    /** 签名类型，恒为 2 */
    sign_type?: number
  } | null
}

/** 换 authkey 服务 */
export class AuthKeyService {
  readonly #http: HttpClient
  readonly #devices: DeviceStore
  readonly #logger: Logger

  /**
   * @param opts 构造参数
   */
  constructor(opts: AuthKeyServiceOptions) {
    this.#http = opts.http
    this.#devices = opts.devices
    this.#logger = opts.logger
  }

  /**
   * 凭 stoken 换一份抽卡 authkey
   *
   * @param game 游戏
   * @param uid 游戏 uid，决定 region 与 game_uid
   * @param ltuid 米游社账号标识，取设备用
   * @param stoken stoken 形态的 Cookie（`stuid;stoken;mid`），作请求头 Cookie
   * @returns 换取结果，不抛错
   */
  async generate(game: GameKey, uid: string, ltuid: string, stoken: string): Promise<AuthKeyResult> {
    const server = getServer(uid, game)
    const cn = isCnServer(server)
    const { host } = apiHosts(cn)
    const url = `${host}binding/api/genAuthKey`
    // `game_uid` 是数字，写成串米游社照收但与真实客户端不同形
    const bodyText = JSON.stringify({
      auth_appid: "webview_gacha",
      game_biz: gameBiz(game, cn),
      game_uid: Number(uid),
      region: server
    })

    const device = await this.#devices.use(ltuid)
    const headers: Record<string, string> = {
      "x-rpc-app_version": APP_VERSION,
      "x-rpc-client_type": "5",
      "x-rpc-channel": "mihoyo",
      "x-rpc-device_id": device.id,
      "x-rpc-device_name": device.name,
      "x-rpc-device_model": device.spec.model,
      "x-rpc-sys_version": "12",
      Referer: "https://app.mihoyo.com",
      Origin: "https://webstatic.mihoyo.com",
      "User-Agent": "okhttp/4.8.0",
      "Content-Type": "application/json;charset=UTF-8",
      DS: signDs1({ salt: SALT_SIGN }),
      Cookie: stoken
    }

    try {
      const res = await this.#http.request<GenAuthKeyRaw>(url, {
        method: "POST",
        headers,
        body: bodyText,
        timeout: "20s",
        responseType: "json",
        throwOnError: false
      })
      if (!res.ok) {
        this.#logger.warn(`[抽卡][自助取链接][${ltuid}] HTTP ${res.status}`)
        return { ok: false, message: "米游社没有回应，请稍后再试" }
      }
      const env = res.data
      const code = Number(env?.retcode ?? -1)
      const authkey = env?.data?.authkey
      if (code !== 0 || !authkey) {
        // 10001「请先登录」几乎都是 stoken 已失效，据此给一句可操作的提示
        const hint = code === 10001 ? "stoken 已失效，请重新「#扫码登录」" : env?.message || `米游社返回 ${code}`
        this.#logger.warn(`[抽卡][自助取链接][${ltuid}] 换取失败：retcode=${code}`)
        return { ok: false, message: hint }
      }
      this.#logger.info(`[抽卡][自助取链接][${ltuid}] ${uid} 换取 authkey 成功`)
      return { ok: true, authkey, region: server }
    } catch (err) {
      this.#logger.warn(`[抽卡][自助取链接][${ltuid}] 请求失败：${err instanceof Error ? err.message : String(err)}`)
      return { ok: false, message: "无法连接米游社，请检查网络或代理后重试" }
    }
  }
}
