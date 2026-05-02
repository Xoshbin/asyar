import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  clipboardPrivacyClassify: vi.fn(),
  clipboardPrivacyGetSessionStats: vi.fn(),
  clipboardPrivacySetUserDenylist: vi.fn(),
  clipboardPrivacyGetUserDenylist: vi.fn(),
  clipboardPrivacyGetDefaultDenylist: vi.fn(),
}));

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockStore = {
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
};

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(() => Promise.resolve(mockStore)),
}));

import {
  clipboardPrivacyClassify,
  clipboardPrivacyGetSessionStats,
  clipboardPrivacySetUserDenylist,
  clipboardPrivacyGetUserDenylist,
  clipboardPrivacyGetDefaultDenylist,
} from '../../lib/ipc/commands';
import { clipboardPrivacyService } from './clipboardPrivacyService.svelte';

describe('clipboardPrivacyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.get.mockResolvedValue(undefined);
    mockStore.set.mockResolvedValue(undefined);
    mockStore.save.mockResolvedValue(undefined);
    clipboardPrivacyService.reset();
  });

  it('init loads denylist + defaults + stats', async () => {
    vi.mocked(clipboardPrivacyGetDefaultDenylist).mockResolvedValueOnce(['com.bitwarden.desktop']);
    vi.mocked(clipboardPrivacyGetUserDenylist).mockResolvedValueOnce(['com.example.MyVault']);
    vi.mocked(clipboardPrivacyGetSessionStats).mockResolvedValueOnce({ transient: 2 });

    await clipboardPrivacyService.init();

    expect(clipboardPrivacyService.defaultDenylist).toEqual(['com.bitwarden.desktop']);
    expect(clipboardPrivacyService.userDenylist).toEqual(['com.example.MyVault']);
    expect(clipboardPrivacyService.sessionStats.transient).toBe(2);
  });

  it('init tolerates host failures gracefully (returns null per invokeSafe)', async () => {
    vi.mocked(clipboardPrivacyGetDefaultDenylist).mockResolvedValueOnce(null);
    vi.mocked(clipboardPrivacyGetUserDenylist).mockResolvedValueOnce(null);
    vi.mocked(clipboardPrivacyGetSessionStats).mockResolvedValueOnce(null);

    await expect(clipboardPrivacyService.init()).resolves.toBeUndefined();

    expect(clipboardPrivacyService.defaultDenylist).toEqual([]);
    expect(clipboardPrivacyService.userDenylist).toEqual([]);
    expect(clipboardPrivacyService.sessionStats).toEqual({});
  });

  it('classify returns the host result and refreshes stats on skip', async () => {
    vi.mocked(clipboardPrivacyClassify).mockResolvedValueOnce({
      skip: true,
      reason: { kind: 'transient' },
    });
    vi.mocked(clipboardPrivacyGetSessionStats).mockResolvedValueOnce({ transient: 1 });

    const r = await clipboardPrivacyService.classify('com.apple.TextEdit');

    expect(r?.skip).toBe(true);
    expect(clipboardPrivacyService.sessionStats.transient).toBe(1);
  });

  it('classify does not refresh stats when skip is false', async () => {
    vi.mocked(clipboardPrivacyClassify).mockResolvedValueOnce({
      skip: false,
      reason: { kind: 'none' },
    });

    const r = await clipboardPrivacyService.classify('com.apple.TextEdit');

    expect(r?.skip).toBe(false);
    expect(clipboardPrivacyGetSessionStats).not.toHaveBeenCalled();
  });

  it('classify returns null on host error', async () => {
    vi.mocked(clipboardPrivacyClassify).mockResolvedValueOnce(null);

    const r = await clipboardPrivacyService.classify('com.apple.TextEdit');

    expect(r).toBeNull();
  });

  it('addToDenylist appends + persists', async () => {
    clipboardPrivacyService.userDenylist = ['com.example.A'];
    vi.mocked(clipboardPrivacySetUserDenylist).mockResolvedValueOnce(undefined);

    await clipboardPrivacyService.addToDenylist('com.example.B');

    expect(clipboardPrivacyService.userDenylist).toEqual(['com.example.A', 'com.example.B']);
    expect(clipboardPrivacySetUserDenylist).toHaveBeenCalledWith([
      'com.example.A',
      'com.example.B',
    ]);
  });

  it('addToDenylist no-ops on duplicate (case-insensitive)', async () => {
    clipboardPrivacyService.userDenylist = ['com.Example.A'];

    await clipboardPrivacyService.addToDenylist('COM.EXAMPLE.A');

    expect(clipboardPrivacyService.userDenylist).toEqual(['com.Example.A']);
    expect(clipboardPrivacySetUserDenylist).not.toHaveBeenCalled();
  });

  it('addToDenylist no-ops on empty / whitespace-only input', async () => {
    clipboardPrivacyService.userDenylist = ['com.example.A'];

    await clipboardPrivacyService.addToDenylist('   ');

    expect(clipboardPrivacyService.userDenylist).toEqual(['com.example.A']);
    expect(clipboardPrivacySetUserDenylist).not.toHaveBeenCalled();
  });

  it('removeFromDenylist filters + persists', async () => {
    clipboardPrivacyService.userDenylist = ['com.example.A', 'com.example.B'];
    vi.mocked(clipboardPrivacySetUserDenylist).mockResolvedValueOnce(undefined);

    await clipboardPrivacyService.removeFromDenylist('com.example.A');

    expect(clipboardPrivacyService.userDenylist).toEqual(['com.example.B']);
    expect(clipboardPrivacySetUserDenylist).toHaveBeenCalledWith(['com.example.B']);
  });

  it('removeFromDenylist no-ops when entry is not present', async () => {
    clipboardPrivacyService.userDenylist = ['com.example.A'];

    await clipboardPrivacyService.removeFromDenylist('com.example.MISSING');

    expect(clipboardPrivacyService.userDenylist).toEqual(['com.example.A']);
    expect(clipboardPrivacySetUserDenylist).not.toHaveBeenCalled();
  });

  it('refreshStats overwrites session stats from host', async () => {
    clipboardPrivacyService.sessionStats = { transient: 1 };
    vi.mocked(clipboardPrivacyGetSessionStats).mockResolvedValueOnce({
      transient: 5,
      concealed: 2,
    });

    await clipboardPrivacyService.refreshStats();

    expect(clipboardPrivacyService.sessionStats).toEqual({ transient: 5, concealed: 2 });
  });

  it('init seeds Rust denylist from persisted store', async () => {
    mockStore.get.mockResolvedValueOnce(['com.example.Persisted']);
    vi.mocked(clipboardPrivacyGetDefaultDenylist).mockResolvedValueOnce([]);
    vi.mocked(clipboardPrivacyGetUserDenylist).mockResolvedValueOnce(['com.example.Persisted']);
    vi.mocked(clipboardPrivacyGetSessionStats).mockResolvedValueOnce({});

    await clipboardPrivacyService.init();

    expect(clipboardPrivacySetUserDenylist).toHaveBeenCalledWith(['com.example.Persisted']);
    expect(clipboardPrivacyService.userDenylist).toEqual(['com.example.Persisted']);
  });

  it('init skips seeding when persisted denylist is empty', async () => {
    mockStore.get.mockResolvedValueOnce([]);
    vi.mocked(clipboardPrivacyGetDefaultDenylist).mockResolvedValueOnce([]);
    vi.mocked(clipboardPrivacyGetUserDenylist).mockResolvedValueOnce([]);
    vi.mocked(clipboardPrivacyGetSessionStats).mockResolvedValueOnce({});

    await clipboardPrivacyService.init();

    expect(clipboardPrivacySetUserDenylist).not.toHaveBeenCalled();
  });

  it('addToDenylist persists to store', async () => {
    clipboardPrivacyService.userDenylist = [];
    vi.mocked(clipboardPrivacySetUserDenylist).mockResolvedValueOnce(undefined);

    await clipboardPrivacyService.addToDenylist('com.example.New');

    expect(mockStore.set).toHaveBeenCalledWith('userDenylist', ['com.example.New']);
    expect(mockStore.save).toHaveBeenCalled();
  });

  it('removeFromDenylist persists to store', async () => {
    clipboardPrivacyService.userDenylist = ['com.example.A', 'com.example.B'];
    vi.mocked(clipboardPrivacySetUserDenylist).mockResolvedValueOnce(undefined);

    await clipboardPrivacyService.removeFromDenylist('com.example.A');

    expect(mockStore.set).toHaveBeenCalledWith('userDenylist', ['com.example.B']);
    expect(mockStore.save).toHaveBeenCalled();
  });
});
