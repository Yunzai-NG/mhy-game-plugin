/**
 * 模块职责：`#XX养成` 与 `#尘歌壶模数` 的视图模型 —— 参数解析、请求体拼装、消耗清单整形
 * 依赖方向：纯函数，米游社的四个接口由命令层去取；不碰 IO
 * 生命周期：无状态
 * 注意事项：**参数超上限是压回上限、而非报错**（`#刻晴养成99` 得 90）；个数不对才报错、判据是「补齐缺省后仍不等」（少给几个合法、多给才错）。**缺省值与上限是同一组数**（原神 `90,90,10,10,10`、星铁 `80,80,6,10,10,10,6,6`），不带参数即「练满要多少」。
 *          **三星以下武器目标等级压到 70**（一二星上限就是 70、也出现在图上「Lv.20 → Lv.70」），故抽成 {@link weaponTargetOf} 在拼请求体与造视图前先算一次。**尘歌壶那份数量不做万位折算**（模具与消耗原样输出）。
 */
import { INDENT } from "../core/text.js"

/**
 * 有养成计算的两个游戏，绝区零的计算器米游社尚未开放
 *
 * **与 `panel/profile` 的 `SelfCalcGame` 是两件事**（那个说「面板属性要不要本插件自己算」、这个说「米游社养成计算器开放了哪几个」），判据毫不相干、只是今天都是 `gs | sr`，勿混用。
 */
export type MysCalcGame = "gs" | "sr" | "zzz"

/**
 * 判一个游戏有没有米游社养成计算器
 * @param game 游戏
 * @returns 有养成计算器时为真
 */
export function isMysCalcGame(game: string | undefined): game is MysCalcGame {
  return game === "gs" || game === "sr" || game === "zzz"
}

/**
 * 各游戏的参数缺省值，同时也是上限
 *
 * 顺序：原神「角色、武器、普攻、战技、爆发」，星铁「角色、光锥、普攻、战技、终结技、天赋、忆灵技、忆灵天赋」，绝区零见下；个数即 {@link calcLevels} 要求的个数。
 */
const LEVEL_CAPS: Readonly<Record<MysCalcGame, readonly number[]>> = {
  gs: [90, 90, 10, 10, 10],
  sr: [80, 80, 6, 10, 10, 10, 6, 6],
  // 绝区零：代理人、音擎、普攻、特殊技、闪避、连携技、核心技、支援技；核心技满级 7、其余 12
  zzz: [60, 60, 12, 12, 12, 12, 7, 12]
}

