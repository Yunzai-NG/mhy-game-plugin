/**
 * 模块职责：在受限上下文中求值元数据里的伤害公式文件（`calc.js` / `artis.js`）
 * 依赖方向：只依赖 node:vm 与 node:fs；不碰内核、不发请求
 * 生命周期：无状态，每次求值造一个新上下文
 * 注意事项：**这是本插件唯一执行下载来的代码的地方，且默认关闭**（使用者需显式开 `enableDmgCalc`）。公式只能摸到上下文
 *          自己的内建与 {@link PRELUDE} 里造的 `Format` / `lodash` / `usefulAttr`；进出上下文的每个值都过一层代理（见
 *          PRELUDE 的文件内说明）。**宿主对象原样塞进上下文即逃逸**：`x.constructor.constructor` 就是宿主的 `Function`，
 *          不受 `codeGeneration` 管 —— 新增注入物一律走 `__ua` 那种字符串，或交给代理。另有白名单文件名、路径须在元数据目录内、
 *          求值超时三道。ESM 先改写成 `vm.Script` 能跑的形态，未预期语法时 {@link rewrite} 明确报错。
 */
import { readFileSync } from "node:fs"
import { createContext, Script } from "node:vm"
import { isAbsolute, normalize, relative } from "node:path"
import { SET_DIR_NAMES } from "./set-dir.js"

/**
 * 允许求值的文件名
 *
 * 元数据里的 `index.js`/`alias.js`/`extra.js` 承载可离线转换的数据，不在此列——求值范围越小越好。
 */
export const CALC_FILES: readonly string[] = ["calc.js", "artis.js"]

/** 求值的时间上限，公式都是纯计算，正常在毫秒级 */
const TIMEOUT_MS = 1000

/**
 * 公式文件 import 的东西里由宿主给的那部分
 *
 * `Format` 与 `lodash` 不在此列：它们在上下文里由 {@link PRELUDE} 造，宿主函数塞进去即逃逸。
 */
export interface SandboxDeps {
  /**
   * 默认圣遗物评分表
   *
   * 57 个 `artis.js` import `artifact/artis-mark.js` 的 `usefulAttr`。那文件是纯数据、已离线转成 JSON，
   * 故按注入处理——少求值一个文件即少一处执行远端代码。以 JSON 文本进上下文、在里面解开，不传对象。
   */
  usefulAttr?: Record<string, unknown>
}

/**
 * 求值公式前先在同一上下文里跑的一段代码：造 `Format` / `lodash` / `usefulAttr`，并给出进出上下文的代理
 *
 * 宿主值进来经 `wrap`、上下文值出去经 `guard`，各换成一层代理，取到的每个值再按同一方向换，两侧都摸不到对方的真对象。
 * 宿主一侧只透出自有属性与宿主自己的类原型（AttrBox 的 `toString` 靠它），走到宿主内建原型即改取上下文自己那份，
 * `constructor` / `__proto__` 一律读不到；宿主函数抛的错换成上下文的
 * `Error`、只带消息。代理用到的内建都在公式跑之前取进闭包，公式改原型也影响不到它们。
 * `Format.comma` / `percent` 与 `lodash.forEach` 须与 panel/dmg/deps.ts 同口径（sandbox.test.ts 逐值比对）。
 */
