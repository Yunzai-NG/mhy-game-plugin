/**
 * 模块职责：UIGF / SRGF 抽卡记录的导入与导出
 * 依赖方向：纯函数，依赖 store/gacha 的记录类型与 meta/loader（补 item_id）；不碰 IO
 * 生命周期：无状态
 * 注意事项：导入要容得下三种格式：UIGF v2.3（原神）、SRGF v1.0（星铁）、UIGF v4.0（两者合一）。
 *          外层结构不同（v2 是 `list`，v4 是 `hk4e[0].list`）而内层一条记录形态一致，
 *          故只在取列表这一步分流。
 *
 *          id 要先归一化：老记录 id 只有 13 位、新记录是 19 位雪花号，混在一起比较会把老记录
 *          全判成"更旧"。故 13 位的补六个零，缺 id 的按时间戳造一个；同一 id 重复出现时追加
 *          序号 —— 一次十连的十条时间戳完全相同，不加序号会被去重逻辑合并成一条。
 *
 *          `item_id` 用本地元数据（{@link MetaLoader}）查，不下 `api.uigf.org` 那份字典；
 *          元数据未安装时该字段留空，UIGF v2 并不要求它。
 */
import type { MetaLoader } from "../meta/loader.js"
import type { GachaRecord } from "./gacha.js"
import { GACHA_POOLS, compareGachaId, gachaRealType } from "./gacha.js"
import type { GameKey } from "../core/region.js"

/** 导出格式 */
export type UigfVersion = "v2" | "v4"

/** UIGF 里的一条记录 */
export interface UigfItem {
  /** 记录 id */
  id?: string
  /** 卡池 id */
  gacha_type?: string
  /** 归并后的卡池 id，原神 400 归并至 301 */
  uigf_gacha_type?: string
  /** 物品 id */
  item_id?: string
  /** 物品名 */
  name?: string
  /** 物品类型 */
  item_type?: string
  /** 星级 */
  rank_type?: string
  /** 抽取时间 */
  time?: string
  /** uid */
  uid?: string
  /** 语言 */
  lang?: string
  /** 卡池的第几次抽取，米游社给的字段，本实现不用但原样保留 */
  count?: string
}

/** UIGF / SRGF 文件的 info 段 */
export interface UigfInfo {
  /** uid */
  uid?: string
  /** 语言 */
  lang?: string
  /** 导出时间 */
  export_time?: string
  /** 导出时间戳 */
  export_timestamp?: string | number
  /** 导出程序 */
  export_app?: string
  /** 导出程序版本 */
  export_app_version?: string
  /** UIGF 版本，原神 v2 用 */
  uigf_version?: string
  /** SRGF 版本，星铁 v2 用 */
  srgf_version?: string
  /** 时区，星铁 v2 用 */
  region_time_zone?: number
  /** 版本，v4 用 */
  version?: string
}

/** v4 里一个 uid 的记录块 */
export interface UigfBlock {
  /** uid */
  uid?: string
  /** 语言 */
  lang?: string
  /** 时区 */
  timezone?: number
  /** 记录 */
  list?: UigfItem[]
}

/** 一份 UIGF / SRGF 文件 */
export interface UigfFile {
  /** 元信息 */
  info?: UigfInfo
  /** 记录，v2 用 */
  list?: UigfItem[]
  /** 原神记录，v4 用 */
  hk4e?: UigfBlock[]
  /** 星铁记录，v4 用 */
  hkrpg?: UigfBlock[]
  /** 绝区零记录，v4 用 */
  nap?: UigfBlock[]
}

/** v4 里各游戏对应的键名 */
const V4_KEYS: Readonly<Record<GameKey, "hk4e" | "hkrpg" | "nap">> = {
  gs: "hk4e",
  sr: "hkrpg",
  zzz: "nap"
}

/** 导入结果 */
export interface ImportResult {
  /** 成功 */
  ok: boolean
  /** 识别出的游戏 */
  game?: GameKey
  /** uid */
  uid?: string
  /** 逐卡池的记录条数 */
  pools?: { pool: string; name: string; count: number }[]
  /** 记录总条数 */
  total?: number
  /** 失败原因 */
  message?: string
}

