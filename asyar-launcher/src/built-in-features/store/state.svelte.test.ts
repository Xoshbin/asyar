/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ranking is delegated to the Rust engine via rankItems; its fuzzy/tier
// behavior is covered by Rust tests. Here we verify delegation + that the view
// renders the order Rust returns.
vi.mock('../../lib/rankItems', () => ({ rankItems: vi.fn() }));

import { StoreViewStateClass, getInstallCount, type ApiExtension } from './state.svelte';
import { buildStoreAccessoryOptions, getExtensionCapabilities } from './categories';
import { rankItems } from '../../lib/rankItems';

function ext(
  id: number,
  name: string,
  description = '',
  author = 'Acme',
  category = 'utils',
): ApiExtension {
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
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveFirst = r;
          }),
      )
      .mockResolvedValueOnce([items[1]]);

    const first = state.setSearch('clo');
    const second = state.setSearch('cal');
    await second;
    resolveFirst([items[0]]); // late result for abandoned query
    await first;

    expect(state.filteredItems.map((i) => i.id)).toEqual([2]);
  });
});

describe('getInstallCount', () => {
  it('returns installCount if present (camelCase from API)', () => {
    expect(getInstallCount({ installCount: 42 } as ApiExtension)).toBe(42);
  });

  it('falls back to install_count if installCount is undefined (snake_case)', () => {
    expect(getInstallCount({ install_count: 15 } as ApiExtension)).toBe(15);
  });

  it('returns 0 if neither is present or item is null', () => {
    expect(getInstallCount(null)).toBe(0);
    expect(getInstallCount({} as ApiExtension)).toBe(0);
  });
});

describe('StoreViewStateClass category & capability filtering', () => {
  const parallelExt: ApiExtension = {
    ...ext(10, 'Parallel Search', 'Web search provider', 'Parallel', 'ai'),
    status: 'INSTALLED',
    manifest: {
      type: 'extension',
      webSearchEngines: [{ id: 'parallel', name: 'Parallel' }],
    },
  };
  const catppuccinExt: ApiExtension = {
    ...ext(11, 'Catppuccin', 'Theme', 'Catppuccin', 'others'),
    status: 'AVAILABLE',
    manifest: { type: 'theme' },
  };
  const devExt: ApiExtension = {
    ...ext(12, 'Tauri Docs', 'Docs', 'Asyar', 'development'),
    status: 'UPDATE_AVAILABLE',
    manifest: { type: 'extension' },
  };

  let state: StoreViewStateClass;

  beforeEach(() => {
    vi.clearAllMocks();
    state = new StoreViewStateClass();
    state.setItems([parallelExt, catppuccinExt, devExt]);
  });

  it('filters by canonical category and normalizes legacy aliases / theme type', () => {
    state.setCategoryFilter('ai');
    expect(state.filteredItems.map((i) => i.id)).toEqual([10]);

    state.setCategoryFilter('theme');
    expect(state.filteredItems.map((i) => i.id)).toEqual([11]);

    state.setCategoryFilter('developer-tools');
    expect(state.filteredItems.map((i) => i.id)).toEqual([12]);
  });

  it('filters by capability and installed status', () => {
    state.setCategoryFilter('cap:web-search');
    expect(state.filteredItems.map((i) => i.id)).toEqual([10]);

    state.setCategoryFilter('installed');
    expect(state.filteredItems.map((i) => i.id)).toEqual([10, 12]);
  });

  it('combines search ranking with active category filter', async () => {
    vi.mocked(rankItems).mockResolvedValueOnce([parallelExt, devExt]);
    state.setCategoryFilter('ai');
    await state.setSearch('search');
    expect(state.filteredItems.map((i) => i.id)).toEqual([10]);
  });

  it('extracts capabilities and builds grouped accessory options with selection state', () => {
    expect(getExtensionCapabilities(parallelExt)).toEqual(['web-search']);
    const acc = buildStoreAccessoryOptions([parallelExt, catppuccinExt, devExt], 'ai', (k) => k);
    expect(acc.options.map((o) => o.value)).toEqual([
      'all',
      'installed',
      '__group_categories__',
      '__group_capabilities__',
    ]);
    expect(acc.buttonTitle).toBe('AI & Search');
    const catGroup = acc.options.find((o) => o.value === '__group_categories__');
    expect(catGroup?.selected).toBe(true);
    expect(catGroup?.children?.find((c) => c.value === 'ai')?.selected).toBe(true);
    expect(catGroup?.children?.find((c) => c.value === 'ai')?.subtitle).toBe('1');
  });
});
