/**
 * 模块职责：设备身份派生与设备存储的测试
 * 依赖方向：测试文件，依赖 device.ts / device-profile.ts 与内核 testing 包
 * 生命周期：每个用例一份内存 KV
 * 注意事项：固定唯一一条必须成立的性质 —— **同一账号始终得到同一台设备**（设备漂移即成片验证码），含「存储全丢后重算仍一致」。KV 用真实 MemoryKvDriver，序列化行为本身也在被测之列。
 */
import { Kv, MemoryKvDriver } from "@yunzai-ng/core"
import { fakeLogger } from "@yunzai-ng/core/testing"
import type { KvNamespace } from "@yunzai-ng/types"
import { beforeEach, describe, expect, it } from "vitest"
import { DeviceStore, deviceIdFromOaid, isBlankOaid, parseBoundDevice, parseFingerprint } from "./device.js"
import {
  DEVICE_CATALOG,
  PLACEHOLDER_FP,
  androidExtFields,
  deriveDevice,
  deviceHeaders,
  deviceUserAgent,
  fpRequestBody
} from "./device-profile.js"

/** 一天的毫秒数 */
const DAY = 24 * 60 * 60 * 1000

/** 大写 UUID 的形态 */
const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/

describe("deriveDevice", () => {
  it("同一个账号始终派生出同一台设备", () => {
    const a = deriveDevice("114514", 1000)
    const b = deriveDevice("114514", 1000)

    // ext_fields 每个值都会被服务端读取，故逐字段比
    expect(a).toEqual(b)
  })

  it("不同账号获得不同设备", () => {
    const ids = new Set(["1", "2", "3", "4", "5", "6", "7", "8"].map(id => deriveDevice(id).id))
    expect(ids.size).toBe(8)
  })

  it("device_id 是大写 v4 UUID，机型取自目录", () => {
    const device = deriveDevice("m1_abcdef")

    expect(device.id).toMatch(UUID_RE)
    expect(DEVICE_CATALOG).toContain(device.spec)
    expect(device.name).toBe(device.spec.marketName)
    expect(device.source).toBe("virtual")
  })

  it("随机身份字段互不相同，且均为稳定取值", () => {
    const device = deriveDevice("2000001")
    const { oaid, aaid, vaid, serial, androidId, seedId } = device.ids

    expect(new Set([oaid, aaid, vaid, seedId]).size).toBe(4)
    expect(serial).toMatch(/^[0-9A-F]{16}$/)
    expect(androidId).toMatch(/^[0-9a-f]{16}$/)
    expect(deriveDevice("2000001").ids).toEqual(device.ids)
  })
})

describe("androidExtFields", () => {
  it("与机型规格自洽，两次生成结果完全一致", () => {
    const device = deriveDevice("300000001")
    const first = androidExtFields(device)
    const fields = JSON.parse(first) as Record<string, string>

    // 服务端会将 ext_fields 与请求头相互核对
    expect(fields["model"]).toBe(device.spec.model)
    expect(fields["brand"]).toBe(device.spec.brand)
    expect(fields["osVersion"]).toBe(device.spec.osVersion)
    expect(fields["screenSize"]).toBe(device.spec.screen)
    expect(fields["sdkVersion"]).toBe(String(device.spec.sdk))
    expect(fields["board"]).toBe(device.spec.board)
    expect(fields["oaid"]).toBe(device.ids.oaid)
    expect(fields["deviceInfo"]).toContain(device.spec.buildId)

    // 传感器读数每次上报须一致
    expect(androidExtFields(device)).toBe(first)
    expect(fields["accelerometer"]?.split(",")).toHaveLength(3)
    expect(fields["gyroscope"]?.split(",")).toHaveLength(3)
  })

  it("剩余容量小于总容量", () => {
    const fields = JSON.parse(androidExtFields(deriveDevice("40000001"))) as Record<string, string>

    expect(Number(fields["romRemain"])).toBeLessThan(Number(fields["romCapacity"]))
    expect(Number(fields["ramRemain"])).toBeGreaterThan(0)
  })
})

