/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/envService', () => ({
  envService: { isTauri: false }
}));

vi.mock('../../lib/ipc/commands', () => ({
  snippetUpsert: vi.fn(),
  snippetGetAll: vi.fn(async () => []),
  snippetRemove: vi.fn(),
  snippetTogglePin: vi.fn(),
  snippetClearAll: vi.fn(),
}));

import { snippetStore } from './snippetStore.svelte';
import { envService } from '../../services/envService';
import { snippetGetAll } from '../../lib/ipc/commands';

describe('snippetStore', () => {
  beforeEach(() => {
    snippetStore.snippets = [];
  });

  it('clearAll() removes all snippets', () => {
    snippetStore.snippets = [
      { id: '1', name: 'A', keyword: ';a', expansion: 'alpha', createdAt: 0 },
      { id: '2', name: 'B', keyword: ';b', expansion: 'beta', createdAt: 0 },
    ] as any;
    snippetStore.clearAll();
    expect(snippetStore.snippets).toHaveLength(0);
  });

  it('add() inserts a snippet', () => {
    snippetStore.add({ id: '1', name: 'A', keyword: ';a', expansion: 'alpha', createdAt: 0 });
    expect(snippetStore.snippets).toHaveLength(1);
    expect(snippetStore.snippets[0].name).toBe('A');
  });

  it('add() replaces snippet with same id', () => {
    snippetStore.add({ id: '1', name: 'A', keyword: ';a', expansion: 'alpha', createdAt: 0 });
    snippetStore.add({ id: '1', name: 'A updated', keyword: ';a', expansion: 'alpha2', createdAt: 1 });
    expect(snippetStore.snippets).toHaveLength(1);
    expect(snippetStore.snippets[0].expansion).toBe('alpha2');
  });

  it('remove() deletes a snippet', () => {
    snippetStore.add({ id: '1', name: 'A', keyword: ';a', expansion: 'alpha', createdAt: 0 });
    snippetStore.add({ id: '2', name: 'B', keyword: ';b', expansion: 'beta', createdAt: 0 });
    snippetStore.remove('1');
    expect(snippetStore.snippets).toHaveLength(1);
    expect(snippetStore.snippets[0].id).toBe('2');
  });

  it('togglePin() flips pinned state', () => {
    snippetStore.add({ id: '1', name: 'A', keyword: ';a', expansion: 'alpha', createdAt: 0 });
    expect(snippetStore.snippets[0].pinned).toBeFalsy();
    snippetStore.togglePin('1');
    expect(snippetStore.snippets[0].pinned).toBe(true);
    snippetStore.togglePin('1');
    expect(snippetStore.snippets[0].pinned).toBe(false);
  });

  it('update() merges changes', () => {
    snippetStore.add({ id: '1', name: 'A', keyword: ';a', expansion: 'alpha', createdAt: 0 });
    snippetStore.update('1', { expansion: 'updated' });
    expect(snippetStore.snippets[0].expansion).toBe('updated');
    expect(snippetStore.snippets[0].keyword).toBe(';a'); // unchanged
  });

  it('getAll() returns all snippets', () => {
    snippetStore.add({ id: '1', name: 'A', keyword: ';a', expansion: 'alpha', createdAt: 0 });
    snippetStore.add({ id: '2', name: 'B', keyword: ';b', expansion: 'beta', createdAt: 1 });
    expect(snippetStore.getAll()).toHaveLength(2);
  });

  describe('reload()', () => {
    beforeEach(() => {
      (envService as any).isTauri = true;
    });

    afterEach(() => {
      (envService as any).isTauri = false;
    });

    it('re-fetches from DB and replaces stale in-memory state', async () => {
      snippetStore.snippets = [
        { id: 'stale', name: 'Stale', keyword: ';s', expansion: 'old', createdAt: 0 },
      ] as any;
      vi.mocked(snippetGetAll).mockResolvedValueOnce([
        { id: 'fresh', name: 'Fresh', keyword: ';f', expansion: 'new', createdAt: 1 },
      ] as any);

      await snippetStore.reload();

      expect(snippetGetAll).toHaveBeenCalled();
      expect(snippetStore.snippets).toHaveLength(1);
      expect(snippetStore.snippets[0].id).toBe('fresh');
    });

    it('allows init() to run again after the store was already initialized', async () => {
      vi.mocked(snippetGetAll).mockResolvedValue([]);
      await snippetStore.init(); // marks initialized

      const callsBefore = vi.mocked(snippetGetAll).mock.calls.length;
      await snippetStore.reload();
      expect(vi.mocked(snippetGetAll).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
