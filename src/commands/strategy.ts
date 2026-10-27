/**
 * 模块职责：攻略三条命令 —— `#胡桃攻略`（含 `#胡桃更新攻略`）、`#攻略帮助`、`#设置攻略`
 * 依赖方向：依赖 service/strategy 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**`#XX攻略` 认不出名字、开关关着时都静默退出**（同 commands/wiki.ts）：这条命令
 *          的形态是"名字 + 攻略"，别的插件的 `#XX攻略` 都会落进来。
 *
 *          `#攻略帮助` 与 `#设置攻略` 是明确的触发词，故该出声。
 *
 *          出图走合并转发；只有一张时不折（见 core/session.ts 的 `forward`）。
 */
import { SHORT_PREFIX } from "../core/region.js"
import type { ForwardPart, Session } from "../core/session.js"
import type { StrategyGame } from "../service/strategy.js"
import {
  articleLink,
  isEarlyArticle,
  strategyCacheDir,
  strategyDirOf,
  strategyIndexName
} from "../service/strategy.js"
import type { MhyDeps } from "./deps.js"
import { isMainChar, wikiNameOf } from "./wiki.js"

/** 有攻略索引的两个游戏 */
const STRATEGY_GAMES: readonly string[] = ["gs", "sr"]

/** 发布较早的攻略要带的那一句（含末尾换行） */
const EARLY_TIP = "⚠️该攻略发布时间较早，攻略中的部分内容可能与当前游戏内存在差异，请谨慎参考\n"

/**
 * 取本条消息说的是哪个游戏
 * @param s 会话
 * @returns 游戏；不是那两个之一时 undefined
 */
function gameOf(s: Session): StrategyGame | undefined {
  return STRATEGY_GAMES.includes(s.game) ? (s.game as StrategyGame) : undefined
}

/**
 * `#<角色>攻略` / `#<角色>功略` —— 认不出名字、开关关着、索引里没有时都不出声
 *
 * 名字里带「更新」时（`#胡桃更新攻略`、`#更新胡桃攻略`）忽略索引与图的缓存重取，仅限主人。
 * 这一支是明确的请求，名字认出来之后取不到也要说一句。
 * @param s 会话
 * @param deps 依赖
 */
export async function charStrategy(s: Session, deps: MhyDeps): Promise<void> {
  const game = gameOf(s)
  const serv = deps.strategy
  const loader = deps.meta?.loader
  if (!game || !serv?.on || !loader) return

  const raw = wikiNameOf(s.rest)
  const force = raw.includes("更新")
  const input = force ? raw.replace(/更新/g, "").trim() : raw
  if (!input) return
  const item = loader.byName(game, input)
  // `type` 是武器才有的那一栏，武器与角色同在一张索引里
  if (!item || item.type) return
  if (force && !s.isMaster) {
    await s.text(`更新攻略仅限主人，直接发「${SHORT_PREFIX[game]}${item.name}攻略」即可查看`)
    return
  }

  const dir = strategyDirOf(game, item.elem ?? "", item.weapon ?? "")
  if (!dir) return
  const name = strategyIndexName(item.name, isMainChar(game, item.id), game)
  const entries = await serv.entries(game, dir, name, force)
  if (!entries.length) {
    if (force) await s.text(`没有取到${name}的攻略，可能是攻略源暂时不通，或还没有人做这个角色的攻略`)
    return
  }

  const picked = await serv.picked(game)
  const cacheDir = strategyCacheDir(name, dir)
  const nodes: ForwardPart[][] = []
  for (const one of entries) {
    if (!one.author || (picked.length && !picked.includes(one.author))) continue
    const img = await serv.image(game, cacheDir, one, force)
    if (!img) continue

    const link = articleLink(one, game)
    nodes.push([
      ...(isEarlyArticle(one) ? [{ text: EARLY_TIP }] : []),
      { image: img },
      { text: `版主：${one.author}${link ? `\n${link}` : ""}` }
    ])
  }
  if (!nodes.length) {
    if (force) await s.text(`${name}的攻略图一张都没取到，请稍后再试；也可能是「${SHORT_PREFIX[game]}设置攻略」选的攻略组没有做这个角色`)
    return
  }

  await s.forward(nodes, `${name}攻略，共${nodes.length}张`)
}

/**
 * `#攻略帮助` / `#攻略列表` —— 列出全部攻略组与当前选中的那些
 * @param s 会话
 * @param deps 依赖
 */
export async function strategyHelp(s: Session, deps: MhyDeps): Promise<void> {
  const game = gameOf(s)
  const serv = deps.strategy
  if (!game) {
    await s.text("绝区零暂无攻略资源")
    return
  }
  if (!serv?.on) {
    await s.text("攻略功能未开启，请在设置面板的「图鉴」一组里打开「角色攻略」")
    return
  }

  const authors = await serv.authors(game)
  if (!authors.length) {
    await s.text("暂时取不到攻略组列表，请稍后重试")
    return
  }
  const picked = await serv.picked(game)
  await s.text(
    [
      `当前攻略组：${picked.length ? picked.join(",") : "全部"}`,
      "发送「#设置攻略1,2,4」或「#设置攻略全部」以设置：",
      ...authors.map((one, idx) => `${idx + 1}——${one}`),
      "每个数字用逗号隔开"
    ].join("\n")
  )
}

/**
 * `#设置攻略1,2,4` / `#设置攻略全部` —— 仅主人，门槛由命令表的 `master` 把关
 * @param s 会话
 * @param deps 依赖
 */
export async function setStrategy(s: Session, deps: MhyDeps): Promise<void> {
  const game = gameOf(s)
  const serv = deps.strategy
  if (!game || !serv?.on) {
    await strategyHelp(s, deps)
    return
  }

  const rest = s.rest.trim()
  if (/开启|关闭/.test(rest)) {
    await s.text("攻略的开关在设置面板的「图鉴」一组里，命令只用来选攻略组")
    return
  }
  if (!rest) {
    await strategyHelp(s, deps)
    return
  }

  if (rest === "全部") {
    await serv.pick(game, [])
    await s.text("设置成功\n当前攻略组：全部")
    return
  }

  const parts = [...new Set(rest.split(/[,，]/).map(one => one.trim()))]
  if (!parts.length || parts.some(one => !one || !Number.isInteger(Number(one)))) {
    await s.text("请输入正确的序号")
    return
  }

  const authors = await serv.authors(game)
  if (!authors.length) {
    await s.text("暂时取不到攻略组列表，请稍后重试")
    return
  }
  const names = parts.flatMap(one => {
    const got = authors[Number(one) - 1]
    return got ? [got] : []
  })
  if (!names.length) {
    await s.text("请输入正确的序号")
    return
  }
  await serv.pick(game, names)
  await s.text(`设置成功\n当前攻略组：${names.join(",")}`)
}
