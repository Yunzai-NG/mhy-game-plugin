/**
 * 模块职责：`#幽境危战` —— 原神本期危战战绩
 * 依赖方向：依赖 session / text / views/gs/hard-challenge 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**"没解锁"与"本期没打过"要分开说**：两者接口都返回 retcode 0，直接出图会得到
 *          一张各项均为 0 的图。
 *
 *          **`hard_challenge_popularity` 有意不打**：它给的是全服使用率而非本人战绩，
 *          且要占使用者的每日查询额度。
 */
import type { Session } from "../../core/session.js"
import { failText } from "../../core/text.js"
import type { HardChallengeContext, HardChallengeRaw } from "../../views/gs/index.js"
import {
  hardChallengeState,
  hardChallengeTemplateData,
  hardChallengeText
} from "../../views/gs/index.js"
import type { IndexRaw } from "../../views/profile.js"
import { hardChallengePct } from "../abyss-pct.js"
import { avatarCardMap } from "../_cards.js"
import type { MhyDeps } from "../deps.js"
import { onlyIn } from "../_hints.js"

/** 两种"没有内容"各自的说法 */
const HARD_TEXT: Readonly<Record<string, string>> = {
  locked: "这个账号还没有解锁幽境危战，达到对应冒险等阶并通关后再来查询",
  noData: "本期幽境危战尚无战绩，完成一次挑战后再来查询"
}

/**
 * `#幽境危战`
 * @param s 会话
 * @param deps 依赖
 */
export async function hardChallenge(s: Session, deps: MhyDeps): Promise<void> {
  // `幽境危战` 是 `幽境危战出场率` 的前缀，前缀路由下那个词到不了自己的命令，故在此分派
  if (/出场率|使用率/.test(s.rest)) {
    await hardChallengePct(s, deps)
    return
  }
  if (s.game !== "gs") {
    await s.text(onlyIn("幽境危战", "原神", s.game))
    return
  }

  const res = await deps.mys.query<HardChallengeRaw>("hard_challenge", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const state = hardChallengeState(res.data)
  if (state !== "ok") {
    await s.text(HARD_TEXT[state] ?? HARD_TEXT["noData"] ?? "")
    return
  }

  const info = await deps.mys.query<IndexRaw>("index", { user: s.user, game: s.game })
  const role = info.ok ? (info.data as { role?: HardChallengeContext["role"] }).role : undefined
  const ctx: HardChallengeContext = {
    uid: res.uid,
    ...(role ? { role } : {}),
    ...(info.ok ? { cards: await avatarCardMap(deps, s.user, "gs", info.data, res.uid) } : {})
  }

  if (await s.image("gs/hard-challenge", hardChallengeTemplateData(res.data, ctx))) return
  await s.text(hardChallengeText(res.data, ctx))
}
