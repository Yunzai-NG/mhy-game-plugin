/**
 * 模块职责：uid 列表（`#我的uid`）的视图模型，三个游戏各一段、顺序固定
 * 依赖方向：依赖 core/region、core/text 与 views/who；被命令层调用，不碰 IO
 * 生命周期：无状态纯函数
 * 注意事项：uid 分两种来源：绑 CK 自动记下的（`ck`，可查私有数据）与手工绑定的（`reg`，只查公开
 *          数据），模板据此打不同标记。头像走头像库（见 store/face.ts），取不到时垫该游戏的默认头像。
 *          横幅由调用方按 uid 给出，模板按 `meta-` 前缀决定资源根，前缀错了图是空白而不报错。
 */
import type { GameKey } from "../core/region.js"
import { COMMAND_PREFIX, GAME_KEYS, GAME_NAMES, REGION_NAMES, resolveRegionKind } from "../core/region.js"
import { INDENT } from "../core/text.js"
import { buildWho } from "./who.js"

/** uid 的来源 */
export type UidKind = "ck" | "reg"

/** 该 uid 查询时用的设备 */
export type UidDevice = "bound" | "virtual"

/** 列表里的一个 uid */
export interface UidEntry {
  /** 游戏 uid */
  uid: string
  /** 来源：绑 CK 时自动记下的，还是手工绑的 */
  type: UidKind
  /** 区服中文名 */
  region: string
  /** 是否为当前生效的 uid */
  active: boolean
  /** 游戏内昵称，仅在有 CK 且查过账号信息时存在 */
  name?: string
  /** 等级 */
  level?: number
  /** 玩家头像，根由 {@link fromFace} / {@link fromRes} 指出 */
  face?: string
  /** 头像在头像库里，模板拼 `_face_path` */
  fromFace?: boolean
  /** 头像是插件自带的默认图，模板拼 `_res_path` */
  fromRes?: boolean
  /** 横幅底图，`meta-` 前缀者在元数据里，否则在插件资源里 */
  banner?: string
  /**
   * 查这个 uid 时用的设备
   *
   * 只对有 CK 的 uid 有意义（设备是绑 CK 时分配的），故手工绑的那些不给这个键。
   */
  device?: UidDevice
  /**
   * 绝区零专用：改用插件自带的横幅
   *
   * **对绝区零恒为真**：其元数据里没有逐角色横幅，一律用插件自带的 `zzz/other/banner.png`。
   */
  zzz_banner?: boolean
}

/** 一个游戏的 uid 段 */
export interface UidGameSection {
  /** 游戏 */
  key: GameKey
  /** 游戏中文名 */
  name: string
  /** 该游戏的命令前缀 */
  mark: string
  /** 当前生效的 uid */
  uid?: string
  /** 全部 uid */
  uidList: UidEntry[]
}

/** uid 列表视图 */
export interface UidListView {
  /** 三个游戏各一段，顺序即展示顺序 */
  uids: UidGameSection[]
}

/** 造视图所需的一个游戏的原始绑定情况 */
export interface UidGameInput {
  /** 该游戏绑定的全部 uid，首项为当前 uid */
  uids: readonly string[]
  /** 其中来自 CK 的那些 */
  ckUids?: readonly string[]
  /**
   * uid → 玩家信息
   *
   * 昵称与等级绑了 CK 或更新过面板才可能有；头像与横幅取自面板库里记下的那个角色，
   * 缺省值由本层补上。
   */
  info?: Readonly<Record<string, { name?: string; level?: number; face?: string; banner?: string }>>
  /**
   * 其中查询时走绑定真机的那些
   *
   * 设备以米游社账号为单位而非 uid，故这一项由命令层按 uid → CK → ltuid 折算过再传进来。
   */
  deviceUids?: readonly string[]
}

/** 造视图所需的全部绑定情况 */
export type UidListInput = Partial<Record<GameKey, UidGameInput>>

/**
 * 绑定情况 → uid 列表视图
 * @param input 各游戏的绑定情况
 * @returns 视图
 */
export function buildUidList(input: UidListInput): UidListView {
  return {
    uids: GAME_KEYS.map(key => {
      const one = input[key]
      const list = one?.uids ?? []
      const ck = new Set(one?.ckUids ?? [])
      const bound = new Set(one?.deviceUids ?? [])
      const section: UidGameSection = {
        key,
        name: GAME_NAMES[key],
        mark: COMMAND_PREFIX[key],
        uidList: list.map((uid, index) => {
          const entry: UidEntry = {
            uid,
            type: ck.has(uid) ? "ck" : "reg",
            region: REGION_NAMES[resolveRegionKind(uid, key)],
            active: index === 0
          }
          // 设备随 CK 分配，故只有 CK 那一类有设备可言；手工绑的 uid 查的是公开数据、不带设备
          if (ck.has(uid)) entry.device = bound.has(uid) ? "bound" : "virtual"
          const info = one?.info?.[uid]
          if (info?.name) entry.name = info.name
          if (info?.level !== undefined) entry.level = info.level

          // 头像与各页页头同一条路：头像库取到就用，取不到垫该游戏的默认图
          const who = buildWho({ game: key, ...(info?.face ? { face: info.face } : {}) })
          entry.face = who.face
          if (who.fromFace) entry.fromFace = true
          if (who.fromRes) entry.fromRes = true

          if (key === "zzz") {
            // 绝区零的横幅一律用插件自带那张：元数据里没有逐代理人横幅
            entry.zzz_banner = true
          } else {
            // 公用横幅在元数据里；没装元数据时那张图取不到，浏览器只是不画，底色仍在
            entry.banner = info?.banner ?? `meta-${key}/character/common/imgs/banner.webp`
          }
          return entry
        })
      }
      const current = list[0]
      if (current) section.uid = current
      return section
    })
  }
}

/**
 * uid 列表视图 → 纯文字
 *
 * 未装渲染器时使用者拿到的就是这段，须自成完整答案：每游戏一段、标出当前生效那个与来源；全没绑时给绑定命令而非「无数据」。
 * @param view 视图
 * @returns 多行文本
 */
export function uidListText(view: UidListView): string {
  const parts: string[] = []
  for (const game of view.uids) {
    if (!game.uidList.length) continue
    parts.push(
      [
        `【${game.name}】`,
        ...game.uidList.map((it, index) => {
          const flag = it.active ? `${INDENT}← 当前使用` : ""
          const kind = it.type === "ck" ? "CK" : "绑定"
          const who = it.name ? `${INDENT}${it.name}${it.level ? ` Lv.${it.level}` : ""}` : ""
          return `${index + 1}. ${it.uid}（${it.region}·${kind}）${who}${flag}`
        })
      ].join("\n")
    )
  }
  if (!parts.length) return "还没有绑定任何 uid，请发送「#绑定uid100000001」或私聊发送「#绑定CK」"
  return [...parts, "「#切换uid2」切换，「#删除uid2」删除"].join("\n")
}
