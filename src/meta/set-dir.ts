/**
 * 模块职责：套装那一族在元数据包里的目录名 —— 原神星铁 `artifact/`、绝区零 `equip/`
 * 依赖方向：只依赖 core/region 的游戏枚举；纯数据与纯函数，不碰 IO
 * 生命周期：无状态，表是模块级常量
 * 注意事项：「一个游戏一个目录名」只在这张表里。图片路径的形态刻意不收进来——
 *          三游戏的套装图路径差别不只目录名（分不分子目录、文件名带不带前缀、按不按部位分文件），
 *          仍由各调用点逐游戏各写一条，只是目录名一段改从这里取。
 */
import type { GameKey } from "../core/region.js"

/**
 * 逐游戏的套装目录名
 *
 * 绝区零没有 `artifact/` 这一层，它的套装即驱动盘套装、落在 `equip/` 下。照原路去问不报错而恒为假
 * （每次启动重下整包、套装 buff 恒空、评分覆盖表读不到）。
 */
export const SET_DIRS: Readonly<Record<GameKey, string>> = {
  gs: "artifact",
  sr: "artifact",
  zzz: "equip"
}

/** 认得的套装目录名，去重后的那两个；判「一个路径是不是落在套装目录下」时用它 */
export const SET_DIR_NAMES: readonly string[] = [...new Set(Object.values(SET_DIRS))]

/**
 * 取一个游戏的套装目录名
 * @param game 游戏
 * @returns 目录名；认不出的游戏按原神星铁那一档
 */
export function setDirOf(game: string | undefined): string {
  return SET_DIRS[game as GameKey] ?? SET_DIRS.gs
}

/**
 * 拼一个游戏套装目录下某个文件的相对路径
 *
 * 形如 `meta-gs/artifact/artis-mark.js`、`meta-zzz/equip/data.json`。
 * @param game 游戏
 * @param file 文件名，可带子路径
 * @returns 相对元数据根目录的路径，以 `/` 分隔
 */
export function setFileOf(game: string | undefined, file: string): string {
  return `meta-${game}/${setDirOf(game)}/${file}`
}
