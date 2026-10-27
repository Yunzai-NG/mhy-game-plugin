/**
 * 模块职责：图鉴四条命令 —— `#胡桃图鉴`、`#胡桃天赋`、`#胡桃命座`、`#胡桃材料`，以及武器图鉴
 * 依赖方向：依赖 views/char-wiki、views/char-talent、views/weapon-wiki 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**认不出名字时静默退出，元数据没装时同样静默** —— 触发形态是"名字 + 常用后缀"，
 *          别的插件的 `#XX图鉴` 都会落进来，出声等于把别人的命令变成一句报错。
 *
 *          `#XX图鉴` 一条命令要同时认角色与武器（后缀完全一样），按「先角色、再武器」分派。
 *
 *          第三方统计缺省不取：`deps.charStat` 关着时图鉴照常出图，只少那四块。
 *
 *          图鉴、天赋页与命座页三个游戏都受理（{@link CHAR_WIKI_GAMES}、{@link TALENT_GAMES}）；材料与图片两条
 *          只对原神与星铁成立（{@link WIKI_GAMES}）。
 */
import type { Session } from "../core/session.js"
import { UNRELEASED_TEXT } from "../core/text.js"
import type { MetaGame } from "../meta/download.js"
import type { MetaItem, MetaLoader } from "../meta/loader.js"
import { isReleased } from "../meta/loader.js"
import type { SelfCalcGame, PanelGame } from "../panel/profile/index.js"
import { isGsTraveler, isSelfCalcGame } from "../panel/profile/index.js"
import { buildCharTalent, charTalentText } from "../views/char-talent.js"
import type { WikiCharInput, WikiMaterialDeps } from "../views/char-wiki.js"
import {
  asWikiDetail,
  buildCharMaterialPage,
  buildCharStat,
  buildCharWiki,
  charMaterialText,
  charWikiText
} from "../views/char-wiki.js"
import { charImgs, artiSetImg } from "../views/panel.js"
import type { WeaponWikiInput } from "../views/weapon-wiki.js"
import { asWeaponDetail, buildWeaponWiki, weaponWikiText } from "../views/weapon-wiki.js"
import type { BangbooDetail, SetPiece } from "../views/set-wiki.js"
import { bangbooWikiText, buildBangbooWiki, buildSetWiki, setWikiText } from "../views/set-wiki.js"
import { splashDirName } from "../panel/img.js"
import type { MhyDeps } from "./deps.js"

/** 图鉴 / 材料 / 图片三条命令成立的游戏，绝区零没有材料元数据也没有面板图目录 */
const WIKI_GAMES: readonly string[] = ["gs", "sr"]

/** 角色图鉴成立的游戏 —— 绝区零也做，只是不出「持有率/常用配装」那四块（没有第三方统计站） */
const CHAR_WIKI_GAMES: readonly string[] = ["gs", "sr", "zzz"]

/** 天赋页与命座页成立的游戏 —— 绝区零的技能与意象影画就落在这两页上 */
const TALENT_GAMES: readonly string[] = ["gs", "sr", "zzz"]

/** 星铁开拓者的成对 id（男 / 女各一）；原神由 isGsTraveler 判定 */
const MAIN_IDS: Readonly<Record<string, readonly string[]>> = {
  sr: ["8001", "8002", "8003", "8004", "8005", "8006", "8007", "8008", "8009", "8010"]
}

/*
 * 出图倍率不在此处给：基准写在各页自己的 css 里（`body{transform:scale(N)}`），
 * 从命令层再传一份会以行内样式把那一处压掉，成了两处口径。
 */

/**
 * 判一个 id 是不是旅行者 / 开拓者
 * @param game 游戏
 * @param id 角色 id
 * @returns 是主角时为真
 */
export function isMainChar(game: string, id: string | number | undefined): boolean {
  return game === "gs" ? isGsTraveler(String(id)) : (MAIN_IDS[game] ?? []).includes(String(id))
}

/**
 * 剥掉不属于名字的词：首尾空白与习惯写在名字前的「喵喵」（`#喵喵胡桃图鉴`）
 *
 * **先去空白再剥前缀**：`rest` 可能带着触发词后的空格，先剥前缀会匹配不上。
 * @param rest 命令之后的内容
 * @returns 名字候选
 */
export function wikiNameOf(rest: string): string {
  return rest.trim().replace(/^喵喵/, "").trim()
}

/**
 * 造图鉴视图要用的角色输入
 * @param game 游戏
 * @param item 元数据条目
 * @param loader 元数据装载器
 * @returns 角色输入；没有详情数据时 undefined
 */
