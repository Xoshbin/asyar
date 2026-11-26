import { describe, it, expect, vi, beforeEach } from 'vitest';

const installExtension = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const listInstalledExtensions = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const fetchAllStoreItems = vi.hoisted(() => vi.fn());

vi.mock('../../../built-in-features/store/index.svelte', () => ({ default: { installExtension } }));
vi.mock('../../../lib/ipc/commands', () => ({ listInstalledExtensions }));
vi.mock('../../../built-in-features/store/storeFetch', () => ({ fetchAllStoreItems }));

import { installEmoji } from './emojiSetup';

describe('installEmoji', () => {
  beforeEach(() => vi.clearAllMocks());
  it('installs the emoji extension when missing', async () => {
    const listing = {
      id: 7,
      name: 'Emoji',
      slug: 'emoji',
      manifest: { permissions: ['accessibility:write'] },
    };
    fetchAllStoreItems.mockResolvedValueOnce([listing]);

    const did = await installEmoji();
    expect(installExtension).toHaveBeenCalledWith('emoji', 'org.asyar.emoji', 'Emoji', listing);
    expect(did).toBe(true);
  });
  it('skips install when already present', async () => {
    listInstalledExtensions.mockResolvedValueOnce(['org.asyar.emoji']);
    const did = await installEmoji();
    expect(installExtension).not.toHaveBeenCalled();
    expect(did).toBe(true);
  });
});
