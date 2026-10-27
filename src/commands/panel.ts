/**
 * 模块职责：面板命令 —— `#面板列表` / `#更新面板` / `#角色面板` / `#圣遗物` / `#练度统计` 等
 * 依赖方向：依赖 session、命令层依赖包与 views/panel；取数与装配都在服务层
 * 生命周期：无状态函数
 * 注意事项：**每条命令都得先判元数据在不在**：算属性与评分要它（等级曲线、词条元数据、
 *          套装名），缺它时给一句"先发 #更新元数据"而不是出一张每项都是 0 的图。
 *
 *          **`#面板` 一词已被账号卡片占用**，故此处用 `#面板列表`；单角色面板走
 *          `#<角色名>面板`，由 {@link charPanel} 从 rest 里认角色名。
 *
 *          **取数与落库分开**：{@link refreshPanel} 取数后并进库，其余命令只读库。
 *
 *          更新与查看出的是同一张图，差别在数据：更新那一次把 {@link RefreshMark} 传进
 *          {@link panelList}，图上多一句提示、那些角色打标记排到最前。**更新后不另回文字。**
 *
 *          **绝区零在每条命令的第一行分派出去**，那一路整个在 commands/zzz/panel.ts 里。
 */
import { failText, UNRELEASED_TEXT } from "../core/text.js"
import { COMMAND_PREFIX, DEMO_CHARS, GAME_KEYS, GAME_NAMES, GEAR_NAMES, SHORT_PREFIX, stripUids, uidInText } from "../core/region.js"
import type { Session } from "../core/session.js"
import type { BuiltPanel } from "../panel/build.js"
import { isReleased } from "../meta/loader.js"
import { elemName, elemOf } from "../meta/elem.js"
import { travelerElemOf } from "../meta/traveler.js"
import { isSuperPanel, splashDirName } from "../panel/img.js"
import { isSelfCalcGame, unfoldCons, type SelfCalcGame, type PanelGame } from "../panel/profile/index.js"
import { profileFailText } from "../panel/serv/types.js"
import type { RefreshMark, StoredAvatar } from "../store/panel.js"
import { hasAvatarData, isPanelReady } from "../store/panel.js"
import { savePanelFace, syncIndexInfo } from "./_face.js"
import { dmgMissText, panelDmg } from "./_dmg.js"
import { submitRank, topRankTarget } from "./rank.js"
import {
  artiImg,
  artisListData,
  panelListText,
  panelStatData,
  panelStatText,
  panelText,
  profileDetailData,
  profileListData
} from "../views/panel.js"
import type { PanelListOptions, PanelTemplateData, StatCharacterItem } from "../views/panel.js"
import type { RankType } from "../panel/rank.js"

import { dmgText } from "../views/dmg.js"
import type { OriginalKind } from "../store/original.js"
import { originalPathOf, rememberOriginal } from "./original.js"
import {
  zzzArtisEntry,
  zzzArtisList,
  zzzCharArtis,
  zzzCharDmg,
  zzzCharPanel,
  zzzPanelEntry,
  zzzPanelList,
  zzzPanelStat,
  zzzRefreshPanel,
  zzzTopPanel
} from "./zzz/index.js"
import type { MhyDeps } from "./deps.js"


/** 面板列表角标认的两维（见 {@link listRanks}） */
const LIST_RANK_TYPES: readonly RankType[] = ["dmg", "mark"]

/** 圣遗物列表最多显示几件；由配置覆盖 */
const ARTIS_LIMIT = 28

/**
 * 判本条会话是否在「面板要算出来」的游戏上
 * @param s 会话
 * @returns 游戏；绝区零时 undefined
 */
function panelGame(s: Session): SelfCalcGame | undefined {
  return isSelfCalcGame(s.game) ? s.game : undefined
}

/**
 * 取本次要查的 uid —— 消息里带 uid 就用它（可以查别人），否则用自己绑的
 * @param s 会话
 * @param deps 依赖
 * @param game 游戏
 * @returns uid；取不到时 undefined
 */
async function targetUid(s: Session, deps: MhyDeps, game: PanelGame): Promise<string | undefined> {
  const inMsg = uidInText(s.rest)
  if (inMsg) return inMsg
  const bound = await deps.users.uid(s.user, game)
  return bound || undefined
}

/**
 * 元数据不够用时的提示
 * @param s 会话
 * @param deps 依赖
 * @param game 游戏
 * @returns 元数据够用时为真
 */
async function needMeta(s: Session, deps: MhyDeps, game: SelfCalcGame): Promise<boolean> {
  if (deps.panelBuilder?.ready(game)) return true
  await s.text("面板计算需要元数据（角色等级曲线与词条表都在里面），请先让主人发送 #更新元数据")
  return false
}

/**
 * 取图标回落用的存在性判据
 *
 * 图标按"变体在就用变体、不在就回落到基础图"取（见 views/panel.ts 的 `charImgs`），
 * 不判存在性会让没有时装 / 小头像的角色那一格指向 404。
 * @param deps 依赖
 * @returns 可直接展开进视图选项的一个片段；没有元数据时为空对象
 */
function metaExists(deps: MhyDeps): { exists?: (rel: string) => boolean } {
  const loader = deps.meta?.loader
  return loader ? { exists: (rel: string): boolean => loader.exists(rel) } : {}
}

/**
 * 挑一张使用者上传的面板图
 *
 * 练满的角色先看 `super-character/`，否则只看 `normal-character/`；一张都没有时返回空对象，
 * 视图层回落到元数据里的立绘。`enableCustomSplash` 关掉时一张都不挑。
 * @param deps 依赖
 * @param panel 装好的面板
 * @returns 可展开进视图选项的片段
 */
