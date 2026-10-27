/**
 * 模块职责：面板替换 —— 把「#胡桃换钟离武器」这类要求解析出来，并据此改造一份角色面板
 * 依赖方向：依赖 meta/loader 与 meta/arti-set 查名字；**不碰装配层，也不落库**
 * 生命周期：无状态纯函数
 * 注意事项：只造一份改过的 `StoredAvatar` 交给 `PanelBuilder.build`，此处一行属性都不算（算属性/评分/挑图全在装配层，
 *          重复必与它渐渐不一致）。**一律不落库**：改过的只用于出这一张图，写回会让此后每次 `#胡桃面板` 都是假面板。
 *          借部件按 uid 取自另一份存档。**认不出的写法整体失败、不猜**：「换」字前后是自由文本，猜错不报错而是出一张改错的图。
 */
import type { ArtiSetTable } from "../meta/arti-set.js"
import type { MetaLoader } from "../meta/loader.js"
import type { StoredAvatar } from "../store/panel.js"
import type { SelfCalcGame, ProfileArti } from "./profile/index.js"

/** 各游戏的圣遗物部位数，与 build.ts 的 `POS_COUNT` 同一口径 */
const POS_COUNT: Readonly<Record<SelfCalcGame, number>> = { gs: 5, sr: 6 }

/**
 * 部位叫法 → 部位号
 *
 * 两游戏部位不同名，故分开列。**同一个字不能归两个部位**：星铁「头」是 1、原神「头」是 5，
 * 混在一张表会让 `#胡桃换头` 换错部位而毫无迹象。
 */
const POS_WORDS: Readonly<Record<SelfCalcGame, Readonly<Record<string, number>>>> = {
  gs: {
    花: 1,
    生之花: 1,
    毛: 2,
    羽: 2,
    羽毛: 2,
    死之羽: 2,
    沙: 3,
    沙漏: 3,
    表: 3,
    时之沙: 3,
    杯: 4,
    杯子: 4,
    空之杯: 4,
    头: 5,
    冠: 5,
    帽: 5,
    帽子: 5,
    礼冠: 5,
    理之冠: 5
  },
  sr: {
    头: 1,
    头部: 1,
    手: 2,
    手套: 2,
    手部: 2,
    衣: 3,
    衣服: 3,
    甲: 3,
    躯干: 3,
    鞋: 4,
    靴: 4,
    鞋子: 4,
    靴子: 4,
    脚: 4,
    脚部: 4,
    球: 5,
    位面球: 5,
    绳: 6,
    线: 6,
    链接绳: 6,
    连接绳: 6
  }
}

/** 认作"整套圣遗物"的词，两个游戏各自的叫法都收 */
const ARTIS_WORDS = ["圣遗物", "遗器", "驱动盘"] as const

/** 认作"武器"的词 */
const WEAPON_WORDS = ["武器", "光锥", "音擎"] as const

/** 中文数字 → 数值，命座与精炼都用得上 */
const CN_NUMS: Readonly<Record<string, number>> = {
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  满: 6
}

/* 刻意不设「没有武器时的兜底武器」：`#胡桃换钟离武器` 而钟离没有面板数据时凭空配一把会出一张没要求过的图，故记进 `missed` 由命令层说明 */

/** 一处「借部件」的来源 */
export interface BorrowFrom {
  /** 借自哪个角色，元数据里的正式名 */
  name: string
  /** 借自哪个 uid；不给即本人 */
  uid?: string
}

/** 解析出来的一份替换要求 */
export interface ChangeSpec {
  /** 换武器：借自谁，或指名一把 */
  weapon?: {
    /** 指名的武器名，元数据里的正式名 */
    name?: string
    /** 借自谁 */
    from?: BorrowFrom
    /** 指定等级 */
    level?: number
    /** 指定精炼 / 叠影 */
    affix?: number
  }
  /** 换整套圣遗物：借自谁 */
  artis?: BorrowFrom
  /** 换单个部位：部位号 → 借自谁 */
  pos?: Record<number, BorrowFrom>
  /** 换套装：部位号 → 套装名 */
  sets?: Record<number, string>
  /** 换命座 / 星魂 */
  cons?: number
  /** 换等级 */
  level?: number
  /** 换天赋等级，键为 `a` / `e` / `q` 等 */
  talent?: Record<string, number>
  /** 满行迹，星铁独有 */
  fullTrees?: boolean
  /**
   * 被改造这个角色的命途，星铁用
   *
   * **解析期就要知道它**：换天赋那一支的位序随它变（见 {@link talentKeysOf}）。
   * 不是替换要求的一部分，只是解析时顺带带下来的上下文。
   */
  charWeaponType?: string
}

