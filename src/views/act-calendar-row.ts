/**
 * 模块职责：活动日历三游戏共用的视图形态 —— 卡池、活动行与取图上下文，外加几个拼行的小工具
 * 依赖方向：只依赖 core/region 的类型；被 views/act-calendar 与 views/{gs,sr,zzz}/act-calendar 依赖，无 IO
 * 生命周期：无状态
 * 注意事项：图一律经上下文的 `item` / `reward` 取（元数据与插件资源），接口给的图片地址一处都不用，
 *          见 README「模板约定」的 `official-api-is-data-only`。路径以 `meta-` 开头的走元数据根，
 *          其余走资源根（`template-img-two-roots`）；角标与头像同一张表里两种根都有，模板逐个判。
 */
import type { GameKey } from "../core/region.js"

/** 元数据里查到的一个角色或武器 */
export interface ActItemMeta {
  /** 相对元数据根的图 */
  face: string
  /** 星级 */
  star: number
  /** 元素键 */
  elem?: string
}

/** 造视图要的上下文 */
export interface ActContext {
  /** 游戏 */
  game: GameKey
  /** 查询的 uid */
  uid: string
  /** 发起者昵称 */
  name: string
  /** 现在，毫秒时间戳；星铁接口自带 `now` 时以接口为准 */
  now: number
  /**
   * 查一个角色或武器
   * @param kind 角色或武器
   * @param id 接口给的 id，可空
   * @param name 接口给的名字，可空
   * @returns 查不到时 undefined
   */
  item?: (kind: "char" | "weapon", id: string, name: string) => ActItemMeta | undefined
  /**
   * 查一个奖励物品的图
   * @param name 物品名
   * @returns 相对资源根或元数据根的路径；没有图时空串
   */
  reward?: (name: string) => string
  /**
   * 判一张插件资源图在不在，「放进去就生效」的角标按它挂
   * @param rel 相对资源根的路径
   * @returns 在时为真
   */
  has?: (rel: string) => boolean
}

/**
 * 进行中那一项底边的倒计时线：长度是剩余占全程的比例，颜色分刚开始 / 中段 / 将结束三档
 *
 * 只给剩余、不给全程时（绝区零）整条画满、只按剩余换色。
 */
export interface ActBar {
  /** 剩余占全程的百分比，1~100 */
  pct: number
  /** 剩余过三分之二为 fresh，不足三天或不足两成为 end */
  tone: "fresh" | "mid" | "end"
}

/**
 * 算倒计时线
 * @param left 剩余秒数
 * @param total 全程秒数；不知道时传 0
 * @returns 线；剩余不大于 0 时 undefined
 */
export function barOf(left: number, total: number): ActBar | undefined {
  if (!(left > 0)) return undefined
  const ratio = total > 0 ? Math.min(1, left / total) : 1
  const tone = left < 3 * 86400 || ratio < 0.2 ? "end" : total > 0 && ratio > 2 / 3 ? "fresh" : "mid"
  return { pct: Math.max(1, Math.round(ratio * 100)), tone }
}

/** 卡池里的一格 */
export interface ActFace {
  /** 名字，图缺时取首字 */
  name: string
  /** 图，相对元数据根；缺图时空串 */
  face: string
  /** 稀有度 class 用的星级 */
  star: number
  /** 元素色 class 的后半，空串即不着色 */
  elem: string
  /** 角标，`at` 为位置 */
  badges: { icon: string; at: "bl" | "br" }[]
  /** 左上角的稀有度字母（绝区零），空串即无 */
  rank: string
  /** 角色或武器：武器图不是方的、画面顶到边，模板据此改成整张放进格子，裁成方形会切掉两头 */
  kind: "char" | "weapon"
}

/** 一个卡池 */
export interface ActPool {
  /** 版本角标 */
  version: string
  /** 卡池名 */
  name: string
  /** 进行中 / 未开启 */
  status: "active" | "pending"
  /** 时间那一句；空串即不印 */
  time: string
  /** 时间前的小图：钟 / 锁 / 无 */
  timeIcon: "clock" | "lock" | ""
  /** 不足三天，时间那一句高亮 */
  hot: boolean
  /** 右侧状态字，空串即不画那一栏 */
  state: string
  /** 卡池下的一行补充（绝区零的重映保底） */
  note: string
  /** 格子 */
  faces: ActFace[]
  /** 底边倒计时线，只进行中的有 */
  bar?: ActBar
}

/** 一组卡池（角色 / 武器） */
export interface ActPoolGroup {
  /** 组名，空串即不印 */
  title: string
  /** 卡池 */
  pools: ActPool[]
}