export function charInputOf(game: PanelGame, item: MetaItem, loader: MetaLoader): WikiCharInput | undefined {
  const raw = loader.detail(game, item.id || item.name, item.elem)
  if (!raw) return undefined
  const detail = asWikiDetail(raw)

  const isMain = isMainChar(game, item.id)
  // 只有主角的图标按元素分子目录，给别的角色设上会指向不存在的目录
  const travelerElem = isMain && game === "gs" && item.elem ? item.elem : ""

  const imgs = charImgs({
    game,
    name: item.name,
    ...(item.weapon ? { weaponType: item.weapon } : {}),
    ...(raw.talentCons ? { talentCons: raw.talentCons } : {}),
    ...(travelerElem ? { travelerElem } : {}),
    exists: (rel: string): boolean => loader.exists(rel)
  })
  // 额外技能在源数据中可能没有独立图标，留空让详情模板使用无图标版式。
  for (const [key, rel] of Object.entries(imgs)) {
    if (/^(?:[aeqtzj](?:[12])?|as[12]?|m[et][12]?|passive\d+|tree\d+)$/.test(key) && rel.startsWith("meta-") && !loader.exists(rel)) {
      delete imgs[key]
    }
  }

  return {
    game,
    name: item.name,
    abbr: item.abbr || item.name,
    star: item.star,
    elem: item.elem ?? "",
    weapon: item.weapon ?? "",
    isMain,
    detail,
    imgs
  }
}

/**
 * 造查材料的两条路
 * @param game 游戏
 * @param deps 依赖
 * @returns 两条路；没有材料表时两条都返回 undefined
 */
function matDeps(game: MetaGame, deps: MhyDeps): WikiMaterialDeps {
  const mats = deps.materials
  return {
    byName: name => mats?.get(name, game),
    byId: id => mats?.byId(id, game)
  }
}

/**
 * 解析出本条消息要查的角色
 *
 * 认不出时返回 undefined，调用方静默退出，理由见文件头。
 * @param s 会话
 * @param deps 依赖
 * @param games 本条命令成立的游戏，缺省是图鉴那三条的 {@link WIKI_GAMES}
 * @returns 游戏、条目与装载器
 */
function resolveChar(
  s: Session,
  deps: MhyDeps,
  games: readonly string[] = WIKI_GAMES
): { game: PanelGame; item: MetaItem; loader: MetaLoader } | undefined {
  if (!games.includes(s.game)) return undefined
  const loader = deps.meta?.loader
  if (!loader) return undefined
  const name = wikiNameOf(s.rest)
  if (!name) return undefined
  const game = s.game
  const item = loader.byName(game, name)
  // 同一张 byName 索引里还有武器（带 `type`）与驱动盘、邦布（`kind` 非 character），都要排掉
  if (!item || item.type || (item.kind && item.kind !== "character")) return undefined
  return { game, item, loader }
}

/**
 * 取第三方统计并换算成视图
 * @param game 游戏
 * @param name 角色全名
 * @param deps 依赖
 * @returns 那四块；开关关着或取不到时 undefined
 */
async function statOf(
  game: SelfCalcGame,
  name: string,
  deps: MhyDeps
): Promise<ReturnType<typeof buildCharStat>> {
  const raw = await deps.charStat?.get(game, name)
  if (!raw) return undefined
  const loader = deps.meta?.loader
  return buildCharStat(raw, {
    weapon: key => {
      const got = loader?.byName(game, key)
      if (!got) return undefined
      return { name: got.name, abbr: got.abbr, star: got.star, ...(got.icon ? { icon: got.icon } : {}) }
    },
    artiSet: key => {
      const got = deps.artiSets?.set(game, key)
      if (!got) return undefined
      // 取这套实际有的第一个部位：星铁的饰品套只有 5、6 号位，写死 1 会指向不存在的文件
      const idx = Number(Object.keys(got.idxs)[0] ?? 1) || 1
      return { abbr: got.abbr || got.name, img: artiSetImg(game, got.name, idx) }
    }
  })
}

/**
 * `#<角色>图鉴` / `#<角色>资料` —— 角色（或武器）图鉴
 *
 * 先查角色、查不到再依次试武器 / 音擎、套装、邦布，都不是才静默（别的插件的 `#XX图鉴` 会落进来，出声等于替它报错）。
 * 第三方统计只有原神星铁有，绝区零那几块不出、材料照出。
 * @param s 会话
 * @param deps 依赖
 */