/** 一次解析的结果 */
export type ChangeParsed =
  | {
      /** 认出来了 */
      ok: true
      /** 要改造哪个角色，元数据里的正式名 */
      char: string
      /** 出哪一种图：面板 / 圣遗物 / 伤害 */
      mode: "panel" | "artis" | "dmg"
      /** 伤害那一支的编号，如 `#胡桃伤害2换…` 的 2 */
      dmgIndex?: number
      /** 要查的 uid；不给即本人 */
      uid?: string
      /** 替换要求 */
      change: ChangeSpec
    }
  | {
      /** 认不出 */
      ok: false
      /** 可直接展示的原因；不像角色卡片那样静默 —— 这条命令有「换」字，必是有意为之 */
      message: string
    }

/** 解析要用到的东西 */
export interface ChangeDeps {
  /** 元数据装载器，查角色与武器名 */
  meta: MetaLoader
  /** 套装索引，查套装名 */
  sets: ArtiSetTable
}

/** 星铁满行迹时那一串 id */
const SR_ALL_TREES = [
  "101",
  "102",
  "103",
  "201",
  "202",
  "203",
  "204",
  "205",
  "206",
  "207",
  "208",
  "209",
  "210",
  "301",
  "302",
  "501"
] as const

/** 原神的天赋键次序 */
const GS_TALENT_KEYS: readonly string[] = ["a", "e", "q"]

/**
 * 星铁的天赋键次序，**随角色的命途变**
 *
 * `*爻光换天赋610101010` 的第 5 位是什么，取决于这个角色有没有第五个技能：
 * 记忆角色多忆灵技与忆灵天赋（`me` / `mt`），欢愉角色多欢愉技（`j`），其余只有四个。
 * **不随角色变的那张写死表会把欢愉角色的第 5 位当成忆灵技**，而欢愉角色没有忆灵技 ——
 * 于是那一位既没落到欢愉技上、也不报错。判据取元数据里角色的 `weapon`（星铁那一路它存的是命途）。
 */
const SR_TALENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  记忆: ["a", "e", "t", "q", "me", "mt"],
  欢愉: ["a", "e", "t", "q", "j"]
}

/** 星铁普通角色的四个键 */
const SR_BASE_KEYS: readonly string[] = ["a", "e", "t", "q"]

/** 天赋键 → 中文名，提示里把位序念出来要用 */
const TALENT_NAMES: Readonly<Record<string, string>> = {
  a: "普攻",
  e: "战技",
  t: "天赋",
  q: "终结技",
  me: "忆灵技",
  mt: "忆灵天赋",
  j: "欢愉技"
}

/**
 * 取一个角色的天赋键次序
 * @param game 游戏
 * @param weaponType 星铁角色的命途（原神不用）
 * @returns 键次序
 */
export function talentKeysOf(game: SelfCalcGame, weaponType?: string): readonly string[] {
  if (game === "gs") return GS_TALENT_KEYS
  return SR_TALENT_KEYS[weaponType ?? ""] ?? SR_BASE_KEYS
}

/**
 * 把一个角色的位序念成一句话
 *
 * 使用者不必猜第 5 位是什么 —— 认不出位数时直接把这句回过去。
 * @param game 游戏
 * @param weaponType 星铁角色的命途
 * @returns 形如「普攻/战技/天赋/终结技」
 */
export function talentOrderText(game: SelfCalcGame, weaponType?: string): string {
  return talentKeysOf(game, weaponType)
    .map(key => TALENT_NAMES[key] ?? key)
    .join("/")
}

/**
 * 把「XX专武」折成元数据里那条别名
 *
 * **元数据的武器别名表里本来就有这个别名**（`"雾切之回光": "雾切,神里绫华专武"`），
 * 故只要把使用者写的简称换成正式角色名再拼上「专武」，就能查到。
 * 只有五星角色有专武，四星角色查不到 —— 那时原样返回，由调用方给出"认不出"。
 * @param text 使用者写的那一段
 * @param game 游戏
 * @param deps 依赖
 * @returns 折算后的名字；不含「专武」时原样返回
 */
