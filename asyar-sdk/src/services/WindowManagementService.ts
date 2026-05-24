import { BaseServiceProxy } from './BaseServiceProxy'

export interface WindowBounds {
  /** Logical pixels from the left edge of the monitor. */
  x: number
  /** Logical pixels from the top edge of the monitor. */
  y: number
  /** Logical width in pixels. */
  width: number
  /** Logical height in pixels. */
  height: number
}

export interface IWindowManagementService {
  /**
   * Returns the bounds (position and size) of the frontmost OS application
   * window — the window that was active before Asyar was opened.
   *
   * Requires `window:manage` permission.
   *
   * **macOS:** Uses the Accessibility API (AXUIElement). Requires Accessibility
   * permission in System Settings > Privacy & Security > Accessibility.
   *
   * **Windows:** Targets the window that was frontmost when Asyar was invoked.
   *
   * **Linux (X11):** Requires `xdotool` to be installed. Not supported on Wayland.
   */
  getWindowBounds(): Promise<WindowBounds>

  /**
   * Updates the position and/or size of the frontmost OS application window.
   * Omit any fields you do not want to change.
   *
   * Requires `window:manage` permission.
   */
  setWindowBounds(update: Partial<WindowBounds>): Promise<void>

  /**
   * Toggles the fullscreen state of the frontmost OS application window.
   *
   * On Windows, this maximizes/restores the window.
   *
   * Requires `window:manage` permission.
   */
  setFullscreen(enable: boolean): Promise<void>
}

export class WindowManagementServiceProxy
  extends BaseServiceProxy
  implements IWindowManagementService
{
  async getWindowBounds(): Promise<WindowBounds> {
    return this.broker.invoke('window:getWindowBounds')
  }

  async setWindowBounds(update: Partial<WindowBounds>): Promise<void> {
    return this.broker.invoke('window:setWindowBounds', {
      x: update.x,
      y: update.y,
      width: update.width,
      height: update.height,
    })
  }

  async setFullscreen(enable: boolean): Promise<void> {
    return this.broker.invoke('window:setFullscreen', { enable })
  }
}
