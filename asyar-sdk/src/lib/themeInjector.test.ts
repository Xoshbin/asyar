import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupThemeInjection, injectThemeVariables, injectFontFaceCSS } from './themeInjector';

describe('themeInjector', () => {
  beforeEach(() => {
    document.head.textContent = '';
    document.body.textContent = '';
    vi.restoreAllMocks();
  });

  it('injectThemeVariables creates a <style id="asyar-theme-vars"> in document.head', () => {
    injectThemeVariables({ '--bg-primary': 'red' });

    const style = document.getElementById('asyar-theme-vars') as HTMLStyleElement;
    expect(style).toBeTruthy();
    expect(style.parentElement).toBe(document.head);
    expect(style.textContent).toContain('--bg-primary: red;');
  });

  it('injectThemeVariables populates it with :root declarations', () => {
    injectThemeVariables({
      '--bg-primary': 'red',
      '--text-primary': 'white',
    });

    const style = document.getElementById('asyar-theme-vars')!;
    expect(style.textContent).toContain(':root {');
    expect(style.textContent).toContain('--bg-primary: red;');
    expect(style.textContent).toContain('--text-primary: white;');
  });

  it('calling injectThemeVariables twice updates the existing style element', () => {
    injectThemeVariables({ '--bg-primary': 'red' });
    const initialStyle = document.getElementById('asyar-theme-vars');

    injectThemeVariables({ '--bg-primary': 'blue' });
    const updatedStyle = document.getElementById('asyar-theme-vars');

    expect(initialStyle).toBe(updatedStyle);
    expect(updatedStyle?.textContent).toContain('--bg-primary: blue;');
  });

  it('injectThemeVariables with empty object produces an empty :root {} block', () => {
    injectThemeVariables({});
    const style = document.getElementById('asyar-theme-vars');
    expect(style?.textContent).toContain(':root {\n\n}');
  });

  it('receiving asyar:theme:variables message triggers injection', () => {
    setupThemeInjection();

    const themeVars = { '--bg-primary': 'green' };
    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:theme:variables',
        payload: themeVars,
      },
    });

    window.dispatchEvent(event);

    const style = document.getElementById('asyar-theme-vars');
    expect(style?.textContent).toContain('--bg-primary: green;');
  });

  it('injectFontFaceCSS creates a <style id="asyar-theme-fonts"> in document.head', () => {
    const mockCSS = '@font-face { font-family: "Satoshi"; }';
    injectFontFaceCSS(mockCSS);

    const style = document.getElementById('asyar-theme-fonts') as HTMLStyleElement;
    expect(style).toBeTruthy();
    expect(style.parentElement).toBe(document.head);
    expect(style.textContent).toBe(mockCSS);
  });

  it('calling injectFontFaceCSS twice updates the existing style element', () => {
    injectFontFaceCSS('body { font-family: Satoshi; }');
    const initialStyle = document.getElementById('asyar-theme-fonts');

    injectFontFaceCSS('body { font-family: JetBrains; }');
    const updatedStyle = document.getElementById('asyar-theme-fonts');

    expect(initialStyle).toBe(updatedStyle);
    expect(updatedStyle?.textContent).toBe('body { font-family: JetBrains; }');
  });

  it('receiving asyar:theme:fonts message triggers injection', () => {
    setupThemeInjection();

    const mockCSS = '/* merged font faces */';
    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:theme:fonts',
        payload: mockCSS,
      },
    });

    window.dispatchEvent(event);

    const style = document.getElementById('asyar-theme-fonts');
    expect(style?.textContent).toBe(mockCSS);
  });

  it('ignores asyar:theme:fonts with non-string payload', () => {
    setupThemeInjection();

    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:theme:fonts',
        payload: { invalid: 'type' },
      },
    });

    window.dispatchEvent(event);

    const style = document.getElementById('asyar-theme-fonts');
    expect(style).toBeNull();
  });

  it('does not inject default view bg or alter inline styles in host window (parent === window)', () => {
    setupThemeInjection();

    expect(document.getElementById('asyar-default-view-bg')).toBeNull();
    expect(document.documentElement.style.backgroundColor).toBe('');
    expect(document.body.style.backgroundColor).toBe('');
  });

  it('injects low-precedence style fallback in iframe context (parent !== window)', () => {
    const originalParent = window.parent;
    try {
      Object.defineProperty(window, 'parent', {
        value: {},
        writable: true,
        configurable: true,
      });

      setupThemeInjection();

      const bgStyle = document.getElementById('asyar-default-view-bg');
      expect(bgStyle).toBeTruthy();
      expect(bgStyle?.parentElement).toBe(document.head);
      expect(bgStyle?.textContent).toContain(
        ':root, html, body { background-color: transparent; }',
      );
      // Inline styles must remain untouched so author styles take precedence
      expect(document.documentElement.style.backgroundColor).toBe('');
      expect(document.body.style.backgroundColor).toBe('');
    } finally {
      Object.defineProperty(window, 'parent', {
        value: originalParent,
        writable: true,
        configurable: true,
      });
    }
  });
});