function specialWeaponName(text: string, game: SelfCalcGame, deps: ChangeDeps): string {
  if (!text.includes("专武")) return text
  const char = deps.meta.byName(game, text.replace("专武", "").trim())
  return char?.name ? `${char.name}专武` : text
}

/**
 * 把天赋等级那一串切成逐个等级
 *
 * 带分隔符时按分隔符切；**不带分隔符时逐位贪婪切**（`610101010` → 6/10/10/10/10），
 * 等级只到 15，故两位数只可能是 10~15，优先吃两位。
 * 整串当一个数解会得到 `610101010` 这样的等级，而它会被截到 15、看着像只换了一个技能。
 * @param text 数字那一段
 * @returns 逐个等级；一个都认不出时空数组
 */
function talentNums(text: string): number[] {
  const parts = text.split(/[\s,，]+/).filter(one => one)
  // 有分隔符（或只写了一个等级）时照原样解
  if (parts.length > 1) {
    const nums = parts.map(one => Number(one))
    return nums.some(one => !Number.isFinite(one) || one < 1) ? [] : nums
  }

  const digits = parts[0] ?? ""
  if (!/^\d+$/.test(digits)) return []
  // 只写了一两位时就是一个等级
  if (digits.length <= 2) {
    const one = Number(digits)
    return one >= 1 && one <= 15 ? [one] : []
  }

  const out: number[] = []
  let at = 0
  while (at < digits.length) {
    const two = Number(digits.slice(at, at + 2))
    if (two >= 10 && two <= 15) {
      out.push(two)
      at += 2
      continue
    }
    const one = Number(digits[at])
    if (!(one >= 1 && one <= 9)) return []
    out.push(one)
    at += 1
  }
  return out
}

/**
 * 认一个数字，中文与阿拉伯都收
 * @param text 一个字或一串数字
 * @returns 数值；认不出时 undefined
 */
function numOf(text: string): number | undefined {
  const cn = CN_NUMS[text]
  if (cn !== undefined) return cn
  const num = Number(text)
  return Number.isFinite(num) ? num : undefined
}

/**
 * 从一段文本里剥出 uid
 * @param text 文本
 * @returns uid 与剥掉之后的文本
 */
function takeUid(text: string): { uid?: string; rest: string } {
  const got = /(?:18|[1-9])\d{8}/.exec(text)
  if (!got) return { rest: text }
  return { uid: got[0], rest: text.replace(got[0], "").trim() }
}

/**
 * 认「借自谁」这一段
 *
 * 形如 `刻晴`、`100000001刻晴`。角色名必须查得到元数据 —— 见文件头：猜错会出一张改错的图。
 * @param text 一段文本
 * @param game 游戏
 * @param deps 依赖
 * @returns 来源；角色名认不出时 undefined
 */
function borrowOf(text: string, game: SelfCalcGame, deps: ChangeDeps): BorrowFrom | undefined {
  const { uid, rest } = takeUid(text)
  const name = rest.trim()
  if (!name) return undefined
  const item = deps.meta.byName(game, name)
  if (!item?.name) return undefined
  return { name: item.name, ...(uid ? { uid } : {}) }
}

/**
 * 认一句「换什么」
 *
 * 「换」字后面可跟好几段（`#胡桃换钟离武器换刻晴圣遗物`），本函数只认其中一段，认不出的段返回 false 由调用方整体失败。
 * @param text 一段文本
 * @param game 游戏
 * @param deps 依赖
 * @param spec 要写进去的替换要求，就地改
 * @returns 认出来了没有
 */
