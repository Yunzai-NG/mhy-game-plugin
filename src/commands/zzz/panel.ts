/**
 * 模块职责：绝区零面板命令 —— 更新、列表、单个代理人
 * 依赖方向：依赖 session、命令层依赖包、views/zzz/panel 与 panel/score/zzz
 * 生命周期：无状态函数
 * 注意事项：**取数分两步：`avatar/basic` 取全部代理人，`avatar/info` 取驱动盘与属性。**
 *          第二步先合批（一次问全部 id），**返回位数少于所问、或整批失败**时才对余下的逐个补问。
 *          退回逐个也要挑失败类型，见 {@link RETRY_KINDS}。
 *
 *          逐个补问最多 {@link DETAIL_MAX} 位（按等级降序），且带间隔 —— 三十次已鉴权请求
 *          正是触发风控的形态。余下的由 `#<名>面板` 在真要看时单独问。
 *
 *          **绝区零不走面板装配层**（属性由接口算好），故不问 `panelBuilder.ready`；
 *          元数据只用来把使用者打的名字认成代理人。
 */
import type { Session } from "../../core/session.js"
import { UID_IN_TEXT } from "../../core/region.js"
import { failText } from "../../core/text.js"
import type { QueryFail, QueryResult } from "../../service/mys.js"
import { profileFailText } from "../../panel/serv/types.js"
import { isSuperPanel, splashDirName } from "../../panel/img.js"
import { savePanelFace, syncIndexInfo } from "../_face.js"
import { rememberOriginal } from "../original.js"
import { ZZZ_RANK_STAR } from "../../panel/profile/index.js"
import { isZzzDmg, zzzDmgOf } from "../../panel/dmg/zzz/index.js"
import type { ZzzDmgMiss } from "../../panel/dmg/zzz/index.js"
import type { ZzzScoreResult } from "../../panel/score/index.js"
import { applyZzzChange, parseZzzChange } from "../../panel/zzz/index.js"
import { zzzDmgText, zzzDmgView } from "../../views/zzz/index.js"
import type { RefreshMark, StoredAvatar } from "../../store/panel.js"
import {
  artiSetImg,
  panelStatData,
  panelStatText,
  zzzArtisListData,
  zzzPanelData,
  zzzPanelListData,
  zzzPanelListText,
  zzzPanelText
} from "../../views/panel.js"
import type { StatCharacterItem, StatCharacterWeapon, ZzzPanelRow } from "../../views/panel.js"
import { listRanks, markRankUid, noSuchCharText } from "../panel.js"
import { submitZzzRank, zzzCrownIcon } from "../rank.js"
import type { MhyDeps } from "../deps.js"

/** 一次更新最多补问几位代理人的详情 */
const DETAIL_MAX = 16

/** 逐个补问之间等多久，毫秒 */
const DETAIL_GAP = 1200

/**
 * 合批失败后还值得退回逐个问的那几类失败
 *
 * **风控、凭据失效、次数用尽三类一律就地停住** —— 逐个再问十六次不会成功，而"同一份凭据
 * 连发十六个已鉴权请求"正是触发风控的形态。
 */
const RETRY_KINDS: readonly string[] = ["unknown", "http"]

/** 从消息里认 uid 的判据，与 commands/panel.ts 同一条 */
const UID_RE = UID_IN_TEXT

/**
 * 取本次要查的 uid
 * @param s 会话
 * @param deps 依赖
 * @returns uid；取不到时 undefined
 */
async function targetUid(s: Session, deps: MhyDeps): Promise<string | undefined> {
  const inMsg = UID_RE.exec(s.rest)?.[0]
  if (inMsg) return inMsg
  return (await deps.users.uid(s.user, "zzz")) || undefined
}

/**
 * 给一份存下来的面板评分
 *
 * 判空与评分挂载都在装配层（`panel/zzz/build.ts`），这里只剩取值一步。
 * @param deps 依赖
 * @param uid uid
 * @param one 存下来的面板
 * @returns 评分结果；装不出面板或评分表缺失时 undefined
 */
export function markOf(deps: MhyDeps, uid: string, one: StoredAvatar): ZzzScoreResult | undefined {
  return deps.zzzPanelBuilder?.build(uid, one)?.mark
}

