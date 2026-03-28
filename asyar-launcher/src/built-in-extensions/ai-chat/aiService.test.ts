import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getEndpoint, getHeaders, buildBody, extractToken, streamChat, stopStream } from './aiService'
import type { AISettings, AIMessage } from './aiStore'

function settings(overrides: Partial<AISettings> = {}): AISettings {
  return {
    provider: 'openai',
    apiKey: 'sk-test',
    model: 'gpt-4o',
    maxTokens: 1024,
    temperature: 0.7,
    systemPrompt: '',
    baseUrl: '',
    ...overrides,
  }
}

function msg(role: AIMessage['role'], content: string): AIMessage {
  return { role, content }
}

// ── getEndpoint ───────────────────────────────────────────────────────────────

describe('getEndpoint', () => {
  it('returns the OpenAI completions URL', () => {
    expect(getEndpoint(settings({ provider: 'openai' }))).toBe(
      'https://api.openai.com/v1/chat/completions'
    )
  })

  it('returns the Anthropic messages URL', () => {
    expect(getEndpoint(settings({ provider: 'anthropic' }))).toBe(
      'https://api.anthropic.com/v1/messages'
    )
  })

  it('embeds the model and API key in the Google URL', () => {
    const url = getEndpoint(settings({ provider: 'google', model: 'gemini-pro', apiKey: 'my-key' }))
    expect(url).toContain('gemini-pro')
    expect(url).toContain('my-key')
    expect(url).toContain('streamGenerateContent')
  })

  it('uses the default Ollama base URL when none is set', () => {
    expect(getEndpoint(settings({ provider: 'ollama', baseUrl: '' }))).toBe(
      'http://localhost:11434/api/chat'
    )
  })

  it('uses a custom Ollama base URL when provided', () => {
    expect(getEndpoint(settings({ provider: 'ollama', baseUrl: 'http://my-host:11434' }))).toBe(
      'http://my-host:11434/api/chat'
    )
  })

  it('returns the OpenRouter URL', () => {
    expect(getEndpoint(settings({ provider: 'openrouter' }))).toBe(
      'https://openrouter.ai/api/v1/chat/completions'
    )
  })

  it('builds a custom provider URL from baseUrl', () => {
    const url = getEndpoint(settings({ provider: 'custom', baseUrl: 'https://my-api.com' }))
    expect(url).toBe('https://my-api.com/v1/chat/completions')
  })
})

// ── getHeaders ────────────────────────────────────────────────────────────────

describe('getHeaders', () => {
  it('sends a Bearer token for OpenAI', () => {
    const h = getHeaders(settings({ provider: 'openai', apiKey: 'sk-abc' }))
    expect(h['Authorization']).toBe('Bearer sk-abc')
    expect(h['Content-Type']).toBe('application/json')
  })

  it('sends x-api-key and anthropic-version for Anthropic', () => {
    const h = getHeaders(settings({ provider: 'anthropic', apiKey: 'ant-key' }))
    expect(h['x-api-key']).toBe('ant-key')
    expect(h['anthropic-version']).toBe('2023-06-01')
  })

  it('sends only Content-Type for Google (key is in URL)', () => {
    const h = getHeaders(settings({ provider: 'google' }))
    expect(Object.keys(h)).toEqual(['Content-Type'])
  })

  it('sends only Content-Type for Ollama', () => {
    const h = getHeaders(settings({ provider: 'ollama' }))
    expect(Object.keys(h)).toEqual(['Content-Type'])
  })

  it('sends a Bearer token for OpenRouter', () => {
    const h = getHeaders(settings({ provider: 'openrouter', apiKey: 'or-key' }))
    expect(h['Authorization']).toBe('Bearer or-key')
  })
})

// ── buildBody ─────────────────────────────────────────────────────────────────

