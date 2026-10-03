import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  registerBuiltinSearchProvider,
  searchBuiltinProviders,
  executeBuiltinSearchResult,
  resetBuiltinSearchProviders,
  type BuiltinSearchProvider,
} from './builtinSearchProviders';

function provider(
  extensionId: string,
  rows: Awaited<ReturnType<BuiltinSearchProvider['search']>>,
  execute: BuiltinSearchProvider['execute'] = vi.fn(),
): BuiltinSearchProvider {
  return { extensionId, search: vi.fn().mockResolvedValue(rows), execute };
}

describe('builtinSearchProviders', () => {
  beforeEach(() => {
    resetBuiltinSearchProviders();
    vi.clearAllMocks();
  });

  it('returns plain serialisable rows tagged with the owning built-in id', async () => {
    registerBuiltinSearchProvider(
      provider('calculator', [{ id: 'calc:0', title: '42', score: 1, priority: 'top' }]),
    );

    const hits = await searchBuiltinProviders('6*7', () => true);

    expect(hits).toEqual([
      { id: 'calc:0', title: '42', score: 1, priority: 'top', extensionId: 'calculator' },
    ]);
    expect(() => structuredClone(hits)).not.toThrow();
  });

  it('gates presentation of a disabled built-in without unregistering its provider', async () => {
    const calc = provider('calculator', [{ id: 'calc:0', title: '42' }]);
    registerBuiltinSearchProvider(calc);

    expect(await searchBuiltinProviders('x', (id) => id !== 'calculator')).toEqual([]);
    expect(calc.search).not.toHaveBeenCalled();

    expect(await searchBuiltinProviders('x', () => true)).toHaveLength(1);
  });

  it('isolates a throwing provider and keeps the others', async () => {
    registerBuiltinSearchProvider({
      extensionId: 'walkthrough',
      search: vi.fn().mockRejectedValue(new Error('boom')),
      execute: vi.fn(),
    });
    registerBuiltinSearchProvider(provider('calculator', [{ id: 'calc:0', title: '42' }]));

    const hits = await searchBuiltinProviders('x', () => true);

    expect(hits.map((h) => h.extensionId)).toEqual(['calculator']);
  });

  it('drops a provider that misses its time budget instead of blocking the query', async () => {
    registerBuiltinSearchProvider({
      extensionId: 'walkthrough',
      search: () => new Promise(() => {}),
      execute: vi.fn(),
    });
    registerBuiltinSearchProvider(provider('calculator', [{ id: 'calc:0', title: '42' }]));

    const hits = await searchBuiltinProviders('x', () => true, 20);

    expect(hits.map((h) => h.extensionId)).toEqual(['calculator']);
  });

  it('executes through the owning provider with typed row id and payload — no closure needed', async () => {
    const execute = vi.fn();
    registerBuiltinSearchProvider(provider('calculator', [], execute));

    const ran = await executeBuiltinSearchResult('calculator', 'calc:0', { copyValue: '42' });

    expect(ran).toBe(true);
    expect(execute).toHaveBeenCalledWith('calc:0', { copyValue: '42' });
  });

  it('reports false for an unknown provider so callers fall through', async () => {
    expect(await executeBuiltinSearchResult('nobody', 'x')).toBe(false);
  });

  it('keeps one provider per built-in; re-registering replaces and the disposer is identity-safe', async () => {
    const first = provider('calculator', [{ id: 'a', title: 'first' }]);
    const second = provider('calculator', [{ id: 'b', title: 'second' }]);
    const disposeFirst = registerBuiltinSearchProvider(first);
    registerBuiltinSearchProvider(second);

    disposeFirst();

    const hits = await searchBuiltinProviders('x', () => true);
    expect(hits.map((h) => h.title)).toEqual(['second']);
  });

  it('keeps provider order stable by registration', async () => {
    registerBuiltinSearchProvider(provider('walkthrough', [{ id: 'w', title: 'W' }]));
    registerBuiltinSearchProvider(provider('calculator', [{ id: 'c', title: 'C' }]));

    const hits = await searchBuiltinProviders('x', () => true);
    expect(hits.map((h) => h.title)).toEqual(['W', 'C']);
  });
});
