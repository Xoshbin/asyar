/**
 * Context passed to a registered `onClick` handler when the user clicks the
 * tray icon itself or one of its menu items.
 *
 * `itemPath` identifies the clicked node: the top-level id at index 0,
 * followed by any submenu ids drilled into to reach the leaf. For a plain
 * click on the tray icon, `itemPath` contains only the top-level id.
 *
 * `checked` is populated for `CheckMenuItem` leaves: it holds the NEW state
 * after the native auto-toggle. For non-check items it is `undefined`.
 */
export interface StatusBarClickContext {
  itemPath: string[];
  checked?: boolean;
}

/**
 * A single tray-icon + menu node registered by an extension.
 *
 * Top-level rules (enforced by the SDK proxy + Rust host):
 *   - `id` must be non-empty and unique among the extension's top-level items.
 *   - At least one of `icon` or `iconPath` must be provided (the tray needs
 *     a glyph to render in the menu bar).
 *   - `separator`, `checked`, `enabled: false` are NOT valid at the top
 *     level — they only make sense inside a submenu.
 *
 * Submenu rules:
 *   - Nesting depth is capped at 4 (the top level counts as 1).
 *   - Sibling ids must be unique, except `separator: true` rows which are
 *     id-less dividers.
 *   - `checked` / `enabled` / `separator` are only valid inside a submenu.
 */
export interface IStatusBarItem {
  /**
   * Item id. REQUIRED for top-level items and every non-separator child —
   * validation throws at `registerItem` time if missing. Declared optional
   * here so `{ separator: true }` divider rows type-check inside `submenu`
   * arrays (they carry no id/text).
   */
  id?: string;
  /** Emoji / unicode prefix / short label used next to `text` in menus. */
  icon?: string;
  /** Filesystem path or `asyar-extension://{id}/...` URI for the tray image. */
  iconPath?: string;
  /**
   * Tooltip at the top level; label shown in the menu at deeper levels.
   * REQUIRED everywhere except separator rows (same rationale as `id`).
   */
  text?: string;
  /** `✓` state — valid only inside a submenu. */
  checked?: boolean;
  /** Nested menu entries. If present the tray click opens this dropdown. */
  submenu?: IStatusBarItem[];
  /** `false` greys out the entry — valid only inside a submenu. */
  enabled?: boolean;
  /** Divider row — valid only inside a submenu. */
  separator?: boolean;
  /**
   * Fires when the user clicks this item (tray icon click for top level,
   * menu click for submenu leaves). Stripped from the IPC payload and kept
   * in the proxy's local dispatch table.
   */
  onClick?: (ctx: StatusBarClickContext) => void;
}

export interface IStatusBarService {
  registerItem(item: IStatusBarItem): void;
  updateItem(id: string, updates: Partial<IStatusBarItem>): void;
  unregisterItem(id: string): void;
}
