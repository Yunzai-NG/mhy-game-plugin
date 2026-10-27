/**
 * 模块职责：插件入口 —— 把米哈游游戏能力注册进内核
 * 依赖方向：只依赖 `@yunzai-ng/core`、`@yunzai-ng/types` 与本插件内部模块
 * 生命周期：`setup` 执行一次；设备存储只是 KV 的薄封装，无需清理
 * 注意事项：一切能力均通过 `ctx` 注册，内核对米哈游与本插件均无感知。设备能力经 `ctx.provide("mihoyo.device")` 对外提供，其他插件（如自建签到）应共用同一台设备（各用一套设备信息等同于制造「多设备登录」的风控特征）。
 */
import { join } from "node:path"
import { definePlugin, parseDuration, seg } from "@yunzai-ng/core"
import type { ContactCache, Segment } from "@yunzai-ng/types"
import { CONFIG_SCHEMA } from "./config.js"
import type { MhyConfigView } from "./config.js"
import { MysClient } from "./core/client.js"
import { CaptchaService } from "./core/captcha.js"
import { AliasTable } from "./meta/alias.js"
import { WifeMetaTable } from "./meta/wife.js"
import { MaterialTable } from "./meta/material.js"
import { ArtiMetaTable } from "./meta/arti.js"
import { ArtiSetTable } from "./meta/arti-set.js"
import { BuffTable } from "./meta/buffs.js"
import { META_GAMES, MetaInstaller } from "./meta/download.js"
import { MetaLoader } from "./meta/loader.js"
import { PoolTable } from "./meta/pool.js"
import { CalendarService } from "./service/calendar.js"
import { MaterialImgService } from "./service/material-img.js"
import { StrategyService } from "./service/strategy.js"
import { CharStatService } from "./service/wiki-stat.js"
import { PanelBuilder } from "./panel/build.js"
import { ZzzScoreTable } from "./panel/score/index.js"
import { ZzzPanelBuilder } from "./panel/zzz/index.js"
import { PanelImgStore } from "./panel/img.js"
import { ProfileRank } from "./panel/rank.js"
import type { CharRule } from "./panel/score/index.js"
import { DmgBuffLoader } from "./panel/dmg/buffs.js"
import { sandboxDeps } from "./panel/dmg/deps.js"
import { ProfileServ } from "./panel/serv/index.js"
import { PanelStore } from "./store/panel.js"
import { CookiePool } from "./store/ck.js"
import { FaceStore } from "./store/face.js"
import { registerMhyCommands } from "./commands/index.js"
import { DeviceStore } from "./core/device.js"
import { GachaStore } from "./store/gacha.js"
import { GachaFileStore } from "./store/gacha-file.js"
import { RenderBridge } from "./core/render.js"
import { traced } from "./core/trace.js"
import { configureComma, configureFaceStyle } from "./views/panel.js"
import { MysService } from "./service/mys.js"
import { SignService } from "./service/sign.js"
import { QrLoginService } from "./service/qr-login.js"
import { AuthKeyService } from "./service/authkey.js"
import { RefreshCkService } from "./service/refresh-ck.js"
import { LiveCodeService } from "./service/live-code.js"
import { dailySign } from "./service/sign-task.js"
import { autoUpdateMeta, noticeKey } from "./service/meta-task.js"
import { REMIND_SCAN, remindStamina } from "./service/note-task.js"
import { WidgetService } from "./service/widget.js"
import { NoteRemindStore } from "./store/note.js"
import { OriginalImgStore } from "./store/original.js"
import { SignStore } from "./store/sign.js"
import { WifeStore } from "./store/wife.js"
import { UserStore } from "./store/user.js"

/** 对外提供的设备服务键 */
export const DEVICE_SERVICE = "mihoyo.device"
/** 对外提供的米游社接口服务键 */
export const API_SERVICE = "mihoyo.api"

/** 对外提供的 Cookie 池服务键 */
export const COOKIE_SERVICE = "mihoyo.cookies"

