/**
 * 模块职责：三个游戏便笺的整份夹具 —— 字段名与取值形态照官方便笺页读的那份
 * 依赖方向：被 views/note.test.ts 与 render.test.ts 引用；纯数据
 * 生命周期：无状态
 * 注意事项：每份都把**全部**分支要的字段带齐（魔神任务主线加间章、历练点各状态、砺行修远、随便观三态与会员卡），
 *          出图测试靠它把每一块都真渲一遍；缺一块则那块的模板错误测不到。
 */
import type { GsNoteRaw } from "./gs/note.js"
import type { SrNoteRaw } from "./sr/note.js"
import type { ZzzNoteRaw } from "./zzz/note.js"

/** 原神：树脂未满、宝钱已满、委托做完未领、砺行修远进行中、质变仪冷却 */
export const GS_NOTE: GsNoteRaw = {
  current_resin: 30,
  max_resin: 200,
  resin_recovery_time: "81540",
  finished_task_num: 4,
  total_task_num: 4,
  is_extra_task_reward_received: false,
  remain_resin_discount_num: 3,
  resin_discount_num_limit: 3,
  current_home_coin: 2400,
  max_home_coin: 2400,
  home_coin_recovery_time: "0",
  current_expedition_num: 5,
  max_expedition_num: 5,
  transformer: { obtained: true, recovery_time: { Day: 1, Hour: 0, Minute: 0, Second: 0, reached: false } },
  expeditions: [
    { avatar_side_icon: "https://a.invalid/side1.png", status: "Finished", remained_time: "0" },
    { avatar_side_icon: "https://a.invalid/side2.png", status: "Ongoing", remained_time: "57540" }
  ],
  daily_task: {
    total_num: 4,
    finished_num: 4,
    is_extra_task_reward_received: false,
    task_rewards: [
      { status: "TaskRewardStatusTakenAward" },
      { status: "TaskRewardStatusFinished" },
      { status: "TaskRewardStatusFinished" },
      { status: "TaskRewardStatusUnfinished" }
    ],
    attendance_rewards: [
      { status: "AttendanceRewardStatusTakenAward", progress: 2000 },
      { status: "AttendanceRewardStatusWaitTaken", progress: 2000 },
      { status: "AttendanceRewardStatusUnfinished", progress: 500 },
      { status: "AttendanceRewardStatusForbid", progress: 0 }
    ],
    attendance_visible: true,
    stored_attendance: "0.6",
    stored_attendance_refresh_countdown: 864_000
  },
  archon_quest_progress: {
    list: [
      { status: "StatusNotOpen", chapter_num: "第五章第六幕", chapter_title: "你存在的时空", chapter_type: 1 },
      { status: "StatusOngoing", chapter_num: "空月之歌 第一幕", chapter_title: "雪浪与苍林之舞", chapter_type: 2 }
    ],
    is_open_archon_quest: true,
    is_finish_all_mainline: false,
    is_finish_all_interchapter: false
  },
  week_active_progress: {
    unlock: true,
    is_active_period: true,
    progress_current: 2,
    progress_total: 5,
    progress_current_arr: [1, 2],
    current_weekday: 3,
    period_progress_current: 2,
    period_progress_total: 8
  }
}

/** 星铁：开拓力未满、历战余响开着、周期积分开放 */
export const SR_NOTE: SrNoteRaw = {
  current_stamina: 246,
  max_stamina: 300,
  stamina_recover_time: 25_920,
  current_reserve_stamina: 0,
  is_reserve_stamina_full: false,
  current_train_score: 0,
  max_train_score: 500,
  weekly_cocoon_cnt: 3,
  weekly_cocoon_limit: 3,
  period_score: 0,
  period_max_score: 18_000,
  accepted_epedition_num: 2,
  total_expedition_num: 4,
  expeditions: [
    { name: "巡海游侠", remaining_time: 3600, avatars: ["https://a.invalid/1.png", "https://a.invalid/2.png"] },
    { name: "天外来客", remaining_time: 0, avatars: ["https://a.invalid/3.png"] }
  ]
}

/** 绝区零：电量满、活跃度未满、悬赏委托在、随便观三态、会员卡未领 */
export const ZZZ_NOTE: ZzzNoteRaw = {
  energy: { progress: { current: 240, max: 240 }, restore: 0 },
  vitality: { current: 0, max: 400 },
  vhs_sale: { sale_state: "SaleStateDone" },
  card_sign: "CardSignNo",
  bounty_commission: { num: 1, total: 4, refresh_time: 90_000 },
  weekly_task: { cur_point: 0, max_point: 0, refresh_time: 0 },
  temple_running: {
    expedition_state: "ExpeditionStateInCanSend",
    bench_state: "BenchStateCanProduce",
    shelve_state: "ShelveStateCanSell",
    current_currency: 300,
    weekly_currency_max: 1000,
    currency_next_refresh_ts: 3600
  },
  member_card: { is_open: true, member_card_state: "MemberCardStateNo", exp_time: 864_000 }
}
