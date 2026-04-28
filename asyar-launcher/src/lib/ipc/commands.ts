// asyar-launcher/src/lib/ipc/commands.ts
import { invoke } from '@tauri-apps/api/core';
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

export async function searchItems(query: string): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('search_items', { query });
}

export async function mergedSearch(
  query: string,
  externalResults: ExternalSearchResult[],
  minResults?: number
): Promise<MergedSearchResponse> {
  return invoke<MergedSearchResponse>('merged_search', { query, externalResults, minResults });
}

// ── Aliases ───────────────────────────────────────────────────────────────────

export async function setAlias(
  objectId: string,
  alias: string,
  itemName: string,
  itemType: 'application' | 'command'
): Promise<ItemAlias> {
  return invoke('set_alias', { objectId, alias, itemName, itemType });
}

export async function unsetAlias(alias: string): Promise<void> {
  await invoke('unset_alias', { alias });
}

export async function listAliases(): Promise<ItemAlias[]> {
  return invoke('list_aliases');
}

export async function findAliasConflict(
  alias: string,
  excludingObjectId?: string
): Promise<AliasConflict | null> {
  return invoke('find_alias_conflict', { alias, excludingObjectId });
}

export async function getIndexedItems(): Promise<SearchableItem[]> {
  return invoke('get_indexed_items');
}

export async function indexItem(item: SearchableItem): Promise<void> {
  return invoke('index_item', { item });
}

export async function batchIndexItems(items: SearchableItem[]): Promise<void> {
  return invoke('batch_index_items', { items });
}

export async function deleteItem(objectId: string): Promise<void> {
  return invoke('delete_item', { objectId });
}

export async function getIndexedObjectIds(): Promise<Set<string>> {
  return invoke<string[]>('get_indexed_object_ids').then(arr => new Set(arr));
}

export async function recordItemUsage(objectId: string): Promise<void> {
  return invoke('record_item_usage', { objectId });
}

export async function resetSearchIndex(): Promise<void> {
  return invoke('reset_search_index');
}

export async function saveSearchIndex(): Promise<void> {
  return invoke('save_search_index');
}

// ── Applications ──────────────────────────────────────────────────────────────

export interface SyncResult {
  added: number;
  removed: number;
  total: number;
}

export async function syncApplicationIndex(extraPaths?: string[]): Promise<SyncResult> {
  return invoke<SyncResult>('sync_application_index', { extraPaths });
}

export async function listApplications(extraPaths?: string[]): Promise<Application[]> {
  return invoke<Application[]>('list_applications', { extraPaths });
}

export async function openApplicationPath(path: string): Promise<void> {
  return invoke('open_application_path', { path });
}

export async function getDefaultAppScanPaths(): Promise<string[]> {
  return invoke<string[]>('get_default_app_scan_paths');
}

