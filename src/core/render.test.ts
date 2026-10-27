/**
 * 模块职责：渲染桥的测试 —— 倍率样式、补齐给模板的路径变量、`{META}` 记号、`_hash` 与 `_skin`
 * 依赖方向：测试文件，只依赖 core/render；不真渲染、无 IO
 * 生命周期：无状态，每个用例新造一个渲染桥
 * 注意事项：钉的都是**错了只出一张空白或发糊的图**的地方：布局变量须是文件系统路径、资源变量须是
 *          带尾斜杠的 file:// URL，`sys.scale` 恒被改写（行内倍率会压掉 css 里的基准，图就糊了）。
 */
import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import { META_TOKEN, RenderBridge, isTemplatePath, scaleStyle } from "./render.js"

/**
 * 一个形态与真实 `ctx.root` 一致的绝对路径
 *
 * 由 `resolve` 取当前平台的绝对形态：写死 `C:` 盘符在 Linux 上不算绝对路径，CI 上那几条判「是不是绝对路径」的断言就红。
 */
const ROOT = resolve(sep, "yz", "plugins", "mhy-game-plugin")

/**
 * 造一个渲染桥
 * @param version 版本号
 * @returns 渲染桥
 */
function bridge(version = "0.1.0"): RenderBridge {
  return new RenderBridge(ROOT, () => version)
}

/**
 * 目录绝对路径 → 带尾斜杠的 file URL，与实现内部算法一致
 * @param parts 路径片段
 * @returns 目录 URL
 */
function url(...parts: string[]): string {
  return `${pathToFileURL(join(ROOT, ...parts)).href}/`
}

describe("scaleStyle", () => {
  it("两项都恒等时是空串 —— 这一条决定了每张图糊不糊", () => {
    // 基准倍率在各模板 css 里，行内样式压得过样式表：恒输出 scale(1) 会把基准逐个压成 1 倍
    expect(scaleStyle()).toBe("")
    expect(scaleStyle(undefined, 100)).toBe("")
  })

  it("给出的是属性文本而不是数字 —— 既有模板直接写在 body 标签里", () => {
    // 原样代入 `<body {{sys.scale}}>` 会渲染出 `<body 1>`
    expect(scaleStyle(1.4)).toBe("style=transform:scale(1.4)")
  })

  it("全局精度用 zoom —— 同一元素上第二个 transform 是替换而非叠加", () => {
    expect(scaleStyle(undefined, 150)).toBe("style=zoom:1.5")
    expect(scaleStyle(1.4, 150)).toBe("style=transform:scale(1.4);zoom:1.5")
  })

  it("各段之间不带空格 —— 属性值没有引号，有空格就断在那里", () => {
    expect(scaleStyle(2, 200)).not.toContain(" ")
  })

  it("精度夹到 50~200，基准夹到 0.5~4", () => {
    expect(scaleStyle(undefined, 10)).toBe("style=zoom:0.5")
    expect(scaleStyle(undefined, 900)).toBe("style=zoom:2")
    expect(scaleStyle(0.1)).toBe("style=transform:scale(0.5)")
    expect(scaleStyle(9)).toBe("style=transform:scale(4)")
  })
})