/** 对外提供的用户档案服务键 */
export const USER_SERVICE = "mihoyo.users"

/** 对外提供的查询服务键 —— 其他插件查询米游社数据仅需注入该服务 */
export const MYS_SERVICE = "mihoyo.mys"

/** 对外提供的抽卡记录服务键 */
export const GACHA_SERVICE = "mihoyo.gacha"

/**
 * 对外提供的元数据服务键
 *
 * 其他插件想查角色 id / 简称 / 图标时注入它即可，不必自己再下一份三百兆。
 */
export const META_SERVICE = "mihoyo.meta"

/**
 * 对外提供的面板取数服务键
 *
 * 注入它即可按 uid 取一份统一形态的面板（`PanelProfile`，见 panel/profile/index.ts），无须关心数据来自
 * Enka、Mihomo 还是米游社 —— 挑源、限流与映射都在它内部。
 */
export const PANEL_SERVICE = "mihoyo.panel"

/**
 * 体力提醒那条消息前面的一句话
 *
 * 光发一张便笺图会让人以为是自己刚查的；一句话把"这是主动推的"说清楚。
 */
const REMIND_TIP = "【体力提醒】体力快满了，记得去清一下"

/**
 * 从在线的 Bot 里挑一个能发到这个平台的
 *
 * 主动推送（自动签到的结果、体力提醒）都要它：使用者标识形如 `qq:10001`，前半截是平台名。
 * `want` 给了就先按 `selfId` 找那一个 —— 部署者挂两个号时，按平台名随便挑会挑到没进那个群
 * 的那一个，表现为"提醒不响"且日志里看不出原因。
 * 找不到那个号（掉线了、被删了）才退回同平台的第一个：发出去总比不发好。
 * @param bots 在线的 Bot
 * @param platform 平台名
 * @param want 想用的 Bot 号
 * @returns Bot；该平台没有在线的 Bot 时 undefined
 */
function botOf<T extends { platform: string; selfId: string }>(
  bots: readonly T[],
  platform: string,
  want?: string
): T | undefined {
  let fallback: T | undefined
  for (const one of bots) {
    if (one.platform !== platform) continue
    if (want && one.selfId === want) return one
    if (!fallback) fallback = one
  }
  return fallback
}

