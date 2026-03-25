import { writable, get, derived } from 'svelte/store';

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
};

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && !Array.isArray(fallback)) {
      return { ...fallback, ...parsed };
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable in some Tauri contexts
  }
}

// ─── Stores ───────────────────────────────────────────────────────────────────

export const aiSettings = writable<AISettings>(loadFromStorage(SETTINGS_KEY, DEFAULT_SETTINGS));
aiSettings.subscribe(v => saveToStorage(SETTINGS_KEY, v));

export const currentConversation = writable<AIConversation | null>(null);

export const conversationHistory = writable<AIConversation[]>(
  loadFromStorage<AIConversation[]>(HISTORY_KEY, [])
    .sort((a, b) => b.createdAt - a.createdAt)
);
conversationHistory.subscribe(v => {
  // Keep max 50 conversations, sorted by date descending
  const history = [...v].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  saveToStorage(HISTORY_KEY, history);
});

export const isHistoryVisible = writable<boolean>(false);

/** True when the extension is configured and ready to use */
export const isConfigured = derived(aiSettings, $s =>
  $s.provider === 'ollama' || $s.apiKey.trim().length > 0
);

// ─── Actions ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a new conversation, optionally with an initial user message */
export function startConversation(initialMessage?: string): AIConversation {
  const conv: AIConversation = {
    id: generateId(),
    messages: [],
    createdAt: Date.now(),
    title: undefined,
  };
  if (initialMessage) {
    conv.messages.push({
      id: generateId(),
      role: 'user',
      content: initialMessage,
      timestamp: Date.now(),
    });
    // Derive title from the first message
    conv.title = initialMessage.slice(0, 60) + (initialMessage.length > 60 ? '…' : '');
  }
  currentConversation.set(conv);
  return conv;
}

/** Add a user message to the current or new conversation */
export function addUserMessage(content: string): AIConversation {
  let conv = get(currentConversation);
  let isNew = false;
  
  if (!conv) {
    conv = {
      id: generateId(),
      messages: [],
      createdAt: Date.now(),
      title: content.slice(0, 60) + (content.length > 60 ? '…' : ''),
    };
    isNew = true;
  }

  const msg: AIMessage = {
    id: generateId(),
    role: 'user',
    content,
    timestamp: Date.now(),
    isStreaming: false,
  };

  const updatedConv = { ...conv, messages: [...conv.messages, msg] };
  
  if (!updatedConv.title) {
    updatedConv.title = content.slice(0, 60) + (content.length > 60 ? '…' : '');
  }

  currentConversation.set(updatedConv);

  // Update history immediately so the conversation is tracked
  conversationHistory.update(h => {
    const idx = h.findIndex(c => c.id === updatedConv.id);
    if (idx >= 0) {
      const newHistory = [...h];
      newHistory[idx] = updatedConv;
      return newHistory;
    }
    return [updatedConv, ...h];
  });

  return updatedConv;
}

/** Add an empty streaming assistant message (call appendStreamToken to fill it) */
export function beginAssistantMessage(): string {
  const msgId = generateId();
  const msg: AIMessage = {
    id: msgId,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true,
  };
  currentConversation.update(conv => {
    if (!conv) return conv;
    return { ...conv, messages: [...conv.messages, msg] };
  });
  return msgId;
}

/** Append a streaming token to the message with the given id */
export function appendStreamToken(msgId: string, token: string): void {
  currentConversation.update(conv => {
    if (!conv) return conv;
    return {
      ...conv,
      messages: conv.messages.map(m =>
        m.id === msgId ? { ...m, content: m.content + token } : m
      ),
    };
  });
}

/** Mark the streaming message as complete */
export function finalizeAssistantMessage(msgId: string): void {
  currentConversation.update(conv => {
    if (!conv) return conv;
    return {
      ...conv,
      messages: conv.messages.map(m =>
        m.id === msgId ? { ...m, isStreaming: false } : m
      ),
    };
  });
  // Archive in history
  const conv = get(currentConversation);
  if (conv) {
    conversationHistory.update(h => {
      const idx = h.findIndex(c => c.id === conv.id);
      return idx >= 0
        ? h.map((c, i) => (i === idx ? conv : c))
        : [...h, conv];
    });
  }
}

/** Clear the assistant's streaming message on error */
export function failAssistantMessage(msgId: string, errorText: string): void {
  currentConversation.update(conv => {
    if (!conv) return conv;
    return {
      ...conv,
      messages: conv.messages.map(m =>
        m.id === msgId ? { ...m, content: errorText, isStreaming: false } : m
      ),
    };
  });
}

/** Clear the current conversation (start fresh) */
export function clearConversation(): void {
  currentConversation.set(null);
}

/** Load a conversation from history */
export function loadConversation(id: string): void {
  const history = get(conversationHistory);
  const conv = history.find(c => c.id === id);
  if (conv) {
    currentConversation.set({ ...conv });
  }
}

/** Delete a conversation from history */
export function deleteConversation(id: string): void {
  conversationHistory.update(h => h.filter(c => c.id !== id));
  const current = get(currentConversation);
  if (current?.id === id) {
    currentConversation.set(null);
  }
}

/** Rename a conversation */
export function updateConversationTitle(id: string, title: string): void {
  conversationHistory.update(h => h.map(c => c.id === id ? { ...c, title } : c));
  const current = get(currentConversation);
  if (current?.id === id) {
    currentConversation.update(c => c ? { ...c, title } : c);
  }
}

/** Toggle history sidebar visibility */
export function toggleHistory(force?: boolean): void {
  isHistoryVisible.update(v => force ?? !v);
}

/** Update AI settings */
export function updateAISettings(partial: Partial<AISettings>): void {
  aiSettings.update(s => ({ ...s, ...partial }));
}
