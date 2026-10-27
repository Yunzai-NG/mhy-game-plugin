/**
 * 模块职责：`#老婆` 一族 —— 从名下角色里挑一位出卡片，可指定、可随机
 * 依赖方向：依赖 session / meta/extra-parse 的四类名单 / views/char-card 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：与角色卡片共用一张图（`character/character-card`）。
 *
 *          四类名单来自元数据（`character/extra.js` 的 `wifeCfg`）。原神与星铁都有这份表，
 *          绝区零那份包里没有，故这一族对它只回一句说明。
 *
 *          **设置的那一份按游戏与名单键存**：原神的老婆与星铁的老婆是两个人；「老婆」与「女朋友」同属 `girlfriend`，
 *          设的是同一份。
 *
 *          只认名下已有的角色：名单与面板数据的交集才是可挑的。交集为空时说明的是"去更新面板"。
 */
import type { Session } from "../core/session.js"
import type { WifeKey } from "../meta/extra-parse.js"
import type { MhyDeps } from "./deps.js"
import { charCardOf } from "./char-card.js"

/** 「随机」这一档存进库里时用的记号，与任何角色名都不会重合 */
const ANY_MARK = "随机"

/** 一类关系的叫法与它对应的名单键 */
interface Relation {
  /** 名单键 */
  key: WifeKey
  /** 认得的叫法，第一个用作回复里的自称 */
  words: readonly string[]
}

/**
 * 六种叫法归到四类名单
 *
 * 「女朋友」与「老婆」查同一份名单（`girlfriend`），设置也是同一份。
 */
export const RELATIONS: readonly Relation[] = [
  { key: "girlfriend", words: ["老婆", "媳妇", "妻子", "娘子"] },
  { key: "girlfriend", words: ["女朋友", "女友", "女神"] },
  { key: "boyfriend", words: ["老公", "丈夫", "夫君", "郎君"] },
  { key: "boyfriend", words: ["男朋友", "男友", "男神"] },
  { key: "daughter", words: ["女儿", "闺女"] },
  { key: "son", words: ["儿子", "犬子"] }
]

/** 认作"要设置"的动作词 */
const SET_WORDS = /^(?:设置|选择|指定|添加|挑选)/

/** 认作"要查看设置了谁"的动作词 */
const LIST_WORDS = /^(?:列表|是谁|是)/

/** 认作"随便挑一个"的指定值 */
const ANY_WORDS = new Set(["全部", "任意", "随机", "全都要"])

/** 只有这两个游戏的元数据里有四类名单 */
const WIFE_GAMES: readonly string[] = ["gs", "sr"]

/**
 * 认出这条消息说的是哪一类关系、要做什么
 *
 * `s.rest` 形如「」（出卡片）、「设置胡桃,刻晴」、「列表」。
 * @param text 命令原文，已剥掉 `#` 与游戏前缀
 * @returns 关系、动作与参数；认不出关系时 undefined
 */
export function parseWife(text: string): { rel: Relation; action: "card" | "set" | "list"; param: string } | undefined {
  // 长的叫法必须先试：「女朋友」与「女儿」都含「女」，短的先匹配会认错
  const all = [...RELATIONS].sort((a, b) => Math.max(...b.words.map(w => w.length)) - Math.max(...a.words.map(w => w.length)))
  for (const rel of all) {
    const hit = [...rel.words].sort((a, b) => b.length - a.length).find(word => text.startsWith(word))
    if (!hit) continue
    const rest = text.slice(hit.length).trim()
    if (SET_WORDS.test(rest)) return { rel, action: "set", param: rest.replace(SET_WORDS, "").trim() }
    if (LIST_WORDS.test(rest)) return { rel, action: "list", param: "" }
    return { rel, action: "card", param: "" }
  }
  return undefined
}

/**
 * 把使用者写的一串名字切开，认全角逗号与顿号
 * @param text 形如 `胡桃、刻晴，甘雨`
 * @returns 名字
 */
export function splitWanted(text: string): string[] {
  return text
    .split(/[,，、;；\s]+/)
    .map(one => one.trim())
    .filter(one => one.length > 0)
}

/**
 * `#老婆` 一族
 * @param s 会话
 * @param deps 依赖
 */