/** 一条活动 */
export interface ActRow {
  /** 名字 */
  name: string
  /** 名字前的类型图，空串即无 */
  icon: string
  /** 未开启 / 进行中 / 已完成，决定左侧色条 */
  status: "pending" | "active" | "done"
  /** 整行压暗（绝区零已完成的那几条） */
  dim: boolean
  /** 名字后跟一个勾 */
  check: boolean
  /** 时间那一句；空串即不印 */
  time: string
  /** 时间前的小图：钟 / 锁 / 无 */
  timeIcon: "clock" | "lock" | ""
  /** 不足三天，时间那一句高亮 */
  hot: boolean
  /** 奖励图，空串即只印文字 */
  rewardIcon: string
  /** 奖励文字（数量或进度），空串即不印 */
  reward: string
  /** 奖励的物品名，图缺时与 `reward` 一起印 */
  rewardName: string
  /** 右侧：整栏只画一个勾 */
  done: boolean
  /** 右侧主值前的小图：资源路径，或 `star`（模板内联的那枚星，颜色随皮肤） */
  pre: string
  /** 右侧主值 */
  value: string
  /** 右侧主值后的 `/总数`，空串即无 */
  total: string
  /** 右侧主值后的小图，取值同 {@link ActRow.pre} */
  post: string
  /** 右侧主值高亮 */
  light: boolean
  /** 右侧第二行 */
  desc: string
  /** 右侧主值不含数字：数字字体没有汉字字形，要换正文字体（由 views/act-calendar 统一补） */
  text: boolean
  /** 底边倒计时线，只进行中的有 */
  bar?: ActBar
  /** 行下挂的一条子项（原神幽境危战的紊乱爆发期） */
  sub?: { label: string; time: string; hot: boolean; icon: string; value: string; total: string }
  /** 行下那一排详细奖励，空数组即不画 */
  items: ActItem[]
}

/** 详细奖励里的一件 */
export interface ActItem {
  /** 物品名 */
  name: string
  /** 图，取法同 {@link ActRow.rewardIcon}；空串即只印名字 */
  icon: string
  /** 数量文字（`×420` / `×58.5万`）；接口不给数量时空串 */
  num: string
  /** 稀有度，决定底色；接口不给时 0 */
  star: number
}

/** 接口里一件奖励的形态，原神星铁同名 */
export interface RawReward {
  /** 物品 id */
  item_id?: number | string
  /** 名字 */
  name?: string
  /** 数量，0 即接口不给 */
  num?: number | string
  /** 稀有度 */
  rarity?: number | string
}

/**
 * 数量 → `×420` / `×58.5万`：万以上缩写，一行排得下十几件
 * @param n 数量
 * @returns 文字；不大于 0 时空串
 */
export function itemNum(n: number): string {
  if (n <= 0) return ""
  if (n < 10000) return `×${n}`
  return `×${String(Math.round(n / 1000) / 10).replace(/\.0$/, "")}万`
}

/**
 * 接口的奖励列表 → 详细奖励
 * @param list 接口给的奖励
 * @param ctx 上下文，取图用
 * @returns 详细奖励，次序照接口
 */
export function itemsOf(list: readonly RawReward[] | undefined, ctx: ActContext): ActItem[] {
  return (list ?? [])
    .filter(it => typeof it.name === "string" && it.name !== "")
    .map(it => {
      const name = it.name ?? ""
      return { name, icon: ctx.reward?.(name) ?? "", num: itemNum(num(it.num)), star: num(it.rarity) }
    })
}

/** 一块活动（同一节下可有几块，各自一张底） */
export interface ActBlock {
  /** 行 */
  rows: ActRow[]
}

/** 一节活动 */
export interface ActSection {
  /** 节名 */
  title: string
  /** 右注（「已全部完成」「敬请期待」） */
  note: string
  /** 块 */
  blocks: ActBlock[]
}

/** 各游戏造出来的主体 */
export interface ActBody {
  /** 卡池那一节的标题 */
  poolTitle: string
  /** 卡池组 */
  groups: ActPoolGroup[]
  /** 活动各节 */
  sections: ActSection[]
}

/**
 * 一条空活动行，各游戏在它上面改
 * @param name 名字
 * @param status 状态
 * @returns 活动行
 */
export function blankRow(name: string, status: ActRow["status"]): ActRow {
  return {
    name,
    icon: "",
    status,
    dim: false,
    check: false,
    time: "",
    timeIcon: "",
    hot: false,
    rewardIcon: "",
    reward: "",
    rewardName: "",
    done: false,
    pre: "",
    value: "",
    total: "",
    post: "",
    light: false,
    desc: "",
    text: false,
    items: []
  }
}

/**
 * 按接口给的数取数，不是数时取 0
 * @param value 任意值
 * @returns 数
 */
export function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * 取一个格子：先查元数据，查不到就只留名字
 * @param ctx 上下文
 * @param kind 角色或武器
 * @param id 接口给的 id
 * @param name 接口给的名字
 * @param star 接口给的星级，元数据没有时用它
 * @returns 格子，角标为空
 */
export function faceOf(ctx: ActContext, kind: "char" | "weapon", id: unknown, name: unknown, star: number): ActFace {
  const label = typeof name === "string" ? name : ""
  const got = ctx.item?.(kind, id === undefined || id === null ? "" : String(id), label)
  return {
    name: label,
    face: got?.face ?? "",
    star: got?.star || star || 5,
    elem: got?.elem ?? "",
    badges: [],
    rank: "",
    kind
  }
}