/** 命令文本里不属于名字也不属于参数的那些词 */
const NOISE = /[#＃]|星铁|绝区零|养成|计算/g

/**
 * 从命令文本里取角色名
 *
 * 剥掉触发词、数字与分隔符，剩下的整体当名字候选；名字前的「喵喵」（`#喵喵刻晴养成`）一并剥掉。
 * @param rest 命令文本（已剥掉 `#` 与游戏前缀之外的部分交由本函数处理）
 * @returns 名字候选；什么都没剩时空串
 */
export function calcNameOf(rest: string): string {
  return rest
    .replace(NOISE, "")
    .replace(/[0-9]|[,，\s]/g, "")
    .replace(/^喵喵/, "")
}

/**
 * 从命令文本里取目标等级
 *
 * 少给合法（后面取缺省）、多给才错 —— 判据是先按缺省补齐前 n 个、再看总数是否恰为 n；超上限一律压回上限。
 * @param rest 命令文本
 * @param game 游戏
 * @param name 已认出的名字，须从参数串中剥掉
 * @returns 逐项目标等级；个数不对时 undefined
 */
export function calcLevels(rest: string, game: MysCalcGame, name: string): number[] | undefined {
  const caps = LEVEL_CAPS[game]
  const body = rest
    .replace(NOISE, "")
    .trim()
    .replace(/[，\s]/g, ",")
    .replace(name, "")

  const given = body.split(",").filter(one => one !== "")
  if (given.length === 0) return [...caps]

  const out = [...given]
  for (let idx = 0; idx < caps.length; idx += 1) {
    if (!out[idx]) out[idx] = String(caps[idx])
  }
  if (out.length !== caps.length) return undefined
  return out.map((one, idx) => Math.min(Number(one), caps[idx] ?? 0))
}

/**
 * 三星以下的武器把目标等级压到 70
 *
 * 一二星上限就是 70。改的是目标等级本身，故这个 70 同时进请求体与图，抽成一步先算、两处取同一个值。
 * @param levels 目标等级
 * @param rarity 武器星级；没有已装备武器时省略
 * @returns 调整后的目标等级
 */
export function weaponTargetOf(levels: readonly number[], rarity?: number): readonly number[] {
  if (rarity === undefined || Number(rarity) >= 3) return levels
  const out = [...levels]
  out[1] = 70
  return out
}

/** 原神 `detail` / `avatarSkill` 返回的一条技能 */
export interface GsSkillRaw {
  /** 计算器用的技能组 id */
  group_id?: number | string
  /** 当前等级；`avatarSkill`（未拥有的角色）不给这一栏，由调用方补 1 */
  level_current?: number
  /** 满级；为 1 的是被动天赋，不参与计算 */
  max_level?: number
  /** 技能名 */
  name?: string
  /** 图标绝对地址 */
  icon?: string
}

/** 星铁 `detail` 返回的一条行迹 */
export interface SrSkillRaw {
  /** 行迹节点 id */
  point_id?: number | string
  /** 当前等级 */
  cur_level?: number
  /** 接口自带的目标等级，参数没给到时取它 */
  target_level?: number
  /** 满级 */
  max_level?: number
  /** 节点位置，`Point01` 一类；展示名由它折算 */
  anchor?: string
  /** 图标绝对地址 */
  item_url?: string
}

/** 一件已装备的武器 / 光锥，两个游戏的字段名不同，取值时已归一 */
export interface CalcEquip {
  /** 武器 id */
  id: string
  /** 武器名 */
  name: string
  /** 星级 */
  star: number
  /** 当前等级 */
  level: number
  /** 图标绝对地址 */
  icon: string
}

/** 拼原神请求体要的东西 */
export interface GsBodyInput {
  /** 角色 id */
  id: string
  /** 角色当前等级 */
  level: number
  /** 目标等级，须已过 {@link weaponTargetOf} */
  levels: readonly number[]
  /** 已滤掉被动天赋的技能表 */
  skills: readonly GsSkillRaw[]
  /** 已装备武器；没有则不带 weapon 一节 */
  equip?: CalcEquip
  /** 游戏 uid */
  uid: string
  /** 区服标识，形如 `cn_gf01` */
  server: string
}

/**
 * 拼原神 `compute` 的请求体
 *
 * **只取前三个技能**：普攻 / 战技 / 爆发之外的（如替代冲刺）满级为 1，已由调用方按 `max_level != 1` 滤掉。
 * **内层 `lang` 只在国际服补**（外层恒带一个），不"一并去重" —— 服务端认的就是这个形态。
 * @param o 输入
 * @returns 请求体
 */
export function gsCalcBody(o: GsBodyInput): Record<string, unknown> {
  const os = o.server.startsWith("os")
  const item: Record<string, unknown> = {
    avatar_id: Number(o.id),
    avatar_level_current: Number(o.level),
    avatar_level_target: Number(o.levels[0]),
    skill_list: [0, 1, 2].map(idx => ({
      id: Number(o.skills[idx]?.group_id),
      level_current: Number(o.skills[idx]?.level_current),
      level_target: Number(o.levels[idx + 2])
    }))
  }
  if (os) item["lang"] = "zh-cn"
  if (o.equip) {
    item["weapon"] = {
      id: Number(o.equip.id),
      level_current: Number(o.equip.level),
      level_target: Number(o.levels[1])
    }
  }
  return { items: [item], lang: "zh-cn", region: o.server, uid: o.uid }
}

/** 拼星铁请求体要的东西 */
export interface SrBodyInput {
  /** 角色 id */
  id: string
  /** 角色当前等级 */
  level: number
  /** 目标等级 */
  levels: readonly number[]
  /** 行迹表，含忆灵那一组 */
  skills: readonly SrSkillRaw[]
  /** 已装备光锥；没有则不带 equipment 一节 */
  equip?: CalcEquip
  /** 区服标识 */
  server: string
}

/**
 * 拼星铁 `compute` 的请求体
 *
 * 行迹按**表内顺序**对上 `levels.slice(2)`，对不上的取接口自带的 `target_level`。
 * @param o 输入
 * @returns 请求体
 */
export function srCalcBody(o: SrBodyInput): Record<string, unknown> {
  const targets = o.levels.slice(2)
  const body: Record<string, unknown> = {
    game: "hkrpg",
    avatar: {
      item_id: Number(o.id),
      cur_level: Number(o.level),
      target_level: Number(o.levels[0])
    },
    skill_list: o.skills.map((one, idx) => ({
      item_id: one.point_id,
      cur_level: one.cur_level,
      target_level: Number(targets[idx]) || one.target_level
    }))
  }
  if (o.server.startsWith("os")) body["lang"] = "zh-cn"
  if (o.equip) {
    body["equipment"] = {
      item_id: Number(o.equip.id),
      cur_level: Number(o.equip.level),
      target_level: Number(o.levels[1])
    }
  }
  return body
}

/** 一项材料消耗，两个游戏的字段名不同（`name`/`item_name`、`icon`/`item_url`），此处归一 */
export interface CalcConsume {
  /** 材料名 */
  name: string
  /** 图标绝对地址，米游社给的 */
  icon: string
  /** 需要的数量，已过万位折算 */
  num: string
  /** 还缺多少；星铁的接口不给这一栏，故可能没有 */
  lack?: string
  /** 名字里带「」的是天赋书 / 行迹材料，模板据它换色 */
  isTalent?: boolean
}

/**
 * 万位折算
 *
 * 判据是**严格大于** 10000：正好一万时仍写作 `10000`。
 * @param num 原数
 * @returns 形如 `12` 或 `1.2 w`
 */
export function calcNum(num: unknown): string {
  const value = Number(num) || 0
  return value > 10000 ? `${(value / 10000).toFixed(1)} w` : String(value)
}

/**
 * 造一项消耗
 * @param name 材料名
 * @param icon 图标地址
 * @param num 数量
 * @param lack 缺少的数量；没有这一栏时省略
 * @returns 归一后的一项
 */
function consumeOf(name: unknown, icon: unknown, num: unknown, lack?: unknown): CalcConsume {
  const label = String(name ?? "")
  const one: CalcConsume = { name: label, icon: String(icon ?? ""), num: calcNum(num) }
  if (lack !== undefined) one.lack = calcNum(lack)
  // 天赋书与行迹材料的名字都带书名号，据此认它们
  if (label.includes("「")) one.isTalent = true
  return one
}

/**
 * 摊平原神的 `overall_material_consume`
 *
 * 形态是「分组 → 若干条，每条自带一个 `consume` 数组」，故摊两层；分组键原样保留。
 * @param raw 接口返回的那一栏
 * @returns 分组键 → 消耗清单
 */
export function flattenGsConsume(raw: unknown): Record<string, CalcConsume[]> {
  const out: Record<string, CalcConsume[]> = {}
  if (!raw || typeof raw !== "object") return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const list: CalcConsume[] = []
    for (const group of Array.isArray(value) ? value : []) {
      const inner = (group as { consume?: unknown })?.consume
      for (const one of Array.isArray(inner) ? inner : []) {
        const item = one as { name?: unknown; icon?: unknown; num?: unknown; lack_num?: unknown }
        list.push(consumeOf(item.name, item.icon, item.num, item.lack_num))
      }
    }
    out[key] = list
  }
  return out
}

