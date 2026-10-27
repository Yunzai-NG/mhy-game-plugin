# 查米游社接口

命令层只接触 `deps.mys.query` 这一个入口。取 uid、选 CK、判 retcode、决定是否停用某条 CK，都只在 `service/mys.ts` 写一遍。

## 调用

```ts
const res = await deps.mys.query<BuddyRaw>("buddy", {
  user: s.user,   // 必填：发起者，也是选 CK 的归属闸
  game: s.game,
  uid: "10000000", // 可省：缺省用发起者当前绑定的 uid
  data: {}         // 可省：接口参数，如 { schedule_type: 2 }
})

if (res.ok) {
  res.data   // 接口数据
  res.uid    // 实际查的 uid
  res.cached // 是否来自响应缓存
} else {
  res.kind    // 失败归类，见下
  res.message // 可直接展示的提示
}
```

失败不抛异常，返回带 `kind` 的对象，命令层按类型给话术。一般直接 `await s.text(failText(res))`。

## CK 归属

查 uid X 时，只能用**发起者本人绑定、且覆盖 X** 的那份 CK：

- 不回落到发起者的其他 CK
- 没有公共池，`owner` 为空的记录不可选中
- 后台任务（体力提醒、自动签到）同样要带上那个使用者的 `user`

米游社的战绩接口（尤其绝区零）不校验 CK 与 uid 的归属，违反这一条就是越权读取他人私有数据。实现在 `store/ck.ts` 的 `CookiePool.pick`：

- `save` 没有 `owner` 一律拒写。
- `uids` 只在绑定时由接口的返回写入，不开「给 CK 补挂 uid」的入口。那等于留一把手工绕过这道闸的钥匙。

## 失败归类

| `kind` | 含义 | 对 CK 做什么 |
| --- | --- | --- |
| `nouid` | 没绑 uid，命令里也没给 | — |
| `nock` | 本人没有覆盖该 uid 的可用 CK | — |
| `cookie` | `-100`，Cookie 确已失效 | 停用这一条，换本人的另一条覆盖该 uid 的 CK 重试 |
| `risk` | `1034` 等，触发验证码或风控 | **不停用、不换 CK**；客户端先换指纹重试一次，配了过码服务时再过一次码 |
| `limit` | 这条 CK 当日查询次数达上限 | 当日不再用它，换本人的另一条覆盖该 uid 的 CK 重试 |
| `private` | 使用者没公开数据 | — |
| `notfound` | uid 不存在或没玩过该游戏 | — |
| `unsupported` | 该游戏没有这个接口 | — |
| `http` | 超时、DNS、非 2xx | — |
| `unknown` | 其他 retcode | — |

风控时绝不换 CK、绝不停用。换 CK 只会把同一台设备的风控扩散到第二个账号；停用则一次验证码就清空某人名下全部 CK。

## 加一个接口

接口表在 `src/core/api.ts`，按游戏拆函数，每次只构造当前游戏那一张：

```ts
buddy: {
  url: `${rec}/buddy/info`,
  query: byRole
}
```

| 字段 | 作用 |
| --- | --- |
| `url` | 完整地址，不含 query |
| `query` | query 串，**顺序即签名顺序** |
| `tail` | 拼在 query 之后、不进签名的那一段，给绝区零 `id_list[]` 这类重复的数组参数 |
| `body` | 请求体，存在即用 POST |

::: danger query 的顺序不能动
DS 签名以 `q=` 原样参与 md5。`role_id=...&server=...` 一类看似可重排的顺序也要当常量，按字母序整理一次等于改了签名输入，接口回的是一个语义无关的错误码。
:::

## 设备

每次请求都用同一台设备，设备与指纹一律经 `DeviceStore` 取，不在请求时即时生成：

- 绑 CK 时即确定设备，此后不再更换。米游社把连续出现超过一天的设备视为常用设备，设备一换，验证码、`1034`、`-100` 就成片出现。
- 优先用使用者绑的真机，没有则用按账号确定性派生的虚拟设备。存储只是缓存，数据缺失时直接重算。
- `device_fp` 与 `device_id` 绑定，换设备时旧指纹立即作废。

写任何涉及设备的代码，都先问一句「这会不会导致已有账号换设备」，答案必须是否。

## 过码

遇到 `1034` 时，若配置了 `captchaService`，`MysService` 走三步：带 CK 取验证串、把 `gt` / `challenge` 交给外部服务等它回传结果、带 CK 把结果报回米游社，然后重发原请求。发给外部服务的只有 uid 与这两个公开验证串，Cookie、DS 与设备指纹一律不外发。

过码只做一次。第二次仍是风控，说明不是验证码所致（多为这台设备本身已被限制），再走一遍只是让使用者多等两分钟。

`createVerification` 的 `is_high=true` 不能省：省掉时下发的是另一种验证串，校验通过也不解除战绩接口上的风控。

## 日志

`core/trace.ts` 逐条记外部请求，地址只记主机与路径、不记 query：authkey、ticket 一类凭据都在 query 里。请求头与请求体一概不记。新写的日志同样不能出现 Cookie、stoken、authkey 与设备指纹。
