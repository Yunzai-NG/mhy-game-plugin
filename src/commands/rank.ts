/**
 * 模块职责：群排行命令 —— `#排行` / `#刷新排名` / `#启用排名` / `#重置排名`
 * 依赖方向：依赖 session、命令层依赖包、panel/rank 与 views/panel
 * 生命周期：无状态函数
 * 注意事项：**排行按群分组，私聊里没有排行。** 取不到群号时直接说明。
 *
 *          **分数在这一层算，排行层只收数**：装配与算分都在命令层做完，排行层只管存取。
 *
 *          交分数的时机是"有人看过这个角色的面板" —— 排行数据随每次查看逐步累积，
 *          不是全量扫库得来的。
 *
 *          **`#胡桃排行` 不带关键词时问的是伤害那一维**，而它要开了伤害计算、角色有公式、
 *          且有人在那之后查过面板才有数据。故请求的那一维为空时换一维（见 {@link pickBoard}），
 *          不换则一整群已有的评分数据全看不见、每次只回一句"暂无数据"。
 */
import { GAME_NAMES, SHORT_PREFIX } from "../core/region.js"
import type { Session } from "../core/session.js"
import { UNRELEASED_TEXT } from "../core/text.js"
import { isReleased } from "../meta/loader.js"
import type { BuiltPanel } from "../panel/build.js"
import { isSelfCalcGame, type PanelGame, type SelfCalcGame, type ZzzAvatarDetail } from "../panel/profile/index.js"
import { RANK_TYPES, type ProfileRank, type RankType } from "../panel/rank.js"
import { isPanelReady } from "../store/panel.js"
import type { StoredAvatar } from "../store/panel.js"
import { rankListData, rankListText, zzzRankListData } from "../views/panel.js"
import type { ZzzScoreResult } from "../panel/score/index.js"
import { isZzzDmg, zzzDmgOf } from "../panel/dmg/zzz/index.js"
import { talentFrameOf } from "../views/char-talent.js"
import { dmgRankScore, dmgRankTitle, hasDmgRule } from "./_dmg.js"
import { whoOf } from "./_face.js"
import type { MhyDeps } from "./deps.js"

/**
 * 榜上每一位的头像与昵称
 *
 * 只读头像库的 kv、不发请求；库里没有的那位由视图层垫角色头像。
 * @param deps 依赖
 * @param game 游戏
 * @param uids 榜上的 uid
 * @returns uid → 头像与昵称
 */
async function rankWhos(
  deps: MhyDeps,
  game: PanelGame,
  uids: readonly string[]
): Promise<Record<string, Awaited<ReturnType<typeof whoOf>>>> {
  const out: Record<string, Awaited<ReturnType<typeof whoOf>>> = {}
  for (const uid of new Set(uids)) {
    const who = await whoOf(deps, game, uid)
    const info = deps.faces ? await deps.faces.info(game, uid) : {}
    // 库里没有昵称时不用 whoOf 的「旅行者」一类缺省：一整榜都叫旅行者，不如印角色简称
    out[uid] = { ...who, name: info.name ?? "" }
  }
  return out
}

/**
 * 发起者名下、且在这张榜上的 uid，以及页头右上角该印谁
 *
 * 名下几个号都上榜时取名次靠前的那个；一个都没上时取当前绑定的那个（不印别人的信息）。
 * @param deps 依赖
 * @param s 会话
 * @param game 游戏
 * @param board 榜上的 uid，已按名次排好
 * @returns 名下上榜的 uid 与页头要印的 uid
 */
async function rankSelf(
  deps: MhyDeps,
  s: Session,
  game: PanelGame,
  board: readonly string[]
): Promise<{ selfUids: string[]; headUid: string }> {
  const users = deps.users as MhyDeps["users"] | undefined
  if (!users) return { selfUids: [], headUid: "" }
  const mine = new Set(await users.uids(s.user, game))
  const selfUids = board.filter(uid => mine.has(uid))
  return { selfUids, headUid: selfUids[0] ?? (await users.uid(s.user, game)) ?? "" }
}

/** 绝区零技能练满要用的那件材料，图上当满级的冠 */
const ZZZ_CROWN_ITEM = "「仓鼠笼」访问器"

/**
 * 绝区零满级冠图：按名字查材料表，元数据里没有这张时空串（模板据此不画冠）
 * @param deps 依赖
 * @returns 相对元数据根的路径
 */
