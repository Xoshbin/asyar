import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { rankItems } from './rankItems';
import { invoke } from '@tauri-apps/api/core';

interface Item {
  id: string;
  name: string;
  desc?: string;
  tags?: string[];
}

const items: Item[] = [
  { id: '1', name: 'Safari', desc: 'web browser', tags: ['apple'] },
  { id: '2', name: 'Notes', desc: 'jot things' },
];

describe('rankItems', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns items unchanged for an empty query without calling Rust', async () => {
    const result = await rankItems('  ', items, {
      id: (i) => i.id,
      title: (i) => i.name,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual(items);
  });

  it('sends RankInput payload to the rank_items command', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['1']);
    await rankItems('saf', items, {
      id: (i) => i.id,
      title: (i) => i.name,
      subtitle: (i) => i.desc,
      keywords: (i) => i.tags ?? [],
    });
    expect(invoke).toHaveBeenCalledWith('rank_items', {
      query: 'saf',
      items: [
        { id: '1', title: 'Safari', subtitle: 'web browser', keywords: ['apple'] },
        { id: '2', title: 'Notes', subtitle: 'jot things', keywords: [] },
      ],
    });
  });

  it('reorders items to match the ids Rust returns and drops the rest', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['2', '1']);
    const result = await rankItems('x', items, {
      id: (i) => i.id,
      title: (i) => i.name,
    });
    expect(result.map((i) => i.id)).toEqual(['2', '1']);
  });

  it('omits ids Rust did not return (non-matches)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(['1']);
    const result = await rankItems('saf', items, {
      id: (i) => i.id,
      title: (i) => i.name,
    });
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('trims the query before sending', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await rankItems('  saf  ', items, { id: (i) => i.id, title: (i) => i.name });
    expect(invoke).toHaveBeenCalledWith('rank_items', expect.objectContaining({ query: 'saf' }));
  });
});
