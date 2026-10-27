/**
 * 模块职责：元数据管理命令 —— `#更新元数据` / `#元数据状态`
 * 依赖方向：依赖 session 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：三份合计约 350MB 且耗时数分钟，故**先回一条"已开始"再在后台下载**。
 *
 *          仅主人可用。
 */
import type { MetaGame } from "../meta/download.js"
import { META_GAMES, PACK_MB } from "../meta/download.js"
import type { Session } from "../core/session.js"
import { INDENT } from "../core/text.js"
import type { MhyDeps } from "./deps.js"

/** 结果分类 → 使用者能看懂的说法 */
const STATUS_TEXT: Readonly<Record<string, string>> = {
  exists: "已存在",
  latest: "已是最新",
  install: "安装完成",
  update: "更新完成",
  full: "已重新完整下载",
  pending: "增量尚未就绪",
  error: "失败"
}

/**
 * 认出这一条要处理哪个游戏
 *
 * 判据两处：先看命令文本里有没有写明，再看会话上的游戏标记（前缀已被中间件规整掉）。
 * 不带前缀的 `#更新元数据` 仍是三个都要 —— 原神前缀同时也是缺省前缀。
 * @param s 会话
 * @returns 游戏列表
 */
function pickGames(s: Session): MetaGame[] {
  if (/星铁|星穹|崩铁|sr/i.test(s.rest)) return ["sr"]
  if (/原神|gs/i.test(s.rest)) return ["gs"]
  if (/绝区零|绝区|zzz/i.test(s.rest)) return ["zzz"]
  if (s.game === "sr") return ["sr"]
  if (s.game === "zzz") return ["zzz"]
  return [...META_GAMES]
}

/** 更新说明最多列几条 */
const MAX_MESSAGES = 8

/**
 * `#更新元数据`
 *
 * 附加「强制」时重下完整包 —— 增量应用出错留下坏文件时，这是唯一的出路。
 * @param s 会话
 * @param deps 依赖
 */
export async function updateMeta(s: Session, deps: MhyDeps): Promise<void> {
  const meta = deps.meta
  if (!meta) {
    await s.text("元数据服务未启用")
    return
  }

  const games = pickGames(s)
  const running = games.filter(game => meta.installer.busy(game))
  if (running.length > 0) {
    await s.text(`meta-${running.join("、meta-")} 正在下载，完成后会回一条消息，请勿重复执行`)
    return
  }

  const force = /强制|重装|重新/.test(s.rest)
  const size = games.reduce((sum, game) => sum + PACK_MB[game], 0)
  await s.text(
    `开始${force ? "强制重新" : ""}下载元数据（${games.join("、")}），首次约 ${size}MB，完成后会再回一条。期间请勿重复执行`
  )

  const lines: string[] = []
  for (const game of games) {
    try {
      const ret = await meta.installer.install(game, { force })
      lines.push(`meta-${game}：${STATUS_TEXT[ret.status] ?? ret.status}${ret.count ? `（${ret.count} 个提交）` : ""}`)
      for (const one of (ret.messages ?? []).slice(-MAX_MESSAGES)) {
        lines.push(`${INDENT}${one.split("\n")[0] ?? ""}`)
      }
      const rest = (ret.messages?.length ?? 0) - MAX_MESSAGES
      if (rest > 0) lines.push(`${INDENT}……另有 ${rest} 条`)
    } catch (err) {
      lines.push(`meta-${game}：失败 —— ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  meta.reload()
  await s.text(lines.join("\n"))
}

/**
 * `#元数据状态`
 * @param s 会话
 * @param deps 依赖
 */
export async function metaStatus(s: Session, deps: MhyDeps): Promise<void> {
  const meta = deps.meta
  if (!meta) {
    await s.text("元数据服务未启用")
    return
  }

  const lines = META_GAMES.map(game => {
    if (meta.installer.installed(game)) {
      return `meta-${game}：已安装（${meta.installer.localSha(game).slice(0, 8)}）`
    }
    // 手工放进来的那种包没有 `.sha`，故单独报一句，免得看着像没生效
    if (meta.installer.present(game)) {
      const version = meta.installer.packVersion(game)
      return `meta-${game}：已就位${version ? `（游戏版本 ${version}）` : ""}，手工放入、未记版本`
    }
    return `meta-${game}：未安装`
  })
  lines.push("元数据里的 JS 只解析其中的数据；伤害公式仅在开启伤害计算后于受限上下文中执行")
  lines.push("发送「#更新元数据」安装或更新，附加「强制」可重下完整包")
  await s.text(lines.join("\n"))
}
