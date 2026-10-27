/**
 * 模块职责：渲染桥 —— 补齐模板所依赖的那批路径变量，使模板可原样出图
 * 依赖方向：只依赖 node:path / node:url，另以 node:fs 判资源文件在不在（{@link RenderBridge.hasRes}）
 * 生命周期：每个插件实例一个，路径只算一次
 * 注意事项：路径变量分两类，形态不可混用 ——
 *          资源位置（`_res_path` / `_meta_path` / `_panel_path` / `_face_path` / `pluResPath` / `resPath`）
 *          由浏览器解析，须为 `file://` URL；中间 HTML 落在临时目录，相对路径取不到文件。
 *          模板位置（`_layout_path` / `_tpl_path` 与 `skinLayout` / `elemLayout`）由模板引擎在编译期解析，
 *          须为绝对文件系统路径 —— 引擎对非绝对路径执行 `resolve(模板根, 值)`，
 *          传 `file:///C:/…` 会拼成 `<模板根>/file:/C:/…`，报的是 ENOENT。
 */
import { existsSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"

/** 署名中展示的内核名 */
const FRAMEWORK_NAME = "Yunzai NG"

/** 署名中展示的插件名，取仓库名而非注册名 `mhy-game` —— 使用者在插件市场搜的是它 */
const PLUGIN_LABEL = "mhy-game-plugin"

/** 页脚署名，模板 common/sign.html 读它 */
export interface RenderSign {
  /** 内核名 */
  coreName: string
  /** 内核版本，取不到时空串（模板不印那一截） */
  coreVersion: string
  /** 插件名 */
  pluginName: string
  /** 插件版本 */
  pluginVersion: string
}

/** 出图时可覆盖的展示参数 */
export interface RenderDress {
  /**
   * 覆盖模板自己的基准倍率
   *
   * 缺省时不要给：基准倍率写在每套模板的 css 里（`body{transform:scale(N)}`），
   * 此处给值就以行内样式把那一处压掉。
   */
  scale?: number
  /** 页脚署名里的插件版本，缺省取插件自己的 */
  version?: string
  /** 发起命令的游戏；视图数据没带 `game` 时按它选皮肤，不影响 `_hash` */
  game?: string
}

/** 造渲染桥需要的两个目录 */
export interface RenderBridgeOptions {
  /** 插件根目录，取自 `ctx.root` */
  root: string
  /**
   * 元数据根目录，取自 `join(ctx.dataDir, "meta")`
   *
   * 与插件根分开：元数据是运行时下载的三百兆资源，落在数据目录而非插件目录，
   * 插件重装时不必重下。
   */
  metaDir: string
  /** 取插件版本的函数 */
  version: () => string
}

/**
 * 倍率与全局精度 → 模板中的 `sys.scale`
 *
 * 模板把它写在 body 标签里（`<body {{sys.scale}}>`），要的是一段属性文本而非数字。
 *
 * 两项都是恒等时输出空串：基准倍率写在每套模板的 css 里，而行内样式优先级更高 ——
 * 恒输出 `transform:scale(1)` 会把那些基准逐个压成 1 倍，表现是每张图都小一截、发糊。
 * 全局精度用 `zoom` 而非 `transform`：同一元素上第二个 `transform` 是替换而非叠加，
 * 而此处不知道 css 里那个基准是多少；`zoom` 与 `transform` 相乘，故基准仍在。
 * @param base 覆盖模板 css 的基准倍率，不覆盖时省略
 * @param pct 全局渲染精度百分比
 * @returns 可直接写进标签的属性文本；无须缩放时空串
 */
export function scaleStyle(base?: number, pct = 100): string {
  const zoom = Math.min(200, Math.max(50, pct)) / 100
  const parts: string[] = []
  if (base !== undefined) parts.push(`transform:scale(${Math.min(4, Math.max(0.5, base))})`)
  if (zoom !== 1) parts.push(`zoom:${zoom}`)
  // 属性值不带引号，故各段之间不可有空格；art-template 会转义 `"`，加引号反而拼坏标签
  return parts.length === 0 ? "" : `style=${parts.join(";")}`
}
/**
 * 目录绝对路径 → 带尾斜杠的 file URL
 *
 * 尾斜杠决定相对路径解析的基准目录，缺失会使 `img/x.png` 落到上一级。
 * @param path 目录绝对路径
 * @returns 形如 `file:///c:/x/y/` 的 URL
 */
function dirUrl(path: string): string {
  const href = pathToFileURL(path).href
  return href.endsWith("/") ? href : `${href}/`
}

/**
 * 判一个模板变量是否为模板引擎可用的绝对路径
 *
 * 供测试与自检使用：`file://` 形态的布局变量不会报「形态不对」，只会在编译期报 ENOENT。
 * @param value 变量值
 * @returns 可用时为真
 */
export function isTemplatePath(value: string): boolean {
  return isAbsolute(value) && !value.startsWith("file:")
}

/**
 * 元数据文案里代表元数据根的记号
 *
 * 元数据的技能文案里带 `<img src="{META}character/common/imgs/talent-basic.webp"/>`。
 * 那一段模板走 `{{@desc}}` 原样输出，故拼不进 `{{_meta_path}}`。
 */
export const META_TOKEN = "{META}"

/**
 * 把视图数据里的 {@link META_TOKEN} 换成真地址
 *
 * 递归走字符串、数组与纯对象；只在有那个记号时才新建对象，故绝大多数视图原样返回。
 * @param value 任意视图数据
 * @param root 元数据根目录 URL
 * @returns 换过之后的数据
 */
function expandMeta(value: unknown, root: string): unknown {
  if (typeof value === "string") return value.includes(META_TOKEN) ? value.replaceAll(META_TOKEN, root) : value
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map(one => {
      const got = expandMeta(one, root)
      if (got !== one) changed = true
      return got
    })
    return changed ? out : value
  }
  // 只走纯对象：Date、Map 一类原样传下去
  if (value && typeof value === "object" && (value.constructor === Object || value.constructor === undefined)) {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [key, one] of Object.entries(value)) {
      const got = expandMeta(one, root)
      if (got !== one) changed = true
      out[key] = got
    }
    return changed ? out : value
  }
  return value
}

