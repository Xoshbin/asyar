import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  setAlias: vi.fn(),
  unsetAlias: vi.fn(),
  listAliases: vi.fn(),
  findAliasConflict: vi.fn(),
}));

import * as commands from '../../lib/ipc/commands';
import { aliasService } from './aliasService';

const mocked = vi.mocked(commands);

describe('aliasService', () => {
  beforeEach(() => {
    mocked.setAlias.mockReset();
    mocked.unsetAlias.mockReset();
    mocked.listAliases.mockReset();
    mocked.findAliasConflict.mockReset();
  });

  it('register calls setAlias', async () => {
    mocked.setAlias.mockResolvedValueOnce({
      objectId: 'app_x',
      alias: 'x',
      itemName: 'X',
      itemType: 'application',
      createdAt: 1,
    });
    const result = await aliasService.register('app_x', 'x', 'X', 'application');
    expect(mocked.setAlias).toHaveBeenCalledWith('app_x', 'x', 'X', 'application');
    expect(result.alias).toBe('x');
  });

  it('unregister calls unsetAlias', async () => {
    mocked.unsetAlias.mockResolvedValueOnce(undefined);
    await aliasService.unregister('x');
    expect(mocked.unsetAlias).toHaveBeenCalledWith('x');
  });

  it('list returns the array from listAliases', async () => {
    mocked.listAliases.mockResolvedValueOnce([
      { objectId: 'a', alias: 'a', itemName: 'A', itemType: 'application', createdAt: 1 },
    ]);
    const list = await aliasService.list();
    expect(list).toHaveLength(1);
    expect(list[0].alias).toBe('a');
  });

  it('findConflict returns null when no conflict', async () => {
    mocked.findAliasConflict.mockResolvedValueOnce(null);
    const c = await aliasService.findConflict('x');
    expect(c).toBeNull();
  });

  it('findConflict forwards excludingObjectId', async () => {
    mocked.findAliasConflict.mockResolvedValueOnce(null);
    await aliasService.findConflict('x', 'cmd_self');
    expect(mocked.findAliasConflict).toHaveBeenCalledWith('x', 'cmd_self');
  });
});
