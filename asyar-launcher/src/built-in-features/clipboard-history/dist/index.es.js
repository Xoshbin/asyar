var ct = Object.defineProperty;
var ut = (r, e, t) => e in r ? ct(r, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : r[e] = t;
var F = (r, e, t) => ut(r, typeof e != "symbol" ? e + "" : e, t);
import { writable as ke, get as Ge } from "svelte/store";
import "svelte/internal/disclose-version";
import "svelte/internal/flags/legacy";
import * as s from "svelte/internal/client";
import { onMount as lt, tick as dt } from "svelte";
import { ActionContext as L } from "asyar-sdk";
function G(r) {
  return Array.isArray ? Array.isArray(r) : Ue(r) === "[object Array]";
}
function ht(r) {
  if (typeof r == "string")
    return r;
  let e = r + "";
  return e == "0" && 1 / r == -1 / 0 ? "-0" : e;
}
function ft(r) {
  return r == null ? "" : ht(r);
}
function H(r) {
  return typeof r == "string";
}
function Qe(r) {
  return typeof r == "number";
}
function gt(r) {
  return r === !0 || r === !1 || mt(r) && Ue(r) == "[object Boolean]";
}
function Xe(r) {
  return typeof r == "object";
}
function mt(r) {
  return Xe(r) && r !== null;
}
function R(r) {
  return r != null;
}
function pe(r) {
  return !r.trim().length;
}
function Ue(r) {
  return r == null ? r === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(r);
}
const wt = "Incorrect 'index' type", yt = (r) => `Invalid value for key ${r}`, bt = (r) => `Pattern length exceeds max of ${r}.`, pt = (r) => `Missing ${r} property in key`, xt = (r) => `Property 'weight' in key '${r}' must be a positive integer`, Ie = Object.prototype.hasOwnProperty;
class vt {
  constructor(e) {
    this._keys = [], this._keyMap = {};
    let t = 0;
    e.forEach((n) => {
      let i = qe(n);
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
function qe(r) {
  let e = null, t = null, n = null, i = 1, o = null;
  if (H(r) || G(r))
    n = r, e = Be(r), t = Ae(r);
  else {
    if (!Ie.call(r, "name"))
      throw new Error(pt("name"));
    const a = r.name;
    if (n = a, Ie.call(r, "weight") && (i = r.weight, i <= 0))
      throw new Error(xt(a));
    e = Be(a), t = Ae(a), o = r.getFn;
  }
  return { path: e, id: t, weight: i, src: n, getFn: o };
}
function Be(r) {
  return G(r) ? r : r.split(".");
}
function Ae(r) {
  return G(r) ? r.join(".") : r;
}
function At(r, e) {
  let t = [], n = !1;
  const i = (o, a, c) => {
    if (R(o))
      if (!a[c])
        t.push(o);
      else {
        let u = a[c];
        const l = o[u];
        if (!R(l))
          return;
        if (c === a.length - 1 && (H(l) || Qe(l) || gt(l)))
          t.push(ft(l));
        else if (G(l)) {
          n = !0;
          for (let d = 0, h = l.length; d < h; d += 1)
            i(l[d], a, c + 1);
        } else a.length && i(l, a, c + 1);
      }
  };
  return i(r, H(e) ? e.split(".") : e, 0), n ? t : t[0];
}
const Ct = {
  // Whether the matches should be included in the result set. When `true`, each record in the result
  // set will include the indices of the matched characters.
  // These can consequently be used for highlighting purposes.
  includeMatches: !1,
  // When `true`, the matching function will continue to the end of a search pattern even if
  // a perfect match has already been located in the string.
  findAllMatches: !1,
  // Minimum number of characters that must be matched before a result is considered a match
  minMatchCharLength: 1
}, Et = {
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
}, _t = {
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
}, Mt = {
  // When `true`, it enables the use of unix-like search commands
  useExtendedSearch: !1,
  // The get function to use when fetching an object's properties.
  // The default will search nested paths *ie foo.bar.baz*
  getFn: At,
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
  ...Et,
  ...Ct,
  ..._t,
  ...Mt
};
const St = /[^ ]+/g;
function Dt(r = 1, e = 3) {
  const t = /* @__PURE__ */ new Map(), n = Math.pow(10, e);
  return {
    get(i) {
      const o = i.match(St).length;
      if (t.has(o))
        return t.get(o);
      const a = 1 / Math.pow(o, 0.5 * r), c = parseFloat(Math.round(a * n) / n);
      return t.set(o, c), c;
    },
    clear() {
      t.clear();
    }
  };
}
class Fe {
  constructor({
    getFn: e = g.getFn,
    fieldNormWeight: t = g.fieldNormWeight
  } = {}) {
    this.norm = Dt(t, 3), this.getFn = e, this.isCreated = !1, this.setIndexRecords();
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
    this.isCreated || !this.docs.length || (this.isCreated = !0, H(this.docs[0]) ? this.docs.forEach((e, t) => {
      this._addString(e, t);
    }) : this.docs.forEach((e, t) => {
      this._addObject(e, t);
    }), this.norm.clear());
  }
  // Adds a doc to the end of the index
  add(e) {
    const t = this.size();
    H(e) ? this._addString(e, t) : this._addObject(e, t);
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
    if (!R(e) || pe(e))
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
    this.keys.forEach((i, o) => {
      let a = i.getFn ? i.getFn(e) : this.getFn(e, i.path);
      if (R(a)) {
        if (G(a)) {
          let c = [];
          const u = [{ nestedArrIndex: -1, value: a }];
          for (; u.length; ) {
            const { nestedArrIndex: l, value: d } = u.pop();
            if (R(d))
              if (H(d) && !pe(d)) {
                let h = {
                  v: d,
                  i: l,
                  n: this.norm.get(d)
                };
                c.push(h);
              } else G(d) && d.forEach((h, w) => {
                u.push({
                  nestedArrIndex: w,
                  value: h
                });
              });
          }
          n.$[o] = c;
        } else if (H(a) && !pe(a)) {
          let c = {
            v: a,
            n: this.norm.get(a)
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
function Ke(r, e, { getFn: t = g.getFn, fieldNormWeight: n = g.fieldNormWeight } = {}) {
  const i = new Fe({ getFn: t, fieldNormWeight: n });
  return i.setKeys(r.map(qe)), i.setSources(e), i.create(), i;
}
function kt(r, { getFn: e = g.getFn, fieldNormWeight: t = g.fieldNormWeight } = {}) {
  const { keys: n, records: i } = r, o = new Fe({ getFn: e, fieldNormWeight: t });
  return o.setKeys(n), o.setIndexRecords(i), o;
}
function ue(r, {
  errors: e = 0,
  currentLocation: t = 0,
  expectedLocation: n = 0,
  distance: i = g.distance,
  ignoreLocation: o = g.ignoreLocation
} = {}) {
  const a = e / r.length;
  if (o)
    return a;
  const c = Math.abs(n - t);
  return i ? a + c / i : c ? 1 : a;
}
function Ft(r = [], e = g.minMatchCharLength) {
  let t = [], n = -1, i = -1, o = 0;
  for (let a = r.length; o < a; o += 1) {
    let c = r[o];
    c && n === -1 ? n = o : !c && n !== -1 && (i = o - 1, i - n + 1 >= e && t.push([n, i]), n = -1);
  }
  return r[o - 1] && o - n >= e && t.push([n, o - 1]), t;
}
const ee = 32;
function $t(r, e, t, {
  location: n = g.location,
  distance: i = g.distance,
  threshold: o = g.threshold,
  findAllMatches: a = g.findAllMatches,
  minMatchCharLength: c = g.minMatchCharLength,
  includeMatches: u = g.includeMatches,
  ignoreLocation: l = g.ignoreLocation
} = {}) {
  if (e.length > ee)
    throw new Error(bt(ee));
  const d = e.length, h = r.length, w = Math.max(0, Math.min(n, h));
  let m = o, f = w;
  const p = c > 1 || u, C = p ? Array(h) : [];
  let E;
  for (; (E = r.indexOf(e, f)) > -1; ) {
    let D = ue(e, {
      currentLocation: E,
      expectedLocation: w,
      distance: i,
      ignoreLocation: l
    });
    if (m = Math.min(D, m), f = E + d, p) {
      let B = 0;
      for (; B < d; )
        C[E + B] = 1, B += 1;
    }
  }
  f = -1;
  let x = [], v = 1, M = d + h;
  const S = 1 << d - 1;
  for (let D = 0; D < d; D += 1) {
    let B = 0, _ = M;
    for (; B < _; )
      ue(e, {
        errors: D,
        currentLocation: w + _,
        expectedLocation: w,
        distance: i,
        ignoreLocation: l
      }) <= m ? B = _ : M = _, _ = Math.floor((M - B) / 2 + B);
    M = _;
    let $ = Math.max(1, w - _ + 1), O = a ? h : Math.min(w + _, h) + d, P = Array(O + 2);
    P[O + 1] = (1 << D) - 1;
    for (let k = O; k >= $; k -= 1) {
      let Q = k - 1, N = t[r.charAt(Q)];
      if (p && (C[Q] = +!!N), P[k] = (P[k + 1] << 1 | 1) & N, D && (P[k] |= (x[k + 1] | x[k]) << 1 | 1 | x[k + 1]), P[k] & S && (v = ue(e, {
        errors: D,
        currentLocation: Q,
        expectedLocation: w,
        distance: i,
        ignoreLocation: l
      }), v <= m)) {
        if (m = v, f = Q, f <= w)
          break;
        $ = Math.max(1, 2 * w - f);
      }
    }
    if (ue(e, {
      errors: D + 1,
      currentLocation: w,
      expectedLocation: w,
      distance: i,
      ignoreLocation: l
    }) > m)
      break;
    x = P;
  }
  const I = {
    isMatch: f >= 0,
    // Count exact matches (those with a score of 0) to be "almost" exact
    score: Math.max(1e-3, v)
  };
  if (p) {
    const D = Ft(C, c);
    D.length ? u && (I.indices = D) : I.isMatch = !1;
  }
  return I;
}
function It(r) {
  let e = {};
  for (let t = 0, n = r.length; t < n; t += 1) {
    const i = r.charAt(t);
    e[i] = (e[i] || 0) | 1 << n - t - 1;
  }
  return e;
}
const fe = String.prototype.normalize ? ((r) => r.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "")) : ((r) => r);
class Je {
  constructor(e, {
    location: t = g.location,
    threshold: n = g.threshold,
    distance: i = g.distance,
    includeMatches: o = g.includeMatches,
    findAllMatches: a = g.findAllMatches,
    minMatchCharLength: c = g.minMatchCharLength,
    isCaseSensitive: u = g.isCaseSensitive,
    ignoreDiacritics: l = g.ignoreDiacritics,
    ignoreLocation: d = g.ignoreLocation
  } = {}) {
    if (this.options = {
      location: t,
      threshold: n,
      distance: i,
      includeMatches: o,
      findAllMatches: a,
      minMatchCharLength: c,
      isCaseSensitive: u,
      ignoreDiacritics: l,
      ignoreLocation: d
    }, e = u ? e : e.toLowerCase(), e = l ? fe(e) : e, this.pattern = e, this.chunks = [], !this.pattern.length)
      return;
    const h = (m, f) => {
      this.chunks.push({
        pattern: m,
        alphabet: It(m),
        startIndex: f
      });
    }, w = this.pattern.length;
    if (w > ee) {
      let m = 0;
      const f = w % ee, p = w - f;
      for (; m < p; )
        h(this.pattern.substr(m, ee), m), m += ee;
      if (f) {
        const C = w - ee;
        h(this.pattern.substr(C), C);
      }
    } else
      h(this.pattern, 0);
  }
  searchIn(e) {
    const { isCaseSensitive: t, ignoreDiacritics: n, includeMatches: i } = this.options;
    if (e = t ? e : e.toLowerCase(), e = n ? fe(e) : e, this.pattern === e) {
      let p = {
        isMatch: !0,
        score: 0
      };
      return i && (p.indices = [[0, e.length - 1]]), p;
    }
    const {
      location: o,
      distance: a,
      threshold: c,
      findAllMatches: u,
      minMatchCharLength: l,
      ignoreLocation: d
    } = this.options;
    let h = [], w = 0, m = !1;
    this.chunks.forEach(({ pattern: p, alphabet: C, startIndex: E }) => {
      const { isMatch: x, score: v, indices: M } = $t(e, p, C, {
        location: o + E,
        distance: a,
        threshold: c,
        findAllMatches: u,
        minMatchCharLength: l,
        includeMatches: i,
        ignoreLocation: d
      });
      x && (m = !0), w += v, x && M && (h = [...h, ...M]);
    });
    let f = {
      isMatch: m,
      score: m ? w / this.chunks.length : 1
    };
    return m && i && (f.indices = h), f;
  }
}
class q {
  constructor(e) {
    this.pattern = e;
  }
  static isMultiMatch(e) {
    return Oe(e, this.multiRegex);
  }
  static isSingleMatch(e) {
    return Oe(e, this.singleRegex);
  }
  search() {
  }
}
function Oe(r, e) {
  const t = r.match(e);
  return t ? t[1] : null;
}
class Bt extends q {
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
class Ot extends q {
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
class Pt extends q {
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
class Wt extends q {
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
class Rt extends q {
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
class Nt extends q {
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
class Ze extends q {
  constructor(e, {
    location: t = g.location,
    threshold: n = g.threshold,
    distance: i = g.distance,
    includeMatches: o = g.includeMatches,
    findAllMatches: a = g.findAllMatches,
    minMatchCharLength: c = g.minMatchCharLength,
    isCaseSensitive: u = g.isCaseSensitive,
    ignoreDiacritics: l = g.ignoreDiacritics,
    ignoreLocation: d = g.ignoreLocation
  } = {}) {
    super(e), this._bitapSearch = new Je(e, {
      location: t,
      threshold: n,
      distance: i,
      includeMatches: o,
      findAllMatches: a,
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
class et extends q {
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
    const i = [], o = this.pattern.length;
    for (; (n = e.indexOf(this.pattern, t)) > -1; )
      t = n + o, i.push([n, t - 1]);
    const a = !!i.length;
    return {
      isMatch: a,
      score: a ? 0 : 1,
      indices: i
    };
  }
}
const Ce = [
  Bt,
  et,
  Pt,
  Wt,
  Nt,
  Rt,
  Ot,
  Ze
], Pe = Ce.length, Tt = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/, Lt = "|";
function Yt(r, e = {}) {
  return r.split(Lt).map((t) => {
    let n = t.trim().split(Tt).filter((o) => o && !!o.trim()), i = [];
    for (let o = 0, a = n.length; o < a; o += 1) {
      const c = n[o];
      let u = !1, l = -1;
      for (; !u && ++l < Pe; ) {
        const d = Ce[l];
        let h = d.isMultiMatch(c);
        h && (i.push(new d(h, e)), u = !0);
      }
      if (!u)
        for (l = -1; ++l < Pe; ) {
          const d = Ce[l];
          let h = d.isSingleMatch(c);
          if (h) {
            i.push(new d(h, e));
            break;
          }
        }
    }
    return i;
  });
}
const jt = /* @__PURE__ */ new Set([Ze.type, et.type]);
class Vt {
  constructor(e, {
    isCaseSensitive: t = g.isCaseSensitive,
    ignoreDiacritics: n = g.ignoreDiacritics,
    includeMatches: i = g.includeMatches,
    minMatchCharLength: o = g.minMatchCharLength,
    ignoreLocation: a = g.ignoreLocation,
    findAllMatches: c = g.findAllMatches,
    location: u = g.location,
    threshold: l = g.threshold,
    distance: d = g.distance
  } = {}) {
    this.query = null, this.options = {
      isCaseSensitive: t,
      ignoreDiacritics: n,
      includeMatches: i,
      minMatchCharLength: o,
      findAllMatches: c,
      ignoreLocation: a,
      location: u,
      threshold: l,
      distance: d
    }, e = t ? e : e.toLowerCase(), e = n ? fe(e) : e, this.pattern = e, this.query = Yt(this.pattern, this.options);
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
    const { includeMatches: n, isCaseSensitive: i, ignoreDiacritics: o } = this.options;
    e = i ? e : e.toLowerCase(), e = o ? fe(e) : e;
    let a = 0, c = [], u = 0;
    for (let l = 0, d = t.length; l < d; l += 1) {
      const h = t[l];
      c.length = 0, a = 0;
      for (let w = 0, m = h.length; w < m; w += 1) {
        const f = h[w], { isMatch: p, indices: C, score: E } = f.search(e);
        if (p) {
          if (a += 1, u += E, n) {
            const x = f.constructor.type;
            jt.has(x) ? c = [...c, ...C] : c.push(C);
          }
        } else {
          u = 0, a = 0, c.length = 0;
          break;
        }
      }
      if (a) {
        let w = {
          isMatch: !0,
          score: u / a
        };
        return n && (w.indices = c), w;
      }
    }
    return {
      isMatch: !1,
      score: 1
    };
  }
}
const Ee = [];
function Ht(...r) {
  Ee.push(...r);
}
function _e(r, e) {
  for (let t = 0, n = Ee.length; t < n; t += 1) {
    let i = Ee[t];
    if (i.condition(r, e))
      return new i(r, e);
  }
  return new Je(r, e);
}
const ge = {
  AND: "$and",
  OR: "$or"
}, Me = {
  PATH: "$path",
  PATTERN: "$val"
}, Se = (r) => !!(r[ge.AND] || r[ge.OR]), zt = (r) => !!r[Me.PATH], Gt = (r) => !G(r) && Xe(r) && !Se(r), We = (r) => ({
  [ge.AND]: Object.keys(r).map((e) => ({
    [e]: r[e]
  }))
});
function tt(r, e, { auto: t = !0 } = {}) {
  const n = (i) => {
    let o = Object.keys(i);
    const a = zt(i);
    if (!a && o.length > 1 && !Se(i))
      return n(We(i));
    if (Gt(i)) {
      const u = a ? i[Me.PATH] : o[0], l = a ? i[Me.PATTERN] : i[u];
      if (!H(l))
        throw new Error(yt(u));
      const d = {
        keyId: Ae(u),
        pattern: l
      };
      return t && (d.searcher = _e(l, e)), d;
    }
    let c = {
      children: [],
      operator: o[0]
    };
    return o.forEach((u) => {
      const l = i[u];
      G(l) && l.forEach((d) => {
        c.children.push(n(d));
      });
    }), c;
  };
  return Se(r) || (r = We(r)), n(r);
}
function Qt(r, { ignoreFieldNorm: e = g.ignoreFieldNorm }) {
  r.forEach((t) => {
    let n = 1;
    t.matches.forEach(({ key: i, norm: o, score: a }) => {
      const c = i ? i.weight : null;
      n *= Math.pow(
        a === 0 && c ? Number.EPSILON : a,
        (c || 1) * (e ? 1 : o)
      );
    }), t.score = n;
  });
}
function Xt(r, e) {
  const t = r.matches;
  e.matches = [], R(t) && t.forEach((n) => {
    if (!R(n.indices) || !n.indices.length)
      return;
    const { indices: i, value: o } = n;
    let a = {
      indices: i,
      value: o
    };
    n.key && (a.key = n.key.src), n.idx > -1 && (a.refIndex = n.idx), e.matches.push(a);
  });
}
function Ut(r, e) {
  e.score = r.score;
}
function qt(r, e, {
  includeMatches: t = g.includeMatches,
  includeScore: n = g.includeScore
} = {}) {
  const i = [];
  return t && i.push(Xt), n && i.push(Ut), r.map((o) => {
    const { idx: a } = o, c = {
      item: e[a],
      refIndex: a
    };
    return i.length && i.forEach((u) => {
      u(o, c);
    }), c;
  });
}
class z {
  constructor(e, t = {}, n) {
    this.options = { ...g, ...t }, this.options.useExtendedSearch, this._keyStore = new vt(this.options.keys), this.setCollection(e, n);
  }
  setCollection(e, t) {
    if (this._docs = e, t && !(t instanceof Fe))
      throw new Error(wt);
    this._myIndex = t || Ke(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
  }
  add(e) {
    R(e) && (this._docs.push(e), this._myIndex.add(e));
  }
  remove(e = () => !1) {
    const t = [];
    for (let n = 0, i = this._docs.length; n < i; n += 1) {
      const o = this._docs[n];
      e(o, n) && (this.removeAt(n), n -= 1, i -= 1, t.push(o));
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
      shouldSort: o,
      sortFn: a,
      ignoreFieldNorm: c
    } = this.options;
    let u = H(e) ? H(this._docs[0]) ? this._searchStringList(e) : this._searchObjectList(e) : this._searchLogical(e);
    return Qt(u, { ignoreFieldNorm: c }), o && u.sort(a), Qe(t) && t > -1 && (u = u.slice(0, t)), qt(u, this._docs, {
      includeMatches: n,
      includeScore: i
    });
  }
  _searchStringList(e) {
    const t = _e(e, this.options), { records: n } = this._myIndex, i = [];
    return n.forEach(({ v: o, i: a, n: c }) => {
      if (!R(o))
        return;
      const { isMatch: u, score: l, indices: d } = t.searchIn(o);
      u && i.push({
        item: o,
        idx: a,
        matches: [{ score: l, value: o, norm: c, indices: d }]
      });
    }), i;
  }
  _searchLogical(e) {
    const t = tt(e, this.options), n = (c, u, l) => {
      if (!c.children) {
        const { keyId: h, searcher: w } = c, m = this._findMatches({
          key: this._keyStore.get(h),
          value: this._myIndex.getValueForItemAtKeyId(u, h),
          searcher: w
        });
        return m && m.length ? [
          {
            idx: l,
            item: u,
            matches: m
          }
        ] : [];
      }
      const d = [];
      for (let h = 0, w = c.children.length; h < w; h += 1) {
        const m = c.children[h], f = n(m, u, l);
        if (f.length)
          d.push(...f);
        else if (c.operator === ge.AND)
          return [];
      }
      return d;
    }, i = this._myIndex.records, o = {}, a = [];
    return i.forEach(({ $: c, i: u }) => {
      if (R(c)) {
        let l = n(t, c, u);
        l.length && (o[u] || (o[u] = { idx: u, item: c, matches: [] }, a.push(o[u])), l.forEach(({ matches: d }) => {
          o[u].matches.push(...d);
        }));
      }
    }), a;
  }
  _searchObjectList(e) {
    const t = _e(e, this.options), { keys: n, records: i } = this._myIndex, o = [];
    return i.forEach(({ $: a, i: c }) => {
      if (!R(a))
        return;
      let u = [];
      n.forEach((l, d) => {
        u.push(
          ...this._findMatches({
            key: l,
            value: a[d],
            searcher: t
          })
        );
      }), u.length && o.push({
        idx: c,
        item: a,
        matches: u
      });
    }), o;
  }
  _findMatches({ key: e, value: t, searcher: n }) {
    if (!R(t))
      return [];
    let i = [];
    if (G(t))
      t.forEach(({ v: o, i: a, n: c }) => {
        if (!R(o))
          return;
        const { isMatch: u, score: l, indices: d } = n.searchIn(o);
        u && i.push({
          score: l,
          key: e,
          value: o,
          idx: a,
          norm: c,
          indices: d
        });
      });
    else {
      const { v: o, n: a } = t, { isMatch: c, score: u, indices: l } = n.searchIn(o);
      c && i.push({ score: u, key: e, value: o, norm: a, indices: l });
    }
    return i;
  }
}
z.version = "7.1.0";
z.createIndex = Ke;
z.parseIndex = kt;
z.config = g;
z.parseQuery = tt;
Ht(Vt);
function Kt(r, e = !1) {
  return window.__TAURI_INTERNALS__.transformCallback(r, e);
}
async function Y(r, e = {}, t) {
  return window.__TAURI_INTERNALS__.invoke(r, e, t);
}
var Re;
(function(r) {
  r.WINDOW_RESIZED = "tauri://resize", r.WINDOW_MOVED = "tauri://move", r.WINDOW_CLOSE_REQUESTED = "tauri://close-requested", r.WINDOW_DESTROYED = "tauri://destroyed", r.WINDOW_FOCUS = "tauri://focus", r.WINDOW_BLUR = "tauri://blur", r.WINDOW_SCALE_FACTOR_CHANGED = "tauri://scale-change", r.WINDOW_THEME_CHANGED = "tauri://theme-changed", r.WINDOW_CREATED = "tauri://window-created", r.WEBVIEW_CREATED = "tauri://webview-created", r.DRAG_ENTER = "tauri://drag-enter", r.DRAG_OVER = "tauri://drag-over", r.DRAG_DROP = "tauri://drag-drop", r.DRAG_LEAVE = "tauri://drag-leave";
})(Re || (Re = {}));
async function Jt(r, e) {
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(r, e), await Y("plugin:event|unlisten", {
    event: r,
    eventId: e
  });
}
async function Zt(r, e, t) {
  var n;
  const i = (n = void 0) !== null && n !== void 0 ? n : { kind: "Any" };
  return Y("plugin:event|listen", {
    event: r,
    target: i,
    handler: Kt(e)
  }).then((o) => async () => Jt(r, o));
}
var V;
(function(r) {
  r[r.Trace = 1] = "Trace", r[r.Debug = 2] = "Debug", r[r.Info = 3] = "Info", r[r.Warn = 4] = "Warn", r[r.Error = 5] = "Error";
})(V || (V = {}));
function er(r) {
  var e, t;
  if (r)
    if (r.startsWith("Error")) {
      const i = (e = r.split(`
`)[3]) == null ? void 0 : e.trim();
      if (!i)
        return;
      const o = /at\s+(?<functionName>.*?)\s+\((?<fileName>.*?):(?<lineNumber>\d+):(?<columnNumber>\d+)\)/, a = i.match(o);
      if (a) {
        const { functionName: c, fileName: u, lineNumber: l, columnNumber: d } = a.groups;
        return `${c}@${u}:${l}:${d}`;
      } else {
        const c = /at\s+(?<fileName>.*?):(?<lineNumber>\d+):(?<columnNumber>\d+)/, u = i.match(c);
        if (u) {
          const { fileName: l, lineNumber: d, columnNumber: h } = u.groups;
          return `<anonymous>@${l}:${d}:${h}`;
        }
      }
    } else
      return (t = r.split(`
`).map((o) => o.split("@")).filter(([o, a]) => o.length > 0 && a !== "[native code]")[2]) == null ? void 0 : t.filter((o) => o.length > 0).join("@");
}
async function $e(r, e, t) {
  const n = er(new Error().stack), { file: i, line: o, keyValues: a } = t ?? {};
  await Y("plugin:log|log", {
    level: r,
    message: e,
    location: n,
    file: i,
    line: o,
    keyValues: a
  });
}
async function tr(r, e) {
  await $e(V.Error, r, e);
}
async function le(r, e) {
  await $e(V.Info, r, e);
}
async function rr(r, e) {
  await $e(V.Debug, r, e);
}
async function nr(r) {
  return await Zt("log://log", (e) => {
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
async function ir() {
  return await nr(({ level: r, message: e }) => {
    switch (r) {
      case V.Trace:
        console.log(e);
        break;
      case V.Debug:
        console.debug(e);
        break;
      case V.Info:
        console.info(e);
        break;
      case V.Warn:
        console.warn(e);
        break;
      case V.Error:
        console.error(e);
        break;
      default:
        throw new Error(`unknown log level ${r}`);
    }
  });
}
const b = {
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
class sr {
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
  async init(e) {
    await ir(), e != null && e.disableColors && (this.useColors = !1), e != null && e.disableFrames && (this.useFrames = !1), this.info("Logger initialized");
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
    const n = e.replace(/\u001b\[\d+m/g, "").length, i = this.useColors ? t : "", o = this.useColors ? b.reset : "", a = `${i}${b.frameTopLeft}${b.frameHorizontal.repeat(
      n + 2
    )}${b.frameTopRight}${o}`, c = `${i}${b.frameBottomLeft}${b.frameHorizontal.repeat(n + 2)}${b.frameBottomRight}${o}`, u = `${i}${b.frameVertical}${o} ${e} ${i}${b.frameVertical}${o}`;
    return `${a}
${u}
${c}`;
  }
  /**
   * Create a frame for a multiline message
   */
  createMultiLineFrame(e, t) {
    const n = Math.max(
      ...e.map((l) => l.replace(/\u001b\[\d+m/g, "").length)
    ), i = this.useColors ? t : "", o = this.useColors ? b.reset : "", a = `${i}${b.frameTopLeft}${b.frameHorizontal.repeat(
      n + 2
    )}${b.frameTopRight}${o}`, c = `${i}${b.frameBottomLeft}${b.frameHorizontal.repeat(n + 2)}${b.frameBottomRight}${o}`, u = e.map((l) => {
      const d = n - l.replace(/\u001b\[\d+m/g, "").length;
      return `${i}${b.frameVertical}${o} ${l}${" ".repeat(
        d
      )} ${i}${b.frameVertical}${o}`;
    });
    return `${a}
${u.join(`
`)}
${c}`;
  }
  /**
   * Format message with timestamp and category
   */
  format(e, t, n, i) {
    const o = (/* @__PURE__ */ new Date()).toLocaleTimeString(), a = t.padEnd(5, " "), c = this.useColors ? `${b.dim}[${o}]${b.reset} ${n}${this.appName}:${a}${b.reset} ${e}` : `[${o}] ${this.appName}:${a} ${e}`;
    return this.createFrame(c, i);
  }
  tryLog(e, t, n) {
    try {
      if (typeof window < "u" && !window.__TAURI_INTERNALS__) {
        t(n);
        return;
      }
      e(n);
    } catch {
      t(n);
    }
  }
  /**
   * Log informational message
   */
  info(e) {
    const t = this.format(e, "INFO", `${b.bright}${b.green}`, b.green);
    this.tryLog(le, console.info, t);
  }
  /**
   * Log error message
   */
  error(e) {
    const t = e instanceof Error ? e.message : e, n = this.format(t, "ERROR", `${b.bright}${b.red}`, b.red);
    this.tryLog(tr, console.error, n);
  }
  /**
   * Log warning message
   */
  warn(e) {
    const t = this.format(e, "WARN", `${b.bright}${b.yellow}`, b.yellow);
    this.tryLog(le, console.warn, t);
  }
  /**
   * Log debug message
   */
  debug(e) {
    const t = this.format(e, "DEBUG", `${b.cyan}`, b.cyan);
    this.tryLog(rr, console.debug, t);
  }
  /**
   * Log success message
   */
  success(e) {
    const t = this.format(
      e,
      "OK",
      `${b.bright}${b.green}`,
      b.bgGreen
    );
    this.tryLog(le, console.info, t);
  }
  /**
   * Log message with custom category and color
   */
  custom(e, t, n, i) {
    const o = this.useColors ? b[n] || b.reset : "", a = this.useColors ? b[i || n] || b.reset : "", c = this.format(
      e,
      t,
      o,
      a
    );
    this.tryLog(le, console.info, c);
  }
  /**
   * Track extension usage with special formatting
   */
  trackExtensionUsage(e, t, n) {
    const i = (/* @__PURE__ */ new Date()).toISOString(), o = n ? JSON.stringify(n) : "";
    this.info(
      `EXTENSION_TRACKED [${i}] Extension: ${e} | Action: ${t} | ${o}`
    );
  }
}
const y = new sr(), de = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["content"]
};
function ar() {
  const { subscribe: r, set: e, update: t } = ke({
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
  function o(a) {
    n = a.getService(
      "ClipboardHistoryService"
    ), i = a.getService("LogService");
  }
  return {
    subscribe: r,
    setSearch: (a) => t((c) => ({
      ...c,
      searchQuery: a,
      filtered: a.length > 0,
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
    initFuse: (a) => t((c) => ({
      ...c,
      fuseInstance: new z(a, de)
    })),
    search: (a, c) => {
      let u = a;
      if (c && c.trim() !== "") {
        let l = {
          fuseInstance: null
        };
        r((m) => {
          l = m;
        })();
        let h;
        l.fuseInstance ? (h = l.fuseInstance, h.setCollection(a)) : h = new z(a, de), u = h.search(c).map((m) => ({
          ...m.item,
          score: m.score
        })), t((m) => ({
          ...m,
          fuseInstance: h
        }));
      }
      return u;
    },
    setItems: (a) => {
      y.debug(`Setting items in state: ${a.length}`), t((c) => ({
        ...c,
        items: a,
        fuseInstance: new z(a, de)
      }));
    },
    setSelectedItem(a) {
      t((c) => {
        const u = c.items;
        return u.length > 0 && a >= 0 && a < u.length ? {
          ...c,
          selectedItem: u[a],
          selectedIndex: a
        } : c;
      });
    },
    moveSelection(a) {
      t((c) => {
        const u = c.items;
        if (!u.length) return c;
        let l = c.selectedIndex;
        return a === "up" ? l = l <= 0 ? u.length - 1 : l - 1 : l = l >= u.length - 1 ? 0 : l + 1, requestAnimationFrame(() => {
          const d = document.querySelector(`[data-index="${l}"]`);
          d == null || d.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }), {
          ...c,
          selectedIndex: l,
          selectedItem: u[l]
        };
      });
    },
    setLoading(a) {
      t((c) => ({ ...c, isLoading: a }));
    },
    setError(a) {
      t((c) => ({
        ...c,
        loadError: !!a,
        errorMessage: a || ""
      }));
    },
    initializeServices: o,
    // Expose clipboardService methods through the state store
    async clearNonFavorites() {
      if (!n)
        return i == null || i.error("Clipboard service not initialized in clearNonFavorites"), !1;
      try {
        return await n.clearNonFavorites();
      } catch (a) {
        return i == null || i.error(`Error clearing non-favorites: ${a}`), !1;
      }
    },
    async toggleFavorite(a) {
      if (!n)
        return i == null || i.error("Clipboard service not initialized in toggleFavorite"), !1;
      try {
        return await n.toggleItemFavorite(a);
      } catch (c) {
        return i == null || i.error(`Error toggling favorite for ${a}: ${c}`), !1;
      }
    },
    // --- End exposed methods ---
    async handleItemAction(a, c) {
      if (!(!(a != null && a.id) || !n))
        try {
          switch (c) {
            case "paste":
              await n.pasteItem(a), n == null || n.hideWindow();
              break;
            case "select":
              const l = Ge({ subscribe: r }).items.findIndex((d) => d.id === a.id);
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
      } catch (a) {
        i == null || i.error(`Error hiding window: ${a}`);
      }
    },
    // Refresh history items (no change needed here, already uses service)
    async refreshHistory() {
      t((a) => ({ ...a, isLoading: !0 }));
      try {
        if (n) {
          const a = await n.getRecentItems(100);
          t((c) => ({
            // Use update instead of this.setItems
            ...c,
            items: a,
            fuseInstance: new z(a, de)
            // Update fuse instance too
          }));
        } else
          i == null || i.warn("Clipboard service not available in refreshHistory");
      } catch (a) {
        i == null || i.error(`Failed to refresh clipboard history: ${a}`), t((c) => ({
          // Use update instead of this.setError
          ...c,
          loadError: !0,
          errorMessage: `Failed to refresh clipboard history: ${a}`
        }));
      } finally {
        this.setLoading(!1);
      }
    }
  };
}
const W = ar(), rt = 6048e5, or = 864e5, Ne = Symbol.for("constructDateFrom");
function U(r, e) {
  return typeof r == "function" ? r(e) : r && typeof r == "object" && Ne in r ? r[Ne](e) : r instanceof Date ? new r.constructor(e) : new Date(e);
}
function j(r, e) {
  return U(e || r, r);
}
let cr = {};
function we() {
  return cr;
}
function oe(r, e) {
  var c, u, l, d;
  const t = we(), n = (e == null ? void 0 : e.weekStartsOn) ?? ((u = (c = e == null ? void 0 : e.locale) == null ? void 0 : c.options) == null ? void 0 : u.weekStartsOn) ?? t.weekStartsOn ?? ((d = (l = t.locale) == null ? void 0 : l.options) == null ? void 0 : d.weekStartsOn) ?? 0, i = j(r, e == null ? void 0 : e.in), o = i.getDay(), a = (o < n ? 7 : 0) + o - n;
  return i.setDate(i.getDate() - a), i.setHours(0, 0, 0, 0), i;
}
function me(r, e) {
  return oe(r, { ...e, weekStartsOn: 1 });
}
function nt(r, e) {
  const t = j(r, e == null ? void 0 : e.in), n = t.getFullYear(), i = U(t, 0);
  i.setFullYear(n + 1, 0, 4), i.setHours(0, 0, 0, 0);
  const o = me(i), a = U(t, 0);
  a.setFullYear(n, 0, 4), a.setHours(0, 0, 0, 0);
  const c = me(a);
  return t.getTime() >= o.getTime() ? n + 1 : t.getTime() >= c.getTime() ? n : n - 1;
}
function Te(r) {
  const e = j(r), t = new Date(
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
function ur(r, ...e) {
  const t = U.bind(
    null,
    e.find((n) => typeof n == "object")
  );
  return e.map(t);
}
function Le(r, e) {
  const t = j(r, e == null ? void 0 : e.in);
  return t.setHours(0, 0, 0, 0), t;
}
function lr(r, e, t) {
  const [n, i] = ur(
    t == null ? void 0 : t.in,
    r,
    e
  ), o = Le(n), a = Le(i), c = +o - Te(o), u = +a - Te(a);
  return Math.round((c - u) / or);
}
function dr(r, e) {
  const t = nt(r, e), n = U(r, 0);
  return n.setFullYear(t, 0, 4), n.setHours(0, 0, 0, 0), me(n);
}
function hr(r) {
  return r instanceof Date || typeof r == "object" && Object.prototype.toString.call(r) === "[object Date]";
}
function fr(r) {
  return !(!hr(r) && typeof r != "number" || isNaN(+j(r)));
}
function gr(r, e) {
  const t = j(r, e == null ? void 0 : e.in);
  return t.setFullYear(t.getFullYear(), 0, 1), t.setHours(0, 0, 0, 0), t;
}
const mr = {
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
}, wr = (r, e, t) => {
  let n;
  const i = mr[r];
  return typeof i == "string" ? n = i : e === 1 ? n = i.one : n = i.other.replace("{{count}}", e.toString()), t != null && t.addSuffix ? t.comparison && t.comparison > 0 ? "in " + n : n + " ago" : n;
};
function xe(r) {
  return (e = {}) => {
    const t = e.width ? String(e.width) : r.defaultWidth;
    return r.formats[t] || r.formats[r.defaultWidth];
  };
}
const yr = {
  full: "EEEE, MMMM do, y",
  long: "MMMM do, y",
  medium: "MMM d, y",
  short: "MM/dd/yyyy"
}, br = {
  full: "h:mm:ss a zzzz",
  long: "h:mm:ss a z",
  medium: "h:mm:ss a",
  short: "h:mm a"
}, pr = {
  full: "{{date}} 'at' {{time}}",
  long: "{{date}} 'at' {{time}}",
  medium: "{{date}}, {{time}}",
  short: "{{date}}, {{time}}"
}, xr = {
  date: xe({
    formats: yr,
    defaultWidth: "full"
  }),
  time: xe({
    formats: br,
    defaultWidth: "full"
  }),
  dateTime: xe({
    formats: pr,
    defaultWidth: "full"
  })
}, vr = {
  lastWeek: "'last' eeee 'at' p",
  yesterday: "'yesterday at' p",
  today: "'today at' p",
  tomorrow: "'tomorrow at' p",
  nextWeek: "eeee 'at' p",
  other: "P"
}, Ar = (r, e, t, n) => vr[r];
function se(r) {
  return (e, t) => {
    const n = t != null && t.context ? String(t.context) : "standalone";
    let i;
    if (n === "formatting" && r.formattingValues) {
      const a = r.defaultFormattingWidth || r.defaultWidth, c = t != null && t.width ? String(t.width) : a;
      i = r.formattingValues[c] || r.formattingValues[a];
    } else {
      const a = r.defaultWidth, c = t != null && t.width ? String(t.width) : r.defaultWidth;
      i = r.values[c] || r.values[a];
    }
    const o = r.argumentCallback ? r.argumentCallback(e) : e;
    return i[o];
  };
}
const Cr = {
  narrow: ["B", "A"],
  abbreviated: ["BC", "AD"],
  wide: ["Before Christ", "Anno Domini"]
}, Er = {
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
}, Mr = {
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
}, Sr = {
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
}, Dr = {
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
}, kr = (r, e) => {
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
}, Fr = {
  ordinalNumber: kr,
  era: se({
    values: Cr,
    defaultWidth: "wide"
  }),
  quarter: se({
    values: Er,
    defaultWidth: "wide",
    argumentCallback: (r) => r - 1
  }),
  month: se({
    values: _r,
    defaultWidth: "wide"
  }),
  day: se({
    values: Mr,
    defaultWidth: "wide"
  }),
  dayPeriod: se({
    values: Sr,
    defaultWidth: "wide",
    formattingValues: Dr,
    defaultFormattingWidth: "wide"
  })
};
function ae(r) {
  return (e, t = {}) => {
    const n = t.width, i = n && r.matchPatterns[n] || r.matchPatterns[r.defaultMatchWidth], o = e.match(i);
    if (!o)
      return null;
    const a = o[0], c = n && r.parsePatterns[n] || r.parsePatterns[r.defaultParseWidth], u = Array.isArray(c) ? Ir(c, (h) => h.test(a)) : (
      // [TODO] -- I challenge you to fix the type
      $r(c, (h) => h.test(a))
    );
    let l;
    l = r.valueCallback ? r.valueCallback(u) : u, l = t.valueCallback ? (
      // [TODO] -- I challenge you to fix the type
      t.valueCallback(l)
    ) : l;
    const d = e.slice(a.length);
    return { value: l, rest: d };
  };
}
function $r(r, e) {
  for (const t in r)
    if (Object.prototype.hasOwnProperty.call(r, t) && e(r[t]))
      return t;
}
function Ir(r, e) {
  for (let t = 0; t < r.length; t++)
    if (e(r[t]))
      return t;
}
function Br(r) {
  return (e, t = {}) => {
    const n = e.match(r.matchPattern);
    if (!n) return null;
    const i = n[0], o = e.match(r.parsePattern);
    if (!o) return null;
    let a = r.valueCallback ? r.valueCallback(o[0]) : o[0];
    a = t.valueCallback ? t.valueCallback(a) : a;
    const c = e.slice(i.length);
    return { value: a, rest: c };
  };
}
const Or = /^(\d+)(th|st|nd|rd)?/i, Pr = /\d+/i, Wr = {
  narrow: /^(b|a)/i,
  abbreviated: /^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,
  wide: /^(before christ|before common era|anno domini|common era)/i
}, Rr = {
  any: [/^b/i, /^(a|c)/i]
}, Nr = {
  narrow: /^[1234]/i,
  abbreviated: /^q[1234]/i,
  wide: /^[1234](th|st|nd|rd)? quarter/i
}, Tr = {
  any: [/1/i, /2/i, /3/i, /4/i]
}, Lr = {
  narrow: /^[jfmasond]/i,
  abbreviated: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  wide: /^(january|february|march|april|may|june|july|august|september|october|november|december)/i
}, Yr = {
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
}, jr = {
  narrow: /^[smtwf]/i,
  short: /^(su|mo|tu|we|th|fr|sa)/i,
  abbreviated: /^(sun|mon|tue|wed|thu|fri|sat)/i,
  wide: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i
}, Vr = {
  narrow: [/^s/i, /^m/i, /^t/i, /^w/i, /^t/i, /^f/i, /^s/i],
  any: [/^su/i, /^m/i, /^tu/i, /^w/i, /^th/i, /^f/i, /^sa/i]
}, Hr = {
  narrow: /^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,
  any: /^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i
}, zr = {
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
}, Gr = {
  ordinalNumber: Br({
    matchPattern: Or,
    parsePattern: Pr,
    valueCallback: (r) => parseInt(r, 10)
  }),
  era: ae({
    matchPatterns: Wr,
    defaultMatchWidth: "wide",
    parsePatterns: Rr,
    defaultParseWidth: "any"
  }),
  quarter: ae({
    matchPatterns: Nr,
    defaultMatchWidth: "wide",
    parsePatterns: Tr,
    defaultParseWidth: "any",
    valueCallback: (r) => r + 1
  }),
  month: ae({
    matchPatterns: Lr,
    defaultMatchWidth: "wide",
    parsePatterns: Yr,
    defaultParseWidth: "any"
  }),
  day: ae({
    matchPatterns: jr,
    defaultMatchWidth: "wide",
    parsePatterns: Vr,
    defaultParseWidth: "any"
  }),
  dayPeriod: ae({
    matchPatterns: Hr,
    defaultMatchWidth: "any",
    parsePatterns: zr,
    defaultParseWidth: "any"
  })
}, Qr = {
  code: "en-US",
  formatDistance: wr,
  formatLong: xr,
  formatRelative: Ar,
  localize: Fr,
  match: Gr,
  options: {
    weekStartsOn: 0,
    firstWeekContainsDate: 1
  }
};
function Xr(r, e) {
  const t = j(r, e == null ? void 0 : e.in);
  return lr(t, gr(t)) + 1;
}
function Ur(r, e) {
  const t = j(r, e == null ? void 0 : e.in), n = +me(t) - +dr(t);
  return Math.round(n / rt) + 1;
}
function it(r, e) {
  var d, h, w, m;
  const t = j(r, e == null ? void 0 : e.in), n = t.getFullYear(), i = we(), o = (e == null ? void 0 : e.firstWeekContainsDate) ?? ((h = (d = e == null ? void 0 : e.locale) == null ? void 0 : d.options) == null ? void 0 : h.firstWeekContainsDate) ?? i.firstWeekContainsDate ?? ((m = (w = i.locale) == null ? void 0 : w.options) == null ? void 0 : m.firstWeekContainsDate) ?? 1, a = U((e == null ? void 0 : e.in) || r, 0);
  a.setFullYear(n + 1, 0, o), a.setHours(0, 0, 0, 0);
  const c = oe(a, e), u = U((e == null ? void 0 : e.in) || r, 0);
  u.setFullYear(n, 0, o), u.setHours(0, 0, 0, 0);
  const l = oe(u, e);
  return +t >= +c ? n + 1 : +t >= +l ? n : n - 1;
}
function qr(r, e) {
  var c, u, l, d;
  const t = we(), n = (e == null ? void 0 : e.firstWeekContainsDate) ?? ((u = (c = e == null ? void 0 : e.locale) == null ? void 0 : c.options) == null ? void 0 : u.firstWeekContainsDate) ?? t.firstWeekContainsDate ?? ((d = (l = t.locale) == null ? void 0 : l.options) == null ? void 0 : d.firstWeekContainsDate) ?? 1, i = it(r, e), o = U((e == null ? void 0 : e.in) || r, 0);
  return o.setFullYear(i, 0, n), o.setHours(0, 0, 0, 0), oe(o, e);
}
function Kr(r, e) {
  const t = j(r, e == null ? void 0 : e.in), n = +oe(t, e) - +qr(t, e);
  return Math.round(n / rt) + 1;
}
function A(r, e) {
  const t = r < 0 ? "-" : "", n = Math.abs(r).toString().padStart(e, "0");
  return t + n;
}
const X = {
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
}, ne = {
  midnight: "midnight",
  noon: "noon",
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  night: "night"
}, Ye = {
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
    return X.y(r, e);
  },
  // Local week-numbering year
  Y: function(r, e, t, n) {
    const i = it(r, n), o = i > 0 ? i : 1 - i;
    if (e === "YY") {
      const a = o % 100;
      return A(a, 2);
    }
    return e === "Yo" ? t.ordinalNumber(o, { unit: "year" }) : A(o, e.length);
  },
  // ISO week-numbering year
  R: function(r, e) {
    const t = nt(r);
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
        return X.M(r, e);
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
    const i = Kr(r, n);
    return e === "wo" ? t.ordinalNumber(i, { unit: "week" }) : A(i, e.length);
  },
  // ISO week of year
  I: function(r, e, t) {
    const n = Ur(r);
    return e === "Io" ? t.ordinalNumber(n, { unit: "week" }) : A(n, e.length);
  },
  // Day of the month
  d: function(r, e, t) {
    return e === "do" ? t.ordinalNumber(r.getDate(), { unit: "date" }) : X.d(r, e);
  },
  // Day of year
  D: function(r, e, t) {
    const n = Xr(r);
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
    const i = r.getDay(), o = (i - n.weekStartsOn + 8) % 7 || 7;
    switch (e) {
      // Numerical value (Nth day of week with current locale or weekStartsOn)
      case "e":
        return String(o);
      // Padded numerical value
      case "ee":
        return A(o, 2);
      // 1st, 2nd, ..., 7th
      case "eo":
        return t.ordinalNumber(o, { unit: "day" });
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
    const i = r.getDay(), o = (i - n.weekStartsOn + 8) % 7 || 7;
    switch (e) {
      // Numerical value (same as in `e`)
      case "c":
        return String(o);
      // Padded numerical value
      case "cc":
        return A(o, e.length);
      // 1st, 2nd, ..., 7th
      case "co":
        return t.ordinalNumber(o, { unit: "day" });
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
    switch (n === 12 ? i = ne.noon : n === 0 ? i = ne.midnight : i = n / 12 >= 1 ? "pm" : "am", e) {
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
    switch (n >= 17 ? i = ne.evening : n >= 12 ? i = ne.afternoon : n >= 4 ? i = ne.morning : i = ne.night, e) {
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
    return X.h(r, e);
  },
  // Hour [0-23]
  H: function(r, e, t) {
    return e === "Ho" ? t.ordinalNumber(r.getHours(), { unit: "hour" }) : X.H(r, e);
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
    return e === "mo" ? t.ordinalNumber(r.getMinutes(), { unit: "minute" }) : X.m(r, e);
  },
  // Second
  s: function(r, e, t) {
    return e === "so" ? t.ordinalNumber(r.getSeconds(), { unit: "second" }) : X.s(r, e);
  },
  // Fraction of second
  S: function(r, e) {
    return X.S(r, e);
  },
  // Timezone (ISO-8601. If offset is 0, output is always `'Z'`)
  X: function(r, e, t) {
    const n = r.getTimezoneOffset();
    if (n === 0)
      return "Z";
    switch (e) {
      // Hours and optional minutes
      case "X":
        return Ve(n);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XX`
      case "XXXX":
      case "XX":
        return Z(n);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XXX`
      case "XXXXX":
      case "XXX":
      // Hours and minutes with `:` delimiter
      default:
        return Z(n, ":");
    }
  },
  // Timezone (ISO-8601. If offset is 0, output is `'+00:00'` or equivalent)
  x: function(r, e, t) {
    const n = r.getTimezoneOffset();
    switch (e) {
      // Hours and optional minutes
      case "x":
        return Ve(n);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xx`
      case "xxxx":
      case "xx":
        return Z(n);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xxx`
      case "xxxxx":
      case "xxx":
      // Hours and minutes with `:` delimiter
      default:
        return Z(n, ":");
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
        return "GMT" + je(n, ":");
      // Long
      case "OOOO":
      default:
        return "GMT" + Z(n, ":");
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
        return "GMT" + je(n, ":");
      // Long
      case "zzzz":
      default:
        return "GMT" + Z(n, ":");
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
function je(r, e = "") {
  const t = r > 0 ? "-" : "+", n = Math.abs(r), i = Math.trunc(n / 60), o = n % 60;
  return o === 0 ? t + String(i) : t + String(i) + e + A(o, 2);
}
function Ve(r, e) {
  return r % 60 === 0 ? (r > 0 ? "-" : "+") + A(Math.abs(r) / 60, 2) : Z(r, e);
}
function Z(r, e = "") {
  const t = r > 0 ? "-" : "+", n = Math.abs(r), i = A(Math.trunc(n / 60), 2), o = A(n % 60, 2);
  return t + i + e + o;
}
const He = (r, e) => {
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
}, st = (r, e) => {
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
}, Jr = (r, e) => {
  const t = r.match(/(P+)(p+)?/) || [], n = t[1], i = t[2];
  if (!i)
    return He(r, e);
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
  return o.replace("{{date}}", He(n, e)).replace("{{time}}", st(i, e));
}, Zr = {
  p: st,
  P: Jr
}, en = /^D+$/, tn = /^Y+$/, rn = ["D", "DD", "YY", "YYYY"];
function nn(r) {
  return en.test(r);
}
function sn(r) {
  return tn.test(r);
}
function an(r, e, t) {
  const n = on(r, e, t);
  if (console.warn(n), rn.includes(r)) throw new RangeError(n);
}
function on(r, e, t) {
  const n = r[0] === "Y" ? "years" : "days of the month";
  return `Use \`${r.toLowerCase()}\` instead of \`${r}\` (in \`${e}\`) for formatting ${n} to the input \`${t}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`;
}
const cn = /[yYQqMLwIdDecihHKkms]o|(\w)\1*|''|'(''|[^'])+('|$)|./g, un = /P+p+|P+|p+|''|'(''|[^'])+('|$)|./g, ln = /^'([^]*?)'?$/, dn = /''/g, hn = /[a-zA-Z]/;
function he(r, e, t) {
  var d, h, w, m, f, p, C, E;
  const n = we(), i = (t == null ? void 0 : t.locale) ?? n.locale ?? Qr, o = (t == null ? void 0 : t.firstWeekContainsDate) ?? ((h = (d = t == null ? void 0 : t.locale) == null ? void 0 : d.options) == null ? void 0 : h.firstWeekContainsDate) ?? n.firstWeekContainsDate ?? ((m = (w = n.locale) == null ? void 0 : w.options) == null ? void 0 : m.firstWeekContainsDate) ?? 1, a = (t == null ? void 0 : t.weekStartsOn) ?? ((p = (f = t == null ? void 0 : t.locale) == null ? void 0 : f.options) == null ? void 0 : p.weekStartsOn) ?? n.weekStartsOn ?? ((E = (C = n.locale) == null ? void 0 : C.options) == null ? void 0 : E.weekStartsOn) ?? 0, c = j(r, t == null ? void 0 : t.in);
  if (!fr(c))
    throw new RangeError("Invalid time value");
  let u = e.match(un).map((x) => {
    const v = x[0];
    if (v === "p" || v === "P") {
      const M = Zr[v];
      return M(x, i.formatLong);
    }
    return x;
  }).join("").match(cn).map((x) => {
    if (x === "''")
      return { isToken: !1, value: "'" };
    const v = x[0];
    if (v === "'")
      return { isToken: !1, value: fn(x) };
    if (Ye[v])
      return { isToken: !0, value: x };
    if (v.match(hn))
      throw new RangeError(
        "Format string contains an unescaped latin alphabet character `" + v + "`"
      );
    return { isToken: !1, value: x };
  });
  i.localize.preprocessor && (u = i.localize.preprocessor(c, u));
  const l = {
    firstWeekContainsDate: o,
    weekStartsOn: a,
    locale: i
  };
  return u.map((x) => {
    if (!x.isToken) return x.value;
    const v = x.value;
    (!(t != null && t.useAdditionalWeekYearTokens) && sn(v) || !(t != null && t.useAdditionalDayOfYearTokens) && nn(v)) && an(v, e, String(r));
    const M = Ye[v[0]];
    return M(c, v, i.localize, l);
  }).join("");
}
function fn(r) {
  const e = r.match(ln);
  return e ? e[1].replace(dn, "'") : r;
}
var gn = s.from_html('<div class="split-view"><div class="split-view-content isolate svelte-ea3q70"><div class="split-view-left custom-scrollbar h-full overflow-y-auto"><!></div>  <div class="w-1 hover:w-2 cursor-ew-resize hover:bg-[var(--border-color)] transition-all z-10" role="separator" aria-orientation="vertical"></div> <div class="split-view-right h-full"><!></div></div></div>');
function mn(r, e) {
  let t = s.prop(e, "leftWidth", 3, "33.333%"), n = s.prop(e, "minLeftWidth", 3, 200), i = s.prop(e, "maxLeftWidth", 3, 800), o = s.state(!1), a = s.state(0), c = s.state(0), u = s.state(void 0), l = s.state(void 0);
  function d(M) {
    var S;
    s.set(o, !0), s.set(a, M.pageX, !0), s.set(c, ((S = s.get(u)) == null ? void 0 : S.offsetWidth) ?? 0, !0), window.addEventListener("mousemove", h), window.addEventListener("mouseup", w), document.body.style.cursor = "ew-resize", document.body.style.userSelect = "none";
  }
  function h(M) {
    if (!s.get(o) || !s.get(u)) return;
    const S = M.pageX - s.get(a), I = Math.min(Math.max(s.get(c) + S, n()), i());
    s.get(u).style.width = `${I}px`;
  }
  function w() {
    s.set(o, !1), window.removeEventListener("mousemove", h), window.removeEventListener("mouseup", w), document.body.style.cursor = "", document.body.style.userSelect = "";
  }
  var m = gn(), f = s.child(m), p = s.child(f), C = s.child(p);
  s.snippet(C, () => e.left ?? s.noop), s.reset(p), s.bind_this(p, (M) => s.set(u, M), () => s.get(u));
  var E = s.sibling(p, 2), x = s.sibling(E, 2), v = s.child(x);
  s.snippet(v, () => e.right ?? s.noop), s.reset(x), s.bind_this(x, (M) => s.set(l, M), () => s.get(l)), s.reset(f), s.reset(m), s.template_effect(() => s.set_style(p, `width: ${(typeof t() == "number" ? `${t()}px` : t()) ?? ""}`)), s.delegated("mousedown", E, d), s.append(r, m);
}
s.delegate(["mousedown"]);
var wn = s.from_html('<div class="p-4 text-center text-sm text-gray-500">No items found</div>'), yn = s.from_html('<div class="ml-2 flex-shrink-0 text-white opacity-90 text-[10px] font-medium tracking-wide">↵</div>'), bn = s.from_html('<div role="option"><div class="mr-3 flex-shrink-0 flex items-center justify-center"></div> <div class="flex-1 overflow-hidden flex flex-col justify-center gap-0.5"><div> </div> <div><!></div></div> <!></div>'), pn = s.from_html('<div class="h-full overflow-y-auto focus:outline-none bg-white dark:bg-[#1e1e1e] py-2 border-r border-gray-100 dark:border-gray-800 custom-scrollbar svelte-oje4kk" role="listbox" aria-label="Clipboard Items" tabindex="0"><!></div>'), xn = s.from_html('<span class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"></path></svg> </span>'), vn = s.from_html('<div class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar svelte-oje4kk"></div> <div class="h-12 border-t border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-[#1e1e1e]/80 backdrop-blur-md flex items-center px-4 justify-between text-xs text-gray-500 dark:text-gray-400 shadow-sm z-10"><div class="flex items-center space-x-3"><span class="font-medium uppercase tracking-wider text-[10px] bg-gray-200 dark:bg-gray-800 px-2 py-0.5 rounded"> </span> <span class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> </span> <!></div> <div class="flex items-center gap-1.5 opacity-80 font-medium"><kbd class="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-sans shadow-sm svelte-oje4kk">Enter</kbd> <span>to Paste</span></div></div>', 1), An = s.from_html('<div class="flex h-full items-center justify-center flex-col gap-4 text-gray-400 dark:text-gray-600"><svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg> <span class="text-sm font-medium">Select an item to view details</span></div>'), Cn = s.from_html('<div class="h-full flex flex-col bg-gray-50/50 dark:bg-[#161616]/50 overflow-hidden relative"><!></div>');
function zn(r, e) {
  s.push(e, !1);
  const t = () => s.store_get(W, "$clipboardViewState", n), [n, i] = s.setup_stores(), o = s.mutable_source(), a = s.mutable_source(), c = s.mutable_source();
  let u = s.mutable_source();
  lt(async () => {
    await dt();
  });
  function l() {
    requestAnimationFrame(() => {
      var p;
      const f = (p = s.get(u)) == null ? void 0 : p.querySelector(`[data-index="${s.get(c)}"]`);
      if (f) {
        const C = s.get(u).getBoundingClientRect(), E = f.getBoundingClientRect(), x = E.top < C.top, v = E.bottom > C.bottom;
        x ? f.scrollIntoView({ block: "start", behavior: "auto" }) : v && f.scrollIntoView({ block: "end", behavior: "auto" });
      }
    });
  }
  function d(f) {
    W.setSelectedItem(f);
  }
  function h(f) {
    return !f || !f.content ? "Empty" : f.type === "image" ? "Image Data" : f.content.replace(/\n/g, " ").trim();
  }
  function w(f, p) {
    const C = p ? "currentColor" : "var(--icon-color, #888)";
    switch (f) {
      case "image":
        return `<svg class="w-4 h-4" style="color: ${C}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`;
      case "html":
        return `<svg class="w-4 h-4" style="color: ${C}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>`;
      default:
        return `<svg class="w-4 h-4" style="color: ${C}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>`;
    }
  }
  function m(f) {
    if (!f || !f.content)
      return '<span class="text-gray-400">No preview available</span>';
    switch (f.type) {
      case "image":
        let p = f.content.replace("data:image/png;base64, ", "data:image/png;base64,");
        return p.startsWith("data:") || (p = `data:image/png;base64,${p}`), p.includes("AAAAAAAA") ? '<div class="text-gray-400">Broken image</div>' : `<div class="image-container w-full h-full flex flex-col items-center justify-center p-4">
        <img src="${p}" class="max-w-full max-h-full object-contain rounded-md shadow-sm border border-gray-200 dark:border-gray-800" alt="Preview"/>
      </div>`;
      case "html":
      case "text":
      default:
        return `<pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-gray-800 dark:text-gray-200">${f.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
    }
  }
  s.legacy_pre_effect(() => (t(), W), () => {
    s.set(o, t().filtered ? W.search(t().items, t().searchQuery) : t().items);
  }), s.legacy_pre_effect(() => t(), () => {
    s.set(a, t().selectedItem);
  }), s.legacy_pre_effect(() => t(), () => {
    s.set(c, t().selectedIndex);
  }), s.legacy_pre_effect(() => s.get(c), () => {
    s.get(c) !== void 0 && l();
  }), s.legacy_pre_effect_reset(), s.init(), mn(r, {
    leftWidth: 260,
    minLeftWidth: 200,
    maxLeftWidth: 600,
    left: (C) => {
      var E = pn(), x = s.child(E);
      {
        var v = (S) => {
          var I = wn();
          s.append(S, I);
        }, M = (S) => {
          var I = s.comment(), D = s.first_child(I);
          s.each(D, 3, () => s.get(o), (B) => B.id, (B, _, $) => {
            var O = bn(), P = s.child(O);
            s.html(
              P,
              () => (s.get(_), s.get(c), s.deep_read_state(s.get($)), s.untrack(() => w(s.get(_).type, s.get(c) === s.get($)))),
              !0
            ), s.reset(P);
            var re = s.sibling(P, 2), k = s.child(re), Q = s.child(k, !0);
            s.reset(k);
            var N = s.sibling(k, 2), ie = s.child(N);
            {
              var ye = (T) => {
                var K = s.text();
                s.template_effect((be) => s.set_text(K, `Match: ${be ?? ""}%`), [
                  () => (s.get(_), s.untrack(() => Math.round((1 - (typeof s.get(_).score == "number" ? s.get(_).score : 0)) * 100)))
                ]), s.append(T, K);
              }, ce = (T) => {
                var K = s.text();
                s.template_effect((be) => s.set_text(K, be), [
                  () => (s.deep_read_state(he), s.get(_), s.untrack(() => he(s.get(_).createdAt, "MMM d, yyyy · p")))
                ]), s.append(T, K);
              };
              s.if(ie, (T) => {
                t(), s.get(_), s.untrack(() => t().searchQuery && "score" in s.get(_)) ? T(ye) : T(ce, -1);
              });
            }
            s.reset(N), s.reset(re);
            var at = s.sibling(re, 2);
            {
              var ot = (T) => {
                var K = yn();
                s.append(T, K);
              };
              s.if(at, (T) => {
                s.get(c) === s.get($) && T(ot);
              });
            }
            s.reset(O), s.template_effect(
              (T) => {
                s.set_attribute(O, "data-index", s.get($)), s.set_class(O, 1, `group flex items-center px-3 py-2 mx-2 my-0.5 rounded-lg cursor-default transition-colors ${s.get(c) === s.get($) ? "bg-blue-500 text-white shadow-sm" : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200"}`), s.set_attribute(O, "aria-selected", s.get(c) === s.get($)), s.set_class(k, 1, `truncate text-[13px] font-medium leading-none ${s.get(c) === s.get($) ? "text-white" : "text-gray-900 dark:text-gray-100"}`), s.set_text(Q, T), s.set_class(N, 1, `truncate text-[11px] leading-none ${s.get(c) === s.get($) ? "text-blue-100" : "text-gray-500 dark:text-gray-400"}`);
              },
              [
                () => (s.get(_), s.untrack(() => h(s.get(_))))
              ]
            ), s.event("click", O, () => d(s.get($))), s.event("dblclick", O, () => W.handleItemAction(s.get(_), "paste")), s.append(B, O);
          }), s.append(S, I);
        };
        s.if(x, (S) => {
          s.get(o), s.untrack(() => s.get(o).length === 0) ? S(v) : S(M, -1);
        });
      }
      s.reset(E), s.bind_this(E, (S) => s.set(u, S), () => s.get(u)), s.append(C, E);
    },
    right: (C) => {
      var E = Cn(), x = s.child(E);
      {
        var v = (S) => {
          var I = vn(), D = s.first_child(I);
          s.html(
            D,
            () => (s.get(a), s.untrack(() => m(s.get(a)))),
            !0
          ), s.reset(D);
          var B = s.sibling(D, 2), _ = s.child(B), $ = s.child(_), O = s.child($, !0);
          s.reset($);
          var P = s.sibling($, 2), re = s.sibling(s.child(P));
          s.reset(P);
          var k = s.sibling(P, 2);
          {
            var Q = (N) => {
              var ie = xn(), ye = s.sibling(s.child(ie));
              s.reset(ie), s.template_effect(() => s.set_text(ye, ` ${s.get(a), s.untrack(() => {
                var ce;
                return ((ce = s.get(a).content) == null ? void 0 : ce.length) || 0;
              }) ?? ""} chars`)), s.append(N, ie);
            };
            s.if(k, (N) => {
              s.get(a), s.untrack(() => s.get(a).type !== "image") && N(Q);
            });
          }
          s.reset(_), s.next(2), s.reset(B), s.template_effect(
            (N) => {
              s.set_text(O, (s.get(a), s.untrack(() => s.get(a).type))), s.set_text(re, ` ${N ?? ""}`);
            },
            [
              () => (s.deep_read_state(he), s.get(a), s.untrack(() => he(s.get(a).createdAt, "PPpp")))
            ]
          ), s.append(S, I);
        }, M = (S) => {
          var I = An();
          s.append(S, I);
        };
        s.if(x, (S) => {
          s.get(a) ? S(v) : S(M, -1);
        });
      }
      s.reset(E), s.append(C, E);
    },
    $$slots: { left: !0, right: !0 }
  }), s.pop(), i();
}
class En {
  constructor() {
    F(this, "_isTauri", null);
  }
  /**
   * Detects if the application is running within a Tauri environment.
   */
  get isTauri() {
    return this._isTauri !== null ? this._isTauri : (this._isTauri = typeof window < "u" && window.__TAURI_INTERNALS__ !== void 0, y.debug(`[EnvService] Environment detection: isTauri = ${this._isTauri}`), this._isTauri);
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
const J = new En();
async function _n(r) {
  return Y("search_items", { query: r });
}
async function Mn(r) {
  return Y("index_item", { item: r });
}
async function Sn(r) {
  return Y("batch_index_items", { items: r });
}
async function Dn(r) {
  return Y("delete_item", { objectId: r });
}
async function kn() {
  return Y("get_indexed_object_ids").then((r) => new Set(r));
}
async function Fn() {
  return Y("reset_search_index");
}
async function $n() {
  return Y("save_search_index");
}
class In {
  async performSearch(e) {
    if (J.isBrowser)
      return y.debug(`Browser mode: providing fallback search for "${e}"`), this.getBrowserFallbacks(e);
    try {
      const t = await _n(e);
      return y.debug(`Search results for "${e}": ${t}`), t;
    } catch (t) {
      return y.error(`Search failed: ${t}`), [];
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
    if (!e) return t;
    const n = e.toLowerCase();
    return t.filter(
      (i) => {
        var o;
        return i.name.toLowerCase().includes(n) || ((o = i.description) == null ? void 0 : o.toLowerCase().includes(n));
      }
    );
  }
  /**
   * Indexes a single item (Application or Command) by calling the Rust backend.
   * Handles updates automatically (Rust's index_item deletes then adds).
   */
  async indexItem(e) {
    if (J.isBrowser) {
      y.debug(`Browser mode: skipping indexing for ${e.name}`);
      return;
    }
    try {
      y.debug(
        `Indexing item category: ${e.category}, name: ${e.name}`
      ), await Mn(e);
    } catch (t) {
      y.error(`Failed indexing item ${e.name}: ${t}`);
    }
  }
  /**
   * Indexes multiple items in a single Rust call with one disk write.
   * Use this for bulk operations (startup app scan, command sync) instead
   * of calling indexItem() in a loop.
   */
  async batchIndexItems(e) {
    if (!(J.isBrowser || e.length === 0))
      try {
        y.debug(`Batch indexing ${e.length} items`), await Sn(e);
      } catch (t) {
        y.error(`Failed batch indexing ${e.length} items: ${t}`);
      }
  }
  /**
   * Deletes an item from the index by its object ID.
   */
  async deleteItem(e) {
    if (!J.isBrowser)
      try {
        y.debug(`Deleting item with objectId: ${e}`), await Dn(e);
      } catch (t) {
        y.error(`Failed deleting item ${e}: ${t}`);
      }
  }
  /**
   * Gets all indexed object IDs, optionally filtering by prefix.
   */
  async getIndexedObjectIds(e) {
    if (J.isBrowser) return /* @__PURE__ */ new Set();
    try {
      y.debug(
        `Fetching indexed object IDs ${e ? `with prefix "${e}"` : ""}...`
      );
      const t = await kn();
      if (!e)
        return t;
      const n = /* @__PURE__ */ new Set();
      return t.forEach((i) => {
        i.startsWith(e) && n.add(i);
      }), y.debug(
        `Found ${n.size} IDs with prefix "${e}".`
      ), n;
    } catch (t) {
      return y.error(`Failed to get indexed object IDs: ${t}`), /* @__PURE__ */ new Set();
    }
  }
  // Optional: Add a method to reset the index
  async resetIndex() {
    if (!J.isBrowser)
      try {
        y.info("Requesting search index reset..."), await Fn(), y.info("Search index reset successful.");
      } catch (e) {
        y.error(`Failed to reset search index: ${e}`);
      }
  }
  /**
   * Explicitly saves the search index to disk.
   * Currently used before hiding the launcher to persist usage counts.
   */
  async saveIndex() {
    if (!J.isBrowser)
      try {
        await $n();
      } catch (e) {
        y.error(`Failed to save search index: ${e}`);
      }
  }
}
const Bn = new In(), ve = ke(
  /* @__PURE__ */ new Map()
);
class On {
  // Store the reference
  constructor() {
    F(this, "commands", /* @__PURE__ */ new Map());
    F(this, "extensionManager", null);
    ve.set(this.commands);
  }
  /**
   * Initialize the service with necessary dependencies.
   * Should be called once during application startup.
   * @param manager - The ExtensionManager instance.
   */
  initialize(e) {
    if (this.extensionManager) {
      y.warn("CommandService already initialized.");
      return;
    }
    this.extensionManager = e, y.debug(
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
    }), y.debug(
      `Registered command: ${e} from extension: ${n}`
    ), ve.set(this.commands);
  }
  /**
   * Unregister a command
   */
  unregisterCommand(e) {
    this.commands.delete(e) ? (ve.set(this.commands), y.debug(`Unregistered command: ${e}`)) : y.warn(
      `Attempted to unregister non-existent command: ${e}`
    );
  }
  /**
   * Execute a registered command
   */
  async executeCommand(e, t) {
    y.debug(`[CommandService] executeCommand called with ID: ${e}`);
    const n = this.commands.get(e);
    if (!n)
      throw new Error(`Command not found: ${e}`);
    y.info(
      `EXTENSION_TRACKED: Executing command: ${e} from extension: ${n.extensionId} with args: ${JSON.stringify(t || {})}`
    );
    try {
      return y.debug(`[CommandService] Found handler for ${e}. Executing...`), await n.handler.execute(t);
    } catch (i) {
      throw y.error(`Error executing command ${e}: ${i}`), i;
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
new On();
const Pn = ke([]), te = class te {
  constructor() {
    F(this, "allActions", /* @__PURE__ */ new Map());
    F(this, "currentContext", L.CORE);
    F(this, "sendToExtension");
    this.registerBuiltInActions();
  }
  setExtensionForwarder(e) {
    this.sendToExtension = e;
  }
  static getInstance() {
    return te.instance || (te.instance = new te()), te.instance;
  }
  /**
   * Set the current action context and optional data (e.g., commandId)
   */
  setContext(e) {
    this.currentContext !== e && (this.currentContext = e, y.debug(`Action context set to: ${e}`), this.updateStore());
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
      context: e.context || L.EXTENSION_VIEW,
      execute: e.execute,
      disabled: "disabled" in e ? e.disabled : void 0
    };
    this.allActions.set(t.id, t), y.debug(
      `Registered action: ${t.id} from ${t.extensionId || "core"}, context: ${t.context || "default"}`
    ), this.updateStore();
  }
  /**
   * Unregister an action
   */
  unregisterAction(e) {
    this.allActions.delete(e) ? (y.debug(`Unregistered action: ${e}`), this.updateStore()) : y.warn(
      `Attempted to unregister non-existent action: ${e}`
    );
  }
  /**
   * Remove all actions registered by a specific extension.
   * Call this when an extension view is closed to prevent stale actions from persisting.
   */
  clearActionsForExtension(e) {
    let t = !1;
    for (const [n, i] of this.allActions)
      i.extensionId === e && (this.allActions.delete(n), t = !0);
    t && (y.debug(`[ActionService] Cleared all actions for extension: ${e}`), this.updateStore());
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
    return y.debug(
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
    return t === L.COMMAND_RESULT && y.warn(
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
    return e.context === this.currentContext || e.context === L.GLOBAL && (this.currentContext === L.CORE || this.currentContext === L.EXTENSION_VIEW) ? !0 : this.currentContext === L.CORE && e.context === L.CORE ? Array.from(this.allActions.values()).filter(
      (i) => i.context === this.currentContext && i.context !== L.CORE && i.context !== L.GLOBAL
    ).length === 0 : !1;
  }
  /**
   * Execute an action by ID
   */
  async executeAction(e) {
    const t = this.allActions.get(e);
    if (!t)
      throw new Error(`Action not found: ${e}`);
    y.info(
      `Executing action: ${e} from ${t.extensionId || "core"}`
    );
    try {
      if (typeof t.execute == "function")
        await t.execute();
      else if (t.extensionId && this.sendToExtension)
        this.sendToExtension(t.extensionId, e);
      else
        throw new Error(`Action execute is not a function: ${e}`);
    } catch (n) {
      throw y.error(`Error executing action ${e}: ${n}`), n;
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
      context: L.CORE,
      execute: async () => {
        y.info("Executing built-in action: Open Settings");
        try {
          await Y("plugin:window|show", { label: "settings" });
        } catch (e) {
          y.error(`Failed to open settings window: ${e}`);
        }
      }
    }), this.registerAction({
      // Use registerAction for consistency
      id: "reset_search",
      label: "Reset Search Index",
      icon: "🔄",
      description: "Reset the search index",
      category: "System",
      context: L.CORE,
      execute: async () => {
        y.info("Executing built-in action: Reset Search Index"), await Bn.resetIndex();
      }
    });
  }
  /**
   * Update the action store with currently relevant actions based on context
   */
  updateStore() {
    const e = this.getFilteredActions();
    Pn.set(e);
  }
};
F(te, "instance");
let De = te;
const ze = De.getInstance(), Wn = [
  {
    id: "clipboard-history",
    title: "Clipboard History",
    subtitle: "View and manage your clipboard history",
    keywords: "clipboard copy paste history"
  }
], Rn = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["title", "subtitle", "keywords"]
};
new z(Wn, Rn);
class Nn {
  constructor() {
    F(this, "onUnload");
    F(this, "logService");
    F(this, "extensionManager");
    F(this, "clipboardService");
    F(this, "inView", !1);
    F(this, "context");
    F(this, "handleKeydownBound", (e) => this.handleKeydown(e));
  }
  async initialize(e) {
    var t, n;
    try {
      if (this.context = e, this.logService = e.getService("LogService"), this.extensionManager = e.getService("ExtensionManager"), this.clipboardService = e.getService(
        "ClipboardHistoryService"
      ), !this.logService || !this.extensionManager || !this.clipboardService) {
        y.error(
          "Failed to initialize required services for Clipboard History"
        ), (t = this.logService) == null || t.error(
          "Failed to initialize required services for Clipboard History"
        );
        return;
      }
      W.initializeServices(e), this.logService.info(
        "Clipboard History extension initialized with services"
      );
    } catch (i) {
      y.error(`Clipboard History initialization failed: ${i}`), (n = this.logService) == null || n.error(
        `Clipboard History initialization failed: ${i}`
      );
    }
  }
  async executeCommand(e, t) {
    var n, i, o;
    switch ((n = this.logService) == null || n.info(`Executing clipboard command: ${e}`), e) {
      case "show-clipboard":
        return await this.refreshClipboardData(), (i = this.extensionManager) == null || i.navigateToView(
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
    const t = Ge(W);
    t.items.length && (e.key === "ArrowUp" || e.key === "ArrowDown" ? (e.preventDefault(), e.stopPropagation(), W.moveSelection(e.key === "ArrowUp" ? "up" : "down")) : e.key === "Enter" && t.selectedItem && (e.preventDefault(), e.stopPropagation(), W.handleItemAction(t.selectedItem, "paste")));
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
        var i, o, a, c;
        try {
          confirm(
            "Are you sure you want to clear all non-favorite clipboard items?"
          ) && (await ((i = this.clipboardService) == null ? void 0 : i.clearNonFavorites()) ? (o = this.logService) == null || o.info("Non-favorite clipboard history cleared") : (a = this.logService) == null || a.warn(
            "Clearing non-favorite clipboard history reported failure."
          ), await this.refreshClipboardData());
        } catch (u) {
          (c = this.logService) == null || c.error(`Failed to clear clipboard history: ${u}`);
        }
      }
    };
    ze.registerAction(e);
  }
  // Helper method to unregister view-specific actions
  unregisterViewActions() {
    var e;
    (e = this.logService) == null || e.debug("Unregistering clipboard view actions..."), ze.unregisterAction("clipboard-history:clipboard-reset-history");
  }
  // Called when this extension's view is deactivated
  async viewDeactivated(e) {
    var t, n;
    this.unregisterViewActions(), (t = this.extensionManager) == null || t.setActiveViewActionLabel(null), this.inView = !1, (n = this.logService) == null || n.debug(`Clipboard History view deactivated: ${e}`);
  }
  async onViewSearch(e) {
    W.setSearch(e);
  }
  async refreshClipboardData() {
    var e, t;
    if (this.clipboardService) {
      W.setLoading(!0);
      try {
        const n = await this.clipboardService.getRecentItems(100);
        W.setItems(n || []);
      } catch (n) {
        (e = this.logService) == null || e.error(`Failed to load clipboard data: ${n}`), W.setError(`Failed to load clipboard data: ${n}`);
      } finally {
        W.setLoading(!1);
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
const Gn = new Nn();
export {
  zn as DefaultView,
  Gn as default
};