/**
 * 补齐并归一化一条记录的 id
 *
 * 三种情形：19 位原样留用、13 位补六个零、没有则按时间造一个。
 * @param item 记录
 * @returns 归一化后的 id；连时间都没有时为空串
 */
function normalizeId(item: UigfItem): string {
  const id = String(item.id ?? "").trim()
  if (id.length === 13) return `${id}000000`
  if (id) return id
  const at = new Date(String(item.time ?? "").replace(/-/g, "/")).getTime()
  return Number.isFinite(at) && at > 0 ? `${at}000000` : ""
}

/**
 * 认出这份文件是哪个游戏的
 *
 * v4 看有哪个游戏的键，v2 看 `srgf_version`（星铁专用）；都认不出时按调用方给的游戏处理。
 * @param file 文件内容
 * @param fallback 认不出时采用的游戏
 * @returns 游戏
 */
export function detectUigfGame(file: UigfFile, fallback: GameKey): GameKey {
  if (file.hkrpg?.length) return "sr"
  if (file.hk4e?.length) return "gs"
  if (file.nap?.length) return "zzz"
  if (file.info?.srgf_version) return "sr"
  return fallback
}

/**
 * 从文件里取出记录列表
 * @param file 文件内容
 * @param game 游戏
 * @returns 记录列表与 uid
 */
function takeList(file: UigfFile, game: GameKey): { list: UigfItem[]; uid: string } {
  if (Array.isArray(file.list)) {
    return { list: file.list, uid: String(file.info?.uid ?? "") }
  }
  const block = file[V4_KEYS[game]]?.[0]
  return { list: block?.list ?? [], uid: String(block?.uid ?? file.info?.uid ?? "") }
}

/**
 * 把一条 UIGF 记录的卡池归并到本插件的卡池键
 *
 * 原神的 301 与 400 共用保底，故归并为 301 —— 与 {@link GACHA_POOLS} 的口径一致。
 * 绝区零的卡池键、展示分类（`12001`）与真实类型（`102`）三种写法都认。
 * @param item 记录
 * @param game 游戏
 * @returns 卡池键；不属于任何已知卡池时 undefined
 */
function poolOf(item: UigfItem, game: GameKey): string | undefined {
  const raw = String(item.uigf_gacha_type ?? item.gacha_type ?? "").trim()
  if (!raw) return undefined
  for (const spec of GACHA_POOLS[game]) {
    if (spec.key === raw || spec.types.includes(raw)) return spec.key
    if (spec.types.some(type => gachaRealType(game, type) === raw)) return spec.key
  }
  return undefined
}

/**
 * 解析一份 UIGF / SRGF 文件
 *
 * 校验分两套、满足其一即可：v2 要 `name` / `item_type` / `rank_type`，v4 允许只给 `item_id`
 * （物品名由元数据补）。都不满足时指出缺哪个字段 —— 只说"格式错误"使用者无从修正。
 * @param file 文件内容
 * @param fallback 认不出游戏时采用的游戏
 * @param meta 元数据装载器，用于按 item_id 补物品名
 * @returns 逐卡池的记录，可直接落库
 */
