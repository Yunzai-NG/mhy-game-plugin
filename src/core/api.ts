/**
 * 模块职责：米游社接口表 —— 接口名 → URL / query / body
 * 依赖方向：只依赖本插件的 region 模块，不做任何 IO
 * 生命周期：无状态纯函数，每次请求现算
 * 注意事项：query 串里参数的顺序是签名的组成部分 —— DS 以 `q=` 原样参与 md5，改动顺序
 *          等于改动签名输入。每条 query 的写法固定，一律不按字母序或任何规则重排，
 *          `role_id=...&server=...` 一类看似可重排的顺序应视为常量。
 *
 *          按游戏拆分函数，每次只构造当前游戏那一张表；fp 不在接口表内，
 *          其请求体来自设备信息（见 device-profile.ts）。
 */
import type { GameKey } from "./region.js"
import { gameBiz, isCnServer } from "./region.js"

/** 三组域名，随国服 / 国际服切换 */
export interface ApiHosts {
  /** 通用业务域 */
  host: string
  /** 战绩（game_record）域 */
  hostRecord: string
  /** 设备指纹域 */
  hostPublicData: string
}

/** 国服域名 */
const CN_HOSTS: ApiHosts = {
  host: "https://api-takumi.mihoyo.com/",
  hostRecord: "https://api-takumi-record.mihoyo.com/",
  hostPublicData: "https://public-data-api.mihoyo.com/"
}

/** 国际服域名 */
const OS_HOSTS: ApiHosts = {
  host: "https://sg-public-api.hoyolab.com/",
  hostRecord: "https://bbs-api-os.hoyolab.com/",
  hostPublicData: "https://sg-public-data-api.hoyoverse.com/"
}

/**
 * 取对应区服的域名组
 * @param cn 是否国服
 * @returns 域名组
 */
export function apiHosts(cn: boolean): ApiHosts {
  return cn ? CN_HOSTS : OS_HOSTS
}

/**
 * 取 device_fp 接口地址
 * @param cn 是否国服
 * @returns getFp 的完整 URL
 */
export function fpUrl(cn: boolean): string {
  return `${apiHosts(cn).hostPublicData}device-fp/api/getFp`
}

/** 接口的额外参数，按接口取用 */
export interface ApiData {
  /** 深渊 / 混沌回忆期数，1 本期 2 上期 */
  schedule_type?: number
  /** 札记月份 */
  month?: number | string
  /** 角色 id */
  avatar_id?: number | string
  /** 角色 id 列表（角色面板批量查询） */
  character_ids?: (number | string)[]
  /**
   * 代理人 id 列表（绝区零面板查询）
   *
   * 与 {@link character_ids} 分立：那条是 POST 请求体字段，这条要展成
   * `id_list[]=1011&id_list[]=1021` 拼进 query。
   */
  id_list?: (number | string)[]
  /** 尘歌壶分享码 */
  share_code?: string
  /** 计算器列表类型，默认 avatar */
  type?: string
  /** 星铁计算器来源标记 */
  tab_from?: string
  /** 兑换码 */
  cdk?: string
  /** POST 请求体 */
  body?: Record<string, unknown>
}

/** 一条接口的定义 */
export interface ApiSpec {
  /** 完整 URL，不含 query */
  url: string
  /** query 串，顺序即签名顺序 */
  query?: string
  /**
   * 拼在 {@link query} 之后、但不进签名的那一段
   *
   * 为绝区零的 `id_list[]` 而设：重复出现的数组参数在算完签名之后才拼到 URL 上。
   * 不含前导的 `&`，由客户端拼接。
   */
  tail?: string
  /** 请求体对象，存在即用 POST */
  body?: Record<string, unknown>
  /**
   * 要先拿一份游戏级登录态（etoken）的活动页接口：值是 `game_biz`
   *
   * 官方页（如绝区零代理人养成）先 POST `common/badge/v1/login/account` 换一枚游戏 cookie，再带着它请求；
   * 只发通行证 CK 时这一族一律回 `-100 未登录`，而那并不说明 CK 失效（见 client.ts 的 {@link MysClient}）。
   */
  etoken?: string
}

/** 构造接口表需要的上下文 */
export interface ApiContext {
  /** 游戏 uid */
  uid: string | number
  /** 游戏 */
  game: GameKey
  /** 区服标识 */
  server: string
}