/**
 * 从 rest 里认出一位代理人
 * @param s 会话
 * @param deps 依赖
 * @param strip 要剥掉的触发词
 * @returns 代理人 id 与名；认不出时 undefined
 */
function pickChar(s: Session, deps: MhyDeps, strip: RegExp): { id: string; name: string } | undefined {
  const name = s.rest.replace(new RegExp(UID_RE.source, "g"), "").replace(strip, "").trim()
  if (!name) return undefined
  const got = deps.meta?.loader.byName("zzz", name)
  if (got?.id) return { id: got.id, name: got.name }
  const alias = deps.alias?.nameIn("zzz", name)
  const two = alias ? deps.meta?.loader.byName("zzz", alias) : undefined
  return two?.id ? { id: two.id, name: two.name } : undefined
}

/**
 * 没绑 uid 时的提示
 * @param s 会话
 */
async function askUid(s: Session): Promise<void> {
  await s.text("请先发送「#绝区零绑定uid+你的UID」绑定查询目标")
}

/** `avatar/basic` 返回里的一位代理人 */
interface BasicAvatar {
  /** 代理人 id */
  id?: number | string
  /** 等级 */
  level?: number
}

/**
 * 问一批代理人的详情
 * @param s 会话
 * @param deps 依赖
 * @param uid uid
 * @param ids 要问的代理人 id
 * @returns 接口结果
 */
async function askDetails(
  s: Session,
  deps: MhyDeps,
  uid: string,
  ids: readonly string[]
): Promise<QueryResult<{ avatar_list?: unknown[] }>> {
  return await deps.mys.query<{ avatar_list?: unknown[] }>("avatarInfo", {
    user: s.user,
    uid,
    game: "zzz",
    data: { id_list: [...ids] }
  })
}

/**
 * 取名下全部代理人的详情
 *
 * 先合批问一次，**合批回得少或整批失败都退回逐个补问**（有上限、带间隔，理由见文件头）。
 * @param s 会话
 * @param deps 依赖
 * @param uid 要查的 uid，与判冷却用的是同一个
 * @returns uid、详情数组、「一共有多少位」与中途失败的那一次；取不到时 undefined（已回过提示）
 */
async function fetchDetails(
  s: Session,
  deps: MhyDeps,
  uid: string
): Promise<{ uid: string; list: unknown[]; total: number; fail?: QueryFail } | undefined> {
  const roster = await deps.mys.query<{ avatar_list?: BasicAvatar[] }>("character", {
    user: s.user,
    uid,
    game: "zzz"
  })
  if (!roster.ok) {
    await s.text(failText(roster))
    return undefined
  }

  const all = (roster.data.avatar_list ?? []).filter(one => one.id !== undefined)
  if (all.length === 0) {
    await s.text("米游社没有返回任何代理人，请确认已在米游社完成实名并开启战绩展示")
    return undefined
  }
  const want = [...all].sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0)).slice(0, DETAIL_MAX)
  const ids = want.map(one => String(one.id))

  const list: unknown[] = []
  let fail: QueryFail | undefined

  const first = await askDetails(s, deps, roster.uid, ids)
  if (first.ok) list.push(...(first.data.avatar_list ?? []))
  else if (RETRY_KINDS.includes(first.kind)) fail = first
  else {
    await s.text(failText(first))
    return undefined
  }

  if (list.length < ids.length) {
    const done = new Set(list.map(one => String((one as BasicAvatar).id)))
    for (const id of ids) {
      if (done.has(id)) continue
      await new Promise(resolve => setTimeout(resolve, DETAIL_GAP))
      const one = await askDetails(s, deps, roster.uid, [id])
      // 中途失败就停：接着问下去会把风控引到使用者的凭据上
      if (!one.ok) {
        fail ??= one
        break
      }
      list.push(...(one.data.avatar_list ?? []))
    }
  }

  if (list.length === 0) {
    await s.text(fail ? failText(fail) : "米游社没有返回任何代理人详情")
    return undefined
  }
  return { uid: roster.uid, list, total: all.length, ...(fail ? { fail } : {}) }
}

