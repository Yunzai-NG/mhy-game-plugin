/**
 * 模块职责：绝区零面板替换 —— 解析 `%艾莲换雅音擎`、`%艾莲换100000001雅4号位+6号位` 一类要求，改造一份存档并本地重算属性
 * 依赖方向：依赖 meta/loader（认名字、取音擎档位）、panel/zzz/attr（重算属性）与 panel/serv/zzz（词条 → 加成）；不发请求、不落库
 * 生命周期：无状态纯函数
 * 注意事项：写法与原神星铁那一套同形（`换` 分段、每段可带 uid），见 panel/change.ts 的文件头；**认不出的段整体失败、不猜**。
 *          **属性一律按改造后的部件重算**（{@link computeZzzAttrs}），不沿用存档里的成品值：换了音擎或驱动盘而属性不变，图上就是一张假的「真面板」。
 *          驱动盘词条在两个源里都已是总值（见 panel/serv/zzz.ts 的 discAddsOf），故借来的盘直接折成加成、不再乘次数。
 */
import type { MetaLoader } from "../../meta/loader.js"
import type { StoredAvatar } from "../../store/panel.js"
import type { ZzzDisc, ZzzWeapon } from "../profile/index.js"
import { discAddsOf, weaponAddsOf } from "../serv/zzz.js"
import { buildZzzWeapon, breakOf, computeZzzAttrs, weaponStats, type ZzzCharDetail, type ZzzWeaponDetail } from "./attr.js"

/** 部位叫法 → 部位号；`4号位`、`4号` 由正则另认 */
const POS_WORDS: Readonly<Record<string, number>> = { 一号位: 1, 二号位: 2, 三号位: 3, 四号位: 4, 五号位: 5, 六号位: 6 }

/** 技能等级的位序，与 views/panel.ts 的 ZZZ_SKILL_NAMES 同一次序 */
const SKILL_KEYS = ["normal", "special", "dodge", "chain", "core", "assist"] as const

/** 中文数字 */
const CN: Readonly<Record<string, number>> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 满: 6 }

/** 一处借部件的来源 */
export interface ZzzBorrow {
  /** 代理人正式名 */
  name: string
  /** 借自哪个 uid；不给即本人 */
  uid?: string
}

/** 解析出的一份替换要求 */
export interface ZzzChangeSpec {
  /** 换音擎：借自谁，或指名一把 */
  weapon?: { from?: ZzzBorrow; name?: string; level?: number; star?: number }
  /** 整套驱动盘借自谁 */
  discs?: ZzzBorrow
  /** 逐部位借自谁 */
  pos?: Record<number, ZzzBorrow>
  /** 影画 */
  cons?: number
  /** 等级 */
  level?: number
  /** 技能等级 */
  talent?: Record<string, number>
}

/** 解析结果 */
export type ZzzChangeParsed =
  | { ok: true; char: string; mode: "panel" | "artis" | "dmg"; uid?: string; change: ZzzChangeSpec }
  | { ok: false; message: string }

/**
 * 剥出 uid
 * @param text 文本
 * @returns uid 与余下文本
 */
function takeUid(text: string): { uid?: string; rest: string } {
  const got = /\d{8,10}/.exec(text)
  return got ? { uid: got[0], rest: text.replace(got[0], "").trim() } : { rest: text.trim() }
}

/**
 * 认「借自谁」：必须查得到这位代理人
 * @param text 文本
 * @param meta 元数据
 * @returns 来源；认不出时 undefined
 */
function borrowOf(text: string, meta: MetaLoader): ZzzBorrow | undefined {
  const { uid, rest } = takeUid(text)
  const item = rest ? meta.byName("zzz", rest) : undefined
  if (!item?.name || item.kind !== "character") return undefined
  return { name: item.name, ...(uid ? { uid } : {}) }
}

/**
 * 认一段
 * @param body 一段文本
 * @param meta 元数据
 * @param spec 就地写入
 * @returns 认出来了没有
 */
