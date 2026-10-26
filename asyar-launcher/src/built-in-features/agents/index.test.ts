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
    unregisterProvider: vi.fn(),
    activate: vi.fn(),
    updateQuery: vi.fn(),
  },
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
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
    streamingText: '',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    activeAbortController: null,
    threadsVersion: 0,
    threadsFor: vi.fn(),
    rememberThreads: vi.fn(),
  },
}));

vi.mock('./agentService.svelte', () => ({
  agentService: {
    defaultAgent: null,
    upsertDefaultAgent: vi.fn(),
    getById: vi.fn(),
    setThreadProvider: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn(),
    createThread: vi.fn(),
    deleteThread: vi.fn(),
    listThreads: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./dispatch', () => ({
  dispatchAgentCommand: vi.fn(),
}));

vi.mock('./agentLoop', () => ({
  runAgent: vi.fn(),
}));

vi.mock('./agentChatView.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agentChatView.helpers')>()),
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
  registerAgentSubmitHandler: vi.fn(),
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
import { actionService } from '../../services/action/actionService.svelte';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { openAgentForTab } from './threadOpener';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { decideTabDestination } from './tabRouter';
import { agentsManager } from './agentsManager.svelte';
import { agentService } from './agentService.svelte';
import { runAgent } from './agentLoop';
import { ensureThread } from './agentChatView.helpers';

describe('AgentsExtension', () => {
  let mockExtensionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    agentsManager.currentAgentId = null;
    agentsManager.currentThreadId = null;
    agentsManager.sending = false;
    agentsManager.streamingText = '';
    agentsManager.activeAbortController = null;
    mockExtensionManager = {
      navigateToView: vi.fn(),
      setActiveViewSubtitle: vi.fn(),
    };
  });

  describe('chat submission', () => {
    it('replaces a stale selected thread before sending', async () => {
      agentsManager.currentAgentId = 'agent-1';
      agentsManager.currentThreadId = 'deleted-thread';
      vi.mocked(agentService.listThreads).mockResolvedValue([] as never);
      vi.mocked(ensureThread).mockResolvedValue({
        id: 'fresh-thread',
        agentId: 'agent-1',
        title: '',
        createdAt: 1,
        updatedAt: 1,
      });
      vi.mocked(runAgent).mockResolvedValue(undefined);

      await agentsExtension.onViewSubmit?.('hello');

      expect(agentsManager.currentThreadId).toBe('fresh-thread');
      expect(runAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          threadId: 'fresh-thread',
          userText: 'hello',
        }),
      );
    });

    it('leaves the streamed reply for the chat view to clear after its reload', async () => {
      agentsManager.currentAgentId = 'agent-1';
      agentsManager.currentThreadId = 'thread-1';
      vi.mocked(agentService.listThreads).mockResolvedValue([
        { id: 'thread-1', agentId: 'agent-1', title: '', createdAt: 1, updatedAt: 1 },
      ] as never);
      vi.mocked(runAgent).mockImplementation(async (opts: any) => {
        opts.onAssistantTextDelta('Hi', 'Hi there');
        opts.onAssistantTurnPersisted();
      });

      await agentsExtension.onViewSubmit?.('hello');

      expect(agentsManager.sending).toBe(false);
      expect(agentsManager.streamingText).toBe('Hi there');
      expect(agentsManager.streamingTextPersisted).toBe(true);
    });

    it('clears a streamed reply that was never saved (aborted or failed run)', async () => {
      agentsManager.currentAgentId = 'agent-1';
      agentsManager.currentThreadId = 'thread-1';
      vi.mocked(agentService.listThreads).mockResolvedValue([
        { id: 'thread-1', agentId: 'agent-1', title: '', createdAt: 1, updatedAt: 1 },
      ] as never);
      vi.mocked(runAgent).mockImplementation(async (opts: any) => {
        opts.onAssistantTextDelta('Hi', 'Hi');
        throw new Error('aborted');
      });

      await agentsExtension.onViewSubmit?.('hello');

      expect(agentsManager.streamingText).toBe('');
    });
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

    it('unregisters its context provider when deactivated', async () => {
      await agentsExtension.deactivate();

      expect(contextModeService.unregisterProvider).toHaveBeenCalledWith('agents:default');
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

  describe('"Ask AI" command', () => {
    it('opens an empty chat even when root search handed it a query', async () => {
      // "ask" / an alias / a typo was only used to find the command; sending
      // it to the model as a message is the bug. Tab is the explicit route.
      await agentsExtension.executeCommand('ask', { query: 'ask' });

      expect(openAgentForTab).toHaveBeenCalledWith('agent-1', '', false);
    });
  });

  describe('lifecycle & view actions', () => {
    it('registers actions on viewActivated and unregisters on viewDeactivated', async () => {
      await agentsExtension.viewActivated('agents/AgentListView');
      expect(actionService.registerAction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agents:new-agent' }),
      );

      await agentsExtension.viewDeactivated('agents/AgentListView');
      expect(actionService.unregisterAction).toHaveBeenCalledWith('agents:new-agent');
      expect(actionService.unregisterAction).toHaveBeenCalledWith('agents:edit-agent');
      expect(actionService.unregisterAction).toHaveBeenCalledWith('agents:delete-agent');
    });

    describe('provider and model actions', () => {
      beforeEach(() => {
        agentsManager.currentAgentId = 'agent-1';
        (agentsManager as any).picker = null;
      });

      function registered(id: string) {
        return vi
          .mocked(actionService.registerAction)
          .mock.calls.map(([action]) => action as any)
          .find((action) => action.id === id);
      }

      it('registers Change Provider and Change Model, without shortcuts, and unregisters them', async () => {
        await agentsExtension.viewActivated('agents/AgentChatView');
        expect(registered('agents:change-provider').shortcut).toBeUndefined();
        expect(registered('agents:change-model').shortcut).toBeUndefined();

        await agentsExtension.viewDeactivated('agents/AgentChatView');
        expect(actionService.unregisterAction).toHaveBeenCalledWith('agents:change-provider');
        expect(actionService.unregisterAction).toHaveBeenCalledWith('agents:change-model');
      });

      it.each([
        ['agents:change-provider', 'provider'],
        ['agents:change-model', 'model'],
      ])('%s opens its picker, and is hidden mid-run', async (id, picker) => {
        await agentsExtension.viewActivated('agents/AgentChatView');
        const action = registered(id);
        expect(action.visible()).toBe(true);

        await action.execute();
        expect((agentsManager as any).picker).toBe(picker);

        agentsManager.sending = true;
        expect(action.visible()).toBe(false);
      });
    });

    it('deactivates and reactivates cleanly and idempotently', async () => {
      const abort = vi.fn();
      agentsManager.activeAbortController = { abort } as any;

      await agentsExtension.deactivate();

      expect(contextModeService.unregisterProvider).toHaveBeenCalledWith('agents:default');
      expect(abort).toHaveBeenCalledTimes(1);
      expect(agentsManager.activeAbortController).toBeNull();
      expect(agentsManager.stop).toHaveBeenCalled();

      await agentsExtension.activate();

      expect(contextModeService.registerProvider).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agents:default' }),
      );
      expect(agentsManager.start).toHaveBeenCalled();
    });
  });
});