export function zzzCrownIcon(deps: MhyDeps): string {
  const icon = deps.materials?.get(ZZZ_CROWN_ITEM, "zzz")?.icon
  return icon && deps.meta?.loader.exists(icon) ? icon : ""
}

/**
 * 套装名 → 简称，几套并列时用
 * @param deps 依赖
 * @param game 游戏
 * @returns 取简称的函数
 */
function setAbbrOf(deps: MhyDeps, game: PanelGame): (name: string) => string | undefined {
  // 绝区零的驱动盘不在套装表里，几套并列时退回名字前两字
  if (game === "zzz") return () => undefined
  return name => deps.artiSets?.set(game, name)?.abbr || undefined
}

/**
 * 判本条会话是否在有面板排行的游戏上
 *
 * **三个游戏都有** —— 排行层按 `PanelGame`（含绝区零）存，键里带游戏名。
 * 三个游戏都是四维；绝区零那一路的算分另有一套（见 {@link submitZzzRank}）。
 * @param s 会话
 * @returns 游戏；不是这三个之一时 undefined
 */
function panelGame(s: Session): PanelGame | undefined {
  return s.game === "gs" || s.game === "sr" || s.game === "zzz" ? s.game : undefined
}

/**
 * 要从消息里剥掉的那些词，剥完剩下的才是角色名
 *
 * `#最强双爆胡桃面板` 与 `#胡桃双爆排行` 共用这一张表 —— 两条命令认的是同一套维度关键词。
 */
const STRIP_WORDS =
  /(?:排行|排名|榜|列表|最强|最高分?|第一|最牛|词条|双[爆暴]|圣遗物|遗器|驱动盘|评分|面板|面版|群内|群)/g

/**
 * 从消息里认出排行维度
 *
 * 不带关键词时是伤害那一维（综合练度排行）。
 * @param text 消息文本
 * @returns 维度
 */
export function rankTypeOf(text: string): RankType {
  if (/词条/.test(text)) return "valid"
  if (/双[爆暴]/.test(text)) return "crit"
  if (/(分|圣遗物|遗器|驱动盘|评分|ACE)/.test(text)) return "mark"
  return "dmg"
}

/**
 * 把一份面板的四个维度的分数都交给排行
 *
 * 伤害那一维要开了伤害计算、且这个角色有公式才有，缺任一条时伤害榜上没有这一位。
 *
 * **伤害只在"榜上还没有这一位"或 `force` 时算**：它要跑一遍沙箱里的公式，而 `#面板列表`
 * 一次就要交几十个角色。不这么挡则每看一次列表就把全部角色的伤害重算一遍。
 * @param deps 依赖
 * @param s 会话
 * @param panel 装好的面板
 * @param force 强制重算伤害：这一位的面板数据本次确实变了
 */
export async function submitRank(deps: MhyDeps, s: Session, panel: BuiltPanel, force = false): Promise<void> {
  const ranks = deps.ranks
  const group = s.groupId
  if (!ranks || !group) return

  const mark = panel.mark
  const base = { group, game: panel.game, charId: panel.id, user: s.user, uid: panel.uid }
  if (mark) {
    await ranks.setScore({ ...base, type: "mark", score: mark._mark })
    const crit = critScore(panel)
    if (crit > 0) await ranks.setScore({ ...base, type: "crit", score: crit })
    const valid = validScore(panel)
    if (valid > 0) await ranks.setScore({ ...base, type: "valid", score: valid })
  }

  if (!force && (await ranks.rankOf({ ...base, type: "dmg" }))) return
  const dmg = dmgRankScore(deps, panel)
  if (dmg !== undefined) await ranks.setScore({ ...base, type: "dmg", score: dmg })
}

/**
 * 算双爆副词条分
 *
 * 暴击率按两倍计入：一点暴击率与两点爆伤等价。
 * @param panel 装好的面板
 * @returns 双爆分
 */
export function critScore(panel: BuiltPanel): number {
  let out = 0
  for (const one of panel.artis) {
    for (const attr of one.attrs) {
      if (attr.key === "cpct") out += attr.value * 2
      else if (attr.key === "cdmg") out += attr.value
    }
  }
  return out
}

/**
 * 算绝区零的双爆副词条分
 *
 * 与原神星铁同口径（暴击率两倍计入），但**取数那一侧不同**：驱动盘的副词条在
 * `zzz.discs[].subs` 上，且 `value` 是 `"9.6%"` 这样的**串** —— 直接 `Number()` 得 NaN。
 * 主词条不计，与另两个游戏一致。
 * @param detail 绝区零那一块
 * @returns 双爆分
 */