describe('buildBody', () => {
  const msgs = [msg('user', 'hello'), msg('assistant', 'hi')]

  describe('OpenAI-compatible (openai, ollama, openrouter, custom)', () => {
    it('includes model, stream, and messages', () => {
      const body = buildBody(msgs, settings()) as any
      expect(body.model).toBe('gpt-4o')
      expect(body.stream).toBe(true)
      expect(body.messages).toHaveLength(2)
    })

    it('prepends a system message when systemPrompt is set', () => {
      const body = buildBody(msgs, settings({ systemPrompt: 'Be concise.' })) as any
      expect(body.messages[0]).toEqual({ role: 'system', content: 'Be concise.' })
      expect(body.messages).toHaveLength(3)
    })

    it('strips existing system role messages from history', () => {
      const withSys = [msg('system', 'old'), msg('user', 'hi')]
      const body = buildBody(withSys, settings()) as any
      expect(body.messages.every((m: any) => m.role !== 'system')).toBe(true)
    })

    it('omits the system message when systemPrompt is empty', () => {
      const body = buildBody(msgs, settings({ systemPrompt: '' })) as any
      expect(body.messages[0].role).toBe('user')
    })
  })

  describe('Anthropic', () => {
    it('puts systemPrompt in the top-level system field', () => {
      const body = buildBody(msgs, settings({ provider: 'anthropic', systemPrompt: 'Be helpful.' })) as any
      expect(body.system).toBe('Be helpful.')
      expect(body.messages.every((m: any) => m.role !== 'system')).toBe(true)
    })

    it('falls back to default system prompt when empty', () => {
      const body = buildBody(msgs, settings({ provider: 'anthropic', systemPrompt: '' })) as any
      expect(body.system).toBe('You are a helpful assistant.')
    })

    it('includes stream: true and max_tokens', () => {
      const body = buildBody(msgs, settings({ provider: 'anthropic', maxTokens: 512 })) as any
      expect(body.stream).toBe(true)
      expect(body.max_tokens).toBe(512)
    })
  })

  describe('Google', () => {
    it('maps assistant role to model', () => {
      const body = buildBody(msgs, settings({ provider: 'google' })) as any
      const roles = body.contents.map((c: any) => c.role)
      expect(roles).toContain('user')
      expect(roles).toContain('model')
      expect(roles).not.toContain('assistant')
    })

    it('wraps content in parts[].text', () => {
      const body = buildBody([msg('user', 'hello')], settings({ provider: 'google' })) as any
      expect(body.contents[0].parts[0].text).toBe('hello')
    })

    it('uses generationConfig for temperature and maxOutputTokens', () => {
      const body = buildBody(msgs, settings({ provider: 'google', temperature: 0.5, maxTokens: 256 })) as any
      expect(body.generationConfig.temperature).toBe(0.5)
      expect(body.generationConfig.maxOutputTokens).toBe(256)
    })
  })
})

// ── extractToken ──────────────────────────────────────────────────────────────

describe('extractToken', () => {
  it('returns null for lines not starting with "data: "', () => {
    expect(extractToken('event: content_block_delta', 'anthropic')).toBeNull()
    expect(extractToken('', 'openai')).toBeNull()
  })

  it('returns null for the [DONE] sentinel', () => {
    expect(extractToken('data: [DONE]', 'openai')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(extractToken('data: {bad json}', 'openai')).toBeNull()
  })

  describe('OpenAI', () => {
    it('extracts a delta content token', () => {
      const line = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hello' } }] })
      expect(extractToken(line, 'openai')).toBe('hello')
    })

    it('returns null when delta has no content', () => {
      const line = 'data: ' + JSON.stringify({ choices: [{ delta: {} }] })
      expect(extractToken(line, 'openai')).toBeNull()
    })
  })

  describe('Anthropic', () => {
    it('extracts text from content_block_delta', () => {
      const line = 'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { text: 'world' } })
      expect(extractToken(line, 'anthropic')).toBe('world')
    })

    it('returns null for non-delta event types', () => {
      const line = 'data: ' + JSON.stringify({ type: 'message_start' })
      expect(extractToken(line, 'anthropic')).toBeNull()
    })
  })

  describe('Google', () => {
    it('extracts text from candidates parts', () => {
      const line = 'data: ' + JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'gemini token' }] } }],
      })
      expect(extractToken(line, 'google')).toBe('gemini token')
    })

    it('returns null when candidates is empty', () => {
      const line = 'data: ' + JSON.stringify({ candidates: [] })
      expect(extractToken(line, 'google')).toBeNull()
    })
  })

  describe('OpenRouter (OpenAI-compatible)', () => {
    it('extracts the delta content token', () => {
      const line = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'or token' } }] })
      expect(extractToken(line, 'openrouter')).toBe('or token')
    })
  })
})

// ── streamChat / stopStream ───────────────────────────────────────────────────

