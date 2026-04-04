/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  getThemeDefinition: vi.fn(),
}));

vi.mock('../../lib/themeVariables', () => ({
  THEME_VAR_NAMES: [
    '--bg-primary', '--bg-secondary', '--text-primary', '--accent-primary', '--font-ui',
  ],
}));

import { applyTheme, removeTheme, THEME_STYLE_ID } from './themeService';
import { getThemeDefinition } from '../../lib/ipc/commands';

describe('themeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    removeTheme();
  });
  afterEach(() => { removeTheme(); });

  it('applyTheme sets CSS variables on documentElement', async () => {
    vi.mocked(getThemeDefinition).mockResolvedValue({
      variables: {
        '--bg-primary': 'rgba(25, 25, 35, 0.85)',
        '--accent-primary': 'rgb(138, 43, 226)',
      },
      fonts: [],
    });
    await applyTheme('my-dark-theme');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('rgba(25, 25, 35, 0.85)');
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('rgb(138, 43, 226)');
  });

  it('applyTheme silently ignores unknown variable names', async () => {
    vi.mocked(getThemeDefinition).mockResolvedValue({
      variables: { '--bg-primary': 'red', '--totally-unknown': 'ignored' },
      fonts: [],
    });
    await applyTheme('test-theme');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('red');
    expect(document.documentElement.style.getPropertyValue('--totally-unknown')).toBe('');
  });

  it('removeTheme clears all overridden CSS variables', async () => {
    vi.mocked(getThemeDefinition).mockResolvedValue({
      variables: { '--bg-primary': 'blue' },
      fonts: [],
    });
    await applyTheme('test-theme');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('blue');
    removeTheme();
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('');
  });

  it('applyTheme injects @font-face style element for fonts', async () => {
    vi.mocked(getThemeDefinition).mockResolvedValue({
      variables: {},
      fonts: [{ family: 'Inter', weight: '400', style: 'normal', src: 'fonts/Inter-Regular.woff2' }],
    });
    await applyTheme('font-theme');
    const styleEl = document.getElementById(THEME_STYLE_ID);
    expect(styleEl).not.toBeNull();
    expect(styleEl!.textContent).toContain('@font-face');
    expect(styleEl!.textContent).toContain('font-family: "Inter"');
    expect(styleEl!.textContent).toContain('asyar-extension://font-theme/fonts/Inter-Regular.woff2');
  });

  it('removeTheme removes injected @font-face style element', async () => {
    vi.mocked(getThemeDefinition).mockResolvedValue({
      variables: {},
      fonts: [{ family: 'Inter', weight: '400', style: 'normal', src: 'fonts/Inter.woff2' }],
    });
    await applyTheme('font-theme');
    expect(document.getElementById(THEME_STYLE_ID)).not.toBeNull();
    removeTheme();
    expect(document.getElementById(THEME_STYLE_ID)).toBeNull();
  });

  it('applyTheme replaces previous theme when called twice', async () => {
    vi.mocked(getThemeDefinition)
      .mockResolvedValueOnce({ variables: { '--bg-primary': 'red' }, fonts: [] })
      .mockResolvedValueOnce({ variables: { '--bg-primary': 'blue', '--text-primary': 'white' }, fonts: [] });
    await applyTheme('theme-a');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('red');
    await applyTheme('theme-b');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('blue');
    expect(document.documentElement.style.getPropertyValue('--text-primary')).toBe('white');
  });
});
