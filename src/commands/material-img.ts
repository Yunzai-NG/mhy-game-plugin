/**
 * 模块职责：`#刻晴素材` —— 从米游社合集里取一张现成的素材图
 * 依赖方向：依赖 service/material-img 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**触发词与 `#胡桃材料` 刻意分开**：`材料` / `养成` / `成长` 归图鉴那一族
 *          （按元数据自己画突破材料表，见 views/char-wiki.ts），`素材` / `突破` / `培养`
 *          归这里（取攻略组做好的一张图）。
 *
 *          认不出名字时静默；名字认出来了就出声。
 */
import type { Session } from "../core/session.js"
import type { MaterialImgGame } from "../service/material-img.js"
import type { MhyDeps } from "./deps.js"
import { isMainChar, wikiNameOf } from "./wiki.js"

/** 有素材合集的两个游戏 */
const MATERIAL_IMG_GAMES: readonly string[] = ["gs", "sr"]

/**
 * `#<角色>素材` / `#<角色>突破` / `#<角色>培养`
 *
 * 名字里带「更新」时忽略缓存重下一张，形如 `#刻晴更新素材`。
 * @param s 会话
 * @param deps 依赖
 */
export async function charMaterialImg(s: Session, deps: MhyDeps): Promise<void> {
  const serv = deps.materialImgs
  const loader = deps.meta?.loader
  if (!MATERIAL_IMG_GAMES.includes(s.game) || !serv || !loader) return

  const raw = wikiNameOf(s.rest)
  const force = raw.includes("更新")
  const name = force ? raw.replace(/更新/g, "").trim() : raw
  if (!name) return

  const game = s.game as MaterialImgGame
  const item = loader.byName(game, name)
  // `type` 只有武器才有 —— 武器与角色在同一张索引里，不判会把武器当角色查
  if (!item || item.type) return

  if (isMainChar(game, item.id)) {
    await s.text("暂无主角素材")
    return
  }

  const got = await serv.image(game, item.name, force)
  if (got.path) {
    await s.imageFile(got.path)
    return
  }
  if (got.failed) {
    await s.text("暂无素材数据，请稍后再试")
    return
  }
  await s.text(`暂无 ${item.name} 的素材图，可发送「#${item.name}材料」看突破材料表`)
}
