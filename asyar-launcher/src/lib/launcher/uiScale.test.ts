import { expect, test } from 'vitest';

import { clampUiScale, DEFAULT_UI_SCALE, UI_SCALE_OPTIONS } from './uiScale';

test('allowed values pass through', () => {
  for (const option of UI_SCALE_OPTIONS) {
    expect(clampUiScale(option.value)).toBe(option.value);
  }
});

test('snaps to nearest allowed value', () => {
  expect(clampUiScale(1.04)).toBe(1);
  expect(clampUiScale(1.13)).toBe(1.1);
  expect(clampUiScale(3)).toBe(1.2);
});

test('falls back to default for junk', () => {
  expect(clampUiScale(undefined)).toBe(DEFAULT_UI_SCALE);
  expect(clampUiScale(Number.NaN)).toBe(DEFAULT_UI_SCALE);
  expect(clampUiScale('big' as unknown)).toBe(DEFAULT_UI_SCALE);
});
