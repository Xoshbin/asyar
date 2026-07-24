// asyar-launcher/src/lib/ipc/profileCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe } from './invokeSafe';

// ── Raycast import ───────────────────────────────────────────────────────────

export async function raycastImportParse(
  path: string,
  password?: string,
): Promise<import('../../built-in-features/raycast-import/types').ParseOutcome | null> {
  return invokeSafe('raycast_import_parse', { path, password });
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

export async function showSaveProfileDialog(defaultFilename: string): Promise<string | null> {
  return invokeSafe<string | null>('show_save_profile_dialog', { defaultFilename });
}

export async function showOpenProfileDialog(): Promise<string | null> {
  return invokeSafe<string | null>('show_open_profile_dialog');
}
