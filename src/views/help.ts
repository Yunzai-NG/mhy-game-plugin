/**
 * 模块职责：主帮助图（`#帮助` / `*帮助` / `%帮助`）的视图模型 —— 按区块印目录里这个游戏能用的命令
 * 依赖方向：依赖 commands/catalog 的目录、core/region 的游戏常量与 views/help-emoji 的图池；纯函数
 * 生命周期：无状态
 * 注意事项：**哪条可见由调用方判**（{@link HelpAudience.visible}：命令表那条的开关与额外配置），这里只按
 *          身份收起「群管理」「主人」两块 —— 普通人看到一堆用不了的命令只会去试、然后被拒。
 *          区块图标一块一张、从该游戏的表情包里按关键字挑，挑不到按区块键散列，故同一块恒是同一张。
 */
import type { GameKey } from "../core/region.js"
import { GAME_NAMES, SHORT_PREFIX } from "../core/region.js"
import type { CatalogItem, CatalogSection } from "../commands/catalog.js"
import { GUIDES, catalogOf, inGame } from "../commands/catalog.js"
import type { EmojiPack } from "./help-emoji.js"
import { EMOJI_DIR, EMOJI_POOL } from "./help-emoji.js"

/** 吉祥物与指引图标所在目录，相对 `_res_path` */
export const ICON_DIR = "help/icons/"

/** 各游戏的主题强调色：原神金、星铁蓝紫、绝区零荧光黄绿 */
export const GAME_ACCENT: Readonly<Record<GameKey, { main: string; soft: string }>> = {
  gs: { main: "#ffcf4b", soft: "#ff9d3d" },
  sr: { main: "#8b9cff", soft: "#c98bff" },
  zzz: { main: "#c5f23b", soft: "#38e0d0" }
}

/** 区块图标的挑图关键字，按贴题程度排 */
const SECTION_ICON: Readonly<Record<string, readonly string[]>> = {
  account: ["举牌", "收到", "OK"],
  daily: ["困", "瞌睡", "哈欠", "睡"],
  battle: ["重拳", "战斗", "挑战", "一拳"],
  panel: ["满足", "得意", "自拍"],
  gacha: ["脱非", "入欧", "撒钱", "招财"],
  wiki: ["博学", "看书", "学习"],
  sign: ["好耶", "加油", "收到"],
  admin: ["记笔记", "记录", "计算"],
  master: ["修理", "工作", "计算"]
}

/** 与游戏无关的那几块用米游姬的图 */
const MYS_SECTIONS = new Set(["account", "sign", "admin", "master"])

/**
 * 字符串 → 非负整数；只要「同一个键恒取同一张」
 * @param text 键
 * @returns 散列值
 */
function hashOf(text: string): number {
  let out = 0
  for (let i = 0; i < text.length; i += 1) out = (out * 31 + text.charCodeAt(i)) % 0x7fffffff
  return out
}

/**
 * 给一个区块挑图
 * @param key 区块键
 * @param game 游戏
 * @returns 相对 `_res_path` 的路径；图池为空时用通用图标
 */
function sectionIcon(key: string, game: GameKey): string {
  const pack: EmojiPack = MYS_SECTIONS.has(key) ? "mys" : game
  const pool = EMOJI_POOL[pack]
  if (pool.length === 0) return `${ICON_DIR}other.png`
  const hit = (SECTION_ICON[key] ?? []).map(k => pool.find(name => name.includes(k))).find(Boolean)
  return `${EMOJI_DIR}${pack}/${hit ?? pool[hashOf(key) % pool.length]}`
}

/** 帮助图里的一条 */
export interface HelpItem {
  /** 带记号的命令，如 `*青雀面板` */
  cmd: string
  /** 说明 */
  desc: string
  /** 角标：`私聊` / `主人` / `群管`；没有即空串 */
  tag: string
}

/** 帮助图里的一块 */
export interface HelpSection {
  /** 区块名 */
  name: string
  /** 一句话前提 */
  note: string
  /** 区块图标，相对 `_res_path` */
  icon: string
  /** 逐条 */
  items: HelpItem[]
}

