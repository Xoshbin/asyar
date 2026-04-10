import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/persistence/extensionStore', () => ({
  createPersistence: vi.fn(() => ({
    loadSync: vi.fn((fallback: unknown) => fallback),
    load: vi.fn(async (fallback: unknown) => fallback),
    save: vi.fn(),
  })),
}))

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      ai: {
        provider: 'openai',
        apiKey: '',
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 2048,
        allowExtensionUse: true,
      },
    },
    updateSettings: vi.fn().mockResolvedValue(true),
  },
}))

import { AIStoreClass } from './aiStore.svelte'
import { settingsService } from '../../services/settings/settingsService.svelte'

describe('AIStoreClass', () => {
  it('allowExtensionUse reads from settingsService', () => {
    const store = new AIStoreClass()
    expect(store.settings.allowExtensionUse).toBe(true)
  })

  it('currentStreamId defaults to null', () => {
    const store = new AIStoreClass()
    expect(store.currentStreamId).toBeNull()
  })

  it('updateAISettings delegates to settingsService.updateSettings', () => {
    const store = new AIStoreClass()
    store.updateAISettings({ apiKey: 'sk-test' })
    expect(settingsService.updateSettings).toHaveBeenCalledWith(
      'ai',
      expect.objectContaining({ apiKey: 'sk-test' })
    )
  })
})
