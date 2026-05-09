import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionContext } from 'asyar-sdk/contracts';

// Mocks MUST be defined BEFORE imports of the module under test
vi.mock('asyar-sdk/contracts', () => ({
  ActionContext: {
    EXTENSION_VIEW: 'EXTENSION_VIEW',
  },
}));

vi.mock('../../services/selection/selectionService', () => ({
  selectionService: { getSelectedText: vi.fn() },
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

vi.mock('./aiStore.svelte', () => ({
  aiStore: {
    clearConversation: vi.fn(),
    isConfigured: true,
    settings: {
      providers: { openai: { enabled: true, apiKey: 'sk-test' } },
      activeProviderId: 'openai',
      activeModelId: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 2048,
      allowExtensionUse: true,
    },
    addUserMessage: vi.fn().mockReturnValue({ messages: [] }),
    beginAssistantMessage: vi.fn().mockReturnValue('msg-1'),
    appendStreamToken: vi.fn(),
    finalizeAssistantMessage: vi.fn(),
    failAssistantMessage: vi.fn(),
    loadHistory: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/ai/aiEngine', () => ({
  streamChat: vi.fn(),
  stopStream: vi.fn(),
}));

vi.mock('../../services/ai/providerRegistry', () => ({
  registerProvider: vi.fn(),
  getProvider: vi.fn().mockReturnValue({ id: 'openai', name: 'OpenAI' }),
  listProviders: vi.fn().mockReturnValue([]),
}));

// Mock provider plugins
vi.mock('../../services/ai/providers/openai', () => ({ openaiPlugin: { id: 'openai' } }));
vi.mock('../../services/ai/providers/anthropic', () => ({ anthropicPlugin: { id: 'anthropic' } }));
vi.mock('../../services/ai/providers/google', () => ({ googlePlugin: { id: 'google' } }));
vi.mock('../../services/ai/providers/ollama', () => ({ ollamaPlugin: { id: 'ollama' } }));
vi.mock('../../services/ai/providers/openrouter', () => ({ openrouterPlugin: { id: 'openrouter' } }));
vi.mock('../../services/ai/providers/custom', () => ({ customPlugin: { id: 'custom' } }));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: { currentSettings: { ai: {} }, updateSettings: vi.fn() },
}));

vi.mock('../../services/run/runService.svelte', () => ({
  runService: {
    startLocal: vi.fn(async () => ({
      id: 'mock-run-id',
      write: vi.fn(async () => {}),
      done: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      onCancel: vi.fn(() => () => {}),
    })),
  },
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock Svelte components
vi.mock('./ChatView.svelte', () => ({ default: {} }));
vi.mock('./HistoryView.svelte', () => ({ default: {} }));

vi.mock('../../lib/ipc/commands', () => ({
  showSettingsWindow: vi.fn().mockResolvedValue(undefined),
}));

import AIChatExtension from './index';
import { selectionService } from '../../services/selection/selectionService';
import { actionService } from '../../services/action/actionService.svelte';

describe('AIChatExtension', () => {
  let mockExtensionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtensionManager = {
      navigateToView: vi.fn(),
      setActiveViewSubtitle: vi.fn(),
    };
    // Initialize to set extensionManager
    (AIChatExtension as any).initialize({
      getService: vi.fn().mockReturnValue(mockExtensionManager),
    });
  });

  describe('executeCommand: open-ai-chat', () => {
    // open-ai-chat is the "just open the chat" path. It MUST NOT auto-submit
    // anything as a first message — neither the launcher search-bar text
    // (which is the command matcher, not user input) nor the user's current
    // OS-level text selection (which would silently submit whatever the user
    // happens to have highlighted in another window every time they reopen
    // the chat). The explicit "Ask about Selection" action and the
    // contextMode "ask ai <query>" trigger are the only paths that should
    // pre-populate a query — they call executeCommand('ask', { query }) directly.

    it('navigates to ChatView and returns view descriptor', async () => {
      const result = await AIChatExtension.executeCommand('open-ai-chat');

      expect(mockExtensionManager.navigateToView).toHaveBeenCalledWith('ai-chat/ChatView');
      expect(result).toEqual({ type: 'view', viewPath: 'ai-chat/ChatView' });
    });

    it('does not read OS selection on open', async () => {
      await AIChatExtension.executeCommand('open-ai-chat');

      expect(selectionService.getSelectedText).not.toHaveBeenCalled();
    });

    it('does not auto-submit args.query as a chat message', async () => {
      const spy = vi.spyOn(AIChatExtension, 'executeCommand');

      await AIChatExtension.executeCommand('open-ai-chat', { query: 'typed query' });

      expect(spy).not.toHaveBeenCalledWith('ask', expect.anything());
    });
  });

  describe('View Actions', () => {
    it('registers ask-about-selection action when view is activated', async () => {
      await AIChatExtension.viewActivated('ai-chat/ChatView');

      expect(actionService.registerAction).toHaveBeenCalledWith(expect.objectContaining({
        id: 'ai-chat:ask-about-selection',
        label: 'Ask about Selection',
      }));
    });

    it('unregisters ask-about-selection action when view is deactivated', async () => {
      await AIChatExtension.viewDeactivated('ai-chat/ChatView');

      expect(actionService.unregisterAction).toHaveBeenCalledWith('ai-chat:ask-about-selection');
    });

    it('ask-about-selection action calls ask command with selected text', async () => {
      await AIChatExtension.viewActivated('ai-chat/ChatView');
      
      const lastCall = vi.mocked(actionService.registerAction).mock.calls.find(call => call[0].id === 'ai-chat:ask-about-selection');
      const action = lastCall![0];
      
      vi.mocked(selectionService.getSelectedText).mockResolvedValue('some selected text');
      const spy = vi.spyOn(AIChatExtension, 'executeCommand');

      await action.execute();

      expect(selectionService.getSelectedText).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith('ask', { query: 'some selected text' });
    });

    it('ask-about-selection action does nothing when no text is selected', async () => {
      await AIChatExtension.viewActivated('ai-chat/ChatView');
      
      const lastCall = vi.mocked(actionService.registerAction).mock.calls.find(call => call[0].id === 'ai-chat:ask-about-selection');
      const action = lastCall![0];
      
      vi.mocked(selectionService.getSelectedText).mockResolvedValue(null);
      const spy = vi.spyOn(AIChatExtension, 'executeCommand');

      await action.execute();

      expect(spy).not.toHaveBeenCalledWith('ask', expect.anything());
    });
  });
});
