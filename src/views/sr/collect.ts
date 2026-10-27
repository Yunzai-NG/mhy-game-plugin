/**
 * 模块职责：星穹铁道两项收集进度的视图模型 —— 达成成就数与战利品开启
 * 依赖方向：纯函数，依赖 core/text；不发请求、不读元数据
 * 生命周期：无状态
 * 注意事项：字段与官方页面逐项对过（成就总数由三档相加而非另有字段）。**`cur`/`max` 接口给的是字符串**，比大小前套 `Number()`（直接比字符串会把「9/10」判成已满、「10/9」判成未满）。
 *          **图标一律绝对地址、模板不可加资源根**（加了会拼成 `file:///…https://…`、那格空白）。**`world_id` 为 `999` 那项官方另换过名字**（mi18n 取不到、沿用接口名、连名都不给才退「其他」，编一个更糟）。
 */
import { INDENT } from "../../core/text.js"

/** 接口给的一个成就系列 */
export interface SrAchieveSeriesRaw {
  /** 系列 id */
  series_id?: number | string
  /** 系列名 */
  name?: string
  /** 图标，米游社的绝对地址 */
  icon?: string
  /** 已达成，接口给的是字符串 */
  cur?: number | string
  /** 总数，接口给的是字符串 */
  max?: number | string
}

/** `achievement_info` 接口的返回 */
export interface SrAchieveRaw {
  /** 金档枚数 */
  gold_num?: number | string
  /** 银档枚数 */
  silver_num?: number | string
  /** 铜档枚数 */
  copper_num?: number | string
  /** 逐个系列 */
  list?: SrAchieveSeriesRaw[]
}

/** 接口给的一个区域 */
export interface SrChestAreaRaw {
  /** 区域 id */
  id?: number | string
  /** 区域名 */
  name?: string
  /** 已开启，接口给的是字符串 */
  cur_chest?: number | string
  /** 总数，接口给的是字符串 */
  max_chest?: number | string
}

/** 接口给的一个星球 */
export interface SrChestWorldRaw {
  /** 星球 id */
  world_id?: number | string
  /** 星球名 */
  name?: string
  /** 小图标，米游社的绝对地址 */
  icon?: string
  /** 页签底图，米游社的绝对地址 */
  bg_icon?: string
  /** 该星球已开启，接口给的是字符串 */
  world_cur?: number | string
  /** 该星球总数，接口给的是字符串 */
  world_max?: number | string
  /** 逐个区域 */
  map_entrances?: SrChestAreaRaw[]
}

/** `chest_info` 接口的返回 */
export interface SrChestRaw {
  /** 逐个星球 */
  world_list?: SrChestWorldRaw[]
}

/** 出图与出文字共用的上下文 */
export interface SrCollectContext {
  /** uid */
  uid: string
  /** 玩家昵称 */
  nickname?: string
}

/**
 * 取数字，接口给的是字符串
 * @param value 原始值
 * @returns 数字；脏值一律 0
 */
function num(value: unknown): number {
  const out = Number(value)
  return Number.isFinite(out) ? out : 0
}

/**
 * 百分比，分母为 0 时算 0
 * @param cur 已得
 * @param max 总数
 * @returns 0~100 的整数
 */
function pct(cur: number, max: number): number {
  return max > 0 ? Math.min(100, Math.round((cur / max) * 100)) : 0
}

/** 判定结果：`noData` 是接口没给列表 */
export type SrCollectState = "ok" | "noData"

/**
 * 判这份成就返回能不能出图
 * @param raw 接口返回
 * @returns 判定结果
 */
export function srAchieveState(raw: SrAchieveRaw | undefined): SrCollectState {
  return (raw?.list ?? []).length > 0 ? "ok" : "noData"
}

/**
 * 判这份战利品返回能不能出图
 * @param raw 接口返回
 * @returns 判定结果
 */
export function srChestState(raw: SrChestRaw | undefined): SrCollectState {
  return (raw?.world_list ?? []).length > 0 ? "ok" : "noData"
}

