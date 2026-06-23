/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ranking is delegated to the Rust engine via rankItems; its fuzzy/tier
// behavior is covered by Rust tests. Here we verify delegation + that the view
// renders the order Rust returns.
vi.mock('../../lib/rankItems', () => ({ rankItems: vi.fn() }));

import { StoreViewStateClass, type ApiExtension } from './state.svelte';
import { rankItems } from '../../lib/rankItems';

function ext(id: number, name: string, description = '', author = 'Acme', category = 'utils'): ApiExtension {
  return {
    id,
    name,
    slug: `${name.toLowerCase()}-${id}`,
    description,
    category,
    status: 'AVAILABLE',
    repository_url: '',
    install_count: 0,
    icon_url: '',
    screenshot_urls: [],
    created_at: '',
    updated_at: '',
    last_polled_at: null,
    author: { id: 1, name: author },
  };
}

const items = [ext(1, 'Weather'), ext(2, 'Clock'), ext(3, 'Calculator')];

describe('StoreViewStateClass search', () => {
  let state: StoreViewStateClass;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rankItems).mockResolvedValue([]);
    state = new StoreViewStateClass();
    state.setItems([...items]);
  });

  it('returns all items unchanged when the query is empty (no Rust round-trip)', () => {
    expect(state.filteredItems).toHaveLength(3);
    expect(rankItems).not.toHaveBeenCalled();
  });

  it('renders the order Rust ranks and drops non-matches', async () => {
    vi.mocked(rankItems).mockResolvedValueOnce([items[2], items[0]]);
    await state.setSearch('c');
    expect(state.filteredItems.map((i) => i.id)).toEqual([3, 1]);
  });

  it('passes name/description/author/category accessors to rankItems', async () => {
    vi.mocked(rankItems).mockResolvedValueOnce([]);
    await state.setSearch('weather');
    const [query, passed, fields] = vi.mocked(rankItems).mock.calls[0];
    expect(query).toBe('weather');
    expect(passed).toHaveLength(3);
    const w = items[0];
    expect(fields.id(w)).toBe('1');
    expect(fields.title(w)).toBe('Weather');
    expect(fields.subtitle?.(w)).toBe('');
    expect(fields.keywords?.(w)).toEqual(['Acme', 'utils']);
  });

  it('clears the active search for an empty query without calling Rust again', async () => {
    vi.mocked(rankItems).mockResolvedValueOnce([items[0]]);
    await state.setSearch('w');
    await state.setSearch('');
    expect(state.filteredItems).toHaveLength(3);
    expect(rankItems).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale result superseded by a newer query', async () => {
    let resolveFirst: (v: any) => void = () => {};
    vi.mocked(rankItems)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce([items[1]]);

    const first = state.setSearch('clo');
    const second = state.setSearch('cal');
    await second;
    resolveFirst([items[0]]); // late result for abandoned query
    await first;

    expect(state.filteredItems.map((i) => i.id)).toEqual([2]);
  });
});
