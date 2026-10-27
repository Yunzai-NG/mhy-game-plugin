<script setup lang="ts">
/**
 * 模拟一段 QQ 对话：自己发的在右、机器人回的在左，图点开看原图
 *
 * 图都是演示数据出的（编的 uid、昵称与 Cookie），放在 public/shots/ 下。宽高取自 shots.json，
 * 图未到时先按比例占好位置；长图在气泡里只露上半截，点开再看全图。
 * 给 `pages` 时，标题栏下多一排命令页签，一次只显示一条命令的对话。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { withBase } from "vitepress"
import SIZES from "../shots.json"
import { PERSONA, type ChatGame } from "../personas"
import Icon from "./Icon.vue"

export interface ChatMsg {
  /** 自己发的为真（右侧）；不给即机器人（左侧） */
  me?: boolean
  /** 发送者名字；不给时按 `game` 取（见 PERSONA） */
  name?: string
  /** 名字旁的小标签，如「主人」「群管理」 */
  tag?: string
  /** 文字；`\n` 换行 */
  text?: string
  /** 图，`public/shots/` 下的路径、不带后缀，如 `panel/detail` */
  img?: string
  /** 图的文字说明，读屏与放大层用 */
  alt?: string
  /** 发出去的文件名 */
  file?: string
  /** 居中的灰色小字：时间、系统提示 */
  tip?: string
}

/** 一页对话：同一段聊天里的一条命令，页签上印 `label`（缺省取第一句自己发的话） */
export interface ChatPage {
  label?: string
  msgs: ChatMsg[]
}

const props = withDefaults(
  defineProps<{ msgs?: ChatMsg[]; pages?: ChatPage[]; title?: string; group?: boolean; game?: ChatGame }>(),
  { msgs: () => [], pages: () => [], title: "", group: false, game: "mys" }
)

/** 一段聊天里要演示好几条命令时分页签，点哪条就只看那条的对话与图；一条都不给时就是普通的一段对话 */
const page = ref(0)
const uid = `qqp-${Math.random().toString(36).slice(2, 8)}`
const shown = computed(() => (props.pages.length ? (props.pages[page.value]?.msgs ?? []) : props.msgs))
const labelOf = (p: ChatPage) => p.label ?? p.msgs.find(m => m.me && m.text)?.text ?? ""

/** 左右方向键切页签 */
function onKey(e: KeyboardEvent) {
  const n = props.pages.length
  if (e.key === "ArrowRight") page.value = (page.value + 1) % n
  else if (e.key === "ArrowLeft") page.value = (page.value - 1 + n) % n
  else return
  e.preventDefault()
  ;(document.getElementById(`${uid}-t${page.value}`) as HTMLButtonElement | null)?.focus()
}

/** 气泡里图的最高高度，超出即按长图处理 */
const MAX_H = 420
/** 气泡里图的宽度 */
const W = 260

const sizes = SIZES as Record<string, [number, number]>
const persona = computed(() => PERSONA[props.game] ?? PERSONA.mys)
const botFace = computed(() => withBase(`/mascot/${props.game}.webp`))
const heading = computed(() => props.title || (props.group ? "米游社小分队（5）" : persona.value.bot))

function shot(name: string) {
  const [w, h] = sizes[name] ?? [1280, 1600]
  const full = Math.round((W * h) / w)
  return { src: withBase(`/shots/${name}.webp`), w, h, show: Math.min(full, MAX_H), long: full > MAX_H }
}

const dialog = ref<HTMLDialogElement>()
const zoomed = ref<{ src: string; alt: string } | undefined>()

function zoom(name: string, alt: string) {
  zoomed.value = { src: shot(name).src, alt }
  // 放大层打开时锁住页面滚动：不锁则在图外滑动带着底下的文档一起走
  document.documentElement.style.overflow = "hidden"
  dialog.value?.showModal()
}

function close() {
  dialog.value?.close()
}

function onClosed() {
  zoomed.value = undefined
  document.documentElement.style.overflow = ""
}

