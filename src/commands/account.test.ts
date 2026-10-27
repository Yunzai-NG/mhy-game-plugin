/**
 * 模块职责：账号类命令（CK / uid / 设备）的测试
 * 依赖方向：测试文件，依赖 commands/* 与真实的四个服务（跑在内存 KV 上）
 * 生命周期：每个用例一份内存 KV 与一份假会话
 * 注意事项：断言的是**回给用户的那句话**而非内部状态 —— 命令层唯一的产出就是文案，文案错了
 *          用户就走错下一步。最值钱的两条：群里绝不受理 Cookie、删 CK 不动 uid。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@yunzai-ng/types"
import { beforeEach, describe, expect, it } from "vitest"
import { CookiePool } from "../store/ck.js"
import { MysClient } from "../core/client.js"
import type { MhyConfigView } from "../config.js"
import { CONFIG_SCHEMA } from "../config.js"
import { DeviceStore } from "../core/device.js"
import { GachaStore } from "../store/gacha.js"
import { SignStore } from "../store/sign.js"
import { MysService } from "../service/mys.js"
import type { Session } from "../core/session.js"
import { UserStore } from "../store/user.js"
import { bindCk, ckPool, ckStatus, deleteCk } from "./ck.js"
import { bindDevice, deviceInfo, unbindDevice } from "./device.js"
import type { MhyDeps } from "./deps.js"
import { bindUid, deleteUid, myUid, switchUid } from "./uid.js"

/** 假会话，记录所有回复 */
interface Spy extends Session {
  /** 收到的全部回复 */
  readonly said: string[]
  /** 最后一句回复 */
  last(): string
}

/** 造一个假会话 */
const makeSession = (init: Partial<Session> & { answer?: string } = {}): Spy => {
  const said: string[] = []
  return {
    user: init.user ?? "qq:1",
    name: init.name ?? "旅行者",
    rest: init.rest ?? "",
    game: init.game ?? "gs",
    isPrivate: init.isPrivate ?? true,
    isMaster: init.isMaster ?? false,
    isGroupAdmin: init.isGroupAdmin ?? false,
    botId: init.botId ?? "bot-1",
    lastSent: (): string => "msg-1",
    images: init.images ?? [],
    imageBytes: async (): Promise<boolean> => false,
    imageFile: async (): Promise<boolean> => false,
    forward: async (): Promise<boolean> => false,
    said,
    last: (): string => said[said.length - 1] ?? "",
    text: async (content: string): Promise<void> => void said.push(content),
    image: async (): Promise<boolean> => false,
    ask: async (): Promise<string | undefined> => init.answer,
    file: init.file ?? (async (): Promise<undefined> => undefined),
    askFile: async (): Promise<undefined> => undefined,
    sendFile: init.sendFile ?? (async (): Promise<boolean> => false)
  }
}

/** 默认配置，由 schema 现算：抄一份就得随每个新配置项改一次，而这里在意的只有下面两项覆盖 */
const CONFIG: MhyConfigView = {
  ...CONFIG_SCHEMA.parse({}),
  metaHost: "https://example.invalid"
}

/** 测试用的米游社账号 id，取真实长度（9 位）才能验出遮蔽效果 */
const LTUID = "123456789"

/** 一份能用的 Cookie */
const CK_A = `ltuid_v2=${LTUID}; ltoken_v2=v2_a=`

/** 造一个只会回"成功"的 HTTP 替身：指纹给 fp-1，角色列表只有原神国服一个 */
const makeHttp = (): HttpClient => {
  const fail = (): never => {
    throw new Error("测试只用 request")
  }
  const http: HttpClient = {
    request: async <T>(url: string, _opts: HttpRequestOptions = {}): Promise<HttpResponse<T>> => {
      const data = url.includes("device-fp/api/getFp")
        ? { retcode: 0, data: { device_fp: "fp-1" } }
        : url.includes("game_biz=hk4e_cn")
          ? {
              retcode: 0,
              data: {
                list: [{ game_biz: "hk4e_cn", region: "cn_gf01", game_uid: "100000001", nickname: "旅行者", level: 60 }]
              }
            }
          : { retcode: 0, data: { list: [] } }
      return { status: 200, statusText: "OK", headers: {}, data: data as T, ok: true, url, cost: 1 }
    },
    get: fail,
    post: fail,
    buffer: fail,
    download: fail,
    extend: () => http
  }
  return http
}