/**
 * `#绝区零更新面板` —— 取一次数据并落库
 *
 * 两条源：米游社（要 Cookie、给名下全部）与 Enka 展柜（不要 Cookie、只有公开的那几位）。
 * **`force` 不给才按配置选**：`#展柜更新面板` / `#米游社更新面板` 是指名走哪条，只按配置选会让这两条
 * 都落回米游社（绝区零的配置缺省三类都指米游社），命令名与实际走的路对不上。
 * @param s 会话
 * @param deps 依赖
 * @param force 指名走哪条源；不给时按配置选
 */
export async function zzzRefreshPanel(s: Session, deps: MhyDeps, force?: "enka" | "mys"): Promise<void> {
  const store = deps.panels?.of(s.user)
  const serv = deps.panel
  if (!store || !serv) {
    await s.text("面板功能未启用")
    return
  }
  // 先判元数据再取数（理由见 commands/panel.ts 的 refreshPanel）：绝区零那一路没元数据时映射出零位代理人，
  // 回的是「请把角色放进展柜」，与真正的原因对不上，还占掉冷却
  if (!deps.meta?.loader.ready("zzz")) {
    await s.text("面板计算需要元数据（代理人、音擎与驱动盘的数据都在里面），请先让主人发送 #更新元数据")
    return
  }

  const uid = await targetUid(s, deps)
  if (!uid) {
    await askUid(s)
    return
  }
  const cd = await serv.cooldown(s.user, uid)
  if (cd > 0) {
    await s.text(`UID${uid} 的面板刚更新过，请 ${cd} 秒后再试`)
    return
  }

  const byEnka = force === "enka" || (force === undefined && serv.pick(uid, "zzz").id === "enkaZZZ")
  let profile
  let servName: string
  let total = 0
  let failed: QueryFail | undefined
  if (byEnka) {
    const out = await serv.fetch(s.user, uid, "zzz", { servId: "enkaZZZ" })
    if (!out.result.ok) {
      await s.text(profileFailText(out.result, out.serv.name))
      return
    }
    profile = out.result.profile
    servName = out.serv.name
    total = Object.keys(profile.avatars).length
  } else {
    const got = await fetchDetails(s, deps, uid)
    if (!got) return
    failed = got.fail
    const out = await serv.fetch(s.user, got.uid, "zzz", { fromMys: true, data: got.list })
    if (!out.result.ok) {
      await s.text(profileFailText(out.result, out.serv.name))
      return
    }
    profile = out.result.profile
    servName = out.serv.name
    total = got.total
    // 米游社面板源不给头像，补打一次 index 取 `cur_head_icon_url`
    await syncIndexInfo(deps, s.user, "zzz", got.uid)
  }

  const merged = await store.merge(profile)
  // 只有 Enka 那一路给头像 id（`ProfileId`）；落不下来只是页头退回默认图
  await savePanelFace(deps, profile)
  const rest = total - merged.updated.length
  const tail = byEnka
    ? "。Enka 展柜只显示你在游戏里公开的那几位"
    : rest > 0
      ? `。名下另有 ${rest} 位未取${failed ? `（中途失败：${failText(failed)}）` : ""}，发送「%<代理人名>面板」可单独取一位`
      : ""
  await zzzPanelList(s, deps, {
    updated: merged.updated,
    changed: merged.changed,
    servName,
    note: tail
  })
}

/**
 * `#绝区零面板列表` —— 已有面板数据的代理人一览
 * @param s 会话
 * @param deps 依赖
 * @param mark 本次更新带回来的东西；由更新那条命令传入，直接查看时不传
 */
