import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
import { ActionContext } from 'asyar-sdk';
import ChatView from './ChatView.svelte';
import SettingsView from './SettingsView.svelte';
import HistoryView from './HistoryView.svelte';
import { contextModeService } from '../../services/context/contextModeService';
import { actionService } from '../../services/action/actionService';
import { addUserMessage, beginAssistantMessage, appendStreamToken, finalizeAssistantMessage, failAssistantMessage, aiSettings, isConfigured } from './aiStore';
import { streamChat } from './aiService';
import { get } from 'svelte/store';

class AIChatExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView = false;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');

    // Register as context mode provider (AI chip, Tab-to-AI)
    contextModeService.registerProvider({
      id: 'ai-chat',
      triggers: ['ai', 'ask ai', 'chat'],
      display: {
        name: 'AI',
        icon: '🤖',
        color: '#7c3aed', // purple — visually distinct from portal blue
      },
      type: 'stream',
      onActivate: (initialQuery?: string) => {
        this.extensionManager?.navigateToView('ai-chat/ChatView');
        if (initialQuery) {
          // Trigger the 'ask' command logic to automatically submit the prompt
          this.executeCommand('ask', { query: initialQuery });
        }
      },
      onDeactivate: () => {
        // Conversation persists — user can re-open later
      },
    });
  }

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'open-ai-chat') {
      this.extensionManager?.navigateToView('ai-chat/ChatView');
      return { type: 'view', viewPath: 'ai-chat/ChatView' };
    }
    if (commandId === 'ai-settings') {
      this.extensionManager?.navigateToView('ai-chat/SettingsView');
      return { type: 'view', viewPath: 'ai-chat/SettingsView' };
    }
    // "Ask AI" result row — navigate to chat and auto-send the query
    if (commandId === 'ask') {
      const query: string = args?.query ?? '';
      this.extensionManager?.navigateToView('ai-chat/ChatView');
      if (query && get(isConfigured)) {
        const settings = get(aiSettings);
        addUserMessage(query);
        const msgId = beginAssistantMessage();
        const conv = { messages: [{ id: 'q', role: 'user' as const, content: query, timestamp: Date.now() }] };
        await streamChat(conv.messages, settings, {
          onToken: (token) => appendStreamToken(msgId, token),
          onDone: () => finalizeAssistantMessage(msgId),
          onError: (err) => failAssistantMessage(msgId, `⚠️ ${err}`),
        });
      }
      return { type: 'view', viewPath: 'ai-chat/ChatView' };
    }
    if (commandId === 'ai-history') {
      this.extensionManager?.navigateToView('ai-chat/HistoryView');
      return { type: 'view', viewPath: 'ai-chat/HistoryView' };
    }
  }

  async viewActivated(_viewId: string): Promise<void> {
    this.inView = true;
    this.registerViewActions();
  }

  async viewDeactivated(_viewId: string): Promise<void> {
    this.inView = false;
    this.unregisterViewActions();
  }

  private registerViewActions() {
    actionService.registerAction({
      id: 'ai-chat:new-chat',
      label: 'New Chat',
      icon: '✨',
      description: 'Start a new AI conversation',
      category: 'AI Chat',
      extensionId: 'ai-chat',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        const { clearConversation } = await import('./aiStore');
        clearConversation();
      },
    });
    actionService.registerAction({
      id: 'ai-chat:history',
      label: 'View History',
      icon: '🕒',
      description: 'Show conversation history',
      category: 'AI Chat',
      extensionId: 'ai-chat',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        this.extensionManager?.navigateToView('ai-chat/HistoryView');
      },
    });
    actionService.registerAction({
      id: 'ai-chat:open-settings',
      label: 'AI Settings',
      icon: '⚙️',
      description: 'Configure AI provider and model',
      category: 'AI Chat',
      extensionId: 'ai-chat',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        this.extensionManager?.navigateToView('ai-chat/SettingsView');
      },
    });
  }

  private unregisterViewActions() {
    actionService.unregisterAction('ai-chat:new-chat');
    actionService.unregisterAction('ai-chat:history');
    actionService.unregisterAction('ai-chat:open-settings');
  }

  async search(query: string): Promise<any[]> {
    const results: any[] = [];
    const q = query.toLowerCase();

    if ('ai chat'.includes(q) || 'ask ai'.includes(q)) {
      results.push({
        id: 'ai-chat:open',
        title: 'AI Chat',
        description: 'Open AI conversation',
        icon: '🤖',
        command: 'open-ai-chat',
      });
    }

    if ('ai history'.includes(q) || 'past chats'.includes(q)) {
      results.push({
        id: 'ai-chat:history',
        title: 'AI History',
        description: 'View past AI conversations',
        icon: '🕒',
        command: 'ai-history',
      });
    }

    if ('ai settings'.includes(q) || 'ai config'.includes(q)) {
      results.push({
        id: 'ai-chat:settings',
        title: 'AI Settings',
        description: 'Configure AI provider and API keys',
        icon: '⚙️',
        command: 'ai-settings',
      });
    }

    return results;
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {
    if (this.inView) this.unregisterViewActions();
  }
}

export default new AIChatExtension();
export { ChatView, SettingsView, HistoryView };
