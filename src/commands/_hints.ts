/**
 * 模块职责：命令落到别的游戏时那一句「本游戏可以查什么」，以及「上期」的认法
 * 依赖方向：只依赖 core/region 的类型；被 gs / sr 的挑战类命令与 `#深渊` 引用
 * 生命周期：模块级常量
 * 注意事项：提示按**消息所在的游戏**给，写死成某一个游戏会让 `%幽境危战` 被指去查 `*虚构叙事`。
 */
import type { GameKey } from "../core/region.js"

/** 各游戏自己的挑战类命令，按前缀写好 */
const CHALLENGES: Readonly<Record<GameKey, string>> = {
  gs: "#深渊 / #幻想真境剧诗 / #幽境危战",
  sr: "*混沌回忆 / *虚构叙事 / *末日幻影 / *异相仲裁",
  zzz: "%式舆防卫战 / %危局强袭战 / %临界推演"
}

/**
 * 「这玩法只有某游戏有」那一句，后半截指去消息所在游戏自己的挑战
 * @param title 玩法名
 * @param owner 玩法所属的游戏名
 * @param game 消息所在的游戏
 * @returns 一句提示
 */
export function onlyIn(title: string, owner: string, game: GameKey): string {
  return `${title}只有${owner}有，可以查 ${CHALLENGES[game]}`
}

/** 「上期」「上一期」：要连着「期」字，只写「上」会把名字或尾巴里的任何一个「上」当成查上期 */
export const PREV_SEASON = /上一?期/
