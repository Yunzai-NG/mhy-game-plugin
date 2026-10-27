/**
 * 模块职责：mhy-game 插件的配置 schema
 * 依赖方向：只依赖内核的 schema 工具与类型包
 * 生命周期：模块加载期构造一次；运行期靠 `ctx.config.get()` 现读
 * 注意事项：本 schema 即为面板中的"米哈游游戏"设置表单，不必另写前端代码。
 *
 *          设备相关项为刻意精简：米游社把连续出现超过一天的设备视为常用设备，
 *          任何"重新生成设备"的入口都会引导使用者作出有害操作，故只暴露指纹更换周期。
 *
 *          缺省值分两类，判据是"这件事是插件自己主动做的吗"：会代替使用者写入、会在
 *          使用者不知情时发请求、会引第三方源的一律缺省关；纯读的 `enable*` 一律缺省开。
 */
import { s } from "@yunzai-ng/core"
import type { Infer } from "@yunzai-ng/core"
import type { DeepReadonly } from "@yunzai-ng/types"

/**
 * 展柜头像的镜像站 —— 索引与图片两项的缺省值
 *
 * 它同时供 `pfpsHost` 与 `assetHost`：两项指向同一个站是常态，分成两项只为允许分别换。
 * 这一个地址是**插件自己的镜像**，Enka 官方那两条路（jsDelivr 上的索引、`enka.network` 的图）
 * 在国内常取不到，取不到索引即一张头像都落不下来。
 */
const ENKA_MIRROR = "https://enka-assets.072420.xyz"