function parseOne(text: string, game: SelfCalcGame, deps: ChangeDeps, spec: ChangeSpec): boolean {
  const body = text.trim()
  if (!body) return true

  // ── 一段里连写命座 / 天赋 / 等级（`2命天赋9 10 10`、`80级3命`）：逐个剥下来再各认各的。
  //    **整段都由这三种组成时才拆**：`90级护摩之杖` 里的「90级」是武器等级，拆出去就成了角色等级
  const combo = /([0-6零一二三四五六满](?:命|魂|星魂))|((?:天赋|技能|行迹)\s*[\d\s,，]+?)(?=$|[0-6零一二三四五六满](?:命|魂)|\d{1,3}\s*级|等级)|(\d{1,3}\s*级|等级\s*\d{1,3})/g
  const pieces = [...body.matchAll(combo)].map(m => m[0])
  if (pieces.length >= 2 && pieces.reduce((rest, one) => rest.replace(one, ""), body).trim() === "") {
    return pieces.every(one => parseOne(one.trim(), game, deps, spec))
  }

  // ── 满行迹（星铁）
  if (game === "sr" && /^满行迹$/.test(body)) {
    spec.fullTrees = true
    return true
  }

  // ── 命座：`三命`、`6命`、`满星魂`
  const consRet = /^([0-6零一二三四五六满])(?:命|魂|星魂)$/.exec(body)
  if (consRet?.[1]) {
    const num = numOf(consRet[1])
    if (num === undefined) return false
    spec.cons = Math.max(0, Math.min(6, num))
    return true
  }

  // ── 等级：`80级`、`等级80`
  const lvRet = /^(?:等级\s*(\d{1,3})|(\d{1,3})\s*级)$/.exec(body)
  if (lvRet) {
    const num = Number(lvRet[1] ?? lvRet[2])
    if (!Number.isFinite(num) || num < 1) return false
    spec.level = Math.min(100, num)
    return true
  }

  // ── 天赋：`天赋9 9 9`，也收不带分隔的 `天赋610101010`，个数按角色定
  const talentRet = /^(?:天赋|技能|行迹)\s*([\d\s,，]+)$/.exec(body)
  if (talentRet?.[1]) {
    const nums = talentNums(talentRet[1])
    if (nums.length === 0) return false
    const keys = talentKeysOf(game, spec.charWeaponType)
    const out: Record<string, number> = {}
    nums.slice(0, keys.length).forEach((num, at) => {
      const key = keys[at]
      if (key) out[key] = Math.min(15, num)
    })
    spec.talent = out
    return true
  }

  // ── 整套圣遗物 / 单部位：`刻晴圣遗物`、`刻晴花`、`刻晴花+杯`
  for (const word of ARTIS_WORDS) {
    if (!body.endsWith(word)) continue
    const from = borrowOf(body.slice(0, -word.length), game, deps)
    if (!from) return false
    spec.artis = from
    return true
  }

  // ── 武器：`钟离武器`、`护摩之杖`、`5精护摩之杖`、`90级护摩之杖`
  for (const word of WEAPON_WORDS) {
    if (!body.endsWith(word)) continue
    const head = body.slice(0, -word.length).trim()
    // `#胡桃换武器` 这种不带来源的形态没有意义，一律不认
    if (!head) return false
    const from = borrowOf(head, game, deps)
    if (!from) return false
    spec.weapon = { from }
    return true
  }

  // ── 单个部位：先剥掉可能的 `+` 连写，逐段认
  const posMap = POS_WORDS[game]
  const posHit = matchPos(body, posMap, game, deps)
  if (posHit) {
    spec.pos = { ...spec.pos, ...posHit }
    return true
  }

  // ── 套装：`宗室套`、`乐团4`、`深林+饰金`
  const setHit = matchSets(body, game, deps)
  if (setHit) {
    spec.sets = { ...spec.sets, ...setHit }
    return true
  }

  // ── 指名一把武器 / 光锥（不带「武器」二字）：`护摩之杖`、`5精护摩之杖`、`90级护摩之杖`
  const weaponHit = matchWeapon(body, game, deps)
  if (weaponHit) {
    spec.weapon = weaponHit
    return true
  }

  // 别的形态一概不认，理由见文件头
  return false
}

/**
 * 认「借某人的某几个部位」
 * @param body 一段文本
 * @param posMap 部位表
 * @param game 游戏
 * @param deps 依赖
 * @returns 部位号 → 来源；认不出时 undefined
 */
function matchPos(
  body: string,
  posMap: Readonly<Record<string, number>>,
  game: SelfCalcGame,
  deps: ChangeDeps
): Record<number, BorrowFrom> | undefined {
  // 部位词按长的先试：`头部` 与 `头` 都在表里，短的先匹配会把 `头部` 认成 `头`
  const words = Object.keys(posMap).sort((a, b) => b.length - a.length)
  // 末尾一串部位词（可用 `+` 连接），前面是来源
  let rest = body
  const hit: number[] = []
  for (;;) {
    const word = words.find(one => rest.endsWith(one))
    if (!word) break
    const pos = posMap[word]
    if (pos !== undefined) hit.unshift(pos)
    rest = rest.slice(0, -word.length).replace(/\+$/, "")
  }
  if (hit.length === 0) return undefined

  const from = borrowOf(rest, game, deps)
  if (!from) return undefined
  const out: Record<number, BorrowFrom> = {}
  for (const pos of hit) out[pos] = from
  return out
}

