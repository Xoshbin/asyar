import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { runUpdateCheck, resetUpdateCheckState } from './updateService'
import { check } from '@tauri-apps/plugin-updater'
import { logService } from '../log/logService'

describe('runUpdateCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetUpdateCheckState()
  })

  it('returns up-to-date when check() resolves null', async () => {
    vi.mocked(check).mockResolvedValueOnce(null as any)

    const result = await runUpdateCheck('stable')

    expect(result).toEqual({ kind: 'up-to-date' })
    expect(logService.info).toHaveBeenCalled()
  })

  it('forwards X-Update-Channel header from the requested channel', async () => {
    vi.mocked(check).mockResolvedValueOnce(null as any)

    await runUpdateCheck('beta')

    expect(check).toHaveBeenCalledWith({ headers: { 'X-Update-Channel': 'beta' } })
  })

  it('transitions through available then downloading before returning installed', async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
    vi.mocked(check).mockResolvedValueOnce({
      version: '1.2.3',
      downloadAndInstall,
    } as any)

    const progress: Array<{ phase: string; version: string }> = []
    const result = await runUpdateCheck('stable', {
      onProgress: (phase, version) => progress.push({ phase, version }),
    })

    expect(progress).toEqual([
      { phase: 'available', version: '1.2.3' },
      { phase: 'downloading', version: '1.2.3' },
    ])
    expect(downloadAndInstall).toHaveBeenCalledOnce()
    expect(result).toEqual({ kind: 'installed', version: '1.2.3' })
  })

  it('returns error kind and logs when check() rejects', async () => {
    vi.mocked(check).mockRejectedValueOnce(new Error('network down'))

    const result = await runUpdateCheck('stable')

    expect(result).toEqual({ kind: 'error', message: 'network down' })
    expect(logService.error).toHaveBeenCalled()
  })

  it('is idempotent while a check is in-flight', async () => {
    let resolveFirst!: (value: null) => void
    vi.mocked(check).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFirst = resolve as (value: null) => void
      }) as any,
    )

    const firstPromise = runUpdateCheck('stable')
    const second = await runUpdateCheck('stable')

    expect(second).toEqual({ kind: 'busy' })
    expect(check).toHaveBeenCalledOnce()

    resolveFirst(null)
    await firstPromise
  })
})
