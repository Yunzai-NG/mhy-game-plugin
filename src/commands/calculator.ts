/**
 * 模块职责：`#刻晴养成81 90 9 9 9`、`#角色养成`（帮助）与 `#尘歌壶模数<分享码>`
 * 依赖方向：依赖 views/calculator 与命令层依赖包；四个接口都走米游社已鉴权的计算器活动
 * 生命周期：无状态函数
 * 注意事项：认不出名字时静默退出，与图鉴、攻略同族。
 *
 *          未拥有的角色也能算：原神走 `avatarSkill`、星铁走 `detail` 的 `TabAll`。
 *
 *          参数先解析、再发请求。
 *
 *          **星铁已拥有的角色不算忆灵行迹**：`skills_servant` 只在未拥有那一支合并，
 *          已拥有时取 `skill_list || skills`。这是既有口径，改了会让同一个角色的材料清单
 *          前后两版对不上。
 */
import { getServer } from "../core/region.js"
import type { Session } from "../core/session.js"
import { failText } from "../core/text.js"
import type { MetaItem, MetaLoader } from "../meta/loader.js"
import type {
  CalcEquip,
  CalcEquipView,
  MysCalcGame,
  CalculatorView,
  GsSkillRaw,
  SrSkillRaw,
  ZzzCultivateAvatar
} from "../views/calculator.js"
import {
  blueprintBody,
  blueprintText,
  buildBlueprint,
  buildCalculator,
  calcLevels,
  calcNameOf,
  calculatorText,
  flattenGsConsume,
  flattenSrConsume,
  flattenZzzConsume,
  gsCalcBody,
  gsSkillViews,
  srCalcBody,
  isMysCalcGame,
  srSkillViews,
  weaponTargetOf,
  zzzCalcBody,
  zzzSkillViews
} from "../views/calculator.js"
import { charImgs, ZZZ_SKILL_NAMES } from "../views/panel.js"
import type { QueryFail } from "../service/mys.js"
import { charMaterial } from "./wiki.js"
import type { MhyDeps } from "./deps.js"
import { isMainChar } from "./wiki.js"

/**
 * 求帮助的那个名字
 *
 * `#角色养成` 与 `#养成计算` 都落到同一条命令，剥掉触发词后剩下的正是「角色」二字或空串。
 * 故不另立 `^#*(星铁)?角色(养成|计算|养成计算)$` 那样一条规则，改以判名字代之。
 */
const HELP_NAME = "角色"

/** 分享码的形态，固定为 10 到 15 位数字 */
const CODE = /^\d{10,15}$/

/**
 * 尘歌壶接口的 Referer
 *
 * 那个接口只认从计算器活动页发来的请求。本插件的客户端缺省只发 `webstatic.mihoyo.com/`，
 * 故此处单独指定 —— 缺了它接口回的是一句与分享码无关的错误。
 */
const BLUEPRINT_REFERER =
  "https://webstatic.mihoyo.com/ys/event/e20200923adopt_calculator/index.html" +
  "?bbs_presentation_style=fullscreen&bbs_auth_required=true&mys_source=GameRecord"

/** 尘歌壶模数的帮助与参数有误两句 */
const BLUEPRINT_HELP = "#尘歌壶模数\n指令：#尘歌壶模数\n示例：#尘歌壶模数123456\n参数为模数id(10-15位数字)"

/** 参数有误时的那句 */
const BLUEPRINT_CHECK = `设置尘歌壶模数有误\n${BLUEPRINT_HELP.split("\n").slice(1).join("\n")}`

/**
 * 取参数说明，两个游戏各一份
 * @param game 游戏
 * @returns 说明文案
 */
function usage(game: MysCalcGame): string {
  if (game === "zzz") return "指令：%艾莲养成\n示例：%艾莲养成60 60 12 12 12 12 7 12\n参数为代理人、音擎、普攻、特殊技、闪避、连携技、核心技、支援技；不带参数按满级算"
  return game === "sr"
    ? "指令：*克拉拉养成\n示例：*克拉拉养成75 80 6 9 9 9\n参数为角色、武器、普攻、战技、终结技、天赋；不带参数按满级算"
    : "指令：#刻晴养成\n示例：#刻晴养成81 90 9 9 9\n参数为角色、武器、技能等级；不带参数按满级算"
}