function uploadedSplash(deps: MhyDeps, panel: BuiltPanel): { splash?: string; splashUpload?: boolean } {
  const store = deps.panelImgs
  if (!store) return {}
  if (!deps.config().enableCustomSplash) return {}
  const superFirst = isSuperPanel({
    game: panel.game,
    cons: panel.cons,
    talent: panel.talent,
    trees: panel.trees,
    ...(panel.mark?.markClass ? { markClass: panel.mark.markClass } : {})
  })
  const got = store.pick(splashDirName(panel.name, deps.config().srSharedSplashDir), superFirst)
  // `splashUpload` 决定模板用哪个根：上传的在 `_panel_path` 下，元数据的在 `_meta_path` 下
  return got ? { splash: got, splashUpload: true } : {}
}

/**
 * 记一个 uid 的排名资格
 *
 * **不记就等于把排名限制调成"谁都不许上榜"**：第 2~5 档要凭这份信息放行（见 panel/rank.ts 的
 * `allowRank`），没有它时那四档一律判不通过，表现为排行永远是空的。`uidType` 看发起者名下
 * 有没有覆盖这个 uid 的 CK —— 与面板那条取数路同一判据，不回落到他的其他 CK。
 * @param deps 依赖
 * @param s 会话
 * @param game 游戏
 * @param uid uid
 * @param names 有面板数据的角色名
 */
export async function markRankUid(
  deps: MhyDeps,
  s: Session,
  game: PanelGame,
  uid: string,
  names: readonly string[]
): Promise<void> {
  const ranks = deps.ranks
  if (!ranks) return
  const ck = await deps.cookies.find(uid, game, s.user)
  await ranks.setUidInfo({
    game,
    uid,
    names,
    uidType: ck ? "ck" : "bind",
    user: s.user
  })
}

/**
 * 取面板列表上那一圈排名角标要的数据
 *
 * **只在群里取**：排行按群分组，私聊里那一段整个不画。逐角色问一次名次，取"名次最好的那一维"
 * 作为角标上的维度 —— 四维各画一枚会把角色格挤满。
 * @param deps 依赖
 * @param s 会话
 * @param game 游戏
 * @param uid uid
 * @param charIds 列表上那些角色的 id
 * @returns 视图要的排名上下文；私聊或排行未启用时 undefined
 */
export async function listRanks(
  deps: MhyDeps,
  s: Session,
  game: PanelGame,
  uid: string,
  charIds: readonly string[]
): Promise<PanelListOptions["rank"] | undefined> {
  const ranks = deps.ranks
  const group = s.groupId
  if (!ranks || !group) return undefined
  const cfg = await ranks.groupCfg(group, game)
  if (cfg.status === 1) return undefined

  const out: Record<string, { rank: number; rankType: string }> = {}
  for (const charId of charIds) {
    let best: { rank: number; rankType: string } | undefined
    // 列表上的角标只认伤害与评分两维：双爆、有效词条是评分的细项，挂出来会把评分那一档挤掉
    for (const type of LIST_RANK_TYPES) {
      const got = await ranks.rankOf({ group, game, type, charId, user: s.user, uid })
      if (got && (!best || got.rank < best.rank)) best = { rank: got.rank, rankType: type }
    }
    if (best) out[charId] = best
  }

  return { allow: await ranks.allowRank(game, uid), cfg, ranks: out }
}

/**
 * 没绑 uid 时的提示
 * @param s 会话
 * @returns 恒为 undefined，供调用方 `return` 用
 */
async function askUid(s: Session): Promise<void> {
  // 前缀按本条消息认出的游戏取：写死 `#` 会让星铁与绝区零照抄这句得到一条发不出去的命令
  await s.text(`请先绑定 uid，发送「${COMMAND_PREFIX[s.game]}绑定uid100000001」`)
}

/**
 * 拼一次更新的提示语
 * @param uid uid
 * @param mark 本次更新带回来的东西
 * @returns 一句话
 */
function refreshMsg(uid: string, mark: RefreshMark): string {
  const from = mark.servName ? `，数据来自 ${mark.servName}` : ""
  return `UID${uid} 本次取到 ${mark.updated.length} 个角色（其中 ${mark.changed.length} 个有更新）${from}${mark.note ?? ""}`
}

/**
 * `#面板列表` —— 已有面板数据的角色一览
 * @param s 会话
 * @param deps 依赖
 * @param mark 本次更新带回来的东西；由更新那条命令传入，直接查看时不传
 */
export async function panelList(s: Session, deps: MhyDeps, mark?: RefreshMark): Promise<void> {
  if (s.game === "zzz") {
    await zzzPanelList(s, deps, mark)
    return
  }
  const game = panelGame(s)
  if (!game) return
  const store = deps.panels?.of(s.user)
  const builder = deps.panelBuilder
  if (!store || !builder) {
    await s.text("面板功能未启用")
    return
  }

  const uid = await targetUid(s, deps, game)
  if (!uid) {
    await askUid(s)
    return
  }
  if (!(await needMeta(s, deps, game))) return

  const player = await store.load(game, uid)
  const ids = Object.keys(player.avatars).filter(id => isPanelReady(player.avatars[id], game))
  if (ids.length === 0) {
    await s.text(`暂无 UID${uid} 的面板数据，请先发送「${SHORT_PREFIX[s.game]}更新面板」`)
    return
  }

  const built = ids
    .map(id => builder.build(game, uid, player.avatars[id] as StoredAvatar))
    .filter((it): it is NonNullable<typeof it> => !!it)

  // 本次确实变了的那几位要重算伤害：评分每次都重算（便宜），伤害只在变了或榜上还没有时算
  const changed = new Set(mark?.changed ?? [])
  for (const one of built) await submitRank(deps, s, one, changed.has(one.id))
  await markRankUid(
    deps,
    s,
    game,
    uid,
    built.map(one => one.name)
  )
  const rank = await listRanks(
    deps,
    s,
    game,
    uid,
    built.map(one => one.id)
  )

  const servName = mark?.servName ?? deps.panel?.pick(uid, game).name ?? ""
  const view = profileListData(built, {
    uid,
    game,
    servName,
    ...(mark ? { fresh: mark.updated, changed: mark.changed, msg: refreshMsg(uid, mark) } : {}),
    ...(player.profileAt === undefined ? {} : { at: player.profileAt }),
    ...(rank ? { rank } : {}),
    ...metaExists(deps)
  })
  if (await s.image("character/profile-list", view)) return
  await s.text(mark ? `${refreshMsg(uid, mark)}\n${panelListText(built, uid)}` : panelListText(built, uid))
}