const PRELUDE = `(function () {
  "use strict";
  var R = Reflect, P = Proxy, O = Object, A = Array, S = String, N = Number, E = Error;
  var apply = R.apply, rget = R.get, rset = R.set, rhas = R.has, rdel = R.deleteProperty;
  var keys = R.ownKeys, desc = R.getOwnPropertyDescriptor, proto = R.getPrototypeOf;
  var isArray = A.isArray, okeys = O.keys, freeze = O.freeze, create = O.create;
  var WM = WeakMap, WS = WeakSet, mget = WM.prototype.get, mset = WM.prototype.set, mhas = WM.prototype.has;
  var sadd = WS.prototype.add, shas = WS.prototype.has, push = A.prototype.push, indexOf = A.prototype.indexOf;
  var parseFloatN = N.parseFloat, toFixed = N.prototype.toFixed, split = S.prototype.split, slice = S.prototype.slice;

  var hostToProxy = new WM(), proxyToHost = new WM(), ctxToProxy = new WM(), proxyToCtx = new WM(), denied = new WS(), std = new WS();

  function prim(v) { return v === null || (typeof v !== "object" && typeof v !== "function"); }
  function safeErr(e) {
    var msg = "";
    try { msg = prim(e) ? S(e) : S(rget(e, "message")); } catch (x) { msg = ""; }
    return new E(msg);
  }
  function dummyOf(v) { return typeof v === "function" ? () => undefined : (isArray(v) ? [] : {}); }

  /* 宿主一侧按原型链找属性的主人：走到宿主内建原型（std）即停、改由 dummy 取上下文自己那份 */
  function ownerOf(real, k) {
    for (var o = real; o !== null; o = proto(o)) {
      if (apply(shas, std, [o])) return null;
      var d = desc(o, k);
      if (d) return d;
    }
    return null;
  }

  function handler(real, dummy, inbound, outbound, own) {
    var h = create(null);
    h.get = function (_t, k) {
      if (k === "constructor" || k === "__proto__") return undefined;
      if (!own) return outbound(rget(real, k, real));
      var d;
      try { d = ownerOf(real, k); } catch (e) { throw safeErr(e); }
      if (d) {
        if (d.get) { try { return outbound(apply(d.get, real, [])); } catch (e) { throw safeErr(e); } }
        return outbound(d.value);
      }
      return rget(dummy, k);
    };
    h.set = function (_t, k, v) {
      if (k === "constructor" || k === "__proto__") return false;
      try { return rset(real, k, inbound(v), real); } catch (e) { throw own ? safeErr(e) : e; }
    };
    h.has = function (_t, k) { return (own ? !!ownerOf(real, k) : rhas(real, k)) || rhas(dummy, k); };
    h.deleteProperty = function (_t, k) { return rdel(real, k); };
    h.ownKeys = function () {
      var out = [], ks = keys(real);
      for (var i = 0; i < ks.length; i++) apply(push, out, [ks[i]]);
      if (isArray(dummy) && apply(indexOf, out, ["length"]) < 0) apply(push, out, ["length"]);
      return out;
    };
    h.getOwnPropertyDescriptor = function (_t, k) {
      var d;
      try { d = desc(real, k); } catch (e) { throw own ? safeErr(e) : e; }
      if (!d) return undefined;
      var value;
      try { value = d.get ? apply(d.get, real, []) : d.value; } catch (e) { throw own ? safeErr(e) : e; }
      var nc = isArray(dummy) && k === "length";
      return { value: outbound(value), writable: true, enumerable: !!d.enumerable, configurable: !nc };
    };
    h.defineProperty = function () { return false; };
    h.getPrototypeOf = function () { return proto(dummy); };
    h.setPrototypeOf = function () { return false; };
    h.isExtensible = function () { return true; };
    h.preventExtensions = function () { return false; };
    h.apply = function (_t, self, args) {
      var a = [];
      for (var i = 0; i < args.length; i++) apply(push, a, [inbound(args[i])]);
      try { return outbound(apply(real, inbound(self), a)); } catch (e) { throw own ? safeErr(e) : e; }
    };
    return h;
  }

  function wrap(v) {
    if (prim(v)) return v;
    if (apply(mhas, proxyToCtx, [v])) return apply(mget, proxyToCtx, [v]);
    if (apply(mhas, hostToProxy, [v])) return apply(mget, hostToProxy, [v]);
    if (typeof v === "function" && apply(shas, denied, [v])) return undefined;
    var dummy = dummyOf(v);
    var p = new P(dummy, handler(v, dummy, guard, wrap, true));
    apply(mset, hostToProxy, [v, p]);
    apply(mset, proxyToHost, [p, v]);
    return p;
  }
  function guard(v) {
    if (prim(v)) return v;
    if (apply(mhas, proxyToHost, [v])) return apply(mget, proxyToHost, [v]);
    if (apply(mhas, ctxToProxy, [v])) return apply(mget, ctxToProxy, [v]);
    var dummy = dummyOf(v);
    var p = new P(dummy, handler(v, dummy, wrap, guard, false));
    apply(mset, ctxToProxy, [v, p]);
    apply(mset, proxyToCtx, [p, v]);
    return p;
  }

  function group(int) {
    var neg = apply(slice, int, [0, 1]) === "-", d = neg ? apply(slice, int, [1]) : int, out = "";
    for (var i = 0; i < d.length; i++) { var c = d[i]; if (c < "0" || c > "9") return int; }
    for (var j = d.length; j > 0; j -= 3) out = (j - 3 > 0 ? "," : "") + apply(slice, d, [j - 3 < 0 ? 0 : j - 3, j]) + out;
    return (neg ? "-" : "") + out;
  }
  function comma(num, fix) {
    fix = fix === undefined ? 0 : fix;
    var fixed = parseFloatN(apply(toFixed, N(num) || 0, [fix]));
    var parts = apply(split, S(fixed), ["."]), grouped = group(parts[0] || "");
    if (fix <= 0) return grouped;
    var dec = parts[1], pad = "";
    if (dec === undefined) { for (var i = 0; i < fix; i++) pad += "0"; dec = pad; }
    return grouped + "." + dec;
  }
  function pct(num, fix) { return apply(toFixed, N(num) || 0, [fix === undefined ? 1 : fix]) + "%"; }
  function percent(num, fix) { return pct((N(num) || 0) * 100, fix); }
  function forEach(coll, fn) {
    if (!coll || typeof coll !== "object") return;
    if (isArray(coll)) { for (var i = 0; i < coll.length; i++) if (fn(coll[i], i) === false) return; return; }
    var ks = okeys(coll);
    for (var j = 0; j < ks.length; j++) if (fn(coll[ks[j]], ks[j]) === false) return;
  }

  freeze(E);
  globalThis.Format = freeze({ comma: comma, pct: pct, percent: percent });
  globalThis.lodash = freeze({ forEach: forEach });
  globalThis.usefulAttr = freeze(JSON.parse(globalThis.__ua || "{}"));
  delete globalThis.__ua;
  globalThis.__mb = freeze({
    guard: guard,
    deny: function (f) { apply(sadd, denied, [f]); },
    std: function (p) { apply(sadd, std, [p]); },
    out: function () { return guard(globalThis.__out); }
  });
})();
`

