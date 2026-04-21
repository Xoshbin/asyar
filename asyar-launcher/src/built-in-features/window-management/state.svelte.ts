import { logService } from '../../services/log/logService'
import type { IStorageService } from 'asyar-sdk/contracts'
import type { WindowBounds } from '../../lib/ipc/commands'

export interface CustomLayout {
  id: string
  name: string
  bounds: WindowBounds
}

const STORAGE_KEY_LAYOUTS = 'custom_layouts'
const STORAGE_KEY_PREV_BOUNDS = 'previous_bounds'

export class WindowManagementState {
  customLayouts = $state<CustomLayout[]>([])
  previousBounds = $state<WindowBounds | null>(null)

  async loadFromStorage(store: IStorageService): Promise<void> {
    try {
      const rawLayouts = await store.get(STORAGE_KEY_LAYOUTS)
      this.customLayouts = rawLayouts ? JSON.parse(rawLayouts) : []
    } catch {
      logService.warn('[WindowManagement] Failed to parse custom_layouts — resetting to []')
      this.customLayouts = []
    }

    try {
      const rawBounds = await store.get(STORAGE_KEY_PREV_BOUNDS)
      this.previousBounds = rawBounds ? JSON.parse(rawBounds) : null
    } catch {
      this.previousBounds = null
    }
  }

  async addCustomLayout(
    name: string,
    bounds: WindowBounds,
    store: IStorageService,
  ): Promise<void> {
    const layout: CustomLayout = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, bounds }
    this.customLayouts = [...this.customLayouts, layout]
    await store.set(STORAGE_KEY_LAYOUTS, JSON.stringify(this.customLayouts))
  }

  async deleteCustomLayout(id: string, store: IStorageService): Promise<void> {
    this.customLayouts = this.customLayouts.filter(l => l.id !== id)
    await store.set(STORAGE_KEY_LAYOUTS, JSON.stringify(this.customLayouts))
  }

  async savePreviousBounds(bounds: WindowBounds, store: IStorageService): Promise<void> {
    this.previousBounds = bounds
    await store.set(STORAGE_KEY_PREV_BOUNDS, JSON.stringify(bounds))
  }
}

export const windowManagementState = new WindowManagementState()
