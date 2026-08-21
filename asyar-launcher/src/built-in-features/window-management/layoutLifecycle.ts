import { windowManagementState, type CustomLayout } from './state.svelte';
import { windowManagementService } from '../../services/windowManagement/windowManagementService';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { searchService } from '../../services/search/SearchService';
import { commandService } from '../../services/extension/commandService.svelte';
import { shortcutService } from '../shortcuts/shortcutService';
import { logService } from '../../services/log/logService';
import type { IStorageService } from 'asyar-sdk/contracts';

export async function applyCustomLayout(
  layout: CustomLayout,
  store?: IStorageService,
): Promise<void> {
  try {
    const current = await windowManagementService.getWindowBounds();
    if (store) {
      await windowManagementState.savePreviousBounds(current, store);
    }
    await windowManagementService.setWindowBounds(layout.bounds);
    await feedbackService.showHUD(layout.name);
  } catch (err: any) {
    logService.error(`[WindowManagement] applyCustomLayout failed: ${err}`);
    await feedbackService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'error',
      retryable: false,
      context: { message: `Could not apply layout${err.message ? ' — ' + err.message : ''}` },
    });
  }
}

export async function syncLayoutToIndex(
  layout: CustomLayout,
  store?: IStorageService,
): Promise<void> {
  await searchService.indexItem({
    category: 'command',
    id: `cmd_window-management_layout_${layout.id}`,
    name: layout.name,
    extension: 'window-management',
    trigger: `layout ${layout.name}`,
    type: 'command',
    icon: 'icon:store',
  });

  commandService.registerCommand(
    `cmd_window-management_layout_${layout.id}`,
    {
      execute: async () => {
        await applyCustomLayout(layout, store);
        return { type: 'no-view' };
      },
    },
    'window-management',
  );
}

export async function removeLayoutFromIndex(layoutId: string): Promise<void> {
  const objectId = `cmd_window-management_layout_${layoutId}`;
  await searchService.deleteItem(objectId);
  commandService.unregisterCommand(objectId);
  await shortcutService.unregister(objectId);
}

export async function deleteLayout(layoutId: string, store: IStorageService): Promise<void> {
  await windowManagementState.deleteCustomLayout(layoutId, store);
  await removeLayoutFromIndex(layoutId);
}

export async function renameLayout(
  layoutId: string,
  newName: string,
  store: IStorageService,
): Promise<void> {
  await windowManagementState.renameCustomLayout(layoutId, newName, store);
  const updated = windowManagementState.customLayouts.find((l) => l.id === layoutId);
  if (updated) {
    await syncLayoutToIndex(updated, store);
  }
}
