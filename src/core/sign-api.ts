/**
 * 模块职责：米游社签到接口表 —— 游戏签到的活动 id 与三个接口，以及社区签到那一族
 * 依赖方向：纯数据与纯函数，不碰 IO
 * 生命周期：无状态
 * 注意事项：签到不走 core/api.ts 那张表 —— 域名、签名算法（DS1，见 core/ds.ts 的
 *          {@link SALT_SIGN}）与请求头都与查询那一套不同。
 *
 *          `act_id` 会随大版本更换，换了之后表现不是报错而是 `retcode: -100` 或"活动已结束"，
 *          故它是本文件里最需要跟着核对的一项。
 *
 *          游戏签到与社区签到是两件事，凭据与签名都不同：
 *          游戏签到（`event/luna/*`）凭 ltoken / cookie_token，签名 DS1，只做三个国服游戏；
 *          社区签到（`bbs-api` 的 `apihub/*`）凭 stoken，且签名分两套 —— 查询任务状态那一条
 *          用 DS1，真正签到那一条用 DS2 + x6 盐，用错报 `retcode: 10001`，与 stoken 失效同形。
 */
import type { GameKey } from "./region.js"

/**
 * 可签到的游戏
 *
 * 由 {@link GameKey} 派生而不重写字面量：照抄一遍加第四个游戏时不会报错，只是签到命令
 * 收不到那个游戏。
 */
export type SignGame = GameKey

/** 签到接口的国服域名 */
export const SIGN_HOST = "https://api-takumi.mihoyo.com"

/** 米游社社区接口的域名 */
export const BBS_HOST = "https://bbs-api.miyoushe.com"

/** 一个游戏的签到活动 */
export interface SignBoard {
  /** 游戏 */
  game: SignGame
  /** 展示名 */
  name: string
  /** `game_biz`，取角色列表时用 */
  biz: string
  /** 活动 id，随大版本更换 */
  actId: string
  /** 活动页地址，作 Referer —— 缺了它接口回的是一句与账号无关的错误 */
  referer: string
  /** 额外的 `x-rpc-signgame` 头；只有原神与绝区零要 */
  signGame?: string
  /** 社区版块 id，社区签到按它区分板块 */
  gids: number
}

/** 三个游戏的签到活动 */
export const SIGN_BOARDS: readonly SignBoard[] = [
  {
    game: "gs",
    name: "原神",
    biz: "hk4e_cn",
    actId: "e202311201442471",
    referer:
      "https://act.mihoyo.com/bbs/event/signin-ys/index.html" +
      "?bbs_auth_required=true&act_id=e202311201442471&utm_source=bbs&utm_medium=mys&utm_campaign=icon",
    signGame: "hk4e",
    gids: 2
  },
  {
    game: "sr",
    name: "星穹铁道",
    biz: "hkrpg_cn",
    actId: "e202304121516551",
    referer:
      "https://webstatic.mihoyo.com/bbs/event/signin/hkrpg/index.html" +
      "?bbs_auth_required=true&act_id=e202304121516551&bbs_presentation_style=fullscreen" +
      "&utm_source=h5&utm_medium=mys&utm_campaign=zj",
    gids: 6
  },
  {
    // 与另两个走同一条 `event/luna/sign`，只是活动 id 与 `x-rpc-signgame` 不同
    game: "zzz",
    name: "绝区零",
    biz: "nap_cn",
    actId: "e202406242138391",
    referer:
      "https://act.mihoyo.com/bbs/event/signin/zzz/index.html" +
      "?bbs_auth_required=true&act_id=e202406242138391&bbs_presentation_style=fullscreen" +
      "&utm_source=bbs&utm_medium=mys&utm_campaign=icon",
    signGame: "zzz",
    gids: 8
  }
]

/**
 * 取一个游戏的签到活动
 * @param game 游戏
 * @returns 活动；不支持签到的游戏 undefined
 */
export function signBoard(game: string): SignBoard | undefined {
  return SIGN_BOARDS.find(one => one.game === game)
}

/** 一次签到请求的地址与请求体 */
export interface SignSpec {
  /** 完整 URL，含 query */
  url: string
  /** 请求体；存在即用 POST */
  body?: Record<string, unknown>
}

/**
 * 取该账号名下某个游戏的角色列表
 *
 * 与 core/api.ts 的 `bindings` 是同一个接口，但签名与请求头是签到那一套，故另列一条。
 * @param board 签到活动
 * @returns 请求
 */
export function rolesSpec(board: SignBoard): SignSpec {
  return { url: `${SIGN_HOST}/binding/api/getUserGameRolesByCookie?game_biz=${board.biz}` }
}

/**
 * 查今天签没签
 * @param board 签到活动
 * @param role 角色的区服与 uid
 * @returns 请求
 */
export function infoSpec(board: SignBoard, role: { region: string; uid: string }): SignSpec {
  return {
    url: `${SIGN_HOST}/event/luna/info?region=${role.region}&act_id=${board.actId}&uid=${role.uid}`
  }
}

/**
 * 签一次
 * @param board 签到活动
 * @param role 角色的区服与 uid
 * @returns 请求
 */
export function signSpec(board: SignBoard, role: { region: string; uid: string }): SignSpec {
  return {
    url: `${SIGN_HOST}/event/luna/sign`,
    body: { region: role.region, act_id: board.actId, uid: role.uid }
  }
}

/**
 * 取本月的奖励清单，用来说清"今天签到拿到了什么"
 * @param board 签到活动
 * @returns 请求
 */
export function awardsSpec(board: SignBoard): SignSpec {
  return { url: `${SIGN_HOST}/event/luna/home?act_id=${board.actId}` }
}

/**
 * 查社区任务状态 —— 同时也是米游币余额的来源
 *
 * `total_points` 是当前米游币，`can_get_points` 是今日还能获得多少。签名走 DS1。
 * @returns 请求
 */
export function bbsMissionsSpec(): SignSpec {
  return { url: `${BBS_HOST}/apihub/sapi/getUserMissionsState` }
}

/**
 * 在一个社区版块签到
 *
 * 这一条的签名是 DS2 + x6 盐，与上面那条不同：它带请求体，服务端要按 body 对账。
 * @param gids 版块 id，见 {@link SignBoard.gids}
 * @returns 请求
 */
export function bbsSignSpec(gids: number): SignSpec {
  return { url: `${BBS_HOST}/apihub/app/api/signIn`, body: { gids: String(gids) } }
}
