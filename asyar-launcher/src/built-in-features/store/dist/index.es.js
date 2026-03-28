var Et = Object.defineProperty;
var St = (s, t, r) => t in s ? Et(s, t, { enumerable: !0, configurable: !0, writable: !0, value: r }) : s[t] = r;
var F = (s, t, r) => St(s, typeof t != "symbol" ? t + "" : t, r);
import { writable as je, get as de } from "svelte/store";
import "svelte/internal/disclose-version";
import "svelte/internal/flags/legacy";
import * as e from "svelte/internal/client";
import { onMount as lt, tick as It, onDestroy as $t } from "svelte";
import { ActionContext as G } from "asyar-sdk";
function kt(s, t = !1) {
  return window.__TAURI_INTERNALS__.transformCallback(s, t);
}
async function W(s, t = {}, r) {
  return window.__TAURI_INTERNALS__.invoke(s, t, r);
}
var rt;
(function(s) {
  s.WINDOW_RESIZED = "tauri://resize", s.WINDOW_MOVED = "tauri://move", s.WINDOW_CLOSE_REQUESTED = "tauri://close-requested", s.WINDOW_DESTROYED = "tauri://destroyed", s.WINDOW_FOCUS = "tauri://focus", s.WINDOW_BLUR = "tauri://blur", s.WINDOW_SCALE_FACTOR_CHANGED = "tauri://scale-change", s.WINDOW_THEME_CHANGED = "tauri://theme-changed", s.WINDOW_CREATED = "tauri://window-created", s.WEBVIEW_CREATED = "tauri://webview-created", s.DRAG_ENTER = "tauri://drag-enter", s.DRAG_OVER = "tauri://drag-over", s.DRAG_DROP = "tauri://drag-drop", s.DRAG_LEAVE = "tauri://drag-leave";
})(rt || (rt = {}));
async function Ct(s, t) {
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(s, t), await W("plugin:event|unlisten", {
    event: s,
    eventId: t
  });
}
async function Dt(s, t, r) {
  var n;
  const o = (n = void 0) !== null && n !== void 0 ? n : { kind: "Any" };
  return W("plugin:event|listen", {
    event: s,
    target: o,
    handler: kt(t)
  }).then((a) => async () => Ct(s, a));
}
var Z;
(function(s) {
  s[s.Trace = 1] = "Trace", s[s.Debug = 2] = "Debug", s[s.Info = 3] = "Info", s[s.Warn = 4] = "Warn", s[s.Error = 5] = "Error";
})(Z || (Z = {}));
function Mt(s) {
  var t, r;
  if (s)
    if (s.startsWith("Error")) {
      const o = (t = s.split(`
`)[3]) == null ? void 0 : t.trim();
      if (!o)
        return;
      const a = /at\s+(?<functionName>.*?)\s+\((?<fileName>.*?):(?<lineNumber>\d+):(?<columnNumber>\d+)\)/, d = o.match(a);
      if (d) {
        const { functionName: l, fileName: i, lineNumber: c, columnNumber: u } = d.groups;
        return `${l}@${i}:${c}:${u}`;
      } else {
        const l = /at\s+(?<fileName>.*?):(?<lineNumber>\d+):(?<columnNumber>\d+)/, i = o.match(l);
        if (i) {
          const { fileName: c, lineNumber: u, columnNumber: g } = i.groups;
          return `<anonymous>@${c}:${u}:${g}`;
        }
      }
    } else
      return (r = s.split(`
`).map((a) => a.split("@")).filter(([a, d]) => a.length > 0 && d !== "[native code]")[2]) == null ? void 0 : r.filter((a) => a.length > 0).join("@");
}
async function We(s, t, r) {
  const n = Mt(new Error().stack), { file: o, line: a, keyValues: d } = r ?? {};
  await W("plugin:log|log", {
    level: s,
    message: t,
    location: n,
    file: o,
    line: a,
    keyValues: d
  });
}
async function Bt(s, t) {
  await We(Z.Error, s, t);
}
async function we(s, t) {
  await We(Z.Info, s, t);
}
async function Ft(s, t) {
  await We(Z.Debug, s, t);
}
async function Lt(s) {
  return await Dt("log://log", (t) => {
    const { level: r } = t.payload;
    let { message: n } = t.payload;
    n = n.replace(
      // TODO: Investigate security/detect-unsafe-regex
      // eslint-disable-next-line no-control-regex, security/detect-unsafe-regex
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      ""
    ), s({ message: n, level: r });
  });
}
async function Nt() {
  return await Lt(({ level: s, message: t }) => {
    switch (s) {
      case Z.Trace:
        console.log(t);
        break;
      case Z.Debug:
        console.debug(t);
        break;
      case Z.Info:
        console.info(t);
        break;
      case Z.Warn:
        console.warn(t);
        break;
      case Z.Error:
        console.error(t);
        break;
      default:
        throw new Error(`unknown log level ${s}`);
    }
  });
}
const A = {
  reset: "\x1B[0m",
  bright: "\x1B[1m",
  dim: "\x1B[2m",
  // Colors
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[34m",
  magenta: "\x1B[35m",
  cyan: "\x1B[36m",
  // Backgrounds
  bgRed: "\x1B[41m",
  bgGreen: "\x1B[42m",
  bgYellow: "\x1B[43m",
  bgBlue: "\x1B[44m",
  bgMagenta: "\x1B[45m",
  bgCyan: "\x1B[46m",
  // Frame characters
  frameHorizontal: "─",
  frameVertical: "│",
  frameTopLeft: "┌",
  frameTopRight: "┐",
  frameBottomLeft: "└",
  frameBottomRight: "┘"
};
class Rt {
  constructor() {
    F(this, "appName", "Asyar");
    F(this, "useColors", !0);
    // Can be toggled for environments without color support
    F(this, "useFrames", !1);
  }
  // Can be toggled for environments without box drawing support
  /**
   * Initialize the logger
   */
  async init(t) {
    await Nt(), t != null && t.disableColors && (this.useColors = !1), t != null && t.disableFrames && (this.useFrames = !1), this.info("Logger initialized");
  }
  /**
   * Create a framed message with colored border
   */
  createFrame(t, r) {
    if (!this.useFrames)
      return t;
    const n = t.split(`
`);
    return n.length === 1 ? this.createSingleLineFrame(t, r) : this.createMultiLineFrame(n, r);
  }
  /**
   * Create a frame for a single line message
   */
  createSingleLineFrame(t, r) {
    const n = t.replace(/\u001b\[\d+m/g, "").length, o = this.useColors ? r : "", a = this.useColors ? A.reset : "", d = `${o}${A.frameTopLeft}${A.frameHorizontal.repeat(
      n + 2
    )}${A.frameTopRight}${a}`, l = `${o}${A.frameBottomLeft}${A.frameHorizontal.repeat(n + 2)}${A.frameBottomRight}${a}`, i = `${o}${A.frameVertical}${a} ${t} ${o}${A.frameVertical}${a}`;
    return `${d}
${i}
${l}`;
  }
  /**
   * Create a frame for a multiline message
   */
  createMultiLineFrame(t, r) {
    const n = Math.max(
      ...t.map((c) => c.replace(/\u001b\[\d+m/g, "").length)
    ), o = this.useColors ? r : "", a = this.useColors ? A.reset : "", d = `${o}${A.frameTopLeft}${A.frameHorizontal.repeat(
      n + 2
    )}${A.frameTopRight}${a}`, l = `${o}${A.frameBottomLeft}${A.frameHorizontal.repeat(n + 2)}${A.frameBottomRight}${a}`, i = t.map((c) => {
      const u = n - c.replace(/\u001b\[\d+m/g, "").length;
      return `${o}${A.frameVertical}${a} ${c}${" ".repeat(
        u
      )} ${o}${A.frameVertical}${a}`;
    });
    return `${d}
${i.join(`
`)}
${l}`;
  }
  /**
   * Format message with timestamp and category
   */
  format(t, r, n, o) {
    const a = (/* @__PURE__ */ new Date()).toLocaleTimeString(), d = r.padEnd(5, " "), l = this.useColors ? `${A.dim}[${a}]${A.reset} ${n}${this.appName}:${d}${A.reset} ${t}` : `[${a}] ${this.appName}:${d} ${t}`;
    return this.createFrame(l, o);
  }
  tryLog(t, r, n) {
    try {
      if (typeof window < "u" && !window.__TAURI_INTERNALS__) {
        r(n);
        return;
      }
      t(n);
    } catch {
      r(n);
    }
  }
  /**
   * Log informational message
   */
  info(t) {
    const r = this.format(t, "INFO", `${A.bright}${A.green}`, A.green);
    this.tryLog(we, console.info, r);
  }
  /**
   * Log error message
   */
  error(t) {
    const r = t instanceof Error ? t.message : t, n = this.format(r, "ERROR", `${A.bright}${A.red}`, A.red);
    this.tryLog(Bt, console.error, n);
  }
  /**
   * Log warning message
   */
  warn(t) {
    const r = this.format(t, "WARN", `${A.bright}${A.yellow}`, A.yellow);
    this.tryLog(we, console.warn, r);
  }
  /**
   * Log debug message
   */
  debug(t) {
    const r = this.format(t, "DEBUG", `${A.cyan}`, A.cyan);
    this.tryLog(Ft, console.debug, r);
  }
  /**
   * Log success message
   */
  success(t) {
    const r = this.format(
      t,
      "OK",
      `${A.bright}${A.green}`,
      A.bgGreen
    );
    this.tryLog(we, console.info, r);
  }
  /**
   * Log message with custom category and color
   */
  custom(t, r, n, o) {
    const a = this.useColors ? A[n] || A.reset : "", d = this.useColors ? A[o || n] || A.reset : "", l = this.format(
      t,
      r,
      a,
      d
    );
    this.tryLog(we, console.info, l);
  }
  /**
   * Track extension usage with special formatting
   */
  trackExtensionUsage(t, r, n) {
    const o = (/* @__PURE__ */ new Date()).toISOString(), a = n ? JSON.stringify(n) : "";
    this.info(
      `EXTENSION_TRACKED [${o}] Extension: ${t} | Action: ${r} | ${a}`
    );
  }
}
const f = new Rt();
class Vt {
  constructor() {
    F(this, "_isTauri", null);
  }
  /**
   * Detects if the application is running within a Tauri environment.
   */
  get isTauri() {
    return this._isTauri !== null ? this._isTauri : (this._isTauri = typeof window < "u" && window.__TAURI_INTERNALS__ !== void 0, f.debug(`[EnvService] Environment detection: isTauri = ${this._isTauri}`), this._isTauri);
  }
  /**
   * Detects if the application is running in a standard browser.
   */
  get isBrowser() {
    return !this.isTauri;
  }
  /**
   * Returns the current application mode (development or production).
   */
  get mode() {
    return "production";
  }
  /**
   * Detects if the application is running in development mode.
   */
  get isDev() {
    return !1;
  }
  get storeApiBaseUrl() {
    return "https://asyar.org";
  }
}
const J = new Vt();
function se(s) {
  return Array.isArray ? Array.isArray(s) : ut(s) === "[object Array]";
}
function Tt(s) {
  if (typeof s == "string")
    return s;
  let t = s + "";
  return t == "0" && 1 / s == -1 / 0 ? "-0" : t;
}
function Ot(s) {
  return s == null ? "" : Tt(s);
}
function q(s) {
  return typeof s == "string";
}
function ct(s) {
  return typeof s == "number";
}
function Ut(s) {
  return s === !0 || s === !1 || jt(s) && ut(s) == "[object Boolean]";
}
function dt(s) {
  return typeof s == "object";
}
function jt(s) {
  return dt(s) && s !== null;
}
function K(s) {
  return s != null;
}
function Be(s) {
  return !s.trim().length;
}
function ut(s) {
  return s == null ? s === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(s);
}
const Wt = "Incorrect 'index' type", zt = (s) => `Invalid value for key ${s}`, Pt = (s) => `Pattern length exceeds max of ${s}.`, Kt = (s) => `Missing ${s} property in key`, Ht = (s) => `Property 'weight' in key '${s}' must be a positive integer`, nt = Object.prototype.hasOwnProperty;
class Gt {
  constructor(t) {
    this._keys = [], this._keyMap = {};
    let r = 0;
    t.forEach((n) => {
      let o = gt(n);
      this._keys.push(o), this._keyMap[o.id] = o, r += o.weight;
    }), this._keys.forEach((n) => {
      n.weight /= r;
    });
  }
  get(t) {
    return this._keyMap[t];
  }
  keys() {
    return this._keys;
  }
  toJSON() {
    return JSON.stringify(this._keys);
  }
}
function gt(s) {
  let t = null, r = null, n = null, o = 1, a = null;
  if (q(s) || se(s))
    n = s, t = st(s), r = Le(s);
  else {
    if (!nt.call(s, "name"))
      throw new Error(Kt("name"));
    const d = s.name;
    if (n = d, nt.call(s, "weight") && (o = s.weight, o <= 0))
      throw new Error(Ht(d));
    t = st(d), r = Le(d), a = s.getFn;
  }
  return { path: t, id: r, weight: o, src: n, getFn: a };
}
function st(s) {
  return se(s) ? s : s.split(".");
}
function Le(s) {
  return se(s) ? s.join(".") : s;
}
function Qt(s, t) {
  let r = [], n = !1;
  const o = (a, d, l) => {
    if (K(a))
      if (!d[l])
        r.push(a);
      else {
        let i = d[l];
        const c = a[i];
        if (!K(c))
          return;
        if (l === d.length - 1 && (q(c) || ct(c) || Ut(c)))
          r.push(Ot(c));
        else if (se(c)) {
          n = !0;
          for (let u = 0, g = c.length; u < g; u += 1)
            o(c[u], d, l + 1);
        } else d.length && o(c, d, l + 1);
      }
  };
  return o(s, q(t) ? t.split(".") : t, 0), n ? r : r[0];
}
const Xt = {
  // Whether the matches should be included in the result set. When `true`, each record in the result
  // set will include the indices of the matched characters.
  // These can consequently be used for highlighting purposes.
  includeMatches: !1,
  // When `true`, the matching function will continue to the end of a search pattern even if
  // a perfect match has already been located in the string.
  findAllMatches: !1,
  // Minimum number of characters that must be matched before a result is considered a match
  minMatchCharLength: 1
}, Yt = {
  // When `true`, the algorithm continues searching to the end of the input even if a perfect
  // match is found before the end of the same input.
  isCaseSensitive: !1,
  // When `true`, the algorithm will ignore diacritics (accents) in comparisons
  ignoreDiacritics: !1,
  // When true, the matching function will continue to the end of a search pattern even if
  includeScore: !1,
  // List of properties that will be searched. This also supports nested properties.
  keys: [],
  // Whether to sort the result list, by score
  shouldSort: !0,
  // Default sort function: sort by ascending score, ascending index
  sortFn: (s, t) => s.score === t.score ? s.idx < t.idx ? -1 : 1 : s.score < t.score ? -1 : 1
}, Jt = {
  // Approximately where in the text is the pattern expected to be found?
  location: 0,
  // At what point does the match algorithm give up. A threshold of '0.0' requires a perfect match
  // (of both letters and location), a threshold of '1.0' would match anything.
  threshold: 0.6,
  // Determines how close the match must be to the fuzzy location (specified above).
  // An exact letter match which is 'distance' characters away from the fuzzy location
  // would score as a complete mismatch. A distance of '0' requires the match be at
  // the exact location specified, a threshold of '1000' would require a perfect match
  // to be within 800 characters of the fuzzy location to be found using a 0.8 threshold.
  distance: 100
}, Zt = {
  // When `true`, it enables the use of unix-like search commands
  useExtendedSearch: !1,
  // The get function to use when fetching an object's properties.
  // The default will search nested paths *ie foo.bar.baz*
  getFn: Qt,
  // When `true`, search will ignore `location` and `distance`, so it won't matter
  // where in the string the pattern appears.
  // More info: https://fusejs.io/concepts/scoring-theory.html#fuzziness-score
  ignoreLocation: !1,
  // When `true`, the calculation for the relevance score (used for sorting) will
  // ignore the field-length norm.
  // More info: https://fusejs.io/concepts/scoring-theory.html#field-length-norm
  ignoreFieldNorm: !1,
  // The weight to determine how much field length norm effects scoring.
  fieldNormWeight: 1
};
var b = {
  ...Yt,
  ...Xt,
  ...Jt,
  ...Zt
};
const qt = /[^ ]+/g;
function er(s = 1, t = 3) {
  const r = /* @__PURE__ */ new Map(), n = Math.pow(10, t);
  return {
    get(o) {
      const a = o.match(qt).length;
      if (r.has(a))
        return r.get(a);
      const d = 1 / Math.pow(a, 0.5 * s), l = parseFloat(Math.round(d * n) / n);
      return r.set(a, l), l;
    },
    clear() {
      r.clear();
    }
  };
}
class ze {
  constructor({
    getFn: t = b.getFn,
    fieldNormWeight: r = b.fieldNormWeight
  } = {}) {
    this.norm = er(r, 3), this.getFn = t, this.isCreated = !1, this.setIndexRecords();
  }
  setSources(t = []) {
    this.docs = t;
  }
  setIndexRecords(t = []) {
    this.records = t;
  }
  setKeys(t = []) {
    this.keys = t, this._keysMap = {}, t.forEach((r, n) => {
      this._keysMap[r.id] = n;
    });
  }
  create() {
    this.isCreated || !this.docs.length || (this.isCreated = !0, q(this.docs[0]) ? this.docs.forEach((t, r) => {
      this._addString(t, r);
    }) : this.docs.forEach((t, r) => {
      this._addObject(t, r);
    }), this.norm.clear());
  }
  // Adds a doc to the end of the index
  add(t) {
    const r = this.size();
    q(t) ? this._addString(t, r) : this._addObject(t, r);
  }
  // Removes the doc at the specified index of the index
  removeAt(t) {
    this.records.splice(t, 1);
    for (let r = t, n = this.size(); r < n; r += 1)
      this.records[r].i -= 1;
  }
  getValueForItemAtKeyId(t, r) {
    return t[this._keysMap[r]];
  }
  size() {
    return this.records.length;
  }
  _addString(t, r) {
    if (!K(t) || Be(t))
      return;
    let n = {
      v: t,
      i: r,
      n: this.norm.get(t)
    };
    this.records.push(n);
  }
  _addObject(t, r) {
    let n = { i: r, $: {} };
    this.keys.forEach((o, a) => {
      let d = o.getFn ? o.getFn(t) : this.getFn(t, o.path);
      if (K(d)) {
        if (se(d)) {
          let l = [];
          const i = [{ nestedArrIndex: -1, value: d }];
          for (; i.length; ) {
            const { nestedArrIndex: c, value: u } = i.pop();
            if (K(u))
              if (q(u) && !Be(u)) {
                let g = {
                  v: u,
                  i: c,
                  n: this.norm.get(u)
                };
                l.push(g);
              } else se(u) && u.forEach((g, h) => {
                i.push({
                  nestedArrIndex: h,
                  value: g
                });
              });
          }
          n.$[a] = l;
        } else if (q(d) && !Be(d)) {
          let l = {
            v: d,
            n: this.norm.get(d)
          };
          n.$[a] = l;
        }
      }
    }), this.records.push(n);
  }
  toJSON() {
    return {
      keys: this.keys,
      records: this.records
    };
  }
}
function ht(s, t, { getFn: r = b.getFn, fieldNormWeight: n = b.fieldNormWeight } = {}) {
  const o = new ze({ getFn: r, fieldNormWeight: n });
  return o.setKeys(s.map(gt)), o.setSources(t), o.create(), o;
}
function tr(s, { getFn: t = b.getFn, fieldNormWeight: r = b.fieldNormWeight } = {}) {
  const { keys: n, records: o } = s, a = new ze({ getFn: t, fieldNormWeight: r });
  return a.setKeys(n), a.setIndexRecords(o), a;
}
function ye(s, {
  errors: t = 0,
  currentLocation: r = 0,
  expectedLocation: n = 0,
  distance: o = b.distance,
  ignoreLocation: a = b.ignoreLocation
} = {}) {
  const d = t / s.length;
  if (a)
    return d;
  const l = Math.abs(n - r);
  return o ? d + l / o : l ? 1 : d;
}
function rr(s = [], t = b.minMatchCharLength) {
  let r = [], n = -1, o = -1, a = 0;
  for (let d = s.length; a < d; a += 1) {
    let l = s[a];
    l && n === -1 ? n = a : !l && n !== -1 && (o = a - 1, o - n + 1 >= t && r.push([n, o]), n = -1);
  }
  return s[a - 1] && a - n >= t && r.push([n, a - 1]), r;
}
const ue = 32;
function nr(s, t, r, {
  location: n = b.location,
  distance: o = b.distance,
  threshold: a = b.threshold,
  findAllMatches: d = b.findAllMatches,
  minMatchCharLength: l = b.minMatchCharLength,
  includeMatches: i = b.includeMatches,
  ignoreLocation: c = b.ignoreLocation
} = {}) {
  if (t.length > ue)
    throw new Error(Pt(ue));
  const u = t.length, g = s.length, h = Math.max(0, Math.min(n, g));
  let m = a, _ = h;
  const S = l > 1 || i, x = S ? Array(g) : [];
  let I;
  for (; (I = s.indexOf(t, _)) > -1; ) {
    let D = ye(t, {
      currentLocation: I,
      expectedLocation: h,
      distance: o,
      ignoreLocation: c
    });
    if (m = Math.min(D, m), _ = I + u, S) {
      let T = 0;
      for (; T < u; )
        x[I + T] = 1, T += 1;
    }
  }
  _ = -1;
  let $ = [], C = 1, y = u + g;
  const M = 1 << u - 1;
  for (let D = 0; D < u; D += 1) {
    let T = 0, k = y;
    for (; T < k; )
      ye(t, {
        errors: D,
        currentLocation: h + k,
        expectedLocation: h,
        distance: o,
        ignoreLocation: c
      }) <= m ? T = k : y = k, k = Math.floor((y - T) / 2 + T);
    y = k;
    let L = Math.max(1, h - k + 1), v = d ? g : Math.min(h + k, g) + u, p = Array(v + 2);
    p[v + 1] = (1 << D) - 1;
    for (let E = v; E >= L; E -= 1) {
      let B = E - 1, R = r[s.charAt(B)];
      if (S && (x[B] = +!!R), p[E] = (p[E + 1] << 1 | 1) & R, D && (p[E] |= ($[E + 1] | $[E]) << 1 | 1 | $[E + 1]), p[E] & M && (C = ye(t, {
        errors: D,
        currentLocation: B,
        expectedLocation: h,
        distance: o,
        ignoreLocation: c
      }), C <= m)) {
        if (m = C, _ = B, _ <= h)
          break;
        L = Math.max(1, 2 * h - _);
      }
    }
    if (ye(t, {
      errors: D + 1,
      currentLocation: h,
      expectedLocation: h,
      distance: o,
      ignoreLocation: c
    }) > m)
      break;
    $ = p;
  }
  const U = {
    isMatch: _ >= 0,
    // Count exact matches (those with a score of 0) to be "almost" exact
    score: Math.max(1e-3, C)
  };
  if (S) {
    const D = rr(x, l);
    D.length ? i && (U.indices = D) : U.isMatch = !1;
  }
  return U;
}
function sr(s) {
  let t = {};
  for (let r = 0, n = s.length; r < n; r += 1) {
    const o = s.charAt(r);
    t[o] = (t[o] || 0) | 1 << n - r - 1;
  }
  return t;
}
const Se = String.prototype.normalize ? ((s) => s.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "")) : ((s) => s);
class ft {
  constructor(t, {
    location: r = b.location,
    threshold: n = b.threshold,
    distance: o = b.distance,
    includeMatches: a = b.includeMatches,
    findAllMatches: d = b.findAllMatches,
    minMatchCharLength: l = b.minMatchCharLength,
    isCaseSensitive: i = b.isCaseSensitive,
    ignoreDiacritics: c = b.ignoreDiacritics,
    ignoreLocation: u = b.ignoreLocation
  } = {}) {
    if (this.options = {
      location: r,
      threshold: n,
      distance: o,
      includeMatches: a,
      findAllMatches: d,
      minMatchCharLength: l,
      isCaseSensitive: i,
      ignoreDiacritics: c,
      ignoreLocation: u
    }, t = i ? t : t.toLowerCase(), t = c ? Se(t) : t, this.pattern = t, this.chunks = [], !this.pattern.length)
      return;
    const g = (m, _) => {
      this.chunks.push({
        pattern: m,
        alphabet: sr(m),
        startIndex: _
      });
    }, h = this.pattern.length;
    if (h > ue) {
      let m = 0;
      const _ = h % ue, S = h - _;
      for (; m < S; )
        g(this.pattern.substr(m, ue), m), m += ue;
      if (_) {
        const x = h - ue;
        g(this.pattern.substr(x), x);
      }
    } else
      g(this.pattern, 0);
  }
  searchIn(t) {
    const { isCaseSensitive: r, ignoreDiacritics: n, includeMatches: o } = this.options;
    if (t = r ? t : t.toLowerCase(), t = n ? Se(t) : t, this.pattern === t) {
      let S = {
        isMatch: !0,
        score: 0
      };
      return o && (S.indices = [[0, t.length - 1]]), S;
    }
    const {
      location: a,
      distance: d,
      threshold: l,
      findAllMatches: i,
      minMatchCharLength: c,
      ignoreLocation: u
    } = this.options;
    let g = [], h = 0, m = !1;
    this.chunks.forEach(({ pattern: S, alphabet: x, startIndex: I }) => {
      const { isMatch: $, score: C, indices: y } = nr(t, S, x, {
        location: a + I,
        distance: d,
        threshold: l,
        findAllMatches: i,
        minMatchCharLength: c,
        includeMatches: o,
        ignoreLocation: u
      });
      $ && (m = !0), h += C, $ && y && (g = [...g, ...y]);
    });
    let _ = {
      isMatch: m,
      score: m ? h / this.chunks.length : 1
    };
    return m && o && (_.indices = g), _;
  }
}
class oe {
  constructor(t) {
    this.pattern = t;
  }
  static isMultiMatch(t) {
    return it(t, this.multiRegex);
  }
  static isSingleMatch(t) {
    return it(t, this.singleRegex);
  }
  search() {
  }
}
function it(s, t) {
  const r = s.match(t);
  return r ? r[1] : null;
}
class ir extends oe {
  constructor(t) {
    super(t);
  }
  static get type() {
    return "exact";
  }
  static get multiRegex() {
    return /^="(.*)"$/;
  }
  static get singleRegex() {
    return /^=(.*)$/;
  }
  search(t) {
    const r = t === this.pattern;
    return {
      isMatch: r,
      score: r ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    };
  }
}
class ar extends oe {
  constructor(t) {
    super(t);
  }
  static get type() {
    return "inverse-exact";
  }
  static get multiRegex() {
    return /^!"(.*)"$/;
  }
  static get singleRegex() {
    return /^!(.*)$/;
  }
  search(t) {
    const n = t.indexOf(this.pattern) === -1;
    return {
      isMatch: n,
      score: n ? 0 : 1,
      indices: [0, t.length - 1]
    };
  }
}
class or extends oe {
  constructor(t) {
    super(t);
  }
  static get type() {
    return "prefix-exact";
  }
  static get multiRegex() {
    return /^\^"(.*)"$/;
  }
  static get singleRegex() {
    return /^\^(.*)$/;
  }
  search(t) {
    const r = t.startsWith(this.pattern);
    return {
      isMatch: r,
      score: r ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    };
  }
}
class lr extends oe {
  constructor(t) {
    super(t);
  }
  static get type() {
    return "inverse-prefix-exact";
  }
  static get multiRegex() {
    return /^!\^"(.*)"$/;
  }
  static get singleRegex() {
    return /^!\^(.*)$/;
  }
  search(t) {
    const r = !t.startsWith(this.pattern);
    return {
      isMatch: r,
      score: r ? 0 : 1,
      indices: [0, t.length - 1]
    };
  }
}
class cr extends oe {
  constructor(t) {
    super(t);
  }
  static get type() {
    return "suffix-exact";
  }
  static get multiRegex() {
    return /^"(.*)"\$$/;
  }
  static get singleRegex() {
    return /^(.*)\$$/;
  }
  search(t) {
    const r = t.endsWith(this.pattern);
    return {
      isMatch: r,
      score: r ? 0 : 1,
      indices: [t.length - this.pattern.length, t.length - 1]
    };
  }
}
class dr extends oe {
  constructor(t) {
    super(t);
  }
  static get type() {
    return "inverse-suffix-exact";
  }
  static get multiRegex() {
    return /^!"(.*)"\$$/;
  }
  static get singleRegex() {
    return /^!(.*)\$$/;
  }
  search(t) {
    const r = !t.endsWith(this.pattern);
    return {
      isMatch: r,
      score: r ? 0 : 1,
      indices: [0, t.length - 1]
    };
  }
}
class mt extends oe {
  constructor(t, {
    location: r = b.location,
    threshold: n = b.threshold,
    distance: o = b.distance,
    includeMatches: a = b.includeMatches,
    findAllMatches: d = b.findAllMatches,
    minMatchCharLength: l = b.minMatchCharLength,
    isCaseSensitive: i = b.isCaseSensitive,
    ignoreDiacritics: c = b.ignoreDiacritics,
    ignoreLocation: u = b.ignoreLocation
  } = {}) {
    super(t), this._bitapSearch = new ft(t, {
      location: r,
      threshold: n,
      distance: o,
      includeMatches: a,
      findAllMatches: d,
      minMatchCharLength: l,
      isCaseSensitive: i,
      ignoreDiacritics: c,
      ignoreLocation: u
    });
  }
  static get type() {
    return "fuzzy";
  }
  static get multiRegex() {
    return /^"(.*)"$/;
  }
  static get singleRegex() {
    return /^(.*)$/;
  }
  search(t) {
    return this._bitapSearch.searchIn(t);
  }
}
class xt extends oe {
  constructor(t) {
    super(t);
  }
  static get type() {
    return "include";
  }
  static get multiRegex() {
    return /^'"(.*)"$/;
  }
  static get singleRegex() {
    return /^'(.*)$/;
  }
  search(t) {
    let r = 0, n;
    const o = [], a = this.pattern.length;
    for (; (n = t.indexOf(this.pattern, r)) > -1; )
      r = n + a, o.push([n, r - 1]);
    const d = !!o.length;
    return {
      isMatch: d,
      score: d ? 0 : 1,
      indices: o
    };
  }
}
const Ne = [
  ir,
  xt,
  or,
  lr,
  dr,
  cr,
  ar,
  mt
], at = Ne.length, ur = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/, gr = "|";
function hr(s, t = {}) {
  return s.split(gr).map((r) => {
    let n = r.trim().split(ur).filter((a) => a && !!a.trim()), o = [];
    for (let a = 0, d = n.length; a < d; a += 1) {
      const l = n[a];
      let i = !1, c = -1;
      for (; !i && ++c < at; ) {
        const u = Ne[c];
        let g = u.isMultiMatch(l);
        g && (o.push(new u(g, t)), i = !0);
      }
      if (!i)
        for (c = -1; ++c < at; ) {
          const u = Ne[c];
          let g = u.isSingleMatch(l);
          if (g) {
            o.push(new u(g, t));
            break;
          }
        }
    }
    return o;
  });
}
const fr = /* @__PURE__ */ new Set([mt.type, xt.type]);
class mr {
  constructor(t, {
    isCaseSensitive: r = b.isCaseSensitive,
    ignoreDiacritics: n = b.ignoreDiacritics,
    includeMatches: o = b.includeMatches,
    minMatchCharLength: a = b.minMatchCharLength,
    ignoreLocation: d = b.ignoreLocation,
    findAllMatches: l = b.findAllMatches,
    location: i = b.location,
    threshold: c = b.threshold,
    distance: u = b.distance
  } = {}) {
    this.query = null, this.options = {
      isCaseSensitive: r,
      ignoreDiacritics: n,
      includeMatches: o,
      minMatchCharLength: a,
      findAllMatches: l,
      ignoreLocation: d,
      location: i,
      threshold: c,
      distance: u
    }, t = r ? t : t.toLowerCase(), t = n ? Se(t) : t, this.pattern = t, this.query = hr(this.pattern, this.options);
  }
  static condition(t, r) {
    return r.useExtendedSearch;
  }
  searchIn(t) {
    const r = this.query;
    if (!r)
      return {
        isMatch: !1,
        score: 1
      };
    const { includeMatches: n, isCaseSensitive: o, ignoreDiacritics: a } = this.options;
    t = o ? t : t.toLowerCase(), t = a ? Se(t) : t;
    let d = 0, l = [], i = 0;
    for (let c = 0, u = r.length; c < u; c += 1) {
      const g = r[c];
      l.length = 0, d = 0;
      for (let h = 0, m = g.length; h < m; h += 1) {
        const _ = g[h], { isMatch: S, indices: x, score: I } = _.search(t);
        if (S) {
          if (d += 1, i += I, n) {
            const $ = _.constructor.type;
            fr.has($) ? l = [...l, ...x] : l.push(x);
          }
        } else {
          i = 0, d = 0, l.length = 0;
          break;
        }
      }
      if (d) {
        let h = {
          isMatch: !0,
          score: i / d
        };
        return n && (h.indices = l), h;
      }
    }
    return {
      isMatch: !1,
      score: 1
    };
  }
}
const Re = [];
function xr(...s) {
  Re.push(...s);
}
function Ve(s, t) {
  for (let r = 0, n = Re.length; r < n; r += 1) {
    let o = Re[r];
    if (o.condition(s, t))
      return new o(s, t);
  }
  return new ft(s, t);
}
const Ie = {
  AND: "$and",
  OR: "$or"
}, Te = {
  PATH: "$path",
  PATTERN: "$val"
}, Oe = (s) => !!(s[Ie.AND] || s[Ie.OR]), pr = (s) => !!s[Te.PATH], vr = (s) => !se(s) && dt(s) && !Oe(s), ot = (s) => ({
  [Ie.AND]: Object.keys(s).map((t) => ({
    [t]: s[t]
  }))
});
function pt(s, t, { auto: r = !0 } = {}) {
  const n = (o) => {
    let a = Object.keys(o);
    const d = pr(o);
    if (!d && a.length > 1 && !Oe(o))
      return n(ot(o));
    if (vr(o)) {
      const i = d ? o[Te.PATH] : a[0], c = d ? o[Te.PATTERN] : o[i];
      if (!q(c))
        throw new Error(zt(i));
      const u = {
        keyId: Le(i),
        pattern: c
      };
      return r && (u.searcher = Ve(c, t)), u;
    }
    let l = {
      children: [],
      operator: a[0]
    };
    return a.forEach((i) => {
      const c = o[i];
      se(c) && c.forEach((u) => {
        l.children.push(n(u));
      });
    }), l;
  };
  return Oe(s) || (s = ot(s)), n(s);
}
function br(s, { ignoreFieldNorm: t = b.ignoreFieldNorm }) {
  s.forEach((r) => {
    let n = 1;
    r.matches.forEach(({ key: o, norm: a, score: d }) => {
      const l = o ? o.weight : null;
      n *= Math.pow(
        d === 0 && l ? Number.EPSILON : d,
        (l || 1) * (t ? 1 : a)
      );
    }), r.score = n;
  });
}
function wr(s, t) {
  const r = s.matches;
  t.matches = [], K(r) && r.forEach((n) => {
    if (!K(n.indices) || !n.indices.length)
      return;
    const { indices: o, value: a } = n;
    let d = {
      indices: o,
      value: a
    };
    n.key && (d.key = n.key.src), n.idx > -1 && (d.refIndex = n.idx), t.matches.push(d);
  });
}
function yr(s, t) {
  t.score = s.score;
}
function _r(s, t, {
  includeMatches: r = b.includeMatches,
  includeScore: n = b.includeScore
} = {}) {
  const o = [];
  return r && o.push(wr), n && o.push(yr), s.map((a) => {
    const { idx: d } = a, l = {
      item: t[d],
      refIndex: d
    };
    return o.length && o.forEach((i) => {
      i(a, l);
    }), l;
  });
}
class pe {
  constructor(t, r = {}, n) {
    this.options = { ...b, ...r }, this.options.useExtendedSearch, this._keyStore = new Gt(this.options.keys), this.setCollection(t, n);
  }
  setCollection(t, r) {
    if (this._docs = t, r && !(r instanceof ze))
      throw new Error(Wt);
    this._myIndex = r || ht(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
  }
  add(t) {
    K(t) && (this._docs.push(t), this._myIndex.add(t));
  }
  remove(t = () => !1) {
    const r = [];
    for (let n = 0, o = this._docs.length; n < o; n += 1) {
      const a = this._docs[n];
      t(a, n) && (this.removeAt(n), n -= 1, o -= 1, r.push(a));
    }
    return r;
  }
  removeAt(t) {
    this._docs.splice(t, 1), this._myIndex.removeAt(t);
  }
  getIndex() {
    return this._myIndex;
  }
  search(t, { limit: r = -1 } = {}) {
    const {
      includeMatches: n,
      includeScore: o,
      shouldSort: a,
      sortFn: d,
      ignoreFieldNorm: l
    } = this.options;
    let i = q(t) ? q(this._docs[0]) ? this._searchStringList(t) : this._searchObjectList(t) : this._searchLogical(t);
    return br(i, { ignoreFieldNorm: l }), a && i.sort(d), ct(r) && r > -1 && (i = i.slice(0, r)), _r(i, this._docs, {
      includeMatches: n,
      includeScore: o
    });
  }
  _searchStringList(t) {
    const r = Ve(t, this.options), { records: n } = this._myIndex, o = [];
    return n.forEach(({ v: a, i: d, n: l }) => {
      if (!K(a))
        return;
      const { isMatch: i, score: c, indices: u } = r.searchIn(a);
      i && o.push({
        item: a,
        idx: d,
        matches: [{ score: c, value: a, norm: l, indices: u }]
      });
    }), o;
  }
  _searchLogical(t) {
    const r = pt(t, this.options), n = (l, i, c) => {
      if (!l.children) {
        const { keyId: g, searcher: h } = l, m = this._findMatches({
          key: this._keyStore.get(g),
          value: this._myIndex.getValueForItemAtKeyId(i, g),
          searcher: h
        });
        return m && m.length ? [
          {
            idx: c,
            item: i,
            matches: m
          }
        ] : [];
      }
      const u = [];
      for (let g = 0, h = l.children.length; g < h; g += 1) {
        const m = l.children[g], _ = n(m, i, c);
        if (_.length)
          u.push(..._);
        else if (l.operator === Ie.AND)
          return [];
      }
      return u;
    }, o = this._myIndex.records, a = {}, d = [];
    return o.forEach(({ $: l, i }) => {
      if (K(l)) {
        let c = n(r, l, i);
        c.length && (a[i] || (a[i] = { idx: i, item: l, matches: [] }, d.push(a[i])), c.forEach(({ matches: u }) => {
          a[i].matches.push(...u);
        }));
      }
    }), d;
  }
  _searchObjectList(t) {
    const r = Ve(t, this.options), { keys: n, records: o } = this._myIndex, a = [];
    return o.forEach(({ $: d, i: l }) => {
      if (!K(d))
        return;
      let i = [];
      n.forEach((c, u) => {
        i.push(
          ...this._findMatches({
            key: c,
            value: d[u],
            searcher: r
          })
        );
      }), i.length && a.push({
        idx: l,
        item: d,
        matches: i
      });
    }), a;
  }
  _findMatches({ key: t, value: r, searcher: n }) {
    if (!K(r))
      return [];
    let o = [];
    if (se(r))
      r.forEach(({ v: a, i: d, n: l }) => {
        if (!K(a))
          return;
        const { isMatch: i, score: c, indices: u } = n.searchIn(a);
        i && o.push({
          score: c,
          key: t,
          value: a,
          idx: d,
          norm: l,
          indices: u
        });
      });
    else {
      const { v: a, n: d } = r, { isMatch: l, score: i, indices: c } = n.searchIn(a);
      l && o.push({ score: i, key: t, value: a, norm: d, indices: c });
    }
    return o;
  }
}
pe.version = "7.1.0";
pe.createIndex = ht;
pe.parseIndex = tr;
pe.config = b;
pe.parseQuery = pt;
xr(mr);
const Ar = {
  includeScore: !0,
  threshold: 0.4,
  // Adjust threshold as needed
  keys: ["name", "description", "author.name", "category", "keywords"]
  // Add keywords if available in ApiExtension
};
function Er() {
  const { subscribe: s, set: t, update: r } = je({
    searchQuery: "",
    filtered: !1,
    fuseInstance: null,
    allItems: [],
    filteredItems: [],
    selectedItem: null,
    selectedIndex: -1,
    // Start with -1 (no selection)
    isLoading: !0,
    loadError: !1,
    errorMessage: "",
    selectedExtensionSlug: null,
    extensionManager: null,
    // Initialize as null
    logService: null,
    // Initialize logService as null
    installingExtensionSlug: null,
    uninstallingExtensionSlug: null
  });
  let n = null;
  function o(l) {
    n = l, r((i) => ({ ...i, logService: l })), n == null || n.debug("[Store State] LogService set.");
  }
  function a(l) {
    r((i) => ({ ...i, extensionManager: l })), n == null || n.debug("[Store State] ExtensionManager set.");
  }
  function d(l) {
    return l.searchQuery ? l.fuseInstance ? l.fuseInstance.search(l.searchQuery).map((c) => c.item) : (n == null || n.warn("Fuse instance not initialized for search."), l.allItems) : l.allItems;
  }
  return {
    subscribe: s,
    // initializeServices, // Deprecated
    setLogService: o,
    // Expose setter
    setExtensionManager: a,
    // Expose setter
    setItems: (l) => {
      n == null || n.debug(`Store state received ${l.length} items.`), r((i) => {
        const c = new pe(l, Ar), u = {
          ...i,
          allItems: l,
          fuseInstance: c,
          isLoading: !1,
          loadError: !1,
          errorMessage: ""
        };
        return u.filteredItems = d(u), u.selectedIndex = u.filteredItems.length > 0 ? 0 : -1, u.selectedItem = u.selectedIndex !== -1 ? u.filteredItems[u.selectedIndex] : null, u;
      });
    },
    setSearch: (l) => {
      r((i) => {
        const c = {
          ...i,
          searchQuery: l,
          filtered: l.length > 0
        };
        return c.filteredItems = d(c), c.selectedIndex = c.filteredItems.length > 0 ? 0 : -1, c.selectedItem = c.selectedIndex !== -1 ? c.filteredItems[c.selectedIndex] : null, c;
      });
    },
    moveSelection(l) {
      r((i) => {
        if (!i.filteredItems.length) return i;
        let c = i.selectedIndex;
        const u = i.filteredItems.length - 1;
        return l === "up" ? c = c <= 0 ? u : c - 1 : c = c >= u ? 0 : c + 1, {
          ...i,
          selectedIndex: c,
          selectedItem: i.filteredItems[c]
        };
      });
    },
    setSelectedItemByIndex(l) {
      r((i) => l >= 0 && l < i.filteredItems.length ? {
        ...i,
        selectedIndex: l,
        selectedItem: i.filteredItems[l]
      } : { ...i, selectedIndex: -1, selectedItem: null });
    },
    setSelectedExtensionSlug(l) {
      r((i) => ({ ...i, selectedExtensionSlug: l }));
    },
    setInstallingSlug(l) {
      r((i) => ({ ...i, installingExtensionSlug: l }));
    },
    setUninstallingSlug(l) {
      r((i) => ({ ...i, uninstallingExtensionSlug: l }));
    },
    setLoading(l) {
      r((i) => ({ ...i, isLoading: l }));
    },
    setError(l) {
      r((i) => ({
        ...i,
        loadError: !0,
        errorMessage: l,
        isLoading: !1,
        allItems: [],
        filteredItems: []
      }));
    },
    updateItemStatus(l, i) {
      r((c) => {
        const u = { ...c };
        return u.allItems = u.allItems.map(
          (g) => g.slug === l ? { ...g, status: i } : g
        ), u.filteredItems = d(u), u.selectedItem && u.selectedItem.slug === l && (u.selectedItem = { ...u.selectedItem, status: i }), u;
      });
    }
  };
}
let V = null;
function P() {
  return V || (V = Er()), V;
}
var Sr = e.from_html('<div class="split-view"><div class="split-view-content isolate svelte-ea3q70"><div class="split-view-left custom-scrollbar h-full overflow-y-auto"><!></div>  <div class="w-1 hover:w-2 cursor-ew-resize hover:bg-[var(--border-color)] transition-all z-10" role="separator" aria-orientation="vertical"></div> <div class="split-view-right h-full"><!></div></div></div>');
function Ir(s, t) {
  let r = e.prop(t, "leftWidth", 3, "33.333%"), n = e.prop(t, "minLeftWidth", 3, 200), o = e.prop(t, "maxLeftWidth", 3, 800), a = e.state(!1), d = e.state(0), l = e.state(0), i = e.state(void 0), c = e.state(void 0);
  function u(y) {
    var M;
    e.set(a, !0), e.set(d, y.pageX, !0), e.set(l, ((M = e.get(i)) == null ? void 0 : M.offsetWidth) ?? 0, !0), window.addEventListener("mousemove", g), window.addEventListener("mouseup", h), document.body.style.cursor = "ew-resize", document.body.style.userSelect = "none";
  }
  function g(y) {
    if (!e.get(a) || !e.get(i)) return;
    const M = y.pageX - e.get(d), U = Math.min(Math.max(e.get(l) + M, n()), o());
    e.get(i).style.width = `${U}px`;
  }
  function h() {
    e.set(a, !1), window.removeEventListener("mousemove", g), window.removeEventListener("mouseup", h), document.body.style.cursor = "", document.body.style.userSelect = "";
  }
  var m = Sr(), _ = e.child(m), S = e.child(_), x = e.child(S);
  e.snippet(x, () => t.left ?? e.noop), e.reset(S), e.bind_this(S, (y) => e.set(i, y), () => e.get(i));
  var I = e.sibling(S, 2), $ = e.sibling(I, 2), C = e.child($);
  e.snippet(C, () => t.right ?? e.noop), e.reset($), e.bind_this($, (y) => e.set(c, y), () => e.get(c)), e.reset(_), e.reset(m), e.template_effect(() => e.set_style(S, `width: ${(typeof r() == "number" ? `${r()}px` : r()) ?? ""}`)), e.delegated("mousedown", I, u), e.append(s, m);
}
e.delegate(["mousedown"]);
var $r = e.from_html('<div class="flex items-center justify-center p-8"><div class="text-gray-500 dark:text-gray-400 text-sm">Loading extensions...</div></div>'), kr = e.from_html('<div class="p-4 text-red-500 bg-red-100/10 rounded-lg m-4 border border-red-500/20 text-center text-sm"> </div>'), Cr = e.from_html('<div class="p-4 text-center text-sm text-gray-500">No extensions found</div>'), Dr = e.from_html('<img class="w-full h-full object-cover"/>'), Mr = e.from_html('<span class="text-lg">🧩</span>'), Br = e.from_html('<div role="option"><div class="mr-3 flex-shrink-0 w-8 h-8 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center border border-gray-200 dark:border-gray-700"><!></div> <div class="flex-1 overflow-hidden flex flex-col justify-center gap-0.5"><div class="flex items-center gap-2"><div> </div></div> <div> </div></div> <div class="ml-2 flex-shrink-0 text-right space-y-1"><div> </div></div></div>'), Fr = e.from_html('<div class="h-full overflow-y-auto focus:outline-none bg-white dark:bg-[#1e1e1e] py-2 border-r border-gray-100 dark:border-gray-800 custom-scrollbar svelte-oje4kk" role="listbox" aria-label="Store Extensions" tabindex="0"><!></div>'), Lr = e.from_html('<img class="w-full h-full object-cover"/>'), Nr = e.from_html('<span class="text-6xl">🧩</span>'), Rr = e.from_html('<div class="mt-8 w-full max-w-md bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"><img alt="Screenshot" class="w-full rounded border border-gray-100 dark:border-gray-800 object-cover"/></div>'), Vr = e.from_html('<div class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar flex flex-col items-center pt-12 svelte-oje4kk"><div class="w-32 h-32 rounded-3xl bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700 flex items-center justify-center mb-6 overflow-hidden"><!></div> <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-2 text-center"> </h2> <div class="flex items-center gap-3 text-[13px] text-gray-500 dark:text-gray-400 mb-6 font-medium"><span class="flex items-center gap-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg> </span> <span class="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600"></span> <span class="flex items-center gap-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> </span></div> <p class="text-[14px] leading-relaxed text-gray-700 dark:text-gray-300 text-center max-w-md"> </p> <!></div> <div class="h-12 border-t border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-[#1e1e1e]/80 backdrop-blur-md flex items-center px-4 justify-between text-xs text-gray-500 dark:text-gray-400 shadow-sm z-10 w-full shrink-0"><div class="flex items-center gap-3"><span class="uppercase tracking-wider text-[10px] font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded border border-green-200 dark:border-green-800"> </span> <span> </span></div> <div class="flex items-center gap-1.5 opacity-80 font-medium"><kbd class="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-sans shadow-sm svelte-oje4kk">Enter</kbd> <span>to View Details</span></div></div>', 1), Tr = e.from_html('<div class="flex h-full items-center justify-center flex-col gap-4 text-gray-400 dark:text-gray-600"><svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg> <span class="text-sm font-medium">Select an extension to view details</span></div>'), Or = e.from_html('<div class="h-full flex flex-col bg-gray-50/50 dark:bg-[#161616]/50 overflow-hidden relative"><!></div>');
function mn(s, t) {
  e.push(t, !1);
  const r = () => e.store_get(g, "$store", n), [n, o] = e.setup_stores(), a = e.mutable_source(), d = e.mutable_source(), l = e.mutable_source(), i = e.mutable_source(), c = e.mutable_source(), u = e.mutable_source(), g = P();
  let h = e.mutable_source();
  lt(async () => {
    await It();
  });
  function m() {
    requestAnimationFrame(() => {
      if (!e.get(h)) return;
      const x = e.get(h).querySelector(`[data-index="${e.get(i)}"]`);
      if (x) {
        const I = e.get(h).getBoundingClientRect(), $ = x.getBoundingClientRect(), C = $.top < I.top, y = $.bottom > I.bottom;
        C ? x.scrollIntoView({ block: "start", behavior: "auto" }) : y && x.scrollIntoView({ block: "end", behavior: "auto" });
      }
    });
  }
  function _(x) {
    g.setSelectedItemByIndex(x);
  }
  function S(x) {
    g.setSelectedExtensionSlug(x), e.get(u) && e.get(u).navigateToView("store/DetailView");
  }
  e.legacy_pre_effect(() => r(), () => {
    e.set(a, r().isLoading);
  }), e.legacy_pre_effect(() => r(), () => {
    e.set(d, r().loadError ? r().errorMessage : null);
  }), e.legacy_pre_effect(() => r(), () => {
    e.set(l, r().filteredItems);
  }), e.legacy_pre_effect(() => r(), () => {
    e.set(i, r().selectedIndex);
  }), e.legacy_pre_effect(() => r(), () => {
    e.set(c, r().selectedItem);
  }), e.legacy_pre_effect(() => r(), () => {
    e.set(u, r().extensionManager);
  }), e.legacy_pre_effect(() => (e.get(i), e.get(a), e.get(d)), () => {
    e.get(i) !== void 0 && !e.get(a) && !e.get(d) && m();
  }), e.legacy_pre_effect_reset(), e.init(), Ir(s, {
    leftWidth: 320,
    minLeftWidth: 250,
    maxLeftWidth: 500,
    left: ($) => {
      var C = Fr(), y = e.child(C);
      {
        var M = (k) => {
          var L = $r();
          e.append(k, L);
        }, U = (k) => {
          var L = kr(), v = e.child(L, !0);
          e.reset(L), e.template_effect(() => e.set_text(v, e.get(d))), e.append(k, L);
        }, D = (k) => {
          var L = Cr();
          e.append(k, L);
        }, T = (k) => {
          var L = e.comment(), v = e.first_child(L);
          e.each(v, 3, () => e.get(l), (p) => p.id, (p, w, E) => {
            var B = Br(), R = e.child(B), le = e.child(R);
            {
              var he = (H) => {
                var ne = Dr();
                e.template_effect(() => {
                  e.set_attribute(ne, "src", (e.get(w), e.untrack(() => e.get(w).icon_url))), e.set_attribute(ne, "alt", (e.get(w), e.untrack(() => e.get(w).name)));
                }), e.append(H, ne);
              }, ie = (H) => {
                var ne = Mr();
                e.append(H, ne);
              };
              e.if(le, (H) => {
                e.get(w), e.untrack(() => e.get(w).icon_url) ? H(he) : H(ie, -1);
              });
            }
            e.reset(R);
            var ce = e.sibling(R, 2), X = e.child(ce), ee = e.child(X), ve = e.child(ee, !0);
            e.reset(ee), e.reset(X);
            var te = e.sibling(X, 2), fe = e.child(te);
            e.reset(te), e.reset(ce);
            var ae = e.sibling(ce, 2), re = e.child(ae), me = e.child(re, !0);
            e.reset(re), e.reset(ae), e.reset(B), e.template_effect(() => {
              e.set_attribute(B, "data-index", e.get(E)), e.set_class(B, 1, `group flex items-center px-3 py-2.5 mx-2 my-0.5 rounded-lg cursor-default transition-colors ${e.get(i) === e.get(E) ? "bg-blue-500 text-white shadow-sm" : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200"}`), e.set_attribute(B, "aria-selected", e.get(i) === e.get(E)), e.set_class(ee, 1, `truncate text-[13px] font-medium leading-none ${e.get(i) === e.get(E) ? "text-white" : "text-gray-900 dark:text-gray-100"}`), e.set_text(ve, (e.get(w), e.untrack(() => e.get(w).name))), e.set_class(te, 1, `truncate text-[11px] leading-none ${e.get(i) === e.get(E) ? "text-blue-100" : "text-gray-500 dark:text-gray-400"}`), e.set_text(fe, `By ${e.get(w), e.untrack(() => e.get(w).author.name) ?? ""}`), e.set_class(re, 1, `text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${e.get(i) === e.get(E) ? "bg-white/20 text-white" : "bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400"}`), e.set_text(me, (e.get(w), e.untrack(() => e.get(w).category)));
            }), e.event("click", B, () => _(e.get(E))), e.event("dblclick", B, () => S(e.get(w).slug)), e.append(p, B);
          }), e.append(k, L);
        };
        e.if(y, (k) => {
          e.get(a) ? k(M) : e.get(d) ? k(U, 1) : (e.get(l), e.untrack(() => e.get(l).length === 0) ? k(D, 2) : k(T, -1));
        });
      }
      e.reset(C), e.bind_this(C, (k) => e.set(h, k), () => e.get(h)), e.append($, C);
    },
    right: ($) => {
      var C = Or(), y = e.child(C);
      {
        var M = (D) => {
          var T = Vr(), k = e.first_child(T), L = e.child(k), v = e.child(L);
          {
            var p = (z) => {
              var Y = Lr();
              e.template_effect(() => {
                e.set_attribute(Y, "src", (e.get(c), e.untrack(() => e.get(c).icon_url))), e.set_attribute(Y, "alt", (e.get(c), e.untrack(() => e.get(c).name)));
              }), e.append(z, Y);
            }, w = (z) => {
              var Y = Nr();
              e.append(z, Y);
            };
            e.if(v, (z) => {
              e.get(c), e.untrack(() => e.get(c).icon_url) ? z(p) : z(w, -1);
            });
          }
          e.reset(L);
          var E = e.sibling(L, 2), B = e.child(E, !0);
          e.reset(E);
          var R = e.sibling(E, 2), le = e.child(R), he = e.sibling(e.child(le));
          e.reset(le);
          var ie = e.sibling(le, 4), ce = e.sibling(e.child(ie));
          e.reset(ie), e.reset(R);
          var X = e.sibling(R, 2), ee = e.child(X, !0);
          e.reset(X);
          var ve = e.sibling(X, 2);
          {
            var te = (z) => {
              var Y = Rr(), $e = e.child(Y);
              e.reset(Y), e.template_effect(() => e.set_attribute($e, "src", (e.get(c), e.untrack(() => e.get(c).screenshot_urls[0])))), e.append(z, Y);
            };
            e.if(ve, (z) => {
              e.get(c), e.untrack(() => e.get(c).screenshot_urls && e.get(c).screenshot_urls.length > 0) && z(te);
            });
          }
          e.reset(k);
          var fe = e.sibling(k, 2), ae = e.child(fe), re = e.child(ae), me = e.child(re, !0);
          e.reset(re);
          var H = e.sibling(re, 2), ne = e.child(H);
          e.reset(H), e.reset(ae), e.next(2), e.reset(fe), e.template_effect(
            (z) => {
              e.set_text(B, (e.get(c), e.untrack(() => e.get(c).name))), e.set_text(he, ` ${e.get(c), e.untrack(() => e.get(c).author.name) ?? ""}`), e.set_text(ce, ` ${e.get(c), e.untrack(() => e.get(c).install_count) ?? ""} Installs`), e.set_text(ee, (e.get(c), e.untrack(() => e.get(c).description))), e.set_text(me, (e.get(c), e.untrack(() => e.get(c).status))), e.set_text(ne, `Added ${z ?? ""}`);
            },
            [
              () => (e.get(c), e.untrack(() => new Date(e.get(c).created_at).toLocaleDateString()))
            ]
          ), e.append(D, T);
        }, U = (D) => {
          var T = Tr();
          e.append(D, T);
        };
        e.if(y, (D) => {
          e.get(c) ? D(M) : D(U, -1);
        });
      }
      e.reset(C), e.append($, C);
    },
    $$slots: { left: !0, right: !0 }
  }), e.pop(), o();
}
var Ur = e.from_html('<div class="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500 font-medium text-sm">Loading details...</div>'), jr = e.from_html('<div class="p-6"><div class="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm border border-red-100 dark:border-red-900/30"> </div></div>'), Wr = e.from_html('<img class="w-full h-full object-cover"/>'), zr = e.from_html('<span class="text-4xl md:text-5xl">🧩</span>'), Pr = e.from_html('<span class="px-5 py-2.5 bg-green-50/80 dark:bg-green-900/10 text-green-600 dark:text-green-400 font-semibold text-[13px] rounded-lg shadow-sm flex items-center gap-2 border border-green-200/60 dark:border-green-800/50"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg> Installed</span> <button class="px-5 py-2.5 bg-white dark:bg-[#1e1e1e] hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 font-semibold text-[13px] rounded-lg border border-gray-200 dark:border-gray-800 hover:border-red-200 dark:hover:border-red-800/50 transition-colors focus:outline-none flex items-center gap-2 shadow-sm">Uninstall</button>', 1), Kr = e.from_html('<button class="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-semibold text-[13px] rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-[#1e1e1e] flex items-center gap-2">Install Extension</button>'), Hr = e.from_html('<a target="_blank" rel="noopener noreferrer" class="px-4 py-2.5 bg-gray-100 dark:bg-[#252525] hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold text-[13px] rounded-lg transition-colors focus:outline-none flex items-center gap-2 border border-black/5 dark:border-white/5"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd"></path></svg> GitHub</a>'), Gr = e.from_html('<div class="w-full max-w-5xl mx-auto px-6 py-8 md:px-12 md:py-12"><div class="flex flex-col md:flex-row items-start md:items-center gap-8 mb-12"><div class="flex-shrink-0 w-24 h-24 md:w-32 md:h-32 rounded-3xl bg-gray-50 dark:bg-gray-900/50 flex items-center justify-center overflow-hidden border border-gray-100 dark:border-gray-800 shadow-sm"><!></div> <div class="flex-1 min-w-0"><h1 class="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3 leading-tight tracking-tight"> </h1> <div class="flex flex-wrap items-center gap-3 text-[13px] text-gray-500 dark:text-gray-400 mb-6 font-medium"><span class="flex items-center gap-1.5 text-gray-700 dark:text-gray-200"><span class="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px]">👤</span> </span> <span class="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></span> <span> </span> <span class="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></span> <span class="flex items-center gap-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> </span></div> <div class="flex items-center gap-3"><!> <!></div></div></div> <hr class="border-gray-100 dark:border-gray-800 mb-10"/> <div class="grid grid-cols-1 lg:grid-cols-3 gap-12"><div class="lg:col-span-2 space-y-12"><section><h3 class="text-lg font-bold text-gray-900 dark:text-white mb-4">About</h3> <div class="prose dark:prose-invert max-w-none text-[15px] leading-relaxed text-gray-700 dark:text-gray-300"><p> </p></div></section></div> <div class="space-y-8"><section class="bg-gray-50/80 dark:bg-[#161616] rounded-2xl p-6 border border-gray-100 dark:border-gray-800"><h3 class="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-6">Details</h3> <dl class="space-y-4 text-[13px]"><div class="flex justify-between items-center pb-3 border-b border-gray-200 dark:border-gray-800/60"><dt class="text-gray-500 dark:text-gray-400 font-medium">Version</dt> <dd class="font-semibold text-gray-900 dark:text-white"> </dd></div> <div class="flex justify-between items-center pb-3 border-b border-gray-200 dark:border-gray-800/60"><dt class="text-gray-500 dark:text-gray-400 font-medium">Updated</dt> <dd class="font-semibold text-gray-900 dark:text-white"> </dd></div> <div class="flex justify-between items-center pb-3 border-b border-gray-200 dark:border-gray-800/60"><dt class="text-gray-500 dark:text-gray-400 font-medium">Status</dt> <dd class="font-semibold text-green-600 dark:text-green-400 flex items-center gap-1.5 align-middle"><span class="w-2 h-2 rounded-full bg-green-500"></span> </dd></div> <div class="flex justify-between items-center pb-1"><dt class="text-gray-500 dark:text-gray-400 font-medium">Added</dt> <dd class="font-semibold text-gray-900 dark:text-white"> </dd></div></dl></section></div></div></div>'), Qr = e.from_html('<div class="flex items-center justify-center h-64 text-gray-400">Extension details not found.</div>'), Xr = e.from_html('<div class="extension-detail-view bg-white dark:bg-[#1e1e1e] overflow-y-auto h-full w-full focus:outline-none custom-scrollbar svelte-1vc2sjg" tabindex="-1"><div class="sticky top-0 z-20 flex items-center px-6 py-4 bg-white/80 dark:bg-[#1e1e1e]/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800"><button class="group flex items-center text-[13px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors bg-gray-100/50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 px-3 py-1.5 rounded-md"><svg class="w-4 h-4 mr-1.5 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"></path></svg> Store</button></div> <!></div>');
function xn(s, t) {
  e.push(t, !1);
  const r = () => e.store_get(l, "$store", n), [n, o] = e.setup_stores(), a = e.mutable_source(), d = e.mutable_source(), l = P();
  let i = e.mutable_source(null), c = e.mutable_source(!0), u = e.mutable_source(!1), g = e.mutable_source(null);
  async function h(v) {
    if (!v) {
      e.set(u, !1), be.notifyInstalledStateChanged(!1, void 0);
      return;
    }
    try {
      const p = await W("list_installed_extensions");
      e.set(u, p.some((w) => w.endsWith(`/${v}`) || w.endsWith(`\\${v}`) || w === v)), be.notifyInstalledStateChanged(e.get(u), v);
    } catch (p) {
      f == null || f.error(`Failed to check installed status: ${p}`), e.set(u, !1), be.notifyInstalledStateChanged(!1, void 0);
    }
  }
  function m(v) {
    var p, w, E, B, R;
    (((p = v.detail) == null ? void 0 : p.id) === ((w = e.get(i)) == null ? void 0 : w.id) && ((E = e.get(i)) != null && E.id) || ((B = v.detail) == null ? void 0 : B.slug) === e.get(a) && ((R = e.get(i)) != null && R.id)) && h(e.get(i).id);
  }
  function _(v) {
    var p, w, E, B, R;
    (((p = v.detail) == null ? void 0 : p.id) === ((w = e.get(i)) == null ? void 0 : w.id) && ((E = e.get(i)) != null && E.id) || ((B = v.detail) == null ? void 0 : B.slug) === e.get(a) && ((R = e.get(i)) != null && R.id)) && h(e.get(i).id);
  }
  lt(() => {
    window.addEventListener("store-extension-installed", m), window.addEventListener("store-extension-uninstalled", _);
  }), $t(() => {
    window.removeEventListener("store-extension-installed", m), window.removeEventListener("store-extension-uninstalled", _);
  });
  async function S(v) {
    var p;
    f.debug(`[DetailView] fetchExtensionDetails START for slug: ${v}`), e.set(c, !0), e.set(g, null), e.set(i, null), f == null || f.info(`Fetching details for slug: ${v}`);
    try {
      const w = await fetch(`${J.storeApiBaseUrl}/api/extensions/${v}`);
      if (!w.ok)
        throw new Error(`HTTP error! status: ${w.status}`);
      const E = await w.json();
      e.set(
        i,
        E.data || E
        // Handle both wrapped and direct JSON objects
      ), f.debug(`[DetailView] Successfully fetched and parsed data: ${JSON.stringify(e.get(
        i
        // Log success and data
      ))}`), f == null || f.info(`Fetched details for ${(p = e.get(i)) == null ? void 0 : p.name}`);
    } catch (w) {
      f.error(`[DetailView] Fetch error: ${w}`), f == null || f.error(`Failed to fetch extension details: ${w.message}`), e.set(g, `Failed to load details: ${w.message}`);
    } finally {
      e.set(c, !1), f.debug("[DetailView] fetchExtensionDetails FINALLY. isLoading set to false.");
    }
  }
  async function x() {
    var v;
    if (!(!e.get(i) || !e.get(a))) {
      e.set(g, null);
      try {
        await be.installExtension(e.get(a), e.get(i).id, e.get(i).name), (v = e.get(i)) != null && v.id && await h(e.get(i).id);
      } catch (p) {
        const w = typeof p == "string" ? p : (p == null ? void 0 : p.message) || String(p);
        e.set(g, `Installation failed: ${w}`);
      }
    }
  }
  function I() {
    var v;
    f == null || f.info("Navigating back using viewManager.goBack()"), (v = e.get(
      d
      // Use the new goBack method
    )) == null || v.goBack();
  }
  async function $() {
    var v;
    if (!(!e.get(i) || !e.get(a))) {
      e.set(g, null);
      try {
        await be.uninstallExtension(e.get(a), e.get(i).id, e.get(i).name), (v = e.get(i)) != null && v.id && await h(e.get(i).id);
      } catch (p) {
        const w = typeof p == "string" ? p : (p == null ? void 0 : p.message) || String(p);
        e.set(g, `Uninstall failed: ${w}`);
      }
    }
  }
  e.legacy_pre_effect(() => r(), () => {
    e.set(a, r().selectedExtensionSlug);
  }), e.legacy_pre_effect(() => r(), () => {
    e.set(d, r().extensionManager);
  }), e.legacy_pre_effect(() => e.get(a), () => {
    e.get(a) ? S(e.get(a)) : (e.set(i, null), e.set(g, "No extension selected."), e.set(c, !1));
  }), e.legacy_pre_effect(() => e.get(i), () => {
    var v;
    (v = e.get(i)) != null && v.id && h(e.get(i).id);
  }), e.legacy_pre_effect_reset(), e.init();
  var C = Xr(), y = e.child(C), M = e.child(y);
  e.reset(y);
  var U = e.sibling(y, 2);
  {
    var D = (v) => {
      var p = Ur();
      e.append(v, p);
    }, T = (v) => {
      var p = jr(), w = e.child(p), E = e.child(w, !0);
      e.reset(w), e.reset(p), e.template_effect(() => e.set_text(E, e.get(g))), e.append(v, p);
    }, k = (v) => {
      var p = Gr(), w = e.child(p), E = e.child(w), B = e.child(E);
      {
        var R = (N) => {
          var O = Wr();
          e.template_effect(() => {
            e.set_attribute(O, "src", (e.get(i), e.untrack(() => e.get(i).iconUrl))), e.set_attribute(O, "alt", `${e.get(i), e.untrack(() => e.get(i).name) ?? ""} icon`);
          }), e.append(N, O);
        }, le = (N) => {
          var O = zr();
          e.append(N, O);
        };
        e.if(B, (N) => {
          e.get(i), e.untrack(() => e.get(i).iconUrl) ? N(R) : N(le, -1);
        });
      }
      e.reset(E);
      var he = e.sibling(E, 2), ie = e.child(he), ce = e.child(ie, !0);
      e.reset(ie);
      var X = e.sibling(ie, 2), ee = e.child(X), ve = e.sibling(e.child(ee));
      e.reset(ee);
      var te = e.sibling(ee, 4), fe = e.child(te, !0);
      e.reset(te);
      var ae = e.sibling(te, 4), re = e.sibling(e.child(ae));
      e.reset(ae), e.reset(X);
      var me = e.sibling(X, 2), H = e.child(me);
      {
        var ne = (N) => {
          var O = Pr(), At = e.sibling(e.first_child(O), 2);
          e.event("click", At, $), e.append(N, O);
        }, z = (N) => {
          var O = Kr();
          e.event("click", O, x), e.append(N, O);
        };
        e.if(H, (N) => {
          e.get(u) ? N(ne) : N(z, -1);
        });
      }
      var Y = e.sibling(H, 2);
      {
        var $e = (N) => {
          var O = Hr();
          e.template_effect(() => e.set_attribute(O, "href", (e.get(i), e.untrack(() => e.get(i).repoUrl)))), e.append(N, O);
        };
        e.if(Y, (N) => {
          e.get(i), e.untrack(() => e.get(i).repoUrl) && N($e);
        });
      }
      e.reset(me), e.reset(he), e.reset(w);
      var Pe = e.sibling(w, 4), ke = e.child(Pe), Ke = e.child(ke), He = e.sibling(e.child(Ke), 2), Ge = e.child(He), vt = e.child(Ge, !0);
      e.reset(Ge), e.reset(He), e.reset(Ke), e.reset(ke);
      var Qe = e.sibling(ke, 2), Xe = e.child(Qe), Ye = e.sibling(e.child(Xe), 2), Ce = e.child(Ye), Je = e.sibling(e.child(Ce), 2), bt = e.child(Je, !0);
      e.reset(Je), e.reset(Ce);
      var De = e.sibling(Ce, 2), Ze = e.sibling(e.child(De), 2), wt = e.child(Ze, !0);
      e.reset(Ze), e.reset(De);
      var Me = e.sibling(De, 2), qe = e.sibling(e.child(Me), 2), yt = e.sibling(e.child(qe));
      e.reset(qe), e.reset(Me);
      var et = e.sibling(Me, 2), tt = e.sibling(e.child(et), 2), _t = e.child(tt, !0);
      e.reset(tt), e.reset(et), e.reset(Ye), e.reset(Xe), e.reset(Qe), e.reset(Pe), e.reset(p), e.template_effect(
        (N, O) => {
          e.set_text(ce, (e.get(i), e.untrack(() => e.get(i).name))), e.set_text(ve, ` ${e.get(i), e.untrack(() => e.get(i).author.name) ?? ""}`), e.set_text(fe, (e.get(i), e.untrack(() => e.get(i).category))), e.set_text(re, ` ${e.get(i), e.untrack(() => e.get(i).installCount) ?? ""} Installs`), e.set_text(vt, (e.get(i), e.untrack(() => e.get(i).description))), e.set_text(bt, (e.get(i), e.untrack(() => e.get(i).version || "1.0.0"))), e.set_text(wt, N), e.set_text(yt, ` ${e.get(i), e.untrack(() => e.get(i).status) ?? ""}`), e.set_text(_t, O);
        },
        [
          () => (e.get(i), e.untrack(() => new Date(e.get(i).updatedAt).toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" }))),
          () => (e.get(i), e.untrack(() => new Date(e.get(i).createdAt).toLocaleDateString(void 0, { year: "numeric", month: "short", day: "numeric" })))
        ]
      ), e.append(v, p);
    }, L = (v) => {
      var p = Qr();
      e.append(v, p);
    };
    e.if(U, (v) => {
      e.get(c) ? v(D) : e.get(g) ? v(T, 1) : e.get(i) ? v(k, 2) : v(L, -1);
    });
  }
  e.reset(C), e.event("click", M, I), e.append(s, C), e.pop(), o();
}
async function Yr(s) {
  return W("search_items", { query: s });
}
async function Jr(s) {
  return W("index_item", { item: s });
}
async function Zr(s) {
  return W("batch_index_items", { items: s });
}
async function qr(s) {
  return W("delete_item", { objectId: s });
}
async function en() {
  return W("get_indexed_object_ids").then((s) => new Set(s));
}
async function tn() {
  return W("reset_search_index");
}
async function rn() {
  return W("save_search_index");
}
class nn {
  async performSearch(t) {
    if (J.isBrowser)
      return f.debug(`Browser mode: providing fallback search for "${t}"`), this.getBrowserFallbacks(t);
    try {
      const r = await Yr(t);
      return f.debug(`Search results for "${t}": ${r}`), r;
    } catch (r) {
      return f.error(`Search failed: ${r}`), [];
    }
  }
  getBrowserFallbacks(t) {
    const r = [
      {
        objectId: "ext_store",
        name: "Extension Store",
        description: "Browse and install extensions",
        type: "command",
        score: 1,
        category: "extension"
      },
      {
        objectId: "ext_clipboard",
        name: "Clipboard History",
        description: "View and manage clipboard history",
        type: "command",
        score: 0.9,
        category: "extension"
      }
    ];
    if (!t) return r;
    const n = t.toLowerCase();
    return r.filter(
      (o) => {
        var a;
        return o.name.toLowerCase().includes(n) || ((a = o.description) == null ? void 0 : a.toLowerCase().includes(n));
      }
    );
  }
  /**
   * Indexes a single item (Application or Command) by calling the Rust backend.
   * Handles updates automatically (Rust's index_item deletes then adds).
   */
  async indexItem(t) {
    if (J.isBrowser) {
      f.debug(`Browser mode: skipping indexing for ${t.name}`);
      return;
    }
    try {
      f.debug(
        `Indexing item category: ${t.category}, name: ${t.name}`
      ), await Jr(t);
    } catch (r) {
      f.error(`Failed indexing item ${t.name}: ${r}`);
    }
  }
  /**
   * Indexes multiple items in a single Rust call with one disk write.
   * Use this for bulk operations (startup app scan, command sync) instead
   * of calling indexItem() in a loop.
   */
  async batchIndexItems(t) {
    if (!(J.isBrowser || t.length === 0))
      try {
        f.debug(`Batch indexing ${t.length} items`), await Zr(t);
      } catch (r) {
        f.error(`Failed batch indexing ${t.length} items: ${r}`);
      }
  }
  /**
   * Deletes an item from the index by its object ID.
   */
  async deleteItem(t) {
    if (!J.isBrowser)
      try {
        f.debug(`Deleting item with objectId: ${t}`), await qr(t);
      } catch (r) {
        f.error(`Failed deleting item ${t}: ${r}`);
      }
  }
  /**
   * Gets all indexed object IDs, optionally filtering by prefix.
   */
  async getIndexedObjectIds(t) {
    if (J.isBrowser) return /* @__PURE__ */ new Set();
    try {
      f.debug(
        `Fetching indexed object IDs ${t ? `with prefix "${t}"` : ""}...`
      );
      const r = await en();
      if (!t)
        return r;
      const n = /* @__PURE__ */ new Set();
      return r.forEach((o) => {
        o.startsWith(t) && n.add(o);
      }), f.debug(
        `Found ${n.size} IDs with prefix "${t}".`
      ), n;
    } catch (r) {
      return f.error(`Failed to get indexed object IDs: ${r}`), /* @__PURE__ */ new Set();
    }
  }
  // Optional: Add a method to reset the index
  async resetIndex() {
    if (!J.isBrowser)
      try {
        f.info("Requesting search index reset..."), await tn(), f.info("Search index reset successful.");
      } catch (t) {
        f.error(`Failed to reset search index: ${t}`);
      }
  }
  /**
   * Explicitly saves the search index to disk.
   * Currently used before hiding the launcher to persist usage counts.
   */
  async saveIndex() {
    if (!J.isBrowser)
      try {
        await rn();
      } catch (t) {
        f.error(`Failed to save search index: ${t}`);
      }
  }
}
const sn = new nn(), Fe = je(
  /* @__PURE__ */ new Map()
);
class an {
  // Store the reference
  constructor() {
    F(this, "commands", /* @__PURE__ */ new Map());
    F(this, "extensionManager", null);
    Fe.set(this.commands);
  }
  /**
   * Initialize the service with necessary dependencies.
   * Should be called once during application startup.
   * @param manager - The ExtensionManager instance.
   */
  initialize(t) {
    if (this.extensionManager) {
      f.warn("CommandService already initialized.");
      return;
    }
    this.extensionManager = t, f.debug(
      "CommandService initialized and connected to ExtensionManager."
    );
  }
  /**
   * Register a command with a handler function
   */
  registerCommand(t, r, n) {
    this.commands.set(t, {
      handler: r,
      extensionId: n
    }), f.debug(
      `Registered command: ${t} from extension: ${n}`
    ), Fe.set(this.commands);
  }
  /**
   * Unregister a command
   */
  unregisterCommand(t) {
    this.commands.delete(t) ? (Fe.set(this.commands), f.debug(`Unregistered command: ${t}`)) : f.warn(
      `Attempted to unregister non-existent command: ${t}`
    );
  }
  /**
   * Execute a registered command
   */
  async executeCommand(t, r) {
    f.debug(`[CommandService] executeCommand called with ID: ${t}`);
    const n = this.commands.get(t);
    if (!n)
      throw new Error(`Command not found: ${t}`);
    f.info(
      `EXTENSION_TRACKED: Executing command: ${t} from extension: ${n.extensionId} with args: ${JSON.stringify(r || {})}`
    );
    try {
      return f.debug(`[CommandService] Found handler for ${t}. Executing...`), await n.handler.execute(r);
    } catch (o) {
      throw f.error(`Error executing command ${t}: ${o}`), o;
    }
  }
  /**
   * Get all registered command IDs
   */
  getCommands() {
    return Array.from(this.commands.keys());
  }
  /**
   * Get all commands registered by a specific extension
   */
  getCommandsForExtension(t) {
    return Array.from(this.commands.entries()).filter(([r, n]) => n.extensionId === t).map(([r, n]) => r);
  }
  /**
   * Clear all commands for an extension
   */
  clearCommandsForExtension(t) {
    const r = this.getCommandsForExtension(t);
    for (const n of r)
      this.unregisterCommand(n);
  }
}
new an();
const on = je([]), ge = class ge {
  constructor() {
    F(this, "allActions", /* @__PURE__ */ new Map());
    F(this, "currentContext", G.CORE);
    F(this, "sendToExtension");
    this.registerBuiltInActions();
  }
  setExtensionForwarder(t) {
    this.sendToExtension = t;
  }
  static getInstance() {
    return ge.instance || (ge.instance = new ge()), ge.instance;
  }
  /**
   * Set the current action context and optional data (e.g., commandId)
   */
  setContext(t) {
    this.currentContext !== t && (this.currentContext = t, f.debug(`Action context set to: ${t}`), this.updateStore());
  }
  /**
   * Get the current action context
   */
  getContext() {
    return this.currentContext;
  }
  /**
   * Register an action from an extension or core
   */
  registerAction(t) {
    const r = {
      id: t.id,
      label: "title" in t ? t.title : t.label,
      // Handle both interfaces
      icon: t.icon,
      description: t.description,
      extensionId: "extensionId" in t ? t.extensionId : void 0,
      category: t.category,
      // Use the context provided, default if necessary, ensure it's the enum type
      context: t.context || G.EXTENSION_VIEW,
      execute: t.execute,
      disabled: "disabled" in t ? t.disabled : void 0
    };
    this.allActions.set(r.id, r), f.debug(
      `Registered action: ${r.id} from ${r.extensionId || "core"}, context: ${r.context || "default"}`
    ), this.updateStore();
  }
  /**
   * Unregister an action
   */
  unregisterAction(t) {
    this.allActions.delete(t) ? (f.debug(`Unregistered action: ${t}`), this.updateStore()) : f.warn(
      `Attempted to unregister non-existent action: ${t}`
    );
  }
  /**
   * Remove all actions registered by a specific extension.
   * Call this when an extension view is closed to prevent stale actions from persisting.
   */
  clearActionsForExtension(t) {
    let r = !1;
    for (const [n, o] of this.allActions)
      o.extensionId === t && (this.allActions.delete(n), r = !0);
    r && (f.debug(`[ActionService] Cleared all actions for extension: ${t}`), this.updateStore());
  }
  /**
   * Get all registered actions (primarily for internal use or debugging)
   * Note: This returns ALL actions, not filtered by context. Use the actionStore for UI.
   */
  getAllActions() {
    return Array.from(this.allActions.values());
  }
  /**
   * Get actions filtered by the current context (used by updateStore)
   */
  getFilteredActions() {
    const t = Array.from(this.allActions.values()).filter(
      this.filterActionsByContext.bind(this)
    );
    return f.debug(
      `Filtering actions for context: ${this.currentContext}. Found ${t.length} actions.`
    ), t;
  }
  /**
   * Get actions based on a specific context (implements IActionService method)
   * Note: This might not be ideal if commandId is needed for COMMAND_RESULT.
   * Consider if this method is still necessary or if actionStore is sufficient.
   */
  getActions(t) {
    const r = t || this.currentContext;
    return r === G.COMMAND_RESULT && f.warn(
      "getActions(COMMAND_RESULT) called directly; may not return correct results. Prefer using the actionStore after setting context with commandId."
    ), Array.from(this.allActions.values()).filter((n) => n.context === r).map((n) => ({
      // Map back to ExtensionAction interface
      id: n.id,
      title: n.label,
      description: n.description,
      icon: n.icon,
      // Ensure extensionId is a string, default to 'core' if undefined
      extensionId: n.extensionId || "core",
      category: n.category,
      context: n.context,
      // Pass context through
      execute: n.execute
    }));
  }
  /**
   * Filter actions based on the current internal context
   */
  filterActionsByContext(t) {
    return t.context === this.currentContext || t.context === G.GLOBAL && (this.currentContext === G.CORE || this.currentContext === G.EXTENSION_VIEW) ? !0 : this.currentContext === G.CORE && t.context === G.CORE ? Array.from(this.allActions.values()).filter(
      (o) => o.context === this.currentContext && o.context !== G.CORE && o.context !== G.GLOBAL
    ).length === 0 : !1;
  }
  /**
   * Execute an action by ID
   */
  async executeAction(t) {
    const r = this.allActions.get(t);
    if (!r)
      throw new Error(`Action not found: ${t}`);
    f.info(
      `Executing action: ${t} from ${r.extensionId || "core"}`
    );
    try {
      if (typeof r.execute == "function")
        await r.execute();
      else if (r.extensionId && this.sendToExtension)
        this.sendToExtension(r.extensionId, t);
      else
        throw new Error(`Action execute is not a function: ${t}`);
    } catch (n) {
      throw f.error(`Error executing action ${t}: ${n}`), n;
    }
  }
  /**
   * Register built-in application actions
   */
  registerBuiltInActions() {
    this.registerAction({
      // Use registerAction for consistency
      id: "settings",
      label: "Settings",
      icon: "⚙️",
      description: "Configure application settings",
      category: "System",
      context: G.CORE,
      execute: async () => {
        f.info("Executing built-in action: Open Settings");
        try {
          await W("plugin:window|show", { label: "settings" });
        } catch (t) {
          f.error(`Failed to open settings window: ${t}`);
        }
      }
    }), this.registerAction({
      // Use registerAction for consistency
      id: "reset_search",
      label: "Reset Search Index",
      icon: "🔄",
      description: "Reset the search index",
      category: "System",
      context: G.CORE,
      execute: async () => {
        f.info("Executing built-in action: Reset Search Index"), await sn.resetIndex();
      }
    });
  }
  /**
   * Update the action store with currently relevant actions based on context
   */
  updateStore() {
    const t = this.getFilteredActions();
    on.set(t);
  }
};
F(ge, "instance");
let Ue = ge;
const Q = Ue.getInstance(), j = "store", _e = "app.asyar.store:install-detail", Ae = "app.asyar.store:uninstall-detail", xe = "app.asyar.store:install-selected", Ee = "app.asyar.store:uninstall-selected";
class ln {
  constructor() {
    F(this, "extensionManager");
    F(this, "logService");
    F(this, "notificationService");
    F(this, "listViewActionSubscription", null);
    // To hold the unsubscribe function
    F(this, "inView", !1);
    F(this, "currentView", null);
    F(this, "currentDetailIsInstalled", null);
    // null = check in progress
    F(this, "currentDetailExtensionId");
    F(this, "handleKeydownBound", (t) => this.handleKeydown(t));
  }
  notifyInstalledStateChanged(t, r) {
    this.currentDetailIsInstalled = t, this.currentDetailExtensionId = r, this.currentView === `${j}/DetailView` && (this.unregisterDetailViewActions(), this.registerDetailViewActions());
  }
  async initialize(t) {
    var r;
    this.logService = t.getService("LogService"), this.extensionManager = t.getService("ExtensionManager"), this.notificationService = t.getService(
      "NotificationService"
    ), P(), this.logService && (V == null || V.setLogService(this.logService)), this.extensionManager && (V == null || V.setExtensionManager(this.extensionManager)), (r = this.logService) == null || r.info(
      "Store extension initialized and state store initialized on demand."
    );
  }
  // --- Public Helper for Installation ---
  async installExtension(t, r, n) {
    var d, l, i, c, u, g, h, m, _, S, x, I, $, C;
    if (!t) {
      (d = this.logService) == null || d.error("Install function called without a slug."), (l = this.notificationService) == null || l.notify({
        title: "Install Failed",
        body: "Could not determine which extension to install."
      });
      return;
    }
    const o = n || t, a = P();
    a == null || a.setInstallingSlug(t), (i = this.logService) == null || i.info(`Install action triggered for slug: ${t}`);
    try {
      (c = this.extensionManager) == null || c.setActiveViewStatusMessage("⏳ Installing...");
      const y = await fetch(
        `${J.storeApiBaseUrl}/api/extensions/${t}/install`
      );
      if (!y.ok)
        throw new Error(
          `Failed to get install info: ${y.status} ${await y.text()}`
        );
      const M = await y.json();
      if ((u = this.logService) == null || u.info(
        `Install info received: Version ${M.version}, URL: ${M.downloadUrl}`
      ), !M.downloadUrl)
        throw new Error("Extension download URL is not available. Please try again.");
      (g = this.logService) == null || g.info(
        `Invoking Tauri command 'install_extension_from_url' for ${o}`
      ), await W("install_extension_from_url", {
        downloadUrl: M.downloadUrl,
        extensionId: r.toString(),
        extensionName: o,
        // Use the determined name
        version: M.version,
        checksum: M.checksum
      }), (h = this.logService) == null || h.info(
        `Installation command invoked successfully for ${o}. App might reload extensions.`
      ), (m = this.notificationService) == null || m.notify({
        title: "Installation Started",
        body: `Installation for ${o} initiated. App may reload.`
      });
      try {
        await ((_ = this.extensionManager) == null ? void 0 : _.reloadExtensions());
      } catch (D) {
        (S = this.logService) == null || S.error(`Failed to reload extensions after install: ${D}`);
      }
      const U = P();
      U == null || U.updateItemStatus(t, "INSTALLED"), window.dispatchEvent(new CustomEvent("store-extension-installed", { detail: { slug: t, id: M.extensionId } }));
    } catch (y) {
      const M = typeof y == "string" ? y : (y == null ? void 0 : y.message) || String(y);
      throw (x = this.logService) == null || x.error(
        `Installation failed for ${o}: ${M}`
      ), (I = this.notificationService) == null || I.notify({
        title: "Installation Failed",
        body: `Could not install ${o}. ${M}`
      }), y;
    } finally {
      if (a == null || a.setInstallingSlug(null), this.currentView === `${j}/DetailView`)
        this.unregisterDetailViewActions(), this.registerDetailViewActions();
      else if (this.currentView === `${j}/DefaultView`) {
        const y = a ? de(a).selectedItem : null;
        ($ = this.extensionManager) == null || $.setActiveViewActionLabel(y ? "Show Details" : null);
      }
      (C = this.extensionManager) == null || C.setActiveViewStatusMessage(null);
    }
  }
  async uninstallExtension(t, r, n) {
    var d, l, i, c, u, g, h, m, _, S;
    if (!t || !r) return;
    const o = n || t, a = P();
    a == null || a.setUninstallingSlug(t), (d = this.logService) == null || d.info(`Uninstall action triggered for slug: ${t}, id: ${r}`);
    try {
      (l = this.extensionManager) == null || l.setActiveViewStatusMessage("⏳ Uninstalling..."), await W("uninstall_extension", { extensionId: r.toString() }), (i = this.logService) == null || i.info(`Uninstall command invoked successfully for ${o}.`), (c = this.notificationService) == null || c.notify({
        title: "Uninstall Complete",
        body: `${o} has been removed.`
      });
      try {
        await ((u = this.extensionManager) == null ? void 0 : u.reloadExtensions());
      } catch (I) {
        (g = this.logService) == null || g.error(`Failed to reload extensions after uninstalling ${t}: ${I}`);
      }
      const x = P();
      x == null || x.updateItemStatus(t, "NOT_INSTALLED"), window.dispatchEvent(new CustomEvent("store-extension-uninstalled", { detail: { slug: t, id: r } }));
    } catch (x) {
      const I = typeof x == "string" ? x : (x == null ? void 0 : x.message) || String(x);
      throw (h = this.logService) == null || h.error(`Uninstall failed for ${o}: ${I}`), (m = this.notificationService) == null || m.notify({
        title: "Uninstall Failed",
        body: `Could not uninstall ${o}. ${I}`
      }), x;
    } finally {
      if (a == null || a.setUninstallingSlug(null), this.currentView === `${j}/DetailView`)
        this.unregisterDetailViewActions(), this.registerDetailViewActions();
      else if (this.currentView === `${j}/DefaultView`) {
        const x = a ? de(a).selectedItem : null;
        (_ = this.extensionManager) == null || _.setActiveViewActionLabel(x ? "Show Details" : null);
      }
      (S = this.extensionManager) == null || S.setActiveViewStatusMessage(null);
    }
  }
  // --- End Private Helper ---
  async executeCommand(t, r) {
    var o, a, d, l;
    if ((o = this.logService) == null || o.info(`Store executing command: ${t}`), t === "browse")
      return (a = this.logService) == null || a.debug("[Store Extension] Browse command handler executed."), this.extensionManager ? (this.extensionManager.navigateToView(`${j}/DefaultView`), { success: !0 }) : ((d = this.logService) == null || d.error("ExtensionManager service not available."), { success: !1, error: "ExtensionManager not available" });
    throw (l = this.logService) == null || l.warn(`Received unknown command ID for store: ${t}`), new Error(`Unknown command for store: ${t}`);
  }
  // Helper method to fetch extensions
  async fetchExtensions() {
    var t, r, n, o, a;
    if (V) {
      (t = this.logService) == null || t.debug("[Store Extension] fetchExtensions: Starting fetch..."), V.setLoading(!0);
      try {
        const d = await fetch(`${J.storeApiBaseUrl}/api/extensions`);
        if (!d.ok)
          throw new Error(`HTTP error! status: ${d.status}`);
        const l = await d.json(), i = Array.isArray(l) ? l : l.data || [];
        try {
          const c = await W("list_installed_extensions");
          for (const u of i) {
            const g = String(u.id);
            c.some(
              (m) => m.endsWith(`/${g}`) || m.endsWith(`\\${g}`) || m === g
            ) ? ((r = this.logService) == null || r.debug(`Matched ${u.name} (id ${u.id}) as INSTALLED`), u.status = "INSTALLED") : u.status = "NOT_INSTALLED";
          }
        } catch (c) {
          (n = this.logService) == null || n.warn(`Failed to map local installation status: ${c}`);
        }
        (o = this.logService) == null || o.info(`Fetched ${i.length} extensions.`), V.setItems(i);
      } catch (d) {
        (a = this.logService) == null || a.error(`Failed to fetch extensions: ${d.message}`), V.setError(`Failed to load extensions: ${d.message}`);
      }
    }
  }
  handleKeydown(t) {
    if (!this.inView || !V) return;
    if (this.currentView === `${j}/DetailView`) {
      if (t.key === "Enter") {
        if (this.currentDetailIsInstalled === null) return;
        t.preventDefault(), t.stopPropagation(), this.currentDetailIsInstalled ? Q.executeAction(Ae) : Q.executeAction(_e);
      }
      return;
    }
    const r = de(V);
    if (r.filteredItems.length) {
      if (t.key === "ArrowUp" || t.key === "ArrowDown")
        t.preventDefault(), t.stopPropagation(), V.moveSelection(t.key === "ArrowUp" ? "up" : "down");
      else if (t.key === "Enter" && r.selectedIndex !== -1) {
        t.preventDefault(), t.stopPropagation();
        const n = r.filteredItems[r.selectedIndex];
        n && this.viewExtensionDetail(n.slug);
      }
    }
  }
  viewExtensionDetail(t) {
    V && (V.setSelectedExtensionSlug(t), this.extensionManager && this.extensionManager.navigateToView("store/DetailView"));
  }
  // Optional lifecycle methods
  async activate() {
    var t;
    (t = this.logService) == null || t.info("Store extension activated.");
  }
  async deactivate() {
    var t;
    (t = this.logService) == null || t.info("Store extension deactivated.");
  }
  // --- Action Registration ---
  // Action for Detail View
  registerDetailViewActions() {
    var t, r, n, o;
    if (this.currentDetailIsInstalled) {
      (t = this.logService) == null || t.debug(`Registering action: ${Ae}`);
      const a = {
        id: Ae,
        title: "Uninstall Extension",
        description: "Uninstall the currently viewed extension",
        icon: "🗑️",
        extensionId: j,
        execute: async () => {
          const d = P(), i = de(d).selectedExtensionSlug;
          if (i && this.currentDetailExtensionId)
            try {
              await this.uninstallExtension(i, this.currentDetailExtensionId, void 0);
            } catch {
            }
        }
      };
      Q.registerAction(a), (r = this.extensionManager) == null || r.setActiveViewActionLabel("Uninstall");
    } else {
      (n = this.logService) == null || n.debug(`Registering action: ${_e}`);
      const a = {
        id: _e,
        title: "Install Extension",
        description: "Install the currently viewed extension",
        icon: "💾",
        extensionId: j,
        execute: async () => {
          const d = P(), i = de(d).selectedExtensionSlug;
          if (i && this.currentDetailExtensionId)
            try {
              await this.installExtension(i, this.currentDetailExtensionId, void 0);
            } catch {
            }
        }
      };
      Q.registerAction(a), (o = this.extensionManager) == null || o.setActiveViewActionLabel("Install Extension");
    }
  }
  unregisterDetailViewActions() {
    var t;
    (t = this.logService) == null || t.debug("Unregistering detail actions"), Q.unregisterAction(_e), Q.unregisterAction(Ae);
  }
  // Action for List View Selection - Now manages subscription
  registerListViewActions() {
    var r, n;
    if (this.listViewActionSubscription) return;
    (r = this.logService) == null || r.debug(
      `Setting up subscription for dynamic list view action: ${xe}`
    );
    const t = P();
    if (!t) {
      (n = this.logService) == null || n.error("Cannot register list view actions: Store not initialized.");
      return;
    }
    this.listViewActionSubscription = t.subscribe((o) => {
      var d, l, i, c, u, g, h;
      Q.unregisterAction(xe), Q.unregisterAction(Ee), (d = this.extensionManager) == null || d.setActiveViewActionLabel(null);
      const a = o.selectedItem;
      if (a)
        if ((l = this.extensionManager) == null || l.setActiveViewActionLabel("Show Details"), (i = this.logService) == null || i.debug(
          `Set primary action label to "Show Details" via manager for ${a.name}`
        ), a.status === "INSTALLED") {
          const m = `Uninstall ${a.name} Extension`;
          (c = this.logService) == null || c.debug(
            `Registering/Updating action ${Ee} with title: "${m}"`
          );
          const _ = {
            id: Ee,
            title: m,
            description: `Uninstall the ${a.name} extension`,
            icon: "🗑️",
            extensionId: j,
            execute: async () => {
              var I, $;
              const S = P(), x = S ? de(S).selectedItem : null;
              if (x)
                try {
                  await this.uninstallExtension(
                    x.slug,
                    x.id,
                    x.name
                  );
                } catch {
                }
              else
                (I = this.logService) == null || I.warn(
                  "Uninstall selected action executed, but no item is selected in state anymore."
                ), ($ = this.notificationService) == null || $.notify({
                  title: "Uninstall Failed",
                  body: "No extension selected."
                });
            }
          };
          Q.registerAction(_);
        } else {
          const m = `Install ${a.name} Extension`;
          (u = this.logService) == null || u.debug(
            `Registering/Updating action ${xe} with title: "${m}"`
          );
          const _ = {
            id: xe,
            title: m,
            description: `Install the ${a.name} extension`,
            icon: "💾",
            extensionId: j,
            execute: async () => {
              var I, $;
              const S = P(), x = S ? de(S).selectedItem : null;
              if (x)
                try {
                  await this.installExtension(
                    x.slug,
                    x.id,
                    x.name
                  );
                } catch {
                }
              else
                (I = this.logService) == null || I.warn(
                  "Install selected action executed, but no item is selected in state anymore."
                ), ($ = this.notificationService) == null || $.notify({
                  title: "Install Failed",
                  body: "No extension selected."
                });
            }
          };
          Q.registerAction(_);
        }
      else
        (g = this.logService) == null || g.debug(
          `No item selected, action ${xe} remains unregistered and primary label cleared via manager.`
        ), (h = this.extensionManager) == null || h.setActiveViewActionLabel(null);
    });
  }
  unregisterListViewActions() {
    var t, r, n, o;
    this.listViewActionSubscription && ((t = this.logService) == null || t.debug("Unsubscribing from list view action updates."), this.listViewActionSubscription(), this.listViewActionSubscription = null), (r = this.logService) == null || r.debug(
      "Unregistering list view actions"
    ), Q.unregisterAction(xe), Q.unregisterAction(Ee), (n = this.extensionManager) == null || n.setActiveViewActionLabel(null), (o = this.logService) == null || o.debug(
      "Cleared primary action label via manager during list view action unregistration."
    );
  }
  // --- End Action Registration ---
  // Required methods from Extension interface
  async viewActivated(t) {
    var r, n;
    (r = this.logService) == null || r.debug(`Store view activated: ${t}`), this.inView = !0, this.currentView = t, window.addEventListener("keydown", this.handleKeydownBound), (n = this.extensionManager) == null || n.setActiveViewActionLabel(null), t === `${j}/DetailView` ? (this.unregisterListViewActions(), this.currentDetailIsInstalled = null, this.currentDetailExtensionId = void 0, this.registerDetailViewActions()) : t === `${j}/DefaultView` ? (this.unregisterDetailViewActions(), this.registerListViewActions(), await this.fetchExtensions()) : (this.unregisterDetailViewActions(), this.unregisterListViewActions());
  }
  async viewDeactivated(t) {
    var r, n, o;
    (r = this.logService) == null || r.debug(`Store view deactivated: ${t}`), this.inView = !1, this.currentView = null, window.removeEventListener("keydown", this.handleKeydownBound), t === `${j}/DetailView` ? (this.unregisterDetailViewActions(), (n = this.extensionManager) == null || n.setActiveViewActionLabel(null), (o = this.logService) == null || o.debug(
      "Cleared primary action label via manager as detail view deactivated."
    )) : t === `${j}/DefaultView` && this.unregisterListViewActions();
  }
  onUnload() {
    var t;
    this.unregisterDetailViewActions(), this.unregisterListViewActions(), (t = this.logService) == null || t.info("Store extension unloading.");
  }
  // Add onViewSearch method
  async onViewSearch(t) {
    var n;
    (n = this.logService) == null || n.debug(`Store view search received: "${t}"`);
    const r = P();
    r == null || r.setSearch(t);
  }
}
const be = new ln();
export {
  mn as DefaultView,
  xn as DetailView,
  be as default
};
