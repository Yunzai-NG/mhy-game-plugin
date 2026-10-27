# 准备与验证

本分册写给要改这个插件、或想从别的插件调用它的人。插件本身的写法（`definePlugin`、`ctx`、命令与存储）见 Yunzai NG 主站的 [插件开发](https://yunzai-ng.github.io/plugin-api)，这里只讲本插件自己的结构与约定。

## 准备

插件依赖 `@yunzai-ng/core` 与 `@yunzai-ng/types`，两者是 `peerDependencies`，运行期由宿主提供。开发时先链接本地框架：

```powershell
git clone https://github.com/Yunzai-NG/yunzai-ng.git
cd yunzai-ng
pnpm install
pnpm run build          # 本插件的 tsc 读框架的 dist/*.d.ts

cd ..\mhy-game-plugin
pnpm install
# 把框架的 packages/core、types、jsx 链到 node_modules/@yunzai-ng/ 下（Windows 用 junction）
pnpm run verify
```

框架发布到 npm 之后，链接这一步不再必需。

::: warning 不要在插件目录里装第二份 @yunzai-ng/core
它会遮蔽宿主那一份，表现是命令照常触发、而每一项配置都读成 undefined。仓库自带的 `.npmrc` 已关掉 `auto-install-peers`。
:::

## 验证

`pnpm run verify` 依次跑下面四步，缺一不可：

| 脚本 | 内容 |
| --- | --- |
| `pnpm run build` | `tsc -b` |
| `pnpm run typecheck:test` | 测试文件的类型检查；vitest 本身不查类型 |
| `pnpm run lint` | `eslint .`，要求零告警 |
| `pnpm run test` | `vitest run` |

- 有一组测试要一份真实的元数据目录（环境变量 `MHY_REAL_META` 指过去），没装时跳过，skip 属正常。
- 改过文件名或搬过目录后跑 `tsc -b --force`：`tsc -b` 不删旧产物，删了 `dist` 之后也仍按 `tsconfig.tsbuildinfo` 判为无事可做。

## 在实例里试

把编译好的插件放进实例的 `plugins/mhy-game-plugin/`，重启实例。没接 QQ 的话装 [adapter-stdin](https://yunzai-ng.github.io/plugins/adapter-stdin)，在终端里直接发 `#体力`。

每条命令收尾时会记一行 debug 汇总：打了哪些接口、各自结果与耗时。命令抛错时记完整调用栈，排错先看那一行。

## 往下读

<LinkCards :items="[
  { icon: 'layers', title: '整体结构', desc: '五层各管什么、数据怎么流过去', link: '/dev/architecture' },
  { icon: 'terminal', title: '加一条命令', desc: '命令表、前缀、开关与帮助目录', link: '/dev/command' },
  { icon: 'key', title: '查米游社接口', desc: '接口表、CK 归属、失败归类与风控', link: '/dev/query' },
  { icon: 'image', title: '视图与模板', desc: '纯函数视图、出图回退与五条模板约定', link: '/dev/template' },
  { icon: 'database', title: '元数据', desc: '下载、装载、只解析不求值与沙箱', link: '/dev/meta' },
  { icon: 'plug', title: '对外服务', desc: '别的插件怎么复用设备、CK 与查询', link: '/dev/services' },
  { icon: 'test', title: '测试与约定', desc: '注释规范、夹具与几处不报错的坑', link: '/dev/conventions' },
  { icon: 'book', title: '维护本站', desc: '改了插件后哪几页要跟着改', link: '/dev/docs' }
]" />
