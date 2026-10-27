# 元数据

插件不带任何随游戏版本变的数据。角色与武器的 id、别名、图标、图鉴文案、面板曲线、词条表、评分权重、静态 buff，全部读运行时下载的元数据。

## 落在哪

```text
data/plugin/mhy-game/meta/
├── meta-gs/      原神，约 150MB
├── meta-sr/      星穹铁道，约 150MB
└── meta-zzz/     绝区零，约 45MB
```

模板里引用元数据的图一律以 `meta-<游戏>/` 开头，见 [视图与模板 · 图有两个根](./template#图有两个根-template-img-two-roots)。

## 下载与更新

`meta/download.ts` 的 `MetaInstaller`：

| 动作 | 做法 |
| --- | --- |
| 查版本 | `<metaHost>/api/meta-<游戏>/commits`，与本地 `.sha` 比 |
| 首次安装 | 下完整包解压；完整包不带哈希，以「解出的 `character` 目录非空」作落地校验 |
| 增量更新 | 逐个提交取增量包，**先校验 sha256 再解** |
| 强制 | 重下完整包；增量应用出错留下坏文件时，这是唯一的出路 |

- 只装 JSON、图片与按文件名放行的几个 `.js`，白名单见 `META_EXTENSIONS` 与 `#filenames`。
- 安装幂等、可并发调用，同一游戏的任务按内部锁排队。
- 包落在数据目录而不是插件的 `resources/`，插件重装时不必重下三百兆。

定时更新在 `service/meta-task.ts`，只更新已装过的那一份，首次安装仍由 `autoInstallMeta` 单管。

## 查询

命令里经 `deps.meta?.loader` 取 `MetaLoader`。元数据没装时 `deps.meta` 可能为空，一律先判：

```ts
const loader = deps.meta?.loader
if (!loader) return

const item = loader.byName(game, "胡桃")   // 认名字，含别名与简称
if (!item || item.type) return             // 武器与角色在同一张索引里，type 只有武器有
```

| 方法 | 作用 |
| --- | --- |
| `byName(game, name)` | 按名字、别名、简称找条目 |
| `byId(game, id)` | 按 id 找 |
| `find(game, id, name)` | 先 id 后名字 |
| `detail(game, id, elem?)` | 读角色的 `data.json` 全文 |
| `each(game, kind?)` | 全部角色 / 武器 |
| `ready(game)` | 这个游戏的元数据装好了没有 |
| `pathOf(rel)` / `exists(rel)` | 元数据目录下的文件 |

没装元数据时，依赖它的命令要明说「先发 #更新元数据」，不要出一张全是 0 的图。

## 只解析，不求值

元数据里有几份纯数据形态的 `.js`：别名 `character/alias.js`、简称 `material/abbr.js`、每日材料 `material/daily.js`、角色附加信息 `character/extra.js`、词条表 `artifact/extra.js`（星铁 `artifact/meta.js`）。

它们由 `meta/*-parse.ts` **解析成数据，不执行**，原语在 `meta/js-lit.ts`：剥注释、按配对取块、认字符串字面量。

不要把这类表抄进插件代码或 `resources/`。抄进来的那份不会随元数据更新，新角色的别名永远认不出。

## 沙箱

伤害公式（`calc.js`、`artis.js`）是真正的逻辑，无法离线转成数据。`meta/sandbox.ts` 是本插件**唯一**执行下载来的代码的地方：

- 只在 `enableDmgCalc` 开启时求值，缺省关
- 只求值 `CALC_FILES` 白名单里的文件名，路径须在元数据目录内
- 上下文里没有 require / process / fs / import / fetch / setTimeout
- 单次求值超时 1 秒
- 求值前把 ESM 改写成能在 `vm.Script` 里跑的形态；遇到没预料到的语法时明确报错，不静默跳过

`node:vm` 不是硬安全边界，注入对象的原型链理论上仍能回到宿主。所以防线是几层叠加的，缺省关是其中一层。

开关关着时公式文件仍随元数据落盘：面板属性要从 `calc.js` 里**只解析、不执行**地读静态加成（`meta/buff-parse.ts`）。

## 测试夹具

测试**不抄元数据原文**，哪怕只是一小段：

- 单元测试在临时目录里手写替身，只写这条用例要的那几个字段（见 `commands/strategy.test.ts` 的 `item()`）
- 要真数据验证的那组，读环境变量 `MHY_REAL_META` 指向的真实目录，没设时 `skip`

```powershell
$env:MHY_REAL_META = "C:\path\to\data\plugin\mhy-game\meta"
pnpm run test
```

## 形态差异

三个游戏的元数据形态并不一致，按原神写一遍的解析器在另两个游戏上通常不报错、只是查不到：

| 差异 | 原神 | 星穹铁道 | 绝区零 |
| --- | --- | --- | --- |
| 套装目录 | `artifact/` | `artifact/` | `equip/` |
| 元素 / 命途 | 键（`pyro`） | 中文（`智识`） | — |
| 卡池表 | `info/pool.js` | `info/index.js`，导出名带 `Sr` 后缀 | `info/pool.js` |

改元数据相关的代码，三个游戏各用真实目录跑一遍。