describe("账号类命令", () => {
  let deps: MhyDeps
  let config: MhyConfigView

  beforeEach(() => {
    const kv = new Kv(new MemoryKvDriver())
    const logger = fakeLogger()
    const devices = new DeviceStore({ kv: kv.sub("device"), logger })
    const cookies = new CookiePool({
      kv: kv.sub("cookie"),
      logger,
      devices
    })
    const users = new UserStore({ kv: kv.sub("user") })
    const client = new MysClient({ http: makeHttp(), logger, devices })
    const http = makeHttp()
    config = CONFIG
    deps = {
      mys: new MysService({ client, cookies, users, logger }),
      cookies,
      users,
      devices,
      gacha: new GachaStore({ kv: kv.sub("gacha"), http, logger, gap: () => 0 }),
      signs: new SignStore({ kv: kv.sub("sign") }),
      config: (): MhyConfigView => config,
      logger
    }
  })

  describe("uid", () => {
    it("绑 uid 不需要先有 CK —— 面板、抽卡等公开数据无须 Cookie", async () => {
      const s = makeSession({ rest: "100000001" })
      await bindUid(s, deps)

      expect(s.last()).toContain("100000001")
      expect(s.last()).toContain("官服")
      expect(s.last()).toContain("← 当前")
      expect(await deps.users.uid("qq:1", "gs")).toBe("100000001")
    })

    it("uid 形态错误时给出可直接沿用的示例，且示例携带当前游戏前缀", async () => {
      const s = makeSession({ rest: "abc", game: "sr" })
      await bindUid(s, deps)

      expect(s.last()).toContain("#星铁绑定uid")
      expect(await deps.users.uids("qq:1", "sr")).toEqual([])
    })

    it("切换 uid 认序号", async () => {
      await bindUid(makeSession({ rest: "100000001" }), deps)
      await bindUid(makeSession({ rest: "100000002" }), deps)
      // 后绑的在队首，序号 2 是先绑的那个
      const s = makeSession({ rest: "2" })
      await switchUid(s, deps)

      expect(s.last()).toContain("已切到 100000001")
      expect(await deps.users.uid("qq:1", "gs")).toBe("100000001")
    })

    it("#uid2 当序号切换，而不是看列表", async () => {
      await bindUid(makeSession({ rest: "100000001" }), deps)
      await bindUid(makeSession({ rest: "100000002" }), deps)
      // 框架把命令词后的 `2` 交作 rest，myUid 据此转给切换
      const s = makeSession({ rest: "2" })
      await myUid(s, deps)

      expect(s.last()).toContain("已切到 100000001")
      expect(await deps.users.uid("qq:1", "gs")).toBe("100000001")
    })

    it("删除 uid 时序号在命令层换成 uid", async () => {
      await bindUid(makeSession({ rest: "100000001" }), deps)
      await bindUid(makeSession({ rest: "100000002" }), deps)
      const s = makeSession({ rest: "1" })
      await deleteUid(s, deps)

      expect(s.last()).toContain("已删除 100000002")
      expect(await deps.users.uids("qq:1", "gs")).toEqual(["100000001"])
    })

    it("序号越界当成没找到，不会删错", async () => {
      await bindUid(makeSession({ rest: "100000001" }), deps)
      const s = makeSession({ rest: "9" })
      await deleteUid(s, deps)

      expect(s.last()).toContain("没找到")
      expect(await deps.users.uids("qq:1", "gs")).toEqual(["100000001"])
    })

    it("没绑过时 #我的uid 直接给绑定示例", async () => {
      const s = makeSession()
      await myUid(s, deps)

      expect(s.last()).toContain("#绑定uid100000001")
    })
  })

  describe("Cookie", () => {
    it("群里绝不受理 Cookie：不落库，并让用户立刻撤回", async () => {
      const s = makeSession({ rest: CK_A, isPrivate: false })
      await bindCk(s, deps)

      expect(s.last()).toContain("立刻撤回")
      expect(s.last()).toContain("只能私聊")
      expect(await deps.cookies.list()).toEqual([])
    })

    it("私聊绑定成功：报遮蔽后的账号、查到的 uid 与固定设备说明", async () => {
      const s = makeSession({ rest: CK_A })
      await bindCk(s, deps)

      expect(s.last()).toContain("绑定成功")
      expect(s.last()).toContain(`${LTUID.slice(0, 3)}****${LTUID.slice(-2)}`)
      expect(s.last()).toContain("原神：100000001")
      expect(s.last()).toContain("固定分配一台设备")
      // 一并把 uid 绑给本人，用户不必再发一次 #绑定uid
      expect(await deps.users.uid("qq:1", "gs")).toBe("100000001")
    })

    it("未携带 Cookie 时追加询问一次，使用者无须先查阅命令格式", async () => {
      const s = makeSession({ answer: CK_A })
      await bindCk(s, deps)

      expect(s.last()).toContain("绑定成功")
    })

    it("删除 CK 仅删除 CK，使用者已绑定的 uid 予以保留", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      const s = makeSession()
      await deleteCk(s, deps)

      expect(s.last()).toContain("你绑的游戏 uid 还留着")
      expect(await deps.cookies.owned("qq:1")).toEqual([])
      expect(await deps.users.uid("qq:1", "gs")).toBe("100000001")
    })

    it("名下多条时按序号删，列表里账号打码 —— 群里也能发这条，列全串即公开名下 ltuid", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      await bindCk(makeSession({ rest: "ltuid_v2=987654321; ltoken_v2=v2_b=" }), deps)

      const ask = makeSession({ isPrivate: false })
      await deleteCk(ask, deps)
      expect(ask.last()).toContain("#删除CK2")
      expect(ask.last()).not.toContain(LTUID)
      expect(ask.last()).not.toContain("987654321")

      const order = (await deps.cookies.owned("qq:1")).map(it => it.ltuid)
      await deleteCk(makeSession({ rest: "2" }), deps)
      expect((await deps.cookies.owned("qq:1")).map(it => it.ltuid)).toEqual([order[0]])
    })

    it("删除 CK 连同自动签到开关一并清掉 —— 不清则同一账号被别人重绑后照签、结果推给新主人", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      const [record] = await deps.cookies.owned("qq:1")
      await deps.signs?.setEnabled(record?.ltuid ?? "", true)
      expect((await deps.signs?.get(record?.ltuid ?? ""))?.enabled).toBe(true)

      await deleteCk(makeSession(), deps)
      expect((await deps.signs?.get(record?.ltuid ?? ""))?.enabled).toBe(false)
    })

    it("#我的CK 报出名下 uid，不印查询次数", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      const s = makeSession()
      await ckStatus(s, deps)

      // 这份依赖没造头像库，绑定时便不为头像多打 `index`（见 commands/_face.ts 的 syncIndexInfo）
      expect(s.last()).toContain("原神 100000001")
      expect(s.last()).not.toMatch(/今日|\d+\/\d+ 次/)
    })

    it("#我的CK 停用的那条照样说明原因", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      await deps.cookies.disable(LTUID, "Cookie 已失效")
      const s = makeSession()
      await ckStatus(s, deps)

      expect(s.last()).toContain("已停用：Cookie 已失效")
    })

    it("#CK池 给出全部 CK 的概况", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      const s = makeSession({ isMaster: true })
      await ckPool(s, deps)

      expect(s.last()).toContain("Cookie 共 1 条")
      expect(s.last()).toContain("当前可用 1 条")
    })
  })

  describe("设备", () => {
    it("没有 CK 就没有设备 —— 设备是绑 CK 时分配的", async () => {
      const s = makeSession()
      await deviceInfo(s, deps)

      expect(s.last()).toContain("未绑定任何 Cookie")
    })

    it("#设备信息 说明当前用的是哪台、够不够一天", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      const s = makeSession()
      await deviceInfo(s, deps)

      expect(s.last()).toContain("分配的虚拟设备")
      expect(s.last()).toContain("还没满一天")
    })

    it("群里不展示完整 device_id", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      const full = await deps.devices.use(LTUID)
      const group = makeSession({ isPrivate: false })
      await deviceInfo(group, deps)

      expect(group.last()).not.toContain(full.id)
      expect(group.last()).toContain(full.id.slice(0, 8))
    })

    it("绑真机后请求改用它，fp 一并存下", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      const s = makeSession({ rest: "x-rpc-device_id: 11111111-2222-3333-4444-555555555555\nx-rpc-device_fp: real-fp" })
      await bindDevice(s, deps)

      expect(s.last()).toContain("已把这台设备绑给名下 1 个米游社账号")
      const active = await deps.devices.use(LTUID)
      expect(active.source).toBe("bound")
      expect(active.id).toBe("11111111-2222-3333-4444-555555555555")
      expect(await deps.devices.fp(LTUID)).toBe("real-fp")
    })

    it("群里不受理绑定设备：抓包内容常混着 Cookie", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      const s = makeSession({ isPrivate: false, rest: "x-rpc-device_id: 11111111-2222-3333-4444-555555555555" })
      await bindDevice(s, deps)

      expect(s.last()).toContain("仅支持私聊")
      expect((await deps.devices.bound(LTUID))).toBeUndefined()
    })

    it("主人关掉绑定真机后直接拒绝", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      config = { ...CONFIG, allowBindDevice: false }
      const s = makeSession({ rest: "x-rpc-device_id: 11111111-2222-3333-4444-555555555555" })
      await bindDevice(s, deps)

      expect(s.last()).toContain("关闭了绑定真机")
      expect((await deps.devices.bound(LTUID))).toBeUndefined()
    })

    it("解绑回落到虚拟设备，且虚拟设备的 device_id 没变过", async () => {
      await bindCk(makeSession({ rest: CK_A }), deps)
      const before = await deps.devices.use(LTUID)
      await bindDevice(
        makeSession({ rest: "x-rpc-device_id: 11111111-2222-3333-4444-555555555555" }),
        deps
      )
      const s = makeSession()
      await unbindDevice(s, deps)

      expect(s.last()).toContain("回落至各自分配的虚拟设备")
      expect((await deps.devices.use(LTUID)).id).toBe(before.id)
    })
  })
})

