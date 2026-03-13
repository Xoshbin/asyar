var Ve = Object.defineProperty;
var ze = (r, e, t) => e in r ? Ve(r, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : r[e] = t;
var R = (r, e, t) => ze(r, typeof e != "symbol" ? e + "" : e, t);
import { writable as Qe, get as qe } from "svelte/store";
import "svelte/internal/disclose-version";
import "svelte/internal/flags/legacy";
import * as c from "svelte/internal/client";
import { onMount as Ge, onDestroy as Xe } from "svelte";
import { SplitView as Ke } from "asyar-api";
function N(r) {
  return Array.isArray ? Array.isArray(r) : Oe(r) === "[object Array]";
}
function Je(r) {
  if (typeof r == "string")
    return r;
  let e = r + "";
  return e == "0" && 1 / r == -1 / 0 ? "-0" : e;
}
function Ue(r) {
  return r == null ? "" : Je(r);
}
function L(r) {
  return typeof r == "string";
}
function ke(r) {
  return typeof r == "number";
}
function Ze(r) {
  return r === !0 || r === !1 || et(r) && Oe(r) == "[object Boolean]";
}
function Pe(r) {
  return typeof r == "object";
}
function et(r) {
  return Pe(r) && r !== null;
}
function k(r) {
  return r != null;
}
function ce(r) {
  return !r.trim().length;
}
function Oe(r) {
  return r == null ? r === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(r);
}
const tt = "Incorrect 'index' type", rt = (r) => `Invalid value for key ${r}`, nt = (r) => `Pattern length exceeds max of ${r}.`, st = (r) => `Missing ${r} property in key`, it = (r) => `Property 'weight' in key '${r}' must be a positive integer`, pe = Object.prototype.hasOwnProperty;
class at {
  constructor(e) {
    this._keys = [], this._keyMap = {};
    let t = 0;
    e.forEach((n) => {
      let s = Be(n);
      this._keys.push(s), this._keyMap[s.id] = s, t += s.weight;
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
function Be(r) {
  let e = null, t = null, n = null, s = 1, a = null;
  if (L(r) || N(r))
    n = r, e = be(r), t = de(r);
  else {
    if (!pe.call(r, "name"))
      throw new Error(st("name"));
    const i = r.name;
    if (n = i, pe.call(r, "weight") && (s = r.weight, s <= 0))
      throw new Error(it(i));
    e = be(i), t = de(i), a = r.getFn;
  }
  return { path: e, id: t, weight: s, src: n, getFn: a };
}
function be(r) {
  return N(r) ? r : r.split(".");
}
function de(r) {
  return N(r) ? r.join(".") : r;
}
function ot(r, e) {
  let t = [], n = !1;
  const s = (a, i, o) => {
    if (k(a))
      if (!i[o])
        t.push(a);
      else {
        let u = i[o];
        const l = a[u];
        if (!k(l))
          return;
        if (o === i.length - 1 && (L(l) || ke(l) || Ze(l)))
          t.push(Ue(l));
        else if (N(l)) {
          n = !0;
          for (let d = 0, h = l.length; d < h; d += 1)
            s(l[d], i, o + 1);
        } else i.length && s(l, i, o + 1);
      }
  };
  return s(r, L(e) ? e.split(".") : e, 0), n ? t : t[0];
}
const ct = {
  // Whether the matches should be included in the result set. When `true`, each record in the result
  // set will include the indices of the matched characters.
  // These can consequently be used for highlighting purposes.
  includeMatches: !1,
  // When `true`, the matching function will continue to the end of a search pattern even if
  // a perfect match has already been located in the string.
  findAllMatches: !1,
  // Minimum number of characters that must be matched before a result is considered a match
  minMatchCharLength: 1
}, ut = {
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
}, lt = {
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
}, dt = {
  // When `true`, it enables the use of unix-like search commands
  useExtendedSearch: !1,
  // The get function to use when fetching an object's properties.
  // The default will search nested paths *ie foo.bar.baz*
  getFn: ot,
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
var f = {
  ...ut,
  ...ct,
  ...lt,
  ...dt
};
const ht = /[^ ]+/g;
function ft(r = 1, e = 3) {
  const t = /* @__PURE__ */ new Map(), n = Math.pow(10, e);
  return {
    get(s) {
      const a = s.match(ht).length;
      if (t.has(a))
        return t.get(a);
      const i = 1 / Math.pow(a, 0.5 * r), o = parseFloat(Math.round(i * n) / n);
      return t.set(a, o), o;
    },
    clear() {
      t.clear();
    }
  };
}
class ye {
  constructor({
    getFn: e = f.getFn,
    fieldNormWeight: t = f.fieldNormWeight
  } = {}) {
    this.norm = ft(t, 3), this.getFn = e, this.isCreated = !1, this.setIndexRecords();
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
    this.isCreated || !this.docs.length || (this.isCreated = !0, L(this.docs[0]) ? this.docs.forEach((e, t) => {
      this._addString(e, t);
    }) : this.docs.forEach((e, t) => {
      this._addObject(e, t);
    }), this.norm.clear());
  }
  // Adds a doc to the end of the index
  add(e) {
    const t = this.size();
    L(e) ? this._addString(e, t) : this._addObject(e, t);
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
    if (!k(e) || ce(e))
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
    this.keys.forEach((s, a) => {
      let i = s.getFn ? s.getFn(e) : this.getFn(e, s.path);
      if (k(i)) {
        if (N(i)) {
          let o = [];
          const u = [{ nestedArrIndex: -1, value: i }];
          for (; u.length; ) {
            const { nestedArrIndex: l, value: d } = u.pop();
            if (k(d))
              if (L(d) && !ce(d)) {
                let h = {
                  v: d,
                  i: l,
                  n: this.norm.get(d)
                };
                o.push(h);
              } else N(d) && d.forEach((h, w) => {
                u.push({
                  nestedArrIndex: w,
                  value: h
                });
              });
          }
          n.$[a] = o;
        } else if (L(i) && !ce(i)) {
          let o = {
            v: i,
            n: this.norm.get(i)
          };
          n.$[a] = o;
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
function Ie(r, e, { getFn: t = f.getFn, fieldNormWeight: n = f.fieldNormWeight } = {}) {
  const s = new ye({ getFn: t, fieldNormWeight: n });
  return s.setKeys(r.map(Be)), s.setSources(e), s.create(), s;
}
function gt(r, { getFn: e = f.getFn, fieldNormWeight: t = f.fieldNormWeight } = {}) {
  const { keys: n, records: s } = r, a = new ye({ getFn: e, fieldNormWeight: t });
  return a.setKeys(n), a.setIndexRecords(s), a;
}
function te(r, {
  errors: e = 0,
  currentLocation: t = 0,
  expectedLocation: n = 0,
  distance: s = f.distance,
  ignoreLocation: a = f.ignoreLocation
} = {}) {
  const i = e / r.length;
  if (a)
    return i;
  const o = Math.abs(n - t);
  return s ? i + o / s : o ? 1 : i;
}
function mt(r = [], e = f.minMatchCharLength) {
  let t = [], n = -1, s = -1, a = 0;
  for (let i = r.length; a < i; a += 1) {
    let o = r[a];
    o && n === -1 ? n = a : !o && n !== -1 && (s = a - 1, s - n + 1 >= e && t.push([n, s]), n = -1);
  }
  return r[a - 1] && a - n >= e && t.push([n, a - 1]), t;
}
const q = 32;
function wt(r, e, t, {
  location: n = f.location,
  distance: s = f.distance,
  threshold: a = f.threshold,
  findAllMatches: i = f.findAllMatches,
  minMatchCharLength: o = f.minMatchCharLength,
  includeMatches: u = f.includeMatches,
  ignoreLocation: l = f.ignoreLocation
} = {}) {
  if (e.length > q)
    throw new Error(nt(q));
  const d = e.length, h = r.length, w = Math.max(0, Math.min(n, h));
  let m = a, y = w;
  const p = o > 1 || u, E = p ? Array(h) : [];
  let O;
  for (; (O = r.indexOf(e, y)) > -1; ) {
    let A = te(e, {
      currentLocation: O,
      expectedLocation: w,
      distance: s,
      ignoreLocation: l
    });
    if (m = Math.min(A, m), y = O + d, p) {
      let M = 0;
      for (; M < d; )
        E[O + M] = 1, M += 1;
    }
  }
  y = -1;
  let g = [], C = 1, b = d + h;
  const P = 1 << d - 1;
  for (let A = 0; A < d; A += 1) {
    let M = 0, x = b;
    for (; M < x; )
      te(e, {
        errors: A,
        currentLocation: w + x,
        expectedLocation: w,
        distance: s,
        ignoreLocation: l
      }) <= m ? M = x : b = x, x = Math.floor((b - M) / 2 + M);
    b = x;
    let $ = Math.max(1, w - x + 1), I = i ? h : Math.min(w + x, h) + d, F = Array(I + 2);
    F[I + 1] = (1 << A) - 1;
    for (let S = I; S >= $; S -= 1) {
      let T = S - 1, z = t[r.charAt(T)];
      if (p && (E[T] = +!!z), F[S] = (F[S + 1] << 1 | 1) & z, A && (F[S] |= (g[S + 1] | g[S]) << 1 | 1 | g[S + 1]), F[S] & P && (C = te(e, {
        errors: A,
        currentLocation: T,
        expectedLocation: w,
        distance: s,
        ignoreLocation: l
      }), C <= m)) {
        if (m = C, y = T, y <= w)
          break;
        $ = Math.max(1, 2 * w - y);
      }
    }
    if (te(e, {
      errors: A + 1,
      currentLocation: w,
      expectedLocation: w,
      distance: s,
      ignoreLocation: l
    }) > m)
      break;
    g = F;
  }
  const D = {
    isMatch: y >= 0,
    // Count exact matches (those with a score of 0) to be "almost" exact
    score: Math.max(1e-3, C)
  };
  if (p) {
    const A = mt(E, o);
    A.length ? u && (D.indices = A) : D.isMatch = !1;
  }
  return D;
}
function yt(r) {
  let e = {};
  for (let t = 0, n = r.length; t < n; t += 1) {
    const s = r.charAt(t);
    e[s] = (e[s] || 0) | 1 << n - t - 1;
  }
  return e;
}
const ne = String.prototype.normalize ? (r) => r.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "") : (r) => r;
class Le {
  constructor(e, {
    location: t = f.location,
    threshold: n = f.threshold,
    distance: s = f.distance,
    includeMatches: a = f.includeMatches,
    findAllMatches: i = f.findAllMatches,
    minMatchCharLength: o = f.minMatchCharLength,
    isCaseSensitive: u = f.isCaseSensitive,
    ignoreDiacritics: l = f.ignoreDiacritics,
    ignoreLocation: d = f.ignoreLocation
  } = {}) {
    if (this.options = {
      location: t,
      threshold: n,
      distance: s,
      includeMatches: a,
      findAllMatches: i,
      minMatchCharLength: o,
      isCaseSensitive: u,
      ignoreDiacritics: l,
      ignoreLocation: d
    }, e = u ? e : e.toLowerCase(), e = l ? ne(e) : e, this.pattern = e, this.chunks = [], !this.pattern.length)
      return;
    const h = (m, y) => {
      this.chunks.push({
        pattern: m,
        alphabet: yt(m),
        startIndex: y
      });
    }, w = this.pattern.length;
    if (w > q) {
      let m = 0;
      const y = w % q, p = w - y;
      for (; m < p; )
        h(this.pattern.substr(m, q), m), m += q;
      if (y) {
        const E = w - q;
        h(this.pattern.substr(E), E);
      }
    } else
      h(this.pattern, 0);
  }
  searchIn(e) {
    const { isCaseSensitive: t, ignoreDiacritics: n, includeMatches: s } = this.options;
    if (e = t ? e : e.toLowerCase(), e = n ? ne(e) : e, this.pattern === e) {
      let p = {
        isMatch: !0,
        score: 0
      };
      return s && (p.indices = [[0, e.length - 1]]), p;
    }
    const {
      location: a,
      distance: i,
      threshold: o,
      findAllMatches: u,
      minMatchCharLength: l,
      ignoreLocation: d
    } = this.options;
    let h = [], w = 0, m = !1;
    this.chunks.forEach(({ pattern: p, alphabet: E, startIndex: O }) => {
      const { isMatch: g, score: C, indices: b } = wt(e, p, E, {
        location: a + O,
        distance: i,
        threshold: o,
        findAllMatches: u,
        minMatchCharLength: l,
        includeMatches: s,
        ignoreLocation: d
      });
      g && (m = !0), w += C, g && b && (h = [...h, ...b]);
    });
    let y = {
      isMatch: m,
      score: m ? w / this.chunks.length : 1
    };
    return m && s && (y.indices = h), y;
  }
}
class j {
  constructor(e) {
    this.pattern = e;
  }
  static isMultiMatch(e) {
    return ve(e, this.multiRegex);
  }
  static isSingleMatch(e) {
    return ve(e, this.singleRegex);
  }
  search() {
  }
}
function ve(r, e) {
  const t = r.match(e);
  return t ? t[1] : null;
}
class pt extends j {
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
class bt extends j {
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
class vt extends j {
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
class At extends j {
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
class xt extends j {
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
class Mt extends j {
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
class We extends j {
  constructor(e, {
    location: t = f.location,
    threshold: n = f.threshold,
    distance: s = f.distance,
    includeMatches: a = f.includeMatches,
    findAllMatches: i = f.findAllMatches,
    minMatchCharLength: o = f.minMatchCharLength,
    isCaseSensitive: u = f.isCaseSensitive,
    ignoreDiacritics: l = f.ignoreDiacritics,
    ignoreLocation: d = f.ignoreLocation
  } = {}) {
    super(e), this._bitapSearch = new Le(e, {
      location: t,
      threshold: n,
      distance: s,
      includeMatches: a,
      findAllMatches: i,
      minMatchCharLength: o,
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
class $e extends j {
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
    const s = [], a = this.pattern.length;
    for (; (n = e.indexOf(this.pattern, t)) > -1; )
      t = n + a, s.push([n, t - 1]);
    const i = !!s.length;
    return {
      isMatch: i,
      score: i ? 0 : 1,
      indices: s
    };
  }
}
const he = [
  pt,
  $e,
  vt,
  At,
  Mt,
  xt,
  bt,
  We
], Ae = he.length, Ct = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/, Et = "|";
function St(r, e = {}) {
  return r.split(Et).map((t) => {
    let n = t.trim().split(Ct).filter((a) => a && !!a.trim()), s = [];
    for (let a = 0, i = n.length; a < i; a += 1) {
      const o = n[a];
      let u = !1, l = -1;
      for (; !u && ++l < Ae; ) {
        const d = he[l];
        let h = d.isMultiMatch(o);
        h && (s.push(new d(h, e)), u = !0);
      }
      if (!u)
        for (l = -1; ++l < Ae; ) {
          const d = he[l];
          let h = d.isSingleMatch(o);
          if (h) {
            s.push(new d(h, e));
            break;
          }
        }
    }
    return s;
  });
}
const Dt = /* @__PURE__ */ new Set([We.type, $e.type]);
class Ft {
  constructor(e, {
    isCaseSensitive: t = f.isCaseSensitive,
    ignoreDiacritics: n = f.ignoreDiacritics,
    includeMatches: s = f.includeMatches,
    minMatchCharLength: a = f.minMatchCharLength,
    ignoreLocation: i = f.ignoreLocation,
    findAllMatches: o = f.findAllMatches,
    location: u = f.location,
    threshold: l = f.threshold,
    distance: d = f.distance
  } = {}) {
    this.query = null, this.options = {
      isCaseSensitive: t,
      ignoreDiacritics: n,
      includeMatches: s,
      minMatchCharLength: a,
      findAllMatches: o,
      ignoreLocation: i,
      location: u,
      threshold: l,
      distance: d
    }, e = t ? e : e.toLowerCase(), e = n ? ne(e) : e, this.pattern = e, this.query = St(this.pattern, this.options);
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
    const { includeMatches: n, isCaseSensitive: s, ignoreDiacritics: a } = this.options;
    e = s ? e : e.toLowerCase(), e = a ? ne(e) : e;
    let i = 0, o = [], u = 0;
    for (let l = 0, d = t.length; l < d; l += 1) {
      const h = t[l];
      o.length = 0, i = 0;
      for (let w = 0, m = h.length; w < m; w += 1) {
        const y = h[w], { isMatch: p, indices: E, score: O } = y.search(e);
        if (p) {
          if (i += 1, u += O, n) {
            const g = y.constructor.type;
            Dt.has(g) ? o = [...o, ...E] : o.push(E);
          }
        } else {
          u = 0, i = 0, o.length = 0;
          break;
        }
      }
      if (i) {
        let w = {
          isMatch: !0,
          score: u / i
        };
        return n && (w.indices = o), w;
      }
    }
    return {
      isMatch: !1,
      score: 1
    };
  }
}
const fe = [];
function _t(...r) {
  fe.push(...r);
}
function ge(r, e) {
  for (let t = 0, n = fe.length; t < n; t += 1) {
    let s = fe[t];
    if (s.condition(r, e))
      return new s(r, e);
  }
  return new Le(r, e);
}
const se = {
  AND: "$and",
  OR: "$or"
}, me = {
  PATH: "$path",
  PATTERN: "$val"
}, we = (r) => !!(r[se.AND] || r[se.OR]), kt = (r) => !!r[me.PATH], Pt = (r) => !N(r) && Pe(r) && !we(r), xe = (r) => ({
  [se.AND]: Object.keys(r).map((e) => ({
    [e]: r[e]
  }))
});
function Te(r, e, { auto: t = !0 } = {}) {
  const n = (s) => {
    let a = Object.keys(s);
    const i = kt(s);
    if (!i && a.length > 1 && !we(s))
      return n(xe(s));
    if (Pt(s)) {
      const u = i ? s[me.PATH] : a[0], l = i ? s[me.PATTERN] : s[u];
      if (!L(l))
        throw new Error(rt(u));
      const d = {
        keyId: de(u),
        pattern: l
      };
      return t && (d.searcher = ge(l, e)), d;
    }
    let o = {
      children: [],
      operator: a[0]
    };
    return a.forEach((u) => {
      const l = s[u];
      N(l) && l.forEach((d) => {
        o.children.push(n(d));
      });
    }), o;
  };
  return we(r) || (r = xe(r)), n(r);
}
function Ot(r, { ignoreFieldNorm: e = f.ignoreFieldNorm }) {
  r.forEach((t) => {
    let n = 1;
    t.matches.forEach(({ key: s, norm: a, score: i }) => {
      const o = s ? s.weight : null;
      n *= Math.pow(
        i === 0 && o ? Number.EPSILON : i,
        (o || 1) * (e ? 1 : a)
      );
    }), t.score = n;
  });
}
function Bt(r, e) {
  const t = r.matches;
  e.matches = [], k(t) && t.forEach((n) => {
    if (!k(n.indices) || !n.indices.length)
      return;
    const { indices: s, value: a } = n;
    let i = {
      indices: s,
      value: a
    };
    n.key && (i.key = n.key.src), n.idx > -1 && (i.refIndex = n.idx), e.matches.push(i);
  });
}
function It(r, e) {
  e.score = r.score;
}
function Lt(r, e, {
  includeMatches: t = f.includeMatches,
  includeScore: n = f.includeScore
} = {}) {
  const s = [];
  return t && s.push(Bt), n && s.push(It), r.map((a) => {
    const { idx: i } = a, o = {
      item: e[i],
      refIndex: i
    };
    return s.length && s.forEach((u) => {
      u(a, o);
    }), o;
  });
}
class W {
  constructor(e, t = {}, n) {
    this.options = { ...f, ...t }, this.options.useExtendedSearch, this._keyStore = new at(this.options.keys), this.setCollection(e, n);
  }
  setCollection(e, t) {
    if (this._docs = e, t && !(t instanceof ye))
      throw new Error(tt);
    this._myIndex = t || Ie(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
  }
  add(e) {
    k(e) && (this._docs.push(e), this._myIndex.add(e));
  }
  remove(e = () => !1) {
    const t = [];
    for (let n = 0, s = this._docs.length; n < s; n += 1) {
      const a = this._docs[n];
      e(a, n) && (this.removeAt(n), n -= 1, s -= 1, t.push(a));
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
      includeScore: s,
      shouldSort: a,
      sortFn: i,
      ignoreFieldNorm: o
    } = this.options;
    let u = L(e) ? L(this._docs[0]) ? this._searchStringList(e) : this._searchObjectList(e) : this._searchLogical(e);
    return Ot(u, { ignoreFieldNorm: o }), a && u.sort(i), ke(t) && t > -1 && (u = u.slice(0, t)), Lt(u, this._docs, {
      includeMatches: n,
      includeScore: s
    });
  }
  _searchStringList(e) {
    const t = ge(e, this.options), { records: n } = this._myIndex, s = [];
    return n.forEach(({ v: a, i, n: o }) => {
      if (!k(a))
        return;
      const { isMatch: u, score: l, indices: d } = t.searchIn(a);
      u && s.push({
        item: a,
        idx: i,
        matches: [{ score: l, value: a, norm: o, indices: d }]
      });
    }), s;
  }
  _searchLogical(e) {
    const t = Te(e, this.options), n = (o, u, l) => {
      if (!o.children) {
        const { keyId: h, searcher: w } = o, m = this._findMatches({
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
      for (let h = 0, w = o.children.length; h < w; h += 1) {
        const m = o.children[h], y = n(m, u, l);
        if (y.length)
          d.push(...y);
        else if (o.operator === se.AND)
          return [];
      }
      return d;
    }, s = this._myIndex.records, a = {}, i = [];
    return s.forEach(({ $: o, i: u }) => {
      if (k(o)) {
        let l = n(t, o, u);
        l.length && (a[u] || (a[u] = { idx: u, item: o, matches: [] }, i.push(a[u])), l.forEach(({ matches: d }) => {
          a[u].matches.push(...d);
        }));
      }
    }), i;
  }
  _searchObjectList(e) {
    const t = ge(e, this.options), { keys: n, records: s } = this._myIndex, a = [];
    return s.forEach(({ $: i, i: o }) => {
      if (!k(i))
        return;
      let u = [];
      n.forEach((l, d) => {
        u.push(
          ...this._findMatches({
            key: l,
            value: i[d],
            searcher: t
          })
        );
      }), u.length && a.push({
        idx: o,
        item: i,
        matches: u
      });
    }), a;
  }
  _findMatches({ key: e, value: t, searcher: n }) {
    if (!k(t))
      return [];
    let s = [];
    if (N(t))
      t.forEach(({ v: a, i, n: o }) => {
        if (!k(a))
          return;
        const { isMatch: u, score: l, indices: d } = n.searchIn(a);
        u && s.push({
          score: l,
          key: e,
          value: a,
          idx: i,
          norm: o,
          indices: d
        });
      });
    else {
      const { v: a, n: i } = t, { isMatch: o, score: u, indices: l } = n.searchIn(a);
      o && s.push({ score: u, key: e, value: a, norm: i, indices: l });
    }
    return s;
  }
}
W.version = "7.1.0";
W.createIndex = Ie;
W.parseIndex = gt;
W.config = f;
W.parseQuery = Te;
_t(Ft);
const re = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["content"]
};
function Wt() {
  const { subscribe: r, set: e, update: t } = Qe({
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
  let n, s;
  function a(i) {
    n = i.getService(
      "ClipboardHistoryService"
    ), s = i.getService("LogService");
  }
  return {
    subscribe: r,
    setSearch: (i) => t((o) => ({
      ...o,
      searchQuery: i,
      filtered: i.length > 0,
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
    initFuse: (i) => t((o) => ({
      ...o,
      fuseInstance: new W(i, re)
    })),
    search: (i, o) => {
      let u = i;
      if (o && o.trim() !== "") {
        let l = {
          fuseInstance: null
        };
        r((m) => {
          l = m;
        })();
        let h;
        l.fuseInstance ? (h = l.fuseInstance, h.setCollection(i)) : h = new W(i, re), u = h.search(o).map((m) => ({
          ...m.item,
          score: m.score
        })), t((m) => ({
          ...m,
          fuseInstance: h
        }));
      }
      return u;
    },
    setItems: (i) => {
      console.log("Setting items in state:", i.length), t((o) => ({
        ...o,
        items: i,
        fuseInstance: new W(i, re)
      }));
    },
    setSelectedItem(i) {
      t((o) => {
        const u = o.items;
        return u.length > 0 && i >= 0 && i < u.length ? {
          ...o,
          selectedItem: u[i],
          selectedIndex: i
        } : o;
      });
    },
    moveSelection(i) {
      t((o) => {
        const u = o.items;
        if (!u.length) return o;
        let l = o.selectedIndex;
        return i === "up" ? l = l <= 0 ? u.length - 1 : l - 1 : l = l >= u.length - 1 ? 0 : l + 1, requestAnimationFrame(() => {
          const d = document.querySelector(`[data-index="${l}"]`);
          d == null || d.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }), {
          ...o,
          selectedIndex: l,
          selectedItem: u[l]
        };
      });
    },
    setLoading(i) {
      t((o) => ({ ...o, isLoading: i }));
    },
    setError(i) {
      t((o) => ({
        ...o,
        loadError: !!i,
        errorMessage: i || ""
      }));
    },
    initializeServices: a,
    // Expose clipboardService methods through the state store
    async clearNonFavorites() {
      if (!n)
        return s == null || s.error("Clipboard service not initialized in clearNonFavorites"), !1;
      try {
        return await n.clearNonFavorites();
      } catch (i) {
        return s == null || s.error(`Error clearing non-favorites: ${i}`), !1;
      }
    },
    async toggleFavorite(i) {
      if (!n)
        return s == null || s.error("Clipboard service not initialized in toggleFavorite"), !1;
      try {
        return await n.toggleItemFavorite(i);
      } catch (o) {
        return s == null || s.error(`Error toggling favorite for ${i}: ${o}`), !1;
      }
    },
    // --- End exposed methods ---
    async handleItemAction(i, o) {
      if (!(!(i != null && i.id) || !n))
        try {
          switch (o) {
            case "paste":
              await n.pasteItem(i), n == null || n.hideWindow();
              break;
            case "select":
              const l = qe({ subscribe: r }).items.findIndex((d) => d.id === i.id);
              l >= 0 && this.setSelectedItem(l);
              break;
          }
        } catch (u) {
          s == null || s.error(`Failed to handle item action: ${u}`);
        }
    },
    // Renamed from hideWindow for clarity, calls service method
    async hidePanel() {
      if (!n) {
        s == null || s.error("Clipboard service not initialized in hidePanel");
        return;
      }
      try {
        await n.hideWindow();
      } catch (i) {
        s == null || s.error(`Error hiding window: ${i}`);
      }
    },
    // Refresh history items (no change needed here, already uses service)
    async refreshHistory() {
      t((i) => ({ ...i, isLoading: !0 }));
      try {
        if (n) {
          const i = await n.getRecentItems(100);
          t((o) => ({
            // Use update instead of this.setItems
            ...o,
            items: i,
            fuseInstance: new W(i, re)
            // Update fuse instance too
          }));
        } else
          s == null || s.warn("Clipboard service not available in refreshHistory");
      } catch (i) {
        s == null || s.error(`Failed to refresh clipboard history: ${i}`), t((o) => ({
          // Use update instead of this.setError
          ...o,
          loadError: !0,
          errorMessage: `Failed to refresh clipboard history: ${i}`
        }));
      } finally {
        this.setLoading(!1);
      }
    }
  };
}
const _ = Wt(), Ne = 6048e5, $t = 864e5, Me = Symbol.for("constructDateFrom");
function H(r, e) {
  return typeof r == "function" ? r(e) : r && typeof r == "object" && Me in r ? r[Me](e) : r instanceof Date ? new r.constructor(e) : new Date(e);
}
function B(r, e) {
  return H(e || r, r);
}
let Tt = {};
function ae() {
  return Tt;
}
function J(r, e) {
  var o, u, l, d;
  const t = ae(), n = (e == null ? void 0 : e.weekStartsOn) ?? ((u = (o = e == null ? void 0 : e.locale) == null ? void 0 : o.options) == null ? void 0 : u.weekStartsOn) ?? t.weekStartsOn ?? ((d = (l = t.locale) == null ? void 0 : l.options) == null ? void 0 : d.weekStartsOn) ?? 0, s = B(r, e == null ? void 0 : e.in), a = s.getDay(), i = (a < n ? 7 : 0) + a - n;
  return s.setDate(s.getDate() - i), s.setHours(0, 0, 0, 0), s;
}
function ie(r, e) {
  return J(r, { ...e, weekStartsOn: 1 });
}
function Re(r, e) {
  const t = B(r, e == null ? void 0 : e.in), n = t.getFullYear(), s = H(t, 0);
  s.setFullYear(n + 1, 0, 4), s.setHours(0, 0, 0, 0);
  const a = ie(s), i = H(t, 0);
  i.setFullYear(n, 0, 4), i.setHours(0, 0, 0, 0);
  const o = ie(i);
  return t.getTime() >= a.getTime() ? n + 1 : t.getTime() >= o.getTime() ? n : n - 1;
}
function Ce(r) {
  const e = B(r), t = new Date(
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
function Nt(r, ...e) {
  const t = H.bind(
    null,
    e.find((n) => typeof n == "object")
  );
  return e.map(t);
}
function Ee(r, e) {
  const t = B(r, e == null ? void 0 : e.in);
  return t.setHours(0, 0, 0, 0), t;
}
function Rt(r, e, t) {
  const [n, s] = Nt(
    t == null ? void 0 : t.in,
    r,
    e
  ), a = Ee(n), i = Ee(s), o = +a - Ce(a), u = +i - Ce(i);
  return Math.round((o - u) / $t);
}
function Yt(r, e) {
  const t = Re(r, e), n = H(r, 0);
  return n.setFullYear(t, 0, 4), n.setHours(0, 0, 0, 0), ie(n);
}
function Ht(r) {
  return r instanceof Date || typeof r == "object" && Object.prototype.toString.call(r) === "[object Date]";
}
function jt(r) {
  return !(!Ht(r) && typeof r != "number" || isNaN(+B(r)));
}
function Vt(r, e) {
  const t = B(r, e == null ? void 0 : e.in);
  return t.setFullYear(t.getFullYear(), 0, 1), t.setHours(0, 0, 0, 0), t;
}
const zt = {
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
}, Qt = (r, e, t) => {
  let n;
  const s = zt[r];
  return typeof s == "string" ? n = s : e === 1 ? n = s.one : n = s.other.replace("{{count}}", e.toString()), t != null && t.addSuffix ? t.comparison && t.comparison > 0 ? "in " + n : n + " ago" : n;
};
function ue(r) {
  return (e = {}) => {
    const t = e.width ? String(e.width) : r.defaultWidth;
    return r.formats[t] || r.formats[r.defaultWidth];
  };
}
const qt = {
  full: "EEEE, MMMM do, y",
  long: "MMMM do, y",
  medium: "MMM d, y",
  short: "MM/dd/yyyy"
}, Gt = {
  full: "h:mm:ss a zzzz",
  long: "h:mm:ss a z",
  medium: "h:mm:ss a",
  short: "h:mm a"
}, Xt = {
  full: "{{date}} 'at' {{time}}",
  long: "{{date}} 'at' {{time}}",
  medium: "{{date}}, {{time}}",
  short: "{{date}}, {{time}}"
}, Kt = {
  date: ue({
    formats: qt,
    defaultWidth: "full"
  }),
  time: ue({
    formats: Gt,
    defaultWidth: "full"
  }),
  dateTime: ue({
    formats: Xt,
    defaultWidth: "full"
  })
}, Jt = {
  lastWeek: "'last' eeee 'at' p",
  yesterday: "'yesterday at' p",
  today: "'today at' p",
  tomorrow: "'tomorrow at' p",
  nextWeek: "eeee 'at' p",
  other: "P"
}, Ut = (r, e, t, n) => Jt[r];
function X(r) {
  return (e, t) => {
    const n = t != null && t.context ? String(t.context) : "standalone";
    let s;
    if (n === "formatting" && r.formattingValues) {
      const i = r.defaultFormattingWidth || r.defaultWidth, o = t != null && t.width ? String(t.width) : i;
      s = r.formattingValues[o] || r.formattingValues[i];
    } else {
      const i = r.defaultWidth, o = t != null && t.width ? String(t.width) : r.defaultWidth;
      s = r.values[o] || r.values[i];
    }
    const a = r.argumentCallback ? r.argumentCallback(e) : e;
    return s[a];
  };
}
const Zt = {
  narrow: ["B", "A"],
  abbreviated: ["BC", "AD"],
  wide: ["Before Christ", "Anno Domini"]
}, er = {
  narrow: ["1", "2", "3", "4"],
  abbreviated: ["Q1", "Q2", "Q3", "Q4"],
  wide: ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter"]
}, tr = {
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
}, rr = {
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
}, nr = {
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
}, ir = (r, e) => {
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
}, ar = {
  ordinalNumber: ir,
  era: X({
    values: Zt,
    defaultWidth: "wide"
  }),
  quarter: X({
    values: er,
    defaultWidth: "wide",
    argumentCallback: (r) => r - 1
  }),
  month: X({
    values: tr,
    defaultWidth: "wide"
  }),
  day: X({
    values: rr,
    defaultWidth: "wide"
  }),
  dayPeriod: X({
    values: nr,
    defaultWidth: "wide",
    formattingValues: sr,
    defaultFormattingWidth: "wide"
  })
};
function K(r) {
  return (e, t = {}) => {
    const n = t.width, s = n && r.matchPatterns[n] || r.matchPatterns[r.defaultMatchWidth], a = e.match(s);
    if (!a)
      return null;
    const i = a[0], o = n && r.parsePatterns[n] || r.parsePatterns[r.defaultParseWidth], u = Array.isArray(o) ? cr(o, (h) => h.test(i)) : (
      // [TODO] -- I challenge you to fix the type
      or(o, (h) => h.test(i))
    );
    let l;
    l = r.valueCallback ? r.valueCallback(u) : u, l = t.valueCallback ? (
      // [TODO] -- I challenge you to fix the type
      t.valueCallback(l)
    ) : l;
    const d = e.slice(i.length);
    return { value: l, rest: d };
  };
}
function or(r, e) {
  for (const t in r)
    if (Object.prototype.hasOwnProperty.call(r, t) && e(r[t]))
      return t;
}
function cr(r, e) {
  for (let t = 0; t < r.length; t++)
    if (e(r[t]))
      return t;
}
function ur(r) {
  return (e, t = {}) => {
    const n = e.match(r.matchPattern);
    if (!n) return null;
    const s = n[0], a = e.match(r.parsePattern);
    if (!a) return null;
    let i = r.valueCallback ? r.valueCallback(a[0]) : a[0];
    i = t.valueCallback ? t.valueCallback(i) : i;
    const o = e.slice(s.length);
    return { value: i, rest: o };
  };
}
const lr = /^(\d+)(th|st|nd|rd)?/i, dr = /\d+/i, hr = {
  narrow: /^(b|a)/i,
  abbreviated: /^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,
  wide: /^(before christ|before common era|anno domini|common era)/i
}, fr = {
  any: [/^b/i, /^(a|c)/i]
}, gr = {
  narrow: /^[1234]/i,
  abbreviated: /^q[1234]/i,
  wide: /^[1234](th|st|nd|rd)? quarter/i
}, mr = {
  any: [/1/i, /2/i, /3/i, /4/i]
}, wr = {
  narrow: /^[jfmasond]/i,
  abbreviated: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  wide: /^(january|february|march|april|may|june|july|august|september|october|november|december)/i
}, yr = {
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
}, pr = {
  narrow: /^[smtwf]/i,
  short: /^(su|mo|tu|we|th|fr|sa)/i,
  abbreviated: /^(sun|mon|tue|wed|thu|fri|sat)/i,
  wide: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i
}, br = {
  narrow: [/^s/i, /^m/i, /^t/i, /^w/i, /^t/i, /^f/i, /^s/i],
  any: [/^su/i, /^m/i, /^tu/i, /^w/i, /^th/i, /^f/i, /^sa/i]
}, vr = {
  narrow: /^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,
  any: /^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i
}, Ar = {
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
}, xr = {
  ordinalNumber: ur({
    matchPattern: lr,
    parsePattern: dr,
    valueCallback: (r) => parseInt(r, 10)
  }),
  era: K({
    matchPatterns: hr,
    defaultMatchWidth: "wide",
    parsePatterns: fr,
    defaultParseWidth: "any"
  }),
  quarter: K({
    matchPatterns: gr,
    defaultMatchWidth: "wide",
    parsePatterns: mr,
    defaultParseWidth: "any",
    valueCallback: (r) => r + 1
  }),
  month: K({
    matchPatterns: wr,
    defaultMatchWidth: "wide",
    parsePatterns: yr,
    defaultParseWidth: "any"
  }),
  day: K({
    matchPatterns: pr,
    defaultMatchWidth: "wide",
    parsePatterns: br,
    defaultParseWidth: "any"
  }),
  dayPeriod: K({
    matchPatterns: vr,
    defaultMatchWidth: "any",
    parsePatterns: Ar,
    defaultParseWidth: "any"
  })
}, Mr = {
  code: "en-US",
  formatDistance: Qt,
  formatLong: Kt,
  formatRelative: Ut,
  localize: ar,
  match: xr,
  options: {
    weekStartsOn: 0,
    firstWeekContainsDate: 1
  }
};
function Cr(r, e) {
  const t = B(r, e == null ? void 0 : e.in);
  return Rt(t, Vt(t)) + 1;
}
function Er(r, e) {
  const t = B(r, e == null ? void 0 : e.in), n = +ie(t) - +Yt(t);
  return Math.round(n / Ne) + 1;
}
function Ye(r, e) {
  var d, h, w, m;
  const t = B(r, e == null ? void 0 : e.in), n = t.getFullYear(), s = ae(), a = (e == null ? void 0 : e.firstWeekContainsDate) ?? ((h = (d = e == null ? void 0 : e.locale) == null ? void 0 : d.options) == null ? void 0 : h.firstWeekContainsDate) ?? s.firstWeekContainsDate ?? ((m = (w = s.locale) == null ? void 0 : w.options) == null ? void 0 : m.firstWeekContainsDate) ?? 1, i = H((e == null ? void 0 : e.in) || r, 0);
  i.setFullYear(n + 1, 0, a), i.setHours(0, 0, 0, 0);
  const o = J(i, e), u = H((e == null ? void 0 : e.in) || r, 0);
  u.setFullYear(n, 0, a), u.setHours(0, 0, 0, 0);
  const l = J(u, e);
  return +t >= +o ? n + 1 : +t >= +l ? n : n - 1;
}
function Sr(r, e) {
  var o, u, l, d;
  const t = ae(), n = (e == null ? void 0 : e.firstWeekContainsDate) ?? ((u = (o = e == null ? void 0 : e.locale) == null ? void 0 : o.options) == null ? void 0 : u.firstWeekContainsDate) ?? t.firstWeekContainsDate ?? ((d = (l = t.locale) == null ? void 0 : l.options) == null ? void 0 : d.firstWeekContainsDate) ?? 1, s = Ye(r, e), a = H((e == null ? void 0 : e.in) || r, 0);
  return a.setFullYear(s, 0, n), a.setHours(0, 0, 0, 0), J(a, e);
}
function Dr(r, e) {
  const t = B(r, e == null ? void 0 : e.in), n = +J(t, e) - +Sr(t, e);
  return Math.round(n / Ne) + 1;
}
function v(r, e) {
  const t = r < 0 ? "-" : "", n = Math.abs(r).toString().padStart(e, "0");
  return t + n;
}
const Y = {
  // Year
  y(r, e) {
    const t = r.getFullYear(), n = t > 0 ? t : 1 - t;
    return v(e === "yy" ? n % 100 : n, e.length);
  },
  // Month
  M(r, e) {
    const t = r.getMonth();
    return e === "M" ? String(t + 1) : v(t + 1, 2);
  },
  // Day of the month
  d(r, e) {
    return v(r.getDate(), e.length);
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
    return v(r.getHours() % 12 || 12, e.length);
  },
  // Hour [0-23]
  H(r, e) {
    return v(r.getHours(), e.length);
  },
  // Minute
  m(r, e) {
    return v(r.getMinutes(), e.length);
  },
  // Second
  s(r, e) {
    return v(r.getSeconds(), e.length);
  },
  // Fraction of second
  S(r, e) {
    const t = e.length, n = r.getMilliseconds(), s = Math.trunc(
      n * Math.pow(10, t - 3)
    );
    return v(s, e.length);
  }
}, G = {
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
      const n = r.getFullYear(), s = n > 0 ? n : 1 - n;
      return t.ordinalNumber(s, { unit: "year" });
    }
    return Y.y(r, e);
  },
  // Local week-numbering year
  Y: function(r, e, t, n) {
    const s = Ye(r, n), a = s > 0 ? s : 1 - s;
    if (e === "YY") {
      const i = a % 100;
      return v(i, 2);
    }
    return e === "Yo" ? t.ordinalNumber(a, { unit: "year" }) : v(a, e.length);
  },
  // ISO week-numbering year
  R: function(r, e) {
    const t = Re(r);
    return v(t, e.length);
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
    return v(t, e.length);
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
        return v(n, 2);
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
        return v(n, 2);
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
        return Y.M(r, e);
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
        return v(n + 1, 2);
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
    const s = Dr(r, n);
    return e === "wo" ? t.ordinalNumber(s, { unit: "week" }) : v(s, e.length);
  },
  // ISO week of year
  I: function(r, e, t) {
    const n = Er(r);
    return e === "Io" ? t.ordinalNumber(n, { unit: "week" }) : v(n, e.length);
  },
  // Day of the month
  d: function(r, e, t) {
    return e === "do" ? t.ordinalNumber(r.getDate(), { unit: "date" }) : Y.d(r, e);
  },
  // Day of year
  D: function(r, e, t) {
    const n = Cr(r);
    return e === "Do" ? t.ordinalNumber(n, { unit: "dayOfYear" }) : v(n, e.length);
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
    const s = r.getDay(), a = (s - n.weekStartsOn + 8) % 7 || 7;
    switch (e) {
      // Numerical value (Nth day of week with current locale or weekStartsOn)
      case "e":
        return String(a);
      // Padded numerical value
      case "ee":
        return v(a, 2);
      // 1st, 2nd, ..., 7th
      case "eo":
        return t.ordinalNumber(a, { unit: "day" });
      case "eee":
        return t.day(s, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "eeeee":
        return t.day(s, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "eeeeee":
        return t.day(s, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "eeee":
      default:
        return t.day(s, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Stand-alone local day of week
  c: function(r, e, t, n) {
    const s = r.getDay(), a = (s - n.weekStartsOn + 8) % 7 || 7;
    switch (e) {
      // Numerical value (same as in `e`)
      case "c":
        return String(a);
      // Padded numerical value
      case "cc":
        return v(a, e.length);
      // 1st, 2nd, ..., 7th
      case "co":
        return t.ordinalNumber(a, { unit: "day" });
      case "ccc":
        return t.day(s, {
          width: "abbreviated",
          context: "standalone"
        });
      // T
      case "ccccc":
        return t.day(s, {
          width: "narrow",
          context: "standalone"
        });
      // Tu
      case "cccccc":
        return t.day(s, {
          width: "short",
          context: "standalone"
        });
      // Tuesday
      case "cccc":
      default:
        return t.day(s, {
          width: "wide",
          context: "standalone"
        });
    }
  },
  // ISO day of week
  i: function(r, e, t) {
    const n = r.getDay(), s = n === 0 ? 7 : n;
    switch (e) {
      // 2
      case "i":
        return String(s);
      // 02
      case "ii":
        return v(s, e.length);
      // 2nd
      case "io":
        return t.ordinalNumber(s, { unit: "day" });
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
    const s = r.getHours() / 12 >= 1 ? "pm" : "am";
    switch (e) {
      case "a":
      case "aa":
        return t.dayPeriod(s, {
          width: "abbreviated",
          context: "formatting"
        });
      case "aaa":
        return t.dayPeriod(s, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "aaaaa":
        return t.dayPeriod(s, {
          width: "narrow",
          context: "formatting"
        });
      case "aaaa":
      default:
        return t.dayPeriod(s, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // AM, PM, midnight, noon
  b: function(r, e, t) {
    const n = r.getHours();
    let s;
    switch (n === 12 ? s = G.noon : n === 0 ? s = G.midnight : s = n / 12 >= 1 ? "pm" : "am", e) {
      case "b":
      case "bb":
        return t.dayPeriod(s, {
          width: "abbreviated",
          context: "formatting"
        });
      case "bbb":
        return t.dayPeriod(s, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "bbbbb":
        return t.dayPeriod(s, {
          width: "narrow",
          context: "formatting"
        });
      case "bbbb":
      default:
        return t.dayPeriod(s, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // in the morning, in the afternoon, in the evening, at night
  B: function(r, e, t) {
    const n = r.getHours();
    let s;
    switch (n >= 17 ? s = G.evening : n >= 12 ? s = G.afternoon : n >= 4 ? s = G.morning : s = G.night, e) {
      case "B":
      case "BB":
      case "BBB":
        return t.dayPeriod(s, {
          width: "abbreviated",
          context: "formatting"
        });
      case "BBBBB":
        return t.dayPeriod(s, {
          width: "narrow",
          context: "formatting"
        });
      case "BBBB":
      default:
        return t.dayPeriod(s, {
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
    return Y.h(r, e);
  },
  // Hour [0-23]
  H: function(r, e, t) {
    return e === "Ho" ? t.ordinalNumber(r.getHours(), { unit: "hour" }) : Y.H(r, e);
  },
  // Hour [0-11]
  K: function(r, e, t) {
    const n = r.getHours() % 12;
    return e === "Ko" ? t.ordinalNumber(n, { unit: "hour" }) : v(n, e.length);
  },
  // Hour [1-24]
  k: function(r, e, t) {
    let n = r.getHours();
    return n === 0 && (n = 24), e === "ko" ? t.ordinalNumber(n, { unit: "hour" }) : v(n, e.length);
  },
  // Minute
  m: function(r, e, t) {
    return e === "mo" ? t.ordinalNumber(r.getMinutes(), { unit: "minute" }) : Y.m(r, e);
  },
  // Second
  s: function(r, e, t) {
    return e === "so" ? t.ordinalNumber(r.getSeconds(), { unit: "second" }) : Y.s(r, e);
  },
  // Fraction of second
  S: function(r, e) {
    return Y.S(r, e);
  },
  // Timezone (ISO-8601. If offset is 0, output is always `'Z'`)
  X: function(r, e, t) {
    const n = r.getTimezoneOffset();
    if (n === 0)
      return "Z";
    switch (e) {
      // Hours and optional minutes
      case "X":
        return Fe(n);
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
        return Fe(n);
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
    return v(n, e.length);
  },
  // Milliseconds timestamp
  T: function(r, e, t) {
    return v(+r, e.length);
  }
};
function De(r, e = "") {
  const t = r > 0 ? "-" : "+", n = Math.abs(r), s = Math.trunc(n / 60), a = n % 60;
  return a === 0 ? t + String(s) : t + String(s) + e + v(a, 2);
}
function Fe(r, e) {
  return r % 60 === 0 ? (r > 0 ? "-" : "+") + v(Math.abs(r) / 60, 2) : Q(r, e);
}
function Q(r, e = "") {
  const t = r > 0 ? "-" : "+", n = Math.abs(r), s = v(Math.trunc(n / 60), 2), a = v(n % 60, 2);
  return t + s + e + a;
}
const _e = (r, e) => {
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
}, He = (r, e) => {
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
  const t = r.match(/(P+)(p+)?/) || [], n = t[1], s = t[2];
  if (!s)
    return _e(r, e);
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
  return a.replace("{{date}}", _e(n, e)).replace("{{time}}", He(s, e));
}, _r = {
  p: He,
  P: Fr
}, kr = /^D+$/, Pr = /^Y+$/, Or = ["D", "DD", "YY", "YYYY"];
function Br(r) {
  return kr.test(r);
}
function Ir(r) {
  return Pr.test(r);
}
function Lr(r, e, t) {
  const n = Wr(r, e, t);
  if (console.warn(n), Or.includes(r)) throw new RangeError(n);
}
function Wr(r, e, t) {
  const n = r[0] === "Y" ? "years" : "days of the month";
  return `Use \`${r.toLowerCase()}\` instead of \`${r}\` (in \`${e}\`) for formatting ${n} to the input \`${t}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`;
}
const $r = /[yYQqMLwIdDecihHKkms]o|(\w)\1*|''|'(''|[^'])+('|$)|./g, Tr = /P+p+|P+|p+|''|'(''|[^'])+('|$)|./g, Nr = /^'([^]*?)'?$/, Rr = /''/g, Yr = /[a-zA-Z]/;
function le(r, e, t) {
  var d, h, w, m;
  const n = ae(), s = n.locale ?? Mr, a = n.firstWeekContainsDate ?? ((h = (d = n.locale) == null ? void 0 : d.options) == null ? void 0 : h.firstWeekContainsDate) ?? 1, i = n.weekStartsOn ?? ((m = (w = n.locale) == null ? void 0 : w.options) == null ? void 0 : m.weekStartsOn) ?? 0, o = B(r, t == null ? void 0 : t.in);
  if (!jt(o))
    throw new RangeError("Invalid time value");
  let u = e.match(Tr).map((y) => {
    const p = y[0];
    if (p === "p" || p === "P") {
      const E = _r[p];
      return E(y, s.formatLong);
    }
    return y;
  }).join("").match($r).map((y) => {
    if (y === "''")
      return { isToken: !1, value: "'" };
    const p = y[0];
    if (p === "'")
      return { isToken: !1, value: Hr(y) };
    if (Se[p])
      return { isToken: !0, value: y };
    if (p.match(Yr))
      throw new RangeError(
        "Format string contains an unescaped latin alphabet character `" + p + "`"
      );
    return { isToken: !1, value: y };
  });
  s.localize.preprocessor && (u = s.localize.preprocessor(o, u));
  const l = {
    firstWeekContainsDate: a,
    weekStartsOn: i,
    locale: s
  };
  return u.map((y) => {
    if (!y.isToken) return y.value;
    const p = y.value;
    (Ir(p) || Br(p)) && Lr(p, e, String(r));
    const E = Se[p[0]];
    return E(o, p, s.localize, l);
  }).join("");
}
function Hr(r) {
  const e = r.match(Nr);
  return e ? e[1].replace(Rr, "'") : r;
}
var jr = c.template('<div><div class="flex items-center gap-2 mb-1.5"><span class="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--bg-selected)]"><span class="result-title"> </span></span> <span class="result-subtitle text-xs"> </span></div> <div class="result-title text-sm line-clamp-2"><!></div></div>'), Vr = c.template('<div slot="left" class="h-full overflow-y-auto focus:outline-none scroll-smooth svelte-11oc8zj" tabindex="0"><div class="divide-y divide-[var(--border-color)]"></div></div>'), zr = c.template('<div class="bg-[var(--bg-selected)] border-b border-[var(--border-color)] p-4 shadow-sm"><div class="flex justify-between items-center"><div class="flex items-center gap-3"><span class="text-sm font-medium px-3 py-1 rounded-full bg-[var(--bg-primary)]"><span class="result-title"> </span></span> <span class="result-subtitle text-sm"> </span></div></div></div> <div class="flex-1 overflow-y-auto p-6 custom-scrollbar svelte-11oc8zj"><div class="result-title prose max-w-none"><!></div></div>', 1), Qr = c.template('<div class="flex h-full items-center justify-center flex-col gap-4"><svg class="w-16 h-16 opacity-30 result-subtitle" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg> <span class="result-title text-lg font-medium">Select an item to view details</span></div>'), qr = c.template('<div slot="right" class="h-full flex flex-col overflow-hidden"><!></div>');
function nn(r, e) {
  c.push(e, !1);
  const [t, n] = c.setup_stores(), s = () => c.store_get(_, "$clipboardViewState", t), a = c.mutable_source(), i = c.mutable_source(), o = c.mutable_source(), u = c.mutable_source(), l = c.mutable_source(), d = c.mutable_source();
  let h = c.mutable_source(), w = !1;
  Ge(async () => {
    w = !0, window.addEventListener("keydown", m);
  });
  function m(g) {
    !w || !c.get(a).length || (g.key === "ArrowUp" || g.key === "ArrowDown" ? (g.preventDefault(), g.stopPropagation(), _.moveSelection(g.key === "ArrowUp" ? "up" : "down"), y()) : g.key === "Enter" && c.get(i) && (g.preventDefault(), g.stopPropagation(), _.handleItemAction(c.get(i), "paste")));
  }
  function y() {
    requestAnimationFrame(() => {
      var C;
      const g = (C = c.get(h)) == null ? void 0 : C.querySelector(`[data-index="${c.get(o)}"]`);
      if (g) {
        const b = c.get(h).getBoundingClientRect(), P = g.getBoundingClientRect(), D = P.top < b.top, A = P.bottom > b.bottom;
        (D || A) && g.scrollIntoView({
          block: D ? "start" : "end",
          behavior: "smooth"
        });
      }
    });
  }
  function p(g) {
    _.setSelectedItem(g);
  }
  Xe(() => {
    window.removeEventListener("keydown", m), w = !1;
  });
  function E(g) {
    if (s().searchQuery && "score" in g) {
      const C = typeof g.score == "number" ? g.score : 0;
      return `Match: ${Math.round((1 - C) * 100)}% · ${le(g.createdAt, "HH:mm")}`;
    }
    return le(g.createdAt, "HH:mm");
  }
  function O(g, C = !1) {
    if (!g || !g.content)
      return '<span class="text-gray-400">No preview available</span>';
    switch (g.type) {
      case "image":
        let b = g.content;
        return b = b.replace("data:image/png;base64, ", "data:image/png;base64,"), b.startsWith("data:") || (b = `data:image/png;base64,${b}`), b.includes("AAAAAAAA") ? '<div class="flex items-center justify-center p-4 bg-gray-100 rounded"><svg class="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>' : C ? `<div class="image-container w-full flex items-center justify-center">
            <img 
              src="${b}" 
              class="max-w-full max-h-[70vh] object-contain border border-[var(--border-color)] rounded" 
              alt="Clipboard image ${new Date(g.createdAt).toLocaleString()}"
              onerror="this.onerror=null; this.style.display='none'; this.parentNode.innerHTML='<div class=\\'flex p-8 items-center justify-center bg-gray-100 rounded\\'><div class=\\'text-center\\'><svg class=\\'mx-auto w-16 h-16 text-gray-400 mb-4\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\' /></svg><div class=\\'text-gray-500\\'>Failed to load image</div></div></div>'; console.error('Full image failed to load:', '${g.id}');"
            />
          </div>` : `<div class="w-16 h-16 flex items-center justify-center overflow-hidden bg-gray-50 rounded">
            <img 
              src="${b}" 
              class="max-w-full max-h-full object-cover" 
              alt="Thumbnail"
              onerror="this.onerror=null; this.style.display='none'; this.parentNode.innerHTML='<svg class=\\'w-8 h-8 text-gray-400\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\' /></svg>'; console.error('Thumbnail failed to load:', '${g.id}');"
            />
          </div>`;
      case "text":
        const P = C ? g.content : g.content.substring(0, 100) + (g.content.length > 100 ? "..." : "");
        return C ? `<pre class="whitespace-pre-wrap break-words">${P}</pre>` : P;
      case "html":
        return C ? `<pre class="whitespace-pre-wrap break-words text-sm font-mono">${g.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>` : '<div class="text-xs italic">[HTML Content]</div>';
      default:
        return `[${g.type} content]`;
    }
  }
  c.legacy_pre_effect(() => (s(), _), () => {
    c.set(a, s().filtered ? _.search(s().items, s().searchQuery) : s().items);
  }), c.legacy_pre_effect(() => s(), () => {
    c.set(i, s().selectedItem);
  }), c.legacy_pre_effect(() => s(), () => {
    c.set(o, s().selectedIndex);
  }), c.legacy_pre_effect(() => s(), () => {
    c.set(u, s().isLoading);
  }), c.legacy_pre_effect(() => s(), () => {
    c.set(l, s().loadError);
  }), c.legacy_pre_effect(() => s(), () => {
    c.set(d, s().errorMessage);
  }), c.legacy_pre_effect_reset(), c.init(), Ke(r, {
    leftWidth: 300,
    minLeftWidth: 200,
    maxLeftWidth: 600,
    $$slots: {
      left: (g, C) => {
        var b = Vr(), P = c.child(b);
        c.each(P, 7, () => c.get(a), (D) => D.id, (D, A, M) => {
          var x = jr();
          let $;
          var I = c.child(x), F = c.child(I), V = c.child(F), S = c.child(V, !0);
          c.reset(V), c.reset(F);
          var T = c.sibling(F, 2), z = c.child(T, !0);
          c.reset(T), c.reset(I);
          var U = c.sibling(I, 2), Z = c.child(U);
          c.html(Z, () => O(c.get(A)), !1, !1), c.reset(U), c.reset(x), c.template_effect(
            (ee, oe) => {
              c.set_attribute(x, "data-index", c.get(M)), $ = c.set_class(x, 1, "result-item relative", null, $, ee), c.set_text(S, c.get(A).type), c.set_text(z, oe);
            },
            [
              () => ({
                "selected-result": c.get(o) === c.get(M)
              }),
              () => E(c.get(A))
            ],
            c.derived_safe_equal
          ), c.event("click", x, () => p(c.get(M))), c.event("dblclick", x, () => _.handleItemAction(c.get(A), "paste")), c.append(D, x);
        }), c.reset(P), c.reset(b), c.bind_this(b, (D) => c.set(h, D), () => c.get(h)), c.event("keydown", b, m), c.append(g, b);
      },
      right: (g, C) => {
        var b = qr(), P = c.child(b);
        {
          var D = (M) => {
            var x = zr(), $ = c.first_child(x), I = c.child($), F = c.child(I), V = c.child(F), S = c.child(V), T = c.child(S, !0);
            c.reset(S), c.reset(V);
            var z = c.sibling(V, 2), U = c.child(z, !0);
            c.reset(z), c.reset(F), c.reset(I), c.reset($);
            var Z = c.sibling($, 2), ee = c.child(Z), oe = c.child(ee);
            c.html(oe, () => O(c.get(i), !0), !1, !1), c.reset(ee), c.reset(Z), c.template_effect(
              (je) => {
                c.set_text(T, c.get(i).type), c.set_text(U, je);
              },
              [
                () => le(c.get(i).createdAt, "PPpp")
              ],
              c.derived_safe_equal
            ), c.append(M, x);
          }, A = (M) => {
            var x = Qr();
            c.append(M, x);
          };
          c.if(P, (M) => {
            c.get(i) ? M(D) : M(A, !1);
          });
        }
        c.reset(b), c.append(g, b);
      }
    }
  }), c.pop(), n();
}
const Gr = [
  {
    id: "clipboard-history",
    title: "Clipboard History",
    subtitle: "View and manage your clipboard history",
    keywords: "clipboard copy paste history"
  }
], Xr = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["title", "subtitle", "keywords"]
};
new W(Gr, Xr);
class Kr {
  constructor() {
    R(this, "onUnload");
    R(this, "logService");
    R(this, "extensionManager");
    R(this, "clipboardService");
    R(this, "actionService");
    R(this, "inView", !1);
    R(this, "context");
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
    } catch (s) {
      console.error("Clipboard History initialization failed:", s), (n = this.logService) == null || n.error(
        `Clipboard History initialization failed: ${s}`
      );
    }
  }
  async executeCommand(e, t) {
    var n, s, a;
    switch ((n = this.logService) == null || n.info(`Executing clipboard command: ${e}`), e) {
      case "show-clipboard":
        return await this.refreshClipboardData(), (s = this.extensionManager) == null || s.navigateToView(
          "clipboard-history/ExtensionListView"
        ), this.registerViewActions(), {
          type: "view",
          viewPath: "clipboard-history/ClipboardHistory"
        };
      default:
        throw (a = this.logService) == null || a.error(`Received unknown command ID: ${e}`), new Error(`Unknown command: ${e}`);
    }
  }
  // Called when this extension's view is activated
  async viewActivated(e) {
    var t, n;
    this.inView = !0, (t = this.logService) == null || t.debug(`Clipboard History view activated: ${e}`), (n = this.extensionManager) == null || n.setActiveViewActionLabel("Paste"), await this.refreshClipboardData();
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
        var s, a, i, o;
        try {
          confirm(
            "Are you sure you want to clear all non-favorite clipboard items?"
          ) && (await ((s = this.clipboardService) == null ? void 0 : s.clearNonFavorites()) ? (a = this.logService) == null || a.info("Non-favorite clipboard history cleared") : (i = this.logService) == null || i.warn(
            "Clearing non-favorite clipboard history reported failure."
          ), await this.refreshClipboardData());
        } catch (u) {
          (o = this.logService) == null || o.error(`Failed to clear clipboard history: ${u}`);
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
const sn = new Kr();
export {
  nn as ExtensionListView,
  sn as default
};
