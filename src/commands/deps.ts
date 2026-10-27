/**
 * 模块职责：命令层的依赖包 —— 把插件的四个服务与配置读取集中成一个参数
 * 依赖方向：依赖本插件的服务模块与配置类型；不依赖内核的 `PluginContext`
 * 生命周期：随插件 setup 组装一次
 * 注意事项：命令实现只收本依赖包、不收 `ctx`，故单测无须启动完整内核。
 *
 *          **配置传函数而非取值**：面板上改完的开关要即时生效，缓存快照会变成"改了要重启"。
 */
import type { HttpClient, Logger } from "@yunzai-ng/types"
import type { CookiePool } from "../store/ck.js"
import type { MhyConfigView } from "../config.js"
import type { RenderBridge } from "../core/render.js"
import type { DeviceStore } from "../core/device.js"
import type { GachaStore } from "../store/gacha.js"
import type { GachaFileStore } from "../store/gacha-file.js"
import type { AliasTable } from "../meta/alias.js"
import type { WifeMetaTable } from "../meta/wife.js"
import type { WifeStore } from "../store/wife.js"
import type { ArtiMetaTable } from "../meta/arti.js"
import type { ArtiSetTable } from "../meta/arti-set.js"
import type { BuffTable } from "../meta/buffs.js"
import type { DmgBuffLoader } from "../panel/dmg/index.js"
import type { PanelBuilder } from "../panel/build.js"
import type { PanelImgStore } from "../panel/img.js"
import type { ProfileRank } from "../panel/rank.js"
import type { ProfileServ } from "../panel/serv/index.js"
import type { ZzzScoreTable } from "../panel/score/index.js"
import type { ZzzPanelBuilder } from "../panel/zzz/index.js"
import type { FaceStore } from "../store/face.js"
import type { PanelStore } from "../store/panel.js"
import type { MetaInstaller } from "../meta/download.js"
import type { MetaLoader } from "../meta/loader.js"
import type { MaterialTable } from "../meta/material.js"
import type { PoolTable } from "../meta/pool.js"
import type { MysService } from "../service/mys.js"
import type { QrLoginService } from "../service/qr-login.js"
import type { AuthKeyService } from "../service/authkey.js"
import type { LiveCodeService } from "../service/live-code.js"
import type { RefreshCkService } from "../service/refresh-ck.js"
import type { SignService } from "../service/sign.js"
import type { NoteRemindStore } from "../store/note.js"
import type { OriginalImgStore } from "../store/original.js"
import type { SignStore } from "../store/sign.js"
import type { CalendarService } from "../service/calendar.js"
import type { MaterialImgService } from "../service/material-img.js"
import type { StrategyService } from "../service/strategy.js"
import type { CharStatService } from "../service/wiki-stat.js"
import type { UserStore } from "../store/user.js"

/** 元数据的两件套：装它的与读它的 */
export interface MetaBundle {
  /** 安装与增量更新 */
  installer: MetaInstaller
  /** 装载与查询 */
  loader: MetaLoader
  /**
   * 丢掉一切从元数据读来的缓存，装完或更新完调一次
   *
   * 各表各自缓存，漏掉哪一处都表现为「更新了却仍按旧数据算」且不报错，故收成这一个口子、不在调用处逐个列。
   */
  reload: () => void
}

