/**
 * 模块职责：把模板真编译一遍 —— 拦住"视图给的键与模板要的键对不上"这一类错误
 * 依赖方向：测试文件，依赖 art-template（devDependency）与各 views 模块；不读元数据、不发请求
 * 生命周期：无状态
 * 注意事项：**这一类错误静态扫不出来**，表现都是"整张图出不来、命令永远只回文字"，日志里只有
 *          一行渲染失败。除"渲染不抛错"外，另三条断言对应**图出来了但内容是错的**：输出里不许
 *          有 `undefined`、`[object Object]` 与裸 JSON。数据是合成的，故不需要装元数据；图片
 *          路径指向不存在的文件也无妨，art-template 不读它们。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { join } from "node:path"
import template from "art-template"
import { describe, expect, it } from "vitest"
import type { BuiltArti, BuiltPanel } from "./panel/build.js"
import { RenderBridge } from "./core/render.js"
import { buildCharCard } from "./views/char-card.js"
import { combatTemplateData } from "./views/gs/index.js"
import { hardChallengeTemplateData } from "./views/gs/index.js"
import { peakChallengeStatData, srChallengeStatData } from "./views/sr/index.js"
import { srAchieveData, srChestData } from "./views/sr/index.js"
import { gridFightData, rogueMagicData, srRogueData } from "./views/sr/index.js"
import { zzzDeadlyData, zzzDefenseData, zzzHoloData } from "./views/zzz/index.js"
import { zzzTowerData, zzzVoidData } from "./views/zzz/index.js"
import { zzzZenkovData, zzzZenkovDetailData } from "./views/zzz/index.js"
import { zzzExploreData, zzzGardenData, zzzLedgerData, zzzLostData } from "./views/zzz/index.js"
import { buildCalculator } from "./views/calculator.js"
import type { CalculatorInput } from "./views/calculator.js"
import type { MetaLoader } from "./meta/loader.js"
import { scoreDiscs, zzzScoreInput } from "./panel/score/index.js"
import type { ZzzAvatarDetail } from "./panel/profile/index.js"
import type { StoredAvatar } from "./store/panel.js"
import { avatarListData } from "./views/avatar-list.js"
import { buildProfile } from "./views/profile.js"
import { buildZzzCard, zzzPlaceholderCard, type ZzzAvatarCardView } from "./views/zzz/card.js"
import { buildUidList } from "./views/uid.js"
import { charMasterTemplateData } from "./views/gs/index.js"
import { tarotTemplateData } from "./views/gs/index.js"
import {
  artisListData,
  charImgs,
  panelStatData,
  profileDetailData,
  profileListData,
  rankListData,
  zzzPanelData,
  zzzRankListData,
  zzzPanelListData
} from "./views/panel.js"
import type { StatCharacterRaw } from "./views/panel.js"
import { buildCharTalent } from "./views/char-talent.js"
import type { WikiCharInput } from "./views/char-wiki.js"
import { buildCharWiki } from "./views/char-wiki.js"
import { buildWeaponWiki } from "./views/weapon-wiki.js"
import { buildBangbooWiki, buildSetWiki } from "./views/set-wiki.js"
import { dmgCalcView } from "./views/dmg.js"
import type { DmgCalcResult } from "./panel/dmg/index.js"
import { buildHelp } from "./views/help.js"
import { buildGachaGuide, buildPanelGuide } from "./views/guide.js"
import { buildBindGuide, buildRankGuide } from "./views/guide-extra.js"
import { noteTemplateData } from "./views/note.js"
import { GS_NOTE, SR_NOTE, ZZZ_NOTE } from "./views/note-fixtures.test-data.js"
import type { ActContext, ActItemMeta } from "./views/act-calendar.js"
import { buildActCalendar } from "./views/act-calendar.js"
import { REWARD_ICONS } from "./commands/act-calendar.js"
import { ACT_NOW, GS_ACT, SR_ACT, ZZZ_ACT } from "./views/act-calendar-fixtures.test-data.js"
import { buildQrCard } from "./views/qr.js"
import { abyssPctData } from "./views/abyss-pct.js"
import { abyssTemplateData } from "./views/abyss.js"
import { gachaDetailData } from "./views/gacha-stat.js"
import { bannerSingleData } from "./views/banner.js"
import { PoolTable } from "./meta/pool.js"
import type { GachaRecord } from "./store/gacha.js"

/** 主人看的那一张：群管理与主人两块都在，且有一条被关掉 —— 页脚那句「另有 N 项」也要画得出 */
const MASTER = { isMaster: true, isAdmin: true, visible: (one: { needs?: string }): boolean => one.needs !== "enableDmgCalc" }

/** 仓库根 */
const ROOT = join(import.meta.dirname, "..")

/** 模板根 */
const TEMPLATES = join(ROOT, "templates")

/**
 * 造一件圣遗物
 * @param idx 部位
 * @returns 圣遗物
 */
function arti(idx: number): BuiltArti {
  return {
    idx,
    name: "追忆的形骸",
    set: "追忆之注连",
    level: 20,
    star: 5,
    main: { id: "10001", key: idx === 1 ? "hpPlus" : "cpct", value: idx === 1 ? 4780 : 33.1 },
    attrs: [
      { key: "cpct", upNum: 3, eff: 2.4, value: 10.5 },
      { key: "cdmg", upNum: 4, eff: 3.3, value: 25.6 },
      { key: "atk", upNum: 2, eff: 1.7, value: 9.9 },
      { key: "atkPlus", upNum: 2, eff: 1.7, value: 33 }
    ]
  }
}

/**
 * 造一份装好的面板
 * @param over 要覆盖的字段
 * @returns 面板
 */
function panel(over: Partial<BuiltPanel> = {}): BuiltPanel {
  return {
    game: "gs",
    uid: "100000001",
    id: "10000046",
    name: "胡桃",
    abbr: "胡桃",
    star: 5,
    elem: "pyro",
    level: 90,
    promote: 6,
    cons: 2,
    fetter: 10,
    costume: 0,
    talent: { a: 9, e: 9, q: 9 },
    talentLevel: over.talent ?? { a: 9, e: 9, q: 9 },
    trees: [],
    source: "Enka.Network",
    at: 1_756_000_000_000,
    artis: [1, 2, 3, 4, 5].map(arti),
    sets: { 追忆之注连: 4, 逐影猎人: 1 },
    weapon: {
      name: "护摩之杖",
      abbr: "护摩之杖",
      level: 90,
      promote: 6,
      affix: 1,
      star: 5,
      type: "polearm",
      img: "meta-gs/weapon/polearm/护摩之杖/icon.webp",
      splash: "meta-gs/weapon/polearm/护摩之杖/gacha.webp",
      attrs: { atkBase: 608.4, cdmg: 66.2 },
      desc: { name: "无羁的朱赤之蝶", desc: "生命值提升 <nobr>20%</nobr>" }
    },
    mark: {
      mark: "230.5",
      markClass: "SSS",
      classTitle: "胡桃-通用",
      charWeight: { cpct: 100, cdmg: 100, atk: 75 },
      artis: Object.fromEntries(
        [1, 2, 3, 4, 5].map(idx => [String(idx), { mark: "46.6", markClass: "SSS", _mark: 46.6 }])
      )
    } as unknown as BuiltPanel["mark"],
    attr: {
      hp: 15552,
      atk: 1200,
      def: 876,
      mastery: 108,
      cpct: 68.5,
      cdmg: 120.4,
      recharge: 132,
      dmg: 46.6,
      phy: 0
    } as unknown as BuiltPanel["attr"],
    base: { hp: 15552, atk: 800, def: 876, mastery: 0, cpct: 5, cdmg: 50, recharge: 100, dmg: 0, phy: 0 },
    imgs: {},
    ...over
  }
}

/**
 * 造一份练度统计用的原始角色列表；那一张图读的是角色列表接口而非面板数据
 * @returns 原始返回
 */
function statRaw(): StatCharacterRaw {
  return {
    avatars: [
      {
        id: 10000046,
        name: "胡桃",
        level: 90,
        rarity: 5,
        actived_constellation_num: 2,
        fetter: 10,
        element: "Pyro",
        weapon: { name: "护摩之杖", level: 90, rarity: 5, affix_level: 1, promote_level: 6 },
        reliquaries: [1, 2, 3, 4, 5].map(pos => ({ pos, set: { name: "追忆之注连" } }))
      },
      { id: 10000030, name: "钟离", level: 80, rarity: 5, element: "Geo" }
    ]
  }
}

const bridge = new RenderBridge(
  ROOT,
  () => "1.0.0",
  process.env["MHY_DUMP_META"] ?? join(ROOT, "meta"),
  join(ROOT, "panel-img"),
  () => 100,
  undefined,
  () => "0.7.1"
)
const one = panel()
const many = [one, panel({ id: "10000030", name: "钟离", abbr: "钟离", elem: "geo" })]

/**
 * 造一份伤害计算结果；第二条刻意不给暴击伤害（剧变反应一类如此，模板对那一格有字面的 `"NaN"` 约定）
 * @param withCompare 为真时带上词条收益对比
 * @returns 伤害计算结果
 */
function dmgResult(withCompare: boolean): DmgCalcResult {
  const basic = { title: "重击蒸发", dmg: 98765.4, avg: 76543.2 }
  const out: DmgCalcResult = {
    ret: [basic, { title: "超载伤害", avg: 4321 }],
    msg: ["护摩之杖：生命值提升 20%", "追忆之注连4：伤害加成 15%"],
    msgList: [["护摩之杖：生命值提升 20%"], ["追忆之注连4：伤害加成 15%"]],
    enemyName: "小宝",
    enemyLv: 103,
    createdBy: "甲"
  }
  if (withCompare) {
    out.compare = {
      title: basic.title,
      userIdx: 0,
      basic,
      attrs: [
        { title: "攻击力", text: "5.8%" },
        { title: "暴击率", text: "3.9%" },
        { title: "暴击伤害", text: "7.8%" }
      ],
      rows: [
        [{ type: "na" }, { type: "gt", dmg: 99999, avg: 78000 }, { type: "lt", dmg: 97000, avg: 75000 }],
        [{ type: "lt", dmg: 96000, avg: 74000 }, { type: "na" }, { type: "gt", dmg: 101000, avg: 79000 }],
        [{ type: "gt", dmg: 100500, avg: 77500 }, { type: "lt", avg: 75500 }, { type: "na" }]
      ]
    }
  }
  return out
}

/** 一位存下来的绝区零代理人，取自真机 `avatar/info` 的形态：属性值是格式化字符串，副词条次数已折算 */
const ZZZ_STORED: StoredAvatar = {
  id: "1431",
  level: 60,
  cons: 2,
  elem: "凄刃",
  talent: { normal: 12, special: 12, dodge: 7, chain: 12, core: 7, assist: 5 },
  from: "mysPanelZZZ",
  at: 1_767_225_600_000,
  weapon: { id: 14_143, name: "云霓孤光", level: 60, affix: 1 },
  zzz: {
    name: "叶瞬光",
    fullName: "叶瞬光",
    rank: "S",
    prof: "强攻",
    camp: "云岿山",
    elemId: 200,
    attrs: [
      { key: "hp", name: "生命值", base: "7673", add: "3345", final: "11018" },
      { key: "atk", name: "攻击力", base: "1681", add: "1079", final: "2760" },
      { key: "def", name: "防御力", base: "606", add: "389", final: "995" },
      { key: "impact", name: "冲击力", final: "83" },
      { key: "cpct", name: "暴击率", final: "43.4%" },
      { key: "cdmg", name: "暴击伤害", final: "224.4%" },
      { key: "am", name: "异常掌控", final: "94" },
      { key: "ap", name: "异常精通", final: "102" },
      { key: "pen", name: "穿透率", final: "0.0%" },
      { key: "er", name: "能量自动回复", final: "1.20" },
      { key: "penVal", name: "穿透值", final: "27" },
      { key: "dmgPhy", name: "物理伤害加成", final: "40.0%" }
    ],
    weapon: {
      id: 14_143,
      name: "云霓孤光",
      level: 60,
      star: 1,
      rank: "S",
      prof: 1,
      main: { id: 12_101, name: "基础攻击力", value: "743", rolls: 1 },
      sub: { id: 21_103, key: "cdmg", name: "暴击伤害", value: "48%", rolls: 1 }
    },
    discs: [1, 2, 3, 4, 5, 6].map(pos => ({
      id: 33_540 + pos,
      name: `沧浪行歌[${pos}]`,
      pos,
      level: 15,
      rank: "S",
      main: { id: pos <= 3 ? [11_103, 12_103, 13_103][pos - 1] ?? 11_103 : 21_103, name: "主词条", value: "2200", rolls: 1 },
      subs: [
        { id: 21_103, key: "cdmg" as const, name: "暴击伤害", value: "9.6%", rolls: 2, valid: true },
        { id: 20_103, key: "cpct" as const, name: "暴击率", value: "4.8%", rolls: 2, valid: true },
        { id: 13_102, key: "def" as const, name: "防御力", value: "14.4%", rolls: 3 },
        { id: 23_203, key: "penVal" as const, name: "穿透值", value: "9", rolls: 1 }
      ],
      set: "沧浪行歌",
      setId: 33_500,
      own: 4
    })),
    mysRating: "S",
    mysScore: 79.35
  }
}

/** 只装了音擎、驱动盘为空的一位：列表里应当被滤掉 */
const ZZZ_BARE_WEAPON: StoredAvatar = {
  id: "1011",
  level: 50,
  cons: 4,
  from: "mysPanelZZZ",
  zzz: {
    name: "安比",
    rank: "A",
    prof: "击破",
    elemId: 203,
    attrs: [{ key: "hp", name: "生命值", final: "7500" }],
    discs: []
  }
}

