import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('themeFonts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('buildFontFaceCSS fetches fonts and returns CSS string', async () => {
    const mockBuffer = new TextEncoder().encode('mock font data').buffer;
    vi.mocked(fetch).mockResolvedValue({
        arrayBuffer: () => Promise.resolve(mockBuffer)
    } as Response);

    const { buildFontFaceCSS } = await import('./themeFonts');
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

    const { buildFontFaceCSS } = await import('./themeFonts');
    const css1 = await buildFontFaceCSS();
    const css2 = await buildFontFaceCSS();

    expect(css1).toBe(css2);
    // Since it's cached, fetch should only have been called 4 times total
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
