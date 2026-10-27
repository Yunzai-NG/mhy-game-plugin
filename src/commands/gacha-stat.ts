/**
 * 模块职责：抽卡分析与统计命令 —— `#抽卡分析` / `#抽卡统计` / `#复刻统计`
 * 依赖方向：依赖 session / views/gacha-stat / views/banner 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：三条命令都只读本地库，**不发任何请求**。要更新记录用 `#抽卡记录`。
 *
 *          出图要元数据里的头像，故先查 {@link MetaLoader.ready}，未就绪即回文字。
 *
 *          卡池版本表三个游戏都随元数据走（`meta-<游戏>/info/pool.js`），装了才有。
 */
import type { GameKey } from "../core/region.js"
import type { Session } from "../core/session.js"
import type { MetaLoader } from "../meta/loader.js"
import type { PoolGame } from "../meta/pool.js"
import type { GachaRecord } from "../store/gacha.js"
import type { BannerKind } from "../views/banner.js"
import { bannerAllData, bannerSingleData, bannerSingleText, bannerText } from "../views/banner.js"
import type { GachaStatContext } from "../views/gacha-stat.js"
import { gachaDetailData, gachaDetailText, gachaStatData, gachaStatText, normalizeStar } from "../views/gacha-stat.js"
import { charImgs } from "../views/panel.js"
import type { MhyDeps } from "./deps.js"

/** 元数据未装好时的提示 */
const NEED_META = "该命令要用角色图标，请先让主人发送「#更新元数据」安装元数据（约 350MB，只含 JSON 与图片）"

/** 出图头部用的角色头像与横幅 */
interface GachaFace {
  /** 大横幅图，相对元数据根目录；缺角色时空串 */
  banner: string
  /** 方形头像 */
  face: string
  /** 展示名，取 uid */
  name: string
}

/**
 * 造出图头部的头像块
 *
 * 取本地记录里最近一个五星角色；取不到时留空串，模板对空串只是那一格不显图。
 * @param records 记录，新的在前
 * @param game 游戏
 * @param uid 展示用 uid
 * @param loader 元数据装载器，未装时回落成空图
 * @returns 头像块
 */
function gachaFace(records: readonly GachaRecord[], game: PoolGame, uid: string, loader?: MetaLoader): GachaFace {
  const empty: GachaFace = { banner: "", face: "", name: uid }
  if (!loader?.ready(game)) return empty

  // 星级要先过 `normalizeStar`：绝区零的 S 级记作 4 而非 5，按 `=== 5` 直接判会让它永远取不到头像
  for (const rec of records) {
    if (normalizeStar(rec.rank, game) !== 5 || /武器|光锥|音擎/.test(rec.itemType)) continue
    const item = loader.byName(game, rec.name)
    if (!item) continue
    const imgs = charImgs({ game, name: item.name, exists: (rel: string): boolean => loader.exists(rel) })
    return { banner: imgs["banner"] ?? imgs["gacha"] ?? "", face: imgs["face"] ?? "", name: uid }
  }
  return empty
}

/**
 * 认出要分析哪个卡池
 *
 * 不带参数即角色 / 代理人池；`集录` 与 `联动` 走另一张卡池表（`mix`）。
 * 绝区零另有一套频段编号（`2` 独家 / `3` 音擎 / `1` 常规 / `5` 邦布）。
 * @param rest 命令剩余文本
 * @param game 游戏
 * @returns 卡池键与是否走集录表
 */
