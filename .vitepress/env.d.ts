/**
 * 模块职责：补齐编辑器解析不到的几处类型
 * 依赖方向：只声明类型，不参与构建
 * 生命周期：编辑期与类型检查
 * 注意事项：theme/components/Sidebar.vue 直接引用了默认主题的内部模块，那几个文件随包只发 .js，
 *          没有 .d.ts；这里只声明用到的那一个函数。升级 vitepress 时对一下它的返回值。
 */
declare module "*.vue" {
  import type { DefineComponent } from "vue"
  const component: DefineComponent
  export default component
}

declare module "vitepress/dist/client/theme-default/composables/sidebar.js" {
  import type { ComputedRef } from "vue"
  import type { DefaultTheme } from "vitepress/theme"

  export function useSidebar(): {
    sidebarGroups: ComputedRef<DefaultTheme.SidebarItem[]>
    hasSidebar: ComputedRef<boolean>
  }
}

declare module "@vp-theme/VPSidebarGroup.vue" {
  import type { DefineComponent } from "vue"
  const component: DefineComponent<{ items: unknown[] }>
  export default component
}
