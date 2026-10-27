/**
 * 模块职责：模板文件的静态体检
 * 依赖方向：测试文件，只读 templates/ 下的文件与渲染桥，不引 art-template（那是渲染器插件的依赖）
 * 生命周期：无状态
 * 注意事项：本文件固定五项仅在实际出图时才暴露的口径：模板必须存在、
 *          每张图须有截图锚点 `#container`、注释里不得出现双大括号（art-template 连注释一起
 *          编译）、顶层数据键不得是 JS 保留字（引擎按含 ES3 未来保留字的表过滤，`char` 永远
 *          取不到值）、extend / include 的路径变量须为文件系统路径且指向真实文件。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { RenderBridge, isTemplatePath } from "./core/render.js"

/** templates 目录绝对路径 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "templates")

/** resources 目录绝对路径，布局中 `{{_res_path}}` 指向此处 */
const RES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "resources")

/** 命令层按名称请求的模板，缺少任一项即意味着一条命令无法出图 */
const REQUIRED = ["profile", "avatars"] as const

/** 既有模板，按 `子目录/文件名` 请求；命令层的 `s.image` 用的就是这些名字 */
const PORTED = [
  /* ───────── 通用 ───────── */
  "avatar/weapon",
  "character/profile-list",
  "character/profile-detail",
  "character/artis-list",
  "character/profile-stat",
  "character/avatar-list",
  "character/rank-profile-list",
  "character/character-card",
  "wiki/character-wiki",
  "wiki/character-talent",
  "wiki/character-material",
  "wiki/weapon-wiki",
  "wiki/calendar",
  /* ───────── 原神 ───────── */
  "gs/note",
  "gs/ledger",
  "gs/role-card",
  "gs/role-explore",
  "gs/abyss",
  "gs/abyss-floor",
  "gs/combat",
  "gs/tarot",
  "gs/char-master",
  "gs/hard-challenge",
  "gs/abyss-pct",
  "gs/today-material",
  "gs/calculator",
  "gs/blueprint",
  "gs/gcg-deck",
  "gs/gcg-deck-list",
  "gs/gcg-deck-card",
  /* ───────── 星穹铁道 ───────── */
  "sr/note",
  "sr/ledger",
  "sr/challenge-memory",
  "sr/challenge-story",
  "sr/challenge-boss",
  "sr/peak-challenge",
  "sr/achieve",
  "sr/chest",
  "sr/rogue",
  "sr/currency-war",
  "sr/unknowable",
  "sr/calculator",
  /* ───────── 绝区零 ───────── */
  "zzz/note",
  "zzz/ledger",
  "zzz/defense",
  "zzz/deadly",
  "zzz/holo",
  "zzz/tower",
  "zzz/void",
  "zzz/garden",
  "zzz/lost",
  "zzz/explore",
  "zzz/zenkov",
  "zzz/zenkov-detail",
  "zzz/buddy"
] as const

/**
 * 读一个模板文件
 * @param name 相对 templates 的路径
 * @returns 文件内容
 */
function read(name: string): string {
  return readFileSync(join(ROOT, name), "utf8")
}

/**
 * 布局文件，供模板以 extend 继承
 *
 * `elem` 只给面板详情一张：那张有自己的布局与样式表，
 * 风格由 `character/profile-detail-skin.css` 按 `_skin` 套上三套皮肤（只覆写风格、不动排版）。
 */
const LAYOUTS = ["skin", "elem"] as const

/**
 * 列出一个子目录下的 html
 * @param sub 子目录名
 * @returns 形如 `common/head.html` 的相对路径
 */
function htmlIn(sub: string): string[] {
  return readdirSync(join(ROOT, sub))
    .filter(it => it.endsWith(".html"))
    .map(it => `${sub}/${it}`)
}

/** 存放既有模板的子目录，逐个纳入体检 */
const SUBDIRS = [
  "common",
  "common/skin",
  "layout",
  "user",
  "admin",
  "gs",
  "sr",
  "zzz",
  "avatar",
  "gacha",
  "character",
  "wiki"
] as const