/** 滚轮 / 触摸滑动只在长图本身可滚时放行；要 passive: false 才拦得住，模板上的 @wheel 拦不住 */
function trap(e: Event) {
  const box = dialog.value
  if (!box || box.scrollHeight <= box.clientHeight) e.preventDefault()
}

onMounted(() => {
  dialog.value?.addEventListener("wheel", trap, { passive: false })
  dialog.value?.addEventListener("touchmove", trap, { passive: false })
})

onBeforeUnmount(() => {
  dialog.value?.removeEventListener("wheel", trap)
  dialog.value?.removeEventListener("touchmove", trap)
  if (zoomed.value) document.documentElement.style.overflow = ""
})

const nameOf = (m: ChatMsg) => m.name ?? (m.me ? persona.value.me : persona.value.bot)
const initial = (m: ChatMsg) => nameOf(m).slice(0, 1)
</script>

<template>
  <figure class="qq">
    <header class="qq-bar">
      <Icon :name="group ? 'users' : 'message'" :size="15" />
      <span>{{ heading }}</span>
    </header>
    <div v-if="pages.length" class="qq-pages" role="tablist" aria-label="切换命令" @keydown="onKey">
      <button
        v-for="(p, i) in pages"
        :id="`${uid}-t${i}`"
        :key="i"
        type="button"
        role="tab"
        class="qq-page"
        :class="{ on: i === page }"
        :aria-selected="i === page"
        :aria-controls="`${uid}-body`"
        :tabindex="i === page ? 0 : -1"
        @click="page = i"
      >{{ labelOf(p) }}</button>
    </div>
    <div :id="`${uid}-body`" class="qq-body" :role="pages.length ? 'tabpanel' : undefined">
      <template v-for="(m, i) in shown" :key="`${page}-${i}`">
        <p v-if="m.tip" class="qq-tip">{{ m.tip }}</p>
        <div v-else class="qq-row" :class="{ me: m.me }">
          <span v-if="m.me" class="qq-ava user" aria-hidden="true">{{ initial(m) }}</span>
          <img v-else class="qq-ava bot" :src="botFace" :alt="persona.bot" />
          <div class="qq-col">
            <span v-if="group || m.tag" class="qq-name">
              <em v-if="m.tag">{{ m.tag }}</em>{{ group ? nameOf(m) : "" }}
            </span>
            <button v-if="m.img" type="button" class="qq-img" :class="{ long: shot(m.img).long }" :style="{ height: shot(m.img).show + 'px' }" :aria-label="`点开查看大图：${m.alt ?? '机器人回复的图片'}`" @click="zoom(m.img, m.alt ?? '机器人回复的图片')">
              <img :src="shot(m.img).src" :width="shot(m.img).w" :height="shot(m.img).h" alt="" loading="lazy" decoding="async" />
              <span v-if="shot(m.img).long" class="qq-more"><Icon name="image" :size="13" />长图，点开看全部</span>
            </button>
            <div v-else-if="m.file" class="qq-bubble qq-file">
              <Icon name="box" :size="22" />
              <span>{{ m.file }}</span>
            </div>
            <div v-else class="qq-bubble">{{ m.text }}</div>
          </div>
        </div>
      </template>
    </div>
    <dialog ref="dialog" class="qq-box" @click="close" @close="onClosed">
      <img v-if="zoomed" :src="zoomed.src" :alt="zoomed.alt" />
      <span class="qq-close">点击任意处或按 Esc 关闭</span>
    </dialog>
  </figure>
</template>
<style scoped>
.qq {
  --qq-bg: #f2f3f5;
  --qq-bar: #ffffff;
  --qq-them: #ffffff;
  --qq-them-text: #1f2329;
  --qq-mine: #0099ff;
  --qq-mine-text: #ffffff;
  --qq-tip: #8f959e;
  margin: 20px 0;
  max-width: 460px;
  border-radius: var(--yz-radius);
  border: 1px solid var(--vp-c-divider);
  overflow: hidden;
  background: var(--qq-bg);
  box-shadow: 0 18px 40px -28px rgb(0 0 0 / 40%);
}