/**
 * 图形验证的两条接口，三个游戏共用同一份定义
 *
 * `createVerification` 的 `is_high=true` 不可省：省掉时下发的是另一种验证串，
 * 校验通过也不解除战绩接口上的风控。
 * @param cn 是否国服
 * @param data 接口参数，`body` 为 validate
 * @returns 接口名 → 定义
 */
function verifyApis(cn: boolean, data: ApiData): Record<string, ApiSpec> {
  const { hostRecord } = apiHosts(cn)
  return {
    createVerification: {
      url: `${hostRecord}game_record/app/card/wapi/createVerification`,
      query: "is_high=true"
    },
    verifyVerification: {
      url: `${hostRecord}game_record/app/card/wapi/verifyVerification`,
      ...(data.body ? { body: data.body } : {})
    }
  }
}

/**
 * 原神接口表
 * @param ctx 接口上下文
 * @param data 接口参数
 * @returns 接口名 → 定义
 */
function gsApis(ctx: ApiContext, data: ApiData): Record<string, ApiSpec> {
  const { uid, server } = ctx
  const cn = isCnServer(server)
  const { host, hostRecord } = apiHosts(cn)
  const os = server.startsWith("os")

  const map: Record<string, ApiSpec> = {
    ...verifyApis(cn, data),
    UserGame: {
      url: `${host}binding/api/getUserGameRolesByCookie`,
      query: `game_biz=${gameBiz("gs", cn)}&region=${server}&game_uid=${uid}`
    },
    // 绑定 CK 时还不知道 uid，所以单独留一条不带 uid 的查询：拿回来的正是这个账号
    // 名下的角色列表，uid 由它来补
    bindings: {
      url: `${host}binding/api/getUserGameRolesByCookie`,
      query: `game_biz=${gameBiz("gs", cn)}`
    },
    index: {
      url: `${hostRecord}game_record/app/genshin/api/index`,
      query: `role_id=${uid}&server=${server}`
    },
    spiralAbyss: {
      url: `${hostRecord}game_record/app/genshin/api/spiralAbyss`,
      query: `role_id=${uid}&schedule_type=${data.schedule_type ?? 1}&server=${server}`
    },
    role_combat: {
      url: `${hostRecord}game_record/app/genshin/api/role_combat`,
      query: `role_id=${uid}&need_detail=true&server=${server}`
    },
    hard_challenge: {
      url: `${hostRecord}game_record/app/genshin/api/hard_challenge`,
      query: `role_id=${uid}&server=${server}&need_detail=true`
    },
    hard_challenge_popularity: {
      url: `${hostRecord}game_record/app/genshin/api/hard_challenge/popularity`,
      query: `role_id=${uid}&server=${server}`
    },
    // 绘想游迹（幻想真境剧诗的角色专精），与 role_combat 分开的一条只读接口
    char_master: {
      url: `${hostRecord}game_record/app/genshin/api/char_master`,
      query: `role_id=${uid}&server=${server}`
    },
    character: {
      url: `${hostRecord}game_record/app/genshin/api/character/list`,
      body: { role_id: uid, server }
    },
    characterDetail: {
      url: `${hostRecord}game_record/app/genshin/api/character/detail`,
      body: { role_id: uid, server, character_ids: data.character_ids }
    },
    dailyNote: {
      url: `${hostRecord}game_record/app/genshin/api/dailyNote`,
      query: `role_id=${uid}&server=${server}`
    },
    detail: {
      url: `${host}event/e20200928calculate/v1/sync/avatar/detail`,
      query: `uid=${uid}&region=${server}&avatar_id=${data.avatar_id}`
    },
    ys_ledger: {
      url: "https://hk4e-api.mihoyo.com/event/ys_ledger/monthInfo",
      query: `month=${data.month}&bind_uid=${uid}&bind_region=${server}`
    },
    act_calendar: {
      url: `${hostRecord}game_record/app/genshin/api/act_calendar`,
      body: { role_id: uid, server }
    },
    compute: {
      url: `${host}event/e20200928calculate/v3/batch_compute`,
      ...(data.body ? { body: data.body } : {})
    },
    computeList: {
      url: `${host}event/e20200928calculate/v1/${data.type ?? "avatar"}/list`,
      ...(data.body ? { body: data.body } : {})
    },
    blueprintCompute: {
      url: `${host}event/e20200928calculate/v1/furniture/compute`,
      ...(data.body ? { body: data.body } : {})
    },
    blueprint: {
      url: `${host}event/e20200928calculate/v1/furniture/blueprint`,
      query: `share_code=${data.share_code}&region=${server}`
    },
    avatarSkill: {
      url: `${host}event/e20200928calculate/v1/avatarSkill/list`,
      query: `avatar_id=${data.avatar_id}`
    },
    basicInfo: {
      url: `${hostRecord}game_record/app/genshin/api/gcg/basicInfo`,
      query: `role_id=${uid}&server=${server}`
    },
    deckList: {
      url: `${hostRecord}game_record/app/genshin/api/gcg/deckList`,
      query: `role_id=${uid}&server=${server}`
    },
    avatar_cardList: {
      url: `${hostRecord}game_record/app/genshin/api/gcg/cardList`,
      query: `limit=999&need_action=false&need_avatar=true&need_stats=true&offset=0&role_id=${uid}&server=${server}`
    },
    action_cardList: {
      url: `${hostRecord}game_record/app/genshin/api/gcg/cardList`,
      query: `limit=999&need_action=true&need_avatar=false&need_stats=true&offset=0&role_id=${uid}&server=${server}`
    },
    // 兑换码目前只有国际服放开，国服请求由命令层提前拦下
    useCdk: {
      url: "https://sg-hk4e-api.hoyolab.com/common/apicdkey/api/webExchangeCdkeyHyl",
      query: `cdkey=${data.cdk}&game_biz=hk4e_global&lang=zh-cn&region=${server}&t=${Date.now()}&uid=${uid}`
    }
  }

  // 国际服的养成计算器、札记、天赋详情走另一套域名与参数（多一个 lang）
  if (os) {
    map["detail"] = {
      url: "https://sg-public-api.hoyolab.com/event/calculateos/sync/avatar/detail",
      query: `lang=zh-cn&uid=${uid}&region=${server}&avatar_id=${data.avatar_id}`
    }
    map["avatarSkill"] = {
      url: "https://sg-public-api.hoyolab.com/event/calculateos/avatar/skill_list",
      query: `lang=zh-cn&avatar_id=${data.avatar_id}`
    }
    map["compute"] = {
      url: "https://sg-public-api.hoyolab.com/event/calculateos/compute",
      ...(data.body ? { body: data.body } : {})
    }
    map["blueprint"] = {
      url: "https://sg-public-api.hoyolab.com/event/calculateos/furniture/blueprint",
      query: `share_code=${data.share_code}&region=${server}&lang=zh-cn`
    }
    map["blueprintCompute"] = {
      url: "https://sg-public-api.hoyolab.com/event/calculateos/furniture/compute",
      body: { lang: "zh-cn", ...data.body }
    }
    map["ys_ledger"] = {
      url: "https://sg-hk4e-api.hoyolab.com/event/ysledgeros/month_info",
      query: `lang=zh-cn&month=${data.month}&uid=${uid}&region=${server}`
    }
  }

  return map
}

