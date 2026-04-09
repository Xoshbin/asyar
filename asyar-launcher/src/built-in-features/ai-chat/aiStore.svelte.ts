import { createPersistence } from '../../lib/persistence/extensionStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'ollama' | 'openrouter' | 'custom';

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface AIConversation {
  id: string;
  messages: AIMessage[];
  createdAt: number;
  title?: string;
}

export interface AISettings {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
  temperature: number;
  maxTokens: number;
  allowExtensionUse: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
}

export const PROVIDER_MODELS: Record<AIProvider, ModelOption[]> = {
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
  ],
  google: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  ],
  ollama: [
    { id: 'llama3.2', label: 'Llama 3.2' },
    { id: 'mistral', label: 'Mistral' },
    { id: 'codellama', label: 'Code Llama' },
  ],
  openrouter: [
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
    { id: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash (free)' },
    { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1 (free)' },
    { id: 'meta-llama/llama-3.1-405b', label: 'Llama 3.1 405B' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' },
    { id: 'mistralai/mistral-7b-instruct', label: 'Mistral 7B' },
    { id: 'stepfun/step-3.5-flash:free', label: 'Step 3.5 Flash (free)' },
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
  ],
  custom: [],
};

// ─── Persistence Keys ─────────────────────────────────────────────────────────

const SETTINGS_KEY = 'asyar:ai-settings';
const HISTORY_KEY = 'asyar:ai-history';

const DEFAULT_SETTINGS: AISettings = {
  provider: 'openai',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 2048,
  allowExtensionUse: true,
};

const settingsPersistence = createPersistence<AISettings>(SETTINGS_KEY, 'ai-settings.dat');
const historyPersistence = createPersistence<AIConversation[]>(HISTORY_KEY, 'ai-history.dat');

function loadFromStorage<T>(key: string, fallback: T): T {
  // Synchronous load for initial store values (from localStorage)
  if (key === SETTINGS_KEY) return settingsPersistence.loadSync(fallback as any) as T;
  if (key === HISTORY_KEY) return historyPersistence.loadSync(fallback as any) as T;
  return fallback;
}

function saveToStorage(key: string, value: unknown): void {
  if (key === SETTINGS_KEY) settingsPersistence.save(value as AISettings);
  else if (key === HISTORY_KEY) historyPersistence.save(value as AIConversation[]);
}

export class AIStoreClass {
  // Stores → $state properties
  settings = $state<AISettings>({ ...DEFAULT_SETTINGS, ...loadFromStorage(SETTINGS_KEY, DEFAULT_SETTINGS) });
  currentConversation = $state<AIConversation | null>(null);
  conversationHistory = $state<AIConversation[]>(
    loadFromStorage<AIConversation[]>(HISTORY_KEY, []).sort((a, b) => b.createdAt - a.createdAt)
  );
  isHistoryVisible = $state<boolean>(false);
  currentStreamId = $state<string | null>(null);

  // derived → $derived
  isConfigured = $derived(
    this.settings.provider === 'ollama' || this.settings.apiKey.trim().length > 0
  );

  persistSettings(): void {
    saveToStorage(SETTINGS_KEY, $state.snapshot(this.settings) as AISettings);
  }

  persistHistory(): void {
    const history = [...this.conversationHistory]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50);
    saveToStorage(HISTORY_KEY, $state.snapshot(history) as AIConversation[]);
  }

  constructor() {
    // Persistence side effects
    $effect.root(() => {
      $effect(() => {
        this.persistSettings();
      });
      $effect(() => {
        this.persistHistory();
      });
    });

    // Async init: load from Tauri store
    (async () => {
      try {
        const settings = await settingsPersistence.load(DEFAULT_SETTINGS);
        this.settings = { ...DEFAULT_SETTINGS, ...settings };
        const history = await historyPersistence.load([]);
        this.conversationHistory = history.sort((a, b) => b.createdAt - a.createdAt);
      } catch {
        // Keep localStorage-loaded defaults
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

    // Update history immediately
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
    const msg: AIMessage = {
      id: msgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
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
    this.conversationHistory = this.conversationHistory.map(c => c.id === id ? { ...c, title } : c);
    if (this.currentConversation?.id === id) {
      this.currentConversation = { ...this.currentConversation, title };
    }
  }

  toggleHistory(force?: boolean): void {
    this.isHistoryVisible = force ?? !this.isHistoryVisible;
  }

  updateAISettings(partial: Partial<AISettings>): void {
    this.settings = { ...this.settings, ...partial };
  }
}

export const aiStore = new AIStoreClass();
