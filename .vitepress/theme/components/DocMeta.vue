<script setup lang="ts">
/**
 * 一级标题下的一行：更新日期 · 字数 · 阅读时间
 *
 * 由 config.mts 的 markdown 插件插在每页第一个 h1 之后；字数在构建期由 transformPageData
 * 算好放进 frontmatter.wordCount。日期挂载后才格式化（同默认主题的「最后更新」）：
 * 服务端与浏览器时区不同，SSR 时就排好会水合不一致。
 */
import { computed, onMounted, ref } from "vue"
import { useData } from "vitepress"
import Icon from "./Icon.vue"

const { page, frontmatter } = useData()

/** 中文约每分钟 400 字 */
const PER_MINUTE = 400

const words = computed(() => Number(frontmatter.value.wordCount ?? 0))
const minutes = computed(() => Math.max(1, Math.round(words.value / PER_MINUTE)))
const wordText = computed(() => (words.value >= 10000 ? `${(words.value / 10000).toFixed(1)} 万字` : `${words.value} 字`))

const date = ref("")
onMounted(() => {
  const t = page.value.lastUpdated
  if (t === undefined || t <= 0) return
  date.value = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(t))
})
</script>

<template>
  <div v-if="words > 0" class="doc-meta">
    <span v-if="date" class="item" title="最后更新"><Icon name="calendar" :size="15" />{{ date }}更新</span>
    <span class="item" title="字数"><Icon name="text" :size="15" />{{ wordText }}</span>
    <span class="item" title="大约阅读时间"><Icon name="clock" :size="15" />约 {{ minutes }} 分钟读完</span>
  </div>
</template>

<style scoped>
.doc-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin: -6px 0 24px;
  padding-bottom: 16px;
  border-bottom: 1px dashed var(--vp-c-divider);
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.item :deep(.yz-icon) {
  color: var(--vp-c-brand-1);
}
</style>