export async function zzzPanelList(s: Session, deps: MhyDeps, mark?: RefreshMark): Promise<void> {
  const store = deps.panels?.of(s.user)
  if (!store) {
    await s.text("面板功能未启用")
    return
  }
  const uid = await targetUid(s, deps)
  if (!uid) {
    await askUid(s)
    return
  }

  const player = await store.load("zzz", uid)
  const rows: ZzzPanelRow[] = []
  for (const one of Object.values(player.avatars)) {
    if (!one.zzz) continue
    const scored = markOf(deps, uid, one)
    rows.push({ one, ...(scored ? { mark: scored } : {}) })
  }
  if (rows.length === 0) {
    await s.text(`暂无 UID${uid} 的面板数据，请先发送「#绝区零更新面板」`)
    return
  }

  // 交分数：评分三维装配时就齐了（便宜，每次重交），伤害只在榜上还没有或本次变了时算
  const changedIds = new Set(mark?.changed ?? [])
  for (const row of rows) {
    await submitZzzRank(deps, s, uid, row.one, row.mark, changedIds.has(row.one.id))
  }
  // 记资格：排名限制第 2~5 档凭这份信息放行，不记则那四档一律判不通过
  await markRankUid(
    deps,
    s,
    "zzz",
    uid,
    rows.flatMap(row => (row.one.zzz ? [row.one.zzz.name] : []))
  )
  const rank = await listRanks(
    deps,
    s,
    "zzz",
    uid,
    rows.map(row => row.one.id)
  )

  const msg = mark ? refreshMsg(uid, mark) : ""
  const view = zzzPanelListData(rows, player, {
    uid,
    ...(deps.meta
      ? { meta: deps.meta.loader, exists: (rel: string): boolean => deps.meta!.loader.exists(rel) }
      : {}),
    ...(mark ? { fresh: mark.updated, changed: mark.changed, msg, servName: mark.servName ?? "" } : {}),
    ...(rank ? { rank } : {})
  })
  if (await s.image("character/profile-list", view)) return
  // 出图失败时那句提示不能跟着丢
  await s.text(msg ? `${msg}\n${zzzPanelListText(rows, uid)}` : zzzPanelListText(rows, uid))
}

/**
 * 拼一次更新的提示语
 * @param uid uid
 * @param mark 本次更新带回来的东西
 * @returns 一句话
 */
function refreshMsg(uid: string, mark: RefreshMark): string {
  const from = mark.servName ? `，数据来自 ${mark.servName}` : ""
  return (
    `UID${uid} 本次取到 ${mark.updated.length} 位代理人` +
    `（其中 ${mark.changed.length} 位有更新）${from}${mark.note ?? ""}`
  )
}

/**
 * `#绝区零<代理人名>面板` —— 单个代理人的面板
 *
 * 库里没有这一位时当场问一次。
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzCharPanel(s: Session, deps: MhyDeps): Promise<void> {
  const store = deps.panels?.of(s.user)
  const serv = deps.panel
  if (!store || !serv) {
    await s.text("面板功能未启用")
    return
  }
  const uid = await targetUid(s, deps)
  if (!uid) {
    await askUid(s)
    return
  }

  const char = pickChar(s, deps, /(?:面板|面版|详情|详细|驱动盘)\s*$/)
  if (!char) {
    await s.text(
      deps.meta?.loader.ready("zzz")
        ? "认不出这位代理人，试试「#绝区零安比面板」"
        : "按名字查代理人要先装绝区零元数据，请让主人发送 #更新元数据"
    )
    return
  }

  let stored = await store.avatar("zzz", uid, char.id)
  if (!stored?.zzz) {
    const fetched = await fetchOne(s, deps, uid, char)
    if (!fetched) return
    stored = fetched
  }

  // **这一条也要交分数**：与原神星铁的 `charPanel` 一致。只接在列表那条路上时，
  // 只发过 `%<代理人>面板` 的人永远不进榜，而他看到的是一张正常的面板图、毫无异样
  await submitZzzRank(deps, s, uid, stored, markOf(deps, uid, stored))
  await drawZzzPanel(s, deps, uid, stored)
}

/**
 * `%<代理人名>驱动盘` —— 同一张面板图，伤害表换成逐件得分与评分规则
 *
 * 评不出分（主角、缺元数据）时退回普通面板并说一句，免得拆解表整块空着。
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzCharArtis(s: Session, deps: MhyDeps): Promise<void> {
  const store = deps.panels?.of(s.user)
  if (!store || !deps.panel) {
    await s.text("面板功能未启用")
    return
  }
  const uid = await targetUid(s, deps)
  if (!uid) {
    await askUid(s)
    return
  }
  const char = pickChar(s, deps, /(?:驱动盘|驱动盘列表)\s*$/)
  if (!char) {
    await s.text(
      deps.meta?.loader.ready("zzz")
        ? "认不出这位代理人，试试「%安比驱动盘」"
        : "按名字查代理人要先装绝区零元数据，请让主人发送 #更新元数据"
    )
    return
  }
  let stored = await store.avatar("zzz", uid, char.id)
  if (!stored?.zzz) {
    const fetched = await fetchOne(s, deps, uid, char)
    if (!fetched) return
    stored = fetched
  }
  if (!markOf(deps, uid, stored)) {
    await s.text(`${char.name} 暂无驱动盘评分规则，下面是普通面板`)
    await drawZzzPanel(s, deps, uid, stored)
    return
  }
  await drawZzzPanel(s, deps, uid, stored, "artis")
}

/**
 * `%驱动盘` —— 名下全部代理人里评分最高的若干件
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzArtisList(s: Session, deps: MhyDeps): Promise<void> {
  const store = deps.panels?.of(s.user)
  if (!store) {
    await s.text("面板功能未启用")
    return
  }
  const uid = await targetUid(s, deps)
  if (!uid) {
    await askUid(s)
    return
  }
  const player = await store.load("zzz", uid)
  const rows: ZzzPanelRow[] = []
  for (const one of Object.values(player.avatars)) {
    if (!one.zzz) continue
    const scored = markOf(deps, uid, one)
    if (scored) rows.push({ one, mark: scored })
  }
  if (rows.length === 0) {
    await s.text(`暂无 UID${uid} 的面板数据，请先发送「%更新面板」`)
    return
  }
  const view = zzzArtisListData(rows, {
    uid,
    limit: deps.config().artisNumber ?? 28,
    ...(deps.meta ? { exists: (rel: string): boolean => deps.meta!.loader.exists(rel) } : {})
  })
  if (await s.image("character/artis-list", view)) return
  await s.text(`出图失败。UID${uid} 有 ${rows.length} 位代理人的驱动盘评分，稍后再试`)
}

/**
 * `%最强<代理人>面板` —— 本群这位代理人榜一那份面板
 *
 * 读的是榜一持有者名下那份，**不交分数**：交了会把别人的面板记到发起者名下。
 * @param s 会话
 * @param deps 依赖
 * @param top 榜一的 uid、持有者与代理人名（见 commands/rank.ts 的 topRankTarget）
 */
