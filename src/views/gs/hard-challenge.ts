/**
 * 模块职责：幽境危战 —— 把 `hard_challenge` 的返回转成 `gs/hard-challenge` 要的形态
 * 依赖方向：依赖 core/text（时间格式化）与 views/avatar-list 的卡片类型；纯函数，不发请求
 * 生命周期：无状态
 * 注意事项：**通关用时以秒计、要精确到秒**（既有 `duration`/`cnDuration` 从分钟起算、会把 47 秒与 3 秒显示成同一句），故另给 {@link hardSecondText}。
 *          **上场队伍改用整张角色卡**：卡由命令层按 index + 面板库造好、以 `cards` 传入（天赋/武器/圣遗物只有面板库有），查不到的 id 退回只带接口头像的占位卡。
 *          亮眼记录的头像取自同一份卡（元数据），接口那几个图键不用（见 `official-api-is-data-only`）。**难度档位印官方名**（见 {@link DIFFICULTY_NAME}）。
 */
import type { AvatarCardView } from "../avatar-list.js"
import { medalOf } from "./act-calendar.js"
import { INDENT, stamp } from "../../core/text.js"

/**
 * 难度档位 → 官方名
 *
 * 米游社战绩页印的就是这几个名；表里没有的档位退回原数字（陌生数字仍胜过空白）。
 */
const DIFFICULTY_NAME: Readonly<Record<number, string>> = {
  1: "普通",
  2: "进阶",
  3: "困难",
  4: "险恶",
  5: "无畏",
  6: "绝境"
}

/**
 * 取难度档位的官方名
 * @param difficulty 档位
 * @returns 档位名；档位为 0 时空串
 */
export function hardDifficultyName(difficulty: number | string | undefined): string {
  const num = Number(difficulty) || 0
  if (num <= 0) return ""
  return DIFFICULTY_NAME[num] ?? String(num)
}

/** 本期的怪物 */
export interface HardMonsterRaw {
  /** 名称 */
  name?: string
  /** 图标，米游社的绝对地址 */
  icon?: string
  /** 等级 */
  level?: number
  /** 机制说明，逐条；正文里夹着 `<color=#xxxxxx>…</color>` 的着色段，常有空串 */
  desc?: string[]
}

/** 一个上场角色 */
export interface HardTeamAvatarRaw {
  /** 角色 id */
  avatar_id?: number | string
  /** 角色名 */
  name?: string
  /** 元素，形如 `Pyro` */
  element?: string
  /** 头像，米游社的绝对地址 */
  image?: string
  /** 等级 */
  level?: number
  /** 星级 */
  rarity?: number
  /** 命座数 */
  rank?: number
}

/** 一项亮眼记录：`type` 1 最强一击、2 最高总伤害 */
export interface HardBestAvatarRaw {
  /** 角色 id */
  avatar_id?: number | string
  /** 侧脸 */
  side_icon?: string
  /** 头像 */
  image?: string
  /** 图标 */
  icon?: string
  /** 数值，如最强一击 */
  dps?: number | string
  /** 类别 */
  type?: number
}

/** 一场挑战 */
export interface HardFloorRaw {
  /** 挑战名 */
  name?: string
  /** 通关用时，秒 */
  second?: number
  /** 对手 */
  monster?: HardMonsterRaw
  /** 亮眼记录 */
  best_avatar?: HardBestAvatarRaw[]
  /** 上场队伍 */
  teams?: HardTeamAvatarRaw[]
}

/** 单人挑战的整份记录 */
export interface HardSingleRaw {
  /** 本期最佳 */
  best?: {
    /** 难度档位 */
    difficulty?: number
    /** 用时，秒 */
    second?: number
  }
  /** 逐场挑战 */
  challenge?: HardFloorRaw[]
  /** 有没有战绩 */
  has_data?: boolean
}

/** 一期 */
export interface HardSeasonRaw {
  /** 期次 */
  schedule?: {
    /** 开始时刻，秒级时间戳 */
    start_time?: number | string
    /** 结束时刻，秒级时间戳 */
    end_time?: number | string
    /** 期次名 */
    name?: string
  }
  /** 单人挑战 */
  single?: HardSingleRaw
  /** 期次名，有的返回把它放在这一层 */
  name?: string
}

/** `hard_challenge` 的返回 */
export interface HardChallengeRaw {
  /** 逐期，第一项即本期 */
  data?: HardSeasonRaw[]
  /** 该账号是否已解锁 */
  is_unlock?: boolean
}

