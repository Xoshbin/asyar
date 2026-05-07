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
    return 'https://asyar.org';
  }
}

export const envService = new EnvService();