export function zzzCritScore(detail: ZzzAvatarDetail | undefined): number {
  let out = 0
  for (const disc of detail?.discs ?? []) {
    for (const sub of disc.subs) {
      if (sub.key !== "cpct" && sub.key !== "cdmg") continue
      // 串里带百分号，剥掉再取数；取不到就跳过而不是算成 0
      const value = Number(String(sub.value).replace(/[%,]/g, ""))
      if (!Number.isFinite(value)) continue
      out += sub.key === "cpct" ? value * 2 : value
    }
  }
  return out
}

/**
 * 算绝区零的伤害期望，供排行用
 *
 * **取 `list[0]`** —— 绝区零那一侧本就按期望伤害降序排好，第一条即这位代理人最高的一刀。
 * 原神星铁要靠公式自己指定的 `defDmgIdx` 挑一条，绝区零不需要。
 * 敌人等级一律取缺省，否则榜上各行不可比。
 * @param deps 依赖
 * @param one 存起来的代理人面板
 * @returns 期望伤害；算不出时 undefined
 */
export function zzzDmgRankScore(deps: MhyDeps, one: StoredAvatar): number | undefined {
  const avg = Number(zzzRankRow(deps, one)?.avg)
  return Number.isFinite(avg) && avg > 0 ? avg : undefined
}

/**
 * 绝区零伤害榜比的是哪一刀：排行图上印的那个标题，取法同 {@link zzzDmgRankScore}
 * @param deps 依赖
 * @param one 任一位上榜者的存档
 * @returns 标题；算不出时空串
 */
function zzzDmgRankTitle(deps: MhyDeps, one: StoredAvatar): string {
  return zzzRankRow(deps, one)?.name ?? ""
}

/**
 * 绝区零伤害榜取的那一条：按期望伤害降序后的第一条
 * @param deps 依赖
 * @param one 存起来的代理人面板
 * @returns 那一条；算不出时 undefined
 */
function zzzRankRow(deps: MhyDeps, one: StoredAvatar): { name?: string; avg?: unknown } | undefined {
  const buffs = deps.dmgBuffs
  const meta = deps.meta?.loader
  if (!buffs?.enabled || !meta) return undefined
  const got = zzzDmgOf(one as unknown as Parameters<typeof zzzDmgOf>[0], { buffs, meta })
  return isZzzDmg(got) ? got.list[0] : undefined
}

/**
 * 算绝区零的加权有效词条分
 *
 * **与原神星铁不同的是没有装配层算好的 `eff`**：那边每条副词条带一个"折合几档"的数，
 * 绝区零只有 `rolls`（出现次数，1 起）。故按"次数 × 权重"折算 —— 口径与另两个游戏不同量纲，
 * 但同一条榜内各行可比，这就够了。权重取评分表那一份（`charWeight`，键与副词条的 `key` 同一套）。
 * @param detail 绝区零那一块
 * @param weight 词条键 → 权重，0~100
 * @returns 有效词条分
 */
export function zzzValidScore(
  detail: ZzzAvatarDetail | undefined,
  weight: Readonly<Record<string, number>> | undefined
): number {
  if (!weight) return 0
  let out = 0
  for (const disc of detail?.discs ?? []) {
    for (const sub of disc.subs) {
      const w = Number(weight[sub.key ?? ""]) || 0
      if (w <= 0) continue
      out += (Number(sub.rolls) || 1) * (w / 100)
    }
  }
  return out
}

/**
 * 算加权有效词条分：逐条副词条按该角色的权重折算后累加
 * @param panel 装好的面板
 * @returns 有效词条分
 */
export function validScore(panel: BuiltPanel): number {
  const weight = panel.mark?.charWeight ?? {}
  let out = 0
  for (const one of panel.artis) {
    for (const attr of one.attrs) {
      const w = Number(weight[attr.key]) || 0
      if (w > 0) out += attr.eff * (w / 100)
    }
  }
  return out
}

/**
 * 把一位代理人的四维分数交给排行
 *
 * 绝区零单独一条：它的面板不走原神星铁那条装配路（评分在装配时就挂好了，见 panel/zzz/build.ts），
 * 评分三维在装配时就齐了；伤害取 `list[0]`（那一侧本就按期望降序排好）。
 * **`%<代理人>面板` 与 `%面板列表` 两条路都要调它** —— 只接在列表上时，
 * 只发过单角色面板的人永远不进榜，而他看到的是一张正常的图、毫无异样。
 * @param deps 依赖
 * @param s 会话
 * @param uid uid
 * @param charId 代理人 id
 * @param detail 绝区零那一块
 * @param mark 装配时挂好的评分
 */