function parseOne(body: string, meta: MetaLoader, spec: ZzzChangeSpec): boolean {
  const text = body.trim()
  if (!text) return true

  const cons = /^([0-6零一二三四五六满])影画?$/.exec(text)
  if (cons?.[1]) {
    spec.cons = Math.min(6, CN[cons[1]] ?? Number(cons[1]))
    return true
  }
  const lv = /^(?:等级\s*(\d{1,2})|(\d{1,2})\s*级)$/.exec(text)
  if (lv) {
    spec.level = Math.min(60, Math.max(1, Number(lv[1] ?? lv[2])))
    return true
  }
  const skill = /^技能\s*([\d\s,，]+)$/.exec(text)
  if (skill?.[1]) {
    const nums = skill[1].split(/[\s,，]+/).filter(Boolean).map(Number)
    if (nums.length === 0 || nums.some(n => !Number.isFinite(n) || n < 1)) return false
    spec.talent = {}
    nums.slice(0, SKILL_KEYS.length).forEach((n, at) => {
      const key = SKILL_KEYS[at]
      // 核心技 1~7、其余 1~12
      if (key) spec.talent![key] = Math.min(key === "core" ? 7 : 12, n)
    })
    return true
  }
  if (text.endsWith("驱动盘")) {
    const from = borrowOf(text.slice(0, -3), meta)
    if (!from) return false
    spec.discs = from
    return true
  }
  if (text.endsWith("音擎") || text.endsWith("武器")) {
    const from = borrowOf(text.slice(0, -2), meta)
    if (!from) return false
    spec.weapon = { from }
    return true
  }

  // 部位：`雅4号位+6号位`、`雅4+6`、`雅四号位`
  const posRe = /(?:\+?\s*(?:([1-6])号?位?|(一|二|三|四|五|六)号位))+$/
  const posHit = posRe.exec(text)
  if (posHit && posHit.index > 0) {
    const nums = [...posHit[0].matchAll(/([1-6])|(一|二|三|四|五|六)/g)].map(m => (m[1] ? Number(m[1]) : (POS_WORDS[`${m[2]}号位`] ?? 0)))
    const from = borrowOf(text.slice(0, posHit.index), meta)
    if (!from || nums.length === 0) return false
    spec.pos = { ...spec.pos }
    for (const n of nums) spec.pos[n] = from
    return true
  }

  // 指名一把音擎：`60级5叠影硫磺石`
  let rest = text
  let level: number | undefined
  let star: number | undefined
  const wl = /(\d{1,2})\s*级/.exec(rest)
  if (wl) {
    level = Math.min(60, Number(wl[1]))
    rest = rest.replace(wl[0], "")
  }
  const ws = /([1-5一二三四五满])\s*叠影?|叠影\s*([1-5一二三四五满])/.exec(rest)
  if (ws) {
    const raw = ws[1] ?? ws[2] ?? ""
    star = Math.min(5, CN[raw] ?? Number(raw))
    rest = rest.replace(ws[0], "")
  }
  const item = meta.byName("zzz", rest.trim())
  if (item?.kind === "weapon") {
    spec.weapon = { name: item.name, ...(level ? { level } : {}), ...(star ? { star } : {}) }
    return true
  }
  return false
}

/**
 * 解析一条绝区零替换命令
 * @param text 命令原文，已剥掉前缀
 * @param meta 元数据
 * @returns 解析结果
 */
export function parseZzzChange(text: string, meta: MetaLoader): ZzzChangeParsed {
  const at = text.search(/[换变改]/)
  if (at <= 0) return { ok: false, message: "写法是「%艾莲换雅音擎」，「换」字前面是要改造的代理人" }
  const headRaw = text.slice(0, at)
  const { uid, rest } = takeUid(headRaw)
  const modeHit = /(面板|面版|详情|驱动盘|伤害)$/.exec(rest)
  const charName = modeHit ? rest.slice(0, modeHit.index).trim() : rest.trim()
  const char = meta.byName("zzz", charName)
  if (!char?.name || char.kind !== "character") return { ok: false, message: `没认出「${charName}」是哪位代理人` }
  const mode = modeHit?.[1] === "伤害" ? "dmg" : modeHit?.[1] === "驱动盘" ? "artis" : "panel"
  const spec: ZzzChangeSpec = {}
  for (const seg of text.slice(at + 1).split(/[换变改]/)) {
    if (!parseOne(seg, meta, spec)) return { ok: false, message: `没认出「${seg.trim()}」要换成什么` }
  }
  if (Object.keys(spec).length === 0) return { ok: false, message: "「换」字后面没写要换什么" }
  return { ok: true, char: char.name, mode, ...(uid ? { uid } : {}), change: spec }
}

