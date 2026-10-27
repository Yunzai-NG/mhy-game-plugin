/**
 * 模块职责：`#体力提醒` —— 逐使用者、逐游戏地开关体力提醒，改阈值，以及群级开关
 * 依赖方向：依赖 store/note、service/note-task、views/note 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**挂在 `#体力` 上而不是自成一条命令**：`#体力` 是它的前缀，前缀路由下注册两条
 *          必定互相遮挡。故 `#体力` 的 `rest` 以「提醒」或「推送」打头时转到这里。
 *
 *          **开启前先真查一次，成了才开**：uid 没绑、CK 不是自己的、账号没开实时便笺展示，
 *          这三种都会让提醒静默地永远不响。
 *
 *          提醒发到开启时所在的会话，群里开的就发群里，故开启时把"会发到哪"明说出来。
 *
 *          **uid 与 Bot 号一并存下**：前者让定时任务第一轮就能走小组件（见 service/widget.ts），
 *          后者让推送从当时那个号发出去 —— 挂两个 Bot 时按平台名挑会挑到没进那个群的。
 */
import type { Session } from "../core/session.js"
import { COMMAND_PREFIX, GAME_KEYS, GAME_NAMES } from "../core/region.js"
import { failText, INDENT } from "../core/text.js"
import { nextCheckAt, REMIND_REPEAT } from "../service/note-task.js"
import { clampThreshold, REMIND_CAPS, REMIND_MIN } from "../store/note.js"
import type { NoteRemindStore } from "../store/note.js"
import type { NoteRaw } from "../views/note.js"
import { buildNote } from "../views/note.js"
import type { MhyDeps } from "./deps.js"

/** 触发词：`#体力` 之后以这两个词打头才算是在设置提醒 */
const HEAD = /^(?:提醒|推送)/

/** 关掉的说法 */
const OFF = /关闭|关掉|停止|取消|禁用|关$/

/** 开启的说法，可带一个阈值。认不出的一律当"看状态"，免得 `#体力提醒帮助` 反而把它开了 */
const ON = /^(?:开启|开|打开|启用|设置)?\s*([0-9]{1,4})?$/

/** 使用者这一次想做什么 */
export interface RemindRequest {
  /** 开、关、看状态，还是开关整个群 */
  kind: "on" | "off" | "status" | "group"
  /** `on` 时使用者给的阈值，没给时 undefined */
  threshold?: number
  /** `group` 时是要开还是要关 */
  groupOn?: boolean
}

/**
 * 认出 `#体力` 后面那截是不是在设置提醒
 * @param rest 触发词之后的原文
 * @returns 请求；不是设置提醒时 undefined（此时照旧查便笺）
 */
export function parseRemindRest(rest: string): RemindRequest | undefined {
  const text = rest.trim()
  if (!HEAD.test(text)) return undefined
  const tail = text.replace(HEAD, "").trim()
  if (/^群/.test(tail)) return { kind: "group", groupOn: !OFF.test(tail) }
  if (OFF.test(tail)) return { kind: "off" }
  const hit = ON.exec(tail)
  if (!hit) return { kind: "status" }
  const num = hit[1]
  return num ? { kind: "on", threshold: Number(num) } : { kind: "on" }
}

/**
 * `MM-DD HH:mm`
 * @param at 毫秒时间戳
 * @returns 形如 `09-02 21:30`
 */
