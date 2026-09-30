/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Hoisted mock to simulate Temporal Dead Zone (TDZ) for searchOrchestrator
const mockState = vi.hoisted(() => ({ orchestratorInitialized: false }));
vi.mock('../../search/searchOrchestrator.svelte', () => {
  return {
    get searchOrchestrator() {
      if (!mockState.orchestratorInitialized) {
        throw new ReferenceError("Cannot access 'searchOrchestrator' before initialization");
      }
      return { items: [], handleSearch: vi.fn() };
    },
    invalidateTopItemsCache: vi.fn(),
  };
});

vi.mock('../../search/stores/search.svelte', () => ({
  searchStores: { selectedIndex: -1, query: '' },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/ipc/commands', () => ({
  showSettingsWindow: vi.fn().mockResolvedValue(undefined),
  factoryReset: vi.fn().mockResolvedValue(undefined),
  setItemFavorite: vi.fn().mockResolvedValue(true),
}));

vi.mock('tauri-plugin-clipboard-x-api', () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'macos',
}));

vi.mock('../../settings/developerSettingsService.svelte', () => ({
  developerSettingsService: { isDeveloperMode: true },
}));

describe('ActionService & SearchOrchestrator TDZ cycle regression guard', () => {
  beforeEach(() => {
    mockState.orchestratorInitialized = false;
  });

  it('imports and instantiates ActionService without accessing searchOrchestrator in TDZ during construction', async () => {
    // When searchOrchestrator is in TDZ (orchestratorInitialized = false),
    // importing and constructing ActionService must NOT dereference searchOrchestrator.
    // If ActionService registers actions that evaluate searchOrchestrator in visible()
    // during construction, this throws ReferenceError: Cannot access 'searchOrchestrator' before initialization.
    const mod = await import('../actionService.svelte');
    expect(mod.ActionService).toBeDefined();
    expect(mod.actionService).toBeDefined();
  });

  it('does not register selected-result-dependent favorites as static built-in actions in ActionService', async () => {
    mockState.orchestratorInitialized = true;
    const { ActionService } = await import('../actionService.svelte');
    const service = new ActionService();
    const actionIds = service.getAllActions().map((a) => a.id);

    // Selected-result-dependent actions belong to the launcher selection lifecycle,
    // not static built-in actions on ActionService.
    expect(actionIds).not.toContain('favorite_item');
    expect(actionIds).not.toContain('unfavorite_item');
  });

  it('actionService.svelte.ts does not import invalidateTopItemsCache', () => {
    const filePath = resolve(__dirname, '../actionService.svelte.ts');
    const source = readFileSync(filePath, 'utf-8');
    expect(source).not.toContain('invalidateTopItemsCache');
  });
});
