<script setup lang="ts">
/**
 * 三个游戏都有的功能（活动日历、体力……）按游戏分页签，每页一段 QQ 对话
 *
 * 页签按钮就是那个游戏机器人的表情（public/mascot/），对话里的机器人随页签换人。
 */
import { ref } from "vue"
import { withBase } from "vitepress"
import { PERSONA, type ChatGame } from "../personas"
import QQChat, { type ChatMsg, type ChatPage } from "./QQChat.vue"

export interface ChatTab {
  /** 游戏 */
  game: ChatGame
  /** 这一页的对话 */
  msgs?: ChatMsg[]
  /** 这一页有好几条命令时分页签，见 QQChat 的 `pages` */
  pages?: ChatPage[]
  /** 对话框标题，缺省是机器人名 */
  title?: string
  /** 群聊样式 */
  group?: boolean
}

const props = defineProps<{ tabs: ChatTab[] }>()
const at = ref(0)
const uid = `qqt-${Math.random().toString(36).slice(2, 8)}`

/** 左右方向键切页签，读屏用户不必逐个 Tab 过去 */
function onKey(e: KeyboardEvent) {
  const n = props.tabs.length
  if (e.key === "ArrowRight") at.value = (at.value + 1) % n
  else if (e.key === "ArrowLeft") at.value = (at.value - 1 + n) % n
  else return
  e.preventDefault()
  ;(document.getElementById(`${uid}-t${at.value}`) as HTMLButtonElement | null)?.focus()
}
</script>

<template>
  <div class="qqt">
    <div class="qqt-bar" role="tablist" aria-label="按游戏切换" @keydown="onKey">
      <button
        v-for="(t, i) in tabs"
        :id="`${uid}-t${i}`"
        :key="t.game"
        type="button"
        role="tab"
        class="qqt-tab"
        :class="{ on: i === at }"
        :aria-selected="i === at"
        :aria-controls="`${uid}-p${i}`"
        :tabindex="i === at ? 0 : -1"
        @click="at = i"
      >
        <img :src="withBase(`/mascot/${t.game}.webp`)" alt="" />
        <span>{{ PERSONA[t.game].game }}</span>
      </button>
    </div>
    <div
      v-for="(t, i) in tabs"
      v-show="i === at"
      :id="`${uid}-p${i}`"
      :key="t.game"
      role="tabpanel"
      :aria-labelledby="`${uid}-t${i}`"
    >
      <QQChat :msgs="t.msgs" :pages="t.pages" :game="t.game" :title="t.title" :group="t.group" />
    </div>
  </div>
</template>

<style scoped>
.qqt {
  margin: 20px 0;
  max-width: 460px;
}

.qqt-bar {
  display: flex;
  gap: 8px;
  margin-bottom: -12px;
}

.qqt-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 76px;
  padding: 6px 4px 4px;
  border-radius: 12px 12px 0 0;
  border: 1px solid transparent;
  border-bottom: 0;
  font-size: 12px;
  color: var(--vp-c-text-2);
  background: transparent;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.qqt-tab img {
  width: 44px;
  height: 44px;
  object-fit: contain;
  filter: grayscale(0.7);
  opacity: 0.65;
  transition: filter 0.15s, opacity 0.15s, transform 0.15s;
}

.qqt-tab:hover img,
.qqt-tab.on img {
  filter: none;
  opacity: 1;
}

.qqt-tab.on {
  color: var(--vp-c-text-1);
  font-weight: 600;
  background: var(--vp-c-bg-soft);
  border-color: var(--vp-c-divider);
}

.qqt-tab.on img {
  transform: translateY(-2px) scale(1.06);
}

.qqt-tab:focus-visible {
  outline: 2px solid var(--yz-brand-2);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .qqt-tab,
  .qqt-tab img {
    transition: none;
  }

  .qqt-tab.on img {
    transform: none;
  }
}
</style>
