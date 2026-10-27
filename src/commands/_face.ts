/**
 * 模块职责：页头那一格的取数与组装 —— 落头像、记固定信息、造 {@link WhoView}
 * 依赖方向：依赖 store/face 与 views/who；经 deps 发米游社请求
 * 生命周期：无状态函数
 * 注意事项：{@link whoOf} **不发请求**、只读 kv：它被每张图的页头调用，发请求等于每条命令都多打一次米游社。
 *          头像字段三游戏不同名（原神 `role.game_head_icon`，星铁绝区零 `cur_head_icon_url`），取错则恒为默认图。
 *          落头像失败不影响本次出图。
 */
import type { GameKey } from "../core/region.js"
import type { PanelProfile } from "../panel/profile/index.js"
import type { WhoView } from "../views/who.js"
import { buildWho } from "../views/who.js"
import { traceNote } from "../core/trace.js"
import type { MhyDeps } from "./deps.js"

/** `index` 返回里与玩家本人有关的那几项，三游戏的并集 */
interface IndexPlayerRaw {
  /** 原神：账号信息 */
  role?: {
    /** 游戏内昵称 */
    nickname?: string
    /** 冒险等阶 */
    level?: number
    /** 头像完整地址 */
    game_head_icon?: string
  }
  /** 星铁与绝区零：头像完整地址 */
  cur_head_icon_url?: string
}

/**
 * 从 `index` 返回里取头像地址
 * @param raw 接口返回的 data
 * @returns 完整地址；没给时 undefined
 */
export function faceUrlOf(raw: unknown): string | undefined {
  const bag = raw as IndexPlayerRaw | null
  return bag?.role?.game_head_icon || bag?.cur_head_icon_url || undefined
}

/**
 * 把一次 `index` 返回里的头像与账号信息落进本地
 *
 * 已经打过 `index` 的命令顺手调它，不另发请求。
 * @param deps 依赖
 * @param game 游戏
 * @param uid uid
 * @param raw 接口返回的 data
 */
export async function saveIndexInfo(deps: MhyDeps, game: GameKey, uid: string, raw: unknown): Promise<void> {
  const faces = deps.faces
  if (!faces || !uid) return
  await faces.saveMys(game, uid, faceUrlOf(raw))

  // 昵称与等级只有原神的 index 给（在 `role` 下），另两个游戏由绑定接口与展柜带回
  const role = (raw as IndexPlayerRaw | null)?.role
  const level = Number(role?.level) || 0
  if (role?.nickname || level > 0) {
    await faces.merge(game, uid, {
      ...(role?.nickname ? { name: role.nickname } : {}),
      ...(level > 0 ? { level } : {})
    })
  }
}

/**
 * 打一次 `index` 把头像与账号信息补齐
 *
 * 不只在绑定时调（`#米游社更新面板` 等也调）：头像会变，只在绑定时取则换了头像的人永远是旧的那张。
 * @param deps 依赖
 * @param user 发起者
 * @param game 游戏
 * @param uid uid
 */
export async function syncIndexInfo(deps: MhyDeps, user: string, game: GameKey, uid: string): Promise<void> {
  if (!deps.faces || !uid) return
  try {
    const res = await deps.mys.query<unknown>("index", { user, uid, game })
    if (res.ok) await saveIndexInfo(deps, game, uid, res.data)
    else deps.logger.debug(`[米游社][头像] ${game} ${uid} 的 index 没取到（${res.kind}），头像不更新`)
  } catch (err) {
    deps.logger.debug(`[米游社][头像] ${game} ${uid} 取账号信息失败：${String(err)}`)
  }
}

/**
 * 把一次面板更新带回的头像与账号信息落进本地
 *
 * 头像按「头像 id → 时装 id → 角色 id」依次查 pfps 索引（后两者是原神拿角色当头像，由镜像并进索引），
 * 一个都取不到就不动已有那张。
 * @param deps 依赖
 * @param profile 这次带回来的面板
 */
export async function savePanelFace(deps: MhyDeps, profile: PanelProfile): Promise<void> {
  const faces = deps.faces
  if (!faces) return
  const { game, uid } = profile
  if (!uid) return

  const level = Number(profile.level) || 0
  const world = Number(profile.word) || 0
  if (profile.name || level > 0 || world > 0) {
    await faces.merge(game, uid, {
      ...(profile.name ? { name: profile.name } : {}),
      ...(level > 0 ? { level } : {}),
      ...(world > 0 ? { world } : {})
    })
  }

  const keys: (string | number)[] = []
  if (profile.pfp !== undefined) keys.push(profile.pfp)
  // 时装优先：玩家把穿着时装的那个角色设成头像时，游戏里显示的就是时装那张
  if (profile.pfpCostume !== undefined) keys.push(profile.pfpCostume)
  if (profile.face !== undefined) keys.push(profile.face)
  for (const key of keys) {
    if (await faces.saveEnka(game, uid, key)) {
      traceNote(`头像取自展柜 ${key}`)
      return
    }
  }
  traceNote(keys.length ? `展柜头像 ${keys.join("/")} 都没取到` : "展柜没给头像标识")
}

/**
 * 读本地造页头那一格
 *
 * **只读本地**，理由见文件头。uid 为空时仍给一格（默认头像 + 该游戏的称呼），故不属某个玩家的
 * 图（帮助、图鉴）由调用方自己决定要不要画。
 * @param deps 依赖
 * @param game 游戏
 * @param uid uid
 * @returns 页头那一格
 */
export async function whoOf(deps: MhyDeps, game: GameKey, uid: string): Promise<WhoView> {
  const got = deps.faces ? await deps.faces.info(game, uid) : {}
  const face = deps.faces ? await deps.faces.pick(game, uid) : undefined
  return buildWho({
    game,
    ...(uid ? { uid } : {}),
    ...(face ? { face } : {}),
    ...(got.name ? { name: got.name } : {}),
    ...(got.level ? { level: got.level } : {}),
    ...(got.world ? { world: got.world } : {})
  })
}
