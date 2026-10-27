/**
 * 模块职责：账号总览命令 —— `#信息` 与 `#角色列表`
 * 依赖方向：依赖 session / text / views/profile / views/gs/player / views/avatar-list / views/zzz/card、
 *          commands/_cards 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：两条命令共用取数（都读 index），分头装数据：`#角色列表` 另要把面板库里的
 *          武器、天赋与圣遗物贴到每个格子上。
 *
 *          `#信息` 三个游戏同一张 `profile`。页头背景星铁绝区零就在 index 里；原神 index 不给，取战绩页
 *          文案表里的 `header_bg`（不带 CK、一天一次），取不到只是没有背景。
 *          `#角色列表` 原神与星铁走 `character/avatar-list`，绝区零走 `avatars.html`（没有探索与宝箱两块），
 *          三者的角色格是同一张 `common/avatar-card`。**绝区零的头像只能按 id 查元数据**：`index` 不带头像，
 *          它的 `group_icon_path` 是阵营徽记 —— 拿来当头像就是一排云岿山、狡兔屋的牌子。
 */
import type { Session } from "../core/session.js"
import { uidInText } from "../core/region.js"
import { failText } from "../core/text.js"
import { isSelfCalcGame } from "../panel/profile/index.js"
import { avatarListData } from "../views/avatar-list.js"
import type { PlayerIndexRaw } from "../views/gs/index.js"
import { exploreCards } from "../views/gs/index.js"
import type { IndexRaw, ProfileView } from "../views/profile.js"
import { buildProfile, profileText } from "../views/profile.js"
import { zzzPlaceholderCard } from "../views/zzz/card.js"
import { avatarCardMap, loadPanels, zzzAvatarCardMap } from "./_cards.js"
import type { MhyDeps } from "./deps.js"

/**
 * 消息里写了 uid 时查那一个，否则查当前绑定的
 *
 * 只是换个查询目标：选 CK 仍只认发起者本人绑定、且覆盖这个 uid 的那条，别人的 uid 查不到。
 * @param s 会话
 * @returns 传给 `mys.query` 的 uid 一项
 */
function uidOpt(s: Session): { uid?: string } {
  const uid = uidInText(s.rest)
  return uid ? { uid } : {}
}

/** 卡片上放得下的角色个数：恰好排满一行角色卡，多一张就独占第二行 */
const CARD_AVATARS = 7

/**
 * 绝区零要的那条「按 id 取元数据头像」
 *
 * **只给绝区零**：它的 `index` 不带代理人头像（只有阵营徽记），原神星铁那份接口地址是对的、不必换。
 * @param s 会话
 * @param deps 依赖
 * @returns 可直接展开进上下文的一个片段
 */
function faceOfCtx(s: Session, deps: MhyDeps): { faceOf?: (id: string) => string } {
  const loader = deps.meta?.loader
  if (s.game !== "zzz" || !loader) return {}
  return { faceOf: (id: string): string => loader.byId("zzz", id)?.face ?? "" }
}

/**
 * `%角色列表` —— 绝区零那一路：每位代理人一张整卡，面板库里没有的退回占位卡
 * @param s 会话
 * @param deps 依赖
 */
async function zzzAvatarList(s: Session, deps: MhyDeps): Promise<void> {
  const res = await deps.mys.query<IndexRaw>("index", { user: s.user, game: s.game, ...uidOpt(s) })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const view = buildProfile(res.data, { game: "zzz", uid: res.uid, name: s.name, ...faceOfCtx(s, deps) })
  const built = await zzzAvatarCardMap(deps, s.user, res.uid)
  // 次序照 buildProfile 排好的（稀有度 → 等级 → 影画）；接口的等级与影画比面板库新，占位卡用接口那份
  const cards = view.avatars.map(
    a =>
      built[a.id] ??
      zzzPlaceholderCard({ id: a.id, name: a.name, star: a.rarity || 4, level: a.level, cons: a.cons, face: a.icon ?? "" })
  )
  const noPanel = cards.some(c => c.tals.length === 0)
  if (await s.image("avatars", { ...view, cards, noPanel })) return
  await s.text(profileText(view))
}

/**
 * 取一次 index 并出图 / 回文字
 * @param s 会话
 * @param deps 依赖
 * @param limit 角色简表上限，不传就是全要
 * @param template 模板名
 */
