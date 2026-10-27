/**
 * 模块职责：Cookie 相关命令 —— 绑定 / 删除 / 状态 / 全部概况
 * 依赖方向：依赖 session / text / region 与命令层依赖包；不认识 `MessageEvent`
 * 生命周期：无状态函数，每次命令调用一次
 * 注意事项：**群聊中一律不受理 Cookie**（一份 CK 等同于完整登录态）：直接拒绝并要求撤回后
 *          私聊重发，而不是"先绑定再提示撤回"。
 *
 *          删除 CK 仅删除 CK，不影响已绑定的游戏 uid —— 面板、抽卡等公开查询仍可进行。
 */
import type { Session } from "../core/session.js"
import { maskLtuid, stamp, INDENT } from "../core/text.js"
import { GAME_KEYS, GAME_NAMES } from "../core/region.js"
import type { BindResult } from "../service/mys.js"
import { syncIndexInfo } from "./_face.js"
import type { MhyDeps } from "./deps.js"

/** Cookie 获取指引，回复使用者时原样发出 */
const CK_GUIDE = [
  "请使用电脑浏览器登录 https://user.mihoyo.com/ ，按 F12 打开控制台，粘贴并回车执行：",
  "javascript:(()=>{prompt('复制下面这一整段',document.cookie)})()",
  "将弹出的整段内容发送至此即可（仅可在私聊中发送）"
].join("\n")

/**
 * 把绑定时取回的昵称与等级写进面板库，并顺带取一次头像
 *
 * **绝区零只有这一条路取得到这两项**：另两个游戏的展柜源会给昵称与等级，而绝区零两个面板源都不给，
 * 不落它则 `#uid` 那张图上恒印「暂无 uid 信息」。落进面板库而非另立一处，是因为 `#uid` 一律读本地
 * 面板库、不发请求。逐字段合并，故不会冲掉面板更新带回的头像与名片。
 * 写进绑定者自己名下（面板库按用户分键）。
 *
 * 头像**每个游戏只对当前那个 uid 打一次 `index`**（见 {@link syncIndexInfo}）：一个米游社账号下
 * 可能挂着十几个 uid，逐个打等于绑定一次就撞一轮风控。其余 uid 的头像由各自第一次查询顺带落下。
 * @param deps 依赖
 * @param user 绑定者
 * @param out 绑定结果
 */
export async function saveBindRoles(deps: MhyDeps, user: string, out: BindResult): Promise<void> {
  const store = deps.panels?.of(user)
  for (const game of GAME_KEYS) {
    const roles = out.roles?.[game] ?? []
    for (const role of roles) {
      if (role.name === undefined && role.level === undefined) continue
      // 页头只读头像库那条固定信息，故两处都要写；只写面板库则绝区零页头恒印「绳匠」
      await deps.faces?.merge(game, role.uid, {
        ...(role.name !== undefined ? { name: role.name } : {}),
        ...(role.level !== undefined ? { level: role.level } : {})
      })
      if (!store) continue
      const player = await store.load(game, role.uid)
      if (role.name !== undefined) player.name = role.name
      if (role.level !== undefined) player.level = role.level
      await store.save(player)
    }
    const first = roles[0]?.uid ?? out.uids?.[game]?.[0]
    if (first) await syncIndexInfo(deps, user, game, first)
  }
}

/**
 * `#绑定CK`
 *
 * 私聊中未附带 Cookie 时将追加询问一次，使用者无需先行查阅命令格式。
 * @param s 会话
 * @param deps 依赖
 */
export async function bindCk(s: Session, deps: MhyDeps): Promise<void> {
  if (!s.isPrivate) {
    const leaked = s.rest ? "请立刻撤回该条消息，此 Cookie 已视为泄露，撤回后须重新获取一份。" : ""
    await s.text(`${leaked}绑定 Cookie 只能私聊进行，请私聊发送「#绑定CK」`)
    return
  }

  const cookie = s.rest || (await s.ask(`请粘贴 Cookie，60 秒内有效\n${CK_GUIDE}`))
  if (!cookie) {
    await s.text("未收到 Cookie，本次绑定已取消，如需重新绑定请再次发送「#绑定CK」")
    return
  }

  const out = await deps.mys.bind(cookie, { user: s.user })
  if (!out.ok) {
    await s.text(`绑定失败：${out.message ?? "该 Cookie 不可用"}\n\n${CK_GUIDE}`)
    return
  }

  await saveBindRoles(deps, s.user, out)

  const uids = GAME_KEYS.filter(game => out.uids?.[game]?.length).map(
    game => `${GAME_NAMES[game]}：${out.uids?.[game]?.join("、")}`
  )
  await s.text(
    [
      `绑定成功，米游社账号 ${maskLtuid(out.ltuid ?? "")}`,
      ...uids,
      "已为该账号固定分配一台设备，此后每次请求均使用该设备。满一天后米游社会将其视为常用设备，验证码随之减少"
    ].join("\n")
  )
}

