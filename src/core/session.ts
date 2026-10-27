/**
 * 模块职责：把内核的 `MessageEvent` 收敛成命令层真正需要的那几件事
 * 依赖方向：依赖类型包与本插件的 region / text；不依赖任何存储
 * 生命周期：每条消息一个，随事件回收
 * 注意事项：命令实现只认 {@link Session}，不认 `MessageEvent` —— 每条命令都可由单元测试
 *          直接驱动，不必先构造完整的 Bot、适配器与消息段。
 *
 *          出图失败返回 false 而非抛异常：没装渲染器的使用者仍应拿到文字结果。
 */
import { readFile } from "node:fs/promises"
import { seg } from "@yunzai-ng/core"
import type { HttpClient, Logger, MessageEvent, Segment } from "@yunzai-ng/types"
import type { GameKey } from "./region.js"
import { GAME_KEYS } from "./region.js"
import type { RenderBridge } from "./render.js"
import type { RenderDress } from "./render.js"
import { traceStep } from "./trace.js"

/** 中间件写入事件状态袋的键：本条消息识别出的游戏 */
export const GAME_STATE_KEY = "mhy:game"

/**
 * 按「游戏 + uid」造页头右上角那一格
 *
 * 收成回调而非在此 import：那一格要读头像库，本模块不碰任何存储。
 * 实现在 commands/_face.ts 的 `whoOf`。
 */
export type WhoProvider = (game: GameKey, uid: string) => Promise<unknown>

/**
 * 给视图数据补上页头右上角那一格
 *
 * **只在视图自己带了 `uid` 时补**：帮助、图鉴、日历这些不属某个玩家的图没有 uid，补一格
 * 等于在它们右上角凭空画出一个默认头像。视图已自备 `who` 时不动（面板详情那张带元素色）。
 * @param data 视图数据
 * @param game 本条消息的游戏
 * @param who 造那一格的回调，没给时原样返回
 * @returns 补过的视图数据
 */
async function withWho(
  data: Record<string, unknown>,
  game: GameKey,
  who?: WhoProvider
): Promise<Record<string, unknown>> {
  if (!who || data["who"] !== undefined) return data
  const uid = data["uid"]
  if (typeof uid !== "string" && typeof uid !== "number") return data
  if (!String(uid)) return data
  // 视图数据里的 `game` 优先：`#我的uid` 那张并列三游戏，按发起命令的前缀取会给错称呼
  const key = typeof data["game"] === "string" && GAME_KEYS.includes(data["game"] as GameKey) ? (data["game"] as GameKey) : game
  return { ...data, who: await who(key, String(uid)) }
}

/** 合并转发里一条消息的一个组成部分：一段文字，或一张本机磁盘上的图 */
export type ForwardPart = { readonly text: string } | { readonly image: string }

/** 命令实现能看到的会话面 */
export interface Session {
  /** 发起者标识，形如 `qq:10001`，与 `UserStore` 的主键一致 */
  readonly user: string
  /** 发起者昵称（群名片优先），出图时展示 */
  readonly name: string
  /** 命令触发词之后的剩余文本，已执行 trim */
  readonly rest: string
  /** 本条消息识别出的游戏 */
  readonly game: GameKey
  /** 是否私聊 */
  readonly isPrivate: boolean
  /** 是否主人 */
  readonly isMaster: boolean
  /** 群号，私聊时为 undefined；群面板排行按它分组 */
  readonly groupId?: string
  /** 是否群管理（群主也算），排行的开关与刷新要它 */
  readonly isGroupAdmin: boolean
  /**
   * 收到这条消息的 Bot 号（`selfId`）
   *
   * 开体力提醒时一并存下，之后的主动推送优先从这个号发出去：挂两个号时只按平台名挑一个
   * 在线 Bot 会挑到没进那个群的那一个。
   */
  readonly botId: string

  /**
   * 被引用的那条消息的 id，本条没有引用时 undefined
   *
   * 只有 `#原图` 用得上。部分平台不在引用里给消息 id，那时这一项为空。
   */
  readonly quotedId?: string