/**
 * 摊平星铁的计算结果
 *
 * 只有一层，但**必须先丢掉 `coin_id`** —— 那是信用点的材料 id（一个数字而非数组），混进来会摊出一堆空条目。
 * @param raw 接口返回的 `data`
 * @returns 分组键 → 消耗清单
 */
export function flattenSrConsume(raw: unknown): Record<string, CalcConsume[]> {
  const out: Record<string, CalcConsume[]> = {}
  if (!raw || typeof raw !== "object") return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "coin_id") continue
    const list: CalcConsume[] = []
    for (const one of Array.isArray(value) ? value : []) {
      const item = one as { item_name?: unknown; item_url?: unknown; num?: unknown }
      list.push(consumeOf(item.item_name, item.item_url, item.num))
    }
    out[key] = list
  }
  return out
}

/** 星铁行迹节点位置 → 展示名 */
const SR_ANCHOR: Readonly<Record<string, string>> = {
  Point01: "普通攻击",
  Point02: "战技",
  Point03: "终结技",
  Point19: "忆灵技",
  Point20: "忆灵天赋"
}

/** 图上一行技能 */
export interface CalcSkill {
  /** 展示名 */
  name: string
  /** 图标绝对地址 */
  icon: string
  /** 当前等级 */
  current: number
  /** 目标等级 */
  target: number
  /** 满级 */
  max: number
}

