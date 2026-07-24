/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  getThemeDefinition: vi.fn(),
}));

vi.mock('../../lib/themeVariables', () => {
  const THEME_VAR_NAMES = [
    '--bg-primary',
    '--bg-secondary',
    '--text-primary',
    '--accent-primary',
    '--font-ui',
    '--space-5',
    '--font-size-base',
  ];
  return {
    THEME_VAR_NAMES,
    THEMEABLE_VAR_NAMES: THEME_VAR_NAMES.filter(
      (n) => !n.startsWith('--space-') && !n.startsWith('--font-size-'),
    ),
  };
});

import { applyTheme, removeTheme, THEME_STYLE_ID } from './themeService';
import { getThemeDefinition } from '../../lib/ipc/commands';

describe('themeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    removeTheme();
  });
  afterEach(() => {
    removeTheme();
  });

  it('applyTheme sets CSS variables on documentElement', async () => {
    vi.mocked(getThemeDefinition).mockResolvedValue({
      variables: {
        '--bg-primary': 'rgba(25, 25, 35, 0.85)',
        '--accent-primary': 'rgb(138, 43, 226)',
      },
      fonts: [],
    });
    await applyTheme('my-dark-theme');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe(
      'rgba(25, 25, 35, 0.85)',
    );
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe(
      'rgb(138, 43, 226)',
    );
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

  it('applyTheme ignores structural tokens so a theme cannot resize the layout', async () => {
    vi.mocked(getThemeDefinition).mockResolvedValue({
      variables: { '--bg-primary': 'red', '--space-5': '40px', '--font-size-base': '20px' },
      fonts: [],
    });
    await applyTheme('bloated-theme');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('red');
    expect(document.documentElement.style.getPropertyValue('--space-5')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe('');
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
      fonts: [
        { family: 'Inter', weight: '400', style: 'normal', src: 'fonts/Inter-Regular.woff2' },
      ],
    });
    await applyTheme('font-theme');
    const styleEl = document.getElementById(THEME_STYLE_ID);
    expect(styleEl).not.toBeNull();
    expect(styleEl!.textContent).toContain('@font-face');
    expect(styleEl!.textContent).toContain('font-family: "Inter"');
    expect(styleEl!.textContent).toContain(
      'asyar-extension://font-theme/fonts/Inter-Regular.woff2',
    );
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
      .mockResolvedValueOnce({
        variables: { '--bg-primary': 'blue', '--text-primary': 'white' },
        fonts: [],
      });
    await applyTheme('theme-a');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('red');
    await applyTheme('theme-b');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('blue');
    expect(document.documentElement.style.getPropertyValue('--text-primary')).toBe('white');
  });

  // The marker lets CSS (.settings-page opaque overrides) step aside so a
  // custom theme's full palette — text included — flows through coherently.
  it('applyTheme marks documentElement with data-custom-theme = themeId', async () => {
    vi.mocked(getThemeDefinition).mockResolvedValue({
      variables: { '--bg-primary': 'blue' },
      fonts: [],
    });
    await applyTheme('catppuccin');
    expect(document.documentElement.dataset.customTheme).toBe('catppuccin');
  });

  it('removeTheme clears the data-custom-theme marker', async () => {
    vi.mocked(getThemeDefinition).mockResolvedValue({
      variables: { '--bg-primary': 'blue' },
      fonts: [],
    });
    await applyTheme('catppuccin');
    expect(document.documentElement.dataset.customTheme).toBe('catppuccin');
    removeTheme();
    expect(document.documentElement.dataset.customTheme).toBeUndefined();
  });

  it('applyTheme updates the marker when switching themes', async () => {
    vi.mocked(getThemeDefinition)
      .mockResolvedValueOnce({ variables: {}, fonts: [] })
      .mockResolvedValueOnce({ variables: {}, fonts: [] });
    await applyTheme('theme-a');
    expect(document.documentElement.dataset.customTheme).toBe('theme-a');
    await applyTheme('theme-b');
    expect(document.documentElement.dataset.customTheme).toBe('theme-b');
  });
});