export async function submitZzzRank(
  deps: MhyDeps,
  s: Session,
  uid: string,
  one: StoredAvatar,
  mark: ZzzScoreResult | undefined,
  force = false
): Promise<void> {
  const ranks = deps.ranks
  const group = s.groupId
  if (!ranks || !group) return

  const detail = one.zzz
  const base = { group, game: "zzz" as const, charId: one.id, user: s.user, uid }
  if (mark && Number.isFinite(mark.score)) {
    await ranks.setScore({ ...base, type: "mark", score: mark.score })
  }
  const crit = zzzCritScore(detail)
  if (crit > 0) await ranks.setScore({ ...base, type: "crit", score: crit })
  // 取 `keyWeight` 而非 `weight`：前者的键与副词条的 `key` 同一套，后者按属性编号
  const valid = zzzValidScore(detail, mark?.keyWeight)
  if (valid > 0) await ranks.setScore({ ...base, type: "valid", score: valid })

  // 伤害与原神星铁同一道闸：榜上已有就不重算，一次列表要交几十位代理人
  if (!force && (await ranks.rankOf({ ...base, type: "dmg" }))) return
  const dmg = zzzDmgRankScore(deps, one)
  if (dmg !== undefined) await ranks.setScore({ ...base, type: "dmg", score: dmg })
}

/**
 * `#排行` —— 本群某个角色的排行榜
 * @param s 会话
 * @param deps 依赖
 */
export async function charRank(s: Session, deps: MhyDeps): Promise<void> {
  // 绝区零整条另走：它的面板不经原神星铁那条装配路，出图的数据也是另一套形态
  if (s.game === "zzz") {
    await zzzCharRank(s, deps)
    return
  }
  const game = isSelfCalcGame(s.game) ? s.game : undefined
  if (!game) return
  const ranks = deps.ranks
  const store = deps.panels
  const builder = deps.panelBuilder
  if (!ranks || !store || !builder) {
    await s.text("面板排行未启用")
    return
  }
  if (!s.groupId) {
    await s.text("排行按群统计，请在群里使用")
    return
  }

  const cfg = await ranks.groupCfg(s.groupId, game)
  if (cfg.status === 1) {
    await s.text("本群已关闭排行，群管理员可发送「#启用排名」重新开启")
    return
  }

  const type = rankTypeOf(s.rest)
  const name = s.rest.replace(STRIP_WORDS, "").trim()
  const char = name ? deps.meta?.loader.byName(game, name) : undefined
  if (name && !char) {
    await s.text(`认不出角色「${name}」`)
    return
  }
  if (!char) {
    await s.text("请指定角色，例如「#胡桃排行」")
    return
  }
  if (!deps.config().enableUnreleased && !isReleased(char)) {
    await s.text(UNRELEASED_TEXT)
    return
  }

  const picked = await pickBoard(deps, { group: s.groupId, game, type, charId: char.id })
  if (!picked) {
    await s.text(
      `暂无排行数据：本群还没有人查看过 ${char.name} 的面板。发送「${SHORT_PREFIX[game]}${char.name}面板」即可加入排行`
    )
    return
  }

  const rows: { panel: BuiltPanel; rank: number; score: number }[] = []
  let updatedAt = 0
  for (const one of picked.board) {
    // 面板按用户分存，故要去上榜那一位名下取他那份
    const stored = await store.of(one.user).avatar(game, one.uid, char.id)
    if (!isPanelReady(stored, game)) continue
    const built = builder.build(game, one.uid, stored as StoredAvatar)
    if (!built) continue
    rows.push({ panel: built, rank: one.rank, score: one.score })
    updatedAt = Math.max(updatedAt, stored?.at ?? 0)
  }

  if (rows.length === 0) {
    await s.text(`榜上的面板数据都已失效，请让群友重新发送「${SHORT_PREFIX[game]}更新面板」`)
    return
  }

  const loader = deps.meta?.loader
  const first = rows[0]?.panel
  const self = await rankSelf(deps, s, game, rows.map(it => it.panel.uid))
  const view = rankListData(rows, {
    selfUids: self.selfUids,
    ...(updatedAt > 0 ? { updatedAt } : {}),
    game,
    type: picked.type,
    charName: char.name,
    elem: first?.elem ?? "",
    cfg,
    ...(picked.type === type ? {} : { note: fallbackNote(deps, game, char.name, type) }),
    ...(loader ? { exists: (rel: string): boolean => loader.exists(rel) } : {}),
    who: await rankWhos(deps, game, rows.map(it => it.panel.uid)),
    frame: talentFrameOf(game, first?.elem ?? ""),
    ...(picked.type === "dmg" && first ? { dmgTitle: dmgRankTitle(deps, first) } : {}),
    setAbbr: setAbbrOf(deps, game)
  })
  // 页头右上角印发起者自己那个号（见 rankSelf）；不给 uid 则页头不注入
  if (self.headUid) view["uid"] = self.headUid
  if (await s.image("character/rank-profile-list", view)) return
  await s.text(rankListText(rows, char.name, picked.type))
}

