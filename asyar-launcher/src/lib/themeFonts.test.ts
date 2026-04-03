import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFontFaceCSS } from './themeFonts';

describe('themeFonts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    // Clear the cache by resetting the module state if possible, 
    // but since it's a module-level variable, we might need a way to reset it or just accept it's a singleton.
    // For TDD, we'll assume we can test the behavior.
  });

  it('buildFontFaceCSS fetches fonts and returns CSS string', async () => {
    const mockBuffer = new TextEncoder().encode('mock font data').buffer;
    vi.mocked(fetch).mockResolvedValue({
        arrayBuffer: () => Promise.resolve(mockBuffer)
    } as Response);

    const css = await buildFontFaceCSS();

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(css).toContain('@font-face');
    expect(css).toContain('font-family: "Satoshi"');
    expect(css).toContain('font-family: "JetBrains Mono"');
    expect(css).toContain('data:font/woff2;base64,');
  });

  it('buildFontFaceCSS caches the result', async () => {
    const mockBuffer = new TextEncoder().encode('mock font data').buffer;
    vi.mocked(fetch).mockResolvedValue({
        arrayBuffer: () => Promise.resolve(mockBuffer)
    } as Response);

    const css1 = await buildFontFaceCSS();
    const css2 = await buildFontFaceCSS();

    expect(css1).toBe(css2);
    // Since it's cached, fetch should only have been called 4 times total
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