/**
 * 星穹铁道接口表
 * @param ctx 接口上下文
 * @param data 接口参数
 * @returns 接口名 → 定义
 */
function srApis(ctx: ApiContext, data: ApiData): Record<string, ApiSpec> {
  const { uid, server } = ctx
  const cn = isCnServer(server)
  const { host, hostRecord } = apiHosts(cn)
  const schedule = data.schedule_type ?? 1

  return {
    ...verifyApis(cn, data),
    UserGame: {
      url: `${host}binding/api/getUserGameRolesByCookie`,
      query: `game_biz=${gameBiz("sr", cn)}&region=${server}&game_uid=${uid}`
    },
    bindings: {
      url: `${host}binding/api/getUserGameRolesByCookie`,
      query: `game_biz=${gameBiz("sr", cn)}`
    },
    index: {
      url: `${hostRecord}game_record/app/hkrpg/api/index`,
      query: `role_id=${uid}&server=${server}`
    },
    basicInfo: {
      url: `${hostRecord}game_record/app/hkrpg/api/role/basicInfo`,
      query: `role_id=${uid}&server=${server}`
    },
    // 混沌回忆
    spiralAbyss: {
      url: `${hostRecord}game_record/app/hkrpg/api/challenge`,
      query: `isPrev=true&need_all=true&role_id=${uid}&schedule_type=${schedule}&server=${server}`
    },
    // 虚构叙事
    challengeStory: {
      url: `${hostRecord}game_record/app/hkrpg/api/challenge_story`,
      query: `isPrev=&need_all=true&role_id=${uid}&schedule_type=${schedule}&server=${server}`
    },
    // 末日幻影
    challengeBoss: {
      url: `${hostRecord}game_record/app/hkrpg/api/challenge_boss`,
      query: `isPrev=&need_all=true&role_id=${uid}&schedule_type=${schedule}&server=${server}`
    },
    // 异相仲裁
    challengePeak: {
      url: `${hostRecord}game_record/app/hkrpg/api/challenge_peak`,
      query: `isPrev=&need_all=true&role_id=${uid}&schedule_type=${schedule}&server=${server}`
    },
    avatarInfo: {
      url: `${hostRecord}game_record/app/hkrpg/api/avatar/info`,
      query: `need_wiki=true&role_id=${uid}&server=${server}`
    },
    // 达成成就数：逐个成就系列的进度，另给金银铜三档的枚数
    achievement: {
      url: `${hostRecord}game_record/app/hkrpg/api/achievement_info`,
      query: `role_id=${uid}&server=${server}`
    },
    // 战利品开启：逐个星球下逐个区域的宝箱进度
    chest: {
      url: `${hostRecord}game_record/app/hkrpg/api/chest_info`,
      query: `role_id=${uid}&server=${server}`
    },
    // 模拟宇宙。两个参数都不可省：`schedule_type` 不给返回空（1 本期 / 2 上期 / 3 全部 / 4 合并），
    // `need_detail` 不给时 `records` 是空数组，表现为"暂无通关数据"而非报错
    rogue: {
      url: `${hostRecord}game_record/app/hkrpg/api/rogue`,
      query: `need_detail=true&role_id=${uid}&schedule_type=3&server=${server}`
    },
    // 货币战争·零和博弈。`archive_type` 不可省：不给时报 `10041`，那个码与凭据失效的表现极像。
    // 取 1 即普通存档。返回分 `grid_fight_brief` 与 `grid_fight_archive_list` 两段
    gridFight: {
      url: `${hostRecord}game_record/app/hkrpg/api/grid_fight`,
      query: `archive_type=1&role_id=${uid}&server=${server}`
    },
    // 不可知域。参数与 `rogue` 同形，但记录分 `normal_record_list` 与 `custom_record_list` 两栏。
    // 当期没打时两栏都空而 `basic_info.magic_record` 各项为 0，那不是失败
    rogueMagic: {
      url: `${hostRecord}game_record/app/hkrpg/api/rogue_magic`,
      query: `need_detail=true&role_id=${uid}&schedule_type=${schedule}&server=${server}`
    },
    ys_ledger: {
      url: `${host}event/srledger/month_info`,
      query: `lang=zh-cn&region=${server}&uid=${uid}&month=${data.month}`
    },
    character: {
      url: `${hostRecord}game_record/app/hkrpg/api/avatar/basic`,
      query: `role_id=${uid}&server=${server}`
    },
    dailyNote: {
      url: `${hostRecord}game_record/app/hkrpg/api/note`,
      query: `role_id=${uid}&server=${server}`
    },
    act_calendar: {
      url: `${hostRecord}game_record/app/hkrpg/api/get_act_calender`,
      query: `role_id=${uid}&server=${server}`
    },
    compute: {
      url: `${host}event/rpgcalc/compute`,
      query: "game=hkrpg",
      ...(data.body ? { body: data.body } : {})
    },
    detail: {
      url: `${host}event/rpgcalc/avatar/detail`,
      query: `game=hkrpg&lang=zh-cn&item_id=${data.avatar_id}&tab_from=${data.tab_from}&change_target_level=0&uid=${uid}&region=${server}`
    },
    useCdk: {
      url: "https://sg-hkrpg-api.hoyolab.com/common/apicdkey/api/webExchangeCdkeyHyl",
      query: `cdkey=${data.cdk}&game_biz=hkrpg_global&lang=zh-cn&region=${server}&t=${Date.now()}&uid=${uid}`
    }
  }
}

