/**
 * 模块职责：帮助图可用的表情包清单 —— 四池各有哪些文件
 * 依赖方向：无依赖的纯数据，由 views/help.ts 挑图时读
 * 生命周期：无状态
 * 注意事项：**本文件是生成的，不要手改**：清单须与 `resources/help/emoji/` 下实际有的文件一致，脱节则帮助图上
 *          一片碎图。清单落成代码而非出图时扫目录：视图层是纯函数，不碰文件系统。
 */

/** 图池 —— 米游姬一家与三个游戏各一池 */
export type EmojiPack = "mys" | "gs" | "sr" | "zzz"

/** 图目录，相对 `_res_path` */
export const EMOJI_DIR = "help/emoji/"

/** 各池的文件名，已按名排序（挑图要确定的顺序，同一张帮助图两次出图不该换图） */
export const EMOJI_POOL: Readonly<Record<EmojiPack, readonly string[]>> = {
  mys: [
    "星谷米游姬-好耶.png",
    "米游兔举牌子.png",
    "米游君——认真工作.png",
    "米游姬-开心.png"
  ],
  gs: [
    "八重神子-工作中.png",
    "早柚-困.png",
    "派蒙-好耶.png",
    "钟离-博学.png",
    "魈-战斗准备.png"
  ],
  sr: [
    "万敌-点赞.png",
    "卢卡-重拳出击.png",
    "帕姆-学习.png",
    "景元-困.png",
    "砂金-撒钱.png"
  ],
  zzz: [
    "伊芙琳-打电话.png",
    "叶瞬光-看书.png",
    "星见雅-满足.png",
    "般岳-瞌睡.png",
    "莱卡恩-准备战斗.png"
  ]
}
