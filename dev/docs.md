# 维护本站

本站不在插件代码里：它是同一远端仓库的 `docs` 分支，VitePress 源码，全部页面手写、没有生成步骤。

## 本地预览

```powershell
git clone -b docs https://github.com/Yunzai-NG/mhy-game-plugin.git docs
cd docs
pnpm install
pnpm run dev
```

推到 `docs` 分支后，由该分支的 `.github/workflows/deploy.yml` 构建并发布到 GitHub Pages。站点路径由 Pages 设置决定（`DOCS_BASE`），不在页面里写死网址。

## 插件改了什么，站点改哪里

| 插件里改了 | 本站要改 |
| --- | --- |
| `catalog.ts` 的目录、命令表里的触发词 | [命令一览](../reference/commands) 与对应的使用指南页 |
| `config.ts` 的配置项、缺省值或说明 | [配置项](../reference/config)，含页末的完整示例；涉及缺省关的项另改 [缺省关闭的功能](../deploy/privacy) |
| 细分帮助（`views/guide*.ts`） | 对应的使用指南页 |
| 命令层结构、服务、对外接口 | 本分册对应的那一页 |
| 某张图的版式、某条命令的回复话术 | 重出那几张截图，改对话里抄的那句话 |

改完 `pnpm run build`。死链会让构建失败；页内锚点（`#xxx`）VitePress 不查，改了标题要自己搜一遍引用它的链接。

## 写法

- **写给谁**：使用指南写给机器人的使用者，部署写给主人，开发者指南写给改代码的人。同一件事在三处的说法可以不同，事实必须一致。
- **以源码为准**：命令的写法、缺省值、话术都先在源码里确认，不凭印象写。
- 例子一律用原神的 `#`，三个游戏写法不同时分开列。

### 组件与标记

| 写法 | 效果 |
| --- | --- |
| `<span class="g gs">原神</span>` | 游戏标记；`sr` 星铁、`zzz` 绝区零 |
| `<Badge type="warning" text="私聊" />` | 私聊；`danger` 主人、`info` 群管理、`tip` 需开启 |
| `<LinkCards :items="[...]" />` | 卡片式链接，每项 `{ icon, title, desc, link }` |
| `<QQChat :msgs="[...]" />` | 模拟 QQ 对话，加 `group` 即群聊；每条见下 |
| `::: tip` / `::: warning` / `::: danger` | 提示块 |
| `::: code-group` | 三个游戏的写法并排切换 |

图标名见 `.vitepress/theme/components/icons.ts`。

### 对话

```md
<QQChat :msgs="[
  { me: true, text: '#胡桃面板' },
  { img: 'panel/detail', alt: '胡桃的面板' },
  { text: '第一行\n第二行' }
]" />
```

| 字段 | 作用 |
| --- | --- |
| `me` | 自己发的，在右；不给即机器人，在左 |
| `text` | 文字，`\n` 换行 |
| `img` | `public/shots/` 下的图，不带后缀；点开看原图，长图在气泡里只露上半截 |
| `alt` | 图的说明，读屏与放大层用，有图就写 |
| `file` | 发的是一个文件，写文件名 |
| `name` / `tag` | 群聊里的名字与小标签（「主人」「群管理」） |
| `tip` | 居中的灰色小字 |

整段写在一行一个对象里、中间不留空行：markdown 遇到空行会把组件截断。字符串用单引号，外层属性用双引号。

### 截图

`public/shots/` 下的图都是插件对演示数据真出的图：跑插件自己的命令与模板，米游社接口由手写的应答代替，uid、昵称、Cookie 与练度都是编的，出图时不连外网。图的宽高记在 `.vitepress/theme/shots.json`，对话组件据此先占位。

- **不要放真实账号出的图**，哪怕裁掉 uid：立绘、练度与抽卡记录合在一起足以认出是谁。
- 回复的文字照插件真回的那句抄，不要自己改写；插件改了话术，这里一起改。
- 一张图没有页面引用就删掉，连同 `shots.json` 里那一条。

## 主题

主题与 Yunzai NG 主站同一套：南瓜橙与天蓝、侧栏只展开当前组、标题下一行更新日期与字数、右下角回到顶部。本站自己加的只有 `style.css` 文末那一节（三个游戏的标记色与命令表的样式）与对话组件 `QQChat.vue`。

`theme/components/Sidebar.vue` 照抄了 VitePress 1.6.4 的 `VPSidebar`，升级 vitepress 时对一下原文件。
