/**
 * 模块职责：抽卡记录命令 —— `#抽卡链接` / `#抽卡记录` / `#删除抽卡链接`
 * 依赖方向：依赖 session / views/gacha 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**群聊中不受理抽卡链接**：authkey 一日内可读取该账号的全部抽卡历史，
 *          性质与 Cookie 相同，故与 `#绑定CK` 同一套校验。
 *
 *          `#抽卡记录` 在 authkey 过期后仍出结果 —— 读的是本地库（只增不减的全量）。
 */
import type { Session } from "../core/session.js"
import { stokenCookie } from "../core/cookie.js"
import type { AuthRecord } from "../store/gacha.js"
import type { MhyDeps } from "./deps.js"

/** 获取链接的操作指引，回复使用者时原样发出 */
const LINK_GUIDE = [
  "请在游戏中打开「祈愿 - 历史记录」页面，使用右上角的分享或复制链接功能，将完整链接发送给本机器人",
  "链接有效期为一日，其间可读取该账号的全部抽卡历史，故仅可在私聊中发送",
  "另：已「#扫码登录」的账号可直接发送「#更新抽卡记录」，凭 stoken 自动获取，无须手贴链接"
].join("\n")

/**
 * `#抽卡链接`；接收后立即同步一次
 * @param s 会话
 * @param deps 依赖
 */
export async function gachaLink(s: Session, deps: MhyDeps): Promise<void> {
  if (!s.isPrivate) {
    const leaked = s.rest ? "请立刻撤回该条消息，链接中的 authkey 已构成泄露。" : ""
    await s.text(`${leaked}抽卡链接只能私聊发送，请私聊发送「#抽卡链接」`)
    return
  }

  const link = s.rest || (await s.ask(`${LINK_GUIDE}\n60 秒内有效`))
  if (!link) {
    await s.text("未收到链接，本次操作已取消。如需重新绑定，请再次发送「#抽卡链接」")
    return
  }

  const saved = await deps.gacha.saveAuth(s.user, s.game, link)
  if (!saved.ok) {
    await s.text(`${saved.message ?? "该链接不可用"}\n\n${LINK_GUIDE}`)
    return
  }

  // 链接可用但账号一条记录都没有时认不出 uid，store 不收这份链接，本也无可同步
  if (!saved.uid) {
    await s.text("链接可用，但该账号还没有任何抽卡记录，抽过一次后再发送链接即可")
    return
  }

  // 抽卡链接中的 uid 可信，此处一并绑定并设为当前 uid，避免要求使用者再次发送 uid。
  // 先于同步做：同步失败时链接已落库，之后 `#更新抽卡记录` 按当前 uid 取到的正是这一份
  await deps.users.addUid(s.user, s.game, saved.uid)

  const synced = await deps.gacha.sync(s.user, s.game, saved.uid)
  if (!synced.ok) {
    await s.text(`链接已接收，但拉取记录时出现异常：${synced.message ?? "原因未知"}`)
    return
  }

  await s.text(
    `链接已接收，${synced.uid} 的抽卡记录同步完成，新增 ${synced.added ?? 0} 条，本地共 ${synced.total ?? 0} 条。发送「#抽卡记录」查看统计`
  )
}

/**
 * 没有有效链接时，尝试凭 stoken 自助换取 authkey
 *
 * **只用该 uid 所属账号自己的 stoken**：`genAuthKey` 的 region 与 game_uid 由这条 uid 定死，
 * 拿另一个账号的 stoken 去换只会得到 retcode 非零。故此处找名下"绑了这条 uid、且带 stoken"的
 * 那条 CK；找不到即返回空，由调用方退回手贴链接那条路 —— 这一步对没扫码登录过的使用者
 * 应当完全无感，不冒出任何多余提示。
 * @param s 会话
 * @param deps 依赖
 * @param uid 要换取的 uid，即当前 uid
 * @returns 换取并落好库的 authkey 记录；没 stoken 时 record 与 message 均缺，换取失败时带 message
 */