/**
 * `#更新面板` —— `panelUpdateByMys` 开启且该 uid 绑了 Cookie 时走米游社，否则走展柜
 * （原神星铁走面板服务，绝区零走 Enka）
 * @param s 会话
 * @param deps 依赖
 */
export async function refreshPanelEntry(s: Session, deps: MhyDeps): Promise<void> {
  const game: PanelGame | undefined = s.game === "zzz" ? "zzz" : panelGame(s)
  if (!game) return
  // 没绑 Cookie 时米游社那条必然失败，故回落展柜
  if (deps.config().panelUpdateByMys) {
    const uid = await targetUid(s, deps, game)
    if (uid && (await deps.cookies.find(uid, game, s.user))) {
      if (game === "zzz") await zzzRefreshPanel(s, deps, "mys")
      else await mysRefreshPanel(s, deps)
      return
    }
  }
  if (game === "zzz") await zzzRefreshPanel(s, deps, "enka")
  else await refreshPanel(s, deps)
}

/**
 * `#更新面板` —— 向面板服务取一次数据并落库
 * @param s 会话
 * @param deps 依赖
 */
export async function refreshPanel(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    // 这条是「指名走展柜」，故强制 Enka；按配置选会落回米游社、与命令名对不上
    await zzzRefreshPanel(s, deps, "enka")
    return
  }
  const game = panelGame(s)
  if (!game) return
  const store = deps.panels?.of(s.user)
  const serv = deps.panel
  if (!store || !serv) {
    await s.text("面板功能未启用")
    return
  }

  const uid = await targetUid(s, deps, game)
  if (!uid) {
    await askUid(s)
    return
  }

  const cd = await serv.cooldown(s.user, uid)
  if (cd > 0) {
    await s.text(`UID${uid} 的面板刚更新过，请 ${cd} 秒后再试`)
    return
  }

  const got = await serv.fetch(s.user, uid, game)
  if (!got.result.ok) {
    await s.text(profileFailText(got.result, got.serv.name))
    return
  }

  const merged = await store.merge(got.result.profile)
  // 展柜源给的是头像 id，要经 Enka 的 pfps 索引换地址；落不下来只是页头退回默认图
  await savePanelFace(deps, got.result.profile)
  if (merged.updated.length === 0) {
    await s.text(`UID${uid} 的面板未取到任何角色，请确认角色已放进游戏内的角色展柜并打开「显示详情」`)
    return
  }

  await panelList(s, deps, { updated: merged.updated, changed: merged.changed, servName: got.serv.name })
}

/**
 * `#米游社更新面板` —— 用使用者自己的 Cookie 向米游社取一次面板
 *
 * 与 {@link refreshPanel} 的分工：面板服务只取展柜那八个、不要 Cookie；这条取名下全部角色，
 * 要 Cookie 且占查询额度。两份都写进 `artis`，同样能评分、能算伤害。
 * @param s 会话
 * @param deps 依赖
 */
export async function mysRefreshPanel(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    await zzzRefreshPanel(s, deps, "mys")
    return
  }
  const game = panelGame(s)
  if (!game) return
  const store = deps.panels?.of(s.user)
  const serv = deps.panel
  if (!store || !serv) {
    await s.text("面板功能未启用")
    return
  }

  // 消息里写了 uid 就查那一个（refreshPanelEntry 也按它判有没有本人的 CK），否则查当前绑定的
  const want = uidInText(s.rest)
  const got = game === "sr" ? await mysSrAvatars(s, deps, want) : await mysGsAvatars(s, deps, want)
  if (!got) return

  const out = await serv.fetch(s.user, got.uid, game, { fromMys: true, data: got.data })
  if (!out.result.ok) {
    await s.text(profileFailText(out.result, out.serv.name))
    return
  }

  const merged = await store.merge(out.result.profile)
  // 面板接口不给头像，头像只在 index 里，故补打一次；失败只是页头退回默认图
  await syncIndexInfo(deps, s.user, game, got.uid)
  if (merged.updated.length === 0) {
    await s.text(`UID${got.uid} 未从米游社取到任何角色`)
    return
  }
  await panelList(s, deps, { updated: merged.updated, changed: merged.changed, servName: out.serv.name })
}

/**
 * 取米游社原神的全部角色详情
 *
 * 分两步：角色列表定人，再按 id 取详情（详情接口不接受"全部"这种写法）。
 * @param s 会话
 * @param deps 依赖
 * @param uid 要查的 uid；不给时查当前绑定的
 * @returns uid 与详情数据；取不到时 undefined（已回过提示）
 */
async function mysGsAvatars(s: Session, deps: MhyDeps, uid?: string): Promise<{ uid: string; data: unknown } | undefined> {
  const list = await deps.mys.query<{ avatars?: { id?: number | string }[]; list?: { id?: number | string }[] }>(
    "character",
    { user: s.user, game: "gs", ...(uid ? { uid } : {}) }
  )
  if (!list.ok) {
    await s.text(failText(list))
    return undefined
  }
  const ids = (list.data.avatars ?? list.data.list ?? []).map(one => one.id).filter(one => one !== undefined)
  if (ids.length === 0) {
    await s.text("米游社没有返回任何角色，请确认已在米游社完成实名并开启战绩展示")
    return undefined
  }

  const detail = await deps.mys.query<unknown>("characterDetail", {
    user: s.user,
    game: "gs",
    uid: list.uid,
    data: { character_ids: ids }
  })
  if (!detail.ok) {
    await s.text(failText(detail))
    return undefined
  }
  return { uid: detail.uid, data: detail.data }
}

