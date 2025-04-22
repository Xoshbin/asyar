var Ae = Object.defineProperty;
var Ce = (s, e, t) => e in s ? Ae(s, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : s[e] = t;
var B = (s, e, t) => Ce(s, typeof e != "symbol" ? e + "" : e, t);
const P = () => {
};
function be(s, e) {
  return s != s ? e == e : s !== e || s !== null && typeof s == "object" || typeof s == "function";
}
let K = !1;
function ye(s) {
  var e = K;
  try {
    return K = !0, s();
  } finally {
    K = e;
  }
}
function Ee(s, e, t) {
  if (s == null)
    return e(void 0), P;
  const r = ye(
    () => s.subscribe(
      e,
      // @ts-expect-error
      t
    )
  );
  return r.unsubscribe ? () => r.unsubscribe() : r;
}
const R = [];
function me(s, e = P) {
  let t = null;
  const r = /* @__PURE__ */ new Set();
  function i(c) {
    if (be(s, c) && (s = c, t)) {
      const a = !R.length;
      for (const u of r)
        u[1](), R.push(u, s);
      if (a) {
        for (let u = 0; u < R.length; u += 2)
          R[u][0](R[u + 1]);
        R.length = 0;
      }
    }
  }
  function o(c) {
    i(c(
      /** @type {T} */
      s
    ));
  }
  function n(c, a = P) {
    const u = [c, a];
    return r.add(u), r.size === 1 && (t = e(i, o) || P), c(
      /** @type {T} */
      s
    ), () => {
      r.delete(u), r.size === 0 && t && (t(), t = null);
    };
  }
  return { set: i, update: o, subscribe: n };
}
function Fe(s) {
  let e;
  return Ee(s, (t) => e = t)(), e;
}
function v(s) {
  return Array.isArray ? Array.isArray(s) : ue(s) === "[object Array]";
}
function we(s) {
  if (typeof s == "string")
    return s;
  let e = s + "";
  return e == "0" && 1 / s == -1 / 0 ? "-0" : e;
}
function ve(s) {
  return s == null ? "" : we(s);
}
function m(s) {
  return typeof s == "string";
}
function ce(s) {
  return typeof s == "number";
}
function Se(s) {
  return s === !0 || s === !1 || Me(s) && ue(s) == "[object Boolean]";
}
function oe(s) {
  return typeof s == "object";
}
function Me(s) {
  return oe(s) && s !== null;
}
function C(s) {
  return s != null;
}
function W(s) {
  return !s.trim().length;
}
function ue(s) {
  return s == null ? s === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(s);
}
const De = "Incorrect 'index' type", Be = (s) => `Invalid value for key ${s}`, Ie = (s) => `Pattern length exceeds max of ${s}.`, xe = (s) => `Missing ${s} property in key`, _e = (s) => `Property 'weight' in key '${s}' must be a positive integer`, te = Object.prototype.hasOwnProperty;
class $e {
  constructor(e) {
    this._keys = [], this._keyMap = {};
    let t = 0;
    e.forEach((r) => {
      let i = ae(r);
      this._keys.push(i), this._keyMap[i.id] = i, t += i.weight;
    }), this._keys.forEach((r) => {
      r.weight /= t;
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
function ae(s) {
  let e = null, t = null, r = null, i = 1, o = null;
  if (m(s) || v(s))
    r = s, e = se(s), t = Q(s);
  else {
    if (!te.call(s, "name"))
      throw new Error(xe("name"));
    const n = s.name;
    if (r = n, te.call(s, "weight") && (i = s.weight, i <= 0))
      throw new Error(_e(n));
    e = se(n), t = Q(n), o = s.getFn;
  }
  return { path: e, id: t, weight: i, src: r, getFn: o };
}
function se(s) {
  return v(s) ? s : s.split(".");
}
function Q(s) {
  return v(s) ? s.join(".") : s;
}
function Le(s, e) {
  let t = [], r = !1;
  const i = (o, n, c) => {
    if (C(o))
      if (!n[c])
        t.push(o);
      else {
        let a = n[c];
        const u = o[a];
        if (!C(u))
          return;
        if (c === n.length - 1 && (m(u) || ce(u) || Se(u)))
          t.push(ve(u));
        else if (v(u)) {
          r = !0;
          for (let l = 0, d = u.length; l < d; l += 1)
            i(u[l], n, c + 1);
        } else n.length && i(u, n, c + 1);
      }
  };
  return i(s, m(e) ? e.split(".") : e, 0), r ? t : t[0];
}
const Re = {
  // Whether the matches should be included in the result set. When `true`, each record in the result
  // set will include the indices of the matched characters.
  // These can consequently be used for highlighting purposes.
  includeMatches: !1,
  // When `true`, the matching function will continue to the end of a search pattern even if
  // a perfect match has already been located in the string.
  findAllMatches: !1,
  // Minimum number of characters that must be matched before a result is considered a match
  minMatchCharLength: 1
}, ke = {
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
  sortFn: (s, e) => s.score === e.score ? s.idx < e.idx ? -1 : 1 : s.score < e.score ? -1 : 1
}, Oe = {
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
}, Ne = {
  // When `true`, it enables the use of unix-like search commands
  useExtendedSearch: !1,
  // The get function to use when fetching an object's properties.
  // The default will search nested paths *ie foo.bar.baz*
  getFn: Le,
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
  ...ke,
  ...Re,
  ...Oe,
  ...Ne
};
const He = /[^ ]+/g;
function Pe(s = 1, e = 3) {
  const t = /* @__PURE__ */ new Map(), r = Math.pow(10, e);
  return {
    get(i) {
      const o = i.match(He).length;
      if (t.has(o))
        return t.get(o);
      const n = 1 / Math.pow(o, 0.5 * s), c = parseFloat(Math.round(n * r) / r);
      return t.set(o, c), c;
    },
    clear() {
      t.clear();
    }
  };
}
class Z {
  constructor({
    getFn: e = h.getFn,
    fieldNormWeight: t = h.fieldNormWeight
  } = {}) {
    this.norm = Pe(t, 3), this.getFn = e, this.isCreated = !1, this.setIndexRecords();
  }
  setSources(e = []) {
    this.docs = e;
  }
  setIndexRecords(e = []) {
    this.records = e;
  }
  setKeys(e = []) {
    this.keys = e, this._keysMap = {}, e.forEach((t, r) => {
      this._keysMap[t.id] = r;
    });
  }
  create() {
    this.isCreated || !this.docs.length || (this.isCreated = !0, m(this.docs[0]) ? this.docs.forEach((e, t) => {
      this._addString(e, t);
    }) : this.docs.forEach((e, t) => {
      this._addObject(e, t);
    }), this.norm.clear());
  }
  // Adds a doc to the end of the index
  add(e) {
    const t = this.size();
    m(e) ? this._addString(e, t) : this._addObject(e, t);
  }
  // Removes the doc at the specified index of the index
  removeAt(e) {
    this.records.splice(e, 1);
    for (let t = e, r = this.size(); t < r; t += 1)
      this.records[t].i -= 1;
  }
  getValueForItemAtKeyId(e, t) {
    return e[this._keysMap[t]];
  }
  size() {
    return this.records.length;
  }
  _addString(e, t) {
    if (!C(e) || W(e))
      return;
    let r = {
      v: e,
      i: t,
      n: this.norm.get(e)
    };
    this.records.push(r);
  }
  _addObject(e, t) {
    let r = { i: t, $: {} };
    this.keys.forEach((i, o) => {
      let n = i.getFn ? i.getFn(e) : this.getFn(e, i.path);
      if (C(n)) {
        if (v(n)) {
          let c = [];
          const a = [{ nestedArrIndex: -1, value: n }];
          for (; a.length; ) {
            const { nestedArrIndex: u, value: l } = a.pop();
            if (C(l))
              if (m(l) && !W(l)) {
                let d = {
                  v: l,
                  i: u,
                  n: this.norm.get(l)
                };
                c.push(d);
              } else v(l) && l.forEach((d, g) => {
                a.push({
                  nestedArrIndex: g,
                  value: d
                });
              });
          }
          r.$[o] = c;
        } else if (m(n) && !W(n)) {
          let c = {
            v: n,
            n: this.norm.get(n)
          };
          r.$[o] = c;
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
function le(s, e, { getFn: t = h.getFn, fieldNormWeight: r = h.fieldNormWeight } = {}) {
  const i = new Z({ getFn: t, fieldNormWeight: r });
  return i.setKeys(s.map(ae)), i.setSources(e), i.create(), i;
}
function Te(s, { getFn: e = h.getFn, fieldNormWeight: t = h.fieldNormWeight } = {}) {
  const { keys: r, records: i } = s, o = new Z({ getFn: e, fieldNormWeight: t });
  return o.setKeys(r), o.setIndexRecords(i), o;
}
function N(s, {
  errors: e = 0,
  currentLocation: t = 0,
  expectedLocation: r = 0,
  distance: i = h.distance,
  ignoreLocation: o = h.ignoreLocation
} = {}) {
  const n = e / s.length;
  if (o)
    return n;
  const c = Math.abs(r - t);
  return i ? n + c / i : c ? 1 : n;
}
function ze(s = [], e = h.minMatchCharLength) {
  let t = [], r = -1, i = -1, o = 0;
  for (let n = s.length; o < n; o += 1) {
    let c = s[o];
    c && r === -1 ? r = o : !c && r !== -1 && (i = o - 1, i - r + 1 >= e && t.push([r, i]), r = -1);
  }
  return s[o - 1] && o - r >= e && t.push([r, o - 1]), t;
}
const _ = 32;
function Ve(s, e, t, {
  location: r = h.location,
  distance: i = h.distance,
  threshold: o = h.threshold,
  findAllMatches: n = h.findAllMatches,
  minMatchCharLength: c = h.minMatchCharLength,
  includeMatches: a = h.includeMatches,
  ignoreLocation: u = h.ignoreLocation
} = {}) {
  if (e.length > _)
    throw new Error(Ie(_));
  const l = e.length, d = s.length, g = Math.max(0, Math.min(r, d));
  let f = o, p = g;
  const A = c > 1 || a, y = A ? Array(d) : [];
  let S;
  for (; (S = s.indexOf(e, p)) > -1; ) {
    let b = N(e, {
      currentLocation: S,
      expectedLocation: g,
      distance: i,
      ignoreLocation: u
    });
    if (f = Math.min(b, f), p = S + l, A) {
      let M = 0;
      for (; M < l; )
        y[S + M] = 1, M += 1;
    }
  }
  p = -1;
  let w = [], $ = 1, x = l + d;
  const pe = 1 << l - 1;
  for (let b = 0; b < l; b += 1) {
    let M = 0, D = x;
    for (; M < D; )
      N(e, {
        errors: b,
        currentLocation: g + D,
        expectedLocation: g,
        distance: i,
        ignoreLocation: u
      }) <= f ? M = D : x = D, D = Math.floor((x - M) / 2 + M);
    x = D;
    let q = Math.max(1, g - D + 1), j = n ? d : Math.min(g + D, d) + l, L = Array(j + 2);
    L[j + 1] = (1 << b) - 1;
    for (let E = j; E >= q; E -= 1) {
      let O = E - 1, ee = t[s.charAt(O)];
      if (A && (y[O] = +!!ee), L[E] = (L[E + 1] << 1 | 1) & ee, b && (L[E] |= (w[E + 1] | w[E]) << 1 | 1 | w[E + 1]), L[E] & pe && ($ = N(e, {
        errors: b,
        currentLocation: O,
        expectedLocation: g,
        distance: i,
        ignoreLocation: u
      }), $ <= f)) {
        if (f = $, p = O, p <= g)
          break;
        q = Math.max(1, 2 * g - p);
      }
    }
    if (N(e, {
      errors: b + 1,
      currentLocation: g,
      expectedLocation: g,
      distance: i,
      ignoreLocation: u
    }) > f)
      break;
    w = L;
  }
  const V = {
    isMatch: p >= 0,
    // Count exact matches (those with a score of 0) to be "almost" exact
    score: Math.max(1e-3, $)
  };
  if (A) {
    const b = ze(y, c);
    b.length ? a && (V.indices = b) : V.isMatch = !1;
  }
  return V;
}
function je(s) {
  let e = {};
  for (let t = 0, r = s.length; t < r; t += 1) {
    const i = s.charAt(t);
    e[i] = (e[i] || 0) | 1 << r - t - 1;
  }
  return e;
}
const T = String.prototype.normalize ? (s) => s.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "") : (s) => s;
class he {
  constructor(e, {
    location: t = h.location,
    threshold: r = h.threshold,
    distance: i = h.distance,
    includeMatches: o = h.includeMatches,
    findAllMatches: n = h.findAllMatches,
    minMatchCharLength: c = h.minMatchCharLength,
    isCaseSensitive: a = h.isCaseSensitive,
    ignoreDiacritics: u = h.ignoreDiacritics,
    ignoreLocation: l = h.ignoreLocation
  } = {}) {
    if (this.options = {
      location: t,
      threshold: r,
      distance: i,
      includeMatches: o,
      findAllMatches: n,
      minMatchCharLength: c,
      isCaseSensitive: a,
      ignoreDiacritics: u,
      ignoreLocation: l
    }, e = a ? e : e.toLowerCase(), e = u ? T(e) : e, this.pattern = e, this.chunks = [], !this.pattern.length)
      return;
    const d = (f, p) => {
      this.chunks.push({
        pattern: f,
        alphabet: je(f),
        startIndex: p
      });
    }, g = this.pattern.length;
    if (g > _) {
      let f = 0;
      const p = g % _, A = g - p;
      for (; f < A; )
        d(this.pattern.substr(f, _), f), f += _;
      if (p) {
        const y = g - _;
        d(this.pattern.substr(y), y);
      }
    } else
      d(this.pattern, 0);
  }
  searchIn(e) {
    const { isCaseSensitive: t, ignoreDiacritics: r, includeMatches: i } = this.options;
    if (e = t ? e : e.toLowerCase(), e = r ? T(e) : e, this.pattern === e) {
      let A = {
        isMatch: !0,
        score: 0
      };
      return i && (A.indices = [[0, e.length - 1]]), A;
    }
    const {
      location: o,
      distance: n,
      threshold: c,
      findAllMatches: a,
      minMatchCharLength: u,
      ignoreLocation: l
    } = this.options;
    let d = [], g = 0, f = !1;
    this.chunks.forEach(({ pattern: A, alphabet: y, startIndex: S }) => {
      const { isMatch: w, score: $, indices: x } = Ve(e, A, y, {
        location: o + S,
        distance: n,
        threshold: c,
        findAllMatches: a,
        minMatchCharLength: u,
        includeMatches: i,
        ignoreLocation: l
      });
      w && (f = !0), g += $, w && x && (d = [...d, ...x]);
    });
    let p = {
      isMatch: f,
      score: f ? g / this.chunks.length : 1
    };
    return f && i && (p.indices = d), p;
  }
}
class I {
  constructor(e) {
    this.pattern = e;
  }
  static isMultiMatch(e) {
    return re(e, this.multiRegex);
  }
  static isSingleMatch(e) {
    return re(e, this.singleRegex);
  }
  search() {
  }
}
function re(s, e) {
  const t = s.match(e);
  return t ? t[1] : null;
}
class Ke extends I {
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
class We extends I {
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
    const r = e.indexOf(this.pattern) === -1;
    return {
      isMatch: r,
      score: r ? 0 : 1,
      indices: [0, e.length - 1]
    };
  }
}
class Qe extends I {
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
class Ge extends I {
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
class Ue extends I {
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
class Ye extends I {
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
class de extends I {
  constructor(e, {
    location: t = h.location,
    threshold: r = h.threshold,
    distance: i = h.distance,
    includeMatches: o = h.includeMatches,
    findAllMatches: n = h.findAllMatches,
    minMatchCharLength: c = h.minMatchCharLength,
    isCaseSensitive: a = h.isCaseSensitive,
    ignoreDiacritics: u = h.ignoreDiacritics,
    ignoreLocation: l = h.ignoreLocation
  } = {}) {
    super(e), this._bitapSearch = new he(e, {
      location: t,
      threshold: r,
      distance: i,
      includeMatches: o,
      findAllMatches: n,
      minMatchCharLength: c,
      isCaseSensitive: a,
      ignoreDiacritics: u,
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
class fe extends I {
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
    let t = 0, r;
    const i = [], o = this.pattern.length;
    for (; (r = e.indexOf(this.pattern, t)) > -1; )
      t = r + o, i.push([r, t - 1]);
    const n = !!i.length;
    return {
      isMatch: n,
      score: n ? 0 : 1,
      indices: i
    };
  }
}
const G = [
  Ke,
  fe,
  Qe,
  Ge,
  Ye,
  Ue,
  We,
  de
], ie = G.length, Je = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/, Xe = "|";
function Ze(s, e = {}) {
  return s.split(Xe).map((t) => {
    let r = t.trim().split(Je).filter((o) => o && !!o.trim()), i = [];
    for (let o = 0, n = r.length; o < n; o += 1) {
      const c = r[o];
      let a = !1, u = -1;
      for (; !a && ++u < ie; ) {
        const l = G[u];
        let d = l.isMultiMatch(c);
        d && (i.push(new l(d, e)), a = !0);
      }
      if (!a)
        for (u = -1; ++u < ie; ) {
          const l = G[u];
          let d = l.isSingleMatch(c);
          if (d) {
            i.push(new l(d, e));
            break;
          }
        }
    }
    return i;
  });
}
const qe = /* @__PURE__ */ new Set([de.type, fe.type]);
class et {
  constructor(e, {
    isCaseSensitive: t = h.isCaseSensitive,
    ignoreDiacritics: r = h.ignoreDiacritics,
    includeMatches: i = h.includeMatches,
    minMatchCharLength: o = h.minMatchCharLength,
    ignoreLocation: n = h.ignoreLocation,
    findAllMatches: c = h.findAllMatches,
    location: a = h.location,
    threshold: u = h.threshold,
    distance: l = h.distance
  } = {}) {
    this.query = null, this.options = {
      isCaseSensitive: t,
      ignoreDiacritics: r,
      includeMatches: i,
      minMatchCharLength: o,
      findAllMatches: c,
      ignoreLocation: n,
      location: a,
      threshold: u,
      distance: l
    }, e = t ? e : e.toLowerCase(), e = r ? T(e) : e, this.pattern = e, this.query = Ze(this.pattern, this.options);
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
    const { includeMatches: r, isCaseSensitive: i, ignoreDiacritics: o } = this.options;
    e = i ? e : e.toLowerCase(), e = o ? T(e) : e;
    let n = 0, c = [], a = 0;
    for (let u = 0, l = t.length; u < l; u += 1) {
      const d = t[u];
      c.length = 0, n = 0;
      for (let g = 0, f = d.length; g < f; g += 1) {
        const p = d[g], { isMatch: A, indices: y, score: S } = p.search(e);
        if (A) {
          if (n += 1, a += S, r) {
            const w = p.constructor.type;
            qe.has(w) ? c = [...c, ...y] : c.push(y);
          }
        } else {
          a = 0, n = 0, c.length = 0;
          break;
        }
      }
      if (n) {
        let g = {
          isMatch: !0,
          score: a / n
        };
        return r && (g.indices = c), g;
      }
    }
    return {
      isMatch: !1,
      score: 1
    };
  }
}
const U = [];
function tt(...s) {
  U.push(...s);
}
function Y(s, e) {
  for (let t = 0, r = U.length; t < r; t += 1) {
    let i = U[t];
    if (i.condition(s, e))
      return new i(s, e);
  }
  return new he(s, e);
}
const z = {
  AND: "$and",
  OR: "$or"
}, J = {
  PATH: "$path",
  PATTERN: "$val"
}, X = (s) => !!(s[z.AND] || s[z.OR]), st = (s) => !!s[J.PATH], rt = (s) => !v(s) && oe(s) && !X(s), ne = (s) => ({
  [z.AND]: Object.keys(s).map((e) => ({
    [e]: s[e]
  }))
});
function ge(s, e, { auto: t = !0 } = {}) {
  const r = (i) => {
    let o = Object.keys(i);
    const n = st(i);
    if (!n && o.length > 1 && !X(i))
      return r(ne(i));
    if (rt(i)) {
      const a = n ? i[J.PATH] : o[0], u = n ? i[J.PATTERN] : i[a];
      if (!m(u))
        throw new Error(Be(a));
      const l = {
        keyId: Q(a),
        pattern: u
      };
      return t && (l.searcher = Y(u, e)), l;
    }
    let c = {
      children: [],
      operator: o[0]
    };
    return o.forEach((a) => {
      const u = i[a];
      v(u) && u.forEach((l) => {
        c.children.push(r(l));
      });
    }), c;
  };
  return X(s) || (s = ne(s)), r(s);
}
function it(s, { ignoreFieldNorm: e = h.ignoreFieldNorm }) {
  s.forEach((t) => {
    let r = 1;
    t.matches.forEach(({ key: i, norm: o, score: n }) => {
      const c = i ? i.weight : null;
      r *= Math.pow(
        n === 0 && c ? Number.EPSILON : n,
        (c || 1) * (e ? 1 : o)
      );
    }), t.score = r;
  });
}
function nt(s, e) {
  const t = s.matches;
  e.matches = [], C(t) && t.forEach((r) => {
    if (!C(r.indices) || !r.indices.length)
      return;
    const { indices: i, value: o } = r;
    let n = {
      indices: i,
      value: o
    };
    r.key && (n.key = r.key.src), r.idx > -1 && (n.refIndex = r.idx), e.matches.push(n);
  });
}
function ct(s, e) {
  e.score = s.score;
}
function ot(s, e, {
  includeMatches: t = h.includeMatches,
  includeScore: r = h.includeScore
} = {}) {
  const i = [];
  return t && i.push(nt), r && i.push(ct), s.map((o) => {
    const { idx: n } = o, c = {
      item: e[n],
      refIndex: n
    };
    return i.length && i.forEach((a) => {
      a(o, c);
    }), c;
  });
}
class F {
  constructor(e, t = {}, r) {
    this.options = { ...h, ...t }, this.options.useExtendedSearch, this._keyStore = new $e(this.options.keys), this.setCollection(e, r);
  }
  setCollection(e, t) {
    if (this._docs = e, t && !(t instanceof Z))
      throw new Error(De);
    this._myIndex = t || le(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
  }
  add(e) {
    C(e) && (this._docs.push(e), this._myIndex.add(e));
  }
  remove(e = () => !1) {
    const t = [];
    for (let r = 0, i = this._docs.length; r < i; r += 1) {
      const o = this._docs[r];
      e(o, r) && (this.removeAt(r), r -= 1, i -= 1, t.push(o));
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
      includeMatches: r,
      includeScore: i,
      shouldSort: o,
      sortFn: n,
      ignoreFieldNorm: c
    } = this.options;
    let a = m(e) ? m(this._docs[0]) ? this._searchStringList(e) : this._searchObjectList(e) : this._searchLogical(e);
    return it(a, { ignoreFieldNorm: c }), o && a.sort(n), ce(t) && t > -1 && (a = a.slice(0, t)), ot(a, this._docs, {
      includeMatches: r,
      includeScore: i
    });
  }
  _searchStringList(e) {
    const t = Y(e, this.options), { records: r } = this._myIndex, i = [];
    return r.forEach(({ v: o, i: n, n: c }) => {
      if (!C(o))
        return;
      const { isMatch: a, score: u, indices: l } = t.searchIn(o);
      a && i.push({
        item: o,
        idx: n,
        matches: [{ score: u, value: o, norm: c, indices: l }]
      });
    }), i;
  }
  _searchLogical(e) {
    const t = ge(e, this.options), r = (c, a, u) => {
      if (!c.children) {
        const { keyId: d, searcher: g } = c, f = this._findMatches({
          key: this._keyStore.get(d),
          value: this._myIndex.getValueForItemAtKeyId(a, d),
          searcher: g
        });
        return f && f.length ? [
          {
            idx: u,
            item: a,
            matches: f
          }
        ] : [];
      }
      const l = [];
      for (let d = 0, g = c.children.length; d < g; d += 1) {
        const f = c.children[d], p = r(f, a, u);
        if (p.length)
          l.push(...p);
        else if (c.operator === z.AND)
          return [];
      }
      return l;
    }, i = this._myIndex.records, o = {}, n = [];
    return i.forEach(({ $: c, i: a }) => {
      if (C(c)) {
        let u = r(t, c, a);
        u.length && (o[a] || (o[a] = { idx: a, item: c, matches: [] }, n.push(o[a])), u.forEach(({ matches: l }) => {
          o[a].matches.push(...l);
        }));
      }
    }), n;
  }
  _searchObjectList(e) {
    const t = Y(e, this.options), { keys: r, records: i } = this._myIndex, o = [];
    return i.forEach(({ $: n, i: c }) => {
      if (!C(n))
        return;
      let a = [];
      r.forEach((u, l) => {
        a.push(
          ...this._findMatches({
            key: u,
            value: n[l],
            searcher: t
          })
        );
      }), a.length && o.push({
        idx: c,
        item: n,
        matches: a
      });
    }), o;
  }
  _findMatches({ key: e, value: t, searcher: r }) {
    if (!C(t))
      return [];
    let i = [];
    if (v(t))
      t.forEach(({ v: o, i: n, n: c }) => {
        if (!C(o))
          return;
        const { isMatch: a, score: u, indices: l } = r.searchIn(o);
        a && i.push({
          score: u,
          key: e,
          value: o,
          idx: n,
          norm: c,
          indices: l
        });
      });
    else {
      const { v: o, n } = t, { isMatch: c, score: a, indices: u } = r.searchIn(o);
      c && i.push({ score: a, key: e, value: o, norm: n, indices: u });
    }
    return i;
  }
}
F.version = "7.1.0";
F.createIndex = le;
F.parseIndex = Te;
F.config = h;
F.parseQuery = ge;
tt(et);
const H = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["content"]
};
function ut() {
  const { subscribe: s, set: e, update: t } = me({
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
  function o(n) {
    r = n.getService(
      "ClipboardHistoryService"
    ), i = n.getService("LogService");
  }
  return {
    subscribe: s,
    setSearch: (n) => t((c) => ({
      ...c,
      searchQuery: n,
      filtered: n.length > 0,
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
    initFuse: (n) => t((c) => ({
      ...c,
      fuseInstance: new F(n, H)
    })),
    search: (n, c) => {
      let a = n;
      if (c && c.trim() !== "") {
        let u = {
          fuseInstance: null
        };
        s((f) => {
          u = f;
        })();
        let d;
        u.fuseInstance ? (d = u.fuseInstance, d.setCollection(n)) : d = new F(n, H), a = d.search(c).map((f) => ({
          ...f.item,
          score: f.score
        })), t((f) => ({
          ...f,
          fuseInstance: d
        }));
      }
      return a;
    },
    setItems: (n) => {
      console.log("Setting items in state:", n.length), t((c) => ({
        ...c,
        items: n,
        fuseInstance: new F(n, H)
      }));
    },
    setSelectedItem(n) {
      t((c) => {
        const a = c.items;
        return a.length > 0 && n >= 0 && n < a.length ? {
          ...c,
          selectedItem: a[n],
          selectedIndex: n
        } : c;
      });
    },
    moveSelection(n) {
      t((c) => {
        const a = c.items;
        if (!a.length) return c;
        let u = c.selectedIndex;
        return n === "up" ? u = u <= 0 ? a.length - 1 : u - 1 : u = u >= a.length - 1 ? 0 : u + 1, requestAnimationFrame(() => {
          const l = document.querySelector(`[data-index="${u}"]`);
          l == null || l.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }), {
          ...c,
          selectedIndex: u,
          selectedItem: a[u]
        };
      });
    },
    setLoading(n) {
      t((c) => ({ ...c, isLoading: n }));
    },
    setError(n) {
      t((c) => ({
        ...c,
        loadError: !!n,
        errorMessage: n || ""
      }));
    },
    initializeServices: o,
    // Expose clipboardService methods through the state store
    async clearNonFavorites() {
      if (!r)
        return i == null || i.error("Clipboard service not initialized in clearNonFavorites"), !1;
      try {
        return await r.clearNonFavorites();
      } catch (n) {
        return i == null || i.error(`Error clearing non-favorites: ${n}`), !1;
      }
    },
    async toggleFavorite(n) {
      if (!r)
        return i == null || i.error("Clipboard service not initialized in toggleFavorite"), !1;
      try {
        return await r.toggleItemFavorite(n);
      } catch (c) {
        return i == null || i.error(`Error toggling favorite for ${n}: ${c}`), !1;
      }
    },
    // --- End exposed methods ---
    async handleItemAction(n, c) {
      if (!(!(n != null && n.id) || !r))
        try {
          switch (c) {
            case "paste":
              await r.pasteItem(n), r == null || r.hideWindow();
              break;
            case "select":
              const u = Fe({ subscribe: s }).items.findIndex((l) => l.id === n.id);
              u >= 0 && this.setSelectedItem(u);
              break;
          }
        } catch (a) {
          i == null || i.error(`Failed to handle item action: ${a}`);
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
      } catch (n) {
        i == null || i.error(`Error hiding window: ${n}`);
      }
    },
    // Refresh history items (no change needed here, already uses service)
    async refreshHistory() {
      t((n) => ({ ...n, isLoading: !0 }));
      try {
        if (r) {
          const n = await r.getRecentItems(100);
          t((c) => ({
            // Use update instead of this.setItems
            ...c,
            items: n,
            fuseInstance: new F(n, H)
            // Update fuse instance too
          }));
        } else
          i == null || i.warn("Clipboard service not available in refreshHistory");
      } catch (n) {
        i == null || i.error(`Failed to refresh clipboard history: ${n}`), t((c) => ({
          // Use update instead of this.setError
          ...c,
          loadError: !0,
          errorMessage: `Failed to refresh clipboard history: ${n}`
        }));
      } finally {
        this.setLoading(!1);
      }
    }
  };
}
const k = ut(), at = [
  {
    id: "clipboard-history",
    title: "Clipboard History",
    subtitle: "View and manage your clipboard history",
    keywords: "clipboard copy paste history"
  }
], lt = {
  includeScore: !0,
  threshold: 0.4,
  keys: ["title", "subtitle", "keywords"]
};
new F(at, lt);
class ht {
  constructor() {
    B(this, "onUnload");
    B(this, "logService");
    B(this, "extensionManager");
    B(this, "clipboardService");
    B(this, "actionService");
    B(this, "inView", !1);
    B(this, "context");
  }
  async initialize(e) {
    var t, r;
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
      k.initializeServices(e), this.logService.info(
        "Clipboard History extension initialized with services"
      );
    } catch (i) {
      console.error("Clipboard History initialization failed:", i), (r = this.logService) == null || r.error(
        `Clipboard History initialization failed: ${i}`
      );
    }
  }
  async executeCommand(e, t) {
    var r, i, o;
    switch ((r = this.logService) == null || r.info(`Executing clipboard command: ${e}`), e) {
      case "show-clipboard":
        return await this.refreshClipboardData(), (i = this.extensionManager) == null || i.navigateToView(
          "clipboard-history/ClipboardHistory"
        ), this.registerViewActions(), {
          type: "view",
          viewPath: "clipboard-history/ClipboardHistory"
        };
      default:
        throw (o = this.logService) == null || o.error(`Received unknown command ID: ${e}`), new Error(`Unknown command: ${e}`);
    }
  }
  // Called when this extension's view is activated
  async viewActivated(e) {
    var t, r;
    this.inView = !0, (t = this.logService) == null || t.debug(`Clipboard History view activated: ${e}`), (r = this.extensionManager) == null || r.setActiveViewActionLabel("Paste"), await this.refreshClipboardData();
  }
  // Helper method to register view-specific actions
  registerViewActions() {
    var t, r;
    if (!this.actionService || !this.clipboardService) {
      (t = this.logService) == null || t.warn(
        "ActionService or ClipboardService not available, cannot register view actions."
      );
      return;
    }
    (r = this.logService) == null || r.debug("Registering clipboard view actions...");
    const e = {
      id: "clipboard-reset-history",
      title: "Clear Clipboard History",
      description: "Remove all non-favorite clipboard items",
      icon: "🗑️",
      extensionId: "clipboard-history",
      category: "clipboard-action",
      // Context is implicitly EXTENSION_VIEW when registered
      execute: async () => {
        var i, o, n, c;
        try {
          confirm(
            "Are you sure you want to clear all non-favorite clipboard items?"
          ) && (await ((i = this.clipboardService) == null ? void 0 : i.clearNonFavorites()) ? (o = this.logService) == null || o.info("Non-favorite clipboard history cleared") : (n = this.logService) == null || n.warn(
            "Clearing non-favorite clipboard history reported failure."
          ), await this.refreshClipboardData());
        } catch (a) {
          (c = this.logService) == null || c.error(`Failed to clear clipboard history: ${a}`);
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
    var t, r;
    this.unregisterViewActions(), (t = this.extensionManager) == null || t.setActiveViewActionLabel(null), this.inView = !1, (r = this.logService) == null || r.debug(`Clipboard History view deactivated: ${e}`);
  }
  async onViewSearch(e) {
    k.setSearch(e);
  }
  async refreshClipboardData() {
    var e, t;
    if (this.clipboardService) {
      k.setLoading(!0);
      try {
        const r = await this.clipboardService.getRecentItems(100);
        k.setItems(r || []);
      } catch (r) {
        (e = this.logService) == null || e.error(`Failed to load clipboard data: ${r}`), k.setError(`Failed to load clipboard data: ${r}`);
      } finally {
        k.setLoading(!1);
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
const gt = new ht();
export {
  gt as default
};
