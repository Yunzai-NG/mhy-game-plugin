/**
 * 模块职责：命令层的伤害取数 —— 装 buff、算伤害、转成模板要的 `dmgCalc`，另给排行用的单条期望
 * 依赖方向：依赖 panel/dmg 与 views/dmg；不发请求、不碰 kv
 * 生命周期：无状态函数
 * 注意事项：**独立成文件是为了断环**：面板、替换与排行三处都要算伤害，而排行（commands/rank.ts）
 *          被面板引用，算伤害的代码留在面板里会绕成 panel → rank → panel。
 *
 *          三处都可能取不到（开关关着、角色没有 `calc.js`、词条表没装），任一处取不到就整块不画、
 *          面板照常出图。排行那一支同理：取不到就不写伤害榜，不是写 0。
 */
import type { BuiltPanel } from "../panel/build.js"
import { eachElem } from "../meta/elem.js"
import { isGsTravelerName } from "../meta/traveler.js"
import { calcDmg, calcRuleOf, weaponTablesAt } from "../panel/dmg/index.js"
import { dmgCalcView } from "../views/dmg.js"
import type { DmgCalcView } from "../views/dmg.js"
import type { MhyDeps } from "./deps.js"

/** 算伤害前那几步的结果：规则、收集好的 buff 与角色详情 */
interface DmgPrep {
  /** 公式规则 */
  rule: NonNullable<ReturnType<typeof calcRuleOf>>
  /** 已收集好的 buff */
  buffs: ReturnType<NonNullable<MhyDeps["dmgBuffs"]>["collect"]>
  /** 词条元数据表 */
  arti: NonNullable<MhyDeps["artiMeta"]>
  /** 角色详情，旅行者按元素取 */
  detail: ReturnType<NonNullable<NonNullable<MhyDeps["meta"]>["loader"]>["detail"]>
}

/**
 * 算伤害之前的公共几步
 * @param deps 依赖
 * @param panel 装好的面板
 * @returns 规则与 buff；三处任一取不到时 undefined
 */
function prepare(deps: MhyDeps, panel: BuiltPanel): DmgPrep | undefined {
  const loader = deps.dmgBuffs
  const arti = deps.artiMeta
  if (!loader?.enabled || !arti) return undefined

  const game = panel.game
  const rule = calcRuleOf(loader.charCalc(game, panel.name, panel.elem), game)
  if (!rule) return undefined

  // 星铁光锥 buff 只写行号，数值在武器 `data.json` 的 `skill.tables` 里；不传则光锥加成整条丢失
  const weaponItem = panel.weapon?.name ? deps.meta?.loader.byName(game, panel.weapon.name) : undefined
  const weaponDetail = weaponItem ? deps.meta?.loader.detail(game, weaponItem.id || weaponItem.name) : undefined
  const buffs = loader.collect({
    game,
    charBuffs: rule.buffs,
    sets: panel.sets,
    ...(panel.weapon?.name ? { weaponName: panel.weapon.name } : {}),
    ...(panel.weapon?.type ? { weaponType: panel.weapon.type } : {}),
    // 源没给叠影时不传装配层缺省的 1，否则凭空多一档加成，见 weaponTablesAt
    weaponTables: weaponTablesAt(weaponDetail, panel.weapon?.hasAffix ? panel.weapon.affix : undefined)
  })
  // 带元素：旅行者的天赋表在 `旅行者/<元素>` 下，与装配层同一取法
  const detail = deps.meta?.loader.detail(game, panel.id, panel.elem)
  return { rule, buffs, arti, detail }
}

/**
 * 算一个角色的伤害，转成模板要的形态
 *
 * 一并带出 `dmgAttr`：伤害模式下属性栏展示的是这条伤害生效时的属性（已折算 buff）。
 * 敌人等级不传，由伤害层按游戏取缺省。给了 `base`（面板替换前那份）时逐行带上增减。
 * @param deps 依赖
 * @param panel 装好的面板
 * @param opts 模式与序号
 * @param base 替换前的面板，面板替换那一路才给
 * @returns 视图与折算后的属性；取不到时 undefined
 */
