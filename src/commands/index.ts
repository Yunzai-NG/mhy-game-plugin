/**
 * 模块职责：把命令挂到内核 —— 游戏前缀中间件 + 全部命令注册 + 帮助
 * 依赖方向：依赖类型包的 `PluginContext` / `MessageEvent` 契约与本插件的 commands/*、session
 * 生命周期：`setup` 中调用一次；注销由内核按插件统一回收，本模块无需自行记录
 * 注意事项：命令表是**数据**（{@link MHY_COMMANDS}），按游戏分四块（判据 {@link MhyCommandSpec.game}，
 *          它也决定帮助印哪个前缀）。前缀由 {@link COMMAND_PREFIX} 自动补齐：写一次 `体力` 即同时有
 *          `#体力` / `#星铁体力` / `#绝区零体力`，`*体力` 一类简写由 {@link applyGame} 规整。
 *          **功能开关在表里（{@link MhyCommandSpec.gate}）且在分发时判**，故改配置即生效。关掉后
 *          普通命令明说被主人关了，而"名字在触发词之前"的那几条（`priority >= 800`）**静默退出** ——
 *          它们过一遍每条 `#` 开头的消息，出声等于把所有笔误都变成一句报错。
 */
import type { CommandOptions, CommandPattern, MessageEvent, PluginContext } from "@yunzai-ng/types"
import type { MhyConfigView } from "../config.js"
import { withCaptchaNotice } from "../core/captcha.js"
import type { GameKey } from "../core/region.js"
import { COMMAND_PREFIX, GAME_KEYS, detectGame } from "../core/region.js"
import { buildHelp, helpText } from "../views/help.js"
import type { GuideView } from "../views/guide.js"
import { buildGachaGuide, buildPanelGuide, guideText } from "../views/guide.js"
import { buildBindGuide, buildRankGuide } from "../views/guide-extra.js"
import type { CatalogItem } from "./catalog.js"
import { inGame } from "./catalog.js"
import type { Session } from "../core/session.js"
import { GAME_STATE_KEY, sessionOf } from "../core/session.js"
import { summarize, withTrace } from "../core/trace.js"
import { abyss } from "./abyss.js"
import { abyssPct } from "./abyss-pct.js"
import { dropDeadCk, resetCkCache, userStat } from "./admin.js"
import { calendar } from "./calendar.js"
import { blueprint, calculatorHelp, charCalculator } from "./calculator.js"
import { useCdk } from "./cdk.js"
// 专属命令走各自目录的 `index.ts`，不逐文件深引
import { charMaster, gcgCards, gcgDeck, hardChallenge, roleCombat, tarotCards, todayMaterial } from "./gs/index.js"
import { challengeBoss, challengePeak, challengeStory, currencyWar, rogueList, unknowableDomain } from "./sr/index.js"
import {
  buddyList,
  zzzDeadly,
  zzzDefense,
  zzzExplore,
  zzzGarden,
  zzzHollowHelp,
  zzzHolo,
  zzzLost,
  zzzTower,
  zzzVoid,
  zzzZenkovEntry
} from "./zzz/index.js"
import { bindCk, ckCode, ckHelp, ckPool, ckStatus, deleteCk } from "./ck.js"
import type { MhyDeps } from "./deps.js"
import { bindDevice, deviceInfo, unbindDevice } from "./device.js"
import { dropGachaLink, gachaLink, gachaUpdate } from "./gacha.js"
import { bannerStat, gachaDetail, gachaStat } from "./gacha-stat.js"
import { exportGacha, importGacha } from "./uigf.js"
import { ledger } from "./ledger.js"
import { metaStatus, updateMeta } from "./meta.js"
import { noteOrRemind } from "./note.js"
import { actCalendar } from "./act-calendar.js"
import { qrLogin } from "./qr-login.js"
import { refreshCk } from "./refresh-ck.js"
import { liveCode } from "./live-code.js"
import { bbsSignNow, coinStatus, signNow, signStatus, toggleAutoSign } from "./sign.js"
import { charCard } from "./char-card.js"
import { wifeCard } from "./wife.js"
import { panelChange } from "./change.js"
import { charMaterialImg } from "./material-img.js"
import { charStrategy, setStrategy, strategyHelp } from "./strategy.js"
import { charCons, charMaterial, charPic, charTalent, charWiki } from "./wiki.js"
import { artisEntry, charDmg, delPanel, mysRefreshPanel, panelEntry, panelStat, refreshPanel, refreshPanelEntry, refreshTalent, topPanel } from "./panel.js"
import { delPanelImg, listPanelImg, uploadPanelImg } from "./panel-img.js"
import { originalPic } from "./original.js"
import { charRank, refreshRank, resetRank, toggleRank } from "./rank.js"
import { achieveList, chestList, roleExplore, weaponList } from "./player.js"
import { avatarList, profileCard } from "./profile.js"
import { bindUid, deleteUid, myUid, switchUid } from "./uid.js"
import { whoOf } from "./_face.js"

/** 查询类命令的冷却 —— 用于拦截连续触发，同时不影响正常使用 */
const QUERY_CD = "5s"

/** 一条命令的声明 */
export interface MhyCommandSpec {
  /** 触发词，注册时自动补上三个游戏前缀；**可以为空**，此时须由 {@link extra} 给出正则 */
  words: readonly string[]
  /** 额外的正则触发式，用于"月份位于触发词之前"一类形态 */
  extra?: readonly RegExp[]
  /**
   * 收尾方式：触发词之后还能跟什么
   *
   * 缺省 `prefix`，即内核的字符串前缀匹配 —— 触发词之后的任意内容都接，进 `rest`。
   * 带参数的命令（`#胡桃换钟离武器`）要它。
   *
   * **`uid` 表示"要么光一个词、要么词 + uid"**：注册时把每个触发词换成
   * `^#<游戏>?<词>(?:\s*<uid>)?$` 的锚定正则。不收口的那些命令会把
   * `#面板发这个` 也当成自己的（`rest` 变成「发这个」），而使用者看到的是一句莫名其妙的回话。
   * uid 位数按游戏分：原神星铁 9~10 位，绝区零 8~10 位。
   */
  tail?: "prefix" | "uid"
  /** 帮助里代替触发词的那个示例，仅当 {@link words} 为空时用得上 */
  helpWord?: string
  /** 帮助里的说明 */
  desc: string
  /** 帮助里的分组 */
  group: string
  /**
   * 这条命令只对哪一个游戏成立
   *
   * **仅在只对一个游戏成立时给**：它定这条命令在表中归哪一块、帮助里印哪个前缀。
   * **不据此收窄注册的前缀** —— `#模拟宇宙` 仍要注册得出来，好回一句「只有星穹铁道有」。
   */
  game?: GameKey
  /** 处理函数 */
  handler: (s: Session, deps: MhyDeps) => Promise<void>
  /** 这条命令的功能开关，返回假即不执行；不给表示恒可用 */
  gate?: (config: MhyConfigView) => boolean
  /**
   * 被 {@link gate} 关掉时说的那句话
   *
   * 不给表示静默退出 —— 「名字在触发词之前」的那几条（`priority >= 800`）必须如此。
   */
  offText?: string
  /** 改写 `rest` 的取法；触发词本身携带参数（如 `#上期深渊`）时以其补回 */
  rest?: (e: MessageEvent) => string
  /** 附加的命令选项 */
  opts?: CommandOptions
}

/**
 * 一条目录条目眼下能不能用：命令表里那条的开关，加上条目自己要的那项配置
 *
 * 按 `spec`（或示例词本身）找命令表那条；找不到就当可用 —— 对账测试保证每条都找得到。
 * @param one 目录条目
 * @param game 游戏
 * @param config 当前配置
 * @returns 可用为真
 */
export function catalogVisible(one: CatalogItem, game: GameKey, config: MhyConfigView): boolean {
  if (one.needs && !config[one.needs]) return false
  const word = one.spec ?? inGame(one.word, game)
  const spec = MHY_COMMANDS.find(c => c.words.includes(word))
  return spec?.gate ? spec.gate(config) : true
}

/**
 * `#帮助` —— 按当前游戏、当前这个人出主帮助
 * @param s 会话
 * @param deps 依赖
 */
async function mainHelp(s: Session, deps: MhyDeps): Promise<void> {
  const config = deps.config()
  const view = buildHelp(s.game, {
    isMaster: s.isMaster,
    isAdmin: s.isGroupAdmin,
    visible: one => catalogVisible(one, s.game, config)
  })
  if (await s.image("help", view as unknown as Record<string, unknown>)) return
  await s.text(helpText(view))
}

