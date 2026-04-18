import type { Extension, ExtensionContext } from 'asyar-sdk';
import ApplicationsPreferencesPanel from '../../components/settings/ApplicationsPreferencesPanel.svelte';
import { registerSettingsPanel } from '../../services/settings/settingsPanelRegistry';

// Register at module load so the Settings UI sees the panel without waiting
// on initialize() — Vite's eager glob imports this file at app startup,
// which makes the registration available before the user opens Settings.
registerSettingsPanel('applications', ApplicationsPreferencesPanel);

// Settings-only built-in: results come from the Rust search index.
class ApplicationsExtension implements Extension {
  onUnload = () => {};

  async initialize(_context: ExtensionContext): Promise<void> {}
  async executeCommand(): Promise<any> {}
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new ApplicationsExtension();
