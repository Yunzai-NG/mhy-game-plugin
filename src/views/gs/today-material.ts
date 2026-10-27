/**
 * 模块职责：`#今日材料` 的视图模型 —— 按国家分组，把"今天能升谁的天赋 / 谁的武器"排出来
 * 依赖方向：纯函数，材料信息由调用方以两个取值函数传入；不碰 IO
 * 生命周期：无状态
 * 注意事项：**凌晨四点前算前一天**（游戏日切在四点，四点前查到的应仍是「昨天」那批；错了会让凌晨查询者看到明天的材料而白跑副本），见 {@link materialWeek} 第一行。
 *          **周几口径「周一为 0」**（周日 6，JS `getDay()` 是周日 0，差一天会让整张图材料全错一天），一律走 {@link weekdayOf} 折算。**排序权重含一处进位重叠、刻意保留**（末档 id 会渗进上一档，调档位会让顺序整体变）。**满级排最后**（`isMax` 减 `10^8`、必然垫底、不能调小）。
 */
import type { AvatarCardView } from "../avatar-list.js"
import { INDENT } from "../../core/text.js"

/** 轮换周期号 → 可刷日说明 */
const WEEK_TEXT: readonly string[] = ["周一/周四", "周二/周五", "周三/周六"]

/** 周日在"周一为 0"口径下的值 */
const SUNDAY = 6

/** 天赋按突破阶数各自的上限 */
const TALENT_CAP: readonly number[] = [1, 2, 4, 6, 8, 10]

/** 原神角色 id 的公共前缀，排序时减掉 */
const CHAR_ID_BASE = 10000000

/**
 * 本仓库自带的国家图标，值相对 `_res_path`
 *
 * **写死是对的**：它描述的是 `resources/` 下**已提交**的文件（不会在运行期凭空多出来）。缺图的国家（至冬）不出 `<img>` 只留文字标题，胜过指向 404；补了图在此加一行。
 */
const CITY_ICON: Readonly<Record<string, string>> = {
  蒙德: "gs/area-mat/蒙德.png",
  璃月: "gs/area-mat/璃月.png",
  稻妻: "gs/area-mat/稻妻.png",
  须弥: "gs/area-mat/须弥.png",
  枫丹: "gs/area-mat/枫丹.png",
  纳塔: "gs/area-mat/纳塔.png",
  挪德卡莱: "gs/area/挪德卡莱.png"
}

/**
 * 取一个国家的图标
 * @param city 国家名
 * @returns 相对 `_res_path` 的路径；没有图时空串
 */
export function cityIcon(city: string): string {
  return CITY_ICON[city] ?? ""
}

/**
 * 折算成"周一为 0、周日为 6"的周几（材料可刷日按这一口径排列，见文件头）
 * @param date 日期
 * @returns 0 起的周几
 */
export function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7
}

/** 认出来的查询日 */
export interface MaterialDay {
  /** 周日时为真，此时全部材料都可刷，不必分组 */
  sunday: boolean
  /** 轮换周期号，`1` / `2` / `3`；周日时为 0 */
  week: number
  /** 「周一/周四」一类的说明，出图时放在标题旁 */
  label: string
}

/**
 * 从消息里认出要查哪一天
 *
 * 三条依次生效：四点前算前一天（游戏日切在四点）；带「明天」再加一天，**加在第一条之后**（凌晨两点说「明天」指那个游戏日的后一天，故结果是当天而非次日 —— 反直觉但正是日切口径）；带「周N」整个覆盖前两条。
 * @param text 消息原文
 * @param now 当前时间，测试里可固定
 * @returns 认出来的查询日
 */
export function materialWeek(text: string, now: Date = new Date()): MaterialDay {
  const at = new Date(now.getTime())
  if (at.getHours() < 4) at.setDate(at.getDate() - 1)
  if (/明天|明日/.test(text)) at.setDate(at.getDate() + 1)

  let day = weekdayOf(at)
  const picked = /周([1-7]|一|二|三|四|五|六|日)/.exec(text)?.[1]
  if (picked) {
    const num = Number(picked) || "一二三四五六日".indexOf(picked) + 1
    day = num - 1
  }

  if (day === SUNDAY) return { sunday: true, week: 0, label: "周日" }
  const week = (day % 3) + 1
  return { sunday: false, week, label: WEEK_TEXT[week - 1] ?? "" }
}

