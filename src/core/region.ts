/**
 * 模块职责：游戏与区服判定 —— uid 前缀 → 区服标识、消息前缀 → 游戏、game_biz 拼装
 * 依赖方向：纯函数模块，不依赖内核与任何 IO
 * 生命周期：无状态，可自由并发调用
 * 注意事项：区服标识取错不报"区服错误"，而是回 `retcode: 10102`（数据不公开）或空数据。
 *          对照表逐项按线上实测可用的取值写死，不做"看起来更整齐"的改写。
 *
 *          绝区零表中官服与 B 服均为 `prod_gf_cn`，不是笔误 —— 它没有独立的 B 服标识。
 */

/** 支持的游戏 */
export type GameKey = "gs" | "sr" | "zzz"

/** 全部游戏，顺序即展示顺序 */
export const GAME_KEYS: readonly GameKey[] = ["gs", "sr", "zzz"]

/**
 * 判一个字符串是不是支持的游戏
 *
 * 判据取自 {@link GAME_KEYS}，故加游戏时不必逐处补清单。
 * @param game 待判的值
 * @returns 是支持的游戏时为真
 */
export function isGameKey(game: string | undefined): game is GameKey {
  return GAME_KEYS.includes(game as GameKey)
}

/** 游戏中文名 */
export const GAME_NAMES: Readonly<Record<GameKey, string>> = {
  gs: "原神",
  sr: "星穹铁道",
  zzz: "绝区零"
}

/**
 * 各游戏的规范命令前缀，与 {@link detectGame} 规整出来的形态一致
 *
 * 示例命令要带当前游戏的前缀：星铁使用者照着 `#绑定uid` 发一次会绑到原神。
 */
export const COMMAND_PREFIX: Readonly<Record<GameKey, string>> = {
  gs: "#",
  sr: "#星铁",
  zzz: "#绝区零"
}

/**
 * 各游戏的简写命令前缀，回复示例命令时用它
 *
 * 与 {@link COMMAND_PREFIX} 的分别：那一份是注册与规整用的规范形态（`#星铁体力`），
 * 这一份是给人看的简写（`*体力`）。三个游戏都要有值 —— 写成
 * `game === "sr" ? "*" : "#"` 会让绝区零使用者照着 `#更新面板` 更新到原神的面板，且不报错。
 */
export const SHORT_PREFIX: Readonly<Record<GameKey, string>> = {
  gs: "#",
  sr: "*",
  zzz: "%"
}

/**
 * 各游戏里"那一族装备"叫什么
 *
 * 三档都要有值：写成 `game === "sr" ? "遗器" : "圣遗物"` 会把「圣遗物」这个词发给绝区零
 * 使用者，且不报错。
 */
export const GEAR_NAMES: Readonly<Record<GameKey, string>> = {
  gs: "圣遗物",
  sr: "遗器",
  zzz: "驱动盘"
}

/**
 * 各游戏里"手上那件装备"叫什么
 *
 * 与 {@link GEAR_NAMES} 同一道理，只是说的是另一格。
 */
export const WEAPON_NAMES: Readonly<Record<GameKey, string>> = {
  gs: "武器",
  sr: "光锥",
  zzz: "音擎"
}

/**
 * 各游戏里"那一族被动强化"叫什么
 *
 * 原神命座、星铁星魂、绝区零意象影画（图上一律用简称「影画」）。
 */
export const CONS_NAMES: Readonly<Record<GameKey, string>> = {
  gs: "命座",
  sr: "星魂",
  zzz: "影画"
}

/**
 * 示例命令里拿谁举例
 *
 * 例子必须是该游戏真有的角色：让绝区零使用者照着「#胡桃伤害」发，那个名字在它的元数据里
 * 一个都查不到。取各游戏的初始／常见角色，不随版本更替。
 */
export const DEMO_CHARS: Readonly<Record<GameKey, string>> = {
  gs: "胡桃",
  sr: "青雀",
  zzz: "安比"
}

/** 各游戏在 `game_biz` 里的业务前缀 */
const BIZ_PREFIX: Readonly<Record<GameKey, string>> = {
  gs: "hk4e",
  sr: "hkrpg",
  zzz: "nap"
}

/** 区服归类 */
export type RegionKind = "official" | "bilibili" | "usa" | "euro" | "asia" | "cht"

/**
 * uid 前缀 → 区服标识
 *
 * 六档依次为 官服 / B服 / 美服 / 欧服 / 亚服 / 港澳台服，取值均为线上实测可用的那一套。
 */
const REGION_TABLE: Readonly<Record<GameKey, Readonly<Record<RegionKind, string>>>> = {
  gs: {
    official: "cn_gf01",
    bilibili: "cn_qd01",
    usa: "os_usa",
    euro: "os_euro",
    asia: "os_asia",
    cht: "os_cht"
  },
  sr: {
    official: "prod_gf_cn",
    bilibili: "prod_qd_cn",
    usa: "prod_official_usa",
    euro: "prod_official_euro",
    asia: "prod_official_asia",
    cht: "prod_official_cht"
  },
  zzz: {
    official: "prod_gf_cn",
    // 绝区零不存在独立的 B 服区服，一律使用官服标识
    bilibili: "prod_gf_cn",
    usa: "prod_gf_us",
    euro: "prod_gf_eu",
    asia: "prod_gf_jp",
    cht: "prod_gf_sg"
  }
}

