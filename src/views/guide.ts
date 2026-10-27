/**
 * 模块职责：细分帮助（`#面板帮助` / `#抽卡帮助`）的视图模型，以及四张细分帮助共用的形态与文字版
 * 依赖方向：依赖 core/region 的游戏常量与 views/help 的配色；纯函数
 * 生命周期：无状态
 * 注意事项：细分帮助讲**先后与取舍**，故一节三四步横排；每一步给了 `cmd` 就必须是一条真能发的命令 ——
 *          catalog.test.ts 逐条路由，主帮助没收的那些命令（见 catalog.ts 的 IN_GUIDE）靠它们在这里露面。
 *          命令里的记号一律由 `SHORT_PREFIX[game]` 拼，写死 `#` 会让星铁与绝区零照抄得到一条发不出去的命令。
 */
import type { GameKey } from "../core/region.js"
import { CONS_NAMES, DEMO_CHARS, GAME_NAMES, GEAR_NAMES, SHORT_PREFIX, WEAPON_NAMES } from "../core/region.js"
import { GAME_ACCENT, ICON_DIR } from "./help.js"

/** 分步指引里的一步 */
export interface GuideStep {
  /** 步骤序号，从 1 起 */
  no: number
  /** 这一步做什么 */
  title: string
  /** 详细说明 */
  desc: string
  /** 这一步要发的命令；只是说明时不给 */
  cmd?: string
}

/** 分步指引里的一节 */
export interface GuideSection {
  /** 小节名 */
  name: string
  /** 一句话概述 */
  intro: string
  /** 逐步 */
  steps: GuideStep[]
}

/** 一张分步指引图的数据 */
export interface GuideView {
  /** 游戏，皮肤按它取 */
  game: GameKey
  /** 主标题 */
  title: string
  /** 副标题 */
  subtitle: string
  /** 记号 */
  hash: string
  /** 吉祥物图 */
  hero: string
  /** 主题强调色 */
  accent: string
  /** 次强调色 */
  accentSoft: string
  /** 逐节 */
  sections: GuideSection[]
  /** 末尾要点 */
  notes: string[]
}

/**
 * 造一张指引的外壳
 * @param game 游戏
 * @param title 主标题
 * @param subtitle 副标题
 * @param sections 逐节；步骤序号按位置补
 * @param notes 末尾要点
 * @returns 指引视图
 */
export function guideShell(
  game: GameKey,
  title: string,
  subtitle: string,
  sections: { name: string; intro: string; steps: Omit<GuideStep, "no">[] }[],
  notes: string[]
): GuideView {
  const accent = GAME_ACCENT[game]
  return {
    game,
    title,
    subtitle: `${GAME_NAMES[game]} · ${subtitle}`,
    hash: SHORT_PREFIX[game],
    hero: `${ICON_DIR}hero-${game}.png`,
    accent: accent.main,
    accentSoft: accent.soft,
    sections: sections.map(sec => ({ ...sec, steps: sec.steps.map((one, i) => ({ no: i + 1, ...one })) })),
    notes
  }
}

/**
 * 造「抽卡记录」的分步指引：取记录、看图、导入导出
 *
 * **只在私聊受理的那几条写在最前面**：群里发链接或文件等于公开抽卡历史与 uid，命令层直接拒收，
 * 而使用者看到的只是「没反应」。
 * @param game 当前游戏
 * @returns 指引视图
 */
export function buildGachaGuide(game: GameKey = "gs"): GuideView {
  const p = SHORT_PREFIX[game]
  const record = game === "sr" ? "跃迁记录" : game === "zzz" ? "调频记录" : "祈愿记录"
  const pool = game === "sr" ? "光锥" : game === "zzz" ? "音擎" : "武器"
  const old = game === "sr" ? "SRGF v1.0" : "UIGF v2.3"
  return guideShell(game, "抽卡帮助", "取记录、看图与导入导出", [
    {
      name: "先把记录取下来",
      intro: "本地一条记录都没有时什么都看不了",
      steps: [
        { title: "扫码登录过就直接更新", desc: "凭 stoken 自助换取链接，群里也能用", cmd: `${p}更新抽卡记录` },
        { title: "否则私聊贴链接", desc: `游戏里打开「${record}」，复制链接整条发来`, cmd: `${p}抽卡链接` },
        { title: "不想再更新了", desc: "只删链接凭据，记录保留", cmd: `${p}删除抽卡链接` }
      ]
    },
    {
      name: "看图",
      intro: "读本地那份，不发请求",
      steps: [
        { title: "出金时间轴", desc: `每一发用了多少抽、歪没歪；「${p}${pool}记录」只看${pool}池`, cmd: `${p}抽卡记录` },
        { title: "同一张图的另一个开关", desc: "主人关了「抽卡分析与统计」时这条也关", cmd: `${p}抽卡分析` },
        { title: "按版本统计", desc: "每期抽了多少、出了哪些 UP", cmd: `${p}抽卡统计` },
        { title: "复刻间隔", desc: "谁最久没复刻，可带角色名", cmd: `${p}复刻统计` }
      ]
    },
    {
      name: "导入与导出",
      intro: "都只在私聊受理",
      steps: [
        { title: "导入", desc: "随命令附上 json，或先发文件再回复它发命令；uid 取自文件", cmd: `${p}抽卡导入` },
        { title: "导出", desc: "默认 UIGF v4.0，一份文件可装三个游戏", cmd: `${p}抽卡导出` },
        { title: "要旧格式", desc: `只认旧格式的工具用这个，即 ${old}`, cmd: `${p}抽卡导出v2` }
      ]
    }
  ], [
    "导入只合并、不覆盖：本地已有而文件里没有的记录一概保留",
    "去重按记录 id：先导入别人给的文件、再自己同步一次，不会重复",
    "认三种格式：UIGF v4.0、UIGF v2.3（原神）、SRGF v1.0（星铁）",
    "本地库只增不减，完整度会高于米游社那半年的窗口"
  ])
}

