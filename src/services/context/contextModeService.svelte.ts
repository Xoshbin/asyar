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

// ─── Service ──────────────────────────────────────────────────────────────────

class ContextModeService {
  private providers = new Map<string, ContextModeProvider>();

  // Svelte 5 reactive state
  public activeContext = $state<ActiveContext | null>(null);
  public contextHint = $state<ContextHint | null>(null);
  public contextActivationId = $state<string | null>(null);
  public pinnedHintProviderId = $state<string | null>(null);
  /** Reactive version counter — bumps on every register/unregister so reactive
   * consumers of getHint() re-run when the provider set changes. Fixes a startup
   * race where the AI chip doesn't appear because the agents extension registers
   * its stream provider after the first effect run. */
  public providersVersion = $state(0);

  constructor() {}

  registerProvider(provider: ContextModeProvider): void {
    this.providers.set(provider.id, provider);
    this.providersVersion++;
  }

  unregisterProvider(id: string): void {
    this.providers.delete(id);
    this.providersVersion++;
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
    // Tell reactive consumers to depend on the provider set.
    void this.providersVersion;
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
   *
   * Priority order:
   * 1. Pinned hint provider (if still registered).
   * 2. Single prefix match over non-stream providers (portal-style).
   * 3. First registered stream provider — always offered as the AI default.
   */
  getHint(text: string): ContextHint | null {
    // Tell reactive consumers to depend on the provider set so they re-run
    // when a new provider registers (e.g. agents extension after launcher mount).
    void this.providersVersion;
    // Pinned provider takes precedence over prefix and AI detection.
    // If the pinned provider id no longer resolves (e.g. unregistered), fall
    // through to the normal detection logic below.
    if (this.pinnedHintProviderId) {
      const pinned = this.providers.get(this.pinnedHintProviderId);
      if (pinned) {
        const type: 'ai' | 'prefix' = pinned.type === 'stream' ? 'ai' : 'prefix';
        return { provider: pinned, type };
      }
    }

    // Portal-style prefix hint (strict prefix, not a full match).
    // Only applies when text is non-empty.
    if (text) {
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
    }

    // AI default — always offer the first registered stream provider.
    const aiProvider = [...this.providers.values()].find(p => p.type === 'stream');
    if (!aiProvider) return null;
    return { provider: aiProvider, type: 'ai' };
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
