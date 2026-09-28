import { beforeEach, describe, expect, it, vi } from 'vitest';

const installExtension = vi.hoisted(() => vi.fn());
const applyTheme = vi.hoisted(() => vi.fn());
const updateSettings = vi.hoisted(() => vi.fn());
const emit = vi.hoisted(() => vi.fn());

vi.mock('../../../built-in-features/store/index.svelte', () => ({
  default: { installExtension },
}));
vi.mock('../../../services/theme/themeService', () => ({ applyTheme }));
vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: { updateSettings },
}));
vi.mock('@tauri-apps/api/event', () => ({ emit }));

import { applyInstalledTheme, installThemeExtension } from './themeSetup';

const theme = {
  id: 9,
  name: 'Nord',
  slug: 'nord',
  description: '',
  category: 'appearance',
  status: 'published',
  author: { id: 1, name: 'Asyar' },
  manifest: { type: 'theme' as const, permissions: ['theme:read'] },
};

describe('theme setup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('installs with listing metadata without applying the theme', async () => {
    await installThemeExtension(theme);

    expect(installExtension).toHaveBeenCalledWith('nord', 9, 'Nord', theme);
    expect(applyTheme).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('applies an already-installed theme and persists the selection', async () => {
    await applyInstalledTheme('org.asyar.nord');

    expect(applyTheme).toHaveBeenCalledWith('org.asyar.nord');
    expect(updateSettings).toHaveBeenCalledWith('appearance', {
      activeTheme: 'org.asyar.nord',
    });
    expect(emit).toHaveBeenCalledWith('asyar:theme-changed', {
      themeId: 'org.asyar.nord',
    });
  });
});
