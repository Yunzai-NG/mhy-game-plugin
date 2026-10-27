/**
 * 模块职责：不可知域（`*不可知域`）的视图模型
 * 依赖方向：纯函数，依赖 core/text；不发请求、不碰 IO
 * 生命周期：无状态
 * 注意事项：字段取自真机响应（`rogue_magic`），返回四段：`role`、`basic_info`（含 `magic_record` 当期）、`normal_record_list[]`（分形档案）、`custom_record_list[]`（庸众集）。两族名字取自官方页面分栏文案兜底值、非意译。
 *          **三项进度接口给的就是带百分号字符串**（`"66%"`），原样透传别再补 `%`（否则 `0%%`）。**`completed_time` 有两种空形态**（`null` 与六字段全 0 的对象），都要判成「没有时刻」。**`calculation_tendency` 也可能 `null`**，取 `name` 前要兜。
 *          **两族记录同形、共用一个映射函数**（差别只在分两栏）；**自定义那族恒有六条**（六个预设难度），「有没有打过」要看有无一条带完成时刻、不能按数组长度判。
 */
import { INDENT } from "../../core/text.js"

/** 接口给的一个时刻，没打完时六项全为 0 */
export interface MagicTimeRaw {
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
  /** 秒 */
  second?: number
}

/** 接口给的一位上场角色 */
export interface MagicAvatarRaw {
  /** 角色 id */
  id?: number | string
  /** 等级 */
  level?: number | string
  /** 星级 */
  rarity?: number | string
  /** 命途 id */
  rank?: number | string
  /** 头像，米游社绝对地址 */
  icon?: string
}

/** 接口给的一件奇物或造物 */
export interface MagicItemRaw {
  /** id */
  id?: number | string
  /** 名称 */
  name?: string
  /** 图标 */
  icon?: string
  /** 稀有度 */
  rank?: number | string
}

/** 接口给的一条挑战记录，两族同形 */
export interface MagicRecordRaw {
  /** 难度名 */
  name?: string
  /** 记录 id */
  id?: number
  /** 附加谜题数 */
  additional_problems_num?: number
  /** 难度等级 */
  level?: number
  /** 本期总层数 */
  schedule_total_floor_num?: number
  /** 本期已通层数 */
  schedule_current_floor_num?: number
  /** 附加回合 */
  additional_rounds?: number
  /** 完成时刻；没打完时六项全 0，当期记录没打时为 null */
  completed_time?: MagicTimeRaw | null
  /** 上场阵容 */
  avatar_list?: MagicAvatarRaw[]
  /** 造物 */
  magic_list?: MagicItemRaw[]
  /** 奇物 */
  miracle_list?: MagicItemRaw[]
  /** 演算倾向；当期没打时为 null */
  calculation_tendency?: { display_id?: number; icon?: string; name?: string } | null
  /** 记录类型 */
  record_type?: string
  /** 有没有附加回合 */
  exist_additional_rounds?: boolean
}

/** `rogue_magic` 接口的返回 */
export interface RogueMagicRaw {
  /** 玩家 */
  role?: { nickname?: string; level?: number }
  /** 总览 */
  basic_info?: {
    /** 线性树进度，带百分号 */
    linear_tree_num?: string
    /** 造物图鉴进度，带百分号 */
    magic_compendium?: string
    /** 秘密发现进度，带百分号 */
    discover_secrets?: string
    /** 挑战任务总数 */
    challenge_task_total_num?: number
    /** 挑战任务已完成数 */
    challenge_task_current_num?: number
    /** 当期记录 */
    magic_record?: MagicRecordRaw
  }
  /** 「分形档案」记录 */
  normal_record_list?: MagicRecordRaw[]
  /** 「庸众集」记录，恒有六条（各关卡） */
  custom_record_list?: MagicRecordRaw[]
}

