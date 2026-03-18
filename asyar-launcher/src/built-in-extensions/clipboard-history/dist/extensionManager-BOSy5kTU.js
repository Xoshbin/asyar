var De = Object.defineProperty;
var Ve = (i, e, t) => e in i ? De(i, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : i[e] = t;
var h = (i, e, t) => Ve(i, typeof e != "symbol" ? e + "" : e, t);
import { writable as y, get as S } from "svelte/store";
import { R as Fe, i as l, l as xe, a as r, C as Ne, b as je, c as be, d as V, e as se, s as oe } from "./index-DDlVQHa8.js";
import { ClipboardItemType as b, ExtensionBridge as He } from "asyar-api";
import "svelte";
const ce = y("");
async function we(i, e) {
  return await ne.load(i, e);
}
class Oe {
  get store() {
    return this._store || (this._store = we(this.path, this.options)), this._store;
  }
  /**
   * Note that the options are not applied if someone else already created the store
   * @param path Path to save the store in `app_data_dir`
   * @param options Store configuration options
   */
  constructor(e, t) {
    this.path = e, this.options = t;
  }
  /**
   * Init/load the store if it's not loaded already
   */
  async init() {
    await this.store;
  }
  async set(e, t) {
    return (await this.store).set(e, t);
  }
  async get(e) {
    return (await this.store).get(e);
  }
  async has(e) {
    return (await this.store).has(e);
  }
  async delete(e) {
    return (await this.store).delete(e);
  }
  async clear() {
    await (await this.store).clear();
  }
  async reset() {
    await (await this.store).reset();
  }
  async keys() {
    return (await this.store).keys();
  }
  async values() {
    return (await this.store).values();
  }
  async entries() {
    return (await this.store).entries();
  }
  async length() {
    return (await this.store).length();
  }
  async reload() {
    await (await this.store).reload();
  }
  async save() {
    await (await this.store).save();
  }
  async onKeyChange(e, t) {
    return (await this.store).onKeyChange(e, t);
  }
  async onChange(e) {
    return (await this.store).onChange(e);
  }
  async close() {
    this._store && await (await this._store).close();
  }
}
class ne extends Fe {
  constructor(e) {
    super(e);
  }
  /**
   * Create a new Store or load the existing store with the path.
   *
   * @example
   * ```typescript
   * import { Store } from '@tauri-apps/api/store';
   * const store = await Store.load('store.json');
   * ```
   *
   * @param path Path to save the store in `app_data_dir`
   * @param options Store configuration options
   */
  static async load(e, t) {
    const n = await l("plugin:store|load", {
      path: e,
      ...t
    });
    return new ne(n);
  }
  /**
   * Gets an already loaded store.
   *
   * If the store is not loaded, returns `null`. In this case you must {@link Store.load load} it.
   *
   * This function is more useful when you already know the store is loaded
   * and just need to access its instance. Prefer {@link Store.load} otherwise.
   *
   * @example
   * ```typescript
   * import { Store } from '@tauri-apps/api/store';
   * let store = await Store.get('store.json');
   * if (!store) {
   *   store = await Store.load('store.json');
   * }
   * ```
   *
   * @param path Path of the store.
   */
  static async get(e) {
    return await l("plugin:store|get_store", { path: e }).then((t) => t ? new ne(t) : null);
  }
  async set(e, t) {
    await l("plugin:store|set", {
      rid: this.rid,
      key: e,
      value: t
    });
  }
  async get(e) {
    const [t, n] = await l("plugin:store|get", {
      rid: this.rid,
      key: e
    });
    return n ? t : void 0;
  }
  async has(e) {
    return await l("plugin:store|has", {
      rid: this.rid,
      key: e
    });
  }
  async delete(e) {
    return await l("plugin:store|delete", {
      rid: this.rid,
      key: e
    });
  }
  async clear() {
    await l("plugin:store|clear", { rid: this.rid });
  }
  async reset() {
    await l("plugin:store|reset", { rid: this.rid });
  }
  async keys() {
    return await l("plugin:store|keys", { rid: this.rid });
  }
  async values() {
    return await l("plugin:store|values", { rid: this.rid });
  }
  async entries() {
    return await l("plugin:store|entries", { rid: this.rid });
  }
  async length() {
    return await l("plugin:store|length", { rid: this.rid });
  }
  async reload() {
    await l("plugin:store|reload", { rid: this.rid });
  }
  async save() {
    await l("plugin:store|save", { rid: this.rid });
  }
  async onKeyChange(e, t) {
    return await xe("store://change", (n) => {
      n.payload.resourceId === this.rid && n.payload.key === e && t(n.payload.exists ? n.payload.value : void 0);
    });
  }
  async onChange(e) {
    return await xe("store://change", (t) => {
      t.payload.resourceId === this.rid && e(t.payload.key, t.payload.exists ? t.payload.value : void 0);
    });
  }
}
var ie;
(function(i) {
  i[i.Audio = 1] = "Audio", i[i.Cache = 2] = "Cache", i[i.Config = 3] = "Config", i[i.Data = 4] = "Data", i[i.LocalData = 5] = "LocalData", i[i.Document = 6] = "Document", i[i.Download = 7] = "Download", i[i.Picture = 8] = "Picture", i[i.Public = 9] = "Public", i[i.Video = 10] = "Video", i[i.Resource = 11] = "Resource", i[i.Temp = 12] = "Temp", i[i.AppConfig = 13] = "AppConfig", i[i.AppData = 14] = "AppData", i[i.AppLocalData = 15] = "AppLocalData", i[i.AppCache = 16] = "AppCache", i[i.AppLog = 17] = "AppLog", i[i.Desktop = 18] = "Desktop", i[i.Executable = 19] = "Executable", i[i.Font = 20] = "Font", i[i.Home = 21] = "Home", i[i.Runtime = 22] = "Runtime", i[i.Template = 23] = "Template";
})(ie || (ie = {}));
async function ke() {
  return l("plugin:path|resolve_directory", {
    directory: ie.AppData
  });
}
async function Be() {
  return l("plugin:path|resolve_directory", {
    directory: ie.Resource
  });
}
async function L(...i) {
  return l("plugin:path|join", { paths: i });
}
const T = {
  general: {
    startAtLogin: !1,
    showDockIcon: !0
  },
  search: {
    searchApplications: !0,
    searchSystemPreferences: !0,
    fuzzySearch: !0
  },
  shortcut: {
    modifier: "Super",
    key: "K"
  },
  appearance: {
    theme: "system",
    windowWidth: 800,
    windowHeight: 600
  },
  // Initialize with empty extensions state
  extensions: {
    enabled: {}
  }
}, v = y(T);
class We {
  constructor() {
    h(this, "initialized", !1);
    h(this, "store", null);
    h(this, "storeFilePath", "settings.dat");
    v.set(T);
  }
  /**
   * Initialize the settings service AND the system shortcuts
   */
  async init() {
    if (this.initialized) return !0;
    try {
      try {
        const e = await ke();
        this.storeFilePath = `${e}settings.dat`, this.store = await we(this.storeFilePath);
      } catch (e) {
        r.error(`Failed to create store: ${e}`), this.store = await we("settings.dat"), r.info("Using fallback store path");
      }
      await this.load(), this.initialized = !0;
      try {
        await this.syncAutostart();
      } catch (e) {
        r.error(`Autostart sync failed: ${e}`);
      }
      return await this.syncShortcut(), !0;
    } catch (e) {
      return r.error(`Failed to initialize settings: ${e}`), v.set(T), !1;
    }
  }
  /**
   * Check if the settings service is initialized
   */
  isInitialized() {
    return this.initialized;
  }
  /**
   * Load settings from persistent storage
   */
  async load() {
    try {
      if (!this.store)
        throw new Error("Store is not initialized");
      const e = await this.store.get("settings");
      if (e) {
        const t = this.mergeWithDefaults(e);
        v.set(t);
      } else
        await this.save();
    } catch (e) {
      throw r.error(`Failed to load settings: ${e}`), e;
    }
  }
  /**
   * Save current settings to persistent storage
   */
  async save() {
    try {
      if (!this.store)
        throw new Error("Store is not initialized");
      const e = S(v);
      return await this.store.set("settings", e), await this.store.save(), !0;
    } catch (e) {
      return r.error(`Failed to save settings: ${e}`), !1;
    }
  }
  /**
   * Get the current settings
   */
  getSettings() {
    return S(v);
  }
  /**
   * Update a specific section of settings
   */
  async updateSettings(e, t) {
    try {
      if (v.update((n) => (n[e] = {
        ...n[e],
        ...t
      }, n)), e === "general" && "startAtLogin" in t)
        try {
          await this.syncAutostart();
        } catch (n) {
          r.error(`Failed to sync autostart: ${n}`);
        }
      return await this.save();
    } catch (n) {
      return r.error(
        `Failed to update ${String(e)} settings: ${n}`
      ), !1;
    }
  }
  /**
   * Subscribe to settings changes
   */
  subscribe(e) {
    return v.subscribe(e);
  }
  /**
   * Sync autostart setting with system
   */
  async syncAutostart() {
    const t = S(v).general.startAtLogin;
    try {
      const n = await l("get_autostart_status");
      t !== n && await l("initialize_autostart_from_settings", {
        enable: t
      });
    } catch (n) {
      throw r.error(`Failed to sync autostart setting: ${n}`), n;
    }
  }
  /**
   * Sync system shortcut with settings
   */
  async syncShortcut() {
    try {
      const e = S(v), { modifier: t, key: n } = e.shortcut;
      await l("initialize_shortcut_from_settings", {
        modifier: t,
        key: n
      });
    } catch (e) {
      r.error(`Failed to sync shortcut: ${e}`);
    }
  }
  /**
   * Helper to merge stored settings with defaults
   */
  mergeWithDefaults(e) {
    var t;
    try {
      if (!e || typeof e != "object")
        return r.error("Stored settings not an object, using defaults"), { ...T };
      const n = e;
      return {
        general: { ...T.general, ...n == null ? void 0 : n.general },
        search: { ...T.search, ...n == null ? void 0 : n.search },
        shortcut: { ...T.shortcut, ...n == null ? void 0 : n.shortcut },
        appearance: {
          ...T.appearance,
          ...n == null ? void 0 : n.appearance
        },
        // Add extension merging
        extensions: {
          enabled: {
            ...T.extensions.enabled,
            ...(t = n == null ? void 0 : n.extensions) == null ? void 0 : t.enabled
          }
        },
        user: n == null ? void 0 : n.user
      };
    } catch (n) {
      return r.error(`Error merging settings: ${n}`), { ...T };
    }
  }
  /**
   * Update extension enabled state
   * @param extensionName Name of the extension
   * @param enabled Whether the extension should be enabled
   * @returns Success status
   */
  async updateExtensionState(e, t) {
    try {
      return v.update((n) => (n.extensions ? n.extensions.enabled || (n.extensions.enabled = {}) : n.extensions = { enabled: {} }, n.extensions.enabled[e] = t, n)), await this.save();
    } catch (n) {
      return r.error(`Failed to update extension state: ${n}`), !1;
    }
  }
  /**
   * Remove an extension's state entirely
   * @param extensionName Name of the extension to remove
   * @returns Success status
   */
  async removeExtensionState(e) {
    try {
      return v.update((t) => (t.extensions && t.extensions.enabled && delete t.extensions.enabled[e], t)), await this.save();
    } catch (t) {
      return r.error(`Failed to remove extension state: ${t}`), !1;
    }
  }
  /**
   * Check if an extension is enabled
   * @param extensionName Name of the extension to check
   * @returns Whether the extension is enabled (defaults to true if not set)
   */
  isExtensionEnabled(e) {
    var n, a;
    return ((a = (n = S(v).extensions) == null ? void 0 : n.enabled) == null ? void 0 : a[e]) !== !1;
  }
  /**
   * Get all extension states
   * @returns Record of extension names to enabled states
   */
  getExtensionStates() {
    var e;
    return ((e = S(v).extensions) == null ? void 0 : e.enabled) || {};
  }
}
const A = new We();
var $e;
(function(i) {
  i[i.Start = 0] = "Start", i[i.Current = 1] = "Current", i[i.End = 2] = "End";
})($e || ($e = {}));
async function qe(i, e) {
  if (i instanceof URL && i.protocol !== "file:")
    throw new TypeError("Must be a file URL.");
  return await l("plugin:fs|read_dir", {
    path: i instanceof URL ? i.toString() : i,
    options: e
  });
}
async function le(i, e) {
  if (i instanceof URL && i.protocol !== "file:")
    throw new TypeError("Must be a file URL.");
  await l("plugin:fs|remove", {
    path: i instanceof URL ? i.toString() : i,
    options: e
  });
}
async function te(i, e) {
  if (i instanceof URL && i.protocol !== "file:")
    throw new TypeError("Must be a file URL.");
  return await l("plugin:fs|exists", {
    path: i instanceof URL ? i.toString() : i,
    options: e
  });
}
const Q = "Request cancelled";
async function Ge(i, e) {
  const t = e == null ? void 0 : e.signal;
  if (t != null && t.aborted)
    throw new Error(Q);
  const n = e == null ? void 0 : e.maxRedirections, a = e == null ? void 0 : e.connectTimeout, s = e == null ? void 0 : e.proxy, o = e == null ? void 0 : e.danger;
  e && (delete e.maxRedirections, delete e.connectTimeout, delete e.proxy, delete e.danger);
  const c = e != null && e.headers ? e.headers instanceof Headers ? e.headers : new Headers(e.headers) : new Headers(), d = new Request(i, e), u = await d.arrayBuffer(), f = u.byteLength !== 0 ? Array.from(new Uint8Array(u)) : null;
  for (const [M, R] of d.headers)
    c.get(M) || c.set(M, R);
  const w = (c instanceof Headers ? Array.from(c.entries()) : Array.isArray(c) ? c : Object.entries(c)).map(([M, R]) => [
    M,
    // we need to ensure we have all header values as strings
    // eslint-disable-next-line
    typeof R == "string" ? R : R.toString()
  ]);
  if (t != null && t.aborted)
    throw new Error(Q);
  const $ = await l("plugin:http|fetch", {
    clientConfig: {
      method: d.method,
      url: d.url,
      headers: w,
      data: f,
      maxRedirections: n,
      connectTimeout: a,
      proxy: s,
      danger: o
    }
  }), E = () => l("plugin:http|fetch_cancel", { rid: $ });
  if (t != null && t.aborted)
    throw E(), new Error(Q);
  t == null || t.addEventListener("abort", () => void E());
  const { status: I, statusText: G, url: K, headers: ye, rid: U } = await l("plugin:http|fetch_send", {
    rid: $
  }), z = new ReadableStream({
    start: (M) => {
      const R = new Ne();
      R.onmessage = (ae) => {
        if (t != null && t.aborted) {
          M.error(Q);
          return;
        }
        const J = new Uint8Array(ae), Ue = J[J.byteLength - 1], ze = J.slice(0, J.byteLength - 1);
        if (Ue == 1) {
          M.close();
          return;
        }
        M.enqueue(ze);
      }, l("plugin:http|fetch_read_body", {
        rid: U,
        streamChannel: R
      }).catch((ae) => {
        M.error(ae);
      });
    }
  }), D = new Response(z, {
    status: I,
    statusText: G
  });
  return Object.defineProperty(D, "url", { value: K }), Object.defineProperty(D, "headers", {
    value: new Headers(ye)
  }), D;
}
const Ke = /* @__PURE__ */ Object.assign({}), _e = /* @__PURE__ */ Object.assign({
  "../../built-in-extensions/calculator/manifest.json": () => import("./manifest-DRmh_qiJ.js"),
  "../../built-in-extensions/clipboard-history/manifest.json": () => import("./manifest-SbWwwnMl.js"),
  "../../built-in-extensions/create-extension/manifest.json": () => import("./manifest-DZZlrHJk.js"),
  "../../built-in-extensions/store/manifest.json": () => import("./manifest-B13rY4_N.js")
});
async function Je() {
  try {
    const i = Object.keys(Ke), e = Object.keys(_e);
    r.debug(
      `Found ${i.length} regular extensions and ${e.length} built-in extensions`
    );
    const t = i.map((s) => {
      const o = s.match(/\/extensions\/([^\/]+)\/manifest\.json/);
      return o ? o[1] : null;
    }).filter((s) => s !== null), n = e.map((s) => {
      const o = s.match(
        /\/built-in-extensions\/([^\/]+)\/manifest\.json/
      );
      return o ? o[1] : null;
    }).filter((s) => s !== null), a = [
      ...t,
      ...n
    ];
    return r.info(
      `Discovered ${a.length} extensions (${n.length} built-in)`
    ), a;
  } catch (i) {
    return r.error(`No extensions found or error during discovery: ${i}`), [];
  }
}
function F(i) {
  return !!Object.keys(_e).find(
    (n) => n.includes(`/${i}/`)
  );
}
class Qe {
  constructor() {
    h(this, "initialized", !1);
    h(this, "isDevMode", !1);
    this.isDevMode = !1, r.info(
      `ExtensionLoader initialized in ${this.isDevMode ? "development" : "production"} mode`
    );
  }
  /**
   * Load all extensions (both built-in and installed)
   */
  async loadAllExtensions() {
    const e = /* @__PURE__ */ new Map();
    try {
      return await this.loadBuiltInExtensions(e), await this.loadInstalledExtensions(e), e;
    } catch (t) {
      return r.error(`Error loading extensions: ${t}`), e;
    }
  }
  async loadBuiltInExtensions(e) {
    try {
      r.debug("Loading built-in extensions via Vite glob");
      const t = /* @__PURE__ */ Object.assign({}), n = /* @__PURE__ */ Object.assign({});
      for (const [a, s] of Object.entries(t)) {
        const o = a.split("/")[3];
        if (e.has(o)) {
          r.debug(`Skipping built-in ${o}, already loaded.`);
          continue;
        }
        const c = `/src/built-in-extensions/${o}/manifest.json`, d = n[c], u = (d == null ? void 0 : d.default) || d;
        if (!u) {
          r.warn(`No manifest found for built-in extension ${o} at ${c}`);
          continue;
        }
        u.commands && (u.defaultView && u.defaultView !== "DefaultView" && r.warn(`Extension ${u.id} uses non-standard defaultView: ${u.defaultView}. Usage of 'DefaultView' is recommended.`), u.commands.forEach((f) => {
          f.view && f.view !== "DefaultView" && r.warn(`Command ${f.id} in extension ${u.id} uses non-standard view name: ${f.view}. Usage of 'DefaultView' is recommended.`);
        })), e.set(o, {
          module: s,
          manifest: u,
          isBuiltIn: !0
        }), r.debug(`Loaded built-in extension: ${o} (${(u == null ? void 0 : u.name) || "Unknown"})`);
      }
    } catch (t) {
      r.error(`Error loading built-in extensions: ${t}`);
    }
  }
  /**
   * Loads user-installed extensions from the app's data directory
   */
  async loadInstalledExtensions(e) {
    let t = "";
    try {
      if (t = await l("get_extensions_dir"), r.debug(`Loading installed extensions from: ${t}`), !await te(t)) {
        r.debug(`Installed extensions directory does not exist: ${t}`);
        return;
      }
      const n = await qe(t);
      for (const a of n)
        if ((a.isDirectory || a.isSymlink) && a.name) {
          const s = a.name, o = await L(t, s);
          if (e.has(s)) {
            r.warn(
              `Skipping installed extension ${s}, ID conflicts with already loaded extension.`
            );
            continue;
          }
          let c = null;
          try {
            const d = await L(o, "manifest.json");
            if (!await l("check_path_exists", { path: d })) {
              r.warn(`Manifest not found for installed extension ${s} at ${d}`);
              continue;
            }
            const f = await l("read_text_file_absolute", { pathStr: d }), g = JSON.parse(f);
            g.commands && g.commands.forEach((w) => {
              w.view && w.view !== "DefaultView" && r.warn(`Warning: extension ${s} command ${w.id} declares view '${w.view}' — expected 'DefaultView'. Extension may fail to render.`);
            }), e.set(s, {
              module: null,
              manifest: g,
              isBuiltIn: !1
              // User-installed extension
            }), r.debug(`Registered installed extension manifest: ${s} (${(g == null ? void 0 : g.name) || "Unknown"})`);
          } catch (d) {
            r.error(`Failed to load installed extension ${s} from ${o}: ${d}`);
          }
        }
    } catch (n) {
      r.error(`Error reading installed extensions directory ${t}: ${n}`);
    }
  }
  /**
   * Loads a single extension by ID
   */
  async loadSingleExtension(e) {
    try {
      if (F(e))
        try {
          const t = /* @__PURE__ */ Object.assign({}), n = /* @__PURE__ */ Object.assign({}), a = `/src/built-in-extensions/${e}/index.ts`, s = `/src/built-in-extensions/${e}/manifest.json`, o = t[a], c = n[s], d = (c == null ? void 0 : c.default) || c;
          if (!o || !d)
            throw new Error(`Module or manifest not found for built-in extension ${e} in glob paths.`);
          return {
            module: o,
            manifest: d,
            isBuiltIn: !0
          };
        } catch (t) {
          return r.error(`Failed to load built-in extension ${e}: ${t}`), null;
        }
      else
        try {
          const t = await l("get_extensions_dir"), n = await L(t, e), a = await L(n, "manifest.json");
          if (!await l("check_path_exists", { path: a }))
            return r.warn(`Manifest not found for installed extension ${e} at ${a}`), null;
          const o = await l("read_text_file_absolute", { pathStr: a });
          return {
            module: null,
            manifest: JSON.parse(o),
            isBuiltIn: !1
          };
        } catch (t) {
          return r.error(
            `Error loading single extension ${e}: ${t}`
          ), null;
        }
    } catch (t) {
      return r.error(
        `Error in loadSingleExtension for ${e}: ${t}`
      ), null;
    }
  }
}
const ve = new Qe();
var Ee;
(function(i) {
  i.Year = "year", i.Month = "month", i.TwoWeeks = "twoWeeks", i.Week = "week", i.Day = "day", i.Hour = "hour", i.Minute = "minute", i.Second = "second";
})(Ee || (Ee = {}));
var Se;
(function(i) {
  i[i.None = 0] = "None", i[i.Min = 1] = "Min", i[i.Low = 2] = "Low", i[i.Default = 3] = "Default", i[i.High = 4] = "High";
})(Se || (Se = {}));
var Ce;
(function(i) {
  i[i.Secret = -1] = "Secret", i[i.Private = 0] = "Private", i[i.Public = 1] = "Public";
})(Ce || (Ce = {}));
async function Xe() {
  return window.Notification.permission !== "default" ? await Promise.resolve(window.Notification.permission === "granted") : await l("plugin:notification|is_permission_granted");
}
async function Ye() {
  return await window.Notification.requestPermission();
}
function Ze(i) {
  typeof i == "string" ? new window.Notification(i) : new window.Notification(i.title, i);
}
async function et(i) {
  await l("plugin:notification|register_action_types", { types: i });
}
async function tt(i) {
  await l("plugin:notification|create_channel", { ...i });
}
async function nt(i) {
  await l("plugin:notification|delete_channel", { id: i });
}
async function it() {
  return await l("plugin:notification|listChannels");
}
async function rt(i) {
  return await je("notification", "actionPerformed", i);
}
class de {
  /**
   * Check if notification permission is granted
   */
  async checkPermission() {
    return await Xe();
  }
  /**
   * Request notification permission
   */
  async requestPermission() {
    return await Ye() === "granted";
  }
  /**
   * Send a notification
   */
  async notify(e) {
    let t = await this.checkPermission();
    if (!t && (t = await this.requestPermission(), !t)) {
      console.warn("Notification permission not granted");
      return;
    }
    Ze(e);
  }
  /**
   * Register action types for interactive notifications
   * (primarily for mobile platforms)
   */
  async registerActionTypes(e) {
    await et(e);
  }
  /**
   * Listen for actions performed on notifications
   */
  async listenForActions(e) {
    await rt(e);
  }
  /**
   * Create a notification channel
   * (primarily for Android, but provides consistent API across platforms)
   */
  async createChannel(e) {
    await tt(e);
  }
  /**
   * Get all notification channels
   */
  async getChannels() {
    return await it();
  }
  /**
   * Remove a notification channel
   */
  async removeChannel(e) {
    await nt(e);
  }
}
class j extends Fe {
  /**
   * Creates an Image from a resource ID. For internal use only.
   *
   * @ignore
   */
  constructor(e) {
    super(e);
  }
  /** Creates a new Image using RGBA data, in row-major order from top to bottom, and with specified width and height. */
  static async new(e, t, n) {
    return l("plugin:image|new", {
      rgba: pe(e),
      width: t,
      height: n
    }).then((a) => new j(a));
  }
  /**
   * Creates a new image using the provided bytes by inferring the file format.
   * If the format is known, prefer [@link Image.fromPngBytes] or [@link Image.fromIcoBytes].
   *
   * Only `ico` and `png` are supported (based on activated feature flag).
   *
   * Note that you need the `image-ico` or `image-png` Cargo features to use this API.
   * To enable it, change your Cargo.toml file:
   * ```toml
   * [dependencies]
   * tauri = { version = "...", features = ["...", "image-png"] }
   * ```
   */
  static async fromBytes(e) {
    return l("plugin:image|from_bytes", {
      bytes: pe(e)
    }).then((t) => new j(t));
  }
  /**
   * Creates a new image using the provided path.
   *
   * Only `ico` and `png` are supported (based on activated feature flag).
   *
   * Note that you need the `image-ico` or `image-png` Cargo features to use this API.
   * To enable it, change your Cargo.toml file:
   * ```toml
   * [dependencies]
   * tauri = { version = "...", features = ["...", "image-png"] }
   * ```
   */
  static async fromPath(e) {
    return l("plugin:image|from_path", { path: e }).then((t) => new j(t));
  }
  /** Returns the RGBA data for this image, in row-major order from top to bottom.  */
  async rgba() {
    return l("plugin:image|rgba", {
      rid: this.rid
    }).then((e) => new Uint8Array(e));
  }
  /** Returns the size of this image.  */
  async size() {
    return l("plugin:image|size", { rid: this.rid });
  }
}
function pe(i) {
  return i == null ? null : typeof i == "string" ? i : i instanceof j ? i.rid : i;
}
async function ue(i, e) {
  await l("plugin:clipboard-manager|write_text", {
    label: e == null ? void 0 : e.label,
    text: i
  });
}
async function Te() {
  return await l("plugin:clipboard-manager|read_text");
}
async function at(i) {
  await l("plugin:clipboard-manager|write_image", {
    image: pe(i)
  });
}
async function Ie() {
  return await l("plugin:clipboard-manager|read_image").then((i) => new j(i));
}
async function Me(i, e) {
  await l("plugin:clipboard-manager|write_html", {
    html: i,
    altText: e
  });
}
const p = [];
for (let i = 0; i < 256; ++i)
  p.push((i + 256).toString(16).slice(1));
function st(i, e = 0) {
  return (p[i[e + 0]] + p[i[e + 1]] + p[i[e + 2]] + p[i[e + 3]] + "-" + p[i[e + 4]] + p[i[e + 5]] + "-" + p[i[e + 6]] + p[i[e + 7]] + "-" + p[i[e + 8]] + p[i[e + 9]] + "-" + p[i[e + 10]] + p[i[e + 11]] + p[i[e + 12]] + p[i[e + 13]] + p[i[e + 14]] + p[i[e + 15]]).toLowerCase();
}
let fe;
const ot = new Uint8Array(16);
function ct() {
  if (!fe) {
    if (typeof crypto > "u" || !crypto.getRandomValues)
      throw new Error("crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported");
    fe = crypto.getRandomValues.bind(crypto);
  }
  return fe(ot);
}
const lt = typeof crypto < "u" && crypto.randomUUID && crypto.randomUUID.bind(crypto), Ae = { randomUUID: lt };
function Pe(i, e, t) {
  var a;
  if (Ae.randomUUID && !i)
    return Ae.randomUUID();
  i = i || {};
  const n = i.random ?? ((a = i.rng) == null ? void 0 : a.call(i)) ?? ct();
  if (n.length < 16)
    throw new Error("Random bytes length must be >= 16");
  return n[6] = n[6] & 15 | 64, n[8] = n[8] & 63 | 128, st(n);
}
const dt = "clipboard_history.json", ut = 90 * 24 * 60 * 60 * 1e3, ft = 1e3;
let m = null;
const q = y([]);
async function H() {
  m || (m = new Oe(dt, { autoSave: 100 }), await m.init(), q.set(await O()));
}
async function Le(i) {
  m || await H();
  try {
    let e = await O();
    if (e.some(
      (a) => i.type === a.type && (i.content && i.content === a.content || i.type === "image" && i.id === a.id)
    )) return;
    e = [i, ...e];
    const n = Date.now() - ut;
    e = e.filter((a) => a.favorite || a.createdAt > n).slice(0, ft), await (m == null ? void 0 : m.set("items", e)), q.set(e);
  } catch (e) {
    r.error(`Failed to add clipboard history item: ${e}`);
  }
}
async function O() {
  m || await H();
  try {
    return await (m == null ? void 0 : m.get("items")) || [];
  } catch (i) {
    return r.error(`Failed to get clipboard history items: ${i}`), [];
  }
}
async function gt(i) {
  m || await H();
  try {
    const t = (await O()).map(
      (n) => n.id === i ? { ...n, favorite: !n.favorite } : n
    );
    await (m == null ? void 0 : m.set("items", t)), q.set(t);
  } catch (e) {
    r.error(`Failed to toggle favorite status: ${e}`);
  }
}
async function mt(i) {
  m || await H();
  try {
    const t = (await O()).filter((n) => n.id !== i);
    await (m == null ? void 0 : m.set("items", t)), q.set(t);
  } catch (e) {
    r.error(`Failed to delete clipboard history item: ${e}`);
  }
}
async function ht() {
  m || await H();
  try {
    const e = (await O()).filter((t) => t.favorite);
    await (m == null ? void 0 : m.set("items", e)), q.set(e);
  } catch (i) {
    r.error(`Failed to clear clipboard history: ${i}`);
  }
}
function Re(i) {
  return typeof i == "string" ? /<(?=.*? .*?\/?>|.+?>)[a-z]+.*?>/i.test(i) : typeof i == "object" && i !== null && i instanceof Node;
}
const _ = class _ {
  constructor() {
    h(this, "pollingInterval", null);
    h(this, "lastTextContent", "");
    h(this, "POLLING_MS", 1e3);
  }
  /**
   * Get the singleton instance
   */
  static getInstance() {
    return _.instance || (_.instance = new _()), _.instance;
  }
  /**
   * Initialize the clipboard history service
   */
  async initialize() {
    r.debug("Initializing ClipboardHistoryService"), await H(), this.startMonitoring(), r.debug("ClipboardHistoryService initialized");
  }
  /**
   * Start monitoring clipboard for changes
   */
  startMonitoring() {
    this.pollingInterval || (this.captureCurrentClipboard(), this.pollingInterval = window.setInterval(() => {
      this.captureCurrentClipboard();
    }, this.POLLING_MS), r.debug("Started clipboard monitoring"));
  }
  /**
   * Stop monitoring clipboard
   */
  stopMonitoring() {
    this.pollingInterval && (clearInterval(this.pollingInterval), this.pollingInterval = null, r.debug("Stopped clipboard monitoring"));
  }
  /**
   * Capture current clipboard content
   */
  async captureCurrentClipboard() {
    try {
      await this.captureTextContent(), await this.captureImageContent();
    } catch (e) {
      r.error(`Error capturing clipboard content: ${e}`);
    }
  }
  /**
   * Capture text/HTML content from clipboard
   */
  async captureTextContent() {
    try {
      const e = await Te();
      if (this.lastTextContent = e, !e) return;
      const t = Re(e) ? b.Html : b.Text, n = {
        id: Pe(),
        type: t,
        content: e,
        preview: this.createPreview(e, t),
        createdAt: Date.now(),
        favorite: !1
      };
      await Le(n);
    } catch (e) {
      r.error(`Error capturing text content: ${e}`);
    }
  }
  /**
   * Capture image content from clipboard
   */
  async captureImageContent() {
    try {
      const e = await Ie(), t = new Blob([await e.rgba()], { type: "image" }), n = URL.createObjectURL(t), a = Pe();
      if (!e) return;
      const s = {
        id: a,
        type: b.Image,
        content: n,
        preview: `Image: ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`,
        createdAt: Date.now(),
        favorite: !1
      };
      await Le(s);
    } catch {
    }
  }
  /**
   * Create a preview of clipboard content
   */
  createPreview(e, t) {
    if (!e) return "No preview available";
    if (t === b.Html) {
      const n = document.createElement("div");
      n.innerHTML = e;
      const a = n.textContent || n.innerText || "";
      return this.truncateText(a);
    } else if (t === b.Text)
      return this.truncateText(e);
    return "No preview available";
  }
  /**
   * Truncate text for preview
   */
  truncateText(e, t = 100) {
    return e.length > t ? e.substring(0, t) + "..." : e;
  }
  /**
   * Format clipboard item for display
   */
  formatClipboardItem(e) {
    return e.type === b.Image ? `Image captured on ${new Date(e.createdAt).toLocaleString()}` : e.content ? this.truncateText(e.content) : "";
  }
  /**
   * Write item back to clipboard and simulate paste
   */
  async pasteItem(e) {
    try {
      await this.hideWindow(), await this.writeToClipboard(e), await this.simulatePaste();
    } catch (t) {
      throw r.error(`Failed to paste clipboard item: ${t}`), t;
    }
  }
  /**
   * Hide the application window
   */
  async hideWindow() {
    try {
      await l("hide");
    } catch (e) {
      r.error(`Failed to hide window: ${e}`);
    }
  }
  /**
   * Simulate paste operation using system keyboard shortcut
   */
  async simulatePaste() {
    try {
      return await l("simulate_paste"), !0;
    } catch (e) {
      return r.error(`Failed to simulate paste: ${e}`), !1;
    }
  }
  /**
   * Write item to system clipboard based on type
   */
  async writeToClipboard(e) {
    if (!e.content)
      throw new Error("Cannot paste item with empty content");
    switch (e.type) {
      case b.Text:
        await ue(e.content);
        break;
      case b.Html:
        await this.writeHtmlContent(e.content);
        break;
      case b.Image:
        await this.writeImageContent(e.content);
        break;
      default:
        throw new Error(`Unsupported clipboard item type: ${e.type}`);
    }
  }
  /**
   * Write HTML content to clipboard with fallback
   */
  async writeHtmlContent(e) {
    const t = document.createElement("div");
    t.innerHTML = e;
    const n = t.textContent || t.innerText || "";
    try {
      typeof Me == "function" ? await Me(e) : await ue(n);
    } catch {
      await ue(n);
    }
  }
  /**
   * Write image content to clipboard
   */
  async writeImageContent(e) {
    r.debug("Writing image to clipboard");
    const t = e.replace(/^data:image\/\w+;base64,/, "");
    if (t.length === 0)
      throw new Error("Invalid image data");
    await at(t);
  }
  /**
   * Get recent clipboard items
   */
  async getRecentItems(e = 30) {
    try {
      return (await O()).filter((n) => n && n.id && n.type).slice(0, e);
    } catch (t) {
      return r.error(`Error retrieving clipboard items: ${t}`), [];
    }
  }
  /**
   * Toggle favorite status of a history item
   */
  async toggleItemFavorite(e) {
    try {
      return await gt(e), !0;
    } catch (t) {
      return r.error(`Error toggling item favorite status: ${t}`), !1;
    }
  }
  /**
   * Delete an item from history
   */
  async deleteItem(e) {
    try {
      return await mt(e), !0;
    } catch (t) {
      return r.error(`Error deleting history item: ${t}`), !1;
    }
  }
  /**
   * Clear non-favorite items from history
   */
  async clearNonFavorites() {
    try {
      return await ht(), !0;
    } catch (e) {
      return r.error(`Error clearing non-favorite items: ${e}`), !1;
    }
  }
  /**
   * Normalize image data to ensure consistent format
   */
  normalizeImageData(e) {
    let t = e.replace(
      "data:image/png;base64, ",
      "data:image/png;base64,"
    );
    return t.startsWith("data:") || (t = `data:image/png;base64,${t}`), t;
  }
  /**
   * Check if image data is valid
   */
  isValidImageData(e) {
    return !(!e || e.includes("AAAAAAAA"));
  }
  /**
   * Read the current content from the clipboard
   * Added for ClipboardApi to use instead of direct plugin access
   */
  async readCurrentClipboard() {
    try {
      try {
        const t = await Ie();
        if (t) {
          const n = await t.rgba();
          if (n.byteLength > 0) {
            r.debug(
              `Read image from clipboard (size: ${n.byteLength})`
            );
            const a = new Uint8Array(n);
            let s = "";
            for (let c = 0; c < a.byteLength; c++)
              s += String.fromCharCode(a[c]);
            const o = window.btoa(s);
            return {
              type: b.Image,
              content: `data:image/png;base64,${o}`
            };
          }
        }
      } catch (t) {
        r.error(`Failed to read image from clipboard: ${t}`);
      }
      const e = await Te();
      return e ? {
        type: Re(e) ? b.Html : b.Text,
        content: e
      } : {
        type: b.Text,
        content: ""
      };
    } catch (e) {
      return r.error(`Failed to read from clipboard: ${e}`), { type: b.Text, content: "" };
    }
  }
};
h(_, "instance");
let re = _;
const B = y({}), X = y({
  startupTime: 0,
  totalMemoryUsage: 0,
  extensionLoadCount: 0,
  maxMemoryUsage: 0,
  startTimestamp: Date.now()
}), ge = /* @__PURE__ */ new Map();
class wt {
  constructor() {
    h(this, "initialized", !1);
    h(this, "loadingStartTimes", /* @__PURE__ */ new Map());
    h(this, "executionStartTimes", /* @__PURE__ */ new Map());
    h(this, "lazyLoadingViolations", /* @__PURE__ */ new Set());
    // Configuration
    h(this, "config", {
      // Threshold in ms after which we consider an extension load "slow"
      slowLoadThreshold: 300,
      // Threshold in ms after which we consider a method execution "slow"
      slowExecutionThreshold: 100,
      // How often to log performance report (in ms)
      performanceReportInterval: 6e4 * 5
      // 5 minutes
    });
  }
  /**
   * Initialize the performance service
   */
  async init() {
    if (!this.initialized)
      try {
        r.custom(
          "🚀 Initializing performance monitoring service...",
          "PERF",
          "magenta",
          "bgMagenta"
        );
        const e = performance.now();
        X.update((a) => ({
          ...a,
          startupTime: e,
          startTimestamp: Date.now(),
          maxMemoryUsage: this.getMemoryUsage()
        }));
        const t = this.getMemoryUsage();
        r.custom(
          `📊 Initial memory usage: ${this.formatMemory(t)}`,
          "PERF",
          "cyan"
        );
        const n = this.config.performanceReportInterval;
        r.custom(
          `⏰ Performance reports will be generated every ${this.formatTime(
            n
          )}`,
          "PERF",
          "cyan"
        ), setInterval(() => this.logPerformanceReport(), n), this.initialized = !0, r.custom(
          "✅ Performance monitoring service initialized successfully",
          "PERF",
          "green",
          "bgGreen"
        ), this.logPerformanceReport();
      } catch (e) {
        r.error(`Failed to initialize performance service: ${e}`);
      }
  }
  /**
   * Start timing an operation
   */
  startTiming(e) {
    const t = performance.now(), n = this.getMemoryUsage();
    ge.set(e, {
      startTime: t,
      memoryBefore: n
    }), r.custom(
      `▶️ Started timing operation: ${e}`,
      "PERF",
      "blue"
    );
  }
  /**
   * Stop timing an operation and return the duration
   */
  stopTiming(e) {
    const t = performance.now(), n = ge.get(e);
    if (!n)
      return r.warn(
        `Attempted to stop timing for unknown operation: ${e}`
      ), {
        startTime: t,
        endTime: t,
        duration: 0
      };
    const a = this.getMemoryUsage(), s = t - n.startTime, o = {
      startTime: n.startTime,
      endTime: t,
      duration: s,
      memoryBefore: n.memoryBefore,
      memoryAfter: a,
      memoryDelta: n.memoryBefore ? a - n.memoryBefore : void 0
    };
    return ge.delete(e), r.custom(
      `⏹️ Completed timing operation: ${e} (${s.toFixed(
        2
      )}ms)`,
      "PERF",
      "blue"
    ), o;
  }
  /**
   * Track when an extension begins loading
   */
  trackExtensionLoadStart(e, t = !0) {
    this.loadingStartTimes.set(e, performance.now()), B.update((n) => {
      const a = n[e] || {
        id: e,
        loadCount: 0,
        unloadCount: 0,
        averageLoadTime: 0,
        loadTimes: [],
        methodExecutionTimes: {},
        isCurrentlyLoaded: !1,
        loadedWithoutUserAction: !1
      };
      return {
        ...n,
        [e]: {
          ...a,
          loadTimestamp: Date.now(),
          loadedWithoutUserAction: !t
        }
      };
    }), t || (this.lazyLoadingViolations.add(e), r.custom(
      `⚠️ Extension "${e}" is being loaded without explicit user action!`,
      "PERF",
      "yellow",
      "bgYellow"
    ), r.warn(
      "This violates lazy loading principles. Extensions should only load when explicitly requested by the user."
    ));
  }
  /**
   * Track when an extension finishes loading
   */
  trackExtensionLoadEnd(e) {
    const t = this.loadingStartTimes.get(e);
    if (!t) {
      r.warn(
        `No load start time recorded for extension: ${e}`
      );
      return;
    }
    const n = performance.now() - t;
    this.loadingStartTimes.delete(e), B.update((a) => {
      const s = a[e] || {
        id: e,
        loadCount: 0,
        unloadCount: 0,
        averageLoadTime: 0,
        loadTimes: [],
        methodExecutionTimes: {},
        isCurrentlyLoaded: !1,
        loadedWithoutUserAction: !1
      }, o = [...s.loadTimes, n], c = o.reduce((d, u) => d + u, 0) / o.length;
      return {
        ...a,
        [e]: {
          ...s,
          loadCount: s.loadCount + 1,
          lastLoadTime: n,
          averageLoadTime: c,
          loadTimes: o,
          isCurrentlyLoaded: !0
        }
      };
    }), X.update((a) => ({
      ...a,
      extensionLoadCount: a.extensionLoadCount + 1
    })), n > this.config.slowLoadThreshold && r.custom(
      `🐢 Slow extension load: "${e}" took ${n.toFixed(
        2
      )}ms to load`,
      "PERF",
      "yellow"
    ), r.custom(
      `📊 Extension "${e}" loaded in ${n.toFixed(2)}ms`,
      "PERF",
      "cyan"
    );
  }
  /**
   * Track when an extension is unloaded
   */
  trackExtensionUnload(e) {
    const t = performance.now();
    B.update((n) => {
      const a = n[e];
      return a ? {
        ...n,
        [e]: {
          ...a,
          unloadCount: a.unloadCount + 1,
          lastUnloadTime: t,
          isCurrentlyLoaded: !1
        }
      } : (r.warn(
        `Attempted to unload unknown extension: ${e}`
      ), n);
    }), r.custom(`📤 Extension "${e}" unloaded`, "PERF", "blue");
  }
  /**
   * Track the execution time of an extension method
   */
  trackMethodExecutionStart(e, t) {
    const n = `${e}:${t}`;
    this.executionStartTimes.set(n, performance.now());
  }
  /**
   * Complete tracking the execution time of an extension method
   */
  trackMethodExecutionEnd(e, t) {
    const n = `${e}:${t}`, a = this.executionStartTimes.get(n);
    if (!a) {
      r.warn(`No execution start time recorded for: ${n}`);
      return;
    }
    const s = performance.now() - a;
    this.executionStartTimes.delete(n), B.update((o) => {
      const c = o[e] || {
        id: e,
        loadCount: 0,
        unloadCount: 0,
        averageLoadTime: 0,
        loadTimes: [],
        methodExecutionTimes: {},
        isCurrentlyLoaded: !1,
        loadedWithoutUserAction: !1
      }, d = c.methodExecutionTimes[t] || [];
      return {
        ...o,
        [e]: {
          ...c,
          methodExecutionTimes: {
            ...c.methodExecutionTimes,
            [t]: [...d, s]
          }
        }
      };
    }), s > this.config.slowExecutionThreshold && r.custom(
      `⏱️ Slow method execution: "${e}.${t}" took ${s.toFixed(
        2
      )}ms`,
      "PERF",
      "yellow"
    );
  }
  /**
   * Get current memory usage
   */
  getMemoryUsage() {
    return window.performance && performance.memory ? performance.memory.usedJSHeapSize : 0;
  }
  /**
   * Log a comprehensive performance report
   */
  logPerformanceReport() {
    const e = S(B), t = S(X), n = this.getMemoryUsage();
    X.update((f) => ({
      ...f,
      totalMemoryUsage: n,
      maxMemoryUsage: Math.max(f.maxMemoryUsage, n)
    }));
    const a = Object.values(e).filter(
      (f) => f.isCurrentlyLoaded
    ), s = Array.from(this.lazyLoadingViolations), o = [
      `Uptime: ${this.formatTime(Date.now() - t.startTimestamp)}`,
      `Total memory: ${this.formatMemory(n)}`,
      `Peak memory: ${this.formatMemory(t.maxMemoryUsage)}`,
      `Total extension loads: ${t.extensionLoadCount}`
    ].join(`
`), c = a.length === 0 ? "None" : a.map((f) => `• ${f.id} - loaded for ${this.formatTime(
      Date.now() - (f.loadTimestamp || 0)
    )}`).join(`
`), d = s.length === 0 ? "None" : s.map((f) => `• ${f}`).join(`
`), u = [
      "📊 PERFORMANCE REPORT",
      "═════════════════════",
      "",
      "🔄 Runtime Statistics:",
      o,
      "",
      "📱 Currently Loaded Extensions:",
      c,
      "",
      "⚠️ Lazy Loading Violations:",
      d
    ].join(`
`);
    r.custom(u, "PERF", "magenta"), s.length > 0 && r.custom(
      "RECOMMENDATION: Extensions should follow lazy loading principles. They should only be loaded when explicitly requested by the user, not at startup or implicitly.",
      "PERF",
      "yellow"
    );
  }
  /**
   * Format memory size for human-readable output
   */
  formatMemory(e) {
    if (e === 0) return "N/A";
    const t = ["Bytes", "KB", "MB", "GB"];
    let n = 0, a = e;
    for (; a > 1024 && n < t.length - 1; )
      a /= 1024, n++;
    return `${a.toFixed(2)} ${t[n]}`;
  }
  /**
   * Format time duration for human-readable output
   */
  formatTime(e) {
    const t = e / 1e3;
    if (t < 60)
      return `${t.toFixed(1)}s`;
    const n = Math.floor(t / 60), a = t % 60;
    if (n < 60)
      return `${n}m ${Math.floor(a)}s`;
    const s = Math.floor(n / 60), o = n % 60;
    return `${s}h ${o}m`;
  }
}
const x = new wt(), k = y(null), Y = y(!1);
let C = [], N = null, me = null, Z = null, W = null, he = null;
const P = {
  // Initialize with necessary dependencies from the main manager
  init(i, e, t, n) {
    me = i, Z = e, W = t, he = n, C = [], N = null, k.set(null), Y.set(!1), r.debug("ViewManager initialized and state reset.");
  },
  navigateToView(i) {
    if (r.info(`[ViewManager] navigateToView called with path: ${i}`), !me || !W) {
      r.error("ViewManager not initialized properly.");
      return;
    }
    const e = i.split("/")[0], t = me.get(e);
    if (t) {
      r.info(`Navigating to view: ${i} for extension: ${t.id}`), C.length === 0 && (N = S(ce), r.debug(`First view navigation, saving initial query: "${N}"`));
      const n = {
        viewPath: i,
        searchable: t.searchable ?? !1,
        extensionId: t.id
      };
      C.push(n), k.set(n.viewPath), Y.set(n.searchable), ce.set(""), W(t.id, i), r.debug(`Navigated to view: ${i}, searchable: ${n.searchable}. Stack size: ${C.length}`);
    } else
      r.error(`Cannot navigate: No enabled extension found with ID: ${e}`);
  },
  // Renamed from closeView
  goBack() {
    if (C.length === 0) {
      r.warn("goBack called but navigation stack is empty.");
      return;
    }
    const i = C.pop();
    if (r.debug(`Going back from view: ${i == null ? void 0 : i.viewPath}. Stack size after pop: ${C.length}`), C.length === 0)
      r.debug("Navigation stack empty, returning to main view."), k.set(null), Y.set(!1), r.debug(`Restoring initial main query: "${N}"`), ce.set(N ?? ""), N = null, i && he && he(i.extensionId, i.viewPath);
    else {
      const e = C[C.length - 1];
      r.debug(`Returning to previous view: ${e.viewPath}`), k.set(e.viewPath), Y.set(e.searchable), W && W(e.extensionId, e.viewPath);
    }
  },
  async handleViewSearch(i) {
    if (S(k) && Z)
      try {
        await Z(i);
      } catch (e) {
        r.error(`Error during handleViewSearch propagation: ${e}`);
      }
    else Z || r.warn("View search attempted but no handler is registered.");
  },
  getActiveView() {
    return S(k);
  },
  isViewActive() {
    return S(k) !== null;
  },
  // Helper to get the current stack size (for debugging or potential future use)
  getNavigationStackSize() {
    return C.length;
  }
};
y(-1);
y(!1);
y(!1);
y(0);
const pt = y(null), yt = {
  // Real strings discovered in SDK for existing services
  "asyar:api:clipboard:readCurrentClipboard": "clipboard:read",
  "asyar:api:clipboard:getRecentItems": "clipboard:read",
  "asyar:api:clipboard:writeToClipboard": "clipboard:write",
  "asyar:api:clipboard:pasteItem": "clipboard:write",
  "asyar:api:clipboard:simulatePaste": "clipboard:write",
  "asyar:api:clipboard:toggleItemFavorite": "clipboard:write",
  "asyar:api:clipboard:deleteItem": "clipboard:write",
  "asyar:api:clipboard:clearNonFavorites": "clipboard:write",
  "asyar:api:notification:notify": "notifications:send",
  "asyar:api:notification:show": "notifications:send",
  "asyar:api:invoke": "shell:execute",
  // Safe gate for raw Tauri commands
  // Intended future design strings from architecture docs (future-proofing)
  "asyar:service:ClipboardService:read": "clipboard:read",
  "asyar:service:ClipboardService:write": "clipboard:write",
  "asyar:service:ClipboardHistoryService:get": "clipboard:read",
  "asyar:service:NotificationService:show": "notifications:send",
  "asyar:service:NotificationService:info": "notifications:send",
  "asyar:service:NotificationService:error": "notifications:send",
  "asyar:service:StoreService:get": "store:read",
  "asyar:service:StoreService:set": "store:write",
  "asyar:service:StoreService:delete": "store:write",
  "asyar:service:StoreService:list": "store:read",
  "asyar:service:FileService:read": "fs:read",
  "asyar:service:FileService:write": "fs:write",
  "asyar:service:FileService:list": "fs:read",
  "asyar:service:FileService:delete": "fs:write",
  "asyar:service:ShellService:execute": "shell:execute",
  "asyar:service:NetworkService:fetch": "network"
};
function xt(i, e, t) {
  const n = yt[e];
  return n ? t.includes(n) ? { allowed: !0 } : {
    allowed: !1,
    requiredPermission: n,
    reason: `Extension "${i}" called "${e}" but did not declare permission "${n}" in its manifest.json`
  } : { allowed: !0 };
}
const ee = y(null), bt = y({}), $t = y({});
class vt {
  constructor() {
    h(this, "bridge", He.getInstance());
    // Removed: private extensions: Extension[] = []; // Now managed via extensionsById
    h(this, "manifestsById", /* @__PURE__ */ new Map());
    // Changed name for clarity
    // Removed: private extensionManifestMap: Map<Extension, ExtensionManifest> = new Map(); // No longer needed?
    h(this, "extensionModulesById", /* @__PURE__ */ new Map());
    // Map ID to the full loaded module object
    h(this, "initialized", !1);
    // Removed: private savedMainQuery = "";
    // Removed: currentExtension: Extension | null = null; // State now managed within viewManager or via lookup
    h(this, "allLoadedCommands", []);
    h(this, "mountedComponents", /* @__PURE__ */ new Map());
    // mountId -> component instance
    h(this, "isReady", y(!1));
    this.bridge.registerService("ExtensionManager", this), this.bridge.registerService("LogService", r), this.bridge.registerService(
      "NotificationService",
      new de()
    ), this.bridge.registerService(
      "ClipboardHistoryService",
      re.getInstance()
    ), this.bridge.registerService("ActionService", be), this.bridge.registerService("CommandService", V), this.setupIpcHandler();
  }
  // Add this store
  // Getter to satisfy IExtensionManager interface based on viewManager state
  get currentExtension() {
    const e = P.getActiveView();
    if (!e) return null;
    const t = e.split("/")[0], n = this.extensionModulesById.get(t);
    return (n == null ? void 0 : n.default) || n || null;
  }
  // Public getter for the full module, needed by +page.svelte
  getLoadedExtensionModule(e) {
    return this.extensionModulesById.get(e);
  }
  searchAll(e) {
    throw new Error("Method not implemented.");
  }
  async init() {
    var e, t;
    if (this.initialized)
      return r.debug("ExtensionManager already initialized."), !0;
    r.custom("🔄 Initializing extension manager...", "EXTN", "blue");
    try {
      typeof x.init == "function" && !x.init && (await x.init(), r.custom(
        "🔍 Performance monitoring initialized by extension manager",
        "PERF",
        "cyan"
      )), A.isInitialized() || await A.init(), x.startTiming("extension-loading"), await this.loadExtensions();
      const n = x.stopTiming("extension-loading");
      r.custom(
        `🧩 Extensions loaded in ${(e = n.duration) == null ? void 0 : e.toFixed(2)}ms`,
        "PERF",
        "green"
      ), P.init(
        this.manifestsById,
        this.handleExtensionSearch.bind(this),
        // Pass bound methods as handlers
        this.handleExtensionViewActivated.bind(this),
        this.handleExtensionViewDeactivated.bind(this)
      ), x.startTiming("command-index-sync"), await this.syncCommandIndex();
      const a = x.stopTiming("command-index-sync");
      return r.custom(
        `🔄 Commands index synced in ${(t = a.duration) == null ? void 0 : t.toFixed(2)}ms`,
        "PERF",
        "blue"
      ), this.initialized = !0, !0;
    } catch (n) {
      return r.error(`Failed to initialize extension manager: ${n}`), !1;
    }
  }
  async handleCommandAction(e) {
    r.debug(`Handling command action for: ${e}`);
    try {
      if (e === "ext_store") {
        this.navigateToView("store/DefaultView");
        return;
      }
      if (e === "ext_clipboard") {
        this.navigateToView("clipboard-history/DefaultView");
        return;
      }
      await V.executeCommand(e), se.isTauri && (r.debug(`Recording usage for command: ${e}`), l("record_item_usage", { objectId: e }).then(() => r.debug(`Usage recorded for ${e}`)).catch(
        (t) => r.error(
          `Failed to record usage for ${e}: ${t}`
        )
      ));
    } catch (t) {
      r.error(
        `Error handling command action for ${e}: ${t}`
      );
    }
  }
  getCmdObjectId(e, t) {
    const n = e.id || "unknown_cmd";
    return `cmd_${t.id || "unknown_ext"}_${n}`;
  }
  async syncCommandIndex() {
    r.info("Starting command index synchronization...");
    try {
      const e = this.allLoadedCommands, t = /* @__PURE__ */ new Map();
      e.forEach((u) => {
        var f, g;
        if ((f = u.manifest) != null && f.id && ((g = u.cmd) != null && g.id)) {
          const w = this.getCmdObjectId(
            u.cmd,
            u.manifest
          );
          t.set(w, u);
        } else
          r.warn(
            `Skipping command in sync due to missing ID in cmd or manifest: ${JSON.stringify(
              u
            )}`
          );
      });
      const n = new Set(t.keys()), a = await oe.getIndexedObjectIds("cmd_"), s = [], o = [];
      t.forEach(({ cmd: u, manifest: f }, g) => {
        f.id && u.id && s.push({
          category: "command",
          id: g,
          name: u.name,
          extension: f.id,
          trigger: u.trigger || u.name,
          type: u.resultType || f.type
        });
      }), a.forEach((u) => {
        n.has(u) || o.push(u);
      }), r.info(
        `Command Sync: ${s.length} items to index, ${o.length} items to delete.`
      );
      const c = s.map(
        (u) => oe.indexItem(u)
      ), d = o.map(
        (u) => oe.deleteItem(u)
      );
      await Promise.all([...c, ...d]), r.info("Command index synchronization completed.");
    } catch (e) {
      throw r.error(`Failed to synchronize command index: ${e}`), e;
    }
  }
  async reloadExtensions() {
    var e;
    r.info("Explicitly reloading extensions...");
    try {
      this.manifestsById.forEach((a) => {
        a && a.id && V.clearCommandsForExtension(a.id);
      }), x.startTiming("extension-reloading"), await this.loadExtensions(), x.startTiming("command-index-sync"), await this.syncCommandIndex();
      const t = x.stopTiming("command-index-sync"), n = x.stopTiming("extension-reloading");
      r.custom(
        `🔄 Extensions reloaded and synced in ${(e = n.duration) == null ? void 0 : e.toFixed(2)}ms`,
        "PERF",
        "green"
      );
    } catch (t) {
      throw r.error(`Failed to reload extensions: ${t}`), t;
    }
  }
  async unloadExtensions() {
    if (this.manifestsById.forEach((e) => {
      e && e.id && V.clearCommandsForExtension(e.id);
    }), await this.bridge.deactivateExtensions(), this.extensionModulesById.clear(), this.manifestsById.clear(), this.allLoadedCommands = [], this.initialized = !1, P.isViewActive())
      for (; P.getNavigationStackSize() > 0; )
        P.goBack();
    r.info("Extensions unloaded and state cleared.");
  }
  // Updated loadExtensions to use the service
  async loadExtensions() {
    r.debug(
      "Starting loadExtensions process using extensionLoaderService..."
    );
    try {
      this.extensionModulesById.clear(), this.manifestsById.clear(), this.allLoadedCommands = [];
      const e = await ve.loadAllExtensions();
      let t = 0, n = 0;
      for (const [
        a,
        { module: s, manifest: o, isBuiltIn: c }
        // Destructure isBuiltIn
      ] of e.entries()) {
        if (!o || !o.id) {
          r.warn(`Skipping extension loader ID ${a} due to missing manifest or manifest ID.`);
          continue;
        }
        const d = o.id;
        if (c || A.isExtensionEnabled(d)) {
          if (x.trackExtensionLoadStart(d), this.extensionModulesById.set(d, s), this.manifestsById.set(d, o), this.bridge.registerManifest(o), c) {
            const f = (s == null ? void 0 : s.default) || s;
            if (!f) {
              r.error(`Module for built-in extension ${d} does not have a default export or is invalid.`);
              continue;
            }
            this.bridge.registerExtensionImplementation(d, f);
          } else
            r.debug(`Registered installed extension: ${d} (Iframe Sandbox)`);
          o.commands && o.commands.forEach((f) => {
            f && f.id ? this.allLoadedCommands.push({ cmd: f, manifest: o }) : r.warn(
              `Skipping command due to missing ID in manifest: ${o.id}`
              // manifest is guaranteed non-null here
            );
          }), x.trackExtensionLoadEnd(o.id), t++;
        } else
          r.debug(`Extension ${a} is loaded but disabled.`), n++;
      }
      t > 0 ? (x.startTiming("extension-initialization-activation"), await this.bridge.initializeExtensions(), await this.bridge.activateExtensions(), x.stopTiming("extension-initialization-activation"), this.registerCommandHandlersFromManifests()) : r.debug("No enabled extensions to initialize or activate."), r.debug(
        `Extensions loading complete: ${t} enabled, ${n} disabled`
      ), this.isReady.set(!0), r.debug("[ExtensionManager] Ready.");
    } catch (e) {
      r.error(`Failed during loadExtensions processing: ${e}`), this.extensionModulesById.clear(), this.manifestsById.clear(), this.allLoadedCommands = [];
    }
  }
  registerCommandHandlersFromManifests() {
    r.debug(
      `Registering command handlers for ${this.allLoadedCommands.length} loaded commands.`
    ), this.allLoadedCommands.forEach(({ cmd: e, manifest: t }) => {
      try {
        const n = F(t.id), a = this.extensionModulesById.get(t.id);
        if (n && !a) {
          r.warn(
            `Could not find loaded extension module for built-in ID: ${t.id} while registering command: ${e.id}`
          );
          return;
        }
        if (!e.id || !t.id) {
          r.warn(
            "Skipping command registration due to missing ID in cmd or manifest."
          );
          return;
        }
        const s = this.getCmdObjectId(e, t), o = e.id, c = (a == null ? void 0 : a.default) || a;
        if (n && (!c || typeof c.executeCommand != "function")) {
          r.error(`Invalid extension instance or missing executeCommand for built-in extension ${t.id}.`);
          return;
        }
        const d = {
          execute: async (u) => {
            try {
              if (n)
                return await c.executeCommand(o, u);
              {
                const f = e.view || t.defaultView || "DefaultView";
                this.navigateToView(`${t.id}/${f}`);
              }
            } catch (f) {
              throw r.error(
                `Error executing command ${o} in extension ${t.id}: ${f}`
              ), f;
            }
          }
        };
        V.registerCommand(s, d, t.id), r.debug(
          `Registered handler for command: ${o} (ID: ${s}) for extension: ${t.id}`
        );
      } catch (n) {
        r.error(
          `Error registering handler for command ${(e == null ? void 0 : e.id) || "unknown"} of extension ${(t == null ? void 0 : t.id) || "unknown"}: ${n}`
        );
      }
    }), r.info(
      "Finished registering command handlers for enabled extensions."
    );
  }
  // --- Public method to get manifest ---
  // Set up IPC handler for iframe messages
  setupIpcHandler() {
    window.addEventListener("message", async (e) => {
      var d, u, f;
      const { type: t, payload: n, messageId: a, extensionId: s } = e.data;
      if (!t || !t.startsWith("asyar:") || t === "asyar:response") return;
      const o = e.source === window, c = s || (n == null ? void 0 : n.extensionId);
      if (!o) {
        if (!c) {
          r.error(`[Main] Rejected IPC message: No extensionId provided by untrusted frame for type ${t}`);
          return;
        }
        const g = this.getManifestById(c);
        if (!g) {
          r.error(`[Main] Unauthorized: No registered manifest found for iframe extension ${c}`), (d = e.source) == null || d.postMessage({
            type: "asyar:response",
            messageId: a,
            success: !1,
            error: `Unknown extension: ${c}`
          }, { targetOrigin: "*" });
          return;
        }
        const w = xt(
          c,
          t,
          g.permissions ?? []
        );
        if (!w.allowed) {
          r.warn(`[PermissionGate] BLOCKED: ${w.reason}`), (u = e.source) == null || u.postMessage({
            type: "asyar:response",
            messageId: a,
            success: !1,
            error: `Permission denied: "${w.requiredPermission}" is required but not declared in manifest.json`
          }, { targetOrigin: "*" });
          return;
        }
      }
      r.debug(`[Main] Received IPC message${c ? ` from ${c}` : " from Privileged Host Context"}: ${t}`);
      try {
        let g;
        if (t.startsWith("asyar:api:") || t.startsWith("asyar:service:")) {
          const w = t.split(":");
          let $ = "", E = "", I = t.startsWith("asyar:service:");
          I ? ($ = w[2], E = w[3]) : ($ = w[2], E = w[3] || w[2]);
          const K = {
            log: "LogService",
            extension: "ExtensionManager",
            notification: "NotificationService",
            clipboard: "ClipboardHistoryService",
            command: "CommandService",
            action: "ActionService"
          }[$] || $;
          if (t === "asyar:api:invoke")
            se.isTauri ? g = await l(n.cmd, n.args) : (r.warn(`[Main] Mocking invoke for ${n.cmd} in browser`), g = null);
          else {
            const U = {
              LogService: r,
              ExtensionManager: this,
              NotificationService: new de(),
              ClipboardHistoryService: re.getInstance(),
              CommandService: V,
              ActionService: be
            }[K];
            if (U && typeof U[E] == "function")
              if (I && Array.isArray(n))
                g = await U[E](...n);
              else {
                let z;
                if (n == null)
                  z = [];
                else if (typeof n != "object" || Array.isArray(n))
                  z = Array.isArray(n) ? n : [n];
                else {
                  const D = Object.values(n);
                  z = D.length === 0 ? [] : D;
                }
                g = await U[E](...z);
              }
            else t === "asyar:extension:loaded" ? r.info(`Extension ready: ${c}`) : t === "asyar:api:notification:show" ? new de().notify(n) : r.warn(`[Main] Dispatch failed for ${t}: Service ${K}.${E} not found`);
          }
        }
        e.source.postMessage({
          type: "asyar:response",
          messageId: a,
          result: g,
          success: !0
        }, "*");
      } catch (g) {
        r.error(`[Main] IPC handling error for ${c}: ${g}`), (f = e.source) == null || f.postMessage({
          type: "asyar:response",
          messageId: a,
          error: g instanceof Error ? g.message : String(g),
          success: !1
        }, { targetOrigin: "*" });
      }
    });
  }
  getManifestById(e) {
    return this.manifestsById.get(e);
  }
  setActiveViewActionLabel(e) {
    r.info(`[ExtensionManager] Setting active view action label to: ${e}`), pt.set(e);
  }
  // --- Methods delegated to ViewManager ---
  navigateToView(e) {
    r.info(`[ExtensionManager] Navigating to view: ${e}`);
    const t = e.split("/")[0], n = this.manifestsById.get(t);
    if (n && n.id) {
      r.info(
        `Extension view opened: ${e} for extension: ${n.id}`
      );
      const a = Date.now();
      bt.update((s) => {
        const o = s[n.id] || 0;
        return { ...s, [n.id]: o + 1 };
      }), $t.update((s) => ({ ...s, [n.id]: a }));
    } else
      r.warn(
        `Could not find manifest for ID ${t} while updating usage stats.`
      );
    P.navigateToView(e);
  }
  // Renamed from closeView to match interface
  goBack() {
    P.goBack();
  }
  handleViewSearch(e) {
    return P.handleViewSearch(e);
  }
  // --- Internal handlers passed to ViewManager ---
  async handleExtensionSearch(e) {
    const t = P.getActiveView();
    if (!t) return;
    const n = t.split("/")[0], a = this.extensionModulesById.get(n), s = (a == null ? void 0 : a.default) || a;
    if (s && typeof s.onViewSearch == "function")
      try {
        await s.onViewSearch(e);
      } catch (o) {
        r.error(
          `Error calling onViewSearch for extension ${n}: ${o}`
        );
      }
    else s ? r.debug(
      `onViewSearch not implemented by extension ${n}`
    ) : r.warn(
      `Extension not found for ID: ${n} during view search.`
    );
  }
  handleExtensionViewActivated(e, t) {
    const n = this.extensionModulesById.get(e), a = (n == null ? void 0 : n.default) || n;
    if (a && typeof a.viewActivated == "function")
      try {
        a.viewActivated(t);
      } catch (s) {
        r.error(
          `Error during viewActivated for ${e}: ${s}`
        );
      }
  }
  handleExtensionViewDeactivated(e, t) {
    if (!e || !t) return;
    const n = this.extensionModulesById.get(e), a = (n == null ? void 0 : n.default) || n;
    if (a && typeof a.viewDeactivated == "function")
      try {
        a.viewDeactivated(t);
      } catch (s) {
        r.error(
          `Error during viewDeactivated for ${e}: ${s}`
        );
      }
  }
  // --- Existing Methods (potentially adapted) ---
  isExtensionEnabled(e) {
    return F(e) ? !0 : A.isExtensionEnabled(e);
  }
  async toggleExtensionState(e, t) {
    if (F(e) && !t)
      return r.warn(`Cannot disable built-in extension: ${e}`), !1;
    try {
      const n = await A.updateExtensionState(
        e,
        t
      );
      return n && (r.info(
        `Extension '${e}' state set to ${t ? "enabled" : "disabled"}. Reloading extensions...`
      ), await this.unloadExtensions(), await this.loadExtensions(), await this.syncCommandIndex()), n;
    } catch (n) {
      return r.error(
        `Failed to toggle extension state for '${e}': ${n}`
      ), !1;
    }
  }
  async getAllExtensionsWithState() {
    var e;
    try {
      const t = await Je(), n = [];
      for (const a of t)
        try {
          const s = F(a), o = await ve.loadSingleExtension(a);
          if (o && o.manifest) {
            const c = o.manifest;
            n.push({
              title: c.name,
              subtitle: c.description || "",
              type: c.type || "unknown",
              keywords: ((e = c.commands) == null ? void 0 : e.map((d) => d.trigger || d.name).join(" ")) || "",
              enabled: s || A.isExtensionEnabled(c.id),
              // Use ID for check
              id: c.id,
              // Use ID from manifest
              version: c.version || "N/A",
              isBuiltIn: s
              // Add flag for UI differentiation
            });
          }
        } catch (s) {
          r.warn(
            `Error processing potential extension ${a} in getAllExtensionsWithState: ${s}`
          );
        }
      return n.sort((a, s) => a.isBuiltIn && !s.isBuiltIn ? -1 : !a.isBuiltIn && s.isBuiltIn ? 1 : a.title.localeCompare(s.title)), n;
    } catch (t) {
      return r.error(`Error retrieving all extensions with state: ${t}`), [];
    }
  }
  async getAllExtensions() {
    r.warn(
      "getAllExtensions is potentially deprecated or UI-specific. Returning data based on currently loaded *enabled* manifests."
    );
    const e = [];
    return this.manifestsById.forEach((t) => {
      var a;
      (F(t.id) || this.isExtensionEnabled(t.id)) && e.push({
        title: t.name,
        // Assuming name exists based on previous checks
        subtitle: t.description,
        keywords: ((a = t.commands) == null ? void 0 : a.map((s) => s.trigger || s.name).join(" ")) || "",
        type: t.type,
        action: () => {
          t.type === "view" && t.defaultView ? this.navigateToView(`${t.id}/${t.defaultView}`) : r.info(
            `Default action triggered for non-view/commandless extension: ${t.id}`
          );
        }
      });
    }), e;
  }
  async uninstallExtension(e) {
    r.info(`Attempting to uninstall extension ID: ${e}`);
    const t = this.manifestsById.get(e) || await this.tryLoadManifestForUninstall(e), n = t == null ? void 0 : t.name;
    try {
      if (ee.set(e), F(e))
        return r.error(`Cannot uninstall built-in extension: ${e}`), !1;
      A.isExtensionEnabled(e) && (r.debug(
        `Disabling extension '${e}' before uninstall.`
      ), await A.updateExtensionState(e, !1));
      const a = await this.getExtensionsDirectory(), s = await L(a, e);
      if (!s.includes("extensions") || e.includes(".."))
        throw new Error(
          `Safety check failed: Invalid path derived for ${e}`
        );
      return await te(s) ? (r.debug(`Attempting to delete directory: ${s}`), await le(s, { recursive: !0 }), r.info(`Successfully deleted directory: ${s}`)) : r.warn(
        `Extension directory not found at ${s}. Skipping deletion.`
      ), await A.removeExtensionState(e), r.debug(`Removed settings for extension ID: ${e}`), r.info(
        "Reloading extensions and re-syncing index after uninstall..."
      ), await this.unloadExtensions(), await this.loadExtensions(), await this.syncCommandIndex(), r.info(
        `Extension ${e} ${n ? `(${n})` : ""} uninstalled successfully.`
      ), !0;
    } catch (a) {
      return r.error(
        `Failed to uninstall extension ${e} ${n ? `(${n})` : ""}: ${a}`
      ), !1;
    } finally {
      ee.set(null);
    }
  }
  /**
   * Calls the search method on all enabled extensions and aggregates results.
   */
  async searchAllExtensions(e) {
    const t = [], n = [];
    r.debug(
      `Calling search() on ${this.extensionModulesById.size} loaded extensions for query: "${e}"`
    ), this.extensionModulesById.forEach((a, s) => {
      const o = (a == null ? void 0 : a.default) || a;
      this.isExtensionEnabled(s) && o && // Check if instance exists
      typeof o.search == "function" && n.push(
        Promise.resolve().then(() => o.search(e)).then((c) => c.map((d) => ({ ...d, extensionId: s }))).catch((c) => (r.error(`Error searching in extension ${s}: ${c}`), []))
      );
    });
    try {
      return (await Promise.all(n)).forEach((s) => t.push(...s)), r.debug(
        `Aggregated ${t.length} results from extension search() methods.`
      ), t.sort((s, o) => (o.score ?? 0) - (s.score ?? 0)), t;
    } catch (a) {
      return r.error(`Error aggregating extension search results: ${a}`), [];
    }
  }
  // New helper function specifically for dynamic manifest import
  async _dynamicImportManifest(e) {
    try {
      return await import(
        /* @vite-ignore */
        e
      );
    } catch (t) {
      return r.warn(
        `Dynamic import failed for manifest ${e}: ${t instanceof Error ? t.message : t}`
      ), null;
    }
  }
  // Helper to try loading manifest just for getting name during uninstall if not already loaded
  async tryLoadManifestForUninstall(e) {
    try {
      if (F(e)) return null;
      const a = `${`../../extensions/${e}`}/manifest.json`, s = await this._dynamicImportManifest(a);
      if (s && typeof s == "object") {
        const o = s.default;
        if (o && typeof o == "object" && o.id && o.name)
          return o;
        if (s.id && s.name)
          return s;
        r.warn(
          `Imported module for ${e} manifest doesn't seem to contain a valid manifest object.`
        );
      }
      return null;
    } catch (t) {
      return r.error(
        `Error in tryLoadManifestForUninstall for ${e}: ${t instanceof Error ? t.message : t}`
      ), null;
    }
  }
  async getExtensionsDirectory() {
    {
      r.debug(
        "Determining extensions directory for production mode..."
      );
      try {
        const e = await ke(), t = await L(e, "extensions");
        return r.info(
          `Using production path for extensions: ${t}`
        ), t;
      } catch (e) {
        r.error(
          `Failed to determine prod extensions directory using appDataDir: ${e}. Trying fallback...`
        );
        try {
          const t = await Be(), n = await L(
            t,
            "_up_/",
            "extensions"
          );
          return r.warn(
            `Using production fallback path for extensions: ${n}`
          ), n;
        } catch (t) {
          throw r.error(
            `Prod fallback failed: ${t}. Cannot determine extensions directory.`
          ), new Error("Could not determine prod extensions directory.");
        }
      }
    }
  }
  // Removed: getExtensionId(extension: Extension): string | undefined
  // Use extensionsById map instead if needed: this.extensionsById.get(id) -> Extension
  /**
   * Installs an extension from a given URL
   * This function delegates to the Tauri command which handles downloading and extracting
   */
  // --- Replacement for installExtensionFromUrl ---
  async installExtensionFromUrl(e, t, n, a) {
    if (!se.isTauri)
      return r.error("Extension installation is not supported in the browser."), !1;
    r.info(
      `[Frontend] Installing extension ${n} (${t}) v${a} from ${e}`
    ), ee.set(t);
    let s = "", o = "";
    try {
      s = await l("get_extensions_dir"), o = await L(s, t), r.debug(`Target installation directory: ${o}`), r.debug(`Downloading from ${e}...`);
      const c = await Ge(e, {
        method: "GET"
        // Removed incorrect responseType option
      });
      if (!c.ok)
        throw new Error(`Download failed: Status ${c.status}`);
      const d = await c.arrayBuffer();
      r.debug(`Download complete (${d.byteLength} bytes).`), r.debug("Unzipping extension data...");
      const u = (await import("./jszip.min-D_FyoTmI.js").then(($) => $.j)).default, g = await new u().loadAsync(d);
      await te(o) && (r.warn(`Removing existing directory: ${o}`), await le(o, { recursive: !0 })), r.debug(`Target directory will be created by Rust if needed: ${o}`);
      const w = [];
      return g.forEach(($, E) => {
        E.dir || w.push(
          (async () => {
            try {
              const I = await E.async("uint8array"), G = await L(o, $);
              await l("write_binary_file_recursive", {
                pathStr: G,
                // Convert Uint8Array to a plain array for serialization
                content: Array.from(I)
              });
            } catch (I) {
              throw r.error(`Error writing file ${$}: ${I}`), new Error(`Failed to write file ${$}: ${I}`);
            }
          })()
        );
      }), await Promise.all(w), r.debug(`All files extracted to ${o}`), r.info(
        `Extension ${t} installed successfully via frontend. Reloading extensions...`
      ), await this.unloadExtensions(), await this.loadExtensions(), await this.syncCommandIndex(), !0;
    } catch (c) {
      if (r.error(`Failed to install extension ${t}: ${c}`), o && await te(o))
        try {
          r.warn(`Attempting cleanup of failed installation: ${o}`), await le(o, { recursive: !0 });
        } catch (d) {
          r.error(`Cleanup failed for ${o}: ${d}`);
        }
      return !1;
    } finally {
      ee.set(null);
    }
  }
}
const Et = new vt();
Et.isReady;
export {
  vt as ExtensionManager,
  k as activeView,
  Y as activeViewSearchable,
  Et as default,
  $t as extensionLastUsed,
  ee as extensionUninstallInProgress,
  bt as extensionUsageStats
};
