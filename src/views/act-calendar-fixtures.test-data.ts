/**
 * 模块职责：活动日历三个游戏的接口返回夹具，供视图测试与真渲染测试共用
 * 依赖方向：只依赖 views/act-calendar 的类型
 * 生命周期：模块常量，测试只读不改
 * 注意事项：字段形态取自三个游戏战绩页自己读的那几个键，接口给的图片地址不进夹具 —— 视图本就不读它们。
 *          星铁的时间戳以 {@link ACT_NOW} 为准，绝区零给的是剩余秒数、与「现在」无关。
 */
import type { GsActCalendarRaw, SrActCalendarRaw, ZzzActCalendarRaw } from "./act-calendar.js"

/** 夹具里的「现在」：2026-08-22 13:20（本地时区） */
export const ACT_NOW = new Date(2026, 7, 22, 13, 20, 0).getTime()

/** 秒级时间戳 */
const sec = (ms: number): number => Math.floor(ms / 1000)
/** 一小时，毫秒 */
const H = 3600000

/** 原神：两个角色池、一个武器池；限时活动四种状态；深渊、剧诗、幽境危战 */
export const GS_ACT: GsActCalendarRaw = {
  avatar_card_pool_list: [
    {
      pool_id: 1,
      version_name: "7.1",
      pool_name: "角色活动祈愿",
      pool_type: 1,
      pool_status: 2,
      countdown_seconds: 16 * 86400 + 9 * 3600 + 30 * 60,
      start_timestamp: 1_000_000,
      end_timestamp: 1_000_000 + 21 * 86400,
      avatars: [
        { id: 10000046, name: "胡桃", element: "Pyro", rarity: 5 },
        { id: 10000025, name: "行秋", element: "Hydro", rarity: 4 }
      ],
      weapon: []
    },
    {
      pool_id: 2,
      version_name: "7.1",
      pool_name: "角色活动祈愿-2",
      pool_type: 1,
      pool_status: 1,
      countdown_seconds: 3 * 86400,
      avatars: [{ id: 10000052, name: "雷电将军", element: "Electro", rarity: 5 }],
      weapon: []
    }
  ],
  weapon_card_pool_list: [
    {
      pool_id: 3,
      version_name: "7.1",
      pool_name: "武器活动祈愿",
      pool_type: 2,
      pool_status: 2,
      countdown_seconds: 16 * 86400 + 9 * 3600 + 30 * 60,
      avatars: [],
      weapon: [{ id: 13501, name: "护摩之杖", rarity: 5 }]
    }
  ],
  mixed_card_pool_list: [],
  act_list: [
    {
      id: 11,
      name: "流光拾遗之月",
      type: "ActTypeOther",
      status: 2,
      is_finished: false,
      countdown_seconds: 2 * 86400 + 5 * 3600,
      reward_list: [{ item_id: 201, name: "原石", num: 420, homepage_show: true }]
    },
    {
      id: 12,
      name: "冒险家试炼",
      type: "ActTypeDouble",
      status: 2,
      is_finished: false,
      countdown_seconds: 10 * 86400,
      start_timestamp: 1_000_000,
      end_timestamp: 1_000_000 + 21 * 86400,
      reward_list: [{ item_id: 202, name: "摩拉", num: 8000, homepage_show: true }],
      double_detail: { left: 2, total: 3 }
    },
    {
      id: 13,
      name: "绘想签到",
      type: "ActTypeSignIn",
      status: 2,
      is_finished: true,
      countdown_seconds: 4 * 86400,
      reward_list: [],
      sign_in_detail: { progress: 7, total: 7, status: 2 }
    },
    {
      id: 14,
      name: "下期活动",
      type: "ActTypeOther",
      status: 1,
      countdown_seconds: 5 * 86400,
      reward_list: []
    },
    { id: 15, name: "不画", type: "ActTypeNone", status: 2 }
  ],
  fixed_act_list: [
    {
      id: 21,
      name: "深境螺旋",
      type: "ActTypeTower",
      status: 2,
      countdown_seconds: 28 * 86400 + 22 * 3600,
      reward_list: [
        { item_id: 201, name: "原石", num: 800, rarity: 5, homepage_show: true },
        { item_id: 202, name: "摩拉", num: 125000, rarity: 3, homepage_show: false },
        { item_id: 104003, name: "大英雄的经验", num: 12, rarity: 4, homepage_show: false },
        { item_id: 104319, name: "「自由」的指引", num: 0, rarity: 3, homepage_show: false },
        { item_id: 0, name: "", num: 3, homepage_show: false }
      ],
      tower_detail: { max_star: 36, total_star: 36 }
    },
    {
      id: 22,
      name: "幻想真境剧诗",
      type: "ActTypeRoleCombat",
      status: 2,
      countdown_seconds: 13 * 86400 + 22 * 3600,
      reward_list: [{ item_id: 201, name: "原石", num: 1000, homepage_show: true }],
      role_combat_detail: { has_data: true, max_round_id: 10, difficulty_id: 5, tarot_finished_cnt: 2 }
    },
    {
      id: 23,
      name: "幽境危战",
      type: "ActTypeHardChallenge",
      status: 2,
      countdown_seconds: 20 * 86400,
      reward_list: [],
      hard_challenge_detail: { difficulty: 6, second: 241, sub: { seconds: 2 * 86400 + 3600, x: 1, y: 3 } }
    }
  ]
}

