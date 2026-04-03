/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectThemeVariables, THEME_VAR_NAMES } from './themeVariables';

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
    keys.forEach(key => {
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
