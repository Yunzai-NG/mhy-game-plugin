/**
 * 模块职责：`#胡桃换钟离武器` —— 面板替换，把改过的那份当场算一遍出图
 * 依赖方向：依赖 session / panel/change / views/panel 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：出的是既有那三张图（`mode` 按原文后缀落到哪一张），一张新模板都不加。
 *
 *          **一律不落库、不进排行**：改过的那份是假的。
 *
 *          借不到的部件只提一句，不整体失败。
 */
import { SHORT_PREFIX } from "../core/region.js"
import { UNRELEASED_TEXT } from "../core/text.js"
import type { Session } from "../core/session.js"
import { isReleased } from "../meta/loader.js"
import { applyChange, parseChange } from "../panel/change.js"
import { isSelfCalcGame } from "../panel/profile/index.js"
import type { StoredAvatar } from "../store/panel.js"
import { isPanelReady } from "../store/panel.js"
import { panelText, profileDetailData } from "../views/panel.js"
import { dmgText } from "../views/dmg.js"
import type { MhyDeps } from "./deps.js"
import { PANEL_VIEW_HELPERS } from "./panel.js"
import { zzzPanelChange } from "./zzz/index.js"

/**
 * `#<角色名>换<...>` —— 面板替换
 * @param s 会话
 * @param deps 依赖
 */
export async function panelChange(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    await zzzPanelChange(s, deps, changeText(s))
    return
  }
  // 用类型守卫而非字面量清单：清单判不收窄，后面还得补一次 as
  if (!isSelfCalcGame(s.game)) return
  const game = s.game
  const builder = deps.panelBuilder
  const loader = deps.meta?.loader
  const sets = deps.artiSets
  if (!builder || !loader || !sets) {
    await s.text("面板替换要用元数据（等级曲线、词条表与套装表都在里面），请先让主人发送「#更新元数据」")
    return
  }
  if (!builder.ready(game)) {
    await s.text("面板计算需要元数据（角色等级曲线与词条表都在里面），请先让主人发送「#更新元数据」")
    return
  }

  const parsed = parseChange(s.rest, game, { meta: loader, sets })
  if (!parsed.ok) {
    await s.text(parsed.message)
    return
  }

  const char = loader.byName(game, parsed.char)
  if (!char?.id) {
    await s.text(`没认出「${parsed.char}」是哪个角色`)
    return
  }
  if (!deps.config().enableUnreleased && !isReleased(char)) {
    await s.text(UNRELEASED_TEXT)
    return
  }

  const uid = parsed.uid || (await deps.users.uid(s.user, game)) || ""
  if (!uid) {
    await s.text("先发送「#绑定uid100000001」绑一个 uid，或在命令里带上 uid")
    return
  }

  const base = await deps.panels?.of(s.user).avatar(game, uid, char.id)
  if (!isPanelReady(base, game) || !base) {
    await s.text(`${char.name}还没有面板数据，先发送「#更新面板」取一次`)
    return
  }

  /*
   * 借部件那几支要读别的角色，可能在别的 uid 名下
   *
   * `applyChange` 是同步的（它只搬数据、不算属性），而读库是异步的，故此处**先把要用到的
   * 那几份一次读齐**再交给它 —— 让它收一个异步取数器会把那一层也变成 async，
   * 而那一层是纯函数正是它可测的原因。
   */
  const need = borrowKeys(parsed.change, uid)
  const cache = new Map<string, StoredAvatar | undefined>()
  for (const one of need) {
    const item = loader.byName(game, one.name)
    if (!item?.id) continue
    cache.set(`${one.uid}:${one.name}`, await deps.panels?.of(s.user).avatar(game, one.uid, item.id))
  }

  const { avatar, missed } = applyChange(game, base, parsed.change, uid, {
    sets,
    meta: loader,
    load: (fromUid: string, name: string): StoredAvatar | undefined => cache.get(`${fromUid}:${name}`)
  })

  const built = builder.build(game, uid, avatar)
  if (!built) {
    await s.text("改过的这份面板算不出来，请把命令发给维护者看一眼")
    return
  }

  // 没换成的那几处单独说一句：图上看不出"某一处其实没换"，而那正是使用者会误读的地方
  if (missed.length > 0) await s.text(`这几处没换成（对方没有面板数据）：${missed.join("、")}`)

  // 原面板同一套算一遍，伤害表才印得出增减；算不出就不印，不挡出图
  const before = builder.build(game, uid, base) ?? undefined
  await drawChanged(s, deps, built, parsed.mode, parsed.dmgIndex, before)
}

