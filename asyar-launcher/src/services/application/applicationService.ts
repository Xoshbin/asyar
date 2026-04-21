import { invoke } from '@tauri-apps/api/core';
import { settingsService } from '../settings/settingsService.svelte';
import type { FrontmostApplication } from 'asyar-sdk/contracts';

/**
 * One row of Library-scope data matched to an installed application by the
 * macOS uninstall scanner. Mirrors the Rust `AppDataPath` struct.
 */
export interface AppDataPath {
  path: string;
  sizeBytes: number;
  category: string;
}

/**
 * Result of a macOS uninstall scan — the `.app` path + size plus every
 * `~/Library/*` entry associated with the bundle id. Rendered in the
 * confirm sheet so the user sees exactly what will be trashed.
 */
export interface UninstallScanResult {
  appPath: string;
  appSizeBytes: number;
  dataPaths: AppDataPath[];
  totalBytes: number;
}

/**
 * Host-side service that fulfils the query half of `ApplicationService`
 * (the `application:*` IPC namespace). It does NOT implement the SDK's
 * `IApplicationService` directly because the `on*` push subscriptions are
 * a client-side concern — those route through `appEventsService` on the
 * `appEvents:*` namespace, not through this service.
 */
export class ApplicationService {
  async getFrontmostApplication(): Promise<FrontmostApplication> {
    return await invoke<FrontmostApplication>('get_frontmost_application');
  }

  async syncApplicationIndex(extraPaths?: string[]): Promise<{ added: number; removed: number; total: number }> {
    const paths = extraPaths ?? settingsService.currentSettings.search.additionalScanPaths ?? [];
    return await invoke('sync_application_index', { extraPaths: paths });
  }

  async listApplications(extraPaths?: string[]): Promise<any[]> {
    const paths = extraPaths ?? settingsService.currentSettings.search.additionalScanPaths ?? [];
    return await invoke('list_applications', { extraPaths: paths });
  }

  /**
   * The ExtensionIpcRouter flattens SDK proxy payload `{ bundleId }` into a
   * positional `bundleId: string` (same mechanism used by the other query
   * methods on this service). The `application` namespace is NOT in
   * `INJECTS_EXTENSION_ID`, so the router does NOT prepend extensionId —
   * per-call permission enforcement is handled by the frontend gate. The
   * Rust command receives `extension_id: None` and falls through its
   * defense-in-depth check as a core-context call.
   */
  async isRunning(bundleId: string): Promise<boolean> {
    return await invoke<boolean>('app_is_running', { bundleId });
  }

  /**
   * Uninstalls the selected application.
   *
   * macOS: moves the `.app` bundle to Trash, then trashes each path in
   * `dataPaths` that survives the per-path safety validator
   * (`~/Library/*` scope, absolute, not a symlink). Windows: ignores
   * `dataPaths` and launches the vendor uninstaller; user-data cleanup is
   * the vendor's responsibility.
   *
   * Tier 1 built-in capability — NOT exposed through the SDK to Tier 2
   * extensions. The Rust command rejects any non-core caller.
   *
   * All safety checks (system-protected paths, Asyar self, .app extension,
   * existence, per-data-path validation) live in Rust; this is a
   * pass-through. The application-index watcher detects the bundle
   * disappearing from the scanned directory and fires
   * `applications-changed` on its own — no manual sync needed.
   */
  async uninstallApplication(path: string, dataPaths: string[] = []): Promise<void> {
    await invoke<void>('uninstall_application', { path, dataPaths });
  }

  /**
   * Scans `~/Library/*` for data belonging to the application at `path`.
   * macOS-only — Windows and Linux return a Rust error (the vendor
   * uninstaller handles data on Windows; Linux is unsupported for
   * uninstall altogether).
   *
   * The caller should render the returned paths in a confirm sheet before
   * passing their `path` list to `uninstallApplication`. The scan is
   * advisory — Rust re-validates each path before trashing.
   */
  async scanUninstallTargets(path: string): Promise<UninstallScanResult> {
    return await invoke<UninstallScanResult>('scan_uninstall_targets', { path });
  }
}

export const applicationService = new ApplicationService();
