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

// Mock Svelte components
vi.mock('./AgentListView.svelte', () => ({ default: {} }));
vi.mock('./AgentEditView.svelte', () => ({ default: {} }));
vi.mock('./AgentChatView.svelte', () => ({ default: {} }));

import agentsExtension from './index';
import { contextModeService } from '../../services/context/contextModeService.svelte';

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
});