function stamp(at: number): string {
  const d = new Date(at)
  const two = (n: number): string => String(n).padStart(2, "0")
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/**
 * `#体力提醒群开启` / `#体力提醒群关闭` —— 群管理一处关掉本群的提醒
 *
 * 缺省开着：这道闸是给"提醒太多占屏"用的，不是多一道要人先开的闸。
 * @param s 会话
 * @param store 提醒存储
 * @param on 是否允许
 */
async function toggleGroup(s: Session, store: NoteRemindStore, on: boolean): Promise<void> {
  if (!s.groupId) {
    await s.text("这一条要在群里发：它开关的是整个群的体力提醒")
    return
  }
  if (!s.isGroupAdmin && !s.isMaster) {
    await s.text("只有群管理或主人能开关整个群的体力提醒")
    return
  }
  await store.setGroupEnabled(s.groupId, on)
  await s.text(
    on
      ? "本群的体力提醒已允许。各人仍要自己发一次「#体力提醒」才会收到"
      : "本群的体力提醒已关闭，在本群开过提醒的人都不会再收到。想改回来发「#体力提醒群开启」"
  )
}

/**
 * 开启提醒
 * @param s 会话
 * @param deps 依赖
 * @param store 提醒存储
 * @param want 使用者给的阈值，没给时沿用旧值
 */
async function turnOn(s: Session, deps: MhyDeps, store: NoteRemindStore, want?: number): Promise<void> {
  if (s.groupId && !(await store.groupEnabled(s.groupId))) {
    await s.text("本群的体力提醒被管理员关掉了，请找群管理发「#体力提醒群开启」，或私聊我开启")
    return
  }

  // 查得到才开，见文件头
  const res = await deps.mys.query<NoteRaw>("dailyNote", { user: s.user, game: s.game })
  if (!res.ok) {
    await s.text(
      [
        `没能查到你的实时便笺，故提醒没有开启：${failText(res)}`,
        `${INDENT}提醒要用你自己的 Cookie，请先私聊发送「#绑定CK」`
      ].join("\n")
    )
    return
  }

  const prev = await store.get(s.user, s.game)
  const threshold = clampThreshold(s.game, want ?? prev.threshold)
  const view = buildNote(res.data, { game: s.game, uid: res.uid, name: s.name })
  const gauge = view.stamina
  const reached = gauge.current >= Math.min(threshold, gauge.max)
  const now = Date.now()
  const nextAt = reached ? now + REMIND_REPEAT : nextCheckAt(gauge, Math.min(threshold, gauge.max), now)

  const state = await store.enable(s.user, s.game, {
    threshold,
    nextAt,
    uid: res.uid,
    botId: s.botId,
    ...(s.groupId ? { groupId: s.groupId } : {})
  })

  const lines = [
    `${GAME_NAMES[s.game]}体力提醒已开启，${gauge.label}到 ${state.threshold} 时提醒你（现在 ${gauge.current}/${gauge.max}）。`,
    `${INDENT}提醒会${s.groupId ? "发到本群并 @ 你 —— 这个群都看得到你的体力" : "私聊发给你"}，出的是一张便笺图。`,
    `${INDENT}体力一直是满的时候每 8 小时再提醒一次，随时可发「${COMMAND_PREFIX[s.game]}体力提醒关闭」停掉。`
  ]
  if (want !== undefined && want !== state.threshold) {
    lines.push(`${INDENT}你给的 ${want} 不在 ${REMIND_MIN}~${REMIND_CAPS[s.game].max} 之间，已按 ${state.threshold} 算。`)
  }
  if (reached) lines.push(`${INDENT}你现在就已经超过这个数了，故第一次提醒要等 8 小时之后再判。`)
  if (!deps.config().enableStaminaRemind) {
    lines.push(`${INDENT}注意：主人尚未打开插件的「体力提醒」总开关，故现在还不会真的推送。`)
  }
  await s.text(lines.join("\n"))
}

/**
 * `#体力提醒状态`
 * @param s 会话
 * @param deps 依赖
 * @param store 提醒存储
 */
async function status(s: Session, deps: MhyDeps, store: NoteRemindStore): Promise<void> {
  const on = deps.config().enableStaminaRemind
  const lines = [`体力提醒总开关：${on ? "已开启（提醒可能晚几分钟到）" : "未开启（主人可在面板打开）"}`]

  for (const game of GAME_KEYS) {
    const state = await store.get(s.user, game)
    if (!state.enabled && game !== s.game) continue
    if (!state.enabled) {
      lines.push(`【${GAME_NAMES[game]}】未开启`)
      continue
    }
    lines.push(
      `【${GAME_NAMES[game]}】已开启，阈值 ${state.threshold}，${state.groupId ? `推送到群 ${state.groupId}` : "私聊推送"}`
    )
    if (state.lastAt) lines.push(`${INDENT}上次提醒：${stamp(state.lastAt)}`)
  }

  if (s.groupId && !(await store.groupEnabled(s.groupId))) {
    lines.push("本群的体力提醒被管理员关掉了，在本群开的提醒都不会推送")
  }
  lines.push("用法：「#体力提醒」开启，「#体力提醒150」改阈值，「#体力提醒关闭」停掉")
  await s.text(lines.join("\n"))
}

/**
 * `#体力提醒` 一族的入口
 * @param s 会话
 * @param deps 依赖
 * @param req 已认出的请求
 */
export async function staminaRemind(s: Session, deps: MhyDeps, req: RemindRequest): Promise<void> {
  const store = deps.reminds
  if (!store) {
    await s.text("体力提醒功能未启用")
    return
  }

  if (req.kind === "group") {
    await toggleGroup(s, store, req.groupOn === true)
    return
  }
  if (req.kind === "status") {
    await status(s, deps, store)
    return
  }
  if (req.kind === "off") {
    await store.disable(s.user, s.game)
    await s.text(
      `${GAME_NAMES[s.game]}体力提醒已关闭，之后不会再主动推送。「${COMMAND_PREFIX[s.game]}体力」仍可随时手动查`
    )
    return
  }
  await turnOn(s, deps, store, req.threshold)
}
