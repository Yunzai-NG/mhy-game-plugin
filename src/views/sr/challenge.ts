/**
 * 模块职责：星穹铁道挑战战绩 —— 混沌回忆 / 虚构叙事 / 末日幻影的视图模型
 * 依赖方向：纯函数，不发请求、不读元数据
 * 生命周期：无状态
 * 注意事项：**三者共用一份视图与一张模板**（接口返回形态一致，差别只在标题、有无「分数」栏、速通关算不算分）。**「没有内容」分两种**：`has_data` 为假是「本期没打过」、为真却拿不到 `all_floor_detail` 是「返回形态又变了」，两者要分开说。
 *          祝福说明带 Unity 富文本标签与字面 `\n`，由 {@link srChallengePlain} 剥掉。**每关星数先减额外星**（`star_num` 含额外星、直接画会占四格），上限取「3 与基础星的大者」。**节点个数不写死 2**（新档位每关三节点，{@link floorNodes} 按 `node_<数字>` 认键、取到几个画几个、下限 2、名一律「节点 N」）。
 *          **每关总分由本层加出**（各节点之和）；**虚构叙事速通那关既不计分也不记轮次**（印分数会让人以为打过）。**混沌回忆排掉速通关**（无战斗记录、列出只是空卡片）。**异相仲裁不走这份视图**（返回另一套，见 peak-challenge.ts，接口名与标题表仍共用）。
 */
import { elemOf } from "../../meta/elem.js"
import { INDENT } from "../../core/text.js"

/** 接口给的时刻，逐项分开给 */
export interface SrChallengeTimeRaw {
  /** 年 */
  year?: number
  /** 月 */
  month?: number
  /** 日 */
  day?: number
  /** 时 */
  hour?: number
  /** 分 */
  minute?: number
}

/** 一个上场角色 */
export interface SrChallengeAvatarRaw {
  /** 角色 id */
  id?: number | string
  /** 等级 */
  level?: number
  /** 头像，米游社的绝对地址 */
  icon?: string
  /** 星级 */
  rarity?: number
  /** 命途或元素，形如 `fire` */
  element?: string
  /** 星魂数 */
  rank?: number
}

/** 半场的记录 */
export interface SrChallengeNodeRaw {
  /** 上场角色 */
  avatars?: SrChallengeAvatarRaw[]
  /** 本半场生效的祝福 */
  buff?: {
    /** 祝福名 */
    name_mi18n?: string
    /** 祝福说明，带富文本标签 */
    desc_mi18n?: string
    /** 图标 */
    icon?: string
  }
  /** 得分，虚构叙事一类给字符串 */
  score?: number | string
  /** 挑战时刻，形态与期次时刻相同；接口不给时视同没有 */
  challenge_time?: SrChallengeTimeRaw
}

/** 一关的记录 */
export interface SrChallengeFloorRaw {
  /** 关卡名 */
  name?: string
  /** 已得星数，含额外星 */
  star_num?: number
  /** 其中的额外星 */
  extra_star_num?: number
  /** 回合数 */
  round_num?: number
  /** 是否速通 */
  is_fast?: boolean
  /** 是否三节点档位 */
  is_tierce?: boolean
  /** 第一个节点 */
  node_1?: SrChallengeNodeRaw
  /** 第二个节点 */
  node_2?: SrChallengeNodeRaw
  /** 第三个节点，新档位才有 */
  node_3?: SrChallengeNodeRaw
  /** 再往后的节点一律按同一形态认键，见文件头 */
  [key: `node_${number}`]: SrChallengeNodeRaw | undefined
}

/** 一期的期次信息 */
export interface SrChallengeGroupRaw {
  /** 期次名 */
  name_mi18n?: string
  /** 开始时刻 */
  begin_time?: SrChallengeTimeRaw
  /** 结束时刻 */
  end_time?: SrChallengeTimeRaw
}