/** 上面那一位的评分 */
const ZZZ_MARK = scoreDiscs(ZZZ_STORED.zzz?.discs ?? [], zzzScoreInput(ZZZ_STORED.zzz as ZzzAvatarDetail))

/** 一份只认那把音擎的假元数据装载器；效果说明来自包里的 `talents`（新包形态），不给装载器就走不到那条路 */
const ZZZ_META = {
  /**
   * 按名字查条目
   * @param _game 游戏
   * @param name 名称
   * @returns 条目；不是那把音擎时 undefined
   */
  byName(_game: string, name: string) {
    if (name !== "云霓孤光") return undefined
    return { id: "14143", name, abbr: name, star: 5, icon: "meta-zzz/weapon/强攻/云霓孤光/icon.webp" }
  },
  /**
   * 读整份 data.json
   * @param _game 游戏
   * @param id 物品 id
   * @returns 整份数据；不是那把音擎时 undefined
   */
  detail(_game: string, id: string | number) {
    if (String(id) !== "14143") return undefined
    return {
      talents: {
        name: "孤光",
        desc: "装备者的暴击伤害提升<nobr>$1[i]%</nobr>，持续40秒。",
        tables: { "1": [25, 28.7, 32.5, 36.2, 50] }
      }
    }
  }
} as unknown as MetaLoader

/** 绝区零角色列表那张图：一位有整卡、一位是占位卡 —— 两条路都要真渲一遍 */
const ZZZ_LIST_DATA = {
  ...buildProfile(
    {
      avatar_list: [
        { id: 1431, name_mi18n: "叶瞬光", level: 60, rarity: "S", rank: 2 },
        { id: 1011, name_mi18n: "安比", level: 50, rarity: "A", rank: 6 }
      ]
    },
    {
      game: "zzz",
      uid: "10000001",
      name: "绳匠",
      faceOf: (id: string): string => (id === "1011" ? "meta-zzz/character/安比/imgs/face.webp" : "")
    }
  ),
  cards: [
    ...[buildZzzCard(ZZZ_STORED)].filter((it): it is ZzzAvatarCardView => !!it),
    zzzPlaceholderCard({ id: "1011", name: "安比", star: 4, level: 50, cons: 6, face: "meta-zzz/character/安比/imgs/face.webp" })
  ],
  noPanel: true
}

/** 胡桃那张战绩卡的天赋行：普攻 8、战技 9、爆发 10（满级） */
const HUTAO_CARD_TALS = {
  tals: [
    { key: "a", name: "", level: 8, crown: false },
    { key: "e", name: "", level: 9, crown: false },
    { key: "q", name: "", level: 10, crown: true }
  ],
  xtals: []
}

/** 绝区零排行图用的假装载器：只给简称与音擎图标，那两处是模板真会去取的 */
const ZZZ_RANK_META = {
  /**
   * 按名字查条目
   * @param _game 游戏
   * @param name 名称
   * @returns 条目
   */
  byName(_game: string, name: string) {
    if (name === "云霓孤光") return { id: "14143", name, abbr: name, star: 5, icon: "meta-zzz/weapon/云霓孤光/imgs/icon.webp" }
    return { id: "1431", name, abbr: name, star: 5 }
  }
} as unknown as MetaLoader

/** 抽卡记录用的假装载器：只认胡桃，「琴」查不到 —— 后者与「已抽」那条都走 no-avatar 占位 */
const GACHA_META = {
  /**
   * 按名字查条目
   * @param _game 游戏
   * @param name 名称
   * @returns 条目；不是胡桃时 undefined
   */
  byName(_game: string, name: string) {
    if (name !== "胡桃") return undefined
    return { id: "10000046", name, abbr: name, star: 5, face: "meta-gs/character/胡桃/imgs/face.webp" }
  }
} as unknown as MetaLoader

/**
 * 抽卡记录夹具：一发胡桃、一发查不到元数据的五星，其后垫了 3 抽未出金
 * @returns 模板数据
 */
function gachaDetailCase(): Record<string, unknown> {
  const rec = (n: number, name: string, rank: number): GachaRecord => ({
    id: `170000000000000${String(1000 + n)}`,
    pool: "301",
    name,
    itemType: "角色",
    rank,
    time: "2026-08-05 12:00:00"
  })
  const records = [rec(6, "安柏", 3), rec(5, "安柏", 3), rec(4, "安柏", 3), rec(3, "琴", 5), rec(2, "安柏", 3), rec(1, "胡桃", 5)]
  const ctx = { game: "gs" as const, uid: "100000001", pool: new PoolTable({ metaDir: join(ROOT, "meta") }), meta: GACHA_META, now: 1_786_000_000_000 }
  return gachaDetailData(records, ctx) ?? {}
}

/**
 * 一份养成计算的入参；两张图只差消耗分组的标题，故共用一份
 * @param game 游戏
 * @returns 入参
 */
function CALC_INPUT(game: "gs" | "sr"): CalculatorInput {
  const consume = [
    { name: "「诡计」的哲学", icon: "https://a.invalid/m1.png", num: "18", lack: "6", isTalent: true },
    { name: "摩拉", icon: "https://a.invalid/m2.png", num: "12.4 w", lack: "0" }
  ]
  return {
    game,
    uid: game === "gs" ? "100000001" : "101234567",
    char: {
      name: game === "gs" ? "胡桃" : "符玄",
      face: `meta-${game}/character/${game === "gs" ? "胡桃" : "符玄"}/imgs/face.webp`,
      level: 80,
      target: 90,
      star: 5,
      cons: 2
    },
    equip: { name: "护摩之杖", icon: "https://a.invalid/w.png", star: 5, level: 80, target: 90 },
    skills: [1, 2, 3].map(idx => ({
      name: `技能${idx}`,
      icon: "https://a.invalid/s.png",
      current: 6,
      target: 10,
      max: 10
    })),
    consume:
      game === "gs"
        ? { avatar_consume: consume, avatar_skill_consume: consume, weapon_consume: consume }
        : { avatar_consume: consume, skill_consume: consume, equipment_consume: consume }
  }
}

/**
 * 造一份天赋页的角色输入；三个游戏共用一张模板而三份数据形态互不相同，故三条都要真渲染一次
 * @param game 游戏
 * @returns 角色输入
 */
function talentInput(game: "gs" | "sr" | "zzz"): WikiCharInput {
  if (game === "sr") {
    return {
      game,
      name: "花火",
      abbr: "花火",
      star: 5,
      elem: "量子",
      weapon: "同谐",
      isMain: false,
      detail: {
        desc: "假面愚者的成员。",
        sp: 130,
        baseAttr: { hp: 1047.8, atk: 756.7, def: 436.5, speed: 100 },
        tree: { a: { key: "cpct", value: 5.3 } },
        talent: {
          a: { name: "打号砸货", type: "普攻", desc: "造成等同于$1[i]%攻击力的量子伤害。", tables: { "1": { name: "伤害", values: [0.5, 0.6, 0.7, 0.8, 0.9, 1] } } },
          e: { name: "梦境迷马", type: "战技", desc: "使目标进入梦境状态。", tables: {} }
        },
        cons: { "1": { name: "满堂哗然", desc: "暴击伤害提高 20%。<br>持续 2 回合。" } },
        treeData: { "1310101": { type: "skill", idx: 1, desc: "施放战技后回复能量。" } }
      },
      imgs: charImgs({ game, name: "花火" })
    }
  }
  if (game === "zzz") {
    return {
      game,
      name: "安比",
      abbr: "安比",
      star: 3,
      elem: "电",
      weapon: "",
      isMain: false,
      detail: {
        prof: "击破",
        camp: "狡兔屋",
        hit: "斩击",
        fullName: "安比·德玛拉",
        baseAttr: { hp: 7500, atk: 583, def: 612, impact: 118, cpct: "5%", cdmg: "50%", am: 94, ap: 93, er: "1.2/秒" },
        talent: {
          basic: {
            name: "普通攻击",
            desc: ["<h3>普通攻击：伏特速攻</h3>", '<p>点按 <span class="key">普攻</span> 发动。</p>'],
            tables: [
              { name: "一段伤害倍率", values: ["31.2%", "34.1%", "37%"] },
              { name: "能量消耗", isSame: true, values: ["20"] }
            ]
          },
          chain: { name: "连携技", desc: ["<h3>连携技：电磁引擎</h3>"], tables: [] }
        },
        cons: {
          "1": { name: "快充模式", desc: ["<p>能量获得效率提升 12%。</p>", '<p class="story">少女并非探索空洞的生手。</p>'] },
          "3": { name: "训练有素", desc: ["<p>技能等级 +2</p>"] }
        },
        passive: [
          { name: "核心技加成（满档）", desc: ["<p>基础攻击力 +75　冲击力 +18</p>"] },
          { name: "核心被动：波动电压", desc: ["<p>招式造成的失衡值提升 64%。</p>"] }
        ]
      },
      imgs: charImgs({ game, name: "安比" })
    }
  }
  return {
    game,
    name: "胡桃",
    abbr: "胡桃",
    star: 5,
    elem: "pyro",
    weapon: "polearm",
    isMain: false,
    detail: {
      title: "雪霁梅香",
      desc: "「往生堂」七十七代堂主。",
      baseAttr: { hp: 15552, atk: 106.4, def: 876 },
      growAttr: { key: "cdmg", value: 38.4 },
      talentCons: { a: 0, e: 3, q: 5 },
      talent: {
        a: { name: "灭却之戒法", desc: ["进行至多五段的连续枪击。"], tables: [{ name: "一段伤害", values: ["78.6%", "80%"] }] },
        e: { name: "蝶引来生", desc: ["只有永不间断的烈焰。"], tables: [] }
      },
      cons: { "1": { name: "赤团开时斜飞去", desc: ["重击不消耗体力。"] } },
      passive: [{ name: "多多益善", desc: ["有 18% 概率额外获得料理。"] }]
    },
    imgs: charImgs({ game, name: "胡桃", weaponType: "polearm", talentCons: { a: 0, e: 3, q: 5 } })
  }
}

/** 便笺夹具的上下文：钉住现在，时刻串不随真实日期变 */
const NOTE_CTX = { uid: "100000001", name: "某人", now: new Date(2026, 7, 22, 13, 20, 0).getTime() }

/** 活动日历夹具里那几个角色与武器在元数据里的图（`MHY_DUMP_META` 指向真实元数据时截图有图） */
const ACT_META: Readonly<Record<string, ActItemMeta>> = {
  胡桃: { face: "meta-gs/character/胡桃/imgs/face.webp", star: 5, elem: "pyro" },
  行秋: { face: "meta-gs/character/行秋/imgs/face.webp", star: 4, elem: "hydro" },
  雷电将军: { face: "meta-gs/character/雷电将军/imgs/face.webp", star: 5, elem: "electro" },
  护摩之杖: { face: "meta-gs/weapon/polearm/护摩之杖/icon.webp", star: 5 },
  花火: { face: "meta-sr/character/花火/imgs/face.webp", star: 5, elem: "quantum" },
  三月七: { face: "meta-sr/character/三月七/imgs/face.webp", star: 4, elem: "ice" },
  银河铁道之夜: { face: "meta-sr/weapon/智识/银河铁道之夜/icon.webp", star: 5 },
  雅: { face: "meta-zzz/character/雅/imgs/face.webp", star: 5 },
  安比: { face: "meta-zzz/character/安比/imgs/face.webp", star: 4 },
  "「11号」": { face: "meta-zzz/character/「11号」/imgs/face.webp", star: 5 },
  霰落星殿: { face: "meta-zzz/weapon/异常/霰落星殿/icon.webp", star: 5 }
}

/**
 * 活动日历出图的上下文
 * @param game 游戏
 * @returns 上下文
 */
function actCtx(game: ActContext["game"]): ActContext {
  return {
    game,
    uid: "100000001",
    name: "某人",
    now: ACT_NOW,
    // 绝区零音擎接口不给名字，按 id 查
    item: (_kind, id, name) => ACT_META[name] ?? (id === "14109" ? ACT_META["霰落星殿"] : undefined),
    reward: name => REWARD_ICONS[game][name] ?? (["原石", "摩拉", "星琼"].includes(name) ? `meta-${game}/material/item/${name}.webp` : ""),
    has: rel => bridge.hasRes(rel)
  }
}