/**
 * 取米游社星铁的全部角色详情
 *
 * 星铁只需一次请求：`avatar/info` 一次给回全部角色的行迹与遗器。
 * @param s 会话
 * @param deps 依赖
 * @param uid 要查的 uid；不给时查当前绑定的
 * @returns uid 与详情数据；取不到时 undefined（已回过提示）
 */
async function mysSrAvatars(s: Session, deps: MhyDeps, uid?: string): Promise<{ uid: string; data: unknown } | undefined> {
  const res = await deps.mys.query<unknown>("avatarInfo", { user: s.user, game: "sr", ...(uid ? { uid } : {}) })
  if (!res.ok) {
    await s.text(failText(res))
    return undefined
  }
  return { uid: res.uid, data: res.data }
}

/**
 * 从 rest 里认出一个角色
 * @param s 会话
 * @param deps 依赖
 * @param game 游戏
 * @param strip 要从 rest 里剥掉的词
 * @returns 角色元数据条目；认不出时 undefined
 */
function pickChar(
  s: Session,
  deps: MhyDeps,
  game: PanelGame,
  strip: RegExp
): { id: string; name: string; eta?: number; elem?: string } | undefined {
  const name = stripUids(s.rest).replace(strip, "").trim()
  if (!name) return undefined
  const got = deps.meta?.loader.byName(game, name)
  if (!got?.id) return undefined
  // 只有「冰主」一类叫法指定了元素；查「空」「荧」不限元素
  const elem = game === "gs" ? travelerElemOf(name) : ""
  return {
    id: got.id,
    name: got.name,
    ...(got.eta === undefined ? {} : { eta: got.eta }),
    ...(elem ? { elem } : {})
  }
}

/**
 * 开拓者 / 旅行者的性别配对 id
 *
 * 别名一律指向规范性别，存档里可能是另一性别；查面板取不到时按此表回退，
 * 否则会出现「有星·欢愉数据却提示暂无穹·欢愉」。
 */
export const GENDER_PAIR: Readonly<Record<string, string>> = {
  "10000005": "10000007",
  "10000007": "10000005",
  "8001": "8002",
  "8002": "8001",
  "8003": "8004",
  "8004": "8003",
  "8005": "8006",
  "8006": "8005",
  "8007": "8008",
  "8008": "8007",
  "8009": "8010",
  "8010": "8009"
}

/**
 * 取一个角色已存的面板，并在缺失时给出提示
 * @param s 会话
 * @param deps 依赖
 * @param game 游戏
 * @param uid uid
 * @param id 角色 id
 * @param charName 角色名
 * @param owner 数据所属使用者；省略时为发起者
 * @param elem 明确指定的旅行者元素，不匹配时不能用另一元素的面板
 * @returns 库里存的面板；不可用时 undefined（已回过提示）
 */
export async function readyPanel(
  s: Session,
  deps: MhyDeps,
  game: PanelGame,
  uid: string,
  id: string,
  charName: string,
  owner?: string,
  elem?: string
): Promise<StoredAvatar | undefined> {
  // 面板按使用者分存，`#最强XX面板` 要去榜一那一位名下取他那份，故 owner 可指定
  const who = owner ?? s.user
  let one = await deps.panels?.of(who).avatar(game, uid, id)
  // 别名只指向规范性别，存档里可能是另一性别
  const pair = GENDER_PAIR[id]
  if (!isPanelReady(one, game) && pair) {
    const alt = await deps.panels?.of(who).avatar(game, uid, pair)
    if (isPanelReady(alt, game)) one = alt
  }
  if (!isPanelReady(one, game)) {
    await s.text(
      `暂无 ${charName} 的面板数据。请确认它已展示在游戏内的角色展柜中并打开了「显示角色详情」，` +
        `然后发送「${SHORT_PREFIX[game]}更新面板」`
    )
    return undefined
  }
  if (game === "gs" && elem && elemOf(one?.elem) !== elemOf(elem)) {
    await s.text(
      `当前保存的旅行者面板不是${elemName(elem)}元素。请在游戏中切换为${elemName(elem)}元素后发送「#更新面板」`
    )
    return undefined
  }
  return one
}

/**
 * `#<角色名>面板` —— 单角色面板详情
 * @param s 会话
 * @param deps 依赖
 */
export async function charPanel(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    await zzzCharPanel(s, deps)
    return
  }
  const game = panelGame(s)
  if (!game) return
  const builder = deps.panelBuilder
  if (!builder) return

  const uid = await targetUid(s, deps, game)
  if (!uid) {
    await askUid(s)
    return
  }
  if (!(await needMeta(s, deps, game))) return

  const char = pickChar(s, deps, game, /(?:详情|详细|面板|面版)\s*$/)
  if (!char) return
  if (!deps.config().enableUnreleased && !isReleased(char)) {
    await s.text(UNRELEASED_TEXT)
    return
  }

  const stored = await readyPanel(s, deps, game, uid, char.id, char.name, undefined, char.elem)
  if (!stored) return

  const built = builder.build(game, uid, stored)
  if (!built) return

  await submitRank(deps, s, built)

  const splash = uploadedSplash(deps, built)
  const dmg = panelDmg(deps, built)
  const view = profileDetailData(built, {
    mode: "profile",
    ...(deps.artiMeta ? { table: deps.artiMeta } : {}),
    ...metaExists(deps),
    ...splash,
    ...(dmg ? { dmgCalc: dmg.calc } : {})
  })
  if (await s.image("character/profile-detail", view)) {
    await rememberSplash(s, deps, "profile", view)
    return
  }
  await s.text(panelText(built))
}

