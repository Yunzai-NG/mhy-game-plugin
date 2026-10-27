# 加一条命令

以 `%邦布` 为例走一遍。一条命令要动四处：命令表、命令实现、视图与模板、帮助目录。

## 命令表

全部命令是一张数据表，在 `src/commands/index.ts` 的 `MHY_COMMANDS`，按游戏分四块（三游戏共用、原神、星铁、绝区零）：

```ts
{
  words: ["邦布"],
  desc: "已拥有的邦布一览（仅绝区零）",
  group: "查询",
  game: "zzz",
  handler: buddyList,
  opts: { cooldown: QUERY_CD }
}
```

| 字段 | 作用 |
| --- | --- |
| `words` | 触发词，**不带前缀**。写一次 `邦布` 即同时注册 `#邦布`、`#星铁邦布`、`#绝区零邦布`，`%邦布` 这类简写由前缀中间件规整 |
| `extra` | 额外的正则，给「名字在触发词之前」一类形态（`#胡桃攻略`），一律经 `cmdRe` 写 |
| `tail` | 缺省 `prefix`，触发词后的任何内容进 `rest`；`"uid"` 表示要么光一个词、要么词 + uid |
| `game` | 只对一个游戏成立时给。它决定这条归表里哪一块、帮助印哪个前缀，**不收窄注册** |
| `gate` | 功能开关，`(config) => boolean`，分发时现判，改配置即生效 |
| `offText` | 被开关关掉时说的话；不给即静默退出 |
| `rest` | 改写 `rest` 的取法，触发词自带参数时用（`#上期深渊`、正则的具名分组） |
| `opts` | 交给内核的选项：`cooldown`、`priority`、`master` 等 |

### 前缀与路由

- **`cmdRe` 的正则体一律用 `String.raw` 写**。不用的话 `\s`、`\d` 要双写，漏一个不报错，只是那条命令再也触发不了。
- `extra` 必须经 `cmdRe`，规整后的游戏前缀（`#星铁`、`#绝区零`）才接得到。
- 前缀路由下，一个词是另一个词的前缀时两条必定互相遮挡。`#体力` 与 `#体力提醒`、`#日历` 与 `#日历列表` 都只注册了前一条，由它按 `rest` 分派。
- 不收口的命令会把 `#面板发这个` 也当成自己的（`rest` 变成「发这个」）。参数只可能是 uid 的，写 `tail: "uid"`。

### 只有一个游戏有的命令

`game: "zzz"` 不收窄注册：`#邦布` 仍注册得出来，好由实现回一句「邦布是绝区零的」，而不是静悄悄没反应。

### 名字在前的命令

`#胡桃`、`#胡桃图鉴`、`#胡桃攻略` 这类会过一遍每条以 `#` 开头的消息。它们的约定：

- `priority` 设 800 以上，排在明确触发词的命令之后
- 认不出名字时**静默退出**，开关关着时也静默（不给 `offText`）。出声等于把所有笔误、别的插件的同名命令都变成一句报错
- 名字认出来之后，明确的请求（如 `#胡桃更新攻略`）可以出声

## 命令实现

```ts
export async function buddyList(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "zzz") {
    await s.text("邦布是绝区零的，请发送 #绝区零邦布 或 %邦布")
    return
  }

  const res = await deps.mys.query<BuddyRaw>("buddy", { user: s.user, game: s.game })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const data = buddyTemplateData(res.data, { uid: res.uid, name: s.name })
  if (await s.image("zzz/buddy", data)) return
  await s.text(buddyText(data))
}
```

- 只收 `Session` 与 `MhyDeps`，不收 `MessageEvent`、不收 `ctx`。
- 查询一律走 `deps.mys.query`，失败用 `failText(res)` 出话术，见 [查米游社接口](./query)。
- `s.image` 失败（没装渲染器、渲染出错）返回 false，**一定**要接一份文字版。
- 回复里提到命令时，前缀用 `SHORT_PREFIX[s.game]` 拼。写死 `#` 会让星铁与绝区零的使用者照抄到一条发不出去的命令。

## 帮助目录

机器人里的帮助图读 `src/commands/catalog.ts` 的手写目录，不从命令表推导：命令表里多数条目对三个游戏都注册得出来，据它生成会把 `*七圣卡组` 一类印进去。

新加一条**可见**命令，二选一：

- 写进 `CATALOG` 的某个区块，`games` 写真正能用的那几个游戏
- 冷门或成对出现的，在 `IN_GUIDE` 登记它写在哪张细分帮助上，并真的写进那张帮助

```ts
{ word: "邦布", desc: "已拥有的邦布一览", games: ["zzz"] }
```

`catalog.test.ts` 守四件事，漏了任何一件即红：

1. 目录里每条按游戏路由到真正实现它的那条命令
2. 真驱动一遍，不会回「只有 X 有」「暂不支持」
3. 细分帮助里每一步给出的命令都能路由
4. 命令表里每条可见命令要么在目录里，要么在 `IN_GUIDE` 说的那张帮助上露面

第 2 条只认那几句固定话术。像「绝区零暂无攻略资源」这种另写的拒绝不在其中，`games` 要自己写对。

## 功能开关

要开关的话，先在 `src/config.ts` 加一项，再在命令表里写 `gate`：

```ts
gate: (c): boolean => c.enableAbyss,
offText: "主人关掉了「深渊」这个功能"
```

缺省值的取向：插件主动写入、在使用者不知情时发请求、或引第三方来源的一律缺省关；只读查询的开关一律缺省开。理由见 [缺省关闭的功能](../deploy/privacy)。

## 收尾

- 视图与模板见 [视图与模板](./template)
- 给命令实现、视图各写测试，见 [测试与约定](./conventions)
- 本站的 [命令一览](../reference/commands) 与对应的使用指南页手改，见 [维护本站](./docs)