/**
 * 造一个出细分帮助的处理函数
 * @param build 按游戏造视图
 * @returns 处理函数
 */
function guideCmd(build: (game: GameKey) => GuideView): MhyCommandSpec["handler"] {
  return async (s: Session): Promise<void> => {
    const view = build(s.game)
    if (await s.image("help-guide", view as unknown as Record<string, unknown>)) return
    await s.text(guideText(view))
  }
}

/**
 * 规整后前缀里"游戏名"那一段的可选组，形如 `(?:星铁|绝区零)?`
 *
 * **由 {@link COMMAND_PREFIX} 派生，不手抄** —— 手抄的那份会与 `detectGame` 认得的前缀
 * 各自漂移，表现是命令触发了却按错游戏执行，且不报错。原神那一档是空串，由 `?` 表达。
 */
const GAME_ALT = `(?:${GAME_KEYS.filter(game => game !== "gs")
  .map(game => COMMAND_PREFIX[game].replace(/^#/, ""))
  .join("|")})?`

/**
 * 拼一条 extra 触发式
 *
 * 只负责前缀那一段。**调用方一律用 `String.raw` 写正则体** —— 否则 `\s` `\d` 要双写成
 * `\\s` `\\d`，漏一个不报错、只是那条命令再也触发不了。
 * @param body 正则体，不含首尾的 `^#<游戏名>?` 与 `$`
 * @returns 整条匹配的正则
 */
function cmdRe(body: string): RegExp {
  return new RegExp(`^#${GAME_ALT}${body}$`)
}

/**
 * uid 那一段的可选组
 *
 * 位数取三个游戏的并集（8~10 位，`1`~`9` 或 `18` 起头），由命令实现自己再校验 ——
 * 路由这一层只要分开"带了个 uid"与"跟了别的东西"。
 */
const UID_TAIL = String.raw`(?:\s*(?<uid>(?:18|[1-9])\d{7,9}))?`

/**
 * 剥掉消息开头的 `#` 与游戏名前缀
 *
 * 给那两条要拿整条原文的命令用（`#老婆` 与 `#XX养成`）。游戏名那一段与 {@link GAME_ALT} 同源。
 * 全角 `＃` 与两个简写符一并剥：这两条的 `words` 是裸触发词，接得到未经规整的形态。
 * @param text 消息原文
 * @returns 剥掉前缀后的部分
 */
