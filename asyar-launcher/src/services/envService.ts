// src/services/envService.ts
import { logService } from "./log/logService";

class EnvService {
  private _isTauri: boolean | null = null;

  /**
   * Detects if the application is running within a Tauri environment.
   */
  get isTauri(): boolean {
    if (this._isTauri !== null) return this._isTauri;

    // Check for window.__TAURI_INTERNALS__ which is injected by Tauri
    this._isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;
    
    logService.debug(`[EnvService] Environment detection: isTauri = ${this._isTauri}`);
    return this._isTauri;
  }

  /**
   * Detects if the application is running in a standard browser.
   */
  get isBrowser(): boolean {
    return !this.isTauri;
  }

  /**
   * Returns the current application mode (development or production).
   */
  get mode(): string {
    return import.meta.env.MODE;
  }

  /**
   * Detects if the application is running in development mode.
   */
  get isDev(): boolean {
    return import.meta.env.MODE === "development";
  }

  get storeApiBaseUrl(): string {
    if (import.meta.env.PROD) {
      return 'https://asyar.org';
    }
    // Development: only use local server on macOS
    const isMac = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac');
    return isMac ? 'http://asyar-website.test' : 'https://asyar.org';
  }
}

export const envService = new EnvService();
