/**
 * 模块职责：帮助图的命令目录 —— 按"使用者要做的事"分区，逐条写明在哪几个游戏里能用
 * 依赖方向：只依赖 core/region 的游戏常量；不读命令表、不碰 IO
 * 生命周期：模块加载期的常量
 * 注意事项：**手写而不从命令表推导**：命令表里多数条目对三个游戏都注册得出来（好回一句「只有原神有」），
 *          据它生成会把 `*七圣卡组` 一类印进去。约束全在 catalog.test.ts：每条逐游戏路由到真正实现它的
 *          那条命令、且不会回「只有X有 / 暂不支持」；命令表里每条可见命令要么在目录里，要么在
 *          {@link IN_GUIDE} 里指明写在哪张细分帮助上 —— 漏收一条即测试失败。
 */
import type { GameKey } from "../core/region.js"
import { SHORT_PREFIX } from "../core/region.js"

/** 一条命令在三个游戏里可以各写各的；不分游戏时直接给字符串 */
export type PerGame = string | Readonly<Partial<Record<GameKey, string>>>

/** 只有某些人能用的命令，图上打一个标签 */
export type CatalogRole = "master" | "admin"

/** 目录里的一条命令 */
export interface CatalogItem {
  /** 触发词示例，不带 `#` 与游戏前缀；可按游戏分写 */
  word: PerGame
  /** 一句话说明，写"能得到什么"；可按游戏分写 */
  desc: PerGame
  /** 哪几个游戏真的能用它 */
  games: readonly GameKey[]
  /** 命令表里对应那条的首个触发词；与 `word` 不同时给，对账与开关都按它找 */
  spec?: string
  /** 只在私聊受理 */
  private?: boolean
  /** 只有主人 / 群管理能用 */
  role?: CatalogRole
  /** 命令表那条开关之外，还要这项配置为真才印（伤害一族） */
  needs?: "enableDmgCalc" | "enableStaminaRemind" | "enableAutoSign"
}

/** 目录里的一个区块 */
export interface CatalogSection {
  /** 区块键，选图与测试用 */
  key: string
  /** 区块名 */
  name: string
  /** 一句话前提，印在区块标题右侧 */
  note: PerGame
  /** 整块只给这类人看；不给即人人可见 */
  role?: CatalogRole
  /** 逐条命令 */
  items: readonly CatalogItem[]
}

/** 三个游戏都有 */
const ALL: readonly GameKey[] = ["gs", "sr", "zzz"]
/** 原神与星铁 */
const GS_SR: readonly GameKey[] = ["gs", "sr"]

