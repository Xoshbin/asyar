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
    return commands.windowGetBounds()
  }

  async setWindowBounds(update: WindowBoundsUpdate): Promise<void> {
    return commands.windowSetBounds(update)
  }

  async setFullscreen(enable: boolean): Promise<void> {
    return commands.windowSetFullscreen(enable)
  }

  async getMonitors(): Promise<WindowBounds[]> {
    return commands.windowGetMonitors()
  }

  async applyPreset(presetId: string): Promise<void> {
    return commands.windowApplyPreset(presetId)
  }
}

export const windowManagementService = new WindowManagementService()
