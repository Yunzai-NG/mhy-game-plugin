<script setup lang="ts">
import { ICONS } from "./icons"

withDefaults(defineProps<{ name: string; size?: number | string }>(), { size: 20 })
</script>

<template>
  <svg
    class="yz-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="ICONS[name] ?? ''"
  />
</template>

<style scoped>
.yz-icon {
  flex: none;
  display: inline-block;
  vertical-align: middle;
}
</style>