.dark .qq {
  --qq-bg: #17181c;
  --qq-bar: #202227;
  --qq-them: #2b2d33;
  --qq-them-text: #e6e8eb;
  --qq-mine: #1677d9;
  --qq-tip: #80858f;
}

.qq-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 14px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  background: var(--qq-bar);
  border-bottom: 1px solid var(--vp-c-divider);
}

.qq-bar :deep(.yz-icon) {
  color: var(--vp-c-text-3);
}

/* 命令页签：横排可换行，选中那条用发送气泡的蓝 */
.qq-pages {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  background: var(--qq-bar);
  border-bottom: 1px solid var(--vp-c-divider);
}

.qq-page {
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  font-size: 12px;
  line-height: 20px;
  color: var(--vp-c-text-2);
  background: transparent;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.qq-page:hover {
  color: var(--vp-c-text-1);
}

.qq-page.on {
  color: #fff;
  border-color: var(--qq-mine);
  background: var(--qq-mine);
}

.qq-page:focus-visible {
  outline: 2px solid var(--yz-brand-2);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .qq-page {
    transition: none;
  }
}

.qq-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 12px 18px;
}

.qq-tip {
  align-self: center;
  margin: 0;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 20px;
  color: var(--qq-tip);
  background: rgb(0 0 0 / 4%);
}

.dark .qq-tip {
  background: rgb(255 255 255 / 5%);
}

.qq-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.qq-row.me {
  flex-direction: row-reverse;
}

.qq-ava {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
}

.qq-ava.bot {
  padding: 1px;
  object-fit: contain;
  background: var(--qq-bar);
  border: 1px solid var(--vp-c-divider);
}

.qq-ava.user {
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--yz-brand-2), var(--yz-sky));
}
.qq-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  max-width: calc(100% - 84px);
}

.me .qq-col {
  align-items: flex-end;
}

.qq-name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 16px;
  color: var(--qq-tip);
}

.qq-name em {
  padding: 0 5px;
  border-radius: 4px;
  font-style: normal;
  font-size: 11px;
  color: #fff;
  background: #f5a524;
}

.qq-bubble {
  padding: 8px 12px;
  border-radius: 4px 14px 14px 14px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--qq-them-text);
  background: var(--qq-them);
}

.me .qq-bubble {
  border-radius: 14px 4px 14px 14px;
  color: var(--qq-mine-text);
  background: var(--qq-mine);
}

.qq-file {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: normal;
}

.qq-img {
  position: relative;
  display: block;
  width: 260px;
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  border-radius: 10px;
  cursor: zoom-in;
  background: var(--qq-them);
}

.qq-img img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 0;
}

.qq-img.long::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 72px;
  background: linear-gradient(transparent, rgb(0 0 0 / 55%));
}

.qq-more {
  position: absolute;
  z-index: 1;
  right: 10px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  color: #fff;
  background: rgb(10 14 22 / 70%);
}

.qq-img:hover,
.qq-img:focus-visible {
  outline: 2px solid var(--yz-brand-2);
  outline-offset: 2px;
}

.qq-box {
  max-width: 96vw;
  max-height: 96vh;
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-out;
  overflow: auto;
  /* 长图滚到头时不把滚动链到页面上 */
  overscroll-behavior: contain;
}

.qq-box::backdrop {
  background: rgb(5 7 12 / 82%);
  backdrop-filter: blur(4px);
}

.qq-box img {
  display: block;
  width: min(900px, 94vw);
  height: auto;
  border-radius: 10px;
}

.qq-close {
  position: sticky;
  bottom: 0;
  display: block;
  padding: 8px 0;
  font-size: 12px;
  color: #c9d1e3;
  text-align: center;
  background: rgb(5 7 12 / 60%);
}

@media (max-width: 480px) {
  .qq {
    max-width: none;
  }

  .qq-img {
    width: 220px;
  }
}
</style>