/** 出图与出文字共用的上下文 */
export interface RogueMagicContext {
  /** uid */
  uid: string
  /** 玩家昵称 */
  nickname?: string
  /**
   * 看的是哪一期，「本期」或「上期」
   *
   * 命令层可能自动改问上期（这一块的赛季长，"本期还没打"是常态），故图上必须标明 ——
   * 不标会让人把上期的成绩当成本期的。
   */
  period?: string
  /** 由角色 id 取名称，通常查元数据 */
  nameOf?: (id: string) => string
}

/** 两种「没有内容」 */
export type RogueMagicState = "noData" | "ok"

/**
 * 判一个时刻是不是"真的有时刻"
 *
 * **两种空形态都要认出来**：`null`（当期没打）与六个字段全为 0 的对象（那一条没打完）；只判 `null` 会让图上印出「0000-00-00 00:00」。
 * @param time 接口给的时刻
 * @returns 有时刻则真
 */
export function hasTime(time: MagicTimeRaw | null | undefined): boolean {
  return !!time?.year && time.year > 0
}

/**
 * 时刻排版
 * @param time 接口给的时刻
 * @returns `2026-09-12 13:05`；没有时刻时空串
 */
export function magicTime(time: MagicTimeRaw | null | undefined): string {
  if (!hasTime(time)) return ""
  const pad = (v: number | undefined): string => String(v ?? 0).padStart(2, "0")
  return `${time?.year}-${pad(time?.month)}-${pad(time?.day)} ${pad(time?.hour)}:${pad(time?.minute)}`
}

/**
 * 判这份返回有没有可出图的内容
 *
 * **不能按数组长度判**：`custom_record_list` 恒有六条（六个预设难度，没打过的各项为 0），故判据是「有没有一条带完成时刻，或当期记录有层数」—— 按长度判会让从没打过的账号也出一张全零的图。
 * @param raw 接口返回
 * @returns 状态
 */
export function rogueMagicState(raw: RogueMagicRaw | undefined): RogueMagicState {
  const all = [...(raw?.normal_record_list ?? []), ...(raw?.custom_record_list ?? [])]
  if (all.some(one => hasTime(one.completed_time))) return "ok"
  // 当期正在打（有层数）也算有内容 —— 那时还没有完成时刻，但图上有东西可看
  if ((raw?.basic_info?.magic_record?.schedule_current_floor_num ?? 0) > 0) return "ok"
  return "noData"
}

/**
 * 一条记录摊成出图形态
 * @param raw 接口给的一条
 * @param nameOf 由角色 id 取名称
 * @returns 出图形态
 */
function recordOf(raw: MagicRecordRaw, nameOf?: (id: string) => string): Record<string, unknown> {
  const cur = raw.schedule_current_floor_num ?? 0
  const max = raw.schedule_total_floor_num ?? 0
  return {
    name: raw.name ?? "",
    id: raw.id ?? 0,
    level: raw.level ?? 0,
    floor: { cur, max, full: max > 0 && cur >= max },
    // 打过的才有时刻，图上据它区分"打过"与"没打过"
    time: magicTime(raw.completed_time),
    played: hasTime(raw.completed_time),
    problems: raw.additional_problems_num ?? 0,
    rounds: raw.additional_rounds ?? 0,
    extraRounds: !!raw.exist_additional_rounds,
    // 演算倾向可能是 null，取名字前要兜
    tendency: { name: raw.calculation_tendency?.name ?? "", icon: raw.calculation_tendency?.icon ?? "" },
    avatars: (raw.avatar_list ?? []).map(one => {
      const id = String(one.id ?? "")
      return {
        id,
        name: nameOf?.(id) ?? "",
        level: Number(one.level) || 0,
        rarity: Number(one.rarity) || 0,
        icon: one.icon ?? ""
      }
    }),
    magics: (raw.magic_list ?? []).map(one => ({
      id: String(one.id ?? ""),
      name: one.name ?? "",
      icon: one.icon ?? "",
      rank: Number(one.rank) || 0
    })),
    miracles: (raw.miracle_list ?? []).map(one => ({
      id: String(one.id ?? ""),
      name: one.name ?? "",
      icon: one.icon ?? "",
      rank: Number(one.rank) || 0
    }))
  }
}