/** 三条挑战接口共用的返回 */
export interface SrChallengeRaw {
  /** 逐期，下标 0 是本期、1 是上期 */
  groups?: SrChallengeGroupRaw[]
  /** 总星数 */
  star_num?: number
  /** 其中的额外星 */
  extra_star_num?: number
  /** 整期总分，虚构叙事有这一栏 */
  score?: number | string
  /** 最深抵达 */
  max_floor?: string
  /** 战斗次数 */
  battle_num?: number
  /** 本期有没有战绩 */
  has_data?: boolean
  /** 逐关明细 */
  all_floor_detail?: SrChallengeFloorRaw[]
  /**
   * 异相仲裁独有的那一栏，**本视图不认这一套**
   *
   * 它的返回是「王棋 + 骑士关卡 + 奖牌档位」那一套（`challenge_peak_records[]`），与虚构叙事、
   * 末日幻影的 `all_floor_detail` 毫无重合，故另有 `views/sr/peak-challenge.ts` 专管。
   * 留这一栏是一道**看门的**：`srChallengeCommand` 传错种类不会报错、只会查到别的玩法上，
   * 而那时若也回"没打过"，使用者会照着提示去打一局，回来还是同一句话。
   */
  challenge_peak_records?: unknown[]
}

/** 四类挑战，异相仲裁只用它的接口名与标题 */
export type SrChallengeKind = "memory" | "story" | "boss" | "peak"

/** 各类挑战的中文名、接口名与两条按类而异的口径 */
const KIND_INFO: Readonly<
  Record<SrChallengeKind, { title: string; api: string; skipFast: boolean; fastNoScore: boolean }>
> = {
  // 混沌回忆的速通关本来就没有战斗记录，列出来只是一排空卡片
  memory: { title: "混沌回忆", api: "spiralAbyss", skipFast: true, fastNoScore: false },
  // 虚构叙事速通的那一关既不计分也不记轮次 —— 速通是没打的意思
  story: { title: "虚构叙事", api: "challengeStory", skipFast: false, fastNoScore: true },
  boss: { title: "末日幻影", api: "challengeBoss", skipFast: false, fastNoScore: false },
  peak: { title: "异相仲裁", api: "challengePeak", skipFast: false, fastNoScore: false }
}

/**
 * 取一类挑战的中文名
 * @param kind 挑战种类
 * @returns 中文名
 */
export function srChallengeTitle(kind: SrChallengeKind): string {
  return KIND_INFO[kind].title
}

/**
 * 取一类挑战对应的接口名
 * @param kind 挑战种类
 * @returns 接口名，与 core/api.ts 中的键一致
 */
export function srChallengeApi(kind: SrChallengeKind): string {
  return KIND_INFO[kind].api
}

/** 判定结果 */
export type SrChallengeState = "ok" | "noData" | "noDetail" | "otherShape"

/**
 * 判这份返回能不能出图
 *
 * `noDetail` 单独一档（接口形态可能已变，与「没打过」处置不同）；`otherShape` 是异相仲裁那一套，它一栏都对不上，若也回「没打过」，使用者会照着提示去打一局、回来还是同一句话。
 * @param raw 接口返回
 * @returns 判定结果
 */
export function srChallengeState(raw: SrChallengeRaw | undefined): SrChallengeState {
  if (raw && Array.isArray(raw.challenge_peak_records)) return "otherShape"
  if (!raw || raw.has_data === false) return "noData"
  const floors = raw.all_floor_detail ?? []
  if (floors.length > 0) return "ok"
  return raw.has_data === true ? "noDetail" : "noData"
}

/**
 * 接口给的时刻 → "08-01 04:00"
 *
 * 缺年月日中任何一项即视为没有这个时刻：补一个当前年份会得到一个看似确切而实则编造的日期。
 * @param time 接口给的时刻
 * @returns 可读时刻；给不全时为空串
 */
