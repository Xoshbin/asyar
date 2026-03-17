const s = "store", e = "store", n = "Browse and install Asyar extensions.", t = "1.0.0", o = "Asyar", r = "store", i = "view", l = !0, a = "index.ts", c = "index.es.js", d = [{ id: "browse", name: "Browse Extension Store", trigger: "store", description: "Find and install new extensions", category: "Asyar", keywords: ["store", "extensions", "browse", "install", "add", "find"], icon: "store" }], w = {
  id: s,
  name: e,
  description: n,
  version: t,
  author: o,
  icon: r,
  type: i,
  searchable: !0,
  entry: a,
  main: c,
  commands: d
};
export {
  o as author,
  d as commands,
  w as default,
  n as description,
  a as entry,
  r as icon,
  s as id,
  c as main,
  e as name,
  l as searchable,
  i as type,
  t as version
};
