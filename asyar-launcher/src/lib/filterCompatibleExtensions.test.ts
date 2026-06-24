import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { filterCompatibleExtensions } from './filterCompatibleExtensions';
import { invoke } from '@tauri-apps/api/core';

interface Item {
  id: number;
  manifest?: { platforms?: string[] };
}

const items: Item[] = [
  { id: 1, manifest: { platforms: ['macos'] } },
  { id: 2 },
  { id: 3, manifest: { platforms: ['windows'] } },
];

describe('filterCompatibleExtensions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends id/platforms payload to the filter_compatible_extensions command', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['1', '2']);
    await filterCompatibleExtensions(items, {
      id: (i) => String(i.id),
      platforms: (i) => i.manifest?.platforms,
    });
    expect(invoke).toHaveBeenCalledWith('filter_compatible_extensions', {
      items: [
        { id: '1', platforms: ['macos'] },
        { id: '2', platforms: null },
        { id: '3', platforms: ['windows'] },
      ],
    });
  });

  it('keeps only the items whose ids Rust returns, preserving Rust order', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['3', '1']);
    const result = await filterCompatibleExtensions(items, {
      id: (i) => String(i.id),
      platforms: (i) => i.manifest?.platforms,
    });
    expect(result.map((i) => i.id)).toEqual([3, 1]);
  });

  it('returns an empty list without a round-trip for an empty input', async () => {
    const result = await filterCompatibleExtensions([], {
      id: (i: Item) => String(i.id),
      platforms: (i: Item) => i.manifest?.platforms,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
