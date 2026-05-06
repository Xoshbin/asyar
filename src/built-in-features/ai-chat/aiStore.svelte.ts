import { createPersistence } from '../../lib/persistence/extensionStore';
import { settingsService } from '../../services/settings/settingsService.svelte';
import type { AppSettings, AISettings } from '../../services/settings/types/AppSettingsType';
import type { ProviderId } from '../../services/settings/types/AppSettingsType';
import { secretRedactionService } from '../../services/privacy/secretRedactionService.svelte';
import { encryptionService } from '../../services/privacy/encryptionService.svelte';

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
  /**
   * Set when the secret redactor matched substrings in this message's
   * content at append time. Each entry is a kind name from the bundled
   * detector catalog. The original (pre-redaction) text is not stored —
   * `content` is the redacted form, which is also what was sent to the
   * provider.
   */
  redactedKinds?: string[];
}

export interface AIConversation {
  id: string;
  messages: AIMessage[];
  createdAt: number;
  title?: string;
}

// ─── Persistence (history only — settings owned by settingsService) ───────────

// AI conversation history is encrypted at rest (Layer 3). The persistence
// layer stores a single ciphertext string under `HISTORY_KEY`; we
// JSON-serialise the whole conversation array, hand the plaintext to
// `cryptoEncrypt` (which holds the master key host-side), and store the
// returned `enc:v1:` blob. Pre-Layer-3 plaintext-array values that exist
// from older builds fail to decrypt and are returned as the empty
// fallback — beta-phase clean break per the privacy spec.
const HISTORY_KEY = 'asyar:ai-history';
const historyPersistence = createPersistence<string>(HISTORY_KEY, 'ai-history.dat');

async function loadEncryptedHistory(): Promise<AIConversation[]> {
  const raw = await historyPersistence.load('');
  if (!raw) return [];
  const plaintext = await encryptionService.decrypt(raw);
  if (!plaintext) return [];
  try {
    const parsed = JSON.parse(plaintext) as AIConversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveEncryptedHistory(history: AIConversation[]): Promise<void> {
  const json = JSON.stringify(history);
  const ciphertext = await encryptionService.encrypt(json);
  if (!ciphertext) return; // host failed; keep the previous on-disk state
  await historyPersistence.save(ciphertext);
}

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * Local change event for AI conversations. Used by the cloud sync delta
 * provider to mark items dirty for the next push tick.
 */
export type AIConversationsChangeEvent =
  | { type: 'upsert'; itemId: string }
  | { type: 'delete'; itemId: string };

export class AIStoreClass {
  // Settings are owned by settingsService — no own persistence
  get settings(): AISettings {
    return settingsService.currentSettings.ai;
  }

  currentConversation = $state<AIConversation | null>(null);
  // Sync load returns the empty fallback — encrypted history loads
  // asynchronously in the constructor below.
  conversationHistory = $state<AIConversation[]>([]);
  isHistoryVisible = $state<boolean>(false);
  currentStreamId = $state<string | null>(null);

  // Hand-rolled subscriber list for `conversationHistory` deltas. Mutators
  // that bypass `#notifyConversationChange` will still update the reactive
  // state (UI reflects them), but the cloud sync journal won't see the
  // change. Keep all conversation upserts/deletes routed through the
  // helpers below so the contract holds.
  #conversationSubscribers = new Set<(event: AIConversationsChangeEvent) => void>();

  subscribeToConversationChanges(
    callback: (event: AIConversationsChangeEvent) => void
  ): () => void {
    this.#conversationSubscribers.add(callback);
    return () => {
      this.#conversationSubscribers.delete(callback);
    };
  }

  #notifyConversationChange(event: AIConversationsChangeEvent): void {
    this.#conversationSubscribers.forEach((cb) => {
      try {
        cb(event);
      } catch {
        // Swallow subscriber errors so one broken consumer can't block others.
      }
    });
  }

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
    void saveEncryptedHistory($state.snapshot(history) as AIConversation[]);
  }

  constructor() {
    $effect.root(() => {
      $effect(() => {
        this.persistHistory();
      });
    });
  }

  /**
   * Load encrypted history from disk. Called explicitly by
   * `appInitializer` so module-load happens without firing any
   * environment-dependent IPC — keeping import-time side effects
   * predictable for unrelated tests.
   */
  async loadHistory(): Promise<void> {
    try {
      const history = await loadEncryptedHistory();
      this.conversationHistory = history.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      // Keep the empty default
    }
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

  async addUserMessage(content: string): Promise<AIConversation> {
    // Redact at the boundary between user input and storage. The redacted
    // content is also what the AI provider receives — see the `streamChat`
    // call site, which passes `conv.messages` straight through.
    const redaction = await secretRedactionService.redactIfEnabled(
      'aiConversations',
      content,
    );
    const finalContent = redaction?.content ?? content;
    const redactedKinds = redaction?.kinds.length ? redaction.kinds : undefined;

    let conv = this.currentConversation;

    if (!conv) {
      conv = {
        id: this.generateId(),
        messages: [],
        createdAt: Date.now(),
        title: finalContent.slice(0, 60) + (finalContent.length > 60 ? '…' : ''),
      };
    }

    const msg: AIMessage = {
      id: this.generateId(),
      role: 'user',
      content: finalContent,
      timestamp: Date.now(),
      isStreaming: false,
      redactedKinds,
    };

    const updatedConv = { ...conv, messages: [...conv.messages, msg] };

    if (!updatedConv.title) {
      updatedConv.title = finalContent.slice(0, 60) + (finalContent.length > 60 ? '…' : '');
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
    this.#notifyConversationChange({ type: 'upsert', itemId: updatedConv.id });

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
      this.#notifyConversationChange({ type: 'upsert', itemId: conv.id });
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
    this.#notifyConversationChange({ type: 'delete', itemId: id });
  }

  updateConversationTitle(id: string, title: string): void {
    this.conversationHistory = this.conversationHistory.map(c =>
      c.id === id ? { ...c, title } : c
    );
    if (this.currentConversation?.id === id) {
      this.currentConversation = { ...this.currentConversation, title };
    }
    this.#notifyConversationChange({ type: 'upsert', itemId: id });
  }

  toggleHistory(force?: boolean): void {
    this.isHistoryVisible = force ?? !this.isHistoryVisible;
  }

  updateAISettings(partial: Partial<AISettings>): void {
    settingsService.updateSettings('ai', partial);
  }
}

export const aiStore = new AIStoreClass();
