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

vi.mock('../../utils/copyText', () => ({
  copyText: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('./agentsManager.svelte', () => ({
  agentsManager: {
    currentAgentId: null,
    currentThreadId: null,
    threadsVersion: 0,
    threadsFor: vi.fn(),
    rememberThreads: vi.fn(),
    sending: false,
    streamingText: '',
    lastAssistantMessageText: null as string | null,
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
    setThreadPinned: vi.fn().mockResolvedValue(undefined),
    listThreads: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./dispatch', () => ({
  dispatchAgentCommand: vi.fn(),
}));

vi.mock('./agentLoop', () => ({
  runAgent: vi.fn(),
}));

vi.mock('./agentChatView.helpers', () => ({
  ensureThread: vi.fn(),
}));

vi.mock('../../services/extension/builtinDynamicDispatchers', () => ({
  registerBuiltinDynamicDispatcher: vi.fn(),
}));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: { ai: { tabContinuesLastThread: false, defaultAgentId: null, providers: {} } },
  },
}));

vi.mock('./tabRouter', () => ({
  decideTabDestination: vi.fn(() => ({ agentId: 'agent-1' })),
}));

vi.mock('./threadOpener', () => ({
  openAgentForTab: vi.fn().mockResolvedValue(undefined),
  registerAgentSubmitHandler: vi.fn(),
}));

vi.mock('./AgentListView.svelte', () => ({ default: {} }));
vi.mock('./AgentEditView.svelte', () => ({ default: {} }));
vi.mock('./AgentChatView.svelte', () => ({ default: {} }));

import agentsExtension from './index';
import { actionService } from '../../services/action/actionService.svelte';
import { agentsManager } from './agentsManager.svelte';
import { copyText } from '../../utils/copyText';
import { agentService } from './agentService.svelte';
import type { ThreadDef } from './types';

type RegisteredAction = {
  id: string;
  visible?: () => boolean;
  execute: () => Promise<void> | void;
};

function getRegisteredAction(id: string): RegisteredAction {
  const call = vi
    .mocked(actionService.registerAction)
    .mock.calls.find(([action]) => (action as RegisteredAction).id === id);
  if (!call) throw new Error(`action ${id} was never registered`);
  return call[0] as RegisteredAction;
}

describe('agents:copy-last-response action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsManager.currentAgentId = null;
    agentsManager.currentThreadId = null;
    agentsManager.sending = false;
    agentsManager.lastAssistantMessageText = null;
  });

  describe('registration', () => {
    it('registers agents:copy-last-response when the chat view activates', async () => {
      await agentsExtension.viewActivated?.('agents/AgentChatView');

      expect(actionService.registerAction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agents:copy-last-response', shortcut: 'Mod+Shift+C' }),
      );
    });

    it('unregisters agents:copy-last-response when the chat view deactivates', async () => {
      await agentsExtension.viewDeactivated?.('agents/AgentChatView');

      expect(actionService.unregisterAction).toHaveBeenCalledWith('agents:copy-last-response');
    });
  });

  describe('visibility', () => {
    it('is hidden when the thread has no assistant message yet', async () => {
      agentsManager.lastAssistantMessageText = null;
      agentsManager.sending = false;
      await agentsExtension.viewActivated?.('agents/AgentChatView');

      const action = getRegisteredAction('agents:copy-last-response');

      expect(action.visible?.()).toBe(false);
    });

    it('is hidden while a response is still generating, even with prior assistant text', async () => {
      agentsManager.lastAssistantMessageText = 'previous answer';
      agentsManager.sending = true;
      await agentsExtension.viewActivated?.('agents/AgentChatView');

      const action = getRegisteredAction('agents:copy-last-response');

      expect(action.visible?.()).toBe(false);
    });

    it('is visible once an assistant message exists and nothing is generating', async () => {
      agentsManager.lastAssistantMessageText = 'the answer';
      agentsManager.sending = false;
      await agentsExtension.viewActivated?.('agents/AgentChatView');

      const action = getRegisteredAction('agents:copy-last-response');

      expect(action.visible?.()).toBe(true);
    });
  });

  describe('execute', () => {
    it('copies the latest assistant response text to the clipboard', async () => {
      agentsManager.lastAssistantMessageText = 'the latest assistant answer';
      await agentsExtension.viewActivated?.('agents/AgentChatView');

      const action = getRegisteredAction('agents:copy-last-response');
      await action.execute();

      expect(copyText).toHaveBeenCalledWith('the latest assistant answer');
    });

    it('does nothing when there is no assistant response to copy', async () => {
      agentsManager.lastAssistantMessageText = null;
      await agentsExtension.viewActivated?.('agents/AgentChatView');

      const action = getRegisteredAction('agents:copy-last-response');
      await action.execute();

      expect(copyText).not.toHaveBeenCalled();
    });
  });
});

