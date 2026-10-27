/**
 * 模块职责：绝区零五类战绩命令 —— 式舆防卫战、危局强袭战、拟境湮灭战、拟真鏖战试炼、临界推演
 * 依赖方向：依赖 session / text / views/zzz/challenge 与 views/zzz/tower 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：五条命令同形，走同一个 {@link run}，差别只在接口名、判定与视图三处。
 *
 *          「上期」只是同一接口的 `schedule_type=2`。**拟真鏖战试炼不认这个词**：
 *          它的接口不收期次参数，一次返回四个赛季。
 *
 *          代理人名字由元数据补（接口只给 id 与方图）；**拟真鏖战试炼的角色排行例外**，
 *          那一族接口自带名字。
 */
import type { Session } from "../../core/session.js"
import { failText } from "../../core/text.js"
import type { ZzzChallengeContext, ZzzChallengeState } from "../../views/zzz/index.js"
import {
  zzzDeadlyData,
  zzzDeadlyState,
  zzzDeadlyText,
  zzzDefenseData,
  zzzDefenseState,
  zzzDefenseText,
  zzzHoloData,
  zzzHoloState,
  zzzHoloText
} from "../../views/zzz/index.js"
import {
  zzzTowerData,
  zzzTowerState,
  zzzTowerText,
  zzzVoidData,
  zzzVoidState,
  zzzVoidText
} from "../../views/zzz/index.js"
import { zzzAvatarCardMap } from "../_cards.js"
import type { MhyDeps } from "../deps.js"

/** 一类战绩的三处差别 */
interface ZzzChallengeSpec<T> {
  /** 玩法名，用于各条提示 */
  title: string
  /** 接口名 */
  api: string
  /** 模板名 */
  template: string
  /** 认不认「上期」 */
  period: boolean
  /** 判这份返回能不能出图 */
  state: (raw: T | undefined) => ZzzChallengeState
  /** 出图数据 */
  data: (raw: T | undefined, ctx: ZzzChallengeContext) => Record<string, unknown>
  /** 出图失败时的文字形态 */
  text: (raw: T | undefined, ctx: ZzzChallengeContext) => string
}

/**
 * 取一类战绩并出图
 * @param s 会话
 * @param deps 依赖
 * @param spec 这一类的三处差别
 */
async function run<T>(s: Session, deps: MhyDeps, spec: ZzzChallengeSpec<T>): Promise<void> {
  if (s.game !== "zzz") {
    await s.text(`${spec.title}只有绝区零有，请发送 %${spec.title}`)
    return
  }

  const prev = spec.period && /上一?期|往期/.test(s.rest)
  const period = prev ? "上期" : "本期"
  const res = await deps.mys.query<T>(spec.api, {
    user: s.user,
    game: s.game,
    ...(spec.period ? { data: { schedule_type: prev ? 2 : 1 } } : {})
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const got = spec.state(res.data)
  if (got === "old") {
    await s.text(`米游社给的还是旧版${spec.title}数据，出图会全是零，等它那边更新`)
    return
  }
  if (got !== "ok") {
    await s.text(`${period}${spec.title}尚无战绩，完成一次挑战后再来查询`)
    return
  }

  const loader = deps.meta?.loader
  const ctx: ZzzChallengeContext = {
    uid: res.uid,
    period,
    ...(s.name ? { nickname: s.name } : {}),
    // 上场代理人出整张卡：音擎/驱动盘/技能从绝区零面板库取，面板库没有的那位退占位卡（印「暂无面板数据」）
    cards: await zzzAvatarCardMap(deps, s.user, res.uid),
    ...(loader
      ? {
          nameOf: (id: string): string => loader.byId("zzz", id)?.abbr ?? "",
          iconOf: (id: string): string => loader.byId("zzz", id)?.face ?? "",
          idOf: (name: string): string => loader.byName("zzz", name)?.id ?? ""
        }
      : {})
  }
  // 收窄到一队的宽度（见 base.css 的 `.pic-team`）
  if (await s.image(spec.template, { ...spec.data(res.data, ctx), bodyClass: "pic-team" })) return
  await s.text(spec.text(res.data, ctx))
}

/**
 * `%式舆防卫战` —— 也是 `%深渊` 在绝区零那一路的落点
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzDefense(s: Session, deps: MhyDeps): Promise<void> {
  await run(s, deps, {
    title: "式舆防卫战",
    api: "spiralAbyss",
    template: "zzz/defense",
    period: true,
    state: zzzDefenseState,
    data: zzzDefenseData,
    text: zzzDefenseText
  })
}

/**
 * `%危局强袭战`
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzDeadly(s: Session, deps: MhyDeps): Promise<void> {
  await run(s, deps, {
    title: "危局强袭战",
    api: "challengeDeadly",
    template: "zzz/deadly",
    period: true,
    state: zzzDeadlyState,
    data: zzzDeadlyData,
    text: zzzDeadlyText
  })
}

/**
 * `%拟境湮灭战`
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzHolo(s: Session, deps: MhyDeps): Promise<void> {
  await run(s, deps, {
    title: "拟境湮灭战",
    api: "challengeHoloBoss",
    template: "zzz/holo",
    period: true,
    state: zzzHoloState,
    data: zzzHoloData,
    text: zzzHoloText
  })
}

/**
 * `%拟真鏖战试炼`
 *
 * **不认「上期」**：这一条接口不收期次参数，一次返回四个赛季。
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzTower(s: Session, deps: MhyDeps): Promise<void> {
  await run(s, deps, {
    title: "拟真鏖战试炼",
    api: "climbingTower",
    template: "zzz/tower",
    period: false,
    state: zzzTowerState,
    data: zzzTowerData,
    text: zzzTowerText
  })
}

/**
 * `%临界推演`
 * @param s 会话
 * @param deps 依赖
 */
export async function zzzVoid(s: Session, deps: MhyDeps): Promise<void> {
  await run(s, deps, {
    title: "临界推演",
    api: "voidFront",
    template: "zzz/void",
    period: true,
    state: zzzVoidState,
    data: zzzVoidData,
    text: zzzVoidText
  })
}