/** 请求的那一维为空时换哪几维，按"最常有数据"排 */
const FALLBACK_ORDER: readonly RankType[] = ["mark", "dmg", "crit", "valid"]

/** 维度 → 展示名，`#最强XX面板` 那句话要用 */
const TYPE_NAME: Readonly<Record<RankType, string>> = {
  dmg: "综合练度",
  mark: "评分",
  crit: "双爆",
  valid: "有效词条"
}

/**
 * `#最强XX面板` —— 本群某个角色排第一那一位的面板
 *
 * 维度关键词与 `#XX排行` 同一套（`#最强双爆胡桃面板` 查双爆榜一），不带则伤害维。
 * 取到榜一之后把 uid 交给 `#XX面板` 那条路出图 —— 两条命令出的是同一张图，差别只在查谁。
 * @param s 会话
 * @param deps 依赖
 * @returns 榜一那一位的 uid 与持有者；取不到时 undefined
 */
export async function topRankTarget(
  s: Session,
  deps: MhyDeps
): Promise<{ uid: string; user: string; charName: string; type: RankType } | undefined> {
  const game = panelGame(s)
  if (!game) {
    await s.text(`${GAME_NAMES.zzz}暂无面板排行，这个游戏还没有这个功能`)
    return undefined
  }
  const ranks = deps.ranks
  if (!ranks) {
    await s.text("面板排行未启用")
    return undefined
  }
  if (!s.groupId) {
    await s.text("排行按群统计，请在群里使用")
    return undefined
  }

  const type = rankTypeOf(s.rest)
  const name = s.rest.replace(STRIP_WORDS, "").trim()
  const char = name ? deps.meta?.loader.byName(game, name) : undefined
  if (!char) {
    await s.text(`认不出角色「${name}」，这条命令形如「${SHORT_PREFIX[game]}最强胡桃面板」`)
    return undefined
  }

  const top = await ranks.topUid({ group: s.groupId, game, type, charId: char.id })
  if (top) return { ...top, charName: char.name, type }

  // 请求的那一维没有数据时换一维，与 `#XX排行` 同一口径
  for (const other of FALLBACK_ORDER) {
    if (other === type) continue
    const got = await ranks.topUid({ group: s.groupId, game, type: other, charId: char.id })
    if (got) {
      await s.text(`本群还没有 ${char.name} 的${TYPE_NAME[type]}排行，这是${TYPE_NAME[other]}榜第一名`)
      return { ...got, charName: char.name, type: other }
    }
  }

  await s.text(
    `本群还没有人查看过 ${char.name} 的面板。发送「${SHORT_PREFIX[game]}${char.name}面板」即可加入排行`
  )
  return undefined
}

/**
 * 取一条非空的排行
 *
 * **请求的那一维为空时换一维**：伤害榜要开了伤害计算、角色有公式、且有人在那之后查过面板才会有数据，
 * 而 `#胡桃排行` 不带关键词时问的正是伤害 —— 直接回"暂无数据"会让一整群已有的评分数据看不见。
 * @param deps 依赖
 * @param input 群号、游戏、请求的维度与角色
 * @returns 实际取到的维度与榜；四维全空时 undefined
 */
async function pickBoard(
  deps: MhyDeps,
  input: { group: string; game: SelfCalcGame; type: RankType; charId: string | number }
): Promise<{ type: RankType; board: Awaited<ReturnType<ProfileRank["board"]>> } | undefined> {
  const ranks = deps.ranks
  if (!ranks) return undefined
  const want = await ranks.board(input)
  if (want.length > 0) return { type: input.type, board: want }

  for (const type of FALLBACK_ORDER) {
    if (type === input.type) continue
    const board = await ranks.board({ ...input, type })
    if (board.length > 0) return { type, board }
  }
  return undefined
}