/**
 * `#最强<角色名>面板` —— 本群该角色排第一那一位的面板
 *
 * 与 `#<角色名>面板` 出的是同一张图，差别只在查谁：uid 与持有者都取自排行榜
 * （见 commands/rank.ts 的 {@link topRankTarget}）。维度关键词与 `#XX排行` 同一套。
 * **不交分数**：这一张查的是别人的面板，交分数会把榜一那份记到发起者名下。
 * @param s 会话
 * @param deps 依赖
 */
export async function topPanel(s: Session, deps: MhyDeps): Promise<void> {
  const game = panelGame(s)
  if (!game) {
    // 绝区零的面板走自己那一套装配；取到榜一之后不出图就是一声不吭
    const top = await topRankTarget(s, deps)
    if (top && s.game === "zzz") await zzzTopPanel(s, deps, top)
    return
  }
  const builder = deps.panelBuilder
  if (!builder) return
  if (!(await needMeta(s, deps, game))) return

  const top = await topRankTarget(s, deps)
  if (!top) return

  const char = deps.meta?.loader.byName(game, top.charName)
  if (!char) return
  const stored = await readyPanel(s, deps, game, top.uid, char.id, char.name, top.user)
  if (!stored) return
  const built = builder.build(game, top.uid, stored)
  if (!built) return

  const splash = uploadedSplash(deps, built)
  const dmg = panelDmg(deps, built)
  const view = profileDetailData(built, {
    mode: "profile",
    ...(deps.artiMeta ? { table: deps.artiMeta } : {}),
    ...metaExists(deps),
    ...splash,
    ...(dmg ? { dmgCalc: dmg.calc } : {})
  })
  if (await s.image("character/profile-detail", view)) return
  await s.text(panelText(built))
}

/**
 * 把这张图用的立绘记进原图索引
 *
 * 取的是视图层最终定下来的那一张：「没有上传的图就用官方立绘」这一步在视图里。
 * @param s 会话
 * @param deps 依赖
 * @param kind 来源
 * @param view 已经发出去的那份视图数据
 */
async function rememberSplash(s: Session, deps: MhyDeps, kind: OriginalKind, view: PanelTemplateData): Promise<void> {
  if (!deps.originals) return
  const data = view["data"]
  if (typeof data !== "object" || data === null) return
  const one = data as { costumeSplash?: unknown; splashUpload?: unknown }
  const rel = typeof one.costumeSplash === "string" ? one.costumeSplash : ""
  const path = originalPathOf(deps, rel, one.splashUpload === true)
  if (path) await rememberOriginal(s, deps, { kind, path })
}

/**
 * `#<角色名>伤害` —— 单角色伤害详情，含词条收益对比
 *
 * 与 `#<角色名>面板` 同一张模板、同一份数据，只差 `mode`：`profile` 只列伤害表，
 * `dmg` 另加「词条伤害计算」与「Buff 列表」两块，且上方属性栏展示的是折算过 buff 的那份。
 *
 * 序号（`#胡桃伤害2`）由使用者指定时按 1 起算，缺省则由公式自己的 `defDmgIdx` 决定。
 * @param s 会话
 * @param deps 依赖
 */
export async function charDmg(s: Session, deps: MhyDeps): Promise<void> {
  // 绝区零的乘区与另两个游戏不是同一套，引擎单独一份；但同受「开启伤害计算」约束
  if (s.game === "zzz") {
    await zzzCharDmg(s, deps)
    return
  }
  const game = panelGame(s)
  if (!game) return
  const builder = deps.panelBuilder
  if (!builder) return

  const uid = await targetUid(s, deps, game)
  if (!uid) {
    await askUid(s)
    return
  }
  if (!(await needMeta(s, deps, game))) return

  const idx = /(?:伤害|伤害计算)\s*(\d+)\s*$/.exec(s.rest)?.[1]
  const char = pickChar(s, deps, game, /(?:伤害|伤害计算)\s*\d*\s*$/)
  if (!char) {
    await s.text(`这条命令要带角色名，如「${SHORT_PREFIX[game]}${DEMO_CHARS[game]}伤害」`)
    return
  }
  if (!deps.config().enableUnreleased && !isReleased(char)) {
    await s.text(UNRELEASED_TEXT)
    return
  }

  const stored = await readyPanel(s, deps, game, uid, char.id, char.name, undefined, char.elem)
  if (!stored) return
  const built = builder.build(game, uid, stored)
  if (!built) return

  const dmg = panelDmg(deps, built, {
    mode: "dmg",
    ...(idx === undefined ? {} : { dmgIdx: Number(idx), idxIsInput: true })
  })
  if (!dmg) {
    await s.text(dmgMissText(deps, built))
    return
  }

  const splash = uploadedSplash(deps, built)
  const view = profileDetailData(built, {
    mode: "dmg",
    dmgCalc: dmg.calc,
    ...(dmg.dmgAttr ? { dmgAttr: dmg.dmgAttr } : {}),
    ...(deps.artiMeta ? { table: deps.artiMeta } : {}),
    ...metaExists(deps),
    ...splash
  })
  if (await s.image("character/profile-detail", view)) {
    await rememberSplash(s, deps, "profile", view)
    return
  }
  await s.text(dmgText(built.name, dmg.calc))
}

/**
 * `#<角色名>圣遗物` —— 单角色圣遗物评分详情
 * @param s 会话
 * @param deps 依赖
 */
