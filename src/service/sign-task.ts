/**
 * 模块职责：每日自动签到这一件事 —— 遍历开了开关的账号、签一遍、把结果推给绑定者
 * 依赖方向：依赖 store/ck、store/sign 与 service/sign；由 index.ts 挂到 `ctx.cron` 上
 * 生命周期：无状态函数，每次定时触发调用一次
 * 注意事项：四道闸依次判，缺一不可：主人的总开关（在调用方 index.ts）、这条 CK 没被停用、
 *          该账号自己开了自动签到、今天还没签过。第四道尤其重要 —— 框架重启会让定时任务
 *          重排一次，没有它就可能在同一天签第二次。
 *
 *          推送失败不算签到失败：签到已落到米游社，发不出消息只该记一条日志。
 *          一个账号出错不影响后面的，故逐个 try。
 */
import type { Logger } from "@yunzai-ng/types"
import type { CookiePool } from "../store/ck.js"
import type { SignStore } from "../store/sign.js"
import type { SignService } from "./sign.js"
import { SignService as Sign } from "./sign.js"

/** 每日签到任务要用到的东西 */
export interface SignTaskDeps {
  /** Cookie 池，只用到列表与停用 */
  cookies: Pick<CookiePool, "list" | "disable">
  /** 签到开关与流水 */
  signs: SignStore
  /** 签到服务 */
  sign: Pick<SignService, "run">
  /** 日志器 */
  logger: Logger
  /**
   * 把结果推给绑定者
   *
   * 由 index.ts 接到在线 Bot 上。返回假表示推不出去（不是好友、Bot 不在线），
   * 此时只记日志。
   */
  notify: (user: string, text: string) => Promise<boolean>
  /** 取消信号，由 `ctx.cron` 给出；超时或插件卸载时中止剩下的账号 */
  signal?: AbortSignal
}

/** 一轮自动签到的统计 */
export interface SignTaskResult {
  /** 开了自动签到的账号数 */
  total: number
  /** 本轮真的签了的账号数 */
  ran: number
  /** 因今天已签过而跳过的账号数 */
  skipped: number
  /** 出错的账号数 */
  failed: number
}

/**
 * 跑一轮每日自动签到
 * @param deps 依赖
 * @returns 统计
 */
export async function dailySign(deps: SignTaskDeps): Promise<SignTaskResult> {
  const out: SignTaskResult = { total: 0, ran: 0, skipped: 0, failed: 0 }
  const records = await deps.cookies.list()

  for (const record of records) {
    if (deps.signal?.aborted) break
    if (record.disabled) continue
    const state = await deps.signs.get(record.ltuid)
    if (!state.enabled) continue
    out.total += 1
    // 今天已经签过：框架重启会让定时任务重排一次，没有这一道就会在同一天签第二次
    if (await deps.signs.signedToday(record.ltuid)) {
      out.skipped += 1
      continue
    }

    try {
      const report = await deps.sign.run({ ltuid: record.ltuid, cookie: record.cookie })
      const text = Sign.text(report)
      if (report.dead) await deps.cookies.disable(record.ltuid, "ck 已失效，请发送「#刷新ck」")
      const ok = report.items.some(one => one.status === "signed" || one.status === "already")
      await deps.signs.mark(record.ltuid, ok, text)
      out.ran += 1

      if (record.owner && text) {
        // 推送失败不算签到失败：签到已经落到米游社了，重签一遍毫无意义
        const sent = await deps.notify(record.owner, `【米游社自动签到】\n${text}`)
        if (!sent) deps.logger.warn(`[米游社][签到] 结果推送失败，账号 ${record.ltuid}`)
      }
    } catch (err) {
      out.failed += 1
      // 一个账号出错不影响后面的：否则第一个人的网络抖动会让当天剩下的人全都没签
      deps.logger.warn(
        `[米游社][签到] 账号 ${record.ltuid} 签到出错：${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  return out
}