/**
 * 造「面板」的分步指引：取数、看图、试算与本地数据
 *
 * 最常见的困惑是「为什么只有几个角色」：那是走了展柜。两条取数路的代价写在第一节。
 * @param game 当前游戏
 * @returns 指引视图
 */
export function buildPanelGuide(game: GameKey = "gs"): GuideView {
  const p = SHORT_PREFIX[game]
  const gear = GEAR_NAMES[game]
  const weapon = WEAPON_NAMES[game]
  const cons = CONS_NAMES[game]
  const char = DEMO_CHARS[game]
  const isZzz = game === "zzz"
  return guideShell(game, "面板帮助", "先取数，再看图", [
    {
      name: "取一次数",
      intro: "面板不会自己更新，看图之前先取；两条路各有代价",
      steps: [
        { title: "一般就发这条", desc: "绑了 CK 走米游社，没绑走展柜（主人可改）", cmd: `${p}更新面板` },
        { title: "只看得见几个角色？", desc: "那是走了展柜：不要 CK，但只看得见游戏里摆进展柜的那几个", cmd: `${p}展柜更新面板` },
        { title: "要全部角色", desc: "用自己的 CK 走米游社，不受展柜限制，占查询额度", cmd: `${p}米游社更新面板` }
      ]
    },
    {
      name: "看图",
      intro: "读本地那份，不再发请求",
      steps: [
        { title: "列表", desc: "名下已有面板的角色一览", cmd: `${p}面板` },
        { title: "单个角色", desc: `属性、${weapon}、${gear}与评分`, cmd: `${p}${char}面板` },
        { title: `${gear}评分`, desc: "逐件评分与这个角色的权重", cmd: `${p}${char}${gear}` },
        { title: "伤害", desc: `期望伤害与词条收益；多套算法时「${p}${char}伤害2」`, cmd: `${p}${char}伤害` }
      ]
    },
    ...(isZzz
      ? []
      : [
          {
            name: "试算换装",
            intro: "算给你看，一律不写回你的面板",
            steps: [
              { title: "借部件", desc: `把自己另一个角色的${weapon}或${gear}挪过来`, cmd: `${p}${char}换钟离${weapon}` },
              { title: "改练度", desc: `${cons}、等级、天赋都能改`, cmd: `${p}${char}换80级` },
              { title: "换完看伤害", desc: `名字后写「伤害」或「${gear}」，出的就是那张图`, cmd: `${p}${char}伤害换满命` }
            ]
          }
        ]),
    {
      name: "本地数据",
      intro: "面板存在本机，可补可删",
      steps: [
        ...(isZzz ? [] : [{ title: game === "sr" ? "补行迹等级" : "补天赋等级", desc: "逐角色取一次，练度统计才印得出", cmd: `${p}刷新${game === "sr" ? "行迹" : "天赋"}` }]),
        { title: "删掉本地面板", desc: "要带上 uid 确认", cmd: `${p}删除面板100000001` },
        { title: "看自定义立绘", desc: "主人上传过的面板图，按序号列出", cmd: `${p}${char}面板图列表` },
        { title: "删一张立绘", desc: "按上一条的序号删（仅主人）", cmd: `${p}删除${char}面板图1` }
      ]
    }
  ], [
    "试算一律不落库：算完只出这一张图，你的面板一个字没改",
    `${gear}评分按角色分别加权：同一件在不同角色身上分数不同`,
    `想看本群谁的某个角色最强，发「${p}${char}排行」`
  ])
}

/**
 * 分步指引出不了图时的文字版
 * @param view 指引视图
 * @returns 多行文本
 */
export function guideText(view: GuideView): string {
  const lines = [view.title]
  for (const sec of view.sections) {
    lines.push(`【${sec.name}】${sec.intro}`)
    for (const one of sec.steps) lines.push(`${one.no}. ${one.title}${one.cmd ? `（${one.cmd}）` : ""} —— ${one.desc}`)
  }
  lines.push("要点：", ...view.notes.map(one => `· ${one}`))
  return lines.join("\n")
}
