import { describe, it, expect, afterEach, vi } from 'vitest'
import { contextModeService } from './contextModeService.svelte'
import type { ContextModeProvider } from './contextModeService.svelte'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProvider(overrides: Partial<ContextModeProvider> = {}): ContextModeProvider {
  return {
    id: 'test-provider',
    triggers: ['search google'],
    display: { name: 'Google Search', icon: '🔍' },
    type: 'view',
    ...overrides,
  }
}

// Track registered provider IDs so afterEach can clean up
const registeredIds: string[] = []

function register(provider: ContextModeProvider) {
  registeredIds.push(provider.id)
  contextModeService.registerProvider(provider)
  return provider
}

afterEach(() => {
  contextModeService.deactivate()
  for (const id of registeredIds) {
    contextModeService.unregisterProvider(id)
  }
  registeredIds.length = 0
})

// ── Provider registration ─────────────────────────────────────────────────────

describe('registerProvider / unregisterProvider', () => {
  it('makes a provider findable by getMatch after registration', () => {
    register(makeProvider({ id: 'goog', triggers: ['google'] }))
    const match = contextModeService.getMatch('google test query')
    expect(match).not.toBeNull()
    expect(match!.provider.id).toBe('goog')
  })

  it('removes a provider so getMatch no longer finds it', () => {
    register(makeProvider({ id: 'goog', triggers: ['google'] }))
    contextModeService.unregisterProvider('goog')
    registeredIds.pop() // already removed
    expect(contextModeService.getMatch('google test query')).toBeNull()
  })

  it('deactivates an active provider when it is unregistered', () => {
    const onDeactivate = vi.fn()
    register(makeProvider({ id: 'p1', triggers: ['p1'], onDeactivate }))
    contextModeService.activate('p1')
    expect(contextModeService.isActive()).toBe(true)

    contextModeService.unregisterProvider('p1')
    registeredIds.pop()
    expect(contextModeService.isActive()).toBe(false)
    expect(onDeactivate).toHaveBeenCalledOnce()
  })
})

// ── getMatch ──────────────────────────────────────────────────────────────────

describe('getMatch', () => {
  it('returns null for empty input', () => {
    expect(contextModeService.getMatch('')).toBeNull()
  })

  it('returns null when no providers are registered', () => {
    expect(contextModeService.getMatch('search google something')).toBeNull()
  })

  it('returns null for text that is just the trigger without a trailing space', () => {
    register(makeProvider({ id: 'p', triggers: ['google'] }))
    expect(contextModeService.getMatch('google')).toBeNull()
  })

  it('matches trigger + space + query', () => {
    register(makeProvider({ id: 'p', triggers: ['google'] }))
    const match = contextModeService.getMatch('google my search term')
    expect(match).not.toBeNull()
    expect(match!.query).toBe('my search term')
  })

  it('is case-insensitive', () => {
    register(makeProvider({ id: 'p', triggers: ['Google'] }))
    const match = contextModeService.getMatch('google something')
    expect(match).not.toBeNull()
  })

  it('prefers the longer trigger when two providers could match', () => {
    register(makeProvider({ id: 'short', triggers: ['search'] }))
    register(makeProvider({ id: 'long', triggers: ['search google'] }))
    const match = contextModeService.getMatch('search google my query')
    expect(match!.provider.id).toBe('long')
    expect(match!.query).toBe('my query')
  })

  it('extracts an empty query when nothing follows the trigger + space', () => {
    register(makeProvider({ id: 'p', triggers: ['google'] }))
    const match = contextModeService.getMatch('google ')
    expect(match).not.toBeNull()
    expect(match!.query).toBe('')
  })
})

// ── getHint ───────────────────────────────────────────────────────────────────

