/**
 * Cross-platform file manager operations.
 *
 * Reveals files in the OS file manager (Finder on macOS, Explorer on Windows,
 * default file manager on Linux) or moves files to the OS trash/recycle bin.
 *
 * **Permissions required:**
 * - `fs:read` for `showInFileManager`
 * - `fs:write` for `trash`
 */
export interface IFileManagerService {
  /**
   * Reveals a file or directory in the OS file manager, selecting it.
   *
   * - macOS: Opens Finder and selects the item.
   * - Windows: Opens Explorer and selects the item.
   * - Linux: Opens the parent directory in the default file manager.
   *
   * @param path Absolute path to the file or directory.
   * @throws If the path is not absolute or does not exist.
   */
  showInFileManager(path: string): Promise<void>;

  /**
   * Moves a file or directory to the OS trash / recycle bin.
   * The item can be restored from trash by the user.
   * Path must be within the user's home directory tree.
   *
   * @param path Absolute path to the file or directory.
   * @throws If the path is not absolute, does not exist, or is outside the home directory.
   */
  trash(path: string): Promise<void>;
}
