/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../../services/windowManagement/windowManagementService', () => ({
  windowManagementService: {
    getWindowBounds: vi.fn(),
    setWindowBounds: vi.fn(),
    setFullscreen: vi.fn(),
  },
}))
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    showHUD: vi.fn(),
    showToast: vi.fn(),
  },
}))
vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
  },
}))
vi.mock('./state.svelte', () => ({
  windowManagementState: {
    customLayouts: [],
    previousBounds: null,
    loadFromStorage: vi.fn(),
    savePreviousBounds: vi.fn(),
    addCustomLayout: vi.fn(),
    deleteCustomLayout: vi.fn(),
  },
}))
vi.mock('./ManageView.svelte', () => ({ default: {} }))

import extension from './index'
import { windowManagementService } from '../../services/windowManagement/windowManagementService'
import { feedbackService } from '../../services/feedback/feedbackService.svelte'
import { windowManagementState } from './state.svelte'
import type { ExtensionContext } from 'asyar-sdk'

function makeContext(): ExtensionContext {
  return {
    getService: vi.fn().mockImplementation((name: string) => {
      if (name === 'storage') return { get: vi.fn(async () => null), set: vi.fn(), delete: vi.fn() }
      if (name === 'extensions') return { navigateToView: vi.fn(), setActiveViewActionLabel: vi.fn() }
      return null
    }),
  } as unknown as ExtensionContext
}

describe('WindowManagementExtension', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('initialize', () => {
    it('resolves StorageService and loads state', async () => {
      const ctx = makeContext()
      await extension.initialize(ctx)
      expect(ctx.getService).toHaveBeenCalledWith('storage')
      expect(windowManagementState.loadFromStorage).toHaveBeenCalled()
    })
  })

  describe('executeCommand — layout presets', () => {
    beforeEach(async () => {
      await extension.initialize(makeContext())
      vi.mocked(windowManagementService.getWindowBounds).mockResolvedValue(
        { x: 0, y: 0, width: 1440, height: 900 }
      )
      vi.mocked(windowManagementService.setWindowBounds).mockResolvedValue()
      vi.mocked(windowManagementService.setFullscreen).mockResolvedValue()
      vi.mocked(feedbackService.showHUD).mockResolvedValue()
    })

    it('left-half saves previous bounds then calls setWindowBounds', async () => {
      await extension.executeCommand('left-half')
      expect(windowManagementState.savePreviousBounds).toHaveBeenCalled()
      expect(windowManagementService.setWindowBounds).toHaveBeenCalled()
      expect(feedbackService.showHUD).toHaveBeenCalledWith('Left Half')
    })

    it('maximize calls setFullscreen(true)', async () => {
      await extension.executeCommand('maximize')
      expect(windowManagementService.setFullscreen).toHaveBeenCalledWith(true)
      expect(windowManagementService.setWindowBounds).not.toHaveBeenCalled()
    })

    it('shows failure toast when getWindowBounds throws', async () => {
      vi.mocked(windowManagementService.getWindowBounds).mockRejectedValue(
        new Error('Accessibility permission required')
      )
      vi.mocked(feedbackService.showToast).mockResolvedValue('')
      await extension.executeCommand('left-half')
      expect(feedbackService.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: 'failure' })
      )
    })
  })

  describe('executeCommand — restore', () => {
    beforeEach(async () => { await extension.initialize(makeContext()) })

    it('calls setWindowBounds with previousBounds when available', async () => {
      const prev = { x: 100, y: 100, width: 800, height: 600 }
      Object.defineProperty(windowManagementState, 'previousBounds', { value: prev, configurable: true })
      vi.mocked(windowManagementService.setWindowBounds).mockResolvedValue()
      vi.mocked(feedbackService.showHUD).mockResolvedValue()
      await extension.executeCommand('restore')
      expect(windowManagementService.setWindowBounds).toHaveBeenCalledWith(prev)
    })

    it('shows toast when nothing to restore', async () => {
      Object.defineProperty(windowManagementState, 'previousBounds', { value: null, configurable: true })
      vi.mocked(feedbackService.showToast).mockResolvedValue('')
      await extension.executeCommand('restore')
      expect(feedbackService.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Nothing to restore', style: 'failure' })
      )
    })
  })

  describe('executeCommand — manage-layouts', () => {
    it('navigates to ManageView and returns view type', async () => {
      const ctx = makeContext()
      await extension.initialize(ctx)
      const result = await extension.executeCommand('manage-layouts')
      expect(result).toMatchObject({ type: 'view', viewPath: 'window-management/ManageView' })
    })
  })

  describe('search', () => {
    it('returns custom layouts as ExtensionResult entries', async () => {
      const layout = { id: '1', name: 'My Layout', bounds: { x: 0, y: 0, width: 800, height: 600 } }
      Object.defineProperty(windowManagementState, 'customLayouts', { value: [layout], configurable: true })
      await extension.initialize(makeContext())
      const results = await extension.search('my')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].title).toContain('My Layout')
    })

    it('returns empty array when no custom layouts match', async () => {
      Object.defineProperty(windowManagementState, 'customLayouts', { value: [], configurable: true })
      await extension.initialize(makeContext())
      const results = await extension.search('anything')
      expect(results).toEqual([])
    })
  })
})
