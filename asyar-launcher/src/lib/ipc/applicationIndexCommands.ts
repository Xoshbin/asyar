// asyar-launcher/src/lib/ipc/applicationIndexCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe } from './invokeSafe';
import type { Application } from '../../bindings';

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