/** 全部区块，次序即图上从上到下的次序 */
export const CATALOG: readonly CatalogSection[] = [
  {
    key: "account",
    name: "账号绑定",
    note: "绑一次三个游戏通用；不绑 CK 只能看展柜面板、图鉴与抽卡链接",
    items: [
      { word: "扫码登录", desc: "米游社 App 扫码，一步取齐 CK 与 stoken，之后 CK 过期能自动续上", games: ALL },
      { word: "绑定CK", desc: "手动贴 Cookie 绑定，取法见「{p}CK帮助」「{p}CK代码」", games: ALL, private: true },
      { word: "绑定uid100000001", desc: "只绑 uid，不给凭据", games: ALL, spec: "绑定uid" },
      { word: "我的uid", desc: "名下全部 uid，当前那个有标记；「{p}uid2」切换", games: ALL },
      { word: "我的CK", desc: "自己那几份凭据的状态与对应 uid", games: ALL },
      { word: "刷新ck", desc: "CK 失效后凭 stoken 换一份新的，不必重绑", games: ALL, spec: "刷新CK凭据" }
    ]
  },
  {
    key: "daily",
    name: "日常",
    note: "要绑自己的 CK",
    items: [
      { word: "体力", desc: { gs: "树脂、委托、派遣、周本与参量质变仪", sr: "开拓力、每日实训、委托与模拟宇宙", zzz: "电量、活跃度、刮刮卡与录像店" }, games: ALL },
      { word: "体力提醒", desc: "体力快满时到点提醒你，群里开的在群里 @ 你", games: ALL, spec: "体力", needs: "enableStaminaRemind" },
      { word: "活动日历", desc: { gs: "活动祈愿、限时活动与深渊剧诗的进度和剩余时间", sr: "活动跃迁、限时活动与逐光捡金的进度和剩余时间", zzz: "调频与限时活动的菲林进度和剩余时间" }, games: ALL },
      { word: "札记", desc: { gs: "本月原石与摩拉，「{p}7月札记」看指定月", sr: "本月星琼与通票，「{p}7月札记」看指定月", zzz: "本月菲林与邦布券，「{p}7月札记」看指定月" }, games: ALL },
      { word: "信息", desc: "账号卡片：等级、活跃天数、成就与常用角色", games: ALL },
      { word: "角色列表", desc: "名下全部角色，按等级排", games: ALL },
      { word: "探索", desc: { gs: "宝箱、神瞳、地区探索度与尘歌壶", zzz: "即「{p}区域收集」：逐区域的收集完成度" }, games: ["gs", "zzz"] },
      { word: "成就", desc: "逐成就系列的达成进度", games: ["sr"] },
      { word: "宝箱", desc: "逐星球逐区域的战利品开启进度", games: ["sr"] },
      { word: "武器", desc: { gs: "已装备武器一览，按练度排", sr: "已装备光锥一览，按练度排", zzz: "已装备音擎一览（读面板数据），按练度排" }, games: ALL },
      { word: { gs: "刻晴养成90", sr: "青雀养成80", zzz: "艾莲养成60" }, desc: "养成材料缺口，参数怎么写见「{p}角色养成」", games: ALL, spec: "养成计算" },
      { word: "今日材料", desc: "今天能刷的天赋书与武器材料，也可「{p}周三材料」", games: ["gs"] },
      { word: "尘歌壶模数", desc: "一套洞天图纸要多少材料", games: ["gs"] }
    ]
  },
  {
    key: "battle",
    name: "战绩",
    note: "要绑自己的 CK；多数可加「上期」",
    items: [
      { word: "深渊", desc: { gs: "深境螺旋，「{p}上期深渊」看上一期、「{p}深渊12层」看逐间", sr: "混沌回忆，「{p}上期深渊」看上一期" }, games: GS_SR },
      { word: "幻想真境剧诗", desc: "逐幕的上场角色、祝福与星章", games: ["gs"] },
      { word: "幽境危战", desc: "逐场的对手、用时与上场角色", games: ["gs"] },
      { word: "月谕圣牌", desc: "圣牌收藏进度", games: ["gs"] },
      { word: "绘想游迹", desc: "逐角色的专精进度", games: ["gs"] },
      { word: "七圣卡组", desc: "编好的牌组，「{p}七圣卡牌」看收集度", games: ["gs"] },
      { word: "出场率", desc: "深渊与幽境危战的全服角色使用率（第三方统计）", games: ["gs"] },
      { word: "虚构叙事", desc: "逐关的上下半场与祝福", games: ["sr"] },
      { word: "末日幻影", desc: "逐关的上下半场与首领", games: ["sr"] },
      { word: "异相仲裁", desc: "王棋与骑士逐关战绩", games: ["sr"] },
      { word: "模拟宇宙", desc: "本期逐次通关的阵容、祝福与奇物", games: ["sr"] },
      { word: "货币战争", desc: "段位与最新一场存档，加序号看前几场（最多 10）", games: ["sr"] },
      { word: "不可知域", desc: "线性树进度与通关记录", games: ["sr"] },
      { word: "式舆防卫战", desc: "逐层逐间的阵容与评级", games: ["zzz"] },
      { word: "危局强袭战", desc: "逐间首领、评分与阵容", games: ["zzz"] },
      { word: "拟境湮灭战", desc: "逐场首领、用时与无伤", games: ["zzz"] },
      { word: "临界推演", desc: "逐关得分倍率、评级与阵容", games: ["zzz"] },
      { word: "拟真鏖战试炼", desc: "四个赛季的层数与总分", games: ["zzz"] },
      { word: "零号空洞", desc: "「{p}枯萎苗圃」「{p}迷失之地」两项", games: ["zzz"] },
      { word: "迷宫诡域", desc: "地图撤离率，加「战绩」看逐场", games: ["zzz"] },
      { word: "邦布", desc: "已拥有的邦布一览", games: ["zzz"] }
    ]
  },
  {
    key: "panel",
    name: "角色面板",
    note: "先「{p}更新面板」取一次数，看图不再发请求",
    items: [
      { word: "更新面板", desc: "取一次面板并入库；绑了 CK 走米游社拿全部角色，否则只有展柜里那几个", games: ALL },
      { word: "面板", desc: "名下已有面板的角色一览", games: ALL },
      { word: { gs: "胡桃面板", sr: "青雀面板", zzz: "安比面板" }, desc: "单个角色的属性、装备与评分", games: ALL, spec: "面板" },
      { word: { gs: "胡桃圣遗物", sr: "青雀遗器", zzz: "安比驱动盘" }, desc: "逐件评分与权重；不带名字看评分最高的若干件", games: ALL, spec: "圣遗物" },
      { word: { gs: "胡桃伤害", sr: "青雀伤害", zzz: "安比伤害" }, desc: "期望伤害与词条收益对比", games: ALL, spec: "伤害", needs: "enableDmgCalc" },
      { word: { gs: "胡桃换钟离武器", sr: "青雀换景元光锥", zzz: "安比换雅音擎" }, desc: "试算换装、换命座或改等级，不改你的面板", games: ALL, spec: "换装试算" },
      { word: { gs: "胡桃排行", sr: "青雀排行", zzz: "安比排行" }, desc: "本群这个角色的排名，可加「评分」「双爆」「词条」", games: ALL, spec: "排行" },
      { word: { gs: "最强胡桃面板", sr: "最强青雀面板", zzz: "最强安比面板" }, desc: "本群榜一那位的面板", games: ALL, spec: "最强" },
      { word: "练度统计", desc: "全部角色的等级、天赋与武器一张表", games: ALL },
      { word: { gs: "胡桃", sr: "青雀", zzz: "安比" }, desc: "角色卡片：立绘配武器、天赋与套装", games: ALL, spec: "角色卡片" },
      { word: "老婆", desc: { gs: "从名下挑一位出卡片，「{p}老婆设置胡桃」钉住", sr: "从名下挑一位出卡片，「{p}老婆设置青雀」钉住" }, games: GS_SR },
      { word: "原图", desc: "回复一张面板图再发，取它的原始立绘", games: ALL }
    ]
  },
  {
    key: "gacha",
    name: "抽卡",
    note: "链接与文件只在私聊发",
    items: [
      { word: "更新抽卡记录", desc: "扫码登录过就能直接更新，不必贴链接", games: ALL },
      { word: "抽卡链接", desc: "私聊贴一条抽卡链接，导入历史记录", games: ALL, private: true },
      { word: "抽卡记录", desc: { gs: "出金时间轴，可「{p}武器记录」只看武器池", sr: "出金时间轴，可「{p}光锥记录」只看光锥池", zzz: "出金时间轴，可「{p}音擎记录」只看音擎池" }, games: ALL },
      { word: "抽卡统计", desc: "按版本切分：每期抽了多少、出了哪些 UP", games: ALL },
      { word: "复刻统计", desc: { gs: "谁最久没复刻，也可「{p}复刻统计胡桃」", sr: "谁最久没复刻，也可「{p}复刻统计青雀」", zzz: "谁最久没复刻，也可「{p}复刻统计雅」" }, games: ALL },
      { word: "抽卡导入", desc: "导入 UIGF / SRGF 文件", games: ALL, private: true },
      { word: "抽卡导出", desc: "导出 UIGF 文件，可加「v2」", games: ALL, private: true }
    ]
  },
  {
    key: "wiki",
    name: "图鉴与资料",
    note: "不要 CK，要主人装好元数据",
    items: [
      { word: { gs: "胡桃图鉴", sr: "青雀图鉴", zzz: "安比图鉴" }, desc: "角色、武器与套装都能查", games: ALL, spec: "角色图鉴" },
      { word: { gs: "胡桃天赋", sr: "青雀行迹", zzz: "安比技能" }, desc: "逐级技能倍率", games: ALL, spec: "角色天赋" },
      { word: { gs: "胡桃命座", sr: "青雀星魂", zzz: "安比影画" }, desc: { gs: "命之座详情", sr: "星魂详情", zzz: "意象影画详情" }, games: ALL, spec: "角色命座" },
      { word: { gs: "胡桃材料", sr: "青雀材料" }, desc: "突破与技能材料一览", games: GS_SR, spec: "角色材料" },
      { word: { gs: "胡桃攻略", sr: "青雀攻略" }, desc: { gs: "各攻略组做好的攻略图，主人「{p}胡桃更新攻略」重取", sr: "各攻略组做好的攻略图，主人「{p}青雀更新攻略」重取" }, games: GS_SR, spec: "角色攻略" },
      { word: { gs: "胡桃素材", sr: "青雀素材" }, desc: "米游社合集里的一图流素材", games: GS_SR, spec: "角色素材" },
      { word: { gs: "胡桃图片", sr: "青雀图片" }, desc: "随机一张面板图", games: GS_SR, spec: "角色图片" },
      { word: "日历", desc: { gs: "活动、卡池与深渊轮换的时间轴", sr: "活动、跃迁与深渊轮换的时间轴", zzz: "活动与调频的时间轴" }, games: ALL },
      { word: "前瞻兑换码", desc: "当期前瞻直播发的兑换码", games: ALL },
      { word: "兑换码", desc: "国际服网页兑换，一次最多五个", games: ALL, spec: "兑换码" }
    ]
  },
  {
    key: "sign",
    name: "签到",
    note: "只用你自己绑的 CK",
    items: [
      { word: "签到", desc: "当场签一次游戏福利", games: ALL, spec: "米游社签到" },
      { word: "自动签到", desc: "开关每天替你签到，「{p}签到状态」看结果", games: ALL, needs: "enableAutoSign" },
      { word: "社区签到", desc: "米游社版块签到换米游币，要先扫码登录", games: ALL },
      { word: "米游币", desc: "米游币余额与今日还能拿多少", games: ALL }
    ]
  },
  {
    key: "admin",
    name: "群管理",
    note: "群管理与主人可用",
    role: "admin",
    items: [
      { word: "关闭排名", desc: "本群不再记录、也查不了排行；「{p}启用排名」恢复", games: ALL, spec: "启用排名", role: "admin" },
      { word: "刷新排名", desc: "按库里已有的面板重算本群排行", games: ALL, role: "admin" },
      { word: "重置排名", desc: "清掉本群排行数据，可指定角色", games: ALL, role: "admin" }
    ]
  },
  {
    key: "master",
    name: "主人",
    note: "只有主人看得到这一块",
    role: "master",
    items: [
      { word: "更新元数据", desc: "装 / 更新图标与资料，加「强制」重下完整包", games: ALL, role: "master" },
      { word: "元数据状态", desc: "元数据装到了哪个版本", games: ALL, role: "master" },
      { word: "用户统计", desc: "全部 CK 的可用、失效与今日用量；「{p}CK池」看逐条", games: ALL, role: "master" },
      { word: "删除无效用户", desc: "清掉已失效的 CK 与其设备", games: ALL, role: "master" },
      { word: "刷新用户缓存", desc: "把误判停用的 CK 恢复可用；「{p}重置用户缓存」另清零今日用量", games: ALL, role: "master" },
      { word: { gs: "上传胡桃面板图", sr: "上传青雀面板图", zzz: "上传安比面板图" }, desc: "随消息带图，换上自定义立绘", games: ALL, spec: "上传面板图", role: "master" },
      { word: "设置攻略1,3", desc: "按序号挑用哪几家攻略组", games: GS_SR, spec: "设置攻略", role: "master" }
    ]
  }
]

