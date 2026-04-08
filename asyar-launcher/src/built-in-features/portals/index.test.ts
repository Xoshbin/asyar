/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/search/SearchService', () => ({
  searchService: { indexItem: vi.fn(), deleteItem: vi.fn(), saveIndex: vi.fn() },
}));
vi.mock('../../services/extension/commandService.svelte', () => ({
  commandService: { registerCommand: vi.fn(), unregisterCommand: vi.fn() },
}));
vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: { registerAction: vi.fn(), unregisterAction: vi.fn() },
}));
vi.mock('../../services/context/contextModeService.svelte', () => ({
  contextModeService: { registerProvider: vi.fn(), unregisterProvider: vi.fn(), updateQuery: vi.fn() },
}));
vi.mock('../../lib/placeholders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/placeholders')>();
  return { ...actual, resolveTemplate: vi.fn() };
});
vi.mock('./portalStore.svelte', () => ({
  portalStore: { portals: [], getAll: vi.fn(() => []), getById: vi.fn() },
}));
vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
    setExtensionForwarder: vi.fn(),
  },
}));
vi.mock('../../services/extension/extensionManager.svelte', () => ({ default: {} }));
vi.mock('../../services/extension/extensionIframeManager.svelte', () => ({
  extensionIframeManager: { init: vi.fn(), sendAction: vi.fn() },
}));

import { syncPortalToIndex } from './index.svelte';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { invoke } from '@tauri-apps/api/core';
import { resolveTemplate } from '../../lib/placeholders';

describe('Portal onActivate guard', () => {
  beforeEach(() => vi.clearAllMocks());

  async function getOnActivate(portal: any) {
    await syncPortalToIndex(portal);
    const call = vi.mocked(contextModeService.registerProvider).mock.calls
      .find(c => c[0].id === `portal_${portal.id}`);
    return call![0].onActivate!;
  }

  it('empty string query (Tab/trigger just set chip) → does NOT open browser', async () => {
    const portal = { id: '1', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    const onActivate = await getOnActivate(portal);
    await onActivate('');
    expect(invoke).not.toHaveBeenCalledWith('plugin:opener|open_url', expect.anything());
  });

  it('undefined query (same guard) → does NOT open browser', async () => {
    const portal = { id: '2', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    const onActivate = await getOnActivate(portal);
    await onActivate(undefined);
    expect(invoke).not.toHaveBeenCalledWith('plugin:opener|open_url', expect.anything());
  });

  it('non-empty query → resolves template and opens browser', async () => {
    const portal = { id: '3', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    vi.mocked(resolveTemplate).mockResolvedValue('https://google.com/?q=hello');
    const onActivate = await getOnActivate(portal);
    await onActivate('hello');
    expect(resolveTemplate).toHaveBeenCalledWith(portal.url, { query: 'hello' }, { encodeValues: true });
    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', { url: 'https://google.com/?q=hello' });
  });

  it('{Selected Text} portal with non-empty query → opens browser', async () => {
    const portal = { id: '4', name: 'Translate', url: 'https://translate.google.com/?text={Selected Text}', icon: '🌐' };
    vi.mocked(resolveTemplate).mockResolvedValue('https://translate.google.com/?text=hello+world');
    const onActivate = await getOnActivate(portal);
    await onActivate('hello world');
    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', { url: 'https://translate.google.com/?text=hello+world' });
  });
});

describe('Portal chip pre-fill (onActivate with empty query)', () => {
  beforeEach(() => vi.clearAllMocks());

  async function getOnActivate(portal: any) {
    await syncPortalToIndex(portal);
    const call = vi.mocked(contextModeService.registerProvider).mock.calls
      .find(c => c[0].id === `portal_${portal.id}`);
    return call![0].onActivate!;
  }

  // resolveChipPrefill is data-driven via PLACEHOLDERS — it calls def.resolve({}) directly,
  // not resolveTemplate. These tests mock resolveTemplate for the onActivate open-URL path
  // and verify updateQuery is called with whatever the placeholder resolver returns.

  it('{query} portal → no pre-fill, no updateQuery call', async () => {
    const portal = { id: '7', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    const onActivate = await getOnActivate(portal);
    await onActivate('');
    expect(vi.mocked(contextModeService.updateQuery)).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith('plugin:opener|open_url', expect.anything());
  });

  it('{Argument} alias portal → no pre-fill (treated same as {query})', async () => {
    const portal = { id: '10', name: 'Wiki', url: 'https://wiki.com/?q={Argument}', icon: '📖' };
    const onActivate = await getOnActivate(portal);
    await onActivate('');
    expect(vi.mocked(contextModeService.updateQuery)).not.toHaveBeenCalled();
  });

  it('non-empty query → opens URL (no pre-fill branch reached)', async () => {
    const portal = { id: '11', name: 'Google', url: 'https://google.com/?q={query}', icon: '🔍' };
    vi.mocked(resolveTemplate).mockResolvedValue('https://google.com/?q=hello');
    const onActivate = await getOnActivate(portal);
    await onActivate('hello');
    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', { url: 'https://google.com/?q=hello' });
    expect(vi.mocked(contextModeService.updateQuery)).not.toHaveBeenCalled();
  });
});