export function parseUigf(
  file: UigfFile,
  fallback: GameKey,
  meta?: MetaLoader
): { ok: boolean; game?: GameKey; uid?: string; records?: Map<string, GachaRecord[]>; message?: string } {
  if (!file || typeof file !== "object") return { ok: false, message: "文件内容不是有效的 JSON" }
  if (!file.list && !file.hk4e && !file.hkrpg && !file.nap) {
    return { ok: false, message: "这不是统一祈愿记录（UIGF / SRGF）格式的文件" }
  }

  const game = detectUigfGame(file, fallback)
  const { list, uid } = takeList(file, game)
  if (!list.length) return { ok: false, message: "文件里没有任何抽卡记录" }

  const first = list[0] ?? {}
  const lackV2 = ["gacha_type", "item_type", "name", "time"].filter(it => !first[it as keyof UigfItem])
  const lackV4 = ["gacha_type", "item_id", "time"].filter(it => !first[it as keyof UigfItem])
  if (lackV2.length && lackV4.length) {
    return { ok: false, message: `文件缺少必要字段：${lackV2.join("、")}（或 v4 的 ${lackV4.join("、")}）` }
  }
  if (!uid) return { ok: false, message: "文件里没有 uid" }

  // 同一 id 重复时追加序号 —— 一次十连的十条记录时间戳完全相同
  const seen = new Map<string, number>()
  const byPool = new Map<string, GachaRecord[]>()

  for (const item of list) {
    const pool = poolOf(item, game)
    if (!pool) continue

    let id = normalizeId(item)
    if (!id) continue
    const times = seen.get(id) ?? 0
    seen.set(id, times + 1)
    // 序号盖在末尾、位数随序号长，id 总长不变：长度一变 compareGachaId 先比长度，整组次序就乱了
    if (times > 0) id = `${id.slice(0, -String(times).length)}${times}`

    // v4 只给 item_id 时按元数据补名称与星级
    const found = meta && game !== "zzz" ? meta.find(game, item.item_id, item.name ?? "") : undefined
    const name = item.name || found?.name || "未知"
    const rank = Number(item.rank_type) || found?.star || 3

    const list2 = byPool.get(pool) ?? []
    list2.push({
      id,
      pool,
      name,
      itemType: item.item_type || (found?.weapon ? "武器" : found ? "角色" : ""),
      rank,
      time: String(item.time ?? "")
    })
    byPool.set(pool, list2)
  }

  if (!byPool.size) return { ok: false, message: "文件里没有可识别的卡池记录" }

  // 落库形态要求新的在前
  for (const [pool, items] of byPool) {
    byPool.set(pool, items.sort((a, b) => compareGachaId(b.id, a.id)))
  }
  return { ok: true, game, uid, records: byPool }
}

/** 导出时要写进文件的程序信息 */
export interface ExportApp {
  /** 程序名 */
  name: string
  /** 程序版本 */
  version: string
}

/**
 * 把本地记录导出成 UIGF / SRGF
 *
 * 按 id 升序（旧的在前）：各家导入工具普遍如此排列。
 * @param game 游戏
 * @param uid uid
 * @param pools 逐卡池的本地记录
 * @param version 导出格式
 * @param app 程序信息
 * @param meta 元数据装载器，用于补 item_id
 * @param now 当前时间，测试注入
 * @returns 可直接序列化的文件内容
 */
export function buildUigf(
  game: GameKey,
  uid: string,
  pools: readonly { spec: { key: string; types: readonly string[] }; records: readonly GachaRecord[] }[],
  version: UigfVersion,
  app: ExportApp,
  meta?: MetaLoader,
  now: number = Date.now()
): UigfFile {
  const items: UigfItem[] = []
  for (const { spec, records } of pools) {
    for (const it of records) {
      const found = meta && game !== "zzz" ? meta.find(game, undefined, it.name) : undefined
      const one: UigfItem = {
        id: it.id,
        uid,
        // 文件里写真实类型：绝区零卡池表存的是展示分类，原样写出会是别家不认的 `2001`
        gacha_type: gachaRealType(game, spec.types[0] ?? spec.key),
        name: it.name,
        item_type: it.itemType,
        rank_type: String(it.rank),
        time: it.time,
        lang: "zh-cn"
      }
      // 原神的 UIGF 要求这一项；星铁的 SRGF 没有它
      if (game === "gs") one.uigf_gacha_type = spec.key
      if (found?.id) one.item_id = found.id
      items.push(one)
    }
  }
  items.sort((a, b) => compareGachaId(String(a.id ?? ""), String(b.id ?? "")))

  const two = (n: number): string => String(n).padStart(2, "0")
  const d = new Date(now)
  const basic = {
    export_time: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`,
    export_timestamp: Math.floor(now / 1000),
    export_app: app.name,
    export_app_version: app.version
  }

  if (version === "v4") {
    return {
      info: { ...basic, version: "v4.0" },
      [V4_KEYS[game]]: [{ uid, lang: "zh-cn", timezone: -new Date(now).getTimezoneOffset() / 60, list: items }]
    }
  }

  const info: UigfInfo = { uid, lang: "zh-cn", ...basic }
  if (game === "sr") {
    info.srgf_version = "v1.0"
    info.region_time_zone = -new Date(now).getTimezoneOffset() / 60
  } else {
    info.uigf_version = "v2.3"
  }
  return { info, list: items }
}
