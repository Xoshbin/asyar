// asyar-launcher/src/lib/ipc/extensionStorageCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe } from './invokeSafe';

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
  expiresAt?: number,
): Promise<void> {
  await invokeSafe('ext_cache_set', { extensionId, key, value, expiresAt });
}

export async function extCacheDelete(extensionId: string, key: string): Promise<boolean | null> {
  return invokeSafe<boolean>('ext_cache_delete', { extensionId, key });
}

export async function extCacheClear(extensionId: string): Promise<number | null> {
  return invokeSafe<number>('ext_cache_clear', { extensionId });
}
