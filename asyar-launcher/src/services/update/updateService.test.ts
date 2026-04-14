import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock BEFORE importing module under test
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { runUpdateCheck, resetUpdateCheckState } from './updateService'
import { invoke } from '@tauri-apps/api/core'
import { logService } from '../log/logService'

describe('runUpdateCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetUpdateCheckState()
  })

  it('returns up-to-date when invoke resolves null', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null)
    const result = await runUpdateCheck()
    expect(result).toEqual({ kind: 'up-to-date' })
    expect(logService.info).toHaveBeenCalled()
  })

  it('returns installed with version when invoke resolves a version string', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('1.2.3')
    const result = await runUpdateCheck()
    expect(result).toEqual({ kind: 'installed', version: '1.2.3' })
  })

  it('returns error kind when invoke rejects', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('network down'))
    const result = await runUpdateCheck()
    expect(result).toEqual({ kind: 'error', message: 'network down' })
    expect(logService.error).toHaveBeenCalled()
  })

  it('returns busy when a check is already in-flight', async () => {
    let resolveFirst!: (v: null) => void
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise((res) => { resolveFirst = res as (v: null) => void }) as any,
    )
    const firstPromise = runUpdateCheck()
    const second = await runUpdateCheck()
    expect(second).toEqual({ kind: 'busy' })
    expect(invoke).toHaveBeenCalledOnce()
    resolveFirst(null)
    await firstPromise
  })
})
