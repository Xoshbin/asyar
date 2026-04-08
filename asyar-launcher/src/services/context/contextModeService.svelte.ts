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

class ContextModeService {
  private providers = new Map<string, ContextModeProvider>();

  // Svelte 5 reactive state
  public activeContext = $state<ActiveContext | null>(null);
  public contextHint = $state<ContextHint | null>(null);
  public contextActivationId = $state<string | null>(null);
  public pinnedHintProviderId = $state<string | null>(null);

  constructor() {}

  registerProvider(provider: ContextModeProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregisterProvider(id: string): void {
    this.providers.delete(id);
    // If this provider was active, deactivate
    if (this.activeContext?.provider.id === id) {
      this.deactivate();
    }
  }

  /**
   * Force `getHint` to always return the hint for the given provider,
   * regardless of natural-language detection. Used when a feature wants
   * to prepare a query in the search bar with a specific chip waiting
   * for the user to commit via Tab.
   *
   * The pin auto-clears on `activate()`, `deactivate()`, and when the
   * launcher search bar goes empty (see searchController effect).
   *
   * Pass `null` to clear the pin explicitly.
   */
  pinHint(providerId: string | null): void {
    this.pinnedHintProviderId = providerId;
  }

  /**
   * Returns a committed context match when the user has typed a full trigger
   * word followed by a space (e.g. "Search Google test").
   */
  getMatch(text: string): ContextMatch | null {
    if (!text) return null;
    const lower = text.toLowerCase();
    let best: ContextMatch | null = null;

    for (const provider of this.providers.values()) {
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
   */
  getHint(text: string, hasResults = true): ContextHint | null {
    if (!text || text.length < 2) return null;

    // Pinned provider takes precedence over natural-language detection.
    // If the pinned provider id no longer resolves (e.g. unregistered), fall
    // through to the normal detection logic below.
    if (this.pinnedHintProviderId) {
      const pinned = this.providers.get(this.pinnedHintProviderId);
      if (pinned) {
        const type: 'ai' | 'prefix' = pinned.type === 'stream' ? 'ai' : 'prefix';
        return { provider: pinned, type };
      }
    }

    // 1. Portal-style prefix hint (strict prefix, not a full match)
    const lower = text.toLowerCase();
    const prefixMatches: ContextModeProvider[] = [];
    for (const provider of this.providers.values()) {
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
    const aiProvider = [...this.providers.values()].find(p => p.type === 'stream');
    if (!aiProvider) return null;

    // Show AI hint when query has no results OR looks like a question
    if (!hasResults || looksLikeAIQuery(text)) {
      return { provider: aiProvider, type: 'ai' };
    }

    return null;
  }

  /**
   * Activate a context mode provider by its ID.
   */
  private activatingProviderId: string | null = null;
  activate(providerId: string, initialQuery?: string): void {
    if (this.activatingProviderId === providerId) return;
    
    const provider = this.providers.get(providerId);
    if (!provider) return;
    
    this.activatingProviderId = providerId;
    try {
      this.pinnedHintProviderId = null;
      this.activeContext = { provider, query: initialQuery ?? '' };
      provider.onActivate?.(initialQuery);
    } finally {
      this.activatingProviderId = null;
    }
  }

  /**
   * Deactivate the current context mode.
   */
  deactivate(): void {
    this.pinnedHintProviderId = null;
    this.activeContext?.provider.onDeactivate?.();
    this.activeContext = null;
    this.contextHint = null;
  }

  /**
   * Update the query within the active context mode.
   */
  updateQuery(query: string): void {
    if (!this.activeContext) return;
    this.activeContext = { ...this.activeContext, query };
  }

  getActiveContext(): ActiveContext | null {
    return this.activeContext;
  }

  isActive(): boolean {
    return this.activeContext !== null;
  }

  /** Returns true if at least one streaming (AI-type) provider is registered */
  hasStreamProvider(): boolean {
    for (const p of this.providers.values()) {
      if (p.type === 'stream') return true;
    }
    return false;
  }
}

export const contextModeService = new ContextModeService();

// Legacy store exports for backward compatibility
export const contextActivationId = {
  get subscribe() {
    return (fn: (v: string | null) => void) => {
      fn(contextModeService.contextActivationId);
      return () => {};
    };
  },
  set(v: string | null) {
    contextModeService.contextActivationId = v;
  }
};

export default contextModeService;