  /**
   * 本会话最近一次发出去的那张图的消息 id
   *
   * 供 `#原图` 建索引。平台不返回消息 id 时为空串，此时索引不写 —— 写一条空键会让所有
   * 这类消息互相覆盖。只有 {@link image} / {@link imageFile} / {@link imageBytes} 更新它。
   * @returns 消息 id；还没发过图或平台不给时空串
   */
  lastSent(): string

  /**
   * 回复一段文字
   * @param content 文案
   */
  text(content: string): Promise<void>

  /**
   * 渲染模板并回复图片
   * @param template 模板路径，相对于插件 templates 目录
   * @param data 模板数据
   * @param dress 展示参数；倍率一般不给 —— 基准写在模板自己的 css 里
   * @returns 出图成功为真；无渲染器或渲染失败为假，调用方应退回文字形式
   */
  image(template: string, data: Record<string, unknown>, dress?: RenderDress): Promise<boolean>

  /**
   * 追加一次询问并等待回答
   * @param tip 提示语
   * @returns 回答文本；超时或插件卸载时为 undefined
   */
  ask(tip: string): Promise<string | undefined>

  /**
   * 读本条消息附带的文件
   *
   * 供 UIGF 导入使用。平台只给了 `id`（须先调平台接口换取地址）时返回 undefined。
   * @returns 文件名与内容；本条消息没有附文件、或来源不可读时 undefined
   */
  file(): Promise<{ name: string; text: string } | undefined>

  /**
   * 追问一句，再把发送者的**下一条**消息当作文件收下
   *
   * QQ 发不出"命令自带文件附件"，故导入这类要先发命令、再单独发文件。等到带文件的下一条为止，
   * 中途的纯文字不算、继续等；超时或插件卸载时返回 undefined。
   * @param tip 提示语，如"请在 60 秒内发送 UIGF/SRGF 的 json 文件"
   * @returns 文件名与内容；超时、未发文件或来源不可读时 undefined
   */
  askFile(tip: string): Promise<{ name: string; text: string } | undefined>

  /**
   * 回复一个文件
   * @param name 文件名
   * @param text 文件内容
   * @returns 发送成功为真；平台不支持发文件时为假
   */
  sendFile(name: string, text: string): Promise<boolean>

  /**
   * 本条消息（含被引用的那条）里的图片地址
   *
   * 两处都要看：使用者既会发图带命令，也会回复一张已发的图再发命令。
   */
  readonly images: readonly string[]

  /**
   * 回复一张本机磁盘上的图
   *
   * 与 {@link image} 不同：那个渲染模板出图，这个把已有的文件发出去。
   * @param path 图片的绝对路径
   * @param tip 随图附带的一句说明
   * @returns 发送成功为真
   */
  imageFile(path: string, tip?: string): Promise<boolean>

  /**
   * 回复一张内存里的图
   *
   * 二维码刻意不落盘：它在有效期内等同于一次登录机会。
   * @param data 图片字节
   * @param tip 随图附带的一句说明
   * @returns 发送成功为真
   */
  imageBytes(data: Uint8Array, tip?: string): Promise<boolean>

  /**
   * 回复一组消息，平台支持时折成一张合并转发的卡片
   *
   * 只有一条时不折。平台不支持合并转发时逐条发出，此时 `title` 先单独发一条。
   * @param nodes 每条消息的组成部分，空的那些会被丢掉
   * @param title 折成卡片时作为第一条，如"胡桃攻略，共 5 张"
   * @returns 至少发出一条时为真
   */
  forward(nodes: readonly (readonly ForwardPart[])[], title?: string): Promise<boolean>
}

/**
 * 从事件状态袋中取本条消息对应的游戏
 *
 * 取不到时按原神处理：中间件可能被关掉，此时整套命令仍应可用，仅不再识别 `*` / `%` 前缀。
 * @param e 消息事件
 * @returns 游戏
 */
export function eventGame(e: MessageEvent): GameKey {
  const value = e.state[GAME_STATE_KEY]
  return GAME_KEYS.includes(value as GameKey) ? (value as GameKey) : "gs"
}

/** 导入文件的大小上限 —— UIGF 全量记录通常不足 2MB，留足余量即可挡住误发的大文件 */
const MAX_FILE_BYTES = 32 * 1024 * 1024

