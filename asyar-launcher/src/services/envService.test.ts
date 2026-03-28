import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { envService } from './envService'

function resetCache() {
  ;(envService as any)._isTauri = null
}

// ── isTauri ───────────────────────────────────────────────────────────────────

describe('isTauri', () => {
  beforeEach(resetCache)

  afterEach(() => {
    vi.unstubAllGlobals()
    resetCache()
  })

  it('returns false when window is undefined', () => {
    // In node test env window is undefined → isTauri is false
    expect(envService.isTauri).toBe(false)
  })

  it('returns false when window exists but has no __TAURI_INTERNALS__', () => {
    vi.stubGlobal('window', {})
    expect(envService.isTauri).toBe(false)
  })

  it('returns true when window.__TAURI_INTERNALS__ is present', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    expect(envService.isTauri).toBe(true)
  })

  it('caches the result after the first access', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    const first = envService.isTauri
    vi.stubGlobal('window', {}) // change env — should not affect cached value
    expect(envService.isTauri).toBe(first)
  })
})

// ── isBrowser ─────────────────────────────────────────────────────────────────

describe('isBrowser', () => {
  beforeEach(resetCache)
  afterEach(() => { vi.unstubAllGlobals(); resetCache() })

  it('is true when isTauri is false', () => {
    vi.stubGlobal('window', {})
    expect(envService.isBrowser).toBe(true)
  })

  it('is false when isTauri is true', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    expect(envService.isBrowser).toBe(false)
  })

  it('is the exact inverse of isTauri', () => {
    expect(envService.isBrowser).toBe(!envService.isTauri)
  })
})

// ── storeApiBaseUrl ───────────────────────────────────────────────────────────

describe('storeApiBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('always returns the production URL in PROD mode', () => {
    vi.stubEnv('PROD', true as any)
    expect(envService.storeApiBaseUrl).toBe('https://asyar.org')
  })

  it('returns the local dev URL on macOS in dev mode', () => {
    vi.stubEnv('PROD', false as any)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) ...' })
    expect(envService.storeApiBaseUrl).toBe('http://asyar-website.test')
  })

  it('returns the production URL on non-macOS in dev mode', () => {
    vi.stubEnv('PROD', false as any)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...' })
    expect(envService.storeApiBaseUrl).toBe('https://asyar.org')
  })

  it('returns the production URL when navigator is not available', () => {
    vi.stubEnv('PROD', false as any)
    vi.stubGlobal('navigator', undefined)
    expect(envService.storeApiBaseUrl).toBe('https://asyar.org')
  })
})