function stripGamePrefix(text: string): string {
  // 次序不可换：`%绝区零老婆` 那种写法两段都要去掉
  return text.replace(/^[#＃*%]\s*/, "").replace(new RegExp(`^${GAME_ALT}`), "")
}

/**
 * 全部命令 —— 注册与帮助共用这一份
 *
 * 顺序即帮助里的顺序。带参数的命令靠字符串前缀匹配，触发词之后的部分由内核放进
 * `e.command.rest`。
 *
 * **按游戏分四块排列**（通用、原神、星穹铁道、绝区零），判据即 {@link MhyCommandSpec.game}。
 * 这一顺序由 `index.test.ts` 的不变量守着。
 */
export const MHY_COMMANDS: readonly MhyCommandSpec[] = [
  /* ═════════ 三个游戏都有 ═════════ */
  /* ───────── 账号 ───────── */
  {
    words: ["绑定CK", "绑定ck", "绑定cookie"],
    desc: "私聊发送米游社 Cookie 完成绑定",
    group: "账号",
    handler: bindCk
  },
  {
    words: ["删除CK", "删除ck"],
    desc: "删掉自己名下的 Cookie",
    group: "账号",
    handler: deleteCk
  },
  {
    words: ["我的CK", "我的ck", "CK状态"],
    desc: "看自己绑了哪些账号、今天用了多少次",
    group: "账号",
    handler: ckStatus
  },
  {
    words: ["CK池", "ck池"],
    desc: "全部 CK 概况（仅主人）",
    group: "账号",
    handler: ckPool,
    opts: { master: true }
  },
  {
    words: ["CK代码", "ck代码", "cookie代码"],
    desc: "取 Cookie 用的那行浏览器代码",
    group: "账号",
    handler: ckCode
  },
  {
    // 群聊同样受理：凭据落到发码者名下，扫错码即把自己的账号绑给别人，由图里那个标识码挡住
    words: ["扫码登录", "扫码绑定", "二维码登录"],
    desc: "用米游社 App 扫码完成绑定，同时取得 stoken",
    group: "账号",
    handler: qrLogin,
    opts: { cooldown: "30s" }
  },
  {
    // **裸的「刷新CK」只能靠锚定正则收**：它是主人专用的 `#刷新CK缓存` 的前缀，
    // 写进 `words` 会把后者整条吃掉。`$` 收尾后两条互不遮挡，大小写与 `cookie` 写法一并收。
    // `words` 首项仍要是个裸词：帮助里印的是它，也是日志里那条命令名
    words: ["刷新CK凭据", "刷新ck凭据", "更新CK", "更新ck"],
    extra: [cmdRe(String.raw`刷新(?:[Cc][Kk]|[Cc]ookie)`), cmdRe(String.raw`更新[Cc]ookie`)],
    desc: "凭 stoken 换一份新的查询 Cookie，CK 过期后不必重新绑定（需先「#扫码登录」）",
    group: "账号",
    handler: refreshCk,
    opts: { cooldown: "30s" }
  },
  {
    // 不收 `#体力帮助` 一词：`#体力` 是它的前缀，
    // 前缀路由下 `#体力帮助` 恒被便笺命令吃掉，留着等于留一条永不触发的命令
    words: ["CK帮助", "ck帮助", "cookie帮助"],
    desc: "怎么取 Cookie、绑定后能用什么",
    group: "账号",
    handler: ckHelp
  },
  /* ───────── uid ───────── */
  {
    words: ["绑定uid", "绑定UID"],
    extra: [cmdRe(String.raw`绑定(?<uid>[1-9][0-9]{7,9})`)],
    desc: "只查公开数据的话，绑个 uid 就够了",
    group: "账号",
    rest: (e: MessageEvent): string => e.command?.groups["uid"] ?? e.command?.rest ?? "",
    handler: bindUid
  },
  {
    words: ["我的uid", "我的UID", "uid"],
    desc: "看名下的 uid 与当前生效的那个",
    group: "账号",
    handler: myUid
  },
  {
    words: ["切换uid", "切换UID"],
    desc: "多个 uid 之间切换，如「#切换uid2」或「#uid2」",
    group: "账号",
    handler: switchUid
  },
  {
    words: ["删除uid", "删除UID"],
    desc: "删掉名下的某个 uid",
    group: "账号",
    handler: deleteUid
  },
  /* ───────── 设备 ───────── */
  {
    words: ["设备信息", "我的设备"],
    desc: "看当前请求用的是哪台设备",
    group: "账号",
    handler: deviceInfo
  },
  {
    words: ["绑定设备"],
    desc: "把自己真机的设备信息绑上，之后请求都用它",
    group: "账号",
    handler: bindDevice
  },
  {
    words: ["解绑设备"],
    desc: "解绑真机设备，回到系统分配的那台",
    group: "账号",
    handler: unbindDevice
  },
  /* ───────── 查询 ───────── */
  {
    // `#体力提醒` 一族也归这一条：`#体力` 是它的前缀，另注册一条必定被这一条吃掉
    words: ["体力", "树脂", "便笺", "实时便笺"],
    desc: "实时便笺：体力、委托、周本、探索派遣；「#体力提醒」到点私聊或在本群提醒你",
    group: "查询",
    handler: noteOrRemind,
    opts: { cooldown: QUERY_CD }
  },
  {
    // `#活动` 是这一条的前缀（那条归公告日历），故优先级取 90 抢在它前面
    words: ["活动日历"],
    desc: "卡池、限时活动与深渊一类周期玩法的进度与剩余时间",
    group: "查询",
    handler: actCalendar,
    opts: { priority: 90, cooldown: QUERY_CD }
  },
  {
    words: ["札记", "月历", "开拓月历"],
    desc: "本月收入，可指定月份，例如「#札记7」「#7月札记」",
    group: "查询",
    handler: ledger,
    // 月份位于触发词之前时，触发词之后不留任何内容，须将捕获组补回 rest
    extra: [cmdRe(String.raw`(?<month>[一二三四五六七八九十0-9]{1,3})月(?:札记|月历|开拓月历)`)],
    rest: (e: MessageEvent): string => e.command?.groups["month"] ?? e.command?.rest ?? "",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 「面板」一词已移交给角色面板（见下方【面板】一组），账号卡片只由 `#信息` 触发
    words: ["信息"],
    desc: "个人卡片：等级、活跃天数、成就、常用角色",
    group: "查询",
    handler: profileCard,
    opts: { cooldown: QUERY_CD }
  },
  {
    // 裸的「角色」只能走整串正则：写进 words 会按前缀把「角色图鉴」等十余条全部截走
    words: ["角色列表", "我的角色"],
    tail: "uid",
    extra: [cmdRe(String.raw`角色${UID_TAIL}`)],
    rest: (e: MessageEvent): string => e.command?.groups["uid"] ?? e.command?.rest ?? "",
    desc: "名下全部角色，按等级排序；可加 uid 查别人",
    group: "查询",
    handler: avatarList,
    gate: (c): boolean => c.enableAvatarList,
    offText: "主人关掉了「角色列表」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["深渊"],
    desc: "深渊战绩，附加「上期」可查询上一期、附加「12层」可查看逐间明细",
    group: "查询",
    handler: abyss,
    gate: (c): boolean => c.enableAbyss,
    offText: "主人关掉了「深渊」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["上期深渊", "上一期深渊"],
    desc: "上期深渊战绩",
    group: "查询",
    handler: abyss,
    gate: (c): boolean => c.enableAbyss,
    offText: "主人关掉了「深渊」这个功能",
    // 触发词本身已表达"上期"，而命令实现仅依据 rest，故在此处补入
    rest: (): string => "上期",
    opts: { cooldown: QUERY_CD, hidden: true }
  },
  {
    // 不留 `探索度` 一词：`探索` 是它的前缀，前缀路由下它恒被吃掉
    words: ["探索"],
    desc: "宝箱、神瞳、地区探索度与尘歌壶（原神）；绝区零转为区域收集",
    group: "查询",
    handler: roleExplore,
    opts: { cooldown: QUERY_CD }
  },
  {
    // 原神一路转给 #探索（成就数本就画在那张图上），星铁另出一张逐系列的
    words: ["成就"],
    desc: "达成成就数；原神并入探索度那张图，星铁逐成就系列列出",
    group: "查询",
    handler: achieveList,
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["宝箱", "战利品"],
    desc: "宝箱进度；原神并入探索度那张图，星铁逐星球逐区域列出",
    group: "查询",
    handler: chestList,
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["武器"],
    desc: "已装备武器 / 光锥 / 音擎一览，按练度排；绝区零读面板数据",
    group: "查询",
    handler: weaponList,
    opts: { cooldown: QUERY_CD }
  },
  {
    // 帮助与计算分成两条：`#角色养成` 是固定触发词，`#刻晴养成90` 的名字在触发词之前
    words: ["角色养成", "角色计算"],
    desc: "养成计算怎么用：参数依次是角色、武器与各技能的目标等级",
    group: "查询",
    handler: calculatorHelp
  },
  {
    // 与图鉴同族（名字在触发词之前），故同样 priority 800 + 认不出名字静默。
    // 裸的 `#刻晴养成` 也归这里、按满级算（没有可用的 CK 时退回图鉴材料页）；`#刻晴材料` 才是图鉴那一页
    words: ["养成计算"],
    extra: [
      cmdRe(String.raw`(?<char>(?!今日|今天|每日|我的|明天|明日|周[1-7一二三四五六日])[^#\s]{1,14})养成[0-9,，\s]*`),
      cmdRe(String.raw`(?<char>[^#\s]{1,14})计算[0-9,，\s]*`)
    ],
    rest: (e: MessageEvent): string => stripGamePrefix(e.text),
    desc: "养成材料要多少，不带参数按满级算，如「#刻晴养成」「#刻晴养成81 90 9 9 9」「%艾莲养成」",
    group: "查询",
    handler: charCalculator,
    opts: { priority: 800, cooldown: QUERY_CD }
  },
  /* ───────── 抽卡 ───────── */
  {
    words: ["抽卡链接", "祈愿链接", "跃迁链接"],
    desc: "私聊发送一条抽卡记录链接，导入历史记录",
    group: "抽卡",
    handler: gachaLink
  },
  {
    // 「更新…」这一族只做更新：拉一次新记录，按卡池报新增多少条（文字，不出图）
    words: ["更新抽卡记录", "更新祈愿记录", "更新跃迁记录"],
    desc: "拉一次新记录，按卡池报新增条数",
    group: "抽卡",
    handler: gachaUpdate,
    opts: { cooldown: QUERY_CD }
  },
  {
    // 不受 `enableGachaStat` 管：那道开关只关"分析与统计"，看自己已存的记录不该被拦。
    // extra 认「音擎记录 / 武器记录 / 独家记录」等直查某卡池，priority 50 抢在 `#武器`（默认 100）前，
    // 否则 `%武器记录` 里的「武器」先被 `#武器` 命令截走、出一张音擎列表而查不到抽卡
    words: ["抽卡记录", "祈愿记录", "跃迁记录"],
    extra: [cmdRe(String.raw`(?<pool>独家重映|音擎回响|独家|角色|音擎|武器|光锥|邦布|常驻|常规|重映|回响)记录`)],
    desc: "出金时间轴：每一发用了多少抽、歪没歪，可指定卡池如「#抽卡记录武器」「%音擎记录」",
    group: "抽卡",
    handler: gachaDetail,
    rest: (e: MessageEvent): string => e.command?.groups["pool"] ?? e.command?.rest ?? "",
    opts: { cooldown: QUERY_CD, priority: 50 }
  },
  {
    // 与上一条同一处理函数，但受 `enableGachaStat` 管，故分成两条登记
    words: ["抽卡分析", "角色池分析", "常驻池分析", "集录池分析", "光锥池分析", "音擎池分析"],
    desc: "出金时间轴（同 #抽卡记录，但归入「分析与统计」开关）：可指定卡池如「#抽卡分析武器」「%抽卡分析音擎」",
    group: "抽卡",
    handler: gachaDetail,
    gate: (c): boolean => c.enableGachaStat,
    offText: "主人关掉了「抽卡分析与统计」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["删除抽卡链接", "删除抽卡记录链接"],
    desc: "仅删除链接凭据，抽卡记录予以保留",
    group: "抽卡",
    handler: dropGachaLink
  },
  {
    // 同上，不收「武器统计」，改由 `#抽卡统计武器` 表达
    words: ["抽卡统计", "角色统计", "常驻统计", "集录统计", "光锥统计", "音擎统计", "全部统计"],
    desc: "按版本切分的统计：每个版本抽了多少、出了哪些 UP，如「#抽卡统计武器」「%抽卡统计音擎」",
    group: "抽卡",
    handler: gachaStat,
    gate: (c): boolean => c.enableGachaStat,
    offText: "主人关掉了「抽卡分析与统计」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 同上，不收「武器复刻」，改由 `#复刻统计武器` 表达
    words: ["复刻统计", "五星复刻", "四星复刻", "光锥复刻", "音擎复刻"],
    desc: "谁最久没复刻，也可查单个角色如「#复刻统计胡桃」「%复刻统计雅」",
    group: "抽卡",
    handler: bannerStat,
    gate: (c): boolean => c.enableGachaStat,
    offText: "主人关掉了「抽卡分析与统计」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["抽卡导入", "记录导入", "导入抽卡记录"],
    desc: "私聊发送 UIGF / SRGF 文件，导入别处的抽卡记录",
    group: "抽卡",
    handler: importGacha
  },
  {
    words: ["抽卡导出", "记录导出", "导出抽卡记录"],
    desc: "导出成 UIGF 文件，可加「v2」指定旧格式",
    group: "抽卡",
    handler: exportGacha
  },
  {
    // 触发词不能写成「抽卡导入帮助」一类：`#抽卡导入` 会把它整条吃掉（rest 变成「帮助」）。
    // 只收不被任何既有命令前缀遮挡的写法，由 index.test.ts 的不变量守着
    words: ["抽卡帮助", "祈愿帮助", "跃迁帮助", "调频帮助", "导入导出帮助", "导入帮助", "导出帮助"],
    desc: "抽卡记录怎么取、怎么看、怎么导入导出",
    group: "抽卡",
    handler: guideCmd(buildGachaGuide)
  },
  /* ───────── 面板 ───────── */
  {
    // **触发词一个都不能以「面板」起头**：`#面板` 是它们的前缀，会被那一条整条吃掉，
    // 于是发这个词得到的是面板列表而不是帮助图。故限定词一律放在前面
    // `面板帮助` 不被 `#面板` 按前缀吃掉，全靠那条收口（`tail: "uid"`）
    words: ["面板帮助", "角色面板帮助", "换装帮助", "试算帮助"],
    desc: "面板怎么用：先更新再看图，两条取数路的取舍，以及换装试算的全部写法",
    group: "面板",
    handler: guideCmd(buildPanelGuide)
  },
  {
    // 优先级压过裸的 `#排行`：那一条按前缀匹配，否则这条恒被它吃掉
    words: ["排行帮助", "排名帮助"],
    desc: "排行怎么用：四个维度各自怎么算、怎么入榜、怎么看榜一",
    group: "面板",
    handler: guideCmd(buildRankGuide),
    gate: (c): boolean => c.enableGroupRank && c.enablePanel,
    offText: "主人关掉了「群面板排行」这个功能",
    opts: { priority: 90 }
  },
  {
    // 只收这一个写法：`#uid` 与 `#绑定uid` 分别是 `uid帮助` / `绑定uid帮助` 的前缀，
    // 前缀路由下那两种写法恒被吃掉，留着等于留永不触发的别名
    words: ["绑定帮助"],
    desc: "绑定怎么用：uid 与 CK 的差别、扫码登录、多个 uid 怎么切",
    group: "账号",
    handler: guideCmd(buildBindGuide)
  },
  {
    // 「列表」与「单角色」只能合成一条：`#面板` 是 `#面板列表` 的前缀，而 `#胡桃面板` 的
    // 角色名在触发词之前，故靠正则别名捕获进 rest。
    // **否定预查要覆盖整个角色名**（`(?!.*…)` 而非 `(?!…)`）：只挡开头的话
    // `#米游社更新面板` 会被当成"查一个叫「米游社更新」的角色"，它自己再也触发不了
    words: ["面板", "面版", "面板列表", "角色面板", "面板角色"],
    tail: "uid",
    extra: [
      cmdRe(
        String.raw`(?<char>(?!.*(?:更新|删除|加载|重载|全部|米游社|最强|最高|最牛|第一))[^#\s]{1,12})(?:面板|面版|详情|详细)`
      )
    ],
    rest: (e: MessageEvent): string =>
      e.command?.groups["char"] ?? e.command?.groups["uid"] ?? e.command?.rest ?? "",
    desc: "角色面板：不带角色名看列表，带角色名看详情，如「#胡桃面板」；可加 uid 查别人",
    group: "面板",
    handler: panelEntry,
    gate: (c): boolean => c.enablePanel,
    offText: "主人关掉了「角色面板」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 不收「面板更新」「全部面板更新」：它们都被上面那条裸的 `#面板` 遮挡
    words: ["更新面板"],
    desc: "取一次面板数据；走面板服务还是米游社由配置里的「`#更新面板` 缺省走米游社」决定",
    group: "面板",
    handler: refreshPanelEntry,
    gate: (c): boolean => c.enablePanel,
    offText: "主人关掉了「角色面板」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 不能叫 `#面板服务更新面板`：那一串以 `面板` 起头，必被上面那条吃掉
    words: ["展柜更新面板"],
    desc: "指名走面板服务取数（不要 Cookie、词条是原值，但只看得见角色展柜里那几个）",
    group: "面板",
    handler: refreshPanel,
    gate: (c): boolean => c.enablePanel,
    offText: "主人关掉了「角色面板」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 与上一条互补：这条取名下全部角色，代价是要 Cookie 且消耗每日查询额度
    words: ["米游社更新面板", "米游社面板"],
    desc: "用自己的 Cookie 从米游社取全部角色，不受角色展柜限制，但消耗查询额度",
    group: "面板",
    handler: mysRefreshPanel,
    gate: (c): boolean => c.enablePanel,
    offText: "主人关掉了「角色面板」这个功能",
    opts: { cooldown: "60s" }
  },
  {
    // 同上：`#圣遗物` 是 `#圣遗物列表` 的前缀，且 `#胡桃圣遗物` 的角色名在触发词之前。
    // 绝区零那一路叫「驱动盘」，一并注册在这条上 —— 它出的就是那位代理人的面板图，
    // 六件盘的逐条副词条与逐件评分都在那张图上
    words: ["圣遗物", "遗器", "驱动盘", "圣遗物列表", "遗器列表", "驱动盘列表"],
    tail: "uid",
    // 排掉「换变改」：`#胡桃换刻晴圣遗物` 是换装试算，这条优先级更高，不排就被它截走
    extra: [cmdRe(String.raw`(?<char>(?!.*(?:更新|删除|[换变改]))[^#\s]{1,12})(?:圣遗物|遗器|驱动盘)`)],
    rest: (e: MessageEvent): string =>
      e.command?.groups["char"] ?? e.command?.groups["uid"] ?? e.command?.rest ?? "",
    desc: "不带角色名看全部评分最高的若干件，带角色名看该角色的评分详情；可加 uid 查别人",
    group: "面板",
    handler: artisEntry,
    gate: (c): boolean => c.enablePanel,
    offText: "主人关掉了「角色面板」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 角色名在触发词之前，故靠正则别名；**裸词不能省** —— `commandPatterns(words)` 为空
    // 即整条命令不注册，别名也一并失效
    words: ["伤害"],
    extra: [cmdRe(String.raw`(?<char>(?!.*(?:更新|删除|加载|重载|全部))[^#\s]{1,12}?伤害\d*)`)],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "角色伤害详情与词条收益对比，如「#胡桃伤害」「*青雀伤害」「#绝区零安比伤害」",
    group: "面板",
    handler: charDmg,
    gate: (c): boolean => c.enablePanel,
    offText: "主人关掉了「角色面板」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    /*
     * 正则里那两处否定断言不可省：`#切换uid2` 与 `#兑换码 XXXX` 都含「换」字，
     * 不排掉就会被这一条抢走，且毫无迹象。
     * `priority` 取 850：排在图鉴（800）之后、角色卡片（900）之前。
     * 裸词不能叫「面板替换」：`#面板` 是它的前缀，会被那条账号卡片吃掉。
     * 不给 `offText`：priority ≥ 800 这一族关掉时一律静默（`index.test.ts` 守着）。
     */
    words: ["换装试算"],
    extra: [cmdRe(String.raw`(?!切换|兑换)(?<body>[^#\s]{1,12}?[换变改][^#\s]{1,40})`)],
    rest: (e: MessageEvent): string => e.command?.groups["body"] ?? e.command?.rest ?? "",
    desc: "试算换装：如「#胡桃换钟离武器」「#胡桃换2命」「#刻晴伤害换满行迹」「%艾莲换雅音擎」",
    group: "面板",
    handler: panelChange,
    gate: (c): boolean => c.enablePanel,
    opts: { priority: 850, cooldown: QUERY_CD }
  },
  {
    words: ["练度统计", "天赋统计"],
    tail: "uid",
    rest: (e: MessageEvent): string => e.command?.groups["uid"] ?? e.command?.rest ?? "",
    desc: "全部角色的等级、天赋与武器一览；可加 uid 查别人",
    group: "面板",
    handler: panelStat,
    gate: (c): boolean => c.enableProfileStat,
    offText: "主人关掉了「练度统计」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 请求较多，故设一道较长的冷却。绝区零走 `%绝区零更新面板` 顺带取，这一条对它只回一句说明
    words: ["刷新天赋", "刷新行迹"],
    desc: "逐角色取一次天赋 / 行迹等级并入库，供「练度统计」显示（需绑定自己的 CK）",
    group: "面板",
    handler: refreshTalent,
    gate: (c): boolean => c.enableProfileStat,
    offText: "主人关掉了「练度统计」这个功能",
    opts: { cooldown: 120 }
  },
  {
    words: ["删除面板"],
    desc: "删掉本地存的面板数据，需带上 uid 确认",
    group: "面板",
    handler: delPanel,
    gate: (c): boolean => c.enablePanel,
    offText: "主人关掉了「角色面板」这个功能"
  },
  {
    // 否定预查要覆盖整个角色名而非仅其开头，否则 `#重置排名` 一类会被这条抢走
    words: ["排行", "排名"],
    extra: [cmdRe(String.raw`(?<char>(?!.*(?:重置|重设|启用|关闭|禁用|刷新))[^#\s]{1,12})(?:排行|排名|榜)`)],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "本群某个角色的排行，如「#胡桃排行」，可加「评分」「双爆」「词条」换维度",
    group: "面板",
    handler: charRank,
    gate: (c): boolean => c.enableGroupRank && c.enablePanel,
    offText: "主人关掉了「群面板排行」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["启用排名", "关闭排名", "禁用排名"],
    desc: "开关本群的面板排行（仅群管理与主人）",
    group: "面板",
    handler: toggleRank,
    gate: (c): boolean => c.enableGroupRank && c.enablePanel,
    offText: "主人关掉了「群面板排行」这个功能"
  },
  {
    // 限定词在角色名之前（`#群内最强胡桃面板`）。维度关键词（双爆 / 评分 / 词条）夹在中间，由命令实现自己认
    words: ["最强"],
    extra: [cmdRe(String.raw`(?:群内?)?(?:排[行名])?(?<body>(?:最强|最高分?|最牛|第一)[^#\s]{1,16})`)],
    rest: (e: MessageEvent): string => e.command?.groups["body"] ?? e.command?.rest ?? "",
    desc: "本群某个角色排第一那一位的面板，如「#最强胡桃面板」，可加「双爆」「评分」「词条」换维度",
    group: "面板",
    handler: topPanel,
    gate: (c): boolean => c.enableGroupRank && c.enablePanel,
    offText: "主人关掉了「群面板排行」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["刷新排名", "刷新排行"],
    desc: "按库里已有的面板重算本群排行，补齐缺的维度（仅群管理与主人）",
    group: "面板",
    handler: refreshRank,
    gate: (c): boolean => c.enableGroupRank && c.enablePanel,
    offText: "主人关掉了「群面板排行」这个功能",
    opts: { cooldown: 120 }
  },
  {
    words: ["重置排名", "重设排名"],
    desc: "清掉本群的排行数据，可指定角色（仅群管理与主人）",
    group: "面板",
    handler: resetRank,
    gate: (c): boolean => c.enableGroupRank && c.enablePanel,
    offText: "主人关掉了「群面板排行」这个功能"
  },
  {
    // 角色名在触发词中间（`#上传胡桃面板图`），故同样靠正则捕获
    words: ["上传面板图", "添加面板图"],
    extra: [cmdRe(String.raw`(?:上传|添加)(?<char>[^#\s]{1,12})面板图`)],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "把图与命令一同发送，如「#上传胡桃面板图」（仅主人）",
    group: "面板",
    handler: uploadPanelImg
  },
  {
    // 不留裸的「面板图列表」：会被 `#面板` 遮挡。`words` 仍要给一个，否则主模式注册不出来
    words: ["查看面板图"],
    extra: [cmdRe(String.raw`(?<char>[^#\s]{1,12})面板图列表`)],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "看某个角色已有的面板图，如「#胡桃面板图列表」",
    group: "面板",
    handler: listPanelImg
  },
  {
    // 同上：裸的「删除面板图」被 `#删除面板` 遮挡，故只留带角色名与序号的正则
    words: ["移除面板图"],
    extra: [cmdRe(String.raw`(?:删除|移除|清除)(?<char>[^#\s]{1,12})面板图\d+`)],
    rest: (e: MessageEvent): string => {
      const char = e.command?.groups["char"]
      // 序号在触发词之后，而 rest 被改写成了角色名，故把序号一并带上
      const idx = /\d+/.exec(e.text)?.[0] ?? ""
      return char ? `${char}${idx}` : (e.command?.rest ?? "")
    },
    desc: "按序号删掉一张面板图，如「#删除胡桃面板图1」（仅主人）",
    group: "面板",
    handler: delPanelImg
  },
  {
    // 索引按出图时平台给的消息 id 建立，故要平台既回消息 id、又在引用里带消息 id
    words: ["原图"],
    desc: "回复一张面板图或角色卡片再发送，取那张图的原始立绘",
    group: "面板",
    handler: originalPic,
    gate: (c): boolean => c.allowOriginalPic,
    offText: "主人关掉了「允许索取原图」",
    opts: { cooldown: QUERY_CD }
  },
  {
    // `老婆` 是 `老婆设置`、`老婆是谁` 的前缀，三者只能归一条，由 wife.ts 的 `parseWife`
    // 按原文再认一次关系与动作。`rest` 因此要给整条原文：关系词已被触发词吃掉，
    // 只看 `command.rest` 分不出说的是老婆还是女儿
    words: [
      "老婆", "媳妇", "妻子", "娘子",
      "女朋友", "女友", "女神",
      "老公", "丈夫", "夫君", "郎君",
      "男朋友", "男友", "男神",
      "女儿", "闺女",
      "儿子", "犬子"
    ],
    rest: (e: MessageEvent): string => stripGamePrefix(e.text),
    desc: "从名下角色里挑一位出卡片，如「#老婆」「#老婆设置胡桃」「#老婆是谁」（仅原神与星铁）",
    group: "面板",
    handler: wifeCard,
    gate: (c): boolean => c.enableAvatarCard,
    offText: "主人关掉了「角色卡片」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    /*
     * 触发形态是裸角色名（`#胡桃`），与"所有以 `#` 开头的消息"形状相同，故：
     * 1. `priority` 取 900，排在全部既有命令之后 —— 否则 `#体力` 会被当成角色名，那条命令再也触发不了。
     * 2. 认不出角色名时静默退出（见 commands/char-card.ts），否则每个笔误都变成一句报错。
     * `words` 仍要给一个，否则主模式注册不出来。
     */
    words: ["角色卡片"],
    extra: [cmdRe(String.raw`(?<char>(?:我的)?[^#\s]{1,12}?(?:卡片)?)`)],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "角色卡片：直接发角色名，如「#胡桃」「#我的三月七」",
    group: "面板",
    handler: charCard,
    // 不给 offText：关掉时也要静默，理由同上
    gate: (c): boolean => c.enableAvatarCard,
    opts: { priority: 900, cooldown: QUERY_CD }
  },
  /* ───────── 图鉴 ───────── */
  {
    /*
     * 图鉴一族的名字也在触发词之前，故 `priority` 取 800：排在普通命令（缺省 100）之后、
     * 角色卡片（900）之前 —— 不然 `#今日材料` 会被当成查「今日」这个角色的材料。
     * 认不出名字时静默退出（见 commands/wiki.ts），理由同角色卡片。
     * `#XX图鉴` 要同时认角色与武器：同一个后缀只能挂一条命令，故由 charWiki 先角色后武器。
     */
    words: ["角色图鉴"],
    extra: [cmdRe(String.raw`(?<char>[^#\s]{1,14})(?:图鉴|资料)`)],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "角色 / 武器音擎 / 圣遗物遗器驱动盘套装 / 邦布图鉴，如「#胡桃图鉴」「%云霓孤光图鉴」「%沧浪行歌图鉴」",
    group: "图鉴",
    handler: charWiki,
    // 与角色卡片同族，关掉时同样静默
    gate: (c): boolean => c.enableCharWiki,
    opts: { priority: 800, cooldown: QUERY_CD }
  },
  {
    words: ["角色天赋"],
    extra: [cmdRe(String.raw`(?<char>[^#\s]{1,14})(?:天赋|技能|行迹)`)],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "逐级天赋数值，如「#胡桃天赋」「*姬子行迹」「%安比技能」",
    group: "图鉴",
    handler: charTalent,
    gate: (c): boolean => c.enableCharTalent,
    opts: { priority: 800, cooldown: QUERY_CD }
  },
  {
    // 「命之座」放在「命座」之前只是为了读起来清楚：两者都在同一个分支里，正则回溯本就认得出。
    // 「意象影画」同理放在「意象」之前 —— 绝区零那一路的命座就是意象影画，同一条命令
    words: ["角色命座"],
    extra: [cmdRe(String.raw`(?<char>[^#\s]{1,14})(?:命之座|命座|星魂|意象影画|意象|影画)`)],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "命之座 / 星魂 / 意象影画详情，如「#胡桃命座」「*姬子星魂」「%安比影画」",
    group: "图鉴",
    handler: charCons,
    gate: (c): boolean => c.enableCharTalent,
    opts: { priority: 800, cooldown: QUERY_CD }
  },
  {
    // 正则排掉今日材料那几个日期词：那条命令优先级更高本就先匹配，此处再排一次防改动串台
    words: ["角色材料"],
    extra: [
      cmdRe(String.raw`(?<char>(?!今日|今天|每日|我的|明天|明日|周[1-7一二三四五六日])[^#\s]{1,14})(?:材料|成长)`)
    ],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "突破与天赋材料一览，如「#胡桃材料」",
    group: "图鉴",
    handler: charMaterial,
    opts: { priority: 800, cooldown: QUERY_CD }
  },
  {
    // 「面板图」不在这条的后缀里：那是 `#查看面板图` 一族的事，两者共用同一批文件但入口不同
    words: ["角色图片"],
    extra: [cmdRe(String.raw`(?<char>[^#\s]{1,14})(?:图片|写真|照片|图像)`)],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "随机发一张这个角色的面板图，如「#胡桃图片」",
    group: "图鉴",
    handler: charPic,
    gate: (c): boolean => c.enableCharPic,
    opts: { priority: 800, cooldown: QUERY_CD }
  },
  {
    // `#日历` 是 `#日历列表` 的前缀，只能合成一条；要不要列表形态由 `rest` 按原文判定
    words: ["日历", "活动"],
    rest: (e: MessageEvent): string => (/(?:日历列表|活动)$/.test(e.text) ? "列表" : (e.command?.rest ?? "")),
    desc: "十三天里的活动、卡池与深渊轮换；「#活动」「#日历列表」只列活动不画日期",
    group: "图鉴",
    handler: calendar,
    opts: { cooldown: QUERY_CD }
  },
  /* ───────── 攻略 ───────── */
  {
    // 与图鉴同族：`priority: 800` + 认不出名字静默。正则排掉「设置」，防 `#设置攻略1,2` 串台
    words: ["角色攻略"],
    extra: [cmdRe(String.raw`(?<char>(?!设置)[^#\s]{1,14})(?:攻略|功略)`)],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "各攻略组做好的攻略图，如「#胡桃攻略」；主人带「更新」重取如「#胡桃更新攻略」（仅原神与星铁）",
    group: "攻略",
    handler: charStrategy,
    opts: { priority: 800, cooldown: QUERY_CD }
  },
  {
    words: ["攻略帮助", "攻略列表"],
    desc: "看有哪些攻略组，以及当前选中的是哪些",
    group: "攻略",
    handler: strategyHelp
  },
  {
    words: ["设置攻略"],
    desc: "按序号选攻略组，如「#设置攻略1,3」「#设置攻略全部」（仅主人）",
    group: "攻略",
    handler: setStrategy,
    opts: { master: true }
  },
  {
    // `素材` / `突破` / `培养` 归这一条，`材料` / `养成` / `成长` 归上面的图鉴。
    // 日期词照 `#XX材料` 那条一并排掉，否则 `#今日素材` 会被当成查一个叫「今日」的角色
    words: ["角色素材"],
    extra: [
      cmdRe(String.raw`(?<char>(?!今日|今天|每日|我的|明天|明日|周[1-7一二三四五六日])[^#\s]{1,14})(?:素材|突破|培养)`)
    ],
    rest: (e: MessageEvent): string => e.command?.groups["char"] ?? e.command?.rest ?? "",
    desc: "米游社合集里的一图流素材，如「#刻晴素材」，带「更新」重下如「#刻晴更新素材」",
    group: "攻略",
    handler: charMaterialImg,
    opts: { priority: 800, cooldown: QUERY_CD }
  },
  /* ───────── 签到 ───────── */
  {
    // 手动签一次不受总开关限制；自动签到要主人的总开关与使用者逐账号的开关都开着才生效
    words: ["米游社签到", "米社签到"],
    // 裸的「签到」只能走整串正则：它是「签到状态」的前缀，写进 words 会把那条截走
    // 「全部 / 所有」也要收进这条：`cmdRe` 以 `$` 收尾，只写「签到」接不住「#签到全部」
    extra: [cmdRe(String.raw`签到(?:全部|所有)?`)],
    desc: "当场签一次，只用你自己绑的 CK；加「全部」三个游戏一起签",
    group: "签到",
    handler: signNow,
    opts: { cooldown: "60s" }
  },
  {
    words: ["自动签到"],
    desc: "开关每天替你签到，如「#自动签到」「#自动签到关闭」",
    group: "签到",
    handler: toggleAutoSign
  },
  {
    words: ["签到状态"],
    desc: "看名下各账号的自动签到开关与上次结果",
    group: "签到",
    handler: signStatus
  },
  {
    // 与游戏签到分立：这一条签社区换米游币，凭据要 stoken
    words: ["社区签到", "米社论坛签到"],
    desc: "签米游社社区版块换米游币，需先「#扫码登录」",
    group: "签到",
    handler: bbsSignNow,
    opts: { cooldown: "60s" }
  },
  {
    // 不收「米游币查询」：它以「米游币」开头，前缀路由下必被上一个词遮掉
    words: ["米游币", "米社币"],
    desc: "看米游币余额与今日还能获得多少，需先「#扫码登录」",
    group: "签到",
    handler: coinStatus,
    opts: { cooldown: QUERY_CD }
  },
  /* ───────── 管理 ───────── */
  {
    words: ["用户统计", "CK统计", "ck统计"],
    desc: "全部 CK 的用量与失效情况（仅主人）",
    group: "管理",
    handler: userStat,
    opts: { master: true }
  },
  {
    words: ["刷新用户缓存", "刷新CK缓存"],
    desc: "把误判停用的 CK 恢复为可用，保留今日用量（仅主人）",
    group: "管理",
    handler: resetCkCache,
    opts: { master: true }
  },
  {
    words: ["重置用户缓存", "重置CK缓存"],
    desc: "恢复停用的 CK，并清零今日用量计数（仅主人）",
    group: "管理",
    handler: resetCkCache,
    // 触发词本身表达了"重置"，而命令实现只看 rest，故在此补入
    rest: (): string => "重置",
    opts: { master: true }
  },
  {
    words: ["删除无效用户", "删除失效CK", "删除无效CK"],
    desc: "删掉已停用的 CK 及其设备信息（仅主人）",
    group: "管理",
    handler: dropDeadCk,
    opts: { master: true }
  },
  {
    words: ["更新元数据", "更新meta", "安装元数据", "安装meta"],
    desc: "下载角色 / 武器的图标与数据，附加「强制」重下完整包（仅主人）",
    group: "管理",
    handler: updateMeta,
    opts: { master: true }
  },
  {
    words: ["元数据状态", "meta状态"],
    desc: "看元数据装到哪个版本了（仅主人）",
    group: "管理",
    handler: metaStatus,
    opts: { master: true }
  },
  /* ───────── 其他 ───────── */
  {
    words: ["兑换码", "cdk"],
    desc: "国际服网页兑换，一次最多五个",
    group: "其他",
    handler: useCdk
  },
  {
    // 与 `#兑换码` 分立：那一条代兑换（要 Cookie、仅国际服），这一条只念直播间发的码（不要凭据）
    words: ["前瞻兑换码", "直播兑换码", "前瞻直播"],
    desc: "当期前瞻直播发的兑换码（不需要绑定 CK）",
    group: "其他",
    handler: liveCode,
    opts: { cooldown: QUERY_CD }
  },
  {
    // 主帮助只有这一张，按当前游戏出：`#帮助`→原神、`*帮助`→星铁、`%帮助`→绝区零；旧的几种叫法都收在这里
    // 不收「星铁帮助」「绝区零帮助」：`#星铁帮助` 本就规整成星铁的「帮助」，再收一份会在原神前缀下误中、出原神那张
    words: ["帮助", "原神帮助", "游戏帮助", "mhy帮助", "MHY帮助", "米游社帮助", "mys帮助", "查询帮助"],
    desc: "当前游戏能用的全部命令，如「*帮助」「%帮助」",
    group: "帮助",
    handler: mainHelp
  },
  /* ═════════ 仅原神 ═════════ */
  {
    // 不收「幻想」二字单独成词：它太宽，会把别的插件的命令一并吃掉
    words: ["幻想真境剧诗", "真境剧诗", "剧诗"],
    desc: "幻想真境剧诗本期战绩，逐幕列出上场角色与祝福（仅原神）",
    group: "查询",
    game: "gs",
    handler: roleCombat,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 幻想真境剧诗的子页面，故与它同一道开关。不收「月谕」：那是难度名，会与模式本身混起来
    words: ["月谕圣牌", "圣牌"],
    desc: "月谕圣牌的收藏进度，逐张列出（仅原神）",
    group: "查询",
    game: "gs",
    handler: tarotCards,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["绘想游迹"],
    desc: "绘想游迹逐角色的专精进度（仅原神）",
    group: "查询",
    game: "gs",
    handler: charMaster,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 触发词不能叫「深渊出场率」或「危战出场率」：`#深渊` 与 `危战` 是它们的前缀，会被那两条
    // 战绩命令整条吃掉（`index.test.ts` 拦下）。使用者打的 `#深渊出场率` 由那两条按 rest 分派过来
    words: ["出场率", "使用率"],
    desc: "深渊 / 幽境危战的全服角色使用率排行（第三方统计，需主人开启「图鉴显示全服统计」；仅原神）",
    group: "查询",
    game: "gs",
    handler: abyssPct,
    gate: (c): boolean => c.enableWikiStat,
    offText: "出场率未开启，请让主人在配置面板里打开「图鉴显示全服统计」",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 不收「幽境」二字单独成词：它太宽，会把别的插件的命令一并吃掉
    words: ["幽境危战", "危战"],
    desc: "幽境危战本期战绩，逐场列出对手、用时与上场角色（仅原神）",
    group: "查询",
    game: "gs",
    handler: hardChallenge,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 日期选择词在触发词之前（`#明日材料`），故靠正则别名捕获进 rest。
    // 不收「天赋」一词：`#天赋` 是 `#天赋统计` 的前缀，收了就把那条命令遮掉
    words: ["今日材料", "今日素材", "每日材料"],
    extra: [cmdRe(String.raw`(?<day>今日|今天|每日|我的|明天|明日|周[1-7一二三四五六日])?(?:材料|素材)`)],
    rest: (e: MessageEvent): string => e.command?.groups["day"] ?? e.command?.rest ?? "",
    desc: "今天可刷的天赋书与武器材料，按国家分组，可查「#明日材料」「#周三材料」（仅原神）",
    group: "查询",
    game: "gs",
    handler: todayMaterial,
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["尘歌壶模数", "尘歌壶养成"],
    desc: "一套尘歌壶图纸要多少材料，如「#尘歌壶模数1234567890」（仅原神）",
    group: "查询",
    game: "gs",
    handler: blueprint,
    opts: { cooldown: QUERY_CD }
  },
  {
    // `#七圣卡组`、`#七圣卡组列表` 与 `#七圣卡组2` 只能合成一条：前者是后两者的前缀，序号由 rest 带进来。
    // 正则要求 `(卡|牌)组`，与下面那条卡牌（以 `牌` 收尾）互不匹配
    words: ["七圣卡组", "七圣牌组"],
    extra: [cmdRe(String.raw`七圣(?:召唤)?(?:查询)?(?:卡|牌)组(?:列表)?(?<idx>[0-9]{0,2})`)],
    rest: (e: MessageEvent): string => e.command?.groups["idx"] ?? e.command?.rest ?? "",
    desc: "编好的七圣召唤牌组，不带序号看全部，如「#七圣卡组2」（仅原神）",
    group: "查询",
    game: "gs",
    handler: gcgDeck,
    opts: { cooldown: QUERY_CD }
  },
  {
    // 同上合成一条：`#七圣卡牌` 是 `#七圣卡牌列表` 的前缀，而「角色 / 行动」由 rest 选
    words: ["七圣卡牌", "七圣收集"],
    extra: [cmdRe(String.raw`七圣(?:召唤)?(?:查询)?(?<kind>角色|行动)?(?:卡)?牌(?:列表)?`)],
    rest: (e: MessageEvent): string => e.command?.groups["kind"] ?? e.command?.rest ?? "",
    desc: "七圣召唤的卡牌收集度与使用次数，可加「角色」「行动」只看一类（仅原神）",
    group: "查询",
    game: "gs",
    handler: gcgCards,
    opts: { cooldown: QUERY_CD }
  },
  /* ═════════ 仅星穹铁道 ═════════ */
  {
    // 三条都不收更短的别称：「叙事」「幻影」「仲裁」都太宽。
    // 「上期」两种语序都认：`*虚构叙事上期` 由 `rest` 带进来，`*上期虚构叙事` 走正则 ——
    // 后者不收则落到优先级 900 的角色卡片，认不出名字静默，使用者看到的是没反应
    words: ["虚构叙事"],
    extra: [cmdRe("上期虚构叙事")],
    rest: (e: MessageEvent): string => (e.text.includes("上期虚构叙事") ? "上期" : (e.command?.rest ?? "")),
    desc: "虚构叙事本期战绩，逐关列出上下半场与祝福；附加「上期」可查上一期（仅星铁）",
    group: "查询",
    game: "sr",
    handler: challengeStory,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["末日幻影"],
    extra: [cmdRe("上期末日幻影")],
    rest: (e: MessageEvent): string => (e.text.includes("上期末日幻影") ? "上期" : (e.command?.rest ?? "")),
    desc: "末日幻影本期战绩，逐关列出上下半场与祝福；附加「上期」可查上一期（仅星铁）",
    group: "查询",
    game: "sr",
    handler: challengeBoss,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["异相仲裁"],
    extra: [cmdRe("上期异相仲裁")],
    rest: (e: MessageEvent): string => (e.text.includes("上期异相仲裁") ? "上期" : (e.command?.rest ?? "")),
    desc: "异相仲裁本期战绩，逐关列出上下半场与祝福；附加「上期」可查上一期（仅星铁）",
    group: "查询",
    game: "sr",
    handler: challengePeak,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["模拟宇宙"],
    desc: "本期模拟宇宙逐次通关的阵容、祝福与奇物（仅星铁）",
    group: "查询",
    game: "sr",
    handler: rogueList,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 「上期」由 `rest` 带进去：`*货币战争上期` 与 `*货币战争` 是前缀关系，注册两条必定互相遮挡。
    // 命令层按 `s.rest` 认「上期」，且当期没打过时自动改问上期
    words: ["货币战争", "零和博弈"],
    desc: "货币战争·零和博弈：段位与最新一场存档详情，「*货币战争2」看前一场，最多近 10 场（仅星铁）",
    group: "查询",
    game: "sr",
    handler: currencyWar,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["不可知域"],
    desc: "不可知域的线性树进度与逐次通关记录（仅星铁）",
    group: "查询",
    game: "sr",
    handler: unknowableDomain,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  /* ═════════ 仅绝区零 ═════════ */
  {
    // 绝区零三类战绩各两条：一条正常的，一条把「上期」写在前面的。
    // 每组短称只收互不为前缀的两个（`式舆` 是 `式舆防卫战` 的前缀，短的恒把长的吃掉）。
    // `%深渊` 不在此处：那个词三个游戏共用一条，绝区零那一路在 commands/abyss.ts 里分派
    words: ["式舆防卫战", "防卫战"],
    desc: "式舆防卫战本期战绩，逐层逐间列出阵容与评级；附加「上期」可查上一期（仅绝区零）",
    group: "查询",
    game: "zzz",
    handler: zzzDefense,
    gate: (c): boolean => c.enableAbyss,
    offText: "主人关掉了「深渊」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["上期式舆防卫战", "上期防卫战"],
    desc: "上期式舆防卫战战绩",
    group: "查询",
    game: "zzz",
    handler: zzzDefense,
    gate: (c): boolean => c.enableAbyss,
    offText: "主人关掉了「深渊」这个功能",
    rest: (): string => "上期",
    opts: { cooldown: QUERY_CD, hidden: true }
  },
  {
    words: ["危局强袭战", "强袭战"],
    desc: "危局强袭战本期战绩，逐间列出首领、评分与阵容，另列绝境一档；附加「上期」可查上一期（仅绝区零）",
    group: "查询",
    game: "zzz",
    handler: zzzDeadly,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["上期危局强袭战", "上期强袭战"],
    desc: "上期危局强袭战战绩",
    group: "查询",
    game: "zzz",
    handler: zzzDeadly,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    rest: (): string => "上期",
    opts: { cooldown: QUERY_CD, hidden: true }
  },
  {
    words: ["拟境湮灭战", "湮灭战"],
    desc: "拟境湮灭战本期战绩，逐场列出首领、用时与无伤；附加「上期」可查上一期（仅绝区零）",
    group: "查询",
    game: "zzz",
    handler: zzzHolo,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["上期拟境湮灭战", "上期湮灭战"],
    desc: "上期拟境湮灭战战绩",
    group: "查询",
    game: "zzz",
    handler: zzzHolo,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    rest: (): string => "上期",
    opts: { cooldown: QUERY_CD, hidden: true }
  },
  {
    // 「鏖战」与「爬塔」都不是全名的前缀，故三个词可以并存
    words: ["拟真鏖战试炼", "鏖战", "爬塔"],
    desc: "拟真鏖战试炼四个赛季的层数、总分与无伤层数（仅绝区零）",
    group: "查询",
    game: "zzz",
    handler: zzzTower,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["临界推演", "推演"],
    desc: "临界推演本期战绩，逐关列出得分倍率、评级与阵容；附加「上期」可查上一期（仅绝区零）",
    group: "查询",
    game: "zzz",
    handler: zzzVoid,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["上期临界推演", "上期推演"],
    desc: "上期临界推演战绩",
    group: "查询",
    game: "zzz",
    handler: zzzVoid,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    rest: (): string => "上期",
    opts: { cooldown: QUERY_CD, hidden: true }
  },
  {
    // 底下有两个玩法、两条接口，故这一条只指路、不发请求
    words: ["零号空洞", "空洞"],
    desc: "零号空洞有哪几项可查（仅绝区零）",
    group: "查询",
    game: "zzz",
    handler: zzzHollowHelp,
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["枯萎苗圃", "苗圃"],
    desc: "零号空洞·枯萎苗圃的执照等级、收集数据与刀耕火焚战绩（仅绝区零）",
    group: "查询",
    game: "zzz",
    handler: zzzGarden,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 「迷失」是「迷失之地」的前缀，故只收全名
    words: ["迷失之地"],
    desc: "零号空洞·迷失之地的执照等级、收集数据与三档挑战（仅绝区零）",
    group: "查询",
    game: "zzz",
    handler: zzzLost,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    // 「收集」二字太宽，不单独成词；`%探索` 那一路已由 roleExplore 分派到这里
    words: ["区域收集"],
    desc: "逐区域逐子区域的收集完成度（仅绝区零）",
    group: "查询",
    game: "zzz",
    handler: zzzExplore,
    opts: { cooldown: QUERY_CD }
  },
  {
    // 「迷宫诡域」与「迷宫诡域战绩」只能合成一条：前者是后者的前缀，要不要战绩由 rest 判定。
    // 别名只收互不为前缀的那几个，「迷宫」故不收
    words: ["迷宫诡域", "诡域", "搜打撤"],
    desc: "迷宫诡域本期的地图撤离率与最好成绩；附加「战绩」看逐场记录与撤离物资（仅绝区零）",
    group: "查询",
    game: "zzz",
    handler: zzzZenkovEntry,
    gate: (c): boolean => c.enableChallenge,
    offText: "主人关掉了「挑战战绩」这个功能",
    opts: { cooldown: QUERY_CD }
  },
  {
    words: ["邦布"],
    desc: "已拥有的邦布一览（仅绝区零）",
    group: "查询",
    game: "zzz",
    handler: buddyList,
    opts: { cooldown: QUERY_CD }
  }
] as const

/**
 * 把一条命令的触发词展开成三个游戏的完整模式
 * @param words 触发词
 * @returns 完整触发模式，第一个是主模式，其余作别名
 */
export function commandPatterns(words: readonly string[]): string[] {
  return words.flatMap(word => GAME_KEYS.map(game => `${COMMAND_PREFIX[game]}${word}`))
}

/**
 * 把一条 `tail: "uid"` 的命令的触发词换成锚定正则
 *
 * **逐词逐游戏各一条**：`#面板` / `#星铁面板` / `#绝区零面板` 三条前缀各自成式，
 * 与 {@link commandPatterns} 的展开一致。
 * @param words 触发词
 * @returns 锚定正则
 */
export function uidTailPatterns(words: readonly string[]): RegExp[] {
  return words.map(word => new RegExp(`^#${GAME_ALT}${escapeRe(word)}${UID_TAIL}$`))
}

/**
 * 转义触发词里的正则元字符
 * @param text 触发词
 * @returns 可直接嵌进正则的串
 */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/**
 * 认出本条消息说的是哪个游戏，并把消息规整成带规范前缀的形态
 *
 * 插件自有的中间件，执行于命令路由之前，故改写 `e.text` 合法。
 * @param e 消息事件
 * @returns 认出的游戏
 */
export function applyGame(e: MessageEvent): GameKey {
  const got = detectGame(e.text)
  e.state[GAME_STATE_KEY] = got.game
  if (got.text !== e.text) e.text = got.text
  return got.game
}

/**
 * 由 {@link MHY_COMMANDS} 生成帮助文本
 *
 * 每条印自己那个游戏的前缀（{@link MhyCommandSpec.game}）：只对星铁成立的那几条印
 * `#虚构叙事` 会得到一句「只有星穹铁道有」。
 * @returns 帮助文本
 */
export function mhyHelp(): string {
  const groups = new Map<string, string[]>()
  for (const spec of MHY_COMMANDS) {
    if (spec.opts?.hidden) continue
    const lines = groups.get(spec.group) ?? []
    lines.push(`${COMMAND_PREFIX[spec.game ?? "gs"]}${spec.words[0] ?? ""} —— ${spec.desc}`)
    groups.set(spec.group, lines)
  }
  const body = [...groups].map(([group, lines]) => [`【${group}】`, ...lines].join("\n"))
  return [
    "米游社查询命令",
    ...body,
    `星铁在前面加「${COMMAND_PREFIX.sr}」或「*」，绝区零加「${COMMAND_PREFIX.zzz}」或「%」，如「*体力」`
  ].join("\n")
}

/**
 * 把中间件与全部命令挂到内核
 *
 * 注意事项：中间件优先级取 10（默认 100，越小越靠外层）—— 前缀规整必须发生于任何命令匹配之前，
 *          否则 `*体力` 匹配不上 `#星铁体力`。
 *
 *          每条命令都裹一层：收尾记一行 debug 汇总（见 core/trace.ts），出错另记栈再原样抛出 ——
 *          内核只记 `err.message`，不含位置信息；抛出是因内核要据此回落与统计。
 * @param ctx 插件上下文
 * @param deps 命令层依赖
 */
export function registerMhyCommands(ctx: PluginContext, deps: MhyDeps): void {
  ctx.middleware(
    async (e, next) => {
      if (e.kind === "message") applyGame(e)
      await next()
    },
    { kind: "message", priority: 10 }
  )

  for (const spec of MHY_COMMANDS) {
    // `tail: "uid"` 的那些**一条裸前缀都不注册**：留着任何一条，`#面板发这个` 就仍会命中它。
    // 内核的模式既收字符串也收正则（`CommandPattern = string | RegExp`），且能从
    // `^#…` 提取字面前缀进桶，故全换成正则不影响匹配性能
    const [primary, ...rest] = spec.tail === "uid" ? uidTailPatterns(spec.words) : commandPatterns(spec.words)
    if (!primary) continue
    const alias: CommandPattern[] = [...rest, ...(spec.extra ?? [])]
    const opts: CommandOptions = { ...spec.opts, desc: spec.desc, group: spec.group, alias }
    ctx.command(primary, opts).action(async e => {
      // 开关在此判而非注册时：配置改完即时生效，"关了就不注册"要重启才看得出来
      if (spec.gate && !spec.gate(deps.config())) {
        if (spec.offText) await e.reply(spec.offText, { at: e.isGroup })
        return
      }
      const base = sessionOf(e, deps.logger, deps.render, deps.http, (game, uid) => whoOf(deps, game, uid))
      const s: Session = spec.rest ? { ...base, rest: spec.rest(e).trim() } : base
      const name = `${COMMAND_PREFIX[s.game]}${spec.words[0] ?? primary}`
      // 只记发起者标识与群号，不记消息原文：绑 CK 一类命令的原文就是凭据
      const who = `${s.user}${s.groupId ? `@${s.groupId}` : ""}`
      const started = Date.now()
      deps.logger?.debug?.(`[米游社][命令] ${name} ${who} 开始${s.rest ? `，参数 ${s.rest.length} 字` : ""}`)
      let failure: unknown
      const { trace } = await withTrace(name, async () => {
        try {
          // 过码链接要送回发起这条命令的人，而"发给谁"只有此处知道，故登记一次异步上下文
          await withCaptchaNotice(
            async text => {
              await s.text(text)
            },
            async () => {
              await spec.handler(s, deps)
            }
          )
        } catch (err) {
          failure = err
        }
      })
      // 记日志本身不许改变结果：日志器由调用方给、形态未必齐全，记不下来也要把原错误抛出去
      try {
        const error = failure === undefined ? undefined : failure instanceof Error ? failure.message : String(failure)
        deps.logger?.debug?.(summarize(trace, who, error))
        if (failure !== undefined) {
          deps.logger?.error?.(
            `[米游社] 命令 ${name} 出错（${Date.now() - started}ms）：${failure instanceof Error ? (failure.stack ?? failure.message) : String(failure)}`
          )
        }
      } catch {
        // 记不下来就算了，下一行才是要紧的
      }
      if (failure !== undefined) throw failure
    })
  }
}