/**
 * 原神的技能行
 *
 * 目标等级取第三个参数往后那几个；对不上的（角色有四个可升技能时）取当前等级，即这一项不动。
 * @param skills 已滤掉被动天赋的技能表
 * @param levels 目标等级
 * @returns 技能行
 */
export function gsSkillViews(skills: readonly GsSkillRaw[], levels: readonly number[]): CalcSkill[] {
  return skills.map((one, idx) => {
    const current = Number(one.level_current) || 0
    return {
      name: String(one.name ?? ""),
      icon: String(one.icon ?? ""),
      current,
      target: Number(levels[idx + 2] ?? current) || current,
      max: Number(one.max_level) || 10
    }
  })
}

/**
 * 星铁的行迹行
 *
 * 展示名由 `anchor` 折算，认不出的一律叫「天赋」—— 那是模板里 `{{else}}` 的那一支。
 * @param skills 行迹表
 * @param levels 目标等级
 * @returns 行迹行
 */
export function srSkillViews(skills: readonly SrSkillRaw[], levels: readonly number[]): CalcSkill[] {
  return skills.map((one, idx) => {
    const current = Number(one.cur_level) || 0
    return {
      name: SR_ANCHOR[String(one.anchor ?? "")] ?? "天赋",
      icon: String(one.item_url ?? ""),
      current,
      target: Number(levels[idx + 2] ?? one.target_level ?? current) || current,
      max: Number(one.max_level) || 0
    }
  })
}

/** 图上的角色一栏 */
export interface CalcChar {
  /** 角色名 */
  name: string
  /**
   * 头像
   *
   * 三种来源，模板按前缀挑根：`meta-` 开头的在元数据里、`http` 开头的是米游社给的绝对地址、
   * 其余的在插件资源里。**混了根不报错，只是那一格空白**，见 templates 里的说明。
   */
  face: string
  /** 当前等级 */
  level: number
  /** 目标等级 */
  target: number
  /** 星级，决定底框 */
  star: number
  /** 命座 / 星魂数 */
  cons: number
}

/** 图上的武器 / 光锥一栏 */
export interface CalcEquipView {
  /** 武器名 */
  name: string
  /** 图标绝对地址 */
  icon: string
  /** 星级 */
  star: number
  /** 当前等级 */
  level: number
  /** 目标等级 */
  target: number
}