/**
 * 换了维度时图上那句说明
 * @param deps 依赖
 * @param game 游戏
 * @param charName 角色名
 * @param want 原本请求的维度
 * @returns 一句话
 */
function fallbackNote(deps: MhyDeps, game: SelfCalcGame, charName: string, want: RankType): string {
  if (want !== "dmg") return "本群这一维度还没有数据，已换成有数据的那一维"
  if (!deps.config().enableDmgCalc) return "伤害排行需要主人开启「开启伤害计算」，已换成评分排行"
  if (!hasDmgRule(deps, game, charName)) return `元数据里没有 ${charName} 的伤害公式，无法排伤害，已换成评分排行`
  return `本群的 ${charName} 伤害排行还在累积，再发一次「${SHORT_PREFIX[game]}${charName}面板」即可入榜`
}

/**
 * `#刷新排名` —— 按库里已有的面板重算本群的排行
 *
 * 只能重算**榜上已有的那些人**：面板按使用者分存（见 store/panel.ts），本层没有"列出群内所有人"
 * 这条路。它的用处是补齐缺的那一维：没开伤害计算时查过面板的人身上只有评分三维。
 * @param s 会话
 * @param deps 依赖
 */
export async function refreshRank(s: Session, deps: MhyDeps): Promise<void> {
  // 绝区零的面板是另一套形态（不经原神星铁那条装配路），故整条另走
  if (s.game === "zzz") {
    await zzzRefreshRank(s, deps)
    return
  }
  const game = isSelfCalcGame(s.game) ? s.game : undefined
  if (!game) return
  const ranks = deps.ranks
  const store = deps.panels
  const builder = deps.panelBuilder
  if (!ranks || !store || !builder) {
    await s.text("面板排行未启用")
    return
  }
  if (!s.groupId) {
    await s.text("排行按群统计，请在群里使用")
    return
  }
  if (!s.isMaster && !s.isGroupAdmin) {
    await s.text("只有主人与群管理员可以刷新排行")
    return
  }

  const group = s.groupId
  // 先把"群里有谁、各自有哪些角色"从四维的榜上并起来：同一位可能只在其中一维上
  const seen = new Map<string, { user: string; uid: string; charId: string }>()
  for (const type of RANK_TYPES) {
    for (const charId of await ranks.charIds(group, game, type)) {
      for (const row of await ranks.board({ group, game, type, charId, limit: Number.POSITIVE_INFINITY })) {
        seen.set(`${row.user}|${row.uid}|${charId}`, { user: row.user, uid: row.uid, charId })
      }
    }
  }
  if (seen.size === 0) {
    await s.text("本群还没有排行数据，让群友先发送一次「#面板列表」即可入榜")
    return
  }

  await s.text(`正在按库里已有的面板重算本群排行，共 ${seen.size} 条，请稍候`)
  let done = 0
  let dmgDone = 0
  for (const one of seen.values()) {
    const stored = await store.of(one.user).avatar(game, one.uid, one.charId)
    if (!isPanelReady(stored, game)) continue
    const built = builder.build(game, one.uid, stored as StoredAvatar)
    if (!built) continue

    const base = { group, game, charId: built.id, user: one.user, uid: built.uid }
    const mark = built.mark
    if (mark) {
      await ranks.setScore({ ...base, type: "mark", score: mark._mark })
      const crit = critScore(built)
      if (crit > 0) await ranks.setScore({ ...base, type: "crit", score: crit })
      const valid = validScore(built)
      if (valid > 0) await ranks.setScore({ ...base, type: "valid", score: valid })
    }
    const dmg = dmgRankScore(deps, built)
    if (dmg !== undefined) {
      await ranks.setScore({ ...base, type: "dmg", score: dmg })
      dmgDone++
    }
    done++
  }

  await s.text(`本群排行已刷新：重算 ${done} 条，其中 ${dmgDone} 条带伤害`)
}

/**
 * `%<代理人名>排行` —— 绝区零那一路的排行榜
 *
 * 四维与原神星铁齐平，只是算分那一侧另有一套。请求的那一维为空时换一维并说明。
 * @param s 会话
 * @param deps 依赖
 */
