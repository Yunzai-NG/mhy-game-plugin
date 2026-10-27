/**
 * 模块职责：面板数据源的契约 —— 各源如何拼地址、如何把返回映射成统一形态
 * 依赖方向：依赖 panel/profile（统一形态）与 meta/loader（查角色元数据）；不发请求
 * 生命周期：无状态，各源是模块级常量
 * 注意事项：取数与解析分开 —— 此处只留两个纯函数（{@link PanelSource.url} 拼地址、{@link PanelSource.parse}
 *          映射），发请求、写库、回消息都在外层（serv/index.ts），故映射可喂真实响应单测。失败分 `error`
 *          （稍后重试）与 `empty`（去游戏里放角色）两类，对使用者要做的事不同，不可合并。
 */
import type { MetaLoader } from "../../meta/loader.js"
import type { PanelGame, PanelProfile } from "../profile/index.js"

/** 失败的类别 */
export type ProfileFailKind =
  /** 服务侧出问题，稍后重试 */
  | "error"
  /** 展柜为空，要在游戏里放角色并打开显示详情 */
  | "empty"
  /** 该源不支持这个游戏 */
  | "unsupported"
  /** 缺元数据算不出属性（绝区零属性本地计算，非重试可解） */
  | "noMeta"

/** 一次映射失败 */
export interface ProfileFail {
  /** 恒为假，供调用方判别 */
  ok: false
  /** 失败类别 */
  kind: ProfileFailKind
  /** 服务侧给的原文，有则附上 */
  message?: string
  /** 建议的冷却秒数 */
  cd: number
}

/** 一次映射成功 */
export interface ProfileOk {
  /** 恒为真 */
  ok: true
  /** 统一形态的面板 */
  profile: PanelProfile
  /** 服务侧给的冷却秒数，据此决定下次可更新的时间 */
  cd: number
}

/** 映射结果 */
export type ProfileResult = ProfileOk | ProfileFail

/** 解析时能用到的外部依赖 */
export interface ParseDeps {
  /** 元数据装载器，查角色 id、天赋表与套装名 */
  meta: MetaLoader
  /** uid，写进结果里 */
  uid: string
}

/** 一个面板数据源 */
export interface PanelSource {
  /** 源标识，与配置项里的取值对应 */
  id: string
  /** 展示名，失败提示里会带上它 */
  name: string
  /** 支持的游戏 */
  game: PanelGame
  /**
   * 取数走米游社而非公开接口
   *
   * 米游社源没有可请求的地址，数据由外层带 Cookie 走鉴权接口取来再喂给 `parse`；显式标记而非让 `url()` 返回空串。
   */
  fromMys?: boolean
  /**
   * 拼请求地址
   *
   * {@link fromMys} 为真的源不走这里，返回空串即可。
   * @param uid uid
   * @returns 完整地址
   */
  url: (uid: string) => string
  /**
   * 把返回映射成统一形态
   * @param data 服务返回的已解析 JSON
   * @param deps 外部依赖
   * @returns 映射结果
   */
  parse: (data: unknown, deps: ParseDeps) => ProfileResult
}

/** 各类失败的建议冷却 */
export const FAIL_CD: Readonly<Record<ProfileFailKind, number>> = {
  error: 60,
  empty: 5 * 60,
  unsupported: 0,
  noMeta: 0
}

/**
 * 造一个失败结果
 * @param kind 类别
 * @param message 服务侧原文
 * @returns 失败结果
 */
export function fail(kind: ProfileFailKind, message?: string): ProfileFail {
  return { ok: false, kind, cd: FAIL_CD[kind], ...(message ? { message } : {}) }
}

/**
 * 取返回里的冷却秒数
 *
 * Enka 系与 Mihomo 系都在顶层给 `ttl`；缺失时按 60 秒。
 * @param data 服务返回
 * @returns 冷却秒数
 */
export function ttlOf(data: unknown): number {
  const ttl = (data as { ttl?: unknown } | null)?.ttl
  return Number(ttl) || 60
}

/** 面向使用者的失败文案 */
const FAIL_TEXT: Readonly<Record<ProfileFailKind, string>> = {
  error: "面板服务暂时不可用，请稍后重试",
  empty: "请把角色放进游戏内的角色展柜并打开「显示详情」，等 5 分钟后再试",
  unsupported: "该游戏暂不支持面板查询",
  noMeta: "绝区零面板属性改为本地计算，请让主人发送 #更新元数据 后重试"
}

/**
 * 把失败转成一条可据以操作的提示
 * @param one 失败结果
 * @param servName 源的展示名
 * @returns 提示文案
 */
export function profileFailText(one: ProfileFail, servName = ""): string {
  const head = servName ? `面板服务 ${servName}：` : ""
  return `${head}${FAIL_TEXT[one.kind]}${one.message ? `（${one.message}）` : ""}`
}
