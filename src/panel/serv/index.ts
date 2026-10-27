/**
 * 模块职责：面板数据源的选取与取数 —— 按 uid 与配置挑一个源，发请求，交给它映射
 * 依赖方向：依赖各源（enka / sr / mys）与 ctx.http、ctx.kv；是本层唯一碰 IO 的地方
 * 生命周期：随插件 setup 造一个实例
 * 注意事项：服务器由 uid 去掉末八位后的前缀判定（1~4 官服、5 B 服、6~9 与 18 国际服），三类缺省一律走各游戏官方源（原神 Enka、星铁 Mihomo）。
 *          配置项 `profileServer` 是一串数字、第 n 位对应第 n 类服务器（位数不足回落第一位），这是现有配置文件的形态，勿改。
 *          序号 `0`/`1` 都落缺省源（`1` 原指已下线的私有服务，仍填 1 的按「自动」处理，直接报错会让升级前配过 1 的人面板不可用）。
 *          冷却按 uid 记在 kv（限的是对某 uid 的查询频率，非某人）。**取数失败与映射失败分开**：网络超时/DNS/502 归 `error`（重试），只有服务确答「展柜为空」才是 `empty`。
 *          绝区零只有米游社源（{@link DEFAULT_BY_TYPE} 三类都指它），配置项对它无效，取数由命令层走 `fromMys` 不经这里的 HTTP。
 */
import type { HttpClient, KvNamespace, Logger } from "@yunzai-ng/types"
import { resolveRegionKind } from "../../core/region.js"
import type { ArtiMetaTable } from "../../meta/arti.js"
import type { ArtiSetTable } from "../../meta/arti-set.js"
import type { MetaLoader } from "../../meta/loader.js"
import type { PanelGame } from "../profile/index.js"
import { ENKA_SOURCES } from "./enka.js"
import { ENKA_ZZZ_SOURCES } from "./enka-zzz.js"
import { makeMysSources } from "./mys.js"
import { SR_SOURCES } from "./sr.js"
import { ZZZ_SOURCES } from "./zzz.js"
import { fail, type PanelSource, type ProfileResult } from "./types.js"
import { traceNote } from "../../core/trace.js"

/** 请求超时，固定为 20 秒 */
const TIMEOUT_MS = 20 * 1000

/** 取数期间的短冷却，防同一 uid 被并发请求打穿 */
const LOCK_CD = 20

/**
 * 原神：配置项序号 → 源标识
 *
 * `0`（自动）走 {@link DEFAULT_BY_TYPE}，`1` 不对应任何源、按自动处理，两者都不在此表内。
 */
const GS_BY_INDEX: Readonly<Record<string, string>> = {
  "2": "enka",
  "3": "mgg",
  "4": "hanxuan",
  "5": "lyln"
}

/** 星铁：配置项序号 → 源标识，`0` 与 `1` 同上 */
const SR_BY_INDEX: Readonly<Record<string, string>> = {
  "2": "homo",
  "3": "avocado",
  "4": "enkaHSR"
}

/**
 * 绝区零：配置项序号 → 源标识
 *
 * `2` 选 Enka 官方展柜（不要 Cookie，只看展柜里那 6 位、属性由本插件算）；`0`/`1` 走米游社源。**缺省是米游社** ——
 * Enka 那一路核心技档的档位映射仍待 Enka 服务恢复后拿真机响应确认，见 serv/enka-zzz.ts。
 */
const ZZZ_BY_INDEX: Readonly<Record<string, string>> = {
  "2": "enkaZZZ"
}

/**
 * 各类服务器的缺省源
 *
 * 三类一律走各游戏官方源；绝区零无公开展柜，三类都指米游社源。
 */
const DEFAULT_BY_TYPE: Readonly<Record<PanelGame, readonly string[]>> = {
  gs: ["enka", "enka", "enka"],
  sr: ["homo", "homo", "homo"],
  zzz: ["mysPanelZZZ", "mysPanelZZZ", "mysPanelZZZ"]
}

/** 各游戏的米游社源标识 */
const MYS_BY_GAME: Readonly<Record<PanelGame, string>> = {
  gs: "mysPanel",
  sr: "mysPanelHSR",
  zzz: "mysPanelZZZ"
}

/** 各游戏的「配置项序号 → 源标识」表；绝区零可选 Enka 展柜 */
const BY_INDEX: Readonly<Record<PanelGame, Readonly<Record<string, string>>>> = {
  gs: GS_BY_INDEX,
  sr: SR_BY_INDEX,
  zzz: ZZZ_BY_INDEX
}