describe("fpRequestBody", () => {
  const device = deriveDevice("50000001")

  it("国服使用 bbs_cn，首次携带占位 fp，seed_id 取设备自带的取值", () => {
    const body = fpRequestBody(device, "cn")

    expect(body["app_name"]).toBe("bbs_cn")
    // 一律按 Android 上报，与 UA 不符本身即是可识别的特征
    expect(body["platform"]).toBe("2")
    expect(body["device_id"]).toBe(device.id)
    expect(body["seed_id"]).toBe(device.ids.seedId)
    expect(body["device_fp"]).toBe(PLACEHOLDER_FP)
    expect(body["hoyolab_device_id"]).toBeUndefined()
  })

  it("国际服更换 app_name 并补充 hoyolab_device_id", () => {
    const body = fpRequestBody(device, "os")

    expect(body["app_name"]).toBe("bbs_oversea")
    expect(body["hoyolab_device_id"]).toBe(device.ids.seedId)
  })

  it("携带旧 fp 时以旧值续取，而非从占位值重新开始", () => {
    expect(fpRequestBody(device, "cn", "abcdef123")["device_fp"]).toBe("abcdef123")
  })
})

describe("deviceHeaders / deviceUserAgent", () => {
  const device = deriveDevice("60000001")

  it("四项请求头取自同一台设备，无 fp 时使用占位值", () => {
    expect(deviceHeaders(device)).toEqual({
      "x-rpc-device_id": device.id,
      "x-rpc-device_fp": PLACEHOLDER_FP,
      "x-rpc-device_name": device.name,
      "x-rpc-device_model": device.spec.model,
      "x-rpc-sys_version": device.spec.osVersion
    })
    expect(deviceHeaders(device, "myfp")["x-rpc-device_fp"]).toBe("myfp")
  })

  it("UA 中的系统版本与机型与请求头保持一致", () => {
    const ua = deviceUserAgent(device, "2.40.1")

    expect(ua).toContain(`Android ${device.spec.osVersion}; ${device.spec.model}`)
    expect(ua).toContain("miHoYoBBS/2.40.1")
    expect(deviceUserAgent(device, "2.55.0", "os")).toContain("miHoYoBBSOversea/2.55.0")
  })
})

describe("parseBoundDevice", () => {
  it("识别抓包所得的 JSON", () => {
    const input = parseBoundDevice('{"device_id":"a1b2c3d4e5f60718","device_fp":"38d7f2352506c","device_name":"我的手机"}')

    expect(input).toEqual({ id: "A1B2C3D4E5F60718", fp: "38d7f2352506c", name: "我的手机" })
  })

  it("识别每行一条的 key=value 与冒号分隔形式", () => {
    const lines = parseBoundDevice("device_id = a1b2c3d4e5f60718\ndevice_fp = 38d7f2352506c\nmodel: 2211133C")

    expect(lines).toEqual({ id: "A1B2C3D4E5F60718", fp: "38d7f2352506c", model: "2211133C" })
    // 全角冒号是移动端输入法的默认输出
    expect(parseBoundDevice("device_id：a1b2c3d4e5f60718")?.id).toBe("A1B2C3D4E5F60718")
  })

  it("同样识别带 x-rpc- 前缀的请求头名", () => {
    const input = parseBoundDevice("x-rpc-device_id=a1b2c3d4e5f60718\nx-rpc-sys_version=14")
    expect(input).toEqual({ id: "A1B2C3D4E5F60718", osVersion: "14" })
  })

  it("既无 device_id 又无 oaid 时不视为绑定", () => {
    // 只有 fp 无从标识设备，绑了只会让 fp 与虚拟设备错配
    expect(parseBoundDevice("device_fp=38d7f2352506c")).toBeUndefined()
    expect(parseBoundDevice("device_id=短")).toBeUndefined()
    expect(parseBoundDevice("")).toBeUndefined()
  })

  it("识别真机工具给的 camelCase 形态 —— 那才是使用者真正会粘贴的东西", () => {
    // 真实输入：**没有 device_id**，只有 oaid
    const input = parseBoundDevice(
      '{"deviceModel":"AB1234X","androidVersion":"14","deviceFingerprint":"acme/AB1234/AB1234:14/UP1A.231005.007/eng.20240101.120000:user/release-keys","deviceName":"AB1234","deviceBoard":"demo","deviceProduct":"AB1234","oaid":"ffd1572e621211e211b07673bc797edcb96078e128451803d2d1939d7ac1ab73"}'
    )

    expect(input?.model).toBe("AB1234X")
    expect(input?.osVersion).toBe("14")
    expect(input?.name).toBe("AB1234")
    expect(input?.board).toBe("demo")
    expect(input?.product).toBe("AB1234")
    // device_id 由 oaid 确定性派生
    expect(input?.id).toBe("FFD1572E-6212-11E2-11B0-7673BC797EDC")
    expect(input?.brand).toBe("acme")
  })

  it("oaid 派生的 device_id 是稳定的 —— 那正是「常用设备」要的性质", () => {
    const one = parseBoundDevice('{"oaid":"ffd1572e621211e211b07673bc797edc"}')
    const two = parseBoundDevice('{"oaid":"ffd1572e621211e211b07673bc797edc"}')

    expect(one?.id).toBe(two?.id)
    expect(one?.id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/)
  })

  it("显式给的 device_id 优先于 oaid 派生的", () => {
    const input = parseBoundDevice('{"device_id":"a1b2c3d4e5f60718","oaid":"ffd1572e621211e211b07673bc797edc"}')

    expect(input?.id).toBe("A1B2C3D4E5F60718")
  })

  it("全 0 或 error 的 oaid 当作没有 —— 拿它派生，所有没开匿名标识的手机就共用同一个 device_id", () => {
    const zero = "0".repeat(64)
    expect(parseBoundDevice(`{"deviceModel":"AB1234X","oaid":"${zero}"}`)).toBeUndefined()
    expect(parseBoundDevice('{"oaid":"error_1008003"}')).toBeUndefined()
    expect(isBlankOaid(zero)).toBe(true)
    expect(isBlankOaid("00000000-0000-0000-0000-000000000000")).toBe(true)
    expect(isBlankOaid("ffd1572e621211e211b07673bc797edc")).toBe(false)
    // 显式给了 device_id 时照样能绑，只是不把那串 0 当 oaid 存下来、写进请求
    const withId = parseBoundDevice(`{"device_id":"a1b2c3d4e5f60718","oaid":"${zero}"}`)
    expect(withId?.id).toBe("A1B2C3D4E5F60718")
    expect(withId?.oaid).toBeUndefined()
  })
})

