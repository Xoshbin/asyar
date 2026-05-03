import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/persistence/extensionStore', () => ({
  createPersistence: vi.fn(() => ({
    loadSync: vi.fn((fallback: unknown) => fallback),
    load: vi.fn(async (fallback: unknown) => fallback),
    save: vi.fn(),
  })),
}))

const mockRedactIfEnabled = vi.hoisted(() => vi.fn())
vi.mock('../../services/privacy/secretRedactionService.svelte', () => ({
  secretRedactionService: { redactIfEnabled: mockRedactIfEnabled },
}))

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      ai: {
        providers: {
          openai: { enabled: true, apiKey: '' },
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
    store.updateAISettings({ activeModelId: 'gpt-4o' })
    expect(settingsService.updateSettings).toHaveBeenCalledWith(
      'ai',
      expect.objectContaining({ activeModelId: 'gpt-4o' })
    )
  })

  it('activeProviderId reads from settingsService', () => {
    const store = new AIStoreClass()
    expect(store.settings.activeProviderId).toBe('openai')
  })

  describe('addUserMessage redaction', () => {
    beforeEach(() => {
      mockRedactIfEnabled.mockReset()
    })

    it('stores the redacted content when the redactor matches', async () => {
      mockRedactIfEnabled.mockResolvedValueOnce({
        content: 'check this [redacted: aws_access_key]',
        kinds: ['aws_access_key'],
        oversizedUnscanned: false,
      })
      const store = new AIStoreClass()
      const conv = await store.addUserMessage('check this AKIAIOSFODNN7EXAMPLE')
      const last = conv.messages[conv.messages.length - 1]
      expect(last.content).toBe('check this [redacted: aws_access_key]')
      expect(last.redactedKinds).toEqual(['aws_access_key'])
    })

    it('stores content verbatim when the redactor returns null', async () => {
      mockRedactIfEnabled.mockResolvedValueOnce(null)
      const store = new AIStoreClass()
      const conv = await store.addUserMessage('hello world')
      const last = conv.messages[conv.messages.length - 1]
      expect(last.content).toBe('hello world')
      expect(last.redactedKinds).toBeUndefined()
    })

    it('passes the aiConversations category to the redactor', async () => {
      mockRedactIfEnabled.mockResolvedValueOnce(null)
      const store = new AIStoreClass()
      await store.addUserMessage('hi')
      expect(mockRedactIfEnabled).toHaveBeenCalledWith('aiConversations', 'hi')
    })
  })
})