/** 星铁：当期角色池、版本后开的光锥池；活动三种状态；逐光捡金四种玩法 */
export const SR_ACT: SrActCalendarRaw = {
  cur_game_version: "4.6",
  avatar_card_pool_list: [
    {
      id: 1,
      name: "韶艾栽英",
      version: "4.6",
      time_info: { now: sec(ACT_NOW), start_ts: sec(ACT_NOW - 10 * 24 * H), end_ts: sec(ACT_NOW + 79 * H) },
      is_after_version: false,
      avatar_list: [
        { item_id: 1306, item_name: "花火", rarity: 5, damage_type: "quantum" },
        { item_id: 1001, item_name: "三月七", rarity: 4, damage_type: "ice" },
        { item_id: 9999, item_name: "", rarity: 4 }
      ]
    }
  ],
  equip_card_pool_list: [
    {
      id: 2,
      name: "我身即刃",
      version: "4.7",
      time_info: { now: sec(ACT_NOW), start_ts: sec(ACT_NOW + 79 * H), end_ts: sec(ACT_NOW + 600 * H) },
      is_after_version: true,
      equip_list: [{ item_id: 23000, item_name: "银河铁道之夜", rarity: 5 }]
    }
  ],
  act_list: [
    {
      id: 11,
      name: "星芒战幕",
      act_type: "ActivityTypeOther",
      act_status: "OtherActStatusUnFinish",
      time_info: { now: sec(ACT_NOW), start_ts: sec(ACT_NOW - 24 * H), end_ts: sec(ACT_NOW + 200 * H) },
      special_reward: { item_id: 1, name: "星琼", num: 500 },
      reward_list: [
        { item_id: 1, name: "星琼", num: 500, rarity: 5 },
        { item_id: 2, name: "信用点", num: 8000, rarity: 3 }
      ]
    },
    {
      id: 12,
      name: "花藏繁生",
      act_type: "ActivityTypeDouble",
      act_status: "DoubleRewardActStatusProgress",
      time_info: { now: sec(ACT_NOW), start_ts: sec(ACT_NOW - 24 * H), end_ts: sec(ACT_NOW + 50 * H) },
      current_progress: 2,
      total_progress: 3,
      count_refresh_type: 1
    },
    {
      id: 13,
      name: "巡星之礼",
      act_type: "ActivityTypeSign",
      act_status: "SignStatusFinish",
      time_info: { now: sec(ACT_NOW), start_ts: sec(ACT_NOW - 24 * H), end_ts: sec(ACT_NOW + 200 * H) },
      special_reward: { item_id: 102, name: "星轨专票", num: 10 }
    },
    {
      id: 14,
      name: "下期活动",
      act_type: "ActivityTypeOther",
      act_status: "OtherActStatusUnopened",
      time_info: { now: sec(ACT_NOW), start_ts: sec(ACT_NOW + 79 * H), end_ts: sec(ACT_NOW + 400 * H) }
    }
  ],
  challenge_list: [
    {
      group_id: 1,
      challenge_type: "ChallengeTypeStory",
      name_mi18n: "天外乐章",
      status: "challengeStatusInProgress",
      time_info: { now: sec(ACT_NOW), start_ts: sec(ACT_NOW - 24 * H), end_ts: sec(ACT_NOW + 23 * H) },
      current_progress: 10,
      total_progress: 12,
      special_reward: { item_id: 1, name: "星琼", num: 900 }
    },
    {
      group_id: 2,
      challenge_type: "ChallengeTypeBoss",
      name_mi18n: "混沌之海",
      status: "challengeStatusFinish",
      time_info: { now: sec(ACT_NOW), start_ts: sec(ACT_NOW - 24 * H), end_ts: sec(ACT_NOW + 300 * H) },
      current_progress: 12,
      total_progress: 12,
      extra_progress: 1
    },
    {
      group_id: 3,
      challenge_type: "ChallengeTypePeak",
      name_mi18n: "王座之上",
      status: "challengeStatusUnopened",
      time_info: { now: sec(ACT_NOW), start_ts: sec(ACT_NOW + 79 * H), end_ts: sec(ACT_NOW + 600 * H) }
    },
    {
      group_id: 4,
      challenge_type: "ChallengeTypeChasm",
      name_mi18n: "永劫之巅",
      status: "challengeStatusInProgress",
      time_info: { now: sec(ACT_NOW), start_ts: sec(ACT_NOW - 24 * H), end_ts: sec(ACT_NOW + 400 * H) },
      current_progress: 33,
      total_progress: 36
    }
  ]
}