/**
 * `#删除CK`
 *
 * 名下仅有一条时无需指定，此为最常见情形；存在多条时要求写明序号（或完整 ltuid），以避免误删。
 * @param s 会话
 * @param deps 依赖
 */
export async function deleteCk(s: Session, deps: MhyDeps): Promise<void> {
  const owned = await deps.cookies.owned(s.user)
  if (!owned.length) {
    await s.text("您名下未绑定任何 Cookie")
    return
  }

  const want = s.rest.replace(/^ltuid[=:]?/i, "").trim()
  const target = !want
    ? owned.length === 1
      ? owned[0]
      : undefined
    : /^\d{1,2}$/.test(want)
      ? owned[Number(want) - 1]
      : owned.find(it => it.ltuid === want)
  if (!target) {
    // 按序号列、账号打码：这条群里也能发，列全串等于把名下 ltuid 公开
    await s.text(
      [
        want ? `您名下不存在 ${want} 该账号或序号。` : "您名下存在多条 Cookie，请按序号指定需删除的一项：",
        ...owned.map((it, i) => `#删除CK${i + 1}${INDENT}米游社 ${maskLtuid(it.ltuid)}`)
      ].join("\n")
    )
    return
  }

  await deps.mys.unbind(target.ltuid)
  // 签到记录（含自动签到开关）按 ltuid 存，不清则同一账号被别人重绑后照签、结果推给新主人
  await deps.signs?.remove(target.ltuid)
  await s.text(
    `已删除米游社账号 ${maskLtuid(target.ltuid)} 的 Cookie，设备信息一并清理。你绑的游戏 uid 还留着，面板、抽卡等公开查询不受影响`
  )
}

/**
 * `#我的CK` / `#CK状态`
 * @param s 会话
 * @param deps 依赖
 */
export async function ckStatus(s: Session, deps: MhyDeps): Promise<void> {
  const owned = await deps.cookies.owned(s.user)
  if (!owned.length) {
    await s.text("您名下未绑定任何 Cookie，请发送「#绑定CK」查看绑定方式")
    return
  }

  const blocks: string[] = []
  for (const it of owned) {
    const usage = await deps.cookies.usage(it.ltuid)
    const uids = GAME_KEYS.filter(game => it.uids[game]?.length).map(
      game => `${GAME_NAMES[game]} ${it.uids[game]?.join("/")}`
    )
    // 不印查询次数：自己的 CK 只给自己查，次数对本人没有意义；只在用不了时说明原因
    const state = usage.disabled
      ? `${INDENT}已停用：${usage.reason ?? "原因未知"}`
      : usage.blocked
        ? `${INDENT}米游社已限制今日查询，零点后恢复`
        : ""
    blocks.push(
      [
        `米游社 ${maskLtuid(it.ltuid)}`,
        ...(state ? [state] : []),
        uids.length ? `${INDENT}${uids.join("；")}` : `${INDENT}名下未查询到角色`,
        `${INDENT}绑定于 ${stamp(it.at)}`
      ].join("\n")
    )
  }
  await s.text(blocks.join("\n"))
}

/**
 * `#CK池`（仅主人）—— 全部 CK 的概况
 *
 * 给出总数、当前可用条数与已停用清单，供主人快速核对；逐国服 / 国际服的完整统计见 `#用户统计`。
 * @param s 会话
 * @param deps 依赖
 */
export async function ckPool(s: Session, deps: MhyDeps): Promise<void> {
  const all = await deps.cookies.list()
  if (!all.length) {
    await s.text("当前尚无任何 Cookie")
    return
  }

  let used = 0
  let usable = 0
  const dead: string[] = []
  for (const it of all) {
    const usage = await deps.cookies.usage(it.ltuid)
    used += usage.used
    if (it.disabled) dead.push(`${INDENT}${maskLtuid(it.ltuid)}：${it.reason ?? "原因未知"}`)
    // 服务端判到顶的（`blocked`）看着未停用、其实挑不出来，不算可用
    else if (!usage.blocked) usable += 1
  }

  await s.text(
    [
      `Cookie 共 ${all.length} 条，当前可用 ${usable} 条`,
      `今日已查 ${used} 次`,
      ...(dead.length ? [`停用 ${dead.length} 条：`, ...dead] : [])
    ].join("\n")
  )
}

/**
 * `#CK代码`
 *
 * 单独成一条命令而不并入帮助：使用者需要的是一段可直接粘贴进控制台的文本，
 * 混在教程里会被连同说明文字一起复制。
 * @param s 会话
 */
export async function ckCode(s: Session): Promise<void> {
  await s.text("javascript:(()=>{prompt('复制下面这一整段',document.cookie)})()")
}

/**
 * `#CK帮助`
 * @param s 会话
 */
export async function ckHelp(s: Session): Promise<void> {
  await s.text(
    [
      CK_GUIDE,
      "",
      "绑定后可查询体力、札记、深渊等需要账号权限的数据。",
      "仅需查询公开数据时，发送「#绑定uid100000001」即可，无须提供 Cookie。"
    ].join("\n")
  )
}
