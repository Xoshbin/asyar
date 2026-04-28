import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../envService', () => ({ envService: { isTauri: false } }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../extension/extensionIframeManager.svelte', () => ({
  extensionIframeManager: { sendFilterChangeToView: vi.fn() },
}));

import { searchBarAccessoryService } from './searchBarAccessoryService.svelte';
import { applyAccessoryFromCommand } from './applyAccessoryFromCommand';

describe('applyAccessoryFromCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchBarAccessoryService.clear();
  });

  it('declares the accessory when the command has one', async () => {
    await applyAccessoryFromCommand(
      {
        id: 'show',
        name: 'Show',
        mode: 'view',
        searchBarAccessory: {
          type: 'dropdown',
          default: 'all',
          options: [
            { value: 'all', title: 'All' },
            { value: 'images', title: 'Images' },
          ],
        },
      } as any,
      'org.test.ext',
      'show',
    );
    expect(searchBarAccessoryService.active?.extensionId).toBe('org.test.ext');
    expect(searchBarAccessoryService.active?.commandId).toBe('show');
  });

  it('is a no-op when the command has no searchBarAccessory', async () => {
    await applyAccessoryFromCommand(
      { id: 'show', name: 'Show', mode: 'view' } as any,
      'ext',
      'show',
    );
    expect(searchBarAccessoryService.active).toBeNull();
  });

  it('is a no-op when the command is undefined', async () => {
    await applyAccessoryFromCommand(undefined, 'ext', 'show');
    expect(searchBarAccessoryService.active).toBeNull();
  });

  it('is a no-op when options array is empty', async () => {
    await applyAccessoryFromCommand(
      {
        id: 'show',
        searchBarAccessory: { type: 'dropdown', options: [] },
      } as any,
      'ext',
      'show',
    );
    expect(searchBarAccessoryService.active).toBeNull();
  });
});