export async function zzzTopPanel(s: Session, deps: MhyDeps, top: { uid: string; user: string; charName: string }): Promise<void> {
  const char = deps.meta?.loader.byName("zzz", top.charName)
  const stored = char ? await deps.panels?.of(top.user).avatar("zzz", top.uid, char.id) : undefined
  if (!stored?.zzz) {
    await s.text(`榜一那份 ${top.charName} 的面板已不在库里，请对方重新发送「%${top.charName}面板」`)
    return
  }
  await drawZzzPanel(s, deps, top.uid, stored)
}

/**
 * 出一张绝区零面板图（不交分数，交不交由调用方定）
 * @param s 会话
 * @param deps 依赖
 * @param uid 这份面板的 uid
 * @param stored 存下的那一份
 * @param mode 缺省面板；`artis` 评分拆解；`dmg` 伤害详情（算不出时退回面板）
 * @param changeProfile 面板替换那条命令的原文，给了就在图上印「该面板为非实际数据」
 */
async function drawZzzPanel(
  s: Session,
  deps: MhyDeps,
  uid: string,
  stored: StoredAvatar,
  mode?: "artis" | "dmg",
  changeProfile?: string
): Promise<void> {
  const mark = markOf(deps, uid, stored)

  const splash = uploadedSplash(deps, stored, mark)
  // 与原神星铁一致：基础面板也带伤害汇总表（`dmgData`），使用者据此知道有几条、再发 `%<名>伤害` 看详情。
  // **算不出来就不带**（开关关着 / 缺元数据 / 这位没公式）—— 基础面板不该因伤害算不出而报错
  const loader = deps.meta?.loader
  const buffs = deps.dmgBuffs
  const dmgGot = loader && buffs ? zzzDmgOf(stored, { buffs, meta: loader }) : { miss: "noMeta" as const }
  const dmg = isZzzDmg(dmgGot) && dmgGot.list.length > 0 ? zzzDmgView(dmgGot) : undefined
  const shownMode = mode === "dmg" && !dmg ? undefined : mode
  const view = zzzPanelData(stored, {
    uid,
    ...(shownMode ? { mode: shownMode } : {}),
    ...(dmg && shownMode !== "artis" ? { dmgCalc: dmg } : {}),
    ...(mark ? { mark } : {}),
    ...(splash ? { splash } : {}),
    ...(deps.meta ? { meta: deps.meta.loader, exists: (rel: string): boolean => deps.meta!.loader.exists(rel) } : {})
  })
  if (await s.image("character/profile-detail", changeProfile ? { ...view, changeProfile } : view)) {
    if (splash && deps.panelImgs) {
      await rememberOriginal(s, deps, { kind: "profile", path: deps.panelImgs.pathOf(splash) })
    }
    return
  }
  await s.text(zzzPanelText(stored, mark))
}

