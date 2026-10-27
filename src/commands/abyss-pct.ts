/**
 * 模块职责：`#深渊出场率` / `#幽境危战出场率` —— 第三方统计站的角色使用率排行
 * 依赖方向：依赖 session / views/abyss-pct / service/wiki-stat 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：向米哈游之外的服务发请求，由 `enableWikiStat` 把关且缺省关闭；关着时一个包都不发。
 *          **只有原神有**，另两个游戏在第一行分派出去。
 *
 *          请求里没有 uid、Cookie 与使用者标识，故不必绑号、不占查询额度。
 *          **只取统计、不上传任何战绩** —— 该站那条收战绩连同 uid 的上报地址一概不碰。
 */
import type { Session } from "../core/session.js"
import type { AbyssPctMode } from "../service/wiki-stat.js"
import { abyssPctData, abyssPctText } from "../views/abyss-pct.js"
import type { MhyDeps } from "./deps.js"

/** 开关关着时的说明 —— 只说该找谁开哪一项，不解释数据来自哪里 */
const OFF_TEXT = "出场率未开启，请让主人在配置面板里打开「图鉴显示全服统计」"

/**
 * `#深渊出场率` 与 `#幽境危战出场率` 共用的实现
 * @param s 会话
 * @param deps 依赖
 * @param mode 查哪一种
 */
async function pctOf(s: Session, deps: MhyDeps, mode: AbyssPctMode): Promise<void> {
  const name = mode === "abyss" ? "深渊" : "幽境危战"

  // 只有原神有这一族接口，见文件头
  if (s.game !== "gs") {
    await s.text(`${name}出场率当前仅支持原神`)
    return
  }
  const service = deps.charStat
  if (!service) {
    await s.text(OFF_TEXT)
    return
  }

  const raw = await service.pct(mode)
  if (!raw) {
    /*
     * 三种情形合成一句：开关关着、站点没有本期数据、请求失败
     *
     * 分开说要把开关状态读出来再判，而对使用者来说下一步是同一件事（去打开开关或稍后再试）。
     * 故先判开关那一支，其余归到"稍后再试"。
     */
    if (!deps.config().enableWikiStat) {
      await s.text(OFF_TEXT)
      return
    }
    await s.text(`暂无本期${name}出场率数据，请稍后再试`)
    return
  }

  const loader = deps.meta?.loader
  const view = abyssPctData(raw, {
    mode,
    // 头像要按"变体在就用变体"回落，没有元数据时那一格留空，图照出
    ...(loader ? { exists: (rel: string): boolean => loader.exists(rel) } : {})
  })
  if (await s.image("gs/abyss-pct", view)) return
  await s.text(abyssPctText(raw, { mode }))
}

/**
 * `#深渊出场率`
 * @param s 会话
 * @param deps 依赖
 */
export async function abyssPct(s: Session, deps: MhyDeps): Promise<void> {
  await pctOf(s, deps, "abyss")
}

/**
 * `#幽境危战出场率`
 * @param s 会话
 * @param deps 依赖
 */
export async function hardChallengePct(s: Session, deps: MhyDeps): Promise<void> {
  await pctOf(s, deps, "hard")
}
