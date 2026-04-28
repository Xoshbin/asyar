import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../envService', () => ({ envService: { isTauri: true } }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../extension/extensionIframeManager.svelte', () => ({
  extensionIframeManager: { sendFilterChangeToView: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { searchBarAccessoryService } from './searchBarAccessoryService.svelte';
import { extensionIframeManager } from '../extension/extensionIframeManager.svelte';

const EXT = 'org.test.ext';
const CMD = 'show';

describe('searchBarAccessoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchBarAccessoryService.clear();
  });

  it('declare seeds from persisted value when present', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('images'); // searchbar_accessory_get
    await searchBarAccessoryService.declare({
      extensionId: EXT,
      commandId: CMD,
      options: [
        { value: 'all', title: 'All' },
        { value: 'images', title: 'Images' },
      ],
      default: 'all',
    });
    expect(invoke).toHaveBeenCalledWith('searchbar_accessory_get', {
      extensionId: EXT,
      commandId: CMD,
    });
    expect(searchBarAccessoryService.active?.value).toBe('images');
  });

  it('declare seeds from manifest default when no persisted value', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await searchBarAccessoryService.declare({
      extensionId: EXT,
      commandId: CMD,
      options: [
        { value: 'all', title: 'All' },
        { value: 'images', title: 'Images' },
      ],
      default: 'all',
    });
    expect(searchBarAccessoryService.active?.value).toBe('all');
  });

  it('declare falls back to options[0] when no default and no persisted value', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await searchBarAccessoryService.declare({
      extensionId: EXT,
      commandId: CMD,
      options: [
        { value: 'first', title: 'First' },
        { value: 'second', title: 'Second' },
      ],
    });
    expect(searchBarAccessoryService.active?.value).toBe('first');
  });

  it('setSelected persists and broadcasts to view iframe', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null); // get
    await searchBarAccessoryService.declare({
      extensionId: EXT,
      commandId: CMD,
      options: [
        { value: 'all', title: 'All' },
        { value: 'images', title: 'Images' },
      ],
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined); // set
    await searchBarAccessoryService.setSelected(EXT, CMD, 'images');

    expect(invoke).toHaveBeenCalledWith('searchbar_accessory_set', {
      extensionId: EXT,
      commandId: CMD,
      value: 'images',
    });
    expect(searchBarAccessoryService.active?.value).toBe('images');
    expect(extensionIframeManager.sendFilterChangeToView).toHaveBeenCalledWith(
      EXT,
      { commandId: CMD, value: 'images' },
    );
  });

  it('clear() nulls active state but does not touch SQLite', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await searchBarAccessoryService.declare({
      extensionId: EXT,
      commandId: CMD,
      options: [{ value: 'a', title: 'A' }],
    });
    searchBarAccessoryService.clear();
    expect(searchBarAccessoryService.active).toBeNull();
    // No `searchbar_accessory_*` invoke happened during clear:
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('subscribe handler fires immediately if active matches', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('images');
    await searchBarAccessoryService.declare({
      extensionId: EXT,
      commandId: CMD,
      options: [
        { value: 'all', title: 'All' },
        { value: 'images', title: 'Images' },
      ],
    });

    const handler = vi.fn();
    const off = searchBarAccessoryService.subscribe(EXT, CMD, handler);
    expect(handler).toHaveBeenCalledWith('images');
    off();
  });

  it('subscribe order-independent — declare-first OR subscribe-first both fire once', async () => {
    const handler = vi.fn();
    const off = searchBarAccessoryService.subscribe(EXT, CMD, handler);
    expect(handler).not.toHaveBeenCalled(); // no active yet

    vi.mocked(invoke).mockResolvedValueOnce(null);
    await searchBarAccessoryService.declare({
      extensionId: EXT,
      commandId: CMD,
      options: [{ value: 'all', title: 'All' }],
      default: 'all',
    });
    expect(handler).toHaveBeenCalledWith('all');
    off();
  });

  it('multiple subscribers all fire on setSelected', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await searchBarAccessoryService.declare({
      extensionId: EXT,
      commandId: CMD,
      options: [
        { value: 'all', title: 'All' },
        { value: 'images', title: 'Images' },
      ],
    });

    const a = vi.fn();
    const b = vi.fn();
    searchBarAccessoryService.subscribe(EXT, CMD, a);
    searchBarAccessoryService.subscribe(EXT, CMD, b);
    a.mockClear();
    b.mockClear();

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await searchBarAccessoryService.setSelected(EXT, CMD, 'images');

    expect(a).toHaveBeenCalledWith('images');
    expect(b).toHaveBeenCalledWith('images');
  });

  it('subscribers for non-matching command do not fire', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await searchBarAccessoryService.declare({
      extensionId: EXT,
      commandId: CMD,
      options: [{ value: 'a', title: 'A' }],
    });

    const handler = vi.fn();
    searchBarAccessoryService.subscribe('other-ext', 'other-cmd', handler);
    expect(handler).not.toHaveBeenCalled();
  });
});
