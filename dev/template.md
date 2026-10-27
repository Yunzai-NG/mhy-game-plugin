# 视图与模板

出图分两步：`src/views/` 里的纯函数把接口返回整形成模板要的形状，`templates/` 里的 art-template 模板把它画出来。查询逻辑与长什么样分开，改版式不必碰请求代码。

## 视图

```ts
export function buddyTemplateData(raw: BuddyRaw, ctx: BuddyContext): TemplateData
export function buddyText(data: TemplateData): string
```

- **纯函数**：不发请求、不读盘、不取当前时间。要「现在」就由命令层传进来，测试才钉得住。
- **每张图配一份文字版**。没装渲染器、渲染失败时命令发这一份，命令本身不失败。
- 图标路径在视图里排好，模板只管拼前缀，见下文「图的两个根」。
- 只用到接口返回的哪几个字段，就在 `Raw` 类型里只声明那几个，并写明字段含义。

## 模板

```html
{{extend skinLayout}}

{{block 'main'}}
<% include(_tpl_path + '/skin/head.html', [{ title: '邦布列表', ... }]) %>
...
{{/block}}
```

| 目录 | 内容 |
| --- | --- |
| `templates/layout/` | 外壳：`skin.html` 是三游戏共用的皮肤，`elem.html` 按元素换色 |
| `templates/common/` | 共用片段：头像卡、阵容、图片回退 |
| `templates/gs` `sr` `zzz/` | 单游戏专属的图 |
| `templates/character` `gacha` `wiki` `user/` | 三游戏共用的功能族 |

每个模板文件开头同样有四行职责注释，写在 `<!-- -->` 里。

命令里用 `s.image("zzz/buddy", data)`，路径相对 `templates/`、不带后缀。

## 渲染桥

`core/render.ts` 给每次出图补齐一批路径变量，两类形态不能混用：

| 变量 | 形态 | 谁来解析 |
| --- | --- | --- |
| `_res_path` `_meta_path` `_panel_path` `_face_path` | 带尾斜杠的 `file://` URL | 浏览器；中间 HTML 落在临时目录，相对路径取不到文件 |
| `_layout_path` `_tpl_path` `skinLayout` `elemLayout` | 绝对文件系统路径 | 模板引擎，编译期 |

给模板引擎传 `file:///C:/…` 会被拼成 `<模板根>/file:/C:/…`，报的是 ENOENT。

## 五条模板约定

写错的共同表现是**不报错**：图上一格空白、整块消失，或整张图退回文字。插件 README 的「模板约定」一节有同样五条，注释里「见 `xxx`」引的就是它们。

### 图有两个根 `template-img-two-roots`

插件资源 `resources/` 用 `_res_path`，运行时下载的元数据 `dataDir/meta/` 用 `_meta_path`。元数据路径一律以 `meta-<游戏>/` 开头，模板按前缀选根：

```html
<img src="{{ico.indexOf('meta-') === 0 ? _meta_path : _res_path}}{{ico}}">
```

米游社给的完整 `https://` 地址一处根都不加。同一张表里混着两种根时，不能写死其中一个前缀。

### 接口只取数据 `official-api-is-data-only`

米游社接口只取数据，图一张都不从它取，全部走已装的元数据。`panel/serv/zzz.test.ts` 断言映射结果里没有 `act-webstatic`，`render.test.ts` 断言出图结果里没有 `http://`。

例外只有两处，都直接用 https 地址：

- `#信息` 的页头背景：星铁与绝区零是玩家自选的壁纸 / 名片，原神是战绩页文案表的 `header_bg`。元数据里都没有，取不到时退回皮肤自己的页头。
- 绝区零 `#活动日历` 的调频格子：元数据查不到这位代理人 / 这件音擎时才用接口给的图。

### 数组字面量要先 set `art-template-each-needs-set`

```html
{{each [1,2,3] i}}            <!-- 静默渲染成空 -->

{{set list = [1, 2, 3]}}
{{each list i}}               <!-- 正确 -->
```

`{{set}}` 里对象字面量的 `}` 与 `}}` 之间要留一个空格。

### 不能用全局对象 `art-template-shadows-globals`

`{{ }}` 与 `<% %>` 里不认识的标识符会被当成数据字段，于是 `String(x)` 变成 `undefined(x)`。`String / Number / Boolean / Object / Array / Math / JSON / Date / RegExp` 都不能用：

```html
{{String(x)}}          <!-- 整张图失败 -->
{{'' + (x || '')}}     <!-- 正确 -->
```

`templates.test.ts` 会扫 `{{ }}`，`<% %>` 里的只有真渲染测试抓得到。

另有一类同样静默：顶层数据键叫 `char`、`final` 这类 JS 保留字时，引擎永远不绑定它。

### 倍率写在 css 里 `template-scale-lives-in-css`

基准倍率写在各模板 css 的 `body{transform:scale(N)}` 里，行内的 `sys.scale` 会压掉它，图就变小发糊。没有额外倍率时 `scaleStyle` 输出空串，全局精度用 `zoom`。

改清晰度只改那张图的 css，不要在命令层传倍率。

## 实例渲染器的限制

实例里的出图浏览器不让 css `mask` 读本地 svg 文件，本机截图却正常。小图标用模板内联的 `<svg>`，不要用 `mask: url(...)`。

## 测试

| 文件 | 抓什么 |
| --- | --- |
| `src/templates.test.ts` | 静态体检：模板存在、有 `#container` 截图锚点、注释里没有双大括号、顶层键不是保留字、`extend` / `include` 的路径指向真实文件 |
| `src/render.test.ts` | 真编译一遍：不抛错，输出里没有 `undefined`、`[object Object]`、裸 JSON 与 `http://` |
| `src/core/render.test.ts` | 渲染桥的路径变量形态与倍率 |
| `views/**/*.test.ts` | 视图逐字段的取值 |

新加一张图，要在 `render.test.ts` 里给它一份合成数据。视图给的键与模板要的键对不上，静态扫不出来，只有真编译才抓得到。