export default definePlugin({
  // 版本与说明由内核取自 package.json；名字仍写明，0.7.0 的内核不会替入口补名字
  name: "mhy-game",
  configSchema: CONFIG_SCHEMA,
  provides: [
    DEVICE_SERVICE,
    API_SERVICE,
    COOKIE_SERVICE,
    USER_SERVICE,
    MYS_SERVICE,
    GACHA_SERVICE,
    META_SERVICE,
    PANEL_SERVICE
  ],

  setup(ctx) {
    /**
     * 读配置 —— 恒以 schema 缺省值兜底
     *
     * `ctx.config.get()` 有两种情形给出**不完整**的配置（内核未接管 configSchema、或配置文件被手改），少一项会**以 undefined 参与运算**，功能静默失效而日志无字，故一律补齐。按对象标识缓存合并结果。
     */
    const defaults = CONFIG_SCHEMA.parse({}) as MhyConfigView
    let lastRaw: unknown
    let lastView: MhyConfigView = defaults
    const config = (): MhyConfigView => {
      const got = ctx.config.get()
      if (got !== lastRaw) {
        lastRaw = got
        lastView = (got && typeof got === "object" ? { ...defaults, ...got } : defaults) as MhyConfigView
      }
      return lastView
    }

    // 内核未接管配置时上面的兜底会让插件按缺省值照常运行，故必须在日志说清（否则「改了配置却毫无反应」无从查起）。已知成因：插件目录下的 node_modules 装有一份框架包、遮蔽宿主的那份
    if (Object.keys((ctx.config.get() as object | null | undefined) ?? {}).length === 0) {
      ctx.logger.warn(
        "[米游社] 配置未被内核接管，本次按缺省值运行：面板与 config/mhy-game.yaml 的改动一律不生效。" +
          "请检查插件目录下是否存在 node_modules —— 其中若装有 @yunzai-ng/core，会遮蔽宿主的那一份，" +
          "删掉该目录后重启即可"
      )
    }

    // 本插件发往外部的请求一律经它：逐条记 info，并计入所在命令的汇总（见 core/trace.ts）
    const http = traced(ctx.http, ctx.logger)

    /**
     * 元数据装在数据目录而非插件目录下：它是下载来的三百兆，插件更新不该冲掉。
     *
     * 只落盘 JSON、图片与按**文件名**放行的几个 `.js`（见 meta/download.ts 的 `#filenames`）。`calc.js`/`artis.js` 恒落盘：
     * 面板属性要从里面解析静态 buff；送不送进沙箱执行只由 `enableDmgCalc` 决定（见 {@link DmgBuffLoader}）。
     */
    const metaDir = join(ctx.dataDir, "meta")
    const installer = new MetaInstaller({
      dir: metaDir,
      http,
      logger: ctx.logger,
      host: config().metaHost
    })
    /**
     * 别名表 —— 把「椰羊」「岩王帝君」这类社区叫法译回角色名
     *
     * 读**已安装的元数据**（`meta-{game}/character/alias.json`），故新角色别名随元数据即时可用。那份由安装器落盘后就地生成；包里的 `alias.js` 恒放行落盘、**只被解析、从不求值**（见 meta/alias-parse.ts）。
     */
    const alias = new AliasTable({ dir: metaDir })

    /**
     * 四类可选角色名单 —— `#老婆` 一族从它里面挑人
     *
     * 与别名表同理：名单写在元数据 `character/extra.js`、逐版本增补、随元数据走，**只被解析、从不求值**（见 meta/extra-parse.ts）。
     */
    const wife = new WifeMetaTable({ dir: metaDir })

    // 装载器把别名表作为「id → 名称 → 别名」查找链的最后一级，故须在其构造时传入
    const loader = new MetaLoader({ dir: metaDir, logger: ctx.logger, alias })
    // reload 引用的几张表在后面才造出来；它只在 setup 之后被调用，届时都已就位
    const meta = {
      installer,
      loader,
      reload: (): void => {
        loader.reload()
        alias.reload()
        wife.reload()
        artiSets.reload()
        materials.reload()
        dmgBuffs.reload()
        pool.reload()
        artiMeta.reload()
        buffs.reload()
        zzzScore.reload()
      }
    }

    /**
     * 面板图目录 —— 使用者上传的角色立绘
     *
     * 与元数据一样落数据目录下，理由更强：这是使用者攒的数据，放插件目录意味着一次更新把群友上传的图全冲掉。
     */
    const panelImgDir = join(ctx.dataDir, "panel-img")

    /** 玩家头像库，落数据目录下；两个地址前缀传函数故改完即生效 */
    const faceDir = join(ctx.dataDir, "face")
    const faces = new FaceStore({
      dir: faceDir,
      http,
      kv: ctx.kv.sub("face"),
      logger: ctx.logger,
      host: () => config().pfpsHost,
      assetHost: () => config().assetHost
    })

    // 渲染桥：把既有模板依赖的路径变量按本插件安装位置算好；渲染精度传函数、改完即生效
    const render = new RenderBridge(
      ctx.root,
      () => ctx.version,
      metaDir,
      panelImgDir,
      () => config().renderScale,
      faceDir,
      () => ctx.app.version
    )

    // 数字分隔位数与头像风格（见 views/panel.ts 的 configureComma）：本插件仅有的模块级可变状态、纯展示偏好、改完即生效
    configureComma(() => config().commaGroup)
    configureFaceStyle(() => config().faceStyle)

    /**
     * 卡池版本表
     *
     * **唯一来源是已装的元数据**（`meta-<游戏>/info/pool.js`，三游戏同名同形）。缺它时 `ready(game)` 为假、命令层据此让使用者更新元数据，而不是拿过期表判 UP。
     */
    const pool = new PoolTable({ metaDir })

    /**
     * 词条元数据（读已装的 `artifact/` 词条表与默认评分表，只解析不求值）与静态 buff 表
     *
     * 有了它们**圣遗物评分与面板属性计算都不需要沙箱**（只有伤害公式需要，见 meta/sandbox.ts）。
     */
    const artiMeta = new ArtiMetaTable({ metaDir, logger: ctx.logger })
    const buffs = new BuffTable({ metaDir, logger: ctx.logger })

    /**
     * 套装索引与面板取数器
     *
     * 套装索引读**已安装的元数据**（`meta-{gs,sr}/artifact/data.json`、套装名与部位名逐版本新增）；星铁星级档位表同在其下、本就是 `.json`、不需离线转换也不需沙箱。面板服务选择传函数、改完即生效。
     */
    const artiSets = new ArtiSetTable({ dir: metaDir })
    /**
     * 材料表 —— 天赋书 / 武器材料的星级阶梯与"周几能刷"
     *
     * 读**已安装的元数据**；每周轮换来自包里 `material/daily.js`（同 `alias.js` 恒放行落盘、**只被解析、从不求值**，见 meta/daily-parse.ts），随元数据走才能让新国家的天赋书当天认出。
     */
    const materials = new MaterialTable({ dir: metaDir, logger: ctx.logger })
    /**
     * 图鉴的全服统计取数器
     *
     * **本插件唯一一处向米哈游之外的服务发请求的地方**，故由 `enableWikiStat` 把关且缺省关闭。关着时不发包、图鉴照常出、只少「平均命座/持有率/常用武器/常用圣遗物」四块（那四块只有第三方统计站这一来源）。见 service/wiki-stat.ts。
     */
    const charStat = new CharStatService({
      http,
      kv: ctx.kv.sub("wikiStat"),
      logger: ctx.logger,
      enabled: () => config().enableWikiStat
    })
    /**
     * 角色攻略 —— 取使用者自己维护的那个索引仓库（与元数据同一维护者）
     *
     * 与 {@link CharStatService} 分清：那个是第三方站故缺省关、这个缺省开。索引按需现取、缓存六小时、**不装资源包**（见 service/strategy.ts）。
     */
    const strategy = new StrategyService({
      dir: join(ctx.dataDir, "strategy"),
      http,
      kv: ctx.kv.sub("strategy"),
      logger: ctx.logger,
      enabled: () => config().enableCharStrategy,
      host: () => config().strategyHost
    })
    /**
     * 米游社合集里的素材图 —— `#刻晴素材`
     *
     * 走米游社公开合集接口，不带 Cookie、不需 DS 签名，故不进 core/api.ts 那张表。
     */
    const materialImgs = new MaterialImgService({
      dir: join(ctx.dataDir, "material-img"),
      http,
      kv: ctx.kv.sub("materialImg"),
      logger: ctx.logger
    })
    /**
     * 日历 —— `#日历` / `#活动`
     *
     * 走米游社公开公告接口（不带 Cookie、不需 DS 签名），故不进 core/api.ts。`fix` 传函数：那层是**第三方**（miao.games）打给活动时间表的补丁、由 `enableCalendarFix` 把关且缺省关（关着时不发包、几条排版认不出的活动退回列表给的时间）。
     */
    const calendar = new CalendarService({
      http,
      kv: ctx.kv.sub("calendar"),
      logger: ctx.logger,
      fix: () => config().enableCalendarFix
    })
    const profileServ = new ProfileServ({
      http,
      kv: ctx.kv.sub("panel"),
      logger: ctx.logger,
      meta: loader,
      arti: artiMeta,
      sets: artiSets,
      servCfg: game =>
        game === "gs" ? config().profileServer : game === "sr" ? config().srProfileServer : config().zzzProfileServer
    })

    /**
     * 伤害 buff 装载器 —— 本插件唯一会执行下载来的代码的地方
     *
     * `enabled` 传函数：`enableDmgCalc` 缺省关、关着时返回空表不求值、改完即生效。注入的依赖只有三个成员（`Format.comma`/`Format.percent`/`lodash.forEach`），见 dmg/deps.ts。
     */
    const dmgBuffs = new DmgBuffLoader({
      dir: metaDir,
      // 绝区零的公式不 import 默认评分表（它的覆盖表另由 ZzzScoreTable 读），故注入空表
      deps: game => sandboxDeps(game === "zzz" ? {} : artiMeta.usefulAttr(game)),
      logger: ctx.logger,
      enabled: () => config().enableDmgCalc
    })

    /**
     * 面板数据库与装配器
     *
     * 三者分工：{@link ProfileServ} 取一次、{@link PanelStore} 存哪与怎么合并、{@link PanelBuilder} 把存的变成可展示的属性与评分。看面板只读库、不每次打面板服务。
     * `artisRule` 从沙箱取角色自定义评分规则（`character/<名>/artis.js`）；伤害计算关闭时返回 undefined、评分回落默认权重表。
     */
    const panels = new PanelStore({ kv: ctx.kv.sub("panelData") })
    /**
     * 群面板排行
     *
     * **不用有序集合**（`KvNamespace` 没有）：一个角色一个键、值为 uid→分数的普通对象、读时排序（此处 n 是群内查过某角色的人数、可接受）。详见 panel/rank.ts。
     */
    const ranks = new ProfileRank({
      kv: ctx.kv.sub("panelRank"),
      limit: () => config().groupRankLimit,
      number: () => config().rankNumber
    })
    const panelImgs = new PanelImgStore({ dir: panelImgDir, http, logger: ctx.logger })

    /**
     * 抽卡记录的本地存档
     *
     * `#抽卡导出` 除把文件发给使用者、另在数据目录留一份。**发文件依赖平台能力**（`sendFile` 不少适配器发不出），这一路不依赖平台，故「导出失败」至少还留下盘上那份。落数据目录（同面板图理由）。
     */
    const gachaFiles = new GachaFileStore({ dir: join(ctx.dataDir, "gacha"), logger: ctx.logger })
    // 原图索引：出图时记一笔「这张图立绘取自哪个文件」，`#原图` 凭被引用的消息 id 取回
    const originals = new OriginalImgStore({ kv: ctx.kv.sub("original"), logger: ctx.logger })

    const panelBuilder = new PanelBuilder({
      meta: loader,
      arti: artiMeta,
      sets: artiSets,
      buffs,
      // 装载器刻意把返回留作 unknown（不反向依赖评分层），此处按评分层契约收窄
      artisRule: (game, name) => dmgBuffs.artisRule(game, name) as CharRule | undefined
    })

    /**
     * 绝区零驱动盘评分的权重表
     *
     * 绝区零面板属性由米游社算好、不走 {@link panelBuilder} 的等级曲线与档位（它有自己的装配层）。权重读 `meta-zzz/equip/artis-mark.js`。`canonical` 交给别名表（表里写正式名 `星见雅`、接口给短名 `雅`）。
     */
    const zzzScore = new ZzzScoreTable({
      metaDir,
      canonical: name => alias.nameIn("zzz", name)
    })

    /**
     * 绝区零面板的装配收口
     *
     * 与 {@link panelBuilder} 是兄弟：那层按元数据算属性，这层只把存的转成「detail 必有、评分已挂好」的形态。**评分表在此传一次**、于是各消费点不必再各判「评分表在不在」。
     */
    const zzzPanelBuilder = new ZzzPanelBuilder({ score: zzzScore })

    const devices = new DeviceStore({
      kv: ctx.kv.sub("device"),
      logger: ctx.logger,
      // 传函数而非取值：使用者改有效期后即时生效、无需重启
      fpMaxAge: () => parseDuration(config().deviceFpMaxAge, 15 * 24 * 60 * 60 * 1000)
    })

    ctx.provide(DEVICE_SERVICE, devices)

    /**
     * 响应缓存
     *
     * LRU 的 ttl 创建时固定、而使用者可能随时改缓存时长，故 ttl 变化时换新实例（丢弃旧实例即即时生效）。刻意仅置内存（秒级易失数据、写盘 KV 只是转移 IO）。
     */
    let ttl = 0
    let lru: ContactCache<unknown> | undefined
    const cache = (): ContactCache<unknown> => {
      const want = parseDuration(config().cacheTtl, 60_000)
      if (!lru || want !== ttl) {
        ttl = want
        lru = ctx.cache<unknown>({ max: 500, ttl: want })
      }
      return lru
    }

    const client = new MysClient({
      http,
      logger: ctx.logger,
      devices,
      cache: {
        get: key => cache().get(key),
        set: (key, value) => cache().set(key, value),
        delete: key => cache().delete(key)
      },
      timeout: () => parseDuration(config().requestTimeout, 15_000)
    })

    ctx.provide(API_SERVICE, client)

    const cookies = new CookiePool({
      kv: ctx.kv.sub("cookie"),
      logger: ctx.logger,
      devices
    })
    const users = new UserStore({ kv: ctx.kv.sub("user") })

    /*
     * 过码服务只在配了地址时起作用
     *
     * 地址空着时 `enabled` 为假、风控表现与未接入时一字不差，故无条件构造、不必再加开关。过码用使用者自行部署的独立服务，见 core/captcha.ts。
     */
    const captcha = new CaptchaService({
      http,
      logger: ctx.logger,
      address: () => config().captchaService,
      timeout: () => parseDuration(config().requestTimeout, 15_000),
      wait: () => parseDuration(config().captchaWait, 120_000)
    })
    const mys = new MysService({ client, cookies, users, logger: ctx.logger, captcha })

    // 签到不经 MysClient：它的签名是另一套（DS1）、请求头与 Referer 也另有一套，
    // 混进查询那条链会让"查询用的 DS"这一既有约定变成两种情况（见 core/sign-api.ts）
    const signs = new SignStore({ kv: ctx.kv.sub("sign") })
    const sign = new SignService({ http, logger: ctx.logger, devices })

    // `#老婆` 一族里使用者自己指定的那几位（见 store/wife.ts）。名单本身来自元数据，这里只存选择
    const wifePick = new WifeStore({ kv: ctx.kv.sub("wife") })

    // 体力提醒只读便笺（走上面那条查询链），但它会在使用者不知情的情况下定时查、还会主动发消息，
    // 故与签到一样有一道部署者的总开关；任务体在 service/note-task.ts
    const reminds = new NoteRemindStore({ kv: ctx.kv.sub("remind") })

    /**
     * 小组件取数 —— 只给体力提醒的后台轮询用
     *
     * 凭 stoken 走官方桌面小组件接口：同账号同体力，但**不吃验证码**（实时便笺风控最紧、后台每天查几次易撞 `1034`、撞上后使用者手动查也一并被挡）。
     * **不进命令依赖包**：当场 `#体力` 仍走实时便笺（那条要字段最全，而小组件不给派遣剩余、宝钱回复、周本折扣）。
     */
    const widget = new WidgetService({ http, cookies, devices, logger: ctx.logger })

    /**
     * 扫码登录 —— 取 stoken 的那条路
     *
     * 取到的凭据权限大于 `#绑定CK`（能换 cookie_token、签到、取米游币），故只私聊受理、凭据不进日志。落地后小组件取数、社区签到与米游币三处才有得用。
     */
    const qrLoginService = new QrLoginService({ http, logger: ctx.logger, devices })

    // 抽卡记录不经 MysClient：其不使用 Cookie 与 DS 签名，域名亦为另一套（参见 gacha.ts）
    const gacha = new GachaStore({
      kv: ctx.kv.sub("gacha"),
      http,
      logger: ctx.logger,
      timeout: () => parseDuration(config().requestTimeout, 15_000)
    })

    // 凭 stoken 换抽卡 authkey：让扫码登录过的账号 `#更新抽卡记录` 无须手贴链接（见 service/authkey.ts）
    const authKeyService = new AuthKeyService({ http, devices, logger: ctx.logger })

    // 凭 stoken 换一份新的查询 Cookie：cookie_token 会过期，而 stoken 的寿命长得多（见 service/refresh-ck.ts）
    const refreshCk = new RefreshCkService({ http, logger: ctx.logger, devices, cookies })

    // 前瞻直播兑换码：一个凭据都不要，三条公开接口（见 service/live-code.ts）
    const liveCode = new LiveCodeService({ http, logger: ctx.logger })

    ctx.provide(COOKIE_SERVICE, cookies)
    ctx.provide(USER_SERVICE, users)
    ctx.provide(MYS_SERVICE, mys)
    ctx.provide(GACHA_SERVICE, gacha)
    ctx.provide(META_SERVICE, meta)
    ctx.provide(PANEL_SERVICE, profileServ)

    registerMhyCommands(ctx, {
      mys,
      cookies,
      users,
      devices,
      gacha,
      authKey: authKeyService,
      refreshCk,
      liveCode,
      config,
      render,
      meta,
      pool,
      artiMeta,
      buffs,
      artiSets,
      alias,
      wife,
      wifePick,
      materials,
      charStat,
      strategy,
      materialImgs,
      calendar,
      sign,
      signs,
      qrLogin: qrLoginService,
      reminds,
      panel: profileServ,
      panels,
      panelBuilder,
      zzzScore,
      zzzPanelBuilder,
      ranks,
      panelImgs,
      faces,
      gachaFiles,
      originals,
      dmgBuffs,
      http,
      version: ctx.version,
      logger: ctx.logger
    })

    /**
     * 每日自动签到
     *
     * **两道开关都开才签**：这道是部署者总闸（`enableAutoSign` 缺省关）、另一道是每个使用者按账号开。任务体在 service/sign-task.ts。`overlap: "skip"` 刻意如此（一轮遍历所有账号、账号多时可能跑得比周期长、排队叠两轮打米游社正是撞码的做法）。
     */
    if (config().enableAutoSign) {
      ctx.cron(
        config().autoSignCron,
        async signal => {
          // 任务只在 setup 时按开关注册；面板上关掉后每轮再判一次，关即停、不必等重启
          if (!config().enableAutoSign) return
          const ret = await dailySign({
            cookies,
            signs,
            sign,
            logger: ctx.logger,
            signal,
            notify: async (user: string, text: string): Promise<boolean> => {
              const [platform, uid] = user.split(":")
              if (!platform || !uid) return false
              const bot = botOf(ctx.app.bots.online(), platform)
              if (!bot) return false
              try {
                await bot.sendMessage({ scene: "private", uid }, text)
                return true
              } catch {
                return false
              }
            }
          })
          ctx.logger.info(
            `[米游社][签到] 本轮结束：开了自动签到 ${ret.total} 个账号，签了 ${ret.ran} 个，` +
              `跳过 ${ret.skipped} 个，出错 ${ret.failed} 个`
          )
        },
        { name: "米游社每日签到", overlap: "skip", timeout: "30m" }
      )
    }

    /**
     * 体力提醒
     *
     * **两道开关都开才推**：这道是部署者总闸（`enableStaminaRemind` 缺省关）、另一道是每个使用者发一次 `#体力提醒`。任务体在 service/note-task.ts。用 `every` 而非 cron（周期只决定「最多晚到多久」、请求量由每条 `nextAt` 决定）。**只在真查过的那轮记日志**（五分钟一条「本轮 0 个」会刷屏）。
     */
    if (config().enableStaminaRemind) {
      ctx.every(
        REMIND_SCAN,
        async signal => {
          if (!config().enableStaminaRemind) return
          const ret = await remindStamina({
            reminds,
            mys,
            widget,
            logger: ctx.logger,
            signal,
            notify: async (state, payload): Promise<boolean> => {
              const [platform, uid] = state.user.split(":")
              if (!platform || !uid) return false
              const bot = botOf(ctx.app.bots.online(), platform, state.botId)
              if (!bot) return false

              /* 先试出图、出不来发文字（同 `#体力` 的回退口径）；定时任务里没有 `e.renderReply`、故走 `ctx.render` 拿图片段 */
              let body: Segment | string = payload.text
              try {
                const shot = await ctx.render(payload.template, render.dress(payload.data))
                const only = Array.isArray(shot) ? shot[0] : shot
                if (only) body = only
              } catch (err) {
                ctx.logger.debug(
                  `[米游社][体力提醒] 出图失败，改发文字：${err instanceof Error ? err.message : String(err)}`
                )
              }

              try {
                // 群里开的就发到那个群并 @ 他（提醒的意义是把人叫回来、没有 @ 的群消息与没发无异）
                if (state.groupId) {
                  await bot.sendMessage({ scene: "group", gid: state.groupId }, [seg.at(uid), REMIND_TIP, body])
                } else {
                  await bot.sendMessage({ scene: "private", uid }, [REMIND_TIP, body])
                }
                return true
              } catch {
                return false
              }
            }
          })
          if (ret.checked > 0) {
            ctx.logger.info(
              `[米游社][体力提醒] 本轮查了 ${ret.checked} 个（开着的共 ${ret.total} 个，` +
                `其中 ${ret.byWidget} 个走小组件），提醒 ${ret.sent} 个，失败 ${ret.failed} 个`
            )
          }
        },
        { name: "米游社体力提醒", overlap: "skip", timeout: "10m" }
      )
    }

    /**
     * 元数据定时增量更新
     *
     * 与自动安装分工：那处只在启动时补首次三百兆、这处按周期看有没有新提交。两者都缺省关、都是「插件主动发请求并写盘」。任务体在 service/meta-task.ts。通知主人走 `policy.masters`（裸 uid、不带平台）、按在线 Bot 逐个试发。
     */
    if (config().enableMetaAutoUpdate) {
      const noticeKv = ctx.kv.sub("meta")
      // 周期换成毫秒再传：配置里 duration 是「数字或带单位的串」，而 `every` 要后者那个字面量联合类型
      ctx.every(
        parseDuration(config().metaAutoUpdateInterval, 12 * 60 * 60 * 1000),
        async () => {
          if (!config().enableMetaAutoUpdate) return
          await autoUpdateMeta({
            installer,
            logger: ctx.logger,
            lastNotice: async game => await noticeKv.get<number>(noticeKey(game)),
            setNotice: async (game, at) => {
              if (at === undefined) await noticeKv.del(noticeKey(game))
              else await noticeKv.set(noticeKey(game), at)
            },
            notify: async (text: string): Promise<boolean> => {
              let ok = false
              for (const uid of ctx.app.policy.masters) {
                for (const bot of ctx.app.bots.online()) {
                  try {
                    await bot.sendMessage({ scene: "private", uid }, text)
                    ok = true
                    break
                  } catch {
                    continue
                  }
                }
              }
              return ok
            },
            reload: meta.reload,
            notice: () => config().metaAutoErrorNotice,
            noticeGap: () => parseDuration(config().metaAutoErrorNoticeInterval, 60 * 60 * 1000)
          })
        },
        { name: "米游社元数据自动更新", overlap: "skip", timeout: "30m" }
      )
    }

    /**
     * 缺失时自动装元数据
     *
     * 刻意不 await：三百兆要下好几分钟、挂住 setup 等于挂住框架启动；缺元数据时各命令仍可用、只是抽卡统计少图标，故后台补齐。失败只记一条日志（启动阶段没有可回复的对象）。
     */
    if (config().autoInstallMeta) {
      void (async (): Promise<void> => {
        for (const game of META_GAMES) {
          try {
            const ret = await installer.install(game, { installOnly: true })
            if (ret.status === "error") ctx.logger.warn(`[米游社][元数据] meta-${game} ${ret.message}`)
          } catch (err) {
            ctx.logger.warn(`[米游社][元数据] meta-${game} 安装失败：${err instanceof Error ? err.message : String(err)}`)
          }
        }
        meta.reload()
      })()
    }
  }
})
