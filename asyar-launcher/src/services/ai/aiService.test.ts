import { describe, it, expect, vi, beforeEach } from 'vitest'

// All mocks BEFORE imports
vi.mock('../../built-in-features/ai-chat/aiStore.svelte', () => ({
  aiStore: {
    settings: {
      allowExtensionUse: true,
      temperature: 0.7,
      maxTokens: 2048,
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    },
    isConfigured: true,
  },
}))

vi.mock('../../built-in-features/ai-chat/aiService', () => ({
  streamChat: vi.fn(),
  stopStream: vi.fn(),
}))

vi.mock('../extension/streamDispatcher.svelte', () => ({
  streamDispatcher: {
    create: vi.fn(),
  },
}))

vi.mock('../log/logService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn(), custom: vi.fn() },
}))

import { AIService } from './aiService.svelte'
import { aiStore } from '../../built-in-features/ai-chat/aiStore.svelte'
import { streamChat, stopStream } from '../../built-in-features/ai-chat/aiService'
import { streamDispatcher } from '../extension/streamDispatcher.svelte'

function makeHandle() {
  return {
    sendChunk: vi.fn(),
    sendDone: vi.fn(),
    sendError: vi.fn(),
    onAbort: vi.fn(),
    aborted: false,
  }
}

function validRequest() {
  return {
    streamId: 'stream-x',
    messages: [{ role: 'user' as const, content: 'hello' }],
  }
}

describe('AIService.streamChat', () => {
  let service: AIService

  beforeEach(() => {
    service = new AIService()
    vi.clearAllMocks()
    // Reset store defaults
    ;(aiStore as any).settings = {
      allowExtensionUse: true,
      temperature: 0.7,
      maxTokens: 2048,
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    }
    ;(aiStore as any).isConfigured = true
    // streamChat mock: resolve immediately (simulate successful stream)
    vi.mocked(streamChat).mockResolvedValue(undefined)
    vi.mocked(streamDispatcher.create).mockReturnValue(makeHandle() as any)
  })

  it('returns {streaming: true} when everything is valid', async () => {
    const result = await service.streamChat('ext-1', validRequest())
    expect(result).toEqual({ streaming: true })
  })

  it('throws ai_disabled_by_user when master toggle is off', async () => {
    ;(aiStore as any).settings.allowExtensionUse = false
    await expect(service.streamChat('ext-1', validRequest()))
      .rejects.toThrow('ai_disabled_by_user:')
  })

  it('throws ai_not_configured when aiStore.isConfigured is false', async () => {
    ;(aiStore as any).isConfigured = false
    await expect(service.streamChat('ext-1', validRequest()))
      .rejects.toThrow('ai_not_configured:')
  })

  it('throws invalid_request when streamId is missing', async () => {
    const req = { ...validRequest(), streamId: '' }
    await expect(service.streamChat('ext-1', req))
      .rejects.toThrow('invalid_request:')
  })

  it('throws invalid_request when messages array is empty', async () => {
    const req = { ...validRequest(), messages: [] }
    await expect(service.streamChat('ext-1', req))
      .rejects.toThrow('invalid_request:')
  })

  it('throws invalid_request when a message has wrong shape', async () => {
    const req = { ...validRequest(), messages: [{ role: 'user' as const, content: 123 as any }] }
    await expect(service.streamChat('ext-1', req))
      .rejects.toThrow('invalid_request:')
  })

  it('clamps maxTokens to user ceiling', async () => {
    ;(aiStore as any).settings.maxTokens = 1000
    const req = { ...validRequest(), maxTokens: 5000 }
    await service.streamChat('ext-1', req)

    // The engine streamChat should have been called with maxTokens=1000
    expect(vi.mocked(streamChat)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxTokens: 1000 }),
      expect.anything(),
      req.streamId,
    )
  })

  it('passes through maxTokens when below ceiling', async () => {
    ;(aiStore as any).settings.maxTokens = 2048
    const req = { ...validRequest(), maxTokens: 500 }
    await service.streamChat('ext-1', req)

    expect(vi.mocked(streamChat)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxTokens: 500 }),
      expect.anything(),
      req.streamId,
    )
  })

  it('forwards onToken to handle.sendChunk', async () => {
    const handle = makeHandle()
    vi.mocked(streamDispatcher.create).mockReturnValue(handle as any)
    // Capture the handlers passed to streamChat
    vi.mocked(streamChat).mockImplementation(async (_msgs, _settings, handlers) => {
      handlers.onToken('hello')
    })

    await service.streamChat('ext-1', validRequest())

    expect(handle.sendChunk).toHaveBeenCalledWith({ token: 'hello' })
  })

  it('forwards onDone to handle.sendDone', async () => {
    const handle = makeHandle()
    vi.mocked(streamDispatcher.create).mockReturnValue(handle as any)
    vi.mocked(streamChat).mockImplementation(async (_msgs, _settings, handlers) => {
      handlers.onDone()
    })

    await service.streamChat('ext-1', validRequest())
    expect(handle.sendDone).toHaveBeenCalledOnce()
  })

  it('forwards onError to handle.sendError with provider_error code', async () => {
    const handle = makeHandle()
    vi.mocked(streamDispatcher.create).mockReturnValue(handle as any)
    vi.mocked(streamChat).mockImplementation(async (_msgs, _settings, handlers) => {
      handlers.onError('rate limited')
    })

    await service.streamChat('ext-1', validRequest())
    expect(handle.sendError).toHaveBeenCalledWith({
      code: 'provider_error',
      message: 'rate limited',
    })
  })

  it('wires onAbort to call stopStream', async () => {
    const handle = makeHandle()
    vi.mocked(streamDispatcher.create).mockReturnValue(handle as any)

    await service.streamChat('ext-1', validRequest())

    // Simulate abort by calling the registered callback
    const onAbortCb = vi.mocked(handle.onAbort).mock.calls[0][0]
    onAbortCb()
    expect(vi.mocked(stopStream)).toHaveBeenCalledWith(validRequest().streamId)
  })
})
