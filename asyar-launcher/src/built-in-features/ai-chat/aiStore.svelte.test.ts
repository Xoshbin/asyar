import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSettingsSave = vi.hoisted(() => vi.fn())
const mockHistorySave = vi.hoisted(() => vi.fn())

vi.mock('../../lib/persistence/extensionStore', () => ({
  createPersistence: (key: string) => ({
    load: vi.fn().mockResolvedValue(
      key === 'asyar:ai-settings'
        ? { provider: 'openai', apiKey: '', model: 'gpt-4o-mini', temperature: 0.7, maxTokens: 2048 }
        : []
    ),
    loadSync: vi.fn().mockReturnValue(
      key === 'asyar:ai-settings'
        ? { provider: 'openai', apiKey: '', model: 'gpt-4o-mini', temperature: 0.7, maxTokens: 2048 }
        : []
    ),
    save: key === 'asyar:ai-settings' ? mockSettingsSave : mockHistorySave,
  }),
}))

import { AIStoreClass } from './aiStore.svelte'

describe('AIStoreClass persistence proxy safety', () => {
  let store: AIStoreClass

  beforeEach(() => {
    mockSettingsSave.mockClear()
    mockHistorySave.mockClear()
    store = new AIStoreClass()
    mockSettingsSave.mockClear()
    mockHistorySave.mockClear()
  })

  it('saves settings without Svelte Proxy wrapper (structuredClone-safe)', () => {
    store.updateAISettings({ apiKey: 'new-key' })
    store.persistSettings()

    expect(mockSettingsSave).toHaveBeenCalled()
    const savedValue = mockSettingsSave.mock.calls.at(-1)?.[0]
    // Simulates the Tauri IPC bug: structuredClone fails on $state Proxy objects.
    // persistSettings() must use $state.snapshot() to strip the Proxy before saving.
    expect(() => structuredClone(savedValue)).not.toThrow()
  })

  it('saves history without Svelte Proxy wrapper (structuredClone-safe)', () => {
    store.updateAISettings({ apiKey: 'test' })
    const conv = store.startConversation('Hello')
    store.persistHistory()

    expect(mockHistorySave).toHaveBeenCalled()
    const savedValue = mockHistorySave.mock.calls.at(-1)?.[0]
    expect(() => structuredClone(savedValue)).not.toThrow()
  })
})