/** 主帮助图的数据 */
export interface HelpView {
  /** 游戏，皮肤按它取 */
  game: GameKey
  /** 主标题 */
  title: string
  /** 副标题 */
  subtitle: string
  /** 左上角记号 */
  hash: string
  /** 吉祥物图，相对 `_res_path` */
  hero: string
  /** 主题强调色 */
  accent: string
  /** 次强调色 */
  accentSoft: string
  /** 新使用者的三步 */
  start: { cmd: string; desc: string }[]
  /** 逐块 */
  sections: HelpSection[]
  /** 底部那排细分帮助 */
  guides: { cmd: string; desc: string }[]
  /** 页脚提示 */
  tips: string[]
  /** 印出来的命令条数 */
  total: number
  /** 被主人关掉、故没印的条数 */
  hidden: number
}

/** 谁在看这张帮助 */
export interface HelpAudience {
  /** 是主人 */
  isMaster: boolean
  /** 是群管理（主人另算） */
  isAdmin: boolean
  /** 这一条眼下能不能用（命令表开关与额外配置）；不给即一律可用 */
  visible?: (item: CatalogItem) => boolean
}

/** 角标文字 */
const TAG: Readonly<Record<string, string>> = { master: "主人", admin: "群管" }

/**
 * 一块对这个人可不可见
 * @param sec 区块
 * @param who 看的人
 * @returns 可见为真
 */
function sectionOpen(sec: CatalogSection, who: HelpAudience): boolean {
  if (sec.role === "master") return who.isMaster
  if (sec.role === "admin") return who.isMaster || who.isAdmin
  return true
}

/**
 * 造主帮助图的数据
 * @param game 游戏
 * @param who 看的人
 * @returns 帮助视图
 */
export function buildHelp(game: GameKey, who: HelpAudience): HelpView {
  const p = SHORT_PREFIX[game]
  let hidden = 0
  const sections: HelpSection[] = []
  for (const sec of catalogOf(game)) {
    if (!sectionOpen(sec, who)) continue
    const items: HelpItem[] = []
    for (const one of sec.items) {
      if (who.visible && !who.visible(one)) {
        hidden += 1
        continue
      }
      // 整块都是主人 / 群管理的命令时角标是多余的，只在混在别处时才打
      const role = one.role && one.role !== sec.role ? (TAG[one.role] ?? "") : ""
      items.push({ cmd: `${p}${inGame(one.word, game)}`, desc: inGame(one.desc, game), tag: one.private ? "私聊" : role })
    }
    if (items.length) sections.push({ name: sec.name, note: inGame(sec.note, game), icon: sectionIcon(sec.key, game), items })
  }

  const others = (["gs", "sr", "zzz"] as const).filter(one => one !== game)
  const accent = GAME_ACCENT[game]
  return {
    game,
    title: `${GAME_NAMES[game]}帮助`,
    subtitle: "米游社查询 · 角色面板 · 抽卡记录 · 图鉴",
    hash: p,
    hero: `${ICON_DIR}hero-${game}.png`,
    accent: accent.main,
    accentSoft: accent.soft,
    start: [
      { cmd: `${p}扫码登录`, desc: "绑好账号" },
      { cmd: `${p}更新面板`, desc: "取一次面板" },
      { cmd: `${p}体力`, desc: "试一条查询" }
    ],
    sections,
    guides: GUIDES.map(one => ({ cmd: `${p}${one.word}`, desc: one.desc })),
    tips: [
      `其他游戏换记号：${others.map(one => `${GAME_NAMES[one]}「${SHORT_PREFIX[one]}帮助」`).join("、")}`,
      "角色名写简称也认得，如「雷神」「三月」"
    ],
    total: sections.reduce((sum, one) => sum + one.items.length, 0),
    hidden
  }
}

/**
 * 出不了图时的文字版
 * @param view 帮助视图
 * @returns 多行文本
 */
export function helpText(view: HelpView): string {
  const lines = [view.title, `新手三步：${view.start.map(one => one.cmd).join(" → ")}`]
  for (const sec of view.sections) {
    lines.push(`【${sec.name}】${sec.note}`)
    for (const one of sec.items) lines.push(`${one.cmd}${one.tag ? `（${one.tag}）` : ""} —— ${one.desc}`)
  }
  lines.push(`细分帮助：${view.guides.map(one => one.cmd).join(" ")}`)
  lines.push(...view.tips)
  if (view.hidden) lines.push(`另有 ${view.hidden} 项已被主人关闭`)
  return lines.join("\n")
}
