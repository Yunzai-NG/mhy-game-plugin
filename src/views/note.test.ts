/**
 * 模块职责：便笺视图的测试 —— 出图那几块的取值与出没，以及文字回退
 * 依赖方向：测试文件，依赖 views/note.ts 与夹具；纯函数
 * 生命周期：无状态
 * 注意事项：固定官方便笺页的几条判据（各块出不出现、印哪句），以及**字段缺失不导致异常** —— 米游社增减字段
 *          不作预先通知，视图层必须能够接受一份近乎为空的 data。必须钉住"现在"，否则时刻串随真实日期变。
 */
import { describe, expect, it } from "vitest"
import type { GsNoteBlocks } from "./gs/note.js"
import { buildNote, noteTemplateData, noteText } from "./note.js"
import { GS_NOTE, SR_NOTE, ZZZ_NOTE } from "./note-fixtures.test-data.js"
import type { SrNoteBlocks } from "./sr/note.js"
import type { ZzzNoteBlocks } from "./zzz/note.js"

/** 固定的"现在"：2026-08-22 13:20 星期六 */
const NOW = new Date(2026, 7, 22, 13, 20, 0).getTime()

/**
 * 取原神那几块
 * @param raw 原始数据
 * @returns 模板数据
 */
const gs = (raw: object): GsNoteBlocks =>
  noteTemplateData(raw, { game: "gs", uid: "100000001", name: "旅行者", now: NOW }) as unknown as GsNoteBlocks

describe("原神便笺", () => {
  it("魔神任务：主线逐章一行，间章并成一行「进行中」", () => {
    const b = gs(GS_NOTE)
    expect(b.archon).toHaveLength(2)
    expect(b.archon[0]).toMatchObject({ desc: "第五章第六幕　你存在的时空", value: "尚未开启" })
    expect(b.archon[1]).toMatchObject({ desc: "空月之歌 第一幕　雪浪与苍林之舞", value: "进行中" })
  })

  it("魔神任务一章都没有时，按开没开启说「全部完成」或「尚未开启」", () => {
    expect(gs({ archon_quest_progress: { list: [], is_open_archon_quest: true } }).archon[0]?.value).toBe("全部完成")
    expect(gs({}).archon[0]?.value).toBe("尚未开启")
  })

  it("树脂、宝钱：未满给几时恢复，满了标出来", () => {
    const b = gs(GS_NOTE)
    expect(b.resin).toMatchObject({ value: "30/200", hot: false })
    expect(b.resin.desc).toBe("将于22小时39分钟后全部恢复（明天 11:59）")
    expect(b.coin).toMatchObject({ value: "2400/2400", desc: "已满", hot: true })
    // 上限为 0 即尘歌壶没开：不说「已满」
    expect(gs({ max_home_coin: 0 }).coin).toMatchObject({ value: "未开启", hot: false })
    expect(gs({ max_home_coin: 0 }).coin.desc).toBeUndefined()
  })

  it("委托做完没领额外奖励时说「奖励未领取」并标出来；四格按状态换图", () => {
    const b = gs(GS_NOTE)
    expect(b.task).toMatchObject({ value: "奖励未领取", hot: true })
    expect(b.task.tasks.map(it => it.icon.split("/").pop())).toEqual(["委托-已领.png", "委托-完成.png", "委托-完成.png", "委托-未完成.png"])
    expect(b.task.points.map(it => it.icon.split("/").pop())).toEqual([
      "历练点-已领.png",
      "历练点-可领.png",
      "历练点-未完成.png",
      "历练点-不可领.png"
    ])
    // 不可领那格不套环；未完成那格按 500/2000 画四分之一
    expect(b.task.points.map(it => it.ringed)).toEqual([false, true, true, false])
    expect(b.task.points[2]?.ring).toBe(25)
    expect(b.task).toMatchObject({ stored: "x0.6", storedLeft: "10天" })
  })

  it("历练点那一排受 attendance_visible 把关", () => {
    const hidden = gs({ daily_task: { ...GS_NOTE.daily_task, attendance_visible: false } })
    expect(hidden.task.points).toEqual([])
    expect(hidden.task.stored).toBe("")
  })

  it("砺行修远：七个点按已打卡与今天标，未解锁只给一句", () => {
    const j = gs(GS_NOTE).journey
    expect(j).toMatchObject({ locked: false, week: "2/5", value: "2/8" })
    expect(j?.dots.map(d => (d.done ? "v" : d.today ? "*" : "."))).toEqual(["v", "v", "*", ".", ".", ".", "."])
    expect(gs({ week_active_progress: { unlock: false, is_active_period: true } }).journey).toMatchObject({ locked: true, desc: "暂未解锁" })
    expect(gs({ week_active_progress: { unlock: true, is_active_period: false } }).journey?.desc).toBe("不在活动期间")
    expect(gs({}).journey).toBeUndefined()
  })

  it("周本印剩余次数，参量质变仪按冷却说几天后可再用", () => {
    const b = gs(GS_NOTE)
    expect(b.boss).toMatchObject({ value: "3/3", desc: "本周剩余消耗减半次数" })
    expect(b.transformer).toMatchObject({ value: "冷却中", desc: "1天后可再次使用" })
    expect(gs({ transformer: { obtained: true, recovery_time: { reached: true } } }).transformer).toMatchObject({ value: "可使用", hot: true })
    expect(gs({}).transformer.value).toBe("尚未获得")
  })

  it("派遣：完成的说「探险完成」，没完成的给剩余时间", () => {
    const b = gs(GS_NOTE)
    expect(b.expeditionCount).toBe("5/5")
    expect(b.expeditions.map(it => it.text)).toEqual(["探险完成", "剩余探索时间 15小时59分钟"])
  })
})

