import { describe, it, expect, vi } from 'vitest'

vi.mock('./log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { envService } from './envService'

describe('storeApiBaseUrl', () => {
  it('returns the production URL', () => {
    expect(envService.storeApiBaseUrl).toBe('https://asyar.org')
  })
})
