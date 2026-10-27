/**
 * 模块职责：文档站构建与主题配置
 * 依赖方向：构建期依赖 vitepress
 * 生命周期：构建期
 * 注意事项：`base` 由发布时的 Pages 配置给（DOCS_BASE，见 .github/workflows/deploy.yml），本地预览落在根路径。
 *          `head` 里的地址 VitePress 不补 base，故手拼；漏拼则项目页上 favicon 全是 404。
 *          侧栏逐项声明而非扫描目录：阅读顺序由内容决定，按文件名排只能得到字母序。
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, type DefaultTheme } from "vitepress"

const BASE = `${process.env.DOCS_BASE ?? ""}/`

/** 正文字数：汉字逐个计，英文与数字按词计；先去掉 frontmatter、HTML 标签与 markdown 记号 */
function countWords(source: string): number {
  const text = source
    .replace(/^---[\s\S]*?\n---/, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/[#>*_`|~[\]-]/g, " ")
  const han = text.match(/[㐀-鿿豈-﫿]/g)?.length ?? 0
  const latin = text.replace(/[㐀-鿿豈-﫿]/g, " ").match(/[A-Za-z0-9]+(?:[.'][A-Za-z0-9]+)*/g)?.length ?? 0
  return han + latin
}

/** 侧栏每个分组都标成可折叠、默认折起；配合 theme/components/Sidebar.vue，只展开含当前页的那一组 */
function foldAll(items: DefaultTheme.SidebarItem[]): DefaultTheme.SidebarItem[] {
  return items.map(item =>
    item.items === undefined ? item : { ...item, collapsed: true, items: foldAll(item.items) }
  )
}

export default defineConfig({
  lang: "zh-CN",
  title: "mhy-game",
  description: "Yunzai NG 的米哈游游戏插件：原神 / 星穹铁道 / 绝区零",
  base: BASE,
  cleanUrls: true,
  lastUpdated: true,
  // 本地的设计记录，不进分支也不进站点
  srcExclude: ["plans/**", "README.md"],

  transformPageData(pageData, { siteConfig }) {
    if ((pageData.frontmatter.layout ?? "doc") !== "doc") return
    const source = readFileSync(join(siteConfig.srcDir, pageData.relativePath), "utf8")
    pageData.frontmatter.wordCount = countWords(source)
  },

  markdown: {
    // 每页第一个 h1 之后插一行「更新日期 · 字数 · 阅读时间」
    config(md) {
      md.core.ruler.push("mhy-doc-meta", state => {
        const i = state.tokens.findIndex(t => t.type === "heading_close" && t.tag === "h1")
        if (i < 0) return
        const token = new state.Token("html_block", "", 0)
        token.content = "<DocMeta />\n"
        state.tokens.splice(i + 1, 0, token)
      })
    }
  },

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${BASE}brand/logo-rounded.svg` }],
    ["link", { rel: "icon", type: "image/png", sizes: "1024x1024", href: `${BASE}brand/logo-rounded.png` }],
    ["link", { rel: "apple-touch-icon", href: `${BASE}brand/logo-rounded.png` }],
    ["meta", { name: "theme-color", content: "#0b0e16" }]
  ],

  themeConfig: {
    logo: { src: "/brand/logo-mark.svg", alt: "" },

    nav: [
      { text: "使用指南", link: "/guide/start", activeMatch: "^/guide/" },
      { text: "部署", link: "/deploy/", activeMatch: "^/deploy/" },
      { text: "开发者指南", link: "/dev/", activeMatch: "^/dev/" },
      {
        text: "参考",
        activeMatch: "^/reference/",
        items: [
          { text: "命令一览", link: "/reference/commands" },
          { text: "配置项", link: "/reference/config" }
        ]
      },
      { text: "Yunzai NG", link: "https://yunzai-ng.github.io" }
    ],

    // 按读者排：先用起来，再部署，再写代码，最后是查阅用的参考
    sidebar: foldAll([
      {
        text: "使用指南",
        items: [
          { text: "快速上手", link: "/guide/start" },
          { text: "绑定账号", link: "/guide/account" },
          { text: "日常与战绩", link: "/guide/daily" },
          { text: "角色面板", link: "/guide/panel" },
          { text: "群排行", link: "/guide/rank" },
          { text: "抽卡记录", link: "/guide/gacha" },
          { text: "图鉴与资料", link: "/guide/wiki" },
          { text: "签到", link: "/guide/sign" },
          { text: "常见问题", link: "/guide/faq" }
        ]
      },
      {
        text: "部署",
        items: [
          { text: "安装与元数据", link: "/deploy/" },
          { text: "缺省关闭的功能", link: "/deploy/privacy" },
          { text: "主人与群管理", link: "/deploy/admin" }
        ]
      },
      {
        text: "开发者指南",
        items: [
          {
            text: "上手",
            items: [
              { text: "准备与验证", link: "/dev/" },
              { text: "整体结构", link: "/dev/architecture" }
            ]
          },
          {
            text: "写功能",
            items: [
              { text: "加一条命令", link: "/dev/command" },
              { text: "查米游社接口", link: "/dev/query" },
              { text: "视图与模板", link: "/dev/template" },
              { text: "元数据", link: "/dev/meta" }
            ]
          },
          {
            text: "协作",
            items: [
              { text: "对外服务", link: "/dev/services" },
              { text: "测试与约定", link: "/dev/conventions" },
              { text: "维护本站", link: "/dev/docs" }
            ]
          }
        ]
      },
      {
        text: "参考",
        items: [
          { text: "命令一览", link: "/reference/commands" },
          { text: "配置项", link: "/reference/config" }
        ]
      }
    ]),

    socialLinks: [{ icon: "github", link: "https://github.com/Yunzai-NG/mhy-game-plugin" }],

    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
          modal: {
            displayDetails: "显示详细列表",
            resetButtonTitle: "清空查询",
            backButtonTitle: "关闭搜索",
            noResultsText: "没有找到相关结果",
            footer: {
              selectText: "选择",
              selectKeyAriaLabel: "回车",
              navigateText: "切换",
              navigateUpKeyAriaLabel: "上方向键",
              navigateDownKeyAriaLabel: "下方向键",
              closeText: "关闭",
              closeKeyAriaLabel: "Esc"
            }
          }
        }
      }
    },

    outline: { level: [2, 3], label: "本页目录" },
    docFooter: { prev: "上一页", next: "下一页" },
    lastUpdated: { text: "最后更新" },
    darkModeSwitchLabel: "外观",
    lightModeSwitchTitle: "切换到浅色",
    darkModeSwitchTitle: "切换到深色",
    sidebarMenuLabel: "目录",
    returnToTopLabel: "回到顶部",
    notFound: { title: "页面不存在", quote: "这一页可能改了位置，从顶部导航重新找一下。", linkText: "回到首页" },

    editLink: {
      pattern: "https://github.com/Yunzai-NG/mhy-game-plugin/edit/docs/:path",
      text: "在 GitHub 上编辑本页"
    },

    footer: {
      message: "以 AGPL-3.0-or-later 许可发布",
      copyright: "Yunzai NG 官方可选插件"
    }
  },

  vite: {
    resolve: {
      // 默认主题的 Layout 以相对路径引入侧栏；只换掉这一处引用，见 theme/components/Sidebar.vue
      alias: [
        {
          find: /^\.\/components\/VPSidebar\.vue$/,
          replacement: fileURLToPath(new URL("./theme/components/Sidebar.vue", import.meta.url))
        },
        { find: /^@vp-theme\//, replacement: "vitepress/dist/client/theme-default/components/" }
      ]
    }
  }
})
