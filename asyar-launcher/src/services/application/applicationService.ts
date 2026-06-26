import { settingsService } from '../settings/settingsService.svelte';
import type { FrontmostApplication } from 'asyar-sdk/contracts';
import {
  getFrontmostApplication,
  appIsRunning,
  uninstallApplication,
  scanUninstallTargets,
  type UninstallScanResult,
} from '../../lib/ipc/applicationCommands';
import { syncApplicationIndex, listApplications } from '../../lib/ipc/commands';

export type { AppDataPath, UninstallScanResult } from '../../lib/ipc/applicationCommands';

/**
 * Host-side service that fulfils the query half of `ApplicationService`
 * (the `application:*` IPC namespace). It does NOT implement the SDK's
 * `IApplicationService` directly because the `on*` push subscriptions are
 * a client-side concern — those route through `appEventsService` on the
 * `appEvents:*` namespace, not through this service.
 */
export class ApplicationService {
  async getFrontmostApplication(): Promise<FrontmostApplication | null> {
    return getFrontmostApplication();
  }

  async syncApplicationIndex(extraPaths?: string[]): Promise<{ added: number; removed: number; total: number }> {
    const paths = extraPaths ?? settingsService.currentSettings.search.additionalScanPaths ?? [];
    return (await syncApplicationIndex(paths)) ?? { added: 0, removed: 0, total: 0 };
  }

  async listApplications(extraPaths?: string[]): Promise<any[]> {
    const paths = extraPaths ?? settingsService.currentSettings.search.additionalScanPaths ?? [];
    return (await listApplications(paths)) ?? [];
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
    return (await appIsRunning(bundleId)) ?? false;
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
    await uninstallApplication(path, dataPaths);
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
  async scanUninstallTargets(path: string): Promise<UninstallScanResult | null> {
    return scanUninstallTargets(path);
  }
}

export const applicationService = new ApplicationService();
