/**
 * 模块职责：探索度、成就、战利品与武器列表几条按游戏分派的命令
 * 依赖方向：依赖 session / text / views/gs/player 与 views/sr/collect 与 views/weapon 与命令层依赖包
 * 生命周期：无状态函数
 * 注意事项：几条命令各只对部分游戏成立，故对其余游戏明说"该游戏没有这项"，不发注定失败的请求。
 *
 *          `#成就` 与 `#宝箱` 按游戏分派：原神这两项画在 `#探索` 那张图上，星铁另有两条逐项接口。
 *
 *          `#探索` 另取一次 `basicInfo`（七圣召唤）：取不到时整块省略，模板自带该判断。
 */
import type { Session } from "../core/session.js"
import { failText } from "../core/text.js"
import type { BasicInfoRaw, PlayerIndexRaw } from "../views/gs/index.js"
import { playerText, roleExploreTemplateData } from "../views/gs/index.js"
import type { SrAchieveRaw, SrChestRaw } from "../views/sr/index.js"
import {
  srAchieveData,
  srAchieveState,
  srAchieveText,
  srChestData,
  srChestState,
  srChestText
} from "../views/sr/index.js"
import type { CharacterListRaw } from "../views/weapon.js"
import { weaponTemplateData, weaponText, zzzWeaponTemplateData } from "../views/weapon.js"
import { zzzExplore } from "./zzz/index.js"
import type { MhyDeps } from "./deps.js"

/**
 * `#探索` —— 宝箱、神瞳、地区探索度与尘歌壶
 * @param s 会话
 * @param deps 依赖
 */
export async function roleExplore(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    await zzzExplore(s, deps)
    return
  }
  if (s.game !== "gs") {
    await s.text("探索度只有原神与绝区零有，星铁可查询 #星铁信息")
    return
  }

  const res = await deps.mys.query<PlayerIndexRaw>("index", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const ctx = { uid: res.uid, name: s.name }
  const gcg = await deps.mys.query<BasicInfoRaw>("basicInfo", {
    user: s.user,
    game: s.game
  })
  const data = roleExploreTemplateData(res.data, ctx, gcg.ok ? gcg.data : undefined)
  if (await s.image("gs/role-explore", data)) return
  await s.text(playerText(res.data, ctx))
}

/**
 * `#成就` —— 原神并入探索度那张图，星铁另有一张逐系列的
 * @param s 会话
 * @param deps 依赖
 */
export async function achieveList(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "sr") {
    await roleExplore(s, deps)
    return
  }

  const res = await deps.mys.query<SrAchieveRaw>("achievement", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const ctx = { uid: res.uid, nickname: s.name }
  if (srAchieveState(res.data) === "noData") {
    await s.text("米游社没有返回成就数据，请确认已在 App 的「我的角色」里开启战绩展示")
    return
  }
  if (await s.image("sr/achieve", srAchieveData(res.data, ctx))) return
  await s.text(srAchieveText(res.data, ctx))
}

/**
 * `#宝箱` —— 原神并入探索度那张图，星铁出逐星球逐区域的战利品进度
 *
 * 绝区零随 `#探索` 转到区域收集，它没有"宝箱"这个说法。
 * @param s 会话
 * @param deps 依赖
 */
export async function chestList(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game !== "sr") {
    await roleExplore(s, deps)
    return
  }

  const res = await deps.mys.query<SrChestRaw>("chest", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const ctx = { uid: res.uid, nickname: s.name }
  if (srChestState(res.data) === "noData") {
    await s.text("米游社没有返回战利品数据，请确认已在 App 的「我的角色」里开启战绩展示")
    return
  }
  if (await s.image("sr/chest", srChestData(res.data, ctx))) return
  await s.text(srChestText(res.data, ctx))
}

/**
 * `#武器` —— 已装备武器一览
 *
 * 星铁走同一套模板（光锥在 `equip` 下、叠影叫 `rank`）；绝区零的战绩接口不给音擎，改读面板库。
 * @param s 会话
 * @param deps 依赖
 */
export async function weaponList(s: Session, deps: MhyDeps): Promise<void> {
  if (s.game === "zzz") {
    // 绝区零的战绩接口不给音擎，只能读面板库（只读发起者自己名下那份）
    const uid = await deps.users.uid(s.user, "zzz")
    if (!uid) {
      await s.text("请先绑定 uid，发送「%绑定uid1000000001」")
      return
    }
    const player = deps.panels ? await deps.panels.of(s.user).load("zzz", uid) : undefined
    const avatars = Object.values(player?.avatars ?? {})
    const data = zzzWeaponTemplateData(avatars, { uid, name: s.name, ...(deps.meta ? { meta: deps.meta.loader } : {}) })
    if (!(data["list"] as unknown[]).length) {
      await s.text("音擎列表读的是面板数据，先发送「%更新面板」取一次")
      return
    }
    if (await s.image("avatar/weapon", data)) return
    await s.text(weaponText(data))
    return
  }

  const res = await deps.mys.query<CharacterListRaw>("character", {
    user: s.user,
    game: s.game
  })
  if (!res.ok) {
    await s.text(failText(res))
    return
  }

  const data = weaponTemplateData(res.data, {
    uid: res.uid,
    name: s.name,
    game: s.game,
    ...(deps.meta ? { meta: deps.meta.loader } : {})
  })
  if (await s.image("avatar/weapon", data)) return
  await s.text(weaponText(data))
}
