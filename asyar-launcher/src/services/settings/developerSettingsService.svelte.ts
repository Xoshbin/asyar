// Developer settings service — module-level singleton.
//
// Reads the `developer` section from `settingsService.currentSettings`
// and exposes derived booleans for each developer feature. All sub-features
// are gated behind `isDeveloperMode` — if the master toggle is off, every
// sub-feature getter returns false regardless of its own stored value.
//
// This is display-only: no data transformation, no business logic.
// The frontend reads; Rust persists.

import { settingsService } from './settingsService.svelte';

export class DeveloperSettingsService {
  /** Reactive: true when the user has enabled developer mode */
  get isDeveloperMode(): boolean {
    return settingsService.currentSettings?.developer?.enabled ?? false;
  }

  /** Show the DevEx Inspector panel in the main launcher window */
  get showInspector(): boolean {
    return this.isDeveloperMode &&
      (settingsService.currentSettings?.developer?.showInspector ?? false);
  }

  /** Enable verbose extension logging */
  get verboseLogging(): boolean {
    return this.isDeveloperMode &&
      (settingsService.currentSettings?.developer?.verboseLogging ?? false);
  }

  /** Record IPC/RPC traces for the inspector */
  get tracing(): boolean {
    return this.isDeveloperMode &&
      (settingsService.currentSettings?.developer?.tracing ?? false);
  }

  /** Allow sideloading extensions from local files */
  get allowSideloading(): boolean {
    return this.isDeveloperMode &&
      (settingsService.currentSettings?.developer?.allowSideloading ?? false);
  }
}

export const developerSettingsService = new DeveloperSettingsService();
