import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHistorySave = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockHistoryLoad = vi.hoisted(() => vi.fn().mockResolvedValue(''))
const mockUpdateSettings = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const mockEncrypt = vi.hoisted(() => vi.fn(async (plaintext: string) => `enc:v1:${plaintext}`))
const mockDecrypt = vi.hoisted(() => vi.fn(async () => ''))

vi.mock('../../lib/persistence/extensionStore', () => ({
  createPersistence: vi.fn(() => ({
    load: mockHistoryLoad,
    loadSync: vi.fn().mockReturnValue(''),
    save: mockHistorySave,
  })),
}))

vi.mock('../../services/privacy/encryptionService.svelte', () => ({
  encryptionService: {
    encrypt: mockEncrypt,
    decrypt: mockDecrypt,
  },
}))

vi.mock('../../services/privacy/secretRedactionService.svelte', () => ({
  secretRedactionService: { redactIfEnabled: vi.fn().mockResolvedValue(null) },
}))

vi.mock('../../services/envService', () => ({
  envService: { isTauri: true },
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
    mockEncrypt.mockClear()
    store = new AIStoreClass()
    mockHistorySave.mockClear()
    mockUpdateSettings.mockClear()
    mockEncrypt.mockClear()
  })

  it('updateAISettings passes a structuredClone-safe value to settingsService', () => {
    store.updateAISettings({ activeModelId: 'gpt-4o' })

    expect(mockUpdateSettings).toHaveBeenCalled()
    const savedValue = mockUpdateSettings.mock.calls.at(-1)?.[1]
    expect(() => structuredClone(savedValue)).not.toThrow()
  })

  it('saves history through the encryption layer with a structuredClone-safe payload', async () => {
    store.startConversation('Hello')
    store.persistHistory()

    // persistHistory fires `void saveEncryptedHistory(...)` — let the
    // chain resolve so the mocked `cryptoEncrypt` and `historyPersistence.save`
    // observe the calls.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The plaintext handed to the encrypt boundary must be a JSON string
    // produced from a Svelte $state.snapshot() — never a live Proxy.
    expect(mockEncrypt).toHaveBeenCalled()
    const plaintextPassedToEncrypt = mockEncrypt.mock.calls.at(-1)?.[0]
    expect(typeof plaintextPassedToEncrypt).toBe('string')
    expect(() => structuredClone(plaintextPassedToEncrypt)).not.toThrow()

    // The on-disk write receives the ciphertext, not the live array.
    expect(mockHistorySave).toHaveBeenCalled()
    const savedValue = mockHistorySave.mock.calls.at(-1)?.[0]
    expect(typeof savedValue).toBe('string')
    expect(savedValue).toMatch(/^enc:v1:/)
  })
})
