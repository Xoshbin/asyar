var wt = Object.defineProperty;
var pt = (r, e, t) => e in r ? wt(r, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : r[e] = t;
var $ = (r, e, t) => pt(r, typeof e != "symbol" ? e + "" : e, t);
import { writable as Be, get as Ze } from "svelte/store";
import "svelte/internal/disclose-version";
import "svelte/internal/flags/legacy";
import * as o from "svelte/internal/client";
import { onMount as yt, tick as bt } from "svelte";
import { ActionContext as T } from "asyar-api";
function q(r) {
  return Array.isArray ? Array.isArray(r) : rt(r) === "[object Array]";
}
function vt(r) {
  if (typeof r == "string")
    return r;
  let e = r + "";
  return e == "0" && 1 / r == -1 / 0 ? "-0" : e;
}
function xt(r) {
  return r == null ? "" : vt(r);
}
function z(r) {
  return typeof r == "string";
}
function et(r) {
  return typeof r == "number";
}
function At(r) {
  return r === !0 || r === !1 || Ct(r) && rt(r) == "[object Boolean]";
}
function tt(r) {
  return typeof r == "object";
}
function Ct(r) {
  return tt(r) && r !== null;
}
function P(r) {
  return r != null;
}
function _e(r) {
  return !r.trim().length;
}
function rt(r) {
  return r == null ? r === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(r);
}
const _t = "Incorrect 'index' type", Et = (r) => `Invalid value for key ${r}`, Mt = (r) => `Pattern length exceeds max of ${r}.`, St = (r) => `Missing ${r} property in key`, Dt = (r) => `Property 'weight' in key '${r}' must be a positive integer`, We = Object.prototype.hasOwnProperty;
class $t {
  constructor(e) {
    this._keys = [], this._keyMap = {};
    let t = 0;
    e.forEach((n) => {
      let i = nt(n);
      this._keys.push(i), this._keyMap[i.id] = i, t += i.weight;
    }), this._keys.forEach((n) => {
      n.weight /= t;
    });
  }
  get(e) {
    return this._keyMap[e];
  }
  keys() {
    return this._keys;
  }
  toJSON() {
    return JSON.stringify(this._keys);
  }
}
function nt(r) {
  let e = null, t = null, n = null, i = 1, a = null;
  if (z(r) || q(r))
    n = r, e = Ne(r), t = Se(r);
  else {
    if (!We.call(r, "name"))
      throw new Error(St("name"));
    const s = r.name;
    if (n = s, We.call(r, "weight") && (i = r.weight, i <= 0))
      throw new Error(Dt(s));
    e = Ne(s), t = Se(s), a = r.getFn;
  }
  return { path: e, id: t, weight: i, src: n, getFn: a };
}
function Ne(r) {
  return q(r) ? r : r.split(".");
}
function Se(r) {
  return q(r) ? r.join(".") : r;
}
function kt(r, e) {
  let t = [], n = !1;
  const i = (a, s, c) => {
    if (P(a))
      if (!s[c])
        t.push(a);
      else {
        let u = s[c];
        const l = a[u];
        if (!P(l))
          return;
        if (c === s.length - 1 && (z(l) || et(l) || At(l)))
          t.push(xt(l));
        else if (q(l)) {
          n = !0;
          for (let d = 0, f = l.length; d < f; d += 1)
            i(l[d], s, c + 1);
        } else s.length && i(l, s, c + 1);
      }
  };
  return i(r, z(e) ? e.split(".") : e, 0), n ? t : t[0];
}
const Ft = {
  // Whether the matches should be included in the result set. When `true`, each record in the result
  // set will include the indices of the matched characters.
  // These can consequently be used for highlighting purposes.
  includeMatches: !1,
  // When `true`, the matching function will continue to the end of a search pattern even if
  // a perfect match has already been located in the string.
  findAllMatches: !1,
  // Minimum number of characters that must be matched before a result is considered a match
  minMatchCharLength: 1
}, It = {
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
  sortFn: (r, e) => r.score === e.score ? r.idx < e.idx ? -1 : 1 : r.score < e.score ? -1 : 1
}, Ot = {
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
}, Bt = {
  // When `true`, it enables the use of unix-like search commands
  useExtendedSearch: !1,
  // The get function to use when fetching an object's properties.
  // The default will search nested paths *ie foo.bar.baz*
  getFn: kt,
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
var g = {
  ...It,
  ...Ft,
  ...Ot,
  ...Bt
};
const Pt = /[^ ]+/g;
function Rt(r = 1, e = 3) {
  const t = /* @__PURE__ */ new Map(), n = Math.pow(10, e);
  return {
    get(i) {
      const a = i.match(Pt).length;
      if (t.has(a))
        return t.get(a);
      const s = 1 / Math.pow(a, 0.5 * r), c = parseFloat(Math.round(s * n) / n);
      return t.set(a, c), c;
    },
    clear() {
      t.clear();
    }
  };
}
class Pe {
  constructor({
    getFn: e = g.getFn,
    fieldNormWeight: t = g.fieldNormWeight
  } = {}) {
    this.norm = Rt(t, 3), this.getFn = e, this.isCreated = !1, this.setIndexRecords();
  }
  setSources(e = []) {
    this.docs = e;
  }
  setIndexRecords(e = []) {
    this.records = e;
  }
  setKeys(e = []) {
    this.keys = e, this._keysMap = {}, e.forEach((t, n) => {
      this._keysMap[t.id] = n;
    });
  }
  create() {
    this.isCreated || !this.docs.length || (this.isCreated = !0, z(this.docs[0]) ? this.docs.forEach((e, t) => {
      this._addString(e, t);
    }) : this.docs.forEach((e, t) => {
      this._addObject(e, t);
    }), this.norm.clear());
  }
  // Adds a doc to the end of the index
  add(e) {
    const t = this.size();
    z(e) ? this._addString(e, t) : this._addObject(e, t);
  }
  // Removes the doc at the specified index of the index
  removeAt(e) {
    this.records.splice(e, 1);
    for (let t = e, n = this.size(); t < n; t += 1)
      this.records[t].i -= 1;
  }
  getValueForItemAtKeyId(e, t) {
    return e[this._keysMap[t]];
  }
  size() {
    return this.records.length;
  }
  _addString(e, t) {
    if (!P(e) || _e(e))
      return;
    let n = {
      v: e,
      i: t,
      n: this.norm.get(e)
    };
    this.records.push(n);
  }
  _addObject(e, t) {
    let n = { i: t, $: {} };
    this.keys.forEach((i, a) => {
      let s = i.getFn ? i.getFn(e) : this.getFn(e, i.path);
      if (P(s)) {
        if (q(s)) {
          let c = [];
          const u = [{ nestedArrIndex: -1, value: s }];
          for (; u.length; ) {
            const { nestedArrIndex: l, value: d } = u.pop();
            if (P(d))
              if (z(d) && !_e(d)) {
                let f = {
                  v: d,
                  i: l,
                  n: this.norm.get(d)
                };
                c.push(f);
              } else q(d) && d.forEach((f, p) => {
                u.push({
                  nestedArrIndex: p,
                  value: f
                });
              });
          }
          n.$[a] = c;
        } else if (z(s) && !_e(s)) {
          let c = {
            v: s,
            n: this.norm.get(s)
          };
          n.$[a] = c;
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
function it(r, e, { getFn: t = g.getFn, fieldNormWeight: n = g.fieldNormWeight } = {}) {
  const i = new Pe({ getFn: t, fieldNormWeight: n });
  return i.setKeys(r.map(nt)), i.setSources(e), i.create(), i;
}
function Wt(r, { getFn: e = g.getFn, fieldNormWeight: t = g.fieldNormWeight } = {}) {
  const { keys: n, records: i } = r, a = new Pe({ getFn: e, fieldNormWeight: t });
  return a.setKeys(n), a.setIndexRecords(i), a;
}
function fe(r, {
  errors: e = 0,
  currentLocation: t = 0,
  expectedLocation: n = 0,
  distance: i = g.distance,
  ignoreLocation: a = g.ignoreLocation
} = {}) {
  const s = e / r.length;
  if (a)
    return s;
  const c = Math.abs(n - t);
  return i ? s + c / i : c ? 1 : s;
}
function Nt(r = [], e = g.minMatchCharLength) {
  let t = [], n = -1, i = -1, a = 0;
  for (let s = r.length; a < s; a += 1) {
    let c = r[a];
    c && n === -1 ? n = a : !c && n !== -1 && (i = a - 1, i - n + 1 >= e && t.push([n, i]), n = -1);
  }
  return r[a - 1] && a - n >= e && t.push([n, a - 1]), t;
}
const te = 32;
function Tt(r, e, t, {
  location: n = g.location,
  distance: i = g.distance,
  threshold: a = g.threshold,
  findAllMatches: s = g.findAllMatches,
  minMatchCharLength: c = g.minMatchCharLength,
  includeMatches: u = g.includeMatches,
  ignoreLocation: l = g.ignoreLocation
} = {}) {
  if (e.length > te)
    throw new Error(Mt(te));
  const d = e.length, f = r.length, p = Math.max(0, Math.min(n, f));
  let w = a, h = p;
  const m = c > 1 || u, v = m ? Array(f) : [];
  let M;
  for (; (M = r.indexOf(e, h)) > -1; ) {
    let S = fe(e, {
      currentLocation: M,
      expectedLocation: p,
      distance: i,
      ignoreLocation: l
    });
    if (w = Math.min(S, w), h = M + d, m) {
      let E = 0;
      for (; E < d; )
        v[M + E] = 1, E += 1;
    }
  }
  h = -1;
  let _ = [], F = 1, x = d + f;
  const B = 1 << d - 1;
  for (let S = 0; S < d; S += 1) {
    let E = 0, C = x;
    for (; E < C; )
      fe(e, {
        errors: S,
        currentLocation: p + C,
        expectedLocation: p,
        distance: i,
        ignoreLocation: l
      }) <= w ? E = C : x = C, C = Math.floor((x - E) / 2 + E);
    x = C;
    let k = Math.max(1, p - C + 1), Q = s ? f : Math.min(p + C, f) + d, R = Array(Q + 2);
    R[Q + 1] = (1 << S) - 1;
    for (let D = Q; D >= k; D -= 1) {
      let X = D - 1, W = t[r.charAt(X)];
      if (m && (v[X] = +!!W), R[D] = (R[D + 1] << 1 | 1) & W, S && (R[D] |= (_[D + 1] | _[D]) << 1 | 1 | _[D + 1]), R[D] & B && (F = fe(e, {
        errors: S,
        currentLocation: X,
        expectedLocation: p,
        distance: i,
        ignoreLocation: l
      }), F <= w)) {
        if (w = F, h = X, h <= p)
          break;
        k = Math.max(1, 2 * p - h);
      }
    }
    if (fe(e, {
      errors: S + 1,
      currentLocation: p,
      expectedLocation: p,
      distance: i,
      ignoreLocation: l
    }) > w)
      break;
    _ = R;
  }
  const Y = {
    isMatch: h >= 0,
    // Count exact matches (those with a score of 0) to be "almost" exact
    score: Math.max(1e-3, F)
  };
  if (m) {
    const S = Nt(v, c);
    S.length ? u && (Y.indices = S) : Y.isMatch = !1;
  }
  return Y;
}
function Lt(r) {
  let e = {};
  for (let t = 0, n = r.length; t < n; t += 1) {
    const i = r.charAt(t);
    e[i] = (e[i] || 0) | 1 << n - t - 1;
  }
  return e;
}
const ye = String.prototype.normalize ? (r) => r.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "") : (r) => r;
class st {
  constructor(e, {
    location: t = g.location,
    threshold: n = g.threshold,
    distance: i = g.distance,
    includeMatches: a = g.includeMatches,
    findAllMatches: s = g.findAllMatches,
    minMatchCharLength: c = g.minMatchCharLength,
    isCaseSensitive: u = g.isCaseSensitive,
    ignoreDiacritics: l = g.ignoreDiacritics,
    ignoreLocation: d = g.ignoreLocation
  } = {}) {
    if (this.options = {
      location: t,
      threshold: n,
      distance: i,
      includeMatches: a,
      findAllMatches: s,
      minMatchCharLength: c,
      isCaseSensitive: u,
      ignoreDiacritics: l,
      ignoreLocation: d
    }, e = u ? e : e.toLowerCase(), e = l ? ye(e) : e, this.pattern = e, this.chunks = [], !this.pattern.length)
      return;
    const f = (w, h) => {
      this.chunks.push({
        pattern: w,
        alphabet: Lt(w),
        startIndex: h
      });
    }, p = this.pattern.length;
    if (p > te) {
      let w = 0;
      const h = p % te, m = p - h;
      for (; w < m; )
        f(this.pattern.substr(w, te), w), w += te;
      if (h) {
        const v = p - te;
        f(this.pattern.substr(v), v);
      }
    } else
      f(this.pattern, 0);
  }
  searchIn(e) {
    const { isCaseSensitive: t, ignoreDiacritics: n, includeMatches: i } = this.options;
    if (e = t ? e : e.toLowerCase(), e = n ? ye(e) : e, this.pattern === e) {
      let m = {
        isMatch: !0,
        score: 0
      };
      return i && (m.indices = [[0, e.length - 1]]), m;
    }
    const {
      location: a,
      distance: s,
      threshold: c,
      findAllMatches: u,
      minMatchCharLength: l,
      ignoreLocation: d
    } = this.options;
    let f = [], p = 0, w = !1;
    this.chunks.forEach(({ pattern: m, alphabet: v, startIndex: M }) => {
      const { isMatch: _, score: F, indices: x } = Tt(e, m, v, {
        location: a + M,
        distance: s,
        threshold: c,
        findAllMatches: u,
        minMatchCharLength: l,
        includeMatches: i,
        ignoreLocation: d
      });
      _ && (w = !0), p += F, _ && x && (f = [...f, ...x]);
    });
    let h = {
      isMatch: w,
      score: w ? p / this.chunks.length : 1
    };
    return w && i && (h.indices = f), h;
  }
}
class J {
  constructor(e) {
    this.pattern = e;
  }
  static isMultiMatch(e) {
    return Te(e, this.multiRegex);
  }
  static isSingleMatch(e) {
    return Te(e, this.singleRegex);
  }
  search() {
  }
}
function Te(r, e) {
  const t = r.match(e);
  return t ? t[1] : null;
}
class Yt extends J {
  constructor(e) {
    super(e);
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
  search(e) {
    const t = e === this.pattern;
    return {
      isMatch: t,
      score: t ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    };
  }
}
class Vt extends J {
  constructor(e) {
    super(e);
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
  search(e) {
    const n = e.indexOf(this.pattern) === -1;
    return {
      isMatch: n,
      score: n ? 0 : 1,
      indices: [0, e.length - 1]
    };
  }
}
class jt extends J {
  constructor(e) {
    super(e);
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
  search(e) {
    const t = e.startsWith(this.pattern);
    return {
      isMatch: t,
      score: t ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    };
  }
}
class Ht extends J {
  constructor(e) {
    super(e);
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
  search(e) {
    const t = !e.startsWith(this.pattern);
    return {
      isMatch: t,
      score: t ? 0 : 1,
      indices: [0, e.length - 1]
    };
  }
}
class zt extends J {
  constructor(e) {
    super(e);
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
  search(e) {
    const t = e.endsWith(this.pattern);
    return {
      isMatch: t,
      score: t ? 0 : 1,
      indices: [e.length - this.pattern.length, e.length - 1]
    };
  }
}
class Gt extends J {
  constructor(e) {
    super(e);
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
  search(e) {
    const t = !e.endsWith(this.pattern);
    return {
      isMatch: t,
      score: t ? 0 : 1,
      indices: [0, e.length - 1]
    };
  }
}
class at extends J {
  constructor(e, {
    location: t = g.location,
    threshold: n = g.threshold,
    distance: i = g.distance,
    includeMatches: a = g.includeMatches,
    findAllMatches: s = g.findAllMatches,
    minMatchCharLength: c = g.minMatchCharLength,
    isCaseSensitive: u = g.isCaseSensitive,
    ignoreDiacritics: l = g.ignoreDiacritics,
    ignoreLocation: d = g.ignoreLocation
  } = {}) {
    super(e), this._bitapSearch = new st(e, {
      location: t,
      threshold: n,
      distance: i,
      includeMatches: a,
      findAllMatches: s,
      minMatchCharLength: c,
      isCaseSensitive: u,
      ignoreDiacritics: l,
      ignoreLocation: d
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
  search(e) {
    return this._bitapSearch.searchIn(e);
  }
}
class ot extends J {
  constructor(e) {
    super(e);
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
  search(e) {
    let t = 0, n;
    const i = [], a = this.pattern.length;
    for (; (n = e.indexOf(this.pattern, t)) > -1; )
      t = n + a, i.push([n, t - 1]);
    const s = !!i.length;
    return {
      isMatch: s,
      score: s ? 0 : 1,
      indices: i
    };
  }
}
const De = [
  Yt,
  ot,
  jt,
  Ht,
  Gt,
  zt,
  Vt,
  at
], Le = De.length, Qt = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/, qt = "|";
function Xt(r, e = {}) {
  return r.split(qt).map((t) => {
    let n = t.trim().split(Qt).filter((a) => a && !!a.trim()), i = [];
    for (let a = 0, s = n.length; a < s; a += 1) {
      const c = n[a];
      let u = !1, l = -1;
      for (; !u && ++l < Le; ) {
        const d = De[l];
        let f = d.isMultiMatch(c);
        f && (i.push(new d(f, e)), u = !0);
      }
      if (!u)
        for (l = -1; ++l < Le; ) {
          const d = De[l];
          let f = d.isSingleMatch(c);
          if (f) {
            i.push(new d(f, e));
            break;
          }
        }
    }
    return i;
  });
}
const Ut = /* @__PURE__ */ new Set([at.type, ot.type]);
class Kt {
  constructor(e, {
    isCaseSensitive: t = g.isCaseSensitive,
    ignoreDiacritics: n = g.ignoreDiacritics,
    includeMatches: i = g.includeMatches,
    minMatchCharLength: a = g.minMatchCharLength,
    ignoreLocation: s = g.ignoreLocation,
    findAllMatches: c = g.findAllMatches,
    location: u = g.location,
    threshold: l = g.threshold,
    distance: d = g.distance
  } = {}) {
    this.query = null, this.options = {
      isCaseSensitive: t,
      ignoreDiacritics: n,
      includeMatches: i,
      minMatchCharLength: a,
      findAllMatches: c,
      ignoreLocation: s,
      location: u,
      threshold: l,
      distance: d
    }, e = t ? e : e.toLowerCase(), e = n ? ye(e) : e, this.pattern = e, this.query = Xt(this.pattern, this.options);
  }
  static condition(e, t) {
    return t.useExtendedSearch;
  }
  searchIn(e) {
    const t = this.query;
    if (!t)
      return {
        isMatch: !1,
        score: 1
      };
    const { includeMatches: n, isCaseSensitive: i, ignoreDiacritics: a } = this.options;
    e = i ? e : e.toLowerCase(), e = a ? ye(e) : e;
    let s = 0, c = [], u = 0;
    for (let l = 0, d = t.length; l < d; l += 1) {
      const f = t[l];
      c.length = 0, s = 0;
      for (let p = 0, w = f.length; p < w; p += 1) {
        const h = f[p], { isMatch: m, indices: v, score: M } = h.search(e);
        if (m) {
          if (s += 1, u += M, n) {
            const _ = h.constructor.type;
            Ut.has(_) ? c = [...c, ...v] : c.push(v);
          }
        } else {
          u = 0, s = 0, c.length = 0;
          break;
        }
      }
      if (s) {
        let p = {
          isMatch: !0,
          score: u / s
        };
        return n && (p.indices = c), p;
      }
    }
    return {
      isMatch: !1,
      score: 1
    };
  }
}
const $e = [];
function Jt(...r) {
  $e.push(...r);
}
function ke(r, e) {
  for (let t = 0, n = $e.length; t < n; t += 1) {
    let i = $e[t];
    if (i.condition(r, e))
      return new i(r, e);
  }
  return new st(r, e);
}
const be = {
  AND: "$and",
  OR: "$or"
}, Fe = {
  PATH: "$path",
  PATTERN: "$val"
}, Ie = (r) => !!(r[be.AND] || r[be.OR]), Zt = (r) => !!r[Fe.PATH], er = (r) => !q(r) && tt(r) && !Ie(r), Ye = (r) => ({
  [be.AND]: Object.keys(r).map((e) => ({
    [e]: r[e]
  }))
});
function ct(r, e, { auto: t = !0 } = {}) {
  const n = (i) => {
    let a = Object.keys(i);
    const s = Zt(i);
    if (!s && a.length > 1 && !Ie(i))
      return n(Ye(i));
    if (er(i)) {
      const u = s ? i[Fe.PATH] : a[0], l = s ? i[Fe.PATTERN] : i[u];
      if (!z(l))
        throw new Error(Et(u));
      const d = {
        keyId: Se(u),
        pattern: l
      };
      return t && (d.searcher = ke(l, e)), d;
    }
    let c = {
      children: [],
      operator: a[0]
    };
    return a.forEach((u) => {
      const l = i[u];
      q(l) && l.forEach((d) => {
        c.children.push(n(d));
      });
    }), c;
  };
  return Ie(r) || (r = Ye(r)), n(r);
}
function tr(r, { ignoreFieldNorm: e = g.ignoreFieldNorm }) {
  r.forEach((t) => {
    let n = 1;
    t.matches.forEach(({ key: i, norm: a, score: s }) => {
      const c = i ? i.weight : null;
      n *= Math.pow(
        s === 0 && c ? Number.EPSILON : s,
        (c || 1) * (e ? 1 : a)
      );
    }), t.score = n;
  });
}
function rr(r, e) {
  const t = r.matches;
  e.matches = [], P(t) && t.forEach((n) => {
    if (!P(n.indices) || !n.indices.length)
      return;
    const { indices: i, value: a } = n;
    let s = {
      indices: i,
      value: a
    };
    n.key && (s.key = n.key.src), n.idx > -1 && (s.refIndex = n.idx), e.matches.push(s);
  });
}
function nr(r, e) {
  e.score = r.score;
}
function ir(r, e, {
  includeMatches: t = g.includeMatches,
  includeScore: n = g.includeScore
} = {}) {
  const i = [];
  return t && i.push(rr), n && i.push(nr), r.map((a) => {
    const { idx: s } = a, c = {
      item: e[s],
      refIndex: s
    };
    return i.length && i.forEach((u) => {
      u(a, c);
    }), c;
  });
}
class G {
  constructor(e, t = {}, n) {
    this.options = { ...g, ...t }, this.options.useExtendedSearch, this._keyStore = new $t(this.options.keys), this.setCollection(e, n);
  }
  setCollection(e, t) {
    if (this._docs = e, t && !(t instanceof Pe))
      throw new Error(_t);
    this._myIndex = t || it(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
  }
  add(e) {
    P(e) && (this._docs.push(e), this._myIndex.add(e));
  }
  remove(e = () => !1) {
    const t = [];
    for (let n = 0, i = this._docs.length; n < i; n += 1) {
      const a = this._docs[n];
      e(a, n) && (this.removeAt(n), n -= 1, i -= 1, t.push(a));
    }
    return t;
  }
  removeAt(e) {
    this._docs.splice(e, 1), this._myIndex.removeAt(e);
  }
  getIndex() {
    return this._myIndex;
  }
  search(e, { limit: t = -1 } = {}) {
    const {
      includeMatches: n,
      includeScore: i,
      shouldSort: a,
      sortFn: s,
      ignoreFieldNorm: c
    } = this.options;
    let u = z(e) ? z(this._docs[0]) ? this._searchStringList(e) : this._searchObjectList(e) : this._searchLogical(e);
    return tr(u, { ignoreFieldNorm: c }), a && u.sort(s), et(t) && t > -1 && (u = u.slice(0, t)), ir(u, this._docs, {
      includeMatches: n,
      includeScore: i
    });
  }
  _searchStringList(e) {
    const t = ke(e, this.options), { records: n } = this._myIndex, i = [];
    return n.forEach(({ v: a, i: s, n: c }) => {
      if (!P(a))
        return;
      const { isMatch: u, score: l, indices: d } = t.searchIn(a);
      u && i.push({
        item: a,
        idx: s,
        matches: [{ score: l, value: a, norm: c, indices: d }]
      });
    }), i;
  }
  _searchLogical(e) {
    const t = ct(e, this.options), n = (c, u, l) => {
      if (!c.children) {
        const { keyId: f, searcher: p } = c, w = this._findMatches({
          key: this._keyStore.get(f),
          value: this._myIndex.getValueForItemAtKeyId(u, f),
          searcher: p
        });
        return w && w.length ? [
          {
            idx: l,
            item: u,
            matches: w
          }
        ] : [];
      }
      const d = [];
      for (let f = 0, p = c.children.length; f < p; f += 1) {
        const w = c.children[f], h = n(w, u, l);
        if (h.length)
          d.push(...h);
        else if (c.operator === be.AND)
          return [];
      }
      return d;
    }, i = this._myIndex.records, a = {}, s = [];
    return i.forEach(({ $: c, i: u }) => {
      if (P(c)) {
        let l = n(t, c, u);
        l.length && (a[u] || (a[u] = { idx: u, item: c, matches: [] }, s.push(a[u])), l.forEach(({ matches: d }) => {
          a[u].matches.push(...d);
        }));
      }
    }), s;
  }
  _searchObjectList(e) {
    const t = ke(e, this.options), { keys: n, records: i } = this._myIndex, a = [];
    return i.forEach(({ $: s, i: c }) => {
      if (!P(s))
        return;
      let u = [];
      n.forEach((l, d) => {
        u.push(
          ...this._findMatches({
            key: l,
            value: s[d],
            searcher: t
          })
        );
      }), u.length && a.push({
        idx: c,
        item: s,
        matches: u
      });
    }), a;
  }
  _findMatches({ key: e, value: t, searcher: n }) {
    if (!P(t))
      return [];
    let i = [];
    if (q(t))
      t.forEach(({ v: a, i: s, n: c }) => {
        if (!P(a))
          return;
        const { isMatch: u, score: l, indices: d } = n.searchIn(a);
        u && i.push({
          score: l,
          key: e,
          value: a,
          idx: s,
          norm: c,
          indices: d
        });
      });
    else {
      const { v: a, n: s } = t, { isMatch: c, score: u, indices: l } = n.searchIn(a);
      c && i.push({ score: u, key: e, value: a, norm: s, indices: l });
    }
    return i;
  }
}
G.version = "7.1.0";
G.createIndex = it;
G.parseIndex = Wt;
G.config = g;
G.parseQuery = ct;
Jt(Kt);
const ge = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["content"]
};
function sr() {
  const { subscribe: r, set: e, update: t } = Be({
    searchQuery: "",
    filtered: !1,
    lastSearch: Date.now(),
    fuseInstance: null,
    items: [],
    selectedItem: null,
    selectedIndex: 0,
    isLoading: !0,
    loadError: !1,
    errorMessage: ""
  });
  let n, i;
  function a(s) {
    n = s.getService(
      "ClipboardHistoryService"
    ), i = s.getService("LogService");
  }
  return {
    subscribe: r,
    setSearch: (s) => t((c) => ({
      ...c,
      searchQuery: s,
      filtered: s.length > 0,
      lastSearch: Date.now()
    })),
    reset: () => e({
      searchQuery: "",
      filtered: !1,
      lastSearch: Date.now(),
      fuseInstance: null,
      items: [],
      selectedItem: null,
      selectedIndex: 0,
      isLoading: !0,
      loadError: !1,
      errorMessage: ""
    }),
    initFuse: (s) => t((c) => ({
      ...c,
      fuseInstance: new G(s, ge)
    })),
    search: (s, c) => {
      let u = s;
      if (c && c.trim() !== "") {
        let l = {
          fuseInstance: null
        };
        r((w) => {
          l = w;
        })();
        let f;
        l.fuseInstance ? (f = l.fuseInstance, f.setCollection(s)) : f = new G(s, ge), u = f.search(c).map((w) => ({
          ...w.item,
          score: w.score
        })), t((w) => ({
          ...w,
          fuseInstance: f
        }));
      }
      return u;
    },
    setItems: (s) => {
      console.log("Setting items in state:", s.length), t((c) => ({
        ...c,
        items: s,
        fuseInstance: new G(s, ge)
      }));
    },
    setSelectedItem(s) {
      t((c) => {
        const u = c.items;
        return u.length > 0 && s >= 0 && s < u.length ? {
          ...c,
          selectedItem: u[s],
          selectedIndex: s
        } : c;
      });
    },
    moveSelection(s) {
      t((c) => {
        const u = c.items;
        if (!u.length) return c;
        let l = c.selectedIndex;
        return s === "up" ? l = l <= 0 ? u.length - 1 : l - 1 : l = l >= u.length - 1 ? 0 : l + 1, requestAnimationFrame(() => {
          const d = document.querySelector(`[data-index="${l}"]`);
          d == null || d.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }), {
          ...c,
          selectedIndex: l,
          selectedItem: u[l]
        };
      });
    },
    setLoading(s) {
      t((c) => ({ ...c, isLoading: s }));
    },
    setError(s) {
      t((c) => ({
        ...c,
        loadError: !!s,
        errorMessage: s || ""
      }));
    },
    initializeServices: a,
    // Expose clipboardService methods through the state store
    async clearNonFavorites() {
      if (!n)
        return i == null || i.error("Clipboard service not initialized in clearNonFavorites"), !1;
      try {
        return await n.clearNonFavorites();
      } catch (s) {
        return i == null || i.error(`Error clearing non-favorites: ${s}`), !1;
      }
    },
    async toggleFavorite(s) {
      if (!n)
        return i == null || i.error("Clipboard service not initialized in toggleFavorite"), !1;
      try {
        return await n.toggleItemFavorite(s);
      } catch (c) {
        return i == null || i.error(`Error toggling favorite for ${s}: ${c}`), !1;
      }
    },
    // --- End exposed methods ---
    async handleItemAction(s, c) {
      if (!(!(s != null && s.id) || !n))
        try {
          switch (c) {
            case "paste":
              await n.pasteItem(s), n == null || n.hideWindow();
              break;
            case "select":
              const l = Ze({ subscribe: r }).items.findIndex((d) => d.id === s.id);
              l >= 0 && this.setSelectedItem(l);
              break;
          }
        } catch (u) {
          i == null || i.error(`Failed to handle item action: ${u}`);
        }
    },
    // Renamed from hideWindow for clarity, calls service method
    async hidePanel() {
      if (!n) {
        i == null || i.error("Clipboard service not initialized in hidePanel");
        return;
      }
      try {
        await n.hideWindow();
      } catch (s) {
        i == null || i.error(`Error hiding window: ${s}`);
      }
    },
    // Refresh history items (no change needed here, already uses service)
    async refreshHistory() {
      t((s) => ({ ...s, isLoading: !0 }));
      try {
        if (n) {
          const s = await n.getRecentItems(100);
          t((c) => ({
            // Use update instead of this.setItems
            ...c,
            items: s,
            fuseInstance: new G(s, ge)
            // Update fuse instance too
          }));
        } else
          i == null || i.warn("Clipboard service not available in refreshHistory");
      } catch (s) {
        i == null || i.error(`Failed to refresh clipboard history: ${s}`), t((c) => ({
          // Use update instead of this.setError
          ...c,
          loadError: !0,
          errorMessage: `Failed to refresh clipboard history: ${s}`
        }));
      } finally {
        this.setLoading(!1);
      }
    }
  };
}
const O = sr(), ut = 6048e5, ar = 864e5, Ve = Symbol.for("constructDateFrom");
function K(r, e) {
  return typeof r == "function" ? r(e) : r && typeof r == "object" && Ve in r ? r[Ve](e) : r instanceof Date ? new r.constructor(e) : new Date(e);
}
function V(r, e) {
  return K(e || r, r);
}
let or = {};
function xe() {
  return or;
}
function de(r, e) {
  var c, u, l, d;
  const t = xe(), n = (e == null ? void 0 : e.weekStartsOn) ?? ((u = (c = e == null ? void 0 : e.locale) == null ? void 0 : c.options) == null ? void 0 : u.weekStartsOn) ?? t.weekStartsOn ?? ((d = (l = t.locale) == null ? void 0 : l.options) == null ? void 0 : d.weekStartsOn) ?? 0, i = V(r, e == null ? void 0 : e.in), a = i.getDay(), s = (a < n ? 7 : 0) + a - n;
  return i.setDate(i.getDate() - s), i.setHours(0, 0, 0, 0), i;
}
function ve(r, e) {
  return de(r, { ...e, weekStartsOn: 1 });
}
function lt(r, e) {
  const t = V(r, e == null ? void 0 : e.in), n = t.getFullYear(), i = K(t, 0);
  i.setFullYear(n + 1, 0, 4), i.setHours(0, 0, 0, 0);
  const a = ve(i), s = K(t, 0);
  s.setFullYear(n, 0, 4), s.setHours(0, 0, 0, 0);
  const c = ve(s);
  return t.getTime() >= a.getTime() ? n + 1 : t.getTime() >= c.getTime() ? n : n - 1;
}
function je(r) {
  const e = V(r), t = new Date(
    Date.UTC(
      e.getFullYear(),
      e.getMonth(),
      e.getDate(),
      e.getHours(),
      e.getMinutes(),
      e.getSeconds(),
      e.getMilliseconds()
    )
  );
  return t.setUTCFullYear(e.getFullYear()), +r - +t;
}
function cr(r, ...e) {
  const t = K.bind(
    null,
    e.find((n) => typeof n == "object")
  );
  return e.map(t);
}
function He(r, e) {
  const t = V(r, e == null ? void 0 : e.in);
  return t.setHours(0, 0, 0, 0), t;
}
function ur(r, e, t) {
  const [n, i] = cr(
    t == null ? void 0 : t.in,
    r,
    e
  ), a = He(n), s = He(i), c = +a - je(a), u = +s - je(s);
  return Math.round((c - u) / ar);
}
function lr(r, e) {
  const t = lt(r, e), n = K(r, 0);
  return n.setFullYear(t, 0, 4), n.setHours(0, 0, 0, 0), ve(n);
}
function dr(r) {
  return r instanceof Date || typeof r == "object" && Object.prototype.toString.call(r) === "[object Date]";
}
function hr(r) {
  return !(!dr(r) && typeof r != "number" || isNaN(+V(r)));
}
function fr(r, e) {
  const t = V(r, e == null ? void 0 : e.in);
  return t.setFullYear(t.getFullYear(), 0, 1), t.setHours(0, 0, 0, 0), t;
}
const gr = {
  lessThanXSeconds: {
    one: "less than a second",
    other: "less than {{count}} seconds"
  },
  xSeconds: {
    one: "1 second",
    other: "{{count}} seconds"
  },
  halfAMinute: "half a minute",
  lessThanXMinutes: {
    one: "less than a minute",
    other: "less than {{count}} minutes"
  },
  xMinutes: {
    one: "1 minute",
    other: "{{count}} minutes"
  },
  aboutXHours: {
    one: "about 1 hour",
    other: "about {{count}} hours"
  },
  xHours: {
    one: "1 hour",
    other: "{{count}} hours"
  },
  xDays: {
    one: "1 day",
    other: "{{count}} days"
  },
  aboutXWeeks: {
    one: "about 1 week",
    other: "about {{count}} weeks"
  },
  xWeeks: {
    one: "1 week",
    other: "{{count}} weeks"
  },
  aboutXMonths: {
    one: "about 1 month",
    other: "about {{count}} months"
  },
  xMonths: {
    one: "1 month",
    other: "{{count}} months"
  },
  aboutXYears: {
    one: "about 1 year",
    other: "about {{count}} years"
  },
  xYears: {
    one: "1 year",
    other: "{{count}} years"
  },
  overXYears: {
    one: "over 1 year",
    other: "over {{count}} years"
  },
  almostXYears: {
    one: "almost 1 year",
    other: "almost {{count}} years"
  }
}, mr = (r, e, t) => {
  let n;
  const i = gr[r];
  return typeof i == "string" ? n = i : e === 1 ? n = i.one : n = i.other.replace("{{count}}", e.toString()), t != null && t.addSuffix ? t.comparison && t.comparison > 0 ? "in " + n : n + " ago" : n;
};
function Ee(r) {
  return (e = {}) => {
    const t = e.width ? String(e.width) : r.defaultWidth;
    return r.formats[t] || r.formats[r.defaultWidth];
  };
}
const wr = {
  full: "EEEE, MMMM do, y",
  long: "MMMM do, y",
  medium: "MMM d, y",
  short: "MM/dd/yyyy"
}, pr = {
  full: "h:mm:ss a zzzz",
  long: "h:mm:ss a z",
  medium: "h:mm:ss a",
  short: "h:mm a"
}, yr = {
  full: "{{date}} 'at' {{time}}",
  long: "{{date}} 'at' {{time}}",
  medium: "{{date}}, {{time}}",
  short: "{{date}}, {{time}}"
}, br = {
  date: Ee({
    formats: wr,
    defaultWidth: "full"
  }),
  time: Ee({
    formats: pr,
    defaultWidth: "full"
  }),
  dateTime: Ee({
    formats: yr,
    defaultWidth: "full"
  })
}, vr = {
  lastWeek: "'last' eeee 'at' p",
  yesterday: "'yesterday at' p",
  today: "'today at' p",
  tomorrow: "'tomorrow at' p",
  nextWeek: "eeee 'at' p",
  other: "P"
}, xr = (r, e, t, n) => vr[r];
function ce(r) {
  return (e, t) => {
    const n = t != null && t.context ? String(t.context) : "standalone";
    let i;
    if (n === "formatting" && r.formattingValues) {
      const s = r.defaultFormattingWidth || r.defaultWidth, c = t != null && t.width ? String(t.width) : s;
      i = r.formattingValues[c] || r.formattingValues[s];
    } else {
      const s = r.defaultWidth, c = t != null && t.width ? String(t.width) : r.defaultWidth;
      i = r.values[c] || r.values[s];
    }
    const a = r.argumentCallback ? r.argumentCallback(e) : e;
    return i[a];
  };
}
const Ar = {
  narrow: ["B", "A"],
  abbreviated: ["BC", "AD"],
  wide: ["Before Christ", "Anno Domini"]
}, Cr = {
  narrow: ["1", "2", "3", "4"],
  abbreviated: ["Q1", "Q2", "Q3", "Q4"],
  wide: ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter"]
}, _r = {
  narrow: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
  abbreviated: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ],
  wide: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ]
}, Er = {
  narrow: ["S", "M", "T", "W", "T", "F", "S"],
  short: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  abbreviated: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  wide: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ]
}, Mr = {
  narrow: {
    am: "a",
    pm: "p",
    midnight: "mi",
    noon: "n",
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night"
  },
  abbreviated: {
    am: "AM",
    pm: "PM",
    midnight: "midnight",
    noon: "noon",
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night"
  },
  wide: {
    am: "a.m.",
    pm: "p.m.",
    midnight: "midnight",
    noon: "noon",
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night"
  }
}, Sr = {
  narrow: {
    am: "a",
    pm: "p",
    midnight: "mi",
    noon: "n",
    morning: "in the morning",
    afternoon: "in the afternoon",
    evening: "in the evening",
    night: "at night"
  },
  abbreviated: {
    am: "AM",
    pm: "PM",
    midnight: "midnight",
    noon: "noon",
    morning: "in the morning",
    afternoon: "in the afternoon",
    evening: "in the evening",
    night: "at night"
  },
  wide: {
    am: "a.m.",
    pm: "p.m.",
    midnight: "midnight",
    noon: "noon",
    morning: "in the morning",
    afternoon: "in the afternoon",
    evening: "in the evening",
    night: "at night"
  }
}, Dr = (r, e) => {
  const t = Number(r), n = t % 100;
  if (n > 20 || n < 10)
    switch (n % 10) {
      case 1:
        return t + "st";
      case 2:
        return t + "nd";
      case 3:
        return t + "rd";
    }
  return t + "th";
}, $r = {
  ordinalNumber: Dr,
  era: ce({
    values: Ar,
    defaultWidth: "wide"
  }),
  quarter: ce({
    values: Cr,
    defaultWidth: "wide",
    argumentCallback: (r) => r - 1
  }),
  month: ce({
    values: _r,
    defaultWidth: "wide"
  }),
  day: ce({
    values: Er,
    defaultWidth: "wide"
  }),
  dayPeriod: ce({
    values: Mr,
    defaultWidth: "wide",
    formattingValues: Sr,
    defaultFormattingWidth: "wide"
  })
};
function ue(r) {
  return (e, t = {}) => {
    const n = t.width, i = n && r.matchPatterns[n] || r.matchPatterns[r.defaultMatchWidth], a = e.match(i);
    if (!a)
      return null;
    const s = a[0], c = n && r.parsePatterns[n] || r.parsePatterns[r.defaultParseWidth], u = Array.isArray(c) ? Fr(c, (f) => f.test(s)) : (
      // [TODO] -- I challenge you to fix the type
      kr(c, (f) => f.test(s))
    );
    let l;
    l = r.valueCallback ? r.valueCallback(u) : u, l = t.valueCallback ? (
      // [TODO] -- I challenge you to fix the type
      t.valueCallback(l)
    ) : l;
    const d = e.slice(s.length);
    return { value: l, rest: d };
  };
}
function kr(r, e) {
  for (const t in r)
    if (Object.prototype.hasOwnProperty.call(r, t) && e(r[t]))
      return t;
}
function Fr(r, e) {
  for (let t = 0; t < r.length; t++)
    if (e(r[t]))
      return t;
}
function Ir(r) {
  return (e, t = {}) => {
    const n = e.match(r.matchPattern);
    if (!n) return null;
    const i = n[0], a = e.match(r.parsePattern);
    if (!a) return null;
    let s = r.valueCallback ? r.valueCallback(a[0]) : a[0];
    s = t.valueCallback ? t.valueCallback(s) : s;
    const c = e.slice(i.length);
    return { value: s, rest: c };
  };
}
const Or = /^(\d+)(th|st|nd|rd)?/i, Br = /\d+/i, Pr = {
  narrow: /^(b|a)/i,
  abbreviated: /^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,
  wide: /^(before christ|before common era|anno domini|common era)/i
}, Rr = {
  any: [/^b/i, /^(a|c)/i]
}, Wr = {
  narrow: /^[1234]/i,
  abbreviated: /^q[1234]/i,
  wide: /^[1234](th|st|nd|rd)? quarter/i
}, Nr = {
  any: [/1/i, /2/i, /3/i, /4/i]
}, Tr = {
  narrow: /^[jfmasond]/i,
  abbreviated: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  wide: /^(january|february|march|april|may|june|july|august|september|october|november|december)/i
}, Lr = {
  narrow: [
    /^j/i,
    /^f/i,
    /^m/i,
    /^a/i,
    /^m/i,
    /^j/i,
    /^j/i,
    /^a/i,
    /^s/i,
    /^o/i,
    /^n/i,
    /^d/i
  ],
  any: [
    /^ja/i,
    /^f/i,
    /^mar/i,
    /^ap/i,
    /^may/i,
    /^jun/i,
    /^jul/i,
    /^au/i,
    /^s/i,
    /^o/i,
    /^n/i,
    /^d/i
  ]
}, Yr = {
  narrow: /^[smtwf]/i,
  short: /^(su|mo|tu|we|th|fr|sa)/i,
  abbreviated: /^(sun|mon|tue|wed|thu|fri|sat)/i,
  wide: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i
}, Vr = {
  narrow: [/^s/i, /^m/i, /^t/i, /^w/i, /^t/i, /^f/i, /^s/i],
  any: [/^su/i, /^m/i, /^tu/i, /^w/i, /^th/i, /^f/i, /^sa/i]
}, jr = {
  narrow: /^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,
  any: /^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i
}, Hr = {
  any: {
    am: /^a/i,
    pm: /^p/i,
    midnight: /^mi/i,
    noon: /^no/i,
    morning: /morning/i,
    afternoon: /afternoon/i,
    evening: /evening/i,
    night: /night/i
  }
}, zr = {
  ordinalNumber: Ir({
    matchPattern: Or,
    parsePattern: Br,
    valueCallback: (r) => parseInt(r, 10)
  }),
  era: ue({
    matchPatterns: Pr,
    defaultMatchWidth: "wide",
    parsePatterns: Rr,
    defaultParseWidth: "any"
  }),
  quarter: ue({
    matchPatterns: Wr,
    defaultMatchWidth: "wide",
    parsePatterns: Nr,
    defaultParseWidth: "any",
    valueCallback: (r) => r + 1
  }),
  month: ue({
    matchPatterns: Tr,
    defaultMatchWidth: "wide",
    parsePatterns: Lr,
    defaultParseWidth: "any"
  }),
  day: ue({
    matchPatterns: Yr,
    defaultMatchWidth: "wide",
    parsePatterns: Vr,
    defaultParseWidth: "any"
  }),
  dayPeriod: ue({
    matchPatterns: jr,
    defaultMatchWidth: "any",
    parsePatterns: Hr,
    defaultParseWidth: "any"
  })
}, Gr = {
  code: "en-US",
  formatDistance: mr,
  formatLong: br,
  formatRelative: xr,
  localize: $r,
  match: zr,
  options: {
    weekStartsOn: 0,
    firstWeekContainsDate: 1
  }
};
function Qr(r, e) {
  const t = V(r, e == null ? void 0 : e.in);
  return ur(t, fr(t)) + 1;
}
function qr(r, e) {
  const t = V(r, e == null ? void 0 : e.in), n = +ve(t) - +lr(t);
  return Math.round(n / ut) + 1;
}
function dt(r, e) {
  var d, f, p, w;
  const t = V(r, e == null ? void 0 : e.in), n = t.getFullYear(), i = xe(), a = (e == null ? void 0 : e.firstWeekContainsDate) ?? ((f = (d = e == null ? void 0 : e.locale) == null ? void 0 : d.options) == null ? void 0 : f.firstWeekContainsDate) ?? i.firstWeekContainsDate ?? ((w = (p = i.locale) == null ? void 0 : p.options) == null ? void 0 : w.firstWeekContainsDate) ?? 1, s = K((e == null ? void 0 : e.in) || r, 0);
  s.setFullYear(n + 1, 0, a), s.setHours(0, 0, 0, 0);
  const c = de(s, e), u = K((e == null ? void 0 : e.in) || r, 0);
  u.setFullYear(n, 0, a), u.setHours(0, 0, 0, 0);
  const l = de(u, e);
  return +t >= +c ? n + 1 : +t >= +l ? n : n - 1;
}
function Xr(r, e) {
  var c, u, l, d;
  const t = xe(), n = (e == null ? void 0 : e.firstWeekContainsDate) ?? ((u = (c = e == null ? void 0 : e.locale) == null ? void 0 : c.options) == null ? void 0 : u.firstWeekContainsDate) ?? t.firstWeekContainsDate ?? ((d = (l = t.locale) == null ? void 0 : l.options) == null ? void 0 : d.firstWeekContainsDate) ?? 1, i = dt(r, e), a = K((e == null ? void 0 : e.in) || r, 0);
  return a.setFullYear(i, 0, n), a.setHours(0, 0, 0, 0), de(a, e);
}
function Ur(r, e) {
  const t = V(r, e == null ? void 0 : e.in), n = +de(t, e) - +Xr(t, e);
  return Math.round(n / ut) + 1;
}
function A(r, e) {
  const t = r < 0 ? "-" : "", n = Math.abs(r).toString().padStart(e, "0");
  return t + n;
}
const U = {
  // Year
  y(r, e) {
    const t = r.getFullYear(), n = t > 0 ? t : 1 - t;
    return A(e === "yy" ? n % 100 : n, e.length);
  },
  // Month
  M(r, e) {
    const t = r.getMonth();
    return e === "M" ? String(t + 1) : A(t + 1, 2);
  },
  // Day of the month
  d(r, e) {
    return A(r.getDate(), e.length);
  },
  // AM or PM
  a(r, e) {
    const t = r.getHours() / 12 >= 1 ? "pm" : "am";
    switch (e) {
      case "a":
      case "aa":
        return t.toUpperCase();
      case "aaa":
        return t;
      case "aaaaa":
        return t[0];
      case "aaaa":
      default:
        return t === "am" ? "a.m." : "p.m.";
    }
  },
  // Hour [1-12]
  h(r, e) {
    return A(r.getHours() % 12 || 12, e.length);
  },
  // Hour [0-23]
  H(r, e) {
    return A(r.getHours(), e.length);
  },
  // Minute
  m(r, e) {
    return A(r.getMinutes(), e.length);
  },
  // Second
  s(r, e) {
    return A(r.getSeconds(), e.length);
  },
  // Fraction of second
  S(r, e) {
    const t = e.length, n = r.getMilliseconds(), i = Math.trunc(
      n * Math.pow(10, t - 3)
    );
    return A(i, e.length);
  }
}, ie = {
  midnight: "midnight",
  noon: "noon",
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  night: "night"
}, ze = {
  // Era
  G: function(r, e, t) {
    const n = r.getFullYear() > 0 ? 1 : 0;
    switch (e) {
      // AD, BC
      case "G":
      case "GG":
      case "GGG":
        return t.era(n, { width: "abbreviated" });
      // A, B
      case "GGGGG":
        return t.era(n, { width: "narrow" });
      // Anno Domini, Before Christ
      case "GGGG":
      default:
        return t.era(n, { width: "wide" });
    }
  },
  // Year
  y: function(r, e, t) {
    if (e === "yo") {
      const n = r.getFullYear(), i = n > 0 ? n : 1 - n;
      return t.ordinalNumber(i, { unit: "year" });
    }
    return U.y(r, e);
  },
  // Local week-numbering year
  Y: function(r, e, t, n) {
    const i = dt(r, n), a = i > 0 ? i : 1 - i;
    if (e === "YY") {
      const s = a % 100;
      return A(s, 2);
    }
    return e === "Yo" ? t.ordinalNumber(a, { unit: "year" }) : A(a, e.length);
  },
  // ISO week-numbering year
  R: function(r, e) {
    const t = lt(r);
    return A(t, e.length);
  },
  // Extended year. This is a single number designating the year of this calendar system.
  // The main difference between `y` and `u` localizers are B.C. years:
  // | Year | `y` | `u` |
  // |------|-----|-----|
  // | AC 1 |   1 |   1 |
  // | BC 1 |   1 |   0 |
  // | BC 2 |   2 |  -1 |
  // Also `yy` always returns the last two digits of a year,
  // while `uu` pads single digit years to 2 characters and returns other years unchanged.
  u: function(r, e) {
    const t = r.getFullYear();
    return A(t, e.length);
  },
  // Quarter
  Q: function(r, e, t) {
    const n = Math.ceil((r.getMonth() + 1) / 3);
    switch (e) {
      // 1, 2, 3, 4
      case "Q":
        return String(n);
      // 01, 02, 03, 04
      case "QQ":
        return A(n, 2);
      // 1st, 2nd, 3rd, 4th
      case "Qo":
        return t.ordinalNumber(n, { unit: "quarter" });
      // Q1, Q2, Q3, Q4
      case "QQQ":
        return t.quarter(n, {
          width: "abbreviated",
          context: "formatting"
        });
      // 1, 2, 3, 4 (narrow quarter; could be not numerical)
      case "QQQQQ":
        return t.quarter(n, {
          width: "narrow",
          context: "formatting"
        });
      // 1st quarter, 2nd quarter, ...
      case "QQQQ":
      default:
        return t.quarter(n, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Stand-alone quarter
  q: function(r, e, t) {
    const n = Math.ceil((r.getMonth() + 1) / 3);
    switch (e) {
      // 1, 2, 3, 4
      case "q":
        return String(n);
      // 01, 02, 03, 04
      case "qq":
        return A(n, 2);
      // 1st, 2nd, 3rd, 4th
      case "qo":
        return t.ordinalNumber(n, { unit: "quarter" });
      // Q1, Q2, Q3, Q4
      case "qqq":
        return t.quarter(n, {
          width: "abbreviated",
          context: "standalone"
        });
      // 1, 2, 3, 4 (narrow quarter; could be not numerical)
      case "qqqqq":
        return t.quarter(n, {
          width: "narrow",
          context: "standalone"
        });
      // 1st quarter, 2nd quarter, ...
      case "qqqq":
      default:
        return t.quarter(n, {
          width: "wide",
          context: "standalone"
        });
    }
  },
  // Month
  M: function(r, e, t) {
    const n = r.getMonth();
    switch (e) {
      case "M":
      case "MM":
        return U.M(r, e);
      // 1st, 2nd, ..., 12th
      case "Mo":
        return t.ordinalNumber(n + 1, { unit: "month" });
      // Jan, Feb, ..., Dec
      case "MMM":
        return t.month(n, {
          width: "abbreviated",
          context: "formatting"
        });
      // J, F, ..., D
      case "MMMMM":
        return t.month(n, {
          width: "narrow",
          context: "formatting"
        });
      // January, February, ..., December
      case "MMMM":
      default:
        return t.month(n, { width: "wide", context: "formatting" });
    }
  },
  // Stand-alone month
  L: function(r, e, t) {
    const n = r.getMonth();
    switch (e) {
      // 1, 2, ..., 12
      case "L":
        return String(n + 1);
      // 01, 02, ..., 12
      case "LL":
        return A(n + 1, 2);
      // 1st, 2nd, ..., 12th
      case "Lo":
        return t.ordinalNumber(n + 1, { unit: "month" });
      // Jan, Feb, ..., Dec
      case "LLL":
        return t.month(n, {
          width: "abbreviated",
          context: "standalone"
        });
      // J, F, ..., D
      case "LLLLL":
        return t.month(n, {
          width: "narrow",
          context: "standalone"
        });
      // January, February, ..., December
      case "LLLL":
      default:
        return t.month(n, { width: "wide", context: "standalone" });
    }
  },
  // Local week of year
  w: function(r, e, t, n) {
    const i = Ur(r, n);
    return e === "wo" ? t.ordinalNumber(i, { unit: "week" }) : A(i, e.length);
  },
  // ISO week of year
  I: function(r, e, t) {
    const n = qr(r);
    return e === "Io" ? t.ordinalNumber(n, { unit: "week" }) : A(n, e.length);
  },
  // Day of the month
  d: function(r, e, t) {
    return e === "do" ? t.ordinalNumber(r.getDate(), { unit: "date" }) : U.d(r, e);
  },
  // Day of year
  D: function(r, e, t) {
    const n = Qr(r);
    return e === "Do" ? t.ordinalNumber(n, { unit: "dayOfYear" }) : A(n, e.length);
  },
  // Day of week
  E: function(r, e, t) {
    const n = r.getDay();
    switch (e) {
      // Tue
      case "E":
      case "EE":
      case "EEE":
        return t.day(n, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "EEEEE":
        return t.day(n, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "EEEEEE":
        return t.day(n, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "EEEE":
      default:
        return t.day(n, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Local day of week
  e: function(r, e, t, n) {
    const i = r.getDay(), a = (i - n.weekStartsOn + 8) % 7 || 7;
    switch (e) {
      // Numerical value (Nth day of week with current locale or weekStartsOn)
      case "e":
        return String(a);
      // Padded numerical value
      case "ee":
        return A(a, 2);
      // 1st, 2nd, ..., 7th
      case "eo":
        return t.ordinalNumber(a, { unit: "day" });
      case "eee":
        return t.day(i, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "eeeee":
        return t.day(i, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "eeeeee":
        return t.day(i, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "eeee":
      default:
        return t.day(i, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Stand-alone local day of week
  c: function(r, e, t, n) {
    const i = r.getDay(), a = (i - n.weekStartsOn + 8) % 7 || 7;
    switch (e) {
      // Numerical value (same as in `e`)
      case "c":
        return String(a);
      // Padded numerical value
      case "cc":
        return A(a, e.length);
      // 1st, 2nd, ..., 7th
      case "co":
        return t.ordinalNumber(a, { unit: "day" });
      case "ccc":
        return t.day(i, {
          width: "abbreviated",
          context: "standalone"
        });
      // T
      case "ccccc":
        return t.day(i, {
          width: "narrow",
          context: "standalone"
        });
      // Tu
      case "cccccc":
        return t.day(i, {
          width: "short",
          context: "standalone"
        });
      // Tuesday
      case "cccc":
      default:
        return t.day(i, {
          width: "wide",
          context: "standalone"
        });
    }
  },
  // ISO day of week
  i: function(r, e, t) {
    const n = r.getDay(), i = n === 0 ? 7 : n;
    switch (e) {
      // 2
      case "i":
        return String(i);
      // 02
      case "ii":
        return A(i, e.length);
      // 2nd
      case "io":
        return t.ordinalNumber(i, { unit: "day" });
      // Tue
      case "iii":
        return t.day(n, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "iiiii":
        return t.day(n, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "iiiiii":
        return t.day(n, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "iiii":
      default:
        return t.day(n, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // AM or PM
  a: function(r, e, t) {
    const i = r.getHours() / 12 >= 1 ? "pm" : "am";
    switch (e) {
      case "a":
      case "aa":
        return t.dayPeriod(i, {
          width: "abbreviated",
          context: "formatting"
        });
      case "aaa":
        return t.dayPeriod(i, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "aaaaa":
        return t.dayPeriod(i, {
          width: "narrow",
          context: "formatting"
        });
      case "aaaa":
      default:
        return t.dayPeriod(i, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // AM, PM, midnight, noon
  b: function(r, e, t) {
    const n = r.getHours();
    let i;
    switch (n === 12 ? i = ie.noon : n === 0 ? i = ie.midnight : i = n / 12 >= 1 ? "pm" : "am", e) {
      case "b":
      case "bb":
        return t.dayPeriod(i, {
          width: "abbreviated",
          context: "formatting"
        });
      case "bbb":
        return t.dayPeriod(i, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "bbbbb":
        return t.dayPeriod(i, {
          width: "narrow",
          context: "formatting"
        });
      case "bbbb":
      default:
        return t.dayPeriod(i, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // in the morning, in the afternoon, in the evening, at night
  B: function(r, e, t) {
    const n = r.getHours();
    let i;
    switch (n >= 17 ? i = ie.evening : n >= 12 ? i = ie.afternoon : n >= 4 ? i = ie.morning : i = ie.night, e) {
      case "B":
      case "BB":
      case "BBB":
        return t.dayPeriod(i, {
          width: "abbreviated",
          context: "formatting"
        });
      case "BBBBB":
        return t.dayPeriod(i, {
          width: "narrow",
          context: "formatting"
        });
      case "BBBB":
      default:
        return t.dayPeriod(i, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Hour [1-12]
  h: function(r, e, t) {
    if (e === "ho") {
      let n = r.getHours() % 12;
      return n === 0 && (n = 12), t.ordinalNumber(n, { unit: "hour" });
    }
    return U.h(r, e);
  },
  // Hour [0-23]
  H: function(r, e, t) {
    return e === "Ho" ? t.ordinalNumber(r.getHours(), { unit: "hour" }) : U.H(r, e);
  },
  // Hour [0-11]
  K: function(r, e, t) {
    const n = r.getHours() % 12;
    return e === "Ko" ? t.ordinalNumber(n, { unit: "hour" }) : A(n, e.length);
  },
  // Hour [1-24]
  k: function(r, e, t) {
    let n = r.getHours();
    return n === 0 && (n = 24), e === "ko" ? t.ordinalNumber(n, { unit: "hour" }) : A(n, e.length);
  },
  // Minute
  m: function(r, e, t) {
    return e === "mo" ? t.ordinalNumber(r.getMinutes(), { unit: "minute" }) : U.m(r, e);
  },
  // Second
  s: function(r, e, t) {
    return e === "so" ? t.ordinalNumber(r.getSeconds(), { unit: "second" }) : U.s(r, e);
  },
  // Fraction of second
  S: function(r, e) {
    return U.S(r, e);
  },
  // Timezone (ISO-8601. If offset is 0, output is always `'Z'`)
  X: function(r, e, t) {
    const n = r.getTimezoneOffset();
    if (n === 0)
      return "Z";
    switch (e) {
      // Hours and optional minutes
      case "X":
        return Qe(n);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XX`
      case "XXXX":
      case "XX":
        return ee(n);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XXX`
      case "XXXXX":
      case "XXX":
      // Hours and minutes with `:` delimiter
      default:
        return ee(n, ":");
    }
  },
  // Timezone (ISO-8601. If offset is 0, output is `'+00:00'` or equivalent)
  x: function(r, e, t) {
    const n = r.getTimezoneOffset();
    switch (e) {
      // Hours and optional minutes
      case "x":
        return Qe(n);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xx`
      case "xxxx":
      case "xx":
        return ee(n);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xxx`
      case "xxxxx":
      case "xxx":
      // Hours and minutes with `:` delimiter
      default:
        return ee(n, ":");
    }
  },
  // Timezone (GMT)
  O: function(r, e, t) {
    const n = r.getTimezoneOffset();
    switch (e) {
      // Short
      case "O":
      case "OO":
      case "OOO":
        return "GMT" + Ge(n, ":");
      // Long
      case "OOOO":
      default:
        return "GMT" + ee(n, ":");
    }
  },
  // Timezone (specific non-location)
  z: function(r, e, t) {
    const n = r.getTimezoneOffset();
    switch (e) {
      // Short
      case "z":
      case "zz":
      case "zzz":
        return "GMT" + Ge(n, ":");
      // Long
      case "zzzz":
      default:
        return "GMT" + ee(n, ":");
    }
  },
  // Seconds timestamp
  t: function(r, e, t) {
    const n = Math.trunc(+r / 1e3);
    return A(n, e.length);
  },
  // Milliseconds timestamp
  T: function(r, e, t) {
    return A(+r, e.length);
  }
};
function Ge(r, e = "") {
  const t = r > 0 ? "-" : "+", n = Math.abs(r), i = Math.trunc(n / 60), a = n % 60;
  return a === 0 ? t + String(i) : t + String(i) + e + A(a, 2);
}
function Qe(r, e) {
  return r % 60 === 0 ? (r > 0 ? "-" : "+") + A(Math.abs(r) / 60, 2) : ee(r, e);
}
function ee(r, e = "") {
  const t = r > 0 ? "-" : "+", n = Math.abs(r), i = A(Math.trunc(n / 60), 2), a = A(n % 60, 2);
  return t + i + e + a;
}
const qe = (r, e) => {
  switch (r) {
    case "P":
      return e.date({ width: "short" });
    case "PP":
      return e.date({ width: "medium" });
    case "PPP":
      return e.date({ width: "long" });
    case "PPPP":
    default:
      return e.date({ width: "full" });
  }
}, ht = (r, e) => {
  switch (r) {
    case "p":
      return e.time({ width: "short" });
    case "pp":
      return e.time({ width: "medium" });
    case "ppp":
      return e.time({ width: "long" });
    case "pppp":
    default:
      return e.time({ width: "full" });
  }
}, Kr = (r, e) => {
  const t = r.match(/(P+)(p+)?/) || [], n = t[1], i = t[2];
  if (!i)
    return qe(r, e);
  let a;
  switch (n) {
    case "P":
      a = e.dateTime({ width: "short" });
      break;
    case "PP":
      a = e.dateTime({ width: "medium" });
      break;
    case "PPP":
      a = e.dateTime({ width: "long" });
      break;
    case "PPPP":
    default:
      a = e.dateTime({ width: "full" });
      break;
  }
  return a.replace("{{date}}", qe(n, e)).replace("{{time}}", ht(i, e));
}, Jr = {
  p: ht,
  P: Kr
}, Zr = /^D+$/, en = /^Y+$/, tn = ["D", "DD", "YY", "YYYY"];
function rn(r) {
  return Zr.test(r);
}
function nn(r) {
  return en.test(r);
}
function sn(r, e, t) {
  const n = an(r, e, t);
  if (console.warn(n), tn.includes(r)) throw new RangeError(n);
}
function an(r, e, t) {
  const n = r[0] === "Y" ? "years" : "days of the month";
  return `Use \`${r.toLowerCase()}\` instead of \`${r}\` (in \`${e}\`) for formatting ${n} to the input \`${t}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`;
}
const on = /[yYQqMLwIdDecihHKkms]o|(\w)\1*|''|'(''|[^'])+('|$)|./g, cn = /P+p+|P+|p+|''|'(''|[^'])+('|$)|./g, un = /^'([^]*?)'?$/, ln = /''/g, dn = /[a-zA-Z]/;
function Xe(r, e, t) {
  var d, f, p, w;
  const n = xe(), i = n.locale ?? Gr, a = n.firstWeekContainsDate ?? ((f = (d = n.locale) == null ? void 0 : d.options) == null ? void 0 : f.firstWeekContainsDate) ?? 1, s = n.weekStartsOn ?? ((w = (p = n.locale) == null ? void 0 : p.options) == null ? void 0 : w.weekStartsOn) ?? 0, c = V(r, t == null ? void 0 : t.in);
  if (!hr(c))
    throw new RangeError("Invalid time value");
  let u = e.match(cn).map((h) => {
    const m = h[0];
    if (m === "p" || m === "P") {
      const v = Jr[m];
      return v(h, i.formatLong);
    }
    return h;
  }).join("").match(on).map((h) => {
    if (h === "''")
      return { isToken: !1, value: "'" };
    const m = h[0];
    if (m === "'")
      return { isToken: !1, value: hn(h) };
    if (ze[m])
      return { isToken: !0, value: h };
    if (m.match(dn))
      throw new RangeError(
        "Format string contains an unescaped latin alphabet character `" + m + "`"
      );
    return { isToken: !1, value: h };
  });
  i.localize.preprocessor && (u = i.localize.preprocessor(c, u));
  const l = {
    firstWeekContainsDate: a,
    weekStartsOn: s,
    locale: i
  };
  return u.map((h) => {
    if (!h.isToken) return h.value;
    const m = h.value;
    (nn(m) || rn(m)) && sn(m, e, String(r));
    const v = ze[m[0]];
    return v(c, m, i.localize, l);
  }).join("");
}
function hn(r) {
  const e = r.match(un);
  return e ? e[1].replace(ln, "'") : r;
}
var fn = o.template('<div class="split-view"><div class="split-view-content isolate svelte-16e2eab"><div class="split-view-left custom-scrollbar h-full overflow-y-auto"><!></div>  <div class="w-1 hover:w-2 cursor-ew-resize hover:bg-[var(--border-color)] transition-all z-10" role="separator" aria-orientation="vertical"></div> <div class="split-view-right h-full"><!></div></div></div>');
function gn(r, e) {
  let t = o.prop(e, "leftWidth", 8, "33.333%"), n = o.prop(e, "minLeftWidth", 8, 200), i = o.prop(e, "maxLeftWidth", 8, 800), a = !1, s, c, u = o.mutable_source(), l = o.mutable_source();
  function d(x) {
    a = !0, s = x.pageX, c = o.get(u).offsetWidth, window.addEventListener("mousemove", f), window.addEventListener("mouseup", p), document.body.style.cursor = "ew-resize", document.body.style.userSelect = "none";
  }
  function f(x) {
    if (!a) return;
    const B = x.pageX - s, Y = Math.min(Math.max(c + B, n()), i());
    o.mutate(u, o.get(u).style.width = `${Y}px`);
  }
  function p() {
    a = !1, window.removeEventListener("mousemove", f), window.removeEventListener("mouseup", p), document.body.style.cursor = "", document.body.style.userSelect = "";
  }
  var w = fn(), h = o.child(w), m = o.child(h), v = o.child(m);
  o.slot(v, e, "left", {}, null), o.reset(m), o.bind_this(m, (x) => o.set(u, x), () => o.get(u));
  var M = o.sibling(m, 2), _ = o.sibling(M, 2), F = o.child(_);
  o.slot(F, e, "right", {}, null), o.reset(_), o.bind_this(_, (x) => o.set(l, x), () => o.get(l)), o.reset(h), o.reset(w), o.template_effect(() => o.set_style(m, `width: ${(typeof t() == "number" ? `${t()}px` : t()) ?? ""}`)), o.event("mousedown", M, d), o.append(r, w);
}
var mn = o.template('<div class="p-4 text-center text-sm text-gray-500">No items found</div>'), wn = o.template('<div class="ml-2 flex-shrink-0 text-white opacity-90 text-[10px] font-medium tracking-wide">↵</div>'), pn = o.template('<div role="option"><div class="mr-3 flex-shrink-0 flex items-center justify-center"><!></div> <div class="flex-1 overflow-hidden flex flex-col justify-center gap-0.5"><div> </div> <div><!></div></div> <!></div>'), yn = o.template('<div slot="left" class="h-full overflow-y-auto focus:outline-none bg-white dark:bg-[#1e1e1e] py-2 border-r border-gray-100 dark:border-gray-800 custom-scrollbar svelte-9jgq4c" role="listbox" aria-label="Clipboard Items" tabindex="0"><!></div>'), bn = o.template('<span class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path></svg> </span>'), vn = o.template('<div class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar svelte-9jgq4c"><!></div> <div class="h-12 border-t border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-[#1e1e1e]/80 backdrop-blur-md flex items-center px-4 justify-between text-xs text-gray-500 dark:text-gray-400 shadow-sm z-10"><div class="flex items-center space-x-3"><span class="font-medium uppercase tracking-wider text-[10px] bg-gray-200 dark:bg-gray-800 px-2 py-0.5 rounded"> </span> <span class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> </span> <!></div> <div class="flex items-center gap-1.5 opacity-80 font-medium"><kbd class="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-sans shadow-sm svelte-9jgq4c">Enter</kbd> <span>to Paste</span></div></div>', 1), xn = o.template('<div class="flex h-full items-center justify-center flex-col gap-4 text-gray-400 dark:text-gray-600"><svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg> <span class="text-sm font-medium">Select an item to view details</span></div>'), An = o.template('<div slot="right" class="h-full flex flex-col bg-gray-50/50 dark:bg-[#161616]/50 overflow-hidden relative"><!></div>');
function Qn(r, e) {
  o.push(e, !1);
  const [t, n] = o.setup_stores(), i = () => o.store_get(O, "$clipboardViewState", t), a = o.mutable_source(), s = o.mutable_source(), c = o.mutable_source();
  let u = o.mutable_source();
  yt(async () => {
    await bt();
  });
  function l() {
    requestAnimationFrame(() => {
      var m;
      const h = (m = o.get(u)) == null ? void 0 : m.querySelector(`[data-index="${o.get(c)}"]`);
      if (h) {
        const v = o.get(u).getBoundingClientRect(), M = h.getBoundingClientRect(), _ = M.top < v.top, F = M.bottom > v.bottom;
        _ ? h.scrollIntoView({ block: "start", behavior: "auto" }) : F && h.scrollIntoView({ block: "end", behavior: "auto" });
      }
    });
  }
  function d(h) {
    O.setSelectedItem(h);
  }
  function f(h) {
    return !h || !h.content ? "Empty" : h.type === "image" ? "Image Data" : h.content.replace(/\n/g, " ").trim();
  }
  function p(h, m) {
    const v = m ? "currentColor" : "var(--icon-color, #888)";
    switch (h) {
      case "image":
        return `<svg class="w-4 h-4" style="color: ${v}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`;
      case "html":
        return `<svg class="w-4 h-4" style="color: ${v}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>`;
      default:
        return `<svg class="w-4 h-4" style="color: ${v}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>`;
    }
  }
  function w(h) {
    if (!h || !h.content)
      return '<span class="text-gray-400">No preview available</span>';
    switch (h.type) {
      case "image":
        let m = h.content.replace("data:image/png;base64, ", "data:image/png;base64,");
        return m.startsWith("data:") || (m = `data:image/png;base64,${m}`), m.includes("AAAAAAAA") ? '<div class="text-gray-400">Broken image</div>' : `<div class="image-container w-full h-full flex flex-col items-center justify-center p-4">
        <img src="${m}" class="max-w-full max-h-full object-contain rounded-md shadow-sm border border-gray-200 dark:border-gray-800" alt="Preview"/>
      </div>`;
      case "html":
      case "text":
      default:
        return `<pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-gray-800 dark:text-gray-200">${h.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
    }
  }
  o.legacy_pre_effect(() => (i(), O), () => {
    o.set(a, i().filtered ? O.search(i().items, i().searchQuery) : i().items);
  }), o.legacy_pre_effect(() => i(), () => {
    o.set(s, i().selectedItem);
  }), o.legacy_pre_effect(() => i(), () => {
    o.set(c, i().selectedIndex);
  }), o.legacy_pre_effect(() => o.get(c), () => {
    o.get(c) !== void 0 && l();
  }), o.legacy_pre_effect_reset(), o.init(), gn(r, {
    leftWidth: 260,
    minLeftWidth: 200,
    maxLeftWidth: 600,
    $$slots: {
      left: (h, m) => {
        var v = yn(), M = o.child(v);
        {
          var _ = (x) => {
            var B = mn();
            o.append(x, B);
          }, F = (x) => {
            var B = o.comment(), Y = o.first_child(B);
            o.each(Y, 3, () => o.get(a), (S) => S.id, (S, E, C) => {
              var k = pn(), Q = o.child(k), R = o.child(Q);
              o.html(R, () => p(o.get(E).type, o.get(c) === o.get(C)), !1, !1), o.reset(Q);
              var ne = o.sibling(Q, 2), D = o.child(ne), X = o.child(D, !0);
              o.reset(D);
              var W = o.sibling(D, 2), oe = o.child(W);
              {
                var Ae = (N) => {
                  var Z = o.text();
                  o.template_effect(
                    (Ce) => o.set_text(Z, `Match: ${Ce ?? ""}%`),
                    [
                      () => Math.round((1 - (typeof o.get(E).score == "number" ? o.get(E).score : 0)) * 100)
                    ],
                    o.derived_safe_equal
                  ), o.append(N, Z);
                }, he = (N) => {
                  var Z = o.text();
                  o.template_effect(
                    (Ce) => o.set_text(Z, Ce),
                    [
                      () => Xe(o.get(E).createdAt, "MMM d, yyyy · p")
                    ],
                    o.derived_safe_equal
                  ), o.append(N, Z);
                };
                o.if(oe, (N) => {
                  i().searchQuery && "score" in o.get(E) ? N(Ae) : N(he, !1);
                });
              }
              o.reset(W), o.reset(ne);
              var gt = o.sibling(ne, 2);
              {
                var mt = (N) => {
                  var Z = wn();
                  o.append(N, Z);
                };
                o.if(gt, (N) => {
                  o.get(c) === o.get(C) && N(mt);
                });
              }
              o.reset(k), o.template_effect(
                (N) => {
                  o.set_attribute(k, "data-index", o.get(C)), o.set_class(k, 1, `group flex items-center px-3 py-2 mx-2 my-0.5 rounded-lg cursor-default transition-colors ${(o.get(c) === o.get(C) ? "bg-blue-500 text-white shadow-sm" : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200") ?? ""}`), o.set_attribute(k, "aria-selected", o.get(c) === o.get(C)), o.set_class(D, 1, `truncate text-[13px] font-medium leading-none ${(o.get(c) === o.get(C) ? "text-white" : "text-gray-900 dark:text-gray-100") ?? ""}`), o.set_text(X, N), o.set_class(W, 1, `truncate text-[11px] leading-none ${(o.get(c) === o.get(C) ? "text-blue-100" : "text-gray-500 dark:text-gray-400") ?? ""}`);
                },
                [() => f(o.get(E))],
                o.derived_safe_equal
              ), o.event("click", k, () => d(o.get(C))), o.event("dblclick", k, () => O.handleItemAction(o.get(E), "paste")), o.append(S, k);
            }), o.append(x, B);
          };
          o.if(M, (x) => {
            o.get(a).length === 0 ? x(_) : x(F, !1);
          });
        }
        o.reset(v), o.bind_this(v, (x) => o.set(u, x), () => o.get(u)), o.append(h, v);
      },
      right: (h, m) => {
        var v = An(), M = o.child(v);
        {
          var _ = (x) => {
            var B = vn(), Y = o.first_child(B), S = o.child(Y);
            o.html(S, () => w(o.get(s)), !1, !1), o.reset(Y);
            var E = o.sibling(Y, 2), C = o.child(E), k = o.child(C), Q = o.child(k, !0);
            o.reset(k);
            var R = o.sibling(k, 2), ne = o.sibling(o.child(R));
            o.reset(R);
            var D = o.sibling(R, 2);
            {
              var X = (W) => {
                var oe = bn(), Ae = o.sibling(o.child(oe));
                o.reset(oe), o.template_effect(() => {
                  var he;
                  return o.set_text(Ae, ` ${((he = o.get(s).content) == null ? void 0 : he.length) || 0} chars`);
                }), o.append(W, oe);
              };
              o.if(D, (W) => {
                o.get(s).type !== "image" && W(X);
              });
            }
            o.reset(C), o.next(2), o.reset(E), o.template_effect(
              (W) => {
                o.set_text(Q, o.get(s).type), o.set_text(ne, ` ${W ?? ""}`);
              },
              [
                () => Xe(o.get(s).createdAt, "PPpp")
              ],
              o.derived_safe_equal
            ), o.append(x, B);
          }, F = (x) => {
            var B = xn();
            o.append(x, B);
          };
          o.if(M, (x) => {
            o.get(s) ? x(_) : x(F, !1);
          });
        }
        o.reset(v), o.append(h, v);
      }
    }
  }), o.pop(), n();
}
function I(r, e, t, n) {
  if (typeof e == "function" ? r !== e || !0 : !e.has(r)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return t === "m" ? n : t === "a" ? n.call(r) : n ? n.value : e.get(r);
}
function we(r, e, t, n, i) {
  if (typeof e == "function" ? r !== e || !0 : !e.has(r)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return e.set(r, t), t;
}
var se, j, ae, pe;
const Ue = "__TAURI_TO_IPC_KEY__";
function ft(r, e = !1) {
  return window.__TAURI_INTERNALS__.transformCallback(r, e);
}
class Cn {
  constructor() {
    this.__TAURI_CHANNEL_MARKER__ = !0, se.set(
      this,
      () => {
      }
      // the id is used as a mechanism to preserve message order
    ), j.set(this, 0), ae.set(this, []), this.id = ft(({ message: e, id: t }) => {
      if (t == I(this, j, "f"))
        for (I(this, se, "f").call(this, e), we(this, j, I(this, j, "f") + 1); I(this, j, "f") in I(this, ae, "f"); ) {
          const n = I(this, ae, "f")[I(this, j, "f")];
          I(this, se, "f").call(this, n), delete I(this, ae, "f")[I(this, j, "f")], we(this, j, I(this, j, "f") + 1);
        }
      else
        I(this, ae, "f")[t] = e;
    });
  }
  set onmessage(e) {
    we(this, se, e);
  }
  get onmessage() {
    return I(this, se, "f");
  }
  [(se = /* @__PURE__ */ new WeakMap(), j = /* @__PURE__ */ new WeakMap(), ae = /* @__PURE__ */ new WeakMap(), Ue)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[Ue]();
  }
}
class _n {
  constructor(e, t, n) {
    this.plugin = e, this.event = t, this.channelId = n;
  }
  async unregister() {
    return L(`plugin:${this.plugin}|remove_listener`, {
      event: this.event,
      channelId: this.channelId
    });
  }
}
async function qn(r, e, t) {
  const n = new Cn();
  return n.onmessage = t, L(`plugin:${r}|registerListener`, { event: e, handler: n }).then(() => new _n(r, e, n.id));
}
async function L(r, e = {}, t) {
  return window.__TAURI_INTERNALS__.invoke(r, e, t);
}
class Xn {
  get rid() {
    return I(this, pe, "f");
  }
  constructor(e) {
    pe.set(this, void 0), we(this, pe, e);
  }
  /**
   * Destroys and cleans up this resource from memory.
   * **You should not call any method on this object anymore and should drop any reference to it.**
   */
  async close() {
    return L("plugin:resources|close", {
      rid: this.rid
    });
  }
}
pe = /* @__PURE__ */ new WeakMap();
var Ke;
(function(r) {
  r.WINDOW_RESIZED = "tauri://resize", r.WINDOW_MOVED = "tauri://move", r.WINDOW_CLOSE_REQUESTED = "tauri://close-requested", r.WINDOW_DESTROYED = "tauri://destroyed", r.WINDOW_FOCUS = "tauri://focus", r.WINDOW_BLUR = "tauri://blur", r.WINDOW_SCALE_FACTOR_CHANGED = "tauri://scale-change", r.WINDOW_THEME_CHANGED = "tauri://theme-changed", r.WINDOW_CREATED = "tauri://window-created", r.WEBVIEW_CREATED = "tauri://webview-created", r.DRAG_ENTER = "tauri://drag-enter", r.DRAG_OVER = "tauri://drag-over", r.DRAG_DROP = "tauri://drag-drop", r.DRAG_LEAVE = "tauri://drag-leave";
})(Ke || (Ke = {}));
async function En(r, e) {
  await L("plugin:event|unlisten", {
    event: r,
    eventId: e
  });
}
async function Mn(r, e, t) {
  var n;
  const i = (n = void 0) !== null && n !== void 0 ? n : { kind: "Any" };
  return L("plugin:event|listen", {
    event: r,
    target: i,
    handler: ft(e)
  }).then((a) => async () => En(r, a));
}
var H;
(function(r) {
  r[r.Trace = 1] = "Trace", r[r.Debug = 2] = "Debug", r[r.Info = 3] = "Info", r[r.Warn = 4] = "Warn", r[r.Error = 5] = "Error";
})(H || (H = {}));
function Sn(r) {
  var e, t;
  if (r)
    if (r.startsWith("Error")) {
      const i = (e = r.split(`
`)[3]) == null ? void 0 : e.trim();
      if (!i)
        return;
      const a = /at\s+(?<functionName>.*?)\s+\((?<fileName>.*?):(?<lineNumber>\d+):(?<columnNumber>\d+)\)/, s = i.match(a);
      if (s) {
        const { functionName: c, fileName: u, lineNumber: l, columnNumber: d } = s.groups;
        return `${c}@${u}:${l}:${d}`;
      } else {
        const c = /at\s+(?<fileName>.*?):(?<lineNumber>\d+):(?<columnNumber>\d+)/, u = i.match(c);
        if (u) {
          const { fileName: l, lineNumber: d, columnNumber: f } = u.groups;
          return `<anonymous>@${l}:${d}:${f}`;
        }
      }
    } else
      return (t = r.split(`
`).map((a) => a.split("@")).filter(([a, s]) => a.length > 0 && s !== "[native code]")[2]) == null ? void 0 : t.filter((a) => a.length > 0).join("@");
}
async function Re(r, e, t) {
  const n = Sn(new Error().stack), { file: i, line: a, keyValues: s } = {};
  await L("plugin:log|log", {
    level: r,
    message: e,
    location: n,
    file: i,
    line: a,
    keyValues: s
  });
}
async function Dn(r, e) {
  await Re(H.Error, r);
}
async function me(r, e) {
  await Re(H.Info, r);
}
async function $n(r, e) {
  await Re(H.Debug, r);
}
async function kn(r) {
  return await Mn("log://log", (e) => {
    const { level: t } = e.payload;
    let { message: n } = e.payload;
    n = n.replace(
      // TODO: Investigate security/detect-unsafe-regex
      // eslint-disable-next-line no-control-regex, security/detect-unsafe-regex
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      ""
    ), r({ message: n, level: t });
  });
}
async function Fn() {
  return await kn(({ level: r, message: e }) => {
    switch (r) {
      case H.Trace:
        console.log(e);
        break;
      case H.Debug:
        console.debug(e);
        break;
      case H.Info:
        console.info(e);
        break;
      case H.Warn:
        console.warn(e);
        break;
      case H.Error:
        console.error(e);
        break;
      default:
        throw new Error(`unknown log level ${r}`);
    }
  });
}
const y = {
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
class In {
  constructor() {
    $(this, "appName", "Asyar");
    $(this, "useColors", !0);
    // Can be toggled for environments without color support
    $(this, "useFrames", !1);
  }
  // Can be toggled for environments without box drawing support
  /**
   * Initialize the logger
   */
  async init(e) {
    await Fn(), e != null && e.disableColors && (this.useColors = !1), e != null && e.disableFrames && (this.useFrames = !1), this.info("Logger initialized");
  }
  /**
   * Create a framed message with colored border
   */
  createFrame(e, t) {
    if (!this.useFrames)
      return e;
    const n = e.split(`
`);
    return n.length === 1 ? this.createSingleLineFrame(e, t) : this.createMultiLineFrame(n, t);
  }
  /**
   * Create a frame for a single line message
   */
  createSingleLineFrame(e, t) {
    const n = e.replace(/\u001b\[\d+m/g, "").length, i = this.useColors ? t : "", a = this.useColors ? y.reset : "", s = `${i}${y.frameTopLeft}${y.frameHorizontal.repeat(
      n + 2
    )}${y.frameTopRight}${a}`, c = `${i}${y.frameBottomLeft}${y.frameHorizontal.repeat(n + 2)}${y.frameBottomRight}${a}`, u = `${i}${y.frameVertical}${a} ${e} ${i}${y.frameVertical}${a}`;
    return `${s}
${u}
${c}`;
  }
  /**
   * Create a frame for a multiline message
   */
  createMultiLineFrame(e, t) {
    const n = Math.max(
      ...e.map((l) => l.replace(/\u001b\[\d+m/g, "").length)
    ), i = this.useColors ? t : "", a = this.useColors ? y.reset : "", s = `${i}${y.frameTopLeft}${y.frameHorizontal.repeat(
      n + 2
    )}${y.frameTopRight}${a}`, c = `${i}${y.frameBottomLeft}${y.frameHorizontal.repeat(n + 2)}${y.frameBottomRight}${a}`, u = e.map((l) => {
      const d = n - l.replace(/\u001b\[\d+m/g, "").length;
      return `${i}${y.frameVertical}${a} ${l}${" ".repeat(
        d
      )} ${i}${y.frameVertical}${a}`;
    });
    return `${s}
${u.join(`
`)}
${c}`;
  }
  /**
   * Format message with timestamp and category
   */
  format(e, t, n, i) {
    const a = (/* @__PURE__ */ new Date()).toLocaleTimeString(), s = t.padEnd(5, " "), c = this.useColors ? `${y.dim}[${a}]${y.reset} ${n}${this.appName}:${s}${y.reset} ${e}` : `[${a}] ${this.appName}:${s} ${e}`;
    return this.createFrame(c, i);
  }
  /**
   * Log informational message
   */
  info(e) {
    const t = this.format(
      e,
      "INFO",
      `${y.bright}${y.green}`,
      y.green
    );
    me(t);
  }
  /**
   * Log error message
   */
  error(e) {
    const t = e instanceof Error ? e.message : e, n = this.format(
      t,
      "ERROR",
      `${y.bright}${y.red}`,
      y.red
    );
    Dn(n);
  }
  /**
   * Log warning message
   */
  warn(e) {
    const t = this.format(
      e,
      "WARN",
      `${y.bright}${y.yellow}`,
      y.yellow
    );
    me(t);
  }
  /**
   * Log debug message
   */
  debug(e) {
    const t = this.format(
      e,
      "DEBUG",
      `${y.cyan}`,
      y.cyan
    );
    $n(t);
  }
  /**
   * Log success message
   */
  success(e) {
    const t = this.format(
      e,
      "OK",
      `${y.bright}${y.green}`,
      y.bgGreen
    );
    me(t);
  }
  /**
   * Log message with custom category and color
   */
  custom(e, t, n, i) {
    const a = this.useColors ? y[n] || y.reset : "", s = this.useColors ? y[i || n] || y.reset : "", c = this.format(
      e,
      t,
      a,
      s
    );
    me(c);
  }
  /**
   * Track extension usage with special formatting
   */
  trackExtensionUsage(e, t, n) {
    const i = (/* @__PURE__ */ new Date()).toISOString(), a = n ? JSON.stringify(n) : "";
    this.info(
      `EXTENSION_TRACKED [${i}] Extension: ${e} | Action: ${t} | ${a}`
    );
  }
}
const b = new In();
class On {
  constructor() {
    $(this, "_isTauri", null);
  }
  /**
   * Detects if the application is running within a Tauri environment.
   */
  get isTauri() {
    return this._isTauri !== null ? this._isTauri : (this._isTauri = typeof window < "u" && window.__TAURI_INTERNALS__ !== void 0, console.log(`[EnvService] Environment detection: isTauri = ${this._isTauri}, window.__TAURI_INTERNALS__ = ${typeof window.__TAURI_INTERNALS__ < "u"}`), this._isTauri);
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
}
const le = new On();
class Bn {
  // private provider: SearchProvider;
  // constructor(provider: SearchProvider) {
  //   this.provider = provider;
  //   console.log(
  //     `SearchService created with provider: ${provider.constructor.name}`
  //   );
  // }
  async performSearch(e) {
    if (le.isBrowser)
      return b.debug(`Browser mode: providing fallback search for "${e}"`), this.getBrowserFallbacks(e);
    try {
      const t = await L("search_items", { query: e });
      return b.debug(`Search results for "${e}": ${t}`), t;
    } catch (t) {
      return b.error(`Search failed: ${t}`), [];
    }
  }
  getBrowserFallbacks(e) {
    const t = [
      {
        objectId: "ext_store",
        name: "Extension Store",
        description: "Browse and install extensions",
        type: "command",
        score: 1,
        category: "extension",
        action: async () => {
          b.info("[SearchService] Action triggered: Navigation to Extension Store");
          const { default: i } = await import("./extensionManager-BOSy5kTU.js");
          i.navigateToView("store/DefaultView");
        }
      },
      {
        objectId: "ext_clipboard",
        name: "Clipboard History",
        description: "View and manage clipboard history",
        type: "command",
        score: 0.9,
        category: "extension",
        action: async () => {
          const { default: i } = await import("./extensionManager-BOSy5kTU.js");
          i.navigateToView("clipboard-history/DefaultView");
        }
      }
    ];
    if (!e) return t;
    const n = e.toLowerCase();
    return t.filter(
      (i) => {
        var a;
        return i.name.toLowerCase().includes(n) || ((a = i.description) == null ? void 0 : a.toLowerCase().includes(n));
      }
    );
  }
  /**
   * Indexes a single item (Application or Command) by calling the Rust backend.
   * Handles updates automatically (Rust's index_item deletes then adds).
   */
  async indexItem(e) {
    if (le.isBrowser) {
      b.debug(`Browser mode: skipping indexing for ${e.name}`);
      return;
    }
    try {
      b.debug(
        `Indexing item category: ${e.category}, name: ${e.name}`
      ), await L("index_item", { item: e });
    } catch (t) {
      b.error(`Failed indexing item ${e.name}: ${t}`);
    }
  }
  /**
   * Deletes an item from the index by its object ID.
   */
  async deleteItem(e) {
    if (!le.isBrowser)
      try {
        b.debug(`Deleting item with objectId: ${e}`), await L("delete_item", { objectId: e });
      } catch (t) {
        b.error(`Failed deleting item ${e}: ${t}`);
      }
  }
  /**
   * Gets all indexed object IDs, optionally filtering by prefix.
   */
  async getIndexedObjectIds(e) {
    if (le.isBrowser) return /* @__PURE__ */ new Set();
    try {
      b.debug(
        `Workspaceing indexed object IDs ${e ? `with prefix "${e}"` : ""}...`
      );
      const t = new Set(
        await L("get_indexed_object_ids")
      );
      if (!e)
        return t;
      const n = /* @__PURE__ */ new Set();
      return t.forEach((i) => {
        i.startsWith(e) && n.add(i);
      }), b.debug(
        `Found ${n.size} IDs with prefix "${e}".`
      ), n;
    } catch (t) {
      return b.error(`Failed to get indexed object IDs: ${t}`), /* @__PURE__ */ new Set();
    }
  }
  // Optional: Add a method to reset the index
  async resetIndex() {
    if (!le.isBrowser)
      try {
        b.info("Requesting search index reset..."), await L("reset_search_index"), b.info("Search index reset successful.");
      } catch (e) {
        b.error(`Failed to reset search index: ${e}`);
      }
  }
}
const Pn = new Bn(), Me = Be(
  /* @__PURE__ */ new Map()
);
class Rn {
  // Store the reference
  constructor() {
    $(this, "commands", /* @__PURE__ */ new Map());
    $(this, "extensionManager", null);
    Me.set(this.commands);
  }
  /**
   * Initialize the service with necessary dependencies.
   * Should be called once during application startup.
   * @param manager - The ExtensionManager instance.
   */
  initialize(e) {
    if (this.extensionManager) {
      b.warn("CommandService already initialized.");
      return;
    }
    this.extensionManager = e, b.debug(
      "CommandService initialized and connected to ExtensionManager."
    );
  }
  /**
   * Register a command with a handler function
   */
  registerCommand(e, t, n) {
    this.commands.set(e, {
      handler: t,
      extensionId: n
    }), b.debug(
      `Registered command: ${e} from extension: ${n}`
    ), Me.set(this.commands);
  }
  /**
   * Unregister a command
   */
  unregisterCommand(e) {
    this.commands.delete(e) ? (Me.set(this.commands), b.debug(`Unregistered command: ${e}`)) : b.warn(
      `Attempted to unregister non-existent command: ${e}`
    );
  }
  /**
   * Execute a registered command
   */
  async executeCommand(e, t) {
    b.debug(`[CommandService] executeCommand called with ID: ${e}`);
    const n = this.commands.get(e);
    if (!n)
      throw new Error(`Command not found: ${e}`);
    b.info(
      `EXTENSION_TRACKED: Executing command: ${e} from extension: ${n.extensionId} with args: ${JSON.stringify(t || {})}`
    );
    try {
      return b.debug(`[CommandService] Found handler for ${e}. Executing...`), await n.handler.execute(t);
    } catch (i) {
      throw b.error(`Error executing command ${e}: ${i}`), i;
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
  getCommandsForExtension(e) {
    return Array.from(this.commands.entries()).filter(([t, n]) => n.extensionId === e).map(([t, n]) => t);
  }
  /**
   * Clear all commands for an extension
   */
  clearCommandsForExtension(e) {
    const t = this.getCommandsForExtension(e);
    for (const n of t)
      this.unregisterCommand(n);
  }
}
const Un = new Rn(), Wn = Be([]), re = class re {
  constructor() {
    $(this, "allActions", /* @__PURE__ */ new Map());
    $(this, "currentContext", T.CORE);
    this.registerBuiltInActions();
  }
  static getInstance() {
    return re.instance || (re.instance = new re()), re.instance;
  }
  /**
   * Set the current action context and optional data (e.g., commandId)
   */
  setContext(e) {
    this.currentContext !== e && (this.currentContext = e, b.debug(`Action context set to: ${e}`), this.updateStore());
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
  registerAction(e) {
    const t = {
      id: e.id,
      label: "title" in e ? e.title : e.label,
      // Handle both interfaces
      icon: e.icon,
      description: e.description,
      extensionId: "extensionId" in e ? e.extensionId : void 0,
      category: e.category,
      // Use the context provided, default if necessary, ensure it's the enum type
      context: e.context || T.EXTENSION_VIEW,
      execute: e.execute,
      disabled: "disabled" in e ? e.disabled : void 0
    };
    this.allActions.set(t.id, t), b.debug(
      `Registered action: ${t.id} from ${t.extensionId || "core"}, context: ${t.context || "default"}`
    ), this.updateStore();
  }
  /**
   * Unregister an action
   */
  unregisterAction(e) {
    this.allActions.delete(e) ? (b.debug(`Unregistered action: ${e}`), this.updateStore()) : b.warn(
      `Attempted to unregister non-existent action: ${e}`
    );
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
    const e = Array.from(this.allActions.values()).filter(
      this.filterActionsByContext.bind(this)
    );
    return b.debug(
      `Filtering actions for context: ${this.currentContext}. Found ${e.length} actions.`
    ), e;
  }
  /**
   * Get actions based on a specific context (implements IActionService method)
   * Note: This might not be ideal if commandId is needed for COMMAND_RESULT.
   * Consider if this method is still necessary or if actionStore is sufficient.
   */
  getActions(e) {
    const t = e || this.currentContext;
    return t === T.COMMAND_RESULT && b.warn(
      "getActions(COMMAND_RESULT) called directly; may not return correct results. Prefer using the actionStore after setting context with commandId."
    ), Array.from(this.allActions.values()).filter((n) => n.context === t).map((n) => ({
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
  filterActionsByContext(e) {
    return e.context === this.currentContext || e.context === T.GLOBAL && (this.currentContext === T.CORE || this.currentContext === T.EXTENSION_VIEW) ? !0 : this.currentContext === T.CORE && e.context === T.CORE ? Array.from(this.allActions.values()).filter(
      (i) => i.context === this.currentContext && i.context !== T.CORE && i.context !== T.GLOBAL
    ).length === 0 : !1;
  }
  /**
   * Execute an action by ID
   */
  async executeAction(e) {
    const t = this.allActions.get(e);
    if (!t)
      throw new Error(`Action not found: ${e}`);
    b.info(
      `Executing action: ${e} from ${t.extensionId || "core"}`
    );
    try {
      if (typeof t.execute == "function")
        await t.execute();
      else
        throw new Error(`Action execute is not a function: ${e}`);
    } catch (n) {
      throw b.error(`Error executing action ${e}: ${n}`), n;
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
      // Consider using a consistent icon system if available
      description: "Configure application settings",
      context: T.CORE,
      // Explicitly CORE context
      execute: async () => {
        b.info("Executing built-in action: Open Settings");
        try {
          await L("plugin:window|show", { label: "settings" });
        } catch (e) {
          b.error(`Failed to open settings window: ${e}`);
        }
      }
    }), this.registerAction({
      // Use registerAction for consistency
      id: "reset_search",
      label: "Reset Search Index",
      icon: "🔄",
      // Example icon
      description: "Reset the search index",
      context: T.CORE,
      execute: async () => {
        b.info("Executing built-in action: Reset Search Index"), await Pn.resetIndex();
      }
    });
  }
  /**
   * Update the action store with currently relevant actions based on context
   */
  updateStore() {
    const e = this.getFilteredActions();
    Wn.set(e);
  }
};
$(re, "instance");
let Oe = re;
const Je = Oe.getInstance(), Nn = [
  {
    id: "clipboard-history",
    title: "Clipboard History",
    subtitle: "View and manage your clipboard history",
    keywords: "clipboard copy paste history"
  }
], Tn = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["title", "subtitle", "keywords"]
};
new G(Nn, Tn);
class Ln {
  constructor() {
    $(this, "onUnload");
    $(this, "logService");
    $(this, "extensionManager");
    $(this, "clipboardService");
    $(this, "inView", !1);
    $(this, "context");
    $(this, "handleKeydownBound", (e) => this.handleKeydown(e));
  }
  async initialize(e) {
    var t, n;
    try {
      if (this.context = e, this.logService = e.getService("LogService"), this.extensionManager = e.getService("ExtensionManager"), this.clipboardService = e.getService(
        "ClipboardHistoryService"
      ), !this.logService || !this.extensionManager || !this.clipboardService) {
        console.error(
          "Failed to initialize required services for Clipboard History"
        ), (t = this.logService) == null || t.error(
          "Failed to initialize required services for Clipboard History"
        );
        return;
      }
      O.initializeServices(e), this.logService.info(
        "Clipboard History extension initialized with services"
      );
    } catch (i) {
      console.error("Clipboard History initialization failed:", i), (n = this.logService) == null || n.error(
        `Clipboard History initialization failed: ${i}`
      );
    }
  }
  async executeCommand(e, t) {
    var n, i, a;
    switch ((n = this.logService) == null || n.info(`Executing clipboard command: ${e}`), e) {
      case "show-clipboard":
        return await this.refreshClipboardData(), (i = this.extensionManager) == null || i.navigateToView(
          "clipboard-history/DefaultView"
        ), this.registerViewActions(), {
          type: "view",
          viewPath: "clipboard-history/DefaultView"
        };
      default:
        throw (a = this.logService) == null || a.error(`Received unknown command ID: ${e}`), new Error(`Unknown command: ${e}`);
    }
  }
  // Called when this extension's view is activated
  async viewActivated(e) {
    var t, n;
    this.inView = !0, (t = this.logService) == null || t.debug(`Clipboard History view activated: ${e}`), window.addEventListener("keydown", this.handleKeydownBound), (n = this.extensionManager) == null || n.setActiveViewActionLabel("Paste"), await this.refreshClipboardData();
  }
  handleKeydown(e) {
    if (!this.inView) return;
    const t = Ze(O);
    t.items.length && (e.key === "ArrowUp" || e.key === "ArrowDown" ? (e.preventDefault(), e.stopPropagation(), O.moveSelection(e.key === "ArrowUp" ? "up" : "down")) : e.key === "Enter" && t.selectedItem && (e.preventDefault(), e.stopPropagation(), O.handleItemAction(t.selectedItem, "paste")));
  }
  // Helper method to register view-specific actions
  registerViewActions() {
    var t, n;
    if (!this.clipboardService) {
      (t = this.logService) == null || t.warn(
        "ClipboardService not available, cannot register view actions."
      );
      return;
    }
    (n = this.logService) == null || n.debug("Registering clipboard view actions...");
    const e = {
      id: "clipboard-history:clipboard-reset-history",
      title: "Clear Clipboard History",
      description: "Remove all non-favorite clipboard items",
      icon: "🗑️",
      extensionId: "clipboard-history",
      category: "clipboard-action",
      // Context is implicitly EXTENSION_VIEW when registered
      execute: async () => {
        var i, a, s, c;
        try {
          confirm(
            "Are you sure you want to clear all non-favorite clipboard items?"
          ) && (await ((i = this.clipboardService) == null ? void 0 : i.clearNonFavorites()) ? (a = this.logService) == null || a.info("Non-favorite clipboard history cleared") : (s = this.logService) == null || s.warn(
            "Clearing non-favorite clipboard history reported failure."
          ), await this.refreshClipboardData());
        } catch (u) {
          (c = this.logService) == null || c.error(`Failed to clear clipboard history: ${u}`);
        }
      }
    };
    Je.registerAction(e);
  }
  // Helper method to unregister view-specific actions
  unregisterViewActions() {
    var e;
    (e = this.logService) == null || e.debug("Unregistering clipboard view actions..."), Je.unregisterAction("clipboard-history:clipboard-reset-history");
  }
  // Called when this extension's view is deactivated
  async viewDeactivated(e) {
    var t, n;
    this.unregisterViewActions(), (t = this.extensionManager) == null || t.setActiveViewActionLabel(null), this.inView = !1, (n = this.logService) == null || n.debug(`Clipboard History view deactivated: ${e}`);
  }
  async onViewSearch(e) {
    O.setSearch(e);
  }
  async refreshClipboardData() {
    var e, t;
    if (this.clipboardService) {
      O.setLoading(!0);
      try {
        const n = await this.clipboardService.getRecentItems(100);
        O.setItems(n || []);
      } catch (n) {
        (e = this.logService) == null || e.error(`Failed to load clipboard data: ${n}`), O.setError(`Failed to load clipboard data: ${n}`);
      } finally {
        O.setLoading(!1);
      }
    } else
      (t = this.logService) == null || t.warn(
        "ClipboardService not available in refreshClipboardData"
      );
  }
  async activate() {
    var e;
    (e = this.logService) == null || e.info("Clipboard History extension activated");
  }
  async deactivate() {
    var e;
    this.inView && this.unregisterViewActions(), (e = this.logService) == null || e.info("Clipboard History extension deactivated");
  }
}
const Kn = new Ln();
export {
  Cn as C,
  Qn as D,
  Xn as R,
  b as a,
  qn as b,
  Je as c,
  Un as d,
  le as e,
  Kn as f,
  L as i,
  Mn as l,
  Pn as s
};
