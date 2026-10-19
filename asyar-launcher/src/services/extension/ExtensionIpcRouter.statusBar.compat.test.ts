import { expect, it, vi } from 'vitest';

vi.mock('../log/logService', () => ({ logService: { debug: vi.fn(), warn: vi.fn() } }));
vi.mock('../../lib/ipc/commands', () => ({}));
vi.mock('../../lib/ipc/shortcodeCommands', () => ({}));
vi.mock('./workerHost.svelte', () => ({ workerHost: {} }));
vi.mock('./ipc/pipeline', () => ({ runIpcPipeline: vi.fn() }));
vi.mock('asyar-sdk/contracts', () => ({ messageBroker: {} }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../feedback/feedbackService.svelte', () => ({ feedbackService: {} }));

import { invoke } from '@tauri-apps/api/core';
import { ExtensionIpcRouter } from './ExtensionIpcRouter';
import { statusBarService } from '../statusBar/statusBarService.svelte';

it('old_sdk_statusbar_wire_payloads_still_work', async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  const router = new ExtensionIpcRouter({ statusBar: statusBarService }, vi.fn(), vi.fn(), vi.fn());
  const dispatch = (method: string, payload: unknown) =>
    (router as any).dispatchApiCall(`asyar:api:statusBar:${method}`, payload, 'trusted', false);
  // Exact pre-4626ae105 proxy payloads: register has identity inside item;
  // update has both identities and a full item, unregister has outer identity.
  for (const extensionId of ['trusted', 'forged-victim']) {
    const item = { id: 'timer', text: 'Focus', icon: '🍅', extensionId };
    await dispatch('registerItem', { item });
    expect(invoke).toHaveBeenLastCalledWith('tray_register_item', {
      item: { ...item, extensionId: 'trusted' },
    });
    const updated = { ...item, text: 'Break' };
    await dispatch('updateItem', { extensionId, id: 'timer', item: updated });
    expect(invoke).toHaveBeenLastCalledWith('tray_update_item', {
      item: { ...updated, extensionId: 'trusted' },
    });
    await dispatch('unregisterItem', { extensionId, id: 'timer' });
    expect(invoke).toHaveBeenLastCalledWith('tray_unregister_item', {
      extensionId: 'trusted',
      id: 'timer',
    });
    // Host cleanup route existed too (not exposed by the old SDK proxy).
    await dispatch('clearItemsForExtension', { extensionId });
    expect(invoke).toHaveBeenLastCalledWith('tray_remove_all_for_extension', {
      extensionId: 'trusted',
    });
  }
});