/** {@link PRELUDE} 交给宿主的那几个口子 */
interface Membrane {
  /** 上下文值 → 宿主可用的代理 */
  guard: (value: unknown) => unknown
  /** 登记一个永不放进上下文的宿主函数 */
  deny: (fn: unknown) => void
  /** 登记一个宿主内建原型：属性查到它那里就改取上下文自己那份 */
  std: (proto: unknown) => void
  /** 取公式的导出，已过代理 */
  out: () => unknown
}

/**
 * 宿主内建原型，登记进 {@link Membrane.std}
 *
 * 漏登一个的后果是那个内建原型上的方法以宿主函数的身份透进上下文；它们本身不造代码，但 `Function.prototype` 一族
 * 漏登就多出一条摸 `constructor` 之外的路，故宁多勿少。
 */
const HOST_STD_PROTOS: readonly unknown[] = [
  Object.prototype,
  Array.prototype,
  Function.prototype,
  Object.getPrototypeOf(async function () {}),
  Object.getPrototypeOf(function* () {}),
  Object.getPrototypeOf(async function* () {}),
  Error.prototype,
  Number.prototype,
  String.prototype,
  Boolean.prototype,
  Symbol.prototype,
  BigInt.prototype,
  RegExp.prototype,
  Date.prototype,
  Map.prototype,
  Set.prototype,
  WeakMap.prototype,
  WeakSet.prototype,
  Promise.prototype,
  ArrayBuffer.prototype,
  Object.getPrototypeOf(Uint8Array.prototype),
  Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))
]

/** 宿主侧几个能造代码的构造器，登记进 {@link Membrane.deny}；`constructor` 已被代理挡住，这里是第二道 */
const HOST_CODEGEN: readonly unknown[] = [
  Function,
  eval,
  Object.getPrototypeOf(async function () {}).constructor,
  Object.getPrototypeOf(function* () {}).constructor,
  Object.getPrototypeOf(async function* () {}).constructor
]

/** 一次求值的产出 */
export interface CalcModule {
  /** 面板伤害条目 */
  details?: unknown
  /** 角色自带的 buff */
  buffs?: unknown
  /** 主属性推荐 */
  mainAttr?: unknown
  /** 默认展示的伤害条目下标 */
  defDmgIdx?: unknown
  /** 默认伤害键 */
  defDmgKey?: unknown
  /** 默认参数 */
  defParams?: unknown
  /** 假想敌名字 */
  enemyName?: unknown
  /** 公式作者 */
  createdBy?: unknown
  /** `export default`，武器 calc 与角色 artis 用的是这个 */
  default?: unknown
}

/** 已知的具名导出，改写时据此收集 */
const NAMED_EXPORTS: readonly (keyof CalcModule)[] = [
  "details",
  "buffs",
  "mainAttr",
  "defDmgIdx",
  "defDmgKey",
  "defParams",
  "enemyName",
  "createdBy"
]

/**
 * 允许 import 的模块
 *
 * `#miao` 与 `lodash` 由宿主注入。那 57 个 `artis.js` 取默认评分表的相对路径另由 {@link ARTIS_MARK_RE} 放行、
 * 同样按注入处理，不去求值那个文件。
 */
const ALLOWED_IMPORTS: readonly string[] = ["#miao", "lodash"]

