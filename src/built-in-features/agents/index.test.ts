import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks MUST be defined before the module under test is imported.

vi.mock('asyar-sdk/contracts', () => ({
  ActionContext: {
    EXTENSION_VIEW: 'EXTENSION_VIEW',
  },
}));

vi.mock('../../services/context/contextModeService.svelte', () => ({
  contextModeService: {
    registerProvider: vi.fn(),
    activate: vi.fn(),
    updateQuery: vi.fn(),
  },
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
    setActionExecutor: vi.fn(),
  },
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: {
    navigateToView: vi.fn(),
    activeView: null,
  },
}));

vi.mock('../../services/run/runService.svelte', () => ({
  runService: {
    selectedRunId: null,
    active: [],
    recent: [],
  },
}));

vi.mock('./agentsManager.svelte', () => ({
  agentsManager: {
    currentAgentId: null,
    currentThreadId: null,
    sending: false,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    activeAbortController: null,
  },
}));

vi.mock('./agentService.svelte', () => ({
  agentService: {
    delete: vi.fn(),
    createThread: vi.fn(),
    deleteThread: vi.fn(),
    listThreads: vi.fn().mockResolvedValue([]),
    updateThreadTitle: vi.fn(),
  },
}));

vi.mock('./dispatch', () => ({
  dispatchAgentCommand: vi.fn(),
}));

vi.mock('./agentLoop', () => ({
  runAgent: vi.fn(),
}));

vi.mock('./agentChatView.helpers', () => ({
  deriveThreadTitle: vi.fn((t: string) => t),
  ensureThread: vi.fn(),
}));

vi.mock('../../services/extension/builtinDynamicDispatchers', () => ({
  registerBuiltinDynamicDispatcher: vi.fn(),
}));

vi.mock('../../lib/ipc/commands', () => ({
  agentsFindRunOrigin: vi.fn(),
  showSettingsWindow: vi.fn(),
}));

vi.mock('./tabRouter', () => ({
  decideTabDestination: vi.fn(() => ({ agentId: 'agent-1' })),
}));

vi.mock('./threadOpener', () => ({
  openAgentForTab: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      ai: {
        tabContinuesLastThread: false,
        defaultAgentId: null,
        providers: {},
      },
    },
  },
}));

// Mock Svelte components
vi.mock('./AgentListView.svelte', () => ({ default: {} }));
vi.mock('./AgentEditView.svelte', () => ({ default: {} }));
vi.mock('./AgentChatView.svelte', () => ({ default: {} }));

import agentsExtension from './index';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { openAgentForTab } from './threadOpener';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { decideTabDestination } from './tabRouter';

describe('AgentsExtension', () => {
  let mockExtensionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtensionManager = {
      navigateToView: vi.fn(),
      setActiveViewSubtitle: vi.fn(),
    };
  });

  describe('initialize', () => {
    it('registers a stream context provider on initialize', async () => {
      await agentsExtension.initialize({
        getService: vi.fn().mockReturnValue(mockExtensionManager),
      } as any);

      expect(contextModeService.registerProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agents:default',
          type: 'stream',
        }),
      );
    });
  });

  describe('AI provider — Tab honors settings', () => {
    // Helper: initialize and extract the registered onActivate callback
    async function getOnActivate(): Promise<(initialQuery?: string) => Promise<void>> {
      vi.mocked(contextModeService.registerProvider).mockReset();
      await agentsExtension.initialize({
        getService: vi.fn().mockReturnValue(mockExtensionManager),
      } as any);
      const call = vi.mocked(contextModeService.registerProvider).mock.calls[0];
      return call[0].onActivate as (initialQuery?: string) => Promise<void>;
    }

    it('onActivate passes tabContinuesLastThread=true with empty initialQuery', async () => {
      (settingsService as any).currentSettings = {
        ai: { tabContinuesLastThread: true, defaultAgentId: null, providers: {} },
      };
      vi.mocked(decideTabDestination).mockReturnValue({ agentId: 'agent-1' } as any);

      const onActivate = await getOnActivate();
      await onActivate('');

      expect(openAgentForTab).toHaveBeenCalledWith('agent-1', '', true);
    });

    it('onActivate passes tabContinuesLastThread=true with non-empty initialQuery', async () => {
      (settingsService as any).currentSettings = {
        ai: { tabContinuesLastThread: true, defaultAgentId: null, providers: {} },
      };
      vi.mocked(decideTabDestination).mockReturnValue({ agentId: 'agent-1' } as any);

      const onActivate = await getOnActivate();
      await onActivate('hello');

      expect(openAgentForTab).toHaveBeenCalledWith('agent-1', 'hello', true);
    });

    it('onActivate passes tabContinuesLastThread=false with empty initialQuery', async () => {
      (settingsService as any).currentSettings = {
        ai: { tabContinuesLastThread: false, defaultAgentId: null, providers: {} },
      };
      vi.mocked(decideTabDestination).mockReturnValue({ agentId: 'agent-1' } as any);

      const onActivate = await getOnActivate();
      await onActivate('');

      expect(openAgentForTab).toHaveBeenCalledWith('agent-1', '', false);
    });

    it('onActivate passes tabContinuesLastThread=false with non-empty initialQuery', async () => {
      (settingsService as any).currentSettings = {
        ai: { tabContinuesLastThread: false, defaultAgentId: null, providers: {} },
      };
      vi.mocked(decideTabDestination).mockReturnValue({ agentId: 'agent-1' } as any);

      const onActivate = await getOnActivate();
      await onActivate('hello');

      expect(openAgentForTab).toHaveBeenCalledWith('agent-1', 'hello', false);
    });
  });
});
