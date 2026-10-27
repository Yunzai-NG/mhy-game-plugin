/**
 * 模块职责：页头右上角那一格（头像 + 游戏内昵称 + UID + 等级）的视图模型
 * 依赖方向：依赖 core/region 取各游戏的称呼；纯函数，不读盘也不发请求
 * 生命周期：无状态
 * 注意事项：头像的根由标记指出（`fromFace` 头像库 / `fromRes` 默认图），根给错是静默空白。
 *          昵称缺省回落各游戏的称呼而非聊天平台昵称：页头印的是这个 uid 的主人，代查时印查询者就错了。
 */
import type { GameKey } from "../core/region.js"

/** 一张头像都没取到时垫的默认图，随插件提交，故装不装元数据都在 */
const DEFAULT_FACE: Readonly<Record<GameKey, string>> = {
  gs: "common/face/gs.png",
  sr: "common/face/sr.png",
  zzz: "common/face/zzz.png"
}

/** 各游戏对玩家的称呼，接口与面板都没给昵称时用它 */
export const PLAYER_NAMES: Readonly<Record<GameKey, string>> = {
  gs: "旅行者",
  sr: "开拓者",
  zzz: "绳匠"
}

/** 页头右上角那一格 */
export interface WhoView {
  /** 头像路径，根由 {@link fromFace} / {@link fromRes} 指出 */
  face: string
  /** 头像在头像库里，模板拼 `_face_path` */
  fromFace?: boolean
  /** 头像是插件自带的默认图，模板拼 `_res_path` */
  fromRes?: boolean
  /** 游戏内昵称 */
  name: string
  /** uid */
  uid?: string
  /** 等级文案，如 `Lv.60` */
  level?: string
  /** 世界等级文案，仅原神有 */
  world?: string
}

/** 造这一格需要的东西，都可缺 */
export interface WhoInput {
  /** 游戏，决定默认头像与缺省称呼 */
  game: GameKey
  /** uid */
  uid?: string
  /** 头像库里那张的相对路径，缺它时垫默认图 */
  face?: string
  /** 游戏内昵称 */
  name?: string
  /** 冒险等阶 / 开拓等级 / 绳匠等级 */
  level?: number
  /** 世界等级，仅原神 */
  world?: number
}

/**
 * 组装页头右上角那一格
 * @param input 已取到的那几项
 * @returns 视图；头像与昵称恒有值（各有缺省），其余缺则不给键
 */
export function buildWho(input: WhoInput): WhoView {
  const name = input.name || PLAYER_NAMES[input.game]
  const out: WhoView = input.face
    ? { face: input.face, fromFace: true, name }
    : { face: DEFAULT_FACE[input.game], fromRes: true, name }
  if (input.uid) out.uid = input.uid
  const level = Number(input.level) || 0
  if (level > 0) out.level = `Lv.${level}`
  const world = Number(input.world) || 0
  if (world > 0) out.world = `世界 ${world}`
  return out
}
