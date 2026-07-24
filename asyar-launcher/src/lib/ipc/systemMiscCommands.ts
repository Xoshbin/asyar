// asyar-launcher/src/lib/ipc/systemMiscCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invoke } from '@tauri-apps/api/core';
import { invokeSafe } from './invokeSafe';

// ── Autostart ─────────────────────────────────────────────────────────────────

export async function getAutostartStatus(): Promise<boolean | null> {
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
} | null> {
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

/** Scheme-gated opener for router-dispatched callers
 * (`asyar:api:opener:open` → `opener_open_url`). Unlike `openUrl` above,
 * this goes through the Rust command that checks the caller's declared
 * `shell:open-url` schemes rather than the webview ACL — and it uses a raw
 * `invoke` deliberately so scheme denials propagate to the calling
 * extension as errors instead of dissolving into a diagnostic. */
export async function openerOpenUrl(extensionId: string | null, url: string): Promise<void> {
  await invoke('opener_open_url', { extensionId, url });
}
