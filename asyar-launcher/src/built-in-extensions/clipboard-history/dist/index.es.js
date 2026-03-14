var Xe = Object.defineProperty;
var Ge = (r, e, t) => e in r ? Xe(r, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : r[e] = t;
var N = (r, e, t) => Ge(r, typeof e != "symbol" ? e + "" : e, t);
import { writable as Ke, get as Oe } from "svelte/store";
import "svelte/internal/disclose-version";
import "svelte/internal/flags/legacy";
import * as i from "svelte/internal/client";
import { onMount as Je, tick as Ue } from "svelte";
function Y(r) {
  return Array.isArray ? Array.isArray(r) : We(r) === "[object Array]";
}
function Ze(r) {
  if (typeof r == "string")
    return r;
  let e = r + "";
  return e == "0" && 1 / r == -1 / 0 ? "-0" : e;
}
function et(r) {
  return r == null ? "" : Ze(r);
}
function T(r) {
  return typeof r == "string";
}
function Be(r) {
  return typeof r == "number";
}
function tt(r) {
  return r === !0 || r === !1 || rt(r) && We(r) == "[object Boolean]";
}
function Ie(r) {
  return typeof r == "object";
}
function rt(r) {
  return Ie(r) && r !== null;
}
function P(r) {
  return r != null;
}
function le(r) {
  return !r.trim().length;
}
function We(r) {
  return r == null ? r === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(r);
}
const nt = "Incorrect 'index' type", at = (r) => `Invalid value for key ${r}`, it = (r) => `Pattern length exceeds max of ${r}.`, st = (r) => `Missing ${r} property in key`, ot = (r) => `Property 'weight' in key '${r}' must be a positive integer`, ve = Object.prototype.hasOwnProperty;
class ct {
  constructor(e) {
    this._keys = [], this._keyMap = {};
    let t = 0;
    e.forEach((n) => {
      let a = Le(n);
      this._keys.push(a), this._keyMap[a.id] = a, t += a.weight;
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
function Le(r) {
  let e = null, t = null, n = null, a = 1, o = null;
  if (T(r) || Y(r))
    n = r, e = be(r), t = he(r);
  else {
    if (!ve.call(r, "name"))
      throw new Error(st("name"));
    const s = r.name;
    if (n = s, ve.call(r, "weight") && (a = r.weight, a <= 0))
      throw new Error(ot(s));
    e = be(s), t = he(s), o = r.getFn;
  }
  return { path: e, id: t, weight: a, src: n, getFn: o };
}
function be(r) {
  return Y(r) ? r : r.split(".");
}
function he(r) {
  return Y(r) ? r.join(".") : r;
}
function ut(r, e) {
  let t = [], n = !1;
  const a = (o, s, c) => {
    if (P(o))
      if (!s[c])
        t.push(o);
      else {
        let u = s[c];
        const l = o[u];
        if (!P(l))
          return;
        if (c === s.length - 1 && (T(l) || Be(l) || tt(l)))
          t.push(et(l));
        else if (Y(l)) {
          n = !0;
          for (let d = 0, f = l.length; d < f; d += 1)
            a(l[d], s, c + 1);
        } else s.length && a(l, s, c + 1);
      }
  };
  return a(r, T(e) ? e.split(".") : e, 0), n ? t : t[0];
}
const lt = {
  // Whether the matches should be included in the result set. When `true`, each record in the result
  // set will include the indices of the matched characters.
  // These can consequently be used for highlighting purposes.
  includeMatches: !1,
  // When `true`, the matching function will continue to the end of a search pattern even if
  // a perfect match has already been located in the string.
  findAllMatches: !1,
  // Minimum number of characters that must be matched before a result is considered a match
  minMatchCharLength: 1
}, dt = {
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
}, ht = {
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
}, ft = {
  // When `true`, it enables the use of unix-like search commands
  useExtendedSearch: !1,
  // The get function to use when fetching an object's properties.
  // The default will search nested paths *ie foo.bar.baz*
  getFn: ut,
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
  ...dt,
  ...lt,
  ...ht,
  ...ft
};
const gt = /[^ ]+/g;
function mt(r = 1, e = 3) {
  const t = /* @__PURE__ */ new Map(), n = Math.pow(10, e);
  return {
    get(a) {
      const o = a.match(gt).length;
      if (t.has(o))
        return t.get(o);
      const s = 1 / Math.pow(o, 0.5 * r), c = parseFloat(Math.round(s * n) / n);
      return t.set(o, c), c;
    },
    clear() {
      t.clear();
    }
  };
}
class pe {
  constructor({
    getFn: e = g.getFn,
    fieldNormWeight: t = g.fieldNormWeight
  } = {}) {
    this.norm = mt(t, 3), this.getFn = e, this.isCreated = !1, this.setIndexRecords();
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
    this.isCreated || !this.docs.length || (this.isCreated = !0, T(this.docs[0]) ? this.docs.forEach((e, t) => {
      this._addString(e, t);
    }) : this.docs.forEach((e, t) => {
      this._addObject(e, t);
    }), this.norm.clear());
  }
  // Adds a doc to the end of the index
  add(e) {
    const t = this.size();
    T(e) ? this._addString(e, t) : this._addObject(e, t);
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
    if (!P(e) || le(e))
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
    this.keys.forEach((a, o) => {
      let s = a.getFn ? a.getFn(e) : this.getFn(e, a.path);
      if (P(s)) {
        if (Y(s)) {
          let c = [];
          const u = [{ nestedArrIndex: -1, value: s }];
          for (; u.length; ) {
            const { nestedArrIndex: l, value: d } = u.pop();
            if (P(d))
              if (T(d) && !le(d)) {
                let f = {
                  v: d,
                  i: l,
                  n: this.norm.get(d)
                };
                c.push(f);
              } else Y(d) && d.forEach((f, y) => {
                u.push({
                  nestedArrIndex: y,
                  value: f
                });
              });
          }
          n.$[o] = c;
        } else if (T(s) && !le(s)) {
          let c = {
            v: s,
            n: this.norm.get(s)
          };
          n.$[o] = c;
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
function Te(r, e, { getFn: t = g.getFn, fieldNormWeight: n = g.fieldNormWeight } = {}) {
  const a = new pe({ getFn: t, fieldNormWeight: n });
  return a.setKeys(r.map(Le)), a.setSources(e), a.create(), a;
}
function wt(r, { getFn: e = g.getFn, fieldNormWeight: t = g.fieldNormWeight } = {}) {
  const { keys: n, records: a } = r, o = new pe({ getFn: e, fieldNormWeight: t });
  return o.setKeys(n), o.setIndexRecords(a), o;
}
function re(r, {
  errors: e = 0,
  currentLocation: t = 0,
  expectedLocation: n = 0,
  distance: a = g.distance,
  ignoreLocation: o = g.ignoreLocation
} = {}) {
  const s = e / r.length;
  if (o)
    return s;
  const c = Math.abs(n - t);
  return a ? s + c / a : c ? 1 : s;
}
function yt(r = [], e = g.minMatchCharLength) {
  let t = [], n = -1, a = -1, o = 0;
  for (let s = r.length; o < s; o += 1) {
    let c = r[o];
    c && n === -1 ? n = o : !c && n !== -1 && (a = o - 1, a - n + 1 >= e && t.push([n, a]), n = -1);
  }
  return r[o - 1] && o - n >= e && t.push([n, o - 1]), t;
}
const X = 32;
function pt(r, e, t, {
  location: n = g.location,
  distance: a = g.distance,
  threshold: o = g.threshold,
  findAllMatches: s = g.findAllMatches,
  minMatchCharLength: c = g.minMatchCharLength,
  includeMatches: u = g.includeMatches,
  ignoreLocation: l = g.ignoreLocation
} = {}) {
  if (e.length > X)
    throw new Error(it(X));
  const d = e.length, f = r.length, y = Math.max(0, Math.min(n, f));
  let w = o, h = y;
  const m = c > 1 || u, p = m ? Array(f) : [];
  let C;
  for (; (C = r.indexOf(e, h)) > -1; ) {
    let E = re(e, {
      currentLocation: C,
      expectedLocation: y,
      distance: a,
      ignoreLocation: l
    });
    if (w = Math.min(E, w), h = C + d, m) {
      let M = 0;
      for (; M < d; )
        p[C + M] = 1, M += 1;
    }
  }
  h = -1;
  let A = [], D = 1, v = d + f;
  const F = 1 << d - 1;
  for (let E = 0; E < d; E += 1) {
    let M = 0, x = v;
    for (; M < x; )
      re(e, {
        errors: E,
        currentLocation: y + x,
        expectedLocation: y,
        distance: a,
        ignoreLocation: l
      }) <= w ? M = x : v = x, x = Math.floor((v - M) / 2 + M);
    v = x;
    let S = Math.max(1, y - x + 1), R = s ? f : Math.min(y + x, f) + d, O = Array(R + 2);
    O[R + 1] = (1 << E) - 1;
    for (let k = R; k >= S; k -= 1) {
      let j = k - 1, B = t[r.charAt(j)];
      if (m && (p[j] = +!!B), O[k] = (O[k + 1] << 1 | 1) & B, E && (O[k] |= (A[k + 1] | A[k]) << 1 | 1 | A[k + 1]), O[k] & F && (D = re(e, {
        errors: E,
        currentLocation: j,
        expectedLocation: y,
        distance: a,
        ignoreLocation: l
      }), D <= w)) {
        if (w = D, h = j, h <= y)
          break;
        S = Math.max(1, 2 * y - h);
      }
    }
    if (re(e, {
      errors: E + 1,
      currentLocation: y,
      expectedLocation: y,
      distance: a,
      ignoreLocation: l
    }) > w)
      break;
    A = O;
  }
  const W = {
    isMatch: h >= 0,
    // Count exact matches (those with a score of 0) to be "almost" exact
    score: Math.max(1e-3, D)
  };
  if (m) {
    const E = yt(p, c);
    E.length ? u && (W.indices = E) : W.isMatch = !1;
  }
  return W;
}
function vt(r) {
  let e = {};
  for (let t = 0, n = r.length; t < n; t += 1) {
    const a = r.charAt(t);
    e[a] = (e[a] || 0) | 1 << n - t - 1;
  }
  return e;
}
const ae = String.prototype.normalize ? (r) => r.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "") : (r) => r;
class $e {
  constructor(e, {
    location: t = g.location,
    threshold: n = g.threshold,
    distance: a = g.distance,
    includeMatches: o = g.includeMatches,
    findAllMatches: s = g.findAllMatches,
    minMatchCharLength: c = g.minMatchCharLength,
    isCaseSensitive: u = g.isCaseSensitive,
    ignoreDiacritics: l = g.ignoreDiacritics,
    ignoreLocation: d = g.ignoreLocation
  } = {}) {
    if (this.options = {
      location: t,
      threshold: n,
      distance: a,
      includeMatches: o,
      findAllMatches: s,
      minMatchCharLength: c,
      isCaseSensitive: u,
      ignoreDiacritics: l,
      ignoreLocation: d
    }, e = u ? e : e.toLowerCase(), e = l ? ae(e) : e, this.pattern = e, this.chunks = [], !this.pattern.length)
      return;
    const f = (w, h) => {
      this.chunks.push({
        pattern: w,
        alphabet: vt(w),
        startIndex: h
      });
    }, y = this.pattern.length;
    if (y > X) {
      let w = 0;
      const h = y % X, m = y - h;
      for (; w < m; )
        f(this.pattern.substr(w, X), w), w += X;
      if (h) {
        const p = y - X;
        f(this.pattern.substr(p), p);
      }
    } else
      f(this.pattern, 0);
  }
  searchIn(e) {
    const { isCaseSensitive: t, ignoreDiacritics: n, includeMatches: a } = this.options;
    if (e = t ? e : e.toLowerCase(), e = n ? ae(e) : e, this.pattern === e) {
      let m = {
        isMatch: !0,
        score: 0
      };
      return a && (m.indices = [[0, e.length - 1]]), m;
    }
    const {
      location: o,
      distance: s,
      threshold: c,
      findAllMatches: u,
      minMatchCharLength: l,
      ignoreLocation: d
    } = this.options;
    let f = [], y = 0, w = !1;
    this.chunks.forEach(({ pattern: m, alphabet: p, startIndex: C }) => {
      const { isMatch: A, score: D, indices: v } = pt(e, m, p, {
        location: o + C,
        distance: s,
        threshold: c,
        findAllMatches: u,
        minMatchCharLength: l,
        includeMatches: a,
        ignoreLocation: d
      });
      A && (w = !0), y += D, A && v && (f = [...f, ...v]);
    });
    let h = {
      isMatch: w,
      score: w ? y / this.chunks.length : 1
    };
    return w && a && (h.indices = f), h;
  }
}
class z {
  constructor(e) {
    this.pattern = e;
  }
  static isMultiMatch(e) {
    return xe(e, this.multiRegex);
  }
  static isSingleMatch(e) {
    return xe(e, this.singleRegex);
  }
  search() {
  }
}
function xe(r, e) {
  const t = r.match(e);
  return t ? t[1] : null;
}
class bt extends z {
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
class xt extends z {
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
class At extends z {
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
class Mt extends z {
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
class Ct extends z {
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
class Et extends z {
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
class Re extends z {
  constructor(e, {
    location: t = g.location,
    threshold: n = g.threshold,
    distance: a = g.distance,
    includeMatches: o = g.includeMatches,
    findAllMatches: s = g.findAllMatches,
    minMatchCharLength: c = g.minMatchCharLength,
    isCaseSensitive: u = g.isCaseSensitive,
    ignoreDiacritics: l = g.ignoreDiacritics,
    ignoreLocation: d = g.ignoreLocation
  } = {}) {
    super(e), this._bitapSearch = new $e(e, {
      location: t,
      threshold: n,
      distance: a,
      includeMatches: o,
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
class Ne extends z {
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
    const a = [], o = this.pattern.length;
    for (; (n = e.indexOf(this.pattern, t)) > -1; )
      t = n + o, a.push([n, t - 1]);
    const s = !!a.length;
    return {
      isMatch: s,
      score: s ? 0 : 1,
      indices: a
    };
  }
}
const fe = [
  bt,
  Ne,
  At,
  Mt,
  Et,
  Ct,
  xt,
  Re
], Ae = fe.length, kt = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/, St = "|";
function Dt(r, e = {}) {
  return r.split(St).map((t) => {
    let n = t.trim().split(kt).filter((o) => o && !!o.trim()), a = [];
    for (let o = 0, s = n.length; o < s; o += 1) {
      const c = n[o];
      let u = !1, l = -1;
      for (; !u && ++l < Ae; ) {
        const d = fe[l];
        let f = d.isMultiMatch(c);
        f && (a.push(new d(f, e)), u = !0);
      }
      if (!u)
        for (l = -1; ++l < Ae; ) {
          const d = fe[l];
          let f = d.isSingleMatch(c);
          if (f) {
            a.push(new d(f, e));
            break;
          }
        }
    }
    return a;
  });
}
const _t = /* @__PURE__ */ new Set([Re.type, Ne.type]);
class Ft {
  constructor(e, {
    isCaseSensitive: t = g.isCaseSensitive,
    ignoreDiacritics: n = g.ignoreDiacritics,
    includeMatches: a = g.includeMatches,
    minMatchCharLength: o = g.minMatchCharLength,
    ignoreLocation: s = g.ignoreLocation,
    findAllMatches: c = g.findAllMatches,
    location: u = g.location,
    threshold: l = g.threshold,
    distance: d = g.distance
  } = {}) {
    this.query = null, this.options = {
      isCaseSensitive: t,
      ignoreDiacritics: n,
      includeMatches: a,
      minMatchCharLength: o,
      findAllMatches: c,
      ignoreLocation: s,
      location: u,
      threshold: l,
      distance: d
    }, e = t ? e : e.toLowerCase(), e = n ? ae(e) : e, this.pattern = e, this.query = Dt(this.pattern, this.options);
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
    const { includeMatches: n, isCaseSensitive: a, ignoreDiacritics: o } = this.options;
    e = a ? e : e.toLowerCase(), e = o ? ae(e) : e;
    let s = 0, c = [], u = 0;
    for (let l = 0, d = t.length; l < d; l += 1) {
      const f = t[l];
      c.length = 0, s = 0;
      for (let y = 0, w = f.length; y < w; y += 1) {
        const h = f[y], { isMatch: m, indices: p, score: C } = h.search(e);
        if (m) {
          if (s += 1, u += C, n) {
            const A = h.constructor.type;
            _t.has(A) ? c = [...c, ...p] : c.push(p);
          }
        } else {
          u = 0, s = 0, c.length = 0;
          break;
        }
      }
      if (s) {
        let y = {
          isMatch: !0,
          score: u / s
        };
        return n && (y.indices = c), y;
      }
    }
    return {
      isMatch: !1,
      score: 1
    };
  }
}
const ge = [];
function Pt(...r) {
  ge.push(...r);
}
function me(r, e) {
  for (let t = 0, n = ge.length; t < n; t += 1) {
    let a = ge[t];
    if (a.condition(r, e))
      return new a(r, e);
  }
  return new $e(r, e);
}
const ie = {
  AND: "$and",
  OR: "$or"
}, we = {
  PATH: "$path",
  PATTERN: "$val"
}, ye = (r) => !!(r[ie.AND] || r[ie.OR]), Ot = (r) => !!r[we.PATH], Bt = (r) => !Y(r) && Ie(r) && !ye(r), Me = (r) => ({
  [ie.AND]: Object.keys(r).map((e) => ({
    [e]: r[e]
  }))
});
function Ye(r, e, { auto: t = !0 } = {}) {
  const n = (a) => {
    let o = Object.keys(a);
    const s = Ot(a);
    if (!s && o.length > 1 && !ye(a))
      return n(Me(a));
    if (Bt(a)) {
      const u = s ? a[we.PATH] : o[0], l = s ? a[we.PATTERN] : a[u];
      if (!T(l))
        throw new Error(at(u));
      const d = {
        keyId: he(u),
        pattern: l
      };
      return t && (d.searcher = me(l, e)), d;
    }
    let c = {
      children: [],
      operator: o[0]
    };
    return o.forEach((u) => {
      const l = a[u];
      Y(l) && l.forEach((d) => {
        c.children.push(n(d));
      });
    }), c;
  };
  return ye(r) || (r = Me(r)), n(r);
}
function It(r, { ignoreFieldNorm: e = g.ignoreFieldNorm }) {
  r.forEach((t) => {
    let n = 1;
    t.matches.forEach(({ key: a, norm: o, score: s }) => {
      const c = a ? a.weight : null;
      n *= Math.pow(
        s === 0 && c ? Number.EPSILON : s,
        (c || 1) * (e ? 1 : o)
      );
    }), t.score = n;
  });
}
function Wt(r, e) {
  const t = r.matches;
  e.matches = [], P(t) && t.forEach((n) => {
    if (!P(n.indices) || !n.indices.length)
      return;
    const { indices: a, value: o } = n;
    let s = {
      indices: a,
      value: o
    };
    n.key && (s.key = n.key.src), n.idx > -1 && (s.refIndex = n.idx), e.matches.push(s);
  });
}
function Lt(r, e) {
  e.score = r.score;
}
function Tt(r, e, {
  includeMatches: t = g.includeMatches,
  includeScore: n = g.includeScore
} = {}) {
  const a = [];
  return t && a.push(Wt), n && a.push(Lt), r.map((o) => {
    const { idx: s } = o, c = {
      item: e[s],
      refIndex: s
    };
    return a.length && a.forEach((u) => {
      u(o, c);
    }), c;
  });
}
class $ {
  constructor(e, t = {}, n) {
    this.options = { ...g, ...t }, this.options.useExtendedSearch, this._keyStore = new ct(this.options.keys), this.setCollection(e, n);
  }
  setCollection(e, t) {
    if (this._docs = e, t && !(t instanceof pe))
      throw new Error(nt);
    this._myIndex = t || Te(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
  }
  add(e) {
    P(e) && (this._docs.push(e), this._myIndex.add(e));
  }
  remove(e = () => !1) {
    const t = [];
    for (let n = 0, a = this._docs.length; n < a; n += 1) {
      const o = this._docs[n];
      e(o, n) && (this.removeAt(n), n -= 1, a -= 1, t.push(o));
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
      includeScore: a,
      shouldSort: o,
      sortFn: s,
      ignoreFieldNorm: c
    } = this.options;
    let u = T(e) ? T(this._docs[0]) ? this._searchStringList(e) : this._searchObjectList(e) : this._searchLogical(e);
    return It(u, { ignoreFieldNorm: c }), o && u.sort(s), Be(t) && t > -1 && (u = u.slice(0, t)), Tt(u, this._docs, {
      includeMatches: n,
      includeScore: a
    });
  }
  _searchStringList(e) {
    const t = me(e, this.options), { records: n } = this._myIndex, a = [];
    return n.forEach(({ v: o, i: s, n: c }) => {
      if (!P(o))
        return;
      const { isMatch: u, score: l, indices: d } = t.searchIn(o);
      u && a.push({
        item: o,
        idx: s,
        matches: [{ score: l, value: o, norm: c, indices: d }]
      });
    }), a;
  }
  _searchLogical(e) {
    const t = Ye(e, this.options), n = (c, u, l) => {
      if (!c.children) {
        const { keyId: f, searcher: y } = c, w = this._findMatches({
          key: this._keyStore.get(f),
          value: this._myIndex.getValueForItemAtKeyId(u, f),
          searcher: y
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
      for (let f = 0, y = c.children.length; f < y; f += 1) {
        const w = c.children[f], h = n(w, u, l);
        if (h.length)
          d.push(...h);
        else if (c.operator === ie.AND)
          return [];
      }
      return d;
    }, a = this._myIndex.records, o = {}, s = [];
    return a.forEach(({ $: c, i: u }) => {
      if (P(c)) {
        let l = n(t, c, u);
        l.length && (o[u] || (o[u] = { idx: u, item: c, matches: [] }, s.push(o[u])), l.forEach(({ matches: d }) => {
          o[u].matches.push(...d);
        }));
      }
    }), s;
  }
  _searchObjectList(e) {
    const t = me(e, this.options), { keys: n, records: a } = this._myIndex, o = [];
    return a.forEach(({ $: s, i: c }) => {
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
      }), u.length && o.push({
        idx: c,
        item: s,
        matches: u
      });
    }), o;
  }
  _findMatches({ key: e, value: t, searcher: n }) {
    if (!P(t))
      return [];
    let a = [];
    if (Y(t))
      t.forEach(({ v: o, i: s, n: c }) => {
        if (!P(o))
          return;
        const { isMatch: u, score: l, indices: d } = n.searchIn(o);
        u && a.push({
          score: l,
          key: e,
          value: o,
          idx: s,
          norm: c,
          indices: d
        });
      });
    else {
      const { v: o, n: s } = t, { isMatch: c, score: u, indices: l } = n.searchIn(o);
      c && a.push({ score: u, key: e, value: o, norm: s, indices: l });
    }
    return a;
  }
}
$.version = "7.1.0";
$.createIndex = Te;
$.parseIndex = wt;
$.config = g;
$.parseQuery = Ye;
Pt(Ft);
const ne = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["content"]
};
function $t() {
  const { subscribe: r, set: e, update: t } = Ke({
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
  let n, a;
  function o(s) {
    n = s.getService(
      "ClipboardHistoryService"
    ), a = s.getService("LogService");
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
      fuseInstance: new $(s, ne)
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
        l.fuseInstance ? (f = l.fuseInstance, f.setCollection(s)) : f = new $(s, ne), u = f.search(c).map((w) => ({
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
        fuseInstance: new $(s, ne)
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
    initializeServices: o,
    // Expose clipboardService methods through the state store
    async clearNonFavorites() {
      if (!n)
        return a == null || a.error("Clipboard service not initialized in clearNonFavorites"), !1;
      try {
        return await n.clearNonFavorites();
      } catch (s) {
        return a == null || a.error(`Error clearing non-favorites: ${s}`), !1;
      }
    },
    async toggleFavorite(s) {
      if (!n)
        return a == null || a.error("Clipboard service not initialized in toggleFavorite"), !1;
      try {
        return await n.toggleItemFavorite(s);
      } catch (c) {
        return a == null || a.error(`Error toggling favorite for ${s}: ${c}`), !1;
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
              const l = Oe({ subscribe: r }).items.findIndex((d) => d.id === s.id);
              l >= 0 && this.setSelectedItem(l);
              break;
          }
        } catch (u) {
          a == null || a.error(`Failed to handle item action: ${u}`);
        }
    },
    // Renamed from hideWindow for clarity, calls service method
    async hidePanel() {
      if (!n) {
        a == null || a.error("Clipboard service not initialized in hidePanel");
        return;
      }
      try {
        await n.hideWindow();
      } catch (s) {
        a == null || a.error(`Error hiding window: ${s}`);
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
            fuseInstance: new $(s, ne)
            // Update fuse instance too
          }));
        } else
          a == null || a.warn("Clipboard service not available in refreshHistory");
      } catch (s) {
        a == null || a.error(`Failed to refresh clipboard history: ${s}`), t((c) => ({
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
const _ = $t(), je = 6048e5, Rt = 864e5, Ce = Symbol.for("constructDateFrom");
function V(r, e) {
  return typeof r == "function" ? r(e) : r && typeof r == "object" && Ce in r ? r[Ce](e) : r instanceof Date ? new r.constructor(e) : new Date(e);
}
function L(r, e) {
  return V(e || r, r);
}
let Nt = {};
function oe() {
  return Nt;
}
function ee(r, e) {
  var c, u, l, d;
  const t = oe(), n = (e == null ? void 0 : e.weekStartsOn) ?? ((u = (c = e == null ? void 0 : e.locale) == null ? void 0 : c.options) == null ? void 0 : u.weekStartsOn) ?? t.weekStartsOn ?? ((d = (l = t.locale) == null ? void 0 : l.options) == null ? void 0 : d.weekStartsOn) ?? 0, a = L(r, e == null ? void 0 : e.in), o = a.getDay(), s = (o < n ? 7 : 0) + o - n;
  return a.setDate(a.getDate() - s), a.setHours(0, 0, 0, 0), a;
}
function se(r, e) {
  return ee(r, { ...e, weekStartsOn: 1 });
}
function He(r, e) {
  const t = L(r, e == null ? void 0 : e.in), n = t.getFullYear(), a = V(t, 0);
  a.setFullYear(n + 1, 0, 4), a.setHours(0, 0, 0, 0);
  const o = se(a), s = V(t, 0);
  s.setFullYear(n, 0, 4), s.setHours(0, 0, 0, 0);
  const c = se(s);
  return t.getTime() >= o.getTime() ? n + 1 : t.getTime() >= c.getTime() ? n : n - 1;
}
function Ee(r) {
  const e = L(r), t = new Date(
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
function Yt(r, ...e) {
  const t = V.bind(
    null,
    e.find((n) => typeof n == "object")
  );
  return e.map(t);
}
function ke(r, e) {
  const t = L(r, e == null ? void 0 : e.in);
  return t.setHours(0, 0, 0, 0), t;
}
function jt(r, e, t) {
  const [n, a] = Yt(
    t == null ? void 0 : t.in,
    r,
    e
  ), o = ke(n), s = ke(a), c = +o - Ee(o), u = +s - Ee(s);
  return Math.round((c - u) / Rt);
}
function Ht(r, e) {
  const t = He(r, e), n = V(r, 0);
  return n.setFullYear(t, 0, 4), n.setHours(0, 0, 0, 0), se(n);
}
function Vt(r) {
  return r instanceof Date || typeof r == "object" && Object.prototype.toString.call(r) === "[object Date]";
}
function zt(r) {
  return !(!Vt(r) && typeof r != "number" || isNaN(+L(r)));
}
function qt(r, e) {
  const t = L(r, e == null ? void 0 : e.in);
  return t.setFullYear(t.getFullYear(), 0, 1), t.setHours(0, 0, 0, 0), t;
}
const Qt = {
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
}, Xt = (r, e, t) => {
  let n;
  const a = Qt[r];
  return typeof a == "string" ? n = a : e === 1 ? n = a.one : n = a.other.replace("{{count}}", e.toString()), t != null && t.addSuffix ? t.comparison && t.comparison > 0 ? "in " + n : n + " ago" : n;
};
function de(r) {
  return (e = {}) => {
    const t = e.width ? String(e.width) : r.defaultWidth;
    return r.formats[t] || r.formats[r.defaultWidth];
  };
}
const Gt = {
  full: "EEEE, MMMM do, y",
  long: "MMMM do, y",
  medium: "MMM d, y",
  short: "MM/dd/yyyy"
}, Kt = {
  full: "h:mm:ss a zzzz",
  long: "h:mm:ss a z",
  medium: "h:mm:ss a",
  short: "h:mm a"
}, Jt = {
  full: "{{date}} 'at' {{time}}",
  long: "{{date}} 'at' {{time}}",
  medium: "{{date}}, {{time}}",
  short: "{{date}}, {{time}}"
}, Ut = {
  date: de({
    formats: Gt,
    defaultWidth: "full"
  }),
  time: de({
    formats: Kt,
    defaultWidth: "full"
  }),
  dateTime: de({
    formats: Jt,
    defaultWidth: "full"
  })
}, Zt = {
  lastWeek: "'last' eeee 'at' p",
  yesterday: "'yesterday at' p",
  today: "'today at' p",
  tomorrow: "'tomorrow at' p",
  nextWeek: "eeee 'at' p",
  other: "P"
}, er = (r, e, t, n) => Zt[r];
function U(r) {
  return (e, t) => {
    const n = t != null && t.context ? String(t.context) : "standalone";
    let a;
    if (n === "formatting" && r.formattingValues) {
      const s = r.defaultFormattingWidth || r.defaultWidth, c = t != null && t.width ? String(t.width) : s;
      a = r.formattingValues[c] || r.formattingValues[s];
    } else {
      const s = r.defaultWidth, c = t != null && t.width ? String(t.width) : r.defaultWidth;
      a = r.values[c] || r.values[s];
    }
    const o = r.argumentCallback ? r.argumentCallback(e) : e;
    return a[o];
  };
}
const tr = {
  narrow: ["B", "A"],
  abbreviated: ["BC", "AD"],
  wide: ["Before Christ", "Anno Domini"]
}, rr = {
  narrow: ["1", "2", "3", "4"],
  abbreviated: ["Q1", "Q2", "Q3", "Q4"],
  wide: ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter"]
}, nr = {
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
}, ar = {
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
}, ir = {
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
}, sr = {
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
}, or = (r, e) => {
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
}, cr = {
  ordinalNumber: or,
  era: U({
    values: tr,
    defaultWidth: "wide"
  }),
  quarter: U({
    values: rr,
    defaultWidth: "wide",
    argumentCallback: (r) => r - 1
  }),
  month: U({
    values: nr,
    defaultWidth: "wide"
  }),
  day: U({
    values: ar,
    defaultWidth: "wide"
  }),
  dayPeriod: U({
    values: ir,
    defaultWidth: "wide",
    formattingValues: sr,
    defaultFormattingWidth: "wide"
  })
};
function Z(r) {
  return (e, t = {}) => {
    const n = t.width, a = n && r.matchPatterns[n] || r.matchPatterns[r.defaultMatchWidth], o = e.match(a);
    if (!o)
      return null;
    const s = o[0], c = n && r.parsePatterns[n] || r.parsePatterns[r.defaultParseWidth], u = Array.isArray(c) ? lr(c, (f) => f.test(s)) : (
      // [TODO] -- I challenge you to fix the type
      ur(c, (f) => f.test(s))
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
function ur(r, e) {
  for (const t in r)
    if (Object.prototype.hasOwnProperty.call(r, t) && e(r[t]))
      return t;
}
function lr(r, e) {
  for (let t = 0; t < r.length; t++)
    if (e(r[t]))
      return t;
}
function dr(r) {
  return (e, t = {}) => {
    const n = e.match(r.matchPattern);
    if (!n) return null;
    const a = n[0], o = e.match(r.parsePattern);
    if (!o) return null;
    let s = r.valueCallback ? r.valueCallback(o[0]) : o[0];
    s = t.valueCallback ? t.valueCallback(s) : s;
    const c = e.slice(a.length);
    return { value: s, rest: c };
  };
}
const hr = /^(\d+)(th|st|nd|rd)?/i, fr = /\d+/i, gr = {
  narrow: /^(b|a)/i,
  abbreviated: /^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,
  wide: /^(before christ|before common era|anno domini|common era)/i
}, mr = {
  any: [/^b/i, /^(a|c)/i]
}, wr = {
  narrow: /^[1234]/i,
  abbreviated: /^q[1234]/i,
  wide: /^[1234](th|st|nd|rd)? quarter/i
}, yr = {
  any: [/1/i, /2/i, /3/i, /4/i]
}, pr = {
  narrow: /^[jfmasond]/i,
  abbreviated: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  wide: /^(january|february|march|april|may|june|july|august|september|october|november|december)/i
}, vr = {
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
}, br = {
  narrow: /^[smtwf]/i,
  short: /^(su|mo|tu|we|th|fr|sa)/i,
  abbreviated: /^(sun|mon|tue|wed|thu|fri|sat)/i,
  wide: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i
}, xr = {
  narrow: [/^s/i, /^m/i, /^t/i, /^w/i, /^t/i, /^f/i, /^s/i],
  any: [/^su/i, /^m/i, /^tu/i, /^w/i, /^th/i, /^f/i, /^sa/i]
}, Ar = {
  narrow: /^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,
  any: /^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i
}, Mr = {
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
}, Cr = {
  ordinalNumber: dr({
    matchPattern: hr,
    parsePattern: fr,
    valueCallback: (r) => parseInt(r, 10)
  }),
  era: Z({
    matchPatterns: gr,
    defaultMatchWidth: "wide",
    parsePatterns: mr,
    defaultParseWidth: "any"
  }),
  quarter: Z({
    matchPatterns: wr,
    defaultMatchWidth: "wide",
    parsePatterns: yr,
    defaultParseWidth: "any",
    valueCallback: (r) => r + 1
  }),
  month: Z({
    matchPatterns: pr,
    defaultMatchWidth: "wide",
    parsePatterns: vr,
    defaultParseWidth: "any"
  }),
  day: Z({
    matchPatterns: br,
    defaultMatchWidth: "wide",
    parsePatterns: xr,
    defaultParseWidth: "any"
  }),
  dayPeriod: Z({
    matchPatterns: Ar,
    defaultMatchWidth: "any",
    parsePatterns: Mr,
    defaultParseWidth: "any"
  })
}, Er = {
  code: "en-US",
  formatDistance: Xt,
  formatLong: Ut,
  formatRelative: er,
  localize: cr,
  match: Cr,
  options: {
    weekStartsOn: 0,
    firstWeekContainsDate: 1
  }
};
function kr(r, e) {
  const t = L(r, e == null ? void 0 : e.in);
  return jt(t, qt(t)) + 1;
}
function Sr(r, e) {
  const t = L(r, e == null ? void 0 : e.in), n = +se(t) - +Ht(t);
  return Math.round(n / je) + 1;
}
function Ve(r, e) {
  var d, f, y, w;
  const t = L(r, e == null ? void 0 : e.in), n = t.getFullYear(), a = oe(), o = (e == null ? void 0 : e.firstWeekContainsDate) ?? ((f = (d = e == null ? void 0 : e.locale) == null ? void 0 : d.options) == null ? void 0 : f.firstWeekContainsDate) ?? a.firstWeekContainsDate ?? ((w = (y = a.locale) == null ? void 0 : y.options) == null ? void 0 : w.firstWeekContainsDate) ?? 1, s = V((e == null ? void 0 : e.in) || r, 0);
  s.setFullYear(n + 1, 0, o), s.setHours(0, 0, 0, 0);
  const c = ee(s, e), u = V((e == null ? void 0 : e.in) || r, 0);
  u.setFullYear(n, 0, o), u.setHours(0, 0, 0, 0);
  const l = ee(u, e);
  return +t >= +c ? n + 1 : +t >= +l ? n : n - 1;
}
function Dr(r, e) {
  var c, u, l, d;
  const t = oe(), n = (e == null ? void 0 : e.firstWeekContainsDate) ?? ((u = (c = e == null ? void 0 : e.locale) == null ? void 0 : c.options) == null ? void 0 : u.firstWeekContainsDate) ?? t.firstWeekContainsDate ?? ((d = (l = t.locale) == null ? void 0 : l.options) == null ? void 0 : d.firstWeekContainsDate) ?? 1, a = Ve(r, e), o = V((e == null ? void 0 : e.in) || r, 0);
  return o.setFullYear(a, 0, n), o.setHours(0, 0, 0, 0), ee(o, e);
}
function _r(r, e) {
  const t = L(r, e == null ? void 0 : e.in), n = +ee(t, e) - +Dr(t, e);
  return Math.round(n / je) + 1;
}
function b(r, e) {
  const t = r < 0 ? "-" : "", n = Math.abs(r).toString().padStart(e, "0");
  return t + n;
}
const H = {
  // Year
  y(r, e) {
    const t = r.getFullYear(), n = t > 0 ? t : 1 - t;
    return b(e === "yy" ? n % 100 : n, e.length);
  },
  // Month
  M(r, e) {
    const t = r.getMonth();
    return e === "M" ? String(t + 1) : b(t + 1, 2);
  },
  // Day of the month
  d(r, e) {
    return b(r.getDate(), e.length);
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
    return b(r.getHours() % 12 || 12, e.length);
  },
  // Hour [0-23]
  H(r, e) {
    return b(r.getHours(), e.length);
  },
  // Minute
  m(r, e) {
    return b(r.getMinutes(), e.length);
  },
  // Second
  s(r, e) {
    return b(r.getSeconds(), e.length);
  },
  // Fraction of second
  S(r, e) {
    const t = e.length, n = r.getMilliseconds(), a = Math.trunc(
      n * Math.pow(10, t - 3)
    );
    return b(a, e.length);
  }
}, K = {
  midnight: "midnight",
  noon: "noon",
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  night: "night"
}, Se = {
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
      const n = r.getFullYear(), a = n > 0 ? n : 1 - n;
      return t.ordinalNumber(a, { unit: "year" });
    }
    return H.y(r, e);
  },
  // Local week-numbering year
  Y: function(r, e, t, n) {
    const a = Ve(r, n), o = a > 0 ? a : 1 - a;
    if (e === "YY") {
      const s = o % 100;
      return b(s, 2);
    }
    return e === "Yo" ? t.ordinalNumber(o, { unit: "year" }) : b(o, e.length);
  },
  // ISO week-numbering year
  R: function(r, e) {
    const t = He(r);
    return b(t, e.length);
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
    return b(t, e.length);
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
        return b(n, 2);
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
        return b(n, 2);
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
        return H.M(r, e);
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
        return b(n + 1, 2);
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
    const a = _r(r, n);
    return e === "wo" ? t.ordinalNumber(a, { unit: "week" }) : b(a, e.length);
  },
  // ISO week of year
  I: function(r, e, t) {
    const n = Sr(r);
    return e === "Io" ? t.ordinalNumber(n, { unit: "week" }) : b(n, e.length);
  },
  // Day of the month
  d: function(r, e, t) {
    return e === "do" ? t.ordinalNumber(r.getDate(), { unit: "date" }) : H.d(r, e);
  },
  // Day of year
  D: function(r, e, t) {
    const n = kr(r);
    return e === "Do" ? t.ordinalNumber(n, { unit: "dayOfYear" }) : b(n, e.length);
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
    const a = r.getDay(), o = (a - n.weekStartsOn + 8) % 7 || 7;
    switch (e) {
      // Numerical value (Nth day of week with current locale or weekStartsOn)
      case "e":
        return String(o);
      // Padded numerical value
      case "ee":
        return b(o, 2);
      // 1st, 2nd, ..., 7th
      case "eo":
        return t.ordinalNumber(o, { unit: "day" });
      case "eee":
        return t.day(a, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "eeeee":
        return t.day(a, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "eeeeee":
        return t.day(a, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "eeee":
      default:
        return t.day(a, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Stand-alone local day of week
  c: function(r, e, t, n) {
    const a = r.getDay(), o = (a - n.weekStartsOn + 8) % 7 || 7;
    switch (e) {
      // Numerical value (same as in `e`)
      case "c":
        return String(o);
      // Padded numerical value
      case "cc":
        return b(o, e.length);
      // 1st, 2nd, ..., 7th
      case "co":
        return t.ordinalNumber(o, { unit: "day" });
      case "ccc":
        return t.day(a, {
          width: "abbreviated",
          context: "standalone"
        });
      // T
      case "ccccc":
        return t.day(a, {
          width: "narrow",
          context: "standalone"
        });
      // Tu
      case "cccccc":
        return t.day(a, {
          width: "short",
          context: "standalone"
        });
      // Tuesday
      case "cccc":
      default:
        return t.day(a, {
          width: "wide",
          context: "standalone"
        });
    }
  },
  // ISO day of week
  i: function(r, e, t) {
    const n = r.getDay(), a = n === 0 ? 7 : n;
    switch (e) {
      // 2
      case "i":
        return String(a);
      // 02
      case "ii":
        return b(a, e.length);
      // 2nd
      case "io":
        return t.ordinalNumber(a, { unit: "day" });
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
    const a = r.getHours() / 12 >= 1 ? "pm" : "am";
    switch (e) {
      case "a":
      case "aa":
        return t.dayPeriod(a, {
          width: "abbreviated",
          context: "formatting"
        });
      case "aaa":
        return t.dayPeriod(a, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "aaaaa":
        return t.dayPeriod(a, {
          width: "narrow",
          context: "formatting"
        });
      case "aaaa":
      default:
        return t.dayPeriod(a, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // AM, PM, midnight, noon
  b: function(r, e, t) {
    const n = r.getHours();
    let a;
    switch (n === 12 ? a = K.noon : n === 0 ? a = K.midnight : a = n / 12 >= 1 ? "pm" : "am", e) {
      case "b":
      case "bb":
        return t.dayPeriod(a, {
          width: "abbreviated",
          context: "formatting"
        });
      case "bbb":
        return t.dayPeriod(a, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "bbbbb":
        return t.dayPeriod(a, {
          width: "narrow",
          context: "formatting"
        });
      case "bbbb":
      default:
        return t.dayPeriod(a, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // in the morning, in the afternoon, in the evening, at night
  B: function(r, e, t) {
    const n = r.getHours();
    let a;
    switch (n >= 17 ? a = K.evening : n >= 12 ? a = K.afternoon : n >= 4 ? a = K.morning : a = K.night, e) {
      case "B":
      case "BB":
      case "BBB":
        return t.dayPeriod(a, {
          width: "abbreviated",
          context: "formatting"
        });
      case "BBBBB":
        return t.dayPeriod(a, {
          width: "narrow",
          context: "formatting"
        });
      case "BBBB":
      default:
        return t.dayPeriod(a, {
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
    return H.h(r, e);
  },
  // Hour [0-23]
  H: function(r, e, t) {
    return e === "Ho" ? t.ordinalNumber(r.getHours(), { unit: "hour" }) : H.H(r, e);
  },
  // Hour [0-11]
  K: function(r, e, t) {
    const n = r.getHours() % 12;
    return e === "Ko" ? t.ordinalNumber(n, { unit: "hour" }) : b(n, e.length);
  },
  // Hour [1-24]
  k: function(r, e, t) {
    let n = r.getHours();
    return n === 0 && (n = 24), e === "ko" ? t.ordinalNumber(n, { unit: "hour" }) : b(n, e.length);
  },
  // Minute
  m: function(r, e, t) {
    return e === "mo" ? t.ordinalNumber(r.getMinutes(), { unit: "minute" }) : H.m(r, e);
  },
  // Second
  s: function(r, e, t) {
    return e === "so" ? t.ordinalNumber(r.getSeconds(), { unit: "second" }) : H.s(r, e);
  },
  // Fraction of second
  S: function(r, e) {
    return H.S(r, e);
  },
  // Timezone (ISO-8601. If offset is 0, output is always `'Z'`)
  X: function(r, e, t) {
    const n = r.getTimezoneOffset();
    if (n === 0)
      return "Z";
    switch (e) {
      // Hours and optional minutes
      case "X":
        return _e(n);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XX`
      case "XXXX":
      case "XX":
        return Q(n);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XXX`
      case "XXXXX":
      case "XXX":
      // Hours and minutes with `:` delimiter
      default:
        return Q(n, ":");
    }
  },
  // Timezone (ISO-8601. If offset is 0, output is `'+00:00'` or equivalent)
  x: function(r, e, t) {
    const n = r.getTimezoneOffset();
    switch (e) {
      // Hours and optional minutes
      case "x":
        return _e(n);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xx`
      case "xxxx":
      case "xx":
        return Q(n);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xxx`
      case "xxxxx":
      case "xxx":
      // Hours and minutes with `:` delimiter
      default:
        return Q(n, ":");
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
        return "GMT" + De(n, ":");
      // Long
      case "OOOO":
      default:
        return "GMT" + Q(n, ":");
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
        return "GMT" + De(n, ":");
      // Long
      case "zzzz":
      default:
        return "GMT" + Q(n, ":");
    }
  },
  // Seconds timestamp
  t: function(r, e, t) {
    const n = Math.trunc(+r / 1e3);
    return b(n, e.length);
  },
  // Milliseconds timestamp
  T: function(r, e, t) {
    return b(+r, e.length);
  }
};
function De(r, e = "") {
  const t = r > 0 ? "-" : "+", n = Math.abs(r), a = Math.trunc(n / 60), o = n % 60;
  return o === 0 ? t + String(a) : t + String(a) + e + b(o, 2);
}
function _e(r, e) {
  return r % 60 === 0 ? (r > 0 ? "-" : "+") + b(Math.abs(r) / 60, 2) : Q(r, e);
}
function Q(r, e = "") {
  const t = r > 0 ? "-" : "+", n = Math.abs(r), a = b(Math.trunc(n / 60), 2), o = b(n % 60, 2);
  return t + a + e + o;
}
const Fe = (r, e) => {
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
}, ze = (r, e) => {
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
}, Fr = (r, e) => {
  const t = r.match(/(P+)(p+)?/) || [], n = t[1], a = t[2];
  if (!a)
    return Fe(r, e);
  let o;
  switch (n) {
    case "P":
      o = e.dateTime({ width: "short" });
      break;
    case "PP":
      o = e.dateTime({ width: "medium" });
      break;
    case "PPP":
      o = e.dateTime({ width: "long" });
      break;
    case "PPPP":
    default:
      o = e.dateTime({ width: "full" });
      break;
  }
  return o.replace("{{date}}", Fe(n, e)).replace("{{time}}", ze(a, e));
}, Pr = {
  p: ze,
  P: Fr
}, Or = /^D+$/, Br = /^Y+$/, Ir = ["D", "DD", "YY", "YYYY"];
function Wr(r) {
  return Or.test(r);
}
function Lr(r) {
  return Br.test(r);
}
function Tr(r, e, t) {
  const n = $r(r, e, t);
  if (console.warn(n), Ir.includes(r)) throw new RangeError(n);
}
function $r(r, e, t) {
  const n = r[0] === "Y" ? "years" : "days of the month";
  return `Use \`${r.toLowerCase()}\` instead of \`${r}\` (in \`${e}\`) for formatting ${n} to the input \`${t}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`;
}
const Rr = /[yYQqMLwIdDecihHKkms]o|(\w)\1*|''|'(''|[^'])+('|$)|./g, Nr = /P+p+|P+|p+|''|'(''|[^'])+('|$)|./g, Yr = /^'([^]*?)'?$/, jr = /''/g, Hr = /[a-zA-Z]/;
function Pe(r, e, t) {
  var d, f, y, w;
  const n = oe(), a = n.locale ?? Er, o = n.firstWeekContainsDate ?? ((f = (d = n.locale) == null ? void 0 : d.options) == null ? void 0 : f.firstWeekContainsDate) ?? 1, s = n.weekStartsOn ?? ((w = (y = n.locale) == null ? void 0 : y.options) == null ? void 0 : w.weekStartsOn) ?? 0, c = L(r, t == null ? void 0 : t.in);
  if (!zt(c))
    throw new RangeError("Invalid time value");
  let u = e.match(Nr).map((h) => {
    const m = h[0];
    if (m === "p" || m === "P") {
      const p = Pr[m];
      return p(h, a.formatLong);
    }
    return h;
  }).join("").match(Rr).map((h) => {
    if (h === "''")
      return { isToken: !1, value: "'" };
    const m = h[0];
    if (m === "'")
      return { isToken: !1, value: Vr(h) };
    if (Se[m])
      return { isToken: !0, value: h };
    if (m.match(Hr))
      throw new RangeError(
        "Format string contains an unescaped latin alphabet character `" + m + "`"
      );
    return { isToken: !1, value: h };
  });
  a.localize.preprocessor && (u = a.localize.preprocessor(c, u));
  const l = {
    firstWeekContainsDate: o,
    weekStartsOn: s,
    locale: a
  };
  return u.map((h) => {
    if (!h.isToken) return h.value;
    const m = h.value;
    (Lr(m) || Wr(m)) && Tr(m, e, String(r));
    const p = Se[m[0]];
    return p(c, m, a.localize, l);
  }).join("");
}
function Vr(r) {
  const e = r.match(Yr);
  return e ? e[1].replace(jr, "'") : r;
}
var zr = i.template('<div class="split-view"><div class="split-view-content isolate svelte-16e2eab"><div class="split-view-left custom-scrollbar h-full overflow-y-auto"><!></div>  <div class="w-1 hover:w-2 cursor-ew-resize hover:bg-[var(--border-color)] transition-all z-10" role="separator" aria-orientation="vertical"></div> <div class="split-view-right h-full"><!></div></div></div>');
function qr(r, e) {
  let t = i.prop(e, "leftWidth", 8, "33.333%"), n = i.prop(e, "minLeftWidth", 8, 200), a = i.prop(e, "maxLeftWidth", 8, 800), o = !1, s, c, u = i.mutable_source(), l = i.mutable_source();
  function d(v) {
    o = !0, s = v.pageX, c = i.get(u).offsetWidth, window.addEventListener("mousemove", f), window.addEventListener("mouseup", y), document.body.style.cursor = "ew-resize", document.body.style.userSelect = "none";
  }
  function f(v) {
    if (!o) return;
    const F = v.pageX - s, W = Math.min(Math.max(c + F, n()), a());
    i.mutate(u, i.get(u).style.width = `${W}px`);
  }
  function y() {
    o = !1, window.removeEventListener("mousemove", f), window.removeEventListener("mouseup", y), document.body.style.cursor = "", document.body.style.userSelect = "";
  }
  var w = zr(), h = i.child(w), m = i.child(h), p = i.child(m);
  i.slot(p, e, "left", {}, null), i.reset(m), i.bind_this(m, (v) => i.set(u, v), () => i.get(u));
  var C = i.sibling(m, 2), A = i.sibling(C, 2), D = i.child(A);
  i.slot(D, e, "right", {}, null), i.reset(A), i.bind_this(A, (v) => i.set(l, v), () => i.get(l)), i.reset(h), i.reset(w), i.template_effect(() => i.set_style(m, `width: ${(typeof t() == "number" ? `${t()}px` : t()) ?? ""}`)), i.event("mousedown", C, d), i.append(r, w);
}
var Qr = i.template('<div class="p-4 text-center text-sm text-gray-500">No items found</div>'), Xr = i.template('<div class="ml-2 flex-shrink-0 text-white opacity-90 text-[10px] font-medium tracking-wide">↵</div>'), Gr = i.template('<div role="option"><div class="mr-3 flex-shrink-0 flex items-center justify-center"><!></div> <div class="flex-1 overflow-hidden flex flex-col justify-center gap-0.5"><div> </div> <div><!></div></div> <!></div>'), Kr = i.template('<div slot="left" class="h-full overflow-y-auto focus:outline-none bg-white dark:bg-[#1e1e1e] py-2 border-r border-gray-100 dark:border-gray-800 custom-scrollbar svelte-9jgq4c" role="listbox" aria-label="Clipboard Items" tabindex="0"><!></div>'), Jr = i.template('<span class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path></svg> </span>'), Ur = i.template('<div class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar svelte-9jgq4c"><!></div> <div class="h-12 border-t border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-[#1e1e1e]/80 backdrop-blur-md flex items-center px-4 justify-between text-xs text-gray-500 dark:text-gray-400 shadow-sm z-10"><div class="flex items-center space-x-3"><span class="font-medium uppercase tracking-wider text-[10px] bg-gray-200 dark:bg-gray-800 px-2 py-0.5 rounded"> </span> <span class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> </span> <!></div> <div class="flex items-center gap-1.5 opacity-80 font-medium"><kbd class="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-sans shadow-sm svelte-9jgq4c">Enter</kbd> <span>to Paste</span></div></div>', 1), Zr = i.template('<div class="flex h-full items-center justify-center flex-col gap-4 text-gray-400 dark:text-gray-600"><svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg> <span class="text-sm font-medium">Select an item to view details</span></div>'), en = i.template('<div slot="right" class="h-full flex flex-col bg-gray-50/50 dark:bg-[#161616]/50 overflow-hidden relative"><!></div>');
function ln(r, e) {
  i.push(e, !1);
  const [t, n] = i.setup_stores(), a = () => i.store_get(_, "$clipboardViewState", t), o = i.mutable_source(), s = i.mutable_source(), c = i.mutable_source();
  let u = i.mutable_source();
  Je(async () => {
    await Ue();
  });
  function l() {
    requestAnimationFrame(() => {
      var m;
      const h = (m = i.get(u)) == null ? void 0 : m.querySelector(`[data-index="${i.get(c)}"]`);
      if (h) {
        const p = i.get(u).getBoundingClientRect(), C = h.getBoundingClientRect(), A = C.top < p.top, D = C.bottom > p.bottom;
        A ? h.scrollIntoView({ block: "start", behavior: "auto" }) : D && h.scrollIntoView({ block: "end", behavior: "auto" });
      }
    });
  }
  function d(h) {
    _.setSelectedItem(h);
  }
  function f(h) {
    return !h || !h.content ? "Empty" : h.type === "image" ? "Image Data" : h.content.replace(/\n/g, " ").trim();
  }
  function y(h, m) {
    const p = m ? "currentColor" : "var(--icon-color, #888)";
    switch (h) {
      case "image":
        return `<svg class="w-4 h-4" style="color: ${p}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`;
      case "html":
        return `<svg class="w-4 h-4" style="color: ${p}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>`;
      default:
        return `<svg class="w-4 h-4" style="color: ${p}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>`;
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
  i.legacy_pre_effect(() => (a(), _), () => {
    i.set(o, a().filtered ? _.search(a().items, a().searchQuery) : a().items);
  }), i.legacy_pre_effect(() => a(), () => {
    i.set(s, a().selectedItem);
  }), i.legacy_pre_effect(() => a(), () => {
    i.set(c, a().selectedIndex);
  }), i.legacy_pre_effect(() => i.get(c), () => {
    i.get(c) !== void 0 && l();
  }), i.legacy_pre_effect_reset(), i.init(), qr(r, {
    leftWidth: 260,
    minLeftWidth: 200,
    maxLeftWidth: 600,
    $$slots: {
      left: (h, m) => {
        var p = Kr(), C = i.child(p);
        {
          var A = (v) => {
            var F = Qr();
            i.append(v, F);
          }, D = (v) => {
            var F = i.comment(), W = i.first_child(F);
            i.each(W, 3, () => i.get(o), (E) => E.id, (E, M, x) => {
              var S = Gr(), R = i.child(S), O = i.child(R);
              i.html(O, () => y(i.get(M).type, i.get(c) === i.get(x)), !1, !1), i.reset(R);
              var G = i.sibling(R, 2), k = i.child(G), j = i.child(k, !0);
              i.reset(k);
              var B = i.sibling(k, 2), J = i.child(B);
              {
                var ce = (I) => {
                  var q = i.text();
                  i.template_effect(
                    (ue) => i.set_text(q, `Match: ${ue ?? ""}%`),
                    [
                      () => Math.round((1 - (typeof i.get(M).score == "number" ? i.get(M).score : 0)) * 100)
                    ],
                    i.derived_safe_equal
                  ), i.append(I, q);
                }, te = (I) => {
                  var q = i.text();
                  i.template_effect(
                    (ue) => i.set_text(q, ue),
                    [
                      () => Pe(i.get(M).createdAt, "MMM d, yyyy · p")
                    ],
                    i.derived_safe_equal
                  ), i.append(I, q);
                };
                i.if(J, (I) => {
                  a().searchQuery && "score" in i.get(M) ? I(ce) : I(te, !1);
                });
              }
              i.reset(B), i.reset(G);
              var qe = i.sibling(G, 2);
              {
                var Qe = (I) => {
                  var q = Xr();
                  i.append(I, q);
                };
                i.if(qe, (I) => {
                  i.get(c) === i.get(x) && I(Qe);
                });
              }
              i.reset(S), i.template_effect(
                (I) => {
                  i.set_attribute(S, "data-index", i.get(x)), i.set_class(S, 1, `group flex items-center px-3 py-2 mx-2 my-0.5 rounded-lg cursor-default transition-colors ${(i.get(c) === i.get(x) ? "bg-blue-500 text-white shadow-sm" : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200") ?? ""}`), i.set_attribute(S, "aria-selected", i.get(c) === i.get(x)), i.set_class(k, 1, `truncate text-[13px] font-medium leading-none ${(i.get(c) === i.get(x) ? "text-white" : "text-gray-900 dark:text-gray-100") ?? ""}`), i.set_text(j, I), i.set_class(B, 1, `truncate text-[11px] leading-none ${(i.get(c) === i.get(x) ? "text-blue-100" : "text-gray-500 dark:text-gray-400") ?? ""}`);
                },
                [() => f(i.get(M))],
                i.derived_safe_equal
              ), i.event("click", S, () => d(i.get(x))), i.event("dblclick", S, () => _.handleItemAction(i.get(M), "paste")), i.append(E, S);
            }), i.append(v, F);
          };
          i.if(C, (v) => {
            i.get(o).length === 0 ? v(A) : v(D, !1);
          });
        }
        i.reset(p), i.bind_this(p, (v) => i.set(u, v), () => i.get(u)), i.append(h, p);
      },
      right: (h, m) => {
        var p = en(), C = i.child(p);
        {
          var A = (v) => {
            var F = Ur(), W = i.first_child(F), E = i.child(W);
            i.html(E, () => w(i.get(s)), !1, !1), i.reset(W);
            var M = i.sibling(W, 2), x = i.child(M), S = i.child(x), R = i.child(S, !0);
            i.reset(S);
            var O = i.sibling(S, 2), G = i.sibling(i.child(O));
            i.reset(O);
            var k = i.sibling(O, 2);
            {
              var j = (B) => {
                var J = Jr(), ce = i.sibling(i.child(J));
                i.reset(J), i.template_effect(() => {
                  var te;
                  return i.set_text(ce, ` ${((te = i.get(s).content) == null ? void 0 : te.length) || 0} chars`);
                }), i.append(B, J);
              };
              i.if(k, (B) => {
                i.get(s).type !== "image" && B(j);
              });
            }
            i.reset(x), i.next(2), i.reset(M), i.template_effect(
              (B) => {
                i.set_text(R, i.get(s).type), i.set_text(G, ` ${B ?? ""}`);
              },
              [
                () => Pe(i.get(s).createdAt, "PPpp")
              ],
              i.derived_safe_equal
            ), i.append(v, F);
          }, D = (v) => {
            var F = Zr();
            i.append(v, F);
          };
          i.if(C, (v) => {
            i.get(s) ? v(A) : v(D, !1);
          });
        }
        i.reset(p), i.append(h, p);
      }
    }
  }), i.pop(), n();
}
const tn = [
  {
    id: "clipboard-history",
    title: "Clipboard History",
    subtitle: "View and manage your clipboard history",
    keywords: "clipboard copy paste history"
  }
], rn = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["title", "subtitle", "keywords"]
};
new $(tn, rn);
class nn {
  constructor() {
    N(this, "onUnload");
    N(this, "logService");
    N(this, "extensionManager");
    N(this, "clipboardService");
    N(this, "actionService");
    N(this, "inView", !1);
    N(this, "context");
    N(this, "handleKeydownBound", (e) => this.handleKeydown(e));
  }
  async initialize(e) {
    var t, n;
    try {
      if (this.context = e, this.logService = e.getService("LogService"), this.extensionManager = e.getService("ExtensionManager"), this.clipboardService = e.getService(
        "ClipboardHistoryService"
      ), this.actionService = e.getService("ActionService"), !this.logService || !this.extensionManager || !this.clipboardService || !this.actionService) {
        console.error(
          "Failed to initialize required services for Clipboard History"
        ), (t = this.logService) == null || t.error(
          "Failed to initialize required services for Clipboard History"
        );
        return;
      }
      _.initializeServices(e), this.logService.info(
        "Clipboard History extension initialized with services"
      );
    } catch (a) {
      console.error("Clipboard History initialization failed:", a), (n = this.logService) == null || n.error(
        `Clipboard History initialization failed: ${a}`
      );
    }
  }
  async executeCommand(e, t) {
    var n, a, o;
    switch ((n = this.logService) == null || n.info(`Executing clipboard command: ${e}`), e) {
      case "show-clipboard":
        return await this.refreshClipboardData(), (a = this.extensionManager) == null || a.navigateToView(
          "clipboard-history/DefaultView"
        ), this.registerViewActions(), {
          type: "view",
          viewPath: "clipboard-history/DefaultView"
        };
      default:
        throw (o = this.logService) == null || o.error(`Received unknown command ID: ${e}`), new Error(`Unknown command: ${e}`);
    }
  }
  // Called when this extension's view is activated
  async viewActivated(e) {
    var t, n;
    this.inView = !0, (t = this.logService) == null || t.debug(`Clipboard History view activated: ${e}`), window.addEventListener("keydown", this.handleKeydownBound), (n = this.extensionManager) == null || n.setActiveViewActionLabel("Paste"), await this.refreshClipboardData();
  }
  handleKeydown(e) {
    if (!this.inView) return;
    const t = Oe(_);
    t.items.length && (e.key === "ArrowUp" || e.key === "ArrowDown" ? (e.preventDefault(), e.stopPropagation(), _.moveSelection(e.key === "ArrowUp" ? "up" : "down")) : e.key === "Enter" && t.selectedItem && (e.preventDefault(), e.stopPropagation(), _.handleItemAction(t.selectedItem, "paste")));
  }
  // Helper method to register view-specific actions
  registerViewActions() {
    var t, n;
    if (!this.actionService || !this.clipboardService) {
      (t = this.logService) == null || t.warn(
        "ActionService or ClipboardService not available, cannot register view actions."
      );
      return;
    }
    (n = this.logService) == null || n.debug("Registering clipboard view actions...");
    const e = {
      id: "clipboard-reset-history",
      title: "Clear Clipboard History",
      description: "Remove all non-favorite clipboard items",
      icon: "🗑️",
      extensionId: "clipboard-history",
      category: "clipboard-action",
      // Context is implicitly EXTENSION_VIEW when registered
      execute: async () => {
        var a, o, s, c;
        try {
          confirm(
            "Are you sure you want to clear all non-favorite clipboard items?"
          ) && (await ((a = this.clipboardService) == null ? void 0 : a.clearNonFavorites()) ? (o = this.logService) == null || o.info("Non-favorite clipboard history cleared") : (s = this.logService) == null || s.warn(
            "Clearing non-favorite clipboard history reported failure."
          ), await this.refreshClipboardData());
        } catch (u) {
          (c = this.logService) == null || c.error(`Failed to clear clipboard history: ${u}`);
        }
      }
    };
    this.actionService.registerAction(e);
  }
  // Helper method to unregister view-specific actions
  unregisterViewActions() {
    var e, t;
    if (!this.actionService) {
      (e = this.logService) == null || e.warn(
        "ActionService not available, cannot unregister view actions."
      );
      return;
    }
    (t = this.logService) == null || t.debug("Unregistering clipboard view actions..."), this.actionService.unregisterAction("clipboard-reset-history");
  }
  // Called when this extension's view is deactivated
  async viewDeactivated(e) {
    var t, n;
    this.unregisterViewActions(), (t = this.extensionManager) == null || t.setActiveViewActionLabel(null), this.inView = !1, (n = this.logService) == null || n.debug(`Clipboard History view deactivated: ${e}`);
  }
  async onViewSearch(e) {
    _.setSearch(e);
  }
  async refreshClipboardData() {
    var e, t;
    if (this.clipboardService) {
      _.setLoading(!0);
      try {
        const n = await this.clipboardService.getRecentItems(100);
        _.setItems(n || []);
      } catch (n) {
        (e = this.logService) == null || e.error(`Failed to load clipboard data: ${n}`), _.setError(`Failed to load clipboard data: ${n}`);
      } finally {
        _.setLoading(!1);
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
const dn = new nn();
export {
  ln as DefaultView,
  dn as default
};