describe('agents:new-thread action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsManager.currentAgentId = 'agent-1';
    agentsManager.currentThreadId = 'thread-old';
  });

  it('declares the shortcut once, on the action, with no hand-written handler', async () => {
    await agentsExtension.viewActivated?.('agents/AgentChatView');
    expect(getRegisteredAction('agents:new-thread')).toEqual(
      expect.objectContaining({ shortcut: 'Mod+N' }),
    );
  });

  it('creates a thread and selects it', async () => {
    vi.mocked(agentService.createThread).mockResolvedValueOnce({ id: 'thread-new' } as never);
    await agentsExtension.viewActivated?.('agents/AgentChatView');
    await getRegisteredAction('agents:new-thread').execute();
    expect(agentService.createThread).toHaveBeenCalledWith('agent-1', '');
    expect(agentsManager.currentThreadId).toBe('thread-new');
  });

  it('does not select the new thread if the user switched agent while it was created', async () => {
    let resolve!: (t: { id: string }) => void;
    vi.mocked(agentService.createThread).mockReturnValueOnce(
      new Promise((r) => (resolve = r)) as never,
    );
    await agentsExtension.viewActivated?.('agents/AgentChatView');
    const pending = getRegisteredAction('agents:new-thread').execute();

    agentsManager.currentAgentId = 'agent-2';
    agentsManager.currentThreadId = 'agent-2-thread';
    resolve({ id: 'thread-new' });
    await pending;

    expect(agentsManager.currentThreadId).toBe('agent-2-thread');
  });

  it('does nothing without a current agent', async () => {
    agentsManager.currentAgentId = null;
    await agentsExtension.viewActivated?.('agents/AgentChatView');
    await getRegisteredAction('agents:new-thread').execute();
    expect(agentService.createThread).not.toHaveBeenCalled();
  });
});

