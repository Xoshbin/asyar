/**
 * Host environment and localization snapshot.
 */
export interface EnvironmentSnapshot {
  /**
   * The effective BCP-47 locale tag (e.g. "en-US", "de-DE", "zh-Hans-CN").
   */
  readonly locale: string;

  /**
   * The primary 2- or 3-letter ISO 639 language code (e.g. "en", "de", "zh").
   */
  readonly language: string;

  /**
   * The ISO 3166-1 country / region code if present (e.g. "US", "DE", "CN"), or null.
   */
  readonly region: string | null;

  /**
   * The ISO 15924 script subtag if present (e.g. "Hans", "Hant", "Latn"), or null.
   */
  readonly script: string | null;

  /**
   * The active number format convention ("point" = 1,234.56, "comma" = 1.234,56).
   */
  readonly numberFormat: 'point' | 'comma';

  /**
   * The host operating system platform.
   */
  readonly platform: 'macos' | 'windows' | 'linux';

  /**
   * The current host UI theme appearance.
   */
  readonly theme: 'dark' | 'light';

  /**
   * Whether the host application is running in development mode.
   */
  readonly isDevelopment: boolean;

  /**
   * The identifier of the calling extension.
   */
  readonly extensionId: string;

  /**
   * The identifier of the active command, if invoked within a command context.
   */
  readonly commandId?: string;
}

/**
 * Service interface for querying host environment metadata.
 */
export interface IEnvironmentService {
  /**
   * Retrieves a snapshot of the current host environment metadata.
   */
  getEnvironment(): Promise<EnvironmentSnapshot>;
}