/** 各游戏印在图上给人照抄的短记号，与 region.ts 的 `COMMAND_PREFIX`（注册用）不是同一份 */
const GAME_HASH: Readonly<Record<string, string>> = { gs: "#", sr: "*", zzz: "%" }

/**
 * 按视图数据里的 `game` 取当前游戏的命令记号
 *
 * 模板里印命令示例时一律用它，不写死 `#` —— 否则绝区零使用者照着图上那句发出去毫无回应。
 * 认不出游戏时回落 `#`。
 * @param data 视图数据
 * @returns `#` / `*` / `%`
 */
function gameHash(data: Record<string, unknown>): string {
  const game = data["game"]
  return (typeof game === "string" ? GAME_HASH[game] : undefined) ?? "#"
}

/** 各游戏的皮肤根 class，对应 `resources/common/skin/` 下同名的 css */
const GAME_SKIN: Readonly<Record<string, string>> = { gs: "skin-gs", sr: "skin-sr", zzz: "skin-zzz" }

/**
 * 按视图数据里的 `game` 取皮肤根 class，没带时取发起命令的游戏
 *
 * 认不出游戏时回落中性皮肤。不属任一游戏的图（管理、扫码、uid 总表）由命令层自己给
 * `_skin: "skin-neutral"`，否则会随发起命令的那个前缀换皮；帮助按游戏列命令，故随前缀换皮。
 * @param data 视图数据
 * @param fallback 发起命令的游戏
 * @returns `skin-gs` / `skin-sr` / `skin-zzz` / `skin-neutral`
 */
function gameSkin(data: Record<string, unknown>, fallback?: string): string {
  const game = typeof data["game"] === "string" ? data["game"] : fallback
  return (game ? GAME_SKIN[game] : undefined) ?? "skin-neutral"
}

/**
 * 渲染桥 —— 由插件根目录算出模板所需的全部路径变量
 *
 * 每个插件实例构造一个，`ctx.root` 在插件生命周期内不变，故路径只算一次。
 */
export class RenderBridge {
  /** 资源根目录 URL */
  readonly #res: string
  /** 资源根目录，绝对文件系统路径 */
  readonly #resDir: string
  /** 布局目录，绝对文件系统路径 */
  readonly #layout: string
  /** 公共片段目录，绝对文件系统路径 */
  readonly #tpl: string
  /** 元数据根目录 URL */
  readonly #meta: string
  /**
   * 面板图根目录 URL
   *
   * 第三个根：插件资源在 `resources/`、元数据在 `dataDir/meta/`、面板图在
   * `dataDir/panel-img/` —— 后者属使用者数据，放进 `resources/` 会被插件更新覆盖掉。
   */
  readonly #panel: string
  /**
   * 玩家头像库根目录 URL
   *
   * 第四个根，与 `#panel` 同理属使用者数据：这是逐 uid 从米游社与 Enka 取回来的头像
   * （见 store/face.ts），放进 `resources/` 会被插件更新冲掉。
   */
  readonly #face: string
  /** 取当前插件版本，用于页脚署名 */
  readonly #version: () => string
  /** 取内核版本，用于页脚署名 */
  readonly #coreVersion: () => string
  /** 取全局渲染精度（百分比），乘在每套模板 css 的基准倍率之上；传函数故面板改完即生效 */
  readonly #scale: () => number

