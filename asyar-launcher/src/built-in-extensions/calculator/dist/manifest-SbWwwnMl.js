const o = "Clipboard History", s = "clipboard-history", e = "1.0.0", i = "Manage and access your clipboard history", t = "view", a = "DefaultView", c = "index.es.js", n = !0, r = [{ id: "show-clipboard", name: "Show Clipboard History", description: "Show clipboard history", trigger: "clip", resultType: "view" }], d = {
  name: o,
  id: s,
  version: e,
  description: i,
  type: t,
  defaultView: a,
  main: c,
  searchable: !0,
  commands: r
};
export {
  r as commands,
  d as default,
  a as defaultView,
  i as description,
  s as id,
  c as main,
  o as name,
  n as searchable,
  t as type,
  e as version
};