/**
 * 绝区零接口表
 * @param ctx 接口上下文
 * @param data 接口参数
 * @returns 接口名 → 定义
 */
function zzzApis(ctx: ApiContext, data: ApiData): Record<string, ApiSpec> {
  const { uid, server } = ctx
  const cn = isCnServer(server)
  const { host, hostRecord } = apiHosts(cn)
  const schedule = data.schedule_type ?? 1

  // 国际服的战绩接口既换域名又多一个 lang。判据取服务器名后缀而非 {@link isCnServer}：
  // 绝区零的服务器是 `prod_gf_cn` / `prod_gf_us` 这一族，与另两个游戏不同形
  const os = /_us|_eu|_jp|_sg/.test(server)
  const rec = os
    ? "https://sg-act-nap-api.hoyolab.com/event/game_record_zzz/api/zzz"
    : `${hostRecord}event/game_record_zzz/api/zzz`
  const lang = os ? "lang=zh-cn&" : ""

  // 战绩接口的参数名有两套，不可互换：一半用 `role_id` + `server`（index、便笺、式舆防卫战、
  // 零号空洞），另一半用 `uid` + `region`（危局强袭战、拟境湮灭战、临界推演、拟真鏖战、区域收集）
  const byRole = `${lang}role_id=${uid}&server=${server}`
  const byUid = `${lang}uid=${uid}&region=${server}`

  const map: Record<string, ApiSpec> = {
    ...verifyApis(cn, data),
    UserGame: {
      url: `${host}binding/api/getUserGameRolesByCookie`,
      query: `game_biz=${gameBiz("zzz", cn)}&region=${server}&game_uid=${uid}`
    },
    bindings: {
      url: `${host}binding/api/getUserGameRolesByCookie`,
      query: `game_biz=${gameBiz("zzz", cn)}`
    },
    index: {
      url: `${rec}/index`,
      query: byRole
    },
    character: {
      url: `${rec}/avatar/basic`,
      query: byRole
    },
    // 代理人面板详情。`id_list` 要展成重复的 `id_list[]=`，且落在 {@link ApiSpec.tail} 而非
    // `query` 里。这一条国服也带 `lang`：返回里的代理人名、属性名、套装名都按它本地化。
    // `need_wiki=false`：为真时会多带整套技能与影画长文，那些元数据包里已有
    avatarInfo: {
      url: `${rec}/avatar/info`,
      query: `lang=zh-cn&role_id=${uid}&server=${server}&need_wiki=false`,
      tail: (data.id_list ?? []).map(one => `id_list[]=${one}`).join("&")
    },
    // 便笺**偏偏不带 lang**，国际服也一样
    dailyNote: {
      url: `${rec}/note`,
      query: `role_id=${uid}&server=${server}`
    },
    // 邦布
    buddy: {
      url: `${rec}/buddy/info`,
      query: byRole
    },
    // 式舆防卫战。旧版深渊走另一个字段，故返回里要先看 `hadal_ver` 是不是 `v2`
    spiralAbyss: {
      url: `${rec}/hadal_info_v2`,
      query: `${byRole}&schedule_type=${schedule}`
    },
    // 危局强袭战
    challengeDeadly: {
      url: `${rec}/hadal_mem_detail_v2`,
      query: `${byUid}&schedule_type=${schedule}`
    },
    // 拟境湮灭战
    challengeHoloBoss: {
      url: `${rec}/holo_boss_detail`,
      query: `${byUid}&schedule_type=${schedule}`
    },
    // 拟真鏖战试炼。**没有期次参数**，一次返回四个赛季
    climbingTower: {
      url: `${rec}/climbing_tower_detail`,
      query: byUid
    },
    // 临界推演的总览：期次列表与各期概要
    voidFrontAbstract: {
      url: `${rec}/void_front_battle_abstract_info`,
      query: byUid
    },
    // 临界推演的某一期明细
    voidFront: {
      url: `${rec}/void_front_battle_period_detail`,
      query: `${byUid}&schedule_type=${schedule}`
    },
    // 迷宫诡域的概要
    zenkov: {
      url: `${rec}/zenkov_abstract_info`,
      query: byUid
    },
    // 迷宫诡域的逐场战绩
    zenkovDetail: {
      url: `${rec}/zenkov_detail`,
      query: byUid
    },
    // 零号空洞的概要
    hollowZero: {
      url: `${rec}/abyss_abstract`,
      query: byRole
    },
    // 零号空洞的挑战明细，`type=3` 即当前那一档
    hollowZeroDetail: {
      url: `${rec}/abyss_detail`,
      query: `${byRole}&type=3`
    },
    // 迷失之地
    hollowZeroS2: {
      url: `${rec}/abysss2_abstract`,
      query: byUid
    },
    // 活动日历分两条：调频（卡池）与活动，均为 `uid` + `region`
    gacha_calendar: {
      url: `${rec}/gacha_calendar`,
      query: byUid
    },
    activity_calendar: {
      url: `${rec}/activity_calendar`,
      query: byUid
    },
    // 养成计算器（「代理人养成」H5 那一套，只有国服）：先取当前练度，再按目标等级算消耗。
    // 字段照官方页 `act.mihoyo.com/zzz/event/character-builder` 的分包写；身份认的是 etoken 而非 query 里的 uid
    cultivateDetail: {
      url: "https://act-api-takumi.mihoyo.com/event/nap_cultivate_tool/user/batch_avatar_detail_v2",
      query: `uid=${uid}&region=${server}`,
      body: { avatar_list: [{ avatar_id: Number(data.avatar_id), is_teaser: false }] },
      etoken: gameBiz("zzz", cn)
    },
    cultivateCalc: {
      url: "https://act-api-takumi.mihoyo.com/event/nap_cultivate_tool/user/avatar_calc",
      query: `uid=${uid}&region=${server}`,
      ...(data.body ? { body: data.body } : {}),
      etoken: gameBiz("zzz", cn)
    },
    // 区域收集。这一条连国际服也不带 lang
    exploration: {
      url: `${rec}/exploration_detail`,
      query: `uid=${uid}&region=${server}`
    },
    // 菲林月报。与另两个游戏共用 `ys_ledger` 这个名字，故命令层不必按游戏挑接口名。
    // 它在 `host` 下而不在战绩域名下；`month` 形如 `202601`，不给即当月
    ys_ledger: {
      url: `${host}event/nap_ledger/month_info`,
      query: data.month ? `month=${data.month}&region=${server}&uid=${uid}` : `region=${server}&uid=${uid}`
    },
    useCdk: {
      url: "https://public-operation-nap.hoyolab.com/common/apicdkey/api/webExchangeCdkeyHyl",
      query: `cdkey=${data.cdk}&game_biz=nap_global&lang=zh-cn&region=${server}&t=${Date.now()}&uid=${uid}`
    }
  }

  return map
}

