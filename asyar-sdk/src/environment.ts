import { EnvironmentServiceProxy } from './services/EnvironmentServiceProxy';
import type { EnvironmentSnapshot } from './types/EnvironmentType';

declare global {
  interface Window {
    __ASYAR_ENVIRONMENT__?: Partial<EnvironmentSnapshot>;
  }
}

const proxy = new EnvironmentServiceProxy();

function detectPlatform(): 'macos' | 'windows' | 'linux' {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) return 'macos';
    if (ua.includes('win')) return 'windows';
  }
  if (typeof process !== 'undefined' && process.platform) {
    if (process.platform === 'darwin') return 'macos';
    if (process.platform === 'win32') return 'windows';
  }
  return 'linux';
}

function detectLocale(): string {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  return 'en-US';
}

function getInjected(): Partial<EnvironmentSnapshot> {
  if (typeof window !== 'undefined' && window.__ASYAR_ENVIRONMENT__) {
    return window.__ASYAR_ENVIRONMENT__;
  }
  return {};
}

/**
 * Host environment facade providing runtime, platform, and locale metadata.
 */
export const environment = {
  /**
   * The effective BCP-47 locale tag (e.g. "en-US", "de-DE", "zh-Hans-CN").
   */
  get locale(): string {
    return getInjected().locale ?? detectLocale();
  },

  /**
   * The primary ISO 639 language code (e.g. "en", "de", "zh").
   */
  get language(): string {
    return getInjected().language ?? this.locale.split(/[-_]/)[0] ?? 'en';
  },

  /**
   * The ISO 3166-1 country/region code if present (e.g. "US", "DE"), or null.
   */
  get region(): string | null {
    const injected = getInjected();
    if (injected.region !== undefined) return injected.region;
    const parts = this.locale.split(/[-_]/);
    return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : null;
  },

  /**
   * The ISO 15924 script subtag if present (e.g. "Hans", "Hant"), or null.
   */
  get script(): string | null {
    return getInjected().script ?? null;
  },

  /**
   * The active number format convention ("point" = 1,234.56, "comma" = 1.234,56).
   */
  get numberFormat(): 'point' | 'comma' {
    return getInjected().numberFormat ?? 'point';
  },

  /**
   * The host operating system platform ("macos", "windows", "linux").
   */
  get platform(): 'macos' | 'windows' | 'linux' {
    return getInjected().platform ?? detectPlatform();
  },

  /**
   * The current host UI theme appearance ("dark" | "light").
   */
  get theme(): 'dark' | 'light' {
    return getInjected().theme ?? 'dark';
  },

  /**
   * Whether the host application is running in development mode.
   */
  get isDevelopment(): boolean {
    return getInjected().isDevelopment ?? false;
  },

  /**
   * The identifier of the current extension.
   */
  get extensionId(): string {
    return getInjected().extensionId ?? '';
  },

  /**
   * The identifier of the active command if in a command context.
   */
  get commandId(): string | undefined {
    return getInjected().commandId;
  },

  /**
   * Asynchronously fetches a fresh, verified snapshot of the host environment from Rust.
   */
  async getEnvironment(): Promise<EnvironmentSnapshot> {
    const snap = await proxy.getEnvironment();
    if (typeof window !== 'undefined') {
      window.__ASYAR_ENVIRONMENT__ = snap;
    }
    return snap;
  },

  /**
   * Asynchronously retrieves the latest system locale tag.
   */
  async getLocale(): Promise<string> {
    const env = await this.getEnvironment();
    return env.locale;
  },
};