/** 造养成计算视图要的东西 */
export interface CalculatorInput {
  /** 游戏 */
  game: MysCalcGame
  /** 游戏 uid */
  uid: string
  /** 角色一栏 */
  char: CalcChar
  /** 武器 / 光锥一栏；没有已装备的则省略 */
  equip?: CalcEquipView
  /** 技能行 */
  skills: readonly CalcSkill[]
  /** 分组键 → 消耗清单，由 {@link flattenGsConsume} / {@link flattenSrConsume} 给出 */
  consume: Readonly<Record<string, readonly CalcConsume[]>>
}

/** 两个游戏的三个分组键各不相同，且天赋那一节的标题也不同 */
const GROUPS: Readonly<Record<MysCalcGame, { avatar: string; skill: string; equip: string; title: string }>> = {
  gs: { avatar: "avatar_consume", skill: "avatar_skill_consume", equip: "weapon_consume", title: "天赋消耗" },
  sr: { avatar: "avatar_consume", skill: "skill_consume", equip: "equipment_consume", title: "行迹消耗" },
  zzz: { avatar: "avatar_consume", skill: "skill_consume", equip: "weapon_consume", title: "技能消耗" }
}

/** 养成计算的视图 */
export interface CalculatorView extends Record<string, unknown> {
  /** 游戏 */
  game: MysCalcGame
  /** 游戏 uid */
  uid: string
  /**
   * 角色一栏
   *
   * **键名不能叫 `char`。** 模板引擎按 JS 保留字过滤要声明的变量，而它用的那张表含 ES3 的
   * 未来保留字（`char` / `int` / `final` 一族），故名为 `char` 的顶层键永远不会被绑定 ——
   * 表现是渲染时抛 `char is not defined`，这条命令于是永远只回文字。
   */
  role: CalcChar
  /** 武器 / 光锥一栏 */
  equip?: CalcEquipView
  /** 技能行 */
  skills: readonly CalcSkill[]
  /** 突破消耗 */
  avatarConsume: readonly CalcConsume[]
  /** 天赋 / 行迹消耗 */
  skillConsume: readonly CalcConsume[]
  /** 武器 / 光锥消耗 */
  equipConsume: readonly CalcConsume[]
  /** 天赋那一节的标题 */
  skillTitle: string
  /** 三节都空 —— 模板据它出「毕业了，下一位 ！」 */
  done: boolean
}

/**
 * 造养成计算视图
 * @param input 输入
 * @returns 视图
 */
export function buildCalculator(input: CalculatorInput): CalculatorView {
  const keys = GROUPS[input.game]
  const avatarConsume = input.consume[keys.avatar] ?? []
  const skillConsume = input.consume[keys.skill] ?? []
  const equipConsume = input.consume[keys.equip] ?? []
  return {
    game: input.game,
    uid: input.uid,
    role: input.char,
    ...(input.equip ? { equip: input.equip } : {}),
    skills: input.skills,
    avatarConsume,
    skillConsume,
    equipConsume,
    skillTitle: keys.title,
    done: avatarConsume.length + skillConsume.length + equipConsume.length === 0
  }
}

/** 绝区零技能的接口编号 → 计算器参数位次（第三个参数起）与展示名；次序即游戏内技能页次序 */
export const ZZZ_CALC_SKILLS: readonly { type: number; name: string }[] = [
  { type: 0, name: "普通攻击" },
  { type: 1, name: "特殊技" },
  { type: 2, name: "闪避" },
  { type: 6, name: "连携技" },
  { type: 5, name: "核心技" },
  { type: 3, name: "支援技" }
]

/** 绝区零 `batch_avatar_detail_v2` 里一位代理人，只列计算器要的 */
export interface ZzzCultivateAvatar {
  /** 代理人本体 */
  avatar?: {
    /** id */
    id?: number
    /** 等级 */
    level?: number
    /** 突破阶 */
    promotes?: number
    /** 影画数，技能等级里含影画加成、要按它扣回 */
    rank?: number
    /** 是否已拥有 */
    unlock?: boolean
    /** 逐技能 */
    skills?: { skill_type?: number; level?: number }[]
  }
  /** 已装备音擎 */
  weapon?: { id?: number; name?: string; level?: number; promotes?: number; rarity?: string; icon?: string }
}

