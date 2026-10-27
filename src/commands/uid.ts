/**
 * 模块职责：游戏 uid 相关命令 —— 绑定 / 切换 / 删除 / 查看
 * 依赖方向：依赖 session / region 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：uid 与 Cookie 是两件事，本模块一概不涉及 Cookie —— 没有 CK 也能绑 uid。
 *
 *          序号（`#切换uid2`、`#uid2`）与完整 uid 都认，判定在 `UserStore.switchUid`；
 *          `#uid2` 走 {@link myUid} 内的转发，故那一支不改就会被当成"看列表"而丢掉序号。
 *          绑定 / 切换 / 删除成功后一律出列表图，出不了图才退回带状态行的文字。
 */
import type { Session } from "../core/session.js"
import type { GameKey } from "../core/region.js"
import { COMMAND_PREFIX, GAME_KEYS, GAME_NAMES, REGION_NAMES, isValidUid, resolveRegionKind } from "../core/region.js"
import { INDENT } from "../core/text.js"
import type { UidListInput } from "../views/uid.js"
import { buildUidList, uidListText } from "../views/uid.js"
import { charImgs } from "../views/panel.js"
import type { MhyDeps } from "./deps.js"

/**
 * 把 uid 列表排成带序号的可读形态
 * @param uids uid 数组，第一个是当前 uid
 * @param game 游戏
 * @returns 每行一个 uid 的文本
 */
function listUids(uids: readonly string[], game: GameKey): string {
  return uids
    .map((uid, index) => {
      const region = REGION_NAMES[resolveRegionKind(uid, game)]
      return `${index + 1}. ${uid}（${region}）${index === 0 ? `${INDENT}← 当前使用` : ""}`
    })
    .join("\n")
}

/**
 * 出 uid 列表图；出不了图时退回纯文字，`status` 作为文字形态的首行状态
 *
 * 三个游戏一并展示，与 `#我的uid` 同一张图。绑定 / 切换 / 删除成功后共用它，故那几条命令的
 * 结果都是图而非文字。
 * @param s 会话
 * @param deps 依赖
 * @param status 出图失败时置于文字最前的状态行；不给则只出列表
 */
async function showUidList(s: Session, deps: MhyDeps, status?: string): Promise<void> {
  const input: UidListInput = {}
  for (const game of GAME_KEYS) {
    const uids = await deps.users.uids(s.user, game)
    if (uids.length) {
      const { ck, device } = await ckUids(deps, game, uids, s.user)
      input[game] = { uids, ckUids: ck, deviceUids: device, info: await uidInfo(deps, s.user, game, uids) }
    }
  }

  const view = buildUidList(input)
  if (view.uids.every(it => !it.uidList.length)) {
    await s.text(`尚未绑定${GAME_NAMES[s.game]}的 uid，请发送「${COMMAND_PREFIX[s.game]}绑定uid100000001」`)
    return
  }
  // 三个游戏并列一张图：外框走中性皮肤、各段自带皮肤；不给则外框随发起命令的游戏换皮，那套皮肤的规则还会渗进另两段
  if (await s.image("user/uid-list", { ...view, _skin: "skin-neutral" })) return
  await s.text(status ? [status, uidListText(view)].join("\n") : uidListText(view))
}

/**
 * `#绑定uid` / `#绑定<uid>`
 * @param s 会话
 * @param deps 依赖
 */
export async function bindUid(s: Session, deps: MhyDeps): Promise<void> {
  const uid = s.rest.replace(/\s+/g, "")
  if (!isValidUid(uid)) {
    await s.text(`要带上 uid，如「${COMMAND_PREFIX[s.game]}绑定uid100000001」`)
    return
  }

  const list = await deps.users.addUid(s.user, s.game, uid)
  if (!list) {
    await s.text("无法继续绑定，单个游戏最多绑定 20 个 uid，请先使用「#删除uid」释放名额")
    return
  }
  await showUidList(s, deps, `${GAME_NAMES[s.game]} uid 已绑定并切到 ${uid}`)
}

/**
 * `#我的uid` / `#uid<序号>`
 *
 * 裸 `#uid` 看列表；带序号的 `#uid2` 转给 {@link switchUid}（框架把命令词后的 `2` 交作 rest）。
 * @param s 会话
 * @param deps 依赖
 */
export async function myUid(s: Session, deps: MhyDeps): Promise<void> {
  if (/^\d{1,2}$/.test(s.rest.trim())) {
    await switchUid(s, deps)
    return
  }
  await showUidList(s, deps)
}

/**
 * 逐 uid 取昵称、等级、头像与横幅
 *
 * **一律读本地，不发任何请求**：这张图上可以有六十行，逐行打一次 `index` 会把一条从不失败的
 * 本地命令变成会撞风控的查询。头像读头像库（与各页页头同一份，见 store/face.ts），取不到时由
 * 视图层垫该游戏的默认图；横幅仍取面板库里那个角色的，元数据没装时不给这个键。
 * @param deps 依赖
 * @param user 发起者，只读他名下的面板库
 * @param game 游戏
 * @param uids 该游戏绑定的全部 uid
 * @returns uid → 玩家信息
 */