/**
 * 第一条接口就失败、且失败成因是「没有本人的 CK」时，退回图鉴的材料页
 *
 * 养成计算只认发起者本人绑定且覆盖该 uid 的 CK；没有时说一句「绑 CK」不如给一张不要 CK 的材料图。
 * @param s 会话
 * @param deps 依赖
 * @param fail 失败结果
 * @returns 已退回材料页时为真
 */
async function fallbackToWiki(s: Session, deps: MhyDeps, fail: QueryFail): Promise<boolean> {
  if (fail.kind !== "nock" && fail.kind !== "nouid") return false
  // 绝区零没有图鉴材料页可退，退过去就是一个字都不回；照实说要绑什么
  if (s.game === "zzz") {
    await s.text(failText(fail))
    return true
  }
  await charMaterial(s, deps)
  return true
}

/** 米游社角色列表里一条已装备武器 / 光锥，两个游戏的字段名一致 */
interface EquipRaw {
  /** 武器 id */
  id?: number | string
  /** 武器名 */
  name?: string
  /** 等级 */
  level?: number
  /** 星级 */
  rarity?: number
  /** 图标绝对地址 */
  icon?: string
}

/** 原神角色列表里一条，只列出计算器要用的字段 */
interface GsAvatarRaw {
  /** 角色 id */
  id?: number | string
  /** 等级 */
  level?: number
  /** 已激活命座数 */
  actived_constellation_num?: number
  /** 已装备武器 */
  weapon?: EquipRaw
}

/** 星铁 `avatarInfo` 里一条 */
interface SrAvatarRaw {
  /** 角色 id */
  id?: number | string
  /** 等级 */
  level?: number
  /** 星魂数 */
  rank?: number
  /** 已装备光锥 */
  equip?: EquipRaw | null
}

/**
 * 归一一件已装备的武器 / 光锥
 * @param raw 接口给的那一节
 * @returns 归一后的武器；没有已装备武器时 undefined
 */
function equipOf(raw: EquipRaw | null | undefined): CalcEquip | undefined {
  if (!raw?.id) return undefined
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    star: Number(raw.rarity) || 0,
    level: Number(raw.level) || 1,
    icon: String(raw.icon ?? "")
  }
}

/**
 * 把归一后的武器折成图上那一栏
 * @param equip 归一后的武器
 * @param target 目标等级
 * @returns 图上那一栏
 */
function equipViewOf(equip: CalcEquip, target: number): CalcEquipView {
  return { name: equip.name, icon: equip.icon, star: equip.star, level: equip.level, target }
}

/**
 * 取角色头像
 *
 * 走 `charImgs` 而不在此处拼路径：那一套回落规则（时装、小头像）只该有一处。
 * @param game 游戏
 * @param name 角色名
 * @param loader 元数据装载器
 * @returns 相对元数据根目录的路径
 */
function faceOf(game: MysCalcGame, name: string, loader: MetaLoader): string {
  return charImgs({ game, name, exists: (rel: string): boolean => loader.exists(rel) })["face"] ?? ""
}

/**
 * 出图，出不了就发文字
 * @param s 会话
 * @param view 视图
 */
async function show(s: Session, view: CalculatorView): Promise<void> {
  if (await s.image(`${view.game}/calculator`, view)) return
  await s.text(calculatorText(view))
}

/**
 * `#角色养成` —— 参数怎么写
 * @param s 会话
 */
export async function calculatorHelp(s: Session): Promise<void> {
  await s.text(`角色养成计算\n${usage(isMysCalcGame(s.game) ? s.game : "gs")}`)
}

/**
 * 原神那一支
 * @param s 会话
 * @param deps 依赖
 * @param item 角色的元数据条目
 * @param levels 目标等级
 * @param loader 元数据装载器
 */
