/**
 * 模块职责：文档站主题 —— 沿用 VitePress 默认主题，换 Yunzai NG 主站那套配色并注册全局组件
 * 依赖方向：构建期依赖 vitepress 默认主题与本目录组件
 * 生命周期：构建期与浏览器运行期
 * 注意事项：只扩展、不替换默认主题（`extends: DefaultTheme`），导航、侧栏、搜索一律照旧。
 *          `LinkCards`、`QQChat`、`QQTabs` 供 markdown 直接使用；`DocMeta` 由 config.mts 插进每页 h1 之后；
 *          「回到顶部」挂在布局底部，全站一份。
 */
import DefaultTheme from "vitepress/theme"
import type { Theme } from "vitepress"
import { h } from "vue"
import BackToTop from "./components/BackToTop.vue"
import DocMeta from "./components/DocMeta.vue"
import LinkCards from "./components/LinkCards.vue"
import QQChat from "./components/QQChat.vue"
import QQTabs from "./components/QQTabs.vue"
import "./style.css"

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { "layout-bottom": () => h(BackToTop) }),
  enhanceApp({ app }) {
    app.component("DocMeta", DocMeta)
    app.component("LinkCards", LinkCards)
    app.component("QQChat", QQChat)
    app.component("QQTabs", QQTabs)
  }
} satisfies Theme
