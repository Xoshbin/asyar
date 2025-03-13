/**
 * Interface for extension discovery functions
 */
export interface IExtensionDiscovery {
  /**
   * Discover all available extensions in the project
   * @returns Promise resolving to an array of extension IDs
   */
  discoverExtensions(): Promise<string[]>;
}
