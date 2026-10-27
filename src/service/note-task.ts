/**
 * 模块职责：体力提醒这一件事 —— 到点的账号查一次体力，过了阈值就推一张便笺，并算出下次几点再看
 * 依赖方向：依赖 store/note、service/mys、service/widget 与 views/note；由 index.ts 挂到 `ctx.every` 上
 * 生命周期：无状态函数，每次扫描触发调用一次
 * 注意事项：**按需查而非每轮遍历**：遍历一天一百四十余次请求，足够撞上风控并连带挡掉使用者手动查。
 *          故每查一次就据回满秒数算出到阈值的时刻写进 {@link RemindState.nextAt}，扫描只碰到点的。
 *          后台先走小组件（免验证码、不占额度，要 stoken），拿不到才退回实时便笺；当场发 `#体力`
 *          一律走实时便笺，小组件缺派遣剩余、宝钱回复与周本折扣。实时便笺只能用本人 CK 取，故后台
 *          任务必须带 `state.user`，否则得到 `10102`（表现为"没有数据"而非失败）。推送失败也记为
 *          已提醒，否则每轮都查一次再发不出去；逐条 try，一条出错不影响后面的。
 */
import type { Logger } from "@yunzai-ng/types"
import { COMMAND_PREFIX } from "../core/region.js"
import type { MysService } from "./mys.js"
import type { WidgetService } from "./widget.js"
import type { NoteRemindStore, RemindState } from "../store/note.js"
import type { NoteGauge, NoteRaw, NoteView, TemplateData } from "../views/note.js"
import { buildNote, noteTemplateData, noteText, NOTE_TEMPLATES } from "../views/note.js"

/** 扫描间隔。它决定的只是"提醒最多晚到多久"，不是请求量 —— 没到点的条目一个包都不发 */
export const REMIND_SCAN = "5m"

/** 两次检查之间至少隔这么久，免得同一个人在相邻两轮里被查两次 */
const MIN_GAP = 10 * 60_000

/** 两次检查之间最多隔这么久 —— 推算失准时的兜底，不至于把一条提醒搁到明天 */
const MAX_GAP = 6 * 3600_000

/** 查询失败之后隔这么久再看 —— uid 解绑、CK 没了这类原因不会在五分钟后好转 */
const FAIL_GAP = 2 * 3600_000

/** 提醒过之后隔这么久才再看一次；只在体力满着不动时起作用，一天三次 */
export const REMIND_REPEAT = 8 * 3600_000

/** 推算出的时刻上再加一分钟，免得正好差一格没到阈值、白查一次 */
const OVERSHOOT = 60_000

/**
 * 推出去的那一条提醒
 *
 * 出图与文字都给：推送层先试模板，出不来就发 {@link text}，与 `#体力` 同一套回退口径。
 */
export interface RemindPayload {
  /** 纯文字形态，自成完整答案 */
  text: string
  /** 模板名，形如 `gs/note` */
  template: string
  /** 模板数据 */
  data: TemplateData
}

/** 一轮提醒扫描要用到的东西 */
export interface RemindTaskDeps {
  /** 提醒开关与节流 */
  reminds: NoteRemindStore
  /** 查询服务，只用到 `query`；小组件取不到时用它 */
  mys: Pick<MysService, "query">
  /**
   * 小组件取数，缺省不用
   *
   * 给了就先走它（免验证码、不占每日额度），拿不到才退回 {@link mys}。
   */
  widget?: Pick<WidgetService, "note">
  /** 日志器 */
  logger: Logger
  /**
   * 把提醒推出去
   *
   * 由 index.ts 接到在线 Bot 上：`state.groupId` 有值就发那个群并 @ 一句，否则私聊；
   * `state.botId` 有值时优先从那个号发。返回假表示推不出去。
   */
  notify: (state: RemindState, payload: RemindPayload) => Promise<boolean>
  /** 取当前时间，测试用 */
  now?: () => number
  /** 取消信号，由任务给出；超时或插件卸载时中止剩下的条目 */
  signal?: AbortSignal
}

/** 一轮提醒扫描的统计 */
export interface RemindTaskResult {
  /** 开着提醒的条目数 */
  total: number
  /** 本轮真的去查了的条目数 */
  checked: number
  /** 其中走小组件拿到的条目数 */
  byWidget: number
  /** 提醒出去的条目数 */
  sent: number
  /** 查询失败的条目数 */
  failed: number
}

/**
 * 推算下次该几点再查
 *
 * 回满秒数与"还差几格"一并给出了每格要多少秒，故不必按游戏写死回复速度。
 * 已经满了或字段缺失时退回 {@link MAX_GAP}。
 * @param gauge 体力量表
 * @param want 实际生效的阈值
 * @param now 当前时间（毫秒）
 * @returns 时刻（毫秒）
 */
export function nextCheckAt(gauge: Pick<NoteGauge, "current" | "max" | "seconds">, want: number, now: number): number {
  const short = gauge.max - gauge.current
  if (gauge.seconds <= 0 || short <= 0) return now + MAX_GAP
  const perUnit = (gauge.seconds / short) * 1000
  const wait = (want - gauge.current) * perUnit + OVERSHOOT
  return now + Math.min(MAX_GAP, Math.max(MIN_GAP, wait))
}

