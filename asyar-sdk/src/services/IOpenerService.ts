/**
 * Service for opening URLs in default or application-specific handlers.
 *
 * Requires the `shell:open-url` permission in the extension manifest.
 *
 * @example
 * ```ts
 * const opener = context.getService<IOpenerService>('opener');
 * await opener.openUrl('https://example.com');
 * ```
 */
export interface IOpenerService {
  /**
   * Opens the given URL using the system's default handler or declared permission schemes.
   *
   * @param url The URL string to open.
   */
  openUrl(url: string): Promise<void>;
}
