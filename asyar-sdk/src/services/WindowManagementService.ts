import { BaseServiceProxy } from './BaseServiceProxy';

export interface WindowBounds {
  /** Logical pixels from the left edge of the monitor. */
  x: number;
  /** Logical pixels from the top edge of the monitor. */
  y: number;
  /** Logical width in pixels. */
  width: number;
  /** Logical height in pixels. */
  height: number;
}

export interface AppWindowInfo {
  id: string;
  pid: number;
  appName: string;
  appBundleId?: string | null;
  title: string;
  isMinimized: boolean;
  isFocused: boolean;
  appIcon?: string | null;
}

export interface IWindowManagementService {
  /**
   * Returns the bounds (position and size) of the frontmost OS application
   * window — or a specific window when `windowId` is provided.
   *
   * Requires `window:manage` permission.
   *
   * **macOS:** Uses the Accessibility API (AXUIElement). Requires Accessibility
   * permission in System Settings > Privacy & Security > Accessibility.
   *
   * **Windows:** Targets the window that was frontmost when Asyar was invoked (or `windowId`).
   *
   * **Linux (X11):** Requires `xdotool` to be installed. Not supported on Wayland.
   */
  getWindowBounds(windowId?: string): Promise<WindowBounds>;

  /**
   * Updates the position and/or size of the frontmost OS application window
   * — or a specific window when `windowId` is provided.
   * Omit any fields you do not want to change.
   *
   * Requires `window:manage` permission.
   */
  setWindowBounds(update: Partial<WindowBounds>, windowId?: string): Promise<void>;

  /**
   * Lists visible application windows across monitors.
   *
   * Requires `window:manage` permission.
   */
  listWindows(): Promise<AppWindowInfo[]>;

  /**
   * Brings a specific window (by ID from `listWindows()`) to the foreground.
   *
   * Requires `window:manage` permission.
   */
  focusWindow(id: string): Promise<void>;

  /**
   * Toggles the fullscreen state of the frontmost OS application window.
   *
   * On Windows, this maximizes/restores the window.
   *
   * Requires `window:manage` permission.
   */
  setFullscreen(enable: boolean): Promise<void>;

  /**
   * Returns a list of all available monitors and their logical bounds.
   *
   * Requires `window:manage` permission.
   */
  getMonitors(): Promise<WindowBounds[]>;

  /**
   * Applies a preset layout to the frontmost OS application window relative to the monitor it is on.
   *
   * Requires `window:manage` permission.
   */
  applyPreset(presetId: string): Promise<void>;

  /**
   * Moves the frontmost OS application window to the previous display, keeping relative size and position.
   *
   * On single-display setups, this is a no-op.
   *
   * Requires `window:manage` permission.
   */
  previousDisplay(): Promise<void>;

  /**
   * Moves the frontmost OS application window to the next display, keeping relative size and position.
   *
   * On single-display setups, this is a no-op.
   *
   * Requires `window:manage` permission.
   */
  nextDisplay(): Promise<void>;
}

export class WindowManagementServiceProxy
  extends BaseServiceProxy
  implements IWindowManagementService
{
  async getWindowBounds(windowId?: string): Promise<WindowBounds> {
    return windowId !== undefined
      ? this.broker.invoke('window:getWindowBounds', { windowId })
      : this.broker.invoke('window:getWindowBounds');
  }

  async setWindowBounds(update: Partial<WindowBounds>, windowId?: string): Promise<void> {
    const payload: Record<string, unknown> = {
      x: update.x,
      y: update.y,
      width: update.width,
      height: update.height,
    };
    if (windowId !== undefined) {
      payload.windowId = windowId;
    }
    return this.broker.invoke('window:setWindowBounds', payload);
  }

  async listWindows(): Promise<AppWindowInfo[]> {
    return this.broker.invoke('window:listWindows');
  }

  async focusWindow(id: string): Promise<void> {
    return this.broker.invoke('window:focusWindow', { id });
  }

  async setFullscreen(enable: boolean): Promise<void> {
    return this.broker.invoke('window:setFullscreen', { enable });
  }

  async getMonitors(): Promise<WindowBounds[]> {
    return this.broker.invoke('window:getMonitors');
  }

  async applyPreset(presetId: string): Promise<void> {
    return this.broker.invoke('window:applyPreset', { presetId });
  }

  async previousDisplay(): Promise<void> {
    return this.applyPreset('previous-display');
  }

  async nextDisplay(): Promise<void> {
    return this.applyPreset('next-display');
  }
}
