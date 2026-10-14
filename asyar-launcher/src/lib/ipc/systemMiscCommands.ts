// asyar-launcher/src/lib/ipc/systemMiscCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invoke } from '@tauri-apps/api/core';
import { invokeSafe } from './invokeSafe';

// ── Autostart ─────────────────────────────────────────────────────────────────

export async function getAutostartStatus(): Promise<boolean> {
  return invokeSafe<boolean>('get_autostart_status');
}

export async function initializeAutostartFromSettings(enabled: boolean): Promise<void> {
  await invokeSafe('initialize_autostart_from_settings', { enable: enabled });
}

// ── System ────────────────────────────────────────────────────────────────────

export async function fetchUrl(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  callerExtensionId?: string | null;
}): Promise<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  ok: boolean;
}> {
  return invokeSafe('fetch_url', {
    url: params.url,
    method: params.method ?? 'GET',
    headers: params.headers,
    body: params.body,
    timeoutMs: params.timeoutMs ?? 20000,
    callerExtensionId: params.callerExtensionId ?? null,
  });
}

export async function fetchUrlWithSecrets(
  params: Parameters<typeof fetchUrl>[0] & { secretRefs: string[] },
): ReturnType<typeof fetchUrl> {
  return invokeSafe('fetch_url_with_secrets', {
    url: params.url,
    method: params.method ?? 'GET',
    headers: params.headers,
    body: params.body,
    timeoutMs: params.timeoutMs ?? 20000,
    callerExtensionId: params.callerExtensionId ?? null,
    secretRefs: params.secretRefs,
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
export async function checkAccessibilityPermission(): Promise<boolean> {
  return invokeSafe<boolean>('check_accessibility_permission');
}

/** Deep-opens an OS settings pane from Rust (allowlisted bundle ids only).
 * Resolves `false` when the pane is not allowed, unsupported on this
 * platform, or the OS opener fails. */
export async function openSettingsPane(bundleId: string): Promise<boolean> {
  return invokeSafe<boolean>('open_settings_pane', { bundleId });
}

export async function openUrl(url: string): Promise<void> {
  await invokeSafe('plugin:opener|open_url', { url });
}

/** Scheme-gated opener for router-dispatched callers
 * (`asyar:api:opener:open` → `opener_open_url`). Unlike `openUrl` above,
 * this goes through the Rust command that checks the caller's declared
 * `shell:open-url` schemes rather than the webview ACL — and it uses a raw
 * `invoke` deliberately so scheme denials propagate to the calling
 * extension as errors instead of dissolving into a diagnostic. */
export async function openerOpenUrl(extensionId: string | null, url: string): Promise<void> {
  await invoke('opener_open_url', { extensionId, url });
}

export async function openerOpenPath(
  extensionId: string | null,
  path: string,
  withApp?: string,
): Promise<void> {
  await invoke('opener_open_path', {
    extensionId,
    path,
    with: withApp ?? null,
  });
}

export async function openerReveal(extensionId: string | null, path: string): Promise<void> {
  await invoke('opener_reveal', { extensionId, path });
}

/** Native-looking display data for a typed path (`~` expanded); `null` when
 * the path is relative or does not exist. */
export async function openerPathPreview(path: string): Promise<{
  path: string;
  name: string;
  parent: string;
  icon: string;
  size: number | null;
  /** Unix seconds; `null` where the filesystem doesn't record it. */
  created: number | null;
  modified: number | null;
} | null> {
  return invokeSafe('opener_path_preview', { path }, { silent: true });
}

/** Native file/folder icons (`asyar-icon` URLs or `icon:` fallbacks), one per
 * path, in order. */
export async function fileIcons(paths: string[]): Promise<string[]> {
  return invokeSafe('file_icons', { paths }, { silent: true });
}

export async function getSystemLocale(): Promise<{
  language: string;
  script: string | null;
  region: string | null;
  variant: string | null;
  raw: string;
} | null> {
  return invokeSafe('get_system_locale');
}
