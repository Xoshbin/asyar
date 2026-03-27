import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// isBrowser is controlled per-test via this mutable box
const isBrowserBox = vi.hoisted(() => ({ value: true }))

vi.mock('./log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('./envService', () => ({
  envService: { get isBrowser() { return isBrowserBox.value } },
}))

import { browserShimService } from './browserShimService'

function resetService() {
  ;(browserShimService as any).isInitialized = false
}

// ── init guards ───────────────────────────────────────────────────────────────

describe('init — guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetService()
  })

  it('does not install shims when not in browser mode', () => {
    isBrowserBox.value = false
    const originalFetch = vi.fn()
    vi.stubGlobal('window', { fetch: originalFetch })
    browserShimService.init()
    // window.fetch must be untouched
    expect((window as any).fetch).toBe(originalFetch)
  })

  it('only installs shims once even when called multiple times', () => {
    isBrowserBox.value = true
    const originalFetch = vi.fn()
    vi.stubGlobal('window', { fetch: originalFetch })
    browserShimService.init()
    const shimmedFetch = (window as any).fetch
    browserShimService.init() // second call — must be a no-op
    expect((window as any).fetch).toBe(shimmedFetch)
  })
})

// ── shimFetch — URL rewriting ─────────────────────────────────────────────────

describe('shimFetch — URL rewriting', () => {
  let originalFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    isBrowserBox.value = true
    resetService()
    originalFetch = vi.fn().mockResolvedValue(new Response())
    vi.stubGlobal('window', { fetch: originalFetch })
    browserShimService.init()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetService()
  })

  it('rewrites asyar-extension:// URL to the built-in-extensions path', async () => {
    await (window as any).fetch('asyar-extension://calculator/index.js')
    expect(originalFetch).toHaveBeenCalledWith(
      '/src/built-in-extensions/calculator/index.js',
      undefined
    )
  })

  it('rewrites generic index.css to the dist/ subfolder', async () => {
    await (window as any).fetch('asyar-extension://my-ext/index.css')
    expect(originalFetch).toHaveBeenCalledWith(
      '/src/built-in-extensions/my-ext/dist/index.css',
      undefined
    )
  })

  it('uses the special store CSS path for the store extension', async () => {
    await (window as any).fetch('asyar-extension://store/index.css')
    expect(originalFetch).toHaveBeenCalledWith(
      '/src/built-in-extensions/store/dist/store-extension.css',
      undefined
    )
  })

  it('rewrites nested paths correctly', async () => {
    await (window as any).fetch('asyar-extension://ai-chat/assets/main.js')
    expect(originalFetch).toHaveBeenCalledWith(
      '/src/built-in-extensions/ai-chat/assets/main.js',
      undefined
    )
  })

  it('passes through non-asyar-extension URLs unchanged (string)', async () => {
    await (window as any).fetch('https://example.com/api')
    expect(originalFetch).toHaveBeenCalledWith('https://example.com/api', undefined)
  })

  it('passes through non-asyar-extension URLs unchanged (Request object)', async () => {
    const req = { url: 'https://api.openai.com/v1/chat' } as Request
    await (window as any).fetch(req)
    expect(originalFetch).toHaveBeenCalledWith(req, undefined)
  })

  it('forwards the RequestInit options to the underlying fetch', async () => {
    const init = { method: 'POST', body: 'data' }
    await (window as any).fetch('https://example.com', init)
    expect(originalFetch).toHaveBeenCalledWith('https://example.com', init)
  })

  it('extracts the URL from a URL instance', async () => {
    const url = new URL('https://example.com/path')
    await (window as any).fetch(url)
    expect(originalFetch).toHaveBeenCalledWith(url, undefined)
  })
})

// ── shimTauriInternals ────────────────────────────────────────────────────────

describe('shimTauriInternals', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetService()
  })

  it('injects __TAURI_INTERNALS__ when it is absent', () => {
    isBrowserBox.value = true
    vi.stubGlobal('window', { fetch: vi.fn(), __TAURI_INTERNALS__: undefined })
    browserShimService.init()
    expect((window as any).__TAURI_INTERNALS__).toBeDefined()
    expect(typeof (window as any).__TAURI_INTERNALS__.invoke).toBe('function')
  })

  it('does not overwrite an existing __TAURI_INTERNALS__', () => {
    isBrowserBox.value = true
    const existing = { invoke: vi.fn() }
    vi.stubGlobal('window', { fetch: vi.fn(), __TAURI_INTERNALS__: existing })
    browserShimService.init()
    expect((window as any).__TAURI_INTERNALS__).toBe(existing)
  })

  it('mock invoke returns null', async () => {
    isBrowserBox.value = true
    vi.stubGlobal('window', { fetch: vi.fn(), __TAURI_INTERNALS__: undefined })
    browserShimService.init()
    const result = await (window as any).__TAURI_INTERNALS__.invoke('any_cmd')
    expect(result).toBeNull()
  })
})
