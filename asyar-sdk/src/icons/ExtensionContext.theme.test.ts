import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExtensionContext, injectThemeVariables, injectFontFaceCSS } from '../ExtensionContext';

describe('ExtensionContext Theme Injection', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
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
      '--text-primary': 'white'
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
    // Instantiate ExtensionContext to set up the listener
    new ExtensionContext();
    
    const themeVars = { '--bg-primary': 'green' };
    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:theme:variables',
        payload: themeVars
      }
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
    new ExtensionContext();
    
    const mockCSS = '/* merged font faces */';
    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:theme:fonts',
        payload: mockCSS
      }
    });
    
    window.dispatchEvent(event);
    
    const style = document.getElementById('asyar-theme-fonts');
    expect(style?.textContent).toBe(mockCSS);
  });

  it('ignores asyar:theme:fonts with non-string payload', () => {
    new ExtensionContext();
    
    const event = new MessageEvent('message', {
      data: {
        type: 'asyar:theme:fonts',
        payload: { invalid: 'type' }
      }
    });
    
    window.dispatchEvent(event);
    
    const style = document.getElementById('asyar-theme-fonts');
    expect(style).toBeNull();
  });
});
