import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHistorySave = vi.hoisted(() => vi.fn())
const mockUpdateSettings = vi.hoisted(() => vi.fn().mockResolvedValue(true))

vi.mock('../../lib/persistence/extensionStore', () => ({
  createPersistence: vi.fn(() => ({
    load: vi.fn().mockResolvedValue([]),
    loadSync: vi.fn().mockReturnValue([]),
    save: mockHistorySave,
  })),
}))

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      ai: {
        providers: {
          openai: { enabled: true, apiKey: 'test-key' },
          anthropic: { enabled: false },
          google: { enabled: false },
          ollama: { enabled: false },
          openrouter: { enabled: false },
          custom: { enabled: false },
        },
        activeProviderId: 'openai',
        activeModelId: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 2048,
        allowExtensionUse: true,
      },
    },
    updateSettings: mockUpdateSettings,
  },
}))

import { AIStoreClass } from './aiStore.svelte'

describe('AIStoreClass persistence proxy safety', () => {
  let store: AIStoreClass

  beforeEach(() => {
    mockHistorySave.mockClear()
    mockUpdateSettings.mockClear()
    store = new AIStoreClass()
    mockHistorySave.mockClear()
    mockUpdateSettings.mockClear()
  })

  it('updateAISettings passes a structuredClone-safe value to settingsService', () => {
    store.updateAISettings({ activeModelId: 'gpt-4o' })

    expect(mockUpdateSettings).toHaveBeenCalled()
    const savedValue = mockUpdateSettings.mock.calls.at(-1)?.[1]
    expect(() => structuredClone(savedValue)).not.toThrow()
  })

  it('saves history without Svelte Proxy wrapper (structuredClone-safe)', () => {
    store.startConversation('Hello')
    store.persistHistory()

    expect(mockHistorySave).toHaveBeenCalled()
    const savedValue = mockHistorySave.mock.calls.at(-1)?.[0]
    expect(() => structuredClone(savedValue)).not.toThrow()
  })
})
