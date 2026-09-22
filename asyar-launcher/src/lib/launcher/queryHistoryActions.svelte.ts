import { ActionContext } from 'asyar-sdk/contracts';
import { actionService } from '../../services/action/actionService.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import type { LauncherState } from './launcherState.svelte';

export function setupQueryHistoryActions(state: LauncherState) {
  $effect(() => {
    const query = state.queryHistory.current;
    if (query !== null && !state.activeViewVal && !state.activeContext) {
      actionService.registerAction({
        id: 'query-history:delete',
        label: 'Delete from history',
        icon: 'icon:trash',
        category: 'Search history',
        context: ActionContext.CORE,
        destructive: true,
        execute: async () => {
          const confirmed = await feedbackService.confirmAlert({
            title: 'Delete from history?',
            message: 'This query will no longer be available with the up arrow.',
            confirmText: 'Delete',
            variant: 'danger',
          });
          if (confirmed && (await state.queryHistory.deleteCurrent())) {
            if (state.localSearchValue === query) {
              state.localSearchValue = '';
              searchStores.query = '';
            }
          }
          state.getBottomBar()?.closeActionList();
        },
      });
    }
    return () => actionService.unregisterAction('query-history:delete');
  });
}