/**
 * 认「换成某个套装」
 *
 * 原神一个套装名要铺到几个部位，星铁的球与绳属位面套另算，故按部位分开落。
 * @param body 一段文本
 * @param game 游戏
 * @param deps 依赖
 * @returns 部位号 → 套装名；认不出时 undefined
 */
function matchSets(body: string, game: SelfCalcGame, deps: ChangeDeps): Record<number, string> | undefined {
  // `深林套4+饰金2` 这种写法：按 `+` 切开，逐段认套装名
  const parts = body
    .split("+")
    .map(one => one.replace(/套|[2４4]件?套?|\d/g, "").trim())
    .filter(one => one)
  if (parts.length === 0) return undefined

  const names: string[] = []
  for (const one of parts) {
    const set = deps.sets.set(game, one)
    if (!set?.name) return undefined
    names.push(set.name)
  }

  const out: Record<number, string> = {}
  if (game === "gs") {
    // 一个套装名铺满五个部位；给了两个则前三件用第一个、后两件用第二个
    const first = names[0] ?? ""
    const second = names[1] ?? first
    for (let idx = 1; idx <= 3; idx++) out[idx] = first
    for (let idx = 4; idx <= 5; idx++) out[idx] = second
  } else {
    // 星铁：遗器套（1~4）与位面套（5~6）分开，按套装 `idxs` 里有无 5/6 判族；判错会把位面套铺到头与手上、那两格空白
    for (const name of names) {
      const set = deps.sets.set(game, name)
      const idxs = Object.keys(set?.idxs ?? {}).map(one => Number(one))
      const isPlanar = idxs.some(one => one >= 5)
      if (isPlanar) {
        for (let idx = 5; idx <= 6; idx++) out[idx] = name
      } else {
        for (let idx = 1; idx <= 4; idx++) out[idx] = name
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 认「指名一把武器」，可带等级与精炼
 * @param body 一段文本
 * @param game 游戏
 * @param deps 依赖
 * @returns 武器要求；认不出时 undefined
 */
function matchWeapon(body: string, game: SelfCalcGame, deps: ChangeDeps): ChangeSpec["weapon"] | undefined {
  let rest = body
  let level: number | undefined
  let affix: number | undefined

  // 等级：`90级` 或 `等级90`
  const lv = /(?:等级\s*(\d{1,3})|(\d{1,3})\s*级)/.exec(rest)
  if (lv) {
    const num = Number(lv[1] ?? lv[2])
    if (Number.isFinite(num)) level = Math.min(90, Math.max(1, num))
    rest = rest.replace(lv[0], "").trim()
  }

  // 精炼：`5精`、`精5`、`满精`、`三叠影`
  const af = /([1-5一二三四五满])\s*(?:精炼?|叠影?)|(?:精炼?|叠影?)\s*([1-5一二三四五满])/.exec(rest)
  if (af) {
    const num = numOf(af[1] ?? af[2] ?? "")
    if (num !== undefined) affix = Math.min(5, Math.max(1, num === 6 ? 5 : num))
    rest = rest.replace(af[0], "").trim()
  }

  const name = specialWeaponName(rest.trim(), game, deps)
  if (!name) return undefined
  const item = deps.meta.byName(game, name)
  // 必须真是一把武器 / 光锥：`kind` 认不出时宁可不认，也不把一个角色名当武器
  if (!item?.name || (item.kind !== undefined && item.kind !== "weapon")) return undefined
  return {
    name: item.name,
    ...(level !== undefined ? { level } : {}),
    ...(affix !== undefined ? { affix } : {})
  }
}

/**
 * 解析一条替换命令
 *
 * 形如 `胡桃面板换钟离武器`、`100000001刻晴伤害2换满行迹`。
 * @param text 命令原文，已剥掉 `#` 与游戏前缀
 * @param game 游戏
 * @param deps 依赖
 * @returns 解析结果
 */
export function parseChange(text: string, game: SelfCalcGame, deps: ChangeDeps): ChangeParsed {
  const body = text.trim().replace(/[变改]/g, "换")
  const at = body.indexOf("换")
  if (at < 0) return { ok: false, message: "没看到「换」字，这条命令形如「#胡桃换钟离武器」" }

  const head = body.slice(0, at).trim()
  const tail = body.slice(at + 1).trim()
  if (!head) return { ok: false, message: "「换」字前面要写角色名，如「#胡桃换钟离武器」" }
  if (!tail) return { ok: false, message: "「换」字后面要写换成什么，如「#胡桃换钟离武器」" }

  // 角色名那一段：可能带 uid 与出图种类
  const { uid, rest } = takeUid(head)
  let charPart = rest
  let mode: "panel" | "artis" | "dmg" = "panel"
  let dmgIndex: number | undefined

  const dmgRet = /(伤害)(\d*)$/.exec(charPart)
  const artisRet = new RegExp(`(${ARTIS_WORDS.join("|")})$`).exec(charPart)
  const panelRet = /(面板|面版|详情|详细)$/.exec(charPart)
  if (dmgRet) {
    mode = "dmg"
    if (dmgRet[2]) dmgIndex = Number(dmgRet[2])
    charPart = charPart.slice(0, dmgRet.index)
  } else if (artisRet) {
    mode = "artis"
    charPart = charPart.slice(0, artisRet.index)
  } else if (panelRet) {
    charPart = charPart.slice(0, panelRet.index)
  }

  const char = deps.meta.byName(game, charPart.trim())
  if (!char?.name) return { ok: false, message: `没认出「${charPart.trim()}」是哪个角色` }

  // 「换」后面可能有好几段，逐段认；一段认不出就整体失败。
  // 命途先填进去：换天赋那一支要按它定位序（欢愉角色没有忆灵技）
  // 星铁的命途在 `weapon` 这个字段上（元数据里角色的 `weapon` 就是命途，不是武器类型）
  const weaponType = char.weapon ?? ""
  const spec: ChangeSpec = weaponType ? { charWeaponType: weaponType } : {}
  for (const part of tail.split("换")) {
    if (!parseOne(part, game, deps, spec)) {
      const order = /^(?:天赋|技能|行迹)/.test(part.trim())
        ? `。${char.name} 的位序是 ${talentOrderText(game, weaponType)}`
        : ""
      return { ok: false, message: `没认出「${part.trim()}」要换成什么${order}` }
    }
  }
  // `charWeaponType` 是上下文而非替换要求，判空时不算它
  const asked = Object.keys(spec).filter(key => key !== "charWeaponType")
  if (asked.length === 0) return { ok: false, message: "没认出要换什么" }

  return {
    ok: true,
    char: char.name,
    mode,
    change: spec,
    ...(dmgIndex !== undefined ? { dmgIndex } : {}),
    ...(uid ? { uid } : {})
  }
}

/** 造改造后那份面板要用到的东西 */
export interface ApplyDeps {
  /** 套装索引，换套装时要按部位查那一件的名字 */
  sets: ArtiSetTable
  /** 元数据装载器，指名武器时要查它的正式名 */
  meta: MetaLoader
  /**
   * 取一个角色的存档
   *
   * 借部件要读别的角色（可能在别的 uid 名下）；取不到时那一处不换（见 {@link applyChange}）。
   */
  load: (uid: string, name: string) => StoredAvatar | undefined
}

/**
 * 按替换要求造一份改过的角色面板
 *
 * **不改传进来那一份**，改造出来的只用于出这一张图。**借不到的部件就不换**而非整体失败，
 * 没换成的那几处由命令层一并说出。
 * @param game 游戏
 * @param base 库里那份角色面板
 * @param spec 替换要求
 * @param uid 本人的 uid，借部件时的缺省来源
 * @param deps 依赖
 * @returns 改过的那份，与没换成的那几处说明
 */
export function applyChange(
  game: SelfCalcGame,
  base: StoredAvatar,
  spec: ChangeSpec,
  uid: string,
  deps: ApplyDeps
): { avatar: StoredAvatar; missed: string[] } {
  // 深拷一份：改造只影响这一张图
  const out: StoredAvatar = {
    ...base,
    ...(base.weapon ? { weapon: { ...base.weapon } } : {}),
    ...(base.artis ? { artis: cloneArtis(base.artis) } : {}),
    ...(base.talent ? { talent: { ...base.talent } } : {}),
    ...(base.trees ? { trees: [...base.trees] } : {}),
    // 换过的那份不再是原来那个源，标出来 —— 图上「数据来源」那一行随之显示「预设面板」
    from: "change"
  }
  const missed: string[] = []

  // ── 等级、命座、天赋、行迹：直接改，不必查别处
  if (spec.level !== undefined) {
    out.level = spec.level
    // 突破阶数交给装配层按等级反推：留着旧的会让 80 级配 6 阶白值
    delete out.promote
  }
  if (spec.cons !== undefined) out.cons = spec.cons
  if (spec.talent) out.talent = { ...out.talent, ...spec.talent }
  if (spec.fullTrees && game === "sr") out.trees = [...SR_ALL_TREES]

  // ── 武器
  if (spec.weapon) {
    const got = pickWeapon(game, spec.weapon, uid, deps)
    if (got) out.weapon = got
    else missed.push("武器")
  }

  // ── 整套圣遗物
  if (spec.artis) {
    const from = deps.load(spec.artis.uid ?? uid, spec.artis.name)
    if (from?.artis && Object.keys(from.artis).length > 0) out.artis = cloneArtis(from.artis)
    else missed.push(`${spec.artis.name}的圣遗物`)
  }

  // ── 单个部位
  for (const [pos, from] of Object.entries(spec.pos ?? {})) {
    const src = deps.load(from.uid ?? uid, from.name)
    const one = src?.artis?.[pos]
    if (!one) {
      missed.push(`${from.name}的第 ${pos} 件`)
      continue
    }
    out.artis = { ...out.artis, [pos]: { ...one } }
  }

  // ── 套装：只改名字与 id，词条保持原样
  if (spec.sets) applySets(game, out, spec.sets, deps)

  return { avatar: out, missed }
}

/**
 * 拷一份圣遗物
 * @param artis 原件
 * @returns 拷贝
 */
function cloneArtis(artis: Record<string, ProfileArti>): Record<string, ProfileArti> {
  const out: Record<string, ProfileArti> = {}
  for (const [pos, one] of Object.entries(artis)) {
    out[pos] = { ...one, ...(one.attrIds ? { attrIds: [...one.attrIds] } : {}) }
  }
  return out
}

/**
 * 定下换上去的那把武器
 * @param game 游戏
 * @param want 武器要求
 * @param uid 本人 uid
 * @param deps 依赖
 * @returns 武器；认不出或借不到时 undefined
 */
function pickWeapon(game: SelfCalcGame, want: NonNullable<ChangeSpec["weapon"]>, uid: string, deps: ApplyDeps) {
  // 借自某人：连等级与精炼一并借过来
  if (want.from) {
    const src = deps.load(want.from.uid ?? uid, want.from.name)
    if (!src?.weapon) return undefined
    return { ...src.weapon }
  }
  if (!want.name) return undefined
  const item = deps.meta.byName(game, want.name)
  if (!item?.name) return undefined
  return {
    name: item.name,
    ...(item.id ? { id: item.id } : {}),
    // 不指定就按满级满精：试算的用意是"这把武器给这个角色带来多少"，而不是"我这把练了多少"
    level: want.level ?? 90,
    affix: want.affix ?? 1
  }
}

/**
 * 把几件圣遗物换成另一个套装
 *
 * **只改名字、id 与套装名，词条一个都不动**：换套装问的是同样这几条词条换成另一套会怎样。
 * @param game 游戏
 * @param avatar 要改的那份，就地改
 * @param sets 部位号 → 套装名
 * @param deps 依赖
 */
function applySets(game: SelfCalcGame, avatar: StoredAvatar, sets: Record<number, string>, deps: ApplyDeps): void {
  const artis = avatar.artis
  if (!artis) return

  for (let pos = 1; pos <= POS_COUNT[game]; pos++) {
    const setName = sets[pos]
    const one = artis[String(pos)]
    // 那个部位本来没有圣遗物就跳过：换套装不该凭空长出一件
    if (!setName || !one) continue
    const set = deps.sets.set(game, setName)
    const name = set?.idxs?.[String(pos)]
    if (!set || !name) continue

    // 旧 id 要去掉：装配层「先按 id 查、查不到再按名字查」，留着旧 id 会按它查回旧套装，表现是名字换了效果没换、两处矛盾
    const next: ProfileArti = { ...one, name, set: set.name }
    delete next.id
    artis[String(pos)] = next
  }
}