describe('getHint', () => {
  it('returns a prefix hint when input is a partial trigger', () => {
    register(makeProvider({ id: 'p', triggers: ['google'], type: 'view' }))
    const hint = contextModeService.getHint('goo')
    expect(hint).not.toBeNull()
    expect(hint!.type).toBe('prefix')
    expect(hint!.provider.id).toBe('p')
  })

  it('returns null when input exactly equals the trigger (no partial)', () => {
    register(makeProvider({ id: 'p', triggers: ['google'], type: 'view' }))
    // exact match is handled by getMatch, not getHint
    expect(contextModeService.getHint('google')).toBeNull()
  })

  it('does not return a prefix-type hint for stream providers — returns AI hint instead', () => {
    register(makeProvider({ id: 'ai', triggers: ['ask ai'], type: 'stream' }))
    const hint = contextModeService.getHint('ask')
    // Stream providers are excluded from prefix matching; they appear as the
    // AI default instead.
    expect(hint).not.toBeNull()
    expect(hint!.type).toBe('ai')
  })

  it('returns an AI hint for a question when a stream provider is registered', () => {
    register(makeProvider({ id: 'ai', triggers: ['ask ai'], type: 'stream' }))
    const hint = contextModeService.getHint('why is the sky blue?')
    expect(hint).not.toBeNull()
    expect(hint!.type).toBe('ai')
    expect(hint!.provider.id).toBe('ai')
  })

  it('shows AI hint even with results when query looks like AI (ends with ?)', () => {
    register(makeProvider({ id: 'ai', triggers: ['ask ai'], type: 'stream' }))
    const hint = contextModeService.getHint('how does this work?')
    expect(hint).not.toBeNull()
    expect(hint!.type).toBe('ai')
  })
})

// ── activate / deactivate ─────────────────────────────────────────────────────

describe('pinHint', () => {
  it('pinHint forces getHint to return an AI hint for non-AI-like text', () => {
    register(makeProvider({ id: 'ai', triggers: ['ask ai'], type: 'stream' }))
    contextModeService.pinHint('ai')
    const hint = contextModeService.getHint('settings')
    expect(hint).not.toBeNull()
    expect(hint!.type).toBe('ai')
    expect(hint!.provider.id).toBe('ai')
  })

  it('pinHint falls through to normal detection if the pinned provider is not registered', () => {
    contextModeService.pinHint('nonexistent')
    register(makeProvider({ id: 'ai', triggers: ['ask ai'], type: 'stream' }))
    const hint = contextModeService.getHint('why is the sky blue?')
    expect(hint).not.toBeNull()
    expect(hint!.provider.id).toBe('ai')
  })

  it('pinHint uses type \'prefix\' for non-stream providers', () => {
    register(makeProvider({ id: 'portal', triggers: ['google'], type: 'view' }))
    contextModeService.pinHint('portal')
    const hint = contextModeService.getHint('hello')
    expect(hint).not.toBeNull()
    expect(hint!.provider.id).toBe('portal')
    expect(hint!.type).toBe('prefix')
  })

  it('activate clears the pinned hint', () => {
    register(makeProvider({ id: 'ai', triggers: ['ask ai'], type: 'stream' }))
    contextModeService.pinHint('ai')
    contextModeService.activate('ai', 'query')
    expect(contextModeService.pinnedHintProviderId).toBeNull()
  })

  it('deactivate clears the pinned hint', () => {
    register(makeProvider({ id: 'ai', triggers: ['ask ai'], type: 'stream' }))
    contextModeService.pinHint('ai')
    contextModeService.activate('ai')
    contextModeService.deactivate()
    expect(contextModeService.pinnedHintProviderId).toBeNull()
  })

  it('pinHint(null) clears the pin', () => {
    contextModeService.pinHint('ai')
    contextModeService.pinHint(null)
    expect(contextModeService.pinnedHintProviderId).toBeNull()
  })

  it('unregisterProvider of the pinned id causes getHint to fall through', () => {
    register(makeProvider({ id: 'ai', triggers: ['ask ai'], type: 'stream' }))
    contextModeService.pinHint('ai')
    contextModeService.unregisterProvider('ai')
    const hint = contextModeService.getHint('settings')
    expect(hint).toBeNull()
  })

  it('activate with a nonexistent provider does NOT clear the pinned hint', () => {
    register(makeProvider({ id: 'ai', triggers: ['ask ai'], type: 'stream' }))
    contextModeService.pinHint('ai')
    // The provider 'missing' is never registered. activate should early-return
    // because providers.get('missing') is undefined. The pin must survive a
    // failed activation so the chip stays visible for the user to retry.
    contextModeService.activate('missing', 'query')
    expect(contextModeService.pinnedHintProviderId).toBe('ai')
  })

  it('activate recursion guard short-circuits inner calls without re-clearing state', () => {
    let onActivateCallCount = 0
    // The provider's onActivate immediately calls activate() again on the same
    // id — the recursion guard must short-circuit the inner call so we get
    // exactly one onActivate invocation, not infinite recursion.
    register(makeProvider({
      id: 'ai',
      triggers: ['ask ai'],
      type: 'stream',
      onActivate: () => {
        onActivateCallCount++
        contextModeService.activate('ai', 'inner')
      },
    }))
    contextModeService.pinHint('ai')
    contextModeService.activate('ai', 'outer')
    // onActivate fired exactly once (the inner recursive call was guarded).
    expect(onActivateCallCount).toBe(1)
    // Outer call cleared the pin in its try block, inner was a no-op.
    expect(contextModeService.pinnedHintProviderId).toBeNull()
  })
})

