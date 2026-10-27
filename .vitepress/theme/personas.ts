/**
 * 对话里的机器人是谁：不分游戏的功能用米游姬，原神派蒙、星铁帕姆、绝区零伊埃斯
 *
 * 头像与页签按钮取 public/mascot/<键>.webp，同一张表情两处共用。
 */

/** 游戏键 */
export type ChatGame = "mys" | "gs" | "sr" | "zzz"

/** 一位机器人与它那个游戏里玩家的默认称呼 */
export interface Persona {
  /** 机器人名 */
  bot: string
  /** 玩家默认称呼 */
  me: string
  /** 页签上的游戏名 */
  game: string
}

export const PERSONA: Record<ChatGame, Persona> = {
  mys: { bot: "米游姬", me: "旅行者", game: "通用" },
  gs: { bot: "派蒙", me: "旅行者", game: "原神" },
  sr: { bot: "帕姆", me: "开拓者", game: "星穹铁道" },
  zzz: { bot: "伊埃斯", me: "绳匠", game: "绝区零" }
}
