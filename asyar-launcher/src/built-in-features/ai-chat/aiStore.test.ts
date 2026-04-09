import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/persistence/extensionStore', () => ({
  createPersistence: vi.fn(() => ({
    loadSync: vi.fn((fallback: unknown) => fallback),
    load: vi.fn(async (fallback: unknown) => fallback),
    save: vi.fn(),
  })),
}))

import { AIStoreClass } from './aiStore.svelte'

describe('AIStoreClass', () => {
  it('allowExtensionUse defaults to true', () => {
    const store = new AIStoreClass()
    expect(store.settings.allowExtensionUse).toBe(true)
  })

  it('currentStreamId defaults to null', () => {
    const store = new AIStoreClass()
    expect(store.currentStreamId).toBeNull()
  })

  it('loading legacy stored settings (without allowExtensionUse) merges with defaults', async () => {
    // Simulate stored settings that pre-date the allowExtensionUse field
    const { createPersistence } = await import('../../lib/persistence/extensionStore') as any
    const settingsPersistenceMock = createPersistence.mock.results[0].value;
    settingsPersistenceMock.loadSync.mockReturnValue({
        provider: 'anthropic',
        apiKey: 'sk-test',
        model: 'claude-sonnet-4-20250514',
        temperature: 0.5,
        maxTokens: 1024,
        // allowExtensionUse intentionally absent — simulating old stored data
    });

    const store = new AIStoreClass()
    expect(store.settings.allowExtensionUse).toBe(true)  // must come from DEFAULT_SETTINGS
    expect(store.settings.provider).toBe('anthropic')    // user's value preserved
  })
})
