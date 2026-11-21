import { describe, expect, it } from 'vitest';
import { clampListDensity, LIST_DENSITY_PRESETS, resolveListDensity } from './listDensity';

describe('resolveListDensity', () => {
  it('defaults to balanced', () => {
    expect(resolveListDensity({})).toEqual(LIST_DENSITY_PRESETS.balanced);
  });

  it('returns the chosen preset', () => {
    expect(resolveListDensity({ listDensity: 'comfortable' })).toEqual(
      LIST_DENSITY_PRESETS.comfortable,
    );
  });

  it('falls back to balanced for an unknown preset', () => {
    expect(resolveListDensity({ listDensity: 'huge' as never })).toEqual(
      LIST_DENSITY_PRESETS.balanced,
    );
  });

  it('clamps custom values to their ranges and steps', () => {
    expect(
      resolveListDensity({
        listDensity: 'custom',
        customListDensity: { rowHeight: 99, iconSize: 22.5, gap: 1, titleSize: 13, twoLine: true },
      }),
    ).toEqual({ rowHeight: 56, iconSize: 24, gap: 6, titleSize: 13, twoLine: true });
  });
});

describe('clampListDensity', () => {
  it('keeps the row tall enough for its icon', () => {
    expect(clampListDensity({ rowHeight: 32, iconSize: 40 }).rowHeight).toBe(48);
  });

  it('uses balanced values for missing or invalid fields', () => {
    expect(clampListDensity({ gap: Number.NaN })).toEqual(LIST_DENSITY_PRESETS.balanced);
  });
});
