/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { writeText } from 'tauri-plugin-clipboard-x-api';
import { actionService } from '../../services/action/actionService.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { runService } from '../../services/run/runService.svelte';
import { searchOrchestrator } from '../../services/search/searchOrchestrator.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { LauncherState } from './launcherState.svelte';
import { setupSelectionEffects } from './selectionEffects.svelte';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn() }));

let dispose = () => {};
afterEach(() => {
  dispose();
  searchOrchestrator.items = [];
  runService.active = [];
  searchStores.selectedIndex = 0;
  vi.restoreAllMocks();
});

it('uses the displayed selection for app actions when favorites and runs shift the rows', async () => {
  vi.spyOn(feedbackService, 'showHUD').mockResolvedValue(undefined);
  const app = {
    objectId: 'app_steam',
    name: 'Steam',
    type: 'application' as const,
    path: '/apps/steam',
    tier: 1,
    score: 1,
  };
  const favorite = {
    ...app,
    objectId: 'app_firefox',
    name: 'Firefox',
    path: '/apps/firefox',
    favorite: true,
  };
  searchOrchestrator.items = [app, favorite];
  runService.active = [
    {
      id: 'r1',
      kind: 'shell-script',
      label: 'Build',
      status: 'running',
      startedAt: 1,
      cancellable: false,
    },
  ];
  const state = new LauncherState();
  dispose = $effect.root(() => setupSelectionEffects(state));
  flushSync();
  expect(state.searchResultItemsMapped.map((row) => row.object_id)).toEqual([
    favorite.objectId,
    'run_r1',
    app.objectId,
  ]);
  expect(state.currentSelectedItemOriginal?.objectId).toBe(favorite.objectId);
  await actionService.executeAction('copy_application_path');
  expect(writeText).toHaveBeenLastCalledWith(favorite.path);

  searchStores.selectedIndex = 1;
  flushSync();
  expect(state.currentSelectedItemOriginal).toBeNull();
  await actionService.executeAction('copy_application_path');
  expect(writeText).toHaveBeenCalledTimes(1);

  searchStores.selectedIndex = 2;
  flushSync();
  expect(state.currentSelectedItemOriginal?.objectId).toBe(app.objectId);
  await actionService.executeAction('copy_application_path');
  expect(writeText).toHaveBeenLastCalledWith(app.path);
});
