/**
 * 模块职责：从元数据的技能倍率表里挑出「该算哪几刀」，并按技能等级取倍率
 * 依赖方向：只依赖 meta/loader 的 `MetaDetail` 类型；纯函数，不读文件
 * 生命周期：无状态
 * 注意事项：倍率来自元数据、不为每位代理人手写。**只取行名以「伤害倍率」结尾的行**、失衡倍率不取（否则多几刀假伤害）；用 `includes` 会误取「对小体型敌人伤害倍率」，那是同一刀三个体型分支、**只取中体型一个**（否则一刀记三遍）。
 *          技能等级按族取（六栏各自升级，取错栏伤害偏差）。**`isSame` 的行只存一条**，按等级取值前先判长度、否则 12 级角色取到 undefined 算出 0 倍率。**倍率字符串带百分号要折小数**（`"328.6%"`→`3.286`），不折伤害大一百倍。
 */
import type { MetaDetail } from "../../../meta/loader.js"
import type { ZzzSkill } from "./calc.js"

/**
 * 元数据的技能族 → 技能类型前缀
 *
 * 前缀是 buff `range` 前缀匹配的那个（`AP` 命中 `AP1`~`AP4`）；取两字母以便拼进 `range` 与图上标记、短且不换行。
 */
const TYPE_BY_GROUP: Readonly<Record<string, string>> = {
  basic: "AP",
  dodge: "CF",
  assist: "LT",
  special: "EQ",
  chain: "RL"
}

/**
 * 元数据的技能族 → 面板 `talent` 里的键
 *
 * 与元数据族名**不同名**：接口叫 `normal`、元数据叫 `basic`。
 */
const TALENT_KEY: Readonly<Record<string, string>> = {
  basic: "normal",
  dodge: "dodge",
  assist: "assist",
  special: "special",
  chain: "chain"
}

/**
 * 族名 → 出图时的中文前缀
 *
 * 元数据 `talent.<族>.name` 的中文名偏长、且强化技与本技同族（图上印不下），故另给短名。
 */
const GROUP_NAME: Readonly<Record<string, string>> = {
  basic: "普攻",
  dodge: "闪避",
  assist: "支援",
  special: "特殊技",
  chain: "连携"
}

/** 行名以此结尾才是一刀伤害 */
const DMG_SUFFIX = "伤害倍率"

/**
 * 体型分支的行名标记
 *
 * 「对小体型敌人伤害倍率」这一族是同一刀的三个分支，只取其一（中体型是标准假想敌）。
 */
const SIZE_MARK = "体型敌人"

/** 取中体型那一支 */
const SIZE_KEEP = "对中体型敌人"

/**
 * 判一行是不是该算的伤害倍率
 *
 * @param name 行名
 * @returns 该算时为真
 */
function isDmgRow(name: string): boolean {
  if (!name.endsWith(DMG_SUFFIX)) return false
  // 体型分支只留中体型那一支，否则同一刀记三遍
  if (name.includes(SIZE_MARK)) return name.startsWith(SIZE_KEEP)
  return true
}

/**
 * 把一档倍率文本折成小数
 * @param text 该档的值，形如 `"328.6%"` / `"60"`
 * @returns 小数；取不出时 NaN（调用方据此判「这一行不是数」）
 */
function rateOf(text: string): number {
  const num = Number.parseFloat(text)
  if (Number.isNaN(num)) return Number.NaN
  return text.trimEnd().endsWith("%") ? num / 100 : num
}

/**
 * 按等级取一行的值，**等级超出表长时按等差外推**
 *
 * **官方元数据的倍率表只有 12 档，而技能等级能到 16**（影画的「技能等级 +2」两次）：
 * 直接夹到末档会让高影画代理人少算。官方那些表逐档等差，故超出部分按步长外推。
 *
 * `isSame` 的行只有一条（如能量消耗），等级再高也取那一条；认不出是数或不等差的照旧夹到末档。
 * @param values 该行逐等级的值
 * @param level 技能等级，1 起
 * @returns 倍率小数；取不到时 0
 */
export function zzzRateAt(values: readonly string[] | undefined, level: number): number {
  if (!values?.length) return 0
  const want = Math.max(1, Math.trunc(level))
  const len = values.length
  if (want <= len) {
    const got = rateOf(values[want - 1] ?? "")
    return Number.isNaN(got) ? 0 : got
  }

  const last = rateOf(values[len - 1] ?? "")
  if (Number.isNaN(last)) return 0
  // 只有一档（`isSame`）无从谈步长
  if (len < 2) return last

  const first = rateOf(values[0] ?? "")
  if (Number.isNaN(first)) return last
  const step = (last - first) / (len - 1)
  if (step === 0) return last

  // 逐档差都贴着平均步长才算等差；不等差的宁可夹在末档（少算可查，外推错则无迹象）
  const tol = Math.max(Math.abs(step) * 0.02, 0.002)
  for (let at = 1; at < len; at++) {
    const prev = rateOf(values[at - 1] ?? "")
    const cur = rateOf(values[at] ?? "")
    if (Number.isNaN(prev) || Number.isNaN(cur)) return last
    if (Math.abs(cur - prev - step) > tol) return last
  }
  // 表本身按百分点一位小数存，外推同样收到那个精度，免得浮点尾数漏进倍率
  return Math.round((last + step * (want - len)) * 1e4) / 1e4
}

/**
 * 从元数据里推出该代理人能算的那几刀
 *
 * **一族里同名的行会出现多次**（`special` 里两条「伤害倍率」是特殊技与强化特殊技），故类型后缀按出现次序编号（`EQ1`/`EQ2`），名字取行名本身以区分。
 * @param detail 代理人的 `data.json`
 * @param talent 面板给的六个技能等级
 * @returns 逐刀的技能声明
 */
export function zzzSkillsOf(
  detail: MetaDetail | undefined,
  talent: Readonly<Record<string, number>>
): ZzzSkill[] {
  const out: ZzzSkill[] = []
  for (const [group, type] of Object.entries(TYPE_BY_GROUP)) {
    const one = detail?.talent?.[group]
    const rows = one?.tables ?? []
    const level = Number(talent[TALENT_KEY[group] ?? ""]) || 1
    let at = 0
    for (const row of rows) {
      const rowName = row.name ?? ""
      if (!isDmgRow(rowName)) continue
      at += 1
      const multiplier = zzzRateAt(row.values, level)
      if (!multiplier) continue
      out.push({
        name: `${GROUP_NAME[group] ?? group}·${rowName.replace(DMG_SUFFIX, "")}`.replace(/·$/, ""),
        type: `${type}${at}`,
        multiplier
      })
    }
  }
  return out
}
