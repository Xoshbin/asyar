/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectThemeVariables, THEME_VAR_NAMES, THEMEABLE_VAR_NAMES } from './themeVariables';

describe('collectThemeVariables', () => {
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  it('returns only non-empty entries', () => {
    element.style.setProperty('--bg-primary', 'rgb(255, 255, 255)');
    element.style.setProperty('--text-primary', '');

    const vars = collectThemeVariables(element);
    expect(vars['--bg-primary']).toBe('rgb(255, 255, 255)');
    expect(vars).not.toHaveProperty('--text-primary');
  });

  it('result keys are all from THEME_VAR_NAMES', () => {
    element.style.setProperty('--bg-primary', 'blue');
    element.style.setProperty('--custom-var', 'red');

    const vars = collectThemeVariables(element);
    const keys = Object.keys(vars);
    keys.forEach((key) => {
      expect(THEME_VAR_NAMES).toContain(key);
    });
    expect(vars).not.toHaveProperty('--custom-var');
  });

  it('handles an element with no custom properties', () => {
    const vars = collectThemeVariables(element);
    expect(Object.keys(vars)).toHaveLength(0);
  });

  it('trims whitespace from values', () => {
    // Note: getPropertyValue usually returns trimmed values, but we want to be sure
    // and sometimes it might have leading/trailing spaces depending on implementation
    element.style.setProperty('--bg-primary', '  rgb(0, 0, 0)  ');
    const vars = collectThemeVariables(element);
    expect(vars['--bg-primary']).toBe('rgb(0, 0, 0)');
  });
});

// A custom theme recolors the app; it must never resize its layout. The
// spacing grid and type scale are design-system-owned, so they are collected
// for iframe injection (THEME_VAR_NAMES) but NOT overridable by a theme
// (THEMEABLE_VAR_NAMES).
describe('THEMEABLE_VAR_NAMES', () => {
  it('excludes the spacing scale (--space-*)', () => {
    expect(THEMEABLE_VAR_NAMES.some((n) => n.startsWith('--space-'))).toBe(false);
  });

  it('excludes the type scale (--font-size-*)', () => {
    expect(THEMEABLE_VAR_NAMES.some((n) => n.startsWith('--font-size-'))).toBe(false);
  });

  it('still allows core color tokens', () => {
    expect(THEMEABLE_VAR_NAMES).toContain('--bg-primary');
    expect(THEMEABLE_VAR_NAMES).toContain('--text-primary');
    expect(THEMEABLE_VAR_NAMES).toContain('--accent-primary');
  });

  it('is a strict subset of THEME_VAR_NAMES (the iframe-injection list)', () => {
    for (const name of THEMEABLE_VAR_NAMES) {
      expect(THEME_VAR_NAMES).toContain(name);
    }
    expect(THEMEABLE_VAR_NAMES.length).toBeLessThan(THEME_VAR_NAMES.length);
  });

  it('keeps --space-* and --font-size-* in THEME_VAR_NAMES so iframes still receive them', () => {
    expect(THEME_VAR_NAMES).toContain('--space-5');
    expect(THEME_VAR_NAMES).toContain('--font-size-base');
  });

  it('excludes the size scale (--size-*), which dimensions every row and control', () => {
    expect(THEMEABLE_VAR_NAMES.some((n) => n.startsWith('--size-'))).toBe(false);
    expect(THEME_VAR_NAMES).toContain('--size-lg');
  });

  it('excludes the tracking scale (--tracking-*), drawn to fit Satoshi at fixed sizes', () => {
    expect(THEMEABLE_VAR_NAMES.some((n) => n.startsWith('--tracking-'))).toBe(false);
    expect(THEME_VAR_NAMES).toContain('--tracking-tight');
  });

  it('excludes the easing curves (--ease-*), which are the motion language itself', () => {
    expect(THEMEABLE_VAR_NAMES.some((n) => n.startsWith('--ease-'))).toBe(false);
    expect(THEME_VAR_NAMES).toContain('--ease-travel');
  });

  it('still allows retiming via --dur-*, which is a taste choice rather than physics', () => {
    expect(THEMEABLE_VAR_NAMES).toContain('--dur-travel');
  });

  it('allows the fill ramp, so a theme cannot recolor the voice and leave fills stale', () => {
    expect(THEMEABLE_VAR_NAMES).toContain('--accent-primary-fill');
    expect(THEMEABLE_VAR_NAMES).toContain('--accent-danger-fill');
  });

  it('allows the edge tokens, so a theme can recolor the edges on its surfaces', () => {
    expect(THEMEABLE_VAR_NAMES).toContain('--rim-light');
    expect(THEMEABLE_VAR_NAMES).toContain('--rim-shade');
  });
});
