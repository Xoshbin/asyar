/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logService before importing the module under test
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { WindowManagementState } from './state.svelte'
import type { IStorageService } from 'asyar-sdk/contracts'
import type { WindowBounds } from '../../lib/ipc/commands'

function makeStoreMock(data: Record<string, string> = {}): IStorageService {
  const store = { ...data }
  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    set: vi.fn(async (key: string, value: string) => { store[key] = value }),
    delete: vi.fn(async () => true),
    getAll: vi.fn(async () => store),
    clear: vi.fn(async () => 0),
  } as unknown as IStorageService
}

describe('WindowManagementState', () => {
  let state: WindowManagementState
  let storeMock: IStorageService

  beforeEach(() => {
    vi.clearAllMocks()
    state = new WindowManagementState()
    storeMock = makeStoreMock()
  })

  describe('loadFromStorage', () => {
    it('initializes with empty arrays when storage is empty', async () => {
      await state.loadFromStorage(storeMock)
      expect(state.customLayouts).toEqual([])
      expect(state.previousBounds).toBeNull()
    })

    it('loads custom layouts from storage', async () => {
      const layouts = [{ id: '1', name: 'My Layout', bounds: { x: 0, y: 0, width: 800, height: 600 } }]
      storeMock = makeStoreMock({ custom_layouts: JSON.stringify(layouts) })
      await state.loadFromStorage(storeMock)
      expect(state.customLayouts).toEqual(layouts)
    })

    it('loads previous bounds from storage', async () => {
      const bounds: WindowBounds = { x: 100, y: 200, width: 1000, height: 800 }
      storeMock = makeStoreMock({ previous_bounds: JSON.stringify(bounds) })
      await state.loadFromStorage(storeMock)
      expect(state.previousBounds).toEqual(bounds)
    })

    it('handles corrupted JSON gracefully — sets empty state', async () => {
      storeMock = makeStoreMock({ custom_layouts: 'not-json' })
      await state.loadFromStorage(storeMock)
      expect(state.customLayouts).toEqual([])
    })
  })

  describe('addCustomLayout', () => {
    it('appends layout and persists to storage', async () => {
      const bounds: WindowBounds = { x: 0, y: 0, width: 1200, height: 800 }
      await state.loadFromStorage(storeMock)
      await state.addCustomLayout('Work Setup', bounds, storeMock)
      expect(state.customLayouts).toHaveLength(1)
      expect(state.customLayouts[0].name).toBe('Work Setup')
      expect(state.customLayouts[0].bounds).toEqual(bounds)
      expect(storeMock.set).toHaveBeenCalledWith(
        'custom_layouts',
        JSON.stringify(state.customLayouts),
      )
    })

    it('generates a unique id based on timestamp', async () => {
      const bounds: WindowBounds = { x: 0, y: 0, width: 800, height: 600 }
      await state.loadFromStorage(storeMock)
      await state.addCustomLayout('A', bounds, storeMock)
      await state.addCustomLayout('B', bounds, storeMock)
      const ids = state.customLayouts.map(l => l.id)
      expect(new Set(ids).size).toBe(2)
    })
  })

  describe('deleteCustomLayout', () => {
    it('removes layout by id and persists to storage', async () => {
      const layouts = [
        { id: 'abc', name: 'Layout A', bounds: { x: 0, y: 0, width: 800, height: 600 } },
        { id: 'def', name: 'Layout B', bounds: { x: 0, y: 0, width: 1200, height: 800 } },
      ]
      storeMock = makeStoreMock({ custom_layouts: JSON.stringify(layouts) })
      await state.loadFromStorage(storeMock)
      await state.deleteCustomLayout('abc', storeMock)
      expect(state.customLayouts).toHaveLength(1)
      expect(state.customLayouts[0].id).toBe('def')
      expect(storeMock.set).toHaveBeenCalledWith(
        'custom_layouts',
        JSON.stringify(state.customLayouts),
      )
    })

    it('is a no-op for unknown id', async () => {
      await state.loadFromStorage(storeMock)
      await state.deleteCustomLayout('nonexistent', storeMock)
      expect(state.customLayouts).toEqual([])
    })
  })

  describe('savePreviousBounds', () => {
    it('stores bounds in state and persists to storage', async () => {
      const bounds: WindowBounds = { x: 50, y: 50, width: 1440, height: 900 }
      await state.loadFromStorage(storeMock)
      await state.savePreviousBounds(bounds, storeMock)
      expect(state.previousBounds).toEqual(bounds)
      expect(storeMock.set).toHaveBeenCalledWith(
        'previous_bounds',
        JSON.stringify(bounds),
      )
    })
  })
})
