/**
 * 模块职责：`#七圣卡组`（含列表与单副）与 `#七圣卡牌`（收集度）
 * 依赖方向：依赖 views/gs/gcg 与命令层依赖包；三个接口都走米游社战绩的 gcg 一族
 * 生命周期：无状态函数
 * 注意事项：**`#七圣卡组` 与 `#七圣卡组列表`、`#七圣卡组2` 只能是同一条命令** —— 前者是后两者
 *          的前缀，前缀路由下注册多条必定互相遮挡。序号由 `rest` 带进来：有数字画那一副，
 *          没数字画全部。
 *
 *          卡牌收集度要打三个接口，故先回一句"卡牌数据获取中"；任一接口失败即整体退出，
 *          不画半张图。
 */
import type { Session } from "../../core/session.js"
import { failText } from "../../core/text.js"
import type { ActionCardRaw, AvatarCardRaw, DeckListRaw, GcgBasicRaw } from "../../views/gs/index.js"
import { buildDeck, buildDeckCards, deckCardText, deckText } from "../../views/gs/index.js"
import type { MhyDeps } from "../deps.js"

/** 只有原神有七圣召唤 */
const GCG_TIP = "七圣召唤只有原神有"

/**
 * `#七圣卡组` / `#七圣卡组列表` / `#七圣卡组2` —— 编好的牌组
 * @param s 会话
 * @param deps 依赖
 */
export async function gcgDeck(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "gs") {
    await s.text(GCG_TIP)
    return
  }

  const digits = /\d{1,2}/.exec(s.rest)?.[0]
  const res = await deps.mys.query<DeckListRaw | null>("deckList", {
    user: s.user,
    game: "gs"
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const view = buildDeck(res.data, res.uid, digits === undefined ? undefined : Number(digits))
  if (!view) {
    await s.text(`无牌组${digits}，请查看 #七圣卡组列表`)
    return
  }
  if (await s.image(digits === undefined ? "gs/gcg-deck-list" : "gs/gcg-deck", view)) return
  await s.text(deckText(view))
}

/**
 * `#七圣卡牌` / `#七圣角色牌` / `#七圣行动牌` —— 卡牌收集度
 *
 * 指定了角色或行动时只打那一个列表接口。
 * @param s 会话
 * @param deps 依赖
 */
export async function gcgCards(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "gs") {
    await s.text(GCG_TIP)
    return
  }

  const onlyAvatar = s.rest.includes("角色")
  const onlyAction = s.rest.includes("行动")
  await s.text("卡牌数据获取中...")

  const basic = await deps.mys.query<GcgBasicRaw | null>("basicInfo", { user: s.user, game: "gs" })
  if (!basic.ok) {
    await s.text(failText(basic))
    return
  }

  let avatars: { card_list?: AvatarCardRaw[] } | undefined
  if (!onlyAction) {
    const got = await deps.mys.query<{ card_list?: AvatarCardRaw[] } | null>("avatar_cardList", {
      user: s.user,
      game: "gs"
    })
    if (!got.ok) {
      await s.text(failText(got))
      return
    }
    avatars = got.data ?? {}
  }

  let actions: { card_list?: ActionCardRaw[] } | undefined
  if (!onlyAvatar) {
    const got = await deps.mys.query<{ card_list?: ActionCardRaw[] } | null>("action_cardList", {
      user: s.user,
      game: "gs"
    })
    if (!got.ok) {
      await s.text(failText(got))
      return
    }
    actions = got.data ?? {}
  }

  const view = buildDeckCards(basic.data, avatars, actions, basic.uid)
  if (await s.image("gs/gcg-deck-card", view)) return
  await s.text(deckCardText(view))
}