/** 一个角色在今日材料里的输入形态 */
export interface TodayChar {
  /** 角色 id */
  id: string
  /** 角色名 */
  name: string
  /** 等级 */
  level: number
  /** 命座 */
  cons: number
  /** 星级 */
  star: number
  /** 头像，相对元数据根目录 */
  face: string
  /** 突破阶数，判"当前阶数下天赋已满"要用；缺失时按满级 10 判 */
  promote?: number
  /** 天赋等级，不含命座加成；没有面板数据时不传 */
  talent?: Readonly<Record<string, number>>
  /** 该角色的天赋书全名，取自元数据的 `materials.talent` */
  material?: string
}

/** 一把已装备武器在今日材料里的输入形态 */
export interface TodayWeapon {
  /** 武器 id */
  id: string
  /** 全名 */
  name: string
  /** 简称，格子窄故模板用它 */
  abbr: string
  /** 星级 */
  star: number
  /** 等级 */
  level: number
  /** 精炼 */
  affix: number
  /** 突破阶数，判满级要用 */
  promote?: number
  /** 图标，相对元数据根目录 */
  icon: string
  /** 持有者的侧脸，画在武器格子角上 */
  face: string
  /** 该武器的材料全名，取自元数据的 `materials.weapon` */
  material?: string
}

/** 一个角色连同其武器 */
export interface TodayAvatar {
  /** 角色 */
  char: TodayChar
  /** 已装备武器；没有时不传 */
  weapon?: TodayWeapon
}

/** 分组标题上的材料信息 */
export interface TodayMaterialHead {
  /** 全名 */
  name: string
  /** 所属国家 */
  city: string
  /** 「周一/周四」 */
  source: string
  /** 最高阶的图标，相对元数据根目录 */
  icon: string
  /** 星级阶梯的图标，高阶在前 */
  icons: string[]
}

/** 分组里的一个角色格子 */
export interface TodayCharCell extends Record<string, unknown> {
  /** 角色 id */
  id: string
  /** 角色名 */
  name: string
  /** 等级 */
  level: number
  /** 命座 */
  cons: number
  /** 星级 */
  star: number
  /** 头像 */
  face: string
  /** 天赋，模板逐个画格子 */
  talent: { key: string; level: number; original: number }[]
  /** 当前突破阶数下天赋已点满，模板据此置灰 */
  isMax: boolean
}

/** 分组里的一个武器格子 */
export interface TodayWeaponCell extends Record<string, unknown> {
  /** 武器 id */
  id: string
  /** 简称 */
  abbr: string
  /** 星级 */
  star: number
  /** 等级 */
  level: number
  /** 精炼 */
  affix: number
  /** 图标 */
  icon: string
  /** 持有者侧脸 */
  face: string
  /** 已突破满，模板据此置灰 */
  isMax: boolean
}

/** 一类材料在一个国家下的一格 */
export interface TodayBucket {
  /** 标题上的材料信息 */
  material: TodayMaterialHead
  /** 角色格子，仅 `talent` 类有 */
  data: (TodayCharCell | TodayWeaponCell)[]
}

/** 一个国家的一组 */
export interface TodayCity {
  /** 国家名 */
  city: string
  /** 国家图标，相对 `_res_path`；没有图时空串 */
  cityIcon: string
  /** 轮换周期号 */
  week: number
  /** 天赋书那一格 */
  talent?: TodayBucket
  /** 武器材料那一格 */
  weapon?: TodayBucket
}

/** 今日材料视图 */
export interface TodayMaterialView extends Record<string, unknown> {
  /** uid */
  uid: string
  /** 「周一/周四」，放在标题旁 */
  day: string
  /** 逐国家的分组 */
  data: TodayCity[]
  /** 角色 id → 整卡（与角色列表同一张），由命令层并进来；缺这一位时模板退回头像那一格 */
  cards?: Readonly<Record<string, AvatarCardView>>
}

