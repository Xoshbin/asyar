// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => {
    throw new Error('not in tauri');
  },
}));

describe('getHostPlatform', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not misclassify jsdom darwin userAgent as windows', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/28.0.0',
    });
    const { getHostPlatform } = await import('./hostPlatform');
    expect(getHostPlatform()).toBe('other');
  });

  it('detects Windows from Windows userAgent strings', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    const { getHostPlatform } = await import('./hostPlatform');
    expect(getHostPlatform()).toBe('windows');
  });
});