/** 造取数器需要的东西 */
export interface ProfileServOptions {
  /** HTTP 客户端 */
  http: HttpClient
  /** kv，记冷却 */
  kv: KvNamespace
  /** 日志器 */
  logger: Logger
  /** 元数据装载器 */
  meta: MetaLoader
  /** 词条元数据表，米游社原神源反推副词条要用 */
  arti: ArtiMetaTable
  /** 套装表，星铁要用 */
  sets: ArtiSetTable
  /** 读配置：某个游戏的面板服务选择串 */
  servCfg: (game: PanelGame) => string
}

/** 一次取数的结果 */
export interface FetchProfileResult {
  /** 映射结果 */
  result: ProfileResult
  /** 用了哪个源 */
  serv: PanelSource
}

/**
 * 判一个 uid 属于哪类服务器
 *
 * **前缀表按游戏分，故要收 `game`**：原神星铁是「前缀 + 八位序号」，绝区零国服 uid 不足十位、无前缀，国际服才有 `10`/`13`/`15`/`17`。
 * 判据落在 {@link resolveRegionKind} 一处（按游戏取表）；另存一份只认原神星铁前缀的私表会让绝区零全落官服、其配置第三位永不生效。
 * 三档折算：官服 0、B 服 1、其余国际服 2。
 * @param uid uid
 * @param game 游戏
 * @returns 0 官服、1 B 服、2 国际服；判不出时按官服
 */
export function servTypeOf(uid: string, game: PanelGame): number {
  const kind = resolveRegionKind(uid, game)
  if (kind === "official") return 0
  if (kind === "bilibili") return 1
  return 2
}

/**
 * 面板取数器
 */
export class ProfileServ {
  readonly #opts: ProfileServOptions
  readonly #sources = new Map<string, PanelSource>()

  /**
   * @param opts 取数器选项
   */
  constructor(opts: ProfileServOptions) {
    this.#opts = opts
    for (const one of [...ENKA_SOURCES, ...SR_SOURCES, ...ZZZ_SOURCES, ...ENKA_ZZZ_SOURCES, ...makeMysSources(opts.arti, opts.sets)]) {
      this.#sources.set(one.id, one)
    }
  }

  /**
   * 按标识取一个源
   * @param id 源标识
   * @param game 游戏
   * @returns 源；没有时 undefined
   */
  source(id: string, game: PanelGame): PanelSource | undefined {
    const got = this.#sources.get(id)
    return got?.game === game ? got : undefined
  }

