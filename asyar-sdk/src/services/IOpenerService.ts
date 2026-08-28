/**
 * Options for opening paths with external applications.
 */
export interface OpenPathOptions {
  /** Optional application name or bundle to open the path with (e.g. 'Zed', 'Visual Studio Code', 'Ghostty'). */
  with?: string;
}

/**
 * Service for opening URLs, local paths, and revealing items in external applications or the system file manager.
 *
 * Requires:
 * - `shell:open-url` for `openUrl`
 * - `shell:open-path` for `openPath`
 * - `fs:read` for `reveal`
 *
 * @example
 * ```ts
 * const opener = context.getService<IOpenerService>('opener');
 * await opener.openUrl('https://example.com');
 * await opener.openPath('/path/to/project', { with: 'Zed' });
 * await opener.reveal('/path/to/file.txt');
 * ```
 */
export interface IOpenerService {
  /**
   * Opens the given URL using the system's default handler or declared permission schemes.
   *
   * @param url The URL string to open.
   */
  openUrl(url: string): Promise<void>;

  /**
   * Opens a local file or directory path using the system's default handler or a specified application.
   *
   * @param path The absolute or tilde-prefixed path to open.
   * @param options Options specifying the target application name/bundle.
   */
  openPath(path: string, options?: OpenPathOptions): Promise<void>;

  /**
   * Reveals the file or directory in the system's default file manager (Finder on macOS, File Explorer on Windows, Nautilus/Dolphin on Linux).
   *
   * @param path The absolute or tilde-prefixed path to reveal.
   */
  reveal(path: string): Promise<void>;
}