describe('agents:pin-thread / agents:unpin-thread actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsManager.currentAgentId = null;
    agentsManager.currentThreadId = null;
    agentsManager.threadsVersion = 0;
  });

  it('offers Pin for an unpinned active thread and hides Unpin', async () => {
    agentsManager.currentAgentId = 'agent-1';
    agentsManager.currentThreadId = 'thread-1';
    vi.mocked(agentsManager.threadsFor).mockReturnValue([
      {
        id: 'thread-1',
        agentId: 'agent-1',
        title: 'Thread 1',
        isPinned: false,
        createdAt: 100,
        updatedAt: 100,
      },
    ]);

    await agentsExtension.viewActivated?.('agents/AgentChatView');

    const pin = getRegisteredAction('agents:pin-thread');
    const unpin = getRegisteredAction('agents:unpin-thread');
    expect(pin.visible?.()).toBe(true);
    expect(unpin.visible?.()).toBe(false);
  });

  it('offers Unpin for a pinned active thread and hides Pin', async () => {
    agentsManager.currentAgentId = 'agent-1';
    agentsManager.currentThreadId = 'thread-1';
    vi.mocked(agentsManager.threadsFor).mockReturnValue([
      {
        id: 'thread-1',
        agentId: 'agent-1',
        title: 'Thread 1',
        isPinned: true,
        createdAt: 100,
        updatedAt: 100,
      },
    ]);

    await agentsExtension.viewActivated?.('agents/AgentChatView');

    const pin = getRegisteredAction('agents:pin-thread');
    const unpin = getRegisteredAction('agents:unpin-thread');
    expect(pin.visible?.()).toBe(false);
    expect(unpin.visible?.()).toBe(true);
  });

  it('hides both when there is no known active thread', async () => {
    agentsManager.currentAgentId = 'agent-1';
    agentsManager.currentThreadId = 'thread-unknown';
    vi.mocked(agentsManager.threadsFor).mockReturnValue([]);

    await agentsExtension.viewActivated?.('agents/AgentChatView');

    const pin = getRegisteredAction('agents:pin-thread');
    const unpin = getRegisteredAction('agents:unpin-thread');
    expect(pin.visible?.()).toBe(false);
    expect(unpin.visible?.()).toBe(false);

    agentsManager.currentAgentId = null;
    agentsManager.currentThreadId = null;
    expect(pin.visible?.()).toBe(false);
    expect(unpin.visible?.()).toBe(false);
  });

  it(
    'pins the active thread, updates the cached list with ' +
      'in-memory sort parity, and increments threadsVersion',
    async () => {
      agentsManager.currentAgentId = 'agent-1';
      agentsManager.currentThreadId = 'thread-2';
      agentsManager.threadsVersion = 0;

      const initialThreads: ThreadDef[] = [
        {
          id: 'thread-1',
          agentId: 'agent-1',
          title: 'Thread 1',
          isPinned: true,
          createdAt: 100,
          updatedAt: 200,
        },
        {
          id: 'thread-2',
          agentId: 'agent-1',
          title: 'Thread 2',
          isPinned: false,
          createdAt: 100,
          updatedAt: 300,
        },
        {
          id: 'thread-3',
          agentId: 'agent-1',
          title: 'Thread 3',
          isPinned: false,
          createdAt: 100,
          updatedAt: 100,
        },
      ];
      vi.mocked(agentsManager.threadsFor).mockReturnValue(initialThreads);

      await agentsExtension.viewActivated?.('agents/AgentChatView');
      const pin = getRegisteredAction('agents:pin-thread');
      await pin.execute();

      expect(agentService.setThreadPinned).toHaveBeenCalledWith('thread-2', true);
      expect(agentsManager.rememberThreads).toHaveBeenCalledWith('agent-1', [
        expect.objectContaining({ id: 'thread-2', isPinned: true }),
        expect.objectContaining({ id: 'thread-1', isPinned: true }),
        expect.objectContaining({ id: 'thread-3', isPinned: false }),
      ]);
      expect(agentsManager.threadsVersion).toBe(1);
    },
  );

  it('unpins the active thread', async () => {
    agentsManager.currentAgentId = 'agent-1';
    agentsManager.currentThreadId = 'thread-1';
    agentsManager.threadsVersion = 1;

    const initialThreads: ThreadDef[] = [
      {
        id: 'thread-1',
        agentId: 'agent-1',
        title: 'Thread 1',
        isPinned: true,
        createdAt: 100,
        updatedAt: 200,
      },
      {
        id: 'thread-2',
        agentId: 'agent-1',
        title: 'Thread 2',
        isPinned: true,
        createdAt: 100,
        updatedAt: 300,
      },
    ];
    vi.mocked(agentsManager.threadsFor).mockReturnValue(initialThreads);

    await agentsExtension.viewActivated?.('agents/AgentChatView');
    const unpin = getRegisteredAction('agents:unpin-thread');
    await unpin.execute();

    expect(agentService.setThreadPinned).toHaveBeenCalledWith('thread-1', false);
    expect(agentsManager.rememberThreads).toHaveBeenCalledWith('agent-1', [
      expect.objectContaining({ id: 'thread-2', isPinned: true }),
      expect.objectContaining({ id: 'thread-1', isPinned: false }),
    ]);
    expect(agentsManager.threadsVersion).toBe(2);
  });

  it('unregisters both actions when chat view deactivates', async () => {
    await agentsExtension.viewDeactivated?.('agents/AgentChatView');

    expect(actionService.unregisterAction).toHaveBeenCalledWith('agents:pin-thread');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('agents:unpin-thread');
  });
});