export async function charWiki(s: Session, deps: MhyDeps): Promise<void> {
  const got = resolveChar(s, deps, CHAR_WIKI_GAMES)
  if (!got) {
    // 兜底链：不是角色就依次试音擎、套装、邦布，都不是才静默（别的插件的 #XX图鉴 会落进来）
    await weaponWiki(s, deps)
    return
  }
  // 名字已认出，故此处出声而不静默
  if (!deps.config().enableUnreleased && !isReleased(got.item)) {
    await s.text(UNRELEASED_TEXT)
    return
  }

  const input = charInputOf(got.game, got.item, got.loader)
  if (!input) return
  // 第三方统计只有原神星铁有（`statOf` 收窄到 SelfCalcGame）；绝区零那四块不出、材料仍出
  const stat = isSelfCalcGame(got.game) ? await statOf(got.game, got.item.name, deps) : undefined
  const view = buildCharWiki(input, matDeps(got.game, deps), stat)
  if (await s.image("wiki/character-wiki", view)) return
  await s.text(charWikiText(view))
}

/**
 * `#<角色>天赋` / `#<角色>技能` / `#<角色>行迹` / `%<代理人>技能`
 * @param s 会话
 * @param deps 依赖
 */
export async function charTalent(s: Session, deps: MhyDeps): Promise<void> {
  await renderTalent(s, deps, "talent")
}

/**
 * `#<角色>命座` / `#<角色>星魂` / `%<代理人>影画`
 * @param s 会话
 * @param deps 依赖
 */
export async function charCons(s: Session, deps: MhyDeps): Promise<void> {
  await renderTalent(s, deps, "cons")
}

/**
 * 天赋页与命座页共用的出图
 * @param s 会话
 * @param deps 依赖
 * @param mode 画天赋还是命座
 */
async function renderTalent(s: Session, deps: MhyDeps, mode: "talent" | "cons"): Promise<void> {
  const got = resolveChar(s, deps, TALENT_GAMES)
  if (!got) return
  const input = charInputOf(got.game, got.item, got.loader)
  if (!input) return

  const view = buildCharTalent(input, mode)
  // 元数据里没有这一段时不出图（绝区零包可能不带 talent / cons），改回文字说明
  const section = view.detail[mode === "cons" ? "cons" : "talent"]
  const bare = typeof section !== "object" || section === null || Object.keys(section).length === 0
  if (!bare && (await s.image("wiki/character-talent", view))) return
  await s.text(charTalentText(view))
}

/**
 * `#<角色>材料` / `#<角色>养成`
 * @param s 会话
 * @param deps 依赖
 */
export async function charMaterial(s: Session, deps: MhyDeps): Promise<void> {
  const got = resolveChar(s, deps)
  if (!got) return
  const input = charInputOf(got.game, got.item, got.loader)
  if (!input) return

  const view = buildCharMaterialPage(input, matDeps(got.game, deps))
  if (await s.image("wiki/character-material", view)) return
  await s.text(charMaterialText(view))
}

/**
 * `#<角色>图片` / `#<角色>写真`
 *
 * 直接从面板图里挑一张（同一批文件、同一套上传入口），不另设图包那一支。
 * @param s 会话
 * @param deps 依赖
 */
export async function charPic(s: Session, deps: MhyDeps): Promise<void> {
  const got = resolveChar(s, deps)
  if (!got) return
  const imgs = deps.panelImgs
  if (!imgs) return

  const rel = imgs.pick(splashDirName(got.item.name, deps.config().srSharedSplashDir))
  if (!rel) {
    await s.text(`暂无 ${got.item.name} 的图片，主人可发送「#上传${got.item.name}面板图」并附图`)
    return
  }
  await s.imageFile(imgs.pathOf(rel), got.item.name)
}

/**
 * `#<武器>图鉴` / `#<武器>资料`
 *
 * 由 {@link charWiki} 在角色查不到时接手，也可单独调用。「XX专武」先折算成
 * `<角色名>专武` 再查。
 * @param s 会话
 * @param deps 依赖
 */
