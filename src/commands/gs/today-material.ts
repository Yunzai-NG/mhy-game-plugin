/**
 * 模块职责：`#今日材料` —— 今天能升谁的天赋、能突破谁的武器
 * 依赖方向：依赖 views/gs/today-material 与命令层依赖包；角色来自米游社角色列表 + 本地面板缓存
 * 生命周期：无状态函数
 * 注意事项：**角色来自两处，缺一不可**：米游社角色列表定人（全部已拥有），本地面板缓存补天赋等级。
 *
 *          取列表失败时退回只用本地面板缓存，不回错误。
 *
 *          只有原神：星铁的材料按命途分，没有按国家轮换这回事。
 *
 *          天赋等级取**不含命座加成**的那一份（本仓库只存这一份，见 store/panel.ts）。
 */
import { failText } from "../../core/text.js"
import type { Session } from "../../core/session.js"
import type { MetaLoader } from "../../meta/loader.js"
import type { StoredAvatar } from "../../store/panel.js"
import { charImgs } from "../../views/panel.js"
import type { StatCharacterRaw } from "../../views/panel.js"
import type { TodayAvatar, TodayChar, TodayWeapon } from "../../views/gs/index.js"
import { buildTodayMaterial, materialWeek, todayMaterialText } from "../../views/gs/index.js"
import type { IndexRaw } from "../../views/profile.js"
import { avatarCardMap } from "../_cards.js"
import type { MhyDeps } from "../deps.js"

/** 元数据 `data.json` 里的材料一栏 */
interface WithMaterials {
  /** 类别 → 材料全名 */
  materials?: Record<string, string>
}

/**
 * 取一个条目的材料全名
 * @param loader 装载器
 * @param id 条目 id 或名称
 * @param key 材料类别，`talent` 或 `weapon`
 * @returns 材料全名；没有时 undefined
 */
function materialOf(loader: MetaLoader, id: string, key: string): string | undefined {
  const detail = loader.detail("gs", id) as WithMaterials | undefined
  return detail?.materials?.[key]
}

/**
 * 把米游社角色列表与本地面板缓存并成今日材料的输入
 *
 * 列表定人、缓存补天赋；列表为空时只走缓存。
 * @param loader 元数据装载器
 * @param list 米游社角色列表里的 avatars
 * @param stored 本地面板缓存，角色 id → 存起来的面板
 * @param exists 判元数据路径是否存在，图标回落用
 * @returns 逐角色的输入
 */
export function collectAvatars(
  loader: MetaLoader,
  list: readonly NonNullable<StatCharacterRaw["avatars"]>[number][],
  stored: Readonly<Record<string, StoredAvatar>>,
  exists?: (rel: string) => boolean
): TodayAvatar[] {
  const ids = new Set(list.map(one => String(one.id ?? "")).filter(it => !!it))
  const extra = Object.keys(stored).filter(id => !ids.has(id))

  const out: TodayAvatar[] = []
  for (const id of [...ids, ...extra]) {
    const raw = list.find(one => String(one.id ?? "") === id)
    const one = stored[id]
    const item = loader.byId("gs", id)
    const name = item?.name ?? raw?.name
    if (!name) continue

    const imgs = charImgs({ game: "gs", name, ...(exists ? { exists } : {}) })
    const char: TodayChar = {
      id,
      name,
      level: Number(raw?.level ?? one?.level) || 1,
      cons: Number(raw?.actived_constellation_num ?? one?.cons) || 0,
      star: Math.min(5, Number(raw?.rarity ?? item?.star) || 0),
      face: imgs["qFace"] ?? imgs["face"] ?? ""
    }
    if (one?.promote !== undefined) char.promote = one.promote
    if (one?.talent && Object.keys(one.talent).length > 0) char.talent = one.talent
    const talentMat = materialOf(loader, id, "talent")
    if (talentMat) char.material = talentMat

    const avatar: TodayAvatar = { char }
    const weaponName = raw?.weapon?.name ?? one?.weapon?.name
    if (weaponName) {
      const w = loader.byName("gs", weaponName)
      const star = Number(raw?.weapon?.rarity ?? w?.star) || 0
      const weapon: TodayWeapon = {
        id: w?.id ?? "",
        name: w?.name ?? weaponName,
        abbr: w?.abbr ?? weaponName,
        star,
        level: Number(raw?.weapon?.level ?? one?.weapon?.level) || 1,
        affix: Number(raw?.weapon?.affix_level ?? one?.weapon?.affix) || 1,
        icon: w?.icon ?? "",
        face: imgs["side"] ?? imgs["face"] ?? ""
      }
      const promote = raw?.weapon?.promote_level ?? one?.weapon?.promote
      if (promote !== undefined) weapon.promote = Number(promote) || 0
      const mat = w?.name ? materialOf(loader, w.name, "weapon") : undefined
      if (mat) weapon.material = mat
      avatar.weapon = weapon
    }
    out.push(avatar)
  }
  return out
}

/**
 * `#今日材料` —— 今天可刷的天赋书与武器材料
 * @param s 会话
 * @param deps 依赖
 */
export async function todayMaterial(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "gs") {
    await s.text("今日材料暂只支持原神：星铁的材料按命途分，没有按国家轮换这回事")
    return
  }

  const loader = deps.meta?.loader
  const mats = deps.materials
  if (!loader || !mats?.ready()) {
    await s.text("今日材料需要元数据（材料图标与每周轮换表都在里面），请先让主人发送 #更新元数据")
    return
  }

  const day = materialWeek(s.rest)
  if (day.sunday) {
    await s.text("今天周日，全部素材都可以刷哦~")
    return
  }

  const uid = (await deps.users.uid(s.user, "gs")) || ""
  if (!uid) {
    await s.text("先绑定 uid 或 CK：#绑定uid100000001")
    return
  }

  const res = await deps.mys.query<unknown>("character", {
    user: s.user,
    game: s.game
  })
  const raw = res.ok ? (res.data as StatCharacterRaw | null) : null
  const list = raw?.avatars ?? raw?.list ?? []
  const player = await deps.panels?.of(s.user).load("gs", res.ok ? res.uid : uid)
  const stored = player?.avatars ?? {}

  if (list.length === 0 && Object.keys(stored).length === 0) {
    await s.text(res.ok ? "暂无角色数据，请先发送 #更新面板" : failText(res))
    return
  }

  const view = buildTodayMaterial(
    {
      uid: res.ok ? res.uid : uid,
      week: day.week,
      day: day.label,
      avatars: collectAvatars(loader, list, stored, rel => loader.exists(rel))
    },
    {
      material: name => mats.get(name),
      ladder: name => mats.ladder(name)
    }
  )

  // 天赋书那几格换成与角色列表 / 深渊同一张整卡（天赋、武器、套装都在卡上），面板库里没有的仍出头像卡
  view.cards = await avatarCardMap(deps, s.user, "gs", { avatars: list } as IndexRaw, res.ok ? res.uid : uid)

  if (view.data.length === 0) {
    await s.text(`${day.label} 可刷的材料里，没有对应到你已拥有的角色`)
    return
  }
  if (await s.image("gs/today-material", view)) return
  await s.text(todayMaterialText(view))
}
