import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./aliasService', () => ({
  aliasService: {
    list: vi.fn(),
  },
}));

import { aliasStore } from './aliasStore.svelte';
import { aliasService } from './aliasService';

const mocked = vi.mocked(aliasService);

describe('aliasStore', () => {
  beforeEach(() => {
    aliasStore.reset();
    mocked.list.mockReset();
  });

  it('refresh populates list and byObjectId', async () => {
    mocked.list.mockResolvedValueOnce([
      { objectId: 'a', alias: 'a', itemName: 'A', itemType: 'application', createdAt: 1 },
      { objectId: 'b', alias: 'bb', itemName: 'B', itemType: 'command', createdAt: 2 },
    ]);
    await aliasStore.refresh();
    expect(aliasStore.list).toHaveLength(2);
    expect(aliasStore.byObjectId.get('a')).toBe('a');
    expect(aliasStore.byObjectId.get('b')).toBe('bb');
  });

  it('addOptimistic immediately reflects in byObjectId', () => {
    aliasStore.addOptimistic({
      objectId: 'x',
      alias: 'xx',
      itemName: 'X',
      itemType: 'application',
      createdAt: 5,
    });
    expect(aliasStore.byObjectId.get('x')).toBe('xx');
  });

  it('addOptimistic replaces existing entry for same objectId', () => {
    aliasStore.addOptimistic({
      objectId: 'x',
      alias: 'xx',
      itemName: 'X',
      itemType: 'application',
      createdAt: 5,
    });
    aliasStore.addOptimistic({
      objectId: 'x',
      alias: 'xy',
      itemName: 'X',
      itemType: 'application',
      createdAt: 6,
    });
    expect(aliasStore.list).toHaveLength(1);
    expect(aliasStore.byObjectId.get('x')).toBe('xy');
  });

  it('removeOptimistic drops the entry from byObjectId', () => {
    aliasStore.addOptimistic({
      objectId: 'x',
      alias: 'xx',
      itemName: 'X',
      itemType: 'application',
      createdAt: 5,
    });
    aliasStore.removeOptimistic('xx');
    expect(aliasStore.byObjectId.get('x')).toBeUndefined();
    expect(aliasStore.list).toHaveLength(0);
  });
});