  /**
   * @param root 插件根目录绝对路径，取自 `ctx.root`
   * @param version 取插件版本的函数
   * @param metaDir 元数据根目录绝对路径，取自 `join(ctx.dataDir, "meta")`；
   *                省略时 `_meta_path` 退回资源根目录，模板不至于拼出 `undefined/`
   * @param panelImgDir 面板图根目录绝对路径，取自 `join(ctx.dataDir, "panel-img")`
   * @param scale 取渲染精度百分比的函数，缺省 100（即不改变每套模板自己的倍率）
   * @param faceDir 玩家头像库根目录绝对路径，取自 `join(ctx.dataDir, "face")`
   * @param coreVersion 取内核版本的函数，取自 `ctx.app.version`；缺省空串
   */
  constructor(
    root: string,
    version: () => string,
    metaDir?: string,
    panelImgDir?: string,
    scale?: () => number,
    faceDir?: string,
    coreVersion?: () => string
  ) {
    this.#resDir = join(root, "resources")
    this.#res = dirUrl(this.#resDir)
    // 布局与公共片段由模板引擎在编译期读取，故为文件系统路径而非 URL，理由见文件头
    this.#layout = join(root, "templates", "layout")
    this.#tpl = join(root, "templates", "common")
    // 元数据装在数据目录而非插件目录下：它是下载来的，插件更新不应把它冲掉
    this.#meta = metaDir ? dirUrl(metaDir) : this.#res
    // 面板图同理，且它是使用者上传的，更不该放在会被覆盖的地方
    this.#panel = panelImgDir ? dirUrl(panelImgDir) : this.#res
    // 头像库同理：逐 uid 从米游社与 Enka 取回来的那些
    this.#face = faceDir ? dirUrl(faceDir) : this.#res
    this.#version = version
    this.#coreVersion = coreVersion ?? ((): string => "")
    this.#scale = scale ?? ((): number => 100)
  }

  /**
   * 判一个资源文件在不在
   *
   * 给"放进去就生效"的那类图用（活动日历的奖励图按物品名取）：模板判不了文件在不在，
   * 不先判就是一格碎图。
   * @param rel 相对 `resources/` 的路径
   * @returns 文件存在时为真
   */
  hasRes(rel: string): boolean {
    return rel !== "" && existsSync(join(this.#resDir, rel))
  }

  /**
   * 一张布局的绝对路径
   * @param name 布局文件名（不含扩展名）
   * @returns 绝对路径
   */
  layout(name: string): string {
    return join(this.#layout, `${name}.html`)
  }

  /**
   * 为模板数据补齐全部约定变量
   *
   * 调用方给的字段恒优先，只补不覆盖。唯一例外是 `sys.scale`，理由见 {@link scaleStyle}。
   * @param data 视图数据
   * @param dress 展示参数
   * @returns 可直接交给渲染器的完整模板数据
   */
  dress(data: Record<string, unknown>, dress: RenderDress = {}): Record<string, unknown> {
    const sign: RenderSign = {
      coreName: FRAMEWORK_NAME,
      coreVersion: this.#coreVersion() || "",
      pluginName: PLUGIN_LABEL,
      pluginVersion: dress.version ?? (this.#version() || "")
    }
    const sys = typeof data["sys"] === "object" && data["sys"] !== null ? (data["sys"] as Record<string, unknown>) : {}
    const body = expandMeta(data, this.#meta) as Record<string, unknown>
    const hash = gameHash(body)

    return {
      _res_path: this.#res,
      pluResPath: this.#res,
      resPath: this.#res,
      // 装载器给的是相对 meta 根的路径，模板写 `{{_meta_path}}{{icon}}`
      _meta_path: this.#meta,
      _panel_path: this.#panel,
      _face_path: this.#face,
      // 以下四项供模板引擎解析 include / extend，故为文件系统路径
      _layout_path: this.#layout,
      _tpl_path: this.#tpl,
      skinLayout: this.layout("skin"),
      // 只有面板详情一张用它：排版自成一套，风格由 character/profile-detail-skin.css 按 `_skin` 套上皮肤
      elemLayout: this.layout("elem"),
      _sign: sign,
      // 放在 `...body` 之前：视图自己给了 `_hash` / `_skin` 时以视图为准，没给才按 `game` 补
      _hash: hash,
      _skin: gameSkin(body, dress.game),
      ...body,
      sys: {
        ...sys,
        // 必须改写渲染器注入的数字形态，见 scaleStyle
        scale: scaleStyle(dress.scale, this.#scale())
      }
    }
  }
}