export async function normalizeScanPath(path: string): Promise<string> {
  return invoke<string>('normalize_scan_path', { path });
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
export async function isVisible(): Promise<boolean> {
  return invoke<boolean>('is_visible');
}

export async function showWindow(): Promise<void> {
  const wasVisible = await isVisible();
  if (wasVisible) {
    return invoke('show');
  }
  await invoke('prepare_show');
  try {
    await twoFrames();
    await invoke('commit_show');
  } catch (e) {
    // prepare_show left the panel mapped at alpha 0 (or off-screen on
    // win/linux). If commit_show never runs, the launcher is invisible
    // but active. Force the single-shot reveal so the user isn't stuck.
    await invoke('show').catch(() => {});
    throw e;
  }
}

export async function hideWindow(): Promise<void> {
  return invoke('hide');
}

export async function setFocusLock(locked: boolean): Promise<void> {
  return invoke('set_focus_lock', { locked });
}

export async function quitApp(): Promise<void> {
  return invoke('quit_app');
}


export async function setLauncherHeight(
  height: number,
  expanded?: boolean,
  deferUntilNextCaCommit?: boolean,
): Promise<void> {
  return invoke('set_launcher_height', { height, expanded, deferUntilNextCaCommit });
}

export async function markLauncherReady(expanded: boolean): Promise<void> {
  return invoke('mark_launcher_ready', { expanded });
}

export async function setLauncherKeepExpanded(keepExpanded: boolean): Promise<void> {
  return invoke('set_launcher_keep_expanded', { keepExpanded });
}

export interface ShowMoreBarStyle {
  bar_bg: string;
  border: string;
  text: string;
  chip_bg: string;
  chip_border: string;
}

export async function updateShowMoreBarStyle(style: ShowMoreBarStyle): Promise<void> {
  return invoke('update_show_more_bar_style', { style });
}

  export async function appRelaunch(): Promise<void> {
    return invoke('app_relaunch');
  }

  export async function showSettingsWindow(tab?: string): Promise<void> {
    // Direct callers bypass the no-view command hide path, so reset here too.
    // Dynamic import breaks the commands ↔ extensionManager module cycle.
    const { resetLauncherState } = await import('../launcher/launcherReset');
    await hideWindow().catch(() => {});
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

  export async function windowGetBounds(): Promise<WindowBounds> {
    return invoke<WindowBounds>('window_management_get_bounds')
  }

  export async function windowSetBounds(update: WindowBoundsUpdate): Promise<void> {
    return invoke('window_management_set_bounds', {
      x: update.x ?? null,
      y: update.y ?? null,
      width: update.width ?? null,
      height: update.height ?? null,
    })
  }

  export async function windowSetFullscreen(enable: boolean): Promise<void> {
    return invoke('window_management_set_fullscreen', { enable })
  }

  // ── HUD ───────────────────────────────────────────────────────────────────────

  export async function getHudTitle(): Promise<string | null> {
    return invoke<string | null>('get_hud_title');
  }

  export async function showHud(args: { title: string; durationMs: number }): Promise<void> {
    return invoke('show_hud', { title: args.title, durationMs: args.durationMs });
  }

  export async function hideHud(): Promise<void> {
    return invoke('hide_hud');
  }

  // ── Extensions ────────────────────────────────────────────────────────────────

  export async function getExtensionsDir(): Promise<string> {
    return invoke<string>('get_extensions_dir');
  }

  export async function listInstalledExtensions(): Promise<string[]> {
    return invoke<string[]>('list_installed_extensions');
  }

  export async function uninstallExtension(extensionId: string): Promise<void> {
    return invoke('uninstall_extension', { extensionId });
  }

  export async function installExtensionFromUrl(params: {
    url: string;
    extensionId: string;
    extensionName: string;
    version: string;
    checksum: string | null;
  }): Promise<void> {
    const { url, extensionId, extensionName, version, checksum } = params;
    return invoke('install_extension_from_url', {
      downloadUrl: url,
      extensionId,
      extensionName,
      version,
      checksum
    });
  }

  export async function getBuiltinFeaturesPath(): Promise<string> {
    return invoke<string>('get_builtin_features_path');
  }

  export async function registerDevExtension(extensionId: string, path: string): Promise<void> {
    return invoke('register_dev_extension', { extensionId, path });
  }

  export async function getDevExtensionPaths(): Promise<Record<string, string>> {
    return invoke<Record<string, string>>('get_dev_extension_paths');
  }

  export async function spawnHeadlessExtension(extensionId: string, scriptPath: string): Promise<void> {
    return invoke('spawn_headless_extension', { id: extensionId, path: scriptPath });
  }

  export async function killExtension(extensionId: string): Promise<void> {
    return invoke('kill_extension', { id: extensionId });
  }

  export async function discoverExtensions(): Promise<ExtensionRecord[]> {
    return invoke<ExtensionRecord[]>('discover_extensions');
  }

  export async function setExtensionEnabled(extensionId: string, enabled: boolean): Promise<void> {
    return invoke('set_extension_enabled', { extensionId, enabled });
  }

  export async function getExtension(extensionId: string): Promise<ExtensionRecord> {
    return invoke<ExtensionRecord>('get_extension', { extensionId });
  }

  // -- Extension Updates --

  export async function checkExtensionUpdates(storeApiBaseUrl: string): Promise<AvailableUpdate[]> {
    return invoke<AvailableUpdate[]>('check_extension_updates', { storeApiBaseUrl });
  }

  export async function updateExtension(update: AvailableUpdate): Promise<void> {
    return invoke('update_extension', { update });
  }

  export async function updateAllExtensions(updates: AvailableUpdate[]): Promise<[string, { Ok?: null; Err?: string }][]> {
    return invoke('update_all_extensions', { updates });
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

  export async function syncCommandIndex(commands: CommandSyncInput[]): Promise<CommandSyncResult> {
    return invoke<CommandSyncResult>('sync_command_index', { commands });
  }

  export interface UpdateCommandMetadataInput {
    commandObjectId: string;
    subtitle: string | null;
  }

  export async function updateCommandMetadata(input: UpdateCommandMetadataInput): Promise<void> {
    return invoke('update_command_metadata', { input });
  }

  export interface ScheduledTaskInfo {
    extensionId: string;
    extensionName: string;
    commandId: string;
    commandName: string;
    intervalSeconds: number;
    active: boolean;
  }

  export async function getScheduledTasks(): Promise<ScheduledTaskInfo[]> {
    return invoke<ScheduledTaskInfo[]>('get_scheduled_tasks');
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
    return invoke('install_extension_from_file', { filePath });
  }

  export async function showOpenExtensionDialog(): Promise<string | null> {
    return invoke<string | null>('show_open_extension_dialog');
  }

  export async function getThemeDefinition(extensionId: string): Promise<ThemeDefinition> {
    return invoke<ThemeDefinition>('get_theme_definition', { extensionId });
  }

  // ── Shortcuts ─────────────────────────────────────────────────────────────────

  export async function registerItemShortcut(objectId: string, modifier: string, key: string): Promise<void> {
    return invoke('register_item_shortcut', { objectId, modifier, key });
  }

  export async function unregisterItemShortcut(modifier: string, key: string): Promise<void> {
    return invoke('unregister_item_shortcut', { modifier, key });
  }

  export async function updateGlobalShortcut(modifier: string, key: string): Promise<void> {
    return invoke('update_global_shortcut', { modifier, key });
  }

  export async function getPersistedShortcut(): Promise<{ modifier: string; key: string }> {
    return invoke<{ modifier: string; key: string }>('get_persisted_shortcut');
  }

  export async function initializeShortcutFromSettings(modifier: string, key: string): Promise<void> {
    return invoke('initialize_shortcut_from_settings', { modifier, key });
  }

  export async function pauseUserShortcuts(): Promise<void> {
    return invoke('pause_user_shortcuts');
  }

  export async function resumeUserShortcuts(): Promise<void> {
    return invoke('resume_user_shortcuts');
  }

  // ── Autostart ─────────────────────────────────────────────────────────────────

  export async function getAutostartStatus(): Promise<boolean> {
    return invoke<boolean>('get_autostart_status');
  }

  export async function initializeAutostartFromSettings(enabled: boolean): Promise<void> {
    return invoke('initialize_autostart_from_settings', { enable: enabled });
  }

  // ── File I/O ──────────────────────────────────────────────────────────────────

  export async function checkPathExists(path: string): Promise<boolean> {
    return invoke<boolean>('check_path_exists', { path });
  }

  export async function readTextFileAbsolute(pathStr: string): Promise<string> {
    return invoke<string>('read_text_file_absolute', { pathStr });
  }

  export async function writeTextFileAbsolute(pathStr: string, content: string): Promise<void> {
    return invoke('write_text_file_absolute', { pathStr, content });
  }

  export async function writeBinaryFileRecursive(pathStr: string, content: number[]): Promise<void> {
    return invoke('write_binary_file_recursive', { pathStr, content });
  }

  export async function mkdirAbsolute(pathStr: string): Promise<void> {
    return invoke('mkdir_absolute', { pathStr });
  }

  export async function showInFileManager(pathStr: string): Promise<void> {
    return invoke('show_in_file_manager', { pathStr });
  }

  export async function trashPath(pathStr: string): Promise<void> {
    return invoke('trash_path', { pathStr });
  }

  // ── System ────────────────────────────────────────────────────────────────────

  export async function fetchUrl(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    callerExtensionId?: string | null;
  }): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string; ok: boolean }> {
    return invoke('fetch_url', {
      url: params.url,
      method: params.method ?? 'GET',
      headers: params.headers,
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
  }): Promise<string> {
    return invoke<string>('send_notification', {
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
    return invoke('dismiss_notification', {
      notificationId: params.notificationId,
      callerExtensionId: params.callerExtensionId ?? null,
    });
  }

  export async function simulatePaste(): Promise<void> {
    return invoke('simulate_paste');
  }

  export async function expandAndPaste(keywordLen: number): Promise<void> {
    return invoke('expand_and_paste', { keywordLen });
  }

  export async function openAccessibilityPreferences(): Promise<void> {
    return invoke('open_accessibility_preferences');
  }

  export async function openUrl(url: string): Promise<void> {
    return invoke('plugin:opener|open_url', { url });
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
  }

  export async function clipboardGetAll(): Promise<StoredClipboardItem[]> {
    return invoke<StoredClipboardItem[]>('clipboard_get_all');
  }

  export async function clipboardToggleFavorite(id: string): Promise<boolean> {
    return invoke<boolean>('clipboard_toggle_favorite', { id });
  }

  export async function clipboardDeleteItem(id: string): Promise<void> {
    return invoke('clipboard_delete_item', { id });
  }

  export async function clipboardClearNonFavorites(): Promise<void> {
    return invoke('clipboard_clear_non_favorites');
  }

  export async function clipboardRecordCapture(item: StoredClipboardItem): Promise<StoredClipboardItem[]> {
    return invoke<StoredClipboardItem[]>('clipboard_record_capture', { item });
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
    return invoke('snippet_upsert', { snippet });
  }

  export async function snippetGetAll(): Promise<StoredSnippet[]> {
    return invoke<StoredSnippet[]>('snippet_get_all');
  }

  export async function snippetRemove(id: string): Promise<void> {
    return invoke('snippet_remove', { id });
  }

  export async function snippetTogglePin(id: string): Promise<boolean> {
    return invoke<boolean>('snippet_toggle_pin', { id });
  }

  export async function snippetClearAll(): Promise<void> {
    return invoke('snippet_clear_all');
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
    return invoke('shortcut_upsert', { shortcut });
  }

  export async function shortcutGetAll(): Promise<StoredItemShortcut[]> {
    return invoke<StoredItemShortcut[]>('shortcut_get_all');
  }

  export async function shortcutRemove(objectId: string): Promise<void> {
    return invoke('shortcut_remove', { objectId });
  }

  // ── Storage: Extension Key-Value ──────────────────────────────────────────────

  export interface KvEntry {
    key: string;
    value: string;
  }

  export async function extKvGet(extensionId: string, key: string): Promise<string | null> {
    return invoke<string | null>('ext_kv_get', { extensionId, key });
  }

  export async function extKvSet(extensionId: string, key: string, value: string): Promise<void> {
    return invoke('ext_kv_set', { extensionId, key, value });
  }

  export async function extKvDelete(extensionId: string, key: string): Promise<boolean> {
    return invoke<boolean>('ext_kv_delete', { extensionId, key });
  }

  export async function extKvGetAll(extensionId: string): Promise<KvEntry[]> {
    return invoke<KvEntry[]>('ext_kv_get_all', { extensionId });
  }

  export async function extKvClear(extensionId: string): Promise<number> {
    return invoke<number>('ext_kv_clear', { extensionId });
  }

  // ── Storage: Extension Cache ─────────────────────────────────────────────────

  export async function extCacheGet(extensionId: string, key: string): Promise<string | null> {
    return invoke<string | null>('ext_cache_get', { extensionId, key });
  }

  export async function extCacheSet(
    extensionId: string,
    key: string,
    value: string,
    expiresAt?: number
  ): Promise<void> {
    return invoke('ext_cache_set', { extensionId, key, value, expiresAt });
  }

  export async function extCacheDelete(extensionId: string, key: string): Promise<boolean> {
    return invoke<boolean>('ext_cache_delete', { extensionId, key });
  }

  export async function extCacheClear(extensionId: string): Promise<number> {
    return invoke<number>('ext_cache_clear', { extensionId });
  }

  // ── Snippets (legacy — text expansion sync) ──────────────────────────────────

  export async function syncSnippetsToRust(snippets: [string, string][]): Promise<void> {
    return invoke('sync_snippets_to_rust', { snippets });
  }

  export async function setSnippetsEnabled(enabled: boolean): Promise<void> {
    return invoke('set_snippets_enabled', { enabled });
  }

  export async function checkSnippetPermission(): Promise<boolean> {
    return invoke<boolean>('check_snippet_permission');
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
    return invoke('register_extension_permissions', {
      extensionId,
      permissions,
      permissionArgs: permissionArgs ?? null,
    });
  }

  export async function checkExtensionPermission(
    extensionId: string,
    callType: string
  ): Promise<PermissionCheckResult> {
    return invoke<PermissionCheckResult>('check_extension_permission', { extensionId, callType });
  }

  export async function getCurrentPlatform(): Promise<string> {
    return invoke<string>('get_current_platform');
  }

  // ── Shell Trust ──────────────────────────────────────────────────────────────

  export interface TrustedBinary {
    binaryPath: string;
    trustedAt: number;
  }

  export async function shellListTrusted(extensionId: string): Promise<TrustedBinary[]> {
    return invoke<TrustedBinary[]>('shell_list_trusted', { extensionId });
  }

  export async function shellRevokeTrust(extensionId: string, binaryPath: string): Promise<void> {
    return invoke('shell_revoke_trust', { extensionId, binaryPath });
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
  ): Promise<string> {
    return invoke<string>('export_profile', {
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
  ): Promise<ProfileArchiveContents> {
    return invoke<ProfileArchiveContents>('import_profile', {
      filePath,
      password,
    });
  }

  export async function showSaveProfileDialog(
    defaultFilename: string,
  ): Promise<string | null> {
    return invoke<string | null>('show_save_profile_dialog', { defaultFilename });
  }

  export async function showOpenProfileDialog(): Promise<string | null> {
    return invoke<string | null>('show_open_profile_dialog');
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

  export async function authInitiate(provider: string): Promise<AuthInitResponse> {
    return invoke<AuthInitResponse>('auth_initiate', { provider });
  }

  export async function authPoll(sessionCode: string): Promise<PollResponse> {
    return invoke<PollResponse>('auth_poll', { sessionCode });
  }

  export async function authLoadCached(): Promise<AuthStateResponse | null> {
    return invoke<AuthStateResponse | null>('auth_load_cached');
  }

  export async function authGetState(): Promise<AuthStateResponse> {
    return invoke<AuthStateResponse>('auth_get_state');
  }

  export async function authRefreshEntitlements(): Promise<string[]> {
    return invoke<string[]>('auth_refresh_entitlements');
  }

  export async function authCheckEntitlement(entitlement: string): Promise<boolean> {
    return invoke<boolean>('auth_check_entitlement', { entitlement });
  }

  export async function authLogout(): Promise<void> {
    return invoke('auth_logout');
  }

  // ── Cloud Sync ────────────────────────────────────────────────────────────────

  export interface SyncStatusResponse {
    lastSyncedAt: string | null;
    snapshotSize: number;
  }

  export async function syncUpload(payload: string): Promise<void> {
    return invoke('sync_upload', { payload });
  }

  export async function syncDownload(): Promise<string | null> {
    return invoke<string | null>('sync_download');
  }

  export async function syncGetStatus(): Promise<SyncStatusResponse> {
    return invoke<SyncStatusResponse>('sync_get_status');
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
  ): Promise<OAuthStartResponse> {
    return invoke<OAuthStartResponse>('oauth_start_flow', {
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
  ): Promise<OAuthExchangeResponse> {
    return invoke<OAuthExchangeResponse>('oauth_exchange_code', { stateParam, code });
  }

  export async function oauthGetStoredToken(
    extensionId: string,
    providerId: string,
  ): Promise<OAuthTokenPayload | null> {
    return invoke<OAuthTokenPayload | null>('oauth_get_stored_token', { extensionId, providerId });
  }

  export async function oauthRevokeExtensionToken(
    extensionId: string,
    providerId: string,
  ): Promise<void> {
    return invoke('oauth_revoke_extension_token', { extensionId, providerId });
  }
