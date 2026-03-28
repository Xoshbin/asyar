import { writable, get } from 'svelte/store';

export const contextActivationId = writable<string | null>(null);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextModeProvider {
  id: string;
  /** Trigger words (exact, case-insensitive) that activate this context mode */
  triggers: string[];
  display: {
    name: string;
    icon: string;
    /** CSS color for the chip background. Defaults to var(--accent-primary). */
    color?: string;
  };
  /**
   * - 'url'    → activating navigates to a view or URL (Portal behavior)
   * - 'view'   → activating navigates to a view; the chip stays visible
   * - 'stream' → activating opens a streaming view (AI Chat)
   */
  type: 'url' | 'view' | 'stream';
  onActivate?: (initialQuery?: string) => void;
  onDeactivate?: () => void;
}

export interface ActiveContext {
  provider: ContextModeProvider;
  query: string;
}

export interface ContextHint {
  provider: ContextModeProvider;
  /** 'prefix' = portal-style trigger prefix match; 'ai' = natural-language intent */
  type: 'prefix' | 'ai';
}

/** Flat shape consumed by SearchHeader for the committed chip */
export interface ContextChipProps {
  id: string;
  name: string;
  icon: string;
  color?: string;
}

/** Flat shape consumed by SearchHeader for the hint chip */
export interface ContextHintProps {
  id: string;
  name: string;
  icon: string;
  type?: string;
}

interface ContextMatch {
  provider: ContextModeProvider;
  query: string;
}

// ─── Natural-language intent detection ───────────────────────────────────────

const AI_STARTERS = [
  'why', 'how', 'what', 'when', 'where', 'who',
  'can', 'could', 'should', 'would', 'will', 'is', 'are',
  'does', 'do', 'did', 'was', 'were',
  'explain', 'summarize', 'translate', 'compare', 'help',
  'write', 'generate', 'list', 'give', 'show', 'find',
];

function looksLikeAIQuery(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  if (trimmed.endsWith('?')) return true;
  const words = trimmed.split(/\s+/);
  if (words.length >= 3) return true;
  const firstWord = words[0].toLowerCase();
  return AI_STARTERS.includes(firstWord);
}

// ─── Service ──────────────────────────────────────────────────────────────────

function createContextModeService() {
  const providers = new Map<string, ContextModeProvider>();

  // Reactive stores consumed by +page.svelte and SearchHeader.svelte
  const activeContext = writable<ActiveContext | null>(null);
  const contextHint = writable<ContextHint | null>(null);

  function registerProvider(provider: ContextModeProvider): void {
    providers.set(provider.id, provider);
  }

  function unregisterProvider(id: string): void {
    providers.delete(id);
    // If this provider was active, deactivate
    const current = get(activeContext);
    if (current?.provider.id === id) {
      deactivate();
    }
  }

  /**
   * Returns a committed context match when the user has typed a full trigger
   * word followed by a space (e.g. "Search Google test").
   * Prefers longer trigger matches when multiple providers could match.
   */
  function getMatch(text: string): ContextMatch | null {
    if (!text) return null;
    const lower = text.toLowerCase();
    let best: ContextMatch | null = null;

    for (const provider of providers.values()) {
      for (const trigger of provider.triggers) {
        const t = trigger.toLowerCase();
        if (lower.startsWith(t + ' ')) {
          const query = text.slice(t.length + 1);
          if (!best || trigger.length > best.provider.triggers[0].length) {
            best = { provider, query };
          }
        }
      }
    }
    return best;
  }

  /**
   * Returns a non-committed hint chip.
   * Portal prefix hints take priority over AI intent hints.
   * Set hasResults=true when the search returned matches, so AI hint is
   * suppressed when normal results exist (unless the query clearly looks like AI).
   */
  function getHint(text: string, hasResults = true): ContextHint | null {
    if (!text || text.length < 2) return null;

    // 1. Portal-style prefix hint (strict prefix, not a full match)
    const lower = text.toLowerCase();
    const prefixMatches: ContextModeProvider[] = [];
    for (const provider of providers.values()) {
      // Only prefix-match non-AI providers (ai providers use intent detection)
      if (provider.type === 'stream') continue;
      for (const trigger of provider.triggers) {
        const t = trigger.toLowerCase();
        if (t.startsWith(lower) && t !== lower) {
          prefixMatches.push(provider);
          break;
        }
      }
    }
    if (prefixMatches.length === 1) {
      return { provider: prefixMatches[0], type: 'prefix' };
    }

    // 2. AI intent hint — find the first registered stream provider
    const aiProvider = [...providers.values()].find(p => p.type === 'stream');
    if (!aiProvider) return null;

    // Show AI hint when query has no results OR looks like a question
    if (!hasResults || looksLikeAIQuery(text)) {
      return { provider: aiProvider, type: 'ai' };
    }

    return null;
  }

  /**
   * Activate a context mode provider by its ID.
   * Called when the user presses Tab on a hint, or selects "Ask AI" result.
   */
  let activatingProviderId: string | null = null;
  function activate(providerId: string, initialQuery?: string): void {
    if (activatingProviderId === providerId) return;
    
    const provider = providers.get(providerId);
    if (!provider) return;
    
    activatingProviderId = providerId;
    try {
      activeContext.set({ provider, query: initialQuery ?? '' });
      provider.onActivate?.(initialQuery);
    } finally {
      activatingProviderId = null;
    }
  }

  /**
   * Deactivate the current context mode.
   */
  function deactivate(): void {
    const current = get(activeContext);
    current?.provider.onDeactivate?.();
    activeContext.set(null);
    contextHint.set(null);
  }

  /**
   * Update the query within the active context mode.
   */
  function updateQuery(query: string): void {
    const current = get(activeContext);
    if (!current) return;
    activeContext.set({ ...current, query });
  }

  function getActiveContext(): ActiveContext | null {
    return get(activeContext);
  }

  function isActive(): boolean {
    return get(activeContext) !== null;
  }

  /** Returns true if at least one streaming (AI-type) provider is registered */
  function hasStreamProvider(): boolean {
    for (const p of providers.values()) {
      if (p.type === 'stream') return true;
    }
    return false;
  }

  return {
    // Stores
    activeContext,
    contextHint,
    // Registration
    registerProvider,
    unregisterProvider,
    // Detection
    getMatch,
    getHint,
    // Lifecycle
    activate,
    deactivate,
    updateQuery,
    // Helpers
    getActiveContext,
    isActive,
    hasStreamProvider,
  };
}

export const contextModeService = createContextModeService();
