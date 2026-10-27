# 对外服务

别的插件要查米游社、要用设备与 CK，不必自己再实现一遍，也不要 import 本插件的文件：经框架的服务注册表取。服务注册的一般用法见主站的 [定时任务与协作](https://yunzai-ng.github.io/plugin/service)。

## 提供的八个服务

| 键 | 是什么 | 典型用途 |
| --- | --- | --- |
| `mihoyo.mys` | 查询服务 `MysService` | 查任意接口，CK 归属、重试与风控都在里面 |
| `mihoyo.api` | 请求客户端 | 自己拼请求，签名与设备头照旧 |
| `mihoyo.device` | 设备存储 `DeviceStore` | 取某账号的设备与指纹 |
| `mihoyo.cookies` | CK 池 `CookiePool` | 看某人名下有哪些 CK |
| `mihoyo.users` | 用户档案 `UserStore` | 某人绑了哪些 uid、当前用哪个 |
| `mihoyo.gacha` | 抽卡记录 `GachaStore` | 读已存的抽卡记录 |
| `mihoyo.meta` | 元数据 `{ installer, loader }` | 查角色 id、简称、图标，不必自己再下一份三百兆 |
| `mihoyo.panel` | 面板取数 | 按 uid 取一份统一形态的面板，不必关心来自 Enka、Mihomo 还是米游社 |

## 用法

```js
setup(ctx) {
  ctx.command("#我的树脂").action(async e => {
    const mys = ctx.inject("mihoyo.mys")
    if (!mys) return e.reply("要先装 mhy-game 插件")

    const res = await mys.query("dailyNote", { user: `${e.platform}:${e.sender.uid}`, game: "gs" })
    await e.reply(res.ok ? `树脂 ${res.data.current_resin}` : res.message)
  })
}
```

`user` 要与本插件的用户档案主键同一形态：`<平台>:<发送者 uid>`，即本插件 `Session.user` 的取法。形态不一致时查不到任何绑定，一律回「尚未绑定 uid」。返回值与失败归类见 [查米游社接口](./query)。

| 取法 | 本插件没装时 |
| --- | --- |
| `ctx.inject("mihoyo.mys")` | 返回 undefined，自己降级 |
| `ctx.require("mihoyo.mys")` | 抛错 |
| `await ctx.waitFor("mihoyo.mys", "10s")` | 等它加载，超时返回 undefined |

硬依赖的话，在自己的 `dependencies` 里写上 `mhy-game`。

## 两条规矩

### 共用同一台设备

做米游社相关功能（比如自建签到）时，经 `mihoyo.device` 取设备，或直接经 `mihoyo.mys` / `mihoyo.api` 发请求。

各自生成一套设备信息，等于给同一个账号制造「多设备登录」，那是米游社的重点风控特征。被风控的不只是你的插件，本插件对这个账号的查询也会一起撞验证码。

### 守 CK 归属

`mihoyo.mys` 的 `query` 内部已经只选发起者本人、覆盖该 uid 的 CK。若直接用 `mihoyo.cookies` 自己挑 CK，同样要守这一条：

- 查 uid X 只用发起者本人绑定、且覆盖 X 的 CK
- 不回落到他的其他 CK，不借别人的 CK

米游社的战绩接口不校验 CK 与 uid 的归属，违反这一条就是越权读取他人私有数据。

## 不提供的

- 命令表与帮助目录不对外：别的插件加命令自己注册，不往本插件的帮助里塞。
- 事件总线没有返回值，不适合「查一下再回来」的协作。要协作就用服务。
