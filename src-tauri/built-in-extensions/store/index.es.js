var me = Object.defineProperty;
var pe = (i, e, t) => e in i ? me(i, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : i[e] = t;
var B = (i, e, t) => pe(i, typeof e != "symbol" ? e + "" : e, t);
import { writable as Se, get as ee } from "svelte/store";
import { invoke as Ee } from "@tauri-apps/api/core";
function w(i) {
  return Array.isArray ? Array.isArray(i) : ue(i) === "[object Array]";
}
function Ie(i) {
  if (typeof i == "string")
    return i;
  let e = i + "";
  return e == "0" && 1 / i == -1 / 0 ? "-0" : e;
}
function xe(i) {
  return i == null ? "" : Ie(i);
}
function x(i) {
  return typeof i == "string";
}
function ce(i) {
  return typeof i == "number";
}
function ve(i) {
  return i === !0 || i === !1 || we(i) && ue(i) == "[object Boolean]";
}
function oe(i) {
  return typeof i == "object";
}
function we(i) {
  return oe(i) && i !== null;
}
function S(i) {
  return i != null;
}
function W(i) {
  return !i.trim().length;
}
function ue(i) {
  return i == null ? i === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(i);
}
const Ce = "Incorrect 'index' type", Me = (i) => `Invalid value for key ${i}`, De = (i) => `Pattern length exceeds max of ${i}.`, ye = (i) => `Missing ${i} property in key`, Fe = (i) => `Property 'weight' in key '${i}' must be a positive integer`, te = Object.prototype.hasOwnProperty;
class Be {
  constructor(e) {
    this._keys = [], this._keyMap = {};
    let t = 0;
    e.forEach((s) => {
      let n = ae(s);
      this._keys.push(n), this._keyMap[n.id] = n, t += n.weight;
    }), this._keys.forEach((s) => {
      s.weight /= t;
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
function ae(i) {
  let e = null, t = null, s = null, n = 1, c = null;
  if (x(i) || w(i))
    s = i, e = ie(i), t = U(i);
  else {
    if (!te.call(i, "name"))
      throw new Error(ye("name"));
    const u = i.name;
    if (s = u, te.call(i, "weight") && (n = i.weight, n <= 0))
      throw new Error(Fe(u));
    e = ie(u), t = U(u), c = i.getFn;
  }
  return { path: e, id: t, weight: n, src: s, getFn: c };
}
function ie(i) {
  return w(i) ? i : i.split(".");
}
function U(i) {
  return w(i) ? i.join(".") : i;
}
function be(i, e) {
  let t = [], s = !1;
  const n = (c, u, r) => {
    if (S(c))
      if (!u[r])
        t.push(c);
      else {
        let o = u[r];
        const a = c[o];
        if (!S(a))
          return;
        if (r === u.length - 1 && (x(a) || ce(a) || ve(a)))
          t.push(xe(a));
        else if (w(a)) {
          s = !0;
          for (let l = 0, d = a.length; l < d; l += 1)
            n(a[l], u, r + 1);
        } else u.length && n(a, u, r + 1);
      }
  };
  return n(i, x(e) ? e.split(".") : e, 0), s ? t : t[0];
}
const _e = {
  // Whether the matches should be included in the result set. When `true`, each record in the result
  // set will include the indices of the matched characters.
  // These can consequently be used for highlighting purposes.
  includeMatches: !1,
  // When `true`, the matching function will continue to the end of a search pattern even if
  // a perfect match has already been located in the string.
  findAllMatches: !1,
  // Minimum number of characters that must be matched before a result is considered a match
  minMatchCharLength: 1
}, Le = {
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
  sortFn: (i, e) => i.score === e.score ? i.idx < e.idx ? -1 : 1 : i.score < e.score ? -1 : 1
}, $e = {
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
}, Re = {
  // When `true`, it enables the use of unix-like search commands
  useExtendedSearch: !1,
  // The get function to use when fetching an object's properties.
  // The default will search nested paths *ie foo.bar.baz*
  getFn: be,
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
var h = {
  ...Le,
  ..._e,
  ...$e,
  ...Re
};
const Ve = /[^ ]+/g;
function ke(i = 1, e = 3) {
  const t = /* @__PURE__ */ new Map(), s = Math.pow(10, e);
  return {
    get(n) {
      const c = n.match(Ve).length;
      if (t.has(c))
        return t.get(c);
      const u = 1 / Math.pow(c, 0.5 * i), r = parseFloat(Math.round(u * s) / s);
      return t.set(c, r), r;
    },
    clear() {
      t.clear();
    }
  };
}
class X {
  constructor({
    getFn: e = h.getFn,
    fieldNormWeight: t = h.fieldNormWeight
  } = {}) {
    this.norm = ke(t, 3), this.getFn = e, this.isCreated = !1, this.setIndexRecords();
  }
  setSources(e = []) {
    this.docs = e;
  }
  setIndexRecords(e = []) {
    this.records = e;
  }
  setKeys(e = []) {
    this.keys = e, this._keysMap = {}, e.forEach((t, s) => {
      this._keysMap[t.id] = s;
    });
  }
  create() {
    this.isCreated || !this.docs.length || (this.isCreated = !0, x(this.docs[0]) ? this.docs.forEach((e, t) => {
      this._addString(e, t);
    }) : this.docs.forEach((e, t) => {
      this._addObject(e, t);
    }), this.norm.clear());
  }
  // Adds a doc to the end of the index
  add(e) {
    const t = this.size();
    x(e) ? this._addString(e, t) : this._addObject(e, t);
  }
  // Removes the doc at the specified index of the index
  removeAt(e) {
    this.records.splice(e, 1);
    for (let t = e, s = this.size(); t < s; t += 1)
      this.records[t].i -= 1;
  }
  getValueForItemAtKeyId(e, t) {
    return e[this._keysMap[t]];
  }
  size() {
    return this.records.length;
  }
  _addString(e, t) {
    if (!S(e) || W(e))
      return;
    let s = {
      v: e,
      i: t,
      n: this.norm.get(e)
    };
    this.records.push(s);
  }
  _addObject(e, t) {
    let s = { i: t, $: {} };
    this.keys.forEach((n, c) => {
      let u = n.getFn ? n.getFn(e) : this.getFn(e, n.path);
      if (S(u)) {
        if (w(u)) {
          let r = [];
          const o = [{ nestedArrIndex: -1, value: u }];
          for (; o.length; ) {
            const { nestedArrIndex: a, value: l } = o.pop();
            if (S(l))
              if (x(l) && !W(l)) {
                let d = {
                  v: l,
                  i: a,
                  n: this.norm.get(l)
                };
                r.push(d);
              } else w(l) && l.forEach((d, f) => {
                o.push({
                  nestedArrIndex: f,
                  value: d
                });
              });
          }
          s.$[c] = r;
        } else if (x(u) && !W(u)) {
          let r = {
            v: u,
            n: this.norm.get(u)
          };
          s.$[c] = r;
        }
      }
    }), this.records.push(s);
  }
  toJSON() {
    return {
      keys: this.keys,
      records: this.records
    };
  }
}
function le(i, e, { getFn: t = h.getFn, fieldNormWeight: s = h.fieldNormWeight } = {}) {
  const n = new X({ getFn: t, fieldNormWeight: s });
  return n.setKeys(i.map(ae)), n.setSources(e), n.create(), n;
}
function Ne(i, { getFn: e = h.getFn, fieldNormWeight: t = h.fieldNormWeight } = {}) {
  const { keys: s, records: n } = i, c = new X({ getFn: e, fieldNormWeight: t });
  return c.setKeys(s), c.setIndexRecords(n), c;
}
function O(i, {
  errors: e = 0,
  currentLocation: t = 0,
  expectedLocation: s = 0,
  distance: n = h.distance,
  ignoreLocation: c = h.ignoreLocation
} = {}) {
  const u = e / i.length;
  if (c)
    return u;
  const r = Math.abs(s - t);
  return n ? u + r / n : r ? 1 : u;
}
function Oe(i = [], e = h.minMatchCharLength) {
  let t = [], s = -1, n = -1, c = 0;
  for (let u = i.length; c < u; c += 1) {
    let r = i[c];
    r && s === -1 ? s = c : !r && s !== -1 && (n = c - 1, n - s + 1 >= e && t.push([s, n]), s = -1);
  }
  return i[c - 1] && c - s >= e && t.push([s, c - 1]), t;
}
const L = 32;
function Te(i, e, t, {
  location: s = h.location,
  distance: n = h.distance,
  threshold: c = h.threshold,
  findAllMatches: u = h.findAllMatches,
  minMatchCharLength: r = h.minMatchCharLength,
  includeMatches: o = h.includeMatches,
  ignoreLocation: a = h.ignoreLocation
} = {}) {
  if (e.length > L)
    throw new Error(De(L));
  const l = e.length, d = i.length, f = Math.max(0, Math.min(s, d));
  let g = c, A = f;
  const m = r > 1 || o, p = m ? Array(d) : [];
  let C;
  for (; (C = i.indexOf(e, A)) > -1; ) {
    let E = O(e, {
      currentLocation: C,
      expectedLocation: f,
      distance: n,
      ignoreLocation: a
    });
    if (g = Math.min(E, g), A = C + l, m) {
      let M = 0;
      for (; M < l; )
        p[C + M] = 1, M += 1;
    }
  }
  A = -1;
  let v = [], $ = 1, F = l + d;
  const Ae = 1 << l - 1;
  for (let E = 0; E < l; E += 1) {
    let M = 0, D = F;
    for (; M < D; )
      O(e, {
        errors: E,
        currentLocation: f + D,
        expectedLocation: f,
        distance: n,
        ignoreLocation: a
      }) <= g ? M = D : F = D, D = Math.floor((F - M) / 2 + M);
    F = D;
    let Z = Math.max(1, f - D + 1), K = u ? d : Math.min(f + D, d) + l, R = Array(K + 2);
    R[K + 1] = (1 << E) - 1;
    for (let I = K; I >= Z; I -= 1) {
      let N = I - 1, q = t[i.charAt(N)];
      if (m && (p[N] = +!!q), R[I] = (R[I + 1] << 1 | 1) & q, E && (R[I] |= (v[I + 1] | v[I]) << 1 | 1 | v[I + 1]), R[I] & Ae && ($ = O(e, {
        errors: E,
        currentLocation: N,
        expectedLocation: f,
        distance: n,
        ignoreLocation: a
      }), $ <= g)) {
        if (g = $, A = N, A <= f)
          break;
        Z = Math.max(1, 2 * f - A);
      }
    }
    if (O(e, {
      errors: E + 1,
      currentLocation: f,
      expectedLocation: f,
      distance: n,
      ignoreLocation: a
    }) > g)
      break;
    v = R;
  }
  const z = {
    isMatch: A >= 0,
    // Count exact matches (those with a score of 0) to be "almost" exact
    score: Math.max(1e-3, $)
  };
  if (m) {
    const E = Oe(p, r);
    E.length ? o && (z.indices = E) : z.isMatch = !1;
  }
  return z;
}
function je(i) {
  let e = {};
  for (let t = 0, s = i.length; t < s; t += 1) {
    const n = i.charAt(t);
    e[n] = (e[n] || 0) | 1 << s - t - 1;
  }
  return e;
}
const j = String.prototype.normalize ? (i) => i.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "") : (i) => i;
class he {
  constructor(e, {
    location: t = h.location,
    threshold: s = h.threshold,
    distance: n = h.distance,
    includeMatches: c = h.includeMatches,
    findAllMatches: u = h.findAllMatches,
    minMatchCharLength: r = h.minMatchCharLength,
    isCaseSensitive: o = h.isCaseSensitive,
    ignoreDiacritics: a = h.ignoreDiacritics,
    ignoreLocation: l = h.ignoreLocation
  } = {}) {
    if (this.options = {
      location: t,
      threshold: s,
      distance: n,
      includeMatches: c,
      findAllMatches: u,
      minMatchCharLength: r,
      isCaseSensitive: o,
      ignoreDiacritics: a,
      ignoreLocation: l
    }, e = o ? e : e.toLowerCase(), e = a ? j(e) : e, this.pattern = e, this.chunks = [], !this.pattern.length)
      return;
    const d = (g, A) => {
      this.chunks.push({
        pattern: g,
        alphabet: je(g),
        startIndex: A
      });
    }, f = this.pattern.length;
    if (f > L) {
      let g = 0;
      const A = f % L, m = f - A;
      for (; g < m; )
        d(this.pattern.substr(g, L), g), g += L;
      if (A) {
        const p = f - L;
        d(this.pattern.substr(p), p);
      }
    } else
      d(this.pattern, 0);
  }
  searchIn(e) {
    const { isCaseSensitive: t, ignoreDiacritics: s, includeMatches: n } = this.options;
    if (e = t ? e : e.toLowerCase(), e = s ? j(e) : e, this.pattern === e) {
      let m = {
        isMatch: !0,
        score: 0
      };
      return n && (m.indices = [[0, e.length - 1]]), m;
    }
    const {
      location: c,
      distance: u,
      threshold: r,
      findAllMatches: o,
      minMatchCharLength: a,
      ignoreLocation: l
    } = this.options;
    let d = [], f = 0, g = !1;
    this.chunks.forEach(({ pattern: m, alphabet: p, startIndex: C }) => {
      const { isMatch: v, score: $, indices: F } = Te(e, m, p, {
        location: c + C,
        distance: u,
        threshold: r,
        findAllMatches: o,
        minMatchCharLength: a,
        includeMatches: n,
        ignoreLocation: l
      });
      v && (g = !0), f += $, v && F && (d = [...d, ...F]);
    });
    let A = {
      isMatch: g,
      score: g ? f / this.chunks.length : 1
    };
    return g && n && (A.indices = d), A;
  }
}
class y {
  constructor(e) {
    this.pattern = e;
  }
  static isMultiMatch(e) {
    return se(e, this.multiRegex);
  }
  static isSingleMatch(e) {
    return se(e, this.singleRegex);
  }
  search() {
  }
}
function se(i, e) {
  const t = i.match(e);
  return t ? t[1] : null;
}
class Pe extends y {
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
class ze extends y {
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
    const s = e.indexOf(this.pattern) === -1;
    return {
      isMatch: s,
      score: s ? 0 : 1,
      indices: [0, e.length - 1]
    };
  }
}
class Ke extends y {
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
class We extends y {
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
class Ue extends y {
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
class Qe extends y {
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
class de extends y {
  constructor(e, {
    location: t = h.location,
    threshold: s = h.threshold,
    distance: n = h.distance,
    includeMatches: c = h.includeMatches,
    findAllMatches: u = h.findAllMatches,
    minMatchCharLength: r = h.minMatchCharLength,
    isCaseSensitive: o = h.isCaseSensitive,
    ignoreDiacritics: a = h.ignoreDiacritics,
    ignoreLocation: l = h.ignoreLocation
  } = {}) {
    super(e), this._bitapSearch = new he(e, {
      location: t,
      threshold: s,
      distance: n,
      includeMatches: c,
      findAllMatches: u,
      minMatchCharLength: r,
      isCaseSensitive: o,
      ignoreDiacritics: a,
      ignoreLocation: l
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
class fe extends y {
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
    let t = 0, s;
    const n = [], c = this.pattern.length;
    for (; (s = e.indexOf(this.pattern, t)) > -1; )
      t = s + c, n.push([s, t - 1]);
    const u = !!n.length;
    return {
      isMatch: u,
      score: u ? 0 : 1,
      indices: n
    };
  }
}
const Q = [
  Pe,
  fe,
  Ke,
  We,
  Qe,
  Ue,
  ze,
  de
], ne = Q.length, Ge = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/, He = "|";
function Ye(i, e = {}) {
  return i.split(He).map((t) => {
    let s = t.trim().split(Ge).filter((c) => c && !!c.trim()), n = [];
    for (let c = 0, u = s.length; c < u; c += 1) {
      const r = s[c];
      let o = !1, a = -1;
      for (; !o && ++a < ne; ) {
        const l = Q[a];
        let d = l.isMultiMatch(r);
        d && (n.push(new l(d, e)), o = !0);
      }
      if (!o)
        for (a = -1; ++a < ne; ) {
          const l = Q[a];
          let d = l.isSingleMatch(r);
          if (d) {
            n.push(new l(d, e));
            break;
          }
        }
    }
    return n;
  });
}
const Je = /* @__PURE__ */ new Set([de.type, fe.type]);
class Xe {
  constructor(e, {
    isCaseSensitive: t = h.isCaseSensitive,
    ignoreDiacritics: s = h.ignoreDiacritics,
    includeMatches: n = h.includeMatches,
    minMatchCharLength: c = h.minMatchCharLength,
    ignoreLocation: u = h.ignoreLocation,
    findAllMatches: r = h.findAllMatches,
    location: o = h.location,
    threshold: a = h.threshold,
    distance: l = h.distance
  } = {}) {
    this.query = null, this.options = {
      isCaseSensitive: t,
      ignoreDiacritics: s,
      includeMatches: n,
      minMatchCharLength: c,
      findAllMatches: r,
      ignoreLocation: u,
      location: o,
      threshold: a,
      distance: l
    }, e = t ? e : e.toLowerCase(), e = s ? j(e) : e, this.pattern = e, this.query = Ye(this.pattern, this.options);
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
    const { includeMatches: s, isCaseSensitive: n, ignoreDiacritics: c } = this.options;
    e = n ? e : e.toLowerCase(), e = c ? j(e) : e;
    let u = 0, r = [], o = 0;
    for (let a = 0, l = t.length; a < l; a += 1) {
      const d = t[a];
      r.length = 0, u = 0;
      for (let f = 0, g = d.length; f < g; f += 1) {
        const A = d[f], { isMatch: m, indices: p, score: C } = A.search(e);
        if (m) {
          if (u += 1, o += C, s) {
            const v = A.constructor.type;
            Je.has(v) ? r = [...r, ...p] : r.push(p);
          }
        } else {
          o = 0, u = 0, r.length = 0;
          break;
        }
      }
      if (u) {
        let f = {
          isMatch: !0,
          score: o / u
        };
        return s && (f.indices = r), f;
      }
    }
    return {
      isMatch: !1,
      score: 1
    };
  }
}
const G = [];
function Ze(...i) {
  G.push(...i);
}
function H(i, e) {
  for (let t = 0, s = G.length; t < s; t += 1) {
    let n = G[t];
    if (n.condition(i, e))
      return new n(i, e);
  }
  return new he(i, e);
}
const P = {
  AND: "$and",
  OR: "$or"
}, Y = {
  PATH: "$path",
  PATTERN: "$val"
}, J = (i) => !!(i[P.AND] || i[P.OR]), qe = (i) => !!i[Y.PATH], et = (i) => !w(i) && oe(i) && !J(i), re = (i) => ({
  [P.AND]: Object.keys(i).map((e) => ({
    [e]: i[e]
  }))
});
function ge(i, e, { auto: t = !0 } = {}) {
  const s = (n) => {
    let c = Object.keys(n);
    const u = qe(n);
    if (!u && c.length > 1 && !J(n))
      return s(re(n));
    if (et(n)) {
      const o = u ? n[Y.PATH] : c[0], a = u ? n[Y.PATTERN] : n[o];
      if (!x(a))
        throw new Error(Me(o));
      const l = {
        keyId: U(o),
        pattern: a
      };
      return t && (l.searcher = H(a, e)), l;
    }
    let r = {
      children: [],
      operator: c[0]
    };
    return c.forEach((o) => {
      const a = n[o];
      w(a) && a.forEach((l) => {
        r.children.push(s(l));
      });
    }), r;
  };
  return J(i) || (i = re(i)), s(i);
}
function tt(i, { ignoreFieldNorm: e = h.ignoreFieldNorm }) {
  i.forEach((t) => {
    let s = 1;
    t.matches.forEach(({ key: n, norm: c, score: u }) => {
      const r = n ? n.weight : null;
      s *= Math.pow(
        u === 0 && r ? Number.EPSILON : u,
        (r || 1) * (e ? 1 : c)
      );
    }), t.score = s;
  });
}
function it(i, e) {
  const t = i.matches;
  e.matches = [], S(t) && t.forEach((s) => {
    if (!S(s.indices) || !s.indices.length)
      return;
    const { indices: n, value: c } = s;
    let u = {
      indices: n,
      value: c
    };
    s.key && (u.key = s.key.src), s.idx > -1 && (u.refIndex = s.idx), e.matches.push(u);
  });
}
function st(i, e) {
  e.score = i.score;
}
function nt(i, e, {
  includeMatches: t = h.includeMatches,
  includeScore: s = h.includeScore
} = {}) {
  const n = [];
  return t && n.push(it), s && n.push(st), i.map((c) => {
    const { idx: u } = c, r = {
      item: e[u],
      refIndex: u
    };
    return n.length && n.forEach((o) => {
      o(c, r);
    }), r;
  });
}
class V {
  constructor(e, t = {}, s) {
    this.options = { ...h, ...t }, this.options.useExtendedSearch, this._keyStore = new Be(this.options.keys), this.setCollection(e, s);
  }
  setCollection(e, t) {
    if (this._docs = e, t && !(t instanceof X))
      throw new Error(Ce);
    this._myIndex = t || le(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
  }
  add(e) {
    S(e) && (this._docs.push(e), this._myIndex.add(e));
  }
  remove(e = () => !1) {
    const t = [];
    for (let s = 0, n = this._docs.length; s < n; s += 1) {
      const c = this._docs[s];
      e(c, s) && (this.removeAt(s), s -= 1, n -= 1, t.push(c));
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
      includeMatches: s,
      includeScore: n,
      shouldSort: c,
      sortFn: u,
      ignoreFieldNorm: r
    } = this.options;
    let o = x(e) ? x(this._docs[0]) ? this._searchStringList(e) : this._searchObjectList(e) : this._searchLogical(e);
    return tt(o, { ignoreFieldNorm: r }), c && o.sort(u), ce(t) && t > -1 && (o = o.slice(0, t)), nt(o, this._docs, {
      includeMatches: s,
      includeScore: n
    });
  }
  _searchStringList(e) {
    const t = H(e, this.options), { records: s } = this._myIndex, n = [];
    return s.forEach(({ v: c, i: u, n: r }) => {
      if (!S(c))
        return;
      const { isMatch: o, score: a, indices: l } = t.searchIn(c);
      o && n.push({
        item: c,
        idx: u,
        matches: [{ score: a, value: c, norm: r, indices: l }]
      });
    }), n;
  }
  _searchLogical(e) {
    const t = ge(e, this.options), s = (r, o, a) => {
      if (!r.children) {
        const { keyId: d, searcher: f } = r, g = this._findMatches({
          key: this._keyStore.get(d),
          value: this._myIndex.getValueForItemAtKeyId(o, d),
          searcher: f
        });
        return g && g.length ? [
          {
            idx: a,
            item: o,
            matches: g
          }
        ] : [];
      }
      const l = [];
      for (let d = 0, f = r.children.length; d < f; d += 1) {
        const g = r.children[d], A = s(g, o, a);
        if (A.length)
          l.push(...A);
        else if (r.operator === P.AND)
          return [];
      }
      return l;
    }, n = this._myIndex.records, c = {}, u = [];
    return n.forEach(({ $: r, i: o }) => {
      if (S(r)) {
        let a = s(t, r, o);
        a.length && (c[o] || (c[o] = { idx: o, item: r, matches: [] }, u.push(c[o])), a.forEach(({ matches: l }) => {
          c[o].matches.push(...l);
        }));
      }
    }), u;
  }
  _searchObjectList(e) {
    const t = H(e, this.options), { keys: s, records: n } = this._myIndex, c = [];
    return n.forEach(({ $: u, i: r }) => {
      if (!S(u))
        return;
      let o = [];
      s.forEach((a, l) => {
        o.push(
          ...this._findMatches({
            key: a,
            value: u[l],
            searcher: t
          })
        );
      }), o.length && c.push({
        idx: r,
        item: u,
        matches: o
      });
    }), c;
  }
  _findMatches({ key: e, value: t, searcher: s }) {
    if (!S(t))
      return [];
    let n = [];
    if (w(t))
      t.forEach(({ v: c, i: u, n: r }) => {
        if (!S(c))
          return;
        const { isMatch: o, score: a, indices: l } = s.searchIn(c);
        o && n.push({
          score: a,
          key: e,
          value: c,
          idx: u,
          norm: r,
          indices: l
        });
      });
    else {
      const { v: c, n: u } = t, { isMatch: r, score: o, indices: a } = s.searchIn(c);
      r && n.push({ score: o, key: e, value: c, norm: u, indices: a });
    }
    return n;
  }
}
V.version = "7.1.0";
V.createIndex = le;
V.parseIndex = Ne;
V.config = h;
V.parseQuery = ge;
Ze(Xe);
const rt = {
  includeScore: !0,
  threshold: 0.4,
  // Adjust threshold as needed
  keys: ["name", "description", "author.name", "category", "keywords"]
  // Add keywords if available in ApiExtension
};
function ct() {
  const { subscribe: i, set: e, update: t } = Se({
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
    extensionManager: null
    // Initialize as null
  });
  let s, n;
  function c(r) {
    s = r.getService("LogService"), n = r.getService("ExtensionManager"), t((o) => ({ ...o, extensionManager: n ?? null }));
  }
  function u(r) {
    return r.searchQuery ? r.fuseInstance ? r.fuseInstance.search(r.searchQuery).map((a) => a.item) : (s == null || s.warn("Fuse instance not initialized for search."), r.allItems) : r.allItems;
  }
  return {
    subscribe: i,
    initializeServices: c,
    setItems: (r) => {
      s == null || s.debug(`Store state received ${r.length} items.`), t((o) => {
        const a = new V(r, rt), l = {
          ...o,
          allItems: r,
          fuseInstance: a,
          isLoading: !1,
          loadError: !1,
          errorMessage: ""
        };
        return l.filteredItems = u(l), l.selectedIndex = l.filteredItems.length > 0 ? 0 : -1, l.selectedItem = l.selectedIndex !== -1 ? l.filteredItems[l.selectedIndex] : null, l;
      });
    },
    setSearch: (r) => {
      t((o) => {
        const a = {
          ...o,
          searchQuery: r,
          filtered: r.length > 0
        };
        return a.filteredItems = u(a), a.selectedIndex = a.filteredItems.length > 0 ? 0 : -1, a.selectedItem = a.selectedIndex !== -1 ? a.filteredItems[a.selectedIndex] : null, a;
      });
    },
    moveSelection(r) {
      t((o) => {
        if (!o.filteredItems.length) return o;
        let a = o.selectedIndex;
        const l = o.filteredItems.length - 1;
        return r === "up" ? a = a <= 0 ? l : a - 1 : a = a >= l ? 0 : a + 1, {
          ...o,
          selectedIndex: a,
          selectedItem: o.filteredItems[a]
        };
      });
    },
    setSelectedItemByIndex(r) {
      t((o) => r >= 0 && r < o.filteredItems.length ? {
        ...o,
        selectedIndex: r,
        selectedItem: o.filteredItems[r]
      } : { ...o, selectedIndex: -1, selectedItem: null });
    },
    setSelectedExtensionSlug(r) {
      t((o) => ({ ...o, selectedExtensionSlug: r }));
    },
    setLoading(r) {
      t((o) => ({ ...o, isLoading: r }));
    },
    setError(r) {
      t((o) => ({
        ...o,
        loadError: !0,
        errorMessage: r,
        isLoading: !1,
        allItems: [],
        filteredItems: []
      }));
    }
  };
}
const k = ct(), b = "store", T = "store-install-detail", _ = "store-install-selected";
class ot {
  constructor() {
    B(this, "extensionManager");
    B(this, "logService");
    B(this, "actionService");
    B(this, "notificationService");
    B(this, "activeViewPath", null);
    B(this, "listViewActionSubscription", null);
  }
  // To hold the unsubscribe function
  async initialize(e) {
    var t;
    this.logService = e.getService("LogService"), this.extensionManager = e.getService("ExtensionManager"), this.actionService = e.getService("ActionService"), this.notificationService = e.getService(
      "NotificationService"
    ), k.initializeServices(e), (t = this.logService) == null || t.info(
      "Store extension initialized and state services initialized."
    );
  }
  // --- Private Helper for Installation ---
  async _installExtension(e, t) {
    var n, c, u, r, o, a, l, d, f;
    if (!e) {
      (n = this.logService) == null || n.error("Install function called without a slug."), (c = this.notificationService) == null || c.notify({
        title: "Install Failed",
        body: "Could not determine which extension to install."
      });
      return;
    }
    const s = t || e;
    (u = this.logService) == null || u.info(`Install action triggered for slug: ${e}`);
    try {
      const g = await fetch(
        `http://asyar-website.test/api/extensions/${e}/install`
      );
      if (!g.ok)
        throw new Error(
          `Failed to get install info: ${g.status} ${await g.text()}`
        );
      const A = await g.json();
      (r = this.logService) == null || r.info(
        `Install info received: Version ${A.version}, URL: ${A.download_url}`
      ), (o = this.logService) == null || o.info(
        `Invoking Tauri command 'install_extension_from_url' for ${s}`
      ), await Ee("install_extension_from_url", {
        downloadUrl: A.download_url,
        extensionId: e,
        extensionName: s,
        // Use the determined name
        version: A.version
      }), (a = this.logService) == null || a.info(
        `Installation command invoked successfully for ${s}. App might reload extensions.`
      ), (l = this.notificationService) == null || l.notify({
        title: "Installation Started",
        body: `Installation for ${s} initiated. App may reload.`
      });
    } catch (g) {
      (d = this.logService) == null || d.error(
        `Installation failed for ${s}: ${g.message}`
      ), (f = this.notificationService) == null || f.notify({
        title: "Installation Failed",
        body: `Could not install ${s}. ${g.message}`
      });
    }
  }
  // --- End Private Helper ---
  async executeCommand(e, t) {
    var n, c, u;
    if ((n = this.logService) == null || n.info(`Store executing command: ${e}`), e === "browse")
      return this.extensionManager ? (this.extensionManager.navigateToView(
        `${b}/ExtensionListView`
      ), { success: !0 }) : ((c = this.logService) == null || c.error("ExtensionManager service not available."), { success: !1, error: "ExtensionManager not available" });
    throw (u = this.logService) == null || u.warn(
      `Received unknown command ID for store: ${e}`
    ), new Error(`Unknown command for store: ${e}`);
  }
  // Optional lifecycle methods
  async activate() {
    var e;
    (e = this.logService) == null || e.info("Store extension activated.");
  }
  async deactivate() {
    var e;
    (e = this.logService) == null || e.info("Store extension deactivated.");
  }
  // --- Action Registration ---
  // Action for Detail View
  registerDetailViewActions() {
    var t;
    if (!this.actionService) return;
    (t = this.logService) == null || t.debug(`Registering action: ${T}`);
    const e = {
      id: T,
      title: "Install Extension",
      description: "Install the currently viewed extension",
      icon: "💾",
      // Example icon
      extensionId: b,
      execute: async () => {
        const n = ee(k).selectedExtensionSlug;
        await this._installExtension(n, void 0);
      }
      // Removed isActive property as it's not in ExtensionAction type
    };
    this.actionService.registerAction(e);
  }
  unregisterDetailViewActions() {
    var e;
    this.actionService && ((e = this.logService) == null || e.debug(`Unregistering action: ${T}`), this.actionService.unregisterAction(T));
  }
  // Action for List View Selection - Now manages subscription
  registerListViewActions() {
    var e;
    !this.actionService || this.listViewActionSubscription || ((e = this.logService) == null || e.debug(
      `Setting up subscription for dynamic list view action: ${_}`
    ), this.listViewActionSubscription = k.subscribe((t) => {
      var n, c, u, r, o, a, l, d;
      (n = this.actionService) == null || n.unregisterAction(_), (c = this.extensionManager) == null || c.setActiveViewActionLabel(null);
      const s = t.selectedItem;
      if (s) {
        (u = this.extensionManager) == null || u.setActiveViewActionLabel("Show Details"), (r = this.logService) == null || r.debug(
          `Set primary action label to "Show Details" via manager for ${s.name}`
        );
        const f = `Install ${s.name} Extension`;
        (o = this.logService) == null || o.debug(
          `Registering/Updating action ${_} with title: "${f}"`
        );
        const g = {
          id: _,
          title: f,
          // Use the dynamic title
          description: `Install the ${s.name} extension`,
          // Dynamic description too
          icon: "💾",
          // Example icon
          extensionId: b,
          execute: async () => {
            var m, p;
            const A = ee(k).selectedItem;
            A ? await this._installExtension(
              A.slug,
              A.name
            ) : ((m = this.logService) == null || m.warn(
              "Install selected action executed, but no item is selected in state anymore."
            ), (p = this.notificationService) == null || p.notify({
              title: "Install Failed",
              body: "No extension selected."
            }));
          }
        };
        (a = this.actionService) == null || a.registerAction(g);
      } else
        (l = this.logService) == null || l.debug(
          `No item selected, action ${_} remains unregistered and primary label cleared via manager.`
        ), (d = this.extensionManager) == null || d.setActiveViewActionLabel(null);
    }));
  }
  unregisterListViewActions() {
    var e, t, s, n;
    this.listViewActionSubscription && ((e = this.logService) == null || e.debug("Unsubscribing from list view action updates."), this.listViewActionSubscription(), this.listViewActionSubscription = null), this.actionService && ((t = this.logService) == null || t.debug(
      `Unregistering action: ${_}`
    ), this.actionService.unregisterAction(_)), (s = this.extensionManager) == null || s.setActiveViewActionLabel(null), (n = this.logService) == null || n.debug(
      "Cleared primary action label via manager during list view action unregistration."
    );
  }
  // --- End Action Registration ---
  // Required methods from Extension interface
  async viewActivated(e) {
    var t, s, n, c;
    (t = this.logService) == null || t.debug(`Store view activated: ${e}`), this.activeViewPath = e, (s = this.extensionManager) == null || s.setActiveViewActionLabel(null), e === `${b}/ExtensionDetailView` ? (this.unregisterListViewActions(), this.registerDetailViewActions(), (n = this.extensionManager) == null || n.setActiveViewActionLabel("Install Extension"), (c = this.logService) == null || c.debug(
      'Set primary action label to "Install Extension" via manager for detail view.'
    )) : e === `${b}/ExtensionListView` ? (this.unregisterDetailViewActions(), this.registerListViewActions()) : (this.unregisterDetailViewActions(), this.unregisterListViewActions());
  }
  async viewDeactivated(e) {
    var t, s, n;
    (t = this.logService) == null || t.debug(`Store view deactivated: ${e}`), this.activeViewPath = null, e === `${b}/ExtensionDetailView` ? (this.unregisterDetailViewActions(), (s = this.extensionManager) == null || s.setActiveViewActionLabel(null), (n = this.logService) == null || n.debug(
      "Cleared primary action label via manager as detail view deactivated."
    )) : e === `${b}/ExtensionListView` && this.unregisterListViewActions();
  }
  onUnload() {
    var e;
    this.unregisterDetailViewActions(), this.unregisterListViewActions(), (e = this.logService) == null || e.info("Store extension unloading.");
  }
  // Add onViewSearch method
  async onViewSearch(e) {
    var t;
    (t = this.logService) == null || t.debug(`Store view search received: "${e}"`), k.setSearch(e);
  }
}
const dt = new ot();
export {
  dt as default
};
