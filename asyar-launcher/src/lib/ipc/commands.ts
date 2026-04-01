// asyar-launcher/src/lib/ipc/commands.ts
import { invoke } from '@tauri-apps/api/core';
import type { SearchableItem, SearchResult, Application } from '../../bindings';
import type { ExtensionRecord } from '../../types/ExtensionRecord';

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
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('merged_search', { query, externalResults, minResults });
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

export async function syncApplicationIndex(): Promise<SyncResult> {
  return invoke<SyncResult>('sync_application_index');
}

export async function listApplications(): Promise<Application[]> {
  return invoke<Application[]>('list_applications');
}

export async function openApplicationPath(path: string): Promise<void> {
  return invoke('open_application_path', { path });
}

// ── Window ────────────────────────────────────────────────────────────────────

export async function showWindow(): Promise<void> {
  return invoke('show');
}

export async function hideWindow(): Promise<void> {
  return invoke('hide');
}

export async function setFocusLock(locked: boolean): Promise<void> {
  return invoke('set_focus_lock', { locked });
}

export async function showSettingsWindow(): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const settingsWindow = await WebviewWindow.getByLabel('settings');
  if (settingsWindow) {
    await settingsWindow.show();
    await settingsWindow.setFocus();
  }
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

export async function sendNotification(params: {
  title: string;
  body: string;
  callerExtensionId?: string | null;
}): Promise<void> {
  return invoke('send_notification', params);
}

export async function simulatePaste(): Promise<void> {
  return invoke('simulate_paste');
}

export async function expandAndPaste(keywordLen: number): Promise<void> {
  return invoke('expand_and_paste', { keywordLen });
}

export async function updateTrayMenu(items: Array<{ id: string; label: string }>): Promise<void> {
  return invoke('update_tray_menu', { items });
}

export async function openAccessibilityPreferences(): Promise<void> {
  return invoke('open_accessibility_preferences');
}

export async function openUrl(url: string): Promise<void> {
  return invoke('plugin:opener|open_url', { url });
}

// ── Snippets ──────────────────────────────────────────────────────────────────

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

export async function registerExtensionPermissions(extensionId: string, permissions: string[]): Promise<void> {
  return invoke('register_extension_permissions', { extensionId, permissions });
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