/** 命令实现能用到的一切 */
export interface MhyDeps {
  /** 查询服务 */
  mys: MysService
  /** Cookie 池 */
  cookies: CookiePool
  /** 用户档案 */
  users: UserStore
  /** 设备存储 */
  devices: DeviceStore
  /** 抽卡记录 */
  gacha: GachaStore
  /** 抽卡记录的本地存档，可选：缺它时导出照常，只是盘上不留副本 */
  gachaFiles?: GachaFileStore
  /** 抽卡链接自助获取，可选：缺它时 `#更新抽卡记录` 退回手贴链接那条路 */
  authKey?: AuthKeyService
  /** 刷新查询 Cookie，可选：缺它时 `#刷新CK` 只回一句指路 */
  refreshCk?: RefreshCkService
  /** 前瞻直播兑换码，可选：一个凭据都不要，与 `#兑换码` 是两回事 */
  liveCode?: LiveCodeService
  /** 渲染桥，可选：只驱动文本分支的测试不必造它 */
  render?: RenderBridge
  /** 元数据，可选：只驱动文本分支的测试无须装一份 300MB 的元数据 */
  meta?: MetaBundle
  /** 卡池版本表，可选 */
  pool?: PoolTable
  /** 圣遗物词条元数据表，可选：读 `resources/` 下的 JSON，装不装元数据都能用 */
  artiMeta?: ArtiMetaTable
  /** 静态 buff 表，可选：缺它则套装与武器精炼的加成不计入 */
  buffs?: BuffTable
  /** 圣遗物套装索引，可选：读已安装的元数据，未装时为空表 */
  artiSets?: ArtiSetTable
  /** 角色别名表，可选：此处收它只为 `#更新元数据` 装完后能丢缓存 */
  alias?: AliasTable
  /** 材料表，可选：读已安装的元数据，未装时为空表 */
  materials?: MaterialTable
  /** 「老婆 / 老公」四类可选名单，可选：读已安装的元数据，未装时为空表 */
  wife?: WifeMetaTable
  /** 使用者自己指定的那几位「老婆 / 老公」，可选：缺它时只是"设置"与"列表"两支不可用 */
  wifePick?: WifeStore
  /**
   * 图鉴的全服统计取数器
   *
   * 可选，且**即便传了也可能一律返回 undefined**（`enableWikiStat` 缺省关闭），
   * 故调用方须按"那四块可能没有"来写。本插件唯一一处向米哈游之外的服务发请求的地方。
   */
  charStat?: CharStatService
  /** 角色攻略，可选，且即便传了也可能是关着的 —— 先问一句 `on` */
  strategy?: StrategyService
  /** 米游社合集里的素材图，可选：读写数据目录下的缓存 */
  materialImgs?: MaterialImgService
  /** 日历取数器，可选：打米游社的公开公告接口（不带 Cookie），缓存十分钟 */
  calendar?: CalendarService
  /**
   * 签到服务
   *
   * 可选。**它是唯一会代替使用者向米游社写入的东西**，故只有主人打开 `enableAutoSign`
   * 才会被定时任务驱动；`#米游社签到` 手动执行不受那道开关限制，但只用发起者自己的 Cookie。
   */
  sign?: SignService
  /** 签到开关与流水，可选，与 {@link sign} 成对出现；不存任何凭据 */
  signs?: SignStore
  /** 扫码登录，可选：它取的是 stoken（权限大于绑定 CK 那一份），故只在私聊中受理 */
  qrLogin?: QrLoginService
  /**
   * 体力提醒的开关与节流
   *
   * 可选。它只读便笺，但会**在使用者不知情时定时查询并主动推送**，
   * 故同样有一道部署者的总开关（`enableStaminaRemind`，缺省关）。
   */
  reminds?: NoteRemindStore
  /** 面板取数器，可选 */
  panel?: ProfileServ
  /** 面板数据库，可选：{@link panel} 负责取一次，这一个负责存哪、怎么与旧数据合并 */
  panels?: PanelStore
  /**
   * 面板装配器
   *
   * 可选，且**即便传了也可能算不出面板** —— 它要读已安装的元数据（等级曲线、词条表、
   * 套装名）。故调用方须先问一句 `ready(game)`。
   */
  panelBuilder?: PanelBuilder
  /**
   * 绝区零驱动盘评分
   *
   * 可选。绝区零的属性由米游社算好，不走等级曲线与词条档位，评分只要权重表；
   * 它读 `meta-zzz/equip/artis-mark.js`，缺表时按职业挑一套通用权重。
   *
   * **命令层一般不直接用它**，而是经 {@link zzzPanelBuilder}：评分该在装配时挂好。
   */
  zzzScore?: ZzzScoreTable
  /**
   * 绝区零面板装配器
   *
   * 可选。它是 {@link panelBuilder} 的兄弟而非分支：这一层只把存下来的那份转成
   * 「detail 必有、评分已挂好」的形态，不读元数据也不发请求。
   */
  zzzPanelBuilder?: ZzzPanelBuilder
  /** 群面板排行，可选：私聊里没有排行（它按群分组） */
  ranks?: ProfileRank
  /** 面板图，可选：读写 `dataDir` 下的目录 */
  panelImgs?: PanelImgStore
  /**
   * 玩家头像库，可选
   *
   * 缺它时页头一律垫各游戏自带的默认头像 —— 页头照常出图，只是不带本人的那张。
   */
  faces?: FaceStore
  /**
   * 原图索引
   *
   * 可选。**只在平台既回消息 id、又在引用里带消息 id 时起作用**，
   * 故调用方一律按"可能取不到"来写。
   */
  originals?: OriginalImgStore
  /**
   * 伤害 buff 装载器
   *
   * 可选，且**即便传了也可能一律返回空表** —— `enableDmgCalc` 缺省关闭，关着时它不求值
   * 任何文件。故调用方须按"伤害一栏可能没有"来写。
   */
  dmgBuffs?: DmgBuffLoader
  /** HTTP 客户端，可选：仅用于读取使用者发来的文件（UIGF 导入） */
  http?: HttpClient
  /** 插件版本，内核取自 package.json；可选，测试里不给 */
  version?: string
  /** 取当前配置 */
  config: () => MhyConfigView
  /** 日志器 */
  logger: Logger
}
