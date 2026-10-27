/**
 * 模块职责：按 `index` 返回 + 面板库造「角色 id → 头像卡」—— 战绩图与角色列表共用这一份造法，连同读面板库那一步
 * 依赖方向：依赖 views/avatar-list 的 buildAvatarCards、views/zzz/card；经 deps 读面板库与元数据；不依赖别的命令文件
 * 生命周期：无状态函数
 * 注意事项：天赋 / 武器 / 圣遗物只有面板库有、接口不给；面板库里没有的角色退回接口那份基础数据
 *          （见 {@link buildAvatarCards}）。调用方把已取到的 index 返回传进来，不在此另发请求。
 */
import type { BuiltPanel } from "../panel/build.js"
import type { SelfCalcGame } from "../panel/profile/index.js"
import { isPanelReady, type StoredAvatar } from "../store/panel.js"
import type { AvatarCardView } from "../views/avatar-list.js"
import { buildAvatarCards } from "../views/avatar-list.js"
import type { IndexRaw } from "../views/profile.js"
import type { ZzzAvatarCardView } from "../views/zzz/card.js"
import { buildZzzCard } from "../views/zzz/card.js"
import type { MhyDeps } from "./deps.js"

/**
 * 装好这个 uid 名下已有的面板
 *
 * 取不到（没装元数据、没更新过面板）时返回空数组，图照样出得来。
 * **只读发起者自己名下的那份**（面板库按用户分键），别人更新过同一 uid 也读不到。
 * @param deps 依赖
 * @param user 发起者
 * @param game 游戏
 * @param uid uid
 * @returns 装好的面板、面板数据的更新时刻与库里存的昵称
 */
export async function loadPanels(
  deps: MhyDeps,
  user: string,
  game: SelfCalcGame,
  uid: string
): Promise<{ panels: BuiltPanel[]; at?: number; name?: string }> {
  const store = deps.panels
  const builder = deps.panelBuilder
  if (!store || !builder || !builder.ready(game)) return { panels: [] }

  const player = await store.of(user).load(game, uid)
  const panels = Object.entries(player.avatars)
    .filter(([, one]) => isPanelReady(one, game))
    .map(([, one]) => builder.build(game, uid, one as StoredAvatar))
    .filter((it): it is BuiltPanel => !!it)
  return {
    panels,
    ...(player.profileAt === undefined ? {} : { at: player.profileAt }),
    ...(player.name === undefined || player.name === "" ? {} : { name: player.name })
  }
}

/**
 * index 返回 + 面板库 → 角色 id → 头像卡
 * @param deps 依赖，用其面板库与元数据
 * @param user 发起者，只读他名下的面板
 * @param game 游戏
 * @param raw 已取到的 index 接口返回
 * @param uid 游戏 uid，用于取面板库里这个人的角色
 * @returns 角色 id → 头像卡
 */
export async function avatarCardMap(
  deps: MhyDeps,
  user: string,
  game: SelfCalcGame,
  raw: IndexRaw,
  uid: string
): Promise<Record<string, AvatarCardView>> {
  const { panels } = await loadPanels(deps, user, game, uid)
  const loader = deps.meta?.loader
  const built = buildAvatarCards(raw, {
    game,
    ...(panels.length ? { panels } : {}),
    ...(loader ? { meta: loader, exists: (rel: string): boolean => loader.exists(rel) } : {})
  })
  const out: Record<string, AvatarCardView> = {}
  for (const card of built) out[card.id] = card
  return out
}

/**
 * 绝区零面板库 → 代理人 id → 战绩卡
 *
 * 直接读绝区零面板库（`#绝区零更新面板` 存下的那份），逐位造卡。战绩接口不给养成，故这是唯一来源；
 * 面板库里没有的代理人由战绩命令按 id 退回占位卡（不在此处理）。
 * @param deps 依赖，用其面板库与元数据
 * @param user 发起者，只读他名下的面板
 * @param uid 游戏 uid
 * @returns 代理人 id → 战绩卡
 */
export async function zzzAvatarCardMap(
  deps: MhyDeps,
  user: string,
  uid: string
): Promise<Record<string, ZzzAvatarCardView>> {
  const store = deps.panels
  if (!store) return {}
  const player = await store.of(user).load("zzz", uid)
  const loader = deps.meta?.loader
  const out: Record<string, ZzzAvatarCardView> = {}
  for (const one of Object.values(player.avatars)) {
    const card = buildZzzCard(one, {
      ...(loader ? { meta: loader, exists: (rel: string): boolean => loader.exists(rel) } : {})
    })
    if (card) out[card.id] = card
  }
  return out
}
