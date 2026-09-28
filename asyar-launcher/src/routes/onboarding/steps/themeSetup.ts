import { emit } from '@tauri-apps/api/event';
import storeExtension from '../../../built-in-features/store/index.svelte';
import type { ApiExtension } from '../../../built-in-features/store/state.svelte';
import { settingsService } from '../../../services/settings/settingsService.svelte';
import { applyTheme } from '../../../services/theme/themeService';

export async function installThemeExtension(theme: ApiExtension): Promise<void> {
  await storeExtension.installExtension(theme.slug, theme.id, theme.name, theme);
}

export async function applyInstalledTheme(themeId: string): Promise<void> {
  await applyTheme(themeId);
  await settingsService.updateSettings('appearance', { activeTheme: themeId });
  await emit('asyar:theme-changed', { themeId });
}
