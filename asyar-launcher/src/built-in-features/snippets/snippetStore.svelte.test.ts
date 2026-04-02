/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock persistence before importing store
vi.mock('../../lib/persistence/extensionStore', () => ({
  createPersistence: () => ({
    loadSync: () => [],
    load: async () => [],
    save: vi.fn(),
  }),
}));

import { snippetStore } from './snippetStore.svelte';

describe('snippetStore.clearAll()', () => {
  it('removes all snippets', () => {
    snippetStore.snippets = [
      { id: '1', name: 'A', keyword: ';a', expansion: 'alpha', createdAt: 0 },
      { id: '2', name: 'B', keyword: ';b', expansion: 'beta', createdAt: 0 },
    ] as any;
    snippetStore.clearAll();
    expect(snippetStore.snippets).toHaveLength(0);
  });
});
