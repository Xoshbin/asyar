import { describe, it, expect, vi, beforeEach } from 'vitest'

// All mocks BEFORE imports

const mockLocalHandle = vi.hoisted(() => ({
  id: 'mock-run-id',
  write: vi.fn(async () => {}),
  done: vi.fn(async () => {}),
  fail: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  onCancel: vi.fn(() => () => {}),
}))

const mockRunService = vi.hoisted(() => ({
  startLocal: vi.fn<(input: { label: string; kind: string; cancellable?: boolean; extensionId?: string | null }) => Promise<typeof mockLocalHandle>>(async () => mockLocalHandle),
}))

vi.mock('../run/runService.svelte', () => ({
  runService: mockRunService,
}))

const mockSettings = vi.hoisted(() => ({
  providers: {
    openai: { enabled: true, apiKey: 'sk-test' },
    anthropic: { enabled: false },
    google: { enabled: false },
    ollama: { enabled: false },
    openrouter: { enabled: false },
    custom: { enabled: false },
  },
  activeProviderId: 'openai' as const,
  activeModelId: 'gpt-4o-mini',
  allowExtensionUse: true,
  temperature: 0.7,
  maxTokens: 2048,
}))

vi.mock('../../built-in-features/ai-chat/aiStore.svelte', () => ({
  aiStore: {
    settings: mockSettings,
    isConfigured: true,
  },
}))

vi.mock('./aiEngine', () => ({
  streamChat: vi.fn(),
  stopStream: vi.fn(),
}))