describe("星铁便笺", () => {
  /**
   * 取星铁那几块
   * @param raw 原始数据
   * @returns 模板数据
   */
  const sr = (raw: object): SrNoteBlocks =>
    noteTemplateData(raw, { game: "sr", uid: "100000001", name: "开拓者", now: NOW }) as unknown as SrNoteBlocks

  it("开拓力给回满时刻；右列按官方判据决定在不在", () => {
    const b = sr(SR_NOTE)
    expect(b.stamina).toMatchObject({ value: "246/300", desc: "今天 20:32 回满" })
    expect(b.staminaWidth).toBe("82%")
    expect(b.daily.map(it => `${it.label} ${it.value}`)).toEqual(["每日实训 0/500", "历战余响剩余 3/3", "周期积分 0/18000"])
    // 历战余响两栏都空即尚未开启；周期积分上限为 0 整行不出
    expect(sr({}).daily.map(it => `${it.label} ${it.value}`)).toEqual(["每日实训 0/500", "历战余响剩余 尚未开启"])
  })

  it("委托：单人补占位头像，进度条按 20 小时折算", () => {
    const b = sr(SR_NOTE)
    expect(b.expeditionCount).toBe("2/4")
    expect(b.expeditions[0]).toMatchObject({ done: false, left: "1小时", width: "95%" })
    expect(b.expeditions[1]?.avatars).toEqual(["https://a.invalid/3.png", "派遣头像"])
    expect(b.expeditions[1]?.done).toBe(true)
  })
})