async function uidInfo(
  deps: MhyDeps,
  user: string,
  game: GameKey,
  uids: readonly string[]
): Promise<Record<string, { name?: string; level?: number; face?: string; banner?: string }>> {
  const store = deps.panels?.of(user)
  if (!store) return {}
  const loader = deps.meta?.loader
  const out: Record<string, { name?: string; level?: number; face?: string; banner?: string }> = {}

  for (const uid of uids) {
    const player = await store.load(game, uid)
    const one: { name?: string; level?: number; face?: string; banner?: string } = {}
    if (player.name) one.name = player.name
    const level = Number(player.level) || 0
    if (level > 0) one.level = level

    const face = await deps.faces?.pick(game, uid)
    if (face) one.face = face

    // 横幅按面板库里记下的那个角色取；原神的 `face` 是展柜头像那个角色 id，另两个游戏取第一位
    const id = (game === "gs" && player.face ? String(player.face) : "") || Object.keys(player.avatars)[0] || ""
    const name = id ? loader?.byId(game, id)?.name : undefined
    if (name) {
      const imgs = charImgs({
        game,
        name,
        ...(loader ? { exists: (rel: string): boolean => loader.exists(rel) } : {})
      })
      if (imgs["banner"]) one.banner = imgs["banner"]
    }
    out[uid] = one
  }
  return out
}

/**
 * 挑出其中由 CK 带来的 uid，以及其中查询时走绑定真机的那些
 *
 * 只认发起者自己的 CK：别人的 CK 此人用不了，标成 CK 会误导成「可查私有数据」。
 *
 * 两项一趟查完：设备以米游社账号为单位，判它要先由 uid 找到 CK 拿 ltuid，而那正是判 CK
 * 归属时已经做过的一次查询；分成两个函数就把这张图上的库查询翻一倍。
 * @param deps 依赖
 * @param game 游戏
 * @param uids 待判定的 uid
 * @param user 发起者
 * @returns `ck` 为已绑 CK 的那些，`device` 为其中走绑定真机的那些
 */
async function ckUids(
  deps: MhyDeps,
  game: GameKey,
  uids: readonly string[],
  user: string
): Promise<{ ck: string[]; device: string[] }> {
  const ck: string[] = []
  const device: string[] = []
  for (const uid of uids) {
    const found = await deps.cookies.find(uid, game, user)
    if (!found) continue
    ck.push(uid)
    if (await deps.devices.bound(found.ltuid)) device.push(uid)
  }
  return { ck, device }
}

/**
 * `#切换uid`
 * @param s 会话
 * @param deps 依赖
 */
export async function switchUid(s: Session, deps: MhyDeps): Promise<void> {
  const want = s.rest.replace(/\s+/g, "")
  const list = await deps.users.uids(s.user, s.game)
  if (!list.length) {
    await s.text(`尚未绑定${GAME_NAMES[s.game]}的 uid，请先发送「${COMMAND_PREFIX[s.game]}绑定uid100000001」`)
    return
  }
  if (!want) {
    await s.text(
      [`请指定目标 uid，可按「${COMMAND_PREFIX[s.game]}切换uid2」的形式填写序号：`, listUids(list, s.game)].join("\n")
    )
    return
  }

  const uid = await deps.users.switchUid(s.user, s.game, want)
  if (!uid) {
    await s.text([`没找到 ${want} 这个 uid 或序号：`, listUids(list, s.game)].join("\n"))
    return
  }
  await showUidList(s, deps, `已切到 ${uid}`)
}

/**
 * `#删除uid`
 *
 * 序号在本层转成 uid 再删：`removeUid` 只接受 uid。
 * @param s 会话
 * @param deps 依赖
 */
export async function deleteUid(s: Session, deps: MhyDeps): Promise<void> {
  const want = s.rest.replace(/\s+/g, "")
  const list = await deps.users.uids(s.user, s.game)
  if (!list.length) {
    await s.text(`尚未绑定${GAME_NAMES[s.game]}的 uid`)
    return
  }
  if (!want) {
    await s.text(
      [`请指定待删除的 uid，可按「${COMMAND_PREFIX[s.game]}删除uid2」的形式填写序号：`, listUids(list, s.game)].join("\n")
    )
    return
  }

  const uid = /^\d{1,2}$/.test(want) ? list[Number(want) - 1] : want
  const next = uid ? await deps.users.removeUid(s.user, s.game, uid) : undefined
  if (!next) {
    await s.text([`没找到 ${want} 这个 uid 或序号：`, listUids(list, s.game)].join("\n"))
    return
  }
  if (!next.length) {
    await s.text(`已删除 ${uid}，${GAME_NAMES[s.game]}的 uid 已全部清空`)
    return
  }
  await showUidList(s, deps, `已删除 ${uid}，当前 uid 变更为 ${next[0]}`)
}