async function zzzCharRank(s: Session, deps: MhyDeps): Promise<void> {
  const ranks = deps.ranks
  const store = deps.panels
  if (!ranks || !store) {
    await s.text("面板排行未启用")
    return
  }
  if (!s.groupId) {
    await s.text("排行按群统计，请在群里使用")
    return
  }

  const cfg = await ranks.groupCfg(s.groupId, "zzz")
  if (cfg.status === 1) {
    await s.text("本群已关闭排行，群管理员可发送「%启用排名」重新开启")
    return
  }

  const type = rankTypeOf(s.rest)
  const name = s.rest.replace(STRIP_WORDS, "").trim()
  const char = name ? deps.meta?.loader.byName("zzz", name) : undefined
  if (!char) {
    await s.text(`认不出代理人「${name}」，这条命令形如「${SHORT_PREFIX.zzz}安比排行」`)
    return
  }

  let board = await ranks.board({ group: s.groupId, game: "zzz", type, charId: char.id })
  let used = type
  // 请求的那一维为空时换一维，与原神星铁那一路同口径
  if (board.length === 0) {
    for (const other of FALLBACK_ORDER) {
      if (other === type) continue
      const got = await ranks.board({ group: s.groupId, game: "zzz", type: other, charId: char.id })
      if (got.length > 0) {
        board = got
        used = other
        break
      }
    }
  }
  if (board.length === 0) {
    await s.text(
      `暂无排行数据：本群还没有人查看过 ${char.name} 的面板。发送「${SHORT_PREFIX.zzz}${char.name}面板」即可加入排行`
    )
    return
  }

  const rows: { one: StoredAvatar; rank: number; score: number; uid: string; mark?: ZzzScoreResult }[] = []
  let updatedAt = 0
  for (const it of board) {
    const stored = await store.of(it.user).avatar("zzz", it.uid, char.id)
    if (!stored?.zzz || stored.zzz.discs.length === 0) continue
    const built = deps.zzzPanelBuilder?.build(it.uid, stored)
    rows.push({ one: stored, rank: it.rank, score: it.score, uid: it.uid, ...(built?.mark ? { mark: built.mark } : {}) })
    updatedAt = Math.max(updatedAt, stored.at ?? 0)
  }
  if (rows.length === 0) {
    await s.text(`榜上的面板数据都已失效，请让群友重新发送「${SHORT_PREFIX.zzz}更新面板」`)
    return
  }

  const loader = deps.meta?.loader
  const note = used === type ? "" : zzzFallbackNote(deps, char.name, type)
  const self = await rankSelf(deps, s, "zzz", rows.map(it => it.uid))
  const view = zzzRankListData(rows, {
    type: used,
    charName: char.name,
    cfg,
    ...(note ? { note } : {}),
    ...(loader ? { meta: loader, exists: (rel: string): boolean => loader.exists(rel) } : {}),
    who: await rankWhos(deps, "zzz", rows.map(it => it.uid)),
    setAbbr: setAbbrOf(deps, "zzz"),
    selfUids: self.selfUids,
    ...(updatedAt > 0 ? { updatedAt } : {}),
    ...(used === "dmg" && rows[0] ? { dmgTitle: zzzDmgRankTitle(deps, rows[0].one) } : {}),
    crownIcon: zzzCrownIcon(deps)
  })
  if (self.headUid) view["uid"] = self.headUid
  if (await s.image("character/rank-profile-list", view)) return
  await s.text(
    [`${char.name}${ZZZ_TYPE_NAME[used] ?? ""}排行`]
      .concat(rows.map(it => `  ${it.rank}. UID ${it.one.id} —— ${it.score.toFixed(1)}`))
      .join("\n")
  )
}

/**
 * `%刷新排名` —— 按库里已有的面板重算本群绝区零的排行
 *
 * 与原神星铁那条同一用意：补齐缺的那一维。只能重算**榜上已有的那些人** ——
 * 面板按使用者分存，本层没有"列出群内所有人"这条路。
 * @param s 会话
 * @param deps 依赖
 */