/**
 * 绝区零的计算请求体
 *
 * **接口给的技能等级含影画加成**（三影 +2、五影 +4，核心技不加），请求体要的是原始等级，故按影画扣回；目标等级超上限一律压回。
 * @param got 当前练度
 * @param id 代理人 id
 * @param levels 目标等级，次序见 LEVEL_CAPS.zzz
 * @returns 请求体
 */
export function zzzCalcBody(got: ZzzCultivateAvatar | undefined, id: string, levels: readonly number[]): Record<string, unknown> {
  const a = got?.avatar ?? {}
  const owned = !!a.unlock
  const extra = (a.rank ?? 0) >= 5 ? 4 : (a.rank ?? 0) >= 3 ? 2 : 0
  const cur = new Map((a.skills ?? []).map(one => [Number(one.skill_type), Number(one.level) || 1]))
  const skills = ZZZ_CALC_SKILLS.map((one, at) => {
    const raw = owned ? (cur.get(one.type) ?? 1) : 1
    const init = one.type === 5 ? raw : Math.max(1, Math.min(12, raw - extra))
    return { skill_type: one.type, level: Math.max(init, Number(levels[at + 2]) || init), init_level: init }
  })
  const w = got?.weapon
  return {
    avatar_id: Number(id),
    avatar_level: Number(levels[0]) || 60,
    avatar_current_level: owned ? Number(a.level) || 1 : 1,
    avatar_current_promotes: owned ? Number(a.promotes) || 0 : 0,
    skills,
    ...(w?.id
      ? { weapon_info: { weapon_id: w.id, weapon_level: Number(levels[1]) || 60, weapon_promotes: Number(w.promotes) || 0, weapon_init_level: Number(w.level) || 1 } }
      : {})
  }
}

/**
 * 绝区零的技能行
 * @param body {@link zzzCalcBody} 拼好的请求体
 * @param icons 技能展示名 → 图标（元数据）
 * @returns 技能行
 */
export function zzzSkillViews(body: Record<string, unknown>, icons: Readonly<Record<string, string>> = {}): CalcSkill[] {
  const skills = (body["skills"] as { skill_type: number; level: number; init_level: number }[] | undefined) ?? []
  return skills.map(one => {
    const name = ZZZ_CALC_SKILLS.find(it => it.type === one.skill_type)?.name ?? "技能"
    return { name, icon: icons[name] ?? "", current: one.init_level, target: one.level, max: one.skill_type === 5 ? 7 : 12 }
  })
}

/**
 * 绝区零的消耗清单
 *
 * 接口只给 `{id, cnt}`，名字与图标按 id 查元数据材料表（丁尼是 id 10，也在表里）。查不到的那一项照样列出、只是没有图（宁可多一行也不漏一样材料）。
 * @param raw 接口返回
 * @param itemOf 按材料 id 查名字与图标
 * @returns 分组键 → 消耗清单
 */
export function flattenZzzConsume(
  raw: unknown,
  itemOf: (id: string) => { name: string; icon: string } | undefined
): Record<string, CalcConsume[]> {
  const out: Record<string, CalcConsume[]> = {}
  const got = (raw ?? {}) as Record<string, { id?: number | string; cnt?: number }[] | undefined>
  for (const key of ["avatar_consume", "skill_consume", "weapon_consume"]) {
    out[key] = (got[key] ?? [])
      .filter(one => Number(one.cnt) > 0)
      .map(one => {
        const id = String(one.id ?? "")
        const item = itemOf(id)
        return { name: item?.name ?? (id === "10" ? "丁尼" : `材料 ${id}`), icon: item?.icon ?? "", num: calcNum(one.cnt) }
      })
  }
  return out
}

