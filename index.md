---
layout: home

hero:
  name: mhy-game
  text: 米哈游游戏插件
  tagline: Yunzai NG 的官方可选插件 · 原神 / 星穹铁道 / 绝区零
  actions:
    - theme: brand
      text: 快速上手
      link: /guide/start
    - theme: alt
      text: 命令一览
      link: /reference/commands
    - theme: alt
      text: 部署
      link: /deploy/

features:
  - title: 三个游戏一套命令
    details: 前缀决定游戏：原神「#」、星穹铁道「*」、绝区零「%」。体力、札记、深渊与各类战绩都是同一种写法。
    link: /guide/daily
    linkText: 日常与战绩
  - title: 角色面板与群排行
    details: 展柜或米游社取数，属性、评分、换装试算，按伤害、评分、双爆、词条四个维度排本群的榜。
    link: /guide/panel
    linkText: 角色面板
  - title: 抽卡记录
    details: 扫码登录后一键更新，出金时间轴、按版本统计与复刻间隔，支持 UIGF v4.0 / v2.3 与 SRGF 导入导出。
    link: /guide/gacha
    linkText: 抽卡记录
  - title: CK 只给本人用
    details: 查一个 uid 只用发起者本人绑定、且覆盖它的那份 CK，没有公共池、不回落，绑了别人的 uid 也读不到他的数据。
    link: /guide/account#ck-只给本人用
    linkText: 绑定账号
  - title: 会主动做事的都缺省关
    details: 自动签到、体力提醒、执行伤害公式、第三方统计与自动下载元数据，一律由部署者自己决定开不开。
    link: /deploy/privacy
    linkText: 缺省关闭的功能
  - title: 只列真能用的命令
    details: 机器人里的「#帮助」按当前游戏、身份与配置出图，主人关掉的功能不会出现在上面。
    link: /reference/commands
    linkText: 命令一览
---

## 三个游戏怎么区分

同一条命令换个前缀就是另一个游戏：

| 游戏 | 前缀 | 例子 |
| --- | --- | --- |
| 原神 | `#` | `#体力` `#胡桃面板` |
| 星穹铁道 | `*`，或 `#星铁` | `*体力` `#星铁青雀面板` |
| 绝区零 | `%`，或 `#绝区零` | `%体力` `#绝区零安比面板` |

第一次用，照 [快速上手](./guide/start) 走三步：扫码登录、更新面板、查一次体力。
