// asyar-launcher/src/lib/ipc/commands.ts
import { invokeSafe, invokeSafeVoid } from './invokeSafe';
import type {
  SearchableItem,
  SearchResult,
  Application,
  ItemAlias,
  AliasConflict,
  MergedSearchResponse,
} from '../../bindings';
import type { ExtensionRecord } from '../../types/ExtensionRecord';
import type { AvailableUpdate } from '../../types/ExtensionUpdate';
export * from './extensionPreferencesCommands';
export * from './commandArgDefaultsCommands';
export * from './iframeLifecycleCommands';
export * from './browserCommands';
export * from './extensionLifecycleCommands';
export * from './shortcodeCommands';
export * from './shellCommands';
export * from './applicationCommands';
export * from './statusBarCommands';
export * from './extensionBuilderCommands';
export * from './systemCommands';
export * from './searchAccessoryCommands';
export * from './clipboardCommands';
export * from './settingsUiCommands';
export * from './updateCommands';

export type ExternalSearchResult = {
  objectId: string;
  name: string;
  description?: string | null;
  type: string;
  score: number;
  icon?: string | null;
  extensionId?: string | null;
  category?: string | null;
  style?: string | null;
};

// ── Search ────────────────────────────────────────────────────────────────────

// Shared with ExtensionIpcRouter's EXTENSION_INVOKE_DISPATCH table (which
// relies on the default, non-silent report) — SearchService.performSearch
// passes silent:true since it reports its own, more specific diagnostic.
export async function searchItems(query: string, opts?: { silent?: boolean }): Promise<SearchResult[] | null> {
  return invokeSafe<SearchResult[]>('search_items', { query }, opts);
}

export async function mergedSearch(
  query: string,
  externalResults: ExternalSearchResult[],
  minResults?: number
): Promise<MergedSearchResponse | null> {
  return invokeSafe<MergedSearchResponse>('merged_search', { query, externalResults, minResults });
}

// ── Aliases ───────────────────────────────────────────────────────────────────

export async function setAlias(
  objectId: string,
  alias: string,
  itemName: string,
  itemType: 'application' | 'command'
): Promise<ItemAlias | null> {
  return invokeSafe('set_alias', { objectId, alias, itemName, itemType });
}

export async function unsetAlias(alias: string): Promise<void> {
  await invokeSafe('unset_alias', { alias });
}

export async function listAliases(): Promise<ItemAlias[] | null> {
  return invokeSafe('list_aliases');
}

export async function findAliasConflict(
  alias: string,
  excludingObjectId?: string
): Promise<AliasConflict | null> {
  return invokeSafe('find_alias_conflict', { alias, excludingObjectId });
}

export async function getIndexedItems(): Promise<SearchableItem[] | null> {
  return invokeSafe('get_indexed_items');
}

// boolean (not void): SearchService.indexItem needs to know whether indexing
// actually succeeded to report its own specific diagnostic on failure.
export async function indexItem(item: SearchableItem): Promise<boolean> {
  return invokeSafeVoid('index_item', { item }, { silent: true });
}

export async function batchIndexItems(items: SearchableItem[]): Promise<void> {
  await invokeSafe('batch_index_items', { items });
}

export async function deleteItem(objectId: string): Promise<void> {
  await invokeSafe('delete_item', { objectId });
}

export async function getIndexedObjectIds(): Promise<Set<string> | null> {
  const arr = await invokeSafe<string[]>('get_indexed_object_ids');
  return arr === null ? null : new Set(arr);
}

export async function recordItemUsage(objectId: string): Promise<void> {
  await invokeSafe('record_item_usage', { objectId });
}

// boolean (not void): SearchService.resetIndex needs to know whether the
// reset actually succeeded to report its own specific diagnostic on failure.
export async function resetSearchIndex(): Promise<boolean> {
  return invokeSafeVoid('reset_search_index', undefined, { silent: true });
}

// boolean (not void): SearchService.saveIndex needs to know whether the
// save actually succeeded to report its own specific diagnostic on failure.
export async function saveSearchIndex(): Promise<boolean> {
  return invokeSafeVoid('save_search_index', undefined, { silent: true });
}

// ── Applications ──────────────────────────────────────────────────────────────

export interface SyncResult {
  added: number;
  removed: number;
  total: number;
}

export async function syncApplicationIndex(extraPaths?: string[]): Promise<SyncResult | null> {
  return invokeSafe<SyncResult>('sync_application_index', { extraPaths });
}

export async function listApplications(extraPaths?: string[]): Promise<Application[] | null> {
  return invokeSafe<Application[]>('list_applications', { extraPaths });
}

export async function openApplicationPath(path: string): Promise<void> {
  await invokeSafe('open_application_path', { path });
}

export async function getDefaultAppScanPaths(): Promise<string[] | null> {
  return invokeSafe<string[]>('get_default_app_scan_paths');
}

export async function normalizeScanPath(path: string): Promise<string | null> {
  return invokeSafe<string>('normalize_scan_path', { path });
}

// ── Window ────────────────────────────────────────────────────────────────────

/** Wait two rAFs: long enough for the webview to commit at least one fresh
 * layer-tree / paint after the render process transitions back to visible. */
