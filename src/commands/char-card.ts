/**
 * 模块职责：角色卡片命令 —— `#胡桃`、`#我的三月七`
 * 依赖方向：依赖 views/char-card 与命令层依赖包；取数走 panels / panelBuilder
 * 生命周期：无状态函数
 * 注意事项：**触发形态是裸角色名，故它必须是全部命令里最后匹配的那一条**（命令表里只给
 *          一条正则别名 + `priority` 排在最末），且**认不出角色名时静默退出** —— 它每条
 *          `#` 开头的消息都会过一遍，出声意味着任何笔误都会招来一句报错。
 *
 *          没有面板数据也出图（卡片只画角色名、立绘与一句提示），故不先判 `isPanelReady`。
 *          唯元数据缺失时退出：连"这是不是一个角色名"都判不出来。
 */
import type { Session } from "../core/session.js"
import { isSuperPanel, splashDirName } from "../panel/img.js"
import { isGsTraveler, isSelfCalcGame } from "../panel/profile/index.js"
import { isPanelReady } from "../store/panel.js"
import { buildCharCard, buildZzzCharCard, charCardText } from "../views/char-card.js"
import { talentFrameOf } from "../views/char-talent.js"
import type { CharCardContext } from "../views/char-card.js"
import { originalPathOf, rememberOriginal } from "./original.js"
import type { MhyDeps } from "./deps.js"
import { GENDER_PAIR } from "./panel.js"

/**
 * 从消息里剥掉那些不属于角色名的词
 *
 * `#我的胡桃`、`#胡桃卡片` 都该落到胡桃。
 *
 * **「老婆 / 老公」不在此处剥。** 与「我的」一并剥掉则 `#老婆` 剥完只剩空串、
 * 这条命令静默退出 —— 表现为发「#老婆」什么都不回。那一族由 commands/wife.ts 单独接管
 * （它要从四类名单里挑人、还认「设置」「是谁」两支），故这里放手：`#老婆` 由更靠前的
 * 那条命令吃掉，落不到这里来。
 * @param rest 命令之后的内容
 * @returns 角色名候选
 */
export function charNameOf(rest: string): string {
  return rest
    .replace(/(?:18|[1-9])\d{8}/g, "")
    .replace(/我的|卡片/g, "")
    .trim()
}

/**
 * `#<角色名>` —— 角色卡片
 *
 * 认不出角色名时静默退出，理由见文件头。
 * @param s 会话
 * @param deps 依赖
 */
export async function charCard(s: Session, deps: MhyDeps): Promise<void> {
  await charCardOf(s, deps, charNameOf(s.rest))
}

/**
 * 按角色名出一张卡片
 *
 * 从 {@link charCard} 里分出来，供 `#老婆` 一族复用（见 commands/wife.ts）：那一族挑的
 * 也是一个角色，只是挑法不同 —— 另做一张图只会得到两套要各自维护的版式。
 *
 * **认不出角色名一律静默退出**（包括游戏不支持、元数据没装、名字为空这几种）：本函数的
 * 主调用方 {@link charCard} 会过一遍每条 `#` 开头的消息，出声等于把所有笔误都变成一句报错。
 * 需要出声的调用方（如 `#老婆`）应在调用之前自己把话说完。
 * @param s 会话
 * @param deps 依赖
 * @param name 角色名，已剥掉修饰词
 */