/**
 * 攒出提醒那段话
 *
 * 没装渲染器的部署也收得到，故它必须自成完整答案而不是一句"你的体力快满了"。
 * 末尾那句关闭方法带着当前游戏的前缀：星铁使用者照抄 `#体力提醒关闭` 会关掉原神那条。
 * @param view 便笺视图
 * @param threshold 使用者设的阈值
 * @returns 多行文本
 */
export function remindText(view: NoteView, threshold: number): string {
  const g = view.stamina
  const head =
    g.current >= g.max
      ? `${g.label}已经回满了（${g.current}/${g.max}），再攒也不会涨`
      : `${g.label}到 ${g.current}/${g.max} 了，超过你设的 ${threshold}`
  return [
    `【体力提醒】${head}`,
    noteText(view),
    `体力还是满的话每 8 小时会再提醒一次，不想收就发「${COMMAND_PREFIX[view.game]}体力提醒关闭」`
  ].join("\n")
}

/**
 * 跑一轮体力提醒扫描
 * @param deps 依赖
 * @returns 统计
 */
export async function remindStamina(deps: RemindTaskDeps): Promise<RemindTaskResult> {
  const now = deps.now ?? ((): number => Date.now())
  const out: RemindTaskResult = { total: 0, checked: 0, byWidget: 0, sent: 0, failed: 0 }

  for (const state of await deps.reminds.list()) {
    if (deps.signal?.aborted) break
    if (!state.enabled) continue
    out.total += 1
    if (state.nextAt > now()) continue
    // 群管理关掉本群的提醒之后，在这个群里开过提醒的人一律不推
    if (state.groupId && !(await deps.reminds.groupEnabled(state.groupId))) continue

    out.checked += 1
    try {
      await one(state, deps, now, out)
    } catch (err) {
      out.failed += 1
      // 一条出错不影响后面的：否则第一个人的网络抖动会让这一轮剩下的人全都收不到
      await deps.reminds.schedule(state.user, state.game, now() + FAIL_GAP)
      deps.logger.warn(
        `[米游社][体力提醒] ${state.user} 的 ${state.game} 出错：${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  return out
}

/** 取到的一份体力数据 */
interface Fetched {
  /** 便笺形态的原始数据 */
  raw: NoteRaw
  /** 查到的 uid */
  uid: string
  /** 是不是走小组件拿到的 */
  widget: boolean
}

/**
 * 取一次体力：先小组件，拿不到退回实时便笺
 *
 * 小组件要 uid，而 uid 存在使用者档案里不在提醒设置里，故由 {@link MysService.query} 的返回补 ——
 * 也就是第一轮必然走实时便笺，之后才有 uid 可用。拿不准是哪个账号时不该猜。
 * @param state 设置
 * @param deps 依赖
 * @returns 数据；两条路都取不到时 undefined
 */
async function fetchNote(state: RemindState, deps: RemindTaskDeps): Promise<Fetched | undefined> {
  if (deps.widget && state.uid) {
    const hit = await deps.widget.note({ game: state.game, uid: state.uid, owner: state.user })
    if (hit.ok) return { raw: hit.data, uid: state.uid, widget: true }
    deps.logger.debug(`[米游社][体力提醒] ${state.user} 的 ${state.game} 小组件没取到（${hit.skip}）：${hit.message}`)
  }

  const res = await deps.mys.query<NoteRaw>("dailyNote", { user: state.user, game: state.game })
  if (!res.ok) {
    deps.logger.debug(`[米游社][体力提醒] ${state.user} 的 ${state.game} 查不到：${res.message}`)
    return undefined
  }
  return { raw: res.data, uid: res.uid, widget: false }
}

/**
 * 处理一条设置：查一次、够了就推、不够就算出下次几点再看
 * @param state 设置
 * @param deps 依赖
 * @param now 取当前时间
 * @param out 统计，就地累加
 */
async function one(state: RemindState, deps: RemindTaskDeps, now: () => number, out: RemindTaskResult): Promise<void> {
  const got = await fetchNote(state, deps)
  if (!got) {
    out.failed += 1
    // 往后压两小时而不是下一轮再来：uid 解绑、CK 被停用这类原因不会在五分钟后好转
    await deps.reminds.schedule(state.user, state.game, now() + FAIL_GAP)
    return
  }
  if (got.widget) out.byWidget += 1
  // uid 记回设置里：下一轮就能直接走小组件
  if (got.uid && got.uid !== state.uid) await deps.reminds.remember(state.user, state.game, got.uid)

  const ctx = { game: state.game, uid: got.uid, name: "", now: now() }
  const view = buildNote(got.raw, ctx)
  const gauge = view.stamina
  // 阈值高过这个账号自己的上限时按上限算：否则"阈值 200 而上限 160"永远不会触发。
  // 上限会随冒险等阶涨，故只能到这一步才知道
  const want = Math.min(state.threshold, gauge.max)
  if (gauge.current < want) {
    await deps.reminds.schedule(state.user, state.game, nextCheckAt(gauge, want, now()))
    return
  }

  const at = now()
  const sent = await deps.notify(state, {
    text: remindText(view, state.threshold),
    template: NOTE_TEMPLATES[state.game],
    data: noteTemplateData(got.raw, ctx)
  })
  // 推送失败也照样记：理由见文件头
  await deps.reminds.markSent(state.user, state.game, at, at + REMIND_REPEAT)
  if (sent) out.sent += 1
  else deps.logger.warn(`[米游社][体力提醒] ${state.user} 的提醒推送失败`)
}