/**
 * 伤害算不出来时的一句话
 *
 * 三种成因分开说：处置分别是让主人开开关、更新元数据、等包更新。
 * @param miss 成因
 * @param name 代理人名
 * @returns 可直接发出去的一句话
 */
function zzzDmgMissText(miss: ZzzDmgMiss, name: string): string {
  if (miss === "off") {
    return (
      "伤害计算未开启。它需要执行下载来的公式代码，故缺省关闭 —— " +
      "请让主人在配置里打开「开启伤害计算」，改完即生效"
    )
  }
  if (miss === "noMeta") return "伤害计算要先装绝区零元数据，请让主人发送 #更新元数据"
  return `元数据里没有 ${name} 的技能倍率，换个代理人试试`
}

/**
 * `#绝区零<代理人名>伤害` —— 单个代理人的伤害计算
 *
 * 与 `#绝区零<名>面板` 同一张模板、同一份数据，只差 `mode` 与多出的伤害栏。
 * 加成在元数据的 `calc.js` 里、由沙箱求值，故同受「开启伤害计算」约束。
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzCharDmg(s: Session, deps: MhyDeps): Promise<void> {
  const store = deps.panels?.of(s.user)
  const serv = deps.panel
  if (!store || !serv) {
    await s.text("面板功能未启用")
    return
  }
  const uid = await targetUid(s, deps)
  if (!uid) {
    await askUid(s)
    return
  }

  const char = pickChar(s, deps, /(?:伤害|伤害计算)\s*\d*\s*$/)
  if (!char) {
    await s.text(
      deps.meta?.loader.ready("zzz")
        ? "认不出这位代理人，试试「#绝区零安比伤害」"
        : "按名字查代理人要先装绝区零元数据，请让主人发送 #更新元数据"
    )
    return
  }

  let stored = await store.avatar("zzz", uid, char.id)
  if (!stored?.zzz) {
    const fetched = await fetchOne(s, deps, uid, char)
    if (!fetched) return
    stored = fetched
  }

  const loader = deps.meta?.loader
  const buffs = deps.dmgBuffs
  const got = loader && buffs ? zzzDmgOf(stored, { buffs, meta: loader }) : { miss: "noMeta" as const }
  if (!isZzzDmg(got) || got.list.length === 0) {
    await s.text(zzzDmgMissText(isZzzDmg(got) ? "noRate" : got.miss, char.name))
    return
  }

  const mark = markOf(deps, uid, stored)
  const splash = uploadedSplash(deps, stored, mark)
  const dmg = zzzDmgView(got)
  const view = zzzPanelData(stored, {
    uid,
    mode: "dmg",
    dmgCalc: dmg,
    ...(mark ? { mark } : {}),
    ...(splash ? { splash } : {}),
    ...(deps.meta ? { meta: deps.meta.loader, exists: (rel: string): boolean => deps.meta!.loader.exists(rel) } : {})
  })
  if (await s.image("character/profile-detail", view)) {
    if (splash && deps.panelImgs) {
      await rememberOriginal(s, deps, { kind: "profile", path: deps.panelImgs.pathOf(splash) })
    }
    return
  }
  await s.text(zzzDmgText(char.name, dmg))
}

/**
 * 挑一张使用者上传的面板图
 *
 * 练满的先看 `super-character/`，否则只看 `normal-character/`；`enableCustomSplash`
 * 关着时一张都不挑。
 * @param deps 依赖
 * @param one 存下来的面板
 * @param mark 评分结果，"练满"那道判定要它
 * @returns 相对面板图根目录的路径；没有可用的时空串
 */
function uploadedSplash(deps: MhyDeps, one: StoredAvatar, mark?: ZzzScoreResult): string {
  const store = deps.panelImgs
  if (!store || !deps.config().enableCustomSplash) return ""
  const name = one.zzz?.name
  if (!name) return ""
  const superFirst = isSuperPanel({
    game: "zzz",
    cons: one.cons,
    talent: one.talent ?? {},
    ...(mark?.markClass ? { markClass: mark.markClass } : {})
  })
  return store.pick(splashDirName(name, deps.config().srSharedSplashDir), superFirst) ?? ""
}