export async function wifeCard(s: Session, deps: MhyDeps): Promise<void> {
  const got = parseWife(s.rest.trim())
  if (!got) {
    await s.text(`没认出你说的是哪一类，可发送「${RELATIONS[0]?.words[0] ?? "老婆"}」看卡片`)
    return
  }
  const { rel, action, param } = got
  const self = rel.words[0] ?? "老婆"

  if (!WIFE_GAMES.includes(s.game)) {
    await s.text(`${self}这一族只有原神与星穹铁道有，绝区零的元数据里没有这份名单`)
    return
  }
  const game = s.game
  const loader = deps.meta?.loader
  if (!loader?.ready(game)) {
    await s.text("这条命令要用角色数据，请先让主人发送「#更新元数据」")
    return
  }

  const allowed = deps.wife?.get(game, rel.key) ?? []
  if (allowed.length === 0) {
    // 名单文件早先不在落盘白名单里，增量包只带改过的文件、补不回它，故要强制重下完整包
    await s.text(`元数据里没有${self}的可选名单，请让主人发送「#更新元数据强制」重下完整包`)
    return
  }

  const store = deps.wifePick

  if (action === "list") {
    const saved = await store?.get(s.user, game, rel.key)
    if (!saved || saved.length === 0) {
      await s.text(`你还没设置过${self}，发送「#${self}设置胡桃」即可，多位用逗号隔开`)
      return
    }
    await s.text(saved[0] === "随机" ? `你的${self}是：从名下角色里随机挑` : `你的${self}是：${saved.join("、")}`)
    return
  }

  if (action === "set") {
    if (!param) {
      await s.text(`要设置成谁？如「#${self}设置胡桃」，多位用逗号隔开，也可写「随机」`)
      return
    }
    const wanted = splitWanted(param)
    if (wanted.some(one => ANY_WORDS.has(one))) {
      await store?.set(s.user, game, rel.key, [ANY_MARK])
      await s.text(`${self}已设为：从名下角色里随机挑`)
      return
    }
    // 先查元数据认成正式名（存得下别名），再与名单求交集（免得存进去却挑不出来）
    const names: string[] = []
    const rejected: string[] = []
    for (const one of wanted) {
      const item = loader.byName(game, one)
      const name = item?.name
      if (name && allowed.includes(name)) names.push(name)
      else rejected.push(one)
    }
    if (names.length === 0) {
      await s.text(`${rejected.join("、")} 不在${self}的可选名单里`)
      return
    }
    // 与已有的合并而不是覆盖：「添加」与「设置」在通行口径里是同一条路
    const before = (await store?.get(s.user, game, rel.key)) ?? []
    const merged = [...new Set([...before.filter(one => one !== ANY_MARK), ...names])]
    await store?.set(s.user, game, rel.key, merged)
    const tail = rejected.length > 0 ? `（${rejected.join("、")} 不在名单里，已跳过）` : ""
    await s.text(`${self}已设置：${merged.join("、")}${tail}`)
    return
  }

  // action === "card"：设置过就只从那几位里挑，否则从整份名单里挑
  const saved = await store?.get(s.user, game, rel.key)
  const fixed = saved !== undefined && saved.length > 0 && saved[0] !== ANY_MARK
  const pick = await pickOwned(s, deps, fixed ? saved : allowed)
  if (!pick) {
    await s.text(
      fixed
        ? `你设置的${self}还没有面板数据，发送「#更新面板」取一次`
        : `名下还没有可作${self}的角色，发送「#更新面板」把角色取回来`
    )
    return
  }
  await charCardOf(s, deps, pick)
}

/**
 * 从候选里挑一位名下已有面板数据的角色
 * @param s 会话
 * @param deps 依赖
 * @param pool 候选角色名
 * @returns 挑中的角色名；一位都没有时 undefined
 */
async function pickOwned(s: Session, deps: MhyDeps, pool: readonly string[]): Promise<string | undefined> {
  const game = s.game
  const loader = deps.meta?.loader
  const uid = (await deps.users.uid(s.user, game)) || ""
  if (!uid || !loader) return undefined

  const stored = await deps.panels?.of(s.user).load(game, uid)
  const owned = new Set(Object.keys(stored?.avatars ?? {}))
  if (owned.size === 0) return undefined

  const have = pool.filter(name => {
    const id = loader.byName(game, name)?.id
    return id !== undefined && owned.has(String(id))
  })
  if (have.length === 0) return undefined
  return have[Math.floor(Math.random() * have.length)]
}
