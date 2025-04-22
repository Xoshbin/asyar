var Ee = Object.defineProperty;
var Ie = (i, e, t) => e in i ? Ee(i, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : i[e] = t;
var F = (i, e, t) => Ie(i, typeof e != "symbol" ? e + "" : e, t);
const z = () => {
};
function xe(i, e) {
  return i != i ? e == e : i !== e || i !== null && typeof i == "object" || typeof i == "function";
}
let Q = !1;
function ve(i) {
  var e = Q;
  try {
    return Q = !0, i();
  } finally {
    Q = e;
  }
}
function we(i, e, t) {
  if (i == null)
    return e(void 0), z;
  const s = ve(
    () => i.subscribe(
      e,
      // @ts-expect-error
      t
    )
  );
  return s.unsubscribe ? () => s.unsubscribe() : s;
}
const k = [];
function Ce(i, e = z) {
  let t = null;
  const s = /* @__PURE__ */ new Set();
  function n(c) {
    if (xe(i, c) && (i = c, t)) {
      const u = !k.length;
      for (const a of s)
        a[1](), k.push(a, i);
      if (u) {
        for (let a = 0; a < k.length; a += 2)
          k[a][0](k[a + 1]);
        k.length = 0;
      }
    }
  }
  function o(c) {
    n(c(
      /** @type {T} */
      i
    ));
  }
  function r(c, u = z) {
    const a = [c, u];
    return s.add(a), s.size === 1 && (t = e(n, o) || z), c(
      /** @type {T} */
      i
    ), () => {
      s.delete(a), s.size === 0 && t && (t(), t = null);
    };
  }
  return { set: n, update: o, subscribe: r };
}
function se(i) {
  let e;
  return we(i, (t) => e = t)(), e;
}
function w(i) {
  return Array.isArray ? Array.isArray(i) : he(i) === "[object Array]";
}
function Me(i) {
  if (typeof i == "string")
    return i;
  let e = i + "";
  return e == "0" && 1 / i == -1 / 0 ? "-0" : e;
}
function ye(i) {
  return i == null ? "" : Me(i);
}
function x(i) {
  return typeof i == "string";
}
function ae(i) {
  return typeof i == "number";
}
function be(i) {
  return i === !0 || i === !1 || De(i) && he(i) == "[object Boolean]";
}
function le(i) {
  return typeof i == "object";
}
function De(i) {
  return le(i) && i !== null;
}
function m(i) {
  return i != null;
}
function G(i) {
  return !i.trim().length;
}
function he(i) {
  return i == null ? i === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(i);
}
const Fe = "Incorrect 'index' type", Be = (i) => `Invalid value for key ${i}`, _e = (i) => `Pattern length exceeds max of ${i}.`, Le = (i) => `Missing ${i} property in key`, $e = (i) => `Property 'weight' in key '${i}' must be a positive integer`, ne = Object.prototype.hasOwnProperty;
class Re {
  constructor(e) {
    this._keys = [], this._keyMap = {};
    let t = 0;
    e.forEach((s) => {
      let n = de(s);
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
function de(i) {
  let e = null, t = null, s = null, n = 1, o = null;
  if (x(i) || w(i))
    s = i, e = re(i), t = H(i);
  else {
    if (!ne.call(i, "name"))
      throw new Error(Le("name"));
    const r = i.name;
    if (s = r, ne.call(i, "weight") && (n = i.weight, n <= 0))
      throw new Error($e(r));
    e = re(r), t = H(r), o = i.getFn;
  }
  return { path: e, id: t, weight: n, src: s, getFn: o };
}
function re(i) {
  return w(i) ? i : i.split(".");
}
function H(i) {
  return w(i) ? i.join(".") : i;
}
function ke(i, e) {
  let t = [], s = !1;
  const n = (o, r, c) => {
    if (m(o))
      if (!r[c])
        t.push(o);
      else {
        let u = r[c];
        const a = o[u];
        if (!m(a))
          return;
        if (c === r.length - 1 && (x(a) || ae(a) || be(a)))
          t.push(ye(a));
        else if (w(a)) {
          s = !0;
          for (let l = 0, d = a.length; l < d; l += 1)
            n(a[l], r, c + 1);
        } else r.length && n(a, r, c + 1);
      }
  };
  return n(i, x(e) ? e.split(".") : e, 0), s ? t : t[0];
}
const Ve = {
  // Whether the matches should be included in the result set. When `true`, each record in the result
  // set will include the indices of the matched characters.
  // These can consequently be used for highlighting purposes.
  includeMatches: !1,
  // When `true`, the matching function will continue to the end of a search pattern even if
  // a perfect match has already been located in the string.
  findAllMatches: !1,
  // Minimum number of characters that must be matched before a result is considered a match
  minMatchCharLength: 1
}, Ne = {
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
}, Te = {
  // When `true`, it enables the use of unix-like search commands
  useExtendedSearch: !1,
  // The get function to use when fetching an object's properties.
  // The default will search nested paths *ie foo.bar.baz*
  getFn: ke,
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
  ...Ne,
  ...Ve,
  ...Oe,
  ...Te
};
const je = /[^ ]+/g;
function ze(i = 1, e = 3) {
  const t = /* @__PURE__ */ new Map(), s = Math.pow(10, e);
  return {
    get(n) {
      const o = n.match(je).length;
      if (t.has(o))
        return t.get(o);
      const r = 1 / Math.pow(o, 0.5 * i), c = parseFloat(Math.round(r * s) / s);
      return t.set(o, c), c;
    },
    clear() {
      t.clear();
    }
  };
}
class ee {
  constructor({
    getFn: e = h.getFn,
    fieldNormWeight: t = h.fieldNormWeight
  } = {}) {
    this.norm = ze(t, 3), this.getFn = e, this.isCreated = !1, this.setIndexRecords();
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
    if (!m(e) || G(e))
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
    this.keys.forEach((n, o) => {
      let r = n.getFn ? n.getFn(e) : this.getFn(e, n.path);
      if (m(r)) {
        if (w(r)) {
          let c = [];
          const u = [{ nestedArrIndex: -1, value: r }];
          for (; u.length; ) {
            const { nestedArrIndex: a, value: l } = u.pop();
            if (m(l))
              if (x(l) && !G(l)) {
                let d = {
                  v: l,
                  i: a,
                  n: this.norm.get(l)
                };
                c.push(d);
              } else w(l) && l.forEach((d, f) => {
                u.push({
                  nestedArrIndex: f,
                  value: d
                });
              });
          }
          s.$[o] = c;
        } else if (x(r) && !G(r)) {
          let c = {
            v: r,
            n: this.norm.get(r)
          };
          s.$[o] = c;
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
function fe(i, e, { getFn: t = h.getFn, fieldNormWeight: s = h.fieldNormWeight } = {}) {
  const n = new ee({ getFn: t, fieldNormWeight: s });
  return n.setKeys(i.map(de)), n.setSources(e), n.create(), n;
}
function Pe(i, { getFn: e = h.getFn, fieldNormWeight: t = h.fieldNormWeight } = {}) {
  const { keys: s, records: n } = i, o = new ee({ getFn: e, fieldNormWeight: t });
  return o.setKeys(s), o.setIndexRecords(n), o;
}
function T(i, {
  errors: e = 0,
  currentLocation: t = 0,
  expectedLocation: s = 0,
  distance: n = h.distance,
  ignoreLocation: o = h.ignoreLocation
} = {}) {
  const r = e / i.length;
  if (o)
    return r;
  const c = Math.abs(s - t);
  return n ? r + c / n : c ? 1 : r;
}
function Ke(i = [], e = h.minMatchCharLength) {
  let t = [], s = -1, n = -1, o = 0;
  for (let r = i.length; o < r; o += 1) {
    let c = i[o];
    c && s === -1 ? s = o : !c && s !== -1 && (n = o - 1, n - s + 1 >= e && t.push([s, n]), s = -1);
  }
  return i[o - 1] && o - s >= e && t.push([s, o - 1]), t;
}
const L = 32;
function Ue(i, e, t, {
  location: s = h.location,
  distance: n = h.distance,
  threshold: o = h.threshold,
  findAllMatches: r = h.findAllMatches,
  minMatchCharLength: c = h.minMatchCharLength,
  includeMatches: u = h.includeMatches,
  ignoreLocation: a = h.ignoreLocation
} = {}) {
  if (e.length > L)
    throw new Error(_e(L));
  const l = e.length, d = i.length, f = Math.max(0, Math.min(s, d));
  let g = o, A = f;
  const p = c > 1 || u, S = p ? Array(d) : [];
  let C;
  for (; (C = i.indexOf(e, A)) > -1; ) {
    let E = T(e, {
      currentLocation: C,
      expectedLocation: f,
      distance: n,
      ignoreLocation: a
    });
    if (g = Math.min(E, g), A = C + l, p) {
      let M = 0;
      for (; M < l; )
        S[C + M] = 1, M += 1;
    }
  }
  A = -1;
  let v = [], $ = 1, D = l + d;
  const me = 1 << l - 1;
  for (let E = 0; E < l; E += 1) {
    let M = 0, y = D;
    for (; M < y; )
      T(e, {
        errors: E,
        currentLocation: f + y,
        expectedLocation: f,
        distance: n,
        ignoreLocation: a
      }) <= g ? M = y : D = y, y = Math.floor((D - M) / 2 + M);
    D = y;
    let te = Math.max(1, f - y + 1), W = r ? d : Math.min(f + y, d) + l, R = Array(W + 2);
    R[W + 1] = (1 << E) - 1;
    for (let I = W; I >= te; I -= 1) {
      let O = I - 1, ie = t[i.charAt(O)];
      if (p && (S[O] = +!!ie), R[I] = (R[I + 1] << 1 | 1) & ie, E && (R[I] |= (v[I + 1] | v[I]) << 1 | 1 | v[I + 1]), R[I] & me && ($ = T(e, {
        errors: E,
        currentLocation: O,
        expectedLocation: f,
        distance: n,
        ignoreLocation: a
      }), $ <= g)) {
        if (g = $, A = O, A <= f)
          break;
        te = Math.max(1, 2 * f - A);
      }
    }
    if (T(e, {
      errors: E + 1,
      currentLocation: f,
      expectedLocation: f,
      distance: n,
      ignoreLocation: a
    }) > g)
      break;
    v = R;
  }
  const U = {
    isMatch: A >= 0,
    // Count exact matches (those with a score of 0) to be "almost" exact
    score: Math.max(1e-3, $)
  };
  if (p) {
    const E = Ke(S, c);
    E.length ? u && (U.indices = E) : U.isMatch = !1;
  }
  return U;
}
function We(i) {
  let e = {};
  for (let t = 0, s = i.length; t < s; t += 1) {
    const n = i.charAt(t);
    e[n] = (e[n] || 0) | 1 << s - t - 1;
  }
  return e;
}
const P = String.prototype.normalize ? (i) => i.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "") : (i) => i;
class ge {
  constructor(e, {
    location: t = h.location,
    threshold: s = h.threshold,
    distance: n = h.distance,
    includeMatches: o = h.includeMatches,
    findAllMatches: r = h.findAllMatches,
    minMatchCharLength: c = h.minMatchCharLength,
    isCaseSensitive: u = h.isCaseSensitive,
    ignoreDiacritics: a = h.ignoreDiacritics,
    ignoreLocation: l = h.ignoreLocation
  } = {}) {
    if (this.options = {
      location: t,
      threshold: s,
      distance: n,
      includeMatches: o,
      findAllMatches: r,
      minMatchCharLength: c,
      isCaseSensitive: u,
      ignoreDiacritics: a,
      ignoreLocation: l
    }, e = u ? e : e.toLowerCase(), e = a ? P(e) : e, this.pattern = e, this.chunks = [], !this.pattern.length)
      return;
    const d = (g, A) => {
      this.chunks.push({
        pattern: g,
        alphabet: We(g),
        startIndex: A
      });
    }, f = this.pattern.length;
    if (f > L) {
      let g = 0;
      const A = f % L, p = f - A;
      for (; g < p; )
        d(this.pattern.substr(g, L), g), g += L;
      if (A) {
        const S = f - L;
        d(this.pattern.substr(S), S);
      }
    } else
      d(this.pattern, 0);
  }
  searchIn(e) {
    const { isCaseSensitive: t, ignoreDiacritics: s, includeMatches: n } = this.options;
    if (e = t ? e : e.toLowerCase(), e = s ? P(e) : e, this.pattern === e) {
      let p = {
        isMatch: !0,
        score: 0
      };
      return n && (p.indices = [[0, e.length - 1]]), p;
    }
    const {
      location: o,
      distance: r,
      threshold: c,
      findAllMatches: u,
      minMatchCharLength: a,
      ignoreLocation: l
    } = this.options;
    let d = [], f = 0, g = !1;
    this.chunks.forEach(({ pattern: p, alphabet: S, startIndex: C }) => {
      const { isMatch: v, score: $, indices: D } = Ue(e, p, S, {
        location: o + C,
        distance: r,
        threshold: c,
        findAllMatches: u,
        minMatchCharLength: a,
        includeMatches: n,
        ignoreLocation: l
      });
      v && (g = !0), f += $, v && D && (d = [...d, ...D]);
    });
    let A = {
      isMatch: g,
      score: g ? f / this.chunks.length : 1
    };
    return g && n && (A.indices = d), A;
  }
}
class b {
  constructor(e) {
    this.pattern = e;
  }
  static isMultiMatch(e) {
    return ce(e, this.multiRegex);
  }
  static isSingleMatch(e) {
    return ce(e, this.singleRegex);
  }
  search() {
  }
}
function ce(i, e) {
  const t = i.match(e);
  return t ? t[1] : null;
}
class Qe extends b {
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
class Ge extends b {
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
class He extends b {
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
class Ye extends b {
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
class Je extends b {
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
class Xe extends b {
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
class Ae extends b {
  constructor(e, {
    location: t = h.location,
    threshold: s = h.threshold,
    distance: n = h.distance,
    includeMatches: o = h.includeMatches,
    findAllMatches: r = h.findAllMatches,
    minMatchCharLength: c = h.minMatchCharLength,
    isCaseSensitive: u = h.isCaseSensitive,
    ignoreDiacritics: a = h.ignoreDiacritics,
    ignoreLocation: l = h.ignoreLocation
  } = {}) {
    super(e), this._bitapSearch = new ge(e, {
      location: t,
      threshold: s,
      distance: n,
      includeMatches: o,
      findAllMatches: r,
      minMatchCharLength: c,
      isCaseSensitive: u,
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
class pe extends b {
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
    const n = [], o = this.pattern.length;
    for (; (s = e.indexOf(this.pattern, t)) > -1; )
      t = s + o, n.push([s, t - 1]);
    const r = !!n.length;
    return {
      isMatch: r,
      score: r ? 0 : 1,
      indices: n
    };
  }
}
const Y = [
  Qe,
  pe,
  He,
  Ye,
  Xe,
  Je,
  Ge,
  Ae
], oe = Y.length, Ze = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/, qe = "|";
function et(i, e = {}) {
  return i.split(qe).map((t) => {
    let s = t.trim().split(Ze).filter((o) => o && !!o.trim()), n = [];
    for (let o = 0, r = s.length; o < r; o += 1) {
      const c = s[o];
      let u = !1, a = -1;
      for (; !u && ++a < oe; ) {
        const l = Y[a];
        let d = l.isMultiMatch(c);
        d && (n.push(new l(d, e)), u = !0);
      }
      if (!u)
        for (a = -1; ++a < oe; ) {
          const l = Y[a];
          let d = l.isSingleMatch(c);
          if (d) {
            n.push(new l(d, e));
            break;
          }
        }
    }
    return n;
  });
}
const tt = /* @__PURE__ */ new Set([Ae.type, pe.type]);
class it {
  constructor(e, {
    isCaseSensitive: t = h.isCaseSensitive,
    ignoreDiacritics: s = h.ignoreDiacritics,
    includeMatches: n = h.includeMatches,
    minMatchCharLength: o = h.minMatchCharLength,
    ignoreLocation: r = h.ignoreLocation,
    findAllMatches: c = h.findAllMatches,
    location: u = h.location,
    threshold: a = h.threshold,
    distance: l = h.distance
  } = {}) {
    this.query = null, this.options = {
      isCaseSensitive: t,
      ignoreDiacritics: s,
      includeMatches: n,
      minMatchCharLength: o,
      findAllMatches: c,
      ignoreLocation: r,
      location: u,
      threshold: a,
      distance: l
    }, e = t ? e : e.toLowerCase(), e = s ? P(e) : e, this.pattern = e, this.query = et(this.pattern, this.options);
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
    const { includeMatches: s, isCaseSensitive: n, ignoreDiacritics: o } = this.options;
    e = n ? e : e.toLowerCase(), e = o ? P(e) : e;
    let r = 0, c = [], u = 0;
    for (let a = 0, l = t.length; a < l; a += 1) {
      const d = t[a];
      c.length = 0, r = 0;
      for (let f = 0, g = d.length; f < g; f += 1) {
        const A = d[f], { isMatch: p, indices: S, score: C } = A.search(e);
        if (p) {
          if (r += 1, u += C, s) {
            const v = A.constructor.type;
            tt.has(v) ? c = [...c, ...S] : c.push(S);
          }
        } else {
          u = 0, r = 0, c.length = 0;
          break;
        }
      }
      if (r) {
        let f = {
          isMatch: !0,
          score: u / r
        };
        return s && (f.indices = c), f;
      }
    }
    return {
      isMatch: !1,
      score: 1
    };
  }
}
const J = [];
function st(...i) {
  J.push(...i);
}
function X(i, e) {
  for (let t = 0, s = J.length; t < s; t += 1) {
    let n = J[t];
    if (n.condition(i, e))
      return new n(i, e);
  }
  return new ge(i, e);
}
const K = {
  AND: "$and",
  OR: "$or"
}, Z = {
  PATH: "$path",
  PATTERN: "$val"
}, q = (i) => !!(i[K.AND] || i[K.OR]), nt = (i) => !!i[Z.PATH], rt = (i) => !w(i) && le(i) && !q(i), ue = (i) => ({
  [K.AND]: Object.keys(i).map((e) => ({
    [e]: i[e]
  }))
});
function Se(i, e, { auto: t = !0 } = {}) {
  const s = (n) => {
    let o = Object.keys(n);
    const r = nt(n);
    if (!r && o.length > 1 && !q(n))
      return s(ue(n));
    if (rt(n)) {
      const u = r ? n[Z.PATH] : o[0], a = r ? n[Z.PATTERN] : n[u];
      if (!x(a))
        throw new Error(Be(u));
      const l = {
        keyId: H(u),
        pattern: a
      };
      return t && (l.searcher = X(a, e)), l;
    }
    let c = {
      children: [],
      operator: o[0]
    };
    return o.forEach((u) => {
      const a = n[u];
      w(a) && a.forEach((l) => {
        c.children.push(s(l));
      });
    }), c;
  };
  return q(i) || (i = ue(i)), s(i);
}
function ct(i, { ignoreFieldNorm: e = h.ignoreFieldNorm }) {
  i.forEach((t) => {
    let s = 1;
    t.matches.forEach(({ key: n, norm: o, score: r }) => {
      const c = n ? n.weight : null;
      s *= Math.pow(
        r === 0 && c ? Number.EPSILON : r,
        (c || 1) * (e ? 1 : o)
      );
    }), t.score = s;
  });
}
function ot(i, e) {
  const t = i.matches;
  e.matches = [], m(t) && t.forEach((s) => {
    if (!m(s.indices) || !s.indices.length)
      return;
    const { indices: n, value: o } = s;
    let r = {
      indices: n,
      value: o
    };
    s.key && (r.key = s.key.src), s.idx > -1 && (r.refIndex = s.idx), e.matches.push(r);
  });
}
function ut(i, e) {
  e.score = i.score;
}
function at(i, e, {
  includeMatches: t = h.includeMatches,
  includeScore: s = h.includeScore
} = {}) {
  const n = [];
  return t && n.push(ot), s && n.push(ut), i.map((o) => {
    const { idx: r } = o, c = {
      item: e[r],
      refIndex: r
    };
    return n.length && n.forEach((u) => {
      u(o, c);
    }), c;
  });
}
class V {
  constructor(e, t = {}, s) {
    this.options = { ...h, ...t }, this.options.useExtendedSearch, this._keyStore = new Re(this.options.keys), this.setCollection(e, s);
  }
  setCollection(e, t) {
    if (this._docs = e, t && !(t instanceof ee))
      throw new Error(Fe);
    this._myIndex = t || fe(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
  }
  add(e) {
    m(e) && (this._docs.push(e), this._myIndex.add(e));
  }
  remove(e = () => !1) {
    const t = [];
    for (let s = 0, n = this._docs.length; s < n; s += 1) {
      const o = this._docs[s];
      e(o, s) && (this.removeAt(s), s -= 1, n -= 1, t.push(o));
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
      shouldSort: o,
      sortFn: r,
      ignoreFieldNorm: c
    } = this.options;
    let u = x(e) ? x(this._docs[0]) ? this._searchStringList(e) : this._searchObjectList(e) : this._searchLogical(e);
    return ct(u, { ignoreFieldNorm: c }), o && u.sort(r), ae(t) && t > -1 && (u = u.slice(0, t)), at(u, this._docs, {
      includeMatches: s,
      includeScore: n
    });
  }
  _searchStringList(e) {
    const t = X(e, this.options), { records: s } = this._myIndex, n = [];
    return s.forEach(({ v: o, i: r, n: c }) => {
      if (!m(o))
        return;
      const { isMatch: u, score: a, indices: l } = t.searchIn(o);
      u && n.push({
        item: o,
        idx: r,
        matches: [{ score: a, value: o, norm: c, indices: l }]
      });
    }), n;
  }
  _searchLogical(e) {
    const t = Se(e, this.options), s = (c, u, a) => {
      if (!c.children) {
        const { keyId: d, searcher: f } = c, g = this._findMatches({
          key: this._keyStore.get(d),
          value: this._myIndex.getValueForItemAtKeyId(u, d),
          searcher: f
        });
        return g && g.length ? [
          {
            idx: a,
            item: u,
            matches: g
          }
        ] : [];
      }
      const l = [];
      for (let d = 0, f = c.children.length; d < f; d += 1) {
        const g = c.children[d], A = s(g, u, a);
        if (A.length)
          l.push(...A);
        else if (c.operator === K.AND)
          return [];
      }
      return l;
    }, n = this._myIndex.records, o = {}, r = [];
    return n.forEach(({ $: c, i: u }) => {
      if (m(c)) {
        let a = s(t, c, u);
        a.length && (o[u] || (o[u] = { idx: u, item: c, matches: [] }, r.push(o[u])), a.forEach(({ matches: l }) => {
          o[u].matches.push(...l);
        }));
      }
    }), r;
  }
  _searchObjectList(e) {
    const t = X(e, this.options), { keys: s, records: n } = this._myIndex, o = [];
    return n.forEach(({ $: r, i: c }) => {
      if (!m(r))
        return;
      let u = [];
      s.forEach((a, l) => {
        u.push(
          ...this._findMatches({
            key: a,
            value: r[l],
            searcher: t
          })
        );
      }), u.length && o.push({
        idx: c,
        item: r,
        matches: u
      });
    }), o;
  }
  _findMatches({ key: e, value: t, searcher: s }) {
    if (!m(t))
      return [];
    let n = [];
    if (w(t))
      t.forEach(({ v: o, i: r, n: c }) => {
        if (!m(o))
          return;
        const { isMatch: u, score: a, indices: l } = s.searchIn(o);
        u && n.push({
          score: a,
          key: e,
          value: o,
          idx: r,
          norm: c,
          indices: l
        });
      });
    else {
      const { v: o, n: r } = t, { isMatch: c, score: u, indices: a } = s.searchIn(o);
      c && n.push({ score: u, key: e, value: o, norm: r, indices: a });
    }
    return n;
  }
}
V.version = "7.1.0";
V.createIndex = fe;
V.parseIndex = Pe;
V.config = h;
V.parseQuery = Se;
st(it);
const lt = {
  includeScore: !0,
  threshold: 0.4,
  // Adjust threshold as needed
  keys: ["name", "description", "author.name", "category", "keywords"]
  // Add keywords if available in ApiExtension
};
function ht() {
  const { subscribe: i, update: e } = Ce({
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
  let t, s;
  function n(r) {
    t = r.getService("LogService"), s = r.getService("ExtensionManager"), e((c) => ({ ...c, extensionManager: s ?? null }));
  }
  function o(r) {
    return r.searchQuery ? r.fuseInstance ? r.fuseInstance.search(r.searchQuery).map((u) => u.item) : (t == null || t.warn("Fuse instance not initialized for search."), r.allItems) : r.allItems;
  }
  return {
    subscribe: i,
    initializeServices: n,
    setItems: (r) => {
      t == null || t.debug(`Store state received ${r.length} items.`), e((c) => {
        const u = new V(r, lt), a = {
          ...c,
          allItems: r,
          fuseInstance: u,
          isLoading: !1,
          loadError: !1,
          errorMessage: ""
        };
        return a.filteredItems = o(a), a.selectedIndex = a.filteredItems.length > 0 ? 0 : -1, a.selectedItem = a.selectedIndex !== -1 ? a.filteredItems[a.selectedIndex] : null, a;
      });
    },
    setSearch: (r) => {
      e((c) => {
        const u = {
          ...c,
          searchQuery: r,
          filtered: r.length > 0
        };
        return u.filteredItems = o(u), u.selectedIndex = u.filteredItems.length > 0 ? 0 : -1, u.selectedItem = u.selectedIndex !== -1 ? u.filteredItems[u.selectedIndex] : null, u;
      });
    },
    moveSelection(r) {
      e((c) => {
        if (!c.filteredItems.length) return c;
        let u = c.selectedIndex;
        const a = c.filteredItems.length - 1;
        return r === "up" ? u = u <= 0 ? a : u - 1 : u = u >= a ? 0 : u + 1, {
          ...c,
          selectedIndex: u,
          selectedItem: c.filteredItems[u]
        };
      });
    },
    setSelectedItemByIndex(r) {
      e((c) => r >= 0 && r < c.filteredItems.length ? {
        ...c,
        selectedIndex: r,
        selectedItem: c.filteredItems[r]
      } : { ...c, selectedIndex: -1, selectedItem: null });
    },
    setSelectedExtensionSlug(r) {
      e((c) => ({ ...c, selectedExtensionSlug: r }));
    },
    setLoading(r) {
      e((c) => ({ ...c, isLoading: r }));
    },
    setError(r) {
      e((c) => ({
        ...c,
        loadError: !0,
        errorMessage: r,
        isLoading: !1,
        allItems: [],
        filteredItems: []
      }));
    }
  };
}
const N = ht();
async function dt(i, e = {}, t) {
  return window.__TAURI_INTERNALS__.invoke(i, e, t);
}
const B = "store", j = "store-install-detail", _ = "store-install-selected";
class ft {
  constructor() {
    F(this, "extensionManager");
    F(this, "logService");
    F(this, "actionService");
    F(this, "notificationService");
    F(this, "activeViewPath", null);
    F(this, "listViewActionSubscription", null);
  }
  // To hold the unsubscribe function
  async initialize(e) {
    var t;
    this.logService = e.getService("LogService"), this.extensionManager = e.getService("ExtensionManager"), this.actionService = e.getService("ActionService"), this.notificationService = e.getService(
      "NotificationService"
    ), N.initializeServices(e), (t = this.logService) == null || t.info(
      "Store extension initialized and state services initialized."
    );
  }
  // --- Private Helper for Installation ---
  async _installExtension(e, t) {
    var n, o, r, c, u, a, l, d, f;
    if (!e) {
      (n = this.logService) == null || n.error("Install function called without a slug."), (o = this.notificationService) == null || o.notify({
        title: "Install Failed",
        body: "Could not determine which extension to install."
      });
      return;
    }
    const s = t || e;
    (r = this.logService) == null || r.info(`Install action triggered for slug: ${e}`);
    try {
      const g = await fetch(
        `http://asyar-website.test/api/extensions/${e}/install`
      );
      if (!g.ok)
        throw new Error(
          `Failed to get install info: ${g.status} ${await g.text()}`
        );
      const A = await g.json();
      (c = this.logService) == null || c.info(
        `Install info received: Version ${A.version}, URL: ${A.download_url}`
      ), (u = this.logService) == null || u.info(
        `Invoking Tauri command 'install_extension_from_url' for ${s}`
      ), await dt("install_extension_from_url", {
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
    var n, o, r;
    if ((n = this.logService) == null || n.info(`Store executing command: ${e}`), e === "browse")
      return this.extensionManager ? (this.extensionManager.navigateToView(
        `${B}/ExtensionListView`
      ), { success: !0 }) : ((o = this.logService) == null || o.error("ExtensionManager service not available."), { success: !1, error: "ExtensionManager not available" });
    throw (r = this.logService) == null || r.warn(
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
    (t = this.logService) == null || t.debug(`Registering action: ${j}`);
    const e = {
      id: j,
      title: "Install Extension",
      description: "Install the currently viewed extension",
      icon: "💾",
      // Example icon
      extensionId: B,
      execute: async () => {
        const n = se(N).selectedExtensionSlug;
        await this._installExtension(n, void 0);
      }
      // Removed isActive property as it's not in ExtensionAction type
    };
    this.actionService.registerAction(e);
  }
  unregisterDetailViewActions() {
    var e;
    this.actionService && ((e = this.logService) == null || e.debug(`Unregistering action: ${j}`), this.actionService.unregisterAction(j));
  }
  // Action for List View Selection - Now manages subscription
  registerListViewActions() {
    var e;
    !this.actionService || this.listViewActionSubscription || ((e = this.logService) == null || e.debug(
      `Setting up subscription for dynamic list view action: ${_}`
    ), this.listViewActionSubscription = N.subscribe((t) => {
      var n, o, r, c, u, a, l, d;
      (n = this.actionService) == null || n.unregisterAction(_), (o = this.extensionManager) == null || o.setActiveViewActionLabel(null);
      const s = t.selectedItem;
      if (s) {
        (r = this.extensionManager) == null || r.setActiveViewActionLabel("Show Details"), (c = this.logService) == null || c.debug(
          `Set primary action label to "Show Details" via manager for ${s.name}`
        );
        const f = `Install ${s.name} Extension`;
        (u = this.logService) == null || u.debug(
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
          extensionId: B,
          execute: async () => {
            var p, S;
            const A = se(N).selectedItem;
            A ? await this._installExtension(
              A.slug,
              A.name
            ) : ((p = this.logService) == null || p.warn(
              "Install selected action executed, but no item is selected in state anymore."
            ), (S = this.notificationService) == null || S.notify({
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
    var t, s, n, o;
    (t = this.logService) == null || t.debug(`Store view activated: ${e}`), this.activeViewPath = e, (s = this.extensionManager) == null || s.setActiveViewActionLabel(null), e === `${B}/ExtensionDetailView` ? (this.unregisterListViewActions(), this.registerDetailViewActions(), (n = this.extensionManager) == null || n.setActiveViewActionLabel("Install Extension"), (o = this.logService) == null || o.debug(
      'Set primary action label to "Install Extension" via manager for detail view.'
    )) : e === `${B}/ExtensionListView` ? (this.unregisterDetailViewActions(), this.registerListViewActions()) : (this.unregisterDetailViewActions(), this.unregisterListViewActions());
  }
  async viewDeactivated(e) {
    var t, s, n;
    (t = this.logService) == null || t.debug(`Store view deactivated: ${e}`), this.activeViewPath = null, e === `${B}/ExtensionDetailView` ? (this.unregisterDetailViewActions(), (s = this.extensionManager) == null || s.setActiveViewActionLabel(null), (n = this.logService) == null || n.debug(
      "Cleared primary action label via manager as detail view deactivated."
    )) : e === `${B}/ExtensionListView` && this.unregisterListViewActions();
  }
  onUnload() {
    var e;
    this.unregisterDetailViewActions(), this.unregisterListViewActions(), (e = this.logService) == null || e.info("Store extension unloading.");
  }
  // Add onViewSearch method
  async onViewSearch(e) {
    var t;
    (t = this.logService) == null || t.debug(`Store view search received: "${e}"`), N.setSearch(e);
  }
}
const pt = new ft();
export {
  pt as default
};