/** 底部那排细分帮助：触发词 → 一句话 */
export const GUIDES: readonly { word: string; desc: string }[] = [
  { word: "绑定帮助", desc: "uid、CK、扫码与设备" },
  { word: "CK帮助", desc: "手动取 Cookie" },
  { word: "面板帮助", desc: "取数、看图与换装试算" },
  { word: "排行帮助", desc: "四个维度与入榜" },
  { word: "抽卡帮助", desc: "更新、导入与导出" },
  { word: "攻略帮助", desc: "有哪些攻略组" }
]

/**
 * 命令表里不单独占一行的那些：命令表首个触发词 → 在哪里讲
 *
 * 三种去处：`主帮助` 是在主帮助某条的说明里点了名；`上期` 是「上期X」，由 X 那一条与战绩区块的前提一并讲；
 * 其余是细分帮助的触发词，在那张图里逐条印出。只收冷门或成对出现的那一半，每条都由测试核对真的讲到了。
 */
export const IN_GUIDE: Readonly<Record<string, "主帮助" | "上期" | "绑定帮助" | "面板帮助" | "抽卡帮助">> = {
  CK代码: "主帮助",
  CK池: "主帮助",
  角色养成: "主帮助",
  七圣卡牌: "主帮助",
  签到状态: "主帮助",
  重置用户缓存: "主帮助",
  枯萎苗圃: "主帮助",
  迷失之地: "主帮助",
  区域收集: "主帮助",
  上期深渊: "上期",
  上期式舆防卫战: "上期",
  上期危局强袭战: "上期",
  上期拟境湮灭战: "上期",
  上期临界推演: "上期",
  删除CK: "绑定帮助",
  切换uid: "绑定帮助",
  删除uid: "绑定帮助",
  设备信息: "绑定帮助",
  绑定设备: "绑定帮助",
  解绑设备: "绑定帮助",
  展柜更新面板: "面板帮助",
  米游社更新面板: "面板帮助",
  刷新天赋: "面板帮助",
  删除面板: "面板帮助",
  查看面板图: "面板帮助",
  移除面板图: "面板帮助",
  抽卡分析: "抽卡帮助",
  删除抽卡链接: "抽卡帮助"
}

/**
 * 把一条按游戏分写的字段取成这个游戏的那一句，`{p}` 换成该游戏的记号（`#` / `*` / `%`）
 * @param value 字段
 * @param game 游戏
 * @returns 文本；该游戏没写时取原神那句，再没有则空串
 */
export function inGame(value: PerGame, game: GameKey): string {
  const one = typeof value === "string" ? value : (value[game] ?? value.gs ?? "")
  return one.replaceAll("{p}", SHORT_PREFIX[game])
}

/**
 * 某个游戏下的全部区块，只留这个游戏能用的条目
 * @param game 游戏
 * @returns 逐区块；空区块不留
 */
export function catalogOf(game: GameKey): CatalogSection[] {
  return CATALOG.map(sec => ({ ...sec, items: sec.items.filter(one => one.games.includes(game)) })).filter(sec => sec.items.length > 0)
}
