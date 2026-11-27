/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import {
  formatThemeId,
  matchesThemeExtension,
  parseThemeId,
  resolveThemeVariant,
} from './themeVariants';

describe('themeVariants', () => {
  it('parses and formats single and variant theme IDs', () => {
    expect(parseThemeId('org.asyar.catppuccin')).toEqual({
      extensionId: 'org.asyar.catppuccin',
      variantId: null,
    });
    expect(parseThemeId('org.asyar.tokyo-night#storm')).toEqual({
      extensionId: 'org.asyar.tokyo-night',
      variantId: 'storm',
    });
    expect(formatThemeId('org.asyar.tokyo-night', 'storm')).toBe('org.asyar.tokyo-night#storm');
    expect(formatThemeId('org.asyar.catppuccin', null)).toBe('org.asyar.catppuccin');
  });

  it('matches active themes belonging to an extension', () => {
    expect(matchesThemeExtension('org.asyar.tokyo-night#storm', 'org.asyar.tokyo-night')).toBe(
      true,
    );
    expect(matchesThemeExtension('org.asyar.tokyo-night', 'org.asyar.tokyo-night')).toBe(true);
    expect(matchesThemeExtension('org.asyar.catppuccin', 'org.asyar.tokyo-night')).toBe(false);
    expect(matchesThemeExtension(null, 'org.asyar.tokyo-night')).toBe(false);
  });

  it('resolves variant variables and falls back to first variant or top-level', () => {
    const multi = {
      variables: { '--font-ui': 'Inter' },
      fonts: [],
      variants: [
        {
          id: 'night',
          name: 'Night',
          appearance: 'dark' as const,
          variables: { '--bg-primary': '#1a1b26' },
          fonts: [],
        },
        {
          id: 'day',
          name: 'Day',
          appearance: 'light' as const,
          variables: { '--bg-primary': '#e1e2e7' },
          fonts: [],
        },
      ],
    };

    expect(resolveThemeVariant(multi, 'day').variables).toEqual({
      '--font-ui': 'Inter',
      '--bg-primary': '#e1e2e7',
    });
    expect(resolveThemeVariant(multi, null).variables).toEqual({
      '--font-ui': 'Inter',
      '--bg-primary': '#1a1b26',
    });
  });
});