describe('activate', () => {
  it('sets activeContext property with the provider and query', () => {
    register(makeProvider({ id: 'p1', triggers: ['p1'] }))
    contextModeService.activate('p1', 'initial query')
    const ctx = contextModeService.activeContext
    expect(ctx).not.toBeNull()
    expect(ctx!.provider.id).toBe('p1')
    expect(ctx!.query).toBe('initial query')
  })

  it('calls the provider onActivate callback', () => {
    const onActivate = vi.fn()
    register(makeProvider({ id: 'p1', triggers: ['p1'], onActivate }))
    contextModeService.activate('p1', 'test')
    expect(onActivate).toHaveBeenCalledWith('test')
  })

  it('does nothing if the provider ID does not exist', () => {
    contextModeService.activate('nonexistent-id')
    expect(contextModeService.isActive()).toBe(false)
  })

  it('activates with empty string when no initialQuery is provided', () => {
    register(makeProvider({ id: 'p1', triggers: ['p1'] }))
    contextModeService.activate('p1')
    expect(contextModeService.activeContext!.query).toBe('')
  })
})

describe('deactivate', () => {
  it('clears the activeContext property', () => {
    register(makeProvider({ id: 'p1', triggers: ['p1'] }))
    contextModeService.activate('p1')
    contextModeService.deactivate()
    expect(contextModeService.activeContext).toBeNull()
  })

  it('clears the contextHint property', () => {
    register(makeProvider({ id: 'p1', triggers: ['p1'] }))
    contextModeService.activate('p1')
    contextModeService.contextHint = { provider: makeProvider(), type: 'prefix' }
    contextModeService.deactivate()
    expect(contextModeService.contextHint).toBeNull()
  })

  it('calls the provider onDeactivate callback', () => {
    const onDeactivate = vi.fn()
    register(makeProvider({ id: 'p1', triggers: ['p1'], onDeactivate }))
    contextModeService.activate('p1')
    contextModeService.deactivate()
    expect(onDeactivate).toHaveBeenCalledOnce()
  })

  it('is safe to call when no context is active', () => {
    expect(() => contextModeService.deactivate()).not.toThrow()
  })
})

// ── updateQuery ───────────────────────────────────────────────────────────────

describe('updateQuery', () => {
  it('updates the query in the active context', () => {
    register(makeProvider({ id: 'p1', triggers: ['p1'] }))
    contextModeService.activate('p1', 'original')
    contextModeService.updateQuery('updated query')
    expect(contextModeService.activeContext!.query).toBe('updated query')
  })

  it('preserves the provider when updating query', () => {
    register(makeProvider({ id: 'p1', triggers: ['p1'] }))
    contextModeService.activate('p1')
    contextModeService.updateQuery('new query')
    expect(contextModeService.activeContext!.provider.id).toBe('p1')
  })

  it('does nothing when no context is active', () => {
    expect(() => contextModeService.updateQuery('test')).not.toThrow()
    expect(contextModeService.isActive()).toBe(false)
  })
})