export function panelDmg(
  deps: MhyDeps,
  panel: BuiltPanel,
  opts: { mode: "profile" | "dmg"; dmgIdx?: number; idxIsInput?: boolean } = { mode: "profile" },
  base?: BuiltPanel
): { calc: DmgCalcView; dmgAttr?: Readonly<Record<string, unknown>> } | undefined {
  const run = (one: BuiltPanel): ReturnType<typeof calcDmg> => {
    const prep = prepare(deps, one)
    if (!prep) return undefined
    return calcDmg({
      panel: one,
      rule: prep.rule,
      buffs: prep.buffs,
      arti: prep.arti,
      mode: opts.mode,
      ...(prep.detail ? { detail: prep.detail } : {}),
      ...(opts.dmgIdx === undefined ? {} : { dmgIdx: opts.dmgIdx }),
      ...(opts.idxIsInput ? { idxIsInput: true } : {})
    })
  }
  const got = run(panel)
  if (!got) return undefined
  const before = base ? run(base) : undefined
  const dmgAttr = got.compare?.attr as Readonly<Record<string, unknown>> | undefined
  return { calc: dmgCalcView(got, before), ...(dmgAttr ? { dmgAttr } : {}) }
}

/**
 * 算排行要的那一个数：公式自己指定的那条伤害的期望值
 *
 * **走 `single` 模式、取未格式化的原值**：伤害榜要比的是数，而视图层给的是带千分位的串。
 * 敌人等级一律取缺省，使用者指定的序号与敌人等级都不进榜 —— 那会让榜上各行不可比。
 * @param deps 依赖
 * @param panel 装好的面板
 * @returns 期望伤害；算不出或公式给的是文本型结果时 undefined
 */
export function dmgRankScore(deps: MhyDeps, panel: BuiltPanel): number | undefined {
  const row = rankRow(deps, panel)
  // 文本型结果（公式直接给 `28.0%` 一类的串）不入榜：它不是可比的数
  if (!row || row.type === "text") return undefined
  const avg = Number(row.avg)
  return Number.isFinite(avg) ? avg : undefined
}

/**
 * 伤害榜比的是哪一条伤害：排行图上印的那个标题
 * @param deps 依赖
 * @param panel 任一位上榜者的面板，同一角色同一份公式，取谁都一样
 * @returns 标题；算不出时空串
 */
export function dmgRankTitle(deps: MhyDeps, panel: BuiltPanel): string {
  return rankRow(deps, panel)?.title ?? ""
}

/**
 * 伤害榜取的那一条：`single` 模式下公式指定的那条
 * @param deps 依赖
 * @param panel 装好的面板
 * @returns 那一条；算不出时 undefined
 */
function rankRow(deps: MhyDeps, panel: BuiltPanel): { title: string; avg: number | string; type?: string } | undefined {
  const prep = prepare(deps, panel)
  if (!prep) return undefined
  return calcDmg({
    panel,
    rule: prep.rule,
    buffs: prep.buffs,
    arti: prep.arti,
    mode: "single",
    ...(prep.detail ? { detail: prep.detail } : {})
  })?.ret[0]
}

/**
 * 判一个角色有没有伤害公式
 *
 * 排行那一支要据此分辨"本群还没人查过"与"这个角色压根算不出伤害"。
 * @param deps 依赖
 * @param game 游戏
 * @param name 角色名
 * @returns 有公式时为真
 */
export function hasDmgRule(deps: MhyDeps, game: BuiltPanel["game"], name: string): boolean {
  const loader = deps.dmgBuffs
  if (!loader?.enabled) return false
  if (game === "gs" && isGsTravelerName(name)) {
    return eachElem("gs").some(one => !!calcRuleOf(loader.charCalc(game, name, one.key), game))
  }
  return !!calcRuleOf(loader.charCalc(game, name), game)
}

/**
 * 伤害算不出来时的提示
 *
 * 三种成因分开说：开关关着、公式文件没落到本地（开关由关转开时增量补不上它，
 * 那时换任何角色都一样不出）、这个角色没有公式。判据取 `artifact/calc.js`，不随角色名变。
 * @param deps 依赖
 * @param panel 装好的面板
 * @returns 可直接发出去的一句话
 */
export function dmgMissText(deps: MhyDeps, panel: BuiltPanel): string {
  if (!deps.dmgBuffs?.enabled) {
    return (
      "伤害计算未开启。它需要执行下载来的公式代码，故缺省关闭 —— " +
      "请让主人在配置里打开「开启伤害计算」，改完即生效"
    )
  }
  if (deps.meta?.loader.exists(`meta-${panel.game}/artifact/calc.js`) === false) {
    return "本地元数据里没有伤害公式文件，请让主人发送「#更新元数据强制」重下完整包"
  }
  return `元数据里没有 ${panel.name} 的伤害公式，换个角色试试`
}