async function autoAuthKey(s: Session, deps: MhyDeps, uid: string): Promise<{ record?: AuthRecord; message?: string }> {
  if (!deps.authKey) return {}

  let ltuid = ""
  let stoken = ""
  for (const record of await deps.cookies.owned(s.user)) {
    if (!record.uids[s.game]?.includes(uid)) continue
    // record.stoken 已是 stoken 形态；仍过一遍 stokenCookie 以兼容"绑 CK 时把 stoken 接在后面"的写法
    const form = stokenCookie(record.stoken ? `${record.cookie}; ${record.stoken}` : record.cookie)
    if (form) {
      ltuid = record.ltuid
      stoken = form
      break
    }
  }
  if (!stoken) return {}

  const got = await deps.authKey.generate(s.game, uid, ltuid, stoken)
  if (!got.ok || !got.authkey) return got.message ? { message: got.message } : {}

  await deps.gacha.saveAuthKey(s.user, s.game, got.authkey, got.region ?? "", uid)
  const record = await deps.gacha.auth(s.user, s.game, uid)
  return record ? { record } : {}
}

/**
 * `#更新抽卡记录`
 *
 * 只做"更新"这一件事：有链接就拉增量，无链接但有 stoken 就自助换取再拉，随后**按卡池报新增条数**
 * （文字，不出图）。看记录的时间轴用 `#抽卡记录`。群聊亦可 —— 凭据早已在库、并未在此传输。
 *
 * **更新的是当前 uid**（`#切换uid` 之后即切过去的那个），链接也只取它自己那一份：
 * 链接按 uid 分开存，切换前那个 uid 的链接不会被拿来更新当前 uid。
 * @param s 会话
 * @param deps 依赖
 */
export async function gachaUpdate(s: Session, deps: MhyDeps): Promise<void> {
  const hash = s.game === "sr" ? "*" : s.game === "zzz" ? "%" : "#"
  const uid = await deps.users.uid(s.user, s.game)
  if (!uid) {
    await s.text(`还没有绑定 uid，也没有可用的抽卡链接。\n${LINK_GUIDE}`)
    return
  }

  // 当前 uid 没有有效链接时，先试着凭 stoken 自助换一份；再不行才让手贴链接
  if (!(await deps.gacha.auth(s.user, s.game, uid))) {
    const made = await autoAuthKey(s, deps, uid)
    if (!made.record) {
      await s.text(made.message ?? `${uid} 还没有可用的抽卡链接。\n${LINK_GUIDE}`)
      return
    }
  }

  const synced = await deps.gacha.sync(s.user, s.game, uid)
  if (!synced.ok) {
    await s.text(synced.message ?? "更新失败，请稍后再试")
    return
  }

  if (!synced.added) {
    await s.text(`${synced.uid} 的抽卡记录已是最新，本地共 ${synced.total ?? 0} 条。发送「${hash}抽卡记录」看出金时间轴`)
    return
  }

  const lines = (synced.pools ?? []).map(p => `「${p.name}」新增 ${p.added} 条`)
  await s.text(
    `${synced.uid} 更新完成：\n${lines.join("\n")}\n合计新增 ${synced.added} 条，本地累计 ${synced.total ?? 0} 条。发送「${hash}抽卡记录」看出金时间轴`
  )
}

/**
 * `#删除抽卡链接`
 *
 * 仅丢弃 authkey，不变更记录 —— 使用者的意图为"不再保留其凭据"，而非"删除其长期积累的记录"。
 * @param s 会话
 * @param deps 依赖
 */
export async function dropGachaLink(s: Session, deps: MhyDeps): Promise<void> {
  await deps.gacha.dropAuth(s.user, s.game)
  await s.text("已丢弃您的抽卡链接，抽卡记录还留着，可随时使用「#抽卡记录」查询")
}