const CASES: readonly { name: string; label?: string; data: Record<string, unknown> }[] = [
  // 便笺：每块都带齐的一份与空 data 各一张 —— 后者是接口少给字段时那张图
  { name: "gs/note", data: noteTemplateData(GS_NOTE, { game: "gs", ...NOTE_CTX }) },
  { name: "gs/note", label: "空", data: noteTemplateData({}, { game: "gs", ...NOTE_CTX }) },
  { name: "sr/note", data: noteTemplateData(SR_NOTE, { game: "sr", ...NOTE_CTX }, { nickname: "开拓者", level: 70 }) },
  { name: "sr/note", label: "空", data: noteTemplateData({}, { game: "sr", ...NOTE_CTX }) },
  { name: "zzz/note", data: noteTemplateData(ZZZ_NOTE, { game: "zzz", ...NOTE_CTX }) },
  { name: "zzz/note", label: "空", data: noteTemplateData({}, { game: "zzz", ...NOTE_CTX }) },
  // 活动日历：三游戏共用一张模板，皮肤按视图里的 game 选
  { name: "act-calendar", label: "原神", data: buildActCalendar(GS_ACT, actCtx("gs")) },
  { name: "act-calendar", label: "原神空", data: buildActCalendar({}, actCtx("gs")) },
  { name: "act-calendar", label: "星铁", data: buildActCalendar(SR_ACT, actCtx("sr")) },
  { name: "act-calendar", label: "星铁空", data: buildActCalendar({}, actCtx("sr")) },
  { name: "act-calendar", label: "绝区零", data: buildActCalendar(ZZZ_ACT, actCtx("zzz")) },
  { name: "act-calendar", label: "绝区零空", data: buildActCalendar({}, actCtx("zzz")) },
  // 主帮助：三个游戏各一张（每张只讲一个游戏），外加主人看的那张（多出群管理与主人两块）
  { name: "help", label: "原神", data: buildHelp("gs", { isMaster: false, isAdmin: false }) as unknown as Record<string, unknown> },
  { name: "help", label: "星铁", data: buildHelp("sr", { isMaster: false, isAdmin: false }) as unknown as Record<string, unknown> },
  { name: "help", label: "绝区零", data: buildHelp("zzz", { isMaster: false, isAdmin: false }) as unknown as Record<string, unknown> },
  { name: "help", label: "主人", data: buildHelp("gs", MASTER) as unknown as Record<string, unknown> },
  // 分步指引：三节步骤 + 末尾要点，与命令清单那张不同形。两个游戏各一张，记号与主题色都该随之变
  { name: "help-guide", label: "原神", data: buildGachaGuide("gs") as unknown as Record<string, unknown> },
  { name: "help-guide", label: "星铁", data: buildGachaGuide("sr") as unknown as Record<string, unknown> },
  // 面板指引与上面那张同一模板。绝区零那一份少一节（换装试算整块不出，见 views/guide.ts），
  // 故一并渲一次：段数变了而模板照旧画得出，正是"节数由数据定"这件事的检验
  { name: "help-guide", label: "面板·原神", data: buildPanelGuide("gs") as unknown as Record<string, unknown> },
  { name: "help-guide", label: "面板·绝区零", data: buildPanelGuide("zzz") as unknown as Record<string, unknown> },
  { name: "help-guide", label: "排行·原神", data: buildRankGuide("gs") as unknown as Record<string, unknown> },
  { name: "help-guide", label: "排行·绝区零", data: buildRankGuide("zzz") as unknown as Record<string, unknown> },
  { name: "help-guide", label: "绑定·星铁", data: buildBindGuide("sr") as unknown as Record<string, unknown> },
  // 扫码卡片：二维码是内嵌 SVG，说明与标识码都在图里
  {
    name: "qr-login",
    data: buildQrCard("https://user.mihoyo.com/qr_code_in_game.html?ticket=abc", "qq:123456789") as unknown as Record<
      string,
      unknown
    >
  },
  { name: "character/profile-detail", data: profileDetailData(one, { mode: "profile" }) },
  {
    // 伤害计算开着时是另一份数据：多出伤害表那一整块
    name: "character/profile-detail",
    label: "带伤害表",
    data: profileDetailData(one, { mode: "profile", dmgCalc: dmgCalcView(dmgResult(false)) })
  },
  {
    // `dmg` 模式再多出词条收益对比与 Buff 列表两块，且属性栏读的是折算过 buff 的那份
    name: "character/profile-detail",
    label: "伤害模式",
    data: profileDetailData(one, {
      mode: "dmg",
      dmgCalc: dmgCalcView(dmgResult(true)),
      dmgAttr: { hp: 20000, atk: 1500, def: 900, mastery: 200, cpct: 80, cdmg: 180, recharge: 140, dmg: 60, phy: 0 }
    })
  },
  {
    // 带上排名：一个榜一、一个超出展示名额（第 17 名 → 垫底那档 rank-10），两档配色都走到
    name: "character/profile-list",
    data: profileListData(many, {
      uid: one.uid,
      game: "gs",
      servName: "Enka",
      at: one.at ?? 0,
      rank: {
        allow: true,
        cfg: { limitTxt: "无限制", time: "10-10 22:00", number: 15 },
        ranks: Object.fromEntries(
          many.map((it, at) => [it.id, { rank: at === 0 ? 1 : 17, rankType: at === 0 ? "dmg" : "mark" }])
        )
      }
    })
  },
  { name: "character/profile-detail", data: profileDetailData(one, { mode: "artis" }) },
  { name: "character/artis-list", data: artisListData(many, { uid: one.uid, game: "gs", limit: 28 }) },
  {
    name: "character/profile-stat",
    data: panelStatData(statRaw(), {
      game: "gs",
      uid: one.uid,
      name: "旅行者",
      marks: { "10000046": { mark: "230.5", markClass: "SSS" } }
    })
  },
  {
    // 第三个角色刻意没有面板数据：天赋是空对象、武器星级为 0，模板据此改印「暂无天赋数据」
    // 并藏起武器与套装那一行 —— 不藏则印出字面的 `undefined`
    name: "character/avatar-list",
    data: avatarListData(
      {
        role: { nickname: "旅行者", level: 60, game_head_icon: "https://a.invalid/head.png" },
        stats: {
          active_day_number: 800,
          achievement_number: 1100,
          way_point_number: 700,
          common_chest_number: 3000,
          exquisite_chest_number: 2500,
          precious_chest_number: 800,
          luxurious_chest_number: 300,
          magic_chest_number: 200
        },
        world_explorations: [
          { id: 1, name: "蒙德", exploration_percentage: 1000 },
          { id: 3, name: "龙脊雪山", exploration_percentage: 889 }
        ],
        avatars: [
          { id: 10000046, name: "胡桃", level: 90, rarity: 5, actived_constellation_num: 2, element: "Pyro" },
          { id: 10000030, name: "钟离", level: 90, rarity: 5, actived_constellation_num: 0, element: "Geo" },
          { id: 10000034, name: "班尼特", level: 80, rarity: 4, actived_constellation_num: 6, element: "Pyro" }
        ]
      },
      { game: "gs", uid: one.uid, name: "旅行者", panels: many, profileAt: one.at ?? 0, now: one.at ?? 0 }
    )
  },
  {
    name: "avatars",
    label: "绝区零角色列表：一位整卡、一位占位卡；头像来自元数据，不是阵营徽记",
    data: ZZZ_LIST_DATA
  },
  {
    name: "profile",
    label: "绝区零 %信息：常用角色那排的头像同样按 id 查元数据",
    data: { ...ZZZ_LIST_DATA }
  },
  {
    name: "character/avatar-list",
    label: "星铁",
    data: avatarListData(
      {
        cur_head_icon_url: "https://a.invalid/sr-head.png",
        stats: { active_days: 400, achievement_num: 600, chest_num: 2000 },
        avatar_list: [
          { id: 1306, name: "花火", level: 80, rarity: 5, rank: 2, element: "quantum", icon: "https://a.invalid/a.png" },
          { id: 1013, name: "黑塔", level: 70, rarity: 4, rank: 0, element: "lightning", icon: "https://a.invalid/b.png" }
        ]
      },
      { game: "sr", uid: "101234567", name: "开拓者", now: one.at ?? 0 }
    )
  },
  {
    name: "character/rank-profile-list",
    data: rankListData(
      many.map((p, i) => ({ panel: p, rank: i + 1, score: 100 - i })),
      {
        game: "gs",
        type: "mark",
        charName: one.name,
        elem: one.elem,
        cfg: { time: "09-01 00:00", limitTxt: "无限制", number: 15 }
      }
    )
  },
  {
    name: "character/character-card",
    data: buildCharCard(
      { game: "gs", uid: one.uid, name: one.name, abbr: one.abbr, star: one.star, elem: one.elem },
      one
    ) as unknown as Record<string, unknown>
  },
  {
    // 第二幕刻意不带祝福与诗筹：模板对这两项取 `.length`，而接口那一幕没有时不给这两个键，
    // 视图层不兜空数组整张图就出不来
    name: "gs/combat",
    data: combatTemplateData(
      {
        is_unlock: true,
        data: [
          {
            has_data: true,
            has_detail_data: true,
            schedule: { start_time: 1_785_000_000 },
            stat: {
              difficulty_id: 5,
              max_round_id: 10,
              heraldry: 4,
              get_medal_round_list: [1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
              coin_num: 12,
              avatar_bonus_num: 5,
              rent_cnt: 2,
              tarot_finished_cnt: 1
            },
            detail: {
              fight_statisic: {
                is_show_battle_stats: true,
                max_damage_avatar: { avatar_id: 10000046, value: "1288456", rarity: 5 },
                max_defeat_avatar: { avatar_id: 10000046, value: "52", rarity: 5 },
                max_take_damage_avatar: { avatar_id: 10000032, value: "402331", rarity: 4 },
                total_coin_consumed: { value: "37" },
                shortest_avatar_list: [
                  { avatar_id: 10000046, rarity: 5 },
                  { avatar_id: 10000032, rarity: 4 }
                ],
                total_use_time: 2_425
              },
              rounds_data: [
                {
                  round_id: 1,
                  finish_time: 1_785_000_600,
                  is_get_medal: true,
                  avatars: [
                    { avatar_id: 10000046, name: "胡桃", element: "Pyro", level: 90, rarity: 5, avatar_type: 1 },
                    { avatar_id: 10000032, name: "班尼特", element: "Pyro", level: 70, rarity: 4, avatar_type: 2 },
                    { avatar_id: 10000025, name: "行秋", element: "Hydro", level: 80, rarity: 4, avatar_type: 3 }
                  ],
                  enemies: [
                    { name: "丘丘岩盔王", icon: "https://a.invalid/e1.png", level: 95 },
                    { name: "深渊使徒·激流", icon: "https://a.invalid/e2.png", level: 95 }
                  ],
                  splendour_buff: {
                    summary: { total_level: 6 },
                    buffs: [
                      { name: "炽烈", icon: "https://a.invalid/s1.png", level: 3 },
                      { name: "翻涌", icon: "https://a.invalid/s2.png", level: 0 }
                    ]
                  },
                  buffs: [{ icon: "https://a.invalid/a.png", name: "祝福" }],
                  choice_cards: [{ icon: "https://a.invalid/b.png", name: "流光·星辰" }]
                },
                { round_id: 2, finish_time: 1_785_001_200 },
                {
                  round_id: 11,
                  finish_time: 1_785_002_000,
                  is_tarot: true,
                  tarot_serial_no: 1,
                  avatars: [{ avatar_id: 10000046, name: "胡桃", element: "Pyro", level: 90, rarity: 5, avatar_type: 1 }]
                }
              ]
            }
          }
        ]
      },
      {
        uid: one.uid,
        role: { nickname: "旅行者", level: 60, game_head_icon: "https://a.invalid/head.png" },
        faceOf: (id: string): string => {
          const name = ({ "10000046": "胡桃", "10000032": "班尼特", "10000025": "行秋" } as Record<string, string>)[id]
          return name ? `meta-gs/character/${name}/imgs/face.webp` : ""
        },
        // 自有的胡桃给整卡；班尼特（试用）与行秋（助演）即使这里有也不该取 —— 那是借来的配装
        cards: {
          "10000046": {
            id: "10000046",
            name: "胡桃",
            abbr: "胡桃",
            elem: "pyro",
            star: 5,
            level: 90,
            cons: 1,
            game: "gs",
            face: "meta-gs/character/胡桃/imgs/face.webp",
            gacha: "meta-gs/character/胡桃/imgs/gacha.webp",
            preview: "",
            talent: { a: { level: 8, original: 8 }, e: { level: 9, original: 9 }, q: { level: 10, original: 10 } },
            ...HUTAO_CARD_TALS,
            weapon: { star: 5, img: "meta-gs/weapon/护摩之杖/imgs/icon.webp", affix: 1 },
            artisSet: { names: ["炽烈的炎之魔女"], imgs: ["meta-gs/artifact/炽烈的炎之魔女/imgs/1.webp"] }
          }
        }
      }
    )
  },
  {
    // 第三张刻意没解锁：那时走另一条分支（压暗 + 「未获得」遮罩），且 `count` 为空串
    name: "gs/tarot",
    data: tarotTemplateData(
      {
        is_unlock: true,
        tarot_card_state: {
          curr_num: 2,
          total_num: 22,
          list: [
            { name: "愚者", icon: "https://a.invalid/0.png", is_unlock: true, unlock_num: 3 },
            { name: "女祭司", icon: "https://a.invalid/1.png", is_unlock: true, unlock_num: 1 },
            { name: "魔术师", icon: "https://a.invalid/2.png", is_unlock: false }
          ]
        }
      },
      { uid: one.uid, role: { nickname: "旅行者", level: 60, game_head_icon: "https://a.invalid/head.png" } }
    )
  },
  {
    // 三档状态各来一条：中间那一档两个布尔都是假，三分支写错会把「进行中」画成「已完成」。
    // 玩家信息刻意不传，钉住那三项补成空值
    name: "gs/char-master",
    data: charMasterTemplateData(
      {
        is_unlock: true,
        list: [
          { avatar_id: 10000046, name: "胡桃", icon: "https://a.invalid/a.png", status: 3 },
          { avatar_id: 10000030, name: "钟离", icon: "https://a.invalid/b.png", status: 2 },
          { avatar_id: 10000002, name: "神里绫华", icon: "https://a.invalid/c.png", status: 1 }
        ]
      },
      { uid: one.uid }
    )
  },
  {
    // 刻意混进一个认不出的档位与一个查不到头像的角色：两者都要留下那位角色 —— 新角色上线时
    // 站方先有数据、元数据还没更新，丢掉它等于让最该看的那一个消失
    name: "gs/abyss-pct",
    label: "深渊",
    data: abyssPctData(
      {
        code: 200,
        version: "5.0 下半",
        update: "更新时间：2026-09-08",
        top_own: 128_456,
        tips: "本期数据仍在收集中",
        has_list: [
          { name: "胡桃", use_rate: 62.3, rank_class: "s1" },
          { name: "钟离", use_rate: 58, rank_class: "s1" },
          { name: "行秋", use_rate: 41.5, rank_class: "s" },
          { name: "某新角色", use_rate: 30, rank_class: "a" },
          // 档位认不出，要并进末档
          { name: "班尼特", use_rate: 12.5, rank_class: "???" },
          // 使用率缺失，那一格不印数字
          { name: "砂糖", rank_class: "b" }
        ]
      },
      { mode: "abyss" }
    )
  },
  {
    // 幽境危战那一路：模式名与那句"仅统计难度 5 / 6"都该随之变
    name: "gs/abyss-pct",
    label: "幽境危战",
    data: abyssPctData(
      { code: 200, version: "5.0", has_list: [{ name: "玛薇卡", use_rate: 77.7, rank_class: "s1" }] },
      { mode: "hard" }
    )
  },
  {
    // 第二场刻意不带队伍与亮眼记录：模板对这两项取 `.length`，而接口没有时不给这两个键；
    // 第三场只有数值没有图，视图层要把整块滤掉，否则画出一排空头像
    name: "gs/hard-challenge",
    data: hardChallengeTemplateData(
      {
        is_unlock: true,
        data: [
          {
            schedule: { start_time: 1_785_000_000, end_time: 1_786_000_000, name: "第 3 期" },
            single: {
              has_data: true,
              best: { difficulty: 6, second: 83 },
              challenge: [
                {
                  name: "深廊猎手",
                  second: 83,
                  monster: { name: "圣骸毒蝎", icon: "https://a.invalid/m.png", level: 100 },
                  best_avatar: [{ avatar_id: 10000046, side_icon: "https://a.invalid/s.png", dps: 128_000 }],
                  teams: [
                    { avatar_id: 10000046, name: "胡桃", element: "Pyro", image: "https://a.invalid/a.png", level: 90, rarity: 5, rank: 2 },
                    { avatar_id: 10000032, name: "班尼特", element: "Pyro", image: "https://a.invalid/b.png", level: 90, rarity: 4 }
                  ]
                },
                { name: "秘源机兵", second: 47, monster: { name: "机关" } },
                { name: "无图记录", best_avatar: [{ dps: 1 }] }
              ]
            }
          }
        ]
      },
      {
        uid: one.uid,
        role: { nickname: "旅行者", level: 60, game_head_icon: "https://a.invalid/head.png" },
        // 胡桃给整张卡（天赋 / 武器 / 套装齐），班尼特不在卡 map 里 —— 由视图退回只带接口头像的占位卡
        cards: {
          "10000046": {
            id: "10000046",
            name: "胡桃",
            abbr: "胡桃",
            elem: "pyro",
            star: 5,
            level: 90,
            cons: 2,
            game: "gs",
            face: "meta-gs/character/胡桃/imgs/face.webp",
            gacha: "meta-gs/character/胡桃/imgs/gacha.webp",
            preview: "",
            talent: { a: { level: 8, original: 8 }, e: { level: 9, original: 9 }, q: { level: 10, original: 10 } },
            ...HUTAO_CARD_TALS,
            weapon: { star: 5, img: "meta-gs/weapon/护摩之杖/imgs/icon.webp", affix: 1 },
            artisSet: { names: ["炽烈的炎之魔女"], imgs: ["meta-gs/artifact/炽烈的炎之魔女/imgs/1.webp"] }
          }
        }
      }
    )
  },
  {
    // 深渊总览：顶部排行用立绘卡、逐层队伍用角色卡（common/avatar-card.html）；胡桃命中卡 map、班尼特退回占位卡
    name: "gs/abyss",
    data: abyssTemplateData(
      {
        start_time: 1_785_000_000,
        max_floor: "12-3",
        total_battle_times: 24,
        floors: [
          { index: 8, star: 9 },
          {
            index: 12,
            star: 8,
            levels: [1, 2, 3].map(index => ({
              index,
              star: index === 3 ? 2 : 3,
              battles: [
                {
                  index: 1,
                  timestamp: 1_785_000_000 + index * 300,
                  avatars: [
                    { id: 10000046, icon: "https://a.invalid/a.png", rarity: 5, level: 90 },
                    { id: 10000032, icon: "https://a.invalid/b.png", rarity: 4, level: 90 },
                    { id: 10000025, icon: "https://a.invalid/c.png", rarity: 4, level: 90 },
                    { id: 10000030, icon: "https://a.invalid/d.png", rarity: 5, level: 90 }
                  ]
                },
                {
                  index: 2,
                  timestamp: 1_785_000_100 + index * 300,
                  avatars: [{ id: 10000032, icon: "https://a.invalid/b.png", rarity: 4, level: 90 }]
                }
              ]
            }))
          }
        ],
        reveal_rank: [{ avatar_id: 10000046, value: 12, avatar_icon: "https://a.invalid/a.png", rarity: 5 }],
        damage_rank: [{ avatar_id: 10000046, value: 168_888, avatar_icon: "https://a.invalid/a.png" }],
        take_damage_rank: [{ avatar_id: 10000032, value: 40_000 }],
        defeat_rank: [{ avatar_id: 10000025, value: 31, rarity: 4 }],
        normal_skill_rank: [{ avatar_id: 10000030, value: 44, rarity: 5 }],
        energy_skill_rank: [{ avatar_id: 10000046, value: 19, rarity: 5 }]
      },
      { game: "gs", uid: one.uid, name: "旅行者", schedule: 1 },
      {
        "10000046": {
          id: "10000046",
          name: "胡桃",
          abbr: "胡桃",
          elem: "pyro",
          star: 5,
          level: 90,
          cons: 2,
          game: "gs",
          face: "meta-gs/character/胡桃/imgs/face.webp",
          gacha: "meta-gs/character/胡桃/imgs/gacha.webp",
          preview: "",
          talent: { a: { level: 8, original: 8 }, e: { level: 9, original: 9 }, q: { level: 10, original: 10 } },
          ...HUTAO_CARD_TALS,
          weapon: { star: 5, img: "meta-gs/weapon/护摩之杖/imgs/icon.webp", affix: 1 },
          artisSet: { names: ["炽烈的炎之魔女"], imgs: ["meta-gs/artifact/炽烈的炎之魔女/imgs/1.webp"] }
        }
      }
    )
  },
  {
    // 第二关刻意只有上半场：接口只打了上半时不给 `node_2`，而模板逐层取值并对角色取 `.length`
    name: "sr/challenge-story",
    data: srChallengeStatData(
      {
        has_data: true,
        star_num: 9,
        max_floor: "第 4 层",
        battle_num: 12,
        groups: [
          {
            name_mi18n: "第 20 期",
            begin_time: { year: 2026, month: 8, day: 1, hour: 4, minute: 0 },
            end_time: { year: 2026, month: 9, day: 14, hour: 3, minute: 59 }
          }
        ],
        all_floor_detail: [
          {
            name: "第 1 层",
            star_num: 3,
            round_num: 4,
            is_fast: true,
            node_1: {
              score: "40000",
              challenge_time: { year: 2026, month: 8, day: 2, hour: 2, minute: 51 },
              buff: {
                name_mi18n: "劫火",
                desc_mi18n: "<color=#f29e38ff>火</color>属性伤害提高\\n30%",
                icon: "https://a.invalid/buff.png"
              },
              avatars: [
                { id: 1306, level: 80, icon: "https://a.invalid/b.png", rarity: 5, element: "Fire", rank: 2 },
                { id: 1013, level: 80, icon: "https://a.invalid/c.png", rarity: 4, element: "quantum" },
                // 记忆角色：忆灵技与忆灵天赋两项画成头像角标，不挤进天赋行
                { id: 1402, level: 80, icon: "https://a.invalid/d.png", rarity: 5, element: "Lightning", rank: 0 }
              ]
            },
            node_2: { score: 0, avatars: [{ id: 1306, level: 80, icon: "https://a.invalid/b.png", rarity: 5 }] }
          },
          { name: "第 2 层", star_num: 1, node_1: { avatars: [{ id: 1013, icon: "https://a.invalid/c.png" }] } },
          // 新档位那一类：三个节点，末一个还没打
          {
            name: "第 3 层星启模式",
            star_num: 3,
            node_1: { score: 3575, avatars: [{ id: 1306, level: 80, icon: "https://a.invalid/b.png", rarity: 5 }] },
            node_2: { score: 311, avatars: [{ id: 1013, level: 80, icon: "https://a.invalid/c.png", rarity: 4 }] },
            node_3: {}
          }
        ]
      },
      {
        kind: "story",
        uid: one.uid,
        nickname: "开拓者",
        nameOf: (id: string): string => (id === "1306" ? "花火" : ""),
        // 面板库里那份也给上：天赋与装备两行只有它齐备时才画，缺了就一整块不出现
        avatars: {
          "1306": {
            star: 5,
            cons: 2,
            level: 80,
            abbr: "花火",
            name: "花火",
            face: "meta-sr/character/花火/imgs/face.webp",
            talent: { a: { level: 6, max: 7 }, e: { level: 10, max: 12 }, q: { level: 10, max: 12 }, t: { level: 10, max: 12 } },
            talentCount: 4,
            tals: [
              { key: "a", name: "", level: 6, crown: false },
              { key: "e", name: "", level: 10, crown: false },
              { key: "q", name: "", level: 10, crown: false },
              { key: "t", name: "", level: 10, crown: false }
            ],
            xtals: [],
            weapon: { img: "meta-sr/weapon/以世界之名/icon.webp", star: 5, affix: 1 },
            artisSet: { imgs: ["meta-sr/artifact/翁法罗斯的黄金裔/arti-1.webp"] }
          },
          "1402": {
            star: 5,
            cons: 0,
            level: 80,
            abbr: "阿格莱雅",
            name: "阿格莱雅",
            face: "meta-sr/character/阿格莱雅/imgs/face.webp",
            talent: {
              a: { level: 6, max: 7 },
              e: { level: 12, max: 12 },
              q: { level: 10, max: 12 },
              t: { level: 10, max: 12 },
              me: { level: 6, max: 7 },
              mt: { level: 7, max: 7 }
            },
            talentCount: 6,
            tals: [
              { key: "a", name: "", level: 6, crown: false },
              { key: "e", name: "", level: 12, crown: true },
              { key: "q", name: "", level: 10, crown: false },
              { key: "t", name: "", level: 10, crown: false }
            ],
            xtals: [
              { key: "me", name: "忆技", level: 6, crown: false },
              { key: "mt", name: "忆赋", level: 7, crown: true }
            ],
            weapon: { img: "meta-sr/weapon/以世界之名/icon.webp", star: 5, affix: 1 },
            artisSet: { imgs: ["meta-sr/artifact/翁法罗斯的黄金裔/arti-1.webp"] }
          }
        }
      }
    )
  },
  {
    name: "sr/peak-challenge",
    data: peakChallengeStatData(
      {
        role: { nickname: "开拓者" },
        challenge_peak_best_record_brief: {
          challenge_peak_rank_icon_type: "ChallengePeakRankIconTypeGold",
          boss_stars: 3,
          mob_stars: 5,
          total_battle_num: 8
        },
        challenge_peak_records: [
          {
            has_challenge_record: true,
            group: { name_mi18n: "财富造物主31", game_version: "3.7", end_time: { year: 2026, month: 8, day: 17 } },
            boss_info: { name_mi18n: "王棋", icon: "https://a.invalid/boss.png" },
            boss_record: {
              has_challenge_record: true,
              hard_mode: true,
              round_num: 12,
              star_num: 3,
              challenge_time: { year: 2026, month: 8, day: 2, hour: 2, minute: 51 },
              buff: {
                name_mi18n: "裁决",
                desc_mi18n: "<color=#f29e38ff>伤害</color>提高\\n30%",
                icon: "https://a.invalid/buff.png"
              },
              avatars: [
                { id: 1306, name: "花火", level: 80, icon: "https://a.invalid/a.png", rarity: 5, element: "quantum", rank: 2 },
                { id: 8004, name: "开拓者", level: 80, icon: "https://a.invalid/b.png", rarity: 5, element: "lightning" }
              ]
            },
            // 第二个骑士关刻意没有对应的战绩：接口在没打过那一场时不给
            mob_infos: [
              { name: "骑士其一", icon: "https://a.invalid/m1.png" },
              { name: "骑士其二", icon: "https://a.invalid/m2.png" }
            ],
            mob_records: [
              {
                has_challenge_record: true,
                is_fast: true,
                star_num: 2,
                avatars: [{ id: 1013, level: 80, icon: "https://a.invalid/c.png", rarity: 4, element: "physical" }]
              }
            ]
          }
        ]
      },
      { uid: one.uid, nameOf: (id: string): string => (id === "8004" ? "星" : "") }
    )
  },
  {
    /* 两项收集进度：数字刻意都用字符串，接口给的就是字符串 */
    name: "sr/achieve",
    data: srAchieveData(
      {
        gold_num: "12",
        silver_num: "88",
        copper_num: "306",
        list: [
          { series_id: 1, name: "开拓的路上", icon: "https://a.invalid/a.png", cur: "9", max: "10" },
          { series_id: 2, name: "苍穹之下", icon: "https://a.invalid/b.png", cur: "24", max: "24" }
        ]
      },
      { uid: one.uid, nickname: "开拓者" }
    )
  },
  {
    name: "sr/chest",
    data: srChestData(
      {
        world_list: [
          {
            world_id: "1",
            name: "空间站「黑塔」",
            icon: "https://a.invalid/w.png",
            world_cur: "40",
            world_max: "50",
            map_entrances: [
              { id: 101, name: "基座舱段", cur_chest: "20", max_chest: "20" },
              { id: 102, name: "收容舱段", cur_chest: "20", max_chest: "30" }
            ]
          },
          // 接口连名字与区域都不给的那一项，模板照样得画得出来
          { world_id: "999", world_cur: "3", world_max: "6" }
        ]
      },
      { uid: one.uid, nickname: "开拓者" }
    )
  },
  {
    name: "sr/rogue",
    data: srRogueData(
      {
        role: { nickname: "开拓者" },
        basic_info: { unlocked_buff_num: "128", unlocked_miracle_num: "96", unlocked_skill_points: "40" },
        latest_record: {
          has_data: true,
          basic: { finish_cnt: "3" },
          records: [
            {
              name: "第八世界",
              difficulty: 5,
              progress: 8,
              finish_time: { year: 2026, month: 9, day: 1, hour: 22, minute: 5 },
              fury: { type: 1, point: 3 },
              // 第二个命途刻意在祝福里没有出现：那时只有 id，模板退回印 id
              base_type_list: [{ id: 120, cnt: "6" }, { id: 124, cnt: "2" }],
              buffs: [
                {
                  base_type: { id: 120, name: "欢愉" },
                  items: [
                    { id: 1, name: "「不义之财」", rank: 3, is_evoluted: true },
                    { id: 2, name: "「一饮而尽」", rank: 2 }
                  ]
                }
              ],
              miracles: [{ id: 1, icon: "https://a.invalid/m1.png", rank: 3 }],
              final_lineup: [{ id: 1306, level: 80, icon: "https://a.invalid/a.png", rarity: 5, rank: 2 }],
              blocks: [{ name: "遭遇", num: 3 }],
              boss_effect: ["首领获得护盾"]
            }
          ]
        }
      },
      { uid: one.uid, nameOf: (id: string): string => (id === "1306" ? "花火" : "") }
    )
  },
  {
    name: "sr/currency-war",
    label: "货币战争：前后台两排、羁绊与伤害条",
    data: gridFightData(
      {
        grid_fight_brief: {
          division: { name: "财富造物主", name_with_num: "财富造物主44", level: "9", icon_with_bg: "https://a.invalid/d.png" },
          season_level: "167",
          weekly_score_cur: "18000",
          weekly_score_max: "18000",
          unlocked: true,
          has_played: true,
          handbook_progress: "66",
          trait_progress: "58",
          quest_cur: "29",
          quest_max: "91"
        },
        grid_fight_archive_list: [
          {
            archive_type: "ArchiveTypeNormal",
            brief: {
              archive_time: "2026-09-11 01:05:14",
              archive_rank: "GridFightArchiveRankS",
              remain_hp: "86",
              total_coin: "360",
              lineup_coin: "82",
              division: { name: "财富造物主", name_with_num: "财富造物主41", level: "9" }
            },
            lineup: {
              // 刻意给一个 pos 倒置的：视图要按 pos 排，不按下标
              front_roles: [
                { role_id: "1306", name: "千冶•刃", icon: "https://a.invalid/r2.png", star: "2", pos: "2", is_upgrade: true, equip_list: [] },
                {
                  role_id: "1510",
                  name: "姬子•启行",
                  icon: "https://a.invalid/r1.png",
                  star: "3",
                  pos: "1",
                  equip_list: [{ equip_id: "35030204", name: "高周波电锯", icon: "https://a.invalid/e.png", category: "GridFightEquipCategoryCraftable" }]
                }
              ],
              // 试用与投影两枚角标各出现一次
              back_roles: [{ role_id: "1507", name: "希儿", icon: "https://a.invalid/r3.png", star: "1", pos: "5", is_trial: true, is_projection: true, equip_list: [] }],
              portal_list: [{ portal_id: "113", name: "蓝海", icon: "https://a.invalid/p.png" }],
              augment_list: [{ augment_id: "200801", name: "市场活力", icon: "https://a.invalid/g.png", quality: "2" }],
              trait_list: [{ trait_id: "3007", trait_name: "领航员", trait_count: "1", quality: "4", icon: "https://a.invalid/t.png" }],
              // 十一位的原始伤害要折成短串；非角色那一族不进图
              damage_list: [
                { damage_type: "DamageTypeRole", id: "1510", damage: "65722760586.46828" },
                { damage_type: "DamageTypeRole", id: "1306", damage: "12000000000" },
                { damage_type: "DamageTypeOther", id: "0", damage: "999" }
              ]
            }
          }
        ]
      },
      { uid: one.uid, period: "本期", nickname: "开拓者" }
    )
  },
  {
    name: "sr/unknowable",
    label: "不可知域：未打过的那几条不出现",
    data: rogueMagicData(
      {
        role: { nickname: "开拓者", level: 70 },
        basic_info: {
          linear_tree_num: "40%",
          magic_compendium: "25%",
          discover_secrets: "10%",
          challenge_task_total_num: 25,
          challenge_task_current_num: 7,
          magic_record: { name: "", completed_time: null }
        },
        normal_record_list: [
          {
            name: "记住他们",
            id: 806,
            level: 3,
            schedule_current_floor_num: 5,
            schedule_total_floor_num: 8,
            additional_rounds: 2,
            additional_problems_num: 1,
            exist_additional_rounds: true,
            completed_time: { year: 2026, month: 9, day: 10, hour: 21, minute: 30, second: 0 },
            calculation_tendency: { display_id: 1, name: "均衡", icon: "https://a.invalid/c.png" },
            avatar_list: [{ id: 1306, level: 80, rarity: 5, icon: "https://a.invalid/a.png" }],
            magic_list: [{ id: 1, name: "「造物」", icon: "https://a.invalid/m.png", rank: 3 }],
            miracle_list: [{ id: 2, name: "奇物", icon: "https://a.invalid/x.png", rank: 2 }]
          }
        ],
        // 这两条都没打过（时刻六个字段全零），一条都不该出现在图上
        custom_record_list: [
          { name: "熄灭火焰", id: 805, completed_time: { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }, avatar_list: [], magic_list: [], miracle_list: [] },
          { name: "躯壳迁移", id: 804, completed_time: { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }, avatar_list: [], magic_list: [], miracle_list: [] }
        ]
      },
      { uid: one.uid, period: "本期", nameOf: (id: string): string => (id === "1306" ? "花火" : "") }
    )
  },
  {
    name: "zzz/defense",
    label: "式舆防卫战：第五层带总览，另一层只有评级",
    data: zzzDefenseData(
      {
        hadal_ver: "v2",
        hadal_info_v2: {
          hadal_begin_time: { year: 2026, month: 8, day: 18, hour: 4 },
          hadal_end_time: { year: 2026, month: 9, day: 1, hour: 3, minute: 59, second: 59 },
          brief: {
            score: 150_000,
            rank_percent: 137,
            rating: "S+",
            challenge_time: { year: 2026, month: 8, day: 20, hour: 21, minute: 3, second: 8 },
            battle_time: 245
          },
          fitfh_layer_detail: {
            rating: "S+",
            challenge_time: { year: 2026, month: 8, day: 20, hour: 21, minute: 3, second: 8 },
            layer_challenge_info_list: [
              {
                rating: "S",
                score: 50_000,
                monster_pic: "https://a.invalid/monster.png",
                challenge_time: { year: 2026, month: 8, day: 20, hour: 20, minute: 51, second: 2 },
                buffer: { title: "勠力" },
                avatar_list: [
                  { id: 1581, level: 60, rank: 2, rarity: "S", role_square_url: "https://a.invalid/1581.png" },
                  { id: 1501, level: 60, rank: 0, rarity: "S", role_square_url: "https://a.invalid/1501.png" }
                ],
                buddy: { id: 54_010, level: 60, rarity: "S", bangboo_rectangle_url: "https://a.invalid/b.png" }
              }
            ]
          },
          // 低层只给评级与通关时刻，不给分数 —— 那时模板印 0 而不是空
          third_layer_detail: {
            rating: "S",
            challenge_time: { year: 2026, month: 8, day: 19, hour: 12 },
            layer_challenge_info_list: [
              { avatar_list: [{ id: 1091, level: 60, rarity: "S", role_square_url: "https://a.invalid/1091.png" }] }
            ]
          }
        }
      },
      {
        uid: "1300000001",
        nickname: "绳匠",
        period: "本期",
        nameOf: (id: string): string => (id === "1581" ? "耀嘉音" : ""),
        // 1581 命中卡 map（音擎/驱动盘/技能齐），1501、1091 不在卡 map 里 —— 退回只带接口头像的占位卡
        cards: {
          "1581": {
            id: "1581",
            name: "耀嘉音",
            abbr: "耀嘉音",
            elem: "电属性",
            star: 5,
            level: 60,
            cons: 2,
            face: "meta-zzz/character/耀嘉音/imgs/face.webp",
            gacha: "meta-zzz/character/耀嘉音/imgs/gacha.webp",
            skills: [
              { key: "normal", name: "普通攻击", level: 9 },
              { key: "special", name: "特殊技", level: 12 },
              { key: "dodge", name: "闪避", level: 7 },
              { key: "chain", name: "连携技", level: 10 },
              { key: "core", name: "核心技", level: 7 },
              { key: "assist", name: "支援技", level: 5 }
            ],
            // 六格分两行；特殊技 12 与核心技 7 都是满级，验两个满级判据
            tals: [
              { key: "normal", name: "", level: 9, crown: false },
              { key: "special", name: "", level: 12, crown: true },
              { key: "dodge", name: "", level: 7, crown: false },
              { key: "chain", name: "", level: 10, crown: false },
              { key: "core", name: "", level: 7, crown: true },
              { key: "assist", name: "", level: 5, crown: false }
            ],
            weapon: { name: "停摆", star: 5, affix: 1, img: "meta-zzz/weapon/支援/停摆/icon.webp" },
            sets: [{ name: "摇摆爵士", own: 4, img: "meta-zzz/equip/摇摆爵士/icon.webp" }]
          }
        }
      }
    )
  },
  {
    name: "zzz/deadly",
    label: "危局强袭战：接口自带昵称与头像，另有绝境一档",
    data: zzzDeadlyData(
      {
        has_data: true,
        start_time: { year: 2026, month: 7, day: 29, hour: 4 },
        end_time: { year: 2026, month: 8, day: 14, hour: 3, minute: 59, second: 59 },
        rank_percent: 2393,
        nick_name: "米哈游董事长",
        avatar_icon: "https://a.invalid/face.png",
        total_score: 110_998,
        total_star: 9,
        total_max_score: 195_000,
        room_max_score: 65_000,
        list: [
          {
            score: 45_323,
            star: 3,
            total_star: 3,
            challenge_time: { year: 2026, month: 7, day: 29, hour: 12, minute: 57, second: 29 },
            boss: [
              {
                icon: "https://a.invalid/boss.png",
                name: "基塔布鲁·滞变畸兽",
                race_icon: "https://a.invalid/race.png",
                bg_icon: "https://a.invalid/bg.png"
              }
            ],
            buffer: [{ icon: "https://a.invalid/buff.png", name: "勠力", desc: "· 队伍内存在异常特性代理人时" }],
            avatar_list: [{ id: 1581, level: 60, rank: 2, rarity: "S", role_square_url: "https://a.invalid/1581.png" }],
            buddy: { id: 54_010, level: 60, rarity: "S", bangboo_rectangle_url: "https://a.invalid/b.png" }
          }
        ],
        has_hard: true,
        hard_rank_percent: 2189,
        hard_list: [
          {
            score: 30_419,
            star: 3,
            total_star: 3,
            challenge_time: { year: 2026, month: 8, day: 2, hour: 23, minute: 42, second: 42 },
            boss: [{ icon: "https://a.invalid/boss2.png", name: "异构·基塔布鲁" }],
            buffer: [],
            avatar_list: [{ id: 1501, level: 60, rarity: "S", role_square_url: "https://a.invalid/1501.png" }]
          }
        ]
      },
      // 带卡：首领战那一块是整卡队伍，这一支要真渲到
      { uid: "1300000001", period: "本期", cards: { "1581": zzzPlaceholderCard({ id: "1581", name: "耀嘉音", star: 5, level: 60, cons: 2, face: "" }) } }
    )
  },
  {
    name: "zzz/holo",
    label: "拟境湮灭战：用时与奖牌，接口不给昵称",
    data: zzzHoloData(
      {
        unlock: true,
        start_time: { year: 2026, month: 8, day: 4, hour: 4 },
        end_time: { year: 2026, month: 8, day: 18, hour: 3, minute: 59, second: 59 },
        list: [
          {
            star: 3,
            total_star: 3,
            rank: 341,
            // 这一项是用时而非时刻：只有分秒有意义
            challenge_time: { minute: 3, second: 41 },
            boss: {
              icon: "https://a.invalid/holo.png",
              name: "「白祸」",
              medal: { medal_icon: "https://a.invalid/medal.png", medal_id: 2, is_no_injured: true }
            },
            avatar_list: [{ id: 1091, level: 60, rank: 1, rarity: "S", role_square_url: "https://a.invalid/1091.png" }]
          },
          // 第二场刻意不给奖牌与排名：那两处都要整块不画
          {
            star: 2,
            total_star: 3,
            challenge_time: { minute: 5, second: 2 },
            boss: { icon: "https://a.invalid/holo2.png", name: "未知复合侵蚀体" },
            avatar_list: []
          }
        ]
      },
      { uid: "1300000001", nickname: "绳匠", period: "本期" }
    )
  },
  {
    name: "zzz/tower",
    label: "拟真鏖战试炼：前两季与后两季形态不同",
    data: zzzTowerData(
      {
        // S1、S2 的层数与徽章在顶层
        climbing_tower_s1: { medal_icon: "https://a.invalid/m1.png", climbing_tower_layer: 30 },
        climbing_tower_s2: { medal_icon: "https://a.invalid/m2.png", climbing_tower_layer: 35, floor_mvp_num: 12 },
        // S3、S4 挪进了两个子对象，S4 另有一张角色排行
        climbing_tower_s4: {
          layer_info: { medal_icon: "https://a.invalid/m4.png", climbing_tower_layer: 40, total_score: 128_600 },
          mvp_info: { floor_mvp_num: 18, rank_percent: 89 },
          display_avatar_rank_list: [
            { rarity: "S", icon: "https://a.invalid/r1.png", name: "耀嘉音", score: 44_100, rank_percent: 120 },
            { rarity: "A", icon: "https://a.invalid/r2.png", name: "安比", score: 39_800 }
          ]
        }
      },
      { uid: "1300000001", nickname: "绳匠", period: "" }
    )
  },
  {
    name: "zzz/void",
    label: "临界推演：首领关加子关卡，本期未结束时不给止期",
    data: zzzVoidData(
      {
        void_front_battle_detail: {
          void_front_battle_abstract_info_brief: {
            start_time: { year: 2026, month: 8, day: 4 },
            // 刻意不给 end_time：本期未结束，视图给出「超过 42 天」
            total_score: 92_400,
            max_score: 100_000,
            rank_percent: 512,
            ending_record_name: "最终结局·破晓",
            ending_record_bg_pic: "https://a.invalid/ending.png"
          },
          boss_challenge_record: {
            boss_info: { name: "「白祸」", icon: "https://a.invalid/boss.png" },
            main_challenge_record: {
              name: "LAST STAGE",
              star: "S+",
              score: 30_000,
              max_score: 30_000,
              score_ratio: 1.5,
              challenge_time: { year: 2026, month: 8, day: 9, hour: 21, minute: 2, second: 5 },
              buffer: { name: "勠力", icon: "https://a.invalid/buff.png" },
              avatar_list: [{ id: 1091, level: 60, rank: 1, rarity: "S", role_square_url: "https://a.invalid/1091.png" }],
              buddy: { id: 54_010, level: 60, rarity: "S", bangboo_rectangle_url: "https://a.invalid/b.png" },
              sub_challenge_record: [
                {
                  name: "4-1",
                  star: "S",
                  buffer: { name: "诡袭", icon: "https://a.invalid/buff2.png" },
                  avatar_list: [{ id: 1011, level: 60, rarity: "A", role_square_url: "https://a.invalid/1011.png" }]
                }
              ]
            }
          },
          main_challenge_record_list: [
            {
              name: "STAGE 04",
              star: "A",
              score: 18_200,
              max_score: 20_000,
              score_ratio: "1.2",
              challenge_time: { year: 2026, month: 8, day: 8, hour: 20 },
              buffer: { name: "摧心" },
              avatar_list: [],
              sub_challenge_record: []
            }
          ]
        }
      },
      { uid: "1300000001", nickname: "绳匠", period: "本期" }
    )
  },
  {
    name: "zzz/garden",
    label: "枯萎苗圃：收集项名称按位置补，刀耕火焚来自另一条接口",
    data: zzzGardenData(
      {
        abyss_level: { cur_level: 60, max_level: 60, icon: "https://a.invalid/lv.png" },
        abyss_talent: { cur_talent: 28, max_talent: 30 },
        // 刻意给六项：第六项没有名字，按「其他 6」列出而不丢掉
        abyss_collect: [
          { cur_collect: 40, max_collect: 40 },
          { cur_collect: 12, max_collect: 20 },
          { cur_collect: 5, max_collect: 8 },
          { cur_collect: 3, max_collect: 9 },
          { cur_collect: 1, max_collect: 4 },
          { cur_collect: 2, max_collect: 6 }
        ],
        abyss_throne: { max_damage: 1_284_000 }
      },
      {
        abyss_throne_max: {
          time: 3725,
          max_damage: 1_284_000,
          avatar_list: [
            { id: 1091, level: 60, rank: 1, rarity: "S", role_square_url: "https://a.invalid/1091.png", damage_rate: 62 }
          ],
          buddy_list: [{ id: 54_010, level: 60, rarity: "S", bangboo_rectangle_url: "https://a.invalid/b.png" }]
        }
      },
      {
        uid: "1300000001",
        nickname: "绳匠",
        nameOf: (id: string): string => (id === "1091" ? "雅" : ""),
        // 1091 命中卡 map：枯萎苗圃那队也出整张代理人卡，卡下再叠伤害占比
        cards: {
          "1091": {
            id: "1091",
            name: "雅",
            abbr: "雅",
            elem: "以太属性",
            star: 5,
            level: 60,
            cons: 1,
            face: "meta-zzz/character/雅/imgs/face.webp",
            gacha: "meta-zzz/character/雅/imgs/gacha.webp",
            skills: [{ key: "normal", name: "普通攻击", level: 7 }],
            tals: [{ key: "normal", name: "", level: 7, crown: false }],
            weapon: { name: "飞鸟星梦", star: 5, affix: 1, img: "meta-zzz/weapon/强攻/飞鸟星梦/icon.webp" },
            sets: [{ name: "折枝剑歌", own: 4, img: "meta-zzz/equip/折枝剑歌/icon.webp" }]
          }
        }
      }
    )
  },
  {
    name: "zzz/lost",
    label: "迷失之地：七项收集，三档挑战只出接口给了的那两档",
    data: zzzLostData(
      {
        abyss_level: { cur_level: 55, max_level: 60, icon: "https://a.invalid/lv.png" },
        abyss_duty: { cur_duty: 8, max_duty: 10 },
        abyss_task: { cur_task: 3, max_task: 6 },
        abyss_collect: [1, 2, 3, 4, 5, 6, 7].map(n => ({ cur_collect: n, max_collect: n + 2 })),
        abyss_max: { max_name: "以太失序·III", heat_count: 320, max_count: 4, best_time: 1265 },
        abyss_task_force_investigation_max: { max_name: "特遣·II", heat_count: 180, max_count: 2, best_time: 940 }
      },
      { uid: "1300000001", nickname: "绳匠" }
    )
  },
  {
    name: "zzz/zenkov",
    label: "迷宫诡域：名次口径的排名，逐地图撤离率",
    data: zzzZenkovData(
      {
        refresh_time: 190_800,
        season_data: { name: "诡域·第二赛季", level: 22, refresh_time: 1_209_600 },
        // 名次口径：`is_show_percent` 为假时 max_rank 就是名次本身
        max_rank: 37,
        is_show_percent: false,
        total_enter_num: 46,
        total_leave_num: 38,
        total_material_value: 1_284_600,
        map_list: [
          { name: "旧都会区", icon: "https://a.invalid/z1.png", enter_num: 26, leave_num: 22, leave_percent: 8462 },
          // 整数百分比不带小数位；这一张刻意一次没进过，逐地图那一段仍要列出来
          { name: "封锁线", icon: "https://a.invalid/z2.png", enter_num: 20, leave_num: 16, leave_percent: 8000 }
        ]
      },
      { uid: "1300000001", nickname: "绳匠" }
    )
  },
  {
    name: "zzz/zenkov-detail",
    label: "迷宫诡域战绩：逐场记录带撤离物资，未撤离那一场也要出",
    data: zzzZenkovDetailData(
      {
        max_rank: 512,
        is_show_percent: true,
        total_enter_num: 46,
        total_leave_num: 38,
        total_material_value: 1_284_600,
        map_list: [
          { name: "旧都会区", icon: "https://a.invalid/z1.png", enter_num: 26, leave_num: 22, leave_percent: 8462 }
        ],
        record_list: [
          {
            map_name: "旧都会区",
            difficult: "Hell",
            start_time: { year: 2026, month: 9, day: 6, hour: 21, minute: 4, second: 12 },
            // 用时带小时：这一族与拟境湮灭战那个"只有分秒"的不同形
            challenge_time: { hour: 1, minute: 2, second: 33 },
            is_leave: true,
            material_total_value: 486_200,
            item_list: [
              { name: "以太结晶", icon: "https://a.invalid/i1.png", rarity: 5, num: 3 },
              { name: "废弃齿轮", icon: "https://a.invalid/i2.png", rarity: 3, num: 12 },
              // 稀有度不在 3/4/5 之内：那一格不画底色
              { name: "杂物", icon: "https://a.invalid/i3.png", rarity: 1, num: 5 }
            ]
          },
          // 这一场没撤离，也没带出任何物资 —— 物资那一块整块不画，但这一场仍要列出
          {
            map_name: "封锁线",
            difficult: "Hard",
            start_time: { year: 2026, month: 9, day: 5, hour: 19, minute: 30, second: 0 },
            challenge_time: { minute: 18, second: 7 },
            is_leave: false,
            material_total_value: 0
          }
        ]
      },
      { uid: "1300000001", nickname: "绳匠" }
    )
  },
  {
    name: "zzz/explore",
    label: "区域收集：区域套子区域套逐项",
    data: zzzExploreData(
      {
        area_collections: [
          {
            name: "六分街",
            collection_progress: 82,
            map_collections: [
              {
                name: "第六街",
                icon: "https://a.invalid/map.png",
                collection_progress: 90,
                collections: [
                  { name: "录像带", icon: "https://a.invalid/i1.png", num: 9, total: 9 },
                  { name: "拾物", icon: "https://a.invalid/i2.png", num: 4, total: 7 }
                ]
              }
            ]
          }
        ]
      },
      { uid: "1300000001", nickname: "绳匠" }
    )
  },
  {
    name: "zzz/ledger",
    label: "菲林月报：只有收入，来源代码换成中文",
    data: zzzLedgerData(
      {
        current_month: "202601",
        data_month: "202512",
        optional_month: ["202601", "202512", "202511"],
        month_data: {
          list: [
            { data_type: "PolychromesData", count: 5199, data_name: "菲林" },
            { data_type: "MatserTapeData", count: 32, data_name: "加密母带 & 原装母带" },
            { data_type: "BooponsData", count: 22, data_name: "邦布券" }
          ],
          income_components: [
            { action: "daily_activity_rewards", num: 1780, percent: 34 },
            { action: "shiyu_rewards", num: 1140, percent: 22 },
            // 刻意给一个表里没有的代码：按「其他奖励」印，不留一个空名字
            { action: "unknown_rewards", num: 60, percent: 1 }
          ]
        },
        role_info: { nickname: "其实雨很好", avatar: "https://a.invalid/face.png" }
      },
      { uid: "1300000001" }
    )
  },
  {
    name: "gs/calculator",
    label: "养成计算：角色一栏的键名不叫 char（那个名字引擎会丢掉）",
    data: buildCalculator(CALC_INPUT("gs"))
  },
  {
    name: "sr/calculator",
    label: "养成计算：星铁那张只差消耗分组的标题",
    data: buildCalculator(CALC_INPUT("sr"))
  },
  {
    name: "character/profile-detail",
    label: "代理人面板：与另两个游戏同一张图，驱动盘占圣遗物那一栏、音擎占武器那一栏",
    data: zzzPanelData(ZZZ_STORED, { uid: "1300000001", mark: ZZZ_MARK, at: 1_767_225_600_000 })
  },
  {
    name: "character/profile-detail",
    label: "代理人面板：没评出分（权重表缺），评分那一块的档位为空",
    data: zzzPanelData(ZZZ_STORED, { uid: "1300000001" })
  },
  {
    name: "character/profile-list",
    label: "面板列表：绝区零那一路走同一张图，评分档位画在右上角",
    data: zzzPanelListData(
      [{ one: ZZZ_STORED, mark: ZZZ_MARK }, { one: ZZZ_BARE_WEAPON }],
      {
        game: "zzz",
        uid: "1300000001",
        avatars: {},
        profileAt: 1_767_225_600_000
      },
      {
        uid: "1300000001",
        // 带上排名角标：顶层 groupRank 为真时每格都要有角标
        rank: {
          allow: true,
          cfg: { time: "10-10 22:00", limitTxt: "无限制", number: 15 },
          ranks: { [ZZZ_STORED.id]: { rank: 1, rankType: "mark" } }
        }
      }
    )
  },
  {
    name: "character/rank-profile-list",
    label: "群排行：绝区零那一路走同一张图，音擎当武器、驱动盘套装当圣遗物套装",
    data: zzzRankListData(
      [
        { one: ZZZ_STORED, rank: 1, score: 88.5, mark: ZZZ_MARK },
        { one: ZZZ_BARE_WEAPON, rank: 2, score: 41.2 }
      ],
      {
        type: "crit",
        charName: ZZZ_STORED.zzz?.name ?? "安比",
        cfg: { time: "10-10 22:00", limitTxt: "无限制", number: 15 },
        note: "请求的那一维还没有数据，换成了双爆",
        // 不给装载器时音擎图标是空串、`<img>` 的 src 只剩元数据根路径（真渲染里看得见那个破图）
        meta: ZZZ_RANK_META
      }
    )
  },
  {
    name: "character/profile-stat",
    label: "练度统计：绝区零那一路走同一张图，技能等级与音擎从面板库并进来",
    data: panelStatData(
      {
        avatar_list: [
          { id: 1431, level: 60, name_mi18n: "叶瞬光", rarity: "S", rank: 2, element_type: 200, sub_element_type: 4 },
          // 这一位不在面板库里：技能等级与音擎都取不到，那一格只有名字与等级
          { id: 1021, level: 1, name_mi18n: "猫又", rarity: "S", rank: 0, element_type: 200 }
        ]
      },
      {
        uid: "1300000001",
        game: "zzz",
        name: "绳匠",
        marks: { "1431": { mark: "42.6", markClass: "SS" } },
        talents: { "1431": { normal: 9, special: 9, dodge: 7, chain: 9, core: 6, assist: 5 } },
        equips: { "1431": { name: "拘缚者", level: 60, star: 5, affix: 1 } },
        sets: {
          "1431": [
            { name: "折枝剑歌", own: 4, img: "meta-zzz/equip/imgs/折枝剑歌.webp" },
            { name: "云岿如我", own: 2, img: "meta-zzz/equip/imgs/云岿如我.webp" }
          ]
        }
      }
    )
  },
  {
    name: "user/uid-list",
    label: "三个游戏各一段，头像取自面板库；四种标记各出现一次",
    data: {
      ...buildUidList({
        gs: {
          // 首个带 CK 且走真机，次个只手工绑：两类标记与两种设备态同图可见
          uids: ["100000001", "100000002"],
          ckUids: ["100000001"],
          deviceUids: ["100000001"],
          info: {
            "100000001": {
              name: "旅行者",
              level: 60,
              face: "meta-gs/character/胡桃/imgs/face.webp",
              banner: "meta-gs/character/胡桃/imgs/banner.webp"
            }
          }
        },
        // 星铁那个刻意不给图：视图补的缺省一对同样要拼得出可用的路径。有 CK 而未绑真机 → 虚拟设备
        sr: { uids: ["101234567"], ckUids: ["101234567"] },
        zzz: { uids: ["1000000001"] }
      })
    }
  },
  {
    name: "wiki/character-talent",
    label: "天赋页：原神三个天赋加固有天赋",
    data: buildCharTalent(talentInput("gs"), "talent")
  },
  {
    name: "wiki/character-talent",
    label: "命座页：原神六个命之座",
    data: buildCharTalent(talentInput("gs"), "cons")
  },
  {
    name: "wiki/character-talent",
    label: "天赋页：星铁的占位符要代入数值，行迹另铺一块",
    data: buildCharTalent(talentInput("sr"), "talent")
  },
  {
    name: "wiki/character-talent",
    label: "技能页：绝区零五个分类加核心被动，逐级倍率在包里已算好",
    data: buildCharTalent(talentInput("zzz"), "talent")
  },
  {
    name: "wiki/character-talent",
    label: "意象影画：与命座共用一块，故事文案另一段",
    data: buildCharTalent(talentInput("zzz"), "cons")
  },
  {
    name: "wiki/character-wiki",
    label: "绝区零角色图鉴：身份 + 基础属性，无持有率那四块",
    data: buildCharWiki(talentInput("zzz"), { byName: () => undefined, byId: () => undefined })
  },
  {
    name: "wiki/weapon-wiki",
    label: "绝区零音擎图鉴：基础攻击 + 高级属性 + 叠影效果",
    data: buildWeaponWiki(
      {
        game: "zzz",
        name: "云霓孤光",
        star: 4,
        type: "强攻",
        gacha: "meta-zzz/weapon/强攻/云霓孤光/icon.webp",
        detail: {
          base: { name: "基础攻击力", value: 50 },
          sub: { name: "暴击伤害", value: 1920 },
          talents: { name: "玉魄冰心", desc: "开启帷幕后伤害提升<nobr>$1[i]%</nobr>。", tables: { "1": [25, 28.7, 32.5, 36.2, 40] } }
        }
      },
      { byName: () => undefined, byId: () => undefined }
    )
  },
  {
    name: "wiki/set-wiki",
    label: "驱动盘套装图鉴：2/4 件效果",
    data: buildSetWiki({
      game: "zzz",
      name: "沧浪行歌",
      mainImg: "meta-zzz/equip/imgs/沧浪行歌.webp",
      skills: { "2": "物理伤害+10%。", "4": "以太帷幕中暴击率提升10%。" },
      pieces: []
    })
  },
  {
    name: "wiki/set-wiki",
    label: "圣遗物套装图鉴：带部位小图",
    data: buildSetWiki({
      game: "gs",
      name: "深林的记忆",
      mainImg: "meta-gs/artifact/imgs/深林的记忆/1.webp",
      skills: { "2": "草元素抗性降低。", "4": "施放技能后降低敌人草抗。" },
      pieces: [{ name: "花", img: "meta-gs/artifact/imgs/深林的记忆/1.webp" }]
    })
  },
  {
    name: "wiki/bangboo-wiki",
    label: "邦布图鉴：属性 + 技能",
    data: buildBangbooWiki("企鹅布", 3, "meta-zzz/bangboo/imgs/企鹅布.webp", {
      attr: { hp_max: 360, attack: 50, crit: 500, crit_dmg: 5000 },
      skill: { name: "技能", desc: ["受击时回血。"] }
    })
  },
  // 「已抽」那条与查不到元数据的那一发都没有元数据图，模板要换插件自带的 no-avatar 占位
  { name: "gacha/gacha-detail", data: gachaDetailCase() }
]

describe("抽卡记录的占位头像", () => {
  it("「已抽」与查不到元数据的那一发换资源根下的 no-avatar —— 漏了即一格空洞，拼到元数据根则是碎图", () => {
    const html = template(join(TEMPLATES, "gacha/gacha-detail.html"), bridge.dress(gachaDetailCase(), { game: "gs" }))
    // 图作格子背景（`--av-fg`），武器图 4:3、用 img 铺方格会裁掉下半
    const srcs = [...html.matchAll(/<div class="cr-ic[^"]*" style="--av-fg:url\('([^']*)'\)"/g)].map(m => m[1] ?? "")
    // 三条：已抽 / 琴（无元数据）/ 胡桃
    expect(srcs).toHaveLength(3)
    const holder = `${pathToFileURL(join(ROOT, "resources")).href}/gacha/imgs/no-avatar.webp`
    expect(srcs.filter(s => s === holder)).toHaveLength(2)
    expect(srcs.some(s => s.endsWith("meta-gs/character/胡桃/imgs/face.webp"))).toBe(true)
    expect(existsSync(join(ROOT, "resources", "gacha", "imgs", "no-avatar.webp"))).toBe(true)
  })
})

describe("页脚署名", () => {
  it("两套布局都印内核与插件的名字和版本 —— 布局里漏 include 就是整张图没有署名、不报错", () => {
    const skin = template(join(TEMPLATES, "user/uid-list.html"), bridge.dress({ ...buildUidList({}) }, {}))
    const elem = template(
      join(TEMPLATES, "character/profile-detail.html"),
      bridge.dress(CASES.find(c => c.name === "character/profile-detail")?.data ?? {}, { game: "gs" })
    )
    for (const html of [skin, elem]) {
      expect(html).toContain('class="p-sign"')
      expect(html).toMatch(/Yunzai NG <span class="sg-ver">0\.7\.1<\/span>/)
      expect(html).toMatch(/mhy-game-plugin <span class="sg-ver">1\.0\.0<\/span>/)
      expect(html).toContain("common/skin/sign.css")
    }
  })
})

describe("复刻统计", () => {
  it("绝区零印频段名、不带五星音擎那期照样出图 —— weapon5 缺省时 `.length` 抛错、整张图退回文字", () => {
    const one = { version: "1.0", half: "上半", from: "2024-07-04 10:00:00", to: "2024-07-24 11:59:59", char5: ["艾莲"] }
    const pool = {
      versions: () => [one],
      mixVersions: () => [],
      poolName: () => "慵懒逐浪"
    } as unknown as PoolTable
    const data = bannerSingleData("艾莲", "char", { game: "zzz", pool, now: Date.parse("2024-08-01") })
    const html = template(join(TEMPLATES, "gacha/banner-single.html"), bridge.dress(data ?? {}, { game: "zzz" }))
    expect(html).toContain("独家频段：「慵懒逐浪」")
    expect(html).toContain("音擎频段")
    expect(html).not.toContain("跃迁")
  })
})

describe("活动日历的两个图根", () => {
  it("同一页里头像与属性角标走元数据根、奖励与类型图走资源根 —— 写死一个根就有一半碎图", () => {
    const html = template(join(TEMPLATES, "act-calendar.html"), bridge.dress(buildActCalendar(ZZZ_ACT, actCtx("zzz"))))
    const res = pathToFileURL(join(ROOT, "resources")).href
    expect(html).toContain(`${res}/zzz/act-calendar/菲林.png`)
    expect(html).toMatch(/src="[^"]*\/meta-zzz\/character\/common\/imgs\/ice\.webp"/)
    expect(html).toContain('class="av-rate rate-S">S</s>')
    expect(html).not.toContain(`${res}/meta-zzz/`)
    expect(html).toContain('class="skin-zzz')
    expect(html).not.toContain("http")
  })
})

describe("模板真渲染", () => {
  for (const { name, label, data } of CASES) {
    it(`${name}${label ? `（${label}）` : ""} 编译得出且没有取空的键`, () => {
      let html = ""
      // 按模板目录补发起命令的游戏：实例上 `gs/*` 由原神命令发起、走 skin-gs，不补则落盘的图全是中性皮
      const dir = name.split("/")[0] ?? ""
      const game = dir === "gs" || dir === "sr" || dir === "zzz" ? dir : undefined
      expect(() => {
        html = template(join(TEMPLATES, `${name}.html`), bridge.dress(data, game ? { game } : {}))
      }).not.toThrow()

      const dumpDir = process.env["MHY_DUMP_HTML"]
      if (dumpDir) {
        mkdirSync(dumpDir, { recursive: true })
        // 本地核对版式用：`MHY_DUMP_HTML=<目录>` 时把每张图的 HTML 落盘，再交给无头浏览器截图
        const idx = String(CASES.findIndex(c => c.name === name && c.label === label)).padStart(3, "0")
        writeFileSync(join(dumpDir, `${idx}-${name.replaceAll("/", "_")}.html`), html, "utf8")
      }
      expect(html.length).toBeGreaterThan(500)
      // 先剥注释：模板注释里本就写着"恒为 undefined"一类的说明，那不是错误
      const body = html.replace(/<!--[\s\S]*?-->/g, "")
      // 三条都对应"图出来了但内容是错的"：模板取了不存在的键、视图给了对象而模板按串印
      expect(body).not.toContain("undefined")
      expect(body).not.toContain("[object Object]")
      expect(body).not.toContain("{&quot;")
      expect(body).not.toMatch(/\bNaN\b|Infinity/)
    })
  }

  it("主角面板显示当前元素，并使用当前元素目录中的技能图", () => {
    const data = profileDetailData({ ...one, id: "10000007", name: "荧", elem: "cryo", talentCons: { e: 5, q: 3 } })
    const html = template(join(TEMPLATES, "character/profile-detail.html"), bridge.dress(data))
    expect(html).toContain('class="traveler-elem">冰元素</small>')
    expect(html).toContain("旅行者/cryo/icons/cons-5.webp")
    expect(html).not.toContain("荧/icons/")
  })

  it("缺图的额外技能不留元素框空壳，描述仍正常出图", () => {
    const html = template(join(TEMPLATES, "common/talent-detail.html"), [
      { name: "助战技", desc: ["<p>助战效果</p>"] },
      { _res_path: "", _meta_path: "", game: "sr", frame: "pyro" }
    ])
    expect(html).toMatch(/class="wk-tal\s+no-icon\s*"/)
    expect(html).not.toContain("is-framed")
    expect(html).not.toContain("wk-tal-ic")
    expect(html).toContain("助战效果")
  })

  it("伤害计算关着时面板照样出图 —— `dmgCalc` 缺省不存在", () => {
    // 无条件解构一个可选键会抛错，而那时使用者看到的是"这条命令永远只回文字"
    const data = bridge.dress(profileDetailData(one, { mode: "profile" }))
    expect(data["dmgCalc"]).toBeUndefined()
    expect(() => template(join(TEMPLATES, "character/profile-detail.html"), data)).not.toThrow()
  })

  it("属性栏那一列的名字由视图给 —— 模板里没有那张表", () => {
    const data = bridge.dress(profileDetailData(one, { mode: "profile" }))
    // 缺了它模板拿到 undefined，`{{each attrMap}}` 一行都不画：图照常出，而属性栏整栏空白
    expect(data["attrMap"]).toMatchObject({ hp: "生命值", mastery: "元素精通" })
    const html = template(join(TEMPLATES, "character/profile-detail.html"), data)
    expect(html).toContain("元素精通")
    expect(html).toContain("元素充能")
    // 星铁独有的那几项不该串到原神这张图上
    expect(html).not.toContain("击破特攻")
  })

  it("绝区零的技能页与另两个游戏共用这张模板 —— 分支写错的表现是那一整块不出现", () => {
    const html = template(
      join(TEMPLATES, "wiki/character-talent.html"),
      bridge.dress(buildCharTalent(talentInput("zzz"), "talent"))
    )

    // 五个技能分类走 `talent`、核心被动走 `passive`（与原神同一段），倍率表由包里逐级算好
    expect(html).toContain("普通攻击：伏特速攻")
    expect(html).toContain("一段伤害倍率")
    expect(html).toContain("核心被动：波动电压")
    // 技能只到 12 级；把 minLv / maxLv 传错会多出原神那几列
    expect(html).toContain("Lv12")
    expect(html).not.toContain("Lv13")
    // 基础数据那一栏走原神那一支（一维数组），标题另一句
    expect(html).toContain("60级基础数据")
    expect(html).toContain("能量自动回复")
    // 六张技能图标在 `character/common/imgs/` 下全游戏共用，键即分类键；模板漏传 icon 则六块各缺一张图
    expect(html).toContain("meta-zzz/character/common/imgs/talent-basic.webp")
    expect(html).toContain("meta-zzz/character/common/imgs/talent-chain.webp")
    expect(html).not.toContain("100级基础数据")
  })

  it("绝区零的意象影画与命座共用一块，故事文案另作一段", () => {
    const html = template(
      join(TEMPLATES, "wiki/character-talent.html"),
      bridge.dress(buildCharTalent(talentInput("zzz"), "cons"))
    )

    expect(html).toContain("快充模式")
    expect(html).toContain('class="story"')
    // 命座模式不画技能那几块
    expect(html).not.toContain("一段伤害倍率")
  })

  it("没有面板数据的角色卡片也出图", () => {
    const data = buildCharCard({ game: "gs", uid: "", name: "胡桃", star: 5, elem: "pyro" }) as unknown as Record<
      string,
      unknown
    >
    let html = ""
    expect(() => {
      html = template(join(TEMPLATES, "character/character-card.html"), bridge.dress(data))
    }).not.toThrow()
    expect(html).not.toContain("undefined")
  })

  it("角色列表：有面板的格子画武器与套装，没面板的那一行整块不画", () => {
    // `common/avatar-card.html` 无条件读 `weapon.star` 与 `artisSet.imgs`，故没有面板数据的
    // 角色必须走另一条分支 —— 否则那一格印的是 `starundefined` 与一个空盒子
    const data = avatarListData(
      {
        avatars: [
          { id: 10000046, name: "胡桃", level: 90, rarity: 5, actived_constellation_num: 2, element: "Pyro" },
          { id: 10000034, name: "班尼特", level: 80, rarity: 4, actived_constellation_num: 6, element: "Pyro" }
        ]
      },
      { game: "gs", uid: one.uid, name: "旅行者", panels: [one], now: one.at ?? 0 }
    )
    const html = template(join(TEMPLATES, "character/avatar-list.html"), bridge.dress(data))

    // 胡桃有面板：三格天赋、武器图与套装图都画得出
    expect(html).toContain("护摩之杖/icon.webp")
    expect(html).toContain("追忆之注连/1.webp")
    // 班尼特没有面板：改印那句话，且不出现一个星级为 0 的武器格
    expect(html).toContain("暂无天赋数据")
    expect(html).not.toContain("item-icon star0")
  })

  it("角色列表：星铁那一路不画探索度与宝箱两块", () => {
    const data = avatarListData(
      {
        stats: { active_days: 400, achievement_num: 600, chest_num: 2000 },
        avatar_list: [{ id: 1306, name: "花火", level: 80, rarity: 5, rank: 2, element: "quantum" }]
      },
      { game: "sr", uid: "101234567", name: "开拓者", now: one.at ?? 0 }
    )
    const html = template(join(TEMPLATES, "character/avatar-list.html"), bridge.dress(data))

    expect(html).toContain("skin-sr")
    // 两块各自判存在，故星铁那一路连分节标题都不该出现；
    // 「宝箱」二字在摘要格里另有一处（`statMap` 的标签），故钉分节标题而非裸文字
    expect(html).not.toContain("<h4>世界探索</h4>")
    expect(html).not.toContain("<h4>宝箱</h4>")
  })

  it("星铁那一套也编译得出 —— 行迹盘与光锥是另一条分支", () => {
    const sr = panel({
      game: "sr",
      id: "1201",
      name: "青雀",
      abbr: "青雀",
      elem: "雷",
      charWeapon: "智识",
      talent: { a: 6, e: 10, q: 10, t: 10 },
      trees: ["11201101", "11201201"],
      // 行迹小点的图标按它逐个替换，不给则十个点全画成同一张暴击率图
      tree: {
        "1201201": { key: "hp", value: 4 },
        "1201202": { key: "cdmg", value: 5.3 },
        "1201203": { key: "atk", value: 4 }
      },
      sets: { 生命的翁法罗斯: 4 },
      weapon: {
        name: "以世界之名",
        abbr: "以世界之名",
        level: 80,
        promote: 6,
        affix: 1,
        star: 5,
        img: "meta-sr/weapon/虚无/以世界之名/icon.webp",
        splash: "meta-sr/weapon/虚无/以世界之名/splash.webp",
        attrs: { hp: 1058, atk: 529, def: 396 },
        desc: { name: "以世界之名", desc: "使装备者的效果命中提高 <nobr>18%</nobr>" }
      },
      attr: {
        hp: 4000,
        atk: 2600,
        def: 1100,
        speed: 105,
        cpct: 70,
        cdmg: 150,
        recharge: 110,
        dmg: 40,
        effPct: 10,
        effDef: 0,
        heal: 0,
        stance: 0,
        elation: 0
      } as unknown as BuiltPanel["attr"],
      base: { hp: 1000, atk: 700, def: 460, speed: 100, cpct: 5, cdmg: 50, recharge: 100 }
    })
    let html = ""
    expect(() => {
      html = template(join(TEMPLATES, "character/profile-detail.html"), bridge.dress(profileDetailData(sr, { mode: "profile" })))
    }).not.toThrow()
    expect(html).not.toContain("undefined")
    expect(html).not.toContain("[object Object]")
    // 行迹小点按元数据换过图标：三个点各是各的，而不是十个点一张图
    expect(html).toContain("tree-hp.webp")
    expect(html).toContain("tree-cdmg.webp")
    expect(html).toContain("tree-atk.webp")
    // 光锥立绘走的是 `weapon.splash`，与原神的 `weapon.img` 不是同一个键
    expect(html).toContain("以世界之名/splash.webp")
    // 属性名从 panel/prop/sr 来，不在模板里；星铁独有的那几项要在
    expect(html).toContain("击破特攻")
    expect(html).toContain("效果抵抗")
    expect(html).toContain("欢愉度")
    // 原神那几项不该串到星铁这张图上
    expect(html).not.toContain("元素精通")
  })

  it("绝区零的面板走同一张图：音擎与驱动盘的图都来自元数据，不是外网地址", () => {
    const html = template(
      join(TEMPLATES, "character/profile-detail.html"),
      bridge.dress(zzzPanelData(ZZZ_STORED, { uid: "1300000001", mark: ZZZ_MARK }))
    )

    // 面板图一律走已装的元数据：混进 `http` 就是渲染时从外网取图，断网时留一片空白
    expect(html).not.toContain("act-webstatic")
    expect(html).not.toContain("http://")
    // 驱动盘套装图落在 equip/imgs/<套装名>.webp（不是旧的 equip/<套装名>/icon.webp）
    expect(html).toContain("meta-zzz/equip/imgs/")
    // 影画那一列用一套通用的编号徽章图（rank-zzz/<n>.png），随插件走而非元数据
    expect(html).toContain("character/imgs/rank-zzz/")
    // 六栏技能画圆图，且整排带 `six` 类 —— 少了它不报错，只是六个圆图溢出定宽容器、压到影画那行上
    expect(html).toContain("char-talents six")
    expect(html).toContain("meta-zzz/character/common/imgs/talent-basic.webp")
    // 「命」在绝区零叫「影」，词条名由 panel/prop/zzz 给
    expect(html).toContain("影</span>")
    expect(html).toContain("暴击率")
    expect(html).toContain("驱动盘总分")
  })

  it("音擎印出效果说明，且两格属性用短标题 —— 长标题会把数值挤到第二行", () => {
    const data = zzzPanelData(ZZZ_STORED, { uid: "1300000001", mark: ZZZ_MARK, meta: ZZZ_META })
    const html = template(join(TEMPLATES, "character/profile-detail.html"), bridge.dress(data))

    // 占位符按叠影档代入（夹具是叠影 1，取 tables[1][0]）：取错档不报错，只是图上的加成数值与游戏内不一致
    expect(html).toContain("装备者的暴击伤害提升")
    expect(html).toContain("25%")
    expect(html).not.toContain("50%")
    // 代入没做成的表现是把 `$1[i]` 原样印在图上
    expect(html).not.toContain("$1[i]")

    // 不走 `artisKeyTitle`：那张表的 `atk` 是「基础攻击力」，五个字加数值挤不进半格宽，数值会换行
    const weapon = (data["data"] as Record<string, unknown>)["weapon"] as Record<string, unknown>
    const list = weapon["attrList"] as { title: string; value: string }[]
    expect(list.map(it => it.title)).toEqual(["攻击力", "暴击伤害"])
    // 先剥注释再查：模板里那句说明本就写着「基础攻击力」（见 line 1324 同一处置）
    expect(html.replace(/<!--[\s\S]*?-->/g, "")).not.toContain("基础攻击力")
  })

  it("「叠影档 → 整句」那种形态照样印得出 —— 只认一种会让另一种整块空白", () => {
    const legacy = {
      ...ZZZ_META,
      /**
       * 读整份 data.json，给的是逐档整句那种形态
       * @param _game 游戏
       * @param id 物品 id
       * @returns 整份数据；不是那把音擎时 undefined
       */
      detail(_game: string, id: string | number) {
        if (String(id) !== "14143") return undefined
        return { talents: { "1": { name: "孤光", desc: ["装备者的暴击伤害提升<nobr>25%</nobr>。"] } } }
      }
    } as unknown as MetaLoader
    const html = template(
      join(TEMPLATES, "character/profile-detail.html"),
      bridge.dress(zzzPanelData(ZZZ_STORED, { uid: "1300000001", mark: ZZZ_MARK, meta: legacy }))
    )

    expect(html).toContain("装备者的暴击伤害提升")
    expect(html).toContain("25%")
  })

  it("没装元数据时音擎那一块不印字面的 undefined", () => {
    const html = template(
      join(TEMPLATES, "character/profile-detail.html"),
      bridge.dress(zzzPanelData(ZZZ_STORED, { uid: "1300000001" }))
    )

    expect(html).toContain("云霓孤光")
    expect(html).not.toContain("undefined")
  })

  it("属性栏固定十二行，六种属性伤害加成并成一行「属性伤害加成」", () => {
    const html = template(
      join(TEMPLATES, "character/profile-detail.html"),
      bridge.dress(zzzPanelData(ZZZ_STORED, { uid: "1300000001", mark: ZZZ_MARK }))
    )

    for (const one of ["生命值", "攻击力", "防御力", "冲击力", "暴击率", "暴击伤害", "异常掌控", "异常精通", "穿透率", "能量自动回复", "穿透值"]) {
      expect(html).toContain(one)
    }
    // 一个代理人只有一种属性，逐种各占一行会有五行恒为 0，而属性栏容器定高、多出的行会溢出
    expect(html).toContain("属性伤害加成")
    expect(html).not.toContain("物理伤害加成")
    expect(html).not.toContain("冰属性伤害加成")
    expect(html).not.toContain("以太伤害加成")
    // 只有流明属性的代理人才有这两项，不该出现在物理代理人的属性栏上
    expect(html).not.toContain("贯穿力")
    expect(html).not.toContain("闪能自动累积")
    // 那一行的值取该代理人自己那一种（夹具是物理，故取 dmgPhy 的 40.0%）
    expect(html).toContain("40.0%")
  })

  it("属性伤害加成那一格的图标按代理人的属性换，靠 bodyClass 上的属性类名", () => {
    const phy = zzzPanelData(ZZZ_STORED, { uid: "1300000001" })
    expect(phy["bodyClass"]).toContain("zzz-elem-phy")

    const iceOne: StoredAvatar = {
      ...ZZZ_STORED,
      zzz: {
        ...(ZZZ_STORED.zzz as ZzzAvatarDetail),
        elemId: 202,
        attrs: [
          { key: "atk", name: "攻击力", final: "2760" },
          { key: "dmgIce", name: "冰属性伤害加成", final: "38.5%" }
        ]
      }
    }
    const ice = zzzPanelData(iceOne, { uid: "1300000001" })
    expect(ice["bodyClass"]).toContain("zzz-elem-ice")
    // 并成的那一行取的是冰伤，而不是恒取物理
    expect((ice["attr"] as Record<string, string>)["dmgElem"]).toBe("38.5%")
  })

  it("绝区零的面板列表同样是那张图，评分档位画在右上角", () => {
    const html = template(
      join(TEMPLATES, "character/profile-list.html"),
      bridge.dress(
        zzzPanelListData([{ one: ZZZ_STORED, mark: ZZZ_MARK }], {
          game: "zzz",
          uid: "1300000001",
          avatars: {},
          profileAt: 1_767_225_600_000
        })
      )
    )

    // 评分档位那一格：类名随皮肤改过，钉住的是「档位印出来了」
    expect(html).toContain("av-rate")
    expect(html).toContain(ZZZ_MARK.markClass)
    expect(html).toContain("meta-zzz/character/")
    // 前缀随游戏变：绝区零那一路是 `%`，照抄图上那句才有回应
    expect(html).toContain("%叶瞬光面板")
    // 伤害与圣遗物那两条命令对绝区零不成立，故那两句提示不该印出来。
    // 按整句比对而非只认「圣遗物」三字：img-fallback.html 的文件头注释里也有那三字，
    // 而 art-template 把注释原样输出，只认三字会恒失败
    expect(html).not.toContain("圣遗物 看评分")
    expect(html).not.toContain("伤害 算伤害")
  })

  it("练度统计绝区零：技能列换成六个，圣遗物那栏与原神星铁同一套 —— 四件套 + 二件套两枚图排一个菱形格", () => {
    const view = panelStatData(
      { avatar_list: [{ id: 1431, level: 60, name_mi18n: "叶瞬光", rarity: "S", rank: 2, element_type: 200 }] },
      {
        uid: "1300000001",
        game: "zzz",
        name: "绳匠",
        marks: { "1431": { mark: "42.6", markClass: "SS" } },
        talents: { "1431": { normal: 9, special: 9, dodge: 7, chain: 9, core: 6, assist: 5 } },
        equips: { "1431": { name: "拘缚者", level: 60, star: 5, affix: 1 } },
        sets: {
          "1431": [
            { name: "折枝剑歌", own: 4, img: "meta-zzz/equip/imgs/折枝剑歌.webp" },
            { name: "云岿如我", own: 2, img: "meta-zzz/equip/imgs/云岿如我.webp" }
          ]
        }
      }
    )
    const html = template(join(TEMPLATES, "character/profile-stat.html"), bridge.dress(view))

    // 表头是绝区零那六个技能，而不是原神的 A/E/Q
    for (const h of ["普", "特", "闪", "连", "核", "支"]) expect(html).toContain(`<span>${h}</span>`)
    expect(html).not.toContain("<b>A</b>")
    // 命中的套装：两枚图排在同一格里（四件套在前、二件套在后），与原神星铁同一套写法
    expect(html).toContain("meta-zzz/equip/imgs/折枝剑歌.webp")
    expect(html).toContain("meta-zzz/equip/imgs/云岿如我.webp")
    // 两套叠在同一格（`.cr-ic.duo` 对角排），而非并排两格
    expect(html).toContain("cr-ic r5 duo")
    expect(html).not.toContain("zzz-artis")
  })
})
