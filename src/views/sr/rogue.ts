/**
 * 模块职责：模拟宇宙战绩的视图模型
 * 依赖方向：纯函数，依赖 core/text 与 views/sr/collect 的取数助手；不发请求、不读元数据
 * 生命周期：无状态
 * 注意事项：字段与官方页面逐项对过，返回三段：`role`、`basic_info`、`latest_record`。一次通关记录里各块形态各不相同、都按官方认键（`base_type_list`/`buffs`/`miracles`（**只有图标没名字**）/`final_lineup`/`blocks`/`boss_effect`）。
 *          **`fury` 那栏两种含义共用一个字段**（`type` 为 0 是「位面紊乱倒计」、否则「扰动等级」，按一种印会在另一玩法印出相反含义的数字）。**奇物与角色图都是绝对地址、不可加资源根**；命途图官方取本地图、本插件没有，故命途只印名字与数量（名字在 `buffs[].base_type.name`）。
 */
import { INDENT } from "../../core/text.js"

/** 接口给的一个命途计数 */
export interface SrRogueBaseTypeRaw {
  /** 命途 id */
  id?: number | string
  /** 该命途的祝福数 */
  cnt?: number | string
}

/** 接口给的一条祝福 */
export interface SrRogueBuffItemRaw {
  /** 祝福 id */
  id?: number | string
  /** 祝福名 */
  name?: string
  /** 稀有度档位 */
  rank?: number | string
  /** 是否已强化 */
  is_evoluted?: boolean
}

/** 接口给的一组祝福（按命途分组） */
export interface SrRogueBuffRaw {
  /** 所属命途 */
  base_type?: { id?: number | string; name?: string }
  /** 逐条祝福 */
  items?: SrRogueBuffItemRaw[]
}

/** 接口给的一件奇物 */
export interface SrRogueMiracleRaw {
  /** 奇物 id */
  id?: number | string
  /** 名称，官方那张图上只画图标，故这一栏未必有 */
  name?: string
  /** 图标，米游社的绝对地址 */
  icon?: string
  /** 稀有度档位 */
  rank?: number | string
}

/** 接口给的一个上场角色 */
export interface SrRogueAvatarRaw {
  /** 角色 id */
  id?: number | string
  /** 等级 */
  level?: number | string
  /** 头像，米游社的绝对地址 */
  icon?: string
  /** 星级 */
  rarity?: number | string
  /** 命途，形如 `fire` */
  element?: string
  /** 星魂数 */
  rank?: number | string
}

/** 接口给的一次通关记录 */
export interface SrRogueRecordRaw {
  /** 世界名 */
  name?: string
  /** 世界名的另一种写法 */
  name_mi?: string
  /** 难度档位 */
  difficulty?: number | string
  /** 难度类别 */
  difficulty_type?: number | string
  /** 有没有难度类别这一栏 */
  has_difficulty_type?: boolean
  /** 进度 */
  progress?: number | string
  /** 通关时刻 */
  finish_time?: { year?: number; month?: number; day?: number; hour?: number; minute?: number }
  /** 命途与其祝福数 */
  base_type_list?: SrRogueBaseTypeRaw[]
  /** 逐命途的祝福 */
  buffs?: SrRogueBuffRaw[]
  /** 奇物 */
  miracles?: SrRogueMiracleRaw[]
  /** 通关阵容 */
  final_lineup?: SrRogueAvatarRaw[]
  /** 缓存角色 */
  cached_avatars?: SrRogueAvatarRaw[]
  /** 通过的区域类型 */
  blocks?: { id?: number | string; name?: string; num?: number | string }[]
  /** 首领效果，一组纯字符串 */
  boss_effect?: string[]
  /** 位面紊乱倒计（type 为 0）或扰动等级 */
  fury?: { type?: number | string; point?: number | string }
}

/** `rogue` 接口的返回 */
export interface SrRogueRaw {
  /** 玩家信息 */
  role?: { nickname?: string; level?: number }
  /** 数据总览 */
  basic_info?: {
    /** 已解锁祝福数 */
    unlocked_buff_num?: number | string
    /** 已解锁奇物数 */
    unlocked_miracle_num?: number | string
    /** 已解锁技能树点数 */
    unlocked_skill_points?: number | string
  }
  /** 最近一期的记录 */
  latest_record?: {
    /** 本期有没有战绩 */
    has_data?: boolean
    /** 期次概要 */
    basic?: { finish_cnt?: number | string }
    /** 逐次通关 */
    records?: SrRogueRecordRaw[]
  }
}

/** 出图与出文字共用的上下文 */
export interface SrRogueContext {
  /** uid */
  uid: string
  /** 玩家昵称，接口给不出时用查询者的 */
  nickname?: string
  /** 按角色 id 取中文名，接口只给 id */
  nameOf?: (id: string) => string
}

/** 判定结果 */
export type SrRogueState = "ok" | "noData"

/**
 * 取数字
 * @param value 原始值
 * @returns 数字；脏值一律 0
 */
function num(value: unknown): number {
  const out = Number(value)
  return Number.isFinite(out) ? out : 0
}

/**
 * 判这份返回能不能出图
 *
 * **`has_data` 与 `records` 都要看**：`has_data` 为真而 `records` 为空出现在请求少带 `need_detail` 时，那是一张一条记录都没有的图。
 * @param raw 接口返回
 * @returns 判定结果
 */