vi.mock('./providerRegistry', () => ({
  getProvider: vi.fn().mockReturnValue({ id: 'openai', name: 'OpenAI' }),
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
import { streamChat, stopStream } from './aiEngine'
import { getProvider } from './providerRegistry'
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
    ;(aiStore as any).settings = { ...mockSettings }
    ;(aiStore as any).isConfigured = true
    // streamChat mock: resolve immediately (simulate successful stream)
    vi.mocked(streamChat).mockResolvedValue(undefined)
    vi.mocked(streamDispatcher.create).mockReturnValue(makeHandle() as any)
    vi.mocked(getProvider).mockReturnValue({ id: 'openai', name: 'OpenAI' } as any)
  })

  it('returns {streaming: true} when everything is valid', async () => {
    const result = await service.streamChat('ext-1', validRequest())
    expect(result).toEqual({ streaming: true })
  })

  it('throws ai_disabled_by_user when master toggle is off', async () => {
    ;(aiStore as any).settings = { ...mockSettings, allowExtensionUse: false }
    await expect(service.streamChat('ext-1', validRequest()))
      .rejects.toThrow('ai_disabled_by_user:')
  })

  it('throws ai_not_configured when aiStore.isConfigured is false', async () => {
    ;(aiStore as any).isConfigured = false
    await expect(service.streamChat('ext-1', validRequest()))
      .rejects.toThrow('ai_not_configured:')
  })

  it('throws ai_not_configured when no activeProviderId is set', async () => {
    ;(aiStore as any).settings = { ...mockSettings, activeProviderId: null }
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
    ;(aiStore as any).settings = { ...mockSettings, maxTokens: 1000 }
    const req = { ...validRequest(), maxTokens: 5000 }
    await service.streamChat('ext-1', req)

    // The engine streamChat should have been called with maxTokens=1000
    expect(vi.mocked(streamChat)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ maxTokens: 1000 }),
      expect.anything(),
      expect.anything(),
      req.streamId,
    )
  })

  it('passes through maxTokens when below ceiling', async () => {
    ;(aiStore as any).settings = { ...mockSettings, maxTokens: 2048 }
    const req = { ...validRequest(), maxTokens: 500 }
    await service.streamChat('ext-1', req)

    expect(vi.mocked(streamChat)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ maxTokens: 500 }),
      expect.anything(),
      expect.anything(),
      req.streamId,
    )
  })

  it('forwards onToken to handle.sendChunk', async () => {
    const handle = makeHandle()
    vi.mocked(streamDispatcher.create).mockReturnValue(handle as any)
    // Capture the handlers passed to streamChat
    vi.mocked(streamChat).mockImplementation(async (_plugin, _cfg, _msgs, _params, handlers) => {
      handlers.onToken('hello')
    })

    await service.streamChat('ext-1', validRequest())

    expect(handle.sendChunk).toHaveBeenCalledWith({ token: 'hello' })
  })

  it('forwards onDone to handle.sendDone', async () => {
    const handle = makeHandle()
    vi.mocked(streamDispatcher.create).mockReturnValue(handle as any)
    vi.mocked(streamChat).mockImplementation(async (_plugin, _cfg, _msgs, _params, handlers) => {
      handlers.onDone()
    })

    await service.streamChat('ext-1', validRequest())
    expect(handle.sendDone).toHaveBeenCalledOnce()
  })

  it('forwards onError to handle.sendError with provider_error code', async () => {
    const handle = makeHandle()
    vi.mocked(streamDispatcher.create).mockReturnValue(handle as any)
    vi.mocked(streamChat).mockImplementation(async (_plugin, _cfg, _msgs, _params, handlers) => {
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

// ── Run Tracker auto-promotion ─────────────────────────────────────────────────

describe('AIService.streamChat run-tracker auto-promotion', () => {
  let service: AIService

  beforeEach(() => {
    service = new AIService()
    vi.clearAllMocks()
    ;(aiStore as any).settings = { ...mockSettings }
    ;(aiStore as any).isConfigured = true
    vi.mocked(streamChat).mockResolvedValue(undefined)
    vi.mocked(streamDispatcher.create).mockReturnValue(makeHandle() as any)
    vi.mocked(getProvider).mockReturnValue({ id: 'openai', name: 'OpenAI' } as any)
    mockRunService.startLocal.mockResolvedValue(mockLocalHandle)
    mockLocalHandle.write.mockReset()
    mockLocalHandle.done.mockReset()
    mockLocalHandle.fail.mockReset()
    mockLocalHandle.onCancel.mockReset()
  })

  it('streamChat_calls_runService_startLocal_with_ai_chat_kind', async () => {
    await service.streamChat('ext-1', validRequest())

    expect(mockRunService.startLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ai-chat',
        label: expect.any(String),
        extensionId: 'ext-1',
      }),
    )
    const callArg = mockRunService.startLocal.mock.calls[0][0]
    expect(callArg.label.length).toBeGreaterThan(0)
    expect(callArg.extensionId).toBe('ext-1')
  })

  it('streamChat_forwards_tokens_to_handle_write', async () => {
    vi.mocked(streamChat).mockImplementation(async (_plugin, _cfg, _msgs, _params, handlers) => {
      handlers.onToken('tok1')
      handlers.onToken('tok2')
      handlers.onToken('tok3')
      handlers.onDone()
    })

    await service.streamChat('ext-1', validRequest())

    expect(mockLocalHandle.write).toHaveBeenCalledTimes(3)
    expect(mockLocalHandle.write).toHaveBeenNthCalledWith(1, 'tok1')
    expect(mockLocalHandle.write).toHaveBeenNthCalledWith(2, 'tok2')
    expect(mockLocalHandle.write).toHaveBeenNthCalledWith(3, 'tok3')
  })

  it('streamChat_calls_handle_fail_on_error', async () => {
    vi.mocked(streamChat).mockImplementation(async (_plugin, _cfg, _msgs, _params, handlers) => {
      handlers.onError('provider blew up')
    })

    await service.streamChat('ext-1', validRequest())

    expect(mockLocalHandle.fail).toHaveBeenCalledWith(expect.stringContaining('provider blew up'))
    expect(mockLocalHandle.done).not.toHaveBeenCalled()
  })
})
