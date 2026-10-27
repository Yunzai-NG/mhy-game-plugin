# mhy-game-plugin

Yunzai NG 的米哈游游戏插件：原神 / 星穹铁道 / 绝区零。米游社接口、Cookie 池与设备管理，
加上体力、深渊与各类挑战、札记、抽卡记录、角色面板与排行、图鉴与日历等查询。

本仓库是 [Yunzai NG](https://github.com/Yunzai-NG/yunzai-ng) 的官方可选插件，不随内核分发，需要内核 0.7.0 及以上。
各版本的变更见 [CHANGELOG.md](CHANGELOG.md)。
插件名 `mhy-game`（目录名 `mhy-game-plugin`，配置文件 `config/mhy-game.yaml`，也可在面板的设置表单里改）。

## 安装

推荐经面板的插件市场安装：面板 → 插件市场 → 搜索 `mhy-game-plugin` → 安装。

亦可手工克隆至主目录的 `plugins/` 下：

```powershell
cd <主目录>\plugins
git clone https://github.com/Yunzai-NG/mhy-game-plugin.git
cd mhy-game-plugin
pnpm install
pnpm run build
```

插件目录里**不要另装 `@yunzai-ng/core`**：那会遮蔽宿主那一份，表现是命令照常触发而每一项配置都读成 undefined。

### 渲染器

查询结果默认以图片回复，应先装 [renderer-puppeteer](https://github.com/Yunzai-NG/renderer-puppeteer)
（或其他渲染器插件）。渲染器不可用或出图失败时退回文字回复，命令本身不会因此失败。

### 元数据

角色与武器的图标、简称、图鉴文案、面板计算用的曲线都来自元数据，三个游戏合计约 350MB。
装好插件后由主人发 `#更新元数据` 手动安装，落在 `data/plugin/mhy-game/meta/` 下。

- `autoInstallMeta`：启动时自动下载，缺省关。
- `enableMetaAutoUpdate`：定时取增量包，只更新已装过的那一份，缺省关。
- 没装元数据时，依赖它的命令会明说「先发 #更新元数据」，而不是出一张全是 0 的图。

## 命令

三个游戏共用一套命令，前缀决定游戏：`#` 原神、`*`（或 `#星铁`）星穹铁道、`%`（或 `#绝区零`）绝区零。

在机器人里发 `#帮助` / `*帮助` / `%帮助`：只列当前游戏、当前配置下真能用的命令，群管理与主人另多一块。
更细的有 `#绑定帮助`、`#CK帮助`、`#面板帮助`、`#排行帮助`、`#抽卡帮助`、`#攻略帮助`。

完整的命令表与配置项见文档站（源码在本仓库的 docs 分支）：[命令一览](https://github.com/Yunzai-NG/mhy-game-plugin/blob/docs/reference/commands.md) · [配置项](https://github.com/Yunzai-NG/mhy-game-plugin/blob/docs/reference/config.md)。

## 账号与隐私

- **CK 只给本人用**：查 uid X 时只用发起者本人绑定、且覆盖 X 的那份 CK。不回落到本人的其他 CK，
  也没有公共池。米游社的战绩接口不校验 CK 与 uid 的归属，这条规则是防止越权读他人数据的唯一一道闸。
- 只绑 uid（不给凭据）也能查公开数据；体力、札记、抽卡记录一类私有数据要本人的 CK。
- 绑 CK、扫码登录、发抽卡链接只在私聊受理。日志里不出现 Cookie、stoken、authkey 与设备指纹。
- 抽卡记录按「使用者 + uid」分开存，绑了别人的 uid 也看不到他的抽卡历史。

## 缺省关闭的功能

插件主动写入、在使用者不知情时发请求、或引用第三方来源的功能一律缺省关闭，由部署者自行决定：

| 配置项 | 作用 | 为什么缺省关 |
| --- | --- | --- |
| `enableDmgCalc` | 面板显示伤害期望，`#胡桃伤害` 看词条收益 | 伤害公式是元数据里的 `calc.js`，开启即执行下载来的代码（在 `node:vm` 中求值，但那不是硬安全边界）。公式文件恒随元数据落盘，关着时只被解析、不执行 |
| `enableAutoSign` | 每日自动签到 | 唯一一项代替使用者写入的功能；另有每人一道「#自动签到」开关，两道都开才执行 |
| `enableStaminaRemind` | 体力过阈值时主动推送便笺 | 会在使用者不知情时发请求、主动发消息 |
| `enableWikiStat` | 图鉴多出持有率、常用武器等四块 | 只有第三方来源（提瓦特小助手、ArkApi） |
| `enableCalendarFix` | 日历时间表用 miao.games 的人工校对版覆盖 | 第三方来源 |
| `autoInstallMeta` / `enableMetaAutoUpdate` | 自动下载 / 定时更新元数据 | 首次约 350MB，下载时机由主人决定 |

另外几处会访问米哈游之外的服务，且缺省开着：面板的展柜源（Enka、MiniGG 等，见 `profileServer`
一族）、展柜头像镜像（`pfpsHost` / `assetHost`）、角色攻略（`enableCharStrategy`，取自 gitee）。
请求里不带 Cookie；不需要时可在配置里关掉或换成自建镜像。

## 开发

本插件依赖 `@yunzai-ng/core` 与 `@yunzai-ng/types`，两者声明为 `peerDependencies`
（运行期由宿主内核提供）。**框架发布至 npm 之前**，需先链接本地框架 checkout：

```powershell
git clone https://github.com/Yunzai-NG/yunzai-ng.git
cd yunzai-ng
pnpm install
pnpm run build          # 必需：本插件的 tsc 读取框架的 dist/*.d.ts

cd ..\mhy-game-plugin
pnpm install
# 把框架的 packages/core、types、jsx 链到 node_modules/@yunzai-ng/ 下（Windows 用 junction）
pnpm run verify         # build → typecheck:test → lint → test
```

框架发布到 npm 之后链接这一步不再必需。

- `pnpm run verify` 依次跑 `tsc -b`、测试的类型检查、`eslint .`（零告警）、`vitest run`。
  有 17 项 skip 属正常：那几组要一份真实的元数据目录（环境变量 `MHY_REAL_META`）。
- 改过文件名或搬过目录后跑 `tsc -b --force`：`tsc -b` 不删旧产物。
- 目录分法与帮助怎么维护见文档站源码（[docs 分支](https://github.com/Yunzai-NG/mhy-game-plugin/tree/docs)）的「开发与贡献」。

### 模板约定

注释里「见 `xxx`」引的就是下面这几条。它们写错的共同表现是**不报错**：图上一格空白、整块消失，或整张图退回文字。

- **`template-img-two-roots`**：图有两个根。插件资源 `resources/` 用 `_res_path`，运行时下载的元数据 `dataDir/meta/` 用 `_meta_path`。元数据路径一律以 `meta-<游戏>/` 开头，模板按 `ico.indexOf('meta-') === 0` 选根。米游社给的完整 `https://` 地址一处根都不加。同一张表里混着两种根时，不能写死其中一个前缀。
- **`official-api-is-data-only`**：米游社接口只取数据，图一张都不从它取，全部走已装的元数据。`panel/serv/zzz.test.ts` 断言映射结果里没有 `act-webstatic`，`render.test.ts` 断言出图结果里没有 `http://`。例外只有两处，都直接用 https 地址：一是 `#信息` 的页头背景 —— 星铁绝区零是玩家自选的壁纸 / 名片（`index` 给），原神是战绩页文案表的 `header_bg`，元数据里都没有，取不到时退回皮肤自己的页头；二是绝区零 `#活动日历` 的调频格子，元数据查不到这位代理人 / 这件音擎（正式服已开、元数据未跟上）时才用接口给的图。
- **`art-template-each-needs-set`**：`{{each [1,2,3] i}}` 会静默渲染成空，数组字面量要先 `{{set list = [...]}}` 再遍历。`{{set}}` 里对象字面量的 `}` 与 `}}` 之间要留一个空格。
- **`art-template-shadows-globals`**：`{{ }}` 与 `<% %>` 里不认识的标识符会被当成数据字段，于是 `String(x)` 变成 `undefined(x)`。`String / Number / Boolean / Object / Array / Math / JSON / Date / RegExp` 都不能用，转字符串写 `'' + (x || '')`。`templates.test.ts` 会扫 `{{ }}`，`<% %>` 只有真渲染测试抓得到。
- **`template-scale-lives-in-css`**：基准倍率写在各模板 css 的 `body{transform:scale(N)}` 里，行内的 `sys.scale` 会压掉它，图就变小发糊。没有额外倍率时 `scaleStyle` 输出空串，全局精度用 `zoom`。改清晰度只改那张图的 css，不要在命令层传倍率。

## 许可

AGPL-3.0-or-later
