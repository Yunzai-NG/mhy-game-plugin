/**
 * 模块职责：七圣召唤三张图的视图模型 —— 牌组、牌组列表与卡牌收集度
 * 依赖方向：纯函数，三个接口由命令层去取；不碰 IO
 * 生命周期：无状态
 * 注意事项：**卡面图一律是米游社绝对地址**，故这族模板除底框与数字图外一处不加根。**数字图只有 0~8 与 10**（血量与费用共用、无 `9.png`），真出现 9 那格空白而非报错。**只画已拥有的卡**（`num > 0`，判断放视图层以便测试固定）。
 */
import { INDENT } from "../../core/text.js"

/** 一张角色牌 */
export interface GcgAvatarCard {
  /** 卡牌名 */
  name: string
  /** 卡面绝对地址 */
  image: string
  /** 生命值，同时也是 `gs/deck/<hp>.png` 的文件名 */
  hp: string
  /** 胜利场数；牌组视图里没有这一栏 */
  proficiency?: number
  /** 使用次数；牌组视图里没有这一栏 */
  useCount?: number
}

/** 一张行动牌要付的一份费用 */
export interface GcgCost {
  /** 费用类型，同时也是 `gs/deck/<type>.png` 的文件名 */
  type: string
  /** 费用点数，同时也是 `gs/deck/<value>.png` 的文件名 */
  value: string
}

/** 一张行动牌 */
export interface GcgActionCard {
  /** 卡牌名 */
  name: string
  /** 卡面绝对地址 */
  image: string
  /** 张数 */
  num: number
  /** 使用次数；牌组视图里没有这一栏 */
  useCount?: number
  /** 费用，可能是两份（同色 + 任意） */
  cost: readonly GcgCost[]
}

/** 一副牌组 */
export interface GcgDeck {
  /** 牌组序号，`#七圣卡组2` 里的那个 2 */
  id: number
  /** 牌组名 */
  name: string
  /** 角色牌，通常三张 */
  avatars: readonly GcgAvatarCard[]
  /** 行动牌 */
  actions: readonly GcgActionCard[]
}

/** 接口给的一张角色牌 */
export interface AvatarCardRaw {
  /** 卡牌名 */
  name?: string
  /** 卡面地址 */
  image?: string
  /** 生命值 */
  hp?: number | string
  /** 张数；卡牌收集度那张据它筛"已拥有" */
  num?: number
  /** 胜利场数 */
  proficiency?: number
  /** 使用次数 */
  use_count?: number
}

/** 接口给的一张行动牌 */
export interface ActionCardRaw {
  /** 卡牌名 */
  name?: string
  /** 卡面地址 */
  image?: string
  /** 张数 */
  num?: number
  /** 使用次数 */
  use_count?: number
  /** 费用 */
  action_cost?: { cost_type?: string; cost_value?: number | string }[]
}

/**
 * 归一一张角色牌
 * @param raw 接口给的那一条
 * @param stats 是否带上胜场与使用次数（卡牌收集度那张要，牌组那张没有这两栏）
 * @returns 归一后的角色牌
 */
export function avatarCardOf(raw: AvatarCardRaw, stats = false): GcgAvatarCard {
  const one: GcgAvatarCard = {
    name: String(raw.name ?? ""),
    image: String(raw.image ?? ""),
    hp: String(raw.hp ?? "")
  }
  if (stats) {
    one.proficiency = Number(raw.proficiency) || 0
    one.useCount = Number(raw.use_count) || 0
  }
  return one
}

/**
 * 归一一张行动牌
 * @param raw 接口给的那一条
 * @param stats 是否带上使用次数
 * @returns 归一后的行动牌
 */
export function actionCardOf(raw: ActionCardRaw, stats = false): GcgActionCard {
  const one: GcgActionCard = {
    name: String(raw.name ?? ""),
    image: String(raw.image ?? ""),
    num: Number(raw.num) || 0,
    cost: (raw.action_cost ?? []).map(it => ({
      type: String(it.cost_type ?? ""),
      value: String(it.cost_value ?? "")
    }))
  }
  if (stats) one.useCount = Number(raw.use_count) || 0
  return one
}

/** 接口给的一副牌组 */
export interface DeckRaw {
  /** 牌组序号 */
  id?: number | string
  /** 牌组名 */
  name?: string
  /** 角色牌 */
  avatar_cards?: AvatarCardRaw[]
  /** 行动牌 */
  action_cards?: ActionCardRaw[]
}

/** `deckList` 接口返回的 data */
export interface DeckListRaw {
  /** 全部牌组 */
  deck_list?: DeckRaw[]
  /** 游戏昵称 */
  nickname?: string
  /** 冒险等级 */
  level?: number
}

/**
 * 归一一副牌组
 * @param raw 接口给的那一条
 * @returns 归一后的牌组
 */
export function deckOf(raw: DeckRaw): GcgDeck {
  return {
    id: Number(raw.id) || 0,
    name: String(raw.name ?? ""),
    avatars: (raw.avatar_cards ?? []).map(one => avatarCardOf(one)),
    actions: (raw.action_cards ?? []).map(one => actionCardOf(one))
  }
}

