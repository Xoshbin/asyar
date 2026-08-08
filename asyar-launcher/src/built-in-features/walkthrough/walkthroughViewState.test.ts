import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WalkthroughTaskView } from '../../lib/ipc/walkthroughCommands';

const tasks: WalkthroughTaskView[] = [];

vi.mock('../../services/walkthrough/walkthroughService.svelte', () => ({
  walkthroughService: {
    get tasks() {
      return tasks;
    },
  },
}));

vi.mock('../../lib/rankItems', () => ({
  rankItems: vi.fn(),
}));

import { walkthroughViewState } from './walkthroughViewState.svelte';
import { rankItems } from '../../lib/rankItems';

function task(id: string, partial: Partial<WalkthroughTaskView> = {}): WalkthroughTaskView {
  return {
    id,
    extensionId: 'org.asyar.test',
    title: id,
    summary: '',
    body: '',
    icon: null,
    image: null,
    order: 0,
    completion: { type: 'manual' },
    completed: false,
    completedAt: null,
    source: null,
    progress: null,
    ...partial,
  };
}

function setTasks(next: WalkthroughTaskView[]) {
  tasks.length = 0;
  tasks.push(...next);
}

describe('walkthroughViewState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTasks([task('wt_a'), task('wt_b'), task('wt_c')]);
    walkthroughViewState.reset();
  });

  it('starts on the list with the first row selected', () => {
    expect(walkthroughViewState.mode).toBe('list');
    expect(walkthroughViewState.selected?.id).toBe('wt_a');
  });

  it('puts unfinished tasks before completed ones', () => {
    setTasks([task('wt_done', { completed: true }), task('wt_todo')]);
    expect(walkthroughViewState.visible.map((t) => t.id)).toEqual(['wt_todo', 'wt_done']);
  });

  it('wraps selection at both ends', () => {
    walkthroughViewState.move(-1);
    expect(walkthroughViewState.selected?.id).toBe('wt_c');
    walkthroughViewState.move(1);
    expect(walkthroughViewState.selected?.id).toBe('wt_a');
  });

  it('ignores movement with an empty list', () => {
    setTasks([]);
    walkthroughViewState.move(1);
    expect(walkthroughViewState.selected).toBeNull();
  });

  it('opens the selected task into the detail page', () => {
    walkthroughViewState.move(1);
    walkthroughViewState.open();
    expect(walkthroughViewState.mode).toBe('detail');
    expect(walkthroughViewState.openTask?.id).toBe('wt_b');
  });

  it('opens an explicitly named task', () => {
    walkthroughViewState.open('wt_c');
    expect(walkthroughViewState.openTask?.id).toBe('wt_c');
  });

  it('does not open anything when the list is empty', () => {
    setTasks([]);
    walkthroughViewState.open();
    expect(walkthroughViewState.mode).toBe('list');
  });

  it('reports whether back consumed the key press', () => {
    expect(walkthroughViewState.back()).toBe(false);

    walkthroughViewState.open();
    expect(walkthroughViewState.back()).toBe(true);
    expect(walkthroughViewState.mode).toBe('list');
    expect(walkthroughViewState.openTask).toBeNull();
  });

  it('reflects live completion changes in the open task', () => {
    walkthroughViewState.open('wt_a');
    expect(walkthroughViewState.openTask?.completed).toBe(false);

    setTasks([task('wt_a', { completed: true }), task('wt_b'), task('wt_c')]);
    expect(walkthroughViewState.openTask?.completed).toBe(true);
  });

  it('filters through the Rust ranker and keeps its order', async () => {
    vi.mocked(rankItems).mockResolvedValueOnce([task('wt_c'), task('wt_a')]);

    await walkthroughViewState.setSearch('cal');

    expect(rankItems).toHaveBeenCalledWith('cal', tasks, expect.anything());
    expect(walkthroughViewState.visible.map((t) => t.id)).toEqual(['wt_c', 'wt_a']);
  });

  it('clears the filter on an empty query without a round trip', async () => {
    vi.mocked(rankItems).mockResolvedValueOnce([task('wt_c')]);
    await walkthroughViewState.setSearch('cal');

    await walkthroughViewState.setSearch('   ');

    expect(rankItems).toHaveBeenCalledTimes(1);
    expect(walkthroughViewState.visible).toHaveLength(3);
  });

  it('discards a ranking result superseded by a newer keystroke', async () => {
    let resolveStale: (v: WalkthroughTaskView[]) => void = () => {};
    vi.mocked(rankItems).mockReturnValueOnce(
      new Promise<WalkthroughTaskView[]>((r) => {
        resolveStale = r;
      }),
    );

    const stale = walkthroughViewState.setSearch('ca');
    await walkthroughViewState.setSearch('');
    resolveStale([task('wt_c')]);
    await stale;

    expect(walkthroughViewState.visible).toHaveLength(3);
  });

  it('drops ranked ids that no longer exist', async () => {
    vi.mocked(rankItems).mockResolvedValueOnce([task('wt_gone'), task('wt_a')]);
    await walkthroughViewState.setSearch('x');
    expect(walkthroughViewState.visible.map((t) => t.id)).toEqual(['wt_a']);
  });

  it('reset returns to a clean list view', async () => {
    vi.mocked(rankItems).mockResolvedValueOnce([task('wt_c')]);
    await walkthroughViewState.setSearch('c');
    walkthroughViewState.open('wt_c');

    walkthroughViewState.reset();

    expect(walkthroughViewState.mode).toBe('list');
    expect(walkthroughViewState.searchQuery).toBe('');
    expect(walkthroughViewState.openTaskId).toBeNull();
    expect(walkthroughViewState.visible).toHaveLength(3);
  });
});
