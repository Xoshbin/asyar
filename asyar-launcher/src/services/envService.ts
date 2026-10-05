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
    return import.meta.env.MODE === 'development';
  }

  get storeApiBaseUrl(): string {
    return 'https://asyar.org';
  }

  /**
   * The semver version of the Asyar SDK bundled and supported by this host.
   */
  get supportedSdkVersion(): string {
    return SUPPORTED_SDK_VERSION;
  }
}

export const SUPPORTED_SDK_VERSION = '4.14.1';
export const envService = new EnvService();
