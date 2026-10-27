# 整体结构

## 五层

一条 `#体力` 从进来到出图，依次经过这几层：

```text
消息 ──► commands/ ──► service/ ──► core/client ──► 米游社
            │              │
            │              └──► store/（KV 里的 CK、uid、设备、面板……）
            │
            └──► views/（纯函数整形）──► templates/（art-template）──► 渲染器 ──► 图
```

| 目录 | 管什么 | 不管什么 |
| --- | --- | --- |
| `src/commands/` | 认消息、取参数、调服务、选模板、出图失败时退回文字 | 不拼请求、不选 CK、不算数据 |
| `src/service/` | 一件完整的事：查询链、签到、体力提醒、攻略取图 | 不认消息形态 |
| `src/core/` | 米游社请求、签名、设备、区服判定、渲染桥、会话 | 无业务 |
| `src/store/` | 落库：CK、uid、设备、面板、排行、抽卡记录 | 不发请求 |
| `src/views/` | 把接口返回整形成模板要的形状，另给一份文字版 | 无 IO，全是纯函数 |
| `src/meta/` `src/panel/` | 元数据装载、面板装配、评分与伤害 | 不认消息 |

命令层不碰 `MessageEvent`，只认 `Session`；不碰 `ctx`，只认依赖包 `MhyDeps`。所以每条命令都能在单元测试里直接驱动，不必起内核、适配器与消息段。

## 入口

`src/index.ts` 的 `setup` 只执行一次，做三件事：

1. 造各个存储与服务（CK 池、设备、查询服务、元数据、面板源……），组成 `MhyDeps`
2. 经 `ctx.provide` 把其中八个对外提供，见 [对外服务](./services)
3. 把命令表注册进内核，挂上定时任务（元数据更新、自动签到、体力提醒）

配置不在 `setup` 里取值，而是以函数 `deps.config()` 传下去，每次现读。面板上改完的开关即时生效，缓存快照会变成「改了要重启」。

## 一次查询

以 `#体力` 为例：

| 步骤 | 在哪 | 做什么 |
| --- | --- | --- |
| 1 | `commands/index.ts` 的前缀中间件 | 认出游戏前缀（`#` / `*` / `%`），规整成 `Session.game` |
| 2 | 命令表 | 按触发词找到 `体力` 那一条，判功能开关，调 `noteOrRemind` |
| 3 | `commands/note.ts` | `deps.mys.query("dailyNote", { user, game })` |
| 4 | `service/mys.ts` | 取当前 uid → 选本人覆盖该 uid 的 CK → 发请求 → 按 retcode 归类 |
| 5 | `core/client.ts` | 拼接口表、算 DS、加设备请求头与指纹 |
| 6 | `views/note.ts` | 接口原始字段整形成模板数据 |
| 7 | `Session.image` | 经渲染器出图；失败返回 false，命令改发 `noteText` 文字版 |

第 4 步的规则只在 `service/mys.ts` 写一遍，命令不得自己重复。

## 数据放在哪

| 位置 | 内容 |
| --- | --- |
| 框架 KV（`ctx.kv`） | CK、uid 绑定、设备、面板、排行、签到与提醒状态；键前缀 `plugin:mhy-game:` |
| `dataDir/meta/` | 元数据，三个游戏约 350MB |
| `dataDir/gacha/` | 抽卡记录存档 |
| `dataDir/panel-img/` | 上传的面板图；放在 `dataDir` 而不是 `resources/`，插件更新不会冲掉 |
| `dataDir/face/` `strategy/` `material-img/` | 头像、攻略图与素材图缓存 |

`dataDir` 即实例的 `data/plugin/mhy-game/`。

## 按游戏分目录

三个游戏都有的功能共用一套代码；只有一个游戏有的，放进 `gs` / `sr` / `zzz` 子目录，文件名不带游戏名：

```text
src/commands/zzz/buddy.ts      %邦布
src/views/zzz/buddy.ts         它的视图
templates/zzz/buddy.html       它的模板
```

子目录各有一个 `index.ts` 汇总导出，外面只从那里引，不逐文件深引。`resources/` 与 `templates/` 是同一分法：`common/` 三游戏共用，`gs` / `sr` / `zzz` 单游戏专属，`character` / `gacha` / `wiki` / `user` 是三游戏共用的功能族。不要再开按来源起名的目录。