export function srChallengeTime(time: SrChallengeTimeRaw | undefined): string {
  const { month, day } = time ?? {}
  if (!month || !day) return ""
  const two = (n: number): string => String(n).padStart(2, "0")
  const hm = `${two(time?.hour ?? 0)}:${two(time?.minute ?? 0)}`
  return `${two(month)}-${two(day)} ${hm}`
}

/**
 * 剥掉富文本标签与字面换行
 *
 * 祝福说明带 `<color=#f29e38ff>` 一类标签与字面的 `\n`，原样印会得到一段夹着标签的文字；标签不携带信息（颜色由模板决定），故整体剥除。
 * @param text 原始说明
 * @returns 纯文本
 */
export function srChallengePlain(text: string | undefined): string {
  return (text ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** 模板要的一个上场角色 */
export interface SrChallengeAvatarView extends Record<string, unknown> {
  /** 角色 id */
  id: string
  /** 角色名，由元数据补；取不到时为空串 */
  name: string
  /** 头像地址，接口给的绝对地址 */
  icon: string
  /** 等级 */
  level: number
  /** 星级，模板据此选边框 */
  rarity: number
  /** 星魂数，0 时模板不画角标 */
  rank: number
  /** 命途键，小写；模板据此选圆点颜色 */
  element: string
}

/** 模板要的一个半场 */
export interface SrChallengeNodeView extends Record<string, unknown> {
  /** 半场名 */
  label: string
  /** 得分，接口不给时为空串 */
  score: string
  /** 挑战时刻，接口不给时为空串 */
  time: string
  /** 祝福名，没有时为空串 */
  buffName: string
  /** 祝福图标，没有时为空串 */
  buffIcon: string
  /** 祝福说明，已剥标签 */
  buffDesc: string
  /** 上场角色 */
  avatars: SrChallengeAvatarView[]
}

/** 模板要的一关 */
export interface SrChallengeFloorView extends Record<string, unknown> {
  /** 关卡名 */
  name: string
  /** 基础星数，已减掉额外星 */
  star: number
  /** 额外星数，0 时模板不画那一标 */
  extraStar: number
  /** 星数上限，即模板画几个格子 */
  maxStar: number
  /**
   * 逐个星格是否已得
   *
   * 由本层摊成数组而不是让模板算：art-template 里没有"重复 N 次"这样的原语，
   * 拿到的只是两个数字时模板只能靠取巧的写法凑出格子，而那种写法一改就错。
   */
  stars: boolean[]
  /** 回合数，0 表示接口没给或这一关不记 */
  round: number
  /** 是否速通 */
  fast: boolean
  /** 本关总分，即各节点得分之和；不计分时为空串 */
  total: string
  /** 逐个节点 */
  nodes: SrChallengeNodeView[]
}

/** 出图与出文字共用的上下文 */
export interface SrChallengeContext {
  /** 挑战种类 */
  kind: SrChallengeKind
  /** uid */
  uid: string
  /**
   * 期次标签，形如「本期」「上期」
   *
   * 同一张模板同时服务本期与上期，而 `name_mi18n` 未必有值；缺了它两张图看起来一模一样。
   */
  period?: string
  /**
   * 查的是不是上期
   *
   * **`groups` 里本期是第 0 项、上期是第 1 项**，即便请求里已带 `schedule_type=2`，
   * 返回的 `groups` 仍是两期都给。恒取第 0 项会让上期那张图印着本期的期次名与起止时刻，
   * 而那**不报错**、看着也像对的。
   */
  prev?: boolean
  /**
   * 按角色 id 取中文名，取不到时返回空串
   *
   * 接口只给 id 与头像地址、**不给角色名**，故名字一律由元数据补。缺了它纯文字形态里
   * 只能列出一串数字 id，而那对使用者没有意义。
   */
  nameOf?: (id: string) => string
}

/**
 * 取要展示的那一期
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 期次；没有时 undefined
 */
function groupOf(raw: SrChallengeRaw | undefined, ctx: SrChallengeContext): SrChallengeGroupRaw | undefined {
  return raw?.groups?.[ctx.prev === true ? 1 : 0]
}

/** 节点名的下限个数：只打了第一个节点时，第二格仍要留出来 */
const MIN_NODES = 2

/**
 * 就地认出一关里的全部节点，按序号排好
 *
 * 不写死两个，理由见文件头。缺号的那一位给 undefined，由 {@link nodeView} 兜成空节点。
 * @param raw 一关的记录
 * @returns 逐个节点，下标即"序号减一"
 */
export function floorNodes(raw: SrChallengeFloorRaw | undefined): (SrChallengeNodeRaw | undefined)[] {
  const found = new Map<number, SrChallengeNodeRaw>()
  for (const [key, value] of Object.entries(raw ?? {})) {
    const hit = /^node_(\d+)$/.exec(key)
    if (!hit?.[1] || value === null || typeof value !== "object") continue
    found.set(Number(hit[1]), value as SrChallengeNodeRaw)
  }
  const count = Math.max(MIN_NODES, ...found.keys())
  return Array.from({ length: count }, (_unused, idx) => found.get(idx + 1))
}

/**
 * 节点名
 *
 * 一律作「节点 N」，理由见文件头。
 * @param idx 下标
 * @returns 节点名
 */
function nodeLabel(idx: number): string {
  return `节点${idx + 1}`
}

/**
 * 把一个半场转成模板要的形态
 * @param raw 半场记录
 * @param label 半场名
 * @param nameOf 按 id 取角色名
 * @returns 半场视图
 */
function nodeView(
  raw: SrChallengeNodeRaw | undefined,
  label: string,
  nameOf: (id: string) => string
): SrChallengeNodeView {
  const score = raw?.score
  return {
    label,
    // 0 分与"接口没给"要分得开：前者是打了没拿分，后者是这一类挑战本就不计分
    score: score === undefined || score === null || score === "" ? "" : String(score),
    time: srChallengeTime(raw?.challenge_time),
    buffName: raw?.buff?.name_mi18n ?? "",
    buffIcon: raw?.buff?.icon ?? "",
    buffDesc: srChallengePlain(raw?.buff?.desc_mi18n),
    avatars: (raw?.avatars ?? []).map(it => {
      const id = String(it.id ?? "")
      return {
        id,
        name: id === "" ? "" : nameOf(id),
        icon: it.icon ?? "",
        level: Number(it.level) || 0,
        rarity: Number(it.rarity) || 4,
        rank: Number(it.rank) || 0,
        element: elemOf(it.element ?? "", "", "sr")
      }
    })
  }
}

/**
 * 各节点得分之和
 *
 * 一个节点都不计分时给空串 —— 那是"这一类挑战本就不计分"，印一个 0 会让人以为打了没拿分。
 * @param nodes 逐个节点
 * @returns 总分；不计分时为空串
 */
function floorTotal(nodes: readonly SrChallengeNodeView[]): string {
  const scored = nodes.filter(it => it.score !== "")
  if (scored.length === 0) return ""
  return String(scored.reduce((sum, it) => sum + (Number(it.score) || 0), 0))
}

/**
 * 把一份挑战返回转成 `abyss/sr-challenge` 要的形态
 *
 * **节点个数按实取、每项的角色恒为数组**：模板逐层取值并对角色取 `.length`，而接口在「只打了第一个节点」时不给 `node_2`，缺键会让整张图出不来而只退回纯文字。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function srChallengeTemplateData(
  raw: SrChallengeRaw | undefined,
  ctx: SrChallengeContext
): Record<string, unknown> {
  const nameOf = ctx.nameOf ?? ((): string => "")
  const group = groupOf(raw, ctx)
  const info = KIND_INFO[ctx.kind]
  const detail = (raw?.all_floor_detail ?? []).filter(one => !(info.skipFast && one.is_fast === true))
  const floors: SrChallengeFloorView[] = detail.map(one => {
    const fast = one.is_fast === true
    const extraStar = Number(one.extra_star_num) || 0
    // 额外星要先减掉：不减则"实得 4 星"占出四个格子，而官方那张图上是三格加一标
    const star = Math.max(0, (Number(one.star_num) || 0) - extraStar)
    const maxStar = Math.max(3, star)
    const nodes = floorNodes(one).map((node, idx) => nodeView(node, nodeLabel(idx), nameOf))
    const noScore = info.fastNoScore && fast
    return {
      name: one.name ?? "",
      star,
      extraStar,
      maxStar,
      stars: Array.from({ length: maxStar }, (_unused, idx) => idx < star),
      round: noScore ? 0 : Number(one.round_num) || 0,
      fast,
      total: noScore ? "" : floorTotal(nodes),
      nodes
    }
  })

  return {
    kind: ctx.kind,
    title: srChallengeTitle(ctx.kind),
    uid: ctx.uid,
    period: ctx.period ?? "",
    season: group?.name_mi18n ?? "",
    begin: srChallengeTime(group?.begin_time),
    end: srChallengeTime(group?.end_time),
    starNum: Number(raw?.star_num) || 0,
    extraStar: Number(raw?.extra_star_num) || 0,
    // 整期总分只有虚构叙事给，没有时为空串 —— 模板对它做 if 判断
    totalScore: raw?.score === undefined || raw.score === "" ? "" : String(raw.score),
    maxFloor: raw?.max_floor ?? "",
    battleNum: Number(raw?.battle_num) || 0,
    floors
  }
}

/**
 * 这一族挑战的纯文字形态
 *
 * 无渲染器时用。**就着模板数据来**，两种形态才不会在「排掉哪些关、哪一关不计分」这类口径上各走一路。祝福名接口是给的，故文字形态里也列得出（幻想真境剧诗的祝福只有图标，故那边列不出）。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function srChallengeText(raw: SrChallengeRaw | undefined, ctx: SrChallengeContext): string {
  const view = srChallengeTemplateData(raw, ctx)
  const season = String(view["season"] ?? "")
  const extraStar = Number(view["extraStar"]) || 0
  const totalScore = String(view["totalScore"] ?? "")
  const lines = [`UID${ctx.uid} ${srChallengeTitle(ctx.kind)}${season ? ` · ${season}` : ""}`]
  lines.push(
    `最深抵达 ${String(view["maxFloor"]) || "-"}，星数 ${String(view["starNum"])}` +
      `${extraStar > 0 ? `（含额外 ${extraStar}）` : ""}，战斗 ${String(view["battleNum"])} 次` +
      `${totalScore ? `，总分 ${totalScore}` : ""}`
  )

  for (const floor of view["floors"] as SrChallengeFloorView[]) {
    lines.push(
      `${floor.name || "未命名关卡"}${INDENT}${floor.star} 星` +
        `${floor.extraStar > 0 ? ` + ${floor.extraStar}` : ""}` +
        `${floor.round > 0 ? `${INDENT}${floor.round} 回合` : ""}` +
        `${floor.fast ? `${INDENT}速通` : ""}${floor.total ? `${INDENT}总分 ${floor.total}` : ""}`
    )
    for (const node of floor.nodes) {
      // 一个角色都没有即这一格没打过，整行不出现；印一行"无记录"只是多占一行
      if (node.avatars.length === 0) continue
      // 名字取不到时退回 id：那仍比整行消失有用，也提示元数据没装
      const who = node.avatars.map(it => it.name || it.id).filter(Boolean)
      const score = node.score === "" ? "" : `${INDENT}${node.score} 分`
      lines.push(
        `${INDENT}${node.label}：${who.join("、") || "无记录"}` +
          `${node.buffName ? `${INDENT}祝福 ${node.buffName}` : ""}${score}`
      )
    }
  }
  return lines.join("\n")
}
