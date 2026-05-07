import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOpenUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../../lib/ipc/commands', () => ({
  openUrl: mockOpenUrl,
}))

import { OpenerService } from './openerService'

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

    it('delegates to commands.openUrl', async () => {
      await makeSvc().open('https://example.com')
      expect(mockOpenUrl).toHaveBeenCalledWith('https://example.com')
    })
  })
})