export function pickPool(rest: string, game: PoolGame): { pool: string; mix: boolean } {
  if (game === "zzz") {
    if (/常驻|常规|群星/.test(rest)) return { pool: "1", mix: false }
    if (/邦布/.test(rest)) return { pool: "5", mix: false }
    // 重映两支要排在「音擎」前：否则「音擎回响」里的「音擎」先被下一行截走
    if (/音擎回响|回响/.test(rest)) return { pool: "13", mix: false }
    if (/独家重映|重映/.test(rest)) return { pool: "12", mix: false }
    if (/武器|音擎|光锥/.test(rest)) return { pool: "3", mix: false }
    return { pool: "2", mix: false }
  }
  const sr = game === "sr"
  if (/常驻|群星/.test(rest)) return { pool: sr ? "1" : "200", mix: false }
  if (/集录/.test(rest) && !sr) return { pool: "500", mix: true }
  if (/联动/.test(rest) && sr) return { pool: /武器|光锥/.test(rest) ? "22" : "21", mix: true }
  if (/武器|光锥/.test(rest)) return { pool: sr ? "12" : "302", mix: false }
  return { pool: sr ? "11" : "301", mix: false }
}

/**
 * 取一个 uid 与元数据都就绪的上下文
 * @param s 会话
 * @param deps 依赖
 * @returns 上下文与 uid；前置不满足时已回复过，返回 undefined
 */
async function ready(
  s: Session,
  deps: MhyDeps
): Promise<{ ctx: GachaStatContext; game: PoolGame } | undefined> {
  const game = s.game as PoolGame

  if (!deps.pool?.ready(game)) {
    await s.text("卡池版本表还没装好，无法判定 UP，请让主人发送「#更新元数据」")
    return undefined
  }

  // 记录按「用户 + uid」分键存，发起者只会读到自己名下这条 uid 的记录（见 store/gacha 文件头）；
  // uid 谁都能绑，但绑别人的 uid 只会落到一组空记录上，读不到他人的抽卡历史。
  // 只认当前 uid：收链接、导入时都已把 uid 绑上并设为当前，切换后看的就是切换后那个
  const uid = (await deps.users.uid(s.user, s.game)) ?? ""
  if (!uid) {
    await s.text("还没有抽卡记录，请先私聊发送「#抽卡链接」导入")
    return undefined
  }

  const ctx: GachaStatContext = { game, uid, pool: deps.pool }
  if (deps.meta?.loader) ctx.meta = deps.meta.loader
  return { ctx, game }
}

/**
 * `#抽卡分析`
 * @param s 会话
 * @param deps 依赖
 */
export async function gachaDetail(s: Session, deps: MhyDeps): Promise<void> {
  const got = await ready(s, deps)
  if (!got) return

  const { pool, mix } = pickPool(s.rest, got.game)
  const records = await deps.gacha.records(s.user, s.game, got.ctx.uid, pool)
  const data = gachaDetailData(records, got.ctx, mix)
  if (!data) {
    await s.text(`${got.ctx.uid} 在该卡池没有记录，请先发送「#抽卡记录」同步`)
    return
  }

  const full = {
    ...data,
    uid: got.ctx.uid,
    saveId: got.ctx.uid,
    game: got.game,
    face: gachaFace(records, got.game, got.ctx.uid, deps.meta?.loader),
    isChar: got.game === "zzz" ? pool === "2" : /301|11|21/.test(pool)
  }
  if (deps.meta?.loader.ready(got.game) && (await s.image("gacha/gacha-detail", full))) return
  if (!deps.meta?.loader.ready(got.game)) await s.text(NEED_META)
  await s.text(gachaDetailText(data))
}

/**
 * `#抽卡统计` —— 按版本切分
 *
 * `#全部统计` 把角色池、武器池与集录池合起来算；`#常驻统计` 不分版本（常驻池没有版本概念）。
 * @param s 会话
 * @param deps 依赖
 */
