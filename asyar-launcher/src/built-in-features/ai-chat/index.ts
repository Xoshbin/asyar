import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
import { ActionContext } from 'asyar-sdk';
import ChatView from './ChatView.svelte';
import HistoryView from './HistoryView.svelte';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { aiStore } from './aiStore.svelte';
import { streamChat, stopStream } from '../../services/ai/aiEngine';
import { getProvider, listProviders, registerProvider } from '../../services/ai/providerRegistry';
import { openaiPlugin } from '../../services/ai/providers/openai';
import { anthropicPlugin } from '../../services/ai/providers/anthropic';
import { googlePlugin } from '../../services/ai/providers/google';
import { ollamaPlugin } from '../../services/ai/providers/ollama';
import { openrouterPlugin } from '../../services/ai/providers/openrouter';
import { customPlugin } from '../../services/ai/providers/custom';
import { selectionService } from '../../services/selection/selectionService';
import { settingsService } from '../../services/settings/settingsService.svelte';
import type { ProviderId } from '../../services/settings/types/AppSettingsType';

// Register all provider plugins on module load
registerProvider(openaiPlugin);
registerProvider(anthropicPlugin);
registerProvider(googlePlugin);
registerProvider(ollamaPlugin);
registerProvider(openrouterPlugin);
registerProvider(customPlugin);

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
    this.extensionManager = context.getService<IExtensionManager>('extensions');

    // Wire manifest-declared action executors. The host registered these actions
    // (with visibility callbacks) from manifest.json before initialize() runs.
    actionService.setActionExecutor('act_ai-chat_new-chat', async () => {
      aiStore.clearConversation();
      this.extensionManager?.navigateToView('ai-chat/ChatView');
    });
    actionService.setActionExecutor('act_ai-chat_view-history', async () => {
      this.extensionManager?.navigateToView('ai-chat/HistoryView');
    });
    actionService.setActionExecutor('act_ai-chat_open-settings', async () => {
      const { showSettingsWindow } = await import('../../lib/ipc/commands');
      await showSettingsWindow('ai');
    });
    actionService.setActionExecutor('act_ai-chat_ask-about-selection', async () => {
      try {
        const text = await selectionService.getSelectedText();
        if (text && text.trim()) {
          await this.executeCommand('ask', { query: text.trim() });
        }
      } catch {
        // Accessibility unavailable — silent fallback
      }
    });

    contextModeService.registerProvider({
      id: 'ai-chat',
      triggers: ['ask ai'],
      display: {
        name: 'AI',
        icon: 'icon:ai-chat',
        color: '#7c3aed',
      },
      type: 'stream',
      onActivate: (initialQuery?: string) => {
        if (initialQuery) {
          this.executeCommand('ask', { query: initialQuery });
        } else {
          this.extensionManager?.navigateToView('ai-chat/ChatView');
        }
      },
      onDeactivate: () => {},
    });
  }

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'open-ai-chat') {
      let query = args?.query as string | undefined;

      if (!query) {
        try {
          const selected = await selectionService.getSelectedText();
          if (selected && selected.trim()) {
            query = selected.trim();
          }
        } catch {
          // Accessibility unavailable — open empty
        }
      }

      if (query) {
        return this.executeCommand('ask', { query });
      }

      this.extensionManager?.navigateToView('ai-chat/ChatView');
      return { type: 'view', viewPath: 'ai-chat/ChatView' };
    }

    if (commandId === 'ai-settings') {
      const { showSettingsWindow } = await import('../../lib/ipc/commands');
      await showSettingsWindow('ai');
      return { type: 'no-view' };
    }

    if (commandId === 'ask') {
      const query: string = args?.query ?? '';
      if (!this.inView) {
        aiStore.clearConversation();
        contextModeService.activate('ai-chat', query);
        contextModeService.updateQuery('');
      }
      this.extensionManager?.navigateToView('ai-chat/ChatView');

      if (query && aiStore.isConfigured) {
        const settings = aiStore.settings;
        const activeProviderId = settings.activeProviderId!;
        const plugin = getProvider(activeProviderId);

        if (!plugin) {
          return { type: 'view', viewPath: 'ai-chat/ChatView' };
        }

        const updatedConv = aiStore.addUserMessage(query);
        const msgId = aiStore.beginAssistantMessage();
        const streamId = `chat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        aiStore.currentStreamId = streamId;

        const abortController = new AbortController();

        try {
          await streamChat(
            plugin,
            settings.providers[activeProviderId],
            updatedConv.messages,
            {
              modelId: settings.activeModelId ?? '',
              temperature: settings.temperature,
              maxTokens: settings.maxTokens,
              systemPrompt: settings.systemPrompt,
            },
            {
              onToken: (token) => aiStore.appendStreamToken(msgId, token),
              onDone: () => aiStore.finalizeAssistantMessage(msgId),
              onError: (err) => aiStore.failAssistantMessage(msgId, `⚠️ ${err}`),
            },
            abortController.signal,
            streamId,
          );
        } finally {
          aiStore.currentStreamId = null;
        }
      }
      return { type: 'view', viewPath: 'ai-chat/ChatView' };
    }

    if (commandId === 'ai-history') {
      this.extensionManager?.navigateToView('ai-chat/HistoryView');
      return { type: 'view', viewPath: 'ai-chat/HistoryView' };
    }

    if (commandId === 'switch-provider') {
      // Build a quick-pick of enabled+configured providers and their models.
      // This is a simplified version — in full UI it would open a picker.
      const { showSettingsWindow } = await import('../../lib/ipc/commands');
      await showSettingsWindow('ai');
      return { type: 'no-view' };
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
        const { showSettingsWindow } = await import('../../lib/ipc/commands');
        await showSettingsWindow('ai');
      },
    });
    actionService.registerAction({
      id: 'ai-chat:switch-provider',
      label: 'Switch Provider / Model',
      icon: '🔄',
      description: 'Change active AI provider and model',
      category: 'AI Chat',
      extensionId: 'ai-chat',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        const { showSettingsWindow } = await import('../../lib/ipc/commands');
        await showSettingsWindow('ai');
      },
    });
    actionService.registerAction({
      id: 'ai-chat:ask-about-selection',
      label: 'Ask about Selection',
      icon: '✂️',
      description: 'Read selected text and send as a new message',
      category: 'AI Chat',
      extensionId: 'ai-chat',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        try {
          const text = await selectionService.getSelectedText();
          if (text && text.trim()) {
            await this.executeCommand('ask', { query: text.trim() });
          }
        } catch {
          // Silent fallback
        }
      },
    });
  }

  private unregisterViewActions() {
    actionService.unregisterAction('ai-chat:new-chat');
    actionService.unregisterAction('ai-chat:history');
    actionService.unregisterAction('ai-chat:open-settings');
    actionService.unregisterAction('ai-chat:switch-provider');
    actionService.unregisterAction('ai-chat:ask-about-selection');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {
    if (this.inView) this.unregisterViewActions();
  }
}

export default new AIChatExtension();
export { ChatView, HistoryView };