/** 各游戏的接口表构造函数 */
const API_TABLES: Readonly<Record<GameKey, (ctx: ApiContext, data: ApiData) => Record<string, ApiSpec>>> = {
  gs: gsApis,
  sr: srApis,
  zzz: zzzApis
}

/**
 * 取一个游戏的全部接口名
 *
 * 给 `#接口列表` 之类的排障命令用，也让测试能遍历全部接口断言 URL 形态。
 * @param game 游戏
 * @returns 接口名数组
 */
export function apiNames(game: GameKey): string[] {
  return Object.keys(API_TABLES[game]({ uid: "100000000", game, server: "cn_gf01" }, {}))
}

/**
 * 取一条接口定义
 * @param type 接口名
 * @param ctx 接口上下文
 * @param data 接口参数
 * @returns 接口定义；接口名不存在时 undefined
 */
export function buildApi(type: string, ctx: ApiContext, data: ApiData = {}): ApiSpec | undefined {
  return API_TABLES[ctx.game](ctx, data)[type]
}

/**
 * 抽卡记录接口的地址表
 *
 * 不走上面那套接口表：它不用 Cookie、不用 DS，凭的是游戏内链接里的 authkey，域名也另一套。
 * 国服 / 国际服由 region 自己指明 —— 那个 region 读自使用者贴的链接，未必与他绑的 uid 同服。
 */
const GACHA_HOSTS: Readonly<Record<GameKey, { cn: string; os: string }>> = {
  gs: {
    cn: "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog",
    os: "https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog"
  },
  sr: {
    cn: "https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getGachaLog",
    os: "https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog"
  },
  zzz: {
    cn: "https://public-operation-nap.mihoyo.com/common/gacha_record/api/getGachaLog",
    os: "https://public-operation-nap-sg.hoyoverse.com/common/gacha_record/api/getGachaLog"
  }
}

/** 三个游戏国服 region 的写法，各不相同；国际服一律走 `-sg` 域名 */
const CN_GACHA_REGIONS = new Set(["cn_gf01", "cn_qd01", "prod_gf_cn", "prod_qd_cn"])

/**
 * 取抽卡记录接口地址
 * @param game 游戏
 * @param region 链接里带的 region
 * @returns 完整 URL
 */
export function gachaLogUrl(game: GameKey, region: string): string {
  const hosts = GACHA_HOSTS[game]
  return CN_GACHA_REGIONS.has(region) ? hosts.cn : hosts.os
}