export async function charArtis(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    await zzzCharArtis(s, deps)
    return
  }
  const game = panelGame(s)
  if (!game) return
  const builder = deps.panelBuilder
  if (!builder) return

  const uid = await targetUid(s, deps, game)
  if (!uid) {
    await askUid(s)
    return
  }
  if (!(await needMeta(s, deps, game))) return

  const char = pickChar(s, deps, game, /(?:圣遗物|遗器)\s*$/)
  if (!char) return

  const stored = await readyPanel(s, deps, game, uid, char.id, char.name, undefined, char.elem)
  if (!stored) return

  const built = builder.build(game, uid, stored)
  if (!built) return
  if (!built.mark) {
    await s.text(`未能取到 ${built.name} 的${GEAR_NAMES[game]}词条，请重新更新面板后再看`)
    return
  }

  // 与 `#胡桃面板` 同一张图，伤害表换成逐件得分与评分规则（profile-detail 的 artis 模式）
  const view = profileDetailData(built, {
    mode: "artis",
    ...(deps.artiMeta ? { table: deps.artiMeta } : {}),
    ...metaExists(deps),
    ...uploadedSplash(deps, built)
  })
  if (await s.image("character/profile-detail", view)) {
    await rememberSplash(s, deps, "profile", view)
    return
  }
  await s.text(`${built.name} ${GEAR_NAMES[game]}评分 ${built.mark.mark}（${built.mark.markClass}）`)
}

/**
 * `#圣遗物列表` —— 全部角色里评分最高的若干件
 * @param s 会话
 * @param deps 依赖
 */
export async function artisList(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    await zzzArtisList(s, deps)
    return
  }
  const game = panelGame(s)
  if (!game) return
  const store = deps.panels?.of(s.user)
  const builder = deps.panelBuilder
  if (!store || !builder) {
    await s.text("面板功能未启用")
    return
  }

  const uid = await targetUid(s, deps, game)
  if (!uid) {
    await askUid(s)
    return
  }
  if (!(await needMeta(s, deps, game))) return

  const player = await store.load(game, uid)
  const built = Object.keys(player.avatars)
    .filter(id => isPanelReady(player.avatars[id], game))
    .map(id => builder.build(game, uid, player.avatars[id] as StoredAvatar))
    .filter((it): it is NonNullable<typeof it> => !!it)

  if (built.length === 0) {
    await s.text(`暂无 UID${uid} 的面板数据，请先发送「${SHORT_PREFIX[game]}更新面板」`)
    return
  }

  const view = artisListData(
    built,
    { uid, game, limit: deps.config().artisNumber ?? ARTIS_LIMIT, ...metaExists(deps) },
    deps.artiMeta
  )
  if (await s.image("character/artis-list", view)) return
  await s.text(`出图失败。UID${uid} 有 ${built.length} 个角色的面板数据，稍后再试`)
}

/**
 * `#练度统计` —— 全部角色的练度一览
 *
 * 读米游社的角色列表（`character` 接口），故不需要面板数据，但需要元数据取图标与简称。
 * @param s 会话
 * @param deps 依赖
 */
export async function panelStat(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    await zzzPanelStat(s, deps)
    return
  }
  const game = panelGame(s)
  if (!game) return

  const want = uidInText(s.rest)
  const res = await deps.mys.query<unknown>("character", {
    user: s.user,
    game: s.game,
    ...(want ? { uid: want } : {})
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const store = deps.panels?.of(s.user)
  const player = store ? await store.load(game, res.uid) : undefined
  const marks: Record<string, { mark: string; markClass: string }> = {}
  // 接口不给天赋等级，缺它时全表恒印 1 级，故把面板库里那一份并进来
  const talents: Record<string, Record<string, number>> = {}
  // 库里那份不含命座 / 星魂加成；面板没装齐的角色也要折算，故按元数据直接算、不等 builder.build
  const talentLevels: Record<string, Record<string, number>> = {}
  /** 命中的套装（≥2 件），接口不带套装图，从面板库里数 */
  const sets: Record<string, { name: string; own: number; img: string }[]> = {}
  const builder = deps.panelBuilder
  if (player && builder && builder.ready(game)) {
    for (const [id, one] of Object.entries(player.avatars)) {
      if (Object.keys(one.talent ?? {}).length > 0) {
        talents[id] = { ...one.talent }
        const detail = deps.meta?.loader.detail(game, id, one.elem)
        if (detail) talentLevels[id] = unfoldCons(one.talent ?? {}, Number(one.cons) || 0, detail, game)
      }
      if (!isPanelReady(one, game)) continue
      const built = builder.build(game, res.uid, one)
      if (!built) continue
      if (built.mark) marks[id] = { mark: built.mark.mark, markClass: built.mark.markClass }
      const active = Object.entries(built.sets)
        .filter(([, own]) => own >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name, own]) => {
          const piece = built.artis.find(a => a.set === name)
          return { name, own, img: piece ? artiImg(game, piece) : "" }
        })
        .filter(one => one.img)
      if (active.length) sets[id] = active
    }
  }

  // 接口偶尔回空表（战绩未公开 / 接口改版），那时退回本地面板库
  let raw: unknown = res.data
  const got = res.data as { avatars?: unknown[]; list?: unknown[]; avatar_list?: unknown[] } | null
  if ((got?.avatars ?? got?.list ?? got?.avatar_list ?? []).length === 0 && player) {
    const items: StatCharacterItem[] = []
    for (const [id, one] of Object.entries(player.avatars)) {
      if (!hasAvatarData(one)) continue
      const w = one.weapon
      const wBlock = w?.name
        ? {
            name: w.name,
            level: w.level ?? 1,
            rarity: deps.meta?.loader.byName(game, w.name)?.star,
            affix_level: w.affix,
            rank: w.affix
          }
        : undefined
      items.push({
        id,
        name: deps.meta?.loader.byId(game, id)?.name,
        level: one.level,
        rarity: deps.meta?.loader.byId(game, id)?.star,
        actived_constellation_num: one.cons,
        rank: one.cons,
        fetter: one.fetter,
        element: one.elem,
        ...(game === "sr" ? { equip: wBlock } : { weapon: wBlock })
      })
    }
    if (items.length) raw = game === "sr" ? { avatar_list: items } : { avatars: items }
  }

  const view = panelStatData(raw, {
    uid: res.uid,
    game,
    name: s.name,
    marks,
    talents,
    talentLevels,
    sets,
    ...(deps.meta ? { meta: deps.meta.loader } : {}),
    ...metaExists(deps)
  })
  if (await s.image("character/profile-stat", view)) return
  await s.text(panelStatText(view))
}

