import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { classifyItems } from './classifyItems';
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

describe('classifyItems', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an empty map for an empty query without calling Rust', async () => {
    const result = await classifyItems('  ', items, {
      id: (i) => i.id,
      title: (i) => i.name,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('returns an empty map for an empty item list without calling Rust', async () => {
    const result = await classifyItems('saf', [], {
      id: (i: Item) => i.id,
      title: (i: Item) => i.name,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('sends RankInput payload to the classify_items command', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await classifyItems('saf', items, {
      id: (i) => i.id,
      title: (i) => i.name,
      subtitle: (i) => i.desc,
      keywords: (i) => i.tags ?? [],
    });
    expect(invoke).toHaveBeenCalledWith('classify_items', {
      query: 'saf',
      items: [
        { id: '1', title: 'Safari', subtitle: 'web browser', keywords: ['apple'] },
        { id: '2', title: 'Notes', subtitle: 'jot things', keywords: [] },
      ],
    });
  });

  it('builds a Map from id to tier using the command response, keeping every id', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { id: '1', tier: 1 },
      { id: '2', tier: 5 },
    ]);
    const result = await classifyItems('x', items, {
      id: (i) => i.id,
      title: (i) => i.name,
    });
    expect(result.get('1')).toBe(1);
    expect(result.get('2')).toBe(5);
  });

  it('trims the query before sending', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await classifyItems('  saf  ', items, { id: (i) => i.id, title: (i) => i.name });
    expect(invoke).toHaveBeenCalledWith('classify_items', expect.objectContaining({ query: 'saf' }));
  });
});