describe("RenderBridge.dress", () => {
  it("布局别名是绝对文件系统路径 —— 模板引擎在编译期解析它", () => {
    // 填成 file:// URL 时引擎拼成 `<模板根>/file:/C:/…` 报 ENOENT，全部继承布局的模板同时失效
    const data = bridge().dress({})
    const layout = join(ROOT, "templates", "layout")
    expect(data["skinLayout"]).toBe(join(layout, "skin.html"))
    for (const key of ["_layout_path", "_tpl_path"]) {
      expect(isTemplatePath(String(data[key])), key).toBe(true)
    }
  })

  it("公共片段目录指向 templates/common —— include(_tpl_path + '/x.html') 按它取文件", () => {
    expect(bridge().dress({})["_tpl_path"]).toBe(join(ROOT, "templates", "common"))
  })

  describe("元数据文案里的 {META} 记号", () => {
    /** 元数据根目录的绝对路径与 URL */
    const metaDir = join(ROOT, "..", "..", "data", "meta")
    const metaUrl = `${pathToFileURL(metaDir).href}/`

    /**
     * 造一个带元数据根的渲染桥
     * @returns 渲染桥
     */
    const withMeta = (): RenderBridge => new RenderBridge(ROOT, () => "0.1.0", metaDir)

    // 绝区零技能文案里带 `{META}…` 图标、模板走 `{{@desc}}` 原样输出拼不进根，故由渲染桥换；不换则图裂
    it("字符串里的记号换成元数据根 URL", () => {
      const got = withMeta().dress({ desc: `<img src="${META_TOKEN}character/common/imgs/talent-basic.webp"/>` })

      expect(got["desc"]).toBe(`<img src="${metaUrl}character/common/imgs/talent-basic.webp"/>`)
    })

    it("嵌在数组与对象深处的也换 —— 技能文案就在 talent.basic.desc[3] 这种位置上", () => {
      const got = withMeta().dress({
        detail: { talent: { basic: { desc: ["前一句", `点按 ${META_TOKEN}a.webp 发动`] } } }
      })
      const detail = got["detail"] as { talent: { basic: { desc: string[] } } }

      expect(detail.talent.basic.desc[1]).toBe(`点按 ${metaUrl}a.webp 发动`)
      expect(detail.talent.basic.desc[0]).toBe("前一句")
    })

    it("同一行里的多个记号都换", () => {
      const got = withMeta().dress({ desc: `${META_TOKEN}a.webp 或 ${META_TOKEN}b.webp` })

      expect(got["desc"]).toBe(`${metaUrl}a.webp 或 ${metaUrl}b.webp`)
    })

    it("一个记号都没有时原样返回那个对象 —— 绝大多数视图不该为此多一次深拷贝", () => {
      const inner = { desc: ["没有记号"] }
      const got = withMeta().dress({ inner })

      expect(got["inner"]).toBe(inner)
    })
  })

  it("资源根的三个别名指向同一个目录，且都是 URL", () => {
    const data = bridge().dress({})
    const res = url("resources")
    for (const key of ["_res_path", "pluResPath", "resPath"]) {
      expect(data[key], key).toBe(res)
    }
  })

  it("资源根带尾斜杠 —— 缺失会让 common/common.css 落到上一级", () => {
    expect(String(bridge().dress({})["_res_path"])).toMatch(/\/$/)
  })

  describe("头像库根", () => {
    /** 头像库根目录的绝对路径 */
    const faceDir = join(ROOT, "..", "..", "data", "face")

    it("给了就指向它，且是带尾斜杠的 URL —— 页头的头像按它拼", () => {
      const one = new RenderBridge(ROOT, () => "0.1.0", undefined, undefined, undefined, faceDir)
      expect(one.dress({})["_face_path"]).toBe(`${pathToFileURL(faceDir).href}/`)
    })

    // 退回资源根而非留空：空串会让模板拼出 `gs/mys/100000001.png` 这种相对路径，而中间 HTML 在临时目录
    it("没给时退回资源根", () => {
      expect(bridge().dress({})["_face_path"]).toBe(url("resources"))
    })
  })

  it("sys.scale 恒被改写，即使渲染器已注入数字", () => {
    const data = bridge().dress({ sys: { scale: 1 } })
    expect((data["sys"] as Record<string, unknown>)["scale"]).toBe("")
  })

  it("视图数据恒优先于补齐的缺省值", () => {
    const data = bridge().dress({ _skin: "skin-neutral", elem: "pyro" })
    expect(data["_skin"]).toBe("skin-neutral")
    expect(data["elem"]).toBe("pyro")
  })

  describe("命令记号 _hash", () => {
    // 漏一个游戏则图上印的记号不对，照抄发出去毫无回应
    it("按视图数据里的 game 取，三个游戏各自的记号", () => {
      expect(bridge().dress({ game: "gs" })["_hash"]).toBe("#")
      expect(bridge().dress({ game: "sr" })["_hash"]).toBe("*")
      expect(bridge().dress({ game: "zzz" })["_hash"]).toBe("%")
    })

    it("没有 game 或认不出时回落 `#` —— 不分游戏的图印原神记号最不易误导", () => {
      expect(bridge().dress({})["_hash"]).toBe("#")
      expect(bridge().dress({ game: "bh3" })["_hash"]).toBe("#")
      expect(bridge().dress({ game: 3 })["_hash"]).toBe("#")
    })

    it("视图自己给了 _hash 时以视图为准 —— 帮助图那两张自己算记号", () => {
      expect(bridge().dress({ game: "gs", _hash: "%" })["_hash"]).toBe("%")
    })
  })

  describe("皮肤根 class _skin", () => {
    // 认错游戏时整张图换成别家的配色，不报错
    it("按视图数据里的 game 取，三个游戏各自一套", () => {
      expect(bridge().dress({ game: "gs" })["_skin"]).toBe("skin-gs")
      expect(bridge().dress({ game: "sr" })["_skin"]).toBe("skin-sr")
      expect(bridge().dress({ game: "zzz" })["_skin"]).toBe("skin-zzz")
    })

    it("没有 game 或认不出时回落中性皮肤", () => {
      expect(bridge().dress({})["_skin"]).toBe("skin-neutral")
      expect(bridge().dress({ game: "bh3" })["_skin"]).toBe("skin-neutral")
    })

    it("视图数据没带 game 时按发起命令的游戏取 —— 跨游戏的视图不必逐个补字段", () => {
      // 会话层把 `e.state` 里的游戏填进 dress，故 `*体力` 出的图是星铁皮肤而非中性皮肤
      expect(bridge().dress({}, { game: "sr" })["_skin"]).toBe("skin-sr")
      // 视图数据里的 game 优先：按名字查的那几张图与发起命令的游戏可以不同
      expect(bridge().dress({ game: "gs" }, { game: "zzz" })["_skin"]).toBe("skin-gs")
    })

    it("视图自己给了 _skin 时以视图为准", () => {
      expect(bridge().dress({ game: "gs", _skin: "skin-neutral" })["_skin"]).toBe("skin-neutral")
      expect(bridge().dress({ _skin: "skin-neutral" }, { game: "sr" })["_skin"]).toBe("skin-neutral")
    })

    it("发起命令的游戏不影响 _hash —— 那一项只认视图数据", () => {
      expect(bridge().dress({}, { game: "zzz" })["_hash"]).toBe("#")
    })
  })

  it("署名带上内核与插件两份名字和版本", () => {
    const one = new RenderBridge(ROOT, () => "9.9.9", undefined, undefined, undefined, undefined, () => "0.7.1")
    expect(one.dress({})["_sign"]).toEqual({
      coreName: "Yunzai NG",
      coreVersion: "0.7.1",
      pluginName: "mhy-game-plugin",
      pluginVersion: "9.9.9"
    })
  })

  it("取不到内核版本时给空串而非 undefined —— 模板据此不印那一截", () => {
    expect((bridge().dress({})["_sign"] as { coreVersion: unknown }).coreVersion).toBe("")
  })

  it("dress 参数里的版本号覆盖插件版本", () => {
    expect((bridge("0.1.0").dress({}, { version: "2.0" })["_sign"] as { pluginVersion: string }).pluginVersion).toBe("2.0")
  })

  it("dress 参数里的倍率落进 sys.scale —— 只有 css 里没写基准的那几张图鉴才给", () => {
    const data = bridge().dress({}, { scale: 2 })
    expect((data["sys"] as Record<string, unknown>)["scale"]).toBe("style=transform:scale(2)")
  })

  it("全局精度取自构造函数那个取值函数，且随取随用", () => {
    let pct = 100
    const one = new RenderBridge(ROOT, () => "0.1.0", undefined, undefined, () => pct)
    expect((one.dress({})["sys"] as Record<string, unknown>)["scale"]).toBe("")
    pct = 150
    expect((one.dress({})["sys"] as Record<string, unknown>)["scale"]).toBe("style=zoom:1.5")
  })

  it("sys 字段是脏值时不抛错 —— 出图问题不应升级为查询失败", () => {
    const data = bridge().dress({ sys: "oops" })
    expect((data["sys"] as Record<string, unknown>)["scale"]).toBe("")
  })
})
