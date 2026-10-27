/**
 * 模块职责：面板图命令 —— `#上传面板图` / `#面板图列表` / `#删除面板图`
 * 依赖方向：依赖 session、命令层依赖包与 panel/img
 * 生命周期：无状态函数
 * 注意事项：**上传与删除限主人**：要下载使用者给的任意地址并往磁盘写东西。
 *          列表不限主人，但受 `panelImgList` 配置约束。
 *
 *          图片从消息里取，也从被引用的消息里取（两种发法都常见）。
 */
import type { Session } from "../core/session.js"
import { splashDirName } from "../panel/img.js"
import { isGameKey } from "../core/region.js"
import type { PanelGame } from "../panel/profile/index.js"
import type { MhyDeps } from "./deps.js"

/** 一次最多发多少张图 */
const LIST_LIMIT = 30

/**
 * 判本条会话是否在有面板的游戏上
 * @param s 会话
 * @returns 游戏
 */
function panelGame(s: Session): PanelGame | undefined {
  return isGameKey(s.game) ? s.game : undefined
}

/**
 * 从 rest 里认出角色
 *
 * 返回的是**面板图目录名**而非元数据里的角色名（出图时按 {@link splashDirName} 折过一次）：
 * 不折会把图传到出图时不去看的目录里，表现是"传成功了但面板上不出现"。
 * @param s 会话
 * @param deps 依赖
 * @param game 游戏
 * @param strip 要剥掉的词
 * @returns 面板图目录名；认不出时 undefined
 */
function pickName(s: Session, deps: MhyDeps, game: PanelGame, strip: RegExp): string | undefined {
  const raw = s.rest.replace(strip, "").replace(/\d+/g, "").trim()
  if (!raw) return undefined
  const name = deps.meta?.loader.byName(game, raw)?.name
  return name ? splashDirName(name, deps.config().srSharedSplashDir) : undefined
}

/**
 * `#上传面板图` —— 把消息里的图存成该角色的面板图
 * @param s 会话
 * @param deps 依赖
 */
export async function uploadPanelImg(s: Session, deps: MhyDeps): Promise<void> {
  const game = panelGame(s)
  if (!game) return
  const store = deps.panelImgs
  if (!store) {
    await s.text("面板图功能未启用")
    return
  }
  if (!s.isMaster) {
    await s.text("只有主人可以上传面板图")
    return
  }

  const name = pickName(s, deps, game, /(?:上传|添加|面板图)/g)
  if (!name) {
    await s.text("请指定角色，例如「#上传胡桃面板图」（图片与命令一同发送，或回复一张图）")
    return
  }

  const urls = s.images
  if (urls.length === 0) {
    await s.text("消息里没有图片。请把图与命令一同发送，或回复一张已发的图再发命令")
    return
  }

  let ok = 0
  for (const url of urls) {
    const got = await store.save({ name, url })
    if (got) ok++
  }
  await s.text(ok > 0 ? `已添加 ${ok} 张 ${name} 的面板图` : "面板图保存失败，请查看日志")
}

/**
 * `#面板图列表` —— 逐张发出该角色已有的面板图
 * @param s 会话
 * @param deps 依赖
 */
export async function listPanelImg(s: Session, deps: MhyDeps): Promise<void> {
  const game = panelGame(s)
  if (!game) return
  const store = deps.panelImgs
  if (!store) {
    await s.text("面板图功能未启用")
    return
  }
  if (!deps.config().panelImgList) {
    await s.text("面板图列表已禁用")
    return
  }

  const name = pickName(s, deps, game, /(?:面板图|列表)/g)
  if (!name) {
    await s.text("请指定角色，例如「#胡桃面板图列表」")
    return
  }

  const files = store.list(name)
  if (files.length === 0) {
    await s.text(`暂无 ${name} 的面板图`)
    return
  }

  const shown = files.slice(0, LIST_LIMIT)
  await s.text(
    `${name} 共有 ${files.length} 张面板图` +
      (files.length > shown.length ? `（只列出前 ${shown.length} 张）` : "") +
      `，可发送「#删除${name}面板图1」按序号删除`
  )
  for (const [at, file] of shown.entries()) {
    await s.imageFile(store.pathOf(`normal-character/${name}/${file}`), `${at + 1}. ${file}`)
  }
}

/**
 * `#删除面板图` —— 按序号删掉一张
 * @param s 会话
 * @param deps 依赖
 */
export async function delPanelImg(s: Session, deps: MhyDeps): Promise<void> {
  const game = panelGame(s)
  if (!game) return
  const store = deps.panelImgs
  if (!store) {
    await s.text("面板图功能未启用")
    return
  }
  if (!s.isMaster) {
    await s.text("只有主人可以删除面板图")
    return
  }

  const name = pickName(s, deps, game, /(?:删除|移除|清除|面板图)/g)
  if (!name) {
    await s.text("请指定角色，例如「#删除胡桃面板图1」")
    return
  }

  const idx = Number(/\d+/.exec(s.rest)?.[0])
  if (!Number.isFinite(idx) || idx < 1) {
    await s.text(`删哪张？请带上序号，可先发送「#${name}面板图列表」查看`)
    return
  }

  const got = store.del(name, idx)
  await s.text(got ? `已删除 ${name} 的第 ${idx} 张面板图` : "删除失败，请确认序号是否正确")
}
