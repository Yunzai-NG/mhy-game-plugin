<script setup lang="ts">
/**
 * 文章页右下角的「回到顶部」：向下滚过 400px 才出现，外圈的环随阅读进度走满
 *
 * 只在文档页（有侧栏的那种）出现：首页本身就是一屏一屏往下翻的落地页，用不着它。
 */
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useData } from "vitepress"
import Icon from "./Icon.vue"

const SHOW_AFTER = 400
const R = 20
const LEN = 2 * Math.PI * R

const { frontmatter } = useData()
const isDoc = computed(() => (frontmatter.value.layout ?? "doc") === "doc")
const shown = ref(false)
const progress = ref(0)
let frame = 0

function measure() {
  frame = 0
  const y = window.scrollY
  const max = document.documentElement.scrollHeight - window.innerHeight
  shown.value = y > SHOW_AFTER
  progress.value = max > 0 ? Math.min(1, y / max) : 0
}

function onScroll() {
  if (frame === 0) frame = requestAnimationFrame(measure)
}

function toTop() {
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches
  window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" })
}

onMounted(() => {
  window.addEventListener("scroll", onScroll, { passive: true })
  measure()
})
onUnmounted(() => {
  window.removeEventListener("scroll", onScroll)
  if (frame !== 0) cancelAnimationFrame(frame)
})
</script>

<template>
  <button v-if="isDoc" type="button" class="to-top" :class="{ on: shown }" aria-label="回到顶部" title="回到顶部" :tabindex="shown ? 0 : -1" @click="toTop">
    <svg class="ring" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" :r="R" class="track" />
      <circle cx="24" cy="24" :r="R" class="bar" :stroke-dasharray="LEN" :stroke-dashoffset="LEN * (1 - progress)" />
    </svg>
    <Icon name="up" :size="18" />
  </button>
</template>

<style scoped>
.to-top {
  position: fixed;
  right: 24px;
  bottom: 28px;
  z-index: 30;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-bg) 82%, transparent);
  box-shadow: 0 10px 26px -12px rgb(0 0 0 / 45%), 0 0 0 1px var(--vp-c-divider);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  opacity: 0;
  transform: translateY(12px) scale(0.9);
  pointer-events: none;
  transition: opacity 0.25s, transform 0.25s, color 0.2s;
}

.to-top.on {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}

.to-top:hover {
  color: var(--yz-sky);
}

.ring {
  position: absolute;
  inset: 0;
  transform: rotate(-90deg);
}

.track,
.bar {
  fill: none;
  stroke-width: 2.5;
}

.track {
  stroke: var(--vp-c-divider);
}

.bar {
  stroke: currentColor;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.1s linear;
}

@media (max-width: 640px) {
  .to-top {
    right: 16px;
    bottom: 20px;
    width: 44px;
    height: 44px;
  }
}
</style>