describe("绝区零便笺", () => {
  /**
   * 取绝区零那几块
   * @param raw 原始数据
   * @returns 模板数据
   */
  const zzz = (raw: object): ZzzNoteBlocks =>
    noteTemplateData(raw, { game: "zzz", uid: "1300000001", name: "绳匠", now: NOW }) as unknown as ZzzNoteBlocks

  it("三块：每日任务、周期任务、随便观经营；会员卡开着才出", () => {
    const b = zzz(ZZZ_NOTE)
    expect(b.energy).toMatchObject({ value: "240/240", desc: "已全部恢复", hot: true })
    expect(b.groups.map(g => g.title)).toEqual(["每日任务", "周期任务", "随便观经营"])
    expect(b.groups[0]?.rows.map(it => it.value)).toEqual(["0/400", "未完成", "待结算"])
    expect(b.groups[1]?.rows.map(it => `${it.label} ${it.value}`)).toEqual(["悬赏委托进度 1/4", "丽都周纪获取积分 -", "百通宝 300/1000"])
    expect(b.groups[1]?.rows[0]?.desc).toBe("01天01小时后刷新")
    expect(b.groups[1]?.rows[1]?.desc).toBeUndefined()
    expect(b.groups[2]?.rows.map(it => it.value)).toEqual(["可派遣", "可制造", "可上架"])
    expect(b.member).toMatchObject({ label: "绳网会员", value: "菲林未领取", desc: "剩余领取10天", hot: true })
  })

  it("自动托管时随便观只出一行；没给悬赏委托就不列", () => {
    const b = zzz({ temple_running: { auto_work: { is_auto_work_running: true, auto_work_ended: false, left_ts: 3720 } } })
    expect(b.groups[2]?.rows).toEqual([{ label: "自动托管", desc: "剩余时间：01时02分", value: "进行中", hot: false, text: true }])
    expect(b.groups[1]?.rows.map(it => it.label)).toEqual(["丽都周纪获取积分", "百通宝"])
    expect(b.member).toBeUndefined()
  })

  it("电量未满：接口给了回满那天与时分就照拼，没给才由剩余秒数推", () => {
    const given = { progress: { current: 100, max: 240 }, restore: 3600, day_type: 2, hour: 3, minute: 5 }
    expect(zzz({ energy: given }).energy.desc).toBe("明日03:05回满")
    expect(zzz({ energy: { progress: { current: 100, max: 240 }, restore: 3600 } }).energy.desc).toBe("今日14:20回满")
  })

  it("状态文案取官方的：录像店没营业是「等待营业」，游历结束是「小队返回」", () => {
    const b = zzz({ vhs_sale: { sale_state: "SaleStateNo" }, temple_running: { expedition_state: "ExpeditionStateEnd" } })
    expect(b.groups[0]?.rows[2]?.value).toBe("等待营业")
    expect(b.groups[2]?.rows[0]?.value).toBe("小队返回")
  })
})

describe("文字回退", () => {
  it("空 data 三个游戏都出得来 —— 米游社少给字段不该让一条命令失败", () => {
    for (const game of ["gs", "sr", "zzz"] as const) {
      const ctx = { game, uid: "100000001", name: "某人", now: NOW }
      expect(() => noteText(buildNote({}, ctx))).not.toThrow()
      const data = noteTemplateData({}, ctx)
      expect(data["uid"]).toBe("100000001")
      expect(data["saveId"]).toBe("100000001")
    }
  })

  it("先体力、再几时回满，杂项里带上出图那几块的说明", () => {
    const text = noteText(buildNote(GS_NOTE, { game: "gs", uid: "100000001", name: "旅行者", now: NOW }))
    expect(text.split("\n")[0]).toBe("原神 100000001（官服）")
    expect(text).toContain("原粹树脂 30/200")
    expect(text).toContain("22 小时 39 分后回满，约 明天 11:59")
    expect(text).toContain("每日委托奖励 奖励未领取")
    expect(text).toContain("砺行修远 2/8（本周进度）")
    expect(text).toContain("参量质变仪 冷却中（1天后可再次使用）")
    expect(text).toContain("派遣 5/5，最快 15 小时 59 分 后回来")
  })

  it("绝区零：随便观与周期任务进文字，活动度走量表不重复", () => {
    const text = noteText(buildNote(ZZZ_NOTE, { game: "zzz", uid: "1300000001", name: "绳匠", now: NOW }))
    expect(text).toContain("电量 240/240")
    expect(text).toContain("今日活跃度 0/400")
    expect(text.match(/今日活跃度/g)).toHaveLength(1)
    expect(text).toContain("悬赏委托进度 1/4（01天01小时后刷新）")
    expect(text).toContain("游历 可派遣")
    expect(text).toContain("绳网会员 菲林未领取（剩余领取10天）")
  })

  it("星铁：后备开拓力进事项，体力提醒那份量表仍是开拓力", () => {
    const view = buildNote(SR_NOTE, { game: "sr", uid: "100000001", name: "开拓者", now: NOW })
    expect(view.stamina).toMatchObject({ label: "开拓力", current: 246, max: 300, left: "7 小时 12 分" })
    expect(noteText(view)).toContain("后备开拓力 0")
    expect(noteText(view)).toContain("历战余响剩余 3/3")
  })
})
