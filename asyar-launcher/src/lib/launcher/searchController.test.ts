/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';

// Mock the import chain that searchController.svelte.ts pulls in, so we can
// import the pure helper without dragging in Tauri/IPC modules.
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/search/stores/search.svelte', () => ({
  searchStores: { query: '', selectedIndex: 0, isLoading: false },
}));

vi.mock('../../services/search/searchOrchestrator.svelte', () => ({
  searchOrchestrator: { items: [], handleSearch: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../services/context/contextModeService.svelte', () => ({
  contextModeService: {
    contextActivationId: null,
    activeContext: null,
    contextHint: null,
    getMatch: vi.fn().mockReturnValue(null),
    isActive: vi.fn().mockReturnValue(false),
    activate: vi.fn(),
    deactivate: vi.fn(),
    getHint: vi.fn().mockReturnValue(null),
    pinnedHintProviderId: null,
  },
  contextActivationId: null,
}));

vi.mock('../../services/extension/extensionManager.svelte', () => ({
  default: {
    handleViewSearch: vi.fn(),
    goBack: vi.fn(),
  },
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn(), dismiss: vi.fn() },
}));

import { nextContextHint } from './searchController.svelte';
import type { ContextHint } from '../../services/context/contextModeService.svelte';

const aiHint: ContextHint = {
  provider: { id: 'agents:default', triggers: ['ask ai'], display: { name: 'AI', icon: '🤖' }, type: 'stream' },
  type: 'ai',
};

const portalHint: ContextHint = {
  provider: { id: 'portal-goo', triggers: ['google'], display: { name: 'Google', icon: '🔍' }, type: 'view' },
  type: 'prefix',
};

describe('nextContextHint', () => {
  it('returns null when a Tier 2 view is active, regardless of other fields', () => {
    const result = nextContextHint({
      activeViewActive: true,
      localSearchValue: 'settings',
      activeContext: null,
      computeHint: () => aiHint,
    });
    expect(result).toBeNull();
  });

  it('returns null when a Tier 2 view is active even when computeHint would return a hint', () => {
    const result = nextContextHint({
      activeViewActive: true,
      localSearchValue: 'why is the sky blue?',
      activeContext: null,
      computeHint: () => aiHint,
    });
    expect(result).toBeNull();
  });

  it('returns null when a context (portal) is committed, regardless of view state', () => {
    const activeContext = { provider: portalHint.provider, query: 'something' };
    const result = nextContextHint({
      activeViewActive: false,
      localSearchValue: 'goo',
      activeContext,
      computeHint: () => aiHint,
    });
    expect(result).toBeNull();
  });

  it('returns the AI hint for an empty box in normal mode when stream provider registered', () => {
    const result = nextContextHint({
      activeViewActive: false,
      localSearchValue: '',
      activeContext: null,
      computeHint: () => aiHint,
    });
    expect(result).toBe(aiHint);
  });

  it('returns the portal prefix hint when computeHint yields prefix match in normal mode', () => {
    const result = nextContextHint({
      activeViewActive: false,
      localSearchValue: 'goo',
      activeContext: null,
      computeHint: () => portalHint,
    });
    expect(result).toBe(portalHint);
  });
});