/** 出图要的上下文 */
export interface HardChallengeContext {
  /** uid */
  uid: string
  /** 玩家信息，取自 `index` 接口的 `role` */
  role?: { nickname?: string; level?: number; game_head_icon?: string; AvatarUrl?: string }
  /** 角色 id → 头像卡，命令层按 index + 面板库造好传入；查不到的 id 退回占位卡 */
  cards?: Readonly<Record<string, AvatarCardView>>
}

/** 判定结果 */
export type HardChallengeState = "ok" | "locked" | "noData"

/**
 * 取本期
 * @param raw 接口返回
 * @returns 本期；没有时 undefined
 */
export function hardChallengeSeason(raw: HardChallengeRaw | undefined): HardSeasonRaw | undefined {
  return raw?.data?.[0]
}

/**
 * 判这份返回能不能出图
 *
 * 没解锁与没打过要分开说：前者是"这个账号没有这个玩法"，后者过一局就有了。
 * @param raw 接口返回
 * @returns 判定结果
 */
export function hardChallengeState(raw: HardChallengeRaw | undefined): HardChallengeState {
  if (raw?.is_unlock === false) return "locked"
  const single = hardChallengeSeason(raw)?.single
  if (!single || single.has_data === false) return "noData"
  return (single.challenge ?? []).length > 0 ? "ok" : "noData"
}

/**
 * 秒数 → "1 分 23 秒"
 *
 * 这个玩法比的是秒数，故与既有的 `duration` / `cnDuration` 都不同，见文件头。
 * @param second 秒数
 * @returns 可读用时；没有时为空串
 */
export function hardSecondText(second: number | string | undefined): string {
  const total = Math.floor(Number(second) || 0)
  if (total <= 0) return ""
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (!minutes) return `${rest} 秒`
  return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
}

/**
 * 秒级时间戳 → "08-22 10:05"
 * @param sec 秒级时间戳，接口有时给字符串
 * @returns 可读时刻；没有时为空串
 */
export function hardTimeText(sec: number | string | undefined): string {
  const num = Number(sec) || 0
  return num > 0 ? stamp(num * 1000) : ""
}

/** 模板要的一项亮眼记录 */
export interface HardBestAvatarView extends Record<string, unknown> {
  /** 名目：最强一击 / 最高总伤害 */
  title: string
  /** 头像，元数据相对路径（取自角色卡）；查不到时空串 */
  icon: string
  /** 角色名 */
  name: string
  /** 数值 */
  dps: string
}

/** 机制说明里的一段：着色段带 `color`，其余为空串 */
export interface HardDescPart {
  /** 正文 */
  text: string
  /** 颜色，只收 `#` 加 3~8 位十六进制；其余写法一律当无色 */
  color: string
}

/** `best_avatar` 的 `type` → 名目；接口只给这两类，顺序即官方页的左右 */
const BEST_TITLE: Readonly<Record<number, string>> = { 1: "最强一击", 2: "最高总伤害" }

/**
 * 机制说明的一条 → 分段
 *
 * 不把标签原样交给模板去插 HTML：正文出自接口，按白名单拆成纯文字段再由模板转义着色，就不会被夹带的标签打开口子。
 * @param line 接口给的一条
 * @returns 分段；整条为空时空数组
 */
export function hardDescParts(line: string): HardDescPart[] {
  const out: HardDescPart[] = []
  const re = /<color=([^>]*)>([\s\S]*?)<\/color>/g
  let last = 0
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), color: "" })
    const color = /^#[0-9a-fA-F]{3,8}$/.test(m[1] ?? "") ? (m[1] ?? "") : ""
    out.push({ text: m[2] ?? "", color })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ text: line.slice(last), color: "" })
  return out.map(it => ({ ...it, text: it.text.replace(/<[^>]*>/g, "") })).filter(it => it.text !== "")
}

/** 模板要的一场挑战 */
export interface HardFloorView extends Record<string, unknown> {
  /** 挑战名 */
  name: string
  /** 用时，已格式化 */
  time: string
  /** 对手名 */
  monsterName: string
  /** 对手图标 */
  monsterIcon: string
  /** 对手等级 */
  monsterLevel: number
  /** 上场队伍，整张角色卡 */
  teams: AvatarCardView[]
  /** 亮眼记录：最强一击、最高总伤害，接口没给时为空数组 */
  best: HardBestAvatarView[]
  /** 对手机制说明，逐条分段 */
  desc: HardDescPart[][]
}

/**
 * 卡 map 里没有这个角色时的占位卡
 *
 * 只带接口给的头像、名字、元素、等级、星级、命座；天赋 / 武器 / 套装留空壳，模板据此只画头像。
 * @param it 接口给的上场角色
 * @returns 占位卡
 */