/** 配置 schema */
export const CONFIG_SCHEMA = s.object({
  enableAvatarList: s
    .boolean()
    .default(true)
    .title("允许查角色列表")
    .desc("`#角色列表`。关掉之后这条命令会明说是被主人关了，而不是静悄悄没反应")
    .group("功能")
    .order(1),

  enableAvatarCard: s
    .boolean()
    .default(true)
    .title("允许查角色卡片")
    .desc(
      "直接发角色名的那一条（`#胡桃`、`#我的三月七`）。它会过一遍每条 `#` 开头的消息，" +
        "故与别的插件抢词时可以从这里关掉；关掉后**静默退出**，不出声 —— 出声等于把所有笔误" +
        "都变成一句报错"
    )
    .group("功能")
    .order(2),

  enableAbyss: s
    .boolean()
    .default(true)
    .title("允许查深渊")
    .desc("`#深渊`、`#上期深渊`。只查不传 —— 本插件不会把战绩连同 uid 送去任何第三方统计站")
    .group("功能")
    .order(3),

  enablePanel: s
    .boolean()
    .default(true)
    .title("允许查角色面板")
    .desc("`#面板`、`#胡桃面板`、`#圣遗物`、`#更新面板`。关掉后面板排行也一并不可用（它读的是同一份数据）")
    .group("功能")
    .order(4),

  enableGroupRank: s
    .boolean()
    .default(true)
    .title("允许群面板排行")
    .desc(
      "`#胡桃排行` 一族。这是**部署者**的总闸；另有一道由群管理按群开关（`#关闭排名`）。" +
        "请按群友的心理素质自行决定 —— 排行会把谁练得差也一并列出来"
    )
    .group("功能")
    .order(5),

  enableProfileStat: s
    .boolean()
    .default(true)
    .title("允许查练度统计")
    .desc("`#练度统计`、`#天赋统计`。它出的是全部角色的一张长图，图较大时渲染与发送都慢")
    .group("功能")
    .order(6),

  enableGachaStat: s
    .boolean()
    .default(true)
    .title("允许抽卡分析与统计")
    .desc("`#抽卡分析`、`#抽卡统计`、`#复刻统计`。不影响 `#抽卡记录` 与导入导出")
    .group("功能")
    .order(7),

  enableCharWiki: s
    .boolean()
    .default(true)
    .title("允许查角色与武器图鉴")
    .desc("`#胡桃图鉴`、`#护摩之杖图鉴`。同角色卡片一样是「名字在触发词之前」的形态，关掉后静默退出")
    .group("功能")
    .order(8),

  enableCharTalent: s
    .boolean()
    .default(true)
    .title("允许查天赋与命座")
    .desc("`#胡桃天赋`、`#胡桃命座`、`*姬子行迹`、`*姬子星魂`")
    .group("功能")
    .order(9),

  enableCharPic: s
    .boolean()
    .default(true)
    .title("允许查角色图片")
    .desc("`#胡桃图片`。发的是面板图目录里随机一张 —— 关掉它不影响面板出图时用的背景立绘")
    .group("功能")
    .order(10),

  enableUnreleased: s
    .boolean()
    .default(true)
    .title("允许查未实装角色")
    .desc(
      "元数据常在版本更新前就带上下一批角色（`character/data.json` 里那一项 `eta` 即预计实装时间）。" +
        "开着时这些角色的图鉴、面板与排行照常可查，数据仅供参考、以游戏正式实装的内容为准；" +
        "关掉后这三处会明说「未实装角色已禁用」。**只影响原神** —— 星铁的元数据不带 `eta`，无从判定"
    )
    .group("功能")
    .order(11),

  enableChallenge: s
    .boolean()
    .default(true)
    .title("允许查各类挑战战绩")
    .desc(
      "`#幻想真境剧诗`、`#月谕圣牌`、`#绘想游迹`、`#幽境危战`、`*虚构叙事`、`*末日幻影`、`*异相仲裁`。" +
        "都是只读查询，与 `#深渊` 同族，故合用一项开关，且缺省开着 —— 只读查询关着等于命令凭空消失，" +
        "使用者无从判断是没有这条命令还是被关了"
    )
    .group("功能")
    .order(12),

  renderScale: s
    .number()
    .int()
    .min(50)
    .max(200)
    .default(100)
    .title("渲染精度")
    .desc(
      "百分比，乘在每套模板自己的基准倍率之上（基准写在各模板的 css 里，按容器宽度定成" +
        "出图约 1200~1450px 宽）。缺省 100 即「按模板原本的观感出图」，此时不注入任何行内样式；" +
        "调高会让图更清晰但字节数明显变大，渲染与发送都更慢"
    )
    .group("系统")
    .order(1),

  commaGroup: s
    .number()
    .int()
    .min(3)
    .max(4)
    .default(3)
    .title("数字分隔位数")
    .desc("面板与图鉴里的大数字每几位加一个逗号。按中文习惯读「万」的话填 4，按千位分组填 3")
    .group("系统")
    .order(2),

  faceStyle: s
    .select([
      { value: "b", label: "表情包头像优先", description: "有 face-b 就用它，没有再往下退。缺省形态" },
      { value: "z", label: "自定义头像优先", description: "有 face-z 就用它，其次表情包。face-z 须自行放进元数据目录" },
      { value: "q", label: "Q 版小头像", description: "只用 face-q，没有就用原始头像" },
      { value: "base", label: "原始头像", description: "一律用 face，不取任何变体" }
    ])
    .default("b")
    .title("角色头像风格")
    .desc(
      "角色列表、抽卡统计、练度统计、天赋图鉴那些小格子里的头像用哪一张。" +
        "元数据里同一个角色可能有四份：`face`（官方立绘裁的）、`face-q`（Q 版）、" +
        "`face-b`（表情包）、`face-z`（自定义）。**逐档判存在性再往下退**，" +
        "故选了一档而某个角色没有那张图时不会留下空格子。" +
        "不影响面板出图用的大立绘，那一张由「使用自定义面板插图」管"
    )
    .group("系统")
    .order(3),

  deviceFpMaxAge: s
    .duration()
    .default("15d")
    .title("设备指纹有效期")
    .desc("device_fp 到期后自动重新获取。设备本身不变，仅更换一次指纹")
    .group("设备")
    .order(1),

  allowBindDevice: s
    .boolean()
    .default(true)
    .title("允许绑定真机设备")
    .desc("开启后使用者可通过 #绑定设备 提交本人手机上的 device_id / device_fp，请求时优先采用")
    .group("设备")
    .order(2),

  requestTimeout: s
    .duration()
    .default("15s")
    .title("接口超时")
    .desc("单次米游社请求的等待上限")
    .group("接口")
    .order(1),

  cacheTtl: s
    .duration()
    .default("1m")
    .title("接口缓存时长")
    .desc("同一使用者在短时间内重复查询同一项时直接采用缓存，以降低触发风控的概率")
    .group("接口")
    .order(2),

  captchaService: s
    .string()
    .default("")
    .title("图形验证过码服务地址")
    .desc(
      "米游社偶尔会对一次查询要求图形验证（`retcode 1034`）。填入过码服务地址后，遇到时" +
        "本插件会自动走一遍验证再重发原请求；**留空则不走这条路**，表现与不填时一字不差。\n\n" +
        "过码服务须由你自行部署，它不是本框架的插件而是一个独立服务：过一次码要一个能让人" +
        "点开的公网页面，而机器人所在的机器未必有公网入口。协议为 `POST` 该地址、" +
        "请求体 `{uid, gt, challenge}`，返回 `{data: {link, result}}`；`link` 交给使用者点开，" +
        "`result` 供本插件轮询，其 `data` 给出对象即视为验证通过。服务自己就能过码时" +
        "第一步即可直接返回该对象。\n\n" +
        "**发给它的只有 uid 与米游社当场下发的两个公开验证串**，Cookie、DS 与设备指纹一律" +
        "不外发 —— 两条验证接口由本插件自己请求"
    )
    .group("接口")
    .order(3),

  captchaWait: s
    .duration()
    .default("2m")
    .title("等待过码的上限")
    .desc("超过这个时长仍未完成验证即放弃，按未过码处理。填得太短会让人来不及点开链接")
    .group("接口")
    .order(4),

  autoInstallMeta: s
    .boolean()
    .default(false)
    .title("启动时自动下载元数据")
    .desc(
      "元数据提供角色与武器的图标、简称，抽卡统计与图鉴需要它，三个游戏合计约 350MB。" +
        "缺省关闭：这是一次相当大的下载，应由主人自行决定何时进行，可随时发送 #更新元数据 手动安装"
    )
    .group("元数据")
    .order(1),

  metaHost: s
    .string()
    .default("https://miao.072420.xyz")
    .title("元数据提交列表主机")
    .desc("查询元数据版本的接口地址，默认源不可用时可改为自建镜像")
    .group("元数据")
    .order(2),

  enableMetaAutoUpdate: s
    .boolean()
    .default(false)
    .title("定时自动更新元数据")
    .desc(
      "按下面的周期检查一次元数据版本，有新提交就取增量包补上。**只更新已经装过的那一份**，" +
        "首次那几百兆仍由「启动时自动下载元数据」单管 —— 否则关掉那一项之后照样会被下几百兆。\n\n" +
        "缺省关闭：这是插件自己主动发请求并写盘。关着时新角色的图标与简称要等主人手动" +
        "「#更新元数据」才认得出"
    )
    .group("元数据")
    .order(4),

  metaAutoUpdateInterval: s
    .duration()
    .default("12h")
    .title("自动更新周期")
    .desc("多久检查一次。检查本身只是一次很小的请求，真正的下载只在有新提交时才发生")
    .showWhen({ enableMetaAutoUpdate: true })
    .group("元数据")
    .order(5),

  metaAutoErrorNotice: s
    .boolean()
    .default(true)
    .title("自动更新失败时通知主人")
    .desc(
      "关掉后失败只记在日志里，手动「#更新元数据」的回复不受影响。" +
        "**首次失败立刻通知，此后按下面的最短间隔重复** —— 元数据源不通常常持续几个小时，" +
        "每轮都发一条会把主人的私聊刷满；而一条都不发会让「新角色一直认不出」这件事无从察觉"
    )
    .showWhen({ enableMetaAutoUpdate: true })
    .group("元数据")
    .order(6),

  metaAutoErrorNoticeInterval: s
    .duration()
    .default("60m")
    .title("失败通知的最短间隔")
    .desc("持续失败时隔多久再通知一次。成功一次即清零 —— 否则故障恢复之后的下一次故障反而被挡住")
    .showWhen({ enableMetaAutoUpdate: true })
    .group("元数据")
    .order(7),

  enableDmgCalc: s
    .boolean()
    .default(false)
    .title("开启伤害计算")
    .desc(
      "开启后面板会显示伤害期望，并可用「#角色名伤害」看词条收益对比。请知悉其代价：" +
        "伤害公式是代码而非数据（219 个 calc.js，含条件分支），无法像其他元数据那样离线转成 JSON，" +
        "故开启即意味着**执行下载来的代码**。" +
        "本插件在受限上下文（node:vm）中求值：没有 require / process / fs，有超时，只求值 " +
        "calc.js 与 artis.js 两种文件名；宿主对象经代理进出、公式摸不到宿主的构造器；增量包须带 sha256 才铺开、" +
        "否则改下固定官方归档的完整包。但 node:vm 不是硬安全边界，故缺省关闭，由你自行决定。关闭时面板照常可用，仅无伤害一栏。" +
        "公式文件恒随元数据落盘（面板属性要从里面只解析不执行地读静态加成），开关改完即生效、无须重下元数据"
    )
    .group("元数据")
    .order(3),

  profileServer: s
    .string()
    .default("0")
    .title("原神面板服务")
    .desc(
      "按服务器类型逐位取值：第一位官服、第二位 B 服、第三位国际服，位数不足时一律用第一位。" +
        "0 自动、2 Enka、3 MiniGG、4 X-Enka、5 Lyln。" +
        "自动即按服务器类型取缺省源：国服与 B 服走 MiniGG，国际服走 Enka —— " +
        "Enka 对国服 uid 本就会重定向到 MiniGG，直接打后者只是少绕一跳。" +
        "**填 1 时按自动处理**"
    )
    // 逐位取值，故不能做成下拉；给个示例让人看出"可以填好几位"
    .placeholder("0 或 033（官服/B服/国际服各一位）")
    .group("面板")
    .order(1),

  srProfileServer: s
    .string()
    .default("0")
    .title("星铁面板服务")
    .desc("取值方式同上。0 自动（Mihomo）、2 Mihomo、3 鳄梨、4 EnkaHSR。1 同上，按自动处理")
    .group("面板")
    .order(2),

  zzzProfileServer: s
    .string()
    .default("0")
    .title("绝区零面板服务")
    .desc(
      "取值方式同上。**0 自动、1 均为米游社**（要 Cookie，给名下全部代理人、属性由接口算好）；" +
        "**2 为 Enka 官方展柜**（不要 Cookie，但只看得见你在游戏里公开的那几位，属性由本插件自己算）。" +
        "缺省用米游社。用 Enka 时需装新版元数据（含音擎成长率与套装二件加成），否则属性不全"
    )
    .group("面板")
    .order(2.5),

  pfpsHost: s
    .string()
    .default(ENKA_MIRROR)
    .title("头像索引来源")
    .desc(
      "Enka 头像索引（`pfps.json`）的地址前缀，缺省走本插件的镜像 " +
        `（\`${ENKA_MIRROR}\`）。填别的镜像时路径须为 \`<地址>/<gs|sr|zzz>/pfps.json\`；` +
        "**清空则回落 Enka 官方那一份**（经 jsDelivr 取，国内常取不到）。" +
        "只在用展柜源更新面板时用到，本地缓存一周；米游社源的头像不经过它"
    )
    .placeholder(ENKA_MIRROR)
    .group("面板")
    .order(2.6),

  assetHost: s
    .string()
    .default(ENKA_MIRROR)
    .title("头像图来源")
    .desc(
      "展柜头像图的下载根，缺省同上走本插件的镜像。" +
        "填别的镜像时路径须为 `<地址>/<gs|sr|zzz>/assets/ui/...`；" +
        "**清空则回落 Enka 官方（`https://enka.network`，那边路径是 `/ui/...`）**。" +
        "通常与「头像索引来源」填同一个地址"
    )
    .placeholder(ENKA_MIRROR)
    .group("面板")
    .order(2.7),

  groupRankLimit: s
    .number()
    .int()
    .min(1)
    .max(5)
    .default(1)
    .title("群排行参与条件")
    .desc(
      "挡住专为刷榜建的小号：1 无限制、2 仅绑定 CK 的用户、3 绑 CK 或面板列表有 16 个角色、" +
        "4 绑 CK 或列表里有那三个开局角色（原神安柏凯亚丽莎 / 星铁丹恒三月七）、5 第 3 与第 4 两者都要"
    )
    .showWhen({ enableGroupRank: true })
    .group("面板")
    .order(3),

  rankNumber: s
    .number()
    .int()
    .min(5)
    .max(30)
    .default(15)
    .title("排行显示人数")
    .desc("一条排行榜最多列出多少名")
    .showWhen({ enableGroupRank: true })
    .group("面板")
    .order(4),

  panelImgList: s
    .boolean()
    .default(true)
    .title("允许查看面板图列表")
    .desc("关闭后 #角色面板图列表 不再逐张发图。上传与删除一律仅限主人，不受此项影响")
    .group("面板")
    .order(5),

  allowOriginalPic: s
    .boolean()
    .default(true)
    .title("允许索取原图")
    .desc(
      "回复一张面板图或角色卡片并发送「#原图」，把那张图的立绘按原始尺寸发一遍。" +
        "「角色图」与「面板图」在本仓库取的是同一批文件（`#上传胡桃面板图` 传的那些），故只有一道闸。" +
        "索引只在内存库里留三小时，存的是路径而非图片本身。**要平台既回消息 id、又在引用里带消息 id** " +
        "才用得上，两者缺一时这条命令只会说认不出你回复的是哪张图"
    )
    .group("面板")
    .order(10),

  artisNumber: s
    .number()
    .int()
    .min(4)
    .max(100)
    .default(28)
    .title("圣遗物列表数量")
    .desc(
      "`#圣遗物` 那张列表最多列多少件（最终数量还取决于面板里实际有多少件）。" +
        "调高会明显拉长图片，渲染与发送都更慢"
    )
    .group("面板")
    .order(6),

  panelUpdateByMys: s
    .boolean()
    .default(true)
    .title("`#更新面板` 绑了 Cookie 时缺省走米游社")
    .desc(
      "开启时 `#更新面板` 在该 uid 绑了 Cookie 时走米游社（取得名下全部角色，" +
        "圣遗物词条档位由最终值反推、是近似值），没绑 Cookie 时回落展柜（原神星铁走面板服务、绝区零走 Enka，" +
        "只取得到展柜里的角色）。关闭则一律走展柜。`#米游社更新面板` 与 `#展柜更新面板` 可随时指名走其中一条"
    )
    .group("面板")
    .order(7),

  enableCustomSplash: s
    .boolean()
    .default(true)
    .title("使用自定义面板插图")
    .desc(
      "开着时 `#胡桃面板` 的背景立绘优先用使用者上传的那些（`#上传胡桃面板图`），" +
        "满命、评分到 ACE/MAX 或天赋全满的角色另从 `super-character/` 里挑 —— 即所谓彩蛋图。" +
        "关掉后一律用元数据里的官方立绘，上传的图仍在盘上、`#胡桃图片` 与面板图列表照常可用"
    )
    .group("面板")
    .order(8),

  srSharedSplashDir: s
    .boolean()
    .default(true)
    .title("星铁同角色共用面板图")
    .desc(
      "星铁里同一个角色的不同命途各占一个元数据目录（`三月七` 与 `三月七·巡猎`），" +
        "开着时它们共用同一个面板图目录，上传一次两边都用得上。" +
        "开拓者（`穹·毁灭` 一类）**不受此项影响**，一律归到 `穹` / `星` 名下 —— " +
        "那七个目录是同一个角色换命途，分开存等于让人为每个命途各传一次"
    )
    .showWhen({ enableCustomSplash: true })
    .group("面板")
    .order(9),

  enableWikiStat: s
    .boolean()
    .default(false)
    .title("图鉴显示全服统计")
    .desc(
      "开启后 #角色图鉴 会多出「平均命座 / 持有率 / 常用武器 / 常用圣遗物」四块。" +
        "请知悉其代价：**这四块只有第三方来源**（原神取自微信小程序「提瓦特小助手」" +
        "api.lelaer.com，星铁取自 ArkApi ark.ivny.cn），官方接口不提供全服统计。" +
        "请求里只带角色名，不带 uid、不带 Cookie，结果缓存一小时；统计本身来自那两家的用户" +
        "自主上传，非官方数据，仅供参考。缺省关闭：向米哈游之外的服务发请求应由你自己决定。" +
        "关闭时图鉴照常出图，仅少那四块"
    )
    .group("图鉴")
    .order(1),

  enableCharStrategy: s
    .boolean()
    .default(true)
    .title("开启角色攻略")
    .desc(
      "`#胡桃攻略` 会发出各攻略组做好的攻略图。图与索引都来自 gitee 上的 qsyhh_res 仓库" +
        "（与元数据同一个维护者），请求里只有角色名，索引缓存六小时、图下载后落盘长期缓存。" +
        "关闭后这条命令不再发任何请求，也不再有任何反应"
    )
    .group("图鉴")
    .order(2),

  strategyHost: s
    .string()
    .default("https://gitee.com/qsyhh_res")
    .title("攻略索引来源")
    .desc(
      "攻略索引的仓库地址前缀，缺省源不可用时可改为自建镜像。" +
        "镜像须保持同一套路径形态：`<前缀>/<游戏>/raw/<游戏>/<元素或命途>/<角色>.json`"
    )
    .showWhen({ enableCharStrategy: true })
    .group("图鉴")
    .order(3),

  enableCalendarFix: s
    .boolean()
    .default(false)
    .title("日历时间表打第三方补丁")
    .desc(
      "`#日历` 的活动起止时间抠自米游社公告正文，而公告排版每个版本都在变，认不出的那几条会退回" +
        "列表里给的时间（多为公告发布时间，故进度条偏移）。开启后额外向 miao.games/api/calendar " +
        "取一份人工校对过的时间表覆盖上去。请知悉其代价：**那是第三方来源**，请求里只有一个 GET、" +
        "不带任何身份信息，但它能决定日历上哪几条活动出现、起止画在哪。缺省关闭：" +
        "向米哈游之外的服务发请求应由你自己决定，关闭时日历照常出图"
    )
    .group("日历")
    .order(1),

  enableAutoSign: s
    .boolean()
    .default(false)
    .title("每日自动签到总开关")
    .desc(
      "开启后每天按下面的时间**代替使用者向米游社签到**。这是本插件唯一会代替使用者写入的功能，" +
        "故有两道开关：这一道由你（部署者）把总闸，另一道由每个使用者自己按账号开" +
        "（「#自动签到」）—— 两道都开才会真的执行。缺省关闭。\n\n" +
        "签到只用使用者**自己绑定**的 Cookie，别人的 CK 一概不动；" +
        "撞上验证码时不会自动过码、也不会重试，只会告知去米游社手动点一次"
    )
    .group("签到")
    .order(1),

  autoSignCron: s
    .string()
    .default("0 35 8 * * *")
    .title("自动签到时间")
    .desc(
      "cron 表达式，5 段（分 时 日 月 周）或 6 段（秒 分 时 日 月 周）。缺省为每天 08:35。" +
        "**不建议改成整点或零分**：那一刻全网的签到脚本都在打米游社，撞验证码的概率明显更高"
    )
    .widget("cron")
    .showWhen({ enableAutoSign: true })
    .group("签到")
    .order(2),

  enableStaminaRemind: s
    .boolean()
    .default(false)
    .title("体力提醒总开关")
    .desc(
      "开启后，为自己发过「#体力提醒」的使用者定时查一次体力，超过其设定的阈值时主动推一张便笺图" +
        "（群里开的推到那个群并 @ 他，私聊开的私聊推；没装渲染器时退回文字）。缺省关闭：" +
        "它虽然只读、不向米游社写入，但**会在使用者不知情的情况下发请求、也会主动发消息**，这两件事都该由你决定。\n\n" +
        "只用使用者**自己绑定**的凭据，不借别人的。后台轮询**优先走米游社小组件那条接口**：" +
        "同样的账号与体力，但不吃验证码 —— 实时便笺是风控最紧的" +
        "一条，在使用者不知情的情况下每天查几次容易撞上验证码，而撞上之后使用者自己手动查也一并被挡。" +
        "小组件要 stoken，故没扫码登录过、或同一游戏下绑了多个 uid 的账号仍退回实时便笺。\n\n" +
        "查询按需进行而非固定周期：每次拿到回满秒数后推算大约几点会到阈值，故一个账号一天通常" +
        "只查两三次。使用者当场发「#体力」一律仍走实时便笺 —— 那一条要的是字段最全的一份"
    )
    .group("提醒")
    .order(1)
})
  // 不再生效的几项：配置文件里留着它们时，不声明则每次启动都报一句无法识别
  .deprecated(
    "backgroundMode",
    "backgroundImage",
    "backgroundApiProfile",
    "backgroundApiList",
    "backgroundBlurProfile",
    "backgroundBlurList"
  )

/** 配置类型 */
export type MhyConfig = Infer<typeof CONFIG_SCHEMA>

/** 只读的配置视图，`ctx.config.get()` 的返回类型 */
export type MhyConfigView = DeepReadonly<MhyConfig>