/** 原神 / 星铁的 uid 首位 → 区服归类 */
const CLASSIC_PREFIX: Readonly<Record<string, RegionKind>> = {
  "5": "bilibili",
  "6": "usa",
  "7": "euro",
  "8": "asia",
  "18": "asia",
  "9": "cht"
}

/** 绝区零的 uid 前两位 → 区服归类（仅 10 位国际服 uid 有前缀） */
const ZZZ_PREFIX: Readonly<Record<string, RegionKind>> = {
  "10": "usa",
  "15": "euro",
  "13": "asia",
  "17": "cht"
}

/** 区服中文名，用于回复使用者 */
export const REGION_NAMES: Readonly<Record<RegionKind, string>> = {
  official: "官服",
  bilibili: "B服",
  usa: "美服",
  euro: "欧服",
  asia: "亚服",
  cht: "港澳台服"
}

/** 星铁命令前缀：各种叫法都收，连写（`**`、`星铁星铁`）也认 */
const SR_PREFIX_RE = /^#?(\*|星铁|星轨|穹轨|星穹|崩铁|星穹铁道|崩坏星穹铁道|铁道)+/

/** 绝区零命令前缀：全角 `％` 也收 */
const ZZZ_PREFIX_RE = /^#?(%|％|绝区零|绝区)+/

/** uid 的形态：纯数字，8~10 位 */
const UID_RE = /^[1-9][0-9]{7,9}$/

/**
 * 判断 uid 的区服归类
 *
 * uid 的形态是"区服前缀 + 8 位序号"，故只看去掉末 8 位之后剩下的那一段；前缀表未命中即官服。
 * @param uid 游戏 uid
 * @param game 游戏
 * @returns 区服归类
 */
export function resolveRegionKind(uid: string | number, game: GameKey): RegionKind {
  const text = String(uid)
  // 绝区零国服 uid 不足 10 位，不存在前缀
  if (game === "zzz" && text.length < 10) return "official"
  const prefix = text.slice(0, -8)
  const table = game === "zzz" ? ZZZ_PREFIX : CLASSIC_PREFIX
  return table[prefix] ?? "official"
}

/**
 * 取米游社接口需要的区服标识
 * @param uid 游戏 uid
 * @param game 游戏
 * @returns 区服标识，如 `cn_gf01`
 */
export function getServer(uid: string | number, game: GameKey): string {
  return REGION_TABLE[game][resolveRegionKind(uid, game)]
}

/**
 * 是不是国服区服
 *
 * `cn_` 与 `_cn` 两种形态都认：三个游戏的国服标识形态不同（`cn_gf01` / `prod_gf_cn`），
 * 而它决定接口域名、DS 盐与客户端版本三项。
 * @param server 区服标识
 * @returns 国服时为真
 */
export function isCnServer(server: string): boolean {
  return /cn_|_cn/.test(server)
}

/**
 * 拼 `game_biz`
 * @param game 游戏
 * @param cn 是否国服
 * @returns 如 `hk4e_cn`
 */
export function gameBiz(game: GameKey, cn: boolean): string {
  return `${BIZ_PREFIX[game]}_${cn ? "cn" : "global"}`
}

/**
 * uid 形态是否合法
 *
 * 只拦明显不合规的输入，不做精确校验：米游社会随时启用新的 uid 段。
 * @param uid 待校验的 uid
 * @returns 合法时为真
 */
export function isValidUid(uid: string | number): boolean {
  return UID_RE.test(String(uid))
}

/**
 * 消息里夹着的 uid：前后都不挨着数字的 8~10 位数字串，与 {@link isValidUid} 同口径
 *
 * 两侧要用环视卡住：只写 `\d{8}` 一类会把 10 位国际服 uid 截成 9 位、认不出绝区零的 8 位 uid。
 */
export const UID_IN_TEXT = /(?<!\d)[1-9]\d{7,9}(?!\d)/

/**
 * 从消息里取第一个 uid
 * @param text 消息
 * @returns uid；没有时 undefined
 */
export function uidInText(text: string): string | undefined {
  return UID_IN_TEXT.exec(text)?.[0]
}

/**
 * 去掉消息里所有的 uid，剩下的交给认名字
 * @param text 消息
 * @returns 去掉 uid 后的消息
 */
export function stripUids(text: string): string {
  return text.replace(new RegExp(UID_IN_TEXT.source, "g"), "")
}

/** 从消息里认出的游戏 */
export interface GamePrefix {
  /** 认出的游戏 */
  game: GameKey
  /** 去除游戏前缀并补回规范前缀后的消息 */
  text: string
  /** 是否确实携带前缀（未携带时 game 为默认值） */
  matched: boolean
}

/**
 * 从消息前缀认出游戏
 *
 * 把 `*体力` 规整成 `#星铁体力`、`%体力` 规整成 `#绝区零体力`，故命令只需注册一种形态。
 * @param text 原始消息
 * @param fallback 不存在前缀时按哪个游戏判定，默认原神
 * @returns 游戏与规整后的消息
 */
export function detectGame(text: string, fallback: GameKey = "gs"): GamePrefix {
  if (SR_PREFIX_RE.test(text)) {
    return { game: "sr", text: text.replace(SR_PREFIX_RE, "#星铁"), matched: true }
  }
  if (ZZZ_PREFIX_RE.test(text)) {
    return { game: "zzz", text: text.replace(ZZZ_PREFIX_RE, "#绝区零"), matched: true }
  }
  return { game: fallback, text, matched: false }
}