/** 造视图要用的两个取值函数 */
export interface TodayMaterialDeps {
  /** 按全名取材料，返回其国家与轮换周期 */
  material: (name: string) => { name: string; city?: string; cid?: number; week?: number; source: string; icon: string } | undefined
  /** 按全名取星级阶梯图标，高阶在前 */
  ladder: (name: string) => string[]
}

/**
 * 算一格的排序权重
 *
 * 含其中的进位重叠，理由见文件头。
 * @param parts 四项权重，从最重要到最不重要
 * @param isMax 是否已满
 * @returns 权重，越大越靠前
 */
export function sortWeight(parts: readonly number[], isMax: boolean): number {
  let sort = 0
  for (let at = 0; at <= 3; at++) sort += (parts[at] ?? 0) * 10 ** (6 - 2 * at)
  if (isMax) sort -= 10 ** 8
  return sort
}

/**
 * 判一个角色在当前突破阶数下天赋是否已满
 *
 * **上限随突破阶数走**、不是恒为 10（四阶角色天赋只能点到 6，那时「今天刷了也没用」故该置灰）。天赋数据缺失时不置灰 —— 那只说明本地没有面板数据，不说明已点满。
 * @param talent 天赋等级，不含命座加成
 * @param promote 突破阶数
 * @returns 已满时为真
 */
export function isMaxTalent(talent: Readonly<Record<string, number>> | undefined, promote?: number): boolean {
  const levels = Object.values(talent ?? {}).map(one => Number(one) || 0)
  if (levels.length === 0) return false
  const cap = TALENT_CAP[(promote ?? 0) - 1] ?? 10
  return Math.min(...levels) >= cap
}

/**
 * 判一把武器是否已突破满
 *
 * 上限按星级分档：原神 1~2 星是四阶，其余六阶。
 * @param star 星级
 * @param promote 突破阶数
 * @returns 已满时为真
 */
export function isMaxWeapon(star: number, promote?: number): boolean {
  if (promote === undefined) return false
  return promote >= (star <= 2 ? 4 : 6)
}

/** 排序用的一格：权重与格子本身分开，权重不进模板 */
interface Weighted {
  /** 权重，越大越靠前 */
  sort: number
  /** 格子 */
  cell: TodayCharCell | TodayWeaponCell
}

/** 装配中的一个国家分组 */
interface Building {
  /** 国家名 */
  city: string
  /** 轮换周期号 */
  week: number
  /** 天赋书那一格 */
  talent?: { material: TodayMaterialHead; list: Weighted[] }
  /** 武器材料那一格 */
  weapon?: { material: TodayMaterialHead; list: Weighted[] }
}

/**
 * 按权重排好一格
 *
 * 稳定升序后整体反转 —— 权重相等时次序与压入次序相反。
 * @param list 带权重的格子
 * @returns 排好的格子
 */
function ordered(list: readonly Weighted[]): (TodayCharCell | TodayWeaponCell)[] {
  return [...list]
    .sort((a, b) => a.sort - b.sort)
    .reverse()
    .map(one => one.cell)
}

/**
 * 装配今日材料视图
 *
 * 分组键是国家序号而非国家名：名字可能为空（元数据出了新国家而名字表没跟上），按名字分组会把两个未知国家并成一组。**次序是国家序号倒序**（新国家在前）：逐国家结果按 `unshift` 压入，而对象以整数键升序枚举，两者相抵即倒序。
 * @param opts 选项
 * @param deps 两个取值函数
 * @returns 视图
 */