/** 牌组与牌组列表共用的视图 —— 两张模板的差别只在"画一副还是画全部" */
export interface DeckView extends Record<string, unknown> {
  /** 游戏 uid */
  uid: string
  /** 游戏昵称 */
  nickname: string
  /** 冒险等级 */
  level: number
  /** 要画的牌组，单副形态时只有一项 */
  decks: readonly GcgDeck[]
}

/**
 * 造牌组视图
 * @param raw `deckList` 接口的 data
 * @param uid 游戏 uid
 * @param id 要看的牌组序号；不给则给出全部
 * @returns 视图；指定的序号不存在时 undefined
 */
export function buildDeck(raw: DeckListRaw | null | undefined, uid: string, id?: number): DeckView | undefined {
  const all = (raw?.deck_list ?? []).map(deckOf)
  const decks = id === undefined ? all : all.filter(one => one.id === id)
  if (id !== undefined && decks.length === 0) return undefined
  return {
    uid,
    nickname: String(raw?.nickname ?? ""),
    level: Number(raw?.level) || 0,
    decks
  }
}

/**
 * 无渲染器时的文字形态
 * @param view 视图
 * @returns 文案
 */
export function deckText(view: DeckView): string {
  const lines = [`七圣召唤牌组${INDENT}${view.nickname} Lv.${view.level}${INDENT}uid ${view.uid}`]
  if (view.decks.length === 0) return `${lines[0] ?? ""}\n还没有编好的牌组`
  for (const deck of view.decks) {
    lines.push(`【${deck.id}】${deck.name || "未命名"}`)
    lines.push(`${INDENT}角色：${deck.avatars.map(one => one.name).join("、") || "无"}`)
    if (deck.actions.length > 0) {
      lines.push(`${INDENT}行动牌：${deck.actions.map(one => `${one.name}×${one.num}`).join("、")}`)
    }
  }
  return lines.join("\n")
}

/** `gcg/basicInfo` 接口返回的 data */
export interface GcgBasicRaw {
  /** 邀请等级 */
  level?: number
  /** 游戏昵称 */
  nickname?: string
  /** 已收集角色牌 */
  avatar_card_num_gained?: number
  /** 角色牌总数 */
  avatar_card_num_total?: number
  /** 已收集行动牌 */
  action_card_num_gained?: number
  /** 行动牌总数 */
  action_card_num_total?: number
}

/** 卡牌收集度的视图 */
export interface DeckCardView extends Record<string, unknown> {
  /** 游戏 uid */
  uid: string
  /** 游戏昵称 */
  nickname: string
  /** 邀请等级 */
  level: number
  /** 已收集角色牌，形如 `41/43` */
  avatarGained: string
  /** 已收集行动牌 */
  actionGained: string
  /** 已拥有的角色牌 */
  avatars: readonly GcgAvatarCard[]
  /** 已拥有的行动牌 */
  actions: readonly GcgActionCard[]
}

/**
 * 造卡牌收集度视图 —— 只收 `num > 0`（已拥有）的，判断放视图层而非模板里，故能被测试固定
 * @param basic `basicInfo` 的 data
 * @param avatars `avatar_cardList` 的 data；本次没查则省略
 * @param actions `action_cardList` 的 data；本次没查则省略
 * @param uid 游戏 uid
 * @returns 视图
 */
export function buildDeckCards(
  basic: GcgBasicRaw | null | undefined,
  avatars: { card_list?: AvatarCardRaw[] } | undefined,
  actions: { card_list?: ActionCardRaw[] } | undefined,
  uid: string
): DeckCardView {
  return {
    uid,
    nickname: String(basic?.nickname ?? ""),
    level: Number(basic?.level) || 0,
    avatarGained: `${Number(basic?.avatar_card_num_gained) || 0}/${Number(basic?.avatar_card_num_total) || 0}`,
    actionGained: `${Number(basic?.action_card_num_gained) || 0}/${Number(basic?.action_card_num_total) || 0}`,
    avatars: (avatars?.card_list ?? []).filter(one => (Number(one.num) || 0) > 0).map(one => avatarCardOf(one, true)),
    actions: (actions?.card_list ?? []).filter(one => (Number(one.num) || 0) > 0).map(one => actionCardOf(one, true))
  }
}

/**
 * 无渲染器时的文字形态
 * @param view 视图
 * @returns 文案
 */
export function deckCardText(view: DeckCardView): string {
  const lines = [
    `七圣召唤${INDENT}${view.nickname} 邀请等级 ${view.level}${INDENT}uid ${view.uid}`,
    `已收集角色牌${INDENT}${view.avatarGained}`,
    `已收集行动牌${INDENT}${view.actionGained}`
  ]
  if (view.avatars.length > 0) {
    lines.push("【角色牌】", ...view.avatars.map(one => `${INDENT}${one.name}${INDENT}${one.proficiency}/${one.useCount}`))
  }
  if (view.actions.length > 0) {
    lines.push("【行动牌】", ...view.actions.map(one => `${INDENT}${one.name}×${one.num}${INDENT}用过 ${one.useCount} 次`))
  }
  return lines.join("\n")
}
