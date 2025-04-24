var Or = Object.defineProperty;
var Fr = (e, t, n) => t in e ? Or(e, t, { enumerable: !0, configurable: !0, writable: !0, value: n }) : e[t] = n;
var oe = (e, t, n) => Fr(e, typeof t != "symbol" ? t + "" : t, n);
import { writable as Ir, get as kr } from "svelte/store";
import { onMount as Pr, onDestroy as Tr } from "svelte";
function re(e) {
  return Array.isArray ? Array.isArray(e) : qn(e) === "[object Array]";
}
function Br(e) {
  if (typeof e == "string")
    return e;
  let t = e + "";
  return t == "0" && 1 / e == -1 / 0 ? "-0" : t;
}
function Rr(e) {
  return e == null ? "" : Br(e);
}
function K(e) {
  return typeof e == "string";
}
function Hn(e) {
  return typeof e == "number";
}
function $r(e) {
  return e === !0 || e === !1 || Nr(e) && qn(e) == "[object Boolean]";
}
function Yn(e) {
  return typeof e == "object";
}
function Nr(e) {
  return Yn(e) && e !== null;
}
function H(e) {
  return e != null;
}
function Et(e) {
  return !e.trim().length;
}
function qn(e) {
  return e == null ? e === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(e);
}
const Lr = "Incorrect 'index' type", Wr = (e) => `Invalid value for key ${e}`, jr = (e) => `Pattern length exceeds max of ${e}.`, Hr = (e) => `Missing ${e} property in key`, Yr = (e) => `Property 'weight' in key '${e}' must be a positive integer`, on = Object.prototype.hasOwnProperty;
class qr {
  constructor(t) {
    this._keys = [], this._keyMap = {};
    let n = 0;
    t.forEach((r) => {
      let i = Vn(r);
      this._keys.push(i), this._keyMap[i.id] = i, n += i.weight;
    }), this._keys.forEach((r) => {
      r.weight /= n;
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
function Vn(e) {
  let t = null, n = null, r = null, i = 1, s = null;
  if (K(e) || re(e))
    r = e, t = un(e), n = kt(e);
  else {
    if (!on.call(e, "name"))
      throw new Error(Hr("name"));
    const a = e.name;
    if (r = a, on.call(e, "weight") && (i = e.weight, i <= 0))
      throw new Error(Yr(a));
    t = un(a), n = kt(a), s = e.getFn;
  }
  return { path: t, id: n, weight: i, src: r, getFn: s };
}
function un(e) {
  return re(e) ? e : e.split(".");
}
function kt(e) {
  return re(e) ? e.join(".") : e;
}
function Vr(e, t) {
  let n = [], r = !1;
  const i = (s, a, o) => {
    if (H(s))
      if (!a[o])
        n.push(s);
      else {
        let u = a[o];
        const c = s[u];
        if (!H(c))
          return;
        if (o === a.length - 1 && (K(c) || Hn(c) || $r(c)))
          n.push(Rr(c));
        else if (re(c)) {
          r = !0;
          for (let l = 0, f = c.length; l < f; l += 1)
            i(c[l], a, o + 1);
        } else a.length && i(c, a, o + 1);
      }
  };
  return i(e, K(t) ? t.split(".") : t, 0), r ? n : n[0];
}
const zr = {
  // Whether the matches should be included in the result set. When `true`, each record in the result
  // set will include the indices of the matched characters.
  // These can consequently be used for highlighting purposes.
  includeMatches: !1,
  // When `true`, the matching function will continue to the end of a search pattern even if
  // a perfect match has already been located in the string.
  findAllMatches: !1,
  // Minimum number of characters that must be matched before a result is considered a match
  minMatchCharLength: 1
}, Qr = {
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
  sortFn: (e, t) => e.score === t.score ? e.idx < t.idx ? -1 : 1 : e.score < t.score ? -1 : 1
}, Gr = {
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
}, Ur = {
  // When `true`, it enables the use of unix-like search commands
  useExtendedSearch: !1,
  // The get function to use when fetching an object's properties.
  // The default will search nested paths *ie foo.bar.baz*
  getFn: Vr,
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
var m = {
  ...Qr,
  ...zr,
  ...Gr,
  ...Ur
};
const Xr = /[^ ]+/g;
function Kr(e = 1, t = 3) {
  const n = /* @__PURE__ */ new Map(), r = Math.pow(10, t);
  return {
    get(i) {
      const s = i.match(Xr).length;
      if (n.has(s))
        return n.get(s);
      const a = 1 / Math.pow(s, 0.5 * e), o = parseFloat(Math.round(a * r) / r);
      return n.set(s, o), o;
    },
    clear() {
      n.clear();
    }
  };
}
class Ut {
  constructor({
    getFn: t = m.getFn,
    fieldNormWeight: n = m.fieldNormWeight
  } = {}) {
    this.norm = Kr(n, 3), this.getFn = t, this.isCreated = !1, this.setIndexRecords();
  }
  setSources(t = []) {
    this.docs = t;
  }
  setIndexRecords(t = []) {
    this.records = t;
  }
  setKeys(t = []) {
    this.keys = t, this._keysMap = {}, t.forEach((n, r) => {
      this._keysMap[n.id] = r;
    });
  }
  create() {
    this.isCreated || !this.docs.length || (this.isCreated = !0, K(this.docs[0]) ? this.docs.forEach((t, n) => {
      this._addString(t, n);
    }) : this.docs.forEach((t, n) => {
      this._addObject(t, n);
    }), this.norm.clear());
  }
  // Adds a doc to the end of the index
  add(t) {
    const n = this.size();
    K(t) ? this._addString(t, n) : this._addObject(t, n);
  }
  // Removes the doc at the specified index of the index
  removeAt(t) {
    this.records.splice(t, 1);
    for (let n = t, r = this.size(); n < r; n += 1)
      this.records[n].i -= 1;
  }
  getValueForItemAtKeyId(t, n) {
    return t[this._keysMap[n]];
  }
  size() {
    return this.records.length;
  }
  _addString(t, n) {
    if (!H(t) || Et(t))
      return;
    let r = {
      v: t,
      i: n,
      n: this.norm.get(t)
    };
    this.records.push(r);
  }
  _addObject(t, n) {
    let r = { i: n, $: {} };
    this.keys.forEach((i, s) => {
      let a = i.getFn ? i.getFn(t) : this.getFn(t, i.path);
      if (H(a)) {
        if (re(a)) {
          let o = [];
          const u = [{ nestedArrIndex: -1, value: a }];
          for (; u.length; ) {
            const { nestedArrIndex: c, value: l } = u.pop();
            if (H(l))
              if (K(l) && !Et(l)) {
                let f = {
                  v: l,
                  i: c,
                  n: this.norm.get(l)
                };
                o.push(f);
              } else re(l) && l.forEach((f, d) => {
                u.push({
                  nestedArrIndex: d,
                  value: f
                });
              });
          }
          r.$[s] = o;
        } else if (K(a) && !Et(a)) {
          let o = {
            v: a,
            n: this.norm.get(a)
          };
          r.$[s] = o;
        }
      }
    }), this.records.push(r);
  }
  toJSON() {
    return {
      keys: this.keys,
      records: this.records
    };
  }
}
function zn(e, t, { getFn: n = m.getFn, fieldNormWeight: r = m.fieldNormWeight } = {}) {
  const i = new Ut({ getFn: n, fieldNormWeight: r });
  return i.setKeys(e.map(Vn)), i.setSources(t), i.create(), i;
}
function Jr(e, { getFn: t = m.getFn, fieldNormWeight: n = m.fieldNormWeight } = {}) {
  const { keys: r, records: i } = e, s = new Ut({ getFn: t, fieldNormWeight: n });
  return s.setKeys(r), s.setIndexRecords(i), s;
}
function Ve(e, {
  errors: t = 0,
  currentLocation: n = 0,
  expectedLocation: r = 0,
  distance: i = m.distance,
  ignoreLocation: s = m.ignoreLocation
} = {}) {
  const a = t / e.length;
  if (s)
    return a;
  const o = Math.abs(r - n);
  return i ? a + o / i : o ? 1 : a;
}
function Zr(e = [], t = m.minMatchCharLength) {
  let n = [], r = -1, i = -1, s = 0;
  for (let a = e.length; s < a; s += 1) {
    let o = e[s];
    o && r === -1 ? r = s : !o && r !== -1 && (i = s - 1, i - r + 1 >= t && n.push([r, i]), r = -1);
  }
  return e[s - 1] && s - r >= t && n.push([r, s - 1]), n;
}
const xe = 32;
function ei(e, t, n, {
  location: r = m.location,
  distance: i = m.distance,
  threshold: s = m.threshold,
  findAllMatches: a = m.findAllMatches,
  minMatchCharLength: o = m.minMatchCharLength,
  includeMatches: u = m.includeMatches,
  ignoreLocation: c = m.ignoreLocation
} = {}) {
  if (t.length > xe)
    throw new Error(jr(xe));
  const l = t.length, f = e.length, d = Math.max(0, Math.min(r, f));
  let h = s, g = d;
  const p = o > 1 || u, x = p ? Array(f) : [];
  let y;
  for (; (y = e.indexOf(t, g)) > -1; ) {
    let M = Ve(t, {
      currentLocation: y,
      expectedLocation: d,
      distance: i,
      ignoreLocation: c
    });
    if (h = Math.min(M, h), g = y + l, p) {
      let S = 0;
      for (; S < l; )
        x[y + S] = 1, S += 1;
    }
  }
  g = -1;
  let v = [], C = 1, w = l + f;
  const F = 1 << l - 1;
  for (let M = 0; M < l; M += 1) {
    let S = 0, D = w;
    for (; S < D; )
      Ve(t, {
        errors: M,
        currentLocation: d + D,
        expectedLocation: d,
        distance: i,
        ignoreLocation: c
      }) <= h ? S = D : w = D, D = Math.floor((w - S) / 2 + S);
    w = D;
    let U = Math.max(1, d - D + 1), se = a ? f : Math.min(d + D, f) + l, z = Array(se + 2);
    z[se + 1] = (1 << M) - 1;
    for (let B = se; B >= U; B -= 1) {
      let ae = B - 1, Ae = n[e.charAt(ae)];
      if (p && (x[ae] = +!!Ae), z[B] = (z[B + 1] << 1 | 1) & Ae, M && (z[B] |= (v[B + 1] | v[B]) << 1 | 1 | v[B + 1]), z[B] & F && (C = Ve(t, {
        errors: M,
        currentLocation: ae,
        expectedLocation: d,
        distance: i,
        ignoreLocation: c
      }), C <= h)) {
        if (h = C, g = ae, g <= d)
          break;
        U = Math.max(1, 2 * d - g);
      }
    }
    if (Ve(t, {
      errors: M + 1,
      currentLocation: d,
      expectedLocation: d,
      distance: i,
      ignoreLocation: c
    }) > h)
      break;
    v = z;
  }
  const I = {
    isMatch: g >= 0,
    // Count exact matches (those with a score of 0) to be "almost" exact
    score: Math.max(1e-3, C)
  };
  if (p) {
    const M = Zr(x, o);
    M.length ? u && (I.indices = M) : I.isMatch = !1;
  }
  return I;
}
function ti(e) {
  let t = {};
  for (let n = 0, r = e.length; n < r; n += 1) {
    const i = e.charAt(n);
    t[i] = (t[i] || 0) | 1 << r - n - 1;
  }
  return t;
}
const Ke = String.prototype.normalize ? (e) => e.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "") : (e) => e;
class Qn {
  constructor(t, {
    location: n = m.location,
    threshold: r = m.threshold,
    distance: i = m.distance,
    includeMatches: s = m.includeMatches,
    findAllMatches: a = m.findAllMatches,
    minMatchCharLength: o = m.minMatchCharLength,
    isCaseSensitive: u = m.isCaseSensitive,
    ignoreDiacritics: c = m.ignoreDiacritics,
    ignoreLocation: l = m.ignoreLocation
  } = {}) {
    if (this.options = {
      location: n,
      threshold: r,
      distance: i,
      includeMatches: s,
      findAllMatches: a,
      minMatchCharLength: o,
      isCaseSensitive: u,
      ignoreDiacritics: c,
      ignoreLocation: l
    }, t = u ? t : t.toLowerCase(), t = c ? Ke(t) : t, this.pattern = t, this.chunks = [], !this.pattern.length)
      return;
    const f = (h, g) => {
      this.chunks.push({
        pattern: h,
        alphabet: ti(h),
        startIndex: g
      });
    }, d = this.pattern.length;
    if (d > xe) {
      let h = 0;
      const g = d % xe, p = d - g;
      for (; h < p; )
        f(this.pattern.substr(h, xe), h), h += xe;
      if (g) {
        const x = d - xe;
        f(this.pattern.substr(x), x);
      }
    } else
      f(this.pattern, 0);
  }
  searchIn(t) {
    const { isCaseSensitive: n, ignoreDiacritics: r, includeMatches: i } = this.options;
    if (t = n ? t : t.toLowerCase(), t = r ? Ke(t) : t, this.pattern === t) {
      let p = {
        isMatch: !0,
        score: 0
      };
      return i && (p.indices = [[0, t.length - 1]]), p;
    }
    const {
      location: s,
      distance: a,
      threshold: o,
      findAllMatches: u,
      minMatchCharLength: c,
      ignoreLocation: l
    } = this.options;
    let f = [], d = 0, h = !1;
    this.chunks.forEach(({ pattern: p, alphabet: x, startIndex: y }) => {
      const { isMatch: v, score: C, indices: w } = ei(t, p, x, {
        location: s + y,
        distance: a,
        threshold: o,
        findAllMatches: u,
        minMatchCharLength: c,
        includeMatches: i,
        ignoreLocation: l
      });
      v && (h = !0), d += C, v && w && (f = [...f, ...w]);
    });
    let g = {
      isMatch: h,
      score: h ? d / this.chunks.length : 1
    };
    return h && i && (g.indices = f), g;
  }
}
class ve {
  constructor(t) {
    this.pattern = t;
  }
  static isMultiMatch(t) {
    return cn(t, this.multiRegex);
  }
  static isSingleMatch(t) {
    return cn(t, this.singleRegex);
  }
  search() {
  }
}
function cn(e, t) {
  const n = e.match(t);
  return n ? n[1] : null;
}
class ni extends ve {
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
    const n = t === this.pattern;
    return {
      isMatch: n,
      score: n ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    };
  }
}
class ri extends ve {
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
    const r = t.indexOf(this.pattern) === -1;
    return {
      isMatch: r,
      score: r ? 0 : 1,
      indices: [0, t.length - 1]
    };
  }
}
class ii extends ve {
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
    const n = t.startsWith(this.pattern);
    return {
      isMatch: n,
      score: n ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    };
  }
}
class si extends ve {
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
    const n = !t.startsWith(this.pattern);
    return {
      isMatch: n,
      score: n ? 0 : 1,
      indices: [0, t.length - 1]
    };
  }
}
class ai extends ve {
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
    const n = t.endsWith(this.pattern);
    return {
      isMatch: n,
      score: n ? 0 : 1,
      indices: [t.length - this.pattern.length, t.length - 1]
    };
  }
}
class oi extends ve {
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
    const n = !t.endsWith(this.pattern);
    return {
      isMatch: n,
      score: n ? 0 : 1,
      indices: [0, t.length - 1]
    };
  }
}
class Gn extends ve {
  constructor(t, {
    location: n = m.location,
    threshold: r = m.threshold,
    distance: i = m.distance,
    includeMatches: s = m.includeMatches,
    findAllMatches: a = m.findAllMatches,
    minMatchCharLength: o = m.minMatchCharLength,
    isCaseSensitive: u = m.isCaseSensitive,
    ignoreDiacritics: c = m.ignoreDiacritics,
    ignoreLocation: l = m.ignoreLocation
  } = {}) {
    super(t), this._bitapSearch = new Qn(t, {
      location: n,
      threshold: r,
      distance: i,
      includeMatches: s,
      findAllMatches: a,
      minMatchCharLength: o,
      isCaseSensitive: u,
      ignoreDiacritics: c,
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
  search(t) {
    return this._bitapSearch.searchIn(t);
  }
}
class Un extends ve {
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
    let n = 0, r;
    const i = [], s = this.pattern.length;
    for (; (r = t.indexOf(this.pattern, n)) > -1; )
      n = r + s, i.push([r, n - 1]);
    const a = !!i.length;
    return {
      isMatch: a,
      score: a ? 0 : 1,
      indices: i
    };
  }
}
const Pt = [
  ni,
  Un,
  ii,
  si,
  oi,
  ai,
  ri,
  Gn
], ln = Pt.length, ui = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/, ci = "|";
function li(e, t = {}) {
  return e.split(ci).map((n) => {
    let r = n.trim().split(ui).filter((s) => s && !!s.trim()), i = [];
    for (let s = 0, a = r.length; s < a; s += 1) {
      const o = r[s];
      let u = !1, c = -1;
      for (; !u && ++c < ln; ) {
        const l = Pt[c];
        let f = l.isMultiMatch(o);
        f && (i.push(new l(f, t)), u = !0);
      }
      if (!u)
        for (c = -1; ++c < ln; ) {
          const l = Pt[c];
          let f = l.isSingleMatch(o);
          if (f) {
            i.push(new l(f, t));
            break;
          }
        }
    }
    return i;
  });
}
const fi = /* @__PURE__ */ new Set([Gn.type, Un.type]);
class di {
  constructor(t, {
    isCaseSensitive: n = m.isCaseSensitive,
    ignoreDiacritics: r = m.ignoreDiacritics,
    includeMatches: i = m.includeMatches,
    minMatchCharLength: s = m.minMatchCharLength,
    ignoreLocation: a = m.ignoreLocation,
    findAllMatches: o = m.findAllMatches,
    location: u = m.location,
    threshold: c = m.threshold,
    distance: l = m.distance
  } = {}) {
    this.query = null, this.options = {
      isCaseSensitive: n,
      ignoreDiacritics: r,
      includeMatches: i,
      minMatchCharLength: s,
      findAllMatches: o,
      ignoreLocation: a,
      location: u,
      threshold: c,
      distance: l
    }, t = n ? t : t.toLowerCase(), t = r ? Ke(t) : t, this.pattern = t, this.query = li(this.pattern, this.options);
  }
  static condition(t, n) {
    return n.useExtendedSearch;
  }
  searchIn(t) {
    const n = this.query;
    if (!n)
      return {
        isMatch: !1,
        score: 1
      };
    const { includeMatches: r, isCaseSensitive: i, ignoreDiacritics: s } = this.options;
    t = i ? t : t.toLowerCase(), t = s ? Ke(t) : t;
    let a = 0, o = [], u = 0;
    for (let c = 0, l = n.length; c < l; c += 1) {
      const f = n[c];
      o.length = 0, a = 0;
      for (let d = 0, h = f.length; d < h; d += 1) {
        const g = f[d], { isMatch: p, indices: x, score: y } = g.search(t);
        if (p) {
          if (a += 1, u += y, r) {
            const v = g.constructor.type;
            fi.has(v) ? o = [...o, ...x] : o.push(x);
          }
        } else {
          u = 0, a = 0, o.length = 0;
          break;
        }
      }
      if (a) {
        let d = {
          isMatch: !0,
          score: u / a
        };
        return r && (d.indices = o), d;
      }
    }
    return {
      isMatch: !1,
      score: 1
    };
  }
}
const Tt = [];
function hi(...e) {
  Tt.push(...e);
}
function Bt(e, t) {
  for (let n = 0, r = Tt.length; n < r; n += 1) {
    let i = Tt[n];
    if (i.condition(e, t))
      return new i(e, t);
  }
  return new Qn(e, t);
}
const Je = {
  AND: "$and",
  OR: "$or"
}, Rt = {
  PATH: "$path",
  PATTERN: "$val"
}, $t = (e) => !!(e[Je.AND] || e[Je.OR]), gi = (e) => !!e[Rt.PATH], vi = (e) => !re(e) && Yn(e) && !$t(e), fn = (e) => ({
  [Je.AND]: Object.keys(e).map((t) => ({
    [t]: e[t]
  }))
});
function Xn(e, t, { auto: n = !0 } = {}) {
  const r = (i) => {
    let s = Object.keys(i);
    const a = gi(i);
    if (!a && s.length > 1 && !$t(i))
      return r(fn(i));
    if (vi(i)) {
      const u = a ? i[Rt.PATH] : s[0], c = a ? i[Rt.PATTERN] : i[u];
      if (!K(c))
        throw new Error(Wr(u));
      const l = {
        keyId: kt(u),
        pattern: c
      };
      return n && (l.searcher = Bt(c, t)), l;
    }
    let o = {
      children: [],
      operator: s[0]
    };
    return s.forEach((u) => {
      const c = i[u];
      re(c) && c.forEach((l) => {
        o.children.push(r(l));
      });
    }), o;
  };
  return $t(e) || (e = fn(e)), r(e);
}
function mi(e, { ignoreFieldNorm: t = m.ignoreFieldNorm }) {
  e.forEach((n) => {
    let r = 1;
    n.matches.forEach(({ key: i, norm: s, score: a }) => {
      const o = i ? i.weight : null;
      r *= Math.pow(
        a === 0 && o ? Number.EPSILON : a,
        (o || 1) * (t ? 1 : s)
      );
    }), n.score = r;
  });
}
function pi(e, t) {
  const n = e.matches;
  t.matches = [], H(n) && n.forEach((r) => {
    if (!H(r.indices) || !r.indices.length)
      return;
    const { indices: i, value: s } = r;
    let a = {
      indices: i,
      value: s
    };
    r.key && (a.key = r.key.src), r.idx > -1 && (a.refIndex = r.idx), t.matches.push(a);
  });
}
function yi(e, t) {
  t.score = e.score;
}
function wi(e, t, {
  includeMatches: n = m.includeMatches,
  includeScore: r = m.includeScore
} = {}) {
  const i = [];
  return n && i.push(pi), r && i.push(yi), e.map((s) => {
    const { idx: a } = s, o = {
      item: t[a],
      refIndex: a
    };
    return i.length && i.forEach((u) => {
      u(s, o);
    }), o;
  });
}
class J {
  constructor(t, n = {}, r) {
    this.options = { ...m, ...n }, this.options.useExtendedSearch, this._keyStore = new qr(this.options.keys), this.setCollection(t, r);
  }
  setCollection(t, n) {
    if (this._docs = t, n && !(n instanceof Ut))
      throw new Error(Lr);
    this._myIndex = n || zn(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
  }
  add(t) {
    H(t) && (this._docs.push(t), this._myIndex.add(t));
  }
  remove(t = () => !1) {
    const n = [];
    for (let r = 0, i = this._docs.length; r < i; r += 1) {
      const s = this._docs[r];
      t(s, r) && (this.removeAt(r), r -= 1, i -= 1, n.push(s));
    }
    return n;
  }
  removeAt(t) {
    this._docs.splice(t, 1), this._myIndex.removeAt(t);
  }
  getIndex() {
    return this._myIndex;
  }
  search(t, { limit: n = -1 } = {}) {
    const {
      includeMatches: r,
      includeScore: i,
      shouldSort: s,
      sortFn: a,
      ignoreFieldNorm: o
    } = this.options;
    let u = K(t) ? K(this._docs[0]) ? this._searchStringList(t) : this._searchObjectList(t) : this._searchLogical(t);
    return mi(u, { ignoreFieldNorm: o }), s && u.sort(a), Hn(n) && n > -1 && (u = u.slice(0, n)), wi(u, this._docs, {
      includeMatches: r,
      includeScore: i
    });
  }
  _searchStringList(t) {
    const n = Bt(t, this.options), { records: r } = this._myIndex, i = [];
    return r.forEach(({ v: s, i: a, n: o }) => {
      if (!H(s))
        return;
      const { isMatch: u, score: c, indices: l } = n.searchIn(s);
      u && i.push({
        item: s,
        idx: a,
        matches: [{ score: c, value: s, norm: o, indices: l }]
      });
    }), i;
  }
  _searchLogical(t) {
    const n = Xn(t, this.options), r = (o, u, c) => {
      if (!o.children) {
        const { keyId: f, searcher: d } = o, h = this._findMatches({
          key: this._keyStore.get(f),
          value: this._myIndex.getValueForItemAtKeyId(u, f),
          searcher: d
        });
        return h && h.length ? [
          {
            idx: c,
            item: u,
            matches: h
          }
        ] : [];
      }
      const l = [];
      for (let f = 0, d = o.children.length; f < d; f += 1) {
        const h = o.children[f], g = r(h, u, c);
        if (g.length)
          l.push(...g);
        else if (o.operator === Je.AND)
          return [];
      }
      return l;
    }, i = this._myIndex.records, s = {}, a = [];
    return i.forEach(({ $: o, i: u }) => {
      if (H(o)) {
        let c = r(n, o, u);
        c.length && (s[u] || (s[u] = { idx: u, item: o, matches: [] }, a.push(s[u])), c.forEach(({ matches: l }) => {
          s[u].matches.push(...l);
        }));
      }
    }), a;
  }
  _searchObjectList(t) {
    const n = Bt(t, this.options), { keys: r, records: i } = this._myIndex, s = [];
    return i.forEach(({ $: a, i: o }) => {
      if (!H(a))
        return;
      let u = [];
      r.forEach((c, l) => {
        u.push(
          ...this._findMatches({
            key: c,
            value: a[l],
            searcher: n
          })
        );
      }), u.length && s.push({
        idx: o,
        item: a,
        matches: u
      });
    }), s;
  }
  _findMatches({ key: t, value: n, searcher: r }) {
    if (!H(n))
      return [];
    let i = [];
    if (re(n))
      n.forEach(({ v: s, i: a, n: o }) => {
        if (!H(s))
          return;
        const { isMatch: u, score: c, indices: l } = r.searchIn(s);
        u && i.push({
          score: c,
          key: t,
          value: s,
          idx: a,
          norm: o,
          indices: l
        });
      });
    else {
      const { v: s, n: a } = n, { isMatch: o, score: u, indices: c } = r.searchIn(s);
      o && i.push({ score: u, key: t, value: s, norm: a, indices: c });
    }
    return i;
  }
}
J.version = "7.1.0";
J.createIndex = zn;
J.parseIndex = Jr;
J.config = m;
J.parseQuery = Xn;
hi(di);
const ze = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["content"]
};
function bi() {
  const { subscribe: e, set: t, update: n } = Ir({
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
  let r, i;
  function s(a) {
    r = a.getService(
      "ClipboardHistoryService"
    ), i = a.getService("LogService");
  }
  return {
    subscribe: e,
    setSearch: (a) => n((o) => ({
      ...o,
      searchQuery: a,
      filtered: a.length > 0,
      lastSearch: Date.now()
    })),
    reset: () => t({
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
    initFuse: (a) => n((o) => ({
      ...o,
      fuseInstance: new J(a, ze)
    })),
    search: (a, o) => {
      let u = a;
      if (o && o.trim() !== "") {
        let c = {
          fuseInstance: null
        };
        e((h) => {
          c = h;
        })();
        let f;
        c.fuseInstance ? (f = c.fuseInstance, f.setCollection(a)) : f = new J(a, ze), u = f.search(o).map((h) => ({
          ...h.item,
          score: h.score
        })), n((h) => ({
          ...h,
          fuseInstance: f
        }));
      }
      return u;
    },
    setItems: (a) => {
      console.log("Setting items in state:", a.length), n((o) => ({
        ...o,
        items: a,
        fuseInstance: new J(a, ze)
      }));
    },
    setSelectedItem(a) {
      n((o) => {
        const u = o.items;
        return u.length > 0 && a >= 0 && a < u.length ? {
          ...o,
          selectedItem: u[a],
          selectedIndex: a
        } : o;
      });
    },
    moveSelection(a) {
      n((o) => {
        const u = o.items;
        if (!u.length) return o;
        let c = o.selectedIndex;
        return a === "up" ? c = c <= 0 ? u.length - 1 : c - 1 : c = c >= u.length - 1 ? 0 : c + 1, requestAnimationFrame(() => {
          const l = document.querySelector(`[data-index="${c}"]`);
          l == null || l.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }), {
          ...o,
          selectedIndex: c,
          selectedItem: u[c]
        };
      });
    },
    setLoading(a) {
      n((o) => ({ ...o, isLoading: a }));
    },
    setError(a) {
      n((o) => ({
        ...o,
        loadError: !!a,
        errorMessage: a || ""
      }));
    },
    initializeServices: s,
    // Expose clipboardService methods through the state store
    async clearNonFavorites() {
      if (!r)
        return i == null || i.error("Clipboard service not initialized in clearNonFavorites"), !1;
      try {
        return await r.clearNonFavorites();
      } catch (a) {
        return i == null || i.error(`Error clearing non-favorites: ${a}`), !1;
      }
    },
    async toggleFavorite(a) {
      if (!r)
        return i == null || i.error("Clipboard service not initialized in toggleFavorite"), !1;
      try {
        return await r.toggleItemFavorite(a);
      } catch (o) {
        return i == null || i.error(`Error toggling favorite for ${a}: ${o}`), !1;
      }
    },
    // --- End exposed methods ---
    async handleItemAction(a, o) {
      if (!(!(a != null && a.id) || !r))
        try {
          switch (o) {
            case "paste":
              await r.pasteItem(a), r == null || r.hideWindow();
              break;
            case "select":
              const c = kr({ subscribe: e }).items.findIndex((l) => l.id === a.id);
              c >= 0 && this.setSelectedItem(c);
              break;
          }
        } catch (u) {
          i == null || i.error(`Failed to handle item action: ${u}`);
        }
    },
    // Renamed from hideWindow for clarity, calls service method
    async hidePanel() {
      if (!r) {
        i == null || i.error("Clipboard service not initialized in hidePanel");
        return;
      }
      try {
        await r.hideWindow();
      } catch (a) {
        i == null || i.error(`Error hiding window: ${a}`);
      }
    },
    // Refresh history items (no change needed here, already uses service)
    async refreshHistory() {
      n((a) => ({ ...a, isLoading: !0 }));
      try {
        if (r) {
          const a = await r.getRecentItems(100);
          n((o) => ({
            // Use update instead of this.setItems
            ...o,
            items: a,
            fuseInstance: new J(a, ze)
            // Update fuse instance too
          }));
        } else
          i == null || i.warn("Clipboard service not available in refreshHistory");
      } catch (a) {
        i == null || i.error(`Failed to refresh clipboard history: ${a}`), n((o) => ({
          // Use update instead of this.setError
          ...o,
          loadError: !0,
          errorMessage: `Failed to refresh clipboard history: ${a}`
        }));
      } finally {
        this.setLoading(!1);
      }
    }
  };
}
const j = bi(), _i = "5";
var jn;
typeof window < "u" && ((jn = window.__svelte ?? (window.__svelte = {})).v ?? (jn.v = /* @__PURE__ */ new Set())).add(_i);
let ut = !1, xi = !1;
function Ei() {
  ut = !0;
}
Ei();
const Ai = 1, Ci = 2, Mi = 16, Si = 1, Di = 2, L = Symbol(), Oi = "http://www.w3.org/1999/xhtml", dn = !1;
var Xt = Array.isArray, Fi = Array.prototype.indexOf, Kn = Array.from, Jn = Object.defineProperty, At = Object.getOwnPropertyDescriptor, Zn = Object.getOwnPropertyDescriptors, Ii = Object.prototype, ki = Array.prototype, Kt = Object.getPrototypeOf;
const Nt = () => {
};
function Pi(e) {
  return e();
}
function Lt(e) {
  for (var t = 0; t < e.length; t++)
    e[t]();
}
const Q = 2, er = 4, ct = 8, Jt = 16, ie = 32, je = 64, Ze = 128, Y = 256, et = 512, N = 1024, Z = 2048, me = 4096, ne = 8192, lt = 16384, Ti = 32768, Zt = 65536, Bi = 1 << 19, tr = 1 << 20, Wt = 1 << 21, De = Symbol("$state");
function Ri(e) {
  throw new Error("https://svelte.dev/e/effect_in_teardown");
}
function $i() {
  throw new Error("https://svelte.dev/e/effect_in_unowned_derived");
}
function Ni(e) {
  throw new Error("https://svelte.dev/e/effect_orphan");
}
function Li() {
  throw new Error("https://svelte.dev/e/effect_update_depth_exceeded");
}
function Wi() {
  throw new Error("https://svelte.dev/e/state_descriptors_fixed");
}
function ji() {
  throw new Error("https://svelte.dev/e/state_prototype_fixed");
}
function Hi() {
  throw new Error("https://svelte.dev/e/state_unsafe_mutation");
}
let Yi = !1;
function Se(e) {
  if (typeof e != "object" || e === null || De in e)
    return e;
  const t = Kt(e);
  if (t !== Ii && t !== ki)
    return e;
  var n = /* @__PURE__ */ new Map(), r = Xt(e), i = /* @__PURE__ */ ue(0), s = A, a = (o) => {
    var u = A;
    ee(s);
    var c = o();
    return ee(u), c;
  };
  return r && n.set("length", /* @__PURE__ */ ue(
    /** @type {any[]} */
    e.length
  )), new Proxy(
    /** @type {any} */
    e,
    {
      defineProperty(o, u, c) {
        (!("value" in c) || c.configurable === !1 || c.enumerable === !1 || c.writable === !1) && Wi();
        var l = n.get(u);
        return l === void 0 ? (l = a(() => /* @__PURE__ */ ue(c.value)), n.set(u, l)) : P(
          l,
          a(() => Se(c.value))
        ), !0;
      },
      deleteProperty(o, u) {
        var c = n.get(u);
        if (c === void 0)
          u in o && (n.set(
            u,
            a(() => /* @__PURE__ */ ue(L))
          ), Ct(i));
        else {
          if (r && typeof u == "string") {
            var l = (
              /** @type {Source<number>} */
              n.get("length")
            ), f = Number(u);
            Number.isInteger(f) && f < l.v && P(l, f);
          }
          P(c, L), Ct(i);
        }
        return !0;
      },
      get(o, u, c) {
        var h;
        if (u === De)
          return e;
        var l = n.get(u), f = u in o;
        if (l === void 0 && (!f || (h = At(o, u)) != null && h.writable) && (l = a(() => /* @__PURE__ */ ue(Se(f ? o[u] : L))), n.set(u, l)), l !== void 0) {
          var d = b(l);
          return d === L ? void 0 : d;
        }
        return Reflect.get(o, u, c);
      },
      getOwnPropertyDescriptor(o, u) {
        var c = Reflect.getOwnPropertyDescriptor(o, u);
        if (c && "value" in c) {
          var l = n.get(u);
          l && (c.value = b(l));
        } else if (c === void 0) {
          var f = n.get(u), d = f == null ? void 0 : f.v;
          if (f !== void 0 && d !== L)
            return {
              enumerable: !0,
              configurable: !0,
              value: d,
              writable: !0
            };
        }
        return c;
      },
      has(o, u) {
        var d;
        if (u === De)
          return !0;
        var c = n.get(u), l = c !== void 0 && c.v !== L || Reflect.has(o, u);
        if (c !== void 0 || E !== null && (!l || (d = At(o, u)) != null && d.writable)) {
          c === void 0 && (c = a(() => /* @__PURE__ */ ue(l ? Se(o[u]) : L)), n.set(u, c));
          var f = b(c);
          if (f === L)
            return !1;
        }
        return l;
      },
      set(o, u, c, l) {
        var v;
        var f = n.get(u), d = u in o;
        if (r && u === "length")
          for (var h = c; h < /** @type {Source<number>} */
          f.v; h += 1) {
            var g = n.get(h + "");
            g !== void 0 ? P(g, L) : h in o && (g = a(() => /* @__PURE__ */ ue(L)), n.set(h + "", g));
          }
        f === void 0 ? (!d || (v = At(o, u)) != null && v.writable) && (f = a(() => /* @__PURE__ */ ue(void 0)), P(
          f,
          a(() => Se(c))
        ), n.set(u, f)) : (d = f.v !== L, P(
          f,
          a(() => Se(c))
        ));
        var p = Reflect.getOwnPropertyDescriptor(o, u);
        if (p != null && p.set && p.set.call(l, c), !d) {
          if (r && typeof u == "string") {
            var x = (
              /** @type {Source<number>} */
              n.get("length")
            ), y = Number(u);
            Number.isInteger(y) && y >= x.v && P(x, y + 1);
          }
          Ct(i);
        }
        return !0;
      },
      ownKeys(o) {
        b(i);
        var u = Reflect.ownKeys(o).filter((f) => {
          var d = n.get(f);
          return d === void 0 || d.v !== L;
        });
        for (var [c, l] of n)
          l.v !== L && !(c in o) && u.push(c);
        return u;
      },
      setPrototypeOf() {
        ji();
      }
    }
  );
}
function Ct(e, t = 1) {
  P(e, e.v + t);
}
var qi, Vi, zi;
function Qi(e = "") {
  return document.createTextNode(e);
}
// @__NO_SIDE_EFFECTS__
function fe(e) {
  return Vi.call(e);
}
// @__NO_SIDE_EFFECTS__
function ft(e) {
  return zi.call(e);
}
function T(e, t) {
  return /* @__PURE__ */ fe(e);
}
function Gi(e, t) {
  {
    var n = (
      /** @type {DocumentFragment} */
      /* @__PURE__ */ fe(
        /** @type {Node} */
        e
      )
    );
    return n instanceof Comment && n.data === "" ? /* @__PURE__ */ ft(n) : n;
  }
}
function Qe(e, t = 1, n = !1) {
  let r = e;
  for (; t--; )
    r = /** @type {TemplateNode} */
    /* @__PURE__ */ ft(r);
  return r;
}
function Ui(e) {
  e.textContent = "";
}
function nr(e) {
  return e === this.v;
}
function Xi(e, t) {
  return e != e ? t == t : e !== t || e !== null && typeof e == "object" || typeof e == "function";
}
function rr(e) {
  return !Xi(e, this.v);
}
// @__NO_SIDE_EFFECTS__
function en(e) {
  var t = Q | Z, n = A !== null && (A.f & Q) !== 0 ? (
    /** @type {Derived} */
    A
  ) : null;
  return E === null || n !== null && (n.f & Y) !== 0 ? t |= Y : E.f |= tr, {
    ctx: O,
    deps: null,
    effects: null,
    equals: nr,
    f: t,
    fn: e,
    reactions: null,
    rv: 0,
    v: (
      /** @type {V} */
      null
    ),
    wv: 0,
    parent: n ?? E
  };
}
// @__NO_SIDE_EFFECTS__
function jt(e) {
  const t = /* @__PURE__ */ en(e);
  return t.equals = rr, t;
}
function ir(e) {
  var t = e.effects;
  if (t !== null) {
    e.effects = null;
    for (var n = 0; n < t.length; n += 1)
      Oe(
        /** @type {Effect} */
        t[n]
      );
  }
}
function Ki(e) {
  for (var t = e.parent; t !== null; ) {
    if ((t.f & Q) === 0)
      return (
        /** @type {Effect} */
        t
      );
    t = t.parent;
  }
  return null;
}
function sr(e) {
  var t, n = E;
  he(Ki(e));
  try {
    ir(e), t = yr(e);
  } finally {
    he(n);
  }
  return t;
}
function ar(e) {
  var t = sr(e), n = (de || (e.f & Y) !== 0) && e.deps !== null ? me : N;
  V(e, n), e.equals(t) || (e.v = t, e.wv = mr());
}
function or(e) {
  E === null && A === null && Ni(), A !== null && (A.f & Y) !== 0 && E === null && $i(), Ye && Ri();
}
function Ji(e, t) {
  var n = t.last;
  n === null ? t.last = t.first = e : (n.next = e, e.prev = n, t.last = e);
}
function He(e, t, n, r = !0) {
  var i = E, s = {
    ctx: O,
    deps: null,
    nodes_start: null,
    nodes_end: null,
    f: e | Z,
    first: null,
    fn: t,
    last: null,
    next: null,
    parent: i,
    prev: null,
    teardown: null,
    transitions: null,
    wv: 0
  };
  if (n)
    try {
      gt(s), s.f |= Ti;
    } catch (u) {
      throw Oe(s), u;
    }
  else t !== null && vt(s);
  var a = n && s.deps === null && s.first === null && s.nodes_start === null && s.teardown === null && (s.f & (tr | Ze)) === 0;
  if (!a && r && (i !== null && Ji(s, i), A !== null && (A.f & Q) !== 0)) {
    var o = (
      /** @type {Derived} */
      A
    );
    (o.effects ?? (o.effects = [])).push(s);
  }
  return s;
}
function tn(e) {
  const t = He(ct, null, !1);
  return V(t, N), t.teardown = e, t;
}
function hn(e) {
  or();
  var t = E !== null && (E.f & ie) !== 0 && O !== null && !O.m;
  if (t) {
    var n = (
      /** @type {ComponentContext} */
      O
    );
    (n.e ?? (n.e = [])).push({
      fn: e,
      effect: E,
      reaction: A
    });
  } else {
    var r = nn(e);
    return r;
  }
}
function Zi(e) {
  return or(), dt(e);
}
function nn(e) {
  return He(er, e, !1);
}
function Ce(e, t) {
  var n = (
    /** @type {ComponentContextLegacy} */
    O
  ), r = { effect: null, ran: !1 };
  n.l.r1.push(r), r.effect = dt(() => {
    e(), !r.ran && (r.ran = !0, P(n.l.r2, !0), mt(t));
  });
}
function es() {
  var e = (
    /** @type {ComponentContextLegacy} */
    O
  );
  dt(() => {
    if (b(e.l.r2)) {
      for (var t of e.l.r1) {
        var n = t.effect;
        (n.f & N) !== 0 && V(n, me), Fe(n) && gt(n), t.ran = !1;
      }
      e.l.r2.v = !1;
    }
  });
}
function dt(e) {
  return He(ct, e, !0);
}
function Ht(e, t = [], n = en) {
  const r = t.map(n);
  return rn(() => e(...r.map(b)));
}
function rn(e, t = 0) {
  return He(ct | Jt | t, e, !0);
}
function tt(e, t = !0) {
  return He(ct | ie, e, !0, t);
}
function ur(e) {
  var t = e.teardown;
  if (t !== null) {
    const n = Ye, r = A;
    gn(!0), ee(null);
    try {
      t.call(null);
    } finally {
      gn(n), ee(r);
    }
  }
}
function cr(e, t = !1) {
  var n = e.first;
  for (e.first = e.last = null; n !== null; ) {
    var r = n.next;
    (n.f & je) !== 0 ? n.parent = null : Oe(n, t), n = r;
  }
}
function ts(e) {
  for (var t = e.first; t !== null; ) {
    var n = t.next;
    (t.f & ie) === 0 && Oe(t), t = n;
  }
}
function Oe(e, t = !0) {
  var n = !1;
  (t || (e.f & Bi) !== 0) && e.nodes_start !== null && (lr(
    e.nodes_start,
    /** @type {TemplateNode} */
    e.nodes_end
  ), n = !0), cr(e, t && !n), at(e, 0), V(e, lt);
  var r = e.transitions;
  if (r !== null)
    for (const s of r)
      s.stop();
  ur(e);
  var i = e.parent;
  i !== null && i.first !== null && fr(e), e.next = e.prev = e.teardown = e.ctx = e.deps = e.fn = e.nodes_start = e.nodes_end = null;
}
function lr(e, t) {
  for (; e !== null; ) {
    var n = e === t ? null : (
      /** @type {TemplateNode} */
      /* @__PURE__ */ ft(e)
    );
    e.remove(), e = n;
  }
}
function fr(e) {
  var t = e.parent, n = e.prev, r = e.next;
  n !== null && (n.next = r), r !== null && (r.prev = n), t !== null && (t.first === e && (t.first = r), t.last === e && (t.last = n));
}
function Yt(e, t) {
  var n = [];
  sn(e, n, !0), dr(n, () => {
    Oe(e), t && t();
  });
}
function dr(e, t) {
  var n = e.length;
  if (n > 0) {
    var r = () => --n || t();
    for (var i of e)
      i.out(r);
  } else
    t();
}
function sn(e, t, n) {
  if ((e.f & ne) === 0) {
    if (e.f ^= ne, e.transitions !== null)
      for (const a of e.transitions)
        (a.is_global || n) && t.push(a);
    for (var r = e.first; r !== null; ) {
      var i = r.next, s = (r.f & Zt) !== 0 || (r.f & ie) !== 0;
      sn(r, t, s ? n : !1), r = i;
    }
  }
}
function nt(e) {
  hr(e, !0);
}
function hr(e, t) {
  if ((e.f & ne) !== 0) {
    e.f ^= ne, (e.f & N) === 0 && (e.f ^= N), Fe(e) && (V(e, Z), vt(e));
    for (var n = e.first; n !== null; ) {
      var r = n.next, i = (n.f & Zt) !== 0 || (n.f & ie) !== 0;
      hr(n, i ? t : !1), n = r;
    }
    if (e.transitions !== null)
      for (const s of e.transitions)
        (s.is_global || t) && s.in();
  }
}
let rt = [];
function ns() {
  var e = rt;
  rt = [], Lt(e);
}
function gr(e) {
  rt.length === 0 && queueMicrotask(ns), rt.push(e);
}
let Ue = !1, qt = !1, it = null, Ee = !1, Ye = !1;
function gn(e) {
  Ye = e;
}
let Xe = [];
let A = null, X = !1;
function ee(e) {
  A = e;
}
let E = null;
function he(e) {
  E = e;
}
let $ = null;
function rs(e) {
  A !== null && A.f & Wt && ($ === null ? $ = [e] : $.push(e));
}
let R = null, W = 0, q = null;
function is(e) {
  q = e;
}
let vr = 1, st = 0, de = !1;
function mr() {
  return ++vr;
}
function Fe(e) {
  var f;
  var t = e.f;
  if ((t & Z) !== 0)
    return !0;
  if ((t & me) !== 0) {
    var n = e.deps, r = (t & Y) !== 0;
    if (n !== null) {
      var i, s, a = (t & et) !== 0, o = r && E !== null && !de, u = n.length;
      if (a || o) {
        var c = (
          /** @type {Derived} */
          e
        ), l = c.parent;
        for (i = 0; i < u; i++)
          s = n[i], (a || !((f = s == null ? void 0 : s.reactions) != null && f.includes(c))) && (s.reactions ?? (s.reactions = [])).push(c);
        a && (c.f ^= et), o && l !== null && (l.f & Y) === 0 && (c.f ^= Y);
      }
      for (i = 0; i < u; i++)
        if (s = n[i], Fe(
          /** @type {Derived} */
          s
        ) && ar(
          /** @type {Derived} */
          s
        ), s.wv > e.wv)
          return !0;
    }
    (!r || E !== null && !de) && V(e, N);
  }
  return !1;
}
function ss(e, t) {
  for (var n = t; n !== null; ) {
    if ((n.f & Ze) !== 0)
      try {
        n.fn(e);
        return;
      } catch {
        n.f ^= Ze;
      }
    n = n.parent;
  }
  throw Ue = !1, e;
}
function vn(e) {
  return (e.f & lt) === 0 && (e.parent === null || (e.parent.f & Ze) === 0);
}
function ht(e, t, n, r) {
  if (Ue) {
    if (n === null && (Ue = !1), vn(t))
      throw e;
    return;
  }
  if (n !== null && (Ue = !0), ss(e, t), vn(t))
    throw e;
}
function pr(e, t, n = !0) {
  var r = e.reactions;
  if (r !== null)
    for (var i = 0; i < r.length; i++) {
      var s = r[i];
      $ != null && $.includes(e) || ((s.f & Q) !== 0 ? pr(
        /** @type {Derived} */
        s,
        t,
        !1
      ) : t === s && (n ? V(s, Z) : (s.f & N) !== 0 && V(s, me), vt(
        /** @type {Effect} */
        s
      )));
    }
}
function yr(e) {
  var h;
  var t = R, n = W, r = q, i = A, s = de, a = $, o = O, u = X, c = e.f;
  R = /** @type {null | Value[]} */
  null, W = 0, q = null, de = (c & Y) !== 0 && (X || !Ee || A === null), A = (c & (ie | je)) === 0 ? e : null, $ = null, mn(e.ctx), X = !1, st++, e.f |= Wt;
  try {
    var l = (
      /** @type {Function} */
      (0, e.fn)()
    ), f = e.deps;
    if (R !== null) {
      var d;
      if (at(e, W), f !== null && W > 0)
        for (f.length = W + R.length, d = 0; d < R.length; d++)
          f[W + d] = R[d];
      else
        e.deps = f = R;
      if (!de)
        for (d = W; d < f.length; d++)
          ((h = f[d]).reactions ?? (h.reactions = [])).push(e);
    } else f !== null && W < f.length && (at(e, W), f.length = W);
    if (pt() && q !== null && !X && f !== null && (e.f & (Q | me | Z)) === 0)
      for (d = 0; d < /** @type {Source[]} */
      q.length; d++)
        pr(
          q[d],
          /** @type {Effect} */
          e
        );
    return i !== null && i !== e && (st++, q !== null && (r === null ? r = q : r.push(.../** @type {Source[]} */
    q))), l;
  } finally {
    R = t, W = n, q = r, A = i, de = s, $ = a, mn(o), X = u, e.f ^= Wt;
  }
}
function as(e, t) {
  let n = t.reactions;
  if (n !== null) {
    var r = Fi.call(n, e);
    if (r !== -1) {
      var i = n.length - 1;
      i === 0 ? n = t.reactions = null : (n[r] = n[i], n.pop());
    }
  }
  n === null && (t.f & Q) !== 0 && // Destroying a child effect while updating a parent effect can cause a dependency to appear
  // to be unused, when in fact it is used by the currently-updating parent. Checking `new_deps`
  // allows us to skip the expensive work of disconnecting and immediately reconnecting it
  (R === null || !R.includes(t)) && (V(t, me), (t.f & (Y | et)) === 0 && (t.f ^= et), ir(
    /** @type {Derived} **/
    t
  ), at(
    /** @type {Derived} **/
    t,
    0
  ));
}
function at(e, t) {
  var n = e.deps;
  if (n !== null)
    for (var r = t; r < n.length; r++)
      as(e, n[r]);
}
function gt(e) {
  var t = e.f;
  if ((t & lt) === 0) {
    V(e, N);
    var n = E, r = O, i = Ee;
    E = e, Ee = !0;
    try {
      (t & Jt) !== 0 ? ts(e) : cr(e), ur(e);
      var s = yr(e);
      e.teardown = typeof s == "function" ? s : null, e.wv = vr;
      var a = e.deps, o;
      dn && xi && e.f & Z;
    } catch (u) {
      ht(u, e, n, r || e.ctx);
    } finally {
      Ee = i, E = n;
    }
  }
}
function os() {
  try {
    Li();
  } catch (e) {
    if (it !== null)
      ht(e, it, null);
    else
      throw e;
  }
}
function us() {
  var e = Ee;
  try {
    var t = 0;
    for (Ee = !0; Xe.length > 0; ) {
      t++ > 1e3 && os();
      var n = Xe, r = n.length;
      Xe = [];
      for (var i = 0; i < r; i++) {
        var s = ls(n[i]);
        cs(s);
      }
      Ne.clear();
    }
  } finally {
    qt = !1, Ee = e, it = null;
  }
}
function cs(e) {
  var t = e.length;
  if (t !== 0)
    for (var n = 0; n < t; n++) {
      var r = e[n];
      if ((r.f & (lt | ne)) === 0)
        try {
          Fe(r) && (gt(r), r.deps === null && r.first === null && r.nodes_start === null && (r.teardown === null ? fr(r) : r.fn = null));
        } catch (i) {
          ht(i, r, null, r.ctx);
        }
    }
}
function vt(e) {
  qt || (qt = !0, queueMicrotask(us));
  for (var t = it = e; t.parent !== null; ) {
    t = t.parent;
    var n = t.f;
    if ((n & (je | ie)) !== 0) {
      if ((n & N) === 0) return;
      t.f ^= N;
    }
  }
  Xe.push(t);
}
function ls(e) {
  for (var t = [], n = e; n !== null; ) {
    var r = n.f, i = (r & (ie | je)) !== 0, s = i && (r & N) !== 0;
    if (!s && (r & ne) === 0) {
      if ((r & er) !== 0)
        t.push(n);
      else if (i)
        n.f ^= N;
      else
        try {
          Fe(n) && gt(n);
        } catch (u) {
          ht(u, n, null, n.ctx);
        }
      var a = n.first;
      if (a !== null) {
        n = a;
        continue;
      }
    }
    var o = n.parent;
    for (n = n.next; n === null && o !== null; )
      n = o.next, o = o.parent;
  }
  return t;
}
function b(e) {
  var t = e.f, n = (t & Q) !== 0;
  if (A !== null && !X) {
    if (!($ != null && $.includes(e))) {
      var r = A.deps;
      e.rv < st && (e.rv = st, R === null && r !== null && r[W] === e ? W++ : R === null ? R = [e] : (!de || !R.includes(e)) && R.push(e));
    }
  } else if (n && /** @type {Derived} */
  e.deps === null && /** @type {Derived} */
  e.effects === null) {
    var i = (
      /** @type {Derived} */
      e
    ), s = i.parent;
    s !== null && (s.f & Y) === 0 && (i.f ^= Y);
  }
  return n && (i = /** @type {Derived} */
  e, Fe(i) && ar(i)), Ye && Ne.has(e) ? Ne.get(e) : e.v;
}
function mt(e) {
  var t = X;
  try {
    return X = !0, e();
  } finally {
    X = t;
  }
}
const fs = -7169;
function V(e, t) {
  e.f = e.f & fs | t;
}
function ds(e) {
  if (!(typeof e != "object" || !e || e instanceof EventTarget)) {
    if (De in e)
      Vt(e);
    else if (!Array.isArray(e))
      for (let t in e) {
        const n = e[t];
        typeof n == "object" && n && De in n && Vt(n);
      }
  }
}
function Vt(e, t = /* @__PURE__ */ new Set()) {
  if (typeof e == "object" && e !== null && // We don't want to traverse DOM elements
  !(e instanceof EventTarget) && !t.has(e)) {
    t.add(e), e instanceof Date && e.getTime();
    for (let r in e)
      try {
        Vt(e[r], t);
      } catch {
      }
    const n = Kt(e);
    if (n !== Object.prototype && n !== Array.prototype && n !== Map.prototype && n !== Set.prototype && n !== Date.prototype) {
      const r = Zn(n);
      for (let i in r) {
        const s = r[i].get;
        if (s)
          try {
            s.call(e);
          } catch {
          }
      }
    }
  }
}
const Ne = /* @__PURE__ */ new Map();
function Le(e, t) {
  var n = {
    f: 0,
    // TODO ideally we could skip this altogether, but it causes type errors
    v: e,
    reactions: null,
    equals: nr,
    rv: 0,
    wv: 0
  };
  return n;
}
// @__NO_SIDE_EFFECTS__
function ue(e, t) {
  const n = Le(e);
  return rs(n), n;
}
// @__NO_SIDE_EFFECTS__
function te(e, t = !1) {
  var r;
  const n = Le(e);
  return t || (n.equals = rr), ut && O !== null && O.l !== null && ((r = O.l).s ?? (r.s = [])).push(n), n;
}
function P(e, t, n = !1) {
  A !== null && !X && pt() && (A.f & (Q | Jt)) !== 0 && !($ != null && $.includes(e)) && Hi();
  let r = n ? Se(t) : t;
  return zt(e, r);
}
function zt(e, t) {
  if (!e.equals(t)) {
    var n = e.v;
    Ye ? Ne.set(e, t) : Ne.set(e, n), e.v = t, (e.f & Q) !== 0 && ((e.f & Z) !== 0 && sr(
      /** @type {Derived} */
      e
    ), V(e, (e.f & Y) === 0 ? N : me)), e.wv = mr(), wr(e, Z), pt() && E !== null && (E.f & N) !== 0 && (E.f & (ie | je)) === 0 && (q === null ? is([e]) : q.push(e));
  }
  return t;
}
function wr(e, t) {
  var n = e.reactions;
  if (n !== null)
    for (var r = pt(), i = n.length, s = 0; s < i; s++) {
      var a = n[s], o = a.f;
      (o & Z) === 0 && (!r && a === E || (V(a, t), (o & (N | Y)) !== 0 && ((o & Q) !== 0 ? wr(
        /** @type {Derived} */
        a,
        me
      ) : vt(
        /** @type {Effect} */
        a
      ))));
    }
}
let O = null;
function mn(e) {
  O = e;
}
function hs(e, t = !1, n) {
  var r = O = {
    p: O,
    c: null,
    d: !1,
    e: null,
    m: !1,
    s: e,
    x: null,
    l: null
  };
  ut && !t && (O.l = {
    s: null,
    u: null,
    r1: [],
    r2: Le(!1)
  }), tn(() => {
    r.d = !0;
  });
}
function gs(e) {
  const t = O;
  if (t !== null) {
    const a = t.e;
    if (a !== null) {
      var n = E, r = A;
      t.e = null;
      try {
        for (var i = 0; i < a.length; i++) {
          var s = a[i];
          he(s.effect), ee(s.reaction), nn(s.fn);
        }
      } finally {
        he(n), ee(r);
      }
    }
    O = t.p, t.m = !0;
  }
  return (
    /** @type {T} */
    {}
  );
}
function pt() {
  return !ut || O !== null && O.l === null;
}
function vs(e) {
  var t = A, n = E;
  ee(null), he(null);
  try {
    return e();
  } finally {
    ee(t), he(n);
  }
}
function ms(e, t, n, r = {}) {
  function i(s) {
    if (r.capture || ps.call(t, s), !s.cancelBubble)
      return vs(() => n == null ? void 0 : n.call(this, s));
  }
  return e.startsWith("pointer") || e.startsWith("touch") || e === "wheel" ? gr(() => {
    t.addEventListener(e, i, r);
  }) : t.addEventListener(e, i, r), i;
}
function Mt(e, t, n, r, i) {
  var s = { capture: r, passive: i }, a = ms(e, t, n, s);
  (t === document.body || t === window || t === document) && tn(() => {
    t.removeEventListener(e, a, s);
  });
}
function ps(e) {
  var v;
  var t = this, n = (
    /** @type {Node} */
    t.ownerDocument
  ), r = e.type, i = ((v = e.composedPath) == null ? void 0 : v.call(e)) || [], s = (
    /** @type {null | Element} */
    i[0] || e.target
  ), a = 0, o = e.__root;
  if (o) {
    var u = i.indexOf(o);
    if (u !== -1 && (t === document || t === /** @type {any} */
    window)) {
      e.__root = t;
      return;
    }
    var c = i.indexOf(t);
    if (c === -1)
      return;
    u <= c && (a = u);
  }
  if (s = /** @type {Element} */
  i[a] || e.target, s !== t) {
    Jn(e, "currentTarget", {
      configurable: !0,
      get() {
        return s || n;
      }
    });
    var l = A, f = E;
    ee(null), he(null);
    try {
      for (var d, h = []; s !== null; ) {
        var g = s.assignedSlot || s.parentNode || /** @type {any} */
        s.host || null;
        try {
          var p = s["__" + r];
          if (p != null && (!/** @type {any} */
          s.disabled || // DOM could've been updated already by the time this is reached, so we check this as well
          // -> the target could not have been disabled because it emits the event in the first place
          e.target === s))
            if (Xt(p)) {
              var [x, ...y] = p;
              x.apply(s, [e, ...y]);
            } else
              p.call(s, e);
        } catch (C) {
          d ? h.push(C) : d = C;
        }
        if (e.cancelBubble || g === t || g === null)
          break;
        s = g;
      }
      if (d) {
        for (let C of h)
          queueMicrotask(() => {
            throw C;
          });
        throw d;
      }
    } finally {
      e.__root = t, delete e.currentTarget, ee(l), he(f);
    }
  }
}
function br(e) {
  var t = document.createElement("template");
  return t.innerHTML = e, t.content;
}
function Qt(e, t) {
  var n = (
    /** @type {Effect} */
    E
  );
  n.nodes_start === null && (n.nodes_start = e, n.nodes_end = t);
}
// @__NO_SIDE_EFFECTS__
function qe(e, t) {
  var n = (t & Si) !== 0, r = (t & Di) !== 0, i, s = !e.startsWith("<!>");
  return () => {
    i === void 0 && (i = br(s ? e : "<!>" + e), n || (i = /** @type {Node} */
    /* @__PURE__ */ fe(i)));
    var a = (
      /** @type {TemplateNode} */
      r || qi ? document.importNode(i, !0) : i.cloneNode(!0)
    );
    if (n) {
      var o = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ fe(a)
      ), u = (
        /** @type {TemplateNode} */
        a.lastChild
      );
      Qt(o, u);
    } else
      Qt(a, a);
    return a;
  };
}
function ke(e, t) {
  e !== null && e.before(
    /** @type {Node} */
    t
  );
}
function Ge(e, t) {
  var n = t == null ? "" : typeof t == "object" ? t + "" : t;
  n !== (e.__t ?? (e.__t = e.nodeValue)) && (e.__t = n, e.nodeValue = n + "");
}
function ys(e, t, [n, r] = [0, 0]) {
  var i = e, s = null, a = null, o = L, u = n > 0 ? Zt : 0, c = !1;
  const l = (d, h = !0) => {
    c = !0, f(h, d);
  }, f = (d, h) => {
    o !== (o = d) && (o ? (s ? nt(s) : h && (s = tt(() => h(i))), a && Yt(a, () => {
      a = null;
    })) : (a ? nt(a) : h && (a = tt(() => h(i, [n + 1, r]))), s && Yt(s, () => {
      s = null;
    })));
  };
  rn(() => {
    c = !1, t(l), c || f(null, null);
  }, u);
}
function ws(e, t, n, r) {
  for (var i = [], s = t.length, a = 0; a < s; a++)
    sn(t[a].e, i, !0);
  var o = s > 0 && i.length === 0 && n !== null;
  if (o) {
    var u = (
      /** @type {Element} */
      /** @type {Element} */
      n.parentNode
    );
    Ui(u), u.append(
      /** @type {Element} */
      n
    ), r.clear(), le(e, t[0].prev, t[s - 1].next);
  }
  dr(i, () => {
    for (var c = 0; c < s; c++) {
      var l = t[c];
      o || (r.delete(l.k), le(e, l.prev, l.next)), Oe(l.e, !o);
    }
  });
}
function bs(e, t, n, r, i, s = null) {
  var a = e, o = { flags: t, items: /* @__PURE__ */ new Map(), first: null };
  {
    var u = (
      /** @type {Element} */
      e
    );
    a = u.appendChild(Qi());
  }
  var c = null, l = !1, f = /* @__PURE__ */ jt(() => {
    var d = n();
    return Xt(d) ? d : d == null ? [] : Kn(d);
  });
  rn(() => {
    var d = b(f), h = d.length;
    l && h === 0 || (l = h === 0, _s(d, o, a, i, t, r, n), s !== null && (h === 0 ? c ? nt(c) : c = tt(() => s(a)) : c !== null && Yt(c, () => {
      c = null;
    })), b(f));
  });
}
function _s(e, t, n, r, i, s, a) {
  var o = e.length, u = t.items, c = t.first, l = c, f, d = null, h = [], g = [], p, x, y, v;
  for (v = 0; v < o; v += 1) {
    if (p = e[v], x = s(p, v), y = u.get(x), y === void 0) {
      var C = l ? (
        /** @type {TemplateNode} */
        l.e.nodes_start
      ) : n;
      d = Es(
        C,
        t,
        d,
        d === null ? t.first : d.next,
        p,
        x,
        v,
        r,
        i,
        a
      ), u.set(x, d), h = [], g = [], l = d.next;
      continue;
    }
    if (xs(y, p, v), (y.e.f & ne) !== 0 && nt(y.e), y !== l) {
      if (f !== void 0 && f.has(y)) {
        if (h.length < g.length) {
          var w = g[0], F;
          d = w.prev;
          var I = h[0], M = h[h.length - 1];
          for (F = 0; F < h.length; F += 1)
            pn(h[F], w, n);
          for (F = 0; F < g.length; F += 1)
            f.delete(g[F]);
          le(t, I.prev, M.next), le(t, d, I), le(t, M, w), l = w, d = M, v -= 1, h = [], g = [];
        } else
          f.delete(y), pn(y, l, n), le(t, y.prev, y.next), le(t, y, d === null ? t.first : d.next), le(t, d, y), d = y;
        continue;
      }
      for (h = [], g = []; l !== null && l.k !== x; )
        (l.e.f & ne) === 0 && (f ?? (f = /* @__PURE__ */ new Set())).add(l), g.push(l), l = l.next;
      if (l === null)
        continue;
      y = l;
    }
    h.push(y), d = y, l = y.next;
  }
  if (l !== null || f !== void 0) {
    for (var S = f === void 0 ? [] : Kn(f); l !== null; )
      (l.e.f & ne) === 0 && S.push(l), l = l.next;
    var D = S.length;
    if (D > 0) {
      var U = o === 0 ? n : null;
      ws(t, S, U, u);
    }
  }
  E.first = t.first && t.first.e, E.last = d && d.e;
}
function xs(e, t, n, r) {
  zt(e.v, t), zt(
    /** @type {Value<number>} */
    e.i,
    n
  );
}
function Es(e, t, n, r, i, s, a, o, u, c) {
  var l = (u & Ai) !== 0, f = (u & Mi) === 0, d = l ? f ? /* @__PURE__ */ te(i) : Le(i) : i, h = (u & Ci) === 0 ? a : Le(a), g = {
    i: h,
    v: d,
    k: s,
    a: null,
    // @ts-expect-error
    e: null,
    prev: n,
    next: r
  };
  try {
    return g.e = tt(() => o(e, d, h, c), Yi), g.e.prev = n && n.e, g.e.next = r && r.e, n === null ? t.first = g : (n.next = g, n.e.next = g.e), r !== null && (r.prev = g, r.e.prev = g.e), g;
  } finally {
  }
}
function pn(e, t, n) {
  for (var r = e.next ? (
    /** @type {TemplateNode} */
    e.next.e.nodes_start
  ) : n, i = t ? (
    /** @type {TemplateNode} */
    t.e.nodes_start
  ) : n, s = (
    /** @type {TemplateNode} */
    e.e.nodes_start
  ); s !== r; ) {
    var a = (
      /** @type {TemplateNode} */
      /* @__PURE__ */ ft(s)
    );
    i.before(s), s = a;
  }
}
function le(e, t, n) {
  t === null ? e.first = n : (t.next = n, t.e.next = n && n.e), n !== null && (n.prev = t, n.e.prev = t && t.e);
}
function yn(e, t, n = !1, r = !1, i = !1) {
  var s = e, a = "";
  Ht(() => {
    var o = (
      /** @type {Effect} */
      E
    );
    if (a !== (a = t() ?? "") && (o.nodes_start !== null && (lr(
      o.nodes_start,
      /** @type {TemplateNode} */
      o.nodes_end
    ), o.nodes_start = o.nodes_end = null), a !== "")) {
      var u = a + "";
      n ? u = `<svg>${u}</svg>` : r && (u = `<math>${u}</math>`);
      var c = br(u);
      if ((n || r) && (c = /** @type {Element} */
      /* @__PURE__ */ fe(c)), Qt(
        /** @type {TemplateNode} */
        /* @__PURE__ */ fe(c),
        /** @type {TemplateNode} */
        c.lastChild
      ), n || r)
        for (; /* @__PURE__ */ fe(c); )
          s.before(
            /** @type {Node} */
            /* @__PURE__ */ fe(c)
          );
      else
        s.before(c);
    }
  });
}
const wn = [...` 	
\r\f \v\uFEFF`];
function As(e, t, n) {
  var r = "" + e;
  if (n) {
    for (var i in n)
      if (n[i])
        r = r ? r + " " + i : i;
      else if (r.length)
        for (var s = i.length, a = 0; (a = r.indexOf(i, a)) >= 0; ) {
          var o = a + s;
          (a === 0 || wn.includes(r[a - 1])) && (o === r.length || wn.includes(r[o])) ? r = (a === 0 ? "" : r.substring(0, a)) + r.substring(o + 1) : a = o;
        }
  }
  return r === "" ? null : r;
}
function Cs(e, t, n, r, i, s) {
  var a = e.__className;
  if (a !== n || a === void 0) {
    var o = As(n, r, s);
    o == null ? e.removeAttribute("class") : e.className = o, e.__className = n;
  } else if (s && i !== s)
    for (var u in s) {
      var c = !!s[u];
      (i == null || c !== !!i[u]) && e.classList.toggle(u, c);
    }
  return s;
}
const Ms = Symbol("is custom element"), Ss = Symbol("is html");
function Ds(e, t, n, r) {
  var i = Os(e);
  i[t] !== (i[t] = n) && (n == null ? e.removeAttribute(t) : typeof n != "string" && Fs(e).includes(t) ? e[t] = n : e.setAttribute(t, n));
}
function Os(e) {
  return (
    /** @type {Record<string | symbol, unknown>} **/
    // @ts-expect-error
    e.__attributes ?? (e.__attributes = {
      [Ms]: e.nodeName.includes("-"),
      [Ss]: e.namespaceURI === Oi
    })
  );
}
var bn = /* @__PURE__ */ new Map();
function Fs(e) {
  var t = bn.get(e.nodeName);
  if (t) return t;
  bn.set(e.nodeName, t = []);
  for (var n, r = e, i = Element.prototype; i !== r; ) {
    n = Zn(r);
    for (var s in n)
      n[s].set && t.push(s);
    r = Kt(r);
  }
  return t;
}
function _n(e, t) {
  return e === t || (e == null ? void 0 : e[De]) === t;
}
function Is(e = {}, t, n, r) {
  return nn(() => {
    var i, s;
    return dt(() => {
      i = s, s = [], mt(() => {
        e !== n(...s) && (t(e, ...s), i && _n(n(...i), e) && t(null, ...i));
      });
    }), () => {
      gr(() => {
        s && _n(n(...s), e) && t(null, ...s);
      });
    };
  }), e;
}
function ks(e = !1) {
  const t = (
    /** @type {ComponentContextLegacy} */
    O
  ), n = t.l.u;
  if (!n) return;
  let r = () => ds(t.s);
  if (e) {
    let i = 0, s = (
      /** @type {Record<string, any>} */
      {}
    );
    const a = /* @__PURE__ */ en(() => {
      let o = !1;
      const u = t.s;
      for (const c in u)
        u[c] !== s[c] && (s[c] = u[c], o = !0);
      return o && i++, i;
    });
    r = () => b(a);
  }
  n.b.length && Zi(() => {
    xn(t, r), Lt(n.b);
  }), hn(() => {
    const i = mt(() => n.m.map(Pi));
    return () => {
      for (const s of i)
        typeof s == "function" && s();
    };
  }), n.a.length && hn(() => {
    xn(t, r), Lt(n.a);
  });
}
function xn(e, t) {
  if (e.l.s)
    for (const n of e.l.s) b(n);
  t();
}
function _r(e, t, n) {
  if (e == null)
    return t(void 0), Nt;
  const r = mt(
    () => e.subscribe(
      t,
      // @ts-expect-error
      n
    )
  );
  return r.unsubscribe ? () => r.unsubscribe() : r;
}
function Ps(e) {
  let t;
  return _r(e, (n) => t = n)(), t;
}
let Gt = Symbol();
function Ts(e, t, n) {
  const r = n[t] ?? (n[t] = {
    store: null,
    source: /* @__PURE__ */ te(void 0),
    unsubscribe: Nt
  });
  if (r.store !== e && !(Gt in n))
    if (r.unsubscribe(), r.store = e ?? null, e == null)
      r.source.v = void 0, r.unsubscribe = Nt;
    else {
      var i = !0;
      r.unsubscribe = _r(e, (s) => {
        i ? r.source.v = s : P(r.source, s);
      }), i = !1;
    }
  return e && Gt in n ? Ps(e) : b(r.source);
}
function Bs() {
  const e = {};
  function t() {
    tn(() => {
      for (var n in e)
        e[n].unsubscribe();
      Jn(e, Gt, {
        enumerable: !1,
        value: !0
      });
    });
  }
  return [e, t];
}
const xr = 6048e5, Rs = 864e5, En = Symbol.for("constructDateFrom");
function ge(e, t) {
  return typeof e == "function" ? e(t) : e && typeof e == "object" && En in e ? e[En](t) : e instanceof Date ? new e.constructor(t) : new Date(t);
}
function G(e, t) {
  return ge(t || e, e);
}
let $s = {};
function yt() {
  return $s;
}
function We(e, t) {
  var o, u, c, l;
  const n = yt(), r = (t == null ? void 0 : t.weekStartsOn) ?? ((u = (o = t == null ? void 0 : t.locale) == null ? void 0 : o.options) == null ? void 0 : u.weekStartsOn) ?? n.weekStartsOn ?? ((l = (c = n.locale) == null ? void 0 : c.options) == null ? void 0 : l.weekStartsOn) ?? 0, i = G(e, t == null ? void 0 : t.in), s = i.getDay(), a = (s < r ? 7 : 0) + s - r;
  return i.setDate(i.getDate() - a), i.setHours(0, 0, 0, 0), i;
}
function ot(e, t) {
  return We(e, { ...t, weekStartsOn: 1 });
}
function Er(e, t) {
  const n = G(e, t == null ? void 0 : t.in), r = n.getFullYear(), i = ge(n, 0);
  i.setFullYear(r + 1, 0, 4), i.setHours(0, 0, 0, 0);
  const s = ot(i), a = ge(n, 0);
  a.setFullYear(r, 0, 4), a.setHours(0, 0, 0, 0);
  const o = ot(a);
  return n.getTime() >= s.getTime() ? r + 1 : n.getTime() >= o.getTime() ? r : r - 1;
}
function An(e) {
  const t = G(e), n = new Date(
    Date.UTC(
      t.getFullYear(),
      t.getMonth(),
      t.getDate(),
      t.getHours(),
      t.getMinutes(),
      t.getSeconds(),
      t.getMilliseconds()
    )
  );
  return n.setUTCFullYear(t.getFullYear()), +e - +n;
}
function Ns(e, ...t) {
  const n = ge.bind(
    null,
    t.find((r) => typeof r == "object")
  );
  return t.map(n);
}
function Cn(e, t) {
  const n = G(e, t == null ? void 0 : t.in);
  return n.setHours(0, 0, 0, 0), n;
}
function Ls(e, t, n) {
  const [r, i] = Ns(
    n == null ? void 0 : n.in,
    e,
    t
  ), s = Cn(r), a = Cn(i), o = +s - An(s), u = +a - An(a);
  return Math.round((o - u) / Rs);
}
function Ws(e, t) {
  const n = Er(e, t), r = ge(e, 0);
  return r.setFullYear(n, 0, 4), r.setHours(0, 0, 0, 0), ot(r);
}
function js(e) {
  return e instanceof Date || typeof e == "object" && Object.prototype.toString.call(e) === "[object Date]";
}
function Hs(e) {
  return !(!js(e) && typeof e != "number" || isNaN(+G(e)));
}
function Ys(e, t) {
  const n = G(e, t == null ? void 0 : t.in);
  return n.setFullYear(n.getFullYear(), 0, 1), n.setHours(0, 0, 0, 0), n;
}
const qs = {
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
}, Vs = (e, t, n) => {
  let r;
  const i = qs[e];
  return typeof i == "string" ? r = i : t === 1 ? r = i.one : r = i.other.replace("{{count}}", t.toString()), n != null && n.addSuffix ? n.comparison && n.comparison > 0 ? "in " + r : r + " ago" : r;
};
function St(e) {
  return (t = {}) => {
    const n = t.width ? String(t.width) : e.defaultWidth;
    return e.formats[n] || e.formats[e.defaultWidth];
  };
}
const zs = {
  full: "EEEE, MMMM do, y",
  long: "MMMM do, y",
  medium: "MMM d, y",
  short: "MM/dd/yyyy"
}, Qs = {
  full: "h:mm:ss a zzzz",
  long: "h:mm:ss a z",
  medium: "h:mm:ss a",
  short: "h:mm a"
}, Gs = {
  full: "{{date}} 'at' {{time}}",
  long: "{{date}} 'at' {{time}}",
  medium: "{{date}}, {{time}}",
  short: "{{date}}, {{time}}"
}, Us = {
  date: St({
    formats: zs,
    defaultWidth: "full"
  }),
  time: St({
    formats: Qs,
    defaultWidth: "full"
  }),
  dateTime: St({
    formats: Gs,
    defaultWidth: "full"
  })
}, Xs = {
  lastWeek: "'last' eeee 'at' p",
  yesterday: "'yesterday at' p",
  today: "'today at' p",
  tomorrow: "'tomorrow at' p",
  nextWeek: "eeee 'at' p",
  other: "P"
}, Ks = (e, t, n, r) => Xs[e];
function Pe(e) {
  return (t, n) => {
    const r = n != null && n.context ? String(n.context) : "standalone";
    let i;
    if (r === "formatting" && e.formattingValues) {
      const a = e.defaultFormattingWidth || e.defaultWidth, o = n != null && n.width ? String(n.width) : a;
      i = e.formattingValues[o] || e.formattingValues[a];
    } else {
      const a = e.defaultWidth, o = n != null && n.width ? String(n.width) : e.defaultWidth;
      i = e.values[o] || e.values[a];
    }
    const s = e.argumentCallback ? e.argumentCallback(t) : t;
    return i[s];
  };
}
const Js = {
  narrow: ["B", "A"],
  abbreviated: ["BC", "AD"],
  wide: ["Before Christ", "Anno Domini"]
}, Zs = {
  narrow: ["1", "2", "3", "4"],
  abbreviated: ["Q1", "Q2", "Q3", "Q4"],
  wide: ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter"]
}, ea = {
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
}, ta = {
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
}, na = {
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
}, ra = {
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
}, ia = (e, t) => {
  const n = Number(e), r = n % 100;
  if (r > 20 || r < 10)
    switch (r % 10) {
      case 1:
        return n + "st";
      case 2:
        return n + "nd";
      case 3:
        return n + "rd";
    }
  return n + "th";
}, sa = {
  ordinalNumber: ia,
  era: Pe({
    values: Js,
    defaultWidth: "wide"
  }),
  quarter: Pe({
    values: Zs,
    defaultWidth: "wide",
    argumentCallback: (e) => e - 1
  }),
  month: Pe({
    values: ea,
    defaultWidth: "wide"
  }),
  day: Pe({
    values: ta,
    defaultWidth: "wide"
  }),
  dayPeriod: Pe({
    values: na,
    defaultWidth: "wide",
    formattingValues: ra,
    defaultFormattingWidth: "wide"
  })
};
function Te(e) {
  return (t, n = {}) => {
    const r = n.width, i = r && e.matchPatterns[r] || e.matchPatterns[e.defaultMatchWidth], s = t.match(i);
    if (!s)
      return null;
    const a = s[0], o = r && e.parsePatterns[r] || e.parsePatterns[e.defaultParseWidth], u = Array.isArray(o) ? oa(o, (f) => f.test(a)) : (
      // [TODO] -- I challenge you to fix the type
      aa(o, (f) => f.test(a))
    );
    let c;
    c = e.valueCallback ? e.valueCallback(u) : u, c = n.valueCallback ? (
      // [TODO] -- I challenge you to fix the type
      n.valueCallback(c)
    ) : c;
    const l = t.slice(a.length);
    return { value: c, rest: l };
  };
}
function aa(e, t) {
  for (const n in e)
    if (Object.prototype.hasOwnProperty.call(e, n) && t(e[n]))
      return n;
}
function oa(e, t) {
  for (let n = 0; n < e.length; n++)
    if (t(e[n]))
      return n;
}
function ua(e) {
  return (t, n = {}) => {
    const r = t.match(e.matchPattern);
    if (!r) return null;
    const i = r[0], s = t.match(e.parsePattern);
    if (!s) return null;
    let a = e.valueCallback ? e.valueCallback(s[0]) : s[0];
    a = n.valueCallback ? n.valueCallback(a) : a;
    const o = t.slice(i.length);
    return { value: a, rest: o };
  };
}
const ca = /^(\d+)(th|st|nd|rd)?/i, la = /\d+/i, fa = {
  narrow: /^(b|a)/i,
  abbreviated: /^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,
  wide: /^(before christ|before common era|anno domini|common era)/i
}, da = {
  any: [/^b/i, /^(a|c)/i]
}, ha = {
  narrow: /^[1234]/i,
  abbreviated: /^q[1234]/i,
  wide: /^[1234](th|st|nd|rd)? quarter/i
}, ga = {
  any: [/1/i, /2/i, /3/i, /4/i]
}, va = {
  narrow: /^[jfmasond]/i,
  abbreviated: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  wide: /^(january|february|march|april|may|june|july|august|september|october|november|december)/i
}, ma = {
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
}, pa = {
  narrow: /^[smtwf]/i,
  short: /^(su|mo|tu|we|th|fr|sa)/i,
  abbreviated: /^(sun|mon|tue|wed|thu|fri|sat)/i,
  wide: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i
}, ya = {
  narrow: [/^s/i, /^m/i, /^t/i, /^w/i, /^t/i, /^f/i, /^s/i],
  any: [/^su/i, /^m/i, /^tu/i, /^w/i, /^th/i, /^f/i, /^sa/i]
}, wa = {
  narrow: /^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,
  any: /^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i
}, ba = {
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
}, _a = {
  ordinalNumber: ua({
    matchPattern: ca,
    parsePattern: la,
    valueCallback: (e) => parseInt(e, 10)
  }),
  era: Te({
    matchPatterns: fa,
    defaultMatchWidth: "wide",
    parsePatterns: da,
    defaultParseWidth: "any"
  }),
  quarter: Te({
    matchPatterns: ha,
    defaultMatchWidth: "wide",
    parsePatterns: ga,
    defaultParseWidth: "any",
    valueCallback: (e) => e + 1
  }),
  month: Te({
    matchPatterns: va,
    defaultMatchWidth: "wide",
    parsePatterns: ma,
    defaultParseWidth: "any"
  }),
  day: Te({
    matchPatterns: pa,
    defaultMatchWidth: "wide",
    parsePatterns: ya,
    defaultParseWidth: "any"
  }),
  dayPeriod: Te({
    matchPatterns: wa,
    defaultMatchWidth: "any",
    parsePatterns: ba,
    defaultParseWidth: "any"
  })
}, xa = {
  code: "en-US",
  formatDistance: Vs,
  formatLong: Us,
  formatRelative: Ks,
  localize: sa,
  match: _a,
  options: {
    weekStartsOn: 0,
    firstWeekContainsDate: 1
  }
};
function Ea(e, t) {
  const n = G(e, t == null ? void 0 : t.in);
  return Ls(n, Ys(n)) + 1;
}
function Aa(e, t) {
  const n = G(e, t == null ? void 0 : t.in), r = +ot(n) - +Ws(n);
  return Math.round(r / xr) + 1;
}
function Ar(e, t) {
  var l, f, d, h;
  const n = G(e, t == null ? void 0 : t.in), r = n.getFullYear(), i = yt(), s = (t == null ? void 0 : t.firstWeekContainsDate) ?? ((f = (l = t == null ? void 0 : t.locale) == null ? void 0 : l.options) == null ? void 0 : f.firstWeekContainsDate) ?? i.firstWeekContainsDate ?? ((h = (d = i.locale) == null ? void 0 : d.options) == null ? void 0 : h.firstWeekContainsDate) ?? 1, a = ge((t == null ? void 0 : t.in) || e, 0);
  a.setFullYear(r + 1, 0, s), a.setHours(0, 0, 0, 0);
  const o = We(a, t), u = ge((t == null ? void 0 : t.in) || e, 0);
  u.setFullYear(r, 0, s), u.setHours(0, 0, 0, 0);
  const c = We(u, t);
  return +n >= +o ? r + 1 : +n >= +c ? r : r - 1;
}
function Ca(e, t) {
  var o, u, c, l;
  const n = yt(), r = (t == null ? void 0 : t.firstWeekContainsDate) ?? ((u = (o = t == null ? void 0 : t.locale) == null ? void 0 : o.options) == null ? void 0 : u.firstWeekContainsDate) ?? n.firstWeekContainsDate ?? ((l = (c = n.locale) == null ? void 0 : c.options) == null ? void 0 : l.firstWeekContainsDate) ?? 1, i = Ar(e, t), s = ge((t == null ? void 0 : t.in) || e, 0);
  return s.setFullYear(i, 0, r), s.setHours(0, 0, 0, 0), We(s, t);
}
function Ma(e, t) {
  const n = G(e, t == null ? void 0 : t.in), r = +We(n, t) - +Ca(n, t);
  return Math.round(r / xr) + 1;
}
function _(e, t) {
  const n = e < 0 ? "-" : "", r = Math.abs(e).toString().padStart(t, "0");
  return n + r;
}
const ce = {
  // Year
  y(e, t) {
    const n = e.getFullYear(), r = n > 0 ? n : 1 - n;
    return _(t === "yy" ? r % 100 : r, t.length);
  },
  // Month
  M(e, t) {
    const n = e.getMonth();
    return t === "M" ? String(n + 1) : _(n + 1, 2);
  },
  // Day of the month
  d(e, t) {
    return _(e.getDate(), t.length);
  },
  // AM or PM
  a(e, t) {
    const n = e.getHours() / 12 >= 1 ? "pm" : "am";
    switch (t) {
      case "a":
      case "aa":
        return n.toUpperCase();
      case "aaa":
        return n;
      case "aaaaa":
        return n[0];
      case "aaaa":
      default:
        return n === "am" ? "a.m." : "p.m.";
    }
  },
  // Hour [1-12]
  h(e, t) {
    return _(e.getHours() % 12 || 12, t.length);
  },
  // Hour [0-23]
  H(e, t) {
    return _(e.getHours(), t.length);
  },
  // Minute
  m(e, t) {
    return _(e.getMinutes(), t.length);
  },
  // Second
  s(e, t) {
    return _(e.getSeconds(), t.length);
  },
  // Fraction of second
  S(e, t) {
    const n = t.length, r = e.getMilliseconds(), i = Math.trunc(
      r * Math.pow(10, n - 3)
    );
    return _(i, t.length);
  }
}, Me = {
  midnight: "midnight",
  noon: "noon",
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  night: "night"
}, Mn = {
  // Era
  G: function(e, t, n) {
    const r = e.getFullYear() > 0 ? 1 : 0;
    switch (t) {
      // AD, BC
      case "G":
      case "GG":
      case "GGG":
        return n.era(r, { width: "abbreviated" });
      // A, B
      case "GGGGG":
        return n.era(r, { width: "narrow" });
      // Anno Domini, Before Christ
      case "GGGG":
      default:
        return n.era(r, { width: "wide" });
    }
  },
  // Year
  y: function(e, t, n) {
    if (t === "yo") {
      const r = e.getFullYear(), i = r > 0 ? r : 1 - r;
      return n.ordinalNumber(i, { unit: "year" });
    }
    return ce.y(e, t);
  },
  // Local week-numbering year
  Y: function(e, t, n, r) {
    const i = Ar(e, r), s = i > 0 ? i : 1 - i;
    if (t === "YY") {
      const a = s % 100;
      return _(a, 2);
    }
    return t === "Yo" ? n.ordinalNumber(s, { unit: "year" }) : _(s, t.length);
  },
  // ISO week-numbering year
  R: function(e, t) {
    const n = Er(e);
    return _(n, t.length);
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
  u: function(e, t) {
    const n = e.getFullYear();
    return _(n, t.length);
  },
  // Quarter
  Q: function(e, t, n) {
    const r = Math.ceil((e.getMonth() + 1) / 3);
    switch (t) {
      // 1, 2, 3, 4
      case "Q":
        return String(r);
      // 01, 02, 03, 04
      case "QQ":
        return _(r, 2);
      // 1st, 2nd, 3rd, 4th
      case "Qo":
        return n.ordinalNumber(r, { unit: "quarter" });
      // Q1, Q2, Q3, Q4
      case "QQQ":
        return n.quarter(r, {
          width: "abbreviated",
          context: "formatting"
        });
      // 1, 2, 3, 4 (narrow quarter; could be not numerical)
      case "QQQQQ":
        return n.quarter(r, {
          width: "narrow",
          context: "formatting"
        });
      // 1st quarter, 2nd quarter, ...
      case "QQQQ":
      default:
        return n.quarter(r, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Stand-alone quarter
  q: function(e, t, n) {
    const r = Math.ceil((e.getMonth() + 1) / 3);
    switch (t) {
      // 1, 2, 3, 4
      case "q":
        return String(r);
      // 01, 02, 03, 04
      case "qq":
        return _(r, 2);
      // 1st, 2nd, 3rd, 4th
      case "qo":
        return n.ordinalNumber(r, { unit: "quarter" });
      // Q1, Q2, Q3, Q4
      case "qqq":
        return n.quarter(r, {
          width: "abbreviated",
          context: "standalone"
        });
      // 1, 2, 3, 4 (narrow quarter; could be not numerical)
      case "qqqqq":
        return n.quarter(r, {
          width: "narrow",
          context: "standalone"
        });
      // 1st quarter, 2nd quarter, ...
      case "qqqq":
      default:
        return n.quarter(r, {
          width: "wide",
          context: "standalone"
        });
    }
  },
  // Month
  M: function(e, t, n) {
    const r = e.getMonth();
    switch (t) {
      case "M":
      case "MM":
        return ce.M(e, t);
      // 1st, 2nd, ..., 12th
      case "Mo":
        return n.ordinalNumber(r + 1, { unit: "month" });
      // Jan, Feb, ..., Dec
      case "MMM":
        return n.month(r, {
          width: "abbreviated",
          context: "formatting"
        });
      // J, F, ..., D
      case "MMMMM":
        return n.month(r, {
          width: "narrow",
          context: "formatting"
        });
      // January, February, ..., December
      case "MMMM":
      default:
        return n.month(r, { width: "wide", context: "formatting" });
    }
  },
  // Stand-alone month
  L: function(e, t, n) {
    const r = e.getMonth();
    switch (t) {
      // 1, 2, ..., 12
      case "L":
        return String(r + 1);
      // 01, 02, ..., 12
      case "LL":
        return _(r + 1, 2);
      // 1st, 2nd, ..., 12th
      case "Lo":
        return n.ordinalNumber(r + 1, { unit: "month" });
      // Jan, Feb, ..., Dec
      case "LLL":
        return n.month(r, {
          width: "abbreviated",
          context: "standalone"
        });
      // J, F, ..., D
      case "LLLLL":
        return n.month(r, {
          width: "narrow",
          context: "standalone"
        });
      // January, February, ..., December
      case "LLLL":
      default:
        return n.month(r, { width: "wide", context: "standalone" });
    }
  },
  // Local week of year
  w: function(e, t, n, r) {
    const i = Ma(e, r);
    return t === "wo" ? n.ordinalNumber(i, { unit: "week" }) : _(i, t.length);
  },
  // ISO week of year
  I: function(e, t, n) {
    const r = Aa(e);
    return t === "Io" ? n.ordinalNumber(r, { unit: "week" }) : _(r, t.length);
  },
  // Day of the month
  d: function(e, t, n) {
    return t === "do" ? n.ordinalNumber(e.getDate(), { unit: "date" }) : ce.d(e, t);
  },
  // Day of year
  D: function(e, t, n) {
    const r = Ea(e);
    return t === "Do" ? n.ordinalNumber(r, { unit: "dayOfYear" }) : _(r, t.length);
  },
  // Day of week
  E: function(e, t, n) {
    const r = e.getDay();
    switch (t) {
      // Tue
      case "E":
      case "EE":
      case "EEE":
        return n.day(r, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "EEEEE":
        return n.day(r, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "EEEEEE":
        return n.day(r, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "EEEE":
      default:
        return n.day(r, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Local day of week
  e: function(e, t, n, r) {
    const i = e.getDay(), s = (i - r.weekStartsOn + 8) % 7 || 7;
    switch (t) {
      // Numerical value (Nth day of week with current locale or weekStartsOn)
      case "e":
        return String(s);
      // Padded numerical value
      case "ee":
        return _(s, 2);
      // 1st, 2nd, ..., 7th
      case "eo":
        return n.ordinalNumber(s, { unit: "day" });
      case "eee":
        return n.day(i, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "eeeee":
        return n.day(i, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "eeeeee":
        return n.day(i, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "eeee":
      default:
        return n.day(i, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Stand-alone local day of week
  c: function(e, t, n, r) {
    const i = e.getDay(), s = (i - r.weekStartsOn + 8) % 7 || 7;
    switch (t) {
      // Numerical value (same as in `e`)
      case "c":
        return String(s);
      // Padded numerical value
      case "cc":
        return _(s, t.length);
      // 1st, 2nd, ..., 7th
      case "co":
        return n.ordinalNumber(s, { unit: "day" });
      case "ccc":
        return n.day(i, {
          width: "abbreviated",
          context: "standalone"
        });
      // T
      case "ccccc":
        return n.day(i, {
          width: "narrow",
          context: "standalone"
        });
      // Tu
      case "cccccc":
        return n.day(i, {
          width: "short",
          context: "standalone"
        });
      // Tuesday
      case "cccc":
      default:
        return n.day(i, {
          width: "wide",
          context: "standalone"
        });
    }
  },
  // ISO day of week
  i: function(e, t, n) {
    const r = e.getDay(), i = r === 0 ? 7 : r;
    switch (t) {
      // 2
      case "i":
        return String(i);
      // 02
      case "ii":
        return _(i, t.length);
      // 2nd
      case "io":
        return n.ordinalNumber(i, { unit: "day" });
      // Tue
      case "iii":
        return n.day(r, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "iiiii":
        return n.day(r, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "iiiiii":
        return n.day(r, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "iiii":
      default:
        return n.day(r, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // AM or PM
  a: function(e, t, n) {
    const i = e.getHours() / 12 >= 1 ? "pm" : "am";
    switch (t) {
      case "a":
      case "aa":
        return n.dayPeriod(i, {
          width: "abbreviated",
          context: "formatting"
        });
      case "aaa":
        return n.dayPeriod(i, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "aaaaa":
        return n.dayPeriod(i, {
          width: "narrow",
          context: "formatting"
        });
      case "aaaa":
      default:
        return n.dayPeriod(i, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // AM, PM, midnight, noon
  b: function(e, t, n) {
    const r = e.getHours();
    let i;
    switch (r === 12 ? i = Me.noon : r === 0 ? i = Me.midnight : i = r / 12 >= 1 ? "pm" : "am", t) {
      case "b":
      case "bb":
        return n.dayPeriod(i, {
          width: "abbreviated",
          context: "formatting"
        });
      case "bbb":
        return n.dayPeriod(i, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "bbbbb":
        return n.dayPeriod(i, {
          width: "narrow",
          context: "formatting"
        });
      case "bbbb":
      default:
        return n.dayPeriod(i, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // in the morning, in the afternoon, in the evening, at night
  B: function(e, t, n) {
    const r = e.getHours();
    let i;
    switch (r >= 17 ? i = Me.evening : r >= 12 ? i = Me.afternoon : r >= 4 ? i = Me.morning : i = Me.night, t) {
      case "B":
      case "BB":
      case "BBB":
        return n.dayPeriod(i, {
          width: "abbreviated",
          context: "formatting"
        });
      case "BBBBB":
        return n.dayPeriod(i, {
          width: "narrow",
          context: "formatting"
        });
      case "BBBB":
      default:
        return n.dayPeriod(i, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Hour [1-12]
  h: function(e, t, n) {
    if (t === "ho") {
      let r = e.getHours() % 12;
      return r === 0 && (r = 12), n.ordinalNumber(r, { unit: "hour" });
    }
    return ce.h(e, t);
  },
  // Hour [0-23]
  H: function(e, t, n) {
    return t === "Ho" ? n.ordinalNumber(e.getHours(), { unit: "hour" }) : ce.H(e, t);
  },
  // Hour [0-11]
  K: function(e, t, n) {
    const r = e.getHours() % 12;
    return t === "Ko" ? n.ordinalNumber(r, { unit: "hour" }) : _(r, t.length);
  },
  // Hour [1-24]
  k: function(e, t, n) {
    let r = e.getHours();
    return r === 0 && (r = 24), t === "ko" ? n.ordinalNumber(r, { unit: "hour" }) : _(r, t.length);
  },
  // Minute
  m: function(e, t, n) {
    return t === "mo" ? n.ordinalNumber(e.getMinutes(), { unit: "minute" }) : ce.m(e, t);
  },
  // Second
  s: function(e, t, n) {
    return t === "so" ? n.ordinalNumber(e.getSeconds(), { unit: "second" }) : ce.s(e, t);
  },
  // Fraction of second
  S: function(e, t) {
    return ce.S(e, t);
  },
  // Timezone (ISO-8601. If offset is 0, output is always `'Z'`)
  X: function(e, t, n) {
    const r = e.getTimezoneOffset();
    if (r === 0)
      return "Z";
    switch (t) {
      // Hours and optional minutes
      case "X":
        return Dn(r);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XX`
      case "XXXX":
      case "XX":
        return be(r);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XXX`
      case "XXXXX":
      case "XXX":
      // Hours and minutes with `:` delimiter
      default:
        return be(r, ":");
    }
  },
  // Timezone (ISO-8601. If offset is 0, output is `'+00:00'` or equivalent)
  x: function(e, t, n) {
    const r = e.getTimezoneOffset();
    switch (t) {
      // Hours and optional minutes
      case "x":
        return Dn(r);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xx`
      case "xxxx":
      case "xx":
        return be(r);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xxx`
      case "xxxxx":
      case "xxx":
      // Hours and minutes with `:` delimiter
      default:
        return be(r, ":");
    }
  },
  // Timezone (GMT)
  O: function(e, t, n) {
    const r = e.getTimezoneOffset();
    switch (t) {
      // Short
      case "O":
      case "OO":
      case "OOO":
        return "GMT" + Sn(r, ":");
      // Long
      case "OOOO":
      default:
        return "GMT" + be(r, ":");
    }
  },
  // Timezone (specific non-location)
  z: function(e, t, n) {
    const r = e.getTimezoneOffset();
    switch (t) {
      // Short
      case "z":
      case "zz":
      case "zzz":
        return "GMT" + Sn(r, ":");
      // Long
      case "zzzz":
      default:
        return "GMT" + be(r, ":");
    }
  },
  // Seconds timestamp
  t: function(e, t, n) {
    const r = Math.trunc(+e / 1e3);
    return _(r, t.length);
  },
  // Milliseconds timestamp
  T: function(e, t, n) {
    return _(+e, t.length);
  }
};
function Sn(e, t = "") {
  const n = e > 0 ? "-" : "+", r = Math.abs(e), i = Math.trunc(r / 60), s = r % 60;
  return s === 0 ? n + String(i) : n + String(i) + t + _(s, 2);
}
function Dn(e, t) {
  return e % 60 === 0 ? (e > 0 ? "-" : "+") + _(Math.abs(e) / 60, 2) : be(e, t);
}
function be(e, t = "") {
  const n = e > 0 ? "-" : "+", r = Math.abs(e), i = _(Math.trunc(r / 60), 2), s = _(r % 60, 2);
  return n + i + t + s;
}
const On = (e, t) => {
  switch (e) {
    case "P":
      return t.date({ width: "short" });
    case "PP":
      return t.date({ width: "medium" });
    case "PPP":
      return t.date({ width: "long" });
    case "PPPP":
    default:
      return t.date({ width: "full" });
  }
}, Cr = (e, t) => {
  switch (e) {
    case "p":
      return t.time({ width: "short" });
    case "pp":
      return t.time({ width: "medium" });
    case "ppp":
      return t.time({ width: "long" });
    case "pppp":
    default:
      return t.time({ width: "full" });
  }
}, Sa = (e, t) => {
  const n = e.match(/(P+)(p+)?/) || [], r = n[1], i = n[2];
  if (!i)
    return On(e, t);
  let s;
  switch (r) {
    case "P":
      s = t.dateTime({ width: "short" });
      break;
    case "PP":
      s = t.dateTime({ width: "medium" });
      break;
    case "PPP":
      s = t.dateTime({ width: "long" });
      break;
    case "PPPP":
    default:
      s = t.dateTime({ width: "full" });
      break;
  }
  return s.replace("{{date}}", On(r, t)).replace("{{time}}", Cr(i, t));
}, Da = {
  p: Cr,
  P: Sa
}, Oa = /^D+$/, Fa = /^Y+$/, Ia = ["D", "DD", "YY", "YYYY"];
function ka(e) {
  return Oa.test(e);
}
function Pa(e) {
  return Fa.test(e);
}
function Ta(e, t, n) {
  const r = Ba(e, t, n);
  if (console.warn(r), Ia.includes(e)) throw new RangeError(r);
}
function Ba(e, t, n) {
  const r = e[0] === "Y" ? "years" : "days of the month";
  return `Use \`${e.toLowerCase()}\` instead of \`${e}\` (in \`${t}\`) for formatting ${r} to the input \`${n}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`;
}
const Ra = /[yYQqMLwIdDecihHKkms]o|(\w)\1*|''|'(''|[^'])+('|$)|./g, $a = /P+p+|P+|p+|''|'(''|[^'])+('|$)|./g, Na = /^'([^]*?)'?$/, La = /''/g, Wa = /[a-zA-Z]/;
function Dt(e, t, n) {
  var l, f, d, h;
  const r = yt(), i = r.locale ?? xa, s = r.firstWeekContainsDate ?? ((f = (l = r.locale) == null ? void 0 : l.options) == null ? void 0 : f.firstWeekContainsDate) ?? 1, a = r.weekStartsOn ?? ((h = (d = r.locale) == null ? void 0 : d.options) == null ? void 0 : h.weekStartsOn) ?? 0, o = G(e, n == null ? void 0 : n.in);
  if (!Hs(o))
    throw new RangeError("Invalid time value");
  let u = t.match($a).map((g) => {
    const p = g[0];
    if (p === "p" || p === "P") {
      const x = Da[p];
      return x(g, i.formatLong);
    }
    return g;
  }).join("").match(Ra).map((g) => {
    if (g === "''")
      return { isToken: !1, value: "'" };
    const p = g[0];
    if (p === "'")
      return { isToken: !1, value: ja(g) };
    if (Mn[p])
      return { isToken: !0, value: g };
    if (p.match(Wa))
      throw new RangeError(
        "Format string contains an unescaped latin alphabet character `" + p + "`"
      );
    return { isToken: !1, value: g };
  });
  i.localize.preprocessor && (u = i.localize.preprocessor(o, u));
  const c = {
    firstWeekContainsDate: s,
    weekStartsOn: a,
    locale: i
  };
  return u.map((g) => {
    if (!g.isToken) return g.value;
    const p = g.value;
    (Pa(p) || ka(p)) && Ta(p, t, String(e));
    const x = Mn[p[0]];
    return x(o, p, i.localize, c);
  }).join("");
}
function ja(e) {
  const t = e.match(Na);
  return t ? t[1].replace(La, "'") : e;
}
var pe = {}, ye = {}, Be = {}, Fn;
function Mr() {
  if (Fn) return Be;
  Fn = 1, Object.defineProperty(Be, "__esModule", { value: !0 }), Be.ExtensionContext = void 0;
  let e = class {
    constructor(r = {}, i = {}) {
      this.extensionId = "", this.serviceRegistry = r, this.componentRegistry = i;
    }
    // Method to get a service by its interface name
    getService(r) {
      console.log("Getting service:", r);
      const i = this.serviceRegistry[r];
      if (!i)
        throw new Error(`Service "${r}" not registered`);
      return i;
    }
    getComponent(r) {
      return this.componentRegistry[r];
    }
    getAllComponents() {
      return this.componentRegistry;
    }
    setExtensionId(r) {
      this.extensionId = r;
    }
    registerAction(r) {
      const i = t.ExtensionBridge.getInstance();
      this.extensionId ? i.registerAction(this.extensionId, r) : console.error("Cannot register action: Extension ID not set");
    }
    unregisterAction(r) {
      t.ExtensionBridge.getInstance().unregisterAction(`${this.extensionId}:${r}`);
    }
    registerCommand(r, i) {
      const s = t.ExtensionBridge.getInstance();
      this.extensionId ? s.registerCommand(`${this.extensionId}.${r}`, i, this.extensionId) : console.error("Cannot register command: Extension ID not set");
    }
    unregisterCommand(r) {
      t.ExtensionBridge.getInstance().unregisterCommand(`${this.extensionId}.${r}`);
    }
  };
  Be.ExtensionContext = e;
  const t = an();
  return Be;
}
var In;
function an() {
  if (In) return ye;
  In = 1;
  var e = ye && ye.__awaiter || function(r, i, s, a) {
    function o(u) {
      return u instanceof s ? u : new s(function(c) {
        c(u);
      });
    }
    return new (s || (s = Promise))(function(u, c) {
      function l(h) {
        try {
          d(a.next(h));
        } catch (g) {
          c(g);
        }
      }
      function f(h) {
        try {
          d(a.throw(h));
        } catch (g) {
          c(g);
        }
      }
      function d(h) {
        h.done ? u(h.value) : o(h.value).then(l, f);
      }
      d((a = a.apply(r, i || [])).next());
    });
  };
  Object.defineProperty(ye, "__esModule", { value: !0 }), ye.ExtensionBridge = void 0;
  const t = Mr();
  let n = class _e {
    constructor() {
      this.extensionManifests = /* @__PURE__ */ new Map(), this.extensionImplementations = /* @__PURE__ */ new Map(), this.serviceRegistry = {}, this.componentRegistry = {}, this.actionRegistry = /* @__PURE__ */ new Map(), this.commandRegistry = /* @__PURE__ */ new Map();
    }
    // Singleton pattern
    static getInstance() {
      return _e.instance || (_e.instance = new _e(), console.log("ExtensionBridge created:", _e.instance)), console.log("ExtensionBridge instance:", _e.instance), _e.instance;
    }
    // Register a service implementation from the base app
    registerService(i, s) {
      this.serviceRegistry[i] = s, console.log(`Registered service: ${i}`);
    }
    // Register a UI component from the base app
    registerComponent(i, s) {
      this.componentRegistry[i] = s, console.log(`Registered component: ${i}`);
    }
    // Get a registered component
    getComponent(i) {
      return this.componentRegistry[i];
    }
    // Get all registered components
    getAllComponents() {
      return this.componentRegistry;
    }
    // Register an action from an extension
    registerAction(i, s) {
      const a = `${i}:${s.id}`;
      this.actionRegistry.set(a, Object.assign(Object.assign({}, s), { id: a, extensionId: i })), console.log(`Registered action: ${a}`);
    }
    // Unregister an action
    unregisterAction(i) {
      this.actionRegistry.delete(i);
    }
    // Get all registered actions
    getActions() {
      return Array.from(this.actionRegistry.values());
    }
    // Register an extension manifest
    registerManifest(i) {
      this.extensionManifests.set(i.id, i), console.log(`Registered extension manifest: ${i.id} (${i.name} v${i.version})`);
    }
    // Register extension implementation
    registerExtensionImplementation(i, s) {
      if (!this.extensionManifests.has(i)) {
        console.error(`Cannot register extension implementation: Manifest for ${i} not found`);
        return;
      }
      this.extensionImplementations.set(i, s), console.log(`Registered extension implementation for: ${i}`);
    }
    // Initialize all registered extensions
    initializeExtensions() {
      return e(this, void 0, void 0, function* () {
        const i = new t.ExtensionContext(this.serviceRegistry);
        for (const [s, a] of this.extensionImplementations.entries()) {
          const o = this.extensionManifests.get(s);
          if (!o) {
            console.error(`Cannot initialize extension: Manifest for ${s} not found`);
            continue;
          }
          console.log(`Initializing extension: ${o.id} (${o.name})`), i.setExtensionId(o.id), yield a.initialize(i);
        }
      });
    }
    // Activate all registered extensions
    activateExtensions() {
      return e(this, void 0, void 0, function* () {
        for (const [i, s] of this.extensionImplementations.entries()) {
          const a = this.extensionManifests.get(i);
          a && (console.log(`Activating extension: ${a.id}`), yield s.activate());
        }
      });
    }
    // Deactivate all registered extensions
    deactivateExtensions() {
      return e(this, void 0, void 0, function* () {
        for (const [i, s] of this.extensionImplementations.entries()) {
          const a = this.extensionManifests.get(i);
          a && (console.log(`Deactivating extension: ${a.id}`), yield s.deactivate());
        }
      });
    }
    // Get all registered extension manifests
    getManifests() {
      return Array.from(this.extensionManifests.values());
    }
    // Get manifest by extension ID
    getManifest(i) {
      return this.extensionManifests.get(i);
    }
    // Get extension implementation by ID
    getExtensionImplementation(i) {
      return this.extensionImplementations.get(i);
    }
    // Register a command from an extension
    registerCommand(i, s, a) {
      this.commandRegistry.set(i, { handler: s, extensionId: a }), console.log(`Registered command: ${i}`);
    }
    // Unregister a command
    unregisterCommand(i) {
      this.commandRegistry.delete(i);
    }
    // Execute a command
    executeCommand(i, s) {
      return e(this, void 0, void 0, function* () {
        const a = this.commandRegistry.get(i);
        if (!a)
          throw new Error(`Command not found: ${i}`);
        return a.handler.execute(s);
      });
    }
    // Get all registered commands
    getCommands() {
      return Array.from(this.commandRegistry.keys());
    }
    // Get commands for a specific extension
    getCommandsForExtension(i) {
      return Array.from(this.commandRegistry.entries()).filter(([s, a]) => a.extensionId === i).map(([s, a]) => s);
    }
  };
  return ye.ExtensionBridge = n, ye;
}
var k = {}, kn;
function Ha() {
  if (kn) return k;
  kn = 1, Object.defineProperty(k, "__esModule", { value: !0 }), k.ConfirmDialog = k.ShortcutRecorder = k.SplitView = k.Toggle = k.Card = k.Input = k.Button = void 0;
  const e = an();
  function t(n) {
    return function(...r) {
      const s = e.ExtensionBridge.getInstance().getComponent(n);
      return s ? s(...r) : (console.error(`Component ${n} is not registered`), null);
    };
  }
  return k.Button = t("Button"), k.Input = t("Input"), k.Card = t("Card"), k.Toggle = t("Toggle"), k.SplitView = t("SplitView"), k.ShortcutRecorder = t("ShortcutRecorder"), k.ConfirmDialog = t("ConfirmDialog"), k;
}
var we = {}, Ot = {}, Pn;
function Ya() {
  return Pn || (Pn = 1, Object.defineProperty(Ot, "__esModule", { value: !0 })), Ot;
}
var Ft = {}, Tn;
function qa() {
  return Tn || (Tn = 1, Object.defineProperty(Ft, "__esModule", { value: !0 })), Ft;
}
var Re = {}, Bn;
function Va() {
  if (Bn) return Re;
  Bn = 1, Object.defineProperty(Re, "__esModule", { value: !0 }), Re.ClipboardItemType = void 0;
  var e;
  return function(t) {
    t.Text = "text", t.Html = "html", t.Image = "image";
  }(e || (Re.ClipboardItemType = e = {})), Re;
}
var $e = {}, Rn;
function Sr() {
  if (Rn) return $e;
  Rn = 1, Object.defineProperty($e, "__esModule", { value: !0 }), $e.ActionContext = void 0;
  var e;
  return function(t) {
    t.GLOBAL = "global", t.EXTENSION_VIEW = "extension_view", t.SEARCH_VIEW = "search_view", t.RESULT = "result", t.CORE = "core", t.COMMAND_RESULT = "command_result";
  }(e || ($e.ActionContext = e = {})), $e;
}
var It = {}, $n;
function za() {
  return $n || ($n = 1, Object.defineProperty(It, "__esModule", { value: !0 })), It;
}
var Nn;
function Ln() {
  return Nn || (Nn = 1, function(e) {
    var t = we && we.__createBinding || (Object.create ? function(r, i, s, a) {
      a === void 0 && (a = s);
      var o = Object.getOwnPropertyDescriptor(i, s);
      (!o || ("get" in o ? !i.__esModule : o.writable || o.configurable)) && (o = { enumerable: !0, get: function() {
        return i[s];
      } }), Object.defineProperty(r, a, o);
    } : function(r, i, s, a) {
      a === void 0 && (a = s), r[a] = i[s];
    }), n = we && we.__exportStar || function(r, i) {
      for (var s in r) s !== "default" && !Object.prototype.hasOwnProperty.call(i, s) && t(i, r, s);
    };
    Object.defineProperty(e, "__esModule", { value: !0 }), n(Ya(), e), n(qa(), e), n(Va(), e), n(Sr(), e), n(za(), e);
  }(we)), we;
}
var Wn;
function Qa() {
  return Wn || (Wn = 1, function(e) {
    var t = pe && pe.__createBinding || (Object.create ? function(o, u, c, l) {
      l === void 0 && (l = c);
      var f = Object.getOwnPropertyDescriptor(u, c);
      (!f || ("get" in f ? !u.__esModule : f.writable || f.configurable)) && (f = { enumerable: !0, get: function() {
        return u[c];
      } }), Object.defineProperty(o, l, f);
    } : function(o, u, c, l) {
      l === void 0 && (l = c), o[l] = u[c];
    }), n = pe && pe.__exportStar || function(o, u) {
      for (var c in o) c !== "default" && !Object.prototype.hasOwnProperty.call(u, c) && t(u, o, c);
    };
    Object.defineProperty(e, "__esModule", { value: !0 }), e.ActionContext = e.ClipboardItemType = e.ExtensionContext = e.ExtensionBridge = void 0;
    var r = an();
    Object.defineProperty(e, "ExtensionBridge", { enumerable: !0, get: function() {
      return r.ExtensionBridge;
    } });
    var i = Mr();
    Object.defineProperty(e, "ExtensionContext", { enumerable: !0, get: function() {
      return i.ExtensionContext;
    } }), n(Ha(), e);
    var s = Ln();
    Object.defineProperty(e, "ClipboardItemType", { enumerable: !0, get: function() {
      return s.ClipboardItemType;
    } });
    var a = Sr();
    Object.defineProperty(e, "ActionContext", { enumerable: !0, get: function() {
      return a.ActionContext;
    } }), n(Ln(), e);
  }(pe)), pe;
}
var Ga = Qa(), Ua = /* @__PURE__ */ qe('<div><div class="flex items-center gap-2 mb-1.5"><span class="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--bg-selected)]"><span class="result-title"> </span></span> <span class="result-subtitle text-xs"> </span></div> <div class="result-title text-sm line-clamp-2"><!></div></div>'), Xa = /* @__PURE__ */ qe('<div slot="left" class="h-full overflow-y-auto focus:outline-none scroll-smooth svelte-11oc8zj" tabindex="0"><div class="divide-y divide-[var(--border-color)]"></div></div>'), Ka = /* @__PURE__ */ qe('<div class="bg-[var(--bg-selected)] border-b border-[var(--border-color)] p-4 shadow-sm"><div class="flex justify-between items-center"><div class="flex items-center gap-3"><span class="text-sm font-medium px-3 py-1 rounded-full bg-[var(--bg-primary)]"><span class="result-title"> </span></span> <span class="result-subtitle text-sm"> </span></div></div></div> <div class="flex-1 overflow-y-auto p-6 custom-scrollbar svelte-11oc8zj"><div class="result-title prose max-w-none"><!></div></div>', 1), Ja = /* @__PURE__ */ qe('<div class="flex h-full items-center justify-center flex-col gap-4"><svg class="w-16 h-16 opacity-30 result-subtitle" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg> <span class="result-title text-lg font-medium">Select an item to view details</span></div>'), Za = /* @__PURE__ */ qe('<div slot="right" class="h-full flex flex-col overflow-hidden"><!></div>');
function oo(e, t) {
  hs(t, !1);
  const [n, r] = Bs(), i = () => Ts(j, "$clipboardViewState", n), s = /* @__PURE__ */ te(), a = /* @__PURE__ */ te(), o = /* @__PURE__ */ te(), u = /* @__PURE__ */ te(), c = /* @__PURE__ */ te(), l = /* @__PURE__ */ te();
  let f = /* @__PURE__ */ te(), d = !1;
  Pr(async () => {
    d = !0, window.addEventListener("keydown", h);
  });
  function h(v) {
    !d || !b(s).length || (v.key === "ArrowUp" || v.key === "ArrowDown" ? (v.preventDefault(), v.stopPropagation(), j.moveSelection(v.key === "ArrowUp" ? "up" : "down"), g()) : v.key === "Enter" && b(a) && (v.preventDefault(), v.stopPropagation(), j.handleItemAction(b(a), "paste")));
  }
  function g() {
    requestAnimationFrame(() => {
      var C;
      const v = (C = b(f)) == null ? void 0 : C.querySelector(`[data-index="${b(o)}"]`);
      if (v) {
        const w = b(f).getBoundingClientRect(), F = v.getBoundingClientRect(), I = F.top < w.top, M = F.bottom > w.bottom;
        (I || M) && v.scrollIntoView({
          block: I ? "start" : "end",
          behavior: "smooth"
        });
      }
    });
  }
  function p(v) {
    j.setSelectedItem(v);
  }
  Tr(() => {
    window.removeEventListener("keydown", h), d = !1;
  });
  function x(v) {
    if (i().searchQuery && "score" in v) {
      const C = typeof v.score == "number" ? v.score : 0;
      return `Match: ${Math.round((1 - C) * 100)}% · ${Dt(v.createdAt, "HH:mm")}`;
    }
    return Dt(v.createdAt, "HH:mm");
  }
  function y(v, C = !1) {
    if (!v || !v.content)
      return '<span class="text-gray-400">No preview available</span>';
    switch (v.type) {
      case "image":
        let w = v.content;
        return w = w.replace("data:image/png;base64, ", "data:image/png;base64,"), w.startsWith("data:") || (w = `data:image/png;base64,${w}`), w.includes("AAAAAAAA") ? '<div class="flex items-center justify-center p-4 bg-gray-100 rounded"><svg class="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>' : C ? `<div class="image-container w-full flex items-center justify-center">
            <img 
              src="${w}" 
              class="max-w-full max-h-[70vh] object-contain border border-[var(--border-color)] rounded" 
              alt="Clipboard image ${new Date(v.createdAt).toLocaleString()}"
              onerror="this.onerror=null; this.style.display='none'; this.parentNode.innerHTML='<div class=\\'flex p-8 items-center justify-center bg-gray-100 rounded\\'><div class=\\'text-center\\'><svg class=\\'mx-auto w-16 h-16 text-gray-400 mb-4\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\' /></svg><div class=\\'text-gray-500\\'>Failed to load image</div></div></div>'; console.error('Full image failed to load:', '${v.id}');"
            />
          </div>` : `<div class="w-16 h-16 flex items-center justify-center overflow-hidden bg-gray-50 rounded">
            <img 
              src="${w}" 
              class="max-w-full max-h-full object-cover" 
              alt="Thumbnail"
              onerror="this.onerror=null; this.style.display='none'; this.parentNode.innerHTML='<svg class=\\'w-8 h-8 text-gray-400\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\' /></svg>'; console.error('Thumbnail failed to load:', '${v.id}');"
            />
          </div>`;
      case "text":
        const F = C ? v.content : v.content.substring(0, 100) + (v.content.length > 100 ? "..." : "");
        return C ? `<pre class="whitespace-pre-wrap break-words">${F}</pre>` : F;
      case "html":
        return C ? `<pre class="whitespace-pre-wrap break-words text-sm font-mono">${v.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>` : '<div class="text-xs italic">[HTML Content]</div>';
      default:
        return `[${v.type} content]`;
    }
  }
  Ce(() => (i(), j), () => {
    P(s, i().filtered ? j.search(i().items, i().searchQuery) : i().items);
  }), Ce(() => i(), () => {
    P(a, i().selectedItem);
  }), Ce(() => i(), () => {
    P(o, i().selectedIndex);
  }), Ce(() => i(), () => {
    P(u, i().isLoading);
  }), Ce(() => i(), () => {
    P(c, i().loadError);
  }), Ce(() => i(), () => {
    P(l, i().errorMessage);
  }), es(), ks(), Ga.SplitView(e, {
    leftWidth: 300,
    minLeftWidth: 200,
    maxLeftWidth: 600,
    $$slots: {
      left: (v, C) => {
        var w = Xa(), F = T(w);
        bs(F, 7, () => b(s), (I) => I.id, (I, M, S) => {
          var D = Ua();
          let U;
          var se = T(D), z = T(se), Ie = T(z), B = T(Ie), ae = Qe(z, 2), Ae = T(ae), wt = Qe(se, 2), bt = T(wt);
          yn(bt, () => y(b(M))), Ht(
            (_t, xt) => {
              Ds(D, "data-index", b(S)), U = Cs(D, 1, "result-item relative", null, U, _t), Ge(B, b(M).type), Ge(Ae, xt);
            },
            [
              () => ({
                "selected-result": b(o) === b(S)
              }),
              () => x(b(M))
            ],
            jt
          ), Mt("click", D, () => p(b(S))), Mt("dblclick", D, () => j.handleItemAction(b(M), "paste")), ke(I, D);
        }), Is(w, (I) => P(f, I), () => b(f)), Mt("keydown", w, h), ke(v, w);
      },
      right: (v, C) => {
        var w = Za(), F = T(w);
        {
          var I = (S) => {
            var D = Ka(), U = Gi(D), se = T(U), z = T(se), Ie = T(z), B = T(Ie), ae = T(B), Ae = Qe(Ie, 2), wt = T(Ae), bt = Qe(U, 2), _t = T(bt), xt = T(_t);
            yn(xt, () => y(b(a), !0)), Ht(
              (Dr) => {
                Ge(ae, b(a).type), Ge(wt, Dr);
              },
              [
                () => Dt(b(a).createdAt, "PPpp")
              ],
              jt
            ), ke(S, D);
          }, M = (S) => {
            var D = Ja();
            ke(S, D);
          };
          ys(F, (S) => {
            b(a) ? S(I) : S(M, !1);
          });
        }
        ke(v, w);
      }
    }
  }), gs(), r();
}
const eo = [
  {
    id: "clipboard-history",
    title: "Clipboard History",
    subtitle: "View and manage your clipboard history",
    keywords: "clipboard copy paste history"
  }
], to = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["title", "subtitle", "keywords"]
};
new J(eo, to);
class no {
  constructor() {
    oe(this, "onUnload");
    oe(this, "logService");
    oe(this, "extensionManager");
    oe(this, "clipboardService");
    oe(this, "actionService");
    oe(this, "inView", !1);
    oe(this, "context");
  }
  async initialize(t) {
    var n, r;
    try {
      if (this.context = t, this.logService = t.getService("LogService"), this.extensionManager = t.getService("ExtensionManager"), this.clipboardService = t.getService(
        "ClipboardHistoryService"
      ), this.actionService = t.getService("ActionService"), !this.logService || !this.extensionManager || !this.clipboardService || !this.actionService) {
        console.error(
          "Failed to initialize required services for Clipboard History"
        ), (n = this.logService) == null || n.error(
          "Failed to initialize required services for Clipboard History"
        );
        return;
      }
      j.initializeServices(t), this.logService.info(
        "Clipboard History extension initialized with services"
      );
    } catch (i) {
      console.error("Clipboard History initialization failed:", i), (r = this.logService) == null || r.error(
        `Clipboard History initialization failed: ${i}`
      );
    }
  }
  async executeCommand(t, n) {
    var r, i, s;
    switch ((r = this.logService) == null || r.info(`Executing clipboard command: ${t}`), t) {
      case "show-clipboard":
        return await this.refreshClipboardData(), (i = this.extensionManager) == null || i.navigateToView(
          "clipboard-history/ClipboardHistory"
        ), this.registerViewActions(), {
          type: "view",
          viewPath: "clipboard-history/ClipboardHistory"
        };
      default:
        throw (s = this.logService) == null || s.error(`Received unknown command ID: ${t}`), new Error(`Unknown command: ${t}`);
    }
  }
  // Called when this extension's view is activated
  async viewActivated(t) {
    var n, r;
    this.inView = !0, (n = this.logService) == null || n.debug(`Clipboard History view activated: ${t}`), (r = this.extensionManager) == null || r.setActiveViewActionLabel("Paste"), await this.refreshClipboardData();
  }
  // Helper method to register view-specific actions
  registerViewActions() {
    var n, r;
    if (!this.actionService || !this.clipboardService) {
      (n = this.logService) == null || n.warn(
        "ActionService or ClipboardService not available, cannot register view actions."
      );
      return;
    }
    (r = this.logService) == null || r.debug("Registering clipboard view actions...");
    const t = {
      id: "clipboard-reset-history",
      title: "Clear Clipboard History",
      description: "Remove all non-favorite clipboard items",
      icon: "🗑️",
      extensionId: "clipboard-history",
      category: "clipboard-action",
      // Context is implicitly EXTENSION_VIEW when registered
      execute: async () => {
        var i, s, a, o;
        try {
          confirm(
            "Are you sure you want to clear all non-favorite clipboard items?"
          ) && (await ((i = this.clipboardService) == null ? void 0 : i.clearNonFavorites()) ? (s = this.logService) == null || s.info("Non-favorite clipboard history cleared") : (a = this.logService) == null || a.warn(
            "Clearing non-favorite clipboard history reported failure."
          ), await this.refreshClipboardData());
        } catch (u) {
          (o = this.logService) == null || o.error(`Failed to clear clipboard history: ${u}`);
        }
      }
    };
    this.actionService.registerAction(t);
  }
  // Helper method to unregister view-specific actions
  unregisterViewActions() {
    var t, n;
    if (!this.actionService) {
      (t = this.logService) == null || t.warn(
        "ActionService not available, cannot unregister view actions."
      );
      return;
    }
    (n = this.logService) == null || n.debug("Unregistering clipboard view actions..."), this.actionService.unregisterAction("clipboard-reset-history");
  }
  // Called when this extension's view is deactivated
  async viewDeactivated(t) {
    var n, r;
    this.unregisterViewActions(), (n = this.extensionManager) == null || n.setActiveViewActionLabel(null), this.inView = !1, (r = this.logService) == null || r.debug(`Clipboard History view deactivated: ${t}`);
  }
  async onViewSearch(t) {
    j.setSearch(t);
  }
  async refreshClipboardData() {
    var t, n;
    if (this.clipboardService) {
      j.setLoading(!0);
      try {
        const r = await this.clipboardService.getRecentItems(100);
        j.setItems(r || []);
      } catch (r) {
        (t = this.logService) == null || t.error(`Failed to load clipboard data: ${r}`), j.setError(`Failed to load clipboard data: ${r}`);
      } finally {
        j.setLoading(!1);
      }
    } else
      (n = this.logService) == null || n.warn(
        "ClipboardService not available in refreshClipboardData"
      );
  }
  async activate() {
    var t;
    (t = this.logService) == null || t.info("Clipboard History extension activated");
  }
  async deactivate() {
    var t;
    this.inView && this.unregisterViewActions(), (t = this.logService) == null || t.info("Clipboard History extension deactivated");
  }
}
const uo = new no();
export {
  oo as ClipboardHistory,
  uo as default
};