async function runGs(
  s: Session,
  deps: MhyDeps,
  item: MetaItem,
  levels: readonly number[],
  loader: MetaLoader
): Promise<void> {
  const id = String(item.id)
  const owned = await deps.mys.query<{ avatars?: GsAvatarRaw[]; list?: GsAvatarRaw[] } | null>("character", {
    user: s.user,
    game: "gs"
  })
  if (!owned.ok) {
    if (await fallbackToWiki(s, deps, owned)) return
    await s.text(failText(owned))
    return
  }
  // `character/list` 把列表放在 `list` 下，只认 `avatars` 时名下角色一律当未拥有
  const mine = (owned.data?.avatars ?? owned.data?.list ?? []).find(one => String(one.id ?? "") === id)

  // 未拥有的角色走 avatarSkill：它只给技能表，等级一律按 1 起算
  const detail = mine
    ? await deps.mys.query<{ skill_list?: GsSkillRaw[] }>("detail", {
        user: s.user,
        game: "gs",
        data: { avatar_id: id }
      })
    : await deps.mys.query<{ list?: GsSkillRaw[] }>("avatarSkill", {
        user: s.user,
        game: "gs",
        data: { avatar_id: id }
      })
  if (!detail.ok) {
    await s.text(failText(detail))
    return
  }
  const raw = mine
    ? ((detail.data as { skill_list?: GsSkillRaw[] }).skill_list ?? [])
    : ((detail.data as { list?: GsSkillRaw[] }).list ?? []).map(one => ({ ...one, level_current: 1 }))

  // 满级为 1 的是被动天赋，不参与计算；滤剩不足三个说明这个角色的数据还没上线
  const skills = raw.filter(one => Number(one.max_level) !== 1)
  if (skills.length < 3) {
    await s.text("暂无角色数据，米游社的计算器还没上这位角色，请稍后再试")
    return
  }

  const equip = equipOf(mine?.weapon)
  // 一二星武器的上限是 70，这一步同时决定请求体与图上那个"→ Lv.70"
  const targets = weaponTargetOf(levels, equip?.star)
  const level = Number(mine?.level) || 1
  const body = gsCalcBody({
    id,
    level,
    levels: targets,
    skills,
    ...(equip ? { equip } : {}),
    uid: owned.uid,
    server: getServer(owned.uid, "gs")
  })
  const res = await deps.mys.query<{ overall_material_consume?: unknown }>("compute", {
    user: s.user,
    game: "gs",
    data: { body }
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  await show(
    s,
    buildCalculator({
      game: "gs",
      uid: owned.uid,
      char: {
        name: item.name,
        face: faceOf("gs", item.name, loader),
        level,
        target: Number(targets[0]) || level,
        star: item.star,
        cons: Number(mine?.actived_constellation_num) || 0
      },
      ...(equip ? { equip: equipViewOf(equip, Number(targets[1]) || equip.level) } : {}),
      skills: gsSkillViews(skills, targets),
      consume: flattenGsConsume(res.data?.overall_material_consume)
    })
  )
}

/**
 * 星铁那一支
 *
 * 与原神的差别在于未拥有的角色也走 `detail`，只是 `tab_from` 换成 `TabAll`；忆灵那一组
 * 行迹只在未拥有时合并进来，理由见文件头。
 * @param s 会话
 * @param deps 依赖
 * @param item 角色的元数据条目
 * @param levels 目标等级
 * @param loader 元数据装载器
 */
async function runSr(
  s: Session,
  deps: MhyDeps,
  item: MetaItem,
  levels: readonly number[],
  loader: MetaLoader
): Promise<void> {
  const id = String(item.id)
  const owned = await deps.mys.query<{ avatar_list?: SrAvatarRaw[] } | null>("avatarInfo", {
    user: s.user,
    game: "sr"
  })
  if (!owned.ok) {
    if (await fallbackToWiki(s, deps, owned)) return
    await s.text(failText(owned))
    return
  }
  const mine = (owned.data?.avatar_list ?? []).find(one => String(one.id ?? "") === id)

  const detail = await deps.mys.query<{
    skill_list?: SrSkillRaw[]
    skills?: SrSkillRaw[]
    skills_servant?: SrSkillRaw[]
  }>("detail", { user: s.user, game: "sr", data: { avatar_id: id, tab_from: mine ? "TabOwned" : "TabAll" } })
  if (!detail.ok) {
    await s.text(failText(detail))
    return
  }
  const skills = mine
    ? (detail.data.skill_list ?? detail.data.skills ?? [])
    : [...(detail.data.skills ?? []), ...(detail.data.skills_servant ?? [])]
  if (skills.length === 0) {
    await s.text("暂无角色数据,请稍后再试")
    return
  }

  const equip = equipOf(mine?.equip)
  const level = Number(mine?.level) || 1
  const body = srCalcBody({
    id,
    level,
    levels,
    skills,
    ...(equip ? { equip } : {}),
    server: getServer(owned.uid, "sr")
  })
  const res = await deps.mys.query<unknown>("compute", { user: s.user, game: "sr", data: { body } })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  await show(
    s,
    buildCalculator({
      game: "sr",
      uid: owned.uid,
      char: {
        name: item.name,
        face: faceOf("sr", item.name, loader),
        level,
        target: Number(levels[0]) || level,
        star: item.star,
        cons: Number(mine?.rank) || 0
      },
      ...(equip ? { equip: equipViewOf(equip, Number(levels[1]) || equip.level) } : {}),
      skills: srSkillViews(skills, levels),
      consume: flattenSrConsume(res.data)
    })
  )
}

/**
 * `#<角色>养成<等级...>` / `#<角色>计算` —— 角色养成材料计算
 *
 * 认不出名字时静默退出，理由见文件头。
 * @param s 会话
 * @param deps 依赖
 */
export async function charCalculator(s: Session, deps: MhyDeps): Promise<void> {
  const name = calcNameOf(s.rest)
  // `#角色养成` 与裸的 `#养成计算` 都落到这里，那是求帮助而不是查一个叫「角色」的角色
  if (!name || name === HELP_NAME) {
    await calculatorHelp(s)
    return
  }
  // 用类型守卫而非字面量清单：清单判不收窄，后面还得补一次 as
  if (!isMysCalcGame(s.game)) return

  const loader = deps.meta?.loader
  if (!loader) return
  const game = s.game
  const item = loader.byName(game, name)
  // 武器也在同一张 byName 索引里，`type` 是武器才有的那一栏
  if (!item || item.type) return

  // 旅行者 / 开拓者的 id 随元素与命途而变，米游社的计算器认不出他们，故一并排掉
  if (isMainChar(game, item.id) || String(item.id) === "20000000") {
    await s.text(`暂不支持${game === "sr" ? "开拓者" : "旅行者"}养成计算`)
    return
  }

  const levels = calcLevels(s.rest, game, name)
  if (!levels) {
    await s.text(`设置角色、武器、技能等级有误\n${usage(game).replace(/刻晴|克拉拉|艾莲/g, () => name)}`)
    return
  }

  if (game === "sr") {
    await runSr(s, deps, item, levels, loader)
    return
  }
  if (game === "zzz") {
    await runZzz(s, deps, item, levels, loader)
    return
  }
  await runGs(s, deps, item, levels, loader)
}

/** 绝区零养成计算器要带的来源头，官方页按入口分几种，米游社那一路是 `bbs` */
const ZZZ_CULTIVATE_HEADERS: Readonly<Record<string, string>> = { "x-rpc-cultivate_source": "bbs" }

/**
 * 绝区零那一支
 *
 * 先问当前练度（`cultivateDetail`），再按目标等级算消耗（`cultivateCalc`）；接口只给材料 id 与数量，名字与图标查元数据材料表。
 * 两条接口要先登活动页（见 core/api.ts 的 `etoken`），失败时如实转述接口那句话。
 * @param s 会话
 * @param deps 依赖
 * @param item 代理人的元数据条目
 * @param levels 目标等级
 * @param loader 元数据装载器
 */
async function runZzz(
  s: Session,
  deps: MhyDeps,
  item: MetaItem,
  levels: readonly number[],
  loader: MetaLoader
): Promise<void> {
  const id = String(item.id)
  const detail = await deps.mys.query<{ list?: ZzzCultivateAvatar[] } | null>("cultivateDetail", {
    user: s.user,
    game: "zzz",
    data: { avatar_id: id },
    headers: { ...ZZZ_CULTIVATE_HEADERS }
  })
  if (!detail.ok) {
    if (await fallbackToWiki(s, deps, detail)) return
    await s.text(failText(detail))
    return
  }
  const cur = detail.data?.list?.[0]
  const body = zzzCalcBody(cur, id, levels)
  const res = await deps.mys.query<unknown>("cultivateCalc", {
    user: s.user,
    game: "zzz",
    data: { body },
    headers: { ...ZZZ_CULTIVATE_HEADERS }
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const mats = deps.materials
  const imgs = charImgs({ game: "zzz", name: item.name, exists: (rel: string): boolean => loader.exists(rel) })
  const icons: Record<string, string> = {}
  for (const one of ZZZ_SKILL_NAMES) icons[one.name] = imgs[one.icon] ?? ""
  const a = cur?.avatar
  const w = cur?.weapon
  const weaponItem = w?.id ? loader.byId("zzz", String(w.id)) : undefined
  await show(
    s,
    buildCalculator({
      game: "zzz",
      uid: detail.uid,
      char: {
        name: item.name,
        face: imgs["face"] ?? "",
        level: Number(body["avatar_current_level"]) || 1,
        target: Number(body["avatar_level"]) || 60,
        star: item.star >= 4 ? 5 : 4,
        cons: a?.unlock ? Number(a.rank) || 0 : 0
      },
      ...(w?.id
        ? {
            equip: {
              name: weaponItem?.name ?? w.name ?? "",
              icon: weaponItem?.icon ?? "",
              star: (weaponItem?.star ?? 3) >= 4 ? 5 : 4,
              level: Number(w.level) || 1,
              target: Number(levels[1]) || 60
            }
          }
        : {}),
      skills: zzzSkillViews(body, icons),
      consume: flattenZzzConsume(res.data, mid => {
        const got = mats?.byId(mid, "zzz")
        return got ? { name: got.label || got.name, icon: got.icon } : undefined
      })
    })
  )
}

/**
 * `#尘歌壶模数<分享码>` —— 一套图纸要多少材料
 *
 * 不带分享码时给帮助，带了但形态不对时给"参数有误"。
 * @param s 会话
 * @param deps 依赖
 */
export async function blueprint(s: Session, deps: MhyDeps): Promise<void> {
  const code = s.rest.replace(/\D/g, "")
  if (!code) {
    await s.text(BLUEPRINT_HELP)
    return
  }
  if (!CODE.test(code)) {
    await s.text(BLUEPRINT_CHECK)
    return
  }
  if (s.game !== "gs") {
    await s.text("尘歌壶模数只有原神有")
    return
  }

  const res = await deps.mys.query<{ list?: unknown } | null>("blueprint", {
    user: s.user,
    game: "gs",
    data: { share_code: code },
    headers: { Referer: BLUEPRINT_REFERER }
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const body = blueprintBody(res.data)
  if (!body) {
    await s.text(`没有查到模数 ${code}，请确认分享码是否正确`)
    return
  }
  const computed = await deps.mys.query<{ list?: unknown } | null>("blueprintCompute", {
    user: s.user,
    game: "gs",
    data: { body }
  })
  if (!computed.ok) {
    await s.text(failText(computed))
    return
  }

  const view = buildBlueprint({ uid: res.uid, code, blueprint: res.data, computes: computed.data?.list })
  if (await s.image("gs/blueprint", view)) return
  await s.text(blueprintText(view))
}
