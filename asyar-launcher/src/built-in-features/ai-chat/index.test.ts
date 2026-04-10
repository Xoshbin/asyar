import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionContext } from 'asyar-sdk';

// Mocks MUST be defined BEFORE imports of the module under test
vi.mock('asyar-sdk', () => ({
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
  },
}));

vi.mock('./aiStore.svelte', () => ({
  aiStore: {
    clearConversation: vi.fn(),
    isConfigured: true,
    settings: { provider: 'openai', model: 'gpt-4o' },
    addUserMessage: vi.fn().mockReturnValue({ messages: [] }),
    beginAssistantMessage: vi.fn().mockReturnValue('msg-1'),
    appendStreamToken: vi.fn(),
    finalizeAssistantMessage: vi.fn(),
    failAssistantMessage: vi.fn(),
  },
}));

vi.mock('./aiService', () => ({
  streamChat: vi.fn(),
  stopStream: vi.fn(),
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
    it('pre-fills with selection when no query is typed', async () => {
      vi.mocked(selectionService.getSelectedText).mockResolvedValue('hello world');
      const spy = vi.spyOn(AIChatExtension, 'executeCommand');

      await AIChatExtension.executeCommand('open-ai-chat');

      // Should have called ask with 'hello world'
      expect(spy).toHaveBeenCalledWith('ask', { query: 'hello world' });
      expect(selectionService.getSelectedText).toHaveBeenCalled();
    });

    it('navigates normally when selection is empty', async () => {
      vi.mocked(selectionService.getSelectedText).mockResolvedValue('');
      const spy = vi.spyOn(AIChatExtension, 'executeCommand');

      const result = await AIChatExtension.executeCommand('open-ai-chat');

      expect(spy).not.toHaveBeenCalledWith('ask', expect.anything());
      expect(mockExtensionManager.navigateToView).toHaveBeenCalledWith('ai-chat/ChatView');
      expect(result).toEqual({ type: 'view', viewPath: 'ai-chat/ChatView' });
    });

    it('navigates normally when selection is whitespace', async () => {
      vi.mocked(selectionService.getSelectedText).mockResolvedValue('   ');
      const spy = vi.spyOn(AIChatExtension, 'executeCommand');

      await AIChatExtension.executeCommand('open-ai-chat');

      expect(spy).not.toHaveBeenCalledWith('ask', expect.anything());
      expect(mockExtensionManager.navigateToView).toHaveBeenCalledWith('ai-chat/ChatView');
    });

    it('navigates normally when selection is null', async () => {
      vi.mocked(selectionService.getSelectedText).mockResolvedValue(null);
      const spy = vi.spyOn(AIChatExtension, 'executeCommand');

      await AIChatExtension.executeCommand('open-ai-chat');

      expect(spy).not.toHaveBeenCalledWith('ask', expect.anything());
      expect(mockExtensionManager.navigateToView).toHaveBeenCalledWith('ai-chat/ChatView');
    });

    it('swallows errors from selectionService and navigates normally', async () => {
      vi.mocked(selectionService.getSelectedText).mockRejectedValue(new Error('Selection failed'));
      const spy = vi.spyOn(AIChatExtension, 'executeCommand');

      await AIChatExtension.executeCommand('open-ai-chat');

      expect(spy).not.toHaveBeenCalledWith('ask', expect.anything());
      expect(mockExtensionManager.navigateToView).toHaveBeenCalledWith('ai-chat/ChatView');
    });

    it('prioritizes typed query over selection', async () => {
      vi.mocked(selectionService.getSelectedText).mockResolvedValue('selection text');
      const spy = vi.spyOn(AIChatExtension, 'executeCommand');

      await AIChatExtension.executeCommand('open-ai-chat', { query: 'typed query' });

      // selectionService should NOT be called
      expect(selectionService.getSelectedText).not.toHaveBeenCalled();
      // Should have called ask with 'typed query'
      expect(spy).toHaveBeenCalledWith('ask', { query: 'typed query' });
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
