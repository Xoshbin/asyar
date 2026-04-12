import type { WindowBounds, WindowBoundsUpdate } from '../../lib/ipc/commands'
import * as commands from '../../lib/ipc/commands'

export interface IWindowManagementService {
  getWindowBounds(): Promise<WindowBounds>
  setWindowBounds(update: WindowBoundsUpdate): Promise<void>
  setFullscreen(enable: boolean): Promise<void>
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
}

export const windowManagementService = new WindowManagementService()