/**
 * 星铁的行迹键映射：`avatar/detail` 返回的技能按 `anchor` 上的 Point 号归位
 *
 * 对照关系：`Point01` 普攻、`Point02` 战技、
 * `Point03` 终结技、`Point04` 天赋，记忆角色另有 `Point19`（忆灵技）/`Point20`（忆灵天赋）/
 * `Point22`（欢愉技）。
 */
const SR_TALENT_ANCHOR: Readonly<Record<string, string>> = {
  Point01: "a",
  Point02: "e",
  Point03: "q",
  Point04: "t",
  Point19: "me",
  Point20: "mt",
  Point22: "j"
}

/**
 * 从 `avatar/detail` 的返回里解出天赋 / 行迹等级
 *
 * 两个游戏的形态不同：原神的 `skill_list` 里滤掉满级为 1 的被动、按 `group_id`
 * 排序后取前三＝普攻 / 战技 / 终结技（等级是 `level_current`，即不含命座加成的原始等级）；
 * 星铁的按 `anchor` 归位（等级是 `cur_level`）。
 * @param game 游戏
 * @param data 接口返回
 * @returns 天赋键 → 等级；解不出（角色数据未上线）时 undefined
 */
function parseTalentLevels(game: SelfCalcGame, data: unknown): Record<string, number> | undefined {
  const d = (data ?? {}) as {
    skill_list?: { group_id?: number; level_current?: number; max_level?: number; anchor?: string; cur_level?: number }[]
    skills?: { anchor?: string; cur_level?: number }[]
  }
  if (game === "gs") {
    const skills = (d.skill_list ?? [])
      .filter(one => (Number(one.max_level) || 0) >= 10 && (Number(one.level_current) || 0) > 0)
      .sort((a, b) => (Number(a.group_id) || 0) - (Number(b.group_id) || 0))
    if (skills.length < 3) return undefined
    return {
      a: Number(skills[0]?.level_current) || 1,
      e: Number(skills[1]?.level_current) || 1,
      q: Number(skills[2]?.level_current) || 1
    }
  }
  const skills = d.skill_list ?? d.skills ?? []
  const talent: Record<string, number> = {}
  for (const one of skills) {
    const anchor = String(one.anchor ?? "")
    for (const [pt, key] of Object.entries(SR_TALENT_ANCHOR)) {
      if (anchor.includes(pt)) {
        talent[key] = Number(one.cur_level) || 1
        break
      }
    }
  }
  return Object.keys(talent).length > 0 ? talent : undefined
}

/**
 * `#刷新天赋` / `*刷新行迹` —— 逐角色取天赋等级并入库
 *
 * 展柜之外的角色以一条 `from: "talentRefresh"` 的最小记录承载，`isPanelReady` 认不过它，
 * 故不会混进面板列表与排行。绝区零的技能随更新面板一并取，不走这里。
 *
 * 技能等级是账号私有数据，只能用发起者本人绑定该 uid 的 CK 取（`query` 自带这道归属闸）。
 * **并发 5、连败逾五次即停** —— 那多半是风控。
 * @param s 会话
 * @param deps 依赖
 */
export async function refreshTalent(s: Session, deps: MhyDeps): Promise<void> {
  const game = s.game
  if (game === "zzz") {
    await s.text("绝区零的技能等级随「%绝区零更新面板」一并取，无需单独刷新")
    return
  }
  if (game !== "gs" && game !== "sr") return
  const store = deps.panels?.of(s.user)
  if (!store) {
    await s.text("面板功能未启用")
    return
  }
  const term = game === "sr" ? "行迹" : "天赋"

  const roster = await deps.mys.query<{ avatars?: StatCharacterItem[]; list?: StatCharacterItem[]; avatar_list?: StatCharacterItem[] }>("character", {
    user: s.user,
    game
  })
  if (!roster.ok) {
    await s.text(failText(roster))
    return
  }
  const list = roster.data.avatars ?? roster.data.list ?? roster.data.avatar_list ?? []
  if (list.length === 0) {
    await s.text(`取不到你名下的角色列表，请确认已绑定自己的 CK 并在米游社开启角色展示，再刷新${term}`)
    return
  }

  const player = await store.load(game, roster.uid)
  const ids = list.map(one => String(one.id ?? "")).filter(id => id)
  let cursor = 0
  let done = 0
  let fail = 0
  // 连败逾五次即停：那多半是风控，接着逐个问只会把风控引到凭据上
  const worker = async (): Promise<void> => {
    while (cursor < ids.length && fail <= 5) {
      const id = ids[cursor] as string
      cursor += 1
      const one = list.find(it => String(it.id ?? "") === id)
      const detail = await deps.mys.query("detail", {
        user: s.user,
        game,
        data: { avatar_id: id, ...(game === "sr" ? { tab_from: "TabOwned" } : {}) }
      })
      if (!detail.ok) {
        fail += 1
        continue
      }
      const talent = parseTalentLevels(game, detail.data)
      if (!talent) {
        fail += 1
        continue
      }
      const prev = player.avatars[id]
      const cons = Number(game === "sr" ? one?.rank : one?.actived_constellation_num) || 0
      player.avatars[id] = prev
        ? { ...prev, talent }
        : { id, level: Number(one?.level) || 1, cons, talent, from: "talentRefresh" }
      done += 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, ids.length) }, () => worker()))
  await store.save(player)

  const pre = COMMAND_PREFIX[game]
  await s.text(
    done > 0
      ? `已刷新 ${done} 个角色的${term}，发送「${pre}练度统计」即可查看`
      : `未能刷新${term}，请稍后再试；若持续失败多为风控，可等一会儿再试`
  )
}

