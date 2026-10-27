/**
 * 模块职责：元数据的定时增量更新与失败通知
 * 依赖方向：只依赖 meta/download 的安装器与几个注入进来的回调；不碰 session、不碰内核
 * 生命周期：由 `ctx.every` 按配置的周期驱动
 * 注意事项：只更新已经装过的那一份，不替谁做首次安装 —— 首次那三百兆由 `autoInstallMeta`
 *          单管，轮询一并做的话部署者关掉那一项之后仍会被下三百兆。
 *
 *          失败通知要节流但第一次立刻发：元数据源不通常持续几个小时，每轮都发会刷满主人的私聊，
 *          完全不发又让"新角色一直认不出"无从察觉。成功一次就把节流状态清掉，否则长故障恢复后
 *          的下一次故障会被上一轮的间隔挡住。
 */
import type { Logger } from "@yunzai-ng/types"
import type { MetaGame, MetaInstaller, MetaResult } from "../meta/download.js"
import { META_GAMES } from "../meta/download.js"

/** 失败通知的节流状态在 KV 里的键前缀 */
const NOTICE_PREFIX = "metaNotice:"

/** 一次轮询要用到的东西 */
export interface MetaTaskDeps {
  /** 元数据安装器 */
  installer: MetaInstaller
  /** 日志器 */
  logger: Logger
  /**
   * 读一个游戏上次通知主人的时刻
   * @param game 游戏
   * @returns 毫秒时间戳；没通知过时 undefined
   */
  lastNotice: (game: MetaGame) => Promise<number | undefined>
  /**
   * 记下一个游戏这次通知的时刻；传 undefined 表示清掉
   * @param game 游戏
   * @param at 毫秒时间戳
   */
  setNotice: (game: MetaGame, at: number | undefined) => Promise<void>
  /**
   * 通知主人
   * @param text 文案
   * @returns 至少发出一条时为真
   */
  notify: (text: string) => Promise<boolean>
  /** 装完之后要丢的那几处缓存 */
  reload: () => void
  /** 要不要在失败时通知主人 */
  notice: () => boolean
  /** 重复通知的最短间隔（毫秒） */
  noticeGap: () => number
  /** 当前时刻，测试里可固定 */
  now?: () => number
}

/** 一轮轮询的结果 */
export interface MetaTaskResult {
  /** 检查了几个游戏 */
  checked: number
  /** 真的更新了几个 */
  updated: number
  /** 失败了几个 */
  failed: number
  /** 发出去了几条通知 */
  notified: number
}

/**
 * 跑一轮元数据增量更新
 *
 * 未安装的游戏直接跳过（见文件头），正在下载的也跳过 —— 会撞在安装器自己的串行锁上。
 * @param deps 依赖
 * @returns 本轮结果
 */
export async function autoUpdateMeta(deps: MetaTaskDeps): Promise<MetaTaskResult> {
  const now = deps.now ?? ((): number => Date.now())
  const out: MetaTaskResult = { checked: 0, updated: 0, failed: 0, notified: 0 }
  let changed = false

  for (const game of META_GAMES) {
    if (!deps.installer.installed(game)) continue
    if (deps.installer.busy(game)) continue
    out.checked += 1

    let ret: MetaResult | undefined
    let err: string | undefined
    try {
      ret = await deps.installer.install(game)
      if (ret.status === "error") err = ret.message ?? "未给出原因"
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    }

    if (err === undefined) {
      if (ret && (ret.status === "update" || ret.status === "full")) {
        changed = true
        out.updated += 1
        deps.logger.info(`[米游社][元数据] meta-${game} 已自动更新（${ret.count ?? 0} 个提交）`)
      }
      // 成功一次就把节流清掉，理由见文件头
      await deps.setNotice(game, undefined)
      continue
    }

    out.failed += 1
    deps.logger.warn(`[米游社][元数据] meta-${game} 自动更新失败：${err}`)
    if (await noticeNow(deps, game, now(), err)) out.notified += 1
  }

  // 有东西真的变了才丢缓存：`latest` 那一支什么都没动，白丢一次会让下次查询重读三千个文件
  if (changed) deps.reload()
  return out
}

/**
 * 按节流规则通知主人
 * @param deps 依赖
 * @param game 游戏
 * @param at 当前时刻
 * @param err 失败原因
 * @returns 真的发出去了为真
 */
async function noticeNow(deps: MetaTaskDeps, game: MetaGame, at: number, err: string): Promise<boolean> {
  if (!deps.notice()) return false
  const last = await deps.lastNotice(game)
  // 首次失败立刻通知，此后按最短间隔
  if (last !== undefined && at - last < deps.noticeGap()) return false

  const ok = await deps.notify(
    `[米游社] meta-${game} 自动更新失败：${err}\n` +
      "新角色的图标与简称会一直认不出来，可发送「#更新元数据」手动重试，或在插件配置里改元数据主机"
  )
  // 发不出去时不记时刻：记了就等于把这次故障算成"已通知过"，而主人其实一无所知
  if (ok) await deps.setNotice(game, at)
  return ok
}

/**
 * 节流状态在 KV 里的键
 * @param game 游戏
 * @returns 键
 */
export function noticeKey(game: MetaGame): string {
  return `${NOTICE_PREFIX}${game}`
}
