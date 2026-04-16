/**
 * An installed application discovered by the Rust scanner.
 *
 * Mirrors the `Application` struct from
 * `asyar-launcher/src-tauri/src/search_engine/models.rs`.
 * Field names use camelCase (Rust struct has `#[serde(rename_all = "camelCase")]`).
 */
export interface InstalledApplication {
  id: string;
  name: string;
  path: string;
  usageCount: number;
  icon?: string;
  lastUsedAt?: number;
}
