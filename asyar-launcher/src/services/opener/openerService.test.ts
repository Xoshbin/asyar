import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOpenUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../../lib/ipc/commands', () => ({
  openUrl: mockOpenUrl,
}))

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../envService', () => ({
  envService: { isTauri: true, isBrowser: false },
}))

import { OpenerService } from './openerService'
import { envService } from '../envService'

function makeSvc() {
  return new OpenerService()
}

describe('OpenerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('open', () => {
    it('does nothing when url is empty', async () => {
      await makeSvc().open('')
      expect(mockOpenUrl).not.toHaveBeenCalled()
    })

    it('calls commands.openUrl in Tauri mode', async () => {
      await makeSvc().open('https://example.com')
      expect(mockOpenUrl).toHaveBeenCalledWith('https://example.com')
    })

    it('calls window.open in browser mode', async () => {
      vi.mocked(envService).isTauri = false
      const mockWindowOpen = vi.fn()
      vi.stubGlobal('open', mockWindowOpen)

      await makeSvc().open('https://example.com')

      expect(mockOpenUrl).not.toHaveBeenCalled()
      expect(mockWindowOpen).toHaveBeenCalledWith('https://example.com', '_blank')

      vi.mocked(envService).isTauri = true
      vi.unstubAllGlobals()
    })
  })
})
