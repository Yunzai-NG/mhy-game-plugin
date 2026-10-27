<script setup lang="ts">
/** 卡片式链接：下一步去哪、按需求挑文档。站外链接新开页 */
import { withBase } from "vitepress"
import Icon from "./Icon.vue"

export interface LinkCard {
  icon: string
  title: string
  desc: string
  link: string
}

defineProps<{ items: LinkCard[] }>()

const external = (link: string) => /^https?:\/\//.test(link)
</script>

<template>
  <div class="cards">
    <a
      v-for="c in items"
      :key="c.link"
      class="card"
      :href="external(c.link) ? c.link : withBase(c.link)"
      :target="external(c.link) ? '_blank' : undefined"
      :rel="external(c.link) ? 'noreferrer' : undefined"
    >
      <span class="ic"><Icon :name="c.icon" :size="20" /></span>
      <span class="body">
        <strong>{{ c.title }}</strong>
        <span>{{ c.desc }}</span>
      </span>
      <Icon class="go" name="arrow" :size="16" />
    </a>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
  gap: 12px;
  margin: 20px 0;
}

.card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 16px 16px 14px;
  border-radius: var(--yz-radius);
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: inherit;
  text-decoration: none !important;
  transition: border-color 0.25s, transform 0.25s, box-shadow 0.25s;
}

.card:hover {
  border-color: var(--vp-c-brand-2);
  transform: translateY(-2px);
  box-shadow: 0 14px 30px -20px var(--yz-glow);
}

.ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding-right: 14px;
}

.body strong {
  font-size: 15px;
  line-height: 1.4;
  color: var(--vp-c-text-1);
}

.body span {
  font-size: 13px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.go {
  position: absolute;
  right: 14px;
  top: 18px;
  color: var(--vp-c-text-3);
  transition: transform 0.25s, color 0.25s;
}

.card:hover .go {
  color: var(--vp-c-brand-1);
  transform: translateX(3px);
}
</style>