function fallbackCard(it: HardTeamAvatarRaw): AvatarCardView {
  return {
    id: String(it.avatar_id ?? ""),
    name: it.name ?? "",
    abbr: it.name ?? "",
    // 接口给英文元素名（`Pyro`），卡片的 elem 类名要小写
    elem: (it.element ?? "").toLowerCase(),
    star: Number(it.rarity) || 4,
    level: Number(it.level) || 0,
    cons: Number(it.rank) || 0,
    game: "gs",
    face: it.image ?? "",
    gacha: "",
    preview: "",
    talent: {},
    tals: [],
    xtals: [],
    weapon: { star: 0, img: "", affix: 0 },
    artisSet: { names: [], imgs: [] }
  }
}

/**
 * 把一份 `hard_challenge` 转成 `gs/hard-challenge` 要的形态
 *
 * **`teams` 与 `best` 恒为数组**（模板对二者取 `.length`，而接口在「某一场没有队伍记录」时不给这两个键，取 undefined 的 `length` 会抛错 —— 表现是整张图出不来、只退回纯文字）；上场队伍按 `avatar_id` 从 `ctx.cards` 取整张卡，查不到退回只带接口头像的占位卡。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function hardChallengeTemplateData(
  raw: HardChallengeRaw | undefined,
  ctx: HardChallengeContext
): Record<string, unknown> {
  const season = hardChallengeSeason(raw)
  const single = season?.single ?? {}
  const cards = ctx.cards ?? {}

  const challenge: HardFloorView[] = (single.challenge ?? []).map(one => {
    const best: HardBestAvatarView[] = (one.best_avatar ?? [])
      .filter(it => it.dps !== undefined && it.dps !== "")
      .map((it, i) => {
        const card = cards[String(it.avatar_id ?? "")]
        return {
          title: BEST_TITLE[Number(it.type) || i + 1] ?? "",
          icon: card?.face ?? "",
          name: card?.abbr ?? card?.name ?? "",
          dps: String(it.dps)
        }
      })

    return {
      name: one.name ?? "",
      time: hardSecondText(one.second),
      monsterName: one.monster?.name ?? "",
      monsterIcon: one.monster?.icon ?? "",
      monsterLevel: Number(one.monster?.level) || 0,
      teams: (one.teams ?? []).map(it => {
        const id = String(it.avatar_id ?? "")
        return (id ? cards[id] : undefined) ?? fallbackCard(it)
      }),
      best,
      desc: (one.monster?.desc ?? []).map(hardDescParts).filter(it => it.length > 0)
    }
  })

  return {
    uid: ctx.uid,
    role: ctx.role ?? {},
    season: season?.schedule?.name ?? season?.name ?? "",
    begin: hardTimeText(season?.schedule?.start_time),
    end: hardTimeText(season?.schedule?.end_time),
    difficulty: Number(single.best?.difficulty) || 0,
    difficultyName: hardDifficultyName(single.best?.difficulty),
    medal: medalOf(Number(single.best?.difficulty) || 0, Number(single.best?.second) || 0),
    bestTime: hardSecondText(single.best?.second),
    challenge
  }
}

/**
 * 幽境危战的纯文字形态
 *
 * 无渲染器时用。逐场列出对手与上场角色 —— 对手名是这个玩法里最要紧的一项（同一档难度下换对手，用时便不可比）。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function hardChallengeText(raw: HardChallengeRaw | undefined, ctx: HardChallengeContext): string {
  const season = hardChallengeSeason(raw)
  const single = season?.single ?? {}
  const lines = [`UID${ctx.uid} 幽境危战${season?.schedule?.name ? ` · ${season.schedule.name}` : ""}`]
  const best = hardSecondText(single.best?.second)
  const difficulty = hardDifficultyName(single.best?.difficulty)
  lines.push(`本期最佳：难度 ${difficulty || "-"}${best ? `，用时 ${best}` : ""}`)

  for (const one of single.challenge ?? []) {
    const who = (one.teams ?? []).map(it => it.name ?? "").filter(it => it !== "")
    const time = hardSecondText(one.second)
    const monster = one.monster?.name ?? ""
    lines.push(
      `${one.name || "未命名挑战"}${monster ? `${INDENT}对手 ${monster}` : ""}${time ? `${INDENT}用时 ${time}` : ""}` +
        `\n${INDENT}出战：${who.join("、") || "无记录"}`
    )
  }
  return lines.join("\n")
}