export function srRogueState(raw: SrRogueRaw | undefined): SrRogueState {
  const one = raw?.latest_record
  if (one?.has_data === false) return "noData"
  return (one?.records ?? []).length > 0 ? "ok" : "noData"
}

/**
 * 接口给的时刻 → "08-01 04:00"
 * @param time 接口给的时刻
 * @returns 可读时刻；给不全时为空串
 */
function timeOf(time: SrRogueRecordRaw["finish_time"]): string {
  if (!time?.month || !time.day) return ""
  const two = (n: number): string => String(n).padStart(2, "0")
  return `${two(time.month)}-${two(time.day)} ${two(time.hour ?? 0)}:${two(time.minute ?? 0)}`
}

/**
 * `fury` 那一栏 → 一行可读文字
 *
 * 两种含义共用一个字段，按一种印会在另一玩法上印出含义相反的数字。
 * @param fury 接口给的那一栏
 * @returns 形如「扰动等级 3」；没有时为空串
 */
export function srRogueFuryText(fury: SrRogueRecordRaw["fury"]): string {
  if (!fury || fury.point === undefined || fury.point === null) return ""
  return `${num(fury.type) === 0 ? "位面紊乱倒计" : "扰动等级"} ${num(fury.point)}`
}

/**
 * 把模拟宇宙返回转成 `sr/rogue` 要的形态
 *
 * **命途只印名字与数量**：官方那张图的命途图标取自页面自带的本地图、本插件没有那一套；名字在 `buffs[].base_type.name` 里，与 `base_type_list[].id` 按 id 对上。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function srRogueData(raw: SrRogueRaw | undefined, ctx: SrRogueContext): Record<string, unknown> {
  const nameOf = ctx.nameOf ?? ((): string => "")
  const basic = raw?.basic_info ?? {}
  const records = (raw?.latest_record?.records ?? []).map(one => {
    // 命途名要从祝福那一段反查：`base_type_list` 只给 id 与数量
    const named = new Map<string, string>()
    for (const buff of one.buffs ?? []) {
      const id = String(buff.base_type?.id ?? "")
      if (id !== "" && buff.base_type?.name) named.set(id, buff.base_type.name)
    }

    return {
      name: one.name ?? one.name_mi ?? "模拟宇宙",
      difficulty: num(one.difficulty),
      progress: num(one.progress),
      time: timeOf(one.finish_time),
      fury: srRogueFuryText(one.fury),
      paths: (one.base_type_list ?? []).map(it => {
        const id = String(it.id ?? "")
        return { id, name: named.get(id) ?? "", cnt: num(it.cnt) }
      }),
      buffs: (one.buffs ?? []).map(it => ({
        name: it.base_type?.name ?? "",
        items: (it.items ?? []).map(item => ({
          name: item.name ?? "",
          rank: num(item.rank),
          // 已强化的那一条官方另加一枚角标
          upgraded: item.is_evoluted === true
        }))
      })),
      // 奇物只有图标与档位，官方那张图上也只画图标
      miracles: (one.miracles ?? []).map(it => ({
        id: String(it.id ?? ""),
        name: it.name ?? "",
        icon: it.icon ?? "",
        rank: num(it.rank)
      })),
      lineup: (one.final_lineup ?? []).map(it => {
        const id = String(it.id ?? "")
        return {
          id,
          name: id === "" ? "" : nameOf(id),
          icon: it.icon ?? "",
          level: num(it.level),
          rarity: num(it.rarity) || 5,
          rank: num(it.rank)
        }
      }),
      blocks: (one.blocks ?? []).map(it => ({ name: it.name ?? "", num: num(it.num) })),
      bossEffect: (one.boss_effect ?? []).filter(it => typeof it === "string" && it !== "")
    }
  })

  return {
    uid: ctx.uid,
    save_id: ctx.uid,
    nickname: raw?.role?.nickname ?? ctx.nickname ?? "",
    title: "模拟宇宙",
    buffNum: num(basic.unlocked_buff_num),
    miracleNum: num(basic.unlocked_miracle_num),
    skillPoints: num(basic.unlocked_skill_points),
    finishCnt: num(raw?.latest_record?.basic?.finish_cnt),
    records
  }
}

/**
 * 模拟宇宙 → 纯文字
 *
 * **就着模板数据来**，两种形态才不会在"命途名从哪来"这类口径上各走一路。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function srRogueText(raw: SrRogueRaw | undefined, ctx: SrRogueContext): string {
  const view = srRogueData(raw, ctx)
  const records = view["records"] as {
    name: string
    difficulty: number
    progress: number
    fury: string
    lineup: { name: string; id: string }[]
  }[]
  const lines = [
    `UID${ctx.uid} 模拟宇宙 本期通关 ${String(view["finishCnt"])} 次` +
      `（已解锁祝福 ${String(view["buffNum"])} 奇物 ${String(view["miracleNum"])}）`
  ]
  if (records.length === 0) return `${lines[0]}\n${INDENT}本期尚无通关记录`
  for (const one of records) {
    const who = one.lineup.map(it => it.name || it.id).filter(Boolean)
    lines.push(
      `${one.name}${INDENT}难度 ${one.difficulty}${INDENT}进度 ${one.progress}` +
        `${one.fury ? `${INDENT}${one.fury}` : ""}`
    )
    if (who.length > 0) lines.push(`${INDENT}阵容：${who.join("、")}`)
  }
  return lines.join("\n")
}