/** 绝区零：进行中与未开启的代理人调频、一个音擎重映；活动三种状态 */
export const ZZZ_ACT: ZzzActCalendarRaw = {
  gacha: {
    avatar_gacha_schedule_list: [
      {
        version: "3.2",
        gacha_state: "GACHA_STATE_IN_PROGRESS",
        gacha_type: "GACHA_TYPE_CHARACTER_UP",
        left_end_ts: 2 * 86400 + 9 * 3600 + 120,
        avatar_list: [
          { avatar_id: 1091, avatar_name: "雅", rarity: "S", avatar_element_type: 202, avatar_profession: 3 },
          { avatar_id: 1011, avatar_name: "安比", rarity: "A", avatar_element_type: 203, avatar_profession: 2 }
        ]
      },
      {
        version: "3.2",
        gacha_state: "GACHA_STATE_NOT_START",
        gacha_type: "GACHA_TYPE_CHARACTER_UP",
        left_start_ts: 3 * 86400 + 3 * 3600 + 60,
        avatar_list: [{ avatar_id: 1041, avatar_name: "「11号」", rarity: "S", avatar_element_type: 201, avatar_profession: 1 }]
      }
    ],
    weapon_gacha_schedule_list: [
      {
        version: "3.2",
        gacha_state: "GACHA_STATE_IN_PROGRESS",
        gacha_type: "GACHA_TYPE_WEAPON_RETURN",
        left_end_ts: 22 * 3600 + 60,
        sup_lock_show: true,
        weapon_list: [{ weapon_id: 14109, rarity: "S", profession: 3 }]
      }
    ]
  },
  activity: {
    activity_list: [
      { activity_id: 1, name: "惊喜放映企划", state: "STATE_COMPLETED", left_end_ts: 86400 + 22 * 3600 + 60, monochrome_cnt: 300, monochrome_got_cnt: 300 },
      { activity_id: 2, name: "限时挑战", state: "STATE_IN_PROGRESS", left_end_ts: 22 * 3600 + 60, monochrome_cnt: 800, monochrome_got_cnt: 150 },
      { activity_id: 3, name: "下期活动", state: "STATE_NOT_START", left_start_ts: 3 * 86400 + 3 * 3600 + 60, monochrome_cnt: 600, monochrome_got_cnt: 0 }
    ]
  }
}