describe("parseFingerprint", () => {
  it("拆出五项，其中构建号与增量版本只有指纹串里有", () => {
    const got = parseFingerprint(
      "acme/AB1234/AB1234:14/UP1A.231005.007/eng.20240101.120000:user/release-keys"
    )

    expect(got).toEqual({
      brand: "acme",
      product: "AB1234",
      osVersion: "14",
      buildId: "UP1A.231005.007",
      incremental: "eng.20240101.120000"
    })
  })

  it("形态不符时给空对象，不抛错 —— 少几项字段不该让整次绑定失败", () => {
    expect(parseFingerprint("随便一串")).toEqual({})
    expect(parseFingerprint("")).toEqual({})
  })
})

describe("deviceIdFromOaid", () => {
  it("取前 32 位十六进制并按 UUID 分段", () => {
    expect(deviceIdFromOaid("ffd1572e621211e211b07673bc797edcb96078e128451803d2d1939d7ac1ab73")).toBe(
      "FFD1572E-6212-11E2-11B0-7673BC797EDC"
    )
  })

  it("短于 32 位时用自身补足，仍是稳定输出", () => {
    const got = deviceIdFromOaid("abc123")

    expect(got).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/)
    expect(deviceIdFromOaid("abc123")).toBe(got)
  })
})

