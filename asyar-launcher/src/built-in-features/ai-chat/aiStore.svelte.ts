import { createPersistence } from '../../lib/persistence/extensionStore';
import { settingsService } from '../../services/settings/settingsService.svelte';
import type { AppSettings, AISettings } from '../../services/settings/types/AppSettingsType';
import type { ProviderId } from '../../services/settings/types/AppSettingsType';

export type { AISettings, ProviderId };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  /** The provider used for this assistant message */
  providerId?: ProviderId;
  /** The model used for this assistant message */
  modelId?: string;
}

export interface AIConversation {
  id: string;
  messages: AIMessage[];
  createdAt: number;
  title?: string;
}

// ─── Persistence (history only — settings owned by settingsService) ───────────

const HISTORY_KEY = 'asyar:ai-history';
const historyPersistence = createPersistence<AIConversation[]>(HISTORY_KEY, 'ai-history.dat');

// ─── Store ────────────────────────────────────────────────────────────────────

export class AIStoreClass {
  // Settings are owned by settingsService — no own persistence
  get settings(): AISettings {
    return settingsService.currentSettings.ai;
  }

  currentConversation = $state<AIConversation | null>(null);
  conversationHistory = $state<AIConversation[]>(
    historyPersistence.loadSync([]).sort((a, b) => b.createdAt - a.createdAt)
  );
  isHistoryVisible = $state<boolean>(false);
  currentStreamId = $state<string | null>(null);

  isConfigured = $derived((() => {
    const ai = settingsService.currentSettings.ai;
    if (!ai.activeProviderId) return false;
    const config = ai.providers[ai.activeProviderId];
    if (!config?.enabled) return false;
    // Ollama doesn't require an API key
    if (ai.activeProviderId === 'ollama') return true;
    // Custom doesn't require an API key either (it's optional)
    if (ai.activeProviderId === 'custom') return !!(config.baseUrl?.trim());
    return !!(config.apiKey?.trim());
  })());

  persistHistory(): void {
    const history = [...this.conversationHistory]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50);
    historyPersistence.save($state.snapshot(history) as AIConversation[]);
  }

  constructor() {
    $effect.root(() => {
      $effect(() => {
        this.persistHistory();
      });
    });

    (async () => {
      try {
        const history = await historyPersistence.load([]);
        this.conversationHistory = history.sort((a, b) => b.createdAt - a.createdAt);
      } catch {
        // Keep loadSync defaults
      }
    })();
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  startConversation(initialMessage?: string): AIConversation {
    const conv: AIConversation = {
      id: this.generateId(),
      messages: [],
      createdAt: Date.now(),
      title: undefined,
    };
    if (initialMessage) {
      conv.messages.push({
        id: this.generateId(),
        role: 'user',
        content: initialMessage,
        timestamp: Date.now(),
      });
      conv.title = initialMessage.slice(0, 60) + (initialMessage.length > 60 ? '…' : '');
    }
    this.currentConversation = conv;
    return conv;
  }

  addUserMessage(content: string): AIConversation {
    let conv = this.currentConversation;

    if (!conv) {
      conv = {
        id: this.generateId(),
        messages: [],
        createdAt: Date.now(),
        title: content.slice(0, 60) + (content.length > 60 ? '…' : ''),
      };
    }

    const msg: AIMessage = {
      id: this.generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
      isStreaming: false,
    };

    const updatedConv = { ...conv, messages: [...conv.messages, msg] };

    if (!updatedConv.title) {
      updatedConv.title = content.slice(0, 60) + (content.length > 60 ? '…' : '');
    }

    this.currentConversation = updatedConv;

    const idx = this.conversationHistory.findIndex(c => c.id === updatedConv.id);
    if (idx >= 0) {
      const newHistory = [...this.conversationHistory];
      newHistory[idx] = updatedConv;
      this.conversationHistory = newHistory;
    } else {
      this.conversationHistory = [updatedConv, ...this.conversationHistory];
    }

    return updatedConv;
  }

  beginAssistantMessage(): string {
    const msgId = this.generateId();
    const ai = this.settings;
    const msg: AIMessage = {
      id: msgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      // Snapshot active provider/model at message creation time
      providerId: ai.activeProviderId ?? undefined,
      modelId: ai.activeModelId ?? undefined,
    };
    if (this.currentConversation) {
      this.currentConversation = {
        ...this.currentConversation,
        messages: [...this.currentConversation.messages, msg],
      };
    }
    return msgId;
  }

  appendStreamToken(msgId: string, token: string): void {
    if (this.currentConversation) {
      this.currentConversation = {
        ...this.currentConversation,
        messages: this.currentConversation.messages.map(m =>
          m.id === msgId ? { ...m, content: m.content + token } : m
        ),
      };
    }
  }

  finalizeAssistantMessage(msgId: string): void {
    if (this.currentConversation) {
      this.currentConversation = {
        ...this.currentConversation,
        messages: this.currentConversation.messages.map(m =>
          m.id === msgId ? { ...m, isStreaming: false } : m
        ),
      };

      const conv = this.currentConversation;
      const idx = this.conversationHistory.findIndex(c => c.id === conv.id);
      if (idx >= 0) {
        this.conversationHistory = this.conversationHistory.map((c, i) => (i === idx ? conv : c));
      } else {
        this.conversationHistory = [...this.conversationHistory, conv];
      }
    }
  }

  failAssistantMessage(msgId: string, errorText: string): void {
    if (this.currentConversation) {
      this.currentConversation = {
        ...this.currentConversation,
        messages: this.currentConversation.messages.map(m =>
          m.id === msgId ? { ...m, content: errorText, isStreaming: false } : m
        ),
      };
    }
  }

  clearConversation(): void {
    this.currentConversation = null;
  }

  loadConversation(id: string): void {
    const conv = this.conversationHistory.find(c => c.id === id);
    if (conv) {
      this.currentConversation = { ...conv };
    }
  }

  deleteConversation(id: string): void {
    this.conversationHistory = this.conversationHistory.filter(c => c.id !== id);
    if (this.currentConversation?.id === id) {
      this.currentConversation = null;
    }
  }

  updateConversationTitle(id: string, title: string): void {
    this.conversationHistory = this.conversationHistory.map(c =>
      c.id === id ? { ...c, title } : c
    );
    if (this.currentConversation?.id === id) {
      this.currentConversation = { ...this.currentConversation, title };
    }
  }

  toggleHistory(force?: boolean): void {
    this.isHistoryVisible = force ?? !this.isHistoryVisible;
  }

  updateAISettings(partial: Partial<AISettings>): void {
    settingsService.updateSettings('ai', partial);
  }
}

export const aiStore = new AIStoreClass();