/**
 * `rogue_magic` → 出图数据
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function rogueMagicData(raw: RogueMagicRaw | undefined, ctx: RogueMagicContext): Record<string, unknown> {
  const basic = raw?.basic_info
  const cur = basic?.challenge_task_current_num ?? 0
  const max = basic?.challenge_task_total_num ?? 0

  return {
    game: "sr",
    title: "不可知域",
    uid: ctx.uid,
    // 缺省「本期」：命令层没说时看的就是本期
    period: ctx.period ?? "本期",
    nickname: ctx.nickname ?? raw?.role?.nickname ?? "",
    level: raw?.role?.level ?? 0,
    // 这三项接口给的已经带百分号，原样透传 —— 再补一个会印出 `0%%`
    progress: {
      tree: basic?.linear_tree_num ?? "0%",
      compendium: basic?.magic_compendium ?? "0%",
      secrets: basic?.discover_secrets ?? "0%"
    },
    task: { cur, max, full: max > 0 && cur >= max },
    // 当期那一份单独给：它是"正在打的这一局"，与下面两族历史记录不同
    ...(basic?.magic_record ? { current: recordOf(basic.magic_record, ctx.nameOf) } : {}),
    /*
     * 两族记录**在视图层就分好组**，而不是给模板两个数组各画一遍
     *
     * 图与文字回退要的是同一种分法（分形档案一组、庸众集一组，各自空组不出现），
     * 分在模板里就意味着同一条口径写两遍 —— 改一处另一处不跟着变。
     *
     * **只留打过的**：庸众集那族接口恒给六条（未打的 `completed_time` 六个字段全是 0），
     * 全画会出一片空格子，看着像图坏了。
     */
    groups: [
      { name: "分形档案", list: (raw?.normal_record_list ?? []).filter(one => hasTime(one.completed_time)).map(one => recordOf(one, ctx.nameOf)) },
      { name: "庸众集", list: (raw?.custom_record_list ?? []).filter(one => hasTime(one.completed_time)).map(one => recordOf(one, ctx.nameOf)) }
    ].filter(one => one.list.length > 0)
  }
}

/**
 * 不可知域 → 纯文字，出图失败时用
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function rogueMagicText(raw: RogueMagicRaw | undefined, ctx: RogueMagicContext): string {
  if (rogueMagicState(raw) === "noData") return "不可知域本期尚无通关记录，完成一次挑战后再来查询"

  const data = rogueMagicData(raw, ctx)
  const progress = data["progress"] as { tree: string; compendium: string; secrets: string }
  const task = data["task"] as { cur: number; max: number }
  const lines = [
    `不可知域 UID ${ctx.uid}`,
    `${INDENT}线性树 ${progress.tree}${INDENT}造物图鉴 ${progress.compendium}${INDENT}秘密发现 ${progress.secrets}`,
    `${INDENT}挑战任务 ${task.cur}/${task.max}`
  ]

  // 分组与出图共用视图层那一份，故这里不再自己分一遍（理由见 rogueMagicData 里那段注释）
  for (const group of data["groups"] as { name: string; list: Record<string, unknown>[] }[]) {
    lines.push(`${INDENT}【${group.name}】`)
    for (const one of group.list) {
      const floor = one["floor"] as { cur: number; max: number }
      const avatars = (one["avatars"] as { name: string; id: string }[]).map(it => it.name || it.id)
      lines.push(
        `${INDENT}${INDENT}${String(one["name"])}${INDENT}第 ${floor.cur}/${floor.max} 层${INDENT}${String(one["time"])}`,
        `${INDENT}${INDENT}阵容 ${avatars.length > 0 ? avatars.join("、") : "无记录"}`
      )
    }
  }
  return lines.join("\n")
}
