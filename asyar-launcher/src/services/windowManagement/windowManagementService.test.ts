import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../lib/ipc/commands', () => ({
  windowGetBounds: vi.fn(),
  windowSetBounds: vi.fn(),
  windowSetFullscreen: vi.fn(),
}))

import * as commands from '../../lib/ipc/commands'
import { WindowManagementService } from './windowManagementService'

describe('WindowManagementService', () => {
  let service: WindowManagementService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new WindowManagementService()
  })

  describe('getWindowBounds', () => {
    it('calls windowGetBounds and returns result', async () => {
      const bounds = { x: 100, y: 200, width: 1280, height: 800 }
      vi.mocked(commands.windowGetBounds).mockResolvedValueOnce(bounds)

      const result = await service.getWindowBounds()

      expect(commands.windowGetBounds).toHaveBeenCalledOnce()
      expect(result).toEqual(bounds)
    })
  })

  describe('setWindowBounds', () => {
    it('calls windowSetBounds with partial update', async () => {
      vi.mocked(commands.windowSetBounds).mockResolvedValueOnce(undefined)

      await service.setWindowBounds({ width: 800, height: 600 })

      expect(commands.windowSetBounds).toHaveBeenCalledWith({ width: 800, height: 600 })
    })

    it('calls windowSetBounds with x and y only', async () => {
      vi.mocked(commands.windowSetBounds).mockResolvedValueOnce(undefined)

      await service.setWindowBounds({ x: 0, y: 0 })

      expect(commands.windowSetBounds).toHaveBeenCalledWith({ x: 0, y: 0 })
    })
  })

  describe('setFullscreen', () => {
    it('calls windowSetFullscreen with enable=true', async () => {
      vi.mocked(commands.windowSetFullscreen).mockResolvedValueOnce(undefined)

      await service.setFullscreen(true)

      expect(commands.windowSetFullscreen).toHaveBeenCalledWith(true)
    })

    it('calls windowSetFullscreen with enable=false', async () => {
      vi.mocked(commands.windowSetFullscreen).mockResolvedValueOnce(undefined)

      await service.setFullscreen(false)

      expect(commands.windowSetFullscreen).toHaveBeenCalledWith(false)
    })
  })
})
