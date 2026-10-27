/**
 * 模块职责：绝区零面板的装配收口 —— 把存下来的那份转成可展示、已评分的形态
 * 依赖方向：依赖 panel/profile（专属形态）与 panel/score（评分）；不发请求、不碰 IO
 * 生命周期：随插件 setup 造一个实例，只持有评分表的引用；装配本身无状态
 * 注意事项：与 `panel/build.ts` 是兄弟而非分支：绝区零属性由接口给算好、不进 `PanelBuilder`，但「存的形态 → 能用的形态」三游戏都要收口。
 *          收两件事：`StoredAvatar.zzz` 的可选性（消费点勿写 `as ZzzAvatarDetail` 抹掉，遇真空值会运行期抛错）与评分挂载（评分表缺失是常态）。
 *          **装不出来就返回 undefined、不造空壳**，由调用方决定说什么；「什么算装得出来」只此一处定义。
 */
import type { StoredAvatar } from "../../store/panel.js"
import type { ZzzAvatarDetail } from "../profile/index.js"
import type { ZzzScoreResult, ZzzScoreTable } from "../score/index.js"
import { zzzScoreInput } from "../score/index.js"

/**
 * 装好的一位代理人面板
 *
 * 与 {@link StoredAvatar} 的差别只在**可选性**：`detail` 在这里必有，下游不必再判空。共用字段照原样带着。
 */
export interface BuiltZzzPanel {
  /** 代理人 id */
  id: string
  /** uid */
  uid: string
  /** 等级 */
  level: number
  /** 影画数 */
  cons: number
  /** 六栏技能等级 */
  talent: Record<string, number>
  /** 绝区零专属那一块，**必有** */
  detail: ZzzAvatarDetail
  /** 驱动盘评分；评分表缺失时省略 */
  mark?: ZzzScoreResult
  /** 数据源标识 */
  from?: string
  /** 面板数据的时间戳 */
  at?: number
}

/** 造装配器需要的东西 */
export interface ZzzPanelBuilderOptions {
  /**
   * 驱动盘评分表
   *
   * 可选。缺它时装出来的面板不带 `mark`，其余照常。
   */
  score?: ZzzScoreTable
}

/**
 * 绝区零面板装配器
 *
 * 与 `PanelBuilder` 同位置同用法（`build(uid, stored)`），只是不必先问 `ready(game)`：装不出来的唯一成因是那份数据没有驱动盘。
 */
export class ZzzPanelBuilder {
  readonly #score: ZzzScoreTable | undefined

  /**
   * @param opts 装配器选项
   */
  constructor(opts: ZzzPanelBuilderOptions = {}) {
    this.#score = opts.score
  }

  /**
   * 判一份存下来的面板装不装得出来
   *
   * 与 {@link build} 同一条判据，供调用方取数前先问。
   * @param one 存下来的面板
   * @returns 装得出来时为真
   */
  ready(one: StoredAvatar | undefined): boolean {
    return !!one?.zzz && one.zzz.discs.length > 0
  }

  /**
   * 装配一位代理人的面板
   *
   * **没有驱动盘数据即装不出来**：那份面板要么只有等级与名字，要么是一位没练的代理人。
   * @param uid uid
   * @param one 存下来的面板
   * @returns 装好的面板；装不出来时 undefined
   */
  build(uid: string, one: StoredAvatar | undefined): BuiltZzzPanel | undefined {
    const detail = one?.zzz
    if (!one || !detail || detail.discs.length === 0) return undefined

    const out: BuiltZzzPanel = {
      id: one.id,
      uid,
      level: one.level,
      cons: one.cons,
      talent: one.talent ?? {},
      detail
    }
    // 评分表缺失是常态，此处判一次而非让四个调用点各判；`cons`（影画数）在共用字段而不在 `detail` 里，评分判据要它故单独传
    const mark = this.#score?.score(detail.discs, zzzScoreInput(detail, one.cons))
    if (mark) out.mark = mark
    if (one.from) out.from = one.from
    if (one.at !== undefined) out.at = one.at
    return out
  }

  /**
   * 装配一份玩家档案里的全部代理人
   *
   * 装不出来的那些直接不进结果 —— 面板列表要的正是「有面板数据的那几位」。
   * @param uid uid
   * @param avatars 逐角色的面板，键为角色 id
   * @returns 装好的那些，次序即入参次序
   */
  buildAll(uid: string, avatars: Readonly<Record<string, StoredAvatar>>): BuiltZzzPanel[] {
    const out: BuiltZzzPanel[] = []
    for (const one of Object.values(avatars)) {
      const got = this.build(uid, one)
      if (got) out.push(got)
    }
    return out
  }
}
