/**
 * 模块职责：`#原图` —— 把刚发出去那张图上的立绘按原始尺寸再发一遍
 * 依赖方向：依赖 session、命令层依赖包与 store/original
 * 生命周期：无状态函数
 * 注意事项：要平台两项能力齐备：发消息时回消息 id、引用消息时带上被引用的 id。
 *          缺一时索引对不上，回一句认不出而不是当作故障。
 *
 *          发的是素材本身（元数据里的官方立绘，或使用者上传的面板图），不是渲染出来那张图。
 *          索引三小时过期。
 */
import { existsSync } from "node:fs"
import type { Session } from "../core/session.js"
import type { OriginalKind, OriginalRecord, OriginalSlot } from "../store/original.js"
import type { MhyDeps } from "./deps.js"

/** 各来源在提示语里的说法 */
const KIND_TEXT: Readonly<Record<OriginalKind, string>> = {
  character: "角色卡片",
  profile: "面板"
}

/**
 * 发完图之后记一笔原图索引
 * @param s 会话
 * @param deps 依赖
 * @param rec 来源与路径
 * @param slot 槽位，缺省是立绘那一格
 */
export async function rememberOriginal(
  s: Session,
  deps: MhyDeps,
  rec: OriginalRecord,
  slot: OriginalSlot = "pic"
): Promise<void> {
  const store = deps.originals
  if (!store) return
  await store.remember(s.lastSent(), slot, rec)
}

/**
 * 把相对路径拼成绝对路径
 *
 * 两个根各由持有者来拼：上传的那些在面板图目录下，官方立绘在元数据目录下。
 * @param deps 依赖
 * @param rel 相对路径
 * @param upload 是否为使用者上传的面板图
 * @returns 绝对路径；根不可用时 undefined
 */
export function originalPathOf(deps: MhyDeps, rel: string, upload: boolean): string | undefined {
  if (!rel) return undefined
  if (upload) return deps.panelImgs?.pathOf(rel)
  return deps.meta?.loader.pathOf(rel)
}

/**
 * `#原图`
 *
 * 形态是"回复那张图，再发一句 `#原图`"。
 * @param s 会话
 * @param deps 依赖
 */
export async function originalPic(s: Session, deps: MhyDeps): Promise<void> {
  await sendOriginal(s, deps, "pic")
}

/**
 * 取一个槽位的原图并发出去
 * @param s 会话
 * @param deps 依赖
 * @param slot 槽位
 */
async function sendOriginal(s: Session, deps: MhyDeps, slot: OriginalSlot): Promise<void> {
  const store = deps.originals
  if (!store) {
    await s.text("原图功能未启用")
    return
  }
  if (!deps.config().allowOriginalPic) {
    await s.text("主人关掉了「允许索取原图」")
    return
  }

  const quoted = s.quotedId
  if (!quoted) {
    await s.text("请「回复」要索取原图的那张图片，再发送「#原图」")
    return
  }

  const got = await store.get(quoted, slot)
  if (!got) {
    await s.text("这张图太久了（原图索引只留三小时），或者它本来就没有原图")
    return
  }
  if (!existsSync(got.path)) {
    await s.text("原图文件已经不在了，可能是元数据更新时换掉了它")
    return
  }

  const ok = await s.imageFile(got.path, `${KIND_TEXT[got.kind]}原图`)
  if (!ok) await s.text("原图发送失败，可能是文件过大被平台拒收")
}