/**
 * 默认评分表的来源路径，`artis.js` 以相对路径 import 它
 *
 * **两个套装目录名都要收**：原神星铁那份在 `artifact/artis-mark.js`，绝区零那份同名同形却在 `equip/` 下
 * （见 {@link SET_DIR_NAMES}）；只认 `artifact/` 会让 `meta-zzz` 的公式 import 自己那份时被下面的 import 校验
 * 当成「预期之外的依赖」抛错、整份公式求值失败、伤害栏退回兜底。文件名仍钉死 `artis-mark.js`。
 */
const ARTIS_MARK_RE = new RegExp(`(?:${SET_DIR_NAMES.join("|")})/artis-mark\\.js$`)

/**
 * 把 ESM 源码改写成能在 `vm.Script` 里求值的形态
 *
 * 三处改写：import 整行去掉（依赖由宿主注入）、`export const X` 去掉 `export`、
 * `export default` 换成给内部变量赋值。末尾追加一行把结果装进 `__out`。
 * @param source 源码
 * @returns 改写后的源码
 * @throws import 了预期之外的模块，或出现未预期的 export 语法时
 */
export function rewrite(source: string): string {
  // 先校验 import：出现预期之外的依赖时宁可不求值，也不注入 undefined 让它在半途以看不懂的 TypeError 失败
  const imports = [...source.matchAll(/^\s*import\s[^\n]*?from\s+["']([^"']+)["']/gm)]
  for (const hit of imports) {
    const from = hit[1] ?? ""
    if (ALLOWED_IMPORTS.includes(from)) continue
    // 默认评分表按注入处理（见 ARTIS_MARK_RE），不求值那个文件
    if (ARTIS_MARK_RE.test(from)) continue
    throw new Error(`公式文件 import 了预期之外的模块：${from}`)
  }

  let out = source
    .replace(/^\s*import\s[^\n]*?from\s+["'][^"']+["']\s*;?\s*$/gm, "")
    .replace(/^\s*export\s+default\s+/m, "const __default = ")
    .replace(/^\s*export\s+const\s+/gm, "const ")

  // 改写后不应再残留 export：残留意味着出现未预期的语法（如 `export function`），明确报错而非求值时抛语法错
  if (/^\s*export\s/m.test(out)) {
    throw new Error("公式文件含未预期的 export 语法，已拒绝求值")
  }

  const pairs = NAMED_EXPORTS.map(it => `${it}: typeof ${it} === "undefined" ? undefined : ${it}`)
  pairs.push(`default: typeof __default === "undefined" ? undefined : __default`)
  out += `\n__out = { ${pairs.join(", ")} };\n`
  return out
}

/**
 * 判断一个路径是否位于某个目录之内
 * @param dir 目录绝对路径
 * @param path 待检查的绝对路径
 * @returns 位于其内时为真
 */
function within(dir: string, path: string): boolean {
  const rel = relative(normalize(dir), normalize(path))
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

/** 求值一个公式文件所需的东西 */
export interface EvalOptions {
  /** 元数据根目录，文件须位于其内 */
  root: string
  /** 注入的依赖 */
  deps: SandboxDeps
}

/**
 * 求值一个公式文件
 *
 * 上下文里只有它自己的语言内建与 {@link PRELUDE} 造的三样，没有 require/process/fs 与计时器；导出经代理交回。
 * @param path 文件绝对路径
 * @param opts 求值选项
 * @returns 产出的模块；求值失败时 undefined
 */
export function evalCalc(path: string, opts: EvalOptions): CalcModule | undefined {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? ""
  if (!CALC_FILES.includes(name)) return undefined
  if (!within(opts.root, path)) return undefined

  let source: string
  try {
    source = readFileSync(path, "utf8")
  } catch {
    return undefined
  }

  let code: string
  try {
    code = rewrite(source)
  } catch {
    return undefined
  }

  let ua: string
  try {
    ua = JSON.stringify(opts.deps.usefulAttr ?? {})
  } catch {
    return undefined
  }

  // 上下文里只放一段字符串：内建用上下文自己的，Format / lodash / 代理由 PRELUDE 在里面造
  const sandbox: Record<string, unknown> = { __ua: ua }
  const context = createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })

  let mb: Membrane
  try {
    new Script(PRELUDE, { filename: "sandbox-prelude.js" }).runInContext(context, { timeout: TIMEOUT_MS })
    mb = sandbox["__mb"] as Membrane
    delete sandbox["__mb"]
    for (const fn of HOST_CODEGEN) mb.deny(fn)
    for (const one of HOST_STD_PROTOS) mb.std(one)
    new Script(code, { filename: path }).runInContext(context, { timeout: TIMEOUT_MS })
  } catch {
    return undefined
  }

  const out = mb.out()
  return out && typeof out === "object" ? (out as CalcModule) : undefined
}
