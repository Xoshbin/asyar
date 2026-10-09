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
