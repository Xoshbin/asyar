import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchRemoteIcon, warn } = vi.hoisted(() => ({
  fetchRemoteIcon: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../lib/ipc/commands', () => ({ fetchRemoteIcon }));
vi.mock('../log/logService', () => ({ logService: { warn } }));

import { resetRemoteIconCache, resolveRemoteIcon } from './remoteIconService';

describe('remoteIconService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRemoteIconCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves an icon once and reuses the local URL', async () => {
    fetchRemoteIcon.mockResolvedValue('asyar-icon://localhost/remote-a.png');

    await expect(resolveRemoteIcon('org.x', 'https://example.com/x.png')).resolves.toBe(
      'asyar-icon://localhost/remote-a.png',
    );
    await expect(resolveRemoteIcon('org.x', 'https://example.com/x.png')).resolves.toBe(
      'asyar-icon://localhost/remote-a.png',
    );

    expect(fetchRemoteIcon).toHaveBeenCalledTimes(1);
    expect(fetchRemoteIcon).toHaveBeenCalledWith({
      extensionId: 'org.x',
      url: 'https://example.com/x.png',
    });
  });

  it('dedupes concurrent requests for the same icon', async () => {
    let release!: (value: string) => void;
    fetchRemoteIcon.mockImplementation(() => new Promise<string>((resolve) => (release = resolve)));

    const first = resolveRemoteIcon('org.x', 'https://example.com/x.png');
    const second = resolveRemoteIcon('org.x', 'https://example.com/x.png');
    release('asyar-icon://localhost/remote-a.png');

    await expect(first).resolves.toBe('asyar-icon://localhost/remote-a.png');
    await expect(second).resolves.toBe('asyar-icon://localhost/remote-a.png');
    expect(fetchRemoteIcon).toHaveBeenCalledTimes(1);
  });

  it('keys the cache by owner so extensions cannot share an icon', async () => {
    fetchRemoteIcon
      .mockResolvedValueOnce('asyar-icon://localhost/remote-a.png')
      .mockResolvedValueOnce('asyar-icon://localhost/remote-b.png');

    await resolveRemoteIcon('org.x', 'https://example.com/x.png');
    await resolveRemoteIcon('org.y', 'https://example.com/x.png');

    expect(fetchRemoteIcon).toHaveBeenCalledTimes(2);
  });

  it('returns null and remembers the failure for the TTL', async () => {
    fetchRemoteIcon.mockRejectedValue(new Error('network permission missing'));

    await expect(resolveRemoteIcon('org.x', 'https://example.com/x.png')).resolves.toBeNull();
    await expect(resolveRemoteIcon('org.x', 'https://example.com/x.png')).resolves.toBeNull();

    expect(fetchRemoteIcon).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retries a failed icon after the failure TTL', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    fetchRemoteIcon.mockRejectedValueOnce(new Error('offline'));
    await expect(resolveRemoteIcon('org.x', 'https://example.com/x.png')).resolves.toBeNull();

    vi.mocked(Date.now).mockReturnValue(1_000 + 60_001);
    fetchRemoteIcon.mockResolvedValueOnce('asyar-icon://localhost/remote-a.png');
    await expect(resolveRemoteIcon('org.x', 'https://example.com/x.png')).resolves.toBe(
      'asyar-icon://localhost/remote-a.png',
    );

    expect(fetchRemoteIcon).toHaveBeenCalledTimes(2);
  });

  it('refuses a remote icon without an owning extension', async () => {
    await expect(resolveRemoteIcon(undefined, 'https://example.com/x.png')).resolves.toBeNull();
    await expect(resolveRemoteIcon(null, 'https://example.com/x.png')).resolves.toBeNull();

    expect(fetchRemoteIcon).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
