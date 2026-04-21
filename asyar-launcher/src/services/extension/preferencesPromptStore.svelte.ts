import type { PreferenceDeclaration } from 'asyar-sdk/contracts';

/**
 * Reactive store for the "required preferences" modal. The commandService
 * opens this store when it tries to execute a command whose extension has
 * required preferences that are currently unset. The root layout mounts
 * PreferencesPromptHost, which subscribes to this store and renders the
 * blocking modal.
 *
 * `commandObjectId` is the composite id (e.g. `cmd_org.example_forecast`)
 * stored by commandService so the host can re-invoke execution after the
 * user fills in the missing values.
 */
interface PreferencesPromptState {
  extensionId: string;
  commandId: string;
  commandObjectId: string;
  missing: PreferenceDeclaration[];
}

class PreferencesPromptStore {
  active = $state<PreferencesPromptState | null>(null);

  open(state: PreferencesPromptState): void {
    this.active = state;
  }

  close(): void {
    this.active = null;
  }
}

export const preferencesPromptStore = new PreferencesPromptStore();
