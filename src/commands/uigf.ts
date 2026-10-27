/**
 * 模块职责：抽卡记录的导入与导出 —— `#抽卡导入` / `#抽卡导出`
 * 依赖方向：依赖 session / store/uigf / store/gacha 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：**导入与导出都只在私聊受理**：一份 UIGF 文件含账号的全部抽卡历史与 uid。
 *
 *          导入**只合并、不覆盖**（见 `GachaStore.importRecords`）。
 *
 *          导出缺省 v4；附加「v2」出旧格式（星铁对应 SRGF v1.0）。
 */
import type { Session } from "../core/session.js"
import type { UigfFile, UigfVersion } from "../store/uigf.js"
import { buildUigf, parseUigf } from "../store/uigf.js"
import type { MhyDeps } from "./deps.js"

/** 导出文件里写的程序名 */
const APP_NAME = "Yunzai-NG"

/**
 * `#抽卡导入`
 *
 * QQ 发不出"命令自带文件附件"，故先收本条（回复一条文件消息再发命令时有）、没有再追问、
 * 把下一条消息当文件收。
 * @param s 会话
 * @param deps 依赖
 */
export async function importGacha(s: Session, deps: MhyDeps): Promise<void> {
  if (!s.isPrivate) {
    await s.text("导入只在私聊受理，请私聊发送「#抽卡导入」再发送文件")
    return
  }

  // 先看本条（回复文件消息再发命令的情形），没有就追问、把下一条当文件
  const got = (await s.file()) ?? (await s.askFile("请在 60 秒内把 UIGF / SRGF 的 json 文件作为下一条消息发来"))
  if (!got) {
    await s.text("没收到文件，请重发「#抽卡导入」后再单独发送 UIGF / SRGF 的 json 文件")
    return
  }

  let file: UigfFile
  try {
    file = JSON.parse(got.text) as UigfFile
  } catch {
    await s.text(`${got.name} 不是有效的 json，请重新导出一份完整文件再发`)
    return
  }

  const parsed = parseUigf(file, s.game, deps.meta?.loader)
  if (!parsed.ok || !parsed.records || !parsed.uid || !parsed.game) {
    await s.text(`导入失败：${parsed.message ?? "文件格式不正确"}`)
    return
  }

  // 记录按「用户 + uid」分键存，导入只会落到发起者本人名下这组键里 —— 伪造文件至多污染自己的统计，
  // 读不到也动不了别人的（见 store/gacha 文件头）
  const flat = [...parsed.records.values()].flat()
  const ret = await deps.gacha.importRecords(s.user, parsed.game, parsed.uid, flat)
  // 还没绑过这个游戏的 uid 时顺手绑上；已绑了别的就不动 —— 绑 uid 会把它切成当前 uid，导入一份文件不该悄悄换掉查询目标
  const bound = await deps.users.uids(s.user, parsed.game)
  const tail: string[] = []
  if (bound.length === 0) await deps.users.addUid(s.user, parsed.game, parsed.uid)
  else if (bound[0] !== parsed.uid) {
    tail.push(`这份记录属于 uid ${parsed.uid}，它不是你当前查询的 uid；要看它的统计请先「#切换uid」或「#绑定uid${parsed.uid}」`)
  }

  const lines = ret.pools.map(it => `${it.name}：新增 ${it.added} 条，共 ${it.total} 条`)
  await s.text(
    [`${got.name} 导入完成，uid ${parsed.uid}`, ...lines, `合计新增 ${ret.added} 条，本地共 ${ret.total} 条`, ...tail].join("\n")
  )
}

/**
 * `#抽卡导出`
 * @param s 会话
 * @param deps 依赖
 */
export async function exportGacha(s: Session, deps: MhyDeps): Promise<void> {
  if (!s.isPrivate) {
    await s.text("导出只在私聊受理，请私聊发送「#抽卡导出」")
    return
  }

  // 只认当前 uid：收链接、导入时都已把 uid 绑上并设为当前
  const uid = await deps.users.uid(s.user, s.game)
  if (!uid) {
    await s.text("没有可导出的记录，请先发送「#抽卡链接」同步一次，或「#绑定uid」")
    return
  }

  const pools = await deps.gacha.pools(s.user, s.game, uid)
  const total = pools.reduce((sum, it) => sum + it.records.length, 0)
  if (!total) {
    await s.text(`${uid} 没有本地抽卡记录，请先私聊发送「#抽卡链接」同步一次`)
    return
  }

  const version: UigfVersion = /v2|srgf/i.test(s.rest) ? "v2" : "v4"
  const file = buildUigf(s.game, uid, pools, version, { name: APP_NAME, version: deps.version ?? "" }, deps.meta?.loader)
  const name = `${version === "v2" && s.game === "sr" ? "SRGF" : "UIGF"}_${uid}.json`
  const text = JSON.stringify(file, null, "\t")

  // 次序有承载作用：先落盘，则"平台发不出文件"那一支仍留下盘上那一份。按发起者分目录，各存各的
  const saved = deps.gachaFiles?.save(s.user, s.game, uid, text, { legacy: version === "v2" })

  if (await s.sendFile(name, text)) {
    await s.text(`已导出 ${total} 条记录（${version === "v2" ? "旧格式" : "UIGF v4"}）`)
    return
  }
  await s.text(
    saved
      ? `当前平台发不了文件，已存到本地：${saved}`
      : "导出失败，当前平台发不了文件，请换一个支持发文件的客户端重试"
  )
}
