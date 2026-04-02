import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
import { ActionContext } from 'asyar-sdk';
import ChatView from './ChatView.svelte';
import SettingsView from './SettingsView.svelte';
import HistoryView from './HistoryView.svelte';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { aiStore } from './aiStore.svelte';
import { streamChat } from './aiService';

class AIChatExtension implements Extension {
  private inView = false;
  private extensionManager?: IExtensionManager;
  onUnload = () => {};

  async onViewSubmit(query: string): Promise<void> {
    if (this.inView && query.trim()) {
      await this.executeCommand('ask', { query });
    }
  }

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');

    // Register as context mode provider (AI chip, Tab-to-AI)
    contextModeService.registerProvider({
      id: 'ai-chat',
      triggers: ['ai', 'ask ai', 'chat'],
      display: {
        name: 'AI',
        icon: 'icon:ai-chat',
        color: '#7c3aed', // purple — visually distinct from portal blue
      },
      type: 'stream',
      onActivate: (initialQuery?: string) => {
        // Trigger the 'ask' command logic if we have an initial query.
        // If no query, just navigate to the chat view.
        if (initialQuery) {
          this.executeCommand('ask', { query: initialQuery });
        } else {
          this.extensionManager?.navigateToView('ai-chat/ChatView');
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
      // If we're opening from outside the view (e.g. selecting "Ask AI" from results),
      // start fresh. If already in the view, this is a continuous follow-up.
      if (!this.inView) {
        aiStore.clearConversation();
        // Set the context chip when opening from global search results
        contextModeService.activate('ai-chat', query);
        // Clear the search bar after passing the initial query to the AI
        contextModeService.updateQuery('');
      }
      this.extensionManager?.navigateToView('ai-chat/ChatView');
      if (query && aiStore.isConfigured) {
        const settings = aiStore.settings;
        const updatedConv = aiStore.addUserMessage(query);
        const msgId = aiStore.beginAssistantMessage();

        await streamChat(updatedConv.messages, settings, {
          onToken: (token) => aiStore.appendStreamToken(msgId, token),
          onDone: () => aiStore.finalizeAssistantMessage(msgId),
          onError: (err) => aiStore.failAssistantMessage(msgId, `⚠️ ${err}`),
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
        aiStore.clearConversation();
        this.extensionManager?.navigateToView('ai-chat/ChatView');
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
      icon: 'icon:settings',
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


  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {
    if (this.inView) this.unregisterViewActions();
  }
}

export default new AIChatExtension();
export { ChatView, SettingsView, HistoryView };