export async function gachaStat(s: Session, deps: MhyDeps): Promise<void> {
  const got = await ready(s, deps)
  if (!got) return
  const sr = got.game === "sr"
  const zzz = got.game === "zzz"

  /** 要合并统计哪几个卡池 */
  let pools: string[]
  let mix = false
  let hasVersion = true
  let title = ""
  if (/全部/.test(s.rest)) {
    pools = zzz ? ["2", "12", "3", "13", "1", "5"] : sr ? ["11", "12", "21", "22", "1"] : ["301", "302", "500", "200"]
    hasVersion = false
    title = "全部统计"
  } else if (/常驻|群星|常规/.test(s.rest)) {
    pools = [zzz ? "1" : sr ? "1" : "200"]
    hasVersion = false
    title = zzz ? "常规频段" : "常驻池"
  } else {
    const picked = pickPool(s.rest, got.game)
    pools = [picked.pool]
    mix = picked.mix
  }

  const records: GachaRecord[] = []
  for (const it of pools) records.push(...(await deps.gacha.records(s.user, s.game, got.ctx.uid, it)))

  const opts: { mix: boolean; hasVersion: boolean; title?: string } = { mix, hasVersion }
  if (title) opts.title = title
  const data = gachaStatData(records, got.ctx, opts)
  if (!data) {
    await s.text(`${got.ctx.uid} 没有相应记录，请先发送「#抽卡记录」同步`)
    return
  }

  const full = { ...data, uid: got.ctx.uid, saveId: got.ctx.uid, game: got.game, face: gachaFace(records, got.game, got.ctx.uid, deps.meta?.loader) }
  if (deps.meta?.loader.ready(got.game) && (await s.image("gacha/gacha-stat", full))) return
  if (!deps.meta?.loader.ready(got.game)) await s.text(NEED_META)
  await s.text(gachaStatText(data))
}

/**
 * `#复刻统计`
 *
 * 带名字时查单个角色 / 武器的历次 UP；不带名字时列出全部，按"距今多久没复刻"排序。
 * **不需要抽卡记录**：它统计的是卡池表本身。
 * @param s 会话
 * @param deps 依赖
 */
export async function bannerStat(s: Session, deps: MhyDeps): Promise<void> {
  const game = s.game as PoolGame
  if (!deps.pool?.ready(game)) {
    await s.text("卡池版本表还没装好，请让主人发送「#更新元数据」")
    return
  }

  const ctx = { game, pool: deps.pool, ...(deps.meta?.loader ? { meta: deps.meta.loader } : {}) }
  const rest = s.rest.replace(/复刻|统计|卡池|祈愿|池/g, "").trim()
  const kind: BannerKind = /武器|光锥|音擎/.test(s.rest) ? "weapon" : "char"

  const rawName = rest.replace(/四星|五星|[SsAa]级?|角色|代理人|武器|光锥|音擎|up|UP/g, "").trim()
  // 别名转正式名：卡池表里存的是全名（枫原万叶），命令常用简称（万叶），不转就匹配不到 UP 记录
  const name = deps.meta?.loader.byName(game, rawName)?.name ?? rawName
  if (name) {
    const data = bannerSingleData(name, kind, ctx)
    if (!data) {
      const other = bannerSingleData(name, kind === "char" ? "weapon" : "char", ctx)
      if (!other) {
        await s.text(`没查到「${name}」的 UP 记录，可能是名字写法不同，或它从未作为 UP 出现`)
        return
      }
      if (deps.meta?.loader.ready(game) && (await s.image("gacha/banner-single", other))) return
      await s.text(bannerSingleText(other))
      return
    }
    if (deps.meta?.loader.ready(game) && (await s.image("gacha/banner-single", data))) return
    await s.text(bannerSingleText(data))
    return
  }

  const star: 4 | 5 = /四星|[Aa]级/.test(s.rest) ? 4 : 5
  const data = bannerAllData(kind, star, ctx)
  if (deps.meta?.loader.ready(game) && (await s.image("gacha/banner-all", data))) return
  if (!deps.meta?.loader.ready(game)) await s.text(NEED_META)
  await s.text(bannerText(data))
}

/**
 * 三个游戏都能用的"本地记录概况"，供 `#抽卡记录` 在元数据缺失时回落
 * @param game 游戏
 * @returns 游戏名
 */
export function gameLabel(game: GameKey): string {
  return game === "sr" ? "星穹铁道" : game === "zzz" ? "绝区零" : "原神"
}