/**
 * 把成就返回转成 `sr/achieve` 要的形态
 *
 * 总数由金银铜三档相加，与官方页头那个大数字一致 —— 接口没有"总数"这个字段。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function srAchieveData(raw: SrAchieveRaw | undefined, ctx: SrCollectContext): Record<string, unknown> {
  const gold = num(raw?.gold_num)
  const silver = num(raw?.silver_num)
  const copper = num(raw?.copper_num)
  const list = (raw?.list ?? []).map(one => {
    const cur = num(one.cur)
    const max = num(one.max)
    return {
      id: String(one.series_id ?? ""),
      name: one.name ?? "",
      // 米游社的绝对地址，模板不可加资源根
      icon: one.icon ?? "",
      cur,
      max,
      pct: pct(cur, max),
      // 未满的那一格官方标成高亮色，故这一项由本层判好；字符串直接比大小会判错
      full: max > 0 && cur >= max
    }
  })

  return {
    uid: ctx.uid,
    save_id: ctx.uid,
    nickname: ctx.nickname ?? "",
    title: "达成成就数",
    gold,
    silver,
    copper,
    total: gold + silver + copper,
    cur: list.reduce((sum, one) => sum + one.cur, 0),
    max: list.reduce((sum, one) => sum + one.max, 0),
    list
  }
}

/**
 * 把战利品返回转成 `sr/chest` 要的形态
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function srChestData(raw: SrChestRaw | undefined, ctx: SrCollectContext): Record<string, unknown> {
  const worlds = (raw?.world_list ?? []).map(one => {
    const cur = num(one.world_cur)
    const max = num(one.world_max)
    return {
      id: String(one.world_id ?? ""),
      // 接口连名字都不给时才退回「其他」，理由见文件头
      name: one.name ?? "其他",
      icon: one.icon ?? "",
      bg: one.bg_icon ?? "",
      cur,
      max,
      pct: pct(cur, max),
      areas: (one.map_entrances ?? []).map(area => {
        const got = num(area.cur_chest)
        const all = num(area.max_chest)
        return {
          id: String(area.id ?? ""),
          name: area.name ?? "",
          cur: got,
          max: all,
          pct: pct(got, all),
          full: all > 0 && got >= all
        }
      })
    }
  })

  const cur = worlds.reduce((sum, one) => sum + one.cur, 0)
  const max = worlds.reduce((sum, one) => sum + one.max, 0)
  return {
    uid: ctx.uid,
    save_id: ctx.uid,
    nickname: ctx.nickname ?? "",
    title: "战利品开启",
    cur,
    max,
    pct: pct(cur, max),
    worlds
  }
}

/**
 * 成就 → 纯文字
 *
 * 无渲染器时用，**就着模板数据来**，两种形态才不会在"总数怎么算"上各走一路。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function srAchieveText(raw: SrAchieveRaw | undefined, ctx: SrCollectContext): string {
  const view = srAchieveData(raw, ctx)
  const list = view["list"] as { name: string; cur: number; max: number }[]
  const lines = [
    `UID${ctx.uid} 达成成就 ${String(view["total"])} 个` +
      `（金 ${String(view["gold"])} 银 ${String(view["silver"])} 铜 ${String(view["copper"])}）`
  ]
  if (list.length === 0) return `${lines[0]}\n${INDENT}米游社没有返回成就系列，请确认已在 App 里开启战绩展示`
  for (const one of list) lines.push(`${INDENT}${one.name} ${one.cur}/${one.max}`)
  return lines.join("\n")
}

/**
 * 战利品 → 纯文字
 *
 * 只列到星球一层：逐区域几十行，在聊天里读不动。
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function srChestText(raw: SrChestRaw | undefined, ctx: SrCollectContext): string {
  const view = srChestData(raw, ctx)
  const worlds = view["worlds"] as { name: string; cur: number; max: number; areas: unknown[] }[]
  const lines = [`UID${ctx.uid} 战利品开启 ${String(view["cur"])}/${String(view["max"])}（${String(view["pct"])}%）`]
  if (worlds.length === 0) {
    return `${lines[0]}\n${INDENT}米游社没有返回星球列表，请确认已在 App 里开启战绩展示`
  }
  for (const one of worlds) lines.push(`${INDENT}${one.name} ${one.cur}/${one.max}（${one.areas.length} 个区域）`)
  return lines.join("\n")
}
