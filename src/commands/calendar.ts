/**
 * 模块职责：`#日历` / `#活动` —— 十三天的活动时间轴、深渊轮换，以及原神的生日与今日天赋书
 * 依赖方向：依赖 service/calendar 取数、views/calendar 造视图；元数据只读不写
 * 生命周期：无状态函数
 * 注意事项：三个游戏都受理；绝区零的公告抠不出时段，只按公告图列出、不画时间轴。
 *
 *          **`#日历` 与 `#日历列表` 只能是同一条命令**：前者是后者的前缀，前缀路由下注册两条
 *          必定互相遮挡。故触发词只有 `日历` 与 `活动`，形态由命令表的 `rest` 改写函数判定。
 *
 *          公告取不到时不出图；缺元数据仍出图，只少原神那两块（生日、今日天赋书）。
 */
import type { Session } from "../core/session.js"
import type { CalendarGame } from "../service/calendar.js"
import type { MaterialTable } from "../meta/material.js"
import type { MetaLoader } from "../meta/loader.js"
import { isReleased } from "../meta/loader.js"
import type { PoolTable } from "../meta/pool.js"
import type { AnnItem } from "../service/calendar.js"
import type { CalChar, CalCharInput, CalTalentInput, CalendarInput } from "../views/calendar.js"
import { buildCalendar, calendarText } from "../views/calendar.js"
import { charImgs } from "../views/panel.js"
import { materialWeek } from "../views/gs/index.js"
import type { MaterialDay } from "../views/gs/index.js"
import type { MhyDeps } from "./deps.js"
import { isMainChar } from "./wiki.js"


/*
 * 出图倍率不在此处给：基准写在 calendar.css 里（`body{transform:scale(1.4)}`），
 * 从命令层再传一份会以行内样式把那一处压掉，成了两处口径。
 */

/** 星铁伪造跃迁条目时取最近几个版本 */
const SR_FAKE_VERSIONS = 3

/** 元数据 `data.json` 里的材料一栏 */
interface WithMaterials {
  /** 类别 → 材料全名 */
  materials?: Record<string, string>
}

/**
 * 取一个角色的某类材料全名
 * @param loader 装载器
 * @param id 角色 id
 * @param key 材料类别，`talent` 或 `weekly`
 * @returns 材料全名；没有时 undefined
 */
function materialOf(loader: MetaLoader, id: string, key: string): string | undefined {
  const detail = loader.detail("gs", id) as WithMaterials | undefined
  return detail?.materials?.[key]
}

/**
 * 收齐原神的全部角色，供生日与今日天赋书两块用
 *
 * **走 `each` 而不是 `byId`**：旅行者按元素分了七个目录却共用一个 id，只走 id 索引会只剩
 * 最后一个 —— 而生日那一块要的正是"每个角色一格"。
 * @param loader 元数据装载器
 * @param mats 材料表，周本材料的图标要它
 * @param unreleased 是否收未实装角色，缺省收
 * @returns 逐角色的输入
 */
export function calendarChars(loader: MetaLoader, mats?: MaterialTable, unreleased = true): CalCharInput[] {
  const out: CalCharInput[] = []
  for (const item of loader.each("gs", "character")) {
    // 未实装的角色要从生日与今日天赋书两块里排掉：那两块说的是"今天"，
    // 而一个还没上线的角色出现在"今天谁过生日"里只会让人以为版本已经更新了
    if (!unreleased && !isReleased(item)) continue
    const one: CalCharInput = {
      id: item.id,
      // 取简称而非全名 —— 格子只有 65px 宽，全名排不开
      name: item.abbr,
      star: item.star,
      face: item.face ?? ""
    }
    if (item.birth) one.birth = item.birth
    if (isMainChar("gs", item.id)) one.isMain = true

    const talent = item.id ? materialOf(loader, item.id, "talent") : undefined
    if (talent) one.talent = talent
    const weekly = item.id ? materialOf(loader, item.id, "weekly") : undefined
    const icon = weekly ? mats?.get(weekly)?.icon : undefined
    if (icon) one.weekly = icon
    out.push(one)
  }
  return out
}

/**
 * 挑出今天能刷的四星天赋书
 *
 * 判据两条：**只要四星那一阶**（低阶的教导 / 指引在轮换表里没有条目，故也没有 `week`），
 * 且**周日全放行** —— 那天三个副本全开。
 * @param mats 材料表
 * @param day 今天是哪一档
 * @returns 天赋书，未排序（排序在 views/calendar 里按国家序号做）
 */