export async function charCardOf(s: Session, deps: MhyDeps, name: string): Promise<void> {
  if (s.game === "zzz") {
    await zzzCharCard(s, deps, name)
    return
  }
  // 用类型守卫而非字面量清单：清单判不收窄，后面还得补一次 as
  if (!isSelfCalcGame(s.game)) return
  const game = s.game
  const loader = deps.meta?.loader
  const builder = deps.panelBuilder
  // 元数据缺失时连"这是不是角色名"都判不出，故只能退出。也不出声，理由见上
  if (!loader || !builder) return

  if (!name) return
  const item = loader.byName(game, name)
  if (!item?.id) return

  const uid = (await deps.users.uid(s.user, game)) || ""

  // 面板数据可有可无：没有时视图层出一张只有立绘与提示的卡片
  let stored = uid ? await deps.panels?.of(s.user).avatar(game, uid, item.id) : undefined
  // 旅行者 / 开拓者的别名只指向规范性别，存档里可能是另一性别（同 `#面板`）
  const pair = GENDER_PAIR[item.id]
  if (uid && pair && !isPanelReady(stored, game)) {
    const alt = await deps.panels?.of(s.user).avatar(game, uid, pair)
    if (isPanelReady(alt, game)) stored = alt
  }
  const panel = isPanelReady(stored, game) && stored ? builder.build(game, uid, stored) : undefined

  const ctx: CharCardContext = { game, uid, name: item.name }
  if (item.abbr) ctx.abbr = item.abbr
  if (item.star) ctx.star = item.star
  if (item.elem) ctx.elem = item.elem
  if (loader.exists) ctx.exists = (rel: string): boolean => loader.exists(rel)

  // 天赋图标要按命座折算（三命提升战技的角色，其战技图标用那个命座的图），
  // 那张对照表在整份 data.json 里
  const elem = panel?.elem ?? item.elem
  const detail = loader.detail(game, item.id, elem)
  if (detail?.talentCons) ctx.talentCons = detail.talentCons
  if (panel?.weapon?.type) ctx.weaponType = panel.weapon.type
  else if (item.weapon) ctx.weaponType = item.weapon

  // 只有原神旅行者的图标按元素分目录，给其他角色设上会指向不存在的目录。
  if (elem && game === "gs" && isGsTraveler(item.id)) ctx.travelerElem = elem

  // 练满的角色优先用超级面板图，与 `#胡桃面板` 同一套判据。
  // `enableCustomSplash` 关掉时一张都不挑，视图层随之回落到元数据里的官方立绘
  const store = deps.config().enableCustomSplash ? deps.panelImgs : undefined
  if (store) {
    const dir = splashDirName(panel?.name ?? item.name, deps.config().srSharedSplashDir)
    const superFirst =
      panel !== undefined &&
      isSuperPanel({
        game,
        cons: panel.cons,
        talent: panel.talent,
        trees: panel.trees,
        ...(panel.mark?.markClass ? { markClass: panel.mark.markClass } : {})
      })
    const got = store.pick(dir, superFirst)
    if (got) ctx.splash = got
  }

  const view = buildCharCard(ctx, panel)
  // 天赋图标是白色线稿，浅色皮肤上不垫元素框就看不见；框图与排行同一套（见 char-talent.ts 的 talentFrameOf）
  const frame = talentFrameOf(game, view.elem)
  if (await s.image("character/character-card", { ...view, frame })) {
    // `splash` 是上传的那张、`gacha` 是元数据里的回落，两者的根不同
    const path = view.splash
      ? originalPathOf(deps, view.splash, true)
      : originalPathOf(deps, view.gacha ?? "", false)
    if (path) await rememberOriginal(s, deps, { kind: "character", path })
    return
  }
  await s.text(charCardText(view))
}

/**
 * 绝区零那一路的角色卡片：读绝区零面板库，同一张模板
 *
 * 认不出名字同样静默退出（理由见文件头）；面板库没有这一位时仍出只有立绘的那一张。
 * @param s 会话
 * @param deps 依赖
 * @param name 代理人名
 */
async function zzzCharCard(s: Session, deps: MhyDeps, name: string): Promise<void> {
  const loader = deps.meta?.loader
  if (!loader?.ready("zzz") || !name) return
  const item = loader.byName("zzz", name)
  // 音擎、驱动盘与邦布也在同一张 byName 索引里，只认代理人
  if (!item?.id || item.kind !== "character") return
  const uid = (await deps.users.uid(s.user, "zzz")) || ""
  const stored = uid ? await deps.panels?.of(s.user).avatar("zzz", uid, item.id) : undefined
  const mark = stored?.zzz && uid ? deps.zzzPanelBuilder?.build(uid, stored)?.mark : undefined
  const weapon = stored?.zzz?.weapon ? loader.byName("zzz", stored.zzz.weapon.name) : undefined
  const view = buildZzzCharCard(
    {
      uid,
      name: item.name,
      ...(item.abbr ? { abbr: item.abbr } : {}),
      ...(weapon?.icon ? { weaponImg: weapon.icon } : {}),
      ...(mark ? { markClass: mark.markClass } : {}),
      exists: (rel: string): boolean => loader.exists(rel)
    },
    stored?.zzz ? stored : undefined
  )
  const frame = talentFrameOf("zzz", view.elem)
  if (await s.image("character/character-card", { ...view, frame })) {
    const path = originalPathOf(deps, view.gacha ?? "", false)
    if (path) await rememberOriginal(s, deps, { kind: "character", path })
    return
  }
  await s.text(view.hasData ? `${view.name} Lv.${view.level}\u3000${view.cons} 影画` : view.tip)
}