/** 全部 html 文件，含 common 片段、layout 布局与各功能子目录 */
function htmlFiles(): string[] {
  const top = readdirSync(ROOT, { withFileTypes: true })
  const files = top.filter(it => it.isFile() && it.name.endsWith(".html")).map(it => it.name)
  return [...files, ...SUBDIRS.flatMap(htmlIn)]
}

describe("模板文件", () => {
  it("命令层请求的模板都在", () => {
    const names = readdirSync(ROOT).filter(it => it.endsWith(".html"))
    for (const want of REQUIRED) expect(names).toContain(`${want}.html`)
    for (const want of PORTED) {
      expect(() => read(`${want}.html`), `既有模板 ${want}.html 不在`).not.toThrow()
    }
  })

  it("既有模板都靠布局提供截图锚点 —— 自带 #container 的则须自带", () => {
    for (const want of PORTED) {
      const body = read(`${want}.html`)
      const extended = /\{\{extend\s+\w+Layout\}\}/.test(body)
      expect(extended || body.includes('id="container"'), `${want}.html 既不继承布局也没有 #container`).toBe(true)
    }
  })

  it("每张图都有 #container —— 渲染器按它裁剪，没有就只能截整页", () => {
    // 迁到皮肤布局后锚点由布局给（上一条已校验「要么继承布局、要么自带」），此处只核自带的那些
    for (const want of REQUIRED) {
      const body = read(`${want}.html`)
      const viaLayout = /\{\{extend\s+\w+Layout\}\}/.test(body)
      expect(viaLayout || body.includes('id="container"'), `${want}.html 拿不到截图锚点`).toBe(true)
    }
  })

  it("账号体系的两个模板都在，且能被截图", () => {
    // 两张都走皮肤布局，截图锚点由布局给（`#container` 在 layout/skin.html 里）
    for (const want of ["user/uid-list", "admin/user-admin"]) {
      expect(read(`${want}.html`), `${want}.html 没走皮肤布局`).toContain("{{extend skinLayout}}")
    }
  })

  it("布局都在 —— 模板按 extend 的别名找它们", () => {
    const names = readdirSync(join(ROOT, "layout"))
    for (const want of LAYOUTS) expect(names).toContain(`${want}.html`)
  })

  it("layout 下没有多余的布局 —— 多一张就会被误 extend", () => {
    const names = readdirSync(join(ROOT, "layout")).filter(it => it.endsWith(".html"))
    expect(names.sort()).toEqual(LAYOUTS.map(it => `${it}.html`).sort())
  })

  it("布局自身也带 #container", () => {
    for (const want of LAYOUTS) {
      expect(read(`layout/${want}.html`), `layout/${want}.html 缺少截图锚点`).toContain('id="container"')
    }
  })

  it("代入 sys.scale 的布局把它写在 body 标签上", () => {
    for (const want of LAYOUTS) {
      const body = read(`layout/${want}.html`)
      expect(body, `layout/${want}.html 没有把 sys.scale 代入 body`).toMatch(/<body[^>]*\{\{sys\.scale\}\}/)
    }
  })

  it("注释里没有双大括号 —— art-template 连注释一起编译", () => {
    for (const file of htmlFiles()) {
      const comments = read(file).match(/<!--[\s\S]*?-->/g) ?? []
      for (const comment of comments) {
        expect(comment, `${file} 的注释里出现了模板语句`).not.toMatch(/\{\{/)
      }
    }
  })

  it("顶层数据键不是 JS 保留字 —— 模板引擎不会为保留字声明变量", () => {
    // 引擎按一张含 ES3 未来保留字的表过滤要声明的变量，故名为 `char` 的顶层键永不绑定，
    // 渲染时抛 `char is not defined`、那条命令从此只回文字。属性名与 each/set 的局部名不受影响
    const words = new Set(
      `abstract await boolean break byte case catch char class const continue debugger default delete do double
       enum export extends final finally float for function goto implements import instanceof int interface let
       long native package private protected public short static super switch synchronized throw transient
       volatile while yield`.split(/\s+/)
    )
    const bad: string[] = []
    for (const file of htmlFiles()) {
      const body = read(file)
      const local = new Set<string>()
      for (const one of body.matchAll(/\{\{\s*each\s+\S+\s+([A-Za-z_$][\w$]*)(?:\s+([A-Za-z_$][\w$]*))?/g)) {
        if (one[1]) local.add(one[1])
        if (one[2]) local.add(one[2])
      }
      for (const one of body.matchAll(/\{\{\s*set\s+([A-Za-z_$][\w$]*)/g)) if (one[1]) local.add(one[1])

      for (const expr of body.matchAll(/\{\{([^}]*)\}\}/g)) {
        // 字符串字面量里的词不是标识符
        const code = (expr[1] ?? "").replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
        for (const hit of code.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
          const name = hit[1] ?? ""
          if (words.has(name) && !local.has(name)) bad.push(`${file}: ${name}`)
        }
      }
    }
    expect(bad, "这些键名会被引擎丢掉，渲染时报 xxx is not defined").toEqual([])
  })

  it("注释里没有 base 标签写法 —— 渲染器据此判定是否注入", () => {
    // 注释里的 base 示例会让渲染器认定模板已自带 base 而跳过注入，全部样式静默失效
    for (const file of htmlFiles()) {
      const comments = read(file).match(/<!--[\s\S]*?-->/g) ?? []
      for (const comment of comments) {
        expect(comment, `${file} 的注释里出现了 base 标签`).not.toMatch(/<base[\s/>]/i)
      }
    }
  })

  it("include 与 link 指向的文件真的存在", () => {
    for (const file of htmlFiles()) {
      const body = read(file)
      const refs = [
        ...[...body.matchAll(/\{\{include\s+'([^']+)'/g)].map(m => m[1]),
        ...[...body.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1])
      ]
      for (const raw of refs) {
        if (raw === undefined) continue
        // `href="#"` 是 favicon 占位（不发请求即可免去一次 404），并非文件引用
        if (raw === "#") continue
        // `?v=1.0` 是缓存刷新标记，不剥掉会把存在的文件报成缺失
        const ref = raw.split("?")[0] ?? raw
        // 三个资源变量在渲染桥里指向同一处，故按同一规则还原；其余含模板语句的引用无法静态判定
        const varRef = /^\{\{\s*(?:_res_path|pluResPath|resPath)\s*\}\}(.+)$/.exec(ref)
        if (varRef) {
          const target = resolve(RES, varRef[1] ?? "")
          expect(() => readFileSync(target, "utf8"), `${file} 引用了不存在的资源 ${ref}`).not.toThrow()
          continue
        }
        if (ref.includes("{{")) continue
        // include 相对自己所在目录，link 相对注入的 <base>（= 主模板目录，即 templates 根）
        const base = ref.endsWith(".css") ? ROOT : dirname(join(ROOT, file))
        expect(() => readFileSync(resolve(base, ref), "utf8"), `${file} 引用了不存在的 ${ref}`).not.toThrow()
      }
    }
  })

  it("片段自己不带 <html>：它们是被 include 进主模板的，不是独立页面", () => {
    for (const file of htmlFiles().filter(it => it.startsWith("common/"))) {
      expect(read(file)).not.toContain("<html")
    }
  })

  it("视图层按序号拼出来的那几张图真的在", () => {
    // 序号由视图层拼，上一条静态校验扫不到；少一张只是那一格空白，不报错。第 0 档只有外框
    for (const idx of [0, 1, 2, 3, 4]) {
      const frame = resolve(RES, `sr/challenge/peak/icon_type_${idx}.png`)
      expect(() => readFileSync(frame), `异相仲裁缺少第 ${idx} 档的奖牌外框`).not.toThrow()
      if (idx === 0) continue
      const mid = resolve(RES, `sr/challenge/peak/icon_type_${idx}_mid.png`)
      expect(() => readFileSync(mid), `异相仲裁缺少第 ${idx} 档的奖牌图案`).not.toThrow()
    }
  })

  it("**调 whenError 的模板都拿得到它的定义** —— 定义与调用分处两地，最容易再次失联", () => {
    // 调一个未定义的 whenError 不报错也不换图，只在控制台抛 ReferenceError、那格留着碎图标记。
    // 定义在 `common/img-fallback.html`，自己 include 或 extend 一个 include 了它的布局均可
    const FALLBACK = "img-fallback.html"
    const layouts = new Set(
      htmlFiles()
        .filter(it => it.startsWith("layout/") && read(it).includes(FALLBACK))
        .map(it => basename(it, ".html"))
    )
    // 布局全都要有：漏一个就让继承它的那些模板整批失去兜底
    expect(layouts.size, "有布局没有 include img-fallback.html").toBe(
      htmlFiles().filter(it => it.startsWith("layout/")).length
    )

    /**
     * 判一个文件自己是否拿得到定义：自己 include 了那份片段，或 extend 了一个 include 它的布局
     * @param file 相对 templates 的路径
     * @returns 拿得到时为真
     */
    const selfHas = (file: string): boolean => {
      const body = read(file)
      // extend 用的是布局别名（`elemLayout` → `elem`），故按别名前缀比对
      return body.includes(FALLBACK) || [...layouts].some(it => new RegExp(`extend\\s+${it}Layout`).test(body))
    }

    const all = htmlFiles()

    /**
     * 一个文件真正 include 了哪些片段
     *
     * 两处判据。一是**只认 include 语句、不按裸字符串找**：片段的文件头注释里会提到自己的上下游
     * （`sr-stat-avatar` 的依赖方向那行就写着 `sr-challenge.html`），按裸字符串匹配会把
     * 被引用方反认成引用方，方向颠倒之后这条断言恒失败。
     * 二是**算到完整相对路径、不可只取文件名**：`common/head.html` 与 `common/skin/head.html`
     * 同名，只比文件名会把前者的引用方算到后者头上。
     * @param file 相对 templates 的路径
     * @returns 被 include 的那些文件，相对 templates 的路径
     */
    const includesOf = (file: string): string[] => {
      const body = read(file)
      const out: string[] = []
      // `{{include './x.html'}}` 相对自己所在目录
      for (const hit of body.matchAll(/\{\{include\s+'([^']+)'/g)) {
        out.push(join(dirname(file), hit[1] ?? ""))
      }
      // `include(_tpl_path + '/x.html')` 里的 `_tpl_path` 指向 templates/common
      for (const hit of body.matchAll(/include\s*\(\s*_tpl_path\s*\+\s*'([^']+)'/g)) {
        out.push(join("common", hit[1] ?? ""))
      }
      // htmlFiles() 给的是 `/` 分隔，统一形态才比得上
      return out.map(it => it.replaceAll("\\", "/"))
    }

    /**
     * 顺着 include 链向上找定义
     *
     * `common/` 下的片段只被 include、自己不是整页，故定义由引用方给。**引用方自己也可能是片段**
     * （`sr-stat-avatar` ← `sr-challenge` ← 三张整页），故要一路递归到 extend 布局的那张为止。
     * 片段自带 include 反倒不行：头像格每页要 include 几十次，等于把同一段脚本输出几十遍。
     * @param file 相对 templates 的路径
     * @param path 当前这条链上已访问的，防 include 成环时无限递归
     * @returns 这条链上拿得到定义时为真
     */
    const reaches = (file: string, path: readonly string[] = []): boolean => {
      if (selfHas(file)) return true
      // **只防当前路径成环，不跨分支共享**：引用图上有菱形（`zzz-team` 被 battle / stage /
      // defense 三处引用），一份共享的已访问集会让第二条分支走到同一节点时直接判否，
      // 于是 every() 误报「引用方拿不到定义」
      if (path.includes(file)) return false
      const next = [...path, file]
      // 按完整相对路径比对：`common/head.html` 与 `common/skin/head.html` 同名，
      // 只比文件名会把前者的引用方算给后者，同样是误报
      const users = all.filter(it => it !== file && includesOf(it).includes(file))
      // 没有任何引用方即是真失联：这张图自己不带定义，又没人把定义带给它
      return users.length > 0 && users.every(it => reaches(it, next))
    }

    for (const file of all) {
      const body = read(file)
      if (!/whenError\s*\(/.test(body) || file.endsWith(FALLBACK)) continue
      expect(reaches(file), `${file} 调了 whenError 却拿不到它的定义`).toBe(true)
    }
  })

  it("whenError 换上的占位图真的在 —— 文件被删时那一格仍是碎图标记，不报错", () => {
    const body = read("common/img-fallback.html")
    const hits = [...body.matchAll(/\{\{@_res_path\}\}([^"']+)/g)].map(hit => hit[1] ?? "")
    expect(hits.length).toBeGreaterThan(0)
    for (const rel of hits) expect(existsSync(join(RES, rel)), rel).toBe(true)
  })

  it("extend 与 include 用到的路径变量都是文件系统路径，且指向真实文件", () => {
    // 引擎在编译期对非绝对路径执行 `resolve(模板根, 值)`，故这几个变量须是绝对文件系统路径；
    // 填成 `file://` URL 时报 `ENOENT: <模板根>/file:/C:/…`，且四十余张图同时失效
    const bridge = new RenderBridge(resolve(ROOT, ".."), () => "0.0.0")
    const vars = bridge.dress({})

    for (const key of ["_layout_path", "_tpl_path", "skinLayout", "elemLayout"]) {
      const value = vars[key]
      expect(typeof value, `${key} 缺失`).toBe("string")
      expect(isTemplatePath(String(value)), `${key} 不是文件系统路径：${String(value)}`).toBe(true)
    }
    // 资源变量反过来必须是 URL：中间 HTML 落在临时目录，裸路径取不到文件
    for (const key of ["_res_path", "_meta_path", "_panel_path", "_face_path", "pluResPath", "resPath"]) {
      expect(String(vars[key]), `${key} 必须是 file:// URL`).toMatch(/^file:\/\//)
    }

    // 模板里实际写出来的那些引用逐个落到磁盘上
    for (const file of htmlFiles()) {
      const body = read(file)
      for (const hit of body.matchAll(/\{\{extend\s+(\w+)\}\}/g)) {
        const target = vars[hit[1] ?? ""]
        expect(typeof target, `${file} extend 了未定义的布局变量 ${hit[1] ?? ""}`).toBe("string")
        expect(() => readFileSync(String(target), "utf8"), `${file} 的布局 ${hit[1] ?? ""} 不存在`).not.toThrow()
      }
      for (const hit of body.matchAll(/include\(\s*_tpl_path\s*\+\s*'([^']+)'/g)) {
        const target = join(String(vars["_tpl_path"]), hit[1] ?? "")
        expect(() => readFileSync(target, "utf8"), `${file} include 了不存在的片段 ${hit[1] ?? ""}`).not.toThrow()
      }
    }
  })

  it("模板表达式里不出现全局构造器 —— 它们会被解析成取值，恒为 undefined", () => {
    // 引擎把不认识的标识符编译成"从数据对象取这个名字"，故 `String(x)` 抛
    // `String is not a function`，出图失败退回纯文字。要转字符串就用 `'' + (x || '')`；
    // `<script>` 块里的同名调用由浏览器执行，不受此限，故只扫 `{{ }}` 之内
    const banned = /\b(?:String|Number|Boolean|Object|Array|Math|JSON|Date|RegExp|Map|Set|parseInt|parseFloat|isNaN)\s*[(.]/
    for (const file of htmlFiles()) {
      for (const hit of read(file).matchAll(/\{\{([\s\S]*?)\}\}/g)) {
        const expr = hit[1] ?? ""
        expect(banned.test(expr), `${file} 的模板表达式用了全局构造器：{{${expr.trim()}}}`).toBe(false)
      }
    }
  })

  it("每个主模板都拿得到配色变量 —— 否则全部设计变量取不到值", () => {
    // 皮肤布局把 `_skin` 写在 body 上、四份皮肤 css 一并加载，故继承它即有配色
    for (const want of REQUIRED) {
      expect(read(`${want}.html`), `${want}.html 没走皮肤布局、拿不到配色变量`).toMatch(/\{\{extend\s+skinLayout\}\}/)
    }
  })

  it("模板内联样式只用设计变量，不写死颜色", () => {
    // 配色集中在 resources/common/skin/ 那五份里，模板内联一个 `#9fd0ff` 就会在整体配色之外
    // 多出一个孤立色，且换皮肤时改不到它
    for (const file of htmlFiles()) {
      for (const block of read(file).match(/<style\b[^>]*>[\s\S]*?<\/style>/g) ?? []) {
        const literals = block.match(/(?:#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\))/g) ?? []
        expect(literals, `${file} 的内联样式写死了颜色 ${literals.join("、")}`).toEqual([])
      }
    }
  })
})