export function calendarTalents(mats: MaterialTable, day: MaterialDay): CalTalentInput[] {
  const out: CalTalentInput[] = []
  for (const one of mats.each("talent", "gs")) {
    if (one.star !== 4) continue
    if (!day.sunday && one.week !== day.week) continue
    const got: CalTalentInput = {
      name: one.name,
      abbr: one.abbr,
      city: one.city ?? "",
      icon: one.icon
    }
    if (one.week !== undefined) got.week = one.week
    if (one.cid !== undefined) got.cid = one.cid
    out.push(got)
  }
  return out
}

/**
 * 伪造星铁的跃迁条目
 *
 * 版本刚开或跃迁公告延后时，公告里根本
 * 没有跃迁条目，此时拿卡池表里最近三个版本顶上。**光锥那一条的标题按 `char5` 的个数选**
 * （不是按 `weapon5`）：光锥池与角色池同期开，标题里的期数取前者才对得上。
 * @param pool 卡池版本表
 * @param loader 元数据装载器，头像与光锥图要它
 * @returns 伪造的公告条目，每个版本两条（角色池与光锥池）
 */
export function srFakeGacha(pool: PoolTable, loader: MetaLoader): AnnItem[] {
  const out: AnnItem[] = []
  for (const version of pool.versions("sr").slice(-SR_FAKE_VERSIONS)) {
    const char5 = version.char5 ?? []
    const weapon5 = version.weapon5 ?? []

    const banner2: string[] = []
    let charTitle = "角色活动跃迁："
    for (const name of char5) {
      const got = loader.byName("sr", name)
      if (got?.face) banner2.push(got.face)
      charTitle += `「${pool.poolName("sr", name) ?? ""}」`
    }

    const banner3: string[] = []
    for (const name of weapon5) {
      const got = loader.byName("sr", name)
      if (got?.icon) banner3.push(got.icon)
    }
    const weaponTitle =
      char5.length === 1
        ? "光锥活动跃迁：「流光定影」"
        : char5.length === 2
          ? "光锥活动跃迁：「流光定影」「溯回忆象」"
          : "光锥活动跃迁：「流光定影」「真意之汇」"

    out.push(
      { ann_id: 0, title: charTitle, start_time: version.from, end_time: version.to, banner: "", banner2, tag_icon: "" },
      { ann_id: 0, title: weaponTitle, start_time: version.from, end_time: version.to, banner: "", banner3, tag_icon: "" }
    )
  }
  return out
}

/**
 * `#日历` / `#日历列表` / `#活动`
 *
 * 三个游戏共用一张模板，差别全在取数与分类。
 * @param s 会话
 * @param deps 依赖
 */
export async function calendar(s: Session, deps: MhyDeps): Promise<void> {
  const game: CalendarGame = s.game
  const serv = deps.calendar
  if (!serv) {
    await s.text("日历暂不可用，请稍后重试")
    return
  }

  const raw = await serv.fetch(game)
  if (!raw) {
    await s.text("取不到米游社的活动公告，请稍后重试")
    return
  }

  const loader = deps.meta?.loader
  const mats = deps.materials
  const input: CalendarInput = {
    game,
    acts: raw.acts,
    normal: raw.normal,
    timeMap: raw.timeMap,
    gachaImgs: raw.gachaImgs,
    versionStart: raw.versionStart,
    mode: /列表/.test(s.rest) ? "list" : "calendar"
  }

  if (game === "gs" && loader) {
    // 认不出角色时 gsClassify 会回落到"只有标题的角色池"，故此处不必兜底
    const charOf = (name: string): CalChar | undefined => {
      const item = loader.byName("gs", name)
      if (!item) return undefined
      const imgs = charImgs({ game: "gs", name: item.name, exists: rel => loader.exists(rel) })
      const got: CalChar = {}
      if (item.elem) got.elem = item.elem
      if (item.face) got.face = item.face
      const card = imgs["card"]
      if (card) got.card = card
      return got
    }
    input.char = charOf
    input.chars = calendarChars(loader, mats, deps.config().enableUnreleased)
    // 天赋书要材料表（轮换表在它里面），缺元数据时这一块整个不出，日历照常
    if (mats?.ready()) input.talents = calendarTalents(mats, materialWeek(""))
  }

  if (game === "sr" && loader && deps.pool?.ready("sr")) {
    input.fakeGacha = srFakeGacha(deps.pool, loader)
  }

  const view = buildCalendar(input)
  if (await s.image("wiki/calendar", view)) return
  await s.text(calendarText(view))
}
