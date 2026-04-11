import { invoke } from '@tauri-apps/api/core';

export interface PreferenceExportRow {
  extensionId: string;
  commandId: string | null;
  key: string;
  value: string;
  isEncrypted: boolean;
  updatedAt: number;
}

export async function extensionPreferencesGetAll(
  extensionId: string
): Promise<PreferenceExportRow[]> {
  return invoke('extension_preferences_get_all', { extensionId });
}

export async function extensionPreferencesSet(
  extensionId: string,
  commandId: string | null,
  key: string,
  value: string,
  isEncrypted: boolean
): Promise<void> {
  return invoke('extension_preferences_set', {
    extensionId,
    commandId,
    key,
    value,
    isEncrypted,
  });
}

export async function extensionPreferencesReset(extensionId: string): Promise<void> {
  return invoke('extension_preferences_reset', { extensionId });
}

export interface PreferencesExport {
  rows: PreferenceExportRow[];
}

export interface PreferencesImportResult {
  itemsAdded: number;
  itemsUpdated: number;
  itemsSkipped: number;
}

/**
 * Export all non-encrypted preference rows across all extensions.
 * Encrypted (password-type) rows are filtered at the Rust SQL layer and
 * never leave the device.
 */
export async function extensionPreferencesExportAll(): Promise<PreferencesExport> {
  return invoke('extension_preferences_export_all');
}

/**
 * Import a PreferencesExport payload. Encrypted rows in the payload are
 * skipped at the Rust layer — only non-password preferences can arrive
 * from another device.
 */
export async function extensionPreferencesImportAll(
  payload: PreferencesExport,
  strategy: 'replace' | 'merge'
): Promise<PreferencesImportResult> {
  return invoke('extension_preferences_import_all', { payload, strategy });
}
