import { describe, it, expect, vi } from 'vitest'

vi.mock('./log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { envService } from './envService'

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
