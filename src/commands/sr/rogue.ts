/**
 * 模块职责：`*模拟宇宙` —— 本期逐次通关的记录
 * 依赖方向：依赖 session / text / views/sr/rogue 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：请求要带 `need_detail`，否则 `records` 为空，与"本期没打过"无从区分。
 */
import type { Session } from "../../core/session.js"
import { failText } from "../../core/text.js"
import type { SrRogueRaw } from "../../views/sr/index.js"
import { srRogueData, srRogueState, srRogueText } from "../../views/sr/index.js"
import { srStatAvatars } from "../../views/sr/index.js"
import { loadPanels } from "../_cards.js"
import type { MhyDeps } from "../deps.js"
import { onlyIn } from "../_hints.js"

/**
 * `*模拟宇宙`
 * @param s 会话
 * @param deps 依赖
 */
export async function rogueList(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "sr") {
    await s.text(onlyIn("模拟宇宙", "星穹铁道", s.game))
    return
  }

  const res = await deps.mys.query<SrRogueRaw>("rogue", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const loader = deps.meta?.loader
  const ctx = {
    uid: res.uid,
    nickname: s.name,
    ...(loader ? { nameOf: (id: string): string => loader.byId("sr", id)?.abbr ?? "" } : {})
  }
  if (srRogueState(res.data) === "noData") {
    await s.text("本期模拟宇宙尚无通关记录，完成一次通关后再来查询")
    return
  }
  // 通关阵容与忘却之庭同一张角色卡：面板库里有的出整卡，没有的退回接口头像
  const { panels } = await loadPanels(deps, s.user, "sr", res.uid)
  const avatars = srStatAvatars(panels, "sr", loader ? (rel: string): boolean => loader.exists(rel) : undefined)
  // 收窄到「名目栏 + 一队」的宽度（见 base.css 的 `.pic-lineup`）
  if (await s.image("sr/rogue", { ...srRogueData(res.data, ctx), avatars, bodyClass: "pic-lineup" })) return
  await s.text(srRogueText(res.data, ctx))
}