/**
 * 无渲染器时的文字形态
 * @param view 视图
 * @returns 文案
 */
export function calculatorText(view: CalculatorView): string {
  const line = (one: CalcConsume): string =>
    `${INDENT}${one.name} x ${one.num}${one.lack !== undefined && one.lack !== "0" ? `（缺 ${one.lack}）` : ""}`
  const lines = [
    `${view.role.name} 养成计算${INDENT}uid ${view.uid}`,
    `角色${INDENT}Lv.${view.role.level} → Lv.${view.role.target}`
  ]
  if (view.equip) lines.push(`${view.equip.name}${INDENT}Lv.${view.equip.level} → Lv.${view.equip.target}`)
  for (const one of view.skills) lines.push(`${one.name}${INDENT}${one.current} → ${one.target}`)
  if (view.done) {
    lines.push("毕业了，下一位 ！")
    return lines.join("\n")
  }
  if (view.avatarConsume.length > 0) lines.push("【角色消耗】", ...view.avatarConsume.map(line))
  if (view.skillConsume.length > 0) lines.push(`【${view.skillTitle}】`, ...view.skillConsume.map(line))
  if (view.equipConsume.length > 0) lines.push("【武器消耗】", ...view.equipConsume.map(line))
  return lines.join("\n")
}

/** 尘歌壶模数的视图 */
export interface BlueprintView extends Record<string, unknown> {
  /** 游戏 uid */
  uid: string
  /** 模数分享码 */
  code: string
  /** 这套图纸要用到的模具 */
  molds: readonly CalcConsume[]
  /** 摆出这些模具要的材料 */
  consume: readonly CalcConsume[]
}

/**
 * 从模数详情里拼计算请求体
 * @param raw `blueprint` 接口返回的 data
 * @returns 请求体；这份模数一件模具都没有时 undefined
 */
export function blueprintBody(raw: unknown): Record<string, unknown> | undefined {
  const list = (raw as { list?: unknown })?.list
  if (!Array.isArray(list) || list.length === 0) return undefined
  return {
    list: list.map(one => {
      const item = one as { id?: unknown; num?: unknown }
      return { cnt: Number(item.num) || 0, id: Number(item.id) || 0 }
    })
  }
}

/**
 * 造尘歌壶模数视图
 *
 * **数量不做万位折算**，理由见文件头。
 * @param o 输入
 * @returns 视图
 */
export function buildBlueprint(o: { uid: string; code: string; blueprint: unknown; computes: unknown }): BlueprintView {
  const raw = (o.blueprint as { list?: unknown })?.list
  const molds = (Array.isArray(raw) ? raw : []).map(one => {
    const item = one as { name?: unknown; icon_url?: unknown; num?: unknown }
    return { name: String(item.name ?? ""), icon: String(item.icon_url ?? ""), num: String(item.num ?? 0) }
  })
  const list = Array.isArray(o.computes) ? o.computes : []
  const consume = list.map(one => {
    const item = one as { name?: unknown; icon?: unknown; num?: unknown }
    return { name: String(item.name ?? ""), icon: String(item.icon ?? ""), num: String(item.num ?? 0) }
  })
  return { uid: o.uid, code: o.code, molds, consume }
}

/**
 * 无渲染器时的文字形态
 * @param view 视图
 * @returns 文案
 */
export function blueprintText(view: BlueprintView): string {
  const line = (one: CalcConsume): string => `${INDENT}${one.name} x ${one.num}`
  const lines = [`尘歌壶模数 ${view.code}${INDENT}uid ${view.uid}`]
  if (view.molds.length > 0) lines.push("【所需模具】", ...view.molds.map(line))
  if (view.consume.length > 0) lines.push("【所需消耗】", ...view.consume.map(line))
  if (view.molds.length === 0 && view.consume.length === 0) lines.push("这份模数里没有任何模具")
  return lines.join("\n")
}
