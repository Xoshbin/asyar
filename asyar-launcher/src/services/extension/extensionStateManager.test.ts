/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  discoverExtensions: vi.fn(),
  setExtensionEnabled: vi.fn(),
  uninstallExtension: vi.fn(),
}));

import { extensionStateManager } from './extensionStateManager.svelte';
import { discoverExtensions } from '../../lib/ipc/commands';

describe('extensionStateManager — needsRuntime', () => {
  beforeEach(() => {
    extensionStateManager.needsRuntime = [];
  });

  it('markNeedsRuntime adds the extension id', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a']);
  });

  it('markNeedsRuntime dedupes repeated calls for the same id', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.markNeedsRuntime('ext.a');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a']);
  });

  it('markNeedsRuntime tracks multiple distinct extensions', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.markNeedsRuntime('ext.b');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a', 'ext.b']);
  });

  it('clearNeedsRuntime removes the extension id', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.markNeedsRuntime('ext.b');
    extensionStateManager.clearNeedsRuntime('ext.a');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.b']);
  });

  it('clearNeedsRuntime on an id that was never marked is a no-op', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.clearNeedsRuntime('ext.never-marked');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a']);
  });
});

describe('extensionStateManager — iconUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeRecord(id: string, icon?: string) {
    return {
      manifest: {
        id,
        name: id,
        description: '',
        type: 'extension' as const,
        version: '1.0.0',
        commands: [],
        ...(icon ? { icon } : {}),
      },
      enabled: true,
      isBuiltIn: false,
      compatibility: 'compatible' as const,
    };
  }

  it('keeps icon: prefix as-is', async () => {
    vi.mocked(discoverExtensions).mockResolvedValueOnce([
      makeRecord('calc', 'icon:calculator'),
    ] as never);
    const [ext] = await extensionStateManager.getAllExtensionsWithState();
    expect(ext.iconUrl).toBe('icon:calculator');
  });

  it('keeps emoji as-is instead of prefixing asyar-icon://', async () => {
    vi.mocked(discoverExtensions).mockResolvedValueOnce([makeRecord('play', '🧪')] as never);
    const [ext] = await extensionStateManager.getAllExtensionsWithState();
    expect(ext.iconUrl).toBe('🧪');
  });

  it('prefixes bare filename to asyar-extension://', async () => {
    vi.mocked(discoverExtensions).mockResolvedValueOnce([makeRecord('ext', 'icon.png')] as never);
    const [ext] = await extensionStateManager.getAllExtensionsWithState();
    expect(ext.iconUrl).toBe('asyar-extension://ext/icon.png');
  });

  it('keeps asyar-icon:// and https:// as-is', async () => {
    vi.mocked(discoverExtensions).mockResolvedValueOnce([
      makeRecord('a', 'asyar-icon://a/icon.png'),
      makeRecord('b', 'https://example.com/i.png'),
    ] as never);
    const result = await extensionStateManager.getAllExtensionsWithState();
    expect(result[0].iconUrl).toBe('asyar-icon://a/icon.png');
    expect(result[1].iconUrl).toBe('https://example.com/i.png');
  });

  it('returns undefined when icon is missing', async () => {
    vi.mocked(discoverExtensions).mockResolvedValueOnce([makeRecord('noicon')] as never);
    const [ext] = await extensionStateManager.getAllExtensionsWithState();
    expect(ext.iconUrl).toBeUndefined();
  });
});
