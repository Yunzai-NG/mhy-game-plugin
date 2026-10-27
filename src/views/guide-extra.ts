/**
 * 模块职责：`#排行帮助` 与 `#绑定帮助` 两张细分帮助
 * 依赖方向：依赖 views/guide 的外壳与 core/region 的游戏常量；纯函数
 * 生命周期：无状态
 * 注意事项：绑定那张要讲清**只绑 uid 能查什么**：按 CK 归属规则，战绩、便笺一类米游社接口只能用本人绑定且覆盖
 *          那个 uid 的 CK 去查，故只绑 uid 时这些一律查不了；能用的只剩展柜面板、抽卡链接与图鉴。
 *          写成「只绑 uid 能查公开数据」会让人绑完就去查深渊，然后被拒。
 *          排行那张要讲清不带关键词问的是伤害维，不是评分维（"为什么我分高却不是第一"）。
 */
import type { GameKey } from "../core/region.js"
import { DEMO_CHARS, GAME_NAMES, GEAR_NAMES, SHORT_PREFIX } from "../core/region.js"
import type { GuideView } from "./guide.js"
import { guideShell } from "./guide.js"

/**
 * 造「群排行」的分步指引
 * @param game 当前游戏
 * @returns 指引视图
 */
export function buildRankGuide(game: GameKey = "gs"): GuideView {
  const p = SHORT_PREFIX[game]
  const demo = DEMO_CHARS[game]
  const gear = GEAR_NAMES[game]
  const who = game === "zzz" ? "代理人" : "角色"
  return guideShell(game, "排行帮助", "四个维度与入榜方式", [
    {
      name: "四个维度",
      intro: `不带关键词时问的是综合练度（期望伤害），不是${gear}评分`,
      steps: [
        { title: "综合练度", desc: `按这位${who}的期望伤害排，要主人开启「开启伤害计算」`, cmd: `${p}${demo}排行` },
        { title: `${gear}评分`, desc: `按${gear}总评分排`, cmd: `${p}${demo}评分排行` },
        { title: "双爆副词条", desc: "只数副词条里的双爆，暴击率按两倍计", cmd: `${p}${demo}双爆排行` },
        { title: "加权有效词条", desc: `逐条副词条按这位${who}的权重折算后累加`, cmd: `${p}${demo}词条排行` }
      ]
    },
    {
      name: "怎么入榜",
      intro: "排行随每次查看逐步累积，不是全量扫库",
      steps: [
        { title: "先更新面板", desc: "取一次面板数据并入库", cmd: `${p}更新面板` },
        { title: "再看一次面板", desc: "看过谁的面板谁才进榜；看列表一次交齐全部", cmd: `${p}面板` },
        { title: "补齐缺的维度", desc: "按库里已有的面板重算本群（群管理）", cmd: `${p}刷新排名` }
      ]
    },
    {
      name: "怎么看",
      intro: "整条榜与榜一",
      steps: [
        { title: "整条榜", desc: "默认列前 15 名，名额由主人配置", cmd: `${p}${demo}排行` },
        { title: "榜一的面板", desc: "直接出那一位的面板，维度关键词同上", cmd: `${p}最强${demo}面板` },
        { title: "群管理可关", desc: "关掉后本群不再记分、也查不了", cmd: `${p}关闭排名` }
      ]
    }
  ], [
    "排行按群统计，私聊里没有排行",
    "请求的那一维还没有数据时会换一维，并在图上说明",
    ...(game === "zzz" ? [] : ["预设面板（uid 小于 100000006）不参与排名"])
  ])
}

/**
 * 造「绑定」的分步指引
 * @param game 当前游戏
 * @returns 指引视图
 */
export function buildBindGuide(game: GameKey = "gs"): GuideView {
  const p = SHORT_PREFIX[game]
  return guideShell(game, "绑定帮助", "uid、CK 与设备", [
    {
      name: "先分清 uid 与 CK",
      intro: "要查的东西决定你需要哪个",
      steps: [
        { title: "扫码最省事", desc: "一步取齐 CK 与 stoken，CK 过期能自己换新；群里也能扫，认准是自己的码", cmd: `${p}扫码登录` },
        { title: "或者手动绑 CK", desc: "CK 是你的凭据，只在私聊里发；取法见「CK帮助」", cmd: `${p}绑定CK` },
        { title: "只绑 uid", desc: "不给凭据，只能看展柜面板、贴抽卡链接与查图鉴；战绩、便笺要 CK", cmd: `${p}绑定uid100000001` }
      ]
    },
    {
      name: "多个 uid",
      intro: "一个人可以绑好几个，查询用当前那一个",
      steps: [
        { title: "看都绑了什么", desc: "当前那个有标记", cmd: `${p}我的uid` },
        { title: "切换", desc: "按上一条列出的序号切，也可「uid2」", cmd: `${p}切换uid2` },
        { title: "删掉", desc: "不带序号删当前那个", cmd: `${p}删除uid2` }
      ]
    },
    {
      name: "凭据",
      intro: "CK 出问题了",
      steps: [
        { title: "CK 失效了", desc: "凭 stoken 换一份新的，扫码登录过才有 stoken", cmd: `${p}刷新ck` },
        { title: "看凭据状态", desc: "状态与对应 uid，不印凭据本身", cmd: `${p}我的CK` },
        { title: "不想用了", desc: "删掉自己的 CK，uid 不受影响", cmd: `${p}删除CK` }
      ]
    },
    {
      name: "设备",
      intro: "一般不用管；常撞验证码时可换成自己手机的设备",
      steps: [
        { title: "看当前设备", desc: "请求用的是系统分配的还是你绑的真机", cmd: `${p}设备信息` },
        { title: "绑真机", desc: "私聊提交手机上的设备信息，之后请求都用它", cmd: `${p}绑定设备` },
        { title: "解绑真机", desc: "回到系统分配的那台", cmd: `${p}解绑设备` }
      ]
    }
  ], [
    "绑 CK 与绑真机只在私聊受理 —— 群里发等于把凭据公开给所有人",
    "查一个 uid 只用你自己绑的、且覆盖那个 uid 的 CK；绑了别人的 uid 也查不到他的私有数据",
    `三个游戏共用一份绑定，只是记号不同：${GAME_NAMES.gs}「#」、${GAME_NAMES.sr}「*」、${GAME_NAMES.zzz}「%」`
  ])
}