/** 改造要用的东西 */
export interface ZzzApplyDeps {
  /** 元数据 */
  meta: MetaLoader
  /** 读一份借部件的存档；读不到时 undefined */
  load: (uid: string, name: string) => StoredAvatar | undefined
}

/**
 * 按要求改造一份存档，并重算属性
 * @param base 被改造的那一份
 * @param spec 替换要求
 * @param uid 本人 uid，借部件的缺省来源
 * @param deps 依赖
 * @returns 改造后的存档（`from` 记作 `change`）与没换成的那几处
 */
export function applyZzzChange(
  base: StoredAvatar,
  spec: ZzzChangeSpec,
  uid: string,
  deps: ZzzApplyDeps
): { avatar: StoredAvatar; missed: string[] } {
  const detail = base.zzz
  if (!detail) return { avatar: base, missed: ["这份存档没有绝区零面板"] }
  const missed: string[] = []
  const level = spec.level ?? base.level
  let weapon: ZzzWeapon | undefined = detail.weapon
  let discs: ZzzDisc[] = detail.discs.map(one => ({ ...one }))

  if (spec.weapon?.from) {
    const src = deps.load(spec.weapon.from.uid ?? uid, spec.weapon.from.name)
    if (src?.zzz?.weapon) weapon = { ...src.zzz.weapon }
    else missed.push(`${spec.weapon.from.name}的音擎`)
  } else if (spec.weapon?.name) {
    const item = deps.meta.byName("zzz", spec.weapon.name)
    const wd = item ? (deps.meta.detail("zzz", item.id) as ZzzWeaponDetail | undefined) : undefined
    if (item && wd) {
      const wLevel = spec.weapon.level ?? 60
      const st = weaponStats(wd, wLevel, breakOf(wLevel))
      weapon = buildZzzWeapon({
        id: Number(item.id),
        name: item.name,
        level: wLevel,
        star: spec.weapon.star ?? 1,
        ...(item.star ? { metaStar: item.star } : {}),
        ...(st.main ? { main: st.main } : {}),
        ...(st.sub ? { sub: st.sub } : {})
      })
    } else missed.push(spec.weapon.name)
  }

  if (spec.discs) {
    const src = deps.load(spec.discs.uid ?? uid, spec.discs.name)
    if (src?.zzz?.discs.length) discs = src.zzz.discs.map(one => ({ ...one }))
    else missed.push(`${spec.discs.name}的驱动盘`)
  }
  for (const [posText, from] of Object.entries(spec.pos ?? {})) {
    const pos = Number(posText)
    const got = deps.load(from.uid ?? uid, from.name)?.zzz?.discs.find(one => one.pos === pos)
    if (!got) {
      missed.push(`${from.name}的 ${pos} 号位`)
      continue
    }
    discs = [...discs.filter(one => one.pos !== pos), { ...got }].sort((a, b) => a.pos - b.pos)
  }

  // 套装件数按改造后实际装着的重数：借来的盘会改变谁成套
  const count = new Map<number, number>()
  for (const one of discs) if (one.setId) count.set(one.setId, (count.get(one.setId) ?? 0) + 1)
  for (const one of discs) if (one.setId) one.own = count.get(one.setId)
  const talent = { ...base.talent, ...spec.talent }

  const char = deps.meta.detail("zzz", base.id) as ZzzCharDetail | undefined
  let attrs = detail.attrs
  if (char?.attr) {
    const wa = weaponAddsOf(weapon)
    attrs = computeZzzAttrs({
      char,
      level,
      coreLevel: (Number(talent["core"]) || 0) - 1,
      elemId: detail.elemId ?? 0,
      baseAdds: wa.baseAdds,
      adds: [...discs.flatMap(discAddsOf), ...wa.adds],
      activeSetIds: [...count].filter(([, own]) => own >= 2).map(([id]) => id),
      meta: deps.meta
    }).attrs
  } else missed.push("属性（缺这位代理人的元数据，属性未重算）")

  // 米游社自带的评分是原面板的，改造后不再成立，故去掉
  const { mysRating: _r, mysScore: _s, ...kept } = detail
  const avatar: StoredAvatar = {
    ...base,
    level,
    cons: spec.cons ?? base.cons,
    talent,
    from: "change",
    zzz: { ...kept, attrs, ...(weapon ? { weapon } : {}), discs }
  }
  return { avatar, missed }
}