/**
 * `#删除面板` —— 删掉本地存的面板数据
 *
 * 两道限制：须自己确认（消息里带上 uid），且只能删自己名下的 uid（主人不受限）。
 * @param s 会话
 * @param deps 依赖
 */
export async function delPanel(s: Session, deps: MhyDeps): Promise<void> {
  const game = s.game
  const store = deps.panels?.of(s.user)
  if (!store) {
    await s.text("面板功能未启用")
    return
  }

  const uid = await targetUid(s, deps, game)
  if (!uid) {
    await askUid(s)
    return
  }

  // 要求把 uid 写进消息里：刻意加的确认，误删的面板数据无从恢复
  const inMsg = uidInText(s.rest)
  if (!inMsg) {
    await s.text(`确认要删除面板数据吗？请发送「${COMMAND_PREFIX[game]}删除面板${uid}」以确认`)
    return
  }

  /*
   * 不必校验「这个 uid 在你的绑定列表里」：面板库按用户分键，这里拿到的本就只是发起者
   * 自己那一份，删不到别人的 —— 越权已由分键从结构上排除。
   */
  await store.del(game, inMsg)
  // 榜上那一条随之撤掉，否则它仍挂着而面板已查不到
  await deps.ranks?.dropUid(s.user, game, inMsg)
  await s.text(`UID${inMsg} 的本地面板数据已删除`)
}

/**
 * 给了名字却在当前游戏认不出时，说清是名字的问题 —— 而不是退回列表
 *
 * **不能静默退回列表**：`*绫华面板` 那样跨游戏、或打错字时退列表，看着像「这命令只会出列表」。
 * 名字在别的游戏里认得就指路（`绫华` 是原神的），否则说这个游戏没有它 / 或未装元数据。
 * @param game 当前游戏
 * @param name 认不出的名字
 * @param suffix 命令后缀（`面板` / `圣遗物`…），指路时拼进示例
 * @param deps 依赖
 * @returns 一句可直接发出去的话
 */
export function noSuchCharText(game: PanelGame, name: string, suffix: string, deps: MhyDeps): string {
  const loader = deps.meta?.loader
  // 「冰主」一类在原神认不出只可能是缺那个元素的目录；不拦则落到星铁的同名别名（星铁冰主是穹·记忆）
  if (game === "gs" && travelerElemOf(name)) {
    return `原神${name}的元数据尚未安装，请让主人发送「#更新元数据」后重试`
  }
  for (const other of GAME_KEYS) {
    if (other === game || !loader?.byName(other, name)) continue
    return `${GAME_NAMES[game]}没有「${name}」，那是${GAME_NAMES[other]}的角色，发送「${COMMAND_PREFIX[other]}${name}${suffix}」`
  }
  const tail = loader?.ready(game) ? "" : "，或先让主人发送 #更新元数据"
  return `${GAME_NAMES[game]}里没有「${name}」这个角色${tail}`
}

/**
 * `#面板` 的总入口 —— 按 rest 分派到"列表"或"单角色"
 *
 * **前缀路由下这两件事只能合成一条命令**：`#面板` 是 `#面板列表` 的前缀，
 * 且 `#胡桃面板` 的角色名在触发词之前（靠命令表的正则别名捕获进 rest）。
 * **给了名字却认不出时说清楚，不退回列表**（见 {@link noSuchCharText}）。
 * @param s 会话
 * @param deps 依赖
 */
export async function panelEntry(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    await zzzPanelEntry(s, deps)
    return
  }
  const game = panelGame(s)
  if (!game) return
  const name = stripUids(s.rest)
    .replace(/(?:面板|面版|详情|详细|列表|角色)/g, "")
    .trim()
  if (!name) {
    await panelList(s, deps)
    return
  }
  if (deps.meta?.loader.byName(game, name)) {
    await charPanel(s, deps)
    return
  }
  await s.text(noSuchCharText(game, name, "面板", deps))
}

/**
 * `#圣遗物` 的总入口 —— 按 rest 分派到"全部列表"或"单角色评分"
 *
 * 只能合成一条，理由同 {@link panelEntry}。
 * @param s 会话
 * @param deps 依赖
 */
export async function artisEntry(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    await zzzArtisEntry(s, deps)
    return
  }
  const game = panelGame(s)
  if (!game) return
  const name = stripUids(s.rest)
    .replace(/(?:圣遗物|遗器|列表)/g, "")
    .trim()
  if (!name) {
    await artisList(s, deps)
    return
  }
  if (deps.meta?.loader.byName(game, name)) {
    await charArtis(s, deps)
    return
  }
  await s.text(noSuchCharText(game, name, GEAR_NAMES[game], deps))
}

/**
 * 出图前那几步的公共件，供面板替换（commands/change.ts）复用
 *
 * **收成一个对象而不是逐个导出**：替换那一族出的是同三张图，这四步必须与本文件一致。
 * 逐个导出会让人只取其中两个，而那表现为"换过之后那张图少了立绘"或"图标全空白"，都不报错。
 */
export const PANEL_VIEW_HELPERS = { uploadedSplash, metaExists, panelDmg, dmgMissText } as const

/** 供命令表引用的一组面板命令 */
export const PANEL_HANDLERS = {
  panelEntry,
  artisEntry,
  panelList,
  refreshPanel,
  mysRefreshPanel,
  charPanel,
  charArtis,
  artisList,
  panelStat,
  delPanel
} as const

/** 判一个角色是否有可展示的数据，供别处复用 */
export { hasAvatarData }