export function buildTodayMaterial(
  opts: {
    /** uid */
    uid: string
    /** 轮换周期号，`1` / `2` / `3` */
    week: number
    /** 全部角色 */
    avatars: readonly TodayAvatar[]
    /** 「周一/周四」，放在标题旁 */
    day?: string
  },
  deps: TodayMaterialDeps
): TodayMaterialView {
  const groups = new Map<number, Building>()

  /**
   * 把一格并进对应的国家分组
   * @param name 材料全名
   * @param kind 材料类别
   * @param cell 格子
   * @param parts 排序权重的四项
   * @param isMax 是否已满
   */
  const add = (
    name: string | undefined,
    kind: "talent" | "weapon",
    cell: TodayCharCell | TodayWeaponCell,
    parts: readonly number[],
    isMax: boolean
  ): void => {
    if (!name) return
    const mat = deps.material(name)
    // 不是今天这一档的材料直接丢掉 —— 这正是"今日"二字的全部含义
    if (!mat || Number(mat.week) !== opts.week) return
    const cid = Number(mat.cid) || 0
    if (!cid) return

    let group = groups.get(cid)
    if (!group) {
      group = { city: mat.city ?? "", week: Number(mat.week) || 0 }
      groups.set(cid, group)
    }
    let bucket = group[kind]
    if (!bucket) {
      bucket = {
        material: {
          name: mat.name,
          city: mat.city ?? "",
          source: mat.source,
          icon: mat.icon,
          icons: deps.ladder(name)
        },
        list: []
      }
      group[kind] = bucket
    }
    bucket.list.push({ sort: sortWeight(parts, isMax), cell })
  }

  for (const one of opts.avatars) {
    const char = one.char
    const talentMax = isMaxTalent(char.talent, char.promote)
    const cell: TodayCharCell = {
      id: char.id,
      name: char.name,
      level: char.level,
      cons: char.cons,
      star: char.star,
      face: char.face,
      // 本仓库只存不含命座加成的天赋等级，故 `level` 与 `original` 同值 —— 模板据后者画皇冠，
      // 据两者不等画"命座加成"的蓝字，于是那个蓝字不会出现。少一处装饰，不影响这张图的用处
      talent: Object.entries(char.talent ?? {}).map(([key, lv]) => ({
        key,
        level: Number(lv) || 0,
        original: Number(lv) || 0
      })),
      isMax: talentMax
    }
    add(char.material, "talent", cell, [char.level, char.star, char.cons, Number(char.id) - CHAR_ID_BASE], talentMax)

    const weapon = one.weapon
    if (!weapon) continue
    const weaponMax = isMaxWeapon(weapon.star, weapon.promote)
    const wCell: TodayWeaponCell = {
      id: weapon.id,
      abbr: weapon.abbr,
      star: weapon.star,
      level: weapon.level,
      affix: weapon.affix,
      icon: weapon.icon,
      face: weapon.face,
      isMax: weaponMax
    }
    add(
      weapon.material,
      "weapon",
      wCell,
      [weapon.level, weapon.star, weapon.affix, Number(weapon.id) / 100],
      weaponMax
    )
  }

  const data: TodayCity[] = [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, group]) => {
      const city: TodayCity = {
        city: group.city,
        cityIcon: cityIcon(group.city),
        week: group.week
      }
      if (group.talent) city.talent = { material: group.talent.material, data: ordered(group.talent.list) }
      if (group.weapon) city.weapon = { material: group.weapon.material, data: ordered(group.weapon.list) }
      return city
    })

  return { uid: opts.uid, day: opts.day ?? WEEK_TEXT[opts.week - 1] ?? "", data }
}

/**
 * 今日材料视图 → 纯文字
 *
 * 没有渲染器时用。逐国家一行，角色只列名字与等级 —— 天赋格子那种信息在纯文本里排不开。
 * @param view 视图
 * @returns 多行文本
 */
export function todayMaterialText(view: TodayMaterialView): string {
  if (view.data.length === 0) return "今天没有可刷的材料对应到你的角色"

  const lines = [`UID${view.uid}${INDENT}${view.day} 可刷`]
  for (const city of view.data) {
    for (const kind of ["talent", "weapon"] as const) {
      const bucket = city[kind]
      if (!bucket || bucket.data.length === 0) continue
      const names = bucket.data
        .map(one => `${String(one["name"] ?? one["abbr"] ?? "")}${one["isMax"] ? "(满)" : ""}`)
        .join("、")
      lines.push(`${city.city}${INDENT}${bucket.material.name}${INDENT}${names}`)
    }
  }
  return lines.join("\n")
}
