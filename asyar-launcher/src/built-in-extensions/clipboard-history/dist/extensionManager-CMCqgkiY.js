var Ve = Object.defineProperty;
var Ne = (i, e, t) => e in i ? Ve(i, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : i[e] = t;
var h = (i, e, t) => Ne(i, typeof e != "symbol" ? e + "" : e, t);
import { writable as x, get as T } from "svelte/store";
import { R as _e, i as l, l as be, a as r, C as je, b as He, c as $e, d as N, e as ce, s as le } from "./index-BG2a-_BK.js";
import { ClipboardItemType as v, ExtensionBridge as Oe } from "asyar-api";
import "svelte";
const de = x("");
async function ye(i, e) {
  return await re.load(i, e);
}
class Be {
  get store() {
    return this._store || (this._store = ye(this.path, this.options)), this._store;
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
class re extends _e {
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
    return new re(n);
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
    return await l("plugin:store|get_store", { path: e }).then((t) => t ? new re(t) : null);
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
    return await be("store://change", (n) => {
      n.payload.resourceId === this.rid && n.payload.key === e && t(n.payload.exists ? n.payload.value : void 0);
    });
  }
  async onChange(e) {
    return await be("store://change", (t) => {
      t.payload.resourceId === this.rid && e(t.payload.key, t.payload.exists ? t.payload.value : void 0);
    });
  }
}
var ae;
(function(i) {
  i[i.Audio = 1] = "Audio", i[i.Cache = 2] = "Cache", i[i.Config = 3] = "Config", i[i.Data = 4] = "Data", i[i.LocalData = 5] = "LocalData", i[i.Document = 6] = "Document", i[i.Download = 7] = "Download", i[i.Picture = 8] = "Picture", i[i.Public = 9] = "Public", i[i.Video = 10] = "Video", i[i.Resource = 11] = "Resource", i[i.Temp = 12] = "Temp", i[i.AppConfig = 13] = "AppConfig", i[i.AppData = 14] = "AppData", i[i.AppLocalData = 15] = "AppLocalData", i[i.AppCache = 16] = "AppCache", i[i.AppLog = 17] = "AppLog", i[i.Desktop = 18] = "Desktop", i[i.Executable = 19] = "Executable", i[i.Font = 20] = "Font", i[i.Home = 21] = "Home", i[i.Runtime = 22] = "Runtime", i[i.Template = 23] = "Template";
})(ae || (ae = {}));
async function Ue() {
  return l("plugin:path|resolve_directory", {
    directory: ae.AppData
  });
}
async function We() {
  return l("plugin:path|resolve_directory", {
    directory: ae.Resource
  });
}
async function _(...i) {
  return l("plugin:path|join", { paths: i });
}
const A = {
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
}, S = x(A);
class qe {
  constructor() {
    h(this, "initialized", !1);
    h(this, "store", null);
    h(this, "storeFilePath", "settings.dat");
    S.set(A);
  }
  /**
   * Initialize the settings service AND the system shortcuts
   */
  async init() {
    if (this.initialized) return !0;
    try {
      try {
        const e = await Ue();
        this.storeFilePath = `${e}settings.dat`, this.store = await ye(this.storeFilePath);
      } catch (e) {
        r.error(`Failed to create store: ${e}`), this.store = await ye("settings.dat"), r.info("Using fallback store path");
      }
      await this.load(), this.initialized = !0;
      try {
        await this.syncAutostart();
      } catch (e) {
        r.error(`Autostart sync failed: ${e}`);
      }
      return await this.syncShortcut(), !0;
    } catch (e) {
      return r.error(`Failed to initialize settings: ${e}`), S.set(A), !1;
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
        S.set(t);
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
      const e = T(S);
      return await this.store.set("settings", e), await this.store.save(), !0;
    } catch (e) {
      return r.error(`Failed to save settings: ${e}`), !1;
    }
  }
  /**
   * Get the current settings
   */
  getSettings() {
    return T(S);
  }
  /**
   * Update a specific section of settings
   */
  async updateSettings(e, t) {
    try {
      if (S.update((n) => (n[e] = {
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
    return S.subscribe(e);
  }
  /**
   * Sync autostart setting with system
   */
  async syncAutostart() {
    const t = T(S).general.startAtLogin;
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
      const e = T(S), { modifier: t, key: n } = e.shortcut;
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
        return r.error("Stored settings not an object, using defaults"), { ...A };
      const n = e;
      return {
        general: { ...A.general, ...n == null ? void 0 : n.general },
        search: { ...A.search, ...n == null ? void 0 : n.search },
        shortcut: { ...A.shortcut, ...n == null ? void 0 : n.shortcut },
        appearance: {
          ...A.appearance,
          ...n == null ? void 0 : n.appearance
        },
        // Add extension merging
        extensions: {
          enabled: {
            ...A.extensions.enabled,
            ...(t = n == null ? void 0 : n.extensions) == null ? void 0 : t.enabled
          }
        },
        user: n == null ? void 0 : n.user
      };
    } catch (n) {
      return r.error(`Error merging settings: ${n}`), { ...A };
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
      return S.update((n) => (n.extensions ? n.extensions.enabled || (n.extensions.enabled = {}) : n.extensions = { enabled: {} }, n.extensions.enabled[e] = t, n)), await this.save();
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
      return S.update((t) => (t.extensions && t.extensions.enabled && delete t.extensions.enabled[e], t)), await this.save();
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
    return ((a = (n = T(S).extensions) == null ? void 0 : n.enabled) == null ? void 0 : a[e]) !== !1;
  }
  /**
   * Get all extension states
   * @returns Record of extension names to enabled states
   */
  getExtensionStates() {
    var e;
    return ((e = T(S).extensions) == null ? void 0 : e.enabled) || {};
  }
}
const F = new qe();
var ve;
(function(i) {
  i[i.Start = 0] = "Start", i[i.Current = 1] = "Current", i[i.End = 2] = "End";
})(ve || (ve = {}));
async function Ge(i, e) {
  if (i instanceof URL && i.protocol !== "file:")
    throw new TypeError("Must be a file URL.");
  return await l("plugin:fs|read_dir", {
    path: i instanceof URL ? i.toString() : i,
    options: e
  });
}
async function ue(i, e) {
  if (i instanceof URL && i.protocol !== "file:")
    throw new TypeError("Must be a file URL.");
  await l("plugin:fs|remove", {
    path: i instanceof URL ? i.toString() : i,
    options: e
  });
}
async function ie(i, e) {
  if (i instanceof URL && i.protocol !== "file:")
    throw new TypeError("Must be a file URL.");
  return await l("plugin:fs|exists", {
    path: i instanceof URL ? i.toString() : i,
    options: e
  });
}
const Y = "Request cancelled";
async function Ee(i, e) {
  const t = e == null ? void 0 : e.signal;
  if (t != null && t.aborted)
    throw new Error(Y);
  const n = e == null ? void 0 : e.maxRedirections, a = e == null ? void 0 : e.connectTimeout, s = e == null ? void 0 : e.proxy, o = e == null ? void 0 : e.danger;
  e && (delete e.maxRedirections, delete e.connectTimeout, delete e.proxy, delete e.danger);
  const c = e != null && e.headers ? e.headers instanceof Headers ? e.headers : new Headers(e.headers) : new Headers(), d = new Request(i, e), u = await d.arrayBuffer(), f = u.byteLength !== 0 ? Array.from(new Uint8Array(u)) : null;
  for (const [b, I] of d.headers)
    c.get(b) || c.set(b, I);
  const w = (c instanceof Headers ? Array.from(c.entries()) : Array.isArray(c) ? c : Object.entries(c)).map(([b, I]) => [
    b,
    // we need to ensure we have all header values as strings
    // eslint-disable-next-line
    typeof I == "string" ? I : I.toString()
  ]);
  if (t != null && t.aborted)
    throw new Error(Y);
  const E = await l("plugin:http|fetch", {
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
  }), C = () => l("plugin:http|fetch_cancel", { rid: E });
  if (t != null && t.aborted)
    throw C(), new Error(Y);
  t == null || t.addEventListener("abort", () => void C());
  const { status: P, statusText: J, url: Q, headers: X, rid: p } = await l("plugin:http|fetch_send", {
    rid: E
  }), L = new ReadableStream({
    start: (b) => {
      const I = new je();
      I.onmessage = (W) => {
        if (t != null && t.aborted) {
          b.error(Y);
          return;
        }
        const V = new Uint8Array(W), oe = V[V.byteLength - 1], De = V.slice(0, V.byteLength - 1);
        if (oe == 1) {
          b.close();
          return;
        }
        b.enqueue(De);
      }, l("plugin:http|fetch_read_body", {
        rid: p,
        streamChannel: I
      }).catch((W) => {
        b.error(W);
      });
    }
  }), R = new Response(L, {
    status: P,
    statusText: J
  });
  return Object.defineProperty(R, "url", { value: Q }), Object.defineProperty(R, "headers", {
    value: new Headers(X)
  }), R;
}
const Ke = /* @__PURE__ */ Object.assign({}), ze = /* @__PURE__ */ Object.assign({
  "../../built-in-extensions/calculator/manifest.json": () => import("./manifest-DRmh_qiJ.js"),
  "../../built-in-extensions/clipboard-history/manifest.json": () => import("./manifest-SbWwwnMl.js"),
  "../../built-in-extensions/create-extension/manifest.json": () => import("./manifest-DZZlrHJk.js"),
  "../../built-in-extensions/store/manifest.json": () => import("./manifest-B13rY4_N.js")
});
async function Je() {
  try {
    const i = Object.keys(Ke), e = Object.keys(ze);
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
function U(i) {
  return !!Object.keys(ze).find(
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
      if (t = await l("get_extensions_dir"), r.debug(`Loading installed extensions from: ${t}`), !await ie(t)) {
        r.debug(`Installed extensions directory does not exist: ${t}`);
        return;
      }
      const n = await Ge(t);
      for (const a of n)
        if ((a.isDirectory || a.isSymlink) && a.name) {
          const s = a.name, o = await _(t, s);
          if (e.has(s)) {
            r.warn(
              `Skipping installed extension ${s}, ID conflicts with already loaded extension.`
            );
            continue;
          }
          let c = null;
          try {
            const d = await _(o, "manifest.json");
            if (!await l("check_path_exists", { path: d })) {
              r.warn(`Manifest not found for installed extension ${s} at ${d}`);
              continue;
            }
            const f = await l("read_text_file_absolute", { pathStr: d }), m = JSON.parse(f);
            m.commands && m.commands.forEach((w) => {
              w.view && w.view !== "DefaultView" && r.warn(`Warning: extension ${s} command ${w.id} declares view '${w.view}' — expected 'DefaultView'. Extension may fail to render.`);
            }), e.set(s, {
              module: null,
              manifest: m,
              isBuiltIn: !1
              // User-installed extension
            }), r.debug(`Registered installed extension manifest: ${s} (${(m == null ? void 0 : m.name) || "Unknown"})`);
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
      if (U(e))
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
          const t = await l("get_extensions_dir"), n = await _(t, e), a = await _(n, "manifest.json");
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
const Se = new Qe();
var Ce;
(function(i) {
  i.Year = "year", i.Month = "month", i.TwoWeeks = "twoWeeks", i.Week = "week", i.Day = "day", i.Hour = "hour", i.Minute = "minute", i.Second = "second";
})(Ce || (Ce = {}));
var Te;
(function(i) {
  i[i.None = 0] = "None", i[i.Min = 1] = "Min", i[i.Low = 2] = "Low", i[i.Default = 3] = "Default", i[i.High = 4] = "High";
})(Te || (Te = {}));
var Ie;
(function(i) {
  i[i.Secret = -1] = "Secret", i[i.Private = 0] = "Private", i[i.Public = 1] = "Public";
})(Ie || (Ie = {}));
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
  return await He("notification", "actionPerformed", i);
}
class fe {
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
class H extends _e {
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
      rgba: xe(e),
      width: t,
      height: n
    }).then((a) => new H(a));
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
      bytes: xe(e)
    }).then((t) => new H(t));
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
    return l("plugin:image|from_path", { path: e }).then((t) => new H(t));
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
function xe(i) {
  return i == null ? null : typeof i == "string" ? i : i instanceof H ? i.rid : i;
}
async function me(i, e) {
  await l("plugin:clipboard-manager|write_text", {
    label: e == null ? void 0 : e.label,
    text: i
  });
}
async function Me() {
  return await l("plugin:clipboard-manager|read_text");
}
async function at(i) {
  await l("plugin:clipboard-manager|write_image", {
    image: xe(i)
  });
}
async function Ae() {
  return await l("plugin:clipboard-manager|read_image").then((i) => new H(i));
}
async function Pe(i, e) {
  await l("plugin:clipboard-manager|write_html", {
    html: i,
    altText: e
  });
}
const y = [];
for (let i = 0; i < 256; ++i)
  y.push((i + 256).toString(16).slice(1));
function st(i, e = 0) {
  return (y[i[e + 0]] + y[i[e + 1]] + y[i[e + 2]] + y[i[e + 3]] + "-" + y[i[e + 4]] + y[i[e + 5]] + "-" + y[i[e + 6]] + y[i[e + 7]] + "-" + y[i[e + 8]] + y[i[e + 9]] + "-" + y[i[e + 10]] + y[i[e + 11]] + y[i[e + 12]] + y[i[e + 13]] + y[i[e + 14]] + y[i[e + 15]]).toLowerCase();
}
let ge;
const ot = new Uint8Array(16);
function ct() {
  if (!ge) {
    if (typeof crypto > "u" || !crypto.getRandomValues)
      throw new Error("crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported");
    ge = crypto.getRandomValues.bind(crypto);
  }
  return ge(ot);
}
const lt = typeof crypto < "u" && crypto.randomUUID && crypto.randomUUID.bind(crypto), Le = { randomUUID: lt };
function Re(i, e, t) {
  var a;
  if (Le.randomUUID && !i)
    return Le.randomUUID();
  i = i || {};
  const n = i.random ?? ((a = i.rng) == null ? void 0 : a.call(i)) ?? ct();
  if (n.length < 16)
    throw new Error("Random bytes length must be >= 16");
  return n[6] = n[6] & 15 | 64, n[8] = n[8] & 63 | 128, st(n);
}
const dt = "clipboard_history.json", ut = 90 * 24 * 60 * 60 * 1e3, ft = 1e3;
let g = null;
const K = x([]);
async function O() {
  g || (g = new Be(dt, { autoSave: 100 }), await g.init(), K.set(await B()));
}
async function Fe(i) {
  g || await O();
  try {
    let e = await B();
    if (e.some(
      (a) => i.type === a.type && (i.content && i.content === a.content || i.type === "image" && i.id === a.id)
    )) return;
    e = [i, ...e];
    const n = Date.now() - ut;
    e = e.filter((a) => a.favorite || a.createdAt > n).slice(0, ft), await (g == null ? void 0 : g.set("items", e)), K.set(e);
  } catch (e) {
    r.error(`Failed to add clipboard history item: ${e}`);
  }
}
async function B() {
  g || await O();
  try {
    return await (g == null ? void 0 : g.get("items")) || [];
  } catch (i) {
    return r.error(`Failed to get clipboard history items: ${i}`), [];
  }
}
async function mt(i) {
  g || await O();
  try {
    const t = (await B()).map(
      (n) => n.id === i ? { ...n, favorite: !n.favorite } : n
    );
    await (g == null ? void 0 : g.set("items", t)), K.set(t);
  } catch (e) {
    r.error(`Failed to toggle favorite status: ${e}`);
  }
}
async function gt(i) {
  g || await O();
  try {
    const t = (await B()).filter((n) => n.id !== i);
    await (g == null ? void 0 : g.set("items", t)), K.set(t);
  } catch (e) {
    r.error(`Failed to delete clipboard history item: ${e}`);
  }
}
async function ht() {
  g || await O();
  try {
    const e = (await B()).filter((t) => t.favorite);
    await (g == null ? void 0 : g.set("items", e)), K.set(e);
  } catch (i) {
    r.error(`Failed to clear clipboard history: ${i}`);
  }
}
function ke(i) {
  return typeof i == "string" ? /<(?=.*? .*?\/?>|.+?>)[a-z]+.*?>/i.test(i) : typeof i == "object" && i !== null && i instanceof Node;
}
const D = class D {
  constructor() {
    h(this, "pollingInterval", null);
    h(this, "lastTextContent", "");
    h(this, "POLLING_MS", 1e3);
  }
  /**
   * Get the singleton instance
   */
  static getInstance() {
    return D.instance || (D.instance = new D()), D.instance;
  }
  /**
   * Initialize the clipboard history service
   */
  async initialize() {
    r.debug("Initializing ClipboardHistoryService"), await O(), this.startMonitoring(), r.debug("ClipboardHistoryService initialized");
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
      const e = await Me();
      if (this.lastTextContent = e, !e) return;
      const t = ke(e) ? v.Html : v.Text, n = {
        id: Re(),
        type: t,
        content: e,
        preview: this.createPreview(e, t),
        createdAt: Date.now(),
        favorite: !1
      };
      await Fe(n);
    } catch (e) {
      r.error(`Error capturing text content: ${e}`);
    }
  }
  /**
   * Capture image content from clipboard
   */
  async captureImageContent() {
    try {
      const e = await Ae(), t = new Blob([await e.rgba()], { type: "image" }), n = URL.createObjectURL(t), a = Re();
      if (!e) return;
      const s = {
        id: a,
        type: v.Image,
        content: n,
        preview: `Image: ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`,
        createdAt: Date.now(),
        favorite: !1
      };
      await Fe(s);
    } catch {
    }
  }
  /**
   * Create a preview of clipboard content
   */
  createPreview(e, t) {
    if (!e) return "No preview available";
    if (t === v.Html) {
      const n = document.createElement("div");
      n.innerHTML = e;
      const a = n.textContent || n.innerText || "";
      return this.truncateText(a);
    } else if (t === v.Text)
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
    return e.type === v.Image ? `Image captured on ${new Date(e.createdAt).toLocaleString()}` : e.content ? this.truncateText(e.content) : "";
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
      case v.Text:
        await me(e.content);
        break;
      case v.Html:
        await this.writeHtmlContent(e.content);
        break;
      case v.Image:
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
      typeof Pe == "function" ? await Pe(e) : await me(n);
    } catch {
      await me(n);
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
      return (await B()).filter((n) => n && n.id && n.type).slice(0, e);
    } catch (t) {
      return r.error(`Error retrieving clipboard items: ${t}`), [];
    }
  }
  /**
   * Toggle favorite status of a history item
   */
  async toggleItemFavorite(e) {
    try {
      return await mt(e), !0;
    } catch (t) {
      return r.error(`Error toggling item favorite status: ${t}`), !1;
    }
  }
  /**
   * Delete an item from history
   */
  async deleteItem(e) {
    try {
      return await gt(e), !0;
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
        const t = await Ae();
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
              type: v.Image,
              content: `data:image/png;base64,${o}`
            };
          }
        }
      } catch (t) {
        r.error(`Failed to read image from clipboard: ${t}`);
      }
      const e = await Me();
      return e ? {
        type: ke(e) ? v.Html : v.Text,
        content: e
      } : {
        type: v.Text,
        content: ""
      };
    } catch (e) {
      return r.error(`Failed to read from clipboard: ${e}`), { type: v.Text, content: "" };
    }
  }
};
h(D, "instance");
let se = D;
const q = x({}), Z = x({
  startupTime: 0,
  totalMemoryUsage: 0,
  extensionLoadCount: 0,
  maxMemoryUsage: 0,
  startTimestamp: Date.now()
}), he = /* @__PURE__ */ new Map();
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
        Z.update((a) => ({
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
    he.set(e, {
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
    const t = performance.now(), n = he.get(e);
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
    return he.delete(e), r.custom(
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
    this.loadingStartTimes.set(e, performance.now()), q.update((n) => {
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
    this.loadingStartTimes.delete(e), q.update((a) => {
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
    }), Z.update((a) => ({
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
    q.update((n) => {
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
    this.executionStartTimes.delete(n), q.update((o) => {
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
    const e = T(q), t = T(Z), n = this.getMemoryUsage();
    Z.update((f) => ({
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
const $ = new wt(), z = x(null), ee = x(!1);
let M = [], j = null, we = null, te = null, G = null, pe = null;
const k = {
  // Initialize with necessary dependencies from the main manager
  init(i, e, t, n) {
    we = i, te = e, G = t, pe = n, M = [], j = null, z.set(null), ee.set(!1), r.debug("ViewManager initialized and state reset.");
  },
  navigateToView(i) {
    if (r.info(`[ViewManager] navigateToView called with path: ${i}`), !we || !G) {
      r.error("ViewManager not initialized properly.");
      return;
    }
    const e = i.split("/")[0], t = we.get(e);
    if (t) {
      r.info(`Navigating to view: ${i} for extension: ${t.id}`), M.length === 0 && (j = T(de), r.debug(`First view navigation, saving initial query: "${j}"`));
      const n = {
        viewPath: i,
        searchable: t.searchable ?? !1,
        extensionId: t.id
      };
      M.push(n), z.set(n.viewPath), ee.set(n.searchable), de.set(""), G(t.id, i), r.debug(`Navigated to view: ${i}, searchable: ${n.searchable}. Stack size: ${M.length}`);
    } else
      r.error(`Cannot navigate: No enabled extension found with ID: ${e}`);
  },
  // Renamed from closeView
  goBack() {
    if (M.length === 0) {
      r.warn("goBack called but navigation stack is empty.");
      return;
    }
    const i = M.pop();
    if (r.debug(`Going back from view: ${i == null ? void 0 : i.viewPath}. Stack size after pop: ${M.length}`), M.length === 0)
      r.debug("Navigation stack empty, returning to main view."), z.set(null), ee.set(!1), r.debug(`Restoring initial main query: "${j}"`), de.set(j ?? ""), j = null, i && pe && pe(i.extensionId, i.viewPath);
    else {
      const e = M[M.length - 1];
      r.debug(`Returning to previous view: ${e.viewPath}`), z.set(e.viewPath), ee.set(e.searchable), G && G(e.extensionId, e.viewPath);
    }
  },
  async handleViewSearch(i) {
    if (T(z) && te)
      try {
        await te(i);
      } catch (e) {
        r.error(`Error during handleViewSearch propagation: ${e}`);
      }
    else te || r.warn("View search attempted but no handler is registered.");
  },
  getActiveView() {
    return T(z);
  },
  isViewActive() {
    return T(z) !== null;
  },
  // Helper to get the current stack size (for debugging or potential future use)
  getNavigationStackSize() {
    return M.length;
  }
};
x(-1);
x(!1);
x(!1);
x(0);
const pt = x(null), yt = {
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
  "asyar:api:network:fetch": "network",
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
const ne = x(null), bt = x({}), $t = x({});
class vt {
  constructor() {
    h(this, "bridge", Oe.getInstance());
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
    h(this, "isReady", x(!1));
    this.bridge.registerService("ExtensionManager", this), this.bridge.registerService("LogService", r), this.bridge.registerService(
      "NotificationService",
      new fe()
    ), this.bridge.registerService(
      "ClipboardHistoryService",
      se.getInstance()
    ), this.bridge.registerService("ActionService", $e), this.bridge.registerService("CommandService", N), this.setupIpcHandler();
  }
  // Add this store
  // Getter to satisfy IExtensionManager interface based on viewManager state
  get currentExtension() {
    const e = k.getActiveView();
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
      typeof $.init == "function" && !$.init && (await $.init(), r.custom(
        "🔍 Performance monitoring initialized by extension manager",
        "PERF",
        "cyan"
      )), F.isInitialized() || await F.init(), $.startTiming("extension-loading"), await this.loadExtensions();
      const n = $.stopTiming("extension-loading");
      r.custom(
        `🧩 Extensions loaded in ${(e = n.duration) == null ? void 0 : e.toFixed(2)}ms`,
        "PERF",
        "green"
      ), k.init(
        this.manifestsById,
        this.handleExtensionSearch.bind(this),
        // Pass bound methods as handlers
        this.handleExtensionViewActivated.bind(this),
        this.handleExtensionViewDeactivated.bind(this)
      ), $.startTiming("command-index-sync"), await this.syncCommandIndex();
      const a = $.stopTiming("command-index-sync");
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
      await N.executeCommand(e), ce.isTauri && (r.debug(`Recording usage for command: ${e}`), l("record_item_usage", { objectId: e }).then(() => r.debug(`Usage recorded for ${e}`)).catch(
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
        var f, m;
        if ((f = u.manifest) != null && f.id && ((m = u.cmd) != null && m.id)) {
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
      const n = new Set(t.keys()), a = await le.getIndexedObjectIds("cmd_"), s = [], o = [];
      t.forEach(({ cmd: u, manifest: f }, m) => {
        f.id && u.id && s.push({
          category: "command",
          id: m,
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
        (u) => le.indexItem(u)
      ), d = o.map(
        (u) => le.deleteItem(u)
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
        a && a.id && N.clearCommandsForExtension(a.id);
      }), $.startTiming("extension-reloading"), await this.loadExtensions(), $.startTiming("command-index-sync"), await this.syncCommandIndex();
      const t = $.stopTiming("command-index-sync"), n = $.stopTiming("extension-reloading");
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
      e && e.id && N.clearCommandsForExtension(e.id);
    }), await this.bridge.deactivateExtensions(), this.extensionModulesById.clear(), this.manifestsById.clear(), this.allLoadedCommands = [], this.initialized = !1, k.isViewActive())
      for (; k.getNavigationStackSize() > 0; )
        k.goBack();
    r.info("Extensions unloaded and state cleared.");
  }
  // Updated loadExtensions to use the service
  async loadExtensions() {
    r.debug(
      "Starting loadExtensions process using extensionLoaderService..."
    );
    try {
      this.extensionModulesById.clear(), this.manifestsById.clear(), this.allLoadedCommands = [];
      const e = await Se.loadAllExtensions();
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
        if (c || F.isExtensionEnabled(d)) {
          if ($.trackExtensionLoadStart(d), this.extensionModulesById.set(d, s), this.manifestsById.set(d, o), this.bridge.registerManifest(o), c) {
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
          }), $.trackExtensionLoadEnd(o.id), t++;
        } else
          r.debug(`Extension ${a} is loaded but disabled.`), n++;
      }
      t > 0 ? ($.startTiming("extension-initialization-activation"), await this.bridge.initializeExtensions(), await this.bridge.activateExtensions(), $.stopTiming("extension-initialization-activation"), this.registerCommandHandlersFromManifests()) : r.debug("No enabled extensions to initialize or activate."), r.debug(
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
        const n = U(t.id), a = this.extensionModulesById.get(t.id);
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
        N.registerCommand(s, d, t.id), r.debug(
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
        const m = this.getManifestById(c);
        if (!m) {
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
          m.permissions ?? []
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
        let m;
        if (t.startsWith("asyar:api:") || t.startsWith("asyar:service:")) {
          const w = t.split(":");
          let E = "", C = "", P = t.startsWith("asyar:service:");
          P ? (E = w[2], C = w[3]) : (E = w[2], C = w[3] || w[2]);
          const Q = {
            log: "LogService",
            extension: "ExtensionManager",
            notification: "NotificationService",
            clipboard: "ClipboardHistoryService",
            command: "CommandService",
            action: "ActionService"
          }[E] || E;
          if (t === "asyar:api:invoke")
            ce.isTauri ? m = await l(n.cmd, n.args) : (r.warn(`[Main] Mocking invoke for ${n.cmd} in browser`), m = null);
          else if (t === "asyar:api:network:fetch") {
            const { url: X, options: p } = n, L = new AbortController(), R = p != null && p.timeout ? setTimeout(() => L.abort(), p.timeout) : null, b = await Ee(X, {
              method: (p == null ? void 0 : p.method) ?? "GET",
              headers: p == null ? void 0 : p.headers,
              body: p == null ? void 0 : p.body,
              signal: L.signal
            });
            R && clearTimeout(R);
            const I = {};
            b.headers.forEach((V, oe) => {
              I[oe] = V;
            });
            const W = await b.text();
            m = {
              status: b.status,
              statusText: b.statusText,
              headers: I,
              body: W,
              ok: b.ok
            };
          } else {
            const p = {
              LogService: r,
              ExtensionManager: this,
              NotificationService: new fe(),
              ClipboardHistoryService: se.getInstance(),
              CommandService: N,
              ActionService: $e
            }[Q];
            if (p && typeof p[C] == "function")
              if (P && Array.isArray(n))
                m = await p[C](...n);
              else {
                let L;
                if (n == null)
                  L = [];
                else if (typeof n != "object" || Array.isArray(n))
                  L = Array.isArray(n) ? n : [n];
                else {
                  const R = Object.values(n);
                  L = R.length === 0 ? [] : R;
                }
                m = await p[C](...L);
              }
            else t === "asyar:extension:loaded" ? r.info(`Extension ready: ${c}`) : t === "asyar:api:notification:show" ? new fe().notify(n) : r.warn(`[Main] Dispatch failed for ${t}: Service ${Q}.${C} not found`);
          }
        }
        e.source.postMessage({
          type: "asyar:response",
          messageId: a,
          result: m,
          success: !0
        }, "*");
      } catch (m) {
        r.error(`[Main] IPC handling error for ${c}: ${m}`), (f = e.source) == null || f.postMessage({
          type: "asyar:response",
          messageId: a,
          error: m instanceof Error ? m.message : String(m),
          success: !1
        }, "*");
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
    k.navigateToView(e);
  }
  // Renamed from closeView to match interface
  goBack() {
    k.goBack();
  }
  handleViewSearch(e) {
    return k.handleViewSearch(e);
  }
  // --- Internal handlers passed to ViewManager ---
  async handleExtensionSearch(e) {
    const t = k.getActiveView();
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
    return U(e) ? !0 : F.isExtensionEnabled(e);
  }
  async toggleExtensionState(e, t) {
    if (U(e) && !t)
      return r.warn(`Cannot disable built-in extension: ${e}`), !1;
    try {
      const n = await F.updateExtensionState(
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
          const s = U(a), o = await Se.loadSingleExtension(a);
          if (o && o.manifest) {
            const c = o.manifest;
            n.push({
              title: c.name,
              subtitle: c.description || "",
              type: c.type || "unknown",
              keywords: ((e = c.commands) == null ? void 0 : e.map((d) => d.trigger || d.name).join(" ")) || "",
              enabled: s || F.isExtensionEnabled(c.id),
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
      (U(t.id) || this.isExtensionEnabled(t.id)) && e.push({
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
      if (ne.set(e), U(e))
        return r.error(`Cannot uninstall built-in extension: ${e}`), !1;
      F.isExtensionEnabled(e) && (r.debug(
        `Disabling extension '${e}' before uninstall.`
      ), await F.updateExtensionState(e, !1));
      const a = await this.getExtensionsDirectory(), s = await _(a, e);
      if (!s.includes("extensions") || e.includes(".."))
        throw new Error(
          `Safety check failed: Invalid path derived for ${e}`
        );
      return await ie(s) ? (r.debug(`Attempting to delete directory: ${s}`), await ue(s, { recursive: !0 }), r.info(`Successfully deleted directory: ${s}`)) : r.warn(
        `Extension directory not found at ${s}. Skipping deletion.`
      ), await F.removeExtensionState(e), r.debug(`Removed settings for extension ID: ${e}`), r.info(
        "Reloading extensions and re-syncing index after uninstall..."
      ), await this.unloadExtensions(), await this.loadExtensions(), await this.syncCommandIndex(), r.info(
        `Extension ${e} ${n ? `(${n})` : ""} uninstalled successfully.`
      ), !0;
    } catch (a) {
      return r.error(
        `Failed to uninstall extension ${e} ${n ? `(${n})` : ""}: ${a}`
      ), !1;
    } finally {
      ne.set(null);
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
      if (U(e)) return null;
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
        const e = await Ue(), t = await _(e, "extensions");
        return r.info(
          `Using production path for extensions: ${t}`
        ), t;
      } catch (e) {
        r.error(
          `Failed to determine prod extensions directory using appDataDir: ${e}. Trying fallback...`
        );
        try {
          const t = await We(), n = await _(
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
    if (!ce.isTauri)
      return r.error("Extension installation is not supported in the browser."), !1;
    r.info(
      `[Frontend] Installing extension ${n} (${t}) v${a} from ${e}`
    ), ne.set(t);
    let s = "", o = "";
    try {
      s = await l("get_extensions_dir"), o = await _(s, t), r.debug(`Target installation directory: ${o}`), r.debug(`Downloading from ${e}...`);
      const c = await Ee(e, {
        method: "GET"
        // Removed incorrect responseType option
      });
      if (!c.ok)
        throw new Error(`Download failed: Status ${c.status}`);
      const d = await c.arrayBuffer();
      r.debug(`Download complete (${d.byteLength} bytes).`), r.debug("Unzipping extension data...");
      const u = (await import("./jszip.min-D_FyoTmI.js").then((E) => E.j)).default, m = await new u().loadAsync(d);
      await ie(o) && (r.warn(`Removing existing directory: ${o}`), await ue(o, { recursive: !0 })), r.debug(`Target directory will be created by Rust if needed: ${o}`);
      const w = [];
      return m.forEach((E, C) => {
        C.dir || w.push(
          (async () => {
            try {
              const P = await C.async("uint8array"), J = await _(o, E);
              await l("write_binary_file_recursive", {
                pathStr: J,
                // Convert Uint8Array to a plain array for serialization
                content: Array.from(P)
              });
            } catch (P) {
              throw r.error(`Error writing file ${E}: ${P}`), new Error(`Failed to write file ${E}: ${P}`);
            }
          })()
        );
      }), await Promise.all(w), r.debug(`All files extracted to ${o}`), r.info(
        `Extension ${t} installed successfully via frontend. Reloading extensions...`
      ), await this.unloadExtensions(), await this.loadExtensions(), await this.syncCommandIndex(), !0;
    } catch (c) {
      if (r.error(`Failed to install extension ${t}: ${c}`), o && await ie(o))
        try {
          r.warn(`Attempting cleanup of failed installation: ${o}`), await ue(o, { recursive: !0 });
        } catch (d) {
          r.error(`Cleanup failed for ${o}: ${d}`);
        }
      return !1;
    } finally {
      ne.set(null);
    }
  }
}
const Et = new vt();
Et.isReady;
export {
  vt as ExtensionManager,
  z as activeView,
  ee as activeViewSearchable,
  Et as default,
  $t as extensionLastUsed,
  ne as extensionUninstallInProgress,
  bt as extensionUsageStats
};