/**
 * 图上那行「该面板为非实际数据。当前替换命令：…」印的命令原文
 *
 * 由游戏记号与 `rest` 拼回：触发词本身就是 rest 的开头（这条命令按正则整句匹配），不另存原消息。
 * @param s 会话
 * @returns 形如 `#胡桃换夜兰圣遗物`
 */
function changeText(s: Session): string {
  return `${SHORT_PREFIX[s.game]}${s.rest}`
}

/**
 * 列出这次替换要读哪几份别人的存档
 * @param change 替换要求
 * @param uid 本人 uid，作缺省来源
 * @returns 逐个来源，已去重
 */
function borrowKeys(change: Parameters<typeof applyChange>[2], uid: string): { uid: string; name: string }[] {
  const out = new Map<string, { uid: string; name: string }>()
  const add = (one: { name: string; uid?: string } | undefined): void => {
    if (!one) return
    const key = `${one.uid ?? uid}:${one.name}`
    if (!out.has(key)) out.set(key, { uid: one.uid ?? uid, name: one.name })
  }
  add(change.weapon?.from)
  add(change.artis)
  for (const one of Object.values(change.pos ?? {})) add(one)
  return [...out.values()]
}

/**
 * 按 mode 出图
 *
 * 三种形态与 `#胡桃面板` / `#胡桃圣遗物` / `#胡桃伤害` 逐一对应，共用同三张模板。
 * @param s 会话
 * @param deps 依赖
 * @param built 改造后算好的面板
 * @param mode 出哪一张
 * @param dmgIndex 伤害那一支的序号
 * @param before 替换前的面板，伤害表据它印增减
 */
async function drawChanged(
  s: Session,
  deps: MhyDeps,
  built: NonNullable<ReturnType<NonNullable<MhyDeps["panelBuilder"]>["build"]>>,
  mode: "panel" | "artis" | "dmg",
  dmgIndex?: number,
  before?: NonNullable<ReturnType<NonNullable<MhyDeps["panelBuilder"]>["build"]>>
): Promise<void> {
  const { uploadedSplash, metaExists, panelDmg, dmgMissText } = PANEL_VIEW_HELPERS

  if (mode === "artis") {
    const view = profileDetailData(built, {
      mode: "artis",
      ...(deps.artiMeta ? { table: deps.artiMeta } : {}),
      ...metaExists(deps),
      ...uploadedSplash(deps, built)
    })
    if (await s.image("character/profile-detail", { ...view, changeProfile: changeText(s) })) return
    await s.text(panelText(built))
    return
  }

  const splash = uploadedSplash(deps, built)

  if (mode === "dmg") {
    const dmg = panelDmg(
      deps,
      built,
      { mode: "dmg", ...(dmgIndex === undefined ? {} : { dmgIdx: dmgIndex, idxIsInput: true }) },
      before
    )
    if (!dmg) {
      await s.text(dmgMissText(deps, built))
      return
    }
    const view = profileDetailData(built, {
      mode: "dmg",
      dmgCalc: dmg.calc,
      ...(dmg.dmgAttr ? { dmgAttr: dmg.dmgAttr } : {}),
      ...(deps.artiMeta ? { table: deps.artiMeta } : {}),
      ...metaExists(deps),
      ...splash
    })
    if (await s.image("character/profile-detail", { ...view, changeProfile: changeText(s) })) return
    await s.text(dmgText(built.name, dmg.calc))
    return
  }

  const dmg = panelDmg(deps, built, undefined, before)
  const view = profileDetailData(built, {
    mode: "profile",
    ...(deps.artiMeta ? { table: deps.artiMeta } : {}),
    ...metaExists(deps),
    ...splash,
    ...(dmg ? { dmgCalc: dmg.calc } : {})
  })
  if (await s.image("character/profile-detail", { ...view, changeProfile: changeText(s) })) return
  await s.text(panelText(built))
}