/**
 * 当场取一位代理人的详情并落库
 * @param s 会话
 * @param deps 依赖
 * @param uid uid
 * @param char 代理人 id 与名
 * @returns 存下来的面板；取不到时 undefined（已回过提示）
 */
async function fetchOne(
  s: Session,
  deps: MhyDeps,
  uid: string,
  char: { id: string; name: string }
): Promise<StoredAvatar | undefined> {
  const store = deps.panels?.of(s.user)
  const serv = deps.panel
  if (!store || !serv) return undefined

  const cd = await serv.cooldown(s.user, uid)
  if (cd > 0) {
    await s.text(`UID${uid} 的面板刚更新过，请 ${cd} 秒后再试`)
    return undefined
  }

  const res = await deps.mys.query<{ avatar_list?: unknown[] }>("avatarInfo", {
    user: s.user,
    uid,
    game: "zzz",
    data: { id_list: [char.id] }
  })
  if (!res.ok) {
    await s.text(failText(res))
    return undefined
  }

  const out = await serv.fetch(s.user, uid, "zzz", { fromMys: true, data: res.data.avatar_list ?? [] })
  if (!out.result.ok) {
    await s.text(
      out.result.kind === "empty"
        ? `${char.name} 还没装驱动盘，面板图上没有可看的内容`
        : profileFailText(out.result, out.serv.name)
    )
    return undefined
  }

  await store.merge(out.result.profile)
  return await store.avatar("zzz", uid, char.id)
}

/**
 * `#绝区零练度统计` —— 名下已更新过面板的代理人
 *
 * **只读本地面板库，一个米游社请求都不打**：评分、影画、音擎、技能等级与属性都在库里，
 * 而角色列表接口这几项一概不给。代价是没更新过面板的代理人不在表里。
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzPanelStat(s: Session, deps: MhyDeps): Promise<void> {
  const store = deps.panels?.of(s.user)
  if (!store) {
    await s.text("面板功能未启用")
    return
  }

  const uid = await targetUid(s, deps)
  if (!uid) {
    await askUid(s)
    return
  }

  const player = await store.load("zzz", uid)
  const marks: Record<string, { mark: string; markClass: string }> = {}
  const talents: Record<string, Record<string, number>> = {}
  const equips: Record<string, StatCharacterWeapon> = {}
  const sets: Record<string, { name: string; own: number; img: string }[]> = {}
  const list: StatCharacterItem[] = []
  for (const [id, one] of Object.entries(player.avatars)) {
    const detail = one.zzz
    if (!detail) continue
    list.push({
      id,
      name_mi18n: detail.name,
      level: one.level,
      // 接口的 `rarity` 是字母、`rank` 是影画数，与本地 `zzz.rank` / `cons` 恰好交叉，勿对调
      rarity: detail.rank,
      rank: one.cons,
      ...(detail.elemId !== undefined ? { element_type: detail.elemId } : {})
    })
    const mark = markOf(deps, uid, one)
    if (mark) marks[id] = { mark: mark.score.toFixed(1), markClass: mark.markClass }
    if (one.talent) talents[id] = one.talent
    const weapon = detail.weapon
    if (weapon) {
      equips[id] = {
        name: weapon.name,
        level: weapon.level,
        star: ZZZ_RANK_STAR[weapon.rank] ?? 4,
        affix: weapon.star
      }
    }
    const bySet = new Map<string, number>()
    for (const disc of detail.discs) {
      if (disc.set) bySet.set(disc.set, (bySet.get(disc.set) ?? 0) + 1)
    }
    const active = [...bySet.entries()]
      .filter(([, own]) => own >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([name, own]) => ({ name, own, img: artiSetImg("zzz", name, 0) }))
    if (active.length) sets[id] = active
  }

  if (list.length === 0) {
    await s.text(`暂无 UID${uid} 的面板数据，请先发送「#绝区零更新面板」`)
    return
  }

  const view = panelStatData(
    { avatar_list: list },
    {
      uid,
      game: "zzz",
      name: s.name,
      marks,
      talents,
      equips,
      sets,
      ...(deps.meta ? { meta: deps.meta.loader, exists: (rel: string): boolean => deps.meta!.loader.exists(rel) } : {})
    }
  )
  // 满级格的冠用「仓鼠笼」访问器（见 rank.ts 的 zzzCrownIcon），取不到时模板不画冠
  view["crownIcon"] = zzzCrownIcon(deps)
  if (await s.image("character/profile-stat", view)) return
  await s.text(panelStatText(view))
}

/**
 * `#绝区零面板` 的总入口 —— 按 rest 分派到「列表」或「单个代理人」
 *
 * `#面板` 是 `#面板列表` 的前缀，故只登记一条。**给了名字却认不出时说清楚**（`*绫华面板` 那样跨游戏、
 * 或打错字，退回列表看着像「这命令只会出列表」），见 {@link noSuchCharText}。
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzPanelEntry(s: Session, deps: MhyDeps): Promise<void> {
  const name = s.rest
    .replace(new RegExp(UID_RE.source, "g"), "")
    .replace(/(?:面板|面版|详情|详细|列表|角色|代理人|驱动盘)/g, "")
    .trim()
  if (!name) {
    await zzzPanelList(s, deps)
    return
  }
  if (pickChar(s, deps, /(?:面板|面版|详情|详细|驱动盘)\s*$/)) {
    await zzzCharPanel(s, deps)
    return
  }
  await s.text(noSuchCharText("zzz", name, "面板", deps))
}

/**
 * `%<代理人>换<...>` —— 绝区零面板替换：改造一份存档、本地重算属性后出图，不落库、不进排行
 *
 * 写法与原神星铁那一条同形，解析与改造在 panel/zzz/change.ts。借部件读别人存档时同样只读本人库里那份，这里不发请求。
 * @param s 会话
 * @param deps 依赖
 * @param commandText 图上印的命令原文
 */