async function zzzRefreshRank(s: Session, deps: MhyDeps): Promise<void> {
  const ranks = deps.ranks
  const store = deps.panels
  if (!ranks || !store) {
    await s.text("面板排行未启用")
    return
  }
  if (!s.groupId) {
    await s.text("排行按群统计，请在群里使用")
    return
  }
  if (!s.isMaster && !s.isGroupAdmin) {
    await s.text("只有主人与群管理员可以刷新排行")
    return
  }

  const group = s.groupId
  const seen = new Map<string, { user: string; uid: string; charId: string }>()
  for (const type of RANK_TYPES) {
    for (const charId of await ranks.charIds(group, "zzz", type)) {
      for (const row of await ranks.board({ group, game: "zzz", type, charId, limit: Number.POSITIVE_INFINITY })) {
        seen.set(`${row.user}|${row.uid}|${charId}`, { user: row.user, uid: row.uid, charId })
      }
    }
  }
  if (seen.size === 0) {
    await s.text(`本群还没有排行数据，让群友先发送一次「${SHORT_PREFIX.zzz}面板列表」即可入榜`)
    return
  }

  await s.text(`正在按库里已有的面板重算本群排行，共 ${seen.size} 条，请稍候`)
  let done = 0
  let dmgDone = 0
  for (const one of seen.values()) {
    const stored = await store.of(one.user).avatar("zzz", one.uid, one.charId)
    if (!stored?.zzz || stored.zzz.discs.length === 0) continue
    const built = deps.zzzPanelBuilder?.build(one.uid, stored)

    const base = { group, game: "zzz" as const, charId: stored.id, user: one.user, uid: one.uid }
    if (built?.mark && Number.isFinite(built.mark.score)) {
      await ranks.setScore({ ...base, type: "mark", score: built.mark.score })
    }
    const crit = zzzCritScore(stored.zzz)
    if (crit > 0) await ranks.setScore({ ...base, type: "crit", score: crit })
    const valid = zzzValidScore(stored.zzz, built?.mark?.keyWeight)
    if (valid > 0) await ranks.setScore({ ...base, type: "valid", score: valid })
    const dmg = zzzDmgRankScore(deps, stored)
    if (dmg !== undefined) {
      await ranks.setScore({ ...base, type: "dmg", score: dmg })
      dmgDone++
    }
    done++
  }

  await s.text(`本群排行已刷新：重算 ${done} 条，其中 ${dmgDone} 条带伤害`)
}

/** 绝区零四维在标题里的那个词 */
const ZZZ_TYPE_NAME: Readonly<Record<string, string>> = {
  dmg: "综合练度",
  mark: "驱动盘评分",
  crit: "双爆副词条",
  valid: "加权有效词条"
}

/**
 * 绝区零换了维度时图上那句说明
 * @param deps 依赖
 * @param charName 代理人名
 * @param want 原本请求的维度
 * @returns 一句话
 */
function zzzFallbackNote(deps: MhyDeps, charName: string, want: RankType): string {
  if (want !== "dmg") return "本群这一维度还没有数据，已换成有数据的那一维"
  if (!deps.config().enableDmgCalc) return "伤害排行需要主人开启「开启伤害计算」，已换成评分排行"
  return `本群的 ${charName} 伤害排行还在累积，再发一次「${SHORT_PREFIX.zzz}面板列表」即可入榜`
}

/**
 * `#启用排名` / `#关闭排名`
 * @param s 会话
 * @param deps 依赖
 */
export async function toggleRank(s: Session, deps: MhyDeps): Promise<void> {
  const game = panelGame(s)
  if (!game) return
  const ranks = deps.ranks
  if (!ranks) {
    await s.text("面板排行未启用")
    return
  }
  if (!s.groupId) {
    await s.text("排行按群统计，请在群里使用")
    return
  }
  if (!s.isMaster && !s.isGroupAdmin) {
    await s.text("只有主人与群管理员可以开关排行")
    return
  }

  const off = /(?:关闭|禁用)/.test(s.rest)
  await ranks.setGroupStatus(s.groupId, game, off ? 1 : 0)
  await s.text(off ? "本群排行已关闭" : "本群排行已启用")
}

/**
 * `#重置排名` —— 清掉本群的排行数据
 * @param s 会话
 * @param deps 依赖
 */
export async function resetRank(s: Session, deps: MhyDeps): Promise<void> {
  const game = panelGame(s)
  if (!game) return
  const ranks = deps.ranks
  if (!ranks) {
    await s.text("面板排行未启用")
    return
  }
  if (!s.groupId) {
    await s.text("排行按群统计，请在群里使用")
    return
  }
  if (!s.isMaster && !s.isGroupAdmin) {
    await s.text("只有主人与群管理员可以重置排行")
    return
  }

  const name = s.rest.replace(/(?:重置|重设|排名|排行|群内|群|面板)/g, "").trim()
  if (!name) {
    await ranks.reset(s.groupId, game)
    await s.text("本群全部角色的排行已重置")
    return
  }

  const char = deps.meta?.loader.byName(game, name)
  if (!char) {
    await s.text(`认不出角色「${name}」`)
    return
  }
  await ranks.reset(s.groupId, game, char.id)
  await s.text(`本群 ${char.name} 的排行已重置`)
}
