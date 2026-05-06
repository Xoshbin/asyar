// src/services/envService.ts

class EnvService {
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