function makeHandlers() {
  return { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
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

describe('streamChat', () => {
  beforeEach(() => { stopStream() })
  afterEach(() => { vi.unstubAllGlobals() })

  // ── HTTP errors ─────────────────────────────────────────────────────────────

  it('calls onError with a friendly message when the response is not ok', async () => {
    vi.stubGlobal('fetch', mockFetch(null, 401, '{"error":{"message":"Invalid API key"}}'))
    const h = makeHandlers()
    await streamChat([{ role: 'user', content: 'hi' }], settings(), h)
    expect(h.onError).toHaveBeenCalledWith('API error: Invalid API key')
    expect(h.onDone).not.toHaveBeenCalled()
  })

  it('falls back to raw text when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', mockFetch(null, 500, 'Internal Server Error'))
    const h = makeHandlers()
    await streamChat([], settings(), h)
    expect(h.onError).toHaveBeenCalledWith('API error: Internal Server Error')
  })

  it('falls back to HTTP status when error body is empty', async () => {
    vi.stubGlobal('fetch', mockFetch(null, 503, ''))
    const h = makeHandlers()
    await streamChat([], settings(), h)
    expect(h.onError).toHaveBeenCalledWith('API error: HTTP 503')
  })

  it('calls onError when the response has no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: null }))
    const h = makeHandlers()
    await streamChat([], settings(), h)
    expect(h.onError).toHaveBeenCalledWith('No response body received.')
  })

  // ── OpenAI SSE streaming ────────────────────────────────────────────────────

  it('calls onToken for each SSE token and onDone at the end (OpenAI)', async () => {
    const stream = makeStream([
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }) + '\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { content: ' world' } }] }) + '\n',
      'data: [DONE]\n',
    ])
    vi.stubGlobal('fetch', mockFetch(stream))
    const h = makeHandlers()
    await streamChat([{ role: 'user', content: 'hi' }], settings({ provider: 'openai' }), h)
    expect(h.onToken).toHaveBeenCalledTimes(2)
    expect(h.onToken).toHaveBeenNthCalledWith(1, 'Hello')
    expect(h.onToken).toHaveBeenNthCalledWith(2, ' world')
    expect(h.onDone).toHaveBeenCalledOnce()
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('handles multi-line chunks arriving in a single read() call', async () => {
    const twoLines =
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'A' } }] }) + '\n' +
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'B' } }] }) + '\n'
    vi.stubGlobal('fetch', mockFetch(makeStream([twoLines])))
    const h = makeHandlers()
    await streamChat([], settings({ provider: 'openai' }), h)
    expect(h.onToken).toHaveBeenCalledWith('A')
    expect(h.onToken).toHaveBeenCalledWith('B')
  })

  // ── Ollama NDJSON streaming ─────────────────────────────────────────────────

  it('calls onToken for each Ollama NDJSON token and onDone when done:true', async () => {
    const stream = makeStream([
      JSON.stringify({ message: { content: 'Hel' }, done: false }) + '\n',
      JSON.stringify({ message: { content: 'lo' }, done: true }) + '\n',
    ])
    vi.stubGlobal('fetch', mockFetch(stream))
    const h = makeHandlers()
    await streamChat([{ role: 'user', content: 'hi' }], settings({ provider: 'ollama' }), h)
    expect(h.onToken).toHaveBeenCalledWith('Hel')
    expect(h.onToken).toHaveBeenCalledWith('lo')
    expect(h.onDone).toHaveBeenCalledOnce()
  })

  it('calls onDone after the stream ends even if done flag never appears (Ollama)', async () => {
    const stream = makeStream([
      JSON.stringify({ message: { content: 'hi' }, done: false }) + '\n',
    ])
    vi.stubGlobal('fetch', mockFetch(stream))
    const h = makeHandlers()
    await streamChat([], settings({ provider: 'ollama' }), h)
    expect(h.onDone).toHaveBeenCalledOnce()
  })

  it('skips malformed NDJSON lines without throwing (Ollama)', async () => {
    const stream = makeStream([
      'not-json\n',
      JSON.stringify({ message: { content: 'ok' }, done: true }) + '\n',
    ])
    vi.stubGlobal('fetch', mockFetch(stream))
    const h = makeHandlers()
    await expect(
      streamChat([], settings({ provider: 'ollama' }), h)
    ).resolves.not.toThrow()
    expect(h.onToken).toHaveBeenCalledWith('ok')
  })

  // ── AbortError / stopStream ─────────────────────────────────────────────────

  it('calls onDone (not onError) when fetch throws an AbortError', async () => {
    const abortErr = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr))
    const h = makeHandlers()
    await streamChat([], settings(), h)
    expect(h.onDone).toHaveBeenCalledOnce()
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('calls onError for non-abort network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')))
    const h = makeHandlers()
    await streamChat([], settings(), h)
    expect(h.onError).toHaveBeenCalledWith('Network failure')
    expect(h.onDone).not.toHaveBeenCalled()
  })

  it('stopStream() aborts the current request so the next call starts fresh', async () => {
    // First call — make fetch block so we can stopStream mid-flight
    let resolveFetch!: (v: unknown) => void
    const pending = new Promise(r => { resolveFetch = r })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))
    const h1 = makeHandlers()
    const p1 = streamChat([], settings(), h1)
    stopStream()          // aborts first request
    resolveFetch({ ok: false, status: 0, body: null, text: () => Promise.resolve('') })
    await p1
    // Second call should be able to create a fresh AbortController
    const stream = makeStream(['data: ' + JSON.stringify({ choices: [{ delta: { content: 'x' } }] }) + '\n'])
    vi.stubGlobal('fetch', mockFetch(stream))
    const h2 = makeHandlers()
    await streamChat([], settings(), h2)
    expect(h2.onDone).toHaveBeenCalledOnce()
  })
})
