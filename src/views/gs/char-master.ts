/**
 * 模块职责：绘想游迹 —— 把 `char_master` 的返回转成模板要的形态
 * 依赖方向：依赖 core/text；纯函数，不发请求
 * 生命周期：无状态
 * 注意事项：**这是与幻想真境剧诗分开的一条接口**（`/genshin/api/char_master`）。判据取自官方 H5：`is_unlock` 为假即没开、`list[].status` 三档（`1` 锁着、`3` 已完成、中间为「开了没做完」），页头印「已完成 <status 为 3 的个数> / <list 长度>」。
 *          官方还有一条 `char_master/red_dot/cancel`（消红点），**那是一次写入、本插件不碰**（查战绩不该改账号状态）。
 */
import { INDENT } from "../../core/text.js"

/** 一条角色专精记录 */
export interface CharMasterItemRaw {
  /** 角色 id */
  avatar_id?: number | string
  /** 专精名 */
  name?: string
  /** 图，米游社给的绝对地址 */
  icon?: string
  /** 状态：1 锁着、3 已完成 */
  status?: number
  /** 有没有未读红点 */
  has_red_dot?: boolean
}

/** `char_master` 的返回 */
export interface CharMasterRaw {
  /** 该账号是否已解锁 */
  is_unlock?: boolean
  /** 逐条记录 */
  list?: CharMasterItemRaw[]
}

/** 出图要的上下文 */
export interface CharMasterContext {
  /** uid */
  uid: string
  /** 玩家信息，取自 `index` 接口的 `role` */
  role?: { nickname?: string; level?: number; game_head_icon?: string }
}

/** 判定结果 */
export type CharMasterState = "ok" | "locked" | "noData"

/** 锁着的那一档 */
const STATUS_LOCKED = 1
/** 已完成的那一档 */
const STATUS_DONE = 3

/**
 * 判这份返回能不能出图
 * @param raw 接口返回
 * @returns 判定结果
 */
export function charMasterState(raw: CharMasterRaw | undefined): CharMasterState {
  if (raw?.is_unlock === false) return "locked"
  return (raw?.list ?? []).length > 0 ? "ok" : "noData"
}

/** 模板要的一条记录 */
export interface CharMasterItemView extends Record<string, unknown> {
  /** 角色 id */
  id: string
  /** 专精名 */
  name: string
  /** 图 */
  icon: string
  /** 锁着 */
  locked: boolean
  /** 已完成 */
  done: boolean
}

/**
 * 把 `char_master` 转成 `gs/char-master` 要的形态
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 模板数据
 */
export function charMasterTemplateData(
  raw: CharMasterRaw | undefined,
  ctx: CharMasterContext
): Record<string, unknown> {
  const list = raw?.list ?? []
  const items: CharMasterItemView[] = list.map(one => {
    const status = Number(one.status) || 0
    return {
      id: String(one.avatar_id ?? ""),
      name: one.name ?? "",
      icon: one.icon ?? "",
      locked: status === STATUS_LOCKED,
      done: status === STATUS_DONE
    }
  })

  return {
    uid: ctx.uid,
    saveId: ctx.uid,
    // 模板直接印这两项，而那一次 index 是允许失败的 —— 给空对象会印出字面的 undefined
    role: {
      nickname: ctx.role?.nickname ?? "",
      level: Number(ctx.role?.level) || 0,
      game_head_icon: ctx.role?.game_head_icon ?? ""
    },
    // 页头那一行按官方口径数出来，不取接口的某个计数
    done: items.filter(one => one.done).length,
    total: items.length,
    items
  }
}

/**
 * 绘想游迹的纯文字形态
 * @param raw 接口返回
 * @param ctx 上下文
 * @returns 多行文本
 */
export function charMasterText(raw: CharMasterRaw | undefined, ctx: CharMasterContext): string {
  const view = charMasterTemplateData(raw, ctx)
  const items = view["items"] as CharMasterItemView[]
  const lines = [`UID${ctx.uid} 绘想游迹`, `已完成 ${String(view["done"])}/${String(view["total"])}`]
  const done = items.filter(one => one.done)
  if (done.length > 0) lines.push(`${INDENT}${done.map(one => one.name).join("、")}`)
  const doing = items.filter(one => !one.done && !one.locked)
  if (doing.length > 0) lines.push(`进行中：${doing.map(one => one.name).join("、")}`)
  return lines.join("\n")
}