export async function zzzPanelChange(s: Session, deps: MhyDeps, commandText: string): Promise<void> {
  const loader = deps.meta?.loader
  const store = deps.panels?.of(s.user)
  if (!loader?.ready("zzz") || !store) {
    await s.text("面板替换要用绝区零元数据，请先让主人发送「#更新元数据」")
    return
  }
  const parsed = parseZzzChange(s.rest, loader)
  if (!parsed.ok) {
    await s.text(parsed.message)
    return
  }
  const char = loader.byName("zzz", parsed.char)
  const uid = parsed.uid || (await targetUid(s, deps))
  if (!char?.id || !uid) {
    await askUid(s)
    return
  }
  const base = await store.avatar("zzz", uid, char.id)
  if (!base?.zzz) {
    await s.text(`${char.name} 还没有面板数据，先发送「%更新面板」取一次`)
    return
  }
  const cache = new Map<string, StoredAvatar | undefined>()
  const want = [parsed.change.weapon?.from, parsed.change.discs, ...Object.values(parsed.change.pos ?? {})]
  for (const one of want) {
    if (!one) continue
    const key = `${one.uid ?? uid}:${one.name}`
    const item = loader.byName("zzz", one.name)
    if (item?.id && !cache.has(key)) cache.set(key, await store.avatar("zzz", one.uid ?? uid, item.id))
  }
  const { avatar, missed } = applyZzzChange(base, parsed.change, uid, {
    meta: loader,
    load: (fromUid: string, name: string): StoredAvatar | undefined => cache.get(`${fromUid}:${name}`)
  })
  if (missed.length > 0) await s.text(`这几处没换成：${missed.join("、")}`)
  await drawZzzPanel(s, deps, uid, avatar, parsed.mode === "panel" ? undefined : parsed.mode, commandText)
}

/**
 * `%驱动盘` 一族的总入口：不带名字看列表，带名字看那一位的评分拆解
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzArtisEntry(s: Session, deps: MhyDeps): Promise<void> {
  const name = s.rest
    .replace(new RegExp(UID_RE.source, "g"), "")
    .replace(/(?:驱动盘|列表)/g, "")
    .trim()
  if (!name) {
    await zzzArtisList(s, deps)
    return
  }
  if (pickChar(s, deps, /(?:驱动盘|驱动盘列表)\s*$/)) {
    await zzzCharArtis(s, deps)
    return
  }
  await s.text(noSuchCharText("zzz", name, "驱动盘", deps))
}