function twoFrames(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

/**
 * Reveal the launcher window. When the panel was hidden, uses a two-phase
 * reveal (prepare at alpha 0 / off-screen, wait for the webview to push a
 * fresh frame, then commit to its final position) so the user doesn't see
 * the stale cached composite from the prior session. When already visible,
 * a single-shot `show` is enough.
 */
/** Mirrors the `asyar_visible` atomic. The JS side reads this to decide
 * between the two-phase reveal and the single-shot `show` fallback. */
export async function isVisible(): Promise<boolean | null> {
  return invokeSafe<boolean>('is_visible');
}

export async function showWindow(): Promise<void> {
  const wasVisible = await isVisible();
  if (wasVisible) {
    await invokeSafe('show');
    return;
  }
  await invokeSafe('prepare_show');
  await twoFrames();
  const committed = await invokeSafe('commit_show');
  if (committed === null) {
    // prepare_show left the panel mapped at alpha 0 (or off-screen on
    // win/linux). If commit_show never runs, the launcher is invisible
    // but active. Force the single-shot reveal so the user isn't stuck.
    await invokeSafe('show');
  }
}

export async function hideWindow(): Promise<void> {
  await invokeSafe('hide');
}

export async function setFocusLock(locked: boolean): Promise<void> {
  await invokeSafe('set_focus_lock', { locked });
}

export async function quitApp(): Promise<void> {
  await invokeSafe('quit_app');
}


export async function setLauncherHeight(
  height: number,
  expanded?: boolean,
  deferUntilNextCaCommit?: boolean,
): Promise<void> {
  await invokeSafe('set_launcher_height', { height, expanded, deferUntilNextCaCommit });
}

export async function markLauncherReady(expanded: boolean): Promise<void> {
  await invokeSafe('mark_launcher_ready', { expanded });
}

export async function setLauncherKeepExpanded(keepExpanded: boolean): Promise<void> {
  await invokeSafe('set_launcher_keep_expanded', { keepExpanded });
}

export interface ShowMoreBarStyle {
  bar_bg: string;
  text: string;
  chip_bg: string;
  chip_border: string;
}

export async function updateShowMoreBarStyle(style: ShowMoreBarStyle): Promise<void> {
  await invokeSafe('update_show_more_bar_style', { style });
}

export interface ShowMoreBarHudsPayload {
  scripts_active: number;
  scripts_done: number;
  agents_active: number;
  agents_done: number;
}

export async function updateShowMoreBarHuds(huds: ShowMoreBarHudsPayload): Promise<void> {
  await invokeSafe('update_show_more_bar_huds', { huds });
}

export async function setPanelAppearance(pref: 'system' | 'light' | 'dark'): Promise<void> {
  await invokeSafe('set_panel_appearance', { pref });
}

  export async function appRelaunch(): Promise<void> {
    await invokeSafe('app_relaunch');
  }

  /**
   * Wipe everything Asyar persists, then quit. The Rust side writes a
   * sentinel into `app_data_dir` and calls `app.exit(0)`; the user must
   * manually relaunch, and the actual wipe runs at the start of that next
   * boot before any DB connection opens.
   *
   * The promise never resolves on the calling page because the process
   * exits — callers should not depend on a return value.
   */
  export async function factoryReset(): Promise<void> {
    await invokeSafe('factory_reset');
  }

  export async function showSettingsWindow(tab?: string): Promise<void> {
    // Direct callers bypass the no-view command hide path, so reset here too.
    // Dynamic import breaks the commands ↔ extensionManager module cycle.
    const { resetLauncherState } = await import('../launcher/launcherReset');
    await hideWindow();
    resetLauncherState();
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const settingsWindow = await WebviewWindow.getByLabel('settings');
    if (settingsWindow) {
      await settingsWindow.show();
      await settingsWindow.setFocus();
      if (tab) {
        const { emit } = await import('@tauri-apps/api/event');
        // Delay ensures the settings window's onMount listener is registered
        // before the event fires (relevant when the window was hidden/just shown).
        setTimeout(() => emit('asyar:navigate-settings-tab', { tab }), 50);
      }
    }
  }

  export interface WindowBounds {
    x: number
    y: number
    width: number
    height: number
  }

  export interface WindowBoundsUpdate {
    x?: number
    y?: number
    width?: number
    height?: number
  }

  export async function windowGetBounds(): Promise<WindowBounds | null> {
    return invokeSafe<WindowBounds>('window_management_get_bounds')
  }

  export async function windowSetBounds(update: WindowBoundsUpdate): Promise<void> {
    await invokeSafe('window_management_set_bounds', {
      x: update.x ?? null,
      y: update.y ?? null,
      width: update.width ?? null,
      height: update.height ?? null,
    })
  }

  export async function windowSetFullscreen(enable: boolean): Promise<void> {
    await invokeSafe('window_management_set_fullscreen', { enable })
  }

  export async function windowGetMonitors(): Promise<WindowBounds[] | null> {
    return invokeSafe<WindowBounds[]>('window_management_get_monitors')
  }

  export async function windowApplyPreset(presetId: string): Promise<void> {
    await invokeSafe('window_management_apply_preset', { presetId })
  }

  // ── HUD ───────────────────────────────────────────────────────────────────────

  export interface HudContent {
    title: string;
    spinning: boolean;
  }

  export async function getHudState(): Promise<HudContent | null> {
    return invokeSafe<HudContent | null>('get_hud_state');
  }

  export async function showHud(args: { title: string; durationMs: number; spinning: boolean }): Promise<void> {
    await invokeSafe('show_hud', {
      title: args.title,
      durationMs: args.durationMs,
      spinning: args.spinning,
    });
  }

  export async function hideHud(): Promise<void> {
    await invokeSafe('hide_hud');
  }

  // ── Extensions ────────────────────────────────────────────────────────────────

  export async function getExtensionsDir(): Promise<string | null> {
    return invokeSafe<string>('get_extensions_dir');
  }

  export async function listInstalledExtensions(): Promise<string[] | null> {
    return invokeSafe<string[]>('list_installed_extensions');
  }

  export async function uninstallExtension(extensionId: string): Promise<void> {
    await invokeSafe('uninstall_extension', { extensionId });
  }

  export async function installExtensionFromUrl(params: {
    url: string;
    extensionId: string;
    extensionName: string;
    version: string;
    checksum: string | null;
  }): Promise<void> {
    const { url, extensionId, extensionName, version, checksum } = params;
    await invokeSafe('install_extension_from_url', {
      downloadUrl: url,
      extensionId,
      extensionName,
      version,
      checksum
    });
  }

  export async function getBuiltinFeaturesPath(): Promise<string | null> {
    return invokeSafe<string>('get_builtin_features_path');
  }

  // `register_dev_extension` is `Result<(), AppError>` on the Rust side —
  // use invokeSafeVoid's boolean signal so callers can fall back on failure.
  export async function registerDevExtension(extensionId: string, path: string): Promise<boolean> {
    return invokeSafeVoid('register_dev_extension', { extensionId, path });
  }

  export async function getDevExtensionPaths(): Promise<Record<string, string> | null> {
    return invokeSafe<Record<string, string>>('get_dev_extension_paths');
  }

  export async function spawnHeadlessExtension(extensionId: string, scriptPath: string): Promise<void> {
    await invokeSafe('spawn_headless_extension', { id: extensionId, path: scriptPath });
  }

  export async function killExtension(extensionId: string): Promise<void> {
    await invokeSafe('kill_extension', { id: extensionId });
  }

  export async function discoverExtensions(): Promise<ExtensionRecord[] | null> {
    return invokeSafe<ExtensionRecord[]>('discover_extensions');
  }

  export async function setExtensionEnabled(extensionId: string, enabled: boolean): Promise<void> {
    await invokeSafe('set_extension_enabled', { extensionId, enabled });
  }

  export async function getExtension(extensionId: string): Promise<ExtensionRecord | null> {
    return invokeSafe<ExtensionRecord>('get_extension', { extensionId });
  }

  // -- Extension Updates --

  export async function checkExtensionUpdates(storeApiBaseUrl: string): Promise<AvailableUpdate[] | null> {
    return invokeSafe<AvailableUpdate[]>('check_extension_updates', { storeApiBaseUrl });
  }

  export async function updateExtension(update: AvailableUpdate): Promise<void> {
    await invokeSafe('update_extension', { update });
  }

  export async function updateAllExtensions(updates: AvailableUpdate[]): Promise<[string, { Ok?: null; Err?: string }][] | null> {
    return invokeSafe('update_all_extensions', { updates });
  }

  export interface CommandSyncInput {
    id: string;
    name: string;
    extension: string;
    trigger: string;
    type: string;
    icon?: string | null;
  }

  export interface CommandSyncResult {
    added: number;
    removed: number;
    total: number;
  }

  export async function syncCommandIndex(commands: CommandSyncInput[]): Promise<CommandSyncResult | null> {
    return invokeSafe<CommandSyncResult>('sync_command_index', { commands });
  }

  export interface UpdateCommandMetadataInput {
    commandObjectId: string;
    subtitle: string | null;
  }

  export async function updateCommandMetadata(input: UpdateCommandMetadataInput): Promise<void> {
    await invokeSafe('update_command_metadata', { input });
  }

  /**
   * Argument schema field for a runtime-registered command. Mirrors the
   * SDK's `CommandArgument` shape so the wire format is the single
   * source of truth maintained in `asyar-sdk/src/types/CommandType.ts`.
   */
  export interface DynamicCommandArgumentInput {
    name: string;
    type: 'text' | 'password' | 'dropdown' | 'number';
    placeholder?: string;
    required?: boolean;
    default?: string | number;
    data?: { value: string; title: string }[];
  }

  export interface DynamicCommandRegistrationInput {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    arguments?: DynamicCommandArgumentInput[];
  }

  /**
   * Replace an extension's full dynamic command list. Atomic — Rust
   * validates every registration first; on any validation failure the
   * promise rejects and the previous list remains intact.
   */
  export async function replaceDynamicCommands(
    extensionId: string,
    regs: DynamicCommandRegistrationInput[],
  ): Promise<void> {
    await invokeSafe('replace_dynamic_commands', { extensionId, regs });
  }

  /**
   * Reply shape for `getDynamicCommandMeta`. Returns null when
   * `objectId` is not a dynamic-format id or has no matching entry.
   */
  export interface DynamicCommandMetaReply {
    extensionId: string;
    commandId: string;
    commandName: string;
    icon?: string;
    args: DynamicCommandArgumentInput[];
  }

  /**
   * Look up dynamic command metadata by full object id
   * (`cmd_<extensionId>_dyn_<dynamicId>`). Returns `null` when the id
   * does not match the dynamic format or when the registry has no
   * matching entry. Used by the argument-mode resolver fallback.
   */
  export async function getDynamicCommandMeta(
    objectId: string,
  ): Promise<DynamicCommandMetaReply | null> {
    return invokeSafe<DynamicCommandMetaReply | null>('get_dynamic_command_meta', { objectId });
  }

  export interface ScheduledTaskInfo {
    extensionId: string;
    extensionName: string;
    commandId: string;
    commandName: string;
    intervalSeconds: number;
    active: boolean;
  }

  export async function getScheduledTasks(): Promise<ScheduledTaskInfo[] | null> {
    return invokeSafe<ScheduledTaskInfo[]>('get_scheduled_tasks');
  }

  // -- Theme types --

  export interface ThemeFontEntry {
    family: string;
    weight?: string;
    style?: string;
    src: string;
  }

  export interface ThemeDefinition {
    variables: Record<string, string>;
    fonts: ThemeFontEntry[];
  }

  // -- Plugin system commands --

  export async function installExtensionFromFile(filePath: string): Promise<void> {
    await invokeSafe('install_extension_from_file', { filePath });
  }

  export async function showOpenExtensionDialog(): Promise<string | null> {
    return invokeSafe<string | null>('show_open_extension_dialog');
  }

  export async function getThemeDefinition(extensionId: string): Promise<ThemeDefinition | null> {
    return invokeSafe<ThemeDefinition>('get_theme_definition', { extensionId });
  }

  // ── Shortcuts ─────────────────────────────────────────────────────────────────

  // `register_item_shortcut`/`unregister_item_shortcut` are `Result<(), AppError>`
  // on the Rust side — use invokeSafeVoid's boolean signal so callers can
  // detect a conflict/failure instead of assuming the shortcut took effect.
  export async function registerItemShortcut(objectId: string, modifier: string, key: string): Promise<boolean> {
    return invokeSafeVoid('register_item_shortcut', { objectId, modifier, key });
  }

  export async function unregisterItemShortcut(modifier: string, key: string): Promise<boolean> {
    return invokeSafeVoid('unregister_item_shortcut', { modifier, key });
  }

  // `update_global_shortcut` is `Result<(), AppError>` on the Rust side —
  // use invokeSafeVoid's boolean signal so callers can detect failure.
  export async function updateGlobalShortcut(modifier: string, key: string): Promise<boolean> {
    return invokeSafeVoid('update_global_shortcut', { modifier, key });
  }

  export async function getPersistedShortcut(): Promise<{ modifier: string; key: string } | null> {
    return invokeSafe<{ modifier: string; key: string }>('get_persisted_shortcut');
  }

  export async function initializeShortcutFromSettings(modifier: string, key: string): Promise<void> {
    await invokeSafe('initialize_shortcut_from_settings', { modifier, key });
  }

  export async function pauseUserShortcuts(): Promise<void> {
    await invokeSafe('pause_user_shortcuts');
  }

  export async function resumeUserShortcuts(): Promise<void> {
    await invokeSafe('resume_user_shortcuts');
  }

  // Distinct from pause/resumeUserShortcuts: these also pause/resume the
  // launcher's own global shortcut, not just user item shortcuts.
  export async function pauseAllShortcuts(): Promise<void> {
    await invokeSafe('pause_all_shortcuts');
  }

  export async function resumeAllShortcuts(): Promise<void> {
    await invokeSafe('resume_all_shortcuts');
  }

  export async function getValidShortcutKeys(): Promise<string[] | null> {
    return invokeSafe<string[]>('get_valid_shortcut_keys');
  }

  // ── Autostart ─────────────────────────────────────────────────────────────────

  export async function getAutostartStatus(): Promise<boolean | null> {
    return invokeSafe<boolean>('get_autostart_status');
  }

  export async function initializeAutostartFromSettings(enabled: boolean): Promise<void> {
    await invokeSafe('initialize_autostart_from_settings', { enable: enabled });
  }

  // ── File I/O ──────────────────────────────────────────────────────────────────

  export async function checkPathExists(path: string): Promise<boolean | null> {
    return invokeSafe<boolean>('check_path_exists', { path });
  }

  export async function readTextFileAbsolute(pathStr: string): Promise<string | null> {
    return invokeSafe<string>('read_text_file_absolute', { pathStr });
  }

  export async function writeTextFileAbsolute(pathStr: string, content: string): Promise<void> {
    await invokeSafe('write_text_file_absolute', { pathStr, content });
  }

  export async function writeBinaryFileRecursive(pathStr: string, content: number[]): Promise<void> {
    await invokeSafe('write_binary_file_recursive', { pathStr, content });
  }

  export async function mkdirAbsolute(pathStr: string): Promise<void> {
    await invokeSafe('mkdir_absolute', { pathStr });
  }

  export async function showInFileManager(pathStr: string): Promise<void> {
    await invokeSafe('show_in_file_manager', { pathStr });
  }

  export async function trashPath(pathStr: string): Promise<void> {
    await invokeSafe('trash_path', { pathStr });
  }

  // ── System ────────────────────────────────────────────────────────────────────

  export async function fetchUrl(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    callerExtensionId?: string | null;
  }): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string; ok: boolean } | null> {
    return invokeSafe('fetch_url', {
      url: params.url,
      method: params.method ?? 'GET',
      headers: params.headers,
      body: params.body,
      timeoutMs: params.timeoutMs ?? 20000,
      callerExtensionId: params.callerExtensionId ?? null,
    });
  }

  export interface NotificationActionInput {
    id: string;
    title: string;
    commandId: string;
    /**
     * JSON-serialisable argument payload. `null` is the canonical wire
     * encoding for "no args" — Rust's `Option<Value>` deserialises either
     * `null` or an omitted key as `None`.
     */
    args?: Record<string, unknown> | null;
  }

  export async function sendNotification(params: {
    title: string;
    body?: string;
    actions?: NotificationActionInput[];
    callerExtensionId?: string | null;
  }): Promise<string | null> {
    return invokeSafe<string>('send_notification', {
      title: params.title,
      body: params.body ?? '',
      actions: params.actions ?? null,
      callerExtensionId: params.callerExtensionId ?? null,
    });
  }

  export async function dismissNotification(params: {
    notificationId: string;
    callerExtensionId?: string | null;
  }): Promise<void> {
    await invokeSafe('dismiss_notification', {
      notificationId: params.notificationId,
      callerExtensionId: params.callerExtensionId ?? null,
    });
  }

  export async function simulatePaste(): Promise<void> {
    await invokeSafe('simulate_paste');
  }

  export async function expandAndPaste(keywordLen: number): Promise<void> {
    await invokeSafe('expand_and_paste', { keywordLen });
  }

  export async function openAccessibilityPreferences(): Promise<void> {
    await invokeSafe('open_accessibility_preferences');
  }

  /**
   * Returns true when macOS Accessibility permission is granted (always true on
   * other platforms). Required before simulating a paste keystroke, which the OS
   * silently drops without this permission.
   */
  export async function checkAccessibilityPermission(): Promise<boolean | null> {
    return invokeSafe<boolean>('check_accessibility_permission');
  }

  export async function openUrl(url: string): Promise<void> {
    await invokeSafe('plugin:opener|open_url', { url });
  }

  // ── Storage: Clipboard ───────────────────────────────────────────────────────

  export interface StoredClipboardItem {
    id: string;
    type: string;
    content?: string;
    preview?: string;
    createdAt: number;
    favorite: boolean;
    metadata?: Record<string, unknown>;
    sourceApp?: Record<string, unknown>;
    redactedKinds?: string[];
  }

  export interface StoredClipboardListItem {
    id: string;
    type: string;
    preview?: string;
    createdAt: number;
    favorite: boolean;
    metadata?: Record<string, unknown>;
    sourceApp?: Record<string, unknown>;
    redactedKinds?: string[];
  }

  export interface ClipboardCursor {
    createdAt: number;
    id: string;
  }

  export interface ClipboardInitialPage {
    favorites: StoredClipboardListItem[];
    recent: StoredClipboardListItem[];
    nextCursor?: ClipboardCursor;
  }

  export interface ClipboardOlderPage {
    items: StoredClipboardListItem[];
    nextCursor?: ClipboardCursor;
  }

  export interface ClipboardExportPage {
    items: StoredClipboardItem[];
    nextCursor?: ClipboardCursor;
  }

  export interface ClipboardSearchResult {
    items: StoredClipboardListItem[];
    indexState: 'ready' | 'indexing';
  }

  export interface ClipboardCount {
    total: number;
    favorites: number;
  }

  export interface ClipboardCaptureResult {
    insertedId: string;
    evictedIds: string[];
  }

  export interface ClipboardDeleteResult {
    imageContentPath?: string;
  }

  export interface ClipboardClearResult {
    removedIds: string[];
    removedImagePaths: string[];
  }

  export async function clipboardListInitial(limit: number): Promise<ClipboardInitialPage | null> {
    return invokeSafe<ClipboardInitialPage>('clipboard_list_initial', { limit });
  }

  export async function clipboardListOlder(cursor: ClipboardCursor, limit: number): Promise<ClipboardOlderPage | null> {
    return invokeSafe<ClipboardOlderPage>('clipboard_list_older', { cursor, limit });
  }

  export async function clipboardSearch(query: string, limit: number): Promise<ClipboardSearchResult | null> {
    return invokeSafe<ClipboardSearchResult>('clipboard_search', { query, limit });
  }

  export async function clipboardGetItem(id: string): Promise<StoredClipboardItem | null> {
    return invokeSafe<StoredClipboardItem | null>('clipboard_get_item', { id });
  }

  export async function clipboardExportForSync(
    cursor: ClipboardCursor | undefined,
    limit: number,
  ): Promise<ClipboardExportPage | null> {
    return invokeSafe<ClipboardExportPage>('clipboard_export_for_sync', { cursor, limit });
  }

  export async function clipboardCount(): Promise<ClipboardCount | null> {
    return invokeSafe<ClipboardCount>('clipboard_count');
  }

  export async function clipboardRecordCapture(item: StoredClipboardItem): Promise<ClipboardCaptureResult | null> {
    return invokeSafe<ClipboardCaptureResult>('clipboard_record_capture', { item });
  }

  export async function clipboardToggleFavorite(id: string): Promise<boolean | null> {
    return invokeSafe<boolean>('clipboard_toggle_favorite', { id });
  }

  export async function clipboardDeleteItem(id: string): Promise<ClipboardDeleteResult | null> {
    return invokeSafe<ClipboardDeleteResult>('clipboard_delete_item', { id });
  }

  export async function clipboardClearNonFavorites(): Promise<ClipboardClearResult | null> {
    return invokeSafe<ClipboardClearResult>('clipboard_clear_non_favorites');
  }

  // ── Storage: Snippets ────────────────────────────────────────────────────────

  export interface StoredSnippet {
    id: string;
    keyword?: string;
    expansion: string;
    name: string;
    createdAt: number;
    pinned: boolean;
  }

  export async function snippetUpsert(snippet: StoredSnippet): Promise<void> {
    await invokeSafe('snippet_upsert', { snippet });
  }

  export async function snippetGetAll(): Promise<StoredSnippet[] | null> {
    return invokeSafe<StoredSnippet[]>('snippet_get_all');
  }

  export async function snippetRemove(id: string): Promise<void> {
    await invokeSafe('snippet_remove', { id });
  }

  export async function snippetTogglePin(id: string): Promise<boolean | null> {
    return invokeSafe<boolean>('snippet_toggle_pin', { id });
  }

  export async function snippetClearAll(): Promise<void> {
    await invokeSafe('snippet_clear_all');
  }

  // ── Storage: Shortcuts ───────────────────────────────────────────────────────

  export interface StoredItemShortcut {
    id: string;
    objectId: string;
    itemName: string;
    itemType: string;
    itemPath?: string;
    shortcut: string;
    createdAt: number;
  }

  export async function shortcutUpsert(shortcut: StoredItemShortcut): Promise<void> {
    await invokeSafe('shortcut_upsert', { shortcut });
  }

  export async function shortcutGetAll(): Promise<StoredItemShortcut[] | null> {
    return invokeSafe<StoredItemShortcut[]>('shortcut_get_all');
  }

  export async function shortcutRemove(objectId: string): Promise<void> {
    await invokeSafe('shortcut_remove', { objectId });
  }

  // ── Storage: Extension Key-Value ──────────────────────────────────────────────

  export interface KvEntry {
    key: string;
    value: string;
  }

  export async function extKvGet(extensionId: string, key: string): Promise<string | null> {
    return invokeSafe<string | null>('ext_kv_get', { extensionId, key });
  }

  export async function extKvSet(extensionId: string, key: string, value: string): Promise<void> {
    await invokeSafe('ext_kv_set', { extensionId, key, value });
  }

  export async function extKvDelete(extensionId: string, key: string): Promise<boolean | null> {
    return invokeSafe<boolean>('ext_kv_delete', { extensionId, key });
  }

  export async function extKvGetAll(extensionId: string): Promise<KvEntry[] | null> {
    return invokeSafe<KvEntry[]>('ext_kv_get_all', { extensionId });
  }

  export async function extKvClear(extensionId: string): Promise<number | null> {
    return invokeSafe<number>('ext_kv_clear', { extensionId });
  }

  // ── Storage: Extension Cache ─────────────────────────────────────────────────

  export async function extCacheGet(extensionId: string, key: string): Promise<string | null> {
    return invokeSafe<string | null>('ext_cache_get', { extensionId, key });
  }

  export async function extCacheSet(
    extensionId: string,
    key: string,
    value: string,
    expiresAt?: number
  ): Promise<void> {
    await invokeSafe('ext_cache_set', { extensionId, key, value, expiresAt });
  }

  export async function extCacheDelete(extensionId: string, key: string): Promise<boolean | null> {
    return invokeSafe<boolean>('ext_cache_delete', { extensionId, key });
  }

  export async function extCacheClear(extensionId: string): Promise<number | null> {
    return invokeSafe<number>('ext_cache_clear', { extensionId });
  }

  // ── Snippets (legacy — text expansion sync) ──────────────────────────────────

  export async function syncSnippetsToRust(snippets: [string, string][]): Promise<void> {
    await invokeSafe('sync_snippets_to_rust', { snippets });
  }

  // boolean (not void): snippetService.setEnabled's { ok, error } contract
  // needs to distinguish success from failure.
  export async function setSnippetsEnabled(enabled: boolean): Promise<boolean> {
    return invokeSafeVoid('set_snippets_enabled', { enabled }, { silent: true });
  }

  export async function checkSnippetPermission(): Promise<boolean | null> {
    return invokeSafe<boolean>('check_snippet_permission');
  }

  // ── Permissions ───────────────────────────────────────────────────────────────

  export interface PermissionCheckResult {
    allowed: boolean;
    requiredPermission?: string;
    reason?: string;
  }

  export async function registerExtensionPermissions(
    extensionId: string,
    permissions: string[],
    permissionArgs?: Record<string, unknown> | null,
  ): Promise<void> {
    await invokeSafe('register_extension_permissions', {
      extensionId,
      permissions,
      permissionArgs: permissionArgs ?? null,
    });
  }

  export async function checkExtensionPermission(
    extensionId: string,
    callType: string
  ): Promise<PermissionCheckResult | null> {
    return invokeSafe<PermissionCheckResult>('check_extension_permission', { extensionId, callType });
  }

  // ── Shell Trust ──────────────────────────────────────────────────────────────

  export interface TrustedBinary {
    binaryPath: string;
    trustedAt: number;
  }

  // Silent: ShellTrustManager.svelte is the sole caller and reports its own diagnostic.
  export async function shellListTrusted(extensionId: string): Promise<TrustedBinary[] | null> {
    return invokeSafe<TrustedBinary[]>('shell_list_trusted', { extensionId }, { silent: true });
  }

  export async function shellRevokeTrust(extensionId: string, binaryPath: string): Promise<void> {
    await invokeSafe('shell_revoke_trust', { extensionId, binaryPath });
  }

  // ── Profile Import/Export ────────────────────────────────────────────────────

  export interface ProfileCategoryEntry {
    filename: string;
    json_content: string;
    sensitive_field_paths: string[];
  }

  export interface ProfileAssetEntry {
    archive_path: string;
    source_path: string;
  }

  export interface ProfileArchiveContents {
    manifest_json: string;
    category_files: Record<string, string>;
    asset_paths: string[];
  }

  export async function exportProfile(
    manifestJson: string,
    categories: ProfileCategoryEntry[],
    binaryAssets: ProfileAssetEntry[],
    password: string | null,
    destination: string,
  ): Promise<string | null> {
    return invokeSafe<string>('export_profile', {
      manifestJson,
      categories,
      binaryAssets,
      password,
      destination,
    });
  }

  export async function importProfile(
    filePath: string,
    password: string | null,
  ): Promise<ProfileArchiveContents | null> {
    return invokeSafe<ProfileArchiveContents>('import_profile', {
      filePath,
      password,
    });
  }

  export async function showSaveProfileDialog(
    defaultFilename: string,
  ): Promise<string | null> {
    return invokeSafe<string | null>('show_save_profile_dialog', { defaultFilename });
  }

  export async function showOpenProfileDialog(): Promise<string | null> {
    return invokeSafe<string | null>('show_open_profile_dialog');
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────

  export interface AuthUser {
    id: number;
    name: string;
    email: string;
    avatarUrl?: string;
  }

  export interface AuthStateResponse {
    isLoggedIn: boolean;
    user?: AuthUser;
    entitlements: string[];
    entitlementsCachedAt?: number;
  }

  export interface AuthInitResponse {
    sessionCode: string;
    authUrl: string;
  }

  export interface PollResponse {
    status: 'pending' | 'complete' | 'expired';
    token?: string;
    user?: AuthUser;
    entitlements?: string[];
  }

  export async function authInitiate(provider: string): Promise<AuthInitResponse | null> {
    return invokeSafe<AuthInitResponse>('auth_initiate', { provider });
  }

  export async function authPoll(sessionCode: string): Promise<PollResponse | null> {
    return invokeSafe<PollResponse>('auth_poll', { sessionCode });
  }

  export async function authLoadCached(): Promise<AuthStateResponse | null> {
    return invokeSafe<AuthStateResponse | null>('auth_load_cached');
  }

  export async function authGetState(): Promise<AuthStateResponse | null> {
    return invokeSafe<AuthStateResponse>('auth_get_state');
  }

  export async function authRefreshEntitlements(): Promise<string[] | null> {
    return invokeSafe<string[]>('auth_refresh_entitlements');
  }

  export async function authCheckEntitlement(entitlement: string): Promise<boolean | null> {
    return invokeSafe<boolean>('auth_check_entitlement', { entitlement });
  }

  export async function authLogout(): Promise<void> {
    await invokeSafe('auth_logout');
  }

  // ── Cloud Sync ────────────────────────────────────────────────────────────────

  /**
   * One per-item entry handed to `sync_run`. The content field is already
   * JSON-stringified (Rust hashes it as bytes for delta detection) and
   * `isTombstone` flips true when the local state has the item marked for
   * deletion; the Rust orchestrator lifts that into a server-side delete.
   */
  export interface LocalItemSourceWire {
    itemId: string;
    categoryId: string;
    content: string;     // already JSON-stringified
    isTombstone?: boolean;
  }

  export interface SyncRunFailure {
    itemId: string;
    reason: string;
  }

  /**
   * One server-applied record from a pull pass. The TS sync service fans
   * these out through `provider.applyItemUpsert` (live rows) or
   * `provider.applyItemDelete` (tombstones, where `deleted=true` and
   * `content` is `null`).
   */
  export interface AppliedRecord {
    itemId: string;
    categoryId: string;
    content: string | null;
    deleted: boolean;
  }

  export interface SyncRunReport {
    uploaded: string[];
    skipped: string[];
    failed: SyncRunFailure[];
    /** Cheap id-only mirror of `appliedRecords`, kept for diagnostic counts. */
    appliedFromPull: string[];
    /** Full applied records — drives provider.applyItemUpsert / applyItemDelete. */
    appliedRecords: AppliedRecord[];
    lwwWarnings: string[];
    serverVersion: number;
  }

  /**
   * Status DTO returned by sync_get_status. Cursor + device id + counts
   * for dirty/tombstone-pending items + last full-sync timestamp.
   */
  export interface SyncStatusResponse {
    cursor: number;
    deviceId: string;
    lastFullSyncAtIso: string | null;
    dirtyCount: number;
    pendingTombstoneCount: number;
  }

  export async function syncRun(
    sources: LocalItemSourceWire[],
  ): Promise<SyncRunReport | null> {
    return invokeSafe<SyncRunReport>('sync_run', { sources });
  }

  export async function syncGetStatus(): Promise<SyncStatusResponse | null> {
    return invokeSafe<SyncStatusResponse>('sync_get_status');
  }

  /**
   * Mark a journal entry as a tombstone so the next push uploads a deletion.
   *
   * Called when a provider's `subscribeToChanges` callback fires with
   * `type === 'delete'`. Without this, a local delete only removes the item
   * from the provider's store — the journal still records the item as live,
   * the orchestrator never emits a `PushTombstone` decision for it, and the
   * next pull resurrects the item from the server.
   */
  export async function syncMarkTombstone(
    itemId: string,
    categoryId: string,
  ): Promise<void> {
    await invokeSafe<void>('sync_mark_tombstone', { itemId, categoryId });
  }

  // ── E2EE cloud sync (Layer 4b/4c) ─────────────────────────────────────────────

  export interface SyncE2eeStatusReport {
    enabled: boolean;
    locked: boolean;
    keyVersion: number | null;
  }

  export interface SyncE2eeEnrolmentResult {
    /** 24 BIP-39 words separated by single spaces. */
    recoveryPhrase: string;
  }

  /**
   * Get the current E2EE state. Cheap — reads local mirror + keychain only.
   * No HTTP. Suitable for polling on dialog mount.
   */
  export async function syncE2eeGetStatus(): Promise<SyncE2eeStatusReport | null> {
    return invokeSafe<SyncE2eeStatusReport>('sync_e2ee_get_status');
  }

  /**
   * Enrol the user in encrypted sync. Generates a fresh master_seed,
   * derives the wrap_key from the passphrase, encrypts the seed, posts
   * to the server, caches the seed in the OS keychain, and returns the
   * 24-word recovery phrase. Throws on failure (network, validation,
   * already-enrolled).
   */
  export async function syncE2eeEnrol(
    passphrase: string,
  ): Promise<SyncE2eeEnrolmentResult | null> {
    return invokeSafe<SyncE2eeEnrolmentResult>('sync_e2ee_enrol', { passphrase });
  }

  /**
   * Unlock the cached master_seed by trial-decrypting the local wrapped
   * seed with a passphrase-derived wrap_key. Wrong passphrase throws an
   * AppError::Validation — the service catches this and translates to
   * the `e2ee_passphrase_required` diagnostic kind.
   */
  export async function syncE2eeUnlock(passphrase: string): Promise<boolean> {
    return invokeSafeVoid('sync_e2ee_unlock', { passphrase }, { silent: true });
  }

  /**
   * Rotate the passphrase. Re-wraps the existing master_seed under a new
   * wrap_key. Server items are NOT re-encrypted (master_seed is
   * unchanged) — only one PUT to /api/sync/e2ee/state.
   */
  export async function syncE2eeRotate(
    oldPassphrase: string,
    newPassphrase: string,
  ): Promise<boolean> {
    return invokeSafeVoid('sync_e2ee_rotate', { oldPassphrase, newPassphrase });
  }

  /**
   * Recover from a forgotten passphrase using the 24-word mnemonic.
   * Optionally pass a server-fetched ciphertext payload to verify
   * ownership before mutating server state — without this, a typed-but-
   * wrong-account mnemonic would silently lock the user out.
   */
  export async function syncE2eeRecoverWithMnemonic(
    phrase: string,
    newPassphrase: string,
    verifyWithPayload?: string,
  ): Promise<boolean> {
    return invokeSafeVoid('sync_e2ee_recover_with_mnemonic', {
      phrase,
      newPassphrase,
      verifyWithPayload: verifyWithPayload ?? null,
    });
  }

  /**
   * Disable encrypted sync. Server DELETE → keychain delete → local
   * mirror clear. After this, the launcher reverts to plaintext sync;
   * existing items are re-uploaded as plaintext on the next mark-all-
   * dirty pass.
   */
  export async function syncE2eeDisable(): Promise<boolean> {
    return invokeSafeVoid('sync_e2ee_disable');
  }

  /**
   * Re-display the 24-word recovery phrase. Requires the current
   * passphrase (verified by trial-decrypting the local wrapped seed)
   * to gate against shoulder-surfing on unlocked machines.
   */
  export async function syncE2eeShowRecoveryPhrase(
    passphrase: string,
  ): Promise<string | null> {
    return invokeSafe<string>('sync_e2ee_show_recovery_phrase', { passphrase });
  }

  // ── OAuth PKCE for Extensions ─────────────────────────────────────────────────

  export interface OAuthStartResponse {
    state: string;
    authUrl: string;
  }

  export interface OAuthTokenPayload {
    accessToken: string;
    refreshToken?: string;
    tokenType: string;
    scopes: string[];
    /** Unix timestamp seconds. Undefined = no expiry. */
    expiresAt?: number;
  }

  export interface OAuthExchangeResponse {
    extensionId: string;
    flowId: string;
    token: OAuthTokenPayload;
  }

  export async function oauthStartFlow(
    extensionId: string,
    providerId: string,
    clientId: string,
    authorizationUrl: string,
    tokenUrl: string,
    scopes: string[],
    flowId: string,
  ): Promise<OAuthStartResponse | null> {
    return invokeSafe<OAuthStartResponse>('oauth_start_flow', {
      extensionId,
      providerId,
      clientId,
      authorizationUrl,
      tokenUrl,
      scopes,
      flowId,
    });
  }

  export async function oauthExchangeCode(
    stateParam: string,
    code: string,
  ): Promise<OAuthExchangeResponse | null> {
    return invokeSafe<OAuthExchangeResponse>('oauth_exchange_code', { stateParam, code });
  }

  export async function oauthGetStoredToken(
    extensionId: string,
    providerId: string,
  ): Promise<OAuthTokenPayload | null> {
    return invokeSafe<OAuthTokenPayload | null>('oauth_get_stored_token', { extensionId, providerId });
  }

  export async function oauthRevokeExtensionToken(
    extensionId: string,
    providerId: string,
  ): Promise<void> {
    await invokeSafe('oauth_revoke_extension_token', { extensionId, providerId });
  }

  // ── Onboarding ────────────────────────────────────────────────────────────────

  export type OnboardingStepKind =
    | 'welcome'
    | 'summonSearch'
    | 'clipboard'
    | 'portals'
    | 'aiSetup'
    | 'hiddenCommands'
    | 'emoji'
    | 'snippets'
    | 'featuredExtensions'
    | 'pickTheme'
    | 'cheatSheet'
    | 'privacyConsent'

  export interface OnboardingState {
    current: OnboardingStepKind
    total: number
    position: number
    isMacos: boolean
  }

  export const onboardingCommands = {
    getState: () =>
      invokeSafe<OnboardingState>('get_onboarding_state'),
    advance: () =>
      invokeSafe<OnboardingState>('advance_onboarding_step'),
    goBack: () =>
      invokeSafe<OnboardingState>('go_back_onboarding_step'),
    complete: () =>
      invokeSafe<void>('complete_onboarding'),
    dismiss: () =>
      invokeSafe<void>('dismiss_onboarding'),
    reset: () =>
      invokeSafe<void>('reset_onboarding'),
  }

  export async function completeAiOnboarding(): Promise<void> {
    await invokeSafe<void>('complete_ai_onboarding');
  }

  // Silent: onboardingService.svelte.ts is the sole caller and reports its own diagnostic.
  export async function isAiOnboardingCompleted(): Promise<boolean | null> {
    return invokeSafe<boolean>('is_ai_onboarding_completed', undefined, { silent: true });
  }

  export async function resetExtensionOnboarding(extensionId: string): Promise<void> {
    await invokeSafe('reset_extension_onboarding', { extensionId })
  }

  /** Whether the given extension has completed its onboarding flow. Used by
   *  the launcher's frontend interception for Tier 2 view-mode commands
   *  (which bypass the Rust dispatch path and therefore Plan B's Rust
   *  interception). */
  export function isExtensionOnboarded(extensionId: string): Promise<boolean | null> {
    return invokeSafe<boolean>('is_extension_onboarded', { extensionId })
  }

// ── Clipboard Capture-Time Privacy Filter ─────────────────────────────────────

export type ClipboardPrivacySkipReason =
  | { kind: 'none' }
  | { kind: 'transient' }
  | { kind: 'concealed' }
  | { kind: 'autoGenerated' }
  | { kind: 'optedOutOfHistory' }
  | { kind: 'sourceDenylist'; value: string };

export interface ClipboardPrivacyClassification {
  skip: boolean;
  reason: ClipboardPrivacySkipReason;
}

export async function clipboardPrivacyClassify(
  sourceBundleId: string | null,
): Promise<ClipboardPrivacyClassification | null> {
  return invokeSafe<ClipboardPrivacyClassification>('clipboard_privacy_classify', {
    sourceBundleId,
  });
}

export async function clipboardPrivacyGetSessionStats(): Promise<Record<string, number> | null> {
  return invokeSafe<Record<string, number>>('clipboard_privacy_get_session_stats');
}

export async function clipboardPrivacySetUserDenylist(
  entries: string[],
): Promise<void | null> {
  return invokeSafe<void>('clipboard_privacy_set_user_denylist', { entries });
}

export async function clipboardPrivacyGetUserDenylist(): Promise<string[] | null> {
  return invokeSafe<string[]>('clipboard_privacy_get_user_denylist');
}

export async function clipboardPrivacyGetDefaultDenylist(): Promise<string[] | null> {
  return invokeSafe<string[]>('clipboard_privacy_get_default_denylist');
}

// ── Secret Detection (pattern-based redaction) ────────────────────────────────

export interface SecretRedactionResult {
  content: string;
  kinds: string[];
  oversizedUnscanned: boolean;
}

export interface SecretDetectorRule {
  kind: string;
  description: string;
}

export async function secretDetectionRedact(
  input: string,
): Promise<SecretRedactionResult | null> {
  return invokeSafe<SecretRedactionResult>('secret_detection_redact', { input });
}

export async function secretDetectionGetSessionStats(): Promise<Record<string, number> | null> {
  return invokeSafe<Record<string, number>>('secret_detection_get_session_stats');
}

export async function secretDetectionGetCatalog(): Promise<SecretDetectorRule[] | null> {
  return invokeSafe<SecretDetectorRule[]>('secret_detection_get_catalog');
}

// ── At-rest encryption ────────────────────────────────────────────────────────

export interface EncryptionStatusPayload {
  status: 'active' | 'fallback';
  isOsBacked: boolean;
}

export async function cryptoGetStatus(): Promise<EncryptionStatusPayload | null> {
  return invokeSafe<EncryptionStatusPayload>('crypto_get_status');
}

export async function cryptoEncrypt(plaintext: string): Promise<string | null> {
  return invokeSafe<string>('crypto_encrypt', { plaintext });
}

export async function cryptoDecrypt(value: string): Promise<string | null> {
  return invokeSafe<string>('crypto_decrypt', { value });
}

// ── Scripts ───────────────────────────────────────────────────────────────────

export async function scriptsAddDirectory(path: string): Promise<void> {
  await invokeSafe('scripts_add_directory', { path });
}

export async function scriptsRemoveDirectory(path: string): Promise<void> {
  await invokeSafe('scripts_remove_directory', { path });
}

export async function scriptsListDirectories(): Promise<string[] | null> {
  return invokeSafe<string[]>('scripts_list_directories');
}

export async function scriptsPickDirectory(): Promise<string | null> {
  return invokeSafe<string | null>('scripts_pick_directory');
}

export async function scriptsRescan(): Promise<import('../../built-in-features/scripts/types').ScannedScript[] | null> {
  return invokeSafe('scripts_rescan');
}

/**
 * Per-tick payload emitted by the Rust inline-script scheduler over the
 * Tauri event `scripts:inline:tick`. The TS scriptsManager listens for
 * this and writes `subtitle` into `commandService.liveSubtitles` so the
 * row's subtitle refreshes in place.
 */
export interface InlineTickPayload {
  dynamicId: string;
  subtitle: string | null;
  error: string | null;
}

/**
 * One inline-mode script spec passed to `scriptsSetInlineScripts`. Mirrors
 * the Rust `InlineScriptSpec`.
 */
export interface InlineScriptSpec {
  dynamicId: string;
  absolutePath: string;
  refreshTimeSeconds: number;
}

/**
 * Outcome shape returned by `scriptsSetInlineScripts`. `capped` is the
 * overflow above the 10-script Raycast cap; `dropped` is the set of
 * dynamic ids whose tasks were aborted (file removed, mode changed away
 * from inline, or moved into the capped overflow).
 */
export interface SetInlineScriptsOutcome {
  accepted: string[];
  capped: string[];
  dropped: string[];
}

/**
 * Replace the active inline-mode tick set. Cap policy + diff is owned by
 * Rust; the TS side passes the full current list of inline specs on every
 * rescan and reads back what was actually scheduled.
 */
export async function scriptsSetInlineScripts(
  specs: InlineScriptSpec[],
): Promise<SetInlineScriptsOutcome | null> {
  return invokeSafe('scripts_set_inline_scripts', { specs });
}

export async function replaceDynamicCommandsBuiltin(
  extensionId: string,
  regs: import('asyar-sdk/contracts').DynamicCommandRegistration[],
): Promise<void> {
  await invokeSafe('replace_dynamic_commands_builtin', { extensionId, regs });
}

// ── Agents ────────────────────────────────────────────────────────────────────

// agentsCreate/agentsUpdate/agentsList are silent: agentService.svelte.ts is
// their sole caller and already reports its own (more specific) diagnostic
// on a null result — letting invokeSafe also report would double-report.
export async function agentsCreate(
  input: import('../../built-in-features/agents/types').AgentCreateInput,
): Promise<import('../../built-in-features/agents/types').AgentDef | null> {
  return invokeSafe('agents_create', { input }, { silent: true });
}

export async function agentsUpdate(
  input: import('../../built-in-features/agents/types').AgentUpdateInput,
): Promise<import('../../built-in-features/agents/types').AgentDef | null> {
  return invokeSafe('agents_update', { input }, { silent: true });
}

// boolean (not void): agentService.svelte.ts gates its optimistic local
// state update on success, and reports its own diagnostic on failure.
export async function agentsDelete(id: string): Promise<boolean> {
  return invokeSafeVoid('agents_delete', { id }, { silent: true });
}

export async function agentsList(): Promise<import('../../built-in-features/agents/types').AgentDef[] | null> {
  return invokeSafe('agents_list', undefined, { silent: true });
}

export async function agentsGet(
  id: string,
): Promise<import('../../built-in-features/agents/types').AgentDef | null> {
  return invokeSafe('agents_get', { id });
}

export async function agentsThreadCreate(
  agentId: string,
  title?: string | null,
): Promise<import('../../built-in-features/agents/types').ThreadDef | null> {
  return invokeSafe('agents_thread_create', { input: { agentId, title: title ?? null } });
}

export async function agentsThreadDelete(id: string): Promise<void> {
  await invokeSafe('agents_thread_delete', { id });
}

export async function agentsThreadUpdateTitle(id: string, title: string): Promise<void> {
  await invokeSafe('agents_thread_update_title', { id, title });
}

export interface AgentRunOrigin {
  agentId: string;
  threadId: string;
}

export async function agentsFindRunOrigin(runId: string): Promise<AgentRunOrigin | null> {
  return invokeSafe('agents_find_run_origin', { runId });
}

export async function agentsBackfillThreadTitles(): Promise<number | null> {
  return invokeSafe('agents_backfill_thread_titles');
}

export async function agentsThreadsList(
  agentId: string,
): Promise<import('../../built-in-features/agents/types').ThreadDef[] | null> {
  return invokeSafe('agents_threads_list', { agentId });
}

export async function agentsMessageInsert(
  input: import('../../built-in-features/agents/types').MessageInsertInput,
): Promise<import('../../built-in-features/agents/types').MessageDef | null> {
  return invokeSafe('agents_message_insert', { input });
}

export async function agentsMessagesList(
  threadId: string,
): Promise<import('../../built-in-features/agents/types').MessageDef[] | null> {
  return invokeSafe('agents_messages_list', { threadId });
}

export async function agentsToolsRegisterTier2(
  extensionId: string,
  tools: import('asyar-sdk/contracts').ManifestTool[],
): Promise<void> {
  await invokeSafe('agents_tools_register_tier2', { extensionId, tools });
}

export async function agentsToolsUnregisterTier2(extensionId: string): Promise<void> {
  await invokeSafe('agents_tools_unregister_tier2', { extensionId });
}

export async function agentsToolsList(): Promise<import('asyar-sdk/contracts').ToolDescriptor[] | null> {
  return invokeSafe('agents_tools_list');
}

export async function agentsInvokeBuiltinTool(
  id: string,
  args: unknown,
): Promise<unknown | null> {
  return invokeSafe('agents_invoke_builtin_tool', { id, args });
}

// ── Feedback submission ───────────────────────────────────────────────────────

export interface FeedbackInput {
  type: 'feedback' | 'crash';
  category?: 'idea' | 'bug' | 'other' | null;
  message?: string | null;
  email?: string | null;
}

// boolean (not void): feedbackSubmitService needs to know whether submission
// actually succeeded before showing the "thank you" confirmation.
export async function submitFeedback(input: FeedbackInput): Promise<boolean> {
  return invokeSafeVoid('submit_feedback', { input });
}

// ── Crash report prompt (Ask mode) ───────────────────────────────────────────

export interface CrashPayload {
  panic: string;
  backtrace: string;
  log_tail: string;
}

export async function getPendingCrash(): Promise<CrashPayload | null> {
  return invokeSafe<CrashPayload | null>('get_pending_crash');
}

export async function sendPendingCrash(email: string): Promise<void> {
  await invokeSafe('send_pending_crash', { email });
}

export async function dismissPendingCrash(): Promise<void> {
  await invokeSafe('dismiss_pending_crash');
}

// ── Usage insights ────────────────────────────────────────────────────────────

export interface UsageTopItem { id: string; label?: string | null; count: number }
export interface UsageStats { activeDays: number; totalLaunches: number; top: UsageTopItem[] }
export async function getUsageStats(): Promise<UsageStats | null> { return invokeSafe('get_usage_stats'); }
export async function recordActiveDay(): Promise<void> { await invokeSafe('record_active_day'); }
export async function getUsageAnonId(): Promise<string | null> { return invokeSafe('get_usage_anon_id'); }
export async function resetUsageAnonId(): Promise<string | null> { return invokeSafe('reset_usage_anon_id'); }
export async function sendPendingUsage(day: string): Promise<void> { await invokeSafe('send_pending_usage', { day }); }
/** Explicit user action: send today's usage snapshot now. Returns the count of distinct launch entries sent. */
export async function sendUsageNow(): Promise<number | null> { return invokeSafe('send_usage_now'); }