/**
 * 从一组消息段里读出附带的文件
 *
 * 抽出来是因两处都要用：本条消息（{@link Session.file}）与追问回来的下一条（{@link Session.askFile}）。
 *
 * **QQ 等平台发来的文件只给一个 `file_id`（`kind:"id"`），没有可直接读的路径或地址**，须经内核的
 * `bot.getFileUrl` 把 id 换成可下载 URL 或本机绝对路径才读得到——不处理这一支就表现为"发了文件却提示没收到"。
 * @param segs 消息段
 * @param evt 该组消息段所属的事件，取 `bot` 把 `file_id` 换成可取用的地址
 * @param logger 日志器
 * @param http HTTP 客户端，读 `kind:"url"` 的文件或 `getFileUrl` 给出的直链时用
 * @returns 文件名与内容；没有文件段、超限或来源不可读时 undefined
 */
async function readFileSeg(
  segs: readonly Segment[],
  evt: MessageEvent,
  logger: Logger,
  http?: HttpClient
): Promise<{ name: string; text: string } | undefined> {
  const one = segs.find(it => it.type === "file")
  if (!one || one.type !== "file") return undefined
  const name = one.name ?? "import.json"
  if (typeof one.size === "number" && one.size > MAX_FILE_BYTES) {
    logger.warn(`[米游社] 文件 ${name} 超过 ${MAX_FILE_BYTES} 字节，已拒绝读取`)
    return undefined
  }
  try {
    if (one.file.kind === "path") return { name, text: await readFile(one.file.path, "utf8") }
    if (one.file.kind === "buffer") return { name, text: Buffer.from(one.file.data).toString("utf8") }
    if (one.file.kind === "base64") return { name, text: Buffer.from(one.file.base64, "base64").toString("utf8") }
    if (one.file.kind === "url" && http) {
      const opts = one.file.headers ? { headers: one.file.headers } : {}
      const bytes = await http.buffer(one.file.url, { timeout: "60s", ...opts })
      return { name, text: Buffer.from(bytes).toString("utf8") }
    }
    // 只给了 file_id：经内核把 id 换成可下载 URL 或本机路径再读（`getFileUrl` 屏蔽了平台差异，故此处不判平台）
    if (one.file.kind === "id" && evt.bot.getFileUrl) {
      const loc = await evt.bot.getFileUrl(one.file.id)
      if (/^https?:\/\//i.test(loc)) {
        if (http) return { name, text: Buffer.from(await http.buffer(loc, { timeout: "60s" })).toString("utf8") }
      } else if (loc) {
        return { name, text: await readFile(loc, "utf8") }
      }
    }
  } catch (err) {
    logger.warn(`[米游社] 读取文件 ${name} 失败：${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
  // 走到这里说明来源形态没有一支认得下：记一行，便于查"发了文件却没收到"到底卡在哪种来源
  logger.warn(`[米游社] 文件 ${name} 的来源形态「${one.file.kind}」暂不支持读取（平台 ${evt.platform}）`)
  return undefined
}

/**
 * 构造一个会话
 * @param e 消息事件
 * @param logger 日志器，出图失败时记录一条
 * @param render 渲染桥，为模板补齐它约定的路径变量；省略时只传视图数据
 * @param http HTTP 客户端，读取消息附带的远端文件时用；省略时只能读本机路径
 * @param who 取页头右上角那一格；省略时各页仍用自己给的那份
 * @returns 会话
 */
export function sessionOf(
  e: MessageEvent,
  logger: Logger,
  render?: RenderBridge,
  http?: HttpClient,
  who?: WhoProvider
): Session {
  const sender = e.sender
  const card = "card" in sender ? sender.card : undefined
  // 只在发图的三处更新
  let lastId = ""
  return {
    user: `${e.platform}:${sender.uid}`,
    name: card ?? sender.name ?? sender.uid,
    rest: e.command?.rest ?? "",
    game: eventGame(e),
    isPrivate: e.isPrivate,
    isMaster: e.isMaster,
    // 只认 scene 为 group 那一支：private 分支的 `gid` 是"群临时会话的来源群"，那不算群内
    ...(e.target.scene === "group" ? { groupId: e.target.gid } : {}),
    isGroupAdmin: e.isGroupAdmin,
    botId: e.bot.selfId,
    ...(e.quote?.messageId ? { quotedId: e.quote.messageId } : {}),
    lastSent: (): string => lastId,
    text: async (content: string): Promise<void> => void (await e.reply(content, { at: e.isGroup })),
    image: async (template: string, data: Record<string, unknown>, dress?: RenderDress): Promise<boolean> => {
      const started = Date.now()
      try {
        const body = await withWho(data, eventGame(e), who)
        const res = await e.renderReply(template, render ? render.dress(body, { game: eventGame(e), ...dress }) : body)
        lastId = res?.messageId ?? ""
        traceStep({ kind: "render", name: template, result: "ok", ms: Date.now() - started })
        return true
      } catch (err) {
        traceStep({ kind: "render", name: template, result: "失败", ms: Date.now() - started })
        logger.warn(`[米游社] 出图 ${template} 失败，退回文字形式：${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    },
    ask: async (tip: string): Promise<string | undefined> => (await e.prompt({ tip }))?.text,
    file: async (): Promise<{ name: string; text: string } | undefined> =>
      // 本条与被引用的那条都看；`quote.message` 未必有值，没有就只看本条
      readFileSeg([...e.message, ...(e.quote?.message ?? [])], e, logger, http),
    askFile: async (tip: string): Promise<{ name: string; text: string } | undefined> => {
      // QQ 发不出"命令带文件附件"，故追问一次、把文件当作下一条消息收。filter 只认带文件的那条，
      // 中途的闲聊不算、继续等，直到超时（返回 undefined）
      const next = await e.prompt({ tip, sameUser: true, filter: (ev: MessageEvent) => ev.message.some(it => it.type === "file") })
      if (!next) return undefined
      return readFileSeg([...next.message, ...(next.quote?.message ?? [])], next, logger, http)
    },
    // 只取 `kind: "url"` 那一支：面板图上传要的是"去下载一个地址"
    images: e.images.flatMap(one => (one.file.kind === "url" ? [one.file.url] : [])),
    imageFile: async (path: string, tip?: string): Promise<boolean> => {
      try {
        const parts = [seg.image({ kind: "path", path })]
        const res = await e.reply(tip ? [tip, ...parts] : parts)
        lastId = res?.messageId ?? ""
        return true
      } catch (err) {
        logger.warn(`[米游社] 发送图片失败：${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    },
    imageBytes: async (data: Uint8Array, tip?: string): Promise<boolean> => {
      try {
        const parts = [seg.image({ kind: "buffer", data, name: "image.png", mime: "image/png" })]
        const res = await e.reply(tip ? [tip, ...parts] : parts)
        lastId = res?.messageId ?? ""
        return true
      } catch (err) {
        logger.warn(`[米游社] 发送图片失败：${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    },
    sendFile: async (name: string, text: string): Promise<boolean> => {
      try {
        await e.reply([seg.file({ kind: "buffer", data: Buffer.from(text, "utf8"), name, mime: "application/json" }, { name })])
        return true
      } catch (err) {
        logger.warn(`[米游社] 发送文件 ${name} 失败：${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    },
    forward: async (nodes: readonly (readonly ForwardPart[])[], title?: string): Promise<boolean> => {
      const list = nodes.filter(one => one.length > 0)
      if (!list.length) return false
      const parts = (one: readonly ForwardPart[]): Segment[] =>
        one.map(it => ("text" in it ? seg.text(it.text) : seg.image({ kind: "path", path: it.image })))

      try {
        // 一条就直接发：卡片要点开才看得到，不如原样展示
        const only = list.length === 1 ? list[0] : undefined
        if (only) {
          await e.reply(parts(only))
          return true
        }

        const send = e.bot.sendForward
        if (send && e.bot.caps.has("forward")) {
          const head = title ? [{ uid: e.bot.selfId, name: e.bot.nickname, message: [seg.text(title)] }] : []
          await send.call(e.bot, e.target, [
            ...head,
            ...list.map(one => ({ uid: e.bot.selfId, name: e.bot.nickname, message: parts(one) }))
          ])
          return true
        }

        // 平台不支持合并转发时逐条发：折不成卡片总比一条都不发好
        if (title) await e.reply(title)
        for (const one of list) await e.reply(parts(one))
        return true
      } catch (err) {
        logger.warn(`[米游社] 发送合并转发失败：${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    }
  }
}