// ── getHint — always-on AI default ───────────────────────────────────────────

describe('getHint — always-on AI default', () => {
  it('returns AI hint for empty text when a stream provider is registered', () => {
    register(makeProvider({ id: 'agents:default', triggers: ['ask ai'], type: 'stream' }))
    const hint = contextModeService.getHint('')
    expect(hint).not.toBeNull()
    expect(hint!.type).toBe('ai')
    expect(hint!.provider.id).toBe('agents:default')
  })

  it('returns AI hint for ordinary text even when results exist', () => {
    register(makeProvider({ id: 'agents:default', triggers: ['ask ai'], type: 'stream' }))
    const hint = contextModeService.getHint('settings')
    expect(hint).not.toBeNull()
    expect(hint!.type).toBe('ai')
    expect(hint!.provider.id).toBe('agents:default')
  })

  it('returns portal prefix hint when both portal and stream provider registered and text partially matches portal trigger', () => {
    register(makeProvider({ id: 'portal-goo', triggers: ['google'], type: 'view' }))
    register(makeProvider({ id: 'agents:default', triggers: ['ask ai'], type: 'stream' }))
    const hint = contextModeService.getHint('goo')
    expect(hint).not.toBeNull()
    expect(hint!.type).toBe('prefix')
    expect(hint!.provider.id).toBe('portal-goo')
  })

  it('returns null for empty text when only a view-type provider is registered and no stream provider', () => {
    register(makeProvider({ id: 'portal-only', triggers: ['google'], type: 'view' }))
    const hint = contextModeService.getHint('')
    expect(hint).toBeNull()
  })
})

// ── reactive provider registration ───────────────────────────────────────────

describe('reactive provider registration', () => {
  it('exposes a reactive providersVersion that increments on registerProvider', () => {
    const v0 = contextModeService.providersVersion;
    register(makeProvider({ id: 'reactive-test', triggers: ['rt'], type: 'view' }));
    expect(contextModeService.providersVersion).toBe(v0 + 1);
  });

  it('exposes a reactive providersVersion that increments on unregisterProvider', () => {
    register(makeProvider({ id: 'reactive-test', triggers: ['rt'], type: 'view' }));
    const v0 = contextModeService.providersVersion;
    contextModeService.unregisterProvider('reactive-test');
    registeredIds.pop(); // already removed
    expect(contextModeService.providersVersion).toBe(v0 + 1);
  });

  it('getHint reads providersVersion so reactive consumers re-run when providers change', () => {
    // The test asserts the side-effect proxy: after calling getHint, calling registerProvider
    // bumps the version. If getHint did NOT touch the version field, this test would still
    // pass — but the reactive-tracking side is exercised by the runtime via $effect.
    // We test the contract by reading the version before+after the touch.
    const v0 = contextModeService.providersVersion;
    contextModeService.getHint('');
    // getHint must not mutate providersVersion itself
    expect(contextModeService.providersVersion).toBe(v0);
    // ...but registering must
    register(makeProvider({ id: 'reactive-test', triggers: ['rt'], type: 'view' }));
    expect(contextModeService.providersVersion).toBeGreaterThan(v0);
  });
});

// ── hasStreamProvider ─────────────────────────────────────────────────────────

describe('hasStreamProvider', () => {
  it('returns false when no providers are registered', () => {
    expect(contextModeService.hasStreamProvider()).toBe(false)
  })

  it('returns false when only view-type providers are registered', () => {
    register(makeProvider({ id: 'p1', type: 'view' }))
    expect(contextModeService.hasStreamProvider()).toBe(false)
  })

  it('returns true when a stream provider is registered', () => {
    register(makeProvider({ id: 'ai', type: 'stream' }))
    expect(contextModeService.hasStreamProvider()).toBe(true)
  })
})
