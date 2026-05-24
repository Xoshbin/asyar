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
  /**
   * Platform-native bundle / process identifier when discoverable:
   * - macOS: `CFBundleIdentifier` from `Contents/Info.plist` (e.g. `com.apple.Safari`)
   * - Linux: `StartupWMClass` from the `.desktop` entry, or the basename of
   *   `Exec=` as a fallback (e.g. `firefox`)
   * - Windows: typically absent — `.lnk` shortcuts don't carry a bundle id
   *
   * Prefer this over `name` when calling `IApplicationService.isRunning()`,
   * falling back to `name` when `bundleId` is unavailable.
   */
  bundleId?: string;
}