export async function weaponWiki(s: Session, deps: MhyDeps): Promise<void> {
  const loader = deps.meta?.loader
  if (!loader) return
  const game = s.game

  const name = wikiNameOf(s.rest)
  if (!name) {
    await setWiki(s, deps)
    return
  }

  // 绝区零音擎：直接在本游戏查（无「专武」那套），查不到再往套装 / 邦布兜
  if (game === "zzz") {
    const item = loader.byName("zzz", name)
    if (!item?.type || item.kind === "bangboo") {
      await setWiki(s, deps)
      return
    }
    const raw = loader.detail("zzz", item.id || item.name)
    if (!raw) return
    const input: WeaponWikiInput = {
      game: "zzz",
      name: item.name,
      // 元数据里绝区零是 B=2 / A=3 / S=4，图上星数、光晕都按另两个游戏的 3~5 档画，不折算则 S 级印成「4 星」
      star: (Number(item.star) || 0) + 1,
      type: item.type,
      gacha: item.icon ?? "",
      detail: asWeaponDetail(raw)
    }
    const view = buildWeaponWiki(input, matDeps("zzz", deps))
    if (await s.image("wiki/weapon-wiki", view)) return
    await s.text(weaponWikiText(view))
    return
  }

  let wname = name
  if (wname.includes("专武")) {
    const char = loader.byName(game, wname.replace("专武", ""))
    if (char) wname = `${char.name}专武`
  }

  // 两个游戏都试，本条消息认出的那个在先 —— 让 `#流萤专武图鉴` 不必带星铁前缀
  let found: PanelGame | undefined
  let item: MetaItem | undefined
  for (const one of game === "gs" ? (["gs", "sr"] as const) : (["sr", "gs"] as const)) {
    const got = loader.byName(one, wname)
    // 武器与角色同在一张 byName 索引里，`type` 是武器才有的那一栏
    if (got?.type) {
      found = one
      item = got
      break
    }
  }
  if (!found || !item?.type) {
    await setWiki(s, deps)
    return
  }

  const raw = loader.detail(found, item.id || item.name)
  if (!raw) return

  const input: WeaponWikiInput = {
    game: found,
    name: item.name,
    star: item.star,
    type: item.type,
    gacha: item.gacha ?? item.icon ?? "",
    detail: asWeaponDetail(raw)
  }
  const view = buildWeaponWiki(input, matDeps(found, deps))
  if (await s.image("wiki/weapon-wiki", view)) return
  await s.text(weaponWikiText(view))
}

/**
 * `#<套装>图鉴` —— 圣遗物 / 遗器 / 驱动盘套装图鉴
 *
 * 由 {@link weaponWiki} 在武器查不到时接手。原神星铁从 `ArtiSetTable`（件数→效果、部位→名）、绝区零从
 * 装载器的 `equip` 条目（`skills:{2,4}`、整套一张图）。查不到再往邦布兜。
 * @param s 会话
 * @param deps 依赖
 */
export async function setWiki(s: Session, deps: MhyDeps): Promise<void> {
  const loader = deps.meta?.loader
  const name = wikiNameOf(s.rest)
  if (!loader || !name) return

  if (s.game === "zzz") {
    const item = loader.byName("zzz", name)
    if (item?.kind !== "equip") {
      await bangbooWiki(s, deps)
      return
    }
    const detail = loader.detail("zzz", item.id || item.name) as { skills?: Record<string, string> } | undefined
    const view = buildSetWiki({
      game: "zzz",
      name: item.name,
      mainImg: item.icon ?? artiSetImg("zzz", item.name, 1),
      skills: detail?.skills ?? {},
      pieces: []
    })
    if (await s.image("wiki/set-wiki", view)) return
    await s.text(setWikiText(view))
    return
  }

  // 原神星铁：套装表按全名或简称查
  const game = s.game === "gs" ? "gs" : "sr"
  const set = deps.artiSets?.set(game, name)
  if (!set) return
  const pieces: SetPiece[] = Object.entries(set.idxs).map(([idx, pname]) => ({
    name: pname,
    img: artiSetImg(game, set.name, Number(idx) || 1)
  }))
  const firstIdx = Number(Object.keys(set.idxs)[0]) || 1
  const view = buildSetWiki({
    game,
    name: set.name,
    mainImg: artiSetImg(game, set.name, firstIdx),
    skills: set.skills,
    pieces
  })
  if (await s.image("wiki/set-wiki", view)) return
  await s.text(setWikiText(view))
}

/**
 * `%<邦布>图鉴` —— 邦布图鉴（绝区零）
 *
 * 兜底链的最后一环，认不出就静默。身份 + 基础属性 + 一句技能。
 * @param s 会话
 * @param deps 依赖
 */
export async function bangbooWiki(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "zzz") return
  const loader = deps.meta?.loader
  const name = wikiNameOf(s.rest)
  if (!loader || !name) return
  const item = loader.byName("zzz", name)
  if (item?.kind !== "bangboo") return
  const detail = loader.detail("zzz", item.id || item.name) as BangbooDetail | undefined
  const view = buildBangbooWiki(item.name, item.star, item.icon ?? "", detail ?? {})
  if (await s.image("wiki/bangboo-wiki", view)) return
  await s.text(bangbooWikiText(view))
}