  /**
   * 挑一个源
   *
   * 判断次序不可改：先看是否强制走米游社，再按配置序号取，最后回落缺省源。序号 0 与 1 都落缺省源（那两个序号对应的服务已下线）。
   * @param uid uid
   * @param game 游戏
   * @param fromMys 为真时强制走米游社源
   * @returns 源
   */
  pick(uid: string, game: PanelGame, fromMys = false): PanelSource {
    if (fromMys) {
      const got = this.source(MYS_BY_GAME[game], game)
      if (got) return got
    }

    const type = servTypeOf(uid, game)
    const cfg = String(this.#opts.servCfg(game) || "0")
    // 第 n 位对应第 n 类服务器，位数不足时回落到第一位
    const idx = cfg[type] ?? cfg[0] ?? "0"

    const named = BY_INDEX[game][idx]
    if (named) {
      const got = this.source(named, game)
      if (got) return got
    }

    const def = DEFAULT_BY_TYPE[game][type] ?? DEFAULT_BY_TYPE[game][0] ?? ""
    const got = this.source(def, game)
    if (got) return got
    // 走到这里说明源表被改坏了，抛错比返回一个假源好定位
    throw new Error(`[米游社][面板] 找不到可用的面板服务：game=${game} type=${type} cfg=${cfg}`)
  }

  /**
   * 查某个 uid 的更新冷却
   *
   * **键里带发起者**：面板按用户分存，别人刚更新过并不会让我名下也有数据；若冷却按 uid 全局记，
   * 群里只要有人持续刷同一个 uid，其余人就永远取不到自己那份。代价是同一 uid 对上游的请求
   * 最多按人数翻倍，相对「一个人能卡住所有人」是更轻的那一侧。
   * @param user 发起者
   * @param uid uid
   * @returns 剩余秒数；不在冷却时 0
   */
  async cooldown(user: string, uid: string): Promise<number> {
    const until = await this.#opts.kv.get<number>(`panel:cd:${user}:${uid}`)
    if (!until) return 0
    return Math.max(0, Math.ceil((until - Date.now()) / 1000))
  }

  /**
   * 记一次冷却
   * @param user 发起者
   * @param uid uid
   * @param seconds 秒数
   */
  async setCooldown(user: string, uid: string, seconds: number): Promise<void> {
    if (seconds <= 0) return
    await this.#opts.kv.set(`panel:cd:${user}:${uid}`, Date.now() + seconds * 1000, { ttl: seconds * 1000 })
  }

  /**
   * 取一个 uid 的面板
   *
   * 米游社源不走这里的 HTTP：调用方须先用 cookie 取好数据由 `data` 传入（cookie 管理在 store/ck 那层）。
   * @param user 发起者，冷却按它分（见 {@link cooldown}）
   * @param uid uid
   * @param game 游戏
   * @param opts 取数选项
   * @returns 映射结果与所用的源
   */
  async fetch(
    user: string,
    uid: string,
    game: PanelGame,
    opts: {
      /** 强制走米游社源 */
      fromMys?: boolean
      /** 米游社源的数据，由调用方用 cookie 取好 */
      data?: unknown
      /**
       * 指名走某个源，优先于配置与 {@link fromMys}
       *
       * `#展柜更新面板` / `#米游社更新面板` 这类「指名走哪条」的命令要它：只靠 {@link pick} 会按配置选，
       * 于是绝区零那两条都落回米游社（它的配置缺省三类都指米游社），命令名与实际走的路对不上。
       */
      servId?: string
    } = {}
  ): Promise<FetchProfileResult> {
    const named = opts.servId ? this.source(opts.servId, game) : undefined
    const serv = named ?? this.pick(uid, game, opts.fromMys)
    traceNote(`面板源 ${serv.name}${named ? "（命令指定）" : ""}`)

    if (serv.fromMys) {
      if (opts.data === undefined) {
        return { result: fail("error", "缺少米游社数据"), serv }
      }
      const result = serv.parse(opts.data, { meta: this.#opts.meta, uid })
      await this.setCooldown(user, uid, result.cd)
      return { result, serv }
    }

    // 取数期间先压一个短冷却，避免同一 uid 被并发请求打穿
    await this.setCooldown(user, uid, LOCK_CD)

    const url = serv.url(uid)
    let body: unknown
    try {
      const started = Date.now()
      // 刻意取字节自行解码而非 `get<T>()` 自动解析：服务维护时返回 HTML 错误页，页面 <title> 里恰是真实原因
      const bytes = await this.#opts.http.buffer(url, {
        timeout: TIMEOUT_MS,
        // 这一串是第三方面板服务认客户端的标识，属对方接口入参，改了有的服务会拒绝，照文档原样发
        headers: { "User-Agent": "Miao-Plugin/3.1" }
      })
      const text = new TextDecoder().decode(bytes)
      this.#opts.logger.debug(`[米游社][面板] ${uid} 取数完毕，用时 ${Date.now() - started}ms，服务：${serv.name}，${bytes.length} 字节`)
      // 服务不可用时常返回一张 HTML 错误页，此时取标题当原文比抛 JSON 解析错好读
      if (text.trimStart().startsWith("<")) {
        const title = /<title>(.+?)<\/title>/.exec(text)?.[1]
        this.#opts.logger.warn(`[米游社][面板] ${serv.name} 返回了网页而非数据：${title ?? "无标题"}`)
        const result = fail("error", title)
        await this.setCooldown(user, uid, result.cd)
        return { result, serv }
      }
      body = JSON.parse(text)
    } catch (err) {
      this.#opts.logger.warn(`[米游社][面板] ${serv.name} 取 ${uid} 失败：${err instanceof Error ? err.message : String(err)}`)
      const result = fail("error")
      await this.setCooldown(user, uid, result.cd)
      return { result, serv }
    }

    const result = serv.parse(body, { meta: this.#opts.meta, uid })
    if (!result.ok) this.#opts.logger.debug(`[米游社][面板] ${serv.name} 的 ${uid} 解析为失败：${result.kind} ${result.message ?? ""}`)
    await this.setCooldown(user, uid, result.cd)
    return { result, serv }
  }
}
