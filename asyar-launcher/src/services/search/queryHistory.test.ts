import { describe, expect, it, vi } from 'vitest';
import { QueryHistory } from './queryHistory.svelte';

describe('query recall', () => {
  it('starts recall only above the first startup row', async () => {
    const history = new QueryHistory({
      list: async () => ['22+5'],
      record: async () => true,
      delete: async () => true,
    });
    const apply = vi.fn();
    expect(history.navigate(-1, '', 2, apply)).toBe(false);
    expect(history.navigate(-1, 'draft', 0, apply)).toBe(false);
    expect(history.navigate(1, '', 0, apply)).toBe(false);
    expect(history.navigate(-1, '', 0, apply)).toBe(true);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith('22+5'));
  });

  it('waits for Escape persistence before loading history', async () => {
    let finish!: () => void;
    const list = vi.fn(async () => ['22+5']);
    const history = new QueryHistory({
      list,
      record: () =>
        new Promise<boolean>((resolve) => {
          finish = () => resolve(true);
        }),
      delete: async () => true,
    });
    void history.record('22+5');
    const recalled = history.move(-1, '');
    await Promise.resolve();
    expect(list).not.toHaveBeenCalled();
    finish();
    expect(await recalled).toBe('22+5');
  });

  it('recalls newest first, stops at oldest, and returns to the empty query', async () => {
    const history = new QueryHistory({
      list: async () => ['22+5', 'older'],
      record: async () => true,
      delete: async () => true,
    });
    expect(await history.move(-1, '')).toBe('22+5');
    expect(await history.move(-1, '22+5')).toBe('older');
    expect(await history.move(-1, 'older')).toBe('older');
    expect(await history.move(1, 'older')).toBe('22+5');
    expect(await history.move(1, '22+5')).toBe('');
    expect(history.current).toBeNull();
  });

  it('abandons recall when the user edits and never overwrites a pending edit', async () => {
    let resolve!: (value: string[]) => void;
    const history = new QueryHistory({
      list: () =>
        new Promise((r) => {
          resolve = r;
        }),
      record: async () => true,
      delete: async () => true,
    });
    const pending = history.move(-1, '');
    await Promise.resolve();
    history.reset();
    resolve(['22+5']);
    expect(await pending).toBeNull();
    expect(history.current).toBeNull();
  });

  it('keeps a query available if deletion fails and removes it after success', async () => {
    const remove = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const history = new QueryHistory({
      list: async () => ['22+5'],
      record: async () => true,
      delete: remove,
    });
    await history.move(-1, '');
    expect(await history.deleteCurrent()).toBe(false);
    expect(history.current).toBe('22+5');
    expect(await history.deleteCurrent()).toBe(true);
    expect(history.current).toBeNull();
    expect(remove).toHaveBeenCalledWith('22+5');
  });
});
