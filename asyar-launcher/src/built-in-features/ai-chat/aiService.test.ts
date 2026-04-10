import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IProviderPlugin, ProviderConfig, ChatParams, ChatMessage } from '../../services/ai/IProviderPlugin'

// aiEngine imports fetch from @tauri-apps/plugin-http — must be mocked before import
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => (globalThis.fetch as (...a: unknown[]) => unknown)(...args),
}))

const { streamChat, stopStream, _clearAllStreamsForTesting } = await import('../../services/ai/aiEngine')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHandlers() {
  return { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
}

function makeAbortSignal(): AbortSignal {
  return new AbortController().signal
}

const enc = new TextEncoder()

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk))
      controller.close()
    },
  })
}

function mockFetch(body: ReadableStream | null, status = 200, textBody = '') {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    body,
    text: () => Promise.resolve(textBody),
  })
}

/** A minimal real SSE-parsing plugin that delegates token extraction to a simple fn */
function makePlugin(
  parseToken: (line: string) => string | null,
  overrides: Partial<IProviderPlugin> = {}
): IProviderPlugin {
  return {
    id: 'openai',
    name: 'OpenAI',
    requiresApiKey: true,
    requiresBaseUrl: false,
    getModels: async () => [],
    buildRequest: (_messages, config, _params) => ({
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey ?? ''}` },
      body: {},
    }),
    async *parseStream(reader) {
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const token = parseToken(line.trim())
          if (token !== null) yield token
        }
      }
    },
    ...overrides,
  }
}

const openaiPlugin = makePlugin((line) => {
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6).trim()
  if (data === '[DONE]') return null
  try {
    const json = JSON.parse(data)
    return json.choices?.[0]?.delta?.content ?? null
  } catch { return null }
})

const config: ProviderConfig = { enabled: true, apiKey: 'sk-test' }
const params: ChatParams = { modelId: 'gpt-4', temperature: 0.7, maxTokens: 1024 }
const msgs: ChatMessage[] = [{ id: '1', role: 'user', content: 'hi', timestamp: 0 }]

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('streamChat (aiEngine)', () => {
  beforeEach(() => { _clearAllStreamsForTesting() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls onToken for each SSE token and onDone at the end', async () => {
    const stream = makeStream([
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }) + '\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { content: ' world' } }] }) + '\n',
      'data: [DONE]\n',
    ])
    vi.stubGlobal('fetch', mockFetch(stream))
    const h = makeHandlers()
    await streamChat(openaiPlugin, config, msgs, params, h, makeAbortSignal(), 'test-stream')
    expect(h.onToken).toHaveBeenCalledTimes(2)
    expect(h.onToken).toHaveBeenNthCalledWith(1, 'Hello')
    expect(h.onToken).toHaveBeenNthCalledWith(2, ' world')
    expect(h.onDone).toHaveBeenCalledOnce()
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('calls onError with a friendly message when the response is not ok', async () => {
    vi.stubGlobal('fetch', mockFetch(null, 401, '{"error":{"message":"Invalid API key"}}'))
    const h = makeHandlers()
    await streamChat(openaiPlugin, config, msgs, params, h, makeAbortSignal(), 'test-stream')
    expect(h.onError).toHaveBeenCalledWith('API error: Invalid API key')
    expect(h.onDone).not.toHaveBeenCalled()
  })

  it('calls onError with rate_limited prefix for HTTP 429', async () => {
    vi.stubGlobal('fetch', mockFetch(null, 429, '{"error":{"message":"Rate limit exceeded"}}'))
    const h = makeHandlers()
    await streamChat(openaiPlugin, config, msgs, params, h, makeAbortSignal(), 'test-stream')
    expect(h.onError).toHaveBeenCalledWith(expect.stringContaining('rate_limited:'))
  })

  it('falls back to raw text when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', mockFetch(null, 500, 'Internal Server Error'))
    const h = makeHandlers()
    await streamChat(openaiPlugin, config, msgs, params, h, makeAbortSignal(), 'test-stream')
    expect(h.onError).toHaveBeenCalledWith('API error: Internal Server Error')
  })

  it('falls back to HTTP status when error body is empty', async () => {
    vi.stubGlobal('fetch', mockFetch(null, 503, ''))
    const h = makeHandlers()
    await streamChat(openaiPlugin, config, msgs, params, h, makeAbortSignal(), 'test-stream')
    expect(h.onError).toHaveBeenCalledWith('API error: HTTP 503')
  })

  it('calls onError when the response has no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: null }))
    const h = makeHandlers()
    await streamChat(openaiPlugin, config, msgs, params, h, makeAbortSignal(), 'test-stream')
    expect(h.onError).toHaveBeenCalledWith('No response body received.')
  })

  it('calls onDone (not onError) when fetch throws an AbortError', async () => {
    const abortErr = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr))
    const h = makeHandlers()
    await streamChat(openaiPlugin, config, msgs, params, h, makeAbortSignal(), 'test-stream')
    expect(h.onDone).toHaveBeenCalledOnce()
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('calls onError for non-abort network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')))
    const h = makeHandlers()
    await streamChat(openaiPlugin, config, msgs, params, h, makeAbortSignal(), 'test-stream')
    expect(h.onError).toHaveBeenCalledWith('Network failure')
    expect(h.onDone).not.toHaveBeenCalled()
  })

  it('stopStream() aborts the current request so the next call starts fresh', async () => {
    let resolveFetch!: (v: unknown) => void
    const pending = new Promise(r => { resolveFetch = r })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))
    const h1 = makeHandlers()
    const p1 = streamChat(openaiPlugin, config, msgs, params, h1, makeAbortSignal(), 'stream-a')
    stopStream('stream-a')
    resolveFetch({ ok: false, status: 0, body: null, text: () => Promise.resolve('') })
    await p1
    // Second call should be able to create a fresh controller
    const stream = makeStream(['data: ' + JSON.stringify({ choices: [{ delta: { content: 'x' } }] }) + '\n'])
    vi.stubGlobal('fetch', mockFetch(stream))
    const h2 = makeHandlers()
    await streamChat(openaiPlugin, config, msgs, params, h2, makeAbortSignal(), 'stream-b')
    expect(h2.onDone).toHaveBeenCalledOnce()
  })

  it('throws if the same streamId is started while already active', async () => {
    let resolveFetch!: (v: unknown) => void
    const pending = new Promise(r => { resolveFetch = r })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))
    const h = makeHandlers()
    const p1 = streamChat(openaiPlugin, config, msgs, params, h, makeAbortSignal(), 'dup-stream')
    await expect(
      streamChat(openaiPlugin, config, msgs, params, makeHandlers(), makeAbortSignal(), 'dup-stream')
    ).rejects.toThrow('already active')
    stopStream('dup-stream')
    resolveFetch({ ok: false, status: 0, body: null, text: () => Promise.resolve('') })
    await p1
  })
})