describe("DeviceStore", () => {
  /** 一个看起来像真机抓来的 device_id */
  const REAL_ID = "A1B2C3D4E5F60718"
  let kv: KvNamespace
  let clock: number

  /** 造一个设备存储，时钟可控 */
  const make = (fpMaxAge?: number): DeviceStore =>
    new DeviceStore({ kv, logger: fakeLogger(), now: () => clock, ...(fpMaxAge ? { fpMaxAge } : {}) })

  beforeEach(() => {
    kv = new Kv(new MemoryKvDriver())
    clock = 1_700_000_000_000
  })

  it("绑定 Cookie 时分配设备，之后反复取都是同一台，首次分配时间不动", async () => {
    const store = make()
    const first = await store.assign("114514")

    clock += 5 * DAY
    const second = await store.assign("114514")

    // 重写 createdAt 等于把养了五天的常用设备退回第一天
    expect(second).toEqual(first)
    expect(await store.use("114514")).toEqual(first)
  })

  it("存储整个丢掉也能还原同一台设备 —— 这是设备不变的最后保险", async () => {
    const store = make()
    const first = await store.assign("114514")

    await kv.clear()
    const again = await store.assign("114514")

    expect(again.id).toBe(first.id)
    expect(again.spec).toEqual(first.spec)
    expect(again.ids).toEqual(first.ids)
  })

  it("记录残缺时重算，但保留原来的首次分配时间", async () => {
    await kv.set("virtual:114514", { id: "残缺", createdAt: 42 })
    const device = await make().assign("114514")

    expect(device.id).toBe(deriveDevice("114514").id)
    expect(device.createdAt).toBe(42)
  })

  it("没绑真机时用虚拟设备，绑了就用真机", async () => {
    const store = make()
    const virtual = await store.assign("114514")
    expect(await store.use("114514")).toEqual(virtual)

    const bound = await store.bind("114514", { id: REAL_ID })
    expect(await store.use("114514")).toEqual(bound)
    expect(bound.source).toBe("bound")

    expect(await store.unbind("114514")).toBe(true)
    expect(await store.use("114514")).toEqual(virtual)
    expect(await store.unbind("114514")).toBe(false)
  })

  it("只填 device_id 也能绑：缺的机型字段拿虚拟设备补齐", async () => {
    const store = make()
    const virtual = await store.assign("114514")
    const bound = await store.bind("114514", { id: REAL_ID, model: "PJZ110", brand: "OPPO" })

    expect(bound.spec.model).toBe("PJZ110")
    expect(bound.spec.brand).toBe("OPPO")
    expect(bound.spec.manufacturer).toBe("OPPO")
    // 未填字段不得留空，否则 UA 与 ext_fields 出现空值
    expect(bound.spec.board).toBe(virtual.spec.board)
    expect(bound.spec.sdk).toBe(virtual.spec.sdk)
    expect(bound.ids).toEqual(virtual.ids)
    expect(bound.name).toBe("PJZ110")
  })

  it("fp 与 device_id 同生共死：换设备后旧 fp 自动失效，解绑后又能用", async () => {
    const store = make()
    await store.saveFp("114514", "fp-虚拟")
    expect(await store.fp("114514")).toBe("fp-虚拟")

    await store.bind("114514", { id: REAL_ID })
    // 旧 fp 属于虚拟设备，与真机 device_id 组合即不自洽
    expect(await store.fp("114514")).toBeUndefined()

    await store.unbind("114514")
    expect(await store.fp("114514")).toBe("fp-虚拟")
  })

  it("绑定时携带真机的 fp 即直接沿用 —— 该指纹已在真机上养成", async () => {
    const store = make()
    await store.bind("114514", { id: REAL_ID, fp: "fp-真机" })

    expect(await store.fp("114514")).toBe("fp-真机")
  })

  it("fp 超过复用上限就作废，重新取", async () => {
    const store = make(DAY)
    await store.saveFp("114514", "fp-旧")

    clock += DAY + 1
    expect(await store.fp("114514")).toBeUndefined()
  })

  it("dropFp 只丢指纹，不动设备", async () => {
    const store = make()
    const device = await store.use("114514")
    await store.saveFp("114514", "fp")

    await store.dropFp("114514")

    expect(await store.fp("114514")).toBeUndefined()
    // 丢 fp 不得连带重置设备
    expect((await store.use("114514")).id).toBe(device.id)
    expect((await store.use("114514")).createdAt).toBe(device.createdAt)
  })

  it("满一天才算常用设备", async () => {
    const store = make()
    await store.assign("114514")
    expect(await store.trusted("114514")).toBe(false)

    clock += DAY
    expect(await store.trusted("114514")).toBe(true)

    // 绑新真机相当于换设备，重新从第一天算
    await store.bind("114514", { id: REAL_ID })
    expect(await store.trusted("114514")).toBe(false)
  })

  it("describe 给出当前用的是哪台、有没有指纹", async () => {
    const store = make()
    const plain = await store.describe("114514")

    expect(plain.active).toEqual(plain.virtual)
    expect(plain.bound).toBeUndefined()
    expect(plain.trusted).toBe(false)
    expect(plain.hasFp).toBe(false)

    await store.bind("114514", { id: REAL_ID, fp: "fp-真机" })
    clock += DAY
    const bound = await store.describe("114514")

    expect(bound.bound?.id).toBe(REAL_ID)
    expect(bound.active).toEqual(bound.bound)
    expect(bound.virtual.source).toBe("virtual")
    expect(bound.trusted).toBe(true)
    expect(bound.hasFp).toBe(true)
  })

  it("删 Cookie 时清干净，但重新绑还是同一台设备", async () => {
    const store = make()
    const first = await store.assign("114514")
    await store.bind("114514", { id: REAL_ID, fp: "fp" })

    await store.forget("114514")

    expect(await store.bound("114514")).toBeUndefined()
    expect(await store.fp("114514")).toBeUndefined()

    clock += DAY
    const again = await store.assign("114514")
    expect(again.id).toBe(first.id)
    expect(again.createdAt).toBe(clock)
  })

  it("不同账号各自一台设备，互不影响", async () => {
    const store = make()
    const a = await store.assign("100000001")
    const b = await store.assign("200000002")

    expect(a.id).not.toBe(b.id)
    await store.bind("100000001", { id: REAL_ID })
    expect((await store.use("200000002")).id).toBe(b.id)
  })
})
