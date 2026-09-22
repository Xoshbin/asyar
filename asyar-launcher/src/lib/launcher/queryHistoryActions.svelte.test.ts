/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { QueryHistory } from '../../services/search/queryHistory.svelte';
import { setupQueryHistoryActions } from './queryHistoryActions.svelte';
import type { LauncherState } from './launcherState.svelte';

const { actions, confirmAlert } = vi.hoisted(() => ({
  actions: new Map<
    string,
    { execute: () => Promise<void>; destructive?: boolean; shortcut?: string }
  >(),
  confirmAlert: vi.fn(async () => true),
}));
vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: (action: { id: string; execute: () => Promise<void> }) =>
      actions.set(action.id, action),
    unregisterAction: (id: string) => actions.delete(id),
  },
}));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { confirmAlert },
}));
vi.mock('../../services/search/stores/search.svelte', () => ({ searchStores: { query: '' } }));

let cleanup = () => {};
afterEach(() => {
  cleanup();
  actions.clear();
  vi.clearAllMocks();
});

describe('query history actions', () => {
  it('registers one destructive action without a text-editing shortcut and clears a deleted recall', async () => {
    const remove = vi.fn(async () => true);
    const queryHistory = new QueryHistory({
      list: async () => ['22+5'],
      record: async () => true,
      delete: remove,
    });
    await queryHistory.move(-1, '');
    const state = {
      queryHistory,
      localSearchValue: '22+5',
      activeViewVal: null,
      activeContext: null,
      getBottomBar: () => undefined,
    } as unknown as LauncherState;
    cleanup = $effect.root(() => setupQueryHistoryActions(state));
    flushSync();
    expect(actions.size).toBe(1);
    const action = actions.get('query-history:delete')!;
    expect(action.destructive).toBe(true);
    expect(action.shortcut).toBeUndefined();
    await action.execute();
    flushSync();
    expect(remove).toHaveBeenCalledWith('22+5');
    expect(state.localSearchValue).toBe('');
    expect(actions.size).toBe(0);
  });
});