async function show(s: Session, deps: MhyDeps, limit: number | undefined, template: string): Promise<void> {
  const res = await deps.mys.query<IndexRaw>("index", {
    user: s.user,
    game: s.game,
    ...uidOpt(s)
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const view = buildProfile(res.data, { game: s.game, uid: res.uid, name: s.name, limit, ...faceOfCtx(s, deps) })
  if (s.game === "gs") {
    const bg = await gsBackground(deps)
    if (bg) view.bg = bg
    view.areas = exploreCards(res.data as PlayerIndexRaw)
  }
  if (await s.image(template, { ...view, cards: await briefCards(s, deps, res.data, res.uid, view.avatars) })) return
  await s.text(profileText(view))
}

/**
 * 常用角色那几格换成与 `#角色列表` 同一张整卡（天赋、武器、套装）
 *
 * 次序照视图层排好的那份；面板库里没有的原神星铁角色由 `buildAvatarCards` 给只有头像的壳，绝区零给占位卡。
 * @param s 会话
 * @param deps 依赖
 * @param raw index 返回
 * @param uid 游戏 uid
 * @param avatars 视图层排好、截好的角色
 * @returns 整卡，与 `avatars` 一一对应
 */
async function briefCards(
  s: Session,
  deps: MhyDeps,
  raw: IndexRaw,
  uid: string,
  avatars: ProfileView["avatars"]
): Promise<unknown[]> {
  if (s.game === "zzz") {
    const built = await zzzAvatarCardMap(deps, s.user, uid)
    return avatars.map(
      a => built[a.id] ?? zzzPlaceholderCard({ id: a.id, name: a.name, star: a.rarity || 4, level: a.level, cons: a.cons, face: a.icon ?? "" })
    )
  }
  if (!isSelfCalcGame(s.game)) return []
  const built = await avatarCardMap(deps, s.user, s.game, raw, uid)
  return avatars.map(a => built[a.id]).filter(card => card !== undefined)
}

/** 原神战绩页的文案表：页头背景是其中的 `header_bg`，随版本换图 */
const GS_MI18N = "https://fastcdn.mihoyo.com/mi18n/hk4e_cn/m20240919hy3a2yr11c/m20240919hy3a2yr11c-zh-cn.json"

/** 文案表一天取一次：图随版本换，没必要每张图都打一遍 */
const BG_TTL = 24 * 60 * 60 * 1000

/** 上一次取到的背景与时刻 */
let gsBg: { url: string; at: number } | undefined

/**
 * 原神的页头背景：index 不给，取战绩页文案表里的 `header_bg`（官方页本身就是这么取的）
 *
 * 不经米游社查询、不带 CK。失败不影响出图，只是页头没有背景。
 * @param deps 依赖
 * @returns 图片地址；取不到时 undefined
 */
async function gsBackground(deps: MhyDeps): Promise<string | undefined> {
  if (gsBg && Date.now() - gsBg.at < BG_TTL) return gsBg.url
  try {
    const table = await deps.http?.get<Record<string, unknown>>(GS_MI18N, { timeout: 5000 })
    const url = table?.["header_bg"]
    if (typeof url !== "string" || !/^https:\/\//.test(url)) return gsBg?.url
    // 原图是 750×1170 的 png，让 oss 转成 webp 再给，体积小一个量级
    const webp = `${url}?x-oss-process=image/quality,Q_75/format,webp`
    gsBg = { url: webp, at: Date.now() }
    return webp
  } catch {
    return gsBg?.url
  }
}

/**
 * `#信息` —— 账号卡片
 * @param s 会话
 * @param deps 依赖
 */
export async function profileCard(s: Session, deps: MhyDeps): Promise<void> {
  await show(s, deps, CARD_AVATARS, "profile")
}

/**
 * `#角色列表` —— 全部角色
 * @param s 会话
 * @param deps 依赖
 */
export async function avatarList(s: Session, deps: MhyDeps): Promise<void> {
  // 判据是这张图的形态而非有没有元数据包：今天两件事恰好同一个集合，故借 `isSelfCalcGame` 收窄
  if (!isSelfCalcGame(s.game)) {
    await zzzAvatarList(s, deps)
    return
  }
  const game = s.game

  const res = await deps.mys.query<IndexRaw>("index", {
    user: s.user,
    game: s.game,
    ...uidOpt(s)
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const view = buildProfile(res.data, { game, uid: res.uid, name: s.name })
  const loader = deps.meta?.loader
  const { panels, at } = await loadPanels(deps, s.user, game, res.uid)
  const owned = await deps.cookies.owned(s.user)

  const data = avatarListData(res.data, {
    game,
    uid: res.uid,
    name: s.name,
    panels,
    ...(loader ? { meta: loader, exists: (rel: string): boolean => loader.exists(rel) } : {}),
    isSelfCookie: owned.some(one => one.ltuid === res.ltuid),
    ...(at === undefined ? {} : { profileAt: at })
  })
  if (await s.image("character/avatar-list", data)) return
  await s.text(profileText(view))
}
