import type { WindowBounds, WindowBoundsUpdate } from '../../lib/ipc/commands'
import * as commands from '../../lib/ipc/commands'

export interface IWindowManagementService {
  getWindowBounds(): Promise<WindowBounds>
  setWindowBounds(update: WindowBoundsUpdate): Promise<void>
  setFullscreen(enable: boolean): Promise<void>
  getMonitors(): Promise<WindowBounds[]>
  applyPreset(presetId: string): Promise<void>
}

export class WindowManagementService implements IWindowManagementService {
  async getWindowBounds(): Promise<WindowBounds> {
    const result = await commands.windowGetBounds()
    if (result === null) throw new Error('window_management_get_bounds failed')
    return result
  }

  async setWindowBounds(update: WindowBoundsUpdate): Promise<void> {
    return commands.windowSetBounds(update)
  }

  async setFullscreen(enable: boolean): Promise<void> {
    return commands.windowSetFullscreen(enable)
  }

  async getMonitors(): Promise<WindowBounds[]> {
    const result = await commands.windowGetMonitors()
    if (result === null) throw new Error('window_management_get_monitors failed')
    return result
  }

  async applyPreset(presetId: string): Promise<void> {
    return commands.windowApplyPreset(presetId)
  }
}

export const windowManagementService = new WindowManagementService()
